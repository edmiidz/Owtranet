/**
 * Apple Push Notification service (APNs) HTTP/2 client — iOS side of push.
 *
 * No extra dependency: Node's built-in http2 module talks to APNs, and
 * jsonwebtoken (already a dep) signs the ES256 provider token.
 *
 * Docs: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 *
 * Tokens are raw APNs device tokens (64 hex chars) registered by the app via
 * POST /api/mobile/devices — expo-notifications' getDevicePushTokenAsync()
 * returns exactly that on iOS, so the app needs no Firebase SDK. Tokens APNs
 * reports as dead (BadDeviceToken / Unregistered / DeviceTokenNotForTopic) are
 * deactivated in mobile_devices.
 *
 * Env:
 *   APNS_KEY_FILE   path to the .p8 auth key (team-wide; any app on the team)
 *   APNS_KEY_ID     the key's 10-char id (from developer.apple.com → Keys)
 *   APNS_TEAM_ID    Apple team id
 *   APNS_BUNDLE_ID  the app's bundle id (apns-topic), e.g. com.example.owtranet
 *   APNS_ENV        production (TestFlight / App Store — default) or sandbox
 *                   (Xcode debug builds). A BadDeviceToken from one environment
 *                   is retried once against the other so a dev build still gets
 *                   its push, and the environment that worked is remembered per
 *                   token for the rest of the process. The key must therefore be
 *                   valid for BOTH environments (Apple lets a key be restricted to
 *                   one — a production-only key answers sandbox with
 *                   BadEnvironmentKeyInToken).
 *
 * Missing configuration logs once and sends nothing; it never throws into the
 * dispatcher.
 */
const fs = require('fs');
const http2 = require('http2');
const jwt = require('jsonwebtoken');

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com'
};
const CONCURRENCY = 20;
const TOKEN_TTL_MS = 50 * 60 * 1000; // Apple accepts provider tokens for 60 min; refresh at 50
const DEAD_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

let config; // undefined = not loaded, null = not configured
let providerToken = null; // { value, issuedAt }
let warnedMissing = false;
const sessions = {}; // env -> ClientHttp2Session
const tokenEnv = new Map(); // device token -> env that accepted it (dev builds live in sandbox)

function loadConfig() {
  if (config !== undefined) return config;
  const { APNS_KEY_FILE, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_ENV } = process.env;
  if (!APNS_KEY_FILE || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_BUNDLE_ID) { config = null; return config; }
  try {
    config = {
      key: fs.readFileSync(APNS_KEY_FILE, 'utf8'),
      keyId: APNS_KEY_ID,
      teamId: APNS_TEAM_ID,
      bundleId: APNS_BUNDLE_ID,
      env: APNS_ENV === 'sandbox' ? 'sandbox' : 'production'
    };
  } catch (err) {
    console.error('[apnsPush] could not read APNS_KEY_FILE:', err.message);
    config = null;
  }
  return config;
}

/** ES256 provider token, reused for 50 minutes (Apple rate-limits refreshes). */
function getProviderToken(c) {
  if (providerToken && Date.now() - providerToken.issuedAt < TOKEN_TTL_MS) return providerToken.value;
  const value = jwt.sign({ iss: c.teamId, iat: Math.floor(Date.now() / 1000) }, c.key, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: c.keyId }
  });
  providerToken = { value, issuedAt: Date.now() };
  return value;
}

function getSession(env) {
  let s = sessions[env];
  if (s && !s.closed && !s.destroyed) return s;
  s = http2.connect(HOSTS[env]);
  s.on('error', (err) => { console.error(`[apnsPush] ${env} session error:`, err.message); });
  s.on('close', () => { if (sessions[env] === s) delete sessions[env]; });
  sessions[env] = s;
  return s;
}

/** APNs device tokens are 64 hex chars. */
function isApnsToken(t) {
  return typeof t === 'string' && /^[0-9a-fA-F]{64}$/.test(t);
}

function buildPayload(msg) {
  const aps = {
    alert: { title: msg.title, body: msg.body },
    sound: msg.sound === null ? undefined : (msg.sound || 'default'),
    badge: typeof msg.badge === 'number' ? msg.badge : undefined,
    'thread-id': msg.data && msg.data.conversation_id ? `dm-${msg.data.conversation_id}`
      : (msg.data && msg.data.group_id ? `group-${msg.data.group_id}` : undefined)
  };
  Object.keys(aps).forEach(k => aps[k] === undefined && delete aps[k]);
  // expo-notifications on iOS exposes a REMOTE notification's data as
  // userInfo["body"] only (NotificationRecords.swift, serializedNotificationData),
  // so the deep-link keys go under `body`; top-level custom keys are invisible to
  // the app and the tap does nothing. Values are strings to match the FCM path.
  const data = {};
  for (const [k, v] of Object.entries(msg.data || {})) {
    if (v === undefined || v === null) continue;
    data[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  return JSON.stringify({ aps, body: data });
}

/** One request. Resolves { status, reason } — never rejects. */
function sendOne(env, c, token, body) {
  return new Promise((resolve) => {
    let session;
    try { session = getSession(env); } catch (err) { return resolve({ status: 0, reason: err.message }); }
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${getProviderToken(c)}`,
      'apns-topic': c.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
      'content-type': 'application/json'
    });
    let status = 0;
    let chunks = '';
    const timer = setTimeout(() => { req.close(http2.constants.NGHTTP2_CANCEL); resolve({ status: 0, reason: 'timeout' }); }, 15000);
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (d) => { chunks += d; });
    req.on('end', () => {
      clearTimeout(timer);
      let reason = null;
      if (status !== 200) { try { reason = JSON.parse(chunks).reason || chunks; } catch { reason = chunks || String(status); } }
      resolve({ status, reason });
    });
    req.on('error', (err) => { clearTimeout(timer); resolve({ status: 0, reason: err.message }); });
    req.end(body);
  });
}

/**
 * Send one message to a list of mobile_devices rows (id, push_token).
 * @returns {Promise<{sent:number, failed:number, disabled:number}>}
 */
async function sendToDevices(db, devices, msg) {
  const targets = (devices || []).filter(d => isApnsToken(d.push_token));
  if (targets.length === 0) return { sent: 0, failed: 0, disabled: 0 };

  const c = loadConfig();
  if (!c) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.error('[apnsPush] APNs not configured (APNS_KEY_FILE / APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID) — iOS pushes disabled');
    }
    return { sent: 0, failed: targets.length, disabled: 0 };
  }

  const body = buildPayload(msg);
  let sent = 0, failed = 0;
  const dead = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (d) => {
      const firstEnv = tokenEnv.get(d.push_token) || c.env;
      const secondEnv = firstEnv === 'production' ? 'sandbox' : 'production';
      let r = await sendOne(firstEnv, c, d.push_token, body);
      if (r.reason === 'ExpiredProviderToken') { providerToken = null; r = await sendOne(firstEnv, c, d.push_token, body); }
      let alt = null;
      // A token minted by a debug build lives in the other APNs environment.
      if (r.reason === 'BadDeviceToken') {
        alt = await sendOne(secondEnv, c, d.push_token, body);
        if (alt.status === 200) { tokenEnv.set(d.push_token, secondEnv); r = alt; }
      } else if (r.status === 200) {
        tokenEnv.set(d.push_token, firstEnv);
      }
      if (r.status === 200) { sent++; return; }
      failed++;
      // Only give up on a token when APNs itself says it is dead. A BadDeviceToken
      // counts only if the other environment also rejected the token (not if that
      // attempt failed for a key/environment reason such as BadEnvironmentKeyInToken).
      const deadHere = DEAD_REASONS.has(r.reason)
        && (r.reason !== 'BadDeviceToken' || (alt && DEAD_REASONS.has(alt.reason)));
      if (deadHere) {
        console.warn(`[apnsPush] device ${d.id} deactivated: ${r.reason} (${firstEnv}${alt ? ` / ${secondEnv}: ${alt.reason}` : ''}, topic ${c.bundleId})`);
        dead.push(d.id);
      } else {
        console.error(`[apnsPush] send failed for device ${d.id}: ${r.status} ${r.reason}${alt ? ` (${secondEnv}: ${alt.status} ${alt.reason})` : ''}`);
      }
    }));
  }

  if (dead.length) {
    await db.query('UPDATE mobile_devices SET is_active = 0 WHERE id IN (?)', [dead]);
  }
  return { sent, failed, disabled: dead.length };
}

function close() {
  for (const s of Object.values(sessions)) { try { s.close(); } catch { /* ignore */ } }
}

module.exports = { sendToDevices, isApnsToken, close };
