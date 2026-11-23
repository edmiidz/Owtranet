-- Direct and group messages become editable by their sender, and an edited
-- message shows "(edited)" to everyone in the thread.
--
-- edited_at is NULL until the first edit, then the time of the latest one.
-- updated_at can't serve: on group_messages it has ON UPDATE CURRENT_TIMESTAMP
-- (any column change bumps it), and direct_messages has no updated_at at all.
-- group_messages.is_edited already exists and is kept in step for old clients
-- that read it.
--
-- Apply BEFORE deploying the server that reads edited_at. Safe to re-run: each
-- ADD COLUMN is guarded.

SET @ddl = (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''direct_messages.edited_at already present, skipping'' AS note',
    'ALTER TABLE direct_messages ADD COLUMN edited_at DATETIME DEFAULT NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'direct_messages'
    AND COLUMN_NAME = 'edited_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) > 0,
    'SELECT ''group_messages.edited_at already present, skipping'' AS note',
    'ALTER TABLE group_messages ADD COLUMN edited_at DATETIME DEFAULT NULL'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'group_messages'
    AND COLUMN_NAME = 'edited_at'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
