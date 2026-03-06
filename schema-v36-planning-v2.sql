-- v36: Planning v2 — half-day support + absence activity logs
-- Run this migration on the database

-- Half-day support (full day, morning only, afternoon only)
ALTER TABLE staff_absences ADD COLUMN IF NOT EXISTS period VARCHAR(10) NOT NULL DEFAULT 'full';
-- Add CHECK constraint separately for idempotency
DO $$ BEGIN
  ALTER TABLE staff_absences ADD CONSTRAINT staff_absences_period_check
    CHECK (period IN ('full', 'am', 'pm'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Activity logs for absences
CREATE TABLE IF NOT EXISTS absence_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id UUID NOT NULL REFERENCES staff_absences(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  details JSONB,
  actor_name VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absence_logs_absence ON absence_logs(absence_id);

-- RLS
ALTER TABLE absence_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS absence_logs_rls ON absence_logs;
CREATE POLICY absence_logs_rls ON absence_logs
  USING (business_id = current_setting('app.current_business_id')::uuid);
