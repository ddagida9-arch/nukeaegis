// NUKE AEGIS — site-wide service worker for the installed web app (scope "/").
// /monitor and /evacuation keep their own, more specific worker (evac-sw.js); the browser uses the most specific scope,
// so this worker never handles those pages.
// - Pages: network first; when offline, the last copy of that page, otherwise /offline.html.
// - Built assets (/_next/static, /icons): cache first (file names are content-hashed / versioned).
// - Never cached: /api/* (live data must not be served stale), /cesium/* (large; served with long HTTP cache already),
//   map tiles and anything from other origins.
const VERSION = 'v1';
const CACHE = `nuke-aegis-app-${VERSION}`;
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/icons/icon-192.png', '/icons/icon.svg'];
const PAGE_LIMIT = 20;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('nuke-aegis-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = (await cache.keys()).filter((r) => r.headers.get('x-sw-page') === '1' || new URL(r.url).pathname.indexOf('.') < 0);
  for (const k of keys.slice(0, Math.max(0, keys.length - PAGE_LIMIT))) await cache.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/cesium/')) return;

  if (u.pathname.startsWith('/_next/static/') || u.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return r;
      })),
    );
    return;
  }

  if (req.mode === 'navigate') {
    const key = u.origin + u.pathname;   // one copy per page, query ignored
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok && !r.redirected && r.type === 'basic') {
            const cp = r.clone();
            caches.open(CACHE).then((c) => c.put(key, cp).then(() => trim(c)));
          }
          return r;
        })
        .catch(async () => (await caches.match(key)) || (await caches.match(OFFLINE)) || Response.error()),
    );
  }
});
