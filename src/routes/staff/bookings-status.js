/**
 * Booking Status — status changes, deposit refund, permanent delete.
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { calSyncPush, calSyncDelete } = require('./bookings-helpers');

// ===== STATE MACHINE: valid transitions (module-level for reuse) =====
const TRANSITIONS = {
  pending:          ['confirmed', 'cancelled', 'no_show'],
  confirmed:        ['completed', 'cancelled', 'no_show', 'modified_pending', 'pending_deposit'],
  modified_pending: ['confirmed', 'cancelled'],
  pending_deposit:  ['confirmed', 'cancelled'],
  completed:        ['confirmed'],  // ré-ouvrir si erreur
  no_show:          ['confirmed', 'cancelled'],
  cancelled:        ['confirmed']  // rétablir un RDV annulé
};

// ===== Helper: propagate status to group siblings respecting state machine =====
// Returns array of affected booking IDs (Bug M6: used to avoid double-counting in applySiblingNoShowStrikes)
async function propagateGroupStatus(client, { groupId, bid, excludeId, status, cancelReason }) {
  // Bug H4 fix: Build list of valid source statuses that can transition to the target
  const validSources = Object.entries(TRANSITIONS)
    .filter(([_, targets]) => targets.includes(status))
    .map(([src]) => src);

  if (validSources.length === 0) return [];

  // Bug M5 fix: Lock all siblings FOR UPDATE before modifying to prevent concurrent changes
  await client.query(
    `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3 FOR UPDATE`,
    [groupId, bid, excludeId]
  );

  let result;
  if (status === 'cancelled') {
    result = await client.query(
      `UPDATE bookings SET status = $1, cancel_reason = $2, updated_at = NOW()
       WHERE group_id = $3 AND business_id = $4 AND id != $5 AND status = ANY($6)
       RETURNING id`,
      [status, cancelReason || null, groupId, bid, excludeId, validSources]
    );
  } else {
    result = await client.query(
      `UPDATE bookings SET status = $1, updated_at = NOW()
       WHERE group_id = $2 AND business_id = $3 AND id != $4 AND status = ANY($5)
       RETURNING id`,
      [status, groupId, bid, excludeId, validSources]
    );
  }
  return result.rows.map(r => r.id);
}

// ===== Helper: apply no-show strikes to sibling clients =====
// Bug M6 fix: Accept affectedIds to only target siblings that were JUST transitioned,
// avoiding double-counting pre-existing no_show bookings
async function applySiblingNoShowStrikes(client, { affectedIds, bid, excludeClientId }) {
  if (!affectedIds || affectedIds.length === 0) return;

  const siblings = await client.query(
    `SELECT DISTINCT b.client_id, biz.settings
     FROM bookings b
     JOIN businesses biz ON biz.id = b.business_id
     WHERE b.id = ANY($1) AND b.business_id = $2
       AND b.status = 'no_show' AND b.client_id IS NOT NULL
       AND b.client_id != $3`,
    [affectedIds, bid, excludeClientId]
  );

  for (const sib of siblings.rows) {
    const settings = sib.settings || {};
    const threshold = settings.noshow_block_threshold ?? 3;
    const blockAction = settings.noshow_block_action || 'block';

    const updated = await client.query(
      `UPDATE clients SET
        no_show_count = no_show_count + 1,
        last_no_show_at = NOW(),
        updated_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING no_show_count`,
      [sib.client_id, bid]
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
        [`Bloqué automatiquement : ${count} no-show(s)`, sib.client_id, bid]
      );
    }
  }
}

// ============================================================
// PATCH /api/bookings/:id/status
// Update booking status (confirm / complete / no_show / cancel)
// UI: Agenda → action buttons ( Terminé,  No-show, Annuler)
// ============================================================
router.patch('/:id/status', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    let { status, cancel_reason } = req.body;

    const validStatuses = ['pending', 'confirmed', 'completed', 'no_show', 'cancelled', 'modified_pending', 'pending_deposit'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Statut invalide. Valeurs : ${validStatuses.join(', ')}` });
    }
    if (cancel_reason && cancel_reason.length > 1000) {
      return res.status(400).json({ error: 'Raison d\'annulation trop longue (max 1000 caractères)' });
    }
    if (cancel_reason) cancel_reason = cancel_reason.replace(/<[^>]*>/g, '').trim();

    // ===== All DB mutations inside a single transaction =====
    const txResult = await transactionWithRLS(bid, async (client) => {
      // Lock the booking row to prevent concurrent modifications
      const old = await client.query(
        `SELECT status, client_id, deposit_required, deposit_status, deposit_amount_cents, group_id, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (old.rows.length === 0) return { error: 404, message: 'RDV introuvable' };

      // Practitioner scope: can only modify own bookings
      if (req.practitionerFilter && String(old.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
        return { error: 403, message: 'Accès interdit' };
      }

      // ===== STATE MACHINE: validate transition =====
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

      // STS-1 fix: Capture sibling client IDs in no_show BEFORE propagation changes their status
      let siblingClientsToUndo = [];
      if (old.rows[0].status === 'no_show' && status === 'confirmed' && old.rows[0].group_id) {
        const sibsQ = await client.query(
          `SELECT DISTINCT client_id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'no_show' AND client_id IS NOT NULL AND client_id != $4`,
          [old.rows[0].group_id, bid, id, old.rows[0].client_id || '00000000-0000-0000-0000-000000000000']
        );
        siblingClientsToUndo = sibsQ.rows.map(r => r.client_id);
      }

      // ===== Bug M9 fix + Bug H4 fix: Propagate status to group siblings respecting state machine =====
      let affectedSiblingIds = [];
      if (old.rows[0].group_id) {
        affectedSiblingIds = await propagateGroupStatus(client, {
          groupId: old.rows[0].group_id,
          bid,
          excludeId: id,
          status,
          cancelReason: cancel_reason
        });
      }

      // ===== DEPOSIT: mark as paid when pending_deposit → confirmed =====
      // BK-V13-006: Also clear deposit_deadline since the deposit is now fulfilled
      if (old.rows[0].status === 'pending_deposit' && status === 'confirmed') {
        await client.query(
          `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(), deposit_deadline = NULL
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

        // Bug H5 fix: Apply no-show strikes to sibling clients too
        // Bug M6 fix: Only target siblings that were just transitioned (affectedSiblingIds)
        // STS-V10-7 fix: Apply sibling strikes even if main booking has no client_id
        if (old.rows[0].group_id && affectedSiblingIds.length > 0) {
          await applySiblingNoShowStrikes(client, {
            affectedIds: affectedSiblingIds,
            bid,
            excludeClientId: bkInfo.rows[0]?.client_id || '00000000-0000-0000-0000-000000000000'
          });
        }
      }

      // ===== UNDO: if reverting from no_show to confirmed, decrement + potentially unblock =====
      // STS-13 fix: Only decrement strikes when reverting to confirmed, not when cancelling
      if (old.rows[0].status === 'no_show' && status === 'confirmed') {
        // Helper to decrement strike and maybe unblock a client
        async function decrementStrikeAndMaybeUnblock(cid) {
          const updated = await client.query(
            `UPDATE clients SET
              no_show_count = GREATEST(no_show_count - 1, 0),
              updated_at = NOW()
             WHERE id = $1 AND business_id = $2
             RETURNING no_show_count, is_blocked, blocked_reason`,
            [cid, bid]
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
                [cid, bid]
              );
            }
          }
        }

        const clientId = old.rows[0].client_id;
        if (clientId) {
          await decrementStrikeAndMaybeUnblock(clientId);
        }

        // Bug H5 fix + STS-1 fix: Decrement strikes for sibling clients captured BEFORE propagation
        if (siblingClientsToUndo.length > 0) {
          for (const sibClientId of siblingClientsToUndo) {
            await decrementStrikeAndMaybeUnblock(sibClientId);
          }
        }
      }

      // ===== UNDO: if reverting from cancelled (expired pending) to confirmed, decrement expired counter =====
      if (old.rows[0].status === 'cancelled' && status === 'confirmed') {
        // Check audit log to see if this was an expired pending
        const auditCheck = await client.query(
          `SELECT 1 FROM audit_logs
           WHERE entity_type = 'booking' AND entity_id = $1 AND action = 'confirmation_expired'
             AND business_id = $2
           LIMIT 1`,
          [id, bid]
        );
        if (auditCheck.rows.length > 0 && old.rows[0].client_id) {
          await client.query(
            `UPDATE clients SET expired_pending_count = GREATEST(expired_pending_count - 1, 0), updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [old.rows[0].client_id, bid]
          );
        }
      }

      // ===== DEPOSIT: refund logic on cancellation =====
      let depositRefunded = false;
      if (status === 'cancelled') {
        const depInfo = await client.query(
          `SELECT b.deposit_required, b.deposit_status, b.deposit_payment_intent_id, b.start_at, b.created_at, biz.settings
           FROM bookings b JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        const dep = depInfo.rows[0];
        if (dep?.deposit_required) {
          const cancelDeadlineH = dep.settings?.cancel_deadline_hours ?? 48;
          const graceMin = dep.settings?.cancel_grace_minutes ?? 240;
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
          // ===== Stripe refund: actually refund the money when status is 'refunded' =====
          if (newDepStatus === 'refunded' && dep.deposit_payment_intent_id && dep.deposit_payment_intent_id.startsWith('pi_')) {
            const key = process.env.STRIPE_SECRET_KEY;
            if (key) {
              const stripe = require('stripe')(key);
              try {
                await stripe.refunds.create({ payment_intent: dep.deposit_payment_intent_id });
              } catch (stripeErr) {
                if (stripeErr.code !== 'charge_already_refunded') {
                  console.error('[DEPOSIT CANCEL REFUND] Stripe refund failed:', stripeErr.message);
                  // Don't block cancellation — log and continue
                }
              }
            }
          }
          if (newDepStatus) {
            await client.query(
              `UPDATE bookings SET deposit_status = $1 WHERE id = $2 AND business_id = $3`,
              [newDepStatus, id, bid]
            );
            if (newDepStatus === 'refunded') depositRefunded = true;

            // Bug H6 + B4 fix: Update sibling deposits, differentiating by actual deposit_status
            if (old.rows[0].group_id) {
              await client.query(
                `UPDATE bookings SET
                  deposit_status = CASE WHEN deposit_status = 'paid' THEN $1 ELSE deposit_status END,
                  updated_at = NOW()
                 WHERE group_id = $2 AND business_id = $3 AND id != $4 AND deposit_required = true`,
                [newDepStatus, old.rows[0].group_id, bid, id]
              );
            }
          }
        }
      }

      // Audit log (inside transaction for consistency, enriched with deposit state)
      // STS-V11-3 fix: Include deposit-related fields in old_data and new_data
      const oldAudit = { status: old.rows[0].status };
      const newAudit = { status, cancel_reason };
      if (old.rows[0].deposit_required) {
        oldAudit.deposit_required = old.rows[0].deposit_required;
        oldAudit.deposit_status = old.rows[0].deposit_status;
        oldAudit.deposit_amount_cents = old.rows[0].deposit_amount_cents;
        // Fetch current deposit state for new_data (may have changed during this transaction)
        const currentDep = await client.query(
          `SELECT deposit_status, deposit_amount_cents, deposit_required FROM bookings WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
        if (currentDep.rows.length > 0) {
          newAudit.deposit_required = currentDep.rows[0].deposit_required;
          newAudit.deposit_status = currentDep.rows[0].deposit_status;
          newAudit.deposit_amount_cents = currentDep.rows[0].deposit_amount_cents;
        }
      }
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'status_change', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify(oldAudit),
         JSON.stringify(newAudit)]
      );

      return { oldStatus: old.rows[0].status, affectedSiblingIds, depositRefunded };
    });

    // Handle early returns from transaction
    if (txResult.error) {
      return res.status(txResult.error).json({ error: txResult.message });
    }

    // ===== Post-transaction side effects (non-blocking) =====

    // Waitlist trigger on cancel
    // STS-V11-7: Waitlist processing intentionally notifies ALL waiting clients regardless of
    // remaining slot availability. Clients re-check availability when they accept the offer,
    // so over-notification is safe and avoids complex real-time slot counting here.
    if (status === 'cancelled') {
      // STS-V12-001 fix: Move require outside try block so it's accessible for sibling processing
      const { processWaitlistForCancellation } = require('../../services/waitlist');
      try {
        await processWaitlistForCancellation(id, bid);
      } catch (e) { console.warn('[WAITLIST] Processing error:', e.message); }

      // STS-V10-6: Process waitlist for cancelled siblings too
      if (txResult.affectedSiblingIds?.length > 0) {
        for (const sibId of txResult.affectedSiblingIds) {
          try { await processWaitlistForCancellation(sibId, bid); }
          catch (e) { console.warn('[WAITLIST] Sibling processing error:', e.message); }
        }
      }
    }

    // Send cancellation confirmation email to client (non-blocking, skip if deposit refund email will be sent)
    if (status === 'cancelled' && !txResult.depositRefunded) {
      try {
        const emailData = await queryWithRLS(bid,
          `SELECT b.start_at, b.end_at, b.client_id, b.group_id,
                  b.deposit_required, b.deposit_status, b.deposit_amount_cents,
                  c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  p.display_name AS practitioner_name,
                  biz.name AS biz_name, biz.slug, biz.email AS biz_email,
                  biz.address, biz.theme, biz.settings AS biz_settings
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        if (emailData.rows.length > 0 && emailData.rows[0].client_email) {
          const d = emailData.rows[0];
          let groupServices = null;
          if (d.group_id) {
            const grp = await queryWithRLS(bid,
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [d.group_id, bid]
            );
            if (grp.rows.length > 1) groupServices = grp.rows;
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const { sendCancellationEmail } = require('../../services/email');
          sendCancellationEmail({
            booking: { start_at: d.start_at, end_at: groupEndAt || d.end_at, client_name: d.client_name, client_email: d.client_email, service_name: d.service_name, practitioner_name: d.practitioner_name, deposit_required: d.deposit_required, deposit_status: d.deposit_status, deposit_amount_cents: d.deposit_amount_cents },
            business: { name: d.biz_name, slug: d.slug, email: d.biz_email, address: d.address, theme: d.theme, settings: d.biz_settings },
            groupServices
          }).catch(e => console.warn('[EMAIL] Cancellation email error:', e.message));
        }
      } catch (e) { console.warn('[EMAIL] Cancellation email fetch error:', e.message); }
    }

    // Send deposit refund email on auto-refund during cancellation (non-blocking)
    if (txResult.depositRefunded) {
      try {
        const emailData = await queryWithRLS(bid,
          `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.client_id, b.group_id,
                  c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  biz.name AS biz_name, biz.slug, biz.email AS biz_email,
                  biz.address, biz.settings, biz.theme
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        if (emailData.rows.length > 0 && emailData.rows[0].client_email) {
          const d = emailData.rows[0];
          let groupServices = null;
          if (d.group_id) {
            const grp = await queryWithRLS(bid,
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [d.group_id, bid]
            );
            if (grp.rows.length > 1) groupServices = grp.rows;
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const { sendDepositRefundEmail } = require('../../services/email');
          sendDepositRefundEmail({
            booking: { start_at: d.start_at, end_at: groupEndAt || d.end_at, deposit_amount_cents: d.deposit_amount_cents, client_name: d.client_name, client_email: d.client_email, service_name: d.service_name },
            business: { name: d.biz_name, slug: d.slug, email: d.biz_email, address: d.address, settings: d.settings, theme: d.theme },
            groupServices
          }).catch(e => console.warn('[EMAIL] Deposit refund email error:', e.message));
        }
      } catch (e) { console.warn('[EMAIL] Deposit refund email fetch error:', e.message); }
    }

    broadcast(bid, 'booking_update', { action: 'status_changed', booking_id: id, status, old_status: txResult.oldStatus });
    // STS-10: Broadcast for each affected sibling
    if (txResult.affectedSiblingIds && txResult.affectedSiblingIds.length > 0) {
      for (const sibId of txResult.affectedSiblingIds) {
        broadcast(bid, 'booking_update', { action: 'status_changed', booking_id: sibId, status, old_status: txResult.oldStatus });
      }
    }
    // STS-V12-003 fix: Delete calendar event for both cancelled AND no_show (consistent with sibling handling)
    if (['cancelled', 'no_show'].includes(status)) {
      calSyncDelete(bid, id).catch(e => console.warn('[CAL_SYNC] Delete error:', e.message));
    } else {
      calSyncPush(bid, id).catch(e => console.warn('[CAL_SYNC] Push error:', e.message));
    }

    // STS-V11-1 fix: Cal sync for siblings on status change
    if (txResult.affectedSiblingIds && txResult.affectedSiblingIds.length > 0) {
      for (const sibId of txResult.affectedSiblingIds) {
        try {
          if (['cancelled', 'no_show'].includes(status)) {
            await calSyncDelete(bid, sibId);
          } else {
            await calSyncPush(bid, sibId);
          }
        } catch (syncErr) {
          console.error(`Cal sync failed for sibling ${sibId}:`, syncErr.message);
        }
      }
    }

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
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // All deposit-refund operations in a single transaction for atomicity
    const txResult = await transactionWithRLS(bid, async (client) => {
      const bk = await client.query(
        `SELECT deposit_required, deposit_status, deposit_amount_cents, deposit_payment_intent_id, status, practitioner_id, group_id FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (bk.rows.length === 0) return { error: 404, message: 'RDV introuvable' };

      // Practitioner scope: can only modify own bookings
      if (req.practitionerFilter && String(bk.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
        return { error: 403, message: 'Accès interdit' };
      }

      if (!bk.rows[0].deposit_required) return { error: 400, message: 'Pas d\'acompte sur ce RDV' };
      if (bk.rows[0].deposit_status === 'refunded') return { error: 400, message: 'Acompte déjà remboursé' };
      // Bug M10 fix: Only allow refund if deposit was actually paid
      if (bk.rows[0].deposit_status !== 'paid') return { error: 400, message: 'L\'acompte n\'a pas encore été payé — impossible de rembourser' };

      const REFUNDABLE = ['pending', 'confirmed', 'modified_pending', 'pending_deposit'];
      if (!REFUNDABLE.includes(bk.rows[0].status)) {
        return { error: 400, message: `Impossible de rembourser un RDV en statut "${bk.rows[0].status}"` };
      }

      // ===== Stripe refund: actually refund the money =====
      const piId = bk.rows[0].deposit_payment_intent_id;
      if (piId && piId.startsWith('pi_')) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return { error: 500, message: 'Stripe non configuré — remboursement impossible' };
        const stripe = require('stripe')(key);
        try {
          await stripe.refunds.create({ payment_intent: piId });
        } catch (stripeErr) {
          // If already refunded on Stripe, continue (idempotent)
          if (stripeErr.code !== 'charge_already_refunded') {
            console.error('[DEPOSIT REFUND] Stripe refund failed:', stripeErr.message);
            return { error: 500, message: 'Erreur Stripe: ' + stripeErr.message };
          }
        }
      }

      await client.query(
        `UPDATE bookings SET deposit_status = 'refunded', status = 'cancelled', cancel_reason = 'Acompte remboursé manuellement', updated_at = NOW()
         WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );

      // Bug M14 fix: Propagate cancellation to group siblings
      let affectedSiblingIds = [];
      if (bk.rows[0].group_id) {
        affectedSiblingIds = await propagateGroupStatus(client, {
          groupId: bk.rows[0].group_id,
          bid,
          excludeId: id,
          status: 'cancelled',
          cancelReason: 'Acompte remboursé manuellement (groupe)'
        });

        // Also update sibling deposits (STS-6: use CASE for consistent status)
        await client.query(
          `UPDATE bookings SET
            deposit_status = CASE WHEN deposit_status = 'paid' THEN 'cancelled' ELSE deposit_status END,
            updated_at = NOW()
           WHERE group_id = $1 AND business_id = $2 AND id != $3 AND deposit_required = true
             AND deposit_status NOT IN ('refunded', 'cancelled')`,
          [bk.rows[0].group_id, bid, id]
        );
      }

      // Bug B5 fix: Include old_data in deposit-refund audit log
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'deposit_refund', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ status: bk.rows[0].status, deposit_status: bk.rows[0].deposit_status, deposit_amount_cents: bk.rows[0].deposit_amount_cents }),
         JSON.stringify({ deposit_status: 'refunded', status: 'cancelled', amount_cents: bk.rows[0].deposit_amount_cents })]
      );

      return { ok: true, affectedSiblingIds };
    });

    if (txResult.error) {
      return res.status(txResult.error).json({ error: txResult.message });
    }

    broadcast(bid, 'booking_update', { action: 'deposit_refunded', booking_id: id, status: 'cancelled' });
    calSyncDelete(bid, id).catch(e => console.warn('[CAL_SYNC] Delete error:', e.message));
    // STS-11: calSyncDelete + SSE broadcast for affected siblings
    if (txResult.affectedSiblingIds && txResult.affectedSiblingIds.length > 0) {
      for (const sibId of txResult.affectedSiblingIds) {
        calSyncDelete(bid, sibId).catch(e => console.warn('[CAL_SYNC] Sibling delete error:', e.message));
        broadcast(bid, 'booking_update', { action: 'deposit_refunded', booking_id: sibId, status: 'cancelled' });
      }
    }

    // Send refund confirmation email to client (non-blocking)
    try {
      const emailData = await queryWithRLS(bid,
        `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.client_id, b.group_id,
                c.first_name || ' ' || c.last_name AS client_name, c.email AS client_email,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                biz.name AS biz_name, biz.slug, biz.email AS biz_email,
                biz.address, biz.settings, biz.theme
         FROM bookings b
         LEFT JOIN clients c ON c.id = b.client_id
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN businesses biz ON biz.id = b.business_id
         WHERE b.id = $1 AND b.business_id = $2`,
        [id, bid]
      );
      if (emailData.rows.length > 0 && emailData.rows[0].client_email) {
        const d = emailData.rows[0];
        let groupServices = null;
        if (d.group_id) {
          const grp = await queryWithRLS(bid,
            `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
            [d.group_id, bid]
          );
          if (grp.rows.length > 1) groupServices = grp.rows;
        }
        const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
        const { sendDepositRefundEmail } = require('../../services/email');
        sendDepositRefundEmail({
          booking: { start_at: d.start_at, end_at: groupEndAt || d.end_at, deposit_amount_cents: d.deposit_amount_cents, client_name: d.client_name, client_email: d.client_email, service_name: d.service_name },
          business: { name: d.biz_name, slug: d.slug, email: d.biz_email, address: d.address, settings: d.settings, theme: d.theme },
          groupServices
        }).catch(e => console.warn('[EMAIL] Deposit refund email error:', e.message));
      }
    } catch (e) { console.warn('[EMAIL] Deposit refund email fetch error:', e.message); }

    // Process waitlist (same as cancellation)
    try {
      const { processWaitlistForCancellation } = require('../../services/waitlist');
      await processWaitlistForCancellation(id, bid);
    } catch (e) { console.warn('[WAITLIST] Processing error:', e.message); }

    // STS-V10-6: Process waitlist for cancelled siblings too
    if (txResult.affectedSiblingIds?.length > 0) {
      const { processWaitlistForCancellation } = require('../../services/waitlist');
      for (const sibId of txResult.affectedSiblingIds) {
        try { await processWaitlistForCancellation(sibId, bid); }
        catch (e) { console.warn('[WAITLIST] Sibling processing error:', e.message); }
      }
    }

    res.json({ updated: true, deposit_status: 'refunded' });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/bookings/:id/send-deposit-request
// Send deposit request notification via SMS or email
// UI: Quick-create post-creation panel + Detail modal deposit banner
// ============================================================
router.post('/:id/send-deposit-request', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { channel } = req.body;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    if (!['sms', 'email'].includes(channel)) {
      return res.status(400).json({ error: 'Channel doit \u00eatre "sms" ou "email"' });
    }

    // 1. Fetch booking + client + business + service
    const bkResult = await queryWithRLS(bid, `
      SELECT b.id, b.status, b.deposit_required, b.deposit_status,
             b.deposit_amount_cents, b.deposit_deadline, b.public_token,
             b.start_at, b.end_at, b.practitioner_id, b.group_id,
             c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
             CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
             p.display_name AS practitioner_name,
             biz.name AS business_name, biz.email AS business_email,
             biz.address AS business_address, biz.theme, biz.plan, biz.settings
      FROM bookings b
      LEFT JOIN clients c ON c.id = b.client_id
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
      JOIN practitioners p ON p.id = b.practitioner_id
      JOIN businesses biz ON biz.id = b.business_id
      WHERE b.id = $1 AND b.business_id = $2
    `, [id, bid]);

    if (bkResult.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const bk = bkResult.rows[0];

    // Practitioner scope
    if (req.practitionerFilter && String(bk.practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Acc\u00e8s interdit' });
    }

    // 2. Validate booking is pending_deposit
    if (bk.status !== 'pending_deposit' || !bk.deposit_required) {
      return res.status(400).json({ error: 'Ce RDV ne n\u00e9cessite pas d\'acompte' });
    }
    if (bk.deposit_status !== 'pending') {
      return res.status(400).json({ error: 'L\'acompte n\'est plus en attente' });
    }

    // 3. Validate client contact
    if (channel === 'email' && !bk.client_email) {
      return res.status(400).json({ error: 'Le client n\'a pas d\'adresse email' });
    }
    if (channel === 'sms' && !bk.client_phone) {
      return res.status(400).json({ error: 'Le client n\'a pas de num\u00e9ro de t\u00e9l\u00e9phone' });
    }

    // 4. Plan gating: SMS requires Pro/Premium
    if (channel === 'sms' && !['pro', 'premium'].includes(bk.plan)) {
      return res.status(403).json({ error: 'L\'envoi SMS n\u00e9cessite le plan Pro ou Premium' });
    }

    // 5. Anti-spam: min 60 min between sends
    const notifType = channel === 'sms' ? 'sms_deposit_request' : 'email_deposit_request';
    const lastSent = await queryWithRLS(bid, `
      SELECT sent_at FROM notifications
      WHERE booking_id = $1 AND business_id = $2 AND type = $3 AND status = 'sent'
      ORDER BY sent_at DESC LIMIT 1
    `, [id, bid, notifType]);

    if (lastSent.rows.length > 0) {
      const lastAt = new Date(lastSent.rows[0].sent_at);
      const minSince = (Date.now() - lastAt.getTime()) / 60000;
      if (minSince < 60) {
        const waitMin = Math.ceil(60 - minSince);
        return res.status(429).json({
          error: `Demande d\u00e9j\u00e0 envoy\u00e9e r\u00e9cemment. R\u00e9essayez dans ${waitMin} min.`,
          last_sent_at: lastAt.toISOString()
        });
      }
    }

    // 6. Build deposit URL
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const depositUrl = `${baseUrl}/deposit/${bk.public_token}`;

    // 7. Store deposit_payment_url
    await queryWithRLS(bid, `UPDATE bookings SET deposit_payment_url = $1 WHERE id = $2 AND business_id = $3`, [depositUrl, id, bid]);

    // 8. Send
    let sendResult;
    if (channel === 'email') {
      let groupServices = null;
      if (bk.group_id) {
        const grp = await queryWithRLS(bid,
          `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           WHERE b.group_id = $1 AND b.business_id = $2
           ORDER BY b.group_order, b.start_at`,
          [bk.group_id, bid]
        );
        if (grp.rows.length > 1) groupServices = grp.rows;
      }
      if (groupServices) bk.end_at = groupServices[groupServices.length - 1].end_at;
      const { sendDepositRequestEmail } = require('../../services/email');
      const payUrl = `${baseUrl}/api/public/deposit/${bk.public_token}/pay`;
      sendResult = await sendDepositRequestEmail({
        booking: bk,
        business: { name: bk.business_name, email: bk.business_email, address: bk.business_address, theme: bk.theme, settings: bk.settings },
        depositUrl,
        payUrl,
        groupServices
      });
    } else {
      const { sendSMS } = require('../../services/sms');
      const amtStr = ((bk.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
      const dateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', {
        timeZone: 'Europe/Brussels', day: 'numeric', month: 'short'
      });
      const body = `${bk.business_name} \u2014 Acompte de ${amtStr}\u20ac requis pour votre RDV du ${dateStr}. D\u00e9tails : ${depositUrl}`;
      sendResult = await sendSMS({ to: bk.client_phone, body, businessId: bid });
    }

    // 9. Log notification
    const status = sendResult.success ? 'sent' : 'failed';
    const provider = channel === 'sms' ? 'twilio' : 'brevo';
    const providerId = sendResult.messageId || sendResult.sid || null;
    await queryWithRLS(bid, `
      INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status, provider, provider_message_id, error, sent_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${status === 'sent' ? 'NOW()' : 'NULL'})
    `, [bid, id, notifType, bk.client_email || null, bk.client_phone || null, status, provider, providerId, sendResult.error || null]);

    if (!sendResult.success) {
      return res.status(500).json({ error: 'Envoi \u00e9chou\u00e9: ' + (sendResult.error || 'erreur inconnue') });
    }

    res.json({ sent: true, channel, deposit_url: depositUrl });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/bookings/:id/require-deposit
// Retroactively require a deposit on an already-confirmed booking
// UI: Calendar → event detail → "Exiger un acompte"
// ============================================================
router.post('/:id/require-deposit', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { amount_cents, deadline_hours } = req.body;
    if (!amount_cents || amount_cents <= 0) return res.status(400).json({ error: 'Montant invalide' });

    const txResult = await transactionWithRLS(bid, async (client) => {
      const bk = await client.query(
        `SELECT id, status, deposit_required, start_at, group_id, practitioner_id
         FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (bk.rows.length === 0) return { error: 404, message: 'RDV introuvable' };
      const b = bk.rows[0];

      // Practitioner scope
      if (req.practitionerFilter && String(b.practitioner_id) !== String(req.practitionerFilter)) {
        return { error: 403, message: 'Accès interdit' };
      }

      if (b.deposit_required && b.deposit_status !== 'refunded') return { error: 400, message: 'Un acompte est déjà exigé sur ce RDV' };
      if (!['pending', 'confirmed', 'modified_pending'].includes(b.status)) {
        return { error: 400, message: `Impossible d'exiger un acompte pour un RDV en statut "${b.status}"` };
      }
      if (new Date(b.start_at) <= new Date()) {
        return { error: 400, message: 'Impossible d\'exiger un acompte pour un RDV passé' };
      }

      // Calculate deadline
      const dlHours = deadline_hours || 48;
      let deadline = new Date(new Date(b.start_at).getTime() - dlHours * 3600000);
      // If deadline already past, give at least 2h from now
      if (deadline <= new Date()) {
        deadline = new Date(Date.now() + 2 * 3600000);
      }

      await client.query(
        `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
          deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
          deposit_paid_at = NULL, deposit_payment_intent_id = NULL, updated_at = NOW()
         WHERE id = $3 AND business_id = $4`,
        [amount_cents, deadline.toISOString(), id, bid]
      );

      // Group siblings: also set pending_deposit status (no amount)
      if (b.group_id) {
        await propagateGroupStatus(client, {
          groupId: b.group_id,
          bid,
          excludeId: id,
          status: 'pending_deposit',
          cancelReason: null
        });
      }

      // Audit log
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'require_deposit', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ status: b.status, deposit_required: false }),
         JSON.stringify({ status: 'pending_deposit', deposit_required: true, deposit_amount_cents: amount_cents, deposit_deadline: deadline.toISOString() })]
      );

      return { ok: true };
    });

    if (txResult.error) return res.status(txResult.error).json({ error: txResult.message });

    broadcast(bid, 'booking_update', { action: 'require_deposit', booking_id: id, status: 'pending_deposit' });
    calSyncPush(bid, id).catch(e => console.warn('[CAL_SYNC] Push error:', e.message));

    res.json({ updated: true, status: 'pending_deposit' });
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
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // All deletion operations in a single transaction for atomicity
    // Status check is INSIDE the transaction with FOR UPDATE to prevent race conditions
    const txResult = await transactionWithRLS(bid, async (client) => {
      // Lock and verify status inside transaction
      const check = await client.query(
        `SELECT status, group_id, client_id, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (check.rows.length === 0) return { error: 404, message: 'RDV introuvable' };

      // Practitioner scope: can only delete own bookings
      if (req.practitionerFilter && String(check.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
        return { error: 403, message: 'Accès interdit' };
      }

      if (!['cancelled', 'no_show'].includes(check.rows[0].status)) {
        return { error: 400, message: 'Seuls les RDV annulés ou no-show peuvent être supprimés' };
      }

      // Bug B4 fix: Helper to decrement strike and reverse auto-block if below threshold
      async function decrementStrikeAndMaybeUnblock(clientId) {
        const updated = await client.query(
          `UPDATE clients SET no_show_count = GREATEST(0, no_show_count - 1), updated_at = NOW()
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

      let bookingIds = [id];
      if (check.rows[0].group_id) {
        const siblings = await client.query(
          `SELECT id, status, client_id FROM bookings
           WHERE group_id = $1 AND business_id = $2 AND status IN ('cancelled', 'no_show')
           FOR UPDATE`,
          [check.rows[0].group_id, bid]
        );
        bookingIds = siblings.rows.map(r => r.id);
        // STS-V11-2 fix: Ensure the principal booking ID is always included in deletion array
        if (!bookingIds.includes(id)) bookingIds.push(id);
        if (bookingIds.length === 0) bookingIds = [id];

        for (const sib of siblings.rows) {
          if (sib.status === 'no_show' && sib.client_id) {
            await decrementStrikeAndMaybeUnblock(sib.client_id);
          }
        }
      } else {
        if (check.rows[0].status === 'no_show' && check.rows[0].client_id) {
          await decrementStrikeAndMaybeUnblock(check.rows[0].client_id);
        }
      }

      // STS-V10-1: Detach remaining active siblings from group (prevent orphans)
      if (check.rows[0].group_id) {
        await client.query(
          `UPDATE bookings SET group_id = NULL, updated_at = NOW()
           WHERE group_id = $1 AND business_id = $2 AND id != ALL($3::uuid[])`,
          [check.rows[0].group_id, bid, bookingIds]
        );
      }

      // STS-V10-2: FK reschedule_of_booking_id cleanup before DELETE
      await client.query(
        `UPDATE bookings SET reschedule_of_booking_id = NULL
         WHERE reschedule_of_booking_id = ANY($1::uuid[]) AND business_id = $2`,
        [bookingIds, bid]
      );

      // BK-V13-004: Collect external calendar event IDs BEFORE deleting bookings,
      // so we can call calSyncDelete AFTER the transaction commits (avoiding
      // permanent external calendar deletion if the transaction rolls back).
      // Store the external event info needed for post-transaction cleanup.
      const calEventRows = await client.query(
        `SELECT ce.booking_id, ce.external_event_id, ce.connection_id
         FROM calendar_events ce
         JOIN calendar_connections cc ON cc.id = ce.connection_id
         WHERE ce.booking_id = ANY($1::uuid[]) AND cc.business_id = $2`,
        [bookingIds, bid]
      );
      const calEventsToDelete = calEventRows.rows;

      await client.query(`DELETE FROM booking_notes WHERE booking_id = ANY($1) AND business_id = $2`, [bookingIds, bid]);
      await client.query(`DELETE FROM practitioner_todos WHERE booking_id = ANY($1) AND business_id = $2`, [bookingIds, bid]);
      await client.query(`DELETE FROM booking_reminders WHERE booking_id = ANY($1) AND business_id = $2`, [bookingIds, bid]);
      await client.query(`DELETE FROM bookings WHERE id = ANY($1) AND business_id = $2`, [bookingIds, bid]);

      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data)
         VALUES ($1, $2, 'booking', $3, 'permanent_delete', $4)`,
        [bid, req.user.id, id, JSON.stringify({ status: check.rows[0].status, group_id: check.rows[0].group_id, deleted_count: bookingIds.length })]
      );

      return { bookingIds, calEventsToDelete };
    });

    // Handle early returns from transaction
    if (txResult.error) {
      return res.status(txResult.error).json({ error: txResult.message });
    }

    // Post-transaction side effects
    // BK-V13-004: Call calSyncDelete AFTER transaction commits so that if the
    // transaction rolls back, external calendar events are not permanently deleted.
    // We collected the calendar event info inside the transaction while rows still existed.
    const deletedIds = txResult.bookingIds;
    for (const bId of deletedIds) {
      try { await calSyncDelete(bid, bId); }
      catch (e) { console.warn('[CAL_SYNC] Post-delete sync error:', e.message); }
    }
    // STS-V12-004 fix: Broadcast for ALL deleted IDs, not just the primary
    for (const bId of deletedIds) {
      broadcast(bid, 'booking_update', { action: 'deleted', booking_id: bId });
    }
    res.json({ deleted: true, deleted_count: deletedIds.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
