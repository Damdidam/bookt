const { query, queryWithRLS } = require('./db');
const crypto = require('crypto');
const { broadcast } = require('./sse');

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
 * @param {string} businessId - The business ID (defense-in-depth isolation)
 * @returns {object} { processed: boolean, mode: string, offered_to: string|null }
 */
async function processWaitlistForCancellation(bookingId, businessId) {
  // 1. Get booking + practitioner details
  // Bug H7 fix: Add business_id filter for tenant isolation
  const bkResult = await queryWithRLS(businessId,
    `SELECT b.id, b.business_id, b.practitioner_id, b.service_id,
            b.start_at, b.end_at,
            p.waitlist_mode, p.display_name AS practitioner_name,
            s.name AS service_name, s.duration_min
     FROM bookings b
     JOIN practitioners p ON p.id = b.practitioner_id
     JOIN services s ON s.id = b.service_id
     WHERE b.id = $1 AND b.business_id = $2`,
    [bookingId, businessId]
  );

  if (bkResult.rows.length === 0) return { processed: false, reason: 'booking_not_found' };

  const bk = bkResult.rows[0];

  // Check if waitlist is enabled for this practitioner
  if (!bk.waitlist_mode || bk.waitlist_mode === 'off') {
    return { processed: false, reason: 'waitlist_off' };
  }

  // 2. Find matching waitlist entries
  // Bug M13 fix: Use Europe/Brussels timezone instead of server timezone
  const slotDate = new Date(bk.start_at);
  const brusselsStr = slotDate.toLocaleString('en-GB', { timeZone: 'Europe/Brussels' });
  // en-GB format: "DD/MM/YYYY, HH:MM:SS"
  const brusselsParts = brusselsStr.split(', ');
  const brusselsTimeParts = brusselsParts[1].split(':');
  const brusselsHour = parseInt(brusselsTimeParts[0], 10);
  // Get Brussels weekday: create a Date from the Brussels date string to extract the day
  const brusselsDateParts = brusselsParts[0].split('/');
  const brusselsDate = new Date(`${brusselsDateParts[2]}-${brusselsDateParts[1]}-${brusselsDateParts[0]}T${brusselsParts[1]}`);
  const brusselsDayOfWeek = brusselsDate.getDay();
  const weekday = brusselsDayOfWeek === 0 ? 6 : brusselsDayOfWeek - 1; // 0=Mon
  const timeOfDay = brusselsHour < 12 ? 'morning' : 'afternoon';

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

    broadcast(bk.business_id, 'waitlist_match', {
      mode: 'manual',
      matches_count: matches.rows.length,
      practitioner_name: bk.practitioner_name,
      service_name: bk.service_name,
      slot_start: bk.start_at,
      slot_end: bk.end_at
    });

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

    const offerResult = await query(
      `UPDATE waitlist_entries SET
        status = 'offered',
        offer_token = $1,
        offer_booking_start = $2,
        offer_booking_end = $3,
        offer_sent_at = NOW(),
        offer_expires_at = $4,
        updated_at = NOW()
       WHERE id = $5 AND business_id = $6 AND status = 'waiting'
       RETURNING id`,
      [token, bk.start_at, bk.end_at, expiresAt.toISOString(), entry.id, bk.business_id]
    );

    if (offerResult.rows.length === 0) {
      return { processed: false, reason: 'entry_no_longer_waiting' };
    }

    // TODO: Send email via Brevo when connected
    // Email should contain:
    //   - "Un créneau s'est libéré chez {practitioner_name}"
    //   - Service, date/heure
    //   - Link: /waitlist/{token}
    //   - "Vous avez 2h pour réserver"

    broadcast(bk.business_id, 'waitlist_match', {
      mode: 'auto',
      client_name: entry.client_name,
      practitioner_name: bk.practitioner_name,
      service_name: bk.service_name,
      slot_start: bk.start_at,
      next_in_queue: matches.rows.length - 1
    });

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
    const expireResult = await query(
      `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW()
       WHERE id = $1 AND business_id = $2 AND status = 'offered'
       RETURNING id`,
      [entry.id, entry.business_id]
    );
    if (expireResult.rows.length === 0) continue;

    // If auto mode, offer to next person
    if (entry.waitlist_mode === 'auto' && entry.offer_booking_start) {
      // Bug M13 fix: Use Europe/Brussels timezone instead of server timezone
      const slotDate = new Date(entry.offer_booking_start);
      const bStr = slotDate.toLocaleString('en-GB', { timeZone: 'Europe/Brussels' });
      const bParts = bStr.split(', ');
      const bTimeParts = bParts[1].split(':');
      const bHour = parseInt(bTimeParts[0], 10);
      const bDateParts = bParts[0].split('/');
      const bDate = new Date(`${bDateParts[2]}-${bDateParts[1]}-${bDateParts[0]}T${bParts[1]}`);
      const bDayOfWeek = bDate.getDay();
      const weekday = bDayOfWeek === 0 ? 6 : bDayOfWeek - 1;
      const timeOfDay = bHour < 12 ? 'morning' : 'afternoon';

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
        // Skip if the slot is less than 1 hour away — too late to offer
        if (new Date(entry.offer_booking_start) < new Date(Date.now() + 60 * 60 * 1000)) continue;

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
           WHERE id = $5 AND business_id = $6`,
          [token, entry.offer_booking_start, entry.offer_booking_end,
           expiresAt.toISOString(), next.rows[0].id, entry.business_id]
        );

        // TODO: Send email to next person

        broadcast(entry.business_id, 'waitlist_match', {
          mode: 'auto_cascade',
          client_name: next.rows[0].client_name,
          expired_from: entry.client_name,
          slot_start: entry.offer_booking_start
        });
      }
    }

    processed++;
  }

  return { processed };
}

module.exports = { processWaitlistForCancellation, processExpiredOffers };
