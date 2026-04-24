/**
 * Planning v4 — Staff Absences (PRO)
 * Monthly grid with dynamic working days (from availabilities),
 * holiday support, CSV export, email planning, minimalist labels C/M/F/A,
 * modal, activity logs, email notification, per-practitioner counters.
 */
import { api, GendaUI, sectorLabels } from '../state.js';
import { trapFocus, releaseFocus } from '../utils/focus-trap.js';
import { esc } from '../utils/dom.js';
import { safeColor } from '../utils/safe-color.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';
import { closeModal, showConfirmDialog, guardModal } from '../utils/dirty-guard.js';

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const TYPE_LABELS = { conge: 'C', maladie: 'M', formation: 'F', autre: 'A' };
const TYPE_NAMES = { conge: 'Congé', maladie: 'Maladie', formation: 'Formation', autre: 'Indispo' };
const PERIOD_LABELS = { full: 'Journée', am: 'Matin', pm: 'Après-midi' };

// SVG Icons — dedup : aliases sur shared IC + locale pour icônes planning-specific.
const _planS = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const _planG = (d) => `<svg class="gi" viewBox="0 0 24 24" ${_planS}>${d}</svg>`;
const ICONS = {
  // Shared IC aliases
  sun: IC.sun,
  calendar: IC.calendar,
  plus: IC.plus,
  close: IC.x,
  alertTriangle: IC.alertTriangle,
  checkCircle: IC.checkCircle,
  trash: IC.trash,
  mail: IC.mail,
  clock: IC.clock,
  download: IC.download,
  send: IC.send,
  // Planning-specific
  thermometer: _planG('<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>'),
  graduationCap: _planG('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 4 3 6 3s6-1 6-3v-5"/>'),
  pauseCircle: _planG('<circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>'),
  sunrise: _planG('<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/>'),
  sunset: _planG('<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="16 6 12 10 8 6"/>'),
  activity: _planG('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
  flag: _planG('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>')
};

const TYPE_ICONS = { conge: ICONS.sun, maladie: ICONS.thermometer, formation: ICONS.graduationCap, autre: ICONS.pauseCircle };
const TYPE_COLORS = {
  conge: { bg: 'var(--blue-bg)', border: 'var(--blue-light)', text: 'var(--blue)', grad: 'linear-gradient(135deg,var(--blue),#1D4ED8)' },
  maladie: { bg: 'var(--red-bg)', border: 'var(--red-bg)', text: 'var(--red)', grad: 'linear-gradient(135deg,var(--red),#B91C1C)' },
  formation: { bg: 'var(--purple-bg)', border: 'var(--purple-light)', text: 'var(--purple)', grad: 'linear-gradient(135deg,var(--purple),#6D28D9)' },
  autre: { bg: 'var(--surface)', border: 'var(--border)', text: 'var(--text-2)', grad: 'linear-gradient(135deg,var(--text-3),var(--text-2))' }
};

let currentYear, currentMonth;
let practitioners = [];
let absences = [];
let absenceMap = {};
let statsData = {};
let practitionerWorkDays = {}; // { pracId: [0,1,2,3,4] } weekdays from availabilities (0=Mon)
let holidaysList = []; // [{ date: 'YYYY-MM-DD', name: '...' }]
let holidaysSet = new Set(); // Set of 'YYYY-MM-DD'

function initMonth() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
}

function monthKey() {
  return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
}

/**
 * Convert JS Date.getDay() (0=Sun) to availabilities weekday (0=Mon).
 */
function toAvailWeekday(jsDate) {
  return (jsDate.getDay() + 6) % 7;
}

/**
 * Check if a practitioner works on a specific date.
 * Uses practitionerWorkDays data from the availabilities table.
 * Fallback: if no data, consider all days as working days.
 */
function isPracWorkDay(pracId, jsDate) {
  // Check holidays first
  const ds = `${jsDate.getFullYear()}-${String(jsDate.getMonth() + 1).padStart(2, '0')}-${String(jsDate.getDate()).padStart(2, '0')}`;
  if (holidaysSet.has(ds)) return false;
  // Check practitioner schedule
  const days = practitionerWorkDays[pracId];
  if (!days || days.length === 0) return true; // Fallback: all days are workdays
  return days.includes(toAvailWeekday(jsDate));
}

/**
 * Check if ANY practitioner works on a specific date.
 * Used for column headers and summary row.
 */
function isAnybodyWorking(jsDate) {
  const ds = `${jsDate.getFullYear()}-${String(jsDate.getMonth() + 1).padStart(2, '0')}-${String(jsDate.getDate()).padStart(2, '0')}`;
  if (holidaysSet.has(ds)) return false;
  return practitioners.some(p => isPracWorkDay(p.id, jsDate));
}

/**
 * Get holiday name for a date string, or null.
 */
function getHolidayName(dateStr) {
  const h = holidaysList.find(h => h.date === dateStr);
  return h ? h.name : null;
}

/**
 * Get the effective period for a specific day within an absence.
 * First day → period, Last day → period_end, Middle → 'full', Single day → period.
 */
function getEffectivePeriod(absence, dayDate) {
  const fromStr = (typeof absence.date_from === 'string' ? absence.date_from : new Date(absence.date_from).toISOString()).slice(0, 10);
  const toStr = (typeof absence.date_to === 'string' ? absence.date_to : new Date(absence.date_to).toISOString()).slice(0, 10);
  const dayStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;

  if (fromStr === toStr) return absence.period || 'full';
  if (dayStr === fromStr) return absence.period || 'full';
  if (dayStr === toStr) return absence.period_end || 'full';
  return 'full';
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

    // Store working days and holidays from the absences response
    practitionerWorkDays = absData.workingDays || {};
    holidaysList = absData.holidays || [];
    holidaysSet = new Set(holidaysList.map(h => h.date));

    buildAbsenceMap();
    c.innerHTML = buildHTML();
  } catch (err) {
    console.error('Planning load error:', err);
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur de chargement: ${esc(err.message)}</div>`;
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

        // Compute effective period for THIS day based on position in range
        const effectivePeriod = getEffectivePeriod(a, d);

        absenceMap[a.practitioner_id][day].push({
          type: a.type, id: a.id, period: effectivePeriod, note: a.note
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
    <div style="display:flex;gap:8px;margin-left:auto">
      <button class="btn-outline btn-sm" onclick="planExportCSV()" style="display:flex;align-items:center;gap:4px">${ICONS.download} Export</button>
      <button class="btn-outline btn-sm" onclick="planOpenSendModal()" style="display:flex;align-items:center;gap:4px">${ICONS.send} Envoyer</button>
      <button class="btn-primary btn-sm" onclick="planOpenModal()">${ICONS.plus} Nouvelle absence</button>
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
    const dt = new Date(currentYear, currentMonth, d);
    const dow = dt.getDay();
    const anyoneWorking = isAnybodyWorking(dt);
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const holiday = getHolidayName(dateStr);
    const isToday = d === todayDay;

    let cls = '';
    if (isToday) cls = 'plan-today';
    else if (holiday) cls = 'plan-holiday';
    else if (!anyoneWorking) cls = 'plan-closed-day';

    const tooltip = holiday ? ` title="${esc(holiday)}"` : '';
    h += `<th class="${cls}"${tooltip}>${DAY_NAMES[dow]}<br>${d}${holiday ? '<span class="plan-holiday-dot"></span>' : ''}</th>`;
  }
  h += `</tr></thead><tbody>`;

  // Practitioner rows
  const pracStats = statsData.stats || {};
  practitioners.forEach(p => {
    const initials = (p.display_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const color = p.color || 'var(--blue)';
    const pAbsMap = absenceMap[p.id] || {};
    const ps = pracStats[p.id];

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
        <div class="plan-prac-av" style="background:${safeColor(color)}">${initials}</div>
        <div class="plan-prac-details">
          <div class="plan-prac-nm">${esc(p.display_name)}</div>
          ${countersHTML}
        </div>
      </div>
    </td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(currentYear, currentMonth, d);
      const isToday = d === todayDay;
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const holiday = getHolidayName(dateStr);
      const pracWorks = isPracWorkDay(p.id, dt);

      let cls = 'plan-day-cell';
      if (isToday) cls += ' plan-today';
      if (holiday) cls += ' plan-holiday';
      else if (!pracWorks) cls += ' plan-off-day';

      let inner = '';
      const dayAbsences = pAbsMap[d] || [];

      if (holiday) {
        // Holiday — show flag icon
        inner = `<span class="plan-holiday-marker" title="${esc(holiday)}">${ICONS.flag}</span>`;
      } else if (!pracWorks) {
        // Non-working day for this practitioner — show dash
        inner = `<span class="plan-avail-marker">—</span>`;
      } else if (dayAbsences.length === 0) {
        // Working day, no absence — empty
        inner = '';
      } else if (dayAbsences.length === 1 && dayAbsences[0].period === 'full') {
        const a = dayAbsences[0];
        const label = TYPE_LABELS[a.type] || 'A';
        inner = `<div class="plan-abs-block ${a.type}" title="${esc(TYPE_NAMES[a.type])}${a.note ? ': ' + esc(a.note) : ''}" onclick="planAbsClick(event,'${p.id}','${dateStr}','${a.id}')">${label}</div>`;
      } else {
        // Half-day or multiple entries — split cell
        const amAbs = dayAbsences.find(a => a.period === 'am' || a.period === 'full');
        const pmAbs = dayAbsences.find(a => a.period === 'pm' || (a.period === 'full' && a !== amAbs));
        inner = `<div class="plan-split">`;
        if (amAbs) {
          inner += `<div class="plan-split-am"><div class="plan-abs-block ${amAbs.type}" style="margin:1px 2px;font-size:.55rem" title="Matin: ${esc(TYPE_NAMES[amAbs.type])}" onclick="planAbsClick(event,'${p.id}','${dateStr}','${amAbs.id}')">${TYPE_LABELS[amAbs.type]}</div></div>`;
        } else {
          inner += `<div class="plan-split-am"></div>`;
        }
        if (pmAbs) {
          inner += `<div class="plan-split-pm"><div class="plan-abs-block ${pmAbs.type}" style="margin:1px 2px;font-size:.55rem" title="Après-midi: ${esc(TYPE_NAMES[pmAbs.type])}" onclick="planAbsClick(event,'${p.id}','${dateStr}','${pmAbs.id}')">${TYPE_LABELS[pmAbs.type]}</div></div>`;
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
  h += `<tr class="plan-summary-row"><td style="text-align:left;padding-left:16px;font-size:.72rem">Effectif</td>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(currentYear, currentMonth, d);
    const anyoneWorking = isAnybodyWorking(dt);

    if (!anyoneWorking) {
      h += `<td>—</td>`;
    } else {
      let present = 0;
      practitioners.forEach(p => {
        if (!isPracWorkDay(p.id, dt)) return; // Doesn't work this day
        const dayAbs = (absenceMap[p.id] || {})[d] || [];
        const hasFullAbsence = dayAbs.some(a => a.period === 'full');
        if (!hasFullAbsence) present++;
      });
      const totalWorking = practitioners.filter(p => isPracWorkDay(p.id, dt)).length;
      const cls = present >= Math.ceil(totalWorking * 0.7) ? 'count-good' : (present >= Math.ceil(totalWorking * 0.4) ? 'count-warn' : 'count-bad');
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
function planPrevMonth() { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } renderPlanning(); }
function planNextMonth() { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } renderPlanning(); }
function planGoToday() { const now = new Date(); currentYear = now.getFullYear(); currentMonth = now.getMonth(); renderPlanning(); }

// ── Export CSV ──
async function planExportCSV() {
  try {
    const r = await fetch('/api/planning/export?month=' + monthKey() + '&format=csv', {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error('Erreur export');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || `planning-${monthKey()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { GendaUI.toast('Erreur lors de l\'export', 'error'); }
}

// ── Send planning modal ──
function planOpenSendModal() {
  closeModal('planSendOverlay');

  const pracOptions = practitioners.map(p =>
    `<option value="${p.id}">${esc(p.display_name)}${p.email ? '' : ' (pas d\'email)'}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.id = 'planSendOverlay';
  overlay.className = 'm-overlay open';

  overlay.innerHTML = `
    <div class="m-dialog m-sm">
      <div class="m-header-simple">
        <h3>Envoyer le planning</h3>
        <button class="m-close" onclick="closeModal('planSendOverlay')" aria-label="Fermer">${ICONS.close}</button>
      </div>
      <div class="m-body">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Praticien</span><span class="m-sec-line"></span></div>
          <select id="planSendPrac" class="m-input">${pracOptions}</select>
        </div>
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Mois</span><span class="m-sec-line"></span></div>
          <input type="month" id="planSendMonth" class="m-input" value="${monthKey()}">
        </div>
      </div>
      <div class="m-bottom">
        <div style="flex:1"></div>
        <button class="m-btn m-btn-ghost" onclick="closeModal('planSendOverlay')">Annuler</button>
        <button class="m-btn m-btn-primary" id="planSendBtn" onclick="planDoSendPlanning()" style="display:flex;align-items:center;gap:4px">${ICONS.send} Envoyer</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  guardModal(overlay, { noBackdropClose: true });
  trapFocus(overlay, () => closeModal(overlay.id));
}

async function planDoSendPlanning() {
  const btn = document.getElementById('planSendBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = `${ICONS.send} Envoi...`;

  const pracId = document.getElementById('planSendPrac')?.value;
  const month = document.getElementById('planSendMonth')?.value;

  try {
    const r = await fetch('/api/planning/send-planning', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + api.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ practitioner_id: pracId, month })
    });
    const data = await r.json();
    if (r.ok) {
      btn.innerHTML = `${ICONS.checkCircle} Envoyé`;
      setTimeout(() => { closeModal('planSendOverlay'); }, 1500);
    } else {
      GendaUI.toast(data.error || 'Erreur d\'envoi', 'error');
      btn.disabled = false;
      btn.innerHTML = `${ICONS.send} Envoyer`;
    }
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = `${ICONS.send} Envoyer`;
  }
}

// ── Premium Modal ──
let _editingAbsenceId = null;
let _currentTab = 'details';

function planOpenModal(pracId, dateStr, absId) {
  closeModal('planAbsOverlay');

  _editingAbsenceId = absId || null;
  _currentTab = 'details';

  const isEdit = !!absId;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const fromDate = dateStr || today;
  const toDate = dateStr || today;

  let absData = null;
  if (isEdit) absData = absences.find(a => a.id === absId);

  const currentType = absData?.type || 'conge';
  const currentPeriod = absData?.period || 'full';
  const currentPeriodEnd = absData?.period_end || 'full';
  const tc = TYPE_COLORS[currentType];

  const abFrom = absData ? (absData.date_from?.slice?.(0, 10) || fromDate) : fromDate;
  const abTo = absData ? (absData.date_to?.slice?.(0, 10) || toDate) : toDate;
  const isMultiDay = abFrom !== abTo;

  let pracOptions = practitioners.map(p =>
    `<option value="${p.id}" ${(absData?.practitioner_id === p.id || p.id === pracId) ? 'selected' : ''}>${esc(p.display_name)}</option>`
  ).join('');

  const selectedPracId = absData?.practitioner_id || pracId || practitioners[0]?.id;
  const selectedPrac = practitioners.find(p => p.id === selectedPracId);
  const pracInitials = selectedPrac ? (selectedPrac.display_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';
  const pracColor = selectedPrac?.color || 'var(--blue)';

  // For single day, Fin segments mirror Début
  const startSeg = isMultiDay ? currentPeriod : currentPeriod;
  const endSeg = isMultiDay ? currentPeriodEnd : currentPeriod;

  const overlay = document.createElement('div');
  overlay.id = 'planAbsOverlay';
  overlay.className = 'm-overlay open';

  const segPills = (prefix, activeSeg) => ['full', 'am', 'pm'].map(s =>
    `<div class="plan-seg-pill${activeSeg === s ? ' active' : ''}" data-seg="${s}" onclick="planPickSeg('${prefix}',this)">${PERIOD_LABELS[s]}</div>`
  ).join('');

  overlay.innerHTML = `
    <div class="m-dialog m-flex m-lg">

      <!-- Header -->
      <div class="m-header">
        <div class="m-header-bg" id="planModalHeaderBg" style="background:${tc.grad}"></div>
        <button class="m-close" onclick="planCloseModal()" aria-label="Fermer">${ICONS.close}</button>
        <div class="m-header-content">
          <div class="m-client-hero">
            <div class="m-avatar" style="background:${safeColor(pracColor)}">${pracInitials}</div>
            <div class="m-client-info">
              <div class="m-client-name" id="planModalTitle">${isEdit ? esc(absData?.practitioner_name || '') : 'Nouvelle absence'}</div>
              <div class="m-client-meta"><span id="planModalSubtitle">Planifiez une absence</span></div>
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
      <div class="m-body" style="padding:20px 24px;overflow-y:auto;flex:1;min-height:0">

        <div class="m-panel active" id="planPanelDetails">
          <div class="plan-abs-grid">

            <!-- LEFT column: Form -->
            <div class="plan-abs-form">

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
                <select id="planAbsPrac" class="m-input" ${isEdit ? 'disabled' : ''} onchange="planUpdateHeader();planCheckImpact()">${pracOptions}</select>
              </div>

              <!-- Shortcuts -->
              <div class="m-sec">
                <div class="m-sec-head"><span class="m-sec-title">Raccourcis</span><span class="m-sec-line"></span></div>
                <div class="plan-shortcut-chips">
                  <button class="plan-shortcut-chip" onclick="planApplyShortcut('half')">½ journée</button>
                  <button class="plan-shortcut-chip" onclick="planApplyShortcut('full')">1 jour</button>
                  <button class="plan-shortcut-chip" onclick="planApplyShortcut('multi')">Plusieurs jours</button>
                </div>
              </div>

              <!-- Début -->
              <div class="plan-seg-block">
                <div class="m-field-label">Début</div>
                <input type="date" id="planAbsFrom" class="m-input" value="${abFrom}" onchange="planOnDatesChange()">
                <div class="plan-seg-pills" id="planSegStart">${segPills('start', startSeg)}</div>
              </div>

              <!-- Fin -->
              <div class="plan-seg-block" id="planEndBlock" style="${isMultiDay ? '' : 'display:none'}">
                <div class="m-field-label">Fin</div>
                <input type="date" id="planAbsTo" class="m-input" value="${abTo}" onchange="planOnDatesChange()">
                <div class="plan-seg-pills" id="planSegEnd">${segPills('end', endSeg)}</div>
              </div>

              <!-- Hidden To sync for single day -->
              ${!isMultiDay ? '' : ''}

              <!-- Date error -->
              <div class="plan-date-error" id="planDateError">La date de fin doit être après la date de début</div>

              <!-- Note -->
              <div class="m-sec" style="margin-top:4px">
                <div class="m-sec-head"><span class="m-sec-title">Note <span style="font-weight:400;color:var(--text-4)">(optionnel)</span></span><span class="m-sec-line"></span></div>
                <textarea id="planAbsNote" class="m-input" rows="2" placeholder="Vacances, formation coloration...">${esc(absData?.note || '')}</textarea>
              </div>
            </div>

            <!-- RIGHT column: Impact -->
            <div class="plan-abs-impact">
              <div class="plan-impact-card" id="planImpactZone">
                <h4>Impact</h4>
                <div style="text-align:center;padding:12px;color:var(--text-4);font-size:.75rem">
                  <div class="spinner" style="margin:0 auto 8px;width:18px;height:18px"></div>
                  Analyse en cours…
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- Log panel -->
        <div class="m-panel" id="planPanelLog">
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
        <button class="m-btn m-btn-primary" id="planAbsSaveBtn" onclick="planSaveAbsence()">Enregistrer l'absence</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  guardModal(overlay, { noBackdropClose: true });
  trapFocus(overlay, () => closeModal(overlay.id));
  planUpdateSubtitle();
  if (pracId || absData) setTimeout(planCheckImpact, 100);
}

function planCloseModal() {
  closeModal('planAbsOverlay');
  _editingAbsenceId = null;
}

/** Called when dates change — show/hide Fin block, validate, sync */
function planOnDatesChange() {
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  const endBlock = document.getElementById('planEndBlock');
  const errEl = document.getElementById('planDateError');
  const saveBtn = document.getElementById('planAbsSaveBtn');

  const isMulti = from && to && from !== to;

  // Show/hide Fin block
  if (endBlock) endBlock.style.display = isMulti ? '' : 'none';

  // If single day, sync To = From
  if (!isMulti && from) {
    const toInput = document.getElementById('planAbsTo');
    if (toInput) toInput.value = from;
  }

  // Validate: Fin < Début
  if (from && to && to < from) {
    if (errEl) errEl.classList.add('show');
    if (saveBtn) saveBtn.disabled = true;
  } else {
    if (errEl) errEl.classList.remove('show');
    if (saveBtn) saveBtn.disabled = false;
  }

  planUpdateSubtitle();
  planCheckImpact();
}

function planSwitchTab(tab) {
  _currentTab = tab;
  document.querySelectorAll('#planAbsOverlay .m-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('#planAbsOverlay .m-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(tab === 'details' ? 'planPanelDetails' : 'planPanelLog')?.classList.add('active');
  if (tab === 'log' && _editingAbsenceId) planLoadLogs(_editingAbsenceId);
}

function planPickType(pill) {
  document.querySelectorAll('#planTypePills .plan-type-pill').forEach(p => p.className = 'plan-type-pill');
  pill.className = 'plan-type-pill active-' + pill.dataset.type;
  const bg = document.getElementById('planModalHeaderBg');
  if (bg) bg.style.background = TYPE_COLORS[pill.dataset.type].grad;
  planUpdateSubtitle();
}

/** Unified segment picker for start/end */
function planPickSeg(prefix, pill) {
  const container = document.getElementById(prefix === 'start' ? 'planSegStart' : 'planSegEnd');
  if (!container) return;
  container.querySelectorAll('.plan-seg-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');

  // If single day → sync end segment to match start
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  if (prefix === 'start' && (!to || from === to)) {
    const endContainer = document.getElementById('planSegEnd');
    if (endContainer) {
      endContainer.querySelectorAll('.plan-seg-pill').forEach(p => p.classList.remove('active'));
      const match = endContainer.querySelector(`.plan-seg-pill[data-seg="${pill.dataset.seg}"]`);
      if (match) match.classList.add('active');
    }
  }
  planUpdateSubtitle();
  planCheckImpact();
}

/** Shortcut chips: ½ journée, 1 jour, plusieurs jours */
function planApplyShortcut(type) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const fromInput = document.getElementById('planAbsFrom');
  const toInput = document.getElementById('planAbsTo');
  if (!fromInput || !toInput) return;

  if (type === 'half') {
    fromInput.value = today;
    toInput.value = today;
    _setSegActive('planSegStart', 'am');
    _setSegActive('planSegEnd', 'am');
  } else if (type === 'full') {
    fromInput.value = today;
    toInput.value = today;
    _setSegActive('planSegStart', 'full');
    _setSegActive('planSegEnd', 'full');
  } else if (type === 'multi') {
    fromInput.value = today;
    toInput.value = tomorrow;
    _setSegActive('planSegStart', 'full');
    _setSegActive('planSegEnd', 'full');
  }
  planOnDatesChange();
}

function _setSegActive(containerId, seg) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.querySelectorAll('.plan-seg-pill').forEach(p => p.classList.remove('active'));
  const pill = c.querySelector(`.plan-seg-pill[data-seg="${seg}"]`);
  if (pill) pill.classList.add('active');
}

function planUpdateHeader() {
  const pracId = document.getElementById('planAbsPrac')?.value;
  const prac = practitioners.find(p => p.id === pracId);
  if (!prac || _editingAbsenceId) return;
  const title = document.getElementById('planModalTitle');
  if (title) title.textContent = prac.display_name;
  const avatar = document.querySelector('#planAbsOverlay .m-avatar');
  if (avatar) {
    avatar.style.background = prac.color || 'var(--blue)';
    avatar.textContent = (prac.display_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
}

/** Rich live subtitle: "Le 4 mars · journée · 1 jour" or "Du 4 mars (après-midi) → 6 mars (matin) · 2,5 jours" */
function planUpdateSubtitle() {
  const sub = document.getElementById('planModalSubtitle');
  if (!sub) return;
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  if (!from) { sub.textContent = 'Planifiez une absence'; return; }
  const { period, period_end } = planGetSelectedPeriods();

  const fmtDay = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].toLowerCase()}`;
  };

  const isSameDay = !to || from === to;
  const segLabel = (s) => s === 'am' ? 'matin' : s === 'pm' ? 'après-midi' : 'journée';

  if (isSameDay) {
    // "Le 4 mars · journée · 1 jour"
    const dur = period === 'full' ? '1 jour' : '½ jour';
    sub.textContent = `Le ${fmtDay(from)} · ${segLabel(period)} · ${dur}`;
  } else {
    // Calculate working days between (simple: count calendar days)
    const d1 = new Date(from + 'T12:00:00');
    const d2 = new Date(to + 'T12:00:00');
    let days = 0;
    const cur = new Date(d1);
    while (cur <= d2) {
      const dow = cur.getDay();
      if (dow !== 0) days++; // skip Sunday
      cur.setDate(cur.getDate() + 1);
    }
    // Adjust for half-days
    if (period === 'am' || period === 'pm') days -= 0.5;
    if (period_end === 'am' || period_end === 'pm') days -= 0.5;
    const durStr = days % 1 === 0 ? `${days} jour${days > 1 ? 's' : ''}` : `${days.toFixed(1).replace('.', ',')} jours`;

    const startSeg = period !== 'full' ? ` (${segLabel(period)})` : '';
    const endSeg = period_end !== 'full' ? ` (${segLabel(period_end)})` : '';
    sub.textContent = `Du ${fmtDay(from)}${startSeg} → ${fmtDay(to)}${endSeg} · ${durStr}`;
  }
}

function planGetSelectedType() {
  const active = document.querySelector('#planTypePills .plan-type-pill[class*="active-"]');
  return active?.dataset.type || 'conge';
}

/** Get both period and period_end from segment pills */
function planGetSelectedPeriods() {
  const startPill = document.querySelector('#planSegStart .plan-seg-pill.active');
  const endPill = document.querySelector('#planSegEnd .plan-seg-pill.active');
  const p = startPill?.dataset.seg || 'full';
  const pe = endPill?.dataset.seg || 'full';

  // For single day, both should match
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  if (!to || from === to) return { period: p, period_end: p };
  return { period: p, period_end: pe };
}

// ── Context menu for multi-day absence day clicks ──
function planAbsClick(ev, pracId, dateStr, absId) {
  ev.stopPropagation();
  const abs = absences.find(a => String(a.id) === String(absId));
  if (!abs) { planOpenModal(null, dateStr, absId); return; }

  const fromStr = (typeof abs.date_from === 'string' ? abs.date_from : new Date(abs.date_from).toISOString()).slice(0, 10);
  const toStr = (typeof abs.date_to === 'string' ? abs.date_to : new Date(abs.date_to).toISOString()).slice(0, 10);

  // Single day → edit directly
  if (fromStr === toStr) { planOpenModal(null, dateStr, absId); return; }

  // Multi-day → show context menu
  document.getElementById('planCtxMenu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'planCtxMenu';
  menu.className = 'plan-ctx-menu';

  // Position near click
  let x = ev.clientX, y = ev.clientY;
  menu.innerHTML = `
    <div class="plan-ctx-item" onclick="document.getElementById('planCtxMenu').remove();planOpenModal(null,'${dateStr}','${absId}')">
      ${ICONS.calendar}<span>Modifier l'absence entière</span>
    </div>
    <div class="plan-ctx-item" onclick="document.getElementById('planCtxMenu').remove();planOpenModal('${pracId}','${dateStr}')">
      ${ICONS.plus}<span>Changer ce jour uniquement</span>
    </div>
  `;
  document.body.appendChild(menu);

  // Adjust if off-screen
  const rect = menu.getBoundingClientRect();
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:99999`;

  // Close on outside click (one-shot)
  setTimeout(() => {
    const handler = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', handler, true);
      }
    };
    document.addEventListener('pointerdown', handler, true);
  }, 0);
}

// ── Impact preview (enriched with coverage) ──
let _impactDebounce = null;
let _impactToken = 0; // stale-request prevention
async function planCheckImpact() {
  clearTimeout(_impactDebounce);
  _impactDebounce = setTimeout(_doCheckImpact, 250);
}

async function _doCheckImpact() {
  const zone = document.getElementById('planImpactZone');
  if (!zone) return;
  const pracId = document.getElementById('planAbsPrac')?.value;
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value || from;
  if (!pracId || !from) return;

  const token = ++_impactToken;
  zone.innerHTML = `<h4>Impact</h4><div style="text-align:center;padding:12px;color:var(--text-4);font-size:.75rem"><div class="spinner" style="margin:0 auto 8px;width:18px;height:18px"></div>Analyse…</div>`;

  try {
    const { period: absPeriod, period_end: absPeriodEnd } = planGetSelectedPeriods();
    const r = await fetch(`/api/planning/impact?practitioner_id=${pracId}&date_from=${from}&date_to=${to}&period=${absPeriod}&period_end=${absPeriodEnd}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (token !== _impactToken) return; // stale
    const data = await r.json();
    const count = data.count || 0;
    const bookings = data.impacted_bookings || [];
    const coverage = data.coverage || 'ok';
    const uncovered = data.uncovered_services || [];

    let h = '<h4>Impact</h4>';

    // RDV count row
    if (count > 0) {
      h += `<div class="plan-impact-row">
        <span class="plan-impact-count">${ICONS.alertTriangle} ${count} RDV impacté${count > 1 ? 's' : ''}</span>
        <button class="plan-impact-btn" onclick="planToggleImpactList()">Voir</button>
      </div>`;
      // Collapsible booking list
      h += '<div class="plan-impact-list" id="planImpactList">';
      bookings.forEach(b => {
        const dt = new Date(b.start_at);
        const day = dt.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
        const time = dt.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
        h += `<div class="plan-impact-item" data-bk="${esc(b.id)}">
          <div><strong>${esc(b.client_name || 'Client')}</strong> · ${esc(b.service_name || '')} · ${day} à ${time}</div>
          <div class="plan-alt-zone" id="planAlt_${b.id}" style="margin-top:4px"></div>
        </div>`;
      });
      h += '</div>';

      // Notify clients button
      const hasContacts = bookings.some(b => b.client_email || b.client_phone);
      if (hasContacts) {
        h += `<div style="margin-top:10px">
          <button class="plan-impact-btn" id="planNotifyClientsBtn" onclick="planNotifyClients()" style="width:100%;justify-content:center;gap:6px;padding:7px 12px">
            ${ICONS.send} Prévenir les clients
          </button>
        </div>`;
      }
    } else {
      h += `<div class="plan-impact-row"><span>${ICONS.checkCircle} Aucun RDV impacté</span></div>`;
    }

    // Coverage badge
    if (coverage === 'ok') {
      h += `<div style="margin-top:10px"><span class="plan-coverage-badge ok">${ICONS.checkCircle} Couverture OK</span></div>`;
    } else {
      h += `<div style="margin-top:10px"><span class="plan-coverage-badge at-risk">${ICONS.alertTriangle} À risque</span></div>`;
      if (uncovered.length) {
        h += `<div class="plan-coverage-detail">Plus de couverture pour : ${uncovered.map(s => esc(s)).join(', ')}</div>`;
      }
    }

    zone.innerHTML = h;

    // Fetch alternatives in background (for bookings that have IDs)
    if (count > 0) _fetchAlternatives(token, pracId, from, to, absPeriod, absPeriodEnd);
  } catch (e) {
    if (token !== _impactToken) return;
    zone.innerHTML = `<h4>Impact</h4><div style="padding:8px;font-size:.75rem;color:var(--text-4)">Impossible de charger</div>`;
  }
}

/** Background fetch: enriches impact list with "Assigner à" chips */
async function _fetchAlternatives(token, pracId, from, to, period, periodEnd) {
  try {
    const r = await fetch(`/api/planning/impact?practitioner_id=${pracId}&date_from=${from}&date_to=${to}&period=${period}&period_end=${periodEnd}&with_alternatives=1`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (token !== _impactToken) return;
    const data = await r.json();
    const bookings = data.impacted_bookings || [];

    for (const bk of bookings) {
      const altZone = document.getElementById(`planAlt_${bk.id}`);
      if (!altZone) continue;
      const alts = bk.alternatives || [];
      if (alts.length === 0) {
        altZone.innerHTML = `<span style="font-size:.7rem;color:var(--text-4);font-style:italic">Aucun praticien disponible</span>`;
      } else {
        altZone.innerHTML = `<span style="font-size:.7rem;color:var(--text-4)">Assigner à :</span> ` +
          alts.map(a =>
            `<button class="plan-alt-chip" style="--ac:${esc(a.color || 'var(--text-3)')}" onclick="planReassign('${esc(bk.id)}','${esc(a.practitioner_id)}')">${esc(a.display_name)}</button>`
          ).join(' ');
      }
    }
  } catch (e) {
    console.warn('[PLAN] Alternatives fetch error:', e.message);
  }
}

/** Reassign a booking to a different practitioner */
async function planReassign(bookingId, newPracId) {
  if (!(await showConfirmDialog('Réassigner ce RDV à ce praticien ? Le client sera notifié par email.'))) return;

  // Disable the chip that was clicked
  const altZone = document.getElementById(`planAlt_${bookingId}`);
  if (altZone) {
    altZone.querySelectorAll('button').forEach(b => b.disabled = true);
    altZone.insertAdjacentHTML('beforeend', ' <span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle"></span>');
  }

  try {
    const r = await fetch('/api/planning/reassign', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + api.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, new_practitioner_id: newPracId })
    });
    const data = await r.json();
    if (r.ok && data.reassigned) {
      GendaUI.toast(`RDV réassigné à ${data.new_practitioner}`, 'success');
      // Refresh impact
      planCheckImpact();
    } else {
      GendaUI.toast(data.error || 'Erreur de réassignation', 'error');
      if (altZone) altZone.querySelectorAll('button').forEach(b => b.disabled = false);
      const sp = altZone?.querySelector('.spinner');
      if (sp) sp.remove();
    }
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
    if (altZone) altZone.querySelectorAll('button').forEach(b => b.disabled = false);
    const sp = altZone?.querySelector('.spinner');
    if (sp) sp.remove();
  }
}

function planToggleImpactList() {
  const list = document.getElementById('planImpactList');
  if (list) list.classList.toggle('open');
}

// ── Notify impacted clients ──
async function planNotifyClients() {
  const btn = document.getElementById('planNotifyClientsBtn');
  if (!btn) return;
  if (!(await showConfirmDialog('Envoyer un email/SMS aux clients impactés pour les prévenir ?'))) return;

  btn.disabled = true;
  btn.innerHTML = `${ICONS.send} Envoi en cours...`;

  const pracId = document.getElementById('planAbsPrac')?.value;
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value || from;
  const { period, period_end } = planGetSelectedPeriods();

  try {
    const r = await fetch('/api/planning/notify-impacted', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + api.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ practitioner_id: pracId, date_from: from, date_to: to, period, period_end })
    });
    const data = await r.json();
    if (r.ok) {
      const parts = [];
      if (data.sent_email > 0) parts.push(`${data.sent_email} email${data.sent_email > 1 ? 's' : ''}`);
      if (data.sent_sms > 0) parts.push(`${data.sent_sms} SMS`);
      const msg = parts.length > 0 ? parts.join(' + ') + ' envoyé' + (data.sent_email + data.sent_sms > 1 ? 's' : '') : 'Aucun contact trouvé';
      btn.innerHTML = `${ICONS.checkCircle} ${msg}`;
      GendaUI.toast(msg, 'success');
      setTimeout(() => { btn.innerHTML = `${ICONS.send} Prévenir les clients`; btn.disabled = false; }, 5000);
    } else {
      btn.innerHTML = `${ICONS.send} Prévenir les clients`;
      btn.disabled = false;
      GendaUI.toast(data.error || 'Erreur d\'envoi', 'error');
    }
  } catch (e) {
    btn.innerHTML = `${ICONS.send} Prévenir les clients`;
    btn.disabled = false;
    GendaUI.toast('Erreur: ' + e.message, 'error');
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
  const to = document.getElementById('planAbsTo')?.value || from;
  const note = document.getElementById('planAbsNote')?.value;
  const type = planGetSelectedType();
  const { period, period_end } = planGetSelectedPeriods();

  if (!pracId || !from) {
    btn.disabled = false;
    btn.textContent = "Enregistrer l'absence";
    return;
  }

  // Client-side validation
  if (to < from) {
    btn.disabled = false;
    btn.textContent = "Enregistrer l'absence";
    return;
  }

  try {
    const url = _editingAbsenceId ? `/api/planning/absences/${_editingAbsenceId}` : '/api/planning/absences';
    const method = _editingAbsenceId ? 'PATCH' : 'POST';
    const body = _editingAbsenceId
      ? { date_from: from, date_to: to, type, note, period, period_end }
      : { practitioner_id: pracId, date_from: from, date_to: to, type, note, period, period_end };

    const r = await fetch(url, {
      method,
      headers: { 'Authorization': 'Bearer ' + api.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();

    if (!r.ok) {
      GendaUI.toast(data.error || 'Erreur', 'error');
      btn.disabled = false;
      btn.textContent = "Enregistrer l'absence";
      return;
    }

    _editingAbsenceId = null;
    planCloseModal();
    await renderPlanning();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = "Enregistrer l'absence";
  }
}

// ── Delete absence ──
async function planDeleteAbsence(absId) {
  if (!(await showConfirmDialog('Supprimer cette absence ?'))) return;
  try {
    const r = await fetch(`/api/planning/absences/${absId}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) { const data = await r.json(); GendaUI.toast(data.error || 'Erreur', 'error'); return; }
    _editingAbsenceId = null;
    planCloseModal();
    await renderPlanning();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ── Notify practitioner ──
async function planNotifyPractitioner(absId) {
  const btn = document.querySelector('#planAbsOverlay .m-btn-ghost[onclick*="planNotifyPractitioner"]');
  if (btn) { btn.disabled = true; btn.innerHTML = `${ICONS.mail} Envoi...`; }
  try {
    const r = await fetch(`/api/planning/absences/${absId}/notify`, { method: 'POST', headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const data = await r.json();
    if (r.ok) {
      if (btn) btn.innerHTML = `${ICONS.checkCircle} Envoyé`;
      setTimeout(() => { if (btn) { btn.innerHTML = `${ICONS.mail} Notifier`; btn.disabled = false; } }, 3000);
    } else {
      GendaUI.toast(data.error || 'Erreur d\'envoi', 'error');
      if (btn) { btn.innerHTML = `${ICONS.mail} Notifier`; btn.disabled = false; }
    }
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); if (btn) { btn.innerHTML = `${ICONS.mail} Notifier`; btn.disabled = false; } }
}

// ── Load activity logs ──
async function planLoadLogs(absId) {
  const container = document.getElementById('planLogContent');
  if (!container) return;
  try {
    const r = await fetch(`/api/planning/absences/${absId}/logs`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const data = await r.json();
    const logs = data.logs || [];

    if (logs.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-4)"><div style="margin-bottom:8px;opacity:.5">${ICONS.clock}</div><p style="font-size:.82rem">Aucune activité enregistrée</p></div>`;
      return;
    }

    const actionLabels = { created: 'Absence créée', modified: 'Absence modifiée', cancelled: 'Absence annulée', email_sent: 'Notification envoyée' };
    let h = '';
    logs.forEach(log => {
      const date = new Date(log.created_at);
      const dateStr = date.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels' });
      const timeStr = date.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
      let detailStr = '';
      if (log.action === 'modified' && log.details?.changes) {
        const c = log.details.changes;
        const parts = [];
        if (c.type) parts.push(`Type: ${TYPE_NAMES[c.type.from] || c.type.from} → ${TYPE_NAMES[c.type.to] || c.type.to}`);
        if (c.period) parts.push(`Début: ${PERIOD_LABELS[c.period.from] || c.period.from} → ${PERIOD_LABELS[c.period.to] || c.period.to}`);
        if (c.period_end) parts.push(`Fin: ${PERIOD_LABELS[c.period_end.from] || c.period_end.from} → ${PERIOD_LABELS[c.period_end.to] || c.period_end.to}`);
        if (c.date_from) parts.push('Date début modifiée');
        if (c.date_to) parts.push('Date fin modifiée');
        if (c.note) parts.push('Note modifiée');
        detailStr = parts.join(' · ');
      } else if (log.action === 'email_sent' && log.details?.to) {
        detailStr = `→ ${esc(log.details.to)}`;
      }
      h += `<div class="plan-log-item"><div class="plan-log-dot ${log.action}"></div><div class="plan-log-info"><div class="plan-log-action">${actionLabels[log.action] || log.action}</div><div class="plan-log-meta">${dateStr} à ${timeStr}${log.actor_name ? ' · ' + esc(log.actor_name) : ''}</div>${detailStr ? `<div class="plan-log-detail">${detailStr}</div>` : ''}</div></div>`;
    });
    container.innerHTML = h;
  } catch (e) { container.innerHTML = `<div style="color:var(--red);font-size:.82rem;padding:20px">Erreur: ${esc(e.message)}</div>`; }
}

// ── Bridge ──
bridge({
  planPrevMonth, planNextMonth, planGoToday,
  planOpenModal, planCloseModal, planAbsClick,
  planPickType, planPickSeg, planApplyShortcut,
  planSwitchTab, planOnDatesChange,
  planSaveAbsence, planDeleteAbsence,
  planNotifyPractitioner, planNotifyClients, planReassign, planCheckImpact,
  planUpdateHeader, planLoadLogs, planToggleImpactList,
  planExportCSV, planOpenSendModal, planDoSendPlanning
});

export { loadPlanning };
