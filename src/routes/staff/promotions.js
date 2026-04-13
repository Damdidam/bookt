/**
 * Promotions CRUD (staff dashboard)
 * All routes require auth + business context
 */
const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, requirePro } = require('../../middleware/auth');
const { invalidateMinisiteCache } = require('../public/helpers');

// Drop the public minisite cache after every successful mutation on promotions.
router.use((req, res, next) => {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    res.on('finish', () => { if (res.statusCode < 400 && req.businessId) invalidateMinisiteCache(req.businessId); });
  }
  next();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONDITION_TYPES = ['min_amount', 'specific_service', 'first_visit', 'date_range', 'none'];
const REWARD_TYPES = ['free_service', 'discount_pct', 'discount_fixed', 'info_only'];

function validatePromo(body, isUpdate = false) {
  const errors = [];
  const {
    title, condition_type, reward_type, reward_service_id,
    condition_service_id, condition_min_cents, reward_value
  } = body;

  // Title
  if (!isUpdate || title !== undefined) {
    if (!title || !title.trim()) errors.push('title is required');
    else if (title.length > 200) errors.push('title must be 200 chars max');
  }

  // condition_type
  if (!isUpdate || condition_type !== undefined) {
    if (condition_type && !CONDITION_TYPES.includes(condition_type)) {
      errors.push('condition_type must be one of: ' + CONDITION_TYPES.join(', '));
    }
  }

  // reward_type
  if (!isUpdate || reward_type !== undefined) {
    if (reward_type && !REWARD_TYPES.includes(reward_type)) {
      errors.push('reward_type must be one of: ' + REWARD_TYPES.join(', '));
    }
  }

  const rt = reward_type || body._existing_reward_type;
  const ct = condition_type || body._existing_condition_type;

  // reward_service_id required for free_service
  if (rt === 'free_service') {
    if (!reward_service_id) errors.push('reward_service_id is required when reward_type is free_service');
    else if (!UUID_RE.test(reward_service_id)) errors.push('reward_service_id must be a valid UUID');
  }

  // condition_service_id required for specific_service
  if (ct === 'specific_service') {
    if (!condition_service_id) errors.push('condition_service_id is required when condition_type is specific_service');
    else if (!UUID_RE.test(condition_service_id)) errors.push('condition_service_id must be a valid UUID');
  }

  // condition_min_cents required for min_amount
  if (ct === 'min_amount') {
    const v = parseInt(condition_min_cents);
    if (!v || v <= 0) errors.push('condition_min_cents must be > 0 when condition_type is min_amount');
  }

  // reward_value required for discount_pct / discount_fixed
  if (rt === 'discount_pct') {
    const v = parseFloat(reward_value);
    if (!v || v < 1 || v > 100) errors.push('reward_value must be between 1 and 100 for discount_pct');
  }
  if (rt === 'discount_fixed') {
    const v = parseFloat(reward_value);
    if (!v || v <= 0) errors.push('reward_value must be > 0 for discount_fixed');
  }

  return errors;
}

// GET / — list promos for business
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT p.*,
              s.name AS reward_service_name,
              cs.name AS condition_service_name
       FROM promotions p
       LEFT JOIN services s ON s.id = p.reward_service_id AND s.business_id = p.business_id
       LEFT JOIN services cs ON cs.id = p.condition_service_id AND cs.business_id = p.business_id
       WHERE p.business_id = $1
       ORDER BY p.sort_order ASC, p.created_at DESC`,
      [req.businessId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST / — create promo
router.post('/', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const {
      title, description, condition_type, condition_service_id, condition_min_cents,
      condition_start_date, condition_end_date, reward_type, reward_service_id, reward_value,
      is_active, display_style
    } = req.body;

    // Plan guard: free tier limited to 1 active promo
    if (req.businessPlan === 'free') {
      const countRes = await queryWithRLS(req.businessId,
        `SELECT COUNT(*)::int AS cnt FROM promotions WHERE business_id = $1 AND is_active = true`, [req.businessId]);
      if (countRes.rows[0].cnt >= 1) {
        return res.status(403).json({ error: 'upgrade_required', message: 'Le plan gratuit est limité à 1 promotion active. Passez au Pro pour des promotions illimitées.' });
      }
    }

    // Validate
    const errors = validatePromo(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    // Max 5 active promos
    if (is_active !== false) {
      const countRes = await queryWithRLS(req.businessId,
        `SELECT COUNT(*) FROM promotions WHERE business_id = $1 AND is_active = true`,
        [req.businessId]
      );
      if (parseInt(countRes.rows[0].count) >= 5) {
        return res.status(400).json({ error: 'Maximum 5 active promotions allowed' });
      }
    }

    // Verify reward_service_id belongs to this business
    if (reward_service_id) {
      const svc = await queryWithRLS(req.businessId,
        `SELECT id FROM services WHERE id = $1 AND business_id = $2`,
        [reward_service_id, req.businessId]
      );
      if (!svc.rows.length) return res.status(400).json({ error: 'reward_service_id not found in this business' });
    }

    // Verify condition_service_id belongs to this business
    if (condition_service_id) {
      const svc = await queryWithRLS(req.businessId,
        `SELECT id FROM services WHERE id = $1 AND business_id = $2`,
        [condition_service_id, req.businessId]
      );
      if (!svc.rows.length) return res.status(400).json({ error: 'condition_service_id not found in this business' });
    }

    // Get next sort_order
    const maxSort = await queryWithRLS(req.businessId,
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM promotions WHERE business_id = $1`,
      [req.businessId]
    );

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO promotions (
        business_id, title, description, condition_type, condition_service_id,
        condition_min_cents, condition_start_date, condition_end_date,
        reward_type, reward_service_id, reward_value,
        is_active, display_style, sort_order, max_uses
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        req.businessId, title.trim(), description || null,
        condition_type || 'none', condition_service_id || null,
        condition_min_cents ? parseInt(condition_min_cents) : null,
        condition_start_date || null, condition_end_date || null,
        reward_type || 'info_only', reward_service_id || null,
        reward_value ? parseFloat(reward_value) : null,
        is_active !== false, display_style || 'cards',
        maxSort.rows[0].next,
        req.body.max_uses != null ? parseInt(req.body.max_uses) || null : null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /reorder — reorder promos
router.patch('/reorder', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { ordered_ids } = req.body;
    if (!Array.isArray(ordered_ids) || !ordered_ids.length) {
      return res.status(400).json({ error: 'ordered_ids array is required' });
    }

    for (const id of ordered_ids) {
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid UUID in ordered_ids' });
    }

    // Update sort_order for each id
    for (let i = 0; i < ordered_ids.length; i++) {
      await queryWithRLS(req.businessId,
        `UPDATE promotions SET sort_order = $1 WHERE id = $2 AND business_id = $3`,
        [i + 1, ordered_ids[i], req.businessId]
      );
    }

    res.json({ reordered: true });
  } catch (err) { next(err); }
});

// PATCH /:id — update promo
router.patch('/:id', requireAuth, requireOwner, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid promotion ID' });

    // Fetch existing to merge types for validation
    const existing = await queryWithRLS(req.businessId,
      `SELECT * FROM promotions WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'Promotion not found' });

    const current = existing.rows[0];

    // Merge existing types for cross-field validation
    const body = {
      ...req.body,
      _existing_reward_type: current.reward_type,
      _existing_condition_type: current.condition_type
    };
    if (body.reward_type === undefined) body.reward_service_id = body.reward_service_id ?? current.reward_service_id;
    if (body.condition_type === undefined) body.condition_service_id = body.condition_service_id ?? current.condition_service_id;
    if (body.condition_type === undefined) body.condition_min_cents = body.condition_min_cents ?? current.condition_min_cents;
    if (body.reward_type === undefined) body.reward_value = body.reward_value ?? current.reward_value;

    const errors = validatePromo(body, true);
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    // Plan guard: Free plan limited to 1 active promotion (on toggle activation too)
    if (req.body.is_active === true && !current.is_active) {
      if (req.businessPlan === 'free') {
        const freeCountRes = await queryWithRLS(req.businessId,
          `SELECT COUNT(*)::int AS cnt FROM promotions WHERE business_id = $1 AND is_active = true`, [req.businessId]);
        if (freeCountRes.rows[0].cnt >= 1) {
          return res.status(403).json({ error: 'upgrade_required', message: 'Le plan gratuit est limité à 1 promotion active.' });
        }
      }
      // Max 5 active promos check (Pro)
      const countRes = await queryWithRLS(req.businessId,
        `SELECT COUNT(*) FROM promotions WHERE business_id = $1 AND is_active = true`, [req.businessId]);
      if (parseInt(countRes.rows[0].count) >= 5) {
        return res.status(400).json({ error: 'Maximum 5 active promotions allowed' });
      }
    }

    // Verify reward_service_id belongs to this business
    if (req.body.reward_service_id) {
      const svc = await queryWithRLS(req.businessId,
        `SELECT id FROM services WHERE id = $1 AND business_id = $2`,
        [req.body.reward_service_id, req.businessId]
      );
      if (!svc.rows.length) return res.status(400).json({ error: 'reward_service_id not found in this business' });
    }

    // Verify condition_service_id belongs to this business
    if (req.body.condition_service_id) {
      const svc = await queryWithRLS(req.businessId,
        `SELECT id FROM services WHERE id = $1 AND business_id = $2`,
        [req.body.condition_service_id, req.businessId]
      );
      if (!svc.rows.length) return res.status(400).json({ error: 'condition_service_id not found in this business' });
    }

    // Build dynamic SET
    const sets = [];
    const params = [req.params.id, req.businessId];
    let idx = 3;

    const fields = [
      'title', 'description', 'condition_type', 'condition_service_id',
      'condition_min_cents', 'condition_start_date', 'condition_end_date',
      'reward_type', 'reward_service_id', 'reward_value',
      'is_active', 'display_style', 'max_uses'
    ];

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        let val = req.body[field];
        if (field === 'title' && val) val = val.trim();
        if (field === 'condition_min_cents' && val !== null) val = parseInt(val);
        if (field === 'reward_value' && val !== null) val = parseFloat(val);
        sets.push(`${field} = $${idx}`);
        params.push(val);
        idx++;
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(req.businessId,
      `UPDATE promotions SET ${sets.join(', ')}
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// DELETE /:id — delete promo
router.delete('/:id', requireAuth, requireOwner, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid promotion ID' });

    // FK bookings.promotion_id has ON DELETE NO ACTION, so we must unlink historical
    // bookings first. Denormalized fields (promotion_label, promotion_discount_cents,
    // promotion_discount_pct) remain on each booking for historical reporting.
    await queryWithRLS(req.businessId,
      `UPDATE bookings SET promotion_id = NULL WHERE promotion_id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );

    const result = await queryWithRLS(req.businessId,
      `DELETE FROM promotions WHERE id = $1 AND business_id = $2 RETURNING id`,
      [req.params.id, req.businessId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Promotion not found' });

    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
