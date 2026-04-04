/**
 * Calendar SSE - Server-Sent Events for real-time calendar updates.
 */
import { api } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { fcRefresh } from './calendar-init.js';
import { IC } from '../../utils/icons.js';

function setupSSE() {
  if (window.fcEventSource) { try { window.fcEventSource.close(); } catch (e) { /* ignore */ } }
  try {
    window.fcEventSource = new EventSource('/api/events/stream?token=' + encodeURIComponent(api.getToken()));
    window.fcEventSource.addEventListener('booking_update', function () {
      fcRefresh();
    });
    window.fcEventSource.addEventListener('waitlist_match', function (ev) {
      try {
        const d = JSON.parse(ev.data);
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
      } catch (e) { /* ignore parse errors */ }
    });
    window.fcEventSource.onerror = function () {
      // If token is expired, stop SSE reconnection loop and redirect to login
      if (!api.isLoggedIn()) {
        window.fcEventSource.close();
        window.location.href = '/login.html?expired=1';
      }
      // Otherwise browser auto-reconnects
    };
  } catch (e) { /* ignore SSE setup errors */ }
}

export { setupSSE };
