-- Auto-approve deliverables pending >= 6 weeks
-- Adds an explicit discriminator so auto-approved rows stay status='approved'
-- (keeps all existing status='approved' queries / contribution math working)
-- without inventing a new enum value.
--
-- Apply on the intranet RDS DB (owtranet), NOT the local instance:
--   cd /var/www/owtranet
--   mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < server/migrations/add_auto_approved_columns.sql
--

ALTER TABLE deliverables
  ADD COLUMN auto_approved TINYINT(1) NOT NULL DEFAULT 0 AFTER approved_at,
  ADD COLUMN auto_approved_at DATETIME NULL AFTER auto_approved;
