-- v16: Whiteboards — drawable canvas per client/booking
-- Supports image annotation, text layers, GDPR-compliant secure sharing

CREATE TABLE IF NOT EXISTS whiteboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID REFERENCES practitioners(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,

  -- Content
  title VARCHAR(200) DEFAULT 'Whiteboard',
  canvas_data TEXT,                   -- Base64 PNG of the canvas
  text_layers JSONB DEFAULT '[]',     -- Array of {id, x, y, value, color, fontSize, fontWeight}
  bg_image_url TEXT,                  -- If an image was imported (stored as base64 or URL)
  bg_type VARCHAR(10) DEFAULT 'blank', -- blank, grid, lined, dots

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- GDPR
  consent_confirmed BOOLEAN DEFAULT false,
  retention_months INT DEFAULT 12,
  expires_at TIMESTAMPTZ,           -- auto-set = created_at + retention_months
  deleted_at TIMESTAMPTZ            -- soft delete for GDPR
);

-- Secure sharing links (GDPR: no email attachment, link with expiration)
CREATE TABLE IF NOT EXISTS whiteboard_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whiteboard_id UUID NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accessed_count INT DEFAULT 0,
  max_accesses INT DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wb_business ON whiteboards (business_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wb_client ON whiteboards (client_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wb_booking ON whiteboards (booking_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wb_expires ON whiteboards (expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wb_link_token ON whiteboard_links (token);

-- Auto-set expires_at on insert
CREATE OR REPLACE FUNCTION set_wb_expiry() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NEW.created_at + (COALESCE(NEW.retention_months, 12) || ' months')::interval;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wb_expiry ON whiteboards;
CREATE TRIGGER trg_wb_expiry BEFORE INSERT ON whiteboards
  FOR EACH ROW EXECUTE FUNCTION set_wb_expiry();
