/**
 * Public OAuth routes for client booking authentication
 * Mounted at /api/public/auth
 *
 * Flow:
 *   1. GET  /api/public/auth/:provider?slug=X     → redirect to provider
 *   2. GET  /api/public/auth/google/callback       → exchange code, create pickup key
 *      GET  /api/public/auth/facebook/callback
 *      POST /api/public/auth/apple/callback         (form_post)
 *   3. GET  /api/public/auth/pickup/:key            → return { name, email, provider, provider_id }
 */

const router = require('express').Router();
const crypto = require('crypto');
const { query } = require('../../services/db');
const { authLimiter, slotsLimiter } = require('../../middleware/rate-limiter');
const oauth = require('../../services/oauth');

const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// DB-backed OAuth state store (same pattern as calendar.js)
const oauthStates = {
  async set(key, val) {
    await query(
      `INSERT INTO oauth_states (state_key, data, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (state_key) DO UPDATE SET data = $2, expires_at = $3`,
      [key, JSON.stringify(val), new Date(val.expiresAt).toISOString()]
    );
  },
  async get(key) {
    const r = await query(`SELECT data FROM oauth_states WHERE state_key = $1 AND expires_at > NOW()`, [key]);
    if (r.rows.length === 0) return null;
    const d = r.rows[0].data;
    return typeof d === 'string' ? JSON.parse(d) : d; // JSONB columns are auto-parsed by pg
  },
  async delete(key) {
    await query(`DELETE FROM oauth_states WHERE state_key = $1`, [key]);
  }
};

// ============================================================
// GET /api/public/auth/providers
// Returns list of configured providers (for frontend to show/hide buttons)
// ============================================================
// H#13 fix: limiter slotsLimiter (60/min) pour éviter l'énumération des providers
// configurés côté serveur. Un endpoint ouvert sans limit est inutilement scanable.
router.get('/providers', slotsLimiter, (req, res) => {
  res.json({ providers: oauth.getConfiguredProviders() });
});

// ============================================================
// GET /api/public/auth/:provider?slug=SLUG
// Initiate OAuth flow — redirect to provider
// ============================================================
router.get('/:provider', authLimiter, async (req, res) => {
  try {
    const { provider } = req.params;
    const { slug, page } = req.query;

    if (!slug) {
      return res.status(400).json({ error: 'slug requis' });
    }
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'slug invalide' });
    }

    if (!['google', 'apple', 'facebook'].includes(provider)) {
      return res.status(400).json({ error: 'Provider inconnu' });
    }

    if (!oauth.isProviderConfigured(provider)) {
      return res.status(501).json({ error: `${provider} non configuré` });
    }

    // page=pass → redirect to pass page after auth; default = book
    const returnPage = page === 'pass' ? 'pass' : 'book';

    const state = crypto.randomBytes(24).toString('hex');
    await oauthStates.set(state, {
      slug,
      provider,
      page: returnPage,
      expiresAt: Date.now() + 10 * 60000 // 10 min
    });

    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const callbackPath = provider === 'apple'
      ? `/api/public/auth/apple/callback`
      : `/api/public/auth/${provider}/callback`;
    const redirectUri = `${baseUrl}${callbackPath}`;

    // Store slug in cookie as fallback in case state lookup fails on callback
    res.setHeader('Set-Cookie', `oauth_slug=${encodeURIComponent(slug)}; Max-Age=900; Path=/api/public/auth; HttpOnly; SameSite=None; Secure`);
    const url = oauth.getAuthUrl(provider, state, redirectUri);
    res.redirect(url);
  } catch (err) {
    console.error(`[OAUTH] ${req.params.provider} connect error:`, err.message);
    const slug = req.query.slug || '';
    // M2: Validate slug to prevent open redirect (only allow alphanumeric + hyphens)
    const safeSlug = /^[a-zA-Z0-9_-]+$/.test(slug) ? slug : '';
    const errPage = req.query.page === 'pass' ? 'pass' : 'book';
    res.redirect(safeSlug ? `/${safeSlug}/${errPage}?oauth_error=auth_failed` : `/?oauth_error=auth_failed`);
  }
});

// ============================================================
// GET /api/public/auth/google/callback
// ============================================================
router.get('/google/callback', async (req, res) => {
  await handleCallback('google', req.query, null, req, res);
});

// ============================================================
// GET /api/public/auth/facebook/callback
// ============================================================
router.get('/facebook/callback', async (req, res) => {
  await handleCallback('facebook', req.query, null, req, res);
});

// ============================================================
// GET /api/public/auth/pickup-cookie
// H#18 v2: consume pickupKey from httpOnly cookie (no secret in URL).
// Replaces /pickup/:key — frontend calls this with no arg, cookie provides key.
// ============================================================
router.get('/pickup-cookie', async (req, res) => {
  try {
    // H#18 v2 regression fix: `req.cookies` undefined (cookie-parser NOT installed
    // in this app). server.js:309-317 a un helper `parseCookies(req)` custom mais
    // non exporté. On duplique les 4 lignes inline pour éviter un refactor d'import.
    const cookies = {};
    (req.headers.cookie || '').split(';').forEach(c => {
      const [k, v] = c.trim().split('=');
      if (k) cookies[k] = decodeURIComponent(v || '');
    });
    const cookieKey = cookies.oauth_pickup;
    if (!cookieKey) {
      return res.status(404).json({ error: 'Aucune session OAuth en cours' });
    }
    const r = await query(
      `DELETE FROM oauth_states WHERE state_key = $1 AND expires_at > NOW() RETURNING data`,
      [cookieKey]
    );
    // Clear cookie immediately (one-shot consumption even on error).
    // Path doit matcher celui du Set-Cookie — maintenant `/` (v2 regression fix).
    res.clearCookie('oauth_pickup', { path: '/' });
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Lien expiré ou déjà utilisé' });
    }
    const data = typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data;
    if (!data || data.type !== 'pickup') {
      return res.status(404).json({ error: 'Lien expiré ou déjà utilisé' });
    }
    res.json({
      name: data.name || '',
      email: data.email || '',
      provider: data.provider,
      provider_id: data.providerId
    });
  } catch (err) {
    console.error('[OAUTH] Pickup cookie error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// POST /api/public/auth/apple/callback (form_post)
// ============================================================
router.post('/apple/callback', async (req, res) => {
  // Apple sends code, state, id_token, and optionally user (JSON string) in body
  await handleCallback('apple', req.body, req.body.user, req, res);
});

// ============================================================
// GET /api/public/auth/pickup/:key
// One-time pickup of OAuth data — used by frontend after redirect
// ============================================================
router.get('/pickup/:key', async (req, res) => {
  try {
    // M1: Atomic pickup — DELETE ... RETURNING in one query to prevent TOCTOU
    const r = await query(
      `DELETE FROM oauth_states WHERE state_key = $1 AND expires_at > NOW() RETURNING data`,
      [req.params.key]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Lien expiré ou déjà utilisé' });
    }
    const data = typeof r.rows[0].data === 'string' ? JSON.parse(r.rows[0].data) : r.rows[0].data;
    if (!data || data.type !== 'pickup') {
      return res.status(404).json({ error: 'Lien expiré ou déjà utilisé' });
    }

    res.json({
      name: data.name || '',
      email: data.email || '',
      provider: data.provider,
      provider_id: data.providerId
    });
  } catch (err) {
    console.error('[OAUTH] Pickup error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// Shared callback handler
// ============================================================
async function handleCallback(provider, params, appleUserObj, req, res) {
  const { code, state, error } = params;
  let slug = '';

  // M2: validate slug to prevent open redirect — only alphanumeric + hyphens allowed
  const sanitizeSlug = (s) => (s && /^[a-zA-Z0-9_-]+$/.test(s)) ? s : '';
  // Fallback slug from cookie (set before redirect to provider)
  const parseCookie = (name) => {
    const match = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  };
  const cookieSlug = sanitizeSlug(parseCookie('oauth_slug'));
  // Track return page (book or pass) from state
  let returnPage = 'book';
  // Helper to build safe redirect (avoids //book protocol-relative URL when slug is empty)
  const bookUrl = (qs) => {
    const s = slug || cookieSlug;
    return s ? `/${s}/${returnPage}?${qs}` : `/?${qs}`;
  };

  try {
    if (error) {
      // User denied access or error from provider
      const session = state ? await oauthStates.get(state) : null;
      slug = sanitizeSlug(session?.slug);
      returnPage = session?.page || 'book';
      if (state) await oauthStates.delete(state);
      return res.redirect(bookUrl(`oauth_error=${encodeURIComponent(error)}`));
    }

    if (!state || !code) {
      return res.redirect(bookUrl(`oauth_error=${encodeURIComponent('Paramètres manquants')}`));
    }

    // Validate state
    const session = await oauthStates.get(state);
    if (!session) {
      return res.redirect(bookUrl(`oauth_error=${encodeURIComponent('Session expirée, réessayez')}`));
    }

    slug = sanitizeSlug(session.slug);
    returnPage = session.page || 'book';

    // H#17 fix: check expiration BEFORE consuming state — if the state is expired
    // we don't need to delete it (oauthStates.get already filters expired rows),
    // and keeping delete post-check means a legitimate retry on expiration doesn't
    // burn the state. Consumption stays one-shot via the delete after the check.
    if (Date.now() > session.expiresAt) {
      return res.redirect(bookUrl(`oauth_error=${encodeURIComponent('Session expirée, réessayez')}`));
    }
    await oauthStates.delete(state);

    // Exchange code for tokens
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const callbackPath = provider === 'apple'
      ? `/api/public/auth/apple/callback`
      : `/api/public/auth/${provider}/callback`;
    const redirectUri = `${baseUrl}${callbackPath}`;

    const tokens = await oauth.exchangeCode(provider, code, redirectUri);

    // Get user info
    const userInfo = await oauth.getUserInfo(provider, tokens, appleUserObj);

    if (!userInfo.email) {
      return res.redirect(bookUrl(`oauth_error=${encodeURIComponent('Email non disponible depuis ' + provider)}`));
    }

    // Apple only sends name on first authorization — fallback to existing client record
    let userName = userInfo.name;
    if (!userName && userInfo.email && slug) {
      try {
        const bizR = await query(`SELECT id FROM businesses WHERE slug = $1 AND is_active = true`, [slug]);
        if (bizR.rows.length) {
          const clR = await query(
            `SELECT full_name FROM clients WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
            [bizR.rows[0].id, userInfo.email]
          );
          if (clR.rows.length && clR.rows[0].full_name) {
            userName = clR.rows[0].full_name;
          }
        }
      } catch (e) { console.error('[OAUTH] Client name lookup failed:', e.message); }
    }

    // Store in pickup key for frontend to fetch
    const pickupKey = crypto.randomBytes(16).toString('hex');
    await oauthStates.set(pickupKey, {
      type: 'pickup',
      name: userName,
      email: userInfo.email,
      provider,
      providerId: userInfo.providerId,
      expiresAt: Date.now() + 5 * 60000 // 5 min
    });

    // H#18 fix: la clé pickup était dans l'URL (`?oauth_pickup=KEY`) → apparaît
    // dans access logs Nginx/Render, Referer des scripts tiers (GA/FB Pixel
    // éventuellement), history navigateur. Passer par un cookie httpOnly scopé
    // au chemin du minisite élimine cette fuite. La clé reste one-shot + 5 min
    // TTL, le frontend lit le cookie au load puis appelle /api/public/auth/pickup.
    // H#18 v2 regression fix: path doit être `/` (pas `/${slug}`) sinon le cookie
    // n'est PAS envoyé sur les requêtes vers `/api/public/auth/pickup-cookie`.
    // La sécurité du pickupKey vient de : (a) aléatoire 32 hex chars, (b) one-shot
    // DELETE RETURNING, (c) TTL 5 min, (d) cookie httpOnly + sameSite=lax + Secure.
    // Le path scope n'apporte pas de protection supplémentaire ici.
    res.cookie('oauth_pickup', pickupKey, {
      maxAge: 5 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
    // H#18 v2 fix: la clé pickupKey N'EST PLUS dans l'URL (retirée du query param).
    // Seul le cookie httpOnly transporte le secret. Le frontend signal "user revient
    // d'OAuth" via `?oauth=1` (valeur constante, pas un secret) et appelle
    // GET /api/public/auth/pickup-cookie qui consomme le cookie server-side.
    res.redirect(`/${slug}/${returnPage}?oauth=1`);
  } catch (err) {
    // H#11 fix: err.message peut contenir détails providers (Google response
    // structure, tokens partiels, IDs internes) → apparaît dans URL → logs
    // Nginx/Render + Referer + history. On log server-side et renvoie un code
    // générique côté client.
    console.error(`[OAUTH] ${provider} callback error:`, err.message, err.stack);
    res.redirect(bookUrl(`oauth_error=oauth_exchange_failed`));
  }
}

module.exports = router;
