-- ============================================================
-- GENDA v46 — LAST-MINUTE DISCOUNT SLOTS
-- ============================================================

-- 1. Track discount percentage applied at booking time
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_pct SMALLINT DEFAULT NULL;

COMMENT ON COLUMN bookings.discount_pct IS 'Discount % applied (e.g. 10 for last-minute -10%). Price = service.price_cents * (100 - discount_pct) / 100';

-- ============================================================
-- Settings (stored in businesses.settings JSONB):
--   last_minute_enabled        boolean   (default false)
--   last_minute_deadline        'j-2' | 'j-1' | 'same_day'  (default 'j-1')
--   last_minute_discount_pct    5|10|15|20|25  (default 10)
--   last_minute_min_price_cents integer  (default 0 = no minimum)
-- ============================================================

-- VERIFY
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'bookings'
  AND column_name = 'discount_pct'
ORDER BY column_name;
