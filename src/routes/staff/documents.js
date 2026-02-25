const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
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

    const result = await queryWithRLS(bid,
      `UPDATE document_templates SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        service_id = $3,
        subject = COALESCE($4, subject),
        content_html = COALESCE($5, content_html),
        form_fields = COALESCE($6::jsonb, form_fields),
        send_days_before = COALESCE($7, send_days_before),
        is_active = COALESCE($8, is_active),
        language = COALESCE($9, language),
        updated_at = NOW()
       WHERE id = $10 AND business_id = $11
       RETURNING *`,
      [name, type, service_id !== undefined ? service_id || null : undefined,
       subject, content_html,
       form_fields ? JSON.stringify(form_fields) : null,
       send_days_before, is_active, language,
       req.params.id, bid]
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
    await queryWithRLS(bid,
      `DELETE FROM document_templates WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
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
