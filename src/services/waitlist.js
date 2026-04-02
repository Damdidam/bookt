const { query, queryWithRLS, pool } = require('./db');
const crypto = require('crypto');
const { broadcast } = require('./sse');
const { sendEmail, buildEmailHTML, escHtml, safeColor } = require('./email');

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
            s.name AS service_name, s.duration_min, s.price_cents
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
  // SVC-V12-012: Use UTC-based date construction for reliable weekday
  const slotDate = new Date(bk.start_at);
  const brusselsDateStr = slotDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const brusselsDate = new Date(brusselsDateStr + 'T12:00:00Z');
  const brusselsDayOfWeek = brusselsDate.getUTCDay();
  const weekday = brusselsDayOfWeek === 0 ? 6 : brusselsDayOfWeek - 1; // 0=Mon

  const brusselsStr = slotDate.toLocaleString('en-GB', { timeZone: 'Europe/Brussels' });
  const brusselsParts = brusselsStr.split(', ');
  const brusselsTimeParts = brusselsParts[1].split(':');
  const brusselsHour = parseInt(brusselsTimeParts[0], 10);
  const timeOfDay = brusselsHour < 12 ? 'morning' : 'afternoon';

  const matches = await queryWithRLS(businessId,
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
      await queryWithRLS(bk.business_id,
        `INSERT INTO notifications (business_id, booking_id, type, status, sent_at)
         VALUES ($1, $2, 'waitlist_match', 'sent', NOW())`,
        [bk.business_id, bookingId]
      );
    } catch (e) { console.warn('[WAITLIST] Notification insert error:', e.message); }

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
    // Check slot is far enough in the future (at least 2h)
    const slotTime = new Date(bk.start_at).getTime();
    if (slotTime < Date.now() + 2 * 60 * 60 * 1000) return { processed: false, reason: 'slot_too_soon' };

    // Verify the slot is still free (no conflicting active bookings)
    const conflict = await queryWithRLS(businessId,
      `SELECT id FROM bookings
       WHERE practitioner_id = $1 AND business_id = $2
         AND status IN ('confirmed', 'pending', 'pending_deposit')
         AND start_at < $4 AND end_at > $3
       LIMIT 1`,
      [bk.practitioner_id, bk.business_id, bk.start_at, bk.end_at]
    );
    if (conflict.rows.length > 0) return { processed: false, reason: 'slot_taken' };

    // FIFO: offer to the first matching entry
    const entry = matches.rows[0];
    const token = crypto.randomBytes(20).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h timer

    const offerResult = await queryWithRLS(businessId,
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

    // Send waitlist offer email
    const offerUrl = `${process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/waitlist/${token}`;
    const slotDateFmt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
    const slotTimeFmt = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

    // Fetch business info for branding
    const bizRow = await queryWithRLS(businessId,
      `SELECT name, theme, address, phone, email FROM businesses WHERE id = $1`, [businessId]
    );
    const biz = bizRow.rows[0] || { name: 'Genda' };

    const slotEndTimeFmt = new Date(new Date(bk.start_at).getTime() + (bk.duration_min || 0) * 60000)
      .toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
    const contactParts = [];
    if (biz.phone) contactParts.push(escHtml(biz.phone));
    if (biz.email) contactParts.push(escHtml(biz.email));
    const contactLine = contactParts.length > 0 ? `<p style="margin:8px 0 0;font-size:13px;color:#9C958E">${contactParts.join(' \u00b7 ')}</p>` : '';

    const offerHtml = buildEmailHTML({
      title: 'Un cr\u00e9neau s\'est lib\u00e9r\u00e9 !',
      preheader: `${bk.service_name} chez ${bk.practitioner_name} \u2014 ${slotDateFmt} \u00e0 ${slotTimeFmt}`,
      bodyHTML: `<p>Bonjour ${escHtml(entry.client_name)},</p>
        <p>Bonne nouvelle ! Un cr\u00e9neau s'est lib\u00e9r\u00e9 pour votre demande :</p>
        <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0 0 6px"><strong>${escHtml(bk.service_name)}</strong> (${bk.duration_min} min)</p>
          ${bk.price_cents ? `<p style="margin:0 0 4px;font-size:14px;color:#3D3832">${(bk.price_cents / 100).toFixed(2).replace('.', ',')} \u20ac</p>` : ''}
          <p style="margin:0 0 4px;font-size:14px;color:#3D3832">Avec ${escHtml(bk.practitioner_name)}</p>
          <p style="margin:0;font-size:14px;color:#3D3832">${escHtml(slotDateFmt)} \u00e0 ${escHtml(slotTimeFmt)} \u2013 ${slotEndTimeFmt}</p>
          ${biz.address ? `<p style="margin:4px 0 0;font-size:14px;color:#3D3832">\ud83d\udccd <a href="https://maps.google.com/?q=${encodeURIComponent(biz.address)}" style="color:#3D3832">${escHtml(biz.address)}</a></p>` : ''}
        </div>${contactLine}
        <p style="font-weight:600;color:#D97706">\u23f1 Vous avez 2 heures pour r\u00e9server ce cr\u00e9neau avant qu'il ne soit propos\u00e9 \u00e0 quelqu'un d'autre.</p>`,
      ctaText: 'R\u00e9server maintenant',
      ctaUrl: offerUrl,
      businessName: biz.name,
      primaryColor: biz.theme?.primary_color,
      footerText: `${biz.name}${biz.address ? ' \u00b7 ' + biz.address : ''} \u00b7 Via Genda.be`
    });

    sendEmail({
      to: entry.client_email,
      toName: entry.client_name,
      subject: `Cr\u00e9neau disponible \u2014 ${bk.service_name} le ${slotDateFmt}`,
      html: offerHtml,
      fromName: biz.name,
      replyTo: biz.email || undefined
    }).catch(e => console.warn('[WAITLIST] Offer email error:', e.message));

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find expired offers
    // SVC-V11-5: Add business_id to JOINs for cross-tenant isolation
    // SVC-V11-14: Add FOR UPDATE SKIP LOCKED to prevent concurrent cron processing
    // SVC-V12-003: Use dedicated client + explicit transaction so locks are held
    const expired = await client.query(
      `SELECT w.*, p.waitlist_mode, p.display_name AS practitioner_name,
              s.duration_min, s.name AS service_name, s.price_cents
       FROM waitlist_entries w
       JOIN practitioners p ON p.id = w.practitioner_id AND p.business_id = w.business_id
       JOIN services s ON s.id = w.service_id AND s.business_id = w.business_id
       WHERE w.status = 'offered'
         AND w.offer_expires_at < NOW()
       FOR UPDATE OF w SKIP LOCKED`
    );

    let processed = 0;

    for (const entry of expired.rows) {
      // Mark as expired
      const expireResult = await client.query(
        `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW()
         WHERE id = $1 AND business_id = $2 AND status = 'offered'
         RETURNING id`,
        [entry.id, entry.business_id]
      );
      if (expireResult.rows.length === 0) continue;

      // If auto mode, offer to next person
      if (entry.waitlist_mode === 'auto' && entry.offer_booking_start) {
        // Bug M13 fix: Use Europe/Brussels timezone instead of server timezone
        // SVC-V12-012: Use UTC-based date construction for reliable weekday
        const slotDate = new Date(entry.offer_booking_start);
        const brusselsDateStr = slotDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const brusselsDate = new Date(brusselsDateStr + 'T12:00:00Z');
        const dayOfWeek = brusselsDate.getUTCDay();
        const weekday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

        const bStr = slotDate.toLocaleString('en-GB', { timeZone: 'Europe/Brussels' });
        const bParts = bStr.split(', ');
        const bTimeParts = bParts[1].split(':');
        const bHour = parseInt(bTimeParts[0], 10);
        const timeOfDay = bHour < 12 ? 'morning' : 'afternoon';

        const next = await client.query(
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
          // Skip if the slot is less than 2 hours away — too late to offer (matches initial offer threshold)
          if (new Date(entry.offer_booking_start) < new Date(Date.now() + 2 * 60 * 60 * 1000)) continue;

          // Verify the slot is still free (no conflicting active bookings)
          const slotConflict = await client.query(
            `SELECT id FROM bookings
             WHERE practitioner_id = $1 AND business_id = $2
               AND status IN ('confirmed', 'pending', 'pending_deposit')
               AND start_at < $4 AND end_at > $3
             LIMIT 1`,
            [entry.practitioner_id, entry.business_id, entry.offer_booking_start, entry.offer_booking_end]
          );
          if (slotConflict.rows.length > 0) continue;

          const token = crypto.randomBytes(20).toString('hex');
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

          const cascadeResult = await client.query(
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
            [token, entry.offer_booking_start, entry.offer_booking_end,
             expiresAt.toISOString(), next.rows[0].id, entry.business_id]
          );
          if (cascadeResult.rows.length === 0) continue;

          // Send cascade offer email to next person
          const cascadeUrl = `${process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/waitlist/${token}`;
          const cascadeDateFmt = new Date(entry.offer_booking_start).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
          const cascadeTimeFmt = new Date(entry.offer_booking_start).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

          const cascadeBiz = await client.query(
            `SELECT name, theme, address, phone, email FROM businesses WHERE id = $1`, [entry.business_id]
          );
          const cbiz = cascadeBiz.rows[0] || { name: 'Genda' };

          const cascadeEndTimeFmt = new Date(new Date(entry.offer_booking_start).getTime() + (entry.duration_min || 0) * 60000)
            .toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
          const cContactParts = [];
          if (cbiz.phone) cContactParts.push(escHtml(cbiz.phone));
          if (cbiz.email) cContactParts.push(escHtml(cbiz.email));
          const cContactLine = cContactParts.length > 0 ? `<p style="margin:8px 0 0;font-size:13px;color:#9C958E">${cContactParts.join(' \u00b7 ')}</p>` : '';

          const cascadeHtml = buildEmailHTML({
            title: 'Un cr\u00e9neau s\'est lib\u00e9r\u00e9 !',
            preheader: `${entry.service_name} chez ${entry.practitioner_name} \u2014 ${cascadeDateFmt} \u00e0 ${cascadeTimeFmt}`,
            bodyHTML: `<p>Bonjour ${escHtml(next.rows[0].client_name)},</p>
              <p>Bonne nouvelle ! Un cr\u00e9neau s'est lib\u00e9r\u00e9 pour votre demande :</p>
              <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
                <p style="margin:0 0 6px"><strong>${escHtml(entry.service_name)}</strong> (${entry.duration_min} min)</p>
                ${entry.price_cents ? `<p style="margin:0 0 4px;font-size:14px;color:#3D3832">${(entry.price_cents / 100).toFixed(2).replace('.', ',')} \u20ac</p>` : ''}
                <p style="margin:0 0 4px;font-size:14px;color:#3D3832">Avec ${escHtml(entry.practitioner_name)}</p>
                <p style="margin:0;font-size:14px;color:#3D3832">${escHtml(cascadeDateFmt)} \u00e0 ${escHtml(cascadeTimeFmt)} \u2013 ${cascadeEndTimeFmt}</p>
                ${cbiz.address ? `<p style="margin:4px 0 0;font-size:14px;color:#3D3832">\ud83d\udccd <a href="https://maps.google.com/?q=${encodeURIComponent(cbiz.address)}" style="color:#3D3832">${escHtml(cbiz.address)}</a></p>` : ''}
              </div>${cContactLine}
              <p style="font-weight:600;color:#D97706">\u23f1 Vous avez 2 heures pour r\u00e9server ce cr\u00e9neau avant qu'il ne soit propos\u00e9 \u00e0 quelqu'un d'autre.</p>`,
            ctaText: 'R\u00e9server maintenant',
            ctaUrl: cascadeUrl,
            businessName: cbiz.name,
            primaryColor: cbiz.theme?.primary_color,
            footerText: `${cbiz.name}${cbiz.address ? ' \u00b7 ' + cbiz.address : ''} \u00b7 Via Genda.be`
          });

          sendEmail({
            to: next.rows[0].client_email,
            toName: next.rows[0].client_name,
            subject: `Cr\u00e9neau disponible \u2014 ${entry.service_name} le ${cascadeDateFmt}`,
            html: cascadeHtml,
            fromName: cbiz.name,
            replyTo: cbiz.email || undefined
          }).catch(e => console.warn('[WAITLIST] Cascade email error:', e.message));

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

    await client.query('COMMIT');
    return { processed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { processWaitlistForCancellation, processExpiredOffers };
