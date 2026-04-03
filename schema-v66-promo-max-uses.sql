-- schema-v66-promo-max-uses.sql
-- Add max_uses / current_uses to promotions for usage-limited promos
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS max_uses INT;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS current_uses INT NOT NULL DEFAULT 0;
