/**
 * Audit trail — the one writer for audit_log (changes) and access_log (reads
 * and searches). Write-up: docs/AUDIT_TRAIL.md; schema:
 * server/migrations/add_audit_trail.sql.
 *
 *   const audit = createAudit({ getDb: () => db });
 *   app.use('/api', audit.middleware());          // before the routes
 *   await audit.change(req, { action: 'post.update', entityType: 'post', entityId: id,
 *                             changes: audit.diff(before, after, ['title', 'content']) });
 *
 * Changes. A handler that knows the before/after calls audit.change(); that row
 * carries old/new values. Every other successful POST/PUT/PATCH/DELETE under
 * /api is still recorded by the middleware as `api.create|update|delete` with
 * the route, params and the *names* of the body fields (never their values, so
 * passwords and message bodies stay out). So nothing that changes data goes
 * unlogged, and the important paths say exactly what changed.
 *
 * Reads and searches. The middleware matches successful GETs against
 * ACCESS_RULES (keyed by Express route pattern) and queues one access_log row.
 * Rows are batched (every FLUSH_MS or FLUSH_ROWS) so a page view never waits on
 * the insert. Repeat reads of the same resource by the same user inside
 * READ_DEDUPE_SECONDS are dropped — the DM and channel screens poll every few
 * seconds — and type-ahead searches collapse to the last query typed.
 *
 * Logging never throws and never fails a request.
 */

const READ_DEDUPE_SECONDS = parseInt(process.env.AUDIT_READ_DEDUPE_SECONDS, 10) || 300;
const SEARCH_COLLAPSE_MS = 10 * 1000;
const FLUSH_MS = 5000;
const FLUSH_ROWS = 200;
const MAX_QUEUE = 5000;

// Body fields whose values must never reach the audit trail. A diff on one of
// these records { changed: true } instead of old/new.
const SENSITIVE_FIELDS = new Set([
  'password', 'password_hash', 'new_password', 'current_password', 'token', 'api_token',
  'sin', 'sin_encrypted', 'bank_account', 'transit_number', 'institution_number',
  'digital_signature', 'quiz_answer', 'secret'
]);

// Successful writes that are not changes worth an audit row: read receipts,
// lookups done over POST, playback progress, push-token registration.
const WRITE_EXCLUDE = new Set([
  'PUT /api/messages/conversations/:conversationId/read',
  'PUT /api/group-chat/:groupId/read',
  'PUT /api/notifications/:id/read',
  'PUT /api/notifications/mark-all-read',
  'PUT /api/webmail/emails/:uid/read',
  'POST /api/wiki-links/lookup',
  'POST /api/email/check-availability',
  'POST /api/auth/validate-reset-token',
  'POST /api/radio/segments/:id/listened',
  'POST /api/radio/listens/reset',
  'POST /api/mobile/devices',
  'DELETE /api/mobile/devices/:token',
  'POST /api/mobile/ai/session'
]);

// GET routes that are reads of one resource ({ type, id: param name }) or
// searches ({ search: scope, q: query param names }). Keyed by
// `${req.baseUrl}${req.route.path}` — keep in step with the routes in server.js.
const ACCESS_RULES = {
  '/api/posts/:slug': { type: 'post', id: 'slug' },
  '/api/posts/id/:id': { type: 'post', id: 'id' },
  '/api/v1/forum/posts/:id': { type: 'post', id: 'id' },
  // Post version history: reading an old revision is a read of the post.
  '/api/posts/:id/revisions': { type: 'post', id: 'id' },
  '/api/posts/:id/revisions/:n': { type: 'post', id: 'id' },
  '/api/v1/forum/posts/:id/revisions': { type: 'post', id: 'id' },
  '/api/v1/forum/posts/:id/revisions/:n': { type: 'post', id: 'id' },
  '/api/radio/posts/by-slug/:slug': { type: 'post', id: 'slug' },
  '/api/radio/segments/:id': { type: 'radio_segment', id: 'id' },
  '/api/v1/comments/:id': { type: 'comment', id: 'id' },
  '/api/deliverables/:id': { type: 'deliverable', id: 'id' },
  '/api/v1/deliverables/:id': { type: 'deliverable', id: 'id' },
  '/api/deliverables/:id/adjustments': { type: 'deliverable', id: 'id' },
  '/api/deliverables/documents/:filename': { type: 'deliverable_document', id: 'filename' },
  '/api/users/:username': { type: 'profile', id: 'username' },
  '/api/v1/members/:id': { type: 'profile', id: 'id' },
  '/api/messages/conversations/:conversationId': { type: 'conversation', id: 'conversationId' },
  '/api/v1/messages/with/:member_id': { type: 'conversation_with', id: 'member_id' },
  '/api/group-chat/:groupId/messages': { type: 'group_channel', id: 'groupId' },
  '/api/v1/group-chat/:group/messages': { type: 'group_channel', id: 'group' },
  '/api/webmail/emails/:uid': { type: 'email', id: 'uid' },
  '/api/webmail/emails/:uid/attachments/:index': { type: 'email_attachment', id: 'uid' },
  '/api/github-docs/:id': { type: 'github_doc', id: 'id' },
  '/api/tasks/:id': { type: 'task', id: 'id' },
  '/api/v1/tasks/:id': { type: 'task', id: 'id' },
  '/api/ledger/:id': { type: 'ledger_entry', id: 'id' },
  '/api/agreements/user/:userId': { type: 'user_agreements', id: 'userId' },
  '/api/agreements/assignment/:assignmentId': { type: 'agreement_assignment', id: 'assignmentId' },
  '/api/admin/agreements/:agreementId': { type: 'user_agreement', id: 'agreementId' },
  '/api/admin/agreements/versions/:versionId/signatures': { type: 'agreement_signatures', id: 'versionId' },
  '/api/admin/agreements/versions/:versionId/assignments': { type: 'agreement_assignments', id: 'versionId' },
  '/api/users/me/payroll-details': { type: 'payroll_details', id: null },
  '/api/admin/users/:userId/payroll-details': { type: 'payroll_details', id: 'userId' },
  '/api/admin/audit': { type: 'audit_log', id: null },
  '/api/admin/access-log': { type: 'access_log', id: null },

  '/api/search': { search: 'global', q: ['q'] },
  '/api/users/search': { search: 'users', q: ['q'] },
  '/api/webmail/search': { search: 'webmail', q: ['q'] },
  '/api/v1/forum/posts': { search: 'posts', q: ['q'] },
  '/api/v1/members': { search: 'members', q: ['q'] },
  '/api/tasks': { search: 'tasks', q: ['search'] },
  '/api/v1/tasks': { search: 'tasks', q: ['q'] },
  '/api/ledger': { search: 'ledger', q: ['search'] }
};

const VERB = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

// Generic rows take their entity_type from the first URL segment ("posts",
// "users", "deliverables"); the handlers that call change() use the singular
// ("post", "user", "deliverable"). Singularise so ?entity_type=post finds both.
// Leaves -ss / -us / -is words ("access", "status", "analysis") alone.
function singular(segment) {
  return segment && /[^siu]s$/.test(segment) ? segment.slice(0, -1) : segment;
}

function clip(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function json(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

// The id a create handler returned ({ postId }, { id }, { task: { id } }…), so
// a generic api.create row still points at the record it made.
function idFromBody(body) {
  if (!body || typeof body !== 'object') return null;
  for (const [k, v] of Object.entries(body)) {
    if ((k === 'id' || k === 'insertId' || /^[a-z]+Id$/.test(k) || /^[a-z]+_id$/.test(k))
        && (typeof v === 'number' || (typeof v === 'string' && v.length <= 64))) return v;
  }
  for (const v of Object.values(body)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (typeof v.id === 'number' || typeof v.id === 'string')) return v.id;
  }
  return null;
}

function routeKey(req) {
  return req.route ? `${req.baseUrl || ''}${req.route.path}` : null;
}

/** Who did it, from the request the auth middleware decorated. */
function actorFromReq(req) {
  const userId = req && req.user ? req.user.userId || null : null;
  if (req && req.apiToken) {
    return {
      userId,
      type: 'api_token',
      apiTokenId: req.apiToken.id || null,
      tokenName: req.apiToken.name || req.apiToken.token_name || null,
      actingUser: !!req.actingUser
    };
  }
  return { userId, type: userId ? 'user' : 'anonymous', apiTokenId: null };
}

function clientIp(req) {
  return clip(req && (req.ip || (req.socket && req.socket.remoteAddress)), 45);
}

function userAgent(req) {
  return clip(req && req.headers && req.headers['user-agent'], 255);
}

/**
 * Field-level diff for audit_log.changes. Returns null when nothing changed.
 * Values are compared loosely as strings so 5 vs '5' and Date vs DATETIME
 * string do not read as edits.
 */
function diff(before, after, fields) {
  const changes = {};
  const keys = fields || Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  for (const key of keys) {
    if (!after || !(key in after)) continue; // field not part of this update
    const oldV = before ? before[key] : undefined;
    const newV = after[key];
    const norm = (v) => (v === undefined || v === null ? null
      : v instanceof Date ? v.toISOString()
      : typeof v === 'object' ? JSON.stringify(v) : String(v));
    if (norm(oldV) === norm(newV)) continue;
    changes[key] = SENSITIVE_FIELDS.has(key)
      ? { changed: true }
      : { old: oldV === undefined ? null : oldV, new: newV === undefined ? null : newV };
  }
  return Object.keys(changes).length ? changes : null;
}

function createAudit({ getDb, logger = console }) {
  const nameCache = new Map(); // userId -> name (names rarely change; refreshed on restart)
  const recentReads = new Map(); // `${user}|${type}|${id}` -> ms
  let queue = [];
  let dropped = 0;
  let timer = null;

  async function actorName(userId, req) {
    if (!userId) return null;
    if (req && req.user && req.user.name) return clip(req.user.name, 255);
    if (nameCache.has(userId)) return nameCache.get(userId);
    try {
      const [rows] = await getDb().execute('SELECT name FROM users WHERE id = ?', [userId]);
      const name = rows.length ? clip(rows[0].name, 255) : null;
      if (nameCache.size > 2000) nameCache.clear();
      nameCache.set(userId, name);
      return name;
    } catch (_) {
      return null;
    }
  }

  /**
   * Record a change in audit_log. `actor` overrides the request's actor, e.g.
   * { type: 'system' } for a cron, or { userId } when there is no request.
   * Marks the request so the middleware does not add a generic row as well.
   */
  async function change(req, { action, entityType = null, entityId = null, changes = null,
    reason = null, metadata = null, actor = null }) {
    if (req) req.auditRecorded = true;
    try {
      const a = { ...actorFromReq(req), ...(actor || {}) };
      if (a.type === 'anonymous') a.type = a.userId ? 'user' : 'system';
      const meta = { ...(metadata || {}) };
      if (a.actingUser) meta.acting_user = true;
      if (a.tokenName) meta.api_token_name = a.tokenName;
      const route = req && routeKey(req) ? `${req.method} ${routeKey(req)}` : null;
      await getDb().execute(
        `INSERT INTO audit_log (actor_user_id, actor_name, actor_type, api_token_id, action,
           entity_type, entity_id, changes, reason, metadata, route, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.userId || null, await actorName(a.userId, req), a.type, a.apiTokenId || null,
          clip(action, 64), clip(entityType, 50), clip(entityId, 64),
          json(changes), clip(reason, 500), Object.keys(meta).length ? json(meta) : null,
          clip(route, 255), clientIp(req), userAgent(req)
        ]
      );
    } catch (error) {
      logger.error('Audit log write error:', error.message);
    }
  }

  // ---- access_log batching -------------------------------------------------

  function enqueue(row) {
    if (row.event === 'search') {
      // Type-ahead: a query that extends (or trims) the same user's previous
      // query on the same scope within a few seconds replaces it.
      for (let i = queue.length - 1; i >= 0; i--) {
        const prev = queue[i];
        if (prev.event !== 'search' || prev.user_id !== row.user_id || prev.resource_type !== row.resource_type) continue;
        if (row.ts - prev.ts > SEARCH_COLLAPSE_MS) break;
        const a = (prev.query || '').toLowerCase();
        const b = (row.query || '').toLowerCase();
        if (b.startsWith(a) || a.startsWith(b)) { queue.splice(i, 1); }
        break;
      }
    }
    if (queue.length >= MAX_QUEUE) { queue.shift(); dropped++; }
    queue.push(row);
    if (queue.length >= FLUSH_ROWS) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    if (dropped) {
      logger.error(`Access log: dropped ${dropped} rows (queue full)`);
      dropped = 0;
    }
    try {
      await getDb().query(
        `INSERT INTO access_log (occurred_at, user_id, actor_type, api_token_id, event, resource_type,
           resource_id, query, filters, route, ip_address, user_agent) VALUES ?`,
        [batch.map((r) => [
          new Date(r.ts).toISOString().slice(0, 23).replace('T', ' '),
          r.user_id, r.actor_type, r.api_token_id, r.event, r.resource_type,
          r.resource_id, r.query, r.filters, r.route, r.ip_address, r.user_agent
        ])]
      );
    } catch (error) {
      logger.error('Access log write error:', error.message);
    }
  }

  function recordAccess(req, rule, key) {
    const actor = actorFromReq(req);
    const now = Date.now();
    const base = {
      ts: now, user_id: actor.userId, actor_type: actor.type, api_token_id: actor.apiTokenId,
      route: clip(key, 255), ip_address: clientIp(req), user_agent: userAgent(req)
    };

    if (rule.search) {
      const param = rule.q.find((p) => typeof req.query[p] === 'string' && req.query[p].trim() !== '');
      if (!param) return; // a plain list view, not a search
      const filters = { ...req.query };
      delete filters[param];
      delete filters.acting_user_id;
      enqueue({
        ...base, event: 'search', resource_type: rule.search, resource_id: null,
        query: clip(req.query[param].trim(), 500),
        filters: Object.keys(filters).length ? json(filters) : null
      });
      return;
    }

    const id = rule.id ? clip(req.params[rule.id], 255) : null;
    const dedupeKey = `${actor.userId || base.ip_address}|${rule.type}|${id}`;
    const last = recentReads.get(dedupeKey);
    if (last && now - last < READ_DEDUPE_SECONDS * 1000) return;
    recentReads.set(dedupeKey, now);
    if (recentReads.size > 10000) {
      for (const [k, t] of recentReads) if (now - t >= READ_DEDUPE_SECONDS * 1000) recentReads.delete(k);
    }
    enqueue({ ...base, event: 'read', resource_type: rule.type, resource_id: id, query: null, filters: null });
  }

  /** Mount on /api before the routes; it acts when each response finishes. */
  function middleware() {
    return (req, res, next) => {
      if (VERB[req.method]) {
        const json = res.json.bind(res);
        res.json = (body) => { res.locals.auditResponse = body; return json(body); };
      }
      res.on('finish', () => {
        try {
          if (res.statusCode >= 400) return;
          const key = routeKey(req);
          if (!key) return;
          if (req.method === 'GET') {
            const rule = ACCESS_RULES[key];
            if (rule) recordAccess(req, rule, key);
            return;
          }
          const verb = VERB[req.method];
          if (!verb || req.auditRecorded || WRITE_EXCLUDE.has(`${req.method} ${key}`)) return;
          const segments = key.split('/').filter((s) => s && s !== 'api' && s !== 'v1' && !s.startsWith(':'));
          const params = { ...req.params };
          const firstParam = Object.keys(params)[0];
          const bodyFields = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
            ? Object.keys(req.body) : [];
          change(req, {
            action: `api.${verb}`,
            entityType: singular(segments[0] === 'admin' && segments[1] ? segments[1] : segments[0]) || null,
            entityId: firstParam ? params[firstParam] : idFromBody(res.locals.auditResponse),
            metadata: {
              ...(Object.keys(params).length ? { params } : {}),
              ...(bodyFields.length ? { fields: bodyFields } : {}),
              status: res.statusCode
            }
          });
        } catch (error) {
          logger.error('Audit middleware error:', error.message);
        }
      });
      next();
    };
  }

  return { change, diff, middleware, flush, actorFromReq };
}

module.exports = { createAudit, diff, ACCESS_RULES, WRITE_EXCLUDE, SENSITIVE_FIELDS };
