/**
 * Calendar Init - slot duration helper, hex alpha, refresh, and calendar instantiation.
 */
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';
import resourceTimelinePlugin from '@fullcalendar/resource-timeline';
import { calState } from '../../state.js';
import { fcIsMobile, fcIsTouch } from '../../utils/touch.js';
import { buildEventsCallback } from './calendar-data.js';
import { buildEventContent, buildEventClassNames } from './calendar-render.js';
import { buildEventDidMount, buildEventWillUnmount } from './calendar-hooks.js';
import { buildDateClick, buildEventDrop, buildEventResize, buildEventOverlap, buildEventAllow } from './calendar-interactions.js';
import { fcHideTooltip } from './tooltip-renderer.js';
import { fsIsActive, fsHandleDateClick } from './calendar-featured.js';
import { atUpdateTitle } from './calendar-toolbar.js';
import { fcLoadMobileList } from './calendar-mobile.js';

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

  calState.fcCalOptions = {
    locale: 'fr',
    initialView: initView,
    ...(initialDate && { initialDate }),
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
      return { html: '<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>' + arg.resource.title + '</span>' };
    },
    dayMaxEvents: 3,
    // ── Resource Timeline (Premium) ──
    resourceAreaWidth: '140px',
    resourceAreaHeaderContent: 'Praticien',
    editable: true, eventDurationEditable: !fcIsTouch, eventStartEditable: true, snapDuration: '00:05:00',
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

  calState.fcCalOptions.plugins = [dayGridPlugin, timeGridPlugin, interactionPlugin, resourceTimeGridPlugin, resourceTimelinePlugin];
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
  calState.fcCal.on('datesSet', function () {
    atUpdateTitle();
    // Sync view buttons (for navLinkDayClick, etc.)
    var vt = calState.fcCal.view.type;
    document.querySelectorAll('.at-view-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === vt); });
  });
  atUpdateTitle(); // initial
}

export { fcSlotDuration, fcHexAlpha, fcRefresh, initCalendar };
