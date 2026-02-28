-- =============================================
-- SCHEMA v19 — Enhanced call filtering
-- Strict simplifié, vacances, horaires, messages custom, blacklist
-- =============================================

-- 1. Add vacation + custom message fields to call_settings
ALTER TABLE call_settings
  ADD COLUMN IF NOT EXISTS vacation_until DATE,
  ADD COLUMN IF NOT EXISTS vacation_message_fr TEXT,
  ADD COLUMN IF NOT EXISTS vacation_message_nl TEXT,
  ADD COLUMN IF NOT EXISTS vacation_redirect_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS vacation_redirect_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS custom_message_fr TEXT,
  ADD COLUMN IF NOT EXISTS custom_message_nl TEXT,
  ADD COLUMN IF NOT EXISTS custom_sms_fr TEXT,
  ADD COLUMN IF NOT EXISTS custom_sms_nl TEXT,
  ADD COLUMN IF NOT EXISTS repeat_caller_threshold INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS repeat_caller_window_min INTEGER DEFAULT 15;

-- 2. Update filter_mode CHECK to include 'vacation'
ALTER TABLE call_settings DROP CONSTRAINT IF EXISTS call_settings_filter_mode_check;
ALTER TABLE call_settings ADD CONSTRAINT call_settings_filter_mode_check
  CHECK (filter_mode IN ('off', 'soft', 'strict', 'schedule_based', 'vacation'));

-- 3. Update call_logs action CHECK for new actions
ALTER TABLE call_logs DROP CONSTRAINT IF EXISTS call_logs_action_check;
ALTER TABLE call_logs ADD CONSTRAINT call_logs_action_check
  CHECK (action IN (
    'whitelist_pass',
    'played_message',
    'forwarded',
    'sent_sms',
    'urgent_key',
    'voicemail',
    'hung_up',
    'blacklist_reject',
    'vacation_message',
    'repeat_transfer',
    'schedule_filter'
  ));

-- 4. Create blacklist table
CREATE TABLE IF NOT EXISTS call_blacklist (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone_e164    VARCHAR(30) NOT NULL,
  label         VARCHAR(100),
  reason        VARCHAR(30) DEFAULT 'manual'
    CHECK (reason IN ('manual', 'spam', 'repeat_no_booking')),
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blacklist_lookup
  ON call_blacklist(business_id, phone_e164) WHERE is_active = true;

-- 5. RLS for blacklist
ALTER TABLE call_blacklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_isolation ON call_blacklist
  USING (business_id = current_setting('app.business_id')::uuid);

SELECT 'schema-v19 applied — enhanced call filtering OK' AS status;
