-- v80: P1-07 — Ajout bookings.disputed_at pour bloquer refunds staff après dispute
--
-- Contexte : charge.dispute.created webhook recevait déjà l'event et queuait
-- email_dispute_alert au salon. MAIS rien ne PROTÉGEAIT contre un staff qui
-- cliquerait "rembourser" ensuite (ignorant l'alert) → double-loss :
-- refund Stripe + dispute perdue = pro perd 2× la somme + fees.
--
-- Fix : colonne `disputed_at TIMESTAMPTZ` posée par le webhook. Les routes
-- refund (bookings-status.js, passes.js, gift-cards.js, booking-actions.js)
-- checkent NULL avant d'appeler stripe.refunds.create → 409 si contentieux.
--
-- Colonne + index pour filtre dashboard "disputes en cours".

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_disputed
  ON bookings(business_id, disputed_at)
  WHERE disputed_at IS NOT NULL;
