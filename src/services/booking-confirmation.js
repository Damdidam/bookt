/**
 * Booking Confirmation Cron
 *
 * Auto-cancels bookings that are still 'pending' past their
 * confirmation_expires_at deadline. Notifies waitlist if applicable.
 */

const { query, pool } = require('./db');
const { broadcast } = require('./sse');
const { getGcPaidCents } = require('./gift-card-refund');

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
      `SELECT id, business_id, service_id, practitioner_id, start_at, end_at, group_id, client_id
       FROM bookings
       WHERE status = 'pending'
         AND (
           (confirmation_expires_at IS NOT NULL AND confirmation_expires_at < NOW())
           OR start_at <= NOW()
         )
       FOR UPDATE SKIP LOCKED`
    );

    let processed = 0;

    for (const bk of expired.rows) {
      // Cancel the booking
      const upd = await client.query(
        `UPDATE bookings SET status = 'cancelled', updated_at = NOW(), confirmation_expires_at = NULL
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [bk.id]
      );
      if (upd.rows.length === 0) continue;

      // If part of a group, cancel siblings too
      if (bk.group_id) {
        await client.query(
          `UPDATE bookings SET status = 'cancelled', updated_at = NOW(), confirmation_expires_at = NULL
           WHERE group_id = $1 AND id != $2 AND status = 'pending'`,
          [bk.group_id, bk.id]
        );
      }

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

      processed++;
      cancelledBookingIds.push({ id: bk.id, business_id: bk.business_id, group_id: bk.group_id, client_id: bk.client_id });
    }

    await client.query('COMMIT');

    // Post-commit side effects: SSE + waitlist (must be AFTER commit for data consistency)
    for (const cancelled of cancelledBookingIds) {
      broadcast(cancelled.business_id, 'booking_update', {
        action: 'expired_confirmation',
        bookingId: cancelled.id
      });
      try {
        const { processWaitlistForCancellation } = require('./waitlist');
        await processWaitlistForCancellation(cancelled.id, cancelled.business_id);
      } catch (wlErr) {
        console.warn('[CONFIRM CRON] Waitlist processing error for booking', cancelled.id, ':', wlErr.message);
      }
    }

    // Send cancellation emails AFTER commit (non-blocking)
    for (const { id: bkId } of cancelledBookingIds) {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
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
        let groupServices = null;
        if (row.group_id) {
          const grp = await query(
            `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                    b.practitioner_id, p.display_name AS practitioner_name
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             LEFT JOIN practitioners p ON p.id = b.practitioner_id
             WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
            [row.group_id, row.business_id]
          );
          if (grp.rows.length > 1) {
            const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
            if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
            groupServices = grp.rows;
          }
        }
        const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
        const gcPaidConfirm = await getGcPaidCents(bkId);
        const { sendCancellationEmail } = require('./email');
        await sendCancellationEmail({
          booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, service_category: row.service_category, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at, deposit_payment_intent_id: row.deposit_payment_intent_id, gc_paid_cents: gcPaidConfirm },
          business: { name: row.biz_name, slug: row.biz_slug, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
          groupServices
        });
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
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
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
            const gcPaidSibConf = await getGcPaidCents(sib.id);
            const { sendCancellationEmail } = require('./email');
            await sendCancellationEmail({
              booking: { start_at: sib.start_at, end_at: sib.end_at, client_name: sib.client_name, client_email: sib.client_email, service_name: sib.service_name, service_category: sib.service_category, practitioner_name: sib.practitioner_name, deposit_required: sib.deposit_required, deposit_status: sib.deposit_status, deposit_amount_cents: sib.deposit_amount_cents, deposit_paid_at: sib.deposit_paid_at, deposit_payment_intent_id: sib.deposit_payment_intent_id, gc_paid_cents: gcPaidSibConf },
              business: { name: sib.biz_name, slug: sib.biz_slug, email: sib.biz_email, address: sib.biz_address, theme: sib.biz_theme, settings: sib.biz_settings }
            });
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

module.exports = { processExpiredPendingBookings };
