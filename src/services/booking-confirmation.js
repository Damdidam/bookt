/**
 * Booking Confirmation Cron
 *
 * Auto-cancels bookings that are still 'pending' past their
 * confirmation_expires_at deadline. Notifies waitlist if applicable.
 */

const { query, pool } = require('./db');
const { broadcast } = require('./sse');
const { refundGiftCardForBooking, getGcPaidCents } = require('./gift-card-refund');
const { refundPassForBooking } = require('./pass-refund');
const { calSyncDelete } = require('../routes/staff/bookings-helpers');

/**
 * Process expired unconfirmed bookings.
 * Called by setInterval in server.js every ~2 min.
 * @returns {Promise<{processed: number}>}
 */
async function processExpiredPendingBookings() {
  const client = await pool.connect();
  const cancelledBookingIds = [];
  try {
    await client.query('BEGIN');

    // Find pending bookings whose confirmation window has elapsed
    // OR whose start time has already passed (no-show prevention)
    const expired = await client.query(
      `SELECT b.id, b.business_id, b.service_id, b.practitioner_id, b.start_at, b.end_at, b.group_id, b.client_id,
              b.confirmation_expires_at,
              b.deposit_status, b.deposit_payment_intent_id, b.deposit_amount_cents,
              COALESCE(s.quote_only, false) AS service_quote_only,
              biz.settings AS biz_settings
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.status = 'pending'
         AND (b.deposit_status IS NULL OR b.deposit_status != 'paid')  -- M3: race vs Stripe webhook (paid deposit = webhook will confirm shortly)
         AND b.disputed_at IS NULL                                     -- BL-03 hotfix scan 3 : exclude dispute → évite double-loss
         AND (
           (b.confirmation_expires_at IS NOT NULL AND b.confirmation_expires_at < NOW())
           OR b.start_at <= NOW()
         )
       FOR UPDATE OF b SKIP LOCKED`
    );

    let processed = 0;

    for (let i = 0; i < expired.rows.length; i++) {
      const bk = expired.rows[i];
      await client.query(`SAVEPOINT sp_${i}`);
      try {
      // B3 fix: capture net refund + retention reason for email downstream (L306 + L372)
      // so client sees the real Stripe amount and correct cause banner (vs generic "annulation tardive").
      let _netRefundForEmail = null;
      let _retentionReason = null;
      // Cancel the booking — reason depends on type
      const cancelReason = bk.service_quote_only
        ? 'Devis non traité avant la date du rendez-vous'
        : 'Confirmation non reçue dans le délai imparti';
      const upd = await client.query(
        `UPDATE bookings SET status = 'cancelled', cancel_reason = $2, updated_at = NOW(), confirmation_expires_at = NULL
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [bk.id, cancelReason]
      );
      if (upd.rows.length === 0) continue;

      // If part of a group, cancel siblings too
      // H-04 fix: aligner sur deposit-expiry.js:62 — si deposit_status='pending' sur un sibling,
      // le marquer 'cancelled' (sinon la DB garde "acompte en attente" sur un booking cancelled).
      if (bk.group_id) {
        await client.query(
          `UPDATE bookings SET status = 'cancelled', updated_at = NOW(), confirmation_expires_at = NULL,
            deposit_status = CASE WHEN deposit_status = 'pending' THEN 'cancelled' ELSE deposit_status END
           WHERE group_id = $1 AND id != $2 AND status = 'pending'`,
          [bk.group_id, bk.id]
        );
      }

      // BUG-F fix: Stripe refund moved AFTER all other DB operations (pass/gc refunds,
      // invoice void, audit, strike counter) so that if ANY of those throw, savepoint
      // rollback annule tout — no orphan Stripe refund with booking still 'pending'.
      // See just before `cancelledBookingIds.push` below for the moved block.

      // Refund pass sessions
      let passRefundConf = { refunded: 0 };
      try { passRefundConf = await refundPassForBooking(bk.id, client) || { refunded: 0 }; } catch (e) { console.warn('[PASS REFUND]', e.message); }
      if (bk.group_id) {
        const sibPass = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
          [bk.group_id, bk.id]
        );
        for (const sib of sibPass.rows) { await refundPassForBooking(sib.id, client).catch(e => console.warn('[PASS REFUND]', e.message)); }
      }

      // Refund gift card debits
      let gcRefundConf = { refunded: 0 };
      try { gcRefundConf = await refundGiftCardForBooking(bk.id, client) || { refunded: 0 }; } catch (e) { console.warn('[GC REFUND]', e.message); }
      if (bk.group_id) {
        const sibGc = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
          [bk.group_id, bk.id]
        );
        for (const sib of sibGc.rows) { await refundGiftCardForBooking(sib.id, client).catch(e => console.warn('[GC REFUND]', e.message)); }
      }

      // M16: Decrement promo usage
      try { const { decrementPromoUsage } = require('../routes/public/helpers'); await decrementPromoUsage(bk.id, client); } catch (_) {}

      // Auto-void draft/sent invoices
      try {
        const voidIds = [bk.id];
        if (bk.group_id) {
          const sibInv = await client.query(`SELECT id FROM bookings WHERE group_id = $1 AND id != $2`, [bk.group_id, bk.id]);
          for (const s of sibInv.rows) voidIds.push(s.id);
        }
        await client.query(
          `UPDATE invoices SET status = 'cancelled', updated_at = NOW()
           WHERE booking_id = ANY($1::uuid[]) AND status IN ('draft', 'sent')`,
          [voidIds]
        );
      } catch (e) { console.warn('[INVOICE VOID] confirm cron error:', e.message); }

      // Audit log — confirmation expired
      await client.query(
        `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, 'booking', $2, 'confirmation_expired', '{"status":"pending"}', '{"status":"cancelled","reason":"confirmation_timeout"}')`,
        [bk.business_id, bk.id]
      );

      // ── Expired pending strike: increment counter on client ──
      if (bk.client_id) {
        await client.query(
          `UPDATE clients SET expired_pending_count = expired_pending_count + 1,
            last_expired_pending_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND business_id = $2`,
          [bk.client_id, bk.business_id]
        );
      }
      // Strike sibling clients too (group bookings — different clients)
      if (bk.group_id) {
        const sibClients = await client.query(
          `SELECT DISTINCT client_id FROM bookings
           WHERE group_id = $1 AND id != $2 AND client_id IS NOT NULL AND client_id != $3`,
          [bk.group_id, bk.id, bk.client_id || '00000000-0000-0000-0000-000000000000']
        );
        for (const sib of sibClients.rows) {
          await client.query(
            `UPDATE clients SET expired_pending_count = expired_pending_count + 1,
              last_expired_pending_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [sib.client_id, bk.business_id]
          );
        }
      }

      // BUG-F fix: Stripe refund last so any upstream DB throw rolls back to savepoint
      // without having refunded money (otherwise booking stays 'pending' with PI refunded).
      if (bk.deposit_status === 'paid' && bk.deposit_payment_intent_id) {
        const _stripeKey = process.env.STRIPE_SECRET_KEY;
        if (_stripeKey) {
          try {
            const stripe = require('stripe')(_stripeKey);
            let _piId = bk.deposit_payment_intent_id;
            if (_piId.startsWith('cs_')) {
              const _sess = await stripe.checkout.sessions.retrieve(_piId);
              _piId = _sess.payment_intent;
            }
            if (_piId && _piId.startsWith('pi_')) {
              const _refundPolicy = bk.biz_settings?.refund_policy || 'full';
              let _finalDepStatus = 'refunded';
              if (_refundPolicy === 'net' && bk.deposit_amount_cents) {
                const _gcPaidRes = await client.query(
                  `SELECT COALESCE(SUM(amount_cents), 0) AS gc_paid_cents
                   FROM gift_card_transactions WHERE booking_id = $1 AND type = 'debit'`,
                  [bk.id]
                );
                const _gcPaidCents = parseInt(_gcPaidRes.rows[0]?.gc_paid_cents) || 0;
                const _actualStripeCharge = Math.max(bk.deposit_amount_cents - _gcPaidCents, 0);
                // A#4 fix: Bancontact is billed flat 0.24€ regardless of amount —
                // the 1.5%+25c estimate over-charges every BC refund by ~16c.
                // Pull the actual fee from Stripe, fallback to estimate on error.
                const { resolveStripeFeeCents } = require('./stripe-fee');
                const _stripeFees = await resolveStripeFeeCents(stripe, _piId, _actualStripeCharge);
                const _netRefund = Math.max(_actualStripeCharge - _stripeFees, 0);
                if (_netRefund >= 50) {
                  // P0 Connect: reverse_transfer via helper — sinon Genda paye 100% du refund.
                  const { createRefund } = require('./stripe-refund');
                  await createRefund(stripe, { payment_intent: _piId, amount: _netRefund }, `cron-confirm-refund-${bk.id}`);
                  console.log(`[CONFIRM CRON] Net refund: ${_netRefund}c (fees ${_stripeFees}c, gc ${_gcPaidCents}c) for PI ${_piId}`);
                  _netRefundForEmail = _netRefund;
                } else {
                  console.warn(`[CONFIRM CRON] netRefund=${_netRefund}c <50c Stripe min (fees ${_stripeFees}c, charge ${_actualStripeCharge}c) — deposit retained for PI ${_piId}`);
                  _finalDepStatus = 'cancelled';
                  _netRefundForEmail = 0;
                  _retentionReason = 'fees_exceed_charge';
                }
              } else {
                const { createRefund } = require('./stripe-refund');
                await createRefund(stripe, { payment_intent: _piId }, `cron-confirm-refund-full-${bk.id}`);
              }
              await client.query(`UPDATE bookings SET deposit_status = $2 WHERE id = $1`, [bk.id, _finalDepStatus]);
              if (bk.group_id) {
                // A#10 fix v2 — corrige une régression inverse détectée par l'audit
                // exhaustif : la v1 marquait les siblings à PI distinct `refunded` en DB
                // sans émettre le refund Stripe correspondant (drift inverse : client
                // pas remboursé, DB dit remboursé). On fait maintenant :
                //   (1) UPDATE same-PI siblings avec _finalDepStatus (refund déjà fait)
                //   (2) SELECT siblings à PI distinct qui auraient pu rester à 'paid'
                //   (3) Pour chacun, refund Stripe sur SON PI, puis UPDATE DB
                // Edge: si un PI sibling ne peut pas être refundé (Stripe fail), on
                // laisse deposit_status='paid' + log warning pour action manuelle pro.
                await client.query(
                  `UPDATE bookings SET deposit_status = $2
                    WHERE group_id = $1
                      AND id != $3
                      AND deposit_payment_intent_id = $4
                      AND status = 'cancelled'
                      AND deposit_status = 'paid'`,
                  [bk.group_id, _finalDepStatus, bk.id, bk.deposit_payment_intent_id]
                );

                // (2) + (3) : siblings à PI distinct → refund Stripe individuel.
                const _distinctPiSibs = await client.query(
                  `SELECT id, deposit_payment_intent_id, deposit_amount_cents
                     FROM bookings
                    WHERE group_id = $1
                      AND id != $2
                      AND status = 'cancelled'
                      AND deposit_status = 'paid'
                      AND deposit_payment_intent_id IS NOT NULL
                      AND deposit_payment_intent_id != $3`,
                  [bk.group_id, bk.id, bk.deposit_payment_intent_id]
                );
                for (const _sib of _distinctPiSibs.rows) {
                  try {
                    let _sibPi = _sib.deposit_payment_intent_id;
                    if (_sibPi.startsWith('cs_')) {
                      const _sibSess = await stripe.checkout.sessions.retrieve(_sibPi);
                      _sibPi = _sibSess.payment_intent;
                    }
                    if (!_sibPi || !_sibPi.startsWith('pi_')) {
                      console.warn(`[CONFIRM CRON] Sibling ${_sib.id} PI non-résolu (${_sib.deposit_payment_intent_id}) — deposit_status laissé 'paid', refund manuel requis`);
                      continue;
                    }
                    if (_refundPolicy === 'net' && _sib.deposit_amount_cents) {
                      const _sibGc = await client.query(
                        `SELECT COALESCE(SUM(amount_cents), 0) AS gc FROM gift_card_transactions WHERE booking_id = $1 AND type = 'debit'`,
                        [_sib.id]
                      );
                      const _sibCharge = Math.max(_sib.deposit_amount_cents - (parseInt(_sibGc.rows[0]?.gc) || 0), 0);
                      const _sibFees = await resolveStripeFeeCents(stripe, _sibPi, _sibCharge);
                      const _sibNet = Math.max(_sibCharge - _sibFees, 0);
                      if (_sibNet >= 50) {
                        const { createRefund: _cr } = require('./stripe-refund');
                        await _cr(stripe, { payment_intent: _sibPi, amount: _sibNet }, `cron-confirm-sib-refund-${_sib.id}`);
                        await client.query(`UPDATE bookings SET deposit_status = 'refunded' WHERE id = $1`, [_sib.id]);
                        console.log(`[CONFIRM CRON] Sibling ${_sib.id} net refund: ${_sibNet}c for PI ${_sibPi}`);
                      } else {
                        await client.query(`UPDATE bookings SET deposit_status = 'cancelled' WHERE id = $1`, [_sib.id]);
                        console.warn(`[CONFIRM CRON] Sibling ${_sib.id} netRefund=${_sibNet}c <50c — deposit retenu`);
                      }
                    } else {
                      const { createRefund: _cr } = require('./stripe-refund');
                      await _cr(stripe, { payment_intent: _sibPi }, `cron-confirm-sib-refund-full-${_sib.id}`);
                      await client.query(`UPDATE bookings SET deposit_status = 'refunded' WHERE id = $1`, [_sib.id]);
                      console.log(`[CONFIRM CRON] Sibling ${_sib.id} full refund for PI ${_sibPi}`);
                    }
                  } catch (_sibErr) {
                    if (_sibErr.code === 'charge_already_refunded') {
                      await client.query(`UPDATE bookings SET deposit_status = 'refunded' WHERE id = $1`, [_sib.id]);
                    } else {
                      console.error(`[CONFIRM CRON] Sibling ${_sib.id} refund failed:`, _sibErr.message, '— deposit_status=paid conservé pour refund manuel');
                    }
                  }
                }
              }
            }
          } catch (stripeErr) {
            if (stripeErr.code === 'charge_already_refunded') {
              // CRON-01 hotfix (scan 3) : parity avec sibling path L270-271. Avant ce
              // fix, charge_already_refunded skippait l'UPDATE deposit_status sur le
              // primary → booking passe cancelled mais deposit_status reste 'paid'
              // en permanence → dashboard pro et stats financières faussés.
              await client.query(`UPDATE bookings SET deposit_status = 'refunded' WHERE id = $1`, [bk.id]);
              console.log(`[CONFIRM CRON] Primary ${bk.id} already refunded — deposit_status synced to 'refunded'`);
            } else {
              console.error('[CONFIRM CRON] Stripe refund failed for', bk.id, ':', stripeErr.message);
              await client.query(`UPDATE bookings SET deposit_status = 'cancelled' WHERE id = $1`, [bk.id]);
              _netRefundForEmail = 0;
              _retentionReason = 'stripe_failure';
            }
          }
        } else {
          console.warn('[CONFIRM CRON] Stripe key missing — paid deposit on', bk.id, 'cannot be refunded');
          await client.query(`UPDATE bookings SET deposit_status = 'cancelled' WHERE id = $1`, [bk.id]);
          _netRefundForEmail = 0;
          _retentionReason = 'no_stripe_key';
        }
      }

      processed++;
      // BUG-SESSIONS-EXPIRE fix: store _stripeSessionId (cs_*) so the post-commit
      // stripe.checkout.sessions.expire() loop (parity with deposit-expiry) actually has
      // a target. Previous push omitted this field → the loop was a silent no-op.
      cancelledBookingIds.push({ id: bk.id, business_id: bk.business_id, group_id: bk.group_id, client_id: bk.client_id, _gcRefunded: gcRefundConf.refunded || 0, _passRefunded: (passRefundConf.refunded || 0) !== 0, _netRefund: _netRefundForEmail, _retentionReason, _stripeSessionId: bk.deposit_payment_intent_id });
      } catch (spErr) {
        await client.query(`ROLLBACK TO sp_${i}`);
        console.error('[CONFIRM CRON] Failed to process booking', bk.id, spErr.message);
        continue;
      }
    }

    await client.query('COMMIT');

    // Post-commit side effects: SSE + waitlist (must be AFTER commit for data consistency)
    // BUG-CRON-CACHE fix: invalidate minisite cache per-business (parity with other cancel paths).
    const _invalidatedBizIds = new Set();
    for (const cancelled of cancelledBookingIds) {
      broadcast(cancelled.business_id, 'booking_update', {
        action: 'expired_confirmation',
        bookingId: cancelled.id
      });
      if (!_invalidatedBizIds.has(cancelled.business_id)) {
        _invalidatedBizIds.add(cancelled.business_id);
        try {
          const { invalidateMinisiteCache } = require('../routes/public/helpers');
          invalidateMinisiteCache(cancelled.business_id);
        } catch (_) { /* best-effort */ }
      }
      try {
        const { processWaitlistForCancellation } = require('./waitlist');
        await processWaitlistForCancellation(cancelled.id, cancelled.business_id);
        // BUG-CRON-SIB fix: notify waitlist for sibling slots freed by this group cancel.
        if (cancelled.group_id) {
          const sibsWl = await query(
            `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'cancelled'`,
            [cancelled.group_id, cancelled.business_id, cancelled.id]
          );
          for (const sib of sibsWl.rows) {
            try { await processWaitlistForCancellation(sib.id, cancelled.business_id); } catch (_) {}
          }
        }
      } catch (wlErr) {
        console.warn('[CONFIRM CRON] Waitlist processing error for booking', cancelled.id, ':', wlErr.message);
      }
    }

    // BUG-CRON-SESSIONS-EXPIRE fix: parité avec deposit-expiry.js:182-189 — expire any
    // open Stripe checkout session so a client can't pay after the booking was auto-cancelled.
    // (Rare edge case: booking was 'pending' with a deposit session, expired before client paid.)
    const _stripeKeyConf = process.env.STRIPE_SECRET_KEY;
    if (_stripeKeyConf) {
      const _stripeConf = require('stripe')(_stripeKeyConf);
      for (const cancelled of cancelledBookingIds) {
        if (cancelled._stripeSessionId && cancelled._stripeSessionId.startsWith('cs_')) {
          try { await _stripeConf.checkout.sessions.expire(cancelled._stripeSessionId); } catch (_) {}
        }
      }
    }

    // H3 fix: Delete external calendar events for cancelled bookings (primary + siblings)
    // BUG-CRON-SIB fix: external calendar events for sibling bookings were orphaned —
    // Google/Outlook still displayed them even after DB cancel.
    await Promise.all(cancelledBookingIds.map(async cancelled => {
      try { await calSyncDelete(cancelled.business_id, cancelled.id); } catch (_) {}
      if (cancelled.group_id) {
        try {
          const sibsCs = await query(
            `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'cancelled'`,
            [cancelled.group_id, cancelled.business_id, cancelled.id]
          );
          for (const sib of sibsCs.rows) {
            try { await calSyncDelete(cancelled.business_id, sib.id); } catch (_) {}
          }
        } catch (_) {}
      }
    }));
    await Promise.all(cancelledBookingIds.map(cancelled =>
      query(`INSERT INTO notifications (business_id, booking_id, type, status) VALUES ($1, $2, 'email_cancellation_pro', 'queued')`, [cancelled.business_id, cancelled.id])
        .catch(e => console.warn('[CONFIRM CRON] Pro notification queue error:', e.message))
    ));

    // H4 fix: missed-email sweep — pick up cron-cancelled bookings (last 24h) whose email was
    // never sent (pod crashed between COMMIT and send). Idempotent via cancellation_email_sent_at.
    try {
      // Q9 fix: fetch business_id + group_id + client_id pour éviter les "Invalid business ID" en aval
      // (processWaitlistForCancellation, calSyncDelete, etc. appellent queryWithRLS qui throw sur null).
      const missed = await query(
        `SELECT id, business_id, group_id, client_id FROM bookings
          WHERE status = 'cancelled'
            AND cancellation_email_sent_at IS NULL
            AND updated_at > NOW() - INTERVAL '24 hours'
            AND cancel_reason IN (
              'Confirmation non reçue dans le délai imparti',
              'Devis non traité avant la date du rendez-vous'
            )
          LIMIT 50`
      );
      for (const m of missed.rows) {
        if (!cancelledBookingIds.find(c => c.id === m.id)) {
          cancelledBookingIds.push({ id: m.id, business_id: m.business_id, group_id: m.group_id, client_id: m.client_id, _gcRefunded: 0, _passRefunded: false, _netRefund: null, _retentionReason: null, _missed: true });
        }
      }
      if (missed.rows.length > 0) console.log(`[CONFIRM CRON] Picked up ${missed.rows.length} missed email(s) from previous tick`);
    } catch (e) { console.warn('[CONFIRM CRON] missed-email sweep error:', e.message); }

    // Send cancellation emails AFTER commit (non-blocking)
    for (const { id: bkId, _gcRefunded, _passRefunded, _netRefund, _retentionReason } of cancelledBookingIds) {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                  biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings, biz.plan AS biz_plan
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`, [bkId]
        );
        if (!fullBk.rows[0]?.client_email) continue;
        const row = fullBk.rows[0];
        // Pass raw catalog price — email template computes LM display from discount_pct
        let groupServices = null;
        if (row.group_id) {
          const grp = await query(
            `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                    b.practitioner_id, p.display_name AS practitioner_name, b.discount_pct
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             LEFT JOIN practitioners p ON p.id = b.practitioner_id
             WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
            [row.group_id, row.business_id]
          );
          if (grp.rows.length > 1) {
            const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
            if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
            grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
            groupServices = grp.rows;
          }
        }
        const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
        const gcPaidConfirm = await getGcPaidCents(bkId);
        const { sendCancellationEmail } = require('./email');
        await sendCancellationEmail({
          // B3 fix: forward net_refund_cents + deposit_retention_reason so email shows real Stripe amount + correct cause banner
          booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, service_category: row.service_category, custom_label: row.custom_label, comment_client: row.comment_client, service_price_cents: row.service_price_cents, booked_price_cents: row.booked_price_cents, discount_pct: row.discount_pct, duration_min: row.duration_min, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidConfirm, gc_refunded_cents: _gcRefunded || 0, pass_refunded: !!_passRefunded, net_refund_cents: _netRefund, deposit_retention_reason: _retentionReason, cancel_reason: row.cancel_reason || 'Confirmation non reçue dans le délai imparti' },
          business: { id: row.business_id, name: row.biz_name, slug: row.biz_slug, email: row.biz_email, phone: row.biz_phone, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
          groupServices
        });
        // H4 fix: mark email sent so a crash here doesn't trigger a duplicate next tick.
        await query(`UPDATE bookings SET cancellation_email_sent_at = NOW() WHERE id = $1`, [bkId]).catch(() => {});
      } catch (emailErr) {
        console.warn('[CONFIRM CRON] Cancellation email error for booking', bkId, ':', emailErr.message);
      }
    }

    // Email sibling clients (different client_id on same group) who were also cancelled
    for (const cancelled of cancelledBookingIds) {
      if (!cancelled.group_id) continue;
      try {
        const siblings = await query(
          `SELECT b.id, b.start_at, b.end_at, b.deposit_required, b.deposit_status, b.deposit_amount_cents, b.deposit_paid_at, b.deposit_payment_intent_id,
                  b.booked_price_cents, b.custom_label, b.comment_client,
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct, b.discount_pct,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings
           FROM bookings b LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.group_id = $1 AND b.business_id = $2 AND b.id != $3
             AND b.client_id IS NOT NULL AND b.client_id != COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
             AND c.email IS NOT NULL`,
          [cancelled.group_id, cancelled.business_id, cancelled.id, cancelled.client_id]
        );
        // H6 fix: compute groupServices once per cancelled.group_id so siblings see the full combo too
        let _sibGroupServices = null;
        const _sibGrp = await query(
          `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                  b.practitioner_id, p.display_name AS practitioner_name, b.discount_pct
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
          [cancelled.group_id, cancelled.business_id]
        );
        if (_sibGrp.rows.length > 1) {
          const _sibPIds = new Set(_sibGrp.rows.map(r => r.practitioner_id));
          if (_sibPIds.size <= 1) _sibGrp.rows.forEach(r => { r.practitioner_name = null; });
          _sibGrp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
          _sibGroupServices = _sibGrp.rows;
        }
        for (const sib of siblings.rows) {
          try {
            const gcPaidSibConf = await getGcPaidCents(sib.id);
            // Look up actual refund amounts for this sibling so the email banner shows what was really refunded.
            const _gcRef = await query(`SELECT COALESCE(SUM(amount_cents), 0)::int AS amt FROM gift_card_transactions WHERE booking_id = $1 AND type = 'refund'`, [sib.id]);
            const _passRef = await query(`SELECT 1 FROM pass_transactions WHERE booking_id = $1 AND type = 'refund' LIMIT 1`, [sib.id]);
            // B#1 fix: pass the RAW service_price_cents so the template can detect LM
            // (rawPrice > bookedPrice) and render the "Last Minute -X%" struck-through banner.
            // Previously we pre-applied discount_pct here → template saw raw==booked → no LM banner.
            const { sendCancellationEmail } = require('./email');
            await sendCancellationEmail({
              // H7 fix: forward custom_label so sibling email shows personalised service label
              // B3 fix: forward net_refund_cents + deposit_retention_reason from primary (siblings share the deposit PI)
              booking: { start_at: sib.start_at, end_at: sib.end_at, client_name: sib.client_name, client_email: sib.client_email, service_name: sib.service_name, service_category: sib.service_category, custom_label: sib.custom_label, comment_client: sib.comment_client, service_price_cents: sib.service_price_cents, booked_price_cents: sib.booked_price_cents, discount_pct: sib.discount_pct, duration_min: sib.duration_min, promotion_label: sib.promotion_label, promotion_discount_cents: sib.promotion_discount_cents, promotion_discount_pct: sib.promotion_discount_pct, practitioner_name: sib.practitioner_name, deposit_required: sib.deposit_required, deposit_status: sib.deposit_status, deposit_amount_cents: sib.deposit_amount_cents, deposit_paid_at: sib.deposit_paid_at, deposit_payment_intent_id: sib.deposit_payment_intent_id, gc_paid_cents: gcPaidSibConf, gc_refunded_cents: _gcRef.rows[0]?.amt || 0, pass_refunded: _passRef.rows.length > 0, net_refund_cents: cancelled._netRefund, deposit_retention_reason: cancelled._retentionReason, cancel_reason: 'Confirmation non reçue dans le délai imparti' },
              business: { id: cancelled.business_id, name: sib.biz_name, slug: sib.biz_slug, email: sib.biz_email, phone: sib.biz_phone, address: sib.biz_address, theme: sib.biz_theme, settings: sib.biz_settings },
              groupServices: _sibGroupServices
            });
            // Batch 12 regression fix: mark sibling flag so sweep won't duplicate next tick
            await query(`UPDATE bookings SET cancellation_email_sent_at = NOW() WHERE id = $1`, [sib.id]).catch(() => {});
          } catch (e) { console.warn('[CONFIRM CRON] Sibling email error:', e.message); }
        }
      } catch (e) { console.warn('[CONFIRM CRON] Sibling query error:', e.message); }
    }

    return { processed };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Auto-confirm bookings in `modified_pending` state when their start_at is close
 * (default 2h). The /modify staff endpoint sends an email telling the client
 * "sera automatiquement confirmé" — this cron fulfills that promise.
 *
 * Without this function, modified_pending bookings stay indefinitely (no cron
 * touches them). Reminders 24h/2h traitent désormais aussi modified_pending
 * (fix BL-06 scan 3 — reminders.js L86 + L373).
 *
 * Called every ~2 min from server.js alongside processExpiredPendingBookings.
 * @returns {Promise<{confirmed: number}>}
 */
async function processAutoConfirmModifiedPending() {
  const client = await pool.connect();
  const confirmed = [];
  try {
    await client.query('BEGIN');

    // Auto-confirm threshold: 2h before start_at (matches reminder 2h cadence).
    // Also picks up bookings whose start_at has already passed (late cleanup).
    const rows = await client.query(
      `SELECT b.id, b.business_id, b.group_id
         FROM bookings b
        WHERE b.status = 'modified_pending'
          AND b.start_at < NOW() + INTERVAL '2 hours'
        FOR UPDATE OF b SKIP LOCKED`
    );

    for (const bk of rows.rows) {
      await client.query(
        `UPDATE bookings SET status = 'confirmed', updated_at = NOW()
          WHERE id = $1 AND status = 'modified_pending'`,
        [bk.id]
      );
      confirmed.push({ id: bk.id, business_id: bk.business_id, group_id: bk.group_id });
    }

    await client.query('COMMIT');

    // Post-commit: SSE broadcast so staff dashboard refreshes without F5
    for (const c of confirmed) {
      try {
        broadcast(c.business_id, 'booking_update', { action: 'auto_confirmed_modified', bookingId: c.id });
      } catch (_) { /* SSE best-effort */ }
    }

    return { confirmed: confirmed.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { processExpiredPendingBookings, processAutoConfirmModifiedPending };
