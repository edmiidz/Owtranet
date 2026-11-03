/**
 * Intranet AI agents.
 *
 * An AI agent is a `users` row with account_type = 'ai_agent' plus an
 * `ai_agents` row holding its profile metadata (handle, optional ElevenLabs
 * voice agent, optional Claude Code skill). Being a real user means an agent can
 * author comments, be @mentioned, and has a profile page like anyone else. New
 * agents get role = 'system', which keeps them out of member directories,
 * assignee pickers and payroll lists; they have a random password and cannot
 * log in.
 *
 * Tagging an agent (@assistant) in a forum post or comment brings it into the
 * thread: the responder reads the post and the discussion, asks Claude for a
 * reply in the agent's persona, and posts it as a threaded comment by the agent.
 *
 * AGENT_CATALOG is the source of truth; server/scripts/seedAiAgents.js upserts
 * it into the database (run on each instance after add_ai_agents.sql). Edit the
 * catalog (and personaFor) to add your own agents.
 */
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const AGENT_MODEL = process.env.AGENT_REPLY_MODEL || 'claude-opus-5';
// Spend guards: per agent per post, and across all agents on the instance.
const PER_POST_HOURLY_LIMIT = parseInt(process.env.AGENT_REPLIES_PER_POST_PER_HOUR || '6', 10);
const GLOBAL_HOURLY_LIMIT = parseInt(process.env.AGENT_REPLIES_PER_HOUR || '40', 10);
const MAX_POST_CHARS = 12000;
const MAX_COMMENT_CHARS = 2500;
const MAX_THREAD_COMMENTS = 40;
// Direct messages (DM an agent from its profile): per sender per agent,
// sharing the instance-wide cap above.
const DM_PER_SENDER_HOURLY_LIMIT = parseInt(process.env.AGENT_DM_REPLIES_PER_SENDER_PER_HOUR || '20', 10);
const MAX_DM_HISTORY = 30;
const MAX_DM_CHARS = 2000;
// Group chat channels: per agent per channel, sharing the instance-wide cap above.
const GROUP_PER_CHANNEL_HOURLY_LIMIT = parseInt(process.env.AGENT_GROUP_REPLIES_PER_CHANNEL_PER_HOUR || '6', 10);
const MAX_GROUP_HISTORY = 30;
const MAX_GROUP_CHARS = 2000;

const COMPANY_NAME = process.env.COMPANY_NAME || 'Owtranet';
const COMPANY_CONTEXT = `You work at ${COMPANY_NAME} and are part of its internal team intranet, where colleagues discuss work in forum threads, direct messages and group chat channels.`;

const VOICE_AGENT_NAME = process.env.ELEVENLABS_AGENT_NAME || 'Assistant';
const VOICE_AGENT_HANDLE = VOICE_AGENT_NAME.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'voice';

const AGENT_CATALOG = [
  {
    handle: 'assistant',
    name: 'Assistant',
    kind: 'role',
    tagline: 'a helpful AI teammate you can tag in any thread',
    elevenlabs_agent_id: null,
    skill_command: null,
    skill_url: null,
    description: `A general-purpose AI teammate for ${COMPANY_NAME}. Tag @assistant in a forum post, comment or group chat, or send it a direct message, to get a summary, a second opinion or suggested next steps.`
  },
  // The mobile app's "Call AI" voice agent, when ElevenLabs is configured.
  ...(process.env.ELEVENLABS_AGENT_ID && VOICE_AGENT_HANDLE !== 'assistant' ? [{
    handle: VOICE_AGENT_HANDLE,
    name: VOICE_AGENT_NAME,
    kind: 'voice',
    tagline: 'the voice agent in the mobile app',
    elevenlabs_agent_id: process.env.ELEVENLABS_AGENT_ID,
    skill_command: null,
    skill_url: null,
    description: `Voice agent, available from the mobile app (Call AI). Reads and writes forum posts and comments, manages the task list, sends direct messages and looks people up in the member directory. Tag @${VOICE_AGENT_HANDLE} in a thread to bring ${VOICE_AGENT_NAME} in.`
  }] : [])
];

const INTRANET_FRAMING = `You are replying inside a thread on the company intranet forum (a Stack Overflow-style board) because a colleague tagged you with an @mention. Write the body of your reply comment only, in GitHub-flavoured markdown (short paragraphs, "-" bullets and numbered lists are fine; no headings, no sign-off, no subject line). Answer the person who tagged you, addressing them by first name, and use the post and the discussion so far as context. Keep it under about 250 words unless the question genuinely needs more. Never invent facts, metrics, incidents or commitments on behalf of others; if you do not know, say what would answer it. Do not @mention anyone (write names without the @ sign) — mentions notify people and summon agents. You are an AI agent and the thread shows that; do not pretend otherwise.`;

function personaFor(agent) {
  if (agent.kind === 'voice') {
    return `${COMPANY_CONTEXT}

You are ${agent.name}, the intranet's project-management assistant. On voice calls from the mobile app you read and write forum posts and comments, manage the team task list, send direct messages on the caller's behalf and look people up in the member directory. Here you are answering in writing. Your angle is project management: turn the discussion into clear next steps, owners and open questions, point out what should become a task, and summarise long threads crisply. You cannot create tasks or send messages from a written reply — suggest what to create and let the person confirm, or tell them to call you from the app. Warm, concise, practical.`;
  }
  return `${COMPANY_CONTEXT}

You are ${agent.name || 'Assistant'}, a helpful AI teammate. Answer questions clearly, summarise long discussions, offer a considered second opinion, and suggest concrete next steps with owners where that helps. Be honest about uncertainty and never speak for colleagues. Friendly, concise, practical.`;
}

const DM_FRAMING = `You are replying to a direct message on the company intranet — a private one-to-one chat between you and a colleague who opened it from your profile. Write the body of your reply only, in GitHub-flavoured markdown suitable for a chat bubble (short paragraphs, "-" bullets are fine; no headings, no sign-off, no subject line). Keep it conversational and brief — usually under about 150 words — unless the question genuinely needs more. Use the earlier messages as context and answer the latest one. Never invent facts, metrics, incidents or commitments on behalf of others; if you do not know, say what would answer it. Do not @mention anyone (write names without the @ sign). You are an AI agent and the chat shows that; do not pretend otherwise.`;

const GROUP_FRAMING = `You are replying in a group chat channel on the company intranet because a colleague tagged you with an @mention. This is a multi-person channel, not a private DM — other members can see your reply and may already be discussing the topic. Write the body of your reply only, in GitHub-flavoured markdown suitable for a chat bubble (short paragraphs, "-" bullets are fine; no headings, no sign-off, no subject line). Keep it conversational and brief — usually under about 150 words — unless the question genuinely needs more. Use the recent channel history as context and answer the message that tagged you, addressing the person by first name. Never invent facts, metrics, incidents or commitments on behalf of others; if you do not know, say what would answer it. Do not @mention anyone (write names without the @ sign) — mentions notify people and summon agents. You are an AI agent and the channel shows that; do not pretend otherwise.`;

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic(); // ANTHROPIC_API_KEY from env
  return _client;
}

const clip = (text, max) => {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, max)}\n[…truncated]` : s;
};
const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';

/**
 * Ask Claude for the agent's reply. `ctx` = { post, comments, trigger } where
 * comments are the thread oldest-first and trigger is the post/comment that
 * tagged the agent. Returns markdown text; throws on refusal or empty output.
 */
async function composeAgentReply(agent, ctx) {
  const { post, comments, trigger } = ctx;
  const thread = comments.slice(-MAX_THREAD_COMMENTS).map(c => {
    const who = c.author_account_type === 'ai_agent' ? `${c.author_name} (AI agent)` : c.author_name;
    const marker = trigger.type === 'comment' && c.id === trigger.id ? '  ← THIS COMMENT TAGGED YOU' : '';
    return `--- Comment #${c.id} by ${who}, ${new Date(c.created_at).toISOString().slice(0, 16).replace('T', ' ')}${c.parent_id ? ` (reply to #${c.parent_id})` : ''}${marker}\n${clip(c.content, MAX_COMMENT_CHARS)}`;
  }).join('\n\n');

  const userMsg = `Forum post: "${post.title}" by ${post.author_name}${trigger.type === 'post' ? '  ← THIS POST TAGGED YOU' : ''}
"""
${clip(post.content, MAX_POST_CHARS)}
"""

${thread ? `Discussion so far (oldest first):\n\n${thread}` : 'No comments yet.'}

You were tagged by ${trigger.author_name} (first name: ${firstName(trigger.author_name)}). Write your reply to them now.`;

  return callClaude(`${personaFor(agent)}\n\n${INTRANET_FRAMING}`, userMsg);
}

// Server-side refusal fallback: a declined request is re-run on a fallback
// model chosen by refusal category, inside the same call. Any @ is stripped so
// an agent reply never mentions or summons.
async function callClaude(system, userMsg) {
  const response = await getClient().beta.messages.create({
    model: AGENT_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: userMsg }]
  });
  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined (${response.stop_details?.category || 'unknown'})`);
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error(`Empty reply (stop_reason ${response.stop_reason})`);
  return { text: text.replace(/(^|[^\w.])@(\w)/g, '$1$2'), model: response.model || AGENT_MODEL };
}

/**
 * The agent's reply in a DM. `history` = the conversation oldest-first as
 * { sender_id, sender_name, content, created_at }; the last entry is the
 * message being answered.
 */
async function composeAgentDmReply(agent, { history, senderName }) {
  const transcript = history.slice(-MAX_DM_HISTORY).map(m => {
    const who = m.sender_id === agent.user_id ? `${agent.name} (you)` : m.sender_name;
    return `--- ${who}, ${new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ')}\n${clip(m.content, MAX_DM_CHARS)}`;
  }).join('\n\n');
  const userMsg = `Direct message conversation with ${senderName} (first name: ${firstName(senderName)}), oldest first:

${transcript}

Reply to ${firstName(senderName) || 'them'}'s latest message now.`;
  return callClaude(`${personaFor(agent)}\n\n${DM_FRAMING}`, userMsg);
}

/**
 * The agent's reply in a group chat channel. `history` = recent channel
 * messages oldest-first as { sender_id, sender_name, content, created_at };
 * the last entry is the message that tagged the agent. `groupName` is the
 * channel's display name, for framing only.
 */
async function composeAgentGroupReply(agent, { history, groupName, triggerAuthorName }) {
  const transcript = history.slice(-MAX_GROUP_HISTORY).map(m => {
    const who = m.sender_id === agent.user_id ? `${agent.name} (you)` : m.sender_name;
    return `--- ${who}, ${new Date(m.created_at).toISOString().slice(0, 16).replace('T', ' ')}\n${clip(m.content, MAX_GROUP_CHARS)}`;
  }).join('\n\n');
  const userMsg = `Channel: #${groupName}

Recent messages, oldest first:

${transcript}

You were tagged by ${triggerAuthorName} (first name: ${firstName(triggerAuthorName)}). Write your reply to them now.`;
  return callClaude(`${personaFor(agent)}\n\n${GROUP_FRAMING}`, userMsg);
}

// @handle tokens, ignoring e-mail addresses (name@domain) and repeats.
function extractMentionTokens(content) {
  const tokens = new Set();
  for (const m of String(content || '').matchAll(/(?<![\w.])@(\w+)/g)) tokens.add(m[1].toLowerCase());
  return [...tokens];
}

/**
 * Wire the responder to the app. `getDb()` returns server.js's pool (assigned
 * at startup, so read lazily). `createComment(postId, user, content, parentId,
 * opts)` is server.js's comment helper; replies pass { fromAgent: true } so an
 * agent's own reply can never summon another agent (no loops).
 */
function createAgentResponder({ getDb, createComment, sendDirectMessage, postGroupMessage }) {
  const db = {
    execute: (...args) => getDb().execute(...args),
    query: (...args) => getDb().query(...args)
  };
  async function findTaggedAgents(content) {
    const tokens = extractMentionTokens(content);
    if (tokens.length === 0) return [];
    const [rows] = await db.query(
      `SELECT a.user_id, a.handle, u.name, u.github_username, u.intranet_username, u.role
         FROM ai_agents a JOIN users u ON u.id = a.user_id
        WHERE a.responds_to_mentions = 1 AND u.account_type = 'ai_agent' AND a.handle IN (?)`,
      [tokens]
    );
    return rows;
  }

  async function runReply(replyId, agent, source) {
    try {
      const [[post]] = await db.execute(
        `SELECT p.id, p.title, p.content, p.slug, u.name AS author_name
           FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
        [source.postId]
      );
      if (!post) throw new Error('Post no longer exists');
      const [comments] = await db.execute(
        `SELECT c.id, c.parent_id, c.content, c.created_at, u.name AS author_name, u.account_type AS author_account_type
           FROM comments c JOIN users u ON u.id = c.user_id
          WHERE c.post_id = ? ORDER BY c.created_at ASC, c.id ASC`,
        [source.postId]
      );

      // JWT payloads carry no display name; look it up.
      let authorName = source.author.name;
      if (!authorName && source.author.userId) {
        const [[row]] = await db.execute('SELECT name FROM users WHERE id = ?', [source.author.userId]);
        authorName = row?.name;
      }

      const { text, model } = await composeAgentReply(agent, {
        post,
        comments,
        trigger: { type: source.type, id: source.id, author_name: authorName || 'a colleague' }
      });

      const agentUser = {
        userId: agent.user_id,
        name: agent.name,
        github_username: agent.github_username,
        intranet_username: agent.intranet_username,
        role: agent.role
      };
      // Thread the answer under the comment that tagged the agent.
      const { commentId } = await createComment(
        source.postId, agentUser, text,
        source.type === 'comment' ? source.id : null,
        { fromAgent: true }
      );
      await db.execute(
        `UPDATE ai_agent_replies SET status = 'replied', reply_comment_id = ?, model = ?, completed_at = NOW() WHERE id = ?`,
        [commentId, model, replyId]
      );

      // Tell the person who tagged the agent (the post author already gets
      // createComment's "new comment" notification).
      if (source.author.userId && source.author.userId !== source.postAuthorId) {
        await db.execute(
          'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
          [
            source.author.userId,
            'new_comment',
            `${agent.name} replied`,
            `${agent.name} (AI agent) answered you on "${post.title}"`,
            JSON.stringify({ postId: post.id, commentId, slug: post.slug })
          ]
        );
      }
      console.log(`[ai-agents] ${agent.handle} replied on post ${post.id} (comment ${commentId})`);
    } catch (err) {
      console.error(`[ai-agents] ${agent.handle} reply ${replyId} failed:`, err.message);
      await db.execute(
        `UPDATE ai_agent_replies SET status = 'failed', error = ?, completed_at = NOW() WHERE id = ?`,
        [String(err.message).slice(0, 500), replyId]
      ).catch(() => {});
    }
  }

  /**
   * Called after a post or comment is saved. `source` = { type: 'post'|'comment',
   * id, postId, postAuthorId, content, author: { userId, name } }. Queues one
   * reply per tagged agent (at most once per source, rate limited) and returns
   * the agents brought in so the client can say so and poll for the replies.
   */
  async function handleMentions(source) {
    let agents;
    try {
      agents = await findTaggedAgents(source.content);
    } catch (err) {
      console.error('[ai-agents] mention lookup failed:', err.message);
      return [];
    }
    const summoned = [];
    for (const agent of agents) {
      if (agent.user_id === source.author.userId) continue; // no self-summoning
      try {
        const [[{ perPost }]] = await db.execute(
          `SELECT COUNT(*) AS perPost FROM ai_agent_replies
            WHERE agent_user_id = ? AND post_id = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
          [agent.user_id, source.postId]
        );
        const [[{ total }]] = await db.execute(
          `SELECT COUNT(*) AS total FROM ai_agent_replies WHERE created_at > NOW() - INTERVAL 1 HOUR`
        );
        const limited = perPost >= PER_POST_HOURLY_LIMIT || total >= GLOBAL_HOURLY_LIMIT;

        // UNIQUE (agent_user_id, source_type, source_id): an edit that keeps
        // the tag, or a retried request, never produces a second reply.
        const [result] = await db.execute(
          `INSERT IGNORE INTO ai_agent_replies (agent_user_id, source_type, source_id, post_id, requested_by, status)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [agent.user_id, source.type, source.id, source.postId, source.author.userId || null, limited ? 'rate_limited' : 'pending']
        );
        if (result.affectedRows === 0) continue;
        if (limited) {
          console.warn(`[ai-agents] ${agent.handle} rate limited on post ${source.postId}`);
          continue;
        }
        summoned.push({ handle: agent.handle, name: agent.name });
        setImmediate(() => runReply(result.insertId, agent, source));
      } catch (err) {
        console.error(`[ai-agents] could not queue ${agent.handle}:`, err.message);
      }
    }
    return summoned;
  }

  /**
   * Called after a DM is saved. `dm` = { messageId, conversationId, senderId,
   * recipientId }. If the recipient is an agent (and the sender is a person),
   * queue the agent's reply, which arrives as an ordinary DM from the agent.
   * Returns true when a reply is on its way, so the client can show "typing".
   */
  async function handleDirectMessage(dm) {
    let agent, sender;
    try {
      const [[row]] = await db.execute(
        `SELECT a.user_id, a.handle, u.name, u.github_username, u.intranet_username, u.role
           FROM ai_agents a JOIN users u ON u.id = a.user_id
          WHERE a.user_id = ? AND a.responds_to_mentions = 1 AND u.account_type = 'ai_agent'`,
        [dm.recipientId]
      );
      if (!row) return false;
      agent = row;
      [[sender]] = await db.execute('SELECT id, name, account_type FROM users WHERE id = ?', [dm.senderId]);
      // Agents never answer agents (or themselves): no loops.
      if (!sender || sender.account_type === 'ai_agent') return false;

      const [[{ perSender }]] = await db.execute(
        `SELECT COUNT(*) AS perSender FROM ai_agent_replies
          WHERE agent_user_id = ? AND source_type = 'direct_message' AND requested_by = ? AND created_at > NOW() - INTERVAL 1 HOUR`,
        [agent.user_id, sender.id]
      );
      const [[{ total }]] = await db.execute(
        `SELECT COUNT(*) AS total FROM ai_agent_replies WHERE created_at > NOW() - INTERVAL 1 HOUR`
      );
      const limited = perSender >= DM_PER_SENDER_HOURLY_LIMIT || total >= GLOBAL_HOURLY_LIMIT;
      const [result] = await db.execute(
        `INSERT IGNORE INTO ai_agent_replies (agent_user_id, source_type, source_id, post_id, requested_by, status)
         VALUES (?, 'direct_message', ?, NULL, ?, ?)`,
        [agent.user_id, dm.messageId, sender.id, limited ? 'rate_limited' : 'pending']
      );
      if (result.affectedRows === 0) return false;
      if (limited) {
        console.warn(`[ai-agents] ${agent.handle} DM rate limited for user ${sender.id}`);
        await sendDirectMessage(agent.user_id, sender.id,
          `I've hit my hourly message limit, so I can't answer right now — try me again in a little while, or tag @${agent.handle} in a forum thread.`
        ).catch(() => {});
        return false;
      }
      setImmediate(() => runDmReply(result.insertId, agent, sender, dm));
      return true;
    } catch (err) {
      console.error('[ai-agents] could not queue DM reply:', err.message);
      return false;
    }
  }

  async function runDmReply(replyId, agent, sender, dm) {
    try {
      const [history] = await db.execute(
        `SELECT * FROM (
           SELECT dm.id, dm.sender_id, dm.content, dm.created_at, u.name AS sender_name
             FROM direct_messages dm JOIN users u ON u.id = dm.sender_id
            WHERE dm.conversation_id = ? AND dm.id <= ? AND dm.deleted_at IS NULL
            ORDER BY dm.id DESC LIMIT ${MAX_DM_HISTORY}
         ) t ORDER BY t.id ASC`,
        [dm.conversationId, dm.messageId]
      );
      const { text, model } = await composeAgentDmReply(agent, { history, senderName: sender.name });
      const { message } = await sendDirectMessage(agent.user_id, sender.id, text.slice(0, 2000));
      await db.execute(
        `UPDATE ai_agent_replies SET status = 'replied', reply_message_id = ?, model = ?, completed_at = NOW() WHERE id = ?`,
        [message.id, model, replyId]
      );
      console.log(`[ai-agents] ${agent.handle} answered DM ${dm.messageId} from user ${sender.id}`);
    } catch (err) {
      console.error(`[ai-agents] ${agent.handle} DM reply ${replyId} failed:`, err.message);
      await db.execute(
        `UPDATE ai_agent_replies SET status = 'failed', error = ?, completed_at = NOW() WHERE id = ?`,
        [String(err.message).slice(0, 500), replyId]
      ).catch(() => {});
    }
  }

  /**
   * Called after a group chat message is saved. `msg` = { messageId, groupId,
   * senderId, content }. Queues a reply for each tagged agent that is not the
   * sender, posted back into the channel by postGroupMessage. Returns the
   * agents brought in, same shape as handleMentions.
   */
  async function handleGroupMention(msg) {
    let agents;
    try {
      agents = await findTaggedAgents(msg.content);
    } catch (err) {
      console.error('[ai-agents] group mention lookup failed:', err.message);
      return [];
    }
    const summoned = [];
    for (const agent of agents) {
      if (agent.user_id === msg.senderId) continue; // no self-summoning
      try {
        // group_id is a column on ai_agent_replies (not joined through
        // source_id -> group_messages) so this stays correct — and indexed —
        // even if a tagging message is later deleted.
        const [[{ perChannel }]] = await db.execute(
          `SELECT COUNT(*) AS perChannel FROM ai_agent_replies
            WHERE agent_user_id = ? AND source_type = 'group_message' AND group_id = ?
              AND created_at > NOW() - INTERVAL 1 HOUR`,
          [agent.user_id, msg.groupId]
        );
        const [[{ total }]] = await db.execute(
          `SELECT COUNT(*) AS total FROM ai_agent_replies WHERE created_at > NOW() - INTERVAL 1 HOUR`
        );
        const limited = perChannel >= GROUP_PER_CHANNEL_HOURLY_LIMIT || total >= GLOBAL_HOURLY_LIMIT;

        // UNIQUE (agent_user_id, source_type, source_id): an edit that keeps
        // the tag, or a retried request, never produces a second reply.
        const [result] = await db.execute(
          `INSERT IGNORE INTO ai_agent_replies (agent_user_id, source_type, source_id, post_id, group_id, requested_by, status)
           VALUES (?, 'group_message', ?, NULL, ?, ?, ?)`,
          [agent.user_id, msg.messageId, msg.groupId, msg.senderId, limited ? 'rate_limited' : 'pending']
        );
        if (result.affectedRows === 0) continue;
        if (limited) {
          console.warn(`[ai-agents] ${agent.handle} rate limited in group ${msg.groupId}`);
          continue;
        }
        summoned.push({ handle: agent.handle, name: agent.name });
        setImmediate(() => runGroupReply(result.insertId, agent, msg));
      } catch (err) {
        console.error(`[ai-agents] could not queue ${agent.handle} for group ${msg.groupId}:`, err.message);
      }
    }
    return summoned;
  }

  async function runGroupReply(replyId, agent, msg) {
    try {
      const [[group]] = await db.execute('SELECT name FROM `groups` WHERE id = ?', [msg.groupId]);
      if (!group) throw new Error('Group no longer exists');

      const [history] = await db.execute(
        `SELECT * FROM (
           SELECT gm.id, gm.sender_id, gm.content, gm.created_at, u.name AS sender_name
             FROM group_messages gm JOIN users u ON u.id = gm.sender_id
            WHERE gm.group_id = ? AND gm.id <= ? AND gm.is_deleted = 0
            ORDER BY gm.id DESC LIMIT ${MAX_GROUP_HISTORY}
         ) t ORDER BY t.id ASC`,
        [msg.groupId, msg.messageId]
      );

      // JWT payloads carry no display name; look it up.
      let triggerAuthorName = history.find(h => h.id === msg.messageId)?.sender_name;
      if (!triggerAuthorName) {
        const [[row]] = await db.execute('SELECT name FROM users WHERE id = ?', [msg.senderId]);
        triggerAuthorName = row?.name || 'a colleague';
      }

      const { text, model } = await composeAgentGroupReply(agent, {
        history,
        groupName: group.name,
        triggerAuthorName
      });

      const { messageId: replyMessageId } = await postGroupMessage(msg.groupId, agent.user_id, text.slice(0, 2000), msg.messageId);
      await db.execute(
        `UPDATE ai_agent_replies SET status = 'replied', reply_group_message_id = ?, model = ?, completed_at = NOW() WHERE id = ?`,
        [replyMessageId, model, replyId]
      );
      console.log(`[ai-agents] ${agent.handle} replied in group ${msg.groupId} (message ${replyMessageId})`);
    } catch (err) {
      console.error(`[ai-agents] ${agent.handle} group reply ${replyId} failed:`, err.message);
      await db.execute(
        `UPDATE ai_agent_replies SET status = 'failed', error = ?, completed_at = NOW() WHERE id = ?`,
        [String(err.message).slice(0, 500), replyId]
      ).catch(() => {});
    }
  }

  return { handleMentions, handleDirectMessage, handleGroupMention };
}

// Random, unusable credential for agent accounts (they never log in).
function unusablePassword() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  AGENT_CATALOG,
  AGENT_MODEL,
  composeAgentDmReply,
  composeAgentGroupReply,
  composeAgentReply,
  createAgentResponder,
  extractMentionTokens,
  personaFor,
  unusablePassword
};
