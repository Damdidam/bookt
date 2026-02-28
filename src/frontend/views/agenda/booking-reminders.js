/**
 * Booking Reminders - CRUD for booking reminders in detail modal.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';

function fcRenderReminders() {
  const r = calState.fcDetailData.reminders, el = document.getElementById('calReminderList');
  const lbl = { 15: '15 min', 30: '30 min', 60: '1h', 120: '2h', 1440: 'Veille' };
  const ch = {
    browser: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Notif',
    email: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg> Email',
    both: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>+<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>'
  };
  if (!r.length) {
    el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>Aucun rappel</div>';
    return;
  }
  el.innerHTML = r.map(x => `<div class="reminder-card"><div class="reminder-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div><div><div class="ri-time">${lbl[x.offset_minutes] || x.offset_minutes + ' min'} avant</div><div class="ri-channel">${ch[x.channel] || x.channel}${x.is_sent ? ' \u00b7 <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> envoy\u00e9' : ''}</div></div><button class="reminder-delete" onclick="fcDeleteReminder('${x.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
}

async function calAddReminder() {
  const offset = parseInt(document.getElementById('calReminderOffset').value);
  const channel = document.getElementById('calReminderChannel').value;
  try {
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
}

async function fcDeleteReminder(remId) {
  try {
    await fetch(`/api/bookings/${calState.fcCurrentEventId}/reminders/${remId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    calState.fcDetailData.reminders = calState.fcDetailData.reminders.filter(r => r.id !== remId);
    fcRenderReminders();
  } catch (e) { gToast('Erreur', 'error'); }
}

// Expose to global scope for onclick handlers
bridge({ calAddReminder, fcDeleteReminder });

export { fcRenderReminders, calAddReminder, fcDeleteReminder };
