#!/usr/bin/env node
/**
 * Check an instance database against db/schema.sql before running new code on it.
 *
 * Reads DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME from the environment
 * or the app's .env, lists every table/column the code expects that the database
 * lacks, and names the server/migrations/ file that adds each one.
 *
 * Exit codes: 0 = schema up to date, 1 = something missing, 2 = could not connect.
 *
 * Usage (from the app directory):
 *   node scripts/check-schema.js
 *   npm run check-schema
 * deploy.sh runs this on the server before restarting the app.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { findMissing, formatReport } = require('../server/lib/schemaCheck');

(async () => {
  let db;
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'intranet_user',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'owtranet'
    });
  } catch (err) {
    console.error(`❌ Could not connect to the database: ${err.message}`);
    process.exit(2);
  }
  try {
    const missing = await findMissing(db);
    const dbName = process.env.DB_NAME || 'owtranet';
    const report = formatReport(missing, {
      applyHint: `mysql -h ${process.env.DB_HOST || '127.0.0.1'} -u ${process.env.DB_USER || 'intranet_user'} -p ${dbName} < FILE`
    });
    if (!report) {
      console.log(`✅ Database ${dbName} has every table and column in db/schema.sql`);
      process.exit(0);
    }
    console.error(`❌ ${report}`);
    console.error('\nThen re-run: node scripts/check-schema.js');
    process.exit(1);
  } finally {
    await db.end().catch(() => {});
  }
})();
