// Unit tests for the instance agent catalog in server/lib/aiAgents.js
// (INSTANCE_DIR/agents.js). Run: npm test. No database, no model calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODULE = path.join(__dirname, '..', 'server', 'lib', 'aiAgents.js');
const EXAMPLE_DIR = path.join(__dirname, '..', 'examples', 'instance');

/** Load aiAgents.js with INSTANCE_DIR (and friends) set, since the catalog is built at load. */
function load(env = {}) {
  const keys = ['INSTANCE_DIR', 'PLUGINS_STRICT', 'COMPANY_NAME'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[MODULE];
  try { return require(MODULE); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

/** A temp INSTANCE_DIR whose agents.js has the given source. */
function instanceDir(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owt-agents-'));
  if (source !== null) fs.writeFileSync(path.join(dir, 'agents.js'), source);
  return dir;
}

const quiet = fn => {
  const { error, warn } = console;
  const logged = [];
  console.error = console.warn = (...a) => logged.push(a.join(' '));
  try { return { result: fn(), logged }; } finally { Object.assign(console, { error, warn }); }
};

const BUILTINS = [{ handle: 'assistant', name: 'Assistant', kind: 'role', tagline: 't', description: 'd' }];

// ---- mergeAgentCatalog (pure) ----

test('no instance file: the built-in agents unchanged', () => {
  const { mergeAgentCatalog } = load();
  const { catalog, warnings } = mergeAgentCatalog(BUILTINS, null);
  assert.deepEqual(catalog, BUILTINS);
  assert.deepEqual(warnings, []);
});

test('new agents are appended with defaults filled in', () => {
  const { mergeAgentCatalog } = load();
  const { catalog } = mergeAgentCatalog(BUILTINS, { includeDefaults: true, agents: [{ handle: 'ops' }] });
  assert.deepEqual(catalog.map(a => a.handle), ['assistant', 'ops']);
  assert.deepEqual(catalog[1], {
    handle: 'ops', name: 'ops', kind: 'role', tagline: null, description: null,
    elevenlabs_agent_id: null, skill_command: null, skill_url: null
  });
});

test('an agent with a built-in handle replaces only the fields it sets', () => {
  const { mergeAgentCatalog } = load();
  const { catalog } = mergeAgentCatalog(BUILTINS, {
    includeDefaults: true, agents: [{ handle: 'assistant', name: 'Helper', persona: 'Be brief.' }]
  });
  assert.equal(catalog.length, 1);
  assert.deepEqual(catalog[0], { handle: 'assistant', name: 'Helper', kind: 'role', tagline: 't', description: 'd', persona: 'Be brief.' });
});

test('includeDefaults: false keeps only the instance agents', () => {
  const { mergeAgentCatalog } = load();
  const { catalog } = mergeAgentCatalog(BUILTINS, { includeDefaults: false, agents: [{ handle: 'ops', name: 'Ops' }] });
  assert.deepEqual(catalog.map(a => a.handle), ['ops']);
});

test('invalid entries are skipped with a warning; valid ones still load', () => {
  const { mergeAgentCatalog } = load();
  const { catalog, warnings } = mergeAgentCatalog(BUILTINS, {
    includeDefaults: true,
    agents: [
      null,
      { handle: 'Bad Handle' },
      { handle: 'x' },
      { handle: 'ops', kind: 'robot' },
      { handle: 'ops2', persona: 42 },
      { handle: 'ops3', existingUserId: 'one' },
      { handle: 'good' },
      { handle: 'good' }
    ]
  });
  assert.deepEqual(catalog.map(a => a.handle), ['assistant', 'good']);
  assert.equal(warnings.length, 7);
  assert.match(warnings.join('\n'), /handle must be/);
  assert.match(warnings.join('\n'), /kind must be one of role, voice, system/);
  assert.match(warnings.join('\n'), /persona must be a string or a function/);
  assert.match(warnings.join('\n'), /existingUserId must be a positive integer/);
  assert.match(warnings.join('\n'), /duplicate handle/);
});

// ---- loading INSTANCE_DIR/agents.js ----

test('no INSTANCE_DIR or no agents.js: nothing loaded', () => {
  const mod = load();
  assert.equal(mod.loadInstanceAgents({ dir: undefined }), null);
  assert.equal(mod.loadInstanceAgents({ dir: instanceDir(null) }), null);
  assert.deepEqual(mod.AGENT_CATALOG.map(a => a.handle), ['assistant']);
});

test('agents.js may export an array, an object, or a function', () => {
  const mod = load();
  const asArray = mod.loadInstanceAgents({ dir: instanceDir(`module.exports = [{ handle: 'ops' }];`) });
  assert.deepEqual(asArray, { agents: [{ handle: 'ops' }], includeDefaults: true });
  const asObject = mod.loadInstanceAgents({ dir: instanceDir(`module.exports = { includeDefaults: false, agents: [{ handle: 'ops' }] };`) });
  assert.equal(asObject.includeDefaults, false);
  const asFunction = mod.loadInstanceAgents({
    dir: instanceDir(`module.exports = ({ companyName }) => [{ handle: 'ops', description: 'at ' + companyName }];`)
  });
  assert.match(asFunction.agents[0].description, /^at /);
});

test('a broken agents.js is ignored with an error, so the built-ins still work', () => {
  const mod = load();
  const { result, logged } = quiet(() => mod.loadInstanceAgents({ dir: instanceDir('module.exports = { nope: true };'), strict: false }));
  assert.equal(result, null);
  assert.match(logged.join('\n'), /ignoring .*agents\.js/);
  const syntax = quiet(() => mod.loadInstanceAgents({ dir: instanceDir('module.exports = [;'), strict: false }));
  assert.equal(syntax.result, null);
});

test('PLUGINS_STRICT=1 turns a broken agents.js into an error', () => {
  const mod = load();
  assert.throws(() => mod.loadInstanceAgents({ dir: instanceDir('module.exports = 5;'), strict: true }), /agents\.js/);
});

// ---- personas ----

test('the example instance: catalog and personas', () => {
  const mod = load({ INSTANCE_DIR: EXAMPLE_DIR, COMPANY_NAME: 'Example Co' });
  assert.deepEqual(mod.AGENT_CATALOG.map(a => a.handle), ['assistant', 'comms', 'reviewer']);
  assert.match(mod.AGENT_CATALOG[1].description, /Example Co/);

  // String persona: appended to the company context.
  const comms = mod.personaFor({ handle: 'comms', name: 'Comms', kind: 'role' });
  assert.match(comms, /^You work at Example Co/);
  assert.match(comms, /You are Comms, who owns internal communications/);

  // Function persona: the whole prompt, with access to the catalog.
  const reviewer = mod.personaFor({ handle: 'reviewer', name: 'Reviewer', kind: 'role' });
  assert.match(reviewer, /Other agents here: Assistant, Comms\./);

  // No persona: the built-in one.
  assert.match(mod.personaFor({ handle: 'assistant', name: 'Assistant', kind: 'role' }), /helpful AI teammate/);
});

test('an agent not in the catalog (or with an empty persona) gets the built-in persona', () => {
  const dir = instanceDir(`module.exports = [{ handle: 'quiet', persona: () => '   ' }];`);
  const mod = load({ INSTANCE_DIR: dir });
  assert.match(mod.personaFor({ handle: 'quiet', name: 'Quiet', kind: 'role' }), /You are Quiet, a helpful AI teammate/);
  assert.match(mod.personaFor({ handle: 'unknown', name: 'Voice', kind: 'voice' }), /project-management assistant/);
});
