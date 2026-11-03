-- Search Adapters: make the doc sweep's sources configurable from the admin UI.
-- Safe to re-run: every statement is IF NOT EXISTS / guarded.
-- Apply to EACH instance database.
--
-- server/cron/sweepGithubDocs.js reads these two tables at startup — one row per
-- repo, one row per path rule — so adding a repo needs no code change. Nothing
-- is seeded; add sources in Admin Panel → Search Adapters (see the commented
-- example at the end of this file).
--
-- ACCESS CONTROL: search_adapter_rules.visibility decides whether documents
-- matched by a rule are member-visible or admin-only. It is written into
-- github_docs.visibility on every sweep, which is the column /api/search filters
-- on. A wrong value here silently exposes a whole corpus, so the write endpoints
-- are admin-only and changes are recorded in updated_by/updated_at.
--
-- TOKENS ARE NEVER STORED HERE. token_env_var names an environment variable the
-- box's .env is expected to define; the secret itself only ever lives in that
-- file. The UI reports whether the var is set and whether it can read the repo.

CREATE TABLE IF NOT EXISTS search_adapters (
  id INT NOT NULL AUTO_INCREMENT,
  repo VARCHAR(128) NOT NULL COMMENT 'owner/name, e.g. example-org/website',
  branch VARCHAR(128) NOT NULL DEFAULT 'main',
  label VARCHAR(128) DEFAULT NULL COMMENT 'display name in the admin UI; defaults to repo',
  token_env_var VARCHAR(64) NOT NULL DEFAULT 'GITHUB_DOCS_TOKEN'
    COMMENT 'NAME of the .env var holding the PAT — never the token itself',
  site_base VARCHAR(255) DEFAULT NULL
    COMMENT 'base URL for rules whose access_url_mode is a published page, e.g. https://www.example.com',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_swept_at DATETIME DEFAULT NULL,
  last_status ENUM('ok','failed','never') NOT NULL DEFAULT 'never',
  last_error VARCHAR(512) DEFAULT NULL,
  last_doc_count INT DEFAULT NULL COMMENT 'docs indexed for this repo at the last successful sweep',
  updated_by INT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_search_adapters_repo (repo),
  KEY idx_search_adapters_enabled (enabled),
  CONSTRAINT fk_search_adapters_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Repos the GitHub doc sweep indexes into intranet search';

CREATE TABLE IF NOT EXISTS search_adapter_rules (
  id INT NOT NULL AUTO_INCREMENT,
  adapter_id INT NOT NULL,
  path_prefix VARCHAR(255) NOT NULL COMMENT 'indexes files under this path, e.g. docs/ or src/content/help/',
  collection ENUM('internal','help','guide','exec') NOT NULL
    COMMENT 'drives the badge and the destination wording on the container page',
  visibility ENUM('member','admin') NOT NULL DEFAULT 'member'
    COMMENT 'ACCESS CONTROL — copied to github_docs.visibility on every sweep',
  access_url_mode ENUM('github','site_path') NOT NULL DEFAULT 'github'
    COMMENT 'github = link to the blob; site_path = link to <site_base>/<url_path>/<slug>',
  url_path VARCHAR(128) DEFAULT NULL COMMENT 'path segment for site_path mode, e.g. help or docs',
  sort_order INT NOT NULL DEFAULT 0 COMMENT 'rules are tried in this order; first match wins',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_search_adapter_rules_adapter (adapter_id, sort_order),
  CONSTRAINT fk_search_adapter_rules_adapter
    FOREIGN KEY (adapter_id) REFERENCES search_adapters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Path rules per adapter: which files to index, and how to link to them';

-- Example (not applied): index a website repo's docs, help and guides for all
-- members, and an admin-only repo as the 'exec' collection.
--
-- INSERT IGNORE INTO search_adapters (repo, branch, label, token_env_var, site_base, enabled)
-- VALUES
--   ('example-org/website', 'main', 'Website (docs, help, guides)', 'GITHUB_DOCS_TOKEN', 'https://www.example.com', 1),
--   ('example-org/exec',    'main', 'Exec records (admin only)',    'GITHUB_DOCS_TOKEN', NULL, 1);
--
-- INSERT IGNORE INTO search_adapter_rules (adapter_id, path_prefix, collection, visibility, access_url_mode, url_path, sort_order)
-- SELECT a.id, r.path_prefix, r.collection, r.visibility, r.access_url_mode, r.url_path, r.sort_order
-- FROM search_adapters a
-- JOIN (
--   SELECT 'example-org/website' AS repo, 'src/content/help/' AS path_prefix, 'help' AS collection, 'member' AS visibility, 'site_path' AS access_url_mode, 'help' AS url_path, 0 AS sort_order
--   UNION ALL SELECT 'example-org/website', 'src/content/guides/', 'guide',    'member', 'site_path', 'docs', 1
--   UNION ALL SELECT 'example-org/website', 'docs/',               'internal', 'member', 'github',    NULL,   2
--   UNION ALL SELECT 'example-org/exec',    'docs/',               'exec',     'admin',  'github',    NULL,   0
-- ) r ON r.repo = a.repo;
