// 题名石「正面遮挡物」诊断：从刻字面正前方竖着打一排射线，逐发报告首个命中体。
// 为什么需要：抬 0.55m 后 az=0°（正对刻字面）仍被 mergedStatic@2.43 挡（石面在 2.62）。
// 只报"某个 mergedStatic"没用 —— mergedStatic 是**合并后的静态大网**，必须把命中点 + 物体 bbox
// 打出来，才能判断挡的到底是驳岸顶、岸土台阶、还是一块装饰石。
// 产出：outputs/visual/09e-stele-front.png（实景，不净室，UI 隐藏）
// 用法: node probe/stele-block.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

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

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000 });
  await page.waitForFunction(() => {
    let s = false; window.__garden.scene.traverse(o => { if (o.name === 'steleGroup') s = true; });
    return s;
  }, { timeout: 300000 });
  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 180000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());

  const r = await page.evaluate(() => {
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
    const nH = new T.Vector3(nrm.x, 0, nrm.z).normalize();

    /* 描述一次命中：名字 / 材质名 / 命中面法线（世界）/ 命中点 */
    const describe = (h) => {
      if (!h) return { name: '(无)', mat: '-', n: '-', y: null, own: false, inst: false };
      const o = h.object;
      const chain = []; for (let x = o; x; x = x.parent) chain.push(x.name || x.type);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const n = h.face
        ? h.face.normal.clone().applyMatrix3(new T.Matrix3().getNormalMatrix(o.matrixWorld)).normalize()
        : null;
      return {
        name: (o.name || o.type) + '@' + h.distance.toFixed(2),
        mat: m ? (m.name || '(无名)') : '-',
        n: n ? [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] : '-',
        y: +h.point.y.toFixed(2),
        own: chain.includes('steleGroup'),
        inst: !!o.isInstancedMesh,
      };
    };
    const cast = (P, tgt) => {
      const dir = tgt.clone().sub(P).normalize();
      const rc = new T.Raycaster(P, dir, 0.01, 400);
      return describe(rc.intersectObject(g.scene, true)
                        .filter(h => h.object.isMesh || h.object.isInstancedMesh)[0]);
    };

    /* ① 正面竖扫：从字心正前方各距离、各高度打向字心 */
    const fan = [];
    for (const d of [1.9, 2.6, 4.5]){
      for (let i = 0; i <= 10; i++){
        const dy = i * 0.3;
        const P = new T.Vector3(cen.x + nH.x * d, cen.y + dy, cen.z + nH.z * d);
        fan.push(Object.assign({ d, dy: +dy.toFixed(1), P: [+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2)] },
                               cast(P, cen)));
      }
    }
    /* ② 地面剖面：沿「法线方向」（池心→石）竖直下打，量这一带的实际地表高度 */
    const ground = [];
    for (let t = -3.0; t <= 4.01; t += 0.5){
      const P = new T.Vector3(cen.x + nH.x * t, cen.y + 2.0, cen.z + nH.z * t);
      const down = new T.Vector3(P.x, -1, P.z);
      ground.push(Object.assign({ t: +t.toFixed(1), P: [+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2)] },
                                cast(P, down)));
    }
    /* ③ 石头脚下正前方 0.25m 处单独下探（那里是刚才被挡住的落点） */
    const front = cast(new T.Vector3(cen.x + nH.x * 0.25, cen.y + 2.0, cen.z + nH.z * 0.25),
                       new T.Vector3(cen.x + nH.x * 0.25, -1, cen.z + nH.z * 0.25));

    return {
      cen: [+cen.x.toFixed(2), +cen.y.toFixed(2), +cen.z.toFixed(2)],
      nrm: [+nrm.x.toFixed(3), +nrm.y.toFixed(3), +nrm.z.toFixed(3)],
      stoneBB: (() => { const b = new T.Box3().setFromObject(slab);
        return [+b.min.y.toFixed(2), +b.max.y.toFixed(2)]; })(),
      /* 正面机位（az=0, d=2.6, dy=0.3）*/
      eye: [+(cen.x + nH.x * 2.6).toFixed(2), +(cen.y + 0.3).toFixed(2), +(cen.z + nH.z * 2.6).toFixed(2)],
      fan, ground, front,
    };
  });

  console.log('[几何] 字心', r.cen, '｜法线', r.nrm, '｜石 y 范围', r.stoneBB, '｜正面机位', r.eye);
  console.log(`[脚下] 石面正前方 0.25m 下探 → ${r.front.name}  命中y=${r.front.y}  法线=${r.front.n}  材质=${r.front.mat}`);
  console.log('\n[竖扫] d = 相机到字心的水平距离，dy = 相对字心的抬高；「首个命中」是射线遇到的第一个网格');
  let lastD = null;
  for (const f of r.fan){
    if (f.d !== lastD){ console.log(`\n  ── d = ${f.d}m ──`); lastD = f.d; }
    const tag = f.own ? '✓石' : '✘挡';
    console.log(`   dy=${String(f.dy).padStart(4)}  ${tag}  ${f.name.padEnd(24)} 命中y=${String(f.y).padStart(5)}  法线=${JSON.stringify(f.n).padEnd(20)} 材质=${f.mat}`);
  }
  console.log('\n[剖面] 沿「池心→石」法线方向竖直下探（t<0 = 水侧，t>0 = 岸内），量这一带真实地表高度');
  for (const g2 of r.ground){
    console.log(`   t=${String(g2.t).padStart(5)}  ${g2.name.padEnd(26)} 地表y=${String(g2.y).padStart(5)}  法线=${JSON.stringify(g2.n).padEnd(20)} 材质=${g2.mat}`);
  }
  if (errs.length) console.log('\n[页面报错]', errs.slice(0, 3).join(' | '));

  /* 实景截图：① 正面（不净室）② 侧视剖面（切向看，池↔岸的坡形横铺画面）③ 俯视 */
  const camInfo = await page.evaluate((eye) => {
    for (const id of ['env', 'hud', 'stats', 'caption']){
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    }
    const g = window.__garden, T = g.THREE;
    let stele = null, slab = null;
    g.scene.traverse(o => { if (o.name === 'steleGroup') stele = o; });
    stele.traverse(o => { if (o.geometry && !slab) slab = o; });
    const geo = slab.geometry, idx = geo.index, pos = geo.attributes.position;
    const gf = geo.groups.find(x => x.materialIndex === 1);
    const cen = new T.Vector3();
    for (let k = gf.start; k < gf.start + gf.count; k++){
      const vi = idx.getX(k);
      cen.add(new T.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
    }
    cen.divideScalar(gf.count).applyMatrix4(slab.matrixWorld);
    g.controls.minDistance = 0.01; g.controls.maxDistance = 500;
    const anchor = new T.Vector3(cen.x, cen.y, cen.z);
    const tan = new T.Vector3(0.874, 0, 0.484);        // 与刻字面法线垂直的水平方向
    return {
      cen: [+cen.x.toFixed(2), +cen.y.toFixed(2), +cen.z.toFixed(2)],
      anchor: [anchor.x, anchor.y, anchor.z],
      views: [
        { name: '09e-stele-front.png', eye: eye, tgt: [cen.x, cen.y, cen.z] },
        { name: '09f-stele-side.png',
          eye: [cen.x + tan.x * 5.5, cen.y + 1.6, cen.z + tan.z * 5.5],
          tgt: [cen.x, cen.y - 0.25, cen.z] },
        { name: '09g-stele-top.png',
          eye: [cen.x + 0.9, cen.y + 4.6, cen.z - 1.6],
          tgt: [cen.x, cen.y - 0.4, cen.z] },
      ],
    };
  }, r.eye);

  for (const v of camInfo.views){
    await page.evaluate((v) => {
      const g = window.__garden;
      g.camera.position.set(v.eye[0], v.eye[1], v.eye[2]);
      g.controls.target.set(v.tgt[0], v.tgt[1], v.tgt[2]); g.controls.update();
    }, v);
    await page.evaluate(() => new Promise(res => {
      let n = 0; const f = () => { if (++n >= 3) res(); else requestAnimationFrame(f); };
      requestAnimationFrame(f);
    }));
    const buf = await page.screenshot();
    fs.mkdirSync(path.join(ROOT, 'outputs', 'visual'), { recursive: true });
    const dst = path.join(ROOT, 'outputs', 'visual', v.name);
    fs.writeFileSync(dst, buf);
    console.log('saved ' + dst + '  机位 ' + v.eye.map(x => x.toFixed(2)).join(','));
  }

  try { await browser.close(); } catch {}
  server.close();
  process.exit(0);
})().catch(e => { console.error('遮挡诊断异常：', e); process.exit(1); });
