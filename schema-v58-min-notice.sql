-- v58: Add min_booking_notice_hours to services
ALTER TABLE services ADD COLUMN IF NOT EXISTS min_booking_notice_hours INTEGER DEFAULT 0;
