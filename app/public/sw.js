/* Kafé OS service worker — hand-written (no Workbox/Serwist: they need webpack,
 * this app builds with Turbopack).
 *
 * Scope of this worker, by product decision D8 (the POS is ONLINE-ONLY):
 *   - It exists so the app is installable and so the shell still opens (with an
 *     "offline" banner) when the network drops.
 *   - It NEVER touches /api/* — no API response caching, no offline order queue.
 *     Orders, stock and payments always go straight to the network.
 *
 * Updating: bump VERSION whenever this file's caching behaviour changes. A new
 * worker installs in the background and WAITS; the page shows an "update
 * available" prompt and only then sends SKIP_WAITING (a cashier may be mid-order).
 */

const VERSION = 'v2';
const PREFIX = 'kafe-os';
const CACHE_SHELL = `${PREFIX}-shell-${VERSION}`;   // "/" document + offline page + icons
const CACHE_STATIC = `${PREFIX}-static-${VERSION}`; // /_next/static/* (content-hashed)
const CACHE_ASSETS = `${PREFIX}-assets-${VERSION}`; // optimized images, fonts, logo, ePOS SDK
const CURRENT_CACHES = [CACHE_SHELL, CACHE_STATIC, CACHE_ASSETS];

const OFFLINE_URL = '/offline.html';
const SHELL_URL = '/';
const PRECACHE_ICONS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

// Entry caps. Hashed chunks from old deployments pile up in CACHE_STATIC until
// VERSION is bumped, so it is capped too (oldest entries are dropped first).
const MAX_STATIC_ENTRIES = 400;
const MAX_ASSET_ENTRIES = 150;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Only cache complete, same-origin successes (never opaque, partial, redirected,
 *  error or explicitly non-storable responses). */
function isCacheable(response) {
  if (!response || !response.ok || response.status !== 200 || response.type !== 'basic') return false;
  if (response.redirected) return false;
  return !/no-store|private/i.test(response.headers.get('cache-control') || '');
}

/** The "/" shell document. It is rendered per request (CSP nonce), so Next marks
 *  it `private, no-store`, but its HTML carries no user data: the session lives in
 *  HttpOnly cookies and every API call goes to the network. So the shell alone may
 *  be kept for the offline banner. Never used for /api/* (bypassed above). */
function isShellCacheable(response) {
  if (!response || !response.ok || response.status !== 200 || response.type !== 'basic') return false;
  if (response.redirected) return false;
  return /^text\/html/i.test(response.headers.get('content-type') || '');
}

/** Cache.keys() is insertion-ordered, so deleting from the front drops the oldest. */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function putInCache(cacheName, request, response, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
    if (maxEntries) await trimCache(cacheName, maxEntries);
  } catch {
    // Quota exceeded / storage evicted — caching is best-effort, never fatal.
  }
}

function isStaticAsset(pathname) {
  return pathname.startsWith('/_next/static/');
}

function isRevalidatedAsset(request, pathname) {
  return (
    pathname.startsWith('/_next/image') ||
    pathname.startsWith('/icons/') ||
    pathname === '/logo.svg' ||
    pathname === '/favicon.ico' ||
    request.destination === 'font' ||
    /\.(?:woff2?|ttf|otf)$/.test(pathname)
  );
}

// ── Strategies ──────────────────────────────────────────────────────────────

/** Navigations: network first; offline falls back to the cached shell, then the offline page. */
async function handleNavigation(event) {
  const request = event.request;
  try {
    const response = await fetch(request);
    // The POS is a single client-rendered route. Its HTML is identical whether the
    // user is logged in or not (auth lives in HttpOnly cookies), so it is safe to keep.
    if (isShellCacheable(response) && new URL(request.url).pathname === SHELL_URL) {
      event.waitUntil(putInCache(CACHE_SHELL, SHELL_URL, response.clone()));
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE_SHELL);
    const exact = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (exact) return exact;
    const shell = await cache.match(SHELL_URL, { ignoreVary: true });
    if (shell) return shell;
    const offline = await cache.match(OFFLINE_URL, { ignoreVary: true });
    if (offline) return offline;
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/** Content-hashed build output: once cached it never changes, so serve from cache. */
async function cacheFirst(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) {
    event.waitUntil(putInCache(CACHE_STATIC, request, response.clone(), MAX_STATIC_ENTRIES));
  }
  return response;
}

/** Serve the cached copy immediately and refresh it in the background. */
async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_ASSETS);
  const cached = await cache.match(request);

  const network = fetch(request);
  // Registered before the response is handed to the page, so the clone is taken
  // while the body is still unread. Keeps the worker alive until the copy is
  // stored; a failed refresh (offline) is fine — the cached copy stays.
  event.waitUntil(
    network
      .then((response) =>
        isCacheable(response)
          ? putInCache(CACHE_ASSETS, request, response.clone(), MAX_ASSET_ENTRIES)
          : undefined
      )
      .catch(() => undefined)
  );

  return cached || network;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // No skipWaiting() here on purpose — see the header comment.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      // cache: 'reload' bypasses the HTTP cache so a new worker never precaches stale files.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      // Icons are nice-to-have: a failed icon fetch must not block installation.
      await Promise.allSettled(
        PRECACHE_ICONS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(`${PREFIX}-`) && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Sent once by the page right after the very first install: that page load
  // happened before this worker existed, so its HTML and JS chunks were never
  // seen by the fetch handler. Fetch them now so the shell can open offline
  // without needing a second visit. Only the shell and hashed build output are
  // accepted — never an API path.
  if (data.type === 'WARM_CACHE' && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        for (const raw of data.urls.slice(0, 200)) {
          let url;
          try {
            url = new URL(String(raw), self.location.origin);
          } catch {
            continue;
          }
          if (url.origin !== self.location.origin) continue;
          const isShell = url.pathname === SHELL_URL;
          if (!isShell && !isStaticAsset(url.pathname)) continue;

          const cacheName = isShell ? CACHE_SHELL : CACHE_STATIC;
          const key = isShell ? SHELL_URL : url.pathname + url.search;
          try {
            const cache = await caches.open(cacheName);
            if (await cache.match(key, { ignoreVary: true })) continue;
            const response = await fetch(key, { credentials: 'same-origin' });
            if (isShell ? isShellCacheable(response) : isCacheable(response)) await cache.put(key, response);
          } catch {
            // Offline or blocked mid-warm — stop quietly; normal fetches will fill the cache later.
          }
        }
        await trimCache(CACHE_STATIC, MAX_STATIC_ENTRIES);
      })()
    );
  }
});

// ── Fetch routing ───────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Everything below returns WITHOUT respondWith(), i.e. the browser handles the
  // request exactly as if no service worker existed.
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // printer bridge (127.0.0.1), R2, etc.
  // /api/v1/*, /api/print*, /api/image-proxy — Next matches routes case-insensitively.
  if (url.pathname.toLowerCase().startsWith('/api/')) return;
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(event));
    return;
  }

  if (isRevalidatedAsset(request, url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  // Anything else (RSC payloads, unknown paths) goes to the network untouched.
});
