// 蜻蜓"局部刚性合并"的**几何恒等核验**（确定性，不依赖风/相位/停点）。
//
// 为什么不用像素 A/B：停栖蜻蜓的落点每次加载都不同（实测 6 次加载拿到 6 个不同锚点 ——
// 停栖/起飞时长受仿真时间推进，加载耗时就足以让它换一朵花），于是两张同机位截图
// 拍的根本不是同一朵花。第一版像素 A/B 因此得出「噪声基线 45.2 / 实际差异 41.9 → 通过」
// 这种**假绿**：两边都被"完全不同构图"主导，测不到被测对象。
// 结论：画面里找不到**可复现**的落点时，像素差不是合格判据 —— 改成量几何本身。
//
// 判据（独立于被测代码，参数与推导写在下面，不是把 index.html 的实现照抄一遍）：
//   · 合并后身体三角形数 = 496
//       10 × CylinderGeometry(., ., ., radialSegments=7, heightSegments=1, openEnded=false)
//         = 10 × (侧 7×2 + 上下盖各 7) = 10 × 28 = 280
//       胸 SphereGeometry(0.017, 9, 7) 与头 SphereGeometry(0.0115, 9, 7)
//         = 各 (9×7 − 9×2) × 2 = 108   → 280 + 108 + 108 = 496
//   · 合并后复眼三角形数 = 216（2 × 108）
//   · 身体包围盒 z 跨度 ≈ 0.2231m：10 节腹部自 z=−0.026 递推到 −0.1772，半高 0.0081
//       → z ∈ [−0.1853, −0.0179]；头最远到 0.028 + 0.0115×0.85 = 0.0378
//     **这条是最关键的一条**：只要有一节的矩阵没烘进去（比如都留在原点），
//     z 跨度会塌到 0.06 以下 —— 静默错位，只有量包围盒才看得见。
// 用法: node probe/_p01-dragonfly-geomcheck.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'p01-dragonfly');
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

const EXPECT_BODY_TRI = 496, EXPECT_EYE_TRI = 216;
const EXPECT_Z = 0.2231, TOL_Z = 0.004;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    undefined, { timeout: 60000 });
  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());
  await page.waitForTimeout(1000);

  const G = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const t = o => o.geometry
      ? (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 : 0;
    const dfly = [];
    g.scene.traverse(o => {
      if (!(o.isGroup && o.userData && Array.isArray(o.userData.wings))) return;
      let meshes = 0, bodyTri = 0, eyeTri = 0, bodyBox = null, wingTri = 0;
      o.traverse(c => {
        if (!c.isMesh) return;
        meshes++;
        if (c.name === 'dragonflyBody'){
          bodyTri = t(c);
          c.geometry.computeBoundingBox();
          const b = new T.Box3().copy(c.geometry.boundingBox);
          bodyBox = { min: b.min.toArray().map(v => +v.toFixed(4)),
                      size: b.getSize(new T.Vector3()).toArray().map(v => +v.toFixed(4)) };
        } else if (c.name === 'dragonflyEye') eyeTri += t(c);
        else wingTri += t(c);
      });
      dfly.push({ meshes, wings: o.userData.wings.length, bodyTri, eyeTri, wingTri, bodyBox });
    });
    return dfly;
  });

  console.log(`\n[结构] ${G.length} 只蜻蜓`);
  for (const [i, d] of G.entries())
    console.log(`  #${i}  网格 ${d.meshes}（翅pivot ${d.wings}）｜ 身 ${d.bodyTri} tri ｜ 眼 ${d.eyeTri} tri ｜ 翅 ${d.wingTri} tri ｜ 身盒 ${JSON.stringify(d.bodyBox.size)}`);

  check('每只蜻蜓 6 个网格（身 1 + 眼 1 + 翅 4），不再是 18 个', G.length > 0 && G.every(d => d.meshes === 6),
    G.map(d => d.meshes).join('/'));
  check('四片翅膀仍各自独立（各自一个 pivot，逐帧写 rotation.z）', G.every(d => d.wings === 4));
  check(`合并后身体三角形数 = ${EXPECT_BODY_TRI}（10 节腹部 + 胸 + 头，一件不多一件不少）`,
    G.every(d => d.bodyTri === EXPECT_BODY_TRI), G.map(d => d.bodyTri).join('/'));
  check(`合并后复眼三角形数 = ${EXPECT_EYE_TRI}（两只，合进同一网格）`,
    G.every(d => d.eyeTri === EXPECT_EYE_TRI), G.map(d => d.eyeTri).join('/'));
  const zs = G.map(d => d.bodyBox.size[2]);
  check(`身体包围盒 z 跨度 ≈ ${EXPECT_Z}m（10 节腹部都烘在了各自的 z 上，没有塌回原点）`,
    zs.every(z => Math.abs(z - EXPECT_Z) < TOL_Z), zs.map(z => z.toFixed(4)).join('/'));
  check('身体包围盒 y 跨度 ≈ 0.0323m（胸/头/腹的最粗处都在）',
    G.every(d => Math.abs(d.bodyBox.size[1] - 0.0323) < 0.002),
    G.map(d => d.bodyBox.size[1].toFixed(4)).join('/'));
  check('身体包围盒 min.z 为负、max.z 为正（头在前、腹在后，方向没反）',
    G.every(d => d.bodyBox.min[2] < -0.15 && d.bodyBox.min[2] + d.bodyBox.size[2] > 0.03),
    G.map(d => d.bodyBox.min[2].toFixed(3) + '~' + (d.bodyBox.min[2] + d.bodyBox.size[2]).toFixed(3)).join(' '));
  check('页面零报错', errs.length === 0, errs.slice(0, 1).join(''));

  /* 一张"可复现落点"的近景样张：把落点显式钉到 perchingAnchors[20] 再架机位，
     否则每次加载停在不同花上，样张之间不可比（这正是像素 A/B 失败的原因）。
     ⚠️ 机位不能拍脑袋给偏移，有两个各自的坑：
     ① 蜻蜓停在荷叶/荷花上，四周全是同一层的叶盘，随便一个方向都可能"正好被另一片叶子挡住"，
        所以用 Raycaster 从候选机位向目标打射线，取第一个通视的；
     ② **机位必须在近裁剪面之外**：主相机 `near = 0.5`（为了 900m 的大场景），
        架到 0.33m 时整个蜻蜓落在近平面内侧被直接裁掉 —— 而 d.visible / 投影 NDC（z=−1.95）/
        包围球 / 三角形数**全部正常**，截图里就是"什么都没有"。
        近观样张的距离下限因此是 0.6m，这里取 0.70~0.95m。 */
  const shot = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const d = g.perchingDragonflies[0];
    const a = g.perchingAnchors[20];
    d.userData.perch.anchor = a;
    d.userData.perch.mode = 'perch';
    d.userData.perch.tPerch = 0; d.userData.perch.durPerch = 1e6;
    d.visible = true;
    /* 位置按运行时同一口径算出来（anchors 的 local × object.matrixWorld + PERCH_LIFT）——
       不能直接读 d.position：它要等下一帧 updatePerchingDragonflies 才会挪到新锚点。
       该口径已被 perch-dragonfly.mjs 验过与 d.position 一致（偏差 1e-4）。 */
    const p = new T.Vector3().copy(a.local).applyMatrix4(a.object.matrixWorld);
    p.y += g.PERCH_LIFT;
    const rc = new T.Raycaster();
    const cands = [];
    for (let i = 0; i < 12; i++){
      const ang = (i / 12) * Math.PI * 2;
      for (const [r, h] of [[0.75, 0.30], [0.85, 0.42], [0.70, 0.20]]){
        cands.push(new T.Vector3(p.x + Math.cos(ang) * r, p.y + h, p.z + Math.sin(ang) * r));
      }
    }
    let best = null;
    for (const c of cands){
      const dir = new T.Vector3().subVectors(p, c);
      const dist = dir.length(); dir.normalize();
      rc.set(c, dir);
      rc.near = 0.02; rc.far = dist - 0.05;
      const hits = rc.intersectObject(g.scene, true)
        .filter(h => h.object.isMesh && !d.getObjectById(h.object.id) && !d.children.includes(h.object));
      if (!hits.length){ best = { cam: c, dist: +dist.toFixed(3), clear: true }; break; }
    }
    if (!best) best = { cam: cands[0], dist: +cands[0].distanceTo(p).toFixed(3), clear: false };
    g.controls.minDistance = 0.05;
    g.camera.position.copy(best.cam);
    g.controls.target.copy(p);
    g.controls.update();
    return { kind: a.kind, inst: a.instanceId, at: p.toArray().map(v => +v.toFixed(2)),
             cam: best.cam.toArray().map(v => +v.toFixed(2)), dist: best.dist, clear: best.clear,
             near: g.camera.near };
  });
  await page.waitForTimeout(1500);
  /* 画面里到底有没有蜻蜓？—— 只截图靠眼睛看不出来"它在哪/为什么不在"。
     这里量四件事：运行时实际位置 vs 探针算出的锚点、投影到 NDC 的位置、
     合并网格自己的 visible / frustumCulled / 包围球是否正常。 */
  const diag = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const d = g.perchingDragonflies[0];
    const a = d.userData.perch.anchor;
    const want = new T.Vector3().copy(a.local).applyMatrix4(a.object.matrixWorld);
    want.y += g.PERCH_LIFT;
    const ndc = new T.Vector3().copy(d.position).project(g.camera);
    let body = null;
    d.traverse(o => { if (o.isMesh && o.name === 'dragonflyBody') body = o; });
    const bw = new T.Vector3(); body.getWorldPosition(bw);
    const bodyNdc = new T.Vector3().copy(bw).project(g.camera);
    return {
      dPos: d.position.toArray().map(v => +v.toFixed(3)),
      want: want.toArray().map(v => +v.toFixed(3)),
      drift: +d.position.distanceTo(want).toFixed(4),
      dVisible: d.visible, show: g.perchShow(),
      ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3), +ndc.z.toFixed(3)],
      bodyNdc: [+bodyNdc.x.toFixed(3), +bodyNdc.y.toFixed(3)],
      bodyVisible: body.visible, bodyCulled: body.frustumCulled,
      bsRadius: (() => { body.geometry.computeBoundingSphere();
        const s = body.geometry.boundingSphere; return [+s.center.x.toFixed(3), +s.center.y.toFixed(3), +s.center.z.toFixed(3), +s.radius.toFixed(4)]; })(),
      cam: g.camera.position.toArray().map(v => +v.toFixed(2)),
      tgt: g.controls.target.toArray().map(v => +v.toFixed(2)),
      camDist: +g.camera.position.distanceTo(g.controls.target).toFixed(3),
      fov: g.camera.fov, near: g.camera.near, far: g.camera.far,
    };
  });
  console.log('\n[就诊] ' + JSON.stringify(diag, null, 0));
  const f = path.join(OUT, 'geomcheck-closeup.png');
  await page.screenshot({ path: f });
  console.log(`\n  样张（落点固定为 anchors[20] ${shot.kind}#${shot.inst} @${JSON.stringify(shot.at)}，` +
              `机位 ${JSON.stringify(shot.cam)}，距 ${shot.dist}m，通视=${shot.clear}）`);
  console.log('  ▸ ' + path.relative(ROOT, f));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass === results.length ? '✓' : '✗'} ${pass}/${results.length} ${pass === results.length ? 'ALL PASS' : 'FAILED'}`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('[probe] 异常：', e); process.exit(1); });
