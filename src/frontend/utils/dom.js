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

/** Sanitize rich-text HTML: keep only safe formatting tags, strip everything else */
export function sanitizeRichText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // Remove all script/style/iframe/object/embed/form elements
  tmp.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach(el => el.remove());
  // Remove event handler attributes and dangerous attrs from all elements
  tmp.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      if (n.startsWith('on') || n === 'src' || n === 'href' || n === 'action' || n === 'formaction' || n === 'xlink:href' || n === 'data') {
        el.removeAttribute(attr.name);
      }
    }
  });
  return tmp.innerHTML;
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

  // Top row: message + dismiss X
  const topRow = document.createElement('div');
  topRow.className = 'g-toast-top';
  const span = document.createElement('span');
  span.textContent = msg;
  topRow.appendChild(span);
  const xBtn = document.createElement('button');
  xBtn.className = 'dismiss';
  xBtn.innerHTML = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  xBtn.addEventListener('click', () => _dismissToast(t));
  topRow.appendChild(xBtn);
  t.appendChild(topRow);

  // Action buttons row (below message)
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  if (actions.length > 0) {
    const actRow = document.createElement('div');
    actRow.className = 'g-toast-actions';
    for (const act of actions) {
      const btn = document.createElement('button');
      btn.innerHTML = act.label;
      btn.addEventListener('click', () => {
        if (typeof act.fn === 'function') act.fn();
        if (act.dismiss !== false) _dismissToast(t);
      });
      actRow.appendChild(btn);
    }
    t.appendChild(actRow);
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
