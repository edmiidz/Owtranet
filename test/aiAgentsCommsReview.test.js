// Unit tests for the AI agent comms review in server/lib/aiAgents.js. Run: npm test
// The database is a stub and no model is called: these cover the parsing of the
// agent's answer and the rules for which posts get reviewed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE = path.join(__dirname, '..', 'server', 'lib', 'aiAgents.js');

/** Load aiAgents.js with the given env (its settings are read at load time). */
function loadWithEnv(env) {
  const keys = ['AGENT_COMMS_REVIEW_HANDLE', 'AGENT_COMMS_REVIEW_GROUPS', 'AGENT_REPLIES_PER_HOUR'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[MODULE];
  try {
    return require(MODULE);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

const REVIEWER = { user_id: 50, handle: 'comms', name: 'Comms Agent', github_username: null, intranet_username: 'comms', role: 'system' };

/**
 * Fake pool. `author` is the post author's row, `taggedAgents` what an @mention
 * lookup returns, `recentReplies` the hourly count, `inserted` whether the
 * INSERT IGNORE adds a row. Records every statement.
 */
function fakeDb({ author = { account_type: 'human', role: 'user' }, taggedAgents = [], recentReplies = 0, inserted = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM ai_agents a JOIN users u/.test(sql)) return [taggedAgents];
      throw new Error(`unexpected query: ${sql}`);
    },
    async execute(sql, params) {
      calls.push({ sql, params });
      if (/SELECT account_type, role FROM users/.test(sql)) return [author ? [author] : []];
      if (/FROM ai_agents a JOIN users u/.test(sql)) return [[REVIEWER]];
      if (/SELECT COUNT\(\*\) AS total FROM ai_agent_replies/.test(sql)) return [[{ total: recentReplies }]];
      if (/^\s*INSERT IGNORE INTO ai_agent_replies/.test(sql)) return [{ affectedRows: inserted ? 1 : 0, insertId: 77 }];
      // runCommsReview: report the post as gone so no model call is made.
      if (/FROM posts p JOIN users u/.test(sql)) return [[]];
      if (/^\s*UPDATE ai_agent_replies/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

function responder(mod, db) {
  return mod.createAgentResponder({
    getDb: () => db,
    createComment: async () => { throw new Error('createComment should not be called'); },
    sendDirectMessage: async () => {},
    postGroupMessage: async () => { throw new Error('postGroupMessage should not be called'); },
  });
}

const inserts = db => db.calls.filter(c => /INSERT IGNORE INTO ai_agent_replies/.test(c.sql));
const post = (over = {}) => ({ id: 9, authorId: 3, visibility: 'all_members', content: 'Sharing the Q3 plan.', ...over });
const quiet = async fn => {
  const { warn, error, log } = console;
  console.warn = console.error = console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, { warn, error, log }); }
};

// ---- parsing the agent's answer ----

test('parseCommsReview: NO_QUESTIONS or empty means no comment', () => {
  const { parseCommsReview } = loadWithEnv({});
  assert.equal(parseCommsReview('NO_QUESTIONS'), null);
  assert.equal(parseCommsReview('  NO_QUESTIONS\n'), null);
  assert.equal(parseCommsReview(''), null);
  assert.equal(parseCommsReview(undefined), null);
  assert.equal(parseCommsReview(' Hi Sam, who is this for? \n'), 'Hi Sam, who is this for?');
});

test('parseChannelReview: REPLY_TO <id> then the reply', () => {
  const { parseChannelReview } = loadWithEnv({});
  assert.deepEqual(parseChannelReview('REPLY_TO 42\nHi Sam, what does this refer to?'),
    { replyTo: 42, text: 'Hi Sam, what does this refer to?' });
  assert.deepEqual(parseChannelReview('  REPLY_TO 7 \nLine one\nLine two\n'),
    { replyTo: 7, text: 'Line one\nLine two' });
});

test('parseChannelReview: anything else means nothing to say', () => {
  const { parseChannelReview } = loadWithEnv({});
  const none = { replyTo: null, text: null };
  assert.deepEqual(parseChannelReview('NO_QUESTIONS'), none);
  assert.deepEqual(parseChannelReview('Hi Sam, a question without REPLY_TO'), none);
  assert.deepEqual(parseChannelReview('REPLY_TO 42\n   '), none);
  assert.deepEqual(parseChannelReview('REPLY_TO 42\nNO_QUESTIONS'), none);
  assert.deepEqual(parseChannelReview(null), none);
});

// ---- which posts get reviewed ----

test('off by default: no AGENT_COMMS_REVIEW_HANDLE means no database work', async () => {
  const mod = loadWithEnv({});
  const db = fakeDb();
  await responder(mod, db).handleNewPost(post());
  assert.equal(db.calls.length, 0);
});

test('only posts shared with all members are reviewed', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'Comms' });
  for (const visibility of ['specific_members', 'author_only']) {
    const db = fakeDb();
    await responder(mod, db).handleNewPost(post({ visibility }));
    assert.equal(db.calls.length, 0, visibility);
  }
});

test('a post that already tags an agent is left alone', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'comms' });
  const db = fakeDb({ taggedAgents: [{ user_id: 51, handle: 'helper' }] });
  await responder(mod, db).handleNewPost(post({ content: 'What do you think, @helper?' }));
  assert.equal(inserts(db).length, 0);
});

test('posts by agents or the System account are not reviewed', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'comms' });
  for (const author of [{ account_type: 'ai_agent', role: 'system' }, { account_type: 'human', role: 'system' }, null]) {
    const db = fakeDb({ author });
    await responder(mod, db).handleNewPost(post());
    assert.equal(inserts(db).length, 0, JSON.stringify(author));
  }
});

test('the reviewer does not review its own post', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'comms' });
  const db = fakeDb();
  await responder(mod, db).handleNewPost(post({ authorId: REVIEWER.user_id }));
  assert.equal(inserts(db).length, 0);
});

test('a member\'s post is queued once as a pending comms_review', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'comms' });
  const db = fakeDb();
  await quiet(async () => {
    await responder(mod, db).handleNewPost(post());
    await new Promise(r => setImmediate(r)); // let the queued review run (it finds no post and gives up)
    await new Promise(r => setImmediate(r));
  });
  const ins = inserts(db);
  assert.equal(ins.length, 1);
  assert.match(ins[0].sql, /'comms_review'/);
  assert.deepEqual(ins[0].params, [REVIEWER.user_id, 9, 9, 'pending']);
  // The handle is matched case-insensitively.
  const lookup = db.calls.find(c => /FROM ai_agents a JOIN users u/.test(c.sql));
  assert.deepEqual(lookup.params, ['comms']);
});

test('over the hourly cap the review is recorded as rate_limited and not run', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'comms', AGENT_REPLIES_PER_HOUR: '5' });
  const db = fakeDb({ recentReplies: 5 });
  await quiet(async () => {
    await responder(mod, db).handleNewPost(post());
    await new Promise(r => setImmediate(r));
  });
  assert.equal(inserts(db)[0].params[3], 'rate_limited');
  assert.equal(db.calls.filter(c => /FROM posts p/.test(c.sql)).length, 0);
});

test('a post already reviewed (duplicate insert) is not run again', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'comms' });
  const db = fakeDb({ inserted: false });
  await responder(mod, db).handleNewPost(post());
  await new Promise(r => setImmediate(r));
  assert.equal(db.calls.filter(c => /FROM posts p/.test(c.sql)).length, 0);
});

test('channel review is off without AGENT_COMMS_REVIEW_GROUPS', async () => {
  const mod = loadWithEnv({ AGENT_COMMS_REVIEW_HANDLE: 'comms' });
  const db = fakeDb();
  await responder(mod, db).reviewChannels();
  assert.equal(db.calls.length, 0);
});
