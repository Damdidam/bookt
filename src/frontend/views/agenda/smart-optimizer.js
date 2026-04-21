/**
 * Quick Booking — suggests optimal slots for new bookings.
 * Staff selects service(s), the app scores available slots:
 *   pose fit (100), gap fill (80), gap reduce (60), adjacent (40), free (20).
 * Scans all visible days, supports multi-practitioner ("Tous"),
 * day filtering, and filters out planning absences + service schedule restrictions.
 * Pattern follows gap-analyzer.js (prefix so instead of ga).
 */
import { calState, api } from '../../state.js';
import { esc, gToast, initTimeInputs } from '../../utils/dom.js';
import { isPro } from '../../utils/plan-gate.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { fcIsMobile } from '../../utils/touch.js';
import { MONTH_NAMES } from '../../utils/format.js';

/* ═══════════════════════════════════════════════════════════
   1. CONSTANTS
   ═══════════════════════════════════════════════════════════ */

const DAY_NAMES_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const ICO = {
  pose:     '<svg class="gi" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  gap:      '<svg class="gi" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
  adjacent: '<svg class="gi" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/></svg>',
  free:     '<svg class="gi" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  plus:     '<svg class="gi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  close:    '<svg class="gi" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  spark:    '<svg class="gi" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  remove:   '<svg class="gi" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  empty:    '<svg class="gi" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="16" r="1"/></svg>',
  arrow:    '<svg class="gi" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  clear:    '<svg class="gi" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
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
  cachedEvents: [],       // bookings + tasks from API (independent of FC visibility filters)
  lastSlots: [],          // last computed slots (for split assignment lookup)
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
    // Include displayed mini-calendar month + dateFilter month
    if (S.calYear != null && S.calMonth != null) {
      months.add(S.calYear + '-' + pad2(S.calMonth + 1));
    }
    if (S.dateFilter !== 'all') {
      const parts = S.dateFilter.split('-');
      months.add(parts[0] + '-' + parts[1]);
    }
    const headers = { 'Authorization': 'Bearer ' + api.getToken() };
    // B5-fix : Promise.all parallel au lieu de await sérial par mois.
    const monthResults = await Promise.all(Array.from(months).map(m =>
      fetch('/api/planning/absences?month=' + m, { headers })
        .then(r => r.ok ? r.json().catch(() => ({})) : {})
        .catch(() => ({}))
    ));
    const all = monthResults.flatMap(d => d.absences || []);
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
    // Include displayed mini-calendar year + dateFilter year
    if (S.calYear != null) years.add(S.calYear);
    if (S.dateFilter !== 'all') years.add(parseInt(S.dateFilter.split('-')[0]));
    const headers = { 'Authorization': 'Bearer ' + api.getToken() };
    // B5-fix : Promise.all parallel au lieu de await sérial par année.
    const yearResults = await Promise.all(Array.from(years).map(y =>
      fetch('/api/availabilities/holidays?year=' + y, { headers })
        .then(r => r.ok ? r.json().catch(() => []) : [])
        .catch(() => [])
    ));
    const set = new Set();
    yearResults.flat().forEach(h => { if (h && h.date) set.add(h.date.slice(0, 10)); });
    S.holidays = set;
  } catch (e) {
    console.warn('SO: failed to load holidays', e);
    S.holidays = new Set();
  }
}

/**
 * Fetch bookings + tasks directly from API.
 * Independent of FullCalendar's event store — ensures ALL practitioners
 * and ALL statuses (pending_deposit, pending, etc.) are included
 * regardless of FC filters or visibility toggles.
 */
async function soFetchEvents() {
  const cal = calState.fcCal;
  if (!cal) return;
  try {
    let from = new Date(cal.view.currentStart);
    let to = new Date(cal.view.currentEnd);
    // Expand range to include filtered date if outside FC view
    if (S.dateFilter !== 'all') {
      const fd = new Date(S.dateFilter + 'T00:00:00');
      const fn = new Date(fd); fn.setDate(fn.getDate() + 1);
      if (fd < from) from = fd;
      if (fn > to) to = fn;
    }
    const headers = { 'Authorization': 'Bearer ' + api.getToken() };
    const qs = 'from=' + encodeURIComponent(from.toISOString()) + '&to=' + encodeURIComponent(to.toISOString());
    const [bkRes, tkRes] = await Promise.all([
      fetch('/api/bookings?' + qs, { headers }).then(r => r.ok ? r.json() : { bookings: [] }),
      fetch('/api/tasks?' + qs, { headers }).then(r => r.ok ? r.json() : { tasks: [] }),
    ]);
    const events = [];
    (bkRes.bookings || []).forEach(bk => {
      events.push({
        start: new Date(bk.start_at), end: new Date(bk.end_at),
        practitioner_id: String(bk.practitioner_id), status: bk.status,
        _isTask: false, id: bk.id,
        processing_time: parseInt(bk.processing_time) || 0,
        processing_start: parseInt(bk.processing_start) || 0,
        buffer_before_min: parseInt(bk.buffer_before_min) || 0,
      });
    });
    (tkRes.tasks || []).forEach(tk => {
      if (tk.status === 'cancelled') return;
      events.push({
        start: new Date(tk.start_at), end: new Date(tk.end_at),
        practitioner_id: String(tk.practitioner_id), status: tk.status,
        _isTask: true, id: tk.id,
        processing_time: 0, processing_start: 0, buffer_before_min: 0,
      });
    });
    S.cachedEvents = events;
  } catch (e) {
    console.warn('SO: failed to fetch events', e);
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

/** Check if selected services need split across multiple practitioners */
function soNeedsSplitMode() {
  if (S.selectedServices.length <= 1) return false;
  // Check if any single practitioner covers ALL services
  return !calState.fcPractitioners.some(p => soCanPracDoServices(p.id));
}

/** For each service, find which practitioners can do it */
function soGetServicePractitioners(svcId) {
  const full = calState.fcServices.find(s => String(s.id) === String(svcId));
  if (!full?.practitioner_ids || full.practitioner_ids.length === 0) {
    return calState.fcPractitioners.map(p => p.id);
  }
  return full.practitioner_ids.map(String);
}

/* ═══════════════════════════════════════════════════════════
   7. SCORING ALGORITHM
   ═══════════════════════════════════════════════════════════ */

function soFindSlots() {
  const cal = calState.fcCal;
  if (!cal || S.selectedServices.length === 0) return { slots: [], scheduleConflict: false, skippedDayCount: 0, totalDayCount: 0 };

  const rawDuration = S.selectedServices.reduce((s, svc) => s + svc.duration_min, 0);
  const bufBefore = S.selectedServices.length > 0 ? (S.selectedServices[0].buffer_before_min || 0) : 0;
  const bufAfter = S.selectedServices.length > 0 ? (S.selectedServices[S.selectedServices.length - 1].buffer_after_min || 0) : 0;
  const totalDuration = rawDuration + bufBefore + bufAfter;
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

  const pracNames = {}, pracColors = {};
  calState.fcPractitioners.forEach(p => { pracNames[p.id] = p.display_name; pracColors[p.id] = p.color || 'var(--primary)'; });

  const allCalEvents = S.cachedEvents;
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

    // ── Split mode: multi-practitioner combo ──
    const isSplit = S.pracId === 'all' && soNeedsSplitMode();

    if (isSplit) {
      // For split mode: find time slots where each service's practitioner is free in sequence
      const step = soGetStep();
      const minStart = dateStr === todayStr ? nowMin : 0;
      const dayStartDt = new Date(dateStr + 'T00:00:00');
      const dayEndDt = new Date(dateStr + 'T23:59:59');

      // Build per-practitioner free windows for this day
      const pracFree = {};
      const pracOccupied = {};
      for (const p of calState.fcPractitioners) {
        const pid = p.id;
        const absPeriod = soGetAbsencePeriod(pid, dateStr);
        if (absPeriod === 'full') continue;
        const pracHours = calState.fcPracBusinessHours[pid] || calState.fcBusinessHours || [];
        const todayHours = pracHours.filter(h => h.daysOfWeek.includes(jsDay));
        if (todayHours.length === 0) continue;
        let ww = todayHours.map(h => {
          const [sh, sm] = h.startTime.split(':').map(Number);
          const [eh, em] = h.endTime.split(':').map(Number);
          return { start: sh * 60 + sm, end: eh * 60 + em };
        }).sort((a, b) => a.start - b.start);
        if (absPeriod) { ww = soFilterWorkWindows(ww, absPeriod); if (ww.length === 0) continue; }
        if (S.timePref === 'matin') ww = ww.map(w => ({ start: w.start, end: Math.min(w.end, 780) })).filter(w => w.start < w.end);
        else if (S.timePref === 'apresmidi') ww = ww.map(w => ({ start: Math.max(w.start, 780), end: w.end })).filter(w => w.start < w.end);
        else if (S.timePref === 'heure') ww = ww.map(w => ({ start: Math.max(w.start, S.timeFrom), end: w.end })).filter(w => w.start < w.end);
        if (ww.length === 0) continue;

        const events = allCalEvents.filter(ev => {
          if (['cancelled', 'no_show'].includes(ev.status)) return false;
          if (ev.status === 'pending' && ev.start && ev.start <= now) return false;
          if (ev.practitioner_id !== String(pid)) return false;
          return ev.start < dayEndDt && ev.end > dayStartDt;
        });
        const occ = events.map(ev => {
          const s2 = ev.start.getHours() * 60 + ev.start.getMinutes();
          let e2 = ev.end.getHours() * 60 + ev.end.getMinutes();
          if (localDate(ev.end) !== dateStr) e2 = 1440;
          return { start: s2, end: e2 };
        }).sort((a, b) => a.start - b.start);
        pracOccupied[pid] = occ;

        // Compute free windows
        const free = [];
        ww.forEach(w => {
          const segs = occ.filter(o => o.end > w.start && o.start < w.end)
            .map(o => ({ start: Math.max(o.start, w.start), end: Math.min(o.end, w.end) }))
            .sort((a, b) => a.start - b.start);
          let cursor = w.start;
          segs.forEach(seg => {
            if (seg.start > cursor) free.push({ start: cursor, end: seg.start });
            cursor = Math.max(cursor, seg.end);
          });
          if (cursor < w.end) free.push({ start: cursor, end: w.end });
        });
        pracFree[pid] = free;
      }

      // For each service, determine which practitioners can do it
      const svcPracs = S.selectedServices.map(svc => soGetServicePractitioners(svc.id).filter(pid => pracFree[pid]));

      // Check that every service has at least one available practitioner
      if (svcPracs.every(pp => pp.length > 0)) {
        // Use first service's practitioners as the scan base
        const firstSvcDur = S.selectedServices[0].duration_min + (S.selectedServices[0].buffer_before_min || 0);
        for (const firstPracId of svcPracs[0]) {
          const freeWins = pracFree[firstPracId];
          if (!freeWins) continue;
          for (const gap of freeWins) {
            for (let t = Math.max(gap.start, minStart); t + firstSvcDur <= gap.end; t += step) {
              // Try to chain all services starting at t
              let cursor = t;
              let valid = true;
              const assignments = [];
              for (let si = 0; si < S.selectedServices.length; si++) {
                const svc = S.selectedServices[si];
                const dur = svc.duration_min + (si === 0 ? (svc.buffer_before_min || 0) : 0) + (si === S.selectedServices.length - 1 ? (svc.buffer_after_min || 0) : 0);
                // Find a practitioner available for [cursor, cursor+dur]
                let found = false;
                for (const pid of svcPracs[si]) {
                  const occ = pracOccupied[pid] || [];
                  const hasConflict = occ.some(o => o.start < cursor + dur && o.end > cursor);
                  // Also check practitioner works at this time
                  const inFree = (pracFree[pid] || []).some(f => f.start <= cursor && f.end >= cursor + dur);
                  if (!hasConflict && inFree) {
                    assignments.push({ svcId: svc.id, pracId: pid });
                    found = true;
                    break;
                  }
                }
                if (!found) { valid = false; break; }
                cursor += dur;
              }
              if (valid) {
                // Build practitioner label: "Ashley + Veronique"
                const uniquePracs = [...new Set(assignments.map(a => a.pracId))];
                const splitLabel = uniquePracs.map(pid => pracNames[pid] || '').join(' + ');
                const splitColor = pracColors[assignments[0].pracId] || 'var(--primary)';
                allResults.push({
                  start: t, end: cursor, score: 60,
                  type: 'split', label: 'Multi-praticien', icon: ICO.gap,
                  pracId: 'split', pracName: splitLabel, pracColor: splitColor,
                  dateStr, dayLabel: dayLabel(dateStr), poseTime: totalPoseTime,
                  _assignments: assignments,
                });
              }
            }
          }
        }
      }
    } else {
      // ── Normal mode: single practitioner covers all ──
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
          if (['cancelled', 'no_show'].includes(ev.status)) return false;
          if (ev.status === 'pending' && ev.start && ev.start <= now) return false;
          if (ev.practitioner_id !== String(pracId)) return false;
          return ev.start < dayEndDt && ev.end > dayStartDt;
        }).sort((a, b) => a.start - b.start);

        const minStart = dateStr === todayStr ? nowMin : 0;
        const step = soGetStep();
        const daySlots = _soCalcDaySlots(events, workWindows, totalDuration, totalPoseTime, pracId, dateStr, pracNames[pracId] || '', pracColors[pracId] || 'var(--primary)', minStart, step);
        allResults.push(...daySlots);
      }
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

function _soCalcDaySlots(events, workWindows, totalDuration, totalPoseTime, pracId, dateStr, pracName, pracColor, minStartMin, step) {
  const occupied = events.map(ev => {
    const s = ev.start.getHours() * 60 + ev.start.getMinutes();
    let e = ev.end.getHours() * 60 + ev.end.getMinutes();
    // Fix: event ending at midnight (00:00 next day) produces e=0 — clamp to 1440
    if (localDate(ev.end) !== dateStr) e = 1440;
    return { start: s, end: e, ev };
  }).sort((a, b) => a.start - b.start);

  const poseWindows = [];
  events.forEach(ev => {
    if (ev._isTask) return; // tasks have no pose windows
    const pt = ev.processing_time || 0;
    const ps = ev.processing_start || 0;
    const buf = ev.buffer_before_min || 0;
    if (pt <= 0) return;
    const evStartMin = ev.start.getHours() * 60 + ev.start.getMinutes();
    const poseStart = evStartMin + buf + ps;
    const poseEnd = poseStart + pt;
    const childRanges = events.filter(ch => {
      if (ch === ev) return false;
      const cs = ch.start.getHours() * 60 + ch.start.getMinutes();
      let ce = ch.end.getHours() * 60 + ch.end.getMinutes();
      if (localDate(ch.end) !== dateStr) ce = 1440;
      return cs >= poseStart && ce <= poseEnd;
    }).map(ch => {
      let ce = ch.end.getHours() * 60 + ch.end.getMinutes();
      if (localDate(ch.end) !== dateStr) ce = 1440;
      return { start: ch.start.getHours() * 60 + ch.start.getMinutes(), end: ce };
    }).sort((a, b) => a.start - b.start);
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
        pracId, pracName, pracColor, dateStr, dayLabel: dl, poseTime: totalPoseTime,
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
        pracId, pracName, pracColor, dateStr, dayLabel: dl, poseTime: totalPoseTime,
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
      <div class="so-header-actions">
        <button class="so-clear-btn" onclick="soClearAll()" title="Tout effacer">${ICO.clear} Clear</button>
        <button class="so-panel-close" onclick="soDeactivate()" title="Fermer">${ICO.close}</button>
      </div>
    </div>
    <div class="so-modal-body">
      <div class="so-col-config" id="soColConfig"></div>
      <div class="so-divider"></div>
      <div class="so-col-services" id="soColServices"></div>
      <div class="so-divider"></div>
      <div class="so-right" id="soRight"></div>
    </div>
  </div>`;

  document.body.appendChild(overlay);
}

// ── Central render ──
function soRender() {
  if (!document.getElementById('soOverlay')) return;
  soRenderConfig();
  soRenderServices();
  soRenderRight();
}

// ── Column 1: Config (practitioner, calendar, time) ──
function soRenderConfig() {
  const el = document.getElementById('soColConfig');
  if (!el) return;

  let html = '';

  // ── Praticien ──
  html += `<div class="so-field"><label class="so-label">Praticien</label>`;
  html += `<select class="so-select" id="soPracSel" onchange="soPracChanged()">`;
  html += `<option value="all"${S.pracId === 'all' ? ' selected' : ''}>Tous les praticiens</option>`;
  calState.fcPractitioners.forEach(p => {
    html += `<option value="${p.id}" ${String(p.id) === String(S.pracId) ? 'selected' : ''}>${esc(p.display_name)}</option>`;
  });
  html += `</select></div>`;

  // ── Calendrier + horaire ──
  html += soRenderDayFilterHTML();
  html += soRenderTimePrefHTML();

  // ── Prestation picker ──
  const effectivePracId = S.pracId === 'all' ? null : S.pracId;
  const cats = window.fcGetServiceCategories ? window.fcGetServiceCategories(effectivePracId) : [];
  html += `<div class="so-config-sep"></div>`;
  html += `<div class="so-field"><label class="so-label">Cat\u00e9gorie</label>`;
  html += `<select class="so-select" id="soCatSel" onchange="soCatChanged()">`;
  html += `<option value="">\u2014 Toutes \u2014</option>`;
  cats.forEach(c => { html += `<option value="${esc(c)}">${esc(c)}</option>`; });
  html += `</select></div>`;
  const services = window.fcGetFilteredServices ? window.fcGetFilteredServices(effectivePracId, '') : [];
  html += `<div class="so-field"><label class="so-label">Prestation</label>`;
  html += `<select class="so-select" id="soSvcSel" onchange="soSvcChanged()">`;
  html += `<option value="">\u2014 Choisir \u2014</option>`;
  services.forEach(s => {
    const durLabel = window.svcDurPriceLabel ? window.svcDurPriceLabel(s) : (s.duration_min + ' min');
    html += `<option value="${s.id}">${esc(s.name)} (${durLabel})</option>`;
  });
  html += `</select></div>`;
  html += `<div class="so-field" id="soVarWrap" style="display:none"><label class="so-label">Variante</label>`;
  html += `<select class="so-select" id="soVarSel" onchange="soVarChanged()"></select></div>`;
  html += `<button class="so-add-btn" id="soAddBtn" onclick="soAddService()" disabled>${ICO.plus} Ajouter</button>`;

  el.innerHTML = html;
}

// ── Column 2: Selected services ──
function soRenderServices() {
  const el = document.getElementById('soColServices');
  if (!el) return;

  const count = S.selectedServices.length;
  let html = `<div class="so-svc-header"><span class="so-label">Prestations</span>${count > 0 ? `<span class="so-svc-count">${count}</span>` : ''}</div>`;
  html += `<div class="so-svc-list" id="soSelectedList">${soSelectedServicesHTML()}</div>`;
  html += `<div class="so-total" id="soTotal">${soTotalHTML()}</div>`;

  el.innerHTML = html;
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
    // Check if all selected practitioners are absent this day
    const isAbsent = ds >= todayStr && !isHoliday && S.pracId !== 'all'
      ? soGetAbsencePeriod(S.pracId, ds) === 'full'
      : false;
    const cls = ['so-cal-day'];
    let clickable = true;
    if (ds < todayStr) { cls.push('so-cal-day--past'); clickable = false; }
    if (isHoliday) { cls.push('so-cal-day--holiday'); clickable = false; }
    if (isAbsent) { cls.push('so-cal-day--absent'); }
    if (ds === todayStr) cls.push('so-cal-day--today');
    if (clickable) cls.push(visibleDates.has(ds) ? 'so-cal-day--in-range' : 'so-cal-day--out-range');
    if (S.dateFilter === ds) cls.push('so-cal-day--selected');
    const onclick = clickable ? ` onclick="soCalDayClick('${ds}')"` : '';
    const title = isHoliday ? ' title="Jour férié"' : (isAbsent ? ' title="En congé"' : '');
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
  html += `<input type="text" class="so-select m-time" id="soTimeFrom" value="${timeVal}" onchange="soTimeFromChanged()">`;
  html += '</div>';
  html += '</div>';
  return html;
}

function soSelectedServicesHTML() {
  if (S.selectedServices.length === 0) {
    return `<div class="so-svc-empty">${ICO.empty}<span>Ajoutez des prestations<br>depuis le panneau de gauche</span></div>`;
  }
  let html = '';
  S.selectedServices.forEach((svc, idx) => {
    const poseLabel = svc.processing_time > 0 ? ` <span class="so-svc-pose">(+${svc.processing_time}min pose)</span>` : '';
    const priceLabel = svc.price_cents > 0 ? `<span class="so-svc-price">${(svc.price_cents / 100).toFixed(2).replace('.', ',')}\u20ac</span>` : '';
    const schedLabel = soGetScheduleLabel(svc.id);
    const schedTag = schedLabel ? ` <span class="so-svc-sched">${schedLabel}</span>` : '';
    html += `<div class="so-svc-card">
      <span class="so-svc-dot" style="background:${svc.color}"></span>
      <div class="so-svc-info">
        <span class="so-svc-name">${esc(svc.name)}</span>
        <span class="so-svc-dur">${svc.duration_min}min${poseLabel}${schedTag}</span>
      </div>
      ${priceLabel}
      <button class="so-svc-rm" onclick="soRemoveService(${idx})" title="Retirer">${ICO.remove}</button>
    </div>`;
  });
  return html;
}

function soTotalHTML() {
  const dur = S.selectedServices.reduce((s, svc) => s + svc.duration_min, 0);
  if (dur === 0) return '';
  const poseT = S.selectedServices.reduce((s, svc) => s + (svc.processing_time || 0), 0);
  const totalCents = S.selectedServices.reduce((s, svc) => s + (svc.price_cents || 0), 0);
  let html = `<div class="so-total-row"><span>Durée totale</span><strong>${fmtMin(dur)}</strong></div>`;
  if (poseT > 0) html += `<div class="so-total-row"><span>Dont pose</span><span class="so-svc-pose">${fmtMin(poseT)}</span></div>`;
  if (totalCents > 0) html += `<div class="so-total-row so-total-price"><span>Total</span><strong>${(totalCents / 100).toFixed(2).replace('.', ',')}\u20ac</strong></div>`;
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
  S.lastSlots = slots;

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
      html += `<div class="so-slot-card" data-tier="${tier}" style="--prac-color:${slot.pracColor}" onclick="soFillSlot(${slot.start},'${slot.pracId}','${slot.dateStr}')">
        <div class="so-slot-top">
          <div class="so-slot-left">
            <div class="so-slot-time">${timeStr(slot.start)} \u2013 ${timeStr(slot.end)}</div>
            ${showPrac ? `<span class="so-slot-prac"><span class="so-prac-dot" style="background:${slot.pracColor}"></span>${esc(slot.pracName)}</span>` : ''}
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
  initTimeInputs(right);
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

async function soCalDayClick(dateStr) {
  S.dateFilter = dateStr;
  await Promise.all([soLoadAbsences(), soLoadHolidays(), soFetchEvents()]);
  soRender();
}

function soCalReset() {
  S.dateFilter = 'all';
  soRender();
}

async function soCalPrev() {
  S.calMonth--;
  if (S.calMonth < 0) { S.calMonth = 11; S.calYear--; }
  await Promise.all([soLoadAbsences(), soLoadHolidays()]);
  soRender();
}

async function soCalNext() {
  S.calMonth++;
  if (S.calMonth > 11) { S.calMonth = 0; S.calYear++; }
  await Promise.all([soLoadAbsences(), soLoadHolidays()]);
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
      `<option value="${v.id}">${esc(v.name)} (${v.duration_min} min${v.price_cents ? ' \u00b7 ' + (v.price_cents / 100).toFixed(2).replace('.',',') + '\u20ac' : ''})</option>`
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

  // Refresh selected list + total + count badge + right panel
  soUpdateServicesDom();
  soRenderRight();
}

function soRemoveService(idx) {
  S.selectedServices.splice(idx, 1);
  soUpdateServicesDom();
  soUpdateAddBtn();
  soRenderRight();
}

function soUpdateServicesDom() {
  const list = document.getElementById('soSelectedList');
  if (list) list.innerHTML = soSelectedServicesHTML();
  const total = document.getElementById('soTotal');
  if (total) total.innerHTML = soTotalHTML();
  const badge = document.querySelector('.so-svc-count');
  const count = S.selectedServices.length;
  if (badge) badge.textContent = count > 0 ? count : '';
  if (badge) badge.style.display = count > 0 ? '' : 'none';
}

/* ═══════════════════════════════════════════════════════════
   10. FILL SLOT → QUICK-CREATE
   ═══════════════════════════════════════════════════════════ */

function soFillSlot(startMin, slotPracId, dateStr) {
  const startStr = dateStr + 'T' + timeStr(startMin) + ':00';
  const _services = [...S.selectedServices];

  // For split slots, look up the assignments from last computed slots
  let _splitAssignments = null;
  let _pracId = slotPracId || S.pracId;
  if (slotPracId === 'split') {
    const match = S.lastSlots.find(s => s.start === startMin && s.dateStr === dateStr && s.pracId === 'split');
    if (match && match._assignments) {
      _splitAssignments = match._assignments;
      _pracId = _splitAssignments[0].pracId; // use first service's practitioner as primary
    }
  }

  const overlay = document.getElementById('soOverlay');
  if (overlay) overlay.style.display = 'none';

  fcOpenQuickCreate(startStr);

  const qcModal = document.getElementById('calCreateModal');
  if (qcModal) {
    const observer = new MutationObserver(() => {
      if (!qcModal.classList.contains('open')) {
        observer.disconnect();
        const booked = qcModal._soBooked;
        qcModal._soBooked = false;
        // Only clear selections if a booking was actually created
        if (booked) S.selectedServices = [];
        const so = document.getElementById('soOverlay');
        if (so) { so.style.display = ''; soRender(); }
      }
    });
    observer.observe(qcModal, { attributes: true, attributeFilter: ['class'] });
  }

  requestAnimationFrame(() => {
    const qcPrac = document.getElementById('qcPrac');
    if (qcPrac && _pracId && _pracId !== 'all' && _pracId !== 'split') {
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
  if (!isPro()) { gToast('Le smart optimizer est disponible avec le plan Pro', 'error'); return; }
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
  await Promise.all([soLoadAbsences(), soLoadHolidays(), soFetchEvents()]);
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
  S.cachedEvents = [];
  S.calYear = null;
  S.calMonth = null;
  S.timePref = 'all';
  S.timeFrom = 600;
  document.getElementById('soToggleBtn')?.classList.remove('active');
  document.getElementById('soOverlay')?.remove();
}

function soClearAll() {
  S.selectedServices = [];
  S.dateFilter = 'all';
  S.calYear = null;
  S.calMonth = null;
  S.timePref = 'all';
  S.timeFrom = 600;
  soRender();
}

async function soOnDatesSet() {
  if (!S.active) return;
  await Promise.all([soLoadAbsences(), soLoadHolidays(), soFetchEvents()]);
  soRender();
}

// Light refresh: re-fetch events + re-render slots (right panel only)
async function soRefreshSlots() {
  if (!S.active) return;
  await soFetchEvents();
  soRenderRight();
}

/* ═══════════════════════════════════════════════════════════
   12. BRIDGE + EXPORTS
   ═══════════════════════════════════════════════════════════ */

bridge({ soToggleMode, soDeactivate, soClearAll, soAddService, soRemoveService, soPracChanged, soCalDayClick, soCalReset, soCalPrev, soCalNext, soSetTimePref, soTimeFromChanged, soCatChanged, soSvcChanged, soVarChanged, soFillSlot, soRenderSuggestions, soOnDatesSet });

export { soIsActive, soToggleMode, soDeactivate, soOnDatesSet, soRefreshSlots };
