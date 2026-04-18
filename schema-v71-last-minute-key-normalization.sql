-- ============================================================
-- GENDA v71 — LAST-MINUTE SETTINGS KEY NORMALIZATION
-- ============================================================
-- Bug E2E #3: historiquement certains businesses avaient des clés
-- settings `lastminute_*` (sans underscore) au lieu de `last_minute_*`.
-- Le backend ne lit plus que `last_minute_*` → discount ne s'applique
-- pas pour ces businesses. Ce script copie les clés orphelines vers
-- la convention canonique puis supprime les anciennes.
-- ============================================================

UPDATE businesses
SET settings = (
  COALESCE(settings, '{}'::jsonb)
  - 'lastminute_enabled'
  - 'lastminute_discount_pct'
  - 'lastminute_deadline'
  - 'lastminute_min_price_cents'
) || jsonb_strip_nulls(jsonb_build_object(
  'last_minute_enabled', COALESCE(
    (settings->>'last_minute_enabled')::boolean,
    (settings->>'lastminute_enabled')::boolean
  ),
  'last_minute_discount_pct', COALESCE(
    NULLIF(settings->>'last_minute_discount_pct', '')::int,
    NULLIF(settings->>'lastminute_discount_pct', '')::int
  ),
  'last_minute_deadline', COALESCE(
    NULLIF(settings->>'last_minute_deadline', ''),
    NULLIF(settings->>'lastminute_deadline', '')
  ),
  'last_minute_min_price_cents', COALESCE(
    NULLIF(settings->>'last_minute_min_price_cents', '')::int,
    NULLIF(settings->>'lastminute_min_price_cents', '')::int
  )
))
WHERE settings ? 'lastminute_enabled'
   OR settings ? 'lastminute_discount_pct'
   OR settings ? 'lastminute_deadline'
   OR settings ? 'lastminute_min_price_cents';

-- VERIFY: il ne doit plus rester aucune clé `lastminute_*`
SELECT COUNT(*) AS remaining_old_keys
FROM businesses
WHERE settings ? 'lastminute_enabled'
   OR settings ? 'lastminute_discount_pct'
   OR settings ? 'lastminute_deadline'
   OR settings ? 'lastminute_min_price_cents';
