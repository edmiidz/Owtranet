#!/usr/bin/env node

/**
 * Nightly Exchange Rate Fetcher
 * Fetches daily exchange rates from ExchangeRate-API and stores them in the database
 * Run daily via cron: 0 2 * * * /var/www/owtranet/scripts/fetch-exchange-rates.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

const CURRENCIES = ['CAD', 'EUR', 'GBP', 'JPY'];

async function fetchExchangeRates() {
  let connection;

  try {
    console.log('[Exchange Rates] Starting fetch at', new Date().toISOString());

    // Connect to database
    connection = await mysql.createConnection(DB_CONFIG);

    const today = new Date().toISOString().split('T')[0];
    const results = [];

    for (const currency of CURRENCIES) {
      try {
        console.log(`[Exchange Rates] Fetching ${currency}...`);

        // Fetch from ExchangeRate-API
        const response = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
        const data = await response.json();

        if (data.result === 'success' && data.rates && data.rates.USD) {
          const rateToUSD = data.rates.USD;

          // Store in database (rate is from currency to USD)
          await connection.execute(
            `INSERT INTO exchange_rates (date, base_currency, target_currency, rate)
             VALUES (?, 'USD', ?, ?)
             ON DUPLICATE KEY UPDATE rate = ?`,
            [today, currency, rateToUSD, rateToUSD]
          );

          console.log(`[Exchange Rates] ${currency}: ${rateToUSD} (stored)`);
          results.push({ currency, rate: rateToUSD, success: true });
        } else {
          console.error(`[Exchange Rates] ${currency}: Invalid API response`, data);
          results.push({ currency, success: false, error: 'Invalid API response' });
        }
      } catch (err) {
        console.error(`[Exchange Rates] ${currency}: Failed to fetch`, err.message);
        results.push({ currency, success: false, error: err.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[Exchange Rates] Completed: ${successCount}/${CURRENCIES.length} successful`);

    process.exit(successCount > 0 ? 0 : 1);
  } catch (error) {
    console.error('[Exchange Rates] Fatal error:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

fetchExchangeRates();
