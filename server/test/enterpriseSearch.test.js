const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');

const MODULE = '../lib/enterpriseSearch';
const ENV_KEYS = ['OPENSEARCH_URL', 'OPENSEARCH_USERNAME', 'OPENSEARCH_PASSWORD', 'OPENSEARCH_TIMEOUT_MS',
  'RETRIEVAL_SUITE_URL', 'RETRIEVAL_SUITE_ACL_TOKEN', 'ENTERPRISE_SEARCH_LABEL'];

// The module caches its configuration, so load a fresh copy per environment.
function freshModule(env) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

// A stand-in for OpenSearch (and the Suite's ACL API) on a random local port.
async function stubServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      requests.push(r);
      handler(r, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(r)) };
}

const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

const sampleHits = {
  hits: {
    hits: [
      {
        _id: 'chunk-2',
        _score: 7.5,
        _source: {
          originalId: ['DOC1'],
          title: ['Pricing — Example'],
          url: ['https://example.com/pricing#2'],
          rootItemTitle: ['Example website'],
          rootItemUrl: ['https://example.com/'],
          lastModifiedDate: ['2026-11-01T10:00:00Z'],
        },
        highlight: { body: ['Plans start at \u0001$29\u0002 a month'] },
      },
      { _id: 'bad', _source: { originalId: ['DOC2'], title: ['Bad'], url: ['javascript:alert(1)'] } },
    ],
  },
};

test('disabled without OPENSEARCH_URL', async () => {
  const es = freshModule({});
  assert.equal(es.isEnabled(), false);
  assert.deepEqual(await es.search({ q: 'anything' }), { label: null, results: [] });
});

test('query filters on allow_acl, excludes deny_acl and collapses chunks', () => {
  const { buildQuery } = freshModule({})._internal;
  const body = buildQuery('pricing', ['G_____everyone', 'U_____a@example.com'], 10);
  assert.deepEqual(body.query.bool.filter, [{ terms: { allow_acl: ['G_____everyone', 'U_____a@example.com'] } }]);
  assert.deepEqual(body.query.bool.must_not, [{ terms: { deny_acl: ['G_____everyone', 'U_____a@example.com'] } }]);
  assert.deepEqual(body.collapse, { field: 'originalId' });
  assert.equal(body.size, 10);
});

test('hits map to one result per document, chunk suffix stripped, non-http links dropped', () => {
  const { mapHits } = freshModule({})._internal;
  const results = mapHits(sampleHits);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    id: 'DOC1',
    title: 'Pricing — Example',
    url: 'https://example.com/pricing',
    snippet: 'Plans start at \u0001$29\u0002 a month',
    source: 'Example website',
    source_url: 'https://example.com/',
    modified: '2026-11-01T10:00:00Z',
    file_extension: null,
    score: 7.5,
  });
});

test('ACL response parsing keeps strings from all three lists', () => {
  const { principalsFromAclResponse } = freshModule({})._internal;
  assert.deepEqual(
    principalsFromAclResponse({ userAcls: ['U1', ''], groupAcls: ['G1', 5], userIds: 'U2' }),
    ['U1', 'G1', 'U2'],
  );
  assert.deepEqual(principalsFromAclResponse(null), []);
});

test('HTML entities are decoded; control characters are not produced', () => {
  const { decodeEntities } = freshModule({})._internal;
  assert.equal(decodeEntities('Board &amp; AGMs &#8212; &lt;b&gt; &#x27;x&#x27;'), "Board & AGMs \u2014 <b> 'x'");
  assert.equal(decodeEntities('&#1;&unknown;'), '&#1;&unknown;');
});

test('fingerprints normalise to colon-separated upper case', () => {
  const { normalizeFingerprint } = freshModule({})._internal;
  assert.equal(normalizeFingerprint('ab:cd:ef'), 'AB:CD:EF');
  assert.equal(normalizeFingerprint('abcdef'), 'AB:CD:EF');
});

test('search sends basic auth and the public principal, returns mapped results', async () => {
  const srv = await stubServer((r, res) => json(res, 200, sampleHits));
  try {
    const es = freshModule({ OPENSEARCH_URL: srv.url, OPENSEARCH_USERNAME: 'reader', OPENSEARCH_PASSWORD: 'pw', ENTERPRISE_SEARCH_LABEL: 'Company' });
    const out = await es.search({ q: 'pricing', identities: ['a@example.com'] });
    assert.equal(out.label, 'Company');
    assert.equal(out.results.length, 1);
    const [req] = srv.requests;
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/documentindex/_search');
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('reader:pw').toString('base64'));
    assert.deepEqual(req.body.query.bool.filter[0].terms.allow_acl, ['G_____everyone']);
  } finally {
    await srv.close();
  }
});

test('member principals come from the Suite ACL API when configured', async () => {
  const suite = await stubServer((r, res) => json(res, 200, { userAcls: ['U_____a@example.com'], groupAcls: ['G_____sales'] }));
  const os = await stubServer((r, res) => json(res, 200, { hits: { hits: [] } }));
  try {
    const es = freshModule({ OPENSEARCH_URL: os.url, RETRIEVAL_SUITE_URL: suite.url, RETRIEVAL_SUITE_ACL_TOKEN: 'tok' });
    await es.search({ q: 'x', identities: ['a@example.com'] });
    assert.equal(suite.requests[0].url, '/api/v1/securitytrimming/acls?id=a%40example.com');
    assert.equal(suite.requests[0].headers.authorization, 'tok');
    assert.deepEqual(os.requests[0].body.query.bool.filter[0].terms.allow_acl,
      ['G_____everyone', 'U_____a@example.com', 'G_____sales']);
  } finally {
    await suite.close();
    await os.close();
  }
});

test('a failed ACL lookup narrows to public documents, never widens', async () => {
  const suite = await stubServer((r, res) => json(res, 500, { error: 'boom' }));
  const os = await stubServer((r, res) => json(res, 200, { hits: { hits: [] } }));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const es = freshModule({ OPENSEARCH_URL: os.url, RETRIEVAL_SUITE_URL: suite.url, RETRIEVAL_SUITE_ACL_TOKEN: 'tok' });
    const out = await es.search({ q: 'x', identities: ['a@example.com'] });
    assert.equal(out.error, undefined);
    assert.deepEqual(os.requests[0].body.query.bool.filter[0].terms.allow_acl, ['G_____everyone']);
  } finally {
    console.warn = warn;
    await suite.close();
    await os.close();
  }
});

test('search engine errors and timeouts are reported, not thrown', async () => {
  const errSrv = await stubServer((r, res) => json(res, 503, {}));
  const slowSrv = await stubServer(() => {}); // never answers
  const error = console.error;
  console.error = () => {};
  try {
    let es = freshModule({ OPENSEARCH_URL: errSrv.url });
    assert.deepEqual(await es.search({ q: 'x' }), { label: 'Enterprise', results: [], error: 'unavailable' });
    es = freshModule({ OPENSEARCH_URL: slowSrv.url, OPENSEARCH_TIMEOUT_MS: '100' });
    assert.deepEqual(await es.search({ q: 'x' }), { label: 'Enterprise', results: [], error: 'unavailable' });
  } finally {
    console.error = error;
    await errSrv.close();
    await slowSrv.close();
  }
});
