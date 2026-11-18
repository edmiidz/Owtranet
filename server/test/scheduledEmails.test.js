const assert = require('node:assert/strict');
const { test } = require('node:test');
const scheduled = require('../lib/scheduledEmails');
const { runOnce } = require('../cron/scheduledEmailSender');

const claimRow = {
  id: 1,
  attempts: 1,
  email_account_id: 3,
  email_address: 'sender@example.com',
  server_username: 'sender@example.com',
  email_password_encrypted: 'synthetic-fixture',
  server_status: 'active',
  to_addr: 'recipient@example.com',
  subject: 'Fixture',
  attachments: [],
};

function submissionDb(row = claimRow, { failRecording = false } = {}) {
  const writes = [];
  return {
    writes,
    async execute(sql, params) {
      if (sql.startsWith('SELECT')) return [[row]];
      writes.push({ sql, params });
      if (failRecording && sql.includes("SET status = 'sent'")) throw new Error('Database unavailable');
      return [{ affectedRows: 1 }];
    },
  };
}

test('SMTP acceptance records sent for the original attempt, including a late confirmation', async () => {
  const db = submissionDb();
  const mail = { sendEmail: async () => ({ messageId: '<accepted@example.com>', rejected: [] }) };
  const result = await scheduled.sendClaimed(db, mail, 1);
  assert.equal(result.outcome, 'sent');
  assert.equal(db.writes.length, 1);
  assert.match(db.writes[0].sql, /SET status = 'sent'/);
  assert.match(db.writes[0].sql, /status IN \('sending','delivery_unknown'\) AND attempts = \?/);
  assert.deepEqual(db.writes[0].params, ['<accepted@example.com>', 1, 1]);
});

test('failure to record an accepted submission never schedules another submission', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = submissionDb(claimRow, { failRecording: true });
  const mail = { sendEmail: async () => ({ messageId: '<accepted@example.com>' }) };
  const result = await scheduled.sendClaimed(db, mail, 1);
  assert.equal(result.outcome, 'delivery_unknown');
  assert.equal(db.writes.length, 2);
  assert.match(db.writes[1].sql, /SET status = 'delivery_unknown'/);
  assert.equal(db.writes[1].params[1], '<accepted@example.com>');
  assert.match(result.error, /SMTP accepted/);
});

test('a connection loss during submission records unresolved delivery', async () => {
  const db = submissionDb();
  const timeout = Object.assign(new Error('Connection closed'), {
    code: 'ECONNECTION',
    command: 'CONN',
    responseCode: 451,
    response: '451 Partial line before disconnect',
  });
  const mail = { sendEmail: async () => { throw timeout; } };
  const result = await scheduled.sendClaimed(db, mail, 1);
  assert.equal(result.outcome, 'delivery_unknown');
  assert.equal(db.writes.length, 1);
  assert.match(db.writes[0].sql, /SET status = 'delivery_unknown'/);
});

test('a failed OS connect operation can safely retry', async () => {
  const db = submissionDb();
  const refused = Object.assign(new Error('Connection refused'), { code: 'ESOCKET', syscall: 'connect' });
  const mail = { sendEmail: async () => { throw refused; } };
  assert.equal((await scheduled.sendClaimed(db, mail, 1)).outcome, 'retry');
  assert.equal(db.writes[0].params[0], 'scheduled');
});

test('a definite temporary rejection retries within the attempt limit', async () => {
  const rejected = Object.assign(new Error('Temporary failure'), {
    responseCode: 451,
    command: 'DATA',
    response: '451 Temporary failure',
  });
  const mail = { sendEmail: async () => { throw rejected; } };
  const db = submissionDb();
  assert.equal((await scheduled.sendClaimed(db, mail, 1)).outcome, 'retry');
  assert.deepEqual(db.writes[0].params, ['scheduled', 'Temporary failure', 1, 5, 1, 1]);

  const exhausted = submissionDb({ ...claimRow, attempts: scheduled.MAX_ATTEMPTS });
  assert.equal((await scheduled.sendClaimed(exhausted, mail, 1)).outcome, 'failed');
  assert.equal(exhausted.writes[0].params[0], 'failed');
});

test('a definite permanent SMTP rejection stays failed', async () => {
  const rejected = Object.assign(new Error('Mailbox unavailable'), {
    responseCode: 550,
    command: 'RCPT TO',
    response: '550 Mailbox unavailable',
  });
  const db = submissionDb();
  const mail = { sendEmail: async () => { throw rejected; } };
  assert.equal((await scheduled.sendClaimed(db, mail, 1)).outcome, 'failed');
  assert.equal(db.writes[0].params[0], 'failed');
});

test('worker dry-run reads the due list without recovering or submitting rows', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = {
    async execute() { assert.fail('dry-run must not issue writes'); },
    async query(sql) {
      assert.match(sql, /^SELECT /);
      return [[{ id: 1, to_addr: 'recipient@example.com', subject: 'Fixture' }]];
    },
  };
  const mail = { sendEmail() { assert.fail('dry-run must not submit mail'); } };
  assert.equal(await runOnce(db, mail, { apply: false }), 1);
});

test('worker recovery leaves stale sends out of the due list', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = {
    async execute(sql) {
      assert.match(sql, /SET status = 'delivery_unknown'/);
      assert.match(sql, /WHERE status = 'sending' AND updated_at/);
      return [{ affectedRows: 1 }];
    },
    async query(sql) {
      assert.match(sql, /WHERE status = 'scheduled'/);
      return [[]];
    },
  };
  const mail = { sendEmail() { assert.fail('worker must not resubmit stale rows'); } };
  assert.equal(await runOnce(db, mail, { apply: true }), 0);
});
