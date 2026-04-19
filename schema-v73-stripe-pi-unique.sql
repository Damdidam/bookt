-- v73: UNIQUE partial indexes on stripe_payment_intent_id for gift_cards + passes
-- BUG-IDEMPOTENCE fix: prevents double-insert races on Stripe webhook retries
-- for checkout.session.completed (GC / pass purchase).
--
-- The SELECT check + INSERT pattern in stripe.js webhook handler is NOT atomic:
-- two simultaneous webhook deliveries can both see zero rows and both INSERT.
-- A partial UNIQUE index makes the second INSERT fail with 23505 (unique_violation),
-- which the handler already catches silently (via ON CONFLICT or try/catch).
--
-- Partial (WHERE NOT NULL) because older rows (pre-v59 / pre-v60) or rows created
-- outside Stripe path may legitimately have NULL here.

CREATE UNIQUE INDEX IF NOT EXISTS uq_gc_stripe_pi
  ON gift_cards (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_passes_stripe_pi
  ON passes (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
