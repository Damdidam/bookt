const router = require('express').Router();
const { query } = require('../../services/db');
const { getAvailableSlots, getAvailableSlotsMulti, getAvailableSlotsMultiPractitioner } = require('../../services/slot-engine');
const { slotsLimiter, clientPhoneLimiter } = require('../../middleware/rate-limiter');
const { isWithinLastMinuteWindow, UUID_RE } = require('./helpers');

// ============================================================
// GET /api/public/:slug/slots
// (unchanged from v1)
// ============================================================
router.get('/:slug/slots', slotsLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { service_id, practitioner_id, date_from, date_to, appointment_mode, variant_id } = req.query;

    if (!service_id) {
      return res.status(400).json({ error: 'service_id requis' });
    }
    if (!UUID_RE.test(service_id)) {
      return res.status(400).json({ error: 'service_id invalide' });
    }
    if (practitioner_id && !UUID_RE.test(practitioner_id)) {
      return res.status(400).json({ error: 'practitioner_id invalide' });
    }
    if (variant_id && !UUID_RE.test(variant_id)) {
      return res.status(400).json({ error: 'variant_id invalide' });
    }

    const bizResult = await query(
      `SELECT id, plan, settings FROM businesses WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
    const bizPlan = bizResult.rows[0].plan || 'free';
    const bizSettings = bizResult.rows[0].settings || {};
    const brusselsToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const from = date_from || brusselsToday;
    const defaultToDate = new Date(brusselsToday + 'T12:00:00Z');
    defaultToDate.setUTCDate(defaultToDate.getUTCDate() + 14);
    const to = date_to || defaultToDate.toLocaleDateString('en-CA', { timeZone: 'UTC' });

    // Bug H2 fix: Prevent DoS via unbounded date range
    const fromDate = new Date(from + 'T00:00:00Z');
    const toDate = new Date(to + 'T00:00:00Z');
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return res.status(400).json({ error: 'Dates invalides' });
    if (toDate < fromDate) return res.status(400).json({ error: 'date_to doit être après date_from' });
    if ((toDate - fromDate) / 86400000 > 60) {
      return res.status(400).json({ error: 'Plage maximale : 60 jours' });
    }

    const slots = await getAvailableSlots({
      businessId, serviceId: service_id,
      practitionerId: practitioner_id || null,
      dateFrom: from, dateTo: to, appointmentMode: appointment_mode,
      variantId: variant_id || null
    });

    // ── Last-minute discount tagging ──
    if (bizSettings.last_minute_enabled && bizPlan !== 'free' && slots.length > 0) {
      const discountPct = bizSettings.last_minute_discount_pct || 10;
      const minPriceCents = bizSettings.last_minute_min_price_cents || 0;
      const deadline = bizSettings.last_minute_deadline || 'j-1';

      // Resolve service price + promo eligibility (with variant override)
      let servicePriceCents = 0;
      const svcPriceResult = await query(
        `SELECT price_cents, promo_eligible FROM services WHERE id = $1 AND business_id = $2`,
        [service_id, businessId]
      );
      if (svcPriceResult.rows[0]?.promo_eligible === false) {
        // Service opted out of last-minute promos — skip tagging
      } else {
      servicePriceCents = svcPriceResult.rows[0]?.price_cents || 0;
      if (variant_id) {
        const varPriceResult = await query(
          `SELECT price_cents FROM service_variants WHERE id = $1 AND service_id = $2`,
          [variant_id, service_id]
        );
        if (varPriceResult.rows[0]?.price_cents != null) {
          servicePriceCents = varPriceResult.rows[0].price_cents;
        }
      }

      if (servicePriceCents > 0 && servicePriceCents >= minPriceCents) {
        const discountedCents = Math.round(servicePriceCents * (100 - discountPct) / 100);
        for (const slot of slots) {
          if (isWithinLastMinuteWindow(slot.date, brusselsToday, deadline)) {
            slot.is_last_minute = true;
            slot.discount_pct = discountPct;
            slot.original_price_cents = servicePriceCents;
            slot.discounted_price_cents = discountedCents;
          }
        }
      }
      } // end promo_eligible check
    }

    const byDate = {};
    for (const slot of slots) {
      if (!byDate[slot.date]) byDate[slot.date] = [];
      byDate[slot.date].push(slot);
    }

    // SE-1: Include locked week dates so frontend can reliably filter
    const lockedWeeksRes = await query(
      `SELECT lw.week_start, lw.practitioner_id FROM locked_weeks lw
       JOIN practitioners p ON p.id = lw.practitioner_id AND p.business_id = lw.business_id
       WHERE lw.business_id = $1 AND p.featured_enabled = true AND p.is_active = true
         AND lw.week_start >= (CURRENT_DATE - interval '7 days')
       LIMIT 200`, [businessId]
    );
    const locked_weeks = lockedWeeksRes.rows.map(r => ({ week_start: r.week_start, practitioner_id: r.practitioner_id }));

    // Filter out non-featured slots for locked weeks (server-side enforcement)
    let filteredSlots = slots;
    if (locked_weeks.length > 0 && practitioner_id) {
      const pracLocked = locked_weeks.filter(lw => lw.practitioner_id === practitioner_id);
      if (pracLocked.length > 0) {
        const featuredRes = await query(
          `SELECT date, start_time FROM featured_slots WHERE business_id = $1 AND practitioner_id = $2 AND date >= CURRENT_DATE`,
          [businessId, practitioner_id]
        );
        const featuredSet = new Set(featuredRes.rows.map(r => `${r.date}|${r.start_time}`));
        filteredSlots = slots.filter(s => {
          const slotWeekStart = getWeekStart(s.date);
          const isLocked = pracLocked.some(lw => {
            const lwStr = new Date(lw.week_start).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
            return lwStr === slotWeekStart;
          });
          if (!isLocked) return true;
          return featuredSet.has(`${s.date}|${s.start_time}`);
        });
      }
    }
    function getWeekStart(dateStr) {
      const d = new Date(dateStr + 'T12:00:00Z');
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
      return d.toLocaleDateString('en-CA', { timeZone: 'UTC' });
    }

    const filteredByDate = {};
    for (const slot of filteredSlots) {
      if (!filteredByDate[slot.date]) filteredByDate[slot.date] = [];
      filteredByDate[slot.date].push(slot);
    }

    res.json({ slots: filteredSlots, by_date: filteredByDate, total: filteredSlots.length, locked_weeks });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/public/:slug/multi-slots
// Available slots for chained multi-service bookings
// ============================================================
router.get('/:slug/multi-slots', slotsLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { service_ids, variant_ids, practitioner_id, date_from, date_to, appointment_mode } = req.query;

    if (!service_ids) {
      return res.status(400).json({ error: 'service_ids requis (UUIDs séparés par des virgules)' });
    }

    // BUG-m5: Allow duplicate service_ids for multi-slot (same service booked twice)
    const ids = service_ids.split(',').map(s => s.trim()).filter(Boolean);
    const vids = variant_ids ? variant_ids.split(',').map(s => s.trim() || null) : [];
    // UUID-validate non-null variant_ids
    if (vids.some(v => v && !UUID_RE.test(v))) {
      return res.status(400).json({ error: 'variant_ids invalide(s)' });
    }
    if (ids.length < 2) {
      return res.status(400).json({ error: 'Au moins 2 service_ids requis' });
    }
    if (ids.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 prestations par réservation groupée' });
    }
    if (ids.some(id => !UUID_RE.test(id))) {
      return res.status(400).json({ error: 'service_ids invalide(s)' });
    }
    if (practitioner_id && !UUID_RE.test(practitioner_id)) {
      return res.status(400).json({ error: 'practitioner_id invalide' });
    }

    const bizResult = await query(
      `SELECT id, plan, settings FROM businesses WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
    const bizPlan = bizResult.rows[0].plan || 'free';
    const bizSettings = bizResult.rows[0].settings || {};

    if (!bizSettings.multi_service_enabled) {
      return res.status(400).json({ error: 'La réservation multi-prestations n\'est pas activée pour ce cabinet' });
    }

    const brusselsToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const from = date_from || brusselsToday;
    const defaultToDate = new Date(brusselsToday + 'T12:00:00Z');
    defaultToDate.setUTCDate(defaultToDate.getUTCDate() + 14);
    const to = date_to || defaultToDate.toLocaleDateString('en-CA', { timeZone: 'UTC' });

    const fromDate = new Date(from + 'T00:00:00Z');
    const toDate = new Date(to + 'T00:00:00Z');
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) return res.status(400).json({ error: 'Dates invalides' });
    if (toDate < fromDate) return res.status(400).json({ error: 'date_to doit être après date_from' });
    if ((toDate - fromDate) / 86400000 > 60) {
      return res.status(400).json({ error: 'Plage maximale : 60 jours' });
    }

    let slots = [];
    let monoFailed = false;
    try {
      slots = await getAvailableSlotsMulti({
        businessId, serviceIds: ids,
        practitionerId: practitioner_id || null,
        dateFrom: from, dateTo: to, appointmentMode: appointment_mode,
        variantIds: vids.length > 0 ? vids : null
      });
    } catch (monoErr) {
      // If practitioner doesn't cover all services, try split fallback
      if (monoErr.type === 'validation') {
        monoFailed = true;
        slots = [];
      } else {
        throw monoErr;
      }
    }

    // Fallback: if no mono-practitioner slots (or validation failed),
    // try multi-practitioner split (different practitioner per service)
    if (slots.length === 0 || monoFailed) {
      try {
        const splitSlots = await getAvailableSlotsMultiPractitioner({
          businessId, serviceIds: ids,
          dateFrom: from, dateTo: to, appointmentMode: appointment_mode,
          variantIds: vids.length > 0 ? vids : null
        });
        if (splitSlots.length > 0) slots = splitSlots;
      } catch (splitErr) {
        console.warn('[MULTI-SLOTS] Split fallback error:', splitErr.message);
      }
    }

    const byDate = {};
    for (const slot of slots) {
      if (!byDate[slot.date]) byDate[slot.date] = [];
      byDate[slot.date].push(slot);
    }

    // Calculate total_duration_min from the services for metadata
    // (re-derive from slot data: end_time - start_time of any slot gives sumDurations)
    let totalDurationMin = 0;
    if (slots.length > 0) {
      const [eh, em] = slots[0].end_time.split(':').map(Number);
      const [sh, sm] = slots[0].start_time.split(':').map(Number);
      totalDurationMin = (eh * 60 + em) - (sh * 60 + sm);
    }

    res.json({ by_date: byDate, total: slots.length, total_duration_min: totalDurationMin, split_mode: monoFailed });
  } catch (err) {
    if (err.type === 'validation') return res.status(400).json({ error: err.message });
    if (err.type === 'not_found') return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// GET /api/public/:slug/featured-slots
// Returns practitioner-curated slots + locked weeks for the public booking page
// ============================================================
router.get('/:slug/featured-slots', slotsLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { practitioner_id, date_from, date_to } = req.query;

    const bizResult = await query(
      `SELECT id FROM businesses WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;

    // Featured slots (start_time only, no end_time) — only for practitioners with featured_enabled
    let sql = `
      SELECT fs.practitioner_id, fs.date, fs.start_time
      FROM featured_slots fs
      JOIN practitioners p ON p.id = fs.practitioner_id AND p.business_id = fs.business_id
      WHERE fs.business_id = $1 AND fs.date >= CURRENT_DATE
        AND p.featured_enabled = true AND p.is_active = true`;
    const params = [businessId];

    if (practitioner_id && !UUID_RE.test(practitioner_id)) return res.status(400).json({ error: 'practitioner_id invalide' });

    if (practitioner_id) {
      params.push(practitioner_id);
      sql += ` AND fs.practitioner_id = $${params.length}`;
    }
    if (date_from && !/^\d{4}-\d{2}-\d{2}$/.test(date_from)) return res.status(400).json({ error: 'date_from invalide' });
    if (date_to && !/^\d{4}-\d{2}-\d{2}$/.test(date_to)) return res.status(400).json({ error: 'date_to invalide' });

    if (date_from) {
      params.push(date_from);
      sql += ` AND fs.date >= $${params.length}::date`;
    }
    if (date_to) {
      params.push(date_to);
      sql += ` AND fs.date <= $${params.length}::date`;
    }

    sql += ' ORDER BY fs.date, fs.start_time LIMIT 500';

    // Locked weeks — only for practitioners with featured_enabled
    const lwSql = `
      SELECT lw.practitioner_id, lw.week_start
      FROM locked_weeks lw
      JOIN practitioners p ON p.id = lw.practitioner_id AND p.business_id = lw.business_id
      WHERE lw.business_id = $1 AND lw.week_start >= (CURRENT_DATE - interval '7 days')
        AND p.featured_enabled = true AND p.is_active = true
      LIMIT 200`;

    const [slotsResult, locksResult] = await Promise.all([
      query(sql, params),
      query(lwSql, [businessId])
    ]);

    res.json({
      featured_slots: slotsResult.rows,
      locked_weeks: locksResult.rows
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/public/:slug/client-phone
// Lookup known client by email or phone (for form auto-fill + first_visit check)
// ============================================================
router.get('/:slug/client-phone', clientPhoneLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const email = (req.query.email || '').trim().toLowerCase();
    const phone = (req.query.phone || '').trim();
    if (!email && !phone) return res.json({});
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({});

    const biz = await query(`SELECT id FROM businesses WHERE slug = $1`, [slug]);
    if (biz.rows.length === 0) return res.json({});
    const bid = biz.rows[0].id;

    // Try email first, then phone fallback
    let cl = { rows: [] };
    if (email) {
      cl = await query(
        `SELECT c.id, c.phone, c.full_name,
                (SELECT COUNT(*)::int FROM bookings b WHERE b.client_id = c.id AND b.status NOT IN ('cancelled')) AS booking_count
         FROM clients c WHERE c.business_id = $1 AND LOWER(c.email) = $2
         ORDER BY c.updated_at DESC LIMIT 1`,
        [bid, email]
      );
    }
    if (cl.rows.length === 0 && phone) {
      cl = await query(
        `SELECT c.id, c.phone, c.full_name,
                (SELECT COUNT(*)::int FROM bookings b WHERE b.client_id = c.id AND b.status NOT IN ('cancelled')) AS booking_count
         FROM clients c WHERE c.business_id = $1 AND c.phone = $2
         ORDER BY c.updated_at DESC LIMIT 1`,
        [bid, phone]
      );
    }
    if (cl.rows.length === 0) return res.json({ booking_count: 0 });

    res.json({ phone: cl.rows[0].phone || null, name: cl.rows[0].full_name, booking_count: cl.rows[0].booking_count });
  } catch (err) { next(err); }
});

module.exports = router;
