/* 苏州园林 · 离线 Service Worker（P1-3 PWA）
   ⚠️ 2026-09-23 策略修正（老黄："为什么要刷两次，这难道不是你程序上的 bug 吗？" —— 是）：
   旧版对**所有同源 GET 兜底** `return hit || net`（陈旧优先），而 `src/*.js` 又**不在 SHELL
   预缓存清单**里 —— 它们的缓存只能由运行时写入，于是永远比磁盘晚**一次**：改完必须刷两次
   才看得见（第一次拿到 network-first 的新 index.html + cache-first 的旧 JS，第二次才是新 JS）。
   三处叠加：① 兜底分支把 src/*.js 也吞进"陈旧优先"；② 它们不在预缓存清单 ⇒ 缓存滞后一次；
   ③ CACHE 版本号没随内容 bump ⇒"版本升级即整体换缓存"这条保险从未触发。
   现按"改不改得动"分流：
     · 代码类（index.html / src/*.js / vendor.js / manifest）→ **network-first**，离线回退缓存。
       本项目零 CDN、本地交付，网络即本地文件，network-first 没有延迟代价；换来"改了即所见"。
     · 大件（assets/*.glb / icons / docs 封面）→ **cache-first**（版本内不变，保持秒开与离线）。
     · 导航请求 → network-first，离线回退缓存的 index.html。
   ⚠️ **改了 src/*.js、vendor.js 或 SHELL 内容后必须 bump 版本号** —— 否则已装 SW 的浏览器
      仍走旧缓存。版本号升级即整体换缓存，旧缓存 activate 时整体删除。 */
/* 2026-09-28 活雾批次 bump v4→v5：本轮改了 SHELL 成员 index.html（天气按钮）与 src/*.js
   （活雾/鱼平滑/雾团），按头部规矩升版，让已装 SW 的浏览器整体换新缓存。 */
/* 2026-09-29 合并时段条批次 bump v5→v6：又改了 SHELL 成员 index.html（时段/时辰合并）。 */
/* 2026-09-30 bump v6→v7：GLBS 预缓存清单移除 LotusPlant.glb（池边荷花改程序化）。 */
/* 2026-09-30 电闪雷鸣批次 bump v7→v8：又改了 SHELL 成员 index.html（新增"电闪雷鸣"天气按钮）。 */
/* 2026-09-30 撤池边大荷花批次 bump v8→v9：改了 SHELL 成员 index.html —— 内联主模块的
   import 清单里删掉已不存在的 GLB_LOTUS_STEM_H（漏改会 ESM 链接报错、页面停在加载页，
   实测正是这么炸的：check 只查语法、不查模块链接）。 */
/* 2026-09-30 荷花回归批次 bump v9→v10：GLBS 预缓存清单恢复 LotusPlant.glb
   （老黄："之前有个版本有好多株树立的荷花，虽然有点假但是至少能看"）。 */
/* 2026-09-30 补杆批次 bump v10→v11：又改了 SHELL 成员 index.html（内联主模块的
   import 清单恢复 GLB_LOTUS_STEM_H）。 */
/* 2026-09-30 合并+新场景批次 bump v11→v12：改了 SHELL 成员 index.html
   （天气行删"电闪雷鸣"、加"雨后初晴"；提示串 A S H F G → A S J F G）。 */
/* 2026-10-01 雨后痕迹批次 bump v12→v13：改了 SHELL 成员 index.html
   （内联主模块的 import 清单加 updatePostRain）。 */
const CACHE = 'suzhou-garden-v13';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/garden.svg',
  './vendor.js',
  './docs/cover.jpg',       // 水墨封面：loading 层要离线可见，归入应用壳
];
const GLBS = [
  /* 2026-09-30 三轮：LotusPlant.glb 回归（与 13-preload 同步；沿革见 08 的注释）。 */
  './assets/BananaPlant.glb',
  './assets/LotusPlant.glb',
  './assets/koi.glb',
  './assets/Turtle.glb',
];
/* ⚠️ 2026-09-27 · 高精资产批次：上面这份 GLBS 与 src/13-preload.js 的
   PRELOAD_MANIFEST 是**同一批资产的两个投影**，加高精包时**两处都要改**。
   不一致的后果是分方向的：
     · 只加 sw.js 不加 13 → SW 装好后仍走网络，重复下载一遍；
     · 只加 13 不加 sw.js → 用户装成 PWA 后首次开园**仍在下载 10MB**，
       违背 PWA 的"装了就该能离线打开"，而且 13 的进度条会一直走网络
       （本项目里"进度条有真进度"恰恰等价于"没装 PWA"）。
   分流逻辑本身**不需要动**（.glb 仍是 cache-first = 版本内不变；
   代码类仍 network-first = 改了即所见）。 ⚠️ 加完必须 bump 上面的 CACHE 版本号。 */

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

  /* 大件（版本内不变）→ cache-first；其余（代码）→ network-first。理由见头部注释 */
  const isAsset = url.pathname.endsWith('.glb')
               || url.pathname.includes('/icons/')
               || url.pathname.includes('/docs/');
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((hit) => {
      if (hit && isAsset) return hit;                  // 大件：命中即用，不碰网络
      return fetch(e.request).then((res) => {          // 代码：网络优先 ⇒ 改了即所见
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || Response.error());          // 离线：回退缓存
    })
  );
});
