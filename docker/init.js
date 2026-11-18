#!/usr/bin/env node
/**
 * First-run setup for the Docker image (runs before server.js on every start).
 *
 * Serialize startup per database. First-run DDL can be replayed after an
 * interruption. Base seed data, the first admin, and the agreement are
 * committed together when the database is being bootstrapped.
 *
 * Databases that already have members keep their existing schema and data.
 * Schema upgrades still go through server/migrations/.
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

async function needsBootstrap(db) {
  const [tables] = await db.query(`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('users', 'docker_bootstrap')
  `);
  if (tables.some(({ name }) => name === 'docker_bootstrap')) {
    const [[{ completed }]] = await db.query('SELECT EXISTS (SELECT 1 FROM docker_bootstrap WHERE id = 1) AS completed');
    return !completed;
  }
  if (!tables.some(({ name }) => name === 'users')) return true;

  // An old interrupted start may have inserted only the reserved System row.
  // Leave populated databases to the normal migration path.
  const [[{ hasMembers }]] = await db.query(`
    SELECT EXISTS (
      SELECT 1 FROM users WHERE id <> 1 OR NOT (role <=> 'system')
    ) AS hasMembers
  `);
  return !hasMembers;
}

async function loadSchema(db) {
  // The bootstrap marker exists before the first implicit DDL commit. Its row
  // is inserted only after the schema and seed are both complete.
  await db.query(`
    CREATE TABLE IF NOT EXISTS docker_bootstrap (
      id TINYINT NOT NULL PRIMARY KEY
    ) ENGINE=InnoDB
  `);
  // The dump includes a temporary view before its final definition.
  const schema = sql('schema.sql')
    .replace(/^CREATE TABLE `/gm, 'CREATE TABLE IF NOT EXISTS `')
    .replace(/^\/\*!50001 CREATE VIEW `/gm, '/*!50001 CREATE OR REPLACE VIEW `');
  await db.query(schema);
}

async function createFirstAdmin(db) {
  const [[{ n: admins }]] = await db.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  if (admins) return;

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.log('[init] no admin account yet: set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart');
    return;
  }
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters');

  const name = (process.env.ADMIN_NAME || 'Admin').trim();
  const username = email.split('@')[0];
  const hash = await bcrypt.hash(password, 10);
  await db.execute(
    "INSERT INTO users (email, password, name, role, intranet_username) VALUES (?, ?, ?, 'admin', ?)",
    [email, hash, name, username]
  );

  const [[{ n: agreements }]] = await db.query(
    "SELECT COUNT(*) AS n FROM agreement_versions WHERE agreement_type = 'team'"
  );
  if (!agreements) await db.query(sql('seed_team_agreement.sql'));
  return { email, createdAgreement: !agreements };
}

(async () => {
  const db = await connect();
  try {
    // MySQL releases this connection-owned advisory lock when db.end() runs
    // or an interrupted initializer disconnects.
    const [[{ acquired }]] = await db.query(
      "SELECT GET_LOCK(SHA2(CONCAT('owtranet:docker:init:', LOWER(DATABASE())), 256), 60) AS acquired"
    );
    if (!acquired) throw new Error('could not lock database for Owtranet initialization');

    const bootstrap = await needsBootstrap(db);
    if (bootstrap) {
      console.log('[init] loading first-run schema and seed data');
      await loadSchema(db);
    }

    await db.beginTransaction();
    let admin;
    try {
      if (bootstrap) {
        await db.query(sql('seed.sql'));
        const [[{ systemUser }]] = await db.query(
          "SELECT EXISTS (SELECT 1 FROM users WHERE id = 1 AND role = 'system') AS systemUser"
        );
        if (!systemUser) throw new Error('reserved System account is missing at user id 1');
      }
      admin = await createFirstAdmin(db);
      if (bootstrap) await db.query('INSERT INTO docker_bootstrap (id) VALUES (1)');
      await db.commit();
    } catch (err) {
      await db.rollback();
      throw err;
    }
    if (admin) console.log(`[init] created admin ${admin.email}`);
    if (admin?.createdAgreement) {
      console.log('[init] loaded placeholder team agreement (replace it in Admin → Agreements)');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(`[init] failed: ${err.message}`);
  process.exit(1);
});
