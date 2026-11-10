/**
 * Member activity over a time window — read-only (GET /api/v1/activity).
 *
 * Built for stand-up / daily-brief integrations: an agent or report can say
 * what each person did since the last meeting, including people who don't
 * commit to GitHub and only show up through their intranet work. The existing
 * endpoints can't answer "what did these members do between A and B" (no
 * author or date filters, 25–50 rows max), so this does it in one call.
 *
 * Privacy rules, enforced here so no caller can get more:
 *   - Public forum posts, comments on them, and public-channel messages come
 *     back with a short excerpt, so a summary can say what they were about.
 *   - Restricted posts (visibility other than all_members), comments on them,
 *     and private-channel messages are COUNTS only.
 *   - Direct messages and emails are COUNTS only, never content or recipients.
 * AI agent accounts (users.account_type = 'ai_agent') are never reported.
 * Email counts come from smtp_sent_log (all SMTP sends), see
 * countSentEmails.
 */

const MAX_MEMBERS = 20;
const MAX_WINDOW_DAYS = 14;
const MAX_ITEMS = 50; // per list, per member
const EXCERPT_CHARS = 300;

class ActivityQueryError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Validate ?since=&until=&member_ids= → { since, until, memberIds }. Throws ActivityQueryError. */
function parseActivityQuery(query = {}) {
  const since = new Date(query.since);
  if (!query.since || isNaN(since)) {
    throw new ActivityQueryError('since is required (ISO 8601 date-time)');
  }
  const until = query.until ? new Date(query.until) : new Date();
  if (isNaN(until)) throw new ActivityQueryError('until must be an ISO 8601 date-time');
  if (until <= since) throw new ActivityQueryError('until must be after since');
  if (until - since > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    throw new ActivityQueryError(`the window can be at most ${MAX_WINDOW_DAYS} days`);
  }
  const memberIds = [...new Set(
    String(query.member_ids || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0)
  )];
  if (!memberIds.length) throw new ActivityQueryError('member_ids is required (comma-separated member ids)');
  if (memberIds.length > MAX_MEMBERS) throw new ActivityQueryError(`at most ${MAX_MEMBERS} member_ids`);
  return { since, until, memberIds };
}

const excerpt = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);

/**
 * Emails sent per mailbox address in the window → Map(address → count).
 *
 * Source: smtp_sent_log, every authenticated send through Postfix
 * from webmail, phones and desktop clients alike, keyed by the SASL login. A
 * mailbox's login is its server_username, normally the address itself, so both
 * are matched. Webmail sends are in there too, so sent_emails is NOT added on
 * top (that would double-count). Until add_smtp_sent_log.sql is applied on an
 * instance, falls back to sent_emails (webmail and scheduled sends only).
 */
async function countSentEmails(db, mailboxRows, window) {
  const counts = new Map();
  if (!mailboxRows.length) return counts;
  const addressOf = new Map();
  for (const r of mailboxRows) {
    if (r.address) addressOf.set(r.address, r.address);
    if (r.login) addressOf.set(r.login, r.address);
  }
  const keys = [...addressOf.keys()];
  let rows;
  try {
    [rows] = await db.query(
      `SELECT sender AS sender, COUNT(*) AS sent
         FROM smtp_sent_log
        WHERE sender IN (?) AND sent_at >= ? AND sent_at < ?
        GROUP BY sender`,
      [keys, ...window]
    );
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
    [rows] = await db.query(
      `SELECT LOWER(sender) AS sender, COUNT(*) AS sent
         FROM sent_emails
        WHERE LOWER(sender) IN (?) AND sent_at >= ? AND sent_at < ?
        GROUP BY LOWER(sender)`,
      [keys, ...window]
    );
  }
  for (const r of rows) {
    const address = addressOf.get(String(r.sender).toLowerCase());
    if (address) counts.set(address, (counts.get(address) || 0) + Number(r.sent));
  }
  return counts;
}
const byMember = (rows, key = 'member_id') => {
  const map = new Map();
  for (const r of rows) {
    const id = Number(r[key]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(r);
  }
  return (id) => map.get(id) || [];
};

/**
 * Everything the members did in [since, until). `db` is a mysql2 pool (uses
 * db.query so `IN (?)` expands arrays). Returns { since, until, members, skipped }.
 */
async function loadMemberActivity(db, { since, until, memberIds, baseUrl = '' }) {
  const [users] = await db.query(
    'SELECT id, name, account_type FROM users WHERE id IN (?)',
    [memberIds]
  );
  const usersById = new Map(users.map(u => [Number(u.id), u]));
  const skipped = [];
  const ids = [];
  for (const id of memberIds) {
    const u = usersById.get(id);
    if (!u) skipped.push({ id, reason: 'not_found' });
    else if (u.account_type === 'ai_agent') skipped.push({ id, reason: 'ai_agent' });
    else ids.push(id);
  }
  if (!ids.length) return { since, until, members: [], skipped };

  const w = [since, until];

  const [posts] = await db.query(
    `SELECT p.user_id AS member_id, p.id, p.title, p.slug, p.content, p.visibility, p.created_at
       FROM posts p
      WHERE p.user_id IN (?) AND p.created_at >= ? AND p.created_at < ?
      ORDER BY p.created_at, p.id`,
    [ids, ...w]
  );

  const [comments] = await db.query(
    `SELECT c.user_id AS member_id, c.post_id, c.content, c.created_at,
            p.title AS post_title, p.visibility AS post_visibility
       FROM comments c JOIN posts p ON p.id = c.post_id
      WHERE c.user_id IN (?) AND c.created_at >= ? AND c.created_at < ?
      ORDER BY c.created_at, c.id`,
    [ids, ...w]
  );

  const [chat] = await db.query(
    `SELECT gm.sender_id AS member_id, gm.content, gm.created_at,
            g.display_name AS channel, g.visibility
       FROM group_messages gm JOIN \`groups\` g ON g.id = gm.group_id
      WHERE gm.sender_id IN (?) AND gm.is_deleted = 0
        AND gm.created_at >= ? AND gm.created_at < ?
      ORDER BY gm.created_at, gm.id`,
    [ids, ...w]
  );

  const [tasksCreated] = await db.query(
    `SELECT created_by AS member_id, id, title, status
       FROM tasks
      WHERE created_by IN (?) AND created_at >= ? AND created_at < ?
      ORDER BY created_at, id`,
    [ids, ...w]
  );
  // tasks has no completed_at: "completed in the window" = status completed and
  // last updated in the window, credited to the assignee (or the creator when
  // unassigned).
  const [tasksCompleted] = await db.query(
    `SELECT COALESCE(assigned_to, created_by) AS member_id, id, title
       FROM tasks
      WHERE status = 'completed' AND COALESCE(assigned_to, created_by) IN (?)
        AND updated_at >= ? AND updated_at < ?
      ORDER BY updated_at, id`,
    [ids, ...w]
  );

  const [dms] = await db.query(
    `SELECT sender_id AS member_id, COUNT(*) AS sent, COUNT(DISTINCT recipient_id) AS recipients
       FROM direct_messages
      WHERE sender_id IN (?) AND deleted_at IS NULL
        AND created_at >= ? AND created_at < ?
      GROUP BY sender_id`,
    [ids, ...w]
  );

  // Emails: every message a member sent from their own company mailbox(es).
  const [mailboxRows] = await db.query(
    `SELECT linked_user_id AS member_id, LOWER(email_address) AS address, LOWER(server_username) AS login
       FROM server_email_accounts
      WHERE linked_user_id IN (?)`,
    [ids]
  );
  const mailboxes = mailboxRows.map(r => ({ member_id: r.member_id, address: r.address }));
  const mailboxesOf = byMember(mailboxes);
  const sentByAddress = await countSentEmails(db, mailboxRows, w);

  const postsOf = byMember(posts);
  const commentsOf = byMember(comments);
  const chatOf = byMember(chat);
  const createdOf = byMember(tasksCreated);
  const completedOf = byMember(tasksCompleted);
  const dmOf = byMember(dms);
  const postUrl = (p) => `${baseUrl}/forum/post/${p.slug || p.id}`;

  const members = ids.map((id) => {
    const memberPosts = postsOf(id);
    const publicPosts = memberPosts.filter(p => p.visibility === 'all_members');
    const memberComments = commentsOf(id);
    const publicComments = memberComments.filter(c => c.post_visibility === 'all_members');
    const memberChat = chatOf(id);
    const publicChat = memberChat.filter(m => m.visibility === 'public');
    const dm = dmOf(id)[0];
    const addresses = mailboxesOf(id).map(m => m.address);

    return {
      member: { id, name: usersById.get(id).name },
      posts: {
        public_count: publicPosts.length,
        private_count: memberPosts.length - publicPosts.length,
        public: publicPosts.slice(0, MAX_ITEMS).map(p => ({
          id: p.id, title: p.title, excerpt: excerpt(p.content), url: postUrl(p), created_at: p.created_at,
        })),
      },
      comments: {
        public_count: publicComments.length,
        private_count: memberComments.length - publicComments.length,
        public: publicComments.slice(0, MAX_ITEMS).map(c => ({
          post_id: c.post_id, post_title: c.post_title, excerpt: excerpt(c.content), created_at: c.created_at,
        })),
      },
      channel_messages: {
        public_count: publicChat.length,
        private_count: memberChat.length - publicChat.length,
        public: publicChat.slice(0, MAX_ITEMS).map(m => ({
          channel: m.channel, excerpt: excerpt(m.content), created_at: m.created_at,
        })),
      },
      tasks: {
        created: createdOf(id).slice(0, MAX_ITEMS).map(t => ({ id: t.id, title: t.title, status: t.status })),
        completed: completedOf(id).slice(0, MAX_ITEMS).map(t => ({ id: t.id, title: t.title })),
      },
      direct_messages: {
        sent: dm ? Number(dm.sent) : 0,
        recipients: dm ? Number(dm.recipients) : 0,
      },
      emails: {
        sent: addresses.reduce((n, a) => n + (sentByAddress.get(a) || 0), 0),
        mailboxes: addresses,
      },
    };
  });

  return { since, until, members, skipped };
}

module.exports = {
  MAX_MEMBERS,
  MAX_WINDOW_DAYS,
  ActivityQueryError,
  parseActivityQuery,
  loadMemberActivity,
};
