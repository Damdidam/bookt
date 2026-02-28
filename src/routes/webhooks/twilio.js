const router = require('express').Router();
const { query } = require('../../services/db');

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
      const today = new Date().toISOString().split('T')[0];
      if (today > settings.vacation_until) {
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

    if (RecordingUrl && bid) {
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
      announcement: vacMsg || `Bonjour. Le cabinet ${name} est actuellement fermé${until ? ' jusqu\'au ' + until : ''}. Vous pouvez prendre rendez-vous en ligne via le SMS que nous vous envoyons.`,
      redirect: s.vacation_redirect_name ? `Nous vous transférons vers ${s.vacation_redirect_name}.` : 'Nous vous transférons vers le remplaçant.',
      goodbye: 'Un SMS avec le lien de réservation vous a été envoyé. Au revoir.',
      sms: customSms || `${name} : Cabinet fermé${until ? ' jusqu\'au ' + until : ''}. Prenez RDV en ligne : ${bookingUrl}`
    };
  }

  return {
    announcement: customMsg || `Bonjour et bienvenue chez ${name}. Pour prendre rendez-vous, nous vous envoyons un SMS avec un lien vers notre système de réservation en ligne.`,
    goodbye: 'Un SMS avec le lien de réservation vous a été envoyé. Au revoir.',
    sms: customSms || `${name} : Prenez rendez-vous en ligne sur ${bookingUrl}`
  };
}

async function checkBusinessHours(businessId) {
  const now = new Date();
  const dayIndex = (now.getDay() + 6) % 7; // 0=Mon
  const currentTime = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

  const result = await query(
    `SELECT schedule FROM availabilities WHERE business_id = $1 AND is_active = true LIMIT 1`,
    [businessId]
  );
  if (result.rows.length === 0) return false;

  const schedule = result.rows[0].schedule;
  if (!schedule || !schedule[dayIndex]) return false;

  const slots = schedule[dayIndex].filter(s => s.is_active !== false);
  return slots.some(slot => currentTime >= slot.opens && currentTime <= slot.closes);
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
      console.log(`  📱 [SMS mock] To: ${to} — ${message}`);
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
