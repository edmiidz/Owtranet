-- Corporate Radio: segments now summarise the whole thread (post + replies).
-- comment_count = number of replies the segment was generated from; the worker
-- regenerates when it no longer matches (covers deleted replies, which leave no
-- updated_at trace). New/edited replies are detected via comments.updated_at.
-- MySQL has no ADD COLUMN IF NOT EXISTS; re-running this errors harmlessly with "Duplicate column".
ALTER TABLE radio_segments
  ADD COLUMN comment_count INT NOT NULL DEFAULT 0 COMMENT 'replies included when this segment was generated' AFTER source_hash;
