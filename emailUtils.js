const crypto = require('crypto');
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const quotedPrintable = require('quoted-printable');
const utf8 = require('utf8');
const mysql = require('mysql2/promise');

// Email encryption/decryption utilities
class EmailCrypto {
  constructor() {
    this.algorithm = 'aes-256-cbc';
    this.secretKey = process.env.EMAIL_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!this.secretKey) throw new Error('EMAIL_ENCRYPTION_KEY or JWT_SECRET must be set to encrypt webmail passwords');
    this.key = crypto.scryptSync(this.secretKey, 'salt', 32);
  }

  encryptPassword(password) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decryptPassword(encryptedPassword) {
    try {
      const textParts = encryptedPassword.split(':');
      const iv = Buffer.from(textParts.shift(), 'hex');
      const encryptedText = textParts.join(':');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      console.error('Failed to decrypt email password:', error);
      throw new Error('Password decryption failed');
    }
  }
}

// Password for the local Dovecot/Postfix mailboxes (static passdb).
function requireMailPassword() {
  const pw = process.env.MAIL_SMTP_PASSWORD;
  if (!pw) throw new Error('MAIL_SMTP_PASSWORD is not set — local webmail (IMAP/SMTP) is unavailable');
  return pw;
}

// IMAP Email Manager
class EmailManager {
  constructor() {
    this.crypto = new EmailCrypto();
  }

  createImapConnection(emailConfig) {
    // Local mailboxes authenticate against Dovecot's static passdb, whose
    // password is MAIL_SMTP_PASSWORD. (Per-user encrypted passwords in
    // server_email_accounts are not used for IMAP yet.)
    return new Imap({
      host: 'localhost', // Local mail server
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }, // For self-signed certs
      user: emailConfig.server_username,
      password: requireMailPassword(), // Dovecot static passdb password
      keepalive: false
    });
  }

  async connectToMailbox(emailConfig, mailbox = 'INBOX') {
    return new Promise((resolve, reject) => {
      const imap = this.createImapConnection(emailConfig);
      
      imap.once('ready', () => {
        imap.openBox(mailbox, false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }
          resolve({ imap, box });
        });
      });

      imap.once('error', (err) => {
        reject(err);
      });

      imap.connect();
    });
  }

  async fetchEmails(emailConfig, options = {}) {
    const { limit = 50, mailbox = 'INBOX', search = ['ALL'], headersOnly = true } = options;

    try {
      const { imap, box } = await this.connectToMailbox(emailConfig, mailbox);

      return new Promise((resolve, reject) => {
        imap.search(search, (err, results) => {
          if (err) {
            reject(err);
            return;
          }

          if (!results || results.length === 0) {
            imap.end();
            resolve([]);
            return;
          }

          // Get most recent emails first
          const emailUIDs = results.slice(-limit);

          // For list view, only fetch headers (much faster for large attachments)
          // For single email view, fetch full body
          const fetchOptions = headersOnly
            ? { bodies: 'HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', struct: true }
            : { bodies: '', struct: true };

          const fetch = imap.fetch(emailUIDs, fetchOptions);
          const emails = [];
          let processedCount = 0;
          const totalMessages = emailUIDs.length;

          fetch.on('message', (msg, seqno) => {
            let buffer = '';

            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });

            msg.once('attributes', (attrs) => {
              msg.buffer = buffer;
              msg.attributes = attrs;
            });

            msg.once('end', async () => {
              try {
                if (headersOnly) {
                  // Parse headers only - much faster
                  const headers = this.parseHeaders(msg.buffer);

                  // Estimate if there are attachments from struct
                  const hasAttachments = msg.attributes.struct &&
                    JSON.stringify(msg.attributes.struct).includes('"disposition"');

                  emails.push({
                    uid: msg.attributes.uid,
                    flags: msg.attributes.flags,
                    date: msg.attributes.date || headers.date,
                    subject: headers.subject || '(No Subject)',
                    from: headers.from || 'Unknown',
                    to: headers.to || '',
                    cc: headers.cc || '',
                    bcc: headers.bcc || '',
                    text: '', // Not fetched in headers-only mode
                    html: '', // Not fetched in headers-only mode
                    attachments: hasAttachments ? [{ placeholder: true }] : [], // Indicate attachments exist
                    messageId: headers['message-id'],
                    inReplyTo: headers['in-reply-to'],
                    references: headers.references
                  });
                } else {
                  // Full body parsing (original behavior)
                  const parsed = await simpleParser(msg.buffer);

                  // Manual CC/BCC extraction from headers when simpleParser fails
                  let ccText = '';
                  let bccText = '';

                  if (parsed.headers) {
                    const ccHeader = parsed.headers.get('cc') || parsed.headers.get('CC');
                    const bccHeader = parsed.headers.get('bcc') || parsed.headers.get('BCC');
                    ccText = ccHeader || '';
                    bccText = bccHeader || '';
                  }

                  if (!ccText && parsed.cc) {
                    ccText = parsed.cc.text || '';
                  }
                  if (!bccText && parsed.bcc) {
                    bccText = parsed.bcc.text || '';
                  }

                  // Helper function to decode quoted-printable and other encodings
                  const decodeEmailContent = (content) => {
                    if (!content || typeof content !== 'string') return content;

                    try {
                      if (content.includes('=') && /=[0-9A-F]{2}/i.test(content)) {
                        const decoded = quotedPrintable.decode(content);
                        return utf8.decode(decoded);
                      }
                      return content;
                    } catch (error) {
                      return content;
                    }
                  };

                  // Helper function to convert Slack emoji text codes to actual emojis
                  const convertSlackEmojis = (content) => {
                    if (!content || typeof content !== 'string') return content;
                    if (!content.includes(':')) return content;

                    const slackEmojiMap = {
                      ':sparkles:': '✨',
                      ':star:': '⭐',
                      ':smile:': '😊',
                      ':heart:': '❤️',
                      ':thumbsup:': '👍',
                      ':fire:': '🔥',
                      ':rocket:': '🚀',
                      ':eyes:': '👀',
                      ':tada:': '🎉',
                      ':thinking_face:': '🤔'
                    };

                    let converted = content;
                    for (const [slackCode, emoji] of Object.entries(slackEmojiMap)) {
                      converted = converted.replace(new RegExp(slackCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), emoji);
                    }
                    return converted;
                  };

                  // Ensure text and html are strings
                  let emailText = '';
                  let emailHtml = '';

                  if (parsed.text) {
                    if (typeof parsed.text === 'string') {
                      emailText = parsed.text;
                    } else if (parsed.text && typeof parsed.text === 'object' && parsed.text.value) {
                      emailText = parsed.text.value;
                    } else if (parsed.text && typeof parsed.text === 'object' && parsed.text.text) {
                      emailText = parsed.text.text;
                    } else {
                      emailText = String(parsed.text);
                    }
                    emailText = decodeEmailContent(emailText);
                    emailText = convertSlackEmojis(emailText);
                  }

                  if (parsed.html) {
                    if (typeof parsed.html === 'string') {
                      emailHtml = parsed.html;
                    } else if (parsed.html && typeof parsed.html === 'object' && parsed.html.value) {
                      emailHtml = parsed.html.value;
                    } else if (parsed.html && typeof parsed.html === 'object' && parsed.html.html) {
                      emailHtml = parsed.html.html;
                    } else {
                      emailHtml = String(parsed.html);
                    }
                    emailHtml = decodeEmailContent(emailHtml);
                    emailHtml = convertSlackEmojis(emailHtml);
                  }

                  emails.push({
                    uid: msg.attributes.uid,
                    flags: msg.attributes.flags,
                    date: msg.attributes.date,
                    subject: parsed.subject || '(No Subject)',
                    from: parsed.from ? parsed.from.text : 'Unknown',
                    to: parsed.to ? parsed.to.text : '',
                    cc: ccText,
                    bcc: bccText,
                    text: emailText,
                    html: emailHtml,
                    attachments: parsed.attachments || [],
                    messageId: parsed.messageId,
                    inReplyTo: parsed.inReplyTo,
                    references: parsed.references
                  });
                }
              } catch (parseError) {
                console.error('Error parsing email:', parseError);
              }

              processedCount++;

              // Check if all messages are processed
              if (processedCount === totalMessages) {
                imap.end();
                // Sort by date, most recent first
                emails.sort((a, b) => new Date(b.date) - new Date(a.date));
                resolve(emails);
              }
            });
          });

          fetch.once('error', (err) => {
            reject(err);
          });

          fetch.once('end', () => {
            // Don't resolve here - wait for all messages to be processed
          });
        });
      });
    } catch (error) {
      console.error('Error fetching emails:', error);
      throw error;
    }
  }

  // Parse email headers from raw header string
  parseHeaders(headerString) {
    const headers = {};
    const lines = headerString.split(/\r?\n/);
    let currentKey = '';
    let currentValue = '';

    for (const line of lines) {
      if (line.match(/^\s+/) && currentKey) {
        // Continuation of previous header
        currentValue += ' ' + line.trim();
      } else {
        // Save previous header if exists
        if (currentKey) {
          headers[currentKey.toLowerCase()] = currentValue;
        }
        // Parse new header
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
          currentKey = match[1];
          currentValue = match[2];
        }
      }
    }
    // Save last header
    if (currentKey) {
      headers[currentKey.toLowerCase()] = currentValue;
    }

    return headers;
  }

  // Fetch a single email by UID with full body content
  async fetchEmailByUid(emailConfig, uid, mailbox = 'INBOX') {
    try {
      const { imap, box } = await this.connectToMailbox(emailConfig, mailbox);

      return new Promise((resolve, reject) => {
        const fetch = imap.fetch(parseInt(uid), { bodies: '', struct: true });

        fetch.on('message', (msg) => {
          let buffer = '';
          let attributes = null;

          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });
          });

          msg.once('attributes', (attrs) => {
            attributes = attrs;
          });

          msg.once('end', async () => {
            try {
              const parsed = await simpleParser(buffer);

              // Extract CC/BCC
              let ccText = '';
              let bccText = '';
              if (parsed.headers) {
                const ccHeader = parsed.headers.get('cc') || parsed.headers.get('CC');
                const bccHeader = parsed.headers.get('bcc') || parsed.headers.get('BCC');
                ccText = ccHeader || '';
                bccText = bccHeader || '';
              }
              if (!ccText && parsed.cc) ccText = parsed.cc.text || '';
              if (!bccText && parsed.bcc) bccText = parsed.bcc.text || '';

              // Decode content helpers
              const decodeEmailContent = (content) => {
                if (!content || typeof content !== 'string') return content;
                try {
                  if (content.includes('=') && /=[0-9A-F]{2}/i.test(content)) {
                    const decoded = quotedPrintable.decode(content);
                    return utf8.decode(decoded);
                  }
                  return content;
                } catch (error) {
                  return content;
                }
              };

              const convertSlackEmojis = (content) => {
                if (!content || typeof content !== 'string') return content;
                if (!content.includes(':')) return content;
                const slackEmojiMap = {
                  ':sparkles:': '✨', ':star:': '⭐', ':smile:': '😊',
                  ':heart:': '❤️', ':thumbsup:': '👍', ':fire:': '🔥',
                  ':rocket:': '🚀', ':eyes:': '👀', ':tada:': '🎉', ':thinking_face:': '🤔'
                };
                let converted = content;
                for (const [slackCode, emoji] of Object.entries(slackEmojiMap)) {
                  converted = converted.replace(new RegExp(slackCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), emoji);
                }
                return converted;
              };

              // Process text and html
              let emailText = '';
              let emailHtml = '';

              if (parsed.text) {
                emailText = typeof parsed.text === 'string' ? parsed.text :
                  (parsed.text.value || parsed.text.text || String(parsed.text));
                emailText = convertSlackEmojis(decodeEmailContent(emailText));
              }

              if (parsed.html) {
                emailHtml = typeof parsed.html === 'string' ? parsed.html :
                  (parsed.html.value || parsed.html.html || String(parsed.html));
                emailHtml = convertSlackEmojis(decodeEmailContent(emailHtml));
              }

              const email = {
                uid: attributes.uid,
                flags: attributes.flags,
                date: attributes.date,
                subject: parsed.subject || '(No Subject)',
                from: parsed.from ? parsed.from.text : 'Unknown',
                to: parsed.to ? parsed.to.text : '',
                cc: ccText,
                bcc: bccText,
                text: emailText,
                html: emailHtml,
                attachments: parsed.attachments || [],
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.references
              };

              imap.end();
              resolve(email);
            } catch (parseError) {
              console.error('Error parsing email:', parseError);
              imap.end();
              reject(parseError);
            }
          });
        });

        fetch.once('error', (err) => {
          imap.end();
          reject(err);
        });

        fetch.once('end', () => {
          // Stream ended
        });
      });
    } catch (error) {
      console.error('Error fetching email by UID:', error);
      throw error;
    }
  }

  async getMailboxes(emailConfig) {
    try {
      const { imap } = await this.connectToMailbox(emailConfig);

      return new Promise((resolve, reject) => {
        imap.getBoxes((err, boxes) => {
          imap.end();
          if (err) {
            reject(err);
            return;
          }
          resolve(this.parseMailboxes(boxes));
        });
      });
    } catch (error) {
      console.error('Error getting mailboxes:', error);
      throw error;
    }
  }

  parseMailboxes(boxes, path = '') {
    const result = [];
    for (const [name, box] of Object.entries(boxes)) {
      const fullPath = path ? `${path}${box.delimiter}${name}` : name;
      result.push({
        name,
        path: fullPath,
        flags: box.attribs || [],
        children: box.children ? this.parseMailboxes(box.children, fullPath) : []
      });
    }
    return result;
  }

  async markAsRead(emailConfig, uid, mailbox = 'INBOX') {
    try {
      const { imap } = await this.connectToMailbox(emailConfig, mailbox);
      
      return new Promise((resolve, reject) => {
        imap.addFlags(uid, ['\\Seen'], (err) => {
          imap.end();
          if (err) {
            reject(err);
            return;
          }
          resolve(true);
        });
      });
    } catch (error) {
      console.error('Error marking email as read:', error);
      throw error;
    }
  }

  async deleteEmail(emailConfig, uid, mailbox = 'INBOX') {
    try {
      const { imap } = await this.connectToMailbox(emailConfig, mailbox);
      
      return new Promise((resolve, reject) => {
        imap.addFlags(uid, ['\\Deleted'], (err) => {
          if (err) {
            imap.end();
            reject(err);
            return;
          }
          
          imap.expunge((expungeErr) => {
            imap.end();
            if (expungeErr) {
              reject(expungeErr);
              return;
            }
            resolve(true);
          });
        });
      });
    } catch (error) {
      console.error('Error deleting email:', error);
      throw error;
    }
  }

  createSmtpConnection(emailConfig) {
    // Same Dovecot static passdb password as IMAP (see createImapConnection).
    return nodemailer.createTransport({
      host: 'localhost',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: emailConfig.server_username,
        pass: requireMailPassword() // Dovecot static passdb password
      },
      tls: {
        rejectUnauthorized: false // For self-signed certs
      }
    });
  }

  async sendEmail(emailConfig, emailData) {
    const { to, cc, bcc, subject, text, html, attachments } = emailData;

    console.log('=== EMAIL MANAGER SENDING EMAIL ===');
    console.log('emailData received:', emailData);
    console.log('to:', to);
    console.log('cc:', cc);
    console.log('bcc:', bcc);

    try {
      const transporter = this.createSmtpConnection(emailConfig);

      const mailOptions = {
        from: `"${emailConfig.display_name || emailConfig.email_address}" <${emailConfig.email_address}>`,
        to,
        cc,
        bcc,
        subject,
        text,
        html,
        attachments
      };

      console.log('mailOptions being sent to SMTP:', mailOptions);

      const result = await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully: ${result.messageId}`);
      console.log('SMTP result:', result);

      // Save sent email to Sent folder
      try {
        await this.saveSentEmail(emailConfig, mailOptions, result.messageId);
      } catch (saveError) {
        console.error('Failed to save sent email:', saveError);
        // Don't fail the send if saving to Sent folder fails
      }

      // Log to sent_emails table for work tracking
      try {
        await this.logSentEmail(emailConfig, mailOptions);
      } catch (logError) {
        console.error('Failed to log sent email to database:', logError);
        // Don't fail the send if logging fails
      }

      return {
        success: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected
      };
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }

  async logSentEmail(emailConfig, mailOptions) {
    let connection;
    try {
      connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'owtranet'
      });

      // Combine all recipients (to, cc, bcc)
      const recipients = [
        mailOptions.to,
        mailOptions.cc,
        mailOptions.bcc
      ].filter(Boolean).join(',');

      await connection.execute(
        `INSERT INTO sent_emails (sender, recipients, subject, body, sent_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [
          emailConfig.email_address,
          recipients,
          mailOptions.subject || '(No Subject)',
          mailOptions.text || mailOptions.html || ''
        ]
      );

      console.log('Sent email logged to database for work tracking');
    } catch (error) {
      console.error('Error logging sent email:', error);
      throw error;
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  async saveSentEmail(emailConfig, mailOptions, messageId) {
    try {
      const { imap } = await this.connectToMailbox(emailConfig, 'Sent');
      
      // Create the email message in RFC 2822 format (including attachments)
      const emailMessage = await this.createRFC2822Message(mailOptions, messageId);
      
      return new Promise((resolve, reject) => {
        imap.append(emailMessage, { mailbox: 'Sent' }, (err) => {
          imap.end();
          if (err) {
            // Don't reject for connection limit errors - email was still sent
            if (err.message && err.message.includes('mail_max_userip_connections')) {
              console.warn('Could not save to Sent folder (connection limit), but email was sent successfully');
              resolve(true);
              return;
            }
            // Don't reject for missing Sent folder - email was still sent
            if (err.message && err.message.includes("Mailbox doesn't exist: Sent")) {
              console.warn('Sent folder does not exist, but email was sent successfully');
              resolve(true);
              return;
            }
            reject(err);
            return;
          }
          console.log('Email saved to Sent folder');
          resolve(true);
        });
      });
    } catch (error) {
      // Don't fail the entire send operation if we can't save to Sent folder
      if (error.message && (error.message.includes('mail_max_userip_connections') || 
                           error.message.includes("Mailbox doesn't exist: Sent"))) {
        console.warn('Could not save to Sent folder, but email was sent successfully');
        return true;
      }
      console.error('Error saving sent email:', error);
      throw error;
    }
  }

  // Build the Sent-folder copy with the same composer nodemailer uses for SMTP,
  // so attachments, text/html alternatives and header encoding all match what was sent.
  createRFC2822Message(mailOptions, messageId) {
    const mail = new MailComposer({
      ...mailOptions,
      messageId,
      date: new Date()
    }).compile();
    mail.keepBcc = true; // Keep Bcc recipients visible in the sender's own copy

    return new Promise((resolve, reject) => {
      mail.build((err, message) => (err ? reject(err) : resolve(message)));
    });
  }

  async moveEmail(emailConfig, uid, targetMailbox, sourceMailbox = 'INBOX') {
    try {
      const { imap: sourceImap } = await this.connectToMailbox(emailConfig, sourceMailbox);
      
      return new Promise((resolve, reject) => {
        sourceImap.move(uid, targetMailbox, (err) => {
          sourceImap.end();
          if (err) {
            reject(err);
            return;
          }
          resolve(true);
        });
      });
    } catch (error) {
      console.error('Error moving email:', error);
      throw error;
    }
  }

  async getAttachment(emailConfig, uid, attachmentIndex, mailbox = 'INBOX') {
    try {
      const { imap, box } = await this.connectToMailbox(emailConfig, mailbox);

      return new Promise((resolve, reject) => {
        const fetch = imap.fetch([uid], { bodies: '', struct: true });

        fetch.on('message', (msg, seqno) => {
          let buffer = '';

          msg.on('body', (stream, info) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });
          });

          msg.once('end', async () => {
            try {
              const parsed = await simpleParser(buffer);

              if (!parsed.attachments || parsed.attachments.length === 0) {
                imap.end();
                reject(new Error('No attachments found in this email'));
                return;
              }

              if (attachmentIndex < 0 || attachmentIndex >= parsed.attachments.length) {
                imap.end();
                reject(new Error(`Attachment index ${attachmentIndex} out of range`));
                return;
              }

              const attachment = parsed.attachments[attachmentIndex];
              imap.end();

              resolve({
                filename: attachment.filename || `attachment_${attachmentIndex}`,
                contentType: attachment.contentType || 'application/octet-stream',
                size: attachment.size,
                content: attachment.content // This is a Buffer
              });
            } catch (parseError) {
              imap.end();
              reject(parseError);
            }
          });
        });

        fetch.once('error', (err) => {
          imap.end();
          reject(err);
        });
      });
    } catch (error) {
      console.error('Error fetching attachment:', error);
      throw error;
    }
  }
}

module.exports = {
  EmailCrypto,
  EmailManager
};