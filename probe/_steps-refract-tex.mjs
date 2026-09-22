// 一次性取证（2026-09-22 · 汀步石进折射层：直接量**贴图**）
//
// 上一版（_steps-refract-ab.mjs）用"主画面像素差"判，结果是**判据没牙**：
// 整幅基线噪声就有 11.5% 像素在动（风+水波+雾），ROI 里基线 13.28% vs 切层后 10.34%
// —— 切层的变化比"什么都不做"还小，说明这条判据量不出局部小变化，它的零结果不可解读。
// 按项目规矩（判据必须先自证有效），改两条独立路径：
//
//   路径 A（结构 · 零噪声）：直接读**折射贴图**（renderer.readRenderTargetPixels）
//     在汀步石世界坐标对应的那一块。贴图是"从池心正上方垂直俯视"的一张图，
//     世界→纹素换算见 src/05-water.js:106-113（相机空间 x=−世界x、y=世界z−3）。
//     · 基线：连读两次什么都不动 → 贴图那块是否稳定（若水面/池底有动画会有本底差）；
//     · 切层：把石头 layers.enable(3) → 再读一次。变了 = 贴图真被写进了石头（机制存在）。
//     正控：再把石头 visible=false → 贴图必须丢掉它（证明这一读法确实看得见"石头在不在"）。
//
//   路径 B（视觉 · 带正控）：主画面 ROI 像素差，加一条"藏掉石头"的对照 ——
//     若藏掉石头 ROI 变化巨大，说明这条像素判据对"这块石头区域"是有牙的；
//     那么它在"切层"上的零结果才算有效零结果。
//
// 用法: node probe/_steps-refract-tex.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';
import { decodePNG } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag');
function loadPlaywright(){ const require = createRequire(import.meta.url); return require('playwright'); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SETCAM2 = ({ pos, pitch }) => {
  const g = window.__garden, c = g.controls, T = g.THREE;
  c.minDistance = 0.4; c.maxDistance = 400;
  c.minPolarAngle = 0.02; c.maxPolarAngle = Math.PI - 0.02;
  const dir = new T.Vector3(0 - pos[0], 0, 3 - pos[2]).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  dir.y = Math.tan(pitch * Math.PI / 180);
  dir.normalize();
  c.target.set(pos[0] + dir.x * 20, pos[1] + dir.y * 20, pos[2] + dir.z * 20);
  g.camera.position.set(pos[0], pos[1], pos[2]);
  c.update();
  return true;
};

/* 找到汀步石，并把它在世界里的包围盒换算成折射贴图上的矩形（GL 坐标，y 自下往上） */
const LOCATE = () => {
  const g = window.__garden, T = g.THREE;
  let mesh = null;
  g.scene.traverse(o => {
    if (!o.isInstancedMesh || o.count !== 11) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m && m.color && m.color.getHexString() === '8e8d87') mesh = o;
  });
  if (!mesh) return null;
  window.__steps = mesh;
  const bb = new T.Box3().setFromObject(mesh);
  const info = g.refractInfo(), box = info.box;
  const rt = g.refractRT();
  if (!rt) return null;
  const PBW = box.maxX - box.minX, PBD = box.maxZ - box.minZ;
  const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
  /* 相机空间 x = −(世界x − cx)、y = 世界z − cz（见 05-water.js 注释） */
  const u0 = (-(bb.max.x - cx) + PBW / 2) / PBW, u1 = (-(bb.min.x - cx) + PBW / 2) / PBW;
  const v0 = ((bb.min.z - cz) + PBD / 2) / PBD, v1 = ((bb.max.z - cz) + PBD / 2) / PBD;
  const pad = 1 / rt.width;
  const x = Math.max(0, Math.floor((Math.min(u0, u1) - pad) * rt.width));
  const y = Math.max(0, Math.floor((Math.min(v0, v1) - pad) * rt.height));
  const x1 = Math.min(rt.width, Math.ceil((Math.max(u0, u1) + pad) * rt.width));
  const y1 = Math.min(rt.height, Math.ceil((Math.max(v0, v1) + pad) * rt.height));
  const screen = (() => {
    const xs = [], ys = [];
    for (const X of [bb.min.x, bb.max.x]) for (const Y of [bb.min.y, bb.max.y]) for (const Z of [bb.min.z, bb.max.z]){
      const v = new T.Vector3(X, Y, Z).project(g.camera);
      xs.push((v.x * 0.5 + 0.5) * window.innerWidth);
      ys.push((-v.y * 0.5 + 0.5) * window.innerHeight);
    }
    return { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)),
             w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)) };
  })();
  return { tex: { x, y, w: x1 - x, h: y1 - y }, texW: rt.width, texH: rt.height,
           world: { min: bb.min.toArray().map(n => +n.toFixed(2)), max: bb.max.toArray().map(n => +n.toFixed(2)) },
           screen, layer: info.layer, tagged: (mesh.layers.mask & (1 << info.layer)) !== 0 };
};
/* 读折射贴图指定矩形 → 返回 [r,g,b] 均值 + 逐像素数组（只取 RGB） */
const READTEX = ({ rect }) => {
  const g = window.__garden, rt = g.refractRT();
  if (!rt) return null;
  const buf = new Uint8Array(rect.w * rect.h * 4);
  g.renderer.readRenderTargetPixels(rt, rect.x, rect.y, rect.w, rect.h, buf);
  const rgb = new Uint8Array(rect.w * rect.h * 3);
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < rect.w * rect.h; i++){
    rgb[i*3] = buf[i*4]; rgb[i*3+1] = buf[i*4+1]; rgb[i*3+2] = buf[i*4+2];
    sr += buf[i*4]; sg += buf[i*4+1]; sb += buf[i*4+2];
  }
  const n = rect.w * rect.h;
  return { mean: [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)], pix: Array.from(rgb) };
};
const SET = ({ what, v }) => {
  const g = window.__garden, layer = g.refractInfo().layer;
  const s = window.__steps;
  if (!s) return null;
  if (what === 'layer'){ if (v === false) s.layers.disable(layer); else s.layers.enable(layer);
                         return { inLayer: (s.layers.mask & (1 << layer)) !== 0 }; }
  if (what === 'visible'){ s.visible = v; return { visible: s.visible }; }
  if (what === 'bed'){                                     // 正控用：池底（确定在层里的东西）
    let bed = null; g.scene.traverse(o => { if (o.isMesh && o.name === 'pondBed') bed = o; });
    if (!bed) return null;
    window.__bed = bed;
    bed.visible = (v !== false);
    return { bedVisible: bed.visible, inLayer: (bed.layers.mask & (1 << layer)) !== 0 };
  }
  return null;
};

function texDiff(a, b){
  if (!a || !b) return null;
  let n = 0, over8 = 0, over20 = 0, sum = 0; const d = [];
  for (let i = 0; i < a.pix.length; i += 3){
    const dd = Math.max(Math.abs(a.pix[i] - b.pix[i]), Math.abs(a.pix[i+1] - b.pix[i+1]), Math.abs(a.pix[i+2] - b.pix[i+2]));
    n++; sum += dd; d.push(dd);
    if (dd > 8) over8++; if (dd > 20) over20++;
  }
  d.sort((x, y) => x - y);
  return { n, mean: +(sum/n).toFixed(2), med: d[d.length >> 1],
           over8: +(over8/n*100).toFixed(2), over20: +(over20/n*100).toFixed(2),
           meanA: a.mean, meanB: b.mean };
}
function imgDiff(a, b, box){
  const { w, h, bpp, data: A } = a, B = b.data;
  const r = box || { x: 0, y: 0, w, h };
  let n = 0, over8 = 0, sum = 0; const d = [];
  for (let py = Math.max(0, r.y); py < Math.min(h, r.y + r.h); py++)
    for (let px = Math.max(0, r.x); px < Math.min(w, r.x + r.w); px++){
      const i = (py * w + px) * bpp;
      const dd = Math.max(Math.abs(A[i]-B[i]), Math.abs(A[i+1]-B[i+1]), Math.abs(A[i+2]-B[i+2]));
      n++; sum += dd; d.push(dd); if (dd > 8) over8++;
    }
  d.sort((x, y) => x - y);
  return { n, mean: +(sum/n).toFixed(2), med: d[d.length >> 1], over8: +(over8/n*100).toFixed(2) };
}

const W = 780, H = 406, POS = [0, 1.6, 11], PITCH = -10;
const browser = await launchChromium(loadPlaywright().chromium);
await new Promise(r => server.listen(0, r));
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), { timeout: 180000, polling: 300 });
await sleep(2200);
await page.evaluate(() => { const g = window.__garden;
  g.guideStop?.(); g.setEnv('time', 'noon'); g.setEnv('weather', 'clear'); g.setEnv('season', 'summer'); });
await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
await sleep(900);
await page.evaluate(SETCAM2, { pos: POS, pitch: PITCH });

const L = await page.evaluate(LOCATE);
if (!L){ console.log('!! 没找到汀步石 / 折射贴图不可用'); await browser.close(); server.close(); process.exit(1); }
console.log(`折射贴图 ${L.texW}×${L.texH} ｜ 汀步石世界 ${JSON.stringify(L.world.min)}~${JSON.stringify(L.world.max)}`);
console.log(`  对应贴图矩形 x=${L.tex.x} y=${L.tex.y} ${L.tex.w}×${L.tex.h}（GL 坐标 y 自下往上）`);
console.log(`  主画面 ROI x=${L.screen.x} y=${L.screen.y} ${L.screen.w}×${L.screen.h} ｜ 切层前已含 layer${L.layer}：${L.tagged}`);

const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));

console.log('\n── 路径 A：直接读**折射贴图**里石头那一块（零噪声，读的是贴图本身）──');
const T0 = await page.evaluate(READTEX, { rect: L.tex }); await sleep(600);
const T1 = await page.evaluate(READTEX, { rect: L.tex });
const dBase = texDiff(T0, T1);
console.log(`  基线（什么都不动）rgb(${T0.mean}) → rgb(${T1.mean}) ｜ ${JSON.stringify(dBase)}`);
/* 正控：藏掉**池底** —— 它是确定在折射层里的东西。这一步证明"这个读数看得见本矩形内的层内容"，
   否则下面"切层没变化"就可能是读数本身瞎了。⚠️ 必须在石头**还没进层**时做：
   石头一旦进层，它在俯视图里会遮住池底，那时藏池底本该无变化。 */
const bedOff = await page.evaluate(SET, { what: 'bed', v: false });
await frames(); await sleep(500);
const Tc = await page.evaluate(READTEX, { rect: L.tex });
const dCtl = texDiff(T1, Tc);
console.log(`  正控（藏掉池底 pondBed，可见=${bedOff ? bedOff.bedVisible : '?'}）rgb(${Tc.mean}) ｜ ${JSON.stringify(dCtl)}`);
await page.evaluate(SET, { what: 'bed', v: true });
await frames(); await sleep(400);
await page.evaluate(SET, { what: 'layer', v: true });
await frames(); await sleep(500);
const T2 = await page.evaluate(READTEX, { rect: L.tex });
const dCut = texDiff(T1, T2);
console.log(`  切层后（石头进 layer${L.layer}）rgb(${T2.mean}) ｜ ${JSON.stringify(dCut)}`);
console.log(`  贴图判读：基线 mean=${dBase.mean} ｜ 正控(藏池底) mean=${dCtl.mean} ｜ 切层 mean=${dCut.mean}`);
const ctlWorks = dCtl.mean > Math.max(3, dBase.mean * 2 + 2);
const cutWorks = dCut.mean > Math.max(3, dBase.mean * 2 + 2);
if (!ctlWorks) console.log('  ⇒ 正控没变化：这条读数判据没牙（连池底都看不见），下面的结论不可用。');
else if (cutWorks) console.log('  ⇒ 贴图里**确实被写进了石头**（切层改动远超基线 + 正控证明读数有效），机制成立。');
else console.log('  ⇒ 正控有牙、切层无变化：**连池底贴图都看不出石头进来** —— 进层对贴图零影响。');
await page.evaluate(SET, { what: 'visible', v: true });
await frames(); await sleep(400);

console.log('\n── 路径 B：主画面 ROI 像素差（同机位，只切 layer；带"藏掉石头"正控）──');
const shot = async (tag) => { const b = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `srt-${tag}.png`), b); return decodePNG(b); };
console.log(`  退回产品态（石头不进层）：${JSON.stringify(await page.evaluate(SET, { what: 'layer', v: false }))}`);
await frames(); await sleep(500);
const F1 = await shot('vis'); await sleep(700);
const F2 = await shot('vis2');
const bBase = imgDiff(F1, F2, L.screen);
console.log(`  基线（同状态两帧）ROI ${JSON.stringify(bBase)}`);
await page.evaluate(SET, { what: 'layer', v: true });
await frames(); await sleep(500);
const F3 = await shot('in-layer');
const bCut = imgDiff(F2, F3, L.screen);
console.log(`  切层（石头进 layer${L.layer}）ROI ${JSON.stringify(bCut)}`);
await page.evaluate(SET, { what: 'visible', v: false });
await frames(); await sleep(500);
const F4 = await shot('hidden');
const bCtl = imgDiff(F3, F4, L.screen);
console.log(`  正控（藏掉石头）ROI ${JSON.stringify(bCtl)}`);
console.log(`  画面判读：基线 mean=${bBase.mean}/over8=${bBase.over8}% ｜ 切层 mean=${bCut.mean}/over8=${bCut.over8}%`
  + ` ｜ 正控 mean=${bCtl.mean}/over8=${bCtl.over8}%`);
if (bCtl.mean <= Math.max(2, bBase.mean * 2)) console.log('  ⇒ 正控没变化：这条像素判据没牙，下面结论不可用。');
else if (bCut.mean > Math.max(2, bBase.mean * 2)) console.log('  ⇒ 切层**显著改变**了汀步这一带的画面：进层是会画面上看得见的改动，豁免理由必须站得住。');
else console.log('  ⇒ 正控有牙（藏石头变化巨大）、切层在基线噪声内：石头进层在画面上**看不出差别** —— 那就不该为它付进层的钱。');
console.log(`\npageerror: ${errors.length ? errors[0] : '0 条'}`);
console.log('存证：srt-vis.png / srt-vis2.png / srt-hidden.png');
await browser.close(); server.close();
