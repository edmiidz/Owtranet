-- Add soft delete columns to direct_messages table
-- This allows messages to be deleted but show as "Deleted" artifacts

ALTER TABLE direct_messages
ADD COLUMN deleted_at DATETIME DEFAULT NULL,
ADD COLUMN deleted_by INT DEFAULT NULL,
ADD INDEX idx_deleted_at (deleted_at);

-- Optional: Add foreign key for deleted_by (who deleted the message)
-- ALTER TABLE direct_messages
-- ADD CONSTRAINT fk_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;
