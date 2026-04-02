ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_count_month integer DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_month_reset_at timestamptz;
