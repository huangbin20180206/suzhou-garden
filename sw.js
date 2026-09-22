/* 苏州园林 · 离线 Service Worker（P1-3 PWA）
   策略：应用壳（index.html / vendor.js / manifest / icon） stale-while-revalidate；
   重资产（assets/*.glb） cache-first（版本内不变，命中即用）；
   导航请求离线时回退到缓存的 index.html。
   版本号升级即整体换缓存，旧缓存整体删除。 */
const CACHE = 'suzhou-garden-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/garden.svg',
  './vendor.js',
  './docs/cover.jpg',       // 水墨封面：loading 层要离线可见，归入应用壳
];
const GLBS = [
  './assets/BananaPlant.glb',
  './assets/koi.glb',
  './assets/LotusPlant.glb',
  './assets/Turtle.glb',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll([...SHELL, ...GLBS]).catch(() => c.addAll(SHELL)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('suzhou-garden-v') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;          // 零 CDN 约束：跨域一律不拦
  if (e.request.method !== 'GET') return;

  // 导航请求：网络优先，离线回退缓存页
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  const isGLB = url.pathname.endsWith('.glb');
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((hit) => {
      if (hit && isGLB) return hit;                    // GLB：命中即用，不碰网络
      const net = fetch(e.request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || Response.error());
      return hit || net;                               // 壳：有缓存先显，后台更新
    })
  );
});
