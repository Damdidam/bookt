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
      // Cancel the booking + mark deposit as cancelled (kept by merchant)
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
    return { processed };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { processExpiredDeposits };
