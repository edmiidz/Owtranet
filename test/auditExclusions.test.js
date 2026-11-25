// Unit tests for which writes server/lib/audit.js keeps out of audit_log. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { WRITE_EXCLUDE } = require('../server/lib/audit');

const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('the presence heartbeat is not written to audit_log', () => {
  // Every open tab sends it every couple of minutes; one row each would flood
  // a table that is kept indefinitely.
  assert.ok(serverJs.includes("app.post('/api/presence'"), 'route exists in server.js');
  assert.ok(WRITE_EXCLUDE.has('POST /api/presence'));
});

test('sign-out is still recorded', () => {
  assert.ok(serverJs.includes("app.post('/api/auth/logout'"), 'route exists in server.js');
  assert.ok(!WRITE_EXCLUDE.has('POST /api/auth/logout'));
});

test('exclusions are "METHOD /path" keys', () => {
  for (const key of WRITE_EXCLUDE) {
    assert.match(key, /^(POST|PUT|PATCH|DELETE) \/api\/\S+$/, key);
  }
});
