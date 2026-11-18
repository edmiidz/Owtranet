# Changelog

Each release lists what changed for people running an instance and what an
upgrade needs. To upgrade any instance from any earlier version, follow
[Upgrading an existing instance](README.md#upgrading-an-existing-instance):
`node scripts/check-schema.js` names every migration your database still needs.

## 1.1.0 — 2026-11-18

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
- Existing members get the default automatically. No mobile app release is
  needed. The app's profile screen doesn't show the setting, and saving there
  leaves it unchanged.

### Safer upgrades for every instance

- **`node scripts/check-schema.js`** (`npm run check-schema`) compares the
  database with `db/schema.sql` and lists each missing table or column with the
  migration file that adds it. It works whichever version you are coming from.
- **`deploy.sh`** runs that check on the server **before restarting** and stops
  if anything is missing, so the old version keeps running until the migration
  is applied (`--skip-schema-check` overrides). It now also uploads `db/`.
- The **server** logs a `SCHEMA OUT OF DATE` warning at startup naming the
  missing migrations, and **Docker** (`docker/init.js`) prints the exact
  `docker compose exec` command for each one.
- **`scripts/smoke-test.sh`** also checks the profile endpoint and branding
  config, and prints the deployed version.
- **Tests:** `npm test` (unit tests) and `test/db/upgrade-test.sh` (fresh
  install plus upgrade from 1.0.0 on real MySQL) both run in GitHub Actions on
  every push and PR.

### Upgrade steps (from 1.0.x)

1. Apply `server/migrations/add_email_notification_mode.sql`. It is idempotent
   and adds `users.email_notification_mode` (and `users.last_active_at` on
   databases that predate it).
2. Deploy as usual. No new npm dependencies are needed.
3. Optional: set `EMAIL_NOTIFY_AWAY_MINUTES` in `.env`.

If the code goes out before the migration, notification emails keep working the
old way (they are never silently dropped), but profile pages return errors until
it is applied.

## 1.0.0 — 2026-11-02

First public release.
