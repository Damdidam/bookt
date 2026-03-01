-- ============================================================
-- GENDA v23 — DEPOSIT / ACOMPTE SYSTEM
-- Adds: pending_deposit status, deposit tracking columns,
--       new notification types for deposit flow
-- Run AFTER schema-v22-oauth-states.sql
-- ============================================================

-- 1. Extend bookings status CHECK to include 'pending_deposit' and 'modified_pending'
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending','confirmed','cancelled','completed','no_show','pending_deposit','modified_pending'));

-- 2. Add deposit tracking columns to bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS deposit_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_amount_cents INTEGER,
  ADD COLUMN IF NOT EXISTS deposit_status VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deposit_payment_intent_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS deposit_payment_url TEXT,
  ADD COLUMN IF NOT EXISTS deposit_deadline TIMESTAMPTZ;

-- deposit_status CHECK (separate so IF NOT EXISTS works on column first)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_deposit_status_check'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_deposit_status_check
      CHECK (deposit_status IS NULL OR deposit_status IN ('pending','paid','refunded','cancelled'));
  END IF;
END $$;

-- 3. Extend notifications type CHECK for deposit emails
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'email_confirmation','sms_confirmation',
    'email_reminder_24h','sms_reminder_24h','sms_reminder_2h',
    'email_cancellation','sms_cancellation',
    'call_filter_sms','email_post_rdv','email_new_booking_pro',
    'email_deposit_request','email_deposit_confirmed','email_deposit_cancelled'
  ));

-- 4. Index for cron auto-cancel of expired deposits
CREATE INDEX IF NOT EXISTS idx_bookings_pending_deposit
  ON bookings (business_id, deposit_deadline)
  WHERE status = 'pending_deposit' AND deposit_status = 'pending';

-- 5. Update slot conflict index to include pending_deposit
DROP INDEX IF EXISTS idx_bookings_slots;
CREATE INDEX IF NOT EXISTS idx_bookings_slots
  ON bookings (business_id, practitioner_id, start_at, end_at)
  WHERE status IN ('pending','confirmed','pending_deposit');
