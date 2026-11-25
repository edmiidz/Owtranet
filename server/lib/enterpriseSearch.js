'use strict';

// Enterprise search: query an OpenSearch index that an external indexer fills
// (for example the RheinInsights Retrieval Suite, whose connectors crawl
// SharePoint, Confluence, Google Drive, websites, …) and return only the
// documents this member may see. Off unless OPENSEARCH_URL is set.
//
// ACCESS CONTROL. Every indexed document carries allow_acl / deny_acl keyword
// fields written by the indexer. A member may see a document when one of their
// principals is in allow_acl and none is in deny_acl. Their principals are the
// public principal (OPENSEARCH_PUBLIC_ACL, "everyone") plus, when
// RETRIEVAL_SUITE_URL and RETRIEVAL_SUITE_ACL_TOKEN are set, whatever the
// Suite's security-trimming API returns for their address. If that lookup is
// not configured or fails, members see public documents only: a failure
// narrows results, it never widens them.
//
// A slow or broken search engine must not break intranet search, so search()
// never throws: it returns { results: [], error } instead.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');

const DEFAULT_PUBLIC_ACL = 'G_____everyone';
const ACL_CACHE_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
// Highlight markers: control characters cannot occur in indexed text, so the
// client can split on them and render <mark> without trusting any HTML.
const HL_START = '\u0001';
const HL_END = '\u0002';

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// TLS for servers with a private or self-signed certificate.
//   caFile:      PEM of the CA that signed the server certificate
//   fingerprint: SHA-256 of the server certificate ("AB:CD:…"). When set it
//                replaces the hostname check, so a server reached by IP, or
//                one whose certificate names another host, is trusted only if
//                it presents exactly this certificate.
function tlsOptions(caFile, fingerprint) {
  const opts = {};
  if (caFile) opts.ca = fs.readFileSync(caFile);
  if (fingerprint) {
    const pin = normalizeFingerprint(fingerprint);
    opts.checkServerIdentity = (_host, cert) => (
      normalizeFingerprint(cert.fingerprint256 || '') === pin
        ? undefined
        : new Error('TLS certificate fingerprint does not match the configured pin')
    );
  }
  return opts;
}

function normalizeFingerprint(fp) {
  const hex = String(fp).replace(/[^0-9a-f]/gi, '').toUpperCase();
  return hex.match(/.{2}/g)?.join(':') || '';
}

function loadConfig(env = process.env) {
  const url = (env.OPENSEARCH_URL || '').trim().replace(/\/+$/, '');
  if (!url) return null;
  const timeoutMs = positiveInt(env.OPENSEARCH_TIMEOUT_MS, 4000);
  const suiteUrl = (env.RETRIEVAL_SUITE_URL || '').trim().replace(/\/+$/, '');
  return {
    url,
    index: env.OPENSEARCH_INDEX || 'documentindex',
    username: env.OPENSEARCH_USERNAME || '',
    password: env.OPENSEARCH_PASSWORD || '',
    tls: tlsOptions(env.OPENSEARCH_CA_FILE, env.OPENSEARCH_TLS_FINGERPRINT),
    timeoutMs,
    maxResults: Math.min(positiveInt(env.OPENSEARCH_MAX_RESULTS, 10), 50),
    publicAcl: env.OPENSEARCH_PUBLIC_ACL || DEFAULT_PUBLIC_ACL,
    label: env.ENTERPRISE_SEARCH_LABEL || 'Enterprise',
    acl: suiteUrl && env.RETRIEVAL_SUITE_ACL_TOKEN ? {
      url: suiteUrl,
      token: env.RETRIEVAL_SUITE_ACL_TOKEN,
      tls: tlsOptions(env.RETRIEVAL_SUITE_CA_FILE, env.RETRIEVAL_SUITE_TLS_FINGERPRINT),
      timeoutMs,
    } : null,
  };
}

let cachedConfig;
function config() {
  if (cachedConfig === undefined) {
    try {
      cachedConfig = loadConfig();
    } catch (err) {
      // A missing CA file must not stop the server; enterprise search stays off.
      console.error('Enterprise search disabled: configuration error:', err.message);
      cachedConfig = null;
    }
  }
  return cachedConfig;
}

function isEnabled() {
  return Boolean(config());
}

function requestJson(target, { method = 'GET', headers = {}, body, tls = {}, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const mod = u.protocol === 'http:' ? http : https;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = mod.request(u, {
      method,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      ...(u.protocol === 'https:' ? tls : {}),
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          reject(err);
          return;
        }
        try { resolve(text ? JSON.parse(text) : null); } catch (e) { reject(new Error('invalid JSON response')); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// The Suite's security-trimming API answers with the member's principals in
// up to three lists. Accept strings or arrays and ignore anything else.
function principalsFromAclResponse(data) {
  if (!data || typeof data !== 'object') return [];
  const out = [];
  for (const key of ['userAcls', 'groupAcls', 'userIds']) {
    const v = data[key];
    for (const item of Array.isArray(v) ? v : (v ? [v] : [])) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
    }
  }
  return out;
}

const aclCache = new Map();

async function principalsFor(identities, cfg, now = Date.now()) {
  const principals = new Set([cfg.publicAcl]);
  if (!cfg.acl) return [...principals];
  for (const id of identities) {
    const key = id.toLowerCase();
    let entry = aclCache.get(key);
    if (!entry || entry.expires < now) {
      try {
        const data = await requestJson(
          `${cfg.acl.url}/api/v1/securitytrimming/acls?id=${encodeURIComponent(id)}`,
          { headers: { Authorization: cfg.acl.token }, tls: cfg.acl.tls, timeoutMs: cfg.acl.timeoutMs }
        );
        entry = { principals: principalsFromAclResponse(data), expires: now + ACL_CACHE_MS };
        aclCache.set(key, entry);
      } catch (err) {
        // Not cached, so the next search retries. Public documents only for now.
        console.warn(`Enterprise search: principal lookup failed (${err.message}); showing public documents only`);
        continue;
      }
    }
    entry.principals.forEach((p) => principals.add(p));
  }
  return [...principals];
}

function buildQuery(q, principals, size) {
  return {
    size,
    _source: ['title', 'url', 'originalId', 'rootItemTitle', 'rootItemUrl', 'lastModifiedDate', 'fileExtension'],
    query: {
      bool: {
        must: [{ multi_match: { query: q, fields: ['title^3', 'body'], type: 'best_fields' } }],
        filter: [{ terms: { allow_acl: principals } }],
        must_not: [{ terms: { deny_acl: principals } }],
      },
    },
    // Long documents are indexed as several chunks sharing originalId; show
    // each document once, represented by its best-matching chunk.
    collapse: { field: 'originalId' },
    highlight: {
      pre_tags: [HL_START],
      post_tags: [HL_END],
      fields: { body: { fragment_size: 200, number_of_fragments: 1 } },
    },
  };
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

// Indexers often store titles and text with HTML entities ("Q&amp;A"). The
// client renders these strings as text, so decode them here.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(str) {
  return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 31 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function mapHits(data) {
  const hits = data?.hits?.hits || [];
  return hits.map((h) => {
    const s = h._source || {};
    const rawUrl = String(first(s.url) || '');
    return {
      id: String(first(s.originalId) || h._id),
      title: decodeEntities(first(s.title) || rawUrl || 'Untitled'),
      // Chunk URLs carry a "#<n>" suffix that is not a real anchor.
      url: rawUrl.replace(/#\d+$/, ''),
      snippet: decodeEntities(first(h.highlight?.body) || ''),
      source: first(s.rootItemTitle) ? decodeEntities(first(s.rootItemTitle)) : null,
      source_url: first(s.rootItemUrl) || null,
      modified: first(s.lastModifiedDate) || null,
      file_extension: first(s.fileExtension) || null,
      score: typeof h._score === 'number' ? h._score : null,
    };
  }).filter((r) => /^https?:\/\//i.test(r.url));
}

// identities: the member's addresses, most specific first (company, personal).
async function search({ q, identities = [] }) {
  const cfg = config();
  if (!cfg) return { label: null, results: [] };
  const query = String(q || '').trim().slice(0, 500);
  if (!query) return { label: cfg.label, results: [] };
  try {
    const ids = [...new Set(identities.filter(Boolean).map(String))];
    const principals = await principalsFor(ids, cfg);
    const headers = {};
    if (cfg.username) {
      headers.Authorization = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
    }
    const data = await requestJson(`${cfg.url}/${encodeURIComponent(cfg.index)}/_search`, {
      method: 'POST',
      headers,
      body: buildQuery(query, principals, cfg.maxResults),
      tls: cfg.tls,
      timeoutMs: cfg.timeoutMs,
    });
    return { label: cfg.label, results: mapHits(data) };
  } catch (err) {
    console.error('Enterprise search failed:', err.message);
    return { label: cfg.label, results: [], error: 'unavailable' };
  }
}

module.exports = {
  search,
  isEnabled,
  // exported for tests
  _internal: { decodeEntities, loadConfig, buildQuery, mapHits, principalsFromAclResponse, principalsFor, normalizeFingerprint, aclCache, HL_START, HL_END },
};
