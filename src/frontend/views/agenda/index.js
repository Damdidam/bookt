/**
 * Agenda - main orchestrator.
 * Fetches practitioners, services, availability, business data,
 * computes calendar bounds / hidden days / business hours,
 * builds toolbar HTML, initialises FullCalendar, and sets up SSE.
 */
import { api, calState, userRole, user } from '../../state.js';
import { getContentArea } from '../../utils/dom.js';
import { fcIsMobile, fcIsTouch } from '../../utils/touch.js';
import { bridge } from '../../utils/window-bridge.js';

// Sub-module imports
import { fcSlotDuration, fcRefresh, initCalendar } from './calendar-init.js';
import { atUpdateTitle } from './calendar-toolbar.js';
import { fcLoadMobileList } from './calendar-mobile.js';
import { setupSSE } from './calendar-sse.js';
import { fcOpenQuickCreate, setupQuickCreateListeners } from './quick-create.js';

// Force side-effect imports so bridge() calls register the global handlers
import './color-swatches.js';
import './booking-notes.js';
import './booking-todos.js';
import './booking-reminders.js';
import './booking-status.js';
import './booking-edit.js';
import './booking-save.js';
import './booking-detail.js';
import './calendar-toolbar.js';
import './calendar-mobile.js';

// ── Practitioner filter ──
function fcFilterPractitioner(id, el) {
  calState.fcCurrentFilter = id;
  // Sync all pill copies (desktop at-filters + mobile at-row2)
  document.querySelectorAll('.prac-pill:not(.st-toggle)').forEach(p => {
    p.classList.toggle('active', p.textContent.trim() === el.textContent.trim());
  });

  // Adapt slot grid to practitioner's increment
  let inc = 15;
  if (id === 'all') {
    const incs = calState.fcPractitioners.map(p => p.slot_increment_min || 15);
    if (incs.length > 0) inc = Math.min(...incs);
  } else {
    const prac = calState.fcPractitioners.find(p => p.id === id);
    inc = prac?.slot_increment_min || 15;
  }
  const dur = fcSlotDuration(inc);
  calState.fcCal.setOption('slotDuration', dur);
  calState.fcCal.setOption('snapDuration', dur);

  fcRefresh();
}

// ── Status toggle ──
function fcToggleStatus(status, el) {
  if (status === 'cancelled') { calState.fcShowCancelled = !calState.fcShowCancelled; }
  else if (status === 'no_show') { calState.fcShowNoShow = !calState.fcShowNoShow; }
  // Sync all copies (desktop + mobile)
  const isActive = el.classList.contains('active');
  document.querySelectorAll('.prac-pill.st-toggle').forEach(p => {
    if (p.textContent.trim() === el.textContent.trim()) p.classList.toggle('active', !isActive);
  });
  fcRefresh();
}

// ── Main loadAgenda ──
async function loadAgenda() {
  const c = getContentArea();
  c.classList.add('agenda-active');
  document.querySelector('.main').classList.add('agenda-mode');
  c.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const [prRes, svRes, avRes, bizRes] = await Promise.all([
      fetch('/api/practitioners', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/services', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/availabilities', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/business', { headers: { 'Authorization': 'Bearer ' + api.getToken() } })
    ]);
    const prD = await prRes.json(), svD = await svRes.json(), avD = await avRes.json(), bizD = await bizRes.json();
    calState.fcPractitioners = prD.practitioners || [];
    calState.fcServices = svD.services || [];
    calState.fcAllowOverlap = !!(bizD.business?.settings?.allow_overlap);

    // Compute calendar bounds from availability data
    const avails = avD.availabilities || {};
    const allStarts = [], allEnds = [];
    for (const pracId of Object.keys(avails)) {
      const sched = avails[pracId].schedule || {};
      for (const day of Object.keys(sched)) {
        for (const slot of sched[day]) {
          if (slot.start_time) allStarts.push(slot.start_time);
          if (slot.end_time) allEnds.push(slot.end_time);
        }
      }
    }
    if (allStarts.length > 0) {
      allStarts.sort(); allEnds.sort();
      const minH = Math.max(0, parseInt(allStarts[0].split(':')[0]) - 1);
      const maxH = Math.min(23, parseInt(allEnds[allEnds.length - 1].split(':')[0]) + 1);
      calState.fcSlotMin = String(minH).padStart(2, '0') + ':00:00';
      calState.fcSlotMax = String(maxH).padStart(2, '0') + ':00:00';
    } else {
      calState.fcSlotMin = '08:00:00'; calState.fcSlotMax = '19:00:00';
    }

    // Compute hidden days (no availability at all) and business hours
    // DB weekday: 0=Monday...6=Sunday. FullCalendar: 0=Sunday...6=Saturday
    const dbDayToFcDay = d => (d + 1) % 7; // 0(Mon)->1, 4(Fri)->5, 6(Sun)->0
    const normTime = t => { if (!t) return '09:00'; const s = String(t); return s.slice(0, 5); }; // "09:00:00" -> "09:00"
    const activeDays = new Set();
    calState.fcBusinessHours = [];
    calState.fcPracBusinessHours = {};
    for (const pracId of Object.keys(avails)) {
      const sched = avails[pracId].schedule || {};
      if (!calState.fcPracBusinessHours[pracId]) calState.fcPracBusinessHours[pracId] = [];
      for (const day of Object.keys(sched)) {
        const slots = sched[day].filter(s => s.is_active !== false);
        if (slots.length > 0) {
          const fcDay = dbDayToFcDay(parseInt(day));
          activeDays.add(fcDay);
          slots.forEach(s => {
            const entry = { daysOfWeek: [fcDay], startTime: normTime(s.start_time), endTime: normTime(s.end_time) };
            calState.fcBusinessHours.push(entry);
            calState.fcPracBusinessHours[pracId].push(entry);
          });
        }
      }
    }
    // Days 0-6 not in activeDays -> hidden
    calState.fcHiddenDays = [];
    for (let d = 0; d < 7; d++) { if (!activeDays.has(d)) calState.fcHiddenDays.push(d); }
  } catch (e) { calState.fcPractitioners = []; calState.fcServices = []; }

  // Build filter pills HTML (shared between desktop & mobile)
  const isPrac = userRole === 'practitioner';
  let pillsHtml = '';
  if (isPrac) {
    calState.fcCurrentFilter = user?.practitioner_id || 'all';
    pillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowCancelled ? 'active' : ''}" onclick="fcToggleStatus('cancelled',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>Annul\u00e9s</div>`;
    pillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowNoShow ? 'active' : ''}" onclick="fcToggleStatus('no_show',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--gold)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>No-show</div>`;
  } else {
    pillsHtml += `<div class="prac-pill active" onclick="fcFilterPractitioner('all',this)"><span class="dot" style="background:var(--primary)"></span>Tous</div>`;
    calState.fcPractitioners.forEach(p => { pillsHtml += `<div class="prac-pill" onclick="fcFilterPractitioner('${p.id}',this)"><span class="dot" style="background:${p.color || 'var(--primary)'}"></span>${p.display_name}</div>`; });
    pillsHtml += `<div class="at-sep" style="width:1px;height:18px;background:var(--border-light);flex-shrink:0"></div>`;
    pillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowCancelled ? 'active' : ''}" onclick="fcToggleStatus('cancelled',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>Annul\u00e9s</div>`;
    pillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowNoShow ? 'active' : ''}" onclick="fcToggleStatus('no_show',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--gold)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>No-show</div>`;
  }

  // Build unified toolbar
  const mobile = fcIsMobile();
  const initView = mobile ? 'timeGridDay' : 'timeGridWeek';
  let toolbar = `<div class="agenda-toolbar">`;
  // Desktop: Row 1 -- nav + title + views + date
  toolbar += `<div class="at-row-nav"><div class="at-nav"><button class="at-nav-btn" onclick="atNav('prev')">\u2039</button><button class="at-today" onclick="atNav('today')">Aujourd'hui</button><button class="at-nav-btn" onclick="atNav('next')">\u203a</button></div><span class="at-title" id="atTitle"></span><div class="at-views"><button class="at-view-btn" data-view="timeGridDay" onclick="atView('timeGridDay')">Jour</button><button class="at-view-btn${initView === 'timeGridWeek' ? ' active' : ''}" data-view="timeGridWeek" onclick="atView('timeGridWeek')">Semaine</button><button class="at-view-btn" data-view="dayGridMonth" onclick="atView('dayGridMonth')">Mois</button></div><span class="at-date" id="atDate"></span></div>`;
  // Desktop: Row 2 -- filter pills
  toolbar += `<div class="at-row-filters">${pillsHtml}</div>`;
  // Mobile: Row 1 -- nav + title + list/grid icons (hidden on desktop via CSS)
  toolbar += `<div class="at-row1"><div class="at-nav"><button class="at-nav-btn" onclick="atNav('prev')">\u2039</button><button class="at-today" onclick="atNav('today')">Auj.</button><button class="at-nav-btn" onclick="atNav('next')">\u203a</button></div><span class="at-title-mob" id="atTitleMob"></span><div class="at-mob-views"><button class="at-mob-vbtn ${calState.fcMobileView === 'list' ? 'active' : ''}" onclick="atMobView('list')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button><button class="at-mob-vbtn ${calState.fcMobileView !== 'list' ? 'active' : ''}" onclick="atMobView('grid')">\u25a6</button></div></div>`;
  // Mobile: Row 2 -- pills scrollable
  toolbar += `<div class="at-row2">${pillsHtml}</div>`;
  toolbar += `</div>`;

  c.innerHTML = toolbar + `<div id="fcCalendar" style="${mobile && calState.fcMobileView === 'list' ? 'display:none' : ''}"></div><div id="fcMobList" class="mob-list ${mobile && calState.fcMobileView === 'list' ? 'active' : ''}"></div>` +
    (mobile ? `<button class="cal-fab" onclick="fcOpenQuickCreate()" title="Nouveau RDV">+</button>` : '');

  // Compute initial slot increment from all practitioners
  const allIncs = calState.fcPractitioners.map(p => p.slot_increment_min || 15);
  const initInc = allIncs.length > 0 ? Math.min(...allIncs) : 15;
  const initSlotDur = fcSlotDuration(initInc);

  // Init FullCalendar
  initCalendar(initView, initSlotDur);

  // SSE: real-time calendar updates
  setupSSE();

  // Setup quick create listeners (once)
  setupQuickCreateListeners();

  // Touch devices: setup swipe navigation
  if (fcIsTouch) {
    if (fcIsMobile()) {
      // If today is a hidden day, start on next visible day
      const _today = new Date();
      const _fcDay = _today.getDay();
      if (calState.fcHiddenDays.includes(_fcDay)) {
        for (let i = 1; i <= 7; i++) {
          if (!calState.fcHiddenDays.includes((_fcDay + i) % 7)) {
            _today.setDate(_today.getDate() + i);
            break;
          }
        }
      }
      calState.fcMobileDate = _today;
      fcLoadMobileList();

      // Sync list date when calendar navigates
      calState.fcCal.on('datesSet', function (info) {
        calState.fcMobileDate = info.start;
        if (calState.fcMobileView === 'list') fcLoadMobileList();
      });
    }
  }
}

// Expose to global scope for onclick handlers
bridge({ loadAgenda, fcFilterPractitioner, fcToggleStatus });

export { loadAgenda };
