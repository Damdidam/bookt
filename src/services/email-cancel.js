/**
 * Email service — cancellation and reschedule emails
 */

const { escHtml, fmtSvcLabel, safeColor, _ic, getRealEndAt, fmtTimeBrussels, sendEmail, buildBookingFooter, buildEmailHTML } = require('./email-utils');

/**
 * Send cancellation confirmation email to client
 */
async function sendCancellationEmail({ booking, business, groupServices }) {
  const dateStr = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeStr = fmtTimeBrussels(booking.start_at);
  const realEnd = getRealEndAt(booking, groupServices);
  const endTimeStr = realEnd ? fmtTimeBrussels(realEnd) : null;

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
    serviceDetailHTML += `<div style="font-size:13px;color:#6B6560;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#6B6560;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMinCL = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPriceCL = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const totalOriginalCL = groupServices.reduce((sum, s) => sum + (s.original_price_cents || s.price_cents || 0), 0);
    const hasMultiLmCL = totalOriginalCL > totalPriceCL;
    const promoDiscCL = booking.promotion_discount_cents || 0;
    const finalPriceCL = totalPriceCL - promoDiscCL;
    const durStrCL = totalMinCL >= 60 ? Math.floor(totalMinCL / 60) + 'h' + (totalMinCL % 60 > 0 ? String(totalMinCL % 60).padStart(2, '0') : '') : totalMinCL + ' min';
    if (totalPriceCL > 0) {
      if (hasMultiLmCL || (promoDiscCL > 0 && booking.promotion_label)) {
        const displayBaseCL = hasMultiLmCL ? totalOriginalCL : totalPriceCL;
        serviceDetailHTML += `<div style="font-size:14px;color:#6B6560;margin-top:6px;font-weight:700">Total : ${durStrCL} \u00b7 <s style="opacity:.6">${(displayBaseCL / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPriceCL / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (hasMultiLmCL) serviceDetailHTML += `<div style="font-size:12px;color:#6B6560;opacity:.8">Last Minute : -${((totalOriginalCL - totalPriceCL) / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
        if (promoDiscCL > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#6B6560;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscCL / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#6B6560;margin-top:6px;font-weight:700">Total : ${durStrCL} \u00b7 ${(totalPriceCL / 100).toFixed(2).replace('.', ',')} \u20ac</div>`;
      }
    }
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
    // Single-service: show price + LM discount + promo
    const rawPriceCL = booking.service_price_cents || 0;
    const singlePriceCL = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceCL * (100 - booking.discount_pct) / 100) : rawPriceCL);
    if (singlePriceCL > 0) {
      const singleDurCL = booking.duration_min || '';
      const promoDiscSingleCL = booking.promotion_discount_cents || 0;
      const hasLmCL = booking.discount_pct && rawPriceCL > singlePriceCL;
      const finalSingleCL = singlePriceCL - promoDiscSingleCL;
      if (hasLmCL || (promoDiscSingleCL > 0 && booking.promotion_label)) {
        const displayBaseCL = hasLmCL ? rawPriceCL : singlePriceCL;
        serviceDetailHTML += `<div style="font-size:14px;color:#6B6560;margin-top:6px;font-weight:700">${singleDurCL ? singleDurCL + ' min · ' : ''}<s style="opacity:.6">${(displayBaseCL / 100).toFixed(2).replace('.', ',')} €</s> ${(finalSingleCL / 100).toFixed(2).replace('.', ',')} €</div>`;
        if (hasLmCL) serviceDetailHTML += `<div style="font-size:12px;color:#6B6560;opacity:.8">Last Minute -${booking.discount_pct}%</div>`;
        if (promoDiscSingleCL > 0 && booking.promotion_label) serviceDetailHTML += `<div style="font-size:12px;color:#6B6560;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleCL / 100).toFixed(2).replace('.', ',')} €</div>`;
      } else {
        serviceDetailHTML += `<div style="font-size:14px;color:#3D3832;margin-top:4px">${singleDurCL ? singleDurCL + ' min · ' : ''}${(singlePriceCL / 100).toFixed(2).replace('.', ',')} €</div>`;
      }
    }
  }

  // Deposit info for cancellation email
  const hadDeposit = booking.deposit_required && booking.deposit_amount_cents > 0;
  const wasPaid = hadDeposit && !!booking.deposit_paid_at;
  const depositRefunded = wasPaid && booking.deposit_status === 'refunded';
  const depositRetained = wasPaid && booking.deposit_status === 'cancelled';
  const depAmtStr = hadDeposit ? ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',') : '';

  const gcCancelCents = booking.gc_paid_cents || 0;
  // B2 fix: use net_refund_cents (actual Stripe refund amount) instead of gross if the caller
  // computed it (policy='net' deducts fees). Fallback to gross when not provided (policy='full').
  const grossStripeCancelCents = hadDeposit ? Math.max((booking.deposit_amount_cents || 0) - gcCancelCents, 0) : 0;
  const stripeCancelCents = (booking.net_refund_cents != null && !Number.isNaN(booking.net_refund_cents))
    ? booking.net_refund_cents
    : grossStripeCancelCents;
  const stripeCancelFeesDeducted = Math.max(grossStripeCancelCents - stripeCancelCents, 0);
  const isFullGcCancel = gcCancelCents > 0 && grossStripeCancelCents <= 0;
  const isMixCancel = gcCancelCents > 0 && stripeCancelCents > 0;

  let depositHTML = '';
  if (depositRefunded) {
    if (isMixCancel) {
      const gcStr = (gcCancelCents / 100).toFixed(2).replace('.', ',');
      const stripeStr = (stripeCancelCents / 100).toFixed(2).replace('.', ',');
      depositHTML = `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} ${gcStr}\u00a0\u20ac recr\u00e9dit\u00e9s sur votre carte cadeau</div>
    </div>
    <div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:4px 0 16px;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">${_ic('check')} ${stripeStr}\u00a0\u20ac rembours\u00e9s par carte bancaire</div>
      ${stripeCancelFeesDeducted > 0 ? `<div style="font-size:12px;color:#15803D;opacity:.85">Frais bancaires d\u00e9duits : ${(stripeCancelFeesDeducted / 100).toFixed(2).replace('.', ',')}\u00a0\u20ac</div>` : ''}
      <div style="font-size:13px;color:#15803D;margin-top:4px">Le remboursement appara\u00eetra sur votre relev\u00e9 sous quelques jours ouvrables.</div>
    </div>`;
    } else if (isFullGcCancel) {
      depositHTML = `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} Acompte de ${depAmtStr}\u00a0\u20ac recr\u00e9dit\u00e9 sur votre carte cadeau</div>
    </div>`;
    } else {
      const stripeStrFull = (stripeCancelCents / 100).toFixed(2).replace('.', ',');
      depositHTML = `
    <div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">${_ic('check')} Acompte de ${stripeStrFull}\u00a0\u20ac rembours\u00e9</div>
      ${stripeCancelFeesDeducted > 0 ? `<div style="font-size:12px;color:#15803D;opacity:.85">Frais bancaires d\u00e9duits : ${(stripeCancelFeesDeducted / 100).toFixed(2).replace('.', ',')}\u00a0\u20ac</div>` : ''}
      <div style="font-size:13px;color:#15803D;margin-top:4px">Votre acompte vous sera restitu\u00e9 sous quelques jours ouvrables.</div>
    </div>`;
    }
  } else if (hadDeposit && !wasPaid) {
    // Expiration / cancel before deposit payment — show explicit banner so client knows it wasn't an oversight.
    depositHTML = `
    <div style="background:#FEF3E2;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F59E0B">
      <div style="font-size:14px;color:#92700C;font-weight:600">\u26a0\ufe0f Acompte de ${depAmtStr}\u00a0\u20ac non r\u00e9gl\u00e9 dans le d\u00e9lai imparti</div>
      <div style="font-size:13px;color:#92700C;margin-top:4px">Aucun pr\u00e9l\u00e8vement n'a \u00e9t\u00e9 effectu\u00e9 sur votre carte. Vous pouvez reprendre rendez-vous quand vous le souhaitez.</div>
    </div>`;
  } else if (depositRetained) {
    const cancelDeadlineH = business.settings?.cancel_deadline_hours ?? 24;
    // Deposit retention can have several causes — show the right one so we don't lie to the client.
    const _retReason = booking.deposit_retention_reason; // 'stripe_failure' | 'no_stripe_key' | 'fees_exceed_charge' | undefined
    let _retText;
    if (_retReason === 'stripe_failure' || _retReason === 'no_stripe_key') {
      _retText = `Le remboursement automatique a \u00e9chou\u00e9 pour une raison technique. Contactez le commerce pour la suite.`;
    } else if (_retReason === 'fees_exceed_charge') {
      _retText = `Les frais bancaires d\u00e9passent le montant de l'acompte, le remboursement n'est pas possible.`;
    } else {
      _retText = `L'annulation a \u00e9t\u00e9 effectu\u00e9e moins de ${cancelDeadlineH}h avant le rendez-vous. Conform\u00e9ment \u00e0 la politique d'annulation, l'acompte n'est pas restituable.`;
    }
    depositHTML = `
    <div style="background:#FEF3E2;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F59E0B">
      <div style="font-size:14px;color:#92700C;font-weight:600">\u26a0\ufe0f Acompte de ${depAmtStr} \u20ac non rembours\u00e9</div>
      <div style="font-size:13px;color:#92700C;margin-top:4px">${_retText}</div>
    </div>`;
  }

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous a \u00e9t\u00e9 annul\u00e9.${booking.cancel_reason ? ' <span style="color:#6B6560;font-size:14px">(' + escHtml(booking.cancel_reason) + ')</span>' : ''}</p>
    <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
      <div style="font-size:15px;font-weight:600;color:#DC2626;margin-bottom:4px">${_ic('calendar-dk')} ${dateStr}</div>
      <div style="font-size:14px;color:#DC2626">${_ic('clock-dk')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName && !(isMulti && groupServices.some(s => s.practitioner_name)) ? `<div style="font-size:14px;color:#6B6560">${safePracName}</div>` : ''}
    </div>
    ${depositHTML}
    ${booking.pass_refunded ? `<div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:12px 0;border-left:3px solid #22C55E"><div style="font-size:14px;color:#15803D;font-weight:600">${_ic('check')} Votre s\u00e9ance de pass a \u00e9t\u00e9 recr\u00e9dit\u00e9e.</div></div>` : ''}
    ${booking.gc_refunded_cents ? `<div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:12px 0;border-left:3px solid #22C55E"><div style="font-size:14px;color:#15803D;font-weight:600">${_ic('check')} ${(booking.gc_refunded_cents / 100).toFixed(2).replace('.', ',')} \u20ac recr\u00e9dit\u00e9s sur votre carte cadeau.</div></div>` : ''}
    <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 reprendre rendez-vous quand vous le souhaitez.</p>`;

  // Address + contact info so client can reach the salon
  if (business.address || business.phone || business.email) {
    let contactHTML = '<div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee">';
    if (business.address) {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.address)}`;
      contactHTML += `<div style="font-size:13px;color:#6B6560;padding:4px 0">${escHtml(business.address)} — <a href="${mapsUrl}" target="_blank" style="color:#0D9488;text-decoration:none;font-weight:500">Google Maps \u2192</a></div>`;
    }
    if (business.phone) contactHTML += `<div style="font-size:13px;color:#6B6560;padding:4px 0">${escHtml(business.phone)}</div>`;
    if (business.email) contactHTML += `<div style="font-size:13px;color:#6B6560;padding:4px 0">${escHtml(business.email)}</div>`;
    contactHTML += '</div>';
    bodyHTML += contactHTML;
  }

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const bookingUrl = business.slug ? `${baseUrl}/${business.slug}/book` : null;

  const html = buildEmailHTML({
    title: 'Rendez-vous annul\u00e9',
    preheader: `Votre RDV du ${dateStr} \u00e0 ${timeStr} a \u00e9t\u00e9 annul\u00e9`,
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
    subject: `Rendez-vous annul\u00e9 \u2014 ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Send reschedule confirmation email to client (after self-reschedule).
 * Shows old vs new time.
 */
async function sendRescheduleConfirmationEmail({ booking, business, oldStartAt, oldEndAt, groupServices }) {
  if (!booking.client_email) return;
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const color = safeColor(business.theme?.primary_color);
  const serviceName = fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label);
  const pracName = booking.practitioner_name || '';
  const hasSplitPrac = groupServices && groupServices.some(s => s.practitioner_name);

  const fmtDate = (iso) => new Date(iso).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' });
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });

  const oldDate = fmtDate(oldStartAt);
  const oldTime = fmtTime(oldStartAt);
  const oldEndTime = fmtTime(oldEndAt);
  const newDate = fmtDate(booking.start_at);
  const newTime = fmtTime(booking.start_at);
  const newEndTime = fmtTime(booking.end_at);

  // Build service detail block
  let detailLines = '';
  if (groupServices && groupServices.length > 1) {
    groupServices.forEach(s => {
      const sPrice = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      detailLines += `<tr><td style="padding:4px 0;font-weight:600">${escHtml(s.name)} \u2014 ${s.duration_min} min${sPrice ? ' \u00b7 ' + sPrice : ''}${pracSuffix}</td></tr>`;
    });
    const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const totalOriginalRS = groupServices.reduce((sum, s) => sum + (s.original_price_cents || s.price_cents || 0), 0);
    const hasMultiLmRS = totalOriginalRS > totalPrice;
    const promoDiscount = booking.promotion_discount_cents || 0;
    const finalPrice = totalPrice - promoDiscount;
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    let totalCellContent = `Total : ${durStr}`;
    if (totalPrice > 0) {
      if (hasMultiLmRS || (promoDiscount > 0 && booking.promotion_label)) {
        const displayBaseRS = hasMultiLmRS ? totalOriginalRS : totalPrice;
        totalCellContent += ` \u00b7 <s style="opacity:.6">${(displayBaseRS / 100).toFixed(2).replace('.', ',')} \u20ac</s> ${(finalPrice / 100).toFixed(2).replace('.', ',')} \u20ac`;
      } else {
        totalCellContent += ` \u00b7 ${(totalPrice / 100).toFixed(2).replace('.', ',')} \u20ac`;
      }
    }
    detailLines += `<tr><td style="padding:6px 0 2px;font-weight:700;border-top:1px solid #E0DDD8">${totalCellContent}</td></tr>`;
    if (hasMultiLmRS) {
      detailLines += `<tr><td style="padding:2px 0;font-size:12px;opacity:.8">Last Minute : -${((totalOriginalRS - totalPrice) / 100).toFixed(2).replace('.', ',')} \u20ac</td></tr>`;
    }
    if (promoDiscount > 0 && booking.promotion_label) {
      detailLines += `<tr><td style="padding:2px 0;font-size:12px;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} \u20ac</td></tr>`;
    }
    if (pracName && !hasSplitPrac) {
      detailLines += `<tr><td style="padding:4px 0;color:#7A7470">Praticien : ${escHtml(pracName)}</td></tr>`;
    }
  } else {
    detailLines = `<tr><td style="padding:4px 0;color:#7A7470;width:100px">Prestation</td><td style="padding:4px 0;font-weight:600">${escHtml(serviceName)}</td></tr>`;
    // Single-service: show price + LM discount + promo
    const rawPriceRS = booking.service_price_cents || 0;
    const singlePriceRS = booking.booked_price_cents || (booking.discount_pct ? Math.round(rawPriceRS * (100 - booking.discount_pct) / 100) : rawPriceRS);
    if (singlePriceRS > 0) {
      const singleDurRS = booking.duration_min || '';
      const promoDiscSingleRS = booking.promotion_discount_cents || 0;
      const hasLmRS = booking.discount_pct && rawPriceRS > singlePriceRS;
      const finalSingleRS = singlePriceRS - promoDiscSingleRS;
      if (hasLmRS || (promoDiscSingleRS > 0 && booking.promotion_label)) {
        const displayBaseSingleRS = hasLmRS ? rawPriceRS : singlePriceRS;
        detailLines += `<tr><td style="padding:4px 0;color:#7A7470">Prix</td><td style="padding:4px 0;font-weight:700">${singleDurRS ? singleDurRS + ' min · ' : ''}<s style="opacity:.6">${(displayBaseSingleRS / 100).toFixed(2).replace('.', ',')} €</s> ${(finalSingleRS / 100).toFixed(2).replace('.', ',')} €</td></tr>`;
        if (hasLmRS) detailLines += `<tr><td></td><td style="padding:2px 0;font-size:12px;opacity:.8">Last Minute -${booking.discount_pct}%</td></tr>`;
        if (promoDiscSingleRS > 0 && booking.promotion_label) detailLines += `<tr><td></td><td style="padding:2px 0;font-size:12px;opacity:.8">${escHtml(booking.promotion_label)} : -${(promoDiscSingleRS / 100).toFixed(2).replace('.', ',')} €</td></tr>`;
      } else {
        detailLines += `<tr><td style="padding:4px 0;color:#7A7470">Prix</td><td style="padding:4px 0;font-weight:600">${singleDurRS ? singleDurRS + ' min · ' : ''}${(singlePriceRS / 100).toFixed(2).replace('.', ',')} €</td></tr>`;
      }
    }
    if (pracName) detailLines += `<tr><td style="padding:4px 0;color:#7A7470">Praticien</td><td style="padding:4px 0;font-weight:600">${escHtml(pracName)}</td></tr>`;
  }

  let bodyHTML = `
    <p>Bonjour ${escHtml(booking.client_name || '')},</p>
    <p>Votre rendez-vous a bien \u00e9t\u00e9 d\u00e9plac\u00e9.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td colspan="2" style="padding:8px 0;font-weight:600;color:#9C958E;font-size:13px;text-transform:uppercase;letter-spacing:.4px">Ancien cr\u00e9neau</td></tr>
      <tr><td style="padding:4px 0;color:#9C958E;text-decoration:line-through">${oldDate}</td><td style="padding:4px 0;color:#9C958E;text-decoration:line-through">${oldTime} \u2013 ${oldEndTime}</td></tr>
      <tr><td colspan="2" style="padding:12px 0 8px;font-weight:600;color:${color};font-size:13px;text-transform:uppercase;letter-spacing:.4px">Nouveau cr\u00e9neau</td></tr>
      <tr><td style="padding:4px 0;font-weight:600">${newDate}</td><td style="padding:4px 0;font-weight:600">${newTime} \u2013 ${newEndTime}</td></tr>
    </table>
    <div style="background:#F5F4F1;border-radius:8px;padding:12px 16px;margin:16px 0">
      <table style="width:100%;border-collapse:collapse">
        ${detailLines}
      </table>
    </div>`;

  // Deposit info for reschedule email
  if (booking.deposit_status === 'paid' && booking.deposit_amount_cents > 0) {
    const depAmtRS = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    bodyHTML += `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u2705 Votre acompte de ${depAmtRS}\u00a0\u20ac reste valable pour ce nouveau cr\u00e9neau.</div>
    </div>`;
  } else if (booking.deposit_status === 'pending' && booking.deposit_amount_cents > 0) {
    const depAmtPending = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    let deadlineNote = '';
    if (booking.deposit_deadline) {
      const dl = new Date(booking.deposit_deadline);
      const dlStr = dl.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short' }) + ' \u00e0 ' + dl.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
      deadlineNote = ` Le d\u00e9lai de paiement est fix\u00e9 au ${dlStr}.`;
    }
    bodyHTML += `
    <div style="background:#FFF3E0;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #FB8C00">
      <div style="font-size:14px;color:#E65100;font-weight:600">\u23f3 Votre acompte de ${depAmtPending}\u00a0\u20ac est toujours attendu pour confirmer ce rendez-vous.${deadlineNote}</div>
    </div>`;
  }

  // Footer: address, contact, payment methods, calendar links
  const calEndAtRS = booking.end_at || booking.start_at;
  bodyHTML += buildBookingFooter({
    business, booking, serviceName,
    practitionerName: pracName,
    startAt: booking.start_at, endAt: calEndAtRS,
    publicToken: booking.public_token || null
  });

  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;
  const html = buildEmailHTML({
    title: 'Rendez-vous déplacé',
    preheader: `Votre RDV a été déplacé au ${newDate} à ${newTime}`,
    bodyHTML,
    businessName: business.name,
    primaryColor: color,
    cancelText: manageUrl ? 'Gérer mon rendez-vous' : null,
    cancelUrl: manageUrl,
    footerText: `${business.name}${business.address ? ' · ' + business.address : ''} · Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Rendez-vous déplacé — ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

module.exports = { sendCancellationEmail, sendRescheduleConfirmationEmail };
