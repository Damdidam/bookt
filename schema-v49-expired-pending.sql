-- V49: Track expired (unconfirmed) pending bookings per client
-- Gives merchants visibility on "phantom" clients who book but never confirm

ALTER TABLE clients ADD COLUMN IF NOT EXISTS expired_pending_count SMALLINT DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_expired_pending_at TIMESTAMPTZ;
