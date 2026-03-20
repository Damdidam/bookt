-- V47: Add promo_eligible flag to services
-- Allows merchants to exclude specific services from last-minute promotions.
-- Default TRUE = all existing services remain eligible.

ALTER TABLE services ADD COLUMN IF NOT EXISTS promo_eligible BOOLEAN DEFAULT TRUE;

-- Comment: When last-minute promos are enabled (business settings),
-- only services with promo_eligible = TRUE will have their slots tagged
-- with the discount on the public booking page.
