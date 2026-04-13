const router = require('express').Router();
const { query, pool } = require('../../services/db');

// Twilio request signature validation middleware
function validateTwilioSignature(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[TWILIO] Auth token not configured in production!');
      return res.status(503).json({ error: 'Service misconfigured' });
    }
    return next();
  }

  try {
    const twilio = require('twilio');
    const signature = req.headers['x-twilio-signature'];
    const url = `${process.env.APP_BASE_URL || 'https://' + req.headers.host}${req.originalUrl}`;
    const params = req.body || {};
    const valid = signature && twilio.validateRequest(authToken, signature, url, params);
    if (!valid) {
      console.warn('[TWILIO] Invalid signature for', req.originalUrl, '| url:', url, '| sig:', signature ? 'present' : 'missing', '| body keys:', Object.keys(params).join(','));
      // Reject invalid signatures in production — no bypass allowed
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).send('Forbidden');
      }
      console.warn('[TWILIO] Bypassing signature validation (non-production)');
    }
  } catch (e) {
    console.warn('[TWILIO] Signature validation error:', e.message);
    return res.status(403).json({ error: 'Signature validation failed' });
  }
  next();
}

router.use(validateTwilioSignature);

// POST /webhooks/twilio/sms/status
router.post('/sms/status', (req, res) => res.sendStatus(200));

// ============================================================
// POST /webhooks/twilio/sms/inbound — receive client SMS replies
// ============================================================

// Rate limiter: max 3 replies per phone per hour (prevents billing abuse)
const _smsRateMap = new Map();
const SMS_RATE_MAX = 3;
const SMS_RATE_WINDOW = 3600000; // 1 hour

function checkSmsRate(phone) {
  const now = Date.now();
  const entry = _smsRateMap.get(phone);
  if (!entry) { _smsRateMap.set(phone, { count: 1, firstAt: now }); return true; }
  if (now - entry.firstAt > SMS_RATE_WINDOW) { _smsRateMap.set(phone, { count: 1, firstAt: now }); return true; }
  entry.count++;
  return entry.count <= SMS_RATE_MAX;
}
// Cleanup stale entries every 10 min
setInterval(() => {
  const cutoff = Date.now() - SMS_RATE_WINDOW;
  for (const [k, v] of _smsRateMap) { if (v.firstAt < cutoff) _smsRateMap.delete(k); }
}, 600000);

const CONFIRM_RE = /^(oui|yes|ok|confirm|confirmer|ja|1)$/i;
const CANCEL_RE = /^(non|no|annuler|cancel|nee|0)$/i;
// Carrier-level STOP keywords (Twilio also handles these via Advanced Opt-Out, but we mirror locally so consent_sms reflects reality)
const STOP_RE = /^(stop|stopall|unsubscribe|cancel sub|end|quit|arret|arr[êe]t)$/i;
const START_RE = /^(start|unstop|yes|reabonner)$/i;

function twiml(c) { return `<?xml version="1.0" encoding="UTF-8"?><Response>${c}</Response>`; }

router.post('/sms/inbound', async (req, res) => {
  const from = (req.body.From || '').trim();
  const body = (req.body.Body || '').trim();
  const normalized = body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  console.log(`[SMS INBOUND] From: ***${from.slice(-4)} (${body.length} chars)`);

  // Rate limit — silent response (no outbound SMS charged)
  if (!checkSmsRate(from)) {
    console.warn(`[SMS INBOUND] Rate limited: ***${from.slice(-4)}`);
    return res.type('text/xml').send('<Response/>');
  }

  try {
    // STOP / START — RGPD opt-out tracked locally so future sendSMS auto-skips via consent_sms.
    if (STOP_RE.test(normalized)) {
      try {
        await query(`UPDATE clients SET consent_sms = false, updated_at = NOW() WHERE phone = $1`, [from]);
        console.log(`[SMS INBOUND] STOP from ***${from.slice(-4)} — consent_sms set to false`);
      } catch (e) { console.warn('[SMS INBOUND] STOP update error:', e.message); }
      return res.type('text/xml').send('<Response/>'); // Twilio answers with its own opt-out confirmation
    }
    if (START_RE.test(normalized)) {
      try {
        await query(`UPDATE clients SET consent_sms = true, updated_at = NOW() WHERE phone = $1`, [from]);
        console.log(`[SMS INBOUND] START from ***${from.slice(-4)} — consent_sms set to true`);
      } catch (e) { console.warn('[SMS INBOUND] START update error:', e.message); }
      // Don't fall through to CONFIRM_RE — START intent is opt-in, not booking confirm
      return res.type('text/xml').send('<Response/>');
    }
    if (CONFIRM_RE.test(normalized)) {
      // Find most recent pending booking for this phone
      const pending = await query(
        `SELECT b.id, b.public_token, b.business_id, b.group_id, b.client_id,
                b.service_id, b.practitioner_id, b.start_at, b.end_at
         FROM bookings b
         JOIN clients c ON c.id = b.client_id
         WHERE c.phone = $1 AND b.status = 'pending'
           AND b.confirmation_expires_at > NOW()
         ORDER BY b.created_at DESC LIMIT 1`,
        [from]
      );

      if (pending.rows.length === 0) {
        return res.type('text/xml').send(twiml('<Message>Aucun rendez-vous en attente de confirmation.</Message>'));
      }

      const bk = pending.rows[0];

      // Atomic confirm (same logic as POST /confirm-booking)
      const txClient = await pool.connect();
      let sibConfirmed = { rows: [] };
      try {
        await txClient.query('BEGIN');
        const upd = await txClient.query(
          `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
           WHERE id = $1 AND status = 'pending'
           RETURNING id`,
          [bk.id]
        );
        if (upd.rows.length === 0) {
          await txClient.query('ROLLBACK');
          return res.type('text/xml').send(twiml('<Message>Ce rendez-vous ne peut plus être confirmé.</Message>'));
        }
        // Confirm group siblings
        sibConfirmed = await txClient.query(
          `UPDATE bookings SET status = 'confirmed', confirmation_expires_at = NULL, locked = true, updated_at = NOW()
           WHERE group_id = (SELECT group_id FROM bookings WHERE id = $1 AND group_id IS NOT NULL)
             AND id != $1 AND status = 'pending'
           RETURNING id`,
          [bk.id]
        );
        await txClient.query('COMMIT');
      } catch (txErr) {
        await txClient.query('ROLLBACK').catch(() => {});
        throw txErr;
      } finally {
        txClient.release();
      }

      // SSE + calendar sync (non-blocking)
      try {
        const { broadcast } = require('../../services/sse');
        broadcast(bk.business_id, 'booking_update', { action: 'confirmed', source: 'sms_reply' });
      } catch (_) {}
      try {
        const { calSyncPush } = require('../staff/bookings-helpers');
        calSyncPush(bk.business_id, bk.id);
        for (const sib of (sibConfirmed?.rows || [])) { calSyncPush(bk.business_id, sib.id); }
      } catch (_) {}

      // Queue confirmation email (non-blocking)
      (async () => {
        try {
          const fullBk = await query(
            `SELECT b.*, CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                    s.category AS service_category,
                    COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                    COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                    p.display_name AS practitioner_name,
                    c.full_name AS client_name, c.email AS client_email,
                    biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address, biz.theme AS biz_theme, biz.settings AS biz_settings
             FROM bookings b LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             JOIN practitioners p ON p.id = b.practitioner_id
             LEFT JOIN clients c ON c.id = b.client_id
             JOIN businesses biz ON biz.id = b.business_id
             WHERE b.id = $1`, [bk.id]
          );
          if (fullBk.rows[0]?.client_email) {
            const row = fullBk.rows[0];
            let groupServices = null;
            if (row.group_id) {
              const grp = await query(
                `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.discount_pct, b.end_at, b.practitioner_id, p.display_name AS practitioner_name FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id LEFT JOIN practitioners p ON p.id = b.practitioner_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
                [row.group_id, row.business_id]
              );
              if (grp.rows.length > 1) {
                grp.rows.forEach(r => { if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); } });
                groupServices = grp.rows;
              }
            }
            const { sendBookingConfirmation } = require('../../services/email');
            // service_price_cents = raw catalog; booked_price_cents = post-LM/merchant-set. Template uses booked_price_cents when present.
            await sendBookingConfirmation({
              booking: { public_token: row.public_token, start_at: row.start_at, end_at: groupServices ? groupServices[groupServices.length - 1].end_at : row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, service_category: row.service_category, service_price_cents: row.service_price_cents, booked_price_cents: row.booked_price_cents, duration_min: row.duration_min, practitioner_name: row.practitioner_name, comment: row.comment_client, deposit_required: row.deposit_required, deposit_status: row.deposit_status, deposit_amount_cents: row.deposit_amount_cents, deposit_payment_intent_id: row.deposit_payment_intent_id, promotion_label: row.promotion_label, promotion_discount_cents: row.promotion_discount_cents, promotion_discount_pct: row.promotion_discount_pct, discount_pct: row.discount_pct },
              business: { name: row.biz_name, email: row.biz_email, phone: row.biz_phone, address: row.biz_address, theme: row.biz_theme, settings: row.biz_settings },
              groupServices
            });
          }
        } catch (e) { console.warn('[SMS INBOUND] Confirmation email error:', e.message); }
      })();

      // Audit log
      try {
        await query(
          `INSERT INTO notifications (business_id, booking_id, type, status, sent_at)
           VALUES ($1, $2, 'sms_confirmation_reply', 'sent', NOW())`,
          [bk.business_id, bk.id]
        );
      } catch (_) {}

      console.log(`[SMS INBOUND] Booking ${bk.id} confirmed via SMS reply from ***${from.slice(-4)}`);
      return res.type('text/xml').send(twiml('<Message>✓ RDV confirmé ! À bientôt.</Message>'));

    } else if (CANCEL_RE.test(normalized)) {
      return res.type('text/xml').send(twiml('<Message>Pour annuler, utilisez le lien dans votre SMS de confirmation.</Message>'));

    } else {
      // Unknown message — check if they even have a pending booking
      const hasPending = await query(
        `SELECT 1 FROM bookings b JOIN clients c ON c.id = b.client_id
         WHERE c.phone = $1 AND b.status = 'pending' AND b.confirmation_expires_at > NOW() LIMIT 1`,
        [from]
      );
      if (hasPending.rows.length > 0) {
        return res.type('text/xml').send(twiml('<Message>Vous avez un rendez-vous en attente. Confirmez via le lien dans votre SMS ou email.</Message>'));
      }
      // No pending booking — silent (no charge)
      return res.type('text/xml').send('<Response/>');
    }
  } catch (err) {
    console.error('[SMS INBOUND] Error:', err);
    return res.type('text/xml').send('<Response/>');
  }
});

module.exports = router;
