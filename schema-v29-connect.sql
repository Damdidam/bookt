-- ============================================================
-- GENDA v29 — Stripe Connect Express
-- Adds: Connect account fields on businesses for merchant payouts
-- Run AFTER schema-v21
-- ============================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS stripe_connect_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS stripe_connect_status VARCHAR(20) DEFAULT 'none'
    CHECK (stripe_connect_status IN ('none','onboarding','active','restricted','disabled'));

CREATE INDEX IF NOT EXISTS idx_businesses_stripe_connect
  ON businesses(stripe_connect_id) WHERE stripe_connect_id IS NOT NULL;

-- ============================================================
-- DONE. v29 adds:
--   - businesses.stripe_connect_id       (Express account ID)
--   - businesses.stripe_connect_status   (KYC verification state)
-- ============================================================
