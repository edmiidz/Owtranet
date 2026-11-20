/**
 * OpenSearch-backed intranet search.
 *
 * Division of labour:
 *   - OpenSearch decides WHAT matches and in which ORDER (stemming, typo
 *     tolerance, prefix matching, relevance ranking).
 *   - MySQL stays the authority on WHO may see it. Every hit is re-loaded from
 *     MySQL with the same permission predicate the MySQL search uses, so a
 *     stale index entry (a post made private a minute ago, a deleted comment)
 *     can only ever cost a result, never leak one.
 *
 * The index also carries permission fields (acl_*) so the top-N a member gets
 * back is already filtered to things they can see; they are a pre-filter, not
 * the security boundary.
 *
 * Indexed kinds: posts, comments, tasks, investments (deliverables), docs
 * (github_docs). People, AI agents and the ledger stay on MySQL search.
 *
 * Kept in sync by server/cron/searchIndexer.js (incremental every
 * SEARCH_INDEX_INTERVAL_SECS, full rebuild + alias swap every
 * SEARCH_INDEX_REBUILD_MINS, which is also what removes deleted rows).
 */
const { client } = require('./opensearchClient');
const { visiblePostsWhere } = require('../postVisibility');

const KINDS = ['posts', 'comments', 'tasks', 'investments', 'docs'];
const RESULT_LIMIT = 20;          // what /api/search returns per kind (same as MySQL)
const FETCH_LIMIT = 30;           // slack for hits MySQL drops on re-check
const MAX_BODY_CHARS = 100000;    // cap per document; long docs only need their start for ranking
const BULK_BATCH = 500;

const aliasName = (prefix) => `${prefix}-content`;
const docId = (kind, id) => `${kind}:${id}`;

const INDEX_BODY = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        // Case- and accent-insensitive ("Zürich" finds "zurich").
        folding: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
      },
    },
  },
  mappings: {
    dynamic: false,
    properties: {
      kind: { type: 'keyword' },
      source_id: { type: 'integer' },
      title: { type: 'text', analyzer: 'folding', fields: { en: { type: 'text', analyzer: 'english' } } },
      body: { type: 'text', analyzer: 'folding', fields: { en: { type: 'text', analyzer: 'english' } } },
      // Secondary text that should match weakly: a comment's post title, a doc's path.
      context: { type: 'text', analyzer: 'folding' },
      acl_all_members: { type: 'boolean' },
      acl_admins: { type: 'boolean' },
      acl_user_ids: { type: 'integer' },
      // MySQL DATETIME strings (indexer pool uses dateStrings) or ISO dates.
      created_at: { type: 'date', format: 'yyyy-MM-dd HH:mm:ss||strict_date_optional_time||epoch_millis' },
      updated_at: { type: 'date', format: 'yyyy-MM-dd HH:mm:ss||strict_date_optional_time||epoch_millis' },
    },
  },
};

// ---------------------------------------------------------------------------
// Permission fields (index-time pre-filter; MySQL re-checks at query time)
// ---------------------------------------------------------------------------

function parseIdList(csv) {
  if (!csv) return [];
  return String(csv).split(',').map(s => parseInt(s, 10)).filter(Number.isInteger);
}

// Mirrors server/lib/postVisibility.js: all_members/NULL → everyone; otherwise
// the author plus explicit grants (author_only simply has no grants).
function postAcl({ visibility, authorId, grantedIds }) {
  if (!visibility || visibility === 'all_members') {
    return { acl_all_members: true, acl_admins: false, acl_user_ids: [] };
  }
  const ids = new Set([authorId, ...(visibility === 'specific_members' ? grantedIds : [])]);
  return { acl_all_members: false, acl_admins: false, acl_user_ids: [...ids].filter(Number.isInteger) };
}

// Only approved, non-payment deliverables are searchable (same as /api/search).
function investmentAcl({ status, type }) {
  const visible = status === 'approved' && type !== 'member_payment';
  return { acl_all_members: visible, acl_admins: false, acl_user_ids: [] };
}

function docAcl({ visibility }) {
  return visibility === 'admin'
    ? { acl_all_members: false, acl_admins: true, acl_user_ids: [] }
    : { acl_all_members: true, acl_admins: false, acl_user_ids: [] };
}

const clip = (s) => (s ? String(s).slice(0, MAX_BODY_CHARS) : '');

// ---------------------------------------------------------------------------
// Loading source rows → index documents
// ---------------------------------------------------------------------------

const GRANTS = (postIdExpr) =>
  `(SELECT GROUP_CONCAT(pv.user_id) FROM post_visibility pv WHERE pv.post_id = ${postIdExpr})`;

// `since` (a MySQL DATETIME from SELECT NOW()) limits the load to rows that
// changed; null loads everything.
const SOURCES = {
  posts: {
    sql: (since) => `
      SELECT p.id, p.user_id, p.title, p.content, p.visibility, p.created_at, p.updated_at,
             ${GRANTS('p.id')} AS granted
        FROM posts p
       ${since ? `WHERE p.updated_at >= ? OR p.id IN (SELECT post_id FROM post_visibility WHERE created_at >= ?)` : ''}`,
    params: (since) => (since ? [since, since] : []),
    toDoc: (r) => ({
      kind: 'posts', source_id: r.id, title: r.title, body: clip(r.content), context: '',
      ...postAcl({ visibility: r.visibility, authorId: r.user_id, grantedIds: parseIdList(r.granted) }),
      created_at: r.created_at, updated_at: r.updated_at,
    }),
  },
  comments: {
    // A comment is visible exactly when its post is, so it inherits the post's ACL
    // and is re-indexed whenever the post (or its grant list) changes.
    sql: (since) => `
      SELECT c.id, c.content, c.created_at, c.updated_at,
             p.title AS post_title, p.user_id AS post_user_id, p.visibility,
             ${GRANTS('c.post_id')} AS granted
        FROM comments c
        JOIN posts p ON p.id = c.post_id
       ${since ? `WHERE c.updated_at >= ? OR p.updated_at >= ?
                     OR c.post_id IN (SELECT post_id FROM post_visibility WHERE created_at >= ?)` : ''}`,
    params: (since) => (since ? [since, since, since] : []),
    toDoc: (r) => ({
      kind: 'comments', source_id: r.id, title: '', body: clip(r.content), context: r.post_title || '',
      ...postAcl({ visibility: r.visibility, authorId: r.post_user_id, grantedIds: parseIdList(r.granted) }),
      created_at: r.created_at, updated_at: r.updated_at,
    }),
  },
  tasks: {
    sql: (since) => `
      SELECT id, title, description, created_at, updated_at FROM tasks
       ${since ? 'WHERE updated_at >= ?' : ''}`,
    params: (since) => (since ? [since] : []),
    toDoc: (r) => ({
      kind: 'tasks', source_id: r.id, title: r.title, body: clip(r.description), context: '',
      acl_all_members: true, acl_admins: false, acl_user_ids: [],
      created_at: r.created_at, updated_at: r.updated_at,
    }),
  },
  investments: {
    sql: (since) => `
      SELECT id, title, content, description, status, type, created_at, updated_at FROM deliverables
       ${since ? 'WHERE updated_at >= ?' : ''}`,
    params: (since) => (since ? [since] : []),
    toDoc: (r) => ({
      kind: 'investments', source_id: r.id, title: r.title,
      body: clip([r.content, r.description].filter(Boolean).join('\n\n')), context: '',
      ...investmentAcl(r),
      created_at: r.created_at, updated_at: r.updated_at,
    }),
  },
  docs: {
    sql: (since) => `
      SELECT id, repo, path, title, summary, body, visibility, created_at, updated_at FROM github_docs
       ${since ? 'WHERE updated_at >= ?' : ''}`,
    params: (since) => (since ? [since] : []),
    toDoc: (r) => ({
      kind: 'docs', source_id: r.id, title: r.title,
      body: clip([r.summary, r.body].filter(Boolean).join('\n\n')), context: `${r.repo}/${r.path}`,
      ...docAcl(r),
      created_at: r.created_at, updated_at: r.updated_at,
    }),
  },
};

async function loadDocs(db, kind, since) {
  const src = SOURCES[kind];
  const [rows] = await db.query(src.sql(since), src.params(since));
  return rows.map(src.toDoc);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function bulkIndex(os, index, docs) {
  let written = 0;
  for (let i = 0; i < docs.length; i += BULK_BATCH) {
    const batch = docs.slice(i, i + BULK_BATCH);
    const ndjson = batch
      .map(d => `${JSON.stringify({ index: { _index: index, _id: docId(d.kind, d.source_id) } })}\n${JSON.stringify(d)}\n`)
      .join('');
    const res = await os.ok('POST', '/_bulk', ndjson, { ndjson: true, timeoutMs: 120000 });
    if (res.errors) {
      const failed = res.items.find(it => it.index && it.index.error);
      throw new Error(`Bulk indexing failed: ${JSON.stringify(failed && failed.index.error)}`);
    }
    written += batch.length;
  }
  return written;
}

async function aliasTargets(os, alias) {
  const res = await os.request('GET', `/_alias/${alias}`);
  if (res.status === 404) return [];
  if (res.status !== 200) throw new Error(`OpenSearch GET /_alias/${alias}: HTTP ${res.status}`);
  return Object.keys(res.data || {});
}

function timestampSuffix(d = new Date()) {
  return d.toISOString().replace(/[-:TZ.]/g, '').slice(0, 17); // yyyymmddhhmmssSSS
}

/**
 * Build a fresh index from MySQL and atomically point the alias at it.
 * Searches keep hitting the old index until the swap, so a rebuild never
 * produces an empty result page. Old and half-built indexes are deleted.
 */
async function rebuild(db, { log = () => {} } = {}) {
  const os = client();
  if (!os) throw new Error('OPENSEARCH_URL is not set');
  const alias = aliasName(os.cfg.prefix);
  const index = `${alias}-${timestampSuffix()}`;

  await os.ok('PUT', `/${index}`, INDEX_BODY, { timeoutMs: 60000 });
  const counts = {};
  try {
    for (const kind of KINDS) {
      const docs = await loadDocs(db, kind, null);
      counts[kind] = await bulkIndex(os, index, docs);
    }
    await os.ok('POST', `/${index}/_refresh`, undefined, { timeoutMs: 60000 });

    const old = await aliasTargets(os, alias);
    const actions = [...old.map(i => ({ remove: { index: i, alias } })), { add: { index, alias } }];
    await os.ok('POST', '/_aliases', { actions }, { timeoutMs: 60000 });
  } catch (err) {
    await os.request('DELETE', `/${index}`).catch(() => {});
    throw err;
  }

  // Drop every other generation (previous one, and any left by a crashed rebuild).
  const cat = await os.ok('GET', `/_cat/indices/${alias}-*?format=json&h=index`);
  for (const { index: name } of cat) {
    if (name !== index) await os.request('DELETE', `/${name}`);
  }
  log(`rebuilt ${index}: ${JSON.stringify(counts)}`);
  return { index, counts };
}

/**
 * Re-index rows changed since `since` (a MySQL DATETIME). Deletions are not
 * seen here; they disappear from results at once (MySQL re-check) and from the
 * index at the next rebuild.
 */
async function syncChanged(db, since, { log = () => {} } = {}) {
  const os = client();
  if (!os) throw new Error('OPENSEARCH_URL is not set');
  const alias = aliasName(os.cfg.prefix);
  if ((await aliasTargets(os, alias)).length === 0) return rebuild(db, { log });

  const counts = {};
  for (const kind of KINDS) {
    const docs = await loadDocs(db, kind, since);
    if (docs.length) counts[kind] = await bulkIndex(os, alias, docs);
  }
  if (Object.keys(counts).length) {
    await os.ok('POST', `/${alias}/_refresh`);
    log(`synced ${JSON.stringify(counts)}`);
  }
  return { counts };
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

function aclFilter(user) {
  const should = [
    { term: { acl_all_members: true } },
    { term: { acl_user_ids: user.userId } },
  ];
  if (user.role === 'admin') should.push({ term: { acl_admins: true } });
  return { bool: { should, minimum_should_match: 1 } };
}

function buildKindQuery(kind, q, user, size = FETCH_LIMIT) {
  return {
    size,
    _source: false,
    track_total_hits: false,
    query: {
      bool: {
        should: [
          // Whole words, stemmed ("priced" ↔ "pricing"), one typo tolerated per short word.
          {
            multi_match: {
              query: q,
              fields: ['title^3', 'title.en^3', 'body', 'body.en', 'context^0.5'],
              type: 'best_fields',
              fuzziness: 'AUTO',
              prefix_length: 1,
              max_expansions: 20,
            },
          },
          // Search-as-you-type: "pric" finds "pricing".
          { multi_match: { query: q, fields: ['title^4', 'body'], type: 'phrase_prefix', max_expansions: 20 } },
          // Exact phrase in the title wins.
          { match_phrase: { title: { query: q, boost: 6 } } },
        ],
        minimum_should_match: 1,
        filter: [{ term: { kind } }, aclFilter(user)],
      },
    },
  };
}

// Re-load hits from MySQL in the exact row shape the MySQL search returns, with
// the same permission predicates. Order and relevance_score come from OpenSearch.
const HYDRATE = {
  posts: (ids, user) => {
    const vis = visiblePostsWhere('p', user.userId);
    return {
      sql: `SELECT p.*, u.name as author_name, u.github_username
              FROM posts p JOIN users u ON p.user_id = u.id
             WHERE p.id IN (${ids.map(() => '?').join(',')}) AND ${vis.sql}`,
      params: [...ids, ...vis.params],
    };
  },
  comments: (ids, user) => {
    const vis = visiblePostsWhere('p', user.userId);
    return {
      sql: `SELECT c.*, p.title as post_title, p.slug as post_slug, u.name as author_name, u.github_username
              FROM comments c JOIN posts p ON c.post_id = p.id JOIN users u ON c.user_id = u.id
             WHERE c.id IN (${ids.map(() => '?').join(',')}) AND ${vis.sql}`,
      params: [...ids, ...vis.params],
    };
  },
  investments: (ids) => ({
    sql: `SELECT d.id, d.title, d.content, d.amount, d.original_amount,
                 d.original_currency, d.exchange_rate, d.risk_multiplier,
                 d.status, d.deliverable_date, d.created_at, d.investment_category,
                 (d.original_amount * d.exchange_rate * d.risk_multiplier) as theoretical_value_usd,
                 u.name as user_name, u.github_username, n.name as nominee_name
            FROM deliverables d
            JOIN users u ON d.user_id = u.id
            LEFT JOIN users n ON d.nominee_user_id = n.id
           WHERE d.id IN (${ids.map(() => '?').join(',')})
             AND d.status = 'approved' AND d.type != 'member_payment'`,
    params: ids,
  }),
  tasks: (ids) => ({
    sql: `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
                 t.created_by, t.assigned_to, t.created_at, t.updated_at,
                 creator.name as creator_name, creator.intranet_username as creator_username,
                 assignee.name as assignee_name, assignee.intranet_username as assignee_username
            FROM tasks t
            LEFT JOIN users creator ON t.created_by = creator.id
            LEFT JOIN users assignee ON t.assigned_to = assignee.id
           WHERE t.id IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  }),
  // `body` is deliberately not selected (see /api/search): indexed, never shipped.
  docs: (ids, user) => ({
    sql: `SELECT id, repo, path, collection, title, summary, access_url, github_url,
                 word_count, doc_updated_at, updated_at
            FROM github_docs
           WHERE id IN (${ids.map(() => '?').join(',')})
             ${user.role === 'admin' ? '' : "AND visibility = 'member'"}`,
    params: ids,
  }),
};

async function hydrate(db, kind, hits, user) {
  if (!hits.length) return [];
  const ids = hits.map(h => h.id);
  const { sql, params } = HYDRATE[kind](ids, user);
  const [rows] = await db.execute(sql, params);
  const byId = new Map(rows.map(r => [r.id, r]));
  const out = [];
  for (const h of hits) {
    const row = byId.get(h.id);
    if (row) out.push({ ...row, relevance_score: h.score });
    if (out.length >= RESULT_LIMIT) break;
  }
  return out;
}

function enabled() {
  return Boolean(client());
}

/**
 * Search the requested kinds. Returns { posts: [...], ... } for those kinds, or
 * null when OpenSearch is not configured. Throws on any OpenSearch failure so
 * the caller can fall back to MySQL.
 */
async function search(db, user, q, kinds) {
  const os = client();
  if (!os) return null;
  const wanted = kinds.filter(k => KINDS.includes(k));
  if (!wanted.length) return {};
  const query = String(q).slice(0, 200);
  const alias = aliasName(os.cfg.prefix);

  const ndjson = wanted
    .map(k => `${JSON.stringify({ index: alias })}\n${JSON.stringify(buildKindQuery(k, query, user))}\n`)
    .join('');
  const res = await os.ok('POST', '/_msearch', ndjson, { ndjson: true });

  const results = {};
  for (let i = 0; i < wanted.length; i++) {
    const r = res.responses[i];
    if (r.error) throw new Error(`OpenSearch ${wanted[i]} query failed: ${r.error.reason || r.error.type}`);
    const hits = r.hits.hits.map(h => ({ id: h.fields?.source_id?.[0] ?? parseInt(h._id.split(':')[1], 10), score: h._score }));
    results[wanted[i]] = await hydrate(db, wanted[i], hits, user);
  }
  return results;
}

/** Admin status: which index the alias points at and documents per kind. */
async function status() {
  const os = client();
  if (!os) return { enabled: false };
  const alias = aliasName(os.cfg.prefix);
  const targets = await aliasTargets(os, alias);
  if (!targets.length) return { enabled: true, alias, index: null, counts: {} };
  const res = await os.ok('POST', `/${alias}/_search`, {
    size: 0,
    aggs: { kinds: { terms: { field: 'kind', size: 20 } } },
  });
  const counts = Object.fromEntries(res.aggregations.kinds.buckets.map(b => [b.key, b.doc_count]));
  return { enabled: true, alias, index: targets[0], counts };
}

module.exports = {
  KINDS,
  enabled,
  search,
  rebuild,
  syncChanged,
  status,
  // exported for tests
  postAcl,
  investmentAcl,
  docAcl,
  buildKindQuery,
  aclFilter,
  INDEX_BODY,
};
