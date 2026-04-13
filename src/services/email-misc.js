/**
 * Email service — miscellaneous emails (session notes, password reset, review, gift cards, passes)
 */

const { escHtml, fmtSvcLabel, sanitizeRichText, safeColor, _ic, sendEmail, buildEmailHTML } = require('./email-utils');

// ── Session notes email ──
async function sendSessionNotesEmail({ to, toName, sessionHTML, serviceName, date, practitionerName, businessName, primaryColor, businessAddress, businessPhone, businessEmail }) {
  const safeSvcName = (serviceName || 'Rendez-vous').slice(0, 100).replace(/[\r\n]/g, ' ');
  const svcLower = escHtml((safeSvcName || 'rendez-vous').toLowerCase());
  const safeFirstName = escHtml(toName ? toName.split(' ')[0] : '');
  const safePracName = escHtml(practitionerName);
  const safeBizName = escHtml(businessName);
  const safeDate = escHtml(date);
  const color = safeColor(primaryColor);
  // SVC-V11-3: Full server-side sanitization of sessionHTML (strip dangerous tags,
  // event handlers, protocol URLs) before embedding in email
  if (sessionHTML) {
    sessionHTML = sanitizeRichText(sessionHTML);
    // Also strip dangerous CSS expressions in style attributes
    sessionHTML = sessionHTML.replace(/\bstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, (match, val) => {
      if (/expression|behavior|binding|url\s*\(/i.test(val)) return '';
      return match;
    });
  }
  const bodyHTML = `
    <p style="margin:0 0 12px">Bonjour${safeFirstName ? ' ' + safeFirstName : ''},</p>
    <p style="margin:0 0 16px">Voici les notes de votre ${svcLower} du <strong>${safeDate}</strong> avec ${safePracName} :</p>
    <div style="background:#f8f8f6;border-left:3px solid ${color};padding:14px 18px;margin:0 0 16px;border-radius:4px;font-size:14px;line-height:1.6">
      ${sessionHTML}
    </div>
    <p style="margin:0">Cordialement,<br><strong>${safeBizName}</strong></p>
    ${businessPhone || businessEmail ? `<p style="font-size:13px;color:#7A7470;margin:12px 0 0">${[businessPhone ? '\u{1F4DE} ' + escHtml(businessPhone) : '', businessEmail ? '\u2709\uFE0F ' + escHtml(businessEmail) : ''].filter(Boolean).join(' \u00b7 ')}</p>` : ''}
  `;
  const footerParts = [businessName, businessAddress, businessPhone, businessEmail, 'Via Genda.be'].filter(Boolean);
  const html = buildEmailHTML({
    title: 'Notes de ' + svcLower,
    bodyHTML,
    businessName,
    primaryColor: color,
    footerText: footerParts.join(' \u00b7 ')
  });
  return sendEmail({
    to,
    toName,
    subject: `Notes — ${safeSvcName} du ${date}`,
    html,
    fromName: businessName,
    replyTo: businessEmail || null
  });
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail({ email, name, resetUrl, businessName }) {
  const safeName = escHtml(name);
  const bodyHTML = `
    <p>Bonjour${safeName ? ' <strong>' + safeName + '</strong>' : ''},</p>
    <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
    <p>Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable <strong>1 heure</strong>.</p>
    <p style="font-size:13px;color:#9C958E;margin-top:20px">Si vous n'avez pas fait cette demande, ignorez simplement cet email.</p>`;

  const html = buildEmailHTML({
    title: 'Réinitialiser votre mot de passe',
    preheader: 'Cliquez pour choisir un nouveau mot de passe',
    bodyHTML,
    ctaText: 'Réinitialiser mon mot de passe',
    ctaUrl: resetUrl,
    businessName: businessName || 'Genda',
    footerText: 'Cet email a été envoyé automatiquement via Genda.be'
  });

  return sendEmail({
    to: email,
    toName: name || email,
    subject: 'Réinitialisation de mot de passe — ' + (businessName || 'Genda'),
    html
  });
}

/**
 * Send review request email — sent X hours after appointment completion
 */
async function sendReviewRequestEmail({ booking, business }) {
  const color = safeColor(business.theme?.primary_color);
  const firstName = escHtml(booking.first_name || booking.client_name?.split(' ')[0] || 'Client');
  const serviceName = escHtml(fmtSvcLabel(booking.service_category, booking.service_name, null, booking.custom_label) || 'votre rendez-vous');
  const practitioner = booking.practitioner_name ? ` avec ${escHtml(booking.practitioner_name)}` : '';
  const safeBizName = escHtml(business.name);

  // Format booking date/time if available
  let rdvDateStr = '';
  if (booking.start_at) {
    const d = new Date(booking.start_at);
    const datePart = d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' });
    const timePart = d.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
    rdvDateStr = ` du ${datePart} \u00e0 ${timePart}`;
  }

  const reviewUrl = `${process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be'}/review/${booking.review_token}`;

  // Star rating buttons (1-5)
  const starsHTML = [1, 2, 3, 4, 5].map(n => {
    const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
    return `<a href="${reviewUrl}?r=${n}" style="display:inline-block;padding:8px 12px;margin:0 4px;background:${n >= 4 ? color : '#F5F4F1'};color:${n >= 4 ? '#fff' : '#6B5E54'};text-decoration:none;border-radius:8px;font-size:16px">${stars}</a>`;
  }).join('');

  const bodyHTML = `
    <p>Bonjour ${firstName},</p>
    <p>Merci d'avoir choisi <strong>${safeBizName}</strong> pour ${serviceName}${rdvDateStr}${practitioner}${booking.service_price_cents ? ' (' + (booking.service_price_cents / 100).toFixed(2).replace('.', ',') + '\u00a0\u20ac)' : ''}. Nous espérons que vous avez pass\u00e9 un agr\u00e9able moment !</p>
    <p style="margin:20px 0 8px;font-weight:600">Comment évalueriez-vous votre expérience ?</p>
    <div style="text-align:center;margin:16px 0">${starsHTML}</div>
    <p style="color:#9C958E;font-size:13px;text-align:center">Cliquez sur les étoiles ou sur le bouton ci-dessous pour donner votre avis.</p>
  `;

  const html = buildEmailHTML({
    title: 'Votre avis compte !',
    preheader: `Comment s'est passé votre RDV chez ${safeBizName} ?`,
    bodyHTML,
    ctaText: 'Donner mon avis',
    ctaUrl: reviewUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: [business.name, business.address, business.phone, business.email, 'Via Genda.be'].filter(Boolean).join(' \u00b7 ')
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Votre avis compte — ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

// ============================================================
// GIFT CARD EMAILS
// ============================================================

/**
 * Send gift card to recipient — beautiful card with code + amount
 */
async function sendGiftCardEmail({ giftCard, business }) {
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const color = safeColor(business.theme?.primary_color);
  const amtStr = (giftCard.amount_cents / 100).toFixed(2).replace('.', ',');
  const expiryStr = giftCard.expires_at
    ? new Date(giftCard.expires_at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const recipientName = giftCard.recipient_name || '';
  const buyerName = giftCard.buyer_name || 'Quelqu\'un';

  const bodyHTML = `
    <p style="margin:0 0 16px">${recipientName ? escHtml(recipientName) + ', v' : 'V'}ous avez reçu une carte cadeau de la part de <strong>${escHtml(buyerName)}</strong> !</p>
    ${giftCard.message ? `<div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:0 0 20px;font-style:italic;color:#5C564F">"${escHtml(giftCard.message)}"</div>` : ''}
    <div style="background:linear-gradient(135deg,${color},${color}dd);border-radius:16px;padding:32px;text-align:center;margin:0 0 20px">
      <div style="font-size:13px;color:rgba(255,255,255,.8);margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">Carte Cadeau</div>
      <div style="font-size:36px;font-weight:800;color:#fff;margin:0 0 12px">${amtStr} €</div>
      <div style="background:rgba(255,255,255,.2);border-radius:8px;padding:12px 20px;display:inline-block">
        <span style="font-size:20px;font-weight:700;color:#fff;letter-spacing:3px;font-family:monospace">${escHtml(giftCard.code)}</span>
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,.7);margin:12px 0 0">Valable chez ${escHtml(business.name)}</div>
    </div>
    ${expiryStr ? `<p style="font-size:13px;color:#9C958E;text-align:center;margin:0 0 8px">Valable jusqu'au ${expiryStr}</p>` : ''}
    <p style="font-size:14px;color:#5C564F;text-align:center">Présentez ce code lors de votre réservation ou en salon.</p>`;

  const gcFooterParts = [business.name, business.address, business.phone, business.email, 'Via Genda.be'].filter(Boolean);
  const html = buildEmailHTML({
    title: 'Votre carte cadeau',
    preheader: `${buyerName} vous offre une carte cadeau de ${amtStr}\u20ac`,
    bodyHTML,
    ctaText: business.slug ? 'R\u00e9server maintenant' : null,
    ctaUrl: business.slug ? `${baseUrl}/${business.slug}/book?gc=${giftCard.code}` : null,
    businessName: business.name,
    primaryColor: color,
    footerText: gcFooterParts.join(' \u00b7 ')
  });

  return sendEmail({
    to: giftCard.recipient_email,
    toName: recipientName,
    subject: `🎁 Vous avez reçu une carte cadeau — ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Send receipt to buyer — confirmation of purchase
 */
async function sendGiftCardReceiptEmail({ giftCard, business }) {
  const amtStr = (giftCard.amount_cents / 100).toFixed(2).replace('.', ',');
  const recipientName = giftCard.recipient_name || giftCard.recipient_email || '—';
  const expiryStr = giftCard.expires_at
    ? new Date(giftCard.expires_at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const bodyHTML = `
    <p style="margin:0 0 16px">Votre carte cadeau a bien été envoyée !</p>
    <div style="background:#F5F4F1;border-radius:10px;padding:20px;margin:0 0 20px">
      <table style="width:100%;font-size:14px;color:#3D3832" cellpadding="4" cellspacing="0">
        <tr><td style="color:#9C958E">Montant</td><td style="text-align:right;font-weight:600">${amtStr} €</td></tr>
        <tr><td style="color:#9C958E">Code</td><td style="text-align:right;font-weight:600;font-family:monospace;letter-spacing:1px">${escHtml(giftCard.code)}</td></tr>
        <tr><td style="color:#9C958E">Destinataire</td><td style="text-align:right">${escHtml(recipientName)}</td></tr>
        ${expiryStr ? `<tr><td style="color:#9C958E">Valable jusqu'au</td><td style="text-align:right">${expiryStr}</td></tr>` : ''}
      </table>
    </div>
    <p style="font-size:14px;color:#5C564F">Un email contenant le code a été envoyé au destinataire.</p>`;

  const rcptFooterParts = [business.name, business.address, business.phone, business.email, 'Via Genda.be'].filter(Boolean);
  const html = buildEmailHTML({
    title: 'Carte cadeau envoy\u00e9e',
    preheader: `Carte cadeau de ${amtStr}\u20ac envoy\u00e9e \u00e0 ${recipientName}`,
    bodyHTML,
    businessName: business.name,
    primaryColor: business.theme?.primary_color,
    footerText: rcptFooterParts.join(' \u00b7 ')
  });

  return sendEmail({
    to: giftCard.buyer_email,
    toName: giftCard.buyer_name,
    subject: `Carte cadeau envoyée — ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

/**
 * Send pass purchase confirmation to buyer — code + details
 */
async function sendPassPurchaseEmail({ pass, business }) {
  const color = safeColor(business.theme?.primary_color);
  const priceFmt = pass.price_cents ? (pass.price_cents / 100).toFixed(2).replace('.', ',') + ' €' : '';
  const unitPrice = (pass.price_cents && pass.sessions_total > 1) ? (pass.price_cents / pass.sessions_total / 100).toFixed(2).replace('.', ',') + ' €' : '';
  const expiresStr = pass.expires_at ? new Date(pass.expires_at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const bodyHTML = `
    <p>Bonjour <strong>${escHtml(pass.buyer_name || 'Client')}</strong>,</p>
    <p>Merci pour votre achat chez <strong>${escHtml(business.name)}</strong> ! Votre abonnement a bien été activé.</p>

    <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:20px 0;text-align:center">
      <div style="font-size:12px;color:#9C958E;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Votre code d'abonnement</div>
      <div style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:3px;color:#1A1816">${escHtml(pass.code)}</div>
    </div>

    <div style="background:#F5F4F1;border-radius:8px;padding:18px 20px;margin:20px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#3D3832">
        <tr><td style="padding:4px 0;font-weight:600;color:#1A1816">Formule</td><td style="padding:4px 0;text-align:right">${escHtml(pass.name)}</td></tr>
        ${pass.service_name ? `<tr><td style="padding:4px 0;font-weight:600;color:#1A1816">Prestation</td><td style="padding:4px 0;text-align:right">${escHtml(pass.service_name)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;font-weight:600;color:#1A1816">Nombre de séances</td><td style="padding:4px 0;text-align:right">${pass.sessions_total} séance${pass.sessions_total > 1 ? 's' : ''}</td></tr>
        ${priceFmt ? `<tr><td style="padding:4px 0;font-weight:600;color:#1A1816">Prix total</td><td style="padding:4px 0;text-align:right;font-weight:700">${priceFmt}</td></tr>` : ''}
        ${unitPrice ? `<tr><td style="padding:4px 0;color:#9C958E">Prix par séance</td><td style="padding:4px 0;text-align:right;color:#9C958E">${unitPrice}</td></tr>` : ''}
        ${expiresStr ? `<tr><td style="padding:4px 0;font-weight:600;color:#1A1816">Valable jusqu'au</td><td style="padding:4px 0;text-align:right">${expiresStr}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#9C958E">Séances restantes</td><td style="padding:4px 0;text-align:right;color:${color};font-weight:700">${pass.sessions_total} / ${pass.sessions_total}</td></tr>
      </table>
    </div>

    <div style="background:#EEFAF1;border:1px solid #BBF7D0;border-radius:8px;padding:14px 16px;margin:20px 0;font-size:13px;color:#1B7A42">
      <strong>Comment utiliser votre abonnement ?</strong><br>
      Lors de votre prochaine réservation, indiquez votre code <strong>${escHtml(pass.code)}</strong> ou votre adresse email. Une séance sera automatiquement débitée de votre pass.
    </div>

    <p style="font-size:13px;color:#9C958E">Conservez cet email comme preuve d'achat. Pour toute question, contactez directement ${escHtml(business.name)}${business.phone ? ' au ' + escHtml(business.phone) : ''}${business.email ? ' (' + escHtml(business.email) + ')' : ''}.</p>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const html = buildEmailHTML({
    title: 'Votre pass est activé',
    preheader: `${pass.sessions_total} séances — ${pass.name}`,
    bodyHTML,
    ctaText: business.slug ? 'Réserver maintenant' : null,
    ctaUrl: business.slug ? `${baseUrl}/${business.slug}/book` : null,
    businessName: business.name,
    primaryColor: color,
    footerText: [business.name, business.address, business.phone, business.email, 'Via Genda.be'].filter(Boolean).join(' \u00b7 ')
  });

  return sendEmail({
    to: pass.buyer_email,
    toName: pass.buyer_name,
    subject: `Votre pass ${pass.name} — ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email
  });
}

// ── Merchant notification: Gift card purchased ──
async function sendGiftCardPurchaseProEmail({ giftCard, business }) {
  if (!business.email) return;
  const amtStr = ((giftCard.amount_cents || 0) / 100).toFixed(2).replace('.', ',');
  const color = safeColor(business.theme?.primary_color);
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const buyerNameRaw = giftCard.buyer_name || 'Client';
  const buyerName = escHtml(buyerNameRaw);
  const recipientName = giftCard.recipient_name ? escHtml(giftCard.recipient_name) : null;
  const html = buildEmailHTML({
    title: 'Carte cadeau achetée',
    preheader: `${buyerNameRaw} a acheté une carte cadeau de ${amtStr} €`,
    bodyHTML: `
      <p>Une carte cadeau a été achetée sur votre page.</p>
      <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
        <div style="font-size:15px;font-weight:600;color:#15803D;margin-bottom:4px">Carte cadeau de ${amtStr} €</div>
        <div style="font-size:14px;color:#3D3832">Achetée par ${buyerName}</div>
        ${recipientName ? `<div style="font-size:13px;color:#6B6560">Pour : ${recipientName}</div>` : ''}
        <div style="font-size:13px;color:#6B6560;margin-top:4px">Code : ${escHtml(giftCard.code)}</div>
      </div>`,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard#gift-cards`,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name} · Via Genda.be`
  });
  return sendEmail({ to: business.email, toName: business.name, subject: `Carte cadeau achetée — ${amtStr} € — ${buyerNameRaw}`, html, fromName: 'Genda' });
}

// ── Merchant notification: Pass purchased ──
async function sendPassPurchaseProEmail({ pass, business }) {
  if (!business.email) return;
  const amtStr = ((pass.price_cents || 0) / 100).toFixed(2).replace('.', ',');
  const color = safeColor(business.theme?.primary_color);
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const buyerNameRaw = pass.buyer_name || 'Client';
  const buyerName = escHtml(buyerNameRaw);
  const passNameRaw = pass.name || '';
  const html = buildEmailHTML({
    title: 'Pass acheté',
    preheader: `${buyerNameRaw} a acheté un pass ${passNameRaw}`,
    bodyHTML: `
      <p>Un pass a été acheté sur votre page.</p>
      <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
        <div style="font-size:15px;font-weight:600;color:#15803D;margin-bottom:4px">Pass : ${escHtml(pass.name)}</div>
        <div style="font-size:14px;color:#3D3832">${pass.sessions_total} séance(s) — ${amtStr} €</div>
        <div style="font-size:13px;color:#6B6560;margin-top:4px">Acheté par ${buyerName}</div>
      </div>`,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard#passes`,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name} · Via Genda.be`
  });
  return sendEmail({ to: business.email, toName: business.name, subject: `Pass acheté — ${passNameRaw} — ${buyerNameRaw}`, html, fromName: 'Genda' });
}

// ── "Retrouver mon RDV" — send list of upcoming bookings to client ──
async function sendBookingLookupEmail({ email, bookings, business }) {
  if (!email || !bookings || bookings.length === 0) return;
  const color = safeColor(business.theme?.primary_color);
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const safeBizName = escHtml(business.name);

  const bookingRows = bookings.map(bk => {
    const dateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', {
      timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long'
    });
    const timeStr = new Date(bk.start_at).toLocaleTimeString('fr-BE', {
      timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
    });
    const svcLabel = escHtml(bk.service_category ? bk.service_category + ' — ' + (bk.service_name || 'RDV') : (bk.service_name || 'Rendez-vous'));
    const pracLabel = bk.practitioner_name ? ' · ' + escHtml(bk.practitioner_name) : '';
    const endTimeStr = bk.end_at ? new Date(bk.end_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) : null;
    const priceStr = bk.price_cents ? (bk.price_cents / 100).toFixed(2).replace('.', ',') + ' €' : '';
    const manageUrl = `${baseUrl}/booking/${bk.public_token}`;
    return `
      <div style="background:#FAFAF9;border:1px solid #E8E4DF;border-radius:8px;padding:14px 16px;margin-bottom:10px">
        <div style="font-size:14px;font-weight:600;color:#3D3832;margin-bottom:4px">${svcLabel}${pracLabel}</div>
        <div style="font-size:13px;color:#6B6560;margin-bottom:10px">${escHtml(dateStr)} · ${escHtml(timeStr)}${endTimeStr ? ' – ' + endTimeStr : ''}${priceStr ? ' · ' + priceStr : ''}</div>
        <a href="${manageUrl}" style="display:inline-block;padding:8px 18px;background:${color};color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600">Gérer ce rendez-vous</a>
      </div>`;
  }).join('');

  const html = buildEmailHTML({
    title: 'Vos rendez-vous',
    preheader: `Vous avez ${bookings.length} rendez-vous à venir chez ${safeBizName}`,
    bodyHTML: `
      <p>Voici vos rendez-vous à venir chez <strong>${safeBizName}</strong> :</p>
      ${bookingRows}
      <p style="font-size:13px;color:#6B6560;margin-top:16px">Cliquez sur "Gérer ce rendez-vous" pour voir les détails, annuler ou modifier.</p>`,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name} · Via Genda.be`
  });

  return sendEmail({
    to: email,
    subject: `Vos rendez-vous chez ${business.name}`,
    html,
    fromName: business.name,
    replyTo: business.email || undefined
  });
}

module.exports = { sendSessionNotesEmail, sendPasswordResetEmail, sendReviewRequestEmail, sendGiftCardEmail, sendGiftCardReceiptEmail, sendPassPurchaseEmail, sendGiftCardPurchaseProEmail, sendPassPurchaseProEmail, sendBookingLookupEmail };
