-- ============================================================
-- GENDA v42 — VIP CLIENT FLAG
-- ============================================================

-- 1. Add VIP column to clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_vip boolean DEFAULT false;

-- 2. Index for quick VIP lookups
CREATE INDEX IF NOT EXISTS idx_clients_vip ON clients (business_id, is_vip) WHERE is_vip = true;

COMMENT ON COLUMN clients.is_vip IS 'Client marked as VIP by the business';

-- ============================================================
-- VERIFY
-- ============================================================
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'clients'
  AND column_name = 'is_vip'
ORDER BY column_name;
