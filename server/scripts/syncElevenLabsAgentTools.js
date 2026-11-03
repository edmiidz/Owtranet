#!/usr/bin/env node
/**
 * Sync the workspace ElevenLabs voice agent (the mobile app's "Call AI"
 * project-manager assistant) with this server's webhook API: upserts the agent's tools,
 * its prompt, and the dynamic-variable placeholders, and optionally rotates the
 * intranet API key the tools authenticate with.
 *
 * Why this exists: tools hand-built in the ElevenLabs console against an API
 * token copied from a personal profile break (HTTP 403) the moment that person
 * regenerates their token. The tools are defined here instead, and they use a
 * dedicated integration token that survives personal-token rotation (see
 * docs/WEBHOOK_API.md → "Integration tokens").
 *
 * Reads from .env (run on the box, or export the vars):
 *   ELEVENLABS_API_KEY     workspace key that owns the agent (required)
 *   ELEVENLABS_AGENT_ID    the agent to sync (required)
 *   BASE_URL               this intranet's public URL (default https://intranet.example.com)
 *   ELEVENLABS_AGENT_NAME  spoken name (default "Assistant")
 *   COMPANY_NAME           used in the prompt (default "Owtranet")
 *   VOICE_AGENT_INTRANET_API_KEY
 *                          if set, the ElevenLabs secret the tools send as
 *                          X-API-Key is updated to this value (or created)
 *
 * Usage:
 *   node server/scripts/syncElevenLabsAgentTools.js            # apply
 *   node server/scripts/syncElevenLabsAgentTools.js --dry-run  # print the plan only
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const EL_BASE = 'https://api.elevenlabs.io/v1/convai';
const DRY_RUN = process.argv.includes('--dry-run');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;
const BASE_URL = (process.env.BASE_URL || 'https://intranet.example.com').replace(/\/$/, '');
const AGENT_NAME = process.env.ELEVENLABS_AGENT_NAME || 'Assistant';
const COMPANY_NAME = process.env.COMPANY_NAME || 'Owtranet';
const SECRET_NAME = 'INTRANET_API_KEY';
const NEW_INTRANET_KEY = process.env.VOICE_AGENT_INTRANET_API_KEY || null;

if (!API_KEY || !AGENT_ID) {
  console.error('ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID are required');
  process.exit(1);
}

async function el(method, route, body) {
  const res = await fetch(`${EL_BASE}${route}`, {
    method,
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${route} → HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Tool definitions. `acting_user_id` is filled by ElevenLabs from the
// conversation's `intranet_user_id` dynamic variable (set by the mobile app's
// /api/mobile/ai/session, or by any other surface that starts a conversation
// with this agent) — the LLM never supplies it. The server attributes the
// action to that member; empty means "no caller identity". It is deliberately
// NOT `user_id`: other platforms that host the same agent may fill `user_id`
// with their own user id, a different id space from intranet member ids.
// ---------------------------------------------------------------------------
function param(type, description, extra = {}) {
  return { type, description, ...extra };
}
// ElevenLabs allows exactly one of description / dynamic_variable / constant_value on a param.
const ACTING_USER = { type: 'string', dynamic_variable: 'intranet_user_id' };

function webhook({ name, description, method, url, query, pathParams, bodyProps, bodyRequired, timeout = 20 }, secretId) {
  const headers = { 'X-API-Key': { secret_id: secretId } };
  if (bodyProps) headers['Content-Type'] = 'application/json';
  const api_schema = {
    url,
    method,
    request_headers: headers,
    path_params_schema: pathParams || {},
    query_params_schema: query ? { properties: query, required: [] } : null,
    request_body_schema: bodyProps
      ? { type: 'object', description: '', properties: bodyProps, required: bodyRequired || [] }
      : null,
    content_type: 'application/json'
  };
  return {
    type: 'webhook',
    name,
    description,
    response_timeout_secs: timeout,
    disable_interruptions: false,
    force_pre_tool_speech: false,
    api_schema
  };
}

function toolDefinitions(secretId) {
  const V1 = `${BASE_URL}/api/v1`;
  const defs = [
    {
      name: 'intranet_list_posts',
      description: 'Search and list intranet forum posts. Returns short summaries (title, excerpt, author, counts) — NOT full bodies. Use intranet_get_post afterwards to read a post in full. Results are paginated (limit max 25); the response includes page, total, and has_more.',
      method: 'GET', url: `${V1}/forum/posts`,
      query: {
        q: param('string', 'Optional. Search text matched against post title and content.'),
        tag: param('string', 'Optional. Filter to a single tag slug.'),
        page: param('integer', 'Optional. Page number, default 1.'),
        limit: param('integer', 'Optional. Results per page, default 10, max 25.')
      }
    },
    {
      name: 'intranet_get_post',
      description: 'Read one intranet forum post in full (full markdown body) by its numeric id.',
      method: 'GET', url: `${V1}/forum/posts/{post_id}`,
      pathParams: { post_id: param('string', 'The numeric id of the forum post to read.') }
    },
    {
      name: 'intranet_create_post',
      description: 'Create a new intranet forum post as the caller. title is 5-200 chars; content is 10-50000 chars of markdown. Use this to publish an announcement, status update, or note for the team. Confirm title and body with the user first.',
      method: 'POST', url: `${V1}/forum/posts`,
      bodyProps: {
        title: param('string', 'Post title, 5-200 characters.'),
        content: param('string', 'Post body in markdown, 10-50000 characters.'),
        tags: param('array', 'Optional list of tag names.', { items: { type: 'string', description: 'Tag name' } }),
        priority: param('string', 'Optional: low, normal (default), high, or urgent.'),
        acting_user_id: ACTING_USER
      },
      bodyRequired: ['title', 'content']
    },
    {
      name: 'intranet_update_post',
      description: 'Update an existing intranet forum post by numeric id. Send only the fields to change (title, content, tags, visibility). NOTE: the webhook cannot delete a post — to retire one, update its title to "To be deleted" so a human can remove it from the web UI.',
      method: 'PUT', url: `${V1}/forum/posts/{post_id}`,
      pathParams: { post_id: param('string', 'The numeric id of the forum post to update.') },
      bodyProps: {
        title: param('string', 'New title, 5-200 characters.'),
        content: param('string', 'New body in markdown, 10-50000 characters.'),
        tags: param('array', 'Full replacement list of tag names.', { items: { type: 'string', description: 'Tag name' } }),
        visibility: param('string', 'all_members, specific_members, or author_only.'),
        acting_user_id: ACTING_USER
      }
    },
    {
      name: 'intranet_list_comments',
      description: 'Read the comments on one intranet forum post by its numeric id, oldest first. Each comment has id, content (markdown), parent_comment_id (set when it is a reply to another comment), author name and vote counts. Use this after intranet_get_post when the user asks what people said or replied.',
      method: 'GET', url: `${V1}/forum/posts/{post_id}/comments`,
      pathParams: { post_id: param('string', 'The numeric id of the forum post whose comments to read.') }
    },
    {
      name: 'intranet_add_comment',
      description: 'Add a comment to an intranet forum post as the caller. content is 10-5000 chars of markdown. To reply to a specific comment, pass its id as parent_comment_id (from intranet_list_comments). The post author is notified (email if offline). Read the comment text back and get a clear yes before posting.',
      method: 'POST', url: `${V1}/forum/posts/{post_id}/comments`,
      pathParams: { post_id: param('string', 'The numeric id of the forum post to comment on.') },
      bodyProps: {
        content: param('string', 'The comment text in markdown, 10-5000 characters, written in the caller\'s voice.'),
        parent_comment_id: param('integer', 'Optional. Id of the comment being replied to, from intranet_list_comments.'),
        acting_user_id: ACTING_USER
      },
      bodyRequired: ['content']
    },
    {
      name: 'intranet_list_members',
      description: 'Search the intranet member directory by name or email. Returns active members with id, name, email, telephone, plus department/position/company. Use the returned id for assigned_to (tasks) and recipient_id (direct messages). Paginated (limit max 50).',
      method: 'GET', url: `${V1}/members`,
      query: {
        q: param('string', 'Optional. Search text matched against member name and email.'),
        page: param('integer', 'Optional. Page number, default 1.'),
        limit: param('integer', 'Optional. Results per page, default 25, max 50.')
      }
    },
    {
      name: 'intranet_get_member',
      description: 'Read one intranet member by numeric id (name, email, telephone, department/position/company).',
      method: 'GET', url: `${V1}/members/{member_id}`,
      pathParams: { member_id: param('string', 'The numeric id of the member to read.') }
    },
    {
      name: 'intranet_list_tasks',
      description: 'List or search intranet tasks (the team to-do list). Returns summaries: id, title, status (pending, in_progress, completed), priority, due_date, creator, assignee. Open tasks sort first, then by due date. Use view=mine for tasks created by or assigned to the caller. Paginated (limit max 25).',
      method: 'GET', url: `${V1}/tasks`,
      query: {
        q: param('string', 'Optional. Search text matched against task title and description.'),
        status: param('string', 'Optional. pending, in_progress, or completed.'),
        priority: param('string', 'Optional. low, normal, high, or urgent.'),
        assigned_to: param('integer', 'Optional. Member id to filter by assignee.'),
        view: param('string', 'Optional. "mine" = tasks the caller created or is assigned; default all.'),
        page: param('integer', 'Optional. Page number, default 1.'),
        limit: param('integer', 'Optional. Results per page, default 10, max 25.'),
        acting_user_id: ACTING_USER
      }
    },
    {
      name: 'intranet_get_task',
      description: 'Read one intranet task in full (includes the description) by numeric id.',
      method: 'GET', url: `${V1}/tasks/{task_id}`,
      pathParams: { task_id: param('string', 'The numeric id of the task to read.') }
    },
    {
      name: 'intranet_create_task',
      description: 'Create an intranet task as the caller. Only title is required. To assign it, look the person up with intranet_list_members first and pass their id as assigned_to (they get notified). Confirm title, assignee and due date with the user before calling.',
      method: 'POST', url: `${V1}/tasks`,
      bodyProps: {
        title: param('string', 'Task title, 3-500 characters.'),
        description: param('string', 'Optional details in markdown.'),
        priority: param('string', 'Optional: low, normal (default), high, or urgent.'),
        due_date: param('string', 'Optional due date as YYYY-MM-DD. Work it out from today\'s date when the user says "Friday" or "next week".'),
        assigned_to: param('integer', 'Optional member id from intranet_list_members.'),
        acting_user_id: ACTING_USER
      },
      bodyRequired: ['title']
    },
    {
      name: 'intranet_update_task',
      description: 'Update an intranet task by numeric id: mark it in_progress or completed, reprioritise, change the due date, reassign, or retitle. Send only the fields that change. Confirm with the user first.',
      method: 'PUT', url: `${V1}/tasks/{task_id}`,
      pathParams: { task_id: param('string', 'The numeric id of the task to update.') },
      bodyProps: {
        status: param('string', 'pending, in_progress, or completed.'),
        priority: param('string', 'low, normal, high, or urgent.'),
        due_date: param('string', 'New due date as YYYY-MM-DD.'),
        assigned_to: param('integer', 'Member id of the new assignee.'),
        title: param('string', 'New title, 3-500 characters.'),
        description: param('string', 'New description in markdown.'),
        acting_user_id: ACTING_USER
      }
    },
    {
      name: 'intranet_send_direct_message',
      description: 'Send an intranet direct message from the caller to another member. Find the recipient with intranet_list_members and pass their id. Read the exact message text back and get a clear yes before sending — it is delivered immediately and the recipient is notified (email if they are offline). Max 2000 characters.',
      method: 'POST', url: `${V1}/messages/send`,
      bodyProps: {
        recipient_id: param('integer', 'Member id of the recipient from intranet_list_members.'),
        content: param('string', 'The message text, 1-2000 characters, written in the caller\'s voice.'),
        acting_user_id: ACTING_USER
      },
      bodyRequired: ['recipient_id', 'content']
    },
    {
      name: 'intranet_list_conversations',
      description: 'List the caller\'s intranet direct-message threads, most recent first: who with, the last message, when, and how many are unread. Use it when the caller asks what messages they have on the intranet or who has written to them, then intranet_read_direct_messages to read a thread. Intranet only — text messages (SMS) are a different tool.',
      method: 'GET', url: `${V1}/messages/conversations`,
      query: {
        limit: param('integer', 'Optional. Threads to return, default 10, max 25.'),
        acting_user_id: ACTING_USER
      }
    },
    {
      name: 'intranet_read_direct_messages',
      description: 'Read the most recent intranet direct messages between the caller and one member, newest first (nothing is marked read). Find the member with intranet_list_members and pass their id. Use it whenever the caller asks what someone said or sent them on the intranet, or wants to review or reply to a message — then draft the reply with intranet_send_direct_message. Intranet only — text messages (SMS) are a different tool.',
      method: 'GET', url: `${V1}/messages/with/{member_id}`,
      pathParams: { member_id: param('string', 'The numeric member id from intranet_list_members.') },
      query: {
        limit: param('integer', 'Optional. Messages to return, default 10, max 50.'),
        acting_user_id: ACTING_USER
      }
    },
    {
      name: 'intranet_list_channels',
      description: 'List the intranet group chat channels the caller can post to — public channels (e.g. "general", "engineering") plus any private ones they belong to. Each entry has name, display_name, visibility, member_count and is_member. Use this to find a channel\'s exact name before reading or posting to it.',
      method: 'GET', url: `${V1}/group-chat/groups`,
      query: { acting_user_id: ACTING_USER }
    },
    {
      name: 'intranet_read_channel_messages',
      description: 'Read the most recent messages in an intranet group chat channel, newest first (nothing is marked read). channel is the channel\'s name or display name (case-insensitive, e.g. "engineering"), from intranet_list_channels. Use it when the caller asks what is happening in a channel, or before replying there with intranet_post_channel_message.',
      method: 'GET', url: `${V1}/group-chat/{channel}/messages`,
      pathParams: { channel: param('string', 'The channel\'s name or display name, e.g. "engineering".') },
      query: {
        limit: param('integer', 'Optional. Messages to return, default 20, max 50.'),
        acting_user_id: ACTING_USER
      }
    },
    {
      name: 'intranet_post_channel_message',
      description: 'Post a message to an intranet group chat channel as the caller. channel is the channel\'s name or display name from intranet_list_channels (e.g. "engineering"). content is 1-2000 characters of markdown. Posting to a public channel the caller has not joined adds them to it. Read the exact text back and get a clear yes before posting — everyone in the channel will see it.',
      method: 'POST', url: `${V1}/group-chat/{channel}/messages`,
      pathParams: { channel: param('string', 'The channel\'s name or display name, e.g. "engineering".') },
      bodyProps: {
        content: param('string', 'The message text, 1-2000 characters, written in the caller\'s voice.'),
        reply_to_id: param('integer', 'Optional. Id of the channel message being replied to, from intranet_read_channel_messages.'),
        acting_user_id: ACTING_USER
      },
      bodyRequired: ['content']
    }
  ];
  return defs.map(d => webhook(d, secretId));
}

const PROMPT = `You are ${AGENT_NAME}, the Intranet Project Manager — a friendly, professional virtual assistant for the ${COMPANY_NAME} team intranet. You help the team stay organized by reading and writing forum posts and their comments, managing the team task list, sending direct messages on the caller's behalf, and looking up people in the member directory. You speak in a warm, concise, conversational way suitable for a voice call: short sentences, no markdown read aloud, and you confirm before making any change.

Who you are talking to: {{user_name}}. If that is blank, you do not know who is calling — ask for their name before creating anything, and say that tasks and messages cannot be sent on their behalf until they call from the intranet app.

You have direct access to the ${COMPANY_NAME} intranet through webhook tools. Use them whenever a request involves posts, tasks, messages or members — never guess at content you can look up. Anything you create is attributed to the caller.

Your tools:
- intranet_list_posts — search and list forum posts (short summaries, paginated). Mention if there are more results.
- intranet_get_post — read one post in full by numeric id.
- intranet_create_post — publish a new forum post. Title 5 to 200 characters, body in markdown. Read the title and a short summary of the body back and get an explicit yes first.
- intranet_update_post — edit an existing post by numeric id. Send only the fields that change. There is no delete: if the user wants a post removed, set its title to "To be deleted" and say a human will remove it from the web interface.
- intranet_list_comments — read the comments on a post by numeric id, oldest first, with who wrote each one.
- intranet_add_comment — add a comment to a post as the caller, or reply to a specific comment by passing its id. Read the text back and only post after a clear yes.
- intranet_list_tasks — list or search the team task list. Open tasks first, then by due date. Use view=mine for the caller's own tasks.
- intranet_get_task — read one task with its description.
- intranet_create_task — create a task. Only a title is required. To assign it, find the person with intranet_list_members and pass their id; work out due dates as YYYY-MM-DD from today's date.
- intranet_update_task — mark a task in progress or completed, change its priority, due date, assignee, or title.
- intranet_send_direct_message — send an intranet direct message from the caller to a member. Find the recipient with intranet_list_members, read the exact text back, and only send after a clear yes.
- intranet_list_conversations — the caller's direct-message threads: who with, the last message, unread counts.
- intranet_read_direct_messages — the recent messages between the caller and one member, newest first. Nothing is marked read.
- intranet_list_members — search the member directory by name or email. Returns id, name, email, telephone and role.
- intranet_get_member — read one member's details by numeric id.
- intranet_list_channels — list group chat channels the caller can post to (public ones, plus private ones they belong to).
- intranet_read_channel_messages — recent messages in a channel, newest first. Nothing is marked read.
- intranet_post_channel_message — post a message to a channel as the caller. Everyone in the channel sees it, so read the text back and get a clear yes first.

How to work:
1. When asked what is on the intranet, what is new, or to find something, use intranet_list_posts (with a search term if you have one), then read the most relevant titles back. Offer to read any one in full. If they ask what people said about it, use intranet_list_comments and summarize the discussion, naming who said what.
2. When asked about tasks, to-dos, or what is pending, use intranet_list_tasks and summarize: how many are open, what is due soonest, who owns what. Offer to create, assign, or complete tasks.
3. When asked to post, comment, create a task, or message someone, draft it, read it back, and only call the tool after the user confirms. Never send a message, post a comment, or create a task twice.
4. When asked about a person, use intranet_list_members, then intranet_get_member for full details. Contact details are sensitive — share them only with the person who asked and who is entitled to them.
5. If a tool returns an error, tell the user plainly what failed and offer to try again — do not invent a result. If several tools fail in a row with an access error, say the intranet connection needs attention and suggest they tell an intranet administrator.
6. When asked what someone wrote, what messages they have, or to reply to someone, use intranet_list_conversations or intranet_read_direct_messages (find the member first with intranet_list_members), read the relevant messages back briefly, then draft the reply and confirm before intranet_send_direct_message. Direct messages and SMS are different channels — do not read text messages when asked about intranet messages.
7. When asked what is happening in a channel (e.g. "what's new in engineering") or to post something there, use intranet_list_channels if you do not already know the exact channel name, then intranet_read_channel_messages to see recent activity. Draft any message, read it back, and only call intranet_post_channel_message after a clear yes — it is visible to everyone in the channel, unlike a direct message. Group chat channels, direct messages, and SMS are three different channels — keep them separate.

You cannot delete posts or tasks, manage attachments, or access Google Drive — if asked, explain that those are not available yet.`;

const DYNAMIC_VARIABLE_PLACEHOLDERS = { user_id: '', intranet_user_id: '', user_name: '', user_role: '' };

async function main() {
  // 1. Secret the tools authenticate with.
  const { secrets } = await el('GET', '/secrets');
  let secret = secrets.find(s => s.name === SECRET_NAME);
  if (NEW_INTRANET_KEY) {
    if (secret) {
      console.log(`${DRY_RUN ? '[dry-run] would update' : 'Updating'} secret ${SECRET_NAME} (${secret.secret_id})`);
      if (!DRY_RUN) await el('PATCH', `/secrets/${secret.secret_id}`, { type: 'update', name: SECRET_NAME, value: NEW_INTRANET_KEY });
    } else {
      console.log(`${DRY_RUN ? '[dry-run] would create' : 'Creating'} secret ${SECRET_NAME}`);
      if (!DRY_RUN) secret = await el('POST', '/secrets', { type: 'new', name: SECRET_NAME, value: NEW_INTRANET_KEY });
    }
  }
  if (!secret) {
    throw new Error(`ElevenLabs secret ${SECRET_NAME} not found — set VOICE_AGENT_INTRANET_API_KEY to create it`);
  }

  // 2. Upsert tools by name.
  const { tools: existing } = await el('GET', '/tools');
  const byName = new Map(existing.map(t => [t.tool_config.name, t]));
  const toolIds = [];
  for (const cfg of toolDefinitions(secret.secret_id)) {
    const current = byName.get(cfg.name);
    if (current) {
      console.log(`${DRY_RUN ? '[dry-run] would update' : 'Updating'} tool ${cfg.name} (${current.id})`);
      if (!DRY_RUN) await el('PATCH', `/tools/${current.id}`, { tool_config: cfg });
      toolIds.push(current.id);
    } else {
      console.log(`${DRY_RUN ? '[dry-run] would create' : 'Creating'} tool ${cfg.name}`);
      if (!DRY_RUN) {
        const created = await el('POST', '/tools', { tool_config: cfg });
        toolIds.push(created.id);
      }
    }
  }

  // 3. Agent: keep any non-intranet tools it already has (e.g. self_awareness),
  //    replace the prompt, and give the dynamic variables empty defaults so
  //    non-app sessions (no user_id) still start.
  const agent = await el('GET', `/agents/${AGENT_ID}`);
  const prompt = agent.conversation_config.agent.prompt;
  const intranetNames = new Set(toolDefinitions(secret.secret_id).map(t => t.name));
  const keepIds = (prompt.tool_ids || []).filter(id => {
    const t = existing.find(x => x.id === id);
    return t && !intranetNames.has(t.tool_config.name);
  });
  const finalToolIds = [...new Set([...keepIds, ...toolIds])];
  const patch = {
    conversation_config: {
      agent: {
        prompt: { tool_ids: finalToolIds, prompt: PROMPT },
        dynamic_variables: { dynamic_variable_placeholders: DYNAMIC_VARIABLE_PLACEHOLDERS }
      }
    }
  };
  console.log(`${DRY_RUN ? '[dry-run] would patch' : 'Patching'} agent ${AGENT_ID} (${agent.name}): ${finalToolIds.length} tools, prompt ${PROMPT.length} chars`);
  if (!DRY_RUN) await el('PATCH', `/agents/${AGENT_ID}`, patch);

  console.log(DRY_RUN ? 'Dry run complete.' : 'Sync complete.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
