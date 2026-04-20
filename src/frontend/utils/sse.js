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
let _consecutiveErrors = 0;

function _dispatch(name, detail) {
  try { window.dispatchEvent(new CustomEvent('genda:' + name, { detail })); } catch (_) {}
}

// K#7 fix: if the JWT has expired mid-session, EventSource retries the same
// stale URL every ~3s and we'd never notice — the dashboard appears fine while
// silently missing every SSE event. When the token is rejected, requireAuth
// replies 401 before the SSE handshake, so EventSource fires `onerror` without
// ever reaching the `open` state. After a few consecutive errors with no
// reconnect, we validate the token against /api/auth/me; on 401 we close the
// stream, clear the cached token, and redirect to /login.
async function _checkTokenExpired() {
  try {
    const r = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    return r.status === 401;
  } catch (_) { return false; }
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
      _consecutiveErrors = 0;
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
    window.fcEventSource.onerror = async function () {
      _hadError = true;
      _consecutiveErrors++;
      if (!api.isLoggedIn()) {
        try { window.fcEventSource.close(); } catch (_) {}
        window.location.href = '/login.html?expired=1';
        return;
      }
      // After 3 errors in a row (~9s of retries failing) validate the token.
      if (_consecutiveErrors === 3) {
        const expired = await _checkTokenExpired();
        if (expired) {
          try { window.fcEventSource.close(); } catch (_) {}
          try { api.clearToken && api.clearToken(); } catch (_) {}
          try { localStorage.removeItem('token'); } catch (_) {}
          window.location.href = '/login.html?expired=1';
        }
      }
    };
  } catch (_) { /* ignore */ }
}
