#!/usr/bin/env node
/**
 * Scheduled webmail sender.
 *
 * Polls `scheduled_emails` for rows whose scheduled_at (UTC) has passed, claims
 * each one atomically (status scheduled → sending) and sends it through the same
 * EmailManager.sendEmail() path the Compose button uses — so the message lands
 * in the account's Sent folder and in `sent_emails` exactly like a manual send.
 *
 * Failed sends retry up to MAX_ATTEMPTS (3) five minutes apart, then stay
 * `failed` with last_error for the user to see on the Scheduled tab.
 * Rows stuck in `sending` for 10+ minutes (worker crashed mid-send) are
 * released back to the queue at the start of each pass.
 *
 * Usage:
 *   node server/cron/scheduledEmailSender.js                  # dry-run once (lists due rows)
 *   node server/cron/scheduledEmailSender.js --apply          # send due rows once
 *   node server/cron/scheduledEmailSender.js --apply --daemon # loop (PM2: owtranet-scheduled-mail)
 *
 * Env: SCHEDULED_EMAIL_INTERVAL_SECS (default 30), plus the DB_* vars from .env.
 */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { EmailManager } = require('../../emailUtils');
const sched = require('../lib/scheduledEmails');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DAEMON = args.includes('--daemon');
const INTERVAL = parseInt(process.env.SCHEDULED_EMAIL_INTERVAL_SECS || '30', 10);
const log = (...a) => console.log(new Date().toISOString(), '[scheduled-mail]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'intranet_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'owtranet',
    waitForConnections: true, connectionLimit: 2
  });
}

async function runOnce(db, emailManager) {
  const released = await sched.releaseStale(db);
  if (released) log(`released ${released} stale 'sending' row(s) back to the queue`);

  const due = await sched.findDue(db);
  if (due.length === 0) return 0;

  if (!APPLY) {
    const [rows] = await db.query(
      `SELECT id, user_id, to_addr, subject, scheduled_at, attempts FROM scheduled_emails WHERE id IN (${due.map(Number).join(',')})`
    );
    for (const r of rows) log(`  would send #${r.id} to ${r.to_addr} "${r.subject}" (due ${r.scheduled_at}, attempts ${r.attempts})`);
    return rows.length;
  }

  let sent = 0;
  for (const id of due) {
    if (!(await sched.claim(db, id))) continue; // someone else got it (send-now from the API, or a second worker)
    const r = await sched.sendClaimed(db, emailManager, id);
    if (r.outcome === 'sent') { sent++; log(`  sent #${id} (${r.messageId || 'no message id'})`); }
    else log(`  #${id} ${r.outcome}: ${r.error}`);
  }
  return sent;
}

async function main() {
  log(`apply=${APPLY} daemon=${DAEMON} interval=${INTERVAL}s`);
  const db = makePool();
  const emailManager = new EmailManager();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    do {
      try { await runOnce(db, emailManager); } catch (err) { console.error('[scheduled-mail] pass error:', err.message); }
      if (DAEMON && !stopping) await sleep(INTERVAL * 1000);
    } while (DAEMON && !stopping);
  } finally { await db.end(); }
}

if (require.main === module) main().catch(err => { console.error('Fatal:', err); process.exit(1); });
module.exports = { runOnce };
