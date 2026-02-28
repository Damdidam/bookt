/**
 * SMS service using Twilio
 * Shared across: call filter, reminders, notifications
 */
const { query } = require('./db');

/**
 * Send an SMS via Twilio
 * @param {Object} opts
 * @param {string} opts.to - recipient phone (E.164)
 * @param {string} opts.body - message text
 * @param {string} opts.businessId - business UUID (to find Twilio number)
 * @param {string} [opts.from] - override sender number
 * @returns {Promise<{success: boolean, sid?: string, error?: string}>}
 */
async function sendSMS(opts) {
  const { to, body, businessId, from } = opts;

  if (!to || !body) {
    return { success: false, error: 'Missing to or body' };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) {
    console.log(`  📱 [SMS mock] To: ${to} — ${body}`);
    return { success: true, sid: 'mock', mock: true };
  }

  try {
    // Get Twilio number for this business
    let fromNumber = from;
    if (!fromNumber && businessId) {
      const csResult = await query(
        `SELECT twilio_number FROM call_settings WHERE business_id = $1`,
        [businessId]
      );
      fromNumber = csResult.rows[0]?.twilio_number;
    }

    if (!fromNumber) {
      // Fallback to env var
      fromNumber = process.env.TWILIO_FROM_NUMBER;
    }

    if (!fromNumber) {
      console.warn('[SMS] No Twilio number found for business', businessId);
      return { success: false, error: 'No Twilio number configured' };
    }

    const twilio = require('twilio')(sid, token);
    const msg = await twilio.messages.create({
      body,
      from: fromNumber,
      to,
      statusCallback: process.env.APP_BASE_URL
        ? `${process.env.APP_BASE_URL}/webhooks/twilio/sms/status`
        : undefined
    });

    console.log(`[SMS] Sent to ${to}: ${msg.sid}`);
    return { success: true, sid: msg.sid };
  } catch (err) {
    console.error('[SMS] Error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendSMS };
