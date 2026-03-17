/**
 * Patient Reminder Engine
 * Sends email + SMS reminders before appointments
 * 
 * Two reminder windows:
 *   - 24h before: email (all plans) + SMS (Pro/Premium)
 *   - 2h before: SMS only (Pro/Premium, if enabled)
 * 
 * Triggered by:
 *   - In-process setInterval (every 10 min)
 *   - External cron: GET /api/cron/reminders?key=CRON_SECRET
 */

const { query, queryWithRLS, pool } = require('../services/db');
const { sendEmail, buildEmailHTML, escHtml } = require('../services/email');
const { sendSMS } = require('../services/sms');

const PLANS_WITH_SMS = ['pro', 'premium'];

/**
 * Process all pending reminders
 * @returns {Object} { email_24h, sms_24h, sms_2h, errors }
 */
async function processReminders() {
  const stats = { email_24h: 0, sms_24h: 0, email_2h: 0, sms_2h: 0, skipped: 0, errors: 0 };

  // Advisory lock to prevent concurrent execution (double reminders = wasted SMS credits)
  // Use a dedicated connection so lock and unlock happen on the same connection
  const lockClient = await pool.connect();
  try {
    const lockResult = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext('reminder_cron'))`);
    if (!lockResult.rows[0]?.pg_try_advisory_lock) {
      lockClient.release();
      return { ...stats, skipped: 1, reason: 'concurrent_execution' };
    }

    // ===== 24H REMINDERS =====
    await process24hReminders(stats);

    // ===== 2H REMINDERS =====
    await process2hReminders(stats);

  } catch (err) {
    console.error('[REMINDERS] Fatal error:', err);
    stats.errors++;
  } finally {
    await lockClient.query(`SELECT pg_advisory_unlock(hashtext('reminder_cron'))`).catch(() => {});
    lockClient.release();
  }

  return stats;
}

/**
 * 24h reminders: email (all plans) + SMS (Pro/Premium)
 * Window: between 24h and 23h before appointment
 */
async function process24hReminders(stats) {
  const bookings = await query(`
    SELECT
      bk.id, bk.start_at, bk.end_at, bk.public_token, bk.appointment_mode,
      bk.group_id, bk.group_order,
      c.full_name AS client_name, c.email AS client_email,
      c.phone AS client_phone, c.consent_sms,
      p.display_name AS practitioner_name,
      CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
      b.id AS business_id, b.name AS business_name, b.slug,
      b.phone AS business_phone, b.address AS business_address,
      b.plan, b.settings, b.theme
    FROM bookings bk
    JOIN clients c ON c.id = bk.client_id
    JOIN practitioners p ON p.id = bk.practitioner_id
    JOIN services s ON s.id = bk.service_id
    LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
    JOIN businesses b ON b.id = bk.business_id
    WHERE bk.status = 'confirmed'
      AND bk.reminder_24h_sent_at IS NULL
      AND bk.start_at > NOW() + INTERVAL '23 hours'
      AND bk.start_at <= NOW() + INTERVAL '25 hours'
      AND b.is_active = true
      AND (bk.group_id IS NULL OR bk.group_order = 0)
    ORDER BY bk.start_at
    LIMIT 200
  `);

  for (const bk of bookings.rows) {
    const settings = bk.settings || {};
    const reminderEmailEnabled = settings.reminder_email_24h !== false; // default true
    const reminderSmsEnabled = settings.reminder_sms_24h === true && PLANS_WITH_SMS.includes(bk.plan);

    try {
      let anySent = false;
      const startLocal = new Date(bk.start_at).toLocaleString('fr-BE', {
        timeZone: 'Europe/Brussels',
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit'
      });
      const dateShort = new Date(bk.start_at).toLocaleDateString('fr-BE', {
        timeZone: 'Europe/Brussels',
        day: '2-digit', month: '2-digit'
      });
      const timeShort = new Date(bk.start_at).toLocaleTimeString('fr-BE', {
        timeZone: 'Europe/Brussels',
        hour: '2-digit', minute: '2-digit'
      });

      const manageUrl = `${process.env.APP_BASE_URL || 'https://genda.be'}/booking/${bk.public_token}`;
      const primaryColor = bk.theme?.primary_color || '#0D7377';

      // Fetch group services if multi-service booking
      let groupServices = null;
      let groupEndAt = null;
      if (bk.group_id) {
        const grp = await query(
          `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
          [bk.group_id, bk.business_id]
        );
        if (grp.rows.length > 1) {
          groupServices = grp.rows;
          groupEndAt = grp.rows[grp.rows.length - 1].end_at;
        }
      }

      const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
      let serviceHTML;
      if (isMulti) {
        serviceHTML = groupServices.map(s => `<div style="padding:2px 0;font-weight:600">\u2022 ${escHtml(s.name)} (${s.duration_min} min)</div>`).join('');
        const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
        const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
        serviceHTML += `<div style="padding:4px 0;font-weight:700">Total : ${durStr}</div>`;
      } else {
        serviceHTML = `<span style="font-weight:600">${escHtml(bk.service_name)} (${bk.duration_min} min)</span>`;
      }

      // EMAIL 24h
      if (reminderEmailEnabled && bk.client_email) {
        const baseUrl = process.env.APP_BASE_URL || 'https://genda.be';
        const manageUrl24 = `${baseUrl}/booking/${bk.public_token}`;
        const html = buildEmailHTML({
          title: 'Rappel de votre rendez-vous',
          preheader: `RDV ${startLocal} chez ${bk.business_name}`,
          businessName: bk.business_name,
          primaryColor,
          bodyHTML: `
            <p>Bonjour ${escHtml(bk.client_name)},</p>
            <p>Nous vous rappelons votre rendez-vous :</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:8px 0;color:#7A7470;width:100px"> Date</td><td style="padding:8px 0;font-weight:600">${startLocal}</td></tr>
              <tr><td style="padding:8px 0;color:#7A7470">${isMulti ? ' Prestations' : ' Prestation'}</td><td style="padding:8px 0">${serviceHTML}</td></tr>
              <tr><td style="padding:8px 0;color:#7A7470"> Praticien</td><td style="padding:8px 0;font-weight:600">${escHtml(bk.practitioner_name)}</td></tr>
              ${bk.appointment_mode === 'cabinet' && bk.business_address ? `<tr><td style="padding:8px 0;color:#7A7470"> Adresse</td><td style="padding:8px 0">${escHtml(bk.business_address)}</td></tr>` : ''}
            </table>
            <p style="font-size:13px;color:#9C958E;margin-top:16px">Besoin de modifier ou annuler ? Utilisez le bouton ci-dessous.</p>
          `,
          ctaText: 'Gérer mon rendez-vous',
          ctaUrl: manageUrl24,
          cancelText: null,
          cancelUrl: null,
          footerText: `${bk.business_name} — Rendez-vous géré via Genda.be`
        });

        const result = await sendEmail({
          to: bk.client_email,
          toName: bk.client_name,
          subject: `Rappel : votre RDV du ${dateShort} à ${timeShort} — ${bk.business_name}`,
          html,
          fromName: bk.business_name,
          replyTo: null
        });

        if (result.success) {
          stats.email_24h++;
          anySent = true;
          await logNotification(bk, 'email_reminder_24h', 'sent', 'brevo', result.messageId);
        } else {
          stats.errors++;
          await logNotification(bk, 'email_reminder_24h', 'failed', 'brevo', null, result.error);
        }
      }

      // SMS 24h
      if (reminderSmsEnabled && bk.client_phone && bk.consent_sms) {
        const smsBody = `Rappel ${bk.business_name}: RDV le ${dateShort} à ${timeShort} avec ${bk.practitioner_name}. Modifier: ${manageUrl}`;

        const result = await sendSMS({
          to: bk.client_phone,
          body: smsBody,
          businessId: bk.business_id
        });

        if (result.success) {
          stats.sms_24h++;
          anySent = true;
          await logNotification(bk, 'sms_reminder_24h', 'sent', 'twilio', result.sid);
        } else {
          stats.errors++;
          await logNotification(bk, 'sms_reminder_24h', 'failed', 'twilio', null, result.error);
        }
      }

      // Mark as sent only if at least one notification succeeded
      if (anySent) {
        if (bk.group_id) {
          // Mark all siblings in the group as sent
          await query(
            `UPDATE bookings SET reminder_24h_sent_at = NOW() WHERE group_id = $1 AND business_id = $2 AND status = 'confirmed'`,
            [bk.group_id, bk.business_id]
          );
        } else {
          await query(
            `UPDATE bookings SET reminder_24h_sent_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'confirmed'`,
            [bk.id, bk.business_id]
          );
        }
      }
    } catch (err) {
      console.error(`[REMINDERS] Error processing 24h for booking ${bk.id}:`, err.message);
      stats.errors++;
    }
  }
}

/**
 * 2h reminders: SMS only (Pro/Premium, if enabled)
 * Window: between 2h and 1h before appointment
 */
async function process2hReminders(stats) {
  const bookings = await query(`
    SELECT
      bk.id, bk.start_at, bk.public_token,
      c.full_name AS client_name, c.email AS client_email,
      c.phone AS client_phone, c.consent_sms,
      p.display_name AS practitioner_name,
      b.id AS business_id, b.name AS business_name,
      b.plan, b.settings
    FROM bookings bk
    JOIN clients c ON c.id = bk.client_id
    JOIN practitioners p ON p.id = bk.practitioner_id
    JOIN businesses b ON b.id = bk.business_id
    WHERE bk.status = 'confirmed'
      AND bk.reminder_2h_sent_at IS NULL
      AND bk.start_at > NOW() + INTERVAL '1 hour'
      AND bk.start_at <= NOW() + INTERVAL '2 hours 15 minutes'
      AND b.is_active = true
    ORDER BY bk.start_at
    LIMIT 200
  `);

  for (const bk of bookings.rows) {
    const settings = bk.settings || {};
    const smsEnabled = settings.reminder_sms_2h === true && PLANS_WITH_SMS.includes(bk.plan);
    const emailEnabled = settings.reminder_email_2h === true;

    try {
      let anySent = false;
      const timeShort = new Date(bk.start_at).toLocaleTimeString('fr-BE', {
        timeZone: 'Europe/Brussels',
        hour: '2-digit', minute: '2-digit'
      });

      // SMS 2h
      if (smsEnabled && bk.client_phone && bk.consent_sms) {
        const smsBody = `${bk.business_name}: Rappel, votre RDV est dans 2h (${timeShort}) avec ${bk.practitioner_name}. À bientôt !`;

        const result = await sendSMS({
          to: bk.client_phone,
          body: smsBody,
          businessId: bk.business_id
        });

        if (result.success) {
          stats.sms_2h++;
          anySent = true;
          await logNotification(bk, 'sms_reminder_2h', 'sent', 'twilio', result.sid);
        } else {
          stats.errors++;
          await logNotification(bk, 'sms_reminder_2h', 'failed', 'twilio', null, result.error);
        }
      }

      // Email 2h (optional)
      if (emailEnabled && bk.client_email) {
        const baseUrl2h = process.env.APP_BASE_URL || 'https://genda.be';
        const manageUrl2h = `${baseUrl2h}/booking/${bk.public_token}`;
        const result = await sendEmail({
          to: bk.client_email,
          toName: bk.client_name,
          subject: `Votre RDV est dans 2h — ${bk.business_name}`,
          html: buildEmailHTML({
            title: 'Votre rendez-vous approche',
            preheader: `RDV à ${timeShort} chez ${bk.business_name}`,
            businessName: bk.business_name,
            bodyHTML: `<p>Bonjour ${escHtml(bk.client_name)},</p><p>Votre rendez-vous avec <strong>${escHtml(bk.practitioner_name)}</strong> est dans 2 heures, à <strong>${timeShort}</strong>.</p><p>À bientôt !</p>`,
            ctaText: 'Gérer mon rendez-vous',
            ctaUrl: manageUrl2h,
            cancelText: null,
            cancelUrl: null
          }),
          fromName: bk.business_name
        });

        if (result.success) {
          stats.email_2h++;
          anySent = true;
          // Bug B3 fix: was incorrectly using 'email_reminder_24h'
          await logNotification(bk, 'email_reminder_2h', 'sent', 'brevo', result.messageId);
        }
      }

      // Mark as sent only if at least one notification succeeded
      if (anySent) {
        await query(
          `UPDATE bookings SET reminder_2h_sent_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'confirmed'`,
          [bk.id, bk.business_id]
        );
      }
    } catch (err) {
      console.error(`[REMINDERS] Error processing 2h for booking ${bk.id}:`, err.message);
      stats.errors++;
    }
  }
}

/**
 * Log notification in the notifications table
 */
async function logNotification(bk, type, status, provider, providerId, error) {
  try {
    await queryWithRLS(bk.business_id,
      `INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status, provider, provider_message_id, error, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${status === 'sent' ? 'NOW()' : 'NULL'})`,
      [bk.business_id, bk.id, type, bk.client_email, bk.client_phone, status, provider, providerId || null, error || null]
    );
  } catch (e) {
    console.error('[REMINDERS] Log notification error:', e.message);
  }
}

module.exports = { processReminders };
