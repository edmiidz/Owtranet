#!/usr/bin/env node
/**
 * Create (or promote) an admin account on a fresh instance.
 *
 *   node scripts/create-admin.js --email you@example.com --name "Your Name" [--username you]
 *
 * Use the admin's PERSONAL address, like every other member. The company address
 * (users.company_email) comes later through Email Request → approval.
 *
 * Prompts for the password (or reads ADMIN_PASSWORD). Uses DB_* from .env.
 * If the email already exists, the account is promoted to admin and its
 * password reset.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const readline = require('readline');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const email = (arg('email') || '').trim().toLowerCase();
  const name = (arg('name') || '').trim();
  const username = (arg('username') || email.split('@')[0] || '').trim();
  if (!email || !name) {
    console.error('Usage: node scripts/create-admin.js --email you@example.com --name "Your Name" [--username you]');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || await askHidden('Password: ');
  if (!password || password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  try {
    const hash = await bcrypt.hash(password, 10);
    const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      await db.execute("UPDATE users SET role = 'admin', password = ? WHERE id = ?", [hash, existing[0].id]);
      console.log(`Promoted existing user #${existing[0].id} (${email}) to admin.`);
    } else {
      const [r] = await db.execute(
        "INSERT INTO users (email, password, name, role, intranet_username) VALUES (?, ?, ?, 'admin', ?)",
        [email, hash, name, username || null]
      );
      console.log(`Created admin user #${r.insertId} (${email}).`);
    }
  } finally {
    await db.end();
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
