/**
 * Firebase Cloud Messaging HTTP v1 client (no extra dependency — axios and
 * jsonwebtoken are already deps, so we mint the OAuth2 access token ourselves
 * rather than pulling in google-auth-library / firebase-admin).
 *
 * Docs: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send
 *
 * Tokens are FCM registration tokens registered by the mobile app via
 * POST /api/mobile/devices (expo-notifications getDevicePushTokenAsync()).
 * Tokens FCM reports as dead (UNREGISTERED / INVALID_ARGUMENT) are deactivated
 * in mobile_devices so we stop paying for them.
 *
 * Credentials (one of, checked in this order):
 *   FCM_SERVICE_ACCOUNT_JSON  inline service-account JSON
 *   FCM_SERVICE_ACCOUNT_FILE  path to the service-account JSON  (what prod uses)
 *
 * iOS is NOT sent through FCM: the app registers a raw APNs device token
 * (64 hex chars), which FCM rejects. server/lib/apnsPush.js delivers those
 * directly and server/lib/push.js routes by token shape.
 */
const fs = require('fs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CONCURRENCY = 20; // FCM v1 has no multicast endpoint — one request per token

let creds; // undefined = not loaded yet, null = not configured
let cachedToken = null; // { value, expiresAt }
let warnedMissing = false;

function loadCredentials() {
  if (creds !== undefined) return creds;
  try {
    const inline = process.env.FCM_SERVICE_ACCOUNT_JSON;
    const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
    const raw = inline || (file && fs.readFileSync(file, 'utf8'));
    if (!raw) { creds = null; return creds; }
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      console.error('[fcmPush] service account JSON missing client_email / private_key / project_id');
      creds = null; return creds;
    }
    creds = parsed;
  } catch (err) {
    console.error('[fcmPush] could not load service account:', err.message);
    creds = null;
  }
  return creds;
}

/** OAuth2 JWT-bearer grant. Access tokens live an hour; refresh a minute early. */
async function getAccessToken() {
  const c = loadCredentials();
  if (!c) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: c.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    c.private_key,
    { algorithm: 'RS256' }
  );
  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
  );
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

/**
 * FCM registration tokens are long opaque strings (no fixed format, and the
 * shape has changed over the years) — validate loosely rather than guess a regex.
 */
function isPushToken(t) {
  return typeof t === 'string' && t.length >= 64 && t.length <= 4096 && !/\s/.test(t);
}

/** FCM data payloads must be flat string→string. */
function stringifyData(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return out;
}

function fcmErrorCode(err) {
  const details = err.response?.data?.error?.details || [];
  const d = details.find(x => x['@type']?.endsWith('FcmError'));
  return d?.errorCode || err.response?.data?.error?.status || null;
}

function buildMessage(token, msg) {
  const body = {
    message: {
      token,
      notification: { title: msg.title, body: msg.body },
      data: stringifyData(msg.data),
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: msg.channelId || 'default',
          sound: msg.sound === null ? undefined : (msg.sound || 'default')
        }
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            sound: msg.sound === null ? undefined : (msg.sound || 'default'),
            badge: typeof msg.badge === 'number' ? msg.badge : undefined
          }
        }
      }
    }
  };
  return body;
}

/**
 * Send one message to a list of mobile_devices rows (id, push_token) that hold
 * FCM registration tokens. iOS rows (APNs tokens) are handled by apnsPush.js;
 * server/lib/push.js routes between the two.
 * @returns {Promise<{sent:number, failed:number, disabled:number}>}
 */
async function sendToDevices(db, devices, msg) {
  const targets = (devices || []).filter(d => isPushToken(d.push_token));
  if (targets.length === 0) return { sent: 0, failed: 0, disabled: 0 };

  const c = loadCredentials();
  if (!c) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error('[fcmPush] no FCM credentials configured (set FCM_SERVICE_ACCOUNT_FILE) — pushes disabled');
    }
    return { sent: 0, failed: targets.length, disabled: 0 };
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error('[fcmPush] could not mint access token:', err.response?.data || err.message);
    return { sent: 0, failed: targets.length, disabled: 0 };
  }
  if (!accessToken) return { sent: 0, failed: targets.length, disabled: 0 };

  const url = `https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  let sent = 0, failed = 0;
  const dead = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (d) => {
      try {
        await axios.post(url, buildMessage(d.push_token, msg), { headers, timeout: 15000 });
        sent++;
      } catch (err) {
        failed++;
        const code = fcmErrorCode(err);
        // Only these two mean "this token is dead". INVALID_ARGUMENT is deliberately
        // NOT here: FCM also returns it for a malformed *message*, so treating it as a
        // bad token would deactivate every device at once on a payload bug.
        if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') {
          dead.push(d.id);
        } else {
          console.error('[fcmPush] send failed:', code || err.message,
            code === 'INVALID_ARGUMENT' ? JSON.stringify(err.response?.data?.error?.message) : '');
        }
      }
    }));
  }

  if (dead.length) {
    await db.query('UPDATE mobile_devices SET is_active = 0 WHERE id IN (?)', [dead]);
  }
  return { sent, failed, disabled: dead.length };
}

/** Kept for callers that still address users directly; prefer server/lib/push.js. */
async function sendPushToUsers(db, userIds, msg) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean);
  if (ids.length === 0) return { sent: 0, failed: 0, disabled: 0 };
  const [devices] = await db.query(
    'SELECT id, user_id, push_token FROM mobile_devices WHERE is_active = 1 AND user_id IN (?)',
    [ids]
  );
  return sendToDevices(db, devices, msg);
}

module.exports = { sendPushToUsers, sendToDevices, isPushToken };
