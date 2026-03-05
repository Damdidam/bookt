-- V34: Add color column to business_categories
-- Colors are now a category-level property, not service-level

ALTER TABLE business_categories ADD COLUMN IF NOT EXISTS color VARCHAR(20);

-- Backfill: set category color from the most-used service color in each category
UPDATE business_categories bc
SET color = sub.color
FROM (
  SELECT DISTINCT ON (s.category)
    s.category,
    s.color
  FROM services s
  WHERE s.business_id = bc.business_id
    AND s.category IS NOT NULL
    AND s.color IS NOT NULL
  GROUP BY s.category, s.color
  ORDER BY s.category, COUNT(*) DESC
) sub
WHERE bc.label = sub.category
  AND bc.color IS NULL;
