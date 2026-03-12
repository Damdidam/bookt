/**
 * Bookings — orchestrator + GET endpoints.
 * Sub-routers handle creation, status, time changes, and annotations.
 */
const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, resolvePractitionerScope } = require('../../middleware/auth');

router.use(requireAuth);
router.use(resolvePractitionerScope);

// ============================================================
// GET /api/bookings
// List bookings with filters (agenda view + today list)
// UI: Agenda page, Dashboard today list
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const { from, to, status, practitioner_id } = req.query;
    const bid = req.businessId;

    // Force practitioner scope: practitioners only see their own bookings
    const effectivePractitionerId = req.practitionerFilter || practitioner_id;

    let sql = `
      SELECT b.id, b.service_id, b.start_at, b.end_at, b.status, b.appointment_mode,
             b.channel, b.comment_client, b.public_token,
             b.internal_note, b.color AS booking_color,
             b.group_id, b.group_order, b.custom_label,
             b.deposit_required, b.deposit_status, b.deposit_amount_cents,
             b.locked,
             b.discount_pct,
             b.confirmation_expires_at, b.deposit_deadline,
             b.processing_time, b.processing_start,
             s.name AS service_name, s.category AS service_category, s.duration_min, s.buffer_before_min, s.price_cents, s.color AS service_color,
             sv.name AS variant_name, sv.duration_min AS variant_duration_min, sv.price_cents AS variant_price_cents,
             p.id AS practitioner_id, p.display_name AS practitioner_name, p.color AS practitioner_color,
             c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email, c.is_vip AS client_is_vip, c.notes AS client_notes,
             (SELECT COUNT(*) FROM booking_notes bn WHERE bn.booking_id = b.id)::int AS notes_count,
             (SELECT bn2.content FROM booking_notes bn2 WHERE bn2.booking_id = b.id ORDER BY bn2.is_pinned DESC, bn2.created_at DESC LIMIT 1) AS first_note
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
      JOIN practitioners p ON p.id = b.practitioner_id
      LEFT JOIN clients c ON c.id = b.client_id
      WHERE b.business_id = $1`;

    const params = [bid];
    let idx = 2;

    if (from) {
      sql += ` AND b.start_at >= $${idx}`;
      params.push(from);
      idx++;
    }
    if (to) {
      sql += ` AND b.start_at <= $${idx}`;
      params.push(to);
      idx++;
    }
    if (status) {
      sql += ` AND b.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (effectivePractitionerId) {
      sql += ` AND b.practitioner_id = $${idx}`;
      params.push(effectivePractitionerId);
      idx++;
    }

    sql += ` ORDER BY b.start_at LIMIT $${idx}`;
    params.push(parseInt(req.query.limit) || 500);

    const result = await queryWithRLS(bid, sql, params);

    res.json({ bookings: result.rows });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/bookings/gaps — Detect exploitable gaps for a date
// UI: (future) Agenda gap-fill panel
// ============================================================
const { detectGaps } = require('../../services/gap-engine');

router.get('/gaps', async (req, res, next) => {
  try {
    // Check if gap analyzer is enabled for this business
    const bizResult = await queryWithRLS(req.businessId,
      `SELECT settings FROM businesses WHERE id = $1`, [req.businessId]);
    const settings = bizResult.rows[0]?.settings || {};
    if (!settings.gap_analyzer_enabled) {
      return res.status(403).json({ error: 'Analyseur de gaps désactivé. Activez-le dans Paramètres > Calendrier.' });
    }

    const { date, practitioner_id } = req.query;
    if (!date) return res.status(400).json({ error: 'Paramètre date requis' });
    const result = await detectGaps({
      businessId: req.businessId,
      date,
      practitionerId: practitioner_id || undefined
    });
    res.json(result);
  } catch (err) {
    if (err.type === 'validation') return res.status(400).json({ error: err.message });
    if (err.type === 'not_found') return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// GET /api/bookings/:id/history — Audit log timeline for a booking
// UI: Calendar → detail modal → Historique tab
// ============================================================
router.get('/:id/history', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const result = await queryWithRLS(bid,
      `SELECT al.action, al.old_data, al.new_data, al.created_at,
              COALESCE(p.display_name, u.email, 'Système') AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       LEFT JOIN practitioners p ON p.user_id = u.id AND p.business_id = al.business_id
       WHERE al.entity_type = 'booking' AND al.entity_id = $1 AND al.business_id = $2
       ORDER BY al.created_at DESC`,
      [id, bid]
    );

    res.json({ history: result.rows });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/bookings/:id/detail — Full detail with notes, todos, reminders
// UI: Calendar → double-click event → detail modal
// ============================================================
router.get('/:id/detail', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const booking = await queryWithRLS(bid,
      `SELECT b.*, s.name AS service_name, s.duration_min, s.price_cents, s.color AS service_color,
              sv.name AS variant_name, sv.duration_min AS variant_duration_min, sv.price_cents AS variant_price_cents,
              p.display_name AS practitioner_name, p.color AS practitioner_color,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
              c.no_show_count, c.is_blocked, c.is_vip
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (booking.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    const notes = await queryWithRLS(bid,
      `SELECT bn.*, u.email AS author_email
       FROM booking_notes bn
       LEFT JOIN users u ON u.id = bn.author_id
       WHERE bn.booking_id = $1 AND bn.business_id = $2
       ORDER BY bn.is_pinned DESC, bn.created_at DESC`,
      [id, bid]
    );

    const todos = await queryWithRLS(bid,
      `SELECT * FROM practitioner_todos
       WHERE booking_id = $1 AND business_id = $2
       ORDER BY sort_order, created_at`,
      [id, bid]
    );

    const reminders = await queryWithRLS(bid,
      `SELECT * FROM booking_reminders
       WHERE booking_id = $1 AND business_id = $2
       ORDER BY remind_at`,
      [id, bid]
    );

    // Fetch pre-RDV documents sent for this booking
    const docs = await queryWithRLS(bid,
      `SELECT prs.id, prs.template_id, prs.status, prs.token, prs.sent_at,
              prs.responded_at, prs.created_at,
              dt.name AS template_name, dt.type AS template_type
       FROM pre_rdv_sends prs
       JOIN document_templates dt ON dt.id = prs.template_id
       WHERE prs.booking_id = $1 AND prs.business_id = $2
       ORDER BY prs.created_at DESC`,
      [id, bid]
    );

    // If part of a group, fetch siblings
    let groupSiblings = [];
    const bk = booking.rows[0];
    if (bk.group_id) {
      const grp = await queryWithRLS(bid,
        `SELECT b.id, b.start_at, b.end_at, b.group_order, b.status,
                b.practitioner_id, b.service_id, b.service_variant_id,
                s.name AS service_name, s.duration_min, s.price_cents, s.color AS service_color,
                sv.name AS variant_name, sv.duration_min AS variant_duration_min, sv.price_cents AS variant_price_cents
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order`,
        [bk.group_id, bid]
      );
      groupSiblings = grp.rows;
    }

    res.json({
      booking: bk,
      notes: notes.rows,
      todos: todos.rows,
      reminders: reminders.rows,
      documents: docs.rows,
      group_siblings: groupSiblings
    });
  } catch (err) {
    next(err);
  }
});

// ── Mount sub-routers ──
router.use(require('./bookings-creation'));
router.use(require('./bookings-status'));
router.use(require('./bookings-time'));
router.use(require('./bookings-annotations'));
router.use(require('./bookings-ungroup'));

module.exports = router;
