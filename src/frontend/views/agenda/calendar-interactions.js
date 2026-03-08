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
      fcOpenQuickCreate(info.dateStr);
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
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
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
    try {
      const r = await fetch(`/api/bookings/${ev.id}/resize`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ end_at: dateToBrusselsISO(ev.end || ev.start) })
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
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
        // Skip if dragged event fits entirely within this event's pose window
        const pt = parseInt(ev.extendedProps?.processing_time) || 0;
        if (pt > 0) {
          const ps = parseInt(ev.extendedProps?.processing_start) || 0;
          const buf = parseInt(ev.extendedProps?.buffer_before_min) || 0;
          const poseStart = new Date(ev.start.getTime() + (buf + ps) * 60000);
          const poseEnd = new Date(ev.start.getTime() + (buf + ps + pt) * 60000);
          if (newStart >= poseStart && newEnd <= poseEnd) continue;
        }
        overlapCount++;
      }
    }
    if (overlapCount >= maxC) return false;
    return true;
  };
}

export { buildDateClick, buildEventDrop, buildEventResize, buildEventOverlap, buildEventAllow };
