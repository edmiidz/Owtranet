-- Owtranet database schema (MySQL 8.x)
--
-- Load into an empty database:
--   mysql -u <user> -p <database> < db/schema.sql
-- then seed the placeholder team agreement:
--   mysql -u <user> -p <database> < db/seed_team_agreement.sql
--
-- This file is the authoritative schema. Files under server/migrations/ are the
-- incremental history that produced it and are already included here.

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `action` varchar(100) DEFAULT NULL,
  `entity_type` varchar(50) DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `details` json DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `activity_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agreement_email_invites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `agreement_version_id` int NOT NULL,
  `requested_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_version` (`email`,`agreement_version_id`),
  KEY `agreement_version_id` (`agreement_version_id`),
  CONSTRAINT `agreement_email_invites_ibfk_1` FOREIGN KEY (`agreement_version_id`) REFERENCES `agreement_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agreement_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `version` varchar(50) NOT NULL,
  `agreement_type` enum('team','employment','custom') NOT NULL DEFAULT 'team',
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `quiz_question` text,
  `quiz_correct_answer` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` int DEFAULT NULL,
  `required_fields` json DEFAULT NULL COMMENT 'e.g. ["sin","direct_deposit","address","date_of_birth"]',
  `confirmations` json DEFAULT NULL COMMENT 'array of {key,label} checkboxes the signer must tick',
  PRIMARY KEY (`id`),
  UNIQUE KEY `version` (`version`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `agreement_versions_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agreements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `type` enum('terms','nda','ip','other') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'other',
  `required` tinyint(1) DEFAULT '0',
  `active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `agreements_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_agent_replies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_user_id` int NOT NULL,
  `source_type` enum('post','comment','direct_message','group_message','comms_review') NOT NULL,
  `source_id` int NOT NULL,
  `post_id` int DEFAULT NULL,
  `group_id` int DEFAULT NULL,
  `requested_by` int DEFAULT NULL,
  `status` enum('pending','replied','failed','rate_limited','no_action') NOT NULL DEFAULT 'pending',
  `reply_comment_id` int DEFAULT NULL,
  `reply_message_id` int DEFAULT NULL,
  `reply_group_message_id` int DEFAULT NULL,
  `model` varchar(100) DEFAULT NULL,
  `error` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_agent_source` (`agent_user_id`,`source_type`,`source_id`),
  KEY `idx_aar_post` (`post_id`),
  KEY `idx_aar_created` (`created_at`),
  KEY `idx_aar_group` (`group_id`),
  CONSTRAINT `ai_agent_replies_agent_fk` FOREIGN KEY (`agent_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_agents` (
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
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `api_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `token` varchar(255) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `permissions` json DEFAULT NULL,
  `created_by` int NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `last_used_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_token` (`token`),
  KEY `idx_active` (`is_active`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `api_tokens_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `user_id` int NOT NULL,
  `parent_id` int DEFAULT NULL,
  `content` text NOT NULL,
  `content_html` text,
  `is_accepted` tinyint(1) DEFAULT '0',
  `score` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `parent_id` (`parent_id`),
  KEY `idx_post_id` (`post_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_score` (`score`),
  KEY `idx_comments_post_score` (`post_id`,`score` DESC),
  FULLTEXT KEY `idx_content` (`content`),
  CONSTRAINT `comments_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `comments_ibfk_3` FOREIGN KEY (`parent_id`) REFERENCES `comments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `deliverable_adjustments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `deliverable_id` int NOT NULL,
  `adjusted_by` int NOT NULL,
  `adjustment_type` enum('amount','original_amount','exchange_rate','risk_multiplier','status','other') NOT NULL,
  `field_name` varchar(50) NOT NULL,
  `old_value` text,
  `new_value` text,
  `reason` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `adjusted_by` (`adjusted_by`),
  KEY `idx_deliverable_adjustments` (`deliverable_id`),
  KEY `idx_adjustment_date` (`created_at`),
  CONSTRAINT `deliverable_adjustments_ibfk_1` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE CASCADE,
  CONSTRAINT `deliverable_adjustments_ibfk_2` FOREIGN KEY (`adjusted_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `deliverable_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `deliverable_id` int NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `file_type` varchar(100) DEFAULT NULL,
  `file_size` int DEFAULT NULL,
  `uploaded_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliverable_id` (`deliverable_id`),
  CONSTRAINT `deliverable_attachments_ibfk_1` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `deliverable_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `deliverable_id` int NOT NULL,
  `user_id` int NOT NULL,
  `content` text NOT NULL,
  `content_html` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deliverable_id` (`deliverable_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `deliverable_comments_ibfk_1` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE CASCADE,
  CONSTRAINT `deliverable_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `deliverable_tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `deliverable_id` int NOT NULL,
  `tag_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_deliverable_tag` (`deliverable_id`,`tag_id`),
  KEY `tag_id` (`tag_id`),
  CONSTRAINT `deliverable_tags_ibfk_1` FOREIGN KEY (`deliverable_id`) REFERENCES `deliverables` (`id`) ON DELETE CASCADE,
  CONSTRAINT `deliverable_tags_ibfk_2` FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `deliverables` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `nominee_user_id` int DEFAULT NULL,
  `type` enum('expense','customer','referral','contribution','other','member_payment') NOT NULL,
  `investment_category` enum('cash','sweat_equity','property','referral') DEFAULT 'cash',
  `title` varchar(255) NOT NULL,
  `description` text,
  `content` text,
  `content_html` text,
  `amount` decimal(10,2) DEFAULT NULL,
  `adjusted_amount` decimal(10,2) DEFAULT NULL,
  `original_amount` decimal(10,2) DEFAULT NULL,
  `original_currency` varchar(3) DEFAULT 'USD',
  `exchange_rate` decimal(10,6) DEFAULT '1.000000',
  `risk_multiplier` decimal(4,2) DEFAULT '1.00',
  `theoretical_value_usd` decimal(10,2) GENERATED ALWAYS AS (((`original_amount` * `exchange_rate`) * `risk_multiplier`)) STORED,
  `current_proposed_amount` decimal(10,2) DEFAULT NULL,
  `deliverable_date` date DEFAULT (curdate()),
  `status` enum('draft','pending','pending_review','approved','rejected','negotiating','paid') DEFAULT 'draft',
  `is_draft` tinyint(1) DEFAULT '0',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `auto_approved` tinyint(1) NOT NULL DEFAULT '0',
  `auto_approved_at` datetime DEFAULT NULL,
  `rejection_reason` text,
  `negotiation_history` json DEFAULT NULL,
  `payment_date` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `auto_saved_at` datetime DEFAULT NULL,
  `adjustment_reason` text,
  PRIMARY KEY (`id`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_type` (`type`),
  KEY `idx_deliverables_user_status` (`user_id`,`status`),
  KEY `nominee_user_id` (`nominee_user_id`),
  CONSTRAINT `deliverables_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `deliverables_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `deliverables_ibfk_3` FOREIGN KEY (`nominee_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `direct_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `conversation_id` int NOT NULL,
  `sender_id` int NOT NULL,
  `recipient_id` int NOT NULL,
  `content` text NOT NULL,
  `content_html` text,
  `is_read` tinyint(1) DEFAULT '0',
  `read_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int DEFAULT NULL,
  `reply_to_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_conversation` (`conversation_id`),
  KEY `idx_sender` (`sender_id`),
  KEY `idx_recipient` (`recipient_id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_unread` (`recipient_id`,`is_read`,`created_at`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_direct_messages_reply_to` (`reply_to_id`),
  CONSTRAINT `direct_messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `dm_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `direct_messages_ibfk_2` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `direct_messages_ibfk_3` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_direct_messages_reply_to` FOREIGN KEY (`reply_to_id`) REFERENCES `direct_messages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dm_conversations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user1_id` int NOT NULL,
  `user2_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user1` (`user1_id`),
  KEY `idx_user2` (`user2_id`),
  KEY `idx_updated` (`updated_at`),
  CONSTRAINT `dm_conversations_ibfk_1` FOREIGN KEY (`user1_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `dm_conversations_ibfk_2` FOREIGN KEY (`user2_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_account_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email_address` varchar(255) NOT NULL,
  `action` enum('created','password_reset','deactivated','reactivated','deleted','linked','unlinked') NOT NULL,
  `performed_by` int DEFAULT NULL,
  `details` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `performed_by` (`performed_by`),
  KEY `idx_email_address` (`email_address`),
  KEY `idx_action` (`action`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `email_account_logs_ibfk_1` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_auth_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `otp_code` varchar(6) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_token_hash` (`token_hash`),
  KEY `idx_otp_code` (`otp_code`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `email_auth_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `email_management_overview` AS SELECT 
 1 AS `id`,
 1 AS `email_address`,
 1 AS `server_username`,
 1 AS `server_status`,
 1 AS `disk_usage_mb`,
 1 AS `last_login`,
 1 AS `account_created`,
 1 AS `linked_user_name`,
 1 AS `linked_user_email`,
 1 AS `linked_user_role`*/;
SET character_set_client = @saved_cs_client;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `requested_email` varchar(255) NOT NULL,
  `justification` text,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejection_reason` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `approved_by` (`approved_by`),
  KEY `idx_status` (`status`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `email_requests_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `email_requests_ibfk_2` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `email_setup_sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `setup_token` varchar(255) NOT NULL,
  `status` enum('pending','completed','expired') DEFAULT 'pending',
  `created_by` int NOT NULL,
  `expires_at` datetime NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setup_token` (`setup_token`),
  KEY `created_by` (`created_by`),
  KEY `idx_token` (`setup_token`),
  KEY `idx_status` (`status`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `email_setup_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `email_setup_sessions_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `exchange_rates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `base_currency` varchar(3) NOT NULL DEFAULT 'USD',
  `target_currency` varchar(3) NOT NULL,
  `rate` decimal(12,6) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_rate` (`date`,`base_currency`,`target_currency`),
  KEY `idx_date` (`date`),
  KEY `idx_currency` (`target_currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `github_docs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `repo` varchar(128) NOT NULL COMMENT 'owner/name, e.g. example-org/docs',
  `path` varchar(512) NOT NULL COMMENT 'path within the repo, e.g. docs/internal/features/sms-agent.md',
  `collection` enum('internal','help','guide','exec') NOT NULL COMMENT 'internal=docs/** (GitHub link); help=/help/<slug>; guide=/docs/<slug>; exec=admin-only corpus',
  `visibility` enum('member','admin') NOT NULL DEFAULT 'member' COMMENT 'member=any signed-in user; admin=role admin only. Filter on this in EVERY read path.',
  `title` varchar(512) NOT NULL COMMENT 'frontmatter title, else first H1, else prettified filename',
  `summary` text COMMENT 'short excerpt shown on the container page',
  `body` mediumtext COMMENT 'plain-text body, indexed for search only; never rendered',
  `access_url` varchar(1024) NOT NULL COMMENT 'where "Access now" sends the member',
  `github_url` varchar(1024) NOT NULL COMMENT 'always the github.com blob URL (secondary link)',
  `blob_sha` char(40) NOT NULL COMMENT 'git blob sha; unchanged sha = skip re-fetch',
  `word_count` int DEFAULT NULL,
  `doc_updated_at` datetime DEFAULT NULL COMMENT 'last commit touching this file, when known',
  `last_seen_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'set every sweep; rows not seen in the latest sweep of that repo are deleted',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_github_docs_repo_path` (`repo`,`path`),
  KEY `idx_github_docs_collection` (`collection`),
  KEY `idx_github_docs_visibility` (`visibility`),
  KEY `idx_github_docs_last_seen` (`last_seen_at`),
  FULLTEXT KEY `ft_github_docs` (`title`,`summary`,`body`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Searchable stubs for docs that live in GitHub / the public help site';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `github_issues` (
  `id` int NOT NULL AUTO_INCREMENT,
  `issue_number` int NOT NULL,
  `title` varchar(500) DEFAULT NULL,
  `state` varchar(20) DEFAULT NULL,
  `assignee_github_username` varchar(100) DEFAULT NULL,
  `labels` json DEFAULT NULL,
  `html_url` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `synced_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `repo_name` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_issue` (`issue_number`),
  KEY `idx_assignee` (`assignee_github_username`),
  KEY `idx_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `group_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_id` int NOT NULL,
  `user_id` int NOT NULL,
  `role` enum('member','moderator','admin') DEFAULT 'member',
  `added_by` int NOT NULL,
  `added_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_group_user` (`group_id`,`user_id`),
  KEY `added_by` (`added_by`),
  KEY `idx_group_id` (`group_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_role` (`role`),
  CONSTRAINT `group_members_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_members_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_members_ibfk_3` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `group_message_reads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_id` int NOT NULL,
  `user_id` int NOT NULL,
  `last_read_message_id` int DEFAULT NULL,
  `last_read_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_group_user` (`group_id`,`user_id`),
  KEY `idx_group_reads_group_id` (`group_id`),
  KEY `idx_group_reads_user_id` (`user_id`),
  KEY `last_read_message_id` (`last_read_message_id`),
  CONSTRAINT `group_message_reads_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_message_reads_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_message_reads_ibfk_3` FOREIGN KEY (`last_read_message_id`) REFERENCES `group_messages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `group_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_id` int NOT NULL,
  `sender_id` int NOT NULL,
  `content` text NOT NULL,
  `content_html` text,
  `message_type` enum('text','file','system') DEFAULT 'text',
  `reply_to_id` int DEFAULT NULL,
  `is_edited` tinyint(1) DEFAULT '0',
  `is_deleted` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_group_messages_group_id` (`group_id`),
  KEY `idx_group_messages_sender_id` (`sender_id`),
  KEY `idx_group_messages_created_at` (`created_at`),
  KEY `idx_group_messages_reply_to` (`reply_to_id`),
  CONSTRAINT `group_messages_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_messages_ibfk_2` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `group_messages_ibfk_3` FOREIGN KEY (`reply_to_id`) REFERENCES `group_messages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `display_name` varchar(100) NOT NULL,
  `description` text,
  `visibility` enum('public','private') DEFAULT 'public',
  `email_alias` varchar(255) DEFAULT NULL,
  `type` enum('email','forum','both') DEFAULT 'both',
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `email_alias` (`email_alias`),
  KEY `idx_name` (`name`),
  KEY `idx_email_alias` (`email_alias`),
  KEY `idx_type` (`type`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_active` (`is_active`),
  CONSTRAINT `groups_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `investment_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  `description` text,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `investment_settings_ibfk_1` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invite_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `created_by` int NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `name` varchar(100) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `used_by` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `created_by` (`created_by`),
  KEY `used_by` (`used_by`),
  KEY `idx_code` (`code`),
  CONSTRAINT `invite_codes_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `invite_codes_ibfk_2` FOREIGN KEY (`used_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invite_link_usage` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invite_link_id` int NOT NULL,
  `user_id` int NOT NULL,
  `used_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  PRIMARY KEY (`id`),
  KEY `idx_invite_link_id` (`invite_link_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_used_at` (`used_at`),
  CONSTRAINT `invite_link_usage_ibfk_1` FOREIGN KEY (`invite_link_id`) REFERENCES `invite_links` (`id`) ON DELETE CASCADE,
  CONSTRAINT `invite_link_usage_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invite_links` (
  `id` int NOT NULL AUTO_INCREMENT,
  `link_code` varchar(32) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `max_uses` int DEFAULT NULL,
  `current_uses` int DEFAULT '0',
  `expires_at` datetime NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `link_code` (`link_code`),
  KEY `idx_link_code` (`link_code`),
  KEY `idx_created_by` (`created_by`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `invite_links_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ledger` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL COMMENT 'User who submitted the expense',
  `payee_user_id` int DEFAULT NULL COMMENT 'User to be paid/reimbursed (if different from submitter)',
  `expense_category` enum('office_supplies','travel','meals','software','hardware','professional_services','marketing','utilities','rent','insurance','maintenance','other') NOT NULL DEFAULT 'other',
  `title` varchar(500) NOT NULL,
  `description` text COMMENT 'Plain text description',
  `content` text COMMENT 'Detailed content/notes',
  `content_html` text COMMENT 'HTML formatted content',
  `amount` decimal(12,2) DEFAULT NULL COMMENT 'Final calculated amount in base currency (USD)',
  `adjusted_amount` decimal(12,2) DEFAULT NULL COMMENT 'Amount after adjustments/negotiations',
  `original_amount` decimal(12,2) DEFAULT NULL COMMENT 'Original submitted amount',
  `original_currency` varchar(3) DEFAULT 'USD' COMMENT 'Currency of original submission',
  `exchange_rate` decimal(10,6) DEFAULT '1.000000' COMMENT 'Exchange rate to USD at time of submission',
  `subtotal` decimal(12,2) DEFAULT NULL COMMENT 'Amount before taxes',
  `pst_amount` decimal(12,2) DEFAULT NULL COMMENT 'Provincial Sales Tax amount',
  `pst_rate` decimal(5,4) DEFAULT NULL COMMENT 'PST rate applied',
  `gst_amount` decimal(12,2) DEFAULT NULL COMMENT 'GST/Federal tax amount',
  `gst_rate` decimal(5,4) DEFAULT NULL COMMENT 'GST rate applied',
  `hst_amount` decimal(12,2) DEFAULT NULL COMMENT 'Harmonized Sales Tax amount',
  `hst_rate` decimal(5,4) DEFAULT NULL COMMENT 'HST rate applied',
  `vat_amount` decimal(12,2) DEFAULT NULL COMMENT 'VAT amount (for international)',
  `vat_rate` decimal(5,4) DEFAULT NULL COMMENT 'VAT rate applied',
  `other_tax_amount` decimal(12,2) DEFAULT NULL COMMENT 'Other applicable taxes',
  `other_tax_description` varchar(255) DEFAULT NULL COMMENT 'Description of other tax',
  `tax_total` decimal(12,2) DEFAULT NULL COMMENT 'Total of all taxes',
  `total_with_tax` decimal(12,2) DEFAULT NULL COMMENT 'Grand total including all taxes',
  `vendor_name` varchar(255) DEFAULT NULL COMMENT 'Name of vendor/merchant',
  `vendor_tax_id` varchar(100) DEFAULT NULL COMMENT 'Vendor GST/HST/VAT registration number',
  `receipt_number` varchar(255) DEFAULT NULL COMMENT 'Receipt or invoice number',
  `receipt_filename` varchar(255) DEFAULT NULL COMMENT 'Stored filename',
  `receipt_original_name` varchar(255) DEFAULT NULL COMMENT 'Original uploaded filename',
  `receipt_mime_type` varchar(100) DEFAULT NULL COMMENT 'File MIME type',
  `receipt_size` int DEFAULT NULL COMMENT 'File size in bytes',
  `expense_date` date NOT NULL COMMENT 'Date the expense was incurred',
  `due_date` date DEFAULT NULL COMMENT 'Payment due date if applicable',
  `paid_date` date DEFAULT NULL COMMENT 'Date expense was paid/reimbursed',
  `status` enum('draft','pending','under_review','approved','rejected','paid','cancelled') DEFAULT 'draft',
  `is_draft` tinyint(1) DEFAULT '1' COMMENT 'Quick draft indicator',
  `is_reimbursable` tinyint(1) DEFAULT '1' COMMENT 'Whether this expense is reimbursable',
  `is_recurring` tinyint(1) DEFAULT '0' COMMENT 'Whether this is a recurring expense',
  `recurring_frequency` enum('weekly','biweekly','monthly','quarterly','annually') DEFAULT NULL,
  `approved_by` int DEFAULT NULL COMMENT 'User who approved the expense',
  `approved_at` datetime DEFAULT NULL,
  `rejection_reason` text COMMENT 'Reason for rejection if applicable',
  `negotiation_history` json DEFAULT NULL COMMENT 'JSON array of negotiation/adjustment history',
  `payment_method` varchar(100) DEFAULT NULL COMMENT 'How expense was paid',
  `payment_reference` varchar(255) DEFAULT NULL COMMENT 'Payment reference/confirmation number',
  `reimbursed_by` int DEFAULT NULL COMMENT 'User who processed reimbursement',
  `reimbursed_at` datetime DEFAULT NULL,
  `gl_code` varchar(50) DEFAULT NULL COMMENT 'General ledger account code',
  `cost_center` varchar(100) DEFAULT NULL COMMENT 'Cost center for departmental tracking',
  `project_code` varchar(100) DEFAULT NULL COMMENT 'Project code if expense is project-related',
  `source` enum('manual','email','api','import') DEFAULT 'manual',
  `source_email_id` varchar(255) DEFAULT NULL COMMENT 'Message-ID if created from email',
  `source_email_subject` varchar(500) DEFAULT NULL COMMENT 'Original email subject',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `auto_saved_at` datetime DEFAULT NULL COMMENT 'Last auto-save timestamp for drafts',
  `adjustment_reason` text COMMENT 'Reason for amount adjustment',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_payee_user_id` (`payee_user_id`),
  KEY `idx_expense_category` (`expense_category`),
  KEY `idx_status` (`status`),
  KEY `idx_expense_date` (`expense_date`),
  KEY `idx_is_draft` (`is_draft`),
  KEY `idx_approved_by` (`approved_by`),
  KEY `idx_source` (`source`),
  KEY `idx_vendor_name` (`vendor_name`),
  KEY `idx_created_at` (`created_at`),
  KEY `ledger_ibfk_4` (`reimbursed_by`),
  CONSTRAINT `ledger_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ledger_ibfk_2` FOREIGN KEY (`payee_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ledger_ibfk_3` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ledger_ibfk_4` FOREIGN KEY (`reimbursed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Expense ledger for tracking receipts, expenses, and reimbursements';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `likes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `likeable_type` enum('post','comment','message','group_message') DEFAULT NULL,
  `likeable_id` int NOT NULL,
  `value` int DEFAULT '1',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_like` (`user_id`,`likeable_type`,`likeable_id`),
  KEY `idx_likeable` (`likeable_type`,`likeable_id`),
  CONSTRAINT `likes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mentions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `mentioned_user_id` int NOT NULL,
  `mentionable_type` enum('post','comment') NOT NULL,
  `mentionable_id` int NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_mentioned_user` (`mentioned_user_id`),
  KEY `idx_is_read` (`is_read`),
  CONSTRAINT `mentions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `mentions_ibfk_2` FOREIGN KEY (`mentioned_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mobile_devices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `platform` enum('ios','android','web','unknown') NOT NULL DEFAULT 'unknown',
  `push_token` varchar(512) NOT NULL,
  `device_name` varchar(255) DEFAULT NULL,
  `app_version` varchar(50) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_seen_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mobile_devices_token` (`push_token`),
  KEY `idx_mobile_devices_user` (`user_id`,`is_active`),
  CONSTRAINT `fk_mobile_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mobile_push_state` (
  `name` varchar(50) NOT NULL,
  `last_id` int NOT NULL DEFAULT '0',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `type` varchar(50) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `message` text,
  `data` json DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_is_read` (`is_read`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `token_hash` (`token_hash`),
  KEY `expires_at` (`expires_at`),
  CONSTRAINT `password_reset_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_details_access_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `accessed_by` int NOT NULL,
  `action` enum('view','update') NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `post_editors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `user_id` int NOT NULL,
  `granted_by` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_post_editor` (`post_id`,`user_id`),
  KEY `granted_by` (`granted_by`),
  KEY `idx_pe_post_id` (`post_id`),
  KEY `idx_pe_user_id` (`user_id`),
  CONSTRAINT `post_editors_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `post_editors_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `post_editors_ibfk_3` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `post_tags` (
  `post_id` int NOT NULL,
  `tag_id` int NOT NULL,
  PRIMARY KEY (`post_id`,`tag_id`),
  KEY `tag_id` (`tag_id`),
  CONSTRAINT `post_tags_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `post_tags_ibfk_2` FOREIGN KEY (`tag_id`) REFERENCES `tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `post_visibility` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `user_id` int NOT NULL,
  `granted_by` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_post_user` (`post_id`,`user_id`),
  KEY `granted_by` (`granted_by`),
  KEY `idx_post_id` (`post_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `post_visibility_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `post_visibility_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `post_visibility_ibfk_3` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `posts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(500) NOT NULL,
  `content` text NOT NULL,
  `content_html` text,
  `slug` varchar(500) DEFAULT NULL,
  `view_count` int DEFAULT '0',
  `is_pinned` tinyint(1) DEFAULT '0',
  `is_locked` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `visibility` enum('all_members','specific_members','author_only') DEFAULT 'all_members',
  `attachment_filename` varchar(255) DEFAULT NULL,
  `attachment_original_name` varchar(255) DEFAULT NULL,
  `attachment_mime_type` varchar(100) DEFAULT NULL,
  `attachment_size` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_slug` (`slug`),
  KEY `idx_posts_user_created` (`user_id`,`created_at` DESC),
  FULLTEXT KEY `idx_search` (`title`,`content`),
  CONSTRAINT `posts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quicklinks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `url` varchar(500) NOT NULL,
  `description` text,
  `display_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `radio_listens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `segment_id` int NOT NULL,
  `completed` tinyint(1) NOT NULL DEFAULT '1',
  `listened_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_radio_listens_user_segment` (`user_id`,`segment_id`),
  KEY `idx_radio_listens_user` (`user_id`,`listened_at`),
  KEY `fk_radio_listens_segment` (`segment_id`),
  CONSTRAINT `fk_radio_listens_segment` FOREIGN KEY (`segment_id`) REFERENCES `radio_segments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_radio_listens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `radio_segments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `headline` varchar(255) NOT NULL,
  `tts_text` text NOT NULL,
  `source_hash` char(40) NOT NULL COMMENT 'sha1(title+content) at generation time; changes trigger regeneration',
  `comment_count` int NOT NULL DEFAULT '0' COMMENT 'replies included when this segment was generated',
  `model` varchar(64) DEFAULT NULL,
  `word_count` int DEFAULT NULL,
  `est_duration_secs` int DEFAULT NULL,
  `status` enum('ready','failed') NOT NULL DEFAULT 'ready',
  `is_manual` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = edited by hand; worker will not overwrite',
  `edited_by` int DEFAULT NULL,
  `error` text,
  `generated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_radio_segments_post` (`post_id`),
  KEY `idx_radio_segments_generated` (`generated_at`),
  CONSTRAINT `fk_radio_segments_post` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Corporate Radio: TTS-ready summaries of intranet posts';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `scheduled_emails` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `email_account_id` int NOT NULL COMMENT 'server_email_accounts.id the mail is sent from',
  `to_addr` text NOT NULL,
  `cc` text,
  `bcc` text,
  `subject` varchar(998) NOT NULL,
  `text_body` mediumtext,
  `html_body` mediumtext,
  `attachments` json DEFAULT NULL COMMENT '[{filename, path, contentType, size}] as saved by multer',
  `scheduled_at` datetime NOT NULL COMMENT 'UTC',
  `status` enum('scheduled','sending','sent','failed','cancelled') NOT NULL DEFAULT 'scheduled',
  `attempts` tinyint unsigned NOT NULL DEFAULT '0',
  `last_error` text,
  `message_id` varchar(255) DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL COMMENT 'UTC',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scheduled_emails_due` (`status`,`scheduled_at`),
  KEY `idx_scheduled_emails_user` (`user_id`,`status`,`scheduled_at`),
  CONSTRAINT `fk_scheduled_emails_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Webmail messages queued for a future send';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `search_adapter_rules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `adapter_id` int NOT NULL,
  `path_prefix` varchar(255) NOT NULL COMMENT 'indexes files under this path, e.g. docs/ or src/content/help/',
  `collection` enum('internal','help','guide','exec') NOT NULL COMMENT 'drives the badge and the destination wording on the container page',
  `visibility` enum('member','admin') NOT NULL DEFAULT 'member' COMMENT 'ACCESS CONTROL — copied to github_docs.visibility on every sweep',
  `access_url_mode` enum('github','site_path') NOT NULL DEFAULT 'github' COMMENT 'github = link to the blob; site_path = link to <site_base>/<url_path>/<slug>',
  `url_path` varchar(128) DEFAULT NULL COMMENT 'path segment for site_path mode, e.g. help or docs',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT 'rules are tried in this order; first match wins',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_search_adapter_rules_adapter` (`adapter_id`,`sort_order`),
  CONSTRAINT `fk_search_adapter_rules_adapter` FOREIGN KEY (`adapter_id`) REFERENCES `search_adapters` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Path rules per adapter: which files to index, and how to link to them';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `search_adapters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `repo` varchar(128) NOT NULL COMMENT 'owner/name, e.g. example-org/docs',
  `branch` varchar(128) NOT NULL DEFAULT 'main',
  `label` varchar(128) DEFAULT NULL COMMENT 'display name in the admin UI; defaults to repo',
  `token_env_var` varchar(64) NOT NULL DEFAULT 'GITHUB_DOCS_TOKEN' COMMENT 'NAME of the .env var holding the PAT — never the token itself',
  `site_base` varchar(255) DEFAULT NULL COMMENT 'base URL for rules whose access_url_mode is a published page, e.g. https://www.example.com',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `last_swept_at` datetime DEFAULT NULL,
  `last_status` enum('ok','failed','never') NOT NULL DEFAULT 'never',
  `last_error` varchar(512) DEFAULT NULL,
  `last_doc_count` int DEFAULT NULL COMMENT 'docs indexed for this repo at the last successful sweep',
  `updated_by` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_search_adapters_repo` (`repo`),
  KEY `idx_search_adapters_enabled` (`enabled`),
  KEY `fk_search_adapters_user` (`updated_by`),
  CONSTRAINT `fk_search_adapters_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Repos the GitHub doc sweep indexes into intranet search';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `search_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `query` varchar(500) DEFAULT NULL,
  `results_count` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `search_history_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sent_emails` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sender` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipients` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `sent_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sender_sent_at` (`sender`,`sent_at`),
  KEY `idx_sent_at` (`sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

-- Authenticated sends parsed from the Postfix mail log (server/cron/ingestMailLog.js)
CREATE TABLE IF NOT EXISTS `smtp_sent_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `queue_id` varchar(32) NOT NULL,
  `sender` varchar(255) NOT NULL,
  `sent_at` datetime NOT NULL,
  `recipient_count` int NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_smtp_sent_queue` (`queue_id`, `sent_at`),
  KEY `idx_smtp_sent_sender_time` (`sender`, `sent_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `server_email_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email_address` varchar(255) NOT NULL,
  `server_username` varchar(100) NOT NULL,
  `linked_user_id` int DEFAULT NULL,
  `server_status` enum('active','inactive') DEFAULT 'active',
  `disk_usage_mb` int DEFAULT '0',
  `last_login` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `email_password_encrypted` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email_address` (`email_address`),
  KEY `idx_linked_user_id` (`linked_user_id`),
  KEY `idx_server_status` (`server_status`),
  KEY `idx_email_address` (`email_address`),
  CONSTRAINT `server_email_accounts_ibfk_1` FOREIGN KEY (`linked_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text,
  `description` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `slug` varchar(50) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `usage_count` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_usage` (`usage_count` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_activity` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` varchar(50) NOT NULL COMMENT 'created, status_changed, assigned, priority_changed, due_date_changed, commented, edited, deleted',
  `old_value` varchar(255) DEFAULT NULL,
  `new_value` varchar(255) DEFAULT NULL,
  `details` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_activity_task_id` (`task_id`),
  KEY `idx_task_activity_user_id` (`user_id`),
  KEY `idx_task_activity_created_at` (`created_at`),
  CONSTRAINT `task_activity_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `task_activity_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Audit log for task changes';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `content` text NOT NULL,
  `content_html` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_comments_task_id` (`task_id`),
  KEY `idx_task_comments_user_id` (`user_id`),
  KEY `idx_task_comments_created_at` (`created_at`),
  CONSTRAINT `task_comments_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `task_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Comments on tasks';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(500) NOT NULL,
  `description` text,
  `description_html` text,
  `status` enum('pending','in_progress','completed') DEFAULT 'pending',
  `priority` enum('low','normal','high','urgent') DEFAULT 'normal',
  `due_date` date DEFAULT NULL,
  `created_by` int NOT NULL,
  `assigned_to` int DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tasks_status` (`status`),
  KEY `idx_tasks_priority` (`priority`),
  KEY `idx_tasks_due_date` (`due_date`),
  KEY `idx_tasks_created_by` (`created_by`),
  KEY `idx_tasks_assigned_to` (`assigned_to`),
  KEY `idx_tasks_created_at` (`created_at`),
  CONSTRAINT `tasks_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `tasks_ibfk_2` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Task manager - core tasks';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tracked_commits` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sha` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `short_sha` varchar(7) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `repo` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `author` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `commit_date` datetime NOT NULL,
  `tags` json DEFAULT NULL,
  `deliverable_id` int DEFAULT NULL,
  `processed_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sha` (`sha`),
  KEY `idx_sha` (`sha`),
  KEY `idx_repo_date` (`repo`,`commit_date`),
  KEY `idx_deliverable` (`deliverable_id`),
  KEY `idx_processed` (`processed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_agreement_assignments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `agreement_version_id` int NOT NULL,
  `status` enum('pending','signed','cancelled') NOT NULL DEFAULT 'pending',
  `requested_by` int DEFAULT NULL,
  `requested_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `signed_at` datetime DEFAULT NULL,
  `user_agreement_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_version` (`user_id`,`agreement_version_id`),
  KEY `agreement_version_id` (`agreement_version_id`),
  CONSTRAINT `user_agreement_assignments_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_agreement_assignments_ibfk_2` FOREIGN KEY (`agreement_version_id`) REFERENCES `agreement_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_agreements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `agreement_version_id` int NOT NULL,
  `full_name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `quiz_answer` varchar(100) DEFAULT NULL,
  `digital_signature` varchar(255) NOT NULL,
  `signed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('signed','voided') DEFAULT 'signed',
  `confirmations` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_version` (`user_id`,`agreement_version_id`),
  KEY `agreement_version_id` (`agreement_version_id`),
  CONSTRAINT `user_agreements_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_agreements_ibfk_2` FOREIGN KEY (`agreement_version_id`) REFERENCES `agreement_versions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_payroll_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `user_agreement_id` int DEFAULT NULL,
  `sin_encrypted` varbinary(255) DEFAULT NULL,
  `sin_last3` char(3) DEFAULT NULL,
  `bank_institution_encrypted` varbinary(255) DEFAULT NULL,
  `bank_transit_encrypted` varbinary(255) DEFAULT NULL,
  `bank_account_encrypted` varbinary(255) DEFAULT NULL,
  `bank_account_last4` char(4) DEFAULT NULL,
  `address_line1` varchar(255) DEFAULT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `province` varchar(50) DEFAULT NULL,
  `postal_code` varchar(10) DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `user_payroll_details_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `other_emails` text COMMENT 'Comma-separated list of additional email addresses for receipt matching',
  `email_verified` tinyint(1) DEFAULT '0',
  `email_verification_token` varchar(255) DEFAULT NULL,
  `email_verification_expires` datetime DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `name` varchar(100) NOT NULL,
  `company` varchar(100) DEFAULT NULL,
  `telephone` varchar(20) DEFAULT NULL,
  `github_username` varchar(100) DEFAULT NULL,
  `calendar_link` varchar(500) DEFAULT NULL,
  `apple_id` varchar(255) DEFAULT NULL COMMENT 'Apple ID email, used for TestFlight invites',
  `google_account` varchar(255) DEFAULT NULL COMMENT 'Google account email (Gmail or other), for Drive/Play sharing',
  `intranet_username` varchar(50) DEFAULT NULL,
  `invite_code` varchar(32) DEFAULT NULL,
  `avatar_url` varchar(500) DEFAULT NULL,
  `bio` text,
  `department` varchar(100) DEFAULT NULL,
  `position` varchar(100) DEFAULT NULL,
  `role` enum('admin','moderator','user','pending','pending_agreement','deactivated','system') DEFAULT 'pending',
  `account_type` enum('human','ai_agent') NOT NULL DEFAULT 'human',
  `last_login` datetime DEFAULT NULL,
  `last_active_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `company_email` varchar(255) DEFAULT NULL,
  `email_notification_preference` enum('personal','company','both') DEFAULT 'company',
  `email_provider` enum('self_hosted','microsoft_365','google_workspace') DEFAULT NULL COMMENT 'Mail + calendar provider; NULL = instance default (DEFAULT_EMAIL_PROVIDER)',
  `company_email_created_at` datetime DEFAULT NULL,
  `company_email_last_reset` datetime DEFAULT NULL,
  `email_server_status` enum('active','inactive','pending') DEFAULT NULL,
  `email_disk_usage_mb` int DEFAULT '0',
  `email_last_login` datetime DEFAULT NULL,
  `agent_embed_code` text,
  `hourly_rate` decimal(10,2) DEFAULT NULL COMMENT 'Hourly rate in USD - users with rate >= 100 can view all investments',
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `intranet_username` (`intranet_username`),
  KEY `idx_email` (`email`),
  KEY `idx_github_username` (`github_username`),
  KEY `idx_role` (`role`),
  KEY `idx_account_type` (`account_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50001 DROP VIEW IF EXISTS `email_management_overview`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_0900_ai_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */

/*!50001 VIEW `email_management_overview` AS select `sea`.`id` AS `id`,`sea`.`email_address` AS `email_address`,`sea`.`server_username` AS `server_username`,`sea`.`server_status` AS `server_status`,`sea`.`disk_usage_mb` AS `disk_usage_mb`,`sea`.`last_login` AS `last_login`,`sea`.`created_at` AS `account_created`,(case when (`sea`.`linked_user_id` is not null) then `u`.`name` else '[Orphaned]' end) AS `linked_user_name`,(case when (`sea`.`linked_user_id` is not null) then `u`.`email` else NULL end) AS `linked_user_email`,(case when (`sea`.`linked_user_id` is not null) then `u`.`role` else NULL end) AS `linked_user_role` from (`server_email_accounts` `sea` left join `users` `u` on((`sea`.`linked_user_id` = `u`.`id`))) order by `sea`.`email_address` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

