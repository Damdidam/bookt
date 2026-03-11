/**
 * Calendar Hooks — eventDidMount and eventWillUnmount callbacks for FullCalendar.
 * Handles: pose overlay, pose-child positioning, border styling, category filtering display,
 * tooltip listeners, click/tap handlers, and custom touch resize.
 *
 * Extracted from calendar-events.js for separation of concerns.
 */
import { calState } from '../../state.js';
import { fcOpenDetail } from './booking-detail.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { fsIsActive, fsHandleDateClick } from './calendar-featured.js';
import { fcShowTooltip, fcMoveTooltip, fcHideTooltip } from './tooltip-renderer.js';

const DEFAULT_ACCENT = '#0D7377';

/**
 * Redistribute harness positions in columns that contain pose-children.
 * FC creates N sub-columns for N overlapping events, but pose-children should
 * overlay their parent — not occupy their own sub-column. This function
 * recalculates: M real events → M equal columns, children match their parent.
 */
function redistributePoseColumns() {
  // ── CSS helpers: FC Scheduler v6 may use `inset` shorthand or left/right ──
  function setHoriz(h, newLeft, newRight) {
    var css = h.style.cssText;
    var m = css.match(/inset:\s*([^;!]+)/i);
    if (m) {
      var parts = m[1].trim().split(/\s+/);
      var top = parts[0] || '0%';
      var bottom = parts.length >= 3 ? parts[2] : top;
      var newInset = top + ' ' + newRight + ' ' + bottom + ' ' + newLeft;
      h.style.cssText = css.replace(/inset:\s*[^;]+;?/i, 'inset: ' + newInset + ' !important; ');
    } else {
      h.style.setProperty('left', newLeft, 'important');
      h.style.setProperty('right', newRight, 'important');
    }
  }

  // If resource view is active, FC already handles practitioner columns — skip redistribution
  var viewType = calState.fcCal?.view?.type || '';
  var isResourceView = viewType.indexOf('resource') === 0;

  // Build stable practitioner order
  var pracIds = (calState.fcCurrentFilter !== 'all')
    ? [calState.fcCurrentFilter]
    : (calState.fcPractitioners || []).map(function (p) { return String(p.id); });

  // Helper: get practitioner_id from a harness element
  function getPracId(h) {
    var evEl = h.querySelector('[data-eid]');
    if (!evEl) return null;
    var eid = evEl.dataset.eid;
    var cal = calState.fcCal;
    if (!cal) return null;
    var ev = cal.getEventById(eid);
    if (!ev) return null;
    var ep = ev.extendedProps;
    return String(ep?.practitioner_id || (ep?._isGroup ? ep._members?.[0]?.practitioner_id : '') || '');
  }

  var processed = new Set();
  // Process ALL day columns (not just those with pose-children)
  document.querySelectorAll('.fc-timegrid-col-events').forEach(function (colEvents) {
    if (processed.has(colEvents)) return;
    processed.add(colEvents);

    var harnesses = [];
    for (var i = 0; i < colEvents.children.length; i++) {
      var h = colEvents.children[i];
      if (h.classList.contains('fc-timegrid-event-harness')) harnesses.push(h);
    }
    if (harnesses.length < 2) return;

    var isChild = function (h) { return !!h.querySelector('.ev-pose-child'); };
    var realHarnesses = harnesses.filter(function (h) { return !isChild(h); });
    var childHarnesses = harnesses.filter(function (h) { return isChild(h); });

    // ── Redistribute real harnesses by practitioner column ──
    // Only split into columns when events from different practitioners overlap in time.
    // If only one practitioner has events at a given time → full width.
    // Skip if resource view is active (FC Scheduler handles columns natively).
    if (pracIds.length >= 2 && !isResourceView) {
      // Annotate each harness with its practitioner and bounding rect
      var annotated = realHarnesses.map(function (h) {
        return { h: h, pid: getPracId(h), rect: h.getBoundingClientRect() };
      }).filter(function (a) { return a.pid && pracIds.indexOf(a.pid) !== -1; });

      // For each harness, find all overlapping harnesses (by vertical bounds)
      annotated.forEach(function (a) {
        var overlappingPracs = new Set();
        overlappingPracs.add(a.pid);
        annotated.forEach(function (b) {
          if (b === a) return;
          // Check vertical overlap
          if (a.rect.top < b.rect.bottom - 1 && b.rect.top < a.rect.bottom - 1) {
            overlappingPracs.add(b.pid);
          }
        });

        if (overlappingPracs.size >= 2) {
          // Multiple practitioners overlap at this time → split into columns
          var idx = pracIds.indexOf(a.pid);
          var total = pracIds.length;
          var w = 100 / total;
          setHoriz(a.h, (idx * w) + '%', (100 - (idx + 1) * w) + '%');
          a.h.style.zIndex = String(idx + 1);
        } else {
          // Only one practitioner at this time → full width
          setHoriz(a.h, '0%', '0%');
          a.h.style.zIndex = '1';
        }
      });
    }

    // ── Fix real harness widths when single-practitioner or resource view ──
    // FC creates sub-columns for pose children overlapping parents; undo that.
    if (childHarnesses.length > 0 && (pracIds.length < 2 || isResourceView)) {
      var groups = [];
      realHarnesses.forEach(function (h) {
        var hRect = h.getBoundingClientRect();
        var placed = false;
        for (var g = 0; g < groups.length; g++) {
          if (groups[g].some(function (m) { var r = m.getBoundingClientRect(); return hRect.top < r.bottom - 1 && r.top < hRect.bottom - 1; })) {
            groups[g].push(h); placed = true; break;
          }
        }
        if (!placed) groups.push([h]);
      });
      groups.forEach(function (group) {
        var w = 100 / group.length;
        group.forEach(function (h, i) {
          setHoriz(h, (i * w) + '%', (100 - (i + 1) * w) + '%');
        });
      });
    }

    // ── Position each pose-child on its parent ──
    childHarnesses.forEach(function (ch) {
      var evEl = ch.querySelector('.ev-pose-child');
      if (!evEl) return;
      var parentId = evEl.dataset.poseParent;
      if (!parentId) return;
      var parentEl = document.querySelector('[data-eid="' + parentId + '"]');
      if (!parentEl) return;
      var parentHarness = parentEl.closest('.fc-timegrid-event-harness');
      if (!parentHarness) return;
      var pm = parentHarness.style.cssText.match(/inset:\s*([^;!]+)/i);
      if (pm) {
        var pp = pm[1].trim().split(/\s+/);
        setHoriz(ch, pp.length >= 4 ? pp[3] : '0%', pp.length >= 2 ? pp[1] : '0%');
      } else {
        setHoriz(ch, parentHarness.style.left || '0%', parentHarness.style.right || '0%');
      }
      ch.style.zIndex = '10';
    });
  });
}

/**
 * Returns the `eventDidMount` callback.
 */
function buildEventDidMount() {
  return function (info) {
    const p = info.event.extendedProps;

    // Skip styling for featured background events
    if (p._isFeaturedSlot) return;

    // ── Internal task: separate handling ──
    if (p._isTask) {
      const accent = p._accent || DEFAULT_ACCENT;
      const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : DEFAULT_ACCENT;
      info.el.style.borderLeftWidth = '3px';
      info.el.style.borderLeftStyle = 'dashed';
      info.el.style.borderLeftColor = info.event.borderColor || safeAccent;
      info.el.style.borderTopWidth = '0'; info.el.style.borderRightWidth = '0'; info.el.style.borderBottomWidth = '0';
      info.el.setAttribute('data-eid', info.event.id);
      const taskId = info.event.id.replace('task_', '');
      // Tooltip
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      if (!isTouch) {
        info.el.addEventListener('mouseenter', e => { if (!fsIsActive()) fcShowTooltip(info.event, e.clientX, e.clientY); });
        info.el.addEventListener('mousemove', e => { if (!fsIsActive()) fcMoveTooltip(e.clientX, e.clientY); });
        info.el.addEventListener('mouseleave', () => fcHideTooltip());
      }
      // Desktop dblclick → open task detail
      info.el.addEventListener('dblclick', e => { e.stopPropagation(); fcHideTooltip(); window.fcOpenTaskDetail?.(taskId); });
      // Touch: single tap → tooltip, double tap → detail
      let lastTap = 0;
      info.el.addEventListener('touchend', e => {
        if (fsIsActive()) return;
        if (info.el.classList.contains('fc-event-dragging') || info.el.classList.contains('fc-event-resizing')) return;
        const now = Date.now();
        if (now - lastTap < 600) { e.preventDefault(); fcHideTooltip(); window.fcOpenTaskDetail?.(taskId); lastTap = 0; }
        else { lastTap = now; const touch = e.changedTouches?.[0]; if (touch) { fcShowTooltip(info.event, touch.clientX, touch.clientY); clearTimeout(window._ttAutoHide); window._ttAutoHide = setTimeout(fcHideTooltip, 2500); } }
      }, { passive: false });
      return; // Skip all booking-specific logic
    }

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

    // ── Pose child: mark for deferred redistribution ──
    // FC creates too many sub-columns because it counts children as separate events.
    // We mark children here, then redistributePoseColumns() fixes ALL harness positions
    // after all events have rendered (scheduled once via setTimeout).
    if (p._isPoseChild && info.view.type !== 'dayGridMonth') {
      info.el.classList.add('ev-pose-child');
      info.el.setAttribute('data-pose-parent', p._poseParentId);
    }
    // Schedule redistribution for practitioner columns + pose-child positioning
    // (debounced, run twice to survive FC re-layouts)
    if (info.view.type !== 'dayGridMonth') {
      clearTimeout(window._poseRedistTimer);
      clearTimeout(window._poseRedistTimer2);
      window._poseRedistTimer = setTimeout(redistributePoseColumns, 0);
      window._poseRedistTimer2 = setTimeout(redistributePoseColumns, 120);
    }

    // ── Border styling ──
    info.el.style.borderLeftWidth = '3px';
    info.el.style.borderLeftStyle = 'solid';
    info.el.style.borderLeftColor = info.event.borderColor || safeAccent;
    info.el.style.borderTopWidth = '0';
    info.el.style.borderRightWidth = '0';
    info.el.style.borderBottomWidth = '0';

    // Dashed border for pending_deposit
    if (p.status === 'pending_deposit' || (p._isGroup && p._members?.some(m => m.status === 'pending_deposit'))) {
      info.el.style.borderLeftStyle = 'dashed';
    }

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
