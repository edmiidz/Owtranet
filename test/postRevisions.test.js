// Unit tests for server/lib/postRevisions.js. Run: npm test
// The database is stubbed; test/db/upgrade-test.sh covers the migration on real MySQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffLines, recordRevision, ensureBaseline } = require('../server/lib/postRevisions');

const sqlError = (code) => Object.assign(new Error(code), { code });

/**
 * Fake mysql2 pool holding one post and its revisions. getConnection() hands
 * out a connection sharing the same state, so recordRevision's transaction
 * path runs against it. `failWith` makes every query throw (e.g. a missing table).
 */
function fakeDb({ post = { id: 7, title: 'T', content: 'a\nb', visibility: 'all_members' }, revisions = [], failWith = null } = {}) {
  const state = { post, revisions: [...revisions], tx: [] };

  async function execute(sql, params = []) {
    if (failWith) throw sqlError(failWith);
    if (/FROM posts WHERE id = \?/.test(sql)) {
      return [state.post && state.post.id === params[0] ? [{ ...state.post }] : []];
    }
    if (/SELECT 1 FROM post_revisions/.test(sql)) {
      return [state.revisions.filter(r => r.post_id === params[0]).slice(0, 1).map(() => ({ 1: 1 }))];
    }
    if (/FROM post_revisions\s+WHERE post_id = \? ORDER BY revision_number DESC LIMIT 1/.test(sql)) {
      const mine = state.revisions.filter(r => r.post_id === params[0])
        .sort((a, b) => b.revision_number - a.revision_number);
      return [mine.slice(0, 1)];
    }
    if (/^\s*INSERT IGNORE INTO post_revisions/.test(sql)) {
      const [postId, title, content, visibility] = params;
      if (!state.revisions.some(r => r.post_id === postId && r.revision_number === 1)) {
        state.revisions.push({ post_id: postId, revision_number: 1, title, content, visibility, edited_by: null, edited_via: 'baseline' });
      }
      return [{ affectedRows: 1 }];
    }
    if (/^\s*INSERT INTO post_revisions/.test(sql)) {
      const [postId, revision_number, title, content, visibility, edited_by, edited_via, change_note] = params;
      state.revisions.push({ post_id: postId, revision_number, title, content, visibility, edited_by, edited_via, change_note });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }

  return {
    state,
    execute,
    async getConnection() {
      return {
        execute,
        async beginTransaction() { state.tx.push('begin'); },
        async commit() { state.tx.push('commit'); },
        async rollback() { state.tx.push('rollback'); },
        release() { state.tx.push('release'); },
      };
    },
  };
}

const quiet = async (fn) => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try { return { result: await fn(), logged }; } finally { console.error = original; }
};

// ---- diffLines ----

test('diffLines marks a changed line as removed + added, keeps the rest', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nB\nc\nd'), [
    { type: 'same', text: 'a' },
    { type: 'removed', text: 'b' },
    { type: 'added', text: 'B' },
    { type: 'same', text: 'c' },
    { type: 'added', text: 'd' },
  ]);
});

test('diffLines with no previous text shows everything as added', () => {
  assert.deepEqual(diffLines('', 'x\ny'), [
    { type: 'added', text: 'x' },
    { type: 'added', text: 'y' },
  ]);
});

test('diffLines of identical text is all "same"', () => {
  assert.deepEqual(diffLines('one\ntwo', 'one\ntwo'), [
    { type: 'same', text: 'one' },
    { type: 'same', text: 'two' },
  ]);
});

test('diffLines handles pure deletion in the middle', () => {
  assert.deepEqual(diffLines('a\nb\nc', 'a\nc'), [
    { type: 'same', text: 'a' },
    { type: 'removed', text: 'b' },
    { type: 'same', text: 'c' },
  ]);
});

test('diffLines output always rebuilds both sides', () => {
  const before = 'intro\nkeep 1\nold A\nold B\nkeep 2\nend';
  const after = 'intro\nnew 0\nkeep 1\nold B\nnew C\nkeep 2\nend\nappendix';
  const d = diffLines(before, after);
  assert.equal(d.filter(l => l.type !== 'added').map(l => l.text).join('\n'), before);
  assert.equal(d.filter(l => l.type !== 'removed').map(l => l.text).join('\n'), after);
});

// ---- recordRevision ----

test('recordRevision stores revision 1 for a post with no history', async () => {
  const db = fakeDb();
  const n = await recordRevision(db, 7, { editedBy: 3, via: 'web' });
  assert.equal(n, 1);
  assert.equal(db.state.revisions.length, 1);
  assert.equal(db.state.revisions[0].edited_by, 3);
  assert.deepEqual(db.state.tx, ['begin', 'commit', 'release']);
});

test('recordRevision numbers the next revision after the latest', async () => {
  const db = fakeDb({
    post: { id: 7, title: 'T', content: 'new', visibility: 'all_members' },
    revisions: [
      { post_id: 7, revision_number: 1, title: 'T', content: 'v1', visibility: 'all_members' },
      { post_id: 7, revision_number: 2, title: 'T', content: 'v2', visibility: 'all_members' },
    ],
  });
  assert.equal(await recordRevision(db, 7, { editedBy: 3, via: 'web', note: 'why' }), 3);
  const last = db.state.revisions.at(-1);
  assert.equal(last.content, 'new');
  assert.equal(last.change_note, 'why');
});

test('recordRevision skips a save that changed no tracked field', async () => {
  const post = { id: 7, title: 'T', content: 'same', visibility: 'all_members' };
  const db = fakeDb({ post, revisions: [{ post_id: 7, revision_number: 1, ...post }] });
  assert.equal(await recordRevision(db, 7, { editedBy: 3, via: 'web' }), null);
  assert.equal(db.state.revisions.length, 1);
  assert.deepEqual(db.state.tx, ['begin', 'rollback', 'release']);
});

test('recordRevision records a title-only or visibility-only change', async () => {
  const base = { post_id: 7, revision_number: 1, title: 'T', content: 'c', visibility: 'all_members' };
  const retitled = fakeDb({ post: { id: 7, title: 'T2', content: 'c', visibility: 'all_members' }, revisions: [base] });
  assert.equal(await recordRevision(retitled, 7, {}), 2);
  const hidden = fakeDb({ post: { id: 7, title: 'T', content: 'c', visibility: 'author_only' }, revisions: [base] });
  assert.equal(await recordRevision(hidden, 7, {}), 2);
});

test('recordRevision clips the edit summary and the via label', async () => {
  const db = fakeDb();
  await recordRevision(db, 7, { via: 'api:' + 'x'.repeat(400), note: '  ' + 'n'.repeat(900) + '  ' });
  const rev = db.state.revisions[0];
  assert.equal(rev.change_note.length, 500);
  assert.equal(rev.edited_via.length, 150);
  assert.equal(db.state.revisions[0].edited_by, null);
});

test('recordRevision treats a blank edit summary as none', async () => {
  const db = fakeDb();
  await recordRevision(db, 7, { note: '   ' });
  assert.equal(db.state.revisions[0].change_note, null);
});

test('recordRevision returns null for a missing post', async () => {
  const db = fakeDb();
  assert.equal(await recordRevision(db, 999, {}), null);
  assert.equal(db.state.revisions.length, 0);
});

test('recordRevision never throws: a missing table is logged and the edit goes on', async () => {
  const db = fakeDb({ failWith: 'ER_NO_SUCH_TABLE' });
  const { result, logged } = await quiet(() => recordRevision(db, 7, { editedBy: 3 }));
  assert.equal(result, null);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /post_revisions/);
});

// ---- ensureBaseline ----

test('ensureBaseline stores the pre-edit state as revision 1 when there is no history', async () => {
  const db = fakeDb();
  await ensureBaseline(db, { id: 7, title: 'Before', content: 'old', visibility: 'all_members' });
  assert.deepEqual(db.state.revisions.map(r => [r.revision_number, r.content, r.edited_via]), [[1, 'old', 'baseline']]);
});

test('ensureBaseline leaves existing history alone', async () => {
  const existing = { post_id: 7, revision_number: 1, title: 'T', content: 'v1', visibility: 'all_members' };
  const db = fakeDb({ revisions: [existing] });
  await ensureBaseline(db, { id: 7, title: 'T', content: 'other', visibility: 'all_members' });
  assert.equal(db.state.revisions.length, 1);
  assert.equal(db.state.revisions[0].content, 'v1');
});

test('ensureBaseline never throws', async () => {
  const db = fakeDb({ failWith: 'ER_NO_SUCH_TABLE' });
  const { logged } = await quiet(() => ensureBaseline(db, { id: 7, title: 'T', content: 'c' }));
  assert.equal(logged.length, 1);
});
