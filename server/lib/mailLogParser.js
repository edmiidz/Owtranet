/**
 * Postfix mail log → authenticated sends.
 *
 * A message submitted with SMTP AUTH leaves two lines that share a queue id:
 *
 *   Nov  3 10:15:01 mail postfix/submission/smtpd[1234]: 4A1B2C3D4E: client=…, sasl_method=PLAIN, sasl_username=kit@example.com
 *   Nov  3 10:15:01 mail postfix/qmgr[987]: 4A1B2C3D4E: from=<kit@example.com>, size=2345, nrcpt=2 (queue active)
 *
 * The smtpd line says who logged in; the qmgr line says the message was
 * queued and how many recipients it has. Only messages with BOTH become a
 * send: unauthenticated inbound mail has no sasl_username, and a submission
 * that was rejected never reaches qmgr. Bounces (from=<>) are not sends.
 * A deferred message is re-activated by qmgr with the same queue id; only the
 * first qmgr line counts.
 *
 * Handles traditional syslog timestamps ("Nov  3 10:15:01", local time, no
 * year) and RFC 3339 ones ("2026-11-03T10:15:01.123456+00:00").
 *
 * Usage: const p = createMailLogParser(); lines.forEach(l => p.push(l)); p.sends()
 * Feed files oldest first so a message split across a rotation still pairs up.
 */

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const TRADITIONAL_TS = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s/;
const ISO_TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\s/;
// "postfix/submission/smtpd[1234]: QUEUEID: ..." (any postfix service prefix)
const PROGRAM_QID = /\spostfix(?:\/[\w.-]+)*\/(smtpd|qmgr)\[\d+\]:\s+([0-9A-Za-z]{6,20}):\s+(.*)$/;
const SASL_USER = /\bsasl_username=([^,\s]+)/;
const QMGR_FROM = /^from=<([^>]*)>,.*?\bnrcpt=(\d+)/;

/**
 * Parse a log line's timestamp to a Date. Traditional syslog stamps have no
 * year: use `now`'s year, or the previous one when that would be in the future
 * (a January run reading December lines).
 */
function parseTimestamp(line, now = new Date()) {
  const iso = line.match(ISO_TS);
  if (iso) {
    const d = new Date(iso[1]);
    return isNaN(d) ? null : d;
  }
  const t = line.match(TRADITIONAL_TS);
  if (!t || !(t[1] in MONTHS)) return null;
  const [, mon, day, hh, mm, ss] = t;
  let d = new Date(now.getFullYear(), MONTHS[mon], Number(day), Number(hh), Number(mm), Number(ss));
  if (d.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
    d = new Date(now.getFullYear() - 1, MONTHS[mon], Number(day), Number(hh), Number(mm), Number(ss));
  }
  return d;
}

function createMailLogParser({ now = new Date() } = {}) {
  const auth = new Map();   // queue id → { sender, at }
  const queued = new Map(); // queue id → { from, nrcpt, at } (first qmgr line only)
  const order = [];         // queue ids in the order their auth line appeared

  return {
    push(line) {
      const m = line.match(PROGRAM_QID);
      if (!m) return;
      const [, program, qid, rest] = m;
      if (program === 'smtpd') {
        const user = rest.match(SASL_USER);
        if (!user || auth.has(qid)) return;
        const at = parseTimestamp(line, now);
        if (!at) return;
        auth.set(qid, { sender: user[1].toLowerCase(), at });
        order.push(qid);
      } else {
        const from = rest.match(QMGR_FROM);
        if (!from || queued.has(qid)) return;
        queued.set(qid, { from: from[1].toLowerCase(), nrcpt: Number(from[2]) });
      }
    },

    /** [{ queueId, sender, sentAt, recipientCount }] in log order. */
    sends() {
      const out = [];
      for (const qid of order) {
        const a = auth.get(qid);
        const q = queued.get(qid);
        if (!q || !q.from) continue; // rejected before queueing, or a bounce
        out.push({ queueId: qid, sender: a.sender, sentAt: a.at, recipientCount: q.nrcpt });
      }
      return out;
    },
  };
}

module.exports = { createMailLogParser, parseTimestamp };
