const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../../services/db');
const { authLimiter } = require('../../middleware/rate-limiter');
const { requireAuth } = require('../../middleware/auth');

// ============================================================
// POST /api/auth/login
// Request a magic link (or password login fallback)
// UI: Dashboard login screen
// ============================================================
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email requis' });
    }

    // Find user
    const result = await query(
      `SELECT u.id, u.email, u.role, u.password_hash, u.business_id,
              b.name AS business_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.email = $1 AND u.is_active = true AND b.is_active = true`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      // Don't reveal whether email exists
      return res.json({ message: 'Si ce compte existe, un lien de connexion a été envoyé.' });
    }

    const user = result.rows[0];

    // Password login (fallback)
    if (password && user.password_hash) {
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Mot de passe incorrect' });
      }

      const token = jwt.sign(
        { userId: user.id, businessId: user.business_id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      // Fetch business details for frontend
      const bizResult = await query(
        `SELECT id, slug, name FROM businesses WHERE id = $1`, [user.business_id]
      );
      const biz = bizResult.rows[0];

      return res.json({
        token,
        user: { id: user.id, email: user.email, role: user.role, business_name: user.business_name },
        business: { id: biz.id, slug: biz.slug, name: biz.name }
      });
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

    // 3. Queue email (in production, send via Brevo)
    // For now, log it
    console.log(`\n  🔗 Magic link for ${email}: ${magicUrl}\n`);

    // TODO: Send email via Brevo
    // await sendMagicLinkEmail(email, magicUrl, user.business_name);

    res.json({ message: 'Si ce compte existe, un lien de connexion a été envoyé.' });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/verify
// Verify a magic link token and return JWT
// ============================================================
router.post('/verify', async (req, res, next) => {
  try {
    const { token: magicToken } = req.body;

    if (!magicToken) {
      return res.status(400).json({ error: 'Token requis' });
    }

    const result = await query(
      `SELECT ml.id, ml.user_id, ml.expires_at, ml.used_at,
              u.email, u.role, u.business_id,
              b.name AS business_name
       FROM magic_links ml
       JOIN users u ON u.id = ml.user_id
       JOIN businesses b ON b.id = u.business_id
       WHERE ml.token = $1`,
      [magicToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Lien invalide' });
    }

    const ml = result.rows[0];

    if (ml.used_at) {
      return res.status(400).json({ error: 'Ce lien a déjà été utilisé' });
    }

    if (new Date(ml.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Ce lien a expiré. Demandez-en un nouveau.' });
    }

    // Mark as used
    await query('UPDATE magic_links SET used_at = NOW() WHERE id = $1', [ml.id]);

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [ml.user_id]);

    // Generate JWT
    const jwtToken = jwt.sign(
      { userId: ml.user_id, businessId: ml.business_id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      token: jwtToken,
      user: {
        id: ml.user_id,
        email: ml.email,
        role: ml.role,
        business_name: ml.business_name
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
              b.name AS business_name, b.slug, b.plan,
              p.display_name AS practitioner_name
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       LEFT JOIN practitioners p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/logout
// Client-side only (clear JWT), but we can log it
// ============================================================
router.post('/logout', requireAuth, (req, res) => {
  res.json({ message: 'Déconnecté' });
});

module.exports = router;
