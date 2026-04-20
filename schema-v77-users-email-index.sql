-- v77: index fonctionnel LOWER(email) sur users pour perf login/signup.
--
-- H#6 / H#7 — Avant ce fix :
--   - /api/auth/login  : WHERE u.email = $1 (pg ne peut pas utiliser un index
--                        sur `email` si on veut comparer LOWER()) — scan table
--                        à chaque tentative. Timing side-channel sur existence
--                        de compte + DoS via authLimiter bypass (botnet).
--   - /api/auth/forgot-password : idem ligne 275-279.
--   - /api/staff/signup : SELECT email FROM users WHERE is_active = true
--                        chargé intégralement en mémoire puis map JS — pire
--                        que linéaire, catastrophique à 10k+ users.
--
-- Fix : index fonctionnel `btree(LOWER(email))`. Les queries doivent utiliser
--       `WHERE LOWER(email) = $1` pour le planner puisse l'utiliser.
--
-- CONCURRENTLY pour ne pas verrouiller la table pendant la création (prod live).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower
  ON users (LOWER(email));
