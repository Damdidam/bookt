-- v76: Bloquants critiques du scan E2E 20 avril 2026.
-- Aligne le schéma versionné sur la réalité prod (jusqu'ici dérivée par auto-migrations
-- dans src/server.js) et corrige deux RLS policies cassées depuis v19.
--
-- I#1 — bookings.confirmation_expires_at : colonne référencée ~20 fois dans le code
--        (booking-confirmation, twilio webhook, bookings-time, bookings-creation,
--        booking-reschedule, booking-actions, calendar-data) mais aucune migration
--        versionnée ne la crée. En prod elle existe (sans doute via hotfix). On la
--        rend idempotente et on l'indexe pour les crons.
-- I#6 — users.role VARCHAR(10) trop court : v8-rbac a élargi le CHECK à
--        ('owner','manager','practitioner','receptionist'), mais pas la longueur
--        du type. 'practitioner' = 12 chars → value too long. v64-simplify-roles a
--        restreint au CHECK, même problème. On élargit à VARCHAR(20).
-- I#7 — RLS policies sur call_voicemails et call_blacklist utilisent
--        current_setting('app.business_id') au lieu de 'app.current_business_id'
--        (le reste du codebase). Les policies lèvent "unrecognized configuration
--        parameter" → retournent 0 ligne silencieusement. On les recrée.

-- ============================================================
-- I#1: confirmation_expires_at
-- ============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS confirmation_expires_at TIMESTAMPTZ;

-- Partial index matches the existing prod definition (status='pending' + NOT NULL).
-- The cron SELECT filters both clauses, so the predicate stays selective.
CREATE INDEX IF NOT EXISTS idx_bookings_confirmation_expires
  ON bookings(confirmation_expires_at)
  WHERE status = 'pending' AND confirmation_expires_at IS NOT NULL;

-- ============================================================
-- I#6: users.role VARCHAR(20)
-- ============================================================
-- Only widen if still VARCHAR(10); idempotent check via pg_catalog.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'role'
       AND character_maximum_length = 10
  ) THEN
    ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(20);
  END IF;
END $$;

-- ============================================================
-- I#7: RLS policies correctives v19
-- ============================================================
DROP POLICY IF EXISTS business_isolation ON call_voicemails;
CREATE POLICY business_isolation ON call_voicemails
  USING (business_id = current_setting('app.current_business_id', true)::uuid);

DROP POLICY IF EXISTS business_isolation ON call_blacklist;
CREATE POLICY business_isolation ON call_blacklist
  USING (business_id = current_setting('app.current_business_id', true)::uuid);
