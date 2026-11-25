#!/usr/bin/env node
// Email notification rules against a real MySQL database (called by upgrade-test.sh).
// Inserts throwaway users 900001+ and removes them afterwards. Exit 1 on failure.
const mysql = require('mysql2/promise');
const { checkEmailNotification } = require('../../server/lib/emailNotifications');

const CASES = [
  // id,    mode,              last_active_at,               mobile device, push reaches it, expected send
  [900001, 'when_away',       'NOW()',                      false, true,  false],
  [900002, 'when_away',       'NOW() - INTERVAL 31 MINUTE', false, true,  true],
  [900003, 'when_away',       'NULL',                       true,  true,  true],
  [900004, 'when_signed_out', 'NOW() - INTERVAL 2 HOUR',    true,  true,  false],
  [900008, 'when_signed_out', 'NOW() - INTERVAL 2 HOUR',    true,  false, true],
  [900005, 'when_signed_out', 'NOW() - INTERVAL 2 HOUR',    false, true,  true],
  [900006, 'always',          'NOW()',                      true,  true,  true],
  [900007, 'never',           'NULL',                       false, true,  false],
];

(async () => {
  const db = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PWD,
    database: process.env.DB_NAME,
  });
  const ids = CASES.map(c => c[0]);
  const clean = async () => {
    await db.query('DELETE FROM mobile_devices WHERE user_id IN (?)', [ids]);
    await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
  };
  let failed = 0;
  try {
    await clean();
    for (const [id, mode, lastActive, device] of CASES) {
      await db.query(
        `INSERT INTO users (id, name, email, password, role, email_notification_mode, last_active_at)
         VALUES (?, ?, ?, 'x', 'user', ?, ${lastActive})`,
        [id, `Test ${id}`, `test${id}@example.com`, mode]
      );
      if (device) {
        await db.query("INSERT INTO mobile_devices (user_id, platform, push_token, is_active) VALUES (?, 'ios', ?, 1)",
          [id, String(id).padStart(64, '0')]);
      }
    }
    for (const [id, mode, lastActive, device, reachable, want] of CASES) {
      // "push reaches it" stands in for this server's FCM / APNs configuration.
      const r = await checkEmailNotification(db, id, { canDeliverPush: () => reachable });
      const ok = r.send === want;
      if (!ok) failed++;
      console.log(`${ok ? '✅' : '❌'} ${mode.padEnd(15)} active=${lastActive.padEnd(27)} mobile=${device ? (reachable ? 'yes ' : 'yes, no push') : 'no  '} → email=${r.send} (${r.reason})`);
    }
  } finally {
    await clean().catch(() => {});
    await db.end();
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
