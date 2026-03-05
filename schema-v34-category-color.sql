-- V34: Add color column to business_categories
-- Colors are now a category-level property, not service-level

ALTER TABLE business_categories ADD COLUMN IF NOT EXISTS color VARCHAR(20);

-- Backfill: set category color from the most-used service color in each category
UPDATE business_categories bc
SET color = sub.top_color
FROM (
  SELECT bc2.id AS bc_id, x.color AS top_color
  FROM business_categories bc2
  JOIN LATERAL (
    SELECT s.color, COUNT(*) AS cnt
    FROM services s
    WHERE s.business_id = bc2.business_id
      AND s.category = bc2.label
      AND s.color IS NOT NULL
    GROUP BY s.color
    ORDER BY cnt DESC
    LIMIT 1
  ) x ON true
  WHERE bc2.color IS NULL
) sub
WHERE bc.id = sub.bc_id;
