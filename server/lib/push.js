/**
 * Mobile push — one entry point, routed per platform:
 *   Android  → server/lib/fcmPush.js  (FCM HTTP v1, FCM registration tokens)
 *   iOS      → server/lib/apnsPush.js (APNs HTTP/2, raw APNs device tokens)
 *
 * The app registers whatever getDevicePushTokenAsync() returns on its platform
 * (POST /api/mobile/devices), so the token shape decides the sender: 64 hex
 * chars is APNs, anything longer is FCM. The platform column is a hint only —
 * a mislabelled row still goes to the sender that can actually deliver it.
 */
const fcm = require('./fcmPush');
const apns = require('./apnsPush');

/**
 * @param {object} db mysql2/promise pool
 * @param {number|number[]} userIds
 * @param {{title:string, body:string, data?:object, sound?:string|null, badge?:number, channelId?:string}} msg
 * @returns {Promise<{sent:number, failed:number, disabled:number}>}
 */
async function sendPushToUsers(db, userIds, msg) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (ids.length === 0) return { sent: 0, failed: 0, disabled: 0 };

  const [devices] = await db.query(
    'SELECT id, user_id, platform, push_token FROM mobile_devices WHERE is_active = 1 AND user_id IN (?)',
    [ids]
  );
  return sendToDevices(db, devices, msg);
}

async function sendToDevices(db, devices, msg) {
  const ios = devices.filter(d => apns.isApnsToken(d.push_token));
  const android = devices.filter(d => !apns.isApnsToken(d.push_token) && fcm.isPushToken(d.push_token));
  const [a, b] = await Promise.all([
    android.length ? fcm.sendToDevices(db, android, msg) : { sent: 0, failed: 0, disabled: 0 },
    ios.length ? apns.sendToDevices(db, ios, msg) : { sent: 0, failed: 0, disabled: 0 }
  ]);
  return { sent: a.sent + b.sent, failed: a.failed + b.failed, disabled: a.disabled + b.disabled };
}

/** Accepts either token shape at registration time. */
function isPushToken(t) {
  return apns.isApnsToken(t) || fcm.isPushToken(t);
}

module.exports = { sendPushToUsers, sendToDevices, isPushToken };
