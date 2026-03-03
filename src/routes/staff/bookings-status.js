/**
 * Booking Status — status changes, deposit refund, permanent delete.
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { calSyncPush, calSyncDelete } = require('./bookings-helpers');

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

    const validStatuses = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled', 'modified_pending', 'pending_deposit'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Statut invalide. Valeurs : ${validStatuses.join(', ')}` });
    }

    // ===== All DB mutations inside a single transaction =====
    const txResult = await transactionWithRLS(bid, async (client) => {
      // Lock the booking row to prevent concurrent modifications
      const old = await client.query(
        `SELECT status, client_id, deposit_required, deposit_status, deposit_amount_cents FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (old.rows.length === 0) return { error: 404, message: 'RDV introuvable' };

      // ===== STATE MACHINE: validate transition =====
      const TRANSITIONS = {
        pending:          ['confirmed', 'cancelled', 'no_show'],
        confirmed:        ['completed', 'cancelled', 'no_show', 'modified_pending', 'pending_deposit'],
        modified_pending: ['confirmed', 'cancelled'],
        pending_deposit:  ['confirmed', 'cancelled'],
        completed:        ['confirmed'],  // ré-ouvrir si erreur
        no_show:          ['confirmed', 'cancelled'],
        cancelled:        []  // un RDV annulé ne peut pas être ressuscité
      };
      const allowed = TRANSITIONS[old.rows[0].status] || [];
      if (!allowed.includes(status)) {
        return { error: 400, message: `Transition ${old.rows[0].status} → ${status} non autorisée` };
      }

      // Update booking status
      if (status === 'cancelled') {
        await client.query(
          `UPDATE bookings SET status = $1, cancel_reason = $2, updated_at = NOW()
           WHERE id = $3 AND business_id = $4`,
          [status, cancel_reason || null, id, bid]
        );
      } else {
        await client.query(
          `UPDATE bookings SET status = $1, updated_at = NOW()
           WHERE id = $2 AND business_id = $3`,
          [status, id, bid]
        );
      }

      // ===== DEPOSIT: mark as paid when pending_deposit → confirmed =====
      if (old.rows[0].status === 'pending_deposit' && status === 'confirmed') {
        await client.query(
          `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW()
           WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
      }

      // ===== NO-SHOW STRIKE SYSTEM (guard: only increment if not already no_show) =====
      if (status === 'no_show' && old.rows[0].status !== 'no_show') {
        const bkInfo = await client.query(
          `SELECT b.client_id, biz.settings
           FROM bookings b
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        if (bkInfo.rows.length > 0 && bkInfo.rows[0].client_id) {
          const clientId = bkInfo.rows[0].client_id;
          const settings = bkInfo.rows[0].settings || {};
          const threshold = settings.noshow_block_threshold ?? 3;
          const blockAction = settings.noshow_block_action || 'block';

          const updated = await client.query(
            `UPDATE clients SET
              no_show_count = no_show_count + 1,
              last_no_show_at = NOW(),
              updated_at = NOW()
             WHERE id = $1 AND business_id = $2
             RETURNING no_show_count`,
            [clientId, bid]
          );

          const count = updated.rows[0]?.no_show_count || 0;
          if (threshold > 0 && count >= threshold && blockAction === 'block') {
            await client.query(
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
      }

      // ===== UNDO: if reverting from no_show, decrement + potentially unblock =====
      if (old.rows[0].status === 'no_show' && status !== 'no_show') {
        const clientId = old.rows[0].client_id;
        if (clientId) {
          const updated = await client.query(
            `UPDATE clients SET
              no_show_count = GREATEST(no_show_count - 1, 0),
              updated_at = NOW()
             WHERE id = $1 AND business_id = $2
             RETURNING no_show_count, is_blocked, blocked_reason`,
            [clientId, bid]
          );
          const cl = updated.rows[0];
          if (cl && cl.is_blocked && cl.blocked_reason?.startsWith('Bloqué automatiquement')) {
            const bizSettings = await client.query(
              `SELECT settings FROM businesses WHERE id = $1`, [bid]
            );
            const threshold = bizSettings.rows[0]?.settings?.noshow_block_threshold ?? 3;
            if (cl.no_show_count < threshold) {
              await client.query(
                `UPDATE clients SET is_blocked = false, blocked_reason = NULL, blocked_at = NULL, updated_at = NOW()
                 WHERE id = $1 AND business_id = $2`,
                [clientId, bid]
              );
            }
          }
        }
      }

      // ===== DEPOSIT: refund logic on cancellation =====
      if (status === 'cancelled') {
        const depInfo = await client.query(
          `SELECT b.deposit_required, b.deposit_status, b.start_at, b.created_at, biz.settings
           FROM bookings b JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        const dep = depInfo.rows[0];
        if (dep?.deposit_required) {
          const cancelDeadlineH = dep.settings?.cancel_deadline_hours || 48;
          const graceMin = dep.settings?.cancel_grace_minutes || 240;
          let newDepStatus;
          if (dep.deposit_status === 'paid') {
            const hoursUntilRdv = (new Date(dep.start_at) - new Date()) / 3600000;
            const minSinceCreated = (new Date() - new Date(dep.created_at)) / 60000;
            if (minSinceCreated <= graceMin) {
              newDepStatus = 'refunded';
            } else if (hoursUntilRdv >= cancelDeadlineH) {
              newDepStatus = 'refunded';
            } else {
              newDepStatus = 'cancelled';
            }
          } else if (dep.deposit_status === 'pending') {
            newDepStatus = 'cancelled';
          }
          if (newDepStatus) {
            await client.query(
              `UPDATE bookings SET deposit_status = $1 WHERE id = $2 AND business_id = $3`,
              [newDepStatus, id, bid]
            );
          }
        }
      }

      // Audit log (inside transaction for consistency, enriched with deposit state)
      const oldAudit = { status: old.rows[0].status };
      const newAudit = { status, cancel_reason };
      if (old.rows[0].deposit_required) {
        oldAudit.deposit_status = old.rows[0].deposit_status;
        oldAudit.deposit_amount_cents = old.rows[0].deposit_amount_cents;
      }
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'status_change', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify(oldAudit),
         JSON.stringify(newAudit)]
      );

      return { oldStatus: old.rows[0].status };
    });

    // Handle early returns from transaction
    if (txResult.error) {
      return res.status(txResult.error).json({ error: txResult.message });
    }

    // ===== Post-transaction side effects (non-blocking) =====

    // Waitlist trigger on cancel
    if (status === 'cancelled') {
      try {
        const { processWaitlistForCancellation } = require('../../services/waitlist');
        await processWaitlistForCancellation(id);
      } catch (e) { console.warn('[WAITLIST] Processing error:', e.message); }
    }

    broadcast(bid, 'booking_update', { action: 'status_changed', booking_id: id, status, old_status: txResult.oldStatus });
    if (status === 'cancelled') calSyncDelete(bid, id).catch(e => console.warn('[CAL_SYNC] Delete error:', e.message));
    else calSyncPush(bid, id).catch(e => console.warn('[CAL_SYNC] Push error:', e.message));
    res.json({ updated: true, status });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/deposit-refund — Manual refund by pro
// UI: Booking detail → "Rembourser l'acompte" button
// ============================================================
router.patch('/:id/deposit-refund', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    // All deposit-refund operations in a single transaction for atomicity
    const txResult = await transactionWithRLS(bid, async (client) => {
      const bk = await client.query(
        `SELECT deposit_required, deposit_status, deposit_amount_cents, status FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (bk.rows.length === 0) return { error: 404, message: 'RDV introuvable' };
      if (!bk.rows[0].deposit_required) return { error: 400, message: 'Pas d\'acompte sur ce RDV' };
      if (bk.rows[0].deposit_status === 'refunded') return { error: 400, message: 'Acompte déjà remboursé' };

      const REFUNDABLE = ['pending', 'confirmed', 'modified_pending', 'pending_deposit'];
      if (!REFUNDABLE.includes(bk.rows[0].status)) {
        return { error: 400, message: `Impossible de rembourser un RDV en statut "${bk.rows[0].status}"` };
      }

      await client.query(
        `UPDATE bookings SET deposit_status = 'refunded', status = 'cancelled', cancel_reason = 'Acompte remboursé manuellement', updated_at = NOW()
         WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );

      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, new_data)
         VALUES ($1, $2, 'booking', $3, 'deposit_refund', $4)`,
        [bid, req.user.id, id, JSON.stringify({ deposit_status: 'refunded', amount_cents: bk.rows[0].deposit_amount_cents })]
      );

      return { ok: true };
    });

    if (txResult.error) {
      return res.status(txResult.error).json({ error: txResult.message });
    }

    broadcast(bid, 'booking_update', { action: 'deposit_refunded', booking_id: id });
    calSyncDelete(bid, id).catch(e => console.warn('[CAL_SYNC] Delete error:', e.message));

    // Process waitlist (same as cancellation)
    try {
      const { processWaitlistForCancellation } = require('../../services/waitlist');
      await processWaitlistForCancellation(id);
    } catch (e) { console.warn('[WAITLIST] Processing error:', e.message); }

    res.json({ updated: true, deposit_status: 'refunded' });
  } catch (err) { next(err); }
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
      `SELECT status, group_id, client_id FROM bookings WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    if (!['cancelled', 'no_show'].includes(check.rows[0].status)) {
      return res.status(400).json({ error: 'Seuls les RDV annulés ou no-show peuvent être supprimés' });
    }

    // All deletion operations in a single transaction for atomicity
    const deletedIds = await transactionWithRLS(bid, async (client) => {
      let bookingIds = [id];
      if (check.rows[0].group_id) {
        const siblings = await client.query(
          `SELECT id, status, client_id FROM bookings
           WHERE group_id = $1 AND business_id = $2 AND status IN ('cancelled', 'no_show')`,
          [check.rows[0].group_id, bid]
        );
        bookingIds = siblings.rows.map(r => r.id);

        for (const sib of siblings.rows) {
          if (sib.status === 'no_show' && sib.client_id) {
            await client.query(
              `UPDATE clients SET no_show_count = GREATEST(0, no_show_count - 1) WHERE id = $1 AND business_id = $2`,
              [sib.client_id, bid]
            );
          }
        }
      } else {
        if (check.rows[0].status === 'no_show' && check.rows[0].client_id) {
          await client.query(
            `UPDATE clients SET no_show_count = GREATEST(0, no_show_count - 1) WHERE id = $1 AND business_id = $2`,
            [check.rows[0].client_id, bid]
          );
        }
      }

      await client.query(`DELETE FROM booking_notes WHERE booking_id = ANY($1) AND business_id = $2`, [bookingIds, bid]);
      await client.query(`DELETE FROM practitioner_todos WHERE booking_id = ANY($1) AND business_id = $2`, [bookingIds, bid]);
      await client.query(`DELETE FROM booking_reminders WHERE booking_id = ANY($1) AND business_id = $2`, [bookingIds, bid]);
      await client.query(`DELETE FROM bookings WHERE id = ANY($1) AND business_id = $2`, [bookingIds, bid]);

      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data)
         VALUES ($1, $2, 'booking', $3, 'permanent_delete', $4)`,
        [bid, req.user.id, id, JSON.stringify({ status: check.rows[0].status, group_id: check.rows[0].group_id, deleted_count: bookingIds.length })]
      );

      return bookingIds;
    });

    // Post-transaction side effects
    deletedIds.forEach(bId => calSyncDelete(bid, bId).catch(e => console.warn('[CAL_SYNC] Delete error:', e.message)));
    broadcast(bid, 'booking_update', { action: 'deleted', booking_id: id });
    res.json({ deleted: true, deleted_count: deletedIds.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
