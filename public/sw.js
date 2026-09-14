// Offline support: precache every static file, then serve network first with the cache as fallback.
// Bump CACHE when this list changes. test/static.test.mjs checks the list matches public/.
const CACHE = 'overlap-v3';
const FILES = [
  "./",
  "styles.css",
  "adunit.css",
  "favicon.svg",
  "og.png",
  "robots.txt",
  "fonts/plus-jakarta-sans-latin.woff2",
  "js/app.js",
  "js/tz.js",
  "js/state.js",
  "js/ics.js",
  "js/ui.js",
  "js/card.js",
  "js/adunit.js",
  "js/makers.js",
  "makers/censory.svg",
  "makers/penholder.svg",
  "makers/scrapeland.svg",
  "js/cities.js"
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))),
  );
});
