const router = require('express').Router();
const { validate: isUuid } = require('uuid');
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
      return res.status(403).send('Forbidden');
    }
  } catch (e) {
    console.warn('[TWILIO] Signature validation error:', e.message);
    return res.status(403).json({ error: 'Signature validation failed' });
  }
  next();
}

router.use(validateTwilioSignature);

// ============================================================
// POST /webhooks/twilio/voice/incoming
// Flow:
// 1. Identify business from called number
// 2. Check blacklist → reject
// 3. Check whitelist → transfer if VIP
// 4. Check repeat caller → transfer if insistent
// 5. Apply filter mode:
//    - off: transfer directly
//    - soft: announce + SMS + transfer
//    - strict: announce + SMS + hangup (no "tapez 1")
//    - vacation: vacation msg + SMS + optional redirect + hangup
//    - schedule_based: during hours → strict, outside → off
// ============================================================
router.post('/voice/incoming', async (req, res, next) => {
  try {
    const { From, To, CallSid } = req.body;

    // 1. Identify business
    const csResult = await query(
      `SELECT cs.*, b.slug, b.name, b.language_default
       FROM call_settings cs
       JOIN businesses b ON b.id = cs.business_id
       WHERE cs.twilio_number = $1 AND b.is_active = true`,
      [To]
    );

    if (csResult.rows.length === 0) {
      return res.type('text/xml').send(twiml('<Say>Ce numéro n\'est pas configuré.</Say><Hangup/>'));
    }

    const settings = csResult.rows[0];
    const businessId = settings.business_id;
    const lang = settings.language_default || 'fr';
    const bookingUrl = `${process.env.BOOKING_BASE_URL || process.env.APP_BASE_URL}/${settings.slug}`;

    // 2. Blacklist check
    const blResult = await query(
      `SELECT id FROM call_blacklist
       WHERE business_id = $1 AND phone_e164 = $2 AND is_active = true`,
      [businessId, From]
    );
    if (blResult.rows.length > 0) {
      await logCall(businessId, CallSid, From, To, 'blacklist_reject', 'ok');
      return res.type('text/xml').send(twiml('<Reject/>'));
    }

    // Resolve effective mode (vacation auto-expires)
    let mode = settings.filter_mode || 'off';
    if (mode === 'vacation' && settings.vacation_until) {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      // V13-011: Normalize vacation_until (DB may return Date object or string)
      const vacUntil = settings.vacation_until instanceof Date
        ? settings.vacation_until.toISOString().split('T')[0]
        : String(settings.vacation_until);
      if (today > vacUntil) {
        mode = 'soft';
        await query(`UPDATE call_settings SET filter_mode = 'soft' WHERE business_id = $1`, [businessId]);
      }
    }

    // Auto-vacation: if all active practitioners are on vacation, behave as vacation
    if (mode !== 'vacation' && mode !== 'off') {
      const pracResult = await query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE vacation_until >= CURRENT_DATE) AS on_vacation
         FROM practitioners
         WHERE business_id = $1 AND is_active = true`,
        [businessId]
      );
      const { total, on_vacation } = pracResult.rows[0];
      if (parseInt(total) > 0 && parseInt(on_vacation) === parseInt(total)) {
        mode = 'vacation';
      }
    }

    // Off → transfer directly
    if (mode === 'off') {
      await logCall(businessId, CallSid, From, To, 'forwarded', 'ok');
      return res.type('text/xml').send(twiml(`<Dial>${settings.forward_default_phone}</Dial>`));
    }

    // 3. Whitelist VIP → transfer
    const wlResult = await query(
      `SELECT id FROM call_whitelist
       WHERE business_id = $1 AND phone_e164 = $2 AND is_active = true`,
      [businessId, From]
    );
    if (wlResult.rows.length > 0) {
      await logCall(businessId, CallSid, From, To, 'whitelist_pass', 'ok');
      return res.type('text/xml').send(twiml(`<Dial>${settings.forward_default_phone}</Dial>`));
    }

    // 4. Repeat caller detection
    if (settings.repeat_caller_threshold > 0 && From) {
      const windowMin = settings.repeat_caller_window_min || 15;
      const threshold = settings.repeat_caller_threshold || 3;
      const repeatResult = await query(
        `SELECT COUNT(*) AS cnt FROM call_logs
         WHERE business_id = $1 AND from_phone = $2
         AND created_at >= NOW() - INTERVAL '1 minute' * $3`,
        [businessId, From, windowMin]
      );
      if (parseInt(repeatResult.rows[0].cnt) >= threshold - 1) {
        await logCall(businessId, CallSid, From, To, 'repeat_transfer', 'ok');
        const msg = 'Nous vous transférons.';
        return res.type('text/xml').send(twiml(
          `<Say language="${lc()}">${msg}</Say><Dial>${settings.forward_default_phone}</Dial>`
        ));
      }
    }

    // 5. Schedule-based → resolve to strict or off
    if (mode === 'schedule_based') {
      const isOpen = await checkBusinessHours(businessId);
      if (isOpen) {
        mode = 'strict'; // During consultation → don't disturb
      } else {
        await logCall(businessId, CallSid, From, To, 'forwarded', 'ok');
        return res.type('text/xml').send(twiml(`<Dial>${settings.forward_default_phone}</Dial>`));
      }
    }

    // 6. Build response
    const msgs = buildMessages(lang, settings, bookingUrl, mode);
    let xml;

    if (mode === 'soft') {
      xml = `<Say language="${lc()}">${msgs.announcement}</Say>
             <Dial>${settings.forward_default_phone}</Dial>`;

    } else if (mode === 'strict') {
      xml = `<Say language="${lc()}">${msgs.announcement}</Say>`;
      if (settings.voicemail_enabled) {
        xml += `<Gather numDigits="1" action="/webhooks/twilio/voicemail/choice?bid=${businessId}&amp;from=${encodeURIComponent(From)}" timeout="5">
                  <Say language="${lc()}">Pour laisser un message vocal, tapez 1.</Say>
                </Gather>
                <Say language="${lc()}">${msgs.goodbye}</Say><Hangup/>`;
      } else {
        xml += `<Say language="${lc()}">${msgs.goodbye}</Say><Hangup/>`;
      }

    } else if (mode === 'vacation') {
      xml = `<Say language="${lc()}">${msgs.announcement}</Say>`;
      if (settings.vacation_redirect_phone) {
        xml += `<Say language="${lc()}">${msgs.redirect}</Say>
                <Dial>${settings.vacation_redirect_phone}</Dial>`;
      } else if (settings.voicemail_enabled) {
        xml += `<Gather numDigits="1" action="/webhooks/twilio/voicemail/choice?bid=${businessId}&amp;from=${encodeURIComponent(From)}" timeout="5">
                  <Say language="${lc()}">Pour laisser un message vocal, tapez 1.</Say>
                </Gather>
                <Say language="${lc()}">${msgs.goodbye}</Say><Hangup/>`;
      } else {
        xml += `<Say language="${lc()}">${msgs.goodbye}</Say><Hangup/>`;
      }
    }

    // SMS
    if (settings.sms_after_call && From) {
      await sendBookingSMS(From, msgs.sms, businessId, CallSid);
    }

    await logCall(businessId, CallSid, From, To, mode === 'vacation' ? 'vacation_message' : 'played_message', 'ok');
    res.type('text/xml').send(twiml(xml));

  } catch (err) {
    console.error('Twilio webhook error:', err);
    res.type('text/xml').send(twiml('<Say>Une erreur est survenue.</Say><Hangup/>'));
  }
});

// ============================================================
// POST /webhooks/twilio/voice/status
// ============================================================
router.post('/voice/status', async (req, res) => {
  const { CallSid, CallDuration } = req.body;
  if (CallSid && CallDuration) {
    await query(`UPDATE call_logs SET duration_sec = $1 WHERE call_sid = $2`,
      [parseInt(CallDuration), CallSid]).catch(e => console.error('Status update error:', e));
  }
  res.sendStatus(200);
});

// ============================================================
// POST /webhooks/twilio/voicemail/choice
// Caller pressed 1 → start recording. Otherwise → goodbye.
// ============================================================
router.post('/voicemail/choice', (req, res) => {
  const { Digits } = req.body;
  const { bid, from } = req.query;

  if (Digits === '1') {
    return res.type('text/xml').send(twiml(
      `<Say language="fr-BE">Laissez votre message après le bip. Raccrochez quand vous avez terminé.</Say>
       <Record maxLength="120" playBeep="true" timeout="5"
         action="/webhooks/twilio/voicemail/done?bid=${bid}&amp;from=${encodeURIComponent(from || '')}"
         recordingStatusCallback="/webhooks/twilio/voicemail/status?bid=${bid}&amp;from=${encodeURIComponent(from || '')}" />`
    ));
  }

  // Any other key or no key → goodbye
  res.type('text/xml').send(twiml(
    '<Say language="fr-BE">Un SMS avec le lien de réservation vous a été envoyé. Au revoir.</Say><Hangup/>'
  ));
});

// ============================================================
// POST /webhooks/twilio/voicemail/done
// Called when the caller finishes recording (or hangs up)
// ============================================================
router.post('/voicemail/done', (req, res) => {
  // After recording, say goodbye and hang up
  res.type('text/xml').send(twiml(
    '<Say language="fr-BE">Merci pour votre message. Au revoir.</Say><Hangup/>'
  ));
});

// ============================================================
// POST /webhooks/twilio/voicemail/status
// Called when the recording is ready (async from Twilio)
// ============================================================
router.post('/voicemail/status', async (req, res) => {
  try {
    const { RecordingUrl, RecordingSid, RecordingDuration, CallSid } = req.body;
    const { bid, from } = req.query;

    if (RecordingUrl && bid && isUuid(bid)) {
      // Validate business_id exists before inserting
      const bizCheck = await query(`SELECT id FROM businesses WHERE id = $1 AND is_active = true`, [bid]);
      if (bizCheck.rows.length === 0) {
        console.warn('[TWILIO] Voicemail status: invalid business_id', bid);
        return res.sendStatus(200);
      }

      await query(
        `INSERT INTO call_voicemails (business_id, call_sid, from_phone, recording_url, recording_sid, duration_sec)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [bid, CallSid, decodeURIComponent(from || ''), RecordingUrl + '.mp3', RecordingSid, parseInt(RecordingDuration) || 0]
      );

      await logCall(bid, CallSid, decodeURIComponent(from || ''), null, 'voicemail', 'ok');
    }
  } catch (err) {
    console.error('Voicemail status error:', err);
  }
  res.sendStatus(200);
});

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

router.post('/sms/inbound', validateTwilioSignature, async (req, res) => {
  const from = (req.body.From || '').trim();
  const body = (req.body.Body || '').trim();
  const normalized = body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  console.log(`[SMS INBOUND] From: ***${from.slice(-4)} Body: "${body}"`);

  // Rate limit — silent response (no outbound SMS charged)
  if (!checkSmsRate(from)) {
    console.warn(`[SMS INBOUND] Rate limited: ***${from.slice(-4)}`);
    return res.type('text/xml').send('<Response/>');
  }

  try {
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
                `SELECT CASE WHEN sv.name IS NOT NULL THEN COALESCE(s.category || ' - ', '') || s.name || ' — ' || sv.name ELSE COALESCE(s.category || ' - ', '') || s.name END AS name, COALESCE(sv.duration_min, s.duration_min) AS duration_min, COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at FROM bookings b LEFT JOIN services s ON s.id = b.service_id LEFT JOIN service_variants sv ON sv.id = b.service_variant_id WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
                [row.group_id, row.business_id]
              );
              if (grp.rows.length > 1) groupServices = grp.rows;
            }
            const { sendBookingConfirmation } = require('../../services/email');
            await sendBookingConfirmation({
              booking: { public_token: row.public_token, start_at: row.start_at, end_at: groupServices ? groupServices[groupServices.length - 1].end_at : row.end_at, client_name: row.client_name, client_email: row.client_email, service_name: row.service_name, practitioner_name: row.practitioner_name, comment: row.comment_client },
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
        return res.type('text/xml').send(twiml('<Message>Répondez OUI pour confirmer votre rendez-vous.</Message>'));
      }
      // No pending booking — silent (no charge)
      return res.type('text/xml').send('<Response/>');
    }
  } catch (err) {
    console.error('[SMS INBOUND] Error:', err);
    return res.type('text/xml').send('<Response/>');
  }
});

// ============================================================
// HELPERS
// ============================================================
function twiml(c) { return `<?xml version="1.0" encoding="UTF-8"?><Response>${c}</Response>`; }
function lc() { return 'fr-BE'; }

function buildMessages(lang, s, bookingUrl, mode) {
  const name = s.name;
  const customMsg = s.custom_message_fr;
  const customSms = s.custom_sms_fr;

  if (mode === 'vacation') {
    const vacMsg = s.vacation_message_fr;
    const until = s.vacation_until
      ? new Date(s.vacation_until).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })
      : null;

    return {
      announcement: vacMsg || `Bonjour. ${name} est actuellement fermé${until ? ' jusqu\'au ' + until : ''}. Vous pouvez prendre rendez-vous en ligne via le SMS que nous vous envoyons.`,
      redirect: s.vacation_redirect_name ? `Nous vous transférons vers ${s.vacation_redirect_name}.` : 'Nous vous transférons vers le remplaçant.',
      goodbye: 'Un SMS avec le lien de réservation vous a été envoyé. Au revoir.',
      sms: customSms || `${name} : Fermé${until ? ' jusqu\'au ' + until : ''}. Prenez RDV en ligne : ${bookingUrl}`
    };
  }

  return {
    announcement: customMsg || `Bonjour et bienvenue chez ${name}. Pour prendre rendez-vous, nous vous envoyons un SMS avec un lien vers notre système de réservation en ligne.`,
    goodbye: 'Un SMS avec le lien de réservation vous a été envoyé. Au revoir.',
    sms: customSms || `${name} : Prenez rendez-vous en ligne sur ${bookingUrl}`
  };
}

async function checkBusinessHours(businessId) {
  // Get current time in Brussels timezone
  const now = new Date();
  const brusselsStr = now.toLocaleString('sv-SE', { timeZone: 'Europe/Brussels' });
  const brusselsDate = new Date(brusselsStr);
  const dayIndex = (brusselsDate.getDay() + 6) % 7; // 0=Mon
  const currentTime = brusselsStr.split(' ')[1].slice(0, 5); // "HH:MM"

  const result = await query(
    `SELECT start_time, end_time FROM availabilities
     WHERE business_id = $1 AND weekday = $2 AND is_active = true`,
    [businessId, dayIndex]
  );
  if (result.rows.length === 0) return false;

  return result.rows.some(row => currentTime >= row.start_time && currentTime <= row.end_time);
}

async function logCall(businessId, callSid, from, to, action, result) {
  await query(
    `INSERT INTO call_logs (business_id, call_sid, from_phone, to_phone, action, result)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [businessId, callSid, from, to, action, result]
  ).catch(e => console.error('Call log error:', e));
}

async function sendBookingSMS(to, message, businessId, callSid) {
  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const csResult = await query(`SELECT twilio_number FROM call_settings WHERE business_id = $1`, [businessId]);
      if (csResult.rows.length > 0) {
        await twilio.messages.create({
          body: message,
          from: csResult.rows[0].twilio_number,
          to: to,
          statusCallback: `${process.env.APP_BASE_URL}/webhooks/twilio/sms/status`
        });
      }
    } else {
      console.log(`  [SMS mock] To: ${to} — ${message}`);
    }
    await query(
      `INSERT INTO call_logs (business_id, call_sid, from_phone, to_phone, action, result)
       VALUES ($1, $2, $3, $4, 'sent_sms', 'ok')`,
      [businessId, callSid, null, to]
    );
  } catch (err) {
    console.error('SMS send error:', err);
  }
}

module.exports = router;
