// ttn-backup service worker — cache-first.
// Bump CACHE_VERSION to invalidate installed clients.

const CACHE_VERSION = 'ttn-backup-v6';

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
  './js/help.js',
  './js/ui.js',
  './js/pages/dashboard.js',
  './js/pages/apps.js',
  './js/pages/history.js',
  './js/pages/schedules.js',
  './js/pages/settings.js',
  './js/pages/help.js',
];

// In-app help guides (ttn-docs). Add each new docs/help/<slug>.md here so it
// precaches for offline; keep ./docs/help/index.json in sync with the files.
const HELP_ASSETS = [
  './docs/help/index.json',
  './docs/help/get-started.md',
  './docs/help/choose-where-backups-are-saved.md',
  './docs/help/install-ttn-backup.md',
  './docs/help/back-up-all-your-apps.md',
  './docs/help/back-up-a-single-app.md',
  './docs/help/test-an-app-connection.md',
  './docs/help/schedule-recurring-backups.md',
  './docs/help/edit-or-delete-a-schedule.md',
  './docs/help/restore-an-app-from-a-backup.md',
  './docs/help/browse-your-backup-history.md',
  './docs/help/rebuild-backups-after-a-wipe.md',
  './docs/help/set-how-many-backups-to-keep.md',
  './docs/help/name-this-device.md',
  './docs/help/clear-the-local-index.md',
];

const OPTIONAL_ASSETS = [
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(CORE_ASSETS);
    await Promise.all([...OPTIONAL_ASSETS, ...HELP_ASSETS].map((url) => cache.add(url).catch(() => {})));
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
