/**
 * "Connected sources" search through a RheinInsights Retrieval Suite.
 *
 * The Suite crawls external systems (Google Drive, Confluence, SharePoint, …)
 * with their document-level permissions and answers queries already trimmed to
 * one user. Owtranet calls it server-side with the signed-in member's email as
 * the user principal; the member's browser never sees the Suite or its token.
 *
 * Configuration (.env); the feature is off unless URL, pipeline and token are set:
 *   RETRIEVAL_SUITE_URL           e.g. https://suite.internal:14000
 *   RETRIEVAL_SUITE_PIPELINE_ID   numeric query pipeline id
 *   RETRIEVAL_SUITE_TOKEN         token for the pipeline (never sent to clients)
 *   RETRIEVAL_SUITE_AUTH_SCHEME   raw (default: "Authorization: <token>") | bearer
 *   RETRIEVAL_SUITE_MODE          sync (default: POST /search) | async (submit + poll)
 *   RETRIEVAL_SUITE_IDENTITY      email (default) | company_email — which users column
 *                                 holds the address the Suite knows the member by
 *   RETRIEVAL_SUITE_INSECURE_TLS  true = accept a self-signed certificate
 *   RETRIEVAL_SUITE_TIMEOUT_MS    default 4000; search never waits longer than this
 */
const https = require('https');
const axios = require('axios');

function config() {
  const url = (process.env.RETRIEVAL_SUITE_URL || '').trim().replace(/\/+$/, '');
  const pipelineId = (process.env.RETRIEVAL_SUITE_PIPELINE_ID || '').trim();
  const token = process.env.RETRIEVAL_SUITE_TOKEN || '';
  return {
    url,
    pipelineId,
    token,
    enabled: Boolean(url && /^\d+$/.test(pipelineId) && token),
    scheme: (process.env.RETRIEVAL_SUITE_AUTH_SCHEME || 'raw').toLowerCase(),
    mode: (process.env.RETRIEVAL_SUITE_MODE || 'sync').toLowerCase(),
    identity: process.env.RETRIEVAL_SUITE_IDENTITY === 'company_email' ? 'company_email' : 'email',
    insecureTls: /^(1|true|yes)$/i.test(process.env.RETRIEVAL_SUITE_INSECURE_TLS || ''),
    timeoutMs: parseInt(process.env.RETRIEVAL_SUITE_TIMEOUT_MS || '4000', 10),
  };
}

function enabled() {
  return config().enabled;
}

// Teasers can carry highlight markup; the client renders plain text.
function plain(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// metadata is { field: [values] }. Field names depend on the connector, so try
// the common ones. Only these whitelisted fields are passed on: the rest of the
// metadata can include ACL tokens and other internals that must not reach a browser.
function firstMeta(meta, names) {
  if (!meta) return '';
  const keys = Object.keys(meta);
  for (const name of names) {
    const key = keys.find(k => k.toLowerCase() === name.toLowerCase());
    const v = key && meta[key];
    if (Array.isArray(v) && v.length && v[0]) return String(v[0]);
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

function mapResult(r) {
  const meta = r.metadata || {};
  const teaser = plain(r.teaser || r.body).slice(0, 400);
  const title = plain(firstMeta(meta, ['title', 'name', 'filename', 'subject'])) || teaser.slice(0, 80) || r.url || 'Untitled';
  return {
    id: String(r.id || r.url || title),
    title,
    url: /^https?:\/\//i.test(r.url || '') ? r.url : null,
    teaser,
    score: typeof r.score === 'number' ? r.score : null,
    source: plain(firstMeta(meta, ['source', 'contentSource', 'connector', 'connectorName', 'datasource'])) || hostOf(r.url),
    modified: firstMeta(meta, ['lastModified', 'modified', 'modifiedDate', 'lastmodified', 'date']) || null,
  };
}

let cachedHttp = null;
let cachedKey = '';
function http(cfg) {
  const key = JSON.stringify([cfg.url, cfg.insecureTls]);
  if (cachedHttp && cachedKey === key) return cachedHttp;
  cachedHttp = axios.create({
    baseURL: cfg.url,
    httpsAgent: cfg.url.startsWith('https:')
      ? new https.Agent({ rejectUnauthorized: !cfg.insecureTls, keepAlive: true })
      : undefined,
  });
  cachedKey = key;
  return cachedHttp;
}

function authHeader(cfg) {
  return cfg.scheme === 'bearer' ? `Bearer ${cfg.token}` : cfg.token;
}

async function searchSync(cfg, query, principal, deadline) {
  const res = await http(cfg).post(
    `/api/v1/querypipelines/search?queryPipelineId=${cfg.pipelineId}`,
    { query, start: 0, userPrincipalName: principal },
    { headers: { Authorization: authHeader(cfg) }, timeout: Math.max(1, deadline - Date.now()) }
  );
  return (res.data && res.data.results) || [];
}

// The submit-and-poll API used by RheinInsights' own Open WebUI pipe.
async function searchAsync(cfg, query, principal, deadline) {
  const headers = { Authorization: authHeader(cfg) };
  const remaining = () => Math.max(1, deadline - Date.now());
  const submit = await http(cfg).post(
    `/api/v1/querypipelines/search/async?queryPipelineId=${cfg.pipelineId}`,
    { query, userPrincipalName: principal, context: [] },
    { headers, timeout: remaining() }
  );
  const threadId = submit.data && submit.data.threadId;
  if (!threadId) return [];
  while (Date.now() < deadline) {
    const st = await http(cfg).post(
      '/api/v1/querypipelines/search/async/status',
      { threadId, userPrincipalName: principal },
      { headers, timeout: remaining() }
    );
    const d = st.data || {};
    if (d.isFailed || d.status === 'UNKNOWN') throw new Error('Retrieval Suite query failed');
    if (d.status === 'FINISHED') return (d.result && d.result.results) || [];
    await new Promise(r => setTimeout(r, Math.min(300, remaining())));
  }
  throw new Error('Retrieval Suite query timed out');
}

/**
 * Search connected sources as `member` (a users row or req.user with email).
 * Returns up to `limit` mapped results; throws on failure or timeout.
 */
async function search(q, member, { limit = 20 } = {}) {
  const cfg = config();
  if (!cfg.enabled) return null;
  const principal = (cfg.identity === 'company_email' && member.company_email) || member.email;
  if (!principal) return [];
  const deadline = Date.now() + cfg.timeoutMs;
  const query = String(q).slice(0, 500);
  const raw = cfg.mode === 'async'
    ? await searchAsync(cfg, query, principal, deadline)
    : await searchSync(cfg, query, principal, deadline);
  return raw.slice(0, limit).map(mapResult);
}

module.exports = { enabled, search, config, mapResult, plain };
