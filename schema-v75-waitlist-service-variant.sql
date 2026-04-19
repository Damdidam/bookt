-- v75: Add service_variant_id to waitlist_entries
--
-- Before: waitlist stores only service_id — if a service has variants (ex: "Coupe courte"
-- vs "Coupe longue" 30€/45€), waitlist loses the variant choice. When a slot opens and
-- the client accepts the offer, the created booking has service_variant_id=NULL:
--   - LM/deposit calculated on the BASE service price (not variant-specific)
--   - Email confirmation displays "Coupe" instead of "Coupe — Coupe longue"
--   - Duration may be wrong (variant has its own duration_min)
--
-- Fix: add nullable column (legacy entries stay NULL = base service, no data migration needed).
-- ON DELETE SET NULL: if a variant is deleted, the waitlist entry falls back to base service
-- (acceptable UX — the client is notified of the service even if the variant is gone).

ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS service_variant_id UUID REFERENCES service_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_waitlist_variant ON waitlist_entries(service_variant_id) WHERE service_variant_id IS NOT NULL;
