-- v38: Business holidays — legal/public holidays per business
-- Used by planning grid to exclude holidays from absence counters

CREATE TABLE IF NOT EXISTS business_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id, date)
);

CREATE INDEX IF NOT EXISTS idx_business_holidays_lookup ON business_holidays(business_id, date);

ALTER TABLE business_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_holidays_rls ON business_holidays;
CREATE POLICY business_holidays_rls ON business_holidays
  USING (business_id = current_setting('app.current_business_id')::uuid);
