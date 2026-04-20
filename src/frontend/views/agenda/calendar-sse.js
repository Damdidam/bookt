/**
 * Calendar SSE — listens to global SSE events (emitted by utils/sse.js).
 * Doesn't open its own EventSource anymore; the global SSE initialised at app
 * boot broadcasts DOM events on window that we subscribe to here.
 */
import { gToast } from '../../utils/dom.js';
import { fcRefresh } from './calendar-init.js';
import { initSSE } from '../../utils/sse.js';

// Debounce fcRefresh so a burst of booking_update events triggers one refetch
let _fcRefreshTimer = null;
function _fcRefreshDebounced() {
  if (_fcRefreshTimer) clearTimeout(_fcRefreshTimer);
  _fcRefreshTimer = setTimeout(() => { _fcRefreshTimer = null; fcRefresh(); }, 250);
}

let _listenersWired = false;
function setupSSE() {
  initSSE(); // idempotent — ensures global SSE is active
  if (_listenersWired) return;
  _listenersWired = true;
  window.addEventListener('genda:reconnect', _fcRefreshDebounced);
  window.addEventListener('genda:booking_update', _fcRefreshDebounced);
  window.addEventListener('genda:waitlist_match', (ev) => {
    try {
      const d = ev.detail || {};
      const slot = d.slot_start
        ? new Date(d.slot_start).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })
          + ' \u00e0 ' + new Date(d.slot_start).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })
        : '';
      const goWaitlist = () => { const el = document.querySelector('[data-section=waitlist]'); if (el) el.click(); };
      if (d.mode === 'manual') {
        gToast(`${d.matches_count} personne(s) en attente pour le créneau du ${slot} (${d.practitioner_name})`, 'info', { label: 'Voir la liste \u2192', fn: goWaitlist });
      } else if (d.mode === 'auto') {
        gToast(`Offre auto envoyée à ${d.offered_to} pour le ${slot}`, 'info', { label: 'Voir \u2192', fn: goWaitlist });
      } else if (d.mode === 'auto_cascade') {
        gToast(`Offre expirée de ${d.expired_from} \u2192 relancée à ${d.offered_to}`, 'info', { label: 'Voir \u2192', fn: goWaitlist });
      }
    } catch (_) {}
  });
}

export { setupSSE };
