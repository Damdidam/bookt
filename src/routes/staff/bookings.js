const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
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
      SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
             b.channel, b.comment_client, b.public_token,
             b.internal_note, b.color AS booking_color,
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
    if (effectivePractitionerId) {
      sql += ` AND b.practitioner_id = $${idx}`;
      params.push(effectivePractitionerId);
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

    const validStatuses = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled', 'modified_pending'];
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

    // ===== NO-SHOW STRIKE SYSTEM =====
    if (status === 'no_show') {
      try {
        // Get client_id + business settings
        const bkInfo = await queryWithRLS(bid,
          `SELECT b.client_id, biz.settings
           FROM bookings b
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`,
          [id]
        );
        if (bkInfo.rows.length > 0 && bkInfo.rows[0].client_id) {
          const clientId = bkInfo.rows[0].client_id;
          const settings = bkInfo.rows[0].settings || {};
          const threshold = settings.noshow_block_threshold ?? 3;
          const action = settings.noshow_block_action || 'block';

          // Increment no_show_count
          const updated = await queryWithRLS(bid,
            `UPDATE clients SET
              no_show_count = no_show_count + 1,
              last_no_show_at = NOW(),
              updated_at = NOW()
             WHERE id = $1 AND business_id = $2
             RETURNING no_show_count`,
            [clientId, bid]
          );

          // Auto-block if threshold reached
          const count = updated.rows[0]?.no_show_count || 0;
          if (threshold > 0 && count >= threshold && action === 'block') {
            await queryWithRLS(bid,
              `UPDATE clients SET
                is_blocked = true,
                blocked_at = NOW(),
                blocked_reason = $1,
                updated_at = NOW()
               WHERE id = $2 AND business_id = $3`,
              [`Bloqué automatiquement : ${count} no-show(s)`, clientId, bid]
            );
          }
        }
      } catch (e) {
        console.warn('No-show strike error (non-blocking):', e.message);
      }
    }

    // ===== UNDO: if reverting from no_show, decrement =====
    if (old.rows[0].status === 'no_show' && status !== 'no_show') {
      try {
        const bkInfo = await queryWithRLS(bid,
          `SELECT client_id FROM bookings WHERE id = $1`, [id]
        );
        if (bkInfo.rows[0]?.client_id) {
          await queryWithRLS(bid,
            `UPDATE clients SET
              no_show_count = GREATEST(no_show_count - 1, 0),
              updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [bkInfo.rows[0].client_id, bid]
          );
        }
      } catch (e) { /* non-blocking */ }
    }

    // ===== WAITLIST TRIGGER ON CANCEL =====
    if (status === 'cancelled') {
      try {
        const { processWaitlistForCancellation } = require('../../services/waitlist');
        await processWaitlistForCancellation(id);
      } catch (e) { /* non-blocking */ }
    }

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

// ============================================================
// PATCH /api/bookings/:id/move — Drag & drop
// UI: Calendar → drag event to new time/date/practitioner
// ============================================================
router.patch('/:id/move', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { start_at, end_at, practitioner_id } = req.body;

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'start_at et end_at requis' });
    }

    // Fetch old data for audit
    const old = await queryWithRLS(bid,
      `SELECT start_at, end_at, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    let sql = `UPDATE bookings SET start_at = $1, end_at = $2, updated_at = NOW()`;
    const params = [start_at, end_at];
    let idx = 3;

    if (practitioner_id) {
      sql += `, practitioner_id = $${idx}`;
      params.push(practitioner_id);
      idx++;
    }

    sql += ` WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING id, start_at, end_at, practitioner_id`;
    params.push(id, bid);

    const result = await queryWithRLS(bid, sql, params);

    // Audit
    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
       VALUES ($1, $2, 'booking', $3, 'move', $4, $5)`,
      [bid, req.user.id, id,
       JSON.stringify(old.rows[0]),
       JSON.stringify({ start_at, end_at, practitioner_id })]
    );

    res.json({ updated: true, booking: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/resize — Resize duration
// UI: Calendar → drag event bottom edge
// ============================================================
router.patch('/:id/resize', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { end_at } = req.body;

    if (!end_at) return res.status(400).json({ error: 'end_at requis' });

    const result = await queryWithRLS(bid,
      `UPDATE bookings SET end_at = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING id, start_at, end_at`,
      [end_at, id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    res.json({ updated: true, booking: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/modify — Full modification by practitioner
// Handles: date, time, duration changes + optional client notification
// UI: Calendar → event detail → "Modifier horaire" section
// ============================================================
router.patch('/:id/modify', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { start_at, end_at, notify, notify_channel } = req.body;
    // notify: boolean — should we notify client?
    // notify_channel: 'email' | 'sms' | 'both'

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'start_at et end_at requis' });
    }

    // Fetch old booking for audit + notification context
    const old = await queryWithRLS(bid,
      `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              s.name AS service_name, p.display_name AS practitioner_name,
              biz.name AS business_name, biz.slug
       FROM bookings b
       JOIN clients c ON c.id = b.client_id
       JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    const oldBooking = old.rows[0];
    const newStatus = notify ? 'modified_pending' : oldBooking.status;

    // Update booking
    const result = await queryWithRLS(bid,
      `UPDATE bookings SET
        start_at = $1, end_at = $2, status = $3, updated_at = NOW()
       WHERE id = $4 AND business_id = $5
       RETURNING *`,
      [start_at, end_at, newStatus, id, bid]
    );

    // Audit with full diff
    const oldTimes = { start_at: oldBooking.start_at, end_at: oldBooking.end_at, status: oldBooking.status };
    const newTimes = { start_at, end_at, status: newStatus, notified: notify || false, channel: notify_channel || null };

    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
       VALUES ($1, $2, 'booking', $3, 'modify', $4, $5)`,
      [bid, req.user.id, id, JSON.stringify(oldTimes), JSON.stringify(newTimes)]
    );

    // If notification requested, send it
    let notificationResult = null;
    if (notify && (notify_channel === 'email' || notify_channel === 'both')) {
      try {
        // Brevo email — will be wired when Brevo is configured
        const baseUrl = process.env.PUBLIC_URL || `https://genda.be`;
        const link = `${baseUrl}/booking/${oldBooking.public_token}`;
        console.log(`[NOTIFY] Email to ${oldBooking.client_email}: booking modified → ${link}`);
        // TODO: Brevo transactional email
        notificationResult = { email: 'queued' };
      } catch (e) {
        console.warn('Email notification error:', e.message);
        notificationResult = { email: 'error', detail: e.message };
      }
    }
    if (notify && (notify_channel === 'sms' || notify_channel === 'both')) {
      try {
        // Twilio SMS — will be wired when Twilio is configured
        const baseUrl = process.env.PUBLIC_URL || `https://genda.be`;
        const link = `${baseUrl}/booking/${oldBooking.public_token}`;
        console.log(`[NOTIFY] SMS to ${oldBooking.client_phone}: booking modified → ${link}`);
        // TODO: Twilio SMS
        notificationResult = { ...notificationResult, sms: 'queued' };
      } catch (e) {
        console.warn('SMS notification error:', e.message);
        notificationResult = { ...notificationResult, sms: 'error', detail: e.message };
      }
    }

    res.json({
      updated: true,
      booking: result.rows[0],
      notification: notificationResult,
      modification: {
        old: { start: oldBooking.start_at, end: oldBooking.end_at },
        new: { start: start_at, end: end_at },
        status_changed: notify ? 'modified_pending' : null
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/note — Quick internal note
// UI: Calendar → event detail → internal note field
// ============================================================
router.patch('/:id/note', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { internal_note, color } = req.body;

    const sets = [];
    const params = [];
    let idx = 1;

    if (internal_note !== undefined) {
      sets.push(`internal_note = $${idx}`);
      params.push(internal_note);
      idx++;
    }
    if (color !== undefined) {
      sets.push(`color = $${idx}`);
      params.push(color);
      idx++;
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });

    sets.push('updated_at = NOW()');
    params.push(id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    res.json({ updated: true, booking: result.rows[0] });
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
              p.display_name AS practitioner_name, p.color AS practitioner_color,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
              c.no_show_count, c.is_blocked
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN clients c ON c.id = b.client_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (booking.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    const notes = await queryWithRLS(bid,
      `SELECT bn.*, u.email AS author_email
       FROM booking_notes bn
       LEFT JOIN users u ON u.id = bn.author_id
       WHERE bn.booking_id = $1
       ORDER BY bn.is_pinned DESC, bn.created_at DESC`,
      [id]
    );

    const todos = await queryWithRLS(bid,
      `SELECT * FROM practitioner_todos
       WHERE booking_id = $1
       ORDER BY sort_order, created_at`,
      [id]
    );

    const reminders = await queryWithRLS(bid,
      `SELECT * FROM booking_reminders
       WHERE booking_id = $1
       ORDER BY remind_at`,
      [id]
    );

    res.json({
      booking: booking.rows[0],
      notes: notes.rows,
      todos: todos.rows,
      reminders: reminders.rows
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// NOTES CRUD — POST / DELETE
// ============================================================
router.post('/:id/notes', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { content, is_pinned } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Contenu requis' });

    const result = await queryWithRLS(bid,
      `INSERT INTO booking_notes (booking_id, business_id, author_id, content, is_pinned)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, bid, req.user.id, content.trim(), is_pinned || false]
    );
    res.status(201).json({ note: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:bookingId/notes/:noteId', async (req, res, next) => {
  try {
    const bid = req.businessId;
    await queryWithRLS(bid,
      `DELETE FROM booking_notes WHERE id = $1 AND booking_id = $2 AND business_id = $3`,
      [req.params.noteId, req.params.bookingId, bid]
    );
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// TODOS CRUD — POST / PATCH / DELETE
// ============================================================
router.post('/:id/todos', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Contenu requis' });

    const result = await queryWithRLS(bid,
      `INSERT INTO practitioner_todos (booking_id, business_id, user_id, content)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, bid, req.user.id, content.trim()]
    );
    res.status(201).json({ todo: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/:bookingId/todos/:todoId', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { is_done, content } = req.body;

    const sets = ['updated_at = NOW()'];
    const params = [];
    let idx = 1;

    if (is_done !== undefined) {
      sets.push(`is_done = $${idx}`);
      params.push(is_done);
      idx++;
      if (is_done) {
        sets.push(`done_at = NOW()`);
      } else {
        sets.push(`done_at = NULL`);
      }
    }
    if (content !== undefined) {
      sets.push(`content = $${idx}`);
      params.push(content.trim());
      idx++;
    }

    // Remove the generic updated_at since we don't have the column
    // practitioner_todos doesn't have updated_at, remove it
    sets.shift();

    params.push(req.params.todoId, req.params.bookingId, bid);
    const result = await queryWithRLS(bid,
      `UPDATE practitioner_todos SET ${sets.join(', ')}
       WHERE id = $${idx} AND booking_id = $${idx + 1} AND business_id = $${idx + 2}
       RETURNING *`,
      params
    );
    res.json({ todo: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:bookingId/todos/:todoId', async (req, res, next) => {
  try {
    const bid = req.businessId;
    await queryWithRLS(bid,
      `DELETE FROM practitioner_todos WHERE id = $1 AND booking_id = $2 AND business_id = $3`,
      [req.params.todoId, req.params.bookingId, bid]
    );
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// REMINDERS CRUD — POST / DELETE
// ============================================================
router.post('/:id/reminders', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { offset_minutes, channel, message } = req.body;
    const offset = parseInt(offset_minutes) || 30;
    const ch = ['browser', 'email', 'both'].includes(channel) ? channel : 'browser';

    // Get booking start time to calculate remind_at
    const bk = await queryWithRLS(bid,
      `SELECT start_at FROM bookings WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    const remindAt = new Date(new Date(bk.rows[0].start_at).getTime() - offset * 60000);

    const result = await queryWithRLS(bid,
      `INSERT INTO booking_reminders (booking_id, business_id, user_id, remind_at, offset_minutes, channel, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, bid, req.user.id, remindAt.toISOString(), offset, ch, message || null]
    );
    res.status(201).json({ reminder: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:bookingId/reminders/:reminderId', async (req, res, next) => {
  try {
    const bid = req.businessId;
    await queryWithRLS(bid,
      `DELETE FROM booking_reminders WHERE id = $1 AND booking_id = $2 AND business_id = $3`,
      [req.params.reminderId, req.params.bookingId, bid]
    );
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
