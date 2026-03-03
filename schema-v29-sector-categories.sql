-- ============================================================================
-- schema-v29-sector-categories.sql
-- Sector categories with premium SVG icons for service categorization
-- ============================================================================

CREATE TABLE IF NOT EXISTS sector_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sector VARCHAR(30) NOT NULL,
    label VARCHAR(100) NOT NULL,
    icon_svg TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sector_categories_sector ON sector_categories(sector, sort_order);

-- ============================================================================
-- COIFFEUR
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('coiffeur', 'Coupe',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M12 2 L8 14"/><path d="M12 2 L16 14"/><path d="M8 14 L6 15.5"/><path d="M16 14 L18 15.5"/><path d="M8 14 L16 14"/></svg>',
 0),

('coiffeur', 'Brushing & Coiffage',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M3 3 L3 12 C3 13.1 3.9 14 5 14 L7 14 C8.1 14 9 13.1 9 12 L9 3"/><line x1="3" y1="6" x2="9" y2="6"/><line x1="6" y1="14" x2="6" y2="21"/><path d="M14 8 C14 8 16 5 19 5 C22 5 22 8 22 8 C22 8 22 12 18 16 L14 20"/><path d="M14 8 L14 20"/></svg>',
 1),

('coiffeur', 'Coloration',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 2 C12 2 6 9 6 13 C6 16.31 8.69 19 12 19 C15.31 19 18 16.31 18 13 C18 9 12 2 12 2Z"/><path d="M10 13 C10 14.1 10.9 15 12 15 C13.1 15 14 14.1 14 13"/><line x1="12" y1="19" x2="12" y2="22"/></svg>',
 2),

('coiffeur', 'Balayage & Meches',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M8 2 C8 2 6 8 6 12 C6 16 7 20 7 20"/><path d="M12 2 C12 2 10 8 10 12 C10 16 11 20 11 20"/><path d="M16 2 C16 2 14 8 14 12 C14 16 15 20 15 20"/><path d="M20 2 C20 2 18 8 18 12 C18 16 19 20 19 20"/><path d="M9 7 L11 6"/><path d="M13 7 L15 6"/><path d="M17 7 L19 6"/></svg>',
 3),

('coiffeur', 'Lissage & Permanente',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M4 4 L4 20"/><path d="M10 4 C10 4 13 6 13 8 C13 10 7 12 7 14 C7 16 13 18 13 20"/><path d="M18 4 C18 4 21 6 21 8 C21 10 15 12 15 14 C15 16 21 18 21 20"/></svg>',
 4),

('coiffeur', 'Soins Capillaires',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M8 2 L8 6 C8 8.21 9.79 10 12 10 C14.21 10 16 8.21 16 6 L16 2"/><line x1="8" y1="4" x2="16" y2="4"/><path d="M12 10 L12 14"/><path d="M9 14 L15 14 L15 19 C15 20.66 13.66 22 12 22 C10.34 22 9 20.66 9 19 L9 14Z"/><path d="M6 7 L4 8"/><path d="M18 7 L20 8"/></svg>',
 5),

('coiffeur', 'Extensions',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 2 C8 2 5 4 5 7 C5 9 6 10 6 10"/><path d="M12 2 C16 2 19 4 19 7 C19 9 18 10 18 10"/><path d="M6 10 C5 12 4 16 5 22"/><path d="M9 9 C8 12 7.5 16 8 22"/><path d="M12 8 C12 12 11.5 16 11 22"/><path d="M15 9 C15.5 12 15.5 16 14 22"/><path d="M18 10 C19 12 19.5 16 19 22"/></svg>',
 6),

('coiffeur', 'Coiffure Evenementielle',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="8" r="5"/><path d="M7 7 C7 7 9 11 12 11 C15 11 17 7 17 7"/><path d="M8 5 C8 5 10 3 12 3 C14 3 16 5 16 5"/><path d="M10 3 L9 1"/><path d="M14 3 L15 1"/><path d="M12 13 L12 16"/><path d="M8 15 L16 15"/><path d="M9 15 L7 21"/><path d="M15 15 L17 21"/><path d="M12 16 L12 21"/></svg>',
 7),

('coiffeur', 'Barbe',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M7 3 L5 9 L5 13 C5 13 5 17 8 19 L12 21 L16 19 C19 17 19 13 19 13 L19 9 L17 3"/><path d="M7 3 L17 3"/><line x1="5" y1="9" x2="19" y2="9"/><path d="M9 12 L9 14"/><path d="M15 12 L15 14"/></svg>',
 8),

('coiffeur', 'Forfaits',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 5 L8 2"/><path d="M16 5 L16 2"/><path d="M7 14 L10 14"/><path d="M7 17 L13 17"/><circle cx="17" cy="15.5" r="2.5"/><path d="M17 13 L17 12"/><path d="M17 18 L17 19"/></svg>',
 9);

-- ============================================================================
-- ESTHETIQUE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('esthetique', 'Epilation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M4 4 L20 4 L20 10 C20 10 18 9 16 10 C14 11 14 13 12 14 C10 15 10 13 8 12 C6 11 4 12 4 12 L4 4Z"/><path d="M4 4 L20 4"/><line x1="8" y1="4" x2="8" y2="1"/><line x1="16" y1="4" x2="16" y2="1"/><path d="M6 17 L18 17"/><path d="M8 20 L16 20"/></svg>',
 0),

('esthetique', 'Epilation definitive',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 2 L12 8"/><path d="M8 4 L12 8 L16 4"/><path d="M12 8 L12 14"/><circle cx="12" cy="17" r="5"/><path d="M10 16 L12 18 L14 16"/><path d="M9 14 L7 12"/><path d="M15 14 L17 12"/></svg>',
 1),

('esthetique', 'Ongles',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M10 3 C10 3 8 3 8 6 L8 14 C8 17 10 19 12 19 C14 19 16 17 16 14 L16 6 C16 3 14 3 14 3"/><path d="M10 3 L14 3"/><line x1="8" y1="9" x2="16" y2="9"/><path d="M12 19 L12 22"/><path d="M10 22 L14 22"/><circle cx="12" cy="6" r="0.5"/></svg>',
 2),

('esthetique', 'Cils & Sourcils',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><ellipse cx="12" cy="14" rx="8" ry="4"/><path d="M4 14 C4 14 8 10 12 10 C16 10 20 14 20 14"/><circle cx="12" cy="14" r="2"/><path d="M5 10 L3 7"/><path d="M8 8.5 L7 5"/><path d="M12 8 L12 5"/><path d="M16 8.5 L17 5"/><path d="M19 10 L21 7"/></svg>',
 3),

('esthetique', 'Soins Visage',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><ellipse cx="12" cy="12" rx="7" ry="9"/><circle cx="9" cy="10" r="0.75"/><circle cx="15" cy="10" r="0.75"/><path d="M10 15 C10 15 11 16 12 16 C13 16 14 15 14 15"/><path d="M5 8 C5 8 7 6 12 6 C17 6 19 8 19 8"/><path d="M3 5 L5 8"/><path d="M21 5 L19 8"/></svg>',
 4),

('esthetique', 'Soins Corps',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="4" r="2"/><path d="M12 6 L12 14"/><path d="M12 8 L8 12"/><path d="M12 8 L16 12"/><path d="M12 14 L9 22"/><path d="M12 14 L15 22"/><path d="M4 10 C4 10 6 9 7 11"/><path d="M20 10 C20 10 18 9 17 11"/></svg>',
 5),

('esthetique', 'Massage',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M5 20 C5 20 3 16 3 14 C3 12 5 10 5 10 L8 8 C8 8 10 6 10 4"/><path d="M19 20 C19 20 21 16 21 14 C21 12 19 10 19 10 L16 8 C16 8 14 6 14 4"/><path d="M8 8 C8 8 10 10 12 10 C14 10 16 8 16 8"/><path d="M7 14 C7 14 9 16 12 16 C15 16 17 14 17 14"/><circle cx="10" cy="4" r="1"/><circle cx="14" cy="4" r="1"/></svg>',
 6),

('esthetique', 'Maquillage',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M8 2 L8 12 C8 14.21 9.79 16 12 16 C12 16 12 16 12 16"/><path d="M8 2 L12 2 L12 12"/><path d="M12 16 L12 22"/><path d="M10 22 L14 22"/><rect x="16" y="4" width="4" height="12" rx="2"/><line x1="16" y1="8" x2="20" y2="8"/><path d="M18 16 L18 19"/></svg>',
 7);

-- ============================================================================
-- BARBIER
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('barbier', 'Coupe',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M3 6 L3 18 C3 19.1 3.9 20 5 20 L7 20 C8.1 20 9 19.1 9 18 L9 6 C9 4.9 8.1 4 7 4 L5 4 C3.9 4 3 4.9 3 6Z"/><line x1="3" y1="9" x2="9" y2="9"/><line x1="3" y1="15" x2="9" y2="15"/><circle cx="17" cy="7" r="3"/><circle cx="17" cy="19" r="2"/><path d="M12 7 L14 7"/><path d="M19 9 L19 12 L15 17"/></svg>',
 0),

('barbier', 'Barbe',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M6 3 L6 9 C6 9 6 12 8 14 L10 16"/><path d="M10 16 L10 22"/><path d="M6 3 L10 3 L10 8"/><path d="M16 3 L20 3"/><path d="M18 3 L18 10 C18 13 16 14 15 15"/><path d="M15 15 L18 22"/><circle cx="18" cy="7" r="0.5"/></svg>',
 1),

('barbier', 'Soins visage',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><ellipse cx="12" cy="13" rx="7" ry="8"/><path d="M5 10 C5 6 8 3 12 3 C16 3 19 6 19 10"/><circle cx="9.5" cy="11" r="0.75"/><circle cx="14.5" cy="11" r="0.75"/><path d="M10 16 C10 16 11 17 12 17 C13 17 14 16 14 16"/><path d="M3 10 L5 12"/><path d="M21 10 L19 12"/><path d="M7 8 L10 9"/><path d="M17 8 L14 9"/></svg>',
 2);

-- ============================================================================
-- VETERINAIRE (toilettage)
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('veterinaire', 'Chiens',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 10 C14 10 17 11 18 13 C19 15 19 18 18 19 L18 21"/><path d="M12 10 C10 10 7 11 6 13 C5 15 5 18 6 19 L6 21"/><circle cx="12" cy="8" r="3"/><path d="M10 7 L8 3"/><path d="M14 7 L16 3"/><circle cx="10.5" cy="8" r="0.5"/><circle cx="13.5" cy="8" r="0.5"/><path d="M11 9.5 L12 10 L13 9.5"/><path d="M18 19 L20 21"/><path d="M6 19 L4 21"/></svg>',
 0),

('veterinaire', 'Chats',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 22 C7 22 4 18 4 14 L4 10 L2 4 L7 7"/><path d="M12 22 C17 22 20 18 20 14 L20 10 L22 4 L17 7"/><path d="M7 7 C9 6 11 6 12 6 C13 6 15 6 17 7"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M11 15 L12 16 L13 15"/><path d="M12 16 L12 17"/><path d="M10 17 L12 17 L14 17"/></svg>',
 1),

('veterinaire', 'NAC',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><ellipse cx="12" cy="14" rx="6" ry="7"/><circle cx="12" cy="8" r="4"/><path d="M10 5 L8 1"/><path d="M14 5 L16 1"/><circle cx="10" cy="8" r="0.75"/><circle cx="14" cy="8" r="0.75"/><path d="M11 10 L12 11 L13 10"/><path d="M8 18 L6 21"/><path d="M16 18 L18 21"/></svg>',
 2),

('veterinaire', 'Soins specifiques',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><line x1="12" y1="2" x2="12" y2="10"/><line x1="8" y1="6" x2="16" y2="6"/><path d="M7 14 C7 14 8 12 10 13 C11 13.5 11 15 10 16 C9 17 7 17 7 16 C7 15 7 14 7 14Z"/><path d="M17 14 C17 14 16 12 14 13 C13 13.5 13 15 14 16 C15 17 17 17 17 16 C17 15 17 14 17 14Z"/><path d="M9 19 C9 19 10 18 12 18 C14 18 15 19 15 19"/><path d="M10 19 C10 20.5 11 22 12 22 C13 22 14 20.5 14 19"/></svg>',
 3);

-- ============================================================================
-- BIEN_ETRE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('bien_etre', 'Massage relaxant',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="5" r="3"/><path d="M12 8 L12 12"/><path d="M8 10 L6 8"/><path d="M16 10 L18 8"/><path d="M12 12 C12 12 8 14 8 17 C8 20 12 22 12 22 C12 22 16 20 16 17 C16 14 12 12 12 12Z"/><path d="M10 16 L12 18 L14 16"/></svg>',
 0),

('bien_etre', 'Massage therapeutique',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M4 18 C4 18 3 14 4 12 C5 10 7 9 7 9 L10 7"/><path d="M20 18 C20 18 21 14 20 12 C19 10 17 9 17 9 L14 7"/><path d="M10 7 C10 7 11 5 12 5 C13 5 14 7 14 7"/><path d="M7 9 C9 11 12 12 12 12 C12 12 15 11 17 9"/><path d="M9 15 L12 13 L15 15"/><line x1="12" y1="13" x2="12" y2="18"/><path d="M8 21 L12 18 L16 21"/></svg>',
 1),

('bien_etre', 'Reflexologie',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M8 2 C8 2 5 6 5 10 C5 14 6 16 7 18 C8 20 8 22 8 22"/><path d="M16 2 C16 2 19 6 19 10 C19 14 18 16 17 18 C16 20 16 22 16 22"/><path d="M8 22 L16 22"/><path d="M8 2 L16 2"/><ellipse cx="12" cy="8" rx="3" ry="2"/><ellipse cx="12" cy="14" rx="2.5" ry="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
 2),

('bien_etre', 'Drainage',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M2 6 C5 4 7 8 10 6 C13 4 15 8 18 6 C20 5 22 6 22 6"/><path d="M2 12 C5 10 7 14 10 12 C13 10 15 14 18 12 C20 11 22 12 22 12"/><path d="M2 18 C5 16 7 20 10 18 C13 16 15 20 18 18 C20 17 22 18 22 18"/></svg>',
 3);

-- ============================================================================
-- KINE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('kine', 'Consultation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="6" x2="15" y2="6"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/><path d="M5 2 L9 2 L9 5 L5 5"/><circle cx="12" cy="19" r="0.5"/></svg>',
 0),

('kine', 'Reeducation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="4" r="2"/><path d="M12 6 L12 14"/><path d="M8 9 L12 7 L16 9"/><path d="M12 14 L8 22"/><path d="M12 14 L16 22"/><path d="M16 9 L20 7"/><path d="M8 9 L4 7"/><circle cx="20" cy="7" r="1.5"/><circle cx="4" cy="7" r="1.5"/></svg>',
 1),

('kine', 'Therapies specifiques',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/><line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/></svg>',
 2);

-- ============================================================================
-- COACHING
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('coaching', 'Coaching individuel',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="8" cy="4" r="2"/><path d="M8 6 L8 14"/><path d="M8 9 L4 12"/><path d="M8 14 L5 22"/><path d="M8 14 L11 22"/><path d="M14 8 L20 8"/><path d="M14 8 L14 16"/><line x1="12" y1="16" x2="16" y2="16"/><path d="M20 8 L20 14"/><circle cx="17" cy="14" r="3"/></svg>',
 0),

('coaching', 'Coaching groupe',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="7" cy="5" r="2"/><circle cx="17" cy="5" r="2"/><circle cx="12" cy="4" r="2"/><path d="M7 7 L7 11"/><path d="M17 7 L17 11"/><path d="M12 6 L12 10"/><path d="M4 11 L7 11 L7 15 L5 20"/><path d="M7 15 L9 20"/><path d="M20 11 L17 11 L17 15 L19 20"/><path d="M17 15 L15 20"/><path d="M12 10 L12 14 L10 19"/><path d="M12 14 L14 19"/></svg>',
 1),

('coaching', 'Nutrition',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="12" r="8"/><path d="M12 4 C12 4 9 6 9 9 C9 12 12 12 12 12 C12 12 15 12 15 9 C15 6 12 4 12 4Z"/><path d="M12 12 L12 20"/><path d="M10 8 L12 6 L14 8"/><path d="M7 16 L9 15"/><path d="M17 16 L15 15"/></svg>',
 2);

-- ============================================================================
-- MEDECIN
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('medecin', 'Consultation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M4 15 C4 15 4 20 9 20 C14 20 14 15 14 15"/><circle cx="9" cy="10" r="5"/><path d="M14 15 L14 11"/><path d="M14 11 C14 11 17 9 19 11 C21 13 19 15 19 15"/><path d="M19 15 L19 19"/><line x1="17" y1="19" x2="21" y2="19"/></svg>',
 0),

('medecin', 'Injections',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M18 2 L22 6"/><path d="M20 4 L10 14"/><rect x="7" y="11" width="10" height="4" rx="1" transform="rotate(-45 12 13)"/><path d="M7.5 16.5 L3 21"/><line x1="15" y1="7" x2="17" y2="9"/><line x1="13" y1="9" x2="15" y2="11"/><line x1="11" y1="11" x2="13" y2="13"/><path d="M3 21 L5 19"/></svg>',
 1),

('medecin', 'Traitements',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="6" y="2" width="12" height="8" rx="2"/><path d="M6 6 L18 6"/><path d="M10 10 L10 14"/><path d="M14 10 L14 14"/><path d="M8 14 L16 14 C17.1 14 18 14.9 18 16 L18 20 C18 21.1 17.1 22 16 22 L8 22 C6.9 22 6 21.1 6 20 L6 16 C6 14.9 6.9 14 8 14Z"/><line x1="6" y1="18" x2="18" y2="18"/></svg>',
 2);

-- ============================================================================
-- DENTISTE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('dentiste', 'Consultation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 2 C9 2 7 4 7 6 C7 8 8 9 8 11 C8 13 6 16 7 19 C8 22 10 22 10.5 19 C11 16 11.5 14 12 14 C12.5 14 13 16 13.5 19 C14 22 16 22 17 19 C18 16 16 13 16 11 C16 9 17 8 17 6 C17 4 15 2 12 2Z"/></svg>',
 0),

('dentiste', 'Soins',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M10 2 C8 2 6 3.5 6 5.5 C6 7 7 8 7 9.5 C7 11 5.5 13 6.5 15.5 C7.5 18 9 18 9.5 15.5 L10 13"/><path d="M14 2 C16 2 18 3.5 18 5.5 C18 7 17 8 17 9.5 C17 11 18.5 13 17.5 15.5 C16.5 18 15 18 14.5 15.5 L14 13"/><path d="M10 13 L14 13"/><line x1="20" y1="5" x2="22" y2="5"/><line x1="20" y1="5" x2="20" y2="10"/><circle cx="21" cy="3" r="1"/></svg>',
 1),

('dentiste', 'Esthetique dentaire',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M4 12 C4 12 6 8 12 8 C18 8 20 12 20 12"/><path d="M4 12 C4 12 6 16 12 16 C18 16 20 12 20 12"/><line x1="8" y1="8" x2="8" y2="16"/><line x1="10.5" y1="8" x2="10.5" y2="16"/><line x1="13.5" y1="8" x2="13.5" y2="16"/><line x1="16" y1="8" x2="16" y2="16"/><path d="M2 4 L6 7"/><path d="M22 4 L18 7"/></svg>',
 2);

-- ============================================================================
-- OSTEOPATHE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('osteopathe', 'Consultation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 2 L12 4"/><circle cx="12" cy="5.5" r="1.5"/><path d="M12 7 L11 9 L13 11 L11 13 L13 15 L11 17 L13 19 L12 22"/><path d="M8 8 L11 9"/><path d="M16 8 L13 9"/><path d="M8 12 L11 13"/><path d="M16 12 L13 13"/><path d="M8 16 L11 17"/><path d="M16 16 L13 17"/></svg>',
 0),

('osteopathe', 'Traitement',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="14" cy="4" r="2"/><path d="M14 6 C14 6 14 9 14 11 C14 13 12 14 12 14"/><path d="M12 14 C12 14 10 15 10 17 L10 22"/><path d="M14 14 L16 22"/><path d="M14 9 L18 8"/><path d="M4 10 C4 10 6 8 8 10 C8 10 8 14 6 15"/><path d="M4 10 L4 15 L6 15"/><path d="M4 13 L6 13"/></svg>',
 1),

('osteopathe', 'Suivi',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="4" x2="8" y2="1"/><line x1="16" y1="4" x2="16" y2="1"/><path d="M8 13 L10 15 L15 11"/><line x1="7" y1="17" x2="12" y2="17"/></svg>',
 2);

-- ============================================================================
-- COMPTABLE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('comptable', 'Consultation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 4 L12 10 L21 4"/><line x1="3" y1="10" x2="8" y2="8"/><line x1="21" y1="10" x2="16" y2="8"/><path d="M8 14 L16 14"/><path d="M8 17 L13 17"/></svg>',
 0),

('comptable', 'Declarations',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M14 2 L6 2 C4.9 2 4 2.9 4 4 L4 20 C4 21.1 4.9 22 6 22 L18 22 C19.1 22 20 21.1 20 20 L20 8 L14 2Z"/><path d="M14 2 L14 8 L20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/><line x1="8" y1="8" x2="10" y2="8"/></svg>',
 1),

('comptable', 'Suivi comptable',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="6" x2="8" y2="18"/><rect x="10" y="9" width="2" height="2"/><rect x="14" y="9" width="2" height="2"/><rect x="10" y="13" width="2" height="2"/><rect x="14" y="13" width="2" height="2"/><rect x="10" y="17" width="6" height="2"/></svg>',
 2);

-- ============================================================================
-- AVOCAT
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('avocat', 'Consultation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><line x1="12" y1="2" x2="12" y2="6"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M5 6 L3 14 C3 14 3 16 7 16 C11 16 11 14 11 14 L9 6"/><path d="M15 6 L13 14 C13 14 13 16 17 16 C21 16 21 14 21 14 L19 6"/><line x1="12" y1="6" x2="12" y2="20"/><line x1="7" y1="20" x2="17" y2="20"/></svg>',
 0),

('avocat', 'Contentieux',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M4 3 L4 7 L20 7 L20 3"/><rect x="7" y="7" width="10" height="4" rx="1"/><line x1="12" y1="11" x2="12" y2="16"/><rect x="5" y="16" width="14" height="5" rx="1"/><circle cx="12" cy="5" r="1"/></svg>',
 1),

('avocat', 'Redaction',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M14 2 L6 2 C4.9 2 4 2.9 4 4 L4 20 C4 21.1 4.9 22 6 22 L18 22 C19.1 22 20 21.1 20 20 L20 8 L14 2Z"/><path d="M14 2 L14 8 L20 8"/><path d="M16 13 L18.5 10.5 C19.33 9.67 19.33 8.33 18.5 7.5 C17.67 6.67 16.33 6.67 15.5 7.5 L8 15 L7 19 L11 18 L16 13Z"/></svg>',
 2);

-- ============================================================================
-- PHOTOGRAPHE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('photographe', 'Shooting',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M23 19 C23 20.1 22.1 21 21 21 L3 21 C1.9 21 1 20.1 1 19 L1 8 C1 6.9 1.9 6 3 6 L7 6 L9 3 L15 3 L17 6 L21 6 C22.1 6 23 6.9 23 8 L23 19Z"/><circle cx="12" cy="13" r="4"/><circle cx="12" cy="13" r="1.5"/></svg>',
 0),

('photographe', 'Retouche',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15 L16 10 L5 21"/><path d="M14 14 L11 17"/><path d="M3 21 L10 14 L14 18"/></svg>',
 1),

('photographe', 'Evenementiel',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M12 2 L12 6"/><path d="M12 6 L8 3"/><path d="M12 6 L16 3"/><circle cx="12" cy="12" r="6"/><path d="M12 8 L12 12 L15 14"/><path d="M4 20 L8 16"/><path d="M20 20 L16 16"/><path d="M2 12 L6 12"/><path d="M18 12 L22 12"/></svg>',
 2);

-- ============================================================================
-- GARAGE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('garage', 'Entretien',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M14.7 6.3 C14.7 6.3 16 2 12 2 C8 2 9.3 6.3 9.3 6.3"/><path d="M9.3 6.3 L4 21"/><path d="M14.7 6.3 L20 21"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5.5" y1="17" x2="18.5" y2="17"/></svg>',
 0),

('garage', 'Reparation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/><path d="M12 5 L12 2"/><path d="M12 22 L12 19"/><path d="M5 12 L2 12"/><path d="M22 12 L19 12"/><path d="M7.05 7.05 L4.93 4.93"/><path d="M19.07 19.07 L16.95 16.95"/><path d="M7.05 16.95 L4.93 19.07"/><path d="M19.07 4.93 L16.95 7.05"/></svg>',
 1),

('garage', 'Diagnostic',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M5 17 L5 11 C5 8 7 6 10 6 L14 6 C17 6 19 8 19 11 L19 17"/><line x1="3" y1="17" x2="21" y2="17"/><circle cx="7.5" cy="14" r="1.5"/><circle cx="16.5" cy="14" r="1.5"/><path d="M10 6 L10 3 L14 3 L14 6"/><path d="M9 17 L9 20"/><path d="M15 17 L15 20"/><line x1="10" y1="11" x2="14" y2="11"/></svg>',
 2);

-- ============================================================================
-- AUTRE
-- ============================================================================
INSERT INTO sector_categories (sector, label, icon_svg, sort_order) VALUES
('autre', 'Consultation',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="4" x2="8" y2="1"/><line x1="16" y1="4" x2="16" y2="1"/><line x1="7" y1="13" x2="7" y2="13.01"/><line x1="12" y1="13" x2="12" y2="13.01"/><line x1="17" y1="13" x2="17" y2="13.01"/><line x1="7" y1="17" x2="7" y2="17.01"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>',
 0),

('autre', 'Suivi',
 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3 L9 1 L15 1 L15 3"/><path d="M8 10 L10 12 L16 6"/><line x1="8" y1="16" x2="16" y2="16"/><line x1="8" y1="19" x2="13" y2="19"/></svg>',
 1);
