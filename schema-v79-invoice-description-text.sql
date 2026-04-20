-- v79: E#9 fix — invoice_items.description VARCHAR(300) → TEXT
--
-- Before: Postgres rejectait avec "value too long for type character varying(300)"
-- pour toute description invoice_item dépassant 300 chars. Cas réels :
--   - Label service = "Catégorie - Nom service — Variante (Last Minute -15%) (pass)"
--     déjà long (~80-120 chars selon verbosité du pro)
--   - + date FR verbose "lundi 20 avril 2026"
--   - + suffixes LM / pass / promo label construits par le pro (potentiellement longs)
--   - = dépassement possible sur labels pro-configured
--   Impact : INSERT invoices crashait avec 500 error pour le pro.
--
-- Fix: TEXT n'a pas de limite arbitraire. Validation raisonnable côté code
-- (aucune description sérieuse ne dépasse quelques KB).
--
-- Idempotent : vérifie le type actuel avant ALTER.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'invoice_items' AND column_name = 'description'
       AND character_maximum_length IS NOT NULL
  ) THEN
    ALTER TABLE invoice_items ALTER COLUMN description TYPE TEXT;
  END IF;
END $$;
