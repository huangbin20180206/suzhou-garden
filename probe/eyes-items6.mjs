/* 第六轮：到访期间常驻马夫是被收起的（15c 的 setGroomVisible），探针拍不到他。
   这里只对**探针**把 actor_groom.visible 锁死为 true（defineProperty 劫持 setter，
   不写回产品逻辑），再藏马与马车，拍正面/侧面/手里的草捆。
   用法：node probe/eyes-items6.mjs [标签] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG = process.argv[2] || 'x';
const OUT = path.join(ROOT, 'outputs', '_diag', 'eyes-items6');
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
  const page = await browser.newPage({ viewport: { width: 820, height: 800 } });
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
  await sleep(2000);

  const prep = await page.evaluate(() => {
    const g = window.__garden;
    let n = 0;
    g.scene.traverse(o => { if (o.userData && (o.userData.horse || o.userData.horseCart)){ o.visible = false; n++; } });
    const gm = g.scene.getObjectByName('actor_groom');
    if (gm){
      Object.defineProperty(gm, 'visible', { get: () => true, set: () => {}, configurable: true });
    }
    return { hid: n, groomFound: !!gm };
  });
  console.log('prep', JSON.stringify(prep));

  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, `${TAG}-${n}.png`) }); console.log('  📷', `${TAG}-${n}.png`); };
  const lookAt = async (ox, oy, oz, ax, ay, az, wait = 1300) => {
    await page.evaluate(([c, a]) => {
      const g = window.__garden;
      g.camera.position.set(c[0], c[1], c[2]); g.camera.lookAt(a[0], a[1], a[2]);
      g.camera.updateMatrixWorld(true); g.controls.target.set(a[0], a[1], a[2]); g.controls.update();
    }, [[ox, oy, oz], [ax, ay, az]]);
    await sleep(wait);
  };

  const c = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const o = g.scene.getObjectByName('actor_groom');
    if (!o) return null;
    const box = new T.Box3().setFromObject(o), ctr = box.getCenter(new T.Vector3());
    const a = g.actorState().actors.find(x => x.id === 'groom');
    return { center: ctr.toArray().map(v => +v.toFixed(2)), yaw: a ? a.yaw : 0 };
  });
  console.log('groom box', JSON.stringify(c));
  if (c){
    const [x, y, z] = c.center, yaw = c.yaw || 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), r = 1.45;
    await lookAt(x + fx * r, y + 0.25, z + fz * r, x, y, z);      await shot('front');
    await lookAt(x + fz * r, y + 0.25, z - fx * r, x, y, z);      await shot('side');
    await lookAt(x + fx * 1.0 + fz * 0.5, y + 0.2, z + fz * 1.0 - fx * 0.5, x, y, z); await shot('q34');
    await lookAt(x + fx * 0.85, y + 0.02, z + fz * 0.85, x, y - 0.06, z);             await shot('waist');
  }

  /* 等他拿草（hayHeld）后拍手部：这是第 1 项（草捆蓬松）的唯一直接证据 */
  let done = false;
  for (let i = 0; i < 900 && !done; i++){
    const a = await page.evaluate(() => {
      const g = window.__garden.actorState().actors.find(x => x.id === 'groom');
      return g ? { pos: g.pos, yaw: g.yaw, chore: g.chore, hay: g.hayHeld } : null;
    });
    if (a && a.hay){
      const [x, y, z] = a.pos, yaw = a.yaw || 0;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      await lookAt(x + fx * 0.75 + fz * 0.45, y + 1.06, z + fz * 0.75 - fx * 0.45, x + fx * 0.12, y + 0.98, z + fz * 0.12, 700);
      await shot('hay-1');
      await lookAt(x + fx * 0.55 + fz * 0.30, y + 1.02, z + fz * 0.55 - fx * 0.30, x + fx * 0.10, y + 0.96, z + fz * 0.10, 700);
      await shot('hay-2');
      console.log('  hay at chore', a.chore);
      done = true;
    }
    await sleep(150);
  }
  if (!done) console.log('（本轮没等到拿草窗口）');

  console.log(errs.length ? `✗ pageerror ${errs.length}: ${errs[0].slice(0, 160)}` : '✓ 零 pageerror');
  await browser.close();
  await new Promise(r => server.close(r));
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
