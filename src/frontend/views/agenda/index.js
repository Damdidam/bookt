/**
 * Agenda - main orchestrator.
 * Fetches practitioners, services, availability, business data,
 * computes calendar bounds / hidden days / business hours,
 * builds toolbar HTML, initialises FullCalendar, and sets up SSE.
 */
import { api, calState, userRole, user, allowedSections, GendaUI } from '../../state.js';
import { getContentArea, esc, escJs } from '../../utils/dom.js';
import { safeColor } from '../../utils/safe-color.js';
import { fcIsMobile, fcIsTablet, fcIsTouch } from '../../utils/touch.js';
import { bridge } from '../../utils/window-bridge.js';

// Sub-module imports
import { fcSlotDuration, fcRefresh, initCalendar } from './calendar-init.js';
import { atUpdateTitle } from './calendar-toolbar.js';
import { fcLoadMobileList } from './calendar-mobile.js';
import { setupSSE } from './calendar-sse.js';
import { fcOpenQuickCreate, setupQuickCreateListeners } from './quick-create.js';
import { fsIsActive, fsOnDatesSet, fsDeactivate } from './calendar-featured.js';
import { gaIsActive, gaOnDatesSet, gaOnFilterChanged, gaDeactivate } from './gap-analyzer.js';
import { soIsActive, soDeactivate, soOnDatesSet, soRefreshSlots } from './smart-optimizer.js';
import { buildEventsCallback } from './calendar-data.js';

// Force side-effect imports so bridge() calls register the global handlers
import './color-swatches.js';
import './booking-todos.js';
import './booking-reminders.js';
import './booking-status.js';
import './booking-edit.js';
import './booking-save.js';
import './booking-undo.js';
import './booking-detail.js';
import './booking-ungroup.js';
import './calendar-toolbar.js';
import './calendar-mobile.js';
import './calendar-featured.js';
import './gap-analyzer.js';
import './smart-optimizer.js';
import './task-detail.js';

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
  calState.fcCal.setOption('snapDuration', '00:05:00');

  // Star button always visible for owner (auto-enable on use)

  fcRefresh();
  gaOnFilterChanged();
}

// ── Booking search ──
let _searchTimer = null;
function fcSearchBookings(q) {
  clearTimeout(_searchTimer);
  calState.calSearchQuery = (q || '').trim().toLowerCase();
  _searchTimer = setTimeout(() => fcRefresh(), 200);
}

// ── Status toggle ──
function fcToggleStatus(status, el) {
  if (status === 'cancelled') { calState.fcShowCancelled = !calState.fcShowCancelled; }
  else if (status === 'no_show') { calState.fcShowNoShow = !calState.fcShowNoShow; }
  else if (status === 'pending') { calState.fcShowPending = !calState.fcShowPending; }
  else if (status === 'completed') { calState.fcShowCompleted = !calState.fcShowCompleted; }
  // Sync all copies (desktop + mobile)
  const isActive = el.classList.contains('active');
  document.querySelectorAll('.prac-pill.st-toggle').forEach(p => {
    if (p.textContent.trim() === el.textContent.trim()) p.classList.toggle('active', !isActive);
  });
  fcRefresh();
  _updateStBadge();
}

function fcToggleStatusPills() {
  const els = document.querySelectorAll('.at-status-pills');
  if (!els.length) return;
  const show = els[0].style.display === 'none';
  els.forEach(el => el.style.display = show ? 'flex' : 'none');
  document.querySelectorAll('.at-tog').forEach(b => {
    if (b.getAttribute('title') === 'Filtres statut') b.classList.toggle('active', show);
  });
}
function _updateStBadge() {
  const count = [calState.fcShowPending, calState.fcShowCancelled, calState.fcShowNoShow, calState.fcShowCompleted].filter(Boolean).length;
  document.querySelectorAll('.at-st-badge').forEach(b => { b.textContent = count || ''; b.style.display = count ? '' : 'none'; });
}

function fcToggleCatPills() {
  const els = document.querySelectorAll('.at-cat-inner');
  if (!els.length) return;
  const show = els[0].style.display === 'none';
  els.forEach(el => el.style.display = show ? 'flex' : 'none');
  document.querySelectorAll('.at-tog').forEach(b => {
    if (b.getAttribute('title') === 'Catégories') b.classList.toggle('active', show);
  });
}

// ── Category filter ──
function fcFilterCategory(cat, el) {
  if (cat === '__all__') {
    // Toggle all: if all visible -> hide all, else show all
    const allChips = document.querySelectorAll('.cat-chip:not([data-cat="__all__"])');
    const allVisible = calState.fcHiddenCategories.size === 0;
    if (allVisible) {
      allChips.forEach(c => { c.classList.remove('active'); calState.fcHiddenCategories.add(c.dataset.cat); });
      el.classList.remove('active');
    } else {
      calState.fcHiddenCategories.clear();
      allChips.forEach(c => c.classList.add('active'));
      el.classList.add('active');
    }
  } else {
    if (calState.fcHiddenCategories.has(cat)) {
      calState.fcHiddenCategories.delete(cat);
      el.classList.add('active');
    } else {
      calState.fcHiddenCategories.add(cat);
      el.classList.remove('active');
    }
    // Update "Tout" chip
    const allBtn = document.querySelector('.cat-chip[data-cat="__all__"]');
    if (allBtn) allBtn.classList.toggle('active', calState.fcHiddenCategories.size === 0);
  }
  // Nuke event source and re-add — forces FC to re-create all events from scratch
  // (buildEventsCallback sets bg/border, eventContent sets bold/dim labels)
  if (calState.fcCal) {
    calState.fcCal.getEventSources().forEach(s => s.remove());
    calState.fcCal.addEventSource(buildEventsCallback());
  }
  // Refresh mobile list if active
  if (fcIsMobile() && calState.fcMobileView === 'list') fcLoadMobileList();
}

// ── Main loadAgenda ──
async function loadAgenda() {
  const c = getContentArea();
  c.classList.add('agenda-active');
  document.querySelector('.main').classList.add('agenda-mode');
  c.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const auth = { headers: { 'Authorization': 'Bearer ' + api.getToken() } };
    const [prRes, svRes, avRes, bizRes, bhRes] = await Promise.all([
      fetch('/api/practitioners', auth),
      fetch('/api/services', auth),
      fetch('/api/availabilities', auth),
      fetch('/api/business', auth),
      fetch('/api/business-hours', auth)
    ]);
    const prD = await prRes.json(), svD = await svRes.json(), avD = await avRes.json(), bizD = await bizRes.json();
    const bhD = await bhRes.json();
    calState.fcPractitioners = prD.practitioners || [];
    calState.fcServices = svD.services || [];
    calState.fcAllowOverlap = !!(bizD.business?.settings?.allow_overlap);
    calState.fcColorMode = bizD.business?.settings?.calendar_color_mode || 'category';
    calState.calSearchQuery = '';
    calState.fcBusinessSettings = bizD.business?.settings || {};
    calState.fcDefaultView = bizD.business?.settings?.default_calendar_view || 'week';

    // Compute calendar bounds — prefer business_schedule (salon hours), fallback to practitioner avails
    const avails = avD.availabilities || {};
    const bizSched = bhD.schedule || {};
    const hasBizSched = Object.keys(bizSched).length > 0;

    const allStarts = [], allEnds = [];
    // Business schedule bounds (primary)
    if (hasBizSched) {
      for (const day of Object.keys(bizSched)) {
        for (const slot of bizSched[day]) {
          if (slot.start_time) allStarts.push(slot.start_time);
          if (slot.end_time) allEnds.push(slot.end_time);
        }
      }
    }
    // Also include practitioner avails for completeness
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

    // Compute hidden days and business hours
    // DB weekday: 0=Monday...6=Sunday. FullCalendar: 0=Sunday...6=Saturday
    const dbDayToFcDay = d => (d + 1) % 7; // 0(Mon)->1, 4(Fri)->5, 6(Sun)->0
    const normTime = t => { if (!t) return '09:00'; const s = String(t); return s.slice(0, 5); }; // "09:00:00" -> "09:00"
    const activeDays = new Set();
    calState.fcBusinessHours = [];
    calState.fcPracBusinessHours = {};

    // Use business schedule as primary business hours for calendar shading
    if (hasBizSched) {
      for (const day of Object.keys(bizSched)) {
        const slots = bizSched[day];
        if (slots.length > 0) {
          const fcDay = dbDayToFcDay(parseInt(day));
          activeDays.add(fcDay);
          slots.forEach(s => {
            calState.fcBusinessHours.push({ daysOfWeek: [fcDay], startTime: normTime(s.start_time), endTime: normTime(s.end_time) });
          });
        }
      }
    }

    // Always compute per-practitioner hours (for practitioner filtering)
    for (const pracId of Object.keys(avails)) {
      const sched = avails[pracId].schedule || {};
      if (!calState.fcPracBusinessHours[pracId]) calState.fcPracBusinessHours[pracId] = [];
      for (const day of Object.keys(sched)) {
        const slots = sched[day].filter(s => s.is_active !== false);
        if (slots.length > 0) {
          const fcDay = dbDayToFcDay(parseInt(day));
          if (!hasBizSched) activeDays.add(fcDay); // fallback: use practitioner data for active days
          slots.forEach(s => {
            const entry = { daysOfWeek: [fcDay], startTime: normTime(s.start_time), endTime: normTime(s.end_time) };
            if (!hasBizSched) calState.fcBusinessHours.push(entry); // fallback
            calState.fcPracBusinessHours[pracId].push(entry);
          });
        }
      }
    }

    // Days 0-6 not in activeDays -> hidden
    calState.fcHiddenDays = [];
    for (let d = 0; d < 7; d++) { if (!activeDays.has(d)) calState.fcHiddenDays.push(d); }
  } catch (e) { calState.fcPractitioners = []; calState.fcServices = []; }

  // Build filter pills — separate prac pills from status toggles
  const isPrac = userRole === 'practitioner';
  let pillsHtml = '';
  let statusPillsHtml = '';
  // Status toggles (shared by all roles)
  statusPillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowPending ? 'active' : ''}" onclick="fcToggleStatus('pending',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--amber)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>En attente</div>`;
  statusPillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowCancelled ? 'active' : ''}" onclick="fcToggleStatus('cancelled',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>Annul\u00e9s</div>`;
  statusPillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowNoShow ? 'active' : ''}" onclick="fcToggleStatus('no_show',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--gold)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>No-show</div>`;
  statusPillsHtml += `<div class="prac-pill st-toggle ${calState.fcShowCompleted ? 'active' : ''}" onclick="fcToggleStatus('completed',this)" style="font-size:.68rem;gap:4px"><span style="color:var(--text-3)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg></span>Termin\u00e9s</div>`;
  if (isPrac) {
    calState.fcCurrentFilter = user?.practitioner_id || 'all';
  } else if (calState.fcPractitioners.length <= 1) {
    // Solo practitioner: no pills, filter = all (show everything)
    calState.fcCurrentFilter = 'all';
  } else {
    pillsHtml += `<div class="prac-pill active" onclick="fcFilterPractitioner('all',this)"><span class="dot" style="background:var(--primary)"></span>Tous<span class="prac-fill" data-fill-id="all"></span></div>`;
    // P2 hotfix (audit scan 2) : valide p.color via safeColor() helper pour
    // éviter CSS injection (p.color owner-contrôlé, sans CHECK DB).
    calState.fcPractitioners.forEach(p => {
      const ini = p.display_name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      pillsHtml += `<div class="prac-pill" onclick="fcFilterPractitioner('${p.id}',this)" title="${esc(p.display_name)}"><span class="dot" style="background:${safeColor(p.color)}"></span>${esc(ini)}<span class="prac-fill" data-fill-id="${p.id}"></span></div>`;
    });
  }

  // Build category filter chips (inner only — no wrapper div)
  const catSet = new Set();
  calState.fcServices.forEach(s => { if (s.is_active !== false) catSet.add(s.category || ''); });
  const categories = [...catSet].sort((a, b) => (a || 'zzz').localeCompare(b || 'zzz'));
  calState.fcHiddenCategories = new Set();
  let catChipsInnerHtml = '';
  if (categories.length > 1) {
    catChipsInnerHtml += `<div class="at-sep" style="width:1px;height:18px;background:var(--border-light);flex-shrink:0"></div>`;
    catChipsInnerHtml += `<div class="cat-chip active" data-cat="__all__" onclick="fcFilterCategory('__all__',this)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg> Tout</div>`;
    // P1 hotfix (audit scan 2) : escape ${cat} + ${label} + safeColor() pour
    // prévenir XSS stocké via category owner-saisie + CSS injection via color.
    categories.forEach(cat => {
      const label = cat || 'Autres';
      const svcOfCat = calState.fcServices.find(s => (s.category || '') === cat && s.is_active !== false);
      catChipsInnerHtml += `<div class="cat-chip active" data-cat="${esc(cat)}" onclick="fcFilterCategory('${escJs(cat)}',this)"><span class="dot" style="background:${safeColor(svcOfCat?.color)}"></span>${esc(label)}</div>`;
    });
    if (categories.length > 3) {
      catChipsInnerHtml = `<button class="at-tog" onclick="fcToggleCatPills()" title="Catégories"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button><div class="at-cat-inner" style="display:none">${catChipsInnerHtml}</div>`;
    }
  }

  // Build unified toolbar
  const mobile = fcIsMobile();
  const tablet = fcIsTablet();
  const viewMap = { day: 'resourceTimeGridDay', week: 'rollingWeek', month: 'dayGridMonth' };
  const initView = mobile ? 'timeGridDay' : (viewMap[calState.fcDefaultView] || 'rollingWeek');
  const canFeatured = userRole === 'owner' && calState.fcBusinessSettings?.featured_slots_enabled;
  const fsBtnHtml = canFeatured ? `<button class="at-view-btn fs-toggle-btn" id="fsToggleBtn" onclick="fsToggleMode()" title="Mode vedette"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>` : '';
  const canGap = userRole === 'owner' && calState.fcBusinessSettings?.gap_analyzer_enabled;
  const gaBtnHtml = canGap ? `<button class="at-view-btn ga-toggle-btn" id="gaToggleBtn" onclick="gaToggleMode()" title="Analyseur de gaps"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg><span class="ga-badge" id="gaBadge" style="display:none"></span></button>` : '';
  const soBtnHtml = userRole === 'owner' ? `<button class="at-view-btn so-toggle-btn" id="soToggleBtn" onclick="soToggleMode()" title="Quick booking"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>` : '';
  // Lock button
  const lockBtnHtml = `<button class="at-view-btn at-lock-btn" id="calLockBtn" onclick="fcToggleLock()" title="Verrouiller le calendrier"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M17 11V7a5 5 0 0 0-9.58-2"/></svg></button>`;

  // Compute today's label for the nav button
  const _n = new Date();
  const _da = ['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'][_n.getDay()];
  const _ma = ['Janv.','F\u00e9vr.','Mars','Avr.','Mai','Juin','Juil.','Ao\u00fbt','Sept.','Oct.','Nov.','D\u00e9c.'][_n.getMonth()];
  const todayLabel = `${_da} ${_n.getDate()} ${_ma}`;

  let toolbar = `<div class="agenda-toolbar">`;
  // Desktop: Row 1 -- nav + title + actions (search, SO, lock, overflow)
  const searchHtml = `<input type="search" id="calSearch" class="at-search at-search-hidden" placeholder="Rechercher un client..." oninput="fcSearchBookings(this.value)">`;
  const searchIconSvg = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  toolbar += `<div class="at-row-nav">`;
  toolbar += `<button class="at-hamburger hamburger" onclick="toggleDrawer()" aria-label="Menu"><svg class="gi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>`;
  toolbar += `<div class="at-nav"><button class="at-nav-btn" onclick="atNav('prev')">\u2039</button><button class="at-today" id="atDate" onclick="atNav('today')">${todayLabel}</button><button class="at-nav-btn" onclick="atNav('next')">\u203a</button></div>`;
  toolbar += `<span class="at-title" id="atTitle"></span>`;
  toolbar += `<div class="at-actions">`;
  toolbar += `<div class="at-search-wrap" id="atSearchWrap"><button class="at-search-icon" onclick="fcToggleSearch()" title="Rechercher">${searchIconSvg}</button>${searchHtml}</div>`;
  toolbar += fsBtnHtml;
  toolbar += gaBtnHtml;
  toolbar += soBtnHtml;
  toolbar += lockBtnHtml;
  toolbar += `<button class="at-overflow-btn hamburger" onclick="toggleOverflowMenu()" aria-label="Plus d'options"><svg class="gi" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>`;
  toolbar += `<div class="at-overflow-menu" id="atOverflowMenu"></div>`;
  toolbar += `</div>`;
  toolbar += `</div>`;
  // Desktop: Row 2 -- view switcher + practitioner pills + status pills
  toolbar += `<div class="at-row-filters">`;
  toolbar += `<div class="at-view-pill">`;
  toolbar += `<button class="at-vp-btn${initView === 'resourceTimeGridDay' || initView === 'timeGridDay' ? ' active' : ''}" data-view="resourceTimeGridDay" onclick="atView('resourceTimeGridDay')"><span class="vl">Jour</span><span class="vs">J</span></button>`;
  toolbar += `<button class="at-vp-btn${initView === 'rollingWeek' ? ' active' : ''}" data-view="rollingWeek" onclick="atView('rollingWeek')"><span class="vl">Semaine</span><span class="vs">S</span></button>`;
  toolbar += `<button class="at-vp-btn${initView === 'dayGridMonth' ? ' active' : ''}" data-view="dayGridMonth" onclick="atView('dayGridMonth')"><span class="vl">Mois</span><span class="vs">M</span></button>`;
  toolbar += `</div>`;
  if (pillsHtml) {
    toolbar += `<div class="at-filter-sep"></div>`;
    toolbar += `<div class="at-prac-pills">${pillsHtml}</div>`;
  }
  toolbar += `<div class="at-filter-sep"></div>`;
  toolbar += `<button class="at-tog" onclick="fcToggleStatusPills()" title="Filtres statut"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg><span class="at-tog-badge at-st-badge"></span></button>`;
  toolbar += `<div class="at-status-pills" style="display:none">${statusPillsHtml}</div>`;
  if (catChipsInnerHtml) {
    toolbar += `<div class="at-cat-chips">${catChipsInnerHtml}</div>`;
  }
  toolbar += `</div>`;
  // Desktop: Fill bar
  toolbar += `<div class="at-row-stats" id="atRowStats"><div class="fill-bar"><div class="fill-bar-inner" id="fillBarInner"></div></div></div>`;
  // Mobile: Row 1 -- nav + title + SO + list/grid icons (hidden on desktop via CSS)
  toolbar += `<div class="at-row1"><div class="at-nav"><button class="at-nav-btn" onclick="atNav('prev')">\u2039</button><button class="at-today" id="atDateMob" onclick="atNav('today')">${todayLabel}</button><button class="at-nav-btn" onclick="atNav('next')">\u203a</button></div><span class="at-title-mob" id="atTitleMob"></span><div class="at-mob-views">${soBtnHtml}<button class="at-mob-vbtn ${calState.fcMobileView === 'list' ? 'active' : ''}" onclick="atMobView('list')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button><button class="at-mob-vbtn ${calState.fcMobileView !== 'list' ? 'active' : ''}" onclick="atMobView('grid')">\u25a6</button></div></div>`;
  // Mobile: Row 2 -- prac pills + status pills + search (scrollable)
  const mobSearchHtml = `<input type="search" id="calSearchMob" class="at-search" placeholder="Rechercher..." oninput="fcSearchBookings(this.value)">`;
  toolbar += `<div class="at-row2">${pillsHtml}<button class="at-tog" onclick="fcToggleStatusPills()" title="Filtres statut"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg><span class="at-tog-badge at-st-badge"></span></button><div class="at-status-pills" style="display:none">${statusPillsHtml}</div>${catChipsInnerHtml ? `<div class="at-cat-chips">${catChipsInnerHtml}</div>` : ''}${mobSearchHtml}</div>`;
  toolbar += `</div>`;

  c.innerHTML = toolbar + `<div id="fcCalendar" style="${mobile && calState.fcMobileView === 'list' ? 'display:none' : ''}"></div><div id="fcMobList" class="mob-list ${mobile && calState.fcMobileView === 'list' ? 'active' : ''}"></div>` +
    ((mobile || tablet) ? `<button class="cal-fab" onclick="fcOpenQuickCreate()" title="Nouveau">+</button>` : '');

  // Compute initial slot increment from all practitioners
  const allIncs = calState.fcPractitioners.map(p => p.slot_increment_min || 15);
  const initInc = allIncs.length > 0 ? Math.min(...allIncs) : 15;
  const initSlotDur = fcSlotDuration(initInc);

  // Restore lock state BEFORE calendar init so editable option + events are correct from the start
  try { calState.fcLocked = localStorage.getItem('bookt_cal_locked') === '1'; } catch (_) {}

  // Init FullCalendar (uses calState.fcLocked for editable option)
  initCalendar(initView, initSlotDur);

  // Apply lock UI (button icon/class) — no need for setOption/refetchEvents, already baked into init
  if (calState.fcLocked) fcApplyLockUI();

  // Measure toolbar height for sticky column headers
  // B2-fix : retirer le listener précédent avant d'en ajouter un nouveau
  // (loadAgenda réappelé à chaque navigation → N handlers cumulés + closures
  // qui réfèrent à l'ancien DOM détaché).
  const tb = document.querySelector('.agenda-toolbar');
  if (tb) {
    if (window._agendaResizeHandler) {
      window.removeEventListener('resize', window._agendaResizeHandler);
    }
    const setToolbarH = () => c.style.setProperty('--toolbar-h', tb.offsetHeight + 'px');
    setToolbarH();
    window._agendaResizeHandler = setToolbarH;
    window.addEventListener('resize', setToolbarH);
  }

  // Star button always visible for owner (auto-enable on use)

  // SSE: real-time calendar updates
  setupSSE();

  // Setup quick create listeners (once)
  setupQuickCreateListeners();

  // Gap analyzer: silent scan for badge + morning toast
  setTimeout(() => { if (window.gaAutoScan) window.gaAutoScan(); }, 800);

  // Featured mode: reload slots when week changes, deactivate on month view
  // Debounced to avoid redundant API calls during rapid prev/next clicks
  let _featureDatesDebounce = null;
  calState.fcCal.on('datesSet', function (info) {
    if (info.view.type === 'dayGridMonth') { fsDeactivate(); soDeactivate(); }
    clearTimeout(_featureDatesDebounce);
    _featureDatesDebounce = setTimeout(function () {
      fsOnDatesSet();
      gaOnDatesSet();
      soOnDatesSet();
    }, 200);
  });

  // Real-time QB slot refresh: when events change (SSE booking_update → refetch),
  // re-render QB slots so taken slots disappear live while practitioner is browsing
  let _soEventsDebounce = null;
  calState.fcCal.on('eventsSet', function () {
    if (!soIsActive()) return;
    clearTimeout(_soEventsDebounce);
    _soEventsDebounce = setTimeout(() => soRefreshSlots(), 300);
  });

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

// ── Lock toggle ──
const LOCK_ICON = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const UNLOCK_ICON = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M17 11V7a5 5 0 0 0-9.58-2"/></svg>';

function fcApplyLockUI() {
  const btn = document.getElementById('calLockBtn');
  if (btn) {
    btn.classList.toggle('active', !!calState.fcLocked);
    btn.innerHTML = calState.fcLocked ? LOCK_ICON : UNLOCK_ICON;
  }
}

function fcToggleLock() {
  calState.fcLocked = !calState.fcLocked;
  try { localStorage.setItem('bookt_cal_locked', calState.fcLocked ? '1' : '0'); } catch (_) {}
  const cal = calState.fcCal;
  if (!cal) return;
  // Belt-and-suspenders: update global FC option AND refetch events
  // so both global defaults and per-event properties reflect lock state
  cal.setOption('editable', !calState.fcLocked);
  cal.refetchEvents();
  // Visual feedback
  fcApplyLockUI();
  GendaUI.toast(calState.fcLocked ? 'Calendrier verrouillé' : 'Calendrier déverrouillé', 'info');
}

// ── Filter panel toggle ──
function fcToggleFilterPanel() {
  const panel = document.getElementById('atFilterPanel');
  const btn = document.getElementById('atFilterToggle');
  if (!panel) return;
  panel.classList.toggle('open');
  if (btn) btn.classList.toggle('active');
  // Recalculate --toolbar-h for sticky headers after transition
  const recalc = () => {
    const tb = document.querySelector('.agenda-toolbar');
    const c = document.querySelector('.content.agenda-active');
    if (tb && c) c.style.setProperty('--toolbar-h', tb.offsetHeight + 'px');
  };
  // Immediate + after transition
  requestAnimationFrame(recalc);
  panel.addEventListener('transitionend', recalc, { once: true });
}

// ── Expandable search ──
function fcToggleSearch() {
  const wrap = document.getElementById('atSearchWrap');
  const input = document.getElementById('calSearch');
  if (!wrap || !input) return;
  if (wrap.classList.contains('expanded')) {
    wrap.classList.remove('expanded');
    input.value = '';
    fcSearchBookings('');
  } else {
    wrap.classList.add('expanded');
    setTimeout(() => input.focus(), 220);
  }
}

// Close search on click outside
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('atSearchWrap');
  if (wrap && wrap.classList.contains('expanded') && !wrap.contains(e.target)) {
    wrap.classList.remove('expanded');
  }
});

// ── Overflow menu toggle ──
function toggleOverflowMenu() {
  const menu = document.getElementById('atOverflowMenu');
  if (!menu) return;

  // Populate menu items before opening
  const isAdmin = userRole === 'owner';
  let items = '';

  if (isAdmin && calState.fcBusinessSettings?.featured_slots_enabled) {
    items += `<button class="at-overflow-item${fsIsActive() ? ' active' : ''}" onclick="fsToggleMode(); toggleOverflowMenu();">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      Créneaux vedettes</button>`;
  }
  if (isAdmin && calState.fcBusinessSettings?.gap_analyzer_enabled) {
    items += `<button class="at-overflow-item${gaIsActive() ? ' active' : ''}" onclick="gaToggleMode(); toggleOverflowMenu();">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      Analyseur de gaps</button>`;
  }
  if (isAdmin) {
    items += `<button class="at-overflow-item${soIsActive() ? ' active' : ''}" onclick="soToggleMode(); toggleOverflowMenu();">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      Quick booking</button>`;
  }

  // Category filter chips
  const catSet = new Set();
  (calState.fcServices || []).forEach(s => { if (s.is_active !== false) catSet.add(s.category || ''); });
  const cats = [...catSet].sort((a, b) => (a || 'zzz').localeCompare(b || 'zzz'));
  if (cats.length > 1) {
    items += `<div style="border-top:1px solid var(--border-light);padding:8px 12px 4px;font-size:.65rem;font-weight:700;text-transform:uppercase;color:var(--text-4);letter-spacing:.4px">Catégories</div>`;
    items += `<div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 12px 8px">`;
    const hidden = calState.fcHiddenCategories || new Set();
    items += `<div class="cat-chip${hidden.size === 0 ? ' active' : ''}" data-cat="__all__" onclick="fcFilterCategory('__all__',this);toggleOverflowMenu()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg> Tout</div>`;
    cats.forEach(cat => {
      const label = cat || 'Autres';
      const svc = (calState.fcServices || []).find(s => (s.category || '') === cat && s.is_active !== false);
      const color = svc?.color || 'var(--primary)';
      const isActive = !hidden.has(cat);
      items += `<div class="cat-chip${isActive ? ' active' : ''}" data-cat="${cat}" onclick="fcFilterCategory('${cat.replace(/'/g, "\\'")}',this)"><span class="dot" style="background:${color}"></span>${label}</div>`;
    });
    items += `</div>`;
  }

  menu.innerHTML = items;
  menu.classList.toggle('open');
  if (menu.classList.contains('open')) {
    setTimeout(() => {
      const close = (e) => { if (!e.target.closest('.at-overflow-menu,.at-overflow-btn')) { menu.classList.remove('open'); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  }
}

// Expose to global scope for onclick handlers
bridge({ loadAgenda, fcFilterPractitioner, fcToggleStatus, fcFilterCategory, fcSearchBookings, fcToggleLock, fcToggleFilterPanel, fcToggleSearch, toggleOverflowMenu, fcToggleStatusPills, fcToggleCatPills });

export { loadAgenda };
