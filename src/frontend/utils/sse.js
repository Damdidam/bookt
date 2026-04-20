/**
 * Global Server-Sent Events manager.
 *
 * Listens to /api/events/stream once and dispatches DOM CustomEvents on window
 * so any view (calendar, home, clients, waitlist, etc.) can subscribe via
 * `window.addEventListener('genda:booking_update', handler)` without each view
 * opening its own EventSource.
 *
 * Usage :
 *   import { initSSE } from './utils/sse.js';   // at app boot
 *   initSSE();
 *
 *   window.addEventListener('genda:booking_update', () => { reloadMyView(); });
 *   window.addEventListener('genda:waitlist_match', (ev) => { console.log(ev.detail); });
 */
import { api } from '../state.js';

let _started = false;

function _dispatch(name, detail) {
  try { window.dispatchEvent(new CustomEvent('genda:' + name, { detail })); } catch (_) {}
}

export function initSSE() {
  if (_started) return;
  if (!api.isLoggedIn()) return;
  _started = true;
  if (window.fcEventSource) { try { window.fcEventSource.close(); } catch (_) {} }
  try {
    window.fcEventSource = new EventSource('/api/events/stream?token=' + encodeURIComponent(api.getToken()));
    let _hadError = false;
    window.fcEventSource.addEventListener('open', function () {
      if (_hadError) { _hadError = false; _dispatch('reconnect', {}); }
    });
    window.fcEventSource.addEventListener('booking_update', function (ev) {
      let detail = {};
      try { detail = ev.data ? JSON.parse(ev.data) : {}; } catch (_) {}
      _dispatch('booking_update', detail);
    });
    window.fcEventSource.addEventListener('waitlist_match', function (ev) {
      let detail = {};
      try { detail = ev.data ? JSON.parse(ev.data) : {}; } catch (_) {}
      _dispatch('waitlist_match', detail);
    });
    window.fcEventSource.onerror = function () {
      _hadError = true;
      if (!api.isLoggedIn()) {
        try { window.fcEventSource.close(); } catch (_) {}
        window.location.href = '/login.html?expired=1';
      }
    };
  } catch (_) { /* ignore */ }
}
