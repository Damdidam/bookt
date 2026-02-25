const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { queryWithRLS, query } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// ============================================================
// GET /api/practitioners — list all practitioners with stats
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const result = await queryWithRLS(bid,
      `SELECT p.*,
        u.email AS user_email, u.last_login_at, u.is_active AS user_active,
        COUNT(DISTINCT ps.service_id) AS service_count,
        COUNT(DISTINCT bk.id) FILTER (WHERE bk.status IN ('confirmed','completed') AND bk.start_at >= NOW() - INTERVAL '30 days') AS bookings_30d
       FROM practitioners p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN practitioner_services ps ON ps.practitioner_id = p.id
       LEFT JOIN bookings bk ON bk.practitioner_id = p.id
       WHERE p.business_id = $1
       GROUP BY p.id, u.email, u.last_login_at, u.is_active
       ORDER BY p.sort_order, p.display_name`,
      [bid]
    );
    res.json({ practitioners: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/practitioners — create new practitioner
// ============================================================
router.post('/', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { display_name, title, bio, color, email, phone,
            years_experience, linkedin_url, booking_enabled } = req.body;

    if (!display_name) return res.status(400).json({ error: 'Nom requis' });

    const result = await queryWithRLS(bid,
      `INSERT INTO practitioners (business_id, display_name, title, bio, color,
        email, phone, years_experience, linkedin_url, booking_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [bid, display_name, title || null, bio || null, color || '#0D7377',
       email || null, phone || null, years_experience || null,
       linkedin_url || null, booking_enabled !== false]
    );

    res.status(201).json({ practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/practitioners/:id — update practitioner
// ============================================================
router.patch('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['display_name', 'title', 'bio', 'color', 'email', 'phone',
      'years_experience', 'linkedin_url', 'booking_enabled', 'is_active', 'sort_order'];

    const sets = [];
    const params = [id, bid];
    let idx = 3;

    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = $${idx}`);
        params.push(val);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(bid,
      `UPDATE practitioners SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });

    res.json({ practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/practitioners/:id — deactivate practitioner
// ============================================================
router.delete('/:id', requireOwner, async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `UPDATE practitioners SET is_active = false, booking_enabled = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/practitioners/:id/invite — create login for practitioner
// Sends an invite (creates user account linked to practitioner)
// ============================================================
router.post('/:id/invite', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { email, password } = req.body;

    if (!email) return res.status(400).json({ error: 'Email requis' });

    // Check practitioner exists
    const pract = await queryWithRLS(bid,
      `SELECT id, user_id, display_name FROM practitioners WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (pract.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    if (pract.rows[0].user_id) return res.status(400).json({ error: 'Ce praticien a déjà un compte' });

    // Check email not taken in this business
    const existing = await query(
      `SELECT id FROM users WHERE email = $1 AND business_id = $2`,
      [email.toLowerCase().trim(), bid]
    );
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Cet email est déjà utilisé' });

    // Create user
    const hash = password ? await bcrypt.hash(password, 12) : null;
    const userResult = await query(
      `INSERT INTO users (business_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'staff')
       RETURNING id, email, role`,
      [bid, email.toLowerCase().trim(), hash]
    );
    const userId = userResult.rows[0].id;

    // Link to practitioner
    await queryWithRLS(bid,
      `UPDATE practitioners SET user_id = $1, email = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [userId, email.toLowerCase().trim(), id, bid]
    );

    res.status(201).json({
      user: userResult.rows[0],
      practitioner_id: id,
      message: `Compte créé pour ${pract.rows[0].display_name}`
    });
  } catch (err) { next(err); }
});

module.exports = router;
