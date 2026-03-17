-- v55: Realisations (portfolio before/after photos)
CREATE TABLE IF NOT EXISTS realisations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title         TEXT,
  description   TEXT,
  category      TEXT,
  image_url     TEXT,
  before_url    TEXT,
  after_url     TEXT,
  sort_order    INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realisations_biz ON realisations (business_id, sort_order);

ALTER TABLE realisations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS realisations_rls ON realisations;
CREATE POLICY realisations_rls ON realisations
  USING (business_id = current_setting('app.current_business_id', true)::uuid);
