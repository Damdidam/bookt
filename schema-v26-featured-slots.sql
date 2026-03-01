-- V26: Featured slots — practitioner-curated slots for the public booking page
-- When featured slots exist for a given week, only those slots are shown to clients.

CREATE TABLE IF NOT EXISTS featured_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT fs_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_featured_slots_lookup
  ON featured_slots (business_id, practitioner_id, date);

ALTER TABLE featured_slots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'featured_slots' AND policyname = 'featured_slots_business') THEN
    CREATE POLICY featured_slots_business ON featured_slots
      USING (business_id = current_setting('app.current_business_id')::uuid);
  END IF;
END $$;
