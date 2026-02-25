-- ============================================================
-- BOOKT v0.7 — WAITLIST (Liste d'attente)
-- ============================================================

-- 1. Add waitlist_mode to practitioners
ALTER TABLE practitioners
  ADD COLUMN IF NOT EXISTS waitlist_mode varchar(10) DEFAULT 'off'
  CONSTRAINT practitioners_waitlist_mode_check
  CHECK (waitlist_mode IN ('off', 'manual', 'auto'));

-- 2. Waitlist entries table
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id uuid NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  client_name varchar(200) NOT NULL,
  client_email varchar(200) NOT NULL,
  client_phone varchar(30),
  preferred_days jsonb DEFAULT '[0,1,2,3,4]',
  preferred_time varchar(15) DEFAULT 'any',
  note varchar(300),
  status varchar(15) DEFAULT 'waiting',
  priority integer NOT NULL DEFAULT 0,
  -- Offer fields (for auto mode)
  offer_token varchar(64) UNIQUE,
  offer_booking_start timestamptz,
  offer_booking_end timestamptz,
  offer_sent_at timestamptz,
  offer_expires_at timestamptz,
  offer_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  -- Tracking
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT waitlist_entries_status_check
    CHECK (status IN ('waiting', 'offered', 'booked', 'expired', 'cancelled', 'declined')),
  CONSTRAINT waitlist_entries_preferred_time_check
    CHECK (preferred_time IN ('any', 'morning', 'afternoon'))
);

ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_business ON waitlist_entries (business_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_practitioner ON waitlist_entries (practitioner_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_waitlist_token ON waitlist_entries (offer_token);
CREATE INDEX IF NOT EXISTS idx_waitlist_service ON waitlist_entries (service_id);

-- Auto-increment priority per practitioner+service
-- (use a sequence-like approach via max+1 in the INSERT)

-- ============================================================
-- VERIFY
-- ============================================================
SELECT 'waitlist_entries' AS table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'waitlist_entries') AS exists;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'practitioners' AND column_name = 'waitlist_mode';
