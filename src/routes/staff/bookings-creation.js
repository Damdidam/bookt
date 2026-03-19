/**
 * Booking Creation — POST /manual
 * Creates manual bookings (freestyle or service-based, single or grouped).
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { sendBookingConfirmation } = require('../../services/email');
const { calSyncPush, businessAllowsOverlap, getMaxConcurrent, checkPracAvailability, checkBookingConflicts } = require('./bookings-helpers');
const { dateToWeekday, timeToMinutes } = require('../../services/schedule-helpers');

// ============================================================
// POST /api/bookings/manual
// Create a manual booking (from dashboard)
// UI: Dashboard → "+ Nouveau RDV" button
// ============================================================
router.post('/manual', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id, practitioner_id, client_id, start_at, appointment_mode, comment,
            services: multiServices, freestyle, end_at, buffer_before_min, buffer_after_min, custom_label, color, locked,
            force_deposit, deposit_amount_cents, skip_confirmation } = req.body;

    // Default status: pending (staff confirms later). skip_confirmation → confirmed immediately.
    const bookingStatus = skip_confirmation ? 'confirmed' : 'pending';

    // Fetch confirmation timeout from business settings (same as public flow)
    const _bizConf = await queryWithRLS(bid, `SELECT settings FROM businesses WHERE id = $1`, [bid]);
    const _bizSettings = _bizConf.rows[0]?.settings || {};
    const confirmTimeoutMin = parseInt(_bizSettings.booking_confirmation_timeout_min) || 30;

    // BK-V13-008: group_id removed from destructuring (dead code — group_id is generated server-side)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // CRT-4: Basic client_email validation before using it for sending emails
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let client_email = req.body.client_email;
    if (client_email && !EMAIL_RE.test(client_email)) client_email = null;

    if (!practitioner_id || !start_at) {
      return res.status(400).json({ error: 'practitioner_id et start_at requis' });
    }

    // CRT-V12-003: UUID-validate practitioner_id and client_id before DB queries
    if (!UUID_RE.test(practitioner_id)) return res.status(400).json({ error: 'practitioner_id invalide' });
    if (client_id && !UUID_RE.test(client_id)) return res.status(400).json({ error: 'client_id invalide' });

    // Bug M6 fix: Validate start_at (and end_at if provided) as parseable dates
    if (isNaN(new Date(start_at).getTime())) {
      return res.status(400).json({ error: 'Date de début invalide' });
    }
    if (end_at && isNaN(new Date(end_at).getTime())) {
      return res.status(400).json({ error: 'Date de fin invalide' });
    }

    // Validate appointment_mode if provided
    const VALID_MODES = ['cabinet', 'visio', 'phone', 'domicile'];
    if (appointment_mode && !VALID_MODES.includes(appointment_mode)) {
      return res.status(400).json({ error: `Mode invalide. Valeurs : ${VALID_MODES.join(', ')}` });
    }

    // Reject bookings that start too far in the past (2h tolerance for walk-ins / late entries)
    const startMs = new Date(start_at).getTime();
    if (startMs < Date.now() - 2 * 3600000) {
      return res.status(400).json({ error: 'Impossible de créer un rendez-vous aussi loin dans le passé' });
    }

    // Validate text field lengths
    if (comment && comment.length > 5000) {
      return res.status(400).json({ error: 'Commentaire trop long (max 5000 caractères)' });
    }
    // CRT-V11-3: Tighten custom_label length limit
    if (custom_label && custom_label.length > 100) {
      return res.status(400).json({ error: 'Label trop long (max 100)' });
    }
    // CRT-V11-1: Validate color — sanitize to null if not valid hex
    const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;

    // Bug M7 fix: Validate practitioner_id belongs to this business
    const pracCheck = await queryWithRLS(bid,
      'SELECT id FROM practitioners WHERE id = $1 AND business_id = $2',
      [practitioner_id, bid]
    );
    if (pracCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Praticien invalide' });
    }

    // Bug H9 fix: Validate client_id belongs to this business
    if (client_id) {
      const clientCheck = await queryWithRLS(bid,
        'SELECT id FROM clients WHERE id = $1 AND business_id = $2',
        [client_id, bid]
      );
      if (clientCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Client invalide' });
      }
    }

    // Practitioner scope: can only create bookings for themselves
    if (req.practitionerFilter && String(practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Vous ne pouvez créer des RDV que pour vous-même' });
    }

    // Check global overlap policy + practitioner capacity
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    const maxConcurrent = globalAllowOverlap ? Infinity : await getMaxConcurrent(bid, practitioner_id);

    // ── FREESTYLE MODE: no predefined service ──
    if (freestyle) {
      if (!end_at) return res.status(400).json({ error: 'end_at requis en mode libre' });
      const bufBefore = Math.min(480, Math.max(0, parseInt(buffer_before_min, 10) || 0));
      const bufAfter = Math.min(480, Math.max(0, parseInt(buffer_after_min, 10) || 0));
      const realStart = new Date(new Date(start_at).getTime() - bufBefore * 60000);
      const realEnd = new Date(new Date(end_at).getTime() + bufAfter * 60000);

      if (realStart >= realEnd) {
        return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
      }

      // Check practitioner availability (absences, exceptions, hours)
      const availCheck = await checkPracAvailability(bid, practitioner_id, realStart.toISOString(), realEnd.toISOString());
      if (!availCheck.ok) {
        return res.status(409).json({ error: availCheck.reason });
      }

      const bookings = await transactionWithRLS(bid, async (client) => {
        if (!globalAllowOverlap) {
          const conflicts = await checkBookingConflicts(client, { bid, pracId: practitioner_id, newStart: realStart.toISOString(), newEnd: realEnd.toISOString() });
          if (conflicts.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        const confirmExpiresAt = bookingStatus === 'pending' ? new Date(Date.now() + confirmTimeoutMin * 60000).toISOString() : null;
        const result = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
            channel, appointment_mode, start_at, end_at, status, comment_client, custom_label, color, locked,
            confirmation_expires_at)
           VALUES ($1, $2, NULL, $3, 'manual', $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [bid, practitioner_id, client_id || null,
           appointment_mode || 'cabinet',
           realStart.toISOString(), realEnd.toISOString(),
           bookingStatus,
           comment || null, custom_label || null, safeColor, bookingStatus === 'confirmed' ? true : !!locked,
           confirmExpiresAt]
        );

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action)
           VALUES ($1, $2, 'booking', $3, 'create')`,
          [bid, req.user.id, result.rows[0].id]
        );

        // ===== DEPOSIT CHECK (freestyle — inside transaction for atomicity) =====
        const booking = result.rows[0];
        if (client_id && booking) {
          const depCheck = await client.query(
            `SELECT c.no_show_count, biz.settings
             FROM clients c JOIN businesses biz ON biz.id = c.business_id
             WHERE c.id = $1 AND c.business_id = $2`,
            [client_id, bid]
          );
          const dc = depCheck.rows[0];
          const noShowTriggered = dc.no_show_count >= (dc.settings.deposit_noshow_threshold || 2);
          if (dc?.settings?.deposit_enabled && (noShowTriggered || force_deposit)) {
            const depCents = (deposit_amount_cents > 0)
              ? deposit_amount_cents
              : (dc.settings.deposit_fixed_cents || 2500);
            if (depCents > 0) {
              const dlHours = dc.settings.deposit_deadline_hours ?? 48;
              const hoursUntilRdv = (realStart.getTime() - Date.now()) / 3600000;
              // Skip auto-deposit if RDV is within deadline window (unless staff forced it)
              let deadline = new Date(realStart.getTime() - dlHours * 3600000);
              if (force_deposit && deadline <= new Date()) {
                deadline = new Date(Date.now() + 2 * 3600000);
              }
              if ((force_deposit || hoursUntilRdv >= dlHours) && deadline > new Date()) {
                await client.query(
                  `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                    deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
                    confirmation_expires_at = NULL
                   WHERE id = $3 AND business_id = $4`,
                  [depCents, deadline.toISOString(), booking.id, bid]
                );
                booking.status = 'pending_deposit';
                booking.deposit_required = true;
                booking.deposit_amount_cents = depCents;
              }
            }
          }
        }

        return [booking];
      });

      broadcast(bid, 'booking_update', { action: 'created' });
      calSyncPush(bid, bookings[0].id).catch(() => {});

      // Send confirmation email only if confirmed AND not pending deposit (non-blocking)
      // When deposit is active, payment serves as confirmation — skip confirmation email
      if (bookingStatus === 'confirmed' && bookings[0].status !== 'pending_deposit' && client_email && client_id) {
        (async () => {
          try {
            const biz = await queryWithRLS(bid, `SELECT name, email, phone, address, theme, settings FROM businesses WHERE id = $1`, [bid]);
            const cl = await queryWithRLS(bid, `SELECT full_name FROM clients WHERE id = $1 AND business_id = $2`, [client_id, bid]);
            if (biz.rows[0] && cl.rows[0]) {
              await sendBookingConfirmation({
                booking: { ...bookings[0], client_name: cl.rows[0].full_name, client_email: client_email, service_name: custom_label || 'Rendez-vous libre', practitioner_name: '' },
                business: biz.rows[0]
              });
            }
          } catch (e) { console.warn('[EMAIL] Confirmation send error:', e.message); }
        })();
      }

      return res.status(201).json({ booking: bookings[0], bookings });
    }

    // ── NORMAL MODE: predefined service(s) ──
    // Validate multiServices format if provided
    if (multiServices !== undefined) {
      if (!Array.isArray(multiServices) || multiServices.length === 0) {
        return res.status(400).json({ error: 'services doit être un tableau non vide' });
      }
      if (multiServices.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 prestations par RDV groupé' });
      }
      if (multiServices.some(s => !s.service_id)) {
        return res.status(400).json({ error: 'Chaque prestation doit avoir un service_id' });
      }
      // CRT-V12-002: UUID-validate each service_id
      for (const s of multiServices) {
        if (!UUID_RE.test(s.service_id)) {
          return res.status(400).json({ error: 'service_id invalide' });
        }
      }
    }
    const serviceList = multiServices || [{ service_id, variant_id: req.body.variant_id || null }];

    // CRT-2: Validate service_id is present in non-freestyle mode
    if (!serviceList[0]?.service_id) {
      return res.status(400).json({ error: 'service_id ou services requis' });
    }

    // CRT-V12-002: UUID-validate single service_id (multiServices already validated above)
    if (!multiServices && !UUID_RE.test(service_id)) {
      return res.status(400).json({ error: 'service_id invalide' });
    }

    if (!practitioner_id || !start_at || serviceList.length === 0) {
      return res.status(400).json({ error: 'practitioner_id, start_at et au moins une prestation requis' });
    }

    // Fetch all service durations
    const svcIds = serviceList.map(s => s.service_id);
    const svcResult = await queryWithRLS(bid,
      `SELECT id, name, duration_min, buffer_before_min, buffer_after_min, processing_time, processing_start, available_schedule
       FROM services WHERE business_id = $1 AND id = ANY($2)`,
      [bid, svcIds]
    );
    const svcMap = {};
    for (const s of svcResult.rows) svcMap[s.id] = s;

    // Validate all services exist and have valid durations
    for (const s of serviceList) {
      if (!svcMap[s.service_id]) return res.status(404).json({ error: `Prestation ${s.service_id} introuvable` });
      if (!svcMap[s.service_id].duration_min || svcMap[s.service_id].duration_min <= 0) {
        return res.status(400).json({ error: `Durée invalide pour la prestation ${s.service_id}` });
      }
    }

    // Resolve variant overrides for duration (stored per-item, not per-service,
    // because the same service can appear multiple times with different variants)
    for (const s of serviceList) {
      const vid = s.variant_id;
      if (!vid) continue;
      if (!UUID_RE.test(vid)) return res.status(400).json({ error: 'variant_id invalide' });
      const vr = await queryWithRLS(bid,
        `SELECT duration_min, price_cents, processing_time, processing_start FROM service_variants
         WHERE id = $1 AND service_id = $2 AND business_id = $3 AND is_active = true`,
        [vid, s.service_id, bid]
      );
      if (vr.rows.length === 0) return res.status(404).json({ error: `Variante ${vid} introuvable` });
      s._variant_duration = vr.rows[0].duration_min;
      s._variant_price = vr.rows[0].price_cents;
      s._variant_processing_time = vr.rows[0].processing_time || 0;
      s._variant_processing_start = vr.rows[0].processing_start || 0;
    }

    // Validate practitioner is assigned to all selected services
    const psCheck = await queryWithRLS(bid,
      `SELECT service_id FROM practitioner_services
       WHERE practitioner_id = $1 AND service_id = ANY($2)`,
      [practitioner_id, svcIds]
    );
    const assignedSvcIds = new Set(psCheck.rows.map(r => r.service_id));
    for (const s of serviceList) {
      if (!assignedSvcIds.has(s.service_id)) {
        const svcName = svcMap[s.service_id]?.name || s.service_id;
        return res.status(400).json({ error: `Le praticien ne propose pas la prestation "${svcName}"` });
      }
    }

    // Calculate chained time slots
    const isGroup = serviceList.length > 1;
    const groupId = isGroup ? require('crypto').randomUUID() : null;
    let cursor = new Date(start_at);
    // CRT-V12-004: For chained group bookings, only apply leading buffer of first
    // service and trailing buffer of last service to avoid double-counting gaps.
    const slots = serviceList.map((s, i) => {
      const svc = svcMap[s.service_id];
      const dur = s._variant_duration || svc.duration_min;
      const bufBefore = (i === 0) ? (svc.buffer_before_min || 0) : 0;
      const bufAfter = (i === serviceList.length - 1) ? (svc.buffer_after_min || 0) : 0;
      const totalDur = bufBefore + dur + bufAfter;
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart.getTime() + totalDur * 60000);
      cursor = slotEnd; // next service starts where this one ends
      return {
        service_id: s.service_id,
        service_variant_id: s.variant_id || null,
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        group_order: i,
        processing_time: s._variant_processing_time ?? svc.processing_time ?? 0,
        processing_start: s._variant_processing_start ?? svc.processing_start ?? 0
      };
    });

    const totalEnd = slots[slots.length - 1].end_at;

    // ── Validate service available_schedule (restricted windows) ──
    const _bruFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    for (const slot of slots) {
      const svc = svcMap[slot.service_id];
      if (svc.available_schedule?.type === 'restricted') {
        // Convert slot times to Brussels local
        const sp = {}; _bruFmt.formatToParts(new Date(slot.start_at)).forEach(p => { sp[p.type] = p.value; });
        const ep = {}; _bruFmt.formatToParts(new Date(slot.end_at)).forEach(p => { ep[p.type] = p.value; });
        const slotDate = `${sp.year}-${sp.month}-${sp.day}`;
        const weekday = dateToWeekday(slotDate);
        const svcWindows = (svc.available_schedule.windows || []).filter(w => w.day === weekday);
        if (svcWindows.length === 0) {
          return res.status(400).json({
            error: `La prestation "${svc.name}" n'est pas disponible ce jour`
          });
        }
        const startMin = parseInt(sp.hour) * 60 + parseInt(sp.minute);
        const endMin = parseInt(ep.hour) * 60 + parseInt(ep.minute);
        const fitsWindow = svcWindows.some(w => {
          const wStart = timeToMinutes(w.from);
          const wEnd = timeToMinutes(w.to);
          return startMin >= wStart && endMin <= wEnd;
        });
        if (!fitsWindow) {
          const windowsStr = svcWindows.map(w => `${w.from}–${w.to}`).join(', ');
          return res.status(400).json({
            error: `La prestation "${svc.name}" est restreinte aux créneaux : ${windowsStr}`
          });
        }
      }
    }

    // Check practitioner availability (absences, exceptions, hours)
    const availCheck = await checkPracAvailability(bid, practitioner_id, start_at, totalEnd);
    if (!availCheck.ok) {
      return res.status(409).json({ error: availCheck.reason });
    }

    const bookings = await transactionWithRLS(bid, async (client) => {
      // Check conflicts for the entire time range (skip if business allows overlap)
      if (!globalAllowOverlap) {
        const conflicts = await checkBookingConflicts(client, { bid, pracId: practitioner_id, newStart: new Date(start_at).toISOString(), newEnd: totalEnd });
        if (conflicts.length >= maxConcurrent) {
          throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
        }
      }

      const results = [];
      for (const slot of slots) {
        // CRT-6: By design, group bookings do not support individual color/custom_label.
        // These fields are omitted intentionally — group members share the same visual style
        // derived from their service. Per-member customization may be added in a future iteration.
        const confirmExpiresAtNormal = bookingStatus === 'pending' ? new Date(Date.now() + confirmTimeoutMin * 60000).toISOString() : null;
        const result = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
            channel, appointment_mode, start_at, end_at, status, comment_client,
            group_id, group_order, processing_time, processing_start, locked,
            confirmation_expires_at)
           VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING *`,
          [bid, practitioner_id, slot.service_id, slot.service_variant_id, client_id || null,
           appointment_mode || 'cabinet',
           slot.start_at, slot.end_at,
           bookingStatus,
           comment || null,
           groupId, slot.group_order,
           slot.processing_time || 0, slot.processing_start || 0, bookingStatus === 'confirmed' ? true : !!locked,
           confirmExpiresAtNormal]
        );
        results.push(result.rows[0]);

        // Audit
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action)
           VALUES ($1, $2, 'booking', $3, 'create')`,
          [bid, req.user.id, result.rows[0].id]
        );
      }

      // ===== DEPOSIT CHECK (normal mode — inside transaction for atomicity) =====
      if (client_id && results.length > 0) {
        const depCheck = await client.query(
          `SELECT c.no_show_count, biz.settings
           FROM clients c JOIN businesses biz ON biz.id = c.business_id
           WHERE c.id = $1 AND c.business_id = $2`,
          [client_id, bid]
        );
        const dc = depCheck.rows[0];
        const noShowTriggered = dc.no_show_count >= (dc.settings.deposit_noshow_threshold || 2);
        if (dc?.settings?.deposit_enabled && (noShowTriggered || force_deposit)) {
          const svcPriceResult = await client.query(
            `SELECT COALESCE(SUM(COALESCE(sv.price_cents, s.price_cents)), 0) AS total_price
             FROM bookings b
             JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             WHERE b.id = ANY($1) AND b.business_id = $2`,
            [results.map(b => b.id), bid]
          );
          const totalPrice = parseInt(svcPriceResult.rows[0]?.total_price) || 0;
          let depCents = 0;
          if (dc.settings.deposit_type === 'fixed') {
            depCents = dc.settings.deposit_fixed_cents || 2500;
          } else {
            depCents = Math.round(totalPrice * (dc.settings.deposit_percent || 50) / 100);
          }
          if (depCents > 0) {
            const dlHours = dc.settings.deposit_deadline_hours ?? 48;
            const hoursUntilRdv = (new Date(start_at).getTime() - Date.now()) / 3600000;
            let deadline = new Date(new Date(start_at).getTime() - dlHours * 3600000);
            if (force_deposit && deadline <= new Date()) {
              deadline = new Date(Date.now() + 2 * 3600000);
            }
            if ((force_deposit || hoursUntilRdv >= dlHours) && deadline > new Date()) {
              // CRT-V10-7: Deposit amount on the first booking only
              await client.query(
                `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                  deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
                  confirmation_expires_at = NULL
                 WHERE id = $3 AND business_id = $4`,
                [depCents, deadline.toISOString(), results[0].id, bid]
              );
              results[0].status = 'pending_deposit';
              results[0].deposit_required = true;
              results[0].deposit_amount_cents = depCents;
              // CRT-V10-7: Set pending_deposit status on ALL other group members (no deposit amount)
              if (results.length > 1) {
                const otherIds = results.slice(1).map(b => b.id);
                await client.query(
                  `UPDATE bookings SET status = 'pending_deposit'
                   WHERE id = ANY($1) AND business_id = $2`,
                  [otherIds, bid]
                );
                for (let i = 1; i < results.length; i++) {
                  results[i].status = 'pending_deposit';
                }
              }
            }
          }
        }
      }

      return results;
    });

    broadcast(bid, 'booking_update', { action: 'created' });
    bookings.forEach(b => calSyncPush(bid, b.id).catch(() => {}));

    // Send confirmation email only if confirmed AND not pending deposit (non-blocking)
    // When deposit is active, payment serves as confirmation — skip confirmation email
    if (bookingStatus === 'confirmed' && bookings[0].status !== 'pending_deposit' && client_email && client_id) {
      (async () => {
        try {
          const biz = await queryWithRLS(bid, `SELECT name, email, phone, address, theme, settings FROM businesses WHERE id = $1`, [bid]);
          const cl = await queryWithRLS(bid, `SELECT full_name FROM clients WHERE id = $1 AND business_id = $2`, [client_id, bid]);
          const svc = await queryWithRLS(bid, `SELECT name, category FROM services WHERE id = $1 AND business_id = $2`, [bookings[0].service_id, bid]);
          const prac = await queryWithRLS(bid, `SELECT display_name FROM practitioners WHERE id = $1 AND business_id = $2`, [practitioner_id, bid]);
          // Query groupServices for multi-service bookings
          let groupServices = null;
          if (groupId) {
            const grp = await queryWithRLS(bid,
              `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' \u2014 ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                      b.practitioner_id, p.display_name AS practitioner_name
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               LEFT JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [groupId, bid]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
              if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
              groupServices = grp.rows;
            }
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          if (biz.rows[0] && cl.rows[0]) {
            await sendBookingConfirmation({
              booking: { ...bookings[0], end_at: groupEndAt || bookings[0].end_at, client_name: cl.rows[0].full_name, client_email: client_email, service_name: svc.rows[0]?.name || 'Rendez-vous', service_category: svc.rows[0]?.category || '', practitioner_name: prac.rows[0]?.display_name || '' },
              business: biz.rows[0],
              groupServices
            });
          }
        } catch (e) { console.warn('[EMAIL] Confirmation send error:', e.message); }
      })();
    }

    res.status(201).json({ booking: bookings[0], bookings, group_id: groupId });
  } catch (err) {
    if (err.type === 'conflict') return res.status(409).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
