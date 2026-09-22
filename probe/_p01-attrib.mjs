// 只读诊断：把整帧 draw calls 归因到各 pass（阴影 / 平面反射 / GTAO / 主 pass），
// 并识别匿名网格的归属。**运行时临时开关，不改代码、不改画面。**
// 用法: node probe/_p01-attrib.mjs
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
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    undefined, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);

  // 建立运行时开关（只挂 hook，不动任何渲染参数）
  await page.evaluate(() => {
    const g = window.__garden, r = g.renderer;
    window.__T = {};
    // 找到 composer / water / gtao
    window.__T.water = null;
    g.scene.traverse(o => { if (o.name === 'waterSurface') window.__T.water = o; });
    window.__T.reflOriginal = window.__T.water ? window.__T.water.onBeforeRender : null;
    // 从 composer 里按构造名找 gtao / bloom
    const c = g.composer;
    window.__T.passes = c ? c.passes : [];
    window.__T.gtao = window.__T.passes.find(p => /GTAO/i.test(p.constructor.name)) || null;
    window.__T.bloom = window.__T.passes.find(p => /Bloom/i.test(p.constructor.name)) || null;
    // 采样器：等 3 帧后读 calls
    window.__T.sample = () => new Promise(res => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        res({ calls: r.info.render.calls, tris: r.info.render.triangles });
      })));
    });
  });

  const info = await page.evaluate(() => ({
    hasComposer: !!window.__garden.composer,
    gtao: !!window.__T.gtao, bloom: !!window.__T.bloom,
    water: !!window.__T.water,
    passes: window.__T.passes.map(p => p.constructor.name),
    shadowAuto: window.__garden.renderer.shadowMap.autoUpdate,
  }));
  console.log('[passes]', info.passes.join(' | '));
  console.log('[hooks] gtao=' + info.gtao + ' bloom=' + info.bloom + ' water=' + info.water + ' shadowAutoUpdate=' + info.shadowAuto);

  const sample = async (label, mutate) => {
    if (mutate) await page.evaluate(mutate);
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => window.__T.sample());
    console.log(`  ${label.padEnd(34)} calls=${String(s.calls).padStart(5)}  tris=${s.tris.toLocaleString()}`);
    return s.calls;
  };

  console.log('\n--- pass 归因（480×640，与 smoke 同口径）---');
  const base = await sample('① 现状（全开）', null);
  const noRefl = await sample('② 关平面反射', () => { window.__T.water.onBeforeRender = () => {}; });
  const noGtao = await sample('③ 再关 GTAO', () => { if (window.__T.gtao) window.__T.gtao.enabled = false; });
  const noBloom = await sample('④ 再关 Bloom', () => { if (window.__T.bloom) window.__T.bloom.enabled = false; });
  const noShadow = await sample('⑤ 再关阴影贴图', () => { window.__garden.renderer.shadowMap.autoUpdate = false; window.__garden.renderer.shadowMap.needsUpdate = false; });
  await sample('⑥ 恢复全开', () => {
    if (!window.__NO_KEEP) {
      window.__T.water.onBeforeRender = window.__T.reflOriginal;
      if (window.__T.gtao) window.__T.gtao.enabled = true;
      if (window.__T.bloom) window.__T.bloom.enabled = true;
    }
  });

  console.log('\n--- 归因结论 ---');
  console.log(`  阴影贴图 pass  ≈ ${noBloom - noShadow} calls`);
  console.log(`  平面反射 pass  ≈ ${base - noRefl} calls`);
  console.log(`  GTAO pass      ≈ ${noRefl - noGtao} calls`);
  console.log(`  Bloom 等全屏   ≈ ${noGtao - noBloom} calls`);
  console.log(`  主 RenderPass  ≈ ${noShadow} calls`);

  // 匿名网格归属
  const anon = await page.evaluate(() => {
    const out = [];
    window.__garden.scene.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.name) return;
      const chain = [];
      let p = o.parent;
      while (p && chain.length < 5){ chain.push(p.name || p.type); p = p.parent; }
      const tri = o.geometry
        ? Math.round((o.geometry.index ? o.geometry.index.count : (o.geometry.attributes.position?.count || 0)) / 3) : 0;
      out.push({ chain: chain.join(' < '), tri });
    });
    const m = new Map();
    for (const a of out){ const k = a.chain; if (!m.has(k)) m.set(k, { n: 0, tri: 0 }); const e = m.get(k); e.n++; e.tri += a.tri; }
    return { total: out.length, list: [...m.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.n - a.n) };
  });
  console.log(`\n--- 匿名网格（无名）共 ${anon.total} 个，按父链分组 ---`);
  for (const v of anon.list) console.log(`  ${String(v.n).padStart(4)} 个 × ${String(v.tri).padStart(6)} tri   ${v.k}`);

  await browser.close();
  server.close();
})().catch(e => { console.error('[probe] 异常：', e); process.exit(1); });
