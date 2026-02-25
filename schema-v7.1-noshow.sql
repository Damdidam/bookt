-- ============================================================
-- GENDA v0.7.1 — NO-SHOW STRIKE SYSTEM
-- ============================================================

-- 1. Add strike columns to clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS no_show_count smallint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_blocked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason varchar(200),
  ADD COLUMN IF NOT EXISTS last_no_show_at timestamptz;

-- 2. Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_clients_blocked ON clients (business_id, is_blocked) WHERE is_blocked = true;
CREATE INDEX IF NOT EXISTS idx_clients_noshow ON clients (business_id, no_show_count) WHERE no_show_count > 0;

-- 3. Business settings already has a JSONB "settings" column.
-- We'll use these keys inside it:
--   noshow_block_threshold: 3    (0 = disabled, 1-10 = auto-block after N no-shows)
--   noshow_block_action: 'block' ('block' = can't book online, 'warn' = just flag)
--   noshow_policy: 'charge'      (already exists)

-- Update default settings to include new keys
-- (existing businesses keep their current settings, new ones get the defaults)
COMMENT ON COLUMN clients.no_show_count IS 'Number of no-shows recorded by the business';
COMMENT ON COLUMN clients.is_blocked IS 'Client blocked from online booking';
COMMENT ON COLUMN clients.blocked_reason IS 'Why the client was blocked (auto/manual)';

-- ============================================================
-- VERIFY
-- ============================================================
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'clients'
  AND column_name IN ('no_show_count', 'is_blocked', 'blocked_at', 'blocked_reason', 'last_no_show_at')
ORDER BY column_name;
