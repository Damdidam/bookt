-- v59: Gift cards
CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code VARCHAR(12) UNIQUE NOT NULL,
  amount_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  buyer_name VARCHAR(200),
  buyer_email VARCHAR(200),
  recipient_name VARCHAR(200),
  recipient_email VARCHAR(200),
  message TEXT,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','used','expired','cancelled')),
  stripe_payment_intent_id VARCHAR(100),
  expires_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gift_card_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id UUID NOT NULL REFERENCES gift_cards(id),
  business_id UUID NOT NULL,
  booking_id UUID REFERENCES bookings(id),
  amount_cents INTEGER NOT NULL,
  type VARCHAR(20) CHECK (type IN ('purchase','debit','refund')),
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gc_business ON gift_cards(business_id);
CREATE INDEX IF NOT EXISTS idx_gc_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gc_status ON gift_cards(business_id, status);
CREATE INDEX IF NOT EXISTS idx_gct_card ON gift_card_transactions(gift_card_id);
