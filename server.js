const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const sharp = require('sharp');
const { marked } = require('marked');
const DOMPurify = require('isomorphic-dompurify');
const { Octokit } = require('@octokit/rest');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { EmailManager, EmailCrypto } = require('./emailUtils');
const { analyzeDocument } = require('./utils/aiAnalyzer');
const fieldCrypto = require('./utils/fieldCrypto');
const { createAgentResponder, extractMentionTokens } = require('./server/lib/aiAgents');
const { instancePublicDir, createPluginRouter, loadPlugins } = require('./server/lib/plugins');
require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Generate one with `openssl rand -hex 32` and add it to .env.');
  process.exit(1);
}

// Helper function to determine which email address to use based on user preference
function getNotificationEmail(user) {
  const preference = user.email_notification_preference || 'company';
  
  switch (preference) {
    case 'personal':
      return user.email;
    case 'company':
      return user.company_email || user.email;
    case 'both':
      return [user.company_email, user.email].filter(Boolean);
    default:
      return user.company_email || user.email;
  }
}

const app = express();
const PORT = process.env.PORT || 3006;

// Branding constants (configurable per client deployment)
const COMPANY_NAME = process.env.COMPANY_NAME || 'Owtranet';
const COMPANY_SHORT_NAME = process.env.COMPANY_SHORT_NAME || COMPANY_NAME;
const COMPANY_EMAIL_DOMAIN = process.env.COMPANY_EMAIL_DOMAIN || '';
const SITE_NAME = `${COMPANY_NAME} Intranet`;
const SITE_TEAM = `${COMPANY_NAME} Intranet Team`;
const BASE_URL = process.env.BASE_URL || 'https://intranet.example.com';
// Where "someone tried to sign in with an unknown address" alerts go. Unset = no alert.
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || '';
// Local Postfix/Dovecot: system sender account, and the suffix of per-member Linux mail users (<name>-<suffix>).
const MAIL_SYSTEM_ADDRESS = process.env.MAIL_SYSTEM_ADDRESS || `system@${COMPANY_EMAIL_DOMAIN || 'example.com'}`;
const MAIL_USER_SUFFIX = process.env.MAIL_USER_SUFFIX || 'intranet';

// Base/reporting currency for money views (ledger, investment tracker, dashboards).
// Defaults to USD; set
// BASE_CURRENCY=CAD in the instance .env to make CAD the stored/displayed base.
const BASE_CURRENCY = (process.env.BASE_CURRENCY || 'USD').toUpperCase();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://*.elevenlabs.io", "wss://*.elevenlabs.io"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://www.youtube.com", "https://drive.google.com", "https://www.facebook.com"],
      // On by default; plain-HTTP installs (e.g. the Docker quickstart) set
      // CSP_UPGRADE_INSECURE_REQUESTS=false so assets aren't forced to https://.
      upgradeInsecureRequests: process.env.CSP_UPGRADE_INSECURE_REQUESTS === 'false' ? null : [],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Trust proxy for nginx - trust exactly 1 hop (nginx on localhost)
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000 // much higher limit for development use
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100 // increased auth limit for development
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// CORS configuration - support multiple origins for CRM integration and extensions
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [BASE_URL];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) return callback(null, true);

    // Allow chrome extensions (they use chrome-extension:// protocol)
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    // Allow firefox extensions (they use moz-extension:// protocol)
    if (origin.startsWith('moz-extension://')) {
      return callback(null, true);
    }

    // Check against allowed origins list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Log rejected origin for debugging but don't throw error
      console.log(`CORS: Rejected origin ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 204
}));

// Explicit OPTIONS handler for preflight requests (fallback)
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Universal links (iOS) / app links (Android) for the mobile app, so a tapped
// https://<this host>/forum/post/x opens the native screen. Served from here
// rather than client/dist because express.static ignores dot-directories. Only
// paths the app has a screen for are claimed — keep in step with
// mobile/src/lib/deepLinks.ts. Everything else (login, admin, uploads, /api,
// /mcp) stays in the browser.
const MOBILE_LINK_PATHS = ['/dashboard', '/forum', '/forum/*', '/tasks', '/tasks/*', '/investment-tracker', '/investment-tracker/*',
  '/ledger', '/ledger/*', '/profile/*', '/search', '/messages', '/group-chat', '/group-chat/*'];
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.json({
    applinks: {
      details: [{
        appIDs: [process.env.IOS_APP_ID || 'TEAMID.com.example.owtranet'],
        components: [
          { '/': '/investment-tracker/payments', exclude: true },
          ...MOBILE_LINK_PATHS.map(p => ({ '/': p })),
        ],
      }],
    },
  });
});
// Android verification needs the signing cert's SHA-256 (Play Console → App
// integrity); comma-separate upload + Play signing certs. Unset → 404, and
// Android simply keeps opening links in the browser.
app.get('/.well-known/assetlinks.json', (req, res) => {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 || '').split(',').map(f => f.trim()).filter(Boolean);
  if (!fingerprints.length) return res.status(404).end();
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: process.env.ANDROID_PACKAGE || 'com.example.owtranet', sha256_cert_fingerprints: fingerprints },
  }]);
});

// Static files — an instance's public/ (INSTANCE_DIR, see docs/PLUGINS.md) wins over the build
const INSTANCE_PUBLIC_DIR = instancePublicDir();
if (INSTANCE_PUBLIC_DIR) app.use(express.static(INSTANCE_PUBLIC_DIR, { index: false }));
app.use(express.static(path.join(__dirname, 'client/dist'), { index: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/downloads', express.static(path.join(__dirname, 'public/downloads')));

// File upload configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads', req.uploadType || 'general');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    // Allowed file extensions
    const allowedExtensions = /\.(jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|txt|md|csv|json|xml|zip|mp4|mp3|wav|ogg|webm)$/i;

    // Allowed MIME types
    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/markdown', 'text/csv',
      'application/json', 'application/xml', 'text/xml',
      'application/zip', 'application/x-zip-compressed',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'
    ];

    const extValid = allowedExtensions.test(file.originalname.toLowerCase());
    const mimeValid = allowedMimeTypes.includes(file.mimetype);

    if (extValid || mimeValid) {
      return cb(null, true);
    } else {
      console.log(`File rejected: ${file.originalname} (mime: ${file.mimetype})`);
      cb(new Error(`Invalid file type: ${file.mimetype}`));
    }
  }
});

// Database connection
let db;
async function initDatabase() {
  try {
    db = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      user: process.env.DB_USER || 'intranet_user',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'owtranet',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    
    // Test the connection
    await db.execute('SELECT 1 as test');
    console.log('Database connected successfully');

    // Fail loudly if any agreement collects payroll fields but no encryption key
    // is configured — refusing to start beats collecting SINs we can't encrypt.
    try {
      const [payrollAgreements] = await db.execute(
        "SELECT COUNT(*) as cnt FROM agreement_versions WHERE required_fields IS NOT NULL"
      );
      if (payrollAgreements[0].cnt > 0 && !fieldCrypto.hasKey()) {
        console.error('FATAL: agreement versions with required_fields exist but PAYROLL_ENCRYPTION_KEY is missing or invalid (need 64 hex chars — generate with `openssl rand -hex 32`).');
        process.exit(1);
      }
    } catch (e) {
      // required_fields column doesn't exist yet (migration not applied) — fine.
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
    }
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
}

// GitHub API client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Email sending function (updated to use local SMTP as primary)
async function sendEmail(to, subject, text, html) {
  console.log('=== SENDING EMAIL ===');
  console.log('To:', to);
  console.log('Subject:', subject);

  // Get admin BCC setting from database
  let adminBcc = null;
  try {
    const [bccSettings] = await db.execute(
      'SELECT setting_value FROM system_settings WHERE setting_key = ?',
      ['email_bcc_admin']
    );
    if (bccSettings.length > 0 && bccSettings[0].setting_value.trim()) {
      adminBcc = bccSettings[0].setting_value.trim();
      console.log('Admin BCC enabled:', adminBcc);
    }
  } catch (error) {
    console.log('Could not retrieve BCC setting, proceeding without BCC');
  }

  // Try local SMTP server first (mail.${COMPANY_EMAIL_DOMAIN} on localhost)
  try {
    console.log('Attempting to send via local SMTP server...');
    const transporter = nodemailer.createTransport({
      host: 'localhost',
      port: 587,
      secure: false, // Use STARTTLS
      auth: {
        user: MAIL_SYSTEM_ADDRESS, // System email account
        pass: process.env.MAIL_SMTP_PASSWORD // Dovecot password for the system account
      },
      tls: {
        rejectUnauthorized: false // For self-signed certificates
      }
    });

    const mailOptions = {
      from: `"${SITE_NAME}" <${MAIL_SYSTEM_ADDRESS}>`,
      to: to,
      subject: subject,
      text: text,
      html: html
    };

    // Add BCC only if configured
    if (adminBcc) {
      mailOptions.bcc = adminBcc;
    }

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully via local SMTP to ${to}${adminBcc ? ' (BCC: ' + adminBcc + ')' : ''}`);
    return;
  } catch (localSmtpError) {
    console.error('❌ Local SMTP failed:', localSmtpError.message);
    // Continue to fallback options
  }

  // Fallback to AWS SES via SMTP if configured
  if (process.env.SES_SMTP_HOST && process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS) {
    try {
      console.log('Attempting to send via AWS SES SMTP as fallback...');
      const transporter = nodemailer.createTransport({
        host: process.env.SES_SMTP_HOST,
        port: 587,
        secure: false,
        auth: {
          user: process.env.SES_SMTP_USER,
          pass: process.env.SES_SMTP_PASS
        }
      });
      const mailOptions = {
        from: process.env.SES_FROM_EMAIL || `noreply@${COMPANY_EMAIL_DOMAIN || 'example.com'}`,
        to: to,
        subject: subject,
        text: text,
        html: html
      };

      // Add BCC only if configured
      if (adminBcc) {
        mailOptions.bcc = adminBcc;
      }

      await transporter.sendMail(mailOptions);
      console.log(`✅ Email sent successfully via AWS SES SMTP to ${to}${adminBcc ? ' (BCC: ' + adminBcc + ')' : ''}`);
      return;
    } catch (sesError) {
      console.error('❌ AWS SES SMTP failed:', sesError.message);
      // Continue to fallback options if available
    }
  }

  console.log('No additional email services configured');
  throw new Error('Email sending failed - no working email service available');
}

// JWT middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error('JWT Verification Error:', err);
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;

    // Check for pending_agreement role and enforce agreement requirement
    const allowedPaths = [
      '/api/agreements/status',
      '/api/agreements/sign',
      '/api/agreements/current',
      '/api/auth/logout',
      '/api/auth/me'
    ];

    if (!allowedPaths.some(path => req.path === path || req.path.startsWith(path))) {
      if (user.role === 'pending_agreement') {
        console.log(`AGREEMENT ENFORCEMENT: Blocking access to ${req.path} for pending_agreement user ${user.email}`);
        return res.status(403).json({
          error: 'Agreement signature required',
          requiresAgreement: true,
          message: 'You must sign the user agreement before accessing this resource'
        });
      }
    }

    next();
  });
}

// API Token middleware for external integrations
async function authenticateApiToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'];
  
  // Check for API key in header or authorization
  const token = apiKey || (authHeader && authHeader.replace('Bearer ', '').replace('Token ', ''));

  if (!token) {
    return res.status(401).json({ error: 'API token required' });
  }

  try {
    // Check if token exists and is active
    const [tokens] = await db.execute(
      'SELECT * FROM api_tokens WHERE token = ? AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())',
      [token]
    );

    if (tokens.length === 0) {
      return res.status(403).json({ error: 'Invalid or expired API token' });
    }

    const apiToken = tokens[0];
    
    // Update last used timestamp
    await db.execute(
      'UPDATE api_tokens SET last_used_at = NOW() WHERE id = ?',
      [apiToken.id]
    );

    // Set token info for use in the endpoint
    req.apiToken = apiToken;
    req.isApiRequest = true;
    
    // If this is a user token (has created_by), set user context
    if (apiToken.created_by) {
      const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [apiToken.created_by]);
      if (users.length > 0) {
        req.user = userContextFromRow(users[0]);
      }
    }

    // Acting user: an integration token (permissions.acting_user === true, e.g. an
    // ElevenLabs voice agent) may act on behalf of the signed-in caller so posts,
    // tasks and direct messages are attributed to the person, not the token owner.
    // The id arrives as a tool parameter filled from the conversation's dynamic
    // variables (query/body `acting_user_id`) or the X-Acting-User-Id header.
    // Ignored (never trusted) on tokens without the permission.
    req.tokenOwner = req.user || null;
    req.actingUser = false;
    const rawActing = req.headers['x-acting-user-id']
      ?? (req.query && req.query.acting_user_id)
      ?? (req.body && req.body.acting_user_id);
    if (req.query && 'acting_user_id' in req.query) delete req.query.acting_user_id;
    if (req.body && typeof req.body === 'object' && 'acting_user_id' in req.body) delete req.body.acting_user_id;
    if (rawActing !== undefined && rawActing !== null && String(rawActing).trim() !== '') {
      if (!tokenAllowsActingUser(apiToken)) {
        return res.status(403).json({ error: 'This API token cannot act on behalf of another user' });
      }
      const actingId = parseInt(rawActing);
      if (isNaN(actingId)) {
        return res.status(400).json({ error: 'Invalid acting_user_id' });
      }
      const [actingRows] = await db.execute(
        "SELECT * FROM users WHERE id = ? AND role IN ('user', 'admin', 'moderator')",
        [actingId]
      );
      if (actingRows.length === 0) {
        return res.status(400).json({ error: 'Unknown acting_user_id' });
      }
      req.user = userContextFromRow(actingRows[0]);
      req.actingUser = true;
    }

    next();
  } catch (error) {
    console.error('API token authentication error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Shape the req.user object the same way the JWT middleware does.
function userContextFromRow(row) {
  return {
    userId: row.id,
    email: row.email,
    role: row.role,
    github_username: row.github_username,
    name: row.name
  };
}

// api_tokens.permissions is a JSON column: either an array of scope strings
// (personal tokens) or an object of flags (integration tokens).
function parseTokenPermissions(apiToken) {
  let perms = apiToken && apiToken.permissions;
  if (typeof perms === 'string') {
    try { perms = JSON.parse(perms); } catch (e) { perms = null; }
  }
  return perms || null;
}

function tokenAllowsActingUser(apiToken) {
  const perms = parseTokenPermissions(apiToken);
  return !!(perms && !Array.isArray(perms) && perms.acting_user === true);
}

// Error with an HTTP status, thrown by shared helpers and mapped to a JSON
// response by the route that called them.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Admin middleware
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Process MediaWiki-style [[wiki links]] before markdown parsing
function processWikiLinks(markdown) {
  // Match [[Link Title]] or [[Link Title|Display Text]]
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

  return markdown.replace(wikiLinkRegex, (match, title, displayText) => {
    const linkTitle = title.trim();
    const linkDisplay = (displayText || title).trim();
    // Create a special wiki link element that the frontend will process
    // Using data attributes to store the link info
    return `<a href="#" class="wiki-link" data-wiki-title="${linkTitle.replace(/"/g, '&quot;')}">${linkDisplay}</a>`;
  });
}

// Generate a URL-friendly slug from text (for heading anchors)
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
    .replace(/\s+/g, '-')      // Replace spaces with hyphens
    .replace(/--+/g, '-')      // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, '');  // Trim hyphens from start/end
}

/**
 * Embeddable video URL → responsive iframe HTML (or null). Used for the
 * ![](url) image syntax AND for plain links on their own: a paragraph that
 * links to a YouTube video or a Facebook reel/video gets the player appended
 * under it, so extension-made posts ("Check out: <link>") show the video.
 */
function videoEmbedHtml(url) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) {
    const portrait = /youtube\.com\/shorts\//.test(url);
    return `<div class="embed-video${portrait ? ' embed-portrait' : ''}"><iframe src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
  }
  const fb = url.match(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:reel\/\d+|share\/r\/[A-Za-z0-9_-]+|watch\/?\?(?:.*&)?v=\d+|[^/?#]+\/videos\/(?:[^/?#]+\/)?\d+|video\.php\?v=\d+)/)
    || url.match(/^https?:\/\/fb\.watch\/[A-Za-z0-9_-]+\/?$/);
  if (fb) {
    const canonical = url.replace(/^https?:\/\/(?:m\.|web\.)?facebook\.com/, 'https://www.facebook.com').split('#')[0];
    const portrait = /\/reel\/|\/share\/r\//.test(canonical);
    const src = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonical)}&show_text=false&width=${portrait ? 360 : 560}`;
    return `<div class="embed-video embed-facebook${portrait ? ' embed-portrait' : ''}"><iframe src="${src}" frameborder="0" scrolling="no" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
  }
  return null;
}

// Markdown to HTML with sanitization and clickable links
function markdownToHtml(markdown) {
  // First, process wiki links before markdown parsing
  const processedMarkdown = processWikiLinks(markdown);

  // Configure marked to add target="_blank" to all links
  marked.setOptions({
    renderer: new marked.Renderer(),
    breaks: true,
    gfm: true
  });

  const renderer = new marked.Renderer();

  // Custom heading renderer to add id attributes for anchor links
  renderer.heading = function(text, level) {
    const slug = slugify(text);
    return `<h${level} id="${slug}">${text}</h${level}>`;
  };

  // Custom link renderer - check if it's an internal anchor link
  renderer.link = function(href, title, text) {
    // If it's an anchor link (starts with #), don't add target="_blank"
    if (href && href.startsWith('#')) {
      return `<a href="${href}" class="anchor-link"${title ? ` title="${title}"` : ''}>${text}</a>`;
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;
  };

  // Custom image renderer to handle Google Drive videos
  renderer.image = function(href, title, text) {
    // Check if this is a Google Drive link
    const driveMatch = href.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) {
      const fileId = driveMatch[1];
      // Convert to embedded iframe for Google Drive video
      return `<iframe src="https://drive.google.com/file/d/${fileId}/preview" width="640" height="480" frameborder="0" allowfullscreen></iframe>`;
    }

    // YouTube / Facebook reels and videos
    const embed = videoEmbedHtml(href);
    if (embed) return embed;

    // Regular image
    return `<img src="${href}" alt="${text}"${title ? ` title="${title}"` : ''} />`;
  };

  // A paragraph with a *bare* video link (the visible text is the URL itself —
  // how autolinks and the Chrome extension write them) gets the player appended
  // after it; the link stays, so mobile / email / TTS still have something to
  // show. A link with its own text, e.g. [watch this reel](url), is the opt-out:
  // it renders as a plain link (useful when Facebook refuses to embed the video).
  // ![](url) always embeds.
  renderer.paragraph = function(text) {
    const embeds = [];
    const seen = new Set();
    const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const norm = u => u.replace(/&amp;/g, '&').replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').trim();
    let m;
    while ((m = re.exec(text)) && embeds.length < 3) {
      const href = m[1].replace(/&amp;/g, '&');
      const label = m[2].replace(/<[^>]+>/g, '');
      if (norm(label) !== norm(href)) continue; // named link → no player
      if (seen.has(href)) continue;
      seen.add(href);
      const embed = videoEmbedHtml(href);
      if (embed) embeds.push(embed);
    }
    return `<p>${text}</p>\n${embeds.join('\n')}`;
  };

  const html = marked.parse(processedMarkdown, { renderer });
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['target', 'frameborder', 'allowfullscreen', 'allow', 'scrolling', 'loading', 'rel', 'data-wiki-title'],
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li',
                   'blockquote', 'code', 'pre', 'img', 'strong', 'em', 'br', 'hr',
                   'table', 'thead', 'tbody', 'tr', 'td', 'th', 'iframe', 'div'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel',
                    'width', 'height', 'frameborder', 'allowfullscreen', 'allow', 'scrolling', 'loading', 'data-wiki-title']
  });
}

// Process mentions in content
async function processMentions(content, entityType, entityId, userId, mentioningUser) {
  // Each distinct @handle once; an e-mail address (name@domain) is not a mention.
  const mentions = extractMentionTokens(content);

  for (const username of mentions) {
    const [userRows] = await db.execute(
      `SELECT u.id, u.account_type FROM users u LEFT JOIN ai_agents a ON a.user_id = u.id
        WHERE u.github_username = ? OR u.intranet_username = ? OR a.handle = ? LIMIT 1`,
      [username, username, username]
    );

    if (userRows.length > 0) {
      const mentionedUserId = userRows[0].id;
      await db.execute(
        'INSERT INTO mentions (user_id, mentioned_user_id, mentionable_type, mentionable_id) VALUES (?, ?, ?, ?)',
        [userId, mentionedUserId, entityType, entityId]
      );

      // AI agents answer in the thread (createAgentResponder) instead of
      // getting a notification or an e-mail.
      if (userRows[0].account_type === 'ai_agent') continue;

      // Create notification with proper navigation data
      let notificationData = { entityType, entityId };
      
      // For comments, include post information for navigation
      if (entityType === 'comment') {
        const [commentData] = await db.execute(
          'SELECT p.slug, p.id as postId, p.title FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?',
          [entityId]
        );
        if (commentData.length > 0) {
          notificationData.slug = commentData[0].slug;
          notificationData.postId = commentData[0].postId;
          notificationData.postTitle = commentData[0].title;
        }
      } else if (entityType === 'post') {
        const [postData] = await db.execute(
          'SELECT slug, title FROM posts WHERE id = ?',
          [entityId]
        );
        if (postData.length > 0) {
          notificationData.slug = postData[0].slug;
          notificationData.postTitle = postData[0].title;
        }
      } else if (entityType === 'group_message') {
        // Group chat mention: the client needs the group to open the right chat.
        const [groupData] = await db.execute(
          'SELECT g.id, g.name, g.display_name FROM group_messages gm JOIN `groups` g ON g.id = gm.group_id WHERE gm.id = ?',
          [entityId]
        );
        if (groupData.length > 0) {
          notificationData.groupId = groupData[0].id;
          notificationData.groupName = groupData[0].name;
          notificationData.groupDisplayName = groupData[0].display_name;
        }
      } else if (entityType === 'task') {
        notificationData.taskId = entityId;
      } else if (entityType === 'task_comment') {
        const [taskData] = await db.execute(
          'SELECT task_id FROM task_comments WHERE id = ?',
          [entityId]
        );
        if (taskData.length > 0) notificationData.taskId = taskData[0].task_id;
      }

      const mentionWhere = {
        post: 'In a forum post',
        comment: 'In a forum comment',
        group_message: notificationData.groupDisplayName ? `In the ${notificationData.groupDisplayName} group chat` : 'In a group chat',
        task: 'In a task',
        task_comment: 'In a task comment'
      }[entityType] || `In a ${entityType}`;

      await db.execute(
        'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
        [
          mentionedUserId,
          'mention',
          `You were mentioned by @${mentioningUser.intranet_username || mentioningUser.github_username}`,
          mentionWhere,
          JSON.stringify(notificationData)
        ]
      );

      // Send email notification to mentioned user if they're offline
      try {
        const [mentionedUserData] = await db.execute(
          'SELECT email, name, company_email, last_login, email_notification_preference FROM users WHERE id = ?',
          [mentionedUserId]
        );
        
        if (mentionedUserData.length > 0) {
          const mentionedUser = mentionedUserData[0];
          const emailToUse = getNotificationEmail(mentionedUser);
          
          // Check if user was online recently (within last 30 minutes)
          const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
          const lastLogin = mentionedUser.last_login ? new Date(mentionedUser.last_login) : new Date(0);
          const isUserOffline = lastLogin < thirtyMinutesAgo;
          
          if (isUserOffline) {
            const contentUrl = entityType === 'post' 
              ? `${process.env.BASE_URL}/forum/post/${notificationData.postId || entityId}`
              : `${process.env.BASE_URL}/forum/post/${notificationData.postId}`;
            
            const emailSubject = `You were mentioned - ${SITE_NAME}`;
            const mentioningUserName = mentioningUser.intranet_username || mentioningUser.github_username;
            const contentTitle = notificationData.postTitle || `a ${entityType}`;
            
            const emailText = `Hi ${mentionedUser.name}!

@${mentioningUserName} mentioned you in ${contentTitle}.

View the ${entityType}: ${contentUrl}

Best regards,
${SITE_TEAM}`;

            const emailHtml = `
              <h2>You were mentioned! 📢</h2>
              <p>Hi ${mentionedUser.name},</p>
              <p><strong>@${mentioningUserName}</strong> mentioned you in <strong>${contentTitle}</strong>.</p>
              
              <p style="margin: 20px 0;">
                <a href="${contentUrl}" style="background:#007bff;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">
                  View ${entityType.charAt(0).toUpperCase() + entityType.slice(1)}
                </a>
              </p>
              
              <p>Stay connected with your team on ${SITE_NAME}!</p>
              <p>Best regards,<br>${SITE_TEAM}</p>
            `;
            
            // Handle both single email and array of emails
            const emailsToSend = Array.isArray(emailToUse) ? emailToUse : [emailToUse];
            for (const email of emailsToSend) {
              await sendEmail(email, emailSubject, emailText, emailHtml);
            }
            console.log(`Mention email notification sent to ${emailsToSend.join(', ')} for offline user ${mentionedUser.name}`);
          } else {
            console.log(`User ${mentionedUser.name} is online, skipping email notification for mention`);
          }
        }
      } catch (emailError) {
        console.error('Failed to send mention email notification:', emailError);
        // Don't fail the mention creation if email fails
      }
    }
  }
}

// Generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 100);
}

// ===================== BRANDING CONFIG (Public) =====================

// ===================== EMAIL & CALENDAR PROVIDER =====================
// Each member picks where their work mailbox + calendar live. Only 'self_hosted'
// (a Postfix/Dovecot mailbox + Nextcloud calendar on this box) unlocks the
// Email Request flow and Webmail; Microsoft 365 / Google Workspace are external.
// users.email_provider NULL = instance default (DEFAULT_EMAIL_PROVIDER env).
const EMAIL_PROVIDERS = ['self_hosted', 'microsoft_365', 'google_workspace'];
const DEFAULT_EMAIL_PROVIDER = EMAIL_PROVIDERS.includes(process.env.DEFAULT_EMAIL_PROVIDER)
  ? process.env.DEFAULT_EMAIL_PROVIDER
  : 'self_hosted';
const EMAIL_PROVIDER_OPTIONS = [
  { value: 'self_hosted', label: `${COMPANY_SHORT_NAME} Mail — self-hosted (Postfix/Dovecot mailbox + Nextcloud calendar)`, webmail: true },
  { value: 'microsoft_365', label: 'Microsoft 365 (Outlook + Exchange calendar)', webmail: false },
  { value: 'google_workspace', label: 'Google Workspace (Gmail + Google Calendar)', webmail: false },
];
const isSelfHostedProvider = (provider) => (provider || DEFAULT_EMAIL_PROVIDER) === 'self_hosted';

app.get('/api/config/branding', (req, res) => {
  res.json({
    companyName: process.env.COMPANY_NAME || 'Intranet',
    companyShortName: process.env.COMPANY_SHORT_NAME || process.env.COMPANY_NAME || 'Intranet',
    companyEmailDomain: process.env.COMPANY_EMAIL_DOMAIN || '',
    baseUrl: process.env.BASE_URL || '',
    baseCurrency: BASE_CURRENCY,
    emailProviders: EMAIL_PROVIDER_OPTIONS,
    defaultEmailProvider: DEFAULT_EMAIL_PROVIDER,
  });
});

// ===================== AUTH ENDPOINTS =====================

// Forgot password endpoint
app.post('/api/auth/forgot-password', [
  body('email').isEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email: rawEmail } = req.body;
    const email = rawEmail.trim().toLowerCase();

    // Find user by email
    const [users] = await db.execute(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    
    // Always return success to prevent email enumeration
    if (users.length === 0) {
      return res.json({ message: 'If an account with that email exists, reset instructions have been sent.' });
    }
    
    const user = users[0];
    
    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    
    // Store reset token in database
    await db.execute(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, tokenHash, expiresAt]
    );
    
    // Send password reset email with link
    try {
      const resetUrl = `${process.env.BASE_URL}/reset-password?token=${resetToken}`;
      const emailSubject = `🔐 Password Reset Request - ${SITE_NAME}`;
      
      const emailText = `Hi ${user.name},

A password reset was requested for your account: ${email}

Click the link below to set your new password:
${resetUrl}

This link expires in 2 hours for security.

SECURITY NOTES:
- Only you should use this link
- The link can only be used once
- If you didn't request this, you can safely ignore this email
- Choose a strong, unique password

Didn't request this? Contact an admin immediately.

---
${SITE_NAME} Security System`;

      const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px;">🔐 Password Reset Request</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">${SITE_NAME}</p>
        </div>
        
        <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
          <p style="margin: 0 0 15px 0; font-size: 16px;">Hi <strong>${user.name}</strong>,</p>
          <p style="margin: 0 0 15px 0;">A password reset was requested for your account: <strong>${email}</strong></p>
        </div>
        
        <div style="text-align: center; margin-bottom: 25px;">
          <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">🔗 Reset Your Password</a>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
          <h3 style="margin: 0 0 15px 0; color: #856404;">⏰ Security Notes:</h3>
          <ul style="margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 5px;">This link expires in 2 hours</li>
            <li style="margin-bottom: 5px;">The link can only be used once</li>
            <li style="margin-bottom: 5px;">Choose a strong, unique password</li>
            <li style="margin-bottom: 5px;">Only click if you requested this reset</li>
          </ul>
        </div>
        
        <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
          <p style="margin: 0; color: #721c24;"><strong>❓ Didn't request this?</strong> Contact an admin immediately.</p>
        </div>
        
        <div style="text-align: center; color: #6c757d; font-size: 14px; border-top: 1px solid #dee2e6; padding-top: 20px;">
          <p style="margin: 0;">${SITE_NAME} Security System</p>
        </div>
      </div>`;

      await sendEmail(email, emailSubject, emailText, emailHtml);
      console.log(`Password reset email sent to ${email}`);
      
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
      // Continue with the process even if email fails
    }
    
    console.log(`Password reset token generated for ${email} - reset link sent via email`);
    
    res.json({ message: 'If an account with that email exists, reset instructions have been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Validate reset token endpoint
app.post('/api/auth/validate-reset-token', [
  body('token').notEmpty().isLength({ min: 32, max: 128 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid token format' });
  }

  try {
    const { token } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const [tokens] = await db.execute(`
      SELECT prt.*, u.email, u.name 
      FROM password_reset_tokens prt 
      JOIN users u ON prt.user_id = u.id 
      WHERE prt.token_hash = ? AND prt.expires_at > NOW() AND prt.used_at IS NULL
    `, [tokenHash]);

    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Failed to validate token' });
  }
});

// Request email authentication link
app.post('/api/auth/email-login', [
  body('email').isEmail().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email } = req.body;
    const emailLowerCase = email.trim().toLowerCase();
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    // Find user by email (check both personal email and company email)
    const [users] = await db.execute(
      'SELECT id, email, company_email, name, role FROM users WHERE email = ? OR company_email = ?',
      [emailLowerCase, emailLowerCase]
    );

    // Check if user exists and provide helpful message
    if (users.length === 0) {
      console.log(`[EMAIL-AUTH] User not found for: ${emailLowerCase} (original: ${email})`);

      // Before bouncing the user, check whether they have an active, unused, unexpired invitation.
      // If so, resend a registration link to the invited address (proves inbox ownership) instead
      // of telling them "user not found" — they just haven't completed signup yet.
      let activeInvite = null;
      try {
        const [invites] = await db.execute(
          `SELECT code, email, name, expires_at
             FROM invite_codes
            WHERE LOWER(email) = ?
              AND is_active = 1
              AND used_at IS NULL
              AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1`,
          [emailLowerCase]
        );
        if (invites.length > 0) {
          activeInvite = invites[0];
        }
      } catch (inviteLookupError) {
        console.error('[EMAIL-AUTH] Invite lookup failed:', inviteLookupError);
      }

      if (activeInvite) {
        const inviteUrl = `${BASE_URL}/register?invite=${activeInvite.code}`;
        const expiresStr = new Date(activeInvite.expires_at).toLocaleDateString(undefined, {
          year: 'numeric', month: 'long', day: 'numeric'
        });
        const greetingName = activeInvite.name || 'there';

        const subject = `Finish setting up your ${SITE_NAME} account`;
        const text = `Hi ${greetingName},

You tried to sign in to ${SITE_NAME}, but your account hasn't been created yet — you have a pending invitation that needs to be activated first.

Click the link below to finish setting up your account:
${inviteUrl}

This invitation expires on ${expiresStr}.

Once you complete registration, you'll be able to sign in normally at ${BASE_URL}.

If you weren't expecting this email, you can safely ignore it.

— ${SITE_NAME}`;

        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
              <h1 style="margin: 0; font-size: 26px;">Finish setting up your account</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">${SITE_NAME}</p>
            </div>

            <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
              <p style="margin: 0 0 12px 0; font-size: 16px;">Hi <strong>${greetingName}</strong>,</p>
              <p style="margin: 0 0 12px 0;">You tried to sign in to ${SITE_NAME}, but your account hasn't been created yet — you have a pending invitation that needs to be activated first.</p>
            </div>

            <div style="text-align: center; margin-bottom: 25px;">
              <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Complete registration</a>
            </div>

            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px 20px; border-radius: 8px; margin-bottom: 25px;">
              <p style="margin: 0;">This invitation expires on <strong>${expiresStr}</strong>.</p>
            </div>

            <div style="text-align: center; color: #6c757d; font-size: 13px; border-top: 1px solid #dee2e6; padding-top: 16px;">
              <p style="margin: 0;">Once you complete registration, sign in at <a href="${BASE_URL}">${BASE_URL}</a>.</p>
              <p style="margin: 8px 0 0 0;">If you weren't expecting this email, you can safely ignore it.</p>
            </div>
          </div>`;

        try {
          await sendEmail(activeInvite.email, subject, text, html);
          console.log(`[EMAIL-AUTH] Registration link resent to invited address: ${activeInvite.email}`);
        } catch (emailError) {
          console.error('[EMAIL-AUTH] Failed to send registration link to invited address:', emailError);
          return res.status(500).json({ error: 'Failed to send email. Please try again.' });
        }

        return res.json({
          message: 'Check your email to finish setting up your account.',
          showOtp: false,
          expiresIn: 15
        });
      }

      // No matching active invitation — original behavior: notify admin and tell the user to look
      // for their invitation email (or contact an admin).
      try {
        const adminEmail = ADMIN_NOTIFY_EMAIL;
        if (!adminEmail) throw new Error('ADMIN_NOTIFY_EMAIL not set; skipping admin alert');
        const emailSubject = 'Email Auth Attempt - User Not Found';
        const emailText = `Hello,\n\nSomeone tried to use email authentication on ${SITE_NAME} with an email that doesn't exist:\n\nAttempted email: ${email}\nTime: ${new Date().toLocaleString()}\nIP Address: ${ipAddress || 'Unknown'}\nUser Agent: ${userAgent || 'Unknown'}\n\nThey have been advised to look for their invitation email.\n\nBest regards,\n${SITE_NAME} System`;

        const emailHtml = `
          <h2>Email Auth Attempt - User Not Found</h2>
          <p>Someone tried to use email authentication on ${SITE_NAME} with an email that doesn't exist:</p>
          <ul>
            <li><strong>Attempted email:</strong> ${email}</li>
            <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
            <li><strong>IP Address:</strong> ${ipAddress || 'Unknown'}</li>
            <li><strong>User Agent:</strong> ${userAgent || 'Unknown'}</li>
          </ul>
          <p>They have been advised to look for their invitation email.</p>
          <p>Best regards,<br>${SITE_NAME} System</p>
        `;

        await sendEmail(adminEmail, emailSubject, emailText, emailHtml);
        console.log(`[EMAIL-AUTH] Notification sent to admin about non-existent user: ${email}`);
      } catch (emailError) {
        console.error('[EMAIL-AUTH] Failed to send notification email:', emailError);
      }

      return res.status(404).json({
        error: 'User not found',
        userNotFound: true,
        message: `This email is not registered. Please check your email for an invitation titled "🎉 You're invited to join ${SITE_NAME}!" or contact your administrator.`
      });
    }

    const user = users[0];

    // Check if user has pending_agreement or deactivated status
    if (user.role === 'deactivated') {
      return res.status(403).json({ error: 'Account is deactivated. Please contact an administrator.' });
    }
    if (user.account_type === 'ai_agent' && user.role === 'system') {
      return res.status(403).json({ error: 'AI agent accounts cannot sign in' });
    }

    // Generate secure token and 6-digit OTP
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store token in database
    await db.execute(
      'INSERT INTO email_auth_tokens (user_id, token_hash, otp_code, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      [user.id, tokenHash, otpCode, expiresAt, ipAddress, userAgent]
    );

    // Create login URL
    const loginUrl = `${BASE_URL}/login?token=${token}`;

    // Send email with login link and OTP
    const emailSubject = `🔐 One-Time Login Link - ${SITE_NAME}`;

    const emailText = `Hi ${user.name},

You requested a one-time login link for your account: ${email}

Click the link below to sign in:
${loginUrl}

Or use this code on the login page: ${otpCode}

This link and code expire in 15 minutes for security.

SECURITY NOTES:
- This link can only be used once
- Don't share this link or code with anyone
- If you didn't request this, please ignore this email

---
${SITE_NAME} Security System`;

    const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
        <h1 style="margin: 0; font-size: 28px;">🔐 One-Time Login</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">${SITE_NAME}</p>
      </div>

      <div style="background: #f8f9fa; padding: 25px; border-radius: 8px; margin-bottom: 25px;">
        <p style="margin: 0 0 15px 0; font-size: 16px;">Hi <strong>${user.name}</strong>,</p>
        <p style="margin: 0 0 15px 0;">You requested a one-time login link for: <strong>${email}</strong></p>
      </div>

      <div style="text-align: center; margin-bottom: 25px;">
        <a href="${loginUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">🔗 Sign In Now</a>
      </div>

      <div style="background: #e3f2fd; border: 2px solid #2196f3; padding: 20px; border-radius: 8px; margin-bottom: 25px; text-align: center;">
        <h3 style="margin: 0 0 10px 0; color: #1976d2;">📱 Login Code for Mobile</h3>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1976d2; margin: 15px 0;">${otpCode}</div>
        <p style="margin: 0; font-size: 14px; color: #666;">Enter this code on the login page if the link doesn't work</p>
      </div>

      <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
        <h3 style="margin: 0 0 15px 0; color: #856404;">⏰ Security Notes:</h3>
        <ul style="margin: 0; padding-left: 20px;">
          <li style="margin-bottom: 5px;">This link expires in 15 minutes</li>
          <li style="margin-bottom: 5px;">Can only be used once</li>
          <li style="margin-bottom: 5px;">Don't share this email with anyone</li>
          <li style="margin-bottom: 5px;">Request from IP: ${ipAddress}</li>
        </ul>
      </div>

      <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
        <p style="margin: 0; color: #721c24;"><strong>🚫 Didn't request this?</strong> You can safely ignore this email. The link will expire automatically.</p>
      </div>

      <div style="text-align: center; color: #6c757d; font-size: 14px; border-top: 1px solid #dee2e6; padding-top: 20px;">
        <p style="margin: 0;">${SITE_NAME} Security System</p>
        <p style="margin: 5px 0 0 0; font-size: 12px;">Request from ${ipAddress}</p>
      </div>
    </div>`;

    try {
      await sendEmail(email, emailSubject, emailText, emailHtml);
      console.log(`Email login link sent to ${email} with OTP: ${otpCode}`);
    } catch (emailError) {
      console.error('Failed to send email login link:', emailError);
      return res.status(500).json({ error: 'Failed to send email. Please try again.' });
    }

    res.json({
      message: 'Login link has been sent to your email.',
      showOtp: true,
      expiresIn: 15
    });

  } catch (error) {
    console.error('Email login error:', error);
    res.status(500).json({ error: 'Failed to process email login request' });
  }
});

// Verify email login token or OTP
app.post('/api/auth/verify-email-token', async (req, res) => {
  try {
    const { token, otp } = req.body;
    const ipAddress = req.ip;

    if (!token && !otp) {
      return res.status(400).json({ error: 'Token or OTP code is required' });
    }

    let tokenData;

    if (token) {
      // Verify by token
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const [tokens] = await db.execute(
        `SELECT eat.*, u.id as userId, u.email, u.name, u.role, u.hourly_rate, u.github_username,
                u.intranet_username, u.avatar_url, u.company_email, u.bio, u.department,
                u.position, u.company, u.telephone, u.calendar_link, u.created_at,
                u.last_login, u.company_email_created_at, u.company_email_last_reset, u.email_provider
         FROM email_auth_tokens eat
         JOIN users u ON eat.user_id = u.id
         WHERE eat.token_hash = ?
         AND eat.expires_at > NOW()
         AND eat.used_at IS NULL`,
        [tokenHash]
      );

      if (tokens.length === 0) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      tokenData = tokens[0];
    } else {
      // Verify by OTP
      const [tokens] = await db.execute(
        `SELECT eat.*, u.id as userId, u.email, u.name, u.role, u.hourly_rate, u.github_username,
                u.intranet_username, u.avatar_url, u.company_email, u.bio, u.department,
                u.position, u.company, u.telephone, u.calendar_link, u.created_at,
                u.last_login, u.company_email_created_at, u.company_email_last_reset, u.email_provider
         FROM email_auth_tokens eat
         JOIN users u ON eat.user_id = u.id
         WHERE eat.otp_code = ?
         AND eat.expires_at > NOW()
         AND eat.used_at IS NULL
         ORDER BY eat.created_at DESC
         LIMIT 1`,
        [otp]
      );

      if (tokens.length === 0) {
        return res.status(401).json({ error: 'Invalid or expired OTP code' });
      }

      tokenData = tokens[0];
    }

    // Mark token as used
    await db.execute(
      'UPDATE email_auth_tokens SET used_at = NOW() WHERE id = ?',
      [tokenData.id]
    );

    // Update last login
    await db.execute(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [tokenData.userId]
    );

    // Generate JWT token
    const jwtToken = jwt.sign(
      {
        userId: tokenData.userId,
        email: tokenData.email,
        role: tokenData.role,
        hourly_rate: tokenData.hourly_rate,
        intranet_username: tokenData.intranet_username
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`User ${tokenData.email} logged in via email authentication from ${ipAddress}`);

    res.json({
      message: 'Login successful',
      token: jwtToken,
      user: {
        id: tokenData.userId,
        email: tokenData.email,
        name: tokenData.name,
        github_username: tokenData.github_username,
        intranet_username: tokenData.intranet_username,
        avatar_url: tokenData.avatar_url,
        bio: tokenData.bio,
        department: tokenData.department,
        position: tokenData.position,
        company: tokenData.company,
        telephone: tokenData.telephone,
        calendar_link: tokenData.calendar_link,
        role: tokenData.role,
        created_at: tokenData.created_at,
        last_login: tokenData.last_login,
        company_email: tokenData.company_email,
        company_email_created_at: tokenData.company_email_created_at,
        company_email_last_reset: tokenData.company_email_last_reset,
        email_provider: tokenData.email_provider || null
      }
    });

  } catch (error) {
    console.error('Email token verification error:', error);
    res.status(500).json({ error: 'Failed to verify login token' });
  }
});

// Reset password with token endpoint
app.post('/api/auth/reset-password', [
  body('token').notEmpty().isLength({ min: 32, max: 128 }),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { token, password } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Find valid token
    const [tokens] = await db.execute(`
      SELECT prt.*, u.email, u.name 
      FROM password_reset_tokens prt 
      JOIN users u ON prt.user_id = u.id 
      WHERE prt.token_hash = ? AND prt.expires_at > NOW() AND prt.used_at IS NULL
    `, [tokenHash]);

    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const tokenData = tokens[0];
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Update user password
    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, tokenData.user_id]
    );
    
    // Check if user has company email account and sync password
    const [userAccount] = await db.execute(
      'SELECT u.company_email, s.server_username FROM users u LEFT JOIN server_email_accounts s ON u.id = s.linked_user_id WHERE u.id = ?',
      [tokenData.user_id]
    );
    
    let emailPasswordSynced = false;
    let calendarPasswordSynced = false;

    if (userAccount[0] && userAccount[0].company_email && userAccount[0].server_username) {
      try {
        console.log(`Syncing password for company email: ${userAccount[0].company_email}`);

        // Update password on mail server via SSH
        await execAsync(`echo '${userAccount[0].server_username}:${password}' | sudo chpasswd`);

        // Encrypt and store the new password (using same method as webmail)
        const encryptedPassword = emailCrypto.encryptPassword(password);

        // Update encrypted password in database
        await db.execute(
          'UPDATE server_email_accounts SET email_password_encrypted = ? WHERE linked_user_id = ?',
          [encryptedPassword, tokenData.user_id]
        );

        emailPasswordSynced = true;
        console.log(`✅ Password synced for company email: ${userAccount[0].company_email}`);

      } catch (emailSyncError) {
        console.error(`Failed to sync email password for ${userAccount[0].company_email}:`, emailSyncError);
        // Don't fail the entire process if email sync fails
      }
    }

    // Sync password with Nextcloud/CalDAV
    if (userAccount[0] && userAccount[0].company_email) {
      try {
        const nextcloudUsername = userAccount[0].company_email.split('@')[0];
        console.log(`Syncing password for Nextcloud user: ${nextcloudUsername}`);

        // Update Nextcloud password using occ command
        // Use OC_PASS environment variable with sudo
        await execAsync(`sudo OC_PASS='${password.replace(/'/g, "'\\''")}' -u www-data php /var/www/nextcloud/occ user:resetpassword --password-from-env "${nextcloudUsername}"`);

        calendarPasswordSynced = true;
        console.log(`✅ Password synced for Nextcloud user: ${nextcloudUsername}`);

      } catch (nextcloudSyncError) {
        console.error(`Failed to sync Nextcloud password:`, nextcloudSyncError);
        // Don't fail the entire process if Nextcloud sync fails
      }
    }

    // Mark token as used
    await db.execute(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
      [tokenData.id]
    );

    // Send confirmation DM
    const emailSyncStatus = emailPasswordSynced && userAccount[0]?.company_email ?
      `\n\n## 📧 Email Password Also Updated
Your **${userAccount[0].company_email}** email password has been automatically synced with your intranet password.

**Email clients will need to be updated** with your new password:
- iPhone/iPad Mail
- Outlook
- Apple Mail
- Thunderbird
- Any other configured email clients` : '';

    const calendarSyncStatus = calendarPasswordSynced && userAccount[0]?.company_email ?
      `\n\n## 📅 Calendar/CalDAV Password Also Updated
Your **Nextcloud Calendar** password has been automatically synced with your intranet password.

**CalDAV clients will need to be updated** with your new password:
- Apple Calendar
- Google Calendar (CalDAV)
- Thunderbird Calendar
- Mobile calendar apps
- **Access**: https://calendar.${COMPANY_EMAIL_DOMAIN}
- **Username**: ${userAccount[0].company_email.split('@')[0]}` : '';

    const confirmationMessage = `# ✅ Password Successfully Changed

Hi ${tokenData.name},

Your password has been successfully changed for your account: **${tokenData.email}**

## 🔐 Security Confirmation
- Changed at: ${new Date().toLocaleString()}
- Method: Password reset link
- Status: Active${emailSyncStatus}${calendarSyncStatus}

## 🚨 Didn't change your password?
If you didn't make this change, contact an admin immediately as your account may be compromised.

---
*Intranet Security System*`;

    // Find or create conversation with system user
    const conversationResult = await db.execute(`
      SELECT id FROM dm_conversations 
      WHERE (user1_id = 1 AND user2_id = ?) OR (user1_id = ? AND user2_id = 1)
    `, [tokenData.user_id, tokenData.user_id]);
    
    let conversationId;
    if (conversationResult[0].length > 0) {
      conversationId = conversationResult[0][0].id;
    } else {
      const [newConv] = await db.execute(
        'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
        [1, tokenData.user_id]
      );
      conversationId = newConv.insertId;
    }
    
    // Send confirmation message
    const messageHtml = DOMPurify.sanitize(marked.parse(confirmationMessage));
    
    await db.execute(`
      INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
      VALUES (?, ?, ?, ?, ?)
    `, [conversationId, 1, tokenData.user_id, confirmationMessage, messageHtml]);
    
    console.log(`Password reset completed for ${tokenData.email}`);

    res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Current signed-in user (also used by scripts/smoke-test.sh as a liveness probe)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, email, name, role, account_type, intranet_username, github_username,
              avatar_url, company_email, email_provider, created_at, last_login
       FROM users WHERE id = ?`,
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Failed to load current user' });
  }
});

// Get CRM access token (for authenticated users)
app.get('/api/auth/crm-token', authenticateToken, (req, res) => {
  try {
    // Generate a fresh token with same payload for CRM access
    const token = jwt.sign(
      {
        userId: req.user.userId,
        email: req.user.email,
        role: req.user.role,
        hourly_rate: req.user.hourly_rate,
        intranet_username: req.user.intranet_username,
        github_username: req.user.github_username
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        userId: req.user.userId,
        email: req.user.email,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error('CRM token generation error:', error);
    res.status(500).json({ error: 'Failed to generate CRM token' });
  }
});

// ===================== INVITE SYSTEM =====================

// Create invite code (admin only)
app.post('/api/invites', authenticateToken, requireAdmin, [
  body('email').isEmail().optional(),
  body('name').notEmpty().trim().optional()
], async (req, res) => {
  try {
    const { email, name, expires_days = 7 } = req.body;
    
    // Generate unique invite code
    const inviteCode = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_days);
    
    const [result] = await db.execute(
      'INSERT INTO invite_codes (code, created_by, email, name, expires_at) VALUES (?, ?, ?, ?, ?)',
      [inviteCode, req.user.userId, email || null, name || null, expiresAt]
    );
    
    const inviteUrl = `${process.env.BASE_URL}/register?invite=${inviteCode}`;
    
    console.log('=== CHECKING EMAIL CONDITION ===');
    console.log('email parameter:', email);
    console.log('email type:', typeof email);
    console.log('email truthiness:', !!email);
    
    // Send email invitation if email is provided
    if (email) {
      console.log('=== ABOUT TO SEND INVITATION EMAIL ===');
      console.log('Email:', email);
      console.log('Name:', name);
      try {
        const adminName = req.user.name || 'Admin';
        const inviteeName = name || email;
        
        const emailSubject = `🎉 You're invited to join ${SITE_NAME}!`;
        
        const emailText = `
Hi ${inviteeName},

${adminName} has invited you to join the ${SITE_NAME} platform!

Your personal invitation link:
${inviteUrl}

This invitation expires in ${expires_days} days (${expiresAt.toLocaleDateString()}).

What is ${SITE_NAME}?
• Team collaboration and knowledge sharing platform
• Internal forum for questions and discussions
• Email management and administrative tools
• Investment tracking and deliverables management

Click the link above to create your account and get started.

Best regards,
${SITE_TEAM}
        `.trim();
        
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">🎉 You're invited to join ${SITE_NAME}!</h2>
            
            <p>Hi <strong>${inviteeName}</strong>,</p>
            
            <p><strong>${adminName}</strong> has invited you to join the ${SITE_NAME} platform!</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold;">Your personal invitation link:</p>
              <p style="margin: 10px 0 0 0;">
                <a href="${inviteUrl}" style="color: #2563eb; word-break: break-all;">${inviteUrl}</a>
              </p>
            </div>
            
            <p><em>This invitation expires in ${expires_days} days (${expiresAt.toLocaleDateString()}).</em></p>
            
            <h3 style="color: #374151;">What is ${SITE_NAME}?</h3>
            <ul style="color: #6b7280;">
              <li>Team collaboration and knowledge sharing platform</li>
              <li>Internal forum for questions and discussions</li>
              <li>Email management and administrative tools</li>
              <li>Investment tracking and deliverables management</li>
            </ul>
            
            <p style="text-align: center; margin: 30px 0;">
              <a href="${inviteUrl}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Join ${SITE_NAME}</a>
            </p>
            
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
            <p style="color: #6b7280; font-size: 14px;">Best regards,<br>${SITE_TEAM}</p>
          </div>
        `;
        
        await sendEmail(email, emailSubject, emailText, emailHtml);
        console.log(`Invitation email sent to ${email} for invite code ${inviteCode}`);
      } catch (emailError) {
        console.error('Failed to send invitation email:', emailError);
        // Don't fail the invite creation if email fails
      }
    }
    
    console.log('=== FINAL EMAIL STATUS ===');
    console.log('email still:', email);
    console.log('Will return email_sent:', !!email);
    
    res.status(201).json({
      message: email ? 'Invite code created and email sent!' : 'Invite code created',
      inviteId: result.insertId,
      code: inviteCode,
      url: inviteUrl,
      expires_at: expiresAt,
      email_sent: !!email
    });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// Get invite codes (admin only)
app.get('/api/invites', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [invites] = await db.execute(`
      SELECT ic.*, u.name as created_by_name, ub.name as used_by_name
      FROM invite_codes ic
      JOIN users u ON ic.created_by = u.id
      LEFT JOIN users ub ON ic.used_by = ub.id
      ORDER BY ic.created_at DESC
    `);
    
    res.json(invites);
  } catch (error) {
    console.error('Get invites error:', error);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// Resend invite email (admin only)
app.post('/api/invites/:id/resend', authenticateToken, requireAdmin, async (req, res) => {
  console.log('=== RESEND ENDPOINT HIT ===');
  console.log(`Request params:`, req.params);
  console.log(`User:`, req.user);
  
  try {
    const { id } = req.params;
    console.log(`Resend request for invite ID: ${id}`);
    
    // Get invite details
    const [invites] = await db.execute(
      `SELECT ic.*, u.name as admin_name 
       FROM invite_codes ic 
       JOIN users u ON ic.created_by = u.id 
       WHERE ic.id = ? AND ic.used_at IS NULL AND ic.is_active = TRUE`,
      [id]
    );
    
    console.log(`Found ${invites.length} invites for ID ${id}`);
    
    if (invites.length === 0) {
      console.log('No invite found or already used');
      return res.status(404).json({ error: 'Invite not found or already used' });
    }
    
    const invite = invites[0];
    console.log(`Invite details:`, invite);
    
    if (!invite.email) {
      console.log('No email associated with invite');
      return res.status(400).json({ error: 'Cannot resend - no email associated with this invite' });
    }
    
    // Check if invite is expired
    if (new Date(invite.expires_at) < new Date()) {
      console.log('Invite is expired');
      return res.status(400).json({ error: 'Cannot resend - invite has expired' });
    }
    
    console.log('About to send email...');
    
    try {
      const inviteUrl = `${process.env.BASE_URL}/register?invite=${invite.code}`;
      const adminName = invite.admin_name || 'Admin';
      const inviteeName = invite.name || invite.email;
      
      const emailSubject = `🎉 Reminder: You're invited to join ${SITE_NAME}!`;
      
      const emailText = `Hi ${inviteeName}, this is a reminder from ${adminName}. Visit: ${inviteUrl}`;
      const emailHtml = `<p>Hi <strong>${inviteeName}</strong>, this is a reminder from <strong>${adminName}</strong>. <a href="${inviteUrl}">Click here to join</a></p>`;
      
      console.log(`Sending email to: ${invite.email}`);
      await sendEmail(invite.email, emailSubject, emailText, emailHtml);
      console.log(`SUCCESS: Email sent to ${invite.email}`);
      
      res.json({ message: 'Invitation email resent successfully!' });
    } catch (emailError) {
      console.error('EMAIL ERROR:', emailError);
      res.status(500).json({ error: 'Failed to resend invitation email' });
    }
  } catch (error) {
    console.error('GENERAL ERROR:', error);
    res.status(500).json({ error: 'Failed to resend invite' });
  }
});

// Delete invite (admin only)
app.delete('/api/invites/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if invite exists and is not used
    const [invites] = await db.execute(
      'SELECT * FROM invite_codes WHERE id = ?',
      [id]
    );
    
    if (invites.length === 0) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    
    const invite = invites[0];
    
    if (invite.used_at) {
      return res.status(400).json({ error: 'Cannot delete - invite has already been used' });
    }
    
    // Delete the invite
    await db.execute(
      'DELETE FROM invite_codes WHERE id = ?',
      [id]
    );
    
    console.log(`Invite ID ${id} deleted by admin user ${req.user.userId}`);
    res.json({ message: 'Invite deleted successfully' });
  } catch (error) {
    console.error('Delete invite error:', error);
    res.status(500).json({ error: 'Failed to delete invite' });
  }
});

// Validate invite code
app.get('/api/invites/:code/validate', async (req, res) => {
  try {
    const { code } = req.params;
    
    const [invites] = await db.execute(
      `SELECT * FROM invite_codes 
       WHERE code = ? AND is_active = TRUE AND expires_at > NOW() AND used_at IS NULL`,
      [code]
    );
    
    if (invites.length === 0) {
      return res.status(404).json({ 
        error: 'Invalid, expired, or already used invite code' 
      });
    }
    
    const invite = invites[0];
    res.json({
      valid: true,
      email: invite.email,
      name: invite.name,
      expires_at: invite.expires_at
    });
  } catch (error) {
    console.error('Validate invite error:', error);
    res.status(500).json({ error: 'Failed to validate invite' });
  }
});

// ===================== INVITE LINKS ENDPOINTS =====================

// Get all invite links (admin only)
app.get('/api/invite-links', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [links] = await db.execute(`
      SELECT il.*, u.name as created_by_name,
             COUNT(ilu.id) as total_uses
      FROM invite_links il
      JOIN users u ON il.created_by = u.id
      LEFT JOIN invite_link_usage ilu ON il.id = ilu.invite_link_id
      GROUP BY il.id
      ORDER BY il.created_at DESC
    `);
    
    res.json(links);
  } catch (error) {
    console.error('Get invite links error:', error);
    res.status(500).json({ error: 'Failed to fetch invite links' });
  }
});

// Create invite link (admin only)
app.post('/api/invite-links', authenticateToken, requireAdmin, [
  body('name').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('description').optional().isLength({ max: 500 }),
  body('max_uses').optional().isInt({ min: 1 }),
  body('days_valid').optional().isInt({ min: 1, max: 30 }).default(7)
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, description, max_uses, days_valid = 7 } = req.body;
    
    // Generate unique link code
    const linkCode = crypto.randomBytes(8).toString('hex');
    
    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days_valid);
    
    const [result] = await db.execute(
      'INSERT INTO invite_links (link_code, name, description, max_uses, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [linkCode, name, description, max_uses || null, expiresAt, req.user.userId]
    );
    
    const inviteUrl = `${BASE_URL}/register?link=${linkCode}`;
    
    res.json({
      id: result.insertId,
      link_code: linkCode,
      invite_url: inviteUrl,
      name: name,
      expires_at: expiresAt,
      message: 'Invite link created successfully'
    });
  } catch (error) {
    console.error('Create invite link error:', error);
    res.status(500).json({ error: 'Failed to create invite link' });
  }
});

// Validate invite link
app.get('/api/invite-links/:linkCode/validate', async (req, res) => {
  try {
    const { linkCode } = req.params;
    
    const [links] = await db.execute(`
      SELECT * FROM invite_links 
      WHERE link_code = ? AND is_active = TRUE AND expires_at > NOW()
    `, [linkCode]);
    
    if (links.length === 0) {
      return res.status(404).json({ 
        valid: false, 
        error: 'Invalid or expired invite link' 
      });
    }
    
    const link = links[0];
    
    // Check if link has reached max uses
    if (link.max_uses && link.current_uses >= link.max_uses) {
      return res.status(400).json({ 
        valid: false, 
        error: 'Invite link has reached maximum uses' 
      });
    }
    
    res.json({
      valid: true,
      name: link.name,
      description: link.description,
      expires_at: link.expires_at
    });
  } catch (error) {
    console.error('Validate invite link error:', error);
    res.status(500).json({ error: 'Failed to validate invite link' });
  }
});

// Deactivate invite link (admin only)
app.put('/api/invite-links/:id/deactivate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute(
      'UPDATE invite_links SET is_active = FALSE WHERE id = ?',
      [id]
    );
    
    res.json({ message: 'Invite link deactivated successfully' });
  } catch (error) {
    console.error('Deactivate invite link error:', error);
    res.status(500).json({ error: 'Failed to deactivate invite link' });
  }
});

// Activate invite link (admin only)
app.put('/api/invite-links/:id/activate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute(
      'UPDATE invite_links SET is_active = TRUE WHERE id = ?',
      [id]
    );
    
    res.json({ message: 'Invite link activated successfully' });
  } catch (error) {
    console.error('Activate invite link error:', error);
    res.status(500).json({ error: 'Failed to activate invite link' });
  }
});

// Delete invite link (admin only)
app.delete('/api/invite-links/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute('DELETE FROM invite_links WHERE id = ?', [id]);
    
    res.json({ message: 'Invite link deleted successfully' });
  } catch (error) {
    console.error('Delete invite link error:', error);
    res.status(500).json({ error: 'Failed to delete invite link' });
  }
});

// Register endpoint (now requires invite code or invite link)
app.post('/api/auth/register', [
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('name').notEmpty().trim(),
  body('github_username').optional().trim(),
  body('invite_code').optional().trim(),
  body('invite_link').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password, name, github_username, company, telephone, invite_code, invite_link } = req.body;
    
    // Must have either invite_code or invite_link
    if (!invite_code && !invite_link) {
      return res.status(400).json({ error: 'Either invite code or invite link is required' });
    }

    let inviteValid = false;
    let inviteData = null;
    let isInviteLink = false;

    // Check invite code first if provided
    if (invite_code) {
      const [invites] = await db.execute(
        `SELECT * FROM invite_codes 
         WHERE code = ? AND is_active = TRUE AND expires_at > NOW() AND used_at IS NULL`,
        [invite_code]
      );
      
      if (invites.length > 0) {
        inviteValid = true;
        inviteData = invites[0];
        isInviteLink = false;
      }
    }
    
    // If invite code failed or not provided, check invite link
    if (!inviteValid && invite_link) {
      const [links] = await db.execute(
        `SELECT * FROM invite_links 
         WHERE link_code = ? AND is_active = TRUE AND expires_at > NOW()`,
        [invite_link]
      );
      
      if (links.length > 0) {
        const link = links[0];
        
        // Check if link has reached max uses
        if (!link.max_uses || link.current_uses < link.max_uses) {
          inviteValid = true;
          inviteData = link;
          isInviteLink = true;
        } else {
          return res.status(400).json({ error: 'Invite link has reached maximum uses' });
        }
      }
    }

    if (!inviteValid) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    // Prevent company email addresses for personal email during registration
    if (COMPANY_EMAIL_DOMAIN && email.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
      return res.status(400).json({
        error: `Cannot use @${COMPANY_EMAIL_DOMAIN} address as personal email. Please use a personal email like Gmail, Yahoo, etc. You can request a @${COMPANY_EMAIL_DOMAIN} email separately after registration.`
      });
    }

    // If using invite code with specific email, must match
    if (!isInviteLink && inviteData.email && inviteData.email !== email) {
      return res.status(400).json({ 
        error: 'This invite was created for a different email address' 
      });
    }
    
    // Handle optional GitHub username (only use if explicitly provided)
    const finalGithubUsername = github_username?.trim() || null;
    
    // Check if user exists
    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE email = ? OR (github_username = ? AND github_username IS NOT NULL AND github_username != "")',
      [email, finalGithubUsername]
    );
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Check if there's an active agreement - new users will need to sign after registration
    const [activeAgreement] = await db.execute(
      'SELECT id FROM agreement_versions WHERE is_active = 1 LIMIT 1'
    );
    
    const requiresAgreement = activeAgreement.length > 0;
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Get GitHub avatar if username provided
    let avatarUrl = null;
    if (finalGithubUsername) {
      try {
        const { data } = await octokit.users.getByUsername({ username: finalGithubUsername });
        avatarUrl = data.avatar_url;
      } catch (error) {
        console.log('Could not fetch GitHub avatar:', error.message);
      }
    }
    
    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    // Insert user - all new users start as pending until email verified
    const [result] = await db.execute(
      `INSERT INTO users (email, email_verified, email_verification_token, email_verification_expires, password, name, github_username, invite_code, company, telephone, avatar_url, role) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, false, emailVerificationToken, verificationExpires, hashedPassword, name, finalGithubUsername, invite_code || null, company, telephone, avatarUrl, 'pending']
    );
    
    const userId = result.insertId;
    
    // Mark invite as used
    if (isInviteLink) {
      // For invite links, increment usage count and log usage
      await db.execute(
        'UPDATE invite_links SET current_uses = current_uses + 1 WHERE id = ?',
        [inviteData.id]
      );
      
      // Log the usage
      await db.execute(
        'INSERT INTO invite_link_usage (invite_link_id, user_id, ip_address, user_agent) VALUES (?, ?, ?, ?)',
        [inviteData.id, userId, req.ip || null, req.headers['user-agent'] || null]
      );
    } else {
      // For invite codes, mark as used
      await db.execute(
        'UPDATE invite_codes SET used_at = NOW(), used_by = ? WHERE code = ?',
        [userId, invite_code]
      );
    }
    
    // Send email verification email
    try {
      const [inviterRows] = await db.execute(
        'SELECT name FROM users WHERE id = ?',
        [inviteData.created_by]
      );
      const inviterName = inviterRows[0]?.name || 'Admin';
      
      const verificationUrl = `${BASE_URL}/verify-email?token=${emailVerificationToken}`;
      
      const verificationSubject = `Verify Your Email - ${SITE_NAME}`;
      const verificationText = `Welcome to ${SITE_NAME}, ${name}!

You've been invited by ${inviterName} to join our internal collaboration platform.

IMPORTANT: Please verify your email address by clicking the link below:

${verificationUrl}

This link expires in 24 hours. After verifying your email, you'll be able to access the platform and sign the team agreement.

If you didn't request this account, please ignore this email.

Best regards,
${SITE_TEAM}`;

      const verificationHtml = `
        <h2>Verify Your Email - ${SITE_NAME} 📧</h2>
        <p>Hi ${name},</p>
        <p>You've been invited by <strong>${inviterName}</strong> to join our internal collaboration platform.</p>
        
        <h3>Please verify your email address:</h3>
        <p>To complete your account setup, please click the verification link below:</p>
        
        <p style="margin: 20px 0;">
          <a href="${verificationUrl}" style="background:#007bff;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">
            Verify Email Address
          </a>
        </p>
        
        <p><strong>Important:</strong> This link expires in 24 hours.</p>
        
        <h3>After verification, you'll be able to:</h3>
        <ul>
          <li>Sign the team member agreement</li>
          <li>Access forum discussions</li>
          <li>Request your @${COMPANY_EMAIL_DOMAIN} email address</li>
          <li>Track investments and deliverables</li>
          <li>Collaborate with the team</li>
        </ul>
        
        <p>If you didn't request this account, please ignore this email.</p>
        
        <hr>
        <p>Best regards,<br>${SITE_TEAM}</p>
      `;

      await sendEmail(email, verificationSubject, verificationText, verificationHtml);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail registration if email fails
    }
    
    res.status(201).json({ 
      message: 'Registration successful! Please check your email to verify your account.',
      userId: userId,
      requires_email_verification: true
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  // Custom validation that accepts both email and username
  const { email: rawEmail, password } = req.body;
  const email = rawEmail ? rawEmail.trim() : rawEmail; // Trim whitespace

  console.log(`[LOGIN] Attempt for: ${email}`);

  if (!email || !password) {
    console.log(`[LOGIN] Missing credentials - email: ${!!email}, password: ${!!password}`);
    return res.status(400).json({
      error: 'Email/username and password are required'
    });
  }

  try {

    // Get user by email OR company_email OR intranet_username OR github_username
    let users = [];
    if (email.includes('@')) {
      // It's an email address - try both personal email and company email
      console.log(`[LOGIN] Searching by email: ${email.toLowerCase()}`);
      [users] = await db.execute(
        'SELECT * FROM users WHERE email = ? OR company_email = ?',
        [email.toLowerCase(), email.toLowerCase()]
      );
    } else {
      // It's a username - try intranet_username first
      console.log(`[LOGIN] Searching by intranet_username: ${email}`);
      [users] = await db.execute(
        'SELECT * FROM users WHERE intranet_username = ?',
        [email]
      );

      // If not found, try github_username
      if (users.length === 0) {
        console.log(`[LOGIN] Not found by intranet_username, trying github_username: ${email}`);
        [users] = await db.execute(
          'SELECT * FROM users WHERE github_username = ?',
          [email]
        );
      }
    }

    // If not found by primary method, try the other
    if (users.length === 0) {
      if (email.includes('@')) {
        console.log(`[LOGIN] Email not found, trying as username`);
        [users] = await db.execute(
          'SELECT * FROM users WHERE intranet_username = ? OR github_username = ?',
          [email, email]
        );
      } else {
        console.log(`[LOGIN] Username not found, trying as email`);
        [users] = await db.execute(
          'SELECT * FROM users WHERE email = ?',
          [email.toLowerCase()]
        );
      }
    }

    if (users.length === 0) {
      console.log(`[LOGIN] User not found for: ${email}`);

      // Send notification email to admin about non-existent user attempt
      try {
        const attemptedEmail = email.includes('@') ? email : `${email} (username)`;
        const adminEmail = ADMIN_NOTIFY_EMAIL;
        if (!adminEmail) throw new Error('ADMIN_NOTIFY_EMAIL not set; skipping admin alert');

        const emailSubject = 'Login Attempt - User Not Found';
        const emailText = `Hello,

Someone tried to login to ${SITE_NAME} with credentials that don't exist:

Attempted login: ${attemptedEmail}
Time: ${new Date().toLocaleString()}
IP Address: ${req.ip || req.connection.remoteAddress}

They have been advised to look for their invitation email.

Best regards,
${SITE_NAME} System`;

        const emailHtml = `
          <h2>Login Attempt - User Not Found</h2>
          <p>Someone tried to login to ${SITE_NAME} with credentials that don't exist:</p>
          <ul>
            <li><strong>Attempted login:</strong> ${attemptedEmail}</li>
            <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
            <li><strong>IP Address:</strong> ${req.ip || req.connection.remoteAddress}</li>
          </ul>
          <p>They have been advised to look for their invitation email.</p>
          <p>Best regards,<br>${SITE_NAME} System</p>
        `;

        await sendEmail(adminEmail, emailSubject, emailText, emailHtml);
        console.log(`[LOGIN] Notification sent to admin about non-existent user: ${attemptedEmail}`);
      } catch (emailError) {
        console.error('[LOGIN] Failed to send notification email:', emailError);
      }

      // Return helpful message for non-existent user
      return res.status(401).json({
        error: 'User not found',
        userNotFound: true,
        message: `This email/username is not registered. Please check your email for an invitation titled "🎉 You're invited to join ${SITE_NAME}!" or contact your administrator.`
      });
    }

    console.log(`[LOGIN] User found - ID: ${users[0].id}, Email: ${users[0].email}, GitHub: ${users[0].github_username}, Intranet: ${users[0].intranet_username}`)
    
    const user = users[0];
    
    // Check if user needs email verification
    if (user.role === 'pending' && !user.email_verified) {
      return res.status(403).json({ 
        error: 'Please verify your email address before logging in. Check your inbox for the verification link.',
        requires_email_verification: true
      });
    }
    
    // Check if user is deactivated
    if (user.role === 'deactivated') {
      return res.status(403).json({ error: 'Account has been deactivated' });
    }
    // AI agent accounts act only through the agent responder.
    if (user.account_type === 'ai_agent' && user.role === 'system') {
      return res.status(403).json({ error: 'AI agent accounts cannot sign in' });
    }
    
    // Verify password
    console.log(`[LOGIN] Checking password for user ID ${user.id}`);
    const validPassword = await bcrypt.compare(password, user.password);
    console.log(`[LOGIN] Password valid: ${validPassword}`);
    if (!validPassword) {
      console.log(`[LOGIN] Invalid password for user: ${email}`);
      return res.status(401).json({
        error: 'Incorrect password',
        incorrectPassword: true,
        message: 'The password you entered is incorrect. Please try again or use the "Forgot Password" option.'
      });
    }
    
    // Update last login
    await db.execute(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );
    
    // Generate token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        hourly_rate: user.hourly_rate,
        github_username: user.github_username,
        intranet_username: user.intranet_username
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        github_username: user.github_username,
        intranet_username: user.intranet_username,
        avatar_url: user.avatar_url,
        bio: user.bio,
        department: user.department,
        position: user.position,
        company: user.company,
        telephone: user.telephone,
        calendar_link: user.calendar_link,
        role: user.role,
        created_at: user.created_at,
        last_login: user.last_login,
        company_email: user.company_email,
        company_email_created_at: user.company_email_created_at,
        company_email_last_reset: user.company_email_last_reset,
        email_provider: user.email_provider || null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ===================== EMAIL REQUEST ENDPOINTS =====================

// Submit email request
app.post('/api/email-requests', authenticateToken, [
  body('requested_email').custom((value) => {
    // Accept either username or username@<company domain>
    const cleanValue = value.trim();

    // If it already has @domain, validate the full format
    if (cleanValue.includes('@')) {
      const domain = COMPANY_EMAIL_DOMAIN.replace(/\./g, '\\.');
      return new RegExp(`^[a-zA-Z0-9._\\-]+@${domain}$`).test(cleanValue);
    }

    // Otherwise just validate the username part
    return /^[a-zA-Z0-9._\-]+$/.test(cleanValue);
  }).withMessage(`Invalid email format. Use username or username@${COMPANY_EMAIL_DOMAIN}`),
  body('justification').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    let { requested_email, justification } = req.body;

    // A company mailbox is only provisioned for members on the self-hosted provider
    const [requesterRows] = await db.execute('SELECT email_provider FROM users WHERE id = ?', [req.user.userId]);
    if (requesterRows.length > 0 && !isSelfHostedProvider(requesterRows[0].email_provider)) {
      return res.status(400).json({
        error: `Your email & calendar provider is set to an external service. Switch it to the self-hosted ${COMPANY_SHORT_NAME} Mail option on your profile to request a @${COMPANY_EMAIL_DOMAIN} mailbox.`
      });
    }

    // Normalize the email - trim, lowercase, and add company domain if not present
    requested_email = requested_email.trim().toLowerCase();
    if (!requested_email.includes('@')) {
      requested_email = `${requested_email}@${COMPANY_EMAIL_DOMAIN}`;
    }

    // Check if email already exists
    const [existing] = await db.execute(
      'SELECT id FROM email_requests WHERE requested_email = ?',
      [requested_email]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email address already requested' });
    }
    
    // Create request
    const [result] = await db.execute(
      'INSERT INTO email_requests (user_id, requested_email, justification) VALUES (?, ?, ?)',
      [req.user.userId, requested_email, justification]
    );
    
    // Notify admins in database
    await db.execute(
      `INSERT INTO notifications (user_id, type, title, message, data)
       SELECT id, 'email_request', 'New Email Request', ?, ?
       FROM users WHERE role = 'admin'`,
      [`${requested_email} requested`, JSON.stringify({ requestId: result.insertId })]
    );

    // Get user details for email
    const [userRows] = await db.execute(
      'SELECT name, email, github_username FROM users WHERE id = ?',
      [req.user.userId]
    );
    const user = userRows[0];

    // Send email notification to admins
    try {
      const [adminRows] = await db.execute(
        'SELECT email FROM users WHERE role = "admin"'
      );
      
      for (const admin of adminRows) {
        const emailSubject = `New Email Request - ${SITE_NAME}`;
        const emailText = `New @${COMPANY_EMAIL_DOMAIN} email request:

Requested Email: ${requested_email}
Requested By: ${user.name} (${user.email})
GitHub: @${user.github_username}
Justification: ${justification}

View in admin panel: ${process.env.BASE_URL}/admin`;

        const emailHtml = `
          <h2>New @${COMPANY_EMAIL_DOMAIN} Email Request</h2>
          <div style="background:#f8f9fa;padding:20px;border-radius:8px;margin:20px 0;">
            <h3>Request Details</h3>
            <p><strong>Requested Email:</strong> ${requested_email}</p>
            <p><strong>Requested By:</strong> ${user.name} (${user.email})</p>
            <p><strong>GitHub:</strong> @${user.github_username}</p>
            <p><strong>Justification:</strong></p>
            <blockquote style="border-left:4px solid #007bff;padding-left:16px;margin:16px 0;color:#495057;">
              ${justification}
            </blockquote>
          </div>
          <p><a href="${process.env.BASE_URL}/admin" style="background:#007bff;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">Review in Admin Panel</a></p>
        `;

        await sendEmail(admin.email, emailSubject, emailText, emailHtml);
      }
      console.log('Admin notification emails sent for email request');
    } catch (emailError) {
      console.error('Failed to send admin notification emails:', emailError);
      // Don't fail the request if email fails
    }
    
    res.status(201).json({ 
      message: 'Email request submitted',
      requestId: result.insertId 
    });
  } catch (error) {
    console.error('Email request error:', error);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// Get email requests 
app.get('/api/email-requests', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT er.*, u.name as requester_name, u.email as requester_email,
             a.name as approver_name
      FROM email_requests er
      JOIN users u ON er.user_id = u.id
      LEFT JOIN users a ON er.approved_by = a.id
    `;
    
    const params = [];
    
    // If not admin, only show user's own requests
    if (req.user.role !== 'admin') {
      query += ' WHERE er.user_id = ?';
      params.push(req.user.userId);
    }
    
    query += ' ORDER BY er.created_at DESC';
    
    const [requests] = await db.execute(query, params);
    
    res.json(requests);
  } catch (error) {
    console.error('Get email requests error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Approve/Reject email request
app.put('/api/email-requests/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;
    
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    // Get request details before updating
    const [requests] = await db.execute(`
      SELECT er.*, u.name as requester_name, u.email as requester_email
      FROM email_requests er
      JOIN users u ON er.user_id = u.id
      WHERE er.id = ?
    `, [id]);
    
    if (requests.length === 0) {
      return res.status(404).json({ error: 'Email request not found' });
    }
    
    const request = requests[0];
    
    await db.execute(
      `UPDATE email_requests 
       SET status = ?, approved_by = ?, approved_at = NOW(), rejection_reason = ?
       WHERE id = ?`,
      [status, req.user.userId, rejection_reason || null, id]
    );
    
    // If approved, create the email account
    // ⚠️ IMPORTANT: Read docs/EMAIL_SYSTEM_ARCHITECTURE.md before modifying this section
    // Key rules: Use virtual mail users (no system users), email address format for paths,
    // server_username = email address, consistent paths across Postfix/Dovecot/database
    if (status === 'approved') {
      const creationLog = [];
      try {
        const requestedEmail = request.requested_email;

        console.log(`Starting email account creation for ${requestedEmail}`);
        creationLog.push(`Starting email account creation for ${requestedEmail}`);

        // Generate temporary password
        const tempPassword = crypto.randomBytes(8).toString('hex');
        creationLog.push(`Generated temporary password`);

        // Note: We use virtual mail users (vmail uid/gid 5000), not system users
        // All authentication goes through Dovecot's static passdb with shared password
        // No system user creation needed - keeps things consistent with other email accounts

        // Create mailbox directory with proper permissions (using vmail user for virtual mailboxes)
        // Use email address format for mailbox path (matches Dovecot expectations)
        console.log(`Creating mailbox directory for ${requestedEmail}...`);
        creationLog.push(`Creating mailbox directory for ${requestedEmail}...`);
        await execAsync(`sudo rm -f "/var/mail/${requestedEmail}"`); // Remove if it's a file
        await execAsync(`sudo mkdir -p "/var/mail/${requestedEmail}/{cur,new,tmp}" && sudo chown -R vmail:vmail "/var/mail/${requestedEmail}" && sudo chmod -R 700 "/var/mail/${requestedEmail}"`);
        creationLog.push(`✓ Mailbox directory created with proper Maildir structure and vmail ownership`);

        // Add to virtual mailbox maps (use email address format, not username)
        console.log(`Adding ${requestedEmail} to virtual mailbox maps...`);
        creationLog.push(`Adding ${requestedEmail} to virtual mailbox maps...`);
        await execAsync(`sudo bash -c 'echo "${requestedEmail}    ${requestedEmail}/" >> /etc/postfix/virtual_mailbox_maps && sudo postmap /etc/postfix/virtual_mailbox_maps'`);
        creationLog.push(`✓ Added to virtual mailbox maps`);

        // Remove any conflicting virtual aliases
        console.log(`Removing conflicting aliases for ${requestedEmail}...`);
        creationLog.push(`Removing conflicting aliases for ${requestedEmail}...`);
        await execAsync(`sudo sed -i '/^${requestedEmail}.*${serverUsername}$/d' /etc/postfix/virtual && sudo postmap /etc/postfix/virtual`);
        creationLog.push(`✓ Conflicting aliases removed`);

        // Reload Postfix
        console.log(`Reloading Postfix configuration...`);
        creationLog.push(`Reloading Postfix configuration...`);
        await execAsync(`sudo systemctl reload postfix`);
        creationLog.push(`✓ Postfix configuration reloaded`);
        
        console.log(`Virtual mailbox created for ${requestedEmail}`);

        // Encrypt password for database storage (used by webmail)
        const encryptedPassword = emailCrypto.encryptPassword(tempPassword);

        // Add to database with encrypted password
        // server_username = email address (virtual mail user, not system user)
        await db.execute(`
          INSERT INTO server_email_accounts (email_address, server_username, linked_user_id, server_status, email_password_encrypted)
          VALUES (?, ?, ?, 'active', ?)
        `, [requestedEmail, requestedEmail, request.user_id, encryptedPassword]);
        
        // Update user record
        await db.execute(
          'UPDATE users SET company_email = ?, company_email_created_at = NOW() WHERE id = ?',
          [requestedEmail, request.user_id]
        );
        
        // Send setup instructions via direct message
        const setupInstructions = `# 📧 Your @${COMPANY_EMAIL_DOMAIN} Email is Ready!

Hi ${request.requester_name}!

Your request for **${requestedEmail}** has been approved and your email account is now active.

## 📱 Email Setup Instructions

### IMAP Settings (Recommended):
- **Email**: ${requestedEmail}
- **Username**: ${requestedEmail}
- **Password**: \`${tempPassword}\`
- **IMAP Server**: mail.${COMPANY_EMAIL_DOMAIN}
- **IMAP Port**: 993 (SSL/TLS)
- **SMTP Server**: mail.${COMPANY_EMAIL_DOMAIN}  
- **SMTP Port**: 587 (STARTTLS)

### 📧 Supported Email Clients:
- iPhone/iPad Mail
- Apple Mail (macOS)
- Outlook
- Thunderbird
- Gmail app (add as "Other" account)

### 📅 Calendar/CalDAV Access:
Your Nextcloud Calendar account has also been created with the same credentials:
- **URL**: https://calendar.${COMPANY_EMAIL_DOMAIN}
- **Username**: ${requestedEmail.split('@')[0]}
- **Password**: \`${tempPassword}\`

### 🔐 Security Note:
When you change your password on the Intranet, your email and calendar passwords will automatically sync.

### 📞 Need Help?
Contact an admin if you need assistance setting up your email client.

**Welcome to the team!** 🎉`;

        // Find or create conversation with user
        const [conversations] = await db.execute(`
          SELECT id FROM dm_conversations 
          WHERE (user1_id = 1 AND user2_id = ?) OR (user1_id = ? AND user2_id = 1)
        `, [request.user_id, request.user_id]);
        
        let conversationId;
        if (conversations.length > 0) {
          conversationId = conversations[0].id;
        } else {
          const [newConv] = await db.execute(
            'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
            [1, request.user_id]
          );
          conversationId = newConv.insertId;
        }
        
        // Send setup message
        const setupHtml = markdownToHtml(setupInstructions);
        await db.execute(`
          INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
          VALUES (?, ?, ?, ?, ?)
        `, [conversationId, 1, request.user_id, setupInstructions, setupHtml]);
        
        // Also send email notification with setup instructions
        try {
          const emailSubject = `Your @${COMPANY_EMAIL_DOMAIN} Email Account is Ready! 📧`;
          const emailText = `Hi ${request.requester_name}!

Your request for ${requestedEmail} has been approved and your email account is now active.

EMAIL SETUP INSTRUCTIONS:

IMAP Settings (Recommended):
- Email: ${requestedEmail}
- Username: ${requestedEmail}
- Password: ${tempPassword}
- IMAP Server: mail.${COMPANY_EMAIL_DOMAIN}
- IMAP Port: 993 (SSL/TLS)
- SMTP Server: mail.${COMPANY_EMAIL_DOMAIN}
- SMTP Port: 587 (STARTTLS)

Supported Email Clients:
- iPhone/iPad Mail
- Apple Mail (macOS)
- Outlook
- Thunderbird
- Gmail app (add as "Other" account)

Security Note: Please change your password after first login.

Need help? Contact an admin for assistance.

Welcome to the team!

Best regards,
${SITE_TEAM}`;

          const emailHtml = `
            <h2>Your @${COMPANY_EMAIL_DOMAIN} Email Account is Ready! 📧</h2>
            <p>Hi ${request.requester_name}!</p>
            <p>Your request for <strong>${requestedEmail}</strong> has been approved and your email account is now active.</p>
            
            <h3>📱 Email Setup Instructions</h3>
            
            <h4>IMAP Settings (Recommended):</h4>
            <ul>
              <li><strong>Email</strong>: ${requestedEmail}</li>
              <li><strong>Username</strong>: ${username}-${MAIL_USER_SUFFIX}</li>
              <li><strong>Password</strong>: <code>${tempPassword}</code></li>
              <li><strong>IMAP Server</strong>: mail.${COMPANY_EMAIL_DOMAIN}</li>
              <li><strong>IMAP Port</strong>: 993 (SSL/TLS)</li>
              <li><strong>SMTP Server</strong>: mail.${COMPANY_EMAIL_DOMAIN}</li>
              <li><strong>SMTP Port</strong>: 587 (STARTTLS)</li>
            </ul>
            
            <h4>📧 Supported Email Clients:</h4>
            <ul>
              <li>iPhone/iPad Mail</li>
              <li>Apple Mail (macOS)</li>
              <li>Outlook</li>
              <li>Thunderbird</li>
              <li>Gmail app (add as "Other" account)</li>
            </ul>
            
            <p><strong>🔐 Security Note:</strong> Please change your password after first login.</p>
            <p><strong>📞 Need Help?</strong> Contact an admin for assistance.</p>
            <p><strong>Welcome to the team!</strong> 🎉</p>
            <hr>
            <p>Best regards,<br>${SITE_TEAM}</p>
          `;

          // Send email notification
          await sendEmail(request.requester_email, emailSubject, emailText, emailHtml);
          console.log(`Setup email sent to ${request.requester_email}`);
          
        } catch (emailError) {
          console.error('Failed to send email notification:', emailError);
        }
        
        // Validate email delivery works by sending a test message
        console.log(`Testing email delivery for ${requestedEmail}...`);
        creationLog.push(`Testing email delivery for ${requestedEmail}...`);

        // Create timestamp marker
        await execAsync(`sudo touch /tmp/email_test_start`);

        // Send test message
        const testMessageId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await execAsync(`echo 'Subject: Account Setup Complete - Test Message ${testMessageId}' | sudo -u ubuntu sendmail ${requestedEmail}`);
        creationLog.push(`Test message sent with ID ${testMessageId}`);

        // Wait 5 seconds for delivery
        await new Promise(resolve => setTimeout(resolve, 5000));
        creationLog.push(`Waited 5 seconds for delivery`);

        // Check if the test message was delivered by looking for new files in the mailbox
        const deliveryCheck = await execAsync(`sudo find "/var/mail/${requestedEmail}/new" "/var/mail/${requestedEmail}/cur" -type f -newer /tmp/email_test_start 2>/dev/null | wc -l || echo '0'`);
        const deliveredCount = parseInt(deliveryCheck.stdout.trim());
        
        if (deliveredCount === 0) {
          creationLog.push(`✗ Email delivery validation failed - no test message delivered`);
          throw new Error(`Email delivery validation failed - no test message delivered to ${requestedEmail}. Creation log: ${creationLog.join(' | ')}`);
        }
        
        console.log(`Email delivery validated successfully - ${deliveredCount} message(s) delivered`);
        creationLog.push(`✓ Email delivery validated successfully - ${deliveredCount} message(s) delivered`);
        
        console.log(`Email account ${requestedEmail} created and validated successfully with password ${tempPassword}`);
        creationLog.push(`✓ Email account ${requestedEmail} created and validated successfully`);

        // Create Nextcloud/CalDAV account with the same password
        try {
          const nextcloudUsername = requestedEmail.split('@')[0];
          console.log(`Creating Nextcloud account for ${nextcloudUsername}...`);
          creationLog.push(`Creating Nextcloud account for ${nextcloudUsername}...`);

          // Check if Nextcloud user already exists
          try {
            await execAsync(`sudo -u www-data php /var/www/nextcloud/occ user:info "${nextcloudUsername}" 2>/dev/null`);
            // User exists - just reset password
            await execAsync(`sudo OC_PASS='${tempPassword.replace(/'/g, "'\\''")}' -u www-data php /var/www/nextcloud/occ user:resetpassword --password-from-env "${nextcloudUsername}"`);
            creationLog.push(`✓ Nextcloud user ${nextcloudUsername} already exists - password synced`);
            console.log(`✅ Nextcloud password synced for existing user: ${nextcloudUsername}`);
          } catch {
            // User doesn't exist - create it
            await execAsync(`sudo OC_PASS='${tempPassword.replace(/'/g, "'\\''")}' -u www-data php /var/www/nextcloud/occ user:add --password-from-env --display-name="${request.requester_name.replace(/"/g, '\\"')}" "${nextcloudUsername}"`);
            creationLog.push(`✓ Nextcloud user ${nextcloudUsername} created`);
            console.log(`✅ Nextcloud user created: ${nextcloudUsername}`);
          }
        } catch (nextcloudError) {
          console.error(`Failed to create Nextcloud account:`, nextcloudError);
          creationLog.push(`⚠ Nextcloud account creation failed (non-blocking): ${nextcloudError.message}`);
          // Don't fail the entire process if Nextcloud creation fails
        }

      } catch (createError) {
        console.error('Failed to create email account:', createError);
        
        // Update database to reflect email creation failure
        await db.execute(`
          UPDATE server_email_accounts 
          SET server_status = 'creation_failed' 
          WHERE email_address = ?
        `, [request.requested_email]);
        
        // Update email request rejection reason to show creation failure
        // Note: Keep status as 'approved' since admin approved it, but track failure in rejection_reason
        await db.execute(`
          UPDATE email_requests
          SET rejection_reason = ?
          WHERE id = ?
        `, [`Email account creation failed: ${createError.message}`, id]);
        
        return res.status(500).json({ 
          message: 'Request approved but email account creation failed',
          error: createError.message,
          account_created: false
        });
      }
    }
    
    res.json({ 
      message: `Request ${status}`,
      account_created: status === 'approved' ? true : false
    });
  } catch (error) {
    console.error('Update email request error:', error);
    res.status(500).json({ error: 'Failed to update request' });
  }
});

/*
// TEMPORARILY DISABLED - COMPLEX NOTIFICATION CODE
// Will re-enable after fixing core issue

    // Get request and user details for notification
    const [requests] = await db.execute(`
      SELECT er.user_id, er.requested_email, u.name, u.email 
      FROM email_requests er
      JOIN users u ON er.user_id = u.id
      WHERE er.id = ?
    `, [id]);
    
    if (requests.length > 0) {
      const request = requests[0];
      
      // Database notification
      await db.execute(
        'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
        [
          request.user_id,
          'email_request_' + status,
          `Email Request ${status === 'approved' ? 'Approved' : 'Rejected'}`,
          `Your request for ${request.requested_email} has been ${status}`
        ]
      );

      // Send email confirmation
      try {
        const emailSubject = `Email Request ${status === 'approved' ? 'Approved' : 'Rejected'} - ${SITE_NAME}`;
        const emailText = status === 'approved' 
          ? `Great news! Your request for ${request.requested_email} has been approved.

Please contact your system administrator to complete the email setup.

Best regards,
${SITE_TEAM}`
          : `Your request for ${request.requested_email} has been rejected.

${rejection_reason ? `Reason: ${rejection_reason}` : ''}

You can submit a new request with additional justification if needed.

Best regards,
${SITE_TEAM}`;

        const emailHtml = status === 'approved'
          ? `<h2>Email Request Approved! 🎉</h2>
             <p>Great news! Your request for <strong>${request.requested_email}</strong> has been approved.</p>
             <p>Please contact your system administrator to complete the email setup.</p>
             <hr>
             <p>Best regards,<br>${SITE_TEAM}</p>`
          : `<h2>Email Request Update</h2>
             <p>Your request for <strong>${request.requested_email}</strong> has been rejected.</p>
             ${rejection_reason ? `<p><strong>Reason:</strong> ${rejection_reason}</p>` : ''}
             <p>You can submit a new request with additional justification if needed.</p>
             <p><a href="${process.env.BASE_URL}/email-request">Submit New Request</a></p>
             <hr>
             <p>Best regards,<br>${SITE_TEAM}</p>`;

        // await sendEmail(request.email, emailSubject, emailText, emailHtml);
        console.log(`Email notification skipped for debugging - ${status} request for ${request.email}`);
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError);
        // Don't fail the request if email fails
      }
*/

// ===================== EMAIL MANAGEMENT ENDPOINTS =====================

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Get all server email accounts
app.get('/api/admin/email/server-accounts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get accounts from actual mail server
    let serverAccounts = [];
    try {
      const { stdout } = await execAsync(`getent passwd | grep -- "-${MAIL_USER_SUFFIX}$" | cut -d: -f1`);
      serverAccounts = stdout.trim().split('\n').filter(account => account.trim());
    } catch (sshError) {
      console.warn('SSH to mail server failed, using local accounts:', sshError.message);
      // Fallback to local system users if SSH fails
      const { stdout } = await execAsync(`getent passwd | grep -- "-${MAIL_USER_SUFFIX}$" | cut -d: -f1`);
      serverAccounts = stdout.trim().split('\n').filter(account => account.trim());
    }

    // Sync server accounts with database
    for (const serverUsername of serverAccounts) {
      const emailAddress = serverUsername.replace(`-${COMPANY_SHORT_NAME.toLowerCase()}`, '') + `@${COMPANY_EMAIL_DOMAIN}`;
      
      // Check disk usage
      let diskUsage = 0;
      try {
        const { stdout } = await execAsync(`sudo du -s /var/mail/${serverUsername} 2>/dev/null || echo "0"`);
        diskUsage = Math.round(parseInt(stdout.split('\t')[0]) / 1024); // Convert to MB
      } catch (duError) {
        // Ignore disk usage errors
      }

      // Check last login (last access to mail file)
      let lastLogin = null;
      try {
        const { stdout } = await execAsync(`stat -c %Y /var/mail/${serverUsername} 2>/dev/null || echo "0"`);
        const timestamp = parseInt(stdout.trim());
        if (timestamp > 0) {
          lastLogin = new Date(timestamp * 1000);
        }
      } catch (statError) {
        // Ignore stat errors
      }

      // Insert or update server account
      await db.execute(`
        INSERT INTO server_email_accounts (email_address, server_username, disk_usage_mb, last_login)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          disk_usage_mb = VALUES(disk_usage_mb),
          last_login = VALUES(last_login),
          updated_at = CURRENT_TIMESTAMP
      `, [emailAddress, serverUsername, diskUsage, lastLogin]);
    }

    // Get comprehensive view from database
    const [accounts] = await db.execute(`
      SELECT * FROM email_management_overview ORDER BY email_address
    `);

    res.json(accounts);
  } catch (error) {
    console.error('Server accounts error:', error);
    res.status(500).json({ error: 'Failed to fetch server accounts' });
  }
});

// Health check endpoint for email accounts
app.get('/api/admin/email/health-check', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [accounts] = await db.execute(`
      SELECT email_address, server_username, server_status, created_at 
      FROM server_email_accounts 
      WHERE server_status = 'active'
      ORDER BY email_address
    `);

    const healthResults = [];

    for (const account of accounts) {
      const { email_address, server_username } = account;
      const health = {
        email_address,
        server_username,
        mailbox_exists: false,
        mailbox_ownership: 'unknown',
        delivery_test: 'not_tested',
        postfix_mapping: false,
        last_checked: new Date().toISOString()
      };

      try {
        // Check if mailbox directory exists
        await execAsync(`test -d /var/mail/${server_username}`);
        health.mailbox_exists = true;

        // Check mailbox ownership
        const { stdout: ownerInfo } = await execAsync(`stat -c '%U:%G' /var/mail/${server_username}`);
        health.mailbox_ownership = ownerInfo.trim();

        // Check Postfix virtual mailbox mapping
        await execAsync(`grep -q '^${email_address}' /etc/postfix/virtual_mailbox_maps`);
        health.postfix_mapping = true;

        // Test delivery by sending a test message
        const testId = `health-${Date.now()}`;
        await execAsync(`sudo touch /tmp/health_test_start`);
        await execAsync(`echo 'Subject: Health Check ${testId}' | sudo -u ubuntu sendmail ${email_address}`);
        
        // Wait for delivery and check
        await new Promise(resolve => setTimeout(resolve, 3000));
        const { stdout: deliveredCount } = await execAsync(`sudo find /var/mail/${server_username}/new /var/mail/${server_username}/cur -type f -newer /tmp/health_test_start 2>/dev/null | wc -l || echo '0'`);
        
        health.delivery_test = parseInt(deliveredCount.trim()) > 0 ? 'success' : 'failed';

      } catch (error) {
        health.error = error.message;
        console.error(`Health check failed for ${email_address}:`, error.message);
      }

      healthResults.push(health);
    }

    // Update database with health status
    for (const result of healthResults) {
      const status = (result.mailbox_exists && result.postfix_mapping && result.delivery_test === 'success') ? 'healthy' : 'unhealthy';
      await db.execute(`
        UPDATE server_email_accounts 
        SET server_status = ?, updated_at = NOW() 
        WHERE email_address = ?
      `, [status, result.email_address]);
    }

    res.json({
      checked_at: new Date().toISOString(),
      total_accounts: healthResults.length,
      healthy_accounts: healthResults.filter(r => r.delivery_test === 'success').length,
      results: healthResults
    });

  } catch (error) {
    console.error('Email health check error:', error);
    res.status(500).json({ error: 'Failed to perform health check' });
  }
});

// Repair broken email account
app.post('/api/admin/email/repair/:email_address', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email_address } = req.params;
    
    // Get account details
    const [accounts] = await db.execute(`
      SELECT * FROM server_email_accounts WHERE email_address = ?
    `, [email_address]);
    
    if (accounts.length === 0) {
      return res.status(404).json({ error: 'Email account not found' });
    }
    
    const account = accounts[0];
    const { server_username } = account;
    const repairLog = [];

    try {
      // Step 1: Ensure mailbox directory exists with correct structure
      repairLog.push('Creating/fixing mailbox directory...');
      await execAsync(`sudo rm -f /var/mail/${server_username}`); // Remove if it's a file
      await execAsync(`sudo mkdir -p /var/mail/${server_username}/{cur,new,tmp}`);
      await execAsync(`sudo chown -R vmail:vmail /var/mail/${server_username}`);
      await execAsync(`sudo chmod -R 700 /var/mail/${server_username}`);
      repairLog.push('✓ Mailbox directory created with proper permissions');

      // Step 2: Ensure virtual mailbox mapping exists
      repairLog.push('Checking/adding virtual mailbox mapping...');
      try {
        await execAsync(`grep -q '^${email_address}' /etc/postfix/virtual_mailbox_maps`);
        repairLog.push('✓ Virtual mailbox mapping already exists');
      } catch {
        await execAsync(`sudo bash -c 'echo \"${email_address}    ${server_username}/\" >> /etc/postfix/virtual_mailbox_maps && sudo postmap /etc/postfix/virtual_mailbox_maps'`);
        repairLog.push('✓ Virtual mailbox mapping added');
      }

      // Step 3: Remove conflicting virtual aliases
      repairLog.push('Removing conflicting virtual aliases...');
      const aliasRemoved = await execAsync(`sudo sed -i '/^${email_address}.*${server_username}$/d' /etc/postfix/virtual && sudo postmap /etc/postfix/virtual`);
      repairLog.push('✓ Conflicting aliases removed');

      // Step 4: Reload Postfix
      repairLog.push('Reloading Postfix configuration...');
      await execAsync(`sudo systemctl reload postfix`);
      repairLog.push('✓ Postfix configuration reloaded');

      // Step 5: Test delivery
      repairLog.push('Testing email delivery...');
      await execAsync(`sudo touch /tmp/repair_test_start`);
      const testId = `repair-${Date.now()}`;
      await execAsync(`echo 'Subject: Repair Test ${testId}' | sudo -u ubuntu sendmail ${email_address}`);
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const { stdout: deliveredCount } = await execAsync(`sudo find /var/mail/${server_username}/new /var/mail/${server_username}/cur -type f -newer /tmp/repair_test_start 2>/dev/null | wc -l || echo '0'`);
      
      if (parseInt(deliveredCount.trim()) > 0) {
        repairLog.push('✓ Email delivery test successful');
        
        // Update database status
        await db.execute(`
          UPDATE server_email_accounts 
          SET server_status = 'active', updated_at = NOW() 
          WHERE email_address = ?
        `, [email_address]);
        
        repairLog.push('✓ Database status updated to active');
        
        res.json({
          success: true,
          message: 'Email account repaired successfully',
          email_address,
          repair_log: repairLog
        });
      } else {
        repairLog.push('✗ Email delivery test failed');
        res.status(500).json({
          success: false,
          message: 'Repair completed but delivery test failed',
          email_address,
          repair_log: repairLog
        });
      }

    } catch (repairError) {
      repairLog.push(`✗ Repair failed: ${repairError.message}`);
      
      // Update database to reflect repair failure
      await db.execute(`
        UPDATE server_email_accounts 
        SET server_status = 'repair_failed', updated_at = NOW() 
        WHERE email_address = ?
      `, [email_address]);

      res.status(500).json({
        success: false,
        message: 'Email account repair failed',
        email_address,
        error: repairError.message,
        repair_log: repairLog
      });
    }

  } catch (error) {
    console.error('Repair endpoint error:', error);
    res.status(500).json({ error: 'Failed to repair email account' });
  }
});


// Check email username availability
app.post('/api/email/check-availability', authenticateToken, [
  body('username').matches(/^[a-zA-Z0-9._\-]+$/).isLength({ min: 2, max: 20 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { username } = req.body;
    const emailAddress = `${username}@${COMPANY_EMAIL_DOMAIN}`;
    const serverUsername = `${username}-${MAIL_USER_SUFFIX}`;

    // Check database
    const [existing] = await db.execute(
      'SELECT id FROM server_email_accounts WHERE email_address = ? OR server_username = ?',
      [emailAddress, serverUsername]
    );

    // Check system users
    try {
      await execAsync(`getent passwd ${serverUsername}`);
      return res.json({ available: false, reason: 'Username already exists on server' });
    } catch (getentError) {
      // User doesn't exist, which is good
    }

    const available = existing.length === 0;
    res.json({ 
      available, 
      email_address: emailAddress,
      reason: available ? null : 'Email address already taken'
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// Create email account with user-chosen username
app.post('/api/admin/email/create-account', authenticateToken, requireAdmin, [
  body('user_id').isInt(),
  body('username').matches(/^[a-zA-Z0-9._\-]+$/).isLength({ min: 2, max: 20 }),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { user_id, username, password } = req.body;
    const emailAddress = `${username}@${COMPANY_EMAIL_DOMAIN}`;
    const serverUsername = `${username}-${MAIL_USER_SUFFIX}`;

    // Verify availability
    const [existing] = await db.execute(
      'SELECT id FROM server_email_accounts WHERE email_address = ? OR server_username = ?',
      [emailAddress, serverUsername]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email address already exists' });
    }

    // Create system user
    const hashedPassword = await bcrypt.hash(password, 12);
    await execAsync(`sudo useradd -m -s /bin/bash ${serverUsername}`);
    await execAsync(`echo '${serverUsername}:${password}' | sudo chpasswd`);

    // Add to database
    const [result] = await db.execute(`
      INSERT INTO server_email_accounts (email_address, server_username, linked_user_id, server_status)
      VALUES (?, ?, ?, 'active')
    `, [emailAddress, serverUsername, user_id]);

    // Update user record
    await db.execute(
      'UPDATE users SET company_email = ?, email_server_status = ? WHERE id = ?',
      [emailAddress, 'active', user_id]
    );

    // Log the action
    await db.execute(`
      INSERT INTO email_account_logs (email_address, action, performed_by, details)
      VALUES (?, 'created', ?, ?)
    `, [emailAddress, req.user.userId, JSON.stringify({ server_username: serverUsername })]);

    // Notify user
    await db.execute(
      'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
      [
        user_id,
        'email_created',
        'Email Account Created',
        `Your @${COMPANY_EMAIL_DOMAIN} email account ${emailAddress} has been created`,
        JSON.stringify({ email: emailAddress, setup_required: true })
      ]
    );

    res.status(201).json({ 
      message: 'Email account created successfully',
      email_address: emailAddress,
      account_id: result.insertId
    });
  } catch (error) {
    console.error('Create account error:', error);
    res.status(500).json({ error: 'Failed to create email account' });
  }
});

// Link orphaned account to user
app.post('/api/admin/email/link-account', authenticateToken, requireAdmin, [
  body('account_id').isInt(),
  body('user_id').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { account_id, user_id } = req.body;

    // Get account details
    const [accounts] = await db.execute(
      'SELECT email_address FROM server_email_accounts WHERE id = ?',
      [account_id]
    );

    if (accounts.length === 0) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const emailAddress = accounts[0].email_address;

    // Link account
    await db.execute(
      'UPDATE server_email_accounts SET linked_user_id = ? WHERE id = ?',
      [user_id, account_id]
    );

    // Update user record
    await db.execute(
      'UPDATE users SET company_email = ?, email_server_status = ? WHERE id = ?',
      [emailAddress, 'active', user_id]
    );

    // Log the action
    await db.execute(`
      INSERT INTO email_account_logs (email_address, action, performed_by, details)
      VALUES (?, 'linked', ?, ?)
    `, [emailAddress, req.user.userId, JSON.stringify({ linked_user_id: user_id })]);

    res.json({ message: 'Account linked successfully' });
  } catch (error) {
    console.error('Link account error:', error);
    res.status(500).json({ error: 'Failed to link account' });
  }
});

// Mail server health check
app.get('/api/admin/email/server-status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = {
      postfix: 'unknown',
      dovecot: 'unknown',
      disk_usage: 0,
      total_accounts: 0,
      active_accounts: 0
    };

    // Check Postfix
    try {
      await execAsync('sudo systemctl is-active postfix');
      status.postfix = 'active';
    } catch (error) {
      status.postfix = 'inactive';
    }

    // Check Dovecot
    try {
      await execAsync('sudo systemctl is-active dovecot');
      status.dovecot = 'active';
    } catch (error) {
      status.dovecot = 'inactive';
    }

    // Get disk usage
    try {
      const { stdout } = await execAsync('du -sh /var/mail | cut -f1');
      status.disk_usage = stdout.trim();
    } catch (error) {
      status.disk_usage = 'unknown';
    }

    // Get account counts
    const [accountCounts] = await db.execute(`
      SELECT 
        COUNT(*) as total_accounts,
        SUM(CASE WHEN server_status = 'active' THEN 1 ELSE 0 END) as active_accounts
      FROM server_email_accounts
    `);

    if (accountCounts.length > 0) {
      status.total_accounts = accountCounts[0].total_accounts;
      status.active_accounts = accountCounts[0].active_accounts;
    }

    res.json(status);
  } catch (error) {
    console.error('Server status error:', error);
    res.status(500).json({ error: 'Failed to get server status' });
  }
});

// ===================== GROUPS MANAGEMENT ENDPOINTS =====================

// Get all groups
app.get('/api/admin/groups', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [groups] = await db.execute(`
      SELECT g.*, 
             u.name as created_by_name,
             COUNT(gm.id) as member_count
      FROM \`groups\` g
      LEFT JOIN users u ON g.created_by = u.id
      LEFT JOIN group_members gm ON g.id = gm.group_id
      GROUP BY g.id
      ORDER BY g.is_active DESC, g.name
    `);
    
    res.json(groups);
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Create new group
app.post('/api/admin/groups', authenticateToken, requireAdmin, [
  body('name').matches(/^[a-zA-Z0-9_\-]+$/).isLength({ min: 2, max: 50 }),
  body('display_name').isLength({ min: 2, max: 100 }),
  body('description').optional().isLength({ max: 500 }),
  body('email_alias').optional({ values: 'falsy' }).custom((value) => {
    if (value && COMPANY_EMAIL_DOMAIN) {
      const pattern = new RegExp(`^[a-zA-Z0-9._\\-]+@${COMPANY_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`);
      if (!value.match(pattern)) {
        throw new Error(`Email alias must end with @${COMPANY_EMAIL_DOMAIN} and contain only alphanumeric characters, dots, underscores, and dashes`);
      }
    }
    return true;
  })
], async (req, res) => {
  console.log('Group creation request body:', req.body);
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Group creation validation errors:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { name, display_name, description, email_alias, members = [] } = req.body;
    
    // Check if group name already exists
    let query = 'SELECT id FROM \`groups\` WHERE name = ?';
    let params = [name];
    
    // Only check email_alias if it's provided
    if (email_alias && email_alias.trim()) {
      query += ' OR email_alias = ?';
      params.push(email_alias);
    }
    
    const [existing] = await db.execute(query, params);
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Group name or email alias already exists' });
    }

    // Check if email alias is available on the system
    if (email_alias) {
      const username = email_alias.split('@')[0];
      const serverUsername = `${username}-${MAIL_USER_SUFFIX}`;
      
      try {
        await execAsync(`getent passwd ${serverUsername}`);
        return res.status(400).json({ error: 'Email alias conflicts with existing system user' });
      } catch (getentError) {
        // Good - user doesn't exist
      }
    }

    // Create the group
    const [result] = await db.execute(`
      INSERT INTO \`groups\` (name, display_name, description, email_alias, created_by)
      VALUES (?, ?, ?, ?, ?)
    `, [name, display_name, description, email_alias || null, req.user.userId]);
    
    const groupId = result.insertId;

    // Add members to the group
    for (const userId of members) {
      await db.execute(`
        INSERT INTO group_members (group_id, user_id, added_by)
        VALUES (?, ?, ?)
      `, [groupId, userId, req.user.userId]);
    }

    // If this group has an email alias, create the email account and alias
    if (email_alias) {
      try {
        // Get company emails for group members (fallback to personal email if none)
        const [memberEmails] = await db.execute(`
          SELECT COALESCE(company_email, email) as email FROM users WHERE id IN (${members.map(() => '?').join(',')})
        `, members);
        
        const emailList = memberEmails.map(row => row.email).join(', ');
        
        // Update Postfix virtual alias map on correct mail server
        const aliasLine = `${email_alias}        ${emailList}`;
        
        await execAsync(`sudo bash -c 'echo \\"${aliasLine}\\" >> /etc/postfix/virtual && sudo postmap /etc/postfix/virtual && sudo systemctl reload postfix'`);
        
        console.log(`Email alias ${email_alias} created on mail server for group`);
        
      } catch (emailError) {
        console.error('Email alias creation failed:', emailError);
        // Don't fail the group creation, just log the error
      }
    }

    res.json({ 
      id: groupId, 
      message: 'Group created successfully',
      email_alias: email_alias
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Get group members
app.get('/api/admin/groups/:groupId/members', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { groupId } = req.params;
    
    const [members] = await db.execute(`
      SELECT gm.*, u.name, u.email, u.avatar_url, u.github_username,
             added_by_user.name as added_by_name
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
      LEFT JOIN users added_by_user ON gm.added_by = added_by_user.id
      WHERE gm.group_id = ?
      ORDER BY u.name
    `, [groupId]);
    
    res.json(members);
  } catch (error) {
    console.error('Get group members error:', error);
    res.status(500).json({ error: 'Failed to fetch group members' });
  }
});

// Add member to group
app.post('/api/admin/groups/:groupId/members', authenticateToken, requireAdmin, [
  body('user_id').isInt(),
  body('role').optional().isIn(['member', 'moderator', 'admin'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { groupId } = req.params;
    const { user_id, role = 'member' } = req.body;
    
    // Check if user is already a member
    const [existing] = await db.execute(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, user_id]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'User is already a member of this group' });
    }

    // Add the member
    await db.execute(`
      INSERT INTO group_members (group_id, user_id, role, added_by)
      VALUES (?, ?, ?, ?)
    `, [groupId, user_id, role, req.user.userId]);

    // Update email alias if group has one
    const [group] = await db.execute('SELECT email_alias FROM \`groups\` WHERE id = ?', [groupId]);
    if (group.length > 0 && group[0].email_alias) {
      try {
        // Get all current members for the alias update
        const [allMembers] = await db.execute(`
          SELECT COALESCE(u.company_email, u.email) as email FROM group_members gm
          JOIN users u ON gm.user_id = u.id
          WHERE gm.group_id = ?
        `, [groupId]);
        
        const memberEmails = allMembers.map(m => m.email).join(', ');
        
        // Update Postfix virtual alias on correct mail server
        const aliasLine = `${group[0].email_alias}        ${memberEmails}`;
        
        // Remove existing alias and add updated one on mail server
        await execAsync(`sudo bash -c 'grep -v \\"^${group[0].email_alias}\\" /etc/postfix/virtual > /tmp/virtual_clean && echo \\"${aliasLine}\\" >> /tmp/virtual_clean && sudo mv /tmp/virtual_clean /etc/postfix/virtual && sudo postmap /etc/postfix/virtual && sudo systemctl reload postfix'`);
        
        console.log(`Email alias ${group[0].email_alias} updated on mail server`);
        
      } catch (emailError) {
        console.error('Email alias update failed:', emailError);
      }
    }

    res.json({ message: 'Member added successfully' });
  } catch (error) {
    console.error('Add group member error:', error);
    res.status(500).json({ error: 'Failed to add member to group' });
  }
});

// Remove member from group
app.delete('/api/admin/groups/:groupId/members/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { groupId, userId } = req.params;
    
    // Remove the member
    await db.execute(
      'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );

    // Update email alias if group has one
    const [group] = await db.execute('SELECT email_alias FROM \`groups\` WHERE id = ?', [groupId]);
    if (group.length > 0 && group[0].email_alias) {
      try {
        // Get remaining members for the alias update
        const [remainingMembers] = await db.execute(`
          SELECT COALESCE(u.company_email, u.email) as email FROM group_members gm
          JOIN users u ON gm.user_id = u.id
          WHERE gm.group_id = ?
        `, [groupId]);
        
        const memberEmails = remainingMembers.map(m => m.email).join(', ');
        
        // Update Postfix virtual alias on correct mail server
        const aliasLine = `${group[0].email_alias}        ${memberEmails}`;
        
        // Remove existing alias and add updated one on mail server
        await execAsync(`sudo bash -c 'grep -v \\"^${group[0].email_alias}\\" /etc/postfix/virtual > /tmp/virtual_clean && echo \\"${aliasLine}\\" >> /tmp/virtual_clean && sudo mv /tmp/virtual_clean /etc/postfix/virtual && sudo postmap /etc/postfix/virtual && sudo systemctl reload postfix'`);
        
        console.log(`Email alias ${group[0].email_alias} updated on mail server`);
        
      } catch (emailError) {
        console.error('Email alias update failed:', emailError);
      }
    }

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove group member error:', error);
    res.status(500).json({ error: 'Failed to remove member from group' });
  }
});

// Update group
app.put('/api/admin/groups/:groupId', authenticateToken, requireAdmin, [
  body('display_name').optional().isLength({ min: 2, max: 100 }),
  body('description').optional().isLength({ max: 500 }),
  body('is_active').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { groupId } = req.params;
    const { display_name, description, is_active } = req.body;
    
    const updates = [];
    const values = [];
    
    if (display_name !== undefined) {
      updates.push('display_name = ?');
      values.push(display_name);
    }
    
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(is_active);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    values.push(groupId);
    
    await db.execute(
      `UPDATE \`groups\` SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );

    res.json({ message: 'Group updated successfully' });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// Delete group
app.delete('/api/admin/groups/:groupId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { groupId } = req.params;
    
    // Get group info before deletion
    const [group] = await db.execute('SELECT name, email_alias FROM \`groups\` WHERE id = ?', [groupId]);
    
    if (group.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Remove email alias if it exists
    if (group[0].email_alias) {
      try {
        await execAsync(`sudo sed -i '/^${group[0].email_alias}/d' /etc/postfix/virtual`);
        await execAsync('sudo postmap /etc/postfix/virtual');
        await execAsync('sudo systemctl reload postfix');
      } catch (emailError) {
        console.error('Email alias removal failed:', emailError);
      }
    }

    // Delete the group (this will cascade delete members due to foreign key)
    await db.execute('DELETE FROM \`groups\` WHERE id = ?', [groupId]);

    res.json({ message: `Group "${group[0].name}" deleted successfully` });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// ===================== FORUM ENDPOINTS =====================

// Replace a post's co-editor list. Editors can always read the post, so on a
// restricted post they also get an explicit visibility grant.
async function setPostEditors(postId, editorUsers, grantedBy, visibility) {
  const ids = [...new Set((editorUsers || [])
    .map(u => parseInt(u, 10))
    .filter(u => Number.isInteger(u) && u > 0))];

  await db.execute('DELETE FROM post_editors WHERE post_id = ?', [postId]);

  for (const userId of ids) {
    await db.execute(
      'INSERT INTO post_editors (post_id, user_id, granted_by) VALUES (?, ?, ?)',
      [postId, userId, grantedBy]
    );

    if (visibility === 'specific_members') {
      await db.execute(
        'INSERT IGNORE INTO post_visibility (post_id, user_id, granted_by) VALUES (?, ?, ?)',
        [postId, userId, grantedBy]
      );
    }
  }

  return ids;
}

// True if the user may edit the post body: the author, an admin, or a co-editor.
async function canEditPost(post, user) {
  if (!user) return false;
  if (post.user_id === user.userId || user.role === 'admin') return true;

  const [rows] = await db.execute(
    'SELECT 1 FROM post_editors WHERE post_id = ? AND user_id = ?',
    [post.id, user.userId]
  );
  return rows.length > 0;
}

// Create post
app.post('/api/posts', authenticateToken, [
  body('title').optional().trim(),
  body('content').optional(),
  body('visibility').optional().isIn(['all_members', 'specific_members', 'author_only']),
  body('visible_to_users').optional().isArray(),
  body('editor_users').optional().isArray()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    let {
      title,
      content,
      tags,
      visibility = 'all_members',
      visible_to_users = [],
      editor_users = [],
      attachment_filename,
      attachment_original_name,
      attachment_mime_type,
      attachment_size
    } = req.body;

    // Custom validation: content is required if no attachment
    if (!attachment_filename && (!content || content.trim().length === 0)) {
      return res.status(400).json({ error: 'Content is required when no attachment is provided' });
    }

    // Auto-populate title from filename if title is empty and attachment exists
    if ((!title || title.trim().length === 0) && attachment_original_name) {
      // Remove file extension for title
      title = attachment_original_name.replace(/\.[^/.]+$/, '');
    }

    // Final validation: title is required
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Set default content if empty but attachment exists
    if (!content && attachment_filename) {
      content = '';
    }

    const slug = generateSlug(title) + '-' + Date.now();
    const contentHtml = markdownToHtml(content || '');

    const [result] = await db.execute(
      'INSERT INTO posts (user_id, title, content, content_html, slug, visibility, attachment_filename, attachment_original_name, attachment_mime_type, attachment_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.userId, title, content, contentHtml, slug, visibility, attachment_filename || null, attachment_original_name || null, attachment_mime_type || null, attachment_size || null]
    );
    
    const postId = result.insertId;
    
    // Process tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        const tagSlug = generateSlug(tagName);

        // Insert or get tag
        await db.execute(
          'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
          [tagName, tagSlug]
        );

        const [tagRows] = await db.execute(
          'SELECT id FROM tags WHERE slug = ?',
          [tagSlug]
        );

        if (tagRows.length > 0) {
          await db.execute(
            'INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)',
            [postId, tagRows[0].id]
          );

          // Update tag usage count
          await db.execute(
            'UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?',
            [tagRows[0].id]
          );
        }
      }
    }

    // Automatically add 'file' tag if post has attachment
    if (attachment_filename) {
      const [fileTag] = await db.execute(
        'SELECT id FROM tags WHERE slug = ?',
        ['file']
      );

      if (fileTag.length > 0) {
        await db.execute(
          'INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          [postId, fileTag[0].id]
        );

        // Update tag usage count
        await db.execute(
          'UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?',
          [fileTag[0].id]
        );
      }
    }

    // Handle specific member visibility
    if (visibility === 'specific_members' && visible_to_users.length > 0) {
      for (const userId of visible_to_users) {
        await db.execute(
          'INSERT INTO post_visibility (post_id, user_id, granted_by) VALUES (?, ?, ?)',
          [postId, parseInt(userId), req.user.userId]
        );
      }
    }

    // Handle co-editors (an editor can always see the post, so grant visibility too)
    await setPostEditors(postId, editor_users, req.user.userId, visibility);

    // Process mentions
    await processMentions(content, 'post', postId, req.user.userId, req.user);
    const agentsSummoned = await agentResponder.handleMentions({
      type: 'post', id: postId, postId, postAuthorId: req.user.userId, content,
      author: { userId: req.user.userId, name: req.user.name }
    });
    
    res.status(201).json({ 
      message: 'Post created',
      postId,
      slug,
      visibility,
      agentsSummoned
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Edit post
app.put('/api/posts/:id', authenticateToken, [
  body('title').optional().trim(),
  body('content').optional(),
  body('visibility').optional().isIn(['all_members', 'specific_members', 'author_only']),
  body('visible_to_users').optional().isArray(),
  body('editor_users').optional().isArray()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    let {
      title,
      content,
      tags,
      visibility = 'all_members',
      visible_to_users = [],
      editor_users,
      attachment_filename,
      attachment_original_name,
      attachment_mime_type,
      attachment_size,
      remove_attachment
    } = req.body;

    // Check if post exists and user has permission to edit
    const [existingPosts] = await db.execute(
      'SELECT * FROM posts WHERE id = ?',
      [id]
    );

    if (existingPosts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = existingPosts[0];

    // Author, admin, or a co-editor can edit
    if (!(await canEditPost(post, req.user))) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Only the author or an admin controls who can see and who can edit the post
    const isOwner = post.user_id === req.user.userId || req.user.role === 'admin';
    if (!isOwner) {
      visibility = post.visibility || 'all_members';
      visible_to_users = [];
      editor_users = undefined;
    }

    // Determine if post will have attachment after update
    const willHaveAttachment = (attachment_filename || (post.attachment_filename && !remove_attachment));

    // Custom validation: content is required if no attachment
    if (!willHaveAttachment && (!content || content.trim().length === 0)) {
      return res.status(400).json({ error: 'Content is required when no attachment is provided' });
    }

    // Auto-populate title from filename if title is empty and attachment exists
    if ((!title || title.trim().length === 0) && attachment_original_name) {
      // Remove file extension for title
      title = attachment_original_name.replace(/\.[^/.]+$/, '');
    } else if ((!title || title.trim().length === 0) && post.attachment_original_name && !remove_attachment) {
      // Use existing attachment name if no new attachment and title is empty
      title = post.attachment_original_name.replace(/\.[^/.]+$/, '');
    }

    // Final validation: title is required
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Set default content if empty but attachment exists
    if (!content && willHaveAttachment) {
      content = '';
    }

    // If old attachment needs to be removed and there's a different file
    if (remove_attachment && post.attachment_filename) {
      const oldFilePath = path.join(__dirname, 'uploads', 'forum-attachments', post.attachment_filename);
      try {
        await fs.unlink(oldFilePath);
      } catch (error) {
        console.error('Failed to delete old attachment:', error);
      }
    }

    // Process content
    const contentHtml = markdownToHtml(content || '');

    // Update post with attachment info
    let updateQuery, updateParams;
    if (remove_attachment) {
      // Clear attachment fields
      updateQuery = 'UPDATE posts SET title = ?, content = ?, content_html = ?, visibility = ?, attachment_filename = NULL, attachment_original_name = NULL, attachment_mime_type = NULL, attachment_size = NULL, updated_at = NOW() WHERE id = ?';
      updateParams = [title, content, contentHtml, visibility, id];
    } else if (attachment_filename) {
      // Update with new attachment
      updateQuery = 'UPDATE posts SET title = ?, content = ?, content_html = ?, visibility = ?, attachment_filename = ?, attachment_original_name = ?, attachment_mime_type = ?, attachment_size = ?, updated_at = NOW() WHERE id = ?';
      updateParams = [title, content, contentHtml, visibility, attachment_filename, attachment_original_name, attachment_mime_type, attachment_size, id];
    } else {
      // Update without changing attachment
      updateQuery = 'UPDATE posts SET title = ?, content = ?, content_html = ?, visibility = ?, updated_at = NOW() WHERE id = ?';
      updateParams = [title, content, contentHtml, visibility, id];
    }

    await db.execute(updateQuery, updateParams);

    // Clear existing tags
    await db.execute('DELETE FROM post_tags WHERE post_id = ?', [id]);

    // Add new tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        const tagSlug = generateSlug(tagName);

        await db.execute(
          'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
          [tagName, tagSlug]
        );

        const [tagRows] = await db.execute(
          'SELECT id FROM tags WHERE slug = ?',
          [tagSlug]
        );

        if (tagRows.length > 0) {
          await db.execute(
            'INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)',
            [id, tagRows[0].id]
          );
        }
      }
    }

    // Automatically add 'file' tag if post has attachment
    if (willHaveAttachment) {
      const [fileTag] = await db.execute(
        'SELECT id FROM tags WHERE slug = ?',
        ['file']
      );

      if (fileTag.length > 0) {
        await db.execute(
          'INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          [id, fileTag[0].id]
        );
      }
    }

    // Update all tag usage counts
    await db.execute(`
      UPDATE tags SET usage_count = (
        SELECT COUNT(*) FROM post_tags WHERE tag_id = tags.id
      )
    `);

    // Handle visibility and co-editor changes (owner-only; a co-editor's save
    // leaves both lists exactly as the author left them)
    if (isOwner) {
      await db.execute('DELETE FROM post_visibility WHERE post_id = ?', [id]);

      if (visibility === 'specific_members' && visible_to_users.length > 0) {
        for (const userId of visible_to_users) {
          await db.execute(
            'INSERT INTO post_visibility (post_id, user_id, granted_by) VALUES (?, ?, ?)',
            [id, parseInt(userId), req.user.userId]
          );
        }
      }

      if (editor_users !== undefined) {
        await setPostEditors(parseInt(id), editor_users, req.user.userId, visibility);
      } else if (visibility === 'specific_members') {
        // Visibility list was just rebuilt — re-grant access to existing editors
        const [existingEditors] = await db.execute(
          'SELECT user_id FROM post_editors WHERE post_id = ?',
          [id]
        );
        for (const row of existingEditors) {
          await db.execute(
            'INSERT IGNORE INTO post_visibility (post_id, user_id, granted_by) VALUES (?, ?, ?)',
            [id, row.user_id, req.user.userId]
          );
        }
      }
    }

    // Process mentions when post is edited
    await processMentions(content, 'post', parseInt(id), req.user.userId, req.user);
    // An agent tagged by this edit is brought in; one already answered is not
    // summoned again (ai_agent_replies is unique per agent + source).
    await agentResponder.handleMentions({
      type: 'post', id: parseInt(id), postId: parseInt(id), postAuthorId: post.user_id, content,
      author: { userId: req.user.userId, name: req.user.name }
    });

    res.json({ 
      message: 'Post updated successfully',
      postId: parseInt(id),
      visibility 
    });
  } catch (error) {
    console.error('Edit post error:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete post
app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if post exists and user has permission to delete
    const [existingPosts] = await db.execute(
      'SELECT * FROM posts WHERE id = ?',
      [id]
    );

    if (existingPosts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = existingPosts[0];

    // Only author or admin can delete
    if (post.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Delete related data first (foreign key constraints)
    await db.execute('DELETE FROM post_tags WHERE post_id = ?', [id]);
    await db.execute('DELETE FROM post_visibility WHERE post_id = ?', [id]);
    await db.execute('DELETE FROM post_editors WHERE post_id = ?', [id]);
    await db.execute('DELETE FROM likes WHERE likeable_type = "post" AND likeable_id = ?', [id]);
    await db.execute('DELETE FROM mentions WHERE mentionable_type = "post" AND mentionable_id = ?', [id]);
    await db.execute('DELETE FROM comments WHERE post_id = ?', [id]);
    
    // Finally delete the post
    await db.execute('DELETE FROM posts WHERE id = ?', [id]);

    console.log(`Post ${id} ("${post.title}") deleted by user ${req.user.userId} (${req.user.role})`);

    res.json({ 
      message: 'Post deleted successfully',
      postId: parseInt(id)
    });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// Get post by ID (for editing)
app.get('/api/posts/id/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [posts] = await db.execute(`
      SELECT p.*, u.name as author_name, u.github_username, u.avatar_url
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [id]);
    
    if (posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const post = posts[0];
    
    // Get tags
    const [tags] = await db.execute(`
      SELECT t.id, t.name, t.slug
      FROM tags t
      JOIN post_tags pt ON t.id = pt.tag_id
      WHERE pt.post_id = ?
    `, [id]);
    
    post.tags = tags;
    
    res.json(post);
  } catch (error) {
    console.error('Get post by ID error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Test endpoint
app.get('/api/test', async (req, res) => {
  try {
    const [result] = await db.execute('SELECT COUNT(*) as count FROM users');
    res.json({ status: 'ok', userCount: result[0].count, message: 'Database connection working' });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ error: 'Database test failed' });
  }
});

// Get posts with pagination and search
app.get('/api/posts', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const userId = req.user?.userId;
    const tagSlug = req.query.tag;

    // Get sort parameter
    const sort = req.query.sort || 'recent';

    // Build ORDER BY clause based on sort
    let orderBy = 'p.created_at DESC';
    switch (sort) {
      case 'popular':
        orderBy = 'score DESC, p.created_at DESC';
        break;
      case 'views':
        orderBy = 'p.view_count DESC, p.created_at DESC';
        break;
      case 'unanswered':
        orderBy = 'comment_count ASC, p.created_at DESC';
        break;
      default:
        orderBy = 'p.created_at DESC';
    }

    // Build query with visibility and tag filtering
    let baseQuery = `
      SELECT p.*,
             u.name as author_name,
             u.github_username,
             u.avatar_url,
             u.intranet_username,
             COALESCE(SUM(l.value), 0) as score,
             COUNT(DISTINCT c.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON l.likeable_type = 'post' AND l.likeable_id = p.id
      LEFT JOIN comments c ON c.post_id = p.id
    `;

    // Add tag filtering if requested
    const queryParams = [userId, userId, userId];
    if (tagSlug) {
      baseQuery += `
        JOIN post_tags pt ON p.id = pt.post_id
        JOIN tags t ON pt.tag_id = t.id AND t.slug = ?
      `;
      queryParams.unshift(tagSlug);
    }

    baseQuery += `
      WHERE (
        p.visibility = 'all_members' OR
        p.visibility IS NULL OR
        p.user_id = ? OR
        p.id IN (SELECT pe.post_id FROM post_editors pe WHERE pe.user_id = ?) OR
        (p.visibility = 'specific_members' AND p.id IN (
          SELECT pv.post_id FROM post_visibility pv WHERE pv.user_id = ?
        ))
      )
    `;

    // Only filter out empty content posts for feed view (dashboard)
    if (req.query.feed === 'true') {
      baseQuery += ` AND p.content IS NOT NULL AND p.content != ''`;
    }

    baseQuery += ` GROUP BY p.id`;

    if (sort === 'unanswered') {
      baseQuery += ' HAVING comment_count = 0';
    }

    baseQuery += ` ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${offset}`;

    const [posts] = await db.execute(baseQuery, queryParams);

    // Fetch tags for each post
    const postIds = posts.map(p => p.id);
    let postTags = {};

    if (postIds.length > 0) {
      const [tags] = await db.execute(`
        SELECT pt.post_id, t.id, t.name, t.slug
        FROM post_tags pt
        JOIN tags t ON pt.tag_id = t.id
        WHERE pt.post_id IN (${postIds.map(() => '?').join(',')})
      `, postIds);

      // Group tags by post_id
      tags.forEach(tag => {
        if (!postTags[tag.post_id]) {
          postTags[tag.post_id] = [];
        }
        postTags[tag.post_id].push({
          id: tag.id,
          name: tag.name,
          slug: tag.slug
        });
      });
    }

    // Add tags to posts
    const postsWithTags = posts.map(post => ({
      ...post,
      tags: postTags[post.id] || []
    }));

    // Count total visible posts for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT p.id) as total
      FROM posts p
    `;

    const countParams = [userId, userId, userId];
    if (tagSlug) {
      countQuery += `
        JOIN post_tags pt ON p.id = pt.post_id
        JOIN tags t ON pt.tag_id = t.id AND t.slug = ?
      `;
      countParams.unshift(tagSlug);
    }

    countQuery += `
      WHERE (
        p.visibility = 'all_members' OR
        p.visibility IS NULL OR
        p.user_id = ? OR
        p.id IN (SELECT pe.post_id FROM post_editors pe WHERE pe.user_id = ?) OR
        (p.visibility = 'specific_members' AND p.id IN (
          SELECT pv.post_id FROM post_visibility pv WHERE pv.user_id = ?
        ))
      )
    `;

    const [countResult] = await db.execute(countQuery, countParams);

    res.json({
      posts: postsWithTags,
      pagination: {
        page: page,
        limit: limit,
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Get popular tags
app.get('/api/tags/popular', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 4;

    // Use query instead of execute to avoid prepared statement issues with LIMIT
    const [tags] = await db.query(`
      SELECT id, name, slug, usage_count, created_at
      FROM tags
      WHERE usage_count > 0
      ORDER BY usage_count DESC
      LIMIT ${limit}
    `);

    res.json({ tags });
  } catch (error) {
    console.error('Get popular tags error:', error);
    res.status(500).json({ error: 'Failed to fetch popular tags' });
  }
});

// Get all tags
app.get('/api/tags', authenticateToken, async (req, res) => {
  try {
    const [tags] = await db.execute(`
      SELECT * FROM tags
      ORDER BY name ASC
    `);

    res.json({ tags });
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// Get single post
app.get('/api/posts/:slug', authenticateToken, async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user?.userId;
    
    // Get post with author info first to check visibility
    const [posts] = await db.execute(`
      SELECT p.*, u.name as author_name, u.github_username, u.avatar_url,
             u.account_type as author_account_type,
             COALESCE(SUM(l.value), 0) as score
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON l.likeable_type = 'post' AND l.likeable_id = p.id
      WHERE p.slug = ?
      GROUP BY p.id
    `, [slug]);
    
    if (posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const post = posts[0];
    
    // Co-editors can always read the post they're allowed to edit
    const [editorRows] = await db.execute(`
      SELECT u.id, u.name, u.github_username
      FROM users u
      JOIN post_editors pe ON u.id = pe.user_id
      WHERE pe.post_id = ?
    `, [post.id]);
    const isEditor = editorRows.some(u => u.id === userId);

    // Check visibility permissions (treat NULL as all_members for legacy posts)
    if (post.visibility === 'author_only' && post.user_id !== userId && !isEditor) {
      return res.status(403).json({ error: 'Post not found' }); // Hide that it exists
    }

    if (post.visibility === 'specific_members') {
      // Allow author and co-editors to always see the post
      if (post.user_id !== userId && !isEditor) {
        // Check if user has explicit access
        const [access] = await db.execute(
          'SELECT 1 FROM post_visibility WHERE post_id = ? AND user_id = ?',
          [post.id, userId]
        );
        
        if (access.length === 0) {
          return res.status(403).json({ error: 'Post not found' }); // Hide that it exists
        }
      }
    }
    
    // If visibility is NULL or all_members, allow access to any authenticated user
    
    // If we get here, user has permission to view the post
    // Increment view count only for authorized views
    await db.execute(
      'UPDATE posts SET view_count = view_count + 1 WHERE slug = ?',
      [slug]
    );
    
    // Get tags
    const [tags] = await db.execute(`
      SELECT t.* FROM tags t
      JOIN post_tags pt ON t.id = pt.tag_id
      WHERE pt.post_id = ?
    `, [post.id]);
    
    post.tags = tags;
    
    // Get comments with like information
    const [comments] = await db.execute(`
      SELECT c.*, u.name as author_name, u.github_username, u.intranet_username, u.avatar_url,
             u.account_type as author_account_type,
             COALESCE(SUM(CASE WHEN l.value = 1 THEN 1 ELSE 0 END), 0) as like_count,
             MAX(CASE WHEN l.user_id = ? AND l.value = 1 THEN 1 ELSE 0 END) as user_liked
      FROM comments c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN likes l ON l.likeable_type = 'comment' AND l.likeable_id = c.id
      WHERE c.post_id = ?
      GROUP BY c.id
      ORDER BY c.is_accepted DESC, c.created_at ASC
    `, [req.user?.userId || 0, post.id]);
    
    post.comments = comments;
    
    // Add co-editor information for the frontend
    post.editor_users = editorRows.map(u => u.id);
    post.editor_users_details = editorRows;
    post.can_edit = post.user_id === userId || req.user?.role === 'admin' || isEditor;

    // Add visibility information for the frontend
    if (post.visibility === 'specific_members') {
      const [visibilityUsers] = await db.execute(`
        SELECT u.id, u.name, u.github_username 
        FROM users u
        JOIN post_visibility pv ON u.id = pv.user_id
        WHERE pv.post_id = ?
      `, [post.id]);
      
      post.visible_to_users = visibilityUsers.map(u => u.id);
      post.visible_to_users_details = visibilityUsers;
      post.access_count = visibilityUsers.length + 1; // +1 for author
    } else if (post.visibility === 'author_only') {
      post.access_count = 1; // Only author
    } else {
      // all_members - count all non-deactivated users
      const [userCount] = await db.execute(
        'SELECT COUNT(*) as count FROM users WHERE role != "deactivated" AND account_type = "human"'
      );
      post.access_count = userCount[0].count;
    }
    
    res.json(post);
  } catch (error) {
    console.error('Get post error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Create comment
// Add a comment to a post as `user` (JWT payload or API acting-user context):
// insert, process @mentions, notify the post author (in-app + email if they
// have been offline 30 min). Shared by POST /api/posts/:postId/comments (JWT)
// and POST /api/v1/forum/posts/:postId/comments (API token, voice agents).
// Throws ApiError for caller mistakes. Tagged AI agents are brought into the
// thread unless opts.fromAgent — an agent's own reply never
// summons another agent.
async function createComment(postId, user, content, parentId = null, opts = {}) {
  const [posts] = await db.execute('SELECT user_id, title, slug FROM posts WHERE id = ?', [postId]);
  if (posts.length === 0) throw new ApiError(404, 'Post not found');

  // A reply must point at a comment on this same post.
  let parent = null;
  if (parentId) {
    const [rows] = await db.execute('SELECT id FROM comments WHERE id = ? AND post_id = ?', [parseInt(parentId), postId]);
    if (rows.length === 0) throw new ApiError(404, 'Parent comment not found');
    parent = rows[0].id;
  }

  const contentHtml = markdownToHtml(content);
  const [result] = await db.execute(
    'INSERT INTO comments (post_id, user_id, parent_id, content, content_html) VALUES (?, ?, ?, ?, ?)',
    [postId, user.userId, parent, content, contentHtml]
  );
  const commentId = result.insertId;

  await processMentions(content, 'comment', commentId, user.userId, user);

  const post = posts[0];
  const agentsSummoned = opts.fromAgent ? [] : await agentResponder.handleMentions({
    type: 'comment', id: commentId, postId, postAuthorId: post.user_id, content,
    author: { userId: user.userId, name: user.name }
  });
  if (post.user_id !== user.userId) {
    const commenter = user.name || user.github_username || 'Someone';
    await db.execute(
      'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
      [
        post.user_id,
        'new_comment',
        'New comment on your post',
        `${commenter} commented on "${post.title}"`,
        JSON.stringify({ postId, commentId, slug: post.slug })
      ]
    );

    try {
      const [authorData] = await db.execute(
        'SELECT email, name, company_email, last_login, email_notification_preference FROM users WHERE id = ?',
        [post.user_id]
      );

      if (authorData.length > 0) {
        const author = authorData[0];
        const emailToUse = getNotificationEmail(author);

        // Only email authors who have not been online in the last 30 minutes
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
        const lastLogin = author.last_login ? new Date(author.last_login) : new Date(0);
        const isUserOffline = lastLogin < thirtyMinutesAgo;

        if (isUserOffline) {
          const postUrl = `${process.env.BASE_URL}/forum/post/${postId}`;

          const emailSubject = `New Comment on Your Post - ${SITE_NAME}`;
          const emailText = `Hi ${author.name}!

${commenter} commented on your post "${post.title}":

${content}

View the full discussion: ${postUrl}

Best regards,
${SITE_TEAM}`;

          const emailHtml = `
              <h2>New Comment on Your Post 💬</h2>
              <p>Hi ${author.name}!</p>
              <p><strong>${commenter}</strong> commented on your post "<strong>${post.title}</strong>":</p>
              
              <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0;">
                ${contentHtml}
              </div>
              
              <p><a href="${postUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Full Discussion</a></p>
              
              <hr>
              <p>Best regards,<br>${SITE_TEAM}</p>
            `;

          const emailsToSend = Array.isArray(emailToUse) ? emailToUse : [emailToUse];
          for (const email of emailsToSend) {
            await sendEmail(email, emailSubject, emailText, emailHtml);
          }
          console.log(`Email notification sent to ${emailsToSend.join(', ')} for offline user ${author.name}`);
        }
      }
    } catch (emailError) {
      console.error('Failed to send email notification:', emailError);
      // Don't fail the comment creation if email fails
    }
  }

  return { commentId, postId, parentId: parent, agentsSummoned };
}

// @mentioned AI agents answer in the thread.
const agentResponder = createAgentResponder({
  getDb: () => db,
  createComment,
  sendDirectMessage: (senderId, recipientId, content) => deliverDirectMessage(senderId, recipientId, content),
  postGroupMessage: (groupId, senderId, content, replyToId) => postGroupMessage(groupId, senderId, content, replyToId)
});

app.post('/api/posts/:postId/comments', authenticateToken, [
  body('content').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const postId = parseInt(req.params.postId);
    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }
    const { commentId, agentsSummoned } = await createComment(postId, req.user, req.body.content, req.body.parentId);
    res.status(201).json({ 
      message: 'Comment created',
      commentId,
      agentsSummoned
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to create comment');
  }
});

// Edit comment
app.put('/api/comments/:id', authenticateToken, [
  body('content').trim().isLength({ min: 5, max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { content } = req.body;

    // Check if comment exists and user has permission
    const [comments] = await db.execute(
      'SELECT user_id FROM comments WHERE id = ?',
      [id]
    );

    if (comments.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = comments[0];

    // Only comment author or admin can edit
    if (comment.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Update comment
    const contentHtml = markdownToHtml(content);
    await db.execute(
      'UPDATE comments SET content = ?, content_html = ?, updated_at = NOW() WHERE id = ?',
      [content, contentHtml, id]
    );

    res.json({ message: 'Comment updated successfully' });
  } catch (error) {
    console.error('Edit comment error:', error);
    res.status(500).json({ error: 'Failed to edit comment' });
  }
});

// Delete comment
app.delete('/api/comments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if comment exists and user has permission
    const [comments] = await db.execute(
      'SELECT user_id, post_id FROM comments WHERE id = ?',
      [id]
    );

    if (comments.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = comments[0];

    // Only comment author or admin can delete
    if (comment.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Delete related data first (foreign key constraints)
    await db.execute('DELETE FROM likes WHERE likeable_type = "comment" AND likeable_id = ?', [id]);
    await db.execute('DELETE FROM mentions WHERE mentionable_type = "comment" AND mentionable_id = ?', [id]);
    
    // Delete replies to this comment
    await db.execute('DELETE FROM comments WHERE parent_id = ?', [id]);
    
    // Finally delete the comment
    await db.execute('DELETE FROM comments WHERE id = ?', [id]);

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Like/Unlike
app.post('/api/likes', authenticateToken, async (req, res) => {
  try {
    const { type, id, value } = req.body;
    
    if (!['post', 'comment'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type' });
    }
    
    // For comments, only allow like (1) or unlike (0)  
    if (type === 'comment' && ![0, 1].includes(value)) {
      return res.status(400).json({ error: 'Comments can only be liked or unliked' });
    }
    
    // For posts, allow full voting
    if (type === 'post' && ![-1, 0, 1].includes(value)) {
      return res.status(400).json({ error: 'Invalid value' });
    }
    
    if (value === 0) {
      // Remove like
      await db.execute(
        'DELETE FROM likes WHERE user_id = ? AND likeable_type = ? AND likeable_id = ?',
        [req.user.userId, type, id]
      );
    } else {
      // Add or update like
      await db.execute(
        `INSERT INTO likes (user_id, likeable_type, likeable_id, value) 
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = ?`,
        [req.user.userId, type, id, value, value]
      );
    }
    
    // Update score cache for comments
    if (type === 'comment') {
      const [scores] = await db.execute(
        'SELECT COALESCE(SUM(value), 0) as score FROM likes WHERE likeable_type = ? AND likeable_id = ?',
        [type, id]
      );
      
      await db.execute(
        'UPDATE comments SET score = ? WHERE id = ?',
        [scores[0].score, id]
      );
    }
    
    res.json({ message: 'Like updated' });
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Failed to update like' });
  }
});

// ===================== GROUP CHAT ENDPOINTS =====================

// Get user's groups for group chat
app.get('/api/group-chat/groups', authenticateToken, async (req, res) => {
  try {
    const [groups] = await db.execute(`
      SELECT g.*, 
             COUNT(gm_unread.id) as unread_count,
             last_msg.content as last_message,
             last_msg.created_at as last_message_at,
             sender.name as last_sender_name
      FROM \`groups\` g
      INNER JOIN group_members gm ON g.id = gm.group_id
      LEFT JOIN group_message_reads gmr ON g.id = gmr.group_id AND gmr.user_id = ?
      LEFT JOIN group_messages gm_unread ON g.id = gm_unread.group_id 
        AND gm_unread.created_at > COALESCE(gmr.last_read_at, '1970-01-01')
        AND gm_unread.sender_id != ?
      LEFT JOIN (
        SELECT group_id, content, created_at, sender_id,
               ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY created_at DESC) as rn
        FROM group_messages
      ) last_msg ON g.id = last_msg.group_id AND last_msg.rn = 1
      LEFT JOIN users sender ON last_msg.sender_id = sender.id
      WHERE gm.user_id = ? AND g.is_active = 1
      GROUP BY g.id, g.name, g.display_name, g.description, g.type, 
               last_msg.content, last_msg.created_at, sender.name
      ORDER BY last_msg.created_at DESC, g.display_name
    `, [req.user.userId, req.user.userId, req.user.userId]);

    res.json(groups);
  } catch (error) {
    console.error('Get user groups error:', error);
    res.status(500).json({ error: 'Failed to fetch user groups' });
  }
});

// Get group chat messages
app.get('/api/group-chat/:groupId/messages', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const offset = (pageNum - 1) * limitNum;

    // Verify user is member of the group
    const [membership] = await db.execute(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.user.userId]
    );

    if (membership.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Get messages with sender information and like counts
    const [messages] = await db.execute(
      `SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.content_html,
              gm.message_type, gm.reply_to_id, gm.is_edited, gm.is_deleted,
              gm.created_at, gm.updated_at,
              u.name as sender_name,
              u.github_username as sender_github_username,
              u.avatar_url as sender_avatar_url,
              CASE WHEN rm.is_deleted = 1 THEN '(deleted)' ELSE rm.content END as reply_to_content,
              ru.name as reply_to_sender_name,
              COALESCE((SELECT SUM(value) FROM likes WHERE likeable_type = 'group_message' AND likeable_id = gm.id), 0) as total_likes,
              EXISTS(SELECT 1 FROM likes WHERE likeable_type = 'group_message' AND likeable_id = gm.id AND user_id = ?) as user_liked
       FROM group_messages gm
       JOIN users u ON gm.sender_id = u.id
       LEFT JOIN group_messages rm ON rm.id = gm.reply_to_id
       LEFT JOIN users ru ON ru.id = rm.sender_id
       WHERE gm.group_id = ? AND gm.is_deleted = 0
       ORDER BY gm.created_at DESC
       LIMIT 50`,
      [req.user.userId, parseInt(groupId)]
    );

    res.json(messages.reverse()); // Reverse to show oldest first
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({ error: 'Failed to fetch group messages' });
  }
});

// Send group chat message
app.post('/api/group-chat/:groupId/messages', authenticateToken, [
  body('content').trim().isLength({ min: 1, max: 2000 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { groupId } = req.params;
    const { content, reply_to_id } = req.body;

    // Verify user is member of the group
    const [membership] = await db.execute(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.user.userId]
    );

    if (membership.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    const contentHtml = markdownToHtml(content);
    
    const [result] = await db.execute(
      'INSERT INTO group_messages (group_id, sender_id, content, content_html, reply_to_id) VALUES (?, ?, ?, ?, ?)',
      [groupId, req.user.userId, content, contentHtml, reply_to_id || null]
    );

    const messageId = result.insertId;

    // Update read status for sender
    await db.execute(`
      INSERT INTO group_message_reads (group_id, user_id, last_read_message_id, last_read_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE last_read_message_id = ?, last_read_at = NOW()
    `, [groupId, req.user.userId, messageId, messageId]);

    // Process mentions
    await processMentions(content, 'group_message', messageId, req.user.userId, req.user);
    // @mentioned AI agents answer in the channel.
    const agentsSummoned = await agentResponder.handleGroupMention({
      messageId, groupId: parseInt(groupId), senderId: req.user.userId, content
    });

    res.status(201).json({
      message: 'Group message sent',
      messageId,
      agentsSummoned
    });
  } catch (error) {
    console.error('Send group message error:', error);
    res.status(500).json({ error: 'Failed to send group message' });
  }
});

// Mark group messages as read
app.put('/api/group-chat/:groupId/read', authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { messageId } = req.body;

    // Verify user is member of the group
    const [membership] = await db.execute(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.user.userId]
    );

    if (membership.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    await db.execute(`
      INSERT INTO group_message_reads (group_id, user_id, last_read_message_id, last_read_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE last_read_message_id = ?, last_read_at = NOW()
    `, [groupId, req.user.userId, messageId, messageId]);

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Mark group messages read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Like/unlike a group chat message
app.post('/api/group-chat/:groupId/messages/:messageId/like', authenticateToken, async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const userId = req.user.userId;

    // Verify user is member of the group
    const [membership] = await db.execute(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, userId]
    );
    if (membership.length === 0) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }

    // Check if message exists in this group
    const [msgs] = await db.execute(
      'SELECT id FROM group_messages WHERE id = ? AND group_id = ?',
      [messageId, groupId]
    );
    if (msgs.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user already liked
    const [existing] = await db.execute(
      'SELECT id, value FROM likes WHERE user_id = ? AND likeable_type = ? AND likeable_id = ?',
      [userId, 'group_message', messageId]
    );

    if (existing.length > 0) {
      // Toggle off — remove the like
      await db.execute('DELETE FROM likes WHERE id = ?', [existing[0].id]);
    } else {
      // Create new like
      await db.execute(
        'INSERT INTO likes (user_id, likeable_type, likeable_id, value) VALUES (?, ?, ?, ?)',
        [userId, 'group_message', messageId, 1]
      );
    }

    // Get updated like count
    const [likeCount] = await db.execute(
      'SELECT COALESCE(SUM(value), 0) as total_likes FROM likes WHERE likeable_type = ? AND likeable_id = ?',
      ['group_message', messageId]
    );

    // Check if current user now has a like
    const [userLike] = await db.execute(
      'SELECT id FROM likes WHERE user_id = ? AND likeable_type = ? AND likeable_id = ?',
      [userId, 'group_message', messageId]
    );

    res.json({
      liked: userLike.length > 0,
      total_likes: parseInt(likeCount[0].total_likes),
      user_liked: userLike.length > 0
    });
  } catch (error) {
    console.error('Like group message error:', error);
    res.status(500).json({ error: 'Failed to like message' });
  }
});

// ===================== INVESTMENT TRACKER ENDPOINTS =====================

// Create deliverable
app.post('/api/deliverables', authenticateToken, [
  body('title').notEmpty().trim(),
  body('content').optional().trim(),
  body('amount').optional().isFloat({ min: 0 }),
  body('original_amount').optional().isFloat({ min: 0 }),
  body('original_currency').optional().isIn(['USD', 'CAD', 'EUR', 'GBP', 'JPY']),
  body('exchange_rate').optional().isFloat({ min: 0.01 }),
  body('risk_multiplier').optional().isFloat({ min: 0.1, max: 10 }),
  body('investment_category').optional().isIn(['cash', 'sweat_equity', 'property', 'referral']),
  body('nominee_user_id').optional().isInt(),
  body('deliverable_date').optional().isDate(),
  body('tags').optional().isArray(),
  body('is_draft').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const {
      title,
      content,
      amount,
      original_amount,
      original_currency = BASE_CURRENCY,
      exchange_rate = 1.0,
      risk_multiplier = 1.0,
      investment_category = 'cash',
      nominee_user_id,
      deliverable_date,
      tags = [],
      is_draft = false
    } = req.body;

    // Process content (markdown to HTML)
    const contentHtml = markdownToHtml(content);

    // Determine status
    const status = is_draft ? 'draft' : (amount ? 'pending' : 'pending_review');

    // Use nominee_user_id or default to submitter
    const finalNomineeId = nominee_user_id || req.user.userId;

    const [result] = await db.execute(
      `INSERT INTO deliverables
       (user_id, nominee_user_id, title, content, content_html, amount, current_proposed_amount,
        original_amount, original_currency, exchange_rate, risk_multiplier, investment_category, deliverable_date, status, is_draft)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.userId, finalNomineeId, title, content, contentHtml, amount || null, amount || null,
       original_amount || null, original_currency, exchange_rate, risk_multiplier, investment_category,
       deliverable_date || new Date().toISOString().split('T')[0], status, is_draft]
    );
    
    const deliverableId = result.insertId;
    
    // Process tags
    if (tags && tags.length > 0) {
      for (const tagName of tags) {
        const tagSlug = generateSlug(tagName);
        
        // Insert or get tag
        await db.execute(
          'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
          [tagName, tagSlug]
        );
        
        const [tagRows] = await db.execute(
          'SELECT id FROM tags WHERE slug = ?',
          [tagSlug]
        );
        
        if (tagRows.length > 0) {
          await db.execute(
            'INSERT INTO deliverable_tags (deliverable_id, tag_id) VALUES (?, ?)',
            [deliverableId, tagRows[0].id]
          );
        }
      }
    }
    
    // Notify admins via direct messages if not a draft
    if (!is_draft) {
      const [admins] = await db.execute(
        'SELECT * FROM users WHERE role = "admin"'
      );
      
      const nomineeInfo = finalNomineeId !== req.user.userId ? 
        ` (nominated by ${req.user.name})` : '';
      
      const notificationMessage = `# 💼 New Deliverable Submission

**Title**: ${title}
**Nominee**: [User ID ${finalNomineeId}]${nomineeInfo}
**Amount**: ${amount ? `$${amount}` : 'Not specified'}
**Date**: ${deliverable_date || 'Today'}

**Description**:
${content.substring(0, 200)}${content.length > 200 ? '...' : ''}

**Action Required**: Review and approve/reject this deliverable submission.

[View Deliverable](/investment-tracker)`;

      for (const admin of admins) {
        if (admin.id !== req.user.userId) { // Don't notify if admin submitted it
          // Send via direct message
          const conversationResult = await db.execute(`
            SELECT id FROM dm_conversations 
            WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
          `, [1, admin.id, admin.id, 1]);
          
          let conversationId;
          if (conversationResult[0].length > 0) {
            conversationId = conversationResult[0][0].id;
          } else {
            const [newConv] = await db.execute(
              'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
              [1, admin.id]
            );
            conversationId = newConv.insertId;
          }
          
          const messageHtml = DOMPurify.sanitize(marked.parse(notificationMessage));
          
          await db.execute(`
            INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
            VALUES (?, ?, ?, ?, ?)
          `, [conversationId, 1, admin.id, notificationMessage, messageHtml]);
        }
      }
    }
    
    res.status(201).json({ 
      message: 'Deliverable submitted',
      deliverableId 
    });
  } catch (error) {
    console.error('Create deliverable error:', error);
    res.status(500).json({ error: 'Failed to create deliverable' });
  }
});

// Get investment category multipliers
app.get('/api/investment-settings/multipliers', authenticateToken, async (req, res) => {
  try {
    const [settings] = await db.execute(
      `SELECT setting_key, setting_value FROM investment_settings
       WHERE setting_key IN ('multiplier_cash', 'multiplier_sweat_equity', 'multiplier_property', 'multiplier_referral')`
    );

    const multipliers = {
      cash: parseFloat(settings.find(s => s.setting_key === 'multiplier_cash')?.setting_value || '2.8'),
      sweat_equity: parseFloat(settings.find(s => s.setting_key === 'multiplier_sweat_equity')?.setting_value || '2.0'),
      property: parseFloat(settings.find(s => s.setting_key === 'multiplier_property')?.setting_value || '1.0'),
      referral: parseFloat(settings.find(s => s.setting_key === 'multiplier_referral')?.setting_value || '1.0')
    };

    res.json(multipliers);
  } catch (error) {
    console.error('Get multipliers error:', error);
    res.status(500).json({ error: 'Failed to get multipliers' });
  }
});

// Update investment category multipliers (admin only)
app.put('/api/investment-settings/multipliers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { cash, sweat_equity, property } = req.body;

    if (cash !== undefined) {
      await db.execute(
        'UPDATE investment_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
        [cash.toString(), req.user.userId, 'multiplier_cash']
      );
    }

    if (sweat_equity !== undefined) {
      await db.execute(
        'UPDATE investment_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
        [sweat_equity.toString(), req.user.userId, 'multiplier_sweat_equity']
      );
    }

    if (property !== undefined) {
      await db.execute(
        'UPDATE investment_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
        [property.toString(), req.user.userId, 'multiplier_property']
      );
    }

    res.json({ message: 'Multipliers updated successfully' });
  } catch (error) {
    console.error('Update multipliers error:', error);
    res.status(500).json({ error: 'Failed to update multipliers' });
  }
});

// Get investment statistics
app.get('/api/investment-tracker/statistics', authenticateToken, async (req, res) => {
  try {
    // Calculate total theoretical value (all approved deliverables excluding payments)
    const [theoreticalValueData] = await db.execute(`
      SELECT COALESCE(SUM(theoretical_value_usd), 0) as total_theoretical_value
      FROM deliverables
      WHERE status IN ('approved', 'paid') AND type != 'member_payment'
    `);

    // Calculate total expenses (only actual cash expenses + member payments, no multipliers)
    const [expensesData] = await db.execute(`
      SELECT COALESCE(SUM(
        CASE
          WHEN type = 'member_payment' THEN amount
          WHEN type = 'expense' THEN COALESCE(original_amount * exchange_rate, 0)
          ELSE 0
        END
      ), 0) as total_expenses
      FROM deliverables
      WHERE status IN ('approved', 'paid')
        AND (
          type = 'member_payment'
          OR type = 'expense'
        )
    `);

    // Calculate pending submissions theoretical value
    const [pendingValueData] = await db.execute(`
      SELECT COALESCE(SUM(theoretical_value_usd), 0) as pending_theoretical_value
      FROM deliverables
      WHERE status IN ('pending', 'pending_review') AND type != 'member_payment'
    `);

    // Count referral deliverables without original amount (estimate at $5000 each)
    const [referralsWithoutAmountData] = await db.execute(`
      SELECT COUNT(*) as referral_count
      FROM deliverables
      WHERE type = 'referral'
        AND (original_amount IS NULL OR original_amount = 0)
        AND status IN ('approved', 'paid', 'pending', 'pending_review')
    `);

    const totalTheoreticalValue = parseFloat(theoreticalValueData[0]?.total_theoretical_value || 0);
    const pendingTheoreticalValue = parseFloat(pendingValueData[0]?.pending_theoretical_value || 0);
    const referralCount = parseInt(referralsWithoutAmountData[0]?.referral_count || 0);
    const estimatedReferralValue = referralCount * 5000;

    const projectedTheoreticalValue = totalTheoreticalValue + pendingTheoreticalValue + estimatedReferralValue;

    res.json({
      total_theoretical_value: totalTheoreticalValue,
      total_expenses: parseFloat(expensesData[0]?.total_expenses || 0),
      projected_theoretical_value: projectedTheoreticalValue,
      pending_theoretical_value: pendingTheoreticalValue,
      estimated_referral_value: estimatedReferralValue
    });
  } catch (error) {
    console.error('Get investment statistics error:', error);
    res.status(500).json({ error: 'Failed to fetch investment statistics' });
  }
});

// Get deliverables
app.get('/api/deliverables', authenticateToken, async (req, res) => {
  try {
    const { status, userId } = req.query;
    
    let query = `
      SELECT d.*, u.name as user_name, u.github_username,
             n.name as nominee_name,
             a.name as approver_name
      FROM deliverables d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN users n ON d.nominee_user_id = n.id
      LEFT JOIN users a ON d.approved_by = a.id
    `;
    
    const conditions = [];
    const params = [];
    
    if (status) {
      conditions.push('d.status = ?');
      params.push(status);
    }
    
    // Access control:
    // - Admin users: see all
    // - Users with hourly_rate >= 100: see all
    // - Other users: only see their own deliverables
    const canViewAll = req.user.role === 'admin' || (req.user.hourly_rate && parseFloat(req.user.hourly_rate) >= 100);

    if (!canViewAll) {
      // Non-privileged users only see their own deliverables
      conditions.push('d.user_id = ?');
      params.push(req.user.userId);
    }
    // For privileged users (admin or hourly_rate >= 100), show all unless filtering by userId
    else if (userId) {
      conditions.push('d.user_id = ?');
      params.push(userId);
    }
    // If privileged user and no userId specified, show all deliverables (no additional condition)
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY d.created_at DESC';
    
    const [deliverables] = await db.execute(query, params);
    
    // Get attachments for each deliverable
    for (const deliverable of deliverables) {
      const [attachments] = await db.execute(
        'SELECT * FROM deliverable_attachments WHERE deliverable_id = ?',
        [deliverable.id]
      );
      deliverable.attachments = attachments;
    }
    
    res.json(deliverables);
  } catch (error) {
    console.error('Get deliverables error:', error);
    res.status(500).json({ error: 'Failed to fetch deliverables' });
  }
});

// Get single deliverable
app.get('/api/deliverables/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [deliverables] = await db.execute(`
      SELECT
        d.*,
        u.name as user_name,
        u.email as user_email,
        n.name as nominee_name,
        a.name as approver_name
      FROM deliverables d
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN users n ON d.nominee_user_id = n.id
      LEFT JOIN users a ON d.approved_by = a.id
      WHERE d.id = ?
    `, [id]);

    if (deliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const deliverable = deliverables[0];

    // Check permission - user can view their own, admins can view all
    if (req.user.role !== 'admin' && deliverable.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Get attachments
    const [attachments] = await db.execute(
      'SELECT * FROM deliverable_attachments WHERE deliverable_id = ?',
      [id]
    );
    deliverable.attachments = attachments;

    // Get tags
    const [tags] = await db.execute(`
      SELECT t.* FROM tags t
      JOIN deliverable_tags dt ON t.id = dt.tag_id
      WHERE dt.deliverable_id = ?
    `, [id]);
    deliverable.tags = tags;

    res.json(deliverable);
  } catch (error) {
    console.error('Fetch single deliverable error:', error);
    res.status(500).json({ error: 'Failed to fetch deliverable' });
  }
});

// Record adjustment for deliverable (admin)
app.post('/api/deliverables/:id/adjust', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { adjustment_type, new_value, reason } = req.body;

    if (!adjustment_type || !new_value || !reason) {
      return res.status(400).json({ error: 'Missing required fields: adjustment_type, new_value, reason' });
    }

    // Get current deliverable values
    const [deliverables] = await db.execute(
      'SELECT * FROM deliverables WHERE id = ?',
      [id]
    );

    if (deliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const deliverable = deliverables[0];

    // Determine field name and old value
    let fieldName, oldValue, newAmount;
    switch (adjustment_type) {
      case 'original_amount':
        fieldName = 'original_amount';
        oldValue = deliverable.original_amount;
        break;
      case 'exchange_rate':
        fieldName = 'exchange_rate';
        oldValue = deliverable.exchange_rate;
        break;
      case 'risk_multiplier':
        fieldName = 'risk_multiplier';
        oldValue = deliverable.risk_multiplier;
        break;
      case 'final_amount':
        fieldName = 'amount';
        oldValue = deliverable.amount;
        break;
      default:
        return res.status(400).json({ error: 'Invalid adjustment type' });
    }

    // Start transaction using query instead of execute for transaction commands
    await db.query('START TRANSACTION');

    try {
      // Record the adjustment
      await db.execute(
        `INSERT INTO deliverable_adjustments
         (deliverable_id, adjusted_by, adjustment_type, field_name, old_value, new_value, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, req.user.userId, adjustment_type, fieldName, oldValue, new_value, reason]
      );

      if (adjustment_type === 'final_amount') {
        // Direct override of final amount - no calculation needed
        newAmount = parseFloat(new_value);
        await db.execute(
          'UPDATE deliverables SET amount = ?, adjusted_amount = ?, adjustment_reason = ? WHERE id = ?',
          [newAmount, newAmount, reason, id]
        );
      } else {
        // Update the deliverable with the new value
        await db.execute(
          `UPDATE deliverables SET ${fieldName} = ? WHERE id = ?`,
          [new_value, id]
        );

        // Calculate and update the amount based on all factors
        newAmount = parseFloat(adjustment_type === 'original_amount' ? new_value : deliverable.original_amount || 0) *
                         parseFloat(adjustment_type === 'exchange_rate' ? new_value : deliverable.exchange_rate || 1) *
                         parseFloat(adjustment_type === 'risk_multiplier' ? new_value : deliverable.risk_multiplier || 1);

        await db.execute(
          'UPDATE deliverables SET amount = ?, adjusted_amount = ?, adjustment_reason = ? WHERE id = ?',
          [newAmount, newAmount, reason, id]
        );
      }

      // Commit transaction
      await db.query('COMMIT');

      // Add notification for the user
      await db.execute(
        'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
        [
          deliverable.user_id,
          'deliverable_update',
          'Deliverable Adjusted',
          `Your deliverable "${deliverable.title}" has been adjusted. ${fieldName} changed from ${oldValue} to ${new_value}. Reason: ${reason}`
        ]
      );

      res.json({ message: 'Adjustment recorded successfully', new_amount: newAmount });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Adjustment error:', error);
    res.status(500).json({ error: 'Failed to record adjustment' });
  }
});

// Get adjustment history for a deliverable
app.get('/api/deliverables/:id/adjustments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user can view this deliverable
    const [deliverables] = await db.execute(
      'SELECT user_id FROM deliverables WHERE id = ?',
      [id]
    );

    if (deliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    if (req.user.role !== 'admin' && deliverables[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Get adjustment history
    const [adjustments] = await db.execute(`
      SELECT
        da.*,
        u.name as adjusted_by_name
      FROM deliverable_adjustments da
      JOIN users u ON da.adjusted_by = u.id
      WHERE da.deliverable_id = ?
      ORDER BY da.created_at DESC
    `, [id]);

    res.json(adjustments);
  } catch (error) {
    console.error('Fetch adjustments error:', error);
    res.status(500).json({ error: 'Failed to fetch adjustments' });
  }
});

// Update deliverable (admin)
app.put('/api/deliverables/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, amount, rejection_reason, nominee_user_id, original_amount, exchange_rate, risk_multiplier, content, investment_category } = req.body;

    // Check permissions
    const [deliverables] = await db.execute(
      'SELECT user_id, status FROM deliverables WHERE id = ?',
      [id]
    );

    if (deliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const deliverable = deliverables[0];
    const isOwner = deliverable.user_id === req.user.userId;
    const isAdmin = req.user.role === 'admin';

    // Users can only edit their own pending_review deliverables
    // Admins can edit anything
    if (!isAdmin) {
      if (!isOwner) {
        return res.status(403).json({ error: 'Permission denied' });
      }
      if (deliverable.status !== 'pending_review') {
        return res.status(403).json({ error: 'You can only edit deliverables in pending_review status' });
      }
      // Users cannot change status
      if (status !== undefined) {
        return res.status(403).json({ error: 'Users cannot change deliverable status' });
      }
    }

    const updates = [];
    const params = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);

      if (['approved', 'rejected'].includes(status)) {
        updates.push('approved_by = ?', 'approved_at = NOW()');
        params.push(req.user.userId);
      }
    }

    if (amount !== undefined) {
      updates.push('amount = ?');
      params.push(amount);
    }

    if (rejection_reason) {
      updates.push('rejection_reason = ?');
      params.push(rejection_reason);
    }

    if (nominee_user_id !== undefined) {
      updates.push('nominee_user_id = ?');
      params.push(nominee_user_id || null);
    }

    if (original_amount !== undefined) {
      updates.push('original_amount = ?');
      params.push(original_amount);
    }

    if (exchange_rate !== undefined) {
      updates.push('exchange_rate = ?');
      params.push(exchange_rate);
    }

    if (risk_multiplier !== undefined) {
      updates.push('risk_multiplier = ?');
      params.push(risk_multiplier);
    }

    if (content !== undefined) {
      updates.push('content = ?');
      params.push(content);
    }

    if (investment_category !== undefined) {
      updates.push('investment_category = ?');
      params.push(investment_category);
    }

    params.push(id);

    if (updates.length > 0) {
      await db.execute(
        `UPDATE deliverables SET ${updates.join(', ')} WHERE id = ?`,
        params
      );

      // If original_amount or exchange_rate changed, recalculate amount (USD converted amount)
      // Note: amount = original_amount × exchange_rate (NOT including risk_multiplier)
      // Risk multiplier is only applied when calculating theoretical value for display
      if (original_amount !== undefined || exchange_rate !== undefined) {
        const [current] = await db.execute(
          'SELECT original_amount, exchange_rate FROM deliverables WHERE id = ?',
          [id]
        );

        if (current.length > 0) {
          const finalOriginalAmount = parseFloat(current[0].original_amount || 0);
          const finalExchangeRate = parseFloat(current[0].exchange_rate || 1);
          const newAmount = finalOriginalAmount * finalExchangeRate;

          await db.execute(
            'UPDATE deliverables SET amount = ? WHERE id = ?',
            [newAmount, id]
          );
        }
      }
    }

    // Notify user
    const [updatedDeliverables] = await db.execute(
      'SELECT user_id, title FROM deliverables WHERE id = ?',
      [id]
    );

    if (updatedDeliverables.length > 0) {
      await db.execute(
        'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
        [
          updatedDeliverables[0].user_id,
          'deliverable_update',
          'Deliverable Updated',
          `Your deliverable "${updatedDeliverables[0].title}" has been updated`
        ]
      );
    }
    
    res.json({ message: 'Deliverable updated' });
  } catch (error) {
    console.error('Update deliverable error:', error);
    res.status(500).json({ error: 'Failed to update deliverable' });
  }
});

// Upload and analyze document for deliverable
app.post('/api/deliverables/analyze-document', authenticateToken, (req, res, next) => {
  req.uploadType = 'deliverables';
  next();
}, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      // Delete uploaded file if invalid type
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'Invalid file type. Only JPG, PNG, and PDF files are allowed.' });
    }

    try {
      // Analyze document using the Anthropic Claude API
      const analysisResult = await analyzeDocument(req.file.path, req.file.mimetype);
      
      // Return analysis results along with file info
      res.json({
        success: true,
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileSize: req.file.size,
        analysis: analysisResult
      });
    } catch (analysisError) {
      console.error('Document analysis failed:', analysisError);
      
      // Determine specific error type and provide helpful message
      let errorMessage = 'AI analysis failed - manual review required';
      let errorType = 'analysis-failed';
      
      if (analysisError.message.includes('Anthropic API key')) {
        errorMessage = 'AI service temporarily unavailable - please try again later';
        errorType = 'service-unavailable';
      } else if (analysisError.message.includes('rate limit') || analysisError.status === 429) {
        errorMessage = 'AI service is busy - please try again in a moment';
        errorType = 'rate-limited';
      } else if (analysisError.message.includes('PDF') || analysisError.message.includes('text extraction')) {
        errorMessage = 'Could not extract text from PDF - try converting to JPG/PNG or manual entry';
        errorType = 'pdf-extraction-failed';
      }
      
      // Still return file info even if analysis fails
      res.json({
        success: true,
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileSize: req.file.size,
        analysis: {
          type: 'unknown',
          category: 'manual-review',
          suggestedTitle: req.file.originalname,
          suggestedAmount: null,
          currency: BASE_CURRENCY,
          confidence: 0,
          description: errorMessage,
          extractedText: 'Could not analyze document automatically',
          tags: ['manual-review', 'upload'],
          error: errorType
        }
      });
    }
  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ error: 'Failed to upload and analyze document' });
  }
});

// Get uploaded document
app.get('/api/deliverables/documents/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', 'deliverables', filename);

    // Security check: ensure file exists and is within uploads directory
    try {
      await fs.access(filePath);
      res.sendFile(filePath);
    } catch (err) {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    console.error('File access error:', error);
    res.status(500).json({ error: 'Failed to access file' });
  }
});

// Process payment for multiple deliverables
app.post('/api/deliverables/process-payment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { deliverable_ids, payment_method, payment_date, notes } = req.body;

    if (!deliverable_ids || !Array.isArray(deliverable_ids) || deliverable_ids.length === 0) {
      return res.status(400).json({ error: 'No deliverables selected for payment' });
    }

    // Generate unique batch ID
    const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Start transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Update all selected deliverables to 'paid' status
      const placeholders = deliverable_ids.map(() => '?').join(',');
      await connection.execute(
        `UPDATE deliverables
         SET status = 'paid',
             paid_by = ?,
             paid_at = ?,
             payment_method = ?,
             payment_batch_id = ?,
             payment_notes = ?
         WHERE id IN (${placeholders}) AND status = 'approved'`,
        [req.user.userId, payment_date || new Date(), payment_method || 'bank_transfer', batchId, notes || '', ...deliverable_ids]
      );

      // Get affected deliverables for notifications
      const [deliverables] = await connection.execute(
        `SELECT id, user_id, title, amount FROM deliverables WHERE id IN (${placeholders})`,
        deliverable_ids
      );

      // Send notifications to users
      for (const deliverable of deliverables) {
        await connection.execute(
          'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
          [
            deliverable.user_id,
            'payment_processed',
            'Payment Processed',
            `Payment of $${deliverable.amount} for "${deliverable.title}" has been processed (Batch: ${batchId})`
          ]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: 'Payments processed successfully',
        batch_id: batchId,
        count: deliverables.length
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({ error: 'Failed to process payments' });
  }
});

// Delete deliverable (admin or owner)
app.delete('/api/deliverables/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get deliverable details
    const [deliverables] = await db.execute(
      'SELECT user_id, status, title FROM deliverables WHERE id = ?',
      [id]
    );

    if (deliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const deliverable = deliverables[0];

    // Check permissions: admin or owner
    if (req.user.role !== 'admin' && deliverable.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permission denied: can only delete your own deliverables' });
    }

    // Prevent deletion of approved or paid deliverables (unless admin)
    if (['approved', 'paid'].includes(deliverable.status) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot delete approved or paid deliverables' });
    }

    // Delete associated tags first
    await db.execute('DELETE FROM deliverable_tags WHERE deliverable_id = ?', [id]);

    // Delete the deliverable
    await db.execute('DELETE FROM deliverables WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Deliverable deleted successfully',
      deleted_id: parseInt(id)
    });
  } catch (error) {
    console.error('Delete deliverable error:', error);
    res.status(500).json({ error: 'Failed to delete deliverable' });
  }
});

// Create member-to-member payment (admin only)
app.post('/api/deliverables/member-payment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { payer_id, recipient_id, amount, currency, exchange_rate, payment_date, notes } = req.body;

    if (!payer_id || !recipient_id || !amount) {
      return res.status(400).json({ error: 'Payer, recipient, and amount are required' });
    }

    if (payer_id === recipient_id) {
      return res.status(400).json({ error: 'Payer and recipient cannot be the same' });
    }

    // Get user details for title generation
    const [payers] = await db.execute('SELECT name, role FROM users WHERE id = ?', [payer_id]);
    const [recipients] = await db.execute('SELECT name FROM users WHERE id = ?', [recipient_id]);

    if (payers.length === 0 || recipients.length === 0) {
      return res.status(404).json({ error: 'Payer or recipient not found' });
    }

    const isCompanyPayment = payers[0].role === 'system';
    const actualCurrency = currency || BASE_CURRENCY;
    const actualExchangeRate = exchange_rate || 1.0;
    const usdAmount = amount * actualExchangeRate;

    const title = `Payment: ${payers[0].name} → ${recipients[0].name}`;
    const content = notes || `Payment from ${payers[0].name} to ${recipients[0].name}`;

    // Get the cash multiplier from settings
    const [cashSettings] = await db.execute(
      'SELECT setting_value FROM investment_settings WHERE setting_key = ?',
      ['multiplier_cash']
    );
    const cashMultiplier = parseFloat(cashSettings[0]?.setting_value || '2.8');

    // Create the member payment record
    const [paymentResult] = await db.execute(
      `INSERT INTO deliverables
       (user_id, nominee_user_id, type, investment_category, title, content, amount, original_amount,
        original_currency, exchange_rate, risk_multiplier, deliverable_date, status, approved_by, approved_at)
       VALUES (?, ?, 'member_payment', 'cash', ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, NOW())`,
      [payer_id, recipient_id, title, content, usdAmount, amount, actualCurrency,
       actualExchangeRate, cashMultiplier, payment_date || new Date(), req.user.userId]
    );

    // If payer is NOT the company, create an investment entry for the payer
    if (!isCompanyPayment) {
      const investmentTitle = `Investment via Payment to ${recipients[0].name}`;
      const investmentContent = `Investment recorded from payment to ${recipients[0].name}. Original payment: ${actualCurrency} ${amount}`;

      // Get the cash multiplier from settings
      const [cashSettings] = await db.execute(
        'SELECT setting_value FROM investment_settings WHERE setting_key = ?',
        ['multiplier_cash']
      );
      const cashMultiplier = parseFloat(cashSettings[0]?.setting_value || '2.8');
      const investmentAmount = usdAmount * cashMultiplier;

      await db.execute(
        `INSERT INTO deliverables
         (user_id, type, investment_category, title, content, amount, original_amount, original_currency,
          exchange_rate, risk_multiplier, deliverable_date, status, approved_by, approved_at)
         VALUES (?, 'contribution', 'cash', ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, NOW())`,
        [payer_id, investmentTitle, investmentContent, investmentAmount, amount, actualCurrency,
         actualExchangeRate, cashMultiplier, payment_date || new Date(), req.user.userId]
      );

      // Notify payer about investment
      await db.execute(
        'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
        [payer_id, 'investment_update', 'Investment Recorded',
         `Your payment of ${actualCurrency} ${amount} to ${recipients[0].name} has been recorded as a $${usdAmount.toFixed(2)} USD investment.`]
      );
    }

    // Notify recipient
    await db.execute(
      'INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)',
      [recipient_id, 'payment_received', 'Payment Recorded',
       `Payment of ${actualCurrency} ${amount} from ${payers[0].name} has been recorded.`]
    );

    res.json({
      success: true,
      message: 'Member payment recorded successfully',
      payment_id: paymentResult.insertId,
      created_investment: !isCompanyPayment
    });
  } catch (error) {
    console.error('Create member payment error:', error);
    res.status(500).json({ error: 'Failed to create member payment' });
  }
});

// Update member payment (admin only)
app.put('/api/deliverables/member-payment/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id);
    const { payer_id, recipient_id, amount, currency, exchange_rate, payment_date, notes } = req.body;

    if (!payer_id || !recipient_id || !amount) {
      return res.status(400).json({ error: 'Payer, recipient, and amount are required' });
    }

    if (payer_id === recipient_id) {
      return res.status(400).json({ error: 'Payer and recipient cannot be the same' });
    }

    // Check if payment exists and is a member_payment
    const [existing] = await db.execute(
      'SELECT id, type FROM deliverables WHERE id = ? AND type = ?',
      [paymentId, 'member_payment']
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Get user details
    const [payers] = await db.execute('SELECT name FROM users WHERE id = ?', [payer_id]);
    const [recipients] = await db.execute('SELECT name FROM users WHERE id = ?', [recipient_id]);

    if (payers.length === 0 || recipients.length === 0) {
      return res.status(404).json({ error: 'Payer or recipient not found' });
    }

    const actualCurrency = currency || BASE_CURRENCY;
    const actualExchangeRate = exchange_rate || 1.0;
    const usdAmount = amount * actualExchangeRate;

    const title = `Payment: ${payers[0].name} → ${recipients[0].name}`;
    const content = notes || `Payment from ${payers[0].name} to ${recipients[0].name}`;

    // Update the member payment record
    await db.execute(
      `UPDATE deliverables
       SET user_id = ?, nominee_user_id = ?, title = ?, content = ?, amount = ?,
           original_amount = ?, original_currency = ?, exchange_rate = ?, deliverable_date = ?
       WHERE id = ?`,
      [payer_id, recipient_id, title, content, usdAmount, amount, actualCurrency,
       actualExchangeRate, payment_date || new Date(), paymentId]
    );

    res.json({
      success: true,
      message: 'Member payment updated successfully',
      payment_id: paymentId
    });
  } catch (error) {
    console.error('Update member payment error:', error);
    res.status(500).json({ error: 'Failed to update member payment' });
  }
});

// Get investment shares for all members (admin only)
app.get('/api/deliverables/investment-shares', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Calculate shares based on:
    // 1. Approved/paid deliverables (positive contribution)
    // 2. Member payments where user is payer (positive contribution)
    // 3. Member payments where user is recipient (negative contribution - money received)

    const [shares] = await db.execute(`
      SELECT
        u.id,
        u.name,
        u.email,
        COALESCE(SUM(
          CASE
            WHEN d.type = 'member_payment' AND d.user_id = u.id THEN d.amount * d.risk_multiplier
            WHEN d.type = 'member_payment' AND d.nominee_user_id = u.id THEN -(d.amount * d.risk_multiplier)
            WHEN d.type != 'member_payment' AND (d.user_id = u.id OR d.nominee_user_id = u.id)
              THEN COALESCE(d.theoretical_value_usd, d.amount, 0)
            ELSE 0
          END
        ), 0) as total_investment_usd,
        COUNT(DISTINCT CASE WHEN d.type != 'member_payment' THEN d.id END) as deliverable_count,
        COUNT(DISTINCT CASE WHEN d.type = 'member_payment' AND d.user_id = u.id THEN d.id END) as payments_made,
        COUNT(DISTINCT CASE WHEN d.type = 'member_payment' AND d.nominee_user_id = u.id THEN d.id END) as payments_received
      FROM users u
      LEFT JOIN deliverables d ON
        (d.user_id = u.id OR d.nominee_user_id = u.id)
        AND d.status IN ('approved', 'paid')
      WHERE u.role != 'deactivated'
        AND NOT (u.account_type = 'ai_agent' AND u.role = 'system')
      GROUP BY u.id, u.name, u.email
      ORDER BY total_investment_usd DESC
    `);

    // Calculate total and percentages
    const totalInvestment = shares.reduce((sum, s) => sum + parseFloat(s.total_investment_usd), 0);

    const sharesWithPercentage = shares.map(share => ({
      ...share,
      total_investment_usd: parseFloat(share.total_investment_usd),
      percentage: totalInvestment > 0 ? (parseFloat(share.total_investment_usd) / totalInvestment * 100).toFixed(2) : '0.00'
    }));

    res.json({
      shares: sharesWithPercentage,
      total_investment: totalInvestment
    });
  } catch (error) {
    console.error('Get investment shares error:', error);
    res.status(500).json({ error: 'Failed to get investment shares' });
  }
});

// Member contributions breakdown (member-visible: everyone sees everyone).
// Powers the "Members' Contributions" tab — pie + per-member reported/approved/%.
// "Reported" = all non-rejected, non-payment deliverables (face amount).
// "Approved" = approved + paid (face amount). Percentage is of total approved.
app.get('/api/investment-tracker/contributions', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        u.id,
        u.name,
        u.email,
        COALESCE(SUM(
          CASE WHEN d.type != 'member_payment' AND d.status != 'rejected'
               THEN COALESCE(d.amount, 0) ELSE 0 END
        ), 0) AS total_reported,
        COALESCE(SUM(
          CASE WHEN d.type != 'member_payment' AND d.status IN ('approved','paid')
               THEN COALESCE(d.amount, 0) ELSE 0 END
        ), 0) AS total_approved,
        COUNT(DISTINCT CASE WHEN d.type != 'member_payment' AND d.status != 'rejected' THEN d.id END) AS reported_count,
        COUNT(DISTINCT CASE WHEN d.type != 'member_payment' AND d.status IN ('approved','paid') THEN d.id END) AS approved_count
      FROM users u
      LEFT JOIN deliverables d
        ON d.nominee_user_id = u.id
      WHERE u.role != 'deactivated'
      GROUP BY u.id, u.name, u.email
      HAVING total_reported > 0
      ORDER BY total_approved DESC, total_reported DESC
    `);

    const totalApproved = rows.reduce((s, r) => s + parseFloat(r.total_approved), 0);
    const totalReported = rows.reduce((s, r) => s + parseFloat(r.total_reported), 0);

    const members = rows.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      total_reported: parseFloat(r.total_reported),
      total_approved: parseFloat(r.total_approved),
      reported_count: r.reported_count,
      approved_count: r.approved_count,
      percentage: totalApproved > 0
        ? +(parseFloat(r.total_approved) / totalApproved * 100).toFixed(2)
        : 0
    }));

    res.json({ members, total_approved: totalApproved, total_reported: totalReported });
  } catch (error) {
    console.error('Get contributions error:', error);
    res.status(500).json({ error: 'Failed to get contributions' });
  }
});

// Get exchange rate for a specific date and currency
app.get('/api/exchange-rates', authenticateToken, async (req, res) => {
  try {
    const { date, currency } = req.query;

    if (!currency || !date) {
      return res.status(400).json({ error: 'Date and currency are required' });
    }

    // Try to get exact date match first
    const [exactMatch] = await db.execute(
      `SELECT rate FROM exchange_rates
       WHERE date = ? AND base_currency = 'USD' AND target_currency = ?`,
      [date, currency]
    );

    if (exactMatch.length > 0) {
      return res.json({ rate: parseFloat(exactMatch[0].rate), date, currency });
    }

    // If no exact match, get the most recent rate before or on that date
    const [closestMatch] = await db.execute(
      `SELECT rate, date FROM exchange_rates
       WHERE date <= ? AND base_currency = 'USD' AND target_currency = ?
       ORDER BY date DESC LIMIT 1`,
      [date, currency]
    );

    if (closestMatch.length > 0) {
      return res.json({
        rate: parseFloat(closestMatch[0].rate),
        date: closestMatch[0].date,
        currency,
        fallback: true
      });
    }

    // If still no match, get the earliest available rate
    const [earliestMatch] = await db.execute(
      `SELECT rate, date FROM exchange_rates
       WHERE base_currency = 'USD' AND target_currency = ?
       ORDER BY date ASC LIMIT 1`,
      [currency]
    );

    if (earliestMatch.length > 0) {
      return res.json({
        rate: parseFloat(earliestMatch[0].rate),
        date: earliestMatch[0].date,
        currency,
        fallback: true,
        earliest: true
      });
    }

    // No rates available, return default
    res.json({ rate: 1.0, date, currency, default: true });
  } catch (error) {
    console.error('Get exchange rate error:', error);
    res.status(500).json({ error: 'Failed to get exchange rate' });
  }
});

// Fetch and store exchange rates (admin only)
app.post('/api/exchange-rates/fetch', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const currencies = ['CAD', 'EUR', 'GBP', 'JPY'];
    const today = new Date().toISOString().split('T')[0];
    const results = [];

    for (const currency of currencies) {
      try {
        // Fetch from ExchangeRate-API
        const response = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
        const data = await response.json();

        if (data.result === 'success' && data.rates && data.rates.USD) {
          const rateToUSD = data.rates.USD;

          // Store in database (rate is from currency to USD)
          await db.execute(
            `INSERT INTO exchange_rates (date, base_currency, target_currency, rate)
             VALUES (?, 'USD', ?, ?)
             ON DUPLICATE KEY UPDATE rate = ?`,
            [today, currency, rateToUSD, rateToUSD]
          );

          results.push({ currency, rate: rateToUSD, success: true });
        } else {
          results.push({ currency, success: false, error: 'Invalid API response' });
        }
      } catch (err) {
        console.error(`Failed to fetch ${currency} rate:`, err);
        results.push({ currency, success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      date: today,
      results
    });
  } catch (error) {
    console.error('Fetch exchange rates error:', error);
    res.status(500).json({ error: 'Failed to fetch exchange rates' });
  }
});

// ===================== USER PROFILE ENDPOINTS =====================

// Get user profile
app.get('/api/users/:username', async (req, res, next) => {
  try {
    const { username } = req.params;

    // This catch-all is registered before /api/users/search and would swallow it
    // (returning "User not found" for every @mention lookup). Hand off instead.
    if (username === 'search') return next();

    let users;
    
    // Handle ID-based lookup (format: "id:123")
    if (username.startsWith('id:')) {
      const userId = username.substring(3);
      [users] = await db.execute(
        `SELECT id, email, name, github_username, intranet_username, avatar_url, bio,
                department, position, company, company_email, role, created_at, last_login, calendar_link,
                email_notification_preference, agent_embed_code, email_provider, account_type
         FROM users WHERE id = ?`,
        [userId]
      );
    } else {
      // Handle username-based lookup (ONLY intranet_username, no github_username fallback)
      [users] = await db.execute(
        `SELECT id, email, name, github_username, intranet_username, avatar_url, bio,
                department, position, company, company_email, role, created_at, last_login, calendar_link,
                email_notification_preference, agent_embed_code, email_provider, account_type
         FROM users WHERE intranet_username = ?`,
        [username]
      );
      // An AI agent's @handle can differ from its username, so
      // /profile/<handle> resolves too.
      if (users.length === 0) {
        [users] = await db.execute(
          `SELECT u.id, u.email, u.name, u.github_username, u.intranet_username, u.avatar_url, u.bio,
                  u.department, u.position, u.company, u.company_email, u.role, u.created_at, u.last_login, u.calendar_link,
                  u.email_notification_preference, u.agent_embed_code, u.email_provider, u.account_type
           FROM ai_agents a JOIN users u ON u.id = a.user_id WHERE a.handle = ?`,
          [username]
        );
      }
    }
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];

    if (user.account_type === 'ai_agent') {
      const [agentRows] = await db.execute(
        `SELECT handle, kind, tagline, description, elevenlabs_agent_id, skill_command, skill_url, responds_to_mentions
         FROM ai_agents WHERE user_id = ?`,
        [user.id]
      );
      user.ai_agent = agentRows[0] || null;
      // Agent accounts are not mailboxes; don't show the placeholder address.
      if (user.role === 'system') user.email = null;
    }
    
    // Get user's posts
    const [posts] = await db.execute(
      'SELECT id, title, slug, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [user.id]
    );
    
    // Get user's GitHub issues
    const [issues] = await db.execute(
      'SELECT * FROM github_issues WHERE assignee_github_username = ? ORDER BY updated_at DESC LIMIT 10',
      [username]
    );

    // Get user's total investment
    const [investmentData] = await db.execute(`
      SELECT COALESCE(SUM(
        CASE
          WHEN d.type = 'member_payment' AND d.user_id = ? THEN d.amount * d.risk_multiplier
          WHEN d.type = 'member_payment' AND d.nominee_user_id = ? THEN -(d.amount * d.risk_multiplier)
          WHEN d.type != 'member_payment' AND (d.user_id = ? OR d.nominee_user_id = ?)
            THEN COALESCE(d.theoretical_value_usd, d.amount, 0)
          ELSE 0
        END
      ), 0) as total_investment
      FROM deliverables d
      WHERE (d.user_id = ? OR d.nominee_user_id = ?) AND d.status IN ('approved', 'paid')
    `, [user.id, user.id, user.id, user.id, user.id, user.id]);

    user.posts = posts;
    user.github_issues = issues;
    user.total_investment = parseFloat(investmentData[0]?.total_investment || 0);

    res.json(user);
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Update user profile
app.put('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user is updating their own profile or is admin
    if (req.user.userId !== parseInt(userId) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const { email, other_emails, bio, department, position, company, intranet_username, github_username, calendar_link, email_notification_preference, agent_embed_code, email_provider } = req.body;

    // Email & calendar provider: only update when the client sent one (older clients /
    // the mobile app omit it). COALESCE below keeps the stored value on null.
    if (email_provider && !EMAIL_PROVIDERS.includes(email_provider)) {
      return res.status(400).json({ error: `Invalid email provider. Choose one of: ${EMAIL_PROVIDERS.join(', ')}` });
    }
    const emailProviderValue = email_provider || null;
    
    // Check if email is unique and not a company email (if provided)
    if (email && email.trim()) {
      const trimmedEmail = email.trim().toLowerCase();

      // Prevent company email addresses for personal email
      if (COMPANY_EMAIL_DOMAIN && trimmedEmail.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
        return res.status(400).json({ error: `Personal email cannot be a @${COMPANY_EMAIL_DOMAIN} address. Use a personal email like Gmail, Yahoo, etc.` });
      }
      
      const [existingEmailUsers] = await db.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [trimmedEmail, userId]
      );
      
      if (existingEmailUsers.length > 0) {
        return res.status(400).json({ error: 'Email address already in use' });
      }
    }

    // Check if intranet_username is unique (if provided)
    if (intranet_username && intranet_username.trim()) {
      const [existingUsers] = await db.execute(
        'SELECT id FROM users WHERE intranet_username = ? AND id != ?',
        [intranet_username.trim(), userId]
      );
      
      if (existingUsers.length > 0) {
        return res.status(400).json({ error: 'Intranet username already taken' });
      }
    }
    
    // Validate calendar link if provided
    if (calendar_link && calendar_link.trim()) {
      const urlPattern = /^https?:\/\/.+/;
      if (!urlPattern.test(calendar_link.trim())) {
        return res.status(400).json({ error: 'Calendar link must be a valid URL starting with http:// or https://' });
      }
    }
    
    // Update user profile (only update email if provided)
    if (email && email.trim()) {
      await db.execute(
        'UPDATE users SET email = ?, other_emails = ?, bio = ?, department = ?, position = ?, company = ?, intranet_username = ?, github_username = ?, calendar_link = ?, email_notification_preference = ?, agent_embed_code = ?, email_provider = COALESCE(?, email_provider) WHERE id = ?',
        [email.trim().toLowerCase(), other_emails?.trim() || null, bio, department, position, company, intranet_username?.trim() || null, github_username?.trim() || null, calendar_link?.trim() || null, email_notification_preference || 'company', agent_embed_code?.trim() || null, emailProviderValue, userId]
      );
    } else {
      await db.execute(
        'UPDATE users SET other_emails = ?, bio = ?, department = ?, position = ?, company = ?, intranet_username = ?, github_username = ?, calendar_link = ?, email_notification_preference = ?, agent_embed_code = ?, email_provider = COALESCE(?, email_provider) WHERE id = ?',
        [other_emails?.trim() || null, bio, department, position, company, intranet_username?.trim() || null, github_username?.trim() || null, calendar_link?.trim() || null, email_notification_preference || 'company', agent_embed_code?.trim() || null, emailProviderValue, userId]
      );
    }
    
    res.json({ message: 'Profile updated' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change user password with email sync
app.put('/api/users/:userId/password', authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const { userId } = req.params;
    const { currentPassword, newPassword } = req.body;
    
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    // Check if user is updating their own password or is admin
    if (req.user.userId !== parseInt(userId) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Get user details
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];
    
    // Verify current password (unless admin is changing another user's password)
    if (req.user.userId === parseInt(userId)) {
      const passwordMatch = await bcrypt.compare(currentPassword, user.password);
      if (!passwordMatch) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update user password
    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );
    
    // Check if user has company email account and sync password
    const [userAccount] = await db.execute(
      'SELECT u.company_email, s.server_username FROM users u LEFT JOIN server_email_accounts s ON u.id = s.linked_user_id WHERE u.id = ?',
      [userId]
    );
    
    let emailPasswordSynced = false;
    let calendarPasswordSynced = false;

    if (userAccount[0] && userAccount[0].company_email && userAccount[0].server_username) {
      try {
        console.log(`Syncing password for company email: ${userAccount[0].company_email}`);

        // Update password on mail server via SSH
        await execAsync(`echo '${userAccount[0].server_username}:${newPassword}' | sudo chpasswd`);

        // Encrypt and store the new password (using same method as webmail)
        const encryptedPassword = emailCrypto.encryptPassword(newPassword);

        // Update encrypted password in database
        await db.execute(
          'UPDATE server_email_accounts SET email_password_encrypted = ? WHERE linked_user_id = ?',
          [encryptedPassword, userId]
        );

        emailPasswordSynced = true;
        console.log(`✅ Password synced for company email: ${userAccount[0].company_email}`);

      } catch (emailSyncError) {
        console.error(`Failed to sync email password for ${userAccount[0].company_email}:`, emailSyncError);
        // Don't fail the entire process if email sync fails
      }
    }

    // Sync password with Nextcloud/CalDAV
    if (userAccount[0] && userAccount[0].company_email) {
      try {
        const nextcloudUsername = userAccount[0].company_email.split('@')[0];
        console.log(`Syncing password for Nextcloud user: ${nextcloudUsername}`);

        // Update Nextcloud password using occ command
        // Use OC_PASS environment variable with sudo
        await execAsync(`sudo OC_PASS='${newPassword.replace(/'/g, "'\\''")}' -u www-data php /var/www/nextcloud/occ user:resetpassword --password-from-env "${nextcloudUsername}"`);

        calendarPasswordSynced = true;
        console.log(`✅ Password synced for Nextcloud user: ${nextcloudUsername}`);

      } catch (nextcloudSyncError) {
        console.error(`Failed to sync Nextcloud password:`, nextcloudSyncError);
        // Don't fail the entire process if Nextcloud sync fails
      }
    }
    
    // Send confirmation DM
    const emailSyncStatus = emailPasswordSynced && userAccount[0]?.company_email ?
      `\n\n## 📧 Email Password Also Updated
Your **${userAccount[0].company_email}** email password has been automatically synced with your intranet password.

**Email clients will need to be updated** with your new password:
- iPhone/iPad Mail
- Outlook
- Apple Mail
- Thunderbird
- Any other configured email clients` : '';

    const calendarSyncStatus = calendarPasswordSynced && userAccount[0]?.company_email ?
      `\n\n## 📅 Calendar/CalDAV Password Also Updated
Your **Nextcloud Calendar** password has been automatically synced with your intranet password.

**CalDAV clients will need to be updated** with your new password:
- Apple Calendar
- Google Calendar (CalDAV)
- Thunderbird Calendar
- Mobile calendar apps
- **Access**: https://calendar.${COMPANY_EMAIL_DOMAIN}
- **Username**: ${userAccount[0].company_email.split('@')[0]}` : '';

    const confirmationMessage = `# ✅ Password Successfully Changed

Hi ${user.name},

Your password has been successfully changed for your account: **${user.email}**

## 🔐 Security Confirmation
- Changed at: ${new Date().toLocaleString()}
- Method: Profile password change
- Status: Active${emailSyncStatus}${calendarSyncStatus}

## 🚨 Didn't change your password?
If you didn't make this change, contact an admin immediately as your account may be compromised.

---
*Intranet Security System*`;

    // Find or create conversation with system user
    const conversationResult = await db.execute(`
      SELECT id FROM dm_conversations 
      WHERE (user1_id = 1 AND user2_id = ?) OR (user1_id = ? AND user2_id = 1)
    `, [userId, userId]);
    
    let conversationId;
    if (conversationResult[0].length > 0) {
      conversationId = conversationResult[0][0].id;
    } else {
      const [newConv] = await db.execute(
        'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
        [1, userId]
      );
      conversationId = newConv.insertId;
    }
    
    // Send confirmation message
    const messageHtml = DOMPurify.sanitize(marked.parse(confirmationMessage));
    
    await db.execute(`
      INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
      VALUES (?, ?, ?, ?, ?)
    `, [conversationId, 1, userId, confirmationMessage, messageHtml]);
    
    console.log(`Password changed for user ${user.email} ${emailPasswordSynced ? 'with email sync' : ''} ${calendarPasswordSynced ? 'with calendar sync' : ''}`);

    res.json({
      message: 'Password changed successfully',
      emailSynced: emailPasswordSynced,
      calendarSynced: calendarPasswordSynced,
      companyEmail: userAccount[0]?.company_email || null
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Upload profile picture
app.post('/api/users/:userId/avatar', authenticateToken, (req, res, next) => {
  req.uploadType = 'avatars';
  next();
}, upload.single('avatar'), async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check if user is updating their own profile or is admin
    if (req.user.userId !== parseInt(userId) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Process image with Sharp
    const filename = `avatar-${userId}-${Date.now()}.jpg`;
    const outputPath = path.join(__dirname, 'uploads', 'avatars', filename);
    
    await sharp(req.file.path)
      .resize(200, 200)
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    // Remove original uploaded file
    await fs.unlink(req.file.path);

    // Update user avatar URL in database
    const avatarUrl = `/uploads/avatars/${filename}`;
    await db.execute(
      'UPDATE users SET avatar_url = ? WHERE id = ?',
      [avatarUrl, userId]
    );

    res.json({ 
      message: 'Profile picture updated',
      avatar_url: avatarUrl 
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload profile picture' });
  }
});

// Upload image from clipboard paste
app.post('/api/upload/image', authenticateToken, (req, res, next) => {
  req.uploadType = 'images';
  next();
}, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Process image with Sharp - resize if too large
    const filename = `image-${req.user.userId}-${Date.now()}.jpg`;
    const outputPath = path.join(__dirname, 'uploads', 'images', filename);
    
    await sharp(req.file.path)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    // Remove original uploaded file
    await fs.unlink(req.file.path);

    const imageUrl = `/uploads/images/${filename}`;
    res.json({
      message: 'Image uploaded successfully',
      url: imageUrl,
      markdown: `![Image](${imageUrl})`
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// API-token image upload (mirrors /api/upload/image, but guarded by an API token
// instead of a user JWT). Lets token-only clients — native apps, the Chrome
// extension, Jenkins automation — host a screenshot's bytes before embedding it
// in a forum post.
app.post('/api/v1/upload/image', authenticateApiToken, (req, res, next) => {
  req.uploadType = 'images';
  next();
}, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Process image with Sharp - resize if too large
    const filename = `image-${req.user.userId}-${Date.now()}.jpg`;
    const outputPath = path.join(__dirname, 'uploads', 'images', filename);

    await sharp(req.file.path)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(outputPath);

    // Remove original uploaded file
    await fs.unlink(req.file.path);

    const imageUrl = `/uploads/images/${filename}`;
    res.json({
      message: 'Image uploaded successfully',
      url: imageUrl,
      markdown: `![Image](${imageUrl})`
    });
  } catch (error) {
    console.error('API image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload attachment for forum posts
app.post('/api/posts/attachment', authenticateToken, (req, res, next) => {
  req.uploadType = 'forum-attachments';
  next();
}, upload.single('attachment'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique filename
    const ext = path.extname(req.file.originalname);
    const filename = `attachment-${req.user.userId}-${Date.now()}${ext}`;
    const newPath = path.join(__dirname, 'uploads', 'forum-attachments', filename);

    // Move file to final location
    await fs.rename(req.file.path, newPath);

    res.json({
      message: 'Attachment uploaded successfully',
      filename: filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      url: `/uploads/forum-attachments/${filename}`
    });
  } catch (error) {
    console.error('Attachment upload error:', error);
    res.status(500).json({ error: 'Failed to upload attachment' });
  }
});

// Delete attachment for forum posts
app.delete('/api/posts/attachment/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;

    // Security check: ensure filename doesn't contain path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    const filePath = path.join(__dirname, 'uploads', 'forum-attachments', filename);

    // Check if file exists
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      res.json({ message: 'Attachment deleted successfully' });
    } catch (error) {
      res.status(404).json({ error: 'Attachment not found' });
    }
  } catch (error) {
    console.error('Attachment delete error:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

// ===================== GITHUB INTEGRATION ENDPOINTS =====================

// Manual GitHub sync trigger (uses intelligent sync)
app.post('/api/github/sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return res.status(400).json({ error: 'GitHub token not configured' });
    }
    
    await intelligentGitHubSync();
    
    // Get sync stats
    const [syncStats] = await db.execute(
      'SELECT COUNT(*) as total_issues, MAX(synced_at) as last_sync FROM github_issues'
    );
    
    res.json({ 
      message: 'GitHub sync completed successfully',
      total_issues: syncStats[0]?.total_issues || 0,
      last_sync: syncStats[0]?.last_sync
    });
  } catch (error) {
    console.error('GitHub sync error:', error);
    res.status(500).json({ error: 'Failed to sync GitHub issues' });
  }
});

// Get user's GitHub issues
app.get('/api/github/issues/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    const [issues] = await db.execute(
      'SELECT * FROM github_issues WHERE assignee_github_username = ? ORDER BY updated_at DESC',
      [username]
    );
    
    res.json(issues);
  } catch (error) {
    console.error('Get GitHub issues error:', error);
    res.status(500).json({ error: 'Failed to fetch GitHub issues' });
  }
});

// ===================== NOTIFICATIONS ENDPOINTS =====================

// Get user notifications
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const [notifications] = await db.execute(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.userId]
    );
    
    res.json(notifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    await db.execute(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [id, req.user.userId]
    );
    
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification' });
  }
});

// Mark all notifications as read
app.put('/api/notifications/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const result = await db.execute(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [req.user.userId]
    );
    
    res.json({ 
      message: 'All notifications marked as read',
      updated_count: result.affectedRows
    });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// ===================== SEARCH ENDPOINT =====================

// Global search
app.get('/api/search', authenticateToken, async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    
    const results = {};
    
    // Search posts
    if (type === 'all' || type === 'posts') {
      let postsQuery, postsParams;

      if (q) {
        // Use combined FULLTEXT and LIKE search for better results
        // FULLTEXT search gives relevance scores, LIKE catches exact matches
        postsQuery = `
          SELECT DISTINCT p.*, u.name as author_name, u.github_username,
            CASE
              WHEN p.title LIKE ? THEN 10  -- Exact title match gets highest score
              WHEN p.title LIKE ? THEN 5   -- Title contains term
              WHEN MATCH(p.title, p.content) AGAINST(? IN NATURAL LANGUAGE MODE) > 0
                THEN MATCH(p.title, p.content) AGAINST(? IN NATURAL LANGUAGE MODE)
              WHEN p.content LIKE ? THEN 1  -- Content contains term
              ELSE 0
            END as relevance_score
          FROM posts p
          JOIN users u ON p.user_id = u.id
          WHERE (
            MATCH(p.title, p.content) AGAINST(? IN NATURAL LANGUAGE MODE)
            OR p.title LIKE ?
            OR p.content LIKE ?
          )
          ORDER BY relevance_score DESC, p.created_at DESC
          LIMIT 20`;
        postsParams = [
          q,           // For exact title match
          `%${q}%`,    // For title LIKE
          q,           // For MATCH AGAINST (case)
          q,           // For MATCH AGAINST (score)
          `%${q}%`,    // For content LIKE
          q,           // For WHERE MATCH AGAINST
          `%${q}%`,    // For WHERE title LIKE
          `%${q}%`     // For WHERE content LIKE
        ];
      } else {
        // Return all posts when no query
        postsQuery = `SELECT p.*, u.name as author_name, u.github_username
                     FROM posts p
                     JOIN users u ON p.user_id = u.id
                     ORDER BY p.created_at DESC
                     LIMIT 20`;
        postsParams = [];
      }

      const [posts] = await db.execute(postsQuery, postsParams);
      results.posts = posts;
    }
    
    // Search comments
    if (type === 'all' || type === 'comments') {
      let commentsQuery, commentsParams;

      if (q) {
        // Use combined FULLTEXT and LIKE search for comments
        commentsQuery = `
          SELECT DISTINCT c.*, p.title as post_title, p.slug as post_slug,
            u.name as author_name, u.github_username,
            CASE
              WHEN c.content LIKE ? THEN 5   -- Exact match in comment
              WHEN MATCH(c.content) AGAINST(? IN NATURAL LANGUAGE MODE) > 0
                THEN MATCH(c.content) AGAINST(? IN NATURAL LANGUAGE MODE)
              WHEN c.content LIKE ? THEN 1  -- Contains term
              ELSE 0
            END as relevance_score
          FROM comments c
          JOIN posts p ON c.post_id = p.id
          JOIN users u ON c.user_id = u.id
          WHERE (
            MATCH(c.content) AGAINST(? IN NATURAL LANGUAGE MODE)
            OR c.content LIKE ?
          )
          ORDER BY relevance_score DESC, c.created_at DESC
          LIMIT 20`;
        commentsParams = [
          q,           // For exact content match
          q,           // For MATCH AGAINST (case)
          q,           // For MATCH AGAINST (score)
          `%${q}%`,    // For content LIKE
          q,           // For WHERE MATCH AGAINST
          `%${q}%`     // For WHERE content LIKE
        ];
      } else {
        // Return recent comments when no query
        commentsQuery = `SELECT c.*, p.title as post_title, p.slug as post_slug,
                        u.name as author_name, u.github_username
                       FROM comments c
                       JOIN posts p ON c.post_id = p.id
                       JOIN users u ON c.user_id = u.id
                       ORDER BY c.created_at DESC
                       LIMIT 20`;
        commentsParams = [];
      }

      const [comments] = await db.execute(commentsQuery, commentsParams);
      results.comments = comments;
    }
    
    // Search users
    if (type === 'all' || type === 'users') {
      let usersQuery, usersParams;

      if (q) {
        // Search with query - include last_login for activity status
        // Match on identity fields AND profile text (bio, position, department,
        // company) so a query like "WorkSafeBC" finds people who mention it in
        // their bio, not only people named that. Name/handle matches sort first.
        usersQuery = `SELECT id, name, github_username, intranet_username, avatar_url, department, position, company, bio, role, last_login,
                      CASE
                        WHEN role = 'pending_agreement' THEN 'pending'
                        WHEN last_login IS NULL THEN 'pending'
                        WHEN last_login >= DATE_SUB(NOW(), INTERVAL 10 DAY) THEN 'active'
                        ELSE 'inactive'
                      END as activity_status,
                      CASE
                        WHEN name LIKE ? OR github_username LIKE ? OR intranet_username LIKE ? OR email LIKE ? THEN 2
                        ELSE 1
                      END as relevance_score
                     FROM users
                     WHERE (name LIKE ? OR github_username LIKE ? OR intranet_username LIKE ? OR email LIKE ?
                            OR bio LIKE ? OR position LIKE ? OR department LIKE ? OR company LIKE ?)
                       AND role != 'deactivated' AND account_type = 'human'
                     ORDER BY relevance_score DESC, name ASC
                     LIMIT 100`;
        const uTerm = `%${q}%`;
        usersParams = [uTerm, uTerm, uTerm, uTerm, uTerm, uTerm, uTerm, uTerm, uTerm, uTerm, uTerm, uTerm];
      } else {
        // Return all active users when no query - include last_login for activity status
        usersQuery = `SELECT id, name, github_username, intranet_username, avatar_url, department, position, role, last_login,
                      CASE
                        WHEN role = 'pending_agreement' THEN 'pending'
                        WHEN last_login IS NULL THEN 'pending'
                        WHEN last_login >= DATE_SUB(NOW(), INTERVAL 10 DAY) THEN 'active'
                        ELSE 'inactive'
                      END as activity_status
                     FROM users
                     WHERE role != 'deactivated' AND account_type = 'human'
                     ORDER BY name ASC
                     LIMIT 100`;
        usersParams = [];
      }

      const [users] = await db.execute(usersQuery, usersParams);
      results.users = users;
    }

    // Search AI agents — their own category, never mixed into people.
    if (type === 'all' || type === 'agents') {
      const aTerm = `%${q || ''}%`;
      const [agents] = await db.execute(
        `SELECT u.id, u.name, u.intranet_username, u.avatar_url, u.bio,
                a.handle, a.kind, a.tagline, a.elevenlabs_agent_id, a.skill_command, a.skill_url
         FROM ai_agents a JOIN users u ON u.id = a.user_id
         WHERE u.account_type = 'ai_agent'
           AND (u.name LIKE ? OR a.handle LIKE ? OR a.tagline LIKE ? OR a.description LIKE ?)
         ORDER BY a.sort_order, u.name`,
        [aTerm, aTerm, aTerm, aTerm]
      );
      results.agents = agents;
    }

    // Search investments (deliverables) - only approved records are viewable by all
    if (type === 'all' || type === 'investments') {
      let investmentsQuery, investmentsParams;

      if (q) {
        // Search with query - only show approved records to everyone
        investmentsQuery = `
          SELECT DISTINCT d.id, d.title, d.content, d.amount, d.original_amount,
                 d.original_currency, d.exchange_rate, d.risk_multiplier,
                 d.status, d.deliverable_date, d.created_at, d.investment_category,
                 (d.original_amount * d.exchange_rate * d.risk_multiplier) as theoretical_value_usd,
                 u.name as user_name, u.github_username,
                 n.name as nominee_name,
            CASE
              WHEN d.title LIKE ? THEN 10  -- Exact title match gets highest score
              WHEN d.title LIKE ? THEN 5   -- Title contains term
              WHEN d.content LIKE ? THEN 1  -- Content contains term
              ELSE 0
            END as relevance_score
          FROM deliverables d
          JOIN users u ON d.user_id = u.id
          LEFT JOIN users n ON d.nominee_user_id = n.id
          WHERE (
            d.title LIKE ?
            OR d.content LIKE ?
          )
          AND d.status = 'approved'
          AND d.type != 'member_payment'
          ORDER BY relevance_score DESC, d.created_at DESC
          LIMIT 20`;
        investmentsParams = [
          q,           // For exact title match
          `%${q}%`,    // For title LIKE
          `%${q}%`,    // For content LIKE
          `%${q}%`,    // For WHERE title LIKE
          `%${q}%`     // For WHERE content LIKE
        ];
      } else {
        // Return recent approved investments when no query
        investmentsQuery = `
          SELECT d.id, d.title, d.content, d.amount, d.original_amount,
                 d.original_currency, d.exchange_rate, d.risk_multiplier,
                 d.status, d.deliverable_date, d.created_at, d.investment_category,
                 (d.original_amount * d.exchange_rate * d.risk_multiplier) as theoretical_value_usd,
                 u.name as user_name, u.github_username,
                 n.name as nominee_name
          FROM deliverables d
          JOIN users u ON d.user_id = u.id
          LEFT JOIN users n ON d.nominee_user_id = n.id
          WHERE d.status = 'approved'
          AND d.type != 'member_payment'
          ORDER BY d.created_at DESC
          LIMIT 20`;
        investmentsParams = [];
      }

      const [investments] = await db.execute(investmentsQuery, investmentsParams);
      results.investments = investments;
    }

    // Search tasks (title + description). Tasks are visible to every signed-in
    // member (same as GET /api/tasks), so no per-user filter here.
    if (type === 'all' || type === 'tasks') {
      const taskSelect = `
        SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
               t.created_by, t.assigned_to, t.created_at, t.updated_at,
               creator.name as creator_name, creator.intranet_username as creator_username,
               assignee.name as assignee_name, assignee.intranet_username as assignee_username`;
      const taskFrom = `
        FROM tasks t
        LEFT JOIN users creator ON t.created_by = creator.id
        LEFT JOIN users assignee ON t.assigned_to = assignee.id`;
      let tasksQuery, tasksParams;

      if (q) {
        tasksQuery = `${taskSelect},
            CASE
              WHEN t.title LIKE ? THEN 10
              WHEN t.title LIKE ? THEN 5
              WHEN t.description LIKE ? THEN 1
              ELSE 0
            END as relevance_score
          ${taskFrom}
          WHERE (t.title LIKE ? OR t.description LIKE ?)
          ORDER BY relevance_score DESC, t.created_at DESC
          LIMIT 20`;
        tasksParams = [q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
      } else {
        tasksQuery = `${taskSelect} ${taskFrom} ORDER BY t.created_at DESC LIMIT 20`;
        tasksParams = [];
      }

      const [tasks] = await db.execute(tasksQuery, tasksParams);
      results.tasks = tasks;
    }

    // Search ledger entries. Same columns as the free-text filter on
    // GET /api/ledger and the same access rule: admins see every entry,
    // everyone else only entries they submitted or are the payee of.
    if (type === 'all' || type === 'ledger') {
      const ledgerSelect = `
        SELECT l.id, l.user_id, l.payee_user_id, l.title, l.description, l.vendor_name,
               l.receipt_number, l.expense_category, l.status, l.is_draft, l.project_code,
               l.expense_date, l.amount, l.total_with_tax, l.original_amount, l.original_currency,
               l.created_at,
               u.name as user_name, p.name as payee_name`;
      const ledgerFrom = `
        FROM ledger l
        JOIN users u ON l.user_id = u.id
        LEFT JOIN users p ON l.payee_user_id = p.id`;
      const ledgerConditions = [];
      const ledgerParams = [];
      let ledgerScore = '';

      if (q) {
        const term = `%${q}%`;
        ledgerScore = `,
            CASE
              WHEN l.title LIKE ? THEN 10
              WHEN l.title LIKE ? THEN 5
              WHEN l.vendor_name LIKE ? THEN 4
              WHEN l.description LIKE ? THEN 1
              ELSE 0
            END as relevance_score`;
        ledgerParams.push(q, term, term, term);
        ledgerConditions.push(`(l.title LIKE ? OR l.vendor_name LIKE ? OR l.receipt_number LIKE ?
             OR l.payment_reference LIKE ? OR l.payment_method LIKE ? OR l.project_code LIKE ?
             OR l.description LIKE ? OR l.content LIKE ? OR CAST(l.amount AS CHAR) LIKE ?
             OR CAST(l.total_with_tax AS CHAR) LIKE ? OR CAST(l.original_amount AS CHAR) LIKE ?)`);
        ledgerParams.push(term, term, term, term, term, term, term, term, term, term, term);
      }

      if (req.user.role !== 'admin') {
        ledgerConditions.push('(l.user_id = ? OR l.payee_user_id = ?)');
        ledgerParams.push(req.user.userId, req.user.userId);
      }

      const ledgerWhere = ledgerConditions.length ? ` WHERE ${ledgerConditions.join(' AND ')}` : '';
      const ledgerOrder = q
        ? ' ORDER BY relevance_score DESC, l.expense_date DESC, l.created_at DESC'
        : ' ORDER BY l.expense_date DESC, l.created_at DESC';

      const [ledger] = await db.execute(
        `${ledgerSelect}${ledgerScore}${ledgerFrom}${ledgerWhere}${ledgerOrder} LIMIT 20`,
        ledgerParams
      );
      results.ledger = ledger;
    }

    // Search GitHub-hosted docs (server/cron/sweepGithubDocs.js keeps this table
    // in sync with the doc repos). These are stubs, not intranet content: a hit
    // sends the member to /docs/:id, whose only real affordance is an "Access
    // now" button pointing at GitHub or the public help site.
    //
    // ACCESS CONTROL: github_docs.visibility='admin' rows are the admin-only
    // legal corpus. Non-admins must not see them at all — not the row, not the
    // title, not a count — so the predicate goes in the WHERE clause rather than
    // being applied after the fact. `body` is deliberately NOT selected: it is
    // indexed for matching only and would otherwise ship legal text to clients.
    if (type === 'all' || type === 'docs') {
      const docsSelect = `
        SELECT id, repo, path, collection, title, summary, access_url, github_url,
               word_count, doc_updated_at, updated_at`;
      const docsConditions = [];
      const docsParams = [];
      let docsScore = '';

      if (req.user.role !== 'admin') {
        docsConditions.push("visibility = 'member'");
      }

      if (q) {
        const term = `%${q}%`;
        // Docs are prose, so word-order-sensitive LIKE is the wrong primary
        // matcher: `LIKE '%mute duck%'` misses a document titled "Mute ... vs
        // ... Duck" purely because the words aren't adjacent. FULLTEXT scores
        // the terms independently and ranks by relevance, which is what someone
        // typing two keywords actually means.
        //
        // LIKE is kept as an OR fallback because FULLTEXT alone would regress
        // two real cases: substring matches (a search for "webhook" finding
        // "webhooks" is fine, but "livekit" finding "LiveKitWorker" is not a
        // word boundary) and terms MySQL's parser drops — anything under
        // ft_min_token_size (default 3, so "AI", "s85") or on the stopword list.
        // An exact title hit still outranks everything via the CASE below.
        docsScore = `,
            CASE
              WHEN title LIKE ? THEN 1000
              WHEN title LIKE ? THEN 500
              ELSE 0
            END
            + (MATCH(title, summary, body) AGAINST(? IN NATURAL LANGUAGE MODE) * 10)
            + CASE WHEN path LIKE ? THEN 3 WHEN summary LIKE ? THEN 2 ELSE 0 END
            as relevance_score`;
        docsParams.push(q, term, q, term, term);
        docsConditions.push(`(MATCH(title, summary, body) AGAINST(? IN NATURAL LANGUAGE MODE)
             OR title LIKE ? OR path LIKE ? OR summary LIKE ? OR body LIKE ?)`);
        docsParams.push(q, term, term, term, term);
      }

      const docsWhere = docsConditions.length ? ` WHERE ${docsConditions.join(' AND ')}` : '';
      const docsOrder = q
        ? ' ORDER BY relevance_score DESC, title ASC'
        : ' ORDER BY collection ASC, title ASC';

      const [docs] = await db.execute(
        `${docsSelect}${docsScore} FROM github_docs${docsWhere}${docsOrder} LIMIT 20`,
        docsParams
      );
      results.docs = docs;
    }

    // Log search (only if there was a query)
    if (req.user && q) {
      const totalResults = (results.posts?.length || 0) +
                          (results.comments?.length || 0) +
                          (results.users?.length || 0) +
                          (results.investments?.length || 0) +
                          (results.tasks?.length || 0) +
                          (results.ledger?.length || 0) +
                          (results.docs?.length || 0);

      await db.execute(
        'INSERT INTO search_history (user_id, query, results_count) VALUES (?, ?, ?)',
        [req.user.userId, q, totalResults]
      );
    }

    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GitHub doc container page — the target of a `docs` search hit.
//
// Returns only what the container page renders: title, excerpt, provenance, and
// the "Access now" destination. The indexed `body` is never returned; it exists
// to make the row findable, not readable, and the actual document is read at
// access_url (GitHub / the public help site), which enforces its own auth.
//
// ACCESS CONTROL: admin-visibility rows (the admin-only corpus) 404 for
// non-admins rather than 403 — a 403 would confirm that a document with that id
// exists, which for this corpus is itself a disclosure.
app.get('/api/github-docs/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, repo, path, collection, visibility, title, summary,
              access_url, github_url, word_count, doc_updated_at, last_seen_at, updated_at
         FROM github_docs
        WHERE id = ?`,
      [req.params.id]
    );

    const doc = rows[0];
    if (!doc || (doc.visibility === 'admin' && req.user.role !== 'admin')) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(doc);
  } catch (error) {
    console.error('GitHub doc fetch error:', error);
    res.status(500).json({ error: 'Failed to load document' });
  }
});

// ---------------------------------------------------------------------------
// Search Adapters (Admin Panel → Search Adapters)
//
// Configures which GitHub repos server/cron/sweepGithubDocs.js indexes into
// intranet search. Every endpoint here is admin-only: a rule's `visibility`
// decides whether a whole corpus is member-visible, so these are effectively
// access-control settings, not cosmetic preferences.
//
// TOKENS ARE NEVER ACCEPTED OR RETURNED HERE. An adapter names the .env variable
// holding its PAT; the UI only ever learns whether that variable is set and
// whether it can read the repo (see the /check endpoint).
// ---------------------------------------------------------------------------

const ADAPTER_COLLECTIONS = ['internal', 'help', 'guide', 'exec'];
const ADAPTER_VISIBILITIES = ['member', 'admin'];
const ADAPTER_URL_MODES = ['github', 'site_path'];

// Shape/҃sanity-check a rule set coming from the client. Returns an error string,
// or null when the rules are usable.
function validateAdapterRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return 'At least one path rule is required';
  }
  for (const r of rules) {
    if (!r.path_prefix || typeof r.path_prefix !== 'string') return 'Each rule needs a path prefix';
    if (r.path_prefix.startsWith('/')) return `Path prefix must be relative (got "${r.path_prefix}")`;
    if (!ADAPTER_COLLECTIONS.includes(r.collection)) return `Unknown collection "${r.collection}"`;
    if (!ADAPTER_VISIBILITIES.includes(r.visibility)) return `Unknown visibility "${r.visibility}"`;
    if (!ADAPTER_URL_MODES.includes(r.access_url_mode)) return `Unknown link mode "${r.access_url_mode}"`;
    if (r.access_url_mode === 'site_path' && !r.url_path) {
      return 'A published-page rule needs a URL path segment (e.g. "help")';
    }
  }
  return null;
}

// List adapters with their rules and last-sweep status.
app.get('/api/search-adapters', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [adapters] = await db.execute(
      `SELECT a.*, u.name AS updated_by_name
         FROM search_adapters a
         LEFT JOIN users u ON a.updated_by = u.id
        ORDER BY a.repo`
    );
    const [rules] = await db.execute(
      'SELECT * FROM search_adapter_rules ORDER BY adapter_id, sort_order, id'
    );
    // Report token presence WITHOUT ever revealing the value.
    res.json(adapters.map(a => ({
      ...a,
      token_present: Boolean(process.env[a.token_env_var]),
      rules: rules.filter(r => r.adapter_id === a.id),
    })));
  } catch (error) {
    console.error('List search adapters error:', error);
    res.status(500).json({ error: 'Failed to load search adapters' });
  }
});

// Create an adapter plus its rules.
app.post('/api/search-adapters', authenticateToken, requireAdmin, async (req, res) => {
  const { repo, branch, label, token_env_var, site_base, enabled, rules } = req.body;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return res.status(400).json({ error: 'Repo must look like owner/name' });
  }
  const ruleError = validateAdapterRules(rules);
  if (ruleError) return res.status(400).json({ error: ruleError });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `INSERT INTO search_adapters (repo, branch, label, token_env_var, site_base, enabled, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [repo, branch || 'main', label || null, token_env_var || 'GITHUB_DOCS_TOKEN',
       site_base || null, enabled === false ? 0 : 1, req.user.userId]
    );
    const adapterId = result.insertId;
    let order = 0;
    for (const r of rules) {
      await conn.execute(
        `INSERT INTO search_adapter_rules
           (adapter_id, path_prefix, collection, visibility, access_url_mode, url_path, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [adapterId, r.path_prefix, r.collection, r.visibility,
         r.access_url_mode, r.url_path || null, order++]
      );
    }
    await conn.commit();
    res.status(201).json({ id: adapterId });
  } catch (error) {
    await conn.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That repo already has an adapter' });
    }
    console.error('Create search adapter error:', error);
    res.status(500).json({ error: 'Failed to create adapter' });
  } finally {
    conn.release();
  }
});

// Update an adapter. Rules are replaced wholesale when provided — simpler than
// diffing, and the sweep re-derives everything from them on the next run anyway.
app.put('/api/search-adapters/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { branch, label, token_env_var, site_base, enabled, rules } = req.body;
  if (rules !== undefined) {
    const ruleError = validateAdapterRules(rules);
    if (ruleError) return res.status(400).json({ error: ruleError });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.execute('SELECT id FROM search_adapters WHERE id = ?', [req.params.id]);
    if (!existing.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Adapter not found' });
    }

    await conn.execute(
      `UPDATE search_adapters
          SET branch = COALESCE(?, branch),
              label = ?,
              token_env_var = COALESCE(?, token_env_var),
              site_base = ?,
              enabled = COALESCE(?, enabled),
              updated_by = ?
        WHERE id = ?`,
      [branch || null, label || null, token_env_var || null, site_base || null,
       enabled === undefined ? null : (enabled ? 1 : 0), req.user.userId, req.params.id]
    );

    if (rules !== undefined) {
      await conn.execute('DELETE FROM search_adapter_rules WHERE adapter_id = ?', [req.params.id]);
      let order = 0;
      for (const r of rules) {
        await conn.execute(
          `INSERT INTO search_adapter_rules
             (adapter_id, path_prefix, collection, visibility, access_url_mode, url_path, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [req.params.id, r.path_prefix, r.collection, r.visibility,
           r.access_url_mode, r.url_path || null, order++]
        );
      }
    }

    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    console.error('Update search adapter error:', error);
    res.status(500).json({ error: 'Failed to update adapter' });
  } finally {
    conn.release();
  }
});

// Delete an adapter, and with it every document it contributed to search.
// The rows must go: leaving them would strand results pointing at a repo we no
// longer sweep, which would then never be reconciled or removed.
app.delete('/api/search-adapters/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT repo FROM search_adapters WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Adapter not found' });

    const [del] = await db.execute('DELETE FROM github_docs WHERE repo = ?', [rows[0].repo]);
    await db.execute('DELETE FROM search_adapters WHERE id = ?', [req.params.id]);
    res.json({ success: true, documents_removed: del.affectedRows });
  } catch (error) {
    console.error('Delete search adapter error:', error);
    res.status(500).json({ error: 'Failed to delete adapter' });
  }
});

// Connectivity check: can this adapter's configured token actually read the repo?
// Answers the question the UI cannot answer itself, without exposing the token.
app.post('/api/search-adapters/:id/check', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT repo, branch, token_env_var FROM search_adapters WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Adapter not found' });

    const { repo, branch, token_env_var } = rows[0];
    const token = process.env[token_env_var] || process.env.GITHUB_DOCS_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) {
      return res.json({ ok: false, reason: `${token_env_var} is not set in .env on the server` });
    }

    const ghRes = await fetch(`https://api.github.com/repos/${repo}/branches/${branch || 'main'}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'owtranet-doc-sweep',
      },
    });

    if (ghRes.ok) return res.json({ ok: true, reason: `Can read ${repo}@${branch || 'main'}` });
    if (ghRes.status === 404) {
      return res.json({ ok: false, reason: `Repo or branch not found, or the token cannot see it (404)` });
    }
    if (ghRes.status === 401) {
      return res.json({ ok: false, reason: `${token_env_var} is set but rejected by GitHub (401) — expired?` });
    }
    res.json({ ok: false, reason: `GitHub returned ${ghRes.status}` });
  } catch (error) {
    console.error('Check search adapter error:', error);
    res.status(500).json({ error: 'Failed to check adapter' });
  }
});

// Wiki link lookup - batch check which post titles exist
app.post('/api/wiki-links/lookup', authenticateToken, async (req, res) => {
  try {
    const { titles } = req.body;

    if (!titles || !Array.isArray(titles) || titles.length === 0) {
      return res.json({ links: {} });
    }

    // Limit to prevent abuse
    const limitedTitles = titles.slice(0, 50);

    // Build a query to find posts matching any of the titles (case-insensitive)
    const placeholders = limitedTitles.map(() => 'LOWER(title) = LOWER(?)').join(' OR ');
    const query = `SELECT id, title, slug FROM posts WHERE ${placeholders}`;

    const [posts] = await db.execute(query, limitedTitles);

    // Build a map of title (lowercase) -> post info
    const links = {};
    for (const title of limitedTitles) {
      const matchingPost = posts.find(p => p.title.toLowerCase() === title.toLowerCase());
      if (matchingPost) {
        links[title] = {
          exists: true,
          slug: matchingPost.slug,
          title: matchingPost.title
        };
      } else {
        links[title] = {
          exists: false
        };
      }
    }

    res.json({ links });
  } catch (error) {
    console.error('Wiki link lookup error:', error);
    res.status(500).json({ error: 'Wiki link lookup failed' });
  }
});

// ===================== DIRECT MESSAGING ENDPOINTS =====================

// Get user's conversations
app.get('/api/messages/conversations', authenticateToken, async (req, res) => {
  try {
    const [conversations] = await db.execute(`
      SELECT 
        c.id as conversation_id,
        c.updated_at,
        CASE 
          WHEN c.user1_id = ? THEN c.user2_id 
          ELSE c.user1_id 
        END as other_user_id,
        CASE 
          WHEN c.user1_id = ? THEN u2.name 
          ELSE u1.name 
        END as other_user_name,
        CASE 
          WHEN c.user1_id = ? THEN u2.github_username 
          ELSE u1.github_username 
        END as other_user_github,
        CASE 
          WHEN c.user1_id = ? THEN u2.avatar_url 
          ELSE u1.avatar_url 
        END as other_user_avatar,
        dm.content as last_message,
        dm.sender_id as last_sender_id,
        dm.created_at as last_message_at,
        COUNT(CASE WHEN dm_unread.is_read = FALSE AND dm_unread.recipient_id = ? THEN 1 END) as unread_count
      FROM dm_conversations c
      LEFT JOIN users u1 ON c.user1_id = u1.id
      LEFT JOIN users u2 ON c.user2_id = u2.id
      LEFT JOIN direct_messages dm ON c.id = dm.conversation_id 
        AND dm.id = (
          SELECT MAX(id) FROM direct_messages 
          WHERE conversation_id = c.id
        )
      LEFT JOIN direct_messages dm_unread ON c.id = dm_unread.conversation_id 
        AND dm_unread.recipient_id = ? AND dm_unread.is_read = FALSE
      WHERE c.user1_id = ? OR c.user2_id = ?
      GROUP BY c.id, c.updated_at, other_user_id, other_user_name, other_user_github, other_user_avatar, dm.content, dm.sender_id, dm.created_at
      ORDER BY c.updated_at DESC
    `, [req.user.userId, req.user.userId, req.user.userId, req.user.userId, req.user.userId, req.user.userId, req.user.userId, req.user.userId]);
    
    res.json(conversations);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages in a conversation
app.get('/api/messages/conversations/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Verify user has access to this conversation
    const [conversation] = await db.execute(
      'SELECT * FROM dm_conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [conversationId, req.user.userId, req.user.userId]
    );
    
    if (conversation.length === 0) {
      return res.status(403).json({ error: 'Access denied to this conversation' });
    }
    
    // Get messages
    const [messages] = await db.execute(`
      SELECT
        dm.id,
        dm.sender_id,
        dm.recipient_id,
        dm.content,
        dm.content_html,
        dm.is_read,
        dm.read_at,
        dm.deleted_at,
        dm.deleted_by,
        dm.created_at,
        dm.reply_to_id,
        u.name as sender_name,
        u.github_username as sender_github,
        u.avatar_url as sender_avatar,
        CASE WHEN rm.deleted_at IS NOT NULL THEN '(deleted)' ELSE rm.content END as reply_to_content,
        ru.name as reply_to_sender_name,
        COALESCE(SUM(l.value), 0) as total_likes,
        MAX(CASE WHEN l.user_id = ? THEN l.value ELSE 0 END) as user_vote
      FROM direct_messages dm
      JOIN users u ON dm.sender_id = u.id
      LEFT JOIN direct_messages rm ON rm.id = dm.reply_to_id
      LEFT JOIN users ru ON ru.id = rm.sender_id
      LEFT JOIN likes l ON l.likeable_type = 'message' AND l.likeable_id = dm.id
      WHERE dm.conversation_id = ?
      GROUP BY dm.id
      ORDER BY dm.created_at ASC
    `, [req.user.userId, conversationId]);
    
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a direct message
// Deliver a direct message from one member to another: find/create the
// conversation, insert the message, notify (in-app + email if offline).
// Shared by POST /api/messages/send (JWT) and POST /api/v1/messages/send (API
// token, used by the voice agent). Throws ApiError for caller mistakes.
async function deliverDirectMessage(senderId, recipientId, content, replyToId = null) {

  // Can't send message to yourself
  if (parseInt(recipientId) === senderId) {
    throw new ApiError(400, 'Cannot send message to yourself');
  }
  
  // Check if recipient exists
  const [recipient] = await db.execute(
    'SELECT id, name, account_type FROM users WHERE id = ?',
    [recipientId]
  );
  
  if (recipient.length === 0) {
    throw new ApiError(404, 'Recipient not found');
  }
  
  // Get sender's name and username (the caller context may not carry the name)
  const [sender] = await db.execute(
    'SELECT name, intranet_username FROM users WHERE id = ?',
    [senderId]
  );
  
  if (sender.length === 0) {
    throw new ApiError(404, 'Sender not found');
  }
  
  const senderName = sender[0].name;
  const senderUsername = sender[0].intranet_username;
  
  // Find or create conversation
  const [existingConv] = await db.execute(`
    SELECT id FROM dm_conversations 
    WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
  `, [senderId, recipientId, recipientId, senderId]);
  
  let conversationId;
  if (existingConv.length > 0) {
    conversationId = existingConv[0].id;
    // Update conversation timestamp
    await db.execute(
      'UPDATE dm_conversations SET updated_at = NOW() WHERE id = ?',
      [conversationId]
    );
  } else {
    // Create new conversation
    const [newConv] = await db.execute(
      'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
      [Math.min(senderId, recipientId), Math.max(senderId, recipientId)]
    );
    conversationId = newConv.insertId;
  }
  
  // A reply must point at a message in this same conversation — otherwise a
  // caller could quote a DM from a thread they cannot see, and the read query
  // would happily join it in and leak its content.
  let parentId = null;
  if (replyToId) {
    const [parent] = await db.execute(
      'SELECT id FROM direct_messages WHERE id = ? AND conversation_id = ?',
      [parseInt(replyToId), conversationId]
    );
    if (parent.length === 0) {
      throw new ApiError(400, 'Cannot reply to a message from another conversation');
    }
    parentId = parent[0].id;
  }

  // Process content (markdown to HTML with target="_blank" links)
  const contentHtml = markdownToHtml(content);

  // Insert message
  const [messageResult] = await db.execute(`
    INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html, reply_to_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [conversationId, senderId, recipientId, content, contentHtml, parentId]);
  
  // An AI agent answers the DM itself (agentResponder) — it has no inbox to
  // notify or e-mail.
  if (recipient[0].account_type === 'ai_agent') {
    const agentReplying = await agentResponder.handleDirectMessage({
      messageId: messageResult.insertId, conversationId, senderId, recipientId: parseInt(recipientId)
    });
    const message = await loadDirectMessage(messageResult.insertId);
    return { conversationId, message, agentReplying };
  }

  // Create notification for recipient
  await db.execute(`
    INSERT INTO notifications (user_id, type, title, message, data)
    VALUES (?, 'direct_message', ?, ?, ?)
  `, [
    recipientId,
    `New message from ${senderName}`,
    content.substring(0, 100) + (content.length > 100 ? '...' : ''),
    JSON.stringify({
      sender_id: senderId,
      sender_name: senderName,
      conversation_id: conversationId,
      message_id: messageResult.insertId
    })
  ]);
  
  // Send email notification to recipient if they're offline
  try {
    const [recipientData] = await db.execute(
      'SELECT email, name, company_email, last_login, email_notification_preference FROM users WHERE id = ?',
      [recipientId]
    );
    
    if (recipientData.length > 0) {
      const recipientUser = recipientData[0];
      const emailToUse = getNotificationEmail(recipientUser);
      
      // Check if user was online recently (within last 30 minutes)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const lastLogin = recipientUser.last_login ? new Date(recipientUser.last_login) : new Date(0);
      const isUserOffline = lastLogin < thirtyMinutesAgo;
      
      if (isUserOffline) {
        const messageUrl = `${process.env.BASE_URL}/messages?user=${senderUsername}`;
        
        const emailSubject = `💬 New Message from ${senderName} - ${SITE_NAME}`;
        const emailText = `Hi ${recipientUser.name},
        
You have received a new direct message from ${senderName} on the ${SITE_NAME}.

Message Preview:
"${content.substring(0, 200)}${content.length > 200 ? '...' : ''}"

Read and reply at: ${messageUrl}

You're receiving this email because you haven't been active on the intranet recently. Log in to stop receiving email notifications for messages.

Best regards,
${SITE_TEAM}`;

        const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 30px;">
            <h1 style="margin: 0; font-size: 28px;">💬 New Message</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">${SITE_NAME}</p>
          </div>
          
          <div style="margin-bottom: 25px;">
            <h2 style="color: #333; margin-bottom: 15px;">Hi ${recipientUser.name},</h2>
            <p style="margin-bottom: 15px;">You have received a new direct message from <strong>${senderName}</strong> on the ${SITE_NAME}.</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 20px; border-left: 4px solid #667eea; border-radius: 4px; margin-bottom: 25px;">
            <h3 style="margin: 0 0 10px 0; color: #555;">Message Preview:</h3>
            <p style="margin: 0; font-style: italic; color: #666;">"${content.substring(0, 200)}${content.length > 200 ? '...' : ''}"</p>
          </div>
          
          <div style="text-align: center; margin-bottom: 25px;">
            <a href="${messageUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">💬 Read & Reply</a>
          </div>
          
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin-bottom: 25px;">
            <p style="margin: 0; font-size: 14px; color: #856404;">
              📧 <strong>Email Notifications:</strong> You're receiving this email because you haven't been active on the intranet recently. Log in to stop receiving email notifications for messages.
            </p>
          </div>
          
          <div style="text-align: center; color: #6c757d; font-size: 14px; border-top: 1px solid #dee2e6; padding-top: 20px;">
            <p style="margin: 0;">Best regards,<br>${SITE_TEAM}</p>
          </div>
        </div>`;

        // Handle both single email and array of emails
        const emailsToSend = Array.isArray(emailToUse) ? emailToUse : [emailToUse];
        for (const email of emailsToSend) {
          await sendEmail(email, emailSubject, emailText, emailHtml);
        }
        console.log(`Direct message email notification sent to ${emailsToSend.join(', ')} for offline user ${recipientUser.name}`);
      } else {
        console.log(`User ${recipientUser.name} is online, skipping email notification for direct message`);
      }
    }
  } catch (emailError) {
    console.error('Failed to send direct message email notification:', emailError);
    // Don't fail the message sending if email fails
  }
  
  return { conversationId, message: await loadDirectMessage(messageResult.insertId), agentReplying: false };
}

// Post a group chat message on behalf of a sender (used by agentResponder to
// post an AI agent's reply back into the channel that tagged it). If the
// sender is not already a member, joins them ONLY when the group is public —
// same visibility gate as the API-token route's join-on-first-post (a private
// group must never gain a member just because someone typed its name in an
// @mention; ApiError(403) mirrors loadChatGroupForApi's response for a
// non-member posting into a private group). Returns { messageId }.
async function postGroupMessage(groupId, senderId, content, replyToId = null) {
  const [membership] = await db.execute('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, senderId]);
  if (membership.length === 0) {
    const [[group]] = await db.execute('SELECT visibility FROM `groups` WHERE id = ?', [groupId]);
    if (!group) throw new ApiError(404, 'Group not found');
    if (group.visibility !== 'public') {
      throw new ApiError(403, 'Not a member of this group');
    }
    await db.execute('INSERT INTO group_members (group_id, user_id, added_by) VALUES (?, ?, ?)', [groupId, senderId, senderId]);
  }
  const contentHtml = markdownToHtml(content);
  const [result] = await db.execute(
    'INSERT INTO group_messages (group_id, sender_id, content, content_html, reply_to_id) VALUES (?, ?, ?, ?, ?)',
    [groupId, senderId, content, contentHtml, replyToId || null]
  );
  const messageId = result.insertId;
  await db.execute(
    `INSERT INTO group_message_reads (group_id, user_id, last_read_message_id, last_read_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE last_read_message_id = ?, last_read_at = NOW()`,
    [groupId, senderId, messageId, messageId]
  );
  return { messageId };
}

// The complete message row as the clients render it.
async function loadDirectMessage(messageId) {
  const [newMessage] = await db.execute(`
    SELECT 
      dm.id,
      dm.sender_id,
      dm.recipient_id,
      dm.content,
      dm.content_html,
      dm.is_read,
      dm.read_at,
      dm.created_at,
      dm.reply_to_id,
      u.name as sender_name,
      u.github_username as sender_github,
      u.avatar_url as sender_avatar,
      CASE WHEN rm.deleted_at IS NOT NULL THEN '(deleted)' ELSE rm.content END as reply_to_content,
      ru.name as reply_to_sender_name
    FROM direct_messages dm
    JOIN users u ON dm.sender_id = u.id
    LEFT JOIN direct_messages rm ON rm.id = dm.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.sender_id
    WHERE dm.id = ?
  `, [messageId]);
  return newMessage[0];
}

app.post('/api/messages/send', authenticateToken, [
  body('recipient_id').isInt().notEmpty(),
  body('content').isLength({ min: 1, max: 2000 }).trim(),
  body('reply_to_id').optional({ nullable: true }).isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { recipient_id, content, reply_to_id } = req.body;
    const result = await deliverDirectMessage(req.user.userId, parseInt(recipient_id), content, reply_to_id);
    res.status(201).json({
      message: 'Message sent successfully',
      conversation_id: result.conversationId,
      data: result.message,
      agent_replying: !!result.agentReplying
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Mark messages as read
app.put('/api/messages/conversations/:conversationId/read', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    
    // Verify user has access to this conversation
    const [conversation] = await db.execute(
      'SELECT * FROM dm_conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [conversationId, req.user.userId, req.user.userId]
    );
    
    if (conversation.length === 0) {
      return res.status(403).json({ error: 'Access denied to this conversation' });
    }
    
    // Mark all messages as read for this user
    await db.execute(
      'UPDATE direct_messages SET is_read = TRUE, read_at = NOW() WHERE conversation_id = ? AND recipient_id = ? AND is_read = FALSE',
      [conversationId, req.user.userId]
    );
    
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Mark messages read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Get unread message count
app.get('/api/messages/unread-count', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.execute(
      'SELECT COUNT(*) as unread_count FROM direct_messages WHERE recipient_id = ? AND is_read = FALSE',
      [req.user.userId]
    );
    
    res.json({ unread_count: result[0].unread_count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Like/unlike a direct message
app.post('/api/messages/:messageId/like', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    // Check if message exists
    const [messages] = await db.execute(
      'SELECT id FROM direct_messages WHERE id = ?',
      [messageId]
    );

    if (messages.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user already liked this message
    const [existing] = await db.execute(
      'SELECT id, value FROM likes WHERE user_id = ? AND likeable_type = ? AND likeable_id = ?',
      [userId, 'message', messageId]
    );

    let newValue = 1;

    if (existing.length > 0) {
      // Toggle like/unlike
      newValue = existing[0].value === 1 ? 0 : 1;
      if (newValue === 0) {
        // Remove like entirely
        await db.execute('DELETE FROM likes WHERE id = ?', [existing[0].id]);
      } else {
        await db.execute('UPDATE likes SET value = ? WHERE id = ?', [newValue, existing[0].id]);
      }
    } else {
      // Create new like
      await db.execute(
        'INSERT INTO likes (user_id, likeable_type, likeable_id, value) VALUES (?, ?, ?, ?)',
        [userId, 'message', messageId, 1]
      );
    }

    // Get updated like count
    const [likeCount] = await db.execute(
      'SELECT COALESCE(SUM(value), 0) as total_likes FROM likes WHERE likeable_type = ? AND likeable_id = ?',
      ['message', messageId]
    );

    res.json({
      liked: newValue === 1,
      total_likes: parseInt(likeCount[0].total_likes),
      user_vote: newValue
    });
  } catch (error) {
    console.error('Like message error:', error);
    res.status(500).json({ error: 'Failed to like message' });
  }
});

// Delete (soft delete) a direct message
app.delete('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    // Check if message exists and user is the sender
    const [messages] = await db.execute(
      'SELECT id, sender_id, conversation_id FROM direct_messages WHERE id = ?',
      [messageId]
    );

    if (messages.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = messages[0];

    // Only the sender can delete their own message
    if (message.sender_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    // Soft delete: set deleted_at and deleted_by
    await db.execute(
      'UPDATE direct_messages SET deleted_at = NOW(), deleted_by = ? WHERE id = ?',
      [userId, messageId]
    );

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// ===================== PUBLIC API ENDPOINTS =====================

// Public API for external systems (Jenkins, CI/CD, alerts)
app.post('/api/v1/forum/posts', authenticateApiToken, [
  body('title').notEmpty().trim().isLength({ min: 5, max: 200 }),
  body('content').notEmpty().isLength({ min: 10, max: 50000 }),
  body('tags').optional().isArray(),
  body('author_name').optional().trim(),
  body('visibility').optional().isIn(['all_members', 'specific_members', 'author_only']),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }

  try {
    const { 
      title, 
      content, 
      tags = [], 
      author_name = 'System',
      visibility = 'all_members',
      priority = 'normal'
    } = req.body;

    // Generate slug for the post
    const slug = generateSlug(title) + '-' + Date.now();
    
    // Process content (markdown to HTML)
    const contentHtml = markdownToHtml(content);
    
    // Add priority indicator to title if not normal
    const finalTitle = priority !== 'normal' ? `[${priority.toUpperCase()}] ${title}` : title;
    
    // Create post using the authenticated user (from API token)
    const userId = req.user ? req.user.userId : 1; // fallback to admin if no user context
    const [result] = await db.execute(
      'INSERT INTO posts (user_id, title, content, content_html, slug, visibility) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, finalTitle, content, contentHtml, slug, visibility]
    );
    
    const postId = result.insertId;
    
    // Add system tag and provided tags
    const allTags = ['system-generated', ...tags];
    
    for (const tagName of allTags) {
      const tagSlug = generateSlug(tagName);
      
      // Insert or get tag
      await db.execute(
        'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
        [tagName, tagSlug]
      );
      
      const [tagRows] = await db.execute(
        'SELECT id FROM tags WHERE slug = ?',
        [tagSlug]
      );
      
      if (tagRows.length > 0) {
        await db.execute(
          'INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          [postId, tagRows[0].id]
        );
      }
    }
    
    // Log the API usage
    console.log(`API Post created: "${finalTitle}" via ${req.apiToken.name}`);
    
    res.status(201).json({
      success: true,
      message: 'Forum post created successfully',
      data: {
        postId,
        slug,
        title: finalTitle,
        url: `${process.env.BASE_URL}/forum/post/${slug}`,
        visibility,
        author_name,
        created_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API create post error:', error);
    res.status(500).json({ error: 'Failed to create forum post' });
  }
});

// Public API for deliverable submissions
app.post('/api/v1/deliverables', authenticateApiToken, [
  body('title').notEmpty().trim().isLength({ min: 5, max: 255 }),
  body('content').notEmpty().trim().isLength({ min: 10, max: 50000 }),
  body('amount').optional().isFloat({ min: 0 }),
  body('nominee_email').optional().isEmail(),
  body('nominee_github').optional().trim(),
  body('deliverable_date').optional().isDate(),
  body('tags').optional().isArray(),
  body('category').optional().isIn(['expense', 'customer', 'referral', 'contribution', 'other']),
  body('investment_category').optional().isIn(['cash', 'sweat_equity', 'property', 'referral'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }

  try {
    const {
      title,
      content,
      amount,
      nominee_email,
      nominee_github,
      deliverable_date,
      tags = [],
      category = 'contribution',
      investment_category = 'cash'
    } = req.body;

    // Find nominee user by email or github username
    let nomineeUserId = 1; // Default to system user

    if (nominee_email) {
      const [userByEmail] = await db.execute(
        'SELECT id FROM users WHERE email = ? AND role != "deactivated"',
        [nominee_email]
      );
      if (userByEmail.length > 0) {
        nomineeUserId = userByEmail[0].id;
      }
    } else if (nominee_github) {
      const [userByGithub] = await db.execute(
        'SELECT id FROM users WHERE github_username = ? AND role != "deactivated"',
        [nominee_github]
      );
      if (userByGithub.length > 0) {
        nomineeUserId = userByGithub[0].id;
      }
    }

    // Get risk multiplier from database based on investment category
    const [multiplierSettings] = await db.execute(
      `SELECT setting_value FROM investment_settings WHERE setting_key = ?`,
      [`multiplier_${investment_category}`]
    );
    const riskMultiplier = multiplierSettings.length > 0
      ? parseFloat(multiplierSettings[0].setting_value)
      : (investment_category === 'sweat_equity' ? 2.0 :
         investment_category === 'cash' ? 2.8 : 1.0);

    // Process content (markdown to HTML)
    const contentHtml = markdownToHtml(content);

    // Determine status
    const status = amount ? 'pending' : 'pending_review';

    // Create deliverable
    const [result] = await db.execute(
      `INSERT INTO deliverables
       (user_id, nominee_user_id, title, content, content_html, amount, current_proposed_amount,
        original_amount, original_currency, exchange_rate, risk_multiplier, investment_category,
        deliverable_date, status, type, is_draft)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [1, nomineeUserId, title, content, contentHtml, amount || null, amount || null,
       amount || null, BASE_CURRENCY, 1.0, riskMultiplier, investment_category,
       deliverable_date || new Date().toISOString().split('T')[0], status, category, false]
    );
    
    const deliverableId = result.insertId;
    
    // Add API tag and provided tags
    const allTags = ['api-generated', ...tags];
    
    for (const tagName of allTags) {
      const tagSlug = generateSlug(tagName);
      
      await db.execute(
        'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
        [tagName, tagSlug]
      );
      
      const [tagRows] = await db.execute(
        'SELECT id FROM tags WHERE slug = ?',
        [tagSlug]
      );
      
      if (tagRows.length > 0) {
        await db.execute(
          'INSERT INTO deliverable_tags (deliverable_id, tag_id) VALUES (?, ?)',
          [deliverableId, tagRows[0].id]
        );
      }
    }
    
    // Notify admins via direct messages (skip for historical backfill)
    const isHistoricalBackfill = tags.includes('historical-backfill');

    if (!isHistoricalBackfill) {
      const [admins] = await db.execute(
        'SELECT * FROM users WHERE role = "admin"'
      );

      const notificationMessage = `# 🤖 API Deliverable Submission

**Title**: ${title}
**Category**: ${category}
**Amount**: ${amount ? `$${amount} USD` : 'Requires valuation'}
**Date**: ${deliverable_date || 'Today'}
**Submitted via**: ${req.apiToken.name}

**Description**:
${content.substring(0, 300)}${content.length > 300 ? '...' : ''}

**Action Required**: Review this API-submitted deliverable.

[View in Investment Tracker](/investment-tracker)`;

      for (const admin of admins) {
        // Send via direct message
        const conversationResult = await db.execute(`
          SELECT id FROM dm_conversations
          WHERE (user1_id = 1 AND user2_id = ?) OR (user1_id = ? AND user2_id = 1)
        `, [admin.id, admin.id]);

        let conversationId;
        if (conversationResult[0].length > 0) {
          conversationId = conversationResult[0][0].id;
        } else {
          const [newConv] = await db.execute(
            'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
            [1, admin.id]
          );
          conversationId = newConv.insertId;
        }

        const messageHtml = DOMPurify.sanitize(marked.parse(notificationMessage));

        await db.execute(`
          INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
          VALUES (?, ?, ?, ?, ?)
        `, [conversationId, 1, admin.id, notificationMessage, messageHtml]);
      }
    }
    
    // Log the API usage
    console.log(`API Deliverable created: "${title}" for $${amount || 'TBD'} via ${req.apiToken.name}`);
    
    res.status(201).json({
      success: true,
      message: 'Deliverable submitted successfully',
      data: {
        deliverableId,
        title,
        amount: amount || null,
        status,
        category,
        nominee_user_id: nomineeUserId,
        created_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API create deliverable error:', error);
    res.status(500).json({ error: 'Failed to create deliverable submission' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/ledger — create an Expense Ledger entry via API token.
// This is the programmatic equivalent of submitting a receipt by email to
// the receipts mailbox, intended for finance systems piping in receipts.
// Writes to the `ledger` table (what /ledger shows) — NOT `deliverables`.
// Accepts JSON, or multipart/form-data with a `receipt` file attached.
// ---------------------------------------------------------------------------
app.post('/api/v1/ledger', authenticateApiToken, (req, res, next) => {
  // Stage receipt uploads under uploads/ledger (matches the email daemon).
  req.uploadType = 'ledger';
  next();
}, upload.single('receipt'), [
  body('title').notEmpty().trim().isLength({ min: 3, max: 255 }),
  // Negative amounts are allowed: a refund/credit is a negative-amount entry,
  // so ledger totals net out correctly (the DB column and the web UI's own
  // /api/ledger both already permit this).
  body('amount').optional({ nullable: true }).isFloat(),
  body('currency').optional({ nullable: true }).trim().isLength({ min: 3, max: 3 }),
  // base_amount: the amount as it POSTED to the base-currency card/bank statement
  // (e.g. the CAD figure a USD charge became on a CAD Visa). When the expense
  // currency differs from BASE_CURRENCY, this is the auditable base value; the
  // effective FX rate is derived from it rather than looked up live.
  body('base_amount').optional({ nullable: true }).isFloat(),
  body('expense_date').optional({ nullable: true }).isDate(),
  body('expense_category').optional({ nullable: true })
    .isIn(['office_supplies', 'travel', 'meals', 'software', 'hardware',
           'professional_services', 'marketing', 'utilities', 'rent',
           'insurance', 'maintenance', 'income', 'other']),
  body('submitter_email').optional({ nullable: true }).isEmail(),
  body('submitter_github').optional({ nullable: true }).trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  try {
    const {
      title,
      description,
      content,
      amount,
      currency = BASE_CURRENCY,
      base_amount,
      expense_date,
      expense_category = 'other',
      vendor_name,
      receipt_number,
      payment_method,
      payment_reference,
      project,
      project_code,
      submitter_email,
      submitter_github
    } = req.body;

    // Accept either `project` (friendly) or `project_code` (column name).
    const projectValue = (project || project_code || '').toString().trim() || null;

    const upperCurrency = (currency || BASE_CURRENCY).toUpperCase();
    const originalAmount = (amount === undefined || amount === null || amount === '')
      ? null
      : parseFloat(amount);
    const baseAmountInput = (base_amount === undefined || base_amount === null || base_amount === '')
      ? null
      : parseFloat(base_amount);
    const expenseDate = expense_date || new Date().toISOString().split('T')[0];

    // Resolve the submitting user (the person who incurred the expense).
    // Falls back to the system user (id 1) when no match — mirrors deliverables.
    // Match email against BOTH the personal `email` and the `company_email`
    // columns (same as the email-ingestion daemon), so a member's company address works
    // even when their personal email differs.
    let userId = 1;
    if (submitter_email) {
      const [u] = await db.execute(
        'SELECT id FROM users WHERE (email = ? OR company_email = ?) AND role != "deactivated" LIMIT 1',
        [submitter_email, submitter_email]
      );
      if (u.length > 0) userId = u[0].id;
    } else if (submitter_github) {
      const [u] = await db.execute(
        'SELECT id FROM users WHERE github_username = ? AND role != "deactivated" LIMIT 1',
        [submitter_github]
      );
      if (u.length > 0) userId = u[0].id;
    }

    // Resolve the base-currency amount (the `amount` column is BASE_CURRENCY;
    // `original_amount`/`original_currency` keep the raw foreign value).
    //
    //  - Same-currency expense: base amount = entered amount, rate = 1.
    //  - Foreign expense with base_amount provided: use the POSTED statement
    //    figure directly (auditable); derive the effective rate from it.
    //  - Foreign expense without base_amount: fall back to the stored daily rate
    //    (backward-compatible with the pre-CAD behaviour / USD deployments).
    let exchangeRate = 1.0;
    let baseAmount = originalAmount;
    if (upperCurrency !== BASE_CURRENCY && originalAmount !== null) {
      if (baseAmountInput !== null) {
        baseAmount = baseAmountInput;
        exchangeRate = originalAmount !== 0 ? baseAmountInput / originalAmount : 1.0;
      } else {
        try {
          const [rates] = await db.execute(
            'SELECT rate FROM exchange_rates WHERE base_currency = ? AND target_currency = ? AND date <= ? ORDER BY date DESC LIMIT 1',
            [BASE_CURRENCY, upperCurrency, expenseDate]
          );
          if (rates.length > 0) exchangeRate = parseFloat(rates[0].rate);
        } catch (rateErr) {
          console.error('Ledger API: exchange rate lookup failed:', rateErr.message);
        }
        baseAmount = originalAmount * exchangeRate;
      }
    }
    // `usdAmount` retained as the variable name for the base-currency amount to
    // minimise churn in the INSERT/response below; it holds BASE_CURRENCY now.
    const usdAmount = baseAmount;

    // Persist the receipt file metadata onto the row (the email path never did this).
    const receipt = req.file
      ? {
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size
        }
      : null;

    const [result] = await db.execute(
      `INSERT INTO ledger
         (user_id, expense_category, title, description, content,
          amount, original_amount, original_currency, exchange_rate,
          subtotal, tax_total, total_with_tax,
          vendor_name, receipt_number, payment_method, payment_reference, project_code,
          receipt_filename, receipt_original_name, receipt_mime_type, receipt_size,
          expense_date, status, source, source_email_subject, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'api', ?, NOW())`,
      [
        userId,
        expense_category,
        title,
        description || null,
        content || description || 'Expense submitted via API',
        usdAmount,
        originalAmount,
        upperCurrency,
        exchangeRate,
        usdAmount,
        usdAmount,
        vendor_name || null,
        receipt_number || null,
        payment_method || null,
        payment_reference || null,
        projectValue,
        receipt ? receipt.filename : null,
        receipt ? receipt.originalName : null,
        receipt ? receipt.mimeType : null,
        receipt ? receipt.size : null,
        expenseDate,
        `API: ${req.apiToken.name}`
      ]
    );

    const ledgerId = result.insertId;

    // Notify admins a new expense is pending review.
    try {
      const [admins] = await db.execute('SELECT id FROM users WHERE role = "admin"');
      for (const admin of admins) {
        await db.execute(
          'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
          [admin.id, 'ledger_pending', 'Expense pending review',
           `${title}${usdAmount !== null ? ` — $${usdAmount.toFixed(2)} ${BASE_CURRENCY}` : ''} (via ${req.apiToken.name})`,
           JSON.stringify({ ledgerId, link: `/ledger/${ledgerId}` })]
        );
      }
    } catch (notifyErr) {
      console.error('Ledger API: admin notification failed:', notifyErr.message);
    }

    console.log(`API Ledger entry #${ledgerId} created: "${title}" via ${req.apiToken.name}`);

    res.status(201).json({
      success: true,
      message: 'Expense ledger entry created successfully',
      data: {
        ledgerId,
        title,
        base_currency: BASE_CURRENCY,
        base_amount: usdAmount,
        amount_usd: usdAmount, // deprecated alias; equals base_amount (BASE_CURRENCY)
        original_amount: originalAmount,
        original_currency: upperCurrency,
        exchange_rate: exchangeRate,
        project: projectValue,
        status: 'pending',
        user_id: userId,
        payment_reference: payment_reference || null,
        receipt_attached: !!receipt,
        created_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API create ledger entry error:', error);
    res.status(500).json({ error: 'Failed to create ledger entry' });
  }
});

// List / search forum posts (paginated, summary-only — kept small for voice/AI agents).
// Returns short content excerpts and metadata, never the full content_html, so an
// agent can discover posts cheaply and then fetch a single post by id when needed.
app.get('/api/v1/forum/posts', authenticateApiToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const tagSlug = (req.query.tag || '').trim();

    // Pagination with a hard cap so payloads stay small (Call2Code #2 lesson).
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(25, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    // Build shared WHERE/JOIN fragments + params for both the data and count queries.
    let joinClause = '';
    let whereClause = 'WHERE 1=1';
    const filterParams = [];

    if (tagSlug) {
      joinClause += ' JOIN post_tags pt ON p.id = pt.post_id JOIN tags t ON pt.tag_id = t.id AND t.slug = ?';
      filterParams.push(tagSlug);
    }
    if (q) {
      whereClause += ' AND (p.title LIKE ? OR p.content LIKE ?)';
      filterParams.push(`%${q}%`, `%${q}%`);
    }

    // Total (for has_more / pagination), counting distinct posts after any tag join.
    const [countRows] = await db.execute(
      `SELECT COUNT(DISTINCT p.id) AS total FROM posts p${joinClause} ${whereClause}`,
      filterParams
    );
    const total = countRows[0].total;

    // Summary rows: short excerpt only, no content_html. LIMIT/OFFSET are validated
    // integers interpolated directly (mysql2 execute rejects placeholders there).
    const [posts] = await db.execute(
      `SELECT p.id, p.title, p.slug, p.visibility, p.created_at, p.updated_at,
              LEFT(p.content, 200) AS excerpt,
              CHAR_LENGTH(p.content) AS content_length,
              u.name AS author_name, u.intranet_username,
              COALESCE(COUNT(DISTINCT c.id), 0) AS comment_count
       FROM posts p${joinClause}
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN comments c ON p.id = c.post_id
       ${whereClause}
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      filterParams
    );

    res.json({
      success: true,
      data: {
        posts: posts.map(p => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          visibility: p.visibility,
          excerpt: p.excerpt,
          truncated: p.content_length > 200,
          comment_count: parseInt(p.comment_count),
          author: { display_name: p.author_name, username: p.intranet_username },
          created_at: p.created_at,
          updated_at: p.updated_at
        })),
        page,
        limit,
        total,
        has_more: offset + posts.length < total
      }
    });
  } catch (error) {
    console.error('API list posts error:', error);
    res.status(500).json({ error: 'Failed to list forum posts' });
  }
});

// Get specific forum post
app.get('/api/v1/forum/posts/:id', authenticateApiToken, async (req, res) => {
  try {
    // Accept either a numeric post ID or a full slug (e.g. the value in
    // /forum/post/<slug>, which is generateSlug(title)-<Date.now()>).
    const rawId = String(req.params.id);
    const isNumericId = /^\d+$/.test(rawId);
    const lookupColumn = isNumericId ? 'p.id' : 'p.slug';
    const lookupValue = isNumericId ? parseInt(rawId) : rawId;

    const [posts] = await db.execute(`
      SELECT p.*, u.name, u.intranet_username, u.github_username,
             COALESCE(SUM(CASE WHEN l.value = 1 THEN 1 ELSE 0 END), 0) as upvotes,
             COALESCE(SUM(CASE WHEN l.value = -1 THEN 1 ELSE 0 END), 0) as downvotes,
             COALESCE(COUNT(DISTINCT c.id), 0) as comment_count
      FROM posts p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN likes l ON p.id = l.likeable_id AND l.likeable_type = 'post'
      LEFT JOIN comments c ON p.id = c.post_id
      WHERE ${lookupColumn} = ?
      GROUP BY p.id
    `, [lookupValue]);

    if (posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = posts[0];

    // Get tags (always by the resolved numeric post id, since lookup may have been by slug)
    const [tags] = await db.execute(`
      SELECT t.name, t.slug
      FROM tags t
      JOIN post_tags pt ON t.id = pt.tag_id
      WHERE pt.post_id = ?
    `, [post.id]);

    res.json({
      success: true,
      data: {
        id: post.id,
        title: post.title,
        content: post.content,
        content_html: post.content_html,
        slug: post.slug,
        visibility: post.visibility,
        author: {
          username: post.intranet_username,
          display_name: post.name,
          github_username: post.github_username
        },
        stats: {
          upvotes: parseInt(post.upvotes),
          downvotes: parseInt(post.downvotes),
          comment_count: parseInt(post.comment_count)
        },
        tags: tags.map(t => ({ name: t.name, slug: t.slug })),
        created_at: post.created_at,
        updated_at: post.updated_at
      }
    });
  } catch (error) {
    console.error('API get post error:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Update forum post
app.put('/api/v1/forum/posts/:id', authenticateApiToken, [
  body('title').optional().trim().isLength({ min: 5, max: 200 }),
  body('content').optional().isLength({ min: 10, max: 50000 }),
  body('tags').optional().isArray(),
  body('visibility').optional().isIn(['all_members', 'specific_members', 'author_only']),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }

  try {
    const postId = parseInt(req.params.id);
    
    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    // Get existing post
    const [existingPosts] = await db.execute(
      'SELECT * FROM posts WHERE id = ?',
      [postId]
    );

    if (existingPosts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const existingPost = existingPosts[0];

    // Check permissions: user owns the post OR admin token
    const hasPermission = (req.user && req.user.userId === existingPost.user_id) || 
                         (req.apiToken && req.apiToken.permissions && req.apiToken.permissions.admin === true);

    if (!hasPermission) {
      return res.status(403).json({ error: 'Permission denied: can only update your own posts' });
    }

    const { 
      title, 
      content, 
      tags, 
      visibility,
      priority = 'normal'
    } = req.body;

    // Build update query dynamically
    let updateFields = [];
    let updateValues = [];

    if (title !== undefined) {
      const finalTitle = priority !== 'normal' ? `[${priority.toUpperCase()}] ${title}` : title;
      updateFields.push('title = ?');
      updateValues.push(finalTitle);
    }

    if (content !== undefined) {
      const contentHtml = markdownToHtml(content);
      updateFields.push('content = ?, content_html = ?');
      updateValues.push(content, contentHtml);
    }

    if (visibility !== undefined) {
      updateFields.push('visibility = ?');
      updateValues.push(visibility);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = NOW()');
      updateValues.push(postId);

      await db.execute(
        `UPDATE posts SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    // Update tags if provided
    if (tags !== undefined) {
      // Remove existing post-tag relationships
      await db.execute('DELETE FROM post_tags WHERE post_id = ?', [postId]);
      
      // Add new tags
      for (const tagName of tags) {
        const tagSlug = generateSlug(tagName);
        
        // Insert or get tag
        await db.execute(
          'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
          [tagName, tagSlug]
        );
        
        const [tagRows] = await db.execute(
          'SELECT id FROM tags WHERE slug = ?',
          [tagSlug]
        );
        
        if (tagRows.length > 0) {
          await db.execute(
            'INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)',
            [postId, tagRows[0].id]
          );

          // Update tag usage count
          await db.execute(
            'UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?',
            [tagRows[0].id]
          );
        }
      }
    }

    // Log the API usage
    console.log(`API Post updated: "${existingPost.title}" via ${req.apiToken.name}`);

    res.json({
      success: true,
      message: 'Forum post updated successfully',
      data: {
        postId,
        updated_fields: Object.keys(req.body),
        updated_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API update post error:', error);
    res.status(500).json({ error: 'Failed to update forum post' });
  }
});

// Delete is intentionally DISABLED for the webhook/voice API
// to prevent accidental data loss. Deletion remains available from the web UI
// (DELETE /api/posts/:id, JWT-authenticated). Agents should rename a post to
// "To be deleted" instead. The route stays registered so callers get a clear 403.
app.delete('/api/v1/forum/posts/:id', authenticateApiToken, async (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'Delete is disabled for the webhook API. ' +
           'Rename the post to "To be deleted" instead, or delete it from the web UI.'
  });
});

// Get API token info (for verification)
app.get('/api/v1/auth/verify', authenticateApiToken, async (req, res) => {
  res.json({
    valid: true,
    token_name: req.apiToken.name,
    permissions: req.apiToken.permissions,
    last_used: req.apiToken.last_used_at
  });
});

// Member directory — name + contact details (email, phone) for active members.
// Available to any valid API token. Paginated and capped to keep responses small.
const MEMBER_DIRECTORY_FIELDS =
  'id, name, email, telephone, intranet_username, department, position, company';

app.get('/api/v1/members', authenticateApiToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    let whereClause = "WHERE role IN ('user', 'admin', 'moderator')";
    const filterParams = [];
    if (q) {
      whereClause += ' AND (name LIKE ? OR email LIKE ?)';
      filterParams.push(`%${q}%`, `%${q}%`);
    }

    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total FROM users ${whereClause}`,
      filterParams
    );
    const total = countRows[0].total;

    const [members] = await db.execute(
      `SELECT ${MEMBER_DIRECTORY_FIELDS} FROM users ${whereClause}
       ORDER BY name ASC LIMIT ${limit} OFFSET ${offset}`,
      filterParams
    );

    res.json({
      success: true,
      data: {
        members,
        page,
        limit,
        total,
        has_more: offset + members.length < total
      }
    });
  } catch (error) {
    console.error('API list members error:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

// Single member lookup by id (keeps the response tiny when the agent has an id).
app.get('/api/v1/members/:id', authenticateApiToken, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    if (isNaN(memberId)) {
      return res.status(400).json({ error: 'Invalid member ID' });
    }

    const [members] = await db.execute(
      `SELECT ${MEMBER_DIRECTORY_FIELDS} FROM users
       WHERE id = ? AND role IN ('user', 'admin', 'moderator') LIMIT 1`,
      [memberId]
    );

    if (members.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json({ success: true, data: members[0] });
  } catch (error) {
    console.error('API get member error:', error);
    res.status(500).json({ error: 'Failed to fetch member' });
  }
});

// ===================== WEBHOOK API v1 — TASKS + DIRECT MESSAGES =====================
// Phase Two of the token-authenticated agent API (docs/WEBHOOK_API.md). Kept small
// and paginated for voice agents; attributed to the acting user when the token
// carries one (see authenticateApiToken).

const TASK_STATUSES = ['pending', 'in_progress', 'completed'];
const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const TASK_SUMMARY_SELECT = `
  SELECT t.id, t.title, t.status, t.priority, t.due_date, t.created_at, t.updated_at,
         t.created_by, t.assigned_to,
         creator.name AS creator_name, assignee.name AS assignee_name,
         (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
  FROM tasks t
  LEFT JOIN users creator ON t.created_by = creator.id
  LEFT JOIN users assignee ON t.assigned_to = assignee.id`;

function formatDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? String(value) : d.toISOString().split('T')[0];
}

function taskSummary(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    due_date: formatDateOnly(row.due_date),
    creator: row.created_by ? { id: row.created_by, name: row.creator_name } : null,
    assignee: row.assigned_to ? { id: row.assigned_to, name: row.assignee_name } : null,
    comment_count: row.comment_count,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !isNaN(new Date(value));
}

function sendApiError(res, error, fallback) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

// List / search tasks (summaries only).
app.get('/api/v1/tasks', authenticateApiToken, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const { status, priority, view } = req.query;
    const assignedTo = req.query.assigned_to ? parseInt(req.query.assigned_to) : null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(25, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    if (status && !TASK_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(', ')}` });
    }
    if (priority && !TASK_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of ${TASK_PRIORITIES.join(', ')}` });
    }

    let whereClause = 'WHERE 1=1';
    const params = [];
    if (view === 'mine') {
      if (!req.user) {
        return res.status(400).json({ error: 'view=mine needs a user context (acting_user_id)' });
      }
      whereClause += ' AND (t.assigned_to = ? OR t.created_by = ?)';
      params.push(req.user.userId, req.user.userId);
    }
    if (status) { whereClause += ' AND t.status = ?'; params.push(status); }
    if (priority) { whereClause += ' AND t.priority = ?'; params.push(priority); }
    if (assignedTo && !isNaN(assignedTo)) { whereClause += ' AND t.assigned_to = ?'; params.push(assignedTo); }
    if (q) { whereClause += ' AND (t.title LIKE ? OR t.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

    const [countRows] = await db.execute(`SELECT COUNT(*) AS total FROM tasks t ${whereClause}`, params);
    const total = countRows[0].total;
    const [rows] = await db.execute(
      `${TASK_SUMMARY_SELECT} ${whereClause}
       ORDER BY t.status = 'completed' ASC, t.due_date IS NULL, t.due_date ASC, t.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    res.json({
      success: true,
      data: { tasks: rows.map(taskSummary), page, limit, total, has_more: offset + rows.length < total }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to list tasks');
  }
});

// Read one task in full (includes the markdown description).
app.get('/api/v1/tasks/:id', authenticateApiToken, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task ID' });

    const [rows] = await db.execute(`${TASK_SUMMARY_SELECT} WHERE t.id = ?`, [taskId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Task not found' });
    const [full] = await db.execute('SELECT description FROM tasks WHERE id = ?', [taskId]);

    res.json({ success: true, data: { ...taskSummary(rows[0]), description: full[0].description || '' } });
  } catch (error) {
    sendApiError(res, error, 'Failed to fetch task');
  }
});

// Create a task as the acting user (or the token owner).
app.post('/api/v1/tasks', authenticateApiToken, [
  body('title').notEmpty().withMessage('Title is required').trim().isLength({ min: 3, max: 500 }),
  body('description').optional({ nullable: true }).isString(),
  body('priority').optional({ nullable: true }).isIn(TASK_PRIORITIES),
  body('status').optional({ nullable: true }).isIn(TASK_STATUSES),
  body('due_date').optional({ nullable: true, checkFalsy: true }).custom(isDateOnly).withMessage('due_date must be YYYY-MM-DD'),
  body('assigned_to').optional({ nullable: true, checkFalsy: true }).isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  if (!req.user) {
    return res.status(400).json({ error: 'Creating a task needs a user context (acting_user_id)' });
  }

  try {
    const { title, description, priority, status, due_date, assigned_to } = req.body;
    const assigneeId = assigned_to ? parseInt(assigned_to) : null;
    if (assigneeId) {
      const [assignee] = await db.execute('SELECT id FROM users WHERE id = ?', [assigneeId]);
      if (assignee.length === 0) return res.status(404).json({ error: 'Assignee not found' });
    }

    const taskId = await createTaskRecord({
      title,
      description: description || null,
      priority: priority || 'normal',
      status: status || 'pending',
      due_date: due_date || null,
      assigned_to: assigneeId
    }, req.user);

    const [rows] = await db.execute(`${TASK_SUMMARY_SELECT} WHERE t.id = ?`, [taskId]);
    console.log(`API task created: "${title}" via ${req.apiToken.name}${req.actingUser ? ` as user ${req.user.userId}` : ''}`);
    res.status(201).json({
      success: true,
      message: 'Task created',
      data: { ...taskSummary(rows[0]), url: `${process.env.BASE_URL}/tasks/${taskId}` }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to create task');
  }
});

// Update a task (status, priority, due date, assignee, title, description).
app.put('/api/v1/tasks/:id', authenticateApiToken, [
  body('title').optional().trim().isLength({ min: 3, max: 500 }),
  body('description').optional({ nullable: true }).isString(),
  body('priority').optional().isIn(TASK_PRIORITIES),
  body('status').optional().isIn(TASK_STATUSES),
  body('due_date').optional({ nullable: true, checkFalsy: true }).custom(isDateOnly).withMessage('due_date must be YYYY-MM-DD'),
  body('assigned_to').optional({ nullable: true, checkFalsy: true }).isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  if (!req.user) {
    return res.status(400).json({ error: 'Updating a task needs a user context (acting_user_id)' });
  }

  try {
    const taskId = parseInt(req.params.id);
    if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task ID' });

    const fields = {};
    for (const key of ['title', 'description', 'priority', 'status', 'due_date', 'assigned_to']) {
      if (req.body[key] !== undefined) fields[key] = req.body[key];
    }
    if (fields.assigned_to !== undefined) {
      fields.assigned_to = fields.assigned_to ? parseInt(fields.assigned_to) : null;
      if (fields.assigned_to) {
        const [assignee] = await db.execute('SELECT id FROM users WHERE id = ?', [fields.assigned_to]);
        if (assignee.length === 0) return res.status(404).json({ error: 'Assignee not found' });
      }
    }

    await applyTaskUpdate(taskId, fields, req.user);
    const [rows] = await db.execute(`${TASK_SUMMARY_SELECT} WHERE t.id = ?`, [taskId]);
    res.json({ success: true, message: 'Task updated', data: taskSummary(rows[0]) });
  } catch (error) {
    sendApiError(res, error, 'Failed to update task');
  }
});

// Send a direct message to a member. The sender is the acting user; an
// integration token (acting_user permission) must always supply one so a DM is
// never sent "from" the token's service account.
app.post('/api/v1/messages/send', authenticateApiToken, [
  body('recipient_id').isInt().withMessage('recipient_id must be a member id'),
  body('content').isString().trim().isLength({ min: 1, max: 2000 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  if (!req.user || (tokenAllowsActingUser(req.apiToken) && !req.actingUser)) {
    return res.status(400).json({
      error: 'Direct messages need the sender identity (acting_user_id); the caller must be signed in to the intranet app'
    });
  }

  try {
    const recipientId = parseInt(req.body.recipient_id);
    const result = await deliverDirectMessage(req.user.userId, recipientId, req.body.content);
    console.log(`API direct message ${result.message.id} from user ${req.user.userId} to ${recipientId} via ${req.apiToken.name}`);
    res.status(201).json({
      success: true,
      message: 'Message sent',
      data: {
        message_id: result.message.id,
        conversation_id: result.conversationId,
        sender: { id: req.user.userId, name: result.message.sender_name },
        recipient_id: recipientId,
        created_at: result.message.created_at
      }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to send message');
  }
});

// ---------------------------------------------------------------------------
// Read direct messages as the acting user. Read-only: nothing is marked read,
// so the caller's unread badge in the app is untouched. Both routes need the
// reader's identity for the same reason /send needs the sender's — an
// integration token has no inbox of its own.
// ---------------------------------------------------------------------------
function requireDmIdentity(req, res) {
  if (!req.user || (tokenAllowsActingUser(req.apiToken) && !req.actingUser)) {
    res.status(400).json({
      error: 'Reading direct messages needs the reader identity (acting_user_id); the caller must be signed in to the intranet app'
    });
    return false;
  }
  return true;
}
function clampLimit(raw, def, max) {
  const n = parseInt(raw);
  return Math.min(Math.max(Number.isNaN(n) ? def : n, 1), max);
}

// The acting user's DM threads, most recent activity first.
app.get('/api/v1/messages/conversations', authenticateApiToken, async (req, res) => {
  if (!requireDmIdentity(req, res)) return;
  try {
    const me = req.user.userId;
    const limit = clampLimit(req.query.limit, 10, 25);
    const [rows] = await db.execute(`
      SELECT c.id AS conversation_id,
             IF(c.user1_id = ?, c.user2_id, c.user1_id) AS member_id,
             IF(c.user1_id = ?, u2.name, u1.name) AS member_name,
             dm.id AS last_message_id,
             dm.sender_id AS last_sender_id,
             dm.content AS last_message,
             dm.created_at AS last_message_at,
             (SELECT COUNT(*) FROM direct_messages x
               WHERE x.conversation_id = c.id AND x.recipient_id = ?
                 AND x.is_read = FALSE AND x.deleted_at IS NULL) AS unread_count
        FROM dm_conversations c
        LEFT JOIN users u1 ON u1.id = c.user1_id
        LEFT JOIN users u2 ON u2.id = c.user2_id
        LEFT JOIN direct_messages dm ON dm.id = (
          SELECT MAX(id) FROM direct_messages WHERE conversation_id = c.id AND deleted_at IS NULL
        )
       WHERE c.user1_id = ? OR c.user2_id = ?
       ORDER BY COALESCE(dm.created_at, c.updated_at) DESC
       LIMIT ${limit}
    `, [me, me, me, me, me]);
    res.json({
      success: true,
      data: {
        conversations: rows.map(r => ({
          conversation_id: r.conversation_id,
          member: { id: r.member_id, name: r.member_name },
          unread_count: Number(r.unread_count) || 0,
          last_message: r.last_message_id ? {
            id: r.last_message_id,
            direction: r.last_sender_id === me ? 'sent' : 'received',
            content: r.last_message,
            created_at: r.last_message_at
          } : null
        })),
        limit
      }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to list conversations');
  }
});

// The most recent messages between the acting user and one member, newest first.
app.get('/api/v1/messages/with/:member_id', authenticateApiToken, async (req, res) => {
  if (!requireDmIdentity(req, res)) return;
  const memberId = parseInt(req.params.member_id);
  if (Number.isNaN(memberId)) {
    return res.status(400).json({ error: 'member_id must be a member id' });
  }
  try {
    const me = req.user.userId;
    const limit = clampLimit(req.query.limit, 10, 50);
    const [members] = await db.execute('SELECT id, name FROM users WHERE id = ?', [memberId]);
    if (members.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    const [conv] = await db.execute(
      'SELECT id FROM dm_conversations WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?) LIMIT 1',
      [me, memberId, memberId, me]
    );
    let messages = [];
    let unreadCount = 0;
    if (conv.length > 0) {
      const [rows] = await db.execute(`
        SELECT dm.id, dm.sender_id, u.name AS sender_name, dm.content, dm.is_read, dm.created_at
          FROM direct_messages dm
          JOIN users u ON u.id = dm.sender_id
         WHERE dm.conversation_id = ? AND dm.deleted_at IS NULL
         ORDER BY dm.id DESC
         LIMIT ${limit}
      `, [conv[0].id]);
      messages = rows.map(m => ({
        id: m.id,
        direction: m.sender_id === me ? 'sent' : 'received',
        sender: { id: m.sender_id, name: m.sender_name },
        content: m.content,
        is_read: !!m.is_read,
        created_at: m.created_at
      }));
      const [[unread]] = await db.execute(
        'SELECT COUNT(*) AS n FROM direct_messages WHERE conversation_id = ? AND recipient_id = ? AND is_read = FALSE AND deleted_at IS NULL',
        [conv[0].id, me]
      );
      unreadCount = Number(unread.n) || 0;
    }
    res.json({
      success: true,
      data: {
        member: { id: members[0].id, name: members[0].name },
        conversation_id: conv.length > 0 ? conv[0].id : null,
        unread_count: unreadCount,
        order: 'newest_first',
        limit,
        messages
      }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to read messages');
  }
});

// ===================== GROUP CHAT (API token) =====================
// The /api/group-chat/* routes above need a browser JWT, so an integration (a
// voice agent, a cron, a CLI script) had no way to post into a channel. These
// mirror them for API tokens. The sender is the acting user when one is
// supplied, else the token's owner.
//
// `:group` is a numeric id or the group's name / display name, case-insensitive
// ("General", "engineering"). A sender who is not a member of a PUBLIC group is
// added to it on first post (so the channel shows who wrote it); private groups
// stay members-only (403).

async function resolveChatGroup(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const [rows] = /^\d+$/.test(raw)
    ? await db.execute('SELECT id, name, display_name, visibility, is_active FROM `groups` WHERE id = ?', [parseInt(raw)])
    : await db.execute(
      'SELECT id, name, display_name, visibility, is_active FROM `groups` WHERE LOWER(name) = LOWER(?) OR LOWER(display_name) = LOWER(?) ORDER BY is_active DESC, id LIMIT 1',
      [raw, raw]
    );
  return rows[0] || null;
}

async function isChatGroupMember(groupId, userId) {
  const [rows] = await db.execute('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
  return rows.length > 0;
}

// Load the group for a request and check the caller may see it. Returns the
// group row (with is_member) or sends the error response and returns null.
async function loadChatGroupForApi(req, res) {
  if (!req.user) {
    res.status(400).json({ error: 'This API token has no user identity' });
    return null;
  }
  const group = await resolveChatGroup(req.params.group);
  if (!group || !group.is_active) {
    res.status(404).json({ error: 'Group not found' });
    return null;
  }
  const isMember = await isChatGroupMember(group.id, req.user.userId);
  if (!isMember && group.visibility !== 'public') {
    res.status(403).json({ error: 'Not a member of this group' });
    return null;
  }
  return { ...group, is_member: isMember };
}

const chatGroupSummary = (g) => ({
  id: g.id,
  name: g.name,
  display_name: g.display_name,
  url: `${BASE_URL}/group-chat/${encodeURIComponent(g.name)}`
});

// List the channels the caller can post to (public, or private ones they belong to).
app.get('/api/v1/group-chat/groups', authenticateApiToken, async (req, res) => {
  if (!req.user) return res.status(400).json({ error: 'This API token has no user identity' });
  try {
    const [groups] = await db.execute(
      `SELECT g.id, g.name, g.display_name, g.description, g.visibility,
              (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count,
              EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?) AS is_member,
              (SELECT MAX(created_at) FROM group_messages msg WHERE msg.group_id = g.id AND msg.is_deleted = 0) AS last_message_at
       FROM \`groups\` g
       WHERE g.is_active = 1
         AND (g.visibility = 'public' OR EXISTS(SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = ?))
       ORDER BY last_message_at DESC, g.display_name`,
      [req.user.userId, req.user.userId]
    );
    res.json({
      success: true,
      data: groups.map((g) => ({ ...chatGroupSummary(g), description: g.description, visibility: g.visibility, member_count: g.member_count, is_member: !!g.is_member, last_message_at: g.last_message_at }))
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to list groups');
  }
});

// Recent messages in a channel, newest first. Read-only: nothing is marked read.
app.get('/api/v1/group-chat/:group/messages', authenticateApiToken, async (req, res) => {
  try {
    const group = await loadChatGroupForApi(req, res);
    if (!group) return;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
    const [rows] = await db.execute(
      `SELECT gm.id, gm.sender_id, u.name AS sender_name, gm.content, gm.reply_to_id, gm.is_edited, gm.created_at
       FROM group_messages gm
       JOIN users u ON u.id = gm.sender_id
       WHERE gm.group_id = ? AND gm.is_deleted = 0
       ORDER BY gm.created_at DESC, gm.id DESC
       LIMIT ${limit}`,
      [group.id]
    );
    res.json({
      success: true,
      data: {
        group: chatGroupSummary(group),
        is_member: group.is_member,
        messages: rows.map((m) => ({
          id: m.id,
          sender: { id: m.sender_id, name: m.sender_name },
          content: m.content,
          reply_to_id: m.reply_to_id,
          is_edited: !!m.is_edited,
          created_at: m.created_at
        }))
      }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to read group messages');
  }
});

// Post a message to a channel as the acting user / token owner.
app.post('/api/v1/group-chat/:group/messages', authenticateApiToken, [
  body('content').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('content must be 1–2000 characters'),
  body('reply_to_id').optional({ nullable: true }).isInt().withMessage('reply_to_id must be a message id')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  try {
    const group = await loadChatGroupForApi(req, res);
    if (!group) return;
    const senderId = req.user.userId;

    if (!group.is_member) {
      // Public group: join so the channel roster shows who is posting.
      await db.execute('INSERT INTO group_members (group_id, user_id, added_by) VALUES (?, ?, ?)', [group.id, senderId, senderId]);
      console.log(`API group-chat: added user ${senderId} to public group ${group.name} (${group.id}) on first post via ${req.apiToken.name}`);
    }

    const replyToId = req.body.reply_to_id ? parseInt(req.body.reply_to_id) : null;
    if (replyToId) {
      const [parent] = await db.execute('SELECT id FROM group_messages WHERE id = ? AND group_id = ? AND is_deleted = 0', [replyToId, group.id]);
      if (parent.length === 0) return res.status(404).json({ error: 'reply_to_id is not a message in this group' });
    }

    const content = req.body.content;
    const contentHtml = markdownToHtml(content);
    const [result] = await db.execute(
      'INSERT INTO group_messages (group_id, sender_id, content, content_html, reply_to_id) VALUES (?, ?, ?, ?, ?)',
      [group.id, senderId, content, contentHtml, replyToId]
    );
    const messageId = result.insertId;

    await db.execute(
      `INSERT INTO group_message_reads (group_id, user_id, last_read_message_id, last_read_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE last_read_message_id = ?, last_read_at = NOW()`,
      [group.id, senderId, messageId, messageId]
    );
    await processMentions(content, 'group_message', messageId, senderId, req.user);
    // @mentioned AI agents answer in the channel.
    const agentsSummoned = await agentResponder.handleGroupMention({
      messageId, groupId: group.id, senderId, content
    });

    console.log(`API group message ${messageId} in ${group.name} from user ${senderId} via ${req.apiToken.name}${req.actingUser ? ' (acting user)' : ''}`);
    res.status(201).json({
      success: true,
      message: 'Group message sent',
      data: {
        message_id: messageId,
        group: chatGroupSummary(group),
        sender: { id: senderId, name: req.user.name },
        reply_to_id: replyToId,
        created_at: new Date().toISOString(),
        agents_summoned: agentsSummoned
      }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to send group message');
  }
});

// Get specific deliverable
app.get('/api/v1/deliverables/:id', authenticateApiToken, async (req, res) => {
  try {
    const deliverableId = parseInt(req.params.id);
    
    if (isNaN(deliverableId)) {
      return res.status(400).json({ error: 'Invalid deliverable ID' });
    }

    const [deliverables] = await db.execute(`
      SELECT d.*, 
             u.name, u.intranet_username, u.github_username,
             nu.name as nominee_name, nu.intranet_username as nominee_username, nu.github_username as nominee_github
      FROM deliverables d 
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN users nu ON d.nominee_user_id = nu.id
      WHERE d.id = ?
    `, [deliverableId]);

    if (deliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const deliverable = deliverables[0];
    
    // Get tags
    const [tags] = await db.execute(`
      SELECT t.name, t.slug 
      FROM tags t 
      JOIN deliverable_tags dt ON t.id = dt.tag_id 
      WHERE dt.deliverable_id = ?
    `, [deliverableId]);

    res.json({
      success: true,
      data: {
        id: deliverable.id,
        title: deliverable.title,
        content: deliverable.content,
        content_html: deliverable.content_html,
        amount: deliverable.amount,
        current_proposed_amount: deliverable.current_proposed_amount,
        deliverable_date: deliverable.deliverable_date,
        status: deliverable.status,
        type: deliverable.type,
        is_draft: deliverable.is_draft,
        submitter: {
          username: deliverable.intranet_username,
          display_name: deliverable.name,
          github_username: deliverable.github_username
        },
        nominee: deliverable.nominee_user_id ? {
          username: deliverable.nominee_username,
          display_name: deliverable.nominee_name,
          github_username: deliverable.nominee_github
        } : null,
        tags: tags.map(t => ({ name: t.name, slug: t.slug })),
        created_at: deliverable.created_at,
        updated_at: deliverable.updated_at
      }
    });
  } catch (error) {
    console.error('API get deliverable error:', error);
    res.status(500).json({ error: 'Failed to fetch deliverable' });
  }
});

// Update deliverable
app.put('/api/v1/deliverables/:id', authenticateApiToken, [
  body('title').optional().trim().isLength({ min: 5, max: 255 }),
  body('content').optional().trim().isLength({ min: 10, max: 50000 }),
  body('amount').optional().isFloat({ min: 0 }),
  body('nominee_email').optional().isEmail(),
  body('nominee_github').optional().trim(),
  body('deliverable_date').optional().isDate(),
  body('tags').optional().isArray(),
  body('category').optional().isIn(['expense', 'customer', 'referral', 'contribution', 'other']),
  body('investment_category').optional().isIn(['cash', 'sweat_equity', 'property', 'referral']),
  body('status').optional().isIn(['pending', 'pending_review', 'approved', 'rejected', 'paid'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }

  try {
    const deliverableId = parseInt(req.params.id);
    
    if (isNaN(deliverableId)) {
      return res.status(400).json({ error: 'Invalid deliverable ID' });
    }

    // Get existing deliverable
    const [existingDeliverables] = await db.execute(
      'SELECT * FROM deliverables WHERE id = ?',
      [deliverableId]
    );

    if (existingDeliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const existingDeliverable = existingDeliverables[0];

    // Check permissions: user owns the deliverable OR admin token
    const hasPermission = (req.user && req.user.userId === existingDeliverable.user_id) || 
                         (req.apiToken && req.apiToken.permissions && req.apiToken.permissions.admin === true);

    if (!hasPermission) {
      return res.status(403).json({ error: 'Permission denied: can only update your own deliverables' });
    }

    const {
      title,
      content,
      amount,
      nominee_email,
      nominee_github,
      deliverable_date,
      tags,
      category,
      investment_category,
      status
    } = req.body;

    // Build update query dynamically
    let updateFields = [];
    let updateValues = [];

    if (title !== undefined) {
      updateFields.push('title = ?');
      updateValues.push(title);
    }

    if (content !== undefined) {
      const contentHtml = markdownToHtml(content);
      updateFields.push('content = ?, content_html = ?');
      updateValues.push(content, contentHtml);
    }

    if (amount !== undefined || investment_category !== undefined) {
      // Determine investment category (use provided or existing)
      const finalInvestmentCategory = investment_category || existingDeliverable.investment_category || 'cash';

      // Get risk multiplier from database based on investment category
      const [multiplierSettings] = await db.execute(
        `SELECT setting_value FROM investment_settings WHERE setting_key = ?`,
        [`multiplier_${finalInvestmentCategory}`]
      );
      const riskMultiplier = multiplierSettings.length > 0
        ? parseFloat(multiplierSettings[0].setting_value)
        : (finalInvestmentCategory === 'sweat_equity' ? 2.0 :
           finalInvestmentCategory === 'cash' ? 2.8 : 1.0);

      const finalAmount = amount !== undefined ? amount : existingDeliverable.amount;

      updateFields.push('amount = ?, current_proposed_amount = ?, original_amount = ?, original_currency = ?, exchange_rate = ?, risk_multiplier = ?, investment_category = ?');
      updateValues.push(finalAmount, finalAmount, finalAmount, BASE_CURRENCY, 1.0, riskMultiplier, finalInvestmentCategory);
    }

    if (deliverable_date !== undefined) {
      updateFields.push('deliverable_date = ?');
      updateValues.push(deliverable_date);
    }

    if (category !== undefined) {
      updateFields.push('type = ?');
      updateValues.push(category);
    }

    if (status !== undefined) {
      // Only admins can change status to approved/rejected/paid
      if (['approved', 'rejected', 'paid'].includes(status) && !(req.apiToken.permissions && req.apiToken.permissions.admin === true)) {
        return res.status(403).json({ error: 'Only admins can approve, reject, or mark deliverables as paid' });
      }
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    // Handle nominee updates
    if (nominee_email !== undefined || nominee_github !== undefined) {
      let nomineeUserId = existingDeliverable.nominee_user_id;
      
      if (nominee_email) {
        const [userByEmail] = await db.execute(
          'SELECT id FROM users WHERE email = ? AND role != "deactivated"',
          [nominee_email]
        );
        if (userByEmail.length > 0) {
          nomineeUserId = userByEmail[0].id;
        }
      } else if (nominee_github) {
        const [userByGithub] = await db.execute(
          'SELECT id FROM users WHERE github_username = ? AND role != "deactivated"',
          [nominee_github]
        );
        if (userByGithub.length > 0) {
          nomineeUserId = userByGithub[0].id;
        }
      }
      
      updateFields.push('nominee_user_id = ?');
      updateValues.push(nomineeUserId);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = NOW()');
      updateValues.push(deliverableId);

      await db.execute(
        `UPDATE deliverables SET ${updateFields.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    // Update tags if provided
    if (tags !== undefined) {
      // Remove existing deliverable-tag relationships
      await db.execute('DELETE FROM deliverable_tags WHERE deliverable_id = ?', [deliverableId]);
      
      // Add new tags
      for (const tagName of tags) {
        const tagSlug = generateSlug(tagName);
        
        // Insert or get tag
        await db.execute(
          'INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)',
          [tagName, tagSlug]
        );
        
        const [tagRows] = await db.execute(
          'SELECT id FROM tags WHERE slug = ?',
          [tagSlug]
        );
        
        if (tagRows.length > 0) {
          await db.execute(
            'INSERT INTO deliverable_tags (deliverable_id, tag_id) VALUES (?, ?)',
            [deliverableId, tagRows[0].id]
          );
        }
      }
    }

    // Log the API usage
    console.log(`API Deliverable updated: "${existingDeliverable.title}" via ${req.apiToken.name}`);

    res.json({
      success: true,
      message: 'Deliverable updated successfully',
      data: {
        deliverableId,
        updated_fields: Object.keys(req.body),
        updated_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API update deliverable error:', error);
    res.status(500).json({ error: 'Failed to update deliverable' });
  }
});

// Delete deliverable
app.delete('/api/v1/deliverables/:id', authenticateApiToken, async (req, res) => {
  try {
    const deliverableId = parseInt(req.params.id);
    
    if (isNaN(deliverableId)) {
      return res.status(400).json({ error: 'Invalid deliverable ID' });
    }

    // Get existing deliverable
    const [existingDeliverables] = await db.execute(
      'SELECT * FROM deliverables WHERE id = ?',
      [deliverableId]
    );

    if (existingDeliverables.length === 0) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    const existingDeliverable = existingDeliverables[0];

    // Check permissions: user owns the deliverable OR admin token
    const hasPermission = (req.user && req.user.userId === existingDeliverable.user_id) || 
                         (req.apiToken && req.apiToken.permissions && req.apiToken.permissions.admin === true);

    if (!hasPermission) {
      return res.status(403).json({ error: 'Permission denied: can only delete your own deliverables' });
    }

    // Don't allow deletion if already approved or paid
    if (['approved', 'paid'].includes(existingDeliverable.status) && !(req.apiToken.permissions && req.apiToken.permissions.admin === true)) {
      return res.status(403).json({ error: 'Cannot delete approved or paid deliverables' });
    }

    // Delete related records first (foreign key constraints)
    await db.execute('DELETE FROM deliverable_tags WHERE deliverable_id = ?', [deliverableId]);
    
    // Delete the deliverable
    await db.execute('DELETE FROM deliverables WHERE id = ?', [deliverableId]);

    // Log the API usage
    console.log(`API Deliverable deleted: "${existingDeliverable.title}" via ${req.apiToken.name}`);

    res.json({
      success: true,
      message: 'Deliverable deleted successfully',
      data: {
        deliverableId,
        deleted_title: existingDeliverable.title,
        deleted_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API delete deliverable error:', error);
    res.status(500).json({ error: 'Failed to delete deliverable' });
  }
});

// Create comment on post
// Add a comment to a forum post. The author is the acting user; an integration
// token (acting_user permission) must supply one so a comment is never posted
// as the token's service account (same rule as direct messages).
app.post('/api/v1/forum/posts/:postId/comments', authenticateApiToken, [
  body('content').isString().trim().isLength({ min: 10, max: 5000 }).withMessage('content must be 10-5000 characters'),
  body('parent_comment_id').optional({ values: 'falsy' }).isInt().withMessage('parent_comment_id must be a comment id')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }
  const postId = parseInt(req.params.postId);
  if (isNaN(postId)) {
    return res.status(400).json({ error: 'Invalid post ID' });
  }
  if (!req.user || (tokenAllowsActingUser(req.apiToken) && !req.actingUser)) {
    return res.status(400).json({
      error: 'Comments need the author identity (acting_user_id); the caller must be signed in to the intranet app'
    });
  }

  try {
    const result = await createComment(postId, req.user, req.body.content, req.body.parent_comment_id || null);
    console.log(`API comment ${result.commentId} on post ${postId} by user ${req.user.userId} via ${req.apiToken.name}`);
    res.status(201).json({
      success: true,
      message: 'Comment created',
      data: {
        comment_id: result.commentId,
        post_id: postId,
        parent_comment_id: result.parentId,
        author: { id: req.user.userId, name: req.user.name },
        created_via: req.apiToken.name
      }
    });
  } catch (error) {
    sendApiError(res, error, 'Failed to create comment');
  }
});

// Get specific comment
app.get('/api/v1/comments/:id', authenticateApiToken, async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    
    if (isNaN(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }

    const [comments] = await db.execute(`
      SELECT c.*, u.name, u.intranet_username, u.github_username,
             p.title as post_title, p.slug as post_slug,
             COALESCE(SUM(CASE WHEN l.value = 1 THEN 1 ELSE 0 END), 0) as upvotes,
             COALESCE(SUM(CASE WHEN l.value = -1 THEN 1 ELSE 0 END), 0) as downvotes
      FROM comments c 
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN posts p ON c.post_id = p.id
      LEFT JOIN likes l ON c.id = l.likeable_id AND l.likeable_type = 'comment'
      WHERE c.id = ?
      GROUP BY c.id
    `, [commentId]);

    if (comments.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = comments[0];

    res.json({
      success: true,
      data: {
        id: comment.id,
        content: comment.content,
        content_html: comment.content_html,
        post_id: comment.post_id,
        parent_comment_id: comment.parent_comment_id,
        author: {
          username: comment.intranet_username,
          display_name: comment.name,
          github_username: comment.github_username
        },
        post: {
          title: comment.post_title,
          slug: comment.post_slug
        },
        stats: {
          upvotes: parseInt(comment.upvotes),
          downvotes: parseInt(comment.downvotes)
        },
        created_at: comment.created_at,
        updated_at: comment.updated_at
      }
    });
  } catch (error) {
    console.error('API get comment error:', error);
    res.status(500).json({ error: 'Failed to fetch comment' });
  }
});

// Update comment
app.put('/api/v1/comments/:id', authenticateApiToken, [
  body('content').optional().isLength({ min: 10, max: 5000 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }

  try {
    const commentId = parseInt(req.params.id);
    const { content } = req.body;
    
    if (isNaN(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Content is required for update' });
    }

    // Get existing comment
    const [existingComments] = await db.execute(
      'SELECT * FROM comments WHERE id = ?',
      [commentId]
    );

    if (existingComments.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const existingComment = existingComments[0];

    // Check permissions: user owns the comment OR admin token
    const hasPermission = (req.user && req.user.userId === existingComment.user_id) || 
                         (req.apiToken && req.apiToken.permissions && req.apiToken.permissions.admin === true);

    if (!hasPermission) {
      return res.status(403).json({ error: 'Permission denied: can only update your own comments' });
    }

    // Process content (markdown to HTML)
    const contentHtml = markdownToHtml(content);

    // Update comment
    await db.execute(
      'UPDATE comments SET content = ?, content_html = ?, updated_at = NOW() WHERE id = ?',
      [content, contentHtml, commentId]
    );

    // Log the API usage
    console.log(`API Comment updated: ID ${commentId} via ${req.apiToken.name}`);

    res.json({
      success: true,
      message: 'Comment updated successfully',
      data: {
        commentId,
        updated_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API update comment error:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete comment
app.delete('/api/v1/comments/:id', authenticateApiToken, async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    
    if (isNaN(commentId)) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }

    // Get existing comment
    const [existingComments] = await db.execute(
      'SELECT * FROM comments WHERE id = ?',
      [commentId]
    );

    if (existingComments.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const existingComment = existingComments[0];

    // Check permissions: user owns the comment OR admin token
    const hasPermission = (req.user && req.user.userId === existingComment.user_id) || 
                         (req.apiToken && req.apiToken.permissions && req.apiToken.permissions.admin === true);

    if (!hasPermission) {
      return res.status(403).json({ error: 'Permission denied: can only delete your own comments' });
    }

    // Check for child comments
    const [childComments] = await db.execute(
      'SELECT id FROM comments WHERE parent_comment_id = ?',
      [commentId]
    );

    if (childComments.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete comment with replies. Delete child comments first.' 
      });
    }

    // Delete related records first (foreign key constraints)
    await db.execute('DELETE FROM likes WHERE likeable_type = "comment" AND likeable_id = ?', [commentId]);
    
    // Delete the comment
    await db.execute('DELETE FROM comments WHERE id = ?', [commentId]);

    // Log the API usage
    console.log(`API Comment deleted: ID ${commentId} via ${req.apiToken.name}`);

    res.json({
      success: true,
      message: 'Comment deleted successfully',
      data: {
        commentId,
        deleted_via: req.apiToken.name
      }
    });
  } catch (error) {
    console.error('API delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Get comments for a specific post
app.get('/api/v1/forum/posts/:postId/comments', authenticateApiToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    
    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID' });
    }

    // Verify post exists
    const [posts] = await db.execute('SELECT id, title FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const [comments] = await db.execute(`
      SELECT c.*, u.name, u.intranet_username, u.github_username,
             COALESCE(SUM(CASE WHEN l.value = 1 THEN 1 ELSE 0 END), 0) as upvotes,
             COALESCE(SUM(CASE WHEN l.value = -1 THEN 1 ELSE 0 END), 0) as downvotes
      FROM comments c 
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN likes l ON c.id = l.likeable_id AND l.likeable_type = 'comment'
      WHERE c.post_id = ?
      GROUP BY c.id
      ORDER BY c.created_at ASC
    `, [postId]);

    res.json({
      success: true,
      data: {
        post_id: postId,
        post_title: posts[0].title,
        comment_count: comments.length,
        comments: comments.map(comment => ({
          id: comment.id,
          content: comment.content,
          parent_comment_id: comment.parent_id,
          author: {
            id: comment.user_id,
            name: comment.name,
            username: comment.intranet_username,
            github_username: comment.github_username
          },
          stats: {
            upvotes: parseInt(comment.upvotes),
            downvotes: parseInt(comment.downvotes)
          },
          created_at: comment.created_at,
          updated_at: comment.updated_at
        }))
      }
    });
  } catch (error) {
    console.error('API get post comments error:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// ===================== COMPANY EMAIL MANAGEMENT ENDPOINTS =====================

// Create ${COMPANY_NAME} email for user (admin only)
app.post('/api/admin/company-email/create', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    
    // Get user details
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [user_id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];
    
    // Check if user already has company email
    if (user.company_email) {
      return res.status(400).json({ error: `User already has a ${COMPANY_EMAIL_DOMAIN} email` });
    }
    
    // Generate email address
    const emailUsername = user.github_username.toLowerCase();
    const companyEmail = `${emailUsername}@${COMPANY_EMAIL_DOMAIN}`;
    
    // Update user with company email
    await db.execute(
      'UPDATE users SET company_email = ?, company_email_created_at = NOW() WHERE id = ?',
      [companyEmail, user_id]
    );
    
    // Send direct message with setup instructions
    const setupInstructions = `# 📧 Your @${COMPANY_EMAIL_DOMAIN} Email is Ready!

Hi ${user.name}! An admin has created a ${COMPANY_EMAIL_DOMAIN} email account for you.

## 📍 Your New Email Address
**${companyEmail}**

## 🔧 Setup Instructions

### Step 1: Choose Your Password
Visit this link to set your email password: [Setup Link Coming Soon]

### Step 2: Configure Your Mail Client

#### 📱 iPhone Mail Setup:
1. Settings → Mail → Accounts → Add Account → Other
2. **IMAP Account Info:**
   - Name: ${user.name}
   - Email: ${companyEmail}
   - Password: [Your chosen password]
   - Description: ${COMPANY_NAME} Email

3. **Incoming Mail Server:**
   - Host: mail.${COMPANY_EMAIL_DOMAIN}
   - Username: ${emailUsername}
   - Password: [Your chosen password]
   - Port: 993
   - Use SSL: Yes

4. **Outgoing Mail Server:**
   - Host: mail.${COMPANY_EMAIL_DOMAIN}
   - Username: ${emailUsername}
   - Password: [Your chosen password]
   - Port: 587
   - Use STARTTLS: Yes

#### 💻 Outlook Setup:
1. File → Add Account → Manual setup
2. **Account Type:** IMAP
3. **Incoming Mail:**
   - Server: mail.${COMPANY_EMAIL_DOMAIN}
   - Port: 993
   - Encryption: SSL/TLS
4. **Outgoing Mail:**
   - Server: mail.${COMPANY_EMAIL_DOMAIN}
   - Port: 587
   - Encryption: STARTTLS

#### 🍎 Apple Mail Setup:
1. Mail → Preferences → Accounts → Add
2. Choose "Other Mail Account"
3. Use the same settings as iPhone above

## 🛡️ Security Notes
- Your email password is separate from your intranet password
- Use a strong, unique password for your email account
- All emails are stored securely on our servers

## 📞 Need Help?
Reply to this message if you need assistance with setup!

---
*${COMPANY_NAME} Email Management System*`;

    // Create conversation and send message
    const conversationResult = await db.execute(`
      SELECT id FROM dm_conversations 
      WHERE (user1_id = 1 AND user2_id = ?) OR (user1_id = ? AND user2_id = 1)
    `, [user_id, user_id]);
    
    let conversationId;
    if (conversationResult[0].length > 0) {
      conversationId = conversationResult[0][0].id;
    } else {
      const [newConv] = await db.execute(
        'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
        [1, user_id] // System user (1) to target user
      );
      conversationId = newConv.insertId;
    }
    
    // Send the setup instructions message
    const messageHtml = DOMPurify.sanitize(marked.parse(setupInstructions));
    
    await db.execute(`
      INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
      VALUES (?, ?, ?, ?, ?)
    `, [conversationId, 1, user_id, setupInstructions, messageHtml]);
    
    // Create notification
    await db.execute(`
      INSERT INTO notifications (user_id, type, title, message, data)
      VALUES (?, 'company_email_setup', ?, ?, ?)
    `, [
      user_id,
      `${COMPANY_NAME} Email Account Created`,
      `Your @${COMPANY_EMAIL_DOMAIN} email account is ready! Check your messages for setup instructions.`,
      JSON.stringify({
        email: companyEmail,
        created_by: req.user.userId,
        setup_required: true
      })
    ]);
    
    console.log(`${COMPANY_NAME} email ${companyEmail} created for user ${user.name} by admin ${req.user.userId}`);
    
    res.json({
      message: `${COMPANY_NAME} email created and setup instructions sent`,
      email: companyEmail,
      user_name: user.name
    });
  } catch (error) {
    console.error('Create company email error:', error);
    res.status(500).json({ error: `Failed to create ${COMPANY_EMAIL_DOMAIN} email` });
  }
});

// Send password reset instructions (admin only)
app.post('/api/admin/company-email/password-reset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    
    // Get user details
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [user_id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];
    
    if (!user.company_email) {
      return res.status(400).json({ error: `User does not have a ${COMPANY_EMAIL_DOMAIN} email` });
    }
    
    // Send password reset instructions via DM
    const resetInstructions = `# 🔐 ${COMPANY_NAME} Email Password Reset

Hi ${user.name}! An admin has initiated a password reset for your company email.

## 📧 Email Account: ${user.company_email}

## 🔄 Reset Steps:
1. **Choose New Password**: Select a strong, unique password
2. **Update Mail Clients**: You'll need to update the password in:
   - iPhone Mail app
   - Outlook
   - Apple Mail
   - Any other configured mail clients

## 📱 Update iPhone Mail:
1. Settings → Mail → Accounts
2. Tap your ${COMPANY_NAME} account
3. Tap Account → Password
4. Enter your new password

## 💻 Update Outlook:
1. File → Account Settings → Account Settings
2. Select your ${COMPANY_NAME} account → Change
3. Update password field
4. Test account settings

## 🍎 Update Apple Mail:
1. Mail → Preferences → Accounts
2. Select ${COMPANY_NAME} account
3. Update password field

## ⚠️ Important Notes:
- This is separate from your intranet login password
- Update ALL devices/clients that use this email
- Test sending/receiving after password change

## 📞 Need Help?
Reply to this message if you encounter any issues!

---
*${COMPANY_NAME} Email Management System*`;

    // Send via direct message
    const conversationResult = await db.execute(`
      SELECT id FROM dm_conversations 
      WHERE (user1_id = 1 AND user2_id = ?) OR (user1_id = ? AND user2_id = 1)
    `, [user_id, user_id]);
    
    let conversationId;
    if (conversationResult[0].length > 0) {
      conversationId = conversationResult[0][0].id;
    } else {
      const [newConv] = await db.execute(
        'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
        [1, user_id]
      );
      conversationId = newConv.insertId;
    }
    
    const messageHtml = DOMPurify.sanitize(marked.parse(resetInstructions));
    
    await db.execute(`
      INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
      VALUES (?, ?, ?, ?, ?)
    `, [conversationId, 1, user_id, resetInstructions, messageHtml]);
    
    // Update last reset timestamp
    await db.execute(
      'UPDATE users SET company_email_last_reset = NOW() WHERE id = ?',
      [user_id]
    );
    
    console.log(`Password reset instructions sent for ${user.company_email} by admin ${req.user.userId}`);
    
    res.json({
      message: 'Password reset instructions sent via direct message',
      email: user.company_email,
      user_name: user.name
    });
  } catch (error) {
    console.error('Send password reset error:', error);
    res.status(500).json({ error: 'Failed to send password reset instructions' });
  }
});

// Delete ${COMPANY_NAME} email account (admin only)
app.delete('/api/admin/company-email/delete', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { user_id } = req.body;
    
    // Get user details
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [user_id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];
    
    if (!user.company_email) {
      return res.status(400).json({ error: `User does not have a ${COMPANY_EMAIL_DOMAIN} email account` });
    }
    
    const emailToDelete = user.company_email;
    
    // Remove company email from user record
    await db.execute(
      'UPDATE users SET company_email = NULL, company_email_created_at = NULL, company_email_last_reset = NULL WHERE id = ?',
      [user_id]
    );
    
    // Delete the system user account from mail server
    const serverUsername = emailToDelete.split('@')[0] + `-${MAIL_USER_SUFFIX}`;
    try {
      await execAsync(`sudo userdel -r ${serverUsername}`);
      console.log(`System user ${serverUsername} deleted from mail server`);
      
      // Remove from virtual mailbox maps
      await execAsync(`sudo bash -c 'grep -v \"^${emailToDelete}\" /etc/postfix/virtual_mailbox_maps > /tmp/mailbox_clean && sudo mv /tmp/mailbox_clean /etc/postfix/virtual_mailbox_maps && sudo postmap /etc/postfix/virtual_mailbox_maps && sudo systemctl reload postfix'`);
      console.log(`Removed ${emailToDelete} from virtual mailbox maps`);
      
    } catch (userDelError) {
      console.warn(`Failed to delete system user ${serverUsername} from mail server:`, userDelError.message);
    }
    
    // Remove server email account record
    await db.execute(
      'DELETE FROM server_email_accounts WHERE email_address = ?',
      [emailToDelete]
    );
    
    // Send notification via direct message
    const deleteNotification = `# 🗑️ ${COMPANY_NAME} Email Account Removed

Hi ${user.name}, 

Your ${COMPANY_NAME} email account has been removed by an administrator.

## 📧 Removed Account: ${emailToDelete}

## 📱 Next Steps:
1. **Remove from Mail Clients**: Delete the account from iPhone Mail, Outlook, Apple Mail, etc.
2. **Update Contacts**: Inform contacts of your email address change
3. **Data Preservation**: Your previous emails are preserved but the account is disabled

## 🔄 Want a New Email?
If you need a new @${COMPANY_EMAIL_DOMAIN} email with a different username, an admin can create one for you.

## 📞 Questions?
Reply to this message if you have any questions about this change.

---
*${COMPANY_NAME} Email Management System*`;

    // Send notification via DM
    const conversationResult = await db.execute(`
      SELECT id FROM dm_conversations 
      WHERE (user1_id = 1 AND user2_id = ?) OR (user1_id = ? AND user2_id = 1)
    `, [user_id, user_id]);
    
    let conversationId;
    if (conversationResult[0].length > 0) {
      conversationId = conversationResult[0][0].id;
    } else {
      const [newConv] = await db.execute(
        'INSERT INTO dm_conversations (user1_id, user2_id) VALUES (?, ?)',
        [1, user_id]
      );
      conversationId = newConv.insertId;
    }
    
    const messageHtml = DOMPurify.sanitize(marked.parse(deleteNotification));
    
    await db.execute(`
      INSERT INTO direct_messages (conversation_id, sender_id, recipient_id, content, content_html)
      VALUES (?, ?, ?, ?, ?)
    `, [conversationId, 1, user_id, deleteNotification, messageHtml]);
    
    console.log(`${COMPANY_NAME} email ${emailToDelete} deleted for user ${user.name} by admin ${req.user.userId}`);
    
    res.json({
      message: `${COMPANY_NAME} email account deleted and user notified`,
      deleted_email: emailToDelete,
      user_name: user.name
    });
  } catch (error) {
    console.error('Delete company email error:', error);
    res.status(500).json({ error: `Failed to delete ${COMPANY_EMAIL_DOMAIN} email account` });
  }
});

// Delete orphaned email account (admin only)
app.delete('/api/admin/company-email/delete-orphaned', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email_address } = req.body;
    
    if (!email_address) {
      return res.status(400).json({ error: 'Email address is required' });
    }
    
    // Verify it's actually orphaned (or get the linked user info)
    const [accounts] = await db.execute(
      'SELECT * FROM server_email_accounts WHERE email_address = ?',
      [email_address]
    );
    
    if (accounts.length === 0) {
      return res.status(404).json({ error: 'Email account not found' });
    }
    
    const account = accounts[0];
    
    // If linked to a user, clear their company_email field
    if (account.linked_user_id) {
      await db.execute(
        'UPDATE users SET company_email = NULL, company_email_created_at = NULL, company_email_last_reset = NULL WHERE id = ?',
        [account.linked_user_id]
      );
    }
    
    // Delete the system user account from mail server
    const serverUsername = email_address.split('@')[0] + `-${MAIL_USER_SUFFIX}`;
    try {
      await execAsync(`sudo userdel -r ${serverUsername}`);
      console.log(`System user ${serverUsername} deleted from mail server`);
      
      // Remove from virtual mailbox maps
      await execAsync(`sudo bash -c 'grep -v \"^${email_address}\" /etc/postfix/virtual_mailbox_maps > /tmp/mailbox_clean && sudo mv /tmp/mailbox_clean /etc/postfix/virtual_mailbox_maps && sudo postmap /etc/postfix/virtual_mailbox_maps && sudo systemctl reload postfix'`);
      console.log(`Removed ${email_address} from virtual mailbox maps`);
      
    } catch (userDelError) {
      console.warn(`Failed to delete system user ${serverUsername} from mail server:`, userDelError.message);
    }
    
    // Delete the email account record
    await db.execute(
      'DELETE FROM server_email_accounts WHERE email_address = ?',
      [email_address]
    );
    
    res.json({ 
      message: 'Email account deleted successfully',
      deleted_email: email_address 
    });
  } catch (error) {
    console.error('Delete email account error:', error);
    res.status(500).json({ error: 'Failed to delete email account' });
  }
});

// Test email endpoint (temporary for debugging)
app.post('/api/test-email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    await sendEmail(to, subject, message, `<p>${message}</p>`);
    res.json({ message: 'Test email sent successfully' });
  } catch (error) {
    console.error('Test email failed:', error);
    res.status(500).json({ error: 'Test email failed', details: error.message });
  }
});

// ===================== SYSTEM SETTINGS ENDPOINTS =====================

// Get system settings
app.get('/api/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [settings] = await db.execute(
      'SELECT * FROM system_settings ORDER BY setting_key'
    );
    res.json(settings);
  } catch (error) {
    console.error('Error fetching system settings:', error);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

// Update system setting
app.put('/api/admin/settings/:key', authenticateToken, requireAdmin, [
  body('value').optional().isString()
], async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const [result] = await db.execute(
      'UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
      [value || '', key]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    // Get updated setting
    const [updated] = await db.execute(
      'SELECT * FROM system_settings WHERE setting_key = ?',
      [key]
    );

    res.json({
      message: 'Setting updated successfully',
      setting: updated[0]
    });
  } catch (error) {
    console.error('Error updating system setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// ===================== WEBMAIL ENDPOINTS =====================

// Initialize email manager and crypto
const emailManager = new EmailManager();
const scheduledEmails = require('./server/lib/scheduledEmails');
const emailCrypto = new EmailCrypto();

// Get user's email account configuration
async function getUserEmailConfig(userId) {
  // Webmail only exists for the self-hosted provider. A member who switched to
  // Microsoft 365 / Google Workspace keeps any legacy mailbox row but cannot
  // reach it from here until they switch back.
  const [providerRows] = await db.execute('SELECT email_provider FROM users WHERE id = ?', [userId]);
  if (providerRows.length === 0 || !isSelfHostedProvider(providerRows[0].email_provider)) {
    return null;
  }
  const [accounts] = await db.execute(
    'SELECT * FROM server_email_accounts WHERE linked_user_id = ? AND server_status = "active"',
    [userId]
  );
  return accounts.length > 0 ? accounts[0] : null;
}

// Get webmail inbox
app.get('/api/webmail/inbox', authenticateToken, async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig || !emailConfig.email_password_encrypted) {
      return res.status(404).json({ error: 'Email account not found or not configured' });
    }

    const { limit = 50, mailbox = 'INBOX' } = req.query;
    const emails = await emailManager.fetchEmails(emailConfig, { 
      limit: parseInt(limit), 
      mailbox 
    });

    res.json({ emails });
  } catch (error) {
    console.error('Error fetching inbox:', error);
    res.status(500).json({ error: 'Failed to fetch emails', details: error.message });
  }
});

// Get single email by UID (with full body content)
app.get('/api/webmail/emails/:uid', authenticateToken, async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig || !emailConfig.email_password_encrypted) {
      return res.status(404).json({ error: 'Email account not found or not configured' });
    }

    const { uid } = req.params;
    const { mailbox = 'INBOX' } = req.query;

    const email = await emailManager.fetchEmailByUid(emailConfig, uid, mailbox);

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json({ email });
  } catch (error) {
    console.error('Error fetching email:', error);
    res.status(500).json({ error: 'Failed to fetch email', details: error.message });
  }
});

// Get webmail folders/mailboxes
app.get('/api/webmail/mailboxes', authenticateToken, async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig || !emailConfig.email_password_encrypted) {
      return res.status(404).json({ error: 'Email account not found or not configured' });
    }

    const mailboxes = await emailManager.getMailboxes(emailConfig);
    res.json({ mailboxes });
  } catch (error) {
    console.error('Error fetching mailboxes:', error);
    res.status(500).json({ error: 'Failed to fetch mailboxes', details: error.message });
  }
});

// Mark email as read
app.put('/api/webmail/emails/:uid/read', authenticateToken, async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const { uid } = req.params;
    const { mailbox = 'INBOX' } = req.body;
    
    await emailManager.markAsRead(emailConfig, parseInt(uid), mailbox);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking email as read:', error);
    res.status(500).json({ error: 'Failed to mark email as read' });
  }
});

// Delete email
app.delete('/api/webmail/emails/:uid', authenticateToken, async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const { uid } = req.params;
    const { mailbox = 'INBOX' } = req.body;
    
    await emailManager.deleteEmail(emailConfig, parseInt(uid), mailbox);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting email:', error);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

// Search emails
app.get('/api/webmail/search', authenticateToken, async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const { q, limit = 50, mailbox = 'INBOX' } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    // IMAP search criteria
    const searchCriteria = [['TEXT', q]];
    const emails = await emailManager.fetchEmails(emailConfig, { 
      limit: parseInt(limit), 
      mailbox,
      search: searchCriteria
    });

    res.json({ emails, query: q });
  } catch (error) {
    console.error('Error searching emails:', error);
    res.status(500).json({ error: 'Failed to search emails' });
  }
});

// Compose and send email with attachments
app.post('/api/webmail/compose', authenticateToken, (req, res, next) => {
  req.uploadType = 'email-attachments';
  next();
}, upload.array('attachments', 10), [
  body('to').notEmpty().withMessage('Recipient is required'),
  body('subject').notEmpty().withMessage('Subject is required'),
  body('text').optional(),
  body('html').optional(),
  body('cc').optional(),
  body('bcc').optional(),
  body('scheduled_at').optional() // ISO-8601; when present the mail is queued, not sent
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig || !emailConfig.email_password_encrypted) {
      return res.status(404).json({ error: 'Email account not found or not configured' });
    }

    const { to, cc, bcc, subject, text, html } = req.body;

    // Ensure at least text or html content
    if (!text && !html) {
      return res.status(400).json({ error: 'Email must have either text or HTML content' });
    }

    // Process uploaded attachments with error handling
    let emailAttachments = [];
    try {
      emailAttachments = req.files ? req.files.map(file => ({
        filename: file.originalname || 'attachment',
        path: file.path,
        contentType: file.mimetype || 'application/octet-stream',
        size: file.size || 0
      })) : [];
    } catch (attachmentError) {
      console.error('Error processing attachments:', attachmentError);
      return res.status(400).json({ error: 'Invalid attachment data' });
    }

    // Safe text processing
    const safeText = text || '';
    let safeHtml = '';
    try {
      safeHtml = html || (safeText ? `<p>${safeText.replace(/\n/g, '<br>')}</p>` : '');
    } catch (htmlError) {
      console.error('Error processing HTML content:', htmlError);
      safeHtml = html || '';
    }

    const emailData = {
      to,
      cc,
      bcc,
      subject,
      text: safeText,
      html: safeHtml,
      attachments: emailAttachments
    };

    // Schedule send: queue the fully-composed message for the
    // scheduledEmailSender worker instead of sending now. Multer has already
    // written the attachments to disk, so the row just keeps their paths.
    if (req.body.scheduled_at) {
      const parsed = scheduledEmails.parseScheduledAt(req.body.scheduled_at);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      const id = await scheduledEmails.insertScheduledEmail(db, {
        userId: req.user.userId,
        emailAccountId: emailConfig.id,
        to, cc, bcc, subject,
        text: safeText,
        html: safeHtml,
        attachments: emailAttachments,
        scheduledAt: parsed.date
      });
      return res.json({
        message: 'Email scheduled',
        scheduled: true,
        id,
        scheduled_at: parsed.date.toISOString()
      });
    }

    const result = await emailManager.sendEmail(emailConfig, emailData);
    
    res.json({
      message: 'Email sent successfully',
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected
    });

  } catch (error) {
    console.error('Error sending email via webmail:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      name: error.name
    });
    
    // Ensure we always return JSON, never HTML
    try {
      res.status(500).json({ 
        error: 'Failed to send email', 
        details: error.message,
        timestamp: new Date().toISOString()
      });
    } catch (responseError) {
      console.error('Failed to send error response:', responseError);
      res.status(500).end();
    }
  }
});

// Save draft email
app.post('/api/webmail/draft', authenticateToken, [
  body('to').optional(),
  body('subject').optional(),
  body('text').optional(),
  body('html').optional(),
  body('cc').optional(),
  body('bcc').optional()
], async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig || !emailConfig.email_password_encrypted) {
      return res.status(404).json({ error: 'Email account not found or not configured' });
    }

    const { to, cc, bcc, subject, text, html } = req.body;

    // Create email in RFC 822 format for draft
    const timestamp = Math.floor(Date.now() / 1000);
    const messageId = `<draft-${timestamp}-${Math.random().toString(36).substr(2, 9)}@${COMPANY_EMAIL_DOMAIN || 'intranet.local'}>`;

    // Build headers (filter out empty optional headers)
    const headers = [
      `From: ${emailConfig.email_address}`,
      to ? `To: ${to}` : '',
      cc ? `Cc: ${cc}` : '',
      bcc ? `Bcc: ${bcc}` : '',
      `Subject: ${subject || '(no subject)'}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8'
    ].filter(line => line !== '').join('\n');

    // Email format: headers + blank line + body
    const emailLines = headers + '\n\n' + (text || '');

    // Save to Drafts folder in Maildir format
    const draftFilename = `${timestamp}.M${process.pid}P${Date.now()}.${require('os').hostname()}:2,D`;
    const draftPath = `/var/mail/${emailConfig.email_address}/.Drafts/cur/${draftFilename}`;

    const fs = require('fs').promises;
    await fs.writeFile(draftPath, emailLines);
    await execAsync(`sudo chown vmail:vmail "${draftPath}" && sudo chmod 600 "${draftPath}"`);

    res.json({
      message: 'Draft saved successfully',
      draftId: draftFilename
    });

  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({
      error: 'Failed to save draft',
      details: error.message
    });
  }
});

// ── Scheduled sends ────────────────────────────────────────────
// Rows live in scheduled_emails; server/cron/scheduledEmailSender.js sends them.

// List the caller's scheduled / in-flight / failed sends (+ sends from the last 7 days)
app.get('/api/webmail/scheduled', authenticateToken, async (req, res) => {
  try {
    const emails = await scheduledEmails.listForUser(db, req.user.userId);
    res.json({ emails });
  } catch (error) {
    console.error('Error listing scheduled emails:', error);
    res.status(500).json({ error: 'Failed to list scheduled emails', details: error.message });
  }
});

// Cancel a scheduled send (only while it is still queued or has failed)
app.delete('/api/webmail/scheduled/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const ok = await scheduledEmails.cancelForUser(db, id, req.user.userId);
    if (!ok) return res.status(409).json({ error: 'This email is no longer scheduled (already sent, sending, or cancelled)' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling scheduled email:', error);
    res.status(500).json({ error: 'Failed to cancel scheduled email', details: error.message });
  }
});

// Reschedule a queued/failed send
app.put('/api/webmail/scheduled/:id', authenticateToken, [
  body('scheduled_at').notEmpty().withMessage('scheduled_at is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const parsed = scheduledEmails.parseScheduledAt(req.body.scheduled_at);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const ok = await scheduledEmails.rescheduleForUser(db, id, req.user.userId, parsed.date);
    if (!ok) return res.status(409).json({ error: 'This email is no longer scheduled (already sent, sending, or cancelled)' });
    res.json({ success: true, scheduled_at: parsed.date.toISOString() });
  } catch (error) {
    console.error('Error rescheduling email:', error);
    res.status(500).json({ error: 'Failed to reschedule email', details: error.message });
  }
});

// Send a scheduled email right now (claims the row so the worker cannot double-send)
app.post('/api/webmail/scheduled/:id/send-now', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const mine = await scheduledEmails.getForUser(db, id, req.user.userId);
    if (!mine) return res.status(404).json({ error: 'Scheduled email not found' });
    const claimed = await scheduledEmails.claim(db, id, ['scheduled', 'failed']);
    if (!claimed) return res.status(409).json({ error: 'This email is no longer scheduled (already sent, sending, or cancelled)' });
    const result = await scheduledEmails.sendClaimed(db, emailManager, id);
    if (result.outcome !== 'sent') {
      return res.status(500).json({ error: 'Failed to send email', details: result.error, outcome: result.outcome });
    }
    res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    console.error('Error sending scheduled email now:', error);
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
});

// Move email to different folder
app.put('/api/webmail/emails/:uid/move', authenticateToken, [
  body('targetMailbox').notEmpty(),
  body('sourceMailbox').optional()
], async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const { uid } = req.params;
    const { targetMailbox, sourceMailbox = 'INBOX' } = req.body;

    await emailManager.moveEmail(emailConfig, parseInt(uid), targetMailbox, sourceMailbox);
    res.json({ success: true });
  } catch (error) {
    console.error('Error moving email:', error);
    res.status(500).json({ error: 'Failed to move email' });
  }
});

// Download email attachment
app.get('/api/webmail/emails/:uid/attachments/:index', authenticateToken, async (req, res) => {
  try {
    const emailConfig = await getUserEmailConfig(req.user.userId);
    if (!emailConfig) {
      return res.status(404).json({ error: 'Email account not found' });
    }

    const { uid, index } = req.params;
    const { mailbox = 'INBOX' } = req.query;

    const attachment = await emailManager.getAttachment(
      emailConfig,
      parseInt(uid),
      parseInt(index),
      mailbox
    );

    // Set headers for file download
    res.setHeader('Content-Type', attachment.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
    res.setHeader('Content-Length', attachment.content.length);

    // Send the attachment content
    res.send(attachment.content);
  } catch (error) {
    console.error('Error downloading attachment:', error);
    res.status(500).json({ error: 'Failed to download attachment', details: error.message });
  }
});

// ===================== USER API TOKEN ENDPOINTS =====================

// Generate user API token
app.post('/api/user/generate-token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [users] = await db.execute('SELECT name, email FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = users[0];
    
    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenName = `${userData.name} - Personal API Token`;
    const description = `Personal API token for ${userData.email}`;
    
    // Deactivate the user's previous *personal* tokens only. Integration tokens
    // (named for the integration, e.g. an ElevenLabs agent) are provisioned
    // deliberately and must survive a personal-token rotation.
    await db.execute(
      "UPDATE api_tokens SET is_active = FALSE WHERE created_by = ? AND name LIKE '% - Personal API Token'",
      [userId]
    );
    
    // Create new token
    await db.execute(`
      INSERT INTO api_tokens (token, name, description, permissions, created_by, expires_at)
      VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 YEAR))
    `, [
      token, 
      tokenName, 
      description, 
      JSON.stringify(['posts:create', 'posts:read', 'user:read']), 
      userId
    ]);
    
    res.json({ 
      token: token,
      name: tokenName,
      permissions: ['posts:create', 'posts:read', 'user:read'],
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Generate user token error:', error);
    res.status(500).json({ error: 'Failed to generate API token' });
  }
});

// Get user's current API token
app.get('/api/user/api-token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const [tokens] = await db.execute(`
      SELECT token, name, created_at, last_used_at, expires_at 
      FROM api_tokens 
      WHERE created_by = ? AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);
    
    if (tokens.length === 0) {
      return res.json({ token: null });
    }
    
    res.json(tokens[0]);
  } catch (error) {
    console.error('Get user token error:', error);
    res.status(500).json({ error: 'Failed to fetch API token' });
  }
});

// ===================== ADMIN ENDPOINTS =====================

// Get all users (admin)
// Get all active users (accessible to all authenticated users - for dropdowns, etc.)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT id, email, name, github_username, intranet_username, avatar_url, role
       FROM users
       WHERE role IN ('user', 'admin', 'moderator')
       ORDER BY name ASC`
    );

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all users with full details (admin only)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT id, email, name, github_username, role, hourly_rate, created_at, last_login, company_email, company_email_created_at, company_email_last_reset FROM users ORDER BY created_at DESC'
    );

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user role (admin)
app.put('/api/admin/users/:userId/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['admin', 'moderator', 'user', 'pending', 'deactivated'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    await db.execute(
      'UPDATE users SET role = ? WHERE id = ?',
      [role, userId]
    );

    res.json({ message: 'User role updated' });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// Update user hourly rate (admin)
app.put('/api/admin/users/:userId/hourly-rate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { hourly_rate } = req.body;

    // Validate hourly rate (must be null or a positive number)
    if (hourly_rate !== null && (isNaN(hourly_rate) || hourly_rate < 0)) {
      return res.status(400).json({ error: 'Invalid hourly rate' });
    }

    await db.execute(
      'UPDATE users SET hourly_rate = ? WHERE id = ?',
      [hourly_rate, userId]
    );

    res.json({ message: 'Hourly rate updated' });
  } catch (error) {
    console.error('Update hourly rate error:', error);
    res.status(500).json({ error: 'Failed to update hourly rate' });
  }
});

// Get activity logs (admin)
app.get('/api/admin/activity', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [activities] = await db.execute(
      `SELECT a.*, u.name as user_name, u.github_username
       FROM activity_log a
       LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC
       LIMIT 100`
    );
    
    res.json(activities);
  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({ error: 'Failed to fetch activity logs' });
  }
});

// Delete user account (admin only)
app.delete('/api/admin/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Prevent deletion of current admin user
    if (parseInt(userId) === req.user.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    // Get user details before deletion
    const [users] = await db.execute(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userToDelete = users[0];
    
    // Prevent deletion of other admin users for safety
    if (userToDelete.role === 'admin') {
      return res.status(403).json({ error: 'Cannot delete admin users' });
    }
    
    // Delete user and all related data (cascade will handle most)
    await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    
    console.log(`User account deleted: ${userToDelete.name} (${userToDelete.email}) by admin ${req.user.userId}`);
    
    res.json({
      message: 'User account deleted successfully',
      deleted_user: {
        id: parseInt(userId),
        name: userToDelete.name,
        email: userToDelete.email
      }
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user account' });
  }
});

// ===================== QUICKLINKS ENDPOINTS =====================

// Get all quicklinks
app.get('/api/quicklinks', async (req, res) => {
  try {
    const [quicklinks] = await db.execute(
      'SELECT * FROM quicklinks WHERE is_active = 1 ORDER BY display_order ASC, id ASC'
    );
    res.json(quicklinks);
  } catch (error) {
    console.error('Get quicklinks error:', error);
    res.status(500).json({ error: 'Failed to fetch quicklinks' });
  }
});

// Get all quicklinks for admin (including inactive)
app.get('/api/admin/quicklinks', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [quicklinks] = await db.execute(
      'SELECT * FROM quicklinks ORDER BY display_order ASC, id ASC'
    );
    res.json(quicklinks);
  } catch (error) {
    console.error('Get admin quicklinks error:', error);
    res.status(500).json({ error: 'Failed to fetch quicklinks' });
  }
});

// Create quicklink (admin only)
app.post('/api/admin/quicklinks', authenticateToken, requireAdmin, [
  body('title').notEmpty().trim().isLength({ max: 255 }),
  body('url').notEmpty().trim().isURL(),
  body('description').optional().trim(),
  body('display_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, url, description, display_order } = req.body;

    const [result] = await db.execute(
      'INSERT INTO quicklinks (title, url, description, display_order) VALUES (?, ?, ?, ?)',
      [title, url, description || null, display_order || 0]
    );

    const [quicklink] = await db.execute(
      'SELECT * FROM quicklinks WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(quicklink[0]);
  } catch (error) {
    console.error('Create quicklink error:', error);
    res.status(500).json({ error: 'Failed to create quicklink' });
  }
});

// Update quicklink (admin only)
app.put('/api/admin/quicklinks/:id', authenticateToken, requireAdmin, [
  body('title').notEmpty().trim().isLength({ max: 255 }),
  body('url').notEmpty().trim().isURL(),
  body('description').optional().trim(),
  body('display_order').optional().isInt({ min: 0 }),
  body('is_active').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, url, description, display_order, is_active } = req.body;

    await db.execute(
      'UPDATE quicklinks SET title = ?, url = ?, description = ?, display_order = ?, is_active = ? WHERE id = ?',
      [title, url, description || null, display_order || 0, is_active !== undefined ? is_active : true, id]
    );

    const [quicklink] = await db.execute(
      'SELECT * FROM quicklinks WHERE id = ?',
      [id]
    );

    if (quicklink.length === 0) {
      return res.status(404).json({ error: 'Quicklink not found' });
    }

    res.json(quicklink[0]);
  } catch (error) {
    console.error('Update quicklink error:', error);
    res.status(500).json({ error: 'Failed to update quicklink' });
  }
});

// Delete quicklink (admin only)
app.delete('/api/admin/quicklinks/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.execute(
      'DELETE FROM quicklinks WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Quicklink not found' });
    }

    res.json({ message: 'Quicklink deleted successfully' });
  } catch (error) {
    console.error('Delete quicklink error:', error);
    res.status(500).json({ error: 'Failed to delete quicklink' });
  }
});

// ===================== EMAIL VERIFICATION ENDPOINTS =====================

// Verify email with token
app.get('/api/auth/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Find user with this verification token
    const [users] = await db.execute(
      'SELECT * FROM users WHERE email_verification_token = ? AND email_verification_expires > NOW() AND email_verified = FALSE',
      [token]
    );
    
    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }
    
    const user = users[0];

    // Pre-targeted agreements for this email (agreement_email_invites): when
    // present, those agreements govern this person (e.g. an employee signing an
    // employment agreement) — assign them and SKIP the team-agreement lockout.
    let emailInvites = [];
    try {
      const [inviteRows] = await db.execute(
        'SELECT * FROM agreement_email_invites WHERE email = ?',
        [user.email]
      );
      emailInvites = inviteRows;
    } catch (e) {
      if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
    }

    // Check if agreement is required
    const [activeAgreement] = await db.execute(
      'SELECT id FROM agreement_versions WHERE is_active = 1 LIMIT 1'
    );

    const requiresAgreement = emailInvites.length === 0 && activeAgreement.length > 0;
    const newRole = requiresAgreement ? 'pending_agreement' : 'user';

    // Mark email as verified and update role
    await db.execute(
      'UPDATE users SET email_verified = TRUE, email_verification_token = NULL, email_verification_expires = NULL, role = ? WHERE id = ?',
      [newRole, user.id]
    );

    // Convert email invites into real assignments (sends the sign-link emails),
    // then consume them.
    for (const invite of emailInvites) {
      try {
        await assignAgreementToUsers(invite.agreement_version_id, [user.id], invite.requested_by);
        await db.execute('DELETE FROM agreement_email_invites WHERE id = ?', [invite.id]);
      } catch (assignError) {
        console.error('Failed to convert agreement email invite', invite.id, assignError);
      }
    }

    res.json({
      message: 'Email verified successfully!',
      requires_agreement: requiresAgreement,
      redirect_to: requiresAgreement ? '/pending-agreement' : '/login'
    });
    
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// ===================== USER SEARCH ENDPOINTS =====================

// Search users for autocomplete (authenticated users only)
// @mention dropdown: people and AI agents. Each row carries
// mention_handle — exactly what to insert after "@" so the tag resolves in
// processMentions. A bare "@" (empty q) lists the agents plus the most
// recently active people so the dropdown opens immediately.
app.get('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@/, '') : '';
    const select = `
      SELECT u.id, u.name, u.github_username, u.intranet_username, u.avatar_url, u.account_type,
             COALESCE(a.handle, u.intranet_username, u.github_username) AS mention_handle,
             a.tagline AS agent_tagline
      FROM users u
      LEFT JOIN ai_agents a ON a.user_id = u.id
      WHERE COALESCE(a.handle, u.intranet_username, u.github_username) IS NOT NULL
        AND (a.user_id IS NOT NULL OR u.role NOT IN ('deactivated', 'system'))`;

    if (!query) {
      const [agents] = await db.execute(`${select} AND u.account_type = 'ai_agent' ORDER BY a.sort_order, u.name`);
      const [people] = await db.execute(
        `${select} AND u.account_type = 'human' ORDER BY u.last_login IS NULL, u.last_login DESC LIMIT 6`
      );
      return res.json([...people, ...agents]);
    }

    const contains = `%${query}%`;
    const prefix = `${query}%`;
    const [users] = await db.execute(`${select}
        AND (u.name LIKE ? OR u.github_username LIKE ? OR u.intranet_username LIKE ? OR a.handle LIKE ?)
      ORDER BY
        CASE
          WHEN COALESCE(a.handle, u.intranet_username, u.github_username) LIKE ? THEN 1
          WHEN u.name LIKE ? THEN 2
          ELSE 3
        END,
        u.name ASC
      LIMIT 10`,
      [contains, contains, contains, contains, prefix, prefix]
    );
    res.json(users);
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// ===================== AGREEMENT SYSTEM ENDPOINTS =====================

// Get current active agreement version
app.get('/api/agreements/current', async (req, res) => {
  try {
    const [versions] = await db.execute(
      'SELECT * FROM agreement_versions WHERE is_active = 1 AND agreement_type = "team" ORDER BY created_at DESC LIMIT 1'
    );
    
    if (versions.length === 0) {
      return res.status(404).json({ error: 'No active agreement version found' });
    }
    
    res.json(versions[0]);
  } catch (error) {
    console.error('Get current agreement error:', error);
    res.status(500).json({ error: 'Failed to fetch current agreement' });
  }
});

// Check user agreement status
app.get('/api/agreements/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get current active agreement
    const [currentVersion] = await db.execute(
      'SELECT id, version FROM agreement_versions WHERE is_active = 1 AND agreement_type = "team" ORDER BY created_at DESC LIMIT 1'
    );
    
    if (currentVersion.length === 0) {
      return res.status(404).json({ error: 'No active agreement version' });
    }
    
    // Check if user has signed current version
    const [userAgreement] = await db.execute(
      'SELECT * FROM user_agreements WHERE user_id = ? AND agreement_version_id = ? AND status = "signed"',
      [userId, currentVersion[0].id]
    );
    
    res.json({
      has_signed: userAgreement.length > 0,
      current_version: currentVersion[0].version,
      agreement_details: userAgreement[0] || null
    });
  } catch (error) {
    console.error('Get agreement status error:', error);
    res.status(500).json({ error: 'Failed to check agreement status' });
  }
});

// Sign agreement
app.post('/api/agreements/sign', authenticateToken, [
  body('full_name').notEmpty().trim(),
  body('email').isEmail(),
  body('quiz_answer').optional({ checkFalsy: true }).trim(),
  body('digital_signature').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.userId;
    const { full_name, email, quiz_answer, digital_signature, confirmations } = req.body;
    const ip_address = req.ip;

    // Get current active agreement
    const [currentVersion] = await db.execute(
      'SELECT * FROM agreement_versions WHERE is_active = 1 AND agreement_type = "team" ORDER BY created_at DESC LIMIT 1'
    );
    
    if (currentVersion.length === 0) {
      return res.status(404).json({ error: 'No active agreement version' });
    }
    
    const agreement = currentVersion[0];
    
    // Validate quiz answer — a team agreement may carry no quiz at all
    if (agreement.quiz_question && agreement.quiz_correct_answer) {
      if (!quiz_answer || quiz_answer.toLowerCase() !== agreement.quiz_correct_answer.toLowerCase()) {
        return res.status(400).json({ error: 'Incorrect quiz answer. Please try again.' });
      }
    }
    
    // Validate digital signature
    if (digital_signature.toLowerCase() !== 'agree') {
      return res.status(400).json({ error: 'Digital signature must be exactly "Agree"' });
    }
    
    // Check if user already signed this version
    const [existing] = await db.execute(
      'SELECT id FROM user_agreements WHERE user_id = ? AND agreement_version_id = ? AND status = "signed"',
      [userId, agreement.id]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'You have already signed this agreement version' });
    }
    
    // Record the agreement signature
    await db.execute(
      'INSERT INTO user_agreements (user_id, agreement_version_id, full_name, email, ip_address, quiz_answer, digital_signature, confirmations) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, agreement.id, full_name, email, ip_address, quiz_answer || null, digital_signature,
       confirmations && typeof confirmations === 'object' ? JSON.stringify(confirmations) : null]
    );
    
    // Promote user from pending_agreement to user role after signing
    await db.execute(
      'UPDATE users SET role = "user" WHERE id = ? AND role = "pending_agreement"',
      [userId]
    );

    // Get updated user data to generate new token
    const [updatedUser] = await db.execute(
      'SELECT id, email, name, role, hourly_rate, github_username, intranet_username FROM users WHERE id = ?',
      [userId]
    );

    if (updatedUser.length > 0) {
      // Generate new JWT token with updated role
      const newToken = jwt.sign(
        {
          userId: updatedUser[0].id,
          email: updatedUser[0].email,
          role: updatedUser[0].role,
          hourly_rate: updatedUser[0].hourly_rate,
          github_username: updatedUser[0].github_username,
          intranet_username: updatedUser[0].intranet_username
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        message: 'Agreement signed successfully',
        version: agreement.version,
        token: newToken,
        user: {
          id: updatedUser[0].id,
          email: updatedUser[0].email,
          name: updatedUser[0].name,
          role: updatedUser[0].role,
          github_username: updatedUser[0].github_username,
          intranet_username: updatedUser[0].intranet_username
        }
      });
    } else {
      res.json({ message: 'Agreement signed successfully', version: agreement.version });
    }
  } catch (error) {
    console.error('Sign agreement error:', error);
    res.status(500).json({ error: 'Failed to sign agreement' });
  }
});

// Admin: Get agreement versions with signature counts (must come before :agreementId route)
app.get('/api/admin/agreements/versions-with-stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [versions] = await db.execute(`
      SELECT av.*,
             COUNT(ua.id) as signature_count,
             COUNT(CASE WHEN ua.status = 'signed' THEN 1 END) as signed_count,
             COUNT(CASE WHEN ua.status = 'voided' THEN 1 END) as voided_count,
             (SELECT COUNT(*) FROM user_agreement_assignments uaa WHERE uaa.agreement_version_id = av.id AND uaa.status = 'pending') as pending_assignments,
             (SELECT COUNT(*) FROM user_agreement_assignments uaa WHERE uaa.agreement_version_id = av.id AND uaa.status = 'signed') as signed_assignments
      FROM agreement_versions av
      LEFT JOIN user_agreements ua ON av.id = ua.agreement_version_id
      GROUP BY av.id
      ORDER BY av.created_at DESC
    `);
    
    res.json(versions);
  } catch (error) {
    console.error('Get agreement versions with stats error:', error);
    res.status(500).json({ error: 'Failed to fetch agreement statistics' });
  }
});

// Admin: Get agreement activity summary (must come before :agreementId route)
app.get('/api/admin/agreements/activity', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [activity] = await db.execute(`
      SELECT ua.signed_at,
             ua.status,
             u.name as user_name,
             u.email as user_email,
             u.avatar_url as user_avatar,
             av.version as agreement_version,
             av.title as agreement_title
      FROM user_agreements ua
      JOIN users u ON ua.user_id = u.id
      JOIN agreement_versions av ON ua.agreement_version_id = av.id
      WHERE ua.signed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY ua.signed_at DESC
      LIMIT 50
    `);
    
    res.json(activity);
  } catch (error) {
    console.error('Get agreement activity error:', error);
    res.status(500).json({ error: 'Failed to fetch agreement activity' });
  }
});

// Admin: Get all signatures for a specific agreement version (must come before :agreementId route)
app.get('/api/admin/agreements/versions/:versionId/signatures', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { versionId } = req.params;
    
    const [signatures] = await db.execute(`
      SELECT ua.*,
             u.name as user_name,
             u.email as user_email,
             u.role as user_role,
             u.avatar_url as user_avatar,
             av.version as agreement_version,
             av.title as agreement_title,
             av.agreement_type,
             EXISTS(SELECT 1 FROM user_payroll_details upd WHERE upd.user_id = ua.user_id) as payroll_on_file
      FROM user_agreements ua
      JOIN users u ON ua.user_id = u.id
      JOIN agreement_versions av ON ua.agreement_version_id = av.id
      WHERE ua.agreement_version_id = ?
      ORDER BY ua.signed_at DESC
    `, [versionId]);
    
    res.json(signatures);
  } catch (error) {
    console.error('Get agreement signatures error:', error);
    res.status(500).json({ error: 'Failed to fetch agreement signatures' });
  }
});

// Admin: Toggle agreement version active status (must come before :agreementId route)
app.patch('/api/admin/agreements/versions/:versionId/toggle-active', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { versionId } = req.params;
    
    // Get current version
    const [currentVersion] = await db.execute(
      'SELECT id, version, is_active, agreement_type FROM agreement_versions WHERE id = ?',
      [versionId]
    );

    if (currentVersion.length === 0) {
      return res.status(404).json({ error: 'Agreement version not found' });
    }

    const version = currentVersion[0];
    const newActiveStatus = !version.is_active;

    // Only the global team agreement uses is_active; custom/employment versions
    // are reached through per-user assignments and must never become "current".
    if (newActiveStatus && version.agreement_type && version.agreement_type !== 'team') {
      return res.status(400).json({ error: 'Only team agreements can be activated. Custom/employment agreements are assigned to specific users instead.' });
    }
    
    if (newActiveStatus) {
      // If activating this version, deactivate all others first
      await db.execute('UPDATE agreement_versions SET is_active = 0');
    }
    
    // Update the target version
    await db.execute(
      'UPDATE agreement_versions SET is_active = ? WHERE id = ?',
      [newActiveStatus ? 1 : 0, versionId]
    );
    
    // Log the action
    await db.execute(
      'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [req.user.userId, 'toggle_agreement_version', JSON.stringify({
        message: `${newActiveStatus ? 'Activated' : 'Deactivated'} agreement version ${version.version}`,
        agreement_version_id: versionId,
        agreement_version: version.version,
        new_status: newActiveStatus
      }), req.ip]
    );
    
    res.json({
      message: `Agreement version ${version.version} ${newActiveStatus ? 'activated' : 'deactivated'}`,
      is_active: newActiveStatus
    });
  } catch (error) {
    console.error('Toggle agreement version error:', error);
    res.status(500).json({ error: 'Failed to toggle agreement version status' });
  }
});

// Get specific agreement details (admin only)
app.get('/api/admin/agreements/:agreementId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { agreementId } = req.params;
    
    const [agreements] = await db.execute(`
      SELECT ua.*, av.version, av.title, av.content, av.agreement_type, av.confirmations as version_confirmations,
             av.created_at as version_created_at,
             u.name as user_name, u.email as user_email,
             EXISTS(SELECT 1 FROM user_payroll_details upd WHERE upd.user_id = ua.user_id) as payroll_on_file
      FROM user_agreements ua
      JOIN agreement_versions av ON ua.agreement_version_id = av.id
      JOIN users u ON ua.user_id = u.id
      WHERE ua.id = ?
    `, [agreementId]);
    
    if (agreements.length === 0) {
      return res.status(404).json({ error: 'Agreement not found' });
    }
    
    res.json(agreements[0]);
  } catch (error) {
    console.error('Get agreement details error:', error);
    res.status(500).json({ error: 'Failed to fetch agreement details' });
  }
});

// Get user's agreement history (admin or self)
app.get('/api/agreements/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user.userId;
    
    // Allow users to view their own agreements, or admins to view any user's agreements
    if (parseInt(userId) !== requestingUserId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    
    const [agreements] = await db.execute(`
      SELECT ua.*, av.version, av.title, av.agreement_type, av.created_at as version_created_at
      FROM user_agreements ua
      JOIN agreement_versions av ON ua.agreement_version_id = av.id
      WHERE ua.user_id = ?
      ORDER BY ua.signed_at DESC
    `, [userId]);
    
    res.json(agreements);
  } catch (error) {
    console.error('Get user agreements error:', error);
    res.status(500).json({ error: 'Failed to fetch user agreements' });
  }
});

// Admin: Get all agreement versions
app.get('/api/admin/agreements/versions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [versions] = await db.execute(
      'SELECT * FROM agreement_versions ORDER BY created_at DESC'
    );
    res.json(versions);
  } catch (error) {
    console.error('Get agreement versions error:', error);
    res.status(500).json({ error: 'Failed to fetch agreement versions' });
  }
});

// Admin: Create new agreement version.
// agreement_type 'team' (default) keeps the historical behaviour: the new version
// becomes the single active team agreement. 'employment'/'custom' versions are
// created inactive, never touch is_active on other rows, and are reached only
// through per-user assignments (optionally created here via assign_to_user_ids).
app.post('/api/admin/agreements/versions', authenticateToken, requireAdmin, [
  body('version').notEmpty().trim(),
  body('title').notEmpty().trim(),
  body('content').notEmpty(),
  body('agreement_type').optional().isIn(['team', 'employment', 'custom']),
  body('quiz_question').optional({ nullable: true, checkFalsy: true }).trim(),
  body('quiz_correct_answer').optional({ nullable: true, checkFalsy: true }).trim(),
  body('required_fields').optional({ nullable: true }).isArray(),
  body('confirmations').optional({ nullable: true }).isArray(),
  body('assign_to_user_ids').optional({ nullable: true }).isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { version, title, content, quiz_question, quiz_correct_answer } = req.body;
    const agreementType = req.body.agreement_type || 'team';
    const requiredFields = Array.isArray(req.body.required_fields) && req.body.required_fields.length > 0
      ? req.body.required_fields : null;
    const confirmations = Array.isArray(req.body.confirmations) && req.body.confirmations.length > 0
      ? req.body.confirmations : null;
    const createdBy = req.user.userId;

    if (agreementType === 'team' && (!quiz_question || !quiz_correct_answer)) {
      return res.status(400).json({ error: 'Team agreements require quiz_question and quiz_correct_answer' });
    }
    if (requiredFields && !fieldCrypto.hasKey()) {
      return res.status(400).json({ error: 'PAYROLL_ENCRYPTION_KEY is not configured on this server — cannot create an agreement that collects payroll fields' });
    }
    const knownFields = ['sin', 'direct_deposit', 'address', 'date_of_birth'];
    if (requiredFields && requiredFields.some(f => !knownFields.includes(f))) {
      return res.status(400).json({ error: `required_fields must be a subset of: ${knownFields.join(', ')}` });
    }
    if (confirmations && confirmations.some(c => !c || typeof c.key !== 'string' || typeof c.label !== 'string')) {
      return res.status(400).json({ error: 'confirmations must be an array of {key,label}' });
    }

    const isActive = agreementType === 'team' ? 1 : 0;
    if (agreementType === 'team') {
      // Historical behaviour: a new team version replaces the active one
      await db.execute('UPDATE agreement_versions SET is_active = 0');
    }

    const [result] = await db.execute(
      'INSERT INTO agreement_versions (version, agreement_type, title, content, quiz_question, quiz_correct_answer, is_active, created_by, required_fields, confirmations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [version, agreementType, title, content, quiz_question || null, quiz_correct_answer || null, isActive, createdBy,
       requiredFields ? JSON.stringify(requiredFields) : null,
       confirmations ? JSON.stringify(confirmations) : null]
    );

    const [newVersion] = await db.execute(
      'SELECT * FROM agreement_versions WHERE id = ?',
      [result.insertId]
    );

    // Optional immediate assignment for custom/employment versions
    let assigned = [];
    const assignIds = Array.isArray(req.body.assign_to_user_ids) ? req.body.assign_to_user_ids : [];
    if (agreementType !== 'team' && assignIds.length > 0) {
      assigned = await assignAgreementToUsers(result.insertId, assignIds, req.user.userId);
    }

    res.status(201).json({ ...newVersion[0], assigned });
  } catch (error) {
    console.error('Create agreement version error:', error);
    res.status(500).json({ error: 'Failed to create agreement version' });
  }
});

// Admin: Request agreement from user
app.post('/api/admin/users/:userId/request-agreement', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get current active agreement
    const [activeAgreement] = await db.execute(
      'SELECT id, version FROM agreement_versions WHERE is_active = 1 AND agreement_type = "team" ORDER BY created_at DESC LIMIT 1'
    );
    
    if (activeAgreement.length === 0) {
      return res.status(404).json({ error: 'No active agreement version available' });
    }
    
    // Get user details
    const [users] = await db.execute(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [userId]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = users[0];
    
    // Check if user already signed current version
    const [existingAgreement] = await db.execute(
      'SELECT id FROM user_agreements WHERE user_id = ? AND agreement_version_id = ? AND status = "signed"',
      [userId, activeAgreement[0].id]
    );
    
    if (existingAgreement.length > 0) {
      return res.status(400).json({ error: 'User has already signed the current agreement version' });
    }
    
    // Update user role to pending_agreement
    await db.execute(
      'UPDATE users SET role = "pending_agreement" WHERE id = ?',
      [userId]
    );
    
    // Send email notification to user
    try {
      const adminName = req.user.name || 'Admin';
      const agreementUrl = `${BASE_URL}/agreement`;
      
      const emailSubject = `New Team Agreement Required - Action Needed`;
      const emailText = `Hi ${user.name},

${adminName} has requested that you sign our updated team member agreement (Version ${activeAgreement[0].version}).

To continue accessing the ${SITE_NAME} platform, please:

1. Log in to your account at: ${process.env.BASE_URL}/login
2. You'll be automatically redirected to sign the new agreement
3. Complete the agreement signing process

Your platform access has been temporarily suspended until you sign the new agreement.

If you have any questions, please contact ${adminName} or the admin team.

Best regards,
${SITE_TEAM}`;

      const emailHtml = `
        <h2>New Team Agreement Required 📋</h2>
        <p>Hi ${user.name},</p>
        <p><strong>${adminName}</strong> has requested that you sign our updated team member agreement.</p>
        
        <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #92400e; margin: 0 0 8px 0;">Action Required</h3>
          <p style="color: #92400e; margin: 0;">Your platform access is suspended until you sign Agreement Version ${activeAgreement[0].version}</p>
        </div>
        
        <h3>To sign the agreement:</h3>
        <ol>
          <li>Log in to your account</li>
          <li>You'll be redirected to the agreement page</li>
          <li>Complete the signing process</li>
        </ol>
        
        <p style="margin: 20px 0;">
          <a href="${process.env.BASE_URL}/force-agreement" style="background:#007bff;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">
            Sign Required Agreement
          </a>
        </p>
        
        <p>If you have any questions, please contact <strong>${adminName}</strong> or the admin team.</p>
        
        <hr>
        <p>Best regards,<br>${SITE_TEAM}</p>
      `;

      await sendEmail(user.email, emailSubject, emailText, emailHtml);
    } catch (emailError) {
      console.error('Failed to send agreement request email:', emailError);
      // Don't fail the request if email fails, but log it
    }
    
    // Log the action
    await db.execute(
      'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [req.user.userId, 'request_agreement', JSON.stringify({
        message: `Requested agreement v${activeAgreement[0].version} from user ${user.name} (${user.email})`,
        agreement_version: activeAgreement[0].version,
        target_user_id: userId,
        target_user_name: user.name,
        target_user_email: user.email
      }), req.ip]
    );
    
    res.json({
      message: `Agreement v${activeAgreement[0].version} requested from ${user.name}. Email notification sent.`,
      agreement_version: activeAgreement[0].version,
      user_name: user.name
    });
    
  } catch (error) {
    console.error('Request agreement error:', error);
    res.status(500).json({ error: 'Failed to request agreement' });
  }
});

// ============== PER-USER AGREEMENT ASSIGNMENTS + PAYROLL DETAILS ==============
// Custom/employment agreement versions are never served by /api/agreements/current
// and never set role = 'pending_agreement' (no lockout) — they reach users only
// through user_agreement_assignments rows and /agreements/:assignmentId links.
// Payroll fields (SIN, banking) are AES-256-GCM encrypted at rest via
// utils/fieldCrypto.js and are NEVER logged or returned from list endpoints.

// mysql2 may return JSON columns as objects or strings depending on version
function parseJsonColumn(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function maskedPayrollRow(row) {
  if (!row) return null;
  return {
    has_sin: !!row.sin_encrypted,
    sin_masked: row.sin_last3 ? `***-***-${row.sin_last3}` : null,
    has_bank: !!row.bank_account_encrypted,
    bank_account_masked: row.bank_account_last4 ? `••••${row.bank_account_last4}` : null,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    province: row.province,
    postal_code: row.postal_code,
    date_of_birth: row.date_of_birth,
    updated_at: row.updated_at
  };
}

// Validate + encrypt the payroll fields required by an agreement version.
// Returns { errors: [...] } or { errors: [], columns: {...} } ready to persist.
function buildPayrollColumns(requiredFields, payroll) {
  const errors = [];
  const columns = {};
  const p = payroll || {};

  if (requiredFields.includes('sin')) {
    const sin = fieldCrypto.normalizeDigits(p.sin);
    if (!fieldCrypto.isValidSIN(sin)) {
      errors.push('A valid 9-digit SIN is required (failed format or checksum validation)');
    } else {
      columns.sin_encrypted = fieldCrypto.encryptField(sin);
      columns.sin_last3 = sin.slice(-3);
    }
  }
  if (requiredFields.includes('direct_deposit')) {
    const inst = fieldCrypto.normalizeDigits(p.bank_institution);
    const transit = fieldCrypto.normalizeDigits(p.bank_transit);
    const account = fieldCrypto.normalizeDigits(p.bank_account);
    if (!fieldCrypto.isValidInstitution(inst)) errors.push('Bank institution number must be 3 digits');
    if (!fieldCrypto.isValidTransit(transit)) errors.push('Bank transit number must be 5 digits');
    if (!fieldCrypto.isValidAccount(account)) errors.push('Bank account number must be 7-12 digits');
    if (fieldCrypto.isValidInstitution(inst) && fieldCrypto.isValidTransit(transit) && fieldCrypto.isValidAccount(account)) {
      columns.bank_institution_encrypted = fieldCrypto.encryptField(inst);
      columns.bank_transit_encrypted = fieldCrypto.encryptField(transit);
      columns.bank_account_encrypted = fieldCrypto.encryptField(account);
      columns.bank_account_last4 = account.slice(-4);
    }
  }
  if (requiredFields.includes('address')) {
    const line1 = String(p.address_line1 || '').trim();
    const city = String(p.city || '').trim();
    const province = String(p.province || '').trim();
    const postal = String(p.postal_code || '').trim().toUpperCase();
    if (!line1 || !city || !province) errors.push('Address line 1, city, and province are required');
    if (!/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(postal)) errors.push('A valid Canadian postal code is required (e.g. V2S 7M8)');
    columns.address_line1 = line1 || null;
    columns.address_line2 = String(p.address_line2 || '').trim() || null;
    columns.city = city || null;
    columns.province = province || null;
    columns.postal_code = postal || null;
  }
  if (requiredFields.includes('date_of_birth')) {
    const dob = String(p.date_of_birth || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(Date.parse(dob)) || Date.parse(dob) >= Date.now()) {
      errors.push('A valid date of birth (YYYY-MM-DD, in the past) is required');
    } else {
      columns.date_of_birth = dob;
    }
  }
  return { errors, columns };
}

// Create assignments for a version and email each user a link. Shared by the
// create-version route and the explicit assign route. Returns per-user results.
async function assignAgreementToUsers(versionId, userIds, requestedBy) {
  const [versions] = await db.execute('SELECT * FROM agreement_versions WHERE id = ?', [versionId]);
  if (versions.length === 0) throw new Error('Agreement version not found');
  const version = versions[0];
  const results = [];

  for (const rawUserId of userIds) {
    const userId = parseInt(rawUserId);
    if (isNaN(userId)) continue;
    const [users] = await db.execute('SELECT id, name, email FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      results.push({ user_id: userId, status: 'error', error: 'User not found' });
      continue;
    }
    const user = users[0];
    try {
      const [existing] = await db.execute(
        'SELECT id, status FROM user_agreement_assignments WHERE user_id = ? AND agreement_version_id = ?',
        [userId, versionId]
      );
      let assignmentId;
      if (existing.length > 0) {
        if (existing[0].status === 'signed') {
          results.push({ user_id: userId, status: 'already_signed' });
          continue;
        }
        // Re-activate a cancelled assignment, or resend for a pending one
        await db.execute(
          'UPDATE user_agreement_assignments SET status = "pending", requested_by = ?, requested_at = NOW() WHERE id = ?',
          [requestedBy, existing[0].id]
        );
        assignmentId = existing[0].id;
      } else {
        const [ins] = await db.execute(
          'INSERT INTO user_agreement_assignments (user_id, agreement_version_id, requested_by) VALUES (?, ?, ?)',
          [userId, versionId, requestedBy]
        );
        assignmentId = ins.insertId;
      }

      try {
        const agreementUrl = `${BASE_URL}/agreements/${assignmentId}`;
        const emailSubject = `Agreement ready for your signature: ${version.title}`;
        const emailText = `Hi ${user.name},

An agreement is ready for your review and signature on ${SITE_NAME}:

  ${version.title}

Please log in and sign it here: ${agreementUrl}

Your platform access is not affected — you can sign at your convenience, but please do so promptly.

Best regards,
${SITE_TEAM}`;
        const emailHtml = `
          <h2>Agreement ready for your signature</h2>
          <p>Hi ${user.name},</p>
          <p>An agreement is ready for your review and signature on ${SITE_NAME}:</p>
          <p style="font-size:16px"><strong>${version.title}</strong></p>
          <p style="margin: 20px 0;">
            <a href="${agreementUrl}" style="background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;">
              Review &amp; Sign
            </a>
          </p>
          <p>Your platform access is not affected — you can sign at your convenience, but please do so promptly.</p>
          <hr>
          <p>Best regards,<br>${SITE_TEAM}</p>
        `;
        await sendEmail(user.email, emailSubject, emailText, emailHtml);
      } catch (emailError) {
        console.error('Failed to send assignment email:', emailError);
      }

      results.push({ user_id: userId, assignment_id: assignmentId, status: 'assigned' });
    } catch (err) {
      console.error('Assign agreement error for user', userId, err);
      results.push({ user_id: userId, status: 'error', error: 'Failed to create assignment' });
    }
  }
  return results;
}

// User: my agreement assignments (pending first)
app.get('/api/agreements/mine', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT uaa.id, uaa.status, uaa.requested_at, uaa.signed_at, uaa.user_agreement_id,
             av.id as agreement_version_id, av.version, av.title, av.agreement_type
      FROM user_agreement_assignments uaa
      JOIN agreement_versions av ON uaa.agreement_version_id = av.id
      WHERE uaa.user_id = ? AND uaa.status != 'cancelled'
      ORDER BY (uaa.status = 'pending') DESC, uaa.requested_at DESC
    `, [req.user.userId]);
    res.json(rows);
  } catch (error) {
    console.error('Get my agreements error:', error);
    res.status(500).json({ error: 'Failed to fetch your agreements' });
  }
});

// User/admin: full content of one assigned agreement
app.get('/api/agreements/assignment/:assignmentId', authenticateToken, async (req, res) => {
  try {
    const assignmentId = parseInt(req.params.assignmentId);
    if (isNaN(assignmentId)) return res.status(400).json({ error: 'Invalid assignment ID' });

    const [rows] = await db.execute(`
      SELECT uaa.id, uaa.user_id, uaa.status, uaa.requested_at, uaa.signed_at, uaa.user_agreement_id,
             av.id as agreement_version_id, av.version, av.title, av.content, av.agreement_type,
             av.quiz_question, av.required_fields, av.confirmations
      FROM user_agreement_assignments uaa
      JOIN agreement_versions av ON uaa.agreement_version_id = av.id
      WHERE uaa.id = ?
    `, [assignmentId]);

    if (rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const row = rows[0];
    if (row.user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    res.json({
      ...row,
      required_fields: parseJsonColumn(row.required_fields) || [],
      confirmations: parseJsonColumn(row.confirmations) || []
    });
  } catch (error) {
    console.error('Get assignment error:', error);
    res.status(500).json({ error: 'Failed to fetch assignment' });
  }
});

// User: sign an assigned agreement. Inserts user_agreements + user_payroll_details
// + updates the assignment in ONE transaction. Never changes the user's role.
app.post('/api/agreements/assignment/:assignmentId/sign', authenticateToken, [
  body('full_name').notEmpty().trim(),
  body('email').isEmail(),
  body('digital_signature').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const assignmentId = parseInt(req.params.assignmentId);
    if (isNaN(assignmentId)) return res.status(400).json({ error: 'Invalid assignment ID' });

    const [rows] = await db.execute(`
      SELECT uaa.id, uaa.user_id, uaa.status,
             av.id as agreement_version_id, av.version, av.title, av.agreement_type,
             av.quiz_question, av.quiz_correct_answer, av.required_fields, av.confirmations
      FROM user_agreement_assignments uaa
      JOIN agreement_versions av ON uaa.agreement_version_id = av.id
      WHERE uaa.id = ?
    `, [assignmentId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Assignment not found' });
    const assignment = rows[0];

    if (assignment.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'This agreement is not assigned to you' });
    }
    if (assignment.status === 'signed') {
      return res.status(400).json({ error: 'You have already signed this agreement' });
    }
    if (assignment.status === 'cancelled') {
      return res.status(400).json({ error: 'This agreement request was cancelled' });
    }

    const { full_name, email, quiz_answer, digital_signature } = req.body;
    const ip_address = req.ip;

    // Quiz only when the version defines one
    if (assignment.quiz_correct_answer) {
      if (!quiz_answer || quiz_answer.toLowerCase() !== assignment.quiz_correct_answer.toLowerCase()) {
        return res.status(400).json({ error: 'Incorrect quiz answer. Please try again.' });
      }
    }
    // Same signature behaviour as the team agreement
    if (digital_signature.toLowerCase() !== 'agree') {
      return res.status(400).json({ error: 'Digital signature must be exactly "Agree"' });
    }

    // All confirmations defined on the version must be ticked
    const confirmations = parseJsonColumn(assignment.confirmations) || [];
    const ticked = req.body.confirmations || {};
    const missing = confirmations.filter(c => !ticked[c.key]);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'All confirmations must be checked before signing' });
    }

    // Payroll fields, when the version requires them
    const requiredFields = parseJsonColumn(assignment.required_fields) || [];
    let payrollColumns = null;
    if (requiredFields.length > 0) {
      if (!fieldCrypto.hasKey()) {
        console.error('Assignment sign blocked: PAYROLL_ENCRYPTION_KEY missing');
        return res.status(500).json({ error: 'Server is not configured for payroll data collection. Please contact an admin.' });
      }
      const built = buildPayrollColumns(requiredFields, req.body.payroll);
      if (built.errors.length > 0) {
        return res.status(400).json({ error: built.errors.join('. ') });
      }
      payrollColumns = built.columns;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [uaResult] = await conn.execute(
        'INSERT INTO user_agreements (user_id, agreement_version_id, full_name, email, ip_address, quiz_answer, digital_signature, confirmations) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [assignment.user_id, assignment.agreement_version_id, full_name, email, ip_address,
         quiz_answer || null, digital_signature, JSON.stringify(Object.keys(ticked).filter(k => ticked[k]))]
      );
      const userAgreementId = uaResult.insertId;

      if (payrollColumns) {
        const cols = { user_agreement_id: userAgreementId, ...payrollColumns };
        const names = Object.keys(cols);
        const placeholders = names.map(() => '?').join(', ');
        const updates = names.map(n => `${n} = VALUES(${n})`).join(', ');
        await conn.execute(
          `INSERT INTO user_payroll_details (user_id, ${names.join(', ')}) VALUES (?, ${placeholders})
           ON DUPLICATE KEY UPDATE ${updates}`,
          [assignment.user_id, ...names.map(n => cols[n])]
        );
        await conn.execute(
          'INSERT INTO payroll_details_access_log (user_id, accessed_by, action, ip_address) VALUES (?, ?, "update", ?)',
          [assignment.user_id, req.user.userId, ip_address]
        );
      }

      await conn.execute(
        'UPDATE user_agreement_assignments SET status = "signed", signed_at = NOW(), user_agreement_id = ? WHERE id = ?',
        [userAgreementId, assignmentId]
      );

      await conn.commit();
      res.json({
        message: 'Agreement signed successfully',
        version: assignment.version,
        title: assignment.title,
        payroll_details_saved: !!payrollColumns
      });
    } catch (txError) {
      await conn.rollback();
      throw txError;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error('Sign assignment error:', error.message);
    res.status(500).json({ error: 'Failed to sign agreement' });
  }
});

// Admin: assign a custom/employment version to users (no lockout, emails a link)
app.post('/api/admin/agreements/versions/:versionId/assign', authenticateToken, requireAdmin, [
  body('user_ids').isArray({ min: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const versionId = parseInt(req.params.versionId);
    if (isNaN(versionId)) return res.status(400).json({ error: 'Invalid version ID' });

    const results = await assignAgreementToUsers(versionId, req.body.user_ids, req.user.userId);
    res.json({ results });
  } catch (error) {
    console.error('Assign agreement version error:', error);
    res.status(500).json({ error: error.message === 'Agreement version not found' ? error.message : 'Failed to assign agreement' });
  }
});

// Admin: cancel a pending assignment
app.delete('/api/admin/agreements/versions/:versionId/assign/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const versionId = parseInt(req.params.versionId);
    const userId = parseInt(req.params.userId);
    if (isNaN(versionId) || isNaN(userId)) return res.status(400).json({ error: 'Invalid ID' });

    const [result] = await db.execute(
      'UPDATE user_agreement_assignments SET status = "cancelled" WHERE agreement_version_id = ? AND user_id = ? AND status = "pending"',
      [versionId, userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'No pending assignment found for this user and version' });
    }
    res.json({ message: 'Assignment cancelled' });
  } catch (error) {
    console.error('Cancel assignment error:', error);
    res.status(500).json({ error: 'Failed to cancel assignment' });
  }
});

// Admin: assignment status for a version
app.get('/api/admin/agreements/versions/:versionId/assignments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const versionId = parseInt(req.params.versionId);
    if (isNaN(versionId)) return res.status(400).json({ error: 'Invalid version ID' });

    const [rows] = await db.execute(`
      SELECT uaa.id, uaa.status, uaa.requested_at, uaa.signed_at, uaa.user_agreement_id,
             u.id as user_id, u.name as user_name, u.email as user_email,
             EXISTS(SELECT 1 FROM user_payroll_details upd WHERE upd.user_id = u.id) as payroll_on_file
      FROM user_agreement_assignments uaa
      JOIN users u ON uaa.user_id = u.id
      WHERE uaa.agreement_version_id = ?
      ORDER BY uaa.requested_at DESC
    `, [versionId]);
    res.json(rows);
  } catch (error) {
    console.error('Get version assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// User: my payroll details, masked (never returns plaintext SIN/banking)
app.get('/api/users/me/payroll-details', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM user_payroll_details WHERE user_id = ?', [req.user.userId]);
    res.json({ payroll: maskedPayrollRow(rows[0] || null) });
  } catch (error) {
    console.error('Get my payroll details error:', error.message);
    res.status(500).json({ error: 'Failed to fetch payroll details' });
  }
});

// User: update my payroll details (re-encrypts; audited)
app.put('/api/users/me/payroll-details', authenticateToken, async (req, res) => {
  try {
    if (!fieldCrypto.hasKey()) {
      return res.status(500).json({ error: 'Server is not configured for payroll data collection. Please contact an admin.' });
    }
    // Only validate/store the groups actually submitted
    const p = req.body.payroll || {};
    const submittedFields = [];
    if (p.sin !== undefined) submittedFields.push('sin');
    if (p.bank_institution !== undefined || p.bank_transit !== undefined || p.bank_account !== undefined) submittedFields.push('direct_deposit');
    if (p.address_line1 !== undefined || p.city !== undefined || p.province !== undefined || p.postal_code !== undefined) submittedFields.push('address');
    if (p.date_of_birth !== undefined) submittedFields.push('date_of_birth');
    if (submittedFields.length === 0) {
      return res.status(400).json({ error: 'No payroll fields submitted' });
    }

    const built = buildPayrollColumns(submittedFields, p);
    if (built.errors.length > 0) {
      return res.status(400).json({ error: built.errors.join('. ') });
    }

    const cols = built.columns;
    const names = Object.keys(cols);
    const placeholders = names.map(() => '?').join(', ');
    const updates = names.map(n => `${n} = VALUES(${n})`).join(', ');
    await db.execute(
      `INSERT INTO user_payroll_details (user_id, ${names.join(', ')}) VALUES (?, ${placeholders})
       ON DUPLICATE KEY UPDATE ${updates}`,
      [req.user.userId, ...names.map(n => cols[n])]
    );
    await db.execute(
      'INSERT INTO payroll_details_access_log (user_id, accessed_by, action, ip_address) VALUES (?, ?, "update", ?)',
      [req.user.userId, req.user.userId, req.ip]
    );

    const [rows] = await db.execute('SELECT * FROM user_payroll_details WHERE user_id = ?', [req.user.userId]);
    res.json({ message: 'Payroll details updated', payroll: maskedPayrollRow(rows[0] || null) });
  } catch (error) {
    console.error('Update payroll details error:', error.message);
    res.status(500).json({ error: 'Failed to update payroll details' });
  }
});

// Admin: reveal a user's full payroll details. Every call is written to
// payroll_details_access_log — this is the ONLY route that decrypts.
app.get('/api/admin/users/:userId/payroll-details', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    const [rows] = await db.execute('SELECT * FROM user_payroll_details WHERE user_id = ?', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'No payroll details on file for this user' });
    const row = rows[0];

    await db.execute(
      'INSERT INTO payroll_details_access_log (user_id, accessed_by, action, ip_address) VALUES (?, ?, "view", ?)',
      [userId, req.user.userId, req.ip]
    );

    res.json({
      payroll: {
        sin: row.sin_encrypted ? fieldCrypto.decryptField(row.sin_encrypted) : null,
        bank_institution: row.bank_institution_encrypted ? fieldCrypto.decryptField(row.bank_institution_encrypted) : null,
        bank_transit: row.bank_transit_encrypted ? fieldCrypto.decryptField(row.bank_transit_encrypted) : null,
        bank_account: row.bank_account_encrypted ? fieldCrypto.decryptField(row.bank_account_encrypted) : null,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        city: row.city,
        province: row.province,
        postal_code: row.postal_code,
        date_of_birth: row.date_of_birth,
        updated_at: row.updated_at
      },
      access_logged: true
    });
  } catch (error) {
    console.error('Admin payroll reveal error:', error.message);
    res.status(500).json({ error: 'Failed to fetch payroll details' });
  }
});

// Force agreement route - logs out user and redirects to login with agreement flow
app.get('/force-agreement', (req, res) => {
  // Clear any existing cookies/sessions
  res.clearCookie('owtranet-token');
  res.clearCookie('connect.sid');
  
  // Redirect to login with special parameter
  res.redirect('/login?require_agreement=true');
});


// ===================== STATIC FILES =====================

// Redirect post ID URLs to slug URLs (for short URLs and notifications)
app.get('/forum/post/:id(\\d+)', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get post slug by ID
    const [posts] = await db.execute(
      'SELECT slug FROM posts WHERE id = ?',
      [id]
    );
    
    if (posts.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Post Not Found</title></head>
          <body>
            <h1>Post Not Found</h1>
            <p>The post with ID ${id} could not be found.</p>
            <a href="/forum">← Back to Forum</a>
          </body>
        </html>
      `);
    }
    
    // Redirect to the proper slug URL
    const fullSlugUrl = `/forum/post/${posts[0].slug}`;
    res.redirect(301, fullSlugUrl);
    
  } catch (error) {
    console.error('Post redirect error:', error);
    res.status(500).send('Server error during redirect');
  }
});

// ===================== TASK MANAGER ENDPOINTS =====================

// List tasks (with filters, search, pagination)
app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, priority, assigned_to, search, sort = 'newest', view = 'all' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (view === 'mine') {
      whereClause += ' AND (t.assigned_to = ? OR t.created_by = ?)';
      params.push(req.user.userId, req.user.userId);
    }
    if (status) {
      whereClause += ' AND t.status = ?';
      params.push(status);
    }
    if (priority) {
      whereClause += ' AND t.priority = ?';
      params.push(priority);
    }
    if (assigned_to) {
      whereClause += ' AND t.assigned_to = ?';
      params.push(parseInt(assigned_to));
    }
    if (search) {
      whereClause += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    let orderBy = 'ORDER BY t.created_at DESC';
    if (sort === 'due_date') orderBy = 'ORDER BY t.due_date IS NULL, t.due_date ASC, t.created_at DESC';
    if (sort === 'priority') orderBy = 'ORDER BY FIELD(t.priority, "urgent", "high", "normal", "low"), t.created_at DESC';
    if (sort === 'oldest') orderBy = 'ORDER BY t.created_at ASC';

    const countParams = [...params];
    const dataParams = [...params, parseInt(limit), offset];

    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM tasks t ${whereClause}`,
      countParams
    );

    // db.query, not db.execute: MySQL 8.4 rejects numeric LIMIT/OFFSET
    // bindings in prepared statements (ER_WRONG_ARGUMENTS).
    const [tasks] = await db.query(
      `SELECT t.*,
        creator.name as creator_name, creator.intranet_username as creator_username, creator.avatar_url as creator_avatar,
        assignee.name as assignee_name, assignee.intranet_username as assignee_username, assignee.avatar_url as assignee_avatar,
        (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) as comment_count
      FROM tasks t
      LEFT JOIN users creator ON t.created_by = creator.id
      LEFT JOIN users assignee ON t.assigned_to = assignee.id
      ${whereClause}
      ${orderBy}
      LIMIT ? OFFSET ?`,
      dataParams
    );

    const total = countResult[0].total;

    res.json({
      tasks,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to retrieve tasks' });
  }
});

// Recent activity feed across all tasks
app.get('/api/tasks/activity', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [activity] = await db.query(
      `SELECT ta.*, t.title as task_title,
        u.name as user_name, u.intranet_username as user_username, u.avatar_url as user_avatar
      FROM task_activity ta
      JOIN tasks t ON ta.task_id = t.id
      JOIN users u ON ta.user_id = u.id
      ORDER BY ta.created_at DESC
      LIMIT ? OFFSET ?`,
      [parseInt(limit), offset]
    );

    res.json({ activity });
  } catch (error) {
    console.error('Get task activity feed error:', error);
    res.status(500).json({ error: 'Failed to retrieve activity feed' });
  }
});

// List assignable users
app.get('/api/tasks/users', authenticateToken, async (req, res) => {
  try {
    const [users] = await db.execute(
      `SELECT id, name, intranet_username, avatar_url FROM users WHERE role IN ('admin', 'moderator', 'user') ORDER BY name ASC`
    );
    res.json({ users });
  } catch (error) {
    console.error('Get task users error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Get single task
app.get('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [tasks] = await db.execute(
      `SELECT t.*,
        creator.name as creator_name, creator.intranet_username as creator_username, creator.avatar_url as creator_avatar,
        assignee.name as assignee_name, assignee.intranet_username as assignee_username, assignee.avatar_url as assignee_avatar,
        (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) as comment_count
      FROM tasks t
      LEFT JOIN users creator ON t.created_by = creator.id
      LEFT JOIN users assignee ON t.assigned_to = assignee.id
      WHERE t.id = ?`,
      [id]
    );

    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(tasks[0]);
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'Failed to retrieve task' });
  }
});

// Create task
// Create a task as `actor` ({ userId, ... }): insert, log activity, notify the
// assignee, process @mentions. Shared by POST /api/tasks (JWT) and
// POST /api/v1/tasks (API token / voice agent). Returns the new task id.
async function createTaskRecord(fields, actor) {
  const { title, description, priority = 'normal', status = 'pending', due_date, assigned_to } = fields;
  const descriptionHtml = markdownToHtml(description || '');

  const [result] = await db.execute(
    `INSERT INTO tasks (title, description, description_html, status, priority, due_date, created_by, assigned_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, description || null, descriptionHtml, status, priority, due_date || null, actor.userId, assigned_to || null]
  );

  const taskId = result.insertId;

  // Log activity
  await db.execute(
    'INSERT INTO task_activity (task_id, user_id, action, new_value, details) VALUES (?, ?, ?, ?, ?)',
    [taskId, actor.userId, 'created', title, JSON.stringify({ priority, status })]
  );

  // If assigned to someone else, create notification
  if (assigned_to && assigned_to !== actor.userId) {
    const [creator] = await db.execute('SELECT name, intranet_username FROM users WHERE id = ?', [actor.userId]);
    const creatorName = creator[0]?.intranet_username || creator[0]?.name || 'Someone';
    await db.execute(
      'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
      [assigned_to, 'task_assigned', 'Task assigned to you', `${creatorName} assigned you: "${title}"`, JSON.stringify({ taskId })]
    );
  }

  // Process mentions in description
  if (description) {
    await processMentions(description, 'task', taskId, actor.userId, actor);
  }
  return taskId;
}

app.post('/api/tasks', authenticateToken, [
  body('title').notEmpty().withMessage('Title is required').trim(),
  body('description').optional().trim(),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
  body('status').optional().isIn(['pending', 'in_progress', 'completed']),
  body('due_date').optional({ nullable: true }),
  body('assigned_to').optional({ nullable: true }).isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const taskId = await createTaskRecord(req.body, req.user);
    res.status(201).json({ message: 'Task created', taskId });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update task
// Apply a partial update to task `id` as `actor`, logging activity and
// notifying a new assignee. Shared by PUT /api/tasks/:id (JWT) and
// PUT /api/v1/tasks/:id (API token / voice agent). Throws ApiError.
async function applyTaskUpdate(id, fields, actor) {
  const { title, description, priority, status, due_date, assigned_to } = fields;

  const [existing] = await db.execute('SELECT * FROM tasks WHERE id = ?', [id]);
  if (existing.length === 0) {
    throw new ApiError(404, 'Task not found');
  }

  const task = existing[0];

  // Build dynamic update
  const updates = [];
  const values = [];

  if (title !== undefined && title !== task.title) {
    updates.push('title = ?');
    values.push(title);
    await db.execute(
      'INSERT INTO task_activity (task_id, user_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
      [id, actor.userId, 'edited', task.title, title]
    );
  }

  if (description !== undefined) {
    const descriptionHtml = markdownToHtml(description);
    updates.push('description = ?, description_html = ?');
    values.push(description, descriptionHtml);
    if (description !== task.description) {
      await db.execute(
        'INSERT INTO task_activity (task_id, user_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
        [id, actor.userId, 'edited', 'description updated', 'description updated']
      );
    }
  }

  if (status !== undefined && status !== task.status) {
    updates.push('status = ?');
    values.push(status);
    await db.execute(
      'INSERT INTO task_activity (task_id, user_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
      [id, actor.userId, 'status_changed', task.status, status]
    );
  }

  if (priority !== undefined && priority !== task.priority) {
    updates.push('priority = ?');
    values.push(priority);
    await db.execute(
      'INSERT INTO task_activity (task_id, user_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
      [id, actor.userId, 'priority_changed', task.priority, priority]
    );
  }

  if (due_date !== undefined) {
    const newDueDate = due_date || null;
    const oldDueDate = task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : null;
    if (newDueDate !== oldDueDate) {
      updates.push('due_date = ?');
      values.push(newDueDate);
      await db.execute(
        'INSERT INTO task_activity (task_id, user_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
        [id, actor.userId, 'due_date_changed', oldDueDate || 'none', newDueDate || 'none']
      );
    }
  }

  if (assigned_to !== undefined) {
    const newAssigned = assigned_to || null;
    if (newAssigned !== task.assigned_to) {
      updates.push('assigned_to = ?');
      values.push(newAssigned);

      // Look up names for activity log
      let oldName = 'unassigned';
      let newName = 'unassigned';
      if (task.assigned_to) {
        const [old] = await db.execute('SELECT name FROM users WHERE id = ?', [task.assigned_to]);
        if (old.length) oldName = old[0].name;
      }
      if (newAssigned) {
        const [nu] = await db.execute('SELECT name FROM users WHERE id = ?', [newAssigned]);
        if (nu.length) newName = nu[0].name;
      }

      await db.execute(
        'INSERT INTO task_activity (task_id, user_id, action, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
        [id, actor.userId, 'assigned', oldName, newName]
      );

      // Notify newly assigned user
      if (newAssigned && newAssigned !== actor.userId) {
        const [assigner] = await db.execute('SELECT name, intranet_username FROM users WHERE id = ?', [actor.userId]);
        const assignerName = assigner[0]?.intranet_username || assigner[0]?.name || 'Someone';
        await db.execute(
          'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
          [newAssigned, 'task_assigned', 'Task assigned to you', `${assignerName} assigned you: "${task.title}"`, JSON.stringify({ taskId: parseInt(id) })]
        );
      }
    }
  }

  if (updates.length === 0) {
    throw new ApiError(400, 'No fields to update');
  }

  values.push(id);
  await db.execute(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);
  return { taskId: parseInt(id), changed: updates.length };
}

app.put('/api/tasks/:id', authenticateToken, [
  body('title').optional().trim(),
  body('description').optional().trim(),
  body('priority').optional().isIn(['low', 'normal', 'high', 'urgent']),
  body('status').optional().isIn(['pending', 'in_progress', 'completed']),
  body('due_date').optional({ nullable: true }),
  body('assigned_to').optional({ nullable: true })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    await applyTaskUpdate(id, req.body, req.user);
    res.json({ message: 'Task updated', taskId: parseInt(id) });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete task (creator or admin only)
app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [tasks] = await db.execute('SELECT created_by, title FROM tasks WHERE id = ?', [id]);
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (tasks[0].created_by !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this task' });
    }

    await db.execute('DELETE FROM tasks WHERE id = ?', [id]);

    res.json({ message: 'Task deleted' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Get comments for a task
app.get('/api/tasks/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [comments] = await db.execute(
      `SELECT tc.*, u.name as author_name, u.intranet_username as author_username, u.avatar_url as author_avatar
      FROM task_comments tc
      JOIN users u ON tc.user_id = u.id
      WHERE tc.task_id = ?
      ORDER BY tc.created_at ASC`,
      [id]
    );

    res.json({ comments });
  } catch (error) {
    console.error('Get task comments error:', error);
    res.status(500).json({ error: 'Failed to retrieve comments' });
  }
});

// Add comment to task
app.post('/api/tasks/:id/comments', authenticateToken, [
  body('content').notEmpty().withMessage('Comment content is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { content } = req.body;
    const contentHtml = markdownToHtml(content);

    // Verify task exists
    const [tasks] = await db.execute('SELECT created_by, assigned_to, title FROM tasks WHERE id = ?', [id]);
    if (tasks.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const [result] = await db.execute(
      'INSERT INTO task_comments (task_id, user_id, content, content_html) VALUES (?, ?, ?, ?)',
      [id, req.user.userId, content, contentHtml]
    );

    const commentId = result.insertId;

    // Log activity
    await db.execute(
      'INSERT INTO task_activity (task_id, user_id, action, new_value) VALUES (?, ?, ?, ?)',
      [id, req.user.userId, 'commented', content.substring(0, 200)]
    );

    // Notify task creator and assignee
    const task = tasks[0];
    const notifyUserIds = new Set();
    if (task.created_by !== req.user.userId) notifyUserIds.add(task.created_by);
    if (task.assigned_to && task.assigned_to !== req.user.userId) notifyUserIds.add(task.assigned_to);

    const [commenter] = await db.execute('SELECT name, intranet_username FROM users WHERE id = ?', [req.user.userId]);
    const commenterName = commenter[0]?.intranet_username || commenter[0]?.name || 'Someone';

    for (const notifyUserId of notifyUserIds) {
      await db.execute(
        'INSERT INTO notifications (user_id, type, title, message, data) VALUES (?, ?, ?, ?, ?)',
        [notifyUserId, 'task_comment', 'New comment on task', `${commenterName} commented on "${task.title}"`, JSON.stringify({ taskId: parseInt(id), commentId })]
      );
    }

    // Process mentions
    await processMentions(content, 'task_comment', commentId, req.user.userId, req.user);

    // Return the created comment with user info
    const [newComment] = await db.execute(
      `SELECT tc.*, u.name as author_name, u.intranet_username as author_username, u.avatar_url as author_avatar
      FROM task_comments tc
      JOIN users u ON tc.user_id = u.id
      WHERE tc.id = ?`,
      [commentId]
    );

    res.status(201).json({ message: 'Comment created', comment: newComment[0] });
  } catch (error) {
    console.error('Create task comment error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// Delete task comment (author or admin only)
app.delete('/api/tasks/comments/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;

    const [comments] = await db.execute('SELECT user_id FROM task_comments WHERE id = ?', [commentId]);
    if (comments.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comments[0].user_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    await db.execute('DELETE FROM task_comments WHERE id = ?', [commentId]);

    res.json({ message: 'Comment deleted' });
  } catch (error) {
    console.error('Delete task comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Get activity log for a single task
app.get('/api/tasks/:id/activity', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [activity] = await db.execute(
      `SELECT ta.*, u.name as user_name, u.intranet_username as user_username, u.avatar_url as user_avatar
      FROM task_activity ta
      JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id = ?
      ORDER BY ta.created_at DESC`,
      [id]
    );

    res.json({ activity });
  } catch (error) {
    console.error('Get task activity error:', error);
    res.status(500).json({ error: 'Failed to retrieve task activity' });
  }
});

// ===================== LEDGER API =====================

// Get ledger statistics (must be before /:id route)
app.get('/api/ledger/stats/summary', authenticateToken, async (req, res) => {
  try {
    let userCondition = '';
    let params = [];

    if (req.user.role !== 'admin') {
      userCondition = 'WHERE user_id = ? OR payee_user_id = ?';
      params = [req.user.userId, req.user.userId];
    }

    // 'income' rows are money IN, not expenses — exclude them from the expense
    // status totals (so they don't inflate pending/approved/paid) and report a
    // separate income_total instead. Expense totals below use COALESCE(amount)
    // (base currency) but skip category='income'.
    const [stats] = await db.execute(`
      SELECT
        COUNT(*) as total_entries,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        COALESCE(SUM(CASE WHEN status = 'approved' AND expense_category <> 'income' THEN total_with_tax ELSE 0 END), 0) as approved_total,
        COALESCE(SUM(CASE WHEN status = 'paid' AND expense_category <> 'income' THEN total_with_tax ELSE 0 END), 0) as paid_total,
        COALESCE(SUM(CASE WHEN status = 'pending' AND expense_category <> 'income' THEN total_with_tax ELSE 0 END), 0) as pending_total,
        SUM(CASE WHEN expense_category = 'income' THEN 1 ELSE 0 END) as income_count,
        COALESCE(SUM(CASE WHEN expense_category = 'income' THEN amount ELSE 0 END), 0) as income_total
      FROM ledger ${userCondition}
    `, params);

    res.json(stats[0]);
  } catch (error) {
    console.error('Get ledger stats error:', error);
    res.status(500).json({ error: 'Failed to fetch ledger statistics' });
  }
});

// Per-project rollup: distinct projects with their income vs expense totals.
// Powers the ledger's project filter dropdown and per-project profitability.
app.get('/api/ledger/projects', authenticateToken, async (req, res) => {
  try {
    let userCondition = "WHERE project_code IS NOT NULL AND project_code <> ''";
    const params = [];
    if (req.user.role !== 'admin') {
      userCondition += ' AND (user_id = ? OR payee_user_id = ?)';
      params.push(req.user.userId, req.user.userId);
    }
    const [rows] = await db.execute(`
      SELECT
        project_code AS project,
        COUNT(*) AS entries,
        COALESCE(SUM(CASE WHEN expense_category = 'income' THEN amount ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN expense_category <> 'income' THEN total_with_tax ELSE 0 END), 0) AS expense_total
      FROM ledger
      ${userCondition}
      GROUP BY project_code
      ORDER BY project_code
    `, params);
    // net = income - expenses per project
    res.json(rows.map(r => ({
      ...r,
      net_total: Number(r.income_total) - Number(r.expense_total)
    })));
  } catch (error) {
    console.error('Get ledger projects error:', error);
    res.status(500).json({ error: 'Failed to fetch ledger projects' });
  }
});

// Per-member rollup: each member (the user a ledger row is attributed to) with
// their income vs expense totals and net cashflow. Powers the "By Member" panel.
app.get('/api/ledger/members', authenticateToken, async (req, res) => {
  try {
    let userCondition = '';
    const params = [];
    if (req.user.role !== 'admin') {
      userCondition = 'WHERE (l.user_id = ? OR l.payee_user_id = ?)';
      params.push(req.user.userId, req.user.userId);
    }
    const [rows] = await db.execute(`
      SELECT
        l.user_id,
        u.name AS member,
        COUNT(*) AS entries,
        COALESCE(SUM(CASE WHEN l.expense_category = 'income' THEN l.amount ELSE 0 END), 0) AS income_total,
        COALESCE(SUM(CASE WHEN l.expense_category <> 'income' THEN l.total_with_tax ELSE 0 END), 0) AS expense_total
      FROM ledger l
      JOIN users u ON l.user_id = u.id
      ${userCondition}
      GROUP BY l.user_id, u.name
      ORDER BY u.name
    `, params);
    // net = income brought in - expenses paid, per member
    res.json(rows.map(r => ({
      ...r,
      net_total: Number(r.income_total) - Number(r.expense_total)
    })));
  } catch (error) {
    console.error('Get ledger members error:', error);
    res.status(500).json({ error: 'Failed to fetch ledger members' });
  }
});

// Get all ledger entries
app.get('/api/ledger', authenticateToken, async (req, res) => {
  try {
    const { status, expense_category, source, search, project, member } = req.query;

    let query = `
      SELECT l.*,
             u.name as user_name, u.github_username,
             p.name as payee_name,
             a.name as approver_name,
             r.name as reimburser_name
      FROM ledger l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN users p ON l.payee_user_id = p.id
      LEFT JOIN users a ON l.approved_by = a.id
      LEFT JOIN users r ON l.reimbursed_by = r.id
    `;

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('l.status = ?');
      params.push(status);
    }

    if (expense_category) {
      conditions.push('l.expense_category = ?');
      params.push(expense_category);
    }

    if (source) {
      conditions.push('l.source = ?');
      params.push(source);
    }

    // Filter by project (exact match on the project_code column).
    if (project) {
      conditions.push('l.project_code = ?');
      params.push(project);
    }

    // Filter by member (the user_id a row is attributed to).
    if (member) {
      conditions.push('l.user_id = ?');
      params.push(member);
    }

    // Free-text search across title, vendor, receipt #, payment reference, the
    // payment method (e.g. the last 4 digits of the card an expense was charged
    // to, stored as "WestJet Visa ****3355"), the project, the description, and
    // the amounts (so a query like "33.53" matches an expense of that value —
    // amount/total_with_tax/original_amount are cast to text for the LIKE).
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push('(l.title LIKE ? OR l.vendor_name LIKE ? OR l.receipt_number LIKE ? OR l.payment_reference LIKE ? OR l.payment_method LIKE ? OR l.project_code LIKE ? OR l.description LIKE ? OR CAST(l.amount AS CHAR) LIKE ? OR CAST(l.total_with_tax AS CHAR) LIKE ? OR CAST(l.original_amount AS CHAR) LIKE ?)');
      params.push(term, term, term, term, term, term, term, term, term, term);
    }

    // Access control: admins see all, users see their own
    if (req.user.role !== 'admin') {
      conditions.push('(l.user_id = ? OR l.payee_user_id = ?)');
      params.push(req.user.userId, req.user.userId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY l.expense_date DESC, l.created_at DESC';

    const [entries] = await db.execute(query, params);
    res.json(entries);
  } catch (error) {
    console.error('Get ledger entries error:', error);
    res.status(500).json({ error: 'Failed to fetch ledger entries' });
  }
});

// Get single ledger entry
app.get('/api/ledger/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [entries] = await db.execute(`
      SELECT l.*,
             u.name as user_name, u.email as user_email,
             p.name as payee_name,
             a.name as approver_name,
             r.name as reimburser_name
      FROM ledger l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN users p ON l.payee_user_id = p.id
      LEFT JOIN users a ON l.approved_by = a.id
      LEFT JOIN users r ON l.reimbursed_by = r.id
      WHERE l.id = ?
    `, [id]);

    if (entries.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }

    const entry = entries[0];

    // Check permission
    if (req.user.role !== 'admin' && entry.user_id !== req.user.userId && entry.payee_user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    res.json(entry);
  } catch (error) {
    console.error('Get ledger entry error:', error);
    res.status(500).json({ error: 'Failed to fetch ledger entry' });
  }
});

// Create ledger entry
app.post('/api/ledger', authenticateToken, async (req, res) => {
  try {
    const {
      payee_user_id,
      expense_category,
      title,
      description,
      content,
      content_html,
      amount,
      adjusted_amount,
      original_amount,
      original_currency,
      exchange_rate,
      subtotal,
      pst_amount,
      pst_rate,
      gst_amount,
      gst_rate,
      hst_amount,
      hst_rate,
      vat_amount,
      vat_rate,
      other_tax_amount,
      other_tax_description,
      tax_total,
      total_with_tax,
      vendor_name,
      vendor_tax_id,
      receipt_number,
      expense_date,
      due_date,
      status,
      is_draft,
      is_reimbursable,
      is_recurring,
      recurring_frequency,
      payment_method,
      gl_code,
      cost_center,
      project_code,
      source,
      source_email_id,
      source_email_subject
    } = req.body;

    if (!title || !expense_date) {
      return res.status(400).json({ error: 'Title and expense date are required' });
    }

    const [result] = await db.execute(`
      INSERT INTO ledger (
        user_id, payee_user_id, expense_category, title, description, content, content_html,
        amount, adjusted_amount, original_amount, original_currency, exchange_rate,
        subtotal, pst_amount, pst_rate, gst_amount, gst_rate, hst_amount, hst_rate,
        vat_amount, vat_rate, other_tax_amount, other_tax_description, tax_total, total_with_tax,
        vendor_name, vendor_tax_id, receipt_number, expense_date, due_date,
        status, is_draft, is_reimbursable, is_recurring, recurring_frequency,
        payment_method, gl_code, cost_center, project_code,
        source, source_email_id, source_email_subject
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user.userId,
      payee_user_id || null,
      expense_category || 'other',
      title,
      description || null,
      content || null,
      content_html || null,
      amount || null,
      adjusted_amount || null,
      original_amount || null,
      original_currency || BASE_CURRENCY,
      exchange_rate || 1.0,
      subtotal || null,
      pst_amount || null,
      pst_rate || null,
      gst_amount || null,
      gst_rate || null,
      hst_amount || null,
      hst_rate || null,
      vat_amount || null,
      vat_rate || null,
      other_tax_amount || null,
      other_tax_description || null,
      tax_total || null,
      total_with_tax || null,
      vendor_name || null,
      vendor_tax_id || null,
      receipt_number || null,
      expense_date,
      due_date || null,
      status || 'draft',
      is_draft !== undefined ? is_draft : 1,
      is_reimbursable !== undefined ? is_reimbursable : 1,
      is_recurring || 0,
      recurring_frequency || null,
      payment_method || null,
      gl_code || null,
      cost_center || null,
      project_code || null,
      source || 'manual',
      source_email_id || null,
      source_email_subject || null
    ]);

    res.status(201).json({
      id: result.insertId,
      message: 'Ledger entry created successfully'
    });
  } catch (error) {
    console.error('Create ledger entry error:', error);
    res.status(500).json({ error: 'Failed to create ledger entry' });
  }
});

// Update ledger entry
app.put('/api/ledger/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check ownership
    const [existing] = await db.execute('SELECT * FROM ledger WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }

    if (req.user.role !== 'admin' && existing[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const {
      payee_user_id,
      expense_category,
      title,
      description,
      content,
      content_html,
      amount,
      adjusted_amount,
      original_amount,
      original_currency,
      exchange_rate,
      subtotal,
      pst_amount,
      pst_rate,
      gst_amount,
      gst_rate,
      hst_amount,
      hst_rate,
      vat_amount,
      vat_rate,
      other_tax_amount,
      other_tax_description,
      tax_total,
      total_with_tax,
      vendor_name,
      vendor_tax_id,
      receipt_number,
      expense_date,
      due_date,
      paid_date,
      status,
      is_draft,
      is_reimbursable,
      is_recurring,
      recurring_frequency,
      payment_method,
      payment_reference,
      gl_code,
      cost_center,
      project_code,
      adjustment_reason
    } = req.body;

    await db.execute(`
      UPDATE ledger SET
        payee_user_id = ?, expense_category = ?, title = ?, description = ?,
        content = ?, content_html = ?, amount = ?, adjusted_amount = ?,
        original_amount = ?, original_currency = ?, exchange_rate = ?,
        subtotal = ?, pst_amount = ?, pst_rate = ?, gst_amount = ?, gst_rate = ?,
        hst_amount = ?, hst_rate = ?, vat_amount = ?, vat_rate = ?,
        other_tax_amount = ?, other_tax_description = ?, tax_total = ?, total_with_tax = ?,
        vendor_name = ?, vendor_tax_id = ?, receipt_number = ?,
        expense_date = ?, due_date = ?, paid_date = ?,
        status = ?, is_draft = ?, is_reimbursable = ?, is_recurring = ?, recurring_frequency = ?,
        payment_method = ?, payment_reference = ?, gl_code = ?, cost_center = ?, project_code = ?,
        adjustment_reason = ?, auto_saved_at = NOW()
      WHERE id = ?
    `, [
      payee_user_id || null,
      expense_category || 'other',
      title,
      description || null,
      content || null,
      content_html || null,
      amount || null,
      adjusted_amount || null,
      original_amount || null,
      original_currency || BASE_CURRENCY,
      exchange_rate || 1.0,
      subtotal || null,
      pst_amount || null,
      pst_rate || null,
      gst_amount || null,
      gst_rate || null,
      hst_amount || null,
      hst_rate || null,
      vat_amount || null,
      vat_rate || null,
      other_tax_amount || null,
      other_tax_description || null,
      tax_total || null,
      total_with_tax || null,
      vendor_name || null,
      vendor_tax_id || null,
      receipt_number || null,
      expense_date,
      due_date || null,
      paid_date || null,
      status || 'draft',
      is_draft !== undefined ? is_draft : 1,
      is_reimbursable !== undefined ? is_reimbursable : 1,
      is_recurring || 0,
      recurring_frequency || null,
      payment_method || null,
      payment_reference || null,
      gl_code || null,
      cost_center || null,
      project_code || null,
      adjustment_reason || null,
      id
    ]);

    res.json({ message: 'Ledger entry updated successfully' });
  } catch (error) {
    console.error('Update ledger entry error:', error);
    res.status(500).json({ error: 'Failed to update ledger entry' });
  }
});

// Approve/reject ledger entry (admin only)
app.post('/api/ledger/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, rejection_reason } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const [existing] = await db.execute('SELECT * FROM ledger WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }

    if (action === 'approve') {
      await db.execute(`
        UPDATE ledger SET status = 'approved', approved_by = ?, approved_at = NOW(), is_draft = 0
        WHERE id = ?
      `, [req.user.userId, id]);
    } else {
      await db.execute(`
        UPDATE ledger SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ?, is_draft = 0
        WHERE id = ?
      `, [req.user.userId, rejection_reason || 'No reason provided', id]);
    }

    res.json({ message: `Ledger entry ${action}d successfully` });
  } catch (error) {
    console.error('Approve/reject ledger entry error:', error);
    res.status(500).json({ error: 'Failed to process ledger entry' });
  }
});

// Mark ledger entry as paid (admin only)
app.post('/api/ledger/:id/pay', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_reference, payment_method, paid_date } = req.body;

    const [existing] = await db.execute('SELECT * FROM ledger WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }

    if (existing[0].status !== 'approved') {
      return res.status(400).json({ error: 'Only approved entries can be marked as paid' });
    }

    await db.execute(`
      UPDATE ledger SET
        status = 'paid',
        reimbursed_by = ?,
        reimbursed_at = NOW(),
        paid_date = ?,
        payment_reference = ?,
        payment_method = ?
      WHERE id = ?
    `, [req.user.userId, paid_date || new Date().toISOString().split('T')[0], payment_reference || null, payment_method || null, id]);

    res.json({ message: 'Ledger entry marked as paid' });
  } catch (error) {
    console.error('Mark ledger as paid error:', error);
    res.status(500).json({ error: 'Failed to mark ledger entry as paid' });
  }
});

// Delete ledger entry
app.delete('/api/ledger/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.execute('SELECT * FROM ledger WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }

    // Only owner or admin can delete, and only drafts/pending can be deleted
    if (req.user.role !== 'admin' && existing[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    if (req.user.role !== 'admin' && !['draft', 'pending', 'rejected'].includes(existing[0].status)) {
      return res.status(400).json({ error: 'Cannot delete approved or paid entries' });
    }

    await db.execute('DELETE FROM ledger WHERE id = ?', [id]);
    res.json({ message: 'Ledger entry deleted successfully' });
  } catch (error) {
    console.error('Delete ledger entry error:', error);
    res.status(500).json({ error: 'Failed to delete ledger entry' });
  }
});

// ===================== MOBILE APP + CORPORATE RADIO =====================
// Modular routers under server/routes/ — the mobile app reuses every existing
// JWT route above; these add bootstrap/push registration and the radio feed.
// `db` is assigned asynchronously in initDatabase(), so hand the routers a lazy proxy.
const dbProxy = { execute: (...a) => db.execute(...a), query: (...a) => db.query(...a) };
app.use('/api/mobile', require('./server/routes/mobile')({ db: dbProxy, authenticateToken, baseCurrency: BASE_CURRENCY }));
app.use('/api/radio', require('./server/routes/radio')({ db: dbProxy, authenticateToken, requireAdmin }));

// ===================== INSTANCE PLUGINS =====================
// Routes from $INSTANCE_DIR/plugins/*.js (docs/PLUGINS.md). The router is mounted
// here, ahead of the SPA catch-all; plugins fill it in startServer() once the
// database is up.
const pluginRouter = createPluginRouter();
app.use(pluginRouter);

// Serve React app for all other routes (with dynamic branding injection)
app.get('*', async (req, res) => {
  try {
    const indexPath = path.join(__dirname, 'client/dist/index.html');
    let html = await fs.readFile(indexPath, 'utf8');

    const pageTitle = `${SITE_NAME} - Internal Collaboration`;
    const pageDescription = `${COMPANY_NAME} internal collaboration platform`;
    const pageUrl = `${BASE_URL}${req.originalUrl}`;

    // Inject branded <title>
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${pageTitle}</title>`);

    // Inject Open Graph meta tags for link previews
    const ogTags = `
    <meta property="og:title" content="${pageTitle}" />
    <meta property="og:description" content="${pageDescription}" />
    <meta property="og:url" content="${pageUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta name="description" content="${pageDescription}" />`;

    html = html.replace('</head>', `${ogTags}\n  </head>`);

    res.send(html);
  } catch (error) {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'));
  }
});

// ===================== GITHUB SYNC SERVICE =====================

async function intelligentGitHubSync() {
  if (!process.env.GITHUB_TOKEN) {
    console.log('GitHub token not configured, skipping sync');
    return;
  }

  try {
    console.log('Starting intelligent GitHub sync across multiple repositories...');
    
    // Define repositories to sync
    // GITHUB_SYNC_REPOS="owner/repo,owner/other" (falls back to GITHUB_ORG/GITHUB_REPO)
    const repositories = (process.env.GITHUB_SYNC_REPOS ||
      (process.env.GITHUB_ORG && process.env.GITHUB_REPO ? `${process.env.GITHUB_ORG}/${process.env.GITHUB_REPO}` : ''))
      .split(',').map(s => s.trim()).filter(Boolean)
      .map(s => { const [owner, repo] = s.split('/'); return { owner, repo }; });
    
    let totalIssuesProcessed = 0;
    
    for (const { owner, repo } of repositories) {
      console.log(`Syncing issues from ${owner}/${repo}...`);
      
      try {
        // Get the highest issue number we have for this repo
        const [maxIssueResult] = await db.execute(
          'SELECT MAX(issue_number) as max_issue FROM github_issues WHERE repo_name = ?',
          [`${owner}/${repo}`]
        );
        const maxIssueNumber = maxIssueResult[0]?.max_issue || 0;
        
        // Get recently updated issues (last 24 hours) for incremental sync
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);
        
        // First: Fetch new issues (issue numbers greater than our max)
        const { data: newIssues } = await octokit.issues.listForRepo({
          owner,
          repo,
          state: 'all',
          sort: 'created',
          direction: 'desc',
          per_page: 100
        });
        
        // Filter for truly new issues
        const trulyNewIssues = newIssues.filter(issue => issue.number > maxIssueNumber);
    
        // Second: Fetch recently updated issues for incremental sync
        const { data: updatedIssues } = await octokit.issues.listForRepo({
          owner,
          repo,
          state: 'all',
          sort: 'updated',
          direction: 'desc',
          since: oneDayAgo.toISOString(),
          per_page: 100
        });
        
        // Combine and deduplicate issues for this repo
        const allIssues = [...trulyNewIssues];
        for (const issue of updatedIssues) {
          if (!allIssues.find(existing => existing.number === issue.number)) {
            allIssues.push(issue);
          }
        }
        
        console.log(`Found ${trulyNewIssues.length} new issues and ${updatedIssues.length - trulyNewIssues.length} updated issues from ${owner}/${repo}`);
        
        // Update database with issues from this repo
        for (const issue of allIssues) {
          // Convert ISO dates to MySQL format
          const createdAt = new Date(issue.created_at).toISOString().slice(0, 19).replace('T', ' ');
          const updatedAt = new Date(issue.updated_at).toISOString().slice(0, 19).replace('T', ' ');
          
          await db.execute(
            `INSERT INTO github_issues 
             (issue_number, title, state, assignee_github_username, labels, html_url, created_at, updated_at, repo_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
             title = VALUES(title),
             state = VALUES(state),
             assignee_github_username = VALUES(assignee_github_username),
             labels = VALUES(labels),
             updated_at = VALUES(updated_at),
             repo_name = VALUES(repo_name),
             synced_at = NOW()`,
            [
              issue.number,
              issue.title,
              issue.state,
              issue.assignee?.login || null,
              JSON.stringify(issue.labels),
              issue.html_url,
              createdAt,
              updatedAt,
              `${owner}/${repo}`
            ]
          );
        }
        
        totalIssuesProcessed += allIssues.length;
        
      } catch (repoError) {
        console.error(`Failed to sync ${owner}/${repo}:`, repoError.message);
        // Continue with other repos
      }
    }
    
    console.log(`GitHub sync completed successfully: ${totalIssuesProcessed} total issues processed across ${repositories.length} repositories`);
    
  } catch (error) {
    console.error('GitHub sync failed:', error.message);
  }
}

// Schedule GitHub sync every 10 minutes
let syncInterval;
function startGitHubSyncScheduler() {
  if (!process.env.GITHUB_TOKEN) {
    console.log('GitHub token not configured, sync scheduler disabled');
    return;
  }
  
  // Run initial sync after 30 seconds
  setTimeout(intelligentGitHubSync, 30000);
  
  // Then run every 10 minutes (600000 ms)
  syncInterval = setInterval(intelligentGitHubSync, 600000);
  console.log('GitHub sync scheduler started (every 10 minutes)');
}

function stopGitHubSyncScheduler() {
  if (syncInterval) {
    clearInterval(syncInterval);
    console.log('GitHub sync scheduler stopped');
  }
}

// ===================== START SERVER =====================

async function startServer() {
  await initDatabase();

  await loadPlugins({
    router: pluginRouter,
    app,
    db: dbProxy,
    auth: { authenticateToken, authenticateApiToken, requireAdmin },
    agentResponder,
    config: {
      COMPANY_NAME, COMPANY_SHORT_NAME, COMPANY_EMAIL_DOMAIN, SITE_NAME, SITE_TEAM,
      BASE_URL, BASE_CURRENCY, MAIL_SYSTEM_ADDRESS, PORT
    },
    helpers: { markdownToHtml }
  });
  
  // Start GitHub sync scheduler
  startGitHubSyncScheduler();
  
  app.listen(PORT, () => {
    console.log(`Intranet server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  stopGitHubSyncScheduler();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  stopGitHubSyncScheduler();
  process.exit(0);
});

startServer().catch(error => {
  // e.g. a plugin failing under PLUGINS_STRICT=1 — don't sit there half-started
  console.error('Startup failed:', error);
  process.exit(1);
});

module.exports = app;
