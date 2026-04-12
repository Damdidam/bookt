-- ============================================================
-- GENDA v35 — Quote Requests (Sur devis)
-- Add quote_only flag to services + quote request tables
-- ============================================================

-- 1. Add quote_only flag to services
ALTER TABLE services ADD COLUMN IF NOT EXISTS quote_only BOOLEAN DEFAULT false;

-- 2. Quote requests table
CREATE TABLE IF NOT EXISTS quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name VARCHAR(200),
  client_name VARCHAR(200) NOT NULL,
  client_email VARCHAR(200) NOT NULL,
  client_phone VARCHAR(30),
  description TEXT NOT NULL,
  body_zone VARCHAR(100),
  approx_size VARCHAR(100),
  status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'treated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_requests_business ON quote_requests(business_id, created_at DESC);

-- 3. Quote request images
CREATE TABLE IF NOT EXISTS quote_request_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id UUID NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  original_filename VARCHAR(255),
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_images_request ON quote_request_images(quote_request_id);
