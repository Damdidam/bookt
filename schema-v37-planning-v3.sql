-- v37: Planning v3 — period_end for multi-day absence support
-- Allows "Monday PM to Thursday AM" style absences

ALTER TABLE staff_absences ADD COLUMN IF NOT EXISTS period_end VARCHAR(10) NOT NULL DEFAULT 'full';
DO $$ BEGIN
  ALTER TABLE staff_absences ADD CONSTRAINT staff_absences_period_end_check
    CHECK (period_end IN ('full', 'am', 'pm'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
