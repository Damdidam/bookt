-- BOOKT v12 — Global overlap policy (business-level, not per-client)
-- Run: psql -U bookt -d bookt -f schema-v12-overlap-global.sql

BEGIN;

-- 1. Add allow_overlap to business settings JSONB (default false)
UPDATE businesses
SET settings = settings || '{"allow_overlap": false}'::jsonb
WHERE NOT (settings ? 'allow_overlap');

-- 2. Drop per-client column
ALTER TABLE clients DROP COLUMN IF EXISTS allow_overlap;

COMMIT;
