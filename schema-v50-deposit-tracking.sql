-- V50: Deposit request tracking — anti-spam, auto-reminder, time guard
-- Tracks when deposit was first requested, how many manual resends, and if auto-reminder was sent

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_requested_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_request_count INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_reminder_sent BOOLEAN DEFAULT false;

-- Backfill: set deposit_requested_at for existing pending_deposit bookings from notifications table
UPDATE bookings b SET deposit_requested_at = sub.first_sent
FROM (
  SELECT booking_id, MIN(sent_at) AS first_sent
  FROM notifications
  WHERE type = 'email_deposit_request' AND status = 'sent'
  GROUP BY booking_id
) sub
WHERE b.id = sub.booking_id
  AND b.deposit_required = true
  AND b.deposit_requested_at IS NULL;

-- For pending deposits without notification records, use created_at as fallback
UPDATE bookings
SET deposit_requested_at = created_at
WHERE deposit_required = true
  AND deposit_requested_at IS NULL
  AND status = 'pending_deposit';
