/**
 * Booking Annotations — notes, session notes, todos, reminders, documents.
 */
const router = require('express').Router();
const { query, queryWithRLS } = require('../../services/db');
const { sendPreRdvEmail } = require('../../services/email');

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
// PATCH /api/bookings/:id/session-notes — Save session notes (rich text)
// UI: Calendar → event detail → Séance tab → Enregistrer
// ============================================================
router.patch('/:id/session-notes', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { session_notes } = req.body;

    const result = await queryWithRLS(bid,
      `UPDATE bookings SET session_notes = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3 RETURNING id`,
      [session_notes || null, id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bookings/:id/send-session-notes — Save + send session notes by email
// UI: Calendar → event detail → Séance tab → Envoyer
// ============================================================
router.post('/:id/send-session-notes', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { session_notes } = req.body;

    if (!session_notes || session_notes.trim() === '' || session_notes.trim() === '<br>') {
      return res.status(400).json({ error: 'Notes de séance vides' });
    }

    // Save notes first
    await queryWithRLS(bid,
      `UPDATE bookings SET session_notes = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3`,
      [session_notes, id, bid]
    );

    // Fetch booking + client + business info for email
    const detail = await queryWithRLS(bid,
      `SELECT b.start_at, b.session_notes,
              c.full_name AS client_name, c.email AS client_email,
              s.name AS service_name,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.sector,
              (biz.theme->>'primary_color') AS primary_color
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );

    if (detail.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const d = detail.rows[0];

    if (!d.client_email) {
      return res.status(400).json({ error: 'Le client n\'a pas d\'adresse email' });
    }

    // Send email
    const { sendSessionNotesEmail } = require('../../services/email');
    const dateStr = new Date(d.start_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });

    await sendSessionNotesEmail({
      to: d.client_email,
      toName: d.client_name,
      sessionHTML: session_notes,
      serviceName: d.service_name || 'Rendez-vous',
      date: dateStr,
      practitionerName: d.practitioner_name,
      businessName: d.business_name,
      primaryColor: d.primary_color || '#0D7377'
    });

    // Update sent timestamp
    const upd = await queryWithRLS(bid,
      `UPDATE bookings SET session_notes_sent_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING session_notes_sent_at`,
      [id, bid]
    );

    res.json({ sent: true, sent_at: upd.rows[0]?.session_notes_sent_at });
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

// ============================================================
// POST /api/bookings/:id/send-document — Send a pre-RDV document manually
// UI: Calendar detail modal → Docs tab → "Envoyer un document"
// ============================================================
router.post('/:id/send-document', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const bookingId = req.params.id;
    const { template_id } = req.body;
    if (!template_id) return res.status(400).json({ error: 'template_id requis' });

    // Get booking + client email
    const bk = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.client_id, b.service_id, b.practitioner_id,
              c.full_name AS client_name, c.email AS client_email,
              s.name AS service_name
       FROM bookings b
       JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [bookingId, bid]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const booking = bk.rows[0];
    if (!booking.client_email) return res.status(400).json({ error: 'Le client n\'a pas d\'adresse email' });

    // Get template
    const tpl = await queryWithRLS(bid,
      `SELECT * FROM document_templates WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [template_id, bid]
    );
    if (tpl.rows.length === 0) return res.status(404).json({ error: 'Template introuvable ou inactif' });
    const template = tpl.rows[0];

    // Generate unique token
    const token = require('crypto').randomUUID();

    // Create pre_rdv_sends record
    const send = await queryWithRLS(bid,
      `INSERT INTO pre_rdv_sends (business_id, booking_id, client_id, template_id, token, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'sent', NOW())
       RETURNING *`,
      [bid, bookingId, booking.client_id, template_id, token]
    );

    // Get business info for email
    const biz = await query(`SELECT name, email, address, theme FROM businesses WHERE id = $1`, [bid]);

    // Send email (non-blocking)
    sendPreRdvEmail({
      booking: { ...booking, service_name: booking.service_name || 'Rendez-vous' },
      template,
      token,
      business: biz.rows[0]
    }).catch(e => console.warn('[EMAIL] Pre-RDV send error:', e.message));

    res.status(201).json({
      send: { ...send.rows[0], template_name: template.name, template_type: template.type }
    });
  } catch (err) { next(err); }
});

module.exports = router;
