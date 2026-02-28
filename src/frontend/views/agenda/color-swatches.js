/**
 * Color Swatches - replaces native color pickers with a curated palette.
 */
import { bridge } from '../../utils/window-bridge.js';

const CSW_PALETTE = ['#0D7377','#2196F3','#3F51B5','#9C27B0','#E91E63','#F44336','#FF9800','#FFB300','#4CAF50','#00BCD4','#795548','#607D8B'];

function cswHTML(hiddenId, selected, inline) {
  const cls = inline ? 'csw-inline' : 'csw';
  let h = `<div class="${cls}">`;
  CSW_PALETTE.forEach(c => {
    const act = c.toLowerCase() === ((selected || '#0D7377').toLowerCase()) ? 'active' : '';
    h += `<span class="csw-dot ${act}" style="background:${c}" data-color="${c}" onclick="cswPick(this,'${hiddenId}')"></span>`;
  });
  h += `</div><input type="hidden" id="${hiddenId}" value="${selected || '#0D7377'}">`;
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
  if (inp) inp.value = color || '#0D7377';
  const wrap = inp?.previousElementSibling;
  if (!wrap) return;
  wrap.querySelectorAll('.csw-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.color.toLowerCase() === (color || '#0D7377').toLowerCase());
  });
}

// Expose to global scope for onclick handlers
bridge({ cswPick, cswSelect });

export { CSW_PALETTE, cswHTML, cswPick, cswSelect };
