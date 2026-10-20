/* ────────────────────────────────────────────────────────────────
 * Service Worker · 只做两件事
 *   1. 让「添加到主屏幕」的 PWA 能离线/弱网打开（壳资源缓存）
 *   2. 不拦截业务数据（IndexedDB 本来就离线；这里只管 html/css/js/图标）
 *
 * 策略：
 *   - 导航请求（打开页面）：网络优先，失败才用缓存（保证更新能拿到新版）
 *   - 静态资源：先给缓存，同时后台悄悄更新（stale-while-revalidate）
 *   - 跨域 CDN（字体/图标库）：不碰，交给浏览器
 * ──────────────────────────────────────────────────────────────── */
const CACHE = 'milkchat-shell-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting())
  );
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
  // 跨域资源（GitHub 以外的 CDN 字体/图标）不缓存，避免缓存污染
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，失败回落缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
