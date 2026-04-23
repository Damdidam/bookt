-- v86: Peppol integration — subscription invoices archive + platform settings
--
-- Contexte : obligation BE e-invoicing B2B via Peppol (UBL 2.1 BIS 3.0) depuis
-- janv 2026. Genda émet une facture/mois/commerçant PRO via Stripe. On ajoute
-- (a) une table archivant chaque invoice envoyée + son UBL XML (obligation 7 ans)
-- (b) une table singleton avec les infos émetteur Genda (H3001 SRL).
--
-- Idempotent (CREATE IF NOT EXISTS + ON CONFLICT DO UPDATE sur seed).
--
-- Note RGPD/Archive : business_id = RESTRICT (pas CASCADE) car on doit pouvoir
-- conserver les factures d'abo même si un business est hard-deleted (obligation
-- comptable BE 7 ans > RGPD Art.17 dans ce cas précis). Le hard-delete doit
-- soit anonymiser le business avant suppression, soit garder le row.

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  stripe_invoice_id     VARCHAR(120) UNIQUE NOT NULL,
  stripe_invoice_number VARCHAR(50),
  stripe_pdf_url        TEXT,
  period_start          TIMESTAMPTZ NOT NULL,
  period_end            TIMESTAMPTZ NOT NULL,
  amount_ht_cents       INTEGER NOT NULL,
  amount_vat_cents      INTEGER NOT NULL,
  amount_total_cents    INTEGER NOT NULL,
  vat_rate              NUMERIC(5,2) NOT NULL,
  currency              VARCHAR(3) NOT NULL DEFAULT 'EUR',
  recipient_name        VARCHAR(200) NOT NULL,
  recipient_vat         VARCHAR(20),
  recipient_address     TEXT,
  recipient_email       VARCHAR(200) NOT NULL,
  billit_invoice_id     VARCHAR(120),
  peppol_participant_id VARCHAR(120),
  ubl_xml               TEXT,
  status                VARCHAR(30) NOT NULL DEFAULT 'pending',
  status_detail         TEXT,
  retry_count           INTEGER NOT NULL DEFAULT 0,
  next_retry_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_invoices_business_created
  ON subscription_invoices(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_status_retry
  ON subscription_invoices(status, next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sub_invoices_status_updated_at
  ON subscription_invoices(status, updated_at) WHERE status = 'peppol_sent';

CREATE TABLE IF NOT EXISTS platform_settings (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name    VARCHAR(200) NOT NULL,
  vat_number      VARCHAR(20) NOT NULL,
  bce_number      VARCHAR(20) NOT NULL,
  address_street  VARCHAR(200) NOT NULL,
  address_zip     VARCHAR(20) NOT NULL,
  address_city    VARCHAR(100) NOT NULL,
  address_country VARCHAR(2) NOT NULL DEFAULT 'BE',
  contact_email   VARCHAR(200) NOT NULL,
  iban            VARCHAR(34),
  bic             VARCHAR(11),
  phone           VARCHAR(30),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (id, company_name, vat_number, bce_number,
  address_street, address_zip, address_city, address_country, contact_email)
VALUES (1, 'H3001 SRL', 'BE0775599330', '0775599330',
  '183 rue de la Montagne', '6110', 'Montigny Le Tilleul', 'BE', 'info@genda.be')
ON CONFLICT (id) DO UPDATE SET
  company_name    = EXCLUDED.company_name,
  vat_number      = EXCLUDED.vat_number,
  bce_number      = EXCLUDED.bce_number,
  address_street  = EXCLUDED.address_street,
  address_zip     = EXCLUDED.address_zip,
  address_city    = EXCLUDED.address_city,
  address_country = EXCLUDED.address_country,
  contact_email   = EXCLUDED.contact_email,
  updated_at      = NOW();
