/**
 * Booking Reminders - CRUD for booking reminders in detail modal.
 */
import { api, calState } from '../../state.js';
import { esc, safeId, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { IC } from '../../utils/icons.js';

function fcRenderReminders() {
  const r = calState.fcDetailData.reminders, el = document.getElementById('calReminderList');
  const lbl = { 15: '15 min', 30: '30 min', 60: '1h', 120: '2h', 1440: 'Veille' };
  const ch = {
    browser: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Notif',
    email: IC.mail + ' Email',
    both: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>+' + IC.mail
  };
  if (!r.length) {
    el.innerHTML = '<div class="m-empty"><div class="m-empty-icon">' + IC.bell + '</div>Aucun rappel</div>';
    return;
  }
  el.innerHTML = r.map(x => `<div class="reminder-card"><div class="reminder-icon">${IC.bell}</div><div><div class="ri-time">${lbl[x.offset_minutes] || esc(String(x.offset_minutes)) + ' min'} avant</div><div class="ri-channel">${ch[x.channel] || esc(x.channel)}${x.is_sent ? ' \u00b7 ' + IC.check + ' envoy\u00e9' : ''}</div></div><button class="reminder-delete" onclick="fcDeleteReminder('${safeId(x.id)}')">${IC.x}</button></div>`).join('');
}

async function calAddReminder() {
  if (calAddReminder._busy) return;
  calAddReminder._busy = true;
  try {
    const offset = parseInt(document.getElementById('calReminderOffset').value);
    const channel = document.getElementById('calReminderChannel').value;
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ offset_minutes: offset, channel: channel })
    });
    if (!r.ok) throw new Error('Erreur');
    const d = await r.json();
    calState.fcDetailData.reminders.push(d.reminder);
    fcRenderReminders();
    gToast('Rappel ajout\u00e9', 'success');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { calAddReminder._busy = false; }
}

async function fcDeleteReminder(remId) {
  if (fcDeleteReminder._busy) return;
  fcDeleteReminder._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/reminders/${remId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error('Erreur');
    calState.fcDetailData.reminders = calState.fcDetailData.reminders.filter(r => String(r.id) !== String(remId));
    fcRenderReminders();
  } catch (e) { gToast('Erreur', 'error'); }
  finally { fcDeleteReminder._busy = false; }
}

// Expose to global scope for onclick handlers
bridge({ calAddReminder, fcDeleteReminder });

export { fcRenderReminders, calAddReminder, fcDeleteReminder };
