/**
 * Calendar Interactions — drag/drop, resize, overlap, allow, and dateClick callbacks.
 * Handles user interactions that modify booking times via the API.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { toBrusselsISO } from '../../utils/format.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { atView } from './calendar-toolbar.js';
import { fsIsActive, fsHandleDateClick } from './calendar-featured.js';
import { storeUndoAction } from './booking-undo.js';
import { fcHideTooltip } from './tooltip-renderer.js';

// ── Drag tooltip: shows target date + time while dragging ──
let _dragTT = null;
let _dragMoveHandler = null;

const DAY_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTH_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function _fmtDateFR(d) {
  return DAY_FR[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_FR[d.getMonth()];
}

function _showDragTooltip(x, y, text) {
  if (!_dragTT) {
    _dragTT = document.createElement('div');
    _dragTT.id = 'fcDragTT';
    _dragTT.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;background:#1A2332;color:#fff;font-size:.78rem;font-weight:600;padding:4px 10px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:opacity .12s';
    document.body.appendChild(_dragTT);
  }
  _dragTT.textContent = text;
  let left = x + 16, top = y - 36;
  if (left + 180 > window.innerWidth) left = x - 180;
  if (top < 4) top = y + 20;
  _dragTT.style.left = left + 'px';
  _dragTT.style.top = top + 'px';
}

function _hideDragTooltip() {
  if (_dragTT) { _dragTT.remove(); _dragTT = null; }
}

/**
 * Resolve target date + time from the dragged event's mirror element.
 * FullCalendar positions the mirror (ghost) at the snap position.
 */
function _resolveSlotFromMirror() {
  const mirror = document.querySelector('.fc-event.fc-event-mirror');
  if (!mirror) return null;
  const harness = mirror.closest('.fc-timegrid-event-harness, .fc-timegrid-event-harness-inset');
  if (!harness) return null;

  // Get the slot lane (column) the mirror is in
  const col = harness.closest('.fc-timegrid-col');
  if (!col) return null;
  const dateStr = col.getAttribute('data-date'); // YYYY-MM-DD

  // Compute time from the harness top position (inset or style.top)
  // FC positions harness with top in percentage of the timegrid body
  const body = col.closest('.fc-timegrid-body');
  if (!body) return null;
  const slotsEl = body.querySelector('.fc-timegrid-slots');
  if (!slotsEl) return null;

  // Read all slot labels to build time map
  const slots = slotsEl.querySelectorAll('tr[data-time]');
  if (!slots.length) return null;

  // Get harness bounding rect and first slot's top
  const hRect = harness.getBoundingClientRect();
  const slotsRect = slotsEl.getBoundingClientRect();
  const relTop = hRect.top - slotsRect.top;
  const totalH = slotsRect.height;

  // Find slot: iterate slots and find which one the harness top falls into
  let bestTime = null;
  for (const slot of slots) {
    const sr = slot.getBoundingClientRect();
    const slotRelTop = sr.top - slotsRect.top;
    if (slotRelTop <= relTop + 2) {
      bestTime = slot.getAttribute('data-time'); // HH:MM:SS
    }
  }

  if (!bestTime || !dateStr) return null;

  // Refine: compute sub-slot offset (snap = 5min)
  // Find the slot this falls into and compute offset within it
  let slotTop = 0, slotHeight = 0, slotTime = bestTime;
  for (const slot of slots) {
    const sr = slot.getBoundingClientRect();
    const srt = sr.top - slotsRect.top;
    if (srt <= relTop + 2) {
      slotTop = srt;
      slotHeight = sr.height;
      slotTime = slot.getAttribute('data-time');
    }
  }

  // Parse slot time
  const parts = slotTime.split(':');
  let h = parseInt(parts[0]), m = parseInt(parts[1]);

  if (slotHeight > 0) {
    // Determine slot duration from adjacent slots
    const allTimes = Array.from(slots).map(s => s.getAttribute('data-time'));
    const idx = allTimes.indexOf(slotTime);
    let slotMinutes = 30; // default
    if (idx >= 0 && idx < allTimes.length - 1) {
      const next = allTimes[idx + 1].split(':');
      slotMinutes = (parseInt(next[0]) * 60 + parseInt(next[1])) - (h * 60 + m);
    }
    const offsetRatio = Math.max(0, (relTop - slotTop) / slotHeight);
    const snapMin = 5;
    const offsetMin = Math.round((offsetRatio * slotMinutes) / snapMin) * snapMin;
    m += offsetMin;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }

  const date = new Date(dateStr + 'T12:00:00');
  const timeStr = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  return { date, dateStr, timeStr, label: _fmtDateFR(date) + ' · ' + timeStr };
}

function buildEventDragStart() {
  return function (info) {
    fcHideTooltip(); // hide normal tooltip
    // Start tracking mouse for drag tooltip
    _dragMoveHandler = function (e) {
      const slot = _resolveSlotFromMirror();
      if (slot) {
        _showDragTooltip(e.clientX, e.clientY, '→ ' + slot.label);
      }
    };
    document.addEventListener('mousemove', _dragMoveHandler);
    // Also show initial position after a tick (mirror not yet positioned)
    setTimeout(() => { if (_dragMoveHandler) _dragMoveHandler({ clientX: 0, clientY: 0 }); }, 50);
  };
}

function buildEventDragStop() {
  return function () {
    if (_dragMoveHandler) {
      document.removeEventListener('mousemove', _dragMoveHandler);
      _dragMoveHandler = null;
    }
    _hideDragTooltip();
  };
}

/** Convert a JS Date to Brussels-timezone ISO string for API calls */
function dateToBrusselsISO(d) {
  const ds = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const ts = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
  return toBrusselsISO(ds, ts);
}

/**
 * Returns the `dateClick` callback.
 */
function buildDateClick() {
  return function (info) {
    if (calState.fcCal?.view?.type === 'dayGridMonth') return;
    // In vedette mode, single click toggles featured slot
    if (fsIsActive()) {
      fsHandleDateClick(info.dateStr);
      return;
    }
    const now = Date.now();
    if (window._fcLastDateClick && now - window._fcLastDateClick < 600 && window._fcLastDateClickDate === info.dateStr) {
      fcOpenQuickCreate(info.dateStr, null, info.resource?.id);
      window._fcLastDateClick = 0;
    } else {
      window._fcLastDateClick = now;
      window._fcLastDateClickDate = info.dateStr;
    }
  };
}

/**
 * Returns the `eventDrop` callback (drag & drop move).
 */
function buildEventDrop() {
  let _busy = false;
  return async function (info) {
    if (_busy) { info.revert(); return; }
    if (fsIsActive()) { info.revert(); return; }
    _busy = true;
    const ev = info.event, p = ev.extendedProps;
    // ── Task drag & drop ──
    if (p._isTask) {
      const taskId = ev.id.replace('task_', '');
      try {
        const pracId = info.newResource ? info.newResource.id : p.practitioner_id;
        const r = await fetch(`/api/tasks/${taskId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ start_at: dateToBrusselsISO(ev.start), end_at: dateToBrusselsISO(ev.end || ev.start), practitioner_id: pracId })
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
        gToast(p.title + ' déplacée', 'success');
        calState.fcCal.refetchEvents();
      } catch (e) { info.revert(); gToast(e.message, 'error'); }
      finally { _busy = false; }
      return;
    }
    // Capture old state BEFORE the API call (info.oldEvent has pre-drag values)
    const oldStart = info.oldEvent.start;
    const oldEnd = info.oldEvent.end;
    const oldPracId = p._isGroup ? p._members?.[0]?.practitioner_id : p.practitioner_id;
    try {
      // For group containers, move the first member -- backend moves siblings
      const bookingId = p._isGroup ? p._members?.[0]?.id : ev.id;
      // Resource drag: if dropped on a different resource column, reassign practitioner
      const pracId = info.newResource ? info.newResource.id : oldPracId;
      const pracChanged = String(pracId) !== String(oldPracId);
      const r = await fetch(`/api/bookings/${bookingId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ start_at: dateToBrusselsISO(ev.start), end_at: dateToBrusselsISO(ev.end || ev.start), practitioner_id: pracId })
      });
      if (!r.ok) { if (r.status === 401) { api.clearToken(); window.location.href = '/login.html?expired=1'; return; } const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      const result = await r.json();
      // Store undo state (only for non-group moves — group undo is complex)
      if (!result.group_moved) {
        storeUndoAction(bookingId, 'move', {
          start_at: dateToBrusselsISO(oldStart),
          end_at: dateToBrusselsISO(oldEnd || oldStart),
          practitioner_id: oldPracId
        });
      }
      const pracName = pracChanged ? (calState.fcPractitioners.find(pr => String(pr.id) === String(pracId))?.display_name || '') : '';
      const msg = result.group_moved
        ? `${p.client_name || 'Client'} — ${result.count} prestations déplacées`
        : (p.client_name || 'RDV') + ' déplacé' + (pracChanged ? ' → ' + pracName : '');
      gToast(msg, 'success', !result.group_moved ? { label: 'Annuler ↶', fn: () => window.fcUndoLast() } : undefined, 8000);
      calState.fcCal.refetchEvents();
    } catch (e) {
      // Save target date BEFORE revert (revert resets event.start to original)
      const targetDate = info.event.start.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
      info.revert();
      const isCollision = e.message.includes('hevauche') || e.message.includes('pris') || e.message.includes('occupé');
      // In month view + collision -> offer to switch to day view for precise placement
      if (isCollision && calState.fcCal?.view?.type === 'dayGridMonth') {
        window._atPendingDaySwitch = targetDate;
        gToast('✘ Créneau occupé — voir le jour pour replacer ?', 'error', { label: 'Voir le jour →', fn: () => { atView('resourceTimeGridDay'); calState.fcCal.gotoDate(window._atPendingDaySwitch); document.getElementById('gToast').style.display = 'none'; } });
      } else {
        gToast(isCollision ? '✘ Créneau occupé — impossible de déplacer ici' : e.message, 'error');
      }
    } finally { _busy = false; }
  };
}

/**
 * Returns the `eventResize` callback.
 */
function buildEventResize() {
  let _busy = false;
  return async function (info) {
    if (_busy) { info.revert(); return; }
    if (fsIsActive()) { info.revert(); return; }
    _busy = true;
    const ev = info.event;
    const oldEnd = info.oldEvent.end;
    // Enforce minimum 15-minute duration
    const dur = Math.round(((ev.end || ev.start) - ev.start) / 60000);
    if (dur < 15) { info.revert(); gToast('Durée minimum : 15 min', 'error'); _busy = false; return; }
    // ── Task resize ──
    if (ev.extendedProps?._isTask) {
      const taskId = ev.id.replace('task_', '');
      try {
        const r = await fetch(`/api/tasks/${taskId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ start_at: dateToBrusselsISO(ev.start), end_at: dateToBrusselsISO(ev.end || ev.start) })
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
        gToast('Durée → ' + dur + ' min', 'success');
      } catch (e) { info.revert(); gToast(e.message, 'error'); }
      finally { _busy = false; }
      return;
    }
    try {
      const r = await fetch(`/api/bookings/${ev.id}/resize`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ end_at: dateToBrusselsISO(ev.end || ev.start) })
      });
      if (!r.ok) { if (r.status === 401) { api.clearToken(); window.location.href = '/login.html?expired=1'; return; } const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      const evEnd = ev.end || ev.start;
      const dur = Math.round((evEnd - ev.start) / 60000);
      storeUndoAction(ev.id, 'resize', { end_at: dateToBrusselsISO(oldEnd || ev.start) });
      gToast('Durée → ' + dur + ' min', 'success', { label: 'Annuler ↶', fn: () => window.fcUndoLast() }, 8000);
    } catch (e) {
      info.revert();
      gToast(e.message.includes('hevauche') || e.message.includes('créneau')
        ? '✘ Chevauchement — durée non modifiée'
        : e.message, 'error');
    } finally { _busy = false; }
  };
}

/**
 * Returns the `eventOverlap` callback.
 */
function buildEventOverlap() {
  return function (stillEvent, movingEvent) {
    if (calState.fcAllowOverlap) return true;
    // Tasks always allow overlap
    if (stillEvent.extendedProps?._isTask || movingEvent?.extendedProps?._isTask) return true;
    // Group container vs its own members -> always allow
    const sg = stillEvent.extendedProps?._groupId, mg = movingEvent?.extendedProps?._groupId;
    if (sg && mg && sg === mg) return true;
    const sp = stillEvent.extendedProps?.practitioner_id;
    const mp = movingEvent?.extendedProps?.practitioner_id;
    if (sp && mp && sp !== mp) return true;
    const st = stillEvent.extendedProps?.status;
    if (['cancelled', 'completed', 'no_show'].includes(st)) return true;
    // Allow overlap with events that have a pose window (eventAllow + backend do precise check)
    if (parseInt(stillEvent.extendedProps?.processing_time) > 0) return true;
    // Reverse: moving event has pose window → allow overlap (eventAllow + backend do precise check)
    if (parseInt(movingEvent?.extendedProps?.processing_time) > 0) return true;
    // If practitioner has capacity > 1, allow overlap (eventAllow does the precise count check)
    const pracId = mp || sp;
    const prac = calState.fcPractitioners?.find(p => String(p.id) === String(pracId));
    if (prac && (prac.max_concurrent || 1) > 1) return true;
    return false;
  };
}

/**
 * Returns the `eventAllow` callback.
 */
function buildEventAllow() {
  return function (dropInfo, draggedEvent) {
    const dropDay = dropInfo.start.getDay();
    if (calState.fcHiddenDays.includes(dropDay)) return false;

    // Month view: dropInfo has all-day range (midnight->midnight), so we can't do
    // precise overlap checks here. Allow drop with basic checks; backend validates.
    if (calState.fcCal?.view?.type === 'dayGridMonth') {
      const origStart = draggedEvent.start;
      const newDate = dropInfo.start;
      const actualStart = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate(), origStart.getHours(), origStart.getMinutes());
      return actualStart >= new Date();
    }

    const effectiveStart = dropInfo.start;
    const effectiveEnd = dropInfo.end;

    // Staff can override working hours — no business hours check on drag/drop
    const targetPrac = dropInfo.resource?.id || draggedEvent.extendedProps?.practitioner_id;

    if (calState.fcAllowOverlap) return effectiveStart >= new Date();
    const myPrac = targetPrac || draggedEvent.extendedProps?.practitioner_id;
    if (!myPrac) return true;
    if (effectiveStart < new Date()) return false;
    const myGroupId = draggedEvent.extendedProps?._groupId;
    const newStart = dropInfo.start, newEnd = dropInfo.end;
    const allEvents = calState.fcCal.getEvents();
    // Capacity-aware: count overlaps vs max_concurrent
    const prac = calState.fcPractitioners?.find(p => String(p.id) === String(myPrac));
    const maxC = prac?.max_concurrent || 1;
    let overlapCount = 0;
    for (const ev of allEvents) {
      if (ev.id === draggedEvent.id) continue;
      if (myGroupId && ev.extendedProps?._groupId === myGroupId) continue;
      if (String(ev.extendedProps?.practitioner_id) !== String(myPrac)) continue;
      const st = ev.extendedProps?.status;
      if (st === 'cancelled' || st === 'no_show' || st === 'completed') continue;
      const evEnd = ev.end || ev.start;
      if (ev.start < newEnd && evEnd > newStart) {
        // Helper: round ms timestamp to nearest minute (avoids sub-minute precision mismatches
        // between FullCalendar snap positions and DB timestamps with fractional seconds)
        const toMin = t => Math.round(t / 60000);
        // Skip if dragged event fits entirely within this event's pose window
        const pt = parseInt(ev.extendedProps?.processing_time) || 0;
        if (pt > 0) {
          const ps = parseInt(ev.extendedProps?.processing_start) || 0;
          const buf = parseInt(ev.extendedProps?.buffer_before_min) || 0;
          const poseStartMs = ev.start.getTime() + (buf + ps) * 60000;
          const poseEndMs = ev.start.getTime() + (buf + ps + pt) * 60000;
          if (toMin(newStart.getTime()) >= toMin(poseStartMs) && toMin(newEnd.getTime()) <= toMin(poseEndMs)) continue;
        }
        // Reverse: skip if existing event fits entirely within moving event's pose window
        const mpt = parseInt(draggedEvent.extendedProps?.processing_time) || 0;
        if (mpt > 0) {
          const mps = parseInt(draggedEvent.extendedProps?.processing_start) || 0;
          const mbuf = parseInt(draggedEvent.extendedProps?.buffer_before_min) || 0;
          const movePoseStartMs = newStart.getTime() + (mbuf + mps) * 60000;
          const movePoseEndMs = newStart.getTime() + (mbuf + mps + mpt) * 60000;
          if (toMin(ev.start.getTime()) >= toMin(movePoseStartMs) && toMin(evEnd.getTime()) <= toMin(movePoseEndMs)) continue;
        }
        overlapCount++;
      }
    }
    if (overlapCount >= maxC) return false;
    return true;
  };
}

export { buildDateClick, buildEventDrop, buildEventResize, buildEventOverlap, buildEventAllow, buildEventDragStart, buildEventDragStop };
