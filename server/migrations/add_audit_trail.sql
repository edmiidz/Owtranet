-- Audit trail: audit_log (changes) + access_log (reads & searches).
-- Write-up: docs/AUDIT_TRAIL.md. Shared writer: server/lib/audit.js.
--
-- audit_log  — every change: role changes, content create/edit/delete, e-sign
--              events, admin actions. Low volume, kept indefinitely, append-only
--              by convention (nothing in the app UPDATEs or DELETEs it).
-- access_log — every read of a tracked resource and every search. High volume,
--              rolling retention: server/cron/archiveAuditLogs.js exports old rows
--              to gzipped JSONL and deletes them.
--
-- Neither table has foreign keys on purpose: an audit row must outlive the user
-- or record it points at (activity_log's ON DELETE SET NULL erased the actor
-- when a user was deleted). actor_name snapshots who it was.
--
-- All timestamps are UTC (DATETIME(3), filled with UTC_TIMESTAMP(3)).
--
-- Apply BEFORE deploying the server that writes these tables (deploy.sh runs
-- scripts/check-schema.js, which names this file if it is missing):
--   mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" < server/migrations/add_audit_trail.sql
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, and the backfill skips rows it
-- already copied.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  occurred_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)) COMMENT 'UTC',
  actor_user_id INT NULL COMMENT 'users.id of who did it (NULL = system / anonymous)',
  actor_name VARCHAR(255) NULL COMMENT 'snapshot, survives user deletion',
  actor_type ENUM('user','api_token','ai_agent','system') NOT NULL DEFAULT 'user',
  api_token_id INT NULL COMMENT 'api_tokens.id when the change came through /api/v1',
  action VARCHAR(64) NOT NULL COMMENT 'dotted verb, e.g. post.update, role.change, agreement.sign',
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(64) NULL,
  changes JSON NULL COMMENT '{field: {old, new}} — sensitive fields are recorded as changed, never valued',
  reason VARCHAR(500) NULL,
  metadata JSON NULL,
  route VARCHAR(255) NULL COMMENT 'METHOD /express/route/:pattern',
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_audit_entity (entity_type, entity_id, occurred_at),
  KEY idx_audit_actor (actor_user_id, occurred_at),
  KEY idx_audit_action (action, occurred_at),
  KEY idx_audit_occurred (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Append-only change trail (role changes, content edits, e-sign)';

CREATE TABLE IF NOT EXISTS access_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  occurred_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)) COMMENT 'UTC',
  user_id INT NULL,
  actor_type ENUM('user','api_token','ai_agent','system','anonymous') NOT NULL DEFAULT 'user',
  api_token_id INT NULL,
  event ENUM('read','search') NOT NULL,
  resource_type VARCHAR(50) NOT NULL COMMENT 'post, deliverable, profile, conversation, email… or the search scope',
  resource_id VARCHAR(255) NULL,
  query VARCHAR(500) NULL COMMENT 'search text',
  filters JSON NULL COMMENT 'other search parameters',
  route VARCHAR(255) NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_access_user (user_id, occurred_at),
  KEY idx_access_resource (resource_type, resource_id, occurred_at),
  KEY idx_access_event (event, occurred_at),
  KEY idx_access_occurred (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Read and search events; rolling retention, archived by server/cron/archiveAuditLogs.js';

-- Carry the existing activity_log history over so the audit trail starts complete.
-- Idempotent: a row is copied once (metadata.activity_log_id marks it).
INSERT INTO audit_log (occurred_at, actor_user_id, actor_name, actor_type, action, entity_type, entity_id,
                       changes, reason, metadata, ip_address, user_agent)
SELECT a.created_at,
       a.user_id,
       u.name,
       'user',
       CASE a.action WHEN 'ROLE_CHANGE' THEN 'role.change' ELSE LOWER(a.action) END,
       a.entity_type,
       CAST(a.entity_id AS CHAR),
       CASE WHEN a.action = 'ROLE_CHANGE'
            THEN JSON_OBJECT('role', JSON_OBJECT('old', JSON_EXTRACT(a.details, '$.old_role'),
                                                 'new', JSON_EXTRACT(a.details, '$.new_role')))
            ELSE NULL END,
       LEFT(JSON_UNQUOTE(JSON_EXTRACT(a.details, '$.reason')), 500),
       JSON_OBJECT('activity_log_id', a.id, 'details', a.details),
       a.ip_address,
       LEFT(a.user_agent, 255)
FROM activity_log a
LEFT JOIN users u ON u.id = a.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM audit_log x
  WHERE JSON_EXTRACT(x.metadata, '$.activity_log_id') = a.id
)
ORDER BY a.id;
