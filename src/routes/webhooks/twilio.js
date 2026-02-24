const router = require('express').Router();
const { query } = require('../../services/db');

// ============================================================
// POST /webhooks/twilio/voice/incoming
// Main handler: incoming call → filter logic
// 
// Flow (mode soft):
// 1. Identify business from called number
// 2. Check whitelist → transfer if VIP
// 3. Play announcement
// 4. Option "tapez 1" for urgent → transfer
// 5. Send SMS with booking link
// 6. Transfer to real number (soft) or hang up (strict)
// 7. Log everything
// ============================================================
router.post('/voice/incoming', async (req, res, next) => {
  try {
    const { From, To, CallSid } = req.body;

    // 1. Identify business by called number
    const csResult = await query(
      `SELECT cs.*, b.slug, b.name, b.language_default
       FROM call_settings cs
       JOIN businesses b ON b.id = cs.business_id
       WHERE cs.twilio_number = $1 AND b.is_active = true`,
      [To]
    );

    if (csResult.rows.length === 0) {
      // Unknown number → just reject
      return res.type('text/xml').send(twiml('<Say>Ce numéro n\'est pas configuré.</Say><Hangup/>'));
    }

    const settings = csResult.rows[0];
    const businessId = settings.business_id;
    const lang = settings.language_default || 'fr';

    // Filter disabled? Transfer directly
    if (settings.filter_mode === 'off') {
      await logCall(businessId, CallSid, From, To, 'forwarded', 'ok');
      return res.type('text/xml').send(twiml(
        `<Dial>${settings.forward_default_phone}</Dial>`
      ));
    }

    // 2. Check whitelist
    const wlResult = await query(
      `SELECT id, label FROM call_whitelist
       WHERE business_id = $1 AND phone_e164 = $2 AND is_active = true`,
      [businessId, From]
    );

    if (wlResult.rows.length > 0) {
      // VIP → transfer directly
      await logCall(businessId, CallSid, From, To, 'whitelist_pass', 'ok');
      return res.type('text/xml').send(twiml(
        `<Dial>${settings.forward_default_phone}</Dial>`
      ));
    }

    // 3. Filtered call → announcement + options
    const bookingUrl = `${process.env.BOOKING_BASE_URL}/${settings.slug}`;
    const messages = getMessages(lang, settings.name, bookingUrl);

    let xml;

    if (settings.filter_mode === 'soft') {
      // Soft mode: announce → gather DTMF → transfer anyway
      xml = `
        <Gather numDigits="1" action="/webhooks/twilio/dtmf?bid=${businessId}&amp;callSid=${CallSid}&amp;from=${encodeURIComponent(From)}&amp;to=${encodeURIComponent(To)}" timeout="5">
          <Say language="${lang === 'fr' ? 'fr-BE' : 'nl-BE'}">${messages.announcement}</Say>
        </Gather>
        <Say language="${lang === 'fr' ? 'fr-BE' : 'nl-BE'}">${messages.transfer}</Say>
        <Dial>${settings.forward_default_phone}</Dial>`;

    } else if (settings.filter_mode === 'strict') {
      // Strict mode: announce → gather → hang up if no key press
      xml = `
        <Gather numDigits="1" action="/webhooks/twilio/dtmf?bid=${businessId}&amp;callSid=${CallSid}&amp;from=${encodeURIComponent(From)}&amp;to=${encodeURIComponent(To)}" timeout="8">
          <Say language="${lang === 'fr' ? 'fr-BE' : 'nl-BE'}">${messages.announcement_strict}</Say>
        </Gather>
        <Say language="${lang === 'fr' ? 'fr-BE' : 'nl-BE'}">${messages.goodbye}</Say>
        <Hangup/>`;
    }

    // Send SMS with booking link
    if (settings.sms_after_call && From) {
      await sendBookingSMS(From, messages.sms, businessId, CallSid);
    }

    await logCall(businessId, CallSid, From, To, 'played_message', 'ok');

    res.type('text/xml').send(twiml(xml));
  } catch (err) {
    console.error('Twilio webhook error:', err);
    // Fail gracefully → transfer to business phone
    res.type('text/xml').send(twiml('<Say>Une erreur est survenue.</Say><Hangup/>'));
  }
});

// ============================================================
// POST /webhooks/twilio/dtmf
// Handle DTMF key press (tapez 1 = urgent transfer)
// ============================================================
router.post('/dtmf', async (req, res, next) => {
  try {
    const { Digits } = req.body;
    const { bid, callSid, from, to } = req.query;

    if (Digits === '1') {
      // Urgent → transfer
      const csResult = await query(
        `SELECT urgent_target_phone, forward_default_phone
         FROM call_settings WHERE business_id = $1`,
        [bid]
      );

      if (csResult.rows.length > 0) {
        const targetPhone = csResult.rows[0].urgent_target_phone || csResult.rows[0].forward_default_phone;
        await logCall(bid, callSid, decodeURIComponent(from), decodeURIComponent(to), 'urgent_key', 'ok');

        return res.type('text/xml').send(twiml(
          `<Say language="fr-BE">Transfert en cours, veuillez patienter.</Say>
           <Dial>${targetPhone}</Dial>`
        ));
      }
    }

    // Any other key or no settings → hang up politely
    await logCall(bid, callSid, decodeURIComponent(from), decodeURIComponent(to), 'hung_up', 'ok');
    res.type('text/xml').send(twiml(
      '<Say language="fr-BE">Un SMS avec le lien de réservation vous a été envoyé. Au revoir.</Say><Hangup/>'
    ));
  } catch (err) {
    console.error('DTMF webhook error:', err);
    res.type('text/xml').send(twiml('<Hangup/>'));
  }
});

// ============================================================
// POST /webhooks/twilio/voice/status
// Call status callback (completed, no-answer, etc.)
// ============================================================
router.post('/voice/status', async (req, res) => {
  const { CallSid, CallDuration, CallStatus } = req.body;

  // Update duration in log
  if (CallSid && CallDuration) {
    await query(
      `UPDATE call_logs SET duration_sec = $1 WHERE call_sid = $2`,
      [parseInt(CallDuration), CallSid]
    ).catch(err => console.error('Status update error:', err));
  }

  res.sendStatus(200);
});

// ============================================================
// POST /webhooks/twilio/sms/status
// SMS delivery status callback
// ============================================================
router.post('/sms/status', async (req, res) => {
  // Log SMS delivery status if needed
  res.sendStatus(200);
});

// ============================================================
// HELPERS
// ============================================================

function twiml(content) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}

function getMessages(lang, businessName, bookingUrl) {
  if (lang === 'nl') {
    return {
      announcement: `Welkom bij ${businessName}. Om een afspraak te maken, sturen we u een SMS met een link. Druk 1 voor een dringend gesprek.`,
      announcement_strict: `Welkom bij ${businessName}. We nemen geen telefonische afspraken meer aan. Een SMS met een reserveringslink wordt naar u gestuurd. Druk 1 als het dringend is.`,
      transfer: 'We verbinden u door.',
      goodbye: 'Een SMS is verstuurd. Tot ziens.',
      sms: `${businessName}: Maak online een afspraak via ${bookingUrl}`
    };
  }

  return {
    announcement: `Bonjour et bienvenue chez ${businessName}. Pour prendre rendez-vous, nous vous envoyons un SMS avec un lien. Tapez 1 si votre appel est urgent.`,
    announcement_strict: `Bonjour, ${businessName} ne prend plus les rendez-vous par téléphone. Un SMS avec le lien de réservation vous est envoyé. Tapez 1 si c'est urgent.`,
    transfer: 'Nous vous transférons.',
    goodbye: 'Un SMS vous a été envoyé. Au revoir.',
    sms: `${businessName} : Prenez rendez-vous en ligne sur ${bookingUrl}`
  };
}

async function logCall(businessId, callSid, from, to, action, result) {
  await query(
    `INSERT INTO call_logs (business_id, call_sid, from_phone, to_phone, action, result)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [businessId, callSid, from, to, action, result]
  ).catch(err => console.error('Call log error:', err));
}

async function sendBookingSMS(to, message, businessId, callSid) {
  try {
    // In production, use Twilio client
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      const csResult = await query(
        `SELECT twilio_number FROM call_settings WHERE business_id = $1`,
        [businessId]
      );

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

    // Log SMS send
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
