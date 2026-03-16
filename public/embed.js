/**
 * GENDA Booking Widget
 * Usage: <script src="https://genda.be/embed.js" data-slug="my-business"></script>
 * Options (data attributes):
 *   data-slug: business slug (required)
 *   data-color: button color (default: #E8694A)
 *   data-text: button text (default: Réserver)
 *   data-position: bottom-right, bottom-left (default: bottom-right)
 */
(function() {
  'use strict';
  var script = document.currentScript;
  if (!script) return;

  var slug = script.getAttribute('data-slug');
  if (!slug) { console.warn('GENDA widget: data-slug is required'); return; }

  var color = script.getAttribute('data-color') || '#E8694A';
  var text = script.getAttribute('data-text') || 'Réserver';
  var position = script.getAttribute('data-position') || 'bottom-right';
  var baseUrl = script.src.replace(/\/embed\.js.*$/, '');

  // Inject styles
  var style = document.createElement('style');
  style.textContent = [
    '.genda-widget-btn{position:fixed;z-index:99999;display:flex;align-items:center;gap:8px;padding:14px 28px;border:none;border-radius:100px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;font-weight:600;color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.2);transition:all .3s;animation:genda-bounce .5s ease}',
    position === 'bottom-left'
      ? '.genda-widget-btn{bottom:24px;left:24px}'
      : '.genda-widget-btn{bottom:24px;right:24px}',
    '.genda-widget-btn:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.25)}',
    '.genda-widget-btn svg{flex-shrink:0}',
    '.genda-widget-overlay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .3s}',
    '.genda-widget-overlay.active{opacity:1;pointer-events:all}',
    '.genda-widget-modal{background:#fff;border-radius:16px;width:90vw;max-width:480px;height:85vh;max-height:700px;overflow:hidden;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3);transform:translateY(20px);transition:transform .3s}',
    '.genda-widget-overlay.active .genda-widget-modal{transform:translateY(0)}',
    '.genda-widget-modal iframe{width:100%;height:100%;border:none}',
    '.genda-widget-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,.08);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;color:#333;z-index:1;transition:background .2s}',
    '.genda-widget-close:hover{background:rgba(0,0,0,.15)}',
    '@keyframes genda-bounce{0%{transform:scale(0)}60%{transform:scale(1.1)}100%{transform:scale(1)}}',
    '@media(max-width:480px){.genda-widget-modal{width:100vw;height:100vh;max-width:100%;max-height:100%;border-radius:0}.genda-widget-btn{bottom:16px;' + (position === 'bottom-left' ? 'left:16px' : 'right:16px') + '}}'
  ].join('\n');
  document.head.appendChild(style);

  // Create button
  var btn = document.createElement('button');
  btn.className = 'genda-widget-btn';
  btn.style.background = color;
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' + text;

  // Create overlay
  var overlay = document.createElement('div');
  overlay.className = 'genda-widget-overlay';
  overlay.innerHTML = '<div class="genda-widget-modal"><button class="genda-widget-close">&times;</button><iframe src="about:blank"></iframe></div>';

  document.body.appendChild(btn);
  document.body.appendChild(overlay);

  var iframe = overlay.querySelector('iframe');
  var closeBtn = overlay.querySelector('.genda-widget-close');
  var bookUrl = baseUrl + '/' + slug + '/book';

  btn.addEventListener('click', function() {
    iframe.src = bookUrl;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  });

  function closeWidget() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    setTimeout(function() { iframe.src = 'about:blank'; }, 300);
  }

  closeBtn.addEventListener('click', closeWidget);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeWidget();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('active')) closeWidget();
  });
})();
