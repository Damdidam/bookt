/**
 * Calendar Featured Slots — "Mode vedette" toggle for the calendar.
 * When active, clicking on the calendar toggles featured start times
 * (gold background events). Save to persist vedette slots.
 * Supports multi-week selection — slots are grouped by week for save.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { showConfirmDialog } from '../../utils/dirty-guard.js';
import { fcRefresh } from './calendar-init.js';

// ── Featured mode state ──
let fsActive = false;            // is vedette mode on?
let fsPendingSlots = {};         // { 'YYYY-MM-DD_HH:MM': true } — current selection (all weeks)
let fsDirty = false;             // has user changed anything since last save?
let fsSavedSlots = {};           // { 'YYYY-MM-DD_HH:MM': true } — saved slots cache (for display outside mode)

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
  const dt = new Date(d + 'T12:00:00');
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

function fsGetPracId() {
  return calState.fcCurrentFilter !== 'all'
    ? calState.fcCurrentFilter
    : calState.fcPractitioners[0]?.id;
}

// ── Toggle mode on/off ──
async function fsToggleMode() {
  if (fsActive) {
    if (fsDirty) {
      if (!(await showConfirmDialog('Vous avez des modifications non enregistrées. Quitter le mode vedette ?'))) return;
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

  // Expose dirty guard for router navigation check
  window._fsFeaturedDirty = () => fsActive && fsDirty;
  window._fsFeaturedDeactivate = () => fsDeactivate();

  // Load ALL future featured slots before changing slotDuration (race condition fix)
  await fsLoadAllSlots();

  // Switch calendar to 15-min grid
  if (calState.fcCal) {
    fsOriginalSlotDuration = calState.fcCal.getOption('slotDuration');
    calState.fcCal.setOption('slotDuration', '00:15:00');
    calState.fcCal.setOption('snapDuration', '00:05:00');
  }

  document.getElementById('fcCalendar')?.classList.add('fs-mode-active');
  const btn = document.getElementById('fsToggleBtn');
  if (btn) { btn.classList.add('active'); }

  fsShowActionBar();
  fsUpdateCount(); // update count AFTER action bar is created
  fcRefresh();
}

function fsDeactivate() {
  fsActive = false;
  fsDirty = false;
  fsPendingSlots = {};

  // Clean up router guard
  window._fsFeaturedDirty = null;
  window._fsFeaturedDeactivate = null;

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
  // Reload saved slots so they show as subtle indicators
  fsLoadSavedSlots().then(() => fcRefresh());
}

/**
 * Load saved featured slots for display outside vedette mode.
 * Called on calendar init and after saving/deactivating.
 */
async function fsLoadSavedSlots() {
  const pracId = fsGetPracId();
  if (!pracId || !calState.fcBusinessSettings?.featured_slots_enabled) {
    fsSavedSlots = {};
    return;
  }
  try {
    const res = await fetch(`/api/featured-slots?practitioner_id=${pracId}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await res.json();
    fsSavedSlots = {};
    (data.featured_slots || []).forEach(s => {
      const dateKey = (s.date || '').slice(0, 10);
      const st = (s.start_time || '').slice(0, 5);
      fsSavedSlots[dateKey + '_' + st] = true;
    });
  } catch (e) {
    fsSavedSlots = {};
  }
}

/**
 * Load ALL future featured slots for the practitioner (not just one week).
 * This allows multi-week selection and navigation without losing data.
 */
async function fsLoadAllSlots() {
  const pracId = fsGetPracId();
  if (!pracId) return;

  try {
    // No week_start param → backend returns all future slots
    const res = await fetch(`/api/featured-slots?practitioner_id=${pracId}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await res.json();
    const savedSlots = data.featured_slots || [];

    // Merge into fsPendingSlots (keep any unsaved local selections)
    if (!fsDirty) {
      fsPendingSlots = {};
    }
    savedSlots.forEach(s => {
      const dateKey = (s.date || '').slice(0, 10);
      const st = (s.start_time || '').slice(0, 5);
      fsPendingSlots[dateKey + '_' + st] = true;
    });
    fsUpdateCount();
  } catch (e) {
    console.error('fsLoadAllSlots error:', e);
  }
}

/** Called when calendar navigates — just refresh, data is already loaded */
async function fsOnDatesSet() {
  if (!fsActive) return;
  // No need to reload — we already have all future slots
  // Just refresh to render background events for the new visible range
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
 * Each slot = a 15-min background event. Works across all weeks.
 */
function fsBuildBackgroundEvents() {
  // Show saved slots even outside vedette mode (subtle indicator)
  const source = fsActive ? fsPendingSlots : fsSavedSlots;
  if (Object.keys(source).length === 0) return [];
  const events = [];
  Object.keys(source).forEach(key => {
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
      classNames: ['fs-bg-event', ...(fsActive ? [] : ['fs-bg-saved'])],
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
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;color:var(--amber)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
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

/**
 * Save featured slots — groups by week and sends one PUT per week.
 * This allows slots across multiple weeks to be saved in one click.
 */
async function fsSaveSlots() {
  const pracId = fsGetPracId();
  if (!pracId) return;

  // Convert pending map to flat list grouped by week
  const slotsByWeek = {};
  Object.keys(fsPendingSlots).sort().forEach(key => {
    const [date, time] = key.split('_');
    const weekStart = getMonday(date);
    if (!slotsByWeek[weekStart]) slotsByWeek[weekStart] = [];
    slotsByWeek[weekStart].push({ date, start_time: time });
  });

  const weeks = Object.keys(slotsByWeek);

  // If no slots left, clear ALL weeks that had saved slots
  if (weeks.length === 0) {
    try {
      // Collect all weeks from saved slots
      const savedWeeks = new Set();
      Object.keys(fsSavedSlots).forEach(key => {
        const date = key.split('_')[0];
        savedWeeks.add(getMonday(date));
      });

      // Also include current visible week in case
      const visibleDate = calState.fcCal?.getDate();
      if (visibleDate) savedWeeks.add(getMonday(localDate(visibleDate)));

      // Delete + unlock each week
      await Promise.all([...savedWeeks].map(async weekStart => {
        await fetch(`/api/featured-slots?practitioner_id=${pracId}&week_start=${weekStart}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + api.getToken() }
        });
        await fetch(`/api/featured-slots/lock?practitioner_id=${pracId}&week_start=${weekStart}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + api.getToken() }
        });
      }));

      fsSavedSlots = {};
      fsDeactivate();
      gToast('Créneaux vedette supprimés', 'success');
      return;
    } catch (e) {
      gToast('Erreur: ' + e.message, 'error');
      return;
    }
  }

  try {
    // Find weeks that had saved slots but no longer have any — need to delete those
    const savedWeeks = new Set();
    Object.keys(fsSavedSlots).forEach(key => savedWeeks.add(getMonday(key.split('_')[0])));
    const removedWeeks = [...savedWeeks].filter(w => !slotsByWeek[w]);

    // Delete removed weeks + save current weeks in parallel
    await Promise.all([
      // Delete weeks that no longer have slots
      ...removedWeeks.map(async weekStart => {
        await fetch(`/api/featured-slots?practitioner_id=${pracId}&week_start=${weekStart}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + api.getToken() }
        });
        await fetch(`/api/featured-slots/lock?practitioner_id=${pracId}&week_start=${weekStart}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + api.getToken() }
        });
      }),
      // Save/update weeks that have slots
      ...weeks.map(async weekStart => {
        const saveRes = await fetch('/api/featured-slots', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ practitioner_id: pracId, week_start: weekStart, slots: slotsByWeek[weekStart] })
        });
        if (!saveRes.ok) throw new Error((await saveRes.json()).error);

        const lockRes = await fetch('/api/featured-slots/lock', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ practitioner_id: pracId, week_start: weekStart })
        });
        if (!lockRes.ok) throw new Error((await lockRes.json()).error);
      })
    ]);

    const totalCount = Object.keys(fsPendingSlots).length;
    const weekLabel = weeks.length > 1 ? ` sur ${weeks.length} semaines` : '';
    // Close featured mode after save
    fsDeactivate();
    gToast(`${totalCount} créneau${totalCount > 1 ? 'x' : ''} mis en vedette${weekLabel}`, 'success');
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
  fsSaveSlots, fsCancelMode, fsClearAll, fsDeactivate, fsLoadSavedSlots
};
