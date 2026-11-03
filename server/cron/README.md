# Background jobs

Long-running workers and scheduled jobs. Each one is **dry-run by default** and
only writes with `--apply`; the daemons also take `--daemon` to loop forever
under PM2 (see `ecosystem.config.js`). All of them read the app's `.env`.

| Script | What it does | Typical PM2 invocation |
|---|---|---|
| `pushDispatcher.js` | Tails `notifications`, `direct_messages` and `group_messages` by id (high-water marks in `mobile_push_state`) and sends mobile push notifications — Android via FCM, iOS via APNs (`server/lib/push.js`). | `--apply --daemon` |
| `radioWorker.js` | Corporate Radio: keeps a TTS-friendly summary of every forum post in `radio_segments` (Claude, `RADIO_MODEL`), served by `GET /api/radio/feed`. | `--apply --daemon` |
| `scheduledEmailSender.js` | Sends queued webmail messages from `scheduled_emails` once `scheduled_at` (UTC) has passed; 3 attempts 5 min apart, then `failed`. `SCHEDULED_EMAIL_INTERVAL_SECS` (default 30). | `--apply --daemon` |
| `sweepGithubDocs.js` | Mirrors markdown docs from GitHub repos into `github_docs` so intranet search can find them. Sources are configured in Admin → Search Adapters (`search_adapters` / `search_adapter_rules`). Token: `GITHUB_DOCS_TOKEN`. | cron, e.g. hourly, `--apply` |
| `autoApproveDeliverables.js` | Auto-approves Investment Tracker deliverables that have been pending for six weeks or more (`auto_approved` column, shown as an "Auto-approved" badge). | cron, daily, `--apply` |

Examples:

```bash
node server/cron/radioWorker.js                  # dry run: list what would be generated
node server/cron/radioWorker.js --apply --post=123 --force   # regenerate one post
node server/cron/pushDispatcher.js --apply       # one pass
node server/cron/sweepGithubDocs.js --apply --repo=example-org/handbook
```

Logs go to PM2 (`pm2 logs <name>`).
