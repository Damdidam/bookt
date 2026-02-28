/**
 * Calendar SSE - Server-Sent Events for real-time calendar updates.
 */
import { api } from '../../state.js';
import { gToast } from '../../utils/dom.js';
import { fcRefresh } from './calendar-init.js';

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
          ? new Date(d.slot_start).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' })
            + ' \u00e0 ' + new Date(d.slot_start).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
          : '';
        if (d.mode === 'manual') {
          gToast(`<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> ${d.matches_count} personne(s) en attente pour le cr\u00e9neau du ${slot} (${d.practitioner_name})`, 'info', { label: 'Voir la liste \u2192', fn: "document.querySelector('[data-section=waitlist]').click()" });
        } else if (d.mode === 'auto') {
          gToast(`<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> Offre auto envoy\u00e9e \u00e0 ${d.offered_to} pour le ${slot}`, 'info', { label: 'Voir \u2192', fn: "document.querySelector('[data-section=waitlist]').click()" });
        } else if (d.mode === 'auto_cascade') {
          gToast(`<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Offre expir\u00e9e de ${d.expired_from} \u2192 relanc\u00e9e \u00e0 ${d.offered_to}`, 'info', { label: 'Voir \u2192', fn: "document.querySelector('[data-section=waitlist]').click()" });
        }
      } catch (e) { /* ignore parse errors */ }
    });
    window.fcEventSource.onerror = function () {
      // Browser auto-reconnects, nothing to do
    };
  } catch (e) { /* ignore SSE setup errors */ }
}

export { setupSSE };
