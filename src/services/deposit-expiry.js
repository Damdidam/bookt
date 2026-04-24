/**
 * Deposit Expiry Cron
 *
 * Auto-cancels bookings that are still 'pending_deposit' past their
 * deposit_deadline. Frees the slot for other clients.
 * Mirrors the pattern of booking-confirmation.js.
 */

const { query, pool } = require('./db');
const { broadcast } = require('./sse');
const { refundGiftCardForBooking, getGcPaidCents } = require('./gift-card-refund');
const { refundPassForBooking } = require('./pass-refund');
const { calSyncDelete } = require('../routes/staff/bookings-helpers');

/**
 * Process expired pending-deposit bookings.
 * Called by setInterval in server.js every ~2 min.
 * @returns {Promise<{processed: number}>}
 */
async function processExpiredDeposits() {
  const client = await pool.connect();
  const cancelledBookingIds = [];
  try {
    await client.query('BEGIN');

    // Find pending_deposit bookings whose deposit deadline has passed
    // BUG-DEP-NULL fix: include deposit_status IS NULL so zombie bookings with
    // uninitialized status (pre-migration or data corruption) get cleaned up.
    // BL-03 hotfix (scan 3) : exclude disputed_at IS NOT NULL — parity avec staff
    // cancel (bookings-status.js:520) et public cancel (booking-actions.js:51).
    // Sans ce guard, cron émet refund Stripe sur dispute en cours → pro paye 2×
    // (refund + dispute perdu Stripe).
    const expired = await client.query(
      `SELECT id, business_id, service_id, practitioner_id, start_at, end_at,
              group_id, client_id, deposit_amount_cents, deposit_payment_intent_id
       FROM bookings
       WHERE status = 'pending_deposit'
         AND (deposit_status = 'pending' OR deposit_status IS NULL)
         AND deposit_deadline IS NOT NULL
         AND deposit_deadline < NOW()
         AND disputed_at IS NULL
       FOR UPDATE SKIP LOCKED`
    );

    let processed = 0;

    for (let i = 0; i < expired.rows.length; i++) {
      const bk = expired.rows[i];
      await client.query(`SAVEPOINT sp_${i}`);
      try {
      // Cancel the booking + mark deposit as cancelled (never paid)
      const upd = await client.query(
        `UPDATE bookings
         SET status = 'cancelled',
             deposit_status = 'cancelled',
             cancel_reason = 'Acompte non versé dans le délai imparti',
             updated_at = NOW()
         WHERE id = $1 AND status = 'pending_deposit'
         RETURNING id`,
        [bk.id]
      );
      if (upd.rows.length === 0) continue;

      // If part of a group, cancel siblings too
      if (bk.group_id) {
        await client.query(
          `UPDATE bookings
           SET status = 'cancelled',
               deposit_status = CASE WHEN deposit_status = 'pending' THEN 'cancelled' ELSE deposit_status END,
               cancel_reason = 'Acompte non versé dans le délai imparti (groupe)',
               updated_at = NOW()
           WHERE group_id = $1 AND id != $2 AND status = 'pending_deposit'`,
          [bk.group_id, bk.id]
        );
      }

      // Refund any gift card debits
      const gcRefundExp = await refundGiftCardForBooking(bk.id, client) || { refunded: 0 };
      if (bk.group_id) {
        const sibGc = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
          [bk.group_id, bk.id]
        );
        for (const sib of sibGc.rows) { await refundGiftCardForBooking(sib.id, client).catch(e => console.warn('[GC REFUND]', e.message)); }
      }

      // Refund pass sessions
      let passRefundExp = { refunded: 0 };
      try { passRefundExp = await refundPassForBooking(bk.id, client) || { refunded: 0 }; } catch (e) { console.warn('[PASS REFUND]', e.message); }
      if (bk.group_id) {
        const sibPass = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
          [bk.group_id, bk.id]
        );
        for (const sib of sibPass.rows) { await refundPassForBooking(sib.id, client).catch(e => console.warn('[PASS REFUND]', e.message)); }
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
      } catch (e) { console.warn('[INVOICE VOID] deposit cron error:', e.message); }

      // Audit log — deposit expired
      await client.query(
        `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, 'booking', $2, 'deposit_expired',
           '{"status":"pending_deposit","deposit_status":"pending"}',
           $3)`,
        [bk.business_id, bk.id,
         JSON.stringify({ status: 'cancelled', deposit_status: 'cancelled', reason: 'deposit_deadline_exceeded', amount_cents: bk.deposit_amount_cents })]
      );

      // M9: Increment expired_pending_count strike (mirrors booking-confirmation.js)
      if (bk.client_id) {
        await client.query(
          `UPDATE clients SET expired_pending_count = expired_pending_count + 1,
            last_expired_pending_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND business_id = $2`,
          [bk.client_id, bk.business_id]
        );
      }
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

      processed++;
      cancelledBookingIds.push({ id: bk.id, business_id: bk.business_id, group_id: bk.group_id, client_id: bk.client_id, _gcRefunded: gcRefundExp.refunded || 0, _passRefunded: (passRefundExp.refunded || 0) !== 0, _stripeSessionId: bk.deposit_payment_intent_id });
      } catch (spErr) {
        await client.query(`ROLLBACK TO sp_${i}`);
        console.error('[DEPOSIT CRON] Failed to process booking', bk.id, spErr.message);
        continue;
      }
    }

    await client.query('COMMIT');

    // Post-commit side effects: SSE + waitlist (must be AFTER commit for data consistency)
    // BUG-CRON-CACHE fix: invalidate minisite cache per-business so freed slots
    // appear immediately on public pages (parity with staff cancel + public cancel).
    const _invalidatedBizIds = new Set();
    for (const cancelled of cancelledBookingIds) {
      broadcast(cancelled.business_id, 'booking_update', {
        action: 'deposit_expired',
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
        // BUG-CRON-SIB fix: also notify waitlist for sibling slots freed by this cancel
        // (group members had their own start_at / practitioner, waitlist may have matches).
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
        console.warn('[DEPOSIT CRON] Waitlist processing error for booking', cancelled.id, ':', wlErr.message);
      }
    }

    // H3 fix: Expire open Stripe checkout sessions so client can't pay after cancellation
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      const stripe = require('stripe')(stripeKey);
      for (const cancelled of cancelledBookingIds) {
        if (cancelled._stripeSessionId && cancelled._stripeSessionId.startsWith('cs_')) {
          try { await stripe.checkout.sessions.expire(cancelled._stripeSessionId); } catch (_) {}
        }
      }
    }

    // Delete external calendar events for cancelled bookings (primary + siblings)
    // BUG-CRON-SIB fix: external calendar events for sibling bookings were orphaned —
    // Google/Outlook still displayed them as active even after DB cancel.
    for (const cancelled of cancelledBookingIds) {
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
    }

    // M3 fix: Queue pro notifications in parallel — each row independent
    await Promise.all(cancelledBookingIds.map(cancelled =>
      query(`INSERT INTO notifications (business_id, booking_id, type, status) VALUES ($1, $2, 'email_cancellation_pro', 'queued')`, [cancelled.business_id, cancelled.id])
        .catch(e => console.warn('[DEPOSIT CRON] Pro notification queue error:', e.message))
    ));

    // H4 fix: missed-email sweep — pick up cron-cancelled bookings (last 24h) whose email was
    // never sent (pod crashed between COMMIT and send). Idempotent via cancellation_email_sent_at.
    try {
      // Regression fix (Batch 12): also match sibling '(groupe)' variant stored at L63
      // Q9 fix: fetch business_id + group_id + client_id pour éviter les "Invalid business ID" en aval
      const missed = await query(
        `SELECT id, business_id, group_id, client_id FROM bookings
          WHERE status = 'cancelled'
            AND cancellation_email_sent_at IS NULL
            AND updated_at > NOW() - INTERVAL '24 hours'
            AND cancel_reason LIKE 'Acompte non versé dans le délai imparti%'
          LIMIT 50`
      );
      for (const m of missed.rows) {
        if (!cancelledBookingIds.find(c => c.id === m.id)) {
          cancelledBookingIds.push({ id: m.id, business_id: m.business_id, group_id: m.group_id, client_id: m.client_id, _gcRefunded: 0, _passRefunded: false, _stripeSessionId: null, _missed: true });
        }
      }
      if (missed.rows.length > 0) console.log(`[DEPOSIT CRON] Picked up ${missed.rows.length} missed email(s) from previous tick`);
    } catch (e) { console.warn('[DEPOSIT CRON] missed-email sweep error:', e.message); }

    // Send cancellation emails AFTER commit (non-blocking)
    for (const { id: bkId, _gcRefunded, _passRefunded } of cancelledBookingIds) {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
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
            `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
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
        const gcPaidExpiry = await getGcPaidCents(bkId);
        const { sendCancellationEmail } = require('./email');
        await sendCancellationEmail({
          booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, service_category: row.service_category, custom_label: row.custom_label, comment_client: row.comment_client, service_price_cents: row.service_price_cents, booked_price_cents: row.booked_price_cents, discount_pct: row.discount_pct, duration_min: row.duration_min, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidExpiry, gc_refunded_cents: _gcRefunded || 0, pass_refunded: !!_passRefunded, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct, cancel_reason: 'Acompte non payé dans le délai imparti' },
          business: { id: row.business_id, name: row.biz_name, slug: row.biz_slug, email: row.biz_email, phone: row.biz_phone, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
          groupServices
        });
        // H4 fix: mark email sent so a crash here doesn't trigger a duplicate next tick.
        await query(`UPDATE bookings SET cancellation_email_sent_at = NOW() WHERE id = $1`, [bkId]).catch(() => {});
      } catch (emailErr) {
        console.warn('[DEPOSIT CRON] Cancellation email error for booking', bkId, ':', emailErr.message);
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
        // H6/H8 parity fix: compute groupServices once per cancelled.group_id so siblings see the full combo
        let _sibGroupServicesExp = null;
        const _sibGrpExp = await query(
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
        if (_sibGrpExp.rows.length > 1) {
          const _sibPIdsExp = new Set(_sibGrpExp.rows.map(r => r.practitioner_id));
          if (_sibPIdsExp.size <= 1) _sibGrpExp.rows.forEach(r => { r.practitioner_name = null; });
          _sibGrpExp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
          _sibGroupServicesExp = _sibGrpExp.rows;
        }
        for (const sib of siblings.rows) {
          try {
            const gcPaidSib = await getGcPaidCents(sib.id);
            // H8 fix: lookup actual refunds + cancel_reason so sibling email matches primary cron
            const _gcRefSibExp = await query(`SELECT COALESCE(SUM(amount_cents), 0)::int AS amt FROM gift_card_transactions WHERE booking_id = $1 AND type = 'refund'`, [sib.id]);
            const _passRefSibExp = await query(`SELECT 1 FROM pass_transactions WHERE booking_id = $1 AND type = 'refund' LIMIT 1`, [sib.id]);
            // B#1 fix: pass the RAW service_price_cents so the template can detect LM
            // (rawPrice > bookedPrice) and render the "Last Minute -X%" struck-through banner.
            // Previously we pre-applied discount_pct here → template saw raw==booked → no LM banner.
            const { sendCancellationEmail } = require('./email');
            await sendCancellationEmail({
              // H7 fix: forward custom_label so sibling email shows personalised service label
              booking: { start_at: sib.start_at, end_at: sib.end_at, client_name: sib.client_name, client_email: sib.client_email, service_name: sib.service_name, service_category: sib.service_category, custom_label: sib.custom_label, comment_client: sib.comment_client, service_price_cents: sib.service_price_cents, booked_price_cents: sib.booked_price_cents, discount_pct: sib.discount_pct, duration_min: sib.duration_min, practitioner_name: sib.practitioner_name, deposit_required: sib.deposit_required, deposit_status: sib.deposit_status, deposit_amount_cents: sib.deposit_amount_cents, deposit_paid_at: sib.deposit_paid_at, deposit_payment_intent_id: sib.deposit_payment_intent_id, gc_paid_cents: gcPaidSib, gc_refunded_cents: _gcRefSibExp.rows[0]?.amt || 0, pass_refunded: _passRefSibExp.rows.length > 0, promotion_label: sib.promotion_label, promotion_discount_cents: sib.promotion_discount_cents, promotion_discount_pct: sib.promotion_discount_pct, cancel_reason: 'Acompte non payé dans le délai imparti' },
              business: { id: cancelled.business_id, name: sib.biz_name, slug: sib.biz_slug, email: sib.biz_email, phone: sib.biz_phone, address: sib.biz_address, theme: sib.biz_theme, settings: sib.biz_settings },
              groupServices: _sibGroupServicesExp
            });
            // Batch 12 regression fix: mark sibling sent flag so sweep won't duplicate next tick
            await query(`UPDATE bookings SET cancellation_email_sent_at = NOW() WHERE id = $1`, [sib.id]).catch(() => {});
          } catch (e) { console.warn('[DEPOSIT CRON] Sibling email error:', e.message); }
        }
      } catch (e) { console.warn('[DEPOSIT CRON] Sibling query error:', e.message); }
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
 * Send deposit reminder emails 48h before deadline.
 * email-deposit.js::sendDepositReminderEmail was defined + exported but never
 * called (C#2 orphan fix). This cron runs every 10 min and picks bookings whose
 * deadline falls in [NOW+47h, NOW+49h] — wider-than-2h window covers cron jitter.
 * Sets deposit_reminder_sent=true to guarantee one-shot.
 */
async function processDepositReminders() {
  const rows = await query(
    `SELECT b.id, b.business_id, b.public_token, b.start_at, b.end_at,
            b.deposit_amount_cents, b.deposit_deadline, b.group_id,
            b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct,
            b.booked_price_cents, b.discount_pct,
            c.full_name AS client_name, c.email AS client_email,
            CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
            s.category AS service_category,
            COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
            COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
            p.display_name AS practitioner_name,
            biz.name AS biz_name, biz.slug AS biz_slug, biz.email AS biz_email,
            biz.phone AS biz_phone, biz.address AS biz_address,
            biz.theme AS biz_theme, biz.settings AS biz_settings
       FROM bookings b
       JOIN clients c ON c.id = b.client_id
       JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
      WHERE b.status = 'pending_deposit'
        AND b.deposit_status = 'pending'
        AND COALESCE(b.deposit_reminder_sent, false) = false
        AND b.deposit_deadline IS NOT NULL
        AND b.deposit_deadline BETWEEN NOW() + INTERVAL '47 hours' AND NOW() + INTERVAL '49 hours'
        AND c.email IS NOT NULL
      LIMIT 50`
  );

  let sent = 0;
  for (const bk of rows.rows) {
    try {
      // Mark first (atomic flip) to prevent double-send if cron double-fires.
      const flip = await query(
        `UPDATE bookings SET deposit_reminder_sent = true, updated_at = NOW()
         WHERE id = $1 AND COALESCE(deposit_reminder_sent, false) = false
         RETURNING id`,
        [bk.id]
      );
      if (flip.rowCount === 0) continue;

      const { sendDepositReminderEmail } = require('./email');
      const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
      const depositUrl = `${baseUrl}/deposit/${bk.public_token}`;
      const payUrl = `${baseUrl}/api/public/deposit/${bk.public_token}/pay`;

      // Gather group siblings for multi-service display (same pattern as sendDepositRequestEmail)
      let groupServices = null;
      if (bk.group_id) {
        const grp = await query(
          `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  COALESCE(sv.price_cents, s.price_cents) AS price_cents,
                  b2.discount_pct,
                  p.display_name AS practitioner_name
             FROM bookings b2
             LEFT JOIN services s ON s.id = b2.service_id
             LEFT JOIN service_variants sv ON sv.id = b2.service_variant_id
             LEFT JOIN practitioners p ON p.id = b2.practitioner_id
            WHERE b2.group_id = $1 AND b2.business_id = $2 AND b2.status NOT IN ('cancelled')
            ORDER BY b2.group_order, b2.start_at`,
          [bk.group_id, bk.business_id]
        );
        if (grp.rows.length > 1) {
          grp.rows.forEach(r => {
            if (r.discount_pct && r.price_cents) {
              r.original_price_cents = r.price_cents;
              r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100);
            }
          });
          groupServices = grp.rows;
        }
      }

      await sendDepositReminderEmail({
        booking: {
          start_at: bk.start_at, end_at: bk.end_at,
          client_name: bk.client_name, client_email: bk.client_email,
          service_name: bk.service_name, service_category: bk.service_category,
          service_price_cents: bk.service_price_cents,
          booked_price_cents: bk.booked_price_cents, discount_pct: bk.discount_pct,
          duration_min: bk.duration_min, practitioner_name: bk.practitioner_name,
          deposit_amount_cents: bk.deposit_amount_cents,
          deposit_deadline: bk.deposit_deadline,
          promotion_label: bk.promotion_label,
          promotion_discount_cents: bk.promotion_discount_cents,
          promotion_discount_pct: bk.promotion_discount_pct
        },
        business: {
          id: bk.business_id,
          name: bk.biz_name, slug: bk.biz_slug, email: bk.biz_email,
          phone: bk.biz_phone, address: bk.biz_address,
          theme: bk.biz_theme, settings: bk.biz_settings
        },
        depositUrl, payUrl, groupServices
      });

      try {
        await query(
          `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at)
           VALUES ($1, $2, 'email_deposit_reminder', $3, 'sent', NOW())`,
          [bk.business_id, bk.id, bk.client_email]
        );
      } catch (_) { /* best-effort audit */ }
      sent++;
    } catch (e) {
      console.warn(`[DEPOSIT REMINDER] Booking ${bk.id} email error:`, e.message);
      // Rollback flag so we can retry next cycle — the reminder matters more
      // than risking a duplicate (Brevo bounces on identical Message-ID anyway).
      await query(
        `UPDATE bookings SET deposit_reminder_sent = false WHERE id = $1`,
        [bk.id]
      ).catch(() => {});
    }
  }

  return { sent };
}

module.exports = { processExpiredDeposits, processDepositReminders };
