const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

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
    res.json({ services: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/services — create a service
router.post('/', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { name, category, duration_min, buffer_before_min, buffer_after_min,
            price_cents, price_label, mode_options, prep_instructions_fr,
            prep_instructions_nl, color, practitioner_ids } = req.body;

    if (!name || !duration_min) {
      return res.status(400).json({ error: 'name et duration_min requis' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO services (business_id, name, category, duration_min,
        buffer_before_min, buffer_after_min, price_cents, price_label,
        mode_options, prep_instructions_fr, prep_instructions_nl, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [bid, name, category || null, duration_min,
       buffer_before_min || 0, buffer_after_min || 0,
       price_cents || null, price_label || null,
       JSON.stringify(mode_options || ['cabinet']),
       prep_instructions_fr || null, prep_instructions_nl || null,
       color || null]
    );

    // Link practitioners (validate they belong to this business)
    if (practitioner_ids && practitioner_ids.length > 0) {
      const validPracs = await queryWithRLS(bid,
        `SELECT id FROM practitioners WHERE id = ANY($1) AND business_id = $2`,
        [practitioner_ids, bid]
      );
      const validIds = validPracs.rows.map(r => r.id);
      if (validIds.length > 0) {
        const values = validIds.map((pid, i) =>
          `($${i * 2 + 1}, $${i * 2 + 2})`
        ).join(', ');
        const params = validIds.flatMap(pid => [pid, result.rows[0].id]);
        await queryWithRLS(bid,
          `INSERT INTO practitioner_services (practitioner_id, service_id) VALUES ${values}`,
          params
        );
      }
    }

    res.status(201).json({ service: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/services/:id — update a service
router.patch('/:id', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const fields = req.body;

    // Validate numeric fields
    const numericFields = ['duration_min', 'buffer_before_min', 'buffer_after_min', 'price_cents'];
    for (const nf of numericFields) {
      if (fields[nf] !== undefined) {
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
      'prep_instructions_fr', 'prep_instructions_nl', 'is_active', 'color', 'sort_order'];

    const sets = [];
    const params = [id, bid];
    let idx = 3;

    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = $${idx}`);
        params.push(key === 'mode_options' ? JSON.stringify(val) : val);
        idx++;
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
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
         AND status IN ('pending', 'confirmed', 'modified_pending')
         AND start_at > NOW()`,
        [totalMin, id, bid]
      );
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
          `DELETE FROM practitioner_services WHERE service_id = $1`,
          [id]
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

// DELETE /api/services/:id — soft delete (set inactive)
router.delete('/:id', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `UPDATE services SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
