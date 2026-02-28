/**
 * Calendar Init - slot duration helper, hex alpha, refresh, and calendar instantiation.
 */
import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { calState } from '../../state.js';
import { fcIsMobile } from '../../utils/touch.js';
import { fcIsTouch, fcIsTablet } from '../../utils/touch.js';
import {
  buildEventsCallback, buildEventContent, buildEventClassNames,
  buildEventDidMount, buildDateClick, buildEventDrop, buildEventResize,
  buildEventOverlap, buildEventAllow, fcHideTooltip
} from './calendar-events.js';
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
  if (calState.fcCal) calState.fcCal.refetchEvents();
  if (fcIsMobile() && calState.fcMobileView === 'list') fcLoadMobileList();
}

/**
 * Initialize FullCalendar on the #fcCalendar element.
 * @param {string} initView - initial view name (e.g. 'timeGridWeek')
 * @param {string} initSlotDur - initial slot duration (e.g. '00:15:00')
 */
function initCalendar(initView, initSlotDur) {
  calState.fcCalOptions = {
    locale: 'fr',
    initialView: initView,
    headerToolbar: false,
    slotMinTime: calState.fcSlotMin, slotMaxTime: calState.fcSlotMax,
    hiddenDays: calState.fcHiddenDays,
    businessHours: calState.fcBusinessHours.length > 0 ? calState.fcBusinessHours : { daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' },
    slotDuration: initSlotDur, slotLabelInterval: '01:00:00',
    allDaySlot: false, nowIndicator: true, navLinks: true,
    height: 'auto', stickyHeaderDates: true, firstDay: 1,
    dayMaxEvents: 3,
    editable: true, eventDurationEditable: !fcIsTouch || fcIsTablet(), eventStartEditable: true, snapDuration: initSlotDur,
    selectable: false,
    slotEventOverlap: false,
    longPressDelay: 500,

    // Callbacks from calendar-events.js
    eventOverlap: buildEventOverlap(),
    eventAllow: buildEventAllow(),
    events: buildEventsCallback(),
    eventContent: buildEventContent(),
    eventClassNames: buildEventClassNames(),
    eventClick: function () {}, // absorb single click (no-op)
    navLinkDayClick: function (date) {
      calState.fcCal.changeView('timeGridDay', date);
    },
    eventDidMount: buildEventDidMount(),
    dateClick: buildDateClick(),
    eventDrop: buildEventDrop(),
    eventResize: buildEventResize()
  };

  calState.fcCalOptions.plugins = [dayGridPlugin, timeGridPlugin, interactionPlugin];
  calState.fcCal = new Calendar(document.getElementById('fcCalendar'), calState.fcCalOptions);
  calState.fcCal.render();

  // Hide tooltip when scrolling calendar
  document.getElementById('fcCalendar')?.addEventListener('scroll', fcHideTooltip, true);

  // Update toolbar title & date on every navigation/view change
  calState.fcCal.on('datesSet', function () {
    atUpdateTitle();
  });
  atUpdateTitle(); // initial
}

export { fcSlotDuration, fcHexAlpha, fcRefresh, initCalendar };
