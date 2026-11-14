// 马的「出图判读」探针（2026-10-20）：把六匹马按**固定机位**拍成 8 张标准图，
// 供人工/多模态判读"像不像马、毛色对不对、动作动没动"。
//
// 为什么要有这个（durable）：
//   · 本项目的通则是"**自己跑自己截图自己判断**"——但"像不像马"是判读题不是数值题，
//     必须有一套**每次都一样**的机位与参数，否则两次出图不可比、改进无从证明。
//   · 2026-10-20 验收就用它做三方 A/B（改前 / 别人的改法 / 本次修复），
//     同机位同参数才能一眼看出"稻草质感 vs 干净毛色"。
//
// 用法：node probe/horse-look-shots.mjs [tag]
// 出图：outputs/_diag/horse-look-<tag>/
//   01-graze-side      吃草马全身侧视（查体态/比例/腿）
//   02-graze-34front   吃草马 3/4 前视（查毛色）
//   03-graze-rear      吃草马后侧（查长尾）
//   04-graze-head      吃草马头部特写（查脸/鬃/眼）
//   05-harness-side    套车马侧视（查挽具下的体态）
//   06-harness-head    套车马头部特写
//   07-fed-side        受喂马侧视（查与马夫的互动）
//   08-graze-motion-0..3  吃草马连拍 4 帧（查动作是否真动）
// 同时打印数字：口鼻-鬐甲高度差 / 尾摆 / 颌摆 / 头摆 / 蹄摆（顶点级）。
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const TAG = process.argv[2] || 'now';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'horse-look-' + TAG);
fs.mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
function lp(){ try { return require('playwright'); } catch {}
  const g = require('node:child_process').execSync('npm root -g', { encoding:'utf8' }).trim();
  return require(path.join(g, 'playwright')); }
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.glb':'model/gltf-binary', '.png':'image/png', '.webmanifest':'application/manifest+json',
  '.svg':'image/svg+xml', '.css':'text/css' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e){ r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' }); r.end(d); });
});

const { chromium } = lp();
const port = await listenEphemeral(srv);
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(`http://127.0.0.1:${port}/index.html?tier=high&intro=0`, { waitUntil:'load', timeout:240000 });
await page.waitForFunction(() => window.__garden && window.__garden.bootDone && window.__garden.bootDone(), null, { timeout:900000, polling:500 });
await page.waitForTimeout(3000);
await page.evaluate(() => { try { window.__garden.tourStop && window.__garden.tourStop(); } catch(_){} });
await page.waitForTimeout(500);

/* ── 数字：外形姿态 + 动作幅度（顶点级） ── */
const metrics = await page.evaluate(async () => {
  const g = window.__garden, T = g.THREE;
  const mod = await import('./src/15-stable.js');
  let stable = null;
  g.scene.traverse(o => { if (!stable && o.userData && Array.isArray(o.userData.horseSlots)) stable = o; });
  if (!stable) return { error: 'no horseSlots' };
  const comp = (a,i,k) => a.isInterleavedBufferAttribute ? a.data.array[i*a.data.stride+a.offset+k] : a.array[i*a.itemSize+k];
  const skinnedPos = (mesh, i, out) => {
    const si=mesh.geometry.attributes.skinIndex, sw=mesh.geometry.attributes.skinWeight, p=mesh.geometry.attributes.position;
    out.set(0,0,0);
    if (!si || !sw){ out.set(p.getX(i),p.getY(i),p.getZ(i)); return out; }
    for (let k=0;k<4;k++){
      const bi=comp(si,i,k), w=comp(sw,i,k); if (w<=0) continue;
      const b=mesh.skeleton.bones[bi]; if (!b) continue;
      const m=new T.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[bi]);
      out.addScaledVector(new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)).applyMatrix4(m), w);
    }
    out.applyMatrix4(mesh.bindMatrix); return out;
  };
  const out = [];
  for (const slot of stable.userData.horseSlots){
    const root = slot.holders[0];
    root.updateMatrixWorld(true);
    let body = null, tailG = null;
    root.traverse(o => {
      if (o.isSkinnedMesh && !body && /Horse_LP/i.test(o.name || '')) body = o;
      if (o.name === 'horseTailLongG') tailG = o;
    });
    if (!body){ out.push({ role: slot.role, error: 'no Horse_LP' }); continue; }
    const bp = body.geometry.attributes.position;
    let iMuzzle=-1, iWithers=-1, zMax=-1e9, yMax=-1e9;
    for (let i=0;i<bp.count;i++){
      const z=bp.getZ(i), y=bp.getY(i);
      if (z>zMax){ zMax=z; iMuzzle=i; }
      if (y>yMax && z<0.25){ yMax=y; iWithers=i; }
    }
    /* 看得见的长尾：局部最低点 → 世界坐标（判据与 horse-motion-guard 一致） */
    let tailTipLocal = null, tailTipMesh = null;
    if (tailG) tailG.traverse(o => {
      if (tailTipMesh || !o.isMesh) return;
      const p = o.geometry.attributes.position; let my = 1e9, mi = -1;
      for (let i=0;i<p.count;i++){ const y = p.getY(i); if (y < my){ my = y; mi = i; } }
      if (mi >= 0){ tailTipLocal = new T.Vector3(p.getX(mi), p.getY(mi), p.getZ(mi)); tailTipMesh = o; }
    });
    const bones={}; root.traverse(o => { if (o.isBone) bones[o.name]=o; });
    const rootW = new T.Vector3(); root.getWorldPosition(rootW);
    const fwd = new T.Vector3(0,0,1).transformDirection(root.matrixWorld); fwd.y=0; fwd.normalize();
    const rightV = new T.Vector3().crossVectors(fwd, new T.Vector3(0,1,0)).normalize();
    const e = new T.Euler();
    const S = { noseY:[], withersY:[], tailX:[], jawX:[], headX:[], hoofX:[] };
    const vM=new T.Vector3(), vW=new T.Vector3(), vT=new T.Vector3();
    for (let step=0; step<20*30; step++){
      mod.tickStableLife(1/30);
      root.updateMatrixWorld(true);
      if (step % 3) continue;
      body.skeleton.update();
      skinnedPos(body,iMuzzle,vM); skinnedPos(body,iWithers,vW);
      S.noseY.push(vM.y); S.withersY.push(vW.y);
      if (tailTipMesh){ vT.copy(tailTipLocal); tailTipMesh.localToWorld(vT); S.tailX.push(vT.clone().sub(rootW).dot(rightV)); }
      const jb=bones['jaw']; if (jb){ e.setFromQuaternion(jb.quaternion,'XYZ'); S.jawX.push(e.x); }
      const hb=bones['ORG-head']; if (hb){ e.setFromQuaternion(hb.quaternion,'XYZ'); S.headX.push(e.x); }
      const tb=bones['f_hoofL']||bones['DEF-f_toeL']; if (tb){ e.setFromQuaternion(tb.quaternion,'XYZ'); S.hoofX.push(e.x); }
    }
    const span = a => a.length ? +(Math.max(...a)-Math.min(...a)).toFixed(4) : 0;
    const avg  = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
    const bb = new T.Box3().setFromObject(root);
    const f = new T.Vector3(0,0,1).transformDirection(root.matrixWorld); f.y=0; f.normalize();
    const right = new T.Vector3().crossVectors(f, new T.Vector3(0,1,0)).normalize();
    const headBone = bones['ORG-head'] || bones['head'];
    const headW = new T.Vector3(); if (headBone) headBone.getWorldPosition(headW); else headW.copy(rootW).setY(rootW.y+1.4);
    out.push({ role: slot.role,
      pos: [+rootW.x.toFixed(2), +rootW.y.toFixed(2), +rootW.z.toFixed(2)],
      size: [+(bb.max.x-bb.min.x).toFixed(2), +(bb.max.y-bb.min.y).toFixed(2), +(bb.max.z-bb.min.z).toFixed(2)],
      fwd: [+f.x.toFixed(2), +f.z.toFixed(2)], right: [+right.x.toFixed(2), +right.z.toFixed(2)],
      head: [+headW.x.toFixed(2), +headW.y.toFixed(2), +headW.z.toFixed(2)],
      noseVsWithers: +(avg(S.noseY)-avg(S.withersY)).toFixed(3),
      tailSpan: span(S.tailX), jawSpan: span(S.jawX), headSpan: span(S.headX), hoofSpan: span(S.hoofX) });
  }
  return { out };
});
console.log('METRICS ' + JSON.stringify(metrics, null, 1));

/* ── 出图 ── */
async function snap(name, cam, tgt, fov = 34){
  await page.evaluate((a) => {
    const g = window.__garden, T = g.THREE;
    g.camera.position.set(a.cam[0], a.cam[1], a.cam[2]);
    if (g.controls) g.controls.target.set(a.tgt[0], a.tgt[1], a.tgt[2]);
    g.camera.lookAt(new T.Vector3(a.tgt[0], a.tgt[1], a.tgt[2]));
    if (a.fov){ g.camera.fov = a.fov; g.camera.updateProjectionMatrix(); }
  }, { cam, tgt, fov });
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('SNAP', name);
}

const L = metrics.out.filter(h => !h.error);
const graze = L.find(h => h.role === 'graze');
if (graze){
  const c = graze.pos, f = graze.fwd, r = graze.right;
  await snap('01-graze-side.png', [ c[0]-r[0]*4.6, c[1]+1.35, c[2]-r[1]*4.6 ], [c[0], c[1]+0.95, c[2]], 36);
  await snap('02-graze-34front.png', [ c[0]+f[0]*2.6+r[0]*2.2, c[1]+1.3, c[2]+f[1]*2.6+r[1]*2.2 ], [c[0], c[1]+0.95, c[2]], 36);
  await snap('03-graze-rear.png', [ c[0]-f[0]*3.4, c[1]+1.9, c[2]-f[1]*3.4 ], [c[0], c[1]+0.8, c[2]], 34);
  await snap('04-graze-head.png', [ graze.head[0]+r[0]*1.05+f[0]*0.85, graze.head[1]+0.05, graze.head[2]+r[1]*1.05+f[1]*0.85 ], [graze.head[0], graze.head[1]-0.18, graze.head[2]], 26);
}
const har = L.find(h => h.role === 'harnessed');
if (har){
  const c = har.pos, f = har.fwd, r = har.right;
  await snap('05-harness-side.png', [ c[0]-r[0]*4.4, c[1]+1.35, c[2]-r[1]*4.4 ], [c[0], c[1]+0.95, c[2]], 36);
  await snap('06-harness-head.png', [ har.head[0]+r[0]*1.0+f[0]*0.9, har.head[1]+0.05, har.head[2]+r[1]*1.0+f[1]*0.9 ], [har.head[0], har.head[1]-0.18, har.head[2]], 26);
}
const fed = L.find(h => h.role === 'fed');
if (fed){
  const c = fed.pos, f = fed.fwd, r = fed.right;
  await snap('07-fed-side.png', [ c[0]-r[0]*4.2, c[1]+1.35, c[2]-r[1]*4.2 ], [c[0], c[1]+0.95, c[2]], 36);
}
if (graze){
  const c = graze.pos, f = graze.fwd, r = graze.right;
  for (let i=0;i<4;i++){
    await snap(`08-graze-motion-${i}.png`, [ c[0]-r[0]*3.9-f[0]*0.6, c[1]+1.15, c[2]-r[1]*3.9-f[1]*0.6 ], [c[0], c[1]+0.75, c[2]], 34);
    await page.waitForTimeout(900);
  }
}
console.log('ERRORS', errors.length ? errors.slice(0,5) : '(none)');
await browser.close(); srv.close();
console.log('OUT', OUT);
