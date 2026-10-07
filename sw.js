// Vine Link service worker: precache the whole game (including levels.json) so it plays offline.
// Bump VERSION whenever any cached file changes; old caches are deleted on activate.

const VERSION = 'vine-link-v1';
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'levels.json',
  'css/style.css',
  'js/app.js',
  'js/audio.js',
  'js/game.js',
  'js/input.js',
  'js/levels.js',
  'js/palette.js',
  'js/render.js',
  'js/solver.js',
  'js/storage.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network-first (so a new deploy is picked up immediately), falling back to the cache when
// offline or when the network takes longer than 3 seconds.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000, null));
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
      } catch {
        /* offline */
      }
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      return network.catch(() => Response.error());
    })(),
  );
});
