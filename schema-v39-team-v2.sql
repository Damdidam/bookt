-- v39: Team v2 — practitioner skills, leave balances, enriched practitioner fields
-- Used by Team section, Planning grid, and future Booking intelligence

-- ===== 1. New practitioner columns =====

ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20) DEFAULT 'cdi';
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS weekly_hours_target DECIMAL(4,1);
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100);
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(30);
ALTER TABLE practitioners ADD COLUMN IF NOT EXISTS internal_note TEXT;

-- ===== 2. Practitioner skills =====

CREATE TABLE IF NOT EXISTS practitioner_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  skill_name VARCHAR(100) NOT NULL,
  level SMALLINT DEFAULT 2 CHECK (level BETWEEN 1 AND 3),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(practitioner_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_practitioner_skills_lookup
  ON practitioner_skills(business_id, practitioner_id);

ALTER TABLE practitioner_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS practitioner_skills_rls ON practitioner_skills;
CREATE POLICY practitioner_skills_rls ON practitioner_skills
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ===== 3. Leave balances =====

CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'conge'
    CHECK (type IN ('conge', 'maladie', 'formation', 'recuperation')),
  total_days DECIMAL(5,1) NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(practitioner_id, year, type)
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_lookup
  ON leave_balances(business_id, practitioner_id, year);

ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leave_balances_rls ON leave_balances;
CREATE POLICY leave_balances_rls ON leave_balances
  USING (business_id = current_setting('app.current_business_id')::uuid);
