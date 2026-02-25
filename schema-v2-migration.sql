-- ============================================================
-- GENDA MVP v2 — Schema Migration
-- Adds: mini-site public page support (SaaS multi-tenant)
-- Run AFTER schema.sql (v1)
-- ============================================================

-- ============================================================
-- 1. EXTEND BUSINESSES — new fields for the mini-site hero + about
-- ============================================================
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tagline VARCHAR(200),              -- "Votre expert-comptable à Bruxelles"
  ADD COLUMN IF NOT EXISTS description TEXT,                   -- Bio longue (section À propos)
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500),              -- Upload logo
  ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500),       -- Hero background (optional)
  ADD COLUMN IF NOT EXISTS founded_year SMALLINT,              -- "Depuis 2008"
  ADD COLUMN IF NOT EXISTS accreditation VARCHAR(100),         -- "ITAA agréé"
  ADD COLUMN IF NOT EXISTS bce_number VARCHAR(20),             -- N° entreprise (footer)
  ADD COLUMN IF NOT EXISTS parking_info VARCHAR(200),          -- "Parking gratuit derrière le bâtiment"
  ADD COLUMN IF NOT EXISTS languages_spoken VARCHAR(20)[]      -- {'fr','nl','en'}
    DEFAULT '{fr}',
  ADD COLUMN IF NOT EXISTS social_links JSONB                  -- {"linkedin":"url","facebook":"url","website":"url"}
    DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS page_sections JSONB                 -- Controls which sections are visible + order
    DEFAULT '{
      "hero": true,
      "about": true,
      "team": true,
      "specializations": true,
      "services": true,
      "testimonials": true,
      "location": true,
      "booking_cta": true
    }'::jsonb,
  ADD COLUMN IF NOT EXISTS seo_title VARCHAR(200),             -- Custom <title> tag
  ADD COLUMN IF NOT EXISTS seo_description VARCHAR(300),       -- Custom meta description
  ADD COLUMN IF NOT EXISTS theme JSONB                         -- Custom colors/fonts (V1.2)
    DEFAULT '{
      "primary_color": "#0D7377",
      "accent_color": "#A68B3C",
      "font_heading": "Instrument Serif",
      "font_body": "Plus Jakarta Sans"
    }'::jsonb;

-- ============================================================
-- 2. EXTEND PRACTITIONERS — bio, photo, socials for team section
-- ============================================================
ALTER TABLE practitioners
  ADD COLUMN IF NOT EXISTS bio TEXT,                           -- Full bio paragraph
  ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500),             -- Profile photo
  ADD COLUMN IF NOT EXISTS email VARCHAR(200),                 -- Public contact email
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30),                  -- Direct phone (optional)
  ADD COLUMN IF NOT EXISTS years_experience SMALLINT,          -- "16 ans exp."
  ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(300);

-- ============================================================
-- 3. SPECIALIZATIONS — editable expertise tags
-- UI: Mini-site > Spécialisations grid (6 cards)
--     Dashboard > Paramètres > Spécialisations
-- ============================================================
CREATE TABLE IF NOT EXISTS specializations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,                 -- "Fiscalité des indépendants"
  description   VARCHAR(300),                          -- "IPP, avantages en nature, frais professionnels"
  icon          VARCHAR(10),                           -- Emoji: "📊"
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_specializations_business
  ON specializations(business_id, sort_order)
  WHERE is_active = true;

ALTER TABLE specializations ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON specializations
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 4. PRACTITIONER_SPECIALIZATIONS — who is expert in what
-- UI: Team cards > tags (Fiscalité, Sociétés, Création...)
-- ============================================================
CREATE TABLE IF NOT EXISTS practitioner_specializations (
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  specialization_id UUID NOT NULL REFERENCES specializations(id) ON DELETE CASCADE,
  PRIMARY KEY (practitioner_id, specialization_id)
);

CREATE INDEX IF NOT EXISTS idx_pspec_spec
  ON practitioner_specializations(specialization_id);

-- ============================================================
-- 5. TESTIMONIALS — client reviews
-- UI: Mini-site > Témoignages section (4 cards)
--     Dashboard > Paramètres > Témoignages
-- ============================================================
CREATE TABLE IF NOT EXISTS testimonials (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  author_name     VARCHAR(100) NOT NULL,               -- "Marc Henrard"
  author_role     VARCHAR(200),                        -- "Gérant, TechFlow SA"
  author_initials VARCHAR(4),                          -- "MH" (auto-generated if empty)
  content         TEXT NOT NULL,                        -- The testimonial text
  rating          SMALLINT DEFAULT 5                    -- 1-5 stars
    CHECK (rating BETWEEN 1 AND 5),
  practitioner_id UUID REFERENCES practitioners(id)    -- Optional: linked to a specific practitioner
    ON DELETE SET NULL,
  source          VARCHAR(20) DEFAULT 'manual'          -- 'manual' | 'google' | 'imported'
    CHECK (source IN ('manual', 'google', 'imported')),
  is_featured     BOOLEAN DEFAULT true,                 -- Show on public page
  is_active       BOOLEAN DEFAULT true,
  sort_order      INTEGER DEFAULT 0,
  date_given      DATE,                                 -- When the testimonial was given
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_testimonials_business
  ON testimonials(business_id, sort_order)
  WHERE is_active = true AND is_featured = true;

ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON testimonials
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 6. VALUE_PROPOSITIONS — the "why choose us" cards
-- UI: Mini-site > À propos > 4 cards (approche, réactivité...)
--     Dashboard > Paramètres > Valeurs
-- ============================================================
CREATE TABLE IF NOT EXISTS value_propositions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title         VARCHAR(100) NOT NULL,                 -- "Approche personnalisée"
  description   TEXT,                                  -- "Chaque dossier est unique..."
  icon          VARCHAR(10),                           -- Emoji: "🎯"
  icon_style    VARCHAR(10) DEFAULT 'teal'             -- 'teal' | 'gold' | 'green' | 'neutral'
    CHECK (icon_style IN ('teal', 'gold', 'green', 'neutral')),
  sort_order    INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_values_business
  ON value_propositions(business_id, sort_order)
  WHERE is_active = true;

ALTER TABLE value_propositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON value_propositions
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 7. CUSTOM_DOMAINS — point your own domain to your page
-- UI: Dashboard > Paramètres > Domaine personnalisé
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_domains (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID UNIQUE NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  domain          VARCHAR(200) NOT NULL UNIQUE,        -- "dewit-compta.be"
  verification_status VARCHAR(20) DEFAULT 'pending'    -- 'pending' | 'dns_verified' | 'ssl_active' | 'failed'
    CHECK (verification_status IN ('pending', 'dns_verified', 'ssl_active', 'failed')),
  verification_token VARCHAR(64)                        -- TXT record value for DNS verification
    DEFAULT encode(gen_random_bytes(16), 'hex'),
  ssl_provisioned_at TIMESTAMPTZ,
  last_checked_at    TIMESTAMPTZ,
  error_message      VARCHAR(500),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_domains_domain
  ON custom_domains(domain);

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON custom_domains
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 8. MEDIA — uploaded files (logos, photos, etc.)
-- UI: Dashboard > any upload field
-- ============================================================
CREATE TABLE IF NOT EXISTS media (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  filename      VARCHAR(300) NOT NULL,
  original_name VARCHAR(300),
  mime_type     VARCHAR(50),
  size_bytes    INTEGER,
  url           VARCHAR(500) NOT NULL,                 -- Public URL (S3/Cloudflare R2)
  purpose       VARCHAR(30) DEFAULT 'general'          -- 'logo' | 'cover' | 'practitioner_photo' | 'general'
    CHECK (purpose IN ('logo', 'cover', 'practitioner_photo', 'general')),
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_business
  ON media(business_id, purpose);

ALTER TABLE media ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON media
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 9. ONBOARDING_PROGRESS — track setup completion
-- UI: Dashboard > Onboarding wizard progress
-- ============================================================
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID UNIQUE NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  steps_completed JSONB DEFAULT '{
    "cabinet_info": false,
    "schedule": false,
    "services": false,
    "team": false,
    "bio_description": false,
    "specializations": false,
    "testimonials": false,
    "notifications": false,
    "call_filter": false,
    "go_live": false
  }'::jsonb,
  completion_percent SMALLINT DEFAULT 0,
  completed_at       TIMESTAMPTZ,                      -- NULL until 100%
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON onboarding_progress
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- SEED DATA v2 — extend De Wit demo data
-- ============================================================

-- Business extensions
UPDATE businesses SET
  tagline = 'Votre expert-comptable à Bruxelles',
  description = 'Fondé en 2008 par Pierre De Wit, notre cabinet accompagne les indépendants, PME et professions libérales dans leur gestion comptable et fiscale. Nous croyons qu''un bon comptable ne se contente pas de remplir des déclarations — il vous aide à prendre les bonnes décisions financières.

Avec plus de 120 clients actifs et une expertise reconnue en fiscalité des sociétés, nous sommes agréés par l''ITAA et engagés dans une démarche de digitalisation responsable de nos services.',
  founded_year = 2008,
  accreditation = 'ITAA agréé',
  bce_number = '0XXX.XXX.XXX',
  parking_info = 'Parking gratuit derrière le bâtiment',
  languages_spoken = '{fr,nl}',
  social_links = '{"linkedin":"https://linkedin.com/company/dewit-associes"}'::jsonb,
  seo_title = 'Cabinet De Wit & Associés — Expertise comptable à Bruxelles',
  seo_description = 'Cabinet comptable ITAA agréé à Bruxelles. Fiscalité, sociétés, TVA, création d''entreprise. Prenez rendez-vous en ligne.'
WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- Practitioner bios
UPDATE practitioners SET
  bio = '16 ans d''expérience en fiscalité belge. Spécialisé dans l''accompagnement des sociétés (SRL, SA) et la structuration fiscale. Intervenant régulier auprès de chambres de commerce.',
  years_experience = 16,
  email = 'pierre@dewit-compta.be'
WHERE id = 'c0000000-0000-0000-0000-000000000001';

UPDATE practitioners SET
  bio = '8 ans d''expérience. Spécialiste des déclarations IPP et TVA pour indépendants et professions libérales. Approche pédagogique et accompagnement pas-à-pas des primo-déclarants.',
  years_experience = 8,
  email = 'sophie@dewit-compta.be'
WHERE id = 'c0000000-0000-0000-0000-000000000002';

-- Specializations
INSERT INTO specializations (id, business_id, name, description, icon, sort_order) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Fiscalité des indépendants', 'IPP, avantages en nature, frais professionnels', '📊', 1),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Gestion de sociétés', 'SRL, SA, comptes annuels, bilans', '🏢', 2),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Obligations TVA', 'Déclarations, régularisations, contrôles', '📝', 3),
  ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Création d''entreprise', 'Plan financier, statuts, numéro BCE', '🚀', 4),
  ('e0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Optimisation fiscale', 'Planification, épargne-pension, déductions', '💶', 5),
  ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Conseil & accompagnement', 'Projections, tableaux de bord, décisions stratégiques', '🤝', 6);

-- Practitioner-Specialization links
INSERT INTO practitioner_specializations (practitioner_id, specialization_id) VALUES
  -- Pierre: fiscalité, sociétés, création, optimisation, conseil
  ('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004'),
  ('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000005'),
  ('c0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006'),
  -- Sophie: fiscalité, TVA, conseil
  ('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000006');

-- Testimonials
INSERT INTO testimonials (business_id, author_name, author_role, author_initials, content, rating, practitioner_id, sort_order) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Marc Henrard', 'Gérant, TechFlow SA', 'MH',
   'Pierre m''a accompagné dans la création de ma SRL avec une clarté et une patience remarquables. Chaque étape était limpide. Je recommande sans hésiter.',
   5, 'c0000000-0000-0000-0000-000000000001', 1),
  ('a0000000-0000-0000-0000-000000000001', 'Claire Mertens', 'Architecte d''intérieur, indépendante', 'CM',
   'Sophie est toujours disponible pour répondre à mes questions TVA, même les plus basiques. Ça change la vie quand on débute comme indépendante.',
   5, 'c0000000-0000-0000-0000-000000000002', 2),
  ('a0000000-0000-0000-0000-000000000001', 'Karim Ouhadi', 'Consultant IT, indépendant complémentaire', 'KO',
   'Après 3 ans avec un autre cabinet, j''ai changé pour De Wit. La différence est flagrante : proactivité, conseils d''optimisation, et une vraie disponibilité.',
   5, NULL, 3),
  ('a0000000-0000-0000-0000-000000000001', 'Nathalie Bodart', 'Gérante, SPRL NB Consulting', 'NB',
   'La prise de rendez-vous en ligne est un vrai plus. Plus besoin d''appeler entre deux réunions. Je réserve mon créneau le soir et c''est réglé.',
   5, NULL, 4);

-- Value propositions
INSERT INTO value_propositions (business_id, title, description, icon, icon_style, sort_order) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Approche personnalisée',
   'Chaque dossier est unique. Nous adaptons nos conseils à votre situation, votre secteur et vos objectifs.',
   '🎯', 'teal', 1),
  ('a0000000-0000-0000-0000-000000000001', 'Réactivité garantie',
   'Réponse sous 24h, suivi proactif des échéances, et consultations flexibles en cabinet, visio ou téléphone.',
   '⚡', 'gold', 2),
  ('a0000000-0000-0000-0000-000000000001', 'Conformité & rigueur',
   'Agréés ITAA, nous appliquons les normes les plus strictes en matière de déontologie et de confidentialité.',
   '🔒', 'green', 3),
  ('a0000000-0000-0000-0000-000000000001', 'Conseils proactifs',
   'Nous ne nous contentons pas du minimum légal. Optimisation fiscale, planification et anticipation font partie de notre ADN.',
   '💡', 'neutral', 4);

-- Onboarding progress (demo: 80% complete)
INSERT INTO onboarding_progress (business_id, steps_completed, completion_percent)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '{
    "cabinet_info": true,
    "schedule": true,
    "services": true,
    "team": true,
    "bio_description": true,
    "specializations": true,
    "testimonials": true,
    "notifications": true,
    "call_filter": true,
    "go_live": false
  }'::jsonb,
  90
);

-- Triggers for new tables
CREATE TRIGGER trg_testimonials_updated BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_custom_domains_updated BEFORE UPDATE ON custom_domains
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_onboarding_updated BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- DONE. v2 migration adds:
--   - 6 new tables (specializations, practitioner_specializations,
--     testimonials, value_propositions, custom_domains, media,
--     onboarding_progress)
--   - Extended businesses (tagline, bio, logo, SEO, theme, sections)
--   - Extended practitioners (bio, photo, years_experience)
--   - All RLS + indexes + triggers + seed data
-- ============================================================
