const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { query } = require('../../services/db');
const { authLimiter } = require('../../middleware/rate-limiter');

// ============================================================
// POST /api/auth/signup
// Self-service registration: professional creates their cabinet
// UI: Landing page Genda.be → "Créer mon cabinet" → formulaire
//
// Creates: business + user (owner) + default practitioner
//          + default services (template comptable)
//          + default availability (Lun-Ven 9-17)
//          + onboarding_progress
//          + call_settings (off by default)
// ============================================================
router.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const {
      // Owner info
      email,
      password,
      full_name,
      // Cabinet info
      business_name,
      business_phone,
      business_address,
      language,
      // Optional
      sector       // 'comptable' | 'avocat' | 'medecin' | 'dentiste' | 'kine' | 'autre'
    } = req.body;

    // ===== VALIDATION =====
    if (!email || !full_name || !business_name) {
      return res.status(400).json({
        error: 'Champs requis : email, full_name, business_name'
      });
    }

    // Email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Format email invalide' });
    }

    // Check email uniqueness
    const existingUser = await query(
      `SELECT id FROM users WHERE email = $1`, [email.toLowerCase().trim()]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
    }

    // Generate slug from business name
    let slug = business_name
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);

    // Ensure slug uniqueness
    const existingSlug = await query(
      `SELECT id FROM businesses WHERE slug = $1`, [slug]
    );
    if (existingSlug.rows.length > 0) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    // Hash password if provided
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;

    // ===== ATOMIC CREATION =====
    const client = await require('../../services/db').pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Create business
      const bizResult = await client.query(
        `INSERT INTO businesses (slug, name, phone, email, address, language_default, plan, sector,
          tagline, settings, page_sections, theme)
         VALUES ($1, $2, $3, $4, $5, $6, 'free', $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
         RETURNING id, slug`,
        [
          slug, business_name, business_phone || null, email, business_address || null,
          language || 'fr',
          // Sector
          sector || 'autre',
          // Auto tagline
          getSectorTagline(sector, business_name, language || 'fr'),
          // Default settings
          JSON.stringify({
            cancellation_window_hours: 24,
            cancellation_fee_percent: 50,
            noshow_policy: 'charge',
            slot_granularity_min: 15,
            booking_horizon_days: 60
          }),
          // Default sections
          JSON.stringify({
            hero: true, about: true, team: true, specializations: true,
            services: true, testimonials: true, gallery: true, news: true,
            location: true, booking_cta: true
          }),
          // Default theme
          JSON.stringify({
            primary_color: '#0D7377', accent_color: '#A68B3C',
            font_heading: 'Instrument Serif', font_body: 'Plus Jakarta Sans'
          })
        ]
      );

      const businessId = bizResult.rows[0].id;

      // 2. Create owner user
      const userResult = await client.query(
        `INSERT INTO users (business_id, email, password_hash, role)
         VALUES ($1, $2, $3, 'owner')
         RETURNING id`,
        [businessId, email.toLowerCase().trim(), passwordHash]
      );

      const userId = userResult.rows[0].id;

      // 3. Create default practitioner (the owner)
      const pracResult = await client.query(
        `INSERT INTO practitioners (business_id, user_id, display_name, title, color)
         VALUES ($1, $2, $3, $4, '#0D7377')
         RETURNING id`,
        [businessId, userId, full_name, getSectorTitle(sector, language || 'fr')]
      );

      const practitionerId = pracResult.rows[0].id;

      // 4. Create default services from sector template
      const templateServices = getSectorServices(sector, language || 'fr');
      const serviceIds = [];

      for (const svc of templateServices) {
        const svcResult = await client.query(
          `INSERT INTO services (business_id, name, category, duration_min,
            buffer_after_min, price_cents, price_label, mode_options, color, sort_order, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, true)
           RETURNING id`,
          [businessId, svc.name, svc.category, svc.duration_min,
           svc.buffer_after_min || 0, svc.price_cents, svc.price_label || null,
           JSON.stringify(svc.mode_options || ['cabinet']),
           svc.color || '#0D7377', svc.sort_order]
        );
        serviceIds.push(svcResult.rows[0].id);

        // Link to practitioner
        await client.query(
          `INSERT INTO practitioner_services (practitioner_id, service_id) VALUES ($1, $2)`,
          [practitionerId, svcResult.rows[0].id]
        );
      }

      // 5. Create default availability (Mon-Fri 9-12, 13-17)
      for (let weekday = 0; weekday <= 4; weekday++) {
        await client.query(
          `INSERT INTO availabilities (business_id, practitioner_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,$5)`,
          [businessId, practitionerId, weekday, '09:00', '12:00']
        );
        await client.query(
          `INSERT INTO availabilities (business_id, practitioner_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4,$5)`,
          [businessId, practitionerId, weekday, '13:00', weekday === 4 ? '16:00' : '17:00']
        );
      }

      // 6. Create default specializations from sector
      const templateSpecs = getSectorSpecializations(sector, language || 'fr');
      for (const spec of templateSpecs) {
        const specResult = await client.query(
          `INSERT INTO specializations (business_id, name, description, icon, sort_order)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [businessId, spec.name, spec.description, spec.icon, spec.sort_order]
        );
        await client.query(
          `INSERT INTO practitioner_specializations (practitioner_id, specialization_id)
           VALUES ($1, $2)`,
          [practitionerId, specResult.rows[0].id]
        );
      }

      // 7. Create default value propositions
      const defaultValues = [
        { title: 'Approche personnalisée', description: 'Chaque dossier est unique.', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>', style: 'teal' },
        { title: 'Réactivité', description: 'Réponse rapide et suivi proactif.', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>', style: 'gold' },
        { title: 'Expertise reconnue', description: 'Des années d\'expérience à votre service.', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>', style: 'green' },
        { title: 'Conseils proactifs', description: 'Au-delà du minimum légal.', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>', style: 'neutral' }
      ];
      for (let i = 0; i < defaultValues.length; i++) {
        const v = defaultValues[i];
        await client.query(
          `INSERT INTO value_propositions (business_id, title, description, icon, icon_style, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [businessId, v.title, v.description, v.icon, v.style, i + 1]
        );
      }

      // 8. Onboarding progress
      await client.query(
        `INSERT INTO onboarding_progress (business_id, steps_completed, completion_percent)
         VALUES ($1, $2::jsonb, 10)`,
        [businessId, JSON.stringify({
          cabinet_info: true, schedule: false, services: false, team: false,
          bio_description: false, specializations: false, testimonials: false,
          notifications: false, call_filter: false, go_live: false
        })]
      );

      // 9. Call settings (off by default)
      await client.query(
        `INSERT INTO call_settings (business_id, filter_mode) VALUES ($1, 'off')`,
        [businessId]
      );

      await client.query('COMMIT');

      // ===== GENERATE JWT =====
      const token = jwt.sign(
        { userId, businessId },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log(`\n  New signup: ${business_name} (${email}) → genda.be/${slug}\n`);

      res.status(201).json({
        token,
        user: { id: userId, email, role: 'owner', business_name },
        business: {
          id: businessId,
          slug,
          name: business_name,
          booking_url: `${process.env.BOOKING_BASE_URL || 'https://genda.be'}/${slug}`
        },
        onboarding_url: '/dashboard?onboarding=true'
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// ============================================================
// SECTOR TEMPLATES
// Pre-filled services, specializations, tagline by profession
// ============================================================

function getSectorTagline(sector, name, lang) {
  const taglines = {
    comptable: { fr: `Cabinet comptable à votre service`, nl: `Boekhouder aan uw zijde` },
    avocat: { fr: `Cabinet d'avocats`, nl: `Advocatenkantoor` },
    medecin: { fr: `Cabinet médical`, nl: `Medisch kabinet` },
    dentiste: { fr: `Cabinet dentaire`, nl: `Tandartspraktijk` },
    kine: { fr: `Cabinet de kinésithérapie`, nl: `Kinesitherapie praktijk` },
    autre: { fr: `Prenez rendez-vous en ligne`, nl: `Maak online een afspraak` }
  };
  return (taglines[sector] || taglines.autre)[lang] || taglines.autre.fr;
}

function getSectorTitle(sector, lang) {
  const titles = {
    comptable: { fr: 'Expert-comptable', nl: 'Boekhouder' },
    avocat: { fr: 'Avocat', nl: 'Advocaat' },
    medecin: { fr: 'Médecin', nl: 'Arts' },
    dentiste: { fr: 'Dentiste', nl: 'Tandarts' },
    kine: { fr: 'Kinésithérapeute', nl: 'Kinesitherapeut' },
    autre: { fr: 'Professionnel', nl: 'Professional' }
  };
  return (titles[sector] || titles.autre)[lang] || titles.autre.fr;
}

function getSectorServices(sector, lang) {
  const templates = {
    comptable: [
      { name: 'Premier contact', category: 'discovery', duration_min: 30, price_cents: null, price_label: 'Gratuit', mode_options: ['cabinet','visio','phone'], color: '#15803D', sort_order: 1 },
      { name: 'Déclaration IPP', category: 'ipp', duration_min: 45, buffer_after_min: 15, price_cents: 12000, mode_options: ['cabinet','visio'], color: '#0D7377', sort_order: 2 },
      { name: 'Consultation TVA', category: 'tva', duration_min: 30, buffer_after_min: 10, price_cents: 9500, mode_options: ['cabinet','visio','phone'], color: '#0D7377', sort_order: 3 },
      { name: 'Question société / SRL', category: 'societe', duration_min: 45, buffer_after_min: 15, price_cents: 15000, mode_options: ['cabinet','visio'], color: '#B45309', sort_order: 4 },
      { name: 'Création d\'activité', category: 'creation', duration_min: 60, buffer_after_min: 15, price_cents: 20000, mode_options: ['cabinet'], color: '#1D4ED8', sort_order: 5 },
      { name: 'Suivi dossier', category: 'suivi', duration_min: 20, buffer_after_min: 5, price_cents: 7500, mode_options: ['cabinet','visio','phone'], color: '#78716C', sort_order: 6 }
    ],
    avocat: [
      { name: 'Consultation initiale', category: 'discovery', duration_min: 30, price_cents: null, price_label: 'Gratuit', mode_options: ['cabinet','visio','phone'], color: '#15803D', sort_order: 1 },
      { name: 'Consultation juridique', category: 'consult', duration_min: 60, buffer_after_min: 15, price_cents: 15000, mode_options: ['cabinet','visio'], color: '#0D7377', sort_order: 2 },
      { name: 'Rédaction de contrat', category: 'contrat', duration_min: 90, buffer_after_min: 15, price_cents: 25000, mode_options: ['cabinet'], color: '#1D4ED8', sort_order: 3 },
      { name: 'Suivi de dossier', category: 'suivi', duration_min: 30, buffer_after_min: 10, price_cents: 10000, mode_options: ['cabinet','visio','phone'], color: '#78716C', sort_order: 4 }
    ],
    medecin: [
      { name: 'Consultation générale', category: 'consult', duration_min: 20, price_cents: 3000, mode_options: ['cabinet'], color: '#0D7377', sort_order: 1 },
      { name: 'Consultation longue', category: 'consult_long', duration_min: 40, price_cents: 5500, mode_options: ['cabinet'], color: '#1D4ED8', sort_order: 2 },
      { name: 'Téléconsultation', category: 'telecons', duration_min: 15, price_cents: 2500, mode_options: ['visio'], color: '#15803D', sort_order: 3 },
      { name: 'Certificat / Attestation', category: 'admin', duration_min: 10, price_cents: 2000, mode_options: ['cabinet'], color: '#78716C', sort_order: 4 }
    ],
    dentiste: [
      { name: 'Contrôle annuel', category: 'controle', duration_min: 30, price_cents: 4000, mode_options: ['cabinet'], color: '#0D7377', sort_order: 1 },
      { name: 'Détartrage', category: 'soin', duration_min: 30, price_cents: 6000, mode_options: ['cabinet'], color: '#15803D', sort_order: 2 },
      { name: 'Soin dentaire', category: 'soin', duration_min: 45, price_cents: 8000, mode_options: ['cabinet'], color: '#1D4ED8', sort_order: 3 },
      { name: 'Urgence dentaire', category: 'urgence', duration_min: 30, price_cents: 7500, mode_options: ['cabinet'], color: '#DC2626', sort_order: 4 }
    ],
    kine: [
      { name: 'Première séance', category: 'bilan', duration_min: 45, price_cents: 4500, mode_options: ['cabinet'], color: '#15803D', sort_order: 1 },
      { name: 'Séance classique', category: 'seance', duration_min: 30, price_cents: 3000, mode_options: ['cabinet'], color: '#0D7377', sort_order: 2 },
      { name: 'Séance longue', category: 'seance_long', duration_min: 60, price_cents: 5500, mode_options: ['cabinet'], color: '#1D4ED8', sort_order: 3 },
      { name: 'Rééducation', category: 'reeduc', duration_min: 45, price_cents: 4000, mode_options: ['cabinet'], color: '#B45309', sort_order: 4 }
    ],
    autre: [
      { name: 'Première consultation', category: 'discovery', duration_min: 30, price_cents: null, price_label: 'Gratuit', mode_options: ['cabinet','visio','phone'], color: '#15803D', sort_order: 1 },
      { name: 'Consultation standard', category: 'standard', duration_min: 45, buffer_after_min: 10, price_cents: 10000, mode_options: ['cabinet','visio'], color: '#0D7377', sort_order: 2 },
      { name: 'Suivi', category: 'suivi', duration_min: 20, price_cents: 5000, mode_options: ['cabinet','visio','phone'], color: '#78716C', sort_order: 3 }
    ]
  };

  return templates[sector] || templates.autre;
}

function getSectorSpecializations(sector, lang) {
  const templates = {
    comptable: [
      { name: 'Fiscalité des indépendants', description: 'IPP, avantages en nature, frais professionnels', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>', sort_order: 1 },
      { name: 'Gestion de sociétés', description: 'SRL, SA, comptes annuels, bilans', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>', sort_order: 2 },
      { name: 'Obligations TVA', description: 'Déclarations, régularisations, contrôles', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>', sort_order: 3 },
      { name: 'Création d\'entreprise', description: 'Plan financier, statuts, numéro BCE', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>', sort_order: 4 }
    ],
    avocat: [
      { name: 'Droit des sociétés', description: 'Constitution, fusions, droit commercial', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>', sort_order: 1 },
      { name: 'Droit du travail', description: 'Contrats, licenciements, conflits', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>', sort_order: 2 },
      { name: 'Droit immobilier', description: 'Baux, ventes, copropriétés', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>', sort_order: 3 },
      { name: 'Droit familial', description: 'Divorce, successions, médiation', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="5" r="2"/><path d="M5.2 17H2v-1.5A4.5 4.5 0 0 1 6.5 11"/><circle cx="17" cy="5" r="2"/><path d="M18.8 17H22v-1.5a4.5 4.5 0 0 0-4.5-4.5"/><circle cx="12" cy="9" r="2"/><path d="M16 21v-1.5A4.5 4.5 0 0 0 12 15v0a4.5 4.5 0 0 0-4 4.5V21"/></svg>', sort_order: 4 }
    ],
    medecin: [
      { name: 'Médecine générale', description: 'Suivi global de santé', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6v0a6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/></svg>', sort_order: 1 },
      { name: 'Prévention', description: 'Bilans de santé, vaccinations', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', sort_order: 2 },
      { name: 'Maladies chroniques', description: 'Diabète, hypertension, asthme', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>', sort_order: 3 }
    ],
    dentiste: [
      { name: 'Soins conservateurs', description: 'Caries, dévitalisations', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5.5c-1.7-1.4-4-2-6-1.5C4 4.5 3 6 3 8c0 4 3 10 5 12 .7.7 1.5.5 2-.5l.5-1c.3-.7 1-1 1.5-1s1.2.3 1.5 1l.5 1c.5 1 1.3 1.2 2 .5 2-2 5-8 5-12 0-2-1-3.5-3-4-2-.5-4.3.1-6 1.5z"/></svg>', sort_order: 1 },
      { name: 'Prothèses', description: 'Couronnes, bridges, implants', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>', sort_order: 2 },
      { name: 'Orthodontie', description: 'Alignement, appareils', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>', sort_order: 3 }
    ],
    kine: [
      { name: 'Rééducation musculaire', description: 'Post-opératoire, entorses, tendinites', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>', sort_order: 1 },
      { name: 'Kinésithérapie respiratoire', description: 'Bronchiolite, BPCO', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.081 20C2.6 20 1 17 1 13.5c0-3 1.2-5.5 3-7l2-1.5v10"/><path d="M17.92 20C21.4 20 23 17 23 13.5c0-3-1.2-5.5-3-7l-2-1.5v10"/><path d="M12 4v16"/></svg>', sort_order: 2 },
      { name: 'Thérapie manuelle', description: 'Dos, cervicales, articulations', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>', sort_order: 3 }
    ],
    autre: [
      { name: 'Consultation', description: 'Service principal', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>', sort_order: 1 },
      { name: 'Accompagnement', description: 'Suivi personnalisé', icon: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>', sort_order: 2 }
    ]
  };

  return templates[sector] || templates.autre;
}

module.exports = router;
