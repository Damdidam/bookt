const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

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
router.post('/', async (req, res, next) => {
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

    // Link practitioners
    if (practitioner_ids && practitioner_ids.length > 0) {
      const values = practitioner_ids.map((pid, i) =>
        `($${i * 2 + 1}, $${i * 2 + 2})`
      ).join(', ');
      const params = practitioner_ids.flatMap(pid => [pid, result.rows[0].id]);
      await queryWithRLS(bid,
        `INSERT INTO practitioner_services (practitioner_id, service_id) VALUES ${values}`,
        params
      );
    }

    res.status(201).json({ service: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/services/:id — update a service
router.patch('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const fields = req.body;

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

    // Update practitioner links if provided
    if (fields.practitioner_ids) {
      await queryWithRLS(bid,
        `DELETE FROM practitioner_services WHERE service_id = $1`,
        [id]
      );
      for (const pid of fields.practitioner_ids) {
        await queryWithRLS(bid,
          `INSERT INTO practitioner_services (practitioner_id, service_id) VALUES ($1, $2)`,
          [pid, id]
        );
      }
    }

    res.json({ service: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/services/:id — soft delete (set inactive)
router.delete('/:id', async (req, res, next) => {
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
