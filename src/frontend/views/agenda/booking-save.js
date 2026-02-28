/**
 * Booking Save - save all booking changes, time change notification flow.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';
import { fcTimeDiffMin } from './booking-edit.js';

async function calSaveAll() {
  const nd = document.getElementById('calEditDate').value;
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  if (!nd || !ns || !ne) return;
  if (fcTimeDiffMin(ns, ne) <= 0) { gToast("Fin doit \u00eatre apr\u00e8s d\u00e9but", "error"); return; }

  const newPrac = document.getElementById('uPracSelect').value;
  const newComment = document.getElementById('uComment').value.trim();
  const newNote = document.getElementById('calIntNote').value.trim();
  const isFreestyle = !calState.fcCurrentBooking?.service_name;
  const newLabel = isFreestyle ? document.getElementById('uFreeLabel').value.trim() : '';
  const newColor = isFreestyle ? document.getElementById('uFreeColor').value : '';

  // Check if time changed (needs notify flow)
  const timeChanged = nd !== calState.fcEditOriginal.date || ns !== calState.fcEditOriginal.start || ne !== calState.fcEditOriginal.end;

  // Build edit payload (non-time fields)
  const editPayload = {};
  if (newPrac !== calState.fcEditOriginal.practitioner_id) editPayload.practitioner_id = newPrac;
  if (newComment !== (calState.fcEditOriginal.comment || '')) editPayload.comment = newComment;
  if (newNote !== (calState.fcEditOriginal.internal_note || '')) editPayload.internal_note = newNote;
  if (isFreestyle) {
    if (newLabel !== (calState.fcEditOriginal.custom_label || '')) editPayload.custom_label = newLabel;
    if (newColor !== (calState.fcEditOriginal.color || '')) editPayload.color = newColor;
  }

  const hasFieldChanges = Object.keys(editPayload).length > 0;

  // Save non-time fields first
  if (hasFieldChanges) {
    try {
      const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify(editPayload)
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    } catch (e) { gToast('Erreur: ' + e.message, 'error'); return; }
  }

  // If time changed -> show notify panel
  if (timeChanged) {
    document.getElementById('calNotifyPanel').style.display = 'block';
    document.getElementById('calNotifyPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    calState.fcSelectedNotifyChannel = null;
    document.querySelectorAll('.notify-opt').forEach(o => o.classList.remove('selected'));
    document.getElementById('calSendNotifyBtn').style.display = 'none';
    return; // Wait for notify selection
  }

  // No time change -> just close
  if (hasFieldChanges) gToast('RDV mis \u00e0 jour', 'success');
  else gToast('Aucun changement');
  closeCalModal('calDetailModal');
  fcRefresh();
}

function calSelectNotify(ch, el) {
  calState.fcSelectedNotifyChannel = ch;
  document.querySelectorAll('.notify-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('calSendNotifyBtn').style.display = ch === 'none' ? 'none' : 'inline-flex';
  // If "none", auto-save without notification
  if (ch === 'none') calDoSaveTime(false, null);
}

function calCloseNotify() {
  document.getElementById('calNotifyPanel').style.display = 'none';
}

async function calSendNotification() {
  if (!calState.fcSelectedNotifyChannel || calState.fcSelectedNotifyChannel === 'none') return;
  await calDoSaveTime(true, calState.fcSelectedNotifyChannel);
}

/**
 * Check if a time range fits within business hours for a given day.
 * Uses practitioner-specific hours if pracId provided, otherwise global.
 */
function fcCheckBusinessHours(startDate, endDate, pracId) {
  const bh = pracId && calState.fcPracBusinessHours[pracId] ? calState.fcPracBusinessHours[pracId] : calState.fcBusinessHours;
  if (bh.length === 0) return true;
  const day = startDate.getDay();
  const dayBH = bh.filter(b => b.daysOfWeek.includes(day));
  if (dayBH.length === 0) return false;
  const startH = startDate.getHours() + startDate.getMinutes() / 60;
  const endH = endDate.getHours() + endDate.getMinutes() / 60;
  const slots = dayBH.map(b => ({
    s: parseInt(b.startTime.split(':')[0]) + parseInt(b.startTime.split(':')[1] || 0) / 60,
    e: parseInt(b.endTime.split(':')[0]) + parseInt(b.endTime.split(':')[1] || 0) / 60
  })).sort((a, b) => a.s - b.s);
  const merged = [];
  for (const sl of slots) {
    if (merged.length > 0 && sl.s <= merged[merged.length - 1].e) {
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, sl.e);
    } else {
      merged.push({ s: sl.s, e: sl.e });
    }
  }
  return merged.some(sl => startH >= sl.s && endH <= sl.e);
}

async function calDoSaveTime(notify, channel) {
  const nd = document.getElementById('calEditDate').value;
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  // Build proper ISO strings (browser local -> UTC) so backend delta calc is correct
  const start_at = new Date(nd + 'T' + ns).toISOString();
  const end_at = new Date(nd + 'T' + ne).toISOString();
  try {
    const isGrouped = !!calState.fcCurrentBooking?.group_id;

    // NOTE: Business hours validation removed for manual bookings.
    // Practitioners can place bookings during breaks at their discretion.
    // Public booking API enforces availability constraints for clients.

    // -- Save --
    let r;
    if (isGrouped) {
      r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ start_at, end_at, practitioner_id: calState.fcCurrentBooking.practitioner_id })
      });
    } else {
      r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/modify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ start_at, end_at, notify: !!notify, notify_channel: channel })
      });
    }
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    const result = await r.json();
    const label = isGrouped
      ? `Groupe d\u00e9plac\u00e9 (${result.count || calState.fcCurrentBooking.group_order + 1} prestations)`
      : (notify ? { email: 'Email envoy\u00e9', sms: 'SMS envoy\u00e9', both: 'Email + SMS envoy\u00e9s' }[channel] : 'Horaire mis \u00e0 jour');
    gToast(label, 'success');
    calCloseNotify();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

// Expose to global scope for onclick handlers
bridge({ calSaveAll, calSelectNotify, calCloseNotify, calSendNotification });

export { calSaveAll, calDoSaveTime, calSelectNotify, calCloseNotify, calSendNotification, fcCheckBusinessHours };
