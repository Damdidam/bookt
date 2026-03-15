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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="${iconStyle}"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <div><div style="${labelStyle}">Adresse</div><div style="${valStyle}">${escHtml(business.address)}</div>
      <a href="${mapsUrl}" target="_blank" style="font-size:12px;color:#0D9488;text-decoration:none;font-weight:500">Ouvrir dans Google Maps \u2192</a></div>
    </div>`;
  }

  // Contact (phone + email)
  if (business.phone || business.email) {
    h += `<div style="${rowStyle}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="${iconStyle}"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
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
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F1;padding:24px 0">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">

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
    <a href="${escHtml(cancelUrl)}" style="display:inline-block;padding:12px 28px;background:#fff;color:#C62828;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;border:2px solid #E57373">${escHtml(cancelText)}</a>
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
 * Send pre-RDV document email to client
 */
async function sendPreRdvEmail({ booking, template, token, business }) {
  const appointmentDate = new Date(booking.start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const appointmentTime = new Date(booking.start_at).toLocaleTimeString('fr-BE', {
    timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit'
  });

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const docUrl = `${baseUrl}/docs/${token}`;

  const typeLabels = {
    info: "Informations pour votre rendez-vous",
    form: "Formulaire à compléter avant votre rendez-vous",
    consent: "Consentement à signer avant votre rendez-vous"
  };

  let bodyHTML = `
    <p>Bonjour <strong>${escHtml(booking.client_name)}</strong>,</p>
    <p>Votre rendez-vous est prévu le <strong>${appointmentDate} à ${appointmentTime}</strong>
    pour <strong>${escHtml(booking.service_name)}</strong>.</p>
    <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
      <div style="font-size:13px;font-weight:600;color:#6B6560;text-transform:uppercase;margin-bottom:6px">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> ${typeLabels[template.type] || 'Document à consulter'}
      </div>
      <div style="font-size:15px;font-weight:600;color:#1A1816">${escHtml(template.name)}</div>
    </div>`;

  if (template.type === 'info') {
    bodyHTML += `<p>Veuillez consulter les informations ci-dessous pour bien préparer votre rendez-vous.</p>`;
  } else if (template.type === 'form') {
    bodyHTML += `<p>Merci de compléter le formulaire en ligne avant votre rendez-vous. Cela nous permettra de mieux vous accueillir.</p>`;
  } else if (template.type === 'consent') {
    bodyHTML += `<p>Veuillez lire et signer le formulaire de consentement avant votre rendez-vous.</p>`;
  }

  const ctaText = template.type === 'info' ? 'Consulter le document' : 'Compléter le formulaire';

  // SVC-V11-12: Escape business name in subject (strip HTML tags for safety)
  const safeBizNameSubject = (business.name || 'Genda').replace(/<[^>]*>/g, '');
  const subject = template.subject || `${template.name} — ${safeBizNameSubject}`;

  const html = buildEmailHTML({
    title: template.name,
    preheader: `Préparez votre rendez-vous du ${appointmentDate}`,
    bodyHTML,
    ctaText,
    ctaUrl: docUrl,
    businessName: business.name,
    primaryColor: business.theme?.primary_color,
    footerText: `${business.name} · ${business.address || ''} · Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject,
    html,
    fromName: business.name,
    replyTo: business.email
  });
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

  const baseUrl = process.env.PUBLIC_URL || process.env.BASE_URL || 'https://genda.be';
  const confirmUrl = `${baseUrl}/api/public/booking/${booking.public_token}/confirm`;
  const rejectUrl = `${baseUrl}/api/public/booking/${booking.public_token}/reject`;
  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safePracName = escHtml(booking.practitioner_name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const safeServiceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(booking.service_name) || 'Rendez-vous';

  let serviceDetailOld = `<div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.6">${safeServiceName}</div>`;
  let serviceDetailNew = `<div style="font-size:13px;color:#15613A;font-weight:600">${safeServiceName} \u00b7 ${safePracName}</div>`;
  if (isMulti) {
    serviceDetailOld = `<div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.6;margin-top:4px">Prestations :</div>`;
    groupServices.forEach(s => {
      serviceDetailOld += `<div style="font-size:12px;color:#92700C;text-decoration:line-through;opacity:.6;padding:1px 0">\u2022 ${escHtml(s.name)}</div>`;
    });
    serviceDetailNew = `<div style="font-size:13px;color:#15613A;font-weight:600;margin-top:4px">Prestations :</div>`;
    groupServices.forEach(s => {
      serviceDetailNew += `<div style="font-size:12px;color:#15613A;padding:1px 0">\u2022 ${escHtml(s.name)}</div>`;
    });
    if (safePracName) serviceDetailNew += `<div style="font-size:13px;color:#15613A;margin-top:4px">${safePracName}</div>`;
  }

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
    <p style="font-size:12px;color:#9C958E;text-align:center">Si vous ne r\u00e9pondez pas, le nouveau cr\u00e9neau sera automatiquement confirm\u00e9.</p>`;

  const cancelUrl = booking.public_token ? `${baseUrl}/api/public/booking/${booking.public_token}/cancel-booking` : null;
  const html = buildEmailHTML({
    title: isMulti ? 'Modification de vos prestations' : 'Modification de votre rendez-vous',
    preheader: `Nouveau cr\u00e9neau : ${newDate} \u00e0 ${newTime}`,
    bodyHTML,
    businessName: business.name,
    primaryColor: color,
    cancelText: cancelUrl ? 'Annuler mon rendez-vous' : null,
    cancelUrl,
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
    : escHtml(booking.service_name || booking.custom_label || 'Rendez-vous');

  let detailLines = `<div style="font-size:15px;font-weight:600;color:#15613A;margin-bottom:4px">${_ic('calendar-grn')} ${dateStr}</div>`;
  detailLines += `<div style="font-size:14px;color:#15613A">${_ic('clock-grn')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>`;

  if (isMulti) {
    detailLines += `<div style="font-size:13px;color:#15613A;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      detailLines += `<div style="font-size:13px;color:#15613A;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}</div>`;
    });
    const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    detailLines += `<div style="font-size:14px;color:#15613A;margin-top:6px;font-weight:700">Total : ${durStr}${totalPrice > 0 ? ' \u00b7 ' + (totalPrice / 100).toFixed(2).replace('.', ',') + ' \u20ac' : ''}</div>`;
  } else {
    detailLines += `<div style="font-size:14px;color:#15613A;margin-top:4px">${_ic('sparkle-grn')} ${serviceName}</div>`;
  }
  if (practitionerName) detailLines += `<div style="font-size:14px;color:#15613A">${_ic('user-grn')} ${practitionerName}</div>`;

  const baseUrl = process.env.PUBLIC_URL || process.env.BASE_URL || 'https://genda.be';
  const hasPublicToken = booking.public_token;

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous est confirm\u00e9 :</p>
    <div style="background:#EEFAF1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #1B7A42">
      ${detailLines}
    </div>`;

  if (booking.comment) {
    bodyHTML += `<p style="font-size:13px;color:#6B6560;margin-top:12px">\u{1F4DD} <em>${safeComment}</em></p>`;
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
    cancelText: hasPublicToken ? 'Annuler mon rendez-vous' : null,
    cancelUrl: hasPublicToken ? `${baseUrl}/api/public/booking/${booking.public_token}/cancel-booking` : null,
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
    : escHtml(booking.service_name || booking.custom_label || 'Rendez-vous');

  let detailLines = `<div style="font-size:15px;font-weight:600;color:#92700C;margin-bottom:4px">${_ic('calendar-amb')} ${dateStr}</div>`;
  detailLines += `<div style="font-size:14px;color:#92700C">${_ic('clock-amb')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>`;

  if (isMulti) {
    detailLines += `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      detailLines += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}</div>`;
    });
  } else {
    detailLines += `<div style="font-size:14px;color:#92700C;margin-top:4px">${_ic('sparkle-amb')} ${serviceName}</div>`;
  }
  if (practitionerName) detailLines += `<div style="font-size:14px;color:#92700C">${_ic('user-amb')} ${practitionerName}</div>`;

  const baseUrl = process.env.PUBLIC_URL || process.env.BASE_URL || 'https://genda.be';
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

  const cancelUrl = `${baseUrl}/api/public/booking/${booking.public_token}/cancel-booking`;

  const html = buildEmailHTML({
    title: 'Confirmez votre rendez-vous',
    preheader: `Confirmez votre RDV du ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText: 'Confirmer mon rendez-vous',
    ctaUrl: confirmUrl,
    cancelText: 'Annuler mon rendez-vous',
    cancelUrl,
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
    : escHtml(booking.service_name || 'Rendez-vous');

  const cancelDeadlineH = business.settings?.cancel_deadline_hours ?? 48;

  let serviceDetailHTML = '';
  if (isMulti) {
    serviceDetailHTML += `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}</div>`;
    });
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#92700C">${safeServiceName}</div>`;
  }

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Un acompte est requis pour confirmer votre rendez-vous :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #F59E0B">
      <div style="font-size:15px;font-weight:600;color:#92700C;margin-bottom:4px">${_ic('calendar-amb')} ${dateStr}</div>
      <div style="font-size:14px;color:#92700C">${_ic('clock-amb')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName ? `<div style="font-size:14px;color:#92700C">${safePracName}</div>` : ''}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0;text-align:center">
      <div style="font-size:13px;font-weight:600;color:#6B6560;text-transform:uppercase;margin-bottom:4px">Montant de l'acompte</div>
      <div style="font-size:24px;font-weight:800;color:#1A1816">${amtStr} \u20ac</div>
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
  const cancelUrl = booking.public_token ? `${baseUrl}/api/public/booking/${booking.public_token}/cancel-booking` : null;

  const html = buildEmailHTML({
    title: 'Acompte requis pour votre rendez-vous',
    preheader: `Acompte de ${amtStr}\u20ac requis avant votre RDV du ${dateStr}`,
    bodyHTML,
    ctaText: `Payer ${amtStr} \u20ac en ligne`,
    ctaUrl: directPayUrl,
    cancelText: cancelUrl ? 'Annuler mon rendez-vous' : null,
    cancelUrl,
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
    : escHtml(booking.service_name || 'Rendez-vous');

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
      serviceDetailHTML += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}</div>`;
    });
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#92700C">${safeServiceName}</div>`;
  }

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
      ${safePracName ? `<div style="font-size:14px;color:#92700C">${safePracName}</div>` : ''}
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
  const cancelUrl = booking.public_token ? `${baseUrl}/api/public/booking/${booking.public_token}/cancel-booking` : null;

  const html = buildEmailHTML({
    title: 'Rappel : acompte en attente',
    preheader: `Rappel — Acompte de ${amtStr}\u20ac \u00e0 r\u00e9gler sous ${timeLeftStr} pour votre RDV du ${dateStr}`,
    bodyHTML,
    ctaText: `Payer ${amtStr} \u20ac maintenant`,
    ctaUrl: directPayUrl,
    cancelText: cancelUrl ? 'Annuler mon rendez-vous' : null,
    cancelUrl,
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
    : escHtml(booking.service_name || 'Rendez-vous');

  let serviceDetailHTML = '';
  if (isMulti) {
    serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}</div>`;
    });
    const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    serviceDetailHTML += `<div style="font-size:14px;color:#1A1816;margin-top:6px;font-weight:700">Total : ${durStr}${totalPrice > 0 ? ' \u00b7 ' + (totalPrice / 100).toFixed(2).replace('.', ',') + ' \u20ac' : ''}</div>`;
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
  }

  let bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre acompte a bien été reçu. Votre rendez-vous est confirmé !</p>
    <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:15px;font-weight:600;color:#15803D;margin-bottom:4px">${_ic('check')} Acompte de ${amtStr} \u20ac re\u00e7u</div>
      <div style="font-size:14px;color:#15803D">Votre rendez-vous est confirmé</div>
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:14px 16px;margin:16px 0">
      <div style="font-size:14px;font-weight:600;color:#1A1816;margin-bottom:4px">${_ic('calendar-dk')} ${dateStr}</div>
      <div style="font-size:14px;color:#1A1816">${_ic('clock-dk')} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceDetailHTML}
      ${safePracName ? `<div style="font-size:14px;color:#6B6560">${safePracName}</div>` : ''}
    </div>
    <p style="font-size:14px;color:#3D3832">Le montant de l'acompte sera <strong>d\u00e9duit du prix total</strong> de votre prestation lors de votre passage.</p>
    <p style="font-size:13px;color:#6B6560">En cas d'annulation jusqu'\u00e0 ${business.settings?.cancel_deadline_hours ?? 48}h avant votre rendez-vous, l'acompte vous sera restitu\u00e9.</p>`;

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
    cancelText: booking.public_token ? 'Annuler mon rendez-vous' : null,
    cancelUrl: booking.public_token ? `${baseUrl}/api/public/booking/${booking.public_token}/cancel-booking` : null,
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
    : escHtml(booking.service_name || 'Rendez-vous');

  let serviceDetailHTML = '';
  if (isMulti) {
    groupServices.forEach(s => {
      serviceDetailHTML += `<div style="font-size:13px;color:#3D3832;padding:2px 0">\u2022 ${escHtml(s.name)}</div>`;
    });
  } else {
    serviceDetailHTML = `<div style="font-size:14px;color:#3D3832">${safeServiceName}</div>`;
  }

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre acompte a \u00e9t\u00e9 rembours\u00e9 suite \u00e0 l'annulation de votre rendez-vous.</p>
    <div style="background:#EFF6FF;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #60A5FA">
      <div style="font-size:15px;font-weight:600;color:#1D4ED8;margin-bottom:4px">${_ic('refund')} Acompte de ${amtStr} \u20ac rembours\u00e9</div>
      <div style="font-size:14px;color:#1D4ED8">Le remboursement appara\u00eetra sur votre relev\u00e9 sous 5 \u00e0 10 jours ouvrables.</div>
    </div>
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
    : escHtml(booking.service_name || 'Rendez-vous');

  let serviceDetailHTML = '';
  if (isMulti) {
    groupServices.forEach(s => {
      serviceDetailHTML += `<div style="font-size:13px;color:#6B6560;padding:2px 0">\u2022 ${escHtml(s.name)}</div>`;
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

  let depositHTML = '';
  if (depositRefunded) {
    depositHTML = `
    <div style="background:#F0FDF4;border-radius:8px;padding:12px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:14px;color:#15803D;font-weight:600">${_ic('check')} Acompte de ${depAmtStr} \u20ac rembours\u00e9</div>
      <div style="font-size:13px;color:#15803D;margin-top:4px">Votre acompte vous sera restitu\u00e9 sous quelques jours ouvrables.</div>
    </div>`;
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

module.exports = { sendEmail, buildEmailHTML, sendPreRdvEmail, sendModificationEmail, sendBookingConfirmation, sendBookingConfirmationRequest, sendPasswordResetEmail, sendSessionNotesEmail, sendDepositRequestEmail, sendDepositReminderEmail, sendDepositPaidEmail, sendDepositRefundEmail, sendCancellationEmail, getCategoryLabels, CATEGORY_LABELS, escHtml, safeColor };
