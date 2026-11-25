// Unit tests for server/lib/push.js canDeliverTo(). Run: npm test
// Fresh module loads per case, since FCM / APNs read their configuration once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'server', 'lib');
const KEYS = ['FCM_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT_FILE', 'APNS_KEY_FILE', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_ENV'];
const IOS = 'a'.repeat(64);
const ANDROID = 'f'.repeat(152);

function loadPush(env) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  for (const m of ['push.js', 'fcmPush.js', 'apnsPush.js']) delete require.cache[path.join(LIB, m)];
  const push = require(path.join(LIB, 'push.js'));
  return {
    push,
    restore() { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } },
  };
}

const quiet = fn => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test('no push credentials: no token can be reached', () => {
  const { push, restore } = loadPush({});
  try {
    assert.equal(push.canDeliverTo(IOS), false);
    assert.equal(push.canDeliverTo(ANDROID), false);
  } finally { restore(); }
});

test('FCM configured: Android tokens yes, iOS tokens no', () => {
  const { push, restore } = loadPush({
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'x@example.com', private_key: 'k', project_id: 'p' }),
  });
  try {
    assert.equal(push.canDeliverTo(ANDROID), true);
    assert.equal(push.canDeliverTo(IOS), false);
  } finally { restore(); }
});

test('APNs configured: iOS tokens yes, Android tokens no', () => {
  const keyFile = path.join(os.tmpdir(), `apns-test-${process.pid}.p8`);
  fs.writeFileSync(keyFile, 'not a real key');
  const { push, restore } = loadPush({ APNS_KEY_FILE: keyFile, APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'com.example.app' });
  try {
    assert.equal(push.canDeliverTo(IOS), true);
    assert.equal(push.canDeliverTo(ANDROID), false);
  } finally { restore(); fs.unlinkSync(keyFile); }
});

test('incomplete or unreadable credentials count as not configured', () => {
  let { push, restore } = loadPush({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'x@example.com' }) });
  try { assert.equal(quiet(() => push.canDeliverTo(ANDROID)), false); } finally { restore(); }
  ({ push, restore } = loadPush({ APNS_KEY_FILE: '/no/such/key.p8', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'b' }));
  try { assert.equal(quiet(() => push.canDeliverTo(IOS)), false); } finally { restore(); }
});

test('not a push token at all: false', () => {
  const { push, restore } = loadPush({ FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'x', private_key: 'k', project_id: 'p' }) });
  try {
    assert.equal(push.canDeliverTo('short'), false);
    assert.equal(push.canDeliverTo(null), false);
  } finally { restore(); }
});
