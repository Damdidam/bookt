-- ============================================================
-- GENDA v10 — Booking Groups (multi-service appointments)
-- Allows multiple services to be chained into a single visit
-- Run AFTER schema-v9-calendar.sql
-- ============================================================

-- Add group columns to bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS group_id UUID,          -- shared UUID for linked bookings
  ADD COLUMN IF NOT EXISTS group_order INTEGER;     -- 0-based order within group

-- Index for fast group lookups
CREATE INDEX IF NOT EXISTS idx_bookings_group
  ON bookings(group_id)
  WHERE group_id IS NOT NULL;

-- ============================================================
-- DONE. v10 migration adds:
--   - bookings.group_id (UUID linking multi-service appointments)
--   - bookings.group_order (sequence within group)
-- ============================================================
