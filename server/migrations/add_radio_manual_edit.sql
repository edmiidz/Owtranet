-- Corporate Radio: allow hand-edited segments (web /forum/post/:slug/tts "Edit").
-- Manual segments are left alone by radioWorker.js until someone presses Regenerate.
-- MySQL has no ADD COLUMN IF NOT EXISTS; re-running this errors harmlessly with "Duplicate column".
ALTER TABLE radio_segments
  ADD COLUMN is_manual TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = edited by hand; worker will not overwrite' AFTER status,
  ADD COLUMN edited_by INT NULL AFTER is_manual;
