# Owtranet Webmail MCP (read-only + drafts)

Two entrypoints share the same tools (`lib/server.js`):

| Entrypoint | Transport | Runs where | Auth to intranet API | Used by |
|---|---|---|---|---|
| `index.js` | stdio | your laptop | JWT from `npm run login` | Claude Code / desktop MCP clients |
| `http.js` | Streamable HTTP | intranet box (PM2 `owtranet-webmail-mcp`) | JWT minted per request with `JWT_SECRET` for a fixed user | ElevenLabs agents, remote MCP clients — see [Hosted HTTP server](#hosted-http-server-elevenlabs) |

## Local stdio server

**Architecture, in one sentence:** this MCP server runs entirely on your
local machine and does not speak IMAP itself — it calls the existing intranet
webmail API (`/api/webmail/*` on `https://intranet.example.com`), which is
the same API the Webmail page in the React app uses, and that API is what
connects to the instance's IMAP backend (Dovecot) on the server side via
`emailUtils.js`'s `EmailManager`.

So the request path for every tool call is:

```
Claude Code (local)
  -> mcp-webmail (local stdio MCP server, this repo)
    -> HTTPS /api/webmail/* on intranet.example.com  (JWT auth)
      -> EmailManager (server.js / emailUtils.js)
        -> IMAP (Dovecot) on the instance's mail backend
```

This server gives Claude Code read/search access to your `@example.com`
webmail, plus the ability to save drafts. It does not run on the EC2 box, it
does not open its own IMAP connection, and it does not hold IMAP
credentials — only a JWT for the webmail API (see
[How it authenticates](#how-it-authenticates)).

**This server cannot send email.** See [No send capability](#no-send-capability)
below.

## How it authenticates

`/api/webmail/*` requires a JWT (`authenticateToken` in `server.js`), not the
`/api/v1/*` personal API token described in the root `CLAUDE.md`. Mailbox
access is resolved server-side purely from the JWT's `userId` — via
`server_email_accounts.linked_user_id` — never from the token's `email`
field. So which mailbox this hits depends on whichever `server_email_accounts`
row is linked to your user id, not on what email address shows up when you
log in.

## Setup

```bash
cd mcp-webmail
npm install
```

## Login (get a token)

```bash
npm run login
```

This prompts for your intranet email/username and password (password input is
masked) and POSTs to `/api/auth/login`. On success it saves the returned JWT
to:

```
~/.config/owtranet/webmail-token
```

(created with `0600` permissions, matching the `~/.config/owtranet/` convention
already used for `intranet-token`). The file is never committed — it lives
outside the repo, under your home directory.

The JWT expires after **7 days**. When a tool call starts failing with an
auth error, just re-run `npm run login`.

You can skip the interactive prompts by setting `INTRANET_EMAIL` and
`INTRANET_PASSWORD` env vars before running the script, but prefer the
interactive prompt so your password doesn't end up in shell history.

`INTRANET_BASE_URL` can be set to point at a different instance; it defaults
to `https://intranet.example.com`.

## Available tools

| Tool | Maps to | Notes |
|---|---|---|
| `list_mailboxes` | `GET /api/webmail/mailboxes` | Lists folders (INBOX, Sent, Drafts, Trash, ...). |
| `list_messages` | `GET /api/webmail/inbox` | Args: `mailbox` (default `INBOX`), `limit` (default 50). Headers only, most recent first. |
| `get_message` | `GET /api/webmail/emails/:uid` | Args: `uid` (required), `mailbox` (default `INBOX`). Full body + attachment list. |
| `search_messages` | `GET /api/webmail/search` | Args: `query` (required), `mailbox` (default `INBOX`), `limit` (default 50). |
| `create_draft` | `POST /api/webmail/draft` | Args: `to`, `cc`, `bcc`, `subject`, `text` (all optional). Writes to the Drafts folder. Does not send. |

There is deliberately no mark-read, delete, move, or send tool.

## No send capability

By design, this MCP server never calls `POST /api/webmail/compose` (the only
send-capable route in `server.js`) or any SMTP path. The only mutating call
it makes is `create_draft`, which writes a message into the Drafts folder
with no recipient delivery. If you need to actually send mail, use the
Webmail page in the app itself — this tool intentionally doesn't support it.

## Testing locally (without registering with Claude Code)

There's a small stdio smoke-test harness that spawns the server and drives
the MCP JSON-RPC handshake directly, useful for checking changes before
wiring it into Claude Code:

```bash
# Handshake + tool listing only:
node scripts/smoke-test.js

# Also call a specific tool:
node scripts/smoke-test.js --call list_mailboxes '{}'
node scripts/smoke-test.js --call list_messages '{"mailbox":"INBOX","limit":5}'
node scripts/smoke-test.js --call get_message '{"uid":35,"mailbox":"INBOX"}'
node scripts/smoke-test.js --call search_messages '{"query":"invoice"}'
node scripts/smoke-test.js --call create_draft '{"subject":"test","text":"body"}'
```

You need a valid token saved first (see [Login](#login-get-a-token)) for any
call other than the bare handshake.

## Registering with Claude Code

This is a personal, per-user tool (it acts as whoever is logged in via
`npm run login`), so register it at **user** scope rather than committing it
to the project's shared MCP config:

```bash
claude mcp add owtranet-webmail --scope user -- node "C:\Users\bhavi\intranet\mcp-webmail\index.js"
```

Adjust the path if your checkout lives elsewhere. After adding it, restart
Claude Code (or start a new session) and the `list_mailboxes`, `list_messages`,
`get_message`, `search_messages`, and `create_draft` tools should be
available.

To remove it later: `claude mcp remove owtranet-webmail --scope user`.

## Hosted HTTP server (ElevenLabs)

`http.js` serves the same five tools over MCP **Streamable HTTP** (stateless,
plain-JSON responses, no SSE) so ElevenLabs agents can call them.

```
ElevenLabs agent
  -> https://intranet.example.com/mcp/webmail   (nginx, Authorization: Bearer <MCP_WEBMAIL_SECRET>)
    -> 127.0.0.1:3010 http.js  (PM2 owtranet-webmail-mcp)
      -> http://127.0.0.1:3006/api/webmail/*     (JWT minted per request for MCP_WEBMAIL_USER_ID)
        -> EmailManager -> IMAP
```

* **Caller auth:** every request must send `Authorization: Bearer <MCP_WEBMAIL_SECRET>`.
  In ElevenLabs that is the MCP server's *Secret Token*. `GET /mcp/webmail/health`
  is the only unauthenticated path.
* **Mailbox:** fixed by `MCP_WEBMAIL_USER_ID` (an intranet `users.id`); the mailbox
  is that user's linked `server_email_accounts` row, exactly as for the web UI.
  Prod is configured for user 4 (`user@example.com`).
* **Config:** `mcp-webmail/.env` on the box (chmod 600, never committed) — see
  `.env.example`. `JWT_SECRET` is read from the intranet's own `../.env`.
* **Deploy:** `deploy-rsync.sh` ships `mcp-webmail/` (minus `node_modules/` and
  `.env`) and restarts `owtranet-webmail-mcp`. After a dependency change run
  `npm install --omit=dev` in `/var/www/owtranet/mcp-webmail` on the box.
* **nginx:** `location /mcp/` in `/etc/nginx/sites-available/intranet.example.com`
  proxies to port 3010.

Quick check from anywhere:

```bash
curl -s https://intranet.example.com/mcp/webmail/health
curl -s https://intranet.example.com/mcp/webmail \
  -H "Authorization: Bearer $MCP_WEBMAIL_SECRET" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In ElevenLabs (Agents → Integrations → Add MCP server): URL
`https://intranet.example.com/mcp/webmail`, transport *Streamable HTTP*, Secret
Token = the value of `MCP_WEBMAIL_SECRET`, approval mode *Always ask* or
fine-grained (auto-approve the read tools, require approval for `create_draft`).
