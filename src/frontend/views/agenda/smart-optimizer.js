/**
 * Smart Optimizer — suggests optimal slots for new bookings.
 * Staff selects service(s), the app scores available slots:
 *   pose fit (100), gap fill (80), gap reduce (60), adjacent (40), free (20).
 * Scans all visible days, supports multi-practitioner ("Tous"),
 * day filtering, and filters out planning absences.
 * Pattern follows gap-analyzer.js (prefix so instead of ga).
 */
import { calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { fcIsMobile } from '../../utils/touch.js';

// ── State ──
let soActive = false;
let soSelectedServices = [];
let soPracId = null;   // practitioner id or 'all'
let soDateFilter = 'all'; // 'all' or 'YYYY-MM-DD'
let soAbsences = [];

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

const DAY_NAMES_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAY_NAMES_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return DAY_NAMES_SHORT[d.getDay()] + ' ' + pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
}
function dayLabelLong(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return DAY_NAMES_FULL[d.getDay()] + ' ' + d.getDate() + '/' + pad2(d.getMonth() + 1);
}

// ── SVG Icons (no emojis) ──
const ICO = {
  pose:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  gap:      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
  adjacent: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>',
  free:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  plus:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  close:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  spark:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  remove:   '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  empty:    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="1"/></svg>',
  arrow:    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
};

// ── Toggle ──
function soToggleMode() {
  if (soActive) { soDeactivate(); return; }
  if (fcIsMobile()) { gToast('Optimiseur non disponible sur mobile', 'info'); return; }
  soActivate();
}

// ── Activate / Deactivate ──
async function soActivate() {
  if (typeof window.gaDeactivate === 'function') window.gaDeactivate();
  if (typeof window.fsCancelMode === 'function') window.fsCancelMode();

  soActive = true;
  soSelectedServices = [];
  soDateFilter = 'all';
  soPracId = calState.fcCurrentFilter && calState.fcCurrentFilter !== 'all'
    ? calState.fcCurrentFilter
    : 'all';

  document.getElementById('soToggleBtn')?.classList.add('active');
  await soLoadAbsences();
  soShowPanel();
}

function soDeactivate() {
  soActive = false;
  soSelectedServices = [];
  soPracId = null;
  soDateFilter = 'all';
  soAbsences = [];
  document.getElementById('soToggleBtn')?.classList.remove('active');
  document.getElementById('soOverlay')?.remove();
}

// ── Load Absences from Planning ──
async function soLoadAbsences() {
  try {
    const cal = calState.fcCal;
    if (!cal) return;
    const start = cal.view.currentStart;
    const end = cal.view.currentEnd;
    const months = new Set();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      months.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
    const allAbsences = [];
    for (const m of months) {
      const resp = await fetch('/api/planning/absences?month=' + m);
      if (resp.ok) {
        const data = await resp.json();
        if (data.absences) allAbsences.push(...data.absences);
      }
    }
    const seen = new Set();
    soAbsences = allAbsences.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
  } catch (e) {
    console.warn('SO: failed to load absences', e);
    soAbsences = [];
  }
}

// ── Absence helpers ──
function soGetAbsencePeriod(pracId, dateStr) {
  for (const abs of soAbsences) {
    if (String(abs.practitioner_id) !== String(pracId)) continue;
    const from = (abs.date_from || '').slice(0, 10);
    const to = (abs.date_to || '').slice(0, 10);
    if (dateStr < from || dateStr > to) continue;
    if (from === to) return abs.period || 'full';
    if (dateStr === from) return abs.period || 'full';
    if (dateStr === to) return abs.period_end || 'full';
    return 'full';
  }
  return null;
}

function soFilterWorkWindows(workWindows, period) {
  const noon = 780;
  if (period === 'full') return [];
  if (period === 'am') {
    return workWindows
      .filter(ww => ww.end > noon)
      .map(ww => ({ start: Math.max(ww.start, noon), end: ww.end }));
  }
  if (period === 'pm') {
    return workWindows
      .filter(ww => ww.start < noon)
      .map(ww => ({ start: ww.start, end: Math.min(ww.end, noon) }));
  }
  return workWindows;
}

// ── Modal DOM ──
function soShowPanel() {
  document.getElementById('soOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'soOverlay';
  overlay.className = 'so-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) soDeactivate(); };

  let html = `<div class="so-modal" id="soPanel">`;

  // Header — gradient
  html += `<div class="so-modal-header">
    <div class="so-panel-title">${ICO.spark}<span>Optimiseur de RDV</span></div>
    <button class="so-panel-close" onclick="soDeactivate()" title="Fermer">${ICO.close}</button>
  </div>`;

  // Body
  html += `<div class="so-modal-body">`;

  // Left column
  html += `<div class="so-left" id="soLeft">`;
  html += soRenderServicePicker();
  html += `</div>`;

  html += `<div class="so-divider"></div>`;

  // Right column
  html += `<div class="so-right" id="soRight">`;
  html += `<div class="so-empty">${ICO.empty}<span>S\u00e9lectionnez une prestation<br>pour voir les cr\u00e9neaux optimaux</span></div>`;
  html += `</div>`;

  html += `</div></div>`;
  overlay.innerHTML = html;
  document.body.appendChild(overlay);
}

// ── Service Picker (left column) ──
function soRenderServicePicker() {
  const effectivePracId = soPracId === 'all' ? null : soPracId;
  let html = '';

  // Practitioner
  html += `<div class="so-field"><label class="so-label">Praticien</label>`;
  html += `<select class="so-select" id="soPracSel" onchange="soPracChanged()">`;
  html += `<option value="all"${soPracId === 'all' ? ' selected' : ''}>Tous les praticiens</option>`;
  calState.fcPractitioners.forEach(p => {
    html += `<option value="${p.id}" ${String(p.id) === String(soPracId) ? 'selected' : ''}>${esc(p.display_name)}</option>`;
  });
  html += `</select></div>`;

  // Day filter
  html += soRenderDayFilter();

  html += `<div class="so-sep"></div>`;

  // Category
  const cats = window.fcGetServiceCategories ? window.fcGetServiceCategories(effectivePracId) : [];
  html += `<div class="so-field"><label class="so-label">Cat\u00e9gorie</label>`;
  html += `<select class="so-select" id="soCatSel" onchange="soCatChanged()">`;
  html += `<option value="">\u2014 Toutes \u2014</option>`;
  cats.forEach(c => { html += `<option value="${esc(c)}">${esc(c)}</option>`; });
  html += `</select></div>`;

  // Service
  const services = window.fcGetFilteredServices ? window.fcGetFilteredServices(effectivePracId, '') : [];
  html += `<div class="so-field"><label class="so-label">Prestation</label>`;
  html += `<select class="so-select" id="soSvcSel" onchange="soSvcChanged()">`;
  html += `<option value="">\u2014 Choisir \u2014</option>`;
  services.forEach(s => {
    const durLabel = window.svcDurPriceLabel ? window.svcDurPriceLabel(s) : (s.duration_min + ' min');
    html += `<option value="${s.id}">${esc(s.name)} (${durLabel})</option>`;
  });
  html += `</select></div>`;

  // Variant (hidden)
  html += `<div class="so-field" id="soVarWrap" style="display:none"><label class="so-label">Variante</label>`;
  html += `<select class="so-select" id="soVarSel" onchange="soVarChanged()"></select></div>`;

  // Add button
  html += `<button class="so-add-btn" id="soAddBtn" onclick="soAddService()" disabled>${ICO.plus} Ajouter</button>`;

  // Selected services
  html += `<div class="so-selected" id="soSelectedList">`;
  html += soRenderSelectedServices();
  html += `</div>`;

  // Total
  html += `<div class="so-total" id="soTotal">`;
  const dur = soSelectedServices.reduce((s, svc) => s + svc.duration_min, 0);
  if (dur > 0) html += `Dur\u00e9e totale : <strong>${fmtMin(dur)}</strong>`;
  html += `</div>`;

  return html;
}

function soRenderDayFilter() {
  const cal = calState.fcCal;
  if (!cal) return '';
  const viewStart = cal.view.currentStart;
  const viewEnd = cal.view.currentEnd;
  const now = new Date();
  const todayStr = localDate(now);

  let html = `<div class="so-field"><label class="so-label">Jour</label>`;
  html += `<select class="so-select" id="soDateSel" onchange="soDateChanged()">`;
  html += `<option value="all"${soDateFilter === 'all' ? ' selected' : ''}>Tous les jours visibles</option>`;

  for (let d = new Date(viewStart); d < viewEnd; d.setDate(d.getDate() + 1)) {
    const ds = localDate(d);
    if (ds < todayStr) continue;
    html += `<option value="${ds}"${soDateFilter === ds ? ' selected' : ''}>${dayLabelLong(ds)}</option>`;
  }
  html += `</select></div>`;
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
  soRefreshSelected();
  soRenderSuggestions();
}

function soDateChanged() {
  soDateFilter = document.getElementById('soDateSel')?.value || 'all';
  soRenderSuggestions();
}

function soCatChanged() {
  const cat = document.getElementById('soCatSel')?.value || '';
  const effectivePracId = soPracId === 'all' ? null : soPracId;
  const services = window.fcGetFilteredServices ? window.fcGetFilteredServices(effectivePracId, cat) : [];
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
  const effectivePracId = soPracId === 'all' ? null : soPracId;

  const prevCat = document.getElementById('soCatSel')?.value || '';
  const prevSvc = document.getElementById('soSvcSel')?.value || '';
  const prevVar = document.getElementById('soVarSel')?.value || '';

  const cats = window.fcGetServiceCategories ? window.fcGetServiceCategories(effectivePracId) : [];
  const catSel = document.getElementById('soCatSel');
  if (catSel) {
    catSel.innerHTML = '<option value="">\u2014 Toutes \u2014</option>' + cats.map(c =>
      `<option value="${esc(c)}">${esc(c)}</option>`
    ).join('');
    if (prevCat && [...catSel.options].some(o => o.value === prevCat)) {
      catSel.value = prevCat;
    }
  }

  soCatChanged();

  if (prevSvc) {
    const svcSel = document.getElementById('soSvcSel');
    if (svcSel && [...svcSel.options].some(o => o.value === prevSvc)) {
      svcSel.value = prevSvc;
      soSvcChanged();
      if (prevVar) {
        const varSel = document.getElementById('soVarSel');
        if (varSel && [...varSel.options].some(o => o.value === prevVar)) {
          varSel.value = prevVar;
        }
      }
      soUpdateAddBtn();
    }
  }
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

  document.getElementById('soSvcSel').value = '';
  document.getElementById('soVarWrap').style.display = 'none';
  soUpdateAddBtn();
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

// ── Service availability check per practitioner ──
function soCanPracDoServices(pracId) {
  return soSelectedServices.every(svc => {
    const fullSvc = calState.fcServices.find(s => String(s.id) === String(svc.id));
    if (!fullSvc) return false;
    if (!fullSvc.practitioner_ids || fullSvc.practitioner_ids.length === 0) return true;
    return fullSvc.practitioner_ids.some(pid => String(pid) === String(pracId));
  });
}

// ── Scoring Algorithm ──
function soFindSlots() {
  const cal = calState.fcCal;
  if (!cal || soSelectedServices.length === 0) return [];

  const totalDuration = soSelectedServices.reduce((s, svc) => s + svc.duration_min, 0);
  const viewStart = cal.view.currentStart;
  const viewEnd = cal.view.currentEnd;

  const pracIds = soPracId === 'all'
    ? calState.fcPractitioners.map(p => p.id)
    : (soPracId ? [soPracId] : []);

  if (pracIds.length === 0) return [];

  const pracNames = {};
  calState.fcPractitioners.forEach(p => { pracNames[p.id] = p.display_name; });

  const allCalEvents = cal.getEvents();
  const now = new Date();
  const todayStr = localDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const allResults = [];

  for (let d = new Date(viewStart); d < viewEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = localDate(d);
    const jsDay = d.getDay();

    if (dateStr < todayStr) continue;

    // Day filter
    if (soDateFilter !== 'all' && dateStr !== soDateFilter) continue;

    for (const pracId of pracIds) {
      if (soPracId === 'all' && !soCanPracDoServices(pracId)) continue;

      const absPeriod = soGetAbsencePeriod(pracId, dateStr);
      if (absPeriod === 'full') continue;

      const pracHours = calState.fcPracBusinessHours[pracId] || calState.fcBusinessHours || [];
      const todayHours = pracHours.filter(h => h.daysOfWeek.includes(jsDay));
      if (todayHours.length === 0) continue;

      let workWindows = todayHours.map(h => {
        const [sh, sm] = h.startTime.split(':').map(Number);
        const [eh, em] = h.endTime.split(':').map(Number);
        return { start: sh * 60 + sm, end: eh * 60 + em };
      }).sort((a, b) => a.start - b.start);

      if (absPeriod) {
        workWindows = soFilterWorkWindows(workWindows, absPeriod);
        if (workWindows.length === 0) continue;
      }

      const dayStartDt = new Date(dateStr + 'T00:00:00');
      const dayEndDt = new Date(dateStr + 'T23:59:59');
      const events = allCalEvents.filter(ev => {
        const p = ev.extendedProps || {};
        if (p._isTask) return false;
        if (['cancelled', 'no_show'].includes(p.status)) return false;
        if (p.status === 'pending' && ev.start && ev.start <= now) return false;
        if (String(p.practitioner_id) !== String(pracId)) return false;
        return ev.start < dayEndDt && ev.end > dayStartDt;
      }).sort((a, b) => a.start - b.start);

      const minStart = dateStr === todayStr ? nowMin : 0;
      const daySlots = _soCalcDaySlots(events, workWindows, totalDuration, pracId, dateStr, pracNames[pracId] || '', minStart);
      allResults.push(...daySlots);
    }
  }

  const byKey = {};
  allResults.forEach(r => {
    const key = `${r.pracId}_${r.dateStr}_${r.start}`;
    if (!byKey[key] || r.score > byKey[key].score) byKey[key] = r;
  });

  return Object.values(byKey)
    .sort((a, b) => b.score - a.score || a.dateStr.localeCompare(b.dateStr) || a.start - b.start)
    .slice(0, 15);
}

/** Calculate scored slots for a single practitioner on a single day */
function _soCalcDaySlots(events, workWindows, totalDuration, pracId, dateStr, pracName, minStartMin) {
  const occupied = events.map(ev => {
    const s = ev.start.getHours() * 60 + ev.start.getMinutes();
    const e = ev.end.getHours() * 60 + ev.end.getMinutes();
    return { start: s, end: e, ev };
  }).sort((a, b) => a.start - b.start);

  const poseWindows = [];
  events.forEach(ev => {
    const p = ev.extendedProps || {};
    const pt = parseInt(p.processing_time) || 0;
    const ps = parseInt(p.processing_start) || 0;
    const buf = parseInt(p.buffer_before_min) || 0;
    if (pt <= 0) return;

    const evStartMin = ev.start.getHours() * 60 + ev.start.getMinutes();
    const poseStart = evStartMin + buf + ps;
    const poseEnd = poseStart + pt;

    const childRanges = events.filter(ch => {
      if (ch === ev) return false;
      const cp = ch.extendedProps || {};
      if (cp._isPoseChild && String(cp._poseParentId) === String(p.id)) return true;
      const cs = ch.start.getHours() * 60 + ch.start.getMinutes();
      const ce = ch.end.getHours() * 60 + ch.end.getMinutes();
      return cs >= poseStart && ce <= poseEnd && ch !== ev;
    }).map(ch => ({
      start: ch.start.getHours() * 60 + ch.start.getMinutes(),
      end: ch.end.getHours() * 60 + ch.end.getMinutes()
    })).sort((a, b) => a.start - b.start);

    let cursor = poseStart;
    childRanges.forEach(cr => {
      if (cr.start > cursor) poseWindows.push({ start: cursor, end: cr.start });
      cursor = Math.max(cursor, cr.end);
    });
    if (cursor < poseEnd) poseWindows.push({ start: cursor, end: poseEnd });
  });

  const freeSlots = [];
  workWindows.forEach(ww => {
    const segs = occupied.filter(o => o.end > ww.start && o.start < ww.end)
      .map(o => ({ start: Math.max(o.start, ww.start), end: Math.min(o.end, ww.end) }))
      .sort((a, b) => a.start - b.start);

    let cursor = ww.start;
    segs.forEach(seg => {
      if (seg.start > cursor) freeSlots.push({ start: cursor, end: seg.start });
      cursor = Math.max(cursor, seg.end);
    });
    if (cursor < ww.end) freeSlots.push({ start: cursor, end: ww.end });
  });

  const results = [];
  const step = 5;
  const dl = dayLabel(dateStr);

  poseWindows.forEach(pw => {
    if (pw.end - pw.start < totalDuration) return;
    for (let t = pw.start; t + totalDuration <= pw.end; t += step) {
      if (t < minStartMin) continue;
      results.push({
        start: t, end: t + totalDuration, score: 100,
        type: 'pose', label: 'Temps de pose', icon: ICO.pose,
        pracId, pracName, dateStr, dayLabel: dl,
      });
      if (results.length > 20) break;
    }
  });

  freeSlots.forEach(gap => {
    const gapDur = gap.end - gap.start;
    if (gapDur < totalDuration) return;

    for (let t = gap.start; t + totalDuration <= gap.end; t += step) {
      if (t < minStartMin) continue;

      const remainAfter = gapDur - totalDuration;
      const atStart = (t === gap.start);
      const atEnd = (t + totalDuration === gap.end);
      const perfectFit = atStart && atEnd;

      let score, type, label, icon;
      if (perfectFit || remainAfter <= 5) {
        score = 80; type = 'gap_fill'; label = 'Gap combl\u00e9'; icon = ICO.gap;
      } else if (remainAfter < gapDur * 0.5) {
        score = 60; type = 'gap_reduce'; label = 'Gap r\u00e9duit'; icon = ICO.gap;
      } else if (atStart || atEnd) {
        score = 40; type = 'adjacent'; label = 'Adjacent'; icon = ICO.adjacent;
      } else {
        score = 20; type = 'free'; label = 'Cr\u00e9neau libre'; icon = ICO.free;
      }

      results.push({
        start: t, end: t + totalDuration, score, type, label, icon,
        pracId, pracName, dateStr, dayLabel: dl,
      });
    }
  });

  return results;
}

// ── Render Suggestions ──
function soRenderSuggestions() {
  const right = document.getElementById('soRight');
  if (!right) return;

  if (soSelectedServices.length === 0) {
    right.innerHTML = `<div class="so-empty">${ICO.empty}<span>S\u00e9lectionnez une prestation<br>pour voir les cr\u00e9neaux optimaux</span></div>`;
    return;
  }

  const slots = soFindSlots();

  if (slots.length === 0) {
    right.innerHTML = `<div class="so-empty">${ICO.empty}<span>Aucun cr\u00e9neau disponible<br>pour ${fmtMin(soSelectedServices.reduce((s, sv) => s + sv.duration_min, 0))}</span></div>`;
    return;
  }

  const showPrac = soPracId === 'all';
  let html = `<div class="so-right-header">
    <span class="so-right-title">Cr\u00e9neaux sugg\u00e9r\u00e9s</span>
    <span class="so-right-count">${slots.length} r\u00e9sultat${slots.length > 1 ? 's' : ''}</span>
  </div>`;
  html += '<div class="so-slots">';
  slots.forEach(slot => {
    const tier = slot.score >= 80 ? 'high' : slot.score >= 60 ? 'mid' : 'low';
    html += `<div class="so-slot-card" data-tier="${tier}" onclick="soFillSlot(${slot.start},'${slot.pracId}','${slot.dateStr}')">
      <div class="so-slot-top">
        <div class="so-slot-left">
          <div class="so-slot-meta">
            <span class="so-slot-date">${slot.dayLabel}</span>
            ${showPrac ? `<span class="so-slot-prac">${esc(slot.pracName)}</span>` : ''}
          </div>
          <div class="so-slot-time">${timeStr(slot.start)} \u2013 ${timeStr(slot.end)}</div>
        </div>
        <div class="so-slot-right-info">
          <span class="so-slot-dur">${slot.end - slot.start}min</span>
          <span class="so-slot-arrow">${ICO.arrow}</span>
        </div>
      </div>
      <div class="so-slot-footer">
        <span class="so-score-badge so-score--${tier}">${slot.icon} ${slot.label}</span>
        <div class="so-score-bar"><div class="so-score-fill" data-tier="${tier}" style="width:${slot.score}%"></div></div>
      </div>
    </div>`;
  });
  html += '</div>';
  right.innerHTML = html;
}

// ── Fill Slot → open quick-create ──
function soFillSlot(startMin, slotPracId, dateStr) {
  const startStr = dateStr + 'T' + timeStr(startMin) + ':00';

  const _pracId = slotPracId || soPracId;
  const _services = [...soSelectedServices];

  soDeactivate();
  fcOpenQuickCreate(startStr);

  requestAnimationFrame(() => {
    const qcPrac = document.getElementById('qcPrac');
    if (qcPrac && _pracId && _pracId !== 'all') {
      qcPrac.value = _pracId;
      const evt = new Event('change', { bubbles: true });
      qcPrac.dispatchEvent(evt);
    }

    if (_services.length > 0) {
      requestAnimationFrame(() => {
        const firstSvc = _services[0];
        const qcSvcSel = document.getElementById('qcAssignSvcSel');
        if (qcSvcSel) {
          qcSvcSel.value = firstSvc.id;
          if (typeof window.qcAssignSvcChanged === 'function') window.qcAssignSvcChanged();

          if (firstSvc.variant_id) {
            requestAnimationFrame(() => {
              const qcVarSel = document.getElementById('qcAssignVarSel');
              if (qcVarSel) {
                qcVarSel.value = firstSvc.variant_id;
                if (typeof window.qcAssignVarChanged === 'function') window.qcAssignVarChanged();
              }
              if (typeof window.qcAssignConfirm === 'function') window.qcAssignConfirm();
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

function _soQueueRemainingServices(services, idx) {
  if (idx >= services.length) return;
  const svc = services[idx];

  requestAnimationFrame(() => {
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
bridge({ soToggleMode, soDeactivate, soAddService, soRemoveService, soPracChanged, soDateChanged, soCatChanged, soSvcChanged, soVarChanged, soFillSlot, soRenderSuggestions });

export { soIsActive, soToggleMode, soDeactivate };
