-- Scheduled webmail sends.
-- A row is a fully-composed outgoing message that the worker
-- (server/cron/scheduledEmailSender.js) sends once scheduled_at has passed.
--
-- scheduled_at / sent_at are stored as UTC wall-clock DATETIMEs and compared
-- against UTC_TIMESTAMP() so the session time zone never matters.
--
-- Apply on each instance DB that has webmail:
--   cd /var/www/owtranet
--   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < server/migrations/add_scheduled_emails.sql

CREATE TABLE IF NOT EXISTS scheduled_emails (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  email_account_id INT NOT NULL COMMENT 'server_email_accounts.id the mail is sent from',
  to_addr TEXT NOT NULL,
  cc TEXT NULL,
  bcc TEXT NULL,
  subject VARCHAR(998) NOT NULL,
  text_body MEDIUMTEXT NULL,
  html_body MEDIUMTEXT NULL,
  attachments JSON NULL COMMENT '[{filename, path, contentType, size}] as saved by multer',
  scheduled_at DATETIME NOT NULL COMMENT 'UTC',
  status ENUM('scheduled','sending','sent','failed','cancelled') NOT NULL DEFAULT 'scheduled',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  message_id VARCHAR(255) NULL,
  sent_at DATETIME NULL COMMENT 'UTC',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_scheduled_emails_due (status, scheduled_at),
  KEY idx_scheduled_emails_user (user_id, status, scheduled_at),
  CONSTRAINT fk_scheduled_emails_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Webmail messages queued for a future send';
