-- v44: Add VIP flag on clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT false;
