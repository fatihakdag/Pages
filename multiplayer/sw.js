// Service worker for the installed game.
//
// It exists for two reasons: an installed app should start when the phone has
// no signal, and Chrome only offers a real install (a WebAPK, the thing that
// opens without an address bar) for a page with a fetch handler.
//
// The strategy is deliberately split, because the two kinds of request here
// want opposite things:
//
//   the page      network first — index.html carries no-cache headers on
//                 purpose, and an installed copy that pinned an old build
//                 would be a bug that outlives every deploy. The cache is the
//                 offline fallback, nothing more.
//   icons, etc.   cache first — they change only when tools/icons.mjs is run,
//                 and the version below changes with them.
//
// The match itself is a WebSocket to the relay, which never reaches a fetch
// handler: being installed changes nothing about how a game is played, and
// there is no offline mode for an online match. /health is the relay's, so it
// is left alone too.

const VERSION = 'barrage-online-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // Precached from the network rather than from the HTTP cache, for the same
  // reason: the point of a new VERSION is to hold the new files.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((url) =>
        fetch(url, { cache: 'no-store' }).then((res) => {
          if (res.ok) return c.put(url, res);
          throw new Error(`could not precache ${url}: ${res.status}`);
        })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/health') return;

  // Navigations: try the network, fall back to whatever copy we have.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      // `cache: no-store` is the whole point of going to the network here.
      // A plain fetch() is served by the browser's own HTTP cache, so
      // "network first" would happily hand back the build before last and a
      // deploy would not show up on a reload.
      fetch(e.request.url, { cache: 'no-store', credentials: 'same-origin' })
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || Response.error()))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      // Only a good same-origin response is worth keeping.
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
