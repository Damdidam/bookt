/**
 * Booking Creation — POST /manual
 * Creates manual bookings (freestyle or service-based, single or grouped).
 */
const router = require('express').Router();
const { query, queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { sendBookingConfirmation } = require('../../services/email');
const { calSyncPush, businessAllowsOverlap } = require('./bookings-helpers');

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

    if (!practitioner_id || !start_at) {
      return res.status(400).json({ error: 'practitioner_id et start_at requis' });
    }

    // Check global overlap policy
    const globalAllowOverlap = await businessAllowsOverlap(bid);

    // ── FREESTYLE MODE: no predefined service ──
    if (freestyle) {
      if (!end_at) return res.status(400).json({ error: 'end_at requis en mode libre' });
      const bufBefore = parseInt(buffer_before_min) || 0;
      const bufAfter = parseInt(buffer_after_min) || 0;
      const realStart = new Date(new Date(start_at).getTime() - bufBefore * 60000);
      const realEnd = new Date(new Date(end_at).getTime() + bufAfter * 60000);

      const bookings = await transactionWithRLS(bid, async (client) => {
        if (!globalAllowOverlap) {
          const conflict = await client.query(
            `SELECT id FROM bookings
             WHERE business_id = $1 AND practitioner_id = $2
             AND status IN ('pending', 'confirmed', 'pending_deposit')
             AND start_at < $4 AND end_at > $3
             FOR UPDATE`,
            [bid, practitioner_id, realStart.toISOString(), realEnd.toISOString()]
          );
          if (conflict.rows.length > 0) {
            throw Object.assign(new Error('Créneau déjà pris'), { type: 'conflict' });
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

        return [result.rows[0]];
      });

      // ===== DEPOSIT CHECK (freestyle) =====
      if (client_id && bookings[0]) {
        try {
          const depCheck = await queryWithRLS(bid,
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
              const dlHours = dc.settings.deposit_deadline_hours || 48;
              const deadline = new Date(new Date(start_at).getTime() - dlHours * 3600000);
              await queryWithRLS(bid,
                `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                  deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2
                 WHERE id = $3 AND business_id = $4`,
                [depCents, deadline.toISOString(), bookings[0].id, bid]
              );
              bookings[0].status = 'pending_deposit';
              bookings[0].deposit_required = true;
              bookings[0].deposit_amount_cents = depCents;
            }
          }
        } catch (e) { console.warn('[DEPOSIT] Freestyle check error:', e.message); }
      }

      broadcast(bid, 'booking_update', { action: 'created' });
      calSyncPush(bid, bookings[0].id).catch(() => {});

      // Send confirmation email (non-blocking)
      const clientEmail = req.body.client_email;
      if (clientEmail && client_id) {
        (async () => {
          try {
            const biz = await query(`SELECT name, email, address, theme, settings FROM businesses WHERE id = $1`, [bid]);
            const cl = await query(`SELECT full_name FROM clients WHERE id = $1`, [client_id]);
            if (biz.rows[0] && cl.rows[0]) {
              await sendBookingConfirmation({
                booking: { ...bookings[0], client_name: cl.rows[0].full_name, client_email: clientEmail, service_name: custom_label || 'Rendez-vous libre', practitioner_name: '' },
                business: biz.rows[0]
              });
            }
          } catch (e) { console.warn('[EMAIL] Confirmation send error:', e.message); }
        })();
      }

      return res.status(201).json({ booking: bookings[0], bookings });
    }

    // ── NORMAL MODE: predefined service(s) ──
    const serviceList = multiServices || [{ service_id }];

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

    // Validate all services exist
    for (const s of serviceList) {
      if (!svcMap[s.service_id]) return res.status(404).json({ error: `Prestation ${s.service_id} introuvable` });
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

    const bookings = await transactionWithRLS(bid, async (client) => {
      // Check conflicts for the entire time range (skip if business allows overlap)
      if (!globalAllowOverlap) {
        const conflict = await client.query(
          `SELECT id FROM bookings
           WHERE business_id = $1 AND practitioner_id = $2
           AND status IN ('pending', 'confirmed')
           AND start_at < $4 AND end_at > $3
           FOR UPDATE`,
          [bid, practitioner_id, new Date(start_at).toISOString(), totalEnd]
        );

        if (conflict.rows.length > 0) {
          throw Object.assign(new Error('Créneau déjà pris'), { type: 'conflict' });
        }
      }

      const results = [];
      for (const slot of slots) {
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

      return results;
    });

    // ===== DEPOSIT CHECK (normal mode) =====
    if (client_id && bookings.length > 0) {
      try {
        const depCheck = await queryWithRLS(bid,
          `SELECT c.no_show_count, biz.settings
           FROM clients c JOIN businesses biz ON biz.id = c.business_id
           WHERE c.id = $1 AND c.business_id = $2`,
          [client_id, bid]
        );
        const dc = depCheck.rows[0];
        if (dc?.settings?.deposit_enabled && dc.no_show_count >= (dc.settings.deposit_noshow_threshold || 2)) {
          // Get total service price for the booking(s)
          const svcPriceResult = await queryWithRLS(bid,
            `SELECT COALESCE(SUM(s.price_cents), 0) AS total_price
             FROM bookings b JOIN services s ON s.id = b.service_id
             WHERE b.id = ANY($1) AND b.business_id = $2`,
            [bookings.map(b => b.id), bid]
          );
          const totalPrice = parseInt(svcPriceResult.rows[0]?.total_price) || 0;
          let depCents = 0;
          if (dc.settings.deposit_type === 'fixed') {
            depCents = dc.settings.deposit_fixed_cents || 2500;
          } else {
            depCents = Math.round(totalPrice * (dc.settings.deposit_percent || 50) / 100);
          }
          if (depCents > 0) {
            const dlHours = dc.settings.deposit_deadline_hours || 48;
            const deadline = new Date(new Date(start_at).getTime() - dlHours * 3600000);
            const bkIds = bookings.map(b => b.id);
            await queryWithRLS(bid,
              `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2
               WHERE id = ANY($3) AND business_id = $4`,
              [depCents, deadline.toISOString(), bkIds, bid]
            );
            bookings.forEach(b => {
              b.status = 'pending_deposit';
              b.deposit_required = true;
              b.deposit_amount_cents = depCents;
            });
          }
        }
      } catch (e) { console.warn('[DEPOSIT] Normal check error:', e.message); }
    }

    broadcast(bid, 'booking_update', { action: 'created' });
    bookings.forEach(b => calSyncPush(bid, b.id).catch(() => {}));

    // Send confirmation email (non-blocking)
    const clientEmailNormal = req.body.client_email;
    if (clientEmailNormal && client_id) {
      (async () => {
        try {
          const biz = await query(`SELECT name, email, address, theme, settings FROM businesses WHERE id = $1`, [bid]);
          const cl = await query(`SELECT full_name FROM clients WHERE id = $1`, [client_id]);
          const svc = await query(`SELECT name FROM services WHERE id = $1`, [bookings[0].service_id]);
          const prac = await query(`SELECT display_name FROM practitioners WHERE id = $1`, [practitioner_id]);
          if (biz.rows[0] && cl.rows[0]) {
            await sendBookingConfirmation({
              booking: { ...bookings[0], client_name: cl.rows[0].full_name, client_email: clientEmailNormal, service_name: svc.rows[0]?.name || 'Rendez-vous', practitioner_name: prac.rows[0]?.display_name || '' },
              business: biz.rows[0]
            });
          }
        } catch (e) { console.warn('[EMAIL] Confirmation send error:', e.message); }
      })();
    }

    res.status(201).json({ booking: bookings[0], bookings, group_id: groupId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
