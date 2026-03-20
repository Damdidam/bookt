-- v47: Multi-practitioner task groups
ALTER TABLE internal_tasks ADD COLUMN IF NOT EXISTS group_id UUID;

CREATE INDEX IF NOT EXISTS idx_internal_tasks_group
  ON internal_tasks(group_id)
  WHERE group_id IS NOT NULL;
