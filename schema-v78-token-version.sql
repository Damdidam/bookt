-- v78: token_version column for JWT revocation on logout / password change.
--
-- H#14 / H#15 fix — Before this migration, POST /api/auth/logout was a no-op:
-- the server just replied 200 and the JWT stayed valid for its full lifetime
-- (8h default, up to 24h). If a token was exfiltrated (XSS, log leak, backup),
-- the attacker could keep using it long after the user logged out.
--
-- We now embed `tv` (token_version) in every JWT and compare it to
-- users.token_version in requireAuth. Logout / change-password / reset-password
-- increment the column → all prior tokens fail verification on the next request.
--
-- Default 0 so existing tokens remain valid until issued-after-this-migration.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
