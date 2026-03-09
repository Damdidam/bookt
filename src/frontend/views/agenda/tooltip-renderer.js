/**
 * Tooltip Renderer — tooltip show / move / hide + HTML builder.
 * Extracted from calendar-events.js for separation of concerns.
 */
import { esc } from '../../utils/dom.js';

// ── Locale maps ──
const STATUS_FR = { confirmed: 'Confirmé', pending: 'En attente', completed: 'Terminé', cancelled: 'Annulé', no_show: 'Absent', modified_pending: 'Modifié', pending_deposit: 'Acompte requis' };
const MODE_FR = { cabinet: 'Au cabinet', visio: 'Visio', phone: 'Téléphone' };

function fcShowTooltip(event, x, y) {
  fcHideTooltip();
  const p = event.extendedProps;
  const start = event.start;
  const end = event.end;
  if (!start) return;

  const timeStr = start.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) + (end ? ' – ' + end.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '');
  const dateStr = start.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  const dur = end ? Math.round((end - start) / 60000) : p.duration_min || 0;

  let html = `<div class="tt-name">${esc(p.client_name || event.title || '—')}</div>`;
  html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></span>${esc(p.variant_name ? (p.service_name||'RDV libre')+' — '+p.variant_name : (p.service_name || p.custom_label || 'RDV libre'))}</div>`;
  html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>${dateStr}</div>`;
  html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>${timeStr} (${dur} min)</div>`;
  if (p.practitioner_name) html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>${esc(p.practitioner_name)}</div>`;
  if (p.appointment_mode && p.appointment_mode !== 'cabinet') html += `<div class="tt-row"><span class="tt-icon">${p.appointment_mode === 'visio' ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' : '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'}</span>${esc(MODE_FR[p.appointment_mode] || p.appointment_mode)}</div>`;
  if (p.client_phone) html += `<div class="tt-row"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></span>${esc(p.client_phone)}</div>`;
  // Processing time info
  const ptMin = parseInt(p.processing_time) || 0;
  if (ptMin > 0 && start) {
    const ps = parseInt(p.processing_start) || 0;
    const buf = parseInt(p.buffer_before_min) || 0;
    const poseStartMs = start.getTime() + (buf + ps) * 60000;
    const poseEndMs = poseStartMs + ptMin * 60000;
    const psFmt = new Date(poseStartMs).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    const peFmt = new Date(poseEndMs).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
    html += `<div class="tt-row" style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.15)"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></span>Pose : ${psFmt} – ${peFmt}</div>`;
    html += `<div class="tt-row" style="font-size:.75rem;opacity:.7;padding-left:20px">${ptMin}min — praticien libre</div>`;
  }

  if (p.locked) {
    html += `<div class="tt-row" style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.15)"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>Verrouillé</div>`;
  }

  const st = p.status || 'confirmed';
  html += `<div class="tt-badge ${esc(st)}">${esc(STATUS_FR[st] || st)}</div>`;

  // Deposit info in tooltip
  if (p.deposit_required && p.deposit_status) {
    const depAmt = ((p.deposit_amount_cents || 0) / 100).toFixed(2);
    const depLabel = p.deposit_status === 'paid' ? 'Payé' : p.deposit_status === 'refunded' ? 'Remboursé' : p.deposit_status === 'cancelled' ? 'Conservé' : 'En attente';
    html += `<div class="tt-row" style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.15)"><span class="tt-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span>Acompte : ${depAmt}€ — ${depLabel}</div>`;
  }

  // Group: list members
  if (p._isGroup && p._members) {
    html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.15)">`;
    p._members.forEach(m => {
      html += `<div class="tt-row"><span class="tt-icon">•</span>${esc(m.variant_name ? (m.service_name||'RDV')+' — '+m.variant_name : (m.service_name || 'RDV'))} — ${esc(m.client_name || '')}</div>`;
    });
    html += `</div>`;
  }

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
