/**
 * Deposit Expiry Cron
 *
 * Auto-cancels bookings that are still 'pending_deposit' past their
 * deposit_deadline. Frees the slot for other clients.
 * Mirrors the pattern of booking-confirmation.js.
 */

const { query, pool } = require('./db');
const { broadcast } = require('./sse');

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

    for (const bk of expired.rows) {
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

      // Audit log — deposit expired
      await client.query(
        `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, 'booking', $2, 'deposit_expired',
           '{"status":"pending_deposit","deposit_status":"pending"}',
           $3)`,
        [bk.business_id, bk.id,
         JSON.stringify({ status: 'cancelled', deposit_status: 'cancelled', reason: 'deposit_deadline_exceeded', amount_cents: bk.deposit_amount_cents })]
      );

      processed++;
      cancelledBookingIds.push(bk.id);

      // SSE notification to merchant dashboard
      broadcast(bk.business_id, 'booking_update', {
        action: 'deposit_expired',
        bookingId: bk.id
      });

      // Trigger waitlist processing — the slot is now free
      try {
        const { processWaitlistForCancellation } = require('./waitlist');
        await processWaitlistForCancellation(bk.id, bk.business_id);
      } catch (wlErr) {
        console.warn('[DEPOSIT CRON] Waitlist processing error for booking', bk.id, ':', wlErr.message);
      }
    }

    await client.query('COMMIT');

    // Send cancellation emails AFTER commit (non-blocking)
    for (const bkId of cancelledBookingIds) {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
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
            `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
            [row.group_id, row.business_id]
          );
          if (grp.rows.length > 1) groupServices = grp.rows;
        }
        const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
        const { sendCancellationEmail } = require('./email');
        await sendCancellationEmail({
          booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_paid_at: row.deposit_paid_at },
          business: { name: row.biz_name, slug: row.biz_slug, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
          groupServices
        });
      } catch (emailErr) {
        console.warn('[DEPOSIT CRON] Cancellation email error for booking', bkId, ':', emailErr.message);
      }
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
