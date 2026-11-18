#!/usr/bin/env node
/**
 * Upsert the intranet AI agents from AGENT_CATALOG in
 * server/lib/aiAgents.js. Idempotent — re-run after editing the catalog.
 *
 *   node server/scripts/seedAiAgents.js --dry-run   # show what would change
 *   node server/scripts/seedAiAgents.js             # apply
 *
 * Requires server/migrations/add_ai_agents.sql. New agents are created as
 * role 'system' + account_type 'ai_agent' with an unusable password (they never
 * log in). The optional voice agent is included when ELEVENLABS_AGENT_ID is set.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { AGENT_CATALOG, unusablePassword } = require('../lib/aiAgents');

const DRY_RUN = process.argv.includes('--dry-run');
const EMAIL_DOMAIN = process.env.COMPANY_EMAIL_DOMAIN || 'example.com';

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  for (const [index, agent] of AGENT_CATALOG.entries()) {
    let userId = null;
    const [[user]] = await db.execute('SELECT id, account_type FROM users WHERE intranet_username = ?', [agent.handle]);
    if (user && user.account_type !== 'ai_agent') {
      throw new Error(`${agent.handle}: @${agent.handle} already belongs to human user ${user.id} — pick another handle`);
    }
    const profile = [agent.name, agent.tagline, agent.description, agent.avatar_url || `/ai-agents/${agent.handle}.svg`];
    if (user) {
      userId = user.id;
      console.log(`${agent.handle}: updating user ${userId}`);
      if (!DRY_RUN) {
        await db.execute(
          `UPDATE users SET name = ?, position = ?, bio = ?, avatar_url = ?, department = 'AI Agents' WHERE id = ?`,
          [...profile, userId]
        );
      }
    } else {
      console.log(`${agent.handle}: creating agent user`);
      if (!DRY_RUN) {
        const [result] = await db.execute(
          `INSERT INTO users (email, password, name, position, bio, avatar_url, department, intranet_username,
                              role, account_type, email_verified)
           VALUES (?, ?, ?, ?, ?, ?, 'AI Agents', ?, 'system', 'ai_agent', 1)`,
          [`ai-agent+${agent.handle}@${EMAIL_DOMAIN}`, await bcrypt.hash(unusablePassword(), 10), ...profile, agent.handle]
        );
        userId = result.insertId;
      }
    }

    if (!DRY_RUN) {
      await db.execute(
        `INSERT INTO ai_agents (user_id, handle, kind, tagline, description, elevenlabs_agent_id, skill_command, skill_url, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE handle = VALUES(handle), kind = VALUES(kind), tagline = VALUES(tagline),
           description = VALUES(description), elevenlabs_agent_id = VALUES(elevenlabs_agent_id),
           skill_command = VALUES(skill_command), skill_url = VALUES(skill_url), sort_order = VALUES(sort_order)`,
        [userId, agent.handle, agent.kind, agent.tagline, agent.description, agent.elevenlabs_agent_id,
         agent.skill_command, agent.skill_url, index]
      );
    }
  }

  await db.end();
  console.log(DRY_RUN ? 'Dry run — nothing written.' : `✅ ${AGENT_CATALOG.length} agents upserted.`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
