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
    const totalOriginalMod = groupServices.reduce((sum, s) => sum + (s.original_price_cents || s.price_cents || 0), 0);
    const hasMultiLmMod = totalOriginalMod > totalPriceMod;
    const promoDiscMod = booking.promotion_discount_cents || 0;
    const finalPriceMod = totalPriceMod - promoDiscMod;
    const durStrMod = totalMinMod >= 60 ? Math.floor(totalMinMod / 60) + 'h' + (totalMinMod % 60 > 0 ? String(totalMinMod % 60).padStart(2, '0') : '') : totalMinMod + ' min';
    if (totalPriceMod > 0) {
      if (hasMultiLmMod || (promoDiscMod > 0 && booking.promotion_label)) {
        const displayBaseMod = hasMultiLmMod ? totalOriginalMod : totalPriceMod;
        serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStrMod} \u00b7 <s style="opacity:.6">${(displayBaseMod / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPriceMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (hasMultiLmMod) serviceDetailNew += `<div style="font-size:11px;color:#15613A;opacity:.8">Last Minute : -${((totalOriginalMod - totalPriceMod) / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (promoDiscMod > 0 && booking.promotion_label) serviceDetailNew += `<div style="font-size:11px;color:#15613A;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStrMod} \u00b7 ${(totalPriceMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    }
    const hasSplitPracMod = groupServices.some(s => s.practitioner_name);
    if (safePracName && !hasSplitPracMod) serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:4px">${safePracName}</div>`;
  } else {
    // Single-service: show price + LM discount + promo
    const rawPriceMod = booking.service_price_cents || 0;
    const singlePriceMod = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceMod * (100 - booking.discount_pct) / 100) : rawPriceMod);
    if (singlePriceMod > 0) {
      const singleDurMod = booking.duration_min || '';
      const promoDiscSingleMod = booking.promotion_discount_cents || 0;
      const hasLmMod = booking.discount_pct && rawPriceMod > singlePriceMod;
      const finalSingleMod = singlePriceMod - promoDiscSingleMod;
      if (hasLmMod || (promoDiscSingleMod > 0 && booking.promotion_label)) {
        const displayBaseMod = hasLmMod ? rawPriceMod : singlePriceMod;
        serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:6px;font-weight:700">${singleDurMod ? singleDurMod + ' min \u00b7 ' : ''}<s style="opacity:.6">${(displayBaseMod / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalSingleMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (hasLmMod) serviceDetailNew += `<div style="font-size:11px;color:#15613A;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingleMod > 0 && booking.promotion_label) serviceDetailNew += `<div style="font-size:11px;color:#15613A;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleMod / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
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

  // Deposit info for modification email — show both paid AND pending states
  // BUG-MODIF-DEPOSIT-PENDING fix: pending deposit was silently omitted from modification
  // email, client thought no payment was required for the new slot → missed deadline.
  if (booking.deposit_status === 'paid' && booking.deposit_amount_cents > 0) {
    const depAmtMod = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    bodyHTML += `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u2705 Votre acompte de ${depAmtMod}\u00a0\u20ac reste valable pour ce nouveau cr\u00e9neau.</div>
    </div>`;
  } else if (booking.deposit_status === 'pending' && booking.deposit_amount_cents > 0) {
    const depAmtPend = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    const depDeadline = booking.deposit_deadline
      ? new Date(booking.deposit_deadline).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    bodyHTML += `
    <div style="background:#FEF3C7;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #E6A817">
      <div style="font-size:14px;color:#92400E;font-weight:600">\u26A0 Acompte de ${depAmtPend}\u00a0\u20ac \u00e0 r\u00e9gler${depDeadline ? ' avant le ' + depDeadline : ''}.</div>
    </div>`;
  }

  // BUG-MODIF-COMMENT fix: afficher remarque client (parité email-cancel).
  const _modifComment = booking.comment || booking.comment_client;
  if (_modifComment && String(_modifComment).trim()) {
    bodyHTML += `<div style="background:#F5F4F1;border-radius:8px;padding:12px 14px;margin:14px 0;font-size:13px;color:#3D3832"><strong>Votre remarque :</strong><br>${escHtml(_modifComment)}</div>`;
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

/**
 * Send a simple "practitioner changed" notification to the client.
 * Used when staff reassigns a booking to a different practitioner via /edit
 * (no time change — just the person is swapped). Without this email, the
 * client discovers the change on arrival at the salon.
 */
async function sendPractitionerChangeEmail({ booking, business }) {
  if (!booking.client_email) return { success: false, error: 'no_client_email' };
  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name || 'Client');
  const oldPrac = escHtml(booking.old_practitioner_name || '');
  const newPrac = escHtml(booking.new_practitioner_name || '');
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;

  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const safeService = escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Petit changement concernant votre rendez-vous : la personne qui vous recevra a \u00e9t\u00e9 modifi\u00e9e.</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #E6A817">
      <div style="font-size:13px;color:#92700C;margin-bottom:4px"><strong>Avant :</strong> avec <s style="opacity:.7">${oldPrac || '—'}</s></div>
    </div>
    <div style="background:#EEFAF1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #1B7A42">
      <div style="font-size:14px;color:#15613A;margin-bottom:4px"><strong>Nouveau :</strong> avec <strong>${newPrac || '—'}</strong></div>
      <div style="font-size:13px;color:#15613A;margin-top:6px">${escHtml(dateStr)} \u00e0 ${escHtml(timeStr)}</div>
      <div style="font-size:13px;color:#15613A">${safeService}</div>
    </div>
    <p style="font-size:14px;color:#3D3832">Votre cr\u00e9neau reste identique. Si ce changement ne vous convient pas, n'h\u00e9sitez pas \u00e0 nous contacter.</p>`;

  const html = buildEmailHTML({
    title: 'Changement de praticien',
    preheader: `Votre RDV est maintenant avec ${booking.new_practitioner_name || ''}`,
    bodyHTML,
    ctaText: manageUrl ? 'G\u00e9rer mon rendez-vous' : null,
    ctaUrl: manageUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Changement de praticien \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

module.exports = { sendModificationEmail, sendPractitionerChangeEmail };
