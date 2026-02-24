const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

router.use(requireAuth);

// ============================================================
// GET /api/bookings
// List bookings with filters (agenda view + today list)
// UI: Agenda page, Dashboard today list
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const { from, to, status, practitioner_id } = req.query;
    const bid = req.businessId;

    let sql = `
      SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
             b.channel, b.comment_client, b.public_token,
             s.name AS service_name, s.duration_min, s.price_cents, s.color AS service_color,
             p.id AS practitioner_id, p.display_name AS practitioner_name, p.color AS practitioner_color,
             c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN practitioners p ON p.id = b.practitioner_id
      JOIN clients c ON c.id = b.client_id
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
    if (practitioner_id) {
      sql += ` AND b.practitioner_id = $${idx}`;
      params.push(practitioner_id);
      idx++;
    }

    sql += ' ORDER BY b.start_at';

    const result = await queryWithRLS(bid, sql, params);

    res.json({ bookings: result.rows });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bookings/manual
// Create a manual booking (from dashboard)
// UI: Dashboard → "+ Nouveau RDV" button
// ============================================================
router.post('/manual', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id, practitioner_id, client_id, start_at, appointment_mode, comment } = req.body;

    if (!service_id || !practitioner_id || !start_at) {
      return res.status(400).json({ error: 'service_id, practitioner_id et start_at requis' });
    }

    // Get service duration
    const svcResult = await queryWithRLS(bid,
      `SELECT duration_min, buffer_before_min, buffer_after_min
       FROM services WHERE id = $1 AND business_id = $2`,
      [service_id, bid]
    );
    if (svcResult.rows.length === 0) return res.status(404).json({ error: 'Prestation introuvable' });

    const svc = svcResult.rows[0];
    const totalDur = svc.buffer_before_min + svc.duration_min + svc.buffer_after_min;
    const startDate = new Date(start_at);
    const endDate = new Date(startDate.getTime() + totalDur * 60000);

    const booking = await transactionWithRLS(bid, async (client) => {
      // Check conflicts
      const conflict = await client.query(
        `SELECT id FROM bookings
         WHERE business_id = $1 AND practitioner_id = $2
         AND status IN ('pending', 'confirmed')
         AND start_at < $4 AND end_at > $3
         FOR UPDATE`,
        [bid, practitioner_id, startDate.toISOString(), endDate.toISOString()]
      );

      if (conflict.rows.length > 0) {
        throw Object.assign(new Error('Créneau déjà pris'), { type: 'conflict' });
      }

      const result = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
          channel, appointment_mode, start_at, end_at, status, comment_client)
         VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, 'confirmed', $8)
         RETURNING *`,
        [bid, practitioner_id, service_id, client_id || null,
         appointment_mode || 'cabinet',
         startDate.toISOString(), endDate.toISOString(),
         comment || null]
      );

      // Audit
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action)
         VALUES ($1, $2, 'booking', $3, 'create')`,
        [bid, req.user.id, result.rows[0].id]
      );

      return result.rows[0];
    });

    res.status(201).json({ booking });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/status
// Update booking status (confirm / complete / no_show / cancel)
// UI: Agenda → action buttons (✓ Terminé, ✗ No-show, Annuler)
// ============================================================
router.patch('/:id/status', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { status, cancel_reason } = req.body;

    const validStatuses = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Statut invalide. Valeurs : ${validStatuses.join(', ')}` });
    }

    const old = await queryWithRLS(bid,
      `SELECT status FROM bookings WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    await queryWithRLS(bid,
      `UPDATE bookings SET status = $1, cancel_reason = $2, updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [status, cancel_reason || null, id, bid]
    );

    // Audit
    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
       VALUES ($1, $2, 'booking', $3, 'status_change', $4, $5)`,
      [bid, req.user.id, id,
       JSON.stringify({ status: old.rows[0].status }),
       JSON.stringify({ status, cancel_reason })]
    );

    res.json({ updated: true, status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
