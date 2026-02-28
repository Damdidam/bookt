-- =============================================
-- SCHEMA v18 — Fix plan constraint: 'team' → 'premium'
-- =============================================

-- 1. Drop old CHECK constraint
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_plan_check;

-- 2. Migrate any existing 'team' values
UPDATE businesses SET plan = 'premium' WHERE plan = 'team';

-- 3. Add corrected CHECK
ALTER TABLE businesses ADD CONSTRAINT businesses_plan_check
  CHECK (plan IN ('free', 'pro', 'premium'));

SELECT 'schema-v18 applied — plan premium OK' AS status;
