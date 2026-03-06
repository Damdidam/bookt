-- v40: Business hours — salon-level opening hours & exceptional closures
-- Used by Horaires section, Slot engine, Agenda bounds, Public minisite

-- ===== 1. Business schedule (weekly opening hours) =====

CREATE TABLE IF NOT EXISTS business_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT true,
  CHECK (end_time > start_time),
  UNIQUE(business_id, weekday, start_time)
);

CREATE INDEX IF NOT EXISTS idx_business_schedule_lookup
  ON business_schedule(business_id, weekday);

ALTER TABLE business_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_schedule_rls ON business_schedule;
CREATE POLICY business_schedule_rls ON business_schedule
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ===== 2. Business closures (exceptional closures with date ranges) =====

CREATE TABLE IF NOT EXISTS business_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  reason VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_business_closures_lookup
  ON business_closures(business_id, date_from, date_to);

ALTER TABLE business_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_closures_rls ON business_closures;
CREATE POLICY business_closures_rls ON business_closures
  USING (business_id = current_setting('app.current_business_id')::uuid);
