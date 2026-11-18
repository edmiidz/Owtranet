-- Owtranet base seed data — run right after db/schema.sql.
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
-- Re-running this import preserves existing users, settings and groups.
--
-- Then create your first admin:  node scripts/create-admin.js
-- and the placeholder team agreement:  db/seed_team_agreement.sql

SET NAMES utf8mb4;

INSERT INTO users (id, email, password, name, role, account_type, intranet_username)
SELECT 1, 'system@example.invalid', '!disabled', 'System', 'system', 'human', 'system'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 1);

INSERT INTO investment_settings (setting_key, setting_value, description)
SELECT defaults.setting_key, defaults.setting_value, defaults.description
FROM (
  SELECT 'multiplier_cash' AS setting_key, '1.0' AS setting_value, 'Risk multiplier for cash investments' AS description
  UNION ALL SELECT 'multiplier_sweat_equity', '1.0', 'Risk multiplier for sweat-equity investments'
  UNION ALL SELECT 'multiplier_property', '1.0', 'Risk multiplier for property investments'
  UNION ALL SELECT 'multiplier_referral', '1.0', 'Risk multiplier for referral investments'
) AS defaults
WHERE NOT EXISTS (
  SELECT 1 FROM investment_settings AS existing WHERE existing.setting_key = defaults.setting_key
);

INSERT INTO `groups` (name, display_name, description, visibility, type, created_by)
SELECT 'General', 'General', 'Company-wide channel', 'public', 'both', 1
WHERE NOT EXISTS (SELECT 1 FROM `groups` WHERE name = 'General');
