/**
 * Color Swatches - replaces native color pickers with a curated palette.
 */
import { bridge } from '../../utils/window-bridge.js';

const CSW_PALETTE = ['#1E3A8A','#B91C1C','#059669','#EA580C','#7C3AED','#DB2777','#0EA5A4','#374151'];

function cswHTML(hiddenId, selected, inline) {
  const safeHid = String(hiddenId).replace(/[^a-zA-Z0-9_-]/g, '');
  const safeSelected = /^#[0-9a-fA-F]{3,8}$/.test(selected) ? selected : '#1E3A8A';
  const cls = inline ? 'csw-inline' : 'csw';
  let h = `<div class="${cls}">`;
  CSW_PALETTE.forEach(c => {
    const act = c.toLowerCase() === safeSelected.toLowerCase() ? 'active' : '';
    h += `<span class="csw-dot ${act}" style="background:${c}" data-color="${c}" onclick="cswPick(this,'${safeHid}')"></span>`;
  });
  h += `</div><input type="hidden" id="${safeHid}" value="${safeSelected}">`;
  return h;
}

function cswPick(el, hiddenId) {
  el.closest('.csw,.csw-inline').querySelectorAll('.csw-dot').forEach(d => d.classList.remove('active'));
  el.classList.add('active');
  const inp = document.getElementById(hiddenId);
  if (inp) inp.value = el.dataset.color;
  // Trigger change event for any listeners
  inp?.dispatchEvent(new Event('change'));
}

function cswSelect(hiddenId, color) {
  const inp = document.getElementById(hiddenId);
  if (inp) inp.value = color || '#1E3A8A';
  const wrap = inp?.previousElementSibling;
  if (!wrap) return;
  wrap.querySelectorAll('.csw-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color.toLowerCase() === (color || '#1E3A8A').toLowerCase());
  });
}

// Expose to global scope for onclick handlers
bridge({ cswPick, cswSelect });

export { CSW_PALETTE, cswHTML, cswPick, cswSelect };
