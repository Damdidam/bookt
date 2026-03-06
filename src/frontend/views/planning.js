/**
 * Planning v2 — Staff Absences (PRO)
 * Monthly grid with minimalist labels, half-day support, premium modal,
 * activity logs, email notification, and per-practitioner counters.
 */
import { api, sectorLabels } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// Minimalist labels: C M F A
const TYPE_LABELS = { conge: 'C', maladie: 'M', formation: 'F', autre: 'A' };
const TYPE_NAMES = { conge: 'Congé', maladie: 'Maladie', formation: 'Formation', autre: 'Autre' };
const PERIOD_LABELS = { full: 'Journée', am: 'Matin', pm: 'Après-midi' };

// SVG Icons (Lucide-style)
const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  thermometer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
  graduationCap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 4 3 6 3s6-1 6-3v-5"/></svg>',
  pauseCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  alertTriangle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/></svg>',
  sunset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="16 6 12 10 8 6"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
};

const TYPE_ICONS = { conge: ICONS.sun, maladie: ICONS.thermometer, formation: ICONS.graduationCap, autre: ICONS.pauseCircle };
const TYPE_COLORS = {
  conge: { bg: '#DBEAFE', border: '#93C5FD', text: '#1E3A8A', grad: 'linear-gradient(135deg,#3B82F6,#1D4ED8)' },
  maladie: { bg: '#FEE2E2', border: '#FECACA', text: '#991B1B', grad: 'linear-gradient(135deg,#EF4444,#B91C1C)' },
  formation: { bg: '#EDE9FE', border: '#C4B5FD', text: '#5B21B6', grad: 'linear-gradient(135deg,#8B5CF6,#6D28D9)' },
  autre: { bg: '#F3F4F6', border: '#D1D5DB', text: '#374151', grad: 'linear-gradient(135deg,#6B7280,#374151)' }
};

let currentYear, currentMonth; // 0-indexed month
let practitioners = [];
let absences = [];
let absenceMap = {}; // { pracId: { dayNum: [{ type, id, period, note }] } }
let statsData = {};

function initMonth() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
}

function monthKey() {
  return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
}

// ── Load planning view ──
async function loadPlanning() {
  initMonth();
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  await renderPlanning();
}

async function renderPlanning() {
  const c = document.getElementById('contentArea');
  try {
    const [pracR, absR, statsR] = await Promise.all([
      fetch('/api/practitioners', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/planning/absences?month=' + monthKey(), { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/planning/stats?month=' + monthKey(), { headers: { 'Authorization': 'Bearer ' + api.getToken() } })
    ]);
    const pracData = await pracR.json();
    const absData = await absR.json();
    const statsResult = await statsR.json();
    practitioners = (pracData.practitioners || []).filter(p => p.is_active);
    absences = absData.absences || [];
    statsData = statsResult;

    buildAbsenceMap();
    c.innerHTML = buildHTML();
  } catch (err) {
    console.error('Planning load error:', err);
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur de chargement: ${err.message}</div>`;
  }
}

function buildAbsenceMap() {
  absenceMap = {};
  absences.forEach(a => {
    if (!absenceMap[a.practitioner_id]) absenceMap[a.practitioner_id] = {};
    const from = new Date(a.date_from);
    const to = new Date(a.date_to);
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        const day = d.getDate();
        if (!absenceMap[a.practitioner_id][day]) absenceMap[a.practitioner_id][day] = [];
        absenceMap[a.practitioner_id][day].push({
          type: a.type, id: a.id, period: a.period || 'full', note: a.note
        });
      }
    }
  });
}

function buildHTML() {
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const todayDate = new Date();
  const isCurrentMonth = todayDate.getFullYear() === currentYear && todayDate.getMonth() === currentMonth;
  const todayDay = isCurrentMonth ? todayDate.getDate() : -1;
  const pracLabel = sectorLabels.practitioner || 'Praticien';

  if (practitioners.length === 0) {
    return `<div class="empty" style="text-align:center;padding:60px 20px">
      <div style="margin-bottom:16px;opacity:.6">${ICONS.calendar}</div>
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:8px">Aucun membre d'équipe</h3>
      <p style="color:var(--text-4);font-size:.85rem;margin-bottom:20px">Ajoutez des praticiens dans la section Équipe pour utiliser le planning.</p>
      <button class="btn-primary" onclick="document.querySelector('[data-section=team]').click()">Aller à l'équipe</button>
    </div>`;
  }

  let h = '';

  // Top bar
  h += `<div class="plan-top">
    <div class="plan-top-left">
      <span class="plan-title">
        ${ICONS.calendar}
        Planning du personnel
        <span class="plan-pro-badge">PRO</span>
      </span>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn-primary" onclick="planOpenModal()">
        ${ICONS.plus}
        Nouvelle absence
      </button>
    </div>
  </div>`;

  // Month nav
  h += `<div class="plan-month-nav">
    <button class="plan-month-btn" onclick="planPrevMonth()">‹</button>
    <h2>${MONTH_NAMES[currentMonth]} ${currentYear}</h2>
    <button class="plan-month-btn" onclick="planNextMonth()">›</button>
    <button class="plan-today-btn" onclick="planGoToday()">Aujourd'hui</button>
  </div>`;

  // Stats counters
  const totals = statsData.totals || {};
  h += `<div class="plan-stats">
    <div class="plan-stat s-conge">${ICONS.sun}<span>C</span><span class="ps-val">${formatDays(totals.conge || 0)}</span></div>
    <div class="plan-stat s-maladie">${ICONS.thermometer}<span>M</span><span class="ps-val">${formatDays(totals.maladie || 0)}</span></div>
    <div class="plan-stat s-formation">${ICONS.graduationCap}<span>F</span><span class="ps-val">${formatDays(totals.formation || 0)}</span></div>
    <div class="plan-stat s-autre">${ICONS.pauseCircle}<span>A</span><span class="ps-val">${formatDays(totals.autre || 0)}</span></div>
    <div class="plan-stat s-total">${ICONS.activity}<span>Total</span><span class="ps-val">${formatDays(totals.total || 0)}</span></div>
  </div>`;

  // Grid
  h += `<div class="plan-grid-wrap"><div class="plan-grid"><table class="plan-table"><thead><tr>`;
  h += `<th class="plan-prac-col">${esc(pracLabel)}</th>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(currentYear, currentMonth, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isToday = d === todayDay;
    const cls = isToday ? 'plan-today' : (isWeekend ? 'plan-weekend' : '');
    h += `<th class="${cls}">${DAY_NAMES[dow]}<br>${d}</th>`;
  }
  h += `</tr></thead><tbody>`;

  // Practitioner rows
  const pracStats = statsData.stats || {};
  practitioners.forEach(p => {
    const initials = (p.display_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const color = p.color || '#1E3A8A';
    const pAbsMap = absenceMap[p.id] || {};
    const ps = pracStats[p.id];

    // Per-practitioner counters
    let countersHTML = '';
    if (ps) {
      const counts = [];
      if (ps.conge > 0) counts.push(`<span class="plan-prac-cnt c-conge">C${formatDays(ps.conge)}</span>`);
      if (ps.maladie > 0) counts.push(`<span class="plan-prac-cnt c-maladie">M${formatDays(ps.maladie)}</span>`);
      if (ps.formation > 0) counts.push(`<span class="plan-prac-cnt c-formation">F${formatDays(ps.formation)}</span>`);
      if (ps.autre > 0) counts.push(`<span class="plan-prac-cnt c-autre">A${formatDays(ps.autre)}</span>`);
      if (counts.length) countersHTML = `<div class="plan-prac-counters">${counts.join('')}</div>`;
    }

    h += `<tr class="plan-prac-row"><td>
      <div class="plan-prac-cell">
        <div class="plan-prac-av" style="background:${esc(color)}">${initials}</div>
        <div class="plan-prac-details">
          <div class="plan-prac-nm">${esc(p.display_name)}</div>
          ${countersHTML}
        </div>
      </div>
    </td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(currentYear, currentMonth, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isToday = d === todayDay;
      let cls = 'plan-day-cell' + (isWeekend ? ' plan-weekend' : '') + (isToday ? ' plan-today' : '');
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      let inner = '';
      const dayAbsences = pAbsMap[d] || [];

      if (dayAbsences.length === 0) {
        // Empty cell
        if (isWeekend && dow === 0) {
          inner = `<span class="plan-avail-marker" style="opacity:.3">—</span>`;
        }
      } else if (dayAbsences.length === 1 && dayAbsences[0].period === 'full') {
        // Full day absence
        const a = dayAbsences[0];
        const label = TYPE_LABELS[a.type] || 'A';
        inner = `<div class="plan-abs-block ${a.type}" title="${esc(TYPE_NAMES[a.type])}${a.note ? ': ' + esc(a.note) : ''}" onclick="event.stopPropagation();planOpenModal(null,'${dateStr}','${a.id}')">${label}</div>`;
      } else {
        // Half-day or multiple entries — split cell
        const amAbs = dayAbsences.find(a => a.period === 'am' || a.period === 'full');
        const pmAbs = dayAbsences.find(a => a.period === 'pm' || (a.period === 'full' && a !== amAbs));
        inner = `<div class="plan-split">`;
        if (amAbs) {
          const label = TYPE_LABELS[amAbs.type] || 'A';
          inner += `<div class="plan-split-am"><div class="plan-abs-block ${amAbs.type}" style="margin:1px 2px;font-size:.55rem" title="Matin: ${esc(TYPE_NAMES[amAbs.type])}" onclick="event.stopPropagation();planOpenModal(null,'${dateStr}','${amAbs.id}')">${label}</div></div>`;
        } else {
          inner += `<div class="plan-split-am"></div>`;
        }
        if (pmAbs) {
          const label = TYPE_LABELS[pmAbs.type] || 'A';
          inner += `<div class="plan-split-pm"><div class="plan-abs-block ${pmAbs.type}" style="margin:1px 2px;font-size:.55rem" title="Après-midi: ${esc(TYPE_NAMES[pmAbs.type])}" onclick="event.stopPropagation();planOpenModal(null,'${dateStr}','${pmAbs.id}')">${label}</div></div>`;
        } else {
          inner += `<div class="plan-split-pm"></div>`;
        }
        inner += `</div>`;
      }

      h += `<td class="${cls}" onclick="planOpenModal('${p.id}','${dateStr}')">${inner}</td>`;
    }
    h += `</tr>`;
  });

  // Summary row
  h += `<tr class="plan-summary-row">`;
  h += `<td style="text-align:left;padding-left:16px;font-size:.72rem">Effectif</td>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(currentYear, currentMonth, d).getDay();
    if (dow === 0) {
      h += `<td>—</td>`;
    } else {
      let present = 0;
      practitioners.forEach(p => {
        const dayAbs = (absenceMap[p.id] || {})[d] || [];
        const hasFullAbsence = dayAbs.some(a => a.period === 'full');
        if (!hasFullAbsence) present++;
      });
      const total = practitioners.length;
      const cls = present >= Math.ceil(total * 0.7) ? 'count-good' : (present >= Math.ceil(total * 0.4) ? 'count-warn' : 'count-bad');
      h += `<td class="${cls}">${present}</td>`;
    }
  }
  h += `</tr></tbody></table></div></div>`;

  return h;
}

function formatDays(n) {
  if (n === 0) return '0';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace('.0', '');
}

// ── Month navigation ──
function planPrevMonth() {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderPlanning();
}

function planNextMonth() {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderPlanning();
}

function planGoToday() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  renderPlanning();
}

// ── Premium Modal (cal-modal pattern) ──
let _editingAbsenceId = null;
let _currentTab = 'details';

function planOpenModal(pracId, dateStr, absId) {
  const old = document.getElementById('planAbsOverlay');
  if (old) old.remove();

  _editingAbsenceId = absId || null;
  _currentTab = 'details';

  const isEdit = !!absId;
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = dateStr || today;
  const toDate = dateStr || today;

  // Find absence data if editing
  let absData = null;
  if (isEdit) {
    absData = absences.find(a => a.id === absId);
  }

  const currentType = absData?.type || 'conge';
  const currentPeriod = absData?.period || 'full';
  const tc = TYPE_COLORS[currentType];

  // Practitioner options
  let pracOptions = practitioners.map(p =>
    `<option value="${p.id}" ${(absData?.practitioner_id === p.id || p.id === pracId) ? 'selected' : ''}>${esc(p.display_name)}</option>`
  ).join('');

  // Get practitioner info for header
  const selectedPracId = absData?.practitioner_id || pracId || practitioners[0]?.id;
  const selectedPrac = practitioners.find(p => p.id === selectedPracId);
  const pracInitials = selectedPrac ? (selectedPrac.display_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
  const pracColor = selectedPrac?.color || '#1E3A8A';

  const overlay = document.createElement('div');
  overlay.id = 'planAbsOverlay';
  overlay.className = 'cal-modal-overlay open';
  overlay.onclick = e => { if (e.target === overlay) planCloseModal(); };

  overlay.innerHTML = `
    <div class="cal-modal" style="max-width:540px;overflow:hidden;display:flex;flex-direction:column;max-height:85vh">

      <!-- Header -->
      <div class="m-header">
        <div class="m-header-bg" id="planModalHeaderBg" style="background:${tc.grad}"></div>
        <button class="m-close" onclick="planCloseModal()">${ICONS.close}</button>
        <div class="m-header-content">
          <div class="m-client-hero">
            <div class="m-avatar" style="background:${esc(pracColor)}">${pracInitials}</div>
            <div class="m-client-info">
              <div class="m-client-name" id="planModalTitle">${isEdit ? esc(absData?.practitioner_name || '') : 'Nouvelle absence'}</div>
              <div class="m-client-meta">
                <span id="planModalSubtitle">${isEdit ? esc(TYPE_NAMES[currentType]) + ' · ' + esc(PERIOD_LABELS[currentPeriod]) : 'Planifiez une absence'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="m-tabs">
        <div class="m-tab active" data-tab="details" onclick="planSwitchTab('details')">Détails</div>
        ${isEdit ? '<div class="m-tab" data-tab="log" onclick="planSwitchTab(\'log\')">Historique</div>' : ''}
      </div>

      <!-- Body -->
      <div class="cal-modal-body" style="padding:20px 24px;overflow-y:auto;flex:1;min-height:0">

        <!-- Details panel -->
        <div class="cal-panel active" id="planPanelDetails">

          <!-- Type -->
          <div class="m-sec">
            <div class="m-sec-head"><span class="m-sec-title">Type</span><span class="m-sec-line"></span></div>
            <div class="plan-type-pills" id="planTypePills">
              ${['conge', 'maladie', 'formation', 'autre'].map(t => `
                <div class="plan-type-pill${currentType === t ? ' active-' + t : ''}" data-type="${t}" onclick="planPickType(this)">
                  ${TYPE_ICONS[t]} ${TYPE_NAMES[t]}
                </div>`).join('')}
            </div>
          </div>

          <!-- Practitioner -->
          <div class="m-sec">
            <div class="m-sec-head"><span class="m-sec-title">Praticien</span><span class="m-sec-line"></span></div>
            <select id="planAbsPrac" class="m-input" ${isEdit ? 'disabled' : ''} onchange="planUpdateHeader()">${pracOptions}</select>
          </div>

          <!-- Period dates -->
          <div class="m-sec">
            <div class="m-sec-head"><span class="m-sec-title">Période</span><span class="m-sec-line"></span></div>
            <div class="m-row m-row-2">
              <div>
                <div class="m-field-label">Du</div>
                <input type="date" id="planAbsFrom" class="m-input" value="${absData ? absData.date_from?.slice?.(0, 10) || fromDate : fromDate}" onchange="planCheckImpact()">
              </div>
              <div>
                <div class="m-field-label">Au</div>
                <input type="date" id="planAbsTo" class="m-input" value="${absData ? absData.date_to?.slice?.(0, 10) || toDate : toDate}" onchange="planCheckImpact()">
              </div>
            </div>
          </div>

          <!-- Day period -->
          <div class="m-sec">
            <div class="m-sec-head"><span class="m-sec-title">Journée</span><span class="m-sec-line"></span></div>
            <div class="plan-period-pills" id="planPeriodPills">
              <div class="plan-period-pill${currentPeriod === 'full' ? ' active' : ''}" data-period="full" onclick="planPickPeriod(this)">
                ${ICONS.clock} Journée complète
              </div>
              <div class="plan-period-pill${currentPeriod === 'am' ? ' active' : ''}" data-period="am" onclick="planPickPeriod(this)">
                ${ICONS.sunrise} Matin
              </div>
              <div class="plan-period-pill${currentPeriod === 'pm' ? ' active' : ''}" data-period="pm" onclick="planPickPeriod(this)">
                ${ICONS.sunset} Après-midi
              </div>
            </div>
          </div>

          <!-- Note -->
          <div class="m-sec">
            <div class="m-sec-head"><span class="m-sec-title">Note</span><span class="m-sec-line"></span></div>
            <textarea id="planAbsNote" class="m-input" rows="2" placeholder="Vacances, formation coloration...">${esc(absData?.note || '')}</textarea>
          </div>

          <!-- Impact -->
          <div id="planImpactZone"></div>

        </div>

        <!-- Log panel -->
        <div class="cal-panel" id="planPanelLog">
          <div id="planLogContent" style="min-height:100px">
            <div class="loading" style="padding:20px"><div class="spinner"></div></div>
          </div>
        </div>

      </div>

      <!-- Bottom bar -->
      <div class="m-bottom">
        ${isEdit ? `<button class="m-btn m-btn-danger" onclick="planDeleteAbsence('${absId}')" style="display:flex;align-items:center;gap:4px">${ICONS.trash} Supprimer</button>` : ''}
        ${isEdit && absData?.practitioner_email ? `<button class="m-btn m-btn-ghost" onclick="planNotifyPractitioner('${absId}')" style="display:flex;align-items:center;gap:4px">${ICONS.mail} Notifier</button>` : ''}
        <div style="flex:1"></div>
        <button class="m-btn m-btn-ghost" onclick="planCloseModal()">Annuler</button>
        <button class="m-btn m-btn-primary" id="planAbsSaveBtn" onclick="planSaveAbsence()">${isEdit ? 'Enregistrer' : 'Confirmer'}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Auto-check impact
  if (pracId || absData) setTimeout(planCheckImpact, 100);
}

function planCloseModal() {
  const m = document.getElementById('planAbsOverlay');
  if (m) m.remove();
  _editingAbsenceId = null;
}

function planSwitchTab(tab) {
  _currentTab = tab;
  document.querySelectorAll('#planAbsOverlay .m-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('#planAbsOverlay .cal-panel').forEach(p => {
    p.classList.remove('active');
  });
  const panelId = tab === 'details' ? 'planPanelDetails' : 'planPanelLog';
  document.getElementById(panelId)?.classList.add('active');

  if (tab === 'log' && _editingAbsenceId) {
    planLoadLogs(_editingAbsenceId);
  }
}

function planPickType(pill) {
  document.querySelectorAll('#planTypePills .plan-type-pill').forEach(p => p.className = 'plan-type-pill');
  pill.className = 'plan-type-pill active-' + pill.dataset.type;

  // Update header gradient
  const tc = TYPE_COLORS[pill.dataset.type];
  const bg = document.getElementById('planModalHeaderBg');
  if (bg) bg.style.background = tc.grad;

  planUpdateSubtitle();
}

function planPickPeriod(pill) {
  document.querySelectorAll('#planPeriodPills .plan-period-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  planUpdateSubtitle();
}

function planUpdateHeader() {
  const pracId = document.getElementById('planAbsPrac')?.value;
  const prac = practitioners.find(p => p.id === pracId);
  if (!prac || _editingAbsenceId) return;

  const title = document.getElementById('planModalTitle');
  if (title) title.textContent = prac.display_name;

  // Update avatar
  const avatar = document.querySelector('#planAbsOverlay .m-avatar');
  if (avatar) {
    avatar.style.background = prac.color || '#1E3A8A';
    avatar.textContent = (prac.display_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
}

function planUpdateSubtitle() {
  const sub = document.getElementById('planModalSubtitle');
  if (!sub) return;
  const type = planGetSelectedType();
  const period = planGetSelectedPeriod();
  sub.textContent = `${TYPE_NAMES[type]} · ${PERIOD_LABELS[period]}`;
}

function planGetSelectedType() {
  const active = document.querySelector('#planTypePills .plan-type-pill[class*="active-"]');
  return active?.dataset.type || 'conge';
}

function planGetSelectedPeriod() {
  const active = document.querySelector('#planPeriodPills .plan-period-pill.active');
  return active?.dataset.period || 'full';
}

// ── Impact preview ──
async function planCheckImpact() {
  const zone = document.getElementById('planImpactZone');
  if (!zone) return;
  const pracId = document.getElementById('planAbsPrac')?.value;
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  if (!pracId || !from || !to) return;

  try {
    const r = await fetch(`/api/planning/impact?practitioner_id=${pracId}&date_from=${from}&date_to=${to}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await r.json();
    const count = data.count || 0;

    if (count > 0) {
      zone.innerHTML = `<div class="plan-impact warn">
        ${ICONS.alertTriangle}
        <div><strong>${count} RDV impacté${count > 1 ? 's' : ''}</strong> sur cette période</div>
      </div>`;
    } else {
      zone.innerHTML = `<div class="plan-impact ok">
        ${ICONS.checkCircle}
        <div>Aucun RDV impacté</div>
      </div>`;
    }
  } catch (e) {
    zone.innerHTML = '';
  }
}

// ── Save absence ──
async function planSaveAbsence() {
  const btn = document.getElementById('planAbsSaveBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Enregistrement...';

  const pracId = document.getElementById('planAbsPrac')?.value;
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  const note = document.getElementById('planAbsNote')?.value;
  const type = planGetSelectedType();
  const period = planGetSelectedPeriod();

  if (!pracId || !from || !to) {
    btn.disabled = false;
    btn.textContent = _editingAbsenceId ? 'Enregistrer' : 'Confirmer';
    return;
  }

  try {
    const url = _editingAbsenceId ? `/api/planning/absences/${_editingAbsenceId}` : '/api/planning/absences';
    const method = _editingAbsenceId ? 'PATCH' : 'POST';
    const body = _editingAbsenceId
      ? { date_from: from, date_to: to, type, note, period }
      : { practitioner_id: pracId, date_from: from, date_to: to, type, note, period };

    const r = await fetch(url, {
      method,
      headers: { 'Authorization': 'Bearer ' + api.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();

    if (!r.ok) {
      alert(data.error || 'Erreur');
      btn.disabled = false;
      btn.textContent = _editingAbsenceId ? 'Enregistrer' : 'Confirmer';
      return;
    }

    _editingAbsenceId = null;
    planCloseModal();
    await renderPlanning();
  } catch (e) {
    alert('Erreur: ' + e.message);
    btn.disabled = false;
    btn.textContent = _editingAbsenceId ? 'Enregistrer' : 'Confirmer';
  }
}

// ── Delete absence ──
async function planDeleteAbsence(absId) {
  if (!confirm('Supprimer cette absence ?')) return;

  try {
    const r = await fetch(`/api/planning/absences/${absId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) {
      const data = await r.json();
      alert(data.error || 'Erreur');
      return;
    }
    _editingAbsenceId = null;
    planCloseModal();
    await renderPlanning();
  } catch (e) {
    alert('Erreur: ' + e.message);
  }
}

// ── Notify practitioner (email) ──
async function planNotifyPractitioner(absId) {
  const btn = document.querySelector('#planAbsOverlay .m-btn-ghost[onclick*="planNotifyPractitioner"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `${ICONS.mail} Envoi...`;
  }

  try {
    const r = await fetch(`/api/planning/absences/${absId}/notify`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await r.json();

    if (r.ok) {
      if (btn) btn.innerHTML = `${ICONS.checkCircle} Envoyé`;
      setTimeout(() => { if (btn) { btn.innerHTML = `${ICONS.mail} Notifier`; btn.disabled = false; } }, 3000);
    } else {
      alert(data.error || 'Erreur d\'envoi');
      if (btn) { btn.innerHTML = `${ICONS.mail} Notifier`; btn.disabled = false; }
    }
  } catch (e) {
    alert('Erreur: ' + e.message);
    if (btn) { btn.innerHTML = `${ICONS.mail} Notifier`; btn.disabled = false; }
  }
}

// ── Load activity logs ──
async function planLoadLogs(absId) {
  const container = document.getElementById('planLogContent');
  if (!container) return;

  try {
    const r = await fetch(`/api/planning/absences/${absId}/logs`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await r.json();
    const logs = data.logs || [];

    if (logs.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-4)">
        <div style="margin-bottom:8px;opacity:.5">${ICONS.clock}</div>
        <p style="font-size:.82rem">Aucune activité enregistrée</p>
      </div>`;
      return;
    }

    const actionLabels = {
      created: 'Absence créée',
      modified: 'Absence modifiée',
      cancelled: 'Absence annulée',
      email_sent: 'Notification envoyée'
    };

    let h = '';
    logs.forEach(log => {
      const date = new Date(log.created_at);
      const dateStr = date.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = date.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });

      let detailStr = '';
      if (log.action === 'modified' && log.details?.changes) {
        const changes = log.details.changes;
        const parts = [];
        if (changes.type) parts.push(`Type: ${TYPE_NAMES[changes.type.from] || changes.type.from} → ${TYPE_NAMES[changes.type.to] || changes.type.to}`);
        if (changes.period) parts.push(`Période: ${PERIOD_LABELS[changes.period.from] || changes.period.from} → ${PERIOD_LABELS[changes.period.to] || changes.period.to}`);
        if (changes.date_from) parts.push(`Date début modifiée`);
        if (changes.date_to) parts.push(`Date fin modifiée`);
        if (changes.note) parts.push(`Note modifiée`);
        detailStr = parts.join(' · ');
      } else if (log.action === 'email_sent' && log.details?.to) {
        detailStr = `→ ${esc(log.details.to)}`;
      }

      h += `<div class="plan-log-item">
        <div class="plan-log-dot ${log.action}"></div>
        <div class="plan-log-info">
          <div class="plan-log-action">${actionLabels[log.action] || log.action}</div>
          <div class="plan-log-meta">${dateStr} à ${timeStr}${log.actor_name ? ' · ' + esc(log.actor_name) : ''}</div>
          ${detailStr ? `<div class="plan-log-detail">${detailStr}</div>` : ''}
        </div>
      </div>`;
    });

    container.innerHTML = h;
  } catch (e) {
    container.innerHTML = `<div style="color:var(--red);font-size:.82rem;padding:20px">Erreur: ${e.message}</div>`;
  }
}

// ── Bridge ──
bridge({
  planPrevMonth,
  planNextMonth,
  planGoToday,
  planOpenModal,
  planCloseModal,
  planPickType,
  planPickPeriod,
  planSwitchTab,
  planSaveAbsence,
  planDeleteAbsence,
  planNotifyPractitioner,
  planCheckImpact,
  planUpdateHeader,
  planLoadLogs
});

export { loadPlanning };
