// Unit tests for server/lib/emailNotifications.js. Run: npm test
// The database is stubbed; test/db/upgrade-test.sh covers real MySQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkEmailNotification, touchUserActivity, clearUserActivity, awayMinutes, EMAIL_NOTIFICATION_MODES } = require('../server/lib/emailNotifications');

const sqlError = (code) => Object.assign(new Error(code), { code });

/** Fake mysql2 pool: one user row, optional active mobile device, optional missing schema. */
function fakeDb({ mode = 'when_away', recentlyActive = false, devices = 0, noModeColumn = false, noDevicesTable = false } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push(sql);
      if (/FROM mobile_devices/.test(sql)) {
        if (noDevicesTable) throw sqlError('ER_NO_SUCH_TABLE');
        return [[{ n: devices }]];
      }
      if (/email_notification_mode/.test(sql) && noModeColumn) throw sqlError('ER_BAD_FIELD_ERROR');
      if (/FROM users/.test(sql)) {
        if (params[0] === 404) return [[]];
        return [[{ id: params[0], email: 'a@example.com', name: 'A', company_email: null,
          email_notification_preference: 'company', email_notification_mode: mode, recently_active: recentlyActive ? 1 : 0 }]];
      }
      if (/^UPDATE users SET last_active_at/.test(sql)) {
        if (noModeColumn) throw sqlError('ER_BAD_FIELD_ERROR');
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

const cases = [
  // mode,            active, device, expected send
  ['when_away',       false,  false,  true],
  ['when_away',       true,   false,  false],
  ['when_away',       false,  true,   true],   // a signed-in phone alone doesn't stop email in this mode
  ['when_signed_out', false,  false,  true],
  ['when_signed_out', false,  true,   false],
  ['when_signed_out', true,   false,  false],
  ['always',          true,   true,   true],
  ['never',           false,  false,  false],
  [null,              true,   false,  false],  // unknown/NULL mode → default when_away
];

for (const [mode, active, device, want] of cases) {
  test(`mode=${mode} active=${active} mobile=${device} → send=${want}`, async () => {
    const r = await checkEmailNotification(fakeDb({ mode, recentlyActive: active, devices: device ? 1 : 0 }), 7);
    assert.equal(r.send, want, r.reason);
    assert.equal(r.user.id, 7);
  });
}

test('every documented mode is handled', () => {
  assert.deepEqual(EMAIL_NOTIFICATION_MODES, ['always', 'when_away', 'when_signed_out', 'never']);
});

test('unknown user → no email', async () => {
  const r = await checkEmailNotification(fakeDb(), 404);
  assert.equal(r.user, null);
  assert.equal(r.send, false);
});

test('database without the migration still emails (fails open)', async () => {
  const r = await checkEmailNotification(fakeDb({ noModeColumn: true }), 7);
  assert.equal(r.send, true);
  assert.equal(r.user.email, 'a@example.com');
});

test('instance without mobile_devices table: when_signed_out still emails', async () => {
  const r = await checkEmailNotification(fakeDb({ mode: 'when_signed_out', noDevicesTable: true }), 7);
  assert.equal(r.send, true);
});

test('away window comes from EMAIL_NOTIFY_AWAY_MINUTES', async () => {
  process.env.EMAIL_NOTIFY_AWAY_MINUTES = '5';
  try {
    const db = fakeDb();
    await checkEmailNotification(db, 7);
    assert.match(db.calls[0], /INTERVAL 5 MINUTE/);
  } finally {
    delete process.env.EMAIL_NOTIFY_AWAY_MINUTES;
  }
});

test('activity is written at most once a minute per user', () => {
  const db = fakeDb();
  touchUserActivity(db, 99);
  touchUserActivity(db, 99);
  touchUserActivity(db, 100);
  assert.equal(db.calls.filter(s => s.startsWith('UPDATE users SET last_active_at')).length, 2);
});

test('default away window is 10 minutes', async () => {
  assert.equal(awayMinutes(), 10);
  const db = fakeDb();
  await checkEmailNotification(db, 7);
  assert.match(db.calls[0], /INTERVAL 10 MINUTE/);
});

test('sign-out clears presence and holds off the next stamp', async () => {
  const db = fakeDb();
  await clearUserActivity(db, 123);
  assert.deepEqual(db.calls, ['UPDATE users SET last_active_at = NULL WHERE id = ?']);
  touchUserActivity(db, 123);   // e.g. a request already in flight from the tab that signed out
  assert.equal(db.calls.length, 1);
});

test('sign-out on a database without the migration is a no-op', async () => {
  await assert.doesNotReject(clearUserActivity(fakeDb({ noModeColumn: true }), 124));
});
