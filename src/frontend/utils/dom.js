/**
 * DOM utilities used across all views.
 */

/** HTML-escape a string */
export function esc(str) {
  if (str == null || str === '') return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Sanitize an ID for safe use in onclick handler strings — strip all non-safe characters */
export function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Alias */
export const escH = esc;

/** Max visible toasts in the stack */
const MAX_TOASTS = 3;

/** Show a toast notification (multi-toast stack) */
export function gToast(msg, type, action, duration) {
  const stack = document.getElementById('gToastStack');
  if (!stack) return;

  // Create toast element
  const t = document.createElement('div');
  t.className = 'g-toast' + (type ? ' ' + type : '');

  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);

  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', typeof action.fn === 'function' ? action.fn : () => {});
    t.appendChild(btn);
  }

  // Determine auto-dismiss duration
  if (!duration) {
    if (action) duration = 8000;
    else if (type === 'error') duration = 8000;
    else duration = 5000; // info, success, default
  }

  // Add to stack
  stack.appendChild(t);

  // Enforce max visible — remove oldest if exceeding limit
  const toasts = stack.querySelectorAll('.g-toast');
  if (toasts.length > MAX_TOASTS) {
    _dismissToast(toasts[0]);
  }

  // Auto-dismiss timer
  const tm = setTimeout(() => { _dismissToast(t); }, duration);
  t._tm = tm;
}

/** Dismiss a toast with exit animation */
function _dismissToast(el) {
  if (!el || !el.parentNode) return;
  clearTimeout(el._tm);
  el.style.animation = 'toastOut .25s cubic-bezier(.4,0,.2,1) forwards';
  el.addEventListener('animationend', () => { el.remove(); }, { once: true });
  // Fallback removal in case animationend doesn't fire
  setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
}

/** Loading state helper for async button actions */
export async function withLoading(btn, fn) {
  if (!btn || btn.disabled) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    return await fn();
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/** Get the main content area element */
export function getContentArea() {
  return document.getElementById('contentArea');
}
