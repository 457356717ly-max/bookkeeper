const CACHE = 'bookkeeper-v1';
const ASSETS = [
  '/bookkeeper/',
  '/bookkeeper/index.html',
  '/bookkeeper/css/style.css',
  '/bookkeeper/manifest.json',
  '/bookkeeper/js/icons.js',
  '/bookkeeper/js/db.js',
  '/bookkeeper/js/parser.js',
  '/bookkeeper/js/stats.js',
  '/bookkeeper/js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
