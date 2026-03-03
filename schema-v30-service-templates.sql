-- ============================================================================
-- schema-v30-service-templates.sql
-- Sector-based service templates for onboarding pre-fill
-- ============================================================================

-- Table: sector_service_templates
CREATE TABLE IF NOT EXISTS sector_service_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector VARCHAR(30) NOT NULL,
    category VARCHAR(100) NOT NULL,
    name VARCHAR(150) NOT NULL,
    suggested_duration_min INTEGER NOT NULL DEFAULT 30,
    suggested_price_cents INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Index for fast lookups by sector + category + sort_order
CREATE INDEX IF NOT EXISTS idx_sst_sector ON sector_service_templates(sector, category, sort_order);

-- ============================================================================
-- COIFFEUR (~30 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Coupe
('coiffeur', 'Coupe', 'Coupe femme', 45, 3500, 0),
('coiffeur', 'Coupe', 'Coupe homme', 30, 2200, 1),
('coiffeur', 'Coupe', 'Coupe enfant', 20, 1500, 2),
('coiffeur', 'Coupe', 'Coupe + barbe', 45, 3500, 3),
-- Brushing & Coiffage
('coiffeur', 'Brushing & Coiffage', 'Brushing court', 30, 2500, 0),
('coiffeur', 'Brushing & Coiffage', 'Brushing long', 45, 3500, 1),
('coiffeur', 'Brushing & Coiffage', 'Mise en plis', 45, 3000, 2),
-- Coloration
('coiffeur', 'Coloration', 'Coloration complete', 90, 5500, 0),
('coiffeur', 'Coloration', 'Coloration racines', 60, 4000, 1),
('coiffeur', 'Coloration', 'Patine / Gloss', 30, 2500, 2),
-- Balayage & Meches
('coiffeur', 'Balayage & Meches', 'Balayage', 120, 8000, 0),
('coiffeur', 'Balayage & Meches', 'Meches completes', 120, 8500, 1),
('coiffeur', 'Balayage & Meches', 'Ombre hair', 120, 9000, 2),
-- Lissage & Permanente
('coiffeur', 'Lissage & Permanente', 'Lissage bresilien', 120, 15000, 0),
('coiffeur', 'Lissage & Permanente', 'Lissage tanin', 120, 13000, 1),
('coiffeur', 'Lissage & Permanente', 'Permanente', 120, 7000, 2),
-- Soins Capillaires
('coiffeur', 'Soins Capillaires', 'Soin profond', 30, 2500, 0),
('coiffeur', 'Soins Capillaires', 'Soin keratine', 45, 4000, 1),
('coiffeur', 'Soins Capillaires', 'Masque reconstituant', 20, 1500, 2),
-- Extensions
('coiffeur', 'Extensions', 'Extensions a chaud', 180, 25000, 0),
('coiffeur', 'Extensions', 'Extensions a froid', 180, 22000, 1),
-- Coiffure Evenementielle
('coiffeur', 'Coiffure Evenementielle', 'Chignon', 60, 5500, 0),
('coiffeur', 'Coiffure Evenementielle', 'Coiffure mariee', 90, 12000, 1),
('coiffeur', 'Coiffure Evenementielle', 'Coiffure soiree', 60, 6500, 2),
-- Barbe
('coiffeur', 'Barbe', 'Taille barbe', 20, 1500, 0),
('coiffeur', 'Barbe', 'Rasage traditionnel', 30, 2500, 1),
-- Forfaits
('coiffeur', 'Forfaits', 'Coupe + Brushing', 60, 5000, 0),
('coiffeur', 'Forfaits', 'Coupe + Coloration', 120, 7500, 1),
('coiffeur', 'Forfaits', 'Forfait complet', 150, 9500, 2);

-- ============================================================================
-- ESTHETIQUE (~24 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Epilation
('esthetique', 'Epilation', 'Epilation jambes completes', 45, 3000, 0),
('esthetique', 'Epilation', 'Epilation demi-jambes', 30, 2000, 1),
('esthetique', 'Epilation', 'Epilation maillot', 20, 1800, 2),
('esthetique', 'Epilation', 'Epilation aisselles', 15, 1200, 3),
('esthetique', 'Epilation', 'Epilation bras', 20, 1500, 4),
-- Epilation definitive
('esthetique', 'Epilation definitive', 'Laser jambes completes', 60, 15000, 0),
('esthetique', 'Epilation definitive', 'Laser maillot', 30, 8000, 1),
('esthetique', 'Epilation definitive', 'Laser aisselles', 20, 6000, 2),
-- Ongles
('esthetique', 'Ongles', 'Manucure classique', 30, 2500, 0),
('esthetique', 'Ongles', 'Pose gel', 60, 4500, 1),
('esthetique', 'Ongles', 'Pedicure', 45, 3500, 2),
('esthetique', 'Ongles', 'Nail art (supplement)', 15, 1000, 3),
-- Cils & Sourcils
('esthetique', 'Cils & Sourcils', 'Rehaussement de cils', 60, 5000, 0),
('esthetique', 'Cils & Sourcils', 'Extension cils', 90, 8000, 1),
('esthetique', 'Cils & Sourcils', 'Restructuration sourcils', 20, 1500, 2),
-- Soins Visage
('esthetique', 'Soins Visage', 'Soin visage classique', 60, 5500, 0),
('esthetique', 'Soins Visage', 'Soin anti-age', 75, 7500, 1),
('esthetique', 'Soins Visage', 'Peeling', 45, 5000, 2),
-- Soins Corps
('esthetique', 'Soins Corps', 'Gommage corps', 45, 4500, 0),
('esthetique', 'Soins Corps', 'Enveloppement', 60, 6000, 1),
-- Massage
('esthetique', 'Massage', 'Massage relaxant', 60, 6000, 0),
('esthetique', 'Massage', 'Massage dos', 30, 3500, 1),
-- Maquillage
('esthetique', 'Maquillage', 'Maquillage jour', 30, 3500, 0),
('esthetique', 'Maquillage', 'Maquillage soiree', 45, 5500, 1),
('esthetique', 'Maquillage', 'Maquillage mariee', 60, 8500, 2);

-- ============================================================================
-- BARBIER (~8 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Coupe
('barbier', 'Coupe', 'Coupe homme', 30, 2200, 0),
('barbier', 'Coupe', 'Coupe + coiffage', 45, 3000, 1),
('barbier', 'Coupe', 'Coupe enfant', 20, 1500, 2),
-- Barbe
('barbier', 'Barbe', 'Taille barbe', 20, 1500, 0),
('barbier', 'Barbe', 'Rasage traditionnel', 30, 2500, 1),
('barbier', 'Barbe', 'Barbe + soin', 30, 3000, 2),
-- Soins visage
('barbier', 'Soins visage', 'Soin visage homme', 30, 3000, 0),
('barbier', 'Soins visage', 'Black mask', 15, 1500, 1);

-- ============================================================================
-- VETERINAIRE (~10 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Chiens
('veterinaire', 'Chiens', 'Consultation chien', 30, 4500, 0),
('veterinaire', 'Chiens', 'Vaccination chien', 20, 3500, 1),
('veterinaire', 'Chiens', 'Toilettage petit chien', 60, 3500, 2),
('veterinaire', 'Chiens', 'Toilettage grand chien', 90, 5500, 3),
-- Chats
('veterinaire', 'Chats', 'Consultation chat', 30, 4500, 0),
('veterinaire', 'Chats', 'Vaccination chat', 20, 3500, 1),
('veterinaire', 'Chats', 'Toilettage chat', 45, 3000, 2),
-- NAC
('veterinaire', 'NAC', 'Consultation NAC', 30, 5000, 0),
-- Soins specifiques
('veterinaire', 'Soins specifiques', 'Detartrage', 45, 8000, 0),
('veterinaire', 'Soins specifiques', 'Chirurgie mineure', 60, 12000, 1);

-- ============================================================================
-- BIEN_ETRE (~10 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Massage relaxant
('bien_etre', 'Massage relaxant', 'Massage complet', 60, 6500, 0),
('bien_etre', 'Massage relaxant', 'Massage dos et nuque', 30, 3800, 1),
('bien_etre', 'Massage relaxant', 'Massage pierres chaudes', 75, 8000, 2),
-- Massage therapeutique
('bien_etre', 'Massage therapeutique', 'Massage sportif', 60, 7000, 0),
('bien_etre', 'Massage therapeutique', 'Massage deep tissue', 60, 7000, 1),
-- Reflexologie
('bien_etre', 'Reflexologie', 'Reflexologie plantaire', 60, 5500, 0),
('bien_etre', 'Reflexologie', 'Reflexologie faciale', 30, 3500, 1),
-- Drainage
('bien_etre', 'Drainage', 'Drainage lymphatique', 60, 6500, 0),
('bien_etre', 'Drainage', 'Drainage jambes lourdes', 45, 5000, 1);

-- ============================================================================
-- KINE (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Consultation
('kine', 'Consultation', 'Bilan initial', 45, 5000, 0),
('kine', 'Consultation', 'Consultation de suivi', 30, 3500, 1),
-- Reeducation
('kine', 'Reeducation', 'Reeducation fonctionnelle', 45, 4500, 0),
('kine', 'Reeducation', 'Reeducation post-operatoire', 45, 4500, 1),
-- Therapies specifiques
('kine', 'Therapies specifiques', 'Therapie manuelle', 30, 4000, 0),
('kine', 'Therapies specifiques', 'Drainage lymphatique', 45, 5000, 1);

-- ============================================================================
-- COACHING (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Coaching individuel
('coaching', 'Coaching individuel', 'Seance coaching 1h', 60, 7000, 0),
('coaching', 'Coaching individuel', 'Seance coaching 30min', 30, 4000, 1),
-- Coaching groupe
('coaching', 'Coaching groupe', 'Cours collectif', 60, 2000, 0),
('coaching', 'Coaching groupe', 'Atelier groupe', 90, 3000, 1),
-- Nutrition
('coaching', 'Nutrition', 'Bilan nutritionnel', 60, 6000, 0),
('coaching', 'Nutrition', 'Suivi nutritionnel', 30, 3500, 1);

-- ============================================================================
-- MEDECIN (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Consultation
('medecin', 'Consultation', 'Consultation generale', 20, 2500, 0),
('medecin', 'Consultation', 'Consultation specialisee', 30, 5000, 1),
-- Injections
('medecin', 'Injections', 'Injection acide hyaluronique', 30, 35000, 0),
('medecin', 'Injections', 'Injection botox', 30, 30000, 1),
-- Traitements
('medecin', 'Traitements', 'Peeling medical', 45, 15000, 0),
('medecin', 'Traitements', 'Microneedling', 45, 20000, 1);

-- ============================================================================
-- DENTISTE (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Consultation
('dentiste', 'Consultation', 'Bilan dentaire', 30, 5000, 0),
('dentiste', 'Consultation', 'Consultation urgence', 20, 4000, 1),
-- Soins
('dentiste', 'Soins', 'Detartrage', 30, 6000, 0),
('dentiste', 'Soins', 'Soin carie', 45, 8000, 1),
-- Esthetique dentaire
('dentiste', 'Esthetique dentaire', 'Blanchiment', 60, 35000, 0),
('dentiste', 'Esthetique dentaire', 'Facettes dentaires', 60, 50000, 1);

-- ============================================================================
-- OSTEOPATHE (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Consultation
('osteopathe', 'Consultation', 'Premiere consultation', 60, 6000, 0),
('osteopathe', 'Consultation', 'Consultation de suivi', 45, 5500, 1),
-- Traitement
('osteopathe', 'Traitement', 'Seance osteopathie', 45, 5500, 0),
('osteopathe', 'Traitement', 'Osteopathie cranienne', 45, 5500, 1),
-- Suivi
('osteopathe', 'Suivi', 'Bilan postural', 30, 4000, 0),
('osteopathe', 'Suivi', 'Seance d''entretien', 30, 4500, 1);

-- ============================================================================
-- COMPTABLE (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Consultation
('comptable', 'Consultation', 'Consultation initiale', 60, 8000, 0),
('comptable', 'Consultation', 'Consultation fiscale', 45, 7000, 1),
-- Declarations
('comptable', 'Declarations', 'Declaration TVA', 45, 15000, 0),
('comptable', 'Declarations', 'Declaration impots', 60, 20000, 1),
-- Suivi comptable
('comptable', 'Suivi comptable', 'Bilan annuel', 90, 25000, 0),
('comptable', 'Suivi comptable', 'Suivi mensuel', 60, 15000, 1);

-- ============================================================================
-- AVOCAT (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Consultation
('avocat', 'Consultation', 'Consultation juridique', 60, 15000, 0),
('avocat', 'Consultation', 'Consultation urgente', 30, 10000, 1),
-- Contentieux
('avocat', 'Contentieux', 'Mise en demeure', 60, 25000, 0),
('avocat', 'Contentieux', 'Audience tribunal', 120, 50000, 1),
-- Redaction
('avocat', 'Redaction', 'Redaction contrat', 90, 30000, 0),
('avocat', 'Redaction', 'Revision statuts', 60, 20000, 1);

-- ============================================================================
-- PHOTOGRAPHE (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Shooting
('photographe', 'Shooting', 'Portrait studio', 60, 8000, 0),
('photographe', 'Shooting', 'Shooting exterieur', 90, 12000, 1),
-- Retouche
('photographe', 'Retouche', 'Retouche photo (lot 10)', 60, 5000, 0),
('photographe', 'Retouche', 'Retouche avancee', 30, 4000, 1),
-- Evenementiel
('photographe', 'Evenementiel', 'Couverture evenement', 180, 35000, 0),
('photographe', 'Evenementiel', 'Reportage mariage', 480, 120000, 1);

-- ============================================================================
-- GARAGE (~6 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Entretien
('garage', 'Entretien', 'Vidange + filtres', 60, 8000, 0),
('garage', 'Entretien', 'Revision complete', 120, 15000, 1),
-- Reparation
('garage', 'Reparation', 'Changement plaquettes', 60, 12000, 0),
('garage', 'Reparation', 'Reparation embrayage', 180, 45000, 1),
-- Diagnostic
('garage', 'Diagnostic', 'Diagnostic electronique', 30, 5000, 0),
('garage', 'Diagnostic', 'Controle pre-CT', 45, 6000, 1);

-- ============================================================================
-- AUTRE (~4 templates)
-- ============================================================================
INSERT INTO sector_service_templates (sector, category, name, suggested_duration_min, suggested_price_cents, sort_order) VALUES
-- Consultation
('autre', 'Consultation', 'Consultation initiale', 60, 5000, 0),
('autre', 'Consultation', 'Consultation de suivi', 30, 3500, 1),
-- Suivi
('autre', 'Suivi', 'Seance de suivi', 45, 4000, 0),
('autre', 'Suivi', 'Bilan periodique', 60, 5000, 1);
