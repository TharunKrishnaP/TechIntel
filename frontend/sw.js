/**
 * TechIntel — Service Worker
 * ==========================
 * Makes the dashboard installable and usable offline.
 *
 * Caching strategy
 * ----------------
 *   App shell (HTML/CSS/JS/icons/manifest) : cache-first, refreshed in background
 *   Data snapshots under /data/            : stale-while-revalidate
 *   /api/* (live mode only)                : network-only, never cached
 *
 * A versioned cache name is used so a new deploy evicts the previous shell
 * instead of serving stale assets forever. Bump TECHINTEL_VERSION on every
 * release that changes the shell.
 */

const TECHINTEL_VERSION = 'v2';
const SHELL_CACHE = `techintel-shell-${TECHINTEL_VERSION}`;
const DATA_CACHE = `techintel-data-${TECHINTEL_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './pwa/api.js',
  './pwa/matcher.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './data/events.json',
  './data/tools.json',
  './data/stats.json',
  './data/timeline.json',
  './data/build.json',
];

// ---------------------------------------------------------------------------
// Install: precache the shell. A single failed asset rejects the install, which
// is deliberate — a half-cached shell produces an app that looks installed but
// breaks on first offline launch.
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_ASSETS);
      await self.skipWaiting();
    })()
  );
});

// ---------------------------------------------------------------------------
// Activate: drop caches from older versions.
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('techintel-') && k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin. Cross-origin (Google Fonts) goes to the network
  // untouched — caching opaque responses would silently serve nothing useful.
  if (url.origin !== self.location.origin) return;

  // Live API calls are never cached: stale feed data is worse than an error,
  // and in static mode these paths simply don't exist.
  if (url.pathname.includes('/api/')) return;

  const isData = url.pathname.includes('/data/');

  if (isData) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  // Navigations: serve the shell so a launch with no network still opens the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch (_) {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) {
    // Refresh in the background so the next launch gets the new asset.
    fetch(request)
      .then((res) => res.ok && cache.put(request, res.clone()))
      .catch(() => {});
    return hit;
  }
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    return new Response('Offline and not cached.', { status: 504, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await network) || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// Allow the page to trigger an immediate update (used after a deploy).
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
