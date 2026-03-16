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
    const { slug, return_to } = req.query;

    if (!slug) {
      return res.status(400).json({ error: 'slug requis' });
    }

    if (!['google', 'apple', 'facebook'].includes(provider)) {
      return res.status(400).json({ error: 'Provider inconnu' });
    }

    if (!oauth.isProviderConfigured(provider)) {
      return res.status(501).json({ error: `${provider} non configuré` });
    }

    const state = crypto.randomBytes(24).toString('hex');
    await oauthStates.set(state, {
      slug,
      provider,
      returnTo: return_to === 'site' ? 'site' : 'book',
      expiresAt: Date.now() + 10 * 60000 // 10 min
    });

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const callbackPath = provider === 'apple'
      ? `/api/public/auth/apple/callback`
      : `/api/public/auth/${provider}/callback`;
    const redirectUri = `${baseUrl}${callbackPath}`;

    const url = oauth.getAuthUrl(provider, state, redirectUri);
    res.redirect(url);
  } catch (err) {
    console.error(`[OAUTH] ${req.params.provider} connect error:`, err.message);
    const slug = req.query.slug || '';
    // M2: Validate slug to prevent open redirect (only allow alphanumeric + hyphens)
    const safeSlug = /^[a-zA-Z0-9_-]+$/.test(slug) ? slug : '';
    res.redirect(safeSlug ? `/${safeSlug}/book?oauth_error=auth_failed` : `/?oauth_error=auth_failed`);
  }
});

// ============================================================
// GET /api/public/auth/google/callback
// ============================================================
router.get('/google/callback', async (req, res) => {
  await handleCallback('google', req.query, null, res);
});

// ============================================================
// GET /api/public/auth/facebook/callback
// ============================================================
router.get('/facebook/callback', async (req, res) => {
  await handleCallback('facebook', req.query, null, res);
});

// ============================================================
// POST /api/public/auth/apple/callback (form_post)
// ============================================================
router.post('/apple/callback', async (req, res) => {
  // Apple sends code, state, id_token, and optionally user (JSON string) in body
  await handleCallback('apple', req.body, req.body.user, res);
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
async function handleCallback(provider, params, appleUserObj, res) {
  const { code, state, error } = params;
  let slug = '';

  // M2: validate slug to prevent open redirect — only alphanumeric + hyphens allowed
  const sanitizeSlug = (s) => (s && /^[a-zA-Z0-9_-]+$/.test(s)) ? s : '';
  let returnTo = 'book';
  // Helper to build safe redirect (avoids //book protocol-relative URL when slug is empty)
  const bookUrl = (qs) => slug ? `/${slug}/book?${qs}` : `/?${qs}`;
  const siteUrl = (qs) => slug ? `/${slug}?${qs}` : `/?${qs}`;
  const redirectUrl = (qs) => returnTo === 'site' ? siteUrl(qs) : bookUrl(qs);

  try {
    if (error) {
      // User denied access or error from provider
      const session = state ? await oauthStates.get(state) : null;
      slug = sanitizeSlug(session?.slug);
      returnTo = session?.returnTo || 'book';
      if (state) await oauthStates.delete(state);
      return res.redirect(redirectUrl(`oauth_error=${encodeURIComponent(error)}`));
    }

    if (!state || !code) {
      return res.redirect(`/?oauth_error=${encodeURIComponent('Paramètres manquants')}`);
    }

    // Validate state
    const session = await oauthStates.get(state);
    if (!session) {
      return res.redirect(`/?oauth_error=${encodeURIComponent('Session expirée, réessayez')}`);
    }

    slug = sanitizeSlug(session.slug);
    returnTo = session.returnTo || 'book';
    await oauthStates.delete(state);

    // Check expiration
    if (Date.now() > session.expiresAt) {
      return res.redirect(redirectUrl(`oauth_error=${encodeURIComponent('Session expirée, réessayez')}`));
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
      return res.redirect(redirectUrl(`oauth_error=${encodeURIComponent('Email non disponible depuis ' + provider)}`));
    }

    // Store in pickup key for frontend to fetch
    const pickupKey = crypto.randomBytes(16).toString('hex');
    await oauthStates.set(pickupKey, {
      type: 'pickup',
      name: userInfo.name,
      email: userInfo.email,
      provider,
      providerId: userInfo.providerId,
      expiresAt: Date.now() + 5 * 60000 // 5 min
    });

    res.redirect(redirectUrl(`oauth_pickup=${pickupKey}`));
  } catch (err) {
    console.error(`[OAUTH] ${provider} callback error:`, err.message);
    res.redirect(redirectUrl(`oauth_error=${encodeURIComponent('Erreur d\'authentification, réessayez')}`));
  }
}

module.exports = router;
