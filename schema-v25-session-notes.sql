-- v25: Add session notes (rich text) to bookings for consultation reports
-- These notes can be sent to the client by email

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS session_notes TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS session_notes_sent_at TIMESTAMPTZ;
