#!/usr/bin/env node
/**
 * First-run setup for the Docker image (runs before server.js on every start).
 *
 * Idempotent:
 *   1. Waits for MySQL.
 *   2. Empty database (no `users` table) → loads db/schema.sql + db/seed.sql.
 *   3. No admin yet and ADMIN_EMAIL + ADMIN_PASSWORD set → creates the admin
 *      and loads the placeholder team agreement (db/seed_team_agreement.sql).
 *
 * An existing database is never modified beyond step 3. Schema upgrades still
 * go through server/migrations/ as described in the README.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB_DIR = path.join(__dirname, '..', 'db');
const sql = (file) => fs.readFileSync(path.join(DB_DIR, file), 'utf8');

async function connect() {
  const opts = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'owtranet',
    multipleStatements: true,
  };
  for (let attempt = 1; ; attempt++) {
    try {
      return await mysql.createConnection(opts);
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`[init] waiting for database (${err.code || err.message})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

(async () => {
  const db = await connect();
  try {
    const [[{ n: hasUsers }]] = await db.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'"
    );
    if (!hasUsers) {
      console.log('[init] empty database: loading schema and seed data');
      await db.query(sql('schema.sql'));
      await db.query(sql('seed.sql'));
    }

    const [[{ n: admins }]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
    if (admins) return;

    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!email || !password) {
      console.log('[init] no admin account yet: set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart');
      return;
    }
    if (password.length < 8) {
      throw new Error('ADMIN_PASSWORD must be at least 8 characters');
    }
    const name = (process.env.ADMIN_NAME || 'Admin').trim();
    const username = email.split('@')[0];
    const hash = await bcrypt.hash(password, 10);
    await db.execute(
      "INSERT INTO users (email, password, name, role, intranet_username) VALUES (?, ?, ?, 'admin', ?)",
      [email, hash, name, username]
    );
    console.log(`[init] created admin ${email}`);

    const [[{ n: agreements }]] = await db.query(
      "SELECT COUNT(*) AS n FROM agreement_versions WHERE agreement_type = 'team'"
    );
    if (!agreements) {
      await db.query(sql('seed_team_agreement.sql'));
      console.log('[init] loaded placeholder team agreement (replace it in Admin → Agreements)');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(`[init] failed: ${err.message}`);
  process.exit(1);
});
