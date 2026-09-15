// Offline support: precache every app file, then serve network first with the cache as fallback.
// Bump CACHE when this list changes. test/static.test.mjs checks the list matches public/.
// The meeting time pages are not precached: each one is cached when it is opened online.
const CACHE = 'overlap-v9';
const FILES = [
  "./",
  "styles.css",
  "showcase.css",
  "pages.css",
  "favicon.svg",
  "favicon.ico",
  "favicon-96.png",
  "apple-touch-icon.png",
  "og.png",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "fonts/plus-jakarta-sans-latin.woff2",
  "js/app.js",
  "js/tz.js",
  "js/state.js",
  "js/ics.js",
  "js/ui.js",
  "js/card.js",
  "js/showcase.js",
  "js/makers.js",
  "makers/censory.svg",
  "makers/penholder.svg",
  "makers/scrapeland.svg",
  "makers/vetrosoft.svg",
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
        .then(hit => hit || (req.mode !== 'navigate' ? Response.error()
          // A page never opened online, such as /meeting-time/tokyo-berlin/, redirects to the cached app.
          // Serving the app's HTML at that address instead would break its relative asset paths.
          : caches.match('./').then(app => (app ? Response.redirect('./') : Response.error()))))),
  );
});
