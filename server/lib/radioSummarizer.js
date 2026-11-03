/**
 * Corporate Radio Station — post → TTS-ready segment.
 *
 * Turns a markdown intranet post into a short, spoken-word news segment that
 * the mobile app reads aloud with the device's own TTS engine (Siri / Android
 * TTS). No audio is generated server-side; we only produce text.
 *
 * Uses the Anthropic SDK (already a dependency). Model is configurable via
 * RADIO_MODEL (default claude-opus-5). Falls back to a deterministic
 * plain-text extraction when the API is unavailable so the feed never stalls.
 */
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = process.env.RADIO_MODEL || 'claude-opus-5';
const WORDS_PER_MINUTE = 160; // typical TTS pace, used for duration estimates
const MAX_SOURCE_CHARS = 24000;

let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic(); // ANTHROPIC_API_KEY from env
  return _client;
}

/**
 * Fingerprint of everything the segment was generated from: title, body AND
 * the replies (id + last edit + text), so a new/edited/deleted comment changes
 * the hash and the worker regenerates the segment.
 */
function contentHash(post, comments = []) {
  const h = crypto.createHash('sha1').update(`${post.title}\n${post.content}`);
  for (const c of comments) h.update(`\n--comment ${c.id}@${c.updated_at ? new Date(c.updated_at).toISOString() : ''}\n${c.content}`);
  return h.digest('hex');
}

/**
 * Replies to a post, oldest first, in the shape summarizePostForRadio expects.
 * Shared by the worker and the on-demand regenerate route so both see the
 * same discussion.
 */
async function loadComments(db, postId) {
  const [rows] = await db.execute(
    `SELECT c.id, c.parent_id, c.content, c.is_accepted, c.created_at, c.updated_at,
            u.name AS author_name, pu.name AS parent_author_name
     FROM comments c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN comments pc ON pc.id = c.parent_id
     LEFT JOIN users pu ON pu.id = pc.user_id
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC, c.id ASC`, [postId]);
  return rows;
}

/** Strip markdown / html / urls into something a TTS engine can read. */
function plainText(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' a link ')
    .replace(/[#>*_`~|]+/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;/g, m => ({ '&nbsp;': ' ', '&amp;': 'and', '&lt;': '<', '&gt;': '>', '&quot;': '"' }[m]))
    .replace(/\s+/g, ' ')
    .trim();
}

const SHARE_LINK_RE = /^\s*🔗\s*\[([^\]]*)\]\(([^)]+)\)\s*$/m;
const SHARED_FROM_RE = /^\s*_Shared from mobile_\s*$/m;

/** Human description of where a shared link points, for attribution on air. */
function describeLink(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|mobile)\./, '');
    if (host === 'x.com' || host === 'twitter.com') {
      const m = u.pathname.match(/^\/([A-Za-z0-9_]+)\/status\//);
      return m ? `a post on X by @${m[1]}` : 'a post on X';
    }
    if (/(^|\.)linkedin\.com$/.test(host)) return 'a LinkedIn post';
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return 'a YouTube video';
    if (/(^|\.)github\.com$/.test(host)) return 'a GitHub page';
    return `an article on ${host}`;
  } catch {
    return 'a link';
  }
}

/** Split markdown into the author's own lines and the blockquoted passages. */
function splitQuotes(md) {
  const own = [], quotes = [];
  let buf = [];
  const flush = () => { if (buf.length) { quotes.push(buf.join('\n')); buf = []; } };
  for (const line of String(md || '').split('\n')) {
    if (/^\s*>/.test(line)) buf.push(line.replace(/^\s*>\s?/, ''));
    else { flush(); own.push(line); }
  }
  flush();
  return { own: own.join('\n'), quotes };
}

/**
 * What in the post is the author's own voice versus someone else's. Posts made
 * with the mobile share sheet (and the Chrome post-creator extension) carry a
 * "🔗 [title](url)" line and often a blockquoted excerpt of the linked page;
 * the excerpt must be attributed to its source, not to the poster.
 */
function analyzePost(post) {
  const content = String(post.content || '');
  const linkMatch = content.match(SHARE_LINK_RE);
  const body = content.replace(SHARE_LINK_RE, '').replace(SHARED_FROM_RE, '');
  const { own, quotes } = splitQuotes(body);
  const link = linkMatch ? { title: linkMatch[1].trim(), url: linkMatch[2].trim(), source: describeLink(linkMatch[2].trim()) } : null;
  return {
    isShare: !!link || SHARED_FROM_RE.test(content),
    link,
    ownText: plainText(own),
    quotes: quotes.map(plainText).filter(Boolean)
  };
}

function wordCount(s) {
  return (String(s).trim().match(/\S+/g) || []).length;
}

function estimateSeconds(text) {
  return Math.max(5, Math.round(wordCount(text) / WORDS_PER_MINUTE * 60));
}

/** Deterministic fallback used when Claude is unavailable. */
function fallbackSegment(post, ctx) {
  const a = analyzePost(post);
  const body = a.quotes.length ? a.quotes.join(' ') : plainText(post.content);
  const firstChunk = body.split(/(?<=[.!?])\s+/).slice(0, 4).join(' ');
  let text = (a.link || a.quotes.length)
    ? `${ctx.authorName} shared ${a.link ? a.link.source : 'a quote'}, ${String(post.title).replace(/[.!?]+$/, '')}. ${a.ownText ? `${ctx.authorName} says: ${a.ownText} ` : ''}The shared text reads: ${firstChunk}`.slice(0, 900)
    : `${ctx.authorName} posted ${post.title}. ${firstChunk}`.slice(0, 900);
  const comments = ctx.comments || [];
  if (comments.length) {
    const last = comments[comments.length - 1];
    const reply = plainText(last.content).split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
    text += ` ${comments.length === 1 ? 'One reply' : `${comments.length} replies`} so far. ${last.author_name} replied: ${reply}`.slice(0, 700);
  }
  return {
    headline: post.title,
    tts_text: text,
    model: 'fallback',
    word_count: wordCount(text),
    est_duration_secs: estimateSeconds(text)
  };
}

function extractJson(text) {
  const t = String(text).trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : t;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in model output');
  return JSON.parse(candidate.slice(start, end + 1));
}

const MAX_REPLIES = 12;
const MAX_REPLY_CHARS = 1500;

/** Replies as a plain-text block for the prompt: newest are the most likely to matter, so when trimming keep the tail. */
function formatReplies(comments) {
  const kept = comments.length > MAX_REPLIES ? comments.slice(-MAX_REPLIES) : comments;
  const lines = kept.map((c, i) => {
    const when = new Date(c.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const to = c.parent_author_name ? `, replying to ${c.parent_author_name}` : '';
    const accepted = c.is_accepted ? ' [marked as the accepted answer]' : '';
    const body = plainText(c.content).slice(0, MAX_REPLY_CHARS);
    return `Reply ${i + 1} — ${c.author_name}, ${when}${to}${accepted}:\n${body || '(empty)'}`;
  });
  const omitted = comments.length - kept.length;
  return `\nReplies (oldest first${omitted ? `; ${omitted} earlier replies omitted` : ''}):\n"""\n${lines.join('\n\n')}\n"""\n`;
}

/**
 * @param {{id:number,title:string,content:string,created_at:Date|string}} post
 * @param {{authorName:string, companyName:string, tags?:string[], commentCount?:number, comments?:Array<{id:number,content:string,author_name:string,created_at:Date|string,updated_at?:Date|string,is_accepted?:number,parent_author_name?:string|null}>}} ctx
 * @param {{model?:string}} [opts]
 * @returns {Promise<{headline:string, tts_text:string, model:string, word_count:number, est_duration_secs:number}>}
 */
async function summarizePostForRadio(post, ctx, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const analysis = analyzePost(post);
  let source;
  if (analysis.link || analysis.quotes.length) {
    const parts = [];
    parts.push(analysis.ownText
      ? `${ctx.authorName}'s own words:\n"""\n${analysis.ownText}\n"""`
      : `${ctx.authorName} added no comment of their own; they only shared the item below.`);
    if (analysis.link) parts.push(`Shared link: "${analysis.link.title}" (${analysis.link.source})`);
    analysis.quotes.forEach((q, i) => parts.push(
      `Quoted passage ${i + 1} — NOT written by ${ctx.authorName}; these are the words of ${analysis.link ? analysis.link.source : 'another source'}:\n"""\n${q}\n"""`));
    source = parts.join('\n\n').slice(0, MAX_SOURCE_CHARS);
  } else {
    source = plainText(post.content).slice(0, MAX_SOURCE_CHARS);
  }
  const postedOn = new Date(post.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const comments = ctx.comments || [];
  const commentCount = comments.length || ctx.commentCount || 0;
  const repliesBlock = comments.length ? formatReplies(comments) : '';

  const prompt = `You write short spoken news segments for "${ctx.companyName} Radio", an internal audio news stream that team members listen to passively while driving or walking. Each segment is read aloud by a phone's built-in text-to-speech engine, so it must sound natural when spoken and contain nothing that reads badly aloud.

Turn the intranet post below into ONE broadcast segment.

Rules:
- Length: 60 to 160 words (up to 200 if there is a substantial discussion to cover). Shorter is fine for trivial posts. Never pad.
- Lead with the point. First sentence says what happened or what is being asked, and who it involves.
- Attribute it: mention the author by name (${ctx.authorName}) naturally, e.g. "${ctx.authorName} reports that..." or "...according to ${ctx.authorName}".
- Shared links and quoted passages are someone else's words. Say that ${ctx.authorName} shared them and attribute the content to its source by name (for example "a post on X by Greg Isenberg" or "an article on The Verge"; read a handle as a name, without the at sign). Never present quoted text as ${ctx.authorName}'s own view or writing. If ${ctx.authorName} added their own comment, report that separately as their take.
- If the post is a question or request for help, say so and say what the asker needs.
- The segment covers the whole thread, not just the original post. If there are replies, work them in: if a reply answers the question, give the answer and say who gave it (that is usually the most important part of the segment, so do not bury it). If replies add decisions, numbers, corrections, or pushback, report those and attribute them. Skip replies that add nothing (thanks, plus-ones).
- If there are replies, mention roughly how many (for example "three people have replied"). Never say the question is unanswered when a reply answers it.
- If there is a deadline, decision, number, or action for listeners, include it.
- Spell things for the ear: say "and" not "&", write numbers as words when short, expand acronyms the first time if their meaning is clear from the post, read dates like "September sixth". No URLs, no markdown, no emoji, no bullet points, no headings, no code.
- Do not invent facts. If the post is thin, keep the segment short.
- Neutral, warm newsroom tone. Third person. No sign-off.

Also produce a headline: at most 12 words, plain text, no trailing period.

Post title: ${post.title}
Author: ${ctx.authorName}
Posted: ${postedOn}${ctx.tags && ctx.tags.length ? `\nTags: ${ctx.tags.join(', ')}` : ''}
Replies so far: ${commentCount}

${(analysis.link || analysis.quotes.length) ? `Post contents (a shared item):\n${source}` : `Post body:\n"""\n${source || '(no body text)'}\n"""`}
${repliesBlock}
Respond with only a JSON object: {"headline": "...", "tts_text": "..."}`;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: prompt }]
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(`Model refused (${response.stop_details?.category || 'unknown'})`);
    }
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = extractJson(text);
    const tts = String(parsed.tts_text || '').replace(/\s+/g, ' ').trim();
    const headline = String(parsed.headline || post.title).replace(/\s+/g, ' ').trim().slice(0, 255);
    if (tts.length < 20) throw new Error('Model returned an empty segment');
    return {
      headline,
      tts_text: tts,
      model,
      word_count: wordCount(tts),
      est_duration_secs: estimateSeconds(tts)
    };
  } catch (err) {
    if (opts.strict) throw err;
    console.warn(`[radio] Claude summary failed for post ${post.id} (${err.message}); using fallback`);
    return fallbackSegment(post, ctx);
  }
}

module.exports = { summarizePostForRadio, contentHash, loadComments, plainText, analyzePost, estimateSeconds, fallbackSegment, DEFAULT_MODEL };
