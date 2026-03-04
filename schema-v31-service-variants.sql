-- ============================================================
-- v31: Service descriptions + service variants
-- ============================================================

-- 1. Description field on services
ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Service variants table
CREATE TABLE IF NOT EXISTS service_variants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name          VARCHAR(200) NOT NULL,
  duration_min  INTEGER NOT NULL,
  price_cents   INTEGER,
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_variants_service ON service_variants(service_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_service_variants_business ON service_variants(business_id);

-- RLS
ALTER TABLE service_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_isolation ON service_variants;
CREATE POLICY business_isolation ON service_variants
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- Auto-update trigger
DROP TRIGGER IF EXISTS trg_service_variants_updated ON service_variants;
CREATE TRIGGER trg_service_variants_updated BEFORE UPDATE ON service_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Variant reference on bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_variant_id UUID REFERENCES service_variants(id);
CREATE INDEX IF NOT EXISTS idx_bookings_variant ON bookings(service_variant_id) WHERE service_variant_id IS NOT NULL;
