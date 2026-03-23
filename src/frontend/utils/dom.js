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

  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  for (const act of actions) {
    const btn = document.createElement('button');
    btn.textContent = act.label;
    btn.addEventListener('click', () => {
      if (typeof act.fn === 'function') act.fn();
      if (act.dismiss !== false) _dismissToast(t);
    });
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

/**
 * Initialize simple digit-based time inputs (replaces Android clock picker).
 * Call once on page load — auto-formats HH:MM as user types.
 * Works on any input with class "m-time".
 */
export function initTimeInputs(root = document) {
  root.querySelectorAll('input.m-time').forEach(el => {
    if (el._timeInit) return;
    el._timeInit = true;
    el.setAttribute('inputmode', 'numeric');
    el.setAttribute('placeholder', 'HH:MM');
    el.setAttribute('maxlength', '5');
    el.setAttribute('autocomplete', 'off');

    el.addEventListener('input', () => {
      let v = el.value.replace(/[^0-9]/g, '');
      if (v.length > 4) v = v.slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
      el.value = v;
    });

    el.addEventListener('blur', () => {
      const v = el.value.replace(/[^0-9]/g, '');
      if (v.length === 0) { el.value = ''; return; }
      const h = Math.min(23, parseInt(v.slice(0, 2) || '0', 10));
      const m = Math.min(59, parseInt(v.slice(2, 4) || '0', 10));
      el.value = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
