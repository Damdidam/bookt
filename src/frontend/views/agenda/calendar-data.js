/**
 * Calendar Data — fetches bookings from API, normalizes them into FC events.
 * Pure pipeline: fetch → separate → detect pose → build events → filter → inject featured.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { api, calState } from '../../state.js';
import { fcHexAlpha, fcDarkenHex } from './calendar-init.js';
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

/** Detect bookings AND tasks that fall entirely within another booking's processing (pose) window. */
export function detectPoseChildren(singles, tasks) {
  const poseParentBookings = singles.filter(b => parseInt(b.processing_time) > 0 && !['cancelled','no_show'].includes(b.status));
  const poseChildMap = {}; // parent booking id -> [child bookings]
  const poseChildIds = new Set();
  const taskPoseChildIds = new Set(); // task ids that are pose children
  const taskPoseParentMap = {}; // task id -> parent booking id
  // Round ms timestamp to nearest minute (avoids sub-second DB precision mismatches)
  const toMin = t => Math.round(t / 60000);

  // Helper: check if an item (booking or task) fits within any pose parent
  function checkAgainstPoseParents(item, pracId, itemId, isTask) {
    const bStartMin = toMin(new Date(item.start_at).getTime());
    const bEndMin = toMin(new Date(item.end_at).getTime());
    for (var pi = 0; pi < poseParentBookings.length; pi++) {
      var par = poseParentBookings[pi];
      if (String(par.id) === String(itemId)) continue; // self-check: don't detect self as child
      if (String(par.practitioner_id) !== String(pracId)) continue;
      var parStart = new Date(par.start_at).getTime();
      var parPs = parseInt(par.processing_start) || 0;
      var parBuf = parseInt(par.buffer_before_min) || 0;
      var parPt = parseInt(par.processing_time) || 0;
      var poseStartMin = toMin(parStart + (parBuf + parPs) * 60000);
      var poseEndMin = toMin(parStart + (parBuf + parPs + parPt) * 60000);
      if (bStartMin >= poseStartMin && bEndMin <= poseEndMin) {
        if (isTask) {
          taskPoseChildIds.add(itemId);
          taskPoseParentMap[itemId] = par.id;
        } else {
          if (!poseChildMap[par.id]) poseChildMap[par.id] = [];
          poseChildMap[par.id].push(item);
          poseChildIds.add(itemId);
        }
        break;
      }
    }
  }

  // Check bookings (including those with their own processing_time — they can
  // be children of another booking's pose window, e.g. coloration inside coloration)
  singles.forEach(b => {
    if (['cancelled','no_show'].includes(b.status)) return;
    checkAgainstPoseParents(b, b.practitioner_id, b.id, false);
  });

  // Check tasks
  if (tasks && tasks.length > 0) {
    tasks.forEach(t => {
      if (t.status === 'cancelled') return;
      checkAgainstPoseParents(t, t.practitioner_id, t.id, true);
    });
  }

  return { poseChildMap, poseChildIds, taskPoseChildIds, taskPoseParentMap };
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
      backgroundColor: fcHexAlpha(accent, 0.15),
      borderColor: accent, textColor: fcDarkenHex(accent, 0.7),
      editable: !frozen && !b.locked && !calState.fcLocked,
      startEditable: !frozen && !b.locked && !calState.fcLocked,
      durationEditable: !frozen && !b.locked && !calState.fcLocked,
      extendedProps: props
    };
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
    const anyLocked = members.some(m => m.locked);
    const minStart = members.reduce((mn, m) => m.start_at < mn ? m.start_at : mn, members[0].start_at);
    const maxEnd = members.reduce((mx, m) => m.end_at > mx ? m.end_at : mx, members[0].end_at);
    // Proportional border segments for multi-color groups
    const accents = members.map(m => accentFor(m));
    let _borderSegments = null;
    if (new Set(accents).size > 1) {
      const durations = members.map(m => Math.max((new Date(m.end_at) - new Date(m.start_at)) / 60000, 1));
      const total = durations.reduce((s, d) => s + d, 0);
      let cursor = 0;
      _borderSegments = members.map((m, i) => {
        const seg = { color: accents[i], from: cursor, to: cursor + durations[i] / total * 100 };
        cursor = seg.to;
        return seg;
      });
    }
    const gev = {
      id: 'group_' + gid, resourceId: String(first.practitioner_id),
      title: first.client_name || 'Sans nom',
      start: minStart, end: maxEnd,
      backgroundColor: fcHexAlpha(accent, 0.15), borderColor: accent, textColor: fcDarkenHex(accent, 0.7),
      editable: !anyFrozen && !anyLocked && !calState.fcLocked, startEditable: !anyFrozen && !anyLocked && !calState.fcLocked, durationEditable: false,
      extendedProps: {
        _isGroup: true, _groupId: gid, _accent: accent,
        _members: members.map(m => ({ ...m, _accent: accentFor(m) })),
        _borderSegments,
        client_name: first.client_name,
        client_is_vip: first.client_is_vip,
        client_notes: first.client_notes,
        practitioner_id: first.practitioner_id,
        practitioner_name: first.practitioner_name,
        processing_time: first.processing_time,
        processing_start: first.processing_start,
        buffer_before_min: first.buffer_before_min,
        internal_note: first.internal_note,
        notes_count: members.reduce((sum, m) => sum + (m.notes_count || 0), 0),
        first_note: (members.find(m => m.first_note) || {}).first_note || '',
        status: first.status
      }
    };
    return gev;
  });
}

/** Build FC events from internal tasks. */
export function buildTaskEvents(tasks, taskPoseChildIds, taskPoseParentMap) {
  return tasks.map(t => {
    const accent = t.color || '#6B7280';
    const frozen = t.status === 'cancelled';
    const props = { ...t, _isTask: true, _accent: accent };
    // Mark tasks that fall within a booking's pose window
    if (taskPoseChildIds && taskPoseChildIds.has(t.id)) {
      props._isPoseChild = true;
      props._poseParentId = taskPoseParentMap[t.id];
    }
    return {
      id: 'task_' + t.id, resourceId: String(t.practitioner_id),
      title: t.title,
      start: t.start_at, end: t.end_at,
      backgroundColor: fcHexAlpha(accent, 0.12),
      borderColor: accent, textColor: fcDarkenHex(accent, 0.7),
      editable: !frozen && !calState.fcLocked, startEditable: !frozen && !calState.fcLocked, durationEditable: !frozen && !calState.fcLocked,
      extendedProps: props
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
        const { poseChildMap, poseChildIds, taskPoseChildIds, taskPoseParentMap } = detectPoseChildren(singles, tasks);
        const singleEvents = buildSingleEvents(singles, poseChildIds, poseChildMap);
        const groupEvents = buildGroupEvents(grouped);
        const taskEvents = buildTaskEvents(tasks, taskPoseChildIds, taskPoseParentMap);
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
