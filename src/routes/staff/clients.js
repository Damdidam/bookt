const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

router.use(requireAuth);

// GET /api/clients — list clients with search + stats
// UI: Dashboard > Clients table
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { search, limit, offset } = req.query;

    let sql = `
      SELECT c.*,
        COUNT(b.id) AS total_bookings,
        COUNT(b.id) FILTER (WHERE b.status = 'no_show') AS no_show_count,
        MAX(b.start_at) AS last_visit
      FROM clients c
      LEFT JOIN bookings b ON b.client_id = c.id AND b.business_id = c.business_id
      WHERE c.business_id = $1`;

    const params = [bid];
    let idx = 2;

    if (search) {
      sql += ` AND (c.full_name ILIKE $${idx} OR c.phone ILIKE $${idx} OR c.email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
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

    res.json({
      clients: result.rows.map(c => ({
        ...c,
        total_bookings: parseInt(c.total_bookings),
        no_show_count: parseInt(c.no_show_count),
        status: parseInt(c.no_show_count) >= 3 ? 'no_show'
              : parseInt(c.total_bookings) === 0 ? 'nouveau'
              : parseInt(c.total_bookings) >= 3 ? 'régulier'
              : 'nouveau'
      })),
      total: parseInt(countResult.rows[0].count)
    });
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

module.exports = router;
