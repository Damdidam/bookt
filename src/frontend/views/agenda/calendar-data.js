/**
 * Calendar Data — fetches bookings from API, normalizes them into FC events.
 * Pure pipeline: fetch → separate → detect pose → build events → filter → inject featured.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { api, calState } from '../../state.js';
import { fcHexAlpha } from './calendar-init.js';
import { fsBuildBackgroundEvents } from './calendar-featured.js';
import { gaBuildBackgroundEvents } from './gap-analyzer.js';

const DEFAULT_ACCENT = '#0D7377';

// ── Pure helpers ──

function accentFor(b) {
  if (b.booking_color) return b.booking_color;
  return calState.fcColorMode === 'practitioner'
    ? (b.practitioner_color || b.service_color || DEFAULT_ACCENT)
    : (b.service_color || b.practitioner_color || DEFAULT_ACCENT);
}

/** Separate bookings into grouped dict and singles array. */
export function separateGroupedAndSingles(bookings) {
  const grouped = {}, singles = [];
  bookings.forEach(b => {
    if (b.group_id) {
      if (!grouped[b.group_id]) grouped[b.group_id] = [];
      grouped[b.group_id].push(b);
    } else { singles.push(b); }
  });
  return { grouped, singles };
}

/** Detect bookings that fall entirely within another booking's processing (pose) window. */
export function detectPoseChildren(singles) {
  const poseParentBookings = singles.filter(b => parseInt(b.processing_time) > 0 && !['cancelled','no_show'].includes(b.status));
  const poseChildMap = {}; // parent booking id -> [child bookings]
  const poseChildIds = new Set();
  singles.forEach(b => {
    if (parseInt(b.processing_time) > 0) return;
    if (['cancelled','no_show'].includes(b.status)) return;
    const bStart = new Date(b.start_at).getTime();
    const bEnd = new Date(b.end_at).getTime();
    for (var pi = 0; pi < poseParentBookings.length; pi++) {
      var par = poseParentBookings[pi];
      if (String(par.practitioner_id) !== String(b.practitioner_id)) continue;
      var parStart = new Date(par.start_at).getTime();
      var parPs = parseInt(par.processing_start) || 0;
      var parBuf = parseInt(par.buffer_before_min) || 0;
      var parPt = parseInt(par.processing_time) || 0;
      var poseStart = parStart + (parBuf + parPs) * 60000;
      var poseEnd = poseStart + parPt * 60000;
      if (bStart >= poseStart && bEnd <= poseEnd) {
        if (!poseChildMap[par.id]) poseChildMap[par.id] = [];
        poseChildMap[par.id].push(b);
        poseChildIds.add(b.id);
        break;
      }
    }
  });
  return { poseChildMap, poseChildIds };
}

/** Build FC events from single (non-grouped) bookings.
 *  ALL singles become FC events (including pose-children). */
export function buildSingleEvents(singles, poseChildIds, poseChildMap) {
  return singles.map(b => {
    const frozen = ['completed', 'cancelled', 'no_show'].includes(b.status);
    const accent = accentFor(b);
    const pt = parseInt(b.processing_time) || 0;
    const ps = parseInt(b.processing_start) || 0;
    const props = { ...b, _accent: accent };
    // Mark pose-children so eventDidMount can reposition them visually
    if (poseChildIds && poseChildIds.has(b.id)) {
      for (const parentId of Object.keys(poseChildMap)) {
        if (poseChildMap[parentId].some(c => c.id === b.id)) {
          props._isPoseChild = true;
          props._poseParentId = parentId;
          break;
        }
      }
    }
    // Mark pose-parents that have children (so eventDidMount can force full width)
    if (poseChildMap && poseChildMap[b.id]) {
      props._hasPoseChildren = true;
    }
    if (pt > 0) {
      const totalMin = Math.round((new Date(b.end_at) - new Date(b.start_at)) / 60000) || 1;
      const buf = parseInt(b.buffer_before_min) || 0;
      props._poseStartPct = Math.min(((buf + ps) / totalMin) * 100, 100);
      props._poseEndPct = Math.min(((buf + ps + pt) / totalMin) * 100, 100);
    }
    const ev = {
      id: b.id, resourceId: String(b.practitioner_id),
      title: b.client_name || 'Sans nom',
      start: b.start_at, end: b.end_at,
      backgroundColor: fcHexAlpha(accent, 0.1),
      borderColor: accent, textColor: accent,
      editable: !frozen && !b.locked, durationEditable: !frozen && !b.locked,
      extendedProps: props
    };
    // Cancelled/completed/no_show events must never block drag & drop of other events
    if (frozen) ev.overlap = true;
    return ev;
  });
}

/** Build FC events from grouped bookings (single container per group). */
export function buildGroupEvents(grouped) {
  return Object.keys(grouped).map(gid => {
    const members = grouped[gid].sort((a, b) => (a.group_order || 0) - (b.group_order || 0));
    const first = members[0];
    const accent = accentFor(first);
    const anyFrozen = members.some(m => ['completed', 'cancelled', 'no_show'].includes(m.status));
    const allFrozen = members.every(m => ['completed', 'cancelled', 'no_show'].includes(m.status));
    const anyLocked = members.some(m => m.locked);
    const minStart = members.reduce((mn, m) => m.start_at < mn ? m.start_at : mn, members[0].start_at);
    const maxEnd = members.reduce((mx, m) => m.end_at > mx ? m.end_at : mx, members[0].end_at);
    const gev = {
      id: 'group_' + gid, resourceId: String(first.practitioner_id),
      title: first.client_name || 'Sans nom',
      start: minStart, end: maxEnd,
      backgroundColor: fcHexAlpha(accent, 0.1), borderColor: accent, textColor: accent,
      editable: !anyFrozen && !anyLocked, durationEditable: false,
      extendedProps: {
        _isGroup: true, _groupId: gid, _accent: accent,
        _members: members.map(m => ({ ...m, _accent: accentFor(m) })),
        client_name: first.client_name,
        practitioner_id: first.practitioner_id,
        status: first.status
      }
    };
    // All-cancelled/completed/no_show groups must never block drag & drop of other events
    if (allFrozen) gev.overlap = true;
    return gev;
  });
}

/** Build FC events from internal tasks. */
export function buildTaskEvents(tasks) {
  return tasks.map(t => {
    const accent = t.color || '#6B7280';
    const frozen = t.status === 'cancelled';
    return {
      id: 'task_' + t.id, resourceId: String(t.practitioner_id),
      title: t.title,
      start: t.start_at, end: t.end_at,
      backgroundColor: fcHexAlpha(accent, 0.08),
      borderColor: accent, textColor: accent,
      editable: !frozen, durationEditable: !frozen,
      extendedProps: { ...t, _isTask: true, _accent: accent }
    };
  });
}

/** Filter events by status visibility and category visibility. */
export function applyVisibilityFilters(events) {
  return events.filter(ev => {
    const p = ev.extendedProps;
    // Tasks: always visible (they block slots), only hide cancelled if toggle off
    if (p._isTask) {
      if (p.status === 'cancelled' && !calState.fcShowCancelled) return false;
      return true;
    }
    // Hide expired pending bookings (start_at already passed, not confirmed)
    const now = new Date();
    if (p.status === 'pending' && ev.start && ev.start <= now) return false;
    if (p._isGroup) {
      const members = p._members || [];
      // Hide group if all members are pending and start is past
      if (members.every(m => m.status === 'pending') && ev.start && ev.start <= now) return false;
      const allCancelled = members.every(m => m.status === 'cancelled');
      const allNoShow = members.every(m => m.status === 'no_show');
      const allPending = members.every(m => m.status === 'pending' || m.status === 'pending_deposit');
      if ((allCancelled || p.status === 'cancelled') && !calState.fcShowCancelled) return false;
      if ((allNoShow || p.status === 'no_show') && !calState.fcShowNoShow) return false;
      if ((allPending || p.status === 'pending' || p.status === 'pending_deposit') && !calState.fcShowPending) return false;
    } else {
      if (p.status === 'cancelled' && !calState.fcShowCancelled) return false;
      if (p.status === 'no_show' && !calState.fcShowNoShow) return false;
      if ((p.status === 'pending' || p.status === 'pending_deposit') && !calState.fcShowPending) return false;
    }
    // Category filter — for groups: show if ANY member matches a visible category
    if (calState.fcHiddenCategories && calState.fcHiddenCategories.size > 0) {
      if (p._isGroup) {
        const members = p._members || [];
        const anyVisible = members.some(m => !calState.fcHiddenCategories.has(m.service_category || ''));
        if (!anyVisible) return false;
      } else {
        if (calState.fcHiddenCategories.has(p.service_category || '')) return false;
      }
    }
    // Search filter (client name / phone / email)
    const sq = calState.calSearchQuery;
    if (sq) {
      if (p._isGroup) {
        const members = p._members || [];
        if (!members.some(m => (m.client_name || '').toLowerCase().includes(sq) || (m.client_phone || '').includes(sq) || (m.client_email || '').toLowerCase().includes(sq))) return false;
      } else if (!(p.client_name || '').toLowerCase().includes(sq) && !(p.client_phone || '').includes(sq) && !(p.client_email || '').toLowerCase().includes(sq)) {
        return false;
      }
    }
    return true;
  });
}

/** Compute minutes booked per practitioner (excluding cancelled/no_show). */
function computePracHours(bookings) {
  const pracMins = {};
  bookings.forEach(b => {
    if (['cancelled', 'no_show'].includes(b.status)) return;
    const mins = (new Date(b.end_at) - new Date(b.start_at)) / 60000;
    if (mins > 0) pracMins[b.practitioner_id] = (pracMins[b.practitioner_id] || 0) + mins;
  });
  return pracMins;
}

// ── Fill rate ──

function updatePracHours() {
  const hrs = calState.fcPracHours || {};
  document.querySelectorAll('.prac-hours[data-prac-id]').forEach(el => {
    const id = el.dataset.pracId;
    if (id === 'all') return;
    const mins = hrs[id] || 0;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    el.textContent = m > 0 ? ' · ' + h + 'h' + String(m).padStart(2, '0') : ' · ' + h + 'h';
    el.style.opacity = mins === 0 ? '.4' : '1';
  });
  const total = Object.values(hrs).reduce((s, v) => s + v, 0);
  document.querySelectorAll('.prac-hours[data-prac-id="all"]').forEach(el => {
    const h = Math.floor(total / 60);
    const m = Math.round(total % 60);
    el.textContent = m > 0 ? ' · ' + h + 'h' + String(m).padStart(2, '0') : ' · ' + h + 'h';
  });
  computeFillRate();
}

function computeFillRate() {
  const cal = calState.fcCal;
  if (!cal) return;
  const view = cal.view;
  if (!view) return;
  const viewStart = view.currentStart;
  const viewEnd = view.currentEnd;
  const pracBH = calState.fcPracBusinessHours || {};
  const bookedMins = calState.fcPracHours || {};

  const timeToMinutes = t => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const pracStats = {};
  let totalAvail = 0, totalBooked = 0;

  const d = new Date(viewStart);
  while (d < viewEnd) {
    const fcDay = d.getDay();
    for (const [pracId, slots] of Object.entries(pracBH)) {
      const daySlots = (slots || []).filter(s => s.daysOfWeek && s.daysOfWeek.includes(fcDay));
      let availMins = 0;
      daySlots.forEach(s => {
        const diff = timeToMinutes(s.endTime) - timeToMinutes(s.startTime);
        if (diff > 0) availMins += diff;
      });
      if (availMins > 0) {
        if (!pracStats[pracId]) pracStats[pracId] = { avail: 0, booked: 0 };
        pracStats[pracId].avail += availMins;
        totalAvail += availMins;
      }
    }
    d.setDate(d.getDate() + 1);
  }

  for (const [pracId, mins] of Object.entries(bookedMins)) {
    if (!pracStats[pracId]) pracStats[pracId] = { avail: 0, booked: 0 };
    pracStats[pracId].booked += mins;
    totalBooked += mins;
  }

  updateFillRateDOM(totalAvail, totalBooked, pracStats);
}

function fillColor(pct) {
  if (pct >= 75) return 'var(--green)';
  if (pct >= 40) return 'var(--gold)';
  return 'var(--text-4)';
}

function updateFillRateDOM(totalAvail, totalBooked, pracStats) {
  const barEl = document.getElementById('fillBarInner');

  // Update full-width bar
  if (barEl) {
    if (totalAvail === 0) {
      barEl.style.width = '0%';
    } else {
      const globalPct = Math.min(Math.round((totalBooked / totalAvail) * 100), 100);
      barEl.style.width = globalPct + '%';
      barEl.style.background = fillColor(globalPct);
    }
  }

  // Update global fill % in "Tous" pill
  const allFill = document.querySelector('.prac-fill[data-fill-id="all"]');
  if (allFill) {
    if (totalAvail === 0) { allFill.textContent = ''; }
    else {
      const globalPct = Math.min(Math.round((totalBooked / totalAvail) * 100), 100);
      allFill.textContent = ' · ' + globalPct + '%';
      allFill.style.color = fillColor(globalPct);
    }
  }

  // Update per-practitioner fill % in pills
  const pracs = calState.fcPractitioners || [];
  pracs.forEach(p => {
    const el = document.querySelector(`.prac-fill[data-fill-id="${p.id}"]`);
    if (!el) return;
    const st = pracStats[p.id];
    if (!st || st.avail === 0) { el.textContent = ''; return; }
    const pct = Math.min(Math.round((st.booked / st.avail) * 100), 100);
    el.textContent = ' · ' + pct + '%';
    el.style.color = fillColor(pct);
  });
}

// ── Main callback ──

/**
 * Returns the `events` callback for FullCalendar (fetches bookings from API).
 * Pipeline: fetch → separate → detect pose → build events → filter → inject featured.
 */
function buildEventsCallback() {
  return function (info, successCb, failCb) {
    const params = new URLSearchParams({ from: info.startStr, to: info.endStr });
    if (calState.fcCurrentFilter !== 'all') params.set('practitioner_id', calState.fcCurrentFilter);

    // Side-fetch all practitioners' hours (only when filtered to a single prac)
    if (calState.fcCurrentFilter !== 'all') {
      const allParams = new URLSearchParams({ from: info.startStr, to: info.endStr });
      fetch('/api/bookings?' + allParams.toString(), { headers: { 'Authorization': 'Bearer ' + api.getToken() } })
        .then(r => r.ok ? r.json() : null).then(d => {
          if (!d) return;
          calState.fcPracHours = computePracHours(d.bookings || []);
          updatePracHours();
        }).catch(() => {});
    }

    const headers = { 'Authorization': 'Bearer ' + api.getToken() };
    const qstr = params.toString();
    Promise.all([
      fetch('/api/bookings?' + qstr, { headers }).then(r => r.ok ? r.json() : { bookings: [] }),
      fetch('/api/tasks?' + qstr, { headers }).then(r => r.ok ? r.json() : { tasks: [] })
    ]).then(([bData, tData]) => {
        const bookings = bData.bookings || [];
        const tasks = tData.tasks || [];

        // Compute hours per practitioner (when "all" filter — no side-fetch needed)
        if (calState.fcCurrentFilter === 'all') {
          calState.fcPracHours = computePracHours(bookings);
          updatePracHours();
        }

        // Pipeline
        const { grouped, singles } = separateGroupedAndSingles(bookings);
        const { poseChildMap, poseChildIds } = detectPoseChildren(singles);
        const singleEvents = buildSingleEvents(singles, poseChildIds, poseChildMap);
        const groupEvents = buildGroupEvents(grouped);
        const taskEvents = buildTaskEvents(tasks);
        const allEvents = singleEvents.concat(groupEvents).concat(taskEvents);
        const filtered = applyVisibilityFilters(allEvents);

        // Inject featured slots background events if mode is active
        const fsEvents = fsBuildBackgroundEvents();
        const gaEvents = gaBuildBackgroundEvents();
        successCb(filtered.concat(fsEvents).concat(gaEvents));
      }).catch(e => failCb(e));
  };
}

export { accentFor, buildEventsCallback };
