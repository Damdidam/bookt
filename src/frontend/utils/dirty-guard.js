/**
 * Dirty-state guard for modals — warns before closing if unsaved changes exist.
 * Usage:
 *   import { guardModal } from './utils/dirty-guard.js';
 *   const guard = guardModal(overlayEl, { exclude: ['#calIntNote'] });
 *   // After save: guard.markClean();
 *   // On destroy: guard.destroy();
 */

import { bridge } from './window-bridge.js';

const activeGuards = new Set();

// ── beforeunload protection ──
window.addEventListener('beforeunload', e => {
  for (const g of activeGuards) {
    if (g.isDirty()) { e.preventDefault(); return; }
  }
});

// ── Generic confirmation dialog (replaces window.confirm) ──
export function showConfirmDialog(title, message, confirmLabel = 'Confirmer', confirmStyle = 'primary') {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'dg-overlay';
    const btnColor = confirmStyle === 'danger' ? '#DC2626' : 'var(--primary)';
    el.innerHTML = `<div class="dg-card">
      <p class="dg-msg" style="font-weight:600;margin-bottom:6px">${title}</p>
      ${message ? `<p class="dg-msg">${message}</p>` : ''}
      <div class="dg-actions">
        <button class="dg-btn dg-cancel" style="background:var(--bg);color:var(--text)">Annuler</button>
        <button class="dg-btn dg-confirm" style="background:${btnColor};color:#fff">${confirmLabel}</button>
      </div>
    </div>`;
    el.querySelector('.dg-cancel').onclick = () => { el.remove(); resolve(false); };
    el.querySelector('.dg-confirm').onclick = () => { el.remove(); resolve(true); };
    const parent = document.querySelector('.m-overlay.open .m-dialog') || document.body;
    parent.appendChild(el);
  });
}

// ── Custom confirmation prompt (not window.confirm) ──
export function showDirtyPrompt(dialogEl) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'dg-overlay';
    el.innerHTML = `<div class="dg-card">
      <p class="dg-msg">Modifications non sauvegardées</p>
      <div class="dg-actions">
        <button class="dg-btn dg-stay">Rester</button>
        <button class="dg-btn dg-leave">Quitter</button>
      </div>
    </div>`;
    el.querySelector('.dg-stay').onclick = () => { el.remove(); resolve(false); };
    el.querySelector('.dg-leave').onclick = () => { el.remove(); resolve(true); };
    dialogEl.appendChild(el);
  });
}

// ── Guard-aware close for dynamic modals (.remove()) ──
export async function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el._dirtyGuard?.isDirty()) {
    const leave = await showDirtyPrompt(el.querySelector('.m-dialog') || el);
    if (!leave) return;
  }
  el._dirtyGuard?.destroy();
  el.remove();
  if (!document.querySelector('.m-overlay.open')) document.body.classList.remove('has-modal');
}

// ── Attach guard to a modal ──
export function guardModal(overlayEl, opts = {}) {
  // Cleanup previous guard if any
  overlayEl._dirtyGuard?.destroy();

  let _dirty = false;
  const handler = e => {
    if (opts.exclude?.some(sel => e.target.closest(sel))) return;
    _dirty = true;
  };
  overlayEl.addEventListener('input', handler, true);
  overlayEl.addEventListener('change', handler, true);

  // Backdrop click → close via guard (only for dynamic modals that use .remove())
  // Static modals (calDetailModal, calCreateModal) must NOT use this — they toggle .open class
  let _backdrop = null;
  if (!opts.noBackdropClose) {
    _backdrop = function (e) { if (e.target === overlayEl) closeModal(overlayEl.id); };
    overlayEl.addEventListener('click', _backdrop);
  }

  const guard = {
    markClean: () => { _dirty = false; },
    isDirty: () => _dirty,
    destroy: () => {
      overlayEl.removeEventListener('input', handler, true);
      overlayEl.removeEventListener('change', handler, true);
      if (_backdrop) overlayEl.removeEventListener('click', _backdrop);
      activeGuards.delete(guard);
      overlayEl._dirtyGuard = null;
    }
  };
  overlayEl._dirtyGuard = guard;
  activeGuards.add(guard);
  return guard;
}

// Bridge for inline onclick handlers
bridge({ closeModal, showConfirmDialog });
