-- Direct messages had no way to reply to a specific earlier message, while group
-- chat has had one since it shipped (group_messages.reply_to_id). TestFlight
-- feedback 2026-09-16: "what replying to previous message?" — asked from a 1:1
-- thread, where the feature simply did not exist.
--
-- Mirrors group_messages exactly: nullable self-reference, its own index, and
-- ON DELETE SET NULL so hard-deleting a parent leaves the reply standing rather
-- than cascading it away. (Normal in-app deletes are soft — deleted_at — and the
-- read query renders those as "(deleted)", so the FK only matters for real row
-- removal.)
--
-- The constraint is named explicitly rather than left to MySQL's auto-numbering:
-- live direct_messages already uses direct_messages_ibfk_1..3 (conversation_id,
-- sender_id, recipient_id), so the obvious next-in-sequence name collides with
-- ERROR 1826. Note recipient_id is not in setup_database.sql at all — that file
-- is stale for this table; the live schema is the reference.
--
-- Safe to re-run: the ADD COLUMN is guarded, so a second run is a no-op rather
-- than ERROR 1060. Apply to EACH instance database.

SET @ddl = (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''direct_messages.reply_to_id already present, skipping'' AS note',
    'ALTER TABLE direct_messages
       ADD COLUMN reply_to_id INT DEFAULT NULL,
       ADD KEY idx_direct_messages_reply_to (reply_to_id),
       ADD CONSTRAINT fk_direct_messages_reply_to
         FOREIGN KEY (reply_to_id) REFERENCES direct_messages (id) ON DELETE SET NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'direct_messages'
    AND COLUMN_NAME = 'reply_to_id'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
