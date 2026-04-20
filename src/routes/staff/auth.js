const router = require('express').Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query, pool } = require('../../services/db');
const { authLimiter } = require('../../middleware/rate-limiter');
const { requireAuth } = require('../../middleware/auth');
const { sendEmail, buildEmailHTML, escHtml } = require('../../services/email');

// H#16 v3: REAL dummy bcrypt hash (60 chars, valid base64 alphabet).
// The previous const `'$2b$12$K4z0...x...'` was 58 chars + contained `x` (hors
// alphabet `./A-Za-z0-9`), donc bcrypt.compare rejetait en 1ms au lieu des
// ~400ms d'un vrai hash — signal timing direct "email absent" via la branche
// password. On génère un vrai hash au load du module (random secret, jamais
// utilisable) pour que bcrypt.compare tourne ses 2^12 rounds normalement.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);

// ============================================================
// POST /api/auth/login
// Request a magic link (or password login fallback)
// UI: Dashboard login screen
// ============================================================
router.post('/login', authLimiter, async (req, res, next) => {
  // H#16 v2/v3/v4: timing attack fix — bound la latence totale sur TOUS les
  // chemins 200/401 de /login (magic link + password). Sans ça, le delta SELECT
  // JOIN businesses (~15-30ms) entre email absent (0 row) et email existant
  // (1 row + JOIN) reste détectable statistiquement. bounded() ajoute le delta
  // restant pour arriver dans la fenêtre 400-500ms sur toutes les sorties non-400.
  const tStart = Date.now();
  const minMagicLinkMs = 400 + Math.floor(Math.random() * 100); // 400-500ms
  const bounded = async (status, payload) => {
    const elapsed = Date.now() - tStart;
    if (elapsed < minMagicLinkMs) {
      await new Promise((r) => setTimeout(r, minMagicLinkMs - elapsed));
    }
    return res.status(status).json(payload);
  };
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }
    // H#8 fix: bcrypt.compare cost is linear in input length. express.json accepts
    // up to 5MB by default — a single 5MB password would hang the event loop for
    // hundreds of ms. Cap at 128 chars (well above any real password).
    if (password != null && typeof password === 'string' && password.length > 128) {
      return res.status(400).json({ error: 'Mot de passe trop long' });
    }

    // Find user — LOWER(u.email) to leverage the functional index idx_users_email_lower (v77)
    // and stay case-insensitive even if legacy rows were inserted with mixed case.
    const result = await query(
      `SELECT u.id, u.email, u.role, u.password_hash, u.business_id, u.token_version,
              b.name AS business_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE LOWER(u.email) = $1 AND u.is_active = true AND b.is_active = true`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      // Don't reveal whether email exists — dummy bcrypt (real hash) + bounded().
      if (password) {
        await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
        return bounded(401, { error: 'Email ou mot de passe incorrect' });
      }
      return bounded(200, { message: 'Si ce compte existe, un lien de connexion a été envoyé.' });
    }

    const user = result.rows[0];

    // Password login (fallback)
    if (password && user.password_hash) {
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return bounded(401, { error: 'Email ou mot de passe incorrect' });
      }

      const token = jwt.sign(
        { userId: user.id, businessId: user.business_id, tv: user.token_version || 0 },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
      );

      await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      // Fetch business details + practitioner link for frontend
      const bizResult = await query(
        `SELECT b.id, b.slug, b.name, b.sector, b.category, b.plan, b.settings,
                p.id AS practitioner_id, p.display_name AS practitioner_name
         FROM businesses b
         LEFT JOIN practitioners p ON p.user_id = $2 AND p.business_id = b.id AND p.is_active = true
         WHERE b.id = $1`, [user.business_id, user.id]
      );
      const biz = bizResult.rows[0];

      // Note: succès login = 200 avec token. Pas bounded() car le delta SELECT
      // supplémentaire (UPDATE + JOIN practitioners) s'intègre naturellement dans
      // la fenêtre — et un login valide est une action user légitime, pas un
      // point d'énumération. L'attaquant qui connaît déjà le password n'a plus
      // besoin d'énumérer.
      return bounded(200, {
        token,
        user: { id: user.id, email: user.email, role: user.role, business_name: user.business_name, practitioner_id: biz.practitioner_id || null, practitioner_name: biz.practitioner_name || null },
        business: { id: biz.id, slug: biz.slug, name: biz.name, sector: biz.sector || 'autre', category: biz.category || 'autre', plan: biz.plan || 'free', settings: biz.settings || {} }
      });
    }

    if (password && !user.password_hash) {
      // H#16 v3/v4: message générique identique + bcrypt dummy + bounded().
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return bounded(401, { error: 'Email ou mot de passe incorrect' });
    }

    // Magic link flow
    // 1. Invalidate previous unused links
    await query(
      `UPDATE magic_links SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    // 2. Create new magic link
    const mlResult = await query(
      `INSERT INTO magic_links (user_id) VALUES ($1) RETURNING token, expires_at`,
      [user.id]
    );

    const magicToken = mlResult.rows[0].token;
    const magicUrl = `${process.env.MAGIC_LINK_BASE_URL}?token=${magicToken}`;

    // 3. Send magic link email via Brevo
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n  Magic link for ${email}: ${magicUrl}\n`);
    }

    const html = buildEmailHTML({
      title: 'Votre lien de connexion',
      preheader: 'Cliquez pour vous connecter à votre espace Genda',
      bodyHTML: `<p>Bonjour,</p>
        <p>Vous avez demandé un lien de connexion pour accéder à votre espace <strong>${escHtml(user.business_name || 'Genda')}</strong>.</p>
        <p>Ce lien est valable 15 minutes et ne peut être utilisé qu'une seule fois.</p>
        <p style="font-size:13px;color:#9C958E;margin-top:20px">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>`,
      ctaText: 'Se connecter',
      ctaUrl: magicUrl,
      businessName: user.business_name || 'Genda'
    });

    // H#16 v2: fire-and-forget sendEmail (la réponse ne doit pas bloquer sur Brevo).
    // Le bounded() ci-dessous aligne timing — même fenêtre 400-500ms que la branche
    // email-absent → pas de signal d'énumération via latence.
    sendEmail({
      to: email,
      subject: `Connexion à ${user.business_name || 'Genda'}`,
      html,
      fromName: user.business_name || 'Genda'
    }).catch(e => console.warn('[AUTH] Magic link email error:', e.message));

    return bounded(200, { message: 'Si ce compte existe, un lien de connexion a été envoyé.' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/verify
// Verify a magic link token and return JWT
// ============================================================
router.post('/verify', authLimiter, async (req, res, next) => {
  // H#16 v5: bounded() pour aligner les 3 branches timing (L186 token invalide ~5ms,
  // L199 token valide + compte désactivé ~20ms, L224 succès ~30-50ms). Un attaquant
  // qui a intercepté un magic link expiré peut distinguer "token déjà utilisé" de
  // "compte désactivé" via timing. Fenêtre 150-250ms absorbe les 3 cas.
  const tStart = Date.now();
  const minVerifyMs = 150 + Math.floor(Math.random() * 100); // 150-250ms
  const bounded = async (status, payload) => {
    const elapsed = Date.now() - tStart;
    if (elapsed < minVerifyMs) {
      await new Promise((r) => setTimeout(r, minVerifyMs - elapsed));
    }
    return res.status(status).json(payload);
  };
  try {
    const { token: magicToken } = req.body;

    if (!magicToken) {
      return res.status(400).json({ error: 'Token requis' });
    }

    // Atomic: mark as used and return id+user_id in one query (prevents race conditions)
    const result = await query(
      `UPDATE magic_links SET used_at = NOW()
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING id, user_id`,
      [magicToken]
    );

    if (result.rows.length === 0) {
      return bounded(400, { error: 'Lien invalide, expiré ou déjà utilisé' });
    }

    const { user_id } = result.rows[0];

    // Fetch user info with business details
    const userResult = await query(
      `SELECT u.id, u.email, u.role, u.business_id, u.token_version, b.name AS business_name
       FROM users u JOIN businesses b ON b.id = u.business_id
       WHERE u.id = $1 AND u.is_active = true AND b.is_active = true`,
      [user_id]
    );
    if (userResult.rows.length === 0) {
      return bounded(400, { error: 'Lien invalide, expiré ou déjà utilisé' });
    }

    const ml = userResult.rows[0];

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user_id]);

    // Generate JWT
    const jwtToken = jwt.sign(
      { userId: user_id, businessId: ml.business_id, tv: ml.token_version || 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // Fetch practitioner link + sector + category
    const extraResult = await query(
      `SELECT b.id, b.slug, b.name, b.sector, b.category, b.plan, b.settings,
              p.id AS practitioner_id, p.display_name AS practitioner_name
       FROM businesses b
       LEFT JOIN practitioners p ON p.user_id = $2 AND p.business_id = b.id AND p.is_active = true
       WHERE b.id = $1`, [ml.business_id, user_id]
    );
    const extra = extraResult.rows[0] || {};

    return bounded(200, {
      token: jwtToken,
      user: {
        id: user_id,
        email: ml.email,
        role: ml.role,
        business_name: ml.business_name,
        practitioner_id: extra.practitioner_id || null,
        practitioner_name: extra.practitioner_name || null
      },
      business: {
        id: extra.id, slug: extra.slug, name: extra.name,
        sector: extra.sector || 'autre', category: extra.category || 'autre', plan: extra.plan || 'free',
        settings: extra.settings || {}
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/auth/me
// Get current user info
// ============================================================
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.role, u.last_login_at,
              b.name AS business_name, b.slug, b.plan, b.sector, b.category,
              p.display_name AS practitioner_name, p.id AS practitioner_id
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       LEFT JOIN practitioners p ON p.user_id = u.id AND p.business_id = u.business_id AND p.is_active = true
       WHERE u.id = $1`,
      [req.user.id]
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/change-password
// Change password (requires current password)
// UI: Settings > Sécurité
// ============================================================
router.post('/change-password', authLimiter, requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
    }
    // H#8 fix: same length cap as login — defends against bcrypt DoS on both passwords.
    if (current_password.length > 128 || new_password.length > 128) {
      return res.status(400).json({ error: 'Mot de passe trop long' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères' });
    }

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (!result.rows[0].password_hash) {
      return res.status(400).json({ error: 'Aucun mot de passe configuré. Utilisez "mot de passe oublié" pour en définir un.' });
    }

    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    // H#14 fix: bump token_version to invalidate ALL other active sessions after
    // a password change. The caller will need to re-authenticate on their next
    // request too — that's the safe behaviour.
    await query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = NOW() WHERE id = $2',
      [hash, req.user.id]
    );

    res.json({ updated: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/auth/forgot-password
// Send password reset email
// UI: Login > "Mot de passe oublié ?"
// ============================================================
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  // H#16 v3: même pattern bounded() que /login — la branche email-absent
  // répondait en ~5ms, la branche email-existant `await sendPasswordResetEmail`
  // en 500-1500ms (Brevo). Énumération triviale. On borne les 2 chemins dans
  // la même fenêtre et on passe sendEmail en fire-and-forget.
  const tStart = Date.now();
  const minResetMs = 500 + Math.floor(Math.random() * 120); // 500-620ms (Brevo p50 ~400ms)
  const bounded = async (status, payload) => {
    const elapsed = Date.now() - tStart;
    if (elapsed < minResetMs) {
      await new Promise((r) => setTimeout(r, minResetMs - elapsed));
    }
    return res.status(status).json(payload);
  };
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Always return same message (don't reveal if email exists)
    const genericMsg = 'Si ce compte existe, un email de réinitialisation a été envoyé.';

    const result = await query(
      `SELECT u.id, u.email, u.role, b.name AS business_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE LOWER(u.email) = $1 AND u.is_active = true AND b.is_active = true`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return bounded(200, { message: genericMsg });
    }

    const user = result.rows[0];

    // Invalidate previous unused tokens
    await query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    // Create new token — store SHA-256 hash, send raw token in email
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, tokenHash]
    );

    // Send email — fire-and-forget (bounded() sert d'alignement timing).
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;

    const { sendPasswordResetEmail } = require('../../services/email');
    sendPasswordResetEmail({
      email: user.email,
      name: user.email.split('@')[0],
      resetUrl,
      businessName: user.business_name
    }).catch(e => console.warn('[AUTH] Password reset email error:', e.message));

    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n  Password reset for ${email}: ${resetUrl}\n`);
    }

    return bounded(200, { message: genericMsg });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/auth/reset-password
// Reset password using token
// UI: /reset-password.html
// ============================================================
router.post('/reset-password', authLimiter, async (req, res, next) => {
  // H#16 v5: bounded() pour aligner timing 400 (token invalide ~5ms) et 200
  // (succès avec bcrypt.hash + tx ~500-700ms). Token est 256-bit random donc
  // brute-force impraticable, mais énumération de tokens valides devient
  // impossible en timing. Cohérence avec /login /forgot /verify /signup.
  const tStart = Date.now();
  const minResetPwMs = 500 + Math.floor(Math.random() * 200); // 500-700ms (bcrypt 12 rounds ~300ms)
  const bounded = async (status, payload) => {
    const elapsed = Date.now() - tStart;
    if (elapsed < minResetPwMs) {
      await new Promise((r) => setTimeout(r, minResetPwMs - elapsed));
    }
    return res.status(status).json(payload);
  };
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ error: 'Token et nouveau mot de passe requis' });
    }
    // H#8 fix: bcrypt DoS cap.
    if (new_password.length > 128) {
      return res.status(400).json({ error: 'Mot de passe trop long' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }

    // Hash the incoming token to compare against stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Atomic: claim the token in one UPDATE (prevents race conditions)
    const result = await query(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING id, user_id`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return bounded(400, { error: 'Lien invalide, expiré ou déjà utilisé' });
    }

    const rt = result.rows[0];

    // SVC-V11-1: Use a single connection for the transaction
    // (pool.query() may use different connections for BEGIN/UPDATE/COMMIT)
    const hash = await bcrypt.hash(new_password, 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // H#14 fix: bump token_version → any active JWT for this user is revoked.
      await client.query(
        'UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = NOW() WHERE id = $2',
        [hash, rt.user_id]
      );

      // Invalidate all other tokens for this user
      await client.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [rt.user_id]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Fetch email for logging
    const userResult = await query('SELECT email FROM users WHERE id = $1', [rt.user_id]);
    const email = userResult.rows[0]?.email || 'unknown';
    console.log(`[AUTH] Password reset successful for ${email}`);

    return bounded(200, { success: true, message: 'Mot de passe modifié avec succès' });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/auth/logout
// H#14 fix: increment users.token_version so the caller's JWT (and any other
// active session for this user) is rejected by requireAuth on the next request.
// Previously this was a no-op → a stolen token remained valid until expiry.
// ============================================================
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await query(
      `UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1`,
      [req.user.id]
    );
    res.json({ message: 'Déconnecté' });
  } catch (err) { next(err); }
});

module.exports = router;
