# Intranet Webhook API

Agent-facing reference for the token-authenticated `/api/v1/` API on
`https://intranet.example.com`. It gives an AI/voice agent or other automation
**Create / Read / Update** on forum posts and comments (no Delete), read access
to the **member directory**, **tasks** (list / read / create / update),
**sending and reading direct messages**, and **group chat channels** (list /
read / post) — all attributed to the caller via the acting-user mechanism
below. @-tagged AI agents reply in channels as well as in forum threads and DMs.

Responses are intentionally **small and paginated** — list endpoints return
short summaries, not full post bodies. Fetch a single post by id only when you
need its full content. (Why: large payloads time out voice agents.)

## Authentication

Every request needs an API token. Send it as either header:

```
X-API-Key: <token>
# or
Authorization: Bearer <token>
```

Verify a token:

```
GET /api/v1/auth/verify   → { valid, token_name, permissions, last_used }
```

All responses are JSON. Success looks like `{ "success": true, "data": ... }`;
errors look like `{ "error": "..." }` (or `{ "success": false, "error": ... }`)
with a 4xx/5xx status. A `403 {"error":"Invalid or expired API token"}` means the
token is unknown, deactivated, or past `expires_at` — see "Integration tokens".

### Personal vs integration tokens

| Kind | Made by | Name pattern | Lifetime | Rotation |
|------|---------|--------------|----------|----------|
| **Personal** | Profile → "Generate New API Token" (`POST /api/user/generate-token`) | `<Name> - Personal API Token` | 1 year | Generating a new one **deactivates the user's previous personal tokens** (every machine using the old one goes 403) |
| **Integration** | Inserted deliberately (see below) | anything else, e.g. `Voice agent (ElevenLabs)` | no expiry | Never touched by personal-token rotation |

An automated caller (the voice agent, a cron, a bot) must use an **integration
token**, never a personal token copied from someone's profile — if its owner
regenerates their personal token, every tool call starts failing with 403.
Provision one with:

```sql
INSERT INTO api_tokens (token, name, description, permissions, created_by, expires_at)
VALUES ('<64 hex chars from openssl rand -hex 32>',
        'Voice agent (ElevenLabs)',
        'Integration token for the voice agent webhook tools',
        JSON_OBJECT('admin', true, 'acting_user', true),
        1,        -- user 1, the System service account: the fallback identity
        NULL);
```

### Acting user (attribution)

A token whose `permissions.acting_user` is `true` may act **on behalf of a member**:
pass the member's id as `acting_user_id` (query string on GET, JSON body on
POST/PUT) or as the `X-Acting-User-Id` header. The request is then attributed to
that member — posts are authored by them, tasks are created by them, direct
messages are sent from them — instead of the token owner. The value must be an
active member id (`400 Unknown acting_user_id` otherwise); tokens without the
permission get `403` if they try. An empty value is ignored.

The ElevenLabs agent's tools fill `acting_user_id` automatically from the
conversation's `intranet_user_id` dynamic variable, which the mobile app sets
from the signed-in user when it starts a call (`POST /api/mobile/ai/session`).
It is deliberately a separate variable from `user_id`, so that other ElevenLabs
agents sharing the same tool objects (for example agents belonging to another
app with its own user ids) can map their callers to intranet members themselves
— e.g. by email via `GET /api/v1/members?q=<email>` — or leave it empty. Calls
that carry no identity fall back to the token owner for posts/tasks and are
refused for direct messages.

The agent's tools, prompt and secret are managed by
`server/scripts/syncElevenLabsAgentTools.js` — re-run it after changing any
endpoint below (`--dry-run` prints the plan).

## Forum posts

### List / search posts

```
GET /api/v1/forum/posts
```

Query params (all optional):

| Param   | Default | Notes |
|---------|---------|-------|
| `q`     | —       | Search title + content (substring match) |
| `tag`   | —       | Filter by tag slug |
| `page`  | 1       | Page number |
| `limit` | 10      | Items per page, **max 25** |

Returns summaries only (no `content_html`):

```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "id": 123,
        "title": "Quarterly update",
        "slug": "quarterly-update-1719600000000",
        "visibility": "all_members",
        "excerpt": "First 200 characters of the content…",
        "truncated": true,
        "comment_count": 4,
        "author": { "display_name": "Jane Doe", "username": "jdoe" },
        "created_at": "2026-06-20T14:03:00.000Z",
        "updated_at": "2026-06-20T14:03:00.000Z"
      }
    ],
    "page": 1, "limit": 10, "total": 42, "has_more": true
  }
}
```

### Read one post (full content)

```
GET /api/v1/forum/posts/:id
```

Returns the full post including `content`, `content_html`, author, stats, and tags.

### Create a post

```
POST /api/v1/forum/posts
```

Body:

| Field         | Required | Rules |
|---------------|----------|-------|
| `title`       | yes      | 5–200 chars |
| `content`     | yes      | 10–50,000 chars (markdown) |
| `tags`        | no       | array of strings |
| `author_name` | no       | display label, defaults to `System` |
| `visibility`  | no       | `all_members` (default), `specific_members`, or `author_only` |
| `priority`    | no       | `low` \| `normal` \| `high` \| `urgent` (non-normal prefixes the title) |

The post is created as the token's user (or the system admin if the token has no
user). A `system-generated` tag is always added.

### Update a post

```
PUT /api/v1/forum/posts/:id
```

Body — all fields optional: `title` (5–200), `content` (10–50,000), `tags`
(array, full replace), `visibility`, `priority`. A token may update **its own**
posts; an admin-scoped token (`permissions.admin === true`) may update any post.

### Delete — disabled

```
DELETE /api/v1/forum/posts/:id   → 403
```

Delete is intentionally disabled for this webhook API to prevent accidental data
loss. **To "delete" a post, rename it to `To be deleted`** (update the title) so a
human can remove it from the web UI.

## Comments

### List a post's comments

```
GET /api/v1/forum/posts/:postId/comments
```

Returns every comment on the post, oldest first: `id`, `content` (markdown),
`parent_comment_id` (set on replies), `author` (`id`, `name`, `username`,
`github_username`), `stats` (`upvotes`, `downvotes`), timestamps. 404 if the
post does not exist.

### Add a comment

```
POST /api/v1/forum/posts/:postId/comments
```

| Field | Required | Rules |
|-------|----------|-------|
| `content` | yes | 10–5000 chars, markdown |
| `parent_comment_id` | no | id of the comment being replied to; must belong to this post (404 otherwise) |

The comment is posted **as the acting user**, exactly as from the web UI:
@mentions are processed and the post author gets an in-app notification and an
email if they have been offline 30 minutes. Returns `201` with `comment_id`,
`post_id`, `parent_comment_id`, `author`.

Same identity rule as direct messages: an integration token must supply
`acting_user_id` (`400` otherwise); a personal token comments as its owner.

Editing and deleting comments are not exposed to the voice agents
(`PUT`/`DELETE /api/v1/comments/:id` exist for personal tokens).

## Member directory

### List / search members

```
GET /api/v1/members
```

Query params: `q` (search name + email), `page` (default 1), `limit` (default 25,
**max 50**). Available to any valid token.

```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": 7,
        "name": "Jane Doe",
        "email": "jane@example.com",
        "telephone": "+1-555-0100",
        "intranet_username": "jdoe",
        "department": "Operations",
        "position": "Operations Lead",
        "company": "Example Co"
      }
    ],
    "page": 1, "limit": 25, "total": 18, "has_more": false
  }
}
```

Only active members are returned (roles `user`, `admin`, `moderator`).

### Get one member

```
GET /api/v1/members/:id
```

Returns the same fields for a single member, or 404 if not found / not active.

## Tasks

The team task list (`/tasks` in the web UI). All endpoints need a user context —
the token owner, or the acting user (see "Acting user").

### List / search tasks

```
GET /api/v1/tasks
```

Query params (all optional): `q` (title + description), `status`
(`pending` | `in_progress` | `completed`), `priority` (`low` | `normal` | `high` |
`urgent`), `assigned_to` (member id), `view=mine` (created by or assigned to the
user context), `page` (default 1), `limit` (default 10, **max 25**). Open tasks
sort first, then by due date.

```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": 12, "title": "Send the Q3 deck to Sam", "status": "pending",
        "priority": "high", "due_date": "2026-09-12",
        "creator": { "id": 4, "name": "Jane Doe" },
        "assignee": { "id": 11, "name": "Sam Lee" },
        "comment_count": 0, "created_at": "…", "updated_at": "…"
      }
    ],
    "page": 1, "limit": 10, "total": 1, "has_more": false
  }
}
```

### Read one task

```
GET /api/v1/tasks/:id
```

Same fields plus `description` (markdown).

### Create a task

```
POST /api/v1/tasks
```

| Field | Required | Rules |
|-------|----------|-------|
| `title` | yes | 3–500 chars |
| `description` | no | markdown |
| `priority` | no | `low` \| `normal` (default) \| `high` \| `urgent` |
| `status` | no | `pending` (default) \| `in_progress` \| `completed` |
| `due_date` | no | `YYYY-MM-DD` |
| `assigned_to` | no | member id (404 if unknown); the assignee is notified |

Returns `201` with the task summary and `url`. `400` when there is no user context.

### Update a task

```
PUT /api/v1/tasks/:id
```

Body — all optional, send only what changes: `title`, `description`, `priority`,
`status`, `due_date`, `assigned_to`. Changes are logged to the task's activity
feed as the user context; a new assignee is notified. `400 No fields to update`
if nothing differs.

Delete is not exposed through the webhook API.

## Direct messages

### Send a direct message

```
POST /api/v1/messages/send
```

| Field | Required | Rules |
|-------|----------|-------|
| `recipient_id` | yes | member id (404 if unknown) |
| `content` | yes | 1–2000 chars, markdown |

The message is sent **from the acting user** to the recipient, exactly as if
they had typed it in `/messages`: the recipient gets an in-app notification and
an email if they have been offline for 30 minutes. Returns `201` with
`message_id`, `conversation_id`, `sender`, `recipient_id`.

An integration token (`acting_user` permission) **must** supply `acting_user_id`
here — a DM is never sent from the token's service account (`400` otherwise). A
personal token sends as its owner.

There is no separate `/api/webhooks/direct-message` path; this is the outbound-DM webhook.

### List the acting user's conversations

```
GET /api/v1/messages/conversations?limit=10
```

Threads the acting user is part of, most recent activity first. Each entry has
`conversation_id`, `member` (`id`, `name` — the other party), `unread_count`
(messages to the acting user not yet read), and `last_message` (`id`,
`direction` `sent`/`received`, `content`, `created_at`) or `null`. `limit`
default 10, max 25.

### Read messages with one member

```
GET /api/v1/messages/with/:member_id?limit=10
```

The most recent messages between the acting user and `member_id`, **newest
first**. Returns `member`, `conversation_id` (`null` when they have never
messaged), `unread_count`, and `messages` — each with `id`, `direction`
(`sent`/`received` from the acting user's point of view), `sender`, `content`,
`is_read`, `created_at`. Soft-deleted messages are omitted. `limit` default 10,
max 50. `404` for an unknown member.

Both read routes are **read-only**: nothing is marked as read, so the caller's
unread badge in the app is untouched. Like `/send`, they require the acting
user — an integration token gets `400` without `acting_user_id`, because the
service account has no inbox — and a personal token reads as its owner.

## Group chat

The `/group-chat` channels (General, Marketing, Engineering Team…). The browser
routes need a JWT, so these are the token-authenticated mirrors. `:group` is a
numeric id **or** the group's name / display name, case-insensitive (`General`).

### List channels

```
GET /api/v1/group-chat/groups
```

Active groups the caller can post to: every public group, plus private groups
the acting user belongs to. Each entry has `id`, `name`, `display_name`, `url`,
`description`, `visibility`, `member_count`, `is_member`, `last_message_at`.

### Read a channel

```
GET /api/v1/group-chat/:group/messages?limit=20
```

Recent messages, **newest first**, `limit` default 20, max 50. Returns `group`,
`is_member` and `messages` — each with `id`, `sender` (`id`, `name`), `content`
(markdown), `reply_to_id`, `is_edited`, `created_at`. Read-only: nothing is
marked as read. `404` unknown group, `403` private group the caller is not in.

### Post to a channel

```
POST /api/v1/group-chat/:group/messages
```

| Field | Required | Rules |
|-------|----------|-------|
| `content` | yes | 1–2000 chars, markdown |
| `reply_to_id` | no | id of a message in the same group (404 otherwise) |

Sent **from the acting user** when `acting_user_id` is supplied, otherwise from
the token's owner — for an integration token owned by a service account
(e.g. user 1, the System account) that is the right byline for anything
an automation writes. @mentions notify as they do in the app, **and an @mentioned
AI agent (e.g. `@assistant`) replies in the channel** the
same way it would in a forum thread or DM — one reply per
tagged agent, rate-limited per channel per hour
(`AGENT_GROUP_REPLIES_PER_CHANNEL_PER_HOUR`, default 6, sharing the global
`AGENT_REPLIES_PER_HOUR` cap). A sender who is not yet a member of a
**public** group is added to it on first post so the channel roster shows who
is writing; private groups return `403`. An @mentioned agent gets the same
gate on its own reply — tagging one in a **private** channel does *not* add it
as a member; the agent's reply is simply not posted, and its
`ai_agent_replies` row is marked `failed`. Returns `201` with `message_id`,
`group` (`id`, `name`, `display_name`, `url`), `sender`, `reply_to_id`,
`created_at`, `agents_summoned` (array of `{handle, name}` for any agents
tagged and brought in — note an agent can appear here and still fail to post
if the group turns out to be private; `agents_summoned` reflects who was
*queued*, not who successfully replied).

### Voice agent tools

`intranet_list_channels`, `intranet_read_channel_messages` and
`intranet_post_channel_message` mirror the three endpoints above for the
ElevenLabs voice agent — see `server/scripts/syncElevenLabsAgentTools.js`.

## Out of scope

Attachment content, Delete via webhook, marking messages read via webhook,
Google Drive integration, and per-token capability scopes are not implemented yet.
