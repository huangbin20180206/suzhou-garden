// 临时测量探针（不注册 verify-all）：西假山细网格 0.2m —— 全部分层命中 + 默认机位可见性 + 东→西弧线净空
// 用法：node probe/_tmp-macaw-west2.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/webmanifest' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading') && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.evaluate(() => { const G = window.__garden; G.setEnv('season', 'summer'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 细网格：x -7.5..-5.5、z 13.2..15.2，步长 0.2
  const grid = [];
  for (let ix = 0; ix <= 10; ix++) for (let iz = 0; iz <= 10; iz++) grid.push([-7.5 + ix * 0.2, 13.2 + iz * 0.2]);

  const rows = await page.evaluate((pts) => {
    const G = window.__garden, THREE = G.THREE;
    const rc = new THREE.Raycaster();
    const underMacaw = (o) => { let p = o; while (p) { if (p.name && p.name.indexOf('Macaw') >= 0) return true; p = p.parent; } return false; };
    const valid = (o) => o.visible && !underMacaw(o) && !o.isPoints && !o.isLine && !o.isSprite;
    const cam = G.camera.position.clone();
    const out = [];
    for (const [x, z] of pts) {
      rc.set(new THREE.Vector3(x, 30, z), new THREE.Vector3(0, -1, 0));
      const hits = rc.intersectObjects(G.scene.children, true).filter(h => valid(h.object)).slice(0, 6);
      const layers = hits.map(h => ({ y: +h.point.y.toFixed(2), what: h.object.name || h.object.type }));
      if (!layers.length) { out.push({ x, z, layers: [], vis: null }); continue; }
      const top = layers[0];
      const tgt = new THREE.Vector3(x, top.y + 0.15, z);
      const dir = tgt.clone().sub(cam); const dist = dir.length(); dir.normalize();
      rc.set(cam, dir);
      const vhits = rc.intersectObjects(G.scene.children, true).filter(h => valid(h.object));
      const vis = vhits.length ? Math.abs(vhits[0].distance - dist) <= 0.5 : false;
      out.push({ x: +x.toFixed(2), z: +z.toFixed(2), layers, vis });
    }
    return out;
  }, grid);

  // 候选：顶层层高在 3.2~5.6（石面区间：地面~1.7 以上、石尖/树冠 6+ 以下）且默认机位可见
  const cands = rows.filter(r => r.layers.length && r.layers[0].y >= 3.2 && r.layers[0].y <= 5.6 && r.vis === true);
  // 平整度：四邻（0.2m）顶层层高差 ≤0.25
  const at = (x, z) => rows.find(r => Math.abs(r.x - x) < 0.01 && Math.abs(r.z - z) < 0.01);
  const flat = cands.filter(c => {
    const ns = [at(c.x + 0.2, c.z), at(c.x - 0.2, c.z), at(c.x, c.z + 0.2), at(c.x, c.z - 0.2)];
    return ns.every(n => n && n.layers.length && Math.abs(n.layers[0].y - c.layers[0].y) <= 0.25);
  });

  // 东→各候选的弧线净空（只查巡航段 v∈[0.06,0.94]）：鸟点上方 0.3m 与下方 0.3m 不得有命中
  const EAST = [9.2, 6.20, 15.7];
  const arc = await page.evaluate(({ cands: cs, EAST: E }) => {
    const G = window.__garden, THREE = G.THREE;
    const rc = new THREE.Raycaster();
    const underMacaw = (o) => { let p = o; while (p) { if (p.name && p.name.indexOf('Macaw') >= 0) return true; p = p.parent; } return false; };
    const valid = (o) => o.visible && !underMacaw(o) && !o.isPoints && !o.isLine && !o.isSprite;
    const MACAW_LIFT = 2.4, MACAW_CRUISE = 1.6, MACAW_FLY_DUR = 1.4;
    const res = [];
    for (const c of cs) {
      const p0 = { x: E[0], y: E[1], z: E[2] }, p3 = { x: c.x, y: c.layers[0].y, z: c.z };
      const h0 = p0.y + MACAW_LIFT, h3 = p3.y + MACAW_LIFT * 0.6;
      const yMid = Math.max(h0, h3) + MACAW_CRUISE;
      let bad = [];
      for (let k = 0; k <= 40; k++) {
        const u = 0.06 + (0.88 * k) / 40, v = u * u * (3 - 2 * u);
        const x = p0.x + (p3.x - p0.x) * v, z = p0.z + (p3.z - p0.z) * v;
        const y = (1 - v) * (1 - v) * h0 + 2 * (1 - v) * v * yMid + v * v * h3;
        rc.set(new THREE.Vector3(x, y + 0.3, z), new THREE.Vector3(0, -1, 0));
        const dh = rc.intersectObjects(G.scene.children, true).filter(h => valid(h.object));
        if (dh.length && dh[0].distance < 0.3) bad.push(`下${k}:${dh[0].distance.toFixed(2)}@${dh[0].point.y.toFixed(1)}`);
        rc.set(new THREE.Vector3(x, y - 0.3, z), new THREE.Vector3(0, 1, 0));
        const uh = rc.intersectObjects(G.scene.children, true).filter(h => valid(h.object));
        if (uh.length && uh[0].distance < 0.3) bad.push(`上${k}:${uh[0].distance.toFixed(2)}@${uh[0].point.y.toFixed(1)}`);
      }
      res.push({ x: c.x, z: c.z, y: c.layers[0].y, flat: true, bad: bad.slice(0, 4), nbad: bad.length });
    }
    return res;
  }, { cands, EAST });

  console.log('=== 候选（顶层层高 3.2~5.6 且默认机位可见）===');
  for (const c of cands) console.log(`(${c.x},${c.layers[0].y},${c.z}) vis=${c.vis} 层=${JSON.stringify(c.layers.slice(0,3))}`);
  console.log('=== 其中平整的 ===');
  for (const c of flat) console.log(`(${c.x},${c.layers[0].y},${c.z})`);
  console.log('=== 东(9.2,6.20,15.7)→各候选 弧线净空 ===');
  for (const a of arc) console.log(`(${a.x},${a.y},${a.z}) 碰撞点=${a.nbad} ${a.bad.join(' ')}`);
  console.log('=== 零碰撞候选的邻域高度（0.2m 四邻）===');
  for (const a of arc.filter(x => x.nbad === 0)) {
    const c = cands.find(k => k.x === a.x && k.z === a.z);
    const ns = [at(c.x + 0.2, c.z), at(c.x - 0.2, c.z), at(c.x, c.z + 0.2), at(c.x, c.z - 0.2)];
    console.log(`(${a.x},${a.y},${a.z}) 邻=${ns.map(n => n && n.layers.length ? n.layers[0].y : '--').join('/')}`);
  }
  await browser.close(); server.close();
})().catch(e => { console.error('[west2-probe] 异常:', e); process.exit(2); });
