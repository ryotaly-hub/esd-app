/* esd-app — Service Worker
 * 通信を優先し、つながらないときだけキャッシュを使う（更新がすぐ反映されるように）。
 * 生成（POST /api/generate など）はキャッシュしない。 */
const CACHE = 'esd-app-v21';
const ASSETS = ['./', './index.html', './style.css', './app.js', './layout.js', './drawing.js', './manifest.webmanifest', './api/options',
  './img/bg-architecture.webp', './img/app-192.png', './img/caret.png', './img/btn-sparkle.png', './img/btn-paste.png', './img/btn-open.png', './img/btn-save.png', './img/btn-reset.png', './img/caret-dark.png', './img/icon-building.png', './img/icon-floorplan.png', './img/icon-power.png', './img/icon-lighting.png', './img/icon-network.png', './img/icon-fire.png', './img/icon-search.png', './img/icon-guide.png', './img/icon-wiring.png', './img/icon-estimate.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
