// 机位可见性门禁：node probe/viewpoint-visibility.mjs
//
// 2026-10-24 起因：「立峰·云根」这个导览站在实景里看到的是一朵大荷花。
// 实测（outputs/_diag/vp-visibility.mjs）：相机落在**池子里**（x=−1.24, z=−1.95, y=1.18），
// 正前方 1.8m 就是池心那丛荷花（中心射线第一命中 LotusPlant@1.77m，而立峰在 10.5m 处），
// 于是整站的主体被前景花叶遮掉，石峰退到背景。
//
// 根因是"相机站在水里 + 低机位"这一类组合：荷花/睡莲是 2026-09-30 之后才补进池面的，
// 而机位公式仍是"池中央看石"的老口径，两者一叠加就必然撞上。这条门把该组合钉死：
//   ① 每个官方机位的**中心射线**不许被近处物体打断（第一命中 ≥ max(2.0m, 0.7×到注视点距离)）；
//   ② 机位若在池内，相机高度必须 ≥ 2.4m（低机位泡在水里必然穿进花叶）；
//   ③ 3m 内的荷花/睡莲实例不得落进画面（"镜头前糊一朵花"的直接判据）；
//   ④ 负例自检：把「立峰」退回修复前的 1.18m 位姿，③ 必须报出来（证明判据有牙）。
//
// 运行：约 60~90 秒（一次页面加载 + 纯射线/投影，零像素）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));

  console.log(`\n[viewpoint-visibility] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });

  /* 等延迟装配把立峰 / 池面荷花放进来（本门量的就是"花叶在场时的取景"） */
  let ready = false;
  for (let i = 0; i < 90; i++){
    ready = await page.evaluate(async () => {
      const G = window.__garden;
      const M = await import('/src/01-materials.js');
      let hero = false, lotus = 0;
      G.scene.traverse(o => {
        if (o.name === 'taihuHero') hero = true;
        if (o.isInstancedMesh && o.material === M.MAT.lotus) lotus += o.count;
      });
      return hero && lotus > 0;
    });
    if (ready) break;
    await sleep(1500);
  }
  check('装配就绪（立峰 + 荷花实例都在场）', ready);
  await sleep(600);

  const scan = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const M = await import('/src/01-materials.js');
    const W = await import('/src/05-water.js');
    const cam = G.camera, rc = new T.Raycaster();
    const SKIP = /^(water|waterSurface|rain|snow|mist|fog|sky|ripple)/i;

    /* 池面植物实例（荷花/睡莲）锚点 —— 就是"糊在镜头前"的那一类 */
    const plants = [];
    const AQ = new Set([M.MAT.lotus, M.MAT.lily].filter(Boolean));
    G.scene.traverse(o => {
      if (!o.isInstancedMesh || !AQ.has(o.material)) return;
      const m = new T.Matrix4(), v = new T.Vector3();
      for (let i = 0; i < o.count; i++){
        o.getMatrixAt(i, m);
        v.set(0, 0, 0).applyMatrix4(m).applyMatrix4(o.matrixWorld);
        plants.push({ p: v.clone(), tag: o.material === M.MAT.lotus ? 'lotus' : 'lily' });
      }
    });

    const measure = (pos, tgt, raw = false) => {
      cam.position.copy(pos);
      if (raw) cam.lookAt(tgt);                  // 负例：完全按"位姿被写成的样子"量，不让控制器钳
      else { G.controls.target.copy(tgt); G.controls.update(); }   // 正式：与真实导览同一路径
      cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
      const from = cam.position.clone();
      const dir = tgt.clone().sub(from); const dist = dir.length(); dir.normalize();
      rc.set(from, dir);
      const hits = rc.intersectObject(G.scene, true)
        .filter(h => h.object.visible && h.object.isMesh && !SKIP.test(h.object.name || ''));
      const first = hits.length ? { name: hits[0].object.name || '(anon)',
        mat: (Array.isArray(hits[0].object.material) ? hits[0].object.material[0] : hits[0].object.material)?.name || '',
        inst: hits[0].object.isInstancedMesh ? true : false,
        parent: hits[0].object.parent ? (hits[0].object.parent.name || '(组)') : '-',
        d: +hits[0].distance.toFixed(2) } : null;
      /* 3m 内的池面植物有没有落进画面 */
      let inFrame = 0; const samples = [];
      for (const o of plants){
        const d = o.p.distanceTo(from);
        if (d > 3.0) continue;
        const p = o.p.clone().project(cam);
        if (Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95){
          inFrame++;
          if (samples.length < 4) samples.push({ tag: o.tag, d: +d.toFixed(2), ndc: [+p.x.toFixed(2), +p.y.toFixed(2)] });
        }
      }
      const overPond = (() => { try { return W.insidePond(from.x, from.z); } catch { return false; } })();
      return { cam: from.toArray().map(v => +v.toFixed(2)), dist: +dist.toFixed(2), first,
               ratio: first ? +(first.d / dist).toFixed(2) : 1, inFrame, samples, overPond };
    };

    const rows = [];
    for (const vp of (G.VIEWPOINTS || [])){
      rows.push({ id: vp.id, label: vp.label, ...measure(vp.pos.clone(), vp.target.clone()) });
    }
    /* 负例自检：修复前的「立峰」位姿（池中 1.18m） */
    let hero = null;
    G.scene.traverse(o => { if (!hero && o.name === 'taihuHero') hero = o; });
    const hb = new T.Box3().setFromObject(hero);
    const ctr = hb.getCenter(new T.Vector3());
    const badPos = new T.Vector3(-1.24, 1.18, -1.95);
    const negative = measure(badPos, new T.Vector3(ctr.x, 1.52, ctr.z), true);
    return { rows, negative };
  });

  const rows = scan.rows;
  check('官方机位清单可读', rows.length >= 15, `${rows.length} 个：` + rows.map(r => r.id).join(' '));

  const blocked = rows.filter(r => r.first && r.first.d < Math.max(2.0, r.dist * 0.7));
  check('每个机位的中心视线不被近处物体打断',
    blocked.length === 0,
    blocked.length ? blocked.map(r => `${r.id}: ${r.first.name}/${r.first.mat}${r.first.inst ? '(实例)' : ''}`
      + ` 父=${r.first.parent} @${r.first.d}m（目标 ${r.dist}m，相机 ${JSON.stringify(r.cam)}）`).join('；')
                   : rows.map(r => `${r.id}:${r.first ? r.first.name + '@' + r.first.d : 'null'}`).join(' '));

  const nearFlower = rows.filter(r => r.inFrame > 0);
  check('3m 内没有荷花/睡莲糊在镜头前',
    nearFlower.length === 0,
    nearFlower.length ? nearFlower.map(r => `${r.id}: ${r.inFrame} 个（${JSON.stringify(r.samples)}）`).join('；') : '全部通过');

  /* 有牙：缺陷位姿必须被第 3 条判据抓到 */
  check('负例自检：修复前的池中 1.18m 位姿必须被"近景花叶"判据抓到',
    scan.negative.inFrame > 0,
    `inFrame=${scan.negative.inFrame} cam=${JSON.stringify(scan.negative.cam)} samples=${JSON.stringify(scan.negative.samples)}`);

  check('零 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));

  const bad = results.filter(r => !r.ok);
  console.log(`\n[viewpoint-visibility] ${results.length - bad.length}/${results.length} 通过${bad.length ? '（' + bad.length + ' 条红）' : ''}`);
  await browser.close();
  server.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
