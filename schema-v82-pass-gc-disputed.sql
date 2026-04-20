-- v82: Extension P1-07 — dispute tracking sur passes + gift_cards
--
-- Contexte : la migration v80 (schema-v80-booking-disputed.sql) ajoutait
-- disputed_at sur bookings uniquement. Les passes et gift_cards ont leur
-- propre stripe_payment_intent_id → disputes Stripe sur ces PIs n'étaient
-- pas trackées → staff pouvait refund un pass/GC en dispute → double-loss.
--
-- Fix : colonnes disputed_at sur passes + gift_cards + indexes partiels.

ALTER TABLE passes ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_passes_disputed
  ON passes(business_id, disputed_at)
  WHERE disputed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_cards_disputed
  ON gift_cards(business_id, disputed_at)
  WHERE disputed_at IS NOT NULL;
