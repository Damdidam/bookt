-- schema-v53-promotions.sql
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  condition_type VARCHAR(20) NOT NULL DEFAULT 'none'
    CHECK (condition_type IN ('min_amount', 'specific_service', 'first_visit', 'date_range', 'none')),
  condition_min_cents INT,
  condition_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  condition_start_date DATE,
  condition_end_date DATE,
  reward_type VARCHAR(20) NOT NULL
    CHECK (reward_type IN ('free_service', 'discount_pct', 'discount_fixed', 'info_only')),
  reward_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  reward_value INT,
  display_style VARCHAR(10) NOT NULL DEFAULT 'cards'
    CHECK (display_style IN ('cards', 'banner')),
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_business ON promotions(business_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_promotions_condition_svc ON promotions(condition_service_id) WHERE condition_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_reward_svc ON promotions(reward_service_id) WHERE reward_service_id IS NOT NULL;
