// _tmp-tour-visual.mjs —— 【临时】巡游中段截图（给人看观感用）。
// 2026-10-13 · 单：node probe/_tmp-tour-visual.mjs
//
// 纪律：
//   · 只截图 + 量落位距离，不改任何被测代码。
//   · 环境与 volumetric-fog-guard / _tmp-fog-visual 同一组（noon/summer/clear）。
//   · 落位距离：读 camera.position 与 controls.target 的真实距离，
//     与 VIEWPOINTS 里该机位 pos→target 的应有距离比对 ⇒ 证明没被 controls.update() 推回 9m。
//   · 截图用 page.screenshot（走合成器，不依赖 preserveDrawingBuffer）。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;
const OUT = path.join(ROOT, 'outputs', 'visual');

const loadPlaywright = () => {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  throw new Error('playwright 不可用');
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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
  fs.mkdirSync(OUT, { recursive: true });
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));

  console.log(`[_tmp-tour-visual] http://127.0.0.1:${port}/index.html  ${W}x${H}`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });

  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
    g.controls.enabled = false; g.controls.enableDamping = false;
    g.controls.minDistance = 0.4; g.controls.maxDistance = 400;
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000, polling: 200 });
  await sleep(1200);

  /* ── 落位实测：每个机位 gotoViewpoint → 等飞行落定 → 量真实距离 ── */
  const ids = await page.evaluate(() => window.__garden.VIEWPOINTS.map(v => v.id));
  const landings = [];
  for (const id of ids) {
    const r = await page.evaluate(async (vid) => {
      const g = window.__garden;
      const v = g.VIEWPOINTS.find(x => x.id === vid);
      g.gotoViewpoint(vid, 1.4, 'probe');
      const want = g.camera.position.distanceTo(v.target);
      return { want: +want.toFixed(2), minDist: v.minDist || null };
    }, id);
    /* 等飞行落定：CAM_FLY.on 熄灭（探针侧直读 __garden.camFly()） */
    await page.waitForFunction(() => window.__garden && !window.__garden.camFly(),
      null, { timeout: 60000, polling: 100 });
    await sleep(200);
    const got = await page.evaluate(() => {
      const g = window.__garden;
      return { dist: +g.camera.position.distanceTo(g.controls.target).toFixed(2),
               minDistNow: g.controls.minDistance };
    });
    landings.push({ id, want: r.want, got: got.dist, minDist: r.minDist, minDistNow: got.minDistNow });
    console.log(`  落位 ${id.padEnd(11)} 应=${r.want}m 实=${got.dist}m minDist=${r.minDist}→${got.minDistNow}`);
  }

  /* ── 巡游中段截图：tourStart → 等第 2 站（idx=1，题名石近观）落定 → 截 ── */
  await page.evaluate(() => { window.__garden.tourStop(); window.__garden.tourStart(); });
  await page.waitForFunction(() => window.__garden.tourState().idx === 1 && !window.__garden.camFly(),
    null, { timeout: 60000, polling: 100 });
  await sleep(1800);
  const st = await page.evaluate(() => ({
    tour: window.__garden.tourState(),
    cap: window.__garden.tourCaption(),
    dist: +window.__garden.camera.position.distanceTo(window.__garden.controls.target).toFixed(2),
    vp: window.__garden.VIEWPOINTS[window.__garden.tourState().idx % window.__garden.VIEWPOINTS.length].id,
  }));
  const png = path.join(OUT, 'tour-mid.png');
  await page.screenshot({ path: png });
  console.log(`\n巡游中段截图：idx=${st.tour.idx} 机位=${st.vp} 字幕="${st.cap}" 落位=${st.dist}m`);
  console.log(`  → ${png}`);

  await browser.close(); server.close();
  console.log(`\npageerror: ${errors.length} 条`);
  if (errors.length) errors.slice(0, 5).forEach(e => console.log('   ! ' + e));
  process.exit(0);
})().catch(e => { console.error('[_tmp-tour-visual] 崩溃:', e); process.exit(2); });
