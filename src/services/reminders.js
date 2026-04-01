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
      COALESCE(sv.price_cents, s.price_cents) AS price_cents,
      b.id AS business_id, b.name AS business_name, b.slug,
      b.phone AS business_phone, b.address AS business_address,
      b.plan, b.settings, b.theme, b.email AS business_email,
      bk.promotion_label, bk.promotion_discount_cents,
      bk.discount_pct
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

      // Compute end time for display
      const totalDuration = bk.duration_min || 0;
      const endTime24 = new Date(new Date(bk.start_at).getTime() + totalDuration * 60000);
      const endTimeStr24 = endTime24 ? new Date(endTime24).toLocaleTimeString('fr-BE', {
        timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
      }) : null;

      const manageUrl = `${process.env.APP_BASE_URL || 'https://genda.be'}/booking/${bk.public_token}`;
      const primaryColor = bk.theme?.primary_color || '#0D7377';

      // Fetch group services if multi-service booking
      let groupServices = null;
      let groupEndAt = null;
      if (bk.group_id) {
        const grp = await query(
          `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  COALESCE(sv.price_cents, s.price_cents) AS price_cents, b.end_at,
                  b.practitioner_id, p.display_name AS practitioner_name,
                  b.discount_pct
           FROM bookings b LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           LEFT JOIN practitioners p ON p.id = b.practitioner_id
           WHERE b.group_id = $1 AND b.business_id = $2 ORDER BY b.group_order, b.start_at`,
          [bk.group_id, bk.business_id]
        );
        if (grp.rows.length > 1) {
          const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
          if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
          // Apply last-minute discount to each group member's price
          grp.rows.forEach(r => {
            if (r.discount_pct && r.price_cents) {
              r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100);
            }
          });
          groupServices = grp.rows;
          groupEndAt = grp.rows[grp.rows.length - 1].end_at;
        }
      }

      // Apply last-minute discount to single booking price
      const adjPriceCents = bk.discount_pct && bk.price_cents ? Math.round(bk.price_cents * (100 - bk.discount_pct) / 100) : bk.price_cents;

      const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
      let serviceHTML;
      const promoDiscount = parseInt(bk.promotion_discount_cents) || 0;
      const promoLabel = bk.promotion_label || '';

      if (isMulti) {
        serviceHTML = groupServices.map(s => {
          const price = s.price_cents ? ' \u00b7 ' + (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
          return `<div style="padding:2px 0;font-weight:600">\u2022 ${escHtml(s.name)} (${s.duration_min} min${price})</div>`;
        }).join('');
        const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
        const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
        const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
        if (totalPrice > 0 && promoDiscount > 0 && promoLabel) {
          const finalPrice = totalPrice - promoDiscount;
          serviceHTML += `<div style="padding:4px 0;font-weight:700">Total : ${durStr} \u00b7 <s style="opacity:.6">${(totalPrice / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPrice / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
          serviceHTML += `<div style="padding:2px 0;font-size:12px;color:#7A7470">${escHtml(promoLabel)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        } else {
          const totalPriceStr = totalPrice > 0 ? ' \u00b7 ' + (totalPrice / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
          serviceHTML += `<div style="padding:4px 0;font-weight:700">Total : ${durStr}${totalPriceStr}</div>`;
        }
      } else {
        if (adjPriceCents && promoDiscount > 0 && promoLabel) {
          const finalSingle = adjPriceCents - promoDiscount;
          serviceHTML = `<span style="font-weight:600">${escHtml(bk.service_name)} (${bk.duration_min} min \u00b7 <s style="opacity:.6">${(adjPriceCents / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalSingle / 100).toFixed(2).replace('.', ',')} \u20ac)</span>`;
          serviceHTML += `<div style="font-size:12px;color:#7A7470">${escHtml(promoLabel)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        } else {
          const singlePrice = adjPriceCents ? ' \u00b7 ' + (adjPriceCents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
          serviceHTML = `<span style="font-weight:600">${escHtml(bk.service_name)} (${bk.duration_min} min${singlePrice})</span>`;
        }
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
              <tr><td style="padding:8px 0;color:#7A7470;width:100px"> Date</td><td style="padding:8px 0;font-weight:600">${startLocal}${(() => { const et = isMulti && groupEndAt ? new Date(groupEndAt) : endTime24; const ets = et ? new Date(et).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) : null; return ets ? ' \u2013 ' + ets : ''; })()}</td></tr>
              <tr><td style="padding:8px 0;color:#7A7470">${isMulti ? ' Prestations' : ' Prestation'}</td><td style="padding:8px 0">${serviceHTML}</td></tr>
              <tr><td style="padding:8px 0;color:#7A7470"> Praticien</td><td style="padding:8px 0;font-weight:600">${escHtml(bk.practitioner_name)}</td></tr>
              ${bk.appointment_mode === 'cabinet' && bk.business_address ? `<tr><td style="padding:8px 0;color:#7A7470"> Adresse</td><td style="padding:8px 0"><a href="https://maps.google.com/?q=${encodeURIComponent(bk.business_address)}" style="color:inherit;text-decoration:underline">${escHtml(bk.business_address)}</a></td></tr>` : ''}
            </table>
            ${(() => { const cp = []; if (bk.business_phone) cp.push('📞 ' + escHtml(bk.business_phone)); if (bk.business_email) cp.push('✉️ ' + escHtml(bk.business_email)); return cp.length > 0 ? '<p style="font-size:13px;color:#7A7470;margin:12px 0">' + cp.join(' · ') + '</p>' : ''; })()}
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
          replyTo: bk.business_email || null
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
        const _svcLabel24 = (Array.isArray(groupServices) && groupServices.length > 1)
          ? `${groupServices[0].name} +${groupServices.length - 1}`
          : bk.service_name;
        const smsBody = `Rappel ${bk.business_name}: RDV "${_svcLabel24}" le ${dateShort} à ${timeShort} avec ${bk.practitioner_name}. Modifier: ${manageUrl}`;

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
      bk.id, bk.start_at, bk.end_at, bk.public_token,
      bk.group_id, bk.group_order,
      c.full_name AS client_name, c.email AS client_email,
      c.phone AS client_phone, c.consent_sms,
      p.display_name AS practitioner_name,
      CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
      COALESCE(sv.price_cents, s.price_cents) AS price_cents,
      bk.appointment_mode,
      bk.promotion_label, bk.promotion_discount_cents,
      bk.discount_pct,
      b.id AS business_id, b.name AS business_name,
      b.phone AS business_phone, b.address AS business_address,
      b.plan, b.settings, b.theme, b.email AS business_email
    FROM bookings bk
    JOIN clients c ON c.id = bk.client_id
    JOIN practitioners p ON p.id = bk.practitioner_id
    JOIN services s ON s.id = bk.service_id
    LEFT JOIN service_variants sv ON sv.id = bk.service_variant_id
    JOIN businesses b ON b.id = bk.business_id
    WHERE bk.status = 'confirmed'
      AND bk.reminder_2h_sent_at IS NULL
      AND bk.start_at > NOW() + INTERVAL '1 hour'
      AND bk.start_at <= NOW() + INTERVAL '2 hours 15 minutes'
      AND b.is_active = true
      AND (bk.group_id IS NULL OR bk.group_order = 0)
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
      const dateStr2h = new Date(bk.start_at).toLocaleDateString('fr-BE', {
        timeZone: 'Europe/Brussels',
        weekday: 'long', day: 'numeric', month: 'long'
      });

      // Fetch group services if multi-service booking
      let groupServices = null;
      if (bk.group_id) {
        const grp = await query(
          `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
                  COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                  COALESCE(sv.price_cents, s.price_cents) AS price_cents,
                  b2.end_at, b2.practitioner_id, p.display_name AS practitioner_name,
                  b2.discount_pct
           FROM bookings b2 LEFT JOIN services s ON s.id = b2.service_id
           LEFT JOIN service_variants sv ON sv.id = b2.service_variant_id
           LEFT JOIN practitioners p ON p.id = b2.practitioner_id
           WHERE b2.group_id = $1 AND b2.business_id = $2 ORDER BY b2.group_order, b2.start_at`,
          [bk.group_id, bk.business_id]
        );
        if (grp.rows.length > 1) {
          const _pIds = new Set(grp.rows.map(r => r.practitioner_id));
          if (_pIds.size <= 1) grp.rows.forEach(r => { r.practitioner_name = null; });
          // Apply last-minute discount to each group member's price
          grp.rows.forEach(r => {
            if (r.discount_pct && r.price_cents) {
              r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100);
            }
          });
          groupServices = grp.rows;
        }
      }

      // Compute end time for display
      const groupEndAt2h = groupServices ? groupServices[groupServices.length - 1].end_at : null;
      const endTime2h = new Date(new Date(bk.start_at).getTime() + (bk.duration_min || 0) * 60000);
      const actualEnd2h = (Array.isArray(groupServices) && groupServices.length > 1 && groupEndAt2h) ? new Date(groupEndAt2h) : endTime2h;
      const endTimeStr2h = actualEnd2h ? new Date(actualEnd2h).toLocaleTimeString('fr-BE', {
        timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
      }) : null;

      const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
      // Apply last-minute discount to single booking price (2h)
      const adjPriceCents2h = bk.discount_pct && bk.price_cents ? Math.round(bk.price_cents * (100 - bk.discount_pct) / 100) : bk.price_cents;

      // SMS 2h
      const manageUrl2hSms = `${process.env.APP_BASE_URL || 'https://genda.be'}/booking/${bk.public_token}`;
      if (smsEnabled && bk.client_phone && bk.consent_sms) {
        let smsBody;
        if (isMulti) {
          const serviceNames = groupServices.map(s => s.name).join(' + ');
          smsBody = `${bk.business_name}: Rappel, votre RDV est dans 2h (${timeShort}) — ${serviceNames}. Détails : ${manageUrl2hSms}`;
        } else {
          smsBody = `${bk.business_name}: Rappel, votre RDV "${bk.service_name}" est dans 2h (${timeShort}) avec ${bk.practitioner_name}. Détails : ${manageUrl2hSms}`;
        }

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
        const primaryColor = bk.theme?.primary_color || '#0D7377';

        const promoDiscount2h = parseInt(bk.promotion_discount_cents) || 0;
        const promoLabel2h = bk.promotion_label || '';

        let serviceHTML;
        if (isMulti) {
          serviceHTML = groupServices.map(s => {
            const price = s.price_cents ? ' \u00b7 ' + (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
            const pName = s.practitioner_name ? ` \u2014 ${escHtml(s.practitioner_name)}` : '';
            return `<div style="padding:2px 0;font-weight:600">\u2022 ${escHtml(s.name)} (${s.duration_min} min${price})${pName}</div>`;
          }).join('');
          const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
          const totalPrice2h = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
          const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
          if (totalPrice2h > 0 && promoDiscount2h > 0 && promoLabel2h) {
            const finalPrice2h = totalPrice2h - promoDiscount2h;
            serviceHTML += `<div style="padding:4px 0;font-weight:700">Total : ${durStr} \u00b7 <s style="opacity:.6">${(totalPrice2h / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPrice2h / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
            serviceHTML += `<div style="padding:2px 0;font-size:12px;color:#7A7470">${escHtml(promoLabel2h)} : -${(promoDiscount2h / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
          } else {
            const totalPriceStr2h = totalPrice2h > 0 ? ' \u00b7 ' + (totalPrice2h / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
            serviceHTML += `<div style="padding:4px 0;font-weight:700">Total : ${durStr}${totalPriceStr2h}</div>`;
          }
        } else {
          if (adjPriceCents2h && promoDiscount2h > 0 && promoLabel2h) {
            const finalSingle2h = adjPriceCents2h - promoDiscount2h;
            serviceHTML = `<strong>${escHtml(bk.service_name)}</strong> (${bk.duration_min} min \u00b7 <s style="opacity:.6">${(adjPriceCents2h / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalSingle2h / 100).toFixed(2).replace('.', ',')} \u20ac)`;
            serviceHTML += `<div style="font-size:12px;color:#7A7470">${escHtml(promoLabel2h)} : -${(promoDiscount2h / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
          } else {
            const singlePrice2h = adjPriceCents2h ? ' \u00b7 ' + (adjPriceCents2h / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
            serviceHTML = `<strong>${escHtml(bk.service_name)}</strong> (${bk.duration_min} min${singlePrice2h})`;
          }
        }

        const addressHTML = bk.appointment_mode === 'cabinet' && bk.business_address
          ? `<p style="font-size:13px;color:#7A7470;margin:8px 0 0">\ud83d\udccd <a href="https://maps.google.com/?q=${encodeURIComponent(bk.business_address)}" style="color:#7A7470;text-decoration:underline">${escHtml(bk.business_address)}</a></p>` : '';
        let singlePriceBody2h;
        if (adjPriceCents2h && promoDiscount2h > 0 && promoLabel2h) {
          const fs2h = adjPriceCents2h - promoDiscount2h;
          singlePriceBody2h = ` \u00b7 <s style="opacity:.6">${(adjPriceCents2h / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(fs2h / 100).toFixed(2).replace('.', ',')} \u20ac`;
        } else {
          singlePriceBody2h = adjPriceCents2h ? ' \u00b7 ' + (adjPriceCents2h / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
        }
        const promoLine2h = (!isMulti && promoDiscount2h > 0 && promoLabel2h) ? `<p style="font-size:12px;color:#7A7470;margin:4px 0 0">${escHtml(promoLabel2h)} : -${(promoDiscount2h / 100).toFixed(2).replace('.', ',')} \u20ac</p>` : '';
        const endTimeSuffix2h = endTimeStr2h ? ' \u2013 ' + endTimeStr2h : '';
        const contactBlock2h = (() => { const cp = []; if (bk.business_phone) cp.push('📞 ' + escHtml(bk.business_phone)); if (bk.business_email) cp.push('✉️ ' + escHtml(bk.business_email)); return cp.length > 0 ? '<p style="font-size:13px;color:#7A7470;margin:12px 0">' + cp.join(' · ') + '</p>' : ''; })();
        const bodyHTML = isMulti
          ? `<p>Bonjour ${escHtml(bk.client_name)},</p><p>Vos rendez-vous approchent, le <strong>${dateStr2h}</strong> \u00e0 <strong>${timeShort}${endTimeSuffix2h}</strong> :</p><div style="margin:12px 0">${serviceHTML}</div>${addressHTML}${contactBlock2h}<p>\u00c0 bient\u00f4t !</p>`
          : `<p>Bonjour ${escHtml(bk.client_name)},</p><p>Votre rendez-vous avec <strong>${escHtml(bk.practitioner_name)}</strong> est dans 2 heures, le <strong>${dateStr2h}</strong> \u00e0 <strong>${timeShort}${endTimeSuffix2h}</strong>.</p><p style="font-size:14px;margin:8px 0"><strong>${escHtml(bk.service_name)}</strong> (${bk.duration_min} min${singlePriceBody2h})</p>${promoLine2h}${addressHTML}${contactBlock2h}<p>\u00c0 bient\u00f4t !</p>`;

        const result = await sendEmail({
          to: bk.client_email,
          toName: bk.client_name,
          subject: `Votre RDV est dans 2h — ${bk.business_name}`,
          html: buildEmailHTML({
            title: 'Votre rendez-vous approche',
            preheader: `RDV à ${timeShort} chez ${bk.business_name}`,
            businessName: bk.business_name,
            primaryColor,
            bodyHTML,
            ctaText: 'Gérer mon rendez-vous',
            ctaUrl: manageUrl2h,
            cancelText: null,
            cancelUrl: null,
            footerText: `${bk.business_name} — Rendez-vous géré via Genda.be`
          }),
          fromName: bk.business_name,
          replyTo: bk.business_email || null
        });

        if (result.success) {
          stats.email_2h++;
          anySent = true;
          await logNotification(bk, 'email_reminder_2h', 'sent', 'brevo', result.messageId);
        }
      }

      // Mark as sent — if group, mark all siblings
      if (anySent) {
        if (bk.group_id) {
          await query(
            `UPDATE bookings SET reminder_2h_sent_at = NOW() WHERE group_id = $1 AND business_id = $2 AND status = 'confirmed'`,
            [bk.group_id, bk.business_id]
          );
        } else {
          await query(
            `UPDATE bookings SET reminder_2h_sent_at = NOW() WHERE id = $1 AND business_id = $2 AND status = 'confirmed'`,
            [bk.id, bk.business_id]
          );
        }
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
