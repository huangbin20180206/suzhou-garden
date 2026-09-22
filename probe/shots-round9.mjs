// 第九轮样张（2026-09-21 方案三件套终拍）：
//  n1 夜景幽而不黑（中间调提亮） / n2 灯笼实体化（宫灯+流苏+点光修复） / n3 雨天涟漪（含夜雨）。
// 只改环境、机位、UI 显隐，不动渲染链。输出 outputs/visual/。
// 用法: node probe/shots-round9.mjs
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => console.log('[页面报错]', String(e).slice(0, 200)));

  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000 });
  await page.waitForFunction(() => window.__garden.koiGroup.userData.fishes.length >= 11,
    { timeout: 240000 });
  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());

  await page.evaluate(() => {
    for (const id of ['env', 'hud', 'stats']){ const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  });

  const settle = () => page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 90000, polling: 200 }).catch(() => {});
  const shot = async (name) => {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(OUT, name) });
    await page.evaluate(() => { if (window.__garden) window.__garden.controls.minDistance = 9; });
    console.log('  ✓ ' + name);
  };

  /* 1 · 夜景全景（n1 幽而不黑）：overview 机位，晴夜满月。
     检查中间调：墙/石/草皮应可读，灯笼为唯一高光锚点。 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'night'); g.setEnv('weather', 'clear'); g.setEnv('season', 'summer');
    g.controls.minDistance = 0.1;
    g.camera.position.set(20, 12, -24);
    g.controls.target.set(0, 2, 0);
    g.controls.update();
  });
  await settle();
  await shot('09-night-overview.png');

  /* 2 · 远香堂夜景（n1 中景可读 + 堂前两盏宫灯） */
  await page.evaluate(() => {
    const g = window.__garden;
    g.camera.position.set(0.5, 4.6, 8.5);
    g.controls.target.set(0, 4.0, -6.0);
    g.controls.update();
  });
  await settle();
  await shot('09-night-hall.png');

  /* 3 · 游廊灯笼特写（n2 实体化）：第一盏 (13.2, 2.30, -6.0)，
     从廊外斜下 45° 看 —— 腰鼓灯身 / 顶珠 / 吊绳 / 底结流苏 / 脚下石板光晕。 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.controls.minDistance = 0.1;
    g.camera.position.set(14.6, 1.75, -4.9);
    g.controls.target.set(13.2, 2.05, -6.0);
    g.controls.update();
  });
  await settle();
  await shot('09-lantern-closeup.png');

  /* 4 · 堂前灯笼特写（n2）：远香堂檐下 (-6.2, 4.85, -7.1)，从池侧远望抬角 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.controls.minDistance = 0.1;
    g.camera.position.set(-11.5, 3.4, 2.5);
    g.controls.target.set(-6.2, 4.6, -7.1);
    g.controls.update();
  });
  await settle();
  await shot('09-lantern-hall.png');

  /* 5 · 雨天池面（n3）：正午暴雨，俯视池面 —— 雨痕应成片散布而非孤圈 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('weather', 'storm'); g.setEnv('season', 'summer');
    g.controls.minDistance = 0.1;
    g.camera.position.set(0.5, 26, 4.5);
    g.controls.target.set(0, 0, 3);
    g.controls.update();
  });
  await settle();
  await new Promise(r => setTimeout(r, 3500));   // 等涟漪累积（单圈寿命 1.9s）
  await shot('09-rain-ripples.png');

  /* 6 · 夜暴雨（n3 夜间不跳过）：墨水上雨痕 + 灯笼暖光，气氛点 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'night'); g.setEnv('weather', 'storm');
    g.controls.minDistance = 0.1;
    g.camera.position.set(14, 9, -2);
    g.controls.target.set(4, 2, -2);
    g.controls.update();
  });
  await settle();
  await new Promise(r => setTimeout(r, 3500));
  await shot('09-night-rain.png');

  /* 7 · 日间灯笼（n2 白天形体）：无光晕干扰，检验几何剪影 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
    g.controls.minDistance = 0.1;
    g.camera.position.set(14.6, 1.75, -4.9);
    g.controls.target.set(13.2, 2.05, -6.0);
    g.controls.update();
  });
  await settle();
  await shot('09-lantern-day.png');

  console.log('\n[样张] 输出目录 outputs/visual/');
  try { await browser.close(); } catch {}
  server.close();
})().catch(e => { console.error('样张探针异常：', e); process.exit(1); });
