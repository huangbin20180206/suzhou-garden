/* 第二轮专项走查（2026-10-28）：草捆近景 / 马夫正面（资产凸起）/ 对弈与主人肤色 / 鹦鹉飞行跟拍
   用法：node probe/eyes-items2.mjs [标签] → outputs/_diag/eyes-items2/<标签>-*.png */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG = process.argv[2] || 'x';
const OUT = path.join(ROOT, 'outputs', '_diag', 'eyes-items2');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=low`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 300000, polling: 300 });
  await page.evaluate(async () => { try { await window.__garden.bootDonePromise; } catch {} });
  await page.evaluate(() => { const e = document.getElementById('env'); if (e) e.style.display = 'none'; });
  await page.evaluate(() => { const g = window.__garden; g.setEnv('season', 'summer'); g.setEnv('time', 'noon'); g.setEnv('weather', 'clear'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000, polling: 200 }).catch(() => {});
  await sleep(2500);
  console.log('ready');

  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${TAG}-${n}.png`) }); console.log('  📷', `${TAG}-${n}.png`); };
  const look = async (cam, aim, wait = 1500) => {
    await page.evaluate(([c, a]) => {
      const g = window.__garden;
      g.camera.position.set(c[0], c[1], c[2]);
      g.camera.lookAt(a[0], a[1], a[2]);
      g.camera.updateMatrixWorld(true);
      g.controls.target.set(a[0], a[1], a[2]); g.controls.update();
    }, [cam, aim]);
    await sleep(wait);
  };

  const st = await page.evaluate(() => {
    const s = window.__garden.actorState();
    const one = id => s.actors.find(a => a.id === id) || null;
    return { groom: one('groom'), scholar: one('scholar') };
  });
  const g0 = st.groom;
  if (g0){
    const [x, y, z] = g0.pos;
    /* 他面朝西偏南（yaw −1.8）、马在东侧 ⇒ 从**南/东南**看，才既拍到他正面又不被马挡 */
    await look([x + 0.55, y + 1.30, z + 1.45], [x, y + 1.02, z]);
    await shot('A-groom-frontSE');
    await look([x + 1.25, y + 1.30, z + 0.55], [x, y + 1.02, z]);
    await shot('A-groom-sideE');
    /* 草捆：再近一档、对准手（约 0.95~1.1m） */
    await look([x + 0.40, y + 1.12, z + 0.85], [x - 0.12, y + 0.98, z - 0.05], 1300);
    await shot('A-hay-close');
    await look([x + 0.10, y + 1.05, z + 0.62], [x - 0.10, y + 0.98, z - 0.02], 1300);
    await shot('A-hay-tight');
    const hayState = await page.evaluate(() => window.__garden.actorState().actors.filter(a => a.id === 'groom')
      .map(a => ({ chore: a.chore, hayHeld: a.hayHeld }))[0]);
    console.log('groom chore', JSON.stringify(hayState));
  }

  const seat = await page.evaluate(() => {
    const T = window.__garden; let t = null;
    T.scene.traverse(o => { if (o.name === 'seatElbow' && o.visible && !t){ const p = new T.THREE.Vector3(); o.getWorldPosition(p); t = p.toArray(); } });
    return t;
  });
  if (seat){
    await look([seat[0] + 2.4, seat[1] + 1.1, seat[2] + 2.4], [seat[0], seat[1] + 0.25, seat[2]]);
    await shot('B-chess');
    await look([seat[0] + 1.5, seat[1] + 1.15, seat[2] + 1.5], [seat[0], seat[1] + 0.42, seat[2]], 1300);
    await shot('B-chess-tight');
  }

  const sc = st.scholar;
  if (sc){
    const [x, y, z] = sc.pos, yaw = sc.yaw || 0;
    await look([x + Math.sin(yaw) * 1.9, y + 1.45, z + Math.cos(yaw) * 1.9], [x, y + 1.38, z]);
    await shot('B-scholar');
  }

  /* 鹦鹉：轮询到某只进入巡航，就把机位架到它侧后方连拍两帧 */
  let captured = 0;
  for (let i = 0; i < 900 && captured < 2; i++){
    const fly = await page.evaluate(() => {
      const s = window.__garden.macawState();
      const f = s.find(m => (m.mode === 'cruise' || m.mode === 'takeoff') && m.visible);
      return f ? { pos: f.pos, mode: f.mode, wing: f.wing } : null;
    });
    if (fly && fly.pos){
      const [x, y, z] = fly.pos;
      await page.evaluate(([c, a]) => {
        const g = window.__garden;
        g.camera.position.set(c[0], c[1], c[2]);
        g.camera.lookAt(a[0], a[1], a[2]);
        g.camera.updateMatrixWorld(true); g.controls.target.set(a[0], a[1], a[2]); g.controls.update();
      }, [[x + 1.6, y + 0.5, z + 3.2], [x, y, z]]);
      await sleep(240);
      const w = await page.evaluate(() => window.__garden.macawState().map(m => m.wing));
      await shot('C-fly-' + captured);
      console.log('   wing@shot', JSON.stringify(w), 'mode', fly.mode);
      captured++;
      await sleep(400);
    } else {
      await sleep(400);
    }
  }
  if (!captured) console.log('（本轮没赶上飞行窗口）');

  console.log(errs.length ? `✗ pageerror ${errs.length}: ${errs[0].slice(0, 160)}` : '✓ 零 pageerror');
  await browser.close();
  await new Promise(r => server.close(r));
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
