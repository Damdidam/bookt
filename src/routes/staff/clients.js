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
    } else if (filter === 'fantome') {
      sql += ` AND c.expired_pending_count > 0`;
    } else if (filter === 'vip') {
      sql += ` AND c.is_vip = true`;
    }

    sql += ` GROUP BY c.id ORDER BY last_visit DESC NULLS LAST`;
    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(parseInt(limit) || 50, parseInt(offset) || 0);

    const result = await queryWithRLS(bid, sql, params);

    // Total count
    let countSql = `SELECT COUNT(*) FROM clients WHERE business_id = $1`;
    const countParams = [bid];
    let countIdx = 2;
    if (req.practitionerFilter) {
      countSql += ` AND id IN (SELECT DISTINCT client_id FROM bookings WHERE practitioner_id = $${countIdx} AND business_id = $1)`;
      countParams.push(req.practitionerFilter);
      countIdx++;
    }
    if (search) {
      countSql += ` AND (full_name ILIKE $${countIdx} OR phone ILIKE $${countIdx} OR email ILIKE $${countIdx})`;
      countParams.push(`%${search}%`);
      countIdx++;
    }
    if (filter === 'blocked') { countSql += ` AND is_blocked = true`; }
    else if (filter === 'flagged') { countSql += ` AND no_show_count > 0`; }
    else if (filter === 'fantome') { countSql += ` AND expired_pending_count > 0`; }
    else if (filter === 'vip') { countSql += ` AND is_vip = true`; }
    const countResult = await queryWithRLS(bid, countSql, countParams);

    // Stats
    const statsResult = await queryWithRLS(bid,
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE is_blocked = true) AS blocked,
        COUNT(*) FILTER (WHERE no_show_count > 0 AND is_blocked = false) AS flagged,
        COUNT(*) FILTER (WHERE expired_pending_count > 0 AND is_blocked = false) AS fantome,
        COUNT(*) FILTER (WHERE no_show_count = 0 AND expired_pending_count = 0 AND is_blocked = false) AS clean,
        COUNT(*) FILTER (WHERE is_vip = true) AS vip
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
           : c.expired_pending_count >= 3 ? 'fantôme'
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
    // L5: UUID validation
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const bid = req.businessId;

    const client = await queryWithRLS(bid,
      `SELECT id, business_id, full_name, phone, email, bce_number, notes,
              consent_sms, consent_marketing, no_show_count, is_blocked,
              blocked_at, blocked_reason, last_no_show_at, is_vip,
              expired_pending_count, last_expired_pending_at,
              created_at, updated_at
       FROM clients WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (client.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });

    // V12-022: Add practitioner scope to bookings query
    let bkSql = `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
              b.deposit_required, b.deposit_status, b.deposit_amount_cents,
              b.custom_label, b.internal_note, b.session_notes, b.session_notes_sent_at,
              b.created_at, b.channel,
              s.name AS service_name, p.display_name AS practitioner_name,
              (SELECT COALESCE(pr.display_name, u.email)
               FROM audit_logs al
               LEFT JOIN users u ON u.id = al.actor_user_id
               LEFT JOIN practitioners pr ON pr.user_id = u.id AND pr.business_id = al.business_id
               WHERE al.entity_type = 'booking' AND al.entity_id = b.id AND al.action = 'create'
               LIMIT 1
              ) AS created_by_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.client_id = $1 AND b.business_id = $2`;
    const bkParams = [req.params.id, bid];

    if (req.practitionerFilter) {
      bkSql += ` AND b.practitioner_id = $${bkParams.length + 1}`;
      bkParams.push(req.practitionerFilter);
    }

    bkSql += ` ORDER BY b.start_at DESC`;

    const bookings = await queryWithRLS(bid, bkSql, bkParams);

    // Fetch pre-RDV documents for this client
    const docs = await queryWithRLS(bid,
      `SELECT prs.id, prs.template_id, prs.booking_id, prs.status, prs.sent_at,
              prs.responded_at, prs.created_at,
              dt.name AS template_name, dt.type AS template_type,
              b.start_at AS booking_date
       FROM pre_rdv_sends prs
       JOIN document_templates dt ON dt.id = prs.template_id
       JOIN bookings b ON b.id = prs.booking_id
       WHERE prs.client_id = $1 AND prs.business_id = $2
       ORDER BY prs.created_at DESC`,
      [req.params.id, bid]
    );

    res.json({ client: client.rows[0], bookings: bookings.rows, documents: docs.rows });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/clients/:id — update client
// V11-013: Only owner/manager can edit client details
router.patch('/:id', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const bid = req.businessId;
    const sets = [];
    const params = [];
    let idx = 1;

    const fieldMap = { full_name: 'full_name', phone: 'phone', email: 'email',
      bce_number: 'bce_number', notes: 'notes', consent_sms: 'consent_sms',
      consent_marketing: 'consent_marketing', is_vip: 'is_vip' };
    for (const [bodyKey, col] of Object.entries(fieldMap)) {
      if (bodyKey in req.body) {
        sets.push(`${col} = $${idx}`);
        params.push(req.body[bodyKey]);
        idx++;
      }
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });

    sets.push('updated_at = NOW()');
    params.push(req.params.id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE clients SET ${sets.join(', ')}
       WHERE id = $${idx} AND business_id = $${idx + 1}
       RETURNING *`,
      params
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

// ============================================================
// POST /api/clients/:id/reset-expired — reset expired pending counter
// ============================================================
router.post('/:id/reset-expired', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const bid = req.businessId;

    const result = await queryWithRLS(bid,
      `UPDATE clients SET
        expired_pending_count = 0,
        last_expired_pending_at = NULL,
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING id, full_name, expired_pending_count`,
      [req.params.id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ reset: true, client: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
