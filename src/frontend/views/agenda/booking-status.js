/**
 * Booking Status - status change and purge actions.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal, fcOpenDetail } from './booking-detail.js';
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
    const result = await r.json().catch(() => ({}));
    // Deposit-aware restore: show specific toast
    if (result.deposit_restore === 'redeposit') {
      gToast('RDV rétabli — nouvel acompte demandé au client', 'success');
    } else if (result.deposit_restore === 'repaid') {
      gToast('RDV rétabli — acompte retenu, RDV confirmé', 'success');
    } else if (oldStatus && !['completed', 'cancelled', 'no_show'].includes(oldStatus)) {
      // Store undo (only for reversible status changes)
      storeUndoAction(calState.fcCurrentEventId, 'status', { status: oldStatus });
      gToast('Statut mis à jour', 'success', { label: 'Annuler ↶', fn: () => window.fcUndoLast() }, 8000);
    } else {
      gToast('Statut mis à jour', 'success');
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

async function fcWaiveDeposit() {
  if (fcWaiveDeposit._busy) return;
  if (!confirm('Confirmer le RDV sans acompte ? Le client recevra un email de confirmation classique (sans mention d\u2019acompte).')) return;
  fcWaiveDeposit._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/waive-deposit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    gToast('RDV confirm\u00e9 sans acompte', 'success');
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { fcWaiveDeposit._busy = false; }
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

async function fcSendDepositRequest(channel) {
  if (fcSendDepositRequest._busy) return;
  fcSendDepositRequest._busy = true;
  const statusEl = document.getElementById('mDepositSendStatus');
  try {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.style.background = '#FEF3E2'; statusEl.style.color = '#B45309'; statusEl.textContent = 'Envoi en cours…'; }
    // Auto-save client contact if edited, so deposit goes to the new email/phone
    const newEmail = document.getElementById('uClientEmail')?.value.trim() || '';
    const newPhone = document.getElementById('uClientPhone')?.value.trim() || '';
    const orig = calState.fcEditOriginal || {};
    const contactChanged = newEmail !== (orig.client_email || '') || newPhone !== (orig.client_phone || '');
    if (contactChanged && calState.fcCurrentBooking?.client_id) {
      const cr = await fetch(`/api/clients/${calState.fcCurrentBooking.client_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ phone: newPhone || null, email: newEmail || null })
      });
      if (!cr.ok) { const d = await cr.json().catch(() => ({})); throw new Error(d.error || 'Erreur sauvegarde contact'); }
      // Update original so subsequent saves don't re-patch
      if (calState.fcEditOriginal) { calState.fcEditOriginal.client_email = newEmail; calState.fcEditOriginal.client_phone = newPhone; }
    }
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/send-deposit-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ channel })
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    const label = channel === 'sms' ? 'SMS' : 'email';
    gToast(`Demande d'acompte envoyée par ${label}`, 'success');
    if (statusEl) { statusEl.style.background = '#F0FDF4'; statusEl.style.color = '#15803D'; statusEl.textContent = `✓ Demande envoyée par ${label}`; }
  } catch (e) {
    gToast('Erreur: ' + e.message, 'error');
    if (statusEl) { statusEl.style.background = '#FEF2F2'; statusEl.style.color = '#DC2626'; statusEl.textContent = e.message; }
  } finally { fcSendDepositRequest._busy = false; }
}

async function fcRequireDeposit() {
  if (fcRequireDeposit._busy) return;
  const amountInput = document.getElementById('mReqDepAmount');
  const deadlineInput = document.getElementById('mReqDepDeadline');
  const amountCents = Math.round(parseFloat(amountInput?.value || 0) * 100);
  const deadlineHours = parseInt(deadlineInput?.value || 48);
  if (!amountCents || amountCents <= 0) { gToast('Montant invalide', 'error'); return; }
  if (!confirm(`Exiger un acompte de ${(amountCents / 100).toFixed(2)}\u20ac ? Le client devra payer avant le RDV.`)) return;
  fcRequireDeposit._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/require-deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ amount_cents: amountCents, deadline_hours: deadlineHours })
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    const result = await r.json();
    if (result.email_sent) {
      gToast('Acompte exigé — demande envoyée par email', 'success');
    } else {
      gToast('Acompte exigé — ajoutez un email au client pour envoyer la demande', 'warning');
    }
    // Refresh the detail modal to show the deposit banner
    fcOpenDetail(calState.fcCurrentEventId);
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { fcRequireDeposit._busy = false; }
}

// Expose to global scope for onclick handlers
bridge({ fcSetStatus, fcPurgeBooking, fcWaiveDeposit, fcRefundDeposit, fcSendDepositRequest, fcRequireDeposit });

export { fcSetStatus, fcPurgeBooking, fcWaiveDeposit, fcRefundDeposit, fcSendDepositRequest, fcRequireDeposit };
