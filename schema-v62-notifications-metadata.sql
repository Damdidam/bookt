-- v62: Add metadata column to notifications + update type CHECK constraint
-- metadata stores extra context (e.g. old_start_at for reschedule notifications)

-- Add metadata jsonb column
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Update CHECK constraint to include email_reschedule_pro and email_modification_confirmed
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'email_confirmation','sms_confirmation',
    'email_reminder_24h','sms_reminder_24h',
    'email_reminder_2h','sms_reminder_2h',
    'email_cancellation','sms_cancellation',
    'email_cancellation_pro',
    'email_reschedule_pro',
    'email_modification_confirmed',
    'email_modification_rejected',
    'call_filter_sms','email_post_rdv','email_new_booking_pro',
    'email_deposit_request','sms_deposit_request',
    'email_deposit_confirmed','email_deposit_cancelled',
    'deposit_paid_webhook',
    'email_waitlist_offer','waitlist_match',
    'email_confirmation_request'
  ));
