/**
 * Featured Slots / Créneaux vedettes — staff view.
 * Lets practitioners select which time slots to feature on the public booking page.
 * Each selected cell = one start_time (30 min). Lock the week to disable normal bookings.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

let practitioners = [];
let selectedPractId = null;
let weekStart = null; // Monday ISO string
let featuredSlots = []; // current saved featured slots
let selectedSlots = {}; // { 'YYYY-MM-DD_HH:MM': true }
let bookedSlots = {}; // { 'YYYY-MM-DD_HH:MM': true }
let weekLocked = false; // is current week locked?
let slotMin = '08:00';
let slotMax = '19:00';

function localDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

function getMonday(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return localDate(dt);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localDate(d);
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

async function loadFeaturedSlots() {
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const dr = await fetch('/api/dashboard', { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const dd = await dr.json();
    practitioners = dd.practitioners || [];
    if (practitioners.length === 0) {
      c.innerHTML = '<div class="empty">Aucun praticien configuré</div>';
      return;
    }
    if (!selectedPractId) selectedPractId = practitioners[0].id;
    if (!weekStart) weekStart = getMonday(new Date());

    // Load practitioner's availability bounds
    const ar = await fetch('/api/availabilities', { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const ad = await ar.json();
    const pa = ad.availabilities?.[selectedPractId];
    if (pa) {
      slotMin = pa.slot_min || '08:00';
      slotMax = pa.slot_max || '19:00';
    }

    await loadWeekData();
    render();
  } catch (e) {
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;
  }
}

async function loadWeekData() {
  const [fr, lr, br] = await Promise.all([
    fetch(`/api/featured-slots?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    }),
    fetch(`/api/featured-slots/lock?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    }),
    fetch(`/api/bookings?practitioner_id=${selectedPractId}&from=${weekStart}&to=${addDays(weekStart, 7)}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    })
  ]);
  const fd = await fr.json();
  const ld = await lr.json();
  const bd = await br.json();
  featuredSlots = fd.featured_slots || [];
  weekLocked = ld.locked || false;

  // Build selected map — each slot is a direct entry (no end_time split)
  selectedSlots = {};
  featuredSlots.forEach(s => {
    const dateKey = (s.date || '').slice(0, 10);
    const st = (s.start_time || '').slice(0, 5);
    selectedSlots[dateKey + '_' + st] = true;
  });

  // Build booked map
  bookedSlots = {};
  const bookings = bd.bookings || [];
  bookings.forEach(b => {
    if (['cancelled', 'no_show'].includes(b.status)) return;
    const bDate = (b.start_at || '').split('T')[0];
    const bStart = new Date(b.start_at);
    const bEnd = new Date(b.end_at);
    let t = bStart.getHours() * 60 + bStart.getMinutes();
    const end = bEnd.getHours() * 60 + bEnd.getMinutes();
    while (t < end) {
      bookedSlots[bDate + '_' + minToTime(t)] = true;
      t += 30;
    }
  });
}

function render() {
  const c = document.getElementById('contentArea');
  const pract = practitioners.find(p => p.id === selectedPractId);
  const practName = pract?.display_name || '';

  // Week label
  const weekEndDate = addDays(weekStart, 6);
  const wsLabel = fmtDate(weekStart);
  const weLabel = fmtDate(weekEndDate);
  const isPast = weekStart < getMonday(new Date());

  // Count selected
  const selCount = Object.keys(selectedSlots).length;

  // Practitioner selector
  let practSelect = '';
  if (practitioners.length > 1) {
    const opts = practitioners.map(p => `<option value="${p.id}"${p.id === selectedPractId ? ' selected' : ''}>${p.display_name}</option>`).join('');
    practSelect = `<select id="fsPractSelect" onchange="fsSwitchPract(this.value)" style="font-size:.85rem;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg)">${opts}</select>`;
  } else {
    practSelect = `<span style="font-weight:600;font-size:.9rem">${practName}</span>`;
  }

  // Week navigation
  const weekNav = `<div style="display:flex;align-items:center;gap:10px">
    <button class="btn-outline btn-sm" onclick="fsWeekNav(-1)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg></button>
    <span style="font-size:.85rem;font-weight:600;min-width:200px;text-align:center">${wsLabel} — ${weLabel}</span>
    <button class="btn-outline btn-sm" onclick="fsWeekNav(1)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg></button>
  </div>`;

  // Build grid
  const startMin = timeToMin(slotMin);
  const endMin = timeToMin(slotMax);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));

  let grid = '<div class="fs-grid">';
  // Header row
  grid += '<div class="fs-row fs-header"><div class="fs-time-col"></div>';
  days.forEach(d => {
    grid += `<div class="fs-day-col">${fmtDate(d)}</div>`;
  });
  grid += '</div>';

  // Time rows
  for (let m = startMin; m < endMin; m += 30) {
    const timeStr = minToTime(m);
    grid += `<div class="fs-row"><div class="fs-time-col">${timeStr}</div>`;
    days.forEach(d => {
      const key = d + '_' + timeStr;
      const isSelected = !!selectedSlots[key];
      const isBooked = !!bookedSlots[key];
      let cls = 'fs-cell';
      if (isSelected) cls += ' fs-selected';
      else if (isBooked) cls += ' fs-booked';
      const onclick = isPast ? '' : `onclick="fsToggle('${key}')"`;
      const icon = isSelected ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : isBooked ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;opacity:.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' : '';
      grid += `<div class="${cls}" ${onclick}>${icon}</div>`;
    });
    grid += '</div>';
  }
  grid += '</div>';

  // Lock badge for header
  const lockBadge = weekLocked ? ' <span style="color:var(--primary);font-size:.78rem">🔒 Verrouillée</span>' : '';

  let h = `<p style="font-size:.85rem;color:var(--text-3);margin-bottom:16px">Sélectionnez les créneaux à mettre en avant sur votre page de réservation. Verrouillez la semaine pour n'exposer que ces créneaux aux clients.</p>`;
  h += `<div class="card"><div class="card-h" style="flex-wrap:wrap;gap:10px"><div style="display:flex;align-items:center;gap:12px">${practSelect}${weekNav}${lockBadge}</div>`;
  if (!isPast) {
    h += `<div style="display:flex;gap:8px;align-items:center"><span style="font-size:.8rem;color:var(--text-4)">${selCount} créneau${selCount > 1 ? 'x' : ''} sélectionné${selCount > 1 ? 's' : ''}</span>`;
    h += `<button class="btn-outline btn-sm btn-danger" onclick="fsClear()" ${selCount === 0 ? 'disabled' : ''}>Tout effacer</button>`;
    h += `<button class="btn-primary btn-sm" onclick="fsSave()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1-2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer</button>`;
    // Lock/unlock button
    if (weekLocked) {
      h += `<button class="btn-outline btn-sm" onclick="fsToggleLock()" style="border-color:var(--primary);color:var(--primary)">🔓 Déverrouiller</button>`;
    } else {
      h += `<button class="btn-outline btn-sm" onclick="fsToggleLock()">🔒 Verrouiller</button>`;
    }
    h += `</div>`;
  }
  h += `</div><div style="padding:14px 18px;overflow-x:auto">${grid}`;
  h += `<div style="display:flex;gap:16px;margin-top:12px;font-size:.78rem;color:var(--text-4)"><span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:var(--primary-bg);border:1.5px solid var(--primary)"></span>Sélectionné</span><span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:var(--bg-3);border:1.5px solid var(--border)"></span>Déjà réservé</span></div>`;
  h += `</div></div>`;

  c.innerHTML = h;
}

function fsToggle(key) {
  if (selectedSlots[key]) delete selectedSlots[key];
  else selectedSlots[key] = true;
  render();
}

async function fsSave() {
  // Convert selectedSlots map to flat list of {date, start_time}
  const slots = [];
  Object.keys(selectedSlots).sort().forEach(key => {
    const [date, time] = key.split('_');
    slots.push({ date, start_time: time });
  });

  try {
    const r = await fetch('/api/featured-slots', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ practitioner_id: selectedPractId, week_start: weekStart, slots })
    });
    if (!r.ok) throw new Error((await r.json()).error);
    const count = slots.length;
    GendaUI.toast(`${count} créneau${count > 1 ? 'x' : ''} vedette${count > 1 ? 's' : ''} enregistré${count > 1 ? 's' : ''}`, 'success');
    await loadWeekData();
    render();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}

async function fsToggleLock() {
  if (!selectedPractId || !weekStart) return;

  try {
    if (weekLocked) {
      // Unlock
      const r = await fetch(`/api/featured-slots/lock?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + api.getToken() }
      });
      if (!r.ok) throw new Error((await r.json()).error);
      weekLocked = false;
      GendaUI.toast('Semaine déverrouillée — booking normal réactivé', 'success');
    } else {
      // Save first if there are unsaved changes
      const selCount = Object.keys(selectedSlots).length;
      if (selCount === 0) {
        GendaUI.toast('Ajoutez des créneaux vedette avant de verrouiller', 'info');
        return;
      }
      // Auto-save before locking
      await fsSave();

      const r = await fetch('/api/featured-slots/lock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ practitioner_id: selectedPractId, week_start: weekStart })
      });
      if (!r.ok) throw new Error((await r.json()).error);
      weekLocked = true;
      GendaUI.toast(`Semaine verrouillée — ${selCount} créneau${selCount > 1 ? 'x' : ''} vedette${selCount > 1 ? 's' : ''} en ligne`, 'success');
    }
    render();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}

async function fsClear() {
  if (!confirm('Effacer tous les créneaux vedettes de cette semaine ?')) return;
  try {
    const r = await fetch(`/api/featured-slots?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error((await r.json()).error);
    selectedSlots = {};
    // Also unlock if locked
    if (weekLocked) {
      await fetch(`/api/featured-slots/lock?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + api.getToken() }
      });
      weekLocked = false;
    }
    GendaUI.toast('Créneaux vedettes effacés', 'success');
    await loadWeekData();
    render();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}

async function fsWeekNav(dir) {
  weekStart = addDays(weekStart, dir * 7);
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  await loadWeekData();
  render();
}

async function fsSwitchPract(pid) {
  selectedPractId = pid;
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  // Reload availability bounds for new practitioner
  try {
    const ar = await fetch('/api/availabilities', { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    const ad = await ar.json();
    const pa = ad.availabilities?.[pid];
    if (pa) {
      slotMin = pa.slot_min || '08:00';
      slotMax = pa.slot_max || '19:00';
    }
  } catch (e) { /* use defaults */ }
  await loadWeekData();
  render();
}

bridge({ loadFeaturedSlots, fsToggle, fsSave, fsClear, fsWeekNav, fsSwitchPract, fsToggleLock });

export { loadFeaturedSlots, fsToggle, fsSave, fsClear, fsWeekNav, fsSwitchPract, fsToggleLock };
