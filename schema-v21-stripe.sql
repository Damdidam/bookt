-- ============================================================
-- GENDA v21 — Stripe Subscriptions
-- Adds: Stripe fields on businesses for subscription management
-- Run AFTER schema-v20
-- ============================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'none'
    CHECK (subscription_status IN ('none', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'));

CREATE INDEX IF NOT EXISTS idx_businesses_stripe_customer
  ON businesses(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_stripe_sub
  ON businesses(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- ============================================================
-- DONE. v21 adds:
--   - businesses.stripe_customer_id
--   - businesses.stripe_subscription_id
--   - businesses.stripe_price_id
--   - businesses.trial_ends_at
--   - businesses.subscription_status
-- ============================================================
