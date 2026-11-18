// Unit tests for server/lib/schemaCheck.js. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { parseSchema, parseEnums, findMissing, suggestMigrations, formatReport, SCHEMA_FILE } = require('../server/lib/schemaCheck');

const SAMPLE = `
CREATE TABLE \`users\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`email\` varchar(255) NOT NULL,
  \`email_notification_mode\` enum('always','when_away') NOT NULL DEFAULT 'when_away',
  PRIMARY KEY (\`id\`),
  KEY \`idx_email\` (\`email\`)
) ENGINE=InnoDB;

CREATE TABLE \`mobile_devices\` (
  \`id\` int NOT NULL,
  \`user_id\` int NOT NULL
) ENGINE=InnoDB;
`;

/** Fake connection whose information_schema holds the given table → columns. */
const liveDb = (tables) => ({
  async query() {
    const rows = [];
    for (const [t, cols] of Object.entries(tables)) cols.forEach(c => rows.push({ t, c }));
    return [rows];
  },
});

test('parses tables and columns, not keys', () => {
  const s = parseSchema(SAMPLE);
  assert.deepEqual([...s.keys()], ['users', 'mobile_devices']);
  assert.deepEqual(s.get('users'), ['id', 'email', 'email_notification_mode']);
});

test('db/schema.sql parses into a plausible schema', () => {
  const s = parseSchema(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  assert.ok(s.size > 40, `only ${s.size} tables parsed`);
  assert.ok(s.get('users').includes('email_notification_mode'));
  assert.ok(s.get('users').includes('last_active_at'));
});

test('up-to-date database → nothing missing, empty report', async () => {
  const missing = await findMissing(liveDb({ users: ['id', 'email', 'email_notification_mode', 'extra_local_col'], mobile_devices: ['id', 'user_id'] }), SAMPLE);
  assert.deepEqual(missing, { tables: [], columns: [], enumValues: [] });
  assert.equal(formatReport(missing), '');
});

test('older database → reports missing table and column', async () => {
  const missing = await findMissing(liveDb({ users: ['id', 'email'] }), SAMPLE);
  assert.deepEqual(missing.tables, ['mobile_devices']);
  assert.deepEqual(missing.columns, [{ table: 'users', column: 'email_notification_mode' }]);
});

test('names the migration that adds a missing column', () => {
  const { byFile, uncovered } = suggestMigrations(
    { tables: [], columns: [{ table: 'users', column: 'email_notification_mode' }] }
  );
  assert.deepEqual([...byFile.keys()], ['server/migrations/add_email_notification_mode.sql']);
  assert.deepEqual(uncovered, []);
});

test('names the migration that creates a missing table', () => {
  const { byFile } = suggestMigrations({ tables: ['mobile_devices'], columns: [] });
  assert.ok([...byFile.keys()].includes('server/migrations/add_mobile_radio.sql'));
});

test('something no migration adds is reported as uncovered', () => {
  const { uncovered } = suggestMigrations({ tables: [], columns: [{ table: 'users', column: 'no_such_column_xyz' }] });
  assert.deepEqual(uncovered, ['users.no_such_column_xyz']);
});

test('parses ENUM values from schema.sql', () => {
  assert.deepEqual(parseEnums(SAMPLE).get('users.email_notification_mode'), ['always', 'when_away']);
});

test('reports an ENUM column missing a value, and the migration that adds it', async () => {
  const db = { async query() { return [[
    { t: 'scheduled_emails', c: 'status', ty: "enum('scheduled','sending','sent','failed','cancelled')" },
  ]]; } };
  const schema = "CREATE TABLE `scheduled_emails` (\n  `status` enum('scheduled','sending','sent','failed','cancelled','delivery_unknown') NOT NULL\n) ENGINE=InnoDB;";
  const missing = await findMissing(db, schema);
  assert.deepEqual(missing.enumValues, [{ table: 'scheduled_emails', column: 'status', values: ['delivery_unknown'] }]);
  assert.match(formatReport(missing), /add_scheduled_email_delivery_unknown\.sql/);
});
