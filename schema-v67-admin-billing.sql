-- schema-v67-admin-billing.sql
-- Add billing tracking columns for super admin panel
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan_changed_at TIMESTAMPTZ;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ;

-- Backfill plan_changed_at from created_at for existing businesses
UPDATE businesses SET plan_changed_at = created_at WHERE plan_changed_at IS NULL;
