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
import { fcHexAlpha } from './calendar-init.js';

const DEFAULT_ACCENT = '#0D7377';

// Cache touch detection once (constant during session)
const _isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);

// ── Debounced schedule for redistributePoseColumns ──
let _redistScheduled = false;
function scheduleRedistribute() {
  if (_redistScheduled) return;
  _redistScheduled = true;
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      _redistScheduled = false;
      redistributePoseColumns();
    });
  });
}

// ── Delegated tooltip hover (set up once on container, avoids 240 listeners) ──
let _hoverReady = false;
let _hoverContainer = null;
let _hoveredEl = null;
let _hideTimer = null;

function findEventEl(target) {
  if (!target || !target.closest) return null;
  var el = target.closest('.fc-event');
  if (!el || el.classList.contains('fc-bg-event')) return null;
  return el;
}

function getFCEvent(el) {
  var eid = el.getAttribute('data-eid');
  if (!eid) return null;
  return calState.fcCal?.getEventById(eid) || null;
}

function setupHoverDelegation() {
  if (_isTouch) return;
  var container = document.getElementById('fcCalendar');
  if (!container) return;
  // Re-attach if container DOM element changed (FC re-render)
  if (_hoverReady && _hoverContainer === container) return;
  _hoverReady = true;
  _hoverContainer = container;

  container.addEventListener('mouseover', function (e) {
    if (fsIsActive()) return;
    var el = findEventEl(e.target);
    // If hoveredEl was detached from DOM (FC re-render), reset it
    if (_hoveredEl && !_hoveredEl.isConnected) { _hoveredEl = null; fcHideTooltip(); }
    if (el === _hoveredEl) { clearTimeout(_hideTimer); return; }
    if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
    if (_hoveredEl) fcHideTooltip();
    _hoveredEl = el;
    if (!el) return;
    var ev = getFCEvent(el);
    if (ev) fcShowTooltip(ev, e.clientX, e.clientY);
  });

  container.addEventListener('mousemove', function (e) {
    if (fsIsActive() || !_hoveredEl) return;
    // If hoveredEl was detached, clean up
    if (!_hoveredEl.isConnected) { _hoveredEl = null; fcHideTooltip(); return; }
    fcMoveTooltip(e.clientX, e.clientY);
  });

  container.addEventListener('mouseout', function (e) {
    if (!_hoveredEl) return;
    var related = findEventEl(e.relatedTarget);
    if (related === _hoveredEl) return;
    _hideTimer = setTimeout(function () {
      _hoveredEl = null;
      fcHideTooltip();
      _hideTimer = null;
    }, 50);
  });
}

/**
 * Redistribute harness positions in columns that contain pose-children.
 * FC creates N sub-columns for N overlapping events, but pose-children should
 * overlay their parent — not occupy their own sub-column. This function
 * recalculates: M real events → M equal columns, children match their parent.
 *
 * Optimized: read/compute/write phases to avoid layout thrashing.
 */
function redistributePoseColumns() {
  // ── CSS helper: FC Scheduler v6 may use `inset` shorthand or left/right ──
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

  var viewType = calState.fcCal?.view?.type || '';
  var isResourceView = viewType.indexOf('resource') === 0;

  var pracIds = (calState.fcCurrentFilter !== 'all')
    ? [calState.fcCurrentFilter]
    : (calState.fcPractitioners || []).map(function (p) { return String(p.id); });

  var needsPracRedist = pracIds.length >= 2 && !isResourceView;

  // ═══ PHASE 1: READ — collect all geometry + metadata (no DOM writes) ═══
  var columns = [];
  var parentBounds = {}; // { eid: { left, right } } — shared across columns for pose-child lookup

  document.querySelectorAll('.fc-timegrid-col-events').forEach(function (colEvents) {
    var items = [];
    for (var i = 0; i < colEvents.children.length; i++) {
      var h = colEvents.children[i];
      if (!h.classList.contains('fc-timegrid-event-harness')) continue;

      // Skip hidden events (category filter → display:none) and cancelled (opacity .25)
      var evEl = h.querySelector('.fc-event');
      if (evEl && (evEl.style.display === 'none' || evEl.classList.contains('ev-cancelled'))) continue;

      var pracEl = h.querySelector('[data-prac-id]');
      var eidEl = h.querySelector('[data-eid]');
      items.push({
        h: h,
        rect: h.getBoundingClientRect(),
        pracId: pracEl ? pracEl.dataset.pracId : null,
        eid: eidEl ? eidEl.getAttribute('data-eid') : null,
        isChild: !!h.querySelector('.ev-pose-child')
      });
    }
    if (items.length < 2) return;

    var hasChildren = items.some(function (it) { return it.isChild; });
    // Skip column entirely if no pose children AND no multi-practitioner redistribution needed
    if (!hasChildren && !needsPracRedist) return;

    columns.push({ items: items, hasChildren: hasChildren });
  });

  // ═══ PHASE 2: COMPUTE — determine all positions (no DOM reads or writes) ═══
  var writes = []; // { h, left, right, z }

  columns.forEach(function (col) {
    var real = col.items.filter(function (it) { return !it.isChild; });
    var children = col.items.filter(function (it) { return it.isChild; });

    // ── Multi-practitioner overlap detection ──
    if (needsPracRedist) {
      var annotated = real.filter(function (a) {
        return a.pracId && pracIds.indexOf(a.pracId) !== -1;
      });

      annotated.forEach(function (a) {
        var overlappingPracs = new Set([a.pracId]);
        annotated.forEach(function (b) {
          if (b === a) return;
          if (a.rect.top < b.rect.bottom - 1 && b.rect.top < a.rect.bottom - 1) {
            overlappingPracs.add(b.pracId);
          }
        });

        var left, right;
        if (overlappingPracs.size >= 2) {
          var idx = pracIds.indexOf(a.pracId);
          var total = pracIds.length;
          var w = 100 / total;
          left = (idx * w) + '%';
          right = (100 - (idx + 1) * w) + '%';
          writes.push({ h: a.h, left: left, right: right, z: String(idx + 1) });
        } else {
          left = '0%'; right = '0%';
          writes.push({ h: a.h, left: left, right: right, z: '1' });
        }
        if (a.eid) parentBounds[a.eid] = { left: left, right: right };
      });
    }

    // ── Single-practitioner pose fix ──
    if (col.hasChildren && !needsPracRedist) {
      var groups = [];
      real.forEach(function (a) {
        var placed = false;
        for (var g = 0; g < groups.length; g++) {
          if (groups[g].some(function (m) {
            return a.rect.top < m.rect.bottom - 1 && m.rect.top < a.rect.bottom - 1;
          })) { groups[g].push(a); placed = true; break; }
        }
        if (!placed) groups.push([a]);
      });
      groups.forEach(function (group) {
        var w = 100 / group.length;
        group.forEach(function (a, i) {
          var left = (i * w) + '%';
          var right = (100 - (i + 1) * w) + '%';
          writes.push({ h: a.h, left: left, right: right, z: null });
          if (a.eid) parentBounds[a.eid] = { left: left, right: right };
        });
      });
    }

    // ── Pose-child positioning ──
    if (col.hasChildren) {
      var childByParent = {};
      children.forEach(function (ci) {
        var evEl = ci.h.querySelector('.ev-pose-child');
        if (!evEl) return;
        var parentId = evEl.dataset.poseParent;
        if (!parentId) return;
        // Look up parent bounds from computed map (no DOM read needed)
        var bounds = parentBounds[parentId];
        if (!bounds) {
          // Fallback: parent might be in another column or not yet computed — try DOM
          var parentEl = document.querySelector('[data-eid="' + parentId + '"]');
          if (!parentEl) return;
          var parentHarness = parentEl.closest('.fc-timegrid-event-harness');
          if (!parentHarness) return;
          var pm = parentHarness.style.cssText.match(/inset:\s*([^;!]+)/i);
          if (pm) {
            var pp = pm[1].trim().split(/\s+/);
            bounds = { left: pp.length >= 4 ? pp[3] : '0%', right: pp.length >= 2 ? pp[1] : '0%' };
          } else {
            bounds = { left: parentHarness.style.left || '0%', right: parentHarness.style.right || '0%' };
          }
        }
        if (!childByParent[parentId]) childByParent[parentId] = { pLeft: bounds.left, pRight: bounds.right, children: [] };
        childByParent[parentId].children.push(ci);
      });

      Object.keys(childByParent).forEach(function (pid) {
        var info = childByParent[pid];
        var kids = info.children;

        if (kids.length === 1) {
          writes.push({ h: kids[0].h, left: info.pLeft, right: info.pRight, z: '10' });
          return;
        }

        var pLeftPct = parseFloat(info.pLeft) || 0;
        var pRightPct = parseFloat(info.pRight) || 0;
        var parentWidth = 100 - pLeftPct - pRightPct;
        if (parentWidth <= 0) parentWidth = 100;

        // Group overlapping children using cached rects
        var overlapGroups = [];
        kids.forEach(function (ci) {
          var placed = false;
          for (var g = 0; g < overlapGroups.length; g++) {
            if (overlapGroups[g].some(function (m) {
              return ci.rect.top < m.rect.bottom - 1 && m.rect.top < ci.rect.bottom - 1;
            })) { overlapGroups[g].push(ci); placed = true; break; }
          }
          if (!placed) overlapGroups.push([ci]);
        });

        overlapGroups.forEach(function (group) {
          if (group.length === 1) {
            writes.push({ h: group[0].h, left: info.pLeft, right: info.pRight, z: '10' });
          } else {
            var w = parentWidth / group.length;
            group.forEach(function (ci, i) {
              var left = pLeftPct + i * w;
              var right = 100 - left - w;
              writes.push({ h: ci.h, left: left + '%', right: right + '%', z: String(10 + i) });
            });
          }
        });
      });
    }
  });

  // ═══ PHASE 3: WRITE — apply all DOM mutations in one batch ═══
  writes.forEach(function (w) {
    setHoriz(w.h, w.left, w.right);
    if (w.z != null) w.h.style.zIndex = w.z;
  });
}

/**
 * Returns the `eventDidMount` callback.
 * Tooltip hover is delegated (3 listeners on container instead of 240).
 * Click/touch listeners remain direct on each event (FC blocks bubbling).
 */
function buildEventDidMount() {
  return function (info) {
    const p = info.event.extendedProps;

    // Skip styling for featured background events
    if (p._isFeaturedSlot) return;

    // Set up delegated tooltip hover (runs once)
    setupHoverDelegation();

    // ── Internal task: separate handling ──
    if (p._isTask) {
      const accent = p._accent || DEFAULT_ACCENT;
      const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : DEFAULT_ACCENT;
      info.el.style.borderLeftWidth = '3px';
      info.el.style.borderLeftStyle = 'dashed';
      info.el.style.borderLeftColor = info.event.borderColor || safeAccent;
      info.el.style.borderTopWidth = '0'; info.el.style.borderRightWidth = '0'; info.el.style.borderBottomWidth = '0';
      info.el.setAttribute('data-eid', info.event.id);
      info.el.setAttribute('data-prac-id', String(p.practitioner_id || ''));
      const taskId = info.event.id.replace('task_', '');
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
      // Task pose child: mark for redistribution
      if (p._isPoseChild && info.view.type !== 'dayGridMonth') {
        info.el.classList.add('ev-pose-child');
        info.el.setAttribute('data-pose-parent', p._poseParentId);
        scheduleRedistribute();
      }
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
        clickTime.setMinutes(Math.floor(clickTime.getMinutes() / 15) * 15, 0, 0);
        const iso = clickTime.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) + 'T' + clickTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) + ':00';
        fcOpenQuickCreate(iso);
      });
      info.el.appendChild(overlay);
    }

    // ── Pose child: mark for deferred redistribution ──
    if (p._isPoseChild && info.view.type !== 'dayGridMonth') {
      info.el.classList.add('ev-pose-child');
      info.el.setAttribute('data-pose-parent', p._poseParentId);
    }
    // Schedule redistribution for practitioner columns + pose-child positioning
    if (info.view.type !== 'dayGridMonth') {
      scheduleRedistribute();
    }

    // ── Border styling ──
    info.el.style.borderLeftWidth = '3px';
    info.el.style.borderLeftStyle = 'solid';
    info.el.style.borderTopWidth = '0';
    info.el.style.borderRightWidth = '0';
    info.el.style.borderBottomWidth = '0';

    const isPending = p.status === 'pending_deposit' || p.status === 'pending'
      || (p._isGroup && p._members?.some(m => m.status === 'pending_deposit' || m.status === 'pending'));
    if (isPending) {
      info.el.style.borderLeftStyle = 'dashed';
      info.el.style.borderLeftColor = info.event.borderColor || safeAccent;
    } else if (p._borderSegments) {
      const stops = p._borderSegments.flatMap(s => [`${s.color} ${s.from.toFixed(1)}%`, `${s.color} ${s.to.toFixed(1)}%`]);
      info.el.style.borderImage = `linear-gradient(to bottom, ${stops.join(', ')}) 1`;
      const bgStops = p._borderSegments.flatMap(s => [`${fcHexAlpha(s.color, 0.22)} ${s.from.toFixed(1)}%`, `${fcHexAlpha(s.color, 0.22)} ${s.to.toFixed(1)}%`]);
      info.el.style.background = `linear-gradient(to bottom, ${bgStops.join(', ')})`;
    } else {
      info.el.style.borderLeftColor = info.event.borderColor || safeAccent;
    }

    info.el.setAttribute('data-eid', info.event.id);
    info.el.setAttribute('data-prac-id', String(p.practitioner_id || (p._isGroup ? p._members?.[0]?.practitioner_id : '') || ''));

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
          info.el.style.borderImage = 'none';
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

    // ── Desktop: dblclick → open detail (direct listener, FC blocks bubbling) ──
    info.el.addEventListener('dblclick', function (e) {
      if (fsIsActive()) return;
      e.stopPropagation();
      fcHideTooltip();
      fcOpenDetail(bookingId);
    });
    const resizerForDbl = info.el.querySelector('.fc-event-resizer-end');
    if (resizerForDbl) {
      resizerForDbl.addEventListener('dblclick', function (e) {
        if (fsIsActive()) return;
        e.stopPropagation();
        fcHideTooltip();
        fcOpenDetail(bookingId);
      });
    }

    // ── Touch: single tap → tooltip, double tap → detail ──
    let lastTap = 0;
    info.el.addEventListener('touchend', function (e) {
      if (fsIsActive()) {
        fsHandleDateClick(info.event.startStr);
        return;
      }
      if (info.el.classList.contains('fc-event-dragging') || info.el.classList.contains('fc-event-resizing')) return;
      const now = Date.now();
      if (now - lastTap < 600) {
        e.preventDefault();
        fcHideTooltip();
        fcOpenDetail(bookingId);
        lastTap = 0;
      } else {
        lastTap = now;
        const touch = e.changedTouches?.[0];
        if (touch) {
          fcShowTooltip(info.event, touch.clientX, touch.clientY);
          clearTimeout(window._ttAutoHide);
          window._ttAutoHide = setTimeout(fcHideTooltip, 2500);
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
