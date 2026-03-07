/**
 * Booking Status - status change and purge actions.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';
import { storeUndoAction } from './booking-undo.js';

async function fcSetStatus(newStatus) {
  if (fcSetStatus._busy) return;
  fcSetStatus._busy = true;
  try {
    const oldStatus = calState.fcCurrentBooking?.status;
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ status: newStatus })
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    // Store undo (only for reversible status changes)
    if (oldStatus && !['completed', 'cancelled', 'no_show'].includes(oldStatus)) {
      storeUndoAction(calState.fcCurrentEventId, 'status', { status: oldStatus });
      gToast('Statut mis \u00e0 jour', 'success', { label: 'Annuler \u21b6', fn: () => window.fcUndoLast() }, 8000);
    } else {
      gToast('Statut mis \u00e0 jour', 'success');
    }
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { fcSetStatus._busy = false; }
}

async function fcPurgeBooking() {
  if (fcPurgeBooking._busy) return;
  if (!confirm('Supprimer d\u00e9finitivement ce RDV ? Cette action est irr\u00e9versible.')) return;
  fcPurgeBooking._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    gToast('RDV supprim\u00e9 d\u00e9finitivement', 'success');
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { fcPurgeBooking._busy = false; }
}

async function fcMarkDepositPaid() {
  if (fcMarkDepositPaid._busy) return;
  if (!confirm('Confirmer le paiement de l\u2019acompte ? Le RDV passera en statut Confirm\u00e9.')) return;
  fcMarkDepositPaid._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ status: 'confirmed' })
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    gToast('Acompte marqu\u00e9 comme pay\u00e9 \u2014 RDV confirm\u00e9', 'success');
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { fcMarkDepositPaid._busy = false; }
}

async function fcRefundDeposit(amountCents) {
  if (fcRefundDeposit._busy) return;
  const amt = ((amountCents || 0) / 100).toFixed(2);
  if (!confirm(`Rembourser l\u2019acompte de ${amt}\u20ac ? Le RDV sera annul\u00e9.`)) return;
  fcRefundDeposit._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/deposit-refund`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    gToast('Acompte rembours\u00e9 \u2014 RDV annul\u00e9', 'success');
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { fcRefundDeposit._busy = false; }
}

// Expose to global scope for onclick handlers
bridge({ fcSetStatus, fcPurgeBooking, fcMarkDepositPaid, fcRefundDeposit });

export { fcSetStatus, fcPurgeBooking, fcMarkDepositPaid, fcRefundDeposit };
