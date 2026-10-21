/* Offline shell for Attention Lab.
 *
 * Strategy, and the reasoning behind it:
 *
 * - Navigations (the HTML document): network-first, cache as fallback. A stale
 *   app shell here is worse than an error page: the whole point of this tool is
 *   measuring reaction times, and running yesterday's adaptive parameters would
 *   silently produce data the user cannot trust. Offline still works, it just
 *   serves the last good copy.
 * - Static assets under /_next/static (hashed filenames): cache-first. The hash
 *   changes whenever the content does, so a cached hit is always correct.
 * - Icons/manifest: stale-while-revalidate.
 *
 * Paths are resolved relative to this file's own location rather than the
 * domain root, so the same build works when hosted at "/" and at "/<repo>/".
 * A service worker registered from a sub-path already has its scope confined to
 * that directory; asking for '/index.html' would reach outside that scope and
 * fail to match.
 *
 * Bump CACHE whenever this file changes, or returning users keep the old shell.
 */
const CACHE = 'attnlab-v1';

/* Resolve against the SW's own URL: new URL('../', self.location).pathname
 * collapses '/repo/sw.js' to '/repo/' and '/sw.js' to '/'. */
const ROOT = new URL('../', self.location).pathname;

const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']
  .map((p) => new URL(p, self.location).pathname);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // never cache the E2E harness: it is a test fixture that must reflect live code
  if (url.pathname.includes('e2e-harness')) return;

  // ignore anything outside this app's directory when hosted under a sub-path
  if (!url.pathname.startsWith(ROOT)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(ROOT, copy));
          return res;
        })
        .catch(() => caches.match(ROOT).then((r) => r || Response.error()))
    );
    return;
  }

  if (url.pathname.includes('/_next/static/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
