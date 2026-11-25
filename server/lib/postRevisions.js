// Version history for forum posts.
//
// A revision is a snapshot of a post's title/content/visibility AFTER a save.
// Both edit paths call the same two functions so they can't drift apart:
//
//   await postRevisions.ensureBaseline(db, post);          // before the UPDATE
//   ... UPDATE posts ...
//   await postRevisions.recordRevision(db, postId, {...}); // after the UPDATE
//
// ensureBaseline() covers a post that has no history yet (e.g. created on an
// instance before add_post_revisions.sql was applied, or before this code
// shipped): its pre-edit state is stored as revision 1 so the first recorded
// edit still has something to diff against.
//
// History is best-effort by design: a failure here is logged and never fails
// the edit itself, so an instance that hasn't had the migration applied yet
// keeps working (it just doesn't record history).

const MAX_NOTE = 500;
const MAX_VIA = 150;

function clip(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

// Store the post's current (pre-edit) state as revision 1 if it has no history.
async function ensureBaseline(db, post) {
  try {
    const [rows] = await db.execute(
      'SELECT 1 FROM post_revisions WHERE post_id = ? LIMIT 1',
      [post.id]
    );
    if (rows.length > 0) return;
    await db.execute(
      `INSERT IGNORE INTO post_revisions
         (post_id, revision_number, title, content, visibility, edited_by, edited_via, created_at)
       VALUES (?, 1, ?, ?, ?, NULL, 'baseline', COALESCE(?, NOW()))`,
      [post.id, post.title, post.content || '', post.visibility || null,
        post.updated_at || post.created_at || null]
    );
  } catch (err) {
    console.error(`post_revisions: baseline for post ${post.id} failed:`, err.message);
  }
}

// Snapshot the post as it is now. Skipped when title, content and visibility
// all match the latest revision (e.g. a save that only changed tags).
// Returns the new revision number, or null if nothing was recorded.
//
// Runs in a transaction that locks the post's row (SELECT ... FOR UPDATE), so
// two saves of the same post at the same moment queue up instead of both
// picking the same revision number; saves of different posts don't block
// each other.
async function recordRevision(db, postId, { editedBy, via, note } = {}) {
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [posts] = await conn.execute(
      'SELECT id, title, content, visibility FROM posts WHERE id = ? FOR UPDATE',
      [postId]
    );
    if (posts.length === 0) {
      await conn.rollback();
      return null;
    }
    const post = posts[0];

    const [latest] = await conn.execute(
      `SELECT revision_number, title, content, visibility FROM post_revisions
       WHERE post_id = ? ORDER BY revision_number DESC LIMIT 1`,
      [postId]
    );
    if (latest.length > 0
      && latest[0].title === post.title
      && (latest[0].content || '') === (post.content || '')
      && (latest[0].visibility || null) === (post.visibility || null)) {
      await conn.rollback();
      return null;
    }

    const next = latest.length > 0 ? latest[0].revision_number + 1 : 1;
    await conn.execute(
      `INSERT INTO post_revisions
         (post_id, revision_number, title, content, visibility, edited_by, edited_via, change_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [postId, next, post.title, post.content || '', post.visibility || null,
        editedBy || null, clip(via, MAX_VIA), clip(note, MAX_NOTE)]
    );
    await conn.commit();
    return next;
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error(`post_revisions: recording a revision of post ${postId} failed:`, err.message);
    return null;
  } finally {
    if (conn) conn.release();
  }
}

// Revision list, newest first, without the bodies.
async function listRevisions(db, postId) {
  const [rows] = await db.execute(
    `SELECT r.revision_number, r.title, r.visibility, r.edited_via, r.change_note, r.created_at,
            CHAR_LENGTH(r.content) AS content_length,
            u.id AS editor_id, u.name AS editor_name, u.intranet_username AS editor_username
     FROM post_revisions r
     LEFT JOIN users u ON u.id = r.edited_by
     WHERE r.post_id = ?
     ORDER BY r.revision_number DESC`,
    [postId]
  );
  return rows.map(formatRevision);
}

// One revision with its body, plus the previous revision's body for diffing.
async function getRevision(db, postId, revisionNumber) {
  const [rows] = await db.execute(
    `SELECT r.revision_number, r.title, r.content, r.visibility, r.edited_via, r.change_note, r.created_at,
            CHAR_LENGTH(r.content) AS content_length,
            u.id AS editor_id, u.name AS editor_name, u.intranet_username AS editor_username
     FROM post_revisions r
     LEFT JOIN users u ON u.id = r.edited_by
     WHERE r.post_id = ? AND r.revision_number = ?`,
    [postId, revisionNumber]
  );
  if (rows.length === 0) return null;

  const [prev] = await db.execute(
    `SELECT revision_number, title, content FROM post_revisions
     WHERE post_id = ? AND revision_number < ?
     ORDER BY revision_number DESC LIMIT 1`,
    [postId, revisionNumber]
  );

  const revision = formatRevision(rows[0]);
  revision.content = rows[0].content;
  const previous = prev[0] || null;
  revision.previous_revision_number = previous ? previous.revision_number : null;
  revision.diff = {
    title_changed: previous ? previous.title !== rows[0].title : false,
    previous_title: previous ? previous.title : null,
    lines: diffLines(previous ? previous.content : '', rows[0].content)
  };
  return revision;
}

function formatRevision(r) {
  return {
    revision_number: r.revision_number,
    title: r.title,
    visibility: r.visibility,
    edited_via: r.edited_via,
    change_note: r.change_note,
    created_at: r.created_at,
    content_length: r.content_length === undefined ? undefined : Number(r.content_length),
    editor: r.editor_id
      ? { id: r.editor_id, name: r.editor_name, username: r.editor_username }
      : null
  };
}

// Line diff via longest common subsequence. Returns
// [{ type: 'same' | 'added' | 'removed', text }]. Posts are at most a few
// thousand lines, so the O(n*m) table is fine; past MAX_CELLS it falls back
// to "everything removed, everything added" rather than burn memory.
const MAX_CELLS = 4_000_000;

function diffLines(oldText, newText) {
  const a = String(oldText || '').split('\n');
  const b = String(newText || '').split('\n');
  if (oldText === '' || oldText === null || oldText === undefined) {
    return b.map(text => ({ type: 'added', text }));
  }

  // Trim the common prefix/suffix first; most edits touch a small region.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }

  const head = a.slice(0, start).map(text => ({ type: 'same', text }));
  const tail = a.slice(endA + 1).map(text => ({ type: 'same', text }));
  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);

  let middle;
  if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    middle = [
      ...midA.map(text => ({ type: 'removed', text })),
      ...midB.map(text => ({ type: 'added', text }))
    ];
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { middle.push({ type: 'same', text: midA[i] }); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { middle.push({ type: 'removed', text: midA[i] }); i++; }
      else { middle.push({ type: 'added', text: midB[j] }); j++; }
    }
    while (i < n) middle.push({ type: 'removed', text: midA[i++] });
    while (j < m) middle.push({ type: 'added', text: midB[j++] });
  }

  return [...head, ...middle, ...tail];
}

module.exports = {
  ensureBaseline,
  recordRevision,
  listRevisions,
  getRevision,
  diffLines
};
