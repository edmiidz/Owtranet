-- Intranet AI agents.
-- Apply to EACH instance DB, then run: node server/scripts/seedAiAgents.js
-- An agent is a users row (account_type = 'ai_agent') + an ai_agents row.

ALTER TABLE `users`
  ADD COLUMN `account_type` enum('human','ai_agent') NOT NULL DEFAULT 'human' AFTER `role`,
  ADD KEY `idx_account_type` (`account_type`);

CREATE TABLE IF NOT EXISTS `ai_agents` (
  `user_id` int NOT NULL,
  `handle` varchar(50) NOT NULL COMMENT 'What people type after @ (may differ from intranet_username)',
  `kind` enum('role','voice','system') NOT NULL DEFAULT 'role',
  `tagline` varchar(255) DEFAULT NULL,
  `description` text,
  `elevenlabs_agent_id` varchar(100) DEFAULT NULL,
  `skill_command` varchar(100) DEFAULT NULL COMMENT 'Claude Code slash command, e.g. /prototyper',
  `skill_url` varchar(500) DEFAULT NULL COMMENT 'Google Drive location of the Claude Code skill source',
  `responds_to_mentions` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uniq_ai_agent_handle` (`handle`),
  CONSTRAINT `ai_agents_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per (agent, post/comment that tagged it): audit trail, idempotency
-- (an edit or retry never replies twice) and the hourly spend guards.
CREATE TABLE IF NOT EXISTS `ai_agent_replies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_user_id` int NOT NULL,
  `source_type` enum('post','comment') NOT NULL,
  `source_id` int NOT NULL,
  `post_id` int NOT NULL,
  `requested_by` int DEFAULT NULL,
  `status` enum('pending','replied','failed','rate_limited') NOT NULL DEFAULT 'pending',
  `reply_comment_id` int DEFAULT NULL,
  `model` varchar(100) DEFAULT NULL,
  `error` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_agent_source` (`agent_user_id`,`source_type`,`source_id`),
  KEY `idx_aar_post` (`post_id`),
  KEY `idx_aar_created` (`created_at`),
  CONSTRAINT `ai_agent_replies_agent_fk` FOREIGN KEY (`agent_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
