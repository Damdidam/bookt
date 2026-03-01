const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireRole, resolvePractitionerScope } = require('../../middleware/auth');

router.use(requireAuth);
router.use(resolvePractitionerScope);

// GET /api/clients — list clients with search + stats
// UI: Dashboard > Clients table
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { search, limit, offset, filter } = req.query;

    let sql = `
      SELECT c.*,
        COUNT(b.id) AS total_bookings,
        COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed_count,
        MAX(b.start_at) AS last_visit
      FROM clients c
      LEFT JOIN bookings b ON b.client_id = c.id AND b.business_id = c.business_id
      WHERE c.business_id = $1`;

    const params = [bid];
    let idx = 2;

    // Practitioner scope: only show clients who have bookings with this practitioner
    if (req.practitionerFilter) {
      sql += ` AND c.id IN (SELECT DISTINCT client_id FROM bookings WHERE practitioner_id = $${idx} AND business_id = $1)`;
      params.push(req.practitionerFilter);
      idx++;
    }

    if (search) {
      sql += ` AND (c.full_name ILIKE $${idx} OR c.phone ILIKE $${idx} OR c.email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    // Filters
    if (filter === 'blocked') {
      sql += ` AND c.is_blocked = true`;
    } else if (filter === 'flagged') {
      sql += ` AND c.no_show_count > 0`;
    }

    sql += ` GROUP BY c.id ORDER BY last_visit DESC NULLS LAST`;
    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit) || 50, parseInt(offset) || 0);

    const result = await queryWithRLS(bid, sql, params);

    // Total count
    let countSql = `SELECT COUNT(*) FROM clients WHERE business_id = $1`;
    const countParams = [bid];
    if (search) {
      countSql += ` AND (full_name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)`;
      countParams.push(`%${search}%`);
    }
    const countResult = await queryWithRLS(bid, countSql, countParams);

    // Stats
    const statsResult = await queryWithRLS(bid,
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_blocked = true) AS blocked,
        COUNT(*) FILTER (WHERE no_show_count > 0 AND is_blocked = false) AS flagged,
        COUNT(*) FILTER (WHERE no_show_count = 0 AND is_blocked = false) AS clean
       FROM clients WHERE business_id = $1`,
      [bid]
    );

    res.json({
      clients: result.rows.map(c => ({
        ...c,
        total_bookings: parseInt(c.total_bookings),
        completed_count: parseInt(c.completed_count),
        tag: c.is_blocked ? 'bloqué'
           : c.no_show_count >= 3 ? 'récidiviste'
           : c.no_show_count >= 1 ? 'à surveiller'
           : parseInt(c.completed_count) >= 5 ? 'fidèle'
           : parseInt(c.total_bookings) === 0 ? 'nouveau'
           : 'actif'
      })),
      total: parseInt(countResult.rows[0].count),
      stats: statsResult.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/clients — quick create client (from calendar quick-create)
router.post('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { full_name, phone, email } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ error: 'Nom requis' });

    const result = await queryWithRLS(bid,
      `INSERT INTO clients (business_id, full_name, phone, email)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [bid, full_name.trim(), phone || null, email || null]
    );
    res.status(201).json({ client: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/clients/:id — client detail with booking history
router.get('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;

    const client = await queryWithRLS(bid,
      `SELECT * FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (client.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });

    const bookings = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
              b.deposit_required, b.deposit_status, b.deposit_amount_cents,
              s.name AS service_name, p.display_name AS practitioner_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.client_id = $1 AND b.business_id = $2
       ORDER BY b.start_at DESC`,
      [req.params.id, bid]
    );

    res.json({ client: client.rows[0], bookings: bookings.rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/clients/:id — update client
router.patch('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { full_name, phone, email, bce_number, notes, consent_sms, consent_marketing } = req.body;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        email = COALESCE($3, email),
        bce_number = COALESCE($4, bce_number),
        notes = COALESCE($5, notes),
        consent_sms = COALESCE($6, consent_sms),
        consent_marketing = COALESCE($7, consent_marketing),
        updated_at = NOW()
       WHERE id = $8 AND business_id = $9
       RETURNING *`,
      [full_name, phone, email, bce_number, notes, consent_sms, consent_marketing,
       req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ client: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/clients/:id/block — block client from online booking
// ============================================================
router.post('/:id/block', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { reason } = req.body;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        is_blocked = true,
        blocked_at = NOW(),
        blocked_reason = $1,
        updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING id, full_name, is_blocked`,
      [reason || 'Bloqué manuellement', req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ blocked: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/unblock — unblock client
// ============================================================
router.post('/:id/unblock', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const bid = req.businessId;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        is_blocked = false,
        blocked_at = NULL,
        blocked_reason = NULL,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING id, full_name, is_blocked`,
      [req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ unblocked: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/clients/:id/reset-noshow — reset no-show counter
// ============================================================
router.post('/:id/reset-noshow', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const bid = req.businessId;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        no_show_count = 0,
        is_blocked = false,
        blocked_at = NULL,
        blocked_reason = NULL,
        last_no_show_at = NULL,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING id, full_name, no_show_count, is_blocked`,
      [req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ reset: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
