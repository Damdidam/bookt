/**
 * Swipe-to-close gesture for mobile modals.
 * Swipe down from header area or drag handle closes the modal.
 */

export function enableSwipeClose(dialogEl, onClose) {
  // Only on touch devices
  if (!('ontouchstart' in window)) return;

  let startY = 0;
  let currentY = 0;
  let swiping = false;

  const onTouchStart = (e) => {
    // Only start swipe from header area or drag handle
    const target = e.target;
    if (!target.closest('.m-header, .m-drag-handle')) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    swiping = true;
    dialogEl.style.transition = 'none';
  };

  const onTouchMove = (e) => {
    if (!swiping) return;
    currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    if (diff > 0) {
      // Only allow downward swipe
      dialogEl.style.transform = `translateY(${diff}px)`;
      dialogEl.style.opacity = Math.max(0.5, 1 - diff / 400);
    }
  };

  const onTouchEnd = () => {
    if (!swiping) return;
    swiping = false;
    const diff = currentY - startY;

    dialogEl.style.transition = 'transform .2s ease, opacity .2s ease';

    if (diff > 100) {
      // Swipe threshold reached — close
      dialogEl.style.transform = 'translateY(100vh)';
      dialogEl.style.opacity = '0';
      setTimeout(() => {
        dialogEl.style.transform = '';
        dialogEl.style.opacity = '';
        dialogEl.style.transition = '';
        if (onClose) onClose();
      }, 200);
    } else {
      // Snap back
      dialogEl.style.transform = '';
      dialogEl.style.opacity = '';
      setTimeout(() => { dialogEl.style.transition = ''; }, 200);
    }
  };

  dialogEl.addEventListener('touchstart', onTouchStart, { passive: true });
  dialogEl.addEventListener('touchmove', onTouchMove, { passive: true });
  dialogEl.addEventListener('touchend', onTouchEnd);

  // Return cleanup function
  return () => {
    dialogEl.removeEventListener('touchstart', onTouchStart);
    dialogEl.removeEventListener('touchmove', onTouchMove);
    dialogEl.removeEventListener('touchend', onTouchEnd);
  };
}
