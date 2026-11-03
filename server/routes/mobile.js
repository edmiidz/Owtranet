/**
 * Mobile app support API.
 *
 * The mobile app reuses the existing JWT-protected /api/* routes for all
 * feature work (posts, messages, ledger, deliverables, agreements...). This
 * router adds only what a native client needs on top of that:
 *   - one bootstrap call (user + branding + feature flags + badge counts)
 *   - a home-screen aggregate
 *   - push-token registration
 * Mounted at /api/mobile by server.js.
 */
const express = require('express');
const { visiblePostsWhere } = require('../lib/postVisibility');
const { isPushToken } = require('../lib/push');

const MIN_APP_VERSION = process.env.MOBILE_MIN_APP_VERSION || '1.0.0';

/**
 * "Call AI" — a live WebRTC voice call from the app to this workspace's ElevenLabs
 * agent (the one whose webhook tools read/write intranet posts and members).
 * Enabled per instance by ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID in .env.
 */
const callAi = {
  enabled: () => !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID),
  agentId: () => process.env.ELEVENLABS_AGENT_ID || '',
  name: () => process.env.ELEVENLABS_AGENT_NAME || 'AI assistant',
  info: () => (callAi.enabled() ? { name: callAi.name() } : null)
};

module.exports = function createMobileRouter({ db, authenticateToken, baseCurrency }) {
  const router = express.Router();

  const branding = () => ({
    companyName: process.env.COMPANY_NAME || 'Intranet',
    companyShortName: process.env.COMPANY_SHORT_NAME || process.env.COMPANY_NAME || 'Intranet',
    companyEmailDomain: process.env.COMPANY_EMAIL_DOMAIN || '',
    baseUrl: process.env.BASE_URL || '',
    baseCurrency: baseCurrency || process.env.BASE_CURRENCY || 'USD'
  });

  /** Public: lets the login screen validate a workspace URL before signing in. */
  router.get('/config', (req, res) => {
    res.json({
      ...branding(),
      min_app_version: MIN_APP_VERSION,
      features: { radio: true, tasks: true, ledger: true, investments: true, agreements: true, group_chat: true, call_ai: callAi.enabled() },
      ai_agent: callAi.info(),
      server_time: new Date().toISOString()
    });
  });

  router.use(authenticateToken);

  async function counts(userId) {
    const vis = visiblePostsWhere('p', userId);
    const [[c]] = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0) AS unread_notifications,
        (SELECT COUNT(*) FROM direct_messages WHERE recipient_id = ? AND is_read = 0 AND deleted_at IS NULL) AS unread_messages,
        (SELECT COUNT(*) FROM group_messages gmsg
           JOIN group_members gmem ON gmem.group_id = gmsg.group_id AND gmem.user_id = ?
           JOIN \`groups\` g ON g.id = gmsg.group_id AND g.is_active = 1
           LEFT JOIN group_message_reads gmr ON gmr.group_id = gmsg.group_id AND gmr.user_id = ?
           WHERE gmsg.is_deleted = 0 AND gmsg.sender_id <> ?
             AND gmsg.created_at > COALESCE(gmr.last_read_at, '1970-01-01')) AS unread_group_messages,
        (SELECT COUNT(*) FROM user_agreement_assignments WHERE user_id = ? AND status = 'pending') AS pending_agreements,
        (SELECT COUNT(*) FROM tasks WHERE assigned_to = ? AND status <> 'completed') AS open_tasks,
        (SELECT COUNT(*) FROM radio_segments s JOIN posts p ON p.id = s.post_id
           LEFT JOIN radio_listens rl ON rl.segment_id = s.id AND rl.user_id = ?
           WHERE s.status = 'ready' AND rl.id IS NULL AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ${vis.sql}) AS radio_unheard`,
      [userId, userId, userId, userId, userId, userId, userId, userId, ...vis.params]
    );
    return {
      unread_notifications: Number(c.unread_notifications) || 0,
      unread_messages: Number(c.unread_messages) || 0,
      unread_group_messages: Number(c.unread_group_messages) || 0,
      pending_agreements: Number(c.pending_agreements) || 0,
      open_tasks: Number(c.open_tasks) || 0,
      radio_unheard: Number(c.radio_unheard) || 0
    };
  }

  /** GET /api/mobile/bootstrap — everything the app needs after login / on cold start. */
  router.get('/bootstrap', async (req, res) => {
    try {
      const [[user]] = await db.execute(
        `SELECT id, email, name, github_username, intranet_username, avatar_url, bio, department, position,
                company, telephone, calendar_link, role, hourly_rate, created_at, last_login, company_email
         FROM users WHERE id = ?`, [req.user.userId]);
      if (!user) return res.status(401).json({ error: 'User not found' });
      res.json({
        user,
        branding: branding(),
        features: { radio: true, tasks: true, ledger: true, investments: true, agreements: true, group_chat: true, webmail: !!user.company_email, call_ai: callAi.enabled() },
        ai_agent: callAi.info(),
        counts: await counts(user.id),
        min_app_version: MIN_APP_VERSION,
        server_time: new Date().toISOString()
      });
    } catch (error) {
      console.error('[mobile] bootstrap error:', error);
      res.status(500).json({ error: 'Failed to bootstrap' });
    }
  });

  /** GET /api/mobile/counts — cheap badge refresh (poll every minute or on foreground). */
  router.get('/counts', async (req, res) => {
    try { res.json(await counts(req.user.userId)); }
    catch (error) { res.status(500).json({ error: 'Failed to load counts' }); }
  });

  /** GET /api/mobile/home — dashboard aggregate. */
  router.get('/home', async (req, res) => {
    try {
      const userId = req.user.userId;
      const vis = visiblePostsWhere('p', userId);
      const [posts] = await db.query(
        `SELECT p.id, p.title, p.slug, p.created_at, p.is_pinned, u.name AS author_name, u.avatar_url,
                (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE ${vis.sql}
         ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 8`, vis.params);
      const [assignments] = await db.execute(
        `SELECT a.id, a.status, a.requested_at, v.title, v.version, v.agreement_type
         FROM user_agreement_assignments a JOIN agreement_versions v ON v.id = a.agreement_version_id
         WHERE a.user_id = ? AND a.status = 'pending' ORDER BY a.requested_at DESC`, [userId]);
      const [quicklinks] = await db.execute(
        'SELECT id, title, url, description FROM quicklinks WHERE is_active = 1 ORDER BY display_order ASC, id ASC LIMIT 12');
      const [conversations] = await db.execute(
        `SELECT c.id AS conversation_id,
                CASE WHEN c.user1_id = ? THEN u2.name ELSE u1.name END AS other_user_name,
                CASE WHEN c.user1_id = ? THEN u2.avatar_url ELSE u1.avatar_url END AS other_user_avatar,
                (SELECT COUNT(*) FROM direct_messages d WHERE d.conversation_id = c.id AND d.recipient_id = ? AND d.is_read = 0 AND d.deleted_at IS NULL) AS unread
         FROM dm_conversations c JOIN users u1 ON u1.id = c.user1_id JOIN users u2 ON u2.id = c.user2_id
         WHERE c.user1_id = ? OR c.user2_id = ?
         ORDER BY c.updated_at DESC LIMIT 5`, [userId, userId, userId, userId, userId]);
      res.json({
        counts: await counts(userId),
        recent_posts: posts,
        pending_agreements: assignments,
        quicklinks,
        recent_conversations: conversations
      });
    } catch (error) {
      console.error('[mobile] home error:', error);
      res.status(500).json({ error: 'Failed to load home' });
    }
  });

  /**
   * POST /api/mobile/ai/session — mint a single-use ElevenLabs WebRTC conversation
   * token for the workspace agent, so the app never holds the ElevenLabs API key.
   * The caller's identity is returned as dynamic variables the app passes at
   * session start; they land in the conversation's metadata on ElevenLabs
   * (and are usable as {{user_name}} etc. in the agent prompt).
   */
  router.post('/ai/session', async (req, res) => {
    if (!callAi.enabled()) return res.status(404).json({ error: 'not_configured', message: 'Call AI is not set up on this workspace yet.' });
    try {
      const [[user]] = await db.execute(
        'SELECT id, name, email, intranet_username, role, department, position FROM users WHERE id = ?', [req.user.userId]);
      if (!user) return res.status(401).json({ error: 'User not found' });
      const url = `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(callAi.agentId())}`;
      const r = await fetch(url, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        console.error(`[mobile] ElevenLabs conversation token failed: HTTP ${r.status} ${body.slice(0, 300)}`);
        return res.status(502).json({ error: 'The AI service did not accept the call right now. Try again in a moment.' });
      }
      const { token } = await r.json();
      if (!token) return res.status(502).json({ error: 'The AI service returned no token.' });
      res.json({
        token,
        agent_id: callAi.agentId(),
        agent_name: callAi.name(),
        dynamic_variables: {
          user_id: String(user.id),
          // What the intranet tools bind acting_user_id to — same value here,
          // but other platforms hosting the agent may put their own user id
          // in user_id, so the tools can't rely on it.
          intranet_user_id: String(user.id),
          user_name: user.name || '',
          user_email: user.email || '',
          user_username: user.intranet_username || '',
          user_role: user.role || '',
          user_department: user.department || '',
          user_position: user.position || '',
          company_name: process.env.COMPANY_NAME || 'Intranet',
          platform: 'mobile'
        }
      });
    } catch (error) {
      console.error('[mobile] ai/session error:', error);
      res.status(500).json({ error: 'Failed to start the call' });
    }
  });

  /**
   * POST /api/mobile/devices  { push_token, platform, device_name?, app_version? }
   * Registers (or refreshes) an FCM registration token for the current user.
   */
  router.post('/devices', async (req, res) => {
    try {
      const { push_token, platform = 'unknown', device_name = null, app_version = null } = req.body || {};
      if (!isPushToken(push_token)) return res.status(400).json({ error: 'push_token must be an FCM registration token (Android) or APNs device token (iOS)' });
      const plat = ['ios', 'android', 'web'].includes(platform) ? platform : 'unknown';
      await db.execute(
        `INSERT INTO mobile_devices (user_id, platform, push_token, device_name, app_version, is_active, last_seen_at)
         VALUES (?, ?, ?, ?, ?, 1, NOW())
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), device_name = VALUES(device_name),
           app_version = VALUES(app_version), is_active = 1, last_seen_at = NOW()`,
        [req.user.userId, plat, push_token, device_name, app_version]);
      res.json({ ok: true });
    } catch (error) {
      console.error('[mobile] register device error:', error);
      res.status(500).json({ error: 'Failed to register device' });
    }
  });

  /** DELETE /api/mobile/devices/:token — on logout. */
  router.delete('/devices/:token', async (req, res) => {
    try {
      await db.execute('UPDATE mobile_devices SET is_active = 0 WHERE push_token = ? AND user_id = ?',
        [req.params.token, req.user.userId]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to unregister device' });
    }
  });

  return router;
};
