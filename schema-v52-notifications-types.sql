-- v52: Update notifications type CHECK constraint with missing types
-- Adds: deposit_paid_webhook, sms_deposit_request, email_waitlist_offer,
--        email_modification_rejected, email_cancellation_pro, waitlist_match

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'email_confirmation','sms_confirmation',
    'email_reminder_24h','sms_reminder_24h','sms_reminder_2h',
    'email_cancellation','sms_cancellation',
    'email_cancellation_pro',
    'call_filter_sms','email_post_rdv','email_new_booking_pro',
    'email_deposit_request','sms_deposit_request',
    'email_deposit_confirmed','email_deposit_cancelled',
    'deposit_paid_webhook',
    'email_waitlist_offer','waitlist_match',
    'email_modification_rejected',
    'email_confirmation_request'
  ));
