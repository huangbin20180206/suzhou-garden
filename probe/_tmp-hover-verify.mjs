// 临时验证探针（不注册）：悬停标签是否真的出现
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading') && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.evaluate(() => { const G = window.__garden; G.setEnv('season', 'summer'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const hov = await page.evaluate(() => matchMedia('(hover:hover)').matches);
  console.log('hover:hover = ' + hov);
  for (const [x, y] of [[700, 450], [500, 520], [950, 380], [700, 600]]) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => { const el = document.getElementById('hover-label'); return el ? (el.className + '|' + el.textContent) : 'MISSING'; });
    console.log(`mouse(${x},${y}) -> ` + st);
  }
  await page.mouse.move(500, 520);
  await page.waitForTimeout(900);
  const fin = await page.evaluate(() => { const el = document.getElementById('hover-label'); return el ? (el.className + '|' + el.textContent) : 'MISSING'; });
  console.log('final shot state -> ' + fin);
  await page.screenshot({ path: 'outputs/_diag/hover-verify.png' });
  await browser.close(); server.close();
})().catch(e => { console.error('[hover-verify] 异常:', e); process.exit(2); });