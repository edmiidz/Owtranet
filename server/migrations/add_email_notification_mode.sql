-- Don't email members about things they are already looking at (2026-11-18).
--
-- Mention / comment / direct-message emails were meant to go only to "offline"
-- members, but "offline" was measured from users.last_login, which is set only at
-- sign-in. Web and mobile sessions last for days, so 30 minutes after signing in
-- everyone counted as offline and got emailed while actively using the app.
--
-- Two columns:
--   last_active_at           Stamped (at most once a minute) on every signed-in
--                            web or mobile API request. The web app polls while
--                            its tab is visible and the mobile app while it is
--                            open, so this tracks real presence. API-token
--                            (integration) requests don't count. Already in
--                            db/schema.sql; added here for older instances.
--   email_notification_mode  Per-member choice of when to send those emails:
--     always           every time, even while active
--     when_away        (default) only if not active on web or mobile for
--                      EMAIL_NOTIFY_AWAY_MINUTES (default 30)
--     when_signed_out  as when_away, and also not while signed in to the mobile
--                      app (it gets push notifications instead)
--     never            in-app and push notifications only
--
-- Safe to re-run: each ADD COLUMN is guarded. Apply to EACH instance database
-- BEFORE deploying the code that reads these columns:
--   mysql -h <host> -u <admin> -p <instance_db> < server/migrations/add_email_notification_mode.sql

SET @ddl = (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''users.last_active_at already present, skipping'' AS note',
    'ALTER TABLE users ADD COLUMN last_active_at DATETIME DEFAULT NULL AFTER last_login'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'last_active_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''users.email_notification_mode already present, skipping'' AS note',
    'ALTER TABLE users
       ADD COLUMN email_notification_mode ENUM(''always'',''when_away'',''when_signed_out'',''never'')
         NOT NULL DEFAULT ''when_away''
         COMMENT ''When to email mention/comment/DM notifications; see server/lib/emailNotifications.js''
         AFTER email_notification_preference'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'email_notification_mode'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
