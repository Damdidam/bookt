/**
 * Touch and mobile detection utilities.
 */

export const fcIsMobile = () => window.innerWidth <= 600;
export const fcIsTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
export const fcIsTablet = () => window.innerWidth <= 1024 && window.innerWidth > 600;

/** Block browser context menu everywhere except form inputs */
export function initTouchBlockers() {
  document.addEventListener('contextmenu', function(e) {
    if (e.target.closest('input,textarea,select,[contenteditable]')) return;
    e.preventDefault();
  }, true);
}
