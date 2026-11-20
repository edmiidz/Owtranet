#!/usr/bin/env node
/**
 * OpenSearch indexer for intranet search (server/lib/search/searchIndex.js).
 *
 * Copies posts, comments, tasks, approved investments and GitHub docs from
 * MySQL into OpenSearch. Search re-checks every hit against MySQL, so the index
 * only has to be close to current, not exact.
 *
 *   - Full rebuild into a new index + atomic alias swap: at start-up and every
 *     SEARCH_INDEX_REBUILD_MINS (default 60). This is also what drops deleted rows.
 *   - Incremental pass every SEARCH_INDEX_INTERVAL_SECS (default 30): rows whose
 *     updated_at moved, plus posts/comments whose visibility grants changed.
 *
 * Usage:
 *   node server/cron/searchIndexer.js                    # dry run: counts what would be indexed
 *   node server/cron/searchIndexer.js --apply --rebuild  # one full rebuild, then exit
 *   node server/cron/searchIndexer.js --apply --daemon   # loop (PM2: owtranet-search-indexer)
 *
 * Env: OPENSEARCH_URL (required), OPENSEARCH_* (see server/lib/search/opensearchClient.js),
 * SEARCH_INDEX_INTERVAL_SECS, SEARCH_INDEX_REBUILD_MINS, plus the DB_* vars from .env.
 */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const searchIndex = require('../lib/search/searchIndex');
const { config } = require('../lib/search/opensearchClient');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DAEMON = args.includes('--daemon');
const REBUILD_ONLY = args.includes('--rebuild');
const INTERVAL = parseInt(process.env.SEARCH_INDEX_INTERVAL_SECS || '30', 10);
const REBUILD_MINS = parseInt(process.env.SEARCH_INDEX_REBUILD_MINS || '60', 10);
const log = (...a) => console.log(new Date().toISOString(), '[search-indexer]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'intranet_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'owtranet',
    waitForConnections: true, connectionLimit: 2,
    // Keep DATETIMEs as the strings MySQL returned so the incremental
    // high-water mark compares like-for-like with updated_at.
    dateStrings: true,
  });
}

// MySQL's clock, not ours: updated_at is written by MySQL.
async function dbNow(db) {
  const [[row]] = await db.query('SELECT NOW() AS now');
  return row.now;
}

async function dryRun(db) {
  for (const kind of searchIndex.KINDS) {
    const table = { posts: 'posts', comments: 'comments', tasks: 'tasks', investments: 'deliverables', docs: 'github_docs' }[kind];
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
    log(`  would index ${n} ${kind}`);
  }
}

async function main() {
  const cfg = config();
  if (!cfg.enabled) {
    log('OPENSEARCH_URL is not set; nothing to do');
    // Under PM2, idle instead of exiting so autorestart doesn't loop.
    if (DAEMON) await new Promise(resolve => { process.on('SIGINT', resolve); process.on('SIGTERM', resolve); });
    return;
  }
  log(`apply=${APPLY} daemon=${DAEMON} url=${cfg.url} prefix=${cfg.prefix} interval=${INTERVAL}s rebuild=${REBUILD_MINS}min`);
  const db = makePool();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);

  try {
    if (!APPLY) { await dryRun(db); return; }

    // Start every run with a rebuild: guarantees the mapping is current and the
    // index is complete, whatever happened while the worker was down.
    let since = await dbNow(db);
    await searchIndex.rebuild(db, { log });
    let lastRebuild = Date.now();
    if (REBUILD_ONLY || !DAEMON) return;

    while (!stopping) {
      await sleep(INTERVAL * 1000);
      if (stopping) break;
      try {
        // Overlap by a few seconds so a row written during the previous pass
        // is never skipped; re-indexing a row twice is harmless.
        const next = await dbNow(db);
        let rebuilt = false;
        if (Date.now() - lastRebuild >= REBUILD_MINS * 60 * 1000) {
          try {
            await searchIndex.rebuild(db, { log });
            rebuilt = true;
            lastRebuild = Date.now();
          } catch (err) {
            // e.g. OpenSearch refusing new indexes on a nearly full disk. Keep the
            // current index fresh incrementally and try the rebuild again in 5 min.
            log('rebuild failed, retrying in 5 min:', err.message);
            lastRebuild = Date.now() - Math.max(0, REBUILD_MINS - 5) * 60 * 1000;
          }
        }
        if (!rebuilt) await searchIndex.syncChanged(db, since, { log });
        since = await overlap(db, next);
      } catch (err) {
        // Keep the old `since`, so the next pass retries the same window.
        log('pass failed:', err.message);
      }
    }
  } finally {
    await db.end();
  }
}

async function overlap(db, now) {
  const [[row]] = await db.query('SELECT ? - INTERVAL 5 SECOND AS t', [now]);
  return row.t;
}

if (require.main === module) {
  main().catch(err => { log('fatal:', err.message); process.exit(1); });
}
