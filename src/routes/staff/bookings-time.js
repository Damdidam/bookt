/**
 * Booking Time — move, edit, resize, modify (time changes + notifications).
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { sendModificationEmail } = require('../../services/email');
const { sendSMS } = require('../../services/sms');
const { calSyncPush, businessAllowsOverlap, checkPracAvailability, getMaxConcurrent, checkBookingConflicts } = require('./bookings-helpers');

// STS-V12-007: UUID validation regex (reused across all endpoints)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lock is visual-only (cadenas in booking modal).
 * Staff can always move/resize bookings — kept for API compat.
 */
function isBookingLocked(booking) {
  if (booking.locked) return { locked: true, reason: 'RDV verrouillé — déverrouillez-le d\'abord via la fiche' };
  return { locked: false };
}

// ============================================================
// GET /api/bookings/:id/check-slot — Pre-flight slot availability
// UI: Calendar → detail modal → time inputs (debounced 500ms)
// ============================================================
router.get('/:id/check-slot', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { start_at, end_at, practitioner_id } = req.query;
    if (!start_at || !end_at) return res.status(400).json({ error: 'start_at et end_at requis' });
    if (isNaN(new Date(start_at).getTime()) || isNaN(new Date(end_at).getTime())) return res.status(400).json({ error: 'Format invalide' });

    // If overlaps allowed globally, always available
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    if (globalAllowOverlap) return res.json({ available: true });

    // Fetch booking for default practitioner + group + processing info
    const bk = await queryWithRLS(bid,
      `SELECT b.practitioner_id, b.group_id, b.processing_time, b.processing_start,
              COALESCE(s.buffer_before_min, 0) AS buffer_before
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`, [id, bid]);
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const b = bk.rows[0];
    const pracId = practitioner_id || b.practitioner_id;
    const maxConcurrent = await getMaxConcurrent(bid, pracId);

    // Exclude this booking + group siblings
    let excludeIds = [id];
    if (b.group_id) {
      const sibs = await queryWithRLS(bid, `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2`, [b.group_id, bid]);
      excludeIds = sibs.rows.map(r => r.id);
    }

    // Build conflict query (read-only, no FOR UPDATE)
    const params = [bid, pracId, start_at, end_at, excludeIds];
    let reversePoseClause = '';
    const pt = parseInt(b.processing_time) || 0;
    if (pt > 0) {
      params.push(parseInt(b.buffer_before) || 0, parseInt(b.processing_start) || 0, pt);
      reversePoseClause = `AND NOT (
        date_trunc('minute', b.start_at) >= date_trunc('minute', $3::timestamptz) + ($6::integer + $7::integer) * interval '1 minute'
        AND date_trunc('minute', b.end_at) <= date_trunc('minute', $3::timestamptz) + ($6::integer + $7::integer + $8::integer) * interval '1 minute'
      )`;
    }

    const conflicts = await queryWithRLS(bid,
      `SELECT b.id, s.name AS service_name, b.start_at, b.end_at
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1 AND b.practitioner_id = $2
       AND b.status IN ('pending','confirmed','modified_pending','pending_deposit')
       AND b.start_at < $4 AND b.end_at > $3
       AND b.id != ALL($5::uuid[])
       AND NOT (b.processing_time > 0
         AND date_trunc('minute', $3::timestamptz) >= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min,0) + b.processing_start) * interval '1 minute'
         AND date_trunc('minute', $4::timestamptz) <= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min,0) + b.processing_start + b.processing_time) * interval '1 minute')
       ${reversePoseClause}`, params);

    if (conflicts.rows.length >= maxConcurrent) {
      return res.json({ available: false, conflicts: conflicts.rows.map(c => ({
        id: c.id, service_name: c.service_name, start_at: c.start_at, end_at: c.end_at
      }))});
    }
    res.json({ available: true });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/bookings/:id/move — Drag & drop
// UI: Calendar → drag event to new time/date/practitioner
// ============================================================
router.patch('/:id/move', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { start_at, end_at, practitioner_id, notify, notify_channel, old_start_at, old_end_at } = req.body;
    const shouldNotify = notify === true || notify === 'true';
    const effectiveChannel = notify_channel || (shouldNotify ? 'email' : null);

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'start_at et end_at requis' });
    }
    if (isNaN(new Date(start_at).getTime()) || isNaN(new Date(end_at).getTime())) {
      return res.status(400).json({ error: 'Format de date invalide' });
    }
    if (new Date(start_at) >= new Date(end_at)) {
      return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
    }
    // Reject moves too far in the past (2h tolerance)
    if (new Date(start_at).getTime() < Date.now() - 2 * 3600000) {
      return res.status(400).json({ error: 'Impossible de déplacer un rendez-vous aussi loin dans le passé' });
    }

    // CRT-8: Validate practitioner_id belongs to this business and is active
    if (practitioner_id) {
      const pracCheck = await queryWithRLS(bid, `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2 AND is_active = true`, [practitioner_id, bid]);
      if (pracCheck.rows.length === 0) return res.status(400).json({ error: 'Praticien introuvable ou inactif' });
    }

    // Fetch dragged booking + service info + group info
    const old = await queryWithRLS(bid,
      `SELECT b.start_at, b.end_at, b.practitioner_id, b.service_id,
              b.group_id, b.group_order, b.status, b.locked,
              b.processing_time, b.processing_start,
              b.created_at, b.deposit_required,
              s.duration_min, s.buffer_before_min, s.buffer_after_min
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Guard: immutable statuses cannot be moved
    const IMMUTABLE = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE.includes(old.rows[0].status)) {
      return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié' });
    }
    const lockCheck = isBookingLocked(old.rows[0]);
    if (lockCheck.locked) {
      return res.status(400).json({ error: lockCheck.reason });
    }

    const draggedBooking = old.rows[0];

    // CRT-11: Prevent practitioners from reassigning bookings to OTHER practitioners
    // Self-reassignment (same practitioner_id) is allowed for time-only moves
    if (practitioner_id && req.user.role === 'practitioner' && String(practitioner_id) !== String(draggedBooking.practitioner_id)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas réaffecter un RDV à un autre praticien' });
    }

    // Practitioner scope: can only move own bookings
    if (req.practitionerFilter && String(draggedBooking.practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    const effectivePracId = practitioner_id || draggedBooking.practitioner_id;
    const newStart = new Date(start_at);

    const globalAllowOverlap = await businessAllowsOverlap(bid);
    const maxConcurrent = globalAllowOverlap ? Infinity : await getMaxConcurrent(bid, effectivePracId);

    // ── GROUP MOVE: recalculate all slots from the first booking's new start ──
    if (draggedBooking.group_id) {
      // Fetch all group members with their service/variant durations, ordered
      const groupRes = await queryWithRLS(bid,
        `SELECT b.id, b.start_at, b.end_at, b.group_order, b.practitioner_id,
                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                s.buffer_before_min, s.buffer_after_min
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order`,
        [draggedBooking.group_id, bid]
      );
      const groupMembers = groupRes.rows;
      if (groupMembers.length === 0) {
        return res.status(400).json({ error: 'Aucun membre trouvé dans le groupe' });
      }

      // Detect split group (different practitioners) — don't reassign practitioners on move
      const groupPracIds = new Set(groupMembers.map(m => m.practitioner_id));
      const isSplitGroup = groupPracIds.size > 1;

      // Calculate time delta from dragged booking's original start
      const delta = newStart.getTime() - new Date(draggedBooking.start_at).getTime();

      // Recalculate all slots: chain sequentially from the shifted first booking
      const firstOrigStart = new Date(groupMembers[0].start_at);
      let cursor = new Date(firstOrigStart.getTime() + delta);
      const updates = groupMembers.map((m, i) => {
        // Freestyle members have no service → preserve original duration
        const origDur = (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / 60000;
        // BK-V13-001: Only apply buffer_before to first member and buffer_after to last member
        const totalMin = m.duration_min != null
          ? ((i === 0) ? (m.buffer_before_min || 0) : 0) + m.duration_min + ((i === groupMembers.length - 1) ? (m.buffer_after_min || 0) : 0)
          : origDur;
        const s = new Date(cursor);
        const e = new Date(s.getTime() + totalMin * 60000);
        cursor = e;
        return { id: m.id, start_at: s.toISOString(), end_at: e.toISOString(), practitioner_id: m.practitioner_id };
      });

      const totalStart = updates[0].start_at;
      const totalEnd = updates[updates.length - 1].end_at;

      // Check practitioner availability (absences, exceptions, hours)
      if (isSplitGroup) {
        // Split group: check each practitioner for their own time range
        for (const u of updates) {
          const availCheck = await checkPracAvailability(bid, u.practitioner_id, u.start_at, u.end_at);
          if (!availCheck.ok) {
            return res.status(409).json({ error: availCheck.reason });
          }
        }
      } else {
        const availCheck = await checkPracAvailability(bid, effectivePracId, totalStart, totalEnd);
        if (!availCheck.ok) {
          return res.status(409).json({ error: availCheck.reason });
        }
      }

      // Atomic group move: conflict check + updates in one transaction
      try {
        await transactionWithRLS(bid, async (client) => {
          // Bug H8 fix: Lock ALL group members, not just the dragged booking
          const groupLock = await client.query(
            `SELECT id, status FROM bookings
             WHERE group_id = $1 AND business_id = $2 FOR UPDATE`,
            [draggedBooking.group_id, bid]
          );
          const IMMUTABLE = ['cancelled', 'completed', 'no_show'];
          const immutableMember = groupLock.rows.find(r => IMMUTABLE.includes(r.status));
          if (groupLock.rows.length === 0 || immutableMember) {
            throw Object.assign(new Error('Un membre du groupe ne peut plus être modifié'), { type: 'immutable' });
          }

          // CRT-10: Check conflicts for ALL distinct practitioner IDs in the group, not just effectivePracId
          // STS-V12-005 fix: For each practitioner, compute their specific time range from their members
          // only, rather than using the full group totalStart/totalEnd which over-reports conflicts
          if (!globalAllowOverlap) {
            const groupIds = groupMembers.map(m => m.id);
            // For split groups, use each member's own practitioner_id; for non-split, use the target practitioner_id
            const distinctPracIds = [...new Set(updates.map(u => (isSplitGroup ? u.practitioner_id : (practitioner_id || u.practitioner_id))))];
            for (const pracId of distinctPracIds) {
              // Filter updates belonging to this practitioner and compute their min start / max end
              const pracUpdates = updates.filter(u => (isSplitGroup ? u.practitioner_id : (practitioner_id || u.practitioner_id)) === pracId);
              const pracStart = pracUpdates.reduce((min, u) => u.start_at < min ? u.start_at : min, pracUpdates[0].start_at);
              const pracEnd = pracUpdates.reduce((max, u) => u.end_at > max ? u.end_at : max, pracUpdates[0].end_at);
              const pracMaxConcurrent = await getMaxConcurrent(bid, pracId);
              const conflicts = await checkBookingConflicts(client, { bid, pracId, newStart: pracStart, newEnd: pracEnd, excludeIds: groupIds });
              if (conflicts.length >= pracMaxConcurrent) {
                throw Object.assign(new Error('Capacité maximale atteinte — impossible de déplacer le groupe ici'), { type: 'conflict' });
              }
            }
          }

          for (const u of updates) {
            let sql = `UPDATE bookings SET start_at = $1, end_at = $2, updated_at = NOW()`;
            const params = [u.start_at, u.end_at];
            let idx = 3;
            // Only reassign practitioner if NOT a split group (split = each member keeps its own practitioner)
            if (practitioner_id && !isSplitGroup) {
              sql += `, practitioner_id = $${idx}`;
              params.push(practitioner_id);
              idx++;
            }
            sql += ` WHERE id = $${idx} AND business_id = $${idx + 1} AND status NOT IN ('cancelled', 'completed', 'no_show')`;
            params.push(u.id, bid);
            await client.query(sql, params);
          }

          // BK-V13-003: Recalculate deposit deadlines for group members (matching single-move logic)
          for (const u of updates) {
            const memberInfo = await client.query(
              `SELECT deposit_required, deposit_deadline FROM bookings WHERE id = $1 AND business_id = $2`,
              [u.id, bid]
            );
            const mi = memberInfo.rows[0];
            if (mi?.deposit_required && mi.deposit_deadline) {
              let newDeadline = new Date(new Date(mi.deposit_deadline).getTime() + delta);
              const minDeadline = new Date(Date.now() + 60 * 60000);
              if (newDeadline < minDeadline) newDeadline = minDeadline;
              await client.query(
                `UPDATE bookings SET deposit_deadline = $1 WHERE id = $2 AND business_id = $3`,
                [newDeadline.toISOString(), u.id, bid]
              );
            }
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
        if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
        throw err;
      }

      // Send notification for group moves if requested
      let groupNotifResult = null;
      if (shouldNotify) {
        try {
          // Fetch first member + client + business context
          const fullBk = await queryWithRLS(bid,
            `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                    CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                    s.category AS service_category,
                    p.display_name AS practitioner_name,
                    biz.name AS business_name, biz.theme, biz.address, biz.email AS business_email
             FROM bookings b
             LEFT JOIN clients c ON c.id = b.client_id
             LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             JOIN practitioners p ON p.id = b.practitioner_id
             JOIN businesses biz ON biz.id = b.business_id
             WHERE b.id = $1 AND b.business_id = $2`,
            [id, bid]
          );
          const bk = fullBk.rows[0];
          if (bk && bk.client_email) {
            // Fetch all group siblings for the email (multi-service listing)
            const siblingsRes = await queryWithRLS(bid,
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      p.display_name AS practitioner_name
               FROM bookings b
               LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.group_id = $1 AND b.business_id = $2
                 AND b.status NOT IN ('cancelled')
               ORDER BY b.group_order`,
              [draggedBooking.group_id, bid]
            );
            const groupServices = siblingsRes.rows;

            // Only change status to modified_pending if time actually changed
            const refStart = old_start_at || draggedBooking.start_at;
            const refEnd = old_end_at || draggedBooking.end_at;
            const groupTimeMoved = new Date(refStart).getTime() !== new Date(bk.start_at).getTime() || new Date(refEnd).getTime() !== new Date(bk.end_at).getTime();
            if (groupTimeMoved) {
              const newStatus = bk.status === 'pending_deposit' ? 'pending_deposit' : 'modified_pending';
              await queryWithRLS(bid,
                `UPDATE bookings SET status = $1, updated_at = NOW()
                 WHERE group_id = $2 AND business_id = $3
                   AND status NOT IN ('cancelled', 'completed', 'no_show')`,
                [newStatus, draggedBooking.group_id, bid]
              );
            }

            // Use the full group time range (first start → last end)
            const groupTimeRes = await queryWithRLS(bid,
              `SELECT MIN(start_at) AS group_start, MAX(end_at) AS group_end
               FROM bookings WHERE group_id = $1 AND business_id = $2
                 AND status NOT IN ('cancelled')`,
              [draggedBooking.group_id, bid]
            );
            const gt = groupTimeRes.rows[0];

            groupNotifResult = {};
            if (effectiveChannel === 'email' || effectiveChannel === 'both') {
              const emailResult = await sendModificationEmail({
                booking: {
                  client_name: bk.client_name,
                  client_email: bk.client_email,
                  public_token: bk.public_token,
                  service_name: bk.service_name,
                  service_category: bk.service_category,
                  practitioner_name: bk.practitioner_name,
                  old_start_at: old_start_at || draggedBooking.start_at,
                  old_end_at: old_end_at || draggedBooking.end_at,
                  new_start_at: gt.group_start,
                  new_end_at: gt.group_end
                },
                business: {
                  name: bk.business_name,
                  email: bk.business_email,
                  theme: bk.theme || {},
                  address: bk.address
                },
                groupServices: groupServices.length > 1 ? groupServices : undefined
              });
              groupNotifResult.email = emailResult.success ? 'sent' : 'error';
              if (emailResult.error) groupNotifResult.email_detail = emailResult.error;
            }
            if ((effectiveChannel === 'sms' || effectiveChannel === 'both') && bk.client_phone) {
              try {
                const baseUrl = process.env.PUBLIC_URL || 'https://genda.be';
                const manageLink = `${baseUrl}/booking/${bk.public_token}`;
                const newDateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
                const newTimeStr = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
                const timeMoved = new Date(refStart).getTime() !== new Date(bk.start_at).getTime() || new Date(refEnd).getTime() !== new Date(bk.end_at).getTime();
                const smsBody = timeMoved
                  ? `${bk.business_name}: Votre RDV a été modifié — ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`
                  : `${bk.business_name}: Rappel de votre RDV le ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`;
                const smsResult = await sendSMS({ to: bk.client_phone, body: smsBody, businessId: bid });
                groupNotifResult.sms = smsResult.success ? 'sent' : 'error';
              } catch (e) { console.warn('[MOVE] Group SMS error:', e.message); groupNotifResult.sms = 'error'; }
            }
          }
        } catch (e) {
          console.warn('[MOVE] Group notification error:', e.message);
        }
      }

      broadcast(bid, 'booking_update', { action: 'moved' });
      updates.forEach(u => calSyncPush(bid, u.id).catch(() => {}));
      return res.json({ updated: true, group_moved: true, count: updates.length, notification: groupNotifResult });
    }

    // ── SINGLE MOVE (no group) ──
    // Preserve the actual duration from the calendar (frontend sends correct end_at)
    const newEnd = new Date(end_at);

    // Check practitioner availability (absences, exceptions, hours)
    const availCheckSingle = await checkPracAvailability(bid, effectivePracId, start_at, end_at);
    if (!availCheckSingle.ok) {
      return res.status(409).json({ error: availCheckSingle.reason });
    }

    // Atomic single move: conflict check + update + deposit deadline recalc in one transaction
    let moveResult;
    try {
      moveResult = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const statusRecheck = await client.query(
          `SELECT status FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        const IMMUTABLE_TX = ['cancelled', 'completed', 'no_show'];
        if (statusRecheck.rows.length === 0 || IMMUTABLE_TX.includes(statusRecheck.rows[0].status)) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié'), { type: 'immutable' });
        }

        if (!globalAllowOverlap) {
          const conflicts = await checkBookingConflicts(client, { bid, pracId: effectivePracId, newStart: newStart.toISOString(), newEnd: newEnd.toISOString(), excludeIds: id, movingProcTime: parseInt(draggedBooking.processing_time) || 0, movingProcStart: parseInt(draggedBooking.processing_start) || 0, movingBufferBefore: parseInt(draggedBooking.buffer_before_min) || 0 });
          if (conflicts.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        let sql = `UPDATE bookings SET start_at = $1, end_at = $2, updated_at = NOW()`;
        const params = [newStart.toISOString(), newEnd.toISOString()];
        let idx = 3;

        if (practitioner_id) {
          sql += `, practitioner_id = $${idx}`;
          params.push(practitioner_id);
          idx++;
        }

        sql += ` WHERE id = $${idx} AND business_id = $${idx + 1} AND status NOT IN ('cancelled', 'completed', 'no_show') RETURNING id, start_at, end_at, practitioner_id, deposit_required, deposit_deadline`;
        params.push(id, bid);

        const r = await client.query(sql, params);

        // Recalculate deposit deadline if booking has pending deposit
        // Bug M11 fix: Ensure deadline doesn't shift to the past
        const moved = r.rows[0];
        if (moved && moved.deposit_required && moved.deposit_deadline) {
          const timeDelta = newStart.getTime() - new Date(draggedBooking.start_at).getTime();
          let newDeadline = new Date(new Date(moved.deposit_deadline).getTime() + timeDelta);
          // If new deadline would be in the past, set to NOW() + 1 hour minimum buffer
          const minDeadline = new Date(Date.now() + 60 * 60000);
          if (newDeadline < minDeadline) {
            newDeadline = minDeadline;
          }
          await client.query(
            `UPDATE bookings SET deposit_deadline = $1 WHERE id = $2 AND business_id = $3`,
            [newDeadline.toISOString(), id, bid]
          );
        }

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'move', $4, $5)`,
          [bid, req.user.id, id,
           JSON.stringify(old.rows[0]),
           JSON.stringify({ start_at: newStart.toISOString(), end_at: newEnd.toISOString(), practitioner_id })]
        );

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
      throw err;
    }

    // Send notification if requested (drag-drop → "Notifier" button)
    let notificationResult = null;
    if (shouldNotify) {
      try {
        // Fetch full context for the notification email
        const fullBk = await queryWithRLS(bid,
          `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  p.display_name AS practitioner_name,
                  biz.name AS business_name, biz.theme, biz.address, biz.email AS business_email
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        const bk = fullBk.rows[0];
        if (bk && bk.client_email) {
          // Only change status to modified_pending if time actually changed
          const sRefStart = old_start_at || draggedBooking.start_at;
          const sRefEnd = old_end_at || draggedBooking.end_at;
          const singleTimeMoved = new Date(sRefStart).getTime() !== new Date(bk.start_at).getTime() || new Date(sRefEnd).getTime() !== new Date(bk.end_at).getTime();
          if (singleTimeMoved) {
            const newStatus = bk.status === 'pending_deposit' ? 'pending_deposit' : 'modified_pending';
            await queryWithRLS(bid,
              `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3`,
              [newStatus, id, bid]
            );
            // For groups, also update siblings
            if (draggedBooking.group_id) {
              await queryWithRLS(bid,
                `UPDATE bookings SET status = $1, updated_at = NOW()
                 WHERE group_id = $2 AND business_id = $3 AND id != $4
                   AND status NOT IN ('cancelled', 'completed', 'no_show')`,
                [newStatus, draggedBooking.group_id, bid, id]
              );
            }
          }

          notificationResult = {};
          if (effectiveChannel === 'email' || effectiveChannel === 'both') {
            try {
              const emailResult = await sendModificationEmail({
                booking: {
                  client_name: bk.client_name,
                  client_email: bk.client_email,
                  public_token: bk.public_token,
                  service_name: bk.service_name,
                  service_category: bk.service_category,
                  practitioner_name: bk.practitioner_name,
                  old_start_at: old_start_at || draggedBooking.start_at,
                  old_end_at: old_end_at || draggedBooking.end_at,
                  new_start_at: bk.start_at,
                  new_end_at: bk.end_at
                },
                business: {
                  name: bk.business_name,
                  email: bk.business_email,
                  theme: bk.theme || {},
                  address: bk.address
                }
              });
              notificationResult.email = emailResult.success ? 'sent' : 'error';
              if (emailResult.error) notificationResult.email_detail = emailResult.error;
            } catch (e) {
              console.warn('[MOVE] Email notification error:', e.message);
              notificationResult.email = 'error';
            }
          }
          if ((effectiveChannel === 'sms' || effectiveChannel === 'both') && bk.client_phone) {
            try {
              const baseUrl = process.env.PUBLIC_URL || 'https://genda.be';
              const manageLink = `${baseUrl}/booking/${bk.public_token}`;
              const newDateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
              const newTimeStr = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
              const timeMoved = new Date(sRefStart).getTime() !== new Date(bk.start_at).getTime() || new Date(sRefEnd).getTime() !== new Date(bk.end_at).getTime();
              const smsBody = timeMoved
                ? `${bk.business_name}: Votre RDV a été modifié — ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`
                : `${bk.business_name}: Rappel de votre RDV le ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`;
              const smsResult = await sendSMS({ to: bk.client_phone, body: smsBody, businessId: bid });
              notificationResult.sms = smsResult.success ? 'sent' : 'error';
            } catch (e) { console.warn('[MOVE] SMS error:', e.message); notificationResult.sms = 'error'; }
          }
        }
      } catch (e) {
        console.warn('[MOVE] Notification error:', e.message);
      }
    }

    broadcast(bid, 'booking_update', { action: 'moved' });
    calSyncPush(bid, id).catch(() => {});
    res.json({ updated: true, booking: moveResult.rows[0], notification: notificationResult });
  } catch (err) {
    console.error('[MOVE] Crash for booking', req.params.id, ':', err.message, err.stack?.split('\n')[1]);
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
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { practitioner_id, comment, internal_note, custom_label, color, locked, service_id, service_variant_id } = req.body;

    // CRT-13: Validate comment/note length
    if (comment && comment.length > 5000) {
      return res.status(400).json({ error: 'Commentaire trop long (max 5000 caractères)' });
    }
    if (internal_note && internal_note.length > 10000) {
      return res.status(400).json({ error: 'Note interne trop longue (max 10000 caractères)' });
    }

    // Prevent practitioners from reassigning bookings to other practitioners
    if (practitioner_id !== undefined && req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Vous ne pouvez pas réaffecter un RDV à un autre praticien' });
    }

    // Validate color hex format
    if (color !== undefined && color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Format de couleur invalide (ex: #FF5733)' });
    }

    // Pre-flight existence check (non-authoritative; real guard is inside transaction)
    const statusCheck = await queryWithRLS(bid,
      `SELECT status, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (statusCheck.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Practitioner scope: can only edit own bookings
    if (req.practitionerFilter && String(statusCheck.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // CRT-V11: For immutable statuses, only block time-related and practitioner changes.
    // Allow annotation-only edits (comment, internal_note, custom_label, color).
    const IMMUTABLE_EDIT = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE_EDIT.includes(statusCheck.rows[0].status)) {
      if (practitioner_id !== undefined) {
        return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié (changement de praticien interdit)' });
      }
      // Only annotation fields are allowed for immutable statuses
      const allowedFields = ['comment', 'internal_note', 'custom_label', 'color', 'locked'];
      const requestedFields = Object.keys(req.body).filter(k => req.body[k] !== undefined);
      const hasDisallowedField = requestedFields.some(k => !allowedFields.includes(k));
      if (hasDisallowedField) {
        return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié (seuls commentaire, note interne, libellé et couleur sont autorisés)' });
      }
    }

    // Service conversion (freestyle ↔ service)
    let serviceConversion = null;
    if (service_id !== undefined) {
      // Block on grouped bookings
      const groupCheck2 = await queryWithRLS(bid,
        `SELECT group_id FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]);
      if (groupCheck2.rows[0]?.group_id) {
        return res.status(400).json({ error: 'Impossible de changer la prestation d\'un RDV groupé.' });
      }

      if (service_id === null) {
        serviceConversion = { toFree: true };
      } else {
        if (!UUID_RE.test(service_id)) return res.status(400).json({ error: 'service_id invalide' });
        const svcCheck = await queryWithRLS(bid,
          `SELECT id, duration_min, buffer_before_min, buffer_after_min, processing_time, processing_start
           FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
          [service_id, bid]);
        if (svcCheck.rows.length === 0) return res.status(400).json({ error: 'Service introuvable ou inactif' });
        const svc = svcCheck.rows[0];
        let dur = svc.duration_min, pt = svc.processing_time || 0, ps = svc.processing_start || 0;

        if (service_variant_id) {
          if (!UUID_RE.test(service_variant_id)) return res.status(400).json({ error: 'variant_id invalide' });
          const varCheck = await queryWithRLS(bid,
            `SELECT duration_min, processing_time, processing_start
             FROM service_variants WHERE id = $1 AND service_id = $2`,
            [service_variant_id, service_id]);
          if (varCheck.rows.length > 0) {
            dur = varCheck.rows[0].duration_min || dur;
            pt = varCheck.rows[0].processing_time ?? pt;
            ps = varCheck.rows[0].processing_start ?? ps;
          }
        }

        const bkForEnd = await queryWithRLS(bid,
          `SELECT start_at FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]);
        const startAt = new Date(bkForEnd.rows[0].start_at);
        const totalMin = (svc.buffer_before_min || 0) + dur + (svc.buffer_after_min || 0);
        const newEnd = new Date(startAt.getTime() + totalMin * 60000);

        serviceConversion = {
          toService: true, service_id, service_variant_id: service_variant_id || null,
          processing_time: pt, processing_start: ps, end_at: newEnd.toISOString()
        };
      }
    }

    // If practitioner_id changes, check for conflicts (transaction vars)
    let calState_editConflictNeeded = false;
    let calState_editOverlap = false;
    let calState_editMaxConcurrent = 1;
    let calState_editTimes = null;

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
        `SELECT b.start_at, b.end_at, b.processing_time, b.processing_start, COALESCE(s.buffer_before_min, 0) AS buffer_before_min
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id WHERE b.id = $1 AND b.business_id = $2`,
        [id, bid]
      );
      // Check target practitioner availability (absences, exceptions, hours)
      if (bkTimes.rows[0]) {
        const availCheckReassign = await checkPracAvailability(bid, practitioner_id, bkTimes.rows[0].start_at, bkTimes.rows[0].end_at);
        if (!availCheckReassign.ok) {
          return res.status(409).json({ error: availCheckReassign.reason });
        }
      }

      // Check conflicts with new practitioner's schedule (reuse bkTimes from above)
      // This will be done inside a transaction below for atomicity
      calState_editConflictNeeded = true;
      calState_editOverlap = await businessAllowsOverlap(bid);
      calState_editMaxConcurrent = calState_editOverlap ? Infinity : await getMaxConcurrent(bid, practitioner_id);
      calState_editTimes = bkTimes.rows[0];
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (practitioner_id !== undefined) { sets.push(`practitioner_id = $${idx++}`); params.push(practitioner_id); }
    if (comment !== undefined) { sets.push(`comment_client = $${idx++}`); params.push(comment || null); }
    if (internal_note !== undefined) { sets.push(`internal_note = $${idx++}`); params.push(internal_note || null); }
    if (custom_label !== undefined) { sets.push(`custom_label = $${idx++}`); params.push(custom_label || null); }
    if (color !== undefined) { sets.push(`color = $${idx++}`); params.push(color || null); }
    if (locked !== undefined) { sets.push(`locked = $${idx++}`); params.push(!!locked); }

    // Service conversion SET clauses
    if (serviceConversion) {
      if (serviceConversion.toFree) {
        sets.push(`service_id = NULL`, `service_variant_id = NULL`, `processing_time = 0`, `processing_start = 0`);
      } else {
        sets.push(`service_id = $${idx++}`); params.push(serviceConversion.service_id);
        sets.push(`service_variant_id = $${idx++}`); params.push(serviceConversion.service_variant_id);
        sets.push(`processing_time = $${idx++}`); params.push(serviceConversion.processing_time);
        sets.push(`processing_start = $${idx++}`); params.push(serviceConversion.processing_start);
        sets.push(`end_at = $${idx++}`); params.push(serviceConversion.end_at);
        sets.push(`custom_label = NULL`);
      }
    }

    if (sets.length === 0) return res.json({ updated: false });

    sets.push('updated_at = NOW()');
    params.push(id, bid);

    const updateSql = `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`;

    // If practitioner reassignment, wrap conflict check + update in a transaction
    let result;
    let oldSnap;
    if (calState_editConflictNeeded && !calState_editOverlap && calState_editTimes) {
      try {
        const txRes = await transactionWithRLS(bid, async (client) => {
          // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
          const snap = await client.query(
            `SELECT practitioner_id, comment_client, internal_note, custom_label, color, status
             FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
            [id, bid]
          );
          // CRT-V11: Block practitioner reassignment for immutable statuses
          if (snap.rows.length > 0 && ['cancelled', 'completed', 'no_show'].includes(snap.rows[0].status) && practitioner_id !== undefined) {
            throw Object.assign(new Error('Ce RDV ne peut plus être modifié (changement de praticien interdit)'), { type: 'immutable' });
          }
          const conflicts = await checkBookingConflicts(client, { bid, pracId: practitioner_id, newStart: calState_editTimes.start_at, newEnd: calState_editTimes.end_at, excludeIds: id, movingProcTime: parseInt(calState_editTimes.processing_time) || 0, movingProcStart: parseInt(calState_editTimes.processing_start) || 0, movingBufferBefore: parseInt(calState_editTimes.buffer_before_min) || 0 });
          if (conflicts.length >= calState_editMaxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
          const r = await client.query(updateSql, params);

          // Audit log inside transaction for atomicity
          if (r.rows.length > 0) {
            const od = snap.rows.length > 0 ? snap.rows[0] : {};
            const nd = {};
            if (practitioner_id !== undefined) nd.practitioner_id = practitioner_id;
            if (comment !== undefined) nd.comment = comment;
            if (internal_note !== undefined) nd.internal_note = internal_note;
            if (custom_label !== undefined) nd.custom_label = custom_label;
            if (color !== undefined) nd.color = color;
            await client.query(
              `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
               VALUES ($1, $2, 'booking', $3, 'edit', $4, $5)`,
              [bid, req.user.id, id, JSON.stringify(od), JSON.stringify(nd)]
            );
          }

          return { result: r, oldSnap: snap };
        });
        result = txRes.result;
        oldSnap = txRes.oldSnap;
      } catch (err) {
        if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
        throw err;
      }
    } else {
      // Wrap update + audit in transaction for atomicity
      const txRes = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const snap = await client.query(
          `SELECT practitioner_id, comment_client, internal_note, custom_label, color, status
           FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        // CRT-V11: Allow annotation-only edits for immutable statuses (no practitioner change in this branch)
        if (snap.rows.length > 0 && ['cancelled', 'completed', 'no_show'].includes(snap.rows[0].status) && practitioner_id !== undefined) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié (changement de praticien interdit)'), { type: 'immutable' });
        }
        const r = await client.query(updateSql, params);

        if (r.rows.length > 0) {
          const od = snap.rows.length > 0 ? snap.rows[0] : {};
          const nd = {};
          if (practitioner_id !== undefined) nd.practitioner_id = practitioner_id;
          if (comment !== undefined) nd.comment = comment;
          if (internal_note !== undefined) nd.internal_note = internal_note;
          if (custom_label !== undefined) nd.custom_label = custom_label;
          if (color !== undefined) nd.color = color;
          await client.query(
            `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
             VALUES ($1, $2, 'booking', $3, 'edit', $4, $5)`,
            [bid, req.user.id, id, JSON.stringify(od), JSON.stringify(nd)]
          );
        }

        return { result: r, oldSnap: snap };
      });
      result = txRes.result;
      oldSnap = txRes.oldSnap;
    }

    if (!result || result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    broadcast(bid, 'booking_update', { action: 'edited' });
    calSyncPush(bid, id).catch(() => {});
    res.json({ updated: true, booking: result.rows[0] });
  } catch (err) {
    if (err.type === 'immutable') return res.status(400).json({ error: err.message });
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
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { end_at } = req.body;

    if (!end_at) return res.status(400).json({ error: 'end_at requis' });
    if (isNaN(new Date(end_at).getTime())) {
      return res.status(400).json({ error: 'Format de date invalide' });
    }

    // Get current booking to know start_at, end_at, practitioner, group, status
    const current = await queryWithRLS(bid,
      `SELECT b.start_at, b.end_at, b.practitioner_id, b.group_id, b.status, b.locked,
              b.processing_time, b.processing_start, b.created_at, b.deposit_required,
              COALESCE(s.buffer_before_min, 0) AS buffer_before_min
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Practitioner scope: can only resize own bookings
    if (req.practitionerFilter && String(current.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // Guard: immutable statuses cannot be resized
    const IMMUTABLE_RESIZE = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE_RESIZE.includes(current.rows[0].status)) {
      return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié' });
    }
    const lockCheckResize = isBookingLocked(current.rows[0]);
    if (lockCheckResize.locked) {
      return res.status(400).json({ error: lockCheckResize.reason });
    }

    // Validate end > start
    if (new Date(end_at) <= new Date(current.rows[0].start_at)) {
      return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
    }

    // Block resize for grouped bookings (durations are service-defined)
    if (current.rows[0].group_id) {
      return res.status(400).json({ error: 'Impossible de redimensionner un RDV groupé — les durées sont définies par les prestations' });
    }

    // Check practitioner availability (absences, exceptions, hours)
    const availCheckResize = await checkPracAvailability(bid, current.rows[0].practitioner_id, current.rows[0].start_at, end_at);
    if (!availCheckResize.ok) {
      return res.status(409).json({ error: availCheckResize.reason });
    }

    // Atomic resize: conflict check + update in one transaction
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    const maxConcurrent = globalAllowOverlap ? Infinity : await getMaxConcurrent(bid, current.rows[0].practitioner_id);
    let resizeResult;
    try {
      resizeResult = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const statusRecheck = await client.query(
          `SELECT status FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        if (statusRecheck.rows.length === 0 || ['cancelled', 'completed', 'no_show'].includes(statusRecheck.rows[0].status)) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié'), { type: 'immutable' });
        }

        if (!globalAllowOverlap) {
          const conflicts = await checkBookingConflicts(client, { bid, pracId: current.rows[0].practitioner_id, newStart: current.rows[0].start_at, newEnd: end_at, excludeIds: id, movingProcTime: parseInt(current.rows[0].processing_time) || 0, movingProcStart: parseInt(current.rows[0].processing_start) || 0, movingBufferBefore: parseInt(current.rows[0].buffer_before_min) || 0 });
          if (conflicts.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        const r = await client.query(
          `UPDATE bookings SET end_at = $1, updated_at = NOW()
           WHERE id = $2 AND business_id = $3 AND status NOT IN ('cancelled', 'completed', 'no_show')
           RETURNING id, start_at, end_at`,
          [end_at, id, bid]
        );

        // Audit log inside transaction for atomicity
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'resize', $4, $5)`,
          [bid, req.user.id, id,
           JSON.stringify({ end_at: current.rows[0].end_at }),
           JSON.stringify({ end_at })]
        );

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
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
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { start_at, end_at, notify, notify_channel } = req.body;
    // Bug M11 fix: normalize notify so "false" string is not truthy
    const shouldNotify = notify === true || notify === 'true';
    // CRT-15: Default notify_channel to 'email' when shouldNotify is true
    const effectiveChannel = notify_channel || (shouldNotify ? 'email' : null);
    // notify_channel: 'email' | 'sms' | 'both'

    const VALID_CHANNELS = ['email', 'sms', 'both'];
    if (effectiveChannel && !VALID_CHANNELS.includes(effectiveChannel)) {
      return res.status(400).json({ error: `Canal invalide. Valeurs : ${VALID_CHANNELS.join(', ')}` });
    }

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'start_at et end_at requis' });
    }
    if (isNaN(new Date(start_at).getTime()) || isNaN(new Date(end_at).getTime())) {
      return res.status(400).json({ error: 'Format de date invalide' });
    }
    if (new Date(start_at) >= new Date(end_at)) {
      return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
    }

    // Fetch old booking for audit + notification context
    const old = await queryWithRLS(bid,
      `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
              s.category AS service_category,
              COALESCE(s.buffer_before_min, 0) AS svc_buffer_before,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.slug, biz.theme, biz.address, biz.email AS business_email
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Guard: immutable statuses cannot be modified
    const IMMUTABLE_MOD = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE_MOD.includes(old.rows[0].status)) {
      return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié' });
    }
    const lockCheckMod = isBookingLocked(old.rows[0]);
    if (lockCheckMod.locked) {
      return res.status(400).json({ error: lockCheckMod.reason });
    }

    const oldBooking = old.rows[0];

    // CRT-V10-2: Block individual modify on grouped bookings
    if (oldBooking.group_id) {
      return res.status(400).json({ error: 'Impossible de modifier individuellement un RDV groupé. Utilisez le déplacement.' });
    }

    // Practitioner scope: can only modify own bookings
    if (req.practitionerFilter && String(oldBooking.practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // Check practitioner availability (absences, exceptions, hours)
    const availCheckModify = await checkPracAvailability(bid, oldBooking.practitioner_id, start_at, end_at);
    if (!availCheckModify.ok) {
      return res.status(409).json({ error: availCheckModify.reason });
    }

    // BK-V13-002: newStatus is now computed inside the transaction using re-checked status

    // Atomic modify: conflict check + update in one transaction
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    const maxConcurrent = globalAllowOverlap ? Infinity : await getMaxConcurrent(bid, oldBooking.practitioner_id);
    let modifyResult;
    try {
      modifyResult = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const statusRecheck = await client.query(
          `SELECT status FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        if (statusRecheck.rows.length === 0 || ['cancelled', 'completed', 'no_show'].includes(statusRecheck.rows[0].status)) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié'), { type: 'immutable' });
        }

        // BK-V13-002: Compute newStatus inside transaction using re-checked status to avoid stale data
        const recheckStatus = statusRecheck.rows[0].status;
        const modifyTimeMoved = new Date(oldBooking.start_at).getTime() !== new Date(start_at).getTime() || new Date(oldBooking.end_at).getTime() !== new Date(end_at).getTime();
        const newStatus = (shouldNotify && modifyTimeMoved)
          ? (recheckStatus === 'pending_deposit' ? 'pending_deposit' : 'modified_pending')
          : recheckStatus;

        if (!globalAllowOverlap) {
          const conflicts = await checkBookingConflicts(client, { bid, pracId: oldBooking.practitioner_id, newStart: start_at, newEnd: end_at, excludeIds: id, movingProcTime: parseInt(oldBooking.processing_time) || 0, movingProcStart: parseInt(oldBooking.processing_start) || 0, movingBufferBefore: parseInt(oldBooking.svc_buffer_before) || 0 });
          if (conflicts.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        const r = await client.query(
          `UPDATE bookings SET
            start_at = $1, end_at = $2, status = $3, updated_at = NOW()
           WHERE id = $4 AND business_id = $5 AND status NOT IN ('cancelled', 'completed', 'no_show')
           RETURNING *`,
          [start_at, end_at, newStatus, id, bid]
        );

        // Recalculate deposit deadline if booking has pending deposit
        // Bug M11 fix: Ensure deadline doesn't shift to the past
        const modified = r.rows[0];
        if (modified && modified.deposit_required && modified.deposit_deadline) {
          const timeDelta = new Date(start_at).getTime() - new Date(oldBooking.start_at).getTime();
          let newDeadline = new Date(new Date(modified.deposit_deadline).getTime() + timeDelta);
          const minDeadline = new Date(Date.now() + 60 * 60000);
          if (newDeadline < minDeadline) {
            newDeadline = minDeadline;
          }
          await client.query(
            `UPDATE bookings SET deposit_deadline = $1 WHERE id = $2 AND business_id = $3`,
            [newDeadline.toISOString(), id, bid]
          );
        }

        const oldTimes = { start_at: oldBooking.start_at, end_at: oldBooking.end_at, status: oldBooking.status };
        const newTimes = { start_at, end_at, status: newStatus, notified: shouldNotify, channel: effectiveChannel };

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'modify', $4, $5)`,
          [bid, req.user.id, id, JSON.stringify(oldTimes), JSON.stringify(newTimes)]
        );

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
      throw err;
    }

    const result = modifyResult;

    // If notification requested, send it
    let notificationResult = null;
    if (shouldNotify && (effectiveChannel === 'email' || effectiveChannel === 'both')) {
      try {
        const emailResult = await sendModificationEmail({
          booking: {
            client_name: oldBooking.client_name,
            client_email: oldBooking.client_email,
            public_token: oldBooking.public_token,
            service_name: oldBooking.service_name,
            service_category: oldBooking.service_category,
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
    if (shouldNotify && (effectiveChannel === 'sms' || effectiveChannel === 'both') && oldBooking.client_phone) {
      try {
        const baseUrl = process.env.PUBLIC_URL || 'https://genda.be';
        const manageLink = `${baseUrl}/booking/${oldBooking.public_token}`;
        const newDateStr = new Date(start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
        const newTimeStr = new Date(start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
        const timeMoved = new Date(oldBooking.start_at).getTime() !== new Date(start_at).getTime() || new Date(oldBooking.end_at).getTime() !== new Date(end_at).getTime();
        const smsBody = timeMoved
          ? `${oldBooking.business_name}: Votre RDV a été modifié — ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`
          : `${oldBooking.business_name}: Rappel de votre RDV le ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`;
        const smsResult = await sendSMS({ to: oldBooking.client_phone, body: smsBody, businessId: bid });
        notificationResult = { ...notificationResult, sms: smsResult.success ? 'sent' : 'error' };
      } catch (e) {
        console.warn('[MODIFY] SMS error:', e.message);
        notificationResult = { ...notificationResult, sms: 'error' };
      }
    }

    broadcast(bid, 'booking_update', { action: 'modified' });
    calSyncPush(bid, id).catch(() => {});
    res.json({
      updated: true,
      booking: result.rows[0],
      notification: notificationResult,
      modification: {
        old: { start: oldBooking.start_at, end: oldBooking.end_at },
        new: { start: start_at, end: end_at },
        status_changed: shouldNotify ? result.rows[0]?.status : null
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/reorder-group — Reorder services within a group
// UI: Booking detail modal → ↑/↓ buttons on group members
// ============================================================
router.patch('/:id/reorder-group', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { ordered_ids } = req.body;

    if (!Array.isArray(ordered_ids) || ordered_ids.length < 2) {
      return res.status(400).json({ error: 'ordered_ids requis (min 2)' });
    }
    if (ordered_ids.some(oid => !UUID_RE.test(oid))) {
      return res.status(400).json({ error: 'ordered_ids invalide(s)' });
    }

    // Fetch booking to get group_id
    const bkRes = await queryWithRLS(bid,
      `SELECT group_id FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]);
    if (bkRes.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const { group_id } = bkRes.rows[0];
    if (!group_id) return res.status(400).json({ error: 'Ce RDV ne fait pas partie d\'un groupe' });

    // Fetch all siblings with service durations
    const grpRes = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.group_order, b.status,
              s.duration_min, s.buffer_before_min, s.buffer_after_min
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.group_id = $1 AND b.business_id = $2
       ORDER BY b.group_order`,
      [group_id, bid]);
    const members = grpRes.rows;

    // Validate ordered_ids matches exactly the group members
    const memberIds = new Set(members.map(m => m.id));
    if (ordered_ids.length !== members.length || !ordered_ids.every(oid => memberIds.has(oid))) {
      return res.status(400).json({ error: 'ordered_ids ne correspond pas aux membres du groupe' });
    }

    // Build reordered list
    const memberMap = Object.fromEntries(members.map(m => [m.id, m]));
    const reordered = ordered_ids.map(oid => memberMap[oid]);

    // Recalculate chain: cursor starts at original first booking's start_at
    const chainStart = new Date(members[0].start_at);
    let cursor = new Date(chainStart);
    const updates = reordered.map((m, i) => {
      const origDur = (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / 60000;
      const totalMin = m.duration_min != null
        ? ((i === 0) ? (m.buffer_before_min || 0) : 0) + m.duration_min + ((i === reordered.length - 1) ? (m.buffer_after_min || 0) : 0)
        : origDur;
      const s = new Date(cursor);
      const e = new Date(s.getTime() + totalMin * 60000);
      cursor = e;
      return { id: m.id, group_order: i, start_at: s.toISOString(), end_at: e.toISOString() };
    });

    await transactionWithRLS(bid, async (client) => {
      // Lock group members
      const lockRes = await client.query(
        `SELECT id, status FROM bookings WHERE group_id = $1 AND business_id = $2 FOR UPDATE`,
        [group_id, bid]);
      const IMMUTABLE = ['cancelled', 'completed', 'no_show'];
      if (lockRes.rows.some(r => IMMUTABLE.includes(r.status))) {
        throw Object.assign(new Error('Un membre du groupe ne peut plus être modifié'), { type: 'immutable' });
      }

      for (const u of updates) {
        await client.query(
          `UPDATE bookings SET group_order = $1, start_at = $2, end_at = $3, updated_at = NOW()
           WHERE id = $4 AND business_id = $5`,
          [u.group_order, u.start_at, u.end_at, u.id, bid]);
      }

      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'group_reorder', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ old_order: members.map(m => m.id) }),
         JSON.stringify({ new_order: ordered_ids })]);
    });

    broadcast(bid, 'booking_update', { action: 'reordered' });
    res.json({ updated: true, count: updates.length });
  } catch (err) {
    if (err.type === 'immutable') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// POST /api/bookings/:id/send-reminder — Manual reminder (SMS/email/both)
// UI: Booking detail modal → "Envoyer un rappel" button
// ============================================================
router.post('/:id/send-reminder', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { channel } = req.body; // 'sms' | 'email' | 'both'
    if (!channel || !['sms', 'email', 'both'].includes(channel)) {
      return res.status(400).json({ error: 'channel requis: sms, email ou both' });
    }

    const bk = await queryWithRLS(bid,
      `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.slug, biz.theme, biz.address, biz.email AS business_email
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const b = bk.rows[0];

    if (['cancelled', 'no_show'].includes(b.status)) {
      return res.status(400).json({ error: 'Impossible de notifier un RDV annulé' });
    }

    const dateStr = new Date(b.start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
    const timeStr = new Date(b.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
    const baseUrl = process.env.BASE_URL || 'https://genda.be';
    const manageUrl = `${baseUrl}/booking/${b.public_token}`;
    const result = {};

    if ((channel === 'sms' || channel === 'both') && b.client_phone) {
      const smsBody = `Rappel ${b.business_name}: RDV le ${dateStr} à ${timeStr} avec ${b.practitioner_name}. Détails : ${manageUrl}`;
      const smsRes = await sendSMS({ to: b.client_phone, body: smsBody, businessId: bid });
      result.sms = smsRes.success ? 'sent' : 'error';
      if (smsRes.error) result.sms_error = smsRes.error;
    }

    if ((channel === 'email' || channel === 'both') && b.client_email) {
      try {
        const { buildEmailHTML, sendEmail } = require('../../services/email');
        const html = buildEmailHTML({
          businessName: b.business_name, theme: b.theme || {},
          heading: 'Rappel de votre rendez-vous',
          body: `<p>Bonjour ${b.client_name},</p><p>Ceci est un rappel pour votre rendez-vous :</p><p><strong>${b.service_name}</strong><br>${dateStr} à ${timeStr}<br>avec ${b.practitioner_name}</p>`,
          ctaText: 'Voir mon rendez-vous', ctaUrl: manageUrl,
          cancelText: 'Gérer mon rendez-vous', cancelUrl: manageUrl
        });
        await sendEmail({ to: b.client_email, subject: `Rappel : votre RDV du ${dateStr} à ${timeStr} — ${b.business_name}`, html });
        result.email = 'sent';
      } catch (e) {
        console.warn('[REMINDER] Email error:', e.message);
        result.email = 'error';
      }
    }

    // Log notification
    await queryWithRLS(bid,
      `INSERT INTO notifications (business_id, booking_id, type, recipient_phone, recipient_email, status, sent_at)
       VALUES ($1, $2, 'manual_reminder', $3, $4, 'sent', NOW())`,
      [bid, id, b.client_phone || null, b.client_email || null]
    );

    res.json({ sent: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
