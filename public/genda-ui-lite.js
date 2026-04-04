/**
 * Genda UI Lite — lightweight toast + confirm dialog for public pages.
 * Replaces native alert() and confirm() with styled alternatives.
 * Auto-injects CSS on load.
 */
(function () {
  // ── CSS injection ──
  var style = document.createElement('style');
  style.textContent = [
    '.g-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);padding:12px 20px;border-radius:10px;font-size:.85rem;line-height:1.4;color:#fff;z-index:100000;opacity:0;transition:opacity .25s,transform .25s;max-width:min(420px,90vw);text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.18);pointer-events:none}',
    '.g-toast.g-show{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}',
    '.g-toast-error{background:#DC2626}',
    '.g-toast-success{background:#16A34A}',
    '.g-toast-info{background:#3D3832}',
    '.g-confirm-ov{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s}',
    '.g-confirm-ov.g-show{opacity:1}',
    '.g-confirm-box{background:#fff;border-radius:14px;padding:28px 24px 20px;max-width:min(380px,90vw);width:100%;box-shadow:0 8px 32px rgba(0,0,0,.2);text-align:center}',
    '.g-confirm-msg{font-size:.92rem;color:#3D3832;line-height:1.5;margin-bottom:20px}',
    '.g-confirm-btns{display:flex;gap:10px;justify-content:center}',
    '.g-confirm-btns button{flex:1;padding:10px 16px;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer;border:none;transition:background .15s,transform .1s}',
    '.g-confirm-btns button:active{transform:scale(.97)}',
    '.g-btn-cancel{background:#F3F4F6;color:#3D3832}',
    '.g-btn-cancel:hover{background:#E5E7EB}',
    '.g-btn-ok{background:#DC2626;color:#fff}',
    '.g-btn-ok:hover{background:#B91C1C}',
    '.g-btn-ok.g-btn-primary{background:var(--primary,#2563EB);color:#fff}',
    '.g-btn-ok.g-btn-primary:hover{background:var(--primary-dark,#1D4ED8)}'
  ].join('\n');
  document.head.appendChild(style);

  // ── Toast ──
  window.showToast = function (msg, type) {
    var cls = 'g-toast ';
    if (type === 'error') cls += 'g-toast-error';
    else if (type === 'success') cls += 'g-toast-success';
    else cls += 'g-toast-info';
    var el = document.createElement('div');
    el.className = cls;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('g-show'); });
    });
    setTimeout(function () {
      el.classList.remove('g-show');
      setTimeout(function () { el.remove(); }, 300);
    }, 4000);
  };

  // ── Confirm dialog (returns Promise<boolean>) ──
  window.showConfirm = function (msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'g-confirm-ov';
      var okLabel = opts.okLabel || 'Confirmer';
      var cancelLabel = opts.cancelLabel || 'Annuler';
      var okClass = opts.destructive === false ? 'g-btn-ok g-btn-primary' : 'g-btn-ok';
      ov.innerHTML = '<div class="g-confirm-box">' +
        '<div class="g-confirm-msg">' + msg + '</div>' +
        '<div class="g-confirm-btns">' +
        '<button class="g-btn-cancel">' + cancelLabel + '</button>' +
        '<button class="' + okClass + '">' + okLabel + '</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { ov.classList.add('g-show'); });
      });
      function close(val) {
        ov.classList.remove('g-show');
        setTimeout(function () { ov.remove(); }, 200);
        resolve(val);
      }
      ov.querySelector('.g-btn-cancel').onclick = function () { close(false); };
      ov.querySelector('.g-btn-ok').onclick = function () { close(true); };
      // Escape key closes dialog
      function onKey(e) { if (e.key === 'Escape') close(false); }
      document.addEventListener('keydown', onKey);
      // Focus the cancel button for keyboard accessibility
      ov.querySelector('.g-btn-cancel').focus();
      // Cleanup listener on close
      var _origClose = close;
      close = function (val) { document.removeEventListener('keydown', onKey); _origClose(val); };
    });
  };
})();
