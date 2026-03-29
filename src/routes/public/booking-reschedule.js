/**
 * Booking Reschedule — client self-reschedule flow.
 * Extracted from index.js (Phase 4c refactoring).
 */
const router = require('express').Router();
const { query, queryWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { slotsLimiter, bookingLimiter } = require('../../middleware/rate-limiter');
const { getAvailableSlots, getAvailableSlotsMultiPractitioner } = require('../../services/slot-engine');
const { UUID_RE } = require('./helpers');

const { pool } = require('../../services/db');
const { checkPracAvailability, checkBookingConflicts } = require('../staff/bookings-helpers');
const { computeDepositDeadline } = require('./helpers');

// ============================================================
// GET /api/public/manage/:token/slots?date=YYYY-MM-DD
// Available slots for client reschedule
// ============================================================
router.get('/manage/:token/slots', slotsLimiter, async (req, res, next) => {
  try {
    const { token } = req.params;
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Paramètre date requis (YYYY-MM-DD)' });

    // Lookup booking + group info
    const result = await query(
      `SELECT b.id, b.start_at, b.end_at, b.status, b.locked, b.reschedule_count,
              b.business_id, b.service_id, b.service_variant_id, b.practitioner_id,
              b.appointment_mode, b.group_id,
              biz.settings AS business_settings
       FROM bookings b
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];
    const settings = bk.business_settings || {};

    // Detect split group
    let isSplitGroup = false;
    let splitServiceIds = null;
    let splitVariantIds = null;
    if (bk.group_id) {
      const grpMembers = await query(
        `SELECT b.service_id, b.service_variant_id, b.practitioner_id
         FROM bookings b WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, bk.business_id]
      );
      if (grpMembers.rows.length > 1) {
        const pracIds = new Set(grpMembers.rows.map(r => r.practitioner_id));
        isSplitGroup = pracIds.size > 1;
        if (isSplitGroup) {
          splitServiceIds = grpMembers.rows.map(r => r.service_id);
          splitVariantIds = grpMembers.rows.map(r => r.service_variant_id || null);
        }
      }
    }

    // Re-check eligibility
    const reschEnabled = !!settings.reschedule_enabled;
    const reschDeadlineHours = settings.reschedule_deadline_hours ?? 24;
    const reschMaxCount = settings.reschedule_max_count ?? 1;
    const reschWindowDays = settings.reschedule_window_days ?? 30;
    const now = new Date();
    const reschDeadline = new Date(new Date(bk.start_at).getTime() - reschDeadlineHours * 3600000);

    if (!reschEnabled) return res.status(403).json({ error: 'La modification en ligne n\'est pas activée.' });
    if (!['confirmed', 'pending_deposit'].includes(bk.status)) return res.status(403).json({ error: 'Ce rendez-vous ne peut pas être modifié.' });
    if (bk.locked) return res.status(403).json({ error: 'Ce rendez-vous est verrouillé.' });
    if ((bk.reschedule_count || 0) >= reschMaxCount) return res.status(403).json({ error: 'Nombre maximum de modifications atteint.' });
    if (now >= reschDeadline) return res.status(403).json({ error: 'Le délai de modification est dépassé.' });

    // Validate date range
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const maxDate = new Date(new Date(today).getTime() + reschWindowDays * 86400000).toISOString().slice(0, 10);
    if (date < today || date > maxDate) return res.status(400).json({ error: `Date hors de la fenêtre autorisée (${reschWindowDays} jours).` });

    let slots;
    if (isSplitGroup && splitServiceIds) {
      // Split booking: use multi-practitioner slot engine
      slots = await getAvailableSlotsMultiPractitioner({
        businessId: bk.business_id,
        serviceIds: splitServiceIds,
        dateFrom: date,
        dateTo: date,
        appointmentMode: bk.appointment_mode,
        variantIds: splitVariantIds.length > 0 ? splitVariantIds : undefined
      });
    } else {
      // Single or same-practitioner group: use standard slot engine
      slots = await getAvailableSlots({
        businessId: bk.business_id,
        serviceId: bk.service_id,
        practitionerId: bk.practitioner_id,
        dateFrom: date,
        dateTo: date,
        appointmentMode: bk.appointment_mode,
        variantId: bk.service_variant_id || undefined
      });
    }

    // Filter out the booking's current slot (so client doesn't see it)
    const bkStart = new Date(bk.start_at).toISOString();
    const filtered = slots.filter(s => s.start_at !== bkStart);

    res.json({
      date,
      slots: filtered.map(s => ({
        start_time: s.start_time,
        end_time: s.end_time,
        start_at: s.start_at,
        end_at: s.end_at,
        practitioners: s.practitioners || null
      }))
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/manage/:token/reschedule
// Client self-reschedule — move booking to new time
// ============================================================
router.post('/manage/:token/reschedule', bookingLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { token } = req.params;
    const { start_at, end_at, practitioners: slotPractitioners } = req.body;
    if (!start_at || !end_at) return res.status(400).json({ error: 'start_at et end_at requis' });

    const newStart = new Date(start_at);
    const newEnd = new Date(end_at);
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) return res.status(400).json({ error: 'Dates invalides' });
    if (newEnd <= newStart) return res.status(400).json({ error: 'end_at doit être après start_at' });
    if (newStart <= new Date()) return res.status(400).json({ error: 'Le créneau doit être dans le futur' });

    await client.query('BEGIN');

    // Lock booking
    const result = await client.query(
      `SELECT b.id, b.start_at, b.end_at, b.status, b.locked, b.reschedule_count,
              b.business_id, b.service_id, b.service_variant_id, b.practitioner_id,
              b.group_id, b.client_id, b.appointment_mode, b.public_token,
              b.deposit_status, b.deposit_deadline,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              biz.settings AS business_settings,
              biz.slug AS business_slug
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1
       FOR UPDATE OF b SKIP LOCKED`,
      [token]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rendez-vous introuvable ou en cours de modification' });
    }

    const bk = result.rows[0];
    const settings = bk.business_settings || {};
    const reschDeadlineHours = settings.reschedule_deadline_hours ?? 24;
    const reschMaxCount = settings.reschedule_max_count ?? 1;
    const reschWindowDays = settings.reschedule_window_days ?? 30;
    const now = new Date();

    // Eligibility checks
    if (!settings.reschedule_enabled) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'La modification en ligne n\'est pas activée.' }); }
    if (!['confirmed', 'pending_deposit'].includes(bk.status)) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Ce rendez-vous ne peut pas être modifié.' }); }
    if (bk.locked) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Ce rendez-vous est verrouillé.' }); }
    if ((bk.reschedule_count || 0) >= reschMaxCount) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Nombre maximum de modifications atteint.' }); }
    const reschDeadline = new Date(new Date(bk.start_at).getTime() - reschDeadlineHours * 3600000);
    if (now >= reschDeadline) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Le délai de modification est dépassé.' }); }

    // Validate date within window
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const maxDate = new Date(new Date(today).getTime() + reschWindowDays * 86400000);
    if (newStart > maxDate) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Le créneau doit être dans les ${reschWindowDays} prochains jours.` }); }

    // Same slot check
    if (newStart.getTime() === new Date(bk.start_at).getTime()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'C\'est déjà votre créneau actuel.' }); }

    // Deposit deadline check for approaching dates
    const oldStart = new Date(bk.start_at);
    const delta = newStart.getTime() - oldStart.getTime();
    if (bk.deposit_status === 'pending' && delta < 0) {
      const dlHours = settings.deposit_deadline_hours ?? 48;
      const newDeadline = new Date(newStart.getTime() - dlHours * 3600000);
      if (newDeadline <= new Date(Date.now() + 3600000)) { // < now + 1h
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Impossible de rapprocher la date : le délai de paiement de l\'acompte serait dépassé. Contactez le salon.' });
      }
    }

    // Detect split group
    let isSplitGroup = false;
    let groupMembers = [];
    if (bk.group_id) {
      const grpRes = await client.query(
        `SELECT id, start_at, end_at, practitioner_id, service_id, group_order
         FROM bookings
         WHERE group_id = $1 AND business_id = $2
         ORDER BY group_order, start_at
         FOR UPDATE SKIP LOCKED`,
        [bk.group_id, bk.business_id]
      );
      groupMembers = grpRes.rows;
      if (groupMembers.length > 1) {
        const pracIds = new Set(groupMembers.map(m => m.practitioner_id));
        isSplitGroup = pracIds.size > 1;
      }
    }

    if (isSplitGroup && Array.isArray(slotPractitioners) && slotPractitioners.length > 0) {
      // ── Split booking reschedule: use per-member times from slot practitioners ──
      // Validate each practitioner assignment
      for (const sp of slotPractitioners) {
        const avail = await checkPracAvailability(bk.business_id, sp.practitioner_id, sp.start_at, sp.end_at);
        if (!avail.ok) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Un praticien n\'est pas disponible à cet horaire.' }); }
      }

      // Match group members to slot practitioners by service_id order
      for (let i = 0; i < groupMembers.length; i++) {
        const m = groupMembers[i];
        const sp = slotPractitioners[i];
        if (!sp) continue;

        // Conflict check per member (exclude self)
        const conflicts = await checkBookingConflicts(client, {
          businessId: bk.business_id,
          practitionerId: sp.practitioner_id,
          startAt: sp.start_at,
          endAt: sp.end_at,
          excludeBookingId: m.id,
          serviceId: m.service_id
        });
        if (conflicts.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ce créneau n\'est plus disponible.' }); }

        await client.query(
          `UPDATE bookings SET start_at = $1, end_at = $2, practitioner_id = $3, reschedule_count = reschedule_count + 1, updated_at = NOW()
           WHERE id = $4`,
          [sp.start_at, sp.end_at, sp.practitioner_id, m.id]
        );
      }
    } else if (bk.group_id && groupMembers.length > 0) {
      // ── Same-practitioner group: shift all members by the same delta ──
      // Practitioner availability
      const avail = await checkPracAvailability(bk.business_id, bk.practitioner_id, start_at, end_at);
      if (!avail.ok) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Le praticien n\'est pas disponible à cet horaire.' }); }

      const conflicts = await checkBookingConflicts(client, {
        businessId: bk.business_id,
        practitionerId: bk.practitioner_id,
        startAt: start_at,
        endAt: end_at,
        excludeBookingId: bk.id,
        serviceId: bk.service_id
      });
      if (conflicts.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ce créneau n\'est plus disponible.' }); }

      for (const m of groupMembers) {
        const mNewStart = new Date(new Date(m.start_at).getTime() + delta);
        const mNewEnd = new Date(new Date(m.end_at).getTime() + delta);
        await client.query(
          `UPDATE bookings SET start_at = $1, end_at = $2, reschedule_count = reschedule_count + 1, updated_at = NOW()
           WHERE id = $3`,
          [mNewStart.toISOString(), mNewEnd.toISOString(), m.id]
        );
      }
    } else {
      // ── Single booking ──
      const avail = await checkPracAvailability(bk.business_id, bk.practitioner_id, start_at, end_at);
      if (!avail.ok) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Le praticien n\'est pas disponible à cet horaire.' }); }

      const conflicts = await checkBookingConflicts(client, {
        businessId: bk.business_id,
        practitionerId: bk.practitioner_id,
        startAt: start_at,
        endAt: end_at,
        excludeBookingId: bk.id,
        serviceId: bk.service_id
      });
      if (conflicts.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Ce créneau n\'est plus disponible.' }); }

      await client.query(
        `UPDATE bookings SET start_at = $1, end_at = $2, reschedule_count = reschedule_count + 1, updated_at = NOW()
         WHERE id = $3`,
        [start_at, end_at, bk.id]
      );
    }

    // Deposit deadline: recalculate based on new start (same as confirmation timeout)
    if (bk.deposit_deadline && bk.deposit_status === 'pending') {
      const newDeadline = computeDepositDeadline(newStart, settings);

      const updateIds = bk.group_id
        ? (await client.query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2`, [bk.group_id, bk.business_id])).rows.map(r => r.id)
        : [bk.id];
      for (const uid of updateIds) {
        await client.query(`UPDATE bookings SET deposit_deadline = $1 WHERE id = $2`, [newDeadline.toISOString(), uid]);
      }
    }

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, actor_user_id, old_data, new_data)
       VALUES ($1, 'booking', $2, 'client_reschedule', NULL, $3, $4)`,
      [bk.business_id, bk.id,
       JSON.stringify({ start_at: bk.start_at, end_at: bk.end_at }),
       JSON.stringify({ start_at, end_at, reschedule_count: (bk.reschedule_count || 0) + 1, group: !!bk.group_id })]
    );

    await client.query('COMMIT');

    // Post-commit: SSE broadcast
    try { broadcast(bk.business_id, 'booking_update', { action: 'rescheduled', bookingId: bk.id, source: 'client' }); } catch (_) {}

    // Post-commit: send confirmation email (async, non-blocking)
    (async () => {
      try {
        const { sendRescheduleConfirmationEmail } = require('../../services/email');
        const bkData = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category, COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS business_name, biz.slug AS business_slug, biz.settings, biz.theme,
                  biz.email AS business_email, biz.address AS business_address
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           JOIN practitioners p ON p.id = b.practitioner_id LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id WHERE b.id = $1`, [bk.id]
        );
        if (bkData.rows.length) {
          const r = bkData.rows[0];
          // Fetch group services for split bookings
          let groupSvcs = null;
          if (r.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents,
                      b.practitioner_id, p.display_name AS practitioner_name,
                      b.start_at, b.end_at
               FROM bookings b
               LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               LEFT JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.group_id = $1 AND b.business_id = $2
               ORDER BY b.group_order, b.start_at`,
              [r.group_id, r.business_id]
            );
            if (grp.rows.length > 1) {
              const _pIds = new Set(grp.rows.map(g => g.practitioner_id));
              const hasSplitPrac = _pIds.size > 1;
              groupSvcs = grp.rows.map(g => ({
                name: g.name, duration_min: g.duration_min, price_cents: g.price_cents,
                practitioner_name: hasSplitPrac ? g.practitioner_name : null,
                start_at: g.start_at, end_at: g.end_at
              }));
              // Update booking times to reflect full group range
              r.start_at = grp.rows[0].start_at;
              r.end_at = grp.rows[grp.rows.length - 1].end_at;
            }
          }
          await sendRescheduleConfirmationEmail({
            booking: r,
            business: { name: r.business_name, slug: r.business_slug, settings: r.settings, theme: r.theme, email: r.business_email, address: r.business_address },
            oldStartAt: bk.start_at,
            oldEndAt: groupMembers.length > 1 ? groupMembers[groupMembers.length - 1].end_at : bk.end_at,
            groupServices: groupSvcs
          });
        }
      } catch (emailErr) { console.error('[RESCHEDULE] Email error:', emailErr.message); }
    })();

    // Post-commit: queue practitioner notification
    try {
      await query(
        `INSERT INTO notifications (id, business_id, booking_id, type, status, created_at)
         VALUES (uuid_generate_v4(), $1, $2, 'email_reschedule_pro', 'queued', NOW())`,
        [bk.business_id, bk.id]
      );
    } catch (_) {}

    res.json({ rescheduled: true, booking: { start_at, end_at } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
