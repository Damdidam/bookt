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

// ── Move restriction helper ──

function isEventLocked(b) {
  // Locked bookings block drag/resize — staff must unlock via modal first
  return !!b.locked;
}

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

/** Detect bookings AND tasks that fall entirely within another booking's processing (pose) window.
 *  Optimized: groups pose parents by practitioner_id to avoid O(n*m) full scans. */
export function detectPoseChildren(singles, tasks) {
  const poseChildMap = {}; // parent booking id -> [child bookings]
  const poseChildIds = new Set();
  const taskPoseChildIds = new Set(); // task ids that are pose children
  const taskPoseParentMap = {}; // task id -> parent booking id
  // Round ms timestamp to nearest minute (avoids sub-second DB precision mismatches)
  const toMin = t => Math.round(t / 60000);

  // Index pose parents by practitioner_id for O(1) lookup per practitioner
  const poseParentsByPrac = {};
  singles.forEach(b => {
    if (parseInt(b.processing_time) > 0 && !['cancelled','no_show'].includes(b.status)) {
      const pid = String(b.practitioner_id);
      if (!poseParentsByPrac[pid]) poseParentsByPrac[pid] = [];
      const parStart = new Date(b.start_at).getTime();
      const parPs = parseInt(b.processing_start) || 0;
      const parBuf = parseInt(b.buffer_before_min) || 0;
      const parPt = parseInt(b.processing_time) || 0;
      poseParentsByPrac[pid].push({
        id: b.id,
        poseStartMin: toMin(parStart + (parBuf + parPs) * 60000),
        poseEndMin: toMin(parStart + (parBuf + parPs + parPt) * 60000),
        booking: b
      });
    }
  });

  // No pose parents at all → fast exit
  if (Object.keys(poseParentsByPrac).length === 0) {
    return { poseChildMap, poseChildIds, taskPoseChildIds, taskPoseParentMap };
  }

  // Helper: check if an item fits within any pose parent of the same practitioner
  function checkAgainstPoseParents(item, pracId, itemId, isTask) {
    const parents = poseParentsByPrac[String(pracId)];
    if (!parents) return;
    const bStartMin = toMin(new Date(item.start_at).getTime());
    const bEndMin = toMin(new Date(item.end_at).getTime());
    for (var pi = 0; pi < parents.length; pi++) {
      var par = parents[pi];
      if (String(par.id) === String(itemId)) continue;
      if (bStartMin >= par.poseStartMin && bEndMin <= par.poseEndMin) {
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

  // Check bookings
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
    const bgAlpha = b.status === 'confirmed' ? 0.65 : 0.22;
    const ev = {
      id: b.id, resourceId: String(b.practitioner_id),
      title: b.client_name || 'Sans nom',
      start: b.start_at, end: b.end_at,
      backgroundColor: fcHexAlpha(accent, bgAlpha),
      borderColor: accent, textColor: fcDarkenHex(accent, 0.55),
      editable: !frozen && !isEventLocked(b) && !calState.fcLocked,
      startEditable: !frozen && !isEventLocked(b) && !calState.fcLocked,
      durationEditable: !frozen && !isEventLocked(b) && !calState.fcLocked,
      extendedProps: props
    };
    return ev;
  });
}

/** Build FC events from grouped bookings (single container per group,
 *  or one per practitioner for split groups with different practitioners). */
export function buildGroupEvents(grouped) {
  return Object.keys(grouped).flatMap(gid => {
    const members = grouped[gid].sort((a, b) => (a.group_order || 0) - (b.group_order || 0));
    const first = members[0];
    const anyFrozen = members.some(m => ['completed', 'cancelled', 'no_show'].includes(m.status));
    const anyLocked = members.some(m => isEventLocked(m));
    const allMembersWithAccent = members.map(m => ({ ...m, _accent: accentFor(m) }));

    // Detect split group: different practitioners across members
    const pracIds = new Set(members.map(m => String(m.practitioner_id)));
    const isSplit = pracIds.size > 1;

    if (isSplit) {
      // Split group: one FC event per practitioner, each covering only their time slice
      const byPrac = {};
      members.forEach(m => {
        const pid = String(m.practitioner_id);
        if (!byPrac[pid]) byPrac[pid] = [];
        byPrac[pid].push(m);
      });
      return Object.entries(byPrac).map(([pracId, pracMembers]) => {
        const pracFirst = pracMembers[0];
        const accent = accentFor(pracFirst);
        const pracStart = pracMembers.reduce((mn, m) => m.start_at < mn ? m.start_at : mn, pracMembers[0].start_at);
        const pracEnd = pracMembers.reduce((mx, m) => m.end_at > mx ? m.end_at : mx, pracMembers[0].end_at);
        // Border segments for this practitioner's members only
        const pracAccents = pracMembers.map(m => accentFor(m));
        let _borderSegments = null;
        if (new Set(pracAccents).size > 1) {
          const durations = pracMembers.map(m => Math.max((new Date(m.end_at) - new Date(m.start_at)) / 60000, 1));
          const total = durations.reduce((s, d) => s + d, 0);
          let cursor = 0;
          _borderSegments = pracMembers.map((m, i) => {
            const seg = { color: pracAccents[i], from: cursor, to: cursor + durations[i] / total * 100 };
            cursor = seg.to;
            return seg;
          });
        }
        return {
          id: 'group_' + gid + '_' + pracId,
          resourceId: pracId,
          title: first.client_name || 'Sans nom',
          start: pracStart, end: pracEnd,
          backgroundColor: fcHexAlpha(accent, pracMembers.some(m => m.status === 'confirmed') ? 0.65 : 0.22), borderColor: accent, textColor: fcDarkenHex(accent, 0.55),
          editable: !anyFrozen && !anyLocked && !calState.fcLocked,
          startEditable: !anyFrozen && !anyLocked && !calState.fcLocked,
          durationEditable: false,
          extendedProps: {
            _isGroup: true, _isSplitGroup: true, _groupId: gid, _accent: accent,
            _members: allMembersWithAccent,
            _borderSegments,
            client_name: first.client_name,
            client_is_vip: first.client_is_vip,
            client_notes: first.client_notes,
            practitioner_id: pracFirst.practitioner_id,
            practitioner_name: pracFirst.practitioner_name,
            processing_time: pracFirst.processing_time,
            processing_start: pracFirst.processing_start,
            buffer_before_min: pracFirst.buffer_before_min,
            internal_note: first.internal_note,
            notes_count: members.reduce((sum, m) => sum + (m.notes_count || 0), 0),
            first_note: (members.find(m => m.first_note) || {}).first_note || '',
            status: first.status
          }
        };
      });
    }

    // Non-split group: single event (existing behavior)
    const accent = accentFor(first);
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
    return [{
      id: 'group_' + gid, resourceId: String(first.practitioner_id),
      title: first.client_name || 'Sans nom',
      start: minStart, end: maxEnd,
      backgroundColor: fcHexAlpha(accent, members.some(m => m.status === 'confirmed') ? 0.65 : 0.22), borderColor: accent, textColor: fcDarkenHex(accent, 0.55),
      editable: !anyFrozen && !anyLocked && !calState.fcLocked, startEditable: !anyFrozen && !anyLocked && !calState.fcLocked, durationEditable: false,
      extendedProps: {
        _isGroup: true, _groupId: gid, _accent: accent,
        _members: allMembersWithAccent,
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
    }];
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
  const now = new Date(); // compute once outside loop
  return events.filter(ev => {
    const p = ev.extendedProps;
    // Tasks: always visible (they block slots), only hide cancelled if toggle off
    if (p._isTask) {
      if (p.status === 'cancelled' && !calState.fcShowCancelled) return false;
      return true;
    }
    // Hide expired pending bookings (start_at already passed, not confirmed)
    if (p.status === 'pending' && ev.start && new Date(ev.start) <= now) return false;
    if (p._isGroup) {
      const members = p._members || [];
      // Hide group if all members are pending and start is past
      if (members.every(m => m.status === 'pending') && ev.start && new Date(ev.start) <= now) return false;
      const allCancelled = members.every(m => m.status === 'cancelled');
      const allNoShow = members.every(m => m.status === 'no_show');
      const allPending = members.every(m => m.status === 'pending' || m.status === 'pending_deposit');
      const allCompleted = members.every(m => m.status === 'completed');
      if ((allCancelled || p.status === 'cancelled') && !calState.fcShowCancelled) return false;
      if ((allNoShow || p.status === 'no_show') && !calState.fcShowNoShow) return false;
      if ((allPending || p.status === 'pending' || p.status === 'pending_deposit') && !calState.fcShowPending) return false;
      if ((allCompleted || p.status === 'completed') && !calState.fcShowCompleted) return false;
    } else {
      if (p.status === 'cancelled' && !calState.fcShowCancelled) return false;
      if (p.status === 'no_show' && !calState.fcShowNoShow) return false;
      if ((p.status === 'pending' || p.status === 'pending_deposit') && !calState.fcShowPending) return false;
      if (p.status === 'completed' && !calState.fcShowCompleted) return false;
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
  let _debounceTimer = null;
  let _lastQstr = null;
  let _pendingCb = null;

  return function (info, successCb, failCb) {
    const params = new URLSearchParams({ from: info.startStr, to: info.endStr });
    if (calState.fcCurrentFilter !== 'all') params.set('practitioner_id', calState.fcCurrentFilter);
    const qstr = params.toString();

    // Dedup: if same params already pending, just update callbacks
    if (_debounceTimer && qstr === _lastQstr) {
      _pendingCb = { success: successCb, fail: failCb };
      return;
    }

    // Cancel previous pending debounce
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _lastQstr = qstr;
    _pendingCb = { success: successCb, fail: failCb };

    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      const cb = _pendingCb;

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
      Promise.all([
        fetch('/api/bookings?' + qstr, { headers }).then(r => r.ok ? r.json() : { bookings: [] }),
        fetch('/api/tasks?' + qstr, { headers }).then(r => r.ok ? r.json() : { tasks: [] })
      ]).then(([bData, tData]) => {
          const bookings = bData.bookings || [];
          const tasks = tData.tasks || [];

          if (calState.fcCurrentFilter === 'all') {
            calState.fcPracHours = computePracHours(bookings);
            updatePracHours();
          }

          const { grouped, singles } = separateGroupedAndSingles(bookings);
          const { poseChildMap, poseChildIds, taskPoseChildIds, taskPoseParentMap } = detectPoseChildren(singles, tasks);
          const singleEvents = buildSingleEvents(singles, poseChildIds, poseChildMap);
          const groupEvents = buildGroupEvents(grouped);
          const taskEvents = buildTaskEvents(tasks, taskPoseChildIds, taskPoseParentMap);
          const allEvents = singleEvents.concat(groupEvents).concat(taskEvents);
          const filtered = applyVisibilityFilters(allEvents);

          const fsEvents = fsBuildBackgroundEvents();
          const gaEvents = gaBuildBackgroundEvents();
          cb.success(filtered.concat(fsEvents).concat(gaEvents));
        }).catch(e => cb.fail(e));
    }, 150);
  };
}

export { accentFor, buildEventsCallback };
