-- v13: Per-practitioner calendar slot increment
-- Allows each practitioner to define their own time grid granularity
-- (e.g. psychologist 30min, GP 20min, physio 15min)

ALTER TABLE practitioners
  ADD COLUMN IF NOT EXISTS slot_increment_min SMALLINT DEFAULT 15
  CHECK (slot_increment_min IN (5, 10, 15, 20, 30, 45, 60));
