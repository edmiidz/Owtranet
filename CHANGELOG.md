# Changelog

Each release lists what changed for people running an instance and what an
upgrade needs. To upgrade any instance from any earlier version, follow
[Upgrading an existing instance](README.md#upgrading-an-existing-instance):
`node scripts/check-schema.js` names every migration your database still needs.

## Unreleased

### Upgrade steps

No migrations and no new settings.

### Fixes

- **Read routes that skipped sign-in now require it.** Member profiles
  (`GET /api/users/:username`, including `id:N` lookups), posts by id
  (`GET /api/posts/id/:id`), quick links and GitHub issues could be read
  without signing in. Posts by id now also follow post visibility, as the
  forum does: author-only and specific-member posts return 404 to anyone else.
  The web and mobile apps already send a token on these calls, so nothing
  changes for members. Covered by the new `test/db/access-test.sh` in CI.
### Fixes

- **Mobile app stuck on error screens after the session expired.** The server
  answers an expired or invalid sign-in with 403 "Invalid or expired token", but
  the app only signed out on 401, so every screen showed an error with a Retry
  that could never work. The app now signs that account out (or switches to the
  next signed-in account), as the web client already did. Other 403s, such as
  permission denials, still keep you signed in. Ships with the next app build.
### Fixes

- **Mobile: tapping a comment or mention notification now opens the post**
  (#35). "New comment on your post" and mention notifications did nothing when
  tapped in the list, and opened the Notifications screen when tapped as a push.
  Both now open the post, group channel or task they refer to. Ships with the
  next app build.
### Fixes

- **Admins no longer get a direct message for every deliverable submitted
  through the API** (#40). Each `POST /api/v1/deliverables` used to DM every
  admin, and each DM became a push notification, so automated integrations
  flooded admins' phones. API submissions still appear in the Investment
  Tracker for review.
### Changes

- **Direct messages show the time of day** (#36). Instead of "3h ago" or a
  bare date, messages and the conversation list show `2:16 PM` for today,
  `Yesterday 3:40 PM`, or `2026-09-28 3:40 PM` for older messages. Hover for
  the full date, time and time zone.
### Fixes

- **Direct message threads open at the newest message** (#37). Opening a long
  thread used to load its whole history and scroll down from the first message,
  which could take seconds, and background refreshes pulled readers back down
  while they read older messages. Threads now open at the bottom straight away,
  load the newest 50 messages, and fetch earlier ones as you scroll up.
  `GET /api/messages/conversations/:id` accepts optional `limit` (max 200) and
  `before_id`; without them it returns the full history as before, so the
  mobile app and other API clients are unaffected.
### Fixes

- **Agreements: members are no longer sent to a team agreement that doesn't
  apply to them** (#39). The profile page told every member without a signed
  team agreement "You must sign the team agreement" and linked to `/agreement`,
  even when their agreements are assigned individually, which could lead someone
  to sign the wrong one. The profile now lists only agreements actually assigned
  to you that still need signing, each linking to its own page; voided
  signatures are shown greyed out with a "voided" badge. `/agreement` sends
  members with individual assignments to their pending one (or the dashboard),
  and shows "No agreement required" instead of an error when no team agreement
  is active.
### Fixes

- **Android: the release build compiles again, and a fresh `npm install` in
  `mobile/` works** (#43). `@livekit/react-native-webrtc` 144.2.0 broke the
  Android compile while iOS kept building, and `@livekit/react-native-expo-plugin`
  1.2.0 failed npm's peer-dependency check. Both are now pinned (see
  `docs/MOBILE_APP.md`). If you build the app yourself, delete
  `mobile/node_modules` and run `npm install` again before the next build.
- `build-android-apk.sh` no longer puts colour codes in the APK filename when
  `FORCE_COLOR` is set.

### Added

- `mobile/scripts/distribute-android.sh` sends an Android build to testers through
  Firebase App Distribution. Configure it with `FIREBASE_ANDROID_APP_ID` (and
  optionally `FIREBASE_TESTER_GROUP`).

## 1.1.1 — 2026-11-18

### Upgrade steps (from 1.1.0)

No migrations and no new settings. Deploy as usual. The first `./deploy.sh` with
this version records your server's dependency state without reinstalling. From
then on it runs `npm ci --omit=dev` itself whenever `package-lock.json` changes,
so you no longer need to run `npm install` on the server by hand. Coming from
1.0.x, follow the 1.1.0 steps first.

### Fixes

- **Self-hosted Email Request approval always failed** (#3, #24). Approving a
  request hit an undefined variable partway through creating the mailbox, so it
  reported "account creation failed" and could leave a half-created mailbox. The
  setup email also showed the wrong IMAP username; it is now the full address.
  If an earlier approval failed this way, re-approve the request after
  upgrading.
- **First deploy to an empty server** (#1, #25). `deploy.sh` now:
  - creates the app directories;
  - copies `ecosystem.config.js` once (never overwriting yours);
  - installs server dependencies from the shipped `package-lock.json`;
  - starts the app in PM2 if it isn't running yet.
- **Invites report the real email result** (#25). When the invitation email
  can't be sent, Admin → Invites says so and shows the link to share, instead
  of claiming it was emailed.
- **`npm run setup` no longer rewrites `package-lock.json`** (it uses `npm ci`).
- The GitHub docs sweeper no longer exports a constant that was removed.
- CI now fails on undefined variables in server code, the kind of bug behind #3.

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
