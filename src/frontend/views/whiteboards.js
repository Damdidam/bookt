/**
 * Whiteboard integration helpers.
 * Used from clients detail and booking detail views.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

async function openWhiteboard(bookingId, clientId) {
  try {
    const r = await fetch('/api/whiteboards?booking_id=' + bookingId, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const d = await r.json();
    if (d.whiteboards && d.whiteboards.length > 0) {
      window.open('/whiteboard/' + d.whiteboards[0].id, '_blank');
      return;
    }
    const cr = await fetch('/api/whiteboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ booking_id: bookingId, client_id: clientId, consent_confirmed: true, title: 'Whiteboard' })
    });
    if (!cr.ok) { const e = await cr.json(); throw new Error(e.error || 'Erreur'); }
    const cd = await cr.json();
    window.open('/whiteboard/' + cd.whiteboard.id, '_blank');
  } catch (e) { GendaUI.toast('Erreur whiteboard: ' + e.message, 'error'); }
}

async function openWhiteboardForClient(clientId) {
  try {
    const cr = await fetch('/api/whiteboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ client_id: clientId, consent_confirmed: true, title: 'Whiteboard' })
    });
    if (!cr.ok) { const e = await cr.json(); throw new Error(e.error || 'Erreur'); }
    const cd = await cr.json();
    window.open('/whiteboard/' + cd.whiteboard.id, '_blank');
  } catch (e) { GendaUI.toast('Erreur whiteboard: ' + e.message, 'error'); }
}

async function loadClientWhiteboards(clientId) {
  try {
    const r = await fetch('/api/whiteboards?client_id=' + clientId, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const d = await r.json();
    return d.whiteboards || [];
  } catch (e) { return []; }
}

bridge({ openWhiteboard, openWhiteboardForClient, loadClientWhiteboards });

export { openWhiteboard, openWhiteboardForClient, loadClientWhiteboards };
