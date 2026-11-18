/**
 * Base-currency-aware exchange-rate lookup.
 *
 * The `exchange_rates` table is USD-anchored: the nightly fetcher stores rows
 * (base_currency = 'USD', target_currency = X, rate = USD per 1 X). Instances
 * whose BASE_CURRENCY is not USD (e.g. CAD) need X → BASE, which is the cross rate usdPer(X) / usdPer(BASE).
 *
 * Every consumer (/api/exchange-rates, the ledger API, the email receipt
 * processor) must go through this so the rate direction can never drift.
 */

/**
 * USD per 1 unit of `currency` on or before `date` (falls back to the
 * earliest stored rate when nothing is that old).
 * @returns {Promise<{rate: number, date: string|Date, fallback?: boolean, earliest?: boolean}|null>}
 */
async function usdPer(db, currency, date) {
  if (currency === 'USD') return { rate: 1.0, date };

  const [closest] = await db.execute(
    `SELECT rate, date FROM exchange_rates
     WHERE date <= ? AND base_currency = 'USD' AND target_currency = ?
     ORDER BY date DESC LIMIT 1`,
    [date, currency]
  );
  if (closest.length > 0) {
    const row = closest[0];
    const sameDay = new Date(row.date).toISOString().split('T')[0] === String(date).split('T')[0];
    return sameDay
      ? { rate: parseFloat(row.rate), date }
      : { rate: parseFloat(row.rate), date: row.date, fallback: true };
  }

  const [earliest] = await db.execute(
    `SELECT rate, date FROM exchange_rates
     WHERE base_currency = 'USD' AND target_currency = ?
     ORDER BY date ASC LIMIT 1`,
    [currency]
  );
  if (earliest.length > 0) {
    return { rate: parseFloat(earliest[0].rate), date: earliest[0].date, fallback: true, earliest: true };
  }
  return null;
}

/**
 * Multiplier that turns an amount in `currency` into `baseCurrency` on `date`.
 * Returns { rate: 1.0, default: true } when either side has no stored rate.
 */
async function getRateToBase(db, currency, date, baseCurrency) {
  const from = String(currency || baseCurrency).toUpperCase();
  const base = String(baseCurrency).toUpperCase();
  if (from === base) return { rate: 1.0, date };

  const fromUsd = await usdPer(db, from, date);
  const baseUsd = await usdPer(db, base, date);
  if (!fromUsd || !baseUsd || !baseUsd.rate) return { rate: 1.0, date, default: true };

  const result = { rate: fromUsd.rate / baseUsd.rate, date: fromUsd.fallback ? fromUsd.date : baseUsd.date };
  if (fromUsd.fallback || baseUsd.fallback) result.fallback = true;
  if (fromUsd.earliest || baseUsd.earliest) result.earliest = true;
  return result;
}

module.exports = { getRateToBase, usdPer };
