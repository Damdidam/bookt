-- v24: Add category column to businesses for terminology adaptation
-- Categories: sante, beaute, juridique_finance, education, creatif, autre

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'autre';

-- Migrate existing sectors to categories
UPDATE businesses SET category = CASE
  WHEN sector IN ('medecin','dentiste','kine','osteopathe','bien_etre') THEN 'sante'
  WHEN sector IN ('coiffeur','esthetique') THEN 'beaute'
  WHEN sector IN ('comptable','avocat') THEN 'juridique_finance'
  WHEN sector = 'photographe' THEN 'creatif'
  ELSE 'autre'
END
WHERE category IS NULL OR category = 'autre';
