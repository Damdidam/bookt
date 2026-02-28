const router = require('express').Router();
const { query } = require('../../services/db');
const { getAvailableSlots } = require('../../services/slot-engine');
const { bookingLimiter, slotsLimiter } = require('../../middleware/rate-limiter');
const { processWaitlistForCancellation } = require('../../services/waitlist');
const { broadcast } = require('../../services/sse');

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
      `SELECT b.* FROM businesses b WHERE b.slug = $1 AND b.is_active = true`,
      [slug]
    );

    // If not found by slug, try custom domain
    if (bizResult.rows.length === 0) {
      bizResult = await query(
        `SELECT b.* FROM businesses b
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

    // ===== PRACTITIONERS + their specializations =====
    const pracResult = await query(
      `SELECT p.id, p.display_name, p.title, p.bio, p.photo_url, p.color,
              p.years_experience, p.email, p.linkedin_url, p.waitlist_mode,
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
    );

    // ===== SERVICES =====
    const svcResult = await query(
      `SELECT id, name, category, duration_min, price_cents, price_label,
              mode_options, prep_instructions_fr, prep_instructions_nl, color
       FROM services
       WHERE business_id = $1 AND is_active = true
       ORDER BY sort_order, name`,
      [bid]
    );

    // ===== SPECIALIZATIONS =====
    let specializations = [];
    if (sections.specializations !== false) {
      const specResult = await query(
        `SELECT id, name, description, icon
         FROM specializations
         WHERE business_id = $1 AND is_active = true
         ORDER BY sort_order`,
        [bid]
      );
      specializations = specResult.rows;
    }

    // ===== TESTIMONIALS =====
    let testimonials = [];
    if (sections.testimonials !== false) {
      const testResult = await query(
        `SELECT t.id, t.author_name, t.author_role, t.author_initials,
                t.content, t.rating,
                p.display_name AS practitioner_name
         FROM testimonials t
         LEFT JOIN practitioners p ON p.id = t.practitioner_id
         WHERE t.business_id = $1 AND t.is_active = true AND t.is_featured = true
         ORDER BY t.sort_order
         LIMIT 6`,
        [bid]
      );
      testimonials = testResult.rows.map(t => ({
        ...t,
        author_initials: t.author_initials || t.author_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
      }));
    }

    // ===== VALUE PROPOSITIONS =====
    let values = [];
    if (sections.about !== false) {
      const valResult = await query(
        `SELECT id, title, description, icon, icon_style
         FROM value_propositions
         WHERE business_id = $1 AND is_active = true
         ORDER BY sort_order
         LIMIT 4`,
        [bid]
      );
      values = valResult.rows;
    }

    // ===== NEXT AVAILABLE SLOT =====
    let nextSlot = null;

    // ===== GALLERY IMAGES =====
    let gallery = [];
    if (sections.gallery !== false) {
      const galResult = await query(
        `SELECT id, title, caption, image_url
         FROM gallery_images
         WHERE business_id = $1 AND is_active = true
         ORDER BY sort_order
         LIMIT 12`,
        [bid]
      );
      gallery = galResult.rows;
    }

    // ===== NEWS POSTS =====
    let news = [];
    if (sections.news !== false) {
      const newsResult = await query(
        `SELECT id, title, content, tag, tag_type, image_url, published_at
         FROM news_posts
         WHERE business_id = $1 AND is_active = true
         ORDER BY published_at DESC
         LIMIT 6`,
        [bid]
      );
      news = newsResult.rows;
    }

    if (svcResult.rows.length > 0) {
      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const weekOut = new Date(tomorrow.getTime() + 7 * 86400000);
        const slots = await getAvailableSlots({
          businessId: bid,
          serviceId: svcResult.rows[0].id,
          dateFrom: tomorrow.toISOString().split('T')[0],
          dateTo: weekOut.toISOString().split('T')[0]
        });
        if (slots.length > 0) nextSlot = slots[0].start_at;
      } catch (e) { /* non-critical */ }
    }

    // ===== CUSTOM DOMAIN =====
    const domainResult = await query(
      `SELECT domain, verification_status FROM custom_domains
       WHERE business_id = $1 AND verification_status = 'ssl_active'`,
      [bid]
    );

    // ===== AVAILABILITIES (for hours display) =====
    const hoursResult = await query(
      `SELECT DISTINCT weekday, MIN(start_time) AS opens, MAX(end_time) AS closes
       FROM availabilities
       WHERE business_id = $1 AND is_active = true
       GROUP BY weekday
       ORDER BY weekday`,
      [bid]
    );

    const hours = {};
    for (const row of hoursResult.rows) {
      hours[row.weekday] = { opens: row.opens, closes: row.closes };
    }

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
        cancellation_window_hours: biz.settings?.cancellation_window_hours || 24,
        cancellation_fee_percent: biz.settings?.cancellation_fee_percent || 50,
        custom_domain: domainResult.rows.length > 0 ? domainResult.rows[0].domain : null,
        google_reviews_url: biz.google_reviews_url
      },
      practitioners: pracResult.rows.map(p => ({
        id: p.id,
        display_name: p.display_name,
        title: p.title,
        bio: p.bio,
        photo_url: p.photo_url,
        color: p.color,
        years_experience: p.years_experience,
        email: p.email,
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
        price_label: s.price_label || (s.price_cents ? `${(s.price_cents / 100).toFixed(0)} €` : 'Gratuit'),
        mode_options: s.mode_options,
        prep_instructions_fr: s.prep_instructions_fr,
        prep_instructions_nl: s.prep_instructions_nl,
        color: s.color
      })),
      specializations,
      testimonials,
      values,
      gallery,
      news,
      hours,
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
    const { service_id, practitioner_id, date_from, date_to, appointment_mode } = req.query;

    if (!service_id) {
      return res.status(400).json({ error: 'service_id requis' });
    }

    const bizResult = await query(
      `SELECT id FROM businesses WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
    const from = date_from || new Date().toISOString().split('T')[0];
    const defaultTo = new Date();
    defaultTo.setDate(defaultTo.getDate() + 14);
    const to = date_to || defaultTo.toISOString().split('T')[0];

    const slots = await getAvailableSlots({
      businessId, serviceId: service_id,
      practitionerId: practitioner_id || null,
      dateFrom: from, dateTo: to, appointmentMode: appointment_mode
    });

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
// POST /api/public/:slug/bookings
// (unchanged from v1 — same booking creation logic)
// ============================================================
router.post('/:slug/bookings', bookingLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const {
      service_id, practitioner_id, start_at, appointment_mode,
      client_name, client_phone, client_email, client_bce,
      client_comment, client_language, consent_sms, consent_email, consent_marketing
    } = req.body;

    if (!service_id || !practitioner_id || !start_at || !client_name || !client_phone || !client_email) {
      return res.status(400).json({
        error: 'Champs requis : service_id, practitioner_id, start_at, client_name, client_phone, client_email'
      });
    }

    const bizResult = await query(
      `SELECT id FROM businesses WHERE slug = $1 AND is_active = true`, [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
    const { transactionWithRLS } = require('../../services/db');

    const svcResult = await query(
      `SELECT duration_min, buffer_before_min, buffer_after_min
       FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [service_id, businessId]
    );
    if (svcResult.rows.length === 0) return res.status(404).json({ error: 'Prestation introuvable' });

    const service = svcResult.rows[0];
    const startDate = new Date(start_at);
    const totalDuration = service.buffer_before_min + service.duration_min + service.buffer_after_min;
    const endDate = new Date(startDate.getTime() + totalDuration * 60000);

    const result = await transactionWithRLS(businessId, async (client) => {
      // Conflict check
      const conflict = await client.query(
        `SELECT id FROM bookings
         WHERE business_id = $1 AND practitioner_id = $2
         AND status IN ('pending', 'confirmed')
         AND start_at < $4 AND end_at > $3 FOR UPDATE`,
        [businessId, practitioner_id, startDate.toISOString(), endDate.toISOString()]
      );
      if (conflict.rows.length > 0) {
        throw Object.assign(new Error('Ce créneau vient d\'être pris.'), { type: 'conflict' });
      }

      // Find or create client
      let clientId;
      const existing = await client.query(
        `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND (phone = $2 OR email = $3) LIMIT 1`,
        [businessId, client_phone, client_email]
      );
      if (existing.rows.length > 0) {
        // Check if client is blocked
        if (existing.rows[0].is_blocked) {
          throw Object.assign(
            new Error('Votre compte est temporairement suspendu. Veuillez contacter le cabinet directement.'),
            { type: 'blocked', status: 403 }
          );
        }
        clientId = existing.rows[0].id;
        await client.query(
          `UPDATE clients SET full_name=$1, email=$2, phone=$3, bce_number=COALESCE($4,bce_number),
           consent_sms=$5, consent_email=$6, consent_marketing=$7, updated_at=NOW() WHERE id=$8`,
          [client_name, client_email, client_phone, client_bce,
           consent_sms!==false, consent_email!==false, consent_marketing===true, clientId]
        );
      } else {
        const nc = await client.query(
          `INSERT INTO clients (business_id, full_name, phone, email, bce_number,
            language_preference, consent_sms, consent_email, consent_marketing, created_from)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booking') RETURNING id`,
          [businessId, client_name, client_phone, client_email, client_bce||null,
           client_language||'unknown', consent_sms!==false, consent_email!==false, consent_marketing===true]
        );
        clientId = nc.rows[0].id;
      }

      // Create booking
      const booking = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
          channel, appointment_mode, start_at, end_at, status, comment_client)
         VALUES ($1,$2,$3,$4,'web',$5,$6,$7,'confirmed',$8)
         RETURNING id, public_token, start_at, end_at, status`,
        [businessId, practitioner_id, service_id, clientId,
         appointment_mode||'cabinet', startDate.toISOString(), endDate.toISOString(), client_comment||null]
      );

      // Queue notifications
      await client.query(
        `INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status)
         VALUES ($1,$2,'email_confirmation',$3,$4,'queued')`,
        [businessId, booking.rows[0].id, client_email, client_phone]
      );
      await client.query(
        `INSERT INTO notifications (business_id, booking_id, type, status)
         VALUES ($1,$2,'email_new_booking_pro','queued')`,
        [businessId, booking.rows[0].id]
      );

      return booking.rows[0];
    });

    broadcast(businessId, 'booking_update', { action: 'created', source: 'public' });
    res.status(201).json({
      booking: {
        id: result.id, token: result.public_token,
        start_at: result.start_at, end_at: result.end_at, status: result.status,
        cancel_url: `${process.env.BOOKING_BASE_URL}/booking/${result.public_token}`
      }
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
              b.comment_client, b.public_token, b.created_at,
              s.name AS service_name, s.duration_min, s.price_cents, s.color AS service_color,
              p.display_name AS practitioner_name, p.title AS practitioner_title,
              c.full_name AS client_name, c.phone AS client_phone, c.email AS client_email,
              biz.name AS business_name, biz.slug AS business_slug, biz.phone AS business_phone,
              biz.email AS business_email, biz.address AS business_address,
              biz.settings AS business_settings, biz.theme AS business_theme
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN clients c ON c.id = b.client_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];
    const cancelWindowHours = bk.business_settings?.cancellation_window_hours || 24;
    const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
    const canCancel = bk.status === 'confirmed' && new Date() < deadline;

    res.json({
      booking: {
        id: bk.id, token: bk.public_token,
        start_at: bk.start_at, end_at: bk.end_at, status: bk.status,
        appointment_mode: bk.appointment_mode, comment: bk.comment_client,
        created_at: bk.created_at,
        service: { name: bk.service_name, duration_min: bk.duration_min, price_cents: bk.price_cents, color: bk.service_color },
        practitioner: { name: bk.practitioner_name, title: bk.practitioner_title },
        client: { name: bk.client_name, phone: bk.client_phone, email: bk.client_email }
      },
      business: {
        name: bk.business_name, slug: bk.business_slug,
        phone: bk.business_phone, email: bk.business_email,
        address: bk.business_address, theme: bk.business_theme
      },
      cancellation: {
        allowed: canCancel,
        deadline: deadline.toISOString(),
        window_hours: cancelWindowHours,
        reason: !canCancel && bk.status === 'confirmed' ? 'Délai d\'annulation dépassé' : null
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/public/booking/:token/cancel
// Client self-cancel
// ============================================================
router.post('/booking/:token/cancel', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { reason } = req.body;

    const result = await query(
      `SELECT b.id, b.status, b.start_at, b.business_id,
              biz.settings AS business_settings
       FROM bookings b
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });

    const bk = result.rows[0];
    if (bk.status !== 'confirmed') {
      return res.status(400).json({ error: 'Ce rendez-vous ne peut plus être annulé' });
    }

    const cancelWindowHours = bk.business_settings?.cancellation_window_hours || 24;
    const deadline = new Date(new Date(bk.start_at).getTime() - cancelWindowHours * 3600000);
    if (new Date() >= deadline) {
      return res.status(400).json({ error: `Annulation possible jusqu'à ${cancelWindowHours}h avant le rendez-vous` });
    }

    await query(
      `UPDATE bookings SET status = 'cancelled', cancel_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason || 'Annulé par le client', bk.id]
    );

    // Queue cancellation notification
    await query(
      `INSERT INTO notifications (business_id, booking_id, type, status)
       VALUES ($1, $2, 'email_cancellation_pro', 'queued')`,
      [bk.business_id, bk.id]
    );

    // Trigger waitlist processing
    let waitlistResult = null;
    try {
      waitlistResult = await processWaitlistForCancellation(bk.id);
    } catch (e) { /* non-blocking */ }

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

    const result = await query(
      `UPDATE bookings SET status = 'confirmed', updated_at = NOW()
       WHERE public_token = $1 AND status = 'modified_pending'
       RETURNING id, status, start_at, end_at, business_id`,
      [token]
    );

    if (result.rows.length === 0) {
      // Maybe it's already confirmed or doesn't exist
      const check = await query(
        `SELECT status FROM bookings WHERE public_token = $1`, [token]
      );
      if (check.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });
      if (check.rows[0].status === 'confirmed') return res.json({ confirmed: true, already: true });
      return res.status(400).json({ error: 'Ce rendez-vous ne peut pas être confirmé dans son état actuel' });
    }

    // Queue notification to practitioner
    await query(
      `INSERT INTO notifications (business_id, booking_id, type, status)
       VALUES ($1, $2, 'email_modification_confirmed', 'queued')`,
      [result.rows[0].business_id, result.rows[0].id]
    );

    broadcast(result.rows[0].business_id, 'booking_update', { action: 'confirmed', source: 'public' });
    res.json({ confirmed: true, booking: result.rows[0] });
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
      if (check.rows.length === 0) return res.status(404).json({ error: 'Rendez-vous introuvable' });
      if (check.rows[0].status === 'cancelled') return res.json({ rejected: true, already: true });
      return res.status(400).json({ error: 'Ce rendez-vous ne peut pas être refusé dans son état actuel' });
    }

    // Notify practitioner
    await query(
      `INSERT INTO notifications (business_id, booking_id, type, status)
       VALUES ($1, $2, 'email_modification_rejected', 'queued')`,
      [result.rows[0].business_id, result.rows[0].id]
    );

    broadcast(result.rows[0].business_id, 'booking_update', { action: 'rejected', source: 'public' });
    res.json({ rejected: true, booking: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/confirm — landing page (redirect from email button)
// ============================================================
router.get('/booking/:token/confirm', async (req, res, next) => {
  try {
    const { token } = req.params;
    const result = await query(
      `SELECT b.status, b.start_at, b.end_at, s.name AS service_name, biz.name AS business_name, biz.theme
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.public_token = $1`, [token]
    );
    if (result.rows.length === 0) return res.status(404).send(confirmationPage('Rendez-vous introuvable', 'Ce lien n\'est plus valide.', '#C62828'));

    const bk = result.rows[0];
    const color = bk.theme?.primary_color || '#0D7377';
    const dt = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    const tm = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

    if (bk.status === 'confirmed') {
      return res.send(confirmationPage('Déjà confirmé ', `Votre rendez-vous du <strong>${dt} à ${tm}</strong> est confirmé.`, color, bk.business_name));
    }
    if (bk.status !== 'modified_pending') {
      return res.send(confirmationPage('Action impossible', 'Ce rendez-vous ne peut plus être confirmé.', '#A68B3C', bk.business_name));
    }

    // Auto-confirm via GET
    await query(`UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE public_token = $1`, [token]);
    await query(
      `INSERT INTO notifications (business_id, booking_id, type, status) SELECT business_id, id, 'email_modification_confirmed', 'queued' FROM bookings WHERE public_token = $1`, [token]
    );
    const bid = (await query(`SELECT business_id FROM bookings WHERE public_token = $1`, [token])).rows[0]?.business_id;
    if (bid) broadcast(bid, 'booking_update', { action: 'confirmed', source: 'public' });

    res.send(confirmationPage('Rendez-vous confirmé ', `${bk.service_name || 'Votre rendez-vous'} le <strong>${dt} à ${tm}</strong> est confirmé. Merci !`, color, bk.business_name));
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/public/booking/:token/reject — landing page (redirect from email button)
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

    await query(`UPDATE bookings SET status = 'cancelled', cancel_reason = 'client_rejected_modification', updated_at = NOW() WHERE public_token = $1`, [token]);
    await query(
      `INSERT INTO notifications (business_id, booking_id, type, status) SELECT business_id, id, 'email_modification_rejected', 'queued' FROM bookings WHERE public_token = $1`, [token]
    );
    const bid = (await query(`SELECT business_id FROM bookings WHERE public_token = $1`, [token])).rows[0]?.business_id;
    if (bid) broadcast(bid, 'booking_update', { action: 'rejected', source: 'public' });

    const phone = bk.business_phone ? ` au <strong>${bk.business_phone}</strong>` : '';
    res.send(confirmationPage('Rendez-vous refusé', `Le nouveau créneau ne vous convient pas. N'hésitez pas à nous contacter${phone} pour trouver un autre horaire.`, '#C62828', bk.business_name));
  } catch (err) { next(err); }
});

// Helper: build a standalone HTML confirmation/rejection page
function confirmationPage(title, message, color, businessName) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ${businessName || 'Genda'}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background:#F8F9FA;font-family:'Plus Jakarta Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="background:#fff;border-radius:16px;padding:48px 40px;max-width:440px;width:90%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.06)">
  <div style="width:56px;height:56px;border-radius:50%;background:${color}18;display:flex;align-items:center;justify-content:center;margin:0 auto 20px">
    <div style="font-size:24px">${title.includes('') ? '' : title.includes('refusé') || title.includes('annulé') ? '' : 'ℹ'}</div>
  </div>
  <h1 style="font-size:1.3rem;font-weight:700;color:#1A2332;margin:0 0 12px">${title.replace(/[]/g, '').trim()}</h1>
  <p style="font-size:.95rem;color:#6B7A8D;line-height:1.6;margin:0">${message}</p>
  ${businessName ? `<p style="font-size:.75rem;color:#A0AAB6;margin-top:24px">${businessName} · Via Genda</p>` : ''}
</div></body></html>`;
}

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
              s.name AS service_name,
              p.display_name AS practitioner_name,
              c.full_name AS client_name,
              b.name AS business_name, b.slug AS business_slug,
              b.address AS business_address, b.theme,
              b.email AS business_email, b.phone AS business_phone
       FROM pre_rdv_sends ps
       JOIN document_templates dt ON dt.id = ps.template_id
       JOIN bookings bk ON bk.id = ps.booking_id
       JOIN services s ON s.id = bk.service_id
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

    await query(
      `UPDATE pre_rdv_sends SET
        response_data = $1::jsonb,
        consent_given = $2,
        responded_at = NOW(),
        status = 'completed'
       WHERE token = $3`,
      [JSON.stringify(response_data || {}), consent_given, req.params.token]
    );

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

    const bizResult = await query(
      `SELECT id FROM businesses WHERE slug = $1 AND is_active = true`, [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });
    const businessId = bizResult.rows[0].id;

    // Check practitioner has waitlist enabled
    const pracResult = await query(
      `SELECT waitlist_mode FROM practitioners WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [practitioner_id, businessId]
    );
    if (pracResult.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    if (pracResult.rows[0].waitlist_mode === 'off') {
      return res.status(400).json({ error: 'La liste d\'attente n\'est pas activée pour ce praticien' });
    }

    // Check not already on waitlist
    const existing = await query(
      `SELECT id FROM waitlist_entries
       WHERE practitioner_id = $1 AND service_id = $2 AND client_email = $3
       AND status = 'waiting'`,
      [practitioner_id, service_id, client_email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Vous êtes déjà sur la liste d\'attente' });
    }

    // Get next priority
    const maxP = await query(
      `SELECT COALESCE(MAX(priority), 0) + 1 AS next_priority
       FROM waitlist_entries
       WHERE practitioner_id = $1 AND service_id = $2 AND status = 'waiting'`,
      [practitioner_id, service_id]
    );

    const result = await query(
      `INSERT INTO waitlist_entries
        (business_id, practitioner_id, service_id, client_name, client_email,
         client_phone, preferred_days, preferred_time, note, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, priority, created_at`,
      [businessId, practitioner_id, service_id, client_name, client_email,
       client_phone || null,
       JSON.stringify(preferred_days || [0,1,2,3,4]),
       preferred_time || 'any',
       note || null,
       maxP.rows[0].next_priority]
    );

    res.status(201).json({
      waitlisted: true,
      position: maxP.rows[0].next_priority,
      entry_id: result.rows[0].id
    });
  } catch (err) { next(err); }
});

// GET /api/public/waitlist/:token — get offer details
router.get('/waitlist/:token', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT w.*,
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
        `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW() WHERE id = $1`,
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
      `SELECT w.*, s.duration_min, s.buffer_before_min, s.buffer_after_min
       FROM waitlist_entries w
       JOIN services s ON s.id = w.service_id
       WHERE w.offer_token = $1 AND w.status = 'offered'`,
      [req.params.token]
    );

    if (entry.rows.length === 0) {
      return res.status(404).json({ error: 'Offre introuvable ou expirée' });
    }

    const e = entry.rows[0];

    // Check not expired
    if (new Date() > new Date(e.offer_expires_at)) {
      await query(
        `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [e.id]
      );
      return res.status(410).json({ error: 'Cette offre a expiré' });
    }

    const { transactionWithRLS } = require('../../services/db');

    let booking;
    try {
      booking = await transactionWithRLS(e.business_id, async (client) => {
      // Check slot still available WITH lock (inside transaction to prevent race condition)
      const conflict = await client.query(
        `SELECT id FROM bookings
         WHERE business_id = $1 AND practitioner_id = $2
         AND status IN ('pending', 'confirmed')
         AND start_at < $4 AND end_at > $3
         FOR UPDATE`,
        [e.business_id, e.practitioner_id, e.offer_booking_start, e.offer_booking_end]
      );

      if (conflict.rows.length > 0) {
        await client.query(
          `UPDATE waitlist_entries SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [e.id]
        );
        throw Object.assign(new Error('Ce créneau vient d\'être pris'), { type: 'conflict' });
      }

      // Find or create client
      let clientId;
      const existing = await client.query(
        `SELECT id FROM clients WHERE business_id = $1 AND email = $2 LIMIT 1`,
        [e.business_id, e.client_email]
      );
      if (existing.rows.length > 0) {
        clientId = existing.rows[0].id;
      } else {
        const nc = await client.query(
          `INSERT INTO clients (business_id, full_name, email, phone, created_from)
           VALUES ($1, $2, $3, $4, 'booking') RETURNING id`,
          [e.business_id, e.client_name, e.client_email, e.client_phone]
        );
        clientId = nc.rows[0].id;
      }

      // Create booking
      const bk = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, client_id,
          channel, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, 'web', $5, $6, 'confirmed')
         RETURNING id, public_token, start_at, end_at, status`,
        [e.business_id, e.practitioner_id, e.service_id, clientId,
         e.offer_booking_start, e.offer_booking_end]
      );

      // Update waitlist entry
      await client.query(
        `UPDATE waitlist_entries SET
          status = 'booked', offer_booking_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [bk.rows[0].id, e.id]
      );

      // Queue confirmation notification
      await client.query(
        `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status)
         VALUES ($1, $2, 'email_confirmation', $3, 'queued')`,
        [e.business_id, bk.rows[0].id, e.client_email]
      );

      return bk.rows[0];
    });
    } catch (err) {
      if (err.type === 'conflict') return res.status(409).json({ error: err.message });
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
        `SELECT waitlist_mode FROM practitioners WHERE id = $1`,
        [entry.practitioner_id]
      );
      if (prac.rows[0]?.waitlist_mode === 'auto') {
        // Fake a cancellation to re-trigger the queue
        // Build a temporary booking-like object
        const { processWaitlistForCancellation } = require('../../services/waitlist');
        // We need to find next waiting entry directly
        const slotDate = new Date(entry.offer_booking_start);
        const weekday = slotDate.getDay() === 0 ? 6 : slotDate.getDay() - 1;
        const timeOfDay = slotDate.getHours() < 12 ? 'morning' : 'afternoon';
        const crypto = require('crypto');

        const next = await query(
          `SELECT * FROM waitlist_entries
           WHERE practitioner_id = $1 AND service_id = $2 AND business_id = $3
           AND status = 'waiting'
           AND (preferred_days @> $4::jsonb)
           AND (preferred_time = 'any' OR preferred_time = $5)
           ORDER BY priority ASC, created_at ASC LIMIT 1`,
          [entry.practitioner_id, entry.service_id, entry.business_id,
           JSON.stringify([weekday]), timeOfDay]
        );

        if (next.rows.length > 0) {
          const token = crypto.randomBytes(20).toString('hex');
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
          await query(
            `UPDATE waitlist_entries SET
              status = 'offered', offer_token = $1,
              offer_booking_start = $2, offer_booking_end = $3,
              offer_sent_at = NOW(), offer_expires_at = $4, updated_at = NOW()
             WHERE id = $5`,
            [token, entry.offer_booking_start, entry.offer_booking_end,
             expiresAt.toISOString(), next.rows[0].id]
          );
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
      `SELECT b.id, b.start_at, b.end_at, b.appointment_mode,
              s.name AS service_name, s.duration_min,
              c.full_name AS client_name,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.address AS business_address
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN clients c ON c.id = b.client_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.token = $1 AND b.status IN ('confirmed','pending','modified_pending')`,
      [req.params.token]
    );
    if (result.rows.length === 0) return res.status(404).send('Rendez-vous introuvable');

    const bk = result.rows[0];
    const start = new Date(bk.start_at);
    const end = new Date(bk.end_at);
    const summary = `${bk.service_name} — ${bk.practitioner_name}`;
    const loc = bk.appointment_mode === 'visio' ? 'Visioconférence' : bk.appointment_mode === 'phone' ? 'Téléphone' : (bk.business_address || bk.business_name);
    const desc = [bk.service_name, `Avec ${bk.practitioner_name}`, bk.business_name].join('\\n');

    function icalDt(d) {
      return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0') +
        'T' + String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0') + String(d.getSeconds()).padStart(2,'0');
    }
    function esc(s) { return (s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n'); }

    const ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Genda//Booking//FR\r\nBEGIN:VEVENT\r\nUID:${bk.id}@genda.be\r\nDTSTART;TZID=Europe/Brussels:${icalDt(start)}\r\nDTEND;TZID=Europe/Brussels:${icalDt(end)}\r\nSUMMARY:${esc(summary)}\r\nDESCRIPTION:${esc(desc)}\r\nLOCATION:${esc(loc)}\r\nSTATUS:CONFIRMED\r\nBEGIN:VALARM\r\nTRIGGER:-PT30M\r\nACTION:DISPLAY\r\nDESCRIPTION:Rappel RDV\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

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
    if (row.accessed_count >= row.max_accesses) return res.status(410).json({ error: 'Nombre maximum d\'accès atteint' });

    // Increment access count
    await query(`UPDATE whiteboard_links SET accessed_count = accessed_count + 1 WHERE id = $1`, [row.id]);

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
