-- Email & calendar provider per member (2026-09-21).
--
-- Each member chooses where their work mailbox + calendar live:
--   self_hosted       Postfix/Dovecot mailbox + Nextcloud calendar on this box
--                     (the only option that unlocks Email Request + Webmail)
--   microsoft_365     Outlook + Exchange calendar (external)
--   google_workspace  Gmail + Google Calendar (external)
-- NULL = instance default, taken from the DEFAULT_EMAIL_PROVIDER env var
-- (falls back to self_hosted). An instance on Google Workspace sets
-- DEFAULT_EMAIL_PROVIDER=google_workspace.
--
-- Apply on EVERY instance DB:
--   mysql -h <rds> -u <admin> -p intranet_<instance> < server/migrations/add_email_provider.sql

ALTER TABLE users
  ADD COLUMN email_provider ENUM('self_hosted','microsoft_365','google_workspace') NULL DEFAULT NULL
    COMMENT 'Mail + calendar provider; NULL = instance default (DEFAULT_EMAIL_PROVIDER)'
    AFTER email_notification_preference;
