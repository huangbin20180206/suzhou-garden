// 「云根」近观机位求解器：在刻字面正前方扫一圈候选机位，挑出**射线通畅**的那些。
// 为什么需要扫：刻字面法线朝池心，而立峰正好也在那个方向 —— 正前方 2~3m 很可能站在立峰体内。
// 判据：① 从候选机位射线到字心，首个命中体必须是题名石；② 候选点不能落在立峰包围盒内
//       （在石头内部控制射线会因 FrontSide 只命中正面而"假通畅"）。
// 用法: node probe/stele-viewpoint.mjs
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
    const g = window.__garden; let s = 0, h = 0, c = 0;
    g.scene.traverse(o => { if (o.name === 'steleGroup') s++; if (o.name === 'taihuHero') h++;
                            if (o.name === 'taihuCompanion') c++; });
    return s && h && c >= 2;
  }, { timeout: 300000 }).catch(() => {});
  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 180000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());

  const r = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    let stele = null, slab = null, hero = null; const comps = [];
    g.scene.traverse(o => {
      if (o.name === 'steleGroup') stele = o;
      if (o.name === 'taihuHero') hero = o;
      if (o.name === 'taihuCompanion') comps.push(o);
    });
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
    const stoneBB = new T.Box3().setFromObject(slab);
    const heroBB = hero ? new T.Box3().setFromObject(hero) : null;
    const compBB = comps.map(c => new T.Box3().setFromObject(c));

    /* 候选机位：绕字心、在刻字面那一侧水平旋转 az（相对法线），距离 d，抬高 dy */
    const cands = [];
    for (let azd = -90; azd <= 90; azd += 7.5){
      const az = azd * Math.PI / 180;
      const ca = Math.cos(az), sa = Math.sin(az);
      /* 基向量：法线 n 在水平面内 + 其右手侧 t */
      const n = new T.Vector3(nrm.x, 0, nrm.z).normalize();
      const t = new T.Vector3(-n.z, 0, n.x);
      const off = n.clone().multiplyScalar(ca).add(t.clone().multiplyScalar(sa));
      for (const d of [2.6, 3.0, 3.4, 3.8]){
        for (const dy of [0.3, 0.6, 0.9]){
          const P = new T.Vector3(cen.x + off.x * d, cen.y + dy, cen.z + off.z * d);
          const dir = cen.clone().sub(P).normalize();
          const rc = new T.Raycaster(P, dir, 0.01, 400);
          const hits = rc.intersectObject(g.scene, true).filter(h => h.object.isMesh || h.object.isInstancedMesh);
          const first = hits[0];
          let own = false, hitName = '(无)';
          if (first){
            hitName = first.object.name || first.object.type;
            for (let o = first.object; o; o = o.parent){ if (o === stele || o.name === 'steleGroup'){ own = true; break; } }
          }
          /* 候选点是否落在立峰/伴石体内（会被 FrontSide 假通畅骗过） */
          const pad = 0.15;
          const inside = (bb)=> bb && P.x > bb.min.x - pad && P.x < bb.max.x + pad
                                && P.y > bb.min.y - pad && P.y < bb.max.y + pad
                                && P.z > bb.min.z - pad && P.z < bb.max.z + pad;
          const inHero = inside(heroBB);
          const inComp = compBB.some(inside);
          const faceOn = +(-dir.dot(nrm)).toFixed(3);
          cands.push({
            az: azd, d, dy, own, clear: own && !inHero && !inComp,
            inHero, inComp, faceOn, hit: hitName,
            P: [+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2)],
          });
        }
      }
    }
    const vp = (g.VIEWPOINTS || []).map(v => ({ id: v.id, pos: [+v.pos.x.toFixed(2), +v.pos.y.toFixed(2), +v.pos.z.toFixed(2)] }));

    /* ⭐ 调试：为什么 300 个候选全不通？挑几个代表性方位把**完整命中列表**打出来，
       并确认 slab 本身可被射线命中（名字/父链/在场景里）。 */
    let meshN = 0; g.scene.traverse(o => { if (o.isMesh || o.isInstancedMesh) meshN++; });
    const chain = []; for (let o = slab; o; o = o.parent) chain.push(o.name || o.type);
    let slabInScene = false; g.scene.traverse(o => { if (o === slab) slabInScene = true; });
    const dbg = [];
    for (const azd of [0, 45, -45, 90]){
      const az = azd * Math.PI / 180, ca = Math.cos(az), sa = Math.sin(az);
      const n = new T.Vector3(nrm.x, 0, nrm.z).normalize();
      const t = new T.Vector3(-n.z, 0, n.x);
      const off = n.clone().multiplyScalar(ca).add(t.clone().multiplyScalar(sa));
      const d = 2.6, dy = 0.3;
      const P = new T.Vector3(cen.x + off.x * d, cen.y + dy, cen.z + off.z * d);
      const dir = cen.clone().sub(P).normalize();
      const rc = new T.Raycaster(P, dir, 0.01, 400);
      const hits = rc.intersectObject(g.scene, true);
      dbg.push({ az: azd, P: [+P.x.toFixed(2), +P.y.toFixed(2), +P.z.toFixed(2)],
                 hits: hits.slice(0, 6).map(h => (h.object.name || h.object.type) + (h.object.isInstancedMesh ? '[inst]' : '') + '@' + h.distance.toFixed(2)),
                 nHits: hits.length });
    }
    return {
      /* 直接对 slab 单独射线（不经 g.scene）：确认几何本身可命中 */
      slabRay: (() => {
        const az = 0, n = new T.Vector3(nrm.x, 0, nrm.z).normalize();
        const P = new T.Vector3(cen.x + n.x * 2.6, cen.y + 0.3, cen.z + n.z * 2.6);
        const dir = cen.clone().sub(P).normalize();
        const rc = new T.Raycaster(P, dir, 0.01, 400);
        const hs = rc.intersectObject(slab, false);
        return { n: hs.length, first: hs[0] ? (hs[0].object.name || hs[0].object.type) + '@' + hs[0].distance.toFixed(2) : '无' };
      })(),
      meshN, chain, slabInScene, dbg,
      charCtr: [+cen.x.toFixed(2), +cen.y.toFixed(2), +cen.z.toFixed(2)],
      nrm: [+nrm.x.toFixed(3), +nrm.y.toFixed(3), +nrm.z.toFixed(3)],
      stoneBB: [+stoneBB.min.x.toFixed(2), +stoneBB.min.y.toFixed(2), +stoneBB.min.z.toFixed(2),
                +stoneBB.max.x.toFixed(2), +stoneBB.max.y.toFixed(2), +stoneBB.max.z.toFixed(2)],
      heroBB: heroBB ? [+heroBB.min.x.toFixed(2), +heroBB.min.y.toFixed(2), +heroBB.min.z.toFixed(2),
                        +heroBB.max.x.toFixed(2), +heroBB.max.y.toFixed(2), +heroBB.max.z.toFixed(2)] : null,
      heroPos: hero ? [+hero.position.x.toFixed(2), +hero.position.z.toFixed(2)] : null,
      compPos: comps.map(c => [+c.position.x.toFixed(2), +c.position.z.toFixed(2)]),
      vp, cands,
    };
  });

  console.log('[几何] 字心', r.charCtr, '｜刻字面法线', r.nrm);
  console.log('[几何] 题名石 bbox', r.stoneBB);
  console.log('[几何] 立峰 bbox', r.heroBB, '位置xz', r.heroPos);
  console.log('[几何] 伴石 xz', JSON.stringify(r.compPos));
  console.log('[几何] 现有 VIEWPOINTS', JSON.stringify(r.vp));

  const clear = r.cands.filter(c => c.clear).sort((a, b) => Math.abs(a.az) - Math.abs(b.az));
  console.log(`\n[扫描] 共 ${r.cands.length} 个候选，通畅 ${clear.length} 个`);
  const bad = r.cands.filter(c => c.own && (c.inHero || c.inComp)).length;
  console.log(`[扫描] 射线"通畅"但机位落在立峰/伴石体内（假通畅，已剔除）：${bad} 个`);

  console.log(`\n[调试] 场景网格 ${r.meshN} 个；slab 名字 "${r.chain[0]}"；父链 ${JSON.stringify(r.chain)}；在场景里=${r.slabInScene}`);
  console.log(`[调试] 只对 slab 射线 → 命中 ${r.slabRay.n} 次，首个 ${r.slabRay.first}`);
  console.log('[调试] 代表性方位的完整命中列表：');
  for (const d of r.dbg) console.log(`   az=${String(d.az).padStart(4)}° P=${d.P.join(',')} 命中${d.nHits}个 → ${JSON.stringify(d.hits)}`);

  if (!clear.length){
    console.log('=> ✘ 刻字面正前方**没有任何可站立的机位**（全被立峰/伴石占据或遮挡）→ 必须先转向/挪石，A 方案单独不可行');
  } else {
    console.log('\n[推荐] 按 |az| 最小（最接近正面）排序，取前 12 个：');
    for (const c of clear.slice(0, 12)){
      console.log(`   az=${String(c.az).padStart(5)}°  d=${c.d}  dy=${c.dy}  正面度 ${c.faceOn}  机位 ${c.P.join(',')}`);
    }
    const best = clear[0];
    console.log(`\n[最优] az=${best.az}° d=${best.d} dy=${best.dy} → pos=(${best.P.join(', ')})  target=(${r.charCtr.join(', ')})  正面度 ${best.faceOn}`);
  }
  if (errs.length) console.log('[页面报错]', errs.slice(0, 3).join(' | '));

  try { await browser.close(); } catch {}
  server.close();
  process.exit(0);
})().catch(e => { console.error('求解器异常：', e); process.exit(1); });
