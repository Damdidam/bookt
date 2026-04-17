/**
 * Booking Ungroup — PATCH /:id/ungroup + DELETE /:id/group-remove
 * Detaches a booking from its group, optionally reassigning practitioner
 * and/or replacing service. Also allows removing a member entirely.
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { blockIfImpersonated } = require('../../middleware/auth');
const { broadcast } = require('../../services/sse');
const { calSyncPush, calSyncDelete, businessAllowsOverlap, getMaxConcurrent, checkBookingConflicts } = require('./bookings-helpers');
const { refundPassForBooking } = require('../../services/pass-refund');
const { refundGiftCardForBooking } = require('../../services/gift-card-refund');
const { escHtml, fmtSvcLabel, safeColor, fmtTimeBrussels, sendEmail, buildEmailHTML } = require('../../services/email-utils');

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

    // Only owner can ungroup — not practitioners
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

        // Build UPDATE — keep group_id to create a split (multi-practitioner) group
        const sets = ['updated_at = NOW()'];
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

        // Re-sequence group_order for all members (including this one)
        const allMembersRes = await client.query(
          `SELECT id, group_order FROM bookings
           WHERE group_id = $1 AND business_id = $2
           ORDER BY group_order, start_at`,
          [locked.group_id, bid]
        );
        const allMembers = allMembersRes.rows;
        for (let i = 0; i < allMembers.length; i++) {
          if (allMembers[i].group_order !== i) {
            await client.query(
              `UPDATE bookings SET group_order = $1, updated_at = NOW()
               WHERE id = $2 AND business_id = $3`,
              [i, allMembers[i].id, bid]
            );
          }
        }
        const remaining = allMembers.filter(m => m.id !== id);

        // If only 1 member left in the group, ungroup it (no group of 1)
        if (remaining.length === 1) {
          await client.query(
            `UPDATE bookings SET group_id = NULL, group_order = NULL, updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [remaining[0].id, bid]
          );
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
          group_id: locked.group_id,
          split_group: true,
          total_group_size: allMembers.length
        };
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'ungroup', $4, $5)`,
          [bid, req.user.id, id, JSON.stringify(oldData), JSON.stringify(newData)]
        );

        return { booking: updated.rows[0], remaining_group_size: remaining.length, total_group_size: allMembers.length };
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
router.delete('/:id/group-remove', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    // Only owner can remove — not practitioners
    if (req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Seuls les gestionnaires peuvent supprimer une prestation du groupe' });
    }

    // 1. Fetch the booking
    const bkRes = await queryWithRLS(bid,
      `SELECT b.id, b.group_id, b.group_order, b.status, b.start_at, b.end_at,
              b.practitioner_id, b.service_id, b.client_id, b.public_token
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
          `SELECT id, group_id, group_order, status, service_id, practitioner_id, start_at, end_at,
                  promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents,
                  deposit_required, deposit_status, deposit_amount_cents, deposit_paid_at,
                  booked_price_cents
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

        // Refund pass and gift card before deleting
        await refundGiftCardForBooking(id, client).catch(e => console.error('[GC REFUND] group-remove error:', e.message));
        await refundPassForBooking(id, client).catch(e => console.warn('[PASS REFUND] group-remove:', e.message));

        // Delete the booking itself
        await client.query(
          `DELETE FROM bookings WHERE id = $1 AND business_id = $2`,
          [id, bid]
        );

        // Count remaining members in the group (with price + service info for recalculations)
        const remainRes = await client.query(
          `SELECT b.id, b.group_order, b.service_id, b.booked_price_cents, b.public_token,
                  b.deposit_required, b.deposit_status, b.deposit_amount_cents, b.deposit_paid_at,
                  b.promotion_id, b.promotion_discount_cents, b.end_at,
                  COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0) AS effective_price_cents,
                  s.name AS service_name, s.category AS service_category, s.duration_min,
                  s.price_cents AS service_price_cents,
                  p.display_name AS practitioner_name
           FROM bookings b
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           WHERE b.group_id = $1 AND b.business_id = $2
           ORDER BY b.group_order`,
          [groupId, bid]
        );
        const remaining = remainRes.rows;

        // If the deleted booking carried promo data, we need to migrate it
        const hadPromo = (locked.promotion_discount_cents || 0) > 0;
        // Determine promo carrier: either the deleted booking or an existing member
        const promoCarrierId = hadPromo
          ? locked.promotion_id
          : remaining.find(m => m.promotion_id)?.promotion_id || null;

        // ===== Calculate new group total (for deposit + promo recalculation) =====
        const newGroupTotal = remaining.reduce((sum, m) => sum + (m.effective_price_cents || 0), 0);
        // M2 fix: effective total for deposit = total minus promo (consistent with move/reschedule)
        const _promoDiscRemove = remaining.reduce((sum, m) => sum + (m.promotion_discount_cents || 0), 0);
        const newGroupTotalForDeposit = Math.max(newGroupTotal - _promoDiscRemove, 0);

        if (remaining.length === 1) {
          // Only 1 member left → ungroup it (no group of 1)
          // Also migrate promo fields if the deleted booking was the promo carrier
          const promoSets = hadPromo
            ? `, promotion_id = $3, promotion_label = $4, promotion_discount_pct = $5, promotion_discount_cents = $6`
            : '';
          const promoParams = hadPromo
            ? [remaining[0].id, bid, locked.promotion_id, locked.promotion_label, locked.promotion_discount_pct, locked.promotion_discount_cents]
            : [remaining[0].id, bid];
          await client.query(
            `UPDATE bookings SET group_id = NULL, group_order = NULL, updated_at = NOW()${promoSets}
             WHERE id = $1 AND business_id = $2`,
            promoParams
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

          // Migrate promo fields to new group_order=0 if deleted booking was the promo carrier
          if (hadPromo) {
            await client.query(
              `UPDATE bookings SET promotion_id = $1, promotion_label = $2,
                promotion_discount_pct = $3, promotion_discount_cents = $4, updated_at = NOW()
               WHERE group_id = $5 AND group_order = 0 AND business_id = $6`,
              [locked.promotion_id, locked.promotion_label, locked.promotion_discount_pct, locked.promotion_discount_cents, groupId, bid]
            );
          }
        }

        // ===== BUG 2 FIX: Recalculate promotion_discount_cents on new total =====
        const activePromoId = promoCarrierId;
        let newPromoCents = 0;
        if (activePromoId && remaining.length > 0) {
          const promoRes = await client.query(
            `SELECT * FROM promotions WHERE id = $1`, [activePromoId]
          );
          if (promoRes.rows.length > 0) {
            const promo = promoRes.rows[0];
            // Re-validate promo condition before recalculating amount
            if (
              (promo.condition_type === 'min_amount' && promo.condition_min_cents && newGroupTotal < promo.condition_min_cents) ||
              (promo.condition_type === 'specific_service' && promo.condition_service_id && !remaining.some(m => m.service_id === promo.condition_service_id))
            ) {
              // Condition no longer met — newPromoCents stays 0 → invalidation below
            } else if (promo.reward_type === 'discount_pct') {
              if (promo.condition_type === 'specific_service') {
                // Discount applies to the specific service's price in remaining
                const targetMember = remaining.find(m => m.service_id === promo.condition_service_id);
                const targetPrice = targetMember ? (targetMember.effective_price_cents || 0) : 0;
                newPromoCents = Math.round(targetPrice * promo.reward_value / 100);
              } else {
                newPromoCents = Math.round(newGroupTotal * promo.reward_value / 100);
              }
            } else if (promo.reward_type === 'discount_fixed') {
              if (promo.condition_type === 'specific_service') {
                const targetMember = remaining.find(m => m.service_id === promo.condition_service_id);
                const targetPrice = targetMember ? (targetMember.effective_price_cents || 0) : 0;
                newPromoCents = Math.min(promo.reward_value, targetPrice);
              } else {
                newPromoCents = Math.min(promo.reward_value, newGroupTotal);
              }
            } else if (promo.reward_type === 'free_service') {
              const freeMember = remaining.find(m => m.service_id === promo.reward_service_id);
              newPromoCents = freeMember ? (freeMember.effective_price_cents || 0) : 0;
            }
            // info_only: newPromoCents stays 0

            // Update the promo carrier (group_order=0 or the single remaining booking)
            const carrierId = remaining[0].id;
            if (newPromoCents > 0) {
              await client.query(
                `UPDATE bookings SET promotion_discount_cents = $1, updated_at = NOW()
                 WHERE id = $2 AND business_id = $3`,
                [newPromoCents, carrierId, bid]
              );
            } else {
              // Promo no longer valid (e.g. removed service was the specific_service target)
              await client.query(
                `UPDATE bookings SET promotion_id = NULL, promotion_label = NULL,
                  promotion_discount_pct = NULL, promotion_discount_cents = NULL, updated_at = NOW()
                 WHERE id = $1 AND business_id = $2`,
                [carrierId, bid]
              );
            }
          }
        }

        // ===== BUG 1 FIX: Recalculate deposit_amount_cents =====
        // Find if any remaining member has deposit info (group leader carries it)
        const depositCarrier = remaining.find(m => m.deposit_required) || remaining[0];
        const oldDepositCents = depositCarrier.deposit_amount_cents || 0;
        const depositWasPaid = depositCarrier.deposit_status === 'paid';
        let newDepositCents = 0;

        // Check if any remaining service is quote_only — skip recalc in that case
        const _ungQo = await client.query(
          `SELECT 1 FROM bookings b LEFT JOIN services s ON s.id = b.service_id WHERE b.id = ANY($1::uuid[]) AND s.quote_only = true LIMIT 1`,
          [remaining.map(m => m.id)]
        );
        const _ungIsQuoteOnly = _ungQo.rows.length > 0;

        if (depositCarrier.deposit_required && remaining.length > 0 && !_ungIsQuoteOnly) {
          // Fetch business settings for deposit calculation
          const bizRes = await client.query(
            `SELECT settings FROM businesses WHERE id = $1`, [bid]
          );
          const bizSettings = bizRes.rows[0]?.settings || {};

          if (bizSettings.deposit_type === 'fixed') {
            newDepositCents = Math.min(bizSettings.deposit_fixed_cents || 2500, newGroupTotalForDeposit);
          } else {
            newDepositCents = Math.round(newGroupTotalForDeposit * (bizSettings.deposit_percent || 50) / 100);
          }

          // Update the group leader (group_order=0 or single remaining) with new deposit
          const leaderId = remaining[0].id;
          await client.query(
            `UPDATE bookings SET deposit_amount_cents = $1, updated_at = NOW()
             WHERE id = $2 AND business_id = $3`,
            [newDepositCents, leaderId, bid]
          );

          // If deposit was already paid and new amount < old amount, audit the overpayment
          if (depositWasPaid && newDepositCents < oldDepositCents) {
            const overpayment = oldDepositCents - newDepositCents;
            await client.query(
              `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
               VALUES ($1, $2, 'booking', $3, 'deposit_overpayment', $4, $5)`,
              [bid, req.user.id, leaderId,
               JSON.stringify({ old_deposit_cents: oldDepositCents, deposit_status: 'paid' }),
               JSON.stringify({ new_deposit_cents: newDepositCents, overpayment_cents: overpayment, reason: 'group_member_removed' })]
            );
            // M12 fix: Stripe partial refund for overpayment
            if (overpayment > 0) {
              try {
                const _depPiRes = await client.query(
                  `SELECT deposit_payment_intent_id FROM bookings WHERE group_id = $1 AND business_id = $2 AND deposit_payment_intent_id IS NOT NULL LIMIT 1`,
                  [groupId, bid]
                );
                if (_depPiRes.rows.length > 0 && _depPiRes.rows[0].deposit_payment_intent_id) {
                  const _stripeKey = process.env.STRIPE_SECRET_KEY;
                  if (_stripeKey) {
                    const _stripe = require('stripe')(_stripeKey);
                    let _piId = _depPiRes.rows[0].deposit_payment_intent_id;
                    if (_piId.startsWith('cs_')) {
                      const _sess = await _stripe.checkout.sessions.retrieve(_piId);
                      _piId = _sess.payment_intent;
                    }
                    if (_piId && _piId.startsWith('pi_')) {
                      // Subtract GC partial from overpayment (only refund Stripe portion)
                      const _gcPaidRes = await client.query(
                        `SELECT COALESCE(SUM(amount_cents), 0) AS gc_paid FROM gift_card_transactions WHERE booking_id = $1 AND type = 'debit'`, [id]
                      );
                      const _gcPaid = parseInt(_gcPaidRes.rows[0]?.gc_paid) || 0;
                      const _stripeRefundAmt = Math.max(overpayment - _gcPaid, 0);
                      // D-12 parity: Stripe min 50c. Overpayment <50c → log + skip (trop-perçu résiduel marginal,
                      // Stripe rejetterait "Amount too small" de toute façon).
                      if (_stripeRefundAmt >= 50) {
                        await _stripe.refunds.create({ payment_intent: _piId, amount: _stripeRefundAmt });
                        console.log(`[GROUP-REMOVE] Partial refund: ${_stripeRefundAmt}c for PI ${_piId}`);
                      } else if (_stripeRefundAmt > 0) {
                        console.warn(`[GROUP-REMOVE] Overpayment ${_stripeRefundAmt}c <50c Stripe min — not refunded`);
                      }
                    }
                  }
                }
              } catch (stripeErr) {
                if (stripeErr.code !== 'charge_already_refunded') {
                  console.warn('[GROUP-REMOVE] Stripe partial refund error:', stripeErr.message);
                }
              }
            }
          }
        }

        // ===== BUG 4 FIX: Void draft/sent invoices for the removed booking =====
        await client.query(
          `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
           WHERE booking_id = $1 AND status IN ('draft', 'sent')`,
          [id]
        );
        // Also void group-level invoices since total changed
        if (remaining.length > 0) {
          const remainingIds = remaining.map(m => m.id);
          await client.query(
            `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
             WHERE booking_id = ANY($1::uuid[]) AND status IN ('draft', 'sent')`,
            [remainingIds]
          );
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
           JSON.stringify({ remaining_group_size: remaining.length, new_group_total_cents: newGroupTotal, new_deposit_cents: newDepositCents, new_promo_discount_cents: newPromoCents })]
        );

        // ===== Collect data for post-transaction email (BUG 3) =====
        let emailData = null;
        if (remaining.length > 0 && booking.client_id) {
          const clientRes = await client.query(
            `SELECT first_name, last_name, email FROM clients WHERE id = $1 AND business_id = $2`,
            [booking.client_id, bid]
          );
          const bizRes2 = await client.query(
            `SELECT name, email, phone, address, theme FROM businesses WHERE id = $1`, [bid]
          );
          // Fetch the removed service name
          const removedSvcRes = await client.query(
            `SELECT name, category FROM services WHERE id = $1`, [locked.service_id]
          );
          if (clientRes.rows.length > 0 && clientRes.rows[0].email && bizRes2.rows.length > 0) {
            const cl = clientRes.rows[0];
            const biz = bizRes2.rows[0];
            const removedSvc = removedSvcRes.rows[0] || {};
            emailData = {
              client_name: [cl.first_name, cl.last_name].filter(Boolean).join(' ') || 'Client',
              client_email: cl.email,
              business: biz,
              removed_service: fmtSvcLabel(removedSvc.category, removedSvc.name),
              remaining_services: remaining.map(m => ({
                name: m.service_name || 'Prestation',
                category: m.service_category,
                duration_min: m.duration_min,
                price_cents: m.effective_price_cents
              })),
              new_total_cents: newGroupTotal,
              promo_discount_cents: newPromoCents,
              deposit_status: depositCarrier.deposit_status,
              deposit_amount_cents: newDepositCents,
              start_at: remaining[0] ? locked.start_at : null,
              end_at: remaining.length > 0 ? remaining[remaining.length - 1].end_at : null,
              practitioner_name: remaining[0]?.practitioner_name || null,
              public_token: remaining[0]?.public_token || null
            };
          }
        }

        return { remaining_group_size: remaining.length, emailData };
      });
    } catch (err) {
      if (err.type === 'bad_request' || err.type === 'not_found') return res.status(err.type === 'not_found' ? 404 : 400).json({ error: err.message });
      throw err;
    }

    // Post-transaction: broadcast + calendar sync delete + waitlist
    broadcast(bid, 'booking_update', { action: 'group_member_removed' });
    calSyncDelete(bid, id).catch(() => {});
    // H4 fix: Trigger waitlist for the freed slot
    try { const { processWaitlistForCancellation } = require('../../services/waitlist'); await processWaitlistForCancellation(id, bid); } catch (e) { console.warn('[GROUP-REMOVE] Waitlist error:', e.message); }

    // ===== BUG 3 FIX: Send client notification email =====
    if (result.emailData) {
      try {
        const ed = result.emailData;
        const biz = ed.business;
        const color = safeColor(biz.theme?.primary_color);

        let servicesHTML = '';
        ed.remaining_services.forEach(s => {
          const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
          servicesHTML += `<div style="font-size:13px;color:#15613A;padding:2px 0">\u2022 ${escHtml(fmtSvcLabel(s.category, s.name))} \u2014 ${s.duration_min || '?'} min${price ? ' \u00b7 ' + price : ''}</div>`;
        });

        const totalStr = (ed.new_total_cents / 100).toFixed(2).replace('.', ',');
        let totalLine = `<div style="font-size:14px;color:#15613A;font-weight:700;margin-top:8px">Total : ${totalStr} \u20ac</div>`;
        if (ed.promo_discount_cents > 0) {
          const discStr = (ed.promo_discount_cents / 100).toFixed(2).replace('.', ',');
          const finalStr = ((ed.new_total_cents - ed.promo_discount_cents) / 100).toFixed(2).replace('.', ',');
          totalLine = `<div style="font-size:14px;color:#15613A;font-weight:700;margin-top:8px">Total : <s style="opacity:.6">${totalStr} \u20ac</s> ${finalStr} \u20ac</div>`;
          totalLine += `<div style="font-size:11px;color:#15613A;opacity:.8">Promotion : -${discStr} \u20ac</div>`;
        }

        let depositLine = '';
        if (ed.deposit_status === 'paid' && ed.deposit_amount_cents > 0) {
          const depStr = (ed.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
          depositLine = `<div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:12px 0;border-left:3px solid #F9A825">
            <div style="font-size:13px;color:#5D4037">\u2705 Votre acompte de ${depStr}\u00a0\u20ac reste valable.</div>
          </div>`;
        }

        const dateStr = ed.start_at ? new Date(ed.start_at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' }) : '';
        const timeStr = ed.start_at ? fmtTimeBrussels(ed.start_at) : '';
        const endTimeStr = ed.end_at ? fmtTimeBrussels(ed.end_at) : '';
        const pracName = ed.practitioner_name || '';

        const bodyHTML = `
          <p>Bonjour <strong>${escHtml(ed.client_name)}</strong>,</p>
          <p>Une prestation a \u00e9t\u00e9 retir\u00e9e de votre rendez-vous${dateStr ? ' du <strong>' + dateStr + '</strong> à <strong>' + timeStr + (endTimeStr ? ' – ' + endTimeStr : '') + '</strong>' : ''}${pracName ? ' avec <strong>' + escHtml(pracName) + '</strong>' : ''} :</p>
          <div style="background:#FEF3E2;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #E6A817">
            <div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.7">${escHtml(ed.removed_service)}</div>
          </div>
          <div style="background:#EEFAF1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #1B7A42">
            <div style="font-size:13px;color:#15613A;font-weight:600;margin-bottom:6px">Prestations restantes :</div>
            ${servicesHTML}
            ${totalLine}
          </div>
          ${depositLine}
          <p style="font-size:13px;color:#9C958E">Si vous avez des questions, n\u2019h\u00e9sitez pas \u00e0 nous contacter.</p>`;

        const _baseUrl = process.env.APP_BASE_URL || 'https://genda.be';
        const _manageUrl = ed.public_token ? `${_baseUrl}/booking/${ed.public_token}` : null;
        const _footerParts = [biz.name, biz.address, biz.phone, biz.email].filter(Boolean);
        const html = buildEmailHTML({
          title: 'Modification de votre rendez-vous',
          preheader: `Une prestation a \u00e9t\u00e9 retir\u00e9e de votre rendez-vous`,
          bodyHTML,
          businessName: biz.name,
          primaryColor: color,
          ...(_manageUrl ? { ctaText: 'G\u00e9rer mon rendez-vous', ctaUrl: _manageUrl } : {}),
          footerText: `${_footerParts.join(' \u00b7 ')} \u00b7 Via Genda.be`
        });

        await sendEmail({
          to: ed.client_email,
          toName: ed.client_name,
          subject: `Modification de votre RDV \u2014 ${biz.name}`,
          html,
          fromName: biz.name,
          replyTo: biz.email
        });
      } catch (emailErr) {
        console.error('[EMAIL] group-remove notification error:', emailErr.message);
      }
    }

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

    // Only owner can add to group — not practitioners
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
      `SELECT id, name, duration_min, buffer_before_min, buffer_after_min, price_cents, is_active
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

        // Duplicate check: same service + variant already in group
        const dupCheck = await client.query(
          `SELECT id FROM bookings
           WHERE group_id = $1 AND business_id = $2 AND service_id = $3
             AND COALESCE(service_variant_id, '00000000-0000-0000-0000-000000000000') = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000')
             AND status NOT IN ('cancelled', 'no_show')`,
          [booking.group_id, bid, service_id, variant_id || null]
        );
        if (dupCheck.rows.length > 0) {
          throw Object.assign(new Error('Cette prestation existe déjà dans le groupe'), { type: 'duplicate' });
        }

        // Insert the new group member (M6 fix: apply LM discount if slot is in LM window)
        let _addBookedPrice = variantPrice != null ? variantPrice : (svc.price_cents || null);
        let _addDiscountPct = null;
        const _addBizSettings = await client.query(`SELECT plan, settings FROM businesses WHERE id = $1`, [bid]);
        const _addSettings = _addBizSettings.rows[0]?.settings || {};
        if (_addSettings.last_minute_enabled && (_addBizSettings.rows[0]?.plan || 'free') !== 'free' && _addBookedPrice) {
          const { isWithinLastMinuteWindow } = require('../../routes/public/helpers');
          const _todayBxl = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
          const _slotBxl = new Date(newStart).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
          const _lmDl = _addSettings.last_minute_deadline || 'j-1';
          const _lmMin = _addSettings.last_minute_min_price_cents || 0;
          if (isWithinLastMinuteWindow(_slotBxl, _todayBxl, _lmDl) && svc.promo_eligible !== false && _addBookedPrice >= _lmMin) {
            _addDiscountPct = _addSettings.last_minute_discount_pct || 10;
            _addBookedPrice = Math.round(_addBookedPrice * (100 - _addDiscountPct) / 100);
          }
        }
        const ins = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
            channel, appointment_mode, start_at, end_at, status, locked, group_id, group_order, booked_price_cents, discount_pct)
           VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, 'confirmed', true, $9, $10, $11, $12)
           RETURNING *`,
          [bid, booking.practitioner_id, service_id, variant_id || null, booking.client_id,
           booking.appointment_mode || 'cabinet',
           newStart.toISOString(), newEnd.toISOString(),
           booking.group_id, newGroupOrder, _addBookedPrice, _addDiscountPct]
        );

        // Audit log
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'create', $4, $5)`,
          [bid, req.user.id, ins.rows[0].id,
           JSON.stringify({ group_id: booking.group_id, added_to_group: true }),
           JSON.stringify({ service_id, group_order: newGroupOrder })]
        );

        // Recalculate promo if group has one
        const promoCarrier = await client.query(
          `SELECT id, promotion_id FROM bookings
           WHERE group_id = $1 AND business_id = $2 AND promotion_id IS NOT NULL LIMIT 1`,
          [booking.group_id, bid]
        );
        if (promoCarrier.rows.length > 0) {
          const promoId = promoCarrier.rows[0].promotion_id;
          const promoRes = await client.query(`SELECT * FROM promotions WHERE id = $1`, [promoId]);
          if (promoRes.rows.length > 0) {
            const promo = promoRes.rows[0];
            const grpTotal = await client.query(
              `SELECT COALESCE(SUM(COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)), 0) AS total
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.group_id = $1 AND b.business_id = $2 AND b.status NOT IN ('cancelled')`,
              [booking.group_id, bid]
            );
            const newTotal = parseInt(grpTotal.rows[0].total) || 0;
            let newDisc = 0;
            if (promo.reward_type === 'discount_pct') {
              newDisc = Math.round(newTotal * promo.reward_value / 100);
            } else if (promo.reward_type === 'discount_fixed') {
              newDisc = Math.min(promo.reward_value, newTotal);
            }
            if (newDisc > 0) {
              await client.query(
                `UPDATE bookings SET promotion_discount_cents = $1, updated_at = NOW()
                 WHERE id = $2 AND business_id = $3`,
                [newDisc, promoCarrier.rows[0].id, bid]
              );
            }
          }
        }

        // Recalculate deposit if still pending (SKIP for quote_only groups)
        const _addQo = await client.query(
          `SELECT 1 FROM bookings b LEFT JOIN services s ON s.id = b.service_id WHERE b.group_id = $1 AND s.quote_only = true LIMIT 1`,
          [booking.group_id]
        );
        if (booking.deposit_required && booking.deposit_status === 'pending' && _addQo.rows.length === 0) {
          // M2 fix: subtract promo discount from total (consistent with reschedule/move)
          const grpTotalDep = await client.query(
            `SELECT COALESCE(SUM(COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)), 0) AS total,
                    COALESCE(SUM(CASE WHEN b.group_order = 0 THEN b.promotion_discount_cents ELSE 0 END), 0) AS promo
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             WHERE b.group_id = $1 AND b.business_id = $2 AND b.status NOT IN ('cancelled')`,
            [booking.group_id, bid]
          );
          const newTotalDep = Math.max((parseInt(grpTotalDep.rows[0].total) || 0) - (parseInt(grpTotalDep.rows[0].promo) || 0), 0);
          const bizForDep = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [bid]);
          const depSettings = bizForDep.rows[0]?.settings || {};
          let newDepCents;
          if (depSettings.deposit_type === 'fixed') {
            newDepCents = Math.min(depSettings.deposit_fixed_cents || 2500, newTotalDep);
          } else {
            newDepCents = Math.round(newTotalDep * (depSettings.deposit_percent || 50) / 100);
            newDepCents = Math.min(newDepCents, newTotalDep);
          }
          if (newDepCents > 0) {
            await client.query(
              `UPDATE bookings SET deposit_amount_cents = $1, updated_at = NOW()
               WHERE group_id = $2 AND business_id = $3 AND deposit_required = true`,
              [newDepCents, booking.group_id, bid]
            );
          }
        }

        return ins.rows[0];
      });
    } catch (err) {
      if (err.type === 'conflict' || err.type === 'duplicate') return res.status(409).json({ error: err.message });
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
