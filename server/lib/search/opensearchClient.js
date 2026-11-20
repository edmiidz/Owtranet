/**
 * Minimal OpenSearch REST client (axios, no extra dependency).
 *
 * Configuration (.env), all optional — search falls back to MySQL when
 * OPENSEARCH_URL is unset:
 *   OPENSEARCH_URL            e.g. https://127.0.0.1:9200
 *   OPENSEARCH_USERNAME       basic-auth user (omit when security is disabled)
 *   OPENSEARCH_PASSWORD
 *   OPENSEARCH_INSECURE_TLS   true = accept a self-signed certificate (demo certs)
 *   OPENSEARCH_INDEX_PREFIX   default "owtranet"; lets several instances share a cluster
 *   OPENSEARCH_TIMEOUT_MS     per-request timeout for searches, default 3000
 */
const https = require('https');
const axios = require('axios');

function config() {
  const url = (process.env.OPENSEARCH_URL || '').trim().replace(/\/+$/, '');
  return {
    url,
    enabled: Boolean(url),
    username: process.env.OPENSEARCH_USERNAME || '',
    password: process.env.OPENSEARCH_PASSWORD || '',
    insecureTls: /^(1|true|yes)$/i.test(process.env.OPENSEARCH_INSECURE_TLS || ''),
    prefix: (process.env.OPENSEARCH_INDEX_PREFIX || 'owtranet').toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    timeoutMs: parseInt(process.env.OPENSEARCH_TIMEOUT_MS || '3000', 10),
  };
}

let cachedClient = null;
let cachedKey = '';

function client() {
  const cfg = config();
  if (!cfg.enabled) return null;
  const key = JSON.stringify(cfg);
  if (cachedClient && cachedKey === key) return cachedClient;

  const http = axios.create({
    baseURL: cfg.url,
    timeout: cfg.timeoutMs,
    auth: cfg.username ? { username: cfg.username, password: cfg.password } : undefined,
    httpsAgent: cfg.url.startsWith('https:')
      ? new https.Agent({ rejectUnauthorized: !cfg.insecureTls, keepAlive: true })
      : undefined,
    // Callers inspect status codes themselves (404 on a missing alias is normal).
    validateStatus: () => true,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  async function request(method, path, body, { ndjson = false, timeoutMs } = {}) {
    const res = await http.request({
      method,
      url: path,
      data: ndjson ? body : body === undefined ? undefined : body,
      headers: { 'Content-Type': ndjson ? 'application/x-ndjson' : 'application/json' },
      timeout: timeoutMs ?? cfg.timeoutMs,
    });
    return res;
  }

  // Throws with OpenSearch's own error text for anything but 2xx.
  async function ok(method, path, body, opts) {
    const res = await request(method, path, body, opts);
    if (res.status < 200 || res.status >= 300) {
      const reason = res.data && res.data.error
        ? (res.data.error.reason || res.data.error.type || JSON.stringify(res.data.error))
        : `HTTP ${res.status}`;
      const err = new Error(`OpenSearch ${method} ${path}: ${reason}`);
      err.status = res.status;
      throw err;
    }
    return res.data;
  }

  cachedClient = { cfg, request, ok };
  cachedKey = key;
  return cachedClient;
}

module.exports = { config, client };
