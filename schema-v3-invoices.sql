-- ============================================================
-- INVOICES & INVOICE ITEMS
-- Belgian-compliant invoicing: TVA, BCE, structured communication
-- ============================================================

CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,

  -- Invoice identity
  invoice_number  VARCHAR(30) NOT NULL,                  -- "F-2026-0001"
  type            VARCHAR(10) DEFAULT 'invoice'          -- 'invoice' | 'quote' | 'credit_note'
    CHECK (type IN ('invoice', 'quote', 'credit_note')),
  status          VARCHAR(15) DEFAULT 'draft'            -- 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
    CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),

  -- Dates
  issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  paid_date       DATE,

  -- Client snapshot (frozen at invoice time)
  client_name     VARCHAR(200) NOT NULL,
  client_email    VARCHAR(200),
  client_phone    VARCHAR(30),
  client_address  TEXT,
  client_bce      VARCHAR(30),                           -- BCE/TVA number

  -- Business snapshot
  business_name   VARCHAR(200) NOT NULL,
  business_address TEXT,
  business_bce    VARCHAR(30),
  business_iban   VARCHAR(40),
  business_bic    VARCHAR(15),

  -- Amounts (in cents)
  subtotal_cents  INTEGER DEFAULT 0,
  vat_amount_cents INTEGER DEFAULT 0,
  total_cents     INTEGER DEFAULT 0,
  vat_rate        NUMERIC(5,2) DEFAULT 21.00,            -- 21%, 6%, or 0%

  -- Payment
  payment_method  VARCHAR(20),                           -- 'virement' | 'bancontact' | 'cash' | 'carte'
  structured_comm VARCHAR(20),                           -- +++XXX/XXXX/XXXXX+++ Belgian format

  -- Metadata
  notes           TEXT,                                  -- Free text on invoice
  footer_text     TEXT,                                  -- Legal footer
  language        VARCHAR(2) DEFAULT 'fr',               -- 'fr' | 'nl'
  pdf_url         VARCHAR(500),                          -- Stored PDF path

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(business_id, invoice_number)
);

CREATE INDEX idx_invoices_business ON invoices(business_id, issue_date DESC);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_booking ON invoices(booking_id);
CREATE INDEX idx_invoices_status ON invoices(business_id, status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id      UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description     VARCHAR(300) NOT NULL,
  quantity        NUMERIC(10,2) DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,                     -- Price per unit in cents
  vat_rate        NUMERIC(5,2) DEFAULT 21.00,
  total_cents     INTEGER NOT NULL,                      -- quantity * unit_price
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoice_items ON invoice_items(invoice_id);

-- RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_isolation ON invoices
  USING (business_id = current_setting('app.current_business_id')::uuid);
CREATE POLICY invoice_items_isolation ON invoice_items
  USING (invoice_id IN (SELECT id FROM invoices WHERE business_id = current_setting('app.current_business_id')::uuid));
