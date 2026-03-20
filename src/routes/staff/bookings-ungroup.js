/**
 * Booking Ungroup — PATCH /:id/ungroup + DELETE /:id/group-remove
 * Detaches a booking from its group, optionally reassigning practitioner
 * and/or replacing service. Also allows removing a member entirely.
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { calSyncPush, calSyncDelete, businessAllowsOverlap, getMaxConcurrent, checkBookingConflicts } = require('./bookings-helpers');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// PATCH /api/bookings/:id/ungroup — Detach a booking from its group
// Optionally reassign practitioner and/or replace service.
// UI: Calendar → detail modal → Group section → ✂️ button
// ============================================================
router.patch('/:id/ungroup', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { practitioner_id, service_id } = req.body;

    // Only owner/manager/staff can ungroup — not practitioners
    if (req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Seuls les gestionnaires peuvent détacher une prestation du groupe' });
    }

    // 1. Fetch the booking
    const bkRes = await queryWithRLS(bid,
      `SELECT b.id, b.group_id, b.group_order, b.status, b.start_at, b.end_at,
              b.practitioner_id, b.service_id
       FROM bookings b
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (bkRes.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const booking = bkRes.rows[0];

    // 2. Must be part of a group
    if (!booking.group_id) {
      return res.status(400).json({ error: 'Ce RDV ne fait pas partie d\'un groupe' });
    }

    // 3. Block if frozen status
    const FROZEN = ['cancelled', 'no_show'];
    if (FROZEN.includes(booking.status)) {
      return res.status(400).json({ error: 'Impossible de détacher un RDV annulé ou no-show' });
    }

    // 4. Validate practitioner_id if provided
    let newPracId = booking.practitioner_id;
    if (practitioner_id) {
      if (!UUID_RE.test(practitioner_id)) return res.status(400).json({ error: 'practitioner_id invalide' });
      const pracCheck = await queryWithRLS(bid,
        `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [practitioner_id, bid]
      );
      if (pracCheck.rows.length === 0) return res.status(400).json({ error: 'Praticien introuvable ou inactif' });
      newPracId = practitioner_id;
    }

    // 5. Validate service_id if provided + compute new end_at
    let newServiceId = booking.service_id;
    let newEndAt = booking.end_at;
    if (service_id) {
      if (!UUID_RE.test(service_id)) return res.status(400).json({ error: 'service_id invalide' });
      const svcCheck = await queryWithRLS(bid,
        `SELECT id, duration_min, buffer_before_min, buffer_after_min
         FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [service_id, bid]
      );
      if (svcCheck.rows.length === 0) return res.status(400).json({ error: 'Prestation introuvable ou inactive' });

      // Validate practitioner is assigned to this service
      const psCheck = await queryWithRLS(bid,
        `SELECT 1 FROM practitioner_services
         WHERE practitioner_id = $1 AND service_id = $2`,
        [newPracId, service_id]
      );
      if (psCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Ce praticien ne propose pas cette prestation' });
      }

      // Recalculate end_at from start_at + service duration (detached = standalone, so include buffers)
      const svc = svcCheck.rows[0];
      const totalMin = (svc.buffer_before_min || 0) + svc.duration_min + (svc.buffer_after_min || 0);
      newEndAt = new Date(new Date(booking.start_at).getTime() + totalMin * 60000).toISOString();
      newServiceId = service_id;
    }

    // Also validate practitioner assignment for existing service when only practitioner changes
    if (practitioner_id && !service_id && booking.service_id) {
      const psCheck = await queryWithRLS(bid,
        `SELECT 1 FROM practitioner_services
         WHERE practitioner_id = $1 AND service_id = $2`,
        [newPracId, booking.service_id]
      );
      if (psCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Ce praticien ne propose pas cette prestation' });
      }
    }

    // 6. Transaction: ungroup + conflict check + resequence
    const globalAllowOverlap = await businessAllowsOverlap(bid);

    let result;
    try {
      result = await transactionWithRLS(bid, async (client) => {
        // Lock the booking FOR UPDATE
        const lock = await client.query(
          `SELECT id, group_id, status, start_at, end_at, practitioner_id, service_id,
                  deposit_payment_intent_id, deposit_status, deposit_amount_cents
           FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        if (lock.rows.length === 0) throw Object.assign(new Error('RDV introuvable'), { type: 'not_found' });
        const locked = lock.rows[0];

        // If booking has pending deposit, inherit deposit_payment_intent_id from group leader
        if (locked.deposit_status === 'pending' && !locked.deposit_payment_intent_id && locked.group_id) {
          const leader = await client.query(
            `SELECT deposit_payment_intent_id, deposit_payment_url FROM bookings
             WHERE group_id = $1 AND business_id = $2 AND deposit_payment_intent_id IS NOT NULL LIMIT 1`,
            [locked.group_id, bid]
          );
          if (leader.rows.length > 0) {
            locked._inheritPiId = leader.rows[0].deposit_payment_intent_id;
            locked._inheritPayUrl = leader.rows[0].deposit_payment_url;
          }
        }

        // Re-check group_id + status (concurrency guard)
        if (!locked.group_id) throw Object.assign(new Error('Ce RDV ne fait plus partie d\'un groupe'), { type: 'bad_request' });
        if (FROZEN.includes(locked.status)) throw Object.assign(new Error('RDV gelé'), { type: 'bad_request' });

        // Conflict check if practitioner or duration changed
        const pracChanged = String(newPracId) !== String(locked.practitioner_id);
        const timeChanged = newEndAt !== locked.end_at;
        if ((pracChanged || timeChanged) && !globalAllowOverlap) {
          const maxConc = await getMaxConcurrent(bid, newPracId);
          const conflicts = await checkBookingConflicts(client, { bid, pracId: newPracId, newStart: locked.start_at, newEnd: newEndAt, excludeIds: id });
          if (conflicts.length >= maxConc) {
            throw Object.assign(new Error('Conflit : capacité maximale atteinte sur ce créneau pour ce praticien'), { type: 'conflict' });
          }
        }

        // Build UPDATE for the detached booking
        const sets = ['group_id = NULL', 'group_order = NULL', 'updated_at = NOW()'];
        const params = [];
        let idx = 1;

        if (pracChanged) {
          sets.push(`practitioner_id = $${idx}`);
          params.push(newPracId);
          idx++;
        }
        if (service_id) {
          sets.push(`service_id = $${idx}`);
          params.push(newServiceId);
          idx++;
        }
        if (timeChanged) {
          sets.push(`end_at = $${idx}`);
          params.push(newEndAt);
          idx++;
        }
        // Inherit deposit payment info so webhook can find this booking after ungroup
        if (locked._inheritPiId) {
          sets.push(`deposit_payment_intent_id = $${idx}`);
          params.push(locked._inheritPiId);
          idx++;
        }
        if (locked._inheritPayUrl) {
          sets.push(`deposit_payment_url = $${idx}`);
          params.push(locked._inheritPayUrl);
          idx++;
        }

        params.push(id, bid);
        const updateSql = `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`;
        const updated = await client.query(updateSql, params);

        // Count remaining members in the group
        const remainRes = await client.query(
          `SELECT id, group_order FROM bookings
           WHERE group_id = $1 AND business_id = $2 AND id != $3
           ORDER BY group_order`,
          [locked.group_id, bid, id]
        );
        const remaining = remainRes.rows;

        if (remaining.length === 1) {
          // Only 1 member left → also ungroup it (no group of 1)
          await client.query(
            `UPDATE bookings SET group_id = NULL, group_order = NULL, updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [remaining[0].id, bid]
          );
        } else if (remaining.length > 1) {
          // Re-sequence group_order (0, 1, 2...)
          for (let i = 0; i < remaining.length; i++) {
            if (remaining[i].group_order !== i) {
              await client.query(
                `UPDATE bookings SET group_order = $1, updated_at = NOW()
                 WHERE id = $2 AND business_id = $3`,
                [i, remaining[i].id, bid]
              );
            }
          }
        }

        // Audit log
        const oldData = {
          group_id: locked.group_id,
          group_order: locked.group_order,
          practitioner_id: locked.practitioner_id,
          service_id: locked.service_id,
          end_at: locked.end_at
        };
        const newData = {
          practitioner_id: newPracId,
          service_id: newServiceId,
          end_at: newEndAt,
          remaining_group_size: remaining.length
        };
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'ungroup', $4, $5)`,
          [bid, req.user.id, id, JSON.stringify(oldData), JSON.stringify(newData)]
        );

        return { booking: updated.rows[0], remaining_group_size: remaining.length };
      });
    } catch (err) {
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
      if (err.type === 'bad_request' || err.type === 'not_found') return res.status(err.type === 'not_found' ? 404 : 400).json({ error: err.message });
      throw err;
    }

    // 7. Post-transaction: broadcast + calendar sync
    broadcast(bid, 'booking_update', { action: 'ungrouped' });
    calSyncPush(bid, id).catch(() => {});

    // 8. Response
    res.json({
      updated: true,
      booking: result.booking,
      remaining_group_size: result.remaining_group_size
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DELETE /api/bookings/:id/group-remove — Remove a member from its group
// Permanently deletes the booking. Remaining group is re-sequenced.
// If only 1 member left, it is also ungrouped.
// UI: Calendar → detail modal → Group section → 🗑 button
// ============================================================
router.delete('/:id/group-remove', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // Only owner/manager/staff can remove — not practitioners
    if (req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Seuls les gestionnaires peuvent supprimer une prestation du groupe' });
    }

    // 1. Fetch the booking
    const bkRes = await queryWithRLS(bid,
      `SELECT b.id, b.group_id, b.group_order, b.status, b.start_at, b.end_at,
              b.practitioner_id, b.service_id
       FROM bookings b
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (bkRes.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const booking = bkRes.rows[0];

    // 2. Must be part of a group
    if (!booking.group_id) {
      return res.status(400).json({ error: 'Ce RDV ne fait pas partie d\'un groupe' });
    }

    // 3. Transaction: delete + resequence remaining group
    let result;
    try {
      result = await transactionWithRLS(bid, async (client) => {
        // Lock the booking FOR UPDATE
        const lock = await client.query(
          `SELECT id, group_id, group_order, status, service_id, practitioner_id, start_at, end_at
           FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        if (lock.rows.length === 0) throw Object.assign(new Error('RDV introuvable'), { type: 'not_found' });
        const locked = lock.rows[0];

        // Re-check group_id (concurrency guard)
        if (!locked.group_id) throw Object.assign(new Error('Ce RDV ne fait plus partie d\'un groupe'), { type: 'bad_request' });

        const groupId = locked.group_id;

        // Delete related records first (foreign key dependencies)
        await client.query(`DELETE FROM booking_notes WHERE booking_id = $1 AND business_id = $2`, [id, bid]);
        await client.query(`DELETE FROM practitioner_todos WHERE booking_id = $1 AND business_id = $2`, [id, bid]);
        await client.query(`DELETE FROM booking_reminders WHERE booking_id = $1 AND business_id = $2`, [id, bid]);
        await client.query(`DELETE FROM pre_rdv_sends WHERE booking_id = $1 AND business_id = $2`, [id, bid]);

        // Delete the booking itself
        await client.query(
          `DELETE FROM bookings WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );

        // Count remaining members in the group
        const remainRes = await client.query(
          `SELECT id, group_order FROM bookings
           WHERE group_id = $1 AND business_id = $2
           ORDER BY group_order`,
          [groupId, bid]
        );
        const remaining = remainRes.rows;

        if (remaining.length === 1) {
          // Only 1 member left → ungroup it (no group of 1)
          await client.query(
            `UPDATE bookings SET group_id = NULL, group_order = NULL, updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [remaining[0].id, bid]
          );
        } else if (remaining.length > 1) {
          // Re-sequence group_order (0, 1, 2...)
          for (let i = 0; i < remaining.length; i++) {
            if (remaining[i].group_order !== i) {
              await client.query(
                `UPDATE bookings SET group_order = $1, updated_at = NOW()
                 WHERE id = $2 AND business_id = $3`,
                [i, remaining[i].id, bid]
              );
            }
          }
        }

        // Audit log
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'group_remove', $4, $5)`,
          [bid, req.user.id, id,
           JSON.stringify({
             group_id: groupId,
             group_order: locked.group_order,
             service_id: locked.service_id,
             practitioner_id: locked.practitioner_id,
             start_at: locked.start_at,
             end_at: locked.end_at
           }),
           JSON.stringify({ remaining_group_size: remaining.length })]
        );

        return { remaining_group_size: remaining.length };
      });
    } catch (err) {
      if (err.type === 'bad_request' || err.type === 'not_found') return res.status(err.type === 'not_found' ? 404 : 400).json({ error: err.message });
      throw err;
    }

    // Post-transaction: broadcast + calendar sync delete
    broadcast(bid, 'booking_update', { action: 'group_member_removed' });
    calSyncDelete(bid, id).catch(() => {});

    res.json({
      deleted: true,
      remaining_group_size: result.remaining_group_size
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bookings/:id/group-add — Add a service to an existing group
// Creates a new booking chained after the last group member.
// UI: Calendar → detail modal → Group section → ➕ button
// ============================================================
router.post('/:id/group-add', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { service_id, variant_id, force } = req.body;

    // Only owner/manager/staff can add to group — not practitioners
    if (req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Seuls les gestionnaires peuvent ajouter une prestation au groupe' });
    }

    if (!service_id) return res.status(400).json({ error: 'service_id requis' });
    if (!UUID_RE.test(service_id)) return res.status(400).json({ error: 'service_id invalide' });
    if (variant_id && !UUID_RE.test(variant_id)) return res.status(400).json({ error: 'variant_id invalide' });

    // 1. Fetch the reference booking
    const bkRes = await queryWithRLS(bid,
      `SELECT b.id, b.group_id, b.practitioner_id, b.client_id, b.status,
              b.appointment_mode
       FROM bookings b
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (bkRes.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const booking = bkRes.rows[0];

    const FROZEN = ['cancelled', 'no_show'];
    if (FROZEN.includes(booking.status)) {
      return res.status(400).json({ error: 'Impossible d\'ajouter à un groupe annulé ou no-show' });
    }

    // If single booking (no group_id), convert to group first
    let groupId = booking.group_id;
    if (!groupId) {
      groupId = require('crypto').randomUUID();
      await queryWithRLS(bid,
        `UPDATE bookings SET group_id = $1, group_order = 0, updated_at = NOW()
         WHERE id = $2 AND business_id = $3`,
        [groupId, id, bid]
      );
      booking.group_id = groupId;
    }

    // 2. Fetch service info + duration
    const svcRes = await queryWithRLS(bid,
      `SELECT id, name, duration_min, buffer_before_min, buffer_after_min, is_active
       FROM services WHERE id = $1 AND business_id = $2`,
      [service_id, bid]
    );
    if (svcRes.rows.length === 0 || !svcRes.rows[0].is_active) {
      return res.status(400).json({ error: 'Prestation introuvable ou inactive' });
    }
    const svc = svcRes.rows[0];

    // 3. Validate variant if provided
    let variantDuration = null;
    let variantPrice = null;
    if (variant_id) {
      const vRes = await queryWithRLS(bid,
        `SELECT id, duration_min, price_cents FROM service_variants
         WHERE id = $1 AND service_id = $2`,
        [variant_id, service_id]
      );
      if (vRes.rows.length === 0) return res.status(400).json({ error: 'Variante introuvable' });
      variantDuration = vRes.rows[0].duration_min;
      variantPrice = vRes.rows[0].price_cents;
    }

    // 4. Validate practitioner is assigned to this service
    const psCheck = await queryWithRLS(bid,
      `SELECT 1 FROM practitioner_services
       WHERE practitioner_id = $1 AND service_id = $2`,
      [booking.practitioner_id, service_id]
    );
    if (psCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Ce praticien ne propose pas cette prestation' });
    }

    // 5. Fetch all group members to find last end_at + max group_order
    const groupRes = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.group_order
       FROM bookings b
       WHERE b.group_id = $1 AND b.business_id = $2
       ORDER BY b.group_order`,
      [booking.group_id, bid]
    );
    const members = groupRes.rows;
    if (members.length === 0) return res.status(400).json({ error: 'Groupe vide' });

    const lastMember = members[members.length - 1];
    const newGroupOrder = (lastMember.group_order ?? members.length - 1) + 1;
    const newStart = new Date(lastMember.end_at);

    // Only apply buffer_after for the new last member (not buffer_before since it chains)
    const dur = variantDuration || svc.duration_min;
    const bufAfter = svc.buffer_after_min || 0;
    const totalMin = dur + bufAfter;
    const newEnd = new Date(newStart.getTime() + totalMin * 60000);

    // Also remove buffer_after from previous last member if it had one
    // (The previous last member's buffer_after was included in its duration;
    //  now it's no longer the last, but we don't change its time — accepted trade-off)

    // 6. Transaction: conflict check + insert
    const globalAllowOverlap = await businessAllowsOverlap(bid);

    let result;
    try {
      result = await transactionWithRLS(bid, async (client) => {
        // Lock group members
        await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 FOR UPDATE`,
          [booking.group_id, bid]
        );

        // Conflict check for the new time range (skip if force=true)
        if (!globalAllowOverlap && !force) {
          const maxConc = await getMaxConcurrent(bid, booking.practitioner_id);
          const conflicts = await checkBookingConflicts(client, { bid, pracId: booking.practitioner_id, newStart: newStart.toISOString(), newEnd: newEnd.toISOString() });
          if (conflicts.length >= maxConc) {
            throw Object.assign(new Error('Conflit : capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        // Insert the new group member
        const ins = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
            channel, appointment_mode, start_at, end_at, status, group_id, group_order)
           VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, 'confirmed', $9, $10)
           RETURNING *`,
          [bid, booking.practitioner_id, service_id, variant_id || null, booking.client_id,
           booking.appointment_mode || 'cabinet',
           newStart.toISOString(), newEnd.toISOString(),
           booking.group_id, newGroupOrder]
        );

        // Audit log
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'create', $4, $5)`,
          [bid, req.user.id, ins.rows[0].id,
           JSON.stringify({ group_id: booking.group_id, added_to_group: true }),
           JSON.stringify({ service_id, group_order: newGroupOrder })]
        );

        return ins.rows[0];
      });
    } catch (err) {
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
      throw err;
    }

    broadcast(bid, 'booking_update', { action: 'group_member_added' });
    calSyncPush(bid, result.id).catch(() => {});

    res.json({ added: true, booking: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
