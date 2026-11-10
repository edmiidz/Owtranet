-- Every authenticated email sent through this server's Postfix.
-- Apply to EACH instance DB that runs server/cron/ingestMailLog.js.
--
-- sent_emails only logs webmail and scheduled sends; mail sent from a phone or
-- Outlook straight to Postfix never reached it. ingestMailLog.js reads
-- /var/log/mail.log (and its rotations) and records one row per message that
-- was submitted with SMTP AUTH (sasl_username), so GET /api/v1/activity can
-- count everything a member sent from their company mailbox.
--
-- Facts only, by design: no subject, body or recipient addresses.
--   sender          the SASL login (the mailbox that authenticated), lowercased
--   queue_id        Postfix queue id; short ids can be reused over months, so
--                   uniqueness is (queue_id, sent_at)
--   sent_at         when Postfix accepted it (server local time, like the other tables)
--   recipient_count nrcpt from the qmgr line

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Authenticated sends parsed from the Postfix mail log';
