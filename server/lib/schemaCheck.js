/**
 * Does this instance's database have every table and column the code expects?
 *
 * db/schema.sql is the full current schema (every migration is folded into it),
 * so "expected" = the tables and columns it creates. Instances upgrade by
 * applying files from server/migrations/, and instances on different versions
 * have applied different subsets, so this compares the live database with
 * schema.sql and, for anything missing, names the migration file(s) that add it.
 *
 * Extra tables or columns on the live side are ignored (local additions are fine).
 *
 * Used by scripts/check-schema.js (deploy.sh runs it before restarting),
 * docker/init.js and the server's startup log.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCHEMA_FILE = path.join(ROOT, 'db', 'schema.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'server', 'migrations');

/** Parse `CREATE TABLE` blocks of a mysqldump-style file → Map(table → [columns]). */
function parseSchema(sql) {
  const tables = new Map();
  let current = null;
  for (const line of sql.split('\n')) {
    const start = line.match(/^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(/i);
    if (start) { current = start[1]; tables.set(current, []); continue; }
    if (!current) continue;
    if (/^\)/.test(line)) { current = null; continue; }
    const col = line.match(/^\s+`(\w+)`\s/);
    if (col) tables.get(current).push(col[1]);
  }
  return tables;
}

/** Values of an `enum('a','b')` type string, or null if it isn't an enum. */
function enumValues(type) {
  const m = String(type || '').match(/^enum\((.*)\)/i);
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map(v => v[1].replace(/''/g, "'"));
}

/** ENUM columns of schema.sql → Map('table.column' → [values]). */
function parseEnums(sql) {
  const enums = new Map();
  let current = null;
  for (const line of sql.split('\n')) {
    const start = line.match(/^CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(/i);
    if (start) { current = start[1]; continue; }
    if (!current) continue;
    if (/^\)/.test(line)) { current = null; continue; }
    const col = line.match(/^\s+`(\w+)`\s+(enum\((?:'(?:[^']|'')*',?)*\))/i);
    if (col) enums.set(`${current}.${col[1]}`, enumValues(col[2]));
  }
  return enums;
}

/**
 * @returns {Promise<{tables: string[], columns: {table: string, column: string}[],
 *   enumValues: {table: string, column: string, values: string[]}[]}>}
 *   enumValues = allowed values an ENUM column still lacks (e.g. a new status).
 */
async function findMissing(db, schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8')) {
  const expected = parseSchema(schemaSql);
  const expectedEnums = parseEnums(schemaSql);
  const [rows] = await db.query(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()'
  );
  const live = new Map();
  const liveTypes = new Map();
  for (const r of rows) {
    const t = String(r.t || r.TABLE_NAME);
    const c = String(r.c || r.COLUMN_NAME);
    if (!live.has(t)) live.set(t, new Set());
    live.get(t).add(c);
    const ty = r.ty || r.COLUMN_TYPE;
    if (ty) liveTypes.set(`${t}.${c}`, String(ty));
  }
  const missing = { tables: [], columns: [], enumValues: [] };
  for (const [table, cols] of expected) {
    if (!live.has(table)) { missing.tables.push(table); continue; }
    for (const column of cols) {
      if (!live.get(table).has(column)) { missing.columns.push({ table, column }); continue; }
      const want = expectedEnums.get(`${table}.${column}`);
      const have = enumValues(liveTypes.get(`${table}.${column}`));
      if (want && have) {
        const lacking = want.filter(v => !have.includes(v));
        if (lacking.length) missing.enumValues.push({ table, column, values: lacking });
      }
    }
  }
  return missing;
}

function loadMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({ file: `server/migrations/${f}`, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/**
 * Which migration files add the missing pieces? A table is matched by a
 * CREATE TABLE for it; a column by a file that mentions both its table and the
 * column name.
 * @returns {{byFile: Map<string, string[]>, uncovered: string[]}}
 */
function suggestMigrations(missing, migrations = loadMigrations()) {
  const byFile = new Map();
  const uncovered = [];
  const add = (file, item) => {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(item);
  };
  const word = s => new RegExp(`[\`\\s.(,]${s}[\`\\s,)]`, 'i');

  for (const table of missing.tables) {
    const re = new RegExp(`CREATE TABLE (IF NOT EXISTS )?\`?${table}\`?[\\s(]`, 'i');
    const hits = migrations.filter(m => re.test(m.sql));
    if (hits.length) hits.forEach(m => add(m.file, `table ${table}`));
    else uncovered.push(`table ${table}`);
  }
  for (const { table, column } of missing.columns) {
    const hits = migrations.filter(m => word(table).test(m.sql) && word(column).test(m.sql));
    if (hits.length) hits.forEach(m => add(m.file, `${table}.${column}`));
    else uncovered.push(`${table}.${column}`);
  }
  for (const { table, column, values } of missing.enumValues || []) {
    const item = `${table}.${column} value(s) ${values.map(v => `'${v}'`).join(', ')}`;
    const hits = migrations.filter(m => word(table).test(m.sql) && word(column).test(m.sql)
      && values.every(v => m.sql.includes(`'${v}'`)));
    if (hits.length) hits.forEach(m => add(m.file, item));
    else uncovered.push(item);
  }
  return { byFile, uncovered };
}

/** Human-readable report; empty string when nothing is missing. */
function formatReport(missing, { applyHint = '<mysql connection> < FILE' } = {}) {
  const enums = missing.enumValues || [];
  if (!missing.tables.length && !missing.columns.length && !enums.length) return '';
  const { byFile, uncovered } = suggestMigrations(missing);
  const lines = [];
  lines.push(`Database is missing ${missing.tables.length} table(s), ${missing.columns.length} column(s) and ${enums.length} enum value change(s) that this version of the code uses.`);
  if (byFile.size) {
    lines.push('', 'Apply these migration files, in this order:');
    for (const [file, items] of byFile) {
      lines.push(`  ${applyHint.replace('FILE', file)}`);
      lines.push(`      adds: ${items.join(', ')}`);
    }
  }
  if (uncovered.length) {
    lines.push('', 'Not added by any migration file (compare the live table with db/schema.sql):');
    lines.push(`  ${uncovered.join(', ')}`);
  }
  return lines.join('\n');
}

module.exports = { parseSchema, parseEnums, enumValues, findMissing, suggestMigrations, formatReport, SCHEMA_FILE };
