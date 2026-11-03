-- Owtranet base seed data — run once, right after db/schema.sql.
--
--   mysql -u <user> -p <database> < db/seed.sql
--
-- Creates the rows a fresh instance needs before anyone signs in:
--   * user 1, the "System" service account. The server sends welcome and
--     account DMs from user 1 and uses it as the fallback owner of API-created
--     records, so it must exist and must be id 1. It cannot sign in (the
--     password is not a bcrypt hash) and role 'system' keeps it out of member lists.
--   * investment tracker risk multipliers (edit in Admin → Investment Settings)
--   * a public #General group-chat channel
--
-- Then create your first admin:  node scripts/create-admin.js
-- and the placeholder team agreement:  db/seed_team_agreement.sql

SET NAMES utf8mb4;

INSERT INTO users (id, email, password, name, role, account_type, intranet_username)
VALUES (1, 'system@example.invalid', '!disabled', 'System', 'system', 'human', 'system');

INSERT INTO investment_settings (setting_key, setting_value, description) VALUES
  ('multiplier_cash',         '1.0', 'Risk multiplier for cash investments'),
  ('multiplier_sweat_equity', '1.0', 'Risk multiplier for sweat-equity investments'),
  ('multiplier_property',     '1.0', 'Risk multiplier for property investments'),
  ('multiplier_referral',     '1.0', 'Risk multiplier for referral investments');

INSERT INTO `groups` (name, display_name, description, visibility, type, created_by)
VALUES ('General', 'General', 'Company-wide channel', 'public', 'both', 1);
