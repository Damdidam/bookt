-- v53: Reviews system — client reviews after completed appointments
-- Clients receive an email after appointment, can rate (1-5 stars) + comment
-- Owner can reply publicly to each review

CREATE TABLE IF NOT EXISTS reviews (
  id              SERIAL PRIMARY KEY,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id      INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  practitioner_id INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,

  -- Review content
  rating          SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT DEFAULT '',

  -- Owner reply
  owner_reply     TEXT DEFAULT NULL,
  owner_reply_at  TIMESTAMPTZ DEFAULT NULL,

  -- Token for public access (review submission page)
  token           VARCHAR(40) NOT NULL UNIQUE,

  -- Status
  status          VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'flagged', 'hidden')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One review per booking
  CONSTRAINT uq_reviews_booking UNIQUE (booking_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reviews_business ON reviews(business_id);
CREATE INDEX IF NOT EXISTS idx_reviews_token ON reviews(token);
CREATE INDEX IF NOT EXISTS idx_reviews_client ON reviews(client_id);
CREATE INDEX IF NOT EXISTS idx_reviews_practitioner ON reviews(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(business_id, status);

-- Add review_token column to bookings (generated when review email is sent)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_token VARCHAR(40) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_bookings_review_token ON bookings(review_token);

-- Update notifications type constraint to include review emails
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'email_confirmation','sms_confirmation',
    'email_reminder_24h','sms_reminder_24h','sms_reminder_2h',
    'email_cancellation','sms_cancellation',
    'email_cancellation_pro',
    'call_filter_sms','email_post_rdv','email_new_booking_pro',
    'email_deposit_request','sms_deposit_request',
    'email_deposit_confirmed','email_deposit_cancelled',
    'deposit_paid_webhook',
    'email_waitlist_offer','waitlist_match',
    'email_modification_rejected',
    'email_confirmation_request',
    'email_review_request'
  ));
