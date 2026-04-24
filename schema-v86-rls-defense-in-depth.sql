-- schema-v86 : RLS defense-in-depth sur 14 tables multi-tenant
--
-- Contexte : audit SQL 23 avril 2026 (agent Opus 4.7, scan E2E Phase 3).
-- 14 tables contenaient business_id mais AUCUNE policy RLS ni ENABLE ROW LEVEL SECURITY.
-- Le cloisonnement tenant reposait uniquement sur WHERE business_id = $1 ajouté
-- manuellement dans chaque query. Un oubli = leak cross-tenant immédiat.
--
-- Cette migration active RLS avec la policy business_isolation standard, identique
-- au pattern v76 (call_voicemails / call_blacklist) : USING app.current_business_id.
-- L'argument `true` (missing_ok=true) empêche "unrecognized configuration parameter"
-- si app.current_business_id n'est pas posé (webhooks Stripe/Twilio/Brevo passent
-- par pool.query direct sans set_config).
--
-- Toutes les tables existantes continuent de fonctionner car la plupart des call
-- sites staff utilisent déjà queryWithRLS(businessId, ...) qui set_config en tx.
-- Pour les webhooks (pool.query direct), la policy n'affecte PAS car le role
-- Render (superuser) bypass RLS.
--
-- Idempotent via DO blocks ($$).

DO $$
DECLARE
  _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY[
    'passes', 'pass_templates', 'pass_transactions',
    'gift_cards', 'gift_card_transactions',
    'promotions', 'reviews', 'news_posts',
    'quote_requests', 'quote_request_images',
    'internal_tasks', 'magic_links', 'sms_usage', 'gallery_images'
  ]
  LOOP
    -- Skip if table doesn't exist yet (forward-compat)
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = _tbl AND schemaname = 'public') THEN
      RAISE NOTICE 'Skipping % : table not found', _tbl;
      CONTINUE;
    END IF;

    -- Skip if table has no business_id column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = _tbl AND column_name = 'business_id') THEN
      RAISE NOTICE 'Skipping % : no business_id column', _tbl;
      CONTINUE;
    END IF;

    -- Enable RLS (idempotent)
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', _tbl);

    -- Drop existing policy if any (clean slate)
    EXECUTE format('DROP POLICY IF EXISTS business_isolation ON %I', _tbl);

    -- Create policy : match app.current_business_id (with true for missing_ok)
    EXECUTE format(
      'CREATE POLICY business_isolation ON %I
         USING (business_id = current_setting(''app.current_business_id'', true)::uuid)',
      _tbl
    );

    RAISE NOTICE 'RLS enabled + business_isolation policy created on %', _tbl;
  END LOOP;
END$$;

-- Verification query (run separately after migration) :
-- SELECT tablename,
--        relrowsecurity AS rls_enabled,
--        (SELECT string_agg(polname, ',') FROM pg_policy WHERE polrelid = c.oid) AS policies
-- FROM pg_class c JOIN pg_tables t ON t.tablename = c.relname
-- WHERE tablename IN ('passes','pass_templates','pass_transactions','gift_cards',
--                     'gift_card_transactions','promotions','reviews','news_posts',
--                     'quote_requests','quote_request_images','internal_tasks',
--                     'magic_links','sms_usage','gallery_images');
