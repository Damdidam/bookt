-- schema-v68-notification-types.sql
-- Sync CHECK constraint with production (already applied manually)
-- Types added: email_deposit_orphan, email_dispute_alert, manual_reminder

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
    'email_confirmation_request',
    'sms_confirmation_reply',
    'email_deposit_orphan',
    'email_dispute_alert',
    'manual_reminder'
  ));
