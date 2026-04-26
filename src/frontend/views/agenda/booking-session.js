/**
 * Session Notes - rich text editor for consultation reports.
 * Notes can be saved per booking and sent to the client by email.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { IC } from '../../utils/icons.js';

/**
 * Sanitize rich text HTML — strip dangerous tags and event handlers
 * while keeping safe formatting (b, i, u, br, p, span, strong, em, ul, ol, li, a).
 */
function sanitizeRichText(html) {
  if (!html) return '';
  const blocked = 'script|iframe|object|embed|form|textarea|input|select|button|svg|math|style|details|template|link|meta|base|img|video|audio|body|marquee|noscript|plaintext|xmp|listing|head|html|applet|layer|ilayer|bgsound|title';
  // Remove dangerous tags and their content (including SVG, math, style, details, media, legacy)
  // Loop until stable to handle nested blocked tags
  let s = html;
  let prev;
  do {
    prev = s;
    s = s.replace(new RegExp('<(' + blocked + ')[^>]*>[\\s\\S]*?<\\/\\1>', 'gi'), '');
    s = s.replace(new RegExp('<(' + blocked + ')[^>]*\\/?>', 'gi'), '');
  } while (s !== prev);
  // Remove event handlers (on*="...") — loop until stable to prevent chained handler bypass
  let prev2;
  do {
    prev2 = s;
    s = s.replace(/[\s"'/<]on\s*\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  } while (s !== prev2);
  // Remove dangerous protocol URLs in href/src/action (including HTML-entity-encoded variants)
  s = s.replace(/(href|src|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, (match, attr, val) => {
    // Decode HTML entities for protocol check
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

/**
 * Render session notes tab content for the current booking.
 */
function fcRenderSession(booking) {
  const body = document.getElementById('seBody');
  const status = document.getElementById('seStatus');
  const sendBtn = document.getElementById('seSendBtn');
  if (!body) return;

  // Load existing content (sanitize to prevent stored XSS)
  body.innerHTML = sanitizeRichText(booking.session_notes || '');

  // Status
  if (booking.session_notes_sent_at) {
    const d = new Date(booking.session_notes_sent_at);
    const fmt = d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
    status.innerHTML = `${IC.check} Envoyé le ${fmt}`;
  } else {
    status.textContent = '';
  }

  // Show/hide send button based on client having email
  if (sendBtn) {
    const hasEmail = booking.client_email || calState.fcDetailData?.client_email;
    sendBtn.style.display = hasEmail ? '' : 'none';
  }

  // Toolbar listeners (attach once)
  const toolbar = document.querySelector('.se-toolbar');
  if (toolbar && !toolbar._sesInit) {
    toolbar._sesInit = true;
    toolbar.querySelectorAll('.se-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus in contenteditable
        const cmd = btn.dataset.cmd;
        if (cmd) document.execCommand(cmd, false, null);
      });
    });
    const colorInput = document.getElementById('seColor');
    if (colorInput) {
      colorInput.addEventListener('input', (e) => {
        document.execCommand('foreColor', false, e.target.value);
        body.focus();
      });
    }
  }
}

/**
 * Save session notes to DB.
 */
async function calSaveSession() {
  if (calSaveSession._busy) return;
  const body = document.getElementById('seBody');
  if (!body) return;

  calSaveSession._busy = true;
  const html = body.innerHTML.trim();
  // Treat <br> only or empty as null; sanitize before sending to server
  const content = html === '<br>' || html === '' ? null : sanitizeRichText(html);

  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/session-notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ session_notes: content })
    });
    if (!r.ok) throw new Error('Erreur');
    gToast('Notes de séance sauvegardées', 'success');
  } catch (e) {
    gToast('Erreur: ' + e.message, 'error');
  } finally { calSaveSession._busy = false; }
}

/**
 * Save + send session notes by email.
 */
async function calSendSession() {
  if (calSendSession._busy) return;
  const body = document.getElementById('seBody');
  if (!body) return;

  const html = body.innerHTML.trim();
  if (!html || html === '<br>') {
    gToast('Rédigez des notes avant d\'envoyer', 'error');
    return;
  }

  calSendSession._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/send-session-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ session_notes: sanitizeRichText(html) })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.message || d.error || 'Erreur'); }
    const data = await r.json();

    // Update status display
    const status = document.getElementById('seStatus');
    if (status && data.sent_at) {
      const d = new Date(data.sent_at);
      const fmt = d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      status.innerHTML = `${IC.check} Envoyé le ${fmt}`;
    }

    gToast('Notes envoyées au client', 'success');
  } catch (e) {
    gToast('Erreur: ' + e.message, 'error');
  } finally { calSendSession._busy = false; }
}

bridge({ calSaveSession, calSendSession });

export { fcRenderSession, calSaveSession, calSendSession };
