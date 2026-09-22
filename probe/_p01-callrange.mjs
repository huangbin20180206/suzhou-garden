// 只读诊断：480×640（smoke 同口径）下 draw calls 的**波动区间**。
// 为什么需要：相机启动后自动巡游（reel/巡游），视锥内容每帧在变 → calls 不是定值。
// 只看一次采样不能说明"门禁不会偶发红"，必须看 30 秒窗口的 min/median/max。
// 用法: node probe/_p01-callrange.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  return require('playwright');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const WINDOW_MS = Number(process.argv[2] || 30000);
const GATE = 800;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);          // 与 smoke 的采样时点对齐（boot + 4~6s）

  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < WINDOW_MS){
    const c = await page.evaluate(() => window.__garden.renderer.info.render.calls);
    samples.push(c);
    await page.waitForTimeout(250);
  }
  samples.sort((a, b) => a - b);
  const n = samples.length;
  const med = samples[Math.floor(n / 2)];
  const min = samples[0], max = samples[n - 1];
  const p95 = samples[Math.floor(n * 0.95)];
  console.log(`窗口 ${(WINDOW_MS / 1000).toFixed(0)}s / ${n} 次采样（480×640）`);
  console.log(`  min=${min}  中位数=${med}  p95=${p95}  max=${max}   门禁 ${GATE}`);
  console.log(`  ${max < GATE ? '✓ 全窗口最大值仍在门禁内（余量 ' + (GATE - max) + '）'
                        : '✗ 窗口内出现过 ≥' + GATE + ' 的采样 → 门禁会偶发红'}`);
  console.log(`  全部采样：${samples.join(' ')}`);
  await browser.close();
  server.close();
})().catch(e => { console.error('[probe] 异常：', e); process.exit(1); });
