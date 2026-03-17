-- v57: Add reschedule_count to bookings for client self-reschedule tracking
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count INTEGER DEFAULT 0;
