#!/usr/bin/env node
/**
 * Send a test push to a user's registered devices (iOS via APNs, Android via
 * FCM) without touching notifications / DMs. Verifies credentials, the token
 * on file, and delivery in one go.
 *
 * Usage (on the box, reads .env):
 *   node server/scripts/sendTestPush.js --user 4
 *   node server/scripts/sendTestPush.js --user 4 --title "Hello" --body "Test from the intranet"
 *   node server/scripts/sendTestPush.js --user 4 --dm 12      # deep-links to /messages/12 on tap
 */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const push = require('../lib/push');
const apns = require('../lib/apnsPush');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const userId = parseInt(opt('user', ''), 10);
if (!userId) { console.error('usage: --user <id> [--title ..] [--body ..] [--dm <conversation_id>]'); process.exit(2); }

(async () => {
  const db = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'intranet_user',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'owtranet', connectionLimit: 2
  });
  try {
    const [devices] = await db.query(
      'SELECT id, platform, LEFT(push_token, 10) AS tok, LENGTH(push_token) AS len, is_active, last_seen_at FROM mobile_devices WHERE user_id = ? ORDER BY id',
      [userId]);
    console.table(devices);
    const dm = opt('dm', null);
    const msg = {
      title: opt('title', 'Intranet test push'),
      body: opt('body', `Sent ${new Date().toISOString()} — if you can read this, push works.`),
      data: dm ? { kind: 'dm', conversation_id: dm } : { kind: 'notification' }
    };
    const r = await push.sendPushToUsers(db, userId, msg);
    console.log('result:', r);
  } finally {
    apns.close();
    await db.end();
  }
})().catch(err => { console.error(err); process.exit(1); });
