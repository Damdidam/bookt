-- v53: Reviews system — client reviews after completed appointments
-- Clients receive an email after appointment, can rate (1-5 stars) + comment
-- Owner can reply publicly to each review
--
-- I#4 fix: types alignés sur la réalité prod (UUID) — le fichier originel
-- utilisait INTEGER sur les FK businesses/bookings/clients/practitioners,
-- incompatible avec le schéma prod (toutes ces tables sont en UUID). Toute DB
-- fraîche créée depuis `psql -f schema-v53-reviews.sql` échouait avec
-- "foreign key constraint cannot be implemented — Key columns are of
-- incompatible types: integer and uuid".

CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES bookings(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  practitioner_id UUID REFERENCES practitioners(id) ON DELETE SET NULL,

  -- Review content
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         TEXT DEFAULT '',

  -- Owner reply
  owner_reply     TEXT DEFAULT NULL,
  owner_reply_at  TIMESTAMPTZ DEFAULT NULL,

  -- Token for public access (review submission page)
  token           VARCHAR(255),

  -- Status
  status          VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'flagged', 'hidden')),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One review per booking — évite race SELECT-puis-INSERT (misc.js:83-95)
  CONSTRAINT uq_reviews_booking UNIQUE (booking_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reviews_business ON reviews(business_id);
CREATE INDEX IF NOT EXISTS idx_reviews_token ON reviews(token);
CREATE INDEX IF NOT EXISTS idx_reviews_client ON reviews(client_id);
CREATE INDEX IF NOT EXISTS idx_reviews_practitioner ON reviews(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking ON reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(business_id, status);

-- Add review_token column to bookings (generated when review email is sent)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_token VARCHAR(40) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_bookings_review_token ON bookings(review_token);

-- Notifications type constraint is managed by later migrations + auto-migrate
-- in src/server.js — pas de redéfinition ici (évite collision avec v62/v68/v69
-- qui l'ont réécrite plusieurs fois).
