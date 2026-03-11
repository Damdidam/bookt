/**
 * Smart Optimizer — suggests optimal slots for new bookings.
 * Staff selects service(s), the app scores available slots:
 *   pose fit (100), gap fill (80), gap reduce (60), adjacent (40), free (20).
 * Pattern follows gap-analyzer.js (prefix so instead of ga).
 */
import { calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { fcIsMobile } from '../../utils/touch.js';

// ── State ──
let soActive = false;
let soSelectedServices = []; // [{id, name, duration_min, variant_id, variant_name, color, price_cents}]
let soPracId = null;

function soIsActive() { return soActive; }

// ── Helpers ──
function localDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function fmtMin(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? h + 'h' + (m > 0 ? String(m).padStart(2, '0') : '') : m + 'min';
}
function pad2(n) { return String(n).padStart(2, '0'); }
function timeStr(totalMin) { return pad2(Math.floor(totalMin / 60)) + ':' + pad2(totalMin % 60); }

// ── SVG Icons (no emojis) ──
const ICO = {
  pose:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  gap:      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
  adjacent: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>',
  free:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  plus:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  close:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  spark:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  remove:   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

// ── Toggle ──
function soToggleMode() {
  if (soActive) { soDeactivate(); return; }
  if (fcIsMobile()) { gToast('Optimiseur non disponible sur mobile', 'info'); return; }
  soActivate();
}

// ── Activate / Deactivate ──
function soActivate() {
  // Mutual exclusivity with gap analyzer + featured mode
  if (typeof window.gaDeactivate === 'function') window.gaDeactivate();
  if (typeof window.fsCancelMode === 'function') window.fsCancelMode();

  soActive = true;
  soSelectedServices = [];
  soPracId = calState.fcCurrentFilter && calState.fcCurrentFilter !== 'all'
    ? calState.fcCurrentFilter
    : (calState.fcPractitioners[0]?.id || null);

  document.getElementById('soToggleBtn')?.classList.add('active');
  soShowPanel();
}

function soDeactivate() {
  soActive = false;
  soSelectedServices = [];
  soPracId = null;
  document.getElementById('soToggleBtn')?.classList.remove('active');
  document.getElementById('soPanel')?.remove();
}

// ── Panel DOM ──
function soShowPanel() {
  document.getElementById('soPanel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'soPanel';
  panel.className = 'so-panel';

  // Header
  let html = `<div class="so-panel-header">
    <div class="so-panel-title">${ICO.spark}<span>Optimiseur de RDV</span></div>
    <button class="so-panel-close" onclick="soDeactivate()" title="Fermer">${ICO.close}</button>
  </div>`;

  // Body: 2 columns
  html += `<div class="so-panel-body">`;

  // Left: service picker
  html += `<div class="so-left" id="soLeft">`;
  html += soRenderServicePicker();
  html += `</div>`;

  // Right: suggestions
  html += `<div class="so-right" id="soRight">`;
  html += `<div class="so-empty">S\u00e9lectionnez une prestation pour voir les suggestions</div>`;
  html += `</div>`;

  html += `</div>`;
  panel.innerHTML = html;
  document.querySelector('.main')?.appendChild(panel);
}

// ── Service Picker (left column) ──
function soRenderServicePicker() {
  let html = '';

  // Practitioner dropdown
  html += `<div class="so-field"><label class="so-label">Praticien</label>`;
  html += `<select class="so-select" id="soPracSel" onchange="soPracChanged()">`;
  calState.fcPractitioners.forEach(p => {
    html += `<option value="${p.id}" ${String(p.id) === String(soPracId) ? 'selected' : ''}>${esc(p.display_name)}</option>`;
  });
  html += `</select></div>`;

  // Category dropdown
  const cats = window.fcGetServiceCategories ? window.fcGetServiceCategories(soPracId) : [];
  html += `<div class="so-field"><label class="so-label">Cat\u00e9gorie</label>`;
  html += `<select class="so-select" id="soCatSel" onchange="soCatChanged()">`;
  html += `<option value="">\u2014 Toutes \u2014</option>`;
  cats.forEach(c => { html += `<option value="${esc(c)}">${esc(c)}</option>`; });
  html += `</select></div>`;

  // Service dropdown
  const services = window.fcGetFilteredServices ? window.fcGetFilteredServices(soPracId, '') : [];
  html += `<div class="so-field"><label class="so-label">Prestation</label>`;
  html += `<select class="so-select" id="soSvcSel" onchange="soSvcChanged()">`;
  html += `<option value="">\u2014 Choisir \u2014</option>`;
  services.forEach(s => {
    const durLabel = window.svcDurPriceLabel ? window.svcDurPriceLabel(s) : (s.duration_min + ' min');
    html += `<option value="${s.id}">${esc(s.name)} (${durLabel})</option>`;
  });
  html += `</select></div>`;

  // Variant dropdown (hidden by default)
  html += `<div class="so-field" id="soVarWrap" style="display:none"><label class="so-label">Variante</label>`;
  html += `<select class="so-select" id="soVarSel" onchange="soVarChanged()"></select></div>`;

  // Add button
  html += `<button class="so-add-btn" id="soAddBtn" onclick="soAddService()" disabled>${ICO.plus} Ajouter</button>`;

  // Selected services list
  html += `<div class="so-selected" id="soSelectedList">`;
  html += soRenderSelectedServices();
  html += `</div>`;

  // Total duration
  html += `<div class="so-total" id="soTotal"></div>`;

  return html;
}

function soRenderSelectedServices() {
  if (soSelectedServices.length === 0) return '';
  let html = '';
  soSelectedServices.forEach((svc, idx) => {
    html += `<div class="so-svc-card">
      <span class="so-svc-dot" style="background:${svc.color}"></span>
      <span class="so-svc-name">${esc(svc.name)}</span>
      <span class="so-svc-dur">${svc.duration_min}min</span>
      <button class="so-svc-rm" onclick="soRemoveService(${idx})" title="Retirer">${ICO.remove}</button>
    </div>`;
  });
  return html;
}

// ── Service Picker Events ──
function soPracChanged() {
  soPracId = document.getElementById('soPracSel')?.value || null;
  soRefreshDropdowns();
  soRenderSuggestions();
}

function soCatChanged() {
  const cat = document.getElementById('soCatSel')?.value || '';
  const services = window.fcGetFilteredServices ? window.fcGetFilteredServices(soPracId, cat) : [];
  const sel = document.getElementById('soSvcSel');
  sel.innerHTML = '<option value="">\u2014 Choisir \u2014</option>' + services.map(s => {
    const durLabel = window.svcDurPriceLabel ? window.svcDurPriceLabel(s) : (s.duration_min + ' min');
    return `<option value="${s.id}">${esc(s.name)} (${durLabel})</option>`;
  }).join('');
  document.getElementById('soVarWrap').style.display = 'none';
  soUpdateAddBtn();
}

function soSvcChanged() {
  const svcId = document.getElementById('soSvcSel')?.value;
  const varWrap = document.getElementById('soVarWrap');
  const varSel = document.getElementById('soVarSel');
  if (!svcId) { varWrap.style.display = 'none'; soUpdateAddBtn(); return; }

  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const variants = svc?.variants || [];
  if (variants.length > 0) {
    varSel.innerHTML = '<option value="">\u2014 Variante \u2014</option>' + variants.map(v =>
      `<option value="${v.id}">${esc(v.name)} (${v.duration_min} min${v.price_cents ? ' \u00b7 ' + (v.price_cents/100).toFixed(0) + '\u20ac' : ''})</option>`
    ).join('');
    varWrap.style.display = '';
  } else {
    varSel.innerHTML = '';
    varWrap.style.display = 'none';
  }
  soUpdateAddBtn();
}

function soVarChanged() { soUpdateAddBtn(); }

function soUpdateAddBtn() {
  const btn = document.getElementById('soAddBtn');
  if (!btn) return;
  const svcId = document.getElementById('soSvcSel')?.value;
  if (!svcId) { btn.disabled = true; return; }
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const hasVariants = (svc?.variants || []).length > 0;
  const varSelected = !!document.getElementById('soVarSel')?.value;
  btn.disabled = hasVariants && !varSelected;
}

function soRefreshDropdowns() {
  const cats = window.fcGetServiceCategories ? window.fcGetServiceCategories(soPracId) : [];
  const catSel = document.getElementById('soCatSel');
  if (catSel) {
    catSel.innerHTML = '<option value="">\u2014 Toutes \u2014</option>' + cats.map(c =>
      `<option value="${esc(c)}">${esc(c)}</option>`
    ).join('');
  }
  soCatChanged();
}

function soAddService() {
  const svcId = document.getElementById('soSvcSel')?.value;
  if (!svcId) return;
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  if (!svc) return;

  const varSel = document.getElementById('soVarSel');
  const varId = varSel?.value || '';
  const variant = varId ? svc.variants?.find(v => String(v.id) === String(varId)) : null;
  const color = /^#[0-9a-fA-F]{3,8}$/.test(svc.color) ? svc.color : '#0D7377';

  soSelectedServices.push({
    id: svc.id,
    name: variant ? svc.name + ' \u2014 ' + variant.name : svc.name,
    duration_min: variant?.duration_min || svc.duration_min || 0,
    variant_id: varId,
    variant_name: variant?.name || '',
    color: color,
    price_cents: variant?.price_cents || svc.price_cents || 0,
    processing_time: variant?.processing_time || svc.processing_time || 0,
    processing_start: variant?.processing_start || svc.processing_start || 0,
    buffer_before_min: svc.buffer_before_min || 0,
    buffer_after_min: svc.buffer_after_min || 0,
  });

  // Reset picker
  document.getElementById('soSvcSel').value = '';
  document.getElementById('soVarWrap').style.display = 'none';
  soUpdateAddBtn();

  // Refresh display
  soRefreshSelected();
  soRenderSuggestions();
}

function soRemoveService(idx) {
  soSelectedServices.splice(idx, 1);
  soRefreshSelected();
  soRenderSuggestions();
}

function soRefreshSelected() {
  const list = document.getElementById('soSelectedList');
  if (list) list.innerHTML = soRenderSelectedServices();
  const total = document.getElementById('soTotal');
  if (total) {
    const dur = soSelectedServices.reduce((s, svc) => s + svc.duration_min, 0);
    total.innerHTML = dur > 0
      ? `Dur\u00e9e totale : <strong>${fmtMin(dur)}</strong>`
      : '';
  }
}

// ── Scoring Algorithm ──
function soFindSlots() {
  const cal = calState.fcCal;
  if (!cal || soSelectedServices.length === 0 || !soPracId) return [];

  const totalDuration = soSelectedServices.reduce((s, svc) => s + svc.duration_min, 0);
  const date = localDate(cal.view.currentStart);

  // Get all events for this practitioner on this day
  const dayStart = new Date(date + 'T00:00:00');
  const dayEnd = new Date(date + 'T23:59:59');
  const allEvents = cal.getEvents().filter(ev => {
    const p = ev.extendedProps || {};
    if (p._isTask) return false;
    if (['cancelled', 'no_show'].includes(p.status)) return false;
    // pending expired filter
    if (p.status === 'pending' && ev.start && ev.start <= new Date()) return false;
    if (String(p.practitioner_id) !== String(soPracId)) return false;
    return ev.start < dayEnd && ev.end > dayStart;
  });

  // Sort by start time
  allEvents.sort((a, b) => a.start - b.start);

  // Get business hours for this practitioner
  const pracHours = calState.fcPracBusinessHours[soPracId] || calState.fcBusinessHours || [];
  const jsDay = dayStart.getDay(); // 0=Sun...6=Sat
  const todayHours = pracHours.filter(h => h.daysOfWeek.includes(jsDay));
  if (todayHours.length === 0) return [];

  // Build work windows in minutes from midnight
  const workWindows = todayHours.map(h => {
    const [sh, sm] = h.startTime.split(':').map(Number);
    const [eh, em] = h.endTime.split(':').map(Number);
    return { start: sh * 60 + sm, end: eh * 60 + em };
  }).sort((a, b) => a.start - b.start);

  // Build occupied ranges in minutes from midnight
  const occupied = allEvents.map(ev => {
    const s = ev.start.getHours() * 60 + ev.start.getMinutes();
    const e = ev.end.getHours() * 60 + ev.end.getMinutes();
    return { start: s, end: e, ev };
  }).sort((a, b) => a.start - b.start);

  // Find pose (processing) windows where a child could fit
  const poseWindows = [];
  allEvents.forEach(ev => {
    const p = ev.extendedProps || {};
    const pt = parseInt(p.processing_time) || 0;
    const ps = parseInt(p.processing_start) || 0;
    const buf = parseInt(p.buffer_before_min) || 0;
    if (pt <= 0) return;

    const evStartMin = ev.start.getHours() * 60 + ev.start.getMinutes();
    const poseStart = evStartMin + buf + ps;
    const poseEnd = poseStart + pt;

    // Check how much of the pose window is already taken by children
    const childrenInPose = allEvents.filter(ch => {
      if (ch === ev) return false;
      const cp = ch.extendedProps || {};
      if (cp._isPoseChild && String(cp._poseParentId) === String(p.id)) return true;
      // Also check geometrically
      const cs = ch.start.getHours() * 60 + ch.start.getMinutes();
      const ce = ch.end.getHours() * 60 + ch.end.getMinutes();
      return cs >= poseStart && ce <= poseEnd && ch !== ev;
    });

    // Find free sub-windows within the pose window
    const childRanges = childrenInPose.map(ch => ({
      start: ch.start.getHours() * 60 + ch.start.getMinutes(),
      end: ch.end.getHours() * 60 + ch.end.getMinutes()
    })).sort((a, b) => a.start - b.start);

    let cursor = poseStart;
    childRanges.forEach(cr => {
      if (cr.start > cursor) {
        poseWindows.push({ start: cursor, end: cr.start, parentEvId: p.id });
      }
      cursor = Math.max(cursor, cr.end);
    });
    if (cursor < poseEnd) {
      poseWindows.push({ start: cursor, end: poseEnd, parentEvId: p.id });
    }
  });

  // Find free gaps within work windows
  const freeSlots = [];
  workWindows.forEach(ww => {
    // Get occupied segments within this work window
    const segs = occupied.filter(o => o.end > ww.start && o.start < ww.end)
      .map(o => ({ start: Math.max(o.start, ww.start), end: Math.min(o.end, ww.end) }))
      .sort((a, b) => a.start - b.start);

    let cursor = ww.start;
    segs.forEach(seg => {
      if (seg.start > cursor) {
        freeSlots.push({ start: cursor, end: seg.start });
      }
      cursor = Math.max(cursor, seg.end);
    });
    if (cursor < ww.end) {
      freeSlots.push({ start: cursor, end: ww.end });
    }
  });

  // Score each possible position
  const results = [];
  const step = 5; // 5-minute increments

  // 1. Check pose windows first (score 100)
  poseWindows.forEach(pw => {
    const available = pw.end - pw.start;
    if (available < totalDuration) return;
    // Try fitting at the start of the pose window
    for (let t = pw.start; t + totalDuration <= pw.end; t += step) {
      results.push({
        start: t,
        end: t + totalDuration,
        score: 100,
        type: 'pose',
        label: 'Temps de pose',
        icon: ICO.pose,
      });
      if (results.length > 20) break; // limit pose results
    }
  });

  // 2. Check free gaps
  freeSlots.forEach(gap => {
    const gapDur = gap.end - gap.start;
    if (gapDur < totalDuration) return;

    for (let t = gap.start; t + totalDuration <= gap.end; t += step) {
      const remainAfter = gapDur - totalDuration;
      let score, type, label, icon;

      // Check adjacency: is start at gap.start or end at gap.end?
      const atStart = (t === gap.start);
      const atEnd = (t + totalDuration === gap.end);
      const perfectFit = atStart && atEnd;

      if (perfectFit || remainAfter <= 5) {
        score = 80; type = 'gap_fill'; label = 'Gap combl\u00e9'; icon = ICO.gap;
      } else if (remainAfter < gapDur * 0.5) {
        score = 60; type = 'gap_reduce'; label = 'Gap r\u00e9duit'; icon = ICO.gap;
      } else if (atStart || atEnd) {
        score = 40; type = 'adjacent'; label = 'Adjacent'; icon = ICO.adjacent;
      } else {
        score = 20; type = 'free'; label = 'Cr\u00e9neau libre'; icon = ICO.free;
      }

      results.push({ start: t, end: t + totalDuration, score, type, label, icon });
    }
  });

  // Deduplicate by start time, keep highest score
  const byStart = {};
  results.forEach(r => {
    const key = r.start;
    if (!byStart[key] || r.score > byStart[key].score) byStart[key] = r;
  });

  // Sort by score desc, then by time asc
  return Object.values(byStart)
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, 8);
}

// ── Render Suggestions ──
function soRenderSuggestions() {
  const right = document.getElementById('soRight');
  if (!right) return;

  if (soSelectedServices.length === 0) {
    right.innerHTML = `<div class="so-empty">S\u00e9lectionnez une prestation pour voir les suggestions</div>`;
    return;
  }

  const slots = soFindSlots();

  if (slots.length === 0) {
    right.innerHTML = `<div class="so-empty">Aucun cr\u00e9neau disponible pour ${fmtMin(soSelectedServices.reduce((s, sv) => s + sv.duration_min, 0))}</div>`;
    return;
  }

  let html = '<div class="so-slots">';
  slots.forEach(slot => {
    const scoreClass = slot.score >= 80 ? 'so-score--high' : slot.score >= 60 ? 'so-score--mid' : 'so-score--low';
    html += `<div class="so-slot-card" onclick="soFillSlot(${slot.start})">
      <div class="so-slot-header">
        <span class="so-slot-time">${timeStr(slot.start)} \u2013 ${timeStr(slot.end)}</span>
        <span class="so-slot-dur">${slot.end - slot.start}min</span>
      </div>
      <div class="so-slot-footer">
        <span class="so-score-badge ${scoreClass}">${slot.icon} ${slot.label}</span>
        <span class="so-score-pts">${slot.score} pts</span>
      </div>
    </div>`;
  });
  html += '</div>';
  right.innerHTML = html;
}

// ── Fill Slot → open quick-create ──
function soFillSlot(startMin) {
  const cal = calState.fcCal;
  if (!cal) return;

  const date = localDate(cal.view.currentStart);
  const startStr = date + 'T' + timeStr(startMin) + ':00';

  // Snapshot state before deactivating (soDeactivate clears them)
  const _pracId = soPracId;
  const _services = [...soSelectedServices];

  // Close optimizer
  soDeactivate();

  // Open quick-create pre-filled
  fcOpenQuickCreate(startStr);

  requestAnimationFrame(() => {
    // Set practitioner
    const qcPrac = document.getElementById('qcPrac');
    if (qcPrac && _pracId) {
      qcPrac.value = _pracId;
      const evt = new Event('change', { bubbles: true });
      qcPrac.dispatchEvent(evt);
    }

    // Add first service
    if (_services.length > 0) {
      requestAnimationFrame(() => {
        const firstSvc = _services[0];
        const qcSvcSel = document.getElementById('qcAssignSvcSel');
        if (qcSvcSel) {
          qcSvcSel.value = firstSvc.id;
          if (typeof window.qcAssignSvcChanged === 'function') window.qcAssignSvcChanged();

          // Set variant if needed
          if (firstSvc.variant_id) {
            requestAnimationFrame(() => {
              const qcVarSel = document.getElementById('qcAssignVarSel');
              if (qcVarSel) {
                qcVarSel.value = firstSvc.variant_id;
                if (typeof window.qcAssignVarChanged === 'function') window.qcAssignVarChanged();
              }
              // Confirm first service
              if (typeof window.qcAssignConfirm === 'function') window.qcAssignConfirm();

              // Queue remaining services
              _soQueueRemainingServices(_services, 1);
            });
          } else {
            if (typeof window.qcAssignConfirm === 'function') window.qcAssignConfirm();
            _soQueueRemainingServices(_services, 1);
          }
        }
      });
    }
  });
}

/** Programmatically add remaining services (idx onwards) via qcAssignConfirm */
function _soQueueRemainingServices(services, idx) {
  if (idx >= services.length) return;
  const svc = services[idx];

  requestAnimationFrame(() => {
    // Open assign panel
    if (typeof window.qcShowAssignPanel === 'function') window.qcShowAssignPanel();

    requestAnimationFrame(() => {
      const qcSvcSel = document.getElementById('qcAssignSvcSel');
      if (qcSvcSel) {
        qcSvcSel.value = svc.id;
        if (typeof window.qcAssignSvcChanged === 'function') window.qcAssignSvcChanged();

        if (svc.variant_id) {
          requestAnimationFrame(() => {
            const qcVarSel = document.getElementById('qcAssignVarSel');
            if (qcVarSel) qcVarSel.value = svc.variant_id;
            if (typeof window.qcAssignVarChanged === 'function') window.qcAssignVarChanged();
            if (typeof window.qcAssignConfirm === 'function') window.qcAssignConfirm();
            _soQueueRemainingServices(services, idx + 1);
          });
        } else {
          if (typeof window.qcAssignConfirm === 'function') window.qcAssignConfirm();
          _soQueueRemainingServices(services, idx + 1);
        }
      }
    });
  });
}

// ── Bridge ──
bridge({ soToggleMode, soDeactivate, soAddService, soRemoveService, soPracChanged, soCatChanged, soSvcChanged, soVarChanged, soFillSlot, soRenderSuggestions });

// We also need qcShowAssignPanel, qcAssignSvcChanged, qcAssignVarChanged, qcAssignConfirm
// These are already bridged in quick-create.js / booking-detail.js

export { soIsActive, soToggleMode, soDeactivate };
