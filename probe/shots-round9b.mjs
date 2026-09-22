// 写实增强合辑样张（r9b）：验证新体积光湍流 + 灯下光斑 + 夏夜萤火。
//   n1b night-hall-vol  夜·晴 远香堂正面 → 体积光/地面光斑（湍流深化后）
//   n2b summer-fireflies 夏·夜·晴  池南灌丛岸 → 萤火虫群落
// 只改环境/机位/显隐，不动渲染链。输出 outputs/visual/。 usage: node probe/shots-round9b.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', 'visual');
fs.mkdirSync(OUT, { recursive: true });
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // 强制高档：flas... 高级视觉（体积光/SSS/光斑）只在非 low 档渲染
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  await sleep(1200);
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 60000, polling: 200 }).then(() => true).catch(() => false);

  const fireOpacity = done => page.evaluate(() => window.__garden.fireflyOpacity && window.__garden.fireflyOpacity());

  /* 帧 1：夜·晴 远香堂正面（倒影 + 体积光 + 光斑） */
  await page.evaluate(() => { window.__garden.setEnv('time','night'); window.__garden.setEnv('season','summer'); window.__garden.setEnv('weather','clear'); });
  await settled(); await sleep(1200);
  await page.evaluate(() => {
    const g = window.__garden;
    g.controls.target.set(0, 6, -2);
    g.camera.position.set(6.5, 5.5, 18);
    g.camera.lookAt(g.controls.target); g.controls.update();
  });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'r9b-night-hall-vol.png') });

  /* 帧 2：夏·夜·晴 池南萤火（fireflies 三簇之一 cx=-5.5,cz=11.5） */
  await page.evaluate(() => { window.__garden.setEnv('time','night'); window.__garden.setEnv('season','summer'); window.__garden.setEnv('weather','clear'); });
  await settled(); await sleep(1500);   // 等 uOpacity 淡入
  const fo = await fireOpacity();
  await page.evaluate(() => {
    const g = window.__garden;
    g.controls.target.set(-5.5, 1.6, 11.5);
    g.camera.position.set(-12, 2.2, 16.5);
    g.camera.lookAt(g.controls.target); g.controls.update();
  });
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, 'r9b-summer-fireflies.png') });
  console.log(`fireflies uOpacity=${fo.toFixed(3)}（>0 即夏夜晴可见）`);

  await browser.close(); server.close();
  console.log(`样张：${OUT}/r9b-*.png`);
  process.exit(0);
})().catch(e => { console.error('[shots-r9b] 崩溃:', e); process.exit(2); });