-- ============================================================
-- GENDA v70 — Quote notice parametrable
-- Preserve existing 72h behavior for quote services before
-- removing the runtime floor in slot-engine.js
-- ============================================================
UPDATE services
SET min_booking_notice_hours = 72
WHERE quote_only = true
  AND COALESCE(min_booking_notice_hours, 0) < 72;
