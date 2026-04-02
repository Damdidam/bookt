-- V64: Simplify roles from 4 (owner/manager/receptionist/practitioner) to 2 (owner/practitioner)
-- Migrate existing manager/receptionist users to owner
UPDATE users SET role = 'owner' WHERE role IN ('manager', 'receptionist');

-- Update CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'practitioner'));
