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
    const expired = await client.query(
      `SELECT id, business_id, service_id, practitioner_id, start_at, end_at,
              group_id, client_id, deposit_amount_cents
       FROM bookings
       WHERE status = 'pending_deposit'
         AND deposit_status = 'pending'
         AND deposit_deadline IS NOT NULL
         AND deposit_deadline < NOW()
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
      await refundGiftCardForBooking(bk.id, client);
      if (bk.group_id) {
        const sibGc = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
          [bk.group_id, bk.id]
        );
        for (const sib of sibGc.rows) { await refundGiftCardForBooking(sib.id, client).catch(e => console.warn('[GC REFUND]', e.message)); }
      }

      // Refund pass sessions
      await refundPassForBooking(bk.id, client).catch(e => console.warn('[PASS REFUND]', e.message));
      if (bk.group_id) {
        const sibPass = await client.query(
          `SELECT id FROM bookings WHERE group_id = $1 AND id != $2 AND status = 'cancelled'`,
          [bk.group_id, bk.id]
        );
        for (const sib of sibPass.rows) { await refundPassForBooking(sib.id, client).catch(e => console.warn('[PASS REFUND]', e.message)); }
      }

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
      cancelledBookingIds.push({ id: bk.id, business_id: bk.business_id, group_id: bk.group_id, client_id: bk.client_id });
      } catch (spErr) {
        await client.query(`ROLLBACK TO sp_${i}`);
        console.error('[DEPOSIT CRON] Failed to process booking', bk.id, spErr.message);
        continue;
      }
    }

    await client.query('COMMIT');

    // Post-commit side effects: SSE + waitlist (must be AFTER commit for data consistency)
    for (const cancelled of cancelledBookingIds) {
      broadcast(cancelled.business_id, 'booking_update', {
        action: 'deposit_expired',
        bookingId: cancelled.id
      });
      try {
        const { processWaitlistForCancellation } = require('./waitlist');
        await processWaitlistForCancellation(cancelled.id, cancelled.business_id);
      } catch (wlErr) {
        console.warn('[DEPOSIT CRON] Waitlist processing error for booking', cancelled.id, ':', wlErr.message);
      }
    }

    // Send cancellation emails AFTER commit (non-blocking)
    for (const { id: bkId } of cancelledBookingIds) {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug, biz.settings AS biz_settings
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
        // Apply last-minute discount to service_price_cents
        const _adjSvcPriceExp = row.discount_pct ? Math.round((row.service_price_cents || 0) * (100 - row.discount_pct) / 100) : (row.service_price_cents || 0);
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
            grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); });
            groupServices = grp.rows;
          }
        }
        const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
        const gcPaidExpiry = await getGcPaidCents(bkId);
        const { sendCancellationEmail } = require('./email');
        await sendCancellationEmail({
          booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, service_category: row.service_category, service_price_cents: _adjSvcPriceExp, duration_min: row.duration_min, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidExpiry, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct },
          business: { name: row.biz_name, slug: row.biz_slug, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
          groupServices
        });
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
                  b.promotion_label, b.promotion_discount_cents, b.promotion_discount_pct, b.discount_pct,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
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
        for (const sib of siblings.rows) {
          try {
            const gcPaidSib = await getGcPaidCents(sib.id);
            const _adjSibPriceExp = sib.discount_pct ? Math.round((sib.service_price_cents || 0) * (100 - sib.discount_pct) / 100) : (sib.service_price_cents || 0);
            const { sendCancellationEmail } = require('./email');
            await sendCancellationEmail({
              booking: { start_at: sib.start_at, end_at: sib.end_at, client_name: sib.client_name, client_email: sib.client_email, service_name: sib.service_name, service_category: sib.service_category, service_price_cents: _adjSibPriceExp, duration_min: sib.duration_min, practitioner_name: sib.practitioner_name, deposit_required: sib.deposit_required, deposit_status: sib.deposit_status, deposit_amount_cents: sib.deposit_amount_cents, deposit_paid_at: sib.deposit_paid_at, deposit_payment_intent_id: sib.deposit_payment_intent_id, gc_paid_cents: gcPaidSib, promotion_label: sib.promotion_label, promotion_discount_cents: sib.promotion_discount_cents, promotion_discount_pct: sib.promotion_discount_pct },
              business: { name: sib.biz_name, slug: sib.biz_slug, email: sib.biz_email, address: sib.biz_address, theme: sib.biz_theme, settings: sib.biz_settings }
            });
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

module.exports = { processExpiredDeposits };
