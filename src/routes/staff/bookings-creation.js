/**
 * Booking Creation — POST /manual
 * Creates manual bookings (freestyle or service-based, single or grouped).
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { sendBookingConfirmation } = require('../../services/email');
const { calSyncPush, businessAllowsOverlap, getMaxConcurrent, checkPracAvailability } = require('./bookings-helpers');

// ============================================================
// POST /api/bookings/manual
// Create a manual booking (from dashboard)
// UI: Dashboard → "+ Nouveau RDV" button
// ============================================================
router.post('/manual', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id, practitioner_id, client_id, start_at, appointment_mode, comment,
            services: multiServices, freestyle, end_at, buffer_before_min, buffer_after_min, custom_label, color } = req.body;

    // CRT-4: Basic client_email validation before using it for sending emails
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let client_email = req.body.client_email;
    if (client_email && !EMAIL_RE.test(client_email)) client_email = null;

    if (!practitioner_id || !start_at) {
      return res.status(400).json({ error: 'practitioner_id et start_at requis' });
    }

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

    // Validate text field lengths
    if (comment && comment.length > 5000) {
      return res.status(400).json({ error: 'Commentaire trop long (max 5000 caractères)' });
    }
    if (custom_label && custom_label.length > 200) {
      return res.status(400).json({ error: 'Libellé trop long (max 200 caractères)' });
    }
    // Validate color hex format
    if (color !== undefined && color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Format de couleur invalide (ex: #FF5733)' });
    }

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

      // Check practitioner availability for the full time range (including buffers)
      const availCheck = await checkPracAvailability(bid, practitioner_id, realStart.toISOString(), realEnd.toISOString());
      if (!availCheck.ok) return res.status(400).json({ error: availCheck.reason });

      const bookings = await transactionWithRLS(bid, async (client) => {
        if (!globalAllowOverlap) {
          const conflict = await client.query(
            `SELECT id FROM bookings
             WHERE business_id = $1 AND practitioner_id = $2
             AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
             AND start_at < $4 AND end_at > $3
             FOR UPDATE`,
            [bid, practitioner_id, realStart.toISOString(), realEnd.toISOString()]
          );
          if (conflict.rows.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        const result = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
            channel, appointment_mode, start_at, end_at, status, comment_client, custom_label, color)
           VALUES ($1, $2, NULL, $3, 'manual', $4, $5, $6, 'confirmed', $7, $8, $9)
           RETURNING *`,
          [bid, practitioner_id, client_id || null,
           appointment_mode || 'cabinet',
           realStart.toISOString(), realEnd.toISOString(),
           comment || null, custom_label || null, color || null]
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
          if (dc?.settings?.deposit_enabled && dc.no_show_count >= (dc.settings.deposit_noshow_threshold || 2)) {
            const depCents = dc.settings.deposit_type === 'fixed'
              ? (dc.settings.deposit_fixed_cents || 2500)
              : 0; // freestyle has no service price, use fixed or skip
            if (depCents > 0) {
              const dlHours = dc.settings.deposit_deadline_hours ?? 48;
              // Bug M8 fix: Use realStart (actual booking start incl. buffer) instead of raw start_at
              const deadline = new Date(realStart.getTime() - dlHours * 3600000);
              if (deadline > new Date()) {
                await client.query(
                  `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                    deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2
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

      // Send confirmation email (non-blocking)
      if (client_email && client_id) {
        (async () => {
          try {
            const biz = await queryWithRLS(bid, `SELECT name, email, address, theme, settings FROM businesses WHERE id = $1`, [bid]);
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
    }
    const serviceList = multiServices || [{ service_id }];

    // CRT-2: Validate service_id is present in non-freestyle mode
    if (!serviceList[0]?.service_id) {
      return res.status(400).json({ error: 'service_id ou services requis' });
    }

    if (!practitioner_id || !start_at || serviceList.length === 0) {
      return res.status(400).json({ error: 'practitioner_id, start_at et au moins une prestation requis' });
    }

    // Fetch all service durations
    const svcIds = serviceList.map(s => s.service_id);
    const svcResult = await queryWithRLS(bid,
      `SELECT id, duration_min, buffer_before_min, buffer_after_min
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

    // Calculate chained time slots
    const isGroup = serviceList.length > 1;
    const groupId = isGroup ? require('crypto').randomUUID() : null;
    let cursor = new Date(start_at);
    const slots = serviceList.map((s, i) => {
      const svc = svcMap[s.service_id];
      const totalDur = (svc.buffer_before_min || 0) + svc.duration_min + (svc.buffer_after_min || 0);
      const slotStart = new Date(cursor);
      const slotEnd = new Date(slotStart.getTime() + totalDur * 60000);
      cursor = slotEnd; // next service starts where this one ends
      return {
        service_id: s.service_id,
        start_at: slotStart.toISOString(),
        end_at: slotEnd.toISOString(),
        group_order: i
      };
    });

    const totalEnd = slots[slots.length - 1].end_at;

    // Check practitioner availability for the full time range (start to last service end)
    const availCheck = await checkPracAvailability(bid, practitioner_id, start_at, totalEnd);
    if (!availCheck.ok) return res.status(400).json({ error: availCheck.reason });

    const bookings = await transactionWithRLS(bid, async (client) => {
      // Check conflicts for the entire time range (skip if business allows overlap)
      if (!globalAllowOverlap) {
        const conflict = await client.query(
          `SELECT id FROM bookings
           WHERE business_id = $1 AND practitioner_id = $2
           AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
           AND start_at < $4 AND end_at > $3
           FOR UPDATE`,
          [bid, practitioner_id, new Date(start_at).toISOString(), totalEnd]
        );

        if (conflict.rows.length >= maxConcurrent) {
          throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
        }
      }

      const results = [];
      for (const slot of slots) {
        // CRT-6: By design, group bookings do not support individual color/custom_label.
        // These fields are omitted intentionally — group members share the same visual style
        // derived from their service. Per-member customization may be added in a future iteration.
        const result = await client.query(
          `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
            channel, appointment_mode, start_at, end_at, status, comment_client,
            group_id, group_order)
           VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, 'confirmed', $8, $9, $10)
           RETURNING *`,
          [bid, practitioner_id, slot.service_id, client_id || null,
           appointment_mode || 'cabinet',
           slot.start_at, slot.end_at,
           comment || null,
           groupId, slot.group_order]
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
        if (dc?.settings?.deposit_enabled && dc.no_show_count >= (dc.settings.deposit_noshow_threshold || 2)) {
          const svcPriceResult = await client.query(
            `SELECT COALESCE(SUM(s.price_cents), 0) AS total_price
             FROM bookings b JOIN services s ON s.id = b.service_id
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
            const deadline = new Date(new Date(start_at).getTime() - dlHours * 3600000);
            if (deadline > new Date()) {
              await client.query(
                `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                  deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2
                 WHERE id = $3 AND business_id = $4`,
                [depCents, deadline.toISOString(), results[0].id, bid]
              );
              results[0].status = 'pending_deposit';
              results[0].deposit_required = true;
              results[0].deposit_amount_cents = depCents;
            }
          }
        }
      }

      return results;
    });

    broadcast(bid, 'booking_update', { action: 'created' });
    bookings.forEach(b => calSyncPush(bid, b.id).catch(() => {}));

    // Send confirmation email (non-blocking)
    if (client_email && client_id) {
      (async () => {
        try {
          const biz = await queryWithRLS(bid, `SELECT name, email, address, theme, settings FROM businesses WHERE id = $1`, [bid]);
          const cl = await queryWithRLS(bid, `SELECT full_name FROM clients WHERE id = $1 AND business_id = $2`, [client_id, bid]);
          const svc = await queryWithRLS(bid, `SELECT name FROM services WHERE id = $1 AND business_id = $2`, [bookings[0].service_id, bid]);
          const prac = await queryWithRLS(bid, `SELECT display_name FROM practitioners WHERE id = $1 AND business_id = $2`, [practitioner_id, bid]);
          if (biz.rows[0] && cl.rows[0]) {
            await sendBookingConfirmation({
              booking: { ...bookings[0], client_name: cl.rows[0].full_name, client_email: client_email, service_name: svc.rows[0]?.name || 'Rendez-vous', practitioner_name: prac.rows[0]?.display_name || '' },
              business: biz.rows[0]
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
