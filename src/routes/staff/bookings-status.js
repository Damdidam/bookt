/**
 * Booking Status — status changes, deposit refund, permanent delete.
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { calSyncPush, calSyncDelete, checkBookingConflicts, getMaxConcurrent } = require('./bookings-helpers');
const { refundGiftCardForBooking, getGcPaidCents } = require('../../services/gift-card-refund');
const { refundPassForBooking } = require('../../services/pass-refund');
const { blockIfImpersonated } = require('../../middleware/auth');
const { invalidateMinisiteCache } = require('../public/helpers');

// ===== STATE MACHINE: valid transitions (module-level for reuse) =====
const TRANSITIONS = {
  pending:          ['confirmed', 'cancelled', 'no_show'],
  confirmed:        ['completed', 'cancelled', 'no_show', 'modified_pending', 'pending_deposit'],
  modified_pending: ['confirmed', 'cancelled'],
  pending_deposit:  ['confirmed', 'cancelled'],
  completed:        ['confirmed'],  // ré-ouvrir si erreur
  no_show:          ['confirmed', 'cancelled'],
  cancelled:        ['confirmed', 'pending_deposit']  // rétablir un RDV annulé (pending_deposit si acompte remboursé)
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
      `UPDATE bookings SET status = $1, updated_at = NOW()${status === 'confirmed' ? ', locked = true, cancel_reason = NULL' : ''}
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
      const reason = `Bloqué automatiquement : ${count} no-show(s)`;
      const updBlock = await client.query(
        `UPDATE clients SET
          is_blocked = true,
          blocked_at = NOW(),
          blocked_reason = $1,
          updated_at = NOW()
         WHERE id = $2 AND business_id = $3 AND is_blocked = false
         RETURNING id`,
        [reason, sib.client_id, bid]
      );
      // P1-04 RGPD art.22 : décision automatisée (blocage auto sur no-show
      // threshold) — doit être auditée. Sinon un client blocké ne peut pas
      // savoir que c'était une décision automatisée vs manuelle, ni contester.
      if (updBlock.rowCount > 0) {
        try {
          await client.query(
            `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
             VALUES ($1, NULL, 'client', $2, 'client_auto_block_noshow', $3, $4)`,
            [bid, sib.client_id,
             JSON.stringify({ is_blocked: false, no_show_count_before: count - 1 }),
             JSON.stringify({ is_blocked: true, blocked_reason: reason, no_show_count: count, threshold, source: 'auto_noshow_trigger' })]
          );
        } catch (e) { console.error('[AUDIT] auto-block no-show audit insert failed:', e.message); }
      }
    }
  }
}

// ============================================================
// PATCH /api/bookings/:id/status
// Update booking status (confirm / complete / no_show / cancel)
// UI: Agenda → action buttons ( Terminé,  No-show, Annuler)
// ============================================================
router.patch('/:id/status', blockIfImpersonated, async (req, res, next) => {
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
        `SELECT b.status, b.client_id, b.deposit_required, b.deposit_status, b.deposit_amount_cents,
                b.group_id, b.practitioner_id, b.start_at, b.public_token,
                biz.settings
         FROM bookings b JOIN businesses biz ON biz.id = b.business_id
         WHERE b.id = $1 AND b.business_id = $2 FOR UPDATE OF b`,
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

      // ===== DEPOSIT-AWARE RESTORE: cancelled → confirmed with deposit =====
      // If deposit was refunded → re-request deposit (pending_deposit)
      // If deposit was retained (cancelled) → mark as paid, confirm normally
      let depositRestore = null; // null | 'redeposit' | 'repaid'
      if (old.rows[0].status === 'cancelled' && status === 'confirmed' && old.rows[0].deposit_required) {
        const depSt = old.rows[0].deposit_status;
        if (depSt === 'refunded') {
          // Deposit was refunded → re-request deposit instead of confirming
          depositRestore = 'redeposit';
          status = 'pending_deposit'; // override target status
        } else if (depSt === 'cancelled') {
          // Deposit was retained → client already paid, restore as paid
          depositRestore = 'repaid';
        }
        // If deposit_status is 'paid' → normal confirm (shouldn't happen but safe)
        // If deposit_status is 'pending' → re-request
        if (depSt === 'pending') {
          depositRestore = 'redeposit';
          status = 'pending_deposit';
        }
      }

      // M7 fix: Check slot availability when un-cancelling (primary + group siblings)
      if (old.rows[0].status === 'cancelled' && !['cancelled', 'no_show', 'completed'].includes(status)) {
        const slotsToCheck = [{ id, bid }];
        if (old.rows[0].group_id) {
          const grpSlots = await client.query(
            `SELECT id, start_at, end_at, practitioner_id FROM bookings WHERE group_id = $1 AND business_id = $2 AND status = 'cancelled'`,
            [old.rows[0].group_id, bid]
          );
          for (const gs of grpSlots.rows) slotsToCheck.push(gs);
        } else {
          const bkSlot = await client.query(`SELECT start_at, end_at, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]);
          if (bkSlot.rows.length > 0) slotsToCheck[0] = { ...bkSlot.rows[0], id };
        }
        for (const slot of slotsToCheck) {
          if (!slot.practitioner_id) continue;
          const maxConc = await getMaxConcurrent(bid, slot.practitioner_id);
          const conflicts = await checkBookingConflicts(client, {
            bid, pracId: slot.practitioner_id,
            newStart: new Date(slot.start_at).toISOString(),
            newEnd: new Date(slot.end_at).toISOString(),
            excludeIds: slot.id
          });
          if (conflicts.length >= maxConc) {
            return { error: 409, message: 'Ce créneau n\'est plus disponible. Un autre RDV occupe déjà ce créneau.' };
          }
        }
      }

      // Update booking status
      if (status === 'cancelled') {
        await client.query(
          `UPDATE bookings SET status = $1, cancel_reason = $2, updated_at = NOW()
           WHERE id = $3 AND business_id = $4`,
          [status, cancel_reason || null, id, bid]
        );
      } else if (depositRestore === 'redeposit') {
        // Re-request deposit: set pending_deposit + new deadline + reset deposit fields
        const settings = old.rows[0].settings || {};
        const dlHours = settings.deposit_deadline_hours || 48;
        let deadline = new Date(new Date(old.rows[0].start_at).getTime() - dlHours * 3600000);
        // If deadline already past, give at least 2h from now (tight deadline)
        if (deadline <= new Date()) {
          deadline = new Date(Date.now() + 2 * 3600000);
        }
        // Ensure deadline doesn't exceed booking start
        if (deadline >= new Date(old.rows[0].start_at)) {
          deadline = new Date(new Date(old.rows[0].start_at).getTime() - 1 * 3600000);
        }
        const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
        const depositUrl = `${baseUrl}/deposit/${old.rows[0].public_token}`;
        await client.query(
          `UPDATE bookings SET status = 'pending_deposit', deposit_status = 'pending',
            deposit_deadline = $1, deposit_paid_at = NULL, deposit_payment_intent_id = NULL,
            deposit_payment_url = $2, deposit_requested_at = NOW(), deposit_request_count = COALESCE(deposit_request_count, 0) + 1,
            deposit_reminder_sent = false, cancel_reason = NULL, updated_at = NOW()
           WHERE id = $3 AND business_id = $4`,
          [deadline.toISOString(), depositUrl, id, bid]
        );
      } else if (depositRestore === 'repaid') {
        // Deposit was retained → mark as paid again
        // H-03 fix: rétablir locked=true (parité avec commit 127628b — tout booking confirmed avec
        // deposit paid est locked. Sans ça, le restored booking était éditable sans cadenas).
        await client.query(
          `UPDATE bookings SET status = 'confirmed', locked = true, deposit_status = 'paid', deposit_paid_at = NOW(),
            deposit_deadline = NULL, cancel_reason = NULL, updated_at = NOW()
           WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
      } else {
        await client.query(
          `UPDATE bookings SET status = $1, updated_at = NOW()${status === 'confirmed' ? ', locked = true, cancel_reason = NULL' : ''}
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

      // ===== AUTO-VOID INVOICES: void draft/sent invoices when booking is cancelled =====
      if (status === 'cancelled') {
        const voidIds = [id, ...affectedSiblingIds];
        await client.query(
          `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
           WHERE booking_id = ANY($1::uuid[]) AND status IN ('draft', 'sent')`,
          [voidIds]
        );
      }

      // ===== DEPOSIT RESTORE: propagate deposit fields to group siblings =====
      if (depositRestore === 'redeposit' && old.rows[0].group_id && affectedSiblingIds.length > 0) {
        // Read back the deadline we just set on the main booking
        const mainDep = await client.query(
          `SELECT deposit_deadline, deposit_payment_url FROM bookings WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
        if (mainDep.rows.length > 0) {
          await client.query(
            `UPDATE bookings SET deposit_required = true, deposit_status = 'pending',
              deposit_deadline = $1, deposit_paid_at = NULL, deposit_payment_intent_id = NULL,
              deposit_reminder_sent = false
             WHERE id = ANY($2::uuid[]) AND business_id = $3`,
            [mainDep.rows[0].deposit_deadline, affectedSiblingIds, bid]
          );
        }
      } else if (depositRestore === 'repaid' && old.rows[0].group_id && affectedSiblingIds.length > 0) {
        await client.query(
          `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(), deposit_deadline = NULL
           WHERE id = ANY($1::uuid[]) AND business_id = $2 AND deposit_required = true`,
          [affectedSiblingIds, bid]
        );
      }

      // ===== DEPOSIT: mark as paid when pending_deposit → confirmed =====
      // BK-V13-006: Also clear deposit_deadline since the deposit is now fulfilled
      if (old.rows[0].status === 'pending_deposit' && status === 'confirmed') {
        await client.query(
          `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(), deposit_deadline = NULL
           WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
        // H2: Also update group siblings' deposit fields
        if (old.rows[0].group_id) {
          await client.query(
            `UPDATE bookings SET deposit_status = 'paid', deposit_paid_at = NOW(), deposit_deadline = NULL
             WHERE group_id = $1 AND business_id = $2 AND id != $3 AND deposit_required = true AND deposit_status = 'pending'`,
            [old.rows[0].group_id, bid, id]
          );
        }
      }

      // ===== COMPLETED: reset cancel_count (consecutive cancellations reset) =====
      if (status === 'completed' && old.rows[0].client_id) {
        try {
          await client.query(
            `UPDATE clients SET cancel_count = 0, updated_at = NOW() WHERE id = $1 AND business_id = $2 AND cancel_count > 0`,
            [old.rows[0].client_id, bid]
          );
        } catch (e) { /* non-critical */ }
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
            const reasonBlk = `Bloqué automatiquement : ${count} no-show(s)`;
            const updBlockMain = await client.query(
              `UPDATE clients SET
                is_blocked = true,
                blocked_at = NOW(),
                blocked_reason = $1,
                updated_at = NOW()
               WHERE id = $2 AND business_id = $3 AND is_blocked = false
               RETURNING id`,
              [reasonBlk, clientId, bid]
            );
            // P1-04 RGPD art.22 : audit décision automatique (clone de L91).
            if (updBlockMain.rowCount > 0) {
              try {
                await client.query(
                  `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
                   VALUES ($1, NULL, 'client', $2, 'client_auto_block_noshow', $3, $4)`,
                  [bid, clientId,
                   JSON.stringify({ is_blocked: false, no_show_count_before: count - 1 }),
                   JSON.stringify({ is_blocked: true, blocked_reason: reasonBlk, no_show_count: count, threshold, source: 'auto_noshow_trigger_main' })]
                );
              } catch (e) { console.error('[AUDIT] auto-block no-show main audit insert failed:', e.message); }
            }
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
              const updUnblock = await client.query(
                `UPDATE clients SET is_blocked = false, blocked_reason = NULL, blocked_at = NULL, updated_at = NOW()
                 WHERE id = $1 AND business_id = $2 AND is_blocked = true
                 RETURNING id`,
                [cid, bid]
              );
              // P1-04 RGPD art.22 : audit décision automatique d'unblock (symétrie block).
              if (updUnblock.rowCount > 0) {
                try {
                  await client.query(
                    `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
                     VALUES ($1, NULL, 'client', $2, 'client_auto_unblock_noshow', $3, $4)`,
                    [bid, cid,
                     JSON.stringify({ is_blocked: true, blocked_reason: cl.blocked_reason, no_show_count_before: cl.no_show_count + 1 }),
                     JSON.stringify({ is_blocked: false, no_show_count: cl.no_show_count, threshold, source: 'auto_noshow_revert' })]
                  );
                } catch (e) { console.error('[AUDIT] auto-unblock no-show audit insert failed:', e.message); }
              }
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

      // BUG-3 fix: Decrement cancel_count when restoring a cancelled booking
      // Note: only client-initiated cancels increment cancel_count. If staff cancelled then
      // restores, GREATEST(0) prevents going below zero. Completed status resets to 0 anyway.
      if (old.rows[0].status === 'cancelled' && status === 'confirmed' && old.rows[0].client_id) {
        await client.query(
          `UPDATE clients SET cancel_count = GREATEST(COALESCE(cancel_count, 0) - 1, 0), updated_at = NOW()
           WHERE id = $1 AND business_id = $2 AND COALESCE(cancel_count, 0) > 0`,
          [old.rows[0].client_id, bid]
        ).catch(e => console.warn('[CANCEL COUNT DEC]', e.message));
      }

      // ===== DEPOSIT: refund logic on cancellation =====
      let depositRefunded = false;
      let depRetentionReason = null; // 'stripe_failure' | 'no_stripe_key' | 'fees_exceed_charge'
      let gcRefundForEmail = { refunded: 0 };
      let passRefundForEmail = { refunded: 0 };
      // M2: capture actual amounts so the refund email shows real net (not deposit_amount_cents)
      let netRefundCentsForEmail = null; // null = full deposit (refund_policy='full' or no fees deducted)
      let gcPaidForRefundEmail = 0;       // GC portion that goes back to the GC balance
      if (status === 'cancelled') {
        const depInfo = await client.query(
          // P1-07: SELECT disputed_at pour bloquer le refund si contentieux Stripe.
          `SELECT b.deposit_required, b.deposit_status, b.deposit_amount_cents, b.deposit_payment_intent_id, b.start_at, b.created_at, b.disputed_at, biz.settings
           FROM bookings b JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        const dep = depInfo.rows[0];
        // P1-07: dispute Stripe en cours → pattern { error, message } remonté
        // comme les autres early-returns (voir L142, L148). Le pro peut
        // toujours annuler commercialement (marquer no_show ou no-refund)
        // mais le refund auto via cancel est bloqué jusqu'à résolution Stripe.
        if (dep?.disputed_at && dep?.deposit_status === 'paid') {
          return { error: 409, message: 'Litige Stripe en cours sur ce paiement. Attendez la résolution (dashboard Stripe) avant d\'annuler ce RDV.' };
        }
        if (dep?.deposit_required) {
          let newDepStatus;
          if (dep.deposit_status === 'paid') {
            // Staff cancel = ALWAYS refund the deposit to the client
            newDepStatus = 'refunded';
          } else if (dep.deposit_status === 'pending') {
            newDepStatus = 'cancelled';
          } else if (dep.deposit_status === 'waived') {
            // C1 fix: waived deposit — no Stripe refund needed, but pass/GC must still be refunded
            newDepStatus = 'cancelled';
          } else if (dep.deposit_status === 'refunded' || dep.deposit_status === 'cancelled') {
            // H2 fix: terminal state already — keep status, but still trigger downstream GC/pass refund
            // (covers restore-then-re-cancel where deposit was already settled in a prior cycle).
            newDepStatus = dep.deposit_status;
          }
          // ===== Stripe refund: inside TX intentionally =====
          // H6 note: Keeping Stripe call inside the transaction is safer than post-commit.
          // If Stripe fails → newDepStatus falls back to 'cancelled' (deposit retained) = consistent.
          // Moving Stripe post-commit would mean: DB shows 'refunded' but Stripe call might fail = worse.
          if (newDepStatus === 'refunded' && dep.deposit_payment_intent_id) {
            const key = process.env.STRIPE_SECRET_KEY;
            if (key) {
              const stripe = require('stripe')(key);
              try {
                // Resolve cs_* checkout session to pi_* payment intent
                let piId = dep.deposit_payment_intent_id;
                if (piId.startsWith('cs_')) {
                  const session = await stripe.checkout.sessions.retrieve(piId);
                  piId = session.payment_intent;
                }
                if (piId && piId.startsWith('pi_')) {
                  // B#3 + GC-MIX fix: staff cancel force refund FULL (pro absorbe frais).
                  // MAIS le refund Stripe porte UNIQUEMENT sur la portion chargée =
                  // deposit_amount_cents - gc_paid_cents. Si on met netRefundCentsForEmail
                  // = deposit_amount_cents, email-cancel.js:L89 affiche un montant Stripe
                  // gonflé du GC (ex: dépôt 50€ payé 20€ GC + 30€ Stripe → email mentait
                  // "50€ remboursés par CB" alors que Stripe n'a rendu que 30€).
                  // On laisse `null` → email retombe sur calcul correct = charge - GC.
                  // Parité avec reject public (booking-actions.js:607 rejectNetRefundCents=null).
                  const { createRefund: _cr } = require('../../services/stripe-refund');
                  await _cr(stripe, { payment_intent: piId }, `staff-cancel-refund-${id}`);
                }
              } catch (stripeErr) {
                if (stripeErr.code !== 'charge_already_refunded') {
                  // P2-09: Sentry capture — money loss silent sinon.
                  const { reportError } = require('../../services/error-reporter');
                  reportError(stripeErr, { tag: 'DEPOSIT_CANCEL_REFUND', bookingId: id, piId: dep.deposit_payment_intent_id });
                  // Stripe refund failed — keep deposit as 'cancelled' (retained), not 'refunded'
                  newDepStatus = 'cancelled';
                  depRetentionReason = 'stripe_failure';
                }
              }
            } else {
              // No Stripe key — can't refund, mark as retained
              console.warn('[DEPOSIT CANCEL REFUND] STRIPE_SECRET_KEY not set — deposit retained');
              newDepStatus = 'cancelled';
              depRetentionReason = 'no_stripe_key';
            }
          }
          if (newDepStatus) {
            await client.query(
              `UPDATE bookings SET deposit_status = $1 WHERE id = $2 AND business_id = $3`,
              [newDepStatus, id, bid]
            );
            if (newDepStatus === 'refunded') depositRefunded = true;

            // Refund gift card debits if deposit cancelled/refunded
            if (newDepStatus === 'cancelled' || newDepStatus === 'refunded') {
              gcRefundForEmail = await refundGiftCardForBooking(id, client) || { refunded: 0 };
              // Propage montant GC au payload sendDepositRefundEmail (L894 consomme
              // txResult.gcPaidForRefundEmail — sans ça l'email oublie le bloc GC).
              gcPaidForRefundEmail = gcRefundForEmail.refunded || 0;
              try { passRefundForEmail = await refundPassForBooking(id, client) || { refunded: 0 }; } catch (e) { console.warn('[PASS REFUND]', e.message); }
            }

            // Bug H6 + B4 + M7 fix: Update sibling deposits, handle both paid and pending
            if (old.rows[0].group_id) {
              await client.query(
                `UPDATE bookings SET
                  deposit_status = CASE
                    WHEN deposit_status = 'paid' THEN $1
                    WHEN deposit_status = 'pending' THEN 'cancelled'
                    ELSE deposit_status END,
                  updated_at = NOW()
                 WHERE group_id = $2 AND business_id = $3 AND id != $4 AND deposit_required = true`,
                [newDepStatus, old.rows[0].group_id, bid, id]
              );
              // Refund GC debits for siblings too
              const sibIds = await client.query(
                `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`,
                [old.rows[0].group_id, bid, id]
              );
              for (const sib of sibIds.rows) { await refundGiftCardForBooking(sib.id, client); }
              for (const sib of sibIds.rows) { await refundPassForBooking(sib.id, client).catch(e => console.warn('[PASS REFUND]', e.message)); }
            }
          }
        }

        // ===== PASS/GC REFUND: for bookings WITHOUT deposit (e.g. pass-covered) =====
        if (!dep?.deposit_required) {
          gcRefundForEmail = await refundGiftCardForBooking(id, client) || { refunded: 0 };
          try { passRefundForEmail = await refundPassForBooking(id, client) || { refunded: 0 }; } catch (e) { console.warn('[PASS REFUND]', e.message); }
          // Group siblings
          if (old.rows[0].group_id) {
            const sibIds = await client.query(
              `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`,
              [old.rows[0].group_id, bid, id]
            );
            for (const sib of sibIds.rows) { await refundGiftCardForBooking(sib.id, client); }
            for (const sib of sibIds.rows) { await refundPassForBooking(sib.id, client).catch(e => console.warn('[PASS REFUND]', e.message)); }
          }
        }
      }

      // M16: Decrement promo usage on cancel
      if (status === 'cancelled') {
        const { decrementPromoUsage } = require('../../routes/public/helpers');
        await decrementPromoUsage(id, client).catch(e => console.warn('[PROMO DEC]', e.message));
      }

      // H1 fix: Re-increment promo usage when restoring a cancelled booking
      if (old.rows[0].status === 'cancelled' && status !== 'cancelled') {
        // PROMO-01 fix (audit 23 avril hotfix) : trouver le CARRIER (le booking qui
        // porte promotion_id). En multi-service seul le carrier group_order=0 l'a.
        // Si le restore est demandé sur un sibling non-carrier, le SELECT WHERE id=$1
        // renvoyait 0 rows → ni current_uses++ ni reset promo_decremented_at.
        // Parity avec decrementPromoUsage:332-336 qui cherche le carrier via group_id.
        const _carrierQ = await client.query(
          `SELECT id, promotion_id FROM bookings
           WHERE promotion_id IS NOT NULL AND business_id = $1
             AND (id = $2 OR group_id = (SELECT group_id FROM bookings WHERE id = $2))
           LIMIT 1`,
          [bid, id]
        );
        if (_carrierQ.rows.length > 0) {
          const _carrierId = _carrierQ.rows[0].id;
          const _carrierPromoId = _carrierQ.rows[0].promotion_id;
          await client.query(
            `UPDATE promotions SET current_uses = current_uses + 1 WHERE id = $1`,
            [_carrierPromoId]
          ).catch(e => console.warn('[PROMO INC] restore:', e.message));
          // Reset promo_decremented_at=NULL sur le CARRIER (pas sur id courant) pour
          // que le prochain cancel passe le guard atomique de decrementPromoUsage.
          await client.query(
            `UPDATE bookings SET promo_decremented_at = NULL WHERE id = $1`, [_carrierId]
          ).catch(e => console.warn('[PROMO DEC RESET] restore:', e.message));
        }

        // C1 fix: Re-consume pass credits + GC balance when restoring a cancelled booking
        // Re-debit pass sessions that were refunded
        const _passRefunds = await client.query(
          `SELECT pt.pass_id, pt.sessions, pt.booking_id FROM pass_transactions pt WHERE pt.booking_id = $1 AND pt.type = 'refund'`, [id]
        );
        for (const pr of _passRefunds.rows) {
          const _existRd = await client.query(
            `SELECT id FROM pass_transactions WHERE pass_id = $1 AND booking_id = $2 AND type = 'debit' AND note LIKE '%rétablissement%'`, [pr.pass_id, pr.booking_id]
          );
          if (_existRd.rows.length > 0) continue;
          await client.query(`UPDATE passes SET sessions_remaining = GREATEST(sessions_remaining - $1, 0), updated_at = NOW() WHERE id = $2`, [Math.abs(pr.sessions), pr.pass_id]);
          await client.query(
            `INSERT INTO pass_transactions (id, pass_id, business_id, booking_id, sessions, type, note) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'debit', 'Re-consommation — rétablissement RDV')`,
            [pr.pass_id, bid, pr.booking_id, -Math.abs(pr.sessions)]
          );
        }
        // Re-debit gift card balance that was refunded
        const _gcRefunds = await client.query(
          `SELECT gct.gift_card_id, gct.amount_cents, gct.booking_id FROM gift_card_transactions gct WHERE gct.booking_id = $1 AND gct.type = 'refund'`, [id]
        );
        for (const gr of _gcRefunds.rows) {
          const _existRd = await client.query(
            `SELECT id FROM gift_card_transactions WHERE gift_card_id = $1 AND booking_id = $2 AND type = 'debit' AND note LIKE '%rétablissement%'`, [gr.gift_card_id, gr.booking_id]
          );
          if (_existRd.rows.length > 0) continue;
          await client.query(`UPDATE gift_cards SET balance_cents = GREATEST(balance_cents - $1, 0), updated_at = NOW() WHERE id = $2`, [gr.amount_cents, gr.gift_card_id]);
          await client.query(
            `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, booking_id, amount_cents, type, note) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'debit', 'Re-consommation — rétablissement RDV')`,
            [gr.gift_card_id, bid, gr.booking_id, gr.amount_cents]
          );
        }
        // Same for group siblings
        if (old.rows[0].group_id) {
          const _ucSibs = await client.query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [old.rows[0].group_id, bid, id]);
          for (const sib of _ucSibs.rows) {
            const _spR = await client.query(`SELECT pt.pass_id, pt.sessions FROM pass_transactions pt WHERE pt.booking_id = $1 AND pt.type = 'refund'`, [sib.id]);
            for (const pr of _spR.rows) {
              const _ex = await client.query(`SELECT id FROM pass_transactions WHERE pass_id = $1 AND booking_id = $2 AND type = 'debit' AND note LIKE '%rétablissement%'`, [pr.pass_id, sib.id]);
              if (_ex.rows.length > 0) continue;
              await client.query(`UPDATE passes SET sessions_remaining = GREATEST(sessions_remaining - $1, 0), updated_at = NOW() WHERE id = $2`, [Math.abs(pr.sessions), pr.pass_id]);
              await client.query(`INSERT INTO pass_transactions (id, pass_id, business_id, booking_id, sessions, type, note) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'debit', 'Re-consommation — rétablissement RDV')`, [pr.pass_id, bid, sib.id, -Math.abs(pr.sessions)]);
            }
            const _sgR = await client.query(`SELECT gct.gift_card_id, gct.amount_cents FROM gift_card_transactions gct WHERE gct.booking_id = $1 AND gct.type = 'refund'`, [sib.id]);
            for (const gr of _sgR.rows) {
              const _ex = await client.query(`SELECT id FROM gift_card_transactions WHERE gift_card_id = $1 AND booking_id = $2 AND type = 'debit' AND note LIKE '%rétablissement%'`, [gr.gift_card_id, sib.id]);
              if (_ex.rows.length > 0) continue;
              await client.query(`UPDATE gift_cards SET balance_cents = GREATEST(balance_cents - $1, 0), updated_at = NOW() WHERE id = $2`, [gr.amount_cents, gr.gift_card_id]);
              await client.query(`INSERT INTO gift_card_transactions (id, gift_card_id, business_id, booking_id, amount_cents, type, note) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'debit', 'Re-consommation — rétablissement RDV')`, [gr.gift_card_id, bid, sib.id, gr.amount_cents]);
            }
          }
        }
      }

      // BUG-2 fix: Un-void invoices when restoring a cancelled booking
      if (old.rows[0].status === 'cancelled' && status !== 'cancelled') {
        const invoiceIds = [id];
        if (old.rows[0].group_id) {
          const _invSibs = await client.query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [old.rows[0].group_id, bid, id]);
          for (const s of _invSibs.rows) invoiceIds.push(s.id);
        }
        await client.query(
          `UPDATE invoices SET status = 'draft', updated_at = NOW()
           WHERE booking_id = ANY($1::uuid[]) AND status = 'cancelled'`,
          [invoiceIds]
        ).catch(e => console.warn('[INVOICE RESTORE]', e.message));
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

      return { oldStatus: old.rows[0].status, affectedSiblingIds, depositRefunded, depRetentionReason, depositRestore, booking: old.rows[0], gcRefundForEmail, passRefundForEmail, netRefundCentsForEmail, gcPaidForRefundEmail };
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

      // Queue pro cancellation notification (mirrors public cancel + auto-cancel crons)
      try {
        await queryWithRLS(bid,
          `INSERT INTO notifications (business_id, booking_id, type, status) VALUES ($1, $2, 'email_cancellation_pro', 'queued')`,
          [bid, id]
        );
      } catch (e) { console.warn('[NOTIF] email_cancellation_pro queue error:', e.message); }
    }

    // Reset active waitlist offers when un-cancelling (cancelled → confirmed/pending_deposit)
    // Offers sent for the freed slot are no longer valid — reset to 'waiting' for re-offer later
    if (txResult.oldStatus === 'cancelled' && (status === 'confirmed' || status === 'pending_deposit')) {
      try {
        const bkTime = await queryWithRLS(bid,
          `SELECT start_at, end_at, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );
        if (bkTime.rows.length > 0) {
          const { start_at: bkStart, end_at: bkEnd, practitioner_id: bkPrac } = bkTime.rows[0];
          await queryWithRLS(bid,
            `UPDATE waitlist_entries SET status = 'waiting', offer_token = NULL,
              offer_booking_start = NULL, offer_booking_end = NULL,
              offer_sent_at = NULL, offer_expires_at = NULL, updated_at = NOW()
             WHERE business_id = $1 AND practitioner_id = $2 AND status = 'offered'
               AND offer_booking_start < $4 AND offer_booking_end > $3`,
            [bid, bkPrac, bkStart, bkEnd]
          );
        }
      } catch (e) { console.warn('[WAITLIST] Reset offers on un-cancel error:', e.message); }
    }

    // Send cancellation confirmation email to client (non-blocking, always send even if deposit refund email is also sent)
    if (status === 'cancelled') {
      try {
        const emailData = await queryWithRLS(bid,
          `SELECT b.start_at, b.end_at, b.client_id, b.group_id, b.public_token, b.custom_label, b.comment_client,
                  b.deposit_required, b.deposit_status, b.deposit_amount_cents, b.deposit_paid_at, b.deposit_payment_intent_id,
                  b.booked_price_cents, b.cancel_reason,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct, b.discount_pct,
                  c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  biz.name AS biz_name, biz.slug, biz.email AS biz_email,
                  biz.phone AS biz_phone, biz.address, biz.theme, biz.settings AS biz_settings, biz.plan AS biz_plan
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
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.discount_pct, b.end_at, b.practitioner_id, p.display_name AS practitioner_name FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id LEFT JOIN practitioners p ON p.id = b.practitioner_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [d.group_id, bid]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              // Apply last-minute discount to group service prices
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows;
            }
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const gcPaidForEmail = await getGcPaidCents(id);
          const { sendCancellationEmail } = require('../../services/email');
          sendCancellationEmail({
            // B2 fix: include net_refund_cents so email-cancel.js refund banner shows actual
            // amount refunded by Stripe (net of fees if policy='net'), matching the separate
            // sendDepositRefundEmail instead of contradicting it.
            booking: { start_at: d.start_at, end_at: groupEndAt || d.end_at, client_name: d.client_name, client_email: d.client_email, service_name: d.service_name, service_category: d.service_category, custom_label: d.custom_label, comment_client: d.comment_client, practitioner_name: d.practitioner_name, deposit_required: d.deposit_required, deposit_status: d.deposit_status, deposit_amount_cents: d.deposit_amount_cents, deposit_paid_at: d.deposit_paid_at, deposit_payment_intent_id: d.deposit_payment_intent_id, gc_paid_cents: gcPaidForEmail, gc_refunded_cents: txResult.gcRefundForEmail?.refunded || 0, pass_refunded: !!(txResult.passRefundForEmail?.refunded), net_refund_cents: txResult.netRefundCentsForEmail, promotion_label: d.promotion_label, promotion_discount_cents: d.promotion_discount_cents, promotion_discount_pct: d.promotion_discount_pct, service_price_cents: d.service_price_cents, booked_price_cents: d.booked_price_cents, discount_pct: d.discount_pct, duration_min: d.duration_min, cancel_reason: d.cancel_reason, deposit_retention_reason: txResult.depRetentionReason },
            business: { id: bid, name: d.biz_name, slug: d.slug, email: d.biz_email, phone: d.biz_phone, address: d.address, theme: d.theme, settings: d.biz_settings },
            groupServices
          }).catch(e => console.warn('[EMAIL] Cancellation email error:', e.message));

          // B#4 fix (staff cancel) : siblings multi-clients (parité routes publiques + crons)
          if (d.group_id) {
            try {
              const _sibsMcS = await queryWithRLS(bid,
                `SELECT b.id, b.start_at, b.end_at,
                        COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                        COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                        b.booked_price_cents, b.discount_pct,
                        b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                        b.custom_label, b.comment_client, b.cancel_reason,
                        b.deposit_required, b.deposit_status, b.deposit_amount_cents,
                        b.deposit_paid_at, b.deposit_payment_intent_id,
                        c.full_name AS client_name, c.email AS client_email,
                        CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                        s.category AS service_category,
                        p.display_name AS practitioner_name
                   FROM bookings b
                   LEFT JOIN clients c ON c.id = b.client_id
                   LEFT JOIN services s ON s.id = b.service_id
                   LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                   LEFT JOIN practitioners p ON p.id = b.practitioner_id
                  WHERE b.group_id = $1 AND b.business_id = $2 AND b.id != $3
                    AND c.email IS NOT NULL AND LOWER(c.email) != LOWER($4)`,
                [d.group_id, bid, id, d.client_email || '']
              );
              for (const _sibS of _sibsMcS.rows) {
                try {
                  const _sibGcS = await getGcPaidCents(_sibS.id);
                  const _sibGcRefS = await queryWithRLS(bid, `SELECT COALESCE(SUM(amount_cents), 0)::int AS amt FROM gift_card_transactions WHERE booking_id = $1 AND type = 'refund'`, [_sibS.id]);
                  const _sibPassRefS = await queryWithRLS(bid, `SELECT 1 FROM pass_transactions WHERE booking_id = $1 AND type = 'refund' LIMIT 1`, [_sibS.id]);
                  sendCancellationEmail({
                    booking: { start_at: _sibS.start_at, end_at: _sibS.end_at, client_name: _sibS.client_name, client_email: _sibS.client_email, service_name: _sibS.service_name, service_category: _sibS.service_category, custom_label: _sibS.custom_label, comment_client: _sibS.comment_client, practitioner_name: _sibS.practitioner_name, deposit_required: _sibS.deposit_required, deposit_status: _sibS.deposit_status, deposit_amount_cents: _sibS.deposit_amount_cents, deposit_paid_at: _sibS.deposit_paid_at, deposit_payment_intent_id: _sibS.deposit_payment_intent_id, gc_paid_cents: _sibGcS, gc_refunded_cents: _sibGcRefS.rows[0]?.amt || 0, pass_refunded: _sibPassRefS.rows.length > 0, net_refund_cents: txResult.netRefundCentsForEmail, deposit_retention_reason: txResult.depRetentionReason, service_price_cents: _sibS.service_price_cents, booked_price_cents: _sibS.booked_price_cents, discount_pct: _sibS.discount_pct, duration_min: _sibS.duration_min, promotion_label: _sibS.promotion_label, promotion_discount_cents: _sibS.promotion_discount_cents, promotion_discount_pct: _sibS.promotion_discount_pct, cancel_reason: _sibS.cancel_reason || 'Annulé par le salon' },
                    business: { id: bid, name: d.biz_name, slug: d.slug, email: d.biz_email, phone: d.biz_phone, address: d.address, theme: d.theme, settings: d.biz_settings },
                    groupServices
                  }).catch(e => console.warn('[EMAIL] Multi-client staff cancel sibling email error:', e.message));
                } catch (_sibErrS) { console.warn('[EMAIL] Multi-client staff cancel sibling error:', _sibErrS.message); }
              }
            } catch (_sibQueryErrS) { console.warn('[EMAIL] Multi-client staff cancel siblings query error:', _sibQueryErrS.message); }
          }
        }
      } catch (e) { console.warn('[EMAIL] Cancellation email fetch error:', e.message); }
    }

    // Send deposit refund email on auto-refund during cancellation (non-blocking)
    if (txResult.depositRefunded) {
      try {
        const emailData = await queryWithRLS(bid,
          `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.deposit_payment_intent_id, b.client_id, b.group_id,
                  b.booked_price_cents, b.discount_pct, b.comment_client,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                  c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  biz.name AS biz_name, biz.slug, biz.email AS biz_email,
                  biz.phone AS biz_phone, biz.address, biz.settings, biz.theme
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
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.discount_pct, b.end_at, b.practitioner_id, p.display_name AS practitioner_name FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id LEFT JOIN practitioners p ON p.id = b.practitioner_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [d.group_id, bid]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows;
            }
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const gcPaidRefund = await getGcPaidCents(id);
          const { sendDepositRefundEmail, sendDepositRefundProEmail } = require('../../services/email');
          // M2: net_refund_cents = what client actually receives back to bank (policy='net' deducts Stripe fees)
          // Falls back to deposit_amount_cents when policy='full' or no Stripe component (txResult.netRefundCentsForEmail null)
          const _refundBooking = { start_at: d.start_at, end_at: groupEndAt || d.end_at, deposit_amount_cents: d.deposit_amount_cents, deposit_payment_intent_id: d.deposit_payment_intent_id, gc_paid_cents: gcPaidRefund, net_refund_cents: txResult.netRefundCentsForEmail, gc_refunded_cents: txResult.gcPaidForRefundEmail || 0, client_name: d.client_name, client_email: d.client_email, client_phone: d.client_phone, comment_client: d.comment_client, service_name: d.service_name, service_category: d.service_category, practitioner_name: d.practitioner_name, promotion_label: d.promotion_label, promotion_discount_cents: d.promotion_discount_cents, promotion_discount_pct: d.promotion_discount_pct, service_price_cents: d.service_price_cents, booked_price_cents: d.booked_price_cents, discount_pct: d.discount_pct, duration_min: d.duration_min };
          sendDepositRefundEmail({
            booking: _refundBooking,
            business: { id: bid, name: d.biz_name, slug: d.slug, email: d.biz_email, phone: d.biz_phone, address: d.address, settings: d.settings, theme: d.theme },
            groupServices
          }).catch(e => console.warn('[EMAIL] Deposit refund email error:', e.message));
          sendDepositRefundProEmail({
            booking: _refundBooking,
            business: { id: bid, name: d.biz_name, email: d.biz_email, theme: d.theme }
          }).catch(e => console.warn('[EMAIL] Deposit refund pro email error:', e.message));
        }
      } catch (e) { console.warn('[EMAIL] Deposit refund email fetch error:', e.message); }
    }

    // Send deposit paid confirmation email when staff manually confirms a pending_deposit booking
    if (txResult.oldStatus === 'pending_deposit' && status === 'confirmed') {
      try {
        const emailData = await queryWithRLS(bid,
          `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.group_id, b.public_token,
                  b.booked_price_cents, b.discount_pct,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                  c.full_name AS client_name, c.email AS client_email,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  p.display_name AS practitioner_name,
                  biz.name AS business_name, biz.email AS business_email,
                  biz.phone AS business_phone,
                  biz.address AS business_address, biz.theme, biz.slug,
                  biz.settings AS business_settings
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
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, bk.discount_pct, bk.end_at, bk.practitioner_id, p.display_name AS practitioner_name
               FROM bookings bk LEFT JOIN services s ON s.id = bk.service_id
               LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
               LEFT JOIN practitioners p ON p.id = bk.practitioner_id
               WHERE bk.group_id = $1 AND bk.business_id = $2
               ORDER BY bk.group_order, bk.start_at`,
              [d.group_id, bid]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows;
              d.end_at = grp.rows[grp.rows.length - 1].end_at;
            }
          }
          d.gc_paid_cents = await getGcPaidCents(id);
          const { sendDepositPaidEmail } = require('../../services/email');
          sendDepositPaidEmail({
            booking: d,
            business: { id: bid, name: d.business_name, email: d.business_email, phone: d.business_phone, address: d.business_address, theme: d.theme, slug: d.slug, settings: d.business_settings },
            groupServices
          }).catch(e => console.warn('[EMAIL] Deposit paid email error:', e.message));
        }
      } catch (e) { console.warn('[EMAIL] Deposit paid email fetch error:', e.message); }
    }

    // Send deposit re-request email when restoring a cancelled booking with refunded deposit
    if (txResult.depositRestore === 'redeposit') {
      try {
        const emailData = await queryWithRLS(bid,
          `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.deposit_deadline, b.public_token, b.group_id,
                  b.booked_price_cents, b.discount_pct,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                  c.full_name AS client_name, c.email AS client_email,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  biz.name AS business_name, biz.email AS business_email, biz.phone AS business_phone, biz.address AS business_address,
                  biz.theme, biz.settings, biz.slug AS business_slug
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
          const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
          const payUrl = `${baseUrl}/api/public/deposit/${d.public_token}/pay`;
          const depositUrl = `${baseUrl}/deposit/${d.public_token}`;
          let groupServices = null;
          if (d.group_id) {
            const grp = await queryWithRLS(bid,
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, bk.discount_pct, bk.end_at, bk.practitioner_id, p.display_name AS practitioner_name
               FROM bookings bk LEFT JOIN services s ON s.id = bk.service_id
               LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
               LEFT JOIN practitioners p ON p.id = bk.practitioner_id
               WHERE bk.group_id = $1 AND bk.business_id = $2
               ORDER BY bk.group_order, bk.start_at`,
              [d.group_id, bid]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows; d.end_at = grp.rows[grp.rows.length - 1].end_at;
            }
          }
          const { sendDepositRequestEmail } = require('../../services/email');
          sendDepositRequestEmail({
            booking: { ...d, client_name: d.client_name, client_email: d.client_email, service_name: d.service_name, service_category: d.service_category },
            business: { id: bid, name: d.business_name, slug: d.business_slug, email: d.business_email, phone: d.business_phone, address: d.business_address, theme: d.theme, settings: d.settings },
            depositUrl,
            payUrl,
            groupServices
          }).catch(e => console.warn('[EMAIL] Deposit re-request email error:', e.message));
        }
      } catch (e) { console.warn('[EMAIL] Deposit re-request email fetch error:', e.message); }
    }

    // Send booking confirmation email when staff confirms/restores a booking
    if (['pending', 'modified_pending', 'cancelled', 'no_show'].includes(txResult.oldStatus) && status === 'confirmed' && !txResult.depositRestore) {
      try {
        const emailData = await queryWithRLS(bid,
          `SELECT b.start_at, b.end_at, b.group_id, b.public_token, b.comment_client, b.custom_label,
                  b.deposit_required, b.deposit_status, b.deposit_amount_cents, b.deposit_payment_intent_id,
                  b.booked_price_cents, b.discount_pct,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                  c.full_name AS client_name, c.email AS client_email,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  biz.name AS business_name, biz.email AS business_email,
                  biz.phone AS business_phone,
                  biz.address AS business_address, biz.theme, biz.settings
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
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, bk.discount_pct, bk.end_at, bk.practitioner_id, p.display_name AS practitioner_name
               FROM bookings bk LEFT JOIN services s ON s.id = bk.service_id
               LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
               LEFT JOIN practitioners p ON p.id = bk.practitioner_id
               WHERE bk.group_id = $1 AND bk.business_id = $2
               ORDER BY bk.group_order, bk.start_at`,
              [d.group_id, bid]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows;
              d.end_at = grp.rows[grp.rows.length - 1].end_at;
            }
          }
          const { sendBookingConfirmation } = require('../../services/email');
          sendBookingConfirmation({
            booking: {
              start_at: d.start_at, end_at: d.end_at,
              client_name: d.client_name, client_email: d.client_email,
              service_name: d.service_name, service_category: d.service_category, service_price_cents: d.service_price_cents, booked_price_cents: d.booked_price_cents, discount_pct: d.discount_pct, duration_min: d.duration_min, practitioner_name: d.practitioner_name,
              comment: d.comment_client, custom_label: d.custom_label,
              public_token: d.public_token,
              deposit_required: d.deposit_required, deposit_status: d.deposit_status, deposit_amount_cents: d.deposit_amount_cents, deposit_payment_intent_id: d.deposit_payment_intent_id,
              promotion_label: d.promotion_label, promotion_discount_cents: d.promotion_discount_cents, promotion_discount_pct: d.promotion_discount_pct
            },
            business: { id: bid, name: d.business_name, email: d.business_email, phone: d.business_phone, address: d.business_address, theme: d.theme, settings: d.settings },
            groupServices
          }).then(() => {
            // R1 fix: audit email_confirmation='sent' (parité avec booking-notifications.js:213)
            return queryWithRLS(bid, `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at) VALUES ($1, $2, 'email_confirmation', $3, 'sent', NOW())`, [bid, id, d.client_email]).catch(() => {});
          }).catch(e => console.warn('[EMAIL] Confirmation email error:', e.message));
        }
      } catch (e) { console.warn('[EMAIL] Confirmation email fetch error:', e.message); }
    }

    // ===== Schedule review request email when booking is completed =====
    if (status === 'completed') {
      try {
        const reviewData = await queryWithRLS(bid,
          `SELECT b.id, b.client_id, b.review_token,
                  c.full_name AS client_name, c.email AS client_email, SPLIT_PART(c.full_name, ' ', 1) AS first_name,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  p.display_name AS practitioner_name,
                  biz.name AS business_name, biz.email AS business_email,
                  biz.address, biz.theme, biz.settings
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        if (reviewData.rows.length > 0 && reviewData.rows[0].client_email) {
          const rd = reviewData.rows[0];
          const settings = rd.settings || {};
          if (settings.reviews_enabled) {
            const delayHours = settings.review_delay_hours ?? 24;
            // Generate review token if not already set
            let reviewToken = rd.review_token;
            if (!reviewToken) {
              const crypto = require('crypto');
              reviewToken = crypto.randomBytes(20).toString('hex');
              await queryWithRLS(bid,
                `UPDATE bookings SET review_token = $1 WHERE id = $2 AND business_id = $3`,
                [reviewToken, id, bid]
              );
            }
            // Queue review email via persistent DB notification (survives restarts)
            const delayMs = delayHours * 3600000;
            const delayUntil = new Date(Date.now() + delayMs).toISOString();
            await queryWithRLS(bid,
              `INSERT INTO notifications (business_id, booking_id, type, status, metadata)
               VALUES ($1, $2, 'email_post_rdv', 'queued', $3)`,
              [bid, id, JSON.stringify({ review_token: reviewToken, delay_until: delayUntil })]
            );
            console.log(`[REVIEW] Review email queued for booking ${id} (delay_until: ${delayUntil})`);
          }
        }
      } catch (e) { console.warn('[REVIEW] Review scheduling error:', e.message); }
    }

    broadcast(bid, 'booking_update', { action: 'status_changed', booking_id: id, status, old_status: txResult.oldStatus });
    // H-07 fix: invalidate minisite cache si slot libéré (cancelled/no_show change la dispo)
    try { if (['cancelled', 'no_show'].includes(status)) invalidateMinisiteCache(bid); } catch (_) {}
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

    res.json({ updated: true, status, deposit_restore: txResult.depositRestore || null });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/deposit-refund — Manual refund by pro
// UI: Booking detail → "Rembourser l'acompte" button
// ============================================================
router.patch('/:id/deposit-refund', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // All deposit-refund operations in a single transaction for atomicity
    const txResult = await transactionWithRLS(bid, async (client) => {
      const bk = await client.query(
        // BUG-FOR-UPDATE-OF fix: explicit OF b (both tables would be locked otherwise).
        // Parity with other SELECT+join+FOR UPDATE patterns in this file.
        // P1-07: SELECT b.disputed_at pour bloquer refund si contentieux Stripe ouvert.
        `SELECT b.deposit_required, b.deposit_status, b.deposit_amount_cents, b.deposit_payment_intent_id, b.status, b.practitioner_id, b.group_id, b.disputed_at, biz.settings AS biz_settings
           FROM bookings b JOIN businesses biz ON biz.id = b.business_id
          WHERE b.id = $1 AND b.business_id = $2 FOR UPDATE OF b`,
        [id, bid]
      );
      if (bk.rows.length === 0) return { error: 404, message: 'RDV introuvable' };

      // Practitioner scope: can only modify own bookings
      if (req.practitionerFilter && String(bk.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
        return { error: 403, message: 'Accès interdit' };
      }

      // P1-07: bloquer refund si dispute Stripe en cours (évite double-loss :
      // refund émis + dispute perdue par la suite = 2× la somme + fees Stripe).
      if (bk.rows[0].disputed_at) {
        return { error: 409, message: 'Impossible de rembourser : un litige Stripe est en cours sur ce paiement. Attendez la résolution (dashboard Stripe).' };
      }

      if (!bk.rows[0].deposit_required) return { error: 400, message: 'Pas d\'acompte sur ce RDV' };
      if (bk.rows[0].deposit_status === 'refunded') return { error: 400, message: 'Acompte déjà remboursé' };
      // Bug M10 fix: Only allow refund if deposit was actually paid
      if (bk.rows[0].deposit_status !== 'paid') return { error: 400, message: 'L\'acompte n\'a pas encore été payé — impossible de rembourser' };

      const REFUNDABLE = ['pending', 'confirmed', 'modified_pending', 'pending_deposit'];
      if (!REFUNDABLE.includes(bk.rows[0].status)) {
        return { error: 400, message: `Impossible de rembourser un RDV en statut "${bk.rows[0].status}"` };
      }

      // ===== Stripe refund: apply refund_policy like staff cancel / cron / public cancel =====
      // H1 fix: previously did unconditional full refund, ignoring business settings.refund_policy.
      let piId = bk.rows[0].deposit_payment_intent_id;
      let netRefundCentsManual = null;
      let gcPaidForRefundManual = 0;
      let depRetentionReasonManual = null;
      let finalDepStatusManual = 'refunded';
      if (piId && (piId.startsWith('pi_') || piId.startsWith('cs_'))) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return { error: 500, message: 'Stripe non configuré — remboursement impossible' };
        const stripe = require('stripe')(key);
        try {
          // Resolve cs_ checkout session to pi_ payment intent
          if (piId.startsWith('cs_')) {
            const session = await stripe.checkout.sessions.retrieve(piId);
            piId = session.payment_intent;
          }
          if (piId && piId.startsWith('pi_')) {
            const refundPolicyManual = bk.rows[0].biz_settings?.refund_policy || 'full';
            if (refundPolicyManual === 'net' && bk.rows[0].deposit_amount_cents) {
              const gcPaidManRes = await client.query(
                `SELECT COALESCE(SUM(amount_cents), 0) AS gc_paid_cents
                   FROM gift_card_transactions WHERE booking_id = $1 AND type = 'debit'`,
                [id]
              );
              gcPaidForRefundManual = parseInt(gcPaidManRes.rows[0]?.gc_paid_cents) || 0;
              const actualStripeCharge = Math.max(bk.rows[0].deposit_amount_cents - gcPaidForRefundManual, 0);
              // A#4 fix: real Stripe fee (Bancontact flat vs card %+flat). Fallback to estimate.
              const { resolveStripeFeeCents } = require('../../services/stripe-fee');
              const stripeFees = await resolveStripeFeeCents(stripe, piId, actualStripeCharge);
              netRefundCentsManual = Math.max(actualStripeCharge - stripeFees, 0);
              // B-04 fix: D-12 pattern parity — Stripe refund min = 50c. net<50 → retention + reset net=0
              // (avant: > 0 → Stripe rejette "Amount too small" → catch 500 au pro, flow cassé)
              if (netRefundCentsManual >= 50) {
                const { createRefund: _cr } = require('../../services/stripe-refund');
                await _cr(stripe, { payment_intent: piId, amount: netRefundCentsManual }, `staff-deposit-refund-net-${id}`);
                console.log(`[DEPOSIT REFUND] Net refund: ${netRefundCentsManual}c (fees ${stripeFees}c, gc ${gcPaidForRefundManual}c) for PI ${piId}`);
              } else {
                console.warn(`[DEPOSIT REFUND] netRefund=${netRefundCentsManual}c <50c Stripe min (fees ${stripeFees}c, charge ${actualStripeCharge}c) — deposit retained for PI ${piId}`);
                finalDepStatusManual = 'cancelled';
                depRetentionReasonManual = 'fees_exceed_charge';
                netRefundCentsManual = 0;
              }
            } else {
              const { createRefund: _cr } = require('../../services/stripe-refund');
              await _cr(stripe, { payment_intent: piId }, `staff-deposit-refund-full-${id}`);
            }
          }
        } catch (stripeErr) {
          if (stripeErr.code !== 'charge_already_refunded') {
            // P2-09: Sentry capture.
            const { reportError } = require('../../services/error-reporter');
            reportError(stripeErr, { tag: 'DEPOSIT_REFUND_MANUAL', bookingId: id, piId });
            return { error: 500, message: 'Erreur Stripe lors du remboursement' };
          }
        }
      }

      // Refund gift card debits
      await refundGiftCardForBooking(id, client);
      await refundPassForBooking(id, client).catch(e => console.warn('[PASS REFUND]', e.message));

      // N25: cancel_reason reflète l'issue réelle (refund vs retention)
      const cancelReasonManual = finalDepStatusManual === 'cancelled'
        ? `Acompte retenu (${depRetentionReasonManual || 'frais supérieurs au montant'})`
        : 'Acompte remboursé manuellement';
      await client.query(
        `UPDATE bookings SET deposit_status = $3, status = 'cancelled', cancel_reason = $4, updated_at = NOW()
         WHERE id = $1 AND business_id = $2`,
        [id, bid, finalDepStatusManual, cancelReasonManual]
      );

      // Bug M14 fix: Propagate cancellation to group siblings
      let affectedSiblingIds = [];
      if (bk.rows[0].group_id) {
        affectedSiblingIds = await propagateGroupStatus(client, {
          groupId: bk.rows[0].group_id,
          bid,
          excludeId: id,
          status: 'cancelled',
          cancelReason: `${cancelReasonManual} (groupe)`
        });

        // Also update sibling deposits — use same finalDepStatus (H1 fix: respect net/fees retention)
        await client.query(
          `UPDATE bookings SET
            deposit_status = CASE WHEN deposit_status = 'paid' THEN $4 ELSE deposit_status END,
            updated_at = NOW()
           WHERE group_id = $1 AND business_id = $2 AND id != $3 AND deposit_required = true
             AND deposit_status NOT IN ('refunded', 'cancelled')`,
          [bk.rows[0].group_id, bid, id, finalDepStatusManual]
        );
        // Refund GC debits for siblings too
        const sibIds = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`,
          [bk.rows[0].group_id, bid, id]
        );
        for (const sib of sibIds.rows) { await refundGiftCardForBooking(sib.id, client); }
        for (const sib of sibIds.rows) { await refundPassForBooking(sib.id, client).catch(e => console.warn('[PASS REFUND]', e.message)); }
      }

      // Bug B5 fix: Include old_data in deposit-refund audit log
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'deposit_refund', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ status: bk.rows[0].status, deposit_status: bk.rows[0].deposit_status, deposit_amount_cents: bk.rows[0].deposit_amount_cents }),
         JSON.stringify({ deposit_status: finalDepStatusManual, status: 'cancelled', amount_cents: bk.rows[0].deposit_amount_cents, net_refund_cents: netRefundCentsManual, retention_reason: depRetentionReasonManual })]
      );

      // Void draft/sent invoices (mirrors staff cancel)
      const voidIds = [id, ...affectedSiblingIds];
      await client.query(
        `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
         WHERE booking_id = ANY($1::uuid[]) AND status IN ('draft', 'sent')`,
        [voidIds]
      );

      // Decrement promo usage (mirrors staff cancel)
      const { decrementPromoUsage } = require('../../routes/public/helpers');
      await decrementPromoUsage(id, client).catch(e => console.warn('[PROMO DEC]', e.message));

      return { ok: true, affectedSiblingIds, netRefundCentsManual, gcPaidForRefundManual, depRetentionReasonManual, finalDepStatusManual };
    });

    if (txResult.error) {
      return res.status(txResult.error).json({ error: txResult.message });
    }

    broadcast(bid, 'booking_update', { action: 'deposit_refunded', booking_id: id, status: 'cancelled' });
    // H-07 fix: invalidate minisite cache (slot libéré par deposit-refund = cancel)
    try { invalidateMinisiteCache(bid); } catch (_) {}
    calSyncDelete(bid, id).catch(e => console.warn('[CAL_SYNC] Delete error:', e.message));
    // BUG-DEPREFUND-PRO fix: queue email_cancellation_pro (parity with 4 other cancel paths).
    // The direct sendDepositRefundProEmail below covers the "refund" angle, but the pro misses
    // the structured "cancellation" notification (with full RDV context) that /cancel paths queue.
    try {
      await queryWithRLS(bid,
        `INSERT INTO notifications (business_id, booking_id, type, status) VALUES ($1, $2, 'email_cancellation_pro', 'queued')`,
        [bid, id]
      );
    } catch (_) { /* non-critical */ }
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
        `SELECT b.start_at, b.end_at, b.deposit_amount_cents, b.deposit_payment_intent_id, b.client_id, b.group_id,
                b.booked_price_cents, b.discount_pct, b.comment_client,
                b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                s.category AS service_category,
                COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                p.display_name AS practitioner_name,
                biz.name AS biz_name, biz.slug, biz.email AS biz_email,
                biz.phone AS biz_phone, biz.address, biz.settings, biz.theme
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
            `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at, b.practitioner_id, p.display_name AS practitioner_name FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id LEFT JOIN practitioners p ON p.id = b.practitioner_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
            [d.group_id, bid]
          );
          if (grp.rows.length > 1) {
            const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
            if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
            groupServices = grp.rows;
          }
        }
        const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
        const gcPaidManual = await getGcPaidCents(id);
        // M4 fix: if retention applies (fees>=charge / stripe fail / no key), send cancellation
        // email (with retention banner expliquant pourquoi rien n'a été remboursé) AU LIEU du
        // refund email qui afficherait "0€ remboursé" sans contexte.
        const _manualRefBk = { start_at: d.start_at, end_at: groupEndAt || d.end_at, deposit_required: true, deposit_status: txResult.finalDepStatusManual, deposit_paid_at: new Date().toISOString(), deposit_amount_cents: d.deposit_amount_cents, deposit_payment_intent_id: d.deposit_payment_intent_id, gc_paid_cents: gcPaidManual, net_refund_cents: txResult.netRefundCentsManual, gc_refunded_cents: txResult.gcPaidForRefundManual || 0, deposit_retention_reason: txResult.depRetentionReasonManual, client_name: d.client_name, client_email: d.client_email, client_phone: d.client_phone, comment_client: d.comment_client, service_name: d.service_name, service_category: d.service_category, service_price_cents: d.service_price_cents, booked_price_cents: d.booked_price_cents, discount_pct: d.discount_pct, duration_min: d.duration_min, practitioner_name: d.practitioner_name, promotion_label: d.promotion_label, promotion_discount_cents: d.promotion_discount_cents, promotion_discount_pct: d.promotion_discount_pct, cancel_reason: txResult.finalDepStatusManual === 'cancelled' ? `Acompte retenu (${txResult.depRetentionReasonManual || 'frais supérieurs au montant'})` : 'Acompte remboursé manuellement' };
        if (txResult.finalDepStatusManual === 'cancelled' && txResult.depRetentionReasonManual) {
          // Retention : pas d'argent remboursé — envoyer cancellation email avec banner explicatif
          const { sendCancellationEmail } = require('../../services/email');
          sendCancellationEmail({
            booking: _manualRefBk,
            business: { id: bid, name: d.biz_name, slug: d.slug, email: d.biz_email, phone: d.biz_phone, address: d.address, settings: d.settings, theme: d.theme },
            groupServices
          }).catch(e => console.warn('[EMAIL] Manual retention cancel email error:', e.message));
        } else {
          const { sendDepositRefundEmail, sendDepositRefundProEmail } = require('../../services/email');
          sendDepositRefundEmail({
            booking: _manualRefBk,
            business: { id: bid, name: d.biz_name, slug: d.slug, email: d.biz_email, phone: d.biz_phone, address: d.address, settings: d.settings, theme: d.theme },
            groupServices
          }).catch(e => console.warn('[EMAIL] Deposit refund email error:', e.message));
          sendDepositRefundProEmail({
            booking: _manualRefBk,
            business: { id: bid, name: d.biz_name, email: d.biz_email, theme: d.theme }
          }).catch(e => console.warn('[EMAIL] Deposit refund pro email error:', e.message));
        }

        // B#4 fix (4e route — staff deposit-refund) : ce endpoint cancel aussi
        // le booking (status='cancelled' + propagateGroupStatus). Les siblings
        // multi-clients doivent recevoir un email cancel (pas le refund email —
        // seul le primary reçoit le refund sur son compte). Parité avec /cancel
        // public + staff cancel + crons.
        if (d.group_id) {
          try {
            const _sibsMcD = await queryWithRLS(bid,
              `SELECT b.id, b.start_at, b.end_at,
                      COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                      COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                      b.booked_price_cents, b.discount_pct,
                      b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                      b.custom_label, b.comment_client, b.cancel_reason,
                      b.deposit_required, b.deposit_status, b.deposit_amount_cents,
                      b.deposit_paid_at, b.deposit_payment_intent_id,
                      c.full_name AS client_name, c.email AS client_email,
                      CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                      s.category AS service_category,
                      p.display_name AS practitioner_name
                 FROM bookings b
                 LEFT JOIN clients c ON c.id = b.client_id
                 LEFT JOIN services s ON s.id = b.service_id
                 LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                 LEFT JOIN practitioners p ON p.id = b.practitioner_id
                WHERE b.group_id = $1 AND b.business_id = $2 AND b.id != $3
                  AND c.email IS NOT NULL AND LOWER(c.email) != LOWER($4)`,
              [d.group_id, bid, id, d.client_email || '']
            );
            const { sendCancellationEmail: _sendCancelD } = require('../../services/email');
            for (const _sibD of _sibsMcD.rows) {
              try {
                const _sibGcD = await getGcPaidCents(_sibD.id);
                const _sibGcRefD = await queryWithRLS(bid, `SELECT COALESCE(SUM(amount_cents), 0)::int AS amt FROM gift_card_transactions WHERE booking_id = $1 AND type = 'refund'`, [_sibD.id]);
                const _sibPassRefD = await queryWithRLS(bid, `SELECT 1 FROM pass_transactions WHERE booking_id = $1 AND type = 'refund' LIMIT 1`, [_sibD.id]);
                _sendCancelD({
                  booking: { start_at: _sibD.start_at, end_at: _sibD.end_at, client_name: _sibD.client_name, client_email: _sibD.client_email, service_name: _sibD.service_name, service_category: _sibD.service_category, custom_label: _sibD.custom_label, comment_client: _sibD.comment_client, practitioner_name: _sibD.practitioner_name, deposit_required: _sibD.deposit_required, deposit_status: _sibD.deposit_status, deposit_amount_cents: _sibD.deposit_amount_cents, deposit_paid_at: _sibD.deposit_paid_at, deposit_payment_intent_id: _sibD.deposit_payment_intent_id, gc_paid_cents: _sibGcD, gc_refunded_cents: _sibGcRefD.rows[0]?.amt || 0, pass_refunded: _sibPassRefD.rows.length > 0, net_refund_cents: txResult.netRefundCentsManual, deposit_retention_reason: txResult.depRetentionReasonManual, service_price_cents: _sibD.service_price_cents, booked_price_cents: _sibD.booked_price_cents, discount_pct: _sibD.discount_pct, duration_min: _sibD.duration_min, promotion_label: _sibD.promotion_label, promotion_discount_cents: _sibD.promotion_discount_cents, promotion_discount_pct: _sibD.promotion_discount_pct, cancel_reason: _sibD.cancel_reason || 'Acompte remboursé — RDV annulé' },
                  business: { id: bid, name: d.biz_name, slug: d.slug, email: d.biz_email, phone: d.biz_phone, address: d.address, settings: d.settings, theme: d.theme },
                  groupServices
                }).catch(e => console.warn('[EMAIL] Multi-client deposit-refund sibling cancel error:', e.message));
              } catch (_sibErrD) { console.warn('[EMAIL] Multi-client deposit-refund sibling error:', _sibErrD.message); }
            }
          } catch (_sibQueryErrD) { console.warn('[EMAIL] Multi-client deposit-refund siblings query error:', _sibQueryErrD.message); }
        }
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

    res.json({ updated: true, deposit_status: txResult.finalDepStatusManual || 'refunded' });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/bookings/:id/waive-deposit
// Confirm booking WITHOUT deposit — sets deposit_status='waived'
// Sends a clean confirmation email with ZERO deposit mention
// UI: Calendar → event detail → "Confirmer sans acompte"
// ============================================================
router.patch('/:id/waive-deposit', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const txResult = await transactionWithRLS(bid, async (client) => {
      const bk = await client.query(
        `SELECT b.id, b.status, b.deposit_status, b.deposit_amount_cents,
                b.start_at, b.end_at, b.group_id, b.practitioner_id, b.public_token,
                b.comment_client, b.custom_label, b.service_variant_id,
                b.booked_price_cents, b.discount_pct,
                b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                c.full_name AS client_name, c.email AS client_email,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                s.category AS service_category,
                COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                p.display_name AS practitioner_name,
                biz.name AS business_name, biz.email AS business_email,
                biz.address AS business_address, biz.phone AS business_phone,
                biz.theme, biz.settings
         FROM bookings b
         LEFT JOIN clients c ON c.id = b.client_id
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN practitioners p ON p.id = b.practitioner_id
         JOIN businesses biz ON biz.id = b.business_id
         WHERE b.id = $1 AND b.business_id = $2 FOR UPDATE OF b`,
        [id, bid]
      );
      if (bk.rows.length === 0) return { error: 404, message: 'RDV introuvable' };
      const b = bk.rows[0];

      // Practitioner scope
      if (req.practitionerFilter && String(b.practitioner_id) !== String(req.practitionerFilter)) {
        return { error: 403, message: 'Accès interdit' };
      }

      if (b.status !== 'pending_deposit') {
        return { error: 400, message: 'Ce RDV n\'est pas en attente d\'acompte' };
      }
      if (b.deposit_status !== 'pending') {
        return { error: 400, message: 'L\'acompte n\'est plus en attente' };
      }

      // Waive: confirm without payment
      await client.query(
        `UPDATE bookings SET status = 'confirmed', deposit_status = 'waived',
          deposit_deadline = NULL, updated_at = NOW()
         WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );

      // Group siblings: also confirm + waive deposit fields
      let affectedSiblingIds = [];
      if (b.group_id) {
        affectedSiblingIds = await propagateGroupStatus(client, {
          groupId: b.group_id, bid, excludeId: id,
          status: 'confirmed', cancelReason: null
        });
        // M5+M8: propagate deposit field changes to affected siblings only
        if (affectedSiblingIds.length > 0) {
          await client.query(
            `UPDATE bookings SET deposit_status = 'waived', deposit_deadline = NULL
             WHERE id = ANY($1::uuid[]) AND business_id = $2`,
            [affectedSiblingIds, bid]
          );
        }
      }

      // Audit log
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'waive_deposit', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ status: 'pending_deposit', deposit_status: 'pending', deposit_amount_cents: b.deposit_amount_cents }),
         JSON.stringify({ status: 'confirmed', deposit_status: 'waived' })]
      );

      return { ok: true, booking: b, affectedSiblingIds };
    });

    if (txResult.error) return res.status(txResult.error).json({ error: txResult.message });

    broadcast(bid, 'booking_update', { action: 'waive_deposit', booking_id: id, status: 'confirmed' });
    calSyncPush(bid, id).catch(e => console.warn('[CAL_SYNC] Push error:', e.message));

    // M6: SSE + calSync for affected siblings
    for (const sibId of (txResult.affectedSiblingIds || [])) {
      broadcast(bid, 'booking_update', { action: 'waive_deposit', booking_id: sibId, status: 'confirmed' });
      calSyncPush(bid, sibId).catch(e => console.warn('[CAL_SYNC] Sibling push error:', e.message));
    }

    // Send clean confirmation email (ZERO deposit mention)
    const b = txResult.booking;
    if (b.client_email) {
      try {
        let groupServices = null;
        if (b.group_id) {
          const grp = await queryWithRLS(bid,
            `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents, bk.end_at, bk.practitioner_id, p.display_name AS practitioner_name
             FROM bookings bk LEFT JOIN services s ON s.id = bk.service_id
             LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
             LEFT JOIN practitioners p ON p.id = bk.practitioner_id
             WHERE bk.group_id = $1 AND bk.business_id = $2
             ORDER BY bk.group_order, bk.start_at`,
            [b.group_id, bid]
          );
          if (grp.rows.length > 1) {
            const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
            if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
            groupServices = grp.rows;
            b.end_at = grp.rows[grp.rows.length - 1].end_at;
          }
        }
        const { sendBookingConfirmation } = require('../../services/email');
        await sendBookingConfirmation({
          booking: {
            start_at: b.start_at, end_at: b.end_at,
            client_name: b.client_name, client_email: b.client_email,
            service_name: b.service_name, service_category: b.service_category, service_price_cents: b.service_price_cents, booked_price_cents: b.booked_price_cents, discount_pct: b.discount_pct, duration_min: b.duration_min, practitioner_name: b.practitioner_name,
            comment: b.comment_client, custom_label: b.custom_label,
            public_token: b.public_token,
            promotion_label: b.promotion_label, promotion_discount_cents: b.promotion_discount_cents, promotion_discount_pct: b.promotion_discount_pct
          },
          business: { id: bid, name: b.business_name, email: b.business_email, address: b.business_address, phone: b.business_phone, theme: b.theme, settings: b.settings },
          groupServices
        });
        // R1 fix: audit email_confirmation='sent' après waive-deposit send
        try {
          await queryWithRLS(bid, `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at) VALUES ($1, $2, 'email_confirmation', $3, 'sent', NOW())`, [bid, id, b.client_email]);
        } catch (_) { /* audit non-critique */ }
      } catch (emailErr) {
        console.error('[WAIVE_DEPOSIT] Confirmation email error:', emailErr.message);
      }
    }

    res.json({ updated: true, status: 'confirmed', deposit_status: 'waived' });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/bookings/:id/send-deposit-request
// Send deposit request notification via email, SMS, or both
// Accepts { channels: ['email','sms'] } or legacy { channel: 'email' }
// UI: Quick-create post-creation panel + Detail modal deposit banner
// ============================================================
router.post('/:id/send-deposit-request', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    // Accept both legacy { channel } and new { channels } format
    let channels = req.body.channels;
    if (!channels && req.body.channel) channels = [req.body.channel];
    if (!Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({ error: 'channels requis (["email"], ["sms"], ou ["email","sms"])' });
    }
    channels = [...new Set(channels.filter(c => ['email', 'sms'].includes(c)))];
    if (channels.length === 0) {
      return res.status(400).json({ error: 'Channel doit être "sms" ou "email"' });
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // 1. Fetch booking + client + business + service
    const bkResult = await queryWithRLS(bid, `
      SELECT b.id, b.status, b.deposit_required, b.deposit_status,
             b.deposit_amount_cents, b.deposit_deadline, b.public_token,
             b.deposit_requested_at, b.deposit_request_count,
             b.start_at, b.end_at, b.practitioner_id, b.group_id,
             b.booked_price_cents, b.discount_pct,
                b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
             c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
             CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
             s.category AS service_category,
             COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
             COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
             p.display_name AS practitioner_name,
             biz.name AS business_name, biz.email AS business_email,
             biz.phone AS business_phone, biz.address AS business_address, biz.theme, biz.plan, biz.settings
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
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // 2. Validate booking is pending_deposit
    if (bk.status !== 'pending_deposit' || !bk.deposit_required) {
      return res.status(400).json({ error: 'Ce RDV ne nécessite pas d\'acompte' });
    }
    if (bk.deposit_status !== 'pending') {
      return res.status(400).json({ error: 'L\'acompte n\'est plus en attente' });
    }

    // 3. Time guard: don't allow sending if RDV is less than 2h away
    const hoursUntilRdv = (new Date(bk.start_at).getTime() - Date.now()) / 3600000;
    if (hoursUntilRdv < 2) {
      return res.status(400).json({
        error: 'Trop proche du RDV pour envoyer une demande d\'acompte (moins de 2h avant).'
      });
    }

    // 4. Max resend guard: max 3 manual resends
    const currentCount = bk.deposit_request_count || 0;
    if (currentCount >= 3) {
      return res.status(429).json({
        error: 'Maximum de 3 envois atteint. Contactez le client directement.'
      });
    }

    // 5. Validate client contacts per channel & filter out invalid ones
    const validChannels = [];
    const skipped = [];
    for (const ch of channels) {
      if (ch === 'email' && !bk.client_email) { skipped.push('email (pas d\'adresse email)'); continue; }
      if (ch === 'sms' && !bk.client_phone) { skipped.push('sms (pas de numéro)'); continue; }
      if (ch === 'sms' && bk.plan === 'free') { skipped.push('sms (plan Pro requis)'); continue; }
      validChannels.push(ch);
    }
    if (validChannels.length === 0) {
      return res.status(400).json({ error: 'Impossible d\'envoyer: ' + skipped.join(', ') });
    }

    // 6. Anti-spam: min 30 min per channel
    for (const ch of [...validChannels]) {
      const notifType = ch === 'sms' ? 'sms_deposit_request' : 'email_deposit_request';
      const lastSent = await queryWithRLS(bid, `
        SELECT sent_at FROM notifications
        WHERE booking_id = $1 AND business_id = $2 AND type = $3 AND status = 'sent'
        ORDER BY sent_at DESC LIMIT 1
      `, [id, bid, notifType]);
      if (lastSent.rows.length > 0) {
        const minSince = (Date.now() - new Date(lastSent.rows[0].sent_at).getTime()) / 60000;
        if (minSince < 30) {
          validChannels.splice(validChannels.indexOf(ch), 1);
          skipped.push(`${ch} (réessayez dans ${Math.ceil(30 - minSince)} min)`);
        }
      }
    }
    if (validChannels.length === 0) {
      return res.status(429).json({ error: 'Déjà envoyé récemment: ' + skipped.join(', ') });
    }

    // 7. Build deposit URL
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const depositUrl = `${baseUrl}/deposit/${bk.public_token}`;

    // 8. Increment counter once for the whole batch
    const incResult = await queryWithRLS(bid,
      `UPDATE bookings SET deposit_payment_url = $1,
        deposit_request_count = COALESCE(deposit_request_count, 0) + 1,
        deposit_requested_at = COALESCE(deposit_requested_at, NOW())
       WHERE id = $2 AND business_id = $3
         AND status = 'pending_deposit' AND deposit_required = true AND deposit_status = 'pending'
         AND COALESCE(deposit_request_count, 0) < 3
       RETURNING deposit_request_count`,
      [depositUrl, id, bid]
    );
    if (incResult.rows.length === 0) {
      return res.status(429).json({ error: 'Maximum de 3 envois atteint ou le statut a changé. Actualisez la page.' });
    }

    // 9. Prepare group services (for email) once
    let groupServices = null;
    if (validChannels.includes('email') && bk.group_id) {
      const grp = await queryWithRLS(bid,
        `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at, b.practitioner_id, p.display_name AS practitioner_name
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         LEFT JOIN practitioners p ON p.id = b.practitioner_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, bid]
      );
      if (grp.rows.length > 1) {
        const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
        if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
        groupServices = grp.rows;
      }
    }
    if (groupServices) bk.end_at = groupServices[groupServices.length - 1].end_at;

    // 10. Send all channels in parallel
    const results = {};
    const promises = validChannels.map(async (ch) => {
      try {
        if (ch === 'email') {
          const { sendDepositRequestEmail } = require('../../services/email');
          const payUrl = `${baseUrl}/api/public/deposit/${bk.public_token}/pay`;
          const r = await sendDepositRequestEmail({
            booking: bk,
            business: { id: bid, name: bk.business_name, email: bk.business_email, phone: bk.business_phone, address: bk.business_address, theme: bk.theme, settings: bk.settings },
            depositUrl, payUrl, groupServices
          });
          results[ch] = r;
        } else {
          const { sendSMS } = require('../../services/sms');
          const amtStr = ((bk.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
          const dateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', {
            timeZone: 'Europe/Brussels', day: 'numeric', month: 'short'
          });
          const _timeStr = new Date(bk.start_at).toLocaleTimeString('fr-BE', {
            timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
          });
          const body = `${bk.business_name} — Acompte ${amtStr}€ pour "${bk.service_name}" le ${dateStr} à ${_timeStr}. Payez : ${depositUrl}`;
          const r = await sendSMS({ to: bk.client_phone, body, businessId: bid, clientId: bk.client_id });
          results[ch] = r;
        }
      } catch (e) {
        results[ch] = { success: false, error: e.message };
      }
    });
    await Promise.all(promises);

    // 11. Log notifications for each channel
    const sent = [];
    const failed = [];
    for (const ch of validChannels) {
      const r = results[ch];
      const status = r?.success ? 'sent' : 'failed';
      const provider = ch === 'sms' ? 'twilio' : 'brevo';
      const providerId = r?.messageId || r?.sid || null;
      const notifType = ch === 'sms' ? 'sms_deposit_request' : 'email_deposit_request';
      await queryWithRLS(bid, `
        INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status, provider, provider_message_id, error, sent_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${status === 'sent' ? 'NOW()' : 'NULL'})
      `, [bid, id, notifType, bk.client_email || null, bk.client_phone || null, status, provider, providerId, r?.error || null]);
      if (r?.success) sent.push(ch);
      else failed.push(ch);
    }

    // 12. If ALL channels failed, rollback counter
    if (sent.length === 0) {
      await queryWithRLS(bid,
        `UPDATE bookings SET
          deposit_request_count = GREATEST(COALESCE(deposit_request_count, 1) - 1, 0),
          deposit_requested_at = CASE WHEN COALESCE(deposit_request_count, 1) <= 1 THEN NULL ELSE deposit_requested_at END
         WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );
      return res.status(500).json({ error: 'Envoi échoué: ' + failed.map(c => c + ' — ' + (results[c]?.error || 'erreur')).join('; ') });
    }

    // Build response summary
    const sentLabel = sent.map(c => c === 'sms' ? 'SMS' : 'email').join(' + ');
    const response = { sent: true, channels: sent, label: sentLabel, deposit_url: depositUrl, request_count: incResult.rows[0].deposit_request_count };
    if (failed.length > 0) response.failed = failed;
    if (skipped.length > 0) response.skipped = skipped;
    res.json(response);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/bookings/:id/require-deposit
// Retroactively require a deposit on an already-confirmed booking
// UI: Calendar → event detail → "Exiger un acompte"
// ============================================================
router.post('/:id/require-deposit', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { amount_cents, deadline_hours } = req.body;
    if (!amount_cents || amount_cents <= 0) return res.status(400).json({ error: 'Montant invalide' });

    const txResult = await transactionWithRLS(bid, async (client) => {
      // Fetch booking + client + business info for email
      const bk = await client.query(
        `SELECT b.id, b.status, b.deposit_required, b.deposit_status, b.start_at, b.end_at,
                b.group_id, b.practitioner_id, b.public_token, b.service_id, b.service_variant_id,
                b.booked_price_cents, b.discount_pct,
                b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                s.category AS service_category,
                COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                p.display_name AS practitioner_name,
                biz.name AS business_name, biz.email AS business_email,
                biz.phone AS business_phone, biz.address AS business_address, biz.theme, biz.settings
         FROM bookings b
         LEFT JOIN clients c ON c.id = b.client_id
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN practitioners p ON p.id = b.practitioner_id
         JOIN businesses biz ON biz.id = b.business_id
         WHERE b.id = $1 AND b.business_id = $2 FOR UPDATE OF b`,
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

      // Time guard: don't allow if RDV is within cancel_deadline_hours
      const bizCancelH = b.settings?.cancel_deadline_hours ?? 24;
      const rdvHoursAway = (new Date(b.start_at).getTime() - Date.now()) / 3600000;
      if (rdvHoursAway < bizCancelH) {
        return { error: 400, message: `Trop proche du RDV pour exiger un acompte (moins de ${bizCancelH}h avant).` };
      }

      // Calculate deadline: NOW + deadline_hours (from frontend panel), capped at 2h before RDV
      const dlH = parseInt(deadline_hours) || 48;
      let deadline = new Date(Date.now() + dlH * 3600000);
      const minBefore = new Date(new Date(b.start_at).getTime() - 2 * 3600000);
      if (minBefore.getTime() > Date.now() && minBefore < deadline) deadline = minBefore;
      if (deadline.getTime() < Date.now() + 5 * 60000) deadline = new Date(Date.now() + 5 * 60000);

      // Build deposit URL
      const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
      const depositUrl = `${baseUrl}/deposit/${b.public_token}`;

      // Determine if we can auto-send the email
      const canSendEmail = !!b.client_email;

      await client.query(
        `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
          deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
          deposit_paid_at = NULL, deposit_payment_intent_id = NULL,
          deposit_payment_url = $3,
          deposit_requested_at = ${canSendEmail ? 'NOW()' : 'NULL'},
          deposit_request_count = ${canSendEmail ? '1' : '0'},
          deposit_reminder_sent = false,
          updated_at = NOW()
         WHERE id = $4 AND business_id = $5`,
        [amount_cents, deadline.toISOString(), depositUrl, id, bid]
      );

      // Group siblings: also set pending_deposit status + deposit fields
      let affectedSiblingIds = [];
      if (b.group_id) {
        affectedSiblingIds = await propagateGroupStatus(client, {
          groupId: b.group_id,
          bid,
          excludeId: id,
          status: 'pending_deposit',
          cancelReason: null
        });
        // Propagate deposit fields to affected siblings only
        if (affectedSiblingIds.length > 0) {
          await client.query(
            `UPDATE bookings SET deposit_required = true, deposit_status = 'pending',
              deposit_deadline = $1, deposit_amount_cents = $2,
              deposit_paid_at = NULL, deposit_payment_intent_id = NULL, deposit_reminder_sent = false
             WHERE id = ANY($3::uuid[]) AND business_id = $4`,
            [deadline.toISOString(), amount_cents, affectedSiblingIds, bid]
          );
        }
      }

      // Audit log
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'require_deposit', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ status: b.status, deposit_required: false }),
         JSON.stringify({ status: 'pending_deposit', deposit_required: true, deposit_amount_cents: amount_cents, deposit_deadline: deadline.toISOString() })]
      );

      return { ok: true, booking: b, depositUrl, deadline, canSendEmail, affectedSiblingIds };
    });

    if (txResult.error) return res.status(txResult.error).json({ error: txResult.message });

    // Auto-send deposit request email after transaction commits
    let emailSent = false;
    if (txResult.canSendEmail) {
      try {
        const b = txResult.booking;
        const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
        const payUrl = `${baseUrl}/api/public/deposit/${b.public_token}/pay`;

        // Fetch group services if applicable
        let groupServices = null;
        if (b.group_id) {
          const grp = await queryWithRLS(bid,
            `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents, b2.end_at, b2.practitioner_id, p.display_name AS practitioner_name
             FROM bookings b2 LEFT JOIN services s ON s.id = b2.service_id
             LEFT JOIN service_variants sv ON sv.id = b2.service_variant_id
             LEFT JOIN practitioners p ON p.id = b2.practitioner_id
             WHERE b2.group_id = $1 AND b2.business_id = $2
             ORDER BY b2.group_order, b2.start_at`,
            [b.group_id, bid]
          );
          if (grp.rows.length > 1) {
            const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
            if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
            groupServices = grp.rows;
          }
        }

        // Override end_at for group bookings
        const bookingForEmail = { ...b, deposit_amount_cents: amount_cents, deposit_deadline: txResult.deadline.toISOString() };
        if (groupServices) bookingForEmail.end_at = groupServices[groupServices.length - 1].end_at;

        const { sendDepositRequestEmail } = require('../../services/email');
        const sendResult = await sendDepositRequestEmail({
          booking: bookingForEmail,
          business: { id: bid, name: b.business_name, email: b.business_email, phone: b.business_phone, address: b.business_address, theme: b.theme, settings: b.settings },
          depositUrl: txResult.depositUrl,
          payUrl,
          groupServices
        });

        if (sendResult.success) {
          emailSent = true;
          // Log notification
          await queryWithRLS(bid, `
            INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, provider, provider_message_id, sent_at)
            VALUES ($1, $2, 'email_deposit_request', $3, 'sent', 'brevo', $4, NOW())
          `, [bid, id, b.client_email, sendResult.messageId || null]);
        } else {
          console.warn(`[REQUIRE_DEPOSIT] Auto-send email failed for booking ${id}:`, sendResult.error);
          // Rollback counter since email failed
          await queryWithRLS(bid, `UPDATE bookings SET deposit_requested_at = NULL, deposit_request_count = 0 WHERE id = $1 AND business_id = $2`, [id, bid]);
        }
      } catch (emailErr) {
        console.warn(`[REQUIRE_DEPOSIT] Auto-send email error for booking ${id}:`, emailErr.message);
        // Rollback counter since email failed
        await queryWithRLS(bid, `UPDATE bookings SET deposit_requested_at = NULL, deposit_request_count = 0 WHERE id = $1 AND business_id = $2`, [id, bid]);
      }
    }

    broadcast(bid, 'booking_update', { action: 'require_deposit', booking_id: id, status: 'pending_deposit' });
    calSyncPush(bid, id).catch(e => console.warn('[CAL_SYNC] Push error:', e.message));

    // M6: SSE + calSync for affected siblings
    for (const sibId of (txResult.affectedSiblingIds || [])) {
      broadcast(bid, 'booking_update', { action: 'require_deposit', booking_id: sibId, status: 'pending_deposit' });
      calSyncPush(bid, sibId).catch(e => console.warn('[CAL_SYNC] Sibling push error:', e.message));
    }

    res.json({ updated: true, status: 'pending_deposit', email_sent: emailSent });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/bookings/:id — Permanently delete a cancelled/no-show booking
// UI: Calendar → event detail → "Supprimer définitivement" (only for cancelled/no_show)
// ============================================================
router.delete('/:id', blockIfImpersonated, async (req, res, next) => {
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

      // Only owner can permanently delete bookings
      if (req.user.role === 'practitioner') {
        return { error: 403, message: 'Seuls les propriétaires peuvent supprimer des RDV' };
      }

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
            const updUnblockDel = await client.query(
              `UPDATE clients SET is_blocked = false, blocked_reason = NULL, blocked_at = NULL, updated_at = NOW()
               WHERE id = $1 AND business_id = $2 AND is_blocked = true
               RETURNING id`,
              [clientId, bid]
            );
            // P1-04 RGPD art.22 : audit auto-unblock sur delete-booking (symétrie block).
            if (updUnblockDel.rowCount > 0) {
              try {
                await client.query(
                  `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
                   VALUES ($1, NULL, 'client', $2, 'client_auto_unblock_noshow', $3, $4)`,
                  [bid, clientId,
                   JSON.stringify({ is_blocked: true, blocked_reason: cl.blocked_reason, no_show_count_before: cl.no_show_count + 1 }),
                   JSON.stringify({ is_blocked: false, no_show_count: cl.no_show_count, threshold, source: 'auto_noshow_delete_revert' })]
                );
              } catch (e) { console.error('[AUDIT] auto-unblock delete-booking audit insert failed:', e.message); }
            }
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

      // Clean up FK references before deleting bookings
      await client.query(`DELETE FROM pass_transactions WHERE booking_id = ANY($1)`, [bookingIds]);
      await client.query(`DELETE FROM gift_card_transactions WHERE booking_id = ANY($1)`, [bookingIds]);
      await client.query(`UPDATE invoice_items SET booking_id = NULL WHERE booking_id = ANY($1)`, [bookingIds]);
      await client.query(`DELETE FROM notifications WHERE booking_id = ANY($1)`, [bookingIds]);
      await client.query(`DELETE FROM pre_rdv_sends WHERE booking_id = ANY($1)`, [bookingIds]);
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
    // H7: Use pre-collected calEventsToDelete to delete external calendar events
    // (booking rows are already deleted, so calSyncDelete can't look them up)
    const deletedIds = txResult.bookingIds;
    for (const calEvt of (txResult.calEventsToDelete || [])) {
      try {
        const conn = await queryWithRLS(bid,
          `SELECT * FROM calendar_connections WHERE id = $1 AND business_id = $2 AND status = 'active'`,
          [calEvt.connection_id, bid]
        );
        if (conn.rows.length > 0) {
          const { getValidToken, googleApiCall, outlookApiCall } = require('../../services/calendar-sync');
          const accessToken = await getValidToken(conn.rows[0], (sql, params) => queryWithRLS(bid, sql, params));
          if (conn.rows[0].provider === 'google') {
            const calId = conn.rows[0].calendar_id || 'primary';
            await googleApiCall(accessToken, `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(calEvt.external_event_id)}`, 'DELETE');
          } else {
            await outlookApiCall(accessToken, `/me/events/${encodeURIComponent(calEvt.external_event_id)}`, 'DELETE');
          }
        }
      } catch (e) { console.warn('[CAL_SYNC] Post-delete external event cleanup error:', e.message); }
    }
    // STS-V12-004 fix: Broadcast for ALL deleted IDs, not just the primary
    for (const bId of deletedIds) {
      broadcast(bid, 'booking_update', { action: 'deleted', booking_id: bId });
      // H-07 fix: invalidate minisite cache (slot libéré par delete)
      try { invalidateMinisiteCache(bid); } catch (_) {}
    }
    res.json({ deleted: true, deleted_count: deletedIds.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
