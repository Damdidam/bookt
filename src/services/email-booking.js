/**
 * Email service — booking confirmation emails
 */

const { escHtml, fmtSvcLabel, safeColor, _ic, getRealEndAt, fmtTimeBrussels, sendEmail, buildBookingFooter, buildEmailHTML } = require('./email-utils');

/**
 * Send booking confirmation email after booking creation
 * @param {Object} params
 * @param {Object} params.booking - First booking (or single booking)
 * @param {Object} params.business - Business row
 * @param {Array}  [params.groupServices] - Optional array of {name, duration_min, price_cents} for multi-service groups
 */
async function sendBookingConfirmation({ booking, business, groupServices }) {
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const realEnd = getRealEndAt(booking, groupServices);
  const endTimeStr = realEnd ? fmtTimeBrussels(realEnd) : null;

  const color = safeColor(business.theme?.primary_color);
  const practitionerName = escHtml(booking.practitioner_name || '');
  const safeClientName = escHtml(booking.client_name);
  const safeComment = escHtml(booking.comment);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const serviceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  let detailLines = `<div style="font-size:15px;font-weight:600;color:#15613A;margin-bottom:4px">${_ic('calendar-grn')} ${dateStr}</div>`;
  detailLines += `<div style="font-size:14px;color:#15613A">${_ic('clock-grn')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>`;

  const hasSplitPrac = isMulti && groupServices.some(s => s.practitioner_name);
  if (isMulti) {
    detailLines += `<div style="font-size:13px;color:#15613A;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      detailLines += `<div style="font-size:13px;color:#15613A;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const promoDiscount = booking.promotion_discount_cents || 0;
    const finalPrice = totalPrice - promoDiscount;
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    let priceHtml = '';
    if (totalPrice > 0) {
      if (promoDiscount > 0 && booking.promotion_label) {
        priceHtml = ` \u00b7 <s style="opacity:.6">${(totalPrice / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPrice / 100).toFixed(2).replace('.', ',')} \u20ac`;
        detailLines += `<div style="font-size:14px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStr}${priceHtml}</div>`;
        detailLines += `<div style="font-size:12px;color:#15613A;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        priceHtml = ` \u00b7 ${(totalPrice / 100).toFixed(2).replace('.', ',')} \u20ac`;
        detailLines += `<div style="font-size:14px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStr}${priceHtml}</div>`;
      }
    } else {
      detailLines += `<div style="font-size:14px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStr}</div>`;
    }
  } else {
    detailLines += `<div style="font-size:14px;color:#15613A;margin-top:4px">${_ic('sparkle-grn')} ${serviceName}</div>`;
    // Single-service: show price + LM discount + promo
    const rawPrice = booking.service_price_cents || 0;
    const singlePrice = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPrice * (100 - booking.discount_pct) / 100) : rawPrice);
    if (singlePrice > 0) {
      const singleDur = booking.duration_min || '';
      const promoDiscSingle = booking.promotion_discount_cents || 0;
      const hasLm = booking.discount_pct && rawPrice > singlePrice;
      const finalSingle = singlePrice - promoDiscSingle;
      if (hasLm || (promoDiscSingle > 0 && booking.promotion_label)) {
        // Show original price struck through, then final price
        const displayBase = hasLm ? rawPrice : singlePrice;
        detailLines += `<div style="font-size:14px;color:#15613A;margin-top:6px;font-weight:700">${singleDur ? singleDur + ' min · ' : ''}<s style="opacity:.6">${(displayBase / 100).toFixed(2).replace('.', ',')} €</s> ${(finalSingle / 100).toFixed(2).replace('.', ',')} €</div>`;
        if (hasLm) detailLines += `<div style="font-size:12px;color:#15613A;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingle > 0 && booking.promotion_label) detailLines += `<div style="font-size:12px;color:#15613A;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingle / 100).toFixed(2).replace('.', ',')} €</div>`;
      } else {
        detailLines += `<div style="font-size:14px;color:#15613A;margin-top:4px">${singleDur ? singleDur + ' min · ' : ''}${(singlePrice / 100).toFixed(2).replace('.', ',')} €</div>`;
      }
    }
  }
  if (practitionerName && !hasSplitPrac) detailLines += `<div style="font-size:14px;color:#15613A">${_ic('user-grn')} ${practitionerName}</div>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const hasPublicToken = booking.public_token;

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous est confirm\u00e9 :</p>
    <div style="background:#EEFAF1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #1B7A42">
      ${detailLines}
    </div>`;

  // Pass/abonnement banner
  if (booking.deposit_payment_intent_id && booking.deposit_payment_intent_id.startsWith('pass_')) {
    const passCode = booking.deposit_payment_intent_id.replace('pass_', '');
    bodyHTML += `
    <div style="background:#EEFAF1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">\u2705 Cette prestation est couverte par votre abonnement</div>
      <div style="font-size:12px;color:#15803D;margin-top:4px">Pass ${escHtml(passCode)}</div>
    </div>`;
  }

  // Deposit paid banner (skip if already covered by pass above)
  if (booking.deposit_required && booking.deposit_status === 'paid' && booking.deposit_amount_cents > 0
      && booking.deposit_payment_intent_id
      && !booking.deposit_payment_intent_id.startsWith('pass_')) {
    const depAmt = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    if (booking.deposit_payment_intent_id.startsWith('gc_')) {
      const gcCode = booking.deposit_payment_intent_id.replace('gc_', '');
      bodyHTML += `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} Acompte de ${depAmt}\u00a0\u20ac r\u00e9gl\u00e9 via votre carte cadeau</div>
      <div style="font-size:12px;color:#8D6E63;margin-top:4px">Carte ${gcCode}</div>
    </div>`;
    } else {
      bodyHTML += `
    <div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">\u2705 Acompte de ${depAmt}\u00a0\u20ac r\u00e9gl\u00e9 par carte bancaire</div>
      <div style="font-size:12px;color:#15803D;margin-top:4px">Le montant restant sera \u00e0 r\u00e9gler sur place.</div>
    </div>`;
    }

    // Reste à payer — compute total price minus deposit
    const totalCentsConf = isMulti
      ? groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0) - (booking.promotion_discount_cents || 0)
      : (booking.booked_price_cents || (booking.discount_pct ? Math.round((booking.service_price_cents || 0) * (100 - booking.discount_pct) / 100) : (booking.service_price_cents || 0))) - (booking.promotion_discount_cents || 0);
    const resteCents = totalCentsConf - (booking.deposit_amount_cents || 0);
    if (resteCents > 0) {
      const resteStr = (resteCents / 100).toFixed(2).replace('.', ',');
      bodyHTML += `
    <div style="background:#F5F4F1;border-radius:8px;padding:10px 16px;margin:0 0 16px;border-left:3px solid #6B6560">
      <div style="font-size:14px;color:#3D3832;font-weight:600">Reste \u00e0 payer sur place : ${resteStr}\u00a0\u20ac</div>
    </div>`;
    }
  }

  if (booking.comment) {
    bodyHTML += `<p style="font-size:13px;color:#6B6560;margin-top:12px">${_ic('note-dk')} <em>${safeComment}</em></p>`;
  }

  // Footer: address, contact, payment methods, calendar links
  const calEndAt = realEnd ? realEnd.toISOString() : (booking.end_at || booking.start_at);
  bodyHTML += buildBookingFooter({
    business, booking, serviceName,
    practitionerName: booking.practitioner_name || '',
    startAt: booking.start_at, endAt: calEndAt,
    publicToken: hasPublicToken ? booking.public_token : null
  });

  const html = buildEmailHTML({
    title: isMulti ? 'Confirmation de vos prestations' : 'Confirmation de votre rendez-vous',
    preheader: `${serviceName} \u2014 ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText: null,
    ctaUrl: null,
    cancelText: hasPublicToken ? 'Gérer mon rendez-vous' : null,
    cancelUrl: hasPublicToken ? `${baseUrl}/booking/${booking.public_token}` : null,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: isMulti ? `Confirmation de vos ${groupServices.length} prestations \u2014 ${business.name}` : `Confirmation de votre RDV \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Send booking confirmation REQUEST email (client must click to confirm)
 * Used when business has booking_confirmation_required enabled.
 * @param {Object} params
 * @param {Object} params.booking - Booking row with public_token, start_at, end_at, client_name, client_email, service_name, practitioner_name
 * @param {Object} params.business - Business row with name, email, address, theme
 * @param {number} params.timeoutMin - Minutes before auto-cancel
 * @param {Array}  [params.groupServices] - Optional for multi-service groups
 */
async function sendBookingConfirmationRequest({ booking, business, timeoutMin, groupServices }) {
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const realEnd = getRealEndAt(booking, groupServices);
  const endTimeStr = realEnd ? fmtTimeBrussels(realEnd) : null;

  const color = safeColor(business.theme?.primary_color);
  const practitionerName = escHtml(booking.practitioner_name || '');
  const safeClientName = escHtml(booking.client_name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const serviceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label));

  let detailLines = `<div style="font-size:15px;font-weight:600;color:#92700C;margin-bottom:4px">${_ic('calendar-amb')} ${dateStr}</div>`;
  detailLines += `<div style="font-size:14px;color:#92700C">${_ic('clock-amb')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>`;

  const hasSplitPracCR = isMulti && groupServices.some(s => s.practitioner_name);
  if (isMulti) {
    detailLines += `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      detailLines += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMinCR = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPriceCR = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const promoDiscountCR = booking.promotion_discount_cents || 0;
    const finalPriceCR = totalPriceCR - promoDiscountCR;
    const durStrCR = totalMinCR >= 60 ? Math.floor(totalMinCR / 60) + 'h' + (totalMinCR % 60 > 0 ? String(totalMinCR % 60).padStart(2, '0') : '') : totalMinCR + ' min';
    let priceHtmlCR = '';
    if (totalPriceCR > 0) {
      if (promoDiscountCR > 0 && booking.promotion_label) {
        priceHtmlCR = ` \u00b7 <s style="opacity:.6">${(totalPriceCR / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPriceCR / 100).toFixed(2).replace('.', ',')} \u20ac`;
        detailLines += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrCR}${priceHtmlCR}</div>`;
        detailLines += `<div style="font-size:12px;color:#92700C;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscountCR / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        priceHtmlCR = ` \u00b7 ${(totalPriceCR / 100).toFixed(2).replace('.', ',')} \u20ac`;
        detailLines += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrCR}${priceHtmlCR}</div>`;
      }
    } else {
      detailLines += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">Total : ${durStrCR}</div>`;
    }
  } else {
    detailLines += `<div style="font-size:14px;color:#92700C;margin-top:4px">${_ic('sparkle-amb')} ${serviceName}</div>`;
    // Single-service: show price + LM discount + promo
    const rawPriceCR = booking.service_price_cents || 0;
    const singlePriceCR = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceCR * (100 - booking.discount_pct) / 100) : rawPriceCR);
    if (singlePriceCR > 0) {
      const singleDurCR = booking.duration_min || '';
      const promoDiscSingleCR = booking.promotion_discount_cents || 0;
      const hasLmCR = booking.discount_pct && rawPriceCR > singlePriceCR;
      const finalSingleCR = singlePriceCR - promoDiscSingleCR;
      if (hasLmCR || (promoDiscSingleCR > 0 && booking.promotion_label)) {
        const displayBaseCR = hasLmCR ? rawPriceCR : singlePriceCR;
        detailLines += `<div style="font-size:14px;color:#92700C;margin-top:6px;font-weight:700">${singleDurCR ? singleDurCR + ' min · ' : ''}<s style="opacity:.6">${(displayBaseCR / 100).toFixed(2).replace('.', ',')} €</s> ${(finalSingleCR / 100).toFixed(2).replace('.', ',')} €</div>`;
        if (hasLmCR) detailLines += `<div style="font-size:12px;color:#92700C;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingleCR > 0 && booking.promotion_label) detailLines += `<div style="font-size:12px;color:#92700C;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleCR / 100).toFixed(2).replace('.', ',')} €</div>`;
      } else {
        detailLines += `<div style="font-size:14px;color:#92700C;margin-top:4px">${singleDurCR ? singleDurCR + ' min · ' : ''}${(singlePriceCR / 100).toFixed(2).replace('.', ',')} €</div>`;
      }
    }
  }
  if (practitionerName && !hasSplitPracCR) detailLines += `<div style="font-size:14px;color:#92700C">${_ic('user-amb')} ${practitionerName}</div>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const confirmUrl = `${baseUrl}/api/public/booking/${booking.public_token}/confirm-booking`;

  const delayLabel = timeoutMin >= 60
    ? Math.floor(timeoutMin / 60) + 'h' + (timeoutMin % 60 > 0 ? String(timeoutMin % 60).padStart(2, '0') : '')
    : timeoutMin + ' minutes';

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous a bien \u00e9t\u00e9 enregistr\u00e9. Merci de le <strong>confirmer</strong> en cliquant ci-dessous :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #E6A817">
      ${detailLines}
    </div>
    <p style="font-size:13px;color:#92700C;margin-top:8px">${_ic('hourglass-amb', 16, 16)} Vous avez <strong>${delayLabel}</strong> pour confirmer. Sans confirmation, le cr\u00e9neau sera automatiquement lib\u00e9r\u00e9.</p>`;

  // Deposit info (if applicable)
  if (booking.deposit_required && booking.deposit_status === 'paid' && booking.deposit_amount_cents > 0
      && booking.deposit_payment_intent_id) {
    const depAmt = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    if (booking.deposit_payment_intent_id.startsWith('pass_')) {
      const passCode = booking.deposit_payment_intent_id.replace('pass_', '');
      bodyHTML += `
    <div style="background:#EEFAF1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">\u2705 Cette prestation est couverte par votre abonnement</div>
      <div style="font-size:12px;color:#15803D;margin-top:4px">Pass ${escHtml(passCode)}</div>
    </div>`;
    } else if (booking.deposit_payment_intent_id.startsWith('gc_')) {
      const gcCode = booking.deposit_payment_intent_id.replace('gc_', '');
      bodyHTML += `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} Acompte de ${depAmt}\u00a0\u20ac r\u00e9gl\u00e9 via votre carte cadeau</div>
      <div style="font-size:12px;color:#8D6E63;margin-top:4px">Carte ${gcCode}</div>
    </div>`;
    } else {
      bodyHTML += `
    <div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">\u2705 Acompte de ${depAmt}\u00a0\u20ac r\u00e9gl\u00e9 par carte bancaire</div>
      <div style="font-size:12px;color:#15803D;margin-top:4px">Le montant restant sera \u00e0 r\u00e9gler sur place.</div>
    </div>`;
    }

    // Reste a payer
    const totalCentsCR = isMulti
      ? groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0) - (booking.promotion_discount_cents || 0)
      : (booking.booked_price_cents || (booking.discount_pct ? Math.round((booking.service_price_cents || 0) * (100 - booking.discount_pct) / 100) : (booking.service_price_cents || 0))) - (booking.promotion_discount_cents || 0);
    const resteCentsCR = totalCentsCR - (booking.deposit_amount_cents || 0);
    if (resteCentsCR > 0) {
      const resteStrCR = (resteCentsCR / 100).toFixed(2).replace('.', ',');
      bodyHTML += `
    <div style="background:#F5F4F1;border-radius:8px;padding:10px 16px;margin:0 0 16px;border-left:3px solid #6B6560">
      <div style="font-size:14px;color:#3D3832;font-weight:600">Reste \u00e0 payer sur place : ${resteStrCR}\u00a0\u20ac</div>
    </div>`;
    }
  }

  if (booking.comment) {
    bodyHTML += `<p style="font-size:13px;color:#6B6560;margin-top:12px">${_ic('note-dk')} <em>${escHtml(booking.comment)}</em></p>`;
  }

  // Footer: address, contact, payment methods, calendar links
  const calEndAtCR = realEnd ? realEnd.toISOString() : (booking.end_at || booking.start_at);
  bodyHTML += buildBookingFooter({
    business, booking, serviceName,
    practitionerName: booking.practitioner_name || '',
    startAt: booking.start_at, endAt: calEndAtCR,
    publicToken: booking.public_token || null
  });

  const manageUrl = `${baseUrl}/booking/${booking.public_token}`;

  const html = buildEmailHTML({
    title: 'Confirmez votre rendez-vous',
    preheader: `Confirmez votre RDV du ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText: 'Confirmer mon rendez-vous',
    ctaUrl: confirmUrl,
    cancelText: 'Gérer mon rendez-vous',
    cancelUrl: manageUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' \u00b7 ' + business.address : ''} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Confirmez votre RDV \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

module.exports = { sendBookingConfirmation, sendBookingConfirmationRequest };
