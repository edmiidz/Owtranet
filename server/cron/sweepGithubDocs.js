/**
 * Sweep GitHub markdown docs into the intranet search index.
 *
 * Why this exists: engineering docs, admin-only records and customer-facing
 * help pages often live outside the intranet (in GitHub repos, and on a public
 * help site rendered from one of them), where intranet search can't find them. This sweep mirrors
 * *just enough* of each document into the `github_docs` table — title, excerpt,
 * and plain-text body — so intranet search can find it. The intranet never
 * renders the document: a hit opens a container page whose only real affordance
 * is an "Access now" button pointing at the canonical copy.
 *
 * Sources are configured in the database (search_adapters + search_adapter_rules)
 * and edited in Admin Panel → Search Adapters. A typical setup:
 *   example-org/website  docs/**.md          -> internal -> github.com blob URL
 *   example-org/website  src/content/help/*  -> help     -> <site>/help/<slug>
 *   example-org/website  src/content/guides/* -> guide   -> <site>/docs/<slug>
 *   example-org/exec     docs/**.md          -> exec     -> github.com blob URL, ADMIN ONLY
 * Help and guides are published as real pages, so we link members to the
 * rendered page rather than to raw markdown; github_url is kept either way.
 *
 * ACCESS CONTROL: the 'exec' collection is an admin-only corpus (e.g. legal or
 * executive records). Its rows are written with visibility='admin' and every
 * read path in server.js filters on that column.
 * If you add a source here, decide its visibility deliberately — the default in
 * the table is 'member', i.e. visible to every signed-in user.
 *
 * Reconciliation: the sweep is the single writer. Every row it sees gets
 * last_seen_at stamped; rows for a repo it swept that were NOT seen are deleted,
 * so files removed or renamed on GitHub drop out of search. A blob sha that
 * hasn't changed skips the content fetch (one tree call covers the rest), which
 * keeps a nightly run at ~2 API calls per repo when nothing changed. A repo that
 * fails to sweep is left entirely alone rather than half-reconciled.
 *
 * SAFETY: defaults to DRY-RUN. It will only WRITE when run with --apply.
 *   Dry run (default):  node server/cron/sweepGithubDocs.js
 *   Real run:           node server/cron/sweepGithubDocs.js --apply
 *   Force re-fetch:     node server/cron/sweepGithubDocs.js --apply --force
 *   One repo only:      node server/cron/sweepGithubDocs.js --repo=example-org/exec
 *   Limit (debugging):  node server/cron/sweepGithubDocs.js --max=5
 *
 * Each adapter names the .env variable holding its GitHub token (default
 * GITHUB_DOCS_TOKEN, falling back to GITHUB_TOKEN). Tokens are NEVER stored in
 * the database or entered in the UI — only the variable name is configurable.
 * An adapter whose token is missing fails on its own and leaves its rows alone.
 */

const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// CLI flags
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX_DOCS = maxArg ? parseInt(maxArg.split('=')[1], 10) : null; // null = no cap
const repoArg = process.argv.find(a => a.startsWith('--repo='));
const ONLY_REPO = repoArg ? repoArg.split('=')[1] : null;

const SITE_BASE = (process.env.GITHUB_DOCS_SITE_BASE || '').replace(/\/+$/, '');

// Body text is stored purely to feed the search index, never rendered. Cap it so
// one pathological doc can't bloat a row (MEDIUMTEXT holds far more, but a
// 200KB doc adds nothing to findability that its first 200KB didn't already).
const MAX_BODY_CHARS = 200000;
const SUMMARY_CHARS = 400;

const slugOf = p => path.basename(p, '.md').toLowerCase();

const githubUrl = (repo, branch, p) =>
  `https://github.com/${repo}/blob/${branch}/${p.split('/').map(encodeURIComponent).join('/')}`;

/**
 * Every indexed source. `rules` are tried in order and the first match wins;
 * a file matching no rule is skipped entirely.
 */
/**
 * Load the sources from the database (search_adapters + search_adapter_rules),
 * shaped as a list of sources with path rules. Admins edit
 * these in Admin Panel → Search Adapters; server/migrations/add_search_adapters.sql
 * documents the columns (it seeds nothing by default).
 *
 * Rules are ordered by sort_order and the first match wins, so a specific prefix
 * (src/content/help/) must sort before a general one (docs/).
 */
async function loadSources(db) {
  const [adapters] = await db.execute(
    `SELECT id, repo, branch, token_env_var, site_base
       FROM search_adapters
      WHERE enabled = 1
      ORDER BY repo`
  );
  if (!adapters.length) return [];

  const [rules] = await db.execute(
    `SELECT adapter_id, path_prefix, collection, visibility, access_url_mode, url_path
       FROM search_adapter_rules
      ORDER BY adapter_id, sort_order, id`
  );

  const byAdapter = new Map();
  for (const r of rules) {
    if (!byAdapter.has(r.adapter_id)) byAdapter.set(r.adapter_id, []);
    byAdapter.get(r.adapter_id).push(r);
  }

  return adapters.map(a => ({
    id: a.id,
    repo: a.repo,
    branch: a.branch || 'main',
    token: process.env[a.token_env_var] || process.env.GITHUB_DOCS_TOKEN || process.env.GITHUB_TOKEN,
    tokenEnvVar: a.token_env_var,
    rules: (byAdapter.get(a.id) || []).map(r => ({
      collection: r.collection,
      visibility: r.visibility,
      match: p => p.startsWith(r.path_prefix) && p.endsWith('.md'),
      accessUrl: (repo, branch, p) =>
        r.access_url_mode === 'site_path' && a.site_base
          ? `${String(a.site_base).replace(/\/+$/, '')}/${r.url_path}/${slugOf(p)}`
          : githubUrl(repo, branch, p),
    })),
  })).filter(s => s.rules.length);
}

async function gh(endpoint, token) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'owtranet-doc-sweep',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status} on ${endpoint}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Strip YAML frontmatter, returning { data, content }.
 * Deliberately minimal — we only ever read `title`, so a full YAML parser (and
 * its dependency) would be overkill. Unrecognised keys are simply ignored.
 */
function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { data: {}, content: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    // Trim matching surrounding quotes; leave anything structured (lists, maps)
    // as its raw string since we never consume those here.
    data[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { data, content: raw.slice(m[0].length) };
}

/**
 * Reduce markdown to plain prose for indexing. We are feeding a FULLTEXT index,
 * not rendering, so syntax noise (fences, tables, HTML, link targets) is pure
 * false-positive fuel — a query for "github" should not match every doc that
 * happens to contain a github.com URL. Link *text* is kept; the URL is dropped.
 */
function toPlainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')          // fenced code blocks
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')         // html comments
    .replace(/<[^>]+>/g, ' ')                 // inline html tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')    // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links -> their text
    .replace(/`([^`]*)`/g, '$1')              // inline code
    .replace(/^\s{0,3}[|>].*$/gm, ' ')        // table rows / blockquote markers
    .replace(/^[-*_]{3,}\s*$/gm, ' ')         // horizontal rules
    .replace(/[#*_~]+/g, ' ')                 // leftover emphasis / heading marks
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prettify a filename into a human title when the doc offers nothing better. */
function titleFromPath(p) {
  return path.basename(p, '.md')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(data, md, p) {
  if (data.title) return data.title;
  const h1 = /^\s{0,3}#\s+(.+?)\s*$/m.exec(md);
  if (h1) return h1[1].replace(/[*_`]/g, '').trim();
  return titleFromPath(p);
}

/**
 * First meaningful paragraph, for the container page's excerpt. Prefers an
 * explicit frontmatter description, then the doc's own opening prose.
 */
function extractSummary(data, plain) {
  const desc = data.description || data.summary;
  if (desc) return desc.slice(0, SUMMARY_CHARS);
  if (!plain) return null;
  return plain.length > SUMMARY_CHARS ? `${plain.slice(0, SUMMARY_CHARS).trimEnd()}…` : plain;
}

async function getDbConnection() {
  return await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'owtranet'
  });
}

/**
 * Sweep one repo. Returns { indexed, skipped, removed } or throws — the caller
 * treats a throw as "leave this repo's rows exactly as they are", so a transient
 * GitHub failure can never be mistaken for "every doc was deleted".
 */
async function sweepRepo(db, source, existingByPath) {
  const { repo, branch, rules } = source;
  if (!source.token) {
    throw new Error(`no token — ${source.tokenEnvVar} is not set in .env`);
  }
  console.log(`\n📚 ${repo}@${branch}`);

  const tree = await gh(`/repos/${repo}/git/trees/${branch}?recursive=1`, source.token);
  if (tree.truncated) {
    // Paging the tree API is possible but we are nowhere near the 100k-entry
    // limit; fail loudly rather than silently indexing a partial repo (which
    // reconciliation would then read as "the rest were deleted").
    throw new Error(`tree listing truncated for ${repo} — refusing to reconcile a partial listing`);
  }

  // Classify every blob against the rules, first match wins.
  let candidates = [];
  for (const entry of tree.tree) {
    if (entry.type !== 'blob') continue;
    const rule = rules.find(r => r.match(entry.path));
    if (!rule) continue;
    candidates.push({
      path: entry.path,
      sha: entry.sha,
      collection: rule.collection,
      visibility: rule.visibility,
      accessUrl: rule.accessUrl(repo, branch, entry.path),
    });
  }
  candidates.sort((a, b) => a.path.localeCompare(b.path));
  if (MAX_DOCS) candidates = candidates.slice(0, MAX_DOCS);

  console.log(`   ${candidates.length} markdown file(s) matched`);

  let indexed = 0;
  let skipped = 0;
  const seenPaths = [];

  for (const doc of candidates) {
    seenPaths.push(doc.path);
    const existing = existingByPath.get(doc.path);

    // Unchanged content: just touch last_seen_at so reconciliation keeps the row.
    if (existing && existing.blob_sha === doc.sha && !FORCE) {
      skipped++;
      if (APPLY) {
        await db.execute('UPDATE github_docs SET last_seen_at = NOW() WHERE id = ?', [existing.id]);
      }
      continue;
    }

    const blob = await gh(`/repos/${repo}/git/blobs/${doc.sha}`, source.token);
    const raw = Buffer.from(blob.content, blob.encoding || 'base64').toString('utf8');

    const { data, content } = parseFrontmatter(raw);
    const plain = toPlainText(content);
    const title = extractTitle(data, content, doc.path).slice(0, 500);
    const summary = extractSummary(data, plain);
    const body = plain.slice(0, MAX_BODY_CHARS);
    const wordCount = plain ? plain.split(/\s+/).length : 0;
    const ghUrl = githubUrl(repo, branch, doc.path);

    console.log(`   ${existing ? '↻' : '+'} [${doc.collection}${doc.visibility === 'admin' ? '/admin' : ''}] ${title}`);

    if (APPLY) {
      await db.execute(
        `INSERT INTO github_docs
           (repo, path, collection, visibility, title, summary, body,
            access_url, github_url, blob_sha, word_count, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           collection = VALUES(collection),
           visibility = VALUES(visibility),
           title      = VALUES(title),
           summary    = VALUES(summary),
           body       = VALUES(body),
           access_url = VALUES(access_url),
           github_url = VALUES(github_url),
           blob_sha   = VALUES(blob_sha),
           word_count = VALUES(word_count),
           last_seen_at = NOW()`,
        [repo, doc.path, doc.collection, doc.visibility, title, summary, body,
         doc.accessUrl, ghUrl, doc.sha, wordCount]
      );
    }
    indexed++;
  }

  // Reconcile: drop rows for this repo that GitHub no longer has. Skipped when
  // --max is in play, since a capped run's "seen" set is deliberately partial.
  let removed = 0;
  const stale = [...existingByPath.values()].filter(r => !seenPaths.includes(r.path));
  if (MAX_DOCS) {
    if (stale.length) console.log(`   (--max set: skipping reconciliation, ${stale.length} unseen row(s) kept)`);
  } else if (stale.length) {
    for (const row of stale) console.log(`   − removed: ${row.path}`);
    if (APPLY) {
      const ids = stale.map(r => r.id);
      await db.query('DELETE FROM github_docs WHERE id IN (?)', [ids]);
    }
    removed = stale.length;
  }

  return { indexed, skipped, removed };
}

async function main() {
  console.log(`\n🕒 [doc-sweep] ${new Date().toISOString()}`);
  console.log(`   Mode: ${APPLY ? '🔴 APPLY (will write)' : '🟢 DRY-RUN (no changes)'}`);
  if (FORCE) console.log('   --force: re-fetching every doc regardless of sha');
  if (MAX_DOCS) console.log(`   --max=${MAX_DOCS} (reconciliation disabled)`);

  const db = await getDbConnection();

  const allSources = await loadSources(db);
  if (!allSources.length) {
    console.error('❌ [doc-sweep] no enabled adapters configured (Admin Panel → Search Adapters).');
    process.exitCode = 1;
    await db.end();
    return;
  }

  const sources = ONLY_REPO ? allSources.filter(s => s.repo === ONLY_REPO) : allSources;
  if (!sources.length) {
    console.error(`❌ [doc-sweep] --repo=${ONLY_REPO} matches no enabled adapter.`);
    process.exitCode = 1;
    await db.end();
    return;
  }
  const totals = { indexed: 0, skipped: 0, removed: 0, failed: 0 };
  try {
    for (const source of sources) {
      // Load this repo's current rows up front: one query drives both the
      // sha-skip check and the reconciliation set.
      const [rows] = await db.execute(
        'SELECT id, path, blob_sha FROM github_docs WHERE repo = ?',
        [source.repo]
      );
      const existingByPath = new Map(rows.map(r => [r.path, r]));

      try {
        const r = await sweepRepo(db, source, existingByPath);
        totals.indexed += r.indexed;
        totals.skipped += r.skipped;
        totals.removed += r.removed;
        console.log(`   → ${r.indexed} indexed, ${r.skipped} unchanged, ${r.removed} removed`);
        if (APPLY) {
          const [[count]] = await db.execute(
            'SELECT COUNT(*) AS n FROM github_docs WHERE repo = ?', [source.repo]);
          await db.execute(
            `UPDATE search_adapters
                SET last_swept_at = NOW(), last_status = 'ok', last_error = NULL, last_doc_count = ?
              WHERE id = ?`,
            [count.n, source.id]
          );
        }
      } catch (err) {
        // One bad repo must not abort the others, and must not reconcile.
        totals.failed++;
        console.error(`   ❌ ${source.repo} failed (rows left untouched): ${err.message}`);
        if (APPLY) {
          await db.execute(
            `UPDATE search_adapters
                SET last_swept_at = NOW(), last_status = 'failed', last_error = ?
              WHERE id = ?`,
            [String(err.message).slice(0, 500), source.id]
          );
        }
      }
    }

    console.log(
      `\n${totals.failed ? '⚠️' : '✅'} [doc-sweep] ${totals.indexed} indexed, ` +
      `${totals.skipped} unchanged, ${totals.removed} removed` +
      `${totals.failed ? `, ${totals.failed} repo(s) failed` : ''}` +
      `${APPLY ? '' : ' (dry run — nothing written)'}`
    );
    if (totals.failed) process.exitCode = 1;
  } catch (err) {
    console.error('❌ [doc-sweep] error:', err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

// Run as a script; when require()d (tests), just expose the pure helpers.
if (require.main === module) {
  main();
} else {
  module.exports = { parseFrontmatter, toPlainText, extractTitle, extractSummary, slugOf, githubUrl, SOURCES };
}
