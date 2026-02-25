-- ============================================================
-- GENDA MVP v1 — PostgreSQL Schema
-- Vertical: Comptables (Belgique)
-- Derived from UI wireframes (client flow + dashboard pro)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. BUSINESSES (tenants)
-- UI: Settings > Cabinet, Onboarding step 1, Client flow hero
-- ============================================================
CREATE TABLE businesses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug          VARCHAR(80) UNIQUE NOT NULL,          -- URL: genda.be/{slug}
  name          VARCHAR(200) NOT NULL,                 -- "De Wit & Associés"
  phone         VARCHAR(30),                           -- Téléphone affiché
  email         VARCHAR(200),                          -- Email de contact
  address       TEXT,                                  -- Adresse complète
  language_default VARCHAR(2) DEFAULT 'fr'             -- 'fr' | 'nl'
    CHECK (language_default IN ('fr', 'nl')),
  timezone      VARCHAR(50) DEFAULT 'Europe/Brussels',
  plan          VARCHAR(10) DEFAULT 'free'             -- 'free' | 'pro' | 'team'
    CHECK (plan IN ('free', 'pro', 'team')),
  is_active     BOOLEAN DEFAULT true,

  -- Settings JSONB (UI: Settings > Politique annulation, Notifications, Branding)
  -- Avoids separate settings table, faster to iterate at MVP
  settings      JSONB DEFAULT '{
    "cancellation_window_hours": 24,
    "cancellation_fee_percent": 50,
    "noshow_policy": "charge",
    "slot_granularity_min": 15,
    "booking_horizon_days": 60,
    "brand_badge_1": "",
    "brand_badge_2": "",
    "description_short": ""
  }'::jsonb,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_businesses_slug ON businesses(slug);
CREATE INDEX idx_businesses_active ON businesses(is_active) WHERE is_active = true;

-- ============================================================
-- 2. USERS (staff / owners who access dashboard)
-- UI: Sidebar footer (Pierre De Wit · Owner), Login, Onboarding
-- ============================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email         VARCHAR(200) NOT NULL,
  password_hash VARCHAR(200),                          -- NULL if magic link only
  role          VARCHAR(10) DEFAULT 'owner'            -- 'owner' | 'staff'
    CHECK (role IN ('owner', 'staff')),
  is_active     BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(business_id, email)
);

CREATE INDEX idx_users_business ON users(business_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- 3. PRACTITIONERS (bookable people)
-- UI: Client flow screen 2 (Pierre De Wit, Sophie Laurent)
--     Agenda columns, Dashboard "Bonjour Pierre"
-- ============================================================
CREATE TABLE practitioners (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,  -- Link to login (optional)
  display_name    VARCHAR(100) NOT NULL,               -- "Pierre De Wit"
  title           VARCHAR(200),                        -- "Fiscalité · Sociétés · 16 ans exp."
  color           VARCHAR(7) DEFAULT '#0D7377',        -- Hex color for agenda blocks
  is_active       BOOLEAN DEFAULT true,
  booking_enabled BOOLEAN DEFAULT true,                -- Can receive bookings
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_practitioners_business ON practitioners(business_id);

-- ============================================================
-- 4. SERVICES (types de RDV)
-- UI: Client flow screen 1 (Déclaration IPP, Consultation TVA...)
--     Dashboard > Prestations page
-- ============================================================
CREATE TABLE services (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name                VARCHAR(200) NOT NULL,            -- "Déclaration IPP (indépendant)"
  category            VARCHAR(50),                      -- 'ipp', 'tva', 'societe', 'creation', 'suivi'
  duration_min        INTEGER NOT NULL DEFAULT 30,      -- Durée en minutes
  buffer_before_min   INTEGER DEFAULT 0,                -- Buffer avant (prep)
  buffer_after_min    INTEGER DEFAULT 0,                -- Buffer après (nettoyage/notes)
  price_cents         INTEGER,                          -- Prix en centimes (12000 = 120€), NULL = gratuit
  price_label         VARCHAR(50),                      -- Affichage custom: "Gratuit", "Sur devis"
  mode_options        JSONB DEFAULT '["cabinet"]'::jsonb, -- ["cabinet","visio","phone"]
  prep_instructions_fr TEXT,                            -- "Apportez vos fiches 281.10..."
  prep_instructions_nl TEXT,                            -- NL version
  is_active           BOOLEAN DEFAULT true,
  sort_order          INTEGER DEFAULT 0,
  color               VARCHAR(7),                       -- Dot color in service list
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_services_business ON services(business_id);
CREATE INDEX idx_services_active ON services(business_id, is_active) WHERE is_active = true;

-- ============================================================
-- 5. PRACTITIONER_SERVICES (who can do what)
-- UI: Client flow screen 2 — only show practitioners competent
--     for the selected service
-- ============================================================
CREATE TABLE practitioner_services (
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (practitioner_id, service_id)
);

CREATE INDEX idx_ps_service ON practitioner_services(service_id);

-- ============================================================
-- 6. AVAILABILITIES (horaires hebdo)
-- UI: Dashboard > Disponibilités grid (Lundi 09:00-12:00, 13:00-17:00)
-- ============================================================
CREATE TABLE availabilities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  weekday         SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Lundi, 6=Dimanche
  start_time      TIME NOT NULL,                       -- 09:00
  end_time        TIME NOT NULL,                       -- 12:00
  is_active       BOOLEAN DEFAULT true,

  CHECK (end_time > start_time)
);

CREATE INDEX idx_avail_lookup ON availabilities(business_id, practitioner_id, weekday);

-- ============================================================
-- 7. AVAILABILITY_EXCEPTIONS (congés, jours spéciaux)
-- UI: Dashboard > Disponibilités > "Exceptions à venir"
--     (Congé Pierre De Wit — 7-14 mars)
-- ============================================================
CREATE TABLE availability_exceptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  type            VARCHAR(20) DEFAULT 'closed'         -- 'closed' | 'custom_hours'
    CHECK (type IN ('closed', 'custom_hours')),
  start_time      TIME,                                -- NULL if closed, set if custom_hours
  end_time        TIME,                                -- NULL if closed, set if custom_hours
  note            VARCHAR(200),                        -- "Congé annuel"
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_exceptions_lookup ON availability_exceptions(business_id, practitioner_id, date);

-- ============================================================
-- 8. CLIENTS (people who book)
-- UI: Client flow screen 4 (Jean Dupont, +32 470...)
--     Dashboard > Clients table
-- ============================================================
CREATE TABLE clients (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  full_name           VARCHAR(200) NOT NULL,            -- "Jean Dupont" or "SPRL Dupont"
  phone               VARCHAR(30),                      -- E.164 format
  email               VARCHAR(200),
  language_preference VARCHAR(7) DEFAULT 'unknown'      -- 'fr' | 'nl' | 'unknown'
    CHECK (language_preference IN ('fr', 'nl', 'unknown')),
  bce_number          VARCHAR(20),                      -- N° entreprise (template comptable)
  consent_sms         BOOLEAN DEFAULT false,
  consent_email       BOOLEAN DEFAULT true,
  consent_marketing   BOOLEAN DEFAULT false,            -- Communications du cabinet
  created_from        VARCHAR(10) DEFAULT 'booking'     -- 'booking' | 'manual' | 'call'
    CHECK (created_from IN ('booking', 'manual', 'call')),
  notes               TEXT,                             -- Notes privées du pro
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_business ON clients(business_id);
CREATE INDEX idx_clients_phone ON clients(business_id, phone);
CREATE INDEX idx_clients_email ON clients(business_id, email);
CREATE INDEX idx_clients_name ON clients(business_id, full_name);

-- ============================================================
-- 9. BOOKINGS (the core)
-- UI: Agenda blocks, Dashboard today list, Client flow confirmation
-- ============================================================
CREATE TABLE bookings (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id             UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id         UUID NOT NULL REFERENCES practitioners(id),
  service_id              UUID NOT NULL REFERENCES services(id),
  client_id               UUID NOT NULL REFERENCES clients(id),
  channel                 VARCHAR(10) DEFAULT 'web'     -- 'web' | 'phone' | 'manual'
    CHECK (channel IN ('web', 'phone', 'manual')),
  appointment_mode        VARCHAR(10) DEFAULT 'cabinet'  -- 'cabinet' | 'visio' | 'phone'
    CHECK (appointment_mode IN ('cabinet', 'visio', 'phone')),
  start_at                TIMESTAMPTZ NOT NULL,
  end_at                  TIMESTAMPTZ NOT NULL,
  status                  VARCHAR(12) DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  cancel_reason           TEXT,
  comment_client          VARCHAR(500),                  -- "Objet du RDV" (textarea)
  reschedule_of_booking_id UUID REFERENCES bookings(id), -- If rescheduled from another
  public_token            VARCHAR(40) UNIQUE NOT NULL    -- For cancel/reschedule links
    DEFAULT encode(gen_random_bytes(20), 'hex'),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),

  CHECK (end_at > start_at)
);

-- Critical index for slot calculation: find conflicts fast
CREATE INDEX idx_bookings_slots ON bookings(business_id, practitioner_id, start_at, end_at)
  WHERE status IN ('pending', 'confirmed');

-- For public token lookup (cancel/reschedule links)
CREATE INDEX idx_bookings_token ON bookings(public_token);

-- For dashboard: today's bookings
CREATE INDEX idx_bookings_day ON bookings(business_id, start_at, status);

-- For client history
CREATE INDEX idx_bookings_client ON bookings(client_id, start_at);

-- ============================================================
-- 10. NOTIFICATIONS
-- UI: Settings > Notifications toggles
--     Confirmation email, rappel SMS, etc.
-- ============================================================
CREATE TABLE notifications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id          UUID REFERENCES bookings(id) ON DELETE SET NULL,
  type                VARCHAR(30) NOT NULL
    CHECK (type IN (
      'email_confirmation',
      'sms_confirmation',
      'email_reminder_24h',
      'sms_reminder_24h',
      'sms_reminder_2h',
      'email_cancellation',
      'sms_cancellation',
      'call_filter_sms',
      'email_post_rdv',
      'email_new_booking_pro'
    )),
  recipient_phone     VARCHAR(30),
  recipient_email     VARCHAR(200),
  status              VARCHAR(10) DEFAULT 'queued'       -- 'queued' | 'sent' | 'failed'
    CHECK (status IN ('queued', 'sent', 'failed')),
  provider            VARCHAR(20),                       -- 'brevo' | 'twilio'
  provider_message_id VARCHAR(200),
  error               TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifs_business ON notifications(business_id, created_at);
CREATE INDEX idx_notifs_booking ON notifications(booking_id);
CREATE INDEX idx_notifs_queued ON notifications(status) WHERE status = 'queued';

-- ============================================================
-- 11. CALL_SETTINGS (module téléphone config)
-- UI: Settings > Filtre d'appels, Onboarding step 5
-- ============================================================
CREATE TABLE call_settings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id           UUID UNIQUE NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  twilio_number         VARCHAR(30),                     -- "+32 2 123 45 67"
  twilio_number_sid     VARCHAR(50),                     -- Twilio SID for API calls
  filter_mode           VARCHAR(20) DEFAULT 'off'        -- 'off' | 'soft' | 'strict' | 'schedule_based'
    CHECK (filter_mode IN ('off', 'soft', 'strict', 'schedule_based')),
  forward_default_phone VARCHAR(30),                     -- Real phone to transfer VIP/urgent calls
  allow_keypress_urgent BOOLEAN DEFAULT true,             -- "Tapez 1" enabled
  urgent_target_phone   VARCHAR(30),                     -- Where "tapez 1" calls go
  voicemail_enabled     BOOLEAN DEFAULT false,
  sms_after_call        BOOLEAN DEFAULT true,             -- Auto SMS with booking link
  voicemail_text_fr     TEXT,                             -- Custom message FR
  voicemail_text_nl     TEXT,                             -- Custom message NL
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. CALL_WHITELIST (VIP contacts)
-- UI: Settings > Filtre d'appels > "3 numéros configurés" > Gérer
-- ============================================================
CREATE TABLE call_whitelist (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_e164    VARCHAR(30) NOT NULL,                    -- "+32 2 345 67 89"
  label         VARCHAR(100),                            -- "SPRL Dupont — urgent"
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whitelist_lookup ON call_whitelist(business_id, phone_e164)
  WHERE is_active = true;

-- ============================================================
-- 13. CALL_LOGS (appels filtrés)
-- UI: Dashboard > Appels (table: date, numéro, action, résultat, durée)
--     Dashboard home stat "Appels → RDV: 78%"
-- ============================================================
CREATE TABLE call_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_sid      VARCHAR(50),                             -- Twilio Call SID
  from_phone    VARCHAR(30),                             -- Caller (masked in UI: +32 470 *** 56)
  to_phone      VARCHAR(30),                             -- Business virtual number
  action        VARCHAR(20) NOT NULL
    CHECK (action IN (
      'whitelist_pass',
      'played_message',
      'forwarded',
      'sent_sms',
      'urgent_key',
      'voicemail',
      'hung_up'
    )),
  result        VARCHAR(20) DEFAULT 'ok'                 -- 'ok' | 'failed' | 'no_answer'
    CHECK (result IN ('ok', 'failed', 'no_answer')),
  duration_sec  INTEGER DEFAULT 0,
  booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL, -- If call led to booking
  metadata      JSONB,                                   -- Extra Twilio data
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calllogs_business ON call_logs(business_id, created_at DESC);
CREATE INDEX idx_calllogs_conversion ON call_logs(business_id, action, booking_id)
  WHERE action = 'sent_sms';

-- ============================================================
-- 14. AUDIT_LOGS (who changed what)
-- UI: Not directly visible, but powers undo/history
-- ============================================================
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system action
  entity_type   VARCHAR(30) NOT NULL,                    -- 'booking', 'service', 'availability'
  entity_id     UUID,
  action        VARCHAR(20) NOT NULL,                    -- 'create', 'update', 'delete', 'status_change'
  old_data      JSONB,
  new_data      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_business ON audit_logs(business_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- ============================================================
-- 15. MAGIC_LINKS (passwordless auth)
-- UI: Login screen, decision = magic link
-- ============================================================
CREATE TABLE magic_links (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         VARCHAR(64) UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_magic_token ON magic_links(token) WHERE used_at IS NULL;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Every query automatically scoped to the business
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE practitioners ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE practitioner_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE availabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies use a session variable: SET app.current_business_id = '<uuid>';
-- Set this in middleware after auth

CREATE POLICY business_isolation ON users
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON practitioners
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON services
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON availabilities
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON availability_exceptions
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON clients
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON bookings
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON notifications
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON call_settings
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON call_whitelist
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON call_logs
  USING (business_id = current_setting('app.current_business_id')::uuid);

CREATE POLICY business_isolation ON audit_logs
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- Public access for booking pages (no RLS for public endpoints)
-- The public API uses a separate DB role without RLS or with specific policies

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_businesses_updated BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_practitioners_updated BEFORE UPDATE ON practitioners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_call_settings_updated BEFORE UPDATE ON call_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED DATA (demo: Cabinet De Wit & Associés)
-- Matches the UI wireframes exactly
-- ============================================================

-- Business
INSERT INTO businesses (id, slug, name, phone, email, address, plan, settings)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'cabinet-dewit',
  'De Wit & Associés',
  '+32 2 123 45 67',
  'contact@dewit-compta.be',
  'Avenue Louise 142, 1050 Bruxelles',
  'pro',
  '{
    "cancellation_window_hours": 24,
    "cancellation_fee_percent": 50,
    "noshow_policy": "charge",
    "slot_granularity_min": 15,
    "booking_horizon_days": 60,
    "brand_badge_1": "ITAA agréé",
    "brand_badge_2": "Depuis 2008",
    "description_short": "Cabinet comptable à Bruxelles"
  }'::jsonb
);

-- Users
INSERT INTO users (id, business_id, email, role) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'pierre@dewit-compta.be', 'owner'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'sophie@dewit-compta.be', 'staff');

-- Practitioners
INSERT INTO practitioners (id, business_id, user_id, display_name, title, color) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Pierre De Wit', 'Fiscalité · Sociétés · 16 ans exp.', '#0D7377'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Sophie Laurent', 'TVA · IPP · Indépendants · 8 ans exp.', '#7DD3C0');

-- Services
INSERT INTO services (id, business_id, name, category, duration_min, buffer_after_min, price_cents, price_label, mode_options, prep_instructions_fr, color, sort_order) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Premier contact', 'discovery', 30, 0, NULL, 'Gratuit', '["cabinet","visio","phone"]', NULL, '#15803D', 1),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Déclaration IPP (indépendant)', 'ipp', 45, 15, 12000, NULL, '["cabinet","visio"]', 'Fiches de revenus (281.10 / 281.50), attestations fiscales (assurance, épargne-pension), justificatifs de frais professionnels.', '#0D7377', 2),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Consultation TVA', 'tva', 30, 10, 9500, NULL, '["cabinet","visio","phone"]', 'Dernières déclarations TVA, extraits bancaires du trimestre.', '#0D7377', 3),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Question société / SRL', 'societe', 45, 15, 15000, NULL, '["cabinet","visio"]', 'Statuts de la société, derniers comptes annuels.', '#B45309', 4),
  ('d0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Création d''activité', 'creation', 60, 15, 20000, NULL, '["cabinet"]', 'Carte d''identité, projet d''activité, business plan si disponible.', '#1D4ED8', 5),
  ('d0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Suivi dossier', 'suivi', 20, 5, 7500, NULL, '["cabinet","visio","phone"]', NULL, '#78716C', 6);

-- Practitioner-Services links (who does what)
INSERT INTO practitioner_services (practitioner_id, service_id) VALUES
  -- Pierre does everything
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000005'),
  ('c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006'),
  -- Sophie does IPP, TVA, suivi, premier contact (not société, not création)
  ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000006');

-- Availabilities (Mon-Fri 9-12 + 13-17 for both, Fri PM until 16 for both)
INSERT INTO availabilities (business_id, practitioner_id, weekday, start_time, end_time) VALUES
  -- Pierre: Mon-Thu
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 0, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 0, '13:00', '17:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 1, '13:00', '17:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 2, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 2, '13:00', '17:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 3, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 3, '13:00', '17:00'),
  -- Pierre: Friday (shorter PM)
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 4, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 4, '13:00', '16:00'),
  -- Sophie: same schedule
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 0, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 0, '13:00', '17:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 1, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 1, '13:00', '17:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 2, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 2, '13:00', '17:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 3, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 3, '13:00', '17:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 4, '09:00', '12:00'),
  ('a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 4, '13:00', '16:00');

-- Call settings
INSERT INTO call_settings (business_id, twilio_number, filter_mode, forward_default_phone, sms_after_call)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '+32 2 123 45 67',
  'soft',
  '+32 475 99 88 77',
  true
);

-- Whitelist
INSERT INTO call_whitelist (business_id, phone_e164, label) VALUES
  ('a0000000-0000-0000-0000-000000000001', '+32 2 345 67 89', 'SPRL Dupont — comptable existant'),
  ('a0000000-0000-0000-0000-000000000001', '+32 475 11 22 33', 'Marie De Wit — famille'),
  ('a0000000-0000-0000-0000-000000000001', '+32 2 987 65 43', 'Notaire Bertrand');

-- ============================================================
-- DONE. 15 tables, all indexes, RLS, triggers, seed data.
-- Ready for: node backend with pg driver
-- ============================================================
