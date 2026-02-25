-- ============================================================
-- GENDA v9 — Calendar Enhancement
-- Adds: booking notes, reminders, practitioner todos
-- Run AFTER schema-v8-rbac.sql
-- ============================================================

-- ============================================================
-- 1. BOOKING_NOTES — practitioner private notes on bookings
-- UI: Calendar > Event detail > Notes tab
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_notes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  content       TEXT NOT NULL,
  is_pinned     BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_notes_booking
  ON booking_notes(booking_id, created_at DESC);

ALTER TABLE booking_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON booking_notes
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 2. BOOKING_REMINDERS — configurable practitioner reminders
-- UI: Calendar > Event detail > Reminders
-- Cron: checks every minute for due reminders
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_reminders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remind_at     TIMESTAMPTZ NOT NULL,
  offset_minutes INTEGER NOT NULL DEFAULT 30,    -- 15, 30, 60, 1440 (1 day)
  channel       VARCHAR(20) DEFAULT 'browser'    -- 'browser', 'email', 'both'
    CHECK (channel IN ('browser', 'email', 'both')),
  message       TEXT,                             -- custom message (optional)
  is_sent       BOOLEAN DEFAULT false,
  sent_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_reminders_due
  ON booking_reminders(remind_at)
  WHERE is_sent = false;

CREATE INDEX IF NOT EXISTS idx_booking_reminders_booking
  ON booking_reminders(booking_id);

ALTER TABLE booking_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON booking_reminders
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 3. PRACTITIONER_TODOS — mini tasks linked to bookings
-- UI: Calendar > Event detail > Todo list
-- ============================================================
CREATE TABLE IF NOT EXISTS practitioner_todos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id    UUID REFERENCES bookings(id) ON DELETE CASCADE,  -- nullable = standalone todo
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       VARCHAR(500) NOT NULL,
  is_done       BOOLEAN DEFAULT false,
  done_at       TIMESTAMPTZ,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practitioner_todos_booking
  ON practitioner_todos(booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_practitioner_todos_user
  ON practitioner_todos(user_id, is_done, created_at DESC);

ALTER TABLE practitioner_todos ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON practitioner_todos
  USING (business_id = current_setting('app.current_business_id')::uuid);

-- ============================================================
-- 4. EXTEND BOOKINGS — add color and internal notes field
-- ============================================================
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS color VARCHAR(7),            -- hex color override (e.g. '#E07A5F')
  ADD COLUMN IF NOT EXISTS internal_note TEXT,           -- quick note (visible in calendar hover)
  ADD COLUMN IF NOT EXISTS reminder_default INTEGER DEFAULT 30;  -- default reminder offset in minutes

-- ============================================================
-- 5. TRIGGERS
-- ============================================================
CREATE TRIGGER trg_booking_notes_updated BEFORE UPDATE ON booking_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6. DEFAULT REMINDER PRESETS per business
-- ============================================================
-- Add to business settings JSONB: 
--   "reminder_presets": [15, 30, 60, 1440]
-- This is handled in app logic, not schema

-- ============================================================
-- DONE. v9 migration adds:
--   - booking_notes (practitioner private notes)
--   - booking_reminders (configurable, cron-driven)
--   - practitioner_todos (mini task list per booking)
--   - Extended bookings (color, internal_note, reminder_default)
--   - All RLS + indexes + triggers
-- ============================================================
