const assert = require('node:assert/strict');
const { test } = require('node:test');
const searchIndex = require('../lib/search/searchIndex');
const retrievalSuite = require('../lib/search/retrievalSuite');

// ---- index-time permission fields (must mirror server/lib/postVisibility.js) ----

test('posts visible to all members are open to everyone', () => {
  for (const visibility of ['all_members', null, undefined]) {
    assert.deepEqual(
      searchIndex.postAcl({ visibility, authorId: 2, grantedIds: [5] }),
      { acl_all_members: true, acl_admins: false, acl_user_ids: [] }
    );
  }
});

test('author_only posts are open to the author alone, grants ignored', () => {
  assert.deepEqual(
    searchIndex.postAcl({ visibility: 'author_only', authorId: 2, grantedIds: [5, 6] }),
    { acl_all_members: false, acl_admins: false, acl_user_ids: [2] }
  );
});

test('specific_members posts are open to the author plus grantees, deduplicated', () => {
  const acl = searchIndex.postAcl({ visibility: 'specific_members', authorId: 2, grantedIds: [5, 2, 6] });
  assert.equal(acl.acl_all_members, false);
  assert.equal(acl.acl_admins, false, 'admins get no special read access to posts');
  assert.deepEqual(acl.acl_user_ids.sort(), [2, 5, 6]);
});

test('only approved, non-payment deliverables are searchable', () => {
  assert.equal(searchIndex.investmentAcl({ status: 'approved', type: 'customer' }).acl_all_members, true);
  assert.equal(searchIndex.investmentAcl({ status: 'pending', type: 'customer' }).acl_all_members, false);
  assert.equal(searchIndex.investmentAcl({ status: 'approved', type: 'member_payment' }).acl_all_members, false);
});

test('admin-visibility docs are admin-only', () => {
  assert.deepEqual(searchIndex.docAcl({ visibility: 'admin' }),
    { acl_all_members: false, acl_admins: true, acl_user_ids: [] });
  assert.equal(searchIndex.docAcl({ visibility: 'member' }).acl_all_members, true);
});

// ---- query-time filter ----

test('member queries filter by kind and by everyone-or-this-user', () => {
  const body = searchIndex.buildKindQuery('posts', 'pricing', { userId: 7, role: 'user' });
  const [kindFilter, acl] = body.query.bool.filter;
  assert.deepEqual(kindFilter, { term: { kind: 'posts' } });
  assert.deepEqual(acl.bool.should, [
    { term: { acl_all_members: true } },
    { term: { acl_user_ids: 7 } },
  ]);
  assert.equal(acl.bool.minimum_should_match, 1);
});

test('admins additionally match admin-only documents', () => {
  const acl = searchIndex.aclFilter({ userId: 1, role: 'admin' });
  assert.ok(acl.bool.should.some(c => c.term && c.term.acl_admins === true));
  const member = searchIndex.aclFilter({ userId: 1, role: 'moderator' });
  assert.ok(!member.bool.should.some(c => c.term && c.term.acl_admins));
});

test('search is a no-op when OPENSEARCH_URL is unset', async () => {
  const saved = process.env.OPENSEARCH_URL;
  delete process.env.OPENSEARCH_URL;
  try {
    assert.equal(searchIndex.enabled(), false);
    assert.equal(await searchIndex.search({}, { userId: 1 }, 'x', ['posts']), null);
  } finally {
    if (saved !== undefined) process.env.OPENSEARCH_URL = saved;
  }
});

// ---- connected sources ----

test('connected results keep whitelisted fields only (no ACL metadata reaches clients)', () => {
  const mapped = retrievalSuite.mapResult({
    id: 'd1',
    url: 'https://drive.example.com/d1',
    teaser: 'The <em>pricing</em> deck for Q3 &amp; Q4',
    score: 2.5,
    metadata: { Title: ['Q3 deck'], source: ['Google Drive'], allowUsers: ['a@example.com'], aclTokens: ['T'] },
  });
  assert.deepEqual(mapped, {
    id: 'd1',
    title: 'Q3 deck',
    url: 'https://drive.example.com/d1',
    teaser: 'The pricing deck for Q3 & Q4',
    score: 2.5,
    source: 'Google Drive',
    modified: null,
  });
  assert.ok(!JSON.stringify(mapped).includes('a@example.com'));
});

test('connected results never carry non-http links', () => {
  const mapped = retrievalSuite.mapResult({ id: 'x', url: 'javascript:alert(1)', teaser: 'hi' });
  assert.equal(mapped.url, null);
  assert.equal(mapped.title, 'hi');
});

test('connected sources stay off without URL, numeric pipeline id and token', () => {
  const keys = ['RETRIEVAL_SUITE_URL', 'RETRIEVAL_SUITE_PIPELINE_ID', 'RETRIEVAL_SUITE_TOKEN'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    process.env.RETRIEVAL_SUITE_URL = 'https://suite.example.com';
    process.env.RETRIEVAL_SUITE_PIPELINE_ID = 'abc';
    process.env.RETRIEVAL_SUITE_TOKEN = 't';
    assert.equal(retrievalSuite.enabled(), false);
    process.env.RETRIEVAL_SUITE_PIPELINE_ID = '3';
    assert.equal(retrievalSuite.enabled(), true);
    delete process.env.RETRIEVAL_SUITE_TOKEN;
    assert.equal(retrievalSuite.enabled(), false);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});
