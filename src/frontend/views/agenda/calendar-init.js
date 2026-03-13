/**
 * Calendar Init - slot duration helper, hex alpha, refresh, and calendar instantiation.
 */
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';
import { api, calState } from '../../state.js';
import { fcIsMobile, fcIsTouch } from '../../utils/touch.js';
import { buildEventsCallback } from './calendar-data.js';
import { buildEventContent, buildEventClassNames } from './calendar-render.js';
import { buildEventDidMount, buildEventWillUnmount } from './calendar-hooks.js';
import { buildDateClick, buildEventDrop, buildEventResize, buildEventOverlap, buildEventAllow } from './calendar-interactions.js';
import { fcHideTooltip } from './tooltip-renderer.js';
import { fsIsActive, fsHandleDateClick } from './calendar-featured.js';
import { atUpdateTitle } from './calendar-toolbar.js';
import { fcLoadMobileList } from './calendar-mobile.js';

// ── Absence helpers ──

/** Fetch absences for a given month (YYYY-MM) and store in calState */
var _absenceLoadedMonth = null;
async function fcLoadAbsences(monthStr) {
  if (_absenceLoadedMonth === monthStr) return; // already loaded
  try {
    const resp = await fetch('/api/planning/absences?month=' + monthStr, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (resp.ok) {
      const data = await resp.json();
      calState.fcAbsences = data.absences || [];
      _absenceLoadedMonth = monthStr;
    }
  } catch (_) { /* silent */ }
}

/** Get absence period for a practitioner on a given date string (YYYY-MM-DD).
 *  Returns null | 'full' | 'am' | 'pm' */
function fcGetAbsencePeriod(pracId, dateStr) {
  for (var i = 0; i < calState.fcAbsences.length; i++) {
    var abs = calState.fcAbsences[i];
    if (String(abs.practitioner_id) !== String(pracId)) continue;
    var from = abs.date_from.slice(0, 10);
    var to = abs.date_to.slice(0, 10);
    if (dateStr >= from && dateStr <= to) {
      if (from === to) return abs.period || 'full';
      if (dateStr === from) return abs.period || 'full';
      if (dateStr === to) return abs.period_end || 'full';
      return 'full';
    }
  }
  return null;
}

/** Apply hatching overlay on resource columns of absent practitioners (day views only) */
function fcApplyAbsenceOverlays() {
  // Remove all existing overlays
  document.querySelectorAll('.fc-col-absent-overlay').forEach(function (el) { el.remove(); });
  var cal = calState.fcCal;
  if (!cal) return;
  var view = cal.view;
  if (!view || (view.type !== 'timeGridDay' && view.type !== 'resourceTimeGridDay')) return;
  var dateStr = view.currentStart.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });

  // Find resource columns in the timegrid body
  var cols = document.querySelectorAll('td.fc-timegrid-col[data-resource-id]');
  cols.forEach(function (col) {
    var pracId = col.getAttribute('data-resource-id');
    var period = fcGetAbsencePeriod(pracId, dateStr);
    if (!period) return;

    // Create overlay div inside the column
    var overlay = document.createElement('div');
    overlay.className = 'fc-col-absent-overlay';
    // For half-day: position top or bottom half
    if (period === 'am') {
      overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;height:50%;z-index:1;pointer-events:none;' +
        'background:repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(180,83,9,0.06) 5px,rgba(180,83,9,0.06) 10px)';
    } else if (period === 'pm') {
      overlay.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:50%;z-index:1;pointer-events:none;' +
        'background:repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(180,83,9,0.06) 5px,rgba(180,83,9,0.06) 10px)';
    } else {
      overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;' +
        'background:repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(180,83,9,0.06) 5px,rgba(180,83,9,0.06) 10px)';
    }
    // Ensure parent is positioned
    col.style.position = 'relative';
    col.appendChild(overlay);
  });
}

/**
 * Convert hex color to rgba with alpha.
 */
function fcHexAlpha(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const r = parseInt(hex.substring(0, 2), 16), g = parseInt(hex.substring(2, 4), 16), b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Darken a hex color by a factor (0-1). factor=0.7 → 30% darker.
 */
function fcDarkenHex(hex, factor) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const r = Math.round(parseInt(hex.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(hex.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(hex.substring(4, 6), 16) * factor);
  return '#' + [r, g, b].map(c => Math.min(255, c).toString(16).padStart(2, '0')).join('');
}

/**
 * Convert minutes to HH:MM:00 slot duration string.
 */
function fcSlotDuration(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return h + ':' + m + ':00';
}

/**
 * Refresh calendar events and mobile list.
 */
function fcRefresh() {
  if (calState.fcCal) {
    calState.fcCal.refetchEvents();
    if (typeof calState.fcCal.refetchResources === 'function') calState.fcCal.refetchResources();
  }
  if (fcIsMobile() && calState.fcMobileView === 'list') fcLoadMobileList();
}

/**
 * Initialize FullCalendar on the #fcCalendar element.
 * @param {string} initView - initial view name (e.g. 'timeGridWeek')
 * @param {string} initSlotDur - initial slot duration (e.g. '00:15:00')
 */
function initCalendar(initView, initSlotDur) {
  // If today is a hidden day (e.g. Sunday), jump to the next visible day
  let initialDate;
  const today = new Date();
  const fcToday = today.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  if (calState.fcHiddenDays.includes(fcToday)) {
    for (let i = 1; i <= 7; i++) {
      if (!calState.fcHiddenDays.includes((fcToday + i) % 7)) {
        initialDate = new Date(today);
        initialDate.setDate(today.getDate() + i);
        break;
      }
    }
  }

  // Rolling week: start from yesterday (or last visible day before today)
  if (initView === 'rollingWeek') {
    initialDate = new Date(today);
    initialDate.setDate(today.getDate() - 1);
    while (calState.fcHiddenDays.includes(initialDate.getDay())) {
      initialDate.setDate(initialDate.getDate() - 1);
    }
  }

  calState.fcCalOptions = {
    locale: 'fr',
    initialView: initView,
    ...(initialDate && { initialDate }),
    views: {
      rollingWeek: {
        type: 'timeGrid',
        duration: { days: 7 },
        dateAlignment: 'day'
      }
    },
    headerToolbar: false,
    slotMinTime: calState.fcSlotMin, slotMaxTime: calState.fcSlotMax,
    hiddenDays: calState.fcHiddenDays,
    businessHours: calState.fcBusinessHours.length > 0 ? calState.fcBusinessHours : { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
    slotDuration: initSlotDur, slotLabelInterval: '01:00:00',
    allDaySlot: false, nowIndicator: true, navLinks: true,
    height: 'auto', stickyHeaderDates: true, firstDay: 1,
    // ── FullCalendar Scheduler (Premium) ──
    schedulerLicenseKey: '0417328187-fcs-1772975945',
    resources: function (fetchInfo, successCb) {
      var pracs = calState.fcPractitioners || [];
      var filter = calState.fcCurrentFilter;
      var list = filter === 'all' ? pracs : pracs.filter(function (p) { return String(p.id) === String(filter); });
      successCb(list.map(function (p) {
        return {
          id: String(p.id),
          title: p.display_name,
          businessHours: (calState.fcPracBusinessHours[p.id] || []).length > 0 ? calState.fcPracBusinessHours[p.id] : [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' }],
          extendedProps: { color: p.color || '#0D7377' }
        };
      }));
    },
    resourceLabelContent: function (arg) {
      var color = arg.resource.extendedProps?.color || '#0D7377';
      var name = arg.resource.title;
      // Show absence badge in day views
      var absHtml = '';
      var view = calState.fcCal && calState.fcCal.view;
      if (view && (view.type === 'timeGridDay' || view.type === 'resourceTimeGridDay')) {
        var dateStr = view.currentStart.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        var period = fcGetAbsencePeriod(arg.resource.id, dateStr);
        if (period === 'full') {
          absHtml = '<span style="display:block;font-size:.68rem;font-weight:600;color:#B45309;margin-top:1px">Absent(e) journée</span>';
        } else if (period === 'am') {
          absHtml = '<span style="display:block;font-size:.68rem;font-weight:600;color:#B45309;margin-top:1px">Absent(e) matin</span>';
        } else if (period === 'pm') {
          absHtml = '<span style="display:block;font-size:.68rem;font-weight:600;color:#B45309;margin-top:1px">Absent(e) après-midi</span>';
        }
      }
      return { html: '<span style="display:inline-flex;align-items:center;gap:8px;padding:2px 0"><span style="width:10px;height:10px;border-radius:50%;background:' + color + ';flex-shrink:0;box-shadow:0 0 0 3px ' + color + '22"></span><span style="font-weight:700;font-size:.84rem;color:#1A2332;letter-spacing:.2px">' + name + absHtml + '</span></span>' };
    },
    dayMaxEvents: 3,
    // ── Resource Timeline (Premium) ──
    resourceAreaWidth: '140px',
    resourceAreaHeaderContent: 'Praticien',
    editable: !calState.fcLocked, snapDuration: '00:05:00',
    selectable: false,
    slotEventOverlap: false,
    eventOrder: function (a, b) {
      // Events with pose (processing_time) render first (behind others)
      var ptA = parseInt(a.extendedProps && a.extendedProps.processing_time) || 0;
      var ptB = parseInt(b.extendedProps && b.extendedProps.processing_time) || 0;
      if (ptA > 0 && ptB === 0) return -1;
      if (ptB > 0 && ptA === 0) return 1;
      return 0;
    },
    longPressDelay: fcIsTouch ? 800 : 300,

    // Callbacks from calendar-data / render / hooks / interactions
    eventOverlap: buildEventOverlap(),
    eventAllow: buildEventAllow(),
    events: buildEventsCallback(),
    eventContent: buildEventContent(),
    eventClassNames: buildEventClassNames(),
    eventClick: function (info) {
      // Gap analyzer: clicking a gap background opens quick-create
      if (info.event.extendedProps?._isGapAnalyzer) {
        const pracId = info.event.extendedProps?.practitioner_id || info.event.getResources()?.[0]?.id;
        const startTime = info.event.startStr?.slice(11, 16);
        if (window.gaFillGap) window.gaFillGap(pracId, startTime, null);
        return;
      }
      // In vedette mode, clicking a booked event toggles featured slot at that time
      if (fsIsActive() && !info.event.extendedProps?._isFeaturedSlot) {
        fsHandleDateClick(info.event.startStr);
        return;
      }
    },
    navLinkDayClick: function (date) {
      calState.fcCal.changeView('resourceTimeGridDay', date);
    },
    eventDidMount: buildEventDidMount(),
    eventWillUnmount: buildEventWillUnmount(),
    dateClick: buildDateClick(),
    eventDrop: buildEventDrop(),
    eventResize: buildEventResize()
  };

  calState.fcCalOptions.plugins = [dayGridPlugin, timeGridPlugin, interactionPlugin, resourceTimeGridPlugin];
  calState.fcCal = new Calendar(document.getElementById('fcCalendar'), calState.fcCalOptions);
  calState.fcCal.render();

  // Bug B6 fix: remove before re-adding to prevent listener leak on re-init
  const calEl = document.getElementById('fcCalendar');
  if (calEl) {
    calEl.removeEventListener('scroll', fcHideTooltip, true);
    calEl.addEventListener('scroll', fcHideTooltip, true);
  }

  // Update toolbar title & date on every navigation/view change
  // Guard: remove existing listener to prevent accumulation if re-initialized
  calState.fcCal.off('datesSet');
  var _prevAbsMonth = null;
  calState.fcCal.on('datesSet', function () {
    atUpdateTitle();
    // Sync view buttons (for navLinkDayClick, etc.)
    var vt = calState.fcCal.view.type;
    document.querySelectorAll('.at-vp-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === vt); });
    // Load absences for visible month — only refetch resources if month changed
    var viewStart = calState.fcCal.view.currentStart;
    var m = viewStart.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }).slice(0, 7);
    var monthChanged = (m !== _prevAbsMonth);
    _prevAbsMonth = m;
    var isDayView = (vt === 'timeGridDay' || vt === 'resourceTimeGridDay');
    fcLoadAbsences(m).then(function () {
      // Only refetch resources when month changes (absence badges update)
      if (monthChanged && calState.fcCal) calState.fcCal.refetchResources();
      // Absence overlays only apply in day views
      if (isDayView) fcApplyAbsenceOverlays();
    });
  });
  atUpdateTitle(); // initial
}

export { fcSlotDuration, fcHexAlpha, fcDarkenHex, fcRefresh, initCalendar, fcLoadAbsences };
