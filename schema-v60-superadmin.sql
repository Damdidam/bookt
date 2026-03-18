-- v60: Add superadmin flag for platform admin panel
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;
