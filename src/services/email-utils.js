/**
 * Email service utilities — shared helpers, constants, and core functions
 * Used by all email-*.js sub-modules
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
  // Allowlist approach: only keep safe tags, strip everything else
  const allowedTags = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'span']);
  let s = html;
  // Strip all tags not in allowlist (keep their content)
  s = s.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi, (match, tag) => {
    const t = tag.toLowerCase();
    if (!allowedTags.has(t)) return '';
    // For allowed tags, strip all attributes except href on <a>
    if (t === 'a') {
      const hrefMatch = match.match(/href\s*=\s*("[^"]*"|'[^']*')/i);
      if (hrefMatch) {
        const val = hrefMatch[1].slice(1, -1);
        if (/^\s*(javascript|data|vbscript|blob)\s*:/i.test(val)) return `<${match.startsWith('</') ? '/' : ''}a>`;
        return match.startsWith('</') ? '</a>' : `<a href="${val.replace(/"/g, '&quot;')}">`;
      }
      return match.startsWith('</') ? '</a>' : '<a>';
    }
    // Self-closing
    if (t === 'br') return '<br>';
    // Opening or closing, no attributes
    return match.startsWith('</') ? `</${t}>` : `<${t}>`;
  });
  // Remove event handlers that might survive
  let prev;
  do {
    prev = s;
    s = s.replace(/[\s"'/<]on\s*\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  } while (s !== prev);
  // Collapse excessive whitespace/empty paragraphs
  s = s.replace(/(<br\s*\/?>){3,}/gi, '<br><br>');
  s = s.replace(/(<p>\s*<\/p>\s*){2,}/gi, '<p></p>');
  return s.trim();
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

  // BUG-SUPPRESSION-LIST fix: skip emails to recipients that Brevo already marked as
  // bounced/blocked/invalid (detected via our Brevo webhook → notifications.error column).
  // Without this check we hammer Brevo with emails that will bounce, costing rate-limit
  // quota + risking account reputation damage. Opt-out is handled separately (unsubscribe).
  // Patterns alignés sur webhooks/brevo.js:80 qui écrit `brevo_<event>: <reason>`.
  // Events terminaux: hard_bounce, blocked, spam, complaint, invalid_email, unsubscribed.
  // soft_bounce est exclu (transient, on retry).
  try {
    const { query } = require('./db');
    const suppressCheck = await query(
      `SELECT 1 FROM notifications
         WHERE LOWER(recipient_email) = LOWER($1)
           AND type LIKE 'email_%'
           AND (error ILIKE '%hard_bounce%'
                OR error ILIKE '%brevo_blocked%'
                OR error ILIKE '%brevo_spam%'
                OR error ILIKE '%brevo_complaint%'
                OR error ILIKE '%invalid_email%'
                OR error ILIKE '%unsubscribed%')
           AND created_at > NOW() - INTERVAL '90 days'
         LIMIT 1`, [opts.to]
    );
    if (suppressCheck.rows.length > 0) {
      console.warn(`[EMAIL] Suppression-list hit for ${opts.to} (bounced/blocked in last 90d) — skipping send.`);
      return { success: false, error: 'suppression_list', skipped: true };
    }
  } catch (_) { /* DB unavailable — proceed with send (fail-open for transient issues) */ }

  // E2E mock : intercept avant appel Brevo
  if (process.env.SKIP_EMAIL === '1') {
    try {
      const { query } = require('./db');
      await query(
        `INSERT INTO test_mock_log (type, kind, recipient, payload) VALUES ('email', $1, $2, $3)`,
        [opts.template || opts.subject?.slice(0, 50) || 'unknown', opts.to, JSON.stringify(opts)]
      );
    } catch (e) { console.warn('[MOCK EMAIL] Log error:', e.message); }
    return { success: true, mocked: true, messageId: 'mock-' + Date.now() };
  }

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

    // Brevo supports attachments via base64 content (attachment[i].content + attachment[i].name)
    if (Array.isArray(opts.attachments) && opts.attachments.length > 0) {
      payload.attachment = opts.attachments.map(a => ({
        name: a.name,
        content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content
      }));
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

module.exports = { BREVO_API, escHtml, fmtSvcLabel, sanitizeRichText, safeColor, _ic, getRealEndAt, fmtTimeBrussels, sendEmail, buildBookingFooter, buildEmailHTML, CATEGORY_LABELS, getCategoryLabels };
