-- v35: Staff absences table for PRO planning feature
-- Run this migration on the database

CREATE TABLE IF NOT EXISTS staff_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'conge' CHECK (type IN ('conge', 'maladie', 'formation', 'autre')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by business + date range
CREATE INDEX IF NOT EXISTS idx_staff_absences_business_dates
  ON staff_absences (business_id, date_from, date_to);

-- Index for lookups by practitioner
CREATE INDEX IF NOT EXISTS idx_staff_absences_practitioner
  ON staff_absences (practitioner_id, date_from, date_to);

-- RLS
ALTER TABLE staff_absences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_absences_rls ON staff_absences;
CREATE POLICY staff_absences_rls ON staff_absences
  USING (business_id = current_setting('app.current_business_id')::uuid);
