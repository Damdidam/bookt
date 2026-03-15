const router = require('express').Router();
const { query, queryWithRLS } = require('../../services/db');
const { getAvailableSlots, getAvailableSlotsMulti } = require('../../services/slot-engine');
const { bookingLimiter, slotsLimiter } = require('../../middleware/rate-limiter');
const { processWaitlistForCancellation } = require('../../services/waitlist');
const { broadcast } = require('../../services/sse');
const { getCategoryLabels, sendBookingConfirmation } = require('../../services/email');
const { checkPracAvailability, checkBookingConflicts } = require('../staff/bookings-helpers');

// Mount OAuth sub-router for client booking authentication
router.use('/auth', require('./oauth'));

const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Determine if a deposit should be required for a public booking.
 * Returns { required: true, depCents, reason } or { required: false }.
 *
 * Triggers (OR logic — any one is enough):
 *   1. Price/duration thresholds (applies to ALL clients, even new ones)
 *   2. No-show recidivists (only if clientId exists and has history)
 *
 * @param {object} bizSettings - business.settings JSONB
 * @param {number} totalPriceCents - total price of all services
 * @param {number} totalDurationMin - total duration in minutes
 * @param {number} noShowCount - client's no-show count (0 for new clients)
 * @param {boolean} [isVip=false] - VIP clients are exempt from deposits
 */
function shouldRequireDeposit(bizSettings, totalPriceCents, totalDurationMin, noShowCount, isVip) {
  if (!bizSettings?.deposit_enabled) return { required: false };
  if (isVip) return { required: false };

  // Check price/duration thresholds
  const priceThresh = bizSettings.deposit_price_threshold_cents || 0;
  const durThresh = bizSettings.deposit_duration_threshold_min || 0;
  const threshMode = bizSettings.deposit_threshold_mode || 'any';

  const priceHit = priceThresh > 0 && totalPriceCents >= priceThresh;
  const durHit = durThresh > 0 && totalDurationMin >= durThresh;

  // Only evaluate threshold if at least one threshold is configured
  const hasThresholds = priceThresh > 0 || durThresh > 0;
  const thresholdTrigger = hasThresholds && (threshMode === 'both' ? (priceHit && durHit) : (priceHit || durHit));

  // Check no-show recidivist
  const noShowThreshold = bizSettings.deposit_noshow_threshold || 2;
  const noShowTrigger = noShowCount >= noShowThreshold;

  if (!thresholdTrigger && !noShowTrigger) return { required: false };

  // Calculate deposit amount
  let depCents = 0;
  if (bizSettings.deposit_type === 'fixed') {
    depCents = bizSettings.deposit_fixed_cents || 2500;
  } else {
    depCents = Math.round(totalPriceCents * (bizSettings.deposit_percent || 50) / 100);
  }

  if (depCents <= 0) return { required: false };

  const reasons = [];
  if (thresholdTrigger) {
    if (priceHit) reasons.push('prix');
    if (durHit) reasons.push('durée');
  }
  if (noShowTrigger) reasons.push('no-show');

  return { required: true, depCents, reason: reasons.join('+') };
}

/**
 * Check if a slot date falls within the last-minute promotional window.
 * @param {string} slotDate - YYYY-MM-DD
 * @param {string} todayBrussels - YYYY-MM-DD (today in Europe/Brussels)
 * @param {string} deadline - 'j-2' | 'j-1' | 'same_day'
 */
function isWithinLastMinuteWindow(slotDate, todayBrussels, deadline) {
  const slot = new Date(slotDate + 'T12:00:00Z');
  const now = new Date(todayBrussels + 'T12:00:00Z');
  const diffDays = Math.round((slot - now) / 86400000);
  if (diffDays < 0) return false;
  switch (deadline) {
    case 'j-2': return diffDays <= 2;
    case 'j-1': return diffDays <= 1;
    case 'same_day': return diffDays === 0;
    default: return false;
  }
}

const SECTOR_PRACTITIONER = {
  coiffeur:'Coiffeur·se', esthetique:'Esthéticien·ne', bien_etre:'Praticien·ne',
  osteopathe:'Ostéopathe', veterinaire:'Vétérinaire', photographe:'Photographe',
  medecin:'Médecin', dentiste:'Dentiste', kine:'Kinésithérapeute',
  comptable:'Collaborateur·rice', avocat:'Avocat·e', autre:'Praticien·ne'
};

// ============================================================
// GET /api/public/sector-categories
// Sector categories catalog (public, no auth)
// ============================================================
router.get('/sector-categories', async (req, res) => {
  try {
    const { sector } = req.query;
    if (!sector) return res.status(400).json({ error: 'sector query param requis' });
    const result = await query(
      `SELECT label, icon_svg, sort_order FROM sector_categories
       WHERE sector = $1 AND is_active = true ORDER BY sort_order`,
      [sector]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[PUBLIC] sector-categories error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============================================================
// GET /api/public/:slug
// FULL mini-site data — everything needed to render the public page
// UI: The entire booking-minisite-public.html
// ============================================================
router.get('/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    // Also check custom domains
    let bizResult = await query(
      `SELECT b.id, b.slug, b.name, b.tagline, b.description, b.phone, b.email,
              b.address, b.language_default, b.languages_spoken, b.founded_year,
              b.accreditation, b.bce_number, b.parking_info, b.logo_url,
              b.cover_image_url, b.social_links, b.theme, b.seo_title,
              b.seo_description, b.page_sections, b.settings,
              b.google_reviews_url, b.category, b.sector
       FROM businesses b WHERE b.slug = $1 AND b.is_active = true`,
      [slug]
    );

    // If not found by slug, try custom domain
    if (bizResult.rows.length === 0) {
      bizResult = await query(
        `SELECT b.id, b.slug, b.name, b.tagline, b.description, b.phone, b.email,
                b.address, b.language_default, b.languages_spoken, b.founded_year,
                b.accreditation, b.bce_number, b.parking_info, b.logo_url,
                b.cover_image_url, b.social_links, b.theme, b.seo_title,
                b.seo_description, b.page_sections, b.settings,
                b.google_reviews_url, b.category, b.sector
         FROM businesses b
         JOIN custom_domains cd ON cd.business_id = b.id
         WHERE cd.domain = $1 AND cd.verification_status = 'ssl_active' AND b.is_active = true`,
        [slug]
      );
    }

    if (bizResult.rows.length === 0) {
      return res.status(404).json({ error: 'Cabinet introuvable' });
    }

    const biz = bizResult.rows[0];
    const bid = biz.id;
    const sections = biz.page_sections || {};

    // ===== PARALLEL QUERIES — all independent, run concurrently =====
    const [pracResult, svcResult, specResult, testResult, valResult, galResult, newsResult, domainResult, hoursResult] = await Promise.all([
      // Practitioners + specializations
      query(
        `SELECT p.id, p.display_name, p.title, p.bio, p.photo_url, p.color,
                p.years_experience, p.linkedin_url, p.waitlist_mode,
                ARRAY_AGG(DISTINCT ps.service_id) FILTER (WHERE ps.service_id IS NOT NULL) AS service_ids,
                ARRAY_AGG(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL) AS specialization_names
         FROM practitioners p
         LEFT JOIN practitioner_services ps ON ps.practitioner_id = p.id
         LEFT JOIN practitioner_specializations psp ON psp.practitioner_id = p.id
         LEFT JOIN specializations s ON s.id = psp.specialization_id AND s.is_active = true
         WHERE p.business_id = $1 AND p.is_active = true AND p.booking_enabled = true
         GROUP BY p.id
         ORDER BY p.sort_order, p.display_name`,
        [bid]
      ),
      // Services
      query(
        `SELECT id, name, category, duration_min, price_cents, price_label,
                mode_options, prep_instructions_fr, prep_instructions_nl, color, description, bookable_online,
                processing_time, processing_start,
                flexibility_enabled, flexibility_discount_pct, available_schedule
         FROM services
         WHERE business_id = $1 AND is_active = true
         ORDER BY sort_order, name`,
        [bid]
      ),
      // Specializations
      sections.specializations !== false
        ? query(`SELECT id, name, description, icon FROM specializations WHERE business_id = $1 AND is_active = true ORDER BY sort_order`, [bid])
        : { rows: [] },
      // Testimonials
      sections.testimonials !== false
        ? query(
            `SELECT t.id, t.author_name, t.author_role, t.author_initials, t.content, t.rating, p.display_name AS practitioner_name
             FROM testimonials t LEFT JOIN practitioners p ON p.id = t.practitioner_id
             WHERE t.business_id = $1 AND t.is_active = true AND t.is_featured = true ORDER BY t.sort_order LIMIT 6`,
            [bid]
          )
        : { rows: [] },
      // Value propositions
      sections.about !== false
        ? query(`SELECT id, title, description, icon, icon_style FROM value_propositions WHERE business_id = $1 AND is_active = true ORDER BY sort_order LIMIT 4`, [bid])
        : { rows: [] },
      // Gallery
      sections.gallery !== false
        ? query(`SELECT id, title, caption, image_url FROM gallery_images WHERE business_id = $1 AND is_active = true ORDER BY sort_order LIMIT 12`, [bid])
        : { rows: [] },
      // News
      sections.news !== false
        ? query(`SELECT id, title, content, tag, tag_type, image_url, published_at FROM news_posts WHERE business_id = $1 AND is_active = true ORDER BY published_at DESC LIMIT 6`, [bid])
        : { rows: [] },
      // Custom domain
      query(`SELECT domain, verification_status FROM custom_domains WHERE business_id = $1 AND verification_status = 'ssl_active'`, [bid]),
      // Hours: prefer business_schedule (salon-level), fallback to practitioner availabilities
      query(
        `SELECT weekday, MIN(start_time) AS opens, MAX(end_time) AS closes
         FROM business_schedule WHERE business_id = $1 AND is_active = true GROUP BY weekday ORDER BY weekday`,
        [bid]
      ).then(async r => {
        if (r.rows.length > 0) return r;
        return query(
          `SELECT DISTINCT weekday, MIN(start_time) AS opens, MAX(end_time) AS closes
           FROM availabilities WHERE business_id = $1 AND is_active = true GROUP BY weekday ORDER BY weekday`,
          [bid]
        );
      })
    ]);

    // Fetch service variants (use queryWithRLS to satisfy RLS policies)
    const varByService = {};
    try {
      const variantsResult = await queryWithRLS(bid,
        `SELECT id, service_id, name, description, duration_min, price_cents, sort_order,
                processing_time, processing_start
         FROM service_variants
         WHERE business_id = $1 AND is_active = true
         ORDER BY sort_order, name`,
        [bid]
      );
      for (const v of variantsResult.rows) {
        if (!varByService[v.service_id]) varByService[v.service_id] = [];
        varByService[v.service_id].push(v);
      }
    } catch (e) {
      console.warn('service_variants query failed:', e.message);
    }

    const specializations = specResult.rows;
    const testimonials = testResult.rows.map(t => ({
      ...t,
      author_initials: t.author_initials || ((t.author_name || '').trim() ? (t.author_name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() : '??')
    }));
    const values = valResult.rows;
    const gallery = galResult.rows;
    const news = newsResult.rows;

    // ===== NEXT AVAILABLE SLOT (depends on svcResult) =====
    let nextSlot = null;
    if (svcResult.rows.length > 0) {
      try {
        const brusselsToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const tomorrow = new Date(brusselsToday + 'T12:00:00Z');
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        const weekOut = new Date(tomorrow.getTime() + 7 * 86400000);
        const slots = await getAvailableSlots({
          businessId: bid,
          serviceId: svcResult.rows[0].id,
          dateFrom: tomorrow.toLocaleDateString('en-CA', { timeZone: 'UTC' }),
          dateTo: weekOut.toLocaleDateString('en-CA', { timeZone: 'UTC' })
        });
        if (slots.length > 0) nextSlot = slots[0].start_at;
      } catch (e) { /* non-critical */ }
    }

    const hours = {};
    for (const row of hoursResult.rows) {
      hours[row.weekday] = { opens: row.opens, closes: row.closes };
    }

    // Sector categories catalog
    const sectorCatsResult = await query(
      `SELECT label, icon_svg, sort_order FROM sector_categories
       WHERE sector = $1 AND is_active = true ORDER BY sort_order`,
      [biz.sector || 'autre']
    );

    // ===== RESPONSE =====
    res.json({
      business: {
        slug: biz.slug,
        name: biz.name,
        tagline: biz.tagline,
        description: biz.description,
        phone: biz.phone,
        email: biz.email,
        address: biz.address,
        language_default: biz.language_default,
        languages_spoken: biz.languages_spoken || ['fr'],
        founded_year: biz.founded_year,
        accreditation: biz.accreditation,
        bce_number: biz.bce_number,
        parking_info: biz.parking_info,
        logo_url: biz.logo_url,
        cover_image_url: biz.cover_image_url,
        social_links: biz.social_links || {},
        theme: biz.theme || {},
        seo_title: biz.seo_title,
        seo_description: biz.seo_description,
        page_sections: sections,
        cancellation_window_hours: biz.settings?.cancel_deadline_hours ?? biz.settings?.cancellation_window_hours ?? 24,
        cancel_policy_text: biz.settings?.cancel_policy_text || null,
        multi_service_enabled: !!biz.settings?.multi_service_enabled,
        practitioner_choice_enabled: !!biz.settings?.practitioner_choice_enabled,
        booking_confirmation_required: !!biz.settings?.booking_confirmation_required,
        last_minute_enabled: !!biz.settings?.last_minute_enabled,
        last_minute_discount_pct: biz.settings?.last_minute_discount_pct || 0,
        custom_domain: domainResult.rows.length > 0 ? domainResult.rows[0].domain : null,
        google_reviews_url: biz.google_reviews_url,
        category_labels: getCategoryLabels(biz.category),
        practitioner_label: SECTOR_PRACTITIONER[biz.sector] || 'Praticien·ne',
        sector: biz.sector || 'autre',
        booking_auth_mode: biz.settings?.booking_auth_mode || 'soft',
        deposit_enabled: !!biz.settings?.deposit_enabled,
        payment_methods: biz.settings?.payment_methods || []
      },
      practitioners: pracResult.rows.map(p => ({
        id: p.id,
        display_name: p.display_name,
        title: p.title,
        bio: p.bio,
        photo_url: p.photo_url,
        color: p.color,
        years_experience: p.years_experience,
        linkedin_url: p.linkedin_url,
        service_ids: (p.service_ids || []).filter(Boolean),
        specializations: (p.specialization_names || []).filter(Boolean),
        waitlist_mode: p.waitlist_mode || 'off'
      })),
      services: svcResult.rows.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        duration_min: s.duration_min,
        price_cents: s.price_cents,
        price_label: s.price_label || (s.price_cents ? `${(s.price_cents / 100).toFixed(2).replace('.', ',')} €` : 'Gratuit'),
        mode_options: s.mode_options,
        prep_instructions_fr: s.prep_instructions_fr,
        prep_instructions_nl: s.prep_instructions_nl,
        color: s.color,
        description: s.description || null,
        bookable_online: s.bookable_online !== false,
        available_schedule: s.available_schedule || null,
        variants: (varByService[s.id] || []).map(v => ({
          id: v.id, name: v.name, description: v.description || null, duration_min: v.duration_min,
          price_cents: v.price_cents,
          price_label: v.price_cents != null ? `${(v.price_cents / 100).toFixed(2).replace('.', ',')} €` : null
        }))
      })),
      specializations,
      testimonials,
      values,
      gallery,
      news,
      hours,
      sector_categories: sectorCatsResult.rows,
      next_available: nextSlot,
      practitioner_count: pracResult.rows.length
    });
  } catch (err) {
    next(err);
  }
});

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
      `SELECT id, settings FROM businesses WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
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
    if (bizSettings.last_minute_enabled && slots.length > 0) {
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

    res.json({ slots, by_date: byDate, total: slots.length });
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

    const ids = service_ids.split(',').map(s => s.trim()).filter(Boolean);
    const vids = variant_ids ? variant_ids.split(',').map(s => s.trim() || null) : [];
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
      `SELECT id, settings FROM businesses WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
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

    const slots = await getAvailableSlotsMulti({
      businessId, serviceIds: ids,
      practitionerId: practitioner_id || null,
      dateFrom: from, dateTo: to, appointmentMode: appointment_mode,
      variantIds: vids.length > 0 ? vids : null
    });

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

    res.json({ by_date: byDate, total: slots.length, total_duration_min: totalDurationMin });
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
// Lookup known client phone by email (for form auto-fill)
// ============================================================
router.get('/:slug/client-phone', slotsLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({});

    const biz = await query(`SELECT id FROM businesses WHERE slug = $1`, [slug]);
    if (biz.rows.length === 0) return res.json({});

    const cl = await query(
      `SELECT phone, full_name
       FROM clients WHERE business_id = $1 AND LOWER(email) = $2 AND phone IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [biz.rows[0].id, email]
    );
    if (cl.rows.length === 0 || !cl.rows[0].phone) return res.json({});

    res.json({ phone: cl.rows[0].phone, name: cl.rows[0].full_name });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/:slug/bookings
// (unchanged from v1 — same booking creation logic)
// ============================================================
router.post('/:slug/bookings', bookingLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const {
      service_id, service_ids, practitioner_id, start_at, end_at, appointment_mode,
      variant_id, variant_ids,
      client_name, client_phone, client_email, client_bce,
      client_comment, client_language, consent_sms, consent_email, consent_marketing,
      flexible, is_last_minute,
      oauth_provider, oauth_provider_id
    } = req.body;

    if (!practitioner_id || !start_at || !client_name || !client_phone || !client_email) {
      return res.status(400).json({
        error: 'Champs requis : practitioner_id, start_at, client_name, client_phone, client_email'
      });
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
    if (service_id && !UUID_RE.test(service_id)) {
      return res.status(400).json({ error: 'service_id invalide' });
    }

    // Multi-service: normalize service_ids
    // - service_ids with > 1 element → multi-service flow
    // - service_ids with exactly 1 element → treat as single service_id
    // - service_id (singular) only → existing behavior
    let isMultiService = false;
    let effectiveServiceId = service_id; // used for single-service path
    if (Array.isArray(service_ids) && service_ids.length > 1) {
      if (service_ids.length > 5) {
        return res.status(400).json({ error: 'Maximum 5 prestations par réservation groupée' });
      }
      if (service_ids.some(id => !UUID_RE.test(id))) {
        return res.status(400).json({ error: 'service_ids invalide(s)' });
      }
      isMultiService = true;
    } else if (Array.isArray(service_ids) && service_ids.length === 1) {
      // Treat single-element array as regular single service
      if (!UUID_RE.test(service_ids[0])) {
        return res.status(400).json({ error: 'service_ids invalide(s)' });
      }
      effectiveServiceId = service_ids[0];
    }

    // Bug B1 fix: length limits on client fields
    if (client_name && client_name.length > 200) return res.status(400).json({ error: 'Nom trop long (max 200)' });
    if (client_email && client_email.length > 320) return res.status(400).json({ error: 'Email trop long' });
    if (client_phone && client_phone.length > 30) return res.status(400).json({ error: 'Téléphone trop long' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(client_email)) return res.status(400).json({ error: 'Format email invalide' });
    if (client_phone && !/^\+?[\d\s\-().]{6,}$/.test(client_phone)) return res.status(400).json({ error: 'Format téléphone invalide' });

    const VALID_MODES = ['cabinet', 'visio', 'phone', 'domicile'];
    if (appointment_mode && !VALID_MODES.includes(appointment_mode)) {
      return res.status(400).json({ error: 'Mode de rendez-vous invalide' });
    }

    if (client_comment && client_comment.length > 500) {
      return res.status(400).json({ error: 'Commentaire trop long (max 500)' });
    }

    if (client_bce && (typeof client_bce !== 'string' || client_bce.length > 30)) {
      return res.status(400).json({ error: 'Numéro BCE invalide (max 30 caractères)' });
    }

    const VALID_LANGS = ['fr', 'nl', 'en', 'de', 'unknown'];
    const safeLang = VALID_LANGS.includes(client_language) ? client_language : 'unknown';

    const bizResult = await query(
      `SELECT id, settings FROM businesses WHERE slug = $1 AND is_active = true`, [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
    const bizSettings = bizResult.rows[0].settings || {};
    const { transactionWithRLS } = require('../../services/db');

    // Multi-service: check if enabled
    if (isMultiService && !bizSettings.multi_service_enabled) {
      return res.status(400).json({ error: 'La réservation multi-prestations n\'est pas activée pour ce cabinet' });
    }

    const startDate = new Date(start_at);
    if (isNaN(startDate.getTime())) return res.status(400).json({ error: 'Date de début invalide' });
    // PUB-V12-012: This comparison is correct — Date objects normalize to UTC internally, so timezone is not a concern here
    if (startDate < new Date()) return res.status(400).json({ error: 'Impossible de réserver dans le passé' });

    // ── Locked-week guard: reject non-featured bookings when week is locked ──
    const startDateBrussels = startDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const lockCheck = await query(
      `SELECT 1 FROM locked_weeks
       WHERE business_id = $1 AND practitioner_id = $2
       AND week_start = date_trunc('week', $3::date)::date`,
      [businessId, practitioner_id, startDateBrussels]
    );
    if (lockCheck.rows.length > 0) {
      // Week is locked — booking must match a featured slot
      const startTimeStr = startDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false }); // HH:MM
      const fsCheck = await query(
        `SELECT 1 FROM featured_slots
         WHERE business_id = $1 AND practitioner_id = $2
         AND date = $3::date AND to_char(start_time, 'HH24:MI') = $4`,
        [businessId, practitioner_id, startDateBrussels, startTimeStr]
      );
      if (fsCheck.rows.length === 0) {
        return res.status(403).json({
          error: 'Cette semaine est verrouillée. Seuls les créneaux vedette sont disponibles.'
        });
      }
    }

    // ══════════════════════════════════════════════════════════
    // MULTI-SERVICE BOOKING FLOW
    // ══════════════════════════════════════════════════════════
    if (isMultiService) {
      // Fetch all services, preserving order
      const multiSvcResult = await query(
        `SELECT id, name, category, duration_min, buffer_before_min, buffer_after_min, mode_options, price_cents, processing_time, processing_start, flexibility_enabled
         FROM services WHERE id = ANY($1) AND business_id = $2 AND is_active = true
         ORDER BY array_position($1, id)`,
        [service_ids, businessId]
      );
      if (multiSvcResult.rows.length !== service_ids.length) {
        const foundIds = new Set(multiSvcResult.rows.map(r => r.id));
        const missing = service_ids.filter(id => !foundIds.has(id));
        return res.status(404).json({ error: `Prestation(s) introuvable(s): ${missing.join(', ')}` });
      }
      let multiServices = multiSvcResult.rows;

      // Resolve variant overrides for duration/price (multi-service)
      const resolvedVariantIds = [];
      if (Array.isArray(variant_ids) && variant_ids.length > 0) {
        for (let i = 0; i < multiServices.length; i++) {
          const vid = variant_ids[i];
          if (vid && UUID_RE.test(vid)) {
            const vr = await queryWithRLS(businessId,
              `SELECT name, duration_min, price_cents, processing_time, processing_start FROM service_variants
               WHERE id = $1 AND service_id = $2 AND business_id = $3 AND is_active = true`,
              [vid, multiServices[i].id, businessId]
            );
            if (vr.rows.length === 0) return res.status(404).json({ error: `Variante introuvable: ${vid}` });
            multiServices[i]._variant_name = vr.rows[0].name;
            multiServices[i].duration_min = vr.rows[0].duration_min;
            if (vr.rows[0].price_cents != null) multiServices[i].price_cents = vr.rows[0].price_cents;
            multiServices[i]._processing_time = vr.rows[0].processing_time || 0;
            multiServices[i]._processing_start = vr.rows[0].processing_start || 0;
            resolvedVariantIds.push(vid);
          } else {
            resolvedVariantIds.push(null);
          }
        }
      }

      // Preserve frontend order (matches slot engine which uses array_position)

      // Mode validation
      if (appointment_mode) {
        for (const svc of multiServices) {
          if (!(svc.mode_options || []).includes(appointment_mode)) {
            return res.status(400).json({ error: `Mode "${appointment_mode}" non disponible pour la prestation ${svc.id}` });
          }
        }
      }

      // Validate practitioner offers ALL services
      const psMultiCheck = await query(
        `SELECT COUNT(DISTINCT service_id)::int AS cnt
         FROM practitioner_services WHERE service_id = ANY($1) AND practitioner_id = $2`,
        [service_ids, practitioner_id]
      );
      if (!psMultiCheck.rows[0] || psMultiCheck.rows[0].cnt !== service_ids.length) {
        return res.status(400).json({ error: 'Ce praticien ne propose pas toutes les prestations sélectionnées' });
      }

      // Validate practitioner is active + booking_enabled + capacity
      const multiPracCap = await query(
        `SELECT COALESCE(max_concurrent, 1) AS max_concurrent, is_active, booking_enabled
         FROM practitioners WHERE id = $1 AND business_id = $2`,
        [practitioner_id, businessId]
      );
      if (multiPracCap.rows.length === 0 || !multiPracCap.rows[0].is_active || !multiPracCap.rows[0].booking_enabled) {
        return res.status(400).json({ error: 'Ce praticien n\'est pas disponible pour la prise de rendez-vous' });
      }
      const multiMaxConcurrent = multiPracCap.rows[0]?.max_concurrent ?? 1;

      // Calculate chained slots (buffer_before first only, buffer_after last only)
      const groupId = require('crypto').randomUUID();
      let cursor = new Date(startDate);
      const chainedSlots = multiServices.map((svc, i) => {
        const bufBefore = (i === 0) ? (svc.buffer_before_min || 0) : 0;
        const bufAfter = (i === multiServices.length - 1) ? (svc.buffer_after_min || 0) : 0;
        const totalDur = bufBefore + svc.duration_min + bufAfter;
        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + totalDur * 60000);
        cursor = slotEnd;
        return {
          service_id: svc.id,
          service_variant_id: resolvedVariantIds[i] || null,
          start_at: slotStart.toISOString(),
          end_at: slotEnd.toISOString(),
          group_order: i,
          processing_time: svc._processing_time || svc.processing_time || 0,
          processing_start: svc._processing_start || svc.processing_start || 0
        };
      });

      const totalEnd = new Date(chainedSlots[chainedSlots.length - 1].end_at);

      // Validate booking fits within practitioner's availability window
      const availCheck = await checkPracAvailability(businessId, practitioner_id, startDate, totalEnd);
      if (!availCheck.ok) {
        return res.status(400).json({ error: availCheck.reason });
      }

      const multiResult = await transactionWithRLS(businessId, async (client) => {
        // Booking confirmation setting
        const _bizConf = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
        const _bizSettings = _bizConf.rows[0]?.settings || {};
        const needsConfirmation = !!_bizSettings.booking_confirmation_required;
        const bookingStatus = needsConfirmation ? 'pending' : 'confirmed';
        const confirmTimeoutMin = parseInt(_bizSettings.booking_confirmation_timeout_min) || 30;
        const confirmChannel = _bizSettings.booking_confirmation_channel || 'email';

        // Conflict check for entire chained range (pose-aware)
        const conflicts = await checkBookingConflicts(client, { bid: businessId, pracId: practitioner_id, newStart: startDate.toISOString(), newEnd: totalEnd.toISOString() });
        if (conflicts.length >= multiMaxConcurrent) {
          throw Object.assign(new Error('Ce créneau vient d\'être pris.'), { type: 'conflict' });
        }

        // Find or create client (4-step matching: OAuth > exact > phone > email)
        let clientId;
        let existingClient = null;
        let matchType = null;

        // Priority 1: OAuth provider match (most reliable identity)
        if (oauth_provider && oauth_provider_id) {
          const oauthMatch = await client.query(
            `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND oauth_provider = $2 AND oauth_provider_id = $3 LIMIT 1`,
            [businessId, oauth_provider, oauth_provider_id]
          );
          if (oauthMatch.rows.length > 0) {
            existingClient = oauthMatch.rows[0];
            matchType = 'oauth';
          }
        }

        // Priority 2-4: phone+email > phone > email
        if (!existingClient) {
          const exactMatch = await client.query(
            `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 AND email = $3 LIMIT 1`,
            [businessId, client_phone, client_email]
          );
          if (exactMatch.rows.length > 0) {
            existingClient = exactMatch.rows[0];
            matchType = 'exact';
          } else {
            const phoneMatch = await client.query(
              `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
              [businessId, client_phone]
            );
            if (phoneMatch.rows.length > 0) {
              existingClient = phoneMatch.rows[0];
              matchType = 'phone';
            } else {
              const emailMatch = await client.query(
                `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND email = $2 LIMIT 1`,
                [businessId, client_email]
              );
              if (emailMatch.rows.length > 0) {
                existingClient = emailMatch.rows[0];
                matchType = 'email';
              }
            }
          }
        }

        if (existingClient) {
          if (existingClient.is_blocked) {
            throw Object.assign(
              new Error('Votre compte est temporairement suspendu. Veuillez contacter le cabinet directement.'),
              { type: 'blocked', status: 403 }
            );
          }
          clientId = existingClient.id;
          if (matchType === 'oauth' || matchType === 'exact') {
            await client.query(
              `UPDATE clients SET
                full_name = COALESCE(NULLIF($1, ''), full_name),
                email = COALESCE(NULLIF($2, ''), email),
                phone = COALESCE(NULLIF($3, ''), phone),
                bce_number = COALESCE($4, bce_number),
                consent_sms = COALESCE($5, consent_sms),
                consent_email = COALESCE($6, consent_email),
                consent_marketing = COALESCE($7, consent_marketing),
                oauth_provider = COALESCE($9, oauth_provider),
                oauth_provider_id = COALESCE($10, oauth_provider_id),
                updated_at = NOW()
               WHERE id = $8`,
              [client_name, client_email, client_phone, client_bce,
               consent_sms === true ? true : (consent_sms === false ? false : null),
               consent_email === true ? true : (consent_email === false ? false : null),
               consent_marketing === true ? true : (consent_marketing === false ? false : null),
               clientId,
               oauth_provider || null, oauth_provider_id || null]
            );
          } else if (matchType === 'phone' || matchType === 'email') {
            // Soft merge: update name, phone, email + link OAuth
            await client.query(
              `UPDATE clients SET
                full_name = COALESCE(NULLIF($2, ''), full_name),
                phone = COALESCE(NULLIF($4, ''), phone),
                email = COALESCE(NULLIF($5, ''), email),
                oauth_provider = COALESCE($6, oauth_provider),
                oauth_provider_id = COALESCE($7, oauth_provider_id),
                updated_at = NOW()
               WHERE id = $1 AND business_id = $3`,
              [clientId, client_name, businessId, client_phone || null, client_email || null, oauth_provider || null, oauth_provider_id || null]
            );
          }
        } else {
          const nc = await client.query(
            `INSERT INTO clients (business_id, full_name, phone, email, bce_number,
              language_preference, consent_sms, consent_email, consent_marketing, created_from,
              oauth_provider, oauth_provider_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booking',$10,$11) RETURNING id`,
            [businessId, client_name, client_phone, client_email, client_bce||null,
             safeLang, consent_sms===true, consent_email===true, consent_marketing===true,
             oauth_provider || null, oauth_provider_id || null]
          );
          clientId = nc.rows[0].id;
        }

        // Determine locked status based on flexibility
        const anyFlexEnabled = multiServices.some(s => s.flexibility_enabled);
        const multiLocked = anyFlexEnabled ? (flexible !== true) : false;

        // Insert each booking with group_id and group_order
        const bookings = [];
        for (const slot of chainedSlots) {
          const bk = await client.query(
            `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
              channel, appointment_mode, start_at, end_at, status, comment_client,
              group_id, group_order, confirmation_expires_at, processing_time, processing_start, locked)
             VALUES ($1,$2,$3,$4,$5,'web',$6,$7,$8,$9,$10,$11,$12,
              ${needsConfirmation ? "NOW() + INTERVAL '" + confirmTimeoutMin + " minutes'" : 'NULL'},
              $13,$14,$15)
             RETURNING id, public_token, start_at, end_at, status, group_id, group_order`,
            [businessId, practitioner_id, slot.service_id, slot.service_variant_id, clientId,
             appointment_mode||'cabinet', slot.start_at, slot.end_at, bookingStatus,
             client_comment||null, groupId, slot.group_order,
             slot.processing_time || 0, slot.processing_start || 0, bookingStatus === 'confirmed' ? true : multiLocked]
          );
          bookings.push(bk.rows[0]);
        }

        // Deposit check (multi-service) — triggers: price/duration thresholds OR no-show recidivist
        if (bookings.length > 0) {
          try {
            await client.query('SAVEPOINT deposit_sp');

            // Get business settings
            const bizSettingsRow = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
            const bizSettings = bizSettingsRow.rows[0]?.settings || {};

            // Get total price from DB (accurate, includes variants)
            const svcPriceResult = await client.query(
              `SELECT COALESCE(SUM(COALESCE(sv.price_cents, s.price_cents)), 0) AS total_price,
                      COALESCE(SUM(COALESCE(sv.duration_min, s.duration_min)), 0) AS total_duration
               FROM bookings b
               JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.id = ANY($1) AND b.business_id = $2`,
              [bookings.map(b => b.id), businessId]
            );
            const totalPrice = parseInt(svcPriceResult.rows[0]?.total_price) || 0;
            const totalDuration = parseInt(svcPriceResult.rows[0]?.total_duration) || 0;

            // Get no-show count + VIP status (0/false for new clients)
            let noShowCount = 0;
            let clientIsVip = false;
            if (clientId) {
              const nsRow = await client.query(`SELECT no_show_count, is_vip FROM clients WHERE id = $1`, [clientId]);
              noShowCount = nsRow.rows[0]?.no_show_count || 0;
              clientIsVip = !!nsRow.rows[0]?.is_vip;
            }

            const depResult = shouldRequireDeposit(bizSettings, totalPrice, totalDuration, noShowCount, clientIsVip);
            if (depResult.required) {
              const dlHours = bizSettings.deposit_deadline_hours ?? 48;
              let deadline = new Date(startDate.getTime() - dlHours * 3600000);
              // If deadline is in the past (RDV too soon), fallback to 30 min from now
              // This ensures clients booking last-minute still pay the deposit
              const MIN_DEPOSIT_WINDOW_MS = 30 * 60000; // 30 minutes minimum
              if (deadline <= new Date()) {
                deadline = new Date(Date.now() + MIN_DEPOSIT_WINDOW_MS);
              }
              // Only require deposit if RDV is at least 30 min away (enough time to pay)
              if (startDate.getTime() - Date.now() >= MIN_DEPOSIT_WINDOW_MS) {
                await client.query(
                  `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                    deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
                    deposit_requested_at = NOW(), deposit_request_count = 1,
                    confirmation_expires_at = NULL
                   WHERE id = $3 AND business_id = $4`,
                  [depResult.depCents, deadline.toISOString(), bookings[0].id, businessId]
                );
                bookings[0].status = 'pending_deposit';
                bookings[0].deposit_required = true;
                bookings[0].deposit_amount_cents = depResult.depCents;
                bookings[0].deposit_deadline = deadline.toISOString();
                if (bookings.length > 1) {
                  const otherIds = bookings.slice(1).map(b => b.id);
                  await client.query(
                    `UPDATE bookings SET status = 'pending_deposit'
                     WHERE id = ANY($1) AND business_id = $2`,
                    [otherIds, businessId]
                  );
                  for (let i = 1; i < bookings.length; i++) {
                    bookings[i].status = 'pending_deposit';
                  }
                }
                console.log(`[DEPOSIT] Multi-service deposit triggered (${depResult.reason}): ${depResult.depCents} cents, deadline: ${deadline.toISOString()}`);
              }
            }
          } catch (depErr) {
            await client.query('ROLLBACK TO SAVEPOINT deposit_sp');
            console.error('Deposit check failed:', depErr.message);
          }
        }

        // Queue notifications for first booking (skip email_confirmation if deposit active)
        if (bookings[0].status !== 'pending_deposit') {
          try {
            await client.query('SAVEPOINT notif_multi_sp1');
            await client.query(
              `INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status)
               VALUES ($1,$2,'email_confirmation',$3,$4,'queued')`,
              [businessId, bookings[0].id, client_email, client_phone]
            );
          } catch (notifErr) {
            await client.query('ROLLBACK TO SAVEPOINT notif_multi_sp1');
            console.error('Notification insert failed:', notifErr.message);
          }
        }
        try {
          await client.query('SAVEPOINT notif_multi_sp2');
          await client.query(
            `INSERT INTO notifications (business_id, booking_id, type, status)
             VALUES ($1,$2,'email_new_booking_pro','queued')`,
            [businessId, bookings[0].id]
          );
        } catch (notifErr) {
          await client.query('ROLLBACK TO SAVEPOINT notif_multi_sp2');
          console.error('Notification insert failed:', notifErr.message);
        }

        return { bookings, needsConfirmation, confirmTimeoutMin, confirmChannel };
      });

      const { bookings: multiBookings, needsConfirmation: multiNeedsConfirm, confirmTimeoutMin: multiConfTimeout, confirmChannel: multiConfChannel } = multiResult;

      broadcast(businessId, 'booking_update', { action: 'created', source: 'public' });

      // Send email (non-blocking): deposit request, confirmation request, OR direct confirmation
      (async () => {
        try {
          const bizRow = await query(`SELECT name, email, address, theme, settings FROM businesses WHERE id = $1`, [businessId]);
          const pracRow = await query(`SELECT display_name FROM practitioners WHERE id = $1`, [practitioner_id]);
          if (bizRow.rows[0]) {
            const lastBooking = multiBookings[multiBookings.length - 1];
            const emailBooking = {
              ...multiBookings[0],
              end_at: lastBooking.end_at,
              client_name, client_email,
              practitioner_name: pracRow.rows[0]?.display_name || '',
              comment: client_comment
            };
            const groupSvcs = multiServices.map(s => ({ name: s._variant_name ? s.name + ' \u2014 ' + s._variant_name : s.name, duration_min: s.duration_min, price_cents: s.price_cents }));

            if (multiBookings[0].status === 'pending_deposit') {
              // Deposit auto-triggered: send deposit request email (payment serves as confirmation)
              const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
              const depositUrl = `${baseUrl}/deposit/${multiBookings[0].public_token}`;
              await query(`UPDATE bookings SET deposit_payment_url = $1 WHERE id = $2`, [depositUrl, multiBookings[0].id]);
              const { sendDepositRequestEmail } = require('../../services/email');
              const payUrl = `${baseUrl}/api/public/deposit/${multiBookings[0].public_token}/pay`;
              await sendDepositRequestEmail({
                booking: emailBooking,
                business: bizRow.rows[0],
                depositUrl,
                payUrl,
                groupServices: groupSvcs
              });
              // Audit trail
              try {
                await query(
                  `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at)
                   VALUES ($1,$2,'email_deposit_request',$3,'sent',NOW())`,
                  [businessId, multiBookings[0].id, client_email]
                );
              } catch (_) { /* best-effort audit */ }
            } else if (multiNeedsConfirm) {
              // Send confirmation REQUEST (client must click to confirm)
              const { sendBookingConfirmationRequest } = require('../../services/email');
              if (multiConfChannel === 'email' || multiConfChannel === 'both') {
                await sendBookingConfirmationRequest({ booking: emailBooking, business: bizRow.rows[0], timeoutMin: multiConfTimeout, groupServices: groupSvcs });
              }
              if (multiConfChannel === 'sms' || multiConfChannel === 'both') {
                try {
                  const { sendSMS } = require('../../services/sms');
                  const baseUrl = process.env.PUBLIC_URL || process.env.BASE_URL || 'https://genda.be';
                  const link = `${baseUrl}/api/public/booking/${multiBookings[0].public_token}/confirm-booking`;
                  await sendSMS({ to: client_phone, body: `${bizRow.rows[0].name} : confirmez votre RDV en cliquant ici : ${link}`, businessId });
                } catch (smsErr) { console.warn('[SMS] Booking confirm SMS error:', smsErr.message); }
              }
            } else {
              await sendBookingConfirmation({ booking: emailBooking, business: bizRow.rows[0], groupServices: groupSvcs });
            }
          }
        } catch (e) { console.warn('[EMAIL] Multi-service confirmation error:', e.message); }
      })();

      return res.status(201).json({
        booking: {
          id: multiBookings[0].id, token: multiBookings[0].public_token,
          start_at: multiBookings[0].start_at, end_at: multiBookings[0].end_at, status: multiBookings[0].status,
          cancel_url: `${process.env.BOOKING_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/booking/${multiBookings[0].public_token}`
        },
        bookings: multiBookings.map(b => ({
          id: b.id, token: b.public_token,
          start_at: b.start_at, end_at: b.end_at, status: b.status,
          group_order: b.group_order
        })),
        group_id: groupId,
        needs_confirmation: multiNeedsConfirm && multiBookings[0].status !== 'pending_deposit'
      });
    }

    // ══════════════════════════════════════════════════════════
    // SINGLE-SERVICE BOOKING FLOW (existing behavior unchanged)
    // ══════════════════════════════════════════════════════════
    let endDate;

    // Resolve single-service variant
    let resolvedVariantId = null;
    if (variant_id && UUID_RE.test(variant_id)) {
      resolvedVariantId = variant_id;
    }

    let resolvedProcessingTime = 0;
    let resolvedProcessingStart = 0;
    let resolvedFlexEnabled = false;

    if (effectiveServiceId) {
      const svcResult = await query(
        `SELECT duration_min, buffer_before_min, buffer_after_min, processing_time, processing_start, flexibility_enabled
         FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [effectiveServiceId, businessId]
      );
      if (svcResult.rows.length === 0) return res.status(404).json({ error: 'Prestation introuvable' });
      const service = svcResult.rows[0];

      // Override duration from variant if provided
      resolvedProcessingTime = service.processing_time || 0;
      resolvedProcessingStart = service.processing_start || 0;
      resolvedFlexEnabled = !!service.flexibility_enabled;
      if (resolvedVariantId) {
        const vr = await queryWithRLS(businessId,
          `SELECT duration_min, processing_time, processing_start FROM service_variants
           WHERE id = $1 AND service_id = $2 AND business_id = $3 AND is_active = true`,
          [resolvedVariantId, effectiveServiceId, businessId]
        );
        if (vr.rows.length === 0) return res.status(404).json({ error: 'Variante introuvable' });
        service.duration_min = vr.rows[0].duration_min;
        resolvedProcessingTime = vr.rows[0].processing_time || 0;
        resolvedProcessingStart = vr.rows[0].processing_start || 0;
      }

      // PUB-V12-005: Buffer times are intentionally included in end_at for calendar blocking purposes
      const totalDuration = (service.buffer_before_min || 0) + service.duration_min + (service.buffer_after_min || 0);
      endDate = new Date(startDate.getTime() + totalDuration * 60000);
    } else {
      // Featured slot booking — use end_at or default 15 min
      endDate = end_at ? new Date(end_at) : new Date(startDate.getTime() + 15 * 60000);
      if (isNaN(endDate.getTime())) return res.status(400).json({ error: 'Date de fin invalide' });
      if (endDate.getTime() <= startDate.getTime()) return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
      // Bug M10 fix: cap arbitrary-duration bookings at 4 hours
      const maxDuration = 4 * 60 * 60000; // 4 hours
      if (endDate.getTime() - startDate.getTime() > maxDuration) {
        return res.status(400).json({ error: 'Durée maximale dépassée (4h)' });
      }
    }

    // Validate practitioner is active + booking_enabled + capacity
    const pracCap = await query(
      `SELECT COALESCE(max_concurrent, 1) AS max_concurrent, is_active, booking_enabled
       FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, businessId]
    );
    if (pracCap.rows.length === 0 || !pracCap.rows[0].is_active || !pracCap.rows[0].booking_enabled) {
      return res.status(400).json({ error: 'Ce praticien n\'est pas disponible pour la prise de rendez-vous' });
    }
    const maxConcurrent = pracCap.rows[0]?.max_concurrent ?? 1;

    // Validate practitioner offers this service
    if (effectiveServiceId) {
      const psCheck = await query(
        `SELECT 1 FROM practitioner_services WHERE service_id = $1 AND practitioner_id = $2`,
        [effectiveServiceId, practitioner_id]
      );
      if (psCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Ce praticien ne propose pas cette prestation' });
      }
    }

    // Validate booking fits within practitioner's availability window
    const availCheck = await checkPracAvailability(businessId, practitioner_id, startDate, endDate);
    if (!availCheck.ok) {
      return res.status(400).json({ error: availCheck.reason });
    }

    const result = await transactionWithRLS(businessId, async (client) => {
      // Booking confirmation setting
      const _bizConf = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
      const _bizSettings = _bizConf.rows[0]?.settings || {};
      const needsConfirmation = !!_bizSettings.booking_confirmation_required;
      const bookingStatus = needsConfirmation ? 'pending' : 'confirmed';
      const confirmTimeoutMin = parseInt(_bizSettings.booking_confirmation_timeout_min) || 30;
      const confirmChannel = _bizSettings.booking_confirmation_channel || 'email';

      // Conflict check (capacity-aware, pose-aware)
      const conflicts = await checkBookingConflicts(client, { bid: businessId, pracId: practitioner_id, newStart: startDate.toISOString(), newEnd: endDate.toISOString() });
      if (conflicts.length >= maxConcurrent) {
        throw Object.assign(new Error('Ce créneau vient d\'être pris.'), { type: 'conflict' });
      }

      // Find or create client (4-step matching: OAuth > exact > phone > email)
      let clientId;
      let existingClient = null;
      let matchType = null;

      // Priority 1: OAuth provider match (most reliable identity)
      if (oauth_provider && oauth_provider_id) {
        const oauthMatch = await client.query(
          `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND oauth_provider = $2 AND oauth_provider_id = $3 LIMIT 1`,
          [businessId, oauth_provider, oauth_provider_id]
        );
        if (oauthMatch.rows.length > 0) {
          existingClient = oauthMatch.rows[0];
          matchType = 'oauth';
        }
      }

      if (!existingClient) {
        const exactMatch = await client.query(
          `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 AND email = $3 LIMIT 1`,
          [businessId, client_phone, client_email]
        );
        if (exactMatch.rows.length > 0) {
          existingClient = exactMatch.rows[0];
          matchType = 'exact';
        } else {
          const phoneMatch = await client.query(
            `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
            [businessId, client_phone]
          );
          if (phoneMatch.rows.length > 0) {
            existingClient = phoneMatch.rows[0];
            matchType = 'phone';
          } else {
            const emailMatch = await client.query(
              `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND email = $2 LIMIT 1`,
              [businessId, client_email]
            );
            if (emailMatch.rows.length > 0) {
              existingClient = emailMatch.rows[0];
              matchType = 'email';
            }
          }
        }
      }

      if (existingClient) {
        if (existingClient.is_blocked) {
          throw Object.assign(
            new Error('Votre compte est temporairement suspendu. Veuillez contacter le cabinet directement.'),
            { type: 'blocked', status: 403 }
          );
        }
        clientId = existingClient.id;
        if (matchType === 'oauth' || matchType === 'exact') {
          await client.query(
            `UPDATE clients SET
              full_name = COALESCE(NULLIF($1, ''), full_name),
              email = COALESCE(NULLIF($2, ''), email),
              phone = COALESCE(NULLIF($3, ''), phone),
              bce_number = COALESCE($4, bce_number),
              consent_sms = COALESCE($5, consent_sms),
              consent_email = COALESCE($6, consent_email),
              consent_marketing = COALESCE($7, consent_marketing),
              oauth_provider = COALESCE($9, oauth_provider),
              oauth_provider_id = COALESCE($10, oauth_provider_id),
              updated_at = NOW()
             WHERE id = $8`,
            [client_name, client_email, client_phone, client_bce,
             consent_sms === true ? true : (consent_sms === false ? false : null),
             consent_email === true ? true : (consent_email === false ? false : null),
             consent_marketing === true ? true : (consent_marketing === false ? false : null),
             clientId,
             oauth_provider || null, oauth_provider_id || null]
          );
        } else if (matchType === 'phone' || matchType === 'email') {
          await client.query(
            `UPDATE clients SET
              full_name = COALESCE(NULLIF($2, ''), full_name),
              oauth_provider = COALESCE($4, oauth_provider),
              oauth_provider_id = COALESCE($5, oauth_provider_id),
              updated_at = NOW()
             WHERE id = $1 AND business_id = $3`,
            [clientId, client_name, businessId, oauth_provider || null, oauth_provider_id || null]
          );
        }
      } else {
        const nc = await client.query(
          `INSERT INTO clients (business_id, full_name, phone, email, bce_number,
            language_preference, consent_sms, consent_email, consent_marketing, created_from,
            oauth_provider, oauth_provider_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booking',$10,$11) RETURNING id`,
          [businessId, client_name, client_phone, client_email, client_bce||null,
           safeLang, consent_sms===true, consent_email===true, consent_marketing===true,
           oauth_provider || null, oauth_provider_id || null]
        );
        clientId = nc.rows[0].id;
      }

      // Determine locked status based on service flexibility setting
      const singleLocked = resolvedFlexEnabled ? (flexible !== true) : false;

      // Resolve last-minute discount (validate server-side to prevent abuse)
      let resolvedDiscountPct = null;
      if (is_last_minute && bizSettings.last_minute_enabled) {
        const lmDeadline = bizSettings.last_minute_deadline || 'j-1';
        const startBrussels = startDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const todayBrussels = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        if (isWithinLastMinuteWindow(startBrussels, todayBrussels, lmDeadline)) {
          const lmMinPrice = bizSettings.last_minute_min_price_cents || 0;
          // Resolve effective price (variant or service)
          let effPrice = 0;
          const _sp = await client.query(`SELECT price_cents, promo_eligible FROM services WHERE id = $1`, [effectiveServiceId]);
          if (_sp.rows[0]?.promo_eligible === false) { /* Service not eligible */ }
          else {
          effPrice = _sp.rows[0]?.price_cents || 0;
          if (resolvedVariantId) {
            const _vp = await client.query(`SELECT price_cents FROM service_variants WHERE id = $1`, [resolvedVariantId]);
            if (_vp.rows[0]?.price_cents != null) effPrice = _vp.rows[0].price_cents;
          }
          if (effPrice > 0 && effPrice >= lmMinPrice) {
            resolvedDiscountPct = bizSettings.last_minute_discount_pct || 10;
          }
          } // end promo_eligible check
        }
      }

      // Create booking
      const booking = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
          channel, appointment_mode, start_at, end_at, status, comment_client, confirmation_expires_at,
          processing_time, processing_start, locked, discount_pct)
         VALUES ($1,$2,$3,$4,$5,'web',$6,$7,$8,$9,$10,
          ${needsConfirmation ? "NOW() + INTERVAL '" + confirmTimeoutMin + " minutes'" : 'NULL'},
          $11,$12,$13,$14)
         RETURNING id, public_token, start_at, end_at, status, discount_pct`,
        [businessId, practitioner_id, effectiveServiceId, resolvedVariantId, clientId,
         appointment_mode||'cabinet', startDate.toISOString(), endDate.toISOString(), bookingStatus, client_comment||null,
         resolvedProcessingTime, resolvedProcessingStart, bookingStatus === 'confirmed' ? true : singleLocked, resolvedDiscountPct]
      );

      // ── Deposit check (single-service) — triggers: price/duration thresholds OR no-show recidivist ──
      if (booking.rows[0]) {
        try {
          await client.query('SAVEPOINT deposit_single_sp');

          // Get business settings
          const bizSettingsRow = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
          const bizSettings = bizSettingsRow.rows[0]?.settings || {};

          // Get service price + duration (use variant if applicable)
          let svcPrice = 0, svcDuration = 0;
          const svcInfoResult = await client.query(
            `SELECT COALESCE(s.price_cents, 0) AS price, COALESCE(s.duration_min, 0) AS duration
             FROM bookings b JOIN services s ON s.id = b.service_id
             WHERE b.id = $1 AND b.business_id = $2`,
            [booking.rows[0].id, businessId]
          );
          svcPrice = parseInt(svcInfoResult.rows[0]?.price) || 0;
          svcDuration = parseInt(svcInfoResult.rows[0]?.duration) || 0;
          if (resolvedVariantId) {
            const varInfo = await client.query(`SELECT price_cents, duration_min FROM service_variants WHERE id = $1`, [resolvedVariantId]);
            if (varInfo.rows[0]?.price_cents != null) svcPrice = varInfo.rows[0].price_cents;
            if (varInfo.rows[0]?.duration_min != null) svcDuration = varInfo.rows[0].duration_min;
          }

          // Get no-show count + VIP status (0/false for new clients)
          let noShowCount = 0;
          let clientIsVip = false;
          if (clientId) {
            const nsRow = await client.query(`SELECT no_show_count, is_vip FROM clients WHERE id = $1`, [clientId]);
            noShowCount = nsRow.rows[0]?.no_show_count || 0;
            clientIsVip = !!nsRow.rows[0]?.is_vip;
          }

          const depResult = shouldRequireDeposit(bizSettings, svcPrice, svcDuration, noShowCount, clientIsVip);
          if (depResult.required) {
            const dlHours = bizSettings.deposit_deadline_hours ?? 48;
            let deadline = new Date(startDate.getTime() - dlHours * 3600000);
            // If deadline is in the past (RDV too soon), fallback to 30 min from now
            const MIN_DEPOSIT_WINDOW_MS = 30 * 60000;
            if (deadline <= new Date()) {
              deadline = new Date(Date.now() + MIN_DEPOSIT_WINDOW_MS);
            }
            // Only require deposit if RDV is at least 30 min away
            if (startDate.getTime() - Date.now() >= MIN_DEPOSIT_WINDOW_MS) {
              await client.query(
                `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                  deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
                  deposit_requested_at = NOW(), deposit_request_count = 1,
                  confirmation_expires_at = NULL
                 WHERE id = $3 AND business_id = $4`,
                [depResult.depCents, deadline.toISOString(), booking.rows[0].id, businessId]
              );
              booking.rows[0].status = 'pending_deposit';
              booking.rows[0].deposit_required = true;
              booking.rows[0].deposit_amount_cents = depResult.depCents;
              booking.rows[0].deposit_deadline = deadline.toISOString();
              console.log(`[DEPOSIT] Single-service deposit triggered (${depResult.reason}): ${depResult.depCents} cents, deadline: ${deadline.toISOString()}`);
            }
          }
        } catch (depErr) {
          await client.query('ROLLBACK TO SAVEPOINT deposit_single_sp');
          console.error('Single-service deposit check failed:', depErr.message);
        }
      }

      // Queue notifications (skip email_confirmation if deposit active)
      if (booking.rows[0].status !== 'pending_deposit') {
        try {
          await client.query('SAVEPOINT notif_sp1');
          await client.query(
            `INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status)
             VALUES ($1,$2,'email_confirmation',$3,$4,'queued')`,
            [businessId, booking.rows[0].id, client_email, client_phone]
          );
        } catch (notifErr) {
          await client.query('ROLLBACK TO SAVEPOINT notif_sp1');
          console.error('Notification insert failed:', notifErr.message);
        }
      }
      try {
        await client.query('SAVEPOINT notif_sp2');
        await client.query(
          `INSERT INTO notifications (business_id, booking_id, type, status)
           VALUES ($1,$2,'email_new_booking_pro','queued')`,
          [businessId, booking.rows[0].id]
        );
      } catch (notifErr) {
        await client.query('ROLLBACK TO SAVEPOINT notif_sp2');
        console.error('Notification insert failed:', notifErr.message);
      }

      return { booking: booking.rows[0], needsConfirmation, confirmTimeoutMin, confirmChannel };
    });

    const { booking: createdBooking, needsConfirmation: singleNeedsConfirm, confirmTimeoutMin: singleConfTimeout, confirmChannel: singleConfChannel } = result;

    broadcast(businessId, 'booking_update', { action: 'created', source: 'public' });

    // Send email (non-blocking): deposit request, confirmation request, OR direct confirmation
    (async () => {
      try {
        const bizRow = await query(`SELECT name, email, address, theme, settings FROM businesses WHERE id = $1`, [businessId]);
        const pracRow = await query(`SELECT display_name FROM practitioners WHERE id = $1`, [practitioner_id]);
        if (bizRow.rows[0]) {
          // Fetch service name (+ variant name) for email
          let svcName = 'Rendez-vous';
          if (effectiveServiceId) {
            const svcRow = await query(`SELECT name FROM services WHERE id = $1`, [effectiveServiceId]);
            if (svcRow.rows[0]) svcName = svcRow.rows[0].name;
            if (resolvedVariantId) {
              const vrRow = await query(`SELECT name FROM service_variants WHERE id = $1`, [resolvedVariantId]);
              if (vrRow.rows[0]?.name) svcName = svcName + ' \u2014 ' + vrRow.rows[0].name;
            }
          }
          const emailBooking = {
            ...createdBooking,
            client_name, client_email,
            service_name: svcName,
            practitioner_name: pracRow.rows[0]?.display_name || '',
            comment: client_comment
          };
          if (createdBooking.status === 'pending_deposit') {
            // Deposit auto-triggered: send deposit request email (payment serves as confirmation)
            const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
            const depositUrl = `${baseUrl}/deposit/${createdBooking.public_token}`;
            await query(`UPDATE bookings SET deposit_payment_url = $1 WHERE id = $2`, [depositUrl, createdBooking.id]);
            const { sendDepositRequestEmail } = require('../../services/email');
            const payUrl = `${baseUrl}/api/public/deposit/${createdBooking.public_token}/pay`;
            await sendDepositRequestEmail({ booking: emailBooking, business: bizRow.rows[0], depositUrl, payUrl });
            // Audit trail
            try {
              await query(
                `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at)
                 VALUES ($1,$2,'email_deposit_request',$3,'sent',NOW())`,
                [businessId, createdBooking.id, client_email]
              );
            } catch (_) { /* best-effort audit */ }
          } else if (singleNeedsConfirm) {
            const { sendBookingConfirmationRequest } = require('../../services/email');
            if (singleConfChannel === 'email' || singleConfChannel === 'both') {
              await sendBookingConfirmationRequest({ booking: emailBooking, business: bizRow.rows[0], timeoutMin: singleConfTimeout });
            }
            if (singleConfChannel === 'sms' || singleConfChannel === 'both') {
              try {
                const { sendSMS } = require('../../services/sms');
                const baseUrl = process.env.PUBLIC_URL || process.env.BASE_URL || 'https://genda.be';
                const link = `${baseUrl}/api/public/booking/${createdBooking.public_token}/confirm-booking`;
                await sendSMS({ to: client_phone, body: `${bizRow.rows[0].name} : confirmez votre RDV en cliquant ici : ${link}`, businessId });
              } catch (smsErr) { console.warn('[SMS] Booking confirm SMS error:', smsErr.message); }
            }
          } else {
            await sendBookingConfirmation({ booking: emailBooking, business: bizRow.rows[0] });
          }
        }
      } catch (e) { console.warn('[EMAIL] Single booking email error:', e.message); }
    })();

    res.status(201).json({
      booking: {
        id: createdBooking.id, token: createdBooking.public_token,
        start_at: createdBooking.start_at, end_at: createdBooking.end_at, status: createdBooking.status,
        discount_pct: createdBooking.discount_pct || null,
        cancel_url: `${process.env.BOOKING_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/booking/${createdBooking.public_token}`
      },
      needs_confirmation: singleNeedsConfirm && createdBooking.status !== 'pending_deposit'
    });
  } catch (err) {
    if (err.type === 'conflict') return res.status(409).json({ error: err.message });
    if (err.type === 'blocked') return res.status(403).json({ error: err.message, blocked: true });
    next(err);
  }
});

// Booking lookup, cancel, reschedule, ICS — unchanged from v1
// (import from separate file or keep inline)

// ============================================================
// GET /api/public/booking/:token
// Lookup booking by public token (for cancel/reschedule page)
// ============================================================
router.get('/booking/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
              b.comment_client, b.public_token, b.created_at, b.group_id,
              b.deposit_required, b.deposit_amount_cents, b.deposit_status, b.deposit_deadline, b.deposit_payment_url,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              COALESCE(sv.price_cents, s.price_cents) AS price_cents,
              s.color AS service_color,
              p.display_name AS practitioner_name, p.title AS practitioner_title,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
              biz.name AS business_name, biz.slug AS business_slug, biz.phone AS business_phone,
              biz.email AS business_email, biz.address AS business_address,
              biz.settings AS business_settings, biz.theme AS business_theme,
              biz.category AS business_category, biz.sector AS business_sector
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];

    // Fetch group members if this is a grouped booking
    let groupServices = null;
    let groupEndAt = null;
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                COALESCE(sv.price_cents, s.price_cents) AS price_cents, s.color, b.end_at
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         WHERE b.group_id = $1 AND b.business_id = (SELECT business_id FROM bookings WHERE public_token = $2)
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, token]
      );
      if (grp.rows.length > 1) {
        groupServices = grp.rows.map(r => ({ name: r.name, duration_min: r.duration_min, price_cents: r.price_cents, color: r.color }));
        groupEndAt = grp.rows[grp.rows.length - 1].end_at;
      }
    }

    const cancelWindowHours = bk.business_settings?.cancel_deadline_hours ?? bk.business_settings?.cancellation_window_hours ?? 24;
    const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
    const canCancel = (bk.status === 'confirmed' || bk.status === 'pending_deposit') && new Date() < deadline;

    // Build service info: use group members if available, otherwise single service
    const serviceInfo = groupServices
      ? { name: groupServices.map(s => s.name).join(' + '), duration_min: groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0), price_cents: groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0), color: bk.service_color, members: groupServices }
      : { name: bk.service_name, duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color };

    res.json({
      booking: {
        id: bk.id, token: bk.public_token,
        start_at: bk.start_at, end_at: groupEndAt || bk.end_at, status: bk.status,
        appointment_mode: bk.appointment_mode, comment: bk.comment_client,
        created_at: bk.created_at,
        deposit_required: bk.deposit_required, deposit_amount_cents: bk.deposit_amount_cents,
        deposit_status: bk.deposit_status, deposit_deadline: bk.deposit_deadline, deposit_payment_url: bk.deposit_payment_url,
        service: serviceInfo,
        practitioner: { name: bk.practitioner_name, title: bk.practitioner_title },
        client: { name: bk.client_name, phone: bk.client_phone, email: bk.client_email }
      },
      business: {
        name: bk.business_name, slug: bk.business_slug,
        phone: bk.business_phone, email: bk.business_email,
        address: bk.business_address, theme: bk.business_theme,
        category_labels: getCategoryLabels(bk.business_category),
        practitioner_label: SECTOR_PRACTITIONER[bk.business_sector] || 'Praticien·ne'
      },
      cancellation: {
        allowed: canCancel,
        deadline: deadline.toISOString(),
        window_hours: cancelWindowHours,
        policy_text: bk.business_settings?.cancel_policy_text || null,
        reason: !canCancel && (bk.status === 'confirmed' || bk.status === 'pending_deposit') ? 'Délai d\'annulation dépassé' : null
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/deposit/:token/checkout
// Create Stripe Checkout Session for deposit payment
// ============================================================
router.post('/deposit/:token/checkout', async (req, res, next) => {
  try {
    const { token } = req.params;

    // 1. Fetch booking + business
    const result = await query(
      `SELECT b.id, b.business_id, b.status, b.deposit_required, b.deposit_status,
              b.deposit_amount_cents, b.deposit_deadline, b.public_token,
              b.start_at, b.deposit_payment_intent_id,
              c.full_name AS client_name, c.email AS client_email,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              biz.name AS business_name, biz.stripe_customer_id
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });
    const bk = result.rows[0];

    // 2. Validate deposit is still pending
    if (!bk.deposit_required || bk.status !== 'pending_deposit') {
      return res.status(400).json({ error: 'Aucun acompte en attente pour ce rendez-vous' });
    }
    if (bk.deposit_status !== 'pending') {
      return res.status(400).json({ error: 'L\'acompte n\'est plus en attente' });
    }

    // 3. Check deadline
    if (bk.deposit_deadline && new Date(bk.deposit_deadline) < new Date()) {
      return res.status(400).json({ error: 'Le délai de paiement est dépassé' });
    }

    // 4. Check Stripe
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(503).json({ error: 'Paiement en ligne non disponible' });
    const stripe = require('stripe')(key);

    const amountCents = bk.deposit_amount_cents || 0;
    if (amountCents < 50) return res.status(400).json({ error: 'Montant trop faible' });

    // 5. Create Checkout Session
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const dateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', day: 'numeric', month: 'short'
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bancontact'],
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: {
            name: `Acompte — ${bk.service_name || 'Rendez-vous'}`,
            description: `${bk.business_name} · ${dateStr}`
          }
        },
        quantity: 1
      }],
      customer_email: bk.client_email || undefined,
      metadata: {
        type: 'deposit',
        booking_id: bk.id,
        business_id: bk.business_id,
        booking_token: token
      },
      success_url: `${baseUrl}/deposit/${token}?paid=1`,
      cancel_url: `${baseUrl}/deposit/${token}`,
      locale: 'fr',
      expires_at: Math.floor(Date.now() / 1000) + 1800 // 30 min from now
    });

    // 6. Store checkout session ID (payment_intent is null at creation for Checkout sessions)
    // We store session.id (cs_...) so the verify endpoint can check payment status with Stripe
    await query(
      `UPDATE bookings SET deposit_payment_intent_id = $1 WHERE id = $2`,
      [session.id, bk.id]
    );

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[DEPOSIT CHECKOUT] Error:', err);
    next(err);
  }
});

// ============================================================
// GET /api/public/deposit/:token/pay
// One-click payment redirect: creates Stripe Checkout Session and 302 redirects.
// Used in deposit request emails so clients go directly to Stripe.
// ============================================================
router.get('/deposit/:token/pay', async (req, res, next) => {
  try {
    const { token } = req.params;
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const depositPageUrl = `${baseUrl}/deposit/${token}`;

    const result = await query(
      `SELECT b.id, b.business_id, b.status, b.deposit_required, b.deposit_status,
              b.deposit_amount_cents, b.deposit_deadline, b.public_token,
              b.start_at, b.deposit_payment_intent_id,
              c.email AS client_email,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              biz.name AS business_name
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.redirect(depositPageUrl + '?error=not_found');
    const bk = result.rows[0];

    // Already paid or not pending → redirect to deposit page with status
    if (!bk.deposit_required || bk.status !== 'pending_deposit' || bk.deposit_status !== 'pending') {
      return res.redirect(depositPageUrl + (bk.deposit_status === 'paid' ? '?paid=1' : ''));
    }
    // Deadline passed
    if (bk.deposit_deadline && new Date(bk.deposit_deadline) < new Date()) {
      return res.redirect(depositPageUrl + '?error=expired');
    }

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.redirect(depositPageUrl + '?error=stripe');
    const stripe = require('stripe')(key);

    const amountCents = bk.deposit_amount_cents || 0;
    if (amountCents < 50) return res.redirect(depositPageUrl);

    const dateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', day: 'numeric', month: 'short'
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'bancontact'],
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: {
            name: `Acompte — ${bk.service_name || 'Rendez-vous'}`,
            description: `${bk.business_name} · ${dateStr}`
          }
        },
        quantity: 1
      }],
      customer_email: bk.client_email || undefined,
      metadata: {
        type: 'deposit',
        booking_id: bk.id,
        business_id: bk.business_id,
        booking_token: token
      },
      success_url: `${baseUrl}/deposit/${token}?paid=1`,
      cancel_url: depositPageUrl,
      locale: 'fr',
      expires_at: Math.floor(Date.now() / 1000) + 1800
    });

    await query(
      `UPDATE bookings SET deposit_payment_intent_id = $1 WHERE id = $2`,
      [session.id, bk.id]
    );

    res.redirect(session.url);
  } catch (err) {
    console.error('[DEPOSIT PAY REDIRECT] Error:', err);
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    res.redirect(`${baseUrl}/deposit/${req.params.token}?error=checkout`);
  }
});

// ============================================================
// POST /api/public/deposit/:token/verify
// Verify payment status directly with Stripe (fallback when webhook delayed/missing)
// ============================================================
router.post('/deposit/:token/verify', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT b.id, b.business_id, b.status, b.deposit_status, b.deposit_payment_intent_id,
              b.group_id
       FROM bookings b
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const bk = result.rows[0];

    // Already paid or not pending
    if (bk.deposit_status === 'paid') return res.json({ status: 'paid', updated: false });
    if (bk.status !== 'pending_deposit' || bk.deposit_status !== 'pending') {
      return res.json({ status: bk.deposit_status, updated: false });
    }

    // Need a stored checkout session ID (cs_...) to verify
    const csId = bk.deposit_payment_intent_id;
    if (!csId || !csId.startsWith('cs_')) {
      return res.json({ status: 'pending', updated: false, reason: 'no_session' });
    }

    // Check with Stripe
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.json({ status: 'pending', updated: false, reason: 'stripe_not_configured' });
    const stripe = require('stripe')(key);

    const session = await stripe.checkout.sessions.retrieve(csId);
    if (session.payment_status !== 'paid') {
      return res.json({ status: 'pending', updated: false, payment_status: session.payment_status });
    }

    // Payment confirmed by Stripe! Update booking
    const piId = session.payment_intent || null;
    console.log(`[DEPOSIT VERIFY] Payment confirmed for booking ${bk.id} (PI: ${piId}, CS: ${csId})`);

    const upd = await query(
      `UPDATE bookings SET
        status = 'confirmed',
        deposit_status = 'paid',
        deposit_paid_at = NOW(),
        deposit_payment_intent_id = COALESCE($1, deposit_payment_intent_id),
        deposit_deadline = NULL,
        locked = true
       WHERE id = $2 AND business_id = $3 AND status = 'pending_deposit'
       RETURNING id`,
      [piId, bk.id, bk.business_id]
    );

    if (upd.rows.length > 0) {
      // Propagate to group siblings
      if (bk.group_id) {
        await query(
          `UPDATE bookings SET status = 'confirmed', locked = true
           WHERE group_id = $1 AND business_id = $2 AND id != $3 AND status = 'pending_deposit'`,
          [bk.group_id, bk.business_id, bk.id]
        );
      }

      // SSE broadcast
      try {
        const { broadcast } = require('../../services/sse');
        broadcast(bk.business_id, 'booking_update', { action: 'deposit_paid', booking_id: bk.id });
      } catch (e) { /* SSE optional */ }
    }

    res.json({ status: 'paid', updated: true });
  } catch (err) {
    console.error('[DEPOSIT VERIFY] Error:', err.message);
    // Don't fail the page — just return pending
    res.json({ status: 'pending', updated: false, reason: 'verify_error' });
  }
});

// ============================================================
// GET /api/public/booking/:token/calendar.ics
// Generate ICS file for Apple Calendar, Outlook, etc.
// ============================================================
router.get('/booking/:token/calendar.ics', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.start_at, b.end_at, b.group_id, b.business_id,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.address AS business_address
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).send('Not found');
    const bk = result.rows[0];

    // For multi-service groups, get all services and use last end_at
    let summary = bk.service_name || 'Rendez-vous';
    let endAt = bk.end_at;
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, b.end_at
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order, b.start_at`,
        [bk.group_id, bk.business_id]
      );
      if (grp.rows.length > 1) {
        summary = grp.rows.map(r => r.name).join(' + ');
        endAt = grp.rows[grp.rows.length - 1].end_at;
      }
    }

    const fmtDt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const uid = `booking-${token}@genda.be`;
    const now = fmtDt(new Date());
    const title = `${summary} — ${bk.business_name}`;
    const desc = bk.practitioner_name ? `Avec ${bk.practitioner_name}` : '';
    const location = bk.business_address || '';

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Genda//Booking//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${fmtDt(bk.start_at)}`,
      `DTEND:${fmtDt(endAt || bk.start_at)}`,
      `SUMMARY:${title.replace(/[,;\\]/g, ' ')}`,
      desc ? `DESCRIPTION:${desc.replace(/[,;\\]/g, ' ')}` : '',
      location ? `LOCATION:${location.replace(/[,;\\]/g, ' ')}` : '',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      'DESCRIPTION:Rappel rendez-vous',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="rdv-${bk.business_name.replace(/[^a-zA-Z0-9]/g, '_')}.ics"`
    });
    res.send(ics);
  } catch (err) {
    console.error('[ICS] Error:', err.message);
    next(err);
  }
});

// ============================================================
// POST /api/public/booking/:token/cancel
// Client self-cancel
// ============================================================
router.post('/booking/:token/cancel', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { reason } = req.body;

    // Bug B2 fix: length limit on cancel reason
    if (reason && reason.length > 2000) return res.status(400).json({ error: 'Raison trop longue (max 2000)' });

    const result = await query(
      `SELECT b.id, b.status, b.start_at, b.created_at, b.business_id,
              b.deposit_required, b.deposit_status, b.group_id,
              biz.settings AS business_settings
       FROM bookings b
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];
    if (!['confirmed', 'pending_deposit'].includes(bk.status)) {
      return res.status(400).json({ error: 'Ce rendez-vous ne peut plus être annulé' });
    }

    // Skip cancellation deadline for pending_deposit — client hasn't paid yet,
    // they should always be able to cancel (otherwise deposit-expiry cron would cancel it anyway)
    if (bk.status !== 'pending_deposit') {
      const cancelWindowHours = bk.business_settings?.cancel_deadline_hours ?? bk.business_settings?.cancellation_window_hours ?? 24;
      const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
      if (new Date() >= deadline) {
        return res.status(400).json({ error: `Annulation possible jusqu'à ${cancelWindowHours}h avant le rendez-vous` });
      }
    }

    // Deposit refund logic — atomic CASE WHEN to avoid race condition
    // between SELECT and UPDATE (a payment webhook could change deposit_status in between)
    const graceMin = bk.business_settings?.cancel_grace_minutes ?? 240;

    const cancelResult = await query(
      `UPDATE bookings SET status = 'cancelled', cancel_reason = $1,
        deposit_status = CASE
          WHEN deposit_required = true AND deposit_status = 'paid' THEN
            CASE WHEN (start_at - INTERVAL '1 minute' * $3) > NOW()
                   OR (NOW() - created_at) <= INTERVAL '1 minute' * $4
                 THEN 'refunded' ELSE 'cancelled' END
          WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
          ELSE deposit_status
        END,
        updated_at = NOW()
       WHERE id = $2 AND status IN ('confirmed', 'pending_deposit')
       RETURNING *`,
      [reason || 'Annulé par le client', bk.id, cancelWindowHours * 60, graceMin]
    );

    if (cancelResult.rowCount === 0) {
      return res.status(409).json({ error: 'Ce rendez-vous a déjà été modifié ou annulé' });
    }

    // Propagate cancellation to group siblings (multi-service bookings)
    if (bk.group_id) {
      try {
        await query(
          `UPDATE bookings SET status = 'cancelled', cancel_reason = $1,
            deposit_status = CASE
              WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
              ELSE deposit_status
            END,
            updated_at = NOW()
           WHERE group_id = $2 AND business_id = $3 AND id != $4
             AND status IN ('confirmed', 'pending_deposit', 'pending', 'modified_pending')`,
          [reason || 'Annulé par le client', bk.group_id, bk.business_id, bk.id]
        );
      } catch (e) { console.warn('[CANCEL] Group sibling propagation error:', e.message); }
    }

    // Log client cancellation in audit_logs (shows in staff modal "Historique" tab)
    try {
      await query(
        `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, 'booking', $2, 'client_cancel', $3, $4)`,
        [bk.business_id, bk.id,
         JSON.stringify({ status: bk.status }),
         JSON.stringify({ status: 'cancelled', cancel_reason: reason || null })]
      );
    } catch (e) { /* non-critical */ }

    // Queue cancellation notification
    // NOTE: notification types may need a DB migration to add to the CHECK constraint
    try {
      await query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'email_cancellation_pro', 'queued')`,
        [bk.business_id, bk.id]
      );
    } catch (notifErr) {
      console.error('Notification insert failed (CHECK constraint?):', notifErr.message);
    }

    // Send cancellation confirmation email to client (non-blocking)
    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug
           FROM bookings b
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`, [bk.id]
        );
        if (fullBk.rows[0]?.client_email) {
          const row = fullBk.rows[0];
          let groupServices = null;
          if (row.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [row.group_id, row.business_id]
            );
            if (grp.rows.length > 1) groupServices = grp.rows;
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const { sendCancellationEmail } = require('../../services/email');
          await sendCancellationEmail({
            booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents },
            business: { name: row.biz_name, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, slug: row.biz_slug, settings: bk.business_settings },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Cancellation email error:', e.message); }
    })();

    // Trigger waitlist processing
    let waitlistResult = null;
    try {
      waitlistResult = await processWaitlistForCancellation(bk.id, bk.business_id);
    } catch (e) { /* non-blocking */ }

    // Process waitlist + calSync for group siblings
    if (bk.group_id) {
      try {
        const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
        for (const sib of sibs.rows) {
          try { const { calSyncDelete } = require('../staff/bookings-helpers'); calSyncDelete(bk.business_id, sib.id); } catch (e) { /* non-blocking */ }
          try { await processWaitlistForCancellation(sib.id, bk.business_id); } catch (e) { /* non-blocking */ }
        }
      } catch (e) { /* non-blocking */ }
    }

    broadcast(bk.business_id, 'booking_update', { action: 'cancelled', source: 'public' });
    res.json({ cancelled: true, waitlist: waitlistResult });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/booking/:token/confirm
// Client confirms a modified booking (modified_pending → confirmed)
// UI: /booking/:token page → "Ça me convient" button
// ============================================================
router.post('/booking/:token/confirm', async (req, res, next) => {
  try {
    const { token } = req.params;
    const isForm = req.is('application/x-www-form-urlencoded');

    // For HTML responses, we need display data
    let displayData = null;
    if (isForm) {
      const info = await query(
        `SELECT b.status, b.start_at,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                biz.name AS business_name, biz.theme
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN businesses biz ON biz.id = b.business_id
         WHERE b.public_token = $1`, [token]
      );
      if (info.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
      displayData = info.rows[0];
      const color = displayData.theme?.primary_color || '#0D7377';
      const dt = new Date(displayData.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const tm = new Date(displayData.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      displayData._color = color;
      displayData._dt = dt;
      displayData._tm = tm;

      if (displayData.status === 'confirmed') {
        return res.send(confirmationPage('Déjà confirmé ✅', `Votre rendez-vous du <strong>${dt} à ${tm}</strong> est confirmé.`, color, displayData.business_name));
      }
      if (displayData.status !== 'modified_pending') {
        return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', displayData.business_name));
      }
    }

    const result = await query(
      `UPDATE bookings SET status = 'confirmed', locked = true, updated_at = NOW()
       WHERE public_token = $1 AND status = 'modified_pending'
       RETURNING id, status, start_at, end_at, business_id`,
      [token]
    );

    if (result.rows.length === 0) {
      const check = await query(
        `SELECT status FROM bookings WHERE public_token = $1`, [token]
      );
      if (check.rows.length === 0) {
        if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
        return res.status(404).json({ error: 'Rendez-vous introuvable' });
      }
      if (check.rows[0].status === 'confirmed') {
        if (isForm) return res.send(confirmationPage('Déjà confirmé ✅', `Votre rendez-vous est confirmé.`, displayData?._color || '#0D7377', displayData?.business_name));
        return res.json({ confirmed: true, already: true });
      }
      if (isForm) return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', displayData?.business_name));
      return res.status(400).json({ error: 'Ce rendez-vous ne peut pas être confirmé dans son état actuel' });
    }

    // Queue notification to practitioner
    // NOTE: notification types may need a DB migration to add to the CHECK constraint
    try {
      await query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'email_modification_confirmed', 'queued')`,
        [result.rows[0].business_id, result.rows[0].id]
      );
    } catch (notifErr) {
      console.error('Notification insert failed (CHECK constraint?):', notifErr.message);
    }

    broadcast(result.rows[0].business_id, 'booking_update', { action: 'confirmed', source: 'public' });

    if (isForm && displayData) {
      return res.send(confirmationPage('Rendez-vous confirmé ✅', `${escHtml(displayData.service_name) || 'Votre rendez-vous'} le <strong>${escHtml(displayData._dt)} à ${escHtml(displayData._tm)}</strong> est confirmé. Merci !`, displayData._color, displayData.business_name));
    }
    const { business_id: _bid, ...publicBooking } = result.rows[0];
    res.json({ confirmed: true, booking: publicBooking });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/booking/:token/reject
// Client rejects a modified booking (modified_pending → cancelled)
// UI: email button → "Non" → landing page
// ============================================================
router.post('/booking/:token/reject', async (req, res, next) => {
  try {
    const { token } = req.params;
    const isForm = req.is('application/x-www-form-urlencoded');

    // For HTML responses, we need display data
    let displayData = null;
    if (isForm) {
      const info = await query(
        `SELECT b.status, b.start_at, biz.name AS business_name, biz.theme, biz.phone AS business_phone
         FROM bookings b JOIN businesses biz ON biz.id = b.business_id
         WHERE b.public_token = $1`, [token]
      );
      if (info.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
      displayData = info.rows[0];
      const color = displayData.theme?.primary_color || '#0D7377';
      displayData._color = color;

      if (displayData.status === 'cancelled') {
        return res.send(confirmationPage('Déjà annulé', 'Ce rendez-vous a été annulé.', '#C62828', displayData.business_name));
      }
      if (displayData.status !== 'modified_pending') {
        return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être modifié.', '#A68B3C', displayData.business_name));
      }
    }

    // Deadline check: prevent rejection bypass of cancellation deadline
    const bkCheck = await query(
      `SELECT b.id, b.status, b.start_at, biz.settings AS business_settings
       FROM bookings b JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (bkCheck.rows.length === 0) {
      if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
      return res.status(404).json({ error: 'Rendez-vous introuvable' });
    }
    const bkData = bkCheck.rows[0];
    const cancelWindowHours = bkData.business_settings?.cancel_deadline_hours ?? 24;
    const deadline = new Date(new Date(bkData.start_at).getTime() - cancelWindowHours * 3600000);
    if (new Date() >= deadline) {
      if (isForm) return res.status(400).send(confirmationPage('Délai dépassé', 'Le délai de modification est dépassé.', '#C62828', displayData?.business_name));
      return res.status(400).json({ error: 'Délai de modification dépassé' });
    }

    const result = await query(
      `UPDATE bookings SET status = 'cancelled', cancel_reason = 'client_rejected_modification', updated_at = NOW()
       WHERE public_token = $1 AND status = 'modified_pending'
       RETURNING id, status, start_at, end_at, business_id`,
      [token]
    );

    if (result.rows.length === 0) {
      const check = await query(
        `SELECT status FROM bookings WHERE public_token = $1`, [token]
      );
      if (check.rows.length === 0) {
        if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));
        return res.status(404).json({ error: 'Rendez-vous introuvable' });
      }
      if (check.rows[0].status === 'cancelled') {
        if (isForm) return res.send(confirmationPage('Déjà annulé', 'Ce rendez-vous a été annulé.', '#C62828', displayData?.business_name));
        return res.json({ rejected: true, already: true });
      }
      if (isForm) return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être modifié.', '#A68B3C', displayData?.business_name));
      return res.status(400).json({ error: 'Ce rendez-vous ne peut pas être refusé dans son état actuel' });
    }

    // Notify practitioner
    // NOTE: notification types may need a DB migration to add to the CHECK constraint
    try {
      await query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1, $2, 'email_modification_rejected', 'queued')`,
        [result.rows[0].business_id, result.rows[0].id]
      );
    } catch (notifErr) {
      console.error('Notification insert failed (CHECK constraint?):', notifErr.message);
    }

    broadcast(result.rows[0].business_id, 'booking_update', { action: 'rejected', source: 'public' });

    // Send cancellation confirmation email to client (non-blocking)
    (async () => {
      try {
        const bkId = result.rows[0].id;
        const bizId = result.rows[0].business_id;
        const fullBk = await query(
          `SELECT b.start_at, b.end_at, b.group_id, b.business_id,
                  c.full_name AS client_name, c.email AS client_email,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  p.display_name AS practitioner_name,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`, [bkId]
        );
        if (fullBk.rows[0]?.client_email) {
          const row = fullBk.rows[0];
          let groupServices = null;
          if (row.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [row.group_id, row.business_id]
            );
            if (grp.rows.length > 1) groupServices = grp.rows;
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const { sendCancellationEmail } = require('../../services/email');
          await sendCancellationEmail({
            booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents },
            business: { name: row.biz_name, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, slug: row.biz_slug },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Rejection cancellation email error:', e.message); }
    })();

    if (isForm && displayData) {
      const phone = displayData.business_phone ? ` au <strong>${escHtml(displayData.business_phone)}</strong>` : '';
      return res.send(confirmationPage('Rendez-vous refusé', `Le nouveau créneau ne vous convient pas. N'hésitez pas à nous contacter${phone} pour trouver un autre horaire.`, '#C62828', displayData.business_name));
    }
    const { business_id: _bid2, ...publicBookingReject } = result.rows[0];
    res.json({ rejected: true, booking: publicBookingReject });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/confirm — landing page (READ-ONLY)
// Shows confirmation button, POST does the mutation
// ============================================================
router.get('/booking/:token/confirm', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.status, b.start_at, b.end_at,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              biz.name AS business_name, biz.theme
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (result.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));

    const bk = result.rows[0];
    const color = bk.theme?.primary_color || '#0D7377';
    const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
    const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

    if (bk.status === 'confirmed') {
      return res.send(confirmationPage('Déjà confirmé ✅', `Votre rendez-vous du <strong>${dt} à ${tm}</strong> est confirmé.`, color, bk.business_name));
    }
    if (bk.status !== 'modified_pending') {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', bk.business_name));
    }

    // Show confirmation landing page with a form button (no mutation on GET)
    res.send(actionPage('Confirmer le rendez-vous', `<strong>${escHtml(bk.service_name || 'Votre rendez-vous')}</strong> le <strong>${dt} à ${tm}</strong>`, color, bk.business_name, token, 'confirm', 'Confirmer ✅'));
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/reject — landing page (READ-ONLY)
// Shows reject button, POST does the mutation
// ============================================================
router.get('/booking/:token/reject', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.status, b.start_at, biz.name AS business_name, biz.theme, biz.phone AS business_phone
       FROM bookings b
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (result.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));

    const bk = result.rows[0];
    const color = bk.theme?.primary_color || '#0D7377';

    if (bk.status === 'cancelled') {
      return res.send(confirmationPage('Déjà annulé', 'Ce rendez-vous a été annulé.', '#C62828', bk.business_name));
    }
    if (bk.status !== 'modified_pending') {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être modifié.', '#A68B3C', bk.business_name));
    }

    // Show reject landing page with a form button (no mutation on GET)
    res.send(actionPage('Refuser le nouveau créneau ?', 'Si ce créneau ne vous convient pas, vous pouvez le refuser et contacter le cabinet pour un autre horaire.', '#C62828', bk.business_name, token, 'reject', 'Refuser le créneau'));
  } catch (err) { next(err); }
});

// Helper: build a standalone HTML confirmation/rejection page
function confirmationPage(title, message, color, businessName) {
  const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0D7377';
  const safeTitle = escHtml(title);
  const safeBiz = escHtml(businessName);
  // Determine type: success / error / warning / info
  const rawTitle = (title || '').toLowerCase();
  const isSuccess = rawTitle.includes('confirm') && !rawTitle.includes('impossible');
  const isError = rawTitle.includes('annul') || rawTitle.includes('refus') || rawTitle.includes('introuvable') || rawTitle.includes('expir');
  const isWarning = rawTitle.includes('impossible') || rawTitle.includes('dépassé') || rawTitle.includes('déjà');
  const iconSvg = isSuccess
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
    : isError
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    : isWarning
    ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  // Clean title — remove emojis
  const cleanTitle = (title || '').replace(/[\u2705\u274C\u2753\u2139\uFE0F]/g, '').trim();
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(cleanTitle)} — ${safeBiz || 'Genda'}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{background:#FAFAF9;font-family:'Plus Jakarta Sans',-apple-system,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#FFF;border-radius:16px;padding:48px 36px 40px;max-width:420px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 32px rgba(0,0,0,.06)}
.icon-wrap{width:64px;height:64px;border-radius:50%;background:${safeColor}12;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
h1{font-family:'Instrument Serif',Georgia,serif;font-size:1.5rem;font-weight:400;color:#1A1816;margin:0 0 12px;line-height:1.3}
.msg{font-size:.88rem;color:#6B6560;line-height:1.7;margin:0}
.msg strong{color:#3D3832;font-weight:600}
.divider{width:40px;height:1px;background:#E0DDD8;margin:24px auto}
.biz{font-size:.72rem;color:#9C958E;letter-spacing:.3px}
@media(max-width:480px){.card{padding:40px 24px 32px;border-radius:12px}h1{font-size:1.35rem}}
</style></head><body>
<div class="card">
  <div class="icon-wrap">${iconSvg}</div>
  <h1>${escHtml(cleanTitle)}</h1>
  <p class="msg">${message}</p>
  ${businessName ? `<div class="divider"></div><p class="biz">${safeBiz}</p>` : ''}
</div></body></html>`;
}

// Helper: build a standalone HTML action page (form with POST button)
function actionPage(title, message, color, businessName, token, action, btnLabel) {
  const escHtml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0D7377';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)} — ${escHtml(businessName) || 'Genda'}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{background:#FAFAF9;font-family:'Plus Jakarta Sans',-apple-system,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#FFF;border-radius:16px;padding:48px 36px 40px;max-width:420px;width:100%;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04),0 8px 32px rgba(0,0,0,.06)}
.icon-wrap{width:64px;height:64px;border-radius:50%;background:${safeColor}12;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
h1{font-family:'Instrument Serif',Georgia,serif;font-size:1.5rem;font-weight:400;color:#1A1816;margin:0 0 12px;line-height:1.3}
.msg{font-size:.88rem;color:#6B6560;line-height:1.7;margin:0 0 28px}
.msg strong{color:#3D3832;font-weight:600}
.action-btn{display:inline-block;background:${safeColor};color:#fff;border:none;border-radius:10px;padding:14px 36px;font-size:.92rem;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:.2px;transition:opacity .15s}
.action-btn:hover{opacity:.9}
.divider{width:40px;height:1px;background:#E0DDD8;margin:24px auto}
.biz{font-size:.72rem;color:#9C958E;letter-spacing:.3px}
@media(max-width:480px){.card{padding:40px 24px 32px;border-radius:12px}h1{font-size:1.35rem}}
</style></head><body>
<div class="card">
  <div class="icon-wrap">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${safeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  </div>
  <h1>${escHtml(title)}</h1>
  <p class="msg">${message}</p>
  <form method="POST" action="/api/public/booking/${escHtml(token)}/${escHtml(action)}">
    <button type="submit" class="action-btn">${escHtml(btnLabel)}</button>
  </form>
  ${businessName ? `<div class="divider"></div><p class="biz">${escHtml(businessName)}</p>` : ''}
</div></body></html>`;
}

// ============================================================
// BOOKING CONFIRMATION (pending → confirmed) — for booking_confirmation_required setting
// ============================================================

// GET /api/public/booking/:token/confirm-booking — one-click confirm from email
router.get('/booking/:token/confirm-booking', async (req, res, next) => {
  try {
    const { token } = req.params;

    // Attempt direct confirmation (pending → confirmed)
    const result = await query(
      `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
       WHERE public_token = $1 AND status = 'pending'
         AND (confirmation_expires_at IS NULL OR confirmation_expires_at > NOW())
       RETURNING id, status, business_id, public_token, start_at, end_at, client_id, service_id, practitioner_id`,
      [token]
    );

    if (result.rows.length > 0) {
      const bk = result.rows[0];

      // Also confirm group siblings
      await query(
        `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
         WHERE group_id = (SELECT group_id FROM bookings WHERE id = $1 AND group_id IS NOT NULL)
           AND id != $1 AND status = 'pending'`,
        [bk.id]
      );

      broadcast(bk.business_id, 'booking_update', { action: 'confirmed', source: 'public' });

      // Send confirmation email (non-blocking) — reuse same logic as POST
      (async () => {
        try {
          const fullBk = await query(
            `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                    p.display_name AS practitioner_name, c.full_name AS client_name, c.email AS client_email
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             JOIN practitioners p ON p.id = b.practitioner_id
             LEFT JOIN clients c ON c.id = b.client_id
             WHERE b.id = $1`, [bk.id]
          );
          const bizRow = await query(`SELECT name, email, address, theme, settings FROM businesses WHERE id = $1`, [bk.business_id]);
          if (fullBk.rows[0] && bizRow.rows[0]) {
            // Query group services for multi-service bookings
            let groupServices = null;
            if (fullBk.rows[0].group_id) {
              const grp = await query(
                `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
                        COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                        COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at
                 FROM bookings b LEFT JOIN services s ON s.id = b.service_id
                 LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                 WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
                [fullBk.rows[0].group_id, bk.business_id]
              );
              if (grp.rows.length > 1) groupServices = grp.rows;
            }
            const { sendBookingConfirmation } = require('../../services/email');
            await sendBookingConfirmation({ booking: fullBk.rows[0], business: bizRow.rows[0], groupServices });
          }
        } catch (e) { console.warn('[EMAIL] Post-confirmation email error:', e.message); }
      })();

      // Queue notification audit
      try {
        const clientRow = await query(`SELECT email FROM clients WHERE id = $1`, [bk.client_id]);
        await query(
          `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status)
           VALUES ($1, $2, 'email_confirmation', $3, 'queued')`,
          [bk.business_id, bk.id, clientRow.rows[0]?.email]
        );
      } catch (_) { /* best-effort audit */ }

      const info = await query(
        `SELECT b.start_at, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                biz.name AS business_name, biz.theme
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN businesses biz ON biz.id = b.business_id WHERE b.id = $1`, [bk.id]
      );
      const i = info.rows[0] || {};
      const color = i.theme?.primary_color || '#0D7377';
      const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      return res.send(confirmationPage('Rendez-vous confirm\u00e9 \u2705', `Votre rendez-vous <strong>${escHtml(i.service_name || '')}</strong> du <strong>${dt} \u00e0 ${tm}</strong> est confirm\u00e9.`, color, i.business_name));
    }

    // Confirmation failed — check why
    const check = await query(
      `SELECT b.status, b.start_at, b.confirmation_expires_at,
              biz.name AS business_name, biz.theme
       FROM bookings b JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (check.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\u2019est plus valide.', '#C62828'));

    const bk2 = check.rows[0];
    const color2 = bk2.theme?.primary_color || '#0D7377';

    if (bk2.status === 'confirmed' || bk2.status === 'completed') {
      const dt2 = new Date(bk2.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const tm2 = new Date(bk2.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      return res.send(confirmationPage('D\u00e9j\u00e0 confirm\u00e9 \u2705', `Votre rendez-vous du <strong>${dt2} \u00e0 ${tm2}</strong> est confirm\u00e9.`, color2, bk2.business_name));
    }
    if (bk2.status === 'cancelled') {
      return res.send(confirmationPage('Rendez-vous annul\u00e9', 'Ce rendez-vous a \u00e9t\u00e9 annul\u00e9 car le d\u00e9lai de confirmation a expir\u00e9.', '#C62828', bk2.business_name));
    }
    return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus \u00eatre confirm\u00e9.', '#A68B3C', bk2.business_name));
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/cancel-booking — one-click cancel from email
// Cancels pending/confirmed bookings directly (no intermediate page)
// ============================================================
router.get('/booking/:token/cancel-booking', async (req, res, next) => {
  try {
    const { token } = req.params;

    const result = await query(
      `SELECT b.id, b.status, b.start_at, b.created_at, b.business_id,
              b.deposit_required, b.deposit_status, b.group_id,
              biz.name AS business_name, biz.theme, biz.settings AS business_settings
       FROM bookings b JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\u2019est plus valide.', '#C62828'));
    }

    const bk = result.rows[0];

    // Already cancelled
    if (bk.status === 'cancelled') {
      return res.send(confirmationPage('D\u00e9j\u00e0 annul\u00e9', 'Ce rendez-vous a d\u00e9j\u00e0 \u00e9t\u00e9 annul\u00e9.', '#C62828', bk.business_name));
    }

    // Completed or other non-cancellable status
    if (!['pending', 'confirmed', 'pending_deposit'].includes(bk.status)) {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus \u00eatre annul\u00e9.', '#A68B3C', bk.business_name));
    }

    // For confirmed: check cancellation deadline
    // Skip deadline check for pending_deposit — client hasn't paid yet, always allow cancel
    const cancelWindowHours = bk.business_settings?.cancel_deadline_hours ?? bk.business_settings?.cancellation_window_hours ?? 24;
    if (bk.status === 'confirmed') {
      const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
      if (new Date() >= deadline) {
        return res.send(confirmationPage('Annulation impossible', `L\u2019annulation n\u2019est plus possible moins de ${cancelWindowHours}h avant le rendez-vous.`, '#C62828', bk.business_name));
      }
    }

    // Cancel the booking
    const graceMin = bk.business_settings?.cancel_grace_minutes ?? 240;
    const cancelResult = await query(
      `UPDATE bookings SET status = 'cancelled', cancel_reason = 'Annul\u00e9 par le client (email)',
        deposit_status = CASE
          WHEN deposit_required = true AND deposit_status = 'paid' THEN
            CASE WHEN (start_at - INTERVAL '1 minute' * $2) > NOW()
                   OR (NOW() - created_at) <= INTERVAL '1 minute' * $3
                 THEN 'refunded' ELSE 'cancelled' END
          WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled'
          ELSE deposit_status
        END,
        updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'confirmed', 'pending_deposit')
       RETURNING *`,
      [bk.id, cancelWindowHours * 60, graceMin]
    );

    if (cancelResult.rowCount === 0) {
      return res.send(confirmationPage('D\u00e9j\u00e0 modifi\u00e9', 'Ce rendez-vous a d\u00e9j\u00e0 \u00e9t\u00e9 modifi\u00e9 ou annul\u00e9.', '#A68B3C', bk.business_name));
    }

    // Cancel group siblings
    if (bk.group_id) {
      try {
        await query(
          `UPDATE bookings SET status = 'cancelled', cancel_reason = 'Annul\u00e9 par le client (email)',
            deposit_status = CASE WHEN deposit_required = true AND deposit_status = 'pending' THEN 'cancelled' ELSE deposit_status END,
            updated_at = NOW()
           WHERE group_id = $1 AND business_id = $2 AND id != $3
             AND status IN ('pending', 'confirmed', 'pending_deposit', 'modified_pending')`,
          [bk.group_id, bk.business_id, bk.id]
        );
      } catch (e) { console.warn('[CANCEL] Group sibling propagation error:', e.message); }
    }

    // Audit log
    try {
      await query(
        `INSERT INTO audit_logs (business_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, 'booking', $2, 'client_cancel', $3, $4)`,
        [bk.business_id, bk.id,
         JSON.stringify({ status: bk.status }),
         JSON.stringify({ status: 'cancelled', cancel_reason: 'Annul\u00e9 par le client (email)' })]
      );
    } catch (_) { /* non-critical */ }

    broadcast(bk.business_id, 'booking_update', { action: 'cancelled', source: 'public' });

    // Send cancellation email + waitlist (non-blocking)
    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.address AS biz_address,
                  biz.theme AS biz_theme, biz.slug AS biz_slug
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id WHERE b.id = $1`, [bk.id]
        );
        if (fullBk.rows[0]?.client_email) {
          const row = fullBk.rows[0];
          // Query group services for multi-service bookings
          let groupServices = null;
          if (row.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [row.group_id, bk.business_id]
            );
            if (grp.rows.length > 1) groupServices = grp.rows;
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          const { sendCancellationEmail } = require('../../services/email');
          await sendCancellationEmail({
            booking: { start_at: row.start_at, end_at: groupEndAt || row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents },
            business: { name: row.biz_name, email: row.biz_email, address: row.biz_address, theme: row.biz_theme, slug: row.biz_slug },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Cancel-booking email error:', e.message); }
      try { await processWaitlistForCancellation(bk.id, bk.business_id); } catch (_) {}
      if (bk.group_id) {
        try {
          const sibs = await query(`SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2 AND id != $3`, [bk.group_id, bk.business_id, bk.id]);
          for (const sib of sibs.rows) {
            try { const { calSyncDelete } = require('../staff/bookings-helpers'); calSyncDelete(bk.business_id, sib.id); } catch (_) {}
            try { await processWaitlistForCancellation(sib.id, bk.business_id); } catch (_) {}
          }
        } catch (_) {}
      }
    })();

    const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
    const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
    return res.send(confirmationPage('Rendez-vous annul\u00e9 \u274c', `Votre rendez-vous du <strong>${dt} \u00e0 ${tm}</strong> a \u00e9t\u00e9 annul\u00e9.`, '#C62828', bk.business_name));
  } catch (err) { next(err); }
});

// POST /api/public/booking/:token/confirm-booking — mutation (pending → confirmed)
router.post('/booking/:token/confirm-booking', async (req, res, next) => {
  try {
    const { token } = req.params;
    const isForm = req.is('application/x-www-form-urlencoded');

    // Fetch display data for HTML response
    let displayData = null;
    if (isForm) {
      const info = await query(
        `SELECT b.status, b.start_at, b.confirmation_expires_at,
                CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                biz.name AS business_name, biz.theme
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         JOIN businesses biz ON biz.id = b.business_id
         WHERE b.public_token = $1`, [token]
      );
      if (info.rows.length > 0) {
        const bk = info.rows[0];
        displayData = {
          service_name: bk.service_name,
          business_name: bk.business_name,
          _dt: new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' }),
          _tm: new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }),
          _color: bk.theme?.primary_color || '#0D7377'
        };
      }
    }

    // Confirm the booking (pending → confirmed, only if not expired)
    const result = await query(
      `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
       WHERE public_token = $1 AND status = 'pending'
         AND (confirmation_expires_at IS NULL OR confirmation_expires_at > NOW())
       RETURNING id, status, business_id, public_token, start_at, end_at, client_id, service_id, practitioner_id`,
      [token]
    );

    if (result.rows.length === 0) {
      // Check why it failed
      const check = await query(`SELECT status, confirmation_expires_at FROM bookings WHERE public_token = $1`, [token]);
      if (check.rows.length === 0) {
        if (isForm) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\u2019est plus valide.', '#C62828'));
        return res.status(404).json({ error: 'Rendez-vous introuvable' });
      }
      if (check.rows[0].status === 'confirmed') {
        if (isForm) return res.send(confirmationPage('D\u00e9j\u00e0 confirm\u00e9 \u2705', 'Votre rendez-vous est d\u00e9j\u00e0 confirm\u00e9.', displayData?._color || '#0D7377', displayData?.business_name));
        return res.json({ confirmed: true, already: true });
      }
      if (check.rows[0].status === 'cancelled') {
        if (isForm) return res.send(confirmationPage('D\u00e9lai expir\u00e9', 'Ce rendez-vous a \u00e9t\u00e9 annul\u00e9 car le d\u00e9lai de confirmation a expir\u00e9.', '#C62828', displayData?.business_name));
        return res.status(410).json({ error: 'Booking expired and cancelled' });
      }
      if (isForm) return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus \u00eatre confirm\u00e9.', '#A68B3C', displayData?.business_name));
      return res.status(400).json({ error: 'Booking not in pending status' });
    }

    const bk = result.rows[0];

    // Also confirm group siblings if any
    await query(
      `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
       WHERE group_id = (SELECT group_id FROM bookings WHERE id = $1 AND group_id IS NOT NULL)
         AND id != $1 AND status = 'pending'`,
      [bk.id]
    );

    // SSE notification
    broadcast(bk.business_id, 'booking_update', { action: 'confirmed', source: 'public' });

    // Send the actual confirmation email (non-blocking)
    (async () => {
      try {
        const fullBk = await query(
          `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                  p.display_name AS practitioner_name,
                  c.full_name AS client_name, c.email AS client_email,
                  biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address, biz.theme AS biz_theme, biz.settings AS biz_settings
           FROM bookings b
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           JOIN practitioners p ON p.id = b.practitioner_id
           LEFT JOIN clients c ON c.id = b.client_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1`, [bk.id]
        );
        if (fullBk.rows[0] && fullBk.rows[0].client_email) {
          const row = fullBk.rows[0];
          let groupServices = null;
          if (row.group_id) {
            const grp = await query(
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
              [row.group_id, row.business_id]
            );
            if (grp.rows.length > 1) groupServices = grp.rows;
          }
          const groupEndAt = groupServices ? groupServices[groupServices.length - 1].end_at : null;
          await sendBookingConfirmation({
            booking: {
              public_token: row.public_token, start_at: row.start_at, end_at: groupEndAt || row.end_at,
              client_name: row.client_name, client_email: row.client_email,
              service_name: row.service_name, practitioner_name: row.practitioner_name,
              comment: row.comment_client
            },
            business: { name: row.biz_name, email: row.biz_email, phone: row.biz_phone, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
            groupServices
          });
        }
      } catch (e) { console.warn('[EMAIL] Post-confirmation email error:', e.message); }
    })();

    if (isForm && displayData) {
      return res.send(confirmationPage(
        'Rendez-vous confirm\u00e9 \u2705',
        `${escHtml(displayData.service_name) || 'Votre rendez-vous'} le <strong>${escHtml(displayData._dt)} \u00e0 ${escHtml(displayData._tm)}</strong> est confirm\u00e9. Merci !`,
        displayData._color, displayData.business_name
      ));
    }
    const { business_id: _bid, ...publicBooking } = bk;
    res.json({ confirmed: true, booking: publicBooking });
  } catch (err) { next(err); }
});

// ============================================================
// PRE-RDV DOCUMENTS — PUBLIC ACCESS
// ============================================================

// GET /api/public/docs/:token — fetch document for client
router.get('/docs/:token', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ps.*, dt.name AS template_name, dt.type AS template_type,
              dt.content_html, dt.form_fields, dt.subject,
              bk.start_at, bk.service_id,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              p.display_name AS practitioner_name,
              c.full_name AS client_name,
              b.name AS business_name, b.slug AS business_slug,
              b.address AS business_address, b.theme,
              b.email AS business_email, b.phone AS business_phone
       FROM pre_rdv_sends ps
       JOIN document_templates dt ON dt.id = ps.template_id
       JOIN bookings bk ON bk.id = ps.booking_id
       LEFT JOIN services s ON s.id = bk.service_id
       LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
       LEFT JOIN practitioners p ON p.id = bk.practitioner_id
       JOIN clients c ON c.id = ps.client_id
       JOIN businesses b ON b.id = ps.business_id
       WHERE ps.token = $1`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document introuvable ou lien expiré' });
    }

    const row = result.rows[0];
    res.json({
      template: {
        name: row.template_name,
        type: row.template_type,
        content_html: row.content_html,
        form_fields: row.form_fields || [],
        subject: row.subject
      },
      booking: {
        start_at: row.start_at,
        service_name: row.service_name,
        practitioner_name: row.practitioner_name,
        client_name: row.client_name
      },
      business: {
        name: row.business_name,
        slug: row.business_slug,
        address: row.business_address,
        primary_color: row.theme?.primary_color,
        email: row.business_email,
        phone: row.business_phone
      },
      send: {
        status: row.status,
        responded_at: row.responded_at,
        sent_at: row.sent_at
      }
    });
  } catch (err) { next(err); }
});

// POST /api/public/docs/:token/view — mark as viewed
router.post('/docs/:token/view', async (req, res, next) => {
  try {
    await query(
      `UPDATE pre_rdv_sends SET status = 'viewed'
       WHERE token = $1 AND status = 'sent'`,
      [req.params.token]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/public/docs/:token/submit — submit form responses
router.post('/docs/:token/submit', async (req, res, next) => {
  try {
    const { response_data, consent_given } = req.body;

    const responseStr = JSON.stringify(response_data || {});
    if (responseStr.length > 50000) {
      return res.status(400).json({ error: 'Données de réponse trop volumineuses (max 50 Ko)' });
    }

    const safeConsent = consent_given === true || consent_given === 'true' ? true : false;

    const check = await query(
      `SELECT ps.id, ps.status, dt.type AS template_type
       FROM pre_rdv_sends ps
       JOIN document_templates dt ON dt.id = ps.template_id
       WHERE ps.token = $1`,
      [req.params.token]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Document introuvable' });
    }
    if (check.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Ce formulaire a déjà été complété' });
    }

    const updateResult = await query(
      `UPDATE pre_rdv_sends SET
        response_data = $1::jsonb,
        consent_given = $2,
        responded_at = NOW(),
        status = 'completed'
       WHERE token = $3 AND status IN ('sent', 'viewed')
       RETURNING id`,
      [JSON.stringify(response_data || {}), safeConsent, req.params.token]
    );

    if (updateResult.rows.length === 0) {
      return res.status(409).json({ error: 'Ce formulaire a déjà été complété ou n\'est plus disponible' });
    }

    res.json({ submitted: true });
  } catch (err) { next(err); }
});

// ============================================================
// WAITLIST — PUBLIC ENDPOINTS
// ============================================================

// POST /api/public/:slug/waitlist — client joins waitlist
router.post('/:slug/waitlist', bookingLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { practitioner_id, service_id, client_name, client_email,
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

    if (client_name.length > 200) return res.status(400).json({ error: 'Nom trop long (max 200)' });
    if (client_email.length > 320) return res.status(400).json({ error: 'Email trop long' });
    if (client_phone && client_phone.length > 30) return res.status(400).json({ error: 'Téléphone trop long' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(client_email)) return res.status(400).json({ error: 'Format email invalide' });
    if (client_phone && !/^\+?[\d\s\-().]{6,}$/.test(client_phone)) return res.status(400).json({ error: 'Format téléphone invalide' });

    if (preferred_days) {
      if (!Array.isArray(preferred_days) || preferred_days.length > 7 || !preferred_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
        return res.status(400).json({ error: 'preferred_days invalide' });
      }
    }

    if (note && note.length > 300) {
      return res.status(400).json({ error: 'Note trop longue (max 300)' });
    }

    const VALID_TIMES = ['any', 'morning', 'afternoon'];
    if (preferred_time && !VALID_TIMES.includes(preferred_time)) {
      return res.status(400).json({ error: 'preferred_time invalide' });
    }

    const bizResult = await query(
      `SELECT id FROM businesses WHERE slug = $1 AND is_active = true`, [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });
    const businessId = bizResult.rows[0].id;

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

    // Bug M9 fix: Atomic INSERT with duplicate check + priority calculation
    // Uses a subquery to avoid race conditions between check/priority/insert
    // Also includes business_id in the duplicate check for proper tenant isolation
    const result = await query(
      `INSERT INTO waitlist_entries
        (business_id, practitioner_id, service_id, client_name, client_email,
         client_phone, preferred_days, preferred_time, note, priority)
       SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
              COALESCE(MAX(we.priority), 0) + 1
       FROM waitlist_entries we
       WHERE we.practitioner_id = $2 AND we.service_id = $3 AND we.status = 'waiting'
       AND NOT EXISTS (
         SELECT 1 FROM waitlist_entries dup
         WHERE dup.practitioner_id = $2 AND dup.service_id = $3
           AND dup.client_email = $5 AND dup.status = 'waiting'
           AND dup.business_id = $1
       )
       RETURNING id, priority, created_at`,
      [businessId, practitioner_id, service_id, client_name, client_email,
       client_phone || null,
       JSON.stringify(preferred_days || [0,1,2,3,4]),
       preferred_time || 'any',
       note || null]
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
        s.name AS service_name, s.duration_min, s.price_cents, s.price_label,
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
      `SELECT w.id, w.business_id, w.practitioner_id, w.service_id,
              w.client_name, w.client_email, w.client_phone,
              w.offer_expires_at, w.offer_booking_start, w.offer_booking_end,
              s.duration_min, s.buffer_before_min, s.buffer_after_min
       FROM waitlist_entries w
       JOIN services s ON s.id = w.service_id
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
          `SELECT id FROM clients WHERE business_id = $1 AND phone = $2 AND email = $3 LIMIT 1`,
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
          `SELECT id FROM clients WHERE business_id = $1 AND email = $2 LIMIT 1`,
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
      const bk = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
          channel, start_at, end_at, status, locked)
         VALUES ($1, $2, $3, $4, 'web', $5, $6, 'confirmed', true)
         RETURNING id, public_token, start_at, end_at, status`,
        [e.business_id, e.practitioner_id, e.service_id, clientId,
         e.offer_booking_start, e.offer_booking_end]
      );

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

      // Queue confirmation notification
      // NOTE: notification types may need a DB migration to add to the CHECK constraint
      try {
        await client.query('SAVEPOINT notif_sp1');
        await client.query(
          `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status)
           VALUES ($1, $2, 'email_confirmation', $3, 'queued')`,
          [e.business_id, bk.rows[0].id, e.client_email]
        );
      } catch (notifErr) {
        await client.query('ROLLBACK TO SAVEPOINT notif_sp1');
        console.error('Notification insert failed:', notifErr.message);
      }

      return bk.rows[0];
    });
    } catch (err) {
      if (err.type === 'expired') return res.status(410).json({ error: err.message });
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
      if (err.type === 'blocked') return res.status(403).json({ error: err.message, blocked: true });
      throw err;
    }

    res.status(201).json({
      booked: true,
      booking: {
        id: booking.id,
        token: booking.public_token,
        start_at: booking.start_at,
        end_at: booking.end_at,
        manage_url: `${process.env.BASE_URL || process.env.APP_BASE_URL}/booking/${booking.public_token}`
      }
    });
  } catch (err) { next(err); }
});

// POST /api/public/waitlist/:token/decline — decline the offer
router.post('/waitlist/:token/decline', async (req, res, next) => {
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
               AND (preferred_days @> $8::jsonb)
               AND (preferred_time = 'any' OR preferred_time = $9)
             ORDER BY priority ASC, created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           ) AND status = 'waiting'
           RETURNING id, client_email`,
          [offerToken, entry.offer_booking_start, entry.offer_booking_end,
           expiresAt.toISOString(),
           entry.practitioner_id, entry.service_id, entry.business_id,
           JSON.stringify([weekday]), timeOfDay]
        );

        // PUB-6: Send notification email to next client if offer was made
        if (offerResult.rows.length > 0) {
          try {
            await query(
              `INSERT INTO notifications (business_id, type, recipient_email, status, metadata)
               VALUES ($1, 'email_waitlist_offer', $2, 'queued', $3::jsonb)`,
              [entry.business_id, offerResult.rows[0].client_email,
               JSON.stringify({ waitlist_entry_id: offerResult.rows[0].id })]
            );
          } catch (notifErr) { console.warn('[WAITLIST] Notification error:', notifErr.message); }
        }
      }
    } catch (e) { /* non-blocking */ }

    res.json({ declined: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/ics — download .ics file
// Used for "Add to Calendar" button in emails
// ============================================================
router.get('/booking/:token/ics', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.id, b.start_at, b.end_at, b.appointment_mode, b.group_id, b.business_id,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              COALESCE(sv.duration_min, s.duration_min) AS duration_min,
              c.full_name AS client_name,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.address AS business_address
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN clients c ON c.id = b.client_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1 AND b.status IN ('confirmed','pending','modified_pending','pending_deposit')`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).send('Rendez-vous introuvable');

    const bk = result.rows[0];
    // Override end_at and summary for group bookings
    let endAt = bk.end_at;
    let serviceName = bk.service_name || 'Rendez-vous';
    if (bk.group_id) {
      const grp = await query(
        `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name, b2.end_at
         FROM bookings b2
         LEFT JOIN services s ON s.id = b2.service_id
         LEFT JOIN service_variants sv ON sv.id = b2.service_variant_id
         WHERE b2.group_id = $1 AND b2.business_id = $2
         ORDER BY b2.group_order, b2.start_at`,
        [bk.group_id, bk.business_id]
      );
      if (grp.rows.length > 1) {
        endAt = grp.rows[grp.rows.length - 1].end_at;
        serviceName = grp.rows.map(r => r.name).join(' + ');
      }
    }
    const start = new Date(bk.start_at);
    const end = new Date(endAt);
    const summary = `${serviceName} — ${bk.practitioner_name || ''}`;
    const loc = bk.appointment_mode === 'visio' ? 'Visioconférence' : bk.appointment_mode === 'phone' ? 'Téléphone' : (bk.business_address || bk.business_name);
    const desc = [bk.service_name || 'Rendez-vous', bk.practitioner_name ? `Avec ${bk.practitioner_name}` : '', bk.business_name].filter(Boolean).join('\\n');

    function icalDtUTC(d) {
      return d.getUTCFullYear() + String(d.getUTCMonth()+1).padStart(2,'0') + String(d.getUTCDate()).padStart(2,'0') +
        'T' + String(d.getUTCHours()).padStart(2,'0') + String(d.getUTCMinutes()).padStart(2,'0') + String(d.getUTCSeconds()).padStart(2,'0') + 'Z';
    }
    function esc(s) { if (!s) return ''; return String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n').replace(/\r/g,''); }

    const ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Genda//Booking//FR\r\nBEGIN:VEVENT\r\nUID:${bk.id}@genda.be\r\nDTSTART:${icalDtUTC(start)}\r\nDTEND:${icalDtUTC(end)}\r\nSUMMARY:${esc(summary)}\r\nDESCRIPTION:${esc(desc)}\r\nLOCATION:${esc(loc)}\r\nSTATUS:CONFIRMED\r\nBEGIN:VALARM\r\nTRIGGER:-PT30M\r\nACTION:DISPLAY\r\nDESCRIPTION:Rappel RDV\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rdv-genda.ics"`);
    res.send(ical);
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/wb/:token — view shared whiteboard (no auth)
// ============================================================
router.get('/wb/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    const link = await query(
      `SELECT wl.*, w.canvas_data, w.text_layers, w.title, w.bg_type,
              biz.name AS business_name,
              c.full_name AS client_name
       FROM whiteboard_links wl
       JOIN whiteboards w ON w.id = wl.whiteboard_id AND w.deleted_at IS NULL
       JOIN businesses biz ON biz.id = w.business_id
       LEFT JOIN clients c ON c.id = w.client_id
       WHERE wl.token = $1`,
      [token]
    );

    if (link.rows.length === 0) return res.status(404).json({ error: 'Lien invalide ou expiré' });

    const row = link.rows[0];
    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'Ce lien a expiré' });

    // Atomic increment: only bumps if still under limit (prevents TOCTOU race)
    const upd = await query(
      `UPDATE whiteboard_links SET accessed_count = accessed_count + 1
       WHERE id = $1 AND accessed_count < max_accesses
       RETURNING accessed_count`,
      [row.id]
    );
    if (upd.rows.length === 0) return res.status(410).json({ error: 'Nombre maximum d\'accès atteint' });

    res.json({
      title: row.title,
      business_name: row.business_name,
      client_name: row.client_name,
      canvas_data: row.canvas_data,
      text_layers: row.text_layers,
      bg_type: row.bg_type,
      expires_at: row.expires_at
    });
  } catch (err) { next(err); }
});

module.exports = router;
