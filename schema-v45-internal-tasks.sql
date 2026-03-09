-- v45: Internal tasks (calendar tasks without clients)
CREATE TABLE IF NOT EXISTS internal_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  color VARCHAR(7),
  note TEXT,
  status VARCHAR(12) DEFAULT 'planned' CHECK (status IN ('planned','completed','cancelled')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_tasks_business_range ON internal_tasks(business_id, start_at);
CREATE INDEX IF NOT EXISTS idx_internal_tasks_practitioner ON internal_tasks(practitioner_id, start_at);
