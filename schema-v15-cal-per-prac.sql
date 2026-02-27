-- v15: Calendar connections per practitioner (not per user)
-- Allows each practitioner to have their own Google/Outlook/iCal connection

-- Drop old unique constraint (business_id, user_id, provider)
ALTER TABLE calendar_connections DROP CONSTRAINT IF EXISTS calendar_connections_business_id_user_id_provider_key;

-- Ensure practitioner_id column exists (should already from schema-v5)
-- ALTER TABLE calendar_connections ADD COLUMN IF NOT EXISTS practitioner_id UUID REFERENCES practitioners(id);

-- Add new unique constraint per practitioner per provider
-- NULL practitioner_id = business-wide connection (fallback)
ALTER TABLE calendar_connections
  ADD CONSTRAINT calendar_connections_business_practitioner_provider_key
  UNIQUE (business_id, practitioner_id, provider);

-- Index for fast lookups by practitioner
CREATE INDEX IF NOT EXISTS idx_cal_conn_practitioner
  ON calendar_connections (practitioner_id) WHERE practitioner_id IS NOT NULL;
