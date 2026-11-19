# Audit trail

Two tables, one writer (`server/lib/audit.js`), one archive job.

| Table | What goes in | Volume | Retention |
|---|---|---|---|
| `audit_log` | Every **change**: role changes, content create/edit/delete, e-sign events, admin actions | low (tens/day) | kept indefinitely (`AUDIT_LOG_RETENTION_DAYS=0`) |
| `access_log` | Every **read** of a tracked resource and every **search** | high (hundreds–thousands/day) | rolling, default 180 days, then archived |

Schema + backfill: `server/migrations/add_audit_trail.sql`. Apply it **before** deploying the
server that writes these tables; `deploy.sh` stops if it is missing.

## Why two tables, and why not just `activity_log`

- **Different lifecycles.** Changes are evidence and are kept forever; reads and searches are
  10–100× the volume and only need a rolling window. In one table you cannot purge reads
  without risking the change history, and every index carries both.
- **Different write paths.** Change rows are written synchronously with the change. Read rows
  are batched in memory and flushed every 5 s so a page view never waits on an insert.
- **`activity_log` was the wrong shape.** Its `user_id` FK is `ON DELETE SET NULL`, so deleting a
  user erased who did what; it had no actor type (person vs API token vs system), no old/new
  values, and `created_at` was session-local time. The migration copies its rows into
  `audit_log` (marked `metadata.activity_log_id`), and all writers now use `audit_log`.
  `activity_log` stays in place, unwritten, until we drop it.

Each row says who, what record, old/new values, why, from which IP and user agent. The
old/new values live in one `changes` JSON object rather than a column per field, so one
edit is one row.

## `audit_log`

| Column | Notes |
|---|---|
| `occurred_at` | UTC, ms precision |
| `actor_user_id`, `actor_name` | `actor_name` is a snapshot and survives user deletion; no FKs on purpose |
| `actor_type` | `user` · `api_token` · `ai_agent` · `system` |
| `api_token_id` | set for `/api/v1/*` calls; `metadata.acting_user=true` when an integration token acted for a member |
| `action` | dotted verb: `role.change`, `post.update`, `post.delete`, `comment.update`, `comment.delete`, `deliverable.update`, `deliverable.approved`, `deliverable.adjust`, `deliverable.delete`, `profile.update`, `user.hourly_rate`, `user.delete`, `agreement.sign`, `agreement.request`, `agreement.assign`, `agreement.unassign`, `agreement_version.activate`/`deactivate` — and the generic `api.create` / `api.update` / `api.delete` |
| `entity_type`, `entity_id` | what was changed. Generic rows use the singular of the first URL segment and its first route parameter, so `POST /api/posts/:postId/comments` is recorded against `post` / its id |
| `changes` | `{field: {old, new}}`; sensitive fields (passwords, SIN/bank, signature, quiz answer…) are recorded as `{changed: true}` only |
| `reason`, `metadata` | free text / JSON; deletes keep a `metadata.snapshot` of the record |
| `route`, `ip_address`, `user_agent` | `route` is `METHOD /express/:pattern` |

**Coverage is complete by construction.** The middleware records every successful
(`< 400`) `POST`/`PUT`/`PATCH`/`DELETE` as `api.create|update|delete`, with route params, the
id returned by the handler (`{ postId }`, `{ id }`…), and the *names* of the body fields — never
their values. Handlers that know before/after call `audit.change()` instead, which carries the
old/new values and suppresses the generic row. A handful of writes that are not changes
(read receipts, POST lookups, radio playback progress, push-token registration) are excluded
in `WRITE_EXCLUDE`.

To give a route exact old/new values:

```js
await audit.change(req, {
  action: 'task.update', entityType: 'task', entityId: id,
  changes: audit.diff(before, after, ['title', 'status', 'assigned_to']),
  reason: req.body.reason
});
```

Outside a request (cron, script) pass `null` for `req` and an `actor`, e.g. `{ type: 'system' }`.

## `access_log`

One row per read of a tracked resource or per search, from `ACCESS_RULES` in
`server/lib/audit.js` (keyed by Express route pattern — **add a rule when you ship a new
detail or search endpoint**). Tracked today: posts (web, v1, radio), comments, deliverables
and their documents, profiles, DM conversations, group channels, webmail messages and
attachments, GitHub docs, tasks, ledger entries, agreements/signatures, payroll details,
and the audit endpoints themselves; searches on global search, user search (the @-mention
type-ahead), webmail, v1 posts/members/tasks, tasks and ledger.

Noise control:
- Repeat reads of the same resource by the same user within `AUDIT_READ_DEDUPE_SECONDS`
  (default 300) are dropped — the DM and channel screens poll every few seconds.
- Type-ahead: a search that extends or trims the same user's previous query on the same
  scope within 10 s replaces it, so `p`, `pa`, `pay` → one row `pay`.
- Only `2xx/3xx` responses are logged.

Gaps: files under `/uploads` are served by Nginx directly and never reach Node, so
downloads of forum attachments and avatars are not in `access_log`. Up to 5 s of queued
read rows can be lost on a crash (they are flushed on SIGTERM/SIGINT).

## Querying

Admin only, newest first, paged with `before=<last id>`; times are UTC.

```bash
GET /api/admin/audit?entity_type=post&entity_id=42
GET /api/admin/audit?actor=7&action=role.*&from=2026-10-01&to=2026-11-01
GET /api/admin/access-log?user=7&event=search
GET /api/admin/access-log?resource_type=payroll_details
```

`GET /api/admin/activity` (the old endpoint) now returns the latest 100 `audit_log` rows.

## Archiving

`server/cron/archiveAuditLogs.js` moves rows past retention into gzipped JSONL, one file per
table per UTC month (`server/data/archive/<table>/<table>-YYYY-MM.jsonl.gz`), deleting only
after the batch is written and fsynced. Dry-run by default.

```bash
node server/cron/archiveAuditLogs.js                      # what would move
node server/cron/archiveAuditLogs.js --apply              # archive + delete
node server/cron/archiveAuditLogs.js --apply --s3 s3://<bucket>/owtranet-audit/<instance>
```

Env: `ACCESS_LOG_RETENTION_DAYS` (180), `AUDIT_LOG_RETENTION_DAYS` (0 = never),
`AUDIT_ARCHIVE_DIR`. Not scheduled by default: for a small team `access_log` takes months to
matter. When it does, add a monthly PM2 cron entry to your `ecosystem.config.js` and point
`--s3` at a bucket so the archive leaves the server's disk.
If volume ever gets serious, switching `access_log` to monthly `RANGE` partitions turns
archiving into `DROP PARTITION`; the table has no FKs, so that is possible.

## Not done (yet)

- **Tamper-evidence.** The app never updates or deletes `audit_log`, but its database user can.
  Options: a separate MySQL user with `INSERT, SELECT` only on `audit_log` for the writer, or a
  hash chain column. Triggers that block `UPDATE`/`DELETE` need `log_bin_trust_function_creators`
  on RDS.
- **Admin UI.** The API is there; there is no page yet.
- **Login / logout events** are captured only as generic `api.create` rows on the auth routes;
  failed logins are not logged (they return 4xx).
