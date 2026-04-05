const router = require('express').Router();
const crypto = require('crypto');
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, requirePro } = require('../../middleware/auth');

router.use(requireAuth);
router.use(requireOwner);
router.use(requirePro);

/** Read passes_enabled from business settings. Defaults to false if unset. */
async function isPassesFeatureEnabled(bid) {
  const r = await queryWithRLS(bid, `SELECT settings FROM businesses WHERE id = $1`, [bid]);
  return !!r.rows[0]?.settings?.passes_enabled;
}

/** Generate unique pass code: PS-XXXX-XXXX */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let code = 'PS-';
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)];
  return code;
}

// ============================================================
// GET /api/passes/templates — list pass templates
// ============================================================
router.get('/templates', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id } = req.query;

    let sql = `
      SELECT pt.*, s.name AS service_name
      FROM pass_templates pt
      LEFT JOIN services s ON s.id = pt.service_id
      WHERE pt.business_id = $1 AND pt.is_active = true`;
    const params = [bid];
    let idx = 2;

    if (service_id) {
      sql += ` AND pt.service_id = $${idx}`;
      params.push(service_id);
      idx++;
    }

    sql += ` ORDER BY pt.sort_order ASC, pt.created_at ASC`;
    const result = await queryWithRLS(bid, sql, params);

    res.json({ templates: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes/templates — create a pass template
// ============================================================
router.post('/templates', async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!(await isPassesFeatureEnabled(bid))) {
      return res.status(403).json({ error: 'Les abonnements sont désactivés. Activez-les dans Paramètres > Abonnements.' });
    }
    const { service_id, service_variant_id, name, description, sessions_count, price_cents, validity_days } = req.body;

    if (!name || !sessions_count || !price_cents) {
      return res.status(400).json({ error: 'Champs requis: name, sessions_count, price_cents' });
    }

    // Validate service belongs to this business
    if (service_id) {
      const svc = await queryWithRLS(bid, 'SELECT 1 FROM services WHERE id = $1 AND business_id = $2', [service_id, bid]);
      if (svc.rows.length === 0) return res.status(400).json({ error: 'Service introuvable' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO pass_templates (business_id, service_id, service_variant_id, name, description, sessions_count, price_cents, validity_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [bid, service_id || null, service_variant_id || null, name, description || null, sessions_count, price_cents, validity_days || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/passes/templates/:id — update a pass template
// ============================================================
router.patch('/templates/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { name, description, service_variant_id, sessions_count, price_cents, validity_days, is_active } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx}`); values.push(name); idx++; }
    if (description !== undefined) { fields.push(`description = $${idx}`); values.push(description || null); idx++; }
    if (service_variant_id !== undefined) { fields.push(`service_variant_id = $${idx}`); values.push(service_variant_id || null); idx++; }
    if (sessions_count !== undefined) { fields.push(`sessions_count = $${idx}`); values.push(sessions_count); idx++; }
    if (price_cents !== undefined) { fields.push(`price_cents = $${idx}`); values.push(price_cents); idx++; }
    if (validity_days !== undefined) { fields.push(`validity_days = $${idx}`); values.push(validity_days); idx++; }
    if (is_active !== undefined) { fields.push(`is_active = $${idx}`); values.push(is_active); idx++; }

    if (fields.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    fields.push(`updated_at = NOW()`);
    values.push(id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE pass_templates SET ${fields.join(', ')}
       WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/passes/templates/:id — soft delete (is_active = false)
// ============================================================
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const result = await queryWithRLS(bid,
      `UPDATE pass_templates SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes/templates/sync — bulk upsert templates for a service
// ============================================================
router.post('/templates/sync', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id, templates } = req.body;

    if (!service_id) return res.status(400).json({ error: 'service_id requis' });
    if (!Array.isArray(templates)) return res.status(400).json({ error: 'templates doit être un tableau' });

    // Validate service belongs to this business
    const svc = await queryWithRLS(bid, 'SELECT 1 FROM services WHERE id = $1 AND business_id = $2', [service_id, bid]);
    if (svc.rows.length === 0) return res.status(400).json({ error: 'Service introuvable' });

    const upsertedIds = [];

    for (const tpl of templates) {
      const { id, name, description, service_variant_id, sessions_count, price_cents, validity_days } = tpl;

      if (id) {
        const r = await queryWithRLS(bid,
          `UPDATE pass_templates
           SET name = $1, description = $2, service_variant_id = $3, sessions_count = $4, price_cents = $5, validity_days = $6,
               is_active = true, updated_at = NOW()
           WHERE id = $7 AND business_id = $8 AND service_id = $9
           RETURNING id`,
          [name, description || null, service_variant_id || null, sessions_count, price_cents, validity_days || null, id, bid, service_id]
        );
        if (r.rows.length > 0) upsertedIds.push(r.rows[0].id);
      } else {
        const r = await queryWithRLS(bid,
          `INSERT INTO pass_templates (business_id, service_id, service_variant_id, name, description, sessions_count, price_cents, validity_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [bid, service_id, service_variant_id || null, name, description || null, sessions_count, price_cents, validity_days || null]
        );
        upsertedIds.push(r.rows[0].id);
      }
    }

    // Deactivate templates for this service not in the list
    if (upsertedIds.length > 0) {
      await queryWithRLS(bid,
        `UPDATE pass_templates SET is_active = false, updated_at = NOW()
         WHERE business_id = $1 AND service_id = $2 AND id != ALL($3::uuid[])`,
        [bid, service_id, upsertedIds]
      );
    } else {
      // No templates submitted — deactivate all for this service
      await queryWithRLS(bid,
        `UPDATE pass_templates SET is_active = false, updated_at = NOW()
         WHERE business_id = $1 AND service_id = $2`,
        [bid, service_id]
      );
    }

    // Return updated list
    const result = await queryWithRLS(bid,
      `SELECT pt.*, s.name AS service_name
       FROM pass_templates pt
       LEFT JOIN services s ON s.id = pt.service_id
       WHERE pt.business_id = $1 AND pt.service_id = $2
       ORDER BY pt.sort_order ASC, pt.created_at ASC`,
      [bid, service_id]
    );

    res.json({ templates: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/passes — list passes + stats
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, search } = req.query;

    let sql = `
      SELECT p.*,
             s.name AS service_name,
             (SELECT json_agg(json_build_object(
               'id', t.id, 'sessions', t.sessions, 'type', t.type,
               'note', t.note, 'booking_id', t.booking_id, 'created_at', t.created_at
             ) ORDER BY t.created_at DESC)
             FROM pass_transactions t WHERE t.pass_id = p.id) AS transactions
      FROM passes p
      LEFT JOIN services s ON s.id = p.service_id
      WHERE p.business_id = $1`;
    const params = [bid];
    let idx = 2;

    if (status && status !== 'all') {
      sql += ` AND p.status = $${idx}`;
      params.push(status);
      idx++;
    }
    if (search) {
      sql += ` AND (p.code ILIKE $${idx} OR p.buyer_name ILIKE $${idx} OR p.buyer_email ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += ` ORDER BY p.created_at DESC LIMIT 200`;
    const result = await queryWithRLS(bid, sql, params);

    // Stats
    const stats = await queryWithRLS(bid, `
      SELECT
        COUNT(*) AS total_count,
        COUNT(*) FILTER (WHERE status = 'active') AS active_count,
        COUNT(*) FILTER (WHERE status = 'used') AS used_count,
        COUNT(*) FILTER (WHERE status = 'expired') AS expired_count,
        COALESCE(SUM(sessions_total), 0) AS total_sessions_sold,
        COALESCE(SUM(sessions_remaining) FILTER (WHERE status = 'active'), 0) AS total_sessions_remaining
      FROM passes WHERE business_id = $1
    `, [bid]);

    const feature_enabled = await isPassesFeatureEnabled(bid);
    res.json({ passes: result.rows, stats: stats.rows[0], feature_enabled });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes — create pass manually (staff)
// ============================================================
router.post('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!(await isPassesFeatureEnabled(bid))) {
      return res.status(403).json({ error: 'Les abonnements sont désactivés. Activez-les dans Paramètres > Abonnements.' });
    }
    const {
      pass_template_id,
      service_id, name, sessions_total, price_cents, validity_days,
      buyer_name, buyer_email, expires_at: body_expires_at
    } = req.body;

    let resolvedServiceId, resolvedName, resolvedSessionsTotal, resolvedPriceCents, resolvedValidityDays;

    if (pass_template_id) {
      // Load from template
      const tplResult = await queryWithRLS(bid,
        'SELECT * FROM pass_templates WHERE id = $1 AND business_id = $2 AND is_active = true',
        [pass_template_id, bid]
      );
      if (tplResult.rows.length === 0) return res.status(400).json({ error: 'Modèle introuvable ou inactif' });
      const tpl = tplResult.rows[0];
      resolvedServiceId = tpl.service_id;
      resolvedName = tpl.name;
      resolvedSessionsTotal = tpl.sessions_count;
      resolvedPriceCents = tpl.price_cents;
      resolvedValidityDays = tpl.validity_days;
    } else {
      // Manual fields
      if (!name || !sessions_total || !price_cents) {
        return res.status(400).json({ error: 'Champs requis: name, sessions_total, price_cents (ou pass_template_id)' });
      }
      if (service_id) {
        const svc = await queryWithRLS(bid, 'SELECT 1 FROM services WHERE id = $1 AND business_id = $2', [service_id, bid]);
        if (svc.rows.length === 0) return res.status(400).json({ error: 'Service introuvable' });
      }
      resolvedServiceId = service_id || null;
      resolvedName = name;
      resolvedSessionsTotal = sessions_total;
      resolvedPriceCents = price_cents;
      resolvedValidityDays = validity_days || null;
    }

    // Generate unique code (retry on collision)
    let code, codeIsUnique = false;
    for (let i = 0; i < 10; i++) {
      code = generateCode();
      const exists = await queryWithRLS(bid, 'SELECT 1 FROM passes WHERE code = $1', [code]);
      if (exists.rows.length === 0) { codeIsUnique = true; break; }
    }
    if (!codeIsUnique) return res.status(500).json({ error: 'Impossible de générer un code unique. Veuillez réessayer.' });

    const expires_at = body_expires_at
      ? new Date(body_expires_at)
      : resolvedValidityDays
        ? new Date(Date.now() + resolvedValidityDays * 86400000)
        : null;

    const result = await transactionWithRLS(bid, async (client) => {
      const pass = await client.query(
        `INSERT INTO passes (business_id, pass_template_id, service_id, code, name,
          sessions_total, sessions_remaining, price_cents, buyer_name, buyer_email,
          expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [bid, pass_template_id || null, resolvedServiceId, code, resolvedName,
         resolvedSessionsTotal, resolvedPriceCents,
         buyer_name || null, buyer_email || null,
         expires_at, req.user.id]
      );

      await client.query(
        `INSERT INTO pass_transactions (pass_id, business_id, sessions, type, note, created_by)
         VALUES ($1, $2, $3, 'purchase', 'Création manuelle', $4)`,
        [pass.rows[0].id, bid, resolvedSessionsTotal, req.user.id]
      );

      return pass.rows[0];
    });

    // Send email to buyer if provided
    if (buyer_email) {
      try {
        const bizResult = await queryWithRLS(bid, 'SELECT name, slug, theme, email FROM businesses WHERE id = $1', [bid]);
        // Fetch service name for the email
        let serviceName = '';
        if (result.service_id) {
          const svcR = await queryWithRLS(bid, 'SELECT name FROM services WHERE id = $1', [result.service_id]);
          if (svcR.rows.length) serviceName = svcR.rows[0].name;
        }
        const { sendPassPurchaseEmail } = require('../../services/email');
        await sendPassPurchaseEmail({ pass: { ...result, service_name: serviceName }, business: bizResult.rows[0] });
      } catch (emailErr) {
        console.error('[PASS] Email failed:', emailErr.message);
      }
    }

    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/passes/:id — cancel pass (active → cancelled only)
// ============================================================
router.patch('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { status } = req.body;

    if (status !== 'cancelled') {
      return res.status(400).json({ error: 'Seule l\'annulation est autorisée via cette route' });
    }

    const result = await queryWithRLS(bid,
      `UPDATE passes SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND business_id = $2 AND status = 'active' RETURNING *`,
      [id, bid]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Pass introuvable ou déjà non-actif' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/passes/:id/debit — debit 1 session
// ============================================================
router.post('/:id/debit', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { booking_id, note } = req.body;

    const result = await transactionWithRLS(bid, async (client) => {
      const p = await client.query(
        'SELECT * FROM passes WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [id, bid]
      );
      if (p.rows.length === 0) throw Object.assign(new Error('Pass introuvable'), { status: 404 });
      const pass = p.rows[0];

      if (pass.status !== 'active') throw Object.assign(new Error('Ce pass n\'est plus actif'), { status: 400 });
      if (pass.sessions_remaining <= 0) throw Object.assign(new Error('Aucune séance restante'), { status: 400 });

      const newRemaining = pass.sessions_remaining - 1;
      const newStatus = newRemaining === 0 ? 'used' : 'active';

      await client.query(
        `UPDATE passes SET sessions_remaining = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [newRemaining, newStatus, id]
      );

      await client.query(
        `INSERT INTO pass_transactions (pass_id, business_id, booking_id, sessions, type, note, created_by)
         VALUES ($1, $2, $3, -1, 'debit', $4, $5)`,
        [id, bid, booking_id || null, note || null, req.user.id]
      );

      return { ...pass, sessions_remaining: newRemaining, status: newStatus };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// POST /api/passes/:id/refund — refund 1 session
// ============================================================
router.post('/:id/refund', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { booking_id, note } = req.body;

    const result = await transactionWithRLS(bid, async (client) => {
      const p = await client.query(
        'SELECT * FROM passes WHERE id = $1 AND business_id = $2 FOR UPDATE',
        [id, bid]
      );
      if (p.rows.length === 0) throw Object.assign(new Error('Pass introuvable'), { status: 404 });
      const pass = p.rows[0];

      if (pass.sessions_remaining >= pass.sessions_total) {
        throw Object.assign(new Error('Impossible de rembourser: toutes les séances sont déjà disponibles'), { status: 400 });
      }

      const newRemaining = pass.sessions_remaining + 1;
      const newStatus = pass.status === 'used' ? 'active' : pass.status;

      await client.query(
        `UPDATE passes SET sessions_remaining = $1, status = $2, updated_at = NOW()
         WHERE id = $3`,
        [newRemaining, newStatus, id]
      );

      await client.query(
        `INSERT INTO pass_transactions (pass_id, business_id, booking_id, sessions, type, note, created_by)
         VALUES ($1, $2, $3, 1, 'refund', $4, $5)`,
        [id, bid, booking_id || null, note || 'Remboursement séance', req.user.id]
      );

      return { ...pass, sessions_remaining: newRemaining, status: newStatus };
    });

    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// DELETE /api/passes/:id — hard delete pass + transactions
// ============================================================
router.delete('/:id', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;

    const result = await transactionWithRLS(bid, async (client) => {
      // Delete transactions first (FK constraint)
      await client.query('DELETE FROM pass_transactions WHERE pass_id = $1 AND business_id = $2', [id, bid]);
      const del = await client.query('DELETE FROM passes WHERE id = $1 AND business_id = $2 RETURNING id, code', [id, bid]);
      if (del.rows.length === 0) throw Object.assign(new Error('Pass introuvable'), { status: 404 });
      return del.rows[0];
    });

    res.json({ deleted: true, code: result.code });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
