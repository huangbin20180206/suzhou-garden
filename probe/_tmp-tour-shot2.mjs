// _tmp-tour-shot2.mjs —— 【临时】补一张巡游**新站**的中段截图（观鱼站，idx=2）。
// 2026-10-13 · 单：node probe/_tmp-tour-shot2.mjs
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
  try { return require("playwright"); } catch { /* 走全局 */ }
  const globalRoot = require("node:child_process").execSync("npm root -g", { encoding: "utf8" }).trim();
  return require(path.join(globalRoot, "playwright"));
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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
  console.log(`[_tmp-tour-shot2] http://127.0.0.1:${port}/index.html  ${W}x${H}`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), null, { timeout: 180000, polling: 300 });
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
    g.controls.enabled = false; g.controls.enableDamping = false;
    g.controls.minDistance = 0.4; g.controls.maxDistance = 400;
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000, polling: 200 });
  await sleep(1200);

  await page.evaluate(() => window.__garden.tourStart());
  /* 等第 3 站（idx=2 = koi，新站）落定 */
  await page.waitForFunction(() => window.__garden.tourState().idx === 2 && !window.__garden.camFly(), null, { timeout: 90000, polling: 100 });
  await sleep(1800);
  const st = await page.evaluate(() => ({
    tour: window.__garden.tourState(),
    cap: window.__garden.tourCaption(),
    dist: +window.__garden.camera.position.distanceTo(window.__garden.controls.target).toFixed(2),
    vp: window.__garden.VIEWPOINTS[window.__garden.tourState().idx % window.__garden.VIEWPOINTS.length].id,
  }));
  const png = path.join(OUT, 'tour-mid-new.png');
  await page.screenshot({ path: png });
  console.log(`\n巡游新站截图：idx=${st.tour.idx} 机位=${st.vp} 字幕="${st.cap}" 落位=${st.dist}m`);
  console.log(`  → ${png}`);
  await browser.close(); server.close();
  console.log(`pageerror: ${errors.length} 条`);
  process.exit(0);
})().catch(e => { console.error('[_tmp-tour-shot2] 崩溃:', e); process.exit(2); });
