-- v72: Stripe webhook idempotence
-- BUG-G fix: prevent duplicate processing of retried/replayed Stripe events
-- (charge.refunded, checkout.session.completed, etc.). Each event.id is written
-- once; retries see ON CONFLICT and short-circuit with a 200 to Stripe.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id VARCHAR(120) PRIMARY KEY,
  event_type VARCHAR(80),
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swe_processed ON stripe_webhook_events(processed_at);
