const { query } = require('./db');
const crypto = require('crypto');

/**
 * WAITLIST PROCESSOR
 * 
 * Called when a booking is cancelled. Checks if the practitioner has
 * waitlist_mode enabled and processes accordingly.
 * 
 * - manual: notifies the pro that waitlist entries exist for this slot
 * - auto: sends FIFO offer to first matching waitlist entry
 */

/**
 * Process a cancelled booking against the waitlist
 * @param {string} bookingId - The cancelled booking ID
 * @returns {object} { processed: boolean, mode: string, offered_to: string|null }
 */
async function processWaitlistForCancellation(bookingId) {
  // 1. Get booking + practitioner details
  const bkResult = await query(
    `SELECT b.id, b.business_id, b.practitioner_id, b.service_id,
            b.start_at, b.end_at,
            p.waitlist_mode, p.display_name AS practitioner_name,
            s.name AS service_name, s.duration_min
     FROM bookings b
     JOIN practitioners p ON p.id = b.practitioner_id
     JOIN services s ON s.id = b.service_id
     WHERE b.id = $1`,
    [bookingId]
  );

  if (bkResult.rows.length === 0) return { processed: false, reason: 'booking_not_found' };

  const bk = bkResult.rows[0];

  // Check if waitlist is enabled for this practitioner
  if (!bk.waitlist_mode || bk.waitlist_mode === 'off') {
    return { processed: false, reason: 'waitlist_off' };
  }

  // 2. Find matching waitlist entries
  const slotDate = new Date(bk.start_at);
  const weekday = slotDate.getDay() === 0 ? 6 : slotDate.getDay() - 1; // 0=Mon
  const slotHour = slotDate.getHours();
  const timeOfDay = slotHour < 12 ? 'morning' : 'afternoon';

  const matches = await query(
    `SELECT * FROM waitlist_entries
     WHERE practitioner_id = $1
       AND service_id = $2
       AND business_id = $3
       AND status = 'waiting'
       AND (preferred_days @> $4::jsonb)
       AND (preferred_time = 'any' OR preferred_time = $5)
     ORDER BY priority ASC, created_at ASC`,
    [bk.practitioner_id, bk.service_id, bk.business_id,
     JSON.stringify([weekday]), timeOfDay]
  );

  if (matches.rows.length === 0) {
    return { processed: false, reason: 'no_matches' };
  }

  // 3. Process based on mode
  if (bk.waitlist_mode === 'manual') {
    // Just flag that there are matches — the pro will see in dashboard
    // Queue a notification for the pro
    try {
      await query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'waitlist_match', 'queued')`,
        [bk.business_id, bookingId]
      );
    } catch (e) { /* notification type might not exist in CHECK constraint yet */ }

    return {
      processed: true,
      mode: 'manual',
      matches_count: matches.rows.length,
      message: `${matches.rows.length} personne(s) en attente pour ce créneau`
    };
  }

  if (bk.waitlist_mode === 'auto') {
    // FIFO: offer to the first matching entry
    const entry = matches.rows[0];
    const token = crypto.randomBytes(20).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h timer

    await query(
      `UPDATE waitlist_entries SET
        status = 'offered',
        offer_token = $1,
        offer_booking_start = $2,
        offer_booking_end = $3,
        offer_sent_at = NOW(),
        offer_expires_at = $4,
        updated_at = NOW()
       WHERE id = $5`,
      [token, bk.start_at, bk.end_at, expiresAt.toISOString(), entry.id]
    );

    // TODO: Send email via Brevo when connected
    // Email should contain:
    //   - "Un créneau s'est libéré chez {practitioner_name}"
    //   - Service, date/heure
    //   - Link: /waitlist/{token}
    //   - "Vous avez 2h pour réserver"

    return {
      processed: true,
      mode: 'auto',
      offered_to: entry.client_email,
      offer_token: token,
      offer_url: `/waitlist/${token}`,
      expires_at: expiresAt.toISOString(),
      next_in_queue: matches.rows.length - 1
    };
  }

  return { processed: false, reason: 'unknown_mode' };
}

/**
 * Handle expired offers — move to next person in queue
 * Called by cron or on-demand
 */
async function processExpiredOffers() {
  // Find expired offers
  const expired = await query(
    `SELECT w.*, p.waitlist_mode, s.duration_min
     FROM waitlist_entries w
     JOIN practitioners p ON p.id = w.practitioner_id
     JOIN services s ON s.id = w.service_id
     WHERE w.status = 'offered'
       AND w.offer_expires_at < NOW()`
  );

  let processed = 0;

  for (const entry of expired.rows) {
    // Mark as expired
    await query(
      `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW()
       WHERE id = $1`,
      [entry.id]
    );

    // If auto mode, offer to next person
    if (entry.waitlist_mode === 'auto' && entry.offer_booking_start) {
      const slotDate = new Date(entry.offer_booking_start);
      const weekday = slotDate.getDay() === 0 ? 6 : slotDate.getDay() - 1;
      const timeOfDay = slotDate.getHours() < 12 ? 'morning' : 'afternoon';

      const next = await query(
        `SELECT * FROM waitlist_entries
         WHERE practitioner_id = $1
           AND service_id = $2
           AND business_id = $3
           AND status = 'waiting'
           AND (preferred_days @> $4::jsonb)
           AND (preferred_time = 'any' OR preferred_time = $5)
         ORDER BY priority ASC, created_at ASC
         LIMIT 1`,
        [entry.practitioner_id, entry.service_id, entry.business_id,
         JSON.stringify([weekday]), timeOfDay]
      );

      if (next.rows.length > 0) {
        const token = crypto.randomBytes(20).toString('hex');
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

        await query(
          `UPDATE waitlist_entries SET
            status = 'offered',
            offer_token = $1,
            offer_booking_start = $2,
            offer_booking_end = $3,
            offer_sent_at = NOW(),
            offer_expires_at = $4,
            updated_at = NOW()
           WHERE id = $5`,
          [token, entry.offer_booking_start, entry.offer_booking_end,
           expiresAt.toISOString(), next.rows[0].id]
        );

        // TODO: Send email to next person
      }
    }

    processed++;
  }

  return { processed };
}

module.exports = { processWaitlistForCancellation, processExpiredOffers };
