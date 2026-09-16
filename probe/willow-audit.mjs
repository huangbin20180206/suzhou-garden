// 柳树冠顶俯视闭合度审计 v2：俯视 Raycaster 逐实例求交（不依赖软渲染像素读取）
// 8 扇区 × 3 环带（内 0~0.5R / 中 0.5~0.72R / 外 0.72~1.0R，R=3.1m）+ 外环细分
// 用法: node probe/tmp-willow-top.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  page.on('pageerror', e => console.log('[pageerror]', String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 45000 });
  await page.evaluate(() => { window.__garden.ENV.dur = 0.25; });
  await page.evaluate(() => window.__garden.setEnv('season', 'summer'));
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 30000, polling: 250 }).catch(() => {});

  const stats = await page.evaluate(() => {
    const g = window.__garden, scene = g.scene;
    const TAU = Math.PI * 2;
    const groups = [];
    scene.traverse(o => { if (o.userData && o.userData.willowAudit) groups.push(o); });
    const results = [];

    for (const grp of groups){
      let curtain = null;
      grp.traverse(o => { if (o.isInstancedMesh && o.userData.seasonWillowLeaf) curtain = o; });
      if (!curtain) continue;
      const cx = grp.position.x, cz = grp.position.z;
      // 俯视 raycast：向上撒射线（Y 顶 → 向下）。Raycaster 对 InstancedMesh 逐实例求交。
      const raycaster = new g.THREE.Raycaster();
      const origin = new g.THREE.Vector3();
      const dir = new g.THREE.Vector3(0, -1, 0);
      const R = 3.1, N = 200;                    // 200x200 采样格，跨 [-3.2, 3.2]
      const step = (2 * 3.2) / N;
      const rings = [
        { key: 'inner', r0: 0,     r1: 0.50 },
        { key: 'mid',   r0: 0.50,  r1: 0.72 },
        { key: 'outer', r0: 0.72,  r1: 1.00 },
      ];
      const fineRings = [
        { key: 'o1', r0: 2.23, r1: 2.55 },
        { key: 'o2', r0: 2.55, r1: 2.85 },
        { key: 'o3', r0: 2.85, r1: 3.10 },
      ];
      const acc = {};
      for (const rg of rings) acc[rg.key] = { cells: new Array(8).fill(0), hit: new Array(8).fill(0) };
      const fine = {};
      for (const rg of fineRings) fine[rg.key] = { cells: 0, hit: 0 };
      let maxLeafR = 0;
      raycaster.far = 40;
      for (let py = 0; py < N; py++){
        for (let px = 0; px < N; px++){
          const x = cx - 3.2 + (px + 0.5) * step;
          const z = cz - 3.2 + (py + 0.5) * step;
          origin.set(x, 20, z);
          raycaster.set(origin, dir);
          const hits = raycaster.intersectObject(curtain, false);
          const hit = hits.length > 0;
          const rad = Math.hypot(x - cx, z - cz);
          if (rad > R) continue;
          if (hit && rad > maxLeafR) maxLeafR = rad;
          const sect = Math.floor(((Math.atan2(z - cz, x - cx) + TAU) % TAU) / (TAU / 8));
          for (const rg of rings){
            if (rad >= rg.r0 * R && rad < rg.r1 * R){
              acc[rg.key].cells[sect]++;
              if (hit) acc[rg.key].hit[sect]++;
            }
          }
          for (const rg of fineRings){
            if (rad >= rg.r0 && rad < rg.r1){
              fine[rg.key].cells++;
              if (hit) fine[rg.key].hit++;
            }
          }
        }
      }
      const band = {};
      for (const rg of rings){
        const cells = acc[rg.key].cells, hit = acc[rg.key].hit;
        const pcts = cells.map((c, i) => c ? 100 * hit[i] / c : 0);
        const mean = pcts.reduce((x, y) => x + y, 0) / 8;
        const spread = Math.max(...pcts) - Math.min(...pcts);
        band[rg.key] = { mean: +mean.toFixed(1), spread: +spread.toFixed(1) };
      }
      const finePct = {};
      for (const rg of fineRings){
        finePct[rg.key] = fine[rg.key].cells ? +(100 * fine[rg.key].hit / fine[rg.key].cells).toFixed(1) : 0;
      }
      results.push({ audit: grp.userData.willowAudit.total, band, fine: finePct, maxLeafR: +maxLeafR.toFixed(2) });
    }
    return groups.length ? results : null;
  });

  if (!stats) { console.log('未找到柳树组'); await browser.close(); server.close(); process.exit(1); }
  const avg = { inner: 0, mid: 0, outer: 0, spread: { inner: 0, mid: 0, outer: 0 } };
  stats.forEach((s, i) => {
    console.log(`树${i}: 帘=${s.audit} 外=${s.band.outer.mean}%(极差${s.band.outer.spread}) 细分[2.23-2.55]=${s.fine.o1}% [2.55-2.85]=${s.fine.o2}% [2.85-3.1]=${s.fine.o3}% 最远叶=${s.maxLeafR}m`);
  });
  stats.forEach(s => {
    for (const k of ['inner', 'mid', 'outer']){
      avg[k] += s.band[k].mean / stats.length;
      avg.spread[k] += s.band[k].spread / stats.length;
    }
  });
  console.log(`AVG: 内=${avg.inner.toFixed(1)}% 中=${avg.mid.toFixed(1)}% 外=${avg.outer.toFixed(1)}% （扇区极差均值: 内${avg.spread.inner.toFixed(1)} 中${avg.spread.mid.toFixed(1)} 外${avg.spread.outer.toFixed(1)}）`);
  await browser.close();
  server.close();
})().catch(e => { console.error('探针异常:', e); process.exit(1); });
