-- ============================================================
-- GENDA v20 — Patient Reminders
-- Adds: reminder tracking on bookings, settings on businesses
-- Run AFTER schema-v19
-- ============================================================

-- 1. Track which reminders have been sent per booking
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_24h
  ON bookings(start_at)
  WHERE reminder_24h_sent_at IS NULL AND status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_2h
  ON bookings(start_at)
  WHERE reminder_2h_sent_at IS NULL AND status = 'confirmed';

-- 2. Add reminder settings to businesses JSONB
-- Defaults handled in code:
--   reminder_email_24h: true  (free for all plans)
--   reminder_sms_24h: false   (Pro/Premium only)
--   reminder_sms_2h: false    (Pro/Premium only)
--   reminder_email_2h: false  (optional)

-- No schema change needed — we use the existing settings JSONB column
-- ============================================================
-- DONE. v20 adds:
--   - bookings.reminder_24h_sent_at (track email/SMS sent)
--   - bookings.reminder_2h_sent_at (track 2h reminder sent)
--   - Indexes for efficient cron scanning
-- ============================================================
