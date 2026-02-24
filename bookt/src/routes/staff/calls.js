const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// ===== CALL SETTINGS =====

// GET /api/calls/settings
router.get('/settings', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM call_settings WHERE business_id = $1`,
      [req.businessId]
    );
    res.json({ settings: result.rows[0] || null });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/calls/settings
router.patch('/settings', requireOwner, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { filter_mode, forward_default_phone, allow_keypress_urgent,
            urgent_target_phone, sms_after_call, voicemail_enabled,
            voicemail_text_fr, voicemail_text_nl } = req.body;

    // Upsert
    const result = await queryWithRLS(bid,
      `INSERT INTO call_settings (business_id, filter_mode, forward_default_phone,
        allow_keypress_urgent, urgent_target_phone, sms_after_call,
        voicemail_enabled, voicemail_text_fr, voicemail_text_nl)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (business_id) DO UPDATE SET
        filter_mode = COALESCE($2, call_settings.filter_mode),
        forward_default_phone = COALESCE($3, call_settings.forward_default_phone),
        allow_keypress_urgent = COALESCE($4, call_settings.allow_keypress_urgent),
        urgent_target_phone = COALESCE($5, call_settings.urgent_target_phone),
        sms_after_call = COALESCE($6, call_settings.sms_after_call),
        voicemail_enabled = COALESCE($7, call_settings.voicemail_enabled),
        voicemail_text_fr = COALESCE($8, call_settings.voicemail_text_fr),
        voicemail_text_nl = COALESCE($9, call_settings.voicemail_text_nl),
        updated_at = NOW()
       RETURNING *`,
      [bid, filter_mode, forward_default_phone, allow_keypress_urgent,
       urgent_target_phone, sms_after_call, voicemail_enabled,
       voicemail_text_fr, voicemail_text_nl]
    );

    res.json({ settings: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ===== WHITELIST =====

// GET /api/calls/whitelist
router.get('/whitelist', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM call_whitelist WHERE business_id = $1 ORDER BY label`,
      [req.businessId]
    );
    res.json({ whitelist: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/calls/whitelist
router.post('/whitelist', async (req, res, next) => {
  try {
    const { phone_e164, label } = req.body;
    if (!phone_e164) return res.status(400).json({ error: 'phone_e164 requis' });

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO call_whitelist (business_id, phone_e164, label)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.businessId, phone_e164, label || null]
    );
    res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/calls/whitelist/:id
router.patch('/whitelist/:id', async (req, res, next) => {
  try {
    const { phone_e164, label, is_active } = req.body;
    const result = await queryWithRLS(req.businessId,
      `UPDATE call_whitelist SET
        phone_e164 = COALESCE($1, phone_e164),
        label = COALESCE($2, label),
        is_active = COALESCE($3, is_active)
       WHERE id = $4 AND business_id = $5 RETURNING *`,
      [phone_e164, label, is_active, req.params.id, req.businessId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entrée introuvable' });
    res.json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/calls/whitelist/:id
router.delete('/whitelist/:id', async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM call_whitelist WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ===== CALL LOGS =====

// GET /api/calls/logs
// UI: Dashboard > Appels (table with date, number, action, result, duration)
router.get('/logs', async (req, res, next) => {
  try {
    const { from, to, limit } = req.query;
    const bid = req.businessId;

    let sql = `
      SELECT cl.*, b.public_token AS booking_token
      FROM call_logs cl
      LEFT JOIN bookings b ON b.id = cl.booking_id
      WHERE cl.business_id = $1`;
    const params = [bid];
    let idx = 2;

    if (from) { sql += ` AND cl.created_at >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND cl.created_at <= $${idx}`; params.push(to); idx++; }

    sql += ` ORDER BY cl.created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit) || 50);

    const result = await queryWithRLS(bid, sql, params);

    // Stats summary
    const stats = await queryWithRLS(bid,
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE action = 'sent_sms') AS filtered,
        COUNT(*) FILTER (WHERE action = 'whitelist_pass') AS vip,
        COUNT(*) FILTER (WHERE action = 'urgent_key') AS urgent,
        COUNT(*) FILTER (WHERE booking_id IS NOT NULL) AS converted
       FROM call_logs WHERE business_id = $1
       AND created_at >= DATE_TRUNC('month', NOW())`,
      [bid]
    );

    res.json({
      logs: result.rows.map(l => ({
        ...l,
        from_phone_masked: maskPhone(l.from_phone)
      })),
      stats: stats.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

function maskPhone(phone) {
  if (!phone || phone.length < 8) return phone;
  return phone.slice(0, -4).replace(/\d(?=\d{3})/g, (m, i) => i > 4 ? '*' : m) + phone.slice(-2);
}

module.exports = router;
