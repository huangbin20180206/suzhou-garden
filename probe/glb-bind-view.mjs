/* 判"马夫衣服正面凸起"是资产问题还是姿态问题（HANDOFF 2026-10-28 第 2 项 步骤 1）：
   用独立查看器把 fig-laborer.glb 按**绑定姿态**渲染四个方位，放大到 1.7m 人高。
   用法：node probe/glb-bind-view.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'glb-bind');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(g, 'playwright'));
}

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 620, height: 900 } });
  page.on('pageerror', e => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/probe/glbview.html?m=/assets/${process.argv[2] || 'fig-laborer.glb'}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready && window.__ready(), null, { timeout: 120000, polling: 200 });
  console.log('glb', JSON.stringify(await page.evaluate(() => window.__glb)));

  /* ⚠️ 这套资产是**面朝 −Z**（theta=π 拍到的是后背）⇒ 正面取 theta≈0。 */
  const views = [
    ['front', 0, 0.95, 2.4],
    ['side',  Math.PI * 0.5, 0.95, 2.4],
    ['q34',   Math.PI * 0.25, 0.95, 2.4],
    ['back',  Math.PI, 0.95, 2.4],
    ['waist-front', 0, 0.95, 1.15],
    ['waist-q34',   0.45, 0.95, 1.15],
    ['face',        0, 1.52, 0.75],
  ];
  for (const [name, th, y, dist] of views){
    await page.evaluate(([t, yy, dd]) => window.__setCam(t, yy, dd), [th, y, dist]);
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('  📷', name + '.png');
  }
  await browser.close();
  await new Promise(r => server.close(r));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
