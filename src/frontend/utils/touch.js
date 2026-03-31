/**
 * Touch and mobile detection utilities.
 */

export const fcIsMobile = () => window.innerWidth <= 600;
export const fcIsTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
export const fcIsTablet = () => window.innerWidth <= 1280 && window.innerWidth > 600;

/** No-op — context menu is no longer blocked (users can long-press normally) */
export function initTouchBlockers() {
  // Intentionally empty — removed contextmenu blocker
}
