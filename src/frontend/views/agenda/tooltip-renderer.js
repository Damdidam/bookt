/**
 * Tooltip Renderer — compact, harmonised tooltip for calendar events.
 * Extracted from calendar-events.js for separation of concerns.
 */
import { esc } from '../../utils/dom.js';

// ── Locale maps ──
const STATUS_FR = { confirmed: 'Confirmé', pending: 'En attente', completed: 'Terminé', cancelled: 'Annulé', no_show: 'Absent', modified_pending: 'Modifié', pending_deposit: 'Acompte requis' };
const CHANNEL_FR = { web: 'En ligne', phone: 'Téléphone', manual: 'Manuel' };
const MODE_FR = { cabinet: 'Cabinet', visio: 'Visio', phone: 'Téléphone' };

// ── Lucide SVG icons (stroke-based, currentColor) ──
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const IC = {
  clock:    `<svg class="gi" viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  user:     `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  globe:    `<svg class="gi" viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  phone:    `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  pen:      `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`,
  dollar:   `<svg class="gi" viewBox="0 0 24 24" ${S}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  lock:     `<svg class="gi" viewBox="0 0 24 24" ${S}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  note:     `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  msg:      `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  crown:    `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6z"/><path d="M5 16h14v4H5z"/></svg>`,
  hourglass:`<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`,
  visio:    `<svg class="gi" viewBox="0 0 24 24" ${S}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  mobile:   `<svg class="gi" viewBox="0 0 24 24" ${S}><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
  wrench:   `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  tag:       `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`,
};

function fmtDur(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return m + 'min';
  return m > 0 ? h + 'h' + String(m).padStart(2, '0') : h + 'h';
}

function ico(name) { return `<span class="tt-ico">${IC[name] || ''}</span>`; }

function fcShowTooltip(event, x, y) {
  fcHideTooltip();
  const p = event.extendedProps;
  const start = event.start;
  const end = event.end;
  if (!start) return;

  // Skip featured slot background events
  if (p._isFeaturedSlot) return;

  // ── Task tooltip (simpler) ──
  if (p._isTask) {
    const timeStr = start.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) + (end ? '–' + end.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '');
    const dateStr = start.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
    const dur = end ? Math.round((end - start) / 60000) : 0;
    let html = `<div class="tt-head">${IC.wrench} ${esc(p.title)}</div>`;
    html += `<div class="tt-time">${esc(dateStr)} · ${timeStr} · ${fmtDur(dur)}</div>`;
    const infos = [];
    if (p.practitioner_name) infos.push(ico('user') + esc(p.practitioner_name));
    if (p.note) infos.push(ico('note') + '<em>' + esc(p.note.length > 80 ? p.note.slice(0, 77) + '…' : p.note) + '</em>');
    if (infos.length) { html += `<div class="tt-infos">`; infos.forEach(r => { html += `<div class="tt-row">${r}</div>`; }); html += `</div>`; }
    const stLabel = { planned: 'Planifiée', completed: 'Terminée', cancelled: 'Annulée' }[p.status] || p.status;
    html += `<div class="tt-foot"><span class="tt-badge">${esc(stLabel)}</span></div>`;
    const tt = document.createElement('div'); tt.className = 'fc-tooltip'; tt.id = 'fcTooltip'; tt.innerHTML = html;
    document.body.appendChild(tt); fcMoveTooltip(x, y); return;
  }

  const timeStr = start.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) + (end ? '–' + end.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '');
  const dateStr = start.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  const dur = end ? Math.round((end - start) / 60000) : p.duration_min || 0;

  let html = '';

  // ── Header: client name + VIP ──
  const vip = p.client_is_vip ? ' <span class="tt-vip">' + IC.crown + '</span>' : '';
  html += `<div class="tt-head">${esc(p.client_name || event.title || '—')}${vip}</div>`;

  // ── Time line: date · time · duration ──
  html += `<div class="tt-time">${esc(dateStr)} · ${timeStr} · ${fmtDur(dur)}</div>`;

  // ── Service (single) or services (group) ──
  if (p._isGroup && p._members) {
    html += `<div class="tt-section">`;
    p._members.forEach(m => {
      const svc = esc(m.variant_name ? (m.service_name || 'RDV') + ' — ' + m.variant_name : (m.service_name || m.custom_label || 'RDV libre'));
      const mSt = m.status && m.status !== 'confirmed' ? ' <span class="tt-st-dot tt-st-' + esc(m.status) + '"></span>' : '';
      html += `<div class="tt-svc">${svc}${mSt}</div>`;
    });
    html += `</div>`;
  } else {
    const svc = esc(p.variant_name ? (p.service_name || 'RDV libre') + ' — ' + p.variant_name : (p.service_name || p.custom_label || 'RDV libre'));
    html += `<div class="tt-section"><div class="tt-svc">${svc}</div></div>`;
  }

  // ── Info rows ──
  const infos = [];

  // Practitioner (always show)
  infos.push(ico('user') + esc(p.practitioner_name || '—'));

  // Appointment mode (only if not cabinet)
  if (p.appointment_mode && p.appointment_mode !== 'cabinet') {
    const modeIco = p.appointment_mode === 'visio' ? 'visio' : 'phone';
    infos.push(ico(modeIco) + esc(MODE_FR[p.appointment_mode] || p.appointment_mode));
  }

  // Channel (booking source)
  if (p.channel) {
    const chIco = p.channel === 'web' ? 'globe' : p.channel === 'phone' ? 'phone' : 'pen';
    infos.push(ico(chIco) + (CHANNEL_FR[p.channel] || esc(p.channel)));
  }

  // Client phone
  if (p.client_phone) infos.push(ico('mobile') + esc(p.client_phone));

  // Client comment
  if (p.comment_client) {
    const trimmed = p.comment_client.length > 60 ? p.comment_client.slice(0, 57) + '…' : p.comment_client;
    infos.push(ico('msg') + '<em>' + esc(trimmed) + '</em>');
  }

  // Processing time
  const ptMin = parseInt(p.processing_time) || 0;
  if (ptMin > 0) {
    const ps = parseInt(p.processing_start) || 0;
    const buf = parseInt(p.buffer_before_min) || 0;
    const poseStartMs = start.getTime() + (buf + ps) * 60000;
    const poseEndMs = poseStartMs + ptMin * 60000;
    const psFmt = new Date(poseStartMs).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    const peFmt = new Date(poseEndMs).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    infos.push(ico('hourglass') + 'Pose ' + psFmt + '–' + peFmt + ' <span class="tt-dim">(' + ptMin + 'min)</span>');
  }

  // Deposit
  if (p.deposit_required && p.deposit_status) {
    const depAmt = ((p.deposit_amount_cents || 0) / 100).toFixed(2);
    const depLabel = p.deposit_status === 'paid' ? 'Payé' : p.deposit_status === 'refunded' ? 'Remboursé' : p.deposit_status === 'cancelled' ? 'Conservé' : 'En attente';
    const depCls = p.deposit_status === 'paid' ? ' tt-dep-ok' : '';
    infos.push(ico('dollar') + depAmt + '€ · <span class="' + depCls.trim() + '">' + depLabel + '</span>');
  }

  // Last-minute promo
  if (p.discount_pct) {
    const origPrice = p.variant_price_cents ?? p.price_cents ?? 0;
    if (origPrice > 0) {
      const discPrice = Math.round(origPrice * (100 - p.discount_pct) / 100);
      infos.push(ico('tag') + 'Promo -' + p.discount_pct + '% · <s>' + (origPrice / 100).toFixed(2) + '€</s> <strong style="color:#059669">' + (discPrice / 100).toFixed(2) + '€</strong>');
    } else {
      infos.push(ico('tag') + 'Promo -' + p.discount_pct + '%');
    }
  }

  // Locked
  if (p.locked) infos.push(ico('lock') + 'Verrouillé');

  // Internal note (just flag, not content)
  if (p.internal_note) infos.push(ico('note') + 'Note interne');

  if (infos.length) {
    html += `<div class="tt-infos">`;
    infos.forEach(r => { html += `<div class="tt-row">${r}</div>`; });
    html += `</div>`;
  }

  // ── Status badge ──
  const st = p.status || 'confirmed';
  html += `<div class="tt-foot"><span class="tt-badge ${esc(st)}">${esc(STATUS_FR[st] || st)}</span></div>`;

  const tt = document.createElement('div');
  tt.className = 'fc-tooltip';
  tt.id = 'fcTooltip';
  tt.innerHTML = html;
  document.body.appendChild(tt);
  fcMoveTooltip(x, y);
}

function fcMoveTooltip(x, y) {
  const tt = document.getElementById('fcTooltip');
  if (!tt) return;
  const r = tt.getBoundingClientRect();
  let left = x + 12, top = y + 12;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 12;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  tt.style.left = left + 'px';
  tt.style.top = top + 'px';
}

function fcHideTooltip() {
  document.getElementById('fcTooltip')?.remove();
}

export { fcShowTooltip, fcMoveTooltip, fcHideTooltip };
