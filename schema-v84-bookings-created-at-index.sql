-- v84: BUG 2 perf — index bookings(business_id, created_at DESC)
--
-- Contexte : dashboard.js:148-162 (recent_activity) fait :
--   WHERE b.business_id = $1 AND b.created_at >= NOW() - INTERVAL '3 days'
--   ORDER BY b.created_at DESC LIMIT 30
--
-- Les 3 indexes existants sur bookings couvrent :
--   (business_id, practitioner_id, start_at, end_at) WHERE status IN (pending|confirmed)
--   (business_id, start_at, status)
--   (client_id, start_at)
--
-- Aucun ne matche `created_at` → bitmap scan sur business_id puis filtre+tri
-- à la main. Sur 50k bookings = latence notable sur dashboard home hot-path.
--
-- CONCURRENTLY pour éviter lock exclusif en prod.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_business_created
  ON bookings(business_id, created_at DESC);
