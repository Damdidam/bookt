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
const { authLimiter } = require('../../middleware/rate-limiter');
const oauth = require('../../services/oauth');

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
router.get('/providers', (req, res) => {
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

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
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
    await oauthStates.delete(state);

    // Check expiration
    if (Date.now() > session.expiresAt) {
      return res.redirect(bookUrl(`oauth_error=${encodeURIComponent('Session expirée, réessayez')}`));
    }

    // Exchange code for tokens
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
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

    res.redirect(`/${slug}/${returnPage}?oauth_pickup=${pickupKey}`);
  } catch (err) {
    console.error(`[OAUTH] ${provider} callback error:`, err.message);
    res.redirect(bookUrl(`oauth_error=${encodeURIComponent('Erreur d\'authentification, réessayez')}`));
  }
}

module.exports = router;
