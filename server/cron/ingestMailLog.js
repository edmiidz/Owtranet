/**
 * Ingest authenticated sends from the Postfix mail log into smtp_sent_log
 * so GET /api/v1/activity counts every email a member sent from
 * their company mailbox, not only webmail sends (sent_emails).
 *
 * Reads /var/log/mail.log and its rotations (mail.log.1, mail.log.N.gz) oldest
 * first, parses them with server/lib/mailLogParser.js, and inserts one row per
 * message. INSERT IGNORE on (queue_id, sent_at) makes every run idempotent, so
 * it can re-read the whole retained log each time. Only the sender login,
 * queue id, time and recipient count are stored: no subjects, bodies or
 * recipient addresses.
 *
 * The mail log is readable by root / the adm group only: run it as root (like
 * the role-mailbox responder) or as a user in adm.
 *
 * SAFETY: DRY-RUN by default. Writes only with --apply.
 *   Dry run:   node server/cron/ingestMailLog.js
 *   Real run:  node server/cron/ingestMailLog.js --apply
 *   Other dir: node server/cron/ingestMailLog.js --log-dir=/var/log --log-name=mail.log
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { createMailLogParser } = require('../lib/mailLogParser');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const opt = (name, def) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const LOG_DIR = opt('log-dir', process.env.MAIL_LOG_DIR || '/var/log');
const LOG_NAME = opt('log-name', process.env.MAIL_LOG_NAME || 'mail.log');
const BATCH = 500;

/**
 * mail.log and its rotations, oldest first: mail.log.9.gz … mail.log.2.gz,
 * mail.log.1, mail.log.
 */
function logFiles(dir, name) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    throw new Error(`cannot read ${dir}: ${err.message}`);
  }
  const rotation = (f) => {
    if (f === name) return 0;
    const m = f.match(new RegExp(`^${name.replace(/\./g, '\\.')}\\.(\\d+)(\\.gz)?$`));
    return m ? Number(m[1]) : null;
  };
  return entries
    .map(f => ({ f, n: rotation(f) }))
    .filter(x => x.n !== null)
    .sort((a, b) => b.n - a.n)
    .map(x => path.join(dir, x.f));
}

async function feedFile(file, parser) {
  let stream = fs.createReadStream(file);
  if (file.endsWith('.gz')) stream = stream.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    parser.push(line);
    lines++;
  }
  return lines;
}

async function insertSends(db, sends) {
  let inserted = 0;
  for (let i = 0; i < sends.length; i += BATCH) {
    const chunk = sends.slice(i, i + BATCH);
    const [res] = await db.query(
      'INSERT IGNORE INTO smtp_sent_log (queue_id, sender, sent_at, recipient_count) VALUES ?',
      [chunk.map(s => [s.queueId, s.sender, s.sentAt, s.recipientCount])]
    );
    inserted += res.affectedRows;
  }
  return inserted;
}

async function main() {
  console.log(`\n📬 [mail-log-ingest] ${new Date().toISOString()}`);
  console.log(`   Mode: ${APPLY ? '🔴 APPLY (will write)' : '🟢 DRY-RUN (no changes)'}`);

  const files = logFiles(LOG_DIR, LOG_NAME);
  if (!files.length) throw new Error(`no ${LOG_NAME}* files in ${LOG_DIR}`);

  const parser = createMailLogParser();
  for (const file of files) {
    const lines = await feedFile(file, parser);
    console.log(`   read ${file} (${lines} lines)`);
  }
  const sends = parser.sends();

  const bySender = new Map();
  for (const s of sends) bySender.set(s.sender, (bySender.get(s.sender) || 0) + 1);
  console.log(`\n📊 ${sends.length} authenticated sends from ${bySender.size} mailbox(es)` +
    (sends.length ? `, ${sends[0].sentAt.toISOString()} → ${sends[sends.length - 1].sentAt.toISOString()}` : ''));
  for (const [sender, n] of [...bySender].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${sender}`);

  if (!APPLY) {
    console.log('\n   Re-run with --apply to write them to smtp_sent_log.');
    return;
  }

  const mysql = require('mysql2/promise');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'intranet_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'owtranet',
  });
  try {
    const inserted = await insertSends(db, sends);
    console.log(`\n✅ ${inserted} new row(s) in smtp_sent_log (${sends.length - inserted} already there).`);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ [mail-log-ingest] error:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { logFiles, feedFile, insertSends };
