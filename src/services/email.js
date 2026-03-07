/**
 * Email service using Brevo (Sendinblue) transactional API
 * Handles: confirmations, reminders, pre-RDV documents, invoices
 */

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';

/** Escape a string for safe HTML insertion (prevents XSS) */
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
 * Build a styled HTML email using Genda branding
 */
function buildEmailHTML({ title, preheader, bodyHTML, ctaText, ctaUrl, footerText, businessName, primaryColor }) {
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

  const baseUrl = process.env.BASE_URL || 'https://genda-qgm2.onrender.com';
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
async function sendModificationEmail({ booking, business }) {
  const oldDate = new Date(booking.old_start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long'
  });
  const oldTime = new Date(booking.old_start_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
  const newDate = new Date(booking.new_start_at).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long'
  });
  const newTime = new Date(booking.new_start_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
  const newEndTime = new Date(booking.new_end_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });

  const baseUrl = process.env.PUBLIC_URL || process.env.BASE_URL || 'https://genda.be';
  const confirmUrl = `${baseUrl}/api/public/booking/${booking.public_token}/confirm`;
  const rejectUrl = `${baseUrl}/api/public/booking/${booking.public_token}/reject`;
  const color = safeColor(business.theme?.primary_color);
  const safeClientName = escHtml(booking.client_name);
  const safeServiceName = escHtml(booking.service_name) || 'Rendez-vous';
  const safePracName = escHtml(booking.practitioner_name);

  const bodyHTML = `
    <p>Bonjour <strong>${safeClientName}</strong>,</p>
    <p>Votre rendez-vous a été modifié :</p>
    <div style="background:#FEF3E2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #E6A817">
      <div style="font-size:13px;color:#92700C;margin-bottom:4px"><strong>Avant :</strong> ${oldDate} à ${oldTime}</div>
      <div style="font-size:13px;color:#92700C;text-decoration:line-through;opacity:.6">${safeServiceName}</div>
    </div>
    <div style="background:#EEFAF1;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #1B7A42">
      <div style="font-size:13px;color:#15613A;margin-bottom:4px"><strong>Nouveau :</strong> ${newDate} à ${newTime} – ${newEndTime}</div>
      <div style="font-size:13px;color:#15613A;font-weight:600">${safeServiceName} · ${safePracName}</div>
    </div>
    <p style="margin-top:20px;font-size:15px">Ce nouvel horaire vous convient-il ?</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${escHtml(confirmUrl)}" style="display:inline-block;padding:14px 36px;background:${color};color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin-right:12px"> Oui, ça me va</a>
      <a href="${escHtml(rejectUrl)}" style="display:inline-block;padding:14px 36px;background:#fff;color:#C62828;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;border:2px solid #E57373"> Non</a>
    </div>
    <p style="font-size:12px;color:#9C958E;text-align:center">Si vous ne répondez pas, le nouveau créneau sera automatiquement confirmé.</p>`;

  const html = buildEmailHTML({
    title: 'Modification de votre rendez-vous',
    preheader: `Nouveau créneau : ${newDate} à ${newTime}`,
    bodyHTML,
    businessName: business.name,
    primaryColor: color,
    footerText: `${business.name}${business.address ? ' · ' + business.address : ''} · Via Genda.be`
  });

  return sendEmail({
    to: booking.client_email,
    toName: booking.client_name,
    subject: `Modification de votre RDV — ${business.name}`,
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
  const timeStr = new Date(booking.start_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
  const endTimeStr = booking.end_at
    ? new Date(booking.end_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
    : null;

  const color = safeColor(business.theme?.primary_color);
  const practitionerName = escHtml(booking.practitioner_name || '');
  const safeClientName = escHtml(booking.client_name);
  const safeComment = escHtml(booking.comment);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const serviceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(booking.service_name || booking.custom_label || 'Rendez-vous');

  let detailLines = `<div style="font-size:15px;font-weight:600;color:#15613A;margin-bottom:4px">\u{1F4C5} ${dateStr}</div>`;
  detailLines += `<div style="font-size:14px;color:#15613A">\u{1F550} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>`;

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
    detailLines += `<div style="font-size:14px;color:#15613A;margin-top:4px">\u{1F486} ${serviceName}</div>`;
  }
  if (practitionerName) detailLines += `<div style="font-size:14px;color:#15613A">\u{1F464} ${practitionerName}</div>`;

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

  const ctaText = hasPublicToken ? 'G\u00e9rer mon rendez-vous' : null;
  const ctaUrl = hasPublicToken ? `${baseUrl}/api/public/booking/${booking.public_token}` : null;

  const html = buildEmailHTML({
    title: isMulti ? 'Confirmation de vos prestations' : 'Confirmation de votre rendez-vous',
    preheader: `${serviceName} \u2014 ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText,
    ctaUrl,
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
  const timeStr = new Date(booking.start_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
  const endTimeStr = booking.end_at
    ? new Date(booking.end_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
    : null;

  const color = safeColor(business.theme?.primary_color);
  const practitionerName = escHtml(booking.practitioner_name || '');
  const safeClientName = escHtml(booking.client_name);

  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
  const serviceName = isMulti
    ? groupServices.map(s => escHtml(s.name)).join(' + ')
    : escHtml(booking.service_name || booking.custom_label || 'Rendez-vous');

  let detailLines = `<div style="font-size:15px;font-weight:600;color:#92700C;margin-bottom:4px">\u{1F4C5} ${dateStr}</div>`;
  detailLines += `<div style="font-size:14px;color:#92700C">\u{1F550} ${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>`;

  if (isMulti) {
    detailLines += `<div style="font-size:13px;color:#92700C;margin-top:8px;font-weight:600">Prestations :</div>`;
    groupServices.forEach(s => {
      const price = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : '';
      detailLines += `<div style="font-size:13px;color:#92700C;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}</div>`;
    });
  } else {
    detailLines += `<div style="font-size:14px;color:#92700C;margin-top:4px">\u{1F486} ${serviceName}</div>`;
  }
  if (practitionerName) detailLines += `<div style="font-size:14px;color:#92700C">\u{1F464} ${practitionerName}</div>`;

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
    <p style="font-size:13px;color:#92700C;margin-top:8px">\u23f3 Vous avez <strong>${delayLabel}</strong> pour confirmer. Sans confirmation, le cr\u00e9neau sera automatiquement lib\u00e9r\u00e9.</p>`;

  const html = buildEmailHTML({
    title: 'Confirmez votre rendez-vous',
    preheader: `Confirmez votre RDV du ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText: 'Confirmer mon RDV \u2705',
    ctaUrl: confirmUrl,
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

module.exports = { sendEmail, buildEmailHTML, sendPreRdvEmail, sendModificationEmail, sendBookingConfirmation, sendBookingConfirmationRequest, sendPasswordResetEmail, sendSessionNotesEmail, getCategoryLabels, CATEGORY_LABELS, escHtml, safeColor };
