/**
 * Horaires — Salon opening hours, closures & holidays.
 * Replaced the old per-practitioner Disponibilités view (now in team modal).
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { guardModal, showConfirmDialog } from '../utils/dirty-guard.js';
import { IC } from '../utils/icons.js';

const esc=s=>s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):'';

const DAYS_WEEK = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const ICON_X = IC.x;
const ICON_SAVE = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
const ICON_FLAG = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';

let scheduleData = {}; // weekday -> [{start_time, end_time}]
let closuresData = [];
let holidaysData = [];
let coverageData = []; // practitioners per weekday

// ============================================================
// Load & render
// ============================================================

async function loadHours() {
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const year = new Date().getFullYear();
    const auth = { headers: { 'Authorization': 'Bearer ' + api.getToken() } };
    const [bhRes, holRes, avRes] = await Promise.all([
      fetch('/api/business-hours', auth),
      fetch(`/api/availabilities/holidays?year=${year}`, auth),
      fetch('/api/availabilities', auth)
    ]);
    const bhData = await bhRes.json();
    const holData = await holRes.json();
    const avData = await avRes.json();

    // Business schedule
    scheduleData = {};
    for (let d = 0; d < 7; d++) scheduleData[d] = [];
    const rawSched = bhData.schedule || {};
    for (const [wd, slots] of Object.entries(rawSched)) {
      scheduleData[parseInt(wd)] = slots.map(s => ({
        start_time: s.start_time, end_time: s.end_time
      }));
    }

    closuresData = bhData.closures || [];
    holidaysData = holData.holidays || [];

    // Compute coverage from practitioner availabilities
    const avails = avData.availabilities || {};
    coverageData = [];
    for (let d = 0; d < 7; d++) {
      let count = 0;
      for (const pracId of Object.keys(avails)) {
        const slots = avails[pracId]?.schedule?.[d] || [];
        if (slots.length > 0) count++;
      }
      coverageData[d] = count;
    }

    c.innerHTML = renderPage(year);
  } catch (e) {
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;
  }
}

// ============================================================
// Page rendering
// ============================================================

function renderPage(year) {
  let h = '';

  // 1. Summary
  h += renderSummary();

  // 2. Opening hours grid
  h += renderScheduleCard();

  // 3. Closures
  h += renderClosuresCard();

  // 4. Holidays
  h += renderHolidaysCard(year);

  // 5. Team coverage
  h += renderCoverageCard();

  return h;
}

function timeToMin(t) {
  const p = String(t).split(':');
  return parseInt(p[0]) * 60 + parseInt(p[1] || 0);
}

function renderSummary() {
  const openDays = [];
  let totalMinutes = 0;
  let earliest = 1440, latest = 0;

  for (let d = 0; d < 7; d++) {
    const slots = scheduleData[d] || [];
    if (slots.length > 0) {
      openDays.push(d);
      slots.forEach(s => {
        const st = timeToMin(s.start_time);
        const en = timeToMin(s.end_time);
        totalMinutes += (en - st);
        if (st < earliest) earliest = st;
        if (en > latest) latest = en;
      });
    }
  }

  if (openDays.length === 0) {
    return `<div class="biz-hours-summary" style="margin-bottom:16px">
      <span class="summary-main">Aucun horaire d'ouverture configuré</span>
      <button class="btn-outline btn-sm" onclick="applyStandardHours()" style="margin-left:auto">Configurer les horaires standard</button>
    </div>`;
  }

  const hoursPerWeek = Math.round(totalMinutes / 6) / 10; // decimal hours
  const fmtTime = m => `${Math.floor(m / 60)}h${(m % 60) ? String(m % 60).padStart(2, '0') : '00'}`;

  // Detect pattern
  let pattern = '';
  // Check if consecutive days
  const isConsecutive = openDays.every((d, i) => i === 0 || d === openDays[i - 1] + 1);
  if (isConsecutive && openDays.length > 1) {
    pattern = `${DAYS_SHORT[openDays[0]]} - ${DAYS_SHORT[openDays[openDays.length - 1]]}`;
  } else {
    pattern = openDays.map(d => DAYS_SHORT[d]).join(', ');
  }

  // Check if all days have same hours
  const firstDaySlots = scheduleData[openDays[0]];
  const allSame = openDays.every(d => {
    const s = scheduleData[d];
    if (s.length !== firstDaySlots.length) return false;
    return s.every((slot, i) =>
      slot.start_time?.slice(0, 5) === firstDaySlots[i].start_time?.slice(0, 5) &&
      slot.end_time?.slice(0, 5) === firstDaySlots[i].end_time?.slice(0, 5)
    );
  });

  let timeStr = '';
  if (allSame) {
    timeStr = firstDaySlots.map(s => `${fmtTime(timeToMin(s.start_time))} - ${fmtTime(timeToMin(s.end_time))}`).join(' / ');
  } else {
    timeStr = `${fmtTime(earliest)} - ${fmtTime(latest)}`;
  }

  return `<div class="biz-hours-summary" style="margin-bottom:16px">
    <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    <span class="summary-main">Ouvert ${pattern}, ${timeStr}</span>
    <span class="summary-badge">${hoursPerWeek}h / semaine</span>
  </div>`;
}

function renderScheduleCard() {
  let h = `<div class="card" style="margin-bottom:16px">
    <div class="card-h">
      <h3>Horaires d'ouverture</h3>
      <div style="display:flex;gap:6px">
        <button class="btn-outline btn-sm" onclick="applyStandardHours()">Horaires standard</button>
        <button class="btn-primary btn-sm" onclick="saveBusinessSchedule()">${ICON_SAVE} Enregistrer</button>
      </div>
    </div>
    <div style="padding:14px 18px">`;

  for (let d = 0; d < 7; d++) {
    const slots = scheduleData[d] || [];
    h += `<div class="day-row"><span class="day-name">${DAYS_WEEK[d]}</span><div class="slots">`;
    if (slots.length === 0) {
      h += `<span class="day-closed">Fermé</span>`;
    } else {
      slots.forEach((s, i) => {
        h += `<span class="slot-chip">${(s.start_time || '').slice(0, 5)} – ${(s.end_time || '').slice(0, 5)}<button class="remove-slot" onclick="removeBizSlot(${d},${i})">${ICON_X}</button></span>`;
      });
    }
    h += `<button class="add-slot-btn" onclick="addBizSlot(${d})">+ Ajouter</button></div></div>`;
  }

  h += `</div></div>`;
  return h;
}

function renderClosuresCard() {
  let h = `<div class="card" style="margin-bottom:16px">
    <div class="card-h">
      <h3>Fermetures exceptionnelles</h3>
      <button class="btn-primary btn-sm" onclick="openClosureModal()">+ Ajouter</button>
    </div>`;

  if (closuresData.length === 0) {
    h += `<div class="empty" style="padding:20px;text-align:center;font-size:.82rem;color:var(--text-4)">Aucune fermeture planifiée</div>`;
  } else {
    h += `<div style="padding:10px 18px">`;
    closuresData.forEach(cl => {
      const from = new Date(cl.date_from);
      const to = new Date(cl.date_to);
      const sameDay = cl.date_from === cl.date_to || from.toDateString() === to.toDateString();
      let dateStr;
      if (sameDay) {
        dateStr = from.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      } else {
        dateStr = from.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' }) + ' - ' + to.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels' });
      }
      h += `<div class="closure-row">
        <div>
          <span class="closure-dates">${dateStr}</span>
          ${cl.reason ? `<span class="closure-reason">— ${cl.reason}</span>` : ''}
        </div>
        <button class="btn-outline btn-sm btn-danger" onclick="(async()=>{if(await showConfirmDialog('Supprimer cette fermeture ?'))deleteClosure('${cl.id}')})()" style="padding:3px 8px">${ICON_X}</button>
      </div>`;
    });
    h += `</div>`;
  }

  h += `</div>`;
  return h;
}

function renderHolidaysCard(year) {
  let h = `<div class="card" style="margin-bottom:16px">
    <div class="card-h">
      <h3>${ICON_FLAG} Jours fériés ${year}</h3>
      <div style="display:flex;gap:6px">
        <button class="btn-outline btn-sm" onclick="prefillBelgianHolidays(${year})" style="font-size:.72rem">Fériés belges</button>
        <button class="btn-primary btn-sm" onclick="openHolidayModal()">+ Ajouter</button>
      </div>
    </div>`;

  if (holidaysData.length === 0) {
    h += `<div class="empty" style="padding:20px;text-align:center">
      <p style="font-size:.82rem;color:var(--text-4);margin-bottom:10px">Aucun jour férié pour ${year}</p>
      <button class="btn-outline btn-sm" onclick="prefillBelgianHolidays(${year})" style="font-size:.78rem">Pré-remplir les jours fériés belges</button>
    </div>`;
  } else {
    h += `<div style="padding:10px 18px">`;
    holidaysData.forEach(hol => {
      const dt = new Date(hol.date).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      h += `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border-light)">
        <div style="display:flex;align-items:center;gap:8px">
          <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="var(--amber-dark)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
          <span style="font-size:.85rem;font-weight:600">${dt}</span>
          <span style="font-size:.78rem;color:var(--text-4)">${hol.name}</span>
        </div>
        <button class="btn-outline btn-sm btn-danger" onclick="(async()=>{if(await showConfirmDialog('Supprimer ?'))deleteHoliday('${hol.id}')})()" style="padding:3px 8px">${ICON_X}</button>
      </div>`;
    });
    h += `</div>`;
  }

  h += `</div>`;
  return h;
}

function renderCoverageCard() {
  const hasData = coverageData.some(c => c > 0);
  if (!hasData) return '';

  let h = `<div class="card">
    <div class="card-h"><h3>Couverture équipe</h3></div>
    <div style="padding:14px 18px">
      <div style="display:flex;gap:8px;flex-wrap:wrap">`;

  for (let d = 0; d < 7; d++) {
    const count = coverageData[d] || 0;
    const isOpen = (scheduleData[d] || []).length > 0;
    const warn = isOpen && count === 0;
    const color = warn ? 'var(--red)' : count > 0 ? 'var(--green)' : 'var(--text-4)';
    const bg = warn ? 'var(--red-bg)' : count > 0 ? '#F0FDF4' : 'var(--surface)';
    h += `<div style="text-align:center;padding:10px 14px;border-radius:10px;background:${bg};min-width:70px;flex:1">
      <div style="font-size:.7rem;font-weight:600;color:var(--text-4);margin-bottom:4px">${DAYS_SHORT[d]}</div>
      <div style="font-size:1.1rem;font-weight:700;color:${color}">${count}</div>
      <div style="font-size:.6rem;color:var(--text-4)">praticien${count !== 1 ? 's' : ''}</div>
      ${warn ? '<div style="font-size:.55rem;color:var(--red);font-weight:600;margin-top:2px">Aucune couverture</div>' : ''}
    </div>`;
  }

  h += `</div>
      <p style="font-size:.72rem;color:var(--text-4);margin-top:10px">Nombre de praticiens avec des disponibilités configurées par jour. Modifiez dans la fiche de chaque praticien (section Équipe).</p>
    </div>
  </div>`;
  return h;
}

// ============================================================
// Schedule editing
// ============================================================

function addBizSlot(day) {
  const slots = scheduleData[day] || [];
  const last = slots[slots.length - 1];
  const ds = last ? last.end_time : '09:00:00';
  const hr = parseInt((ds || '09:00').split(':')[0]);
  const de = `${String(Math.min(hr + 4, 20)).padStart(2, '0')}:00`;

  const m = `<div class="m-overlay open" id="bizSlotModal"><div class="m-dialog m-sm">
    <div class="m-header-simple"><h3>Créneau — ${DAYS_WEEK[day]}</h3><button class="m-close" onclick="closeModal('bizSlotModal')">${ICON_X}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><label class="m-field-label">Début</label><input type="time" class="m-input" id="biz_slot_start" value="${(ds || '09:00').slice(0, 5)}"></div><div><label class="m-field-label">Fin</label><input type="time" class="m-input" id="biz_slot_end" value="${de}"></div></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('bizSlotModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="confirmAddBizSlot(${day})">Ajouter</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
  guardModal(document.getElementById('bizSlotModal'), { noBackdropClose: true });
}

function confirmAddBizSlot(day) {
  const st = document.getElementById('biz_slot_start').value + ':00';
  const en = document.getElementById('biz_slot_end').value + ':00';
  if (!scheduleData[day]) scheduleData[day] = [];
  scheduleData[day].push({ start_time: st, end_time: en });
  scheduleData[day].sort((a, b) => a.start_time.localeCompare(b.start_time));
  document.getElementById('bizSlotModal')._dirtyGuard?.markClean();
  closeModal('bizSlotModal');
  // Re-render just the schedule card + summary
  document.getElementById('contentArea').innerHTML = renderPage(new Date().getFullYear());
}

function removeBizSlot(day, idx) {
  scheduleData[day].splice(idx, 1);
  document.getElementById('contentArea').innerHTML = renderPage(new Date().getFullYear());
}

function applyStandardHours() {
  // Mon-Sat 09:00-19:00, Sun closed
  for (let d = 0; d < 6; d++) {
    scheduleData[d] = [{ start_time: '09:00:00', end_time: '19:00:00' }];
  }
  scheduleData[6] = []; // Sunday closed
  document.getElementById('contentArea').innerHTML = renderPage(new Date().getFullYear());
  GendaUI.toast('Horaires standard appliqués — pensez à enregistrer', 'info');
}

async function saveBusinessSchedule() {
  const schedule = {};
  for (let d = 0; d < 7; d++) {
    const sl = scheduleData[d] || [];
    if (sl.length > 0) {
      schedule[d] = sl.map(s => ({
        start_time: (s.start_time || '').slice(0, 5),
        end_time: (s.end_time || '').slice(0, 5)
      }));
    }
  }
  try {
    const r = await fetch('/api/business-hours', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ schedule })
    });
    if (!r.ok) throw new Error((await r.json()).error);
    GendaUI.toast('Horaires enregistrés', 'success');
    loadHours();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ============================================================
// Closures
// ============================================================

function openClosureModal() {
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'Europe/Brussels'});
  const m = `<div class="m-overlay open" id="closureModal"><div class="m-dialog m-sm">
    <div class="m-header-simple"><h3>Nouvelle fermeture</h3><button class="m-close" onclick="closeModal('closureModal')">${ICON_X}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><label class="m-field-label">Du</label><input type="date" class="m-input" id="cl_from" value="${today}"></div><div><label class="m-field-label">Au</label><input type="date" class="m-input" id="cl_to" value="${today}"></div></div>
    <div><label class="m-field-label">Motif</label><input class="m-input" id="cl_reason" placeholder="Ex: Congé annuel, travaux, inventaire..."></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('closureModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="saveClosure()">Enregistrer</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
  guardModal(document.getElementById('closureModal'), { noBackdropClose: true });
}

async function saveClosure() {
  const date_from = document.getElementById('cl_from')?.value;
  const date_to = document.getElementById('cl_to')?.value;
  const reason = document.getElementById('cl_reason')?.value || null;
  if (!date_from || !date_to) { GendaUI.toast('Dates requises', 'error'); return; }
  if (date_to < date_from) { GendaUI.toast('La date de fin doit être après la date de début', 'error'); return; }
  try {
    const r = await fetch('/api/business-hours/closures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ date_from, date_to, reason })
    });
    if (!r.ok) throw new Error((await r.json()).error);
    document.getElementById('closureModal')._dirtyGuard?.markClean();
    closeModal('closureModal');
    GendaUI.toast('Fermeture ajoutée', 'success');
    loadHours();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

async function deleteClosure(id) {
  try {
    await fetch(`/api/business-hours/closures/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    GendaUI.toast('Fermeture supprimée', 'success');
    loadHours();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ============================================================
// Holidays (kept from previous version, same API)
// ============================================================

function openHolidayModal() {
  const m = `<div class="m-overlay open" id="holidayModal"><div class="m-dialog m-sm">
    <div class="m-header-simple"><h3>Nouveau jour férié</h3><button class="m-close" onclick="closeModal('holidayModal')">${ICON_X}</button></div><div class="m-body">
    <div><label class="m-field-label">Date</label><input type="date" class="m-input" id="hol_date" value="${new Date().toLocaleDateString('en-CA', {timeZone: 'Europe/Brussels'})}"></div>
    <div><label class="m-field-label">Nom</label><input class="m-input" id="hol_name" placeholder="Ex: Noël, Fête nationale..."></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('holidayModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="saveHoliday()">Enregistrer</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
  guardModal(document.getElementById('holidayModal'), { noBackdropClose: true });
}

async function saveHoliday() {
  const date = document.getElementById('hol_date')?.value;
  const name = document.getElementById('hol_name')?.value;
  if (!date || !name) { GendaUI.toast('Date et nom requis', 'error'); return; }
  try {
    const r = await fetch('/api/availabilities/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ date, name })
    });
    if (!r.ok) throw new Error((await r.json()).error);
    document.getElementById('holidayModal')._dirtyGuard?.markClean();
    closeModal('holidayModal');
    GendaUI.toast('Jour férié ajouté', 'success');
    loadHours();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

async function deleteHoliday(id) {
  try {
    await fetch(`/api/availabilities/holidays/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    GendaUI.toast('Jour férié supprimé', 'success');
    loadHours();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

async function prefillBelgianHolidays(year) {
  try {
    const r = await fetch('/api/availabilities/holidays/prefill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ year })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    GendaUI.toast(`${data.inserted} jour${data.inserted > 1 ? 's' : ''} férié${data.inserted > 1 ? 's' : ''} ajouté${data.inserted > 1 ? 's' : ''} (${data.total} au total pour ${year})`, 'success');
    loadHours();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ============================================================
// Bridge & exports
// ============================================================

bridge({
  loadHours,
  addBizSlot, confirmAddBizSlot, removeBizSlot,
  saveBusinessSchedule, applyStandardHours,
  openClosureModal, saveClosure, deleteClosure,
  openHolidayModal, saveHoliday, deleteHoliday, prefillBelgianHolidays
});

export {
  loadHours,
  addBizSlot, confirmAddBizSlot, removeBizSlot,
  saveBusinessSchedule, applyStandardHours,
  openClosureModal, saveClosure, deleteClosure,
  openHolidayModal, saveHoliday, deleteHoliday, prefillBelgianHolidays
};
