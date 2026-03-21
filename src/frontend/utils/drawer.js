/**
 * Sidebar drawer (tablet) + sidebar toggle (desktop).
 * Tablet (≤1280px): overlay drawer that slides over content.
 * Desktop (>1280px): sidebar slides out, content expands to full width.
 */

const SWIPE_THRESHOLD = 80;
const DESKTOP_BREAKPOINT = 1280;
let _sidebar, _overlay;

function _isDesktop() {
  return window.innerWidth > DESKTOP_BREAKPOINT;
}

export function initDrawer() {
  _sidebar = document.querySelector('.sidebar');
  _overlay = document.querySelector('.drawer-overlay');
  if (!_sidebar || !_overlay) return;

  _overlay.addEventListener('click', closeDrawer);

  _sidebar.querySelectorAll('.ni').forEach(el => {
    el.addEventListener('click', () => {
      // On tablet, close drawer after nav. On desktop, keep sidebar visible.
      if (!_isDesktop()) setTimeout(closeDrawer, 150);
    });
  });

  let startX = 0, currentX = 0, swiping = false;
  _sidebar.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    currentX = startX;
    swiping = true;
    _sidebar.style.transition = 'none';
  }, { passive: true });

  _sidebar.addEventListener('touchmove', e => {
    if (!swiping) return;
    currentX = e.touches[0].clientX;
    const diff = currentX - startX;
    if (diff < 0) _sidebar.style.transform = `translateX(${diff}px)`;
  }, { passive: true });

  _sidebar.addEventListener('touchend', () => {
    if (!swiping) return;
    swiping = false;
    _sidebar.style.transition = '';
    if (startX - currentX > SWIPE_THRESHOLD) closeDrawer();
    else _sidebar.style.transform = '';
  });

  window.addEventListener('orientationchange', closeDrawer);

  // Restore desktop sidebar state from localStorage
  if (_isDesktop() && localStorage.getItem('sidebar_hidden') === '1') {
    _sidebar.classList.add('hidden');
  }
}

export function openDrawer() {
  if (!_sidebar || !_overlay) return;
  if (_isDesktop()) {
    _sidebar.classList.remove('hidden');
    localStorage.setItem('sidebar_hidden', '0');
  } else {
    _sidebar.classList.add('open');
    _overlay.classList.add('open');
  }
}

export function closeDrawer() {
  if (!_sidebar || !_overlay) return;
  if (_isDesktop()) {
    _sidebar.classList.add('hidden');
    localStorage.setItem('sidebar_hidden', '1');
  } else {
    _sidebar.classList.remove('open');
    _overlay.classList.remove('open');
    _sidebar.style.transform = '';
  }
}

export function toggleDrawer() {
  if (_isDesktop()) {
    if (_sidebar?.classList.contains('hidden')) openDrawer();
    else closeDrawer();
  } else {
    if (_sidebar?.classList.contains('open')) closeDrawer();
    else openDrawer();
  }
}
