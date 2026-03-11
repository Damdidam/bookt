-- ============================================================
-- GENDA v48 — FIX: Extend status column to fit 'pending_deposit' (15 chars)
-- The original schema defined status as VARCHAR(12), but v23 added
-- 'pending_deposit' (15 chars) and 'modified_pending' (16 chars)
-- without widening the column.
-- ============================================================

ALTER TABLE bookings ALTER COLUMN status TYPE VARCHAR(20);
