# Owtranet

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Docker](https://github.com/edmiidz/Owtranet/actions/workflows/docker.yml/badge.svg)](https://github.com/edmiidz/Owtranet/actions/workflows/docker.yml)
![Self-hosted](https://img.shields.io/badge/self--hosted-yes-success)

**Your team's own intranet, on your own server.** Forum, chat, tasks, email,
expenses and AI teammates in one self-hosted app, with a mobile app for iOS and
Android.

- **One install instead of five subscriptions**: Q&A forum, direct messages and
  channels, tasks, webmail, agreements and an expense ledger share one login and
  one search.
- **AI teammates that live in your threads**: `@assistant` answers in posts,
  channels and DMs using Claude, with per-hour caps.
- **Your data stays yours**: one MySQL database per organisation, MIT licensed,
  no telemetry.

```bash
cp .env.docker.example .env   # fill in 4 values
docker compose up -d          # → http://localhost:3006
```

📅 **Want a walkthrough?** [Book a demo](https://triluna.app/edmiidz/booknow)

<!-- TODO before launch: add a screenshot or GIF of the forum + chat here. -->

---

**A self-hosted intranet for small teams and communities**: forum, direct
messages, group chat, tasks, webmail, member agreements, an expense ledger and
investment tracker, AI teammates, and a companion mobile app with a "corporate
radio" feed.

One codebase serves any number of organisations. Each deployment is one
instance with its own database, `.env` and branding. There is no multi-tenant
magic: to host a second organisation, deploy it again.

> Owtranet was designed and developed by **Nik Edmiidz**, who holds the
> copyright, and released as open source under the [MIT License](LICENSE).

---

## Features

| Area | What you get |
|---|---|
| **Forum** | Stack Overflow-style posts and threaded comments, Markdown with live preview, tags, voting, @mentions, per-post visibility (everyone, specific members, author only), co-editors, TTS playback |
| **Messaging** | 1:1 direct messages and public/private group-chat channels with replies, likes and soft delete |
| **Tasks** | Assignable tasks with priority, status, comments and an activity log |
| **Members** | Invite-only sign-up (codes and links), profiles, avatars, GitHub avatar sync, roles (`admin`, `moderator`, `user`) |
| **Agreements** | Every new member signs the active team agreement before getting in; optional quiz, confirmation checkboxes, and encrypted payroll fields for employment agreements |
| **Money** | Expense ledger (receipts by upload, e-mail or API), investment tracker with risk multipliers, AI receipt/document analysis, payment tracking, exchange rates |
| **E-mail** | Company mailboxes on your own Postfix/Dovecot with built-in webmail and scheduled sends, or per member Microsoft 365 / Google Workspace |
| **AI agents** | Tag `@assistant` in a thread, channel or DM and a Claude-powered teammate answers; optional ElevenLabs voice agent that can use the intranet through webhooks |
| **Search** | Global search over posts, comments and members, plus Markdown docs swept in from GitHub repos |
| **API** | Token-authenticated `/api/v1/*` for posts, comments, members, tasks, DMs, channels, ledger and deliverables ([docs/WEBHOOK_API.md](docs/WEBHOOK_API.md)) |
| **Mobile** | Expo / React Native app for iOS and Android, one app for every instance ([docs/MOBILE_APP.md](docs/MOBILE_APP.md)) |
| **Extras** | Chrome extension for posting from any page (`extensions/post-creator`), MCP server exposing webmail to AI agents (`mcp-webmail/`) |

## Stack

- **Backend**: Node.js 20+, Express, MySQL 8 (raw SQL through `mysql2`, no ORM), PM2
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Zustand
- **Auth**: JWT for the web app, database API tokens for `/api/v1/*`
- **Optional services**: Anthropic Claude, ElevenLabs, any SMTP relay (SES, SendGrid, …), Postfix/Dovecot, Nextcloud, FCM/APNs

```
server.js                 Express app (most routes live here)
server/routes/            mobile + radio routers
server/lib/               AI agents, post visibility, push, scheduled mail
server/cron/              background workers (PM2)
server/migrations/        incremental SQL history (already folded into db/schema.sql)
server/scripts/           admin scripts (seed AI agents, sync voice-agent tools, …)
client/                   React web app (Vite)
mobile/                   Expo app
db/                       schema.sql + seed files
scripts/                  create-admin, schema check, smoke test, exchange rates, mail aliases
test/                     unit tests (npm test) + database install/upgrade test
docs/                     API, mobile and e-mail design docs
```

---

## Run with Docker (fastest way to try it)

Requirements: Docker with Compose v2.

```bash
git clone https://github.com/edmiidz/Owtranet.git && cd Owtranet
cp .env.docker.example .env
```

Fill in the four required values in `.env`:

| Variable | What to put |
|---|---|
| `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
| `DB_PASSWORD` | another random string |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the first admin account (password ≥ 8 characters) |

```bash
docker compose up -d
```

Open http://localhost:3006 and sign in as the admin. On first start the app
container loads the schema, creates the admin and seeds a placeholder team
agreement. Data lives in the `db-data` and `uploads` Docker volumes.

If the first start fails, fix the cause and run `docker compose up -d` again
with the same volumes. The initializer resumes first-run schema and seeding.
Existing admins and agreements are preserved. If an older installation already
has an admin and lacks an agreement, an admin can configure it in **Admin →
Agreements**.

- **Optional features**: add any setting from [`.env.example`](.env.example)
  (for example `ANTHROPIC_API_KEY` for AI agents, `SES_SMTP_*` for e-mail) to
  the same `.env` and run `docker compose up -d` again.
- **Different URL or port**: set `BASE_URL` to the exact address people open
  (and `OWTRANET_PORT` for the host port).
- **Public server**: put it behind TLS (nginx, Caddy, Traefik), set `BASE_URL`
  to the `https://` address and `CSP_UPGRADE_INSECURE_REQUESTS=true`.
- **Upgrading**: pull, rebuild, then apply any migrations the app reports:
  ```bash
  git pull
  docker compose up -d --build
  docker compose logs app | grep -A12 'SCHEMA OUT OF DATE'   # nothing = up to date
  # for each file it lists:
  docker compose exec -T db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
    < server/migrations/<file>.sql
  docker compose exec -T app node scripts/check-schema.js   # must print ✅
  ```
  See also [Upgrading](#upgrading-an-existing-instance) and [CHANGELOG.md](CHANGELOG.md).

The Docker setup runs the main app only. The optional background workers in
`ecosystem.config.js` (radio summaries, push, scheduled mail, receipt e-mail)
are not included yet.

## Quick start (local development)

Requirements: Node.js 20+, MySQL 8.

```bash
git clone https://github.com/edmiidz/Owtranet.git && cd Owtranet
npm run setup                      # installs server + client dependencies

mysql -u root -p -e "CREATE DATABASE owtranet CHARACTER SET utf8mb4;
  CREATE USER 'owtranet'@'localhost' IDENTIFIED BY 'change-me';
  GRANT ALL ON owtranet.* TO 'owtranet'@'localhost';"
mysql -u root -p owtranet < db/schema.sql
mysql -u root -p owtranet < db/seed.sql

cp .env.example .env               # set DB_*, JWT_SECRET, BASE_URL=http://localhost:3000
node scripts/create-admin.js --email you@example.com --name "Your Name"
mysql -u root -p owtranet < db/seed_team_agreement.sql

npm run dev                        # API on :3006 (PORT in .env)
cd client && npm run dev           # web app on :3000, proxies /api to the API
```

Sign in at http://localhost:3000 with the admin you created. Invite members from
**Admin → Invites**.

The seeded team agreement is **placeholder text (TBD / lorem ipsum)**. Replace it
with your real terms in **Admin → Agreements** before inviting anyone.

## Deploying to a server

A 1–2 GB Ubuntu VM is enough. Build the frontend on your machine, because small
servers run out of memory building Vite.

1. **Server packages**: Node.js 20, `pm2` (`npm i -g pm2`), nginx, certbot, and
   MySQL 8 (local or managed).
2. **App directory**: create `/var/www/owtranet`, copy `.env.example` to `.env`
   there and fill it in. Load `db/schema.sql`, `db/seed.sql`, create the admin
   and load `db/seed_team_agreement.sql` as above.
3. **Code**: put `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, `DEPLOY_PATH` (and
   optionally `PM2_APP`, `PM2_EXTRA`) in a `.deploy.env` file in your clone, which
   is gitignored. Then run:
   ```bash
   ./deploy.sh
   ```
   The first deploy creates the app directory's contents, installs server
   dependencies (`npm ci --omit=dev` from `package-lock.json`), copies
   `ecosystem.config.js` and starts the app in PM2. Later deploys reinstall
   dependencies only when `package-lock.json` changes. To run the optional
   workers (receipt e-mail, scheduled mail, push, …), edit `ecosystem.config.js`
   on the server (it is never overwritten) and run
   `sudo pm2 start ecosystem.config.js && sudo pm2 save`.
4. **nginx + TLS**: copy `nginx.conf` to `/etc/nginx/sites-available/`, change
   `server_name`, enable it, and run `certbot --nginx -d intranet.example.com`.

Before restarting, `deploy.sh` runs `scripts/check-schema.js` on the server and
stops if the database lacks a table or column the new code needs; the old
version keeps running. After the restart it runs `scripts/smoke-test.sh`, which
checks the main read endpoints and fails the deploy on any non-200 response.

## Configuration

Everything instance-specific lives in `.env`. See [`.env.example`](.env.example)
for the full list. The main groups are:

- **Branding**: `COMPANY_NAME`, `COMPANY_SHORT_NAME` and `COMPANY_EMAIL_DOMAIN`
  are used across the UI (via the public `GET /api/config/branding`), e-mails
  and AI prompts.
- **Outbound mail**: `SES_SMTP_*` works with any SMTP relay.
- **Notification e-mails**: mentions, comments on your posts and direct
  messages are e-mailed only while a member is away (no web or mobile activity
  for `EMAIL_NOTIFY_AWAY_MINUTES`, default 30). Each member can change this
  under *Email Notifications* on their profile: always, only when away, only
  when away and signed out of the mobile app, or never.
- **Self-hosted mail**: `MAIL_*` and `DEFAULT_EMAIL_PROVIDER`. See
  [docs/EMAIL_SYSTEM_ARCHITECTURE.md](docs/EMAIL_SYSTEM_ARCHITECTURE.md). Skip
  it and set `DEFAULT_EMAIL_PROVIDER=google_workspace` or `microsoft_365` if
  your team already has mail.
- **AI**: set `ANTHROPIC_API_KEY`, then run
  `node server/scripts/seedAiAgents.js` to create the `@assistant` agent.
- **Voice agent**: `ELEVENLABS_*`, then run
  `node server/scripts/syncElevenLabsAgentTools.js`.
- **Payroll encryption**: `PAYROLL_ENCRYPTION_KEY` is required only if you use
  agreements that collect payroll details.

## Upgrading an existing instance

These steps work from any earlier version, including instances that skipped
releases. [CHANGELOG.md](CHANGELOG.md) says what each release changes.

1. **Get the code**: `git pull` (or merge `upstream/main` into your fork).
2. **Find the migrations your database needs.** In the app directory on the
   server, which has the instance's `.env`:
   ```bash
   node scripts/check-schema.js
   ```
   It compares the database with `db/schema.sql` and prints the
   `server/migrations/` file that adds each missing table or column. It ignores
   anything extra you have added locally.
3. **Apply each listed file**, in the order shown, then re-run the check until
   it prints ✅:
   ```bash
   mysql -h <db host> -u <user> -p <database> < server/migrations/<file>.sql
   ```
   Migrations are written to be safe to re-run. Back up first if you are
   several releases behind (`mysqldump <database> > backup.sql`).
4. **Deploy**: `./deploy.sh` (it repeats the check before restarting), or
   rebuild/restart however you run the app. Run `npm install --omit=dev` on the
   server when `package.json` dependencies changed.
5. **Verify**: `deploy.sh` runs the smoke test. Otherwise open the site, sign
   in, and check the server log has no `SCHEMA OUT OF DATE` warning.

When a change needs a schema update, its PR adds an idempotent migration under
`server/migrations/` and updates `db/schema.sql` too.

### Testing

```bash
npm test                                   # unit tests, no database needed
DB_PASSWORD=… test/db/upgrade-test.sh      # fresh install + upgrade from 1.0.0 on a MySQL server
```

Both run in GitHub Actions on every push and pull request, along with a Docker
Compose install.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
If Owtranet is useful to you, a ⭐ helps other teams find it.

## Demo and support

To see Owtranet running or talk about using it for your team,
[book a demo](https://triluna.app/edmiidz/booknow).

## License

[MIT](LICENSE) © 2025–2026 Nik Edmiidz. See [AUTHORS](AUTHORS).
