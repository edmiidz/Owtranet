#!/usr/bin/env node
/**
 * Corporate Radio Station — Layer 1 background worker.
 *
 * Continuously scans intranet posts and makes sure every post has a
 * TTS-friendly segment in radio_segments. The mobile app never waits on this:
 * it just pulls the pre-assembled feed (GET /api/radio/feed).
 *
 * Usage:
 *   node server/cron/radioWorker.js                 # dry-run: list what would be generated
 *   node server/cron/radioWorker.js --apply         # one pass, write segments
 *   node server/cron/radioWorker.js --apply --daemon  # loop forever (PM2)
 *   node server/cron/radioWorker.js --apply --post=123 --force   # regenerate one post
 *   node server/cron/radioWorker.js --apply --all   # ignore RADIO_BACKFILL_DAYS window
 *
 * Segments cover the whole thread: a new, edited or deleted reply regenerates
 * the post's segment (after RADIO_COMMENT_SETTLE_MINS of quiet, so a burst of
 * replies costs one regeneration, not one per reply).
 *
 * Env: RADIO_MODEL (default claude-opus-5), RADIO_BACKFILL_DAYS (default 30),
 *      RADIO_WORKER_INTERVAL_SECS (default 300), RADIO_BATCH_LIMIT (default 25),
 *      RADIO_COMMENT_SETTLE_MINS (default 10),
 *      COMPANY_SHORT_NAME / COMPANY_NAME (station name), ANTHROPIC_API_KEY.
 *
 * Convention (same as the other server/cron scripts): dry-run unless --apply.
 */
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { summarizePostForRadio, contentHash, loadComments, DEFAULT_MODEL } = require('../lib/radioSummarizer');

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = (n, d) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };

const APPLY = flag('apply');
const DAEMON = flag('daemon');
const FORCE = flag('force');
const ALL = flag('all');
const ONE_POST = opt('post', null);
const LIMIT = parseInt(opt('limit', process.env.RADIO_BATCH_LIMIT || '25'), 10);
const BACKFILL_DAYS = parseInt(process.env.RADIO_BACKFILL_DAYS || '30', 10);
const INTERVAL_SECS = parseInt(process.env.RADIO_WORKER_INTERVAL_SECS || '300', 10);
const COMMENT_SETTLE_MINS = parseInt(process.env.RADIO_COMMENT_SETTLE_MINS || '10', 10);
const COMPANY = process.env.COMPANY_SHORT_NAME || process.env.COMPANY_NAME || 'Intranet';

function log(...a) { console.log(new Date().toISOString(), '[radio]', ...a); }

function makePool() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'intranet_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'owtranet',
    waitForConnections: true,
    connectionLimit: 3
  });
}

/**
 * Posts that need a (new) segment: none yet, failed a while ago, content changed,
 * or the replies changed (new/edited reply older than the settle window, or a
 * reply count that no longer matches what the segment was generated from).
 */
async function findCandidates(db) {
  const where = [];
  const params = [];
  if (ONE_POST) { where.push('p.id = ?'); params.push(parseInt(ONE_POST, 10)); }
  else if (!ALL) { where.push('p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)'); params.push(BACKFILL_DAYS); }
  if (!FORCE) {
    where.push(`(s.id IS NULL
      OR (s.status = 'failed' AND s.updated_at < DATE_SUB(NOW(), INTERVAL 6 HOUR))
      OR (COALESCE(s.is_manual, 0) = 0 AND (
            p.updated_at > s.generated_at
            OR cs.comment_count <> COALESCE(s.comment_count, 0)
            OR (cs.last_comment_at > s.generated_at AND cs.last_comment_at < DATE_SUB(NOW(), INTERVAL ? MINUTE))
      )))`); // hand-edited segments are never auto-overwritten
    params.push(COMMENT_SETTLE_MINS);
  }
  const [rows] = await db.query(
    `SELECT p.id, p.title, p.content, p.created_at, p.updated_at, u.name AS author_name,
            s.id AS segment_id, s.source_hash, s.status AS segment_status, COALESCE(s.is_manual, 0) AS is_manual,
            s.generated_at AS segment_generated_at, cs.comment_count, cs.last_comment_at,
            (SELECT GROUP_CONCAT(t.name SEPARATOR ',') FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id) AS tags
     FROM posts p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN radio_segments s ON s.post_id = p.id
     LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count, MAX(updated_at) AS last_comment_at FROM comments GROUP BY post_id) cs
       ON cs.post_id = p.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.created_at DESC
     LIMIT ${Math.max(1, Math.min(LIMIT, 500))}`, params);
  for (const r of rows) r.comment_count = r.comment_count || 0;

  // Skip "updated" posts whose title/body/replies did not actually change (e.g. view_count bumps).
  const out = [];
  for (const r of rows) {
    r.comments = await loadComments(db, r.id);
    if (FORCE || !r.segment_id || r.segment_status === 'failed' || (!r.is_manual && r.source_hash !== contentHash(r, r.comments))) out.push(r);
  }
  return out;
}

async function upsertSegment(db, postId, seg, hash, commentCount) {
  await db.execute(
    `INSERT INTO radio_segments (post_id, headline, tts_text, source_hash, comment_count, model, word_count, est_duration_secs, status, error, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', NULL, NOW())
     ON DUPLICATE KEY UPDATE headline = VALUES(headline), tts_text = VALUES(tts_text), source_hash = VALUES(source_hash),
       comment_count = VALUES(comment_count),
       model = VALUES(model), word_count = VALUES(word_count), est_duration_secs = VALUES(est_duration_secs),
       status = 'ready', error = NULL, generated_at = NOW(), is_manual = 0, edited_by = NULL`,
    [postId, seg.headline, seg.tts_text, hash, commentCount, seg.model, seg.word_count, seg.est_duration_secs]);
}

async function markFailed(db, postId, hash, message) {
  await db.execute(
    `INSERT INTO radio_segments (post_id, headline, tts_text, source_hash, status, error)
     VALUES (?, '', '', ?, 'failed', ?)
     ON DUPLICATE KEY UPDATE status = 'failed', error = VALUES(error), source_hash = VALUES(source_hash)`,
    [postId, hash, String(message).slice(0, 2000)]);
}

async function runOnce(db) {
  const candidates = await findCandidates(db);
  if (candidates.length === 0) { log('nothing to do'); return { generated: 0, failed: 0 }; }
  log(`${candidates.length} post(s) need segments${APPLY ? '' : ' (dry-run, pass --apply to write)'}`);

  let generated = 0, failed = 0;
  for (const post of candidates) {
    const reason = !post.segment_id ? 'new' : post.segment_status === 'failed' ? 'retry' : FORCE ? 'forced'
      : (post.segment_generated_at && new Date(post.updated_at) <= new Date(post.segment_generated_at)) ? 'replies changed' : 'changed';
    if (!APPLY) { log(`  would generate #${post.id} [${reason}] "${post.title}" (${post.comments.length} replies)`); continue; }
    const hash = contentHash(post, post.comments);
    try {
      const seg = await summarizePostForRadio(post, {
        authorName: post.author_name,
        companyName: COMPANY,
        tags: post.tags ? post.tags.split(',') : [],
        commentCount: post.comments.length,
        comments: post.comments
      }, { strict: !flag('allow-fallback') });
      await upsertSegment(db, post.id, seg, hash, post.comments.length);
      generated++;
      log(`  ✓ #${post.id} [${reason}] ${seg.word_count}w ~${seg.est_duration_secs}s (${seg.model}, ${post.comments.length} replies) "${seg.headline}"`);
    } catch (err) {
      failed++;
      await markFailed(db, post.id, hash, err.message);
      log(`  ✗ #${post.id} failed: ${err.message}`);
      if (/rate limit|429|overloaded|529/i.test(err.message)) { log('  backing off 60s'); await sleep(60000); }
    }
  }
  return { generated, failed };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  log(`model=${process.env.RADIO_MODEL || DEFAULT_MODEL} station="${COMPANY} Radio" apply=${APPLY} daemon=${DAEMON}`);
  const db = makePool();
  let stopping = false;
  const stop = () => { stopping = true; log('shutdown requested'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    do {
      try {
        const r = await runOnce(db);
        if (APPLY) log(`pass complete: ${r.generated} generated, ${r.failed} failed`);
      } catch (err) {
        console.error('[radio] pass error:', err);
      }
      if (DAEMON && !stopping) await sleep(INTERVAL_SECS * 1000);
    } while (DAEMON && !stopping);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error('Fatal:', err); process.exit(1); });
}
module.exports = { runOnce, findCandidates };
