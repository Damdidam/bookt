/**
 * Booking Status — status changes, deposit refund, permanent delete.
 */
const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
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

    // ===== DEPOSIT: mark as paid when pending_deposit → confirmed =====
    if (old.rows[0].status === 'pending_deposit' && status === 'confirmed') {
      try {
        await queryWithRLS(bid,
          `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW()
           WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
      } catch (e) { console.warn('[DEPOSIT] Mark paid error:', e.message); }
    }

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

    // ===== DEPOSIT: refund logic on cancellation =====
    if (status === 'cancelled') {
      try {
        const depInfo = await queryWithRLS(bid,
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
              newDepStatus = 'refunded'; // grace period
            } else if (hoursUntilRdv >= cancelDeadlineH) {
              newDepStatus = 'refunded'; // within deadline
            } else {
              newDepStatus = 'cancelled'; // too late, deposit kept
            }
          } else if (dep.deposit_status === 'pending') {
            newDepStatus = 'cancelled'; // never paid
          }
          if (newDepStatus) {
            await queryWithRLS(bid,
              `UPDATE bookings SET deposit_status = $1 WHERE id = $2 AND business_id = $3`,
              [newDepStatus, id, bid]
            );
          }
        }
      } catch (e) { console.warn('[DEPOSIT] Refund logic error:', e.message); }
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
// PATCH /api/bookings/:id/deposit-refund — Manual refund by pro
// UI: Booking detail → "Rembourser l'acompte" button
// ============================================================
router.patch('/:id/deposit-refund', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const bk = await queryWithRLS(bid,
      `SELECT deposit_required, deposit_status, deposit_amount_cents FROM bookings WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    if (!bk.rows[0].deposit_required) return res.status(400).json({ error: 'Pas d\'acompte sur ce RDV' });
    if (bk.rows[0].deposit_status === 'refunded') return res.status(400).json({ error: 'Acompte déjà remboursé' });

    await queryWithRLS(bid,
      `UPDATE bookings SET deposit_status = 'refunded', status = 'cancelled', cancel_reason = 'Acompte remboursé manuellement', updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [id, bid]
    );

    await queryWithRLS(bid,
      `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, new_data)
       VALUES ($1, $2, 'booking', $3, 'deposit_refund', $4)`,
      [bid, req.user.id, id, JSON.stringify({ deposit_status: 'refunded', amount_cents: bk.rows[0].deposit_amount_cents })]
    );

    broadcast(bid, 'booking_update', { action: 'deposit_refunded' });
    calSyncDelete(bid, id).catch(() => {});
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

    // If deleting a no-show booking, decrement the client's no_show_count
    if (check.rows[0].status === 'no_show' && check.rows[0].client_id) {
      await queryWithRLS(bid,
        `UPDATE clients SET no_show_count = GREATEST(0, no_show_count - 1) WHERE id = $1 AND business_id = $2`,
        [check.rows[0].client_id, bid]
      );
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

module.exports = router;
