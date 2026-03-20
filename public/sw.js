const CACHE_NAME = 'genda-v1';
const STATIC_ASSETS = [
  '/manifest.json'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Only cache GET requests for static assets
  if (e.request.method !== 'GET') return;
  // Skip API calls
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      // Cache successful responses for fonts and images
      if (response.ok && (e.request.url.includes('fonts.') || e.request.url.includes('/icon-'))) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
