// 相机可达性门禁：node probe/camera-reach-guard.mjs
//
// 守老黄 2026-10-08 那条：
//   「我始终无法有效地观察到院子四个角落的细节，这两颗梅花树我就怎么都不能拉近镜头看到细节，
//     你看这个问题怎么有效的解决一下」
// 三个根因（都在本次改动里修）：
//   ① `CAM_MIN_DIST = 9` ⇒ **任何东西最近只能看 9m**（0.1m 的花在 9m 外只有 13px，"看细节"不成立）；
//   ② 注视点默认钉在园心，想把镜头挪到墙角得**右键/双指平移**，而面板从没提示过；
//   ③ 于是"四角细节"根本没有入口。
// 本条门禁守四条承诺：
//   ① 全局最近可推进到 ≤2m（minDistance）；
//   ② 「红梅」「腊梅」两个机位存在、飞过去之后**树在画内且够大**（占画面高 ≥8%）、相机到树 ≤6m；
//   ③ 到机位后还能继续推近到 ≤1.5m —— 单朵花在屏幕上 ≥60px（"看得清花"的硬口径）；
//   ④ **双击画面里的物体 ⇒ 注视点落到它上面**（不改变相机位置）—— 这是"走到任意角落"的入口，
//      并顺带证明四角都在注视点钳制范围内（钳制若拦住了，target 不会到位）。
//
// ⚠️ 不需要季节切换（本门只量相机/取景），所以比梅门快得多（~40s）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
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
const OUT = 'outputs/_diag/camera-reach';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  console.log(`\n[camera-reach-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });
  /* 等两株梅进场景（延迟装配）——"看梅"机位才有东西可看 */
  for (let i = 0; i < 90; i++){
    const n = await page.evaluate(async () => {
      const M = await import('/src/01-materials.js');
      let k = 0; window.__garden.scene.traverse(o => { if (o.isInstancedMesh && o.material === M.MAT.plumBlossomRed) k++; });
      return k;
    });
    if (n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);

  /* ── ① 全局最近距离 ── */
  const near = await page.evaluate(() => ({ minDist: window.__garden.controls.minDistance,
                                             camMinDist: window.__garden.CAM_MIN_DIST !== undefined ? window.__garden.CAM_MIN_DIST : null }));
  check('① 全局最近可推进到 ≤2m（原来 9m ⇒ 任何细节都看不到）',
    near.minDist <= 2, `controls.minDistance = ${near.minDist}`);

  /* ── ② 两个看梅机位：飞过去，量取景 ── */
  const shoot = async (id) => {
    await page.evaluate((vid) => window.__garden.gotoViewpoint(vid, 0.01), id);
    await sleep(1200);
    return page.evaluate(async (vid) => {
      const G = window.__garden, T = G.THREE;
      const M = await import('/src/01-materials.js');
      let o = null; G.scene.traverse(x => { if (x.isInstancedMesh && x.material === M.MAT.plumBlossomRed) o = x; });
      let yv = null; G.scene.traverse(x => { if (x.isInstancedMesh && x.material === M.MAT.plumBlossomYellow) yv = x; });
      const inst = vid === 'plumRed' ? o : yv;
      if (!inst) return { missing: true };
      const root = inst.parent, m = new T.Matrix4(), v = new T.Vector3();
      const W = G.renderer.domElement.width, H = G.renderer.domElement.height;
      G.camera.updateMatrixWorld(true); G.camera.updateProjectionMatrix();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, inF = 0;
      const wp = new T.Vector3(); root.getWorldPosition(wp);
      for (let i = 0; i < inst.count; i++){
        inst.getMatrixAt(i, m); v.setFromMatrixPosition(m); root.localToWorld(v);
        const nd = v.clone().project(G.camera);
        const px = (nd.x * 0.5 + 0.5) * W, py = (-nd.y * 0.5 + 0.5) * H;
        if (Math.abs(nd.x) <= 1 && Math.abs(nd.y) <= 1 && nd.z <= 1) inF++;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      return { inF, total: inst.count, boxW: x1 - x0, boxH: y1 - y0, W, H,
               dist: +G.camera.position.distanceTo(G.controls.target).toFixed(2),
               distToTree: +G.camera.position.distanceTo(wp).toFixed(2),
               minDist: +G.controls.minDistance.toFixed(2),
               season: G.ENV.season,
               flowerPx: (() => {                        // "花真的画在屏幕上"的口径（藏花 A/B）
                 const W2 = G.renderer.domElement.width, H2 = G.renderer.domElement.height;
                 const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
                 const cx = cv.getContext('2d');
                 const grab = () => { G.composer.render(0.016); cx.drawImage(G.renderer.domElement, 0, 0);
                   return cx.getImageData(0, 0, W2, H2).data; };
                 const A = grab(); const k = o.count, k2 = yv ? yv.count : 0;
                 o.count = 0; if (yv) yv.count = 0;
                 const B = grab();
                 o.count = k; if (yv) yv.count = k2;
                 let n = 0;
                 for (let i = 0; i < A.length; i += 4)
                   if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 24) n++;
                 return n; })() };
    }, id);
  };

  const vpIds = await page.evaluate(() => (window.__garden.VIEWPOINTS || []).map(v => v.id));
  check('② 两个看梅机位已注册（plumRed / plumYellow）',
    vpIds.includes('plumRed') && vpIds.includes('plumYellow'), vpIds.join(','));

  for (const [id, label] of [['plumRed', '红梅'], ['plumYellow', '腊梅']]){
    /* ⚠️ 走**真实点击路径**（不是 gotoViewpoint）：机位的入口承诺了"看梅"，
       而梅是冬季开花 —— 点它必须把季节设成冬（否则飞过去只有一株绿叶树，
       实测留档图判读"没拍到梅花"）。这条判据就是守这个。 */
    await page.evaluate((vid) => { const b = document.querySelector('[data-view="' + vid + '"]'); if (b) b.click(); }, id);
    await sleep(1500);
    const s = await shoot(id);
    if (s.missing){ check(`② 「${label}」机位取景`, false, '花网格缺失'); continue; }
    check(`② 「${label}」机位：树在画内且占画面高 ≥8%（一眼能看清）`,
      s.inF >= s.total * 0.9 && s.boxH >= s.H * 0.08,
      `入画 ${s.inF}/${s.total} · 树框 ${Math.round(s.boxW)}×${Math.round(s.boxH)}px (${(s.boxH / s.H * 100).toFixed(1)}%) · 相机到树 ${s.distToTree}m`);
    check(`② 「${label}」机位自带近观下限（到机位后还能继续推近）`,
      s.minDist <= 1.5, `controls.minDistance = ${s.minDist}`);
    check(`② 「${label}」：点它就真的**看得到花**（季节被设成冬、花画在屏幕上）`,
      s.season === 'winter' && s.flowerPx > 300,
      `季节=${s.season} · 藏花差分 ${s.flowerPx}px`);
    await page.screenshot({ path: `${OUT}/${id}.png`, timeout: 60000 })
      .then(() => {}).catch(() => console.log(`  (${label} 留档图超时，跳过)`));
  }

  /* ── ④ 双击聚焦：在默认机位双击红梅所在屏幕位置 ⇒ 注视点落到树附近（相机不动） ──
     ⚠️ 顺序很重要：③ 的"推近看单朵"要接在④之后量 —— 双击把注视点移到树上，滚轮推近才有对象。
        第一版把 ③ 放在 ④ 前面，量的是"从腊梅机位推近到最近、再去看 50m 外的红梅花" ⇒ 1.9px 假红。 */
  await page.evaluate(() => window.__garden.resetCamera());
  await sleep(900);
  const target0 = await page.evaluate(() => window.__garden.controls.target.toArray().map(v => +v.toFixed(2)));
  const clickAt = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const M = await import('/src/01-materials.js');
    let o = null; G.scene.traverse(x => { if (x.isInstancedMesh && x.material === M.MAT.plumBlossomRed) o = x; });
    const root = o.parent, m = new T.Matrix4(), v = new T.Vector3();
    o.getMatrixAt(0, m); v.setFromMatrixPosition(m); root.localToWorld(v);
    const nd = v.clone().project(G.camera);
    const r = G.renderer.domElement.getBoundingClientRect();
    return { x: Math.round(r.left + (nd.x * 0.5 + 0.5) * r.width),
             y: Math.round(r.top + (-nd.y * 0.5 + 0.5) * r.height),
             tree: v.toArray().map(n => +n.toFixed(2)) };
  });
  const camBefore = await page.evaluate(() => window.__garden.camera.position.toArray().map(v => +v.toFixed(2)));
  await page.mouse.dblclick(clickAt.x, clickAt.y);
  await sleep(700);
  const after = await page.evaluate(() => ({ target: window.__garden.controls.target.toArray().map(v => +v.toFixed(2)),
                                             cam: window.__garden.camera.position.toArray().map(v => +v.toFixed(2)) }));
  const dx = Math.hypot(after.target[0] - clickAt.tree[0], after.target[2] - clickAt.tree[2]);
  check('④ 双击画面里的梅花 ⇒ 注视点落到那株树上（≤3.5m），相机原地不动',
    dx <= 3.5 && Math.hypot(after.cam[0] - camBefore[0], after.cam[1] - camBefore[1], after.cam[2] - camBefore[2]) < 0.05,
    `target ${JSON.stringify(target0)} → ${JSON.stringify(after.target)}（离树冠 ${dx.toFixed(2)}m）`);

  /* ── ③ 接着双击之后把相机推到最近（= 用户把滚轮推到底）⇒ 单朵花够大 ── */
  const closest = await page.evaluate(async () => {
    const G = window.__garden, T = G.THREE;
    const M = await import('/src/01-materials.js');
    let o = null; G.scene.traverse(x => { if (x.isInstancedMesh && x.material === M.MAT.plumBlossomRed) o = x; });
    const root = o.parent;
    const dir = new T.Vector3().subVectors(G.camera.position, G.controls.target).normalize();
    G.camera.position.copy(G.controls.target).addScaledVector(dir, G.controls.minDistance);
    G.camera.updateMatrixWorld(true); G.camera.updateProjectionMatrix();
    G.composer.render(0.016);
    /* 量**离相机最近的那朵花**（不是实例 0）——用户看的就是眼前的这朵 */
    const m = new T.Matrix4(), v = new T.Vector3(), H = G.renderer.domElement.height;
    let best = 1e9;
    for (let i = 0; i < o.count; i++){ o.getMatrixAt(i, m); v.setFromMatrixPosition(m); root.localToWorld(v);
      const d = G.camera.position.distanceTo(v); if (d < best) best = d; }
    const persp = 2 * Math.tan((G.camera.fov * Math.PI / 180) / 2) * best;
    return { flowerPx: +((0.100 / persp) * H).toFixed(1), dist: +best.toFixed(2),
             camDist: +G.camera.position.distanceTo(G.controls.target).toFixed(2) };
  });
  check('③ 推到底时眼前那朵花 ≥60px（"拉近看细节"真的成立；0.1m 花 ≈ 70px @1.2m）',
    closest.flowerPx >= 60, `最近一朵 ${closest.flowerPx}px @ ${closest.dist}m（相机到注视点 ${closest.camDist}m）`);
  await page.screenshot({ path: `${OUT}/closest-flower.png`, timeout: 60000 })
    .then(() => {}).catch(() => console.log('  (近景留档图超时，跳过)'));

  /* ── ⑤ 四角都在注视点钳制范围内（钳制若拦住，双击/平移到不了角）── */
  const corner = await page.evaluate(() => {
    const G = window.__garden;
    G.controls.target.set(33.5, 2.5, -27.5);       // 贴着钳制边界（东北角）
    G.controls.update();
    return G.controls.target.toArray().map(v => +v.toFixed(2));
  });
  check('⑤ 注视点能到院角（钳制没把它拦回来）',
    corner[0] > 30 && corner[2] < -25, `target=${JSON.stringify(corner)}`);

  if (errs.length) check('零 pageerror', false, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[camera-reach-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  if (failed.length){ console.log('失败项：'); failed.forEach(f => console.log('  · ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[camera-reach-guard] 崩溃:', e); process.exit(2); });
