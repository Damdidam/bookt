'use strict';

const { query } = require('../../services/db');
const { sendBookingConfirmation } = require('../../services/email');
const { BASE_URL } = require('./helpers');

/**
 * Queue in-transaction notification rows for a booking.
 * Called inside the RLS transaction, uses savepoints for resilience.
 *
 * @param {object} txClient - The transaction database client
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.bookingId - The primary booking id (first booking for multi)
 * @param {string} params.bookingStatus - Current booking status
 * @param {string} params.clientEmail
 * @param {string} params.clientPhone
 * @param {string} params.savepointPrefix - Unique prefix for savepoint names (e.g. 'notif_multi' or 'notif')
 */
async function queueBookingNotifications(txClient, {
  businessId, bookingId, bookingStatus, clientEmail, clientPhone, savepointPrefix, notifyProEnabled = true, skipClientEmail = false
}) {
  // Queue client confirmation email (skip if deposit pending or quote_only service)
  if (bookingStatus !== 'pending_deposit' && !skipClientEmail) {
    try {
      await txClient.query(`SAVEPOINT ${savepointPrefix}_sp1`);
      await txClient.query(
        `INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status)
         VALUES ($1,$2,'email_confirmation',$3,$4,'queued')`,
        [businessId, bookingId, clientEmail, clientPhone]
      );
    } catch (notifErr) {
      await txClient.query(`ROLLBACK TO SAVEPOINT ${savepointPrefix}_sp1`);
      console.error('Notification insert failed:', notifErr.message);
    }
  }
  // Queue pro notification (if enabled in settings — default true)
  if (notifyProEnabled === false) return;
  try {
    await txClient.query(`SAVEPOINT ${savepointPrefix}_sp2`);
    await txClient.query(
      `INSERT INTO notifications (business_id, booking_id, type, status)
       VALUES ($1,$2,'email_new_booking_pro','queued')`,
      [businessId, bookingId]
    );
  } catch (notifErr) {
    await txClient.query(`ROLLBACK TO SAVEPOINT ${savepointPrefix}_sp2`);
    console.error('Notification insert failed:', notifErr.message);
  }
}

/**
 * Send post-transaction booking communications (email + SMS).
 * Fire-and-forget — called outside the transaction.
 *
 * Handles 3 branches:
 *   1. pending_deposit → deposit request email + SMS
 *   2. needsConfirmation → confirmation request email + SMS
 *   3. else → direct booking confirmation email
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {object} params.createdBooking - The primary booking row (from RETURNING)
 * @param {string} params.clientName
 * @param {string} params.clientEmail
 * @param {string} params.clientPhone
 * @param {string} params.clientComment
 * @param {boolean} params.needsConfirmation
 * @param {number} params.confirmTimeoutMin
 * @param {string} params.confirmChannel - 'email' | 'sms' | 'both'
 * @param {number} params.gcPartialCents
 * @param {string} params.practitionerName - Display name(s) of practitioner(s)
 * @param {string|null} params.serviceName - For single-service only (null for multi)
 * @param {string|null} params.serviceCategory - For single-service only
 * @param {number} params.servicePriceCents - Effective price after LM discount
 * @param {number} params.durationMin
 * @param {object[]|null} params.groupServices - For multi-service only (null for single)
 * @param {string} params.logPrefix - For console warnings (e.g. 'Multi-service' or 'Single booking')
 */
async function sendPostBookingComms({
  businessId, createdBooking,
  clientName, clientEmail, clientPhone, clientComment,
  needsConfirmation, confirmTimeoutMin, confirmChannel,
  gcPartialCents,
  practitionerName,
  serviceName, serviceCategory,
  servicePriceCents, durationMin,
  groupServices,
  logPrefix
}) {
  (async () => {
    try {
      // Skip client confirmation email for quote_only services — the quote-request endpoint sends its own email.
      // H8 fix: EXCEPTION — if status='pending_deposit' (quote_only + deposit_required combo), we MUST
      // send the deposit request email (L123) otherwise the client never receives the payment link and
      // the booking expires silently. Only skip the needsConfirmation/regular confirmation branches.
      // Pro notification is already queued via queueBookingNotifications (notification-processor handles it).
      const _qoIds = groupServices ? groupServices.map(gs => gs.service_id || gs.id).filter(Boolean) : (createdBooking.service_id ? [createdBooking.service_id] : []);
      if (_qoIds.length > 0 && createdBooking.status !== 'pending_deposit') {
        const _qoCheck = await query(`SELECT 1 FROM services WHERE id = ANY($1) AND quote_only = true LIMIT 1`, [_qoIds]);
        if (_qoCheck.rows.length > 0) return;
      }

      const bizRow = await query(`SELECT name, email, phone, address, theme, settings, plan FROM businesses WHERE id = $1`, [businessId]);
      if (!bizRow.rows[0]) return;

      const emailBooking = {
        ...createdBooking,
        client_name: clientName,
        client_email: clientEmail,
        service_price_cents: servicePriceCents,
        duration_min: durationMin,
        service_category: serviceCategory,
        practitioner_name: practitionerName,
        comment: clientComment,
        gc_partial_cents: gcPartialCents || 0
      };
      // Single-service: attach service_name directly
      if (serviceName) {
        emailBooking.service_name = serviceName;
      }
      // Multi-service: attach promo fields from the promo-carrying booking
      // (already spread from createdBooking which has them)

      if (createdBooking.status === 'pending_deposit') {
        // Deposit auto-triggered: send deposit request email (payment serves as confirmation)
        const baseUrl = BASE_URL;
        const depositUrl = `${baseUrl}/deposit/${createdBooking.public_token}`;
        await query(`UPDATE bookings SET deposit_payment_url = $1 WHERE id = $2`, [depositUrl, createdBooking.id]);
        const { sendDepositRequestEmail } = require('../../services/email');
        const payUrl = `${baseUrl}/api/public/deposit/${createdBooking.public_token}/pay`;
        const emailOpts = { booking: emailBooking, business: bizRow.rows[0], depositUrl, payUrl };
        if (groupServices) emailOpts.groupServices = groupServices;
        await sendDepositRequestEmail(emailOpts);
        // Audit trail
        try {
          await query(
            `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at)
             VALUES ($1,$2,'email_deposit_request',$3,'sent',NOW())`,
            [businessId, createdBooking.id, clientEmail]
          );
        } catch (_) { /* best-effort audit */ }
        // SMS with deposit payment link
        if (clientPhone && bizRow.rows[0].plan !== 'free') {
          try {
            const { sendSMS } = require('../../services/sms');
            const _sd = new Date(emailBooking.start_at);
            const _sDate = _sd.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
            const _sTime = _sd.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
            const depAmt = (createdBooking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
            const _depDl = createdBooking.deposit_deadline ? new Date(createdBooking.deposit_deadline).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '';
            const _svcLabel = groupServices && groupServices.length > 1
              ? `${groupServices[0].name} +${groupServices.length - 1}`
              : serviceName || 'RDV';
            await sendSMS({ to: clientPhone, body: `${bizRow.rows[0].name} : Acompte ${depAmt}\u20ac pour "${_svcLabel}"${practitionerName ? ' avec ' + practitionerName : ''} le ${_sDate} \u00e0 ${_sTime}${_depDl ? '. Avant le ' + _depDl : ''}. Payez : ${depositUrl}`, businessId, clientId: createdBooking.client_id });
            try {
              await query(
                `INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, sent_at)
                 VALUES ($1,$2,'sms_deposit_request',$3,'sent',NOW())`,
                [businessId, createdBooking.id, clientPhone]
              );
            } catch (_) {}
          } catch (smsErr) { console.warn('[SMS] Deposit request SMS error:', smsErr.message); }
        }
      } else if (needsConfirmation) {
        // Send confirmation REQUEST (client must click to confirm)
        const { sendBookingConfirmationRequest } = require('../../services/email');
        if (confirmChannel === 'email' || confirmChannel === 'both') {
          const emailOpts = { booking: emailBooking, business: bizRow.rows[0], timeoutMin: confirmTimeoutMin };
          if (groupServices) emailOpts.groupServices = groupServices;
          await sendBookingConfirmationRequest(emailOpts);
        }
        if ((confirmChannel === 'sms' || confirmChannel === 'both') && clientPhone && bizRow.rows[0].plan !== 'free') {
          try {
            const { sendSMS } = require('../../services/sms');
            const baseUrl = BASE_URL;
            const link = `${baseUrl}/api/public/booking/${createdBooking.public_token}/confirm-booking`;
            const _sd = new Date(emailBooking.start_at);
            const _sDate = _sd.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
            const _sTime = _sd.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
            if (groupServices) {
              // Multi-service: use grouped label
              const _svcLabel = groupServices.length > 1 ? `${groupServices[0].name} +${groupServices.length - 1}` : groupServices[0].name;
              await sendSMS({ to: clientPhone, body: `${bizRow.rows[0].name} : RDV "${_svcLabel}" le ${_sDate} \u00e0 ${_sTime} avec ${practitionerName}. Confirmez ici : ${link}`, businessId, clientId: createdBooking.client_id });
            } else {
              // Single-service: use service name + optional practitioner
              console.log(`[SMS] Attempting confirmation SMS to ${clientPhone} for booking ${createdBooking.id}, channel=${confirmChannel}`);
              const smsResult = await sendSMS({ to: clientPhone, body: `${bizRow.rows[0].name} : RDV "${serviceName}" le ${_sDate} \u00e0 ${_sTime}${practitionerName ? ' avec ' + practitionerName : ''}. Confirmez ici : ${link}`, businessId, clientId: createdBooking.client_id });
              console.log(`[SMS] Confirmation SMS result:`, JSON.stringify(smsResult));
              await query(`INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, sent_at, error) VALUES ($1,$2,'sms_confirmation',$3,$4,NOW(),$5)`,
                [businessId, createdBooking.id, clientPhone, smsResult.success ? 'sent' : 'failed', smsResult.error || null]);
            }
          } catch (smsErr) {
            if (groupServices) {
              console.warn('[SMS] Booking confirm SMS error:', smsErr.message);
            } else {
              console.error('[SMS] Booking confirm SMS error:', smsErr.message, smsErr.stack);
              try { await query(`INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, error) VALUES ($1,$2,'sms_confirmation',$3,'failed',$4)`,
                [businessId, createdBooking.id, clientPhone, smsErr.message]); } catch (_) {}
            }
          }
        }
      } else {
        // Direct confirmation: email + SMS
        const emailOpts = { booking: emailBooking, business: bizRow.rows[0] };
        if (groupServices) emailOpts.groupServices = groupServices;
        await sendBookingConfirmation(emailOpts);

        // SMS confirmation (pro plan)
        if (clientPhone && bizRow.rows[0].plan !== 'free') {
          try {
            const { sendSMS } = require('../../services/sms');
            const baseUrl = BASE_URL;
            const manageUrl = `${baseUrl}/booking/${createdBooking.public_token}`;
            const _sd = new Date(emailBooking.start_at);
            const _sDate = _sd.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
            const _sTime = _sd.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
            const _svcLabel = groupServices && groupServices.length > 1
              ? `${groupServices[0].name} +${groupServices.length - 1}`
              : serviceName || 'RDV';
            const smsBody = `${bizRow.rows[0].name} : RDV "${_svcLabel}" confirmé le ${_sDate} à ${_sTime}${practitionerName ? ' avec ' + practitionerName : ''}. Gérer : ${manageUrl}`;
            const smsResult = await sendSMS({ to: clientPhone, body: smsBody, businessId, clientId: createdBooking.client_id });
            try {
              await query(
                `INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, sent_at, error) VALUES ($1,$2,'sms_confirmation',$3,$4,NOW(),$5)`,
                [businessId, createdBooking.id, clientPhone, smsResult.success ? 'sent' : 'failed', smsResult.error || null]
              );
            } catch (_) {}
          } catch (smsErr) {
            console.warn('[SMS] Direct confirmation SMS error:', smsErr.message);
          }
        }
      }
    } catch (e) { console.warn(`[EMAIL] ${logPrefix} email error:`, e.message); }
  })();
}

module.exports = { queueBookingNotifications, sendPostBookingComms };
