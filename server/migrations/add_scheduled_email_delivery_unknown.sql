-- Keep ambiguous SMTP submissions visible and out of the send queue.
-- Stop the old app and scheduler before applying to each workspace database.
-- A legacy attempt may already have reached SMTP. Park it before adding the
-- new status so re-running after an interrupted migration can finish the move.
SET @legacy_scheduled_email_status = NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scheduled_emails'
    AND COLUMN_NAME = 'status'
    AND COLUMN_TYPE LIKE '%delivery_unknown%'
);
SET @legacy_unconfirmed_message = 'Delivery confirmation is unavailable for this older attempt. Verify delivery before sending again.';

UPDATE scheduled_emails
  SET status = 'sending', last_error = @legacy_unconfirmed_message
  WHERE @legacy_scheduled_email_status
    AND (status = 'sending' OR (status IN ('scheduled','failed') AND attempts > 0));

ALTER TABLE scheduled_emails
  MODIFY COLUMN status ENUM('scheduled','sending','sent','failed','cancelled','delivery_unknown')
  NOT NULL DEFAULT 'scheduled';

UPDATE scheduled_emails
  SET status = 'delivery_unknown'
  WHERE status = 'sending' AND last_error = @legacy_unconfirmed_message;
