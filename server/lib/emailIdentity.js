/**
 * Gmail-aware email lookup for sign-in.
 *
 * Gmail ignores dots in the local part (jane.doe@gmail.com and
 * janedoe@gmail.com are the same mailbox) and anything after a "+".
 * Members don't reliably remember which spelling their account was created
 * with, so an exact string match locks them out.
 *
 * We still STORE the address exactly as entered (we deliberately do not use
 * express-validator's normalizeEmail()) — we only compare the
 * canonical form when the exact lookup misses.
 */

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function splitEmail(email) {
  const at = String(email || '').trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return null;
  const e = String(email).trim().toLowerCase();
  return { local: e.slice(0, at), domain: e.slice(at + 1) };
}

function isGmailAddress(email) {
  const p = splitEmail(email);
  return !!p && GMAIL_DOMAINS.has(p.domain);
}

/** Canonical form: lowercase; for Gmail, drop dots and +tag, fold googlemail→gmail. */
function canonicalEmail(email) {
  const p = splitEmail(email);
  if (!p) return String(email || '').trim().toLowerCase();
  if (!GMAIL_DOMAINS.has(p.domain)) return `${p.local}@${p.domain}`;
  const local = p.local.split('+')[0].replace(/\./g, '');
  return `${local}@gmail.com`;
}

// SQL expression producing the canonical Gmail local part of `col`.
const canonicalLocalSql = (col) =>
  `REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(${col}), '@', 1), '+', 1), '.', '')`;

/**
 * Find users whose personal email (and optionally company_email) matches `email`.
 * Exact match first; if that misses and the address is Gmail, fall back to a
 * dot/+tag-insensitive match. Returns [] if the fallback is ambiguous (more than
 * one account), so we never sign someone into the wrong account.
 *
 * @param {object} db         mysql2/promise pool
 * @param {string} email      address as typed
 * @param {object} [opts]
 * @param {string} [opts.columns='*']           SELECT list
 * @param {boolean} [opts.includeCompanyEmail]  also match users.company_email exactly
 */
async function findUsersByEmail(db, email, { columns = '*', includeCompanyEmail = false } = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return [];

  const exactSql = includeCompanyEmail
    ? `SELECT ${columns} FROM users WHERE email = ? OR company_email = ?`
    : `SELECT ${columns} FROM users WHERE email = ?`;
  const [exact] = await db.execute(exactSql, includeCompanyEmail ? [e, e] : [e]);
  if (exact.length > 0 || !isGmailAddress(e)) return exact;

  const canonicalLocal = canonicalEmail(e).split('@')[0];
  const [fuzzy] = await db.execute(
    `SELECT ${columns} FROM users
      WHERE SUBSTRING_INDEX(LOWER(email), '@', -1) IN ('gmail.com', 'googlemail.com')
        AND ${canonicalLocalSql('email')} = ?`,
    [canonicalLocal]
  );
  if (fuzzy.length === 1) {
    console.log(`[EMAIL-MATCH] ${e} matched stored Gmail address ${fuzzy[0].email || '(id ' + fuzzy[0].id + ')'} ignoring dots/+tag`);
    return fuzzy;
  }
  if (fuzzy.length > 1) {
    console.warn(`[EMAIL-MATCH] ${e} is ambiguous: ${fuzzy.length} accounts share its Gmail canonical form — not matching`);
  }
  return [];
}

module.exports = { canonicalEmail, isGmailAddress, findUsersByEmail };
