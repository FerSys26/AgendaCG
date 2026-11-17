const CACHE_NAME = 'agendacg-pwa-v2';
const APP_FILES = ['./','./index.html','./css/styles.css','./js/app.js','./js/pwa.js','./js/cloud.js','./js/config.js','./manifest.webmanifest','./privacidad.html','./condiciones.html','./icons/icon-192.png','./icons/icon-512.png','./icons/icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const networkFirst = url.pathname.endsWith('/js/config.js');
  const fetchAndCache = () => fetch(event.request).then(response => {
    if (response && response.ok) { const copy=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy)); }
    return response;
  });
  if (networkFirst) {
    event.respondWith(fetchAndCache().catch(() => caches.match(event.request)));
  } else {
    event.respondWith(caches.match(event.request).then(cached => cached || fetchAndCache().catch(() => caches.match('./index.html'))));
  }
});
