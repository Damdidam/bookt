/**
 * DOM utilities used across all views.
 */

/** HTML-escape a string */
export function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Alias */
export const escH = esc;

/** Show a toast notification */
export function gToast(msg, type, action) {
  const t = document.getElementById('gToast');
  t.innerHTML = msg + (action ? `<button onclick="${action.fn}">${action.label}</button>` : '');
  t.style.display = 'flex';
  t.className = 'g-toast' + (type ? ' ' + type : '');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => { t.style.display = 'none'; }, action ? 6000 : 3500);
}

/** Get the main content area element */
export function getContentArea() {
  return document.getElementById('contentArea');
}
