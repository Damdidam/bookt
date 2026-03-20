-- v30: OAuth client columns for booking authentication
-- Allows clients to authenticate via Google/Apple/Facebook when booking
ALTER TABLE clients ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS oauth_provider_id VARCHAR(200);
