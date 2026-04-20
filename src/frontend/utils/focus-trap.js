/**
 * Focus trap for modals — traps Tab/Shift+Tab within the modal
 * and handles Escape key to close.
 *
 * Stack-based: supports nested modals (dialog inside dialog). Each trap
 * pushes onto a LIFO stack; releaseFocus() pops the top. Focus is restored
 * to whatever was active when the top trap was installed.
 */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// LIFO stack of active traps. Each entry: { modalEl, handler, previousFocus, closeFn }
const _stack = [];

export function trapFocus(modalEl, onClose) {
  if (!modalEl) return;

  // If the same element is already trapped, refresh instead of stacking.
  for (let i = _stack.length - 1; i >= 0; i--) {
    if (_stack[i].modalEl === modalEl) {
      _stack[i].closeFn = onClose;
      return;
    }
  }

  const previousFocus = document.activeElement;

  const handler = (e) => {
    // Only the top-most trap handles keys (ignore events that bubble through nested modals).
    if (_stack.length === 0 || _stack[_stack.length - 1].modalEl !== modalEl) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (onClose) onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = [...modalEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  modalEl.addEventListener('keydown', handler);
  _stack.push({ modalEl, handler, previousFocus, closeFn: onClose });

  // Auto-focus first focusable element (don't override existing focus inside the modal).
  requestAnimationFrame(() => {
    if (modalEl.contains(document.activeElement) && document.activeElement !== modalEl) return;
    const focusable = [...modalEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (focusable.length) focusable[0].focus();
  });
}

export function releaseFocus(modalEl) {
  if (_stack.length === 0) return;

  // If a specific element is passed, release that trap (may be in the middle of the stack).
  // If no element, release the top (legacy behavior).
  let idx = _stack.length - 1;
  if (modalEl) {
    idx = _stack.findIndex(entry => entry.modalEl === modalEl);
    if (idx === -1) return;
  }

  const entry = _stack[idx];
  _stack.splice(idx, 1);
  try { entry.modalEl.removeEventListener('keydown', entry.handler); } catch (_) {}

  // Only restore previous focus if we released the top entry (else focus stays on the new top).
  const isTopRelease = idx === _stack.length; // after splice, if idx === length it was top
  if (isTopRelease && entry.previousFocus && typeof entry.previousFocus.focus === 'function') {
    try { entry.previousFocus.focus(); } catch (_) {}
  }
}
