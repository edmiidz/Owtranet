# Mobile App and Corporate Radio Station

The Expo mobile app (feature parity with the web client), the Corporate Radio
Station (spoken summaries of forum posts), and push notifications.

## What was built

| Layer | Path | Purpose |
|---|---|---|
| Mobile app | `mobile/` | Expo (React Native + TypeScript, expo-router). iOS + Android. |
| Mobile API | `server/routes/mobile.js` → `/api/mobile/*` | Bootstrap, badge counts, home aggregate, push-token registration. |
| Radio API | `server/routes/radio.js` → `/api/radio/*` | Per-listener, permission-filtered feed of pre-generated TTS segments. |
| Radio worker | `server/cron/radioWorker.js` | Layer 1: background process that writes a TTS-friendly segment per post. |
| Push dispatcher | `server/cron/pushDispatcher.js` | Tails notifications / DMs / group messages → FCM push. |
| Shared libs | `server/lib/postVisibility.js`, `radioSummarizer.js`, `fcmPush.js` | One visibility predicate for every consumer; Claude summarizer; FCM HTTP v1 client. |
| Schema | `server/migrations/add_mobile_radio.sql` | `radio_segments`, `radio_listens`, `mobile_devices`, `mobile_push_state`. |

The mobile app reuses **every existing JWT `/api/*` route** for feature work (posts,
comments, likes, DMs, group chat, members, search, ledger, deliverables, agreements,
notifications, profile). Only the four things a native client needs on top were added.

## Corporate Radio architecture

```
posts ──▶ radioWorker.js (PM2 daemon, every 5 min)
             │  for each post without a segment (or whose title/body hash changed):
             │  Claude (RADIO_MODEL) → { headline, tts_text }   (60–160 spoken words)
             ▼
        radio_segments (1 row per post, no permissions stored here)
             │
GET /api/radio/feed ── JOIN posts, apply visiblePostsWhere(userId) ──▶ station intro +
             │          (exactly the forum's rule: all_members | author | specific_members grant)   ordered segments
             ▼
mobile app: expo-speech reads intro → segments → outro with the device TTS voice
            marks each finished segment via POST /api/radio/segments/:id/listened
```

Personalization = the existing post permission model, nothing more. Admins get no
extra read access, same as the forum. Deleted posts cascade-delete their segment.

The worker follows the repo convention: **dry-run unless `--apply`**.

```bash
node server/cron/radioWorker.js                      # list what would be generated
node server/cron/radioWorker.js --apply              # one pass
node server/cron/radioWorker.js --apply --daemon     # what PM2 runs
node server/cron/radioWorker.js --apply --all        # backfill beyond RADIO_BACKFILL_DAYS
node server/cron/radioWorker.js --apply --post=238 --force   # regenerate one post
```

Admins (or the post author) can also hit `POST /api/radio/posts/:postId/regenerate`.

**Replies are part of the segment.** The summarizer is given the post *and* its
comments (oldest first, last 12, `is_accepted` flagged) and is told to lead with
the answer when a reply answers the question, attributing it to the replier. The
segment's `source_hash` covers title + body + every reply's id/updated_at/text,
and `radio_segments.comment_count` records how many replies it was built from,
so the worker regenerates when a reply is added, edited **or deleted**. New or
edited replies are picked up only after `RADIO_COMMENT_SETTLE_MINS` (default 10)
of quiet, so a burst of replies costs one regeneration. Hand-edited (`is_manual`)
segments are still never overwritten automatically.

## Publishing news to the radio

Anything posted to the forum is picked up by the radio worker, so automated
reports (CI summaries, weekly digests…) only need to create an ordinary post via
`POST /api/v1/forum/posts` (see `docs/WEBHOOK_API.md`). Write them in plain,
spoken-friendly prose and they inherit the post's visibility rules.

## API added

- `POST /api/mobile/ai/session` — mint an ElevenLabs WebRTC conversation token for the workspace agent (see "Call AI" below). `features.call_ai` + `ai_agent` added to `/api/mobile/config` and `/bootstrap`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/mobile/config` | public | Branding + feature flags + `min_app_version`; the login screen validates a workspace URL with it. |
| GET | `/api/mobile/bootstrap` | JWT | Fresh user row, branding, features, badge counts. |
| GET | `/api/mobile/counts` | JWT | `unread_notifications`, `unread_messages`, `pending_agreements`, `radio_unheard`. |
| GET | `/api/mobile/home` | JWT | Recent visible posts, pending agreement assignments, quicklinks, recent DMs. |
| POST | `/api/mobile/devices` | JWT | `{push_token, platform, device_name?, app_version?}` (Expo token). |
| DELETE | `/api/mobile/devices/:token` | JWT | On sign-out. |
| GET | `/api/radio/feed` | JWT | `?days=7&limit=30&unheard=1&since=ISO` → `{station, segments[]}`. |
| GET | `/api/radio/segments/:id` | JWT | Permission-checked single segment. |
| POST | `/api/radio/segments/:id/listened` | JWT | `{completed?: boolean}`; idempotent. |
| POST | `/api/radio/listens/reset` | JWT | Forget listening history. |
| GET | `/api/radio/status` | JWT | Worker stats + per-user unheard count. |
| POST | `/api/radio/posts/:postId/regenerate` | JWT (admin or author) | Regenerate now. |

## Call AI (voice call to the workspace agent)

The "Call AI" button (Home card + More → Team) opens a live **WebRTC** voice call to the
workspace's ElevenLabs agent, via the official `@elevenlabs/react-native` SDK on top of
`@livekit/react-native`. The agent is one you create in your own ElevenLabs account; its
webhook tools call this server's token-authenticated `/api/v1/*` endpoints
(forum posts, member directory, tasks, direct messages — see `docs/WEBHOOK_API.md`). The
tools, prompt and API secret are defined in `server/scripts/syncElevenLabsAgentTools.js`;
re-run it (on the box, it reads `.env`) after changing the agent or the v1 API.

How a call works:
1. App → `POST /api/mobile/ai/session` (JWT). The server mints a single-use conversation token
   from ElevenLabs (`GET /v1/convai/conversation/token?agent_id=…`, header `xi-api-key`) and
   returns `{ token, agent_id, agent_name, dynamic_variables }`. The app never holds the API key.
2. App → `startSession({ conversationToken, connectionType: 'webrtc', dynamicVariables, userId })`.
   The dynamic variables (`user_id`, `user_name`, `user_email`, `user_username`, `user_role`,
   `company_name`, `platform: 'mobile'`) are stored on the ElevenLabs conversation and can be
   referenced as `{{user_name}}` etc. in the agent prompt (the prompt does not use them yet).
3. Transcript lines arrive through `onMessage`; mute uses the SDK's `setMuted`; the SDK owns the
   native audio session (speaker output by default) and stops it on `endSession`.

Per-instance enablement (`.env`): `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
`ELEVENLABS_AGENT_NAME`. Without the first two, `/api/mobile/config` and `/bootstrap` report
`features.call_ai=false`, `ai_agent=null`, the session endpoint answers 404 `not_configured`, and
the app hides the button.

Attribution: the agent's tools authenticate with one **integration** API token
(e.g. `Voice agent (ElevenLabs)`, `permissions.acting_user = true`) and pass the caller's `user_id`
dynamic variable as `acting_user_id`, so posts, tasks and direct messages are attributed to the
signed-in caller, not to the token. Sessions started without the app (no `user_id`) fall back
to the token owner for posts/tasks and cannot send direct messages. The token must never be a
personal token: regenerating a personal token deactivates the old one and every tool goes 403.

Limits / follow-ups:
- Native build required (LiveKit/WebRTC): `expo prebuild --clean` and a new iOS/Android build;
  Expo Go cannot run it.

## Deploying (per instance)

1. **Schema**: the radio/mobile tables are part of `db/schema.sql`. For an older database
   apply the migration (idempotent):
   ```bash
   mysql -h $DB_HOST -u $DB_USER -p $DB_NAME < server/migrations/add_mobile_radio.sql
   ```
2. **Code**: `./deploy.sh` ships `server/` wholesale, so the routers/libs/workers are
   included. `server.js` mounts the routers just before the SPA catch-all.
3. **Env**: see `.env.example` — everything has a default; the radio needs
   `ANTHROPIC_API_KEY`.
4. **PM2**: `ecosystem.config.js` now defines `owtranet-radio-worker` and
   `owtranet-push-dispatcher`. On the box:
   ```bash
   cd /var/www/owtranet && sudo pm2 start ecosystem.config.js --only owtranet-radio-worker,owtranet-push-dispatcher && sudo pm2 save
   ```
   (Adjust the path to your `DEPLOY_PATH`. Running several instances on one box? Give
   each its own PM2 names, e.g. `acme-radio-worker`.)
5. First worker pass summarizes the last `RADIO_BACKFILL_DAYS` (30) days of posts.

## Mobile app

```bash
cd mobile && npm install
npx expo start            # Expo Go / dev client
npx expo run:ios          # native build (needs Xcode)
npx expo run:android
```

- **Workspace URL** is chosen at login (default comes from `extra.defaultWorkspaceUrl` in
  `app.json`), so one build can serve several instances. Branding comes from `/api/mobile/config`.
- Before building your own app, set your bundle id / package, associated domains and EAS
  project in `mobile/app.json` — see `mobile/README.md`.
- Session: JWT in `expo-secure-store`; the same 7-day token the web app uses.
- The `pending_agreement` 403 (`requiresAgreement`) routes to an in-app signing screen.
- Tabs: **Home** (badges, radio teaser, action items, latest posts), **Forum** (Q&A: list,
  search, sort, post detail, replies, votes, attachments, visibility), **Radio** (player,
  playlist, settings), **Messages** (DMs + group chat), **More** (members, documents,
  agreements/e-sign incl. payroll fields, expenses/ledger with receipt OCR, investment
  tracker, notifications, profile, quick share, search).
- **Quick share** (`/share`, deep link `intranet://share?url=&title=&text=`) is the mobile
  equivalent of the Chrome post-creator extension: clipboard URL → forum post tagged
  `shared-link`.
- Push: native **FCM** registration tokens (`getDevicePushTokenAsync()`) registered on
  launch; server-side `pushDispatcher.js` sends via FCM HTTP v1 for new notifications,
  DMs and group messages. Tapping deep-links into the thread. See "Push notifications"
  below (Android via FCM, iOS via APNs).
- Radio playback uses `expo-speech`. iOS background audio mode is declared in
  `app.json`; Android cannot pause TTS mid-utterance so pause restarts the segment.

## Push notifications (Android: FCM HTTP v1 · iOS: APNs direct)

Delivery goes **straight from our server** to the platform push service — no Expo push
service, no EAS project id, no third party in the path. `server/lib/push.js` routes each
registered device by its token shape: 64 hex chars is an APNs token (iOS), anything longer is
an FCM registration token (Android).

```
DM inserted ──▶ pushDispatcher.js (PM2, polls every 20s, high-water marks in mobile_push_state)
                   │  server/lib/push.js
         ┌─────────┴──────────┐
         ▼                    ▼
 fcmPush.js (Android)   apnsPush.js (iOS)
 service-account JWT    ES256 provider token (.p8, cached 50 min)
 ─▶ OAuth2 token        HTTP/2 POST https://api.push.apple.com/3/device/<token>
 POST fcm …/messages:send   BadDeviceToken / Unregistered / DeviceTokenNotForTopic ─▶ is_active = 0
 UNREGISTERED ─▶ is_active = 0   (BadDeviceToken is retried once on the other APNs environment)
         └─────────┬──────────┘
                   ▼
   device ──▶ tap ──▶ hrefForNotificationData() ──▶ /messages/<conversation_id>
```

The app registers whatever `Notifications.getDevicePushTokenAsync()` returns on its platform
(`mobile/src/lib/push.ts`) — an FCM registration token on Android, a raw APNs device token on
iOS — and POSTs it to `/api/mobile/devices` on every launch that has a session. No Firebase
iOS SDK is involved.

**Firebase setup (Android).** Create a Firebase project, add an Android app with your
package name (the `android.package` in `mobile/app.json`), download its
`google-services.json` into `mobile/` and set `"googleServicesFile": "./google-services.json"`
under `android` in `app.json`. It is client config that ships inside the APK, not a secret;
`expo prebuild` copies it into the native project and applies the
`com.google.gms.google-services` Gradle plugin.

**Server credential.** Create a service account in the same Firebase/GCP project with role `roles/firebasecloudmessaging.admin` (grants `cloudmessaging.messages.create`).
The key lives **only on the box** at `/var/www/<instance>/secrets/fcm-service-account.json`
(chmod 600, gitignored), pointed at by `FCM_SERVICE_ACCOUNT_FILE` in `.env`.
`FCM_SERVICE_ACCOUNT_JSON` takes inline JSON instead if you prefer.

Without the credential the dispatcher logs one error and sends nothing — it does not crash.

**iOS credential (APNs).** Create an Apple **APNs auth key** (`.p8`) at
developer.apple.com → Keys. Keys are team-wide, so an existing team key works. Make sure it is
enabled for **both** APNs environments: a key restricted to production answers sandbox
requests with `BadEnvironmentKeyInToken`, so it cannot reach Xcode-installed builds. The key lives **only on the box** at
`/var/www/<instance>/secrets/apns-AuthKey_<KEYID>.p8` (chmod 600, gitignored) with
`APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` and `APNS_ENV`.

Environments: a build installed **from Xcode** registers a **sandbox** token; a **TestFlight /
App Store** build registers a **production** token (Xcode rewrites the `aps-environment`
entitlement when archiving). `APNS_ENV` is only the first environment tried; a
`BadDeviceToken` is retried on the other one and the answer is remembered per token, so both
kinds of build get their pushes.

**Test a device** without creating a DM: `node server/scripts/sendTestPush.js --user <id>`
(add `--dm <conversation_id>` to test the deep link).

**A second instance** needs its own `FCM_SERVICE_ACCOUNT_FILE` (the same service account
is fine) and its own Android app registered in Firebase if its package name differs.

### Known gaps / follow-ups
- iOS/Android **share-sheet** target (share from Safari straight into the app) needs a
  native share extension (`expo-share-intent`) and a dev build; Quick share covers the
  clipboard/deep-link path today.
- Ledger receipts: the JSON `POST /api/ledger` has no receipt upload field, so the photo
  is used for AI extraction only. Attach the file on the web if it must be stored.
- `mobile/assets/` holds neutral placeholder icons/splash — replace them with your own.
