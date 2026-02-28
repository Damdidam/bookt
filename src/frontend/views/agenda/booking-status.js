/**
 * Booking Status - status change and purge actions.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';

async function fcSetStatus(newStatus) {
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ status: newStatus })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    gToast('Statut mis \u00e0 jour', 'success');
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

async function fcPurgeBooking() {
  if (!confirm('Supprimer d\u00e9finitivement ce RDV ? Cette action est irr\u00e9versible.')) return;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
    gToast('RDV supprim\u00e9 d\u00e9finitivement', 'success');
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

// Expose to global scope for onclick handlers
bridge({ fcSetStatus, fcPurgeBooking });

export { fcSetStatus, fcPurgeBooking };
