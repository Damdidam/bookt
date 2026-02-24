const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// ============================================================
// TESTIMONIALS
// UI: Dashboard > Mon site > Témoignages
// ============================================================

// GET /api/site/testimonials
router.get('/testimonials', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT t.*, p.display_name AS practitioner_name
       FROM testimonials t
       LEFT JOIN practitioners p ON p.id = t.practitioner_id
       WHERE t.business_id = $1
       ORDER BY t.sort_order`,
      [req.businessId]
    );
    res.json({ testimonials: result.rows });
  } catch (err) { next(err); }
});

// POST /api/site/testimonials
router.post('/testimonials', async (req, res, next) => {
  try {
    const { author_name, author_role, content, rating, practitioner_id, is_featured } = req.body;
    if (!author_name || !content) {
      return res.status(400).json({ error: 'author_name et content requis' });
    }

    const initials = author_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    // Get next sort order
    const maxOrder = await queryWithRLS(req.businessId,
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM testimonials WHERE business_id = $1`,
      [req.businessId]
    );

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO testimonials (business_id, author_name, author_role, author_initials,
        content, rating, practitioner_id, is_featured, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [req.businessId, author_name, author_role || null, initials,
       content, rating || 5, practitioner_id || null,
       is_featured !== false, maxOrder.rows[0].next]
    );

    res.status(201).json({ testimonial: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/site/testimonials/:id
router.patch('/testimonials/:id', async (req, res, next) => {
  try {
    const { author_name, author_role, content, rating, practitioner_id,
            is_featured, is_active, sort_order } = req.body;

    const result = await queryWithRLS(req.businessId,
      `UPDATE testimonials SET
        author_name = COALESCE($1, author_name),
        author_role = COALESCE($2, author_role),
        content = COALESCE($3, content),
        rating = COALESCE($4, rating),
        practitioner_id = COALESCE($5, practitioner_id),
        is_featured = COALESCE($6, is_featured),
        is_active = COALESCE($7, is_active),
        sort_order = COALESCE($8, sort_order),
        updated_at = NOW()
       WHERE id = $9 AND business_id = $10
       RETURNING *`,
      [author_name, author_role, content, rating, practitioner_id,
       is_featured, is_active, sort_order, req.params.id, req.businessId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Témoignage introuvable' });
    res.json({ testimonial: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/site/testimonials/:id
router.delete('/testimonials/:id', async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM testimonials WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// SPECIALIZATIONS
// UI: Dashboard > Mon site > Spécialisations
// ============================================================

// GET /api/site/specializations
router.get('/specializations', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT s.*,
        ARRAY_AGG(psp.practitioner_id) FILTER (WHERE psp.practitioner_id IS NOT NULL) AS practitioner_ids
       FROM specializations s
       LEFT JOIN practitioner_specializations psp ON psp.specialization_id = s.id
       WHERE s.business_id = $1
       GROUP BY s.id
       ORDER BY s.sort_order`,
      [req.businessId]
    );
    res.json({ specializations: result.rows });
  } catch (err) { next(err); }
});

// POST /api/site/specializations
router.post('/specializations', async (req, res, next) => {
  try {
    const { name, description, icon, practitioner_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'name requis' });

    const maxOrder = await queryWithRLS(req.businessId,
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM specializations WHERE business_id = $1`,
      [req.businessId]
    );

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO specializations (business_id, name, description, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.businessId, name, description || null, icon || '📋', maxOrder.rows[0].next]
    );

    // Link practitioners
    if (practitioner_ids && practitioner_ids.length > 0) {
      for (const pid of practitioner_ids) {
        await queryWithRLS(req.businessId,
          `INSERT INTO practitioner_specializations (practitioner_id, specialization_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [pid, result.rows[0].id]
        );
      }
    }

    res.status(201).json({ specialization: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/site/specializations/:id
router.patch('/specializations/:id', async (req, res, next) => {
  try {
    const { name, description, icon, is_active, sort_order, practitioner_ids } = req.body;

    const result = await queryWithRLS(req.businessId,
      `UPDATE specializations SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        icon = COALESCE($3, icon),
        is_active = COALESCE($4, is_active),
        sort_order = COALESCE($5, sort_order)
       WHERE id = $6 AND business_id = $7
       RETURNING *`,
      [name, description, icon, is_active, sort_order, req.params.id, req.businessId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Spécialisation introuvable' });

    // Update practitioner links
    if (practitioner_ids !== undefined) {
      await queryWithRLS(req.businessId,
        `DELETE FROM practitioner_specializations WHERE specialization_id = $1`,
        [req.params.id]
      );
      for (const pid of (practitioner_ids || [])) {
        await queryWithRLS(req.businessId,
          `INSERT INTO practitioner_specializations (practitioner_id, specialization_id)
           VALUES ($1, $2)`,
          [pid, req.params.id]
        );
      }
    }

    res.json({ specialization: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/site/specializations/:id
router.delete('/specializations/:id', async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM practitioner_specializations WHERE specialization_id = $1`, [req.params.id]
    );
    await queryWithRLS(req.businessId,
      `DELETE FROM specializations WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// VALUE PROPOSITIONS
// UI: Dashboard > Mon site > Valeurs / Points forts
// ============================================================

// GET /api/site/values
router.get('/values', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM value_propositions WHERE business_id = $1 ORDER BY sort_order`,
      [req.businessId]
    );
    res.json({ values: result.rows });
  } catch (err) { next(err); }
});

// POST /api/site/values
router.post('/values', async (req, res, next) => {
  try {
    const { title, description, icon, icon_style } = req.body;
    if (!title) return res.status(400).json({ error: 'title requis' });

    const maxOrder = await queryWithRLS(req.businessId,
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM value_propositions WHERE business_id = $1`,
      [req.businessId]
    );

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO value_propositions (business_id, title, description, icon, icon_style, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.businessId, title, description || null, icon || '✦', icon_style || 'teal', maxOrder.rows[0].next]
    );

    res.status(201).json({ value: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/site/values/:id
router.patch('/values/:id', async (req, res, next) => {
  try {
    const { title, description, icon, icon_style, is_active, sort_order } = req.body;

    const result = await queryWithRLS(req.businessId,
      `UPDATE value_propositions SET
        title = COALESCE($1, title), description = COALESCE($2, description),
        icon = COALESCE($3, icon), icon_style = COALESCE($4, icon_style),
        is_active = COALESCE($5, is_active), sort_order = COALESCE($6, sort_order)
       WHERE id = $7 AND business_id = $8 RETURNING *`,
      [title, description, icon, icon_style, is_active, sort_order, req.params.id, req.businessId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Valeur introuvable' });
    res.json({ value: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/site/values/:id
router.delete('/values/:id', async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM value_propositions WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// PAGE SECTIONS — toggle visibility + reorder
// UI: Dashboard > Mon site > Sections visibles
// ============================================================

// GET /api/site/sections
router.get('/sections', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT page_sections FROM businesses WHERE id = $1`, [req.businessId]
    );
    res.json({ sections: result.rows[0]?.page_sections || {} });
  } catch (err) { next(err); }
});

// PATCH /api/site/sections
router.patch('/sections', requireOwner, async (req, res, next) => {
  try {
    const { sections } = req.body;
    const result = await queryWithRLS(req.businessId,
      `UPDATE businesses SET page_sections = $1::jsonb, updated_at = NOW()
       WHERE id = $2 RETURNING page_sections`,
      [JSON.stringify(sections), req.businessId]
    );
    res.json({ sections: result.rows[0].page_sections });
  } catch (err) { next(err); }
});

// ============================================================
// CUSTOM DOMAIN
// UI: Dashboard > Paramètres > Domaine personnalisé
// ============================================================

// GET /api/site/domain
router.get('/domain', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM custom_domains WHERE business_id = $1`, [req.businessId]
    );
    res.json({ domain: result.rows[0] || null });
  } catch (err) { next(err); }
});

// POST /api/site/domain
router.post('/domain', requireOwner, async (req, res, next) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain requis' });

    // Validate domain format
    const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/;
    if (!domainRegex.test(domain.toLowerCase())) {
      return res.status(400).json({ error: 'Format de domaine invalide' });
    }

    // Check uniqueness
    const existing = await queryWithRLS(req.businessId,
      `SELECT id FROM custom_domains WHERE domain = $1 AND business_id != $2`,
      [domain.toLowerCase(), req.businessId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ce domaine est déjà utilisé' });
    }

    // Upsert
    const result = await queryWithRLS(req.businessId,
      `INSERT INTO custom_domains (business_id, domain, verification_status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (business_id) DO UPDATE SET
         domain = $2, verification_status = 'pending',
         verification_token = encode(gen_random_bytes(16), 'hex'),
         updated_at = NOW()
       RETURNING *`,
      [req.businessId, domain.toLowerCase()]
    );

    const cd = result.rows[0];

    res.json({
      domain: cd,
      dns_instructions: {
        type: 'CNAME',
        name: domain.toLowerCase(),
        value: 'sites.bookt.be',
        verification: {
          type: 'TXT',
          name: `_bookt.${domain.toLowerCase()}`,
          value: cd.verification_token
        }
      }
    });
  } catch (err) { next(err); }
});

// POST /api/site/domain/verify — check DNS records
router.post('/domain/verify', requireOwner, async (req, res, next) => {
  try {
    const domainResult = await queryWithRLS(req.businessId,
      `SELECT * FROM custom_domains WHERE business_id = $1`, [req.businessId]
    );
    if (domainResult.rows.length === 0) {
      return res.status(404).json({ error: 'Aucun domaine configuré' });
    }

    const cd = domainResult.rows[0];

    // In production: do actual DNS lookup
    // const dns = require('dns').promises;
    // const txtRecords = await dns.resolveTxt(`_bookt.${cd.domain}`);
    // const cnameRecords = await dns.resolveCname(cd.domain);

    // For now: simulate
    const verified = false; // Will be true when DNS propagates

    if (verified) {
      await queryWithRLS(req.businessId,
        `UPDATE custom_domains SET verification_status = 'dns_verified',
         last_checked_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [cd.id]
      );
      // TODO: Trigger SSL provisioning (Caddy / Cloudflare for SaaS)
    } else {
      await queryWithRLS(req.businessId,
        `UPDATE custom_domains SET last_checked_at = NOW(),
         error_message = 'DNS records not found yet' WHERE id = $1`,
        [cd.id]
      );
    }

    res.json({
      verified,
      status: verified ? 'dns_verified' : 'pending',
      message: verified
        ? 'DNS vérifié ! Le certificat SSL sera provisionné sous quelques minutes.'
        : 'Enregistrements DNS non détectés. La propagation peut prendre jusqu\'à 48h.'
    });
  } catch (err) { next(err); }
});

// DELETE /api/site/domain
router.delete('/domain', requireOwner, async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM custom_domains WHERE business_id = $1`, [req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// PRACTITIONERS (extended — bio, photo, specializations)
// UI: Dashboard > Mon site > Équipe
// ============================================================

// PATCH /api/site/practitioners/:id
router.patch('/practitioners/:id', async (req, res, next) => {
  try {
    const { display_name, title, bio, photo_url, color,
            years_experience, email, phone, linkedin_url } = req.body;

    const result = await queryWithRLS(req.businessId,
      `UPDATE practitioners SET
        display_name = COALESCE($1, display_name),
        title = COALESCE($2, title),
        bio = COALESCE($3, bio),
        photo_url = COALESCE($4, photo_url),
        color = COALESCE($5, color),
        years_experience = COALESCE($6, years_experience),
        email = COALESCE($7, email),
        phone = COALESCE($8, phone),
        linkedin_url = COALESCE($9, linkedin_url),
        updated_at = NOW()
       WHERE id = $10 AND business_id = $11
       RETURNING *`,
      [display_name, title, bio, photo_url, color,
       years_experience, email, phone, linkedin_url,
       req.params.id, req.businessId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Praticien introuvable' });
    res.json({ practitioner: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// ONBOARDING PROGRESS
// UI: Dashboard > Onboarding wizard
// ============================================================

// GET /api/site/onboarding
router.get('/onboarding', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM onboarding_progress WHERE business_id = $1`, [req.businessId]
    );

    if (result.rows.length === 0) {
      // Create default
      const created = await queryWithRLS(req.businessId,
        `INSERT INTO onboarding_progress (business_id) VALUES ($1) RETURNING *`,
        [req.businessId]
      );
      return res.json({ onboarding: created.rows[0] });
    }

    res.json({ onboarding: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/site/onboarding — mark a step as complete
router.patch('/onboarding', async (req, res, next) => {
  try {
    const { step, completed } = req.body;

    // Get current
    const current = await queryWithRLS(req.businessId,
      `SELECT steps_completed FROM onboarding_progress WHERE business_id = $1`,
      [req.businessId]
    );

    if (current.rows.length === 0) return res.status(404).json({ error: 'Onboarding non initialisé' });

    const steps = current.rows[0].steps_completed;
    steps[step] = completed !== false;

    // Calculate percentage
    const total = Object.keys(steps).length;
    const done = Object.values(steps).filter(Boolean).length;
    const percent = Math.round((done / total) * 100);

    const result = await queryWithRLS(req.businessId,
      `UPDATE onboarding_progress SET
        steps_completed = $1::jsonb,
        completion_percent = $2::int,
        completed_at = CASE WHEN $3::int = 100 THEN NOW() ELSE NULL END,
        updated_at = NOW()
       WHERE business_id = $4
       RETURNING *`,
      [JSON.stringify(steps), percent, percent, req.businessId]
    );

    res.json({ onboarding: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
