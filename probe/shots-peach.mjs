// 桃花 + 晴午波光 + 长曝颗粒 样张（r10）：
//   p1 peach-spring-blossom  春·晴 西岸桃 → 花满树 + 落花铺地
//   p2 peach-summer-fruit    夏·晴 北岸桃 → 果实
//   p3 peach-winter-bare     冬·晴 西岸桃 → 裸枝过冬（花/果/落花/叶全隐）
//   p4 noon-sunwater         夏·正午·晴 池面 → 太阳波光（uSunVis>0）
// 只改环境/机位/显隐，不动渲染链。输出 outputs/visual/。 usage: node probe/shots-peach.mjs
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
  const look = (tx, ty, tz, px, py, pz) => page.evaluate((a) => {
    const g = window.__garden;
    g.controls.target.set(a[0], a[1], a[2]);
    g.camera.position.set(a[3], a[4], a[5]);
    g.camera.lookAt(g.controls.target); g.controls.update();
  }, [tx, ty, tz, px, py, pz]);
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  await sleep(1200);
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 60000, polling: 200 }).then(() => true).catch(() => false);
  const sunVis = () => page.evaluate(() =>
    window.__garden && window.__garden.sunVisWater ? window.__garden.sunVisWater() : null);

  /* p1 春·晴 西岸桃：花满树 + 落地花瓣 */
  await page.evaluate(() => { const g = window.__garden;
    g.setEnv('time','noon'); g.setEnv('weather','clear'); g.setEnv('season','spring'); });
  await settled(); await sleep(1200);
  await look(-19.8, 4.2, 4.2, -25.5, 5.2, 8.5);
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'r10-peach-spring-blossom.png') });

  /* p2 夏·晴 北岸桃：果实 */
  await page.evaluate(() => { const g = window.__garden;
    g.setEnv('time','noon'); g.setEnv('weather','clear'); g.setEnv('season','summer'); });
  await settled(); await sleep(1200);
  await look(6.2, 3.8, 15.4, 3.4, 3.6, 12.2);
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'r10-peach-summer-fruit.png') });

  /* p3 冬·晴 西岸桃：裸枝过冬 */
  await page.evaluate(() => { const g = window.__garden;
    g.setEnv('time','noon'); g.setEnv('weather','clear'); g.setEnv('season','winter'); });
  await settled(); await sleep(1200);
  await look(-19.8, 3.4, 4.2, -25.5, 3.8, 8.5);
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'r10-peach-winter-bare.png') });

  /* p4 夏·正午·晴 池面：太阳波光（uSunVis 应 >0） */
  await page.evaluate(() => { const g = window.__garden;
    g.setEnv('time','noon'); g.setEnv('weather','clear'); g.setEnv('season','summer'); });
  await settled(); await sleep(1200);
  const sv = await sunVis();
  await look(0, 4, 0, -2, 5, 13);
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'r10-noon-sunwater.png') });
  console.log(`uSunVis=${sv}（正午晴天应 >0；晨昏/夜/雨=0）`);

  await browser.close(); server.close();
  console.log(`样张：${OUT}/r10-*.png`);
  process.exit(0);
})().catch(e => { console.error('[shots-peach] 崩溃:', e); process.exit(2); });