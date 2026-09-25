// 长曝光明信片门禁 + 样张（2026-09-21）。
//   断言：
//     ① 合成本身不炸、无 pageerror；
//     ② 合成期间把 uStarRot 临时抬起来、**结束后归零**（忘复位 = 日常星星天天转）；
//     ③ 长曝光 ≠ 单帧：拖尾（星移/萤火/水拉丝）会让画面像素分布明显变化。
//   样张：outputs/visual/lxp-*.png（长曝 vs 单帧对照）。
// usage: node probe/longexposure-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

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
const results = [];
const check = (label, ok, extra) => { results.push({ label, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 60000, polling: 200 }).then(() => true).catch(() => false);

  /* 夏·夜·晴：萤火 + 星野都该亮；机位推到池南灌丛看萤火群 + 头顶星空 */
  await page.evaluate(() => { const g = window.__garden; g.setEnv('time','night'); g.setEnv('season','summer'); g.setEnv('weather','clear'); });
  await settled(); await sleep(1500);
  await page.evaluate(() => {
    const g = window.__garden;
    g.controls.target.set(-5.5, 3, 11);
    g.camera.position.set(-14, 3.5, 19);
    g.camera.lookAt(g.controls.target); g.controls.update();
  });
  await sleep(1200);

  const cfg = await page.evaluate(() => window.__garden.lxpConfig());
  const fire = await page.evaluate(() => window.__garden.fireflyOpacity ? window.__garden.fireflyOpacity() : null);

  /* 单帧基线（普通明信片 dataURL） */
  const baseB64 = await page.evaluate(() => window.__garden.postcardData().split(',')[1]);
  /* 长曝光合成 */
  const lxpB64 = await page.evaluate(() => window.__garden.longExposureData().split(',')[1]);
  const starRotAfter = await page.evaluate(() => window.__garden.lxpStarRot());

  fs.writeFileSync(path.join(OUT, 'lxp-single.png'), Buffer.from(baseB64, 'base64'));
  fs.writeFileSync(path.join(OUT, 'lxp-long.png'), Buffer.from(lxpB64, 'base64'));

  check('长曝光帧配置合理（frames≥16 且 starDeg>0）',
    cfg.frames >= 16 && cfg.starDeg > 0, `frames=${cfg.frames} dt=${cfg.dt} starDeg=${cfg.starDeg}`);
  check('夏夜晴萤火应可见（uOpacity>0）', fire > 0, `uOpacity=${fire?.toFixed(3)}`);
  check('长曝结束 uStarRot 归零（否则日常星星天天转）', starRotAfter === 0, `uStarRot=${starRotAfter}`);

  /* 像素级差异：长曝光拖尾必须让画面明显不同于单帧 —— 用两图的像素分布差衡量 */
  const diff = await page.evaluate(([a, b]) => {
    const c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
    const g1 = c1.getContext('2d'), g2 = c2.getContext('2d');
    c1.width = c2.width = 320; c1.height = c2.height = 180;
    const i1 = new Image(), i2 = new Image();
    return new Promise(res => {
      i1.onload = i2.onload = () => {
        g1.drawImage(i1, 0, 0, 320, 180); g2.drawImage(i2, 0, 0, 320, 180);
        const d1 = g1.getImageData(0, 0, 320, 180).data;
        const d2 = g2.getImageData(0, 0, 320, 180).data;
        let changed = 0, n = 0, starChanged = 0, starN = 0;
        for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++){
          const k = (y * 320 + x) * 4;
          const l1 = 0.3*d1[k] + 0.59*d1[k+1] + 0.11*d1[k+2];
          const l2 = 0.3*d2[k] + 0.59*d2[k+1] + 0.11*d2[k+2];
          n++;
          if (Math.abs(l1 - l2) > 6){ changed++; if (y < 60){ starChanged++; } }
          if (y < 60) starN++;
        }
        res({ all: changed / n, star: starN ? starChanged / starN : 0 });
      };
      i1.src = 'data:image/png;base64,' + a;
      i2.src = 'data:image/png;base64,' + b;
    });
  }, [baseB64, lxpB64]);

  check('长曝光 ≠ 单帧：全图变化像素占比 > 2%', diff.all > 0.02, `变化 ${(diff.all*100).toFixed(1)}%`);
  check('星空区有拖尾痕迹（顶 1/3 变化 > 1%）', diff.star > 0.01, `天区变化 ${(diff.star*100).toFixed(1)}%`);

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[长曝] ${results.length - failed.length}/${results.length} 项通过 · 样张 ${OUT}/lxp-*.png`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[longexposure-guard] 崩溃:', e); process.exit(2); });