#!/usr/bin/env node

/**
 * Email Receipt Processor
 *
 * Monitors the RECEIPT_MAILBOX inbox (default receipts@<COMPANY_EMAIL_DOMAIN>)
 * on the local Postfix/Dovecot server for receipt emails
 * Parses receipt data using the Anthropic Claude API
 * Creates deliverables with 'pending_review' status
 */

// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const { simpleParser } = require('mailparser');
const mysql = require('mysql2/promise');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');
const nodemailer = require('nodemailer');

// Configuration
const COMPANY_NAME = process.env.COMPANY_NAME || 'Owtranet';
const COMPANY_EMAIL_DOMAIN = process.env.COMPANY_EMAIL_DOMAIN || 'example.com';
const BASE_URL = (process.env.BASE_URL || 'https://intranet.example.com').replace(/\/+$/, '');
const RECEIPT_MAILBOX = process.env.RECEIPT_MAILBOX || `receipts@${COMPANY_EMAIL_DOMAIN}`;
// Who is asked to categorize receipts from unknown senders; defaults to the
// first admin account.
const RECEIPT_ADMIN_EMAIL = process.env.RECEIPT_ADMIN_EMAIL || null;
const MAIL_BASE_DIR = process.env.MAIL_BASE_DIR || '/var/mail';
const MAILBOX_PATH = path.join(MAIL_BASE_DIR, RECEIPT_MAILBOX, 'new');
const PROCESSED_PATH = path.join(MAIL_BASE_DIR, RECEIPT_MAILBOX, 'cur');
const SYSTEM_SIGNATURE = `${COMPANY_NAME} Intranet`;
const CHECK_INTERVAL = 30000; // 30 seconds
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLASSIFIER_MODEL = 'claude-haiku-4-5';

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Initialize Anthropic
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY
});

// Create database connection pool
const db = mysql.createPool(dbConfig);

/**
 * Find user by email address
 * Checks: company_email, email (personal), other_emails
 */
async function findUserByEmail(emailAddress) {
  const cleanEmail = emailAddress.toLowerCase().trim();

  // Check company_email
  let [users] = await db.execute(
    'SELECT id, name, email, company_email, other_emails FROM users WHERE LOWER(company_email) = ? AND role IN ("user", "admin", "moderator")',
    [cleanEmail]
  );

  if (users.length > 0) {
    return users[0];
  }

  // Check personal email
  [users] = await db.execute(
    'SELECT id, name, email, company_email, other_emails FROM users WHERE LOWER(email) = ? AND role IN ("user", "admin", "moderator")',
    [cleanEmail]
  );

  if (users.length > 0) {
    return users[0];
  }

  // Check other_emails (comma-separated list)
  [users] = await db.execute(
    'SELECT id, name, email, company_email, other_emails FROM users WHERE role IN ("user", "admin", "moderator")'
  );

  for (const user of users) {
    if (user.other_emails) {
      const otherEmails = user.other_emails.split(',').map(e => e.trim().toLowerCase());
      if (otherEmails.includes(cleanEmail)) {
        return user;
      }
    }
  }

  return null;
}

/**
 * Classify email intent and parse data using Claude
 * Phase 1: Determine if email is an expense submission or a forum post
 * Phase 2: Extract appropriate fields based on classification
 */
async function classifyAndParseEmail(emailText, emailHtml, attachments) {
  const hasAttachments = attachments && attachments.length > 0;

  // Extract PDF text if available
  let pdfText = '';
  const attachmentDescriptions = [];
  if (hasAttachments) {
    for (const attachment of attachments) {
      attachmentDescriptions.push(`${attachment.filename} (${attachment.contentType})`);
      if (attachment.contentType === 'application/pdf') {
        try {
          const pdfData = await pdfParse(attachment.content);
          pdfText += `\n\nPDF Content (${attachment.filename}):\n${pdfData.text}\n`;
        } catch (error) {
          console.error('Error parsing PDF:', error);
        }
      }
    }
  }

  const prompt = `You are an email classification and data extraction assistant. Your job is to determine whether an email sent to a company intranet inbox is:
1. An EXPENSE submission (a receipt, invoice, bill, payment confirmation, or charge to be tracked in the expense ledger), OR
2. A FORUM POST (the sender is sharing information, forwarding something for discussion/reference, or making a general post)

CLASSIFICATION RULES:
- EXPENSE signals: the email IS (or forwards) a receipt, invoice, bill, payment confirmation, order confirmation with a charge, subscription renewal, or auto-recharge/top-up notification; it has a receipt/invoice attached (PDF/image); it states an actual amount that was charged, paid, or is due. This INCLUDES forwarded vendor billing emails (e.g. Twilio, Google, AWS, Anthropic, Stripe receipts) — a forwarded vendor charge/receipt/invoice IS an expense to track, regardless of who forwarded it.
- FORUM POST signals: "file this", "look into this", "for future reference", "possible replacement", "check this out", forwarded MARKETING/SALES emails, vendor PITCHES, newsletters, articles, general information sharing, price comparisons, research, product evaluations. These describe or promote something rather than confirming a charge that occurred.
- KEY RULE: If the email represents a real charge/receipt/invoice/bill (money that was spent or is owed) — classify as EXPENSE, even if it was forwarded from a vendor. Only classify as FORUM POST when the email is for discussion/reference/evaluation and does NOT confirm an actual charge.
- When in doubt between a charge-confirmation and a pitch: a confirmed/itemized amount that was charged or paid → EXPENSE; a quoted/promotional price or "starting at" pricing → FORUM POST.

Email Content:
${emailText || emailHtml || 'No content'}
${pdfText}
${attachmentDescriptions.length > 0 ? `\nAttachments: ${attachmentDescriptions.join(', ')}` : '\nNo attachments'}

Return ONLY a JSON object. The "classification" field is REQUIRED.

If classification is "expense":
{
  "classification": "expense",
  "amount": <number or null>,
  "currency": <"USD" | "CAD" | "EUR" | "GBP" | "JPY" or null>,
  "title": <brief description of expense>,
  "description": <detailed description>,
  "date": <YYYY-MM-DD format>,
  "merchant": <merchant/vendor name>,
  "payment_reference": <card last-4 or payment reference if present, e.g. "card ****2702", else null>
}

If classification is "forum_post":
{
  "classification": "forum_post",
  "suggestedTitle": <a clear, concise title for the forum post>,
  "suggestedTags": <array of 1-3 relevant lowercase tags, e.g. ["research", "tools"]>,
  "amount": null
}

For expenses:
- Look for "total", "amount due", "balance", "subtotal", "invoice total"
- Common currency indicators: $ (USD/CAD), € (EUR), £ (GBP), ¥ (JPY), C$ (CAD), US$ (USD)
- Look at both email text AND PDF content for the amount
- Extract the final total amount (after taxes, not subtotal)
- Use null only if you truly cannot find the value`;

  try {
    const response = await anthropic.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      system: 'You are an email classification and data extraction assistant. Always respond with valid JSON only.',
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    const content = response.content[0].text.trim();

    // Extract JSON from markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;

    return JSON.parse(jsonStr);
  } catch (error) {
    console.error('Error classifying email with AI:', error);
    return {
      classification: 'forum_post',
      amount: null,
      currency: null,
      title: null,
      description: null,
      date: null,
      merchant: null,
      suggestedTitle: null,
      suggestedTags: []
    };
  }
}

/**
 * Create forum post from email
 */
async function createForumPost(userId, emailSubject, emailBody, attachments = [], aiData = {}) {
  const title = aiData.suggestedTitle || emailSubject || 'Email Post';
  const content = emailBody || '';

  // Generate slug
  const timestamp = Date.now();
  const slugBase = title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  const slug = `${slugBase}-${timestamp}`;

  // Convert markdown line breaks
  const formattedContent = content.replace(/\n/g, '\n\n');

  // Create post
  const [result] = await db.execute(
    `INSERT INTO posts (user_id, title, content, slug, visibility, created_at)
     VALUES (?, ?, ?, ?, 'all_members', NOW())`,
    [userId, title, formattedContent, slug]
  );

  const postId = result.insertId;

  // Apply AI-suggested tags
  const suggestedTags = aiData.suggestedTags || [];
  if (suggestedTags.length > 0) {
    for (const tagName of suggestedTags) {
      const cleanTag = tagName.toLowerCase().trim();
      if (!cleanTag) continue;

      // Insert tag if it doesn't exist
      await db.execute(
        'INSERT IGNORE INTO tags (name) VALUES (?)',
        [cleanTag]
      );

      // Get the tag ID
      const [tagRows] = await db.execute(
        'SELECT id FROM tags WHERE name = ?',
        [cleanTag]
      );

      if (tagRows.length > 0) {
        await db.execute(
          'INSERT IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)',
          [postId, tagRows[0].id]
        );
      }
    }
  }

  // Handle image attachments
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      if (attachment.contentType?.startsWith('image/')) {
        try {
          // Save image to uploads directory
          const uploadsDir = '/var/www/owtranet/uploads/images';
          const ext = path.extname(attachment.filename || '.jpg');
          const filename = `email_post_${timestamp}_${Math.random().toString(36).substring(7)}${ext}`;
          const filePath = path.join(uploadsDir, filename);

          await fs.writeFile(filePath, attachment.content);

          console.log(`Saved image attachment: ${filename}`);
        } catch (error) {
          console.error('Error saving image attachment:', error);
        }
      }
    }
  }

  // Notify admins of new post
  const [admins] = await db.execute(
    'SELECT id FROM users WHERE role = "admin"'
  );

  for (const admin of admins) {
    await db.execute(
      `INSERT INTO notifications (user_id, type, title, message, created_at)
       VALUES (?, 'new_post', 'New Forum Post from Email', ?, NOW())`,
      [admin.id, `New post via email: "${title}"`]
    );
  }

  return postId;
}

/**
 * Determine if email is a receipt or forum post
 */
function isReceiptEmail(parsedData) {
  return parsedData.classification === 'expense';
}

/**
 * Create ledger entry from parsed receipt
 */
async function createLedgerEntry(userId, parsedData, emailSubject, emailBody, attachments = []) {
  const title = parsedData.title || emailSubject || 'Email Receipt Submission';
  const description = parsedData.description || '';
  const content = emailBody || `Receipt submitted via email to ${RECEIPT_MAILBOX}`;
  const amount = parsedData.amount || 0;
  const currency = parsedData.currency || 'USD';
  const expenseDate = parsedData.date || new Date().toISOString().split('T')[0];
  const vendor = parsedData.merchant || null;

  // Extract the card last-4 from the receipt body so the entry is searchable by
  // it (e.g. expenses charged to a specific person's card). Handles formats like
  // "**** **** **** 2702", "ending in 2702", "card ...2702", "(•••• 2702)".
  let paymentReference = parsedData.payment_reference || null;
  if (!paymentReference) {
    const body = `${emailBody || ''}`;
    const cardPatterns = [
      /(?:ending(?:\s+in)?|last\s*4|card\s*(?:number)?)\D{0,8}(\d{4})\b/i,
      /(?:[*x•·]\s*){4,}\s*(\d{4})\b/i,
      /\b(?:\d{4}[\s-]?){3}(\d{4})\b/
    ];
    for (const re of cardPatterns) {
      const m = body.match(re);
      if (m && m[1]) {
        paymentReference = `card ****${m[1]}`;
        break;
      }
    }
  }

  // Get exchange rate if not USD
  let exchangeRate = 1.0;
  if (currency !== 'USD') {
    try {
      const [rates] = await db.execute(
        'SELECT rate FROM exchange_rates WHERE target_currency = ? AND date <= ? ORDER BY date DESC LIMIT 1',
        [currency, expenseDate]
      );
      if (rates.length > 0) {
        exchangeRate = rates[0].rate;
      }
    } catch (error) {
      console.error('Error fetching exchange rate:', error);
    }
  }

  const usdAmount = amount * exchangeRate;

  // Save attachments first to get receipt paths
  let receiptAttachments = [];
  if (attachments && attachments.length > 0) {
    const uploadsDir = path.join(__dirname, 'uploads', 'ledger');
    await fs.mkdir(uploadsDir, { recursive: true });

    for (const attachment of attachments) {
      const timestamp = Date.now();
      const sanitizedName = attachment.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${timestamp}_${sanitizedName}`;
      const filePath = path.join(uploadsDir, filename);

      await fs.writeFile(filePath, attachment.content);

      receiptAttachments.push({
        filename: filename,                // unique on-disk name (timestamp_sanitized)
        originalName: attachment.filename, // name as it arrived in the email
        path: `uploads/ledger/${filename}`,
        type: attachment.contentType,
        size: attachment.size
      });
    }
  }

  // The ledger row has a single receipt slot — use the first attachment as the
  // canonical receipt (the rest still live on disk under uploads/ledger/).
  const primaryReceipt = receiptAttachments[0] || null;

  // Insert ledger entry
  const [result] = await db.execute(
    `INSERT INTO ledger
     (user_id, expense_category, title, description, content,
      amount, original_amount, original_currency, exchange_rate,
      subtotal, tax_total, total_with_tax,
      vendor_name, payment_reference, receipt_filename, receipt_original_name, receipt_mime_type, receipt_size,
      expense_date, status, source, source_email_subject, created_at)
     VALUES (?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'email', ?, NOW())`,
    [
      userId,
      title,
      description,
      content,
      usdAmount,                              // amount (in USD)
      amount,                                 // original_amount
      currency,                               // original_currency
      exchangeRate,                           // exchange_rate
      usdAmount,                              // subtotal (same as amount for email submissions)
      usdAmount,                              // total_with_tax (no tax info from email)
      vendor,                                 // vendor_name
      paymentReference,                       // payment_reference (card last-4, if found)
      primaryReceipt ? primaryReceipt.filename : null,      // receipt_filename
      primaryReceipt ? primaryReceipt.originalName : null,  // receipt_original_name
      primaryReceipt ? primaryReceipt.type : null,          // receipt_mime_type
      primaryReceipt ? primaryReceipt.size : null,          // receipt_size
      expenseDate,
      emailSubject || 'Email submission'
    ]
  );

  const ledgerId = result.insertId;

  // Create notification for user
  await db.execute(
    `INSERT INTO notifications (user_id, type, title, message, created_at)
     VALUES (?, 'ledger_created', 'Receipt Processed', ?, NOW())`,
    [userId, `Your email receipt "${title}" has been added to the Expense Ledger and is pending review.`]
  );

  // Notify admins
  const [admins] = await db.execute(
    'SELECT id FROM users WHERE role = "admin"'
  );

  for (const admin of admins) {
    await db.execute(
      `INSERT INTO notifications (user_id, type, title, message, created_at)
       VALUES (?, 'ledger_pending', 'New Expense Submission', ?, NOW())`,
      [admin.id, `New expense from email: "${title}" - Amount: ${currency} ${amount.toFixed(2)}`]
    );
  }

  return ledgerId;
}

/**
 * SMTP transport for the local mail server. The receipt mailbox authenticates
 * against Dovecot's static passdb (MAIL_SMTP_PASSWORD).
 */
function createTransport() {
  if (!process.env.MAIL_SMTP_PASSWORD) {
    throw new Error('MAIL_SMTP_PASSWORD is not set — cannot send mail from the receipt mailbox');
  }
  return nodemailer.createTransport({
    host: process.env.MAIL_SMTP_HOST || 'localhost',
    port: parseInt(process.env.MAIL_SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: RECEIPT_MAILBOX,
      pass: process.env.MAIL_SMTP_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });
}

async function getAdminEmail() {
  if (RECEIPT_ADMIN_EMAIL) return RECEIPT_ADMIN_EMAIL;
  const [rows] = await db.execute("SELECT email FROM users WHERE role = 'admin' AND account_type = 'human' ORDER BY id LIMIT 1");
  return rows[0]?.email || null;
}

/**
 * Send categorization request email to admin for unknown sender
 */
async function sendCategorizationRequest(fromEmail, originalSubject, parsedData, emailText, emailHtml) {
  try {
    const transporter = createTransport();

    const amount = parsedData.amount || 'TBD';
    const currency = parsedData.currency || 'USD';
    const title = parsedData.title || originalSubject || 'Unknown Receipt';

    const adminEmail = await getAdminEmail();
    if (!adminEmail) {
      console.warn(`No admin email configured; cannot request categorization for ${fromEmail}`);
      return;
    }

    const mailOptions = {
      from: `"${SYSTEM_SIGNATURE}" <${RECEIPT_MAILBOX}>`,
      to: adminEmail,
      subject: `Action Required: Categorize Receipt from Unknown Sender (${fromEmail})`,
      text: `Hello,

A receipt was submitted to ${RECEIPT_MAILBOX} from an unknown email address that is not in the system.

SENDER INFORMATION:
- Email Address: ${fromEmail}
- Not found in user database

RECEIPT DETAILS:
- Subject: ${originalSubject || 'No subject'}
- Detected Title: ${title}
- Amount: ${amount !== 'TBD' ? currency + ' ' + amount : 'To be determined'}

ACTION REQUIRED:
1. Add this email address to an existing user account OR
2. Create a new user account for this sender OR
3. Reject this submission

The email has been moved to processed folder but no deliverable was created.

Original email text:
${emailText ? emailText.substring(0, 500) : 'No text content'}

Thank you,
${SYSTEM_SIGNATURE}`,
      html: `<p>Hello,</p>

<p>A receipt was submitted to ${RECEIPT_MAILBOX} from an <strong>unknown email address</strong> that is not in the system.</p>

<h3>SENDER INFORMATION:</h3>
<ul>
  <li><strong>Email Address:</strong> ${fromEmail}</li>
  <li><strong>Status:</strong> Not found in user database</li>
</ul>

<h3>RECEIPT DETAILS:</h3>
<ul>
  <li><strong>Subject:</strong> ${originalSubject || 'No subject'}</li>
  <li><strong>Detected Title:</strong> ${title}</li>
  <li><strong>Amount:</strong> ${amount !== 'TBD' ? currency + ' ' + amount : 'To be determined'}</li>
</ul>

<h3>ACTION REQUIRED:</h3>
<ol>
  <li>Add this email address to an existing user account OR</li>
  <li>Create a new user account for this sender OR</li>
  <li>Reject this submission</li>
</ol>

<p>The email has been moved to processed folder but <strong>no deliverable was created</strong>.</p>

<hr>
<p><strong>Original email preview:</strong></p>
<pre>${emailText ? emailText.substring(0, 500) : 'No text content'}</pre>

<p>Thank you,<br>
${SYSTEM_SIGNATURE}</p>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`Categorization request email sent to ${adminEmail} for unknown sender: ${fromEmail}`);
  } catch (error) {
    console.error('Error sending categorization request email:', error);
  }
}

/**
 * Send email reply to user confirming receipt processing
 */
async function sendEmailReply(toEmail, originalSubject, parsedData, ledgerId, userName) {
  try {
    const transporter = createTransport();

    const amount = parsedData.amount || 'TBD';
    const currency = parsedData.currency || 'USD';
    const title = parsedData.title || originalSubject || 'Email Receipt Submission';
    // Deep-link straight to the new entry when we have its id; fall back to the
    // ledger list only if the id is somehow missing.
    const ledgerUrl = ledgerId
      ? `${BASE_URL}/ledger/${ledgerId}`
      : `${BASE_URL}/ledger`;
    const viewLinkText = ledgerId ? 'View your expense' : 'View your expenses';

    const mailOptions = {
      from: `"${SYSTEM_SIGNATURE}" <${RECEIPT_MAILBOX}>`,
      to: toEmail,
      subject: `Re: ${originalSubject || 'Receipt Submission'}`,
      text: `Hello ${userName},

Your email has been processed and added to the Expense Ledger.

Details:
- Title: ${title}
- Amount: ${amount !== 'TBD' ? currency + ' ' + amount : 'To be determined'}
- Status: Pending Review

You will receive a notification in the intranet when your submission is reviewed and approved by an admin.

${viewLinkText}: ${ledgerUrl}

Thank you,
${SYSTEM_SIGNATURE}`,
      html: `<p>Hello ${userName},</p>

<p>Your email has been processed and added to the <strong>Expense Ledger</strong>.</p>

<p><strong>Details:</strong></p>
<ul>
  <li><strong>Title:</strong> ${title}</li>
  <li><strong>Amount:</strong> ${amount !== 'TBD' ? currency + ' ' + amount : 'To be determined'}</li>
  <li><strong>Status:</strong> Pending Review</li>
</ul>

<p>You will receive a notification in the intranet when your submission is reviewed and approved by an admin.</p>

<p><a href="${ledgerUrl}">${viewLinkText}</a></p>

<p>Thank you,<br>
${SYSTEM_SIGNATURE}</p>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email reply sent to ${toEmail}`);
  } catch (error) {
    console.error('Error sending email reply:', error);
    // Don't fail the whole process if email reply fails
  }
}

/**
 * Send forum post confirmation email
 */
async function sendForumPostConfirmation(toEmail, originalSubject, postId, userName) {
  try {
    const transporter = createTransport();

    // Get post slug from database
    const [posts] = await db.execute(
      'SELECT slug FROM posts WHERE id = ?',
      [postId]
    );

    const slug = posts[0]?.slug || postId;
    const postUrl = `${BASE_URL}/forum/post/${slug}`;

    const mailOptions = {
      from: `"${SYSTEM_SIGNATURE}" <${RECEIPT_MAILBOX}>`,
      to: toEmail,
      subject: `Re: ${originalSubject || 'Forum Post'}`,
      text: `Hello ${userName},

Your email has been posted to the ${SYSTEM_SIGNATURE} discussion forum.

Title: ${originalSubject || 'Email Post'}

View your post: ${postUrl}

Thank you,
${SYSTEM_SIGNATURE}`,
      html: `<p>Hello ${userName},</p>

<p>Your email has been posted to the <strong>${SYSTEM_SIGNATURE} discussion forum</strong>.</p>

<p><strong>Title:</strong> ${originalSubject || 'Email Post'}</p>

<p><a href="${postUrl}">View your post</a></p>

<p>Thank you,<br>
${SYSTEM_SIGNATURE}</p>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Forum post confirmation sent to ${toEmail}`);
  } catch (error) {
    console.error('Error sending forum post confirmation:', error);
    // Don't fail the whole process if email reply fails
  }
}

/**
 * Process a single email file
 */
async function processEmail(filename) {
  try {
    const filePath = path.join(MAILBOX_PATH, filename);
    const fileContent = await fs.readFile(filePath);

    // Parse email
    const parsed = await simpleParser(fileContent);

    const fromAddress = parsed.from?.value?.[0]?.address;
    if (!fromAddress) {
      console.log(`[${filename}] No sender address found, skipping`);
      return;
    }

    console.log(`[${filename}] Processing email from ${fromAddress}`);

    // Classify email intent and parse data with AI (do this before user lookup so we can send categorization email)
    const parsedData = await classifyAndParseEmail(
      parsed.text,
      parsed.html,
      parsed.attachments
    );

    console.log(`[${filename}] Parsed data:`, parsedData);

    // Try to extract original sender from forwarded emails
    const emailText = parsed.text || parsed.html || '';
    let originalSender = null;

    // Look for forwarded email patterns
    const forwardPatterns = [
      /From:\s*<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i,
      /---------- Forwarded message ---------[\s\S]*?From:[\s\S]*?<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i
    ];

    for (const pattern of forwardPatterns) {
      const match = emailText.match(pattern);
      if (match && match[1] && match[1].toLowerCase() !== fromAddress.toLowerCase()) {
        originalSender = match[1];
        console.log(`[${filename}] Detected original sender from forward: ${originalSender}`);
        break;
      }
    }

    // Determine author: try original sender first, then forwarder
    let authorEmail = fromAddress;
    let author = await findUserByEmail(fromAddress);

    if (originalSender) {
      const originalAuthor = await findUserByEmail(originalSender);
      if (originalAuthor) {
        author = originalAuthor;
        authorEmail = originalSender;
        console.log(`[${filename}] Using original sender as author: ${originalSender}`);
      } else {
        console.log(`[${filename}] Original sender not in database, using forwarder: ${fromAddress}`);
      }
    }

    if (!author) {
      console.log(`[${filename}] No user found for ${fromAddress}, sending categorization request to admin`);

      // Send categorization request email to admin
      await sendCategorizationRequest(
        fromAddress,
        parsed.subject,
        parsedData,
        parsed.text,
        parsed.html
      );

      // Move to processed anyway
      await fs.rename(filePath, path.join(PROCESSED_PATH, filename));
      return;
    }

    console.log(`[${filename}] Found author: ${author.name} (ID: ${author.id})`);

    // Determine if this is a receipt or forum post
    if (isReceiptEmail(parsedData)) {
      // Create ledger entry
      const ledgerId = await createLedgerEntry(
        author.id,
        parsedData,
        parsed.subject,
        parsed.text || parsed.html,
        parsed.attachments
      );

      console.log(`[${filename}] Created ledger entry #${ledgerId} for user ${author.name}`);

      // Send email reply to user
      await sendEmailReply(authorEmail, parsed.subject, parsedData, ledgerId, author.name);
    } else {
      // Create forum post with AI-suggested title and tags
      const postId = await createForumPost(
        author.id,
        parsed.subject,
        parsed.text || parsed.html,
        parsed.attachments,
        parsedData
      );

      console.log(`[${filename}] Created forum post #${postId} for user ${author.name}`);

      // Send email confirmation to user
      await sendForumPostConfirmation(authorEmail, parsed.subject, postId, author.name);
    }

    // Move email to processed folder
    await fs.rename(filePath, path.join(PROCESSED_PATH, filename));

  } catch (error) {
    console.error(`[${filename}] Error processing email:`, error);
  }
}

/**
 * Check for new emails and process them
 */
async function checkForNewEmails() {
  try {
    const files = await fs.readdir(MAILBOX_PATH);

    if (files.length > 0) {
      console.log(`Found ${files.length} new email(s) to process`);

      for (const file of files) {
        await processEmail(file);
      }
    }
  } catch (error) {
    console.error('Error checking for new emails:', error);
  }
}

/**
 * Main loop
 */
async function main() {
  console.log(`${COMPANY_NAME} Email Receipt Processor Started`);
  console.log(`Monitoring: ${MAILBOX_PATH}`);
  console.log(`Check interval: ${CHECK_INTERVAL}ms`);

  if (!ANTHROPIC_API_KEY) {
    console.error('FATAL: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  // Test database connection
  try {
    await db.execute('SELECT 1');
    console.log('Database connection successful');
  } catch (error) {
    console.error('FATAL: Database connection failed:', error);
    process.exit(1);
  }

  // Initial check
  await checkForNewEmails();

  // Set up interval
  setInterval(checkForNewEmails, CHECK_INTERVAL);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await db.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await db.end();
  process.exit(0);
});

// Start the service
main().catch(error => {
  console.error('FATAL ERROR:', error);
  process.exit(1);
});
