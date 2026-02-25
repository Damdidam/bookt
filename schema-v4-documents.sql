-- ============================================================
-- DOCUMENT TEMPLATES & PRE-RDV RESPONSES
-- Emails J-2 with info sheets and intake forms per service
-- ============================================================

CREATE TABLE IF NOT EXISTS document_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id      UUID REFERENCES services(id) ON DELETE SET NULL, -- NULL = applies to all services

  -- Template info
  name            VARCHAR(200) NOT NULL,                 -- "Fiche info première consultation"
  type            VARCHAR(15) DEFAULT 'info'             -- 'info' | 'form' | 'consent'
    CHECK (type IN ('info', 'form', 'consent')),
  
  -- Content
  subject         VARCHAR(200),                          -- Email subject override
  content_html    TEXT NOT NULL,                          -- Rich HTML content (info sheets)
  
  -- Form fields (JSON array for type='form' or 'consent')
  -- Each field: { id, label, type: 'text'|'textarea'|'checkbox'|'select'|'date', required, options }
  form_fields     JSONB DEFAULT '[]'::jsonb,

  -- Settings
  send_days_before INTEGER DEFAULT 2,                    -- Days before appointment to send
  is_active       BOOLEAN DEFAULT true,
  sort_order      INTEGER DEFAULT 0,
  language        VARCHAR(2) DEFAULT 'fr',

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_doc_templates_business ON document_templates(business_id);
CREATE INDEX idx_doc_templates_service ON document_templates(service_id);

-- Track what was sent and client responses
CREATE TABLE IF NOT EXISTS pre_rdv_sends (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,

  -- Send tracking
  sent_at         TIMESTAMPTZ,
  email_to        VARCHAR(200),
  token           VARCHAR(64) NOT NULL UNIQUE,            -- Secure access token

  -- Response (for forms/consent)
  response_data   JSONB,                                  -- Client's form answers
  responded_at    TIMESTAMPTZ,
  consent_given   BOOLEAN,                                -- For consent type

  -- Status
  status          VARCHAR(15) DEFAULT 'pending'           -- 'pending' | 'sent' | 'viewed' | 'completed' | 'failed'
    CHECK (status IN ('pending', 'sent', 'viewed', 'completed', 'failed')),

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pre_rdv_sends_booking ON pre_rdv_sends(booking_id);
CREATE INDEX idx_pre_rdv_sends_token ON pre_rdv_sends(token);
CREATE INDEX idx_pre_rdv_sends_status ON pre_rdv_sends(business_id, status);

-- RLS
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_rdv_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_isolation_doc_templates ON document_templates
  USING (business_id = current_setting('app.current_business_id')::uuid);
CREATE POLICY business_isolation_pre_rdv ON pre_rdv_sends
  USING (business_id = current_setting('app.current_business_id')::uuid);
