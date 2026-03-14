-- V51: Add 'waived' (dispensé) to deposit_status CHECK constraint
-- Used when staff confirms a booking without requiring the deposit payment

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_deposit_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_deposit_status_check
  CHECK (deposit_status IS NULL OR deposit_status IN ('pending','paid','refunded','cancelled','waived'));
