-- Placeholder Team Member Agreement — v1.0 (TBD)
--
-- Every new member is routed to /agreement until they sign the single active
-- 'team' agreement (role pending_agreement → user). This seed is PLACEHOLDER
-- TEXT: replace the content with your organisation's real terms before inviting
-- anyone. No quiz; the confirmation checkboxes carry the substance.
--
--   mysql -u <user> -p <database> < db/seed_team_agreement.sql
--
-- To publish real terms later, INSERT a new row (version '2.0', is_active 1) and
-- set this one to is_active 0 — members who signed 1.0 are asked to sign again.
-- Agreements can also be managed in Admin → Agreements.

SET NAMES utf8mb4;

INSERT INTO agreement_versions
  (version, agreement_type, title, content, quiz_question, quiz_correct_answer, is_active, created_by,
   required_fields, confirmations)
VALUES (
  '1.0',
  'team',
  'Team Member Agreement (TBD)',
  '<h2>Team Member Agreement</h2>
<p><strong>TBD — placeholder text.</strong> The terms of this agreement have not been written yet. An administrator will publish the real agreement as a new version, and you will be asked to sign it.</p>
<h3>1. Lorem ipsum</h3>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
<h3>2. Dolor sit amet</h3>
<p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
<h3>3. Consectetur adipiscing</h3>
<p>Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.</p>',
  NULL, NULL, 1,
  (SELECT id FROM (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1) AS admin_u),
  NULL,
  JSON_ARRAY(
    JSON_OBJECT('key','placeholder','label','I understand this agreement is placeholder text (TBD) and that I will be asked to sign the final version when it is published.'),
    JSON_OBJECT('key','goodFaith','label','Lorem ipsum: I agree to use this intranet in good faith.')
  )
);

SELECT id, version, agreement_type, title, is_active FROM agreement_versions WHERE agreement_type = 'team';
