-- v43: Add flexibility option to services
ALTER TABLE services ADD COLUMN IF NOT EXISTS flexibility_enabled BOOLEAN DEFAULT false;
ALTER TABLE services ADD COLUMN IF NOT EXISTS flexibility_discount_pct INTEGER DEFAULT 0;
