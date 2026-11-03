/**
 * Scheduled webmail sends — shared between the API (server.js)
 * and the worker (server/cron/scheduledEmailSender.js).
 *
 * A scheduled_emails row is a fully-composed message. Lifecycle:
 *   scheduled → sending → sent
 *                      ↘ scheduled (retry, attempts < MAX_ATTEMPTS)
 *                      ↘ failed
 *   scheduled|failed → cancelled (user)
 *
 * All DATETIMEs are UTC wall-clock strings compared against UTC_TIMESTAMP(),
 * so neither the Node process nor the MySQL session time zone matters.
 */

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 5;
const STALE_SENDING_MINUTES = 10; // a 'sending' row older than this was orphaned by a crash
const MIN_LEAD_SECONDS = 60;      // must be at least a minute out
const MAX_LEAD_DAYS = 365;

/** JS Date → 'YYYY-MM-DD HH:MM:SS' in UTC, for DATETIME columns. */
function toMysqlUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Validate a client-supplied schedule time. Returns { date } or { error }.
 * Accepts anything Date can parse (the client sends an ISO string).
 */
function parseScheduledAt(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return { error: 'scheduled_at is required' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: 'scheduled_at is not a valid date' };
  const leadMs = date.getTime() - now.getTime();
  if (leadMs < MIN_LEAD_SECONDS * 1000) return { error: 'Scheduled time must be at least a minute in the future' };
  if (leadMs > MAX_LEAD_DAYS * 86400 * 1000) return { error: `Scheduled time must be within ${MAX_LEAD_DAYS} days` };
  return { date };
}

/** Columns returned to the client. Dates come back as ISO-8601 UTC strings. */
const SELECT_COLS = `
  id, user_id, email_account_id, to_addr, cc, bcc, subject, text_body,
  attachments, status, attempts, last_error, message_id,
  DATE_FORMAT(scheduled_at, '%Y-%m-%dT%H:%i:%sZ') AS scheduled_at,
  DATE_FORMAT(sent_at,      '%Y-%m-%dT%H:%i:%sZ') AS sent_at,
  DATE_FORMAT(created_at,   '%Y-%m-%dT%H:%i:%sZ') AS created_at`;

function normalizeRow(row) {
  if (!row) return row;
  let attachments = row.attachments;
  if (typeof attachments === 'string') {
    try { attachments = JSON.parse(attachments); } catch { attachments = []; }
  }
  return { ...row, attachments: Array.isArray(attachments) ? attachments : [] };
}

async function insertScheduledEmail(db, { userId, emailAccountId, to, cc, bcc, subject, text, html, attachments, scheduledAt }) {
  const [result] = await db.execute(
    `INSERT INTO scheduled_emails
       (user_id, email_account_id, to_addr, cc, bcc, subject, text_body, html_body, attachments, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
    [userId, emailAccountId, to, cc || null, bcc || null, subject, text || '', html || '',
     JSON.stringify(attachments || []), toMysqlUtc(scheduledAt)]
  );
  return result.insertId;
}

/** Everything the user should see on the Scheduled tab: queued, in-flight, failed, and recent sends. */
async function listForUser(db, userId) {
  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS}
       FROM scheduled_emails
      WHERE user_id = ?
        AND (status IN ('scheduled','sending','failed')
             OR (status = 'sent' AND sent_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY))
      ORDER BY FIELD(status,'sending','scheduled','failed','sent'), scheduled_at ASC`,
    [userId]
  );
  return rows.map(normalizeRow);
}

async function getForUser(db, id, userId) {
  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS} FROM scheduled_emails WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return normalizeRow(rows[0]);
}

/** Cancel a queued/failed send. Returns true if a row changed. */
async function cancelForUser(db, id, userId) {
  const [r] = await db.execute(
    `UPDATE scheduled_emails SET status = 'cancelled'
      WHERE id = ? AND user_id = ? AND status IN ('scheduled','failed')`,
    [id, userId]
  );
  return r.affectedRows === 1;
}

/** Move a queued/failed send to a new time. Returns true if a row changed. */
async function rescheduleForUser(db, id, userId, scheduledAt) {
  const [r] = await db.execute(
    `UPDATE scheduled_emails SET scheduled_at = ?, status = 'scheduled', attempts = 0, last_error = NULL
      WHERE id = ? AND user_id = ? AND status IN ('scheduled','failed')`,
    [toMysqlUtc(scheduledAt), id, userId]
  );
  return r.affectedRows === 1;
}

/**
 * Atomically take ownership of a row for sending. Returns true if we got it.
 * Also the only place attempts is incremented.
 */
async function claim(db, id, fromStatuses = ['scheduled']) {
  const placeholders = fromStatuses.map(() => '?').join(',');
  const [r] = await db.execute(
    `UPDATE scheduled_emails SET status = 'sending', attempts = attempts + 1
      WHERE id = ? AND status IN (${placeholders})`,
    [id, ...fromStatuses]
  );
  return r.affectedRows === 1;
}

/** Rows whose time has come. */
async function findDue(db, limit = 20) {
  const [rows] = await db.query(
    `SELECT id FROM scheduled_emails
      WHERE status = 'scheduled' AND scheduled_at <= UTC_TIMESTAMP()
      ORDER BY scheduled_at ASC LIMIT ${Number(limit)}`
  );
  return rows.map(r => r.id);
}

/** Return rows orphaned in 'sending' (worker died mid-send) to the queue. */
async function releaseStale(db) {
  const [r] = await db.execute(
    `UPDATE scheduled_emails SET status = 'scheduled', last_error = CONCAT_WS(' | ', last_error, 'released stale sending row')
      WHERE status = 'sending' AND updated_at < UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
    [STALE_SENDING_MINUTES]
  );
  return r.affectedRows;
}

/**
 * Send one claimed row. The caller must have claimed it (status = 'sending').
 * Marks it sent / scheduled-for-retry / failed. Never throws; returns the outcome.
 *
 * @param db           mysql2 pool or connection
 * @param emailManager instance of EmailManager from ../../emailUtils
 * @param id           scheduled_emails.id
 */
async function sendClaimed(db, emailManager, id) {
  const [rows] = await db.execute(
    `SELECT s.*, a.email_address, a.server_username, a.email_password_encrypted, a.server_status
       FROM scheduled_emails s
       JOIN server_email_accounts a ON a.id = s.email_account_id
      WHERE s.id = ? AND s.status = 'sending'`,
    [id]
  );
  const row = rows[0];
  if (!row) return { id, outcome: 'skipped', error: 'row not in sending state' };

  const fail = async (message) => {
    const willRetry = row.attempts < MAX_ATTEMPTS;
    await db.execute(
      `UPDATE scheduled_emails
          SET status = ?, last_error = ?,
              scheduled_at = IF(?, UTC_TIMESTAMP() + INTERVAL ? MINUTE, scheduled_at)
        WHERE id = ?`,
      [willRetry ? 'scheduled' : 'failed', String(message).slice(0, 2000), willRetry ? 1 : 0, RETRY_DELAY_MINUTES, id]
    );
    return { id, outcome: willRetry ? 'retry' : 'failed', error: message, attempts: row.attempts };
  };

  if (row.server_status !== 'active' || !row.email_password_encrypted) {
    // Not transient — don't burn retries on it.
    await db.execute(`UPDATE scheduled_emails SET status = 'failed', last_error = ? WHERE id = ?`,
      ['Email account is not active or not configured', id]);
    return { id, outcome: 'failed', error: 'account inactive' };
  }

  const attachments = normalizeRow(row).attachments.map(a => ({
    filename: a.filename || 'attachment',
    path: a.path,
    contentType: a.contentType || 'application/octet-stream'
  }));

  try {
    // Same shape the immediate-send route hands to sendEmail (a server_email_accounts row).
    const emailConfig = {
      id: row.email_account_id,
      email_address: row.email_address,
      server_username: row.server_username,
      email_password_encrypted: row.email_password_encrypted
    };
    const result = await emailManager.sendEmail(emailConfig, {
      to: row.to_addr,
      cc: row.cc || undefined,
      bcc: row.bcc || undefined,
      subject: row.subject,
      text: row.text_body || '',
      html: row.html_body || undefined,
      attachments
    });
    await db.execute(
      `UPDATE scheduled_emails SET status = 'sent', sent_at = UTC_TIMESTAMP(), message_id = ?, last_error = NULL WHERE id = ?`,
      [result.messageId ? String(result.messageId).slice(0, 255) : null, id]
    );
    return { id, outcome: 'sent', messageId: result.messageId, rejected: result.rejected };
  } catch (err) {
    return fail(err && err.message ? err.message : String(err));
  }
}

module.exports = {
  MAX_ATTEMPTS,
  RETRY_DELAY_MINUTES,
  MIN_LEAD_SECONDS,
  toMysqlUtc,
  parseScheduledAt,
  insertScheduledEmail,
  listForUser,
  getForUser,
  cancelForUser,
  rescheduleForUser,
  claim,
  findDue,
  releaseStale,
  sendClaimed
};
