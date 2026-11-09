const CACHE = 'pocket-ledger-v19';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/db.js',
  './js/ai.js',
  './js/chart.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 网络优先：改了代码立刻生效，断网时回落到缓存。
   注意：网页版托管带分享码鉴权，cookie 过期后会返回 403——那不是网络错误，
   fetch 依然会「成功」返回一个 403 页面。所以除了 catch，还要把非 2xx 也当失败，
   先去缓存里找，否则装到主屏的网页版一过鉴权期就白屏。 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const fromCache = () =>
    caches.match(req, { ignoreSearch: true })
      .then(hit => hit || caches.match('./index.html', { ignoreSearch: true }));

  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        return res;
      }
      return fromCache().then(hit => hit || res);
    }).catch(fromCache)
  );
});
