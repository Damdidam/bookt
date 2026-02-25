-- ============================================================
-- CALENDAR CONNECTIONS (Google Calendar + Outlook)
-- OAuth2 tokens + sync state per practitioner
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_connections (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practitioner_id UUID REFERENCES practitioners(id) ON DELETE SET NULL,

  -- Provider
  provider        VARCHAR(10) NOT NULL                   -- 'google' | 'outlook'
    CHECK (provider IN ('google', 'outlook')),

  -- OAuth2 tokens (encrypted at rest in production)
  access_token    TEXT NOT NULL,
  refresh_token   TEXT,
  token_expires_at TIMESTAMPTZ,
  scope           TEXT,

  -- Calendar info
  calendar_id     VARCHAR(300),                          -- Google: calendarId, Outlook: calendar ID
  calendar_name   VARCHAR(200),                          -- Display name
  email           VARCHAR(200),                          -- Connected account email

  -- Sync settings
  sync_direction  VARCHAR(10) DEFAULT 'both'             -- 'push' | 'pull' | 'both'
    CHECK (sync_direction IN ('push', 'pull', 'both')),
  sync_enabled    BOOLEAN DEFAULT true,
  last_sync_at    TIMESTAMPTZ,
  sync_token      TEXT,                                  -- Google: nextSyncToken, Outlook: deltaLink

  -- Status
  status          VARCHAR(15) DEFAULT 'active'           -- 'active' | 'expired' | 'revoked' | 'error'
    CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  error_message   TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(business_id, user_id, provider)
);

CREATE INDEX idx_cal_conn_business ON calendar_connections(business_id);
CREATE INDEX idx_cal_conn_user ON calendar_connections(user_id);

-- Track synced events (link Bookt booking <-> external event)
CREATE TABLE IF NOT EXISTS calendar_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  connection_id   UUID NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  booking_id      UUID REFERENCES bookings(id) ON DELETE CASCADE,
  
  -- External event reference
  external_event_id VARCHAR(500) NOT NULL,               -- Google/Outlook event ID
  external_link   VARCHAR(500),                          -- Link to event in calendar

  -- Direction: did we push this or pull it?
  direction       VARCHAR(4) NOT NULL DEFAULT 'push'     -- 'push' (Bookt→Cal) | 'pull' (Cal→Bookt)
    CHECK (direction IN ('push', 'pull')),

  -- For pulled events (external busy blocks)
  title           VARCHAR(300),
  start_at        TIMESTAMPTZ,
  end_at          TIMESTAMPTZ,
  is_busy         BOOLEAN DEFAULT true,                  -- Block this time in booking flow?

  synced_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cal_events_connection ON calendar_events(connection_id);
CREATE INDEX idx_cal_events_booking ON calendar_events(booking_id);
CREATE UNIQUE INDEX idx_cal_events_external ON calendar_events(connection_id, external_event_id);

-- RLS
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_isolation_cal_conn ON calendar_connections
  USING (business_id = current_setting('app.current_business_id')::uuid);
CREATE POLICY business_isolation_cal_events ON calendar_events
  USING (connection_id IN (SELECT id FROM calendar_connections WHERE business_id = current_setting('app.current_business_id')::uuid));
