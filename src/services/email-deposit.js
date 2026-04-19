/**
 * Email service — deposit-related emails (request, reminder, paid, refund)
 */

const { escHtml, fmtSvcLabel, safeColor, _ic, getRealEndAt, fmtTimeBrussels, sendEmail, buildBookingFooter, buildEmailHTML } = require('./email-utils');

/**
 * Send deposit request email to client
 */
async function sendDepositRequestEmail({ booking, business, depositUrl, payUrl, groupServices }) {
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const realEnd = getRealEndAt(booking, groupServices);
  const endTimeStr = realEnd ? fmtTimeBrussels(realEnd) : null;
  const totalDepCents = booking.deposit_amount_cents || 0;
  const gcPartialCents = booking.gc_partial_cents || 0;
  const remainingCents = totalDepCents - gcPartialCents;
  const amtStr = (totalDepCents / 100).toFixed(2).replace('.', ',');
  const remainStr = gcPartialCents > 0 ? (remainingCents / 100).toFixed(2).replace('.', ',') : amtStr;
  const gcPartialStr = gcPartialCents > 0 ? (gcPartialCents / 100).toFixed(2).replace('.', ',') : null;
  const deadlineStr = booking.deposit_deadline
    ? new Date(booking.deposit_deadline).toLocaleDateString('fr-BE', {
        timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit'
      })
    : null;

  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safePracName = escHtml(booking.practitioner_name || '');
  const safeBizName = escHtml(business.name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const safeServiceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  const cancelDeadlineH = business.settings?.cancel_deadline_hours ?? 24;

  let serviceDetailHTML = '';
  if (isMulti) {
    serviceDetailHTML += `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMinDR = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPriceDR = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const totalOriginalDR = groupServices.reduce((sum, s) => sum + (s.original_price_cents || s.price_cents || 0), 0);
    const hasMultiLmDR = totalOriginalDR > totalPriceDR;
    const promoDiscDR = booking.promotion_discount_cents || 0;
    const finalPriceDR = totalPriceDR - promoDiscDR;
    const durStrDR = totalMinDR >= 60 ? Math.floor(totalMinDR / 60) + 'h' + (totalMinDR % 60 > 0 ? String(totalMinDR % 60).padStart(2, '0') : '') : totalMinDR + ' min';
    if (totalPriceDR > 0) {
      if (hasMultiLmDR || (promoDiscDR > 0 && booking.promotion_label)) {
        const displayBaseDR = hasMultiLmDR ? totalOriginalDR : totalPriceDR;
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrDR} \u00b7 <s style="opacity:.6">${(displayBaseDR / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPriceDR / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (hasMultiLmDR) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">Last Minute : -${((totalOriginalDR - totalPriceDR) / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (promoDiscDR > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscDR / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrDR} \u00b7 ${(totalPriceDR / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    }
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#92700C">${safeServiceName}</div>`;
    // Single-service: show price + LM discount + promo
    const rawPriceDR = booking.service_price_cents || 0;
    const singlePriceDR = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceDR * (100 - booking.discount_pct) / 100) : rawPriceDR);
    if (singlePriceDR > 0) {
      const singleDurDR = booking.duration_min || '';
      const promoDiscSingleDR = booking.promotion_discount_cents || 0;
      const hasLmDR = booking.discount_pct && rawPriceDR > singlePriceDR;
      const finalSingleDR = singlePriceDR - promoDiscSingleDR;
      if (hasLmDR || (promoDiscSingleDR > 0 && booking.promotion_label)) {
        const displayBaseDR = hasLmDR ? rawPriceDR : singlePriceDR;
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">${singleDurDR ? singleDurDR + ' min · ' : ''}<s style="opacity:.6">${(displayBaseDR / 100).toFixed(2).replace('.', ',')} €</s> ${(finalSingleDR / 100).toFixed(2).replace('.', ',')} €</div>`;
        if (hasLmDR) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingleDR > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleDR / 100).toFixed(2).replace('.', ',')} €</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:4px">${singleDurDR ? singleDurDR + ' min · ' : ''}${(singlePriceDR / 100).toFixed(2).replace('.', ',')} €</div>`;
      }
    }
  }

  const hasSplitPracDR = isMulti && groupServices.some(s => s.practitioner_name);
  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Un acompte est requis pour confirmer votre rendez-vous :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #F59E0B">
      <div style="font-size:15px;font-weight:600;color:#92700C;margin-bottom:4px">${_ic('calendar-amb')} ${dateStr}</div>
      <div style="font-size:14px;color:#92700C">${_ic('clock-amb')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName && !hasSplitPracDR ? `<div style="font-size:14px;color:#92700C">${safePracName}</div>` : ''}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0;text-align:center">
      <div style="font-size:13px;font-weight:600;color:#6B6560;text-transform:uppercase;margin-bottom:4px">Montant de l'acompte</div>
      <div style="font-size:24px;font-weight:800;color:#1A1816">${remainStr}\u00a0\u20ac</div>
      ${gcPartialStr ? `<div style="font-size:13px;color:#5D4037;margin-top:6px">\u{1F381} ${gcPartialStr}\u00a0\u20ac d\u00e9j\u00e0 d\u00e9duits de votre carte cadeau</div>` : ''}
      ${deadlineStr ? `<div style="font-size:12px;color:#92700C;margin-top:6px">\u00c0 r\u00e9gler avant le ${deadlineStr}</div>` : ''}
    </div>
    <div style="background:#F0F9FF;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #60A5FA">
      <div style="font-size:13px;color:#1E40AF;line-height:1.5">
        ${_ic('info', 16, 16)} <strong>Bon \u00e0 savoir :</strong><br>
        \u2022 Cet acompte sera <strong>d\u00e9duit de votre facture totale</strong> lors de votre passage.<br>
        \u2022 Il est <strong>restituable</strong> en cas d'annulation jusqu'\u00e0 <strong>${cancelDeadlineH}h avant</strong> votre rendez-vous.
      </div>
    </div>
    <p style="font-size:13px;color:#92700C;margin-top:12px">\u26a0\ufe0f Pass\u00e9 ce d\u00e9lai, votre rendez-vous sera automatiquement annul\u00e9.</p>`;

  // Footer: address, contact, payment methods, calendar links
  const serviceNameDR = isMulti ? safeServiceName : fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label);
  const calEndAtDR = realEnd ? realEnd.toISOString() : (booking.end_at || booking.start_at);
  bodyHTML += buildBookingFooter({
    business, booking, serviceName: serviceNameDR,
    practitionerName: booking.practitioner_name || '',
    startAt: booking.start_at, endAt: calEndAtDR,
    publicToken: booking.public_token || null
  });

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const directPayUrl = payUrl || (booking.public_token ? `${baseUrl}/api/public/deposit/${booking.public_token}/pay` : depositUrl);
  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;

  const html = buildEmailHTML({
    title: 'Acompte requis pour votre rendez-vous',
    preheader: `Acompte de ${amtStr}\u20ac requis avant votre RDV du ${dateStr}`,
    bodyHTML,
    ctaText: `Payer ${remainStr}\u00a0\u20ac en ligne`,
    ctaUrl: directPayUrl,
    cancelText: manageUrl ? 'Gérer mon rendez-vous' : null,
    cancelUrl: manageUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Acompte requis \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Send deposit REMINDER email — urgent tone, same structure as request
 * Sent automatically 48h before deadline via cron
 */
async function sendDepositReminderEmail({ booking, business, depositUrl, payUrl, groupServices }) {
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const realEnd = getRealEndAt(booking, groupServices);
  const endTimeStr = realEnd ? fmtTimeBrussels(realEnd) : null;
  const totalDepCents = booking.deposit_amount_cents || 0;
  const gcPartialCents = booking.gc_partial_cents || 0;
  const remainingCents = totalDepCents - gcPartialCents;
  const amtStr = (totalDepCents / 100).toFixed(2).replace('.', ',');
  const remainStr = gcPartialCents > 0 ? (remainingCents / 100).toFixed(2).replace('.', ',') : amtStr;
  const deadlineStr = booking.deposit_deadline
    ? new Date(booking.deposit_deadline).toLocaleDateString('fr-BE', {
        timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit'
      })
    : null;

  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safePracName = escHtml(booking.practitioner_name || '');
  const safeBizName = escHtml(business.name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const safeServiceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  const cancelDeadlineH = business.settings?.cancel_deadline_hours ?? 24;

  // Calculate hours remaining until deadline
  const hoursLeft = booking.deposit_deadline
    ? Math.max(0, Math.round((new Date(booking.deposit_deadline).getTime() - Date.now()) / 3600000))
    : null;
  const timeLeftStr = hoursLeft !== null
    ? (hoursLeft >= 24 ? Math.floor(hoursLeft / 24) + ' jour' + (Math.floor(hoursLeft / 24) > 1 ? 's' : '') : hoursLeft + 'h')
    : '';

  let serviceDetailHTML = '';
  if (isMulti) {
    serviceDetailHTML += `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMinDRem = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPriceDRem = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const totalOriginalDRem = groupServices.reduce((sum, s) => sum + (s.original_price_cents || s.price_cents || 0), 0);
    const hasMultiLmDRem = totalOriginalDRem > totalPriceDRem;
    const promoDiscDRem = booking.promotion_discount_cents || 0;
    const finalPriceDRem = totalPriceDRem - promoDiscDRem;
    const durStrDRem = totalMinDRem >= 60 ? Math.floor(totalMinDRem / 60) + 'h' + (totalMinDRem % 60 > 0 ? String(totalMinDRem % 60).padStart(2, '0') : '') : totalMinDRem + ' min';
    if (totalPriceDRem > 0) {
      if (hasMultiLmDRem || (promoDiscDRem > 0 && booking.promotion_label)) {
        const displayBaseDRem = hasMultiLmDRem ? totalOriginalDRem : totalPriceDRem;
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrDRem} \u00b7 <s style="opacity:.6">${(displayBaseDRem / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPriceDRem / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (hasMultiLmDRem) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">Last Minute : -${((totalOriginalDRem - totalPriceDRem) / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (promoDiscDRem > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscDRem / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrDRem} \u00b7 ${(totalPriceDRem / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    } else {
      serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrDRem}</div>`;
    }
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#92700C">${safeServiceName}</div>`;
    // Single-service: show price + LM discount + promo
    const rawPriceDRem = booking.service_price_cents || 0;
    const singlePriceDRem = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceDRem * (100 - booking.discount_pct) / 100) : rawPriceDRem);
    if (singlePriceDRem > 0) {
      const singleDurDRem = booking.duration_min || '';
      const promoDiscSingleDRem = booking.promotion_discount_cents || 0;
      const hasLmDRem = booking.discount_pct && rawPriceDRem > singlePriceDRem;
      const finalSingleDRem = singlePriceDRem - promoDiscSingleDRem;
      if (hasLmDRem || (promoDiscSingleDRem > 0 && booking.promotion_label)) {
        const displayBaseDRem = hasLmDRem ? rawPriceDRem : singlePriceDRem;
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">${singleDurDRem ? singleDurDRem + ' min \u00b7 ' : ''}<s style="opacity:.6">${(displayBaseDRem / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalSingleDRem / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (hasLmDRem) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingleDRem > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#92700C;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleDRem / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#92700C;margin-top:4px">${singleDurDRem ? singleDurDRem + ' min \u00b7 ' : ''}${(singlePriceDRem / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    }
  }

  const hasSplitPracDRem = isMulti && groupServices.some(s => s.practitioner_name);
  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
      <div style="font-size:14px;font-weight:700;color:#DC2626;margin-bottom:4px">\u26a0\ufe0f Rappel : votre acompte n'a pas encore \u00e9t\u00e9 r\u00e9gl\u00e9</div>
      <div style="font-size:13px;color:#991B1B">Il vous reste <strong>${timeLeftStr}</strong> pour r\u00e9gler votre acompte.${deadlineStr ? ' <strong>Date limite : ' + deadlineStr + '.</strong>' : ''}</div>
      <div style="font-size:13px;color:#991B1B;margin-top:4px">Sans paiement avant cette date, <strong>votre rendez-vous sera automatiquement annul\u00e9</strong>.</div>
    </div>
    <p style="font-size:14px;color:#44403C">Votre rendez-vous :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #F59E0B">
      <div style="font-size:15px;font-weight:600;color:#92700C;margin-bottom:4px">${_ic('calendar-amb')} ${dateStr}</div>
      <div style="font-size:14px;color:#92700C">${_ic('clock-amb')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName && !hasSplitPracDRem ? `<div style="font-size:14px;color:#92700C">${safePracName}</div>` : ''}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0;text-align:center">
      <div style="font-size:13px;font-weight:600;color:#6B6560;text-transform:uppercase;margin-bottom:4px">Montant de l'acompte</div>
      <div style="font-size:24px;font-weight:800;color:#1A1816">${remainStr}\u00a0\u20ac</div>
      ${gcPartialCents > 0 ? `<div style="font-size:12px;color:#059669;margin-top:4px">${(gcPartialCents / 100).toFixed(2).replace('.', ',')} \u20ac d\u00e9j\u00e0 d\u00e9duit(s) de votre carte cadeau</div>` : ''}
      ${deadlineStr ? `<div style="font-size:12px;color:#DC2626;margin-top:6px;font-weight:600">\u00c0 r\u00e9gler avant le ${deadlineStr}</div>` : ''}
    </div>
    <div style="background:#F0F9FF;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #60A5FA">
      <div style="font-size:13px;color:#1E40AF;line-height:1.5">
        ${_ic('info', 16, 16)} <strong>Bon \u00e0 savoir :</strong><br>
        \u2022 Cet acompte sera <strong>d\u00e9duit de votre facture totale</strong> lors de votre passage.<br>
        \u2022 Il est <strong>restituable</strong> en cas d'annulation jusqu'\u00e0 <strong>${cancelDeadlineH}h avant</strong> votre rendez-vous.
      </div>
    </div>`;

  // Footer: address, contact, payment methods, calendar links
  const serviceNameDRem = isMulti ? safeServiceName : fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label);
  const calEndAtDRem = realEnd ? realEnd.toISOString() : (booking.end_at || booking.start_at);
  bodyHTML += buildBookingFooter({
    business, booking, serviceName: serviceNameDRem,
    practitionerName: booking.practitioner_name || '',
    startAt: booking.start_at, endAt: calEndAtDRem,
    publicToken: booking.public_token || null
  });

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const directPayUrl = payUrl || (booking.public_token ? `${baseUrl}/api/public/deposit/${booking.public_token}/pay` : depositUrl);
  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;

  const html = buildEmailHTML({
    title: 'Rappel : acompte en attente',
    preheader: `Rappel — Acompte de ${amtStr}\u20ac \u00e0 r\u00e9gler sous ${timeLeftStr} pour votre RDV du ${dateStr}`,
    bodyHTML,
    ctaText: `Payer ${remainStr}\u00a0\u20ac maintenant`,
    ctaUrl: directPayUrl,
    cancelText: manageUrl ? 'Gérer mon rendez-vous' : null,
    cancelUrl: manageUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `\u26a0\ufe0f Rappel acompte \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Send deposit paid confirmation email to client
 */
async function sendDepositPaidEmail({ booking, business, groupServices }) {
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const realEnd = getRealEndAt(booking, groupServices);
  const endTimeStr = realEnd ? fmtTimeBrussels(realEnd) : null;
  const amtStr = ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');

  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safePracName = escHtml(booking.practitioner_name || '');
  const safeBizName = escHtml(business.name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const safeServiceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  let serviceDetailHTML = '';
  if (isMulti) {
    serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const totalOriginalDP = groupServices.reduce((sum, s) => sum + (s.original_price_cents || s.price_cents || 0), 0);
    const hasMultiLmDP = totalOriginalDP > totalPrice;
    const promoDiscount = booking.promotion_discount_cents || 0;
    const finalPrice = totalPrice - promoDiscount;
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    let priceHtml = '';
    if (totalPrice > 0) {
      if (hasMultiLmDP || (promoDiscount > 0 && booking.promotion_label)) {
        const displayBaseDP = hasMultiLmDP ? totalOriginalDP : totalPrice;
        priceHtml = ` \u00b7 <s style="opacity:.6">${(displayBaseDP / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPrice / 100).toFixed(2).replace('.', ',')} \u20ac`;
        serviceDetailHTML += `<div style="font-size:14px;color:#1A1816;margin-top:6px;font-weight:700">Total : ${durStr}${priceHtml}</div>`;
        if (hasMultiLmDP) serviceDetailHTML += `<div style="font-size:12px;color:#1A1816;opacity:.8">Last Minute : -${((totalOriginalDP - totalPrice) / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (promoDiscount > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#1A1816;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        priceHtml = ` \u00b7 ${(totalPrice / 100).toFixed(2).replace('.', ',')} \u20ac`;
        serviceDetailHTML += `<div style="font-size:14px;color:#1A1816;margin-top:6px;font-weight:700">Total : ${durStr}${priceHtml}</div>`;
      }
    } else {
      serviceDetailHTML += `<div style="font-size:14px;color:#1A1816;margin-top:6px;font-weight:700">Total : ${durStr}</div>`;
    }
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
    // Single-service: show price + LM discount + promo
    const rawPriceDP = booking.service_price_cents || 0;
    const singlePriceDP = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceDP * (100 - booking.discount_pct) / 100) : rawPriceDP);
    if (singlePriceDP > 0) {
      const singleDurDP = booking.duration_min || '';
      const promoDiscSingleDP = booking.promotion_discount_cents || 0;
      const hasLmDP = booking.discount_pct && rawPriceDP > singlePriceDP;
      const finalSingleDP = singlePriceDP - promoDiscSingleDP;
      if (hasLmDP || (promoDiscSingleDP > 0 && booking.promotion_label)) {
        const displayBaseDP = hasLmDP ? rawPriceDP : singlePriceDP;
        serviceDetailHTML += `<div style="font-size:14px;color:#1A1816;margin-top:6px;font-weight:700">${singleDurDP ? singleDurDP + ' min · ' : ''}<s style="opacity:.6">${(displayBaseDP / 100).toFixed(2).replace('.', ',')} €</s> ${(finalSingleDP / 100).toFixed(2).replace('.', ',')} €</div>`;
        if (hasLmDP) serviceDetailHTML += `<div style="font-size:12px;color:#1A1816;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingleDP > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#1A1816;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleDP / 100).toFixed(2).replace('.', ',')} €</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#3D3832;margin-top:4px">${singleDurDP ? singleDurDP + ' min · ' : ''}${(singlePriceDP / 100).toFixed(2).replace('.', ',')} €</div>`;
      }
    }
  }

  const hasSplitPracDP = isMulti && groupServices.some(s => s.practitioner_name);
  // Breakdown: GC portion vs Stripe portion
  const gcPaidCents = booking.gc_paid_cents || 0;
  const stripePaidCents = (booking.deposit_amount_cents || 0) - gcPaidCents;
  let depositBreakdown = '';
  if (gcPaidCents > 0 && stripePaidCents > 0) {
    const gcStr = (gcPaidCents / 100).toFixed(2).replace('.', ',');
    const stripeStr = (stripePaidCents / 100).toFixed(2).replace('.', ',');
    depositBreakdown = `
      <div style="font-size:13px;color:#15803D;margin-top:6px">\u{1F381} ${gcStr}\u00a0\u20ac via carte cadeau \u00b7 ${stripeStr}\u00a0\u20ac par carte bancaire</div>`;
  } else if (gcPaidCents > 0) {
    depositBreakdown = `
      <div style="font-size:13px;color:#15803D;margin-top:6px">\u{1F381} Pay\u00e9 via carte cadeau</div>`;
  }

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre acompte a bien \u00e9t\u00e9 re\u00e7u. Votre rendez-vous est confirm\u00e9 !</p>
    <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:15px;font-weight:600;color:#15803D;margin-bottom:4px">${_ic('check')} Acompte de ${amtStr}\u00a0\u20ac re\u00e7u</div>
      <div style="font-size:14px;color:#15803D">Votre rendez-vous est confirm\u00e9</div>${depositBreakdown}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0">
      <div style="font-size:14px;font-weight:600;color:#1A1816;margin-bottom:4px">${_ic('calendar-dk')} ${dateStr}</div>
      <div style="font-size:14px;color:#1A1816">${_ic('clock-dk')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName && !hasSplitPracDP ? `<div style="font-size:14px;color:#6B6560">${safePracName}</div>` : ''}
    </div>
    <p style="font-size:14px;color:#3D3832">Le montant de l'acompte sera <strong>d\u00e9duit du prix total</strong> de votre prestation lors de votre passage.</p>`;

  // Reste à payer — compute total price minus deposit
  const totalCentsDP = isMulti
    ? groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0) - (booking.promotion_discount_cents || 0)
    : (booking.booked_price_cents || (booking.discount_pct ? Math.round((booking.service_price_cents || 0) * (100 - booking.discount_pct) / 100) : (booking.service_price_cents || 0))) - (booking.promotion_discount_cents || 0);
  const resteCentsDP = totalCentsDP - (booking.deposit_amount_cents || 0);
  if (resteCentsDP > 0) {
    const resteStrDP = (resteCentsDP / 100).toFixed(2).replace('.', ',');
    bodyHTML += `
    <div style="background:#F5F4F1;border-radius:8px;padding:10px 16px;margin:12px 0;border-left:3px solid #6B6560">
      <div style="font-size:14px;color:#3D3832;font-weight:600">Reste \u00e0 payer sur place : ${resteStrDP}\u00a0\u20ac</div>
    </div>`;
  }

  bodyHTML += `
    <p style="font-size:13px;color:#6B6560">En cas d'annulation jusqu'\u00e0 ${business.settings?.cancel_deadline_hours ?? 24}h avant votre rendez-vous, l'acompte vous sera restitu\u00e9${gcPaidCents > 0 && stripePaidCents > 0 ? ' (carte cadeau recr\u00e9dit\u00e9e + remboursement bancaire)' : gcPaidCents > 0 ? ' sur votre carte cadeau' : ''}.</p>`;

  // Footer: address, contact, payment methods, calendar links
  const depCalEndAt = realEnd ? realEnd.toISOString() : (booking.end_at || booking.start_at);
  bodyHTML += buildBookingFooter({
    business, booking, serviceName: safeServiceName,
    practitionerName: booking.practitioner_name || '',
    startAt: booking.start_at, endAt: depCalEndAt,
    publicToken: booking.public_token || null
  });

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';

  const html = buildEmailHTML({
    title: 'Acompte confirmé — Rendez-vous validé',
    preheader: `Votre acompte de ${amtStr}€ a été reçu. RDV confirmé le ${dateStr}`,
    bodyHTML,
    ctaText: null,
    ctaUrl: null,
    cancelText: booking.public_token ? 'Gérer mon rendez-vous' : null,
    cancelUrl: booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' · ' + business.address : ''} · Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Acompte re\u00e7u \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Send deposit refund confirmation email to client
 */
async function sendDepositRefundEmail({ booking, business, groupServices }) {
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const realEnd = getRealEndAt(booking, groupServices);
  const endTimeStr = realEnd ? fmtTimeBrussels(realEnd) : null;
  const amtStr = ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
  // M2 fix: actual amount Stripe sent back (net of fees in policy='net'), falls back to deposit_amount when not provided
  const stripeNetCents = booking.net_refund_cents != null
    ? booking.net_refund_cents
    : Math.max((booking.deposit_amount_cents || 0) - (booking.gc_paid_cents || 0), 0);
  const stripeNetStr = (stripeNetCents / 100).toFixed(2).replace('.', ',');

  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safePracName = escHtml(booking.practitioner_name || '');
  const safeBizName = escHtml(business.name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const safeServiceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  let serviceDetailHTML = '';
  if (isMulti) {
    serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMinRF = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPriceRF = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const totalOriginalRF = groupServices.reduce((sum, s) => sum + (s.original_price_cents || s.price_cents || 0), 0);
    const hasMultiLmRF = totalOriginalRF > totalPriceRF;
    const promoDiscRF = booking.promotion_discount_cents || 0;
    const finalPriceRF = totalPriceRF - promoDiscRF;
    const durStrRF = totalMinRF >= 60 ? Math.floor(totalMinRF / 60) + 'h' + (totalMinRF % 60 > 0 ? String(totalMinRF % 60).padStart(2, '0') : '') : totalMinRF + ' min';
    if (totalPriceRF > 0) {
      if (hasMultiLmRF || (promoDiscRF > 0 && booking.promotion_label)) {
        const displayBaseRF = hasMultiLmRF ? totalOriginalRF : totalPriceRF;
        serviceDetailHTML += `<div style="font-size:14px;color:#3D3832;margin-top:6px;font-weight:700">Total : ${durStrRF} \u00b7 <s style="opacity:.6">${(displayBaseRF / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPriceRF / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (hasMultiLmRF) serviceDetailHTML += `<div style="font-size:12px;color:#3D3832;opacity:.8">Last Minute : -${((totalOriginalRF - totalPriceRF) / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (promoDiscRF > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#3D3832;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscRF / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#3D3832;margin-top:6px;font-weight:700">Total : ${durStrRF} \u00b7 ${(totalPriceRF / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    }
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
    // Single-service: show price + LM discount + promo
    const rawPriceRF = booking.service_price_cents || 0;
    const singlePriceRF = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceRF * (100 - booking.discount_pct) / 100) : rawPriceRF);
    if (singlePriceRF > 0) {
      const singleDurRF = booking.duration_min || '';
      const promoDiscSingleRF = booking.promotion_discount_cents || 0;
      const hasLmRF = booking.discount_pct && rawPriceRF > singlePriceRF;
      const finalSingleRF = singlePriceRF - promoDiscSingleRF;
      if (hasLmRF || (promoDiscSingleRF > 0 && booking.promotion_label)) {
        const displayBaseRF = hasLmRF ? rawPriceRF : singlePriceRF;
        serviceDetailHTML += `<div style="font-size:14px;color:#3D3832;margin-top:6px;font-weight:700">${singleDurRF ? singleDurRF + ' min · ' : ''}<s style="opacity:.6">${(displayBaseRF / 100).toFixed(2).replace('.', ',')} €</s> ${(finalSingleRF / 100).toFixed(2).replace('.', ',')} €</div>`;
        if (hasLmRF) serviceDetailHTML += `<div style="font-size:12px;color:#3D3832;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingleRF > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#3D3832;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleRF / 100).toFixed(2).replace('.', ',')} €</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#3D3832;margin-top:4px">${singleDurRF ? singleDurRF + ' min · ' : ''}${(singlePriceRF / 100).toFixed(2).replace('.', ',')} €</div>`;
      }
    }
  }

  const hasSplitPracRF = isMulti && groupServices.some(s => s.practitioner_name);

  // Determine refund method: gift card, stripe, or mixed
  // M2 fix: stripeRefundCents = actual amount sent back via Stripe (net of fees in policy='net').
  const gcRefundCents = booking.gc_paid_cents || 0;
  const stripeRefundCents = stripeNetCents;
  const grossStripePortion = Math.max((booking.deposit_amount_cents || 0) - gcRefundCents, 0);
  const feesDeducted = grossStripePortion - stripeRefundCents;
  const isFullGc = gcRefundCents > 0 && grossStripePortion <= 0;
  const isMix = gcRefundCents > 0 && stripeRefundCents > 0;

  let refundBanner = '';
  if (isFullGc) {
    // 100% gift card — instant refund to GC balance
    const gcCode = booking.deposit_payment_intent_id ? booking.deposit_payment_intent_id.replace('gc_', '') : '';
    refundBanner = `
    <div style="background:#FFF8E1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:15px;font-weight:600;color:#5D4037;margin-bottom:4px">\u{1F381} Acompte de ${amtStr}\u00a0\u20ac recr\u00e9dit\u00e9 sur votre carte cadeau</div>
      <div style="font-size:14px;color:#8D6E63">Le solde a \u00e9t\u00e9 recr\u00e9dit\u00e9 sur votre carte ${gcCode}.</div>
    </div>`;
  } else if (isMix) {
    // Mix GC + Stripe — show real Stripe amount (net of fees if applicable)
    const gcStr = (gcRefundCents / 100).toFixed(2).replace('.', ',');
    refundBanner = `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} ${gcStr}\u00a0\u20ac recr\u00e9dit\u00e9s sur votre carte cadeau</div>
    </div>
    <div style="background:#EFF6FF;border-radius:8px;padding:12px 16px;margin:4px 0 16px;border-left:3px solid #60A5FA">
      <div style="font-size:14px;color:#1D4ED8;font-weight:600">${_ic('refund')} ${stripeNetStr}\u00a0\u20ac rembours\u00e9s par carte bancaire</div>
      ${feesDeducted > 0 ? `<div style="font-size:12px;color:#1D4ED8;opacity:.85">Frais bancaires d\u00e9duits : ${(feesDeducted / 100).toFixed(2).replace('.', ',')}\u00a0\u20ac</div>` : ''}
      <div style="font-size:13px;color:#1D4ED8">Le remboursement appara\u00eetra sur votre relev\u00e9 sous 5 \u00e0 10 jours ouvrables.</div>
    </div>`;
  } else {
    // 100% Stripe — bank refund delay (show net amount actually sent back)
    refundBanner = `
    <div style="background:#EFF6FF;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #60A5FA">
      <div style="font-size:15px;font-weight:600;color:#1D4ED8;margin-bottom:4px">${_ic('refund')} Acompte de ${stripeNetStr}\u00a0\u20ac rembours\u00e9</div>
      ${feesDeducted > 0 ? `<div style="font-size:12px;color:#1D4ED8;opacity:.85">Frais bancaires d\u00e9duits : ${(feesDeducted / 100).toFixed(2).replace('.', ',')}\u00a0\u20ac</div>` : ''}
      <div style="font-size:14px;color:#1D4ED8">Le remboursement appara\u00eetra sur votre relev\u00e9 sous 5 \u00e0 10 jours ouvrables.</div>
    </div>`;
  }

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre acompte a \u00e9t\u00e9 rembours\u00e9 suite \u00e0 l'annulation de votre rendez-vous.</p>
    ${refundBanner}
    <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0">
      <div style="font-size:13px;font-weight:600;color:#6B6560;text-transform:uppercase;margin-bottom:4px">Rendez-vous annul\u00e9</div>
      <div style="font-size:14px;color:#3D3832">${_ic('calendar-dk')} ${dateStr}</div>
      <div style="font-size:14px;color:#3D3832">${_ic('clock-dk')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName && !hasSplitPracRF ? `<div style="font-size:14px;color:#6B6560">${safePracName}</div>` : ''}
    </div>
    <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 reprendre rendez-vous quand vous le souhaitez.</p>`;

  // Address + contact info so client can reach the business
  if (business.address || business.phone || business.email) {
    let contactHTML = '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee">';
    if (business.address) {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.address)}`;
      contactHTML += `<div style="font-size:13px;color:#6B6560;padding:4px 0">${escHtml(business.address)} \u2014 <a href="${mapsUrl}" target="_blank" style="color:#0D9488;text-decoration:none;font-weight:500">Google Maps \u2192</a></div>`;
    }
    // BUG-DEPPRO-TEL fix: tel: + mailto: clickable (parité buildBookingFooter).
    if (business.phone) contactHTML += `<div style="font-size:13px;color:#6B6560;padding:4px 0"><a href="tel:${escHtml(business.phone)}" style="color:#6B6560;text-decoration:none">${escHtml(business.phone)}</a></div>`;
    if (business.email) contactHTML += `<div style="font-size:13px;color:#6B6560;padding:4px 0"><a href="mailto:${escHtml(business.email)}" style="color:#6B6560;text-decoration:none">${escHtml(business.email)}</a></div>`;
    contactHTML += '</div>';
    bodyHTML += contactHTML;
  }

  // BUG-DEPREFUND-COMMENT fix: afficher remarque client (parité email-cancel).
  const _refComment = booking.comment || booking.comment_client;
  if (_refComment && String(_refComment).trim()) {
    bodyHTML += `<div style="background:#F5F4F1;border-radius:8px;padding:12px 14px;margin:14px 0;font-size:13px;color:#3D3832"><strong>Votre remarque :</strong><br>${escHtml(_refComment)}</div>`;
  }

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const bookingUrl = business.slug ? `${baseUrl}/${business.slug}/book` : null;

  const html = buildEmailHTML({
    title: 'Acompte rembours\u00e9',
    preheader: `Votre acompte de ${amtStr}\u20ac a \u00e9t\u00e9 rembours\u00e9`,
    bodyHTML,
    ctaText: bookingUrl ? 'Reprendre rendez-vous' : null,
    ctaUrl: bookingUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Acompte rembours\u00e9 \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Notify merchant that a deposit has been paid
 */
async function sendDepositPaidProEmail({ booking, business }) {
  if (!business.email) return;
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  // BUG-DEPPRO-INFO fix: end time + total prix + contact client pour contexte complet.
  const endTimeStr = booking.end_at ? fmtTimeBrussels(booking.end_at) : null;
  const totalCents = booking.booked_price_cents || booking.service_price_cents || 0;
  const totalStr = totalCents ? (totalCents / 100).toFixed(2).replace('.', ',') + ' €' : null;
  const amtStr = ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
  const clientNameRaw = booking.client_name || 'Client';
  const clientName = escHtml(clientNameRaw);
  const color = safeColor(business.theme?.primary_color);
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';

  const html = buildEmailHTML({
    title: 'Acompte reçu',
    preheader: `${clientNameRaw} a payé son acompte de ${amtStr} €`,
    bodyHTML: `
      <p><strong>${clientName}</strong> a réglé son acompte.</p>
      <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
        <div style="font-size:15px;font-weight:600;color:#15803D;margin-bottom:4px">Acompte de ${amtStr} € reçu${totalStr ? ' · Total ' + totalStr : ''}</div>
        ${booking.service_name ? `<div style="font-size:14px;color:#3D3832;margin-bottom:2px">${escHtml(booking.service_name)}</div>` : ''}
        ${booking.practitioner_name ? `<div style="font-size:13px;color:#6B6560">${escHtml(booking.practitioner_name)}</div>` : ''}
        <div style="font-size:14px;color:#3D3832">${dateStr} à ${timeStr}${endTimeStr ? ' – ' + endTimeStr : ''}</div>
        ${booking.client_email ? `<div style="font-size:13px;color:#6B6560;margin-top:4px"><a href="mailto:${escHtml(booking.client_email)}" style="color:#3D3832;text-decoration:none">${escHtml(booking.client_email)}</a>${booking.client_phone ? ' · <a href="tel:' + escHtml(booking.client_phone) + '" style="color:#3D3832;text-decoration:none">' + escHtml(booking.client_phone) + '</a>' : ''}</div>` : ''}
      </div>`,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name} · Via Genda.be`
  });

  return sendEmail({
    to: business.email,
    toName: business.name,
    subject: `Acompte reçu — ${clientNameRaw} — ${dateStr}`,
    html,
    fromName: 'Genda'
  });
}

/**
 * Notify merchant that a deposit has been refunded
 */
async function sendDepositRefundProEmail({ booking, business }) {
  if (!business.email) return;
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long'
  });
  // BUG-DEPPRO-INFO fix: add time + end time + total + practitioner + clickable contact.
  const timeStr = fmtTimeBrussels(booking.start_at);
  const endTimeStr = booking.end_at ? fmtTimeBrussels(booking.end_at) : null;
  const totalCents = booking.booked_price_cents || booking.service_price_cents || 0;
  const totalStr = totalCents ? (totalCents / 100).toFixed(2).replace('.', ',') + ' €' : null;
  const amtStr = ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
  const clientNameRaw = booking.client_name || 'Client';
  const clientName = escHtml(clientNameRaw);
  const color = safeColor(business.theme?.primary_color);
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';

  const html = buildEmailHTML({
    title: 'Acompte remboursé',
    preheader: `Acompte de ${amtStr} € remboursé à ${clientNameRaw}`,
    bodyHTML: `
      <p>L'acompte de <strong>${clientName}</strong> a été remboursé.</p>
      <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
        <div style="font-size:15px;font-weight:600;color:#DC2626;margin-bottom:4px">Acompte de ${amtStr} € remboursé${totalStr ? ' · Total initial ' + totalStr : ''}</div>
        ${booking.service_name ? `<div style="font-size:14px;color:#3D3832;margin-bottom:2px">${escHtml(booking.service_name)}</div>` : ''}
        ${booking.practitioner_name ? `<div style="font-size:13px;color:#6B6560">${escHtml(booking.practitioner_name)}</div>` : ''}
        <div style="font-size:14px;color:#3D3832">${dateStr} à ${timeStr}${endTimeStr ? ' – ' + endTimeStr : ''}</div>
        ${booking.client_email ? `<div style="font-size:13px;color:#6B6560;margin-top:4px"><a href="mailto:${escHtml(booking.client_email)}" style="color:#3D3832;text-decoration:none">${escHtml(booking.client_email)}</a>${booking.client_phone ? ' · <a href="tel:' + escHtml(booking.client_phone) + '" style="color:#3D3832;text-decoration:none">' + escHtml(booking.client_phone) + '</a>' : ''}</div>` : ''}
      </div>`,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name} · Via Genda.be`
  });

  return sendEmail({
    to: business.email,
    toName: business.name,
    subject: `Acompte remboursé — ${clientNameRaw}`,
    html,
    fromName: 'Genda'
  });
}

/**
 * Send partial-refund notification to the client after a Stripe Dashboard partial refund.
 * Without this email, the client sees a partial Stripe deposit in their bank but no
 * explanation from the salon — risk of dispute / RGPD complaint.
 */
async function sendPartialRefundEmail({ booking, business, refundAmountCents, totalAmountCents }) {
  if (!booking.client_email) return { success: false, error: 'no_client_email' };
  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name || 'Client');
  const refundStr = ((refundAmountCents || 0) / 100).toFixed(2).replace('.', ',');
  const totalStr = ((totalAmountCents || 0) / 100).toFixed(2).replace('.', ',');
  const safeBizName = escHtml(business.name || 'le salon');
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;

  let dateLine = '';
  if (booking.start_at) {
    const d = new Date(booking.start_at);
    const dateStr = d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
    dateLine = `<div style="font-size:13px;color:#3D3832">${escHtml(dateStr)} \u00e0 ${escHtml(timeStr)}</div>`;
  }
  const svcLine = booking.service_name
    ? `<div style="font-size:14px;color:#3D3832;margin-bottom:2px">${escHtml(booking.service_name)}</div>`
    : '';

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p><strong>${safeBizName}</strong> vous a accord\u00e9 un remboursement partiel sur votre rendez-vous.</p>
    <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:15px;font-weight:600;color:#15803D;margin-bottom:4px">Remboursement : ${refundStr} \u20ac${totalAmountCents ? ' <span style="font-size:13px;font-weight:400;opacity:.75">(sur ${totalStr} \u20ac vers\u00e9s)</span>' : ''}</div>
      ${svcLine}${dateLine}
    </div>
    <p style="font-size:13px;color:#6B6560">Le remboursement apparaîtra sur votre relevé bancaire sous 5 à 10 jours ouvrables. Votre rendez-vous est maintenu. Pour toute question, contactez directement ${safeBizName}${business.phone ? ' au ' + escHtml(business.phone) : ''}${business.email ? ' (<a href="mailto:' + escHtml(business.email) + '" style="color:' + color + ';text-decoration:none">' + escHtml(business.email) + '</a>)' : ''}.</p>`;

  const html = buildEmailHTML({
    title: 'Remboursement partiel',
    preheader: `Remboursement de ${refundStr} € crédité sur votre compte`,
    bodyHTML,
    ctaText: manageUrl ? 'Voir mon rendez-vous' : null,
    ctaUrl: manageUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Remboursement partiel \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

module.exports = { sendDepositRequestEmail, sendDepositReminderEmail, sendDepositPaidEmail, sendDepositRefundEmail, sendDepositPaidProEmail, sendDepositRefundProEmail, sendPartialRefundEmail };
