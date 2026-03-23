-- v60: Passes / Packs de séances

CREATE TABLE IF NOT EXISTS pass_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  sessions_count INTEGER NOT NULL CHECK (sessions_count > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  validity_days INTEGER DEFAULT 365,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  pass_template_id UUID REFERENCES pass_templates(id),
  service_id UUID NOT NULL REFERENCES services(id),
  code VARCHAR(12) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  sessions_total INTEGER NOT NULL,
  sessions_remaining INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  buyer_name VARCHAR(200),
  buyer_email VARCHAR(200),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','used','expired','cancelled')),
  stripe_payment_intent_id VARCHAR(100),
  expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pass_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id UUID NOT NULL REFERENCES passes(id),
  business_id UUID NOT NULL,
  booking_id UUID REFERENCES bookings(id),
  sessions INTEGER NOT NULL DEFAULT 1,
  type VARCHAR(20) CHECK (type IN ('purchase','debit','refund')),
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pt_business ON pass_templates(business_id);
CREATE INDEX IF NOT EXISTS idx_pt_service ON pass_templates(business_id, service_id);
CREATE INDEX IF NOT EXISTS idx_pass_business ON passes(business_id);
CREATE INDEX IF NOT EXISTS idx_pass_code ON passes(code);
CREATE INDEX IF NOT EXISTS idx_pass_status ON passes(business_id, status);
CREATE INDEX IF NOT EXISTS idx_pass_email ON passes(buyer_email, business_id);
CREATE INDEX IF NOT EXISTS idx_pass_service ON passes(service_id, business_id);
CREATE INDEX IF NOT EXISTS idx_ptx_pass ON pass_transactions(pass_id);
CREATE INDEX IF NOT EXISTS idx_ptx_booking ON pass_transactions(booking_id);
