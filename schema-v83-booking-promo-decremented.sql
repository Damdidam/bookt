-- v83: P2-01 — flag promo_decremented_at sur bookings pour idempotence
--
-- Avant : decrementPromoUsage(bookingId) faisait un UPDATE brut sans flag.
-- Si le path est double-appelé (ex: webhook Stripe retry + UI cancel), le
-- compteur promotions.current_uses est décrémenté 2× → promo épuisée
-- redevient disponible à tort.
--
-- Fix : colonne promo_decremented_at + check/set atomique UPDATE ... RETURNING
-- pour skip les appels en double.
--
-- Colonne nullable : par défaut NULL (pas encore décrémenté).

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS promo_decremented_at TIMESTAMPTZ;
