// 资产贴图 A/B 对照探针：把相机分别对准四个 GLB 资产各拍一张。
// 用法: node probe/asset-shots.mjs [outDir]
// 用途：P1-3 贴图重编码（PNG→JPEG）前后各跑一次，肉眼比对细节与压缩痕迹。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const OUT = path.resolve(ARGS[0] || path.join(ROOT, 'outputs', 'asset-shots'));

function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
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

/* 每张的机位：由包围盒中心 + 距离反算，保证"资产占画面主体" */
const SHOTS = [
  { name: 'koi.png',    find: 'KoiFish',     dist: 2.4, elev: 0.9 },
  { name: 'turtle.png', find: 'Turtle',      dist: 1.6, elev: 0.8 },
  { name: 'banana.png', find: 'BananaPlant', dist: 4.2, elev: 1.6 },
  { name: 'lotus.png',  find: 'LotusPlant',  dist: 3.0, elev: 1.4 },
];

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__garden && window.__garden.ENV, { timeout: 90000 });
  await page.waitForFunction(() => {
    const seen = { KoiFish: 0, Turtle: 0, BananaPlant: 0, LotusPlant: 0 };
    window.__garden.scene.traverse(o => { for (const k of Object.keys(seen)) if (o.name && o.name.includes(k)) seen[k]++; });
    return Object.values(seen).every(n => n > 0);
  }, { timeout: 90000 });
  await page.evaluate(() => {
    const g = window.__garden;
    for (const id of ['env', 'hud', 'stats']){ const el = document.getElementById(id); if (el) el.style.display = 'none'; }
    g.scene.traverse(o => {
      if (o.isDirectionalLight && o.castShadow){
        o.shadow.mapSize.set(1024, 1024);
        if (o.shadow.map){ o.shadow.map.dispose(); o.shadow.map = null; }
      }
    });
    if (g.composer){
      g.composer.passes = g.composer.passes.filter(p => !(p.constructor && p.constructor.name === 'GTAOPass'));
      g.composer.setPixelRatio(1); g.composer.setSize(innerWidth, innerHeight);
    }
    g.renderer.setPixelRatio(1); g.renderer.setSize(innerWidth, innerHeight);
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});

  for (const s of SHOTS){
    const found = await page.evaluate((cfg) => {
      const g = window.__garden, T = g.THREE;
      let target = null;
      g.scene.traverse(o => { if (!target && o.name && o.name.includes(cfg.find) && o.isMesh) target = o; });
      if (!target) return false;
      const box = new T.Box3().setFromObject(target);
      const c = box.getCenter(new T.Vector3());
      const size = box.getSize(new T.Vector3());
      const r = Math.max(size.x, size.y, size.z) * 0.5;
      const fov = 34;
      const dist = Math.max(cfg.dist, (r * 1.25) / Math.tan(fov * Math.PI / 360) + r);
      g.camera.fov = fov; g.camera.updateProjectionMatrix();
      g.camera.position.set(c.x + dist * 0.72, c.y + cfg.elev, c.z + dist * 0.72);
      g.controls.target.copy(c);
      g.controls.update();
      return { name: target.name, c: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], dist: +dist.toFixed(2) };
    }, s);
    if (!found){ console.log('  x 未找到 ' + s.find); continue; }
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(OUT, s.name) });
    console.log('  ok ' + s.name + ' <- ' + found.name + ' 中心 ' + JSON.stringify(found.c) + ' 距离 ' + found.dist);
  }
  console.log(errs.length ? '[页面报错] ' + errs.slice(0, 5).join(' | ') : '[页面报错] 无');
  await browser.close();
  server.close();
})().catch(e => { console.error('[asset-shots] 异常：', e); process.exit(1); });