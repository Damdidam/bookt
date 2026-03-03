/**
 * DOM utilities used across all views.
 */

/** HTML-escape a string */
export function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Sanitize an ID for safe use in onclick handler strings — strip all non-safe characters */
export function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Alias */
export const escH = esc;

/** Show a toast notification */
export function gToast(msg, type, action, duration) {
  const t = document.getElementById('gToast');
  t.textContent = '';

  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);

  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', typeof action.fn === 'function' ? action.fn : () => {});
    t.appendChild(btn);
  }

  t.style.display = 'flex';
  t.className = 'g-toast' + (type ? ' ' + type : '');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.style.display = 'none'; }, duration || (action ? 6000 : 3500));
}

/** Get the main content area element */
export function getContentArea() {
  return document.getElementById('contentArea');
}
