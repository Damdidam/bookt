const express = require('express');
const router = express.Router();
const { query, pool } = require('../../services/db');
const { bookingLimiter } = require('../../middleware/rate-limiter');
const { UUID_RE, shouldRequireDeposit, computeDepositDeadline, BASE_URL, isDisposableEmail } = require('./helpers');
const { broadcast } = require('../../services/sse');
const { checkBookingConflicts } = require('../staff/bookings-helpers');

// ============================================================
// WAITLIST — PUBLIC ENDPOINTS
// ============================================================

// POST /api/public/:slug/waitlist — client joins waitlist
router.post('/:slug/waitlist', bookingLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { practitioner_id, service_id, service_variant_id, client_name, client_email,
            client_phone, preferred_days, preferred_time, note } = req.body;

    if (!practitioner_id || !service_id || !client_name || !client_email) {
      return res.status(400).json({ error: 'Praticien, prestation, nom et email requis' });
    }

    if (typeof client_name !== 'string' || typeof client_email !== 'string') {
      return res.status(400).json({ error: 'Les champs client doivent être des chaînes de caractères' });
    }
    if (client_phone && typeof client_phone !== 'string') {
      return res.status(400).json({ error: 'Les champs client doivent être des chaînes de caractères' });
    }

    if (!UUID_RE.test(practitioner_id)) {
      return res.status(400).json({ error: 'practitioner_id invalide' });
    }
    // Validate service_id is a single valid UUID (reject arrays or non-string values)
    if (typeof service_id !== 'string' || !UUID_RE.test(service_id)) {
      return res.status(400).json({ error: 'service_id invalide' });
    }
    // BUG-WL-VARIANT fix: capture the variant choice so LM/deposit/email use the right price
    if (service_variant_id !== undefined && service_variant_id !== null && !UUID_RE.test(service_variant_id)) {
      return res.status(400).json({ error: 'service_variant_id invalide' });
    }

    if (client_name.length > 200) return res.status(400).json({ error: 'Nom trop long (max 200)' });
    if (client_email.length > 320) return res.status(400).json({ error: 'Email trop long' });
    if (client_phone && client_phone.length > 30) return res.status(400).json({ error: 'Téléphone trop long' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(client_email)) return res.status(400).json({ error: 'Format email invalide' });
    if (isDisposableEmail(client_email)) return res.status(400).json({ error: 'Les adresses email temporaires ne sont pas acceptées' });
    if (client_phone && !/^\+?[\d\s\-().]{6,}$/.test(client_phone)) return res.status(400).json({ error: 'Format téléphone invalide' });

    if (preferred_days) {
      if (!Array.isArray(preferred_days) || preferred_days.length > 7 || !preferred_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
        return res.status(400).json({ error: 'preferred_days invalide' });
      }
    }

    // L9: Typeof check — reject non-string note
    if (note !== undefined && typeof note !== 'string') {
      return res.status(400).json({ error: 'note invalide' });
    }
    if (note && note.length > 300) {
      return res.status(400).json({ error: 'Note trop longue (max 300)' });
    }

    const VALID_TIMES = ['any', 'morning', 'afternoon'];
    if (preferred_time && !VALID_TIMES.includes(preferred_time)) {
      return res.status(400).json({ error: 'preferred_time invalide' });
    }

    const bizResult = await query(
      `SELECT id, plan FROM businesses WHERE slug = $1 AND is_active = true`, [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });
    const biz = bizResult.rows[0];
    if ((biz.plan || 'free') === 'free') return res.status(403).json({ error: 'upgrade_required', message: "La liste d'attente est disponible avec le plan Pro." });
    const businessId = biz.id;

    // Check practitioner has waitlist enabled
    const pracResult = await query(
      `SELECT waitlist_mode FROM practitioners WHERE id = $1 AND business_id = $2 AND is_active = true AND booking_enabled = true`,
      [practitioner_id, businessId]
    );
    if (pracResult.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    if (pracResult.rows[0].waitlist_mode === 'off') {
      return res.status(400).json({ error: 'La liste d\'attente n\'est pas activée pour ce praticien' });
    }

    // Validate service exists, is active, and booking-enabled
    const svcCheck = await query(
      `SELECT id FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [service_id, businessId]
    );
    if (svcCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Prestation introuvable ou non disponible à la réservation' });
    }
    // Validate variant (if provided) belongs to the service
    if (service_variant_id) {
      const varCheck = await query(
        `SELECT id FROM service_variants WHERE id = $1 AND service_id = $2`,
        [service_variant_id, service_id]
      );
      if (varCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Variante introuvable pour cette prestation' });
      }
    }

    // Bug M9 fix: Atomic INSERT with duplicate check + priority calculation
    // Uses a subquery to avoid race conditions between check/priority/insert
    // Also includes business_id in the duplicate check for proper tenant isolation
    const result = await query(
      `INSERT INTO waitlist_entries
        (business_id, practitioner_id, service_id, service_variant_id, client_name, client_email,
         client_phone, preferred_days, preferred_time, note, priority)
       SELECT $1::uuid, $2::uuid, $3::uuid, $10::uuid, $4::text, $5::text, $6::text, $7::jsonb, $8::text, $9::text,
              COALESCE(MAX(we.priority), 0) + 1
       FROM waitlist_entries we
       WHERE we.practitioner_id = $2::uuid AND we.service_id = $3::uuid AND we.status = 'waiting'
       AND NOT EXISTS (
         SELECT 1 FROM waitlist_entries dup
         WHERE dup.practitioner_id = $2::uuid AND dup.service_id = $3::uuid
           AND dup.service_variant_id IS NOT DISTINCT FROM $10::uuid
           AND LOWER(dup.client_email) = LOWER($5::text) AND dup.status = 'waiting'
           AND dup.business_id = $1::uuid
       )
       RETURNING id, priority, created_at`,
      [businessId, practitioner_id, service_id, client_name, client_email,
       client_phone || null,
       JSON.stringify(preferred_days || [0,1,2,3,4]),
       preferred_time || 'any',
       note || null,
       service_variant_id || null]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'Vous êtes déjà sur la liste d\'attente' });
    }

    res.status(201).json({
      waitlisted: true,
      position: result.rows[0].priority,
      entry_id: result.rows[0].id
    });
  } catch (err) { next(err); }
});

// GET /api/public/waitlist/:token — get offer details
router.get('/waitlist/:token', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT w.id, w.status, w.client_name, w.offer_booking_start, w.offer_booking_end,
              w.offer_expires_at,
        p.display_name AS practitioner_name, p.title AS practitioner_title,
        s.name AS service_name, s.category AS service_category, s.duration_min, s.price_cents, s.price_label,
        b.name AS business_name, b.slug AS business_slug, b.address AS business_address,
        b.phone AS business_phone, b.email AS business_email, b.theme
       FROM waitlist_entries w
       JOIN practitioners p ON p.id = w.practitioner_id
       JOIN services s ON s.id = w.service_id
       JOIN businesses b ON b.id = w.business_id
       WHERE w.offer_token = $1`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offre introuvable' });
    }

    const entry = result.rows[0];

    // Check expiry
    const expired = entry.status === 'offered' && new Date() > new Date(entry.offer_expires_at);
    if (expired) {
      await query(
        `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'offered'`,
        [entry.id]
      );
    }

    res.json({
      offer: {
        id: entry.id,
        status: expired ? 'expired' : entry.status,
        client_name: entry.client_name,
        slot_start: entry.offer_booking_start,
        slot_end: entry.offer_booking_end,
        expires_at: entry.offer_expires_at,
        expired: expired || entry.status !== 'offered'
      },
      service: {
        name: entry.service_name,
        duration_min: entry.duration_min,
        price_cents: entry.price_cents,
        price_label: entry.price_label
      },
      practitioner: {
        name: entry.practitioner_name,
        title: entry.practitioner_title
      },
      business: {
        name: entry.business_name,
        slug: entry.business_slug,
        address: entry.business_address,
        phone: entry.business_phone,
        email: entry.business_email,
        theme: entry.theme
      }
    });
  } catch (err) { next(err); }
});

// POST /api/public/waitlist/:token/accept — accept the offer → create booking
router.post('/waitlist/:token/accept', bookingLimiter, async (req, res, next) => {
  try {
    const entry = await query(
      // BUG-WL-VARIANT fix: fetch service_variant_id + variant duration for correct booking
      `SELECT w.id, w.business_id, w.practitioner_id, w.service_id, w.service_variant_id,
              w.client_name, w.client_email, w.client_phone,
              w.offer_expires_at, w.offer_booking_start, w.offer_booking_end,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              s.buffer_before_min, s.buffer_after_min
       FROM waitlist_entries w
       JOIN services s ON s.id = w.service_id
       LEFT JOIN service_variants sv ON sv.id = w.service_variant_id
       WHERE w.offer_token = $1 AND w.status = 'offered'`,
      [req.params.token]
    );

    if (entry.rows.length === 0) {
      return res.status(404).json({ error: 'Offre introuvable ou expirée' });
    }

    const e = entry.rows[0];

    const { transactionWithRLS } = require('../../services/db');

    let booking;
    try {
      booking = await transactionWithRLS(e.business_id, async (client) => {
      // Re-check expiry INSIDE transaction to prevent race condition
      if (new Date() > new Date(e.offer_expires_at)) {
        await client.query(
          `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [e.id]
        );
        throw Object.assign(new Error('Cette offre a expiré'), { type: 'expired', status: 410 });
      }

      // Check slot still available WITH lock (inside transaction to prevent race condition)
      // Fetch practitioner capacity
      const pracCapWl = await client.query(
        `SELECT COALESCE(max_concurrent, 1) AS max_concurrent FROM practitioners WHERE id = $1 AND business_id = $2`,
        [e.practitioner_id, e.business_id]
      );
      const maxConcurrentWl = pracCapWl.rows[0]?.max_concurrent || 1;

      const conflicts = await checkBookingConflicts(client, { bid: e.business_id, pracId: e.practitioner_id, newStart: e.offer_booking_start, newEnd: e.offer_booking_end });

      if (conflicts.length >= maxConcurrentWl) {
        await client.query(
          `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [e.id]
        );
        throw Object.assign(new Error('Ce créneau vient d\'être pris'), { type: 'conflict' });
      }

      // Find or create client (3-step matching: exact → phone → email)
      let clientId;
      let existingWlClient = null;

      // Step 1: exact match (phone AND email)
      if (e.client_phone && e.client_email) {
        const exactMatch = await client.query(
          `SELECT id FROM clients WHERE business_id = $1 AND phone = $2 AND LOWER(email) = LOWER($3) LIMIT 1`,
          [e.business_id, e.client_phone, e.client_email]
        );
        if (exactMatch.rows.length > 0) existingWlClient = exactMatch.rows[0];
      }
      // Step 2: match by phone
      if (!existingWlClient && e.client_phone) {
        const phoneMatch = await client.query(
          `SELECT id FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
          [e.business_id, e.client_phone]
        );
        if (phoneMatch.rows.length > 0) existingWlClient = phoneMatch.rows[0];
      }
      // Step 3: match by email
      if (!existingWlClient && e.client_email) {
        const emailMatch = await client.query(
          `SELECT id FROM clients WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
          [e.business_id, e.client_email]
        );
        if (emailMatch.rows.length > 0) existingWlClient = emailMatch.rows[0];
      }

      if (existingWlClient) {
        clientId = existingWlClient.id;
        // Update client info (PUB-V12-009: preserve existing full_name if new value is empty)
        await client.query(
          `UPDATE clients SET full_name = COALESCE(NULLIF($1, ''), full_name), email = COALESCE($2, email), phone = COALESCE($3, phone), updated_at = NOW() WHERE id = $4`,
          [e.client_name, e.client_email, e.client_phone, clientId]
        );
      } else {
        const nc = await client.query(
          `INSERT INTO clients (business_id, full_name, email, phone, created_from)
           VALUES ($1, $2, $3, $4, 'booking') RETURNING id`,
          [e.business_id, e.client_name, e.client_email, e.client_phone]
        );
        clientId = nc.rows[0].id;
      }

      // PUB-V12-008: Check if client is blocked BEFORE creating the booking
      const blockedCheck = await client.query(
        `SELECT is_blocked FROM clients WHERE id = $1`, [clientId]
      );
      if (blockedCheck.rows[0]?.is_blocked) {
        throw Object.assign(
          new Error('Votre compte est temporairement suspendu. Contactez le cabinet.'),
          { type: 'blocked', status: 403 }
        );
      }

      // Create booking
      // BUG-WL-VARIANT fix: forward service_variant_id from waitlist entry so LM/deposit/email
      // use the variant-specific price + duration (not the base service).
      const bk = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
          channel, start_at, end_at, status, locked, appointment_mode)
         VALUES ($1, $2, $3, $7, $4, 'web', $5, $6, 'confirmed', true, 'cabinet')
         RETURNING id, public_token, start_at, end_at, status`,
        [e.business_id, e.practitioner_id, e.service_id, clientId,
         e.offer_booking_start, e.offer_booking_end, e.service_variant_id || null]
      );

      // H10: Check deposit requirement (same as normal booking flow)
      const bizSettingsWl = await client.query(`SELECT plan, settings, stripe_connect_status FROM businesses WHERE id = $1`, [e.business_id]);
      const wlBizPlan = bizSettingsWl.rows[0]?.plan || 'free';
      const wlBizSettings = bizSettingsWl.rows[0]?.settings || {};
      const wlStripeConnectStatus = bizSettingsWl.rows[0]?.stripe_connect_status;
      // BUG-WL-VARIANT fix: resolve price/duration from variant if set, else base service.
      const svcPriceWl = await client.query(
        `SELECT COALESCE(sv.price_cents, s.price_cents, 0) AS price,
                COALESCE(sv.duration_min, s.duration_min, 0) AS duration
           FROM services s
           LEFT JOIN service_variants sv ON sv.id = $2 AND sv.service_id = s.id
          WHERE s.id = $1`, [e.service_id, e.service_variant_id || null]
      );
      const wlPrice = parseInt(svcPriceWl.rows[0]?.price) || 0;
      const wlDuration = parseInt(svcPriceWl.rows[0]?.duration) || 0;
      let wlNoShow = 0, wlIsVip = false;
      if (clientId) {
        const nsWl = await client.query(`SELECT no_show_count, is_vip FROM clients WHERE id = $1`, [clientId]);
        wlNoShow = nsWl.rows[0]?.no_show_count || 0;
        wlIsVip = !!nsWl.rows[0]?.is_vip;
      }
      const wlDepResult = shouldRequireDeposit(wlBizSettings, wlPrice, wlDuration, wlNoShow, wlIsVip, wlStripeConnectStatus);
      if (wlDepResult.required) {
        const startWl = new Date(e.offer_booking_start);
        const hoursUntilWlRdv = (startWl.getTime() - Date.now()) / 3600000;
        // Skip deposit only if RDV is less than 2h away
        if (hoursUntilWlRdv >= 2) {
          const deadlineWl = computeDepositDeadline(startWl, wlBizSettings);
          await client.query(
            `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
              deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
              deposit_requested_at = NOW(), deposit_request_count = 1
             WHERE id = $3 AND business_id = $4`,
            [wlDepResult.depCents, deadlineWl.toISOString(), bk.rows[0].id, e.business_id]
          );
          bk.rows[0].status = 'pending_deposit';
        }
      }

      // Apply last-minute discount + snapshot booked_price_cents
      if (wlBizSettings.last_minute_enabled && wlBizPlan !== 'free') {
        const { isWithinLastMinuteWindow } = require('./helpers');
        const wlStartBrussels = new Date(e.offer_booking_start).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const wlTodayBrussels = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const wlLmDeadline = wlBizSettings.last_minute_deadline || 'j-1';
        // H3 fix: also check promo_eligible and min_price before applying LM discount
        const _wlSvcRes = await client.query(
          `SELECT s.promo_eligible, COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price
           FROM services s LEFT JOIN service_variants sv ON sv.id = $2 AND sv.service_id = s.id
           WHERE s.id = $1`, [e.service_id, e.service_variant_id || null]
        );
        const _wlSvc = _wlSvcRes.rows[0];
        const _wlLmMinPrice = wlBizSettings.last_minute_min_price_cents || 0;
        if (isWithinLastMinuteWindow(wlStartBrussels, wlTodayBrussels, wlLmDeadline)
            && _wlSvc && _wlSvc.promo_eligible !== false
            && _wlSvc.eff_price > 0 && _wlSvc.eff_price >= _wlLmMinPrice) {
          const wlLmPct = wlBizSettings.last_minute_discount_pct || 10;
          const wlBookedPrice = Math.round(wlPrice * (100 - wlLmPct) / 100);
          await client.query(
            `UPDATE bookings SET discount_pct = $1, booked_price_cents = $2 WHERE id = $3`,
            [wlLmPct, wlBookedPrice, bk.rows[0].id]
          );
          // Recalculate deposit on discounted price if deposit was set above
          if (wlDepResult.required && bk.rows[0].status === 'pending_deposit') {
            let wlNewDep;
            if (wlBizSettings.deposit_type === 'fixed') {
              wlNewDep = Math.min(wlDepResult.depCents, wlBookedPrice);
            } else {
              wlNewDep = Math.round(wlBookedPrice * (wlBizSettings.deposit_percent || 50) / 100);
            }
            if (wlNewDep > 0 && wlNewDep !== wlDepResult.depCents) {
              await client.query(
                `UPDATE bookings SET deposit_amount_cents = $1 WHERE id = $2`,
                [wlNewDep, bk.rows[0].id]
              );
            }
          }
        } else {
          // No LM discount — just snapshot the price
          await client.query(`UPDATE bookings SET booked_price_cents = $1 WHERE id = $2`, [wlPrice, bk.rows[0].id]);
        }
      } else {
        // LM not enabled — just snapshot the price
        await client.query(`UPDATE bookings SET booked_price_cents = $1 WHERE id = $2`, [wlPrice, bk.rows[0].id]);
      }

      // Update waitlist entry (TOCTOU fix: require status = 'offered' to prevent double-accept)
      const wlUpdate = await client.query(
        `UPDATE waitlist_entries SET
          status = 'booked', offer_booking_id = $1, updated_at = NOW()
         WHERE id = $2 AND status = 'offered'`,
        [bk.rows[0].id, e.id]
      );
      if (wlUpdate.rowCount === 0) {
        throw Object.assign(new Error('Cette offre a déjà été utilisée ou a expiré'), { type: 'expired', status: 410 });
      }

      // Queue confirmation notification + pro notification
      // BUG-WL-EMAIL fix: if deposit UPDATE above flipped status to pending_deposit,
      // queue email_deposit_request (pay-to-confirm) instead of email_confirmation
      // — client must pay an acompte, not "rdv confirmé" banner (else silently expires).
      const _wlNotifType = bk.rows[0].status === 'pending_deposit' ? 'email_deposit_request' : 'email_confirmation';
      try {
        await client.query('SAVEPOINT notif_sp1');
        await client.query(
          `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status)
           VALUES ($1, $2, $4, $3, 'queued')`,
          [e.business_id, bk.rows[0].id, e.client_email, _wlNotifType]
        );
      } catch (notifErr) {
        await client.query('ROLLBACK TO SAVEPOINT notif_sp1');
        console.error('Notification insert failed:', notifErr.message);
      }
      // M2: Pro notification for waitlist-accepted booking
      try {
        await client.query('SAVEPOINT notif_sp2');
        await client.query(
          `INSERT INTO notifications (business_id, booking_id, type, status)
           VALUES ($1, $2, 'email_new_booking_pro', 'queued')`,
          [e.business_id, bk.rows[0].id]
        );
      } catch (notifErr) {
        await client.query('ROLLBACK TO SAVEPOINT notif_sp2');
      }

      return bk.rows[0];
    });
    } catch (err) {
      if (err.type === 'expired') return res.status(410).json({ error: err.message });
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
      if (err.type === 'blocked') return res.status(403).json({ error: err.message, blocked: true });
      throw err;
    }

    // Post-transaction: SSE broadcast + confirmation email (non-blocking)
    broadcast(e.business_id, 'booking_update', { action: 'waitlist_accepted', booking_id: booking.id });
    // H4: calSyncPush for waitlist-accepted booking
    try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(e.business_id, booking.id); } catch (_) {}

    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name, c.full_name AS client_name, c.email AS client_email
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           JOIN practitioners p ON p.id = b.practitioner_id
           LEFT JOIN clients c ON c.id = b.client_id
           WHERE b.id = $1`, [booking.id]
        );
        const bizRow = await query(`SELECT name, email, address, phone, theme, settings FROM businesses WHERE id = $1`, [e.business_id]);
        if (fullBk.rows[0]?.client_email && bizRow.rows[0]) {
          const bkRow = fullBk.rows[0];
          let groupServices = null;
          if (bkRow.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.discount_pct,
                      b.practitioner_id, p.display_name AS practitioner_name, b.end_at
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               LEFT JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.group_id = $1 AND b.business_id = $2
               ORDER BY b.group_order, b.start_at`,
              [bkRow.group_id, bkRow.business_id]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
              groupServices = grp.rows;
              bkRow.end_at = grp.rows[grp.rows.length - 1].end_at;
            }
          }
          // BUG-WL-EMAIL fix: when waitlist-accept triggered a deposit requirement
          // (status='pending_deposit' via L338-345), send sendDepositRequestEmail
          // (pay-to-confirm) instead of sendBookingConfirmation — else client thinks
          // the RDV is confirmed, ignores the implicit deposit deadline, cron expires it.
          if (bkRow.status === 'pending_deposit') {
            const depositUrl = `${BASE_URL}/deposit/${bkRow.public_token}`;
            const payUrl = `${BASE_URL}/api/public/deposit/${bkRow.public_token}/pay`;
            try { await query(`UPDATE bookings SET deposit_payment_url = $1 WHERE id = $2`, [depositUrl, bkRow.id]); } catch (_) {}
            const { sendDepositRequestEmail } = require('../../services/email');
            const emailOpts = { booking: bkRow, business: bizRow.rows[0], depositUrl, payUrl };
            if (groupServices) emailOpts.groupServices = groupServices;
            await sendDepositRequestEmail(emailOpts);
            try {
              await query(
                `UPDATE notifications SET status = 'sent', sent_at = NOW()
                 WHERE booking_id = $1 AND type = 'email_deposit_request' AND status = 'queued'`,
                [bkRow.id]
              );
            } catch (_) { /* non-critical */ }
          } else {
            const { sendBookingConfirmation } = require('../../services/email');
            await sendBookingConfirmation({ booking: bkRow, business: bizRow.rows[0], groupServices });
            // email_confirmation fix: marquer la row audit (insérée L410) comme 'sent'
            try {
              await query(
                `UPDATE notifications SET status = 'sent', sent_at = NOW()
                 WHERE booking_id = $1 AND type = 'email_confirmation' AND status = 'queued'`,
                [bkRow.id]
              );
            } catch (_) { /* non-critical */ }
          }
        }
      } catch (emailErr) {
        console.warn('[EMAIL] Waitlist confirmation/deposit email error:', emailErr.message);
        // B-03 fix: utiliser booking.id (closure parent scope L440) au lieu de bkRow.id
        // (bkRow était const dans le if L460, hors scope ici → ReferenceError silencieusement avalé
        // par le inner catch → UPDATE 'failed' jamais exécuté → row reste queued).
        try {
          // BUG-WL-EMAIL fix: mark the correct notification type (deposit_request or confirmation)
          const _failType = booking.status === 'pending_deposit' ? 'email_deposit_request' : 'email_confirmation';
          await query(
            `UPDATE notifications SET status = 'failed', sent_at = NOW(), error = $2
             WHERE booking_id = $1 AND type = $3 AND status = 'queued'`,
            [booking.id, emailErr.message || 'unknown', _failType]
          );
        } catch (_) {}
      }
    })();

    res.status(201).json({
      booked: true,
      booking: {
        id: booking.id,
        token: booking.public_token,
        start_at: booking.start_at,
        end_at: booking.end_at,
        manage_url: `${BASE_URL}/booking/${booking.public_token}`
      }
    });
  } catch (err) { next(err); }
});

// POST /api/public/waitlist/:token/decline — decline the offer
router.post('/waitlist/:token/decline', bookingLimiter, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE waitlist_entries SET status = 'declined', updated_at = NOW()
       WHERE offer_token = $1 AND status = 'offered'
       RETURNING id, practitioner_id, service_id, business_id, offer_booking_start, offer_booking_end`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Offre introuvable' });
    }

    // If auto mode, try next person in queue
    const entry = result.rows[0];
    try {
      const prac = await query(
        `SELECT waitlist_mode FROM practitioners WHERE id = $1 AND business_id = $2`,
        [entry.practitioner_id, entry.business_id]
      );
      if (prac.rows[0]?.waitlist_mode === 'auto') {
        // Fake a cancellation to re-trigger the queue
        // Build a temporary booking-like object
        const { processWaitlistForCancellation } = require('../../services/waitlist');
        // We need to find next waiting entry directly
        const slotDate = new Date(entry.offer_booking_start);
        const bxlHourStr = slotDate.toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit', minute: '2-digit' });
        const bxlHour = parseInt(bxlHourStr.split(':')[0]) || 0;
        const bxlDay = parseInt(slotDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }).split('-')[2]);
        // Use slotDate.toLocaleDateString for weekday:
        const bxlWeekday = new Date(slotDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) + 'T12:00:00Z').getUTCDay();
        const weekday = bxlWeekday === 0 ? 6 : bxlWeekday - 1;
        const timeOfDay = bxlHour < 12 ? 'morning' : 'afternoon';
        const crypto = require('crypto');

        // Check: slot still at least 2h away and no conflicts before cascading
        const slotStartMs = new Date(entry.offer_booking_start).getTime();
        const tooSoon = slotStartMs - Date.now() < 2 * 60 * 60 * 1000;
        let slotTaken = false;
        if (!tooSoon) {
          const conflicts = await query(
            `SELECT id FROM bookings WHERE practitioner_id = $1 AND business_id = $2
             AND status IN ('confirmed', 'pending', 'pending_deposit', 'modified_pending')
             AND start_at < $4 AND end_at > $3`,
            [entry.practitioner_id, entry.business_id, entry.offer_booking_start, entry.offer_booking_end]
          );
          slotTaken = conflicts.rows.length > 0;
        }

        if (!tooSoon && !slotTaken) {
        // Atomic: SELECT FOR UPDATE SKIP LOCKED to prevent race condition
        // between concurrent decline handlers picking the same next entry
        const offerToken = crypto.randomBytes(20).toString('hex');
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

        const offerResult = await query(
          `UPDATE waitlist_entries SET
            status = 'offered', offer_token = $1,
            offer_booking_start = $2, offer_booking_end = $3,
            offer_sent_at = NOW(), offer_expires_at = $4, updated_at = NOW()
           WHERE id = (
             SELECT id FROM waitlist_entries
             WHERE practitioner_id = $5 AND service_id = $6 AND business_id = $7
               AND status = 'waiting'
               AND (preferred_days @> $8::jsonb OR preferred_days IS NULL OR jsonb_array_length(preferred_days) = 0)
               AND (preferred_time = 'any' OR preferred_time = $9)
             ORDER BY priority ASC, created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           ) AND status = 'waiting'
           RETURNING id, client_email, client_name`,
          [offerToken, entry.offer_booking_start, entry.offer_booking_end,
           expiresAt.toISOString(),
           entry.practitioner_id, entry.service_id, entry.business_id,
           JSON.stringify([weekday]), timeOfDay]
        );

        // Send offer email inline to next client (notification processor does not handle this type)
        if (offerResult.rows.length > 0) {
          try {
            const { sendEmail: _sendOffer, buildEmailHTML: _buildOffer, escHtml: _escOffer, safeColor: _scOffer } = require('../../services/email-utils');
            const _baseOffer = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
            const _offerUrl = `${_baseOffer}/waitlist/${offerToken}`;
            // Fetch service + practitioner + business for the email
            const _svcRes = await query(`SELECT s.name AS service_name, COALESCE(s.duration_min, 0) AS duration_min, COALESCE(s.price_cents, 0) AS price_cents FROM services s WHERE s.id = $1`, [entry.service_id]);
            const _pracRes = await query(`SELECT display_name FROM practitioners WHERE id = $1`, [entry.practitioner_id]);
            const _bizRes = await query(`SELECT name, theme, address, phone, email FROM businesses WHERE id = $1`, [entry.business_id]);
            const _svc = _svcRes.rows[0] || {};
            const _prac = _pracRes.rows[0] || {};
            const _biz = _bizRes.rows[0] || { name: 'Genda' };
            const _dateFmt = new Date(entry.offer_booking_start).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
            const _timeFmt = new Date(entry.offer_booking_start).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
            const _endFmt = (entry.offer_booking_end ? new Date(entry.offer_booking_end) : new Date(new Date(entry.offer_booking_start).getTime() + (_svc.duration_min || 0) * 60000))
              .toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
            const _nextClient = offerResult.rows[0];
            _sendOffer({
              to: _nextClient.client_email,
              toName: _nextClient.client_name,
              subject: `Créneau disponible — ${_svc.service_name || 'Prestation'} le ${_dateFmt}`,
              html: _buildOffer({
                title: 'Un créneau s\'est libéré !',
                preheader: `${_svc.service_name || 'Prestation'} chez ${_prac.display_name || ''} — ${_dateFmt} à ${_timeFmt}`,
                bodyHTML: `<p>Bonjour ${_escOffer(_nextClient.client_name)},</p>
                  <p>Bonne nouvelle ! Un créneau s'est libéré pour votre demande :</p>
                  <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
                    <p style="margin:0 0 6px"><strong>${_escOffer(_svc.service_name || 'Prestation')}</strong> (${_svc.duration_min} min)</p>
                    ${_svc.price_cents ? `<p style="margin:0 0 4px;font-size:14px;color:#3D3832">${(_svc.price_cents / 100).toFixed(2).replace('.', ',')} \u20ac</p>` : ''}
                    <p style="margin:0 0 4px;font-size:14px;color:#3D3832">Avec ${_escOffer(_prac.display_name || '')}</p>
                    <p style="margin:0;font-size:14px;color:#3D3832">${_escOffer(_dateFmt)} à ${_escOffer(_timeFmt)} \u2013 ${_endFmt}</p>
                  </div>
                  <p style="font-weight:600;color:#D97706">\u23f1 Vous avez 2 heures pour réserver ce créneau.</p>`,
                ctaText: 'Réserver maintenant', ctaUrl: _offerUrl,
                businessName: _biz.name, primaryColor: _scOffer(_biz.theme?.primary_color),
                footerText: `${_biz.name}${_biz.address ? ' \u00b7 ' + _biz.address : ''} \u00b7 Via Genda.be`
              }),
              fromName: _biz.name, replyTo: _biz.email || undefined
            }).catch(e => console.warn('[WAITLIST] Decline cascade email error:', e.message));
            try { broadcast(entry.business_id, 'waitlist_match', { mode: 'auto_cascade', offered_to: _nextClient.client_name, slot_start: entry.offer_booking_start }); } catch (_) {}
          } catch (emailErr) { console.warn('[WAITLIST] Decline cascade email build error:', emailErr.message); }
        }
        } // end if (!tooSoon && !slotTaken)
      }
    } catch (e) { /* non-blocking */ }

    res.json({ declined: true });
  } catch (err) { next(err); }
});

module.exports = router;
