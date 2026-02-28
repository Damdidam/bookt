-- =============================================
-- SCHEMA v17 — Mini-site: Gallery + News
-- =============================================

-- 1. Gallery images
CREATE TABLE IF NOT EXISTS gallery_images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title         TEXT,
  caption       TEXT,
  image_url     TEXT NOT NULL,
  sort_order    INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gallery_biz ON gallery_images(business_id, sort_order);

-- 2. News posts (simple actus, not a CMS)
CREATE TABLE IF NOT EXISTS news_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  tag           TEXT,           -- e.g. "Nouveau", "Info pratique", "Réglementation"
  tag_type      TEXT DEFAULT 'info', -- info, alert, new, promo
  image_url     TEXT,
  published_at  DATE DEFAULT CURRENT_DATE,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_news_biz ON news_posts(business_id, published_at DESC);

-- 3. Add google_reviews_url to businesses (for post-RDV SMS link)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS google_reviews_url TEXT;

-- Done
SELECT 'schema-v17 applied' AS status;
