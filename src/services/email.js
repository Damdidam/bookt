/**
 * Email service using Brevo (Sendinblue) transactional API
 * Handles: confirmations, reminders, pre-RDV documents, invoices
 */

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';

/** Escape a string for safe HTML insertion (prevents XSS) */
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Build "Category - Service — Variant" label (server-side mirror of frontend fmtSvcLabel) */
function fmtSvcLabel(category, serviceName, variantName, customLabel) {
  if (!serviceName) return customLabel || 'Rendez-vous';
  let label = category ? category + ' - ' + serviceName : serviceName;
  if (variantName) label += ' \u2014 ' + variantName;
  return label;
}

/**
 * Sanitize rich text HTML — strip dangerous tags, event handlers, and protocol URLs
 * while keeping safe formatting (b, i, u, br, p, span, strong, em, ul, ol, li, a).
 * SVC-V11-3: Server-side sanitization for sessionHTML before email injection.
 */
function sanitizeRichText(html) {
  if (!html) return '';
  const blocked = 'script|iframe|object|embed|form|textarea|input|select|button|svg|math|style|details|template|link|meta|base|img|video|audio|body|marquee|noscript|plaintext|xmp|listing|head|html|applet|layer|ilayer|bgsound|title';
  let s = html;
  let prev;
  // Remove dangerous tags and their content (loop until stable for nested tags)
  do {
    prev = s;
    s = s.replace(new RegExp('<(' + blocked + ')[^>]*>[\\s\\S]*?<\\/\\1>', 'gi'), '');
    s = s.replace(new RegExp('<(' + blocked + ')[^>]*\\/?>', 'gi'), '');
  } while (s !== prev);
  // Remove event handlers (on*="...")
  let prev2;
  do {
    prev2 = s;
    s = s.replace(/[\s"'/<]on\s*\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  } while (s !== prev2);
  // Remove dangerous protocol URLs in href/src/action
  s = s.replace(/(href|src|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, (match, attr, val) => {
    const decoded = val.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
                       .replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
                       .replace(/&[a-z]+;/gi, '');
    if (/^\s*["']?\s*(javascript|data|vbscript|blob)\s*:/i.test(decoded)) {
      return attr + '=""';
    }
    return match;
  });
  return s;
}

/** Validate that a string is a valid hex color; returns fallback if not */
function safeColor(color, fallback) {
  if (color && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return color;
  return fallback || '#0D7377';
}

/** Inline SVG icon for emails — hosted, compatible with all email clients */
function _ic(name, w = 18, h = 18) {
  const base = (process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be') + '/email';
  return `<img src="${base}/${name}.svg" width="${w}" height="${h}" style="vertical-align:middle;margin-right:4px" alt="">`;
}

/**
 * Get end time for display — uses booking.end_at directly (already includes
 * buffer for both single and multi-service bookings, consistent with calendar).
 */
function getRealEndAt(booking) {
  return booking.end_at ? new Date(booking.end_at) : null;
}

/** Format a Date to "HH:MM" in Brussels timezone */
function fmtTimeBrussels(d) {
  if (!d) return null;
  return new Date(d).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
}

/**
 * Send a transactional email via Brevo
 * @param {Object} opts
 * @param {string} opts.to - recipient email
 * @param {string} opts.toName - recipient name
 * @param {string} opts.subject - email subject
 * @param {string} opts.html - HTML body
 * @param {string} [opts.fromName] - sender name override
 * @param {string} [opts.fromEmail] - sender email override
 * @param {string} [opts.replyTo] - reply-to email
 * @param {Object} [opts.params] - template parameters
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendEmail(opts) {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(opts.to)) return { success: false, error: 'Invalid recipient email' };
  if (opts.replyTo && !EMAIL_RE.test(opts.replyTo)) delete opts.replyTo;

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('[EMAIL] BREVO_API_KEY not set — email not sent:', opts.subject, '→', opts.to);
    return { success: false, error: 'BREVO_API_KEY not configured' };
  }

  try {
    const payload = {
      sender: {
        name: opts.fromName || 'Genda',
        email: opts.fromEmail || process.env.BREVO_FROM_EMAIL || 'noreply@genda.be'
      },
      to: [{ email: opts.to, name: opts.toName || opts.to }],
      subject: opts.subject,
      htmlContent: opts.html
    };

    if (opts.replyTo) {
      payload.replyTo = { email: opts.replyTo };
    }

    const response = await fetch(BREVO_API, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('[EMAIL] Brevo error:', response.status, err);
      return { success: false, error: err.message || `HTTP ${response.status}` };
    }

    const data = await response.json();
    console.log('[EMAIL] Sent:', opts.subject, '→', opts.to, 'messageId:', data.messageId);
    return { success: true, messageId: data.messageId };
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Build booking footer block for confirmation emails.
 * Includes: address + Google Maps, contact, payment methods, calendar links.
 * All info the client needs — no external pages required.
 */
function buildBookingFooter({ business, booking, serviceName, practitionerName, startAt, endAt, publicToken }) {
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const rowStyle = 'display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f0';
  const labelStyle = 'font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.4px';
  const valStyle = 'font-size:13px;color:#1A1816;line-height:1.4';
  const iconStyle = 'width:18px;height:18px;color:#999;flex-shrink:0;margin-top:1px';
  let h = '<div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee">';

  // Address + Google Maps
  if (business.address) {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.address)}`;
    h += `<div style="${rowStyle}">
      ${_ic('pin-dk')}
      <div><div style="${labelStyle}">Adresse</div><div style="${valStyle}">${escHtml(business.address)}</div>
      <a href="${mapsUrl}" target="_blank" style="font-size:12px;color:#0D9488;text-decoration:none;font-weight:500">Ouvrir dans Google Maps \u2192</a></div>
    </div>`;
  }

  // Contact (phone + email)
  if (business.phone || business.email) {
    h += `<div style="${rowStyle}">
      ${_ic('phone-dk')}
      <div><div style="${labelStyle}">Contact</div>`;
    if (business.phone) h += `<div style="${valStyle}">${escHtml(business.phone)}</div>`;
    if (business.email) h += `<div style="${valStyle}">${escHtml(business.email)}</div>`;
    h += `</div></div>`;
  }

  // Payment methods
  const pmList = business.settings?.payment_methods;
  if (Array.isArray(pmList) && pmList.length > 0) {
    const pmLabels = { cash: 'Espèces', card: 'Carte bancaire', bancontact: 'Bancontact', apple_pay: 'Apple Pay', google_pay: 'Google Pay', payconiq: 'Payconiq', instant_transfer: 'Virement instantané', bank_transfer: 'Virement bancaire' };
    const badges = pmList.map(m => `<span style="display:inline-block;font-size:11px;color:#555;background:#F3F4F6;border-radius:20px;padding:3px 10px;margin:2px">${pmLabels[m] || m}</span>`).join(' ');
    h += `<div style="padding:10px 0;border-bottom:1px solid #f0f0f0">
      <div style="${labelStyle};margin-bottom:6px">Paiements acceptés sur place</div>${badges}
    </div>`;
  }

  // Calendar links
  if (publicToken) {
    const fmtGcal = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const gcalParams = new URLSearchParams({
      action: 'TEMPLATE',
      text: serviceName + ' — ' + (business.name || ''),
      dates: `${fmtGcal(startAt)}/${fmtGcal(endAt || startAt)}`,
      details: practitionerName ? `Avec ${practitionerName}` : '',
      location: business.address || ''
    });
    const gcalUrl = `https://calendar.google.com/calendar/render?${gcalParams.toString()}`;
    const icsUrl = `${baseUrl}/api/public/booking/${publicToken}/calendar.ics`;
    const btnStyle = 'display:inline-block;font-size:12px;font-weight:500;color:#555;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:20px;padding:5px 14px;text-decoration:none;margin:3px';

    h += `<div style="padding:12px 0;text-align:center">
      <div style="${labelStyle};margin-bottom:8px">Ajouter \u00e0 mon calendrier</div>
      <a href="${gcalUrl}" target="_blank" style="${btnStyle}">Google</a>
      <a href="${icsUrl}" style="${btnStyle}">Apple / Outlook</a>
    </div>`;
  }

  h += '</div>';
  return h;
}

/**
 * Build a styled HTML email using Genda branding
 */
function buildEmailHTML({ title, preheader, bodyHTML, ctaText, ctaUrl, cancelText, cancelUrl, footerText, businessName, primaryColor }) {
  const color = safeColor(primaryColor);
  const safeTitle = escHtml(title);
  const safeBizName = escHtml(businessName) || 'Genda';
  const safePreheader = escHtml(preheader);
  const safeFooter = escHtml(footerText) || 'Cet email a été envoyé automatiquement via Genda.be';
  const safeCta = escHtml(ctaText);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
</head><body style="margin:0;padding:0;background:#F5F4F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
${safePreheader ? `<span style="display:none!important;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${safePreheader}</span>` : ''}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F1;padding:24px 16px">
<tr><td align="center" style="padding:0">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);max-width:100%">

<!-- Header -->
<tr><td style="background:${color};padding:24px 32px;text-align:center">
  <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px">${safeBizName}</div>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px">
  <h1 style="font-size:20px;font-weight:700;color:#1A1816;margin:0 0 16px">${safeTitle}</h1>
  <div style="font-size:15px;line-height:1.6;color:#3D3832">${bodyHTML}</div>
  ${safeCta && ctaUrl ? `
  <div style="text-align:center;margin:28px 0">
    <a href="${escHtml(ctaUrl || '')}" style="display:inline-block;padding:14px 32px;background:${color};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">${safeCta}</a>
  </div>` : ''}
  ${cancelText && cancelUrl ? `
  <div style="text-align:center;margin:${safeCta ? '0' : '28px'} 0 8px">
    <a href="${escHtml(cancelUrl)}" style="display:inline-block;padding:12px 28px;background:#fff;color:#3D3832;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;border:2px solid #D0CDC8">${escHtml(cancelText)}</a>
  </div>` : ''}
</td></tr>

<!-- Footer -->
<tr><td style="padding:20px 32px;border-top:1px solid #E0DDD8;text-align:center">
  <p style="font-size:12px;color:#9C958E;margin:0">${safeFooter}</p>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/**
 * Send modification notification email with Confirm/Reject buttons
 */
async function sendModificationEmail({ booking, business, groupServices }) {
  const oldDate = new Date(booking.old_start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long'
  });
  const oldTime = new Date(booking.old_start_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
  const newDate = new Date(booking.new_start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long'
  });
  const newTime = fmtTimeBrussels(booking.new_start_at);
  // For multi-service: compute real end from start + total duration
  const isMultiMod = Array.isArray(groupServices) && groupServices.length > 1;
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
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name));

  let serviceDetailOld = `<div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.6">${safeServiceName}</div>`;
  let serviceDetailNew = `<div style="font-size:13px;color:#15613A;font-weight:600">${safeServiceName} \u00b7 ${safePracName}</div>`;
  if (isMulti) {
    serviceDetailOld = `<div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.6;margin-top:4px">Prestations :</div>`;
    groupServices.forEach(s => {
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailOld += `<div style="font-size:12px;color:#92700C;text-decoration:line-through;opacity:.6;padding:1px 0">\u2022 ${escHtml(s.name)}${pracSuffix}</div>`;
    });
    serviceDetailNew = `<div style="font-size:13px;color:#15613A;font-weight:600;margin-top:4px">Prestations :</div>`;
    groupServices.forEach(s => {
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailNew += `<div style="font-size:12px;color:#15613A;padding:1px 0">\u2022 ${escHtml(s.name)}${pracSuffix}</div>`;
    });
    const hasSplitPracMod = groupServices.some(s => s.practitioner_name);
    if (safePracName && !hasSplitPracMod) serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:4px">${safePracName}</div>`;
  }

  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous a \u00e9t\u00e9 modifi\u00e9 :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #E6A817">
      <div style="font-size:13px;color:#92700C;margin-bottom:4px"><strong>Avant :</strong> ${oldDate} \u00e0 ${oldTime}</div>
      ${serviceDetailOld}
    </div>
    <div style="background:#EEFAF1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #1B7A42">
      <div style="font-size:13px;color:#15613A;margin-bottom:4px"><strong>Nouveau :</strong> ${newDate} \u00e0 ${newTime} \u2013 ${newEndTime}</div>
      ${serviceDetailNew}
    </div>
    <p style="margin-top:20px;font-size:15px">Ce nouvel horaire vous convient-il ?</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${escHtml(confirmUrl)}" style="display:inline-block;padding:14px 36px;background:${color};color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-right:12px"> Oui, \u00e7a me va</a>
      <a href="${escHtml(rejectUrl)}" style="display:inline-block;padding:14px 36px;background:#fff;color:#C62828;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;border:2px solid #E57373"> Non</a>
    </div>
    <p style="font-size:12px;color:#9C958E;text-align:center">Si vous ne r\u00e9pondez pas, le nouveau cr\u00e9neau sera automatiquement confirm\u00e9.</p>
    <div style="text-align:center;margin:20px 0 0;padding-top:16px;border-top:1px solid #E0DDD8">
      <a href="${escHtml(manageUrl || '')}" style="font-size:13px;color:#C62828;text-decoration:none;font-weight:600">Annuler le rendez-vous</a>
    </div>`;

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
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    detailLines += `<div style="font-size:14px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStr}${totalPrice > 0 ? ' \u00b7 ' + (totalPrice / 100).toFixed(2).replace('.', ',') + ' \u20ac' : ''}</div>`;
  } else {
    detailLines += `<div style="font-size:14px;color:#15613A;margin-top:4px">${_ic('sparkle-grn')} ${serviceName}</div>`;
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

  // Gift card auto-paid deposit banner
  if (booking.deposit_required && booking.deposit_status === 'paid' && booking.deposit_amount_cents > 0
      && booking.deposit_payment_intent_id && booking.deposit_payment_intent_id.startsWith('gc_')) {
    const depAmt = (booking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
    const gcCode = booking.deposit_payment_intent_id.replace('gc_', '');
    bodyHTML += `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} Acompte de ${depAmt}\u00a0\u20ac r\u00e9gl\u00e9 via votre carte cadeau</div>
      <div style="font-size:12px;color:#8D6E63;margin-top:4px">Carte ${gcCode}</div>
    </div>`;
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
  } else {
    detailLines += `<div style="font-size:14px;color:#92700C;margin-top:4px">${_ic('sparkle-amb')} ${serviceName}</div>`;
  }
  if (practitionerName && !hasSplitPracCR) detailLines += `<div style="font-size:14px;color:#92700C">${_ic('user-amb')} ${practitionerName}</div>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const confirmUrl = `${baseUrl}/api/public/booking/${booking.public_token}/confirm-booking`;

  const delayLabel = timeoutMin >= 60
    ? Math.floor(timeoutMin / 60) + 'h' + (timeoutMin % 60 > 0 ? String(timeoutMin % 60).padStart(2, '0') : '')
    : timeoutMin + ' minutes';

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous a bien \u00e9t\u00e9 enregistr\u00e9. Merci de le <strong>confirmer</strong> en cliquant ci-dessous :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #E6A817">
      ${detailLines}
    </div>
    <p style="font-size:13px;color:#92700C;margin-top:8px">${_ic('hourglass-amb', 16, 16)} Vous avez <strong>${delayLabel}</strong> pour confirmer. Sans confirmation, le cr\u00e9neau sera automatiquement lib\u00e9r\u00e9.</p>`;

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

// ── Category-based terminology (server-side) ──
const CATEGORY_LABELS = {
  sante:            { client:'Patient·e',  clients:'Patients',    service:'Consultation', services:'Consultations' },
  beaute:           { client:'Client·e',   clients:'Client·e·s',  service:'Prestation',   services:'Prestations' },
  juridique_finance:{ client:'Client·e',   clients:'Client·e·s',  service:'Consultation', services:'Consultations' },
  education:        { client:'Élève',      clients:'Élèves',      service:'Cours',        services:'Cours' },
  creatif:          { client:'Client·e',   clients:'Client·e·s',  service:'Séance',       services:'Séances' },
  autre:            { client:'Client·e',   clients:'Client·e·s',  service:'Service',      services:'Services' }
};
function getCategoryLabels(category) { return CATEGORY_LABELS[category] || CATEGORY_LABELS.autre; }

// ── Session notes email ──
async function sendSessionNotesEmail({ to, toName, sessionHTML, serviceName, date, practitionerName, businessName, primaryColor }) {
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
  `;
  const html = buildEmailHTML({
    title: 'Notes de ' + svcLower,
    bodyHTML,
    businessName,
    primaryColor: color
  });
  return sendEmail({
    to,
    toName,
    subject: `Notes — ${safeSvcName} du ${date}`,
    html
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
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name));

  const cancelDeadlineH = business.settings?.cancel_deadline_hours ?? 48;

  let serviceDetailHTML = '';
  if (isMulti) {
    serviceDetailHTML += `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#92700C">${safeServiceName}</div>`;
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
    footerText: `${safeBizName}${business.address ? ' \u00b7 ' + escHtml(business.address) : ''} \u00b7 Via Genda.be`
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
  const amtStr = ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
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
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name));

  const cancelDeadlineH = business.settings?.cancel_deadline_hours ?? 48;

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
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#92700C">${safeServiceName}</div>`;
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
      <div style="font-size:24px;font-weight:800;color:#1A1816">${amtStr} \u20ac</div>
      ${deadlineStr ? `<div style="font-size:12px;color:#DC2626;margin-top:6px;font-weight:600">\u00c0 r\u00e9gler avant le ${deadlineStr}</div>` : ''}
    </div>
    <div style="background:#F0F9FF;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #60A5FA">
      <div style="font-size:13px;color:#1E40AF;line-height:1.5">
        ${_ic('info', 16, 16)} <strong>Bon \u00e0 savoir :</strong><br>
        \u2022 Cet acompte sera <strong>d\u00e9duit de votre facture totale</strong> lors de votre passage.<br>
        \u2022 Il est <strong>restituable</strong> en cas d'annulation jusqu'\u00e0 <strong>${cancelDeadlineH}h avant</strong> votre rendez-vous.
      </div>
    </div>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const directPayUrl = payUrl || (booking.public_token ? `${baseUrl}/api/public/deposit/${booking.public_token}/pay` : depositUrl);
  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;

  const html = buildEmailHTML({
    title: 'Rappel : acompte en attente',
    preheader: `Rappel — Acompte de ${amtStr}\u20ac \u00e0 r\u00e9gler sous ${timeLeftStr} pour votre RDV du ${dateStr}`,
    bodyHTML,
    ctaText: `Payer ${amtStr} \u20ac maintenant`,
    ctaUrl: directPayUrl,
    cancelText: manageUrl ? 'Gérer mon rendez-vous' : null,
    cancelUrl: manageUrl,
    businessName: business.name,
    primaryColor: color,
    footerText: `${safeBizName}${business.address ? ' \u00b7 ' + escHtml(business.address) : ''} \u00b7 Via Genda.be`
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
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name));

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
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    serviceDetailHTML += `<div style="font-size:14px;color:#1A1816;margin-top:6px;font-weight:700">Total : ${durStr}${totalPrice > 0 ? ' \u00b7 ' + (totalPrice / 100).toFixed(2).replace('.', ',') + ' \u20ac' : ''}</div>`;
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
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
    <p style="font-size:14px;color:#3D3832">Le montant de l'acompte sera <strong>d\u00e9duit du prix total</strong> de votre prestation lors de votre passage.</p>
    <p style="font-size:13px;color:#6B6560">En cas d'annulation jusqu'\u00e0 ${business.settings?.cancel_deadline_hours ?? 48}h avant votre rendez-vous, l'acompte vous sera restitu\u00e9${gcPaidCents > 0 && stripePaidCents > 0 ? ' (carte cadeau recr\u00e9dit\u00e9e + remboursement bancaire)' : gcPaidCents > 0 ? ' sur votre carte cadeau' : ''}.</p>`;

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
    footerText: `${safeBizName}${business.address ? ' · ' + escHtml(business.address) : ''} · Via Genda.be`
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

  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safeBizName = escHtml(business.name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const safeServiceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name));

  let serviceDetailHTML = '';
  if (isMulti) {
    groupServices.forEach(s => {
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;padding:2px 0">\u2022 ${escHtml(s.name)}${pracSuffix}</div>`;
    });
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
  }

  // Determine refund method: gift card, stripe, or mixed
  const gcRefundCents = booking.gc_paid_cents || 0;
  const stripeRefundCents = (booking.deposit_amount_cents || 0) - gcRefundCents;
  const isFullGc = gcRefundCents > 0 && stripeRefundCents <= 0;
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
    // Mix GC + Stripe
    const gcStr = (gcRefundCents / 100).toFixed(2).replace('.', ',');
    const stripeStr = (stripeRefundCents / 100).toFixed(2).replace('.', ',');
    refundBanner = `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} ${gcStr}\u00a0\u20ac recr\u00e9dit\u00e9s sur votre carte cadeau</div>
    </div>
    <div style="background:#EFF6FF;border-radius:8px;padding:12px 16px;margin:4px 0 16px;border-left:3px solid #60A5FA">
      <div style="font-size:14px;color:#1D4ED8;font-weight:600">${_ic('refund')} ${stripeStr}\u00a0\u20ac rembours\u00e9s par carte bancaire</div>
      <div style="font-size:13px;color:#1D4ED8">Le remboursement appara\u00eetra sur votre relev\u00e9 sous 5 \u00e0 10 jours ouvrables.</div>
    </div>`;
  } else {
    // 100% Stripe — bank refund delay
    refundBanner = `
    <div style="background:#EFF6FF;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #60A5FA">
      <div style="font-size:15px;font-weight:600;color:#1D4ED8;margin-bottom:4px">${_ic('refund')} Acompte de ${amtStr}\u00a0\u20ac rembours\u00e9</div>
      <div style="font-size:14px;color:#1D4ED8">Le remboursement appara\u00eetra sur votre relev\u00e9 sous 5 \u00e0 10 jours ouvrables.</div>
    </div>`;
  }

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre acompte a \u00e9t\u00e9 rembours\u00e9 suite \u00e0 l'annulation de votre rendez-vous.</p>
    ${refundBanner}
    <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0">
      <div style="font-size:13px;font-weight:600;color:#6B6560;text-transform:uppercase;margin-bottom:4px">Rendez-vous annul\u00e9</div>
      <div style="font-size:14px;color:#3D3832">${_ic('calendar-dk')} ${dateStr}</div>
      <div style="font-size:14px;color:#3D3832">${_ic('clock-dk')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
    </div>
    <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 reprendre rendez-vous quand vous le souhaitez.</p>`;

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
    footerText: `${safeBizName}${business.address ? ' \u00b7 ' + escHtml(business.address) : ''} \u00b7 Via Genda.be`
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
    : escHtml(fmtSvcLabel(booking.service_category, booking.service_name));

  let serviceDetailHTML = '';
  if (isMulti) {
    groupServices.forEach(s => {
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#6B6560;padding:2px 0">\u2022 ${escHtml(s.name)}${pracSuffix}</div>`;
    });
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
  }

  // Deposit info for cancellation email
  const hadDeposit = booking.deposit_required && booking.deposit_amount_cents > 0;
  const wasPaid = hadDeposit && !!booking.deposit_paid_at;
  const depositRefunded = wasPaid && booking.deposit_status === 'refunded';
  const depositRetained = wasPaid && booking.deposit_status === 'cancelled';
  const depAmtStr = hadDeposit ? ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',') : '';

  const gcCancelCents = booking.gc_paid_cents || 0;
  const stripeCancelCents = hadDeposit ? (booking.deposit_amount_cents || 0) - gcCancelCents : 0;
  const isFullGcCancel = gcCancelCents > 0 && stripeCancelCents <= 0;
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
      <div style="font-size:13px;color:#15803D;margin-top:4px">Le remboursement appara\u00eetra sur votre relev\u00e9 sous quelques jours ouvrables.</div>
    </div>`;
    } else if (isFullGcCancel) {
      depositHTML = `
    <div style="background:#FFF8E1;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F9A825">
      <div style="font-size:14px;color:#5D4037;font-weight:600">\u{1F381} Acompte de ${depAmtStr}\u00a0\u20ac recr\u00e9dit\u00e9 sur votre carte cadeau</div>
    </div>`;
    } else {
      depositHTML = `
    <div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">${_ic('check')} Acompte de ${depAmtStr}\u00a0\u20ac rembours\u00e9</div>
      <div style="font-size:13px;color:#15803D;margin-top:4px">Votre acompte vous sera restitu\u00e9 sous quelques jours ouvrables.</div>
    </div>`;
    }
  } else if (depositRetained) {
    const cancelDeadlineH = business.settings?.cancel_deadline_hours ?? 48;
    depositHTML = `
    <div style="background:#FEF3E2;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #F59E0B">
      <div style="font-size:14px;color:#92700C;font-weight:600">\u26a0\ufe0f Acompte de ${depAmtStr} \u20ac non rembours\u00e9</div>
      <div style="font-size:13px;color:#92700C;margin-top:4px">L'annulation a \u00e9t\u00e9 effectu\u00e9e moins de ${cancelDeadlineH}h avant le rendez-vous. Conform\u00e9ment \u00e0 la politique d'annulation, l'acompte n'est pas restituable.</div>
    </div>`;
  }

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous a \u00e9t\u00e9 annul\u00e9.</p>
    <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
      <div style="font-size:15px;font-weight:600;color:#DC2626;margin-bottom:4px">${_ic('calendar-dk')} ${dateStr}</div>
      <div style="font-size:14px;color:#DC2626">${_ic('clock-dk')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName ? `<div style="font-size:14px;color:#6B6560">${safePracName}</div>` : ''}
    </div>
    ${depositHTML}
    <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 reprendre rendez-vous quand vous le souhaitez.</p>`;

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
    footerText: `${safeBizName}${business.address ? ' \u00b7 ' + escHtml(business.address) : ''} \u00b7 Via Genda.be`
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
 * Send review request email — sent X hours after appointment completion
 */
async function sendReviewRequestEmail({ booking, business }) {
  const color = safeColor(business.theme?.primary_color);
  const firstName = escHtml(booking.first_name || booking.client_name?.split(' ')[0] || 'Client');
  const serviceName = escHtml(fmtSvcLabel(booking.service_category, booking.service_name) || 'votre rendez-vous');
  const practitioner = booking.practitioner_name ? ` avec ${escHtml(booking.practitioner_name)}` : '';
  const safeBizName = escHtml(business.name);

  const reviewUrl = `${process.env.BASE_URL || 'https://genda.be'}/review/${booking.review_token}`;

  // Star rating buttons (1-5)
  const starsHTML = [1, 2, 3, 4, 5].map(n => {
    const stars = '★'.repeat(n) + '☆'.repeat(5 - n);
    return `<a href="${reviewUrl}?r=${n}" style="display:inline-block;padding:8px 12px;margin:0 4px;background:${n >= 4 ? color : '#F5F4F1'};color:${n >= 4 ? '#fff' : '#6B5E54'};text-decoration:none;border-radius:8px;font-size:16px">${stars}</a>`;
  }).join('');

  const bodyHTML = `
    <p>Bonjour ${firstName},</p>
    <p>Merci d'avoir choisi <strong>${safeBizName}</strong> pour ${serviceName}${practitioner}. Nous espérons que vous avez passé un agréable moment !</p>
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
    footerText: `${safeBizName}${business.address ? ' · ' + escHtml(business.address) : ''} · Via Genda.be`
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

/**
 * Send reschedule confirmation email to client (after self-reschedule).
 * Shows old vs new time.
 */
async function sendRescheduleConfirmationEmail({ booking, business, oldStartAt, oldEndAt, groupServices }) {
  if (!booking.client_email) return;
  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const color = safeColor(business.settings?.theme?.primary_color || business.settings?.primaryColor);
  const serviceName = booking.service_name || 'Prestation';
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
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      detailLines += `<tr><td style="padding:4px 0;font-weight:600">${escHtml(s.name)}${pracSuffix}</td></tr>`;
    });
    const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    detailLines += `<tr><td style="padding:6px 0 2px;font-weight:700;border-top:1px solid #E0DDD8">Total : ${totalMin} min${totalPrice ? ' \u00b7 ' + (totalPrice / 100).toFixed(0) + '\u20ac' : ''}</td></tr>`;
    if (pracName && !hasSplitPrac) {
      detailLines += `<tr><td style="padding:4px 0;color:#7A7470">Praticien : ${escHtml(pracName)}</td></tr>`;
    }
  } else {
    detailLines = `<tr><td style="padding:4px 0;color:#7A7470;width:100px">Prestation</td><td style="padding:4px 0;font-weight:600">${escHtml(serviceName)}</td></tr>
        <tr><td style="padding:4px 0;color:#7A7470">Praticien</td><td style="padding:4px 0;font-weight:600">${escHtml(pracName)}</td></tr>`;
  }

  const bodyHTML = `
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

  const manageUrl = booking.public_token ? `${baseUrl}/booking/${booking.public_token}` : null;
  const html = buildEmailHTML({
    title: 'Rendez-vous déplacé',
    preheader: `Votre RDV a été déplacé au ${newDate} à ${newTime}`,
    bodyHTML,
    businessName: business.name,
    primaryColor: color,
    cancelText: manageUrl ? 'Gérer mon rendez-vous' : null,
    cancelUrl: manageUrl,
    footerText: `${business.name} · Via Genda.be`
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

// ============================================================
// GIFT CARD EMAILS
// ============================================================

/**
 * Send gift card to recipient — beautiful card with code + amount
 */
async function sendGiftCardEmail({ giftCard, business }) {
  const baseUrl = process.env.APP_BASE_URL || 'https://genda.be';
  const color = safeColor(business.theme?.primary_color);
  const amtStr = (giftCard.amount_cents / 100).toFixed(2).replace('.', ',');
  const expiryStr = giftCard.expires_at
    ? new Date(giftCard.expires_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })
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

  const html = buildEmailHTML({
    title: 'Votre carte cadeau',
    preheader: `${buyerName} vous offre une carte cadeau de ${amtStr}€`,
    bodyHTML,
    ctaText: 'Réserver maintenant',
    ctaUrl: `${baseUrl}/${business.slug}/book?gc=${giftCard.code}`,
    businessName: business.name,
    primaryColor: color
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

  const bodyHTML = `
    <p style="margin:0 0 16px">Votre carte cadeau a bien été envoyée !</p>
    <div style="background:#F5F4F1;border-radius:10px;padding:20px;margin:0 0 20px">
      <table style="width:100%;font-size:14px;color:#3D3832" cellpadding="4" cellspacing="0">
        <tr><td style="color:#9C958E">Montant</td><td style="text-align:right;font-weight:600">${amtStr} €</td></tr>
        <tr><td style="color:#9C958E">Code</td><td style="text-align:right;font-weight:600;font-family:monospace;letter-spacing:1px">${escHtml(giftCard.code)}</td></tr>
        <tr><td style="color:#9C958E">Destinataire</td><td style="text-align:right">${escHtml(recipientName)}</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:#5C564F">Un email contenant le code a été envoyé au destinataire.</p>`;

  const html = buildEmailHTML({
    title: 'Carte cadeau envoyée',
    preheader: `Carte cadeau de ${amtStr}€ envoyée à ${recipientName}`,
    bodyHTML,
    businessName: business.name,
    primaryColor: business.theme?.primary_color
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
  const expiresStr = pass.expires_at ? new Date(pass.expires_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

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

    <p style="font-size:13px;color:#9C958E">Conservez cet email comme preuve d'achat. Pour toute question, contactez directement ${escHtml(business.name)}.</p>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const html = buildEmailHTML({
    title: 'Votre pass est activé',
    preheader: `${pass.sessions_total} séances — ${pass.name}`,
    bodyHTML,
    ctaText: 'Réserver maintenant',
    ctaUrl: `${baseUrl}/${business.slug}/book`,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name} · Via Genda.be`
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

module.exports = { sendEmail, buildEmailHTML, sendModificationEmail, sendBookingConfirmation, sendBookingConfirmationRequest, sendPasswordResetEmail, sendSessionNotesEmail, sendDepositRequestEmail, sendDepositReminderEmail, sendDepositPaidEmail, sendDepositRefundEmail, sendCancellationEmail, sendReviewRequestEmail, sendRescheduleConfirmationEmail, sendGiftCardEmail, sendGiftCardReceiptEmail, sendPassPurchaseEmail, getCategoryLabels, CATEGORY_LABELS, escHtml, safeColor };
