/**
 * Tooltip Renderer — compact, harmonised tooltip for calendar events.
 * Extracted from calendar-events.js for separation of concerns.
 */
import { esc } from '../../utils/dom.js';

// ── Locale maps ──
const STATUS_FR = { confirmed: 'Confirmé', pending: 'En attente', completed: 'Terminé', cancelled: 'Annulé', no_show: 'Absent', modified_pending: 'Modifié', pending_deposit: 'Acompte requis' };

// ── Lucide SVG icons (stroke-based, currentColor) ──
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const IC = {
  user:      `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  note:      `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  crown:     `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6z"/><path d="M5 16h14v4H5z"/></svg>`,
  hourglass: `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`,
  wrench:    `<svg class="gi" viewBox="0 0 24 24" ${S}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
};

function fmtDur(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return m + 'min';
  return m > 0 ? h + 'h' + String(m).padStart(2, '0') : h + 'h';
}

function fmtCountdown(ms) {
  if (ms <= 0) return 'Expiré';
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + 'min';
  const h = Math.floor(min / 60);
  const rm = min % 60;
  if (h < 24) return h + 'h ' + (rm > 0 ? rm + 'min' : '');
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d + 'j ' + (rh > 0 ? rh + 'h' : '');
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

  // ── 1. Header: client name + VIP ──
  const vip = p.client_is_vip ? ' <span class="tt-vip">' + IC.crown + '</span>' : '';
  html += `<div class="tt-head">${esc(p.client_name || event.title || '—')}${vip}</div>`;

  // ── 2. Date/heure + durée totale ──
  html += `<div class="tt-time">${esc(dateStr)} · ${timeStr}</div>`;
  html += `<div class="tt-time" style="margin:0 0 2px">Durée totale : ${fmtDur(dur)}</div>`;

  // ── 3. Services + durée de chaque service ──
  if (p._isGroup && p._members) {
    html += `<div class="tt-section">`;
    p._members.forEach(m => {
      const svc = esc(m.variant_name ? (m.service_name || 'RDV') + ' — ' + m.variant_name : (m.service_name || m.custom_label || 'RDV libre'));
      const mDur = m.variant_duration_min || m.duration_min;
      const durTag = mDur ? ' <span class="tt-dim">' + fmtDur(mDur) + '</span>' : '';
      const mSt = m.status && m.status !== 'confirmed' ? ' <span class="tt-st-dot tt-st-' + esc(m.status) + '"></span>' : '';
      html += `<div class="tt-svc">${svc}${durTag}${mSt}</div>`;
    });
    html += `</div>`;
  } else {
    const svc = esc(p.variant_name ? (p.service_name || 'RDV libre') + ' — ' + p.variant_name : (p.service_name || p.custom_label || 'RDV libre'));
    const svcDur = p.variant_duration_min || p.duration_min;
    const durTag = svcDur ? ' <span class="tt-dim">' + fmtDur(svcDur) + '</span>' : '';
    html += `<div class="tt-section"><div class="tt-svc">${svc}${durTag}</div></div>`;
  }

  // ── 4-6. Info rows: pose, praticien, note ──
  const infos = [];

  // 4. Processing time (pose)
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

  // 5. Practitioner
  infos.push(ico('user') + esc(p.practitioner_name || '—'));

  // 6. Note (internal_note field OR booking_notes records OR client notes)
  const noteTxt = (typeof p.internal_note === 'string' && p.internal_note) || (typeof p.first_note === 'string' && p.first_note) || '';
  if (noteTxt) {
    const trimmed = noteTxt.length > 80 ? noteTxt.slice(0, 77) + '…' : noteTxt;
    infos.push(ico('note') + '<em>' + esc(trimmed) + '</em>');
  } else if (p.internal_note || p.notes_count > 0) {
    infos.push(ico('note') + 'Note interne');
  }
  // Client profile note (separate from booking notes)
  const clientNote = typeof p.client_notes === 'string' && p.client_notes;
  if (clientNote) {
    const trimCl = clientNote.length > 80 ? clientNote.slice(0, 77) + '…' : clientNote;
    infos.push(ico('note') + '<em>Client : ' + esc(trimCl) + '</em>');
  }

  if (infos.length) {
    html += `<div class="tt-infos">`;
    infos.forEach(r => { html += `<div class="tt-row">${r}</div>`; });
    html += `</div>`;
  }

  // ── 7. Countdown timer for pending / pending_deposit ──
  if (p.status === 'pending' && p.confirmation_expires_at) {
    const diff = new Date(p.confirmation_expires_at) - Date.now();
    html += `<div class="tt-row" style="color:#B45309;font-size:.75rem;font-weight:600">${ico('hourglass')}Expire dans ${fmtCountdown(diff)}</div>`;
  } else if (p.status === 'pending_deposit' && p.deposit_deadline) {
    const diff = new Date(p.deposit_deadline) - Date.now();
    html += `<div class="tt-row" style="color:#B45309;font-size:.75rem;font-weight:600">${ico('hourglass')}Acompte : expire dans ${fmtCountdown(diff)}</div>`;
  }

  // ── 8. Status badge ──
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
