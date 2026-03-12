/**
 * Quick Booking — suggests optimal slots for new bookings.
 * Staff selects service(s), the app scores available slots:
 *   pose fit (100), gap fill (80), gap reduce (60), adjacent (40), free (20).
 * Scans all visible days, supports multi-practitioner ("Tous"),
 * day filtering, and filters out planning absences + service schedule restrictions.
 * Pattern follows gap-analyzer.js (prefix so instead of ga).
 */
import { calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { fcIsMobile } from '../../utils/touch.js';
import { MONTH_NAMES } from '../../utils/format.js';

/* ═══════════════════════════════════════════════════════════
   1. CONSTANTS
   ═══════════════════════════════════════════════════════════ */

const DAY_NAMES_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const ICO = {
  pose:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  gap:      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
  adjacent: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>',
  free:     '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  plus:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  close:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  spark:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  remove:   '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  empty:    '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="1"/></svg>',
  arrow:    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
};

/* ═══════════════════════════════════════════════════════════
   2. STATE
   ═══════════════════════════════════════════════════════════ */

const S = {
  active: false,
  selectedServices: [],
  pracId: null,
  dateFilter: 'all',
  absences: [],
  holidays: new Set(),   // Set of 'YYYY-MM-DD' strings (jours fériés)
  calYear: null,          // mini-calendar display year
  calMonth: null,         // mini-calendar display month (0-indexed)
  timePref: 'all',        // 'all' | 'matin' | 'apresmidi' | 'heure'
  timeFrom: 600,          // minutes (600 = 10:00), used when timePref === 'heure'
};

function soIsActive() { return S.active; }

/* ═══════════════════════════════════════════════════════════
   3. PURE HELPERS
   ═══════════════════════════════════════════════════════════ */

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
function soGetStep() {
  const sd = calState.fcCal?.getOption('slotDuration') || '00:15:00';
  const [h, m] = sd.split(':').map(Number);
  return (h * 60 + m) || 15;
}
function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return DAY_NAMES_SHORT[d.getDay()] + ' ' + pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
}

/* ═══════════════════════════════════════════════════════════
   4. ABSENCE HELPERS
   ═══════════════════════════════════════════════════════════ */

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
    const all = [];
    for (const m of months) {
      const resp = await fetch('/api/planning/absences?month=' + m);
      if (resp.ok) { const data = await resp.json(); if (data.absences) all.push(...data.absences); }
    }
    const seen = new Set();
    S.absences = all.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
  } catch (e) {
    console.warn('SO: failed to load absences', e);
    S.absences = [];
  }
}

async function soLoadHolidays() {
  try {
    const cal = calState.fcCal;
    if (!cal) return;
    const start = cal.view.currentStart;
    const end = cal.view.currentEnd;
    const years = new Set();
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) years.add(d.getFullYear());
    const set = new Set();
    for (const y of years) {
      const resp = await fetch('/api/availabilities/holidays?year=' + y);
      if (resp.ok) { const data = await resp.json(); (data || []).forEach(h => { if (h.date) set.add(h.date.slice(0, 10)); }); }
    }
    S.holidays = set;
  } catch (e) {
    console.warn('SO: failed to load holidays', e);
    S.holidays = new Set();
  }
}

function soGetAbsencePeriod(pracId, dateStr) {
  for (const abs of S.absences) {
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
  if (period === 'am') return workWindows.filter(ww => ww.end > noon).map(ww => ({ start: Math.max(ww.start, noon), end: ww.end }));
  if (period === 'pm') return workWindows.filter(ww => ww.start < noon).map(ww => ({ start: ww.start, end: Math.min(ww.end, noon) }));
  return workWindows;
}

/* ═══════════════════════════════════════════════════════════
   5. SCHEDULE HELPERS
   ═══════════════════════════════════════════════════════════ */

function soIntersectWindows(a, b) {
  const result = [];
  for (const wa of a) {
    for (const wb of b) {
      const s = Math.max(wa.start, wb.start);
      const e = Math.min(wa.end, wb.end);
      if (s < e) result.push({ start: s, end: e });
    }
  }
  return result;
}

function soGetScheduleLabel(svcId) {
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  if (!svc?.available_schedule || svc.available_schedule.type !== 'restricted') return '';
  const windows = svc.available_schedule.windows;
  if (!windows || windows.length === 0) return '';
  const ranges = [...new Set(windows.map(w => w.from + '\u2013' + w.to))];
  return ranges.join(', ');
}

/* ═══════════════════════════════════════════════════════════
   6. SERVICE CAPABILITY CHECK
   ═══════════════════════════════════════════════════════════ */

function soCanPracDoServices(pracId) {
  return S.selectedServices.every(svc => {
    const full = calState.fcServices.find(s => String(s.id) === String(svc.id));
    if (!full) return false;
    if (!full.practitioner_ids || full.practitioner_ids.length === 0) return true;
    return full.practitioner_ids.some(pid => String(pid) === String(pracId));
  });
}

/* ═══════════════════════════════════════════════════════════
   7. SCORING ALGORITHM
   ═══════════════════════════════════════════════════════════ */

function soFindSlots() {
  const cal = calState.fcCal;
  if (!cal || S.selectedServices.length === 0) return { slots: [], scheduleConflict: false, skippedDayCount: 0, totalDayCount: 0 };

  const totalDuration = S.selectedServices.reduce((s, svc) => s + svc.duration_min, 0);
  const totalPoseTime = S.selectedServices.reduce((s, svc) => s + (svc.processing_time || 0), 0);
  const viewStart = cal.view.currentStart;
  const viewEnd = cal.view.currentEnd;

  // Expand scan range to include filtered date even if outside FC view
  let scanStart = new Date(viewStart);
  let scanEnd = new Date(viewEnd);
  if (S.dateFilter !== 'all') {
    const filterDate = new Date(S.dateFilter + 'T00:00:00');
    const filterNext = new Date(filterDate);
    filterNext.setDate(filterNext.getDate() + 1);
    if (filterDate < scanStart) scanStart = filterDate;
    if (filterNext > scanEnd) scanEnd = filterNext;
  }

  const pracIds = S.pracId === 'all'
    ? calState.fcPractitioners.map(p => p.id)
    : (S.pracId ? [S.pracId] : []);
  if (pracIds.length === 0) return { slots: [], scheduleConflict: false, skippedDayCount: 0, totalDayCount: 0 };

  const pracNames = {};
  calState.fcPractitioners.forEach(p => { pracNames[p.id] = p.display_name; });

  const allCalEvents = cal.getEvents();
  const now = new Date();
  const todayStr = localDate(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const allResults = [];
  let skippedDayCount = 0;
  let totalDayCount = 0;
  let scheduleConflict = false;

  for (let d = new Date(scanStart); d < scanEnd; d.setDate(d.getDate() + 1)) {
    const dateStr = localDate(d);
    const jsDay = d.getDay();
    if (dateStr < todayStr) continue;
    if (S.holidays.has(dateStr)) continue;
    if (S.dateFilter !== 'all' && dateStr !== S.dateFilter) continue;

    totalDayCount++;

    // Service time restrictions for this weekday
    const schedDay = jsDay === 0 ? 6 : jsDay - 1;
    let svcTimeWindows = null;
    let daySkipped = false;

    for (const svc of S.selectedServices) {
      const full = calState.fcServices.find(s => String(s.id) === String(svc.id));
      if (!full?.available_schedule || full.available_schedule.type !== 'restricted') continue;
      const allWins = full.available_schedule.windows;
      if (!allWins || allWins.length === 0) continue; // empty windows = no restriction
      const wins = allWins
        .filter(w => w.day === schedDay)
        .map(w => {
          const [fh, fm] = w.from.split(':').map(Number);
          const [th, tm] = w.to.split(':').map(Number);
          return { start: fh * 60 + fm, end: th * 60 + tm };
        });
      if (wins.length === 0) { daySkipped = true; scheduleConflict = true; break; }
      svcTimeWindows = svcTimeWindows === null ? wins : soIntersectWindows(svcTimeWindows, wins);
      if (svcTimeWindows.length === 0) { daySkipped = true; scheduleConflict = true; break; }
    }
    if (daySkipped) { skippedDayCount++; continue; }

    for (const pracId of pracIds) {
      if (S.pracId === 'all' && !soCanPracDoServices(pracId)) continue;

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

      if (svcTimeWindows !== null) {
        workWindows = soIntersectWindows(workWindows, svcTimeWindows);
        if (workWindows.length === 0) continue;
      }

      // Apply time preference filter
      if (S.timePref === 'matin') {
        workWindows = workWindows.map(w => ({ start: w.start, end: Math.min(w.end, 780) })).filter(w => w.start < w.end);
        if (workWindows.length === 0) continue;
      } else if (S.timePref === 'apresmidi') {
        workWindows = workWindows.map(w => ({ start: Math.max(w.start, 780), end: w.end })).filter(w => w.start < w.end);
        if (workWindows.length === 0) continue;
      } else if (S.timePref === 'heure') {
        workWindows = workWindows.map(w => ({ start: Math.max(w.start, S.timeFrom), end: w.end })).filter(w => w.start < w.end);
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
      const step = soGetStep();
      const daySlots = _soCalcDaySlots(events, workWindows, totalDuration, totalPoseTime, pracId, dateStr, pracNames[pracId] || '', minStart, step);
      allResults.push(...daySlots);
    }
  }

  const byKey = {};
  allResults.forEach(r => {
    const key = `${r.pracId}_${r.dateStr}_${r.start}`;
    if (!byKey[key] || r.score > byKey[key].score) byKey[key] = r;
  });

  const slots = Object.values(byKey)
    .sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.start - b.start || b.score - a.score);

  return { slots, scheduleConflict, skippedDayCount, totalDayCount };
}

function _soCalcDaySlots(events, workWindows, totalDuration, totalPoseTime, pracId, dateStr, pracName, minStartMin, step) {
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
  const dl = dayLabel(dateStr);

  poseWindows.forEach(pw => {
    if (pw.end - pw.start < totalDuration) return;
    for (let t = pw.start; t + totalDuration <= pw.end; t += step) {
      if (t < minStartMin) continue;
      results.push({
        start: t, end: t + totalDuration, score: 100,
        type: 'pose', label: 'Temps de pose', icon: ICO.pose,
        pracId, pracName, dateStr, dayLabel: dl, poseTime: totalPoseTime,
      });
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
      if (totalPoseTime > 0 && (type === 'free' || type === 'adjacent' || type === 'gap_reduce')) {
        score += 10;
      }
      results.push({
        start: t, end: t + totalDuration, score, type, label, icon,
        pracId, pracName, dateStr, dayLabel: dl, poseTime: totalPoseTime,
      });
    }
  });

  return results;
}

/* ═══════════════════════════════════════════════════════════
   8. RENDERING ENGINE
   ═══════════════════════════════════════════════════════════ */

function soShowPanel() {
  document.getElementById('soOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'soOverlay';
  overlay.className = 'so-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) soDeactivate(); };

  overlay.innerHTML = `<div class="so-modal" id="soPanel">
    <div class="so-modal-header">
      <div class="so-panel-title">${ICO.spark}<span>Quick booking</span></div>
      <button class="so-panel-close" onclick="soDeactivate()" title="Fermer">${ICO.close}</button>
    </div>
    <div class="so-modal-body">
      <div class="so-left" id="soLeft"></div>
      <div class="so-divider"></div>
      <div class="so-right" id="soRight"></div>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

// ── Central render ──
function soRender() {
  if (!document.getElementById('soOverlay')) return;
  soRenderLeft();
  soRenderRight();
}

// ── Left panel ──
function soRenderLeft() {
  const left = document.getElementById('soLeft');
  if (!left) return;

  const effectivePracId = S.pracId === 'all' ? null : S.pracId;
  let html = '';

  // Practitioner
  html += `<div class="so-field"><label class="so-label">Praticien</label>`;
  html += `<select class="so-select" id="soPracSel" onchange="soPracChanged()">`;
  html += `<option value="all"${S.pracId === 'all' ? ' selected' : ''}>Tous les praticiens</option>`;
  calState.fcPractitioners.forEach(p => {
    html += `<option value="${p.id}" ${String(p.id) === String(S.pracId) ? 'selected' : ''}>${esc(p.display_name)}</option>`;
  });
  html += `</select></div>`;

  // Day filter (mini calendar)
  html += soRenderDayFilterHTML();

  // Time preference
  html += soRenderTimePrefHTML();

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
  html += `<div class="so-selected" id="soSelectedList">${soSelectedServicesHTML()}</div>`;

  // Total
  html += `<div class="so-total" id="soTotal">${soTotalHTML()}</div>`;

  left.innerHTML = html;
}

function soRenderDayFilterHTML() {
  const cal = calState.fcCal;
  if (!cal) return '';

  const viewStart = cal.view.currentStart;
  const viewEnd = cal.view.currentEnd;
  const now = new Date();
  const todayStr = localDate(now);

  // Use stored month if set, otherwise derive from FC view
  if (S.calYear === null || S.calMonth === null) {
    const refDate = new Date(viewStart);
    S.calYear = refDate.getFullYear();
    S.calMonth = refDate.getMonth();
  }
  const year = S.calYear;
  const month = S.calMonth;

  // Determine which weekday columns to show (hide merchant's non-working days)
  const hidden = new Set(calState.fcHiddenDays || []);
  // Display order: Mon(1) Tue(2) Wed(3) Thu(4) Fri(5) Sat(6) Sun(0)
  const ALL_FC_DAYS = [1, 2, 3, 4, 5, 6, 0];
  const ALL_LABELS  = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const visDays   = ALL_FC_DAYS.filter(d => !hidden.has(d));
  const visLabels = ALL_FC_DAYS.map((d, i) => hidden.has(d) ? null : ALL_LABELS[i]).filter(Boolean);
  const colCount  = visDays.length || 7;

  const visibleDates = new Set();
  for (let d = new Date(viewStart); d < viewEnd; d.setDate(d.getDate() + 1)) visibleDates.add(localDate(d));

  let html = '<div class="so-field"><label class="so-label">Jour</label>';
  html += '<div class="so-cal" id="soCal">';
  html += `<div class="so-cal-header"><button class="so-cal-nav" onclick="soCalPrev()" title="Mois précédent">‹</button><span class="so-cal-month">${MONTH_NAMES[month]} ${year}</span><button class="so-cal-nav" onclick="soCalNext()" title="Mois suivant">›</button></div>`;
  html += `<div class="so-cal-grid" style="grid-template-columns:repeat(${colCount},1fr)">`;
  visLabels.forEach(w => { html += `<span class="so-cal-wday">${w}</span>`; });

  // Offset: empty cells before day 1 (only for visible columns)
  const firstDayFC = new Date(year, month, 1).getDay();
  const offset = visDays.indexOf(firstDayFC);
  if (offset > 0) for (let i = 0; i < offset; i++) html += '<span class="so-cal-day so-cal-day--empty"></span>';

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(year, month, day);
    const fcDay = dt.getDay();
    if (hidden.has(fcDay)) continue; // skip non-working day columns
    const ds = year + '-' + pad2(month + 1) + '-' + pad2(day);
    const isHoliday = S.holidays.has(ds);
    const cls = ['so-cal-day'];
    let clickable = true;
    if (ds < todayStr) { cls.push('so-cal-day--past'); clickable = false; }
    if (isHoliday) { cls.push('so-cal-day--holiday'); clickable = false; }
    if (ds === todayStr) cls.push('so-cal-day--today');
    if (clickable) cls.push(visibleDates.has(ds) ? 'so-cal-day--in-range' : 'so-cal-day--out-range');
    if (S.dateFilter === ds) cls.push('so-cal-day--selected');
    const onclick = clickable ? ` onclick="soCalDayClick('${ds}')"` : '';
    const title = isHoliday ? ' title="Jour férié"' : '';
    html += `<span class="${cls.join(' ')}" data-date="${ds}"${onclick}${title}>${day}</span>`;
  }

  html += '</div>';
  const resetActive = S.dateFilter === 'all' ? ' so-cal-reset--active' : '';
  html += `<button class="so-cal-reset${resetActive}" onclick="soCalReset()">Tous les jours</button>`;
  html += '</div></div>';
  return html;
}

function soRenderTimePrefHTML() {
  const pills = [
    { id: 'all', label: 'Journée' },
    { id: 'matin', label: 'Matin' },
    { id: 'apresmidi', label: 'Après-midi' },
    { id: 'heure', label: 'Heure' },
  ];
  let html = '<div class="so-field"><label class="so-label">Préférence horaire</label>';
  html += '<div class="so-pills">';
  pills.forEach(p => {
    const active = S.timePref === p.id ? ' active' : '';
    html += `<button class="so-pill${active}" onclick="soSetTimePref('${p.id}')">${p.label}</button>`;
  });
  html += '</div>';
  const showTime = S.timePref === 'heure' ? '' : ' style="display:none"';
  const timeVal = timeStr(S.timeFrom);
  html += `<div class="so-time-input"${showTime}><label class="so-label" style="margin-top:6px">À partir de</label>`;
  html += `<input type="time" class="so-select" id="soTimeFrom" value="${timeVal}" onchange="soTimeFromChanged()">`;
  html += '</div>';
  html += '</div>';
  return html;
}

function soSelectedServicesHTML() {
  if (S.selectedServices.length === 0) return '';
  let html = '';
  S.selectedServices.forEach((svc, idx) => {
    const poseLabel = svc.processing_time > 0 ? ` <span class="so-svc-pose">(+${svc.processing_time}min pose)</span>` : '';
    const schedLabel = soGetScheduleLabel(svc.id);
    const schedTag = schedLabel ? ` <span class="so-svc-sched">${schedLabel}</span>` : '';
    html += `<div class="so-svc-card">
      <span class="so-svc-dot" style="background:${svc.color}"></span>
      <span class="so-svc-name">${esc(svc.name)}</span>
      <span class="so-svc-dur">${svc.duration_min}min${poseLabel}${schedTag}</span>
      <button class="so-svc-rm" onclick="soRemoveService(${idx})" title="Retirer">${ICO.remove}</button>
    </div>`;
  });
  return html;
}

function soTotalHTML() {
  const dur = S.selectedServices.reduce((s, svc) => s + svc.duration_min, 0);
  if (dur === 0) return '';
  const poseT = S.selectedServices.reduce((s, svc) => s + (svc.processing_time || 0), 0);
  let html = `Dur\u00e9e totale : <strong>${fmtMin(dur)}</strong>`;
  if (poseT > 0) html += ` <span class="so-svc-pose">(dont ${fmtMin(poseT)} de pose)</span>`;
  return html;
}

// ── Right panel ──
function soRenderRight() {
  const right = document.getElementById('soRight');
  if (!right) return;

  if (S.selectedServices.length === 0) {
    right.innerHTML = `<div class="so-empty">${ICO.empty}<span>S\u00e9lectionnez une prestation<br>pour voir les cr\u00e9neaux optimaux</span></div>`;
    return;
  }

  const { slots, scheduleConflict, skippedDayCount, totalDayCount } = soFindSlots();

  if (slots.length === 0) {
    if (scheduleConflict && skippedDayCount === totalDayCount) {
      right.innerHTML = `<div class="so-empty">${ICO.empty}<span>Horaires incompatibles<br><small>Les prestations s\u00e9lectionn\u00e9es n\u2019ont aucune plage horaire commune</small></span></div>`;
    } else {
      right.innerHTML = `<div class="so-empty">${ICO.empty}<span>Aucun cr\u00e9neau disponible<br>pour ${fmtMin(S.selectedServices.reduce((s, sv) => s + sv.duration_min, 0))}</span></div>`;
    }
    return;
  }

  // Group by day
  const grouped = {};
  slots.forEach(slot => {
    if (!grouped[slot.dateStr]) grouped[slot.dateStr] = [];
    grouped[slot.dateStr].push(slot);
  });

  const showPrac = S.pracId === 'all';
  let html = `<div class="so-right-header">
    <span class="so-right-title">Cr\u00e9neaux sugg\u00e9r\u00e9s</span>
    <span class="so-right-count">${slots.length} r\u00e9sultat${slots.length > 1 ? 's' : ''}</span>
  </div>`;
  html += '<div class="so-slots-scroll">';

  for (const dateStr of Object.keys(grouped)) {
    const daySlots = grouped[dateStr];
    html += `<div class="so-day-group">`;
    html += `<div class="so-day-header">${daySlots[0].dayLabel}</div>`;
    html += `<div class="so-day-slots">`;
    daySlots.forEach(slot => {
      const tier = slot.score >= 80 ? 'high' : slot.score >= 60 ? 'mid' : 'low';
      html += `<div class="so-slot-card" data-tier="${tier}" onclick="soFillSlot(${slot.start},'${slot.pracId}','${slot.dateStr}')">
        <div class="so-slot-top">
          <div class="so-slot-left">
            <div class="so-slot-time">${timeStr(slot.start)} \u2013 ${timeStr(slot.end)}</div>
            ${showPrac ? `<span class="so-slot-prac">${esc(slot.pracName)}</span>` : ''}
          </div>
          <div class="so-slot-right-info">
            <span class="so-score-badge so-score--${tier}">${slot.icon} ${slot.label}</span>
            ${slot.poseTime > 0 ? `<span class="so-pose-tag">${ICO.pose} +${slot.poseTime}min</span>` : ''}
            <span class="so-slot-arrow">${ICO.arrow}</span>
          </div>
        </div>
      </div>`;
    });
    html += `</div></div>`;
  }

  html += '</div>';
  right.innerHTML = html;
}

// Alias for bridge compatibility
function soRenderSuggestions() { soRenderRight(); }

/* ═══════════════════════════════════════════════════════════
   9. EVENT HANDLERS
   ═══════════════════════════════════════════════════════════ */

function soPracChanged() {
  S.pracId = document.getElementById('soPracSel')?.value || null;
  soRender();
}

function soCalDayClick(dateStr) {
  S.dateFilter = dateStr;
  soRender();
}

function soCalReset() {
  S.dateFilter = 'all';
  soRender();
}

function soCalPrev() {
  S.calMonth--;
  if (S.calMonth < 0) { S.calMonth = 11; S.calYear--; }
  soRender();
}

function soCalNext() {
  S.calMonth++;
  if (S.calMonth > 11) { S.calMonth = 0; S.calYear++; }
  soRender();
}

function soSetTimePref(pref) {
  S.timePref = pref;
  if (pref === 'heure') {
    const inp = document.getElementById('soTimeFrom');
    if (inp) { const [h, m] = inp.value.split(':').map(Number); S.timeFrom = h * 60 + (m || 0); }
  }
  soRender();
}

function soTimeFromChanged() {
  const inp = document.getElementById('soTimeFrom');
  if (inp) { const [h, m] = inp.value.split(':').map(Number); S.timeFrom = h * 60 + (m || 0); }
  soRenderRight();
}

// Targeted dropdown updates (avoid full re-render to preserve selection state)
function soCatChanged() {
  const cat = document.getElementById('soCatSel')?.value || '';
  const effectivePracId = S.pracId === 'all' ? null : S.pracId;
  const services = window.fcGetFilteredServices ? window.fcGetFilteredServices(effectivePracId, cat) : [];
  const sel = document.getElementById('soSvcSel');
  if (sel) {
    sel.innerHTML = '<option value="">\u2014 Choisir \u2014</option>' + services.map(s => {
      const durLabel = window.svcDurPriceLabel ? window.svcDurPriceLabel(s) : (s.duration_min + ' min');
      return `<option value="${s.id}">${esc(s.name)} (${durLabel})</option>`;
    }).join('');
  }
  const varWrap = document.getElementById('soVarWrap');
  if (varWrap) varWrap.style.display = 'none';
  soUpdateAddBtn();
}

function soSvcChanged() {
  const svcId = document.getElementById('soSvcSel')?.value;
  const varWrap = document.getElementById('soVarWrap');
  const varSel = document.getElementById('soVarSel');
  if (!svcId) { if (varWrap) varWrap.style.display = 'none'; soUpdateAddBtn(); return; }

  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const variants = svc?.variants || [];
  if (variants.length > 0) {
    if (varSel) varSel.innerHTML = '<option value="">\u2014 Variante \u2014</option>' + variants.map(v =>
      `<option value="${v.id}">${esc(v.name)} (${v.duration_min} min${v.price_cents ? ' \u00b7 ' + (v.price_cents / 100).toFixed(0) + '\u20ac' : ''})</option>`
    ).join('');
    if (varWrap) varWrap.style.display = '';
  } else {
    if (varSel) varSel.innerHTML = '';
    if (varWrap) varWrap.style.display = 'none';
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
  const varId = document.getElementById('soVarSel')?.value || '';
  if (hasVariants && !varId) { btn.disabled = true; return; }
  const isDuplicate = S.selectedServices.some(s =>
    String(s.id) === String(svcId) && String(s.variant_id || '') === String(varId)
  );
  btn.disabled = isDuplicate;
}

function soAddService() {
  const svcId = document.getElementById('soSvcSel')?.value;
  if (!svcId) return;
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  if (!svc) return;

  const varId = document.getElementById('soVarSel')?.value || '';
  const variant = varId ? svc.variants?.find(v => String(v.id) === String(varId)) : null;

  if (S.selectedServices.some(s => String(s.id) === String(svc.id) && String(s.variant_id || '') === String(varId))) {
    gToast('Cette prestation est d\u00e9j\u00e0 s\u00e9lectionn\u00e9e', 'info');
    return;
  }

  const color = /^#[0-9a-fA-F]{3,8}$/.test(svc.color) ? svc.color : '#0D7377';
  S.selectedServices.push({
    id: svc.id,
    name: variant ? svc.name + ' \u2014 ' + variant.name : svc.name,
    duration_min: variant?.duration_min || svc.duration_min || 0,
    variant_id: varId,
    variant_name: variant?.name || '',
    color,
    price_cents: variant?.price_cents || svc.price_cents || 0,
    processing_time: variant?.processing_time || svc.processing_time || 0,
    processing_start: variant?.processing_start || svc.processing_start || 0,
    buffer_before_min: svc.buffer_before_min || 0,
    buffer_after_min: svc.buffer_after_min || 0,
  });

  // Reset dropdowns
  const svcSel = document.getElementById('soSvcSel');
  if (svcSel) svcSel.value = '';
  const varWrap = document.getElementById('soVarWrap');
  if (varWrap) varWrap.style.display = 'none';
  soUpdateAddBtn();

  // Refresh selected list + total + right panel
  const list = document.getElementById('soSelectedList');
  if (list) list.innerHTML = soSelectedServicesHTML();
  const total = document.getElementById('soTotal');
  if (total) total.innerHTML = soTotalHTML();
  soRenderRight();
}

function soRemoveService(idx) {
  S.selectedServices.splice(idx, 1);
  const list = document.getElementById('soSelectedList');
  if (list) list.innerHTML = soSelectedServicesHTML();
  const total = document.getElementById('soTotal');
  if (total) total.innerHTML = soTotalHTML();
  soUpdateAddBtn();
  soRenderRight();
}

/* ═══════════════════════════════════════════════════════════
   10. FILL SLOT → QUICK-CREATE
   ═══════════════════════════════════════════════════════════ */

function soFillSlot(startMin, slotPracId, dateStr) {
  const startStr = dateStr + 'T' + timeStr(startMin) + ':00';
  const _pracId = slotPracId || S.pracId;
  const _services = [...S.selectedServices];

  const overlay = document.getElementById('soOverlay');
  if (overlay) overlay.style.display = 'none';

  fcOpenQuickCreate(startStr);

  const qcModal = document.getElementById('calCreateModal');
  if (qcModal) {
    const observer = new MutationObserver(() => {
      if (!qcModal.classList.contains('open')) {
        observer.disconnect();
        const so = document.getElementById('soOverlay');
        if (so) { so.style.display = ''; soRenderRight(); }
      }
    });
    observer.observe(qcModal, { attributes: true, attributeFilter: ['class'] });
  }

  requestAnimationFrame(() => {
    const qcPrac = document.getElementById('qcPrac');
    if (qcPrac && _pracId && _pracId !== 'all') {
      qcPrac.value = _pracId;
      qcPrac.dispatchEvent(new Event('change', { bubbles: true }));
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
              if (qcVarSel) { qcVarSel.value = firstSvc.variant_id; if (typeof window.qcAssignVarChanged === 'function') window.qcAssignVarChanged(); }
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

/* ═══════════════════════════════════════════════════════════
   11. LIFECYCLE
   ═══════════════════════════════════════════════════════════ */

function soToggleMode() {
  if (S.active) { soDeactivate(); return; }
  if (fcIsMobile()) { gToast('Quick booking non disponible sur mobile', 'info'); return; }
  soActivate();
}

async function soActivate() {
  if (typeof window.gaDeactivate === 'function') window.gaDeactivate();
  if (typeof window.fsCancelMode === 'function') window.fsCancelMode();

  S.active = true;
  S.selectedServices = [];
  S.dateFilter = 'all';
  S.calYear = null;
  S.calMonth = null;
  S.timePref = 'all';
  S.timeFrom = 600;
  S.pracId = calState.fcCurrentFilter && calState.fcCurrentFilter !== 'all'
    ? calState.fcCurrentFilter
    : 'all';

  document.getElementById('soToggleBtn')?.classList.add('active');
  await Promise.all([soLoadAbsences(), soLoadHolidays()]);
  soShowPanel();
  soRender();
}

function soDeactivate() {
  S.active = false;
  S.selectedServices = [];
  S.pracId = null;
  S.dateFilter = 'all';
  S.absences = [];
  S.holidays = new Set();
  S.calYear = null;
  S.calMonth = null;
  S.timePref = 'all';
  S.timeFrom = 600;
  document.getElementById('soToggleBtn')?.classList.remove('active');
  document.getElementById('soOverlay')?.remove();
}

async function soOnDatesSet() {
  if (!S.active) return;
  await Promise.all([soLoadAbsences(), soLoadHolidays()]);
  soRender();
}

/* ═══════════════════════════════════════════════════════════
   12. BRIDGE + EXPORTS
   ═══════════════════════════════════════════════════════════ */

bridge({ soToggleMode, soDeactivate, soAddService, soRemoveService, soPracChanged, soCalDayClick, soCalReset, soCalPrev, soCalNext, soSetTimePref, soTimeFromChanged, soCatChanged, soSvcChanged, soVarChanged, soFillSlot, soRenderSuggestions, soOnDatesSet });

export { soIsActive, soToggleMode, soDeactivate, soOnDatesSet };
