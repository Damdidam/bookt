/**
 * SMS service using Twilio
 * Shared across: reminders, notifications
 */
const { query } = require('./db');
const { toGsm7 } = require('../utils/sms-encode');

/**
 * Send an SMS via Twilio
 * @param {Object} opts
 * @param {string} opts.to - recipient phone (E.164)
 * @param {string} opts.body - message text
 * @param {string} opts.businessId - business UUID (to find Twilio number)
 * @param {string} [opts.from] - override sender number
 * @param {boolean} [opts.consentSms] - if explicitly false, skip the send (RGPD opt-out)
 * @returns {Promise<{success: boolean, sid?: string, error?: string, skipped?: boolean}>}
 */
async function sendSMS(opts) {
  const { to, businessId, from, consentSms, clientId } = opts;
  // Strip non-GSM-7 chars (em-dash, accents, €, …) so Twilio bills 1 segment per 160 chars instead of 70 (UCS-2).
  const body = toGsm7(opts.body);

  if (!to || !body) {
    return { success: false, error: 'Missing to or body' };
  }
  // RGPD: skip if caller knows client opted out, or if a clientId is provided and DB says false.
  if (consentSms === false) {
    return { success: false, skipped: true, error: 'consent_sms=false' };
  }
  if (clientId && consentSms === undefined) {
    try {
      const r = await query(`SELECT consent_sms FROM clients WHERE id = $1`, [clientId]);
      if (r.rows[0]?.consent_sms === false) {
        return { success: false, skipped: true, error: 'consent_sms=false (auto-check)' };
      }
    } catch (e) { console.warn('[SMS] consent auto-check failed:', e.message); }
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  // L10: Mask phone numbers in logs to prevent PII leaks
  const masked = to.length > 4 ? '***' + to.slice(-4) : '***';

  if (!sid || !token) {
    console.log(`  [SMS mock] To: ${masked} — ${body.substring(0, 80)}`);
    return { success: true, sid: 'mock', mock: true };
  }

  try {
    // S7: Monthly SMS cap per business (500/month) to prevent runaway costs
    if (businessId) {
      const usage = await query(
        `SELECT sms_count_month, sms_month_reset_at FROM businesses WHERE id = $1`, [businessId]
      );
      const u = usage.rows[0];
      if (u) {
        const currentMonth = u.sms_month_reset_at && new Date(u.sms_month_reset_at) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const count = currentMonth ? (u.sms_count_month || 0) : 0;
        const cap = parseInt(process.env.SMS_MONTHLY_CAP) || 500;
        if (count >= cap) {
          console.warn(`[SMS] Monthly cap reached for business ${businessId}: ${count}/${cap}`);
          return { success: false, error: 'SMS monthly cap reached' };
        }
      }
    }

    let fromNumber = from;

    if (!fromNumber) {
      // Fallback to env var
      fromNumber = process.env.TWILIO_FROM_NUMBER;
    }

    const twilio = require('twilio')(sid, token);
    const createOpts = { body, to };
    // Support Messaging Service SID (starts with MG) or direct number
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      createOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else if (fromNumber) {
      createOpts.from = fromNumber;
    } else {
      console.warn('[SMS] No Twilio number found for business', businessId);
      return { success: false, error: 'No Twilio number configured' };
    }
    if (process.env.APP_BASE_URL) {
      createOpts.statusCallback = `${process.env.APP_BASE_URL}/webhooks/twilio/sms/status`;
    }
    console.log(`[SMS] Sending to ${masked} via ${createOpts.messagingServiceSid || createOpts.from}...`);
    const msg = await twilio.messages.create(createOpts);

    console.log(`[SMS] Sent to ${masked}: ${msg.sid}`);

    // Track SMS usage for billing
    try {
      await query(
        `UPDATE businesses SET
           sms_count_month = CASE
             WHEN sms_month_reset_at IS NULL OR sms_month_reset_at < date_trunc('month', NOW())
             THEN 1
             ELSE COALESCE(sms_count_month, 0) + 1
           END,
           sms_month_reset_at = CASE
             WHEN sms_month_reset_at IS NULL OR sms_month_reset_at < date_trunc('month', NOW())
             THEN date_trunc('month', NOW())
             ELSE sms_month_reset_at
           END
         WHERE id = $1`,
        [businessId]
      );
    } catch (e) { console.warn('[SMS] Usage tracking error:', e.message); }

    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error('[SMS] Error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendSMS };
