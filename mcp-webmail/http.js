// Hosted Streamable-HTTP entrypoint for the Owtranet webmail MCP.
//
// Runs on the intranet box under PM2 (owtranet-webmail-mcp) and is reverse-proxied
// by nginx at https://intranet.example.com/mcp/webmail so ElevenLabs agents (or any
// remote MCP client) can use the same read/search/draft tools as the local stdio
// server in index.js.
//
// Differences from index.js:
//   * Auth to THIS server: every request must carry the shared secret
//     (MCP_WEBMAIL_SECRET) as `Authorization: Bearer <secret>`. ElevenLabs sends
//     its "Secret Token" that way.
//   * Auth to the intranet API: instead of a saved login token, a short-lived JWT
//     is minted per request with the intranet's JWT_SECRET for a fixed user
//     (MCP_WEBMAIL_USER_ID). That user's linked server_email_accounts row decides
//     which mailbox is exposed — see getUserEmailConfig() in server.js.
//   * Stateless: a fresh Server + transport per request, plain JSON responses
//     (no SSE), so it is trivially safe behind nginx.
//
// Config (mcp-webmail/.env, chmod 600 — see .env.example):
//   MCP_WEBMAIL_SECRET    required  shared bearer secret for callers
//   MCP_WEBMAIL_USER_ID   required  intranet users.id whose mailbox is exposed
//   MCP_WEBMAIL_USER_EMAIL/ROLE     optional JWT claims (default role: user)
//   MCP_WEBMAIL_PORT      default 3010
//   MCP_WEBMAIL_PATH      default /mcp/webmail
//   INTRANET_BASE_URL      default http://127.0.0.1:3006 (the local app, not HTTPS)
//   JWT_SECRET            read from ../.env (the intranet's) when not set here
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { parseEnv } from 'node:util';
import jwt from 'jsonwebtoken';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './lib/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(file, { only } = {}) {
  if (!fs.existsSync(file)) return;
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (only && !only.includes(k)) continue;
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// Own config first (wins), then only JWT_SECRET from the intranet's .env.
loadEnvFile(path.join(here, '.env'));
loadEnvFile(path.join(here, '..', '.env'), { only: ['JWT_SECRET'] });

// The local app, not the public HTTPS hostname, unless overridden.
process.env.INTRANET_BASE_URL = process.env.INTRANET_BASE_URL || 'http://127.0.0.1:3006';

const SECRET = process.env.MCP_WEBMAIL_SECRET;
const USER_ID = Number(process.env.MCP_WEBMAIL_USER_ID);
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = Number(process.env.MCP_WEBMAIL_PORT || 3010);
const MCP_PATH = process.env.MCP_WEBMAIL_PATH || '/mcp/webmail';

if (!SECRET || SECRET.length < 16) {
  console.error('MCP_WEBMAIL_SECRET is required (>= 16 chars). Refusing to start an unauthenticated server.');
  process.exit(1);
}
if (!Number.isInteger(USER_ID) || USER_ID <= 0) {
  console.error('MCP_WEBMAIL_USER_ID must be a positive integer (intranet users.id).');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('JWT_SECRET not found (set it in mcp-webmail/.env or ../.env).');
  process.exit(1);
}

function mintJwt() {
  return jwt.sign(
    {
      userId: USER_ID,
      email: process.env.MCP_WEBMAIL_USER_EMAIL || undefined,
      role: process.env.MCP_WEBMAIL_USER_ROLE || 'user',
      via: 'mcp-webmail'
    },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
}

function authorized(req) {
  const header = req.headers['authorization'] || '';
  const presented = header.replace(/^Bearer\s+/i, '').trim();
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === `${MCP_PATH}/health`) {
    return send(res, 200, { ok: true, name: 'owtranet-webmail', transport: 'streamable-http' });
  }

  if (url.pathname !== MCP_PATH) {
    return send(res, 404, { error: 'Not found' });
  }

  if (!authorized(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, 401, { error: 'Unauthorized' });
  }

  try {
    const body = req.method === 'POST' ? await readJson(req) : undefined;

    // Stateless mode: new server + transport per request, JSON (non-SSE) replies.
    const server = createServer({ getToken: mintJwt });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('[mcp-webmail] request failed:', err);
    if (!res.headersSent) {
      send(res, 500, {
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message || 'Internal error' },
        id: null
      });
    }
  }
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[mcp-webmail] listening on http://127.0.0.1:${PORT}${MCP_PATH} ` +
      `(mailbox of user ${USER_ID}, upstream ${process.env.INTRANET_BASE_URL})`
  );
});
