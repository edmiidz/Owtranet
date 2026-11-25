-- post_revisions: version history for forum posts.
--
-- Each row is a snapshot of a post's title/content/visibility AFTER an edit:
-- revision 1 is the post as created (or, for posts that existed before this
-- migration, the post as it stood when the migration ran), and every later
-- save that changes title, content or visibility adds the next number.
-- Written by server/lib/postRevisions.js from both edit paths (web
-- PUT /api/posts/:id and token PUT /api/v1/forum/posts/:id) and from restore.
--
-- Apply on EACH instance DB. Safe to re-run: the backfill only touches posts
-- that have no revisions yet.
CREATE TABLE IF NOT EXISTS `post_revisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `revision_number` int NOT NULL,
  `title` varchar(500) NOT NULL,
  `content` mediumtext NOT NULL,
  `visibility` varchar(32) DEFAULT NULL,
  -- NULL = unknown editor (the backfilled baseline of a pre-existing post).
  `edited_by` int DEFAULT NULL,
  -- 'web' | 'api:<token name>' | 'restore' | 'baseline'
  `edited_via` varchar(150) DEFAULT NULL,
  `change_note` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_post_revision` (`post_id`,`revision_number`),
  KEY `idx_pr_edited_by` (`edited_by`),
  CONSTRAINT `post_revisions_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `post_revisions_ibfk_2` FOREIGN KEY (`edited_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Baseline: the current state of every existing post becomes its revision 1.
-- The editor is unknown (earlier edits were never recorded), so edited_by is NULL.
INSERT INTO post_revisions (post_id, revision_number, title, content, visibility, edited_by, edited_via, created_at)
SELECT p.id, 1, p.title, COALESCE(p.content, ''), p.visibility, NULL, 'baseline', COALESCE(p.updated_at, p.created_at, NOW())
FROM posts p
WHERE NOT EXISTS (SELECT 1 FROM post_revisions r WHERE r.post_id = p.id);
