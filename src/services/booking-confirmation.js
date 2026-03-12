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
