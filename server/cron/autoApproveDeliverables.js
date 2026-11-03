/**
 * Auto-approve deliverables that have been pending for >= 6 weeks.
 *
 * A deliverable pending for six weeks or more becomes approved and is tagged
 * "Auto-approved" in the UI.
 *
 * Design notes:
 * - We keep status = 'approved' so all existing approved/paid contribution math
 *   and UI just work. The discriminator is the new `auto_approved` column
 *   (migration: server/migrations/add_auto_approved_columns.sql), surfaced in
 *   the UI as an "Auto-approved" badge. A new enum status would have silently
 *   broken every `status = 'approved'` query.
 * - approved_by is left NULL (no human approver); auto_approved_at records when.
 * - "6 weeks" is measured from created_at.
 *
 * SAFETY: defaults to DRY-RUN. It will only WRITE when run with --apply.
 *   Dry run (default):   node server/cron/autoApproveDeliverables.js
 *   Real run:            node server/cron/autoApproveDeliverables.js --apply
 *   Batch cap:           node server/cron/autoApproveDeliverables.js --apply --max=50
 *
 * The PM2 schedule should run it with --apply once the backlog has been reviewed.
 */

const mysql = require('mysql2/promise');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const WEEKS_PENDING = 6;

// CLI flags
const APPLY = process.argv.includes('--apply');
const maxArg = process.argv.find(a => a.startsWith('--max='));
const MAX_BATCH = maxArg ? parseInt(maxArg.split('=')[1], 10) : null; // null = no cap

async function getDbConnection() {
  return await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'owtranet'
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n🕒 [auto-approve] ${startedAt}`);
  console.log(`   Mode: ${APPLY ? '🔴 APPLY (will write)' : '🟢 DRY-RUN (no changes)'}`);
  console.log(`   Rule: status='pending' AND created_at < NOW() - INTERVAL ${WEEKS_PENDING} WEEK`);
  if (MAX_BATCH) console.log(`   Batch cap: ${MAX_BATCH}`);

  const db = await getDbConnection();
  try {
    // Find eligible rows (oldest first so a capped batch clears the backlog tail).
    const [rows] = await db.execute(
      `SELECT id, title, amount, nominee_user_id, created_at
         FROM deliverables
        WHERE status = 'pending'
          AND created_at < (NOW() - INTERVAL ? WEEK)
        ORDER BY created_at ASC`,
      [WEEKS_PENDING]
    );

    const eligible = MAX_BATCH ? rows.slice(0, MAX_BATCH) : rows;
    const totalAmount = eligible.reduce((s, r) => s + Number(r.amount || 0), 0);

    console.log(`\n📊 Eligible: ${rows.length} pending >= ${WEEKS_PENDING} weeks` +
      (MAX_BATCH ? ` (processing ${eligible.length} this run)` : ''));
    console.log(`   Total amount in this batch: $${totalAmount.toLocaleString()}`);

    if (eligible.length === 0) {
      console.log('✅ Nothing to auto-approve.');
      return;
    }

    // Show a preview sample so a dry-run is reviewable.
    const sample = eligible.slice(0, 15);
    console.log(`\n   ${MAX_BATCH ? 'Batch' : 'Sample'} (first ${sample.length}):`);
    for (const r of sample) {
      const age = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
      console.log(`     #${r.id}  $${Number(r.amount || 0).toLocaleString()}  ${age}d  ${(r.title || '').slice(0, 60)}`);
    }
    if (eligible.length > sample.length) {
      console.log(`     ...and ${eligible.length - sample.length} more`);
    }

    if (!APPLY) {
      console.log(`\n🟢 DRY-RUN complete. Would auto-approve ${eligible.length} deliverable(s) totaling $${totalAmount.toLocaleString()}.`);
      console.log('   Re-run with --apply to perform the approval.');
      return;
    }

    // Apply: approve by explicit id list so a --max cap is respected exactly.
    const ids = eligible.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const [result] = await db.execute(
      `UPDATE deliverables
          SET status = 'approved',
              auto_approved = 1,
              auto_approved_at = NOW(),
              approved_by = NULL,
              updated_at = NOW()
        WHERE id IN (${placeholders})
          AND status = 'pending'`,
      ids
    );

    console.log(`\n✅ Auto-approved ${result.affectedRows} deliverable(s) totaling $${totalAmount.toLocaleString()}.`);
  } catch (err) {
    console.error('❌ [auto-approve] error:', err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
