/**
 * Featured Slots / Créneaux vedettes — staff view.
 * Lets practitioners select which time slots to feature on the public booking page.
 * Each selected cell = one start_time (30 min). Lock the week to disable normal bookings.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';

const esc=s=>s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):'';

let practitioners = [];
let selectedPractId = null;
let weekStart = null; // Monday ISO string
let featuredSlots = []; // current saved featured slots
let selectedSlots = {}; // { 'YYYY-MM-DD_HH:MM': true }
let bookedSlots = {}; // { 'YYYY-MM-DD_HH:MM': true }
let weekLocked = false; // is current week locked?
let savedSlots = {}; // snapshot of selectedSlots after last load/save
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
    practitioners = (dd.practitioners || []).filter(p => p.featured_enabled);
    if (practitioners.length === 0) {
      c.innerHTML = '<div class="empty">Aucun praticien avec le mode vedette activé.<br><span style="font-size:.8rem;color:var(--text-4)">Activez-le dans Équipe > Modifier.</span></div>';
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
    renderGrid();

    window.addEventListener('beforeunload', (e) => {
      if (isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  } catch (e) {
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;
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

  savedSlots = { ...selectedSlots };

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

function renderGrid() {
  const c = document.getElementById('contentArea');
  const pract = practitioners.find(p => p.id === selectedPractId);
  const practName = pract?.display_name || '';
  const weekEndDate = addDays(weekStart, 6);
  const wsLabel = fmtDate(weekStart);
  const weLabel = fmtDate(weekEndDate);
  const isPast = weekStart < getMonday(new Date());

  // Practitioner selector
  let practSelect = '';
  if (practitioners.length > 1) {
    const opts = practitioners.map(p =>
      `<option value="${p.id}"${p.id === selectedPractId ? ' selected' : ''}>${esc(p.display_name)}</option>`
    ).join('');
    practSelect = `<select id="fsPractSelect" onchange="fsSwitchPract(this.value)" style="font-size:.85rem;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg)">${opts}</select>`;
  } else {
    practSelect = `<span style="font-weight:600;font-size:.9rem">${esc(practName)}</span>`;
  }

  // Week nav
  const weekNav = `<div style="display:flex;align-items:center;gap:10px">
    <button class="btn-outline btn-sm" onclick="fsWeekNav(-1)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg></button>
    <span style="font-size:.85rem;font-weight:600;min-width:200px;text-align:center">${wsLabel} — ${weLabel}</span>
    <button class="btn-outline btn-sm" onclick="fsWeekNav(1)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg></button>
  </div>`;

  // Grid
  const startMin = timeToMin(slotMin);
  const endMin = timeToMin(slotMax);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));

  let grid = '<div class="fs-grid" id="fsGrid">';
  grid += '<div class="fs-row fs-header"><div class="fs-time-col"></div>';
  days.forEach(d => {
    const clickable = isPast ? '' : `onclick="fsToggleColumn('${d}')" style="cursor:pointer"`;
    grid += `<div class="fs-day-col" data-day="${d}" ${clickable}>${fmtDate(d)}</div>`;
  });
  grid += '</div>';

  for (let m = startMin; m < endMin; m += 30) {
    const timeStr = minToTime(m);
    grid += `<div class="fs-row"><div class="fs-time-col">${timeStr}</div>`;
    days.forEach(d => {
      const key = d + '_' + timeStr;
      const isBooked = !!bookedSlots[key];
      const title = isBooked ? 'title="Créneau déjà réservé"' : '';
      const onclick = (!isPast && !isBooked) ? `onclick="fsToggle('${key}')"` : '';
      grid += `<div class="fs-cell" data-key="${key}" data-day="${d}" ${title} ${onclick}></div>`;
    });
    grid += '</div>';
  }
  grid += '</div>';

  // State badge + buttons placeholder
  let h = `<p style="font-size:.85rem;color:var(--text-3);margin-bottom:16px">Sélectionnez vos créneaux disponibles, puis publiez pour les rendre visibles aux clients.</p>`;
  h += `<div class="card"><div class="card-h" style="flex-wrap:wrap;gap:10px">`;
  h += `<div style="display:flex;align-items:center;gap:12px">${practSelect}${weekNav}<span id="fsBadge"></span></div>`;
  if (!isPast) {
    h += `<div style="display:flex;gap:8px;align-items:center" id="fsActions"></div>`;
  }
  h += `</div><div style="padding:14px 18px;overflow-x:auto">${grid}`;
  h += `<div style="display:flex;gap:16px;margin-top:12px;font-size:.78rem;color:var(--text-4)">`;
  h += `<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:var(--primary-bg);border:1.5px solid var(--primary)"></span>Sélectionné</span>`;
  h += `<span style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:3px;background:var(--bg-3);border:1.5px solid var(--border)"></span>Déjà réservé</span>`;
  h += `</div></div></div>`;

  c.innerHTML = h;
  updateCells();
}

function updateCells() {
  const isPast = weekStart < getMonday(new Date());
  const selCount = Object.keys(selectedSlots).length;

  // Update each cell
  document.querySelectorAll('.fs-cell').forEach(cell => {
    const key = cell.dataset.key;
    const isSelected = !!selectedSlots[key];
    const isBooked = !!bookedSlots[key];

    cell.className = 'fs-cell';
    if (isBooked) cell.classList.add('fs-booked');
    else if (isSelected) cell.classList.add('fs-selected');

    // Icon
    if (isSelected) {
      cell.innerHTML = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    } else if (isBooked) {
      cell.innerHTML = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;opacity:.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    } else {
      cell.innerHTML = '';
    }
  });

  // Update badge
  const badge = document.getElementById('fsBadge');
  if (badge) {
    badge.innerHTML = weekLocked
      ? `<span style="color:var(--green);font-size:.78rem;font-weight:600">${IC.check || '✓'} Publié</span>`
      : `<span style="color:var(--text-4);font-size:.78rem">● Brouillon</span>`;
  }

  // Update action buttons
  const actions = document.getElementById('fsActions');
  if (actions && !isPast) {
    let btns = `<span style="font-size:.8rem;color:var(--text-4)">${selCount} créneau${selCount > 1 ? 'x' : ''}</span>`;
    if (!weekLocked) {
      btns += `<button class="btn-outline btn-sm btn-danger" onclick="fsClear()" ${selCount === 0 ? 'disabled' : ''}>Tout effacer</button>`;
      btns += `<button class="btn-primary btn-sm" onclick="fsPublish()" ${selCount === 0 ? 'disabled title="Sélectionnez au moins un créneau"' : ''}>${IC.send || '▶'} Publier</button>`;
    } else {
      btns += `<button class="btn-outline btn-sm btn-danger" onclick="fsUnpublish()">Dépublier</button>`;
    }
    actions.innerHTML = btns;
  }
}

function fsToggle(key) {
  if (selectedSlots[key]) delete selectedSlots[key];
  else selectedSlots[key] = true;
  updateCells();
}

async function fsPublish() {
  const selCount = Object.keys(selectedSlots).length;
  if (selCount === 0) {
    GendaUI.toast('Sélectionnez au moins un créneau', 'info');
    return;
  }

  const slots = [];
  Object.keys(selectedSlots).sort().forEach(key => {
    const [date, time] = key.split('_');
    slots.push({ date, start_time: time });
  });

  try {
    // Save slots
    const r1 = await fetch('/api/featured-slots', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ practitioner_id: selectedPractId, week_start: weekStart, slots })
    });
    if (!r1.ok) throw new Error((await r1.json()).error);

    // Lock week
    const r2 = await fetch('/api/featured-slots/lock', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ practitioner_id: selectedPractId, week_start: weekStart })
    });
    if (!r2.ok) {
      GendaUI.toast('Créneaux sauvegardés mais verrouillage échoué — retentez Publier', 'error');
      await loadWeekData();
      updateCells();
      return;
    }

    weekLocked = true;
    savedSlots = { ...selectedSlots };
    GendaUI.toast(`${selCount} créneau${selCount > 1 ? 'x' : ''} publié${selCount > 1 ? 's' : ''}`, 'success');
    updateCells();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}

async function fsUnpublish() {
  try {
    const r = await fetch(`/api/featured-slots/lock?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error((await r.json()).error);
    weekLocked = false;
    GendaUI.toast('Semaine dépubliée — vous pouvez modifier vos créneaux', 'success');
    updateCells();
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
    savedSlots = {};
    // Also unlock if locked
    if (weekLocked) {
      await fetch(`/api/featured-slots/lock?practitioner_id=${selectedPractId}&week_start=${weekStart}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + api.getToken() }
      });
      weekLocked = false;
    }
    GendaUI.toast('Créneaux vedettes effacés', 'success');
    updateCells();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  }
}

function isDirty() {
  const selKeys = Object.keys(selectedSlots).sort().join(',');
  const savedKeys = Object.keys(savedSlots).sort().join(',');
  return selKeys !== savedKeys;
}

async function fsWeekNav(dir) {
  if (isDirty() && !confirm('Vos modifications ne sont pas publiées. Quitter quand même ?')) return;
  weekStart = addDays(weekStart, dir * 7);
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  await loadWeekData();
  renderGrid();
}

async function fsSwitchPract(pid) {
  if (isDirty() && !confirm('Vos modifications ne sont pas publiées. Quitter quand même ?')) return;
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
  renderGrid();
}

function fsToggleColumn(day) {
  if (weekLocked) return;
  const startMin = timeToMin(slotMin);
  const endMin = timeToMin(slotMax);
  const keys = [];
  for (let m = startMin; m < endMin; m += 30) {
    const key = day + '_' + minToTime(m);
    if (!bookedSlots[key]) keys.push(key);
  }
  const allSelected = keys.every(k => !!selectedSlots[k]);
  keys.forEach(k => {
    if (allSelected) delete selectedSlots[k];
    else selectedSlots[k] = true;
  });
  updateCells();
}

bridge({ loadFeaturedSlots, fsToggle, fsPublish, fsUnpublish, fsClear, fsWeekNav, fsSwitchPract, fsToggleColumn });

export { loadFeaturedSlots, fsToggle, fsPublish, fsUnpublish, fsClear, fsWeekNav, fsSwitchPract, fsToggleColumn };
