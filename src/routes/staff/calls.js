const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

router.use(requireAuth);

// ===== TWILIO PROVISIONING =====

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return require('twilio')(sid, token);
}

// GET /api/calls/available-numbers?country=BE
// Search available phone numbers in a country
router.get('/available-numbers', requireOwner, async (req, res, next) => {
  try {
    const client = getTwilioClient();
    if (!client) return res.status(503).json({ error: 'Twilio non configuré. Contactez le support.' });

    const country = (req.query.country || 'BE').toUpperCase();
    const type = req.query.type || 'local'; // local, mobile, tollFree

    const search = type === 'mobile'
      ? client.availablePhoneNumbers(country).mobile
      : client.availablePhoneNumbers(country).local;

    const numbers = await search.list({
      voiceEnabled: true,
      smsEnabled: true,
      limit: 5
    });

    res.json({
      numbers: numbers.map(n => ({
        phone: n.phoneNumber,
        friendly: n.friendlyName,
        locality: n.locality || null,
        region: n.region || null,
        capabilities: {
          voice: n.capabilities.voice,
          sms: n.capabilities.SMS
        }
      }))
    });
  } catch (err) {
    if (err.code === 21452) return res.json({ numbers: [], message: 'Aucun numéro disponible pour ce pays.' });
    next(err);
  }
});

// POST /api/calls/activate
// Provision a Twilio number and configure webhooks
router.post('/activate', requireOwner, async (req, res, next) => {
  try {
    const client = getTwilioClient();
    if (!client) return res.status(503).json({ error: 'Twilio non configuré. Contactez le support.' });

    const bid = req.businessId;
    const { phone_number, country } = req.body;

    if (!phone_number && !country) {
      return res.status(400).json({ error: 'phone_number ou country requis' });
    }

    // Check not already activated
    const existing = await queryWithRLS(bid,
      `SELECT twilio_number FROM call_settings WHERE business_id = $1 AND twilio_number IS NOT NULL`,
      [bid]
    );
    if (existing.rows.length > 0 && existing.rows[0].twilio_number) {
      return res.status(409).json({ error: 'Un numéro est déjà actif', number: existing.rows[0].twilio_number });
    }

    const baseUrl = process.env.APP_BASE_URL || `https://${req.headers.host}`;

    let purchased;
    if (phone_number) {
      // Buy specific number
      purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: phone_number,
        voiceUrl: `${baseUrl}/webhooks/twilio/voice/incoming`,
        voiceMethod: 'POST',
        statusCallback: `${baseUrl}/webhooks/twilio/voice/status`,
        statusCallbackMethod: 'POST',
        smsUrl: `${baseUrl}/webhooks/twilio/sms/status`,
        friendlyName: `Genda - ${bid.slice(0, 8)}`
      });
    } else {
      // Auto-pick first available in country
      const countryCode = (country || 'BE').toUpperCase();
      const available = await client.availablePhoneNumbers(countryCode).local.list({
        voiceEnabled: true, smsEnabled: true, limit: 1
      });
      if (available.length === 0) {
        return res.status(404).json({ error: 'Aucun numéro disponible pour ce pays' });
      }
      purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: available[0].phoneNumber,
        voiceUrl: `${baseUrl}/webhooks/twilio/voice/incoming`,
        voiceMethod: 'POST',
        statusCallback: `${baseUrl}/webhooks/twilio/voice/status`,
        statusCallbackMethod: 'POST',
        smsUrl: `${baseUrl}/webhooks/twilio/sms/status`,
        friendlyName: `Genda - ${bid.slice(0, 8)}`
      });
    }

    // Upsert call_settings
    const result = await queryWithRLS(bid,
      `INSERT INTO call_settings (business_id, twilio_number, twilio_number_sid, filter_mode, sms_after_call)
       VALUES ($1, $2, $3, 'soft', true)
       ON CONFLICT (business_id) DO UPDATE SET
         twilio_number = $2,
         twilio_number_sid = $3,
         filter_mode = CASE WHEN call_settings.filter_mode = 'off' THEN 'soft' ELSE call_settings.filter_mode END,
         updated_at = NOW()
       RETURNING *`,
      [bid, purchased.phoneNumber, purchased.sid]
    );

    res.status(201).json({
      activated: true,
      number: purchased.phoneNumber,
      friendly: purchased.friendlyName,
      settings: result.rows[0]
    });
  } catch (err) {
    console.error('Twilio provisioning error:', err);
    if (err.code === 21422) return res.status(400).json({ error: 'Numéro invalide ou indisponible' });
    next(err);
  }
});

// POST /api/calls/deactivate
// Release the Twilio number
router.post('/deactivate', requireOwner, async (req, res, next) => {
  try {
    const client = getTwilioClient();
    if (!client) return res.status(503).json({ error: 'Twilio non configuré' });

    const bid = req.businessId;

    const existing = await queryWithRLS(bid,
      `SELECT twilio_number_sid FROM call_settings WHERE business_id = $1`,
      [bid]
    );

    if (existing.rows.length > 0 && existing.rows[0].twilio_number_sid) {
      // Release number from Twilio
      await client.incomingPhoneNumbers(existing.rows[0].twilio_number_sid).remove();
    }

    // Clear from DB
    await queryWithRLS(bid,
      `UPDATE call_settings SET
        twilio_number = NULL,
        twilio_number_sid = NULL,
        filter_mode = 'off',
        updated_at = NOW()
       WHERE business_id = $1`,
      [bid]
    );

    res.json({ deactivated: true });
  } catch (err) {
    console.error('Twilio deactivation error:', err);
    next(err);
  }
});

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
    const { filter_mode, forward_default_phone, sms_after_call,
            vacation_until, vacation_message_fr,
            vacation_redirect_phone, vacation_redirect_name,
            custom_message_fr, custom_sms_fr,
            repeat_caller_threshold, repeat_caller_window_min } = req.body;

    const result = await queryWithRLS(bid,
      `INSERT INTO call_settings (business_id, filter_mode, forward_default_phone, sms_after_call,
        vacation_until, vacation_message_fr,
        vacation_redirect_phone, vacation_redirect_name,
        custom_message_fr, custom_sms_fr,
        repeat_caller_threshold, repeat_caller_window_min)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (business_id) DO UPDATE SET
        filter_mode = COALESCE($2, call_settings.filter_mode),
        forward_default_phone = COALESCE($3, call_settings.forward_default_phone),
        sms_after_call = COALESCE($4, call_settings.sms_after_call),
        vacation_until = $5,
        vacation_message_fr = $6,
        vacation_redirect_phone = $7,
        vacation_redirect_name = $8,
        custom_message_fr = $9,
        custom_sms_fr = $10,
        repeat_caller_threshold = COALESCE($11, call_settings.repeat_caller_threshold),
        repeat_caller_window_min = COALESCE($12, call_settings.repeat_caller_window_min),
        updated_at = NOW()
       RETURNING *`,
      [bid, filter_mode, forward_default_phone, sms_after_call,
       vacation_until || null, vacation_message_fr || null,
       vacation_redirect_phone || null, vacation_redirect_name || null,
       custom_message_fr || null, custom_sms_fr || null,
       repeat_caller_threshold, repeat_caller_window_min]
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

// ===== BLACKLIST =====

// GET /api/calls/blacklist
router.get('/blacklist', async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT * FROM call_blacklist WHERE business_id = $1 ORDER BY created_at DESC`,
      [req.businessId]
    );
    res.json({ blacklist: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/calls/blacklist
router.post('/blacklist', async (req, res, next) => {
  try {
    const { phone_e164, label, reason } = req.body;
    if (!phone_e164) return res.status(400).json({ error: 'phone_e164 requis' });

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO call_blacklist (business_id, phone_e164, label, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.businessId, phone_e164, label || null, reason || 'manual']
    );
    res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/calls/blacklist/:id
router.delete('/blacklist/:id', async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM call_blacklist WHERE id = $1 AND business_id = $2`,
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
