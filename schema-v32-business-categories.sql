-- V32: Business custom categories + service time restrictions
-- Run after schema-v31

-- Custom categories per business (separate from sector_categories which are shared catalog)
CREATE TABLE IF NOT EXISTS business_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label         VARCHAR(100) NOT NULL,
  icon_svg      TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biz_cats ON business_categories(business_id, sort_order);
ALTER TABLE business_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON business_categories
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- Service time restrictions (JSONB)
-- Format: {"type":"restricted","windows":[{"day":0,"from":"09:00","to":"12:00"}]}
-- day: 0=Mon, 6=Sun (matches slot engine weekday convention)
-- null = no restriction (available anytime within practitioner availability)
ALTER TABLE services ADD COLUMN IF NOT EXISTS available_schedule JSONB;
