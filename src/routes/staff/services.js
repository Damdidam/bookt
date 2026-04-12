const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// GET /api/services — list all services
router.get('/', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT s.*,
        ARRAY_AGG(ps.practitioner_id) FILTER (WHERE ps.practitioner_id IS NOT NULL) AS practitioner_ids
       FROM services s
       LEFT JOIN practitioner_services ps ON ps.service_id = s.id
       WHERE s.business_id = $1
       GROUP BY s.id
       ORDER BY s.sort_order, s.name`,
      [req.businessId]
    );
    // Attach variants to each service
    const varResult = await queryWithRLS(req.businessId,
      `SELECT * FROM service_variants WHERE business_id = $1 AND is_active = true ORDER BY sort_order, name`,
      [req.businessId]
    );
    const varByService = {};
    for (const v of varResult.rows) {
      if (!varByService[v.service_id]) varByService[v.service_id] = [];
      varByService[v.service_id].push(v);
    }
    for (const s of result.rows) s.variants = varByService[s.id] || [];

    // Attach pass templates to each service
    const ptResult = await queryWithRLS(req.businessId,
      `SELECT pt.*, sv.name AS variant_name
       FROM pass_templates pt
       LEFT JOIN service_variants sv ON sv.id = pt.service_variant_id
       WHERE pt.business_id = $1 AND pt.is_active = true
       ORDER BY pt.sort_order, pt.name`,
      [req.businessId]
    );
    const ptByService = {};
    for (const pt of ptResult.rows) {
      if (!ptByService[pt.service_id]) ptByService[pt.service_id] = [];
      ptByService[pt.service_id].push(pt);
    }
    for (const s of result.rows) s.pass_templates = ptByService[s.id] || [];

    res.json({ services: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/services — create a service
router.post('/', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { name, category, duration_min, buffer_before_min, buffer_after_min,
            price_cents, price_label, mode_options, prep_instructions_fr,
            prep_instructions_nl, color, description, available_schedule, practitioner_ids, variants,
            bookable_online, processing_time, processing_start,
            flexibility_enabled, flexibility_discount_pct, promo_eligible,
            min_booking_notice_hours, quote_only } = req.body;

    if (!name || !duration_min) {
      return res.status(400).json({ error: 'name et duration_min requis' });
    }
    if (quote_only && req.businessPlan === 'free') {
      return res.status(403).json({ error: 'upgrade_required', message: 'Les prestations sur devis sont disponibles avec le plan Pro.' });
    }

    // V12-023: Limit practitioner_ids array size
    if (practitioner_ids && practitioner_ids.length > 100) {
      return res.status(400).json({ error: 'Trop de praticiens (max 100)' });
    }

    // Check for duplicate name within same category
    const dupCheck = await queryWithRLS(bid,
      `SELECT id FROM services WHERE business_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND COALESCE(category,'') = COALESCE($3,'') AND is_active != false`,
      [bid, name, category || null]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: `Une prestation "${name}" existe déjà dans cette catégorie` });
    }

    // Use transaction to ensure service + variants + practitioner links are atomic
    const service = await transactionWithRLS(bid, async (client) => {
      const result = await client.query(
        `INSERT INTO services (business_id, name, category, duration_min,
          buffer_before_min, buffer_after_min, price_cents, price_label,
          mode_options, prep_instructions_fr, prep_instructions_nl, color, description, available_schedule, bookable_online,
          processing_time, processing_start, flexibility_enabled, flexibility_discount_pct, promo_eligible,
          min_booking_notice_hours, quote_only)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         RETURNING *`,
        [bid, name, category || null, duration_min,
         buffer_before_min || 0, buffer_after_min || 0,
         price_cents || null, price_label || null,
         JSON.stringify(mode_options || ['cabinet']),
         prep_instructions_fr || null, prep_instructions_nl || null,
         color || null, description || null,
         available_schedule ? JSON.stringify(available_schedule) : null,
         bookable_online !== false,
         parseInt(processing_time) || 0, parseInt(processing_start) || 0,
         !!flexibility_enabled, parseInt(flexibility_discount_pct) || 0,
         promo_eligible !== false,
         parseInt(min_booking_notice_hours) || 0,
         !!quote_only]
      );

      const svc = result.rows[0];

      // Create variants if provided
      if (Array.isArray(variants) && variants.length > 0) {
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          if (!v.name || !v.duration_min || v.duration_min <= 0) continue;
          const variantPrice = v.price_cents != null ? Math.max(0, parseInt(v.price_cents) || 0) : null;
          await client.query(
            `INSERT INTO service_variants (business_id, service_id, name, duration_min, price_cents, sort_order, description, processing_time, processing_start)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [bid, svc.id, v.name, v.duration_min, variantPrice, v.sort_order ?? i, v.description || null,
             parseInt(v.processing_time) || 0, parseInt(v.processing_start) || 0]
          );
        }
      }

      // Link practitioners (validate they belong to this business)
      if (practitioner_ids && practitioner_ids.length > 0) {
        const validPracs = await client.query(
          `SELECT id FROM practitioners WHERE id = ANY($1) AND business_id = $2`,
          [practitioner_ids, bid]
        );
        const validIds = validPracs.rows.map(r => r.id);
        for (const pid of validIds) {
          await client.query(
            `INSERT INTO practitioner_services (practitioner_id, service_id) VALUES ($1, $2)`,
            [pid, svc.id]
          );
        }
      }

      return svc;
    });

    res.status(201).json({ service });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/services/reorder — batch update sort_order (MUST be before /:id)
router.patch('/reorder', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array requis' });
    // L6: Validate reorder items
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of order) {
      if (!item.id || !UUID_RE.test(String(item.id))) return res.status(400).json({ error: 'ID invalide dans order' });
      if (item.sort_order !== undefined && typeof item.sort_order !== 'number') return res.status(400).json({ error: 'sort_order invalide' });
    }
    for (const item of order) {
      const sets = ['sort_order = $1'];
      const vals = [item.sort_order, item.id, bid];
      if (item.category !== undefined) { sets.push('category = $4'); vals.push(item.category); }
      await queryWithRLS(bid,
        `UPDATE services SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $2 AND business_id = $3`,
        vals
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/services/category-toggle — bulk activate/deactivate all services in a category (MUST be before /:id)
router.patch('/category-toggle', requireOwner, async (req, res, next) => {
  try {
    const { category, is_active } = req.body;
    if (!category || typeof is_active !== 'boolean') return res.status(400).json({ error: 'category and is_active required' });
    const result = await queryWithRLS(req.businessId,
      `UPDATE services SET is_active = $1, updated_at = NOW()
       WHERE business_id = $2 AND category = $3
       RETURNING id`,
      [is_active, req.businessId, category]
    );
    let active_bookings = 0;
    if (!is_active && result.rows.length > 0) {
      const ids = result.rows.map(r => r.id);
      const upcoming = await queryWithRLS(req.businessId,
        `SELECT COUNT(*)::int AS cnt FROM bookings
         WHERE service_id = ANY($1) AND business_id = $2
           AND start_at > NOW() AND status IN ('pending','confirmed','pending_deposit')`,
        [ids, req.businessId]
      );
      active_bookings = upcoming.rows[0].cnt;
    }
    res.json({ toggled: result.rows.length, is_active, active_bookings });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/services/:id — update a service
router.patch('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const fields = req.body;

    // Block enabling quote_only on free plan (but allow saving an already-quote_only service)
    if (fields.quote_only === true && req.businessPlan === 'free') {
      const _curSvc = await queryWithRLS(bid, `SELECT quote_only FROM services WHERE id = $1 AND business_id = $2`, [id, bid]);
      if (!_curSvc.rows[0]?.quote_only) {
        return res.status(403).json({ error: 'upgrade_required', message: 'Les prestations sur devis sont disponibles avec le plan Pro.' });
      }
    }

    // Validate numeric fields
    const numericFields = ['duration_min', 'buffer_before_min', 'buffer_after_min', 'price_cents', 'processing_time', 'processing_start'];
    for (const nf of numericFields) {
      if (fields[nf] !== undefined && fields[nf] !== null) {
        const parsed = parseInt(fields[nf]);
        if (isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: `${nf} doit être un nombre >= 0` });
        }
        fields[nf] = parsed;
      }
    }

    // Build dynamic update
    const allowed = ['name', 'category', 'duration_min', 'buffer_before_min',
      'buffer_after_min', 'price_cents', 'price_label', 'mode_options',
      'prep_instructions_fr', 'prep_instructions_nl', 'is_active', 'color', 'sort_order', 'description', 'available_schedule', 'bookable_online',
      'processing_time', 'processing_start',
      'flexibility_enabled', 'flexibility_discount_pct', 'promo_eligible',
      'min_booking_notice_hours', 'quote_only'];

    const sets = [];
    const params = [id, bid];
    let idx = 3;

    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = $${idx}`);
        // JSON fields: stringify non-null values, pass null as SQL NULL
        if (key === 'mode_options' || key === 'available_schedule') {
          params.push(val != null ? JSON.stringify(val) : null);
        } else {
          params.push(val);
        }
        idx++;
      }
    }

    // Allow variant-only updates (no service field changes) to proceed
    if (sets.length === 0 && !Array.isArray(fields.variants)) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
    }

    // Check for duplicate name within same category (only if name or category changed)
    if (fields.name || fields.category !== undefined) {
      const currentSvc = await queryWithRLS(bid, `SELECT name, category FROM services WHERE id = $1 AND business_id = $2`, [id, bid]);
      if (currentSvc.rows.length > 0) {
        const newName = fields.name || currentSvc.rows[0].name;
        const newCat = fields.category !== undefined ? fields.category : currentSvc.rows[0].category;
        const dupCheck = await queryWithRLS(bid,
          `SELECT id FROM services WHERE business_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND COALESCE(category,'') = COALESCE($3,'') AND id != $4 AND is_active != false`,
          [bid, newName, newCat || null, id]
        );
        if (dupCheck.rows.length > 0) {
          return res.status(409).json({ error: `Une prestation "${newName}" existe déjà dans cette catégorie` });
        }
      }
    }

    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(bid,
      `UPDATE services SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Prestation introuvable' });

    // If duration or buffers changed, recalculate end_at for future bookings
    // V11-015: This bulk update does not check for booking collisions.
    // A full collision check would require scanning all bookings per practitioner
    // and is deferred to a future version. For now, we ensure end_at > start_at.
    const durationChanged = fields.duration_min !== undefined || fields.buffer_before_min !== undefined || fields.buffer_after_min !== undefined;
    if (durationChanged) {
      const svc = result.rows[0];
      const totalMin = (svc.buffer_before_min || 0) + svc.duration_min + (svc.buffer_after_min || 0);
      if (totalMin <= 0) {
        return res.status(400).json({ error: 'La durée totale (durée + tampons) doit être > 0' });
      }
      await queryWithRLS(bid,
        `UPDATE bookings SET
          end_at = start_at + (interval '1 minute' * $1),
          updated_at = NOW()
         WHERE service_id = $2 AND business_id = $3
         AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')
         AND start_at > NOW()`,
        [totalMin, id, bid]
      );
    }

    // Reconcile variants if provided
    if (Array.isArray(fields.variants)) {
      const svcId = id;
      const incoming = fields.variants;
      const existing = await queryWithRLS(bid,
        `SELECT id FROM service_variants WHERE service_id = $1 AND business_id = $2`,
        [svcId, bid]
      );
      const existingIds = new Set(existing.rows.map(r => r.id));
      const incomingIds = new Set(incoming.filter(v => v.id).map(v => v.id));

      // Soft-delete removed variants
      for (const eid of existingIds) {
        if (!incomingIds.has(eid)) {
          await queryWithRLS(bid,
            `UPDATE service_variants SET is_active = false, updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [eid, bid]
          );
        }
      }

      // Upsert incoming
      for (let i = 0; i < incoming.length; i++) {
        const v = incoming[i];
        if (!v.name || !v.duration_min || v.duration_min <= 0) continue;
        if (v.id && existingIds.has(v.id)) {
          // Update existing
          await queryWithRLS(bid,
            `UPDATE service_variants SET name = $1, duration_min = $2, price_cents = $3,
              sort_order = $4, description = $5, is_active = true, updated_at = NOW(),
              processing_time = $8, processing_start = $9
             WHERE id = $6 AND business_id = $7`,
            [v.name, v.duration_min, v.price_cents != null ? Math.max(0, parseInt(v.price_cents) || 0) : null, v.sort_order ?? i, v.description || null, v.id, bid,
             parseInt(v.processing_time) || 0, parseInt(v.processing_start) || 0]
          );
          // Recalculate end_at for future bookings using this variant
          const totalMin = (result.rows[0].buffer_before_min || 0) + v.duration_min + (result.rows[0].buffer_after_min || 0);
          await queryWithRLS(bid,
            `UPDATE bookings SET end_at = start_at + (interval '1 minute' * $1), updated_at = NOW()
             WHERE service_variant_id = $2 AND business_id = $3
             AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit') AND start_at > NOW()`,
            [totalMin, v.id, bid]
          );
        } else {
          // Insert new
          await queryWithRLS(bid,
            `INSERT INTO service_variants (business_id, service_id, name, duration_min, price_cents, sort_order, description, processing_time, processing_start)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [bid, svcId, v.name, v.duration_min, v.price_cents != null ? Math.max(0, parseInt(v.price_cents) || 0) : null, v.sort_order ?? i, v.description || null,
             parseInt(v.processing_time) || 0, parseInt(v.processing_start) || 0]
          );
        }
      }
    }

    // Update practitioner links if provided (validate they belong to this business)
    if (fields.practitioner_ids) {
      await transactionWithRLS(bid, async (client) => {
        const validPracs = await client.query(
          `SELECT id FROM practitioners WHERE id = ANY($1) AND business_id = $2`,
          [fields.practitioner_ids, bid]
        );
        const validIds = validPracs.rows.map(r => r.id);
        await client.query(
          `DELETE FROM practitioner_services WHERE service_id = $1
           AND practitioner_id IN (SELECT id FROM practitioners WHERE business_id = $2)`,
          [id, bid]
        );
        for (const pid of validIds) {
          await client.query(
            `INSERT INTO practitioner_services (practitioner_id, service_id) VALUES ($1, $2)`,
            [pid, id]
          );
        }
      });
    }

    res.json({ service: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/services/:id/deactivate — soft delete (set inactive)
router.patch('/:id/deactivate', requireOwner, async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `UPDATE services SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    // Count future active bookings using this service
    const upcoming = await queryWithRLS(req.businessId,
      `SELECT COUNT(*)::int AS cnt FROM bookings
       WHERE service_id = $1 AND business_id = $2
         AND start_at > NOW() AND status IN ('pending','confirmed','pending_deposit')`,
      [req.params.id, req.businessId]
    );
    res.json({ deactivated: true, active_bookings: upcoming.rows[0].cnt });
  } catch (err) {
    next(err);
  }
});


// DELETE /api/services/:id — permanent delete (blocked only if active bookings exist)
// M7: Wrapped in transaction to prevent TOCTOU race (booking created between check & delete)
router.delete('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const result = await transactionWithRLS(bid, async (txClient) => {
      // Lock the service row first to prevent concurrent modifications
      const svcLock = await txClient.query(
        `SELECT id FROM services WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, bid]
      );
      if (svcLock.rows.length === 0) return { notFound: true };

      // Only block on active bookings (pending, confirmed, modified_pending)
      const active = await txClient.query(
        `SELECT COUNT(*)::int AS cnt FROM bookings
         WHERE service_id = $1 AND business_id = $2
         AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit')`,
        [id, bid]
      );
      if (active.rows[0].cnt > 0) {
        return { conflict: true, count: active.rows[0].cnt };
      }

      // Nullify service_id on terminal bookings to preserve history (service_id is nullable since v11)
      await txClient.query(
        `UPDATE bookings SET service_id = NULL, service_variant_id = NULL, updated_at = NOW()
         WHERE service_id = $1 AND business_id = $2
         AND status IN ('cancelled', 'completed', 'no_show')`,
        [id, bid]
      );

      // Safe to hard delete (variants + practitioner_services cascade)
      await txClient.query(
        `DELETE FROM services WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );
      return { deleted: true };
    });

    if (result.notFound) return res.status(404).json({ error: 'Prestation introuvable' });
    if (result.conflict) {
      return res.status(409).json({
        error: `Impossible de supprimer : ${result.count} réservation(s) active(s). Annulez-les d'abord ou désactivez la prestation.`
      });
    }

    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// VARIANT CRUD
// ============================================================

// GET /api/services/:serviceId/variants
router.get('/:serviceId/variants', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM service_variants
       WHERE service_id = $1 AND business_id = $2 AND is_active = true
       ORDER BY sort_order, name`,
      [req.params.serviceId, req.businessId]
    );
    res.json({ variants: result.rows });
  } catch (err) { next(err); }
});

// POST /api/services/:serviceId/variants
router.post('/:serviceId/variants', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { serviceId } = req.params;
    const { name, duration_min, price_cents, sort_order, description, processing_time, processing_start } = req.body;

    if (!name || !duration_min || duration_min <= 0) {
      return res.status(400).json({ error: 'name et duration_min (> 0) requis' });
    }

    // Verify service exists
    const svc = await queryWithRLS(bid,
      `SELECT id FROM services WHERE id = $1 AND business_id = $2`, [serviceId, bid]);
    if (svc.rows.length === 0) return res.status(404).json({ error: 'Prestation introuvable' });

    const result = await queryWithRLS(bid,
      `INSERT INTO service_variants (business_id, service_id, name, duration_min, price_cents, sort_order, description, processing_time, processing_start)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [bid, serviceId, name, duration_min, price_cents ?? null, sort_order ?? 0, description || null,
       parseInt(processing_time) || 0, parseInt(processing_start) || 0]
    );
    res.status(201).json({ variant: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/services/:serviceId/variants/:variantId
router.patch('/:serviceId/variants/:variantId', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { variantId } = req.params;
    const fields = req.body;

    const allowed = ['name', 'duration_min', 'price_cents', 'sort_order', 'is_active', 'description', 'processing_time', 'processing_start'];
    const sets = [];
    const params = [variantId, bid];
    let idx = 3;

    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = $${idx}`);
        params.push(val);
        idx++;
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(bid,
      `UPDATE service_variants SET ${sets.join(', ')} WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Variante introuvable' });

    // If duration changed, recalculate end_at for future bookings
    if (fields.duration_min !== undefined) {
      const v = result.rows[0];
      const svc = await queryWithRLS(bid,
        `SELECT buffer_before_min, buffer_after_min FROM services WHERE id = $1 AND business_id = $2`,
        [v.service_id, bid]
      );
      if (svc.rows.length > 0) {
        const totalMin = (svc.rows[0].buffer_before_min || 0) + v.duration_min + (svc.rows[0].buffer_after_min || 0);
        await queryWithRLS(bid,
          `UPDATE bookings SET end_at = start_at + (interval '1 minute' * $1), updated_at = NOW()
           WHERE service_variant_id = $2 AND business_id = $3
           AND status IN ('pending', 'confirmed', 'modified_pending', 'pending_deposit') AND start_at > NOW()`,
          [totalMin, variantId, bid]
        );
      }
    }

    res.json({ variant: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/services/:serviceId/variants/:variantId — soft delete
router.delete('/:serviceId/variants/:variantId', requireOwner, async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `UPDATE service_variants SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [req.params.variantId, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
