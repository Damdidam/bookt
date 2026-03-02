-- V27: Simplify featured slots (start_time only) + locked weeks
-- Featured slots now store only start times (no end_time).
-- Locked weeks prevent normal bookings for a given practitioner + week.

-- Drop end_time from featured_slots
ALTER TABLE featured_slots DROP CONSTRAINT IF EXISTS fs_end_after_start;
ALTER TABLE featured_slots DROP COLUMN IF EXISTS end_time;

-- Locked weeks table
CREATE TABLE IF NOT EXISTS locked_weeks (
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,
  locked_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (business_id, practitioner_id, week_start)
);

ALTER TABLE locked_weeks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'locked_weeks' AND policyname = 'locked_weeks_business') THEN
    CREATE POLICY locked_weeks_business ON locked_weeks
      USING (business_id = current_setting('app.current_business_id')::uuid);
  END IF;
END $$;
