const CACHE_NAME = 'gintonggabay-v3';
const ASSETS = [
  './',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/calculator.js',
  'js/scanner.js',
  'js/icons-gen.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('Non-critical asset cache skipped:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => {
          if (hit) return hit;
          if (e.request.mode === 'navigate') return caches.match('offline.html');
          return Response.error();
        })
      )
  );
});