const router = require('express').Router();
const { query, queryWithRLS } = require('../../services/db');
const { getAvailableSlots } = require('../../services/slot-engine');
const { getCategoryLabels } = require('../../services/email');
const { _nextSlotCache, _minisiteCache, SECTOR_PRACTITIONER } = require('./helpers');

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
              b.google_reviews_url, b.category, b.sector, b.plan
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
                b.google_reviews_url, b.category, b.sector, b.plan
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

    // Test mode protection
    const bizSettings = biz.settings || {};
    if (bizSettings.minisite_test_mode && bizSettings.minisite_test_password) {
      const cookies = {};
      (req.headers.cookie || '').split(';').forEach(c => {
        const [k, v] = c.trim().split('=');
        if (k) cookies[k] = decodeURIComponent(v || '');
      });
      if (cookies['minisite_access_' + biz.slug] !== bizSettings.minisite_test_password) {
        return res.status(401).json({ error: 'protected', requires_password: true });
      }
    }

    // Check minisite response cache (2 min TTL)
    const _msCacheKey = `minisite_${bid}`;
    const _msCached = _minisiteCache[_msCacheKey];
    if (_msCached && Date.now() - _msCached.ts < 2 * 60000) {
      return res.json(_msCached.data);
    }

    const sections = biz.page_sections || {};

    // ===== PARALLEL QUERIES — all independent, run concurrently =====
    const [pracResult, svcResult, specResult, testResult, valResult, galResult, newsResult, reaResult, domainResult, hoursResult] = await Promise.all([
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
                flexibility_enabled, flexibility_discount_pct, available_schedule, min_booking_notice_hours,
                promo_eligible
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
      // Realisations
      query(`SELECT id, title, description, category, image_url, before_url, after_url FROM realisations WHERE business_id = $1 AND is_active = true ORDER BY sort_order LIMIT 20`, [bid])
        .catch(() => ({ rows: [] })),
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
    const realisations = reaResult.rows;

    // ===== NEXT AVAILABLE SLOT (cached 5 min per business) =====
    let nextSlot = null;
    const _nsCacheKey = `nextSlot_${bid}`;
    const _nsCached = _nextSlotCache[_nsCacheKey];
    if (_nsCached && Date.now() - _nsCached.ts < 5 * 60000) {
      nextSlot = _nsCached.val;
    } else {
    const bookableServices = svcResult.rows.filter(s => s.bookable_online !== false);
    if (bookableServices.length > 0) {
      try {
        const now = new Date();
        const brusselsToday = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const weekOut = new Date(now.getTime() + 7 * 86400000); // 1 week out
        const dateTo = weekOut.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const nowMs = now.getTime();
        // Check up to 3 bookable services to find the earliest slot (perf: avoid scanning all services)
        const svcsToCheck = bookableServices.slice(0, 3);
        const slotPromises = svcsToCheck.map(s =>
          getAvailableSlots({ businessId: bid, serviceId: s.id, dateFrom: brusselsToday, dateTo })
            .then(slots => {
              // Slots may be reordered by smart ranking — sort chronologically to find earliest
              const future = slots
                .filter(sl => new Date(sl.start_at).getTime() > nowMs)
                .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
              return future.length > 0 ? future[0].start_at : null;
            })
            .catch(err => {
              console.warn('[MINISITE] next-slot error for service', s.id, ':', err.message);
              return null;
            })
        );
        const earliest = (await Promise.all(slotPromises)).filter(Boolean);
        if (earliest.length > 0) {
          earliest.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
          nextSlot = earliest[0];
        }
      } catch (e) {
        console.warn('[MINISITE] next-slot global error:', e.message);
      }
    }
    _nextSlotCache[_nsCacheKey] = { val: nextSlot, ts: Date.now() };
    } // end cache miss

    const hours = {};
    for (const row of hoursResult.rows) {
      hours[row.weekday] = { opens: row.opens, closes: row.closes };
    }

    // Sector categories catalog (merged with business overrides for descriptions/colors)
    const sectorCatsResult = await query(
      `SELECT sc.label, COALESCE(bc.icon_svg, sc.icon_svg) AS icon_svg,
              COALESCE(bc.sort_order, sc.sort_order) AS sort_order,
              bc.description, bc.color
       FROM sector_categories sc
       LEFT JOIN business_categories bc ON bc.label = sc.label AND bc.business_id = $2
       WHERE sc.sector = $1 AND sc.is_active = true
       UNION
       SELECT bc2.label, bc2.icon_svg, bc2.sort_order, bc2.description, bc2.color
       FROM business_categories bc2
       WHERE bc2.business_id = $2
         AND NOT EXISTS (SELECT 1 FROM sector_categories sc2 WHERE sc2.label = bc2.label AND sc2.sector = $1 AND sc2.is_active = true)
       ORDER BY sort_order`,
      [biz.sector || 'autre', biz.id]
    );

    // Active promotions
    const promoRes = await query(
      `SELECT p.id, p.title, p.description, p.image_url,
              p.condition_type, p.condition_min_cents, p.condition_service_id,
              p.condition_start_date, p.condition_end_date,
              p.reward_type, p.reward_service_id, p.reward_value, p.display_style,
              rs.name AS reward_service_name,
              rs.duration_min AS reward_service_duration_min,
              COALESCE(rs.price_cents, 0) AS reward_service_price_cents,
              cs.name AS condition_service_name
       FROM promotions p
       LEFT JOIN services rs ON rs.id = p.reward_service_id
       LEFT JOIN services cs ON cs.id = p.condition_service_id
       WHERE p.business_id = $1 AND p.is_active = true
         AND (p.condition_end_date IS NULL OR p.condition_end_date >= CURRENT_DATE)
         AND (p.condition_start_date IS NULL OR p.condition_start_date <= CURRENT_DATE)
       ORDER BY p.sort_order, p.created_at`,
      [bid]
    );

    // ===== RESPONSE (cached 2 min) =====
    const _msResponse = {
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
        payment_methods: biz.settings?.payment_methods || [],
        about_image_url: biz.settings?.about_image_url || null,
        giftcard_enabled: !!biz.settings?.giftcard_enabled,
        passes_enabled: !!biz.settings?.passes_enabled,
        plan: biz.plan || 'free'
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
        promo_eligible: s.promo_eligible !== false,
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
      realisations,
      news,
      hours,
      sector_categories: sectorCatsResult.rows,
      promotions: promoRes.rows,
      next_available: nextSlot,
      practitioner_count: pracResult.rows.length
    };
    _minisiteCache[_msCacheKey] = { data: _msResponse, ts: Date.now() };
    res.json(_msResponse);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
