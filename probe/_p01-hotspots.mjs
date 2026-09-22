// 只读诊断：draw calls 的热点构成。**不改任何东西**。
// 目的：把 "800+ calls / 345 meshes" 拆成可归因的桶，避免照着估计开工。
// 用法: node probe/_p01-hotspots.mjs
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

const PORT_VIEW = { width: 900, height: 600 };

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: PORT_VIEW });
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    undefined, { timeout: 60000 }).catch(() => {});
  // 延迟链收尾后再采（与 smoke 的 4s 口径一致）
  await page.waitForTimeout(6000);

  const dump = await page.evaluate(() => {
    const g = window.__garden, r = g.renderer;
    const rows = new Map();          // key -> { n, cast, tri }
    let meshes = 0, inst = 0, visibleMeshes = 0, shadowCasters = 0, tris = 0;
    g.scene.traverse(o => {
      const isInst = o.isInstancedMesh;
      if (!o.isMesh) return;
      if (isInst) inst++; else meshes++;
      if (isInst) return;
      const matName = (o.material && (o.material.name || o.material.type)) || '?';
      const key = (o.name || '(anon)') + '  @' + matName;
      const ginfo = o.geometry && o.geometry.index ? {} : {};
      const tri = o.geometry
        ? Math.round((o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position?.count || 0)) / 3)
        : 0;
      if (!rows.has(key)) rows.set(key, { n: 0, cast: 0, vis: 0, tri: 0 });
      const e = rows.get(key);
      e.n++; e.tri += tri;
      if (o.castShadow) { e.cast++; shadowCasters++; }
      if (o.visible) e.vis++;
    });
    const list = [...rows.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.n - a.n);
    return {
      calls: r.info.render.calls, tris: r.info.render.triangles,
      geos: r.info.memory.geometries, tex: r.info.memory.textures,
      meshes, inst, shadowCasters,
      shadowAutoUpdate: r.shadowMap.autoUpdate, shadowNeedsUpdate: r.shadowMap.needsUpdate,
      shadowEnabled: r.shadowMap.enabled,
      groups: list.length,
      list: list.slice(0, 45),
      castList: list.filter(v => v.cast > 0).sort((a, b) => b.cast - a.cast).slice(0, 25),
    };
  });

  console.log(`calls=${dump.calls} tris=${dump.tris.toLocaleString()} meshes=${dump.meshes} inst=${dump.inst} geos=${dump.geos} tex=${dump.tex}`);
  console.log(`shadowMap enabled=${dump.shadowEnabled} autoUpdate=${dump.shadowAutoUpdate} needsUpdate=${dump.shadowNeedsUpdate}`);
  console.log(`阴影投射体 = ${dump.shadowCasters} 个（每个多一次 draw）`);
  console.log(`\n--- 网格按 名字@材质 分组（前 45 组）---`);
  for (const v of dump.list)
    console.log(`  ${String(v.n).padStart(4)} 个 × ${String(v.tri).padStart(6)} tri  cast=${String(v.cast).padStart(3)}  ${v.k}`);
  console.log(`\n--- 有投影的组（前 25）---`);
  for (const v of dump.castList) console.log(`  cast=${String(v.cast).padStart(4)} / n=${String(v.n).padStart(4)}  ${v.k}`);

  await browser.close();
  server.close();
})().catch(e => { console.error('[probe] 异常：', e); process.exit(1); });
