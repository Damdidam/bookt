/**
 * Booking Time — move, edit, resize, modify (time changes + notifications).
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { sendModificationEmail } = require('../../services/email');
const { calSyncPush, businessAllowsOverlap, checkPracAvailability } = require('./bookings-helpers');

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

    // Prevent practitioners from reassigning bookings to other practitioners
    if (practitioner_id && req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Vous ne pouvez pas réaffecter un RDV à un autre praticien' });
    }

    // Fetch dragged booking + service info + group info
    const old = await queryWithRLS(bid,
      `SELECT b.start_at, b.end_at, b.practitioner_id, b.service_id,
              b.group_id, b.group_order,
              s.duration_min, s.buffer_before_min, s.buffer_after_min
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    const draggedBooking = old.rows[0];
    const effectivePracId = practitioner_id || draggedBooking.practitioner_id;
    const newStart = new Date(start_at);

    // Check practitioner working hours
    const availCheck = await checkPracAvailability(bid, effectivePracId, start_at, end_at);
    if (!availCheck.ok) return res.status(400).json({ error: availCheck.reason });

    const globalAllowOverlap = await businessAllowsOverlap(bid);

    // ── GROUP MOVE: recalculate all slots from the first booking's new start ──
    if (draggedBooking.group_id) {
      // Fetch all group members with their service durations, ordered
      const groupRes = await queryWithRLS(bid,
        `SELECT b.id, b.start_at, b.end_at, b.group_order,
                s.duration_min, s.buffer_before_min, s.buffer_after_min
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order`,
        [draggedBooking.group_id, bid]
      );
      const groupMembers = groupRes.rows;

      // Calculate time delta from dragged booking's original start
      const delta = newStart.getTime() - new Date(draggedBooking.start_at).getTime();

      // Recalculate all slots: chain sequentially from the shifted first booking
      const firstOrigStart = new Date(groupMembers[0].start_at);
      let cursor = new Date(firstOrigStart.getTime() + delta);
      const updates = groupMembers.map(m => {
        // Freestyle members have no service → preserve original duration
        const origDur = (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / 60000;
        const totalMin = m.duration_min != null
          ? (m.buffer_before_min || 0) + m.duration_min + (m.buffer_after_min || 0)
          : origDur;
        const s = new Date(cursor);
        const e = new Date(s.getTime() + totalMin * 60000);
        cursor = e;
        return { id: m.id, start_at: s.toISOString(), end_at: e.toISOString() };
      });

      const totalStart = updates[0].start_at;
      const totalEnd = updates[updates.length - 1].end_at;

      // Note: business hours validation is handled by frontend eventAllow
      // which checks the entire group range against practitioner availability

      // Atomic group move: conflict check + updates in one transaction
      try {
        await transactionWithRLS(bid, async (client) => {
          if (!globalAllowOverlap) {
            const groupIds = groupMembers.map(m => m.id);
            const conflict = await client.query(
              `SELECT id FROM bookings
               WHERE business_id = $1 AND practitioner_id = $2
               AND id != ALL($3)
               AND status IN ('pending', 'confirmed', 'modified_pending')
               AND start_at < $5 AND end_at > $4
               FOR UPDATE`,
              [bid, effectivePracId, groupIds, totalStart, totalEnd]
            );
            if (conflict.rows.length > 0) {
              throw Object.assign(new Error('Créneau déjà pris — impossible de déplacer le groupe ici'), { type: 'conflict' });
            }
          }

          for (const u of updates) {
            let sql = `UPDATE bookings SET start_at = $1, end_at = $2, updated_at = NOW()`;
            const params = [u.start_at, u.end_at];
            let idx = 3;
            if (practitioner_id) {
              sql += `, practitioner_id = $${idx}`;
              params.push(practitioner_id);
              idx++;
            }
            sql += ` WHERE id = $${idx} AND business_id = $${idx + 1}`;
            params.push(u.id, bid);
            await client.query(sql, params);
          }

          await client.query(
            `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
             VALUES ($1, $2, 'booking', $3, 'group_move', $4, $5)`,
            [bid, req.user.id, id,
             JSON.stringify({ group_id: draggedBooking.group_id, original_start: draggedBooking.start_at }),
             JSON.stringify({ new_start: totalStart, new_end: totalEnd })]
          );
        });
      } catch (err) {
        if (err.type === 'conflict') return res.status(409).json({ error: err.message });
        throw err;
      }

      broadcast(bid, 'booking_update', { action: 'moved' });
      updates.forEach(u => calSyncPush(bid, u.id).catch(() => {}));
      return res.json({ updated: true, group_moved: true, count: updates.length });
    }

    // ── SINGLE MOVE (no group) ──
    // Preserve the actual duration from the calendar (frontend sends correct end_at)
    const newEnd = new Date(end_at);
    const recalcEnd = newEnd;

    // Atomic single move: conflict check + update in one transaction
    let moveResult;
    try {
      moveResult = await transactionWithRLS(bid, async (client) => {
        if (!globalAllowOverlap) {
          const conflict = await client.query(
            `SELECT id FROM bookings
             WHERE business_id = $1 AND practitioner_id = $2
             AND id != $3
             AND status IN ('pending', 'confirmed', 'modified_pending')
             AND start_at < $5 AND end_at > $4
             FOR UPDATE`,
            [bid, effectivePracId, id, newStart.toISOString(), recalcEnd.toISOString()]
          );
          if (conflict.rows.length > 0) {
            throw Object.assign(new Error('Créneau déjà pris — un autre RDV chevauche cet horaire'), { type: 'conflict' });
          }
        }

        let sql = `UPDATE bookings SET start_at = $1, end_at = $2, updated_at = NOW()`;
        const params = [newStart.toISOString(), recalcEnd.toISOString()];
        let idx = 3;

        if (practitioner_id) {
          sql += `, practitioner_id = $${idx}`;
          params.push(practitioner_id);
          idx++;
        }

        sql += ` WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING id, start_at, end_at, practitioner_id`;
        params.push(id, bid);

        const r = await client.query(sql, params);

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'move', $4, $5)`,
          [bid, req.user.id, id,
           JSON.stringify(old.rows[0]),
           JSON.stringify({ start_at: newStart.toISOString(), end_at: recalcEnd.toISOString(), practitioner_id })]
        );

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
      throw err;
    }

    broadcast(bid, 'booking_update', { action: 'moved' });
    calSyncPush(bid, id).catch(() => {});
    res.json({ updated: true, booking: moveResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/edit — Edit booking fields (unified modal)
// UI: Calendar → detail modal → Enregistrer
// ============================================================
router.patch('/:id/edit', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { practitioner_id, comment, internal_note, custom_label, color } = req.body;

    // Prevent practitioners from reassigning bookings to other practitioners
    if (practitioner_id !== undefined && req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Vous ne pouvez pas réaffecter un RDV à un autre praticien' });
    }

    // If practitioner_id changes, check for conflicts
    if (practitioner_id !== undefined) {
      // Block reassigning a single member of a group booking
      const groupCheck = await queryWithRLS(bid,
        `SELECT group_id FROM bookings WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );
      if (groupCheck.rows.length > 0 && groupCheck.rows[0].group_id) {
        return res.status(400).json({ error: 'Impossible de réaffecter un seul élément d\'un groupe. Déplacez le groupe entier.' });
      }

      // Verify new practitioner exists and is active
      const pracCheck = await queryWithRLS(bid,
        `SELECT id, is_active FROM practitioners WHERE id = $1 AND business_id = $2`,
        [practitioner_id, bid]
      );
      if (pracCheck.rows.length === 0 || !pracCheck.rows[0].is_active) {
        return res.status(400).json({ error: 'Praticien introuvable ou inactif' });
      }

      // Check target practitioner working hours
      const bkTimes = await queryWithRLS(bid,
        `SELECT start_at, end_at FROM bookings WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );
      if (bkTimes.rows.length > 0) {
        const availCheck = await checkPracAvailability(bid, practitioner_id, bkTimes.rows[0].start_at, bkTimes.rows[0].end_at);
        if (!availCheck.ok) return res.status(400).json({ error: availCheck.reason });
      }

      // Check conflicts with new practitioner's schedule (reuse bkTimes from above)
      const globalAllowOverlap = await businessAllowsOverlap(bid);
      if (!globalAllowOverlap && bkTimes.rows.length > 0) {
        const { start_at, end_at } = bkTimes.rows[0];
        const conflict = await queryWithRLS(bid,
          `SELECT id FROM bookings
           WHERE business_id = $1 AND practitioner_id = $2
           AND id != $3
           AND status IN ('pending', 'confirmed', 'modified_pending')
           AND start_at < $5 AND end_at > $4`,
          [bid, practitioner_id, id, start_at, end_at]
        );
        if (conflict.rows.length > 0) {
          return res.status(409).json({ error: 'Conflit : ce praticien a déjà un RDV sur ce créneau' });
        }
      }
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (practitioner_id !== undefined) { sets.push(`practitioner_id = $${idx++}`); params.push(practitioner_id); }
    if (comment !== undefined) { sets.push(`comment_client = $${idx++}`); params.push(comment || null); }
    if (internal_note !== undefined) { sets.push(`internal_note = $${idx++}`); params.push(internal_note || null); }
    if (custom_label !== undefined) { sets.push(`custom_label = $${idx++}`); params.push(custom_label || null); }
    if (color !== undefined) { sets.push(`color = $${idx++}`); params.push(color || null); }

    if (sets.length === 0) return res.json({ updated: false });

    // Capture old values for audit
    const oldSnap = await queryWithRLS(bid,
      `SELECT practitioner_id, comment_client, internal_note, custom_label, color
       FROM bookings WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );

    sets.push('updated_at = NOW()');
    params.push(id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Audit with old/new data
    const oldData = oldSnap.rows.length > 0 ? oldSnap.rows[0] : {};
    const newData = {};
    if (practitioner_id !== undefined) newData.practitioner_id = practitioner_id;
    if (comment !== undefined) newData.comment = comment;
    if (internal_note !== undefined) newData.internal_note = internal_note;
    if (custom_label !== undefined) newData.custom_label = custom_label;
    if (color !== undefined) newData.color = color;
    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
       VALUES ($1, $2, 'booking', $3, 'edit', $4, $5)`,
      [bid, req.user.id, id, JSON.stringify(oldData), JSON.stringify(newData)]
    );

    broadcast(bid, 'booking_update', { action: 'edited' });
    calSyncPush(bid, id).catch(() => {});
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

    // Get current booking to know start_at, end_at, practitioner, group
    const current = await queryWithRLS(bid,
      `SELECT b.start_at, b.end_at, b.practitioner_id, b.group_id
       FROM bookings b
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Block resize for grouped bookings (durations are service-defined)
    if (current.rows[0].group_id) {
      return res.status(400).json({ error: 'Impossible de redimensionner un RDV groupé — les durées sont définies par les prestations' });
    }

    // Atomic resize: conflict check + update in one transaction
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    let resizeResult;
    try {
      resizeResult = await transactionWithRLS(bid, async (client) => {
        if (!globalAllowOverlap) {
          const conflict = await client.query(
            `SELECT id FROM bookings
             WHERE business_id = $1 AND practitioner_id = $2
             AND id != $3
             AND status IN ('pending', 'confirmed', 'modified_pending')
             AND start_at < $5 AND end_at > $4
             FOR UPDATE`,
            [bid, current.rows[0].practitioner_id, id, current.rows[0].start_at, end_at]
          );
          if (conflict.rows.length > 0) {
            throw Object.assign(new Error('Chevauchement — un autre RDV occupe ce créneau'), { type: 'conflict' });
          }
        }

        return client.query(
          `UPDATE bookings SET end_at = $1, updated_at = NOW()
           WHERE id = $2 AND business_id = $3
           RETURNING id, start_at, end_at`,
          [end_at, id, bid]
        );
      });
    } catch (err) {
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
      throw err;
    }

    // Audit log for resize
    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
       VALUES ($1, $2, 'booking', $3, 'resize', $4, $5)`,
      [bid, req.user.id, id,
       JSON.stringify({ end_at: current.rows[0].end_at }),
       JSON.stringify({ end_at })]
    );

    broadcast(bid, 'booking_update', { action: 'resized' });
    calSyncPush(bid, id).catch(() => {});
    res.json({ updated: true, booking: resizeResult.rows[0] });
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
              biz.name AS business_name, biz.slug, biz.theme, biz.address, biz.email AS business_email
       FROM bookings b
       JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    const oldBooking = old.rows[0];

    const newStatus = notify ? 'modified_pending' : oldBooking.status;

    // Atomic modify: conflict check + update in one transaction
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    let modifyResult;
    try {
      modifyResult = await transactionWithRLS(bid, async (client) => {
        if (!globalAllowOverlap) {
          const conflict = await client.query(
            `SELECT id FROM bookings
             WHERE business_id = $1 AND practitioner_id = $2
             AND id != $3
             AND status IN ('pending', 'confirmed', 'modified_pending')
             AND start_at < $5 AND end_at > $4
             FOR UPDATE`,
            [bid, oldBooking.practitioner_id, id, start_at, end_at]
          );
          if (conflict.rows.length > 0) {
            throw Object.assign(new Error('Créneau déjà pris — un autre RDV chevauche cet horaire'), { type: 'conflict' });
          }
        }

        const r = await client.query(
          `UPDATE bookings SET
            start_at = $1, end_at = $2, status = $3, updated_at = NOW()
           WHERE id = $4 AND business_id = $5
           RETURNING *`,
          [start_at, end_at, newStatus, id, bid]
        );

        const oldTimes = { start_at: oldBooking.start_at, end_at: oldBooking.end_at, status: oldBooking.status };
        const newTimes = { start_at, end_at, status: newStatus, notified: notify || false, channel: notify_channel || null };

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'modify', $4, $5)`,
          [bid, req.user.id, id, JSON.stringify(oldTimes), JSON.stringify(newTimes)]
        );

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
      throw err;
    }

    const result = modifyResult;

    // If notification requested, send it
    let notificationResult = null;
    if (notify && (notify_channel === 'email' || notify_channel === 'both')) {
      try {
        const emailResult = await sendModificationEmail({
          booking: {
            client_name: oldBooking.client_name,
            client_email: oldBooking.client_email,
            public_token: oldBooking.public_token,
            service_name: oldBooking.service_name,
            practitioner_name: oldBooking.practitioner_name,
            old_start_at: oldBooking.start_at,
            old_end_at: oldBooking.end_at,
            new_start_at: start_at,
            new_end_at: end_at
          },
          business: {
            name: oldBooking.business_name,
            email: oldBooking.business_email,
            theme: oldBooking.theme || {},
            address: oldBooking.address
          }
        });
        notificationResult = { email: emailResult.success ? 'sent' : 'error', detail: emailResult.error || emailResult.messageId };
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
        notificationResult = { ...notificationResult, sms: 'queued' };
      } catch (e) {
        console.warn('SMS notification error:', e.message);
        notificationResult = { ...notificationResult, sms: 'error', detail: e.message };
      }
    }

    broadcast(bid, 'booking_update', { action: 'modified' });
    broadcast(bid, 'booking_update', { action: 'moved' });
    calSyncPush(bid, id).catch(() => {});
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

module.exports = router;
