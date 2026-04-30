const CACHE = 'bookkeeper-v2';
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

// 安装：缓存新版本资源
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  // 立即激活，不等待旧 SW 释放
  self.skipWaiting();
});

// 激活：清理旧版本缓存
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  // 立即接管所有页面
  self.clients.claim();
});

// 网络优先：先试网络，失败才用缓存
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // 网络成功 → 更新缓存
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
