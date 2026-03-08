/**
 * Calendar Hooks — eventDidMount and eventWillUnmount callbacks for FullCalendar.
 * Handles: pose overlay, pose-child positioning, border styling, category filtering display,
 * tooltip listeners, click/tap handlers, and custom touch resize.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { api, calState } from '../../state.js';
import { gToast, esc } from '../../utils/dom.js';
import { toBrusselsISO } from '../../utils/format.js';
import { fcRefresh } from './calendar-init.js';
import { fcOpenDetail } from './booking-detail.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { fsIsActive, fsHandleDateClick } from './calendar-featured.js';
import { storeUndoAction } from './booking-undo.js';
import { fcShowTooltip, fcMoveTooltip, fcHideTooltip } from './tooltip-renderer.js';

const DEFAULT_ACCENT = '#0D7377';

/** Convert a JS Date to Brussels-timezone ISO string for API calls */
function dateToBrusselsISO(d) {
  const ds = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const ts = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
  return toBrusselsISO(ds, ts);
}

/**
 * Returns the `eventDidMount` callback.
 */
function buildEventDidMount() {
  return function (info) {
    const p = info.event.extendedProps;

    // Skip styling for featured background events
    if (p._isFeaturedSlot) return;

    const accent = p._accent || DEFAULT_ACCENT;
    const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : DEFAULT_ACCENT;

    // ── Pose overlay (attached to FC element for correct full-height positioning) ──
    if (p._poseStartPct != null && info.view.type !== 'dayGridMonth') {
      const overlay = document.createElement('div');
      overlay.className = 'ev-pose-overlay';
      overlay.style.top = p._poseStartPct + '%';
      overlay.style.height = (p._poseEndPct - p._poseStartPct) + '%';
      // Click on pose zone → open quick-create (practitioner is free)
      overlay.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const rect = info.el.getBoundingClientRect();
        const clickRatio = (e.clientY - rect.top) / rect.height;
        const evStart = info.event.start.getTime();
        const evEnd = (info.event.end || info.event.start).getTime();
        const clickTime = new Date(evStart + clickRatio * (evEnd - evStart));
        // Snap to 15min grid
        clickTime.setMinutes(Math.floor(clickTime.getMinutes() / 15) * 15, 0, 0);
        const iso = clickTime.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) + 'T' + clickTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) + ':00';
        fcOpenQuickCreate(iso);
      });
      info.el.appendChild(overlay);
    }

    // ── Pose children: render as overlay cards inside parent event element ──
    // Children are NOT FC events (excluded from event list), so they don't create sub-columns.
    // Instead they're DOM overlays positioned within the parent's full height.
    if (p._poseChildren && p._poseChildren.length > 0 && info.view.type !== 'dayGridMonth') {
      info.el.style.overflow = 'visible';
      const evStart = info.event.start.getTime();
      const evEnd = (info.event.end || info.event.start).getTime();
      const evDur = evEnd - evStart;
      if (evDur > 0) {
        const isTouch2 = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        p._poseChildren.forEach(function (child) {
          var cStart = new Date(child.start_at).getTime();
          var cEnd = new Date(child.end_at).getTime();
          var topPct = ((cStart - evStart) / evDur) * 100;
          var heightPct = ((cEnd - cStart) / evDur) * 100;
          var childAccent = child._accent || DEFAULT_ACCENT;
          var safeChildAccent = /^#[0-9a-fA-F]{3,8}$/.test(childAccent) ? childAccent : DEFAULT_ACCENT;

          var card = document.createElement('div');
          card.className = 'ev-pose-child-card';
          card.style.top = topPct + '%';
          card.style.height = heightPct + '%';
          card.style.borderLeftColor = safeChildAccent;
          card.style.color = safeChildAccent;
          card.setAttribute('data-booking-id', child.id);

          var svcLabel = child.variant_name
            ? (child.service_name || 'RDV') + ' — ' + child.variant_name
            : (child.service_name || child.custom_label || 'RDV libre');
          card.innerHTML = '<div class="epc-name">' + esc(child.client_name || 'Sans nom') + '</div>'
            + '<div class="epc-svc">' + esc(svcLabel) + '</div>';

          // Double-click → open booking detail
          card.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            fcHideTooltip();
            fcOpenDetail(child.id);
          });

          // Tooltip on hover (desktop)
          if (!isTouch2) {
            card.addEventListener('mouseenter', function (e) {
              if (fsIsActive()) return;
              fcShowTooltip({ start: new Date(child.start_at), end: new Date(child.end_at), title: child.client_name || 'Sans nom', extendedProps: child }, e.clientX, e.clientY);
            });
            card.addEventListener('mousemove', function (e) { fcMoveTooltip(e.clientX, e.clientY); });
            card.addEventListener('mouseleave', function () { fcHideTooltip(); });
          }

          // Touch: single tap → tooltip, double tap → detail
          var lastChildTap = 0;
          card.addEventListener('touchend', function (e) {
            e.stopPropagation();
            var now = Date.now();
            if (now - lastChildTap < 600) {
              e.preventDefault();
              fcHideTooltip();
              fcOpenDetail(child.id);
              lastChildTap = 0;
            } else {
              lastChildTap = now;
              var touch = e.changedTouches && e.changedTouches[0];
              if (touch) {
                fcShowTooltip({ start: new Date(child.start_at), end: new Date(child.end_at), title: child.client_name || 'Sans nom', extendedProps: child }, touch.clientX, touch.clientY);
                clearTimeout(window._ttAutoHide);
                window._ttAutoHide = setTimeout(fcHideTooltip, 2500);
              }
            }
          }, { passive: false });

          info.el.appendChild(card);
        });
      }
    }

    // ── Border styling ──
    info.el.style.borderLeftWidth = '3px';
    info.el.style.borderLeftStyle = 'solid';
    info.el.style.borderLeftColor = info.event.borderColor || safeAccent;
    info.el.style.borderTopWidth = '0';
    info.el.style.borderRightWidth = '0';
    info.el.style.borderBottomWidth = '0';

    info.el.setAttribute('data-eid', info.event.id);

    // ── Category filtering display ──
    if (calState.fcHiddenCategories && calState.fcHiddenCategories.size > 0) {
      if (p._isGroup) {
        const members = p._members || [];
        const anyVisible = members.some(m => !calState.fcHiddenCategories.has(m.service_category || ''));
        const anyHidden = members.some(m => calState.fcHiddenCategories.has(m.service_category || ''));
        info.el.setAttribute('data-category', members.map(m => m.service_category || '').join(','));
        if (!anyVisible) { info.el.style.display = 'none'; }
        else if (anyHidden) {
          info.el.classList.add('ev-partial-match');
          info.el.style.setProperty('border-left-color', safeAccent + '55', 'important');
        }
      } else {
        const cat = p.service_category || '';
        info.el.setAttribute('data-category', cat);
        if (calState.fcHiddenCategories.has(cat)) info.el.style.display = 'none';
      }
    } else {
      const cat = p._isGroup ? (p._members?.[0]?.service_category || '') : (p.service_category || '');
      info.el.setAttribute('data-category', cat);
    }

    // Resolve booking ID (for groups -> first member)
    const bookingId = p._isGroup ? p._members?.[0]?.id : info.event.id;

    // ── Tooltip (hover desktop only, tap touch) ──
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouch) {
      info.el.addEventListener('mouseenter', function (e) {
        if (fsIsActive()) return;
        fcShowTooltip(info.event, e.clientX, e.clientY);
      });
      info.el.addEventListener('mousemove', function (e) {
        if (fsIsActive()) return;
        fcMoveTooltip(e.clientX, e.clientY);
      });
      info.el.addEventListener('mouseleave', function () {
        fcHideTooltip();
      });
    }

    // ── Desktop: native dblclick ──
    info.el.addEventListener('dblclick', function (e) {
      if (fsIsActive()) return;
      e.stopPropagation();
      fcHideTooltip();
      fcOpenDetail(bookingId);
    });
    // Desktop: dblclick on resizer too (for short 15-min events where resizer covers most of the area)
    const resizerForDbl = info.el.querySelector('.fc-event-resizer-end');
    if (resizerForDbl) {
      resizerForDbl.addEventListener('dblclick', function (e) {
        if (fsIsActive()) return;
        e.stopPropagation();
        fcHideTooltip();
        fcOpenDetail(bookingId);
      });
    }

    // ── Touch: single tap -> tooltip (brief), double tap -> detail ──
    let lastTap = 0;
    info.el.addEventListener('touchend', function (e) {
      // In vedette mode, tap on event toggles featured slot
      if (fsIsActive()) {
        fsHandleDateClick(info.event.startStr);
        return;
      }
      // Skip during active drag/resize
      if (info.el.classList.contains('fc-event-dragging') || info.el.classList.contains('fc-event-resizing')) return;
      const onResizer = !!e.target.closest('.fc-event-resizer');
      const now = Date.now();
      if (now - lastTap < 600) {
        // Double tap — always open detail (even on resizer for short events)
        e.preventDefault();
        fcHideTooltip();
        fcOpenDetail(bookingId);
        lastTap = 0;
      } else {
        lastTap = now;
        // Single tap on resizer → let the custom resize handler deal with it
        if (onResizer) return;
        // Single tap -> show tooltip briefly, hide on next touch anywhere
        const touch = e.changedTouches?.[0];
        if (touch) {
          fcShowTooltip(info.event, touch.clientX, touch.clientY);
          clearTimeout(window._ttAutoHide);
          window._ttAutoHide = setTimeout(fcHideTooltip, 2500);
          // Hide tooltip on next touch anywhere
          const dismiss = function () { fcHideTooltip(); document.removeEventListener('touchstart', dismiss, true); };
          setTimeout(function () { document.addEventListener('touchstart', dismiss, true); }, 100);
        }
      }
    }, { passive: false });

    // ── Custom touch resize — bypasses FullCalendar's interaction plugin for reliable tablet resize ──
    if (isTouch) {
      const resizer = info.el.querySelector('.fc-event-resizer-end');
      if (resizer) {
        let lastResizerTouch = 0;
        resizer.addEventListener('touchstart', function (e) {
          const frozen = ['completed', 'cancelled', 'no_show'].includes(p.status);
          if (frozen || p._isGroup) return;

          // Double-tap detection via touchstart (most reliable on tablet)
          const now = Date.now();
          if (now - lastResizerTouch < 600) {
            e.preventDefault();
            e.stopPropagation();
            lastResizerTouch = 0;
            fcHideTooltip();
            fcOpenDetail(bookingId);
            return; // Skip resize entirely
          }
          lastResizerTouch = now;

          e.preventDefault();
          e.stopPropagation();

          const slot = document.querySelector('.fc-timegrid-slot');
          if (!slot || !info.event.end) return;
          const slotH = slot.getBoundingClientRect().height;
          const durStr = calState.fcCalOptions?.slotDuration || '00:15:00';
          const durParts = durStr.split(':');
          const slotMins = parseInt(durParts[0]) * 60 + parseInt(durParts[1]);

          const startY = e.touches[0].clientY;
          const origEnd = new Date(info.event.end);
          const origH = info.el.offsetHeight;
          let lastSlots = 0;
          let resizeStarted = false;
          let cleanupTimer;

          function onMove(ev) {
            ev.preventDefault();
            if (!resizeStarted) {
              resizeStarted = true;
              info.el.classList.add('fc-event-dragging');
              info.el.style.setProperty('bottom', 'auto', 'important');
              info.el.style.zIndex = '999';
            }
            const dy = ev.touches[0].clientY - startY;
            const ds = Math.round(dy / slotH);
            lastSlots = ds;
            const newH = origH + ds * slotH;
            if (newH >= slotH) info.el.style.height = newH + 'px';
          }

          function onEnd() {
            clearTimeout(cleanupTimer);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            if (resizeStarted) {
              info.el.classList.remove('fc-event-dragging');
              info.el.style.removeProperty('bottom');
              info.el.style.removeProperty('height');
              info.el.style.removeProperty('z-index');
            }
            if (lastSlots === 0) return;

            const newEnd = new Date(origEnd.getTime() + lastSlots * slotMins * 60000);
            if (newEnd <= info.event.start) return;
            info.event.setEnd(newEnd);

            fetch('/api/bookings/' + info.event.id + '/resize', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
              body: JSON.stringify({ end_at: dateToBrusselsISO(newEnd) })
            }).then(function (r) {
              if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Erreur'); });
              var dur = Math.round((newEnd - info.event.start) / 60000);
              storeUndoAction(info.event.id, 'resize', { end_at: dateToBrusselsISO(origEnd) });
              gToast('Durée → ' + dur + ' min', 'success', { label: 'Annuler ↶', fn: () => window.fcUndoLast() }, 8000);
            }).catch(function (err) {
              info.event.setEnd(origEnd);
              calState.fcCal.refetchEvents();
              var msg = (err.message || '').includes('hevauche') || (err.message || '').includes('créneau')
                ? 'Chevauchement — durée non modifiée' : (err.message || 'Erreur');
              gToast(msg, 'error');
            });
          }

          document.addEventListener('touchmove', onMove, { passive: false });
          document.addEventListener('touchend', onEnd);
          cleanupTimer = setTimeout(() => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); if (resizeStarted) info.el.classList.remove('fc-event-dragging'); }, 10000);
        }, { passive: false });
      }
    }
  };
}

/**
 * Returns the `eventWillUnmount` callback — cleans up tooltips when events are removed.
 */
function buildEventWillUnmount() {
  return function () {
    fcHideTooltip();
  };
}

export { buildEventDidMount, buildEventWillUnmount };
