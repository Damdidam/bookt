/**
 * Booking Undo - manages undo state for calendar actions.
 * Stores the last undoable action and provides fcUndoLast() for the toast button.
 */
import { api } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';

// ── Undo state ──
let lastAction = null; // { bookingId, type, oldData, timer }

/**
 * Store an undoable action. Overwrites any previous pending undo.
 * @param {string} bookingId
 * @param {'move'|'resize'|'status'|'modify'} type
 * @param {object} oldData - data needed to revert (depends on type)
 */
export function storeUndoAction(bookingId, type, oldData) {
  // Clear previous timer
  if (lastAction?.timer) clearTimeout(lastAction.timer);
  // Auto-expire after 8s
  const timer = setTimeout(() => { lastAction = null; }, 8000);
  lastAction = { bookingId, type, oldData, timer };
}

/**
 * Clear undo state (e.g. after successful undo or new unrelated action).
 */
export function clearUndo() {
  if (lastAction?.timer) clearTimeout(lastAction.timer);
  lastAction = null;
}

/**
 * Execute undo — called from toast button onclick.
 * Calls the appropriate API endpoint with old data.
 */
async function fcUndoLast() {
  if (!lastAction) { gToast('Rien à annuler'); return; }
  const { bookingId, type, oldData } = lastAction;
  clearUndo();
  // Hide the current toast immediately
  document.getElementById('gToastStack').textContent = '';

  try {
    let r;
    switch (type) {
      case 'move':
        r = await fetch(`/api/bookings/${bookingId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({
            start_at: oldData.start_at,
            end_at: oldData.end_at,
            practitioner_id: oldData.practitioner_id
          })
        });
        break;
      case 'resize':
        r = await fetch(`/api/bookings/${bookingId}/resize`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ end_at: oldData.end_at })
        });
        break;
      case 'status':
        r = await fetch(`/api/bookings/${bookingId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ status: oldData.status })
        });
        break;
      case 'modify':
        r = await fetch(`/api/bookings/${bookingId}/modify`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({
            start_at: oldData.start_at,
            end_at: oldData.end_at,
            notify: false,
            notify_channel: null
          })
        });
        break;
      default:
        gToast('Action non annulable', 'error');
        return;
    }
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    gToast('Action annulée', 'success');
    fcRefresh();
  } catch (e) {
    gToast('Erreur annulation: ' + e.message, 'error');
  }
}

// Expose to global scope for toast button onclick
bridge({ fcUndoLast });

export { fcUndoLast };
