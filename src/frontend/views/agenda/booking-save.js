/**
 * Booking Save - save all booking changes, time change notification flow.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';
import { fcTimeDiffMin, _serverSlotUnavailable } from './booking-edit.js';
import { storeUndoAction } from './booking-undo.js';
import { toBrusselsISO } from '../../utils/format.js';

async function calSaveAll() {
  // Bug M13 fix: double-click guard
  if (calSaveAll._busy) return;
  calSaveAll._busy = true;
  const _btn = document.getElementById('mBtnSave');
  if (_btn) { _btn.disabled = true; _btn.classList.add('is-loading'); }
  try {
  if (_serverSlotUnavailable) {
    gToast('Créneau indisponible — modifiez l\'horaire', 'error');
    return;
  }
  const nd = document.getElementById('calEditDate').value;
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  if (!nd || !ns || !ne) return;
  if (fcTimeDiffMin(ns, ne) <= 0) { gToast("Fin doit \u00eatre apr\u00e8s d\u00e9but", "error"); return; }

  const newPrac = document.getElementById('uPracSelect').value;
  const newComment = document.getElementById('uComment').value.trim();
  const isFreestyle = !calState.fcCurrentBooking?.service_name;
  const newLabel = isFreestyle ? document.getElementById('uFreeLabel').value.trim() : '';
  // Color from the global swatch (works for all booking types)
  const newColor = document.getElementById('uBookingColor')?.value || '';

  // Check if time changed (needs notify flow)
  const timeChanged = nd !== calState.fcEditOriginal.date || ns !== calState.fcEditOriginal.start || ne !== calState.fcEditOriginal.end;

  // Build edit payload (non-time fields)
  const editPayload = {};
  if (String(newPrac) !== String(calState.fcEditOriginal.practitioner_id)) editPayload.practitioner_id = newPrac;
  // FE-1: API PATCH /edit accepts `comment` and maps it to DB column `comment_client`
  if (newComment !== (calState.fcEditOriginal.comment || '')) editPayload.comment = newComment;
  if (isFreestyle) {
    if (newLabel !== (calState.fcEditOriginal.custom_label || '')) editPayload.custom_label = newLabel;
  }
  // Color: compare against raw DB value (b.color || '') to detect actual changes.
  // uBookingColor is initialized to b.color || '' so this is a 1:1 comparison.
  if (newColor !== (calState.fcEditOriginal.color || '')) editPayload.color = newColor || null;

  // Lock toggle
  const newLocked = document.getElementById('calLocked')?.value === 'true';
  if (newLocked !== calState.fcEditOriginal.locked) editPayload.locked = newLocked;

  // Service conversion: freestyle → service now handled by fcConvertDirectAdd() in booking-detail.js
  // Only handle service → freestyle here (to-free)
  if (calState._convertAction === 'to-free') {
    editPayload.service_id = null;
    editPayload.service_variant_id = null;
    editPayload.custom_label = document.getElementById('uFreeLabel')?.value.trim() || null;
  }

  // Group practitioner reassignment must go through /move, not /edit
  // (the /edit endpoint blocks practitioner changes on grouped bookings)
  let groupPracReassign = null;
  const isGrouped = !!calState.fcCurrentBooking?.group_id;
  if (isGrouped && editPayload.practitioner_id) {
    groupPracReassign = editPayload.practitioner_id;
    delete editPayload.practitioner_id;
  }

  const hasFieldChanges = Object.keys(editPayload).length > 0;

  // Save client contact changes (phone/email)
  const newPhone = document.getElementById('uClientPhone')?.value.trim() || '';
  const newEmail = document.getElementById('uClientEmail')?.value.trim() || '';
  const clientContactChanged = newPhone !== (calState.fcEditOriginal.client_phone || '') || newEmail !== (calState.fcEditOriginal.client_email || '');

  if (clientContactChanged && calState.fcCurrentBooking?.client_id) {
    try {
      const r = await fetch(`/api/clients/${calState.fcCurrentBooking.client_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ phone: newPhone || null, email: newEmail || null })
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur coordonnées'); }
    } catch (e) { gToast('Erreur: ' + e.message, 'error'); return; }
  }

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
    // Store pending group practitioner change for calDoSaveTime to pick up
    if (groupPracReassign) calState._groupPracReassign = groupPracReassign;
    document.getElementById('calNotifyPanel').style.display = 'block';
    document.getElementById('calNotifyPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    calState.fcSelectedNotifyChannel = null;
    document.querySelectorAll('.notify-opt').forEach(o => o.classList.remove('selected'));
    document.getElementById('calSendNotifyBtn').style.display = 'none';
    return; // Wait for notify selection
  }

  // Group practitioner reassignment (no time change) → /move with same time + new practitioner
  if (groupPracReassign) {
    const start_at = toBrusselsISO(nd, ns);
    const end_at = toBrusselsISO(nd, ne);
    try {
      const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ start_at, end_at, practitioner_id: groupPracReassign })
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    } catch (e) { gToast('Erreur: ' + e.message, 'error'); return; }
  }

  // Reset convert action
  calState._convertAction = null;

  // No time change -> just close
  if (hasFieldChanges || clientContactChanged || groupPracReassign) gToast('RDV mis \u00e0 jour', 'success');
  else gToast('Aucun changement');
  document.getElementById('calDetailModal')._dirtyGuard?.markClean();
  closeCalModal('calDetailModal');
  fcRefresh();
  } finally {
    calSaveAll._busy = false;
    if (_btn) { _btn.classList.remove('is-loading'); _btn.disabled = false; }
  }
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
  const bh = pracId && calState.fcPracBusinessHours?.[pracId] ? calState.fcPracBusinessHours[pracId] : calState.fcBusinessHours;
  if (bh.length === 0) return true;
  // Convert to Brussels TZ to get correct day/hours
  const startParts = startDate.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
  const endParts = endDate.toLocaleString('en-GB', { timeZone: 'Europe/Brussels', hour12: false }).split(/[\s,/:]+/);
  const bxlStartDay = new Date(startDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }) + 'T12:00:00Z').getUTCDay();
  const day = bxlStartDay;
  const dayBH = bh.filter(b => b.daysOfWeek.includes(day));
  if (dayBH.length === 0) return false;
  const startH = (parseInt(startParts[3]) || 0) + (parseInt(startParts[4]) || 0) / 60;
  const endH = (parseInt(endParts[3]) || 0) + (parseInt(endParts[4]) || 0) / 60;
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
  // Bug M13 fix: double-click guard
  if (calDoSaveTime._busy) return;
  calDoSaveTime._busy = true;
  const _btn2 = document.getElementById('calSendNotifyBtn');
  if (_btn2) { _btn2.disabled = true; _btn2.classList.add('is-loading'); }
  try {
  const nd = document.getElementById('calEditDate').value;
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  // Build proper ISO strings preserving Brussels wall-clock time
  const start_at = toBrusselsISO(nd, ns);
  const end_at = toBrusselsISO(nd, ne);
  // Capture old time for undo
  const oldStartAt = toBrusselsISO(calState.fcEditOriginal.date, calState.fcEditOriginal.start);
  const oldEndAt = toBrusselsISO(calState.fcEditOriginal.date, calState.fcEditOriginal.end);
    const isGrouped = !!calState.fcCurrentBooking?.group_id;

    // NOTE: Business hours validation removed for manual bookings.
    // Practitioners can place bookings during breaks at their discretion.
    // Public booking API enforces availability constraints for clients.

    // -- Save --
    let r;
    if (isGrouped) {
      // Use pending practitioner reassignment if set, otherwise keep current
      const groupPracId = calState._groupPracReassign || calState.fcCurrentBooking.practitioner_id;
      delete calState._groupPracReassign;
      r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ start_at, end_at, practitioner_id: groupPracId, notify: !!notify, notify_channel: channel })
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
    const groupCount = result.count || calState.fcDetailData?.group_siblings?.length || '?';
    const timeActuallyChanged = start_at !== oldStartAt || end_at !== oldEndAt;
    const notifyLabels = { email: 'Email envoy\u00e9', sms: 'SMS envoy\u00e9', both: 'Email + SMS envoy\u00e9s' };
    const label = notify
      ? (notifyLabels[channel] || 'Client notifi\u00e9')
      : (isGrouped ? `Groupe d\u00e9plac\u00e9 (${groupCount} prestations)` : (timeActuallyChanged ? 'Horaire mis \u00e0 jour' : 'Aucun changement'));
    // Store undo for non-grouped time changes
    if (!isGrouped) {
      storeUndoAction(calState.fcCurrentEventId, 'modify', { start_at: oldStartAt, end_at: oldEndAt });
      gToast(label, 'success', { label: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Annuler', fn: () => window.fcUndoLast() }, 8000);
    } else {
      gToast(label, 'success');
    }
    calCloseNotify();
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally {
    calDoSaveTime._busy = false;
    if (_btn2) { _btn2.classList.remove('is-loading'); _btn2.disabled = false; }
  }
}

// Expose to global scope for onclick handlers
bridge({ calSaveAll, calSelectNotify, calCloseNotify, calSendNotification });

export { calSaveAll, calDoSaveTime, calSelectNotify, calCloseNotify, calSendNotification, fcCheckBusinessHours };
