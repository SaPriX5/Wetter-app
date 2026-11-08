// Service Worker: App-Hülle vorab, Schriften bei Bedarf. Wetterdaten werden NICHT hier, sondern in der App gecacht.
const V = 'wetter-v10';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/wmo.js', 'js/hero.js', 'js/api.js', 'js/charts.js', 'js/radar.js', 'js/nowcast.js', 'js/day.js',
  'fonts/barlow-latin-300-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', 'fonts/barlow-latin-700-normal.woff2', 'fonts/barlow-latin-900-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/icon.svg',
  'wx/anim/clear-day.svg', 'wx/anim/clear-night.svg', 'wx/anim/partly-cloudy-day.svg', 'wx/anim/partly-cloudy-night.svg', 'wx/anim/overcast.svg', 'wx/anim/fog.svg', 'wx/anim/drizzle.svg', 'wx/anim/rain.svg', 'wx/anim/extreme-rain.svg', 'wx/anim/sleet.svg', 'wx/anim/snow.svg', 'wx/anim/extreme-snow.svg', 'wx/anim/partly-cloudy-day-rain.svg', 'wx/anim/partly-cloudy-night-rain.svg', 'wx/anim/thunderstorms-rain.svg', 'wx/anim/thunderstorms-extreme-rain.svg', 'wx/static/clear-day.svg', 'wx/static/clear-night.svg', 'wx/static/partly-cloudy-day.svg', 'wx/static/partly-cloudy-night.svg', 'wx/static/overcast.svg', 'wx/static/fog.svg', 'wx/static/drizzle.svg', 'wx/static/rain.svg', 'wx/static/extreme-rain.svg', 'wx/static/sleet.svg', 'wx/static/snow.svg', 'wx/static/extreme-snow.svg', 'wx/static/partly-cloudy-day-rain.svg', 'wx/static/partly-cloudy-night-rain.svg', 'wx/static/thunderstorms-rain.svg', 'wx/static/thunderstorms-extreme-rain.svg',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return; // APIs, Karten und Radar laufen direkt ins Netz
  const isCode = /\.(html|js|css|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isCode) { // Netz zuerst, damit Updates ankommen; offline aus dem Cache
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); return r; }).catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
    return;
  }
  e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); } return r; })));
});
