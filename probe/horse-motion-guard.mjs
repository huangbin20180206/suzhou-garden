// 马的动作门禁（2026-10-20）：六项动作必须**真的动**（顶点级 + 骨角度级）
//
// 为什么要有这道门（老黄"僵尸马"那轮的教训）：
//   2026-10-19 换成 Tinker 骨骼马后，动画层是**按"DEF-* 命名猜骨**写的，
//   而这套 Rigify 导出件里**皮肤分挂在两条平行的骨链上**（ORG 链带头/下颌/耳/鼻，
//   DEF 链带脖皮/上臂）⇒ 低头/撅嘴/抬头/抖鬃毛**全部打空**，马一直站桩。
//   画面上"看不出错"（不报错、不崩），只有量得到 ⇒ 必须有门禁钉住。
//
// 判据（页内快进 20s 仿真，逐 0.1s 采样）：
//   ① 低头吃草：吃草那匹的**口鼻顶点低于鬐甲 ≥ 0.25m**（真低头，不是抬头）
//   ② 撅嘴嚼  ：吃草/受喂两匹的**下颌角 X 摆动 ≥ 0.05rad**；其它角色 ≤ 0.03rad（不该动）
//   ③ 摇尾巴  ：**尾尖横摆 ≥ 0.12m**
//   ④ 动前蹄  ：**蹄骨角 X 摆动 ≥ 0.15rad**
//   ⑤ 抬头晃脑：**头骨角 X 摆动 ≥ 0.08rad**（六匹都得有）
//   ⑥ 冬天白气：切冬季后**口鼻白雾实例有活团**（live ≥ 1）
//
// 用法：node probe/horse-motion-guard.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'horse-motion-guard');
const require = createRequire(import.meta.url);
function lp(){ try { return require('playwright'); } catch {}
  const g = require('node:child_process').execSync('npm root -g', { encoding:'utf8' }).trim();
  return require(path.join(g, 'playwright')); }
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json',
  '.glb':'model/gltf-binary', '.png':'image/png', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e){ r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' }); r.end(d); });
});
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = lp();
const port = await listenEphemeral(srv);
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?tier=low&intro=0`, { waitUntil:'load', timeout:180000 });
await page.waitForFunction(() => window.__garden && window.__garden.bootDone(), null, { timeout:900000, polling:500 });
await page.waitForTimeout(600);

const data = await page.evaluate(async () => {
  const g = window.__garden, T = g.THREE;
  const mod = await import('./src/15-stable.js');
  let stable = null;
  g.scene.traverse(o => { if (!stable && o.userData && Array.isArray(o.userData.horseSlots)) stable = o; });
  if (!stable) return { error: '没找到马厩的 horseSlots' };
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
  const horses = [];
  for (const slot of stable.userData.horseSlots){
    const root = slot.holders[0];
    let body = null, tailM = null, tailG = null;
    root.traverse(o => { if (o.isSkinnedMesh){
      if (!body && /Horse_LP/i.test(o.name || '')) body = o;
      if (/^Tail$/i.test(o.name || '')) tailM = o; }
      if (o.name === 'horseTailLongG') tailG = o; });
    /* ⚠️ 2026-10-20 验收发现的**门禁盲区**：Tinker 自带那块 0.21m 短尾网格已经被藏掉
       （visible=false，长尾是另挂的程序化尾束）⇒ 原判据量的是**看不见的那块**，
       数字掉到 0.015m 也照样"ALL PASS"。⇒ 改成量**看得见的长尾**（horseTailLongG）。
       仍然同时量旧尾网格（留作回归对照，但不再作判据）。 */
    if (!tailM && tailG){
      tailM = tailG;                                   // 退路：没有旧尾就量新尾组
    }
    if (!body){
      /* 2026-10-23：马换成 Rodin 三匹（**无骨骼**，走伪蒙皮）。判据不退休成"跳过"，
         改成量**产品自己算出来的姿态角**（rig.head/tail/leg/jaw），语义与骨骼分支一致：
         头角到基角 = 低头吃草、尾角有摆幅 = 摇尾、腿角有摆幅 = 抬蹄、下颌角有摆幅 = 在嚼。 */
      const h = mod.horseLifeDebug().find(x => x.group === slot.group);
      const rig = h && h.mat && h.mat.userData && h.mat.userData.rig;
      if (!rig) { horses.push({ role: slot.role, error: '既没有蒙皮网格、也没有伪蒙皮 rig' }); continue; }
      const S = { head: [], tail: [], jaw: [], leg: [[], [], [], []] };
      for (let step = 0; step < 20 * 30; step++){
        mod.tickStableLife(1 / 30);
        if (step % 3) continue;
        S.head.push(rig.head.x); S.tail.push(rig.tail.x); S.jaw.push(rig.jaw ? rig.jaw.x : 0);
        for (let k = 0; k < 4; k++) S.leg[k].push(rig.leg.getComponent(k));
      }
      const sp = a => a.length ? +(Math.max(...a) - Math.min(...a)).toFixed(4) : 0;
      const av = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
      /* 口鼻相对鬐甲的高度：按 shader 同一公式把 nose 锚点绕颈枢轴转 head.x，再减颈枢轴高 */
      const piv = h.piv.neck, nose = h.nose;
      const ang = av(S.head), dyy = nose[1] - piv[1], dzz = nose[2] - piv[2];
      const noseY = piv[1] + dyy * Math.cos(ang) - dzz * Math.sin(ang);
      horses.push({ role: slot.role, mode: 'rig',
        noseVsWithers: +(noseY - piv[1]).toFixed(3),
        noseSpan: 0, tailSpan: sp(S.tail), jawSpan: sp(S.jaw),
        headSpan: sp(S.head), hoofSpan: Math.max(...S.leg.map(sp)) });
      continue;
    }
    const bp = body.geometry.attributes.position;
    let iMuzzle = -1, iWithers = -1, zMax = -1e9, yMax = -1e9;
    for (let i=0;i<bp.count;i++){
      const z = bp.getZ(i), y = bp.getY(i);
      if (z > zMax){ zMax = z; iMuzzle = i; }
      if (y > yMax && z < 0.25){ yMax = y; iWithers = i; }
    }
    let iTailTip = -1;
    if (tailM && tailM.isSkinnedMesh){ const p = tailM.geometry.attributes.position; let zm = 1e9;
      for (let i=0;i<p.count;i++) if (p.getZ(i) < zm){ zm = p.getZ(i); iTailTip = i; } }
    /* 看得见的长尾（非蒙皮、挂在尾骨下）：取局部最低点，每帧换算成世界坐标量横摆 */
    let tailTipLocal = null, tailTipMesh = null;
    if (tailG) tailG.traverse(o => {
      if (tailTipMesh || !o.isMesh) return;
      const p = o.geometry.attributes.position; let my = 1e9, mi = -1;
      for (let i=0;i<p.count;i++){ const y = p.getY(i); if (y < my){ my = y; mi = i; } }
      if (mi >= 0){ tailTipLocal = new T.Vector3(p.getX(mi), p.getY(mi), p.getZ(mi)); tailTipMesh = o; }
    });
    const bones = {}; root.traverse(o => { if (o.isBone) bones[o.name] = o; });
    /* 甩尾是**沿马的横向**摆（马的 local X）⇒ 判据必须量"横向分量"，
       不能量世界 X：吃草马 yaw=−90°，它的横向是世界 Z ⇒ 量世界 X 会读成"几乎不动"（假阴性）。 */
    const rootW = new T.Vector3(); root.getWorldPosition(rootW);
    const fwd = new T.Vector3(0, 0, 1).transformDirection(root.matrixWorld); fwd.y = 0; fwd.normalize();
    const rightV = new T.Vector3().crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize();
    const e = new T.Euler();
    const S = { noseY:[], withersY:[], tailX:[], jawX:[], headX:[], hoofX:[] };
    const vM = new T.Vector3(), vW = new T.Vector3(), vT = new T.Vector3();
    for (let step = 0; step < 20*30; step++){
      mod.tickStableLife(1/30);
      root.updateMatrixWorld(true);
      if (step % 3) continue;
      body.skeleton.update(); if (tailM && tailM.isSkinnedMesh) tailM.skeleton.update();
      skinnedPos(body, iMuzzle, vM); skinnedPos(body, iWithers, vW);
      S.noseY.push(vM.y); S.withersY.push(vW.y);
      if (tailTipMesh){ vT.copy(tailTipLocal); tailTipMesh.localToWorld(vT); S.tailX.push(vT.clone().sub(rootW).dot(rightV)); }
      else if (tailM && iTailTip >= 0){ skinnedPos(tailM, iTailTip, vT); S.tailX.push(vT.clone().sub(rootW).dot(rightV)); }
      const jb = bones['jaw']; if (jb){ e.setFromQuaternion(jb.quaternion,'XYZ'); S.jawX.push(e.x); }
      const hb = bones['ORG-head']; if (hb){ e.setFromQuaternion(hb.quaternion,'XYZ'); S.headX.push(e.x); }
      const tb = bones['f_hoofL'] || bones['DEF-f_toeL']; if (tb){ e.setFromQuaternion(tb.quaternion,'XYZ'); S.hoofX.push(e.x); }
    }
    const span = a => a.length ? +(Math.max(...a) - Math.min(...a)).toFixed(4) : 0;
    const avg  = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
    horses.push({ role: slot.role,
      noseVsWithers: +(avg(S.noseY) - avg(S.withersY)).toFixed(3),
      noseSpan: span(S.noseY), tailSpan: span(S.tailX), jawSpan: span(S.jawX),
      headSpan: span(S.headX), hoofSpan: span(S.hoofX) });
  }
  // 冬天白气
  g.setEnv('season', 'winter');
  await new Promise(r => setTimeout(r, 3800));
  let breathLive = 0;
  for (let i=0;i<60*30;i++){
    mod.tickStableLife(1/30);
    const st = g.horseLifeState();
    breathLive = Math.max(breathLive, ...st.horses.map(h => (h.breath ? h.breath.live : 0)));
    if (breathLive > 0) break;
  }
  return { horses, breathLive, state: g.horseLifeState() };
});

await browser.close(); srv.close();

let fail = 0;
const ok = (cond, msg, extra) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg + (extra != null ? ' — ' + extra : '')); if (!cond) fail++; };
console.log('[horse-motion-guard] 马厩动作门禁');
if (data.error){ console.log('  ✗ ' + data.error); process.exit(1); }
const byRole = r => data.horses.filter(h => h.role === r);
for (const h of data.horses) console.log(`  · ${h.role.padEnd(9)} 口鼻-鬐甲 ${h.noseVsWithers}  尾摆 ${h.tailSpan}  颌 ${h.jawSpan}  头 ${h.headSpan}  蹄 ${h.hoofSpan}`);

const graze = byRole('graze')[0], fed = byRole('fed')[0];
ok(!!graze, '有"低头吃草"那匹马');
if (graze) ok(graze.noseVsWithers <= -0.25, '① 低头吃草：口鼻低于鬐甲 ≥0.25m', graze.noseVsWithers + 'm');
ok(!!fed, '有"受喂"那匹马');
if (fed) ok(fed.noseVsWithers <= -0.20, '①b 受喂马也低着头', fed.noseVsWithers + 'm');
if (graze) ok(graze.jawSpan >= 0.05, '② 撅嘴嚼：下颌角摆动 ≥0.05rad', graze.jawSpan + 'rad');
if (fed)   ok(fed.jawSpan   >= 0.05, '②b 受喂马也在嚼', fed.jawSpan + 'rad');
const stall = byRole('stall')[0];
if (stall) ok(stall.jawSpan <= 0.03, '②c 厩内那匹不嚼（不该动嘴）', stall.jawSpan + 'rad');
const tails = data.horses.map(h => h.tailSpan);
/* 骨骼分支量的是**尾尖位移（米）**，伪蒙皮分支量的是**尾角（弧度）** ⇒ 门槛按分支给 */
const tailUnit = data.horses[0] && data.horses[0].mode === 'rig' ? 'rad' : 'm';
const TAIL_MAX = tailUnit === 'rad' ? 0.20 : 0.12;
const TAIL_MIN = tailUnit === 'rad' ? 0.15 : 0.08;
ok(Math.max(...tails) >= TAIL_MAX, `③ 摇尾巴：尾${tailUnit === 'rad' ? '角' : '尖横摆'} ≥${TAIL_MAX}${tailUnit}`, 'max ' + Math.max(...tails) + tailUnit);
/* ⚠️ 2026-10-20 验收补的**盲区**：原来只看 max ⇒ 六匹里五匹不动也照样绿。
   老黄要求"马蹄马尾不规则动"是**对所有马**的 ⇒ 逐匹都要有下限。 */
ok(Math.min(...tails) >= TAIL_MIN, '③b 每匹马都在摇尾（不是只有几匹动）', 'min ' + Math.min(...tails) + tailUnit);
const hoofs = data.horses.map(h => h.hoofSpan);
ok(Math.max(...hoofs) >= 0.15, '④ 动前蹄：蹄骨角摆动 ≥0.15rad', 'max ' + Math.max(...hoofs) + 'rad');
const heads = data.horses.map(h => h.headSpan);
ok(Math.min(...heads) >= 0.08, '⑤ 抬头晃脑：六匹头骨角都在摆 ≥0.08rad', 'min ' + Math.min(...heads) + 'rad');
ok(data.breathLive >= 1, '⑥ 冬天口鼻冒白气', 'live ' + data.breathLive);
ok(errors.length === 0, '全程零 pageerror', errors.join(' | ') || '无');
ok(data.state.n === 6, '六匹马都在', 'n=' + data.state.n);

console.log(fail === 0 ? '\n[horse-motion-guard] ALL PASS' : `\n[horse-motion-guard] FAIL ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
