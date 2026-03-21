/**
 * Calendar Featured Slots — "Mode vedette" toggle for the calendar.
 * When active, clicking on the calendar toggles featured start times
 * (gold background events). Save to persist vedette slots.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';

// ── Featured mode state ──
let fsActive = false;            // is vedette mode on?
let fsPendingSlots = {};         // { 'YYYY-MM-DD_HH:MM': true } — current selection
let fsSavedSlots = [];           // raw from API: [{id, date, start_time, practitioner_id}]
let fsCurrentWeekStart = null;   // Monday ISO of currently viewed week
let fsDirty = false;             // has user changed anything since last save?

/** Check if vedette mode is active */
function fsIsActive() { return fsActive; }

/** Get the pending slots map (for background event rendering) */
function fsGetPendingSlots() { return fsPendingSlots; }

/** Get the practitioner filter for featured slots */
function fsGetPractitioner() {
  return calState.fcCurrentFilter !== 'all' ? calState.fcCurrentFilter : null;
}

// ── Helpers ──
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

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minToTime(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// ── Toggle mode on/off ──
async function fsToggleMode() {
  if (fsActive) {
    if (fsDirty) {
      if (!confirm('Vous avez des modifications non enregistrées. Quitter le mode vedette ?')) return;
    }
    fsDeactivate();
  } else {
    const viewType = calState.fcCal?.view?.type;
    if (viewType === 'dayGridMonth') {
      gToast('Passez en vue semaine ou jour pour utiliser le mode vedette', 'info');
      return;
    }
    if (calState.fcCurrentFilter === 'all' && calState.fcPractitioners.length > 1) {
      gToast('Sélectionnez un praticien pour le mode vedette', 'info');
      return;
    }
    // Auto-enable featured mode if not yet active
    const selectedPrac = calState.fcCurrentFilter !== 'all'
      ? calState.fcPractitioners.find(p => String(p.id) === String(calState.fcCurrentFilter))
      : calState.fcPractitioners.length === 1 ? calState.fcPractitioners[0] : null;
    if (selectedPrac && !selectedPrac.featured_enabled) {
      try {
        await fetch(`/api/practitioners/${selectedPrac.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ featured_enabled: true })
        });
        selectedPrac.featured_enabled = true;
      } catch (e) { /* ignore */ }
    }
    fsActivate();
  }
}

let fsOriginalSlotDuration = null;

async function fsActivate() {
  fsActive = true;
  fsDirty = false;
  fsPendingSlots = {};

  // Load data BEFORE changing slotDuration to avoid race condition.
  await fsLoadCurrentWeek();

  // Now switch calendar to 15-min grid
  if (calState.fcCal) {
    fsOriginalSlotDuration = calState.fcCal.getOption('slotDuration');
    calState.fcCal.setOption('slotDuration', '00:15:00');
    calState.fcCal.setOption('snapDuration', '00:05:00');
  }

  document.getElementById('fcCalendar')?.classList.add('fs-mode-active');
  const btn = document.getElementById('fsToggleBtn');
  if (btn) { btn.classList.add('active'); }

  fsShowActionBar();
  fcRefresh();
}

function fsDeactivate() {
  fsActive = false;
  fsDirty = false;
  fsPendingSlots = {};
  fsSavedSlots = [];

  // Restore original slot duration
  if (calState.fcCal && fsOriginalSlotDuration) {
    calState.fcCal.setOption('slotDuration', fsOriginalSlotDuration);
    calState.fcCal.setOption('snapDuration', '00:05:00');
    fsOriginalSlotDuration = null;
  }

  document.getElementById('fcCalendar')?.classList.remove('fs-mode-active');
  const btn = document.getElementById('fsToggleBtn');
  if (btn) { btn.classList.remove('active'); }

  document.getElementById('fsActionBar')?.remove();
  fcRefresh();
}

/** Load featured slots for the currently visible week */
async function fsLoadCurrentWeek() {
  const view = calState.fcCal?.view;
  if (!view) return;
  const weekStart = getMonday(view.currentStart);
  fsCurrentWeekStart = weekStart;

  const pracId = calState.fcCurrentFilter !== 'all'
    ? calState.fcCurrentFilter
    : calState.fcPractitioners[0]?.id;

  if (!pracId) return;

  try {
    const slotsRes = await fetch(`/api/featured-slots?practitioner_id=${pracId}&week_start=${weekStart}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const slotsData = await slotsRes.json();

    fsSavedSlots = slotsData.featured_slots || [];

    // Build pending slots from saved
    fsPendingSlots = {};
    fsSavedSlots.forEach(s => {
      const dateKey = (s.date || '').slice(0, 10);
      const st = (s.start_time || '').slice(0, 5);
      fsPendingSlots[dateKey + '_' + st] = true;
    });
    fsDirty = false;
    fsUpdateCount();
  } catch (e) {
    console.error('fsLoadCurrentWeek error:', e);
  }
}

/** Called when calendar navigates — reload featured data */
async function fsOnDatesSet() {
  if (!fsActive) return;
  const view = calState.fcCal?.view;
  if (!view) return;
  const newWeek = getMonday(view.currentStart);
  if (newWeek !== fsCurrentWeekStart) {
    // Always update the week — old code blocked on dirty and caused week_start mismatch
    if (fsDirty) {
      gToast('Modifications non enregistrées perdues', 'info');
      fsDirty = false;
    }
    await fsLoadCurrentWeek();
    fcRefresh();
  }
}

/**
 * Handle a click/tap on an empty calendar slot in vedette mode.
 * Toggles the start time at the given datetime.
 */
function fsHandleDateClick(dateStr) {
  if (!fsActive) return false;
  const dt = new Date(dateStr);
  // Block past slots
  if (dt < new Date()) {
    gToast('Impossible de sélectionner un créneau passé', 'info');
    return true;
  }
  const date = localDate(dt);
  // Snap to 15-min grid
  const rawMins = dt.getHours() * 60 + dt.getMinutes();
  const snapped = Math.floor(rawMins / 15) * 15;
  const time = minToTime(snapped);
  const key = date + '_' + time;

  if (fsPendingSlots[key]) {
    delete fsPendingSlots[key];
  } else {
    fsPendingSlots[key] = true;
  }
  fsDirty = true;
  fsUpdateCount();
  fcRefresh();
  return true;
}

/**
 * Build background events array from fsPendingSlots for FullCalendar.
 * Each slot = a 15-min background event.
 */
function fsBuildBackgroundEvents() {
  if (!fsActive) return [];

  const events = [];
  Object.keys(fsPendingSlots).forEach(key => {
    const [date, time] = key.split('_');
    const startHour = parseInt(time.split(':')[0]);
    const startMin = parseInt(time.split(':')[1]);
    const start = date + 'T' + time + ':00';
    const endMin = startMin + 15;
    const endHour = startHour + Math.floor(endMin / 60);
    const endMinute = endMin % 60;
    const end = date + 'T' + String(endHour).padStart(2, '0') + ':' + String(endMinute).padStart(2, '0') + ':00';
    events.push({
      id: 'fs_' + key,
      start: start,
      end: end,
      display: 'background',
      classNames: ['fs-bg-event'],
      extendedProps: { _isFeaturedSlot: true }
    });
  });
  return events;
}

// ── Floating Action Bar ──
function fsShowActionBar() {
  document.getElementById('fsActionBar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'fsActionBar';
  bar.className = 'fs-action-bar';
  bar.innerHTML = `
    <div class="fs-action-left">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;color:#D97706"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      <span class="fs-action-label">Mode vedette</span>
      <span class="fs-action-count" id="fsCount">0 créneaux</span>
    </div>
    <div class="fs-action-right">
      <button class="btn-outline btn-sm btn-danger" onclick="fsClearAll()">Tout effacer</button>
      <button class="btn-outline btn-sm" onclick="fsCancelMode()">Annuler</button>
      <button class="btn-primary btn-sm" onclick="fsSaveSlots()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer</button>
    </div>
  `;
  document.querySelector('.main')?.appendChild(bar);
}

function fsUpdateCount() {
  const count = Object.keys(fsPendingSlots).length;
  const el = document.getElementById('fsCount');
  if (el) el.textContent = `${count} créneau${count > 1 ? 'x' : ''}`;
}

// ── Save / Cancel / Clear ──
async function fsSaveSlots() {
  const pracId = calState.fcCurrentFilter !== 'all'
    ? calState.fcCurrentFilter
    : calState.fcPractitioners[0]?.id;
  if (!pracId) return;

  // Convert pending map to flat list of {date, start_time}
  const slots = [];
  Object.keys(fsPendingSlots).sort().forEach(key => {
    const [date, time] = key.split('_');
    slots.push({ date, start_time: time });
  });

  if (slots.length === 0) {
    gToast('Aucun créneau à enregistrer', 'info');
    return;
  }

  // Compute week_start from actual slot dates (not stale fsCurrentWeekStart)
  const weekStart = getMonday(slots[0].date);

  try {
    const r = await fetch('/api/featured-slots', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ practitioner_id: pracId, week_start: weekStart, slots })
    });
    if (!r.ok) throw new Error((await r.json()).error);
    fsCurrentWeekStart = weekStart;
    fsDirty = false;
    const count = slots.length;
    gToast(`${count} créneau${count > 1 ? 'x' : ''} vedette${count > 1 ? 's' : ''} enregistré${count > 1 ? 's' : ''}`, 'success');
  } catch (e) {
    gToast('Erreur: ' + e.message, 'error');
  }
}

function fsCancelMode() {
  fsDeactivate();
}

async function fsClearAll() {
  if (Object.keys(fsPendingSlots).length === 0) return;
  fsPendingSlots = {};
  fsDirty = true;
  fsUpdateCount();
  fcRefresh();
}

// Bridge for onclick handlers
bridge({ fsToggleMode, fsSaveSlots, fsCancelMode, fsClearAll });

export {
  fsIsActive, fsToggleMode, fsGetPendingSlots, fsGetPractitioner,
  fsHandleDateClick, fsBuildBackgroundEvents, fsOnDatesSet,
  fsSaveSlots, fsCancelMode, fsClearAll, fsDeactivate
};
