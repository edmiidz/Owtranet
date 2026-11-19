#!/usr/bin/env node
/**
 * Archive old audit trail rows (docs/AUDIT_TRAIL.md).
 *
 * Moves rows older than the retention window out of access_log (and, only if
 * a retention is set, audit_log) into gzipped JSONL files, one per table per
 * UTC month:
 *   server/data/archive/<table>/<table>-YYYY-MM.jsonl.gz
 * Each run appends a gzip member, so a month file can be extended by later
 * runs and still reads with `zcat`. Rows are deleted only after the batch is
 * written and fsynced. With --s3 the month files touched are copied to S3
 * (aws CLI, instance profile) after the run.
 *
 * Usage:
 *   node server/cron/archiveAuditLogs.js                    # dry-run: what would be archived
 *   node server/cron/archiveAuditLogs.js --apply            # archive + delete
 *   node server/cron/archiveAuditLogs.js --apply --s3 s3://bucket/owtranet-audit/<instance>
 *
 * Env: ACCESS_LOG_RETENTION_DAYS (default 180), AUDIT_LOG_RETENTION_DAYS
 * (default 0 = keep audit_log forever), AUDIT_ARCHIVE_DIR, plus DB_* from .env.
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const S3 = args.includes('--s3') ? args[args.indexOf('--s3') + 1] : null;
const ARCHIVE_DIR = process.env.AUDIT_ARCHIVE_DIR || path.join(__dirname, '../data/archive');
const BATCH = 5000;
const TABLES = [
  { name: 'access_log', days: parseInt(process.env.ACCESS_LOG_RETENTION_DAYS || '180', 10) },
  { name: 'audit_log', days: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '0', 10) }
];
const log = (...a) => console.log(new Date().toISOString(), '[audit-archive]', ...a);

function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'intranet_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'owtranet',
    waitForConnections: true, connectionLimit: 2,
    timezone: 'Z', dateStrings: true // occurred_at is UTC wall-clock; keep it verbatim
  });
}

function appendGzip(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, zlib.gzipSync(lines.join('\n') + '\n'));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

async function archiveTable(db, { name, days }) {
  if (!days || days <= 0) {
    log(`${name}: no retention set, kept in full`);
    return [];
  }
  const cutoff = `UTC_TIMESTAMP() - INTERVAL ${days} DAY`;

  if (!APPLY) {
    const [months] = await db.query(
      `SELECT DATE_FORMAT(occurred_at, '%Y-%m') AS month, COUNT(*) AS n
       FROM ${name} WHERE occurred_at < ${cutoff} GROUP BY month ORDER BY month`
    );
    if (!months.length) log(`${name}: nothing older than ${days} days`);
    for (const m of months) log(`${name}: would archive ${m.n} row(s) from ${m.month}`);
    return [];
  }

  const touched = new Set();
  let total = 0;
  for (;;) {
    const [rows] = await db.query(
      `SELECT * FROM ${name} WHERE occurred_at < ${cutoff} ORDER BY id LIMIT ${BATCH}`
    );
    if (!rows.length) break;

    const byMonth = new Map();
    for (const r of rows) {
      const month = String(r.occurred_at).slice(0, 7);
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(JSON.stringify(r));
    }
    for (const [month, lines] of byMonth) {
      const file = path.join(ARCHIVE_DIR, name, `${name}-${month}.jsonl.gz`);
      appendGzip(file, lines);
      touched.add(file);
    }

    const [result] = await db.query(`DELETE FROM ${name} WHERE id IN (?)`, [rows.map(r => r.id)]);
    if (result.affectedRows !== rows.length) {
      throw new Error(`${name}: wrote ${rows.length} rows but deleted ${result.affectedRows}; stopping`);
    }
    total += rows.length;
  }
  log(`${name}: archived ${total} row(s) older than ${days} days`);
  return [...touched];
}

async function main() {
  const db = makePool();
  try {
    const files = [];
    for (const table of TABLES) files.push(...await archiveTable(db, table));
    if (S3 && files.length) {
      for (const file of files) {
        const key = `${S3.replace(/\/$/, '')}/${path.relative(ARCHIVE_DIR, file)}`;
        execFileSync('aws', ['s3', 'cp', file, key, '--only-show-errors'], { stdio: 'inherit' });
        log(`copied ${file} → ${key}`);
      }
    }
    if (!APPLY) log('dry-run — pass --apply to archive');
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error('[audit-archive] failed:', error.message);
  process.exit(1);
});
