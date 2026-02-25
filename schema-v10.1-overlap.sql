-- ============================================================
-- GENDA v10.1 — Client allow_overlap preference
-- Allows specific clients' bookings to bypass conflict checks
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS allow_overlap BOOLEAN DEFAULT false;

COMMENT ON COLUMN clients.allow_overlap IS 'If true, skip conflict checks for this client (e.g. coloration + other service in parallel)';
