// 题名石「云根」门禁（2026-09-18 重写）
//
// 为什么重写：老版本有两个致命方法缺陷，导致它**该红的时候是绿的**。
//  ① 判据不特异：中心区"暗于中位数 26"的像素占比，会被石头自身的棱面明暗 / 缝隙 / 投影
//     轻易满足 —— 实测刻字面根本没画出来时它也报 2.62%。
//  ② 采样位置在实景里：刻字面被立峰挡住、且"偏绿"这类色彩判据会被草地竹叶污染
//     （实测把石材材质 visible=false，绿仍占 12.9%），等于在噪声里找信号。
// 新版本改为三件事：
//  A. **净室**量可读性 —— 只留题名石、相机正对刻字面。此处几何/UV/贴图/材质有问题一目了然。
//  B. **视线**判定 —— 从机位射线到字心，检查第一个命中体是不是题名石自己、且看到的是正面。
//     ⚠️ 这条是关键：原来的 stone-audit 只查"刻字面法线朝向池心"的点积（facing > 0.7），
//     而题名石正好在立峰正后方 —— 法线完全朝向池心，视线却被立峰挡死，点积判据全绿。
//     2026-09-18 方案 A 后：改挂到新增的 `stele`（云根近观）机位做**硬判定**；
//     立峰机位那条按构图决策降为报告项（立峰做主景、题名石在其正后方属已知取舍）。
//  C. **接线**判定 —— gotoViewpoint 必须把机位自带的 minDist 交给 flyTo。
//     断链后果和视线缺陷一样是"静默"的：相机被夹回 9m，方位正确、行程走完、不报错。
// 用法: node probe/stele-legibility.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
/* 报告项：**不参与** pass/fail 汇总。只用于把"已实测确认、但修法属构图决策"的缺陷
   带数字摆出来，避免①把已知缺陷伪装成绿 ②让整条门禁因为待决策项长期飘红。
   ⚠️ 一旦构图方案定下，这一项必须改回 check()。 */
const reports = [];
const report = (name, ok, detail = '') => {
  reports.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ⚠'} [报告·不计入判定] ${name}${detail ? ' — ' + detail : ''}`);
};

/* 净室判据（实测：正对刻字面时跨度 96.2 / 暗像素 22.0%；字没画出来时跨度 ~44 / 暗像素 ~2.6%） */
const MIN_SPREAD = 60;
const MIN_INK = 8;
const DIST = 1.9;

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000 });

  /* 立峰/伴石/题名石在同一个延迟批 job 里。该 job 必须插队（deferBootFirst），
     否则排在一堆柳竹之后、软渲染下每 job 等一帧，要 165s 才装配 —— 探针窗口内看不到石头。 */
  const found = await page.waitForFunction(() => {
    let s = false; window.__garden.scene.traverse(o => { if (o.name === 'steleGroup') s = true; });
    return s;
  }, { timeout: 120000 }).then(() => true).catch(() => false);
  check('题名石已装配（延迟批插队生效，不该等到 160s+）', found, found ? '' : '120s 内未出现 → 延迟批被柳竹挤到队尾');
  if (!found){ await finish(); return; }

  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 180000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());
  await page.evaluate(() => {
    for (const id of ['env', 'hud', 'stats', 'caption']){
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    }
  });

  /* ── 结构断言（不依赖渲染）：刻字面靠"按材质排序后手动切 group"实现，
     addGroup(start, count) 的 start 与 count 必须**同为 index 项数**。曾经 start 存三角形序号、
     count 却乘了 3 → 刻字材质贴到中间 80 个随机三角形上（字被抹成一片），真正的刻字面
     [3k, 3N) 落在所有 group 之外**完全不被绘制**。不报错、不崩、画面里"明明有石头"。 */
  const grp = await page.evaluate(() => {
    let stele = null, slab = null;
    window.__garden.scene.traverse(o => { if (o.name === 'steleGroup') stele = o; });
    if (stele) stele.traverse(o => { if (o.geometry && !slab) slab = o; });
    if (!slab) return { ok: false, why: '未找到石片' };
    const geo = slab.geometry;
    const ic = geo.index ? geo.index.count : geo.attributes.position.count;
    const gs = geo.groups.slice().sort((a, b) => a.start - b.start);
    let cur = 0, gap = 0;
    for (const g of gs){ if (g.start !== cur) gap++; cur = g.start + g.count; }
    const faceG = gs.find(g => g.materialIndex === 1);
    return { ok: gap === 0 && cur === ic, n: gs.length, ic, gap, tail: ic - cur,
             face: faceG ? faceG.count / 3 : 0,
             listed: gs.map(g => `${g.start}+${g.count}#${g.materialIndex}`).join(' ') };
  });
  check('材质 group 无缝隙铺满 index 缓冲（刻字面确实被绘制）', grp.ok && grp.face > 0,
    grp.ok ? `${grp.n} 段（#0 石材 + #1 刻字面 ${grp.face} 三角形）铺满 ${grp.ic} index`
           : `有缝隙/缺口 — ${grp.listed || grp.why} (gap=${grp.gap} tail=${grp.tail} face=${grp.face})`);

  /* ── B. 视线判定：从机位射线到字心，第一个命中必须属于题名石且看到的是正面 ──
     这是"来人看得见"的**充分**判据 —— 法线朝向对不代表没被挡。
     2026-09-18 方案 A 落地后，判据从「立峰机位」**改挂到新增的 `stele`（云根近观）机位**：
       · 立峰机位那条按构图决策**保留为报告**（立峰做主景，题名石在它正后方被挡是已知取舍）；
       · 近观机位这条升为**硬判定** —— 它就是为"看得见字"而存在的，看不见就是缺陷。 */
  const los = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let stele = null, slab = null;
    g.scene.traverse(o => { if (o.name === 'steleGroup') stele = o; });
    stele.traverse(o => { if (o.geometry && !slab) slab = o; });
    const geo = slab.geometry, idx = geo.index, pos = geo.attributes.position, nrmA = geo.attributes.normal;
    const gf = geo.groups.find(x => x.materialIndex === 1);
    const cen = new T.Vector3(), nrm = new T.Vector3();
    for (let k = gf.start; k < gf.start + gf.count; k++){
      const vi = idx.getX(k);
      cen.add(new T.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
      nrm.add(new T.Vector3(nrmA.getX(vi), nrmA.getY(vi), nrmA.getZ(vi)));
    }
    cen.divideScalar(gf.count).applyMatrix4(slab.matrixWorld);
    nrm.divideScalar(gf.count).normalize()
       .applyQuaternion(stele.getWorldQuaternion(new T.Quaternion())).normalize();

    const shoot = (vp) => {
      const origin = new T.Vector3(vp.pos.x, vp.pos.y, vp.pos.z);
      const dir = cen.clone().sub(origin).normalize();
      const rc = new T.Raycaster(origin, dir, 0.01, 400);
      const hits = rc.intersectObject(g.scene, true)
                     .filter(h => h.object.isMesh || h.object.isInstancedMesh);
      const first = hits[0];
      let own = false, hitName = '(无)';
      if (first){
        hitName = first.object.name || first.object.type;
        for (let o = first.object; o; o = o.parent){ if (o === stele || o.name === 'steleGroup'){ own = true; break; } }
      }
      /* 还要确认是**正面**：视线与刻字面法线反向（dot<0）才说明看到的是刻字那一面，
         否则可能只是命中了石头背面（视线通、但字在另一侧）。 */
      const facing = +dir.dot(nrm).toFixed(3);
      return { ok: own && facing < -0.2, own, facing, hitName,
               dist: first ? +first.distance.toFixed(2) : -1,
               vpId: vp.id, vpPos: [+vp.pos.x.toFixed(2), +vp.pos.y.toFixed(2), +vp.pos.z.toFixed(2)],
               blockers: hits.slice(0, 3).map(h => (h.object.name || h.object.type) + '@' + h.distance.toFixed(2)) };
    };

    const vps = g.VIEWPOINTS || [];
    const vS = vps.find(v => v.id === 'stele');
    const vH = vps.find(v => v.id === 'hero') || vps[0];
    return {
      charCtr: [+cen.x.toFixed(2), +cen.y.toFixed(2), +cen.z.toFixed(2)],
      /* 近观机位是否带放开的最小半径下限（否则 2.8m 会被 controls.update() 弹回 9m） */
      steleMinDist: vS ? (vS.minDist == null ? null : vS.minDist) : undefined,
      steleDist: vS ? +vS.pos.distanceTo(vS.target).toFixed(2) : -1,
      stele: vS ? shoot(vS) : null,
      hero: vH ? shoot(vH) : null,
    };
  });
  const fmt = (r) => r.ok
    ? `首个命中=题名石，距离 ${r.dist}m，正面度 ${r.facing}（机位 ${r.vpId} ${r.vpPos}）`
    : (r.own ? `命中了题名石但看到的是**背面**（正面度 ${r.facing}，需 < -0.2）`
             : `被挡：首个命中 ${r.hitName} @ ${r.dist}m；拦在前面的 ${JSON.stringify(r.blockers)}`
               + ` ｜ 机位 ${r.vpId} ${r.vpPos} → 字心 ${JSON.stringify(los.charCtr)}`);

  check('「云根近观」机位存在、且带放开的最小半径下限（否则近观被 minDistance 弹回 9m）',
    !!los.stele && los.steleMinDist != null && los.steleMinDist < 9,
    los.stele ? `minDist=${los.steleMinDist}，机位到字心 ${los.steleDist}m`
              : 'VIEWPOINTS 里没有 id=stele 的机位');
  check('从「云根近观」机位看得见刻字面（视线无遮挡且是正面）',
    !!los.stele && los.stele.ok, los.stele ? fmt(los.stele) : '机位缺失，无从判定');
  report('从立峰机位看得见刻字面（构图决策：立峰做主景，题名石在其正后方原设计就被挡）',
    !!los.hero && los.hero.ok, los.hero ? fmt(los.hero) : '机位缺失');

  /* ── A. 净室可读性：只留题名石子树，相机正对刻字面 ── */
  const info = await page.evaluate((DIST) => {
    const g = window.__garden, T = g.THREE;
    let stele = null, slab = null;
    g.scene.traverse(o => { if (o.name === 'steleGroup') stele = o; });
    stele.traverse(o => { if (o.geometry && !slab) slab = o; });
    const keep = new Set(); stele.traverse(o => keep.add(o));
    let hidden = 0;
    g.scene.traverse(o => {
      if ((o.isMesh || o.isInstancedMesh || o.isPoints || o.isSprite || o.isLine) && !keep.has(o)){
        o.visible = false; hidden++;
      }
    });
    const geo = slab.geometry, idx = geo.index, pos = geo.attributes.position, nrmA = geo.attributes.normal;
    const gf = geo.groups.find(x => x.materialIndex === 1);
    const cen = new T.Vector3(), nrm = new T.Vector3();
    for (let k = gf.start; k < gf.start + gf.count; k++){
      const vi = idx.getX(k);
      cen.add(new T.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
      nrm.add(new T.Vector3(nrmA.getX(vi), nrmA.getY(vi), nrmA.getZ(vi)));
    }
    cen.divideScalar(gf.count); nrm.divideScalar(gf.count).normalize();
    const cenW = cen.clone().applyMatrix4(slab.matrixWorld);
    const nrmW = nrm.clone().applyQuaternion(stele.getWorldQuaternion(new T.Quaternion())).normalize();
    const eye = cenW.clone().add(nrmW.clone().multiplyScalar(DIST));
    g.controls.minDistance = 0.01; g.controls.maxDistance = 500;
    g.camera.position.copy(eye); g.controls.target.copy(cenW); g.controls.update();
    return { hidden, charCtr: [+cenW.x.toFixed(2), +cenW.y.toFixed(2), +cenW.z.toFixed(2)] };
  }, DIST);

  /* ⚠️ 软渲染下一帧要数秒：移完机位必须等**真实帧**再截图，否则拍到旧帧（会误判"看不见"）。 */
  await page.evaluate(() => new Promise(r => {
    let n = 0; const f = () => { if (++n >= 3) r(); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  const cam = await page.evaluate(() => {
    const g = window.__garden;
    return { pos: g.camera.position.toArray().map(v => +v.toFixed(2)), tgt: g.controls.target.toArray().map(v => +v.toFixed(2)) };
  });
  console.log(`  [净室] 隐去 ${info.hidden} 个网格；相机 ${cam.pos} → 字心 ${info.charCtr}`);
  const buf = await page.screenshot();

  const r = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const W = cv.width, H = cv.height;
    const d = cx.getImageData(0, 0, W, H).data;
    const lum = i => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const arr = [];
    for (let y = Math.floor(H * 0.3); y < Math.floor(H * 0.7); y += 2)
      for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.7); x += 2) arr.push(lum((y * W + x) * 4));
    const s = arr.slice().sort((a, b) => a - b);
    const q = k => s[Math.floor(k * (s.length - 1))];
    const p5 = q(.05), p50 = q(.5), p95 = q(.95);
    return { spread: +(p95 - p5).toFixed(1), p: [+p5.toFixed(0), +p50.toFixed(0), +p95.toFixed(0)],
             ink: +(arr.filter(v => v < p50 - 26).length / arr.length * 100).toFixed(2), n: arr.length };
  }, buf.toString('base64'));

  fs.mkdirSync(path.join(ROOT, 'outputs', 'visual'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'outputs', 'visual', '09-stele-legibility.png'), buf);
  console.log(`\n[可读性·净室] 中心区 P5/P50/P95 = ${r.p.join(' / ')}（跨度 ${r.spread}）；暗像素 ${r.ink}%\n`);

  check(`中心区有可辨明暗结构（跨度 ≥ ${MIN_SPREAD}）`, r.spread >= MIN_SPREAD, `实测跨度 ${r.spread}`);
  check(`中心区确有刻字墨迹（暗像素 ≥ ${MIN_INK}%）`, r.ink >= MIN_INK, `实测 ${r.ink}%`);
  // ── C. 机位 → controls 的接线（确定性，不等飞行）──
  // "gotoViewpoint 把机位自带的 minDist 交给 flyTo" 这一步一断，近观机位会被
  // controls.update() 每帧夹回默认下限 9m：**方位完全正确、飞行走完、页面不报错**，
  // 只有量"落位之后"的真实相机距离才看得出来（慢速端到端版见 probe/stele-station.mjs）。
  // 这里不等那 1.4s 飞行（软渲染下一帧数秒 × 28 帧，当门禁太脆），只读 flyTo 同步落下的目标值。
  const plumb = await page.evaluate(() => {
    const g = window.__garden;
    const v = (g.VIEWPOINTS || []).find(x => x.id === 'stele');
    if (!v) return { want: null, got: null };
    g.gotoViewpoint('stele');                   // 同步设置 CAM_FLY.minDist
    return { want: v.minDist, got: g.camFlyMinDist() };
  });
  check('gotoViewpoint 把机位自带的 minDist 交给了 flyTo（否则近观被弹回 9m）',
    plumb.want != null && plumb.got === plumb.want,
    `机位 minDist=${plumb.want}，flyTo 收到=${plumb.got}`);

  check('页面无报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');

  await finish();

  async function finish(){
    const pass = results.filter(x => x.ok).length;
    console.log(`${pass === results.length ? '✓' : '✗'} ${pass}/${results.length} ${pass === results.length ? 'ALL PASS' : 'FAILED'}`);
    try { await browser.close(); } catch {}
    server.close();
    process.exit(pass === results.length ? 0 : 1);
  }
})().catch(async e => { console.error('探针异常：', e); process.exit(1); });
