// 只读诊断：识别"无名网格"的归属（父组链 + 材质 + 世界坐标簇）。
// 用法: node probe/_p01-anon.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  return require('playwright');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);

  const out = await page.evaluate(() => {
    const g = window.__garden, THREE = g.THREE;
    g.scene.updateMatrixWorld(true);
    const anon = [], named = [];
    g.scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const p = new THREE.Vector3(); o.getWorldPosition(p);
      const rec = {
        n: o.name || '', tri: o.geometry
          ? Math.round((o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position?.count || 0)) / 3) : 0,
        mat: o.material && (o.material.name || o.material.type) || '?',
        noMerge: !!o.userData.noMerge,
        x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
        chain: (() => { const c = []; let q = o.parent; while (q && c.length < 4){ c.push(q.name || q.type); q = q.parent; } return c.join(' < '); })(),
        geoParams: o.geometry && o.geometry.parameters
          ? JSON.stringify(o.geometry.parameters).slice(0, 120) : (o.geometry ? o.geometry.type : '?'),
      };
      (o.name ? named : anon).push(rec);
    });
    // 匿名网格聚合：按 材质 + geoParams 分组
    const m = new Map();
    for (const a of anon){
      const k = a.mat + '  ||  ' + a.geoParams;
      if (!m.has(k)) m.set(k, { n: 0, tri: 0, chain: a.chain, noMerge: a.noMerge, x: [], z: [] });
      const e = m.get(k); e.n++; e.tri += a.tri;
      if (e.x.length < 6) { e.x.push(a.x); e.z.push(a.z); }
    }
    return {
      anonTotal: anon.length, namedTotal: named.length,
      groups: [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.n - a.n),
      namedNoMerge: named.filter(r => r.noMerge).length,
    };
  });

  console.log(`无名网格 ${out.anonTotal} 个 / 有名网格 ${out.namedTotal} 个（其中 noMerge 的有名网格 ${out.namedNoMerge}）`);
  console.log('\n--- 无名网格按 材质+几何参数 分组 ---');
  for (const v of out.groups){
    console.log(`\n  ${v.n} 个 × ${v.tri} tri   noMerge=${v.noMerge}   chain=${v.chain}`);
    console.log(`     ${v.k}`);
    console.log(`     x样本=[${v.x.join(', ')}]  z样本=[${v.z.join(', ')}]`);
  }
  await browser.close();
  server.close();
})().catch(e => { console.error('[probe] 异常：', e); process.exit(1); });
