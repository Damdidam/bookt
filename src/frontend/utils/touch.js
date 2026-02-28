/**
 * Touch and mobile detection utilities.
 */

export const fcIsMobile = () => window.innerWidth <= 768;
export const fcIsTablet = () => window.innerWidth > 768 && window.innerWidth <= 1180 && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
export const fcIsTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/** Block Chrome tablet context menu on interactive areas */
export function initTouchBlockers() {
  if (fcIsTouch) {
    document.addEventListener('contextmenu', function(e) {
      if (e.target.closest('input,textarea,select,[contenteditable]')) return;
      if (e.target.closest('.fc,.sidebar,.agenda-toolbar,.prac-filters,.mob-list,.bk-row,.card-h,.topbar,.mob-bk,.m-chip,.btn,.btn-outline')) e.preventDefault();
    }, true);
  }
}
