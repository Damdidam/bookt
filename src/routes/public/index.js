const router = require('express').Router();
const { query } = require('../../services/db');
const { getAvailableSlots } = require('../../services/slot-engine');
const { bookingLimiter, slotsLimiter } = require('../../middleware/rate-limiter');

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
              p.years_experience, p.email, p.linkedin_url,
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
        custom_domain: domainResult.rows.length > 0 ? domainResult.rows[0].domain : null
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
        specializations: (p.specialization_names || []).filter(Boolean)
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
        `SELECT id FROM clients WHERE business_id = $1 AND (phone = $2 OR email = $3) LIMIT 1`,
        [businessId, client_phone, client_email]
      );
      if (existing.rows.length > 0) {
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

    res.status(201).json({
      booking: {
        id: result.id, token: result.public_token,
        start_at: result.start_at, end_at: result.end_at, status: result.status,
        cancel_url: `${process.env.BOOKING_BASE_URL}/booking/${result.public_token}`
      }
    });
  } catch (err) {
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

    res.json({ cancelled: true });
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

module.exports = router;
