# Changelog

Each release lists what changed for people running an instance and what an
upgrade needs. To upgrade any instance from any earlier version, follow
[Upgrading an existing instance](README.md#upgrading-an-existing-instance):
`node scripts/check-schema.js` names every migration your database still needs.

## 1.1.0 — 2026-11-18

### Upgrade steps (from 1.0.x)

Run `node scripts/check-schema.js` in the app directory: it lists exactly what
your database needs. From 1.0.x that is three migrations:

1. **Stop the scheduled-mail worker first** (`pm2 stop owtranet-scheduled-mail`,
   if you run it), then apply, in order:
   - `server/migrations/add_email_notification_mode.sql`: notification settings
   - `server/migrations/add_scheduled_email_delivery_unknown.sql`: scheduled-mail
     review state (see below)
   - `server/migrations/add_smtp_sent_log.sql`: SMTP send log (only used with
     self-hosted mail, harmless otherwise)

   All three are safe to re-run. Re-run the check until it prints ✅.
2. Deploy as usual (`./deploy.sh` re-checks the schema before restarting). No new
   npm dependencies.
3. Optional `.env` settings: `EMAIL_NOTIFY_AWAY_MINUTES`, `MAIL_NOREPLY_ADDRESS`,
   `INSTANCE_DIR` / `PLUGINS_STRICT`. All default to the old behaviour.
4. Optional PM2 worker `owtranet-mail-log-ingest` (self-hosted mail only): copy
   its block from `ecosystem.config.js` into yours.
5. Docker: `git pull && docker compose up -d --build`, then apply whatever the
   app log lists under `SCHEMA OUT OF DATE`.

If code goes out before its migration, notification emails keep working the old
way, but profile pages and scheduled mail return errors until it is applied.

### Notification emails only when you're away

Mention, comment and direct-message emails no longer arrive while you're using
Owtranet. Before, "online" was measured from the last sign-in, so anyone who
stayed signed in for more than 30 minutes got emailed about things they were
already looking at.

- Owtranet now tracks real activity: any signed-in web or mobile request counts.
  The web app checks in while its tab is visible and the mobile app while it is
  open.
- Each member picks a setting under **Email Notifications** on their profile:
  | Setting | Emails go out |
  |---|---|
  | Only when I'm away (default) | after `EMAIL_NOTIFY_AWAY_MINUTES` (default 30) without web or mobile activity |
  | Only when I'm away and signed out of the mobile app | as above, and never while signed in to the mobile app (push covers it) |
  | Always | every time |
  | Never | never; in-app and push only |
- Existing members get the default automatically. The mobile app's profile
  screen doesn't show the setting, and saving there leaves it unchanged.

### New

- **Email Requests for Google Workspace / Microsoft 365 members** (#6). Members
  on an external mail provider can request a work address, and approving it sets
  their company email and DMs them. Before, the step was missing for those
  providers. Self-hosted approval is unchanged.
- **Instance plugins** (#5). Set `INSTANCE_DIR` to load your own
  `plugins/*.js` and serve `public/` overrides without forking. See
  `docs/PLUGINS.md`.
- **Member activity API** (#13). `GET /api/v1/activity` summarises what up to 20
  members did over up to 14 days, for stand-up or daily-brief integrations. It
  needs an integration token with `activity_read` (or `admin`). Private content
  is reported as counts only. With self-hosted mail, the optional
  `owtranet-mail-log-ingest` worker counts every SMTP send.
- **No-reply sender** (#12). Optional `MAIL_NOREPLY_ADDRESS` sends notification
  mail from a no-reply address, with a footer saying replies aren't delivered.
- **Mobile: multiple accounts** (#7). The app can stay signed in to several
  workspaces or users and switch between them (More → Switch account). This
  needs a new app build; it doesn't affect the server.

### Fixes

- **Scheduled mail** (#19). A send whose delivery couldn't be confirmed now goes
  to a `delivery_unknown` review state instead of being retried automatically,
  so it can't be sent twice. Dry runs no longer write. The migration moves older
  in-flight attempts into review; `docs/EMAIL_SYSTEM_ARCHITECTURE.md` covers
  reconciliation.
- **Exchange rates for non-USD instances** (#14). With `BASE_CURRENCY` other
  than USD, ledger and receipt conversions used USD rates. Rates are now
  cross-calculated to the base currency.
- **`DB_PORT` is honoured** by the server, workers and scripts (#10).
- **Docker first start is safe to interrupt or restart** (#18). The admin and
  placeholder agreement are created together, and existing installs are left
  alone.
- **Team agreement quizzes** (#12). A quiz with a free-text answer could never
  be passed. It now is checked like the other quizzes.
- **Security reports** (#21) go in public issues while Owtranet is pre-release
  (see `SECURITY.md`).

### Safer upgrades for every instance

- **`node scripts/check-schema.js`** (`npm run check-schema`) compares the
  database with `db/schema.sql` and names the migration file for each missing
  table, column or new allowed value (enum value) of an existing column. It
  works whichever version you are coming from.
- **`deploy.sh`** runs that check on the server **before restarting** and stops
  if anything is missing, so the old version keeps running until the migration
  is applied (`--skip-schema-check` overrides). It now also uploads `db/`.
- The **server** logs a `SCHEMA OUT OF DATE` warning at startup, and **Docker**
  (`docker/init.js`) prints the exact `docker compose exec` command for each
  missing migration.
- **`scripts/smoke-test.sh`** also checks the profile endpoint and branding
  config, and prints the deployed version.
- **Tests:** `npm test` (unit tests) and `test/db/upgrade-test.sh` (fresh install
  plus upgrade from 1.0.0 on real MySQL, each migration applied twice) run in
  GitHub Actions on every push and PR.

## 1.0.0 — 2026-11-02

First public release.
