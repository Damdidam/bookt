-- v42: Add locked flag to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false;
