-- V28: Add featured_enabled per-practitioner preference
-- Controls whether vedette mode is available for each practitioner.
-- Default false: vedette must be explicitly opted in.

ALTER TABLE practitioners
  ADD COLUMN IF NOT EXISTS featured_enabled BOOLEAN DEFAULT false;

-- Auto-enable for practitioners who already have featured slots
UPDATE practitioners SET featured_enabled = true
WHERE id IN (SELECT DISTINCT practitioner_id FROM featured_slots);
