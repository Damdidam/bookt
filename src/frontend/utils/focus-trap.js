/**
 * Focus trap for modals — traps Tab/Shift+Tab within the modal
 * and handles Escape key to close.
 */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let _previousFocus = null;
let _trapEl = null;
let _handler = null;
let _closeFn = null;

export function trapFocus(modalEl, onClose) {
  _previousFocus = document.activeElement;
  _trapEl = modalEl;
  _closeFn = onClose;

  _handler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (_closeFn) _closeFn();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = [..._trapEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
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

  modalEl.addEventListener('keydown', _handler);

  // Auto-focus first focusable element
  requestAnimationFrame(() => {
    const focusable = [..._trapEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (focusable.length) focusable[0].focus();
  });
}

export function releaseFocus() {
  if (_trapEl && _handler) {
    _trapEl.removeEventListener('keydown', _handler);
  }
  if (_previousFocus && _previousFocus.focus) {
    _previousFocus.focus();
  }
  _trapEl = null;
  _handler = null;
  _closeFn = null;
  _previousFocus = null;
}
