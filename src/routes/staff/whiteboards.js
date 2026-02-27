const router = require('express').Router();
const crypto = require('crypto');
const { query, queryWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');
const { sendEmail } = require('../../services/email');

router.use(requireAuth);

// ============================================================
// LIST whiteboards (by client or booking)
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const { client_id, booking_id } = req.query;
    let sql = `SELECT id, title, client_id, booking_id, practitioner_id,
                      bg_type, created_at, updated_at
               FROM whiteboards
               WHERE business_id = $1 AND deleted_at IS NULL`;
    const params = [req.businessId];

    if (client_id) { sql += ` AND client_id = $${params.length + 1}`; params.push(client_id); }
    if (booking_id) { sql += ` AND booking_id = $${params.length + 1}`; params.push(booking_id); }

    sql += ` ORDER BY created_at DESC LIMIT 50`;
    const result = await queryWithRLS(req.businessId, sql, params);
    res.json({ whiteboards: result.rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET single whiteboard (full data)
// ============================================================
router.get('/:id', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT w.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              p.display_name AS practitioner_name,
              b.start_at AS booking_start, b.end_at AS booking_end,
              s.name AS service_name
       FROM whiteboards w
       LEFT JOIN clients c ON c.id = w.client_id
       LEFT JOIN practitioners p ON p.id = w.practitioner_id
       LEFT JOIN bookings b ON b.id = w.booking_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE w.id = $1 AND w.business_id = $2 AND w.deleted_at IS NULL`,
      [req.params.id, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Whiteboard introuvable' });
    res.json({ whiteboard: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// CREATE whiteboard
// ============================================================
router.post('/', async (req, res, next) => {
  try {
    const { client_id, booking_id, practitioner_id, title, consent_confirmed } = req.body;

    if (!consent_confirmed) {
      return res.status(400).json({ error: 'Le consentement RGPD est requis pour créer un whiteboard' });
    }

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO whiteboards (business_id, client_id, booking_id, practitioner_id, title, consent_confirmed, created_by)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, title, created_at`,
      [req.businessId, client_id || null, booking_id || null, practitioner_id || null, title || 'Whiteboard', req.user.id]
    );

    res.status(201).json({ whiteboard: result.rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// SAVE whiteboard (canvas + text layers)
// ============================================================
router.put('/:id', async (req, res, next) => {
  try {
    const { canvas_data, text_layers, bg_type, bg_image_url, title } = req.body;

    // Validate canvas_data size (max 10MB base64)
    if (canvas_data && canvas_data.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Canvas trop volumineux (max 10 Mo)' });
    }

    const result = await queryWithRLS(req.businessId,
      `UPDATE whiteboards SET
        canvas_data = COALESCE($1, canvas_data),
        text_layers = COALESCE($2, text_layers),
        bg_type = COALESCE($3, bg_type),
        bg_image_url = COALESCE($4, bg_image_url),
        title = COALESCE($5, title),
        updated_at = NOW()
       WHERE id = $6 AND business_id = $7 AND deleted_at IS NULL
       RETURNING id, updated_at`,
      [canvas_data || null, text_layers ? JSON.stringify(text_layers) : null,
       bg_type || null, bg_image_url || null, title || null,
       req.params.id, req.businessId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Whiteboard introuvable' });
    res.json({ saved: true, updated_at: result.rows[0].updated_at });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE whiteboard (soft delete — GDPR)
// ============================================================
router.delete('/:id', async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `UPDATE whiteboards SET deleted_at = NOW(), canvas_data = NULL, text_layers = '[]', bg_image_url = NULL
       WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// GENERATE SECURE LINK (GDPR-compliant sharing)
// ============================================================
router.post('/:id/share', async (req, res, next) => {
  try {
    const { expires_days = 7, max_accesses = 10 } = req.body;
    const token = crypto.randomBytes(32).toString('hex');

    // Verify whiteboard exists
    const wb = await queryWithRLS(req.businessId,
      `SELECT id, client_id FROM whiteboards WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [req.params.id, req.businessId]
    );
    if (wb.rows.length === 0) return res.status(404).json({ error: 'Whiteboard introuvable' });

    const expiresAt = new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000).toISOString();

    await query(
      `INSERT INTO whiteboard_links (whiteboard_id, token, expires_at, max_accesses)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, token, expiresAt, max_accesses]
    );

    const baseUrl = process.env.BASE_URL || 'https://genda-qgm2.onrender.com';
    const shareUrl = `${baseUrl}/wb/${token}`;

    res.json({ url: shareUrl, token, expires_at: expiresAt });
  } catch (err) { next(err); }
});

// ============================================================
// SEND SECURE LINK BY EMAIL
// ============================================================
router.post('/:id/send', async (req, res, next) => {
  try {
    const { email, expires_days = 7 } = req.body;

    // Get whiteboard + client info
    const wb = await queryWithRLS(req.businessId,
      `SELECT w.id, w.title, c.full_name AS client_name, c.email AS client_email,
              biz.name AS business_name
       FROM whiteboards w
       LEFT JOIN clients c ON c.id = w.client_id
       CROSS JOIN businesses biz
       WHERE w.id = $1 AND w.business_id = $2 AND biz.id = $2 AND w.deleted_at IS NULL`,
      [req.params.id, req.businessId]
    );
    if (wb.rows.length === 0) return res.status(404).json({ error: 'Whiteboard introuvable' });

    const to = email || wb.rows[0].client_email;
    if (!to) return res.status(400).json({ error: 'Aucune adresse email' });

    // Generate secure link
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000).toISOString();
    await query(
      `INSERT INTO whiteboard_links (whiteboard_id, token, expires_at, max_accesses) VALUES ($1, $2, $3, 10)`,
      [req.params.id, token, expiresAt]
    );

    const baseUrl = process.env.BASE_URL || 'https://genda-qgm2.onrender.com';
    const shareUrl = `${baseUrl}/wb/${token}`;

    await sendEmail({
      to,
      subject: `${wb.rows[0].business_name} — Document partagé`,
      text: `Bonjour ${wb.rows[0].client_name || ''},\n\n${wb.rows[0].business_name} vous a partagé un document.\n\nAccédez-y ici (lien sécurisé, valable ${expires_days} jours) :\n${shareUrl}\n\nCordialement,\n${wb.rows[0].business_name}`,
      html: `<p>Bonjour ${wb.rows[0].client_name || ''},</p>
<p><strong>${wb.rows[0].business_name}</strong> vous a partagé un document.</p>
<p><a href="${shareUrl}" style="display:inline-block;padding:12px 24px;background:#0D7377;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Voir le document</a></p>
<p style="font-size:12px;color:#999">Ce lien sécurisé expire dans ${expires_days} jours. Aucune pièce jointe n'est envoyée par email pour protéger vos données.</p>`
    });

    res.json({ sent: true, to, expires_at: expiresAt });
  } catch (err) { next(err); }
});

module.exports = router;
