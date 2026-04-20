-- v81: P0-01 — EXCLUDE constraint pour empêcher double-booking same practitioner
--
-- CONTEXTE BUG :
-- Avant : `checkBookingConflicts` utilisait un SELECT ... FOR UPDATE OF b avec
-- lock par (practitioner_id, start_at). Cette stratégie ne couvre PAS les
-- chevauchements DÉCALÉS :
--   TX1 INSERT booking 10:00-10:30 (acquiert lock P_pracId_10:00)
--   TX2 INSERT booking 10:15-10:45 (acquiert lock P_pracId_10:15, DIFFÉRENT)
--   → aucune des 2 ne voit l'autre car READ COMMITTED + FOR UPDATE sur 0 rows
--   → les 2 commits → 2 bookings chevauchants → double-booking visible client
--
-- FIX : EXCLUDE USING gist — contrainte DB-level qui refuse tout INSERT/UPDATE
-- créant un chevauchement sur (practitioner_id, tstzrange(start_at, end_at))
-- pour les statuts ACTIFS. Impossible à bypass même avec race parfaite.
--
-- Prérequis :
-- - Extension btree_gist (dispo Render PostgreSQL 15+, vérifié avec
--   SELECT * FROM pg_available_extensions)
-- - Aucun chevauchement pré-existant sur prod (vérifié : 0 rows)
--
-- Les statuts ACTIFS couverts (= ceux qui occupent un créneau) :
--   'pending' : nouvelle résa en attente de confirmation
--   'confirmed' : RDV validé
--   'modified_pending' : modif proposée par staff, attente client
--   'pending_deposit' : attente paiement acompte
-- Non inclus : 'cancelled', 'completed', 'no_show' = créneau libéré.
--
-- DEFERRABLE INITIALLY IMMEDIATE : permet de SET CONSTRAINTS DEFERRED
-- dans une tx quand on fait un reschedule en masse (évite conflit temporaire
-- pendant UPDATE en série).
--
-- Idempotence : CREATE EXTENSION IF NOT EXISTS + DO block pour créer
-- la CONSTRAINT uniquement si absente (idempotent sur ré-exécution).

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_no_overlap_active'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlap_active
      EXCLUDE USING gist (
        practitioner_id WITH =,
        tstzrange(start_at, end_at, '[)') WITH &&
      )
      WHERE (status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit'))
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
