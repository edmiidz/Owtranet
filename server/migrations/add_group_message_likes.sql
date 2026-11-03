-- Group chat likes never worked: POST /api/group-chat/:groupId/messages/:messageId/like
-- inserts likeable_type = 'group_message', but the ENUM only allowed post/comment/message,
-- so MySQL stored '' and every later like hit the unique key ("Duplicate entry '4--13'").
-- Safe to re-run. Apply to EACH instance database.
ALTER TABLE likes MODIFY likeable_type ENUM('post','comment','message','group_message') DEFAULT NULL;
DELETE FROM likes WHERE likeable_type = '' OR likeable_type IS NULL;
