/**
 * Booking Status - status change and purge actions.
 */
import { api, calState } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { showConfirmDialog } from '../../utils/dirty-guard.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal, fcOpenDetail } from './booking-detail.js';
import { storeUndoAction } from './booking-undo.js';

async function fcSetStatus(newStatus) {
  if (fcSetStatus._busy) return;
  fcSetStatus._busy = true;
  const _stBtns = document.querySelectorAll('.m-st-btn');
  _stBtns.forEach(b => { b.disabled = true; b.classList.add('is-loading'); });
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
      gToast('Statut mis à jour', 'success', { label: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Annuler', fn: () => window.fcUndoLast() }, 8000);
    } else if (newStatus === 'completed') {
      const _bkId=calState.fcCurrentEventId;
      const _clId=calState.fcCurrentBooking?.client_id;
      const _grId=calState.fcCurrentBooking?.group_id;
      gToast('RDV terminé', 'success', [
        { label: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Facturer', fn: () => openInvoiceForBooking(_bkId,_clId,_grId) }
      ], 12000);
    } else {
      gToast('Statut mis à jour', 'success');
    }
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally {
    fcSetStatus._busy = false;
    _stBtns.forEach(b => { b.classList.remove('is-loading'); b.disabled = false; });
  }
}

async function fcPurgeBooking() {
  if (fcPurgeBooking._busy) return;
  if (!(await showConfirmDialog('Supprimer le RDV', 'Supprimer d\u00e9finitivement ce RDV ? Cette action est irr\u00e9versible.', 'Supprimer', 'danger'))) return;
  fcPurgeBooking._busy = true;
  const _prgBtns = document.querySelectorAll('.m-st-btn');
  _prgBtns.forEach(b => { b.disabled = true; b.classList.add('is-loading'); });
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
  finally {
    fcPurgeBooking._busy = false;
    _prgBtns.forEach(b => { b.classList.remove('is-loading'); b.disabled = false; });
  }
}

async function fcWaiveDeposit() {
  if (fcWaiveDeposit._busy) return;
  if (!(await showConfirmDialog('Confirmer sans acompte', 'Confirmer le RDV sans acompte ? Le client recevra un email de confirmation classique (sans mention d\u2019acompte).', 'Confirmer', 'primary'))) return;
  fcWaiveDeposit._busy = true;
  const _depBtns = document.querySelectorAll('.m-st-btn');
  _depBtns.forEach(b => { b.disabled = true; b.classList.add('is-loading'); });
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
  finally {
    fcWaiveDeposit._busy = false;
    _depBtns.forEach(b => { b.classList.remove('is-loading'); b.disabled = false; });
  }
}

async function fcRefundDeposit(amountCents) {
  if (fcRefundDeposit._busy) return;
  const amt = ((amountCents || 0) / 100).toFixed(2);
  if (!(await showConfirmDialog('Rembourser l\u2019acompte', 'Rembourser l\u2019acompte de ' + amt + '\u20ac ? Le RDV sera annul\u00e9.', 'Rembourser', 'danger'))) return;
  fcRefundDeposit._busy = true;
  const _refBtns = document.querySelectorAll('.m-st-btn');
  _refBtns.forEach(b => { b.disabled = true; b.classList.add('is-loading'); });
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
  finally {
    fcRefundDeposit._busy = false;
    _refBtns.forEach(b => { b.classList.remove('is-loading'); b.disabled = false; });
  }
}

async function fcSendDepositRequest(channel) {
  if (fcSendDepositRequest._busy) return;
  fcSendDepositRequest._busy = true;
  const statusEl = document.getElementById('mDepositSendStatus');
  try {
    if (statusEl) { statusEl.style.display = 'block'; statusEl.style.background = 'var(--amber-bg)'; statusEl.style.color = 'var(--amber-dark)'; statusEl.textContent = 'Envoi en cours…'; }
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
      if (calState.fcEditOriginal) { calState.fcEditOriginal.client_email = newEmail; calState.fcEditOriginal.client_phone = newPhone; }
    }
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/send-deposit-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ channels: [channel] })
    });
    if (!r.ok) { let msg = 'Erreur'; try { const d = await r.json(); msg = d.error || msg; } catch {} throw new Error(msg); }
    const data = await r.json();
    gToast(`Demande d'acompte envoyée par ${data.label || channel}`, 'success');
    if (statusEl) { statusEl.style.background = 'var(--green-bg)'; statusEl.style.color = 'var(--green)'; statusEl.textContent = `\u2713 Demande envoyée par ${data.label || channel}`; }
  } catch (e) {
    gToast('Erreur: ' + e.message, 'error');
    if (statusEl) { statusEl.style.background = 'var(--red-bg)'; statusEl.style.color = 'var(--red)'; statusEl.textContent = e.message; }
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

async function openInvoiceForBooking(bookingId,clientId,groupId){
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  document.querySelector('[data-section="invoices"]')?.classList.add('active');
  document.getElementById('pageTitle').textContent='Facturation';
  const mod=await import('../invoices.js');
  mod.openInvoiceModal('invoice',{preselect_client_id:clientId,precheck_booking_id:bookingId,precheck_group_id:groupId});
}

async function fcSendManualReminder(bookingId) {
  const btn = document.getElementById('btnManualReminder');
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
  try {
    const r = await fetch(`/api/bookings/${bookingId}/send-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ channel: 'both' })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    const d = await r.json();
    const parts = [];
    if (d.sms === 'sent') parts.push('SMS');
    if (d.email === 'sent') parts.push('Email');
    gToast(parts.length ? `Rappel envoyé (${parts.join(' + ')})` : 'Rappel envoyé', 'success');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.style.opacity = ''; } }
}

// Expose to global scope for onclick handlers
bridge({ fcSetStatus, fcPurgeBooking, fcWaiveDeposit, fcRefundDeposit, fcSendDepositRequest, fcRequireDeposit, fcSendManualReminder, openInvoiceForBooking });

export { fcSetStatus, fcPurgeBooking, fcWaiveDeposit, fcRefundDeposit, fcSendDepositRequest, fcRequireDeposit, fcSendManualReminder };
