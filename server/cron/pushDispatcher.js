#!/usr/bin/env node
/**
 * Mobile push dispatcher.
 *
 * The web app has no event bus — notifications, DMs and group messages are
 * written straight to MySQL from ~a dozen places in server.js. Rather than hook
 * each insert, this daemon tails those tables by id (high-water marks in
 * mobile_push_state) and pushes to registered devices — Android via FCM, iOS via
 * APNs (server/lib/push.js).
 *
 * Usage:
 *   node server/cron/pushDispatcher.js               # dry-run once
 *   node server/cron/pushDispatcher.js --apply       # send once
 *   node server/cron/pushDispatcher.js --apply --daemon   # loop (PM2)
 *
 * Env: PUSH_DISPATCH_INTERVAL_SECS (default 20), FCM_SERVICE_ACCOUNT_FILE (Android),
 *      APNS_KEY_FILE / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID (iOS).
 * First run seeds the high-water marks to MAX(id) so history is never re-pushed.
 */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { sendPushToUsers } = require('../lib/push');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DAEMON = args.includes('--daemon');
const INTERVAL = parseInt(process.env.PUSH_DISPATCH_INTERVAL_SECS || '20', 10);
const log = (...a) => console.log(new Date().toISOString(), '[push]', ...a);
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

async function getMark(db, name, table) {
  const [[row]] = await db.execute('SELECT last_id FROM mobile_push_state WHERE name = ?', [name]);
  if (row) return row.last_id;
  const [[m]] = await db.query(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`);
  await db.execute('INSERT INTO mobile_push_state (name, last_id) VALUES (?, ?)', [name, m.id]);
  log(`seeded ${name} high-water mark at ${m.id}`);
  return m.id;
}
async function setMark(db, name, id) {
  await db.execute('UPDATE mobile_push_state SET last_id = ? WHERE name = ?', [id, name]);
}

const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);

async function send(db, userIds, msg) {
  if (!APPLY) { log(`  would push to ${JSON.stringify(userIds)}: ${msg.title} — ${msg.body}`); return; }
  const r = await sendPushToUsers(db, userIds, msg);
  if (r.sent || r.failed) log(`  pushed "${msg.title}" → sent ${r.sent}, failed ${r.failed}, disabled ${r.disabled}`);
}

async function dispatchNotifications(db) {
  const mark = await getMark(db, 'notifications', 'notifications');
  const [rows] = await db.execute(
    'SELECT id, user_id, type, title, message, data FROM notifications WHERE id > ? ORDER BY id ASC LIMIT 200', [mark]);
  for (const n of rows) {
    // DMs are pushed by dispatchDirectMessages (carries conversation_id for deep linking)
    if (n.type === 'direct_message') continue;
    let data = {};
    try { data = typeof n.data === 'string' ? JSON.parse(n.data) : (n.data || {}); } catch { /* ignore */ }
    await send(db, n.user_id, {
      title: n.title || 'Notification',
      body: strip(n.message),
      data: { kind: 'notification', notification_id: n.id, type: n.type, ...data }
    });
  }
  if (rows.length) await setMark(db, 'notifications', rows[rows.length - 1].id);
  return rows.length;
}

async function dispatchDirectMessages(db) {
  const mark = await getMark(db, 'direct_messages', 'direct_messages');
  const [rows] = await db.execute(
    `SELECT d.id, d.conversation_id, d.sender_id, d.recipient_id, d.content, u.name AS sender_name
     FROM direct_messages d JOIN users u ON u.id = d.sender_id
     WHERE d.id > ? AND d.deleted_at IS NULL ORDER BY d.id ASC LIMIT 200`, [mark]);
  for (const m of rows) {
    await send(db, m.recipient_id, {
      title: m.sender_name,
      body: strip(m.content),
      data: { kind: 'dm', conversation_id: m.conversation_id, sender_id: m.sender_id }
    });
  }
  if (rows.length) await setMark(db, 'direct_messages', rows[rows.length - 1].id);
  return rows.length;
}

async function dispatchGroupMessages(db) {
  const mark = await getMark(db, 'group_messages', 'group_messages');
  const [rows] = await db.execute(
    `SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.message_type, u.name AS sender_name, g.display_name
     FROM group_messages gm JOIN users u ON u.id = gm.sender_id JOIN \`groups\` g ON g.id = gm.group_id
     WHERE gm.id > ? AND gm.is_deleted = 0 ORDER BY gm.id ASC LIMIT 200`, [mark]);
  for (const m of rows) {
    if (m.message_type === 'system') continue;
    const [members] = await db.execute(
      'SELECT user_id FROM group_members WHERE group_id = ? AND user_id <> ?', [m.group_id, m.sender_id]);
    await send(db, members.map(x => x.user_id), {
      title: `${m.display_name}: ${m.sender_name}`,
      body: strip(m.content),
      data: { kind: 'group', group_id: m.group_id, sender_id: m.sender_id }
    });
  }
  if (rows.length) await setMark(db, 'group_messages', rows[rows.length - 1].id);
  return rows.length;
}

async function runOnce(db) {
  const n = await dispatchNotifications(db);
  const d = await dispatchDirectMessages(db);
  const g = await dispatchGroupMessages(db);
  if (n || d || g) log(`processed notifications=${n} dms=${d} group=${g}`);
}

async function main() {
  log(`apply=${APPLY} daemon=${DAEMON} interval=${INTERVAL}s`);
  const db = makePool();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    do {
      try { await runOnce(db); } catch (err) { console.error('[push] pass error:', err.message); }
      if (DAEMON && !stopping) await sleep(INTERVAL * 1000);
    } while (DAEMON && !stopping);
  } finally { await db.end(); }
}

if (require.main === module) main().catch(err => { console.error('Fatal:', err); process.exit(1); });
module.exports = { runOnce };
