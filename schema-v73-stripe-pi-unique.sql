-- v73: UNIQUE partial indexes on stripe_payment_intent_id for gift_cards + passes
-- BUG-IDEMPOTENCE fix: prevents double-insert races on Stripe webhook retries
-- for checkout.session.completed (GC / pass purchase).
--
-- NOTE: on prod these indexes ALREADY existed via pre-existing migration
-- (discovered post-apply). This migration is now a no-op safety net (IF NOT EXISTS).
-- Names match the existing prod convention: idx_gift_cards_stripe_pi / idx_passes_stripe_pi.

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_cards_stripe_pi
  ON gift_cards (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_passes_stripe_pi
  ON passes (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
