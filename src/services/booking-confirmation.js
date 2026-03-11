/**
 * Booking Confirmation Cron
 *
 * Auto-cancels bookings that are still 'pending' past their
 * confirmation_expires_at deadline. Notifies waitlist if applicable.
 */

const { query, pool } = require('./db');
const { broadcast } = require('./sse');

/**
 * Process expired unconfirmed bookings.
 * Called by setInterval in server.js every ~2 min.
 * @returns {Promise<{processed: number}>}
 */
async function processExpiredPendingBookings() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find pending bookings whose confirmation window has elapsed
    // OR whose start time has already passed (no-show prevention)
    const expired = await client.query(
      `SELECT id, business_id, service_id, practitioner_id, start_at, end_at, group_id
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

      processed++;

      // SSE notification to merchant dashboard
      broadcast(bk.business_id, 'booking_update', {
        action: 'expired_confirmation',
        bookingId: bk.id
      });

      // Trigger waitlist processing (non-blocking, best-effort)
      try {
        const { processWaitlistForCancellation } = require('./waitlist');
        await processWaitlistForCancellation(bk.id, bk.business_id);
      } catch (wlErr) {
        console.warn('[CONFIRM CRON] Waitlist processing error for booking', bk.id, ':', wlErr.message);
      }
    }

    await client.query('COMMIT');
    return { processed };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { processExpiredPendingBookings };
