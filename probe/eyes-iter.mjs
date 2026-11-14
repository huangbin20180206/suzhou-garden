/* 视觉迭代探针：拍四个标准状态的样张（默认机位 + 指定特写机位）。
 * 用法：node probe/eyes-iter.mjs [标签]
 * 输出：outputs/_diag/eyes-iter/<标签>-{A,S,R,N}.png
 * 状态口径与 eyes-2026-10-27b 走查一致：A=夏·晴·午 / S=冬·雪·午 / R=暮·雨后初晴 / N=夏·夜·晴。
 * 过渡完成后再多等 1.2s（QOS/自适应反射稳定），保证样张是"稳态画面"。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG = process.argv[2] || 'x';
const OUT = path.join(ROOT, 'outputs', '_diag', 'eyes-iter');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });
  await sleep(2000);

  const settle = async () => {
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 30000, polling: 200 });
    await sleep(2200);                       // 自适应反射 settle + 阴影补渲
  };
  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`) });
    console.log(`  📷 ${TAG}-${name}.png`);
  };

  // A：夏·晴·午（默认）
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('season', 'summer'); g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
  });
  await settle(); await shot('A-default');
  /* 特写：对弈两人（用 scholarElbow/seatElbow 网格定位桌面，把相机拉到近前） */
  const chessShot = await page.evaluate(() => {
    const T = window.__garden;
    let target = null;
    T.scene.traverse(o => { if (o.name === 'seatElbow' && o.visible){ const p = new T.THREE.Vector3(); o.getWorldPosition(p); if (!target) target = p; } });
    if (!target) return null;
    return { x: target.x, y: target.y, z: target.z };
  });
  if (chessShot){
    await page.evaluate((t) => {
      const g = window.__garden;
      g.camera.position.set(t.x + 2.6, t.y + 1.4, t.z + 2.6);
      g.controls.target.set(t.x, t.y, t.z);
      g.controls.update();
    }, chessShot);
    await sleep(1500);
    await shot('chess-closeup');

  // 拉回默认机位继续后续状态
  await page.evaluate(() => { window.__garden.resetCamera(); });
  await sleep(1200);
  } else {
    console.log('  （未找到 seatElbow，跳过对弈特写）');
  }


  // S：冬·雪·午
  await page.evaluate(() => { window.__garden.setEnv('season', 'winter'); window.__garden.setEnv('weather', 'snow'); });
  await settle(); await shot('S-default');

  // R：暮·雨后初晴（彩虹口径）
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('season', 'summer'); g.setEnv('time', 'dusk'); g.setEnv('weather', 'afterrain');
  });
  await settle(); await shot('R-default');

  // N：夏·夜·晴
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'night'); g.setEnv('weather', 'clear');
  });
  await settle(); await shot('N-default');

  console.log(errs.length ? `✗ pageerror ${errs.length} 条: ${errs[0]}` : '✓ 全程零 pageerror');
  await browser.close();
  await new Promise(r => server.close(r));
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
