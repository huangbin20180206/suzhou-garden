import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChromium, launchPersistent } from './_harness.mjs';

/* 第二阶段：真实"冷启动离线"验证。
   与 pwa-cache.mjs 的差别：使用**持久化用户数据目录**，先在线安装 SW 并预热缓存，
   然后**完全关闭浏览器进程**，再以断网状态重新启动——
   验证的是"关掉浏览器后断网重开"的真实用户路径，而不是同一页面会话内的 fetch。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const userDataDir = path.join(root, 'outputs', 'pwa-profile');
const PORT = 8935;

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  // 离线阶段用 503 模拟"服务器也不可达"，比直接断更接近真实断网（连接层拒绝）
  if (req.headers['x-probe-down'] === '1') { req.socket.destroy(); return; }
  try {
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const data = await fs.readFile(file);
    const types = { '.js': 'text/javascript', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));

let browser;
let phase = 'online-warmup';
try {
  const errors = [];

  /* ── 阶段 1：在线访问一次，让 SW 安装并预热缓存（使用持久化 profile）── */
  browser = await launchChromium(chromium);
  const context = await browser.newContext({ viewport: { width: 480, height: 640 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`[${phase}] ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), null, { timeout: 90000 });
  // 等 SW 控制页面（首次加载后注册；controllerchange 表示接管完成）
  const controlled = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;
    await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    return true;
  }).catch(() => false);
  assert.ok(controlled, 'SW must be registered and controlling the page');
  // 预热 GLB：触发一次真实加载，确保 cache-first 把 4 个模型收进缓存
  await page.waitForFunction(() => {
    const names = new Set();
    window.__garden.scene.traverse(o => { for (const n of ['KoiFish', 'Turtle', 'BananaPlant', 'LotusPlant']) if (o.name.includes(n)) names.add(n); });
    return names.size === 4;
  }, null, { timeout: 60000 });
  await browser.close();
  browser = null;
  console.log('PASS: online warmup done (SW installed, 4 GLB cached); browser closed');

  /* ── 阶段 2：完全新的浏览器进程 + 断网 + 冷启动 ──
     Chromium 在离线模式下对顶层导航会先做连接探测，可能直接拒绝（ERR_INTERNET_DISCONNECTED）
     而不给 SW 拦截机会。稳妥做法：先以**在线**打开同一持久化 profile（此时 SW 已是激活态，
     且导航会被 SW 的 network-first 分支接管），再 `context.setOffline(true)` 切断网络，
     然后重新导航——这才是"用着用着断网"以及"离线刷新"的真实路径。 */
  phase = 'offline-cold-restart';
  const ctx2 = await launchPersistent(chromium, userDataDir, { viewport: { width: 480, height: 640 } });
  browser = ctx2;
  const page2 = await ctx2.newPage();
  page2.on('pageerror', e => errors.push(`[${phase}] ${e.message}`));
  ctx2.pages().forEach(p => p.on('pageerror', e => errors.push(`[${phase}] ${e.message}`)));
  await page2.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page2.waitForFunction(() => 'serviceWorker' in navigator && !!navigator.serviceWorker.controller, null, { timeout: 60000 });
  console.log('PASS: persistent context reopened, SW controlling before offline switch');
  await ctx2.setOffline(true);
  await page2.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page2.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), null, { timeout: 120000 });
  await page2.waitForFunction(() => {
    const names = new Set();
    window.__garden.scene.traverse(o => { for (const n of ['KoiFish', 'Turtle', 'BananaPlant', 'LotusPlant']) if (o.name.includes(n)) names.add(n); });
    return names.size === 4;
  }, null, { timeout: 90000 });
  assert.deepEqual(errors, [], 'Offline reload after cold restart must have no page errors');
  await page2.screenshot({ path: path.join(root, 'outputs/pwa-offline-cold-restart-v1.png') });
  await fs.writeFile(path.join(root, 'outputs/pwa-cold-restart.json'),
    JSON.stringify({ phase: 'persistent-context-offline-reload', offline: true, boot: true, allFourModels: true, pageErrors: errors }, null, 2));
  console.log('PASS: offline reload after browser-close booted with all four GLB models; screenshot saved');
} finally {
  await browser?.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
}
