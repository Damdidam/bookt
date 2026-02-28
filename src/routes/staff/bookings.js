const router = require('express').Router();
const { query, queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { sendModificationEmail } = require('../../services/email');
const { requireAuth, resolvePractitionerScope } = require('../../middleware/auth');

router.use(requireAuth);
router.use(resolvePractitionerScope);

// ── Calendar auto-sync helper (non-blocking) ──
async function calSyncPush(businessId, bookingId) {
  try {
    const { pushBookingToCalendar } = require('../../services/calendar-sync');
    const conns = await query(
      `SELECT * FROM calendar_connections
       WHERE business_id = $1 AND status = 'active' AND sync_enabled = true
       AND (sync_direction = 'push' OR sync_direction = 'both')`, [businessId]
    );
    if (conns.rows.length === 0) return;
    const bk = await query(
      `SELECT b.*, s.name AS service_name, s.duration_min, c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
       FROM bookings b JOIN services s ON s.id = b.service_id JOIN clients c ON c.id = b.client_id
       WHERE b.id = $1`, [bookingId]
    );
    if (bk.rows.length === 0) return;
    const qFn = (sql, params) => query(sql, params);
    for (const conn of conns.rows) {
      try { await pushBookingToCalendar(conn, bk.rows[0], qFn); }
      catch (e) { console.warn('[CAL-SYNC] Push failed:', e.message); }
    }
  } catch (e) { /* non-blocking */ }
}

async function calSyncDelete(businessId, bookingId) {
  try {
    const { deleteCalendarEvent } = require('../../services/calendar-sync');
    const conns = await query(
      `SELECT * FROM calendar_connections
       WHERE business_id = $1 AND status = 'active' AND sync_enabled = true
       AND (sync_direction = 'push' OR sync_direction = 'both')`, [businessId]
    );
    const qFn = (sql, params) => query(sql, params);
    for (const conn of conns.rows) {
      try { await deleteCalendarEvent(conn, bookingId, qFn); }
      catch (e) { console.warn('[CAL-SYNC] Delete failed:', e.message); }
    }
  } catch (e) { /* non-blocking */ }
}

// Helper: get global overlap policy from business settings
async function businessAllowsOverlap(bid) {
  const r = await queryWithRLS(bid,
    `SELECT COALESCE((settings->>'allow_overlap')::boolean, false) AS allow_overlap FROM businesses WHERE id = $1`, [bid]);
  return r.rows.length > 0 && r.rows[0].allow_overlap;
}

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
             b.group_id, b.group_order, b.custom_label,
             s.name AS service_name, s.duration_min, s.price_cents, s.color AS service_color,
             p.id AS practitioner_id, p.display_name AS practitioner_name, p.color AS practitioner_color,
             c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
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
    const { service_id, practitioner_id, client_id, start_at, appointment_mode, comment,
            services: multiServices, freestyle, end_at, buffer_before_min, buffer_after_min, custom_label, color } = req.body;

    if (!practitioner_id || !start_at) {
      return res.status(400).json({ error: 'practitioner_id et start_at requis' });
    }

    // Check global overlap policy
    const globalAllowOverlap = await businessAllowsOverlap(bid);

    // ── FREESTYLE MODE: no predefined service ──
    if (freestyle) {
      if (!end_at) return res.status(400).json({ error: 'end_at requis en mode libre' });
      const bufBefore = parseInt(buffer_before_min) || 0;
      const bufAfter = parseInt(buffer_after_min) || 0;
      const realStart = new Date(new Date(start_at).getTime() - bufBefore * 60000);
      const realEnd = new Date(new Date(end_at).getTime() + bufAfter * 60000);

      const bookings = await transactionWithRLS(bid, async (client) => {
        if (!globalAllowOverlap) {
          const conflict = await client.query(
            `SELECT id FROM bookings
             WHERE business_id = $1 AND practitioner_id = $2
             AND status IN ('pending', 'confirmed')
             AND start_at < $4 AND end_at > $3
             FOR UPDATE`,
            [bid, practitioner_id, realStart.toISOString(), realEnd.toISOString()]
          );
          if (conflict.rows.length > 0) {
            throw Object.assign(new Error('Créneau déjà pris'), { type: 'conflict' });
          }
        }

        const result = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
            channel, appointment_mode, start_at, end_at, status, comment_client, custom_label, color)
           VALUES ($1, $2, NULL, $3, 'manual', $4, $5, $6, 'confirmed', $7, $8, $9)
           RETURNING *`,
          [bid, practitioner_id, client_id || null,
           appointment_mode || 'cabinet',
           realStart.toISOString(), realEnd.toISOString(),
           comment || null, custom_label || null, color || null]
        );

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action)
           VALUES ($1, $2, 'booking', $3, 'create')`,
          [bid, req.user.id, result.rows[0].id]
        );

        return [result.rows[0]];
      });

      broadcast(bid, 'booking_update', { action: 'created' });
      calSyncPush(bid, bookings[0].id).catch(() => {});
      return res.status(201).json({ booking: bookings[0], bookings });
    }

    // ── NORMAL MODE: predefined service(s) ──
    const serviceList = multiServices || [{ service_id }];

    if (!practitioner_id || !start_at || serviceList.length === 0) {
      return res.status(400).json({ error: 'practitioner_id, start_at et au moins une prestation requis' });
    }

    // Fetch all service durations
    const svcIds = serviceList.map(s => s.service_id);
    const svcResult = await queryWithRLS(bid,
      `SELECT id, duration_min, buffer_before_min, buffer_after_min
       FROM services WHERE business_id = $1 AND id = ANY($2)`,
      [bid, svcIds]
    );
    const svcMap = {};
    for (const s of svcResult.rows) svcMap[s.id] = s;

    // Validate all services exist
    for (const s of serviceList) {
      if (!svcMap[s.service_id]) return res.status(404).json({ error: `Prestation ${s.service_id} introuvable` });
    }

    // Calculate chained time slots
    const isGroup = serviceList.length > 1;
    const groupId = isGroup ? require('crypto').randomUUID() : null;
    let cursor = new Date(start_at);
    const slots = serviceList.map((s, i) => {
      const svc = svcMap[s.service_id];
      const totalDur = (svc.buffer_before_min || 0) + svc.duration_min + (svc.buffer_after_min || 0);
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart.getTime() + totalDur * 60000);
      cursor = slotEnd; // next service starts where this one ends
      return {
        service_id: s.service_id,
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        group_order: i
      };
    });

    const totalEnd = slots[slots.length - 1].end_at;

    const bookings = await transactionWithRLS(bid, async (client) => {
      // Check conflicts for the entire time range (skip if business allows overlap)
      if (!globalAllowOverlap) {
        const conflict = await client.query(
          `SELECT id FROM bookings
           WHERE business_id = $1 AND practitioner_id = $2
           AND status IN ('pending', 'confirmed')
           AND start_at < $4 AND end_at > $3
           FOR UPDATE`,
          [bid, practitioner_id, new Date(start_at).toISOString(), totalEnd]
        );

        if (conflict.rows.length > 0) {
          throw Object.assign(new Error('Créneau déjà pris'), { type: 'conflict' });
        }
      }

      const results = [];
      for (const slot of slots) {
        const result = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
            channel, appointment_mode, start_at, end_at, status, comment_client,
            group_id, group_order)
           VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, 'confirmed', $8, $9, $10)
           RETURNING *`,
          [bid, practitioner_id, slot.service_id, client_id || null,
           appointment_mode || 'cabinet',
           slot.start_at, slot.end_at,
           comment || null,
           groupId, slot.group_order]
        );
        results.push(result.rows[0]);

        // Audit
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action)
           VALUES ($1, $2, 'booking', $3, 'create')`,
          [bid, req.user.id, result.rows[0].id]
        );
      }

      return results;
    });

    broadcast(bid, 'booking_update', { action: 'created' });
    bookings.forEach(b => calSyncPush(bid, b.id).catch(() => {}));
    res.status(201).json({ booking: bookings[0], bookings, group_id: groupId });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/status
// Update booking status (confirm / complete / no_show / cancel)
// UI: Agenda → action buttons ( Terminé,  No-show, Annuler)
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

    broadcast(bid, 'booking_update', { action: 'status_changed', status });
    if (status === 'cancelled') calSyncDelete(bid, id).catch(() => {});
    else calSyncPush(bid, id).catch(() => {});
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

    const sets = [];
    const params = [];
    let idx = 1;

    if (practitioner_id !== undefined) { sets.push(`practitioner_id = $${idx++}`); params.push(practitioner_id); }
    if (comment !== undefined) { sets.push(`comment_client = $${idx++}`); params.push(comment || null); }
    if (internal_note !== undefined) { sets.push(`internal_note = $${idx++}`); params.push(internal_note || null); }
    if (custom_label !== undefined) { sets.push(`custom_label = $${idx++}`); params.push(custom_label || null); }
    if (color !== undefined) { sets.push(`color = $${idx++}`); params.push(color || null); }

    if (sets.length === 0) return res.json({ updated: false });

    sets.push('updated_at = NOW()');
    params.push(id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Audit
    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action)
       VALUES ($1, $2, 'booking', $3, 'edit')`,
      [bid, req.user.id, id]
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

    // Get current booking to know start_at, practitioner, group
    const current = await queryWithRLS(bid,
      `SELECT b.start_at, b.practitioner_id, b.group_id
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
    let modifyResult;
    try {
      modifyResult = await transactionWithRLS(bid, async (client) => {
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
// DELETE /api/bookings/:id — Permanently delete a cancelled/no-show booking
// UI: Calendar → event detail → "Supprimer définitivement" (only for cancelled/no_show)
// ============================================================
router.delete('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    // Only allow deletion of cancelled or no_show bookings
    const check = await queryWithRLS(bid,
      `SELECT status, group_id FROM bookings WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    if (!['cancelled', 'no_show'].includes(check.rows[0].status)) {
      return res.status(400).json({ error: 'Seuls les RDV annulés ou no-show peuvent être supprimés' });
    }

    // Delete related data first (cascade may handle this, but be explicit)
    await queryWithRLS(bid, `DELETE FROM booking_notes WHERE booking_id = $1 AND business_id = $2`, [id, bid]);
    await queryWithRLS(bid, `DELETE FROM practitioner_todos WHERE booking_id = $1 AND business_id = $2`, [id, bid]);
    await queryWithRLS(bid, `DELETE FROM booking_reminders WHERE booking_id = $1 AND business_id = $2`, [id, bid]);

    // Delete the booking
    await queryWithRLS(bid,
      `DELETE FROM bookings WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );

    // Audit
    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data)
       VALUES ($1, $2, 'booking', $3, 'permanent_delete', $4)`,
      [bid, req.user.id, id, JSON.stringify({ status: check.rows[0].status })]
    );

    broadcast(bid, 'booking_update', { action: 'deleted' });
    res.json({ deleted: true });
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
       LEFT JOIN services s ON s.id = b.service_id
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

    // If part of a group, fetch siblings
    let groupSiblings = [];
    const bk = booking.rows[0];
    if (bk.group_id) {
      const grp = await queryWithRLS(bid,
        `SELECT b.id, b.start_at, b.end_at, b.group_order, b.status,
                s.name AS service_name, s.duration_min, s.color AS service_color
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
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
      group_siblings: groupSiblings
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
