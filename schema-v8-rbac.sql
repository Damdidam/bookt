-- ============================================================
-- BOOKT v0.8 — RBAC (Role-Based Access Control)
-- Expand roles: owner | manager | practitioner | receptionist
-- Add sector to businesses for label mapping
-- ============================================================

-- 1. Add sector to businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS sector VARCHAR(30) DEFAULT 'autre'
    CHECK (sector IN (
      'coiffeur', 'esthetique', 'bien_etre', 'osteopathe',
      'veterinaire', 'photographe', 'medecin', 'dentiste',
      'kine', 'comptable', 'avocat', 'autre'
    ));

-- 2. Expand user roles
-- First drop the old constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Then add the new one with 4 roles
ALTER TABLE users
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('owner', 'manager', 'practitioner', 'receptionist'));

-- Migrate old 'staff' → 'practitioner' (if any exist)
UPDATE users SET role = 'practitioner' WHERE role = 'staff';

-- 3. Ensure practitioners.user_id is indexed for fast lookup
CREATE INDEX IF NOT EXISTS idx_practitioners_user_id
  ON practitioners(user_id) WHERE user_id IS NOT NULL;

-- ============================================================
-- DONE. v8 migration adds:
--   - businesses.sector (12 values)
--   - Expanded user roles (owner|manager|practitioner|receptionist)
--   - Index on practitioners.user_id
-- ============================================================
