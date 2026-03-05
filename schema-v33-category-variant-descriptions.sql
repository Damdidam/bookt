-- v33: Add description to categories and variants
-- Enables 3-level descriptions: Category > Service > Variant

ALTER TABLE business_categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE service_variants ADD COLUMN IF NOT EXISTS description TEXT;
