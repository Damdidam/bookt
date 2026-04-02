/**
 * Email service — modification notification emails
 */

const { escHtml, fmtSvcLabel, safeColor, _ic, fmtTimeBrussels, sendEmail, buildBookingFooter, buildEmailHTML } = require('./email-utils');

/**
 * Send modification notification email with Confirm/Reject buttons
 */
async function sendModificationEmail({ booking, business, groupServices }) {
  const oldDate = new Date(booking.old_start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const oldTime = new Date(booking.old_start_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
  const newDate = new Date(booking.new_start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const newTime = fmtTimeBrussels(booking.new_start_at);
  // For multi-service: compute real end from start + total duration
  const isMultiMod = Array.isArray(groupServices) && groupServices.length > 1;
  const realOldEnd = isMultiMod
    ? new Date(new Date(booking.old_start_at).getTime() + groupServices.reduce((s, sv) => s + (sv.duration_min || 0), 0) * 60000)
    : new Date(booking.old_end_at);
  const oldEndTime = fmtTimeBrussels(realOldEnd);
  const realNewEnd = isMultiMod
    ? new Date(new Date(booking.new_start_at).getTime() + groupServices.reduce((s, sv) => s + (sv.duration_min || 0), 0) * 60000)
    : new Date(booking.new_end_at);
  const newEndTime = fmtTimeBrussels(realNewEnd);

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const confirmUrl = `${baseUrl}/api/public/booking/${booking.public_token}/confirm`;
  const rejectUrl = `${baseUrl}/api/public/booking/${booking.public_token}/reject`;
  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safePracName = escHtml(booking.practitioner_name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const safeServiceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  let serviceDetailOld = `<div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.6">${safeServiceName}</div>`;
  let serviceDetailNew = `<div style="font-size:13px;color:#15613A;font-weight:600">${safeServiceName}${safePracName ? ' \u00b7 ' + safePracName : ''}</div>`;
  if (isMulti) {
    serviceDetailOld = `<div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.6;margin-top:4px">Prestations :</div>`;
    groupServices.forEach(s => {
      const oldPrice = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailOld += `<div style="font-size:12px;color:#92700C;text-decoration:line-through;opacity:.6;padding:1px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${oldPrice ? ' \u00b7 ' + oldPrice : ''}${pracSuffix}</div>`;
    });
    serviceDetailNew = `<div style="font-size:13px;color:#15613A;font-weight:600;margin-top:4px">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailNew += `<div style="font-size:12px;color:#15613A;padding:1px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMinMod = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPriceMod = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const promoDiscMod = booking.promotion_discount_cents || 0;
    const finalPriceMod = totalPriceMod - promoDiscMod;
    const durStrMod = totalMinMod >= 60 ? Math.floor(totalMinMod / 60) + 'h' + (totalMinMod % 60 > 0 ? String(totalMinMod % 60).padStart(2, '0') : '') : totalMinMod + ' min';
    if (totalPriceMod > 0) {
      if (promoDiscMod > 0 && booking.promotion_label) {
        serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStrMod} \u00b7 <s style="opacity:.6">${(totalPriceMod / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPriceMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        serviceDetailNew += `<div style="font-size:11px;color:#15613A;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStrMod} \u00b7 ${(totalPriceMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    }
    const hasSplitPracMod = groupServices.some(s => s.practitioner_name);
    if (safePracName && !hasSplitPracMod) serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:4px">${safePracName}</div>`;
  } else {
    // Single-service: show price + promo
    const singlePriceMod = booking.service_price_cents || 0;
    if (singlePriceMod > 0) {
      const singleDurMod = booking.duration_min || '';
      const promoDiscSingleMod = booking.promotion_discount_cents || 0;
      if (promoDiscSingleMod > 0 && booking.promotion_label) {
        const finalSingleMod = singlePriceMod - promoDiscSingleMod;
        serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:6px;font-weight:700">${singleDurMod ? singleDurMod + ' min \u00b7 ' : ''}<s style="opacity:.6">${(singlePriceMod / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalSingleMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        serviceDetailNew += `<div style="font-size:11px;color:#15613A;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:4px">${singleDurMod ? singleDurMod + ' min \u00b7 ' : ''}${(singlePriceMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    }
  }

  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous a \u00e9t\u00e9 modifi\u00e9 :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #E6A817">
      <div style="font-size:13px;color:#92700C;margin-bottom:4px"><strong>Avant :</strong> ${oldDate} \u00e0 ${oldTime} \u2013 ${oldEndTime}</div>
      ${serviceDetailOld}
    </div>
    <div style="background:#EEFAF1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #1B7A42">
      <div style="font-size:13px;color:#15613A;margin-bottom:4px"><strong>Nouveau :</strong> ${newDate} \u00e0 ${newTime} \u2013 ${newEndTime}</div>
      ${serviceDetailNew}
    </div>`;

  // Deposit info for modification email
  if (booking.deposit_status === 'paid' && booking.deposit_amount_cents > 0) {
    const depAmtMod = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    bodyHTML += `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u2705 Votre acompte de ${depAmtMod}\u00a0\u20ac reste valable pour ce nouveau cr\u00e9neau.</div>
    </div>`;
  }

  bodyHTML += `
    <p style="margin-top:20px;font-size:15px">Ce nouvel horaire vous convient-il ?</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${escHtml(confirmUrl)}" style="display:inline-block;padding:14px 36px;background:${color};color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-right:12px"> Oui, \u00e7a me va</a>
      <a href="${escHtml(rejectUrl)}" style="display:inline-block;padding:14px 36px;background:#fff;color:#C62828;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;border:2px solid #E57373"> Non</a>
    </div>
    <p style="font-size:12px;color:#9C958E;text-align:center">Si vous ne r\u00e9pondez pas, le nouveau cr\u00e9neau sera automatiquement confirm\u00e9.</p>
    <div style="text-align:center;margin:20px 0 0;padding-top:16px;border-top:1px solid #E0DDD8">
      <a href="${escHtml(manageUrl || '')}" style="font-size:13px;color:#C62828;text-decoration:none;font-weight:600">Annuler le rendez-vous</a>
    </div>`;

  // Footer: address, contact, payment methods, calendar links (for the NEW slot)
  const serviceNameMod = isMulti ? safeServiceName : fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label);
  bodyHTML += buildBookingFooter({
    business, booking, serviceName: serviceNameMod,
    practitionerName: booking.practitioner_name || '',
    startAt: booking.new_start_at, endAt: realNewEnd.toISOString(),
    publicToken: booking.public_token || null
  });

  const html = buildEmailHTML({
    title: isMulti ? 'Modification de vos prestations' : 'Modification de votre rendez-vous',
    preheader: `Nouveau cr\u00e9neau : ${newDate} \u00e0 ${newTime}`,
    bodyHTML,
    businessName: business.name,
    primaryColor: color,
    cancelText: manageUrl ? 'Gérer mon rendez-vous' : null,
    cancelUrl: manageUrl,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Modification de votre RDV \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

module.exports = { sendModificationEmail };
