-- schema-v54-booking-promotions.sql
-- Add promotion tracking columns to bookings table

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_label VARCHAR(200),
  ADD COLUMN IF NOT EXISTS promotion_discount_pct INTEGER,
  ADD COLUMN IF NOT EXISTS promotion_discount_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookings_promotion ON bookings(promotion_id) WHERE promotion_id IS NOT NULL;
