-- v85: FIX RLS — custom_domains lookup public par domain
--
-- Contexte : server.js:184-200 resolve un host → business_id/slug AVANT de
-- pouvoir set `app.current_business_id` (c'est justement ce qu'il cherche à
-- déterminer). La policy `business_isolation` exige `current_setting` → le
-- SELECT retournait 0 rows silencieusement. Feature custom domain cassée
-- depuis sa création.
--
-- Fix : ajouter une policy permissive SELECT USING (true). En RLS Postgres,
-- les permissive policies sont OR'd, donc :
--   - SELECT : tout le monde peut lire (domain = info publique DNS de toute
--     façon)
--   - INSERT/UPDATE/DELETE : reste limité par business_isolation
--
-- Idempotent : DROP IF EXISTS + CREATE.

DROP POLICY IF EXISTS custom_domains_public_read ON custom_domains;

CREATE POLICY custom_domains_public_read ON custom_domains
  FOR SELECT
  USING (true);
