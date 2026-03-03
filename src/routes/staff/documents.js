const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// ============================================================
// GET /api/documents — list templates
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { service_id } = req.query;

    let sql = `SELECT dt.*, s.name AS service_name,
      (SELECT COUNT(*) FROM pre_rdv_sends ps WHERE ps.template_id = dt.id AND ps.status = 'sent') AS sends_count,
      (SELECT COUNT(*) FROM pre_rdv_sends ps WHERE ps.template_id = dt.id AND ps.status = 'completed') AS completed_count
      FROM document_templates dt
      LEFT JOIN services s ON s.id = dt.service_id
      WHERE dt.business_id = $1`;
    const params = [bid];

    if (service_id) {
      sql += ` AND (dt.service_id = $2 OR dt.service_id IS NULL)`;
      params.push(service_id);
    }

    sql += ` ORDER BY dt.sort_order, dt.created_at`;
    const result = await queryWithRLS(bid, sql, params);
    res.json({ templates: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/documents — create template
// ============================================================
router.post('/', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { name, type, service_id, subject, content_html, form_fields,
            send_days_before, language } = req.body;

    if (!name || !content_html) {
      return res.status(400).json({ error: 'Nom et contenu requis' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO document_templates
        (business_id, service_id, name, type, subject, content_html, form_fields,
         send_days_before, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING *`,
      [bid, service_id || null, name, type || 'info', subject || null,
       content_html, JSON.stringify(form_fields || []),
       send_days_before || 2, language || 'fr']
    );

    res.status(201).json({ template: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/documents/:id — update template
// ============================================================
router.patch('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { name, type, service_id, subject, content_html, form_fields,
            send_days_before, is_active, language } = req.body;

    // Build dynamic SET to avoid setting service_id to undefined/null when not in body
    const sets = [];
    const params = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx}`); params.push(name); idx++; }
    if (type !== undefined) { sets.push(`type = $${idx}`); params.push(type); idx++; }
    if ('service_id' in req.body) { sets.push(`service_id = $${idx}`); params.push(service_id || null); idx++; }
    if (subject !== undefined) { sets.push(`subject = $${idx}`); params.push(subject); idx++; }
    if (content_html !== undefined) { sets.push(`content_html = $${idx}`); params.push(content_html); idx++; }
    if (form_fields !== undefined) { sets.push(`form_fields = $${idx}::jsonb`); params.push(JSON.stringify(form_fields)); idx++; }
    if (send_days_before !== undefined) { sets.push(`send_days_before = $${idx}`); params.push(send_days_before); idx++; }
    if (is_active !== undefined) { sets.push(`is_active = $${idx}`); params.push(is_active); idx++; }
    if (language !== undefined) { sets.push(`language = $${idx}`); params.push(language); idx++; }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
    }

    sets.push('updated_at = NOW()');
    params.push(req.params.id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE document_templates SET ${sets.join(', ')}
       WHERE id = $${idx} AND business_id = $${idx + 1}
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Template introuvable' });
    res.json({ template: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/documents/:id — delete template
// ============================================================
router.delete('/:id', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    // V13-006: Wrap both DELETEs in transaction for atomicity
    await transactionWithRLS(bid, async (client) => {
      await client.query(`DELETE FROM pre_rdv_sends WHERE template_id = $1 AND business_id = $2`, [req.params.id, bid]);
      await client.query(`DELETE FROM document_templates WHERE id = $1 AND business_id = $2`, [req.params.id, bid]);
    });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/documents/sends — list sent documents with status
// ============================================================
router.get('/sends', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { status, booking_id } = req.query;

    let sql = `SELECT ps.*, dt.name AS template_name, dt.type AS template_type,
      c.full_name AS client_name, bk.start_at
      FROM pre_rdv_sends ps
      JOIN document_templates dt ON dt.id = ps.template_id
      LEFT JOIN clients c ON c.id = ps.client_id
      LEFT JOIN bookings bk ON bk.id = ps.booking_id
      WHERE ps.business_id = $1`;
    const params = [bid];
    let idx = 2;

    if (status) { sql += ` AND ps.status = $${idx}`; params.push(status); idx++; }
    if (booking_id) { sql += ` AND ps.booking_id = $${idx}`; params.push(booking_id); idx++; }

    sql += ` ORDER BY ps.created_at DESC LIMIT 100`;
    const result = await queryWithRLS(bid, sql, params);
    res.json({ sends: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
