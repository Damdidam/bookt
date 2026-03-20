/**
 * Sidebar drawer for tablet — slide-in overlay navigation.
 */

const SWIPE_THRESHOLD = 80;
let _sidebar, _overlay;

export function initDrawer() {
  _sidebar = document.querySelector('.sidebar');
  _overlay = document.querySelector('.drawer-overlay');
  if (!_sidebar || !_overlay) return;

  _overlay.addEventListener('click', closeDrawer);

  _sidebar.querySelectorAll('.ni').forEach(el => {
    el.addEventListener('click', () => setTimeout(closeDrawer, 150));
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
}

export function openDrawer() {
  if (!_sidebar || !_overlay) return;
  _sidebar.classList.add('open');
  _overlay.classList.add('open');
}

export function closeDrawer() {
  if (!_sidebar || !_overlay) return;
  _sidebar.classList.remove('open');
  _overlay.classList.remove('open');
  _sidebar.style.transform = '';
}

export function toggleDrawer() {
  if (_sidebar?.classList.contains('open')) closeDrawer();
  else openDrawer();
}
