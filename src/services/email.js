/**
 * Email service using Brevo (Sendinblue) transactional API
 * Handles: confirmations, reminders, pre-RDV documents, invoices
 */

const BREVO_API = 'https://api.brevo.com/v3/smtp/email';

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
      body: JSON.stringify(payload)
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
  const color = primaryColor || '#0D7377';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
${preheader ? `<span style="display:none!important;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}</span>` : ''}
</head><body style="margin:0;padding:0;background:#F5F4F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4F1;padding:24px 0">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06)">

<!-- Header -->
<tr><td style="background:${color};padding:24px 32px;text-align:center">
  <div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px">${businessName || 'Genda'}</div>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px">
  <h1 style="font-size:20px;font-weight:700;color:#1A1816;margin:0 0 16px">${title}</h1>
  <div style="font-size:15px;line-height:1.6;color:#3D3832">${bodyHTML}</div>
  ${ctaText && ctaUrl ? `
  <div style="text-align:center;margin:28px 0">
    <a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;background:${color};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">${ctaText}</a>
  </div>` : ''}
</td></tr>

<!-- Footer -->
<tr><td style="padding:20px 32px;border-top:1px solid #E0DDD8;text-align:center">
  <p style="font-size:12px;color:#9C958E;margin:0">${footerText || 'Cet email a été envoyé automatiquement via Genda.be'}</p>
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
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const appointmentTime = new Date(booking.start_at).toLocaleTimeString('fr-BE', {
    hour: '2-digit', minute: '2-digit'
  });

  const baseUrl = process.env.BASE_URL || 'https://genda-qgm2.onrender.com';
  const docUrl = `${baseUrl}/docs/${token}`;

  const typeLabels = {
    info: "Informations pour votre rendez-vous",
    form: "Formulaire à compléter avant votre rendez-vous",
    consent: "Consentement à signer avant votre rendez-vous"
  };

  let bodyHTML = `
    <p>Bonjour <strong>${booking.client_name}</strong>,</p>
    <p>Votre rendez-vous est prévu le <strong>${appointmentDate} à ${appointmentTime}</strong>
    pour <strong>${booking.service_name}</strong>.</p>
    <div style="background:#F5F4F1;border-radius:8px;padding:16px;margin:16px 0">
      <div style="font-size:13px;font-weight:600;color:#6B6560;text-transform:uppercase;margin-bottom:6px">
        📋 ${typeLabels[template.type] || 'Document à consulter'}
      </div>
      <div style="font-size:15px;font-weight:600;color:#1A1816">${template.name}</div>
    </div>`;

  if (template.type === 'info') {
    bodyHTML += `<p>Veuillez consulter les informations ci-dessous pour bien préparer votre rendez-vous.</p>`;
  } else if (template.type === 'form') {
    bodyHTML += `<p>Merci de compléter le formulaire en ligne avant votre rendez-vous. Cela nous permettra de mieux vous accueillir.</p>`;
  } else if (template.type === 'consent') {
    bodyHTML += `<p>Veuillez lire et signer le formulaire de consentement avant votre rendez-vous.</p>`;
  }

  const ctaText = template.type === 'info' ? 'Consulter le document' : 'Compléter le formulaire';

  const subject = template.subject || `${template.name} — ${business.name}`;

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

module.exports = { sendEmail, buildEmailHTML, sendPreRdvEmail };
