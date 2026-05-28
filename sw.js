// ttn-backup service worker — cache-first.
// Bump CACHE_VERSION to invalidate installed clients.

const CACHE_VERSION = 'ttn-backup-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './client.js',
  './js/utils.js',
  './js/data.js',
  './js/storage.js',
  './js/backup.js',
  './js/schedule.js',
  './js/ui.js',
  './js/pages/dashboard.js',
  './js/pages/apps.js',
  './js/pages/history.js',
  './js/pages/schedules.js',
  './js/pages/settings.js',
];

const OPTIONAL_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(CORE_ASSETS);
    await Promise.all(OPTIONAL_ASSETS.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      if (fresh.ok && new URL(req.url).origin === location.origin) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
