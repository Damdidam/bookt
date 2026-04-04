const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../../services/db');
const { requireAuth, requireSuperadmin } = require('../../middleware/auth');
const { adminLimiter } = require('../../middleware/rate-limiter');

const router = express.Router();

// All admin routes require superadmin + rate limit
router.use(requireAuth);
router.use(requireSuperadmin);
router.use(adminLimiter);

// ─── GET /api/admin/stats ────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [totals, monthly, topSalons, alerts] = await Promise.all([
      query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_active = true) AS active,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS created_this_month,
          COUNT(*) FILTER (WHERE plan = 'free') AS free_count,
          COUNT(*) FILTER (WHERE plan = 'pro') AS pro_count,
          COUNT(*) FILTER (WHERE subscription_status IN ('past_due', 'unpaid')) AS past_due_count,
          COUNT(*) FILTER (WHERE subscription_status = 'trialing') AS trialing_count
        FROM businesses
      `),
      query(`
        SELECT COUNT(*) AS bookings_this_month
        FROM bookings
        WHERE created_at >= date_trunc('month', NOW())
      `),
      query(`
        SELECT b.id, b.name, b.slug, b.plan, b.subscription_status, COUNT(bk.id) AS bookings_30d
        FROM businesses b
        LEFT JOIN bookings bk ON bk.business_id = b.id AND bk.created_at >= NOW() - INTERVAL '30 days'
        WHERE b.is_active = true
        GROUP BY b.id
        ORDER BY bookings_30d DESC
        LIMIT 5
      `),
      query(`
        SELECT b.id, b.name, b.slug, b.plan, b.subscription_status, b.trial_ends_at,
          (SELECT MAX(bk.created_at) FROM bookings bk WHERE bk.business_id = b.id) AS last_booking_at
        FROM businesses b
        WHERE b.is_active = true AND (
          (b.subscription_status IN ('past_due', 'unpaid'))
          OR (b.subscription_status = 'trialing' AND b.trial_ends_at < NOW() + INTERVAL '3 days')
          OR (b.plan = 'pro' AND NOT EXISTS (SELECT 1 FROM bookings bk WHERE bk.business_id = b.id AND bk.created_at >= NOW() - INTERVAL '14 days'))
        )
        ORDER BY
          CASE WHEN b.subscription_status IN ('past_due', 'unpaid') THEN 0
               WHEN b.subscription_status = 'trialing' THEN 1
               ELSE 2 END,
          b.name
      `)
    ]);

    const t = totals.rows[0];
    const proCount = parseInt(t.pro_count);
    res.json({
      total_businesses: parseInt(t.total),
      active_businesses: parseInt(t.active),
      created_this_month: parseInt(t.created_this_month),
      bookings_this_month: parseInt(monthly.rows[0].bookings_this_month),
      free_count: parseInt(t.free_count),
      pro_count: proCount,
      mrr_cents: proCount * 6000, // 60€ x Pro count
      past_due_count: parseInt(t.past_due_count),
      trialing_count: parseInt(t.trialing_count),
      top_salons: topSalons.rows,
      alerts: alerts.rows
    });
  } catch (err) { next(err); }
});

// ─── GET /api/admin/businesses ───────────────────────────────────
router.get('/businesses', async (req, res, next) => {
  try {
    const { status, plan, search, sort = 'created_at', page = 1, limit: rawLimit = 50, sub_status } = req.query;
    const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 200);
    const offset = (Math.max(1, parseInt(page)) - 1) * limit;
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

    if (sub_status) {
      conditions.push(`b.subscription_status = $${paramIdx}`);
      params.push(sub_status);
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
        b.subscription_status, b.trial_ends_at, b.plan_changed_at, b.subscription_current_period_end,
        b.stripe_customer_id, b.stripe_subscription_id,
        owner_u.email AS owner_email,
        (SELECT COUNT(*) FROM bookings bk WHERE bk.business_id = b.id) AS bookings_count,
        (SELECT COUNT(*) FROM bookings bk WHERE bk.business_id = b.id AND bk.created_at >= NOW() - INTERVAL '30 days') AS bookings_30d,
        (SELECT MAX(bk.created_at) FROM bookings bk WHERE bk.business_id = b.id) AS last_booking_at,
        (SELECT COUNT(*) FROM services s WHERE s.business_id = b.id) AS services_count,
        (SELECT COUNT(*) FROM practitioners p WHERE p.business_id = b.id AND p.is_active = true) AS practitioners_count,
        (SELECT COALESCE(SUM(COALESCE(bk.booked_price_cents, 0) - COALESCE(bk.promotion_discount_cents, 0)), 0) FROM bookings bk WHERE bk.business_id = b.id AND bk.status IN ('confirmed', 'completed') AND bk.created_at >= NOW() - INTERVAL '30 days') AS revenue_30d_cents
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
      // ST-9: Warn about active bookings/deposits when deactivating
      if (is_active === false) {
        const activeBookings = await query(
          `SELECT COUNT(*) AS cnt FROM bookings WHERE business_id = $1 AND status IN ('confirmed', 'pending', 'pending_deposit', 'modified_pending') AND start_at > NOW()`,
          [req.params.id]
        );
        const cnt = parseInt(activeBookings.rows[0].cnt) || 0;
        if (cnt > 0) {
          console.warn(`[ADMIN] Deactivating business ${req.params.id} with ${cnt} future active booking(s) — clients will NOT be notified`);
        }
      }
      sets.push(`is_active = $${idx++}`);
      params.push(is_active);
    }
    if (plan && ['free', 'pro'].includes(plan)) {
      // ST-8: Warn if Stripe subscription exists and plan change may desync
      const subCheck = await query(`SELECT stripe_subscription_id, subscription_status FROM businesses WHERE id = $1`, [req.params.id]);
      if (subCheck.rows[0]?.stripe_subscription_id && plan === 'free') {
        console.warn(`[ADMIN] Plan downgrade to free for ${req.params.id} but Stripe subscription ${subCheck.rows[0].stripe_subscription_id} still active — manual cancellation needed`);
      }
      sets.push(`plan = $${idx++}`);
      params.push(plan);
      sets.push(`plan_changed_at = NOW()`);
      // Downgrade cleanup: disable Pro-only settings + deactivate excess promos
      if (plan === 'free') {
        sets.push(`settings = jsonb_set(jsonb_set(jsonb_set(jsonb_set(COALESCE(settings, '{}'::jsonb), '{last_minute_enabled}', 'false'), '{deposit_enabled}', 'false'), '{giftcard_enabled}', 'false'), '{passes_enabled}', 'false')`);
        try {
          const activePromos = await query(`SELECT id FROM promotions WHERE business_id = $1 AND is_active = true ORDER BY sort_order, created_at`, [req.params.id]);
          if (activePromos.rows.length > 1) {
            const keepId = activePromos.rows[0].id;
            await query(`UPDATE promotions SET is_active = false, updated_at = NOW() WHERE business_id = $1 AND is_active = true AND id != $2`, [req.params.id, keepId]);
          }
        } catch (_) {}
      }
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

// ─── GET /api/admin/announcements ────────────────────────────────
router.get('/announcements', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM system_announcements ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ announcements: result.rows });
  } catch (err) { next(err); }
});

// ─── POST /api/admin/announcements ──────────────────────────────
router.post('/announcements', async (req, res, next) => {
  try {
    const { title, body, type = 'info', starts_at, ends_at } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const result = await query(
      `INSERT INTO system_announcements (title, body, type, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5::timestamptz, $6)
       RETURNING *`,
      [title, body || null, type, starts_at || null, ends_at || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── PATCH /api/admin/announcements/:id ─────────────────────────
router.patch('/announcements/:id', async (req, res, next) => {
  try {
    const { title, body, type, starts_at, ends_at, is_active } = req.body;
    const sets = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { sets.push(`title = $${idx++}`); params.push(title); }
    if (body !== undefined) { sets.push(`body = $${idx++}`); params.push(body); }
    if (type !== undefined) { sets.push(`type = $${idx++}`); params.push(type); }
    if (starts_at !== undefined) { sets.push(`starts_at = $${idx++}`); params.push(starts_at); }
    if (ends_at !== undefined) { sets.push(`ends_at = $${idx++}`); params.push(ends_at); }
    if (typeof is_active === 'boolean') { sets.push(`is_active = $${idx++}`); params.push(is_active); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const result = await query(
      `UPDATE system_announcements SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/announcements/:id ────────────────────────
router.delete('/announcements/:id', async (req, res, next) => {
  try {
    await query(`DELETE FROM system_announcements WHERE id = $1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
