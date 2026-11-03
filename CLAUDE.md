# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Owtranet is a self-hosted intranet: a monolithic Express + MySQL backend
(`server.js`), a React/Vite frontend (`client/`), and an Expo mobile app
(`mobile/`). Each organisation runs its own **instance** (own DB, own `.env`),
all from this codebase. **Keep the code instance-neutral**: anything
deployment-specific goes in `.env` or the database, never in source (see
CONTRIBUTING.md).

## Commands

```bash
npm run setup                 # install server + client deps
npm run dev                   # API with nodemon (PORT, default 3006)
cd client && npm run dev      # Vite on :3000, proxies /api → :3006
cd client && npm run build    # tsc + vite build → client/dist
cd mobile && npx tsc --noEmit # typecheck the Expo app
node --check server.js        # syntax gate before any deploy
./deploy.sh                   # rsync deploy (configure .deploy.env)
./deploy.sh --client          # frontend only, no restart (also --no-build, --allow-stale)
```

There is no automated test suite, and `client`'s `npm run lint` has no ESLint
config to run against yet. Verification is `node --check server.js`, the
client build, the mobile typecheck, and `scripts/smoke-test.sh` (run by
`deploy.sh` after restart; it SSHes to the box, mints an admin JWT and asserts
200 on the main read endpoints).

`deploy.sh` refuses to deploy from a clone behind origin, builds `client/dist`
locally, and never touches the server's `.env`, `uploads/`, `node_modules/` or
`ecosystem.config.js`. It does **not** run migrations or `npm install`: apply
new `server/migrations/*.sql` to each instance DB before deploying code that
needs them, and run `npm install --omit=dev` on the server when deps change.

Fresh database: `db/schema.sql` → `db/seed.sql` → `node scripts/create-admin.js`
→ `db/seed_team_agreement.sql`.

## Architecture

- **`server.js`** holds most routes (`/api/*` JWT, `/api/v1/*` API-token). It is
  large; search for the route path rather than reading it top to bottom.
- **`server/routes/`**: `mobile.js` (`/api/mobile/*`) and `radio.js`
  (`/api/radio/*`), factory functions taking `{ db, authenticateToken, … }`,
  mounted near the end of `server.js` before the SPA catch-all `app.get('*')`.
  New routes must also be registered before that catch-all.
- **`server/lib/postVisibility.js`** is *the* post permission predicate. Use it
  in any feature that lists posts.
- **`server/lib/aiAgents.js`**: AI agents are `users` rows with
  `account_type='ai_agent'` plus an `ai_agents` row. @mentions in posts,
  comments and group chat, and DMs to an agent, queue a Claude reply
  (`ai_agent_replies`, with hourly caps). Agents never answer agents. Seed with
  `node server/scripts/seedAiAgents.js`.
- **`server/lib/scheduledEmails.js`** + `server/cron/scheduledEmailSender.js`:
  scheduled webmail sends (times in UTC).
- **`server/cron/`**: PM2 workers (radio summaries, push dispatch, auto-approve,
  doc sweep, scheduled mail). They are dry-run by default; pass `--apply` to write
  and `--daemon` to loop. See `server/cron/README.md`; PM2 wiring is in
  `ecosystem.config.js`.
- **Other processes/packages**: `email-receipt-processor.js` (IMAP → expense
  ledger receipts, own PM2 app), `mcp-webmail/` (MCP server exposing webmail,
  deployed alongside the backend), `extensions/post-creator` (Chrome extension),
  `utils/` (AI receipt analysis, currency conversion, `fieldCrypto.js` for
  encrypted payroll fields).
- **Users**: user **1 is the System account** (DMs to members are sent from it,
  and it owns API-created records when no submitter matches). Roles are
  `admin`, `moderator`, `user`, `pending`, `pending_agreement`, `deactivated`
  and `system`.
- **Mail**: each member's provider is `users.email_provider`
  (`self_hosted` | `microsoft_365` | `google_workspace`, NULL = `DEFAULT_EMAIL_PROVIDER`).
  Webmail and Email Requests only apply to `self_hosted`. The company address is
  `users.company_email`.
- **Branding**: `COMPANY_NAME` / `COMPANY_SHORT_NAME` / `COMPANY_EMAIL_DOMAIN`
  are exposed to clients by `GET /api/config/branding` (`client/src/stores/brandingStore.ts`).
  Use backtick template literals when interpolating them server-side.

## Conventions

- Raw SQL with parameters via `mysql2`. No ORM. MySQL 8.4 rejects bound
  `LIMIT ?`, so inline validated integers instead.
- Schema changes: add an idempotent file in `server/migrations/` **and** update
  `db/schema.sql`.
- Dates: short `YYYY-MM-DD` (`toLocaleDateString('en-CA')`); long
  `YYYY-MM-DD HH:MM:SS TZ`.
- When a page depends on a new read endpoint, add that endpoint to `scripts/smoke-test.sh`.
- Never commit secrets or real API tokens, including in docs and examples; use
  `example.com` / `intranet.example.com` in examples.
- Commits: `type: description` (`feat`, `fix`, `docs`, `refactor`, `chore`,
  `test`). A fix for something that used to work gets a `Regression-Of: <commit>`
  trailer.
