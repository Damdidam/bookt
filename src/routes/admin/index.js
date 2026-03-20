const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../../services/db');
const { requireAuth, requireSuperadmin } = require('../../middleware/auth');

const router = express.Router();

// All admin routes require superadmin
router.use(requireAuth);
router.use(requireSuperadmin);

// ─── GET /api/admin/stats ────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [totals, monthly, topSalons] = await Promise.all([
      query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_active = true) AS active,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS created_this_month
        FROM businesses
      `),
      query(`
        SELECT COUNT(*) AS bookings_this_month
        FROM bookings
        WHERE created_at >= date_trunc('month', NOW())
      `),
      query(`
        SELECT b.id, b.name, b.slug, COUNT(bk.id) AS bookings_30d
        FROM businesses b
        LEFT JOIN bookings bk ON bk.business_id = b.id AND bk.created_at >= NOW() - INTERVAL '30 days'
        WHERE b.is_active = true
        GROUP BY b.id
        ORDER BY bookings_30d DESC
        LIMIT 5
      `)
    ]);

    res.json({
      total_businesses: parseInt(totals.rows[0].total),
      active_businesses: parseInt(totals.rows[0].active),
      created_this_month: parseInt(totals.rows[0].created_this_month),
      bookings_this_month: parseInt(monthly.rows[0].bookings_this_month),
      top_salons: topSalons.rows
    });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/businesses ───────────────────────────────────
router.get('/businesses', async (req, res, next) => {
  try {
    const { status, plan, search, sort = 'created_at', page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    let paramIdx = 1;

    if (status === 'active') { conditions.push(`b.is_active = true`); }
    else if (status === 'inactive') { conditions.push(`b.is_active = false`); }

    if (plan) {
      conditions.push(`b.plan = $${paramIdx}`);
      params.push(plan);
      paramIdx++;
    }

    if (search) {
      conditions.push(`(b.name ILIKE $${paramIdx} OR b.slug ILIKE $${paramIdx} OR owner_u.email ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Allowed sort columns
    const sortMap = {
      created_at: 'b.created_at DESC',
      name: 'b.name ASC',
      bookings_30d: 'bookings_30d DESC NULLS LAST'
    };
    const orderBy = sortMap[sort] || sortMap.created_at;

    const sql = `
      SELECT
        b.id, b.name, b.slug, b.sector, b.plan, b.is_active, b.created_at,
        owner_u.email AS owner_email,
        (SELECT COUNT(*) FROM bookings bk WHERE bk.business_id = b.id) AS bookings_count,
        (SELECT COUNT(*) FROM bookings bk WHERE bk.business_id = b.id AND bk.created_at >= NOW() - INTERVAL '30 days') AS bookings_30d,
        (SELECT MAX(bk.created_at) FROM bookings bk WHERE bk.business_id = b.id) AS last_booking_at,
        (SELECT COUNT(*) FROM services s WHERE s.business_id = b.id) AS services_count,
        (SELECT COUNT(*) FROM practitioners p WHERE p.business_id = b.id AND p.is_active = true) AS practitioners_count
      FROM businesses b
      LEFT JOIN users owner_u ON owner_u.business_id = b.id AND owner_u.role = 'owner'
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;
    params.push(parseInt(limit), offset);

    const countSql = `
      SELECT COUNT(*) AS total
      FROM businesses b
      LEFT JOIN users owner_u ON owner_u.business_id = b.id AND owner_u.role = 'owner'
      ${where}
    `;
    // Count params are the same minus limit/offset
    const countParams = params.slice(0, -2);

    const [result, countResult] = await Promise.all([
      query(sql, params),
      query(countSql, countParams)
    ]);

    res.json({
      businesses: result.rows,
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/businesses/:id ───────────────────────────────
router.get('/businesses/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.*, owner_u.email AS owner_email, owner_u.full_name AS owner_name
       FROM businesses b
       LEFT JOIN users owner_u ON owner_u.business_id = b.id AND owner_u.role = 'owner'
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Business not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── PATCH /api/admin/businesses/:id ─────────────────────────────
router.patch('/businesses/:id', async (req, res, next) => {
  try {
    const { is_active, plan } = req.body;
    const sets = [];
    const params = [];
    let idx = 1;

    if (typeof is_active === 'boolean') {
      sets.push(`is_active = $${idx++}`);
      params.push(is_active);
    }
    if (plan && ['free', 'pro', 'premium'].includes(plan)) {
      sets.push(`plan = $${idx++}`);
      params.push(plan);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);

    const result = await query(
      `UPDATE businesses SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, name, slug, is_active, plan`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Business not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── POST /api/admin/impersonate/:businessId ─────────────────────
router.post('/impersonate/:businessId', async (req, res, next) => {
  try {
    // Find the owner of the target business
    const ownerResult = await query(
      `SELECT u.id, u.email, u.role, u.business_id, b.name AS business_name, b.slug
       FROM users u
       JOIN businesses b ON b.id = u.business_id
       WHERE u.business_id = $1 AND u.role = 'owner' AND u.is_active = true
       LIMIT 1`,
      [req.params.businessId]
    );

    if (ownerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Business owner not found' });
    }

    const owner = ownerResult.rows[0];

    // Generate a temporary JWT (1h) with impersonation flag
    const token = jwt.sign(
      {
        userId: owner.id,
        businessId: owner.business_id,
        impersonated: true,
        impersonatedBy: req.user.id
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      token,
      business: { id: owner.business_id, name: owner.business_name, slug: owner.slug },
      user: { id: owner.id, email: owner.email }
    });
  } catch (err) { next(err); }
});

module.exports = router;
