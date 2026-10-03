import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChromium } from './_harness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/probe-host') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>PWA test</title>');
    return;
  }
  try {
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const data = await fs.readFile(file);
    const types = { '.js': 'text/javascript', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await launchChromium(chromium);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/probe-host`);
  const result = await page.evaluate(async () => {
    await (await caches.open('other-app-v1')).put('/foreign-data', new Response('keep-me'));
    await (await caches.open('suzhou-garden-v0')).put('/old-data', new Response('obsolete'));
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    const keys = await caches.keys();
    const foreign = await (await caches.open('other-app-v1')).match('/foreign-data');
    return { keys, foreign: foreign ? await foreign.text() : null };
  });
  console.log(JSON.stringify(result));
  assert.equal(result.foreign, 'keep-me', 'Foreign cache entry must survive Garden activation');
  assert.ok(!result.keys.includes('suzhou-garden-v0'), 'Old Garden cache must be deleted');
  console.log('PASS: foreign cache preserved; old Garden cache removed');

  /* ══ 在线预热 ══════════════════════════════════════════════════════════════
     ⚠️⚠️ 这一步**此前缺失**，而它正是本门长期报红（且没人看见，因为它不在
     verify-all 的 SUITES 里）的真因 —— 与被测代码无关：
     2026-10-03 用 `git stash` 回到 HEAD 复现了同一处红。

     机制：`sw.js` 把 **`src/*.js` 排除在 SHELL 预缓存清单之外**，让它们走
     `network-first`（2026-09-23 的决定，为治"改完要刷两次才生效"）。
     代价是它们的缓存**只能由运行时写入** ⇒ 必须有**一次在线真页面加载**才会进缓存。
     而本门原先只在假页 `/probe-host` 上注册 SW、**从未在线加载过真页面**，
     于是断网后：
       · `index.html` 从预缓存取到 ✓（它在 SHELL 里）
       · 它 import 的 16 个 `src/*.js` 全部落空 ✗（`caches.match` 未命中 →
         `Response.error()`）⇒ 内联主模块加载失败 ⇒ `window.__garden` 永不出现
         ⇒ `#loading` 永远拿不到 `.done` ⇒ 卡到 90s 超时。
     ⇒ 先在线把真页面加载一次（SW 装好 + src 进缓存），再断网重载。
       这也正是 `pwa-cold-restart.mjs` 一直在做、而本门漏掉的那一步，
       也正是"用户装了 PWA 之后断网能不能打开"的**真实**场景（安装必然伴随一次在线访问）。
     ⚠️ 反过来说：本门的真实价值是「**已在线访问过** ⇒ 断网可用」+ 缓存隔离 +
       离线资源清单；"全新安装后立刻断网" 是另一件事（那需要把 `src/*.js` 也放进
       SHELL 预缓存清单，属产品取舍，未做）。 */
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 480, height: 640 });

  const waitBoot = (tag) => page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 90000 },
  ).catch((e) => { throw new Error(`${tag}启动未在 90s 内到达 .done —— `
    + `最常见原因是 src/*.js 没有进 SW 缓存（见本文件"在线预热"注释）：${e.message}`); });

  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 60000 });
  await waitBoot('在线预热');
  assert.deepEqual(errors.slice(), [], 'Online warmup boot must have no page errors');
  errors.length = 0;      // 之后只统计**断网重载**那一次的错误
  console.log('PASS: online warmup boot (SW installed, src/*.js runtime-cached)');

  await context.setOffline(true);
  const offline = await page.evaluate(async () => {
    /* ⚠️ 这份清单必须与 sw.js 的 SHELL + GLBS **逐项对齐** —— 它就是"装了 PWA 就该能
       离线打开"的实测口径。2026-10-03 补 Macaw.glb：此前它既不在 sw.js 的 GLBS 里、
       也不在这份清单里 ⇒ 这个"离线首开"门禁**从定义上看不见少了鹦鹉**
       （离线实测只查已声明的 8 项，自然全 200）。漏项的机器守卫另见
       probe/preload-manifest-sync.mjs（纯文本比对，不用起浏览器）。 */
    const urls = ['/index.html', '/vendor.js', '/manifest.webmanifest', '/icons/garden.svg',
      '/assets/BananaPlant.glb', '/assets/koi.glb', '/assets/LotusPlant.glb', '/assets/Turtle.glb',
      '/assets/Macaw.glb'];
    return Promise.all(urls.map(async url => { const r = await fetch(url); return { url, status: r.status, bytes: (await r.arrayBuffer()).byteLength }; }));
  });
  assert.ok(offline.every(r => r.status === 200 && r.bytes > 0), 'All offline resources must be present');
  console.log('PASS: nine offline resources available ' + JSON.stringify(offline));

  /* ── 断网重载：这一次才是本门真正要证的那件事 ── */
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 60000 });
  await waitBoot('断网重载');
  const MODELS = ['KoiFish', 'Turtle', 'BananaPlant', 'LotusPlant', 'Macaw'];
  await page.waitForFunction((names5) => {
    const names = new Set();
    window.__garden.scene.traverse(o => { for (const n of names5) if (o.name.includes(n)) names.add(n); });
    return names.size === names5.length;
  }, MODELS, { timeout: 60000 });
  assert.deepEqual(errors, [], 'Offline boot must have no page errors');
  await page.screenshot({ path: path.join(root, 'outputs/pwa-offline-verified-v1.png') });
  await fs.writeFile(path.join(root, 'outputs/pwa-verification.json'), JSON.stringify({ sourceCommit: '5d16e10', cacheIsolation: result, offline, offlineBoot: true, allFiveModels: true, models: MODELS, pageErrors: errors }, null, 2));
  console.log('PASS: offline Garden boot and all five GLB models; screenshot saved');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
