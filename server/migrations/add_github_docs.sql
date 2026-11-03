-- GitHub doc index (searchable "container" entries)
-- Safe to re-run: every statement is IF NOT EXISTS.
-- Apply to EACH instance database.
--
-- These rows are NOT intranet content. Each one is a stub that exists so a
-- member searching the intranet can FIND a document that actually lives in a
-- GitHub repo (or on the public help site). The intranet shows the title, an
-- excerpt and an "Access now" button; the body text is stored only so full-text
-- search can match words buried inside the document.
--
-- Populated by server/cron/sweepGithubDocs.js (nightly via PM2). Nothing here is
-- hand-edited: the sweep is the single writer and reconciles the table to match
-- whatever is on each configured repo's default branch.
--
-- ACCESS CONTROL: `visibility` is the only thing standing between a non-admin
-- and the admin-only 'exec' corpus (e.g. legal or executive records). Every read path MUST filter on it — see the `visibility='member'`
-- predicate in /api/search and /api/github-docs/:id in server.js. Reaching the
-- linked document still requires GitHub access to a private repo, but the
-- indexed title/body live here in plaintext, so the filter is load-bearing.

CREATE TABLE IF NOT EXISTS github_docs (
  id INT NOT NULL AUTO_INCREMENT,
  repo VARCHAR(128) NOT NULL COMMENT 'owner/name, e.g. example-org/website',
  path VARCHAR(512) NOT NULL COMMENT 'path within the repo, e.g. docs/internal/features/onboarding.md',
  collection ENUM('internal','help','guide','exec') NOT NULL
    COMMENT 'internal=docs/** (GitHub link); help=/help/<slug>; guide=/docs/<slug>; exec=admin-only corpus',
  visibility ENUM('member','admin') NOT NULL DEFAULT 'member'
    COMMENT 'member=any signed-in user; admin=role admin only. Filter on this in EVERY read path.',
  title VARCHAR(512) NOT NULL COMMENT 'frontmatter title, else first H1, else prettified filename',
  summary TEXT DEFAULT NULL COMMENT 'short excerpt shown on the container page',
  body MEDIUMTEXT DEFAULT NULL COMMENT 'plain-text body, indexed for search only; never rendered',
  access_url VARCHAR(1024) NOT NULL COMMENT 'where "Access now" sends the member',
  github_url VARCHAR(1024) NOT NULL COMMENT 'always the github.com blob URL (secondary link)',
  blob_sha CHAR(40) NOT NULL COMMENT 'git blob sha; unchanged sha = skip re-fetch',
  word_count INT DEFAULT NULL,
  doc_updated_at DATETIME DEFAULT NULL COMMENT 'last commit touching this file, when known',
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    COMMENT 'set every sweep; rows not seen in the latest sweep of that repo are deleted',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_github_docs_repo_path (repo, path),
  KEY idx_github_docs_collection (collection),
  KEY idx_github_docs_visibility (visibility),
  KEY idx_github_docs_last_seen (last_seen_at),
  FULLTEXT KEY ft_github_docs (title, summary, body)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Searchable stubs for docs that live in GitHub / the public help site';
