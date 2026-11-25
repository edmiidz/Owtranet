/**
 * Should a mention / comment / direct-message notification also go out by email?
 *
 * Every member picks a users.email_notification_mode:
 *   always           email every time
 *   when_away        (default) only if they haven't used the web or mobile app in
 *                    the last EMAIL_NOTIFY_AWAY_MINUTES (default 10)
 *   when_signed_out  as when_away, and also not while they are signed in to the
 *                    mobile app (an active mobile_devices row this server can
 *                    push to: FCM / APNs configured for that token)
 *   never            never; in-app and push notifications only
 *
 * "Used the app" is users.last_active_at, stamped by touchUserActivity() from
 * the JWT middleware. A signed-in web tab sends POST /api/presence every couple
 * of minutes even while it is in the background, and the mobile app polls while
 * it is open, so the stamp stays fresh exactly while a session is open. Closing
 * the tab, sleeping the computer or signing out (clearUserActivity) stops it.
 * Which address(es) to use is the separate email_notification_preference.
 */

const EMAIL_NOTIFICATION_MODES = ['always', 'when_away', 'when_signed_out', 'never'];
const DEFAULT_EMAIL_NOTIFICATION_MODE = 'when_away';

function awayMinutes() {
  const n = parseInt(process.env.EMAIL_NOTIFY_AWAY_MINUTES || '', 10);
  return Number.isInteger(n) && n > 0 ? n : 10;
}

// Write last_active_at at most once a minute per user per process, so polling
// clients don't turn every request into an UPDATE.
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
const lastActivityWrite = new Map();
let activityErrorLogged = false;

function touchUserActivity(db, userId) {
  if (!db || !userId) return;
  const now = Date.now();
  const last = lastActivityWrite.get(userId) || 0;
  if (now - last < ACTIVITY_WRITE_INTERVAL_MS) return;
  lastActivityWrite.set(userId, now);
  db.execute('UPDATE users SET last_active_at = NOW() WHERE id = ?', [userId]).catch(err => {
    lastActivityWrite.delete(userId);
    if (!activityErrorLogged) {
      activityErrorLogged = true;
      console.error('Could not record user activity (is server/migrations/add_email_notification_mode.sql applied?):', err.message);
    }
  });
}

/**
 * Sign-out: forget the user's presence so notification emails start again at
 * once instead of after the away window. Another open session (a second tab, the
 * mobile app) stamps it again on its next request, at most a minute later.
 */
async function clearUserActivity(db, userId) {
  if (!db || !userId) return;
  // Hold off this process's next stamp for the throttle interval, so the
  // sign-out isn't undone by a request already in flight from the same tab.
  lastActivityWrite.set(userId, Date.now());
  try {
    await db.execute('UPDATE users SET last_active_at = NULL WHERE id = ?', [userId]);
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
  }
}

let schemaWarningLogged = false;
function warnSchemaOnce(err) {
  if (schemaWarningLogged) return;
  schemaWarningLogged = true;
  console.error(`Email notification settings unavailable (${err.code}); emailing as before. ` +
    'Apply server/migrations/add_email_notification_mode.sql (see `node scripts/check-schema.js`).');
}

/**
 * Load the recipient and decide. Comparisons run in SQL (NOW()) so the Node and
 * MySQL time zones can't disagree about "recent".
 *
 * Fails open: on a database where add_email_notification_mode.sql hasn't been
 * applied yet, this behaves as before (email is sent) rather than silently
 * dropping notifications.
 *
 * `opts.canDeliverPush(token)` decides whether a registered mobile device can
 * actually receive a push (default: this server's FCM / APNs configuration,
 * server/lib/push.js). Tests pass their own.
 *
 * @returns {Promise<{user: object|null, send: boolean, reason: string}>}
 */
async function checkEmailNotification(db, userId, { canDeliverPush = defaultCanDeliverPush } = {}) {
  const mins = awayMinutes();
  let rows;
  try {
    [rows] = await db.execute(
      `SELECT u.id, u.email, u.name, u.company_email, u.email_notification_preference,
              u.email_notification_mode,
              (u.last_active_at IS NOT NULL AND u.last_active_at >= NOW() - INTERVAL ${mins} MINUTE) AS recently_active
         FROM users u WHERE u.id = ?`,
      [userId]
    );
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    warnSchemaOnce(err);
    [rows] = await db.execute(
      'SELECT id, email, name, company_email, email_notification_preference FROM users WHERE id = ?',
      [userId]
    );
    if (rows.length === 0) return { user: null, send: false, reason: 'no such user' };
    return { user: rows[0], send: true, reason: 'notification settings not migrated yet' };
  }
  if (rows.length === 0) return { user: null, send: false, reason: 'no such user' };
  const user = rows[0];
  const mode = EMAIL_NOTIFICATION_MODES.includes(user.email_notification_mode)
    ? user.email_notification_mode
    : DEFAULT_EMAIL_NOTIFICATION_MODE;

  if (mode === 'never') return { user, send: false, reason: 'email notifications turned off' };
  if (mode === 'always') return { user, send: true, reason: 'always' };
  if (Number(user.recently_active)) {
    return { user, send: false, reason: `active on web or mobile in the last ${mins} min` };
  }
  if (mode === 'when_signed_out') {
    try {
      const [devices] = await db.execute(
        'SELECT push_token FROM mobile_devices WHERE user_id = ? AND is_active = 1',
        [userId]
      );
      // A signed-in phone replaces the email only if a push can actually reach it.
      if (devices.some(d => canDeliverPush(d.push_token))) {
        return { user, send: false, reason: 'signed in to the mobile app' };
      }
      if (devices.length > 0) {
        return { user, send: true, reason: "away (signed in to the mobile app, but this server can't send it push notifications)" };
      }
    } catch (err) {
      // Instance without the mobile app tables: nobody can be signed in to it.
      if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
  }
  return { user, send: true, reason: 'away' };
}

// Loaded lazily so code that only stamps presence doesn't load the push senders.
function defaultCanDeliverPush(token) {
  return require('./push').canDeliverTo(token);
}

module.exports = {
  EMAIL_NOTIFICATION_MODES,
  awayMinutes,
  DEFAULT_EMAIL_NOTIFICATION_MODE,
  touchUserActivity,
  clearUserActivity,
  checkEmailNotification
};
