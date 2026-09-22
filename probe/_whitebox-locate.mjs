// 一次性取证（2026-09-22 · 终极定案：白色框体是谁）
//
// 前两轮探针缺了什么：
//   · _whitebox-hunt.mjs 找到了"亮 + 空心"的块，但只报了屏幕坐标与距相机距离，
//     没有**世界坐标** ⇒ 无法判断那个块到底在池塘里、还是白墙上、还是地上。
//   · 而 mergedStatic（静态合并大网）把很多物体并进一个网格，名字不可用。
//
// 本探针补三件：
//   ① 每个候选块的中心打射线，**报命中点的世界坐标 (x,y,z)**，并标注它离水面多高
//      —— 一句话回答"它在池塘里吗"。
//   ② **冬/夏对照**：老黄说"冬季池塘植物都没了，这个白色框体一眼就看到了"，
//      那同一位置在夏季就该被水生植物盖住。同一构建、同一机位、只切季节：
//      冬季有 + 夏季无 ⇒ 它和水生植物同处一地（强证据，而不是我自己认定的）。
//   ③ 命中 mergedStatic 时给出**该面片的法线与材质色**，并顺带把命中点周围
//      0.5m 内的所有具名网格列出来 —— 用来给"合并网里的无名面片"找主人。
//
// 用法: node outputs/_diag/_whitebox-id2.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';
import { decodePNG } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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
const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function findBlobs(img, thr, minPx, maxPx){
  const { w, h, bpp, data } = img;
  const seen = new Uint8Array(w * h); const out = []; const stack = [];
  for (let s = 0; s < w * h; s++){
    if (seen[s]) continue;
    const p0 = s * bpp;
    if (LUM(data[p0], data[p0+1], data[p0+2]) <= thr){ seen[s] = 1; continue; }
    let minX = w, maxX = 0, minY = h, maxY = 0, n = 0, sum = 0; const Ls = [], members = [];
    stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length){
      const q = stack.pop();
      const py = (q / w) | 0, px = q - py * w, pp = q * bpp;
      const l = LUM(data[pp], data[pp+1], data[pp+2]);
      n++; sum += l; Ls.push(l); members.push(q);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      const nb = [px > 0 ? q-1 : -1, px < w-1 ? q+1 : -1, py > 0 ? q-w : -1, py < h-1 ? q+w : -1];
      for (const t of nb){ if (t < 0 || seen[t]) continue; seen[t] = 1; const tp = t*bpp;
        if (LUM(data[tp], data[tp+1], data[tp+2]) > thr) stack.push(t); }
    }
    if (n < minPx || n > maxPx) continue;
    const bw = maxX-minX+1, bh = maxY-minY+1;
    const isIn = new Set(members);
    const cx0 = minX + bw*0.30 | 0, cx1 = minX + bw*0.70 | 0;
    const cy0 = minY + bh*0.30 | 0, cy1 = minY + bh*0.70 | 0;
    let coreN = 0, coreOut = 0;
    for (let py = cy0; py <= cy1; py++) for (let px = cx0; px <= cx1; px++){ coreN++; if (!isIn.has(py*w+px)) coreOut++; }
    const mean = sum / n;
    out.push({ n, minX, maxX, minY, maxY, bw, bh, cx: (minX+maxX)>>1, cy: (minY+maxY)>>1,
      fill: +(n/(bw*bh)).toFixed(3), hollow: coreN ? +(coreOut/coreN).toFixed(3) : 0,
      L: +mean.toFixed(1), sd: +Math.sqrt(Ls.reduce((a,l)=>a+(l-mean)**2,0)/n).toFixed(1) });
  }
  return out.sort((a, b) => b.n - a.n);
}

/* 射线：报世界坐标 + 水高 + 命中面法线 + 附近具名物件 */
const PROBE = ({ px, py }) => {
  const g = window.__garden, T = g.THREE;
  const el = g.renderer.domElement, W = el.clientWidth, H = el.clientHeight;
  const rc = new T.Raycaster();
  rc.setFromCamera(new T.Vector2((px/W)*2 - 1, -((py/H)*2 - 1)), g.camera);
  const raw = rc.intersectObjects(g.scene.children, true);
  const solid = [];
  for (const hh of raw){
    const o = hh.object;
    if (o.isPoints || o.isLine) continue;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) continue;
    if (m.transparent && m.depthWrite === false && hh.distance > 0.01) continue;
    solid.push(hh); if (solid.length >= 3) break;
  }
  const water = g.CFG ? g.CFG.water : null;
  const hits = solid.map(hh => {
    const o = hh.object, m = Array.isArray(o.material) ? o.material[0] : o.material;
    const nrm = hh.face ? hh.face.normal.clone().transformDirection(o.matrixWorld) : null;
    return { d: +hh.distance.toFixed(2), name: o.name || '(无名)', geo: o.geometry.type,
      inst: !!o.isInstancedMesh, iid: hh.instanceId === undefined ? null : hh.instanceId,
      color: m.color ? '#' + m.color.getHexString() : '?',
      vertexColors: !!m.vertexColors,
      pos: hh.point.toArray().map(v => +v.toFixed(2)),
      aboveWater: water === null ? null : +(hh.point.y - water).toFixed(2),
      normal: nrm ? [ +nrm.x.toFixed(2), +nrm.y.toFixed(2), +nrm.z.toFixed(2) ] : null };
  });
  /* 命中点附近 1.2m 内的具名网格 —— 给"合并网里的面片"找主人 */
  const p0 = hits.length ? new T.Vector3(...hits[0].pos) : null;
  const near = [];
  if (p0) g.scene.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.name) return;
    const bb = new T.Box3().setFromObject(o);
    if (bb.distanceToPoint(p0) > 1.2) return;
    const sz = bb.getSize(new T.Vector3());
    near.push(`${o.name}(${o.geometry.type} ${sz.toArray().map(v=>+v.toFixed(1)).join('×')})`);
  });
  return { water, hits, near: [...new Set(near)].slice(0, 10) };
};

const SETCAM = ({ pos, tgt }) => {
  const g = window.__garden, c = g.controls;
  c.minDistance = 0.4; c.maxDistance = 400;
  c.target.set(tgt[0], tgt[1], tgt[2]);
  g.camera.position.set(pos[0], pos[1], pos[2]); c.update();
  return true;
};
const NFRAMES = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
const MARK = ({ boxes, W, H }) => {
  const old = document.getElementById('__id2'); if (old) old.remove();
  const cv = document.createElement('canvas');
  cv.id = '__id2'; cv.width = W; cv.height = H;
  Object.assign(cv.style, { position: 'fixed', left: '0', top: '0', zIndex: '99999', pointerEvents: 'none' });
  document.body.appendChild(cv);
  const x = cv.getContext('2d'); x.lineWidth = 2; x.font = 'bold 12px monospace';
  for (const b of boxes){
    x.strokeStyle = b.color; x.fillStyle = b.color;
    x.strokeRect(b.minX-2, b.minY-2, b.maxX-b.minX+5, b.maxY-b.minY+5);
    x.fillText(b.label, Math.max(1, b.minX-2), Math.max(12, b.minY-6));
  }
  return true;
};

const W = 1100, H = 640;
const VIEWS = [
  { tag: 'M1默认', pos: [-20, 17, 32], tgt: [0, 3.5, -1] },
  { tag: 'M3池南俯', pos: [0, 6, 14], tgt: [0, 0.4, 4] },
];
const MAP = {};
for (const se of ['winter', 'summer']){
  const browser = await launchChromium(loadPlaywright().chromium);
  await new Promise(r => server.listen(0, r));
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), { timeout: 180000, polling: 300 });
  await sleep(2500);
  await page.evaluate((s) => { const g = window.__garden; g.guideStop?.();
    g.setEnv('time', 'noon'); g.setEnv('weather', 'clear'); g.setEnv('season', s); }, se);
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
  await sleep(1600);
  for (const V of VIEWS){
    await page.evaluate(SETCAM, { pos: V.pos, tgt: V.tgt });
    await page.evaluate(NFRAMES); await sleep(800);
    const buf = await page.screenshot();
    fs.writeFileSync(path.join(OUT, `id2-${se}-${V.tag}-raw.png`), buf);
    const blobs = findBlobs(decodePNG(buf), 135, 1200, 200000);
    console.log(`\n══════ [${se}] ${V.tag}  L>135 命中 ${blobs.length} 块 ══════`);
    const marks = [];
    for (const b of blobs.slice(0, 6)){
      console.log(`  ${String(b.n).padStart(6)}px ${String(b.bw+'×'+b.bh).padStart(9)} (${b.cx},${b.cy})`
        + `  L=${b.L} sd=${b.sd} 填充${b.fill} 空心${b.hollow}`);
      const r = await page.evaluate(PROBE, { px: b.cx, py: b.cy });
      for (const h of r.hits)
        console.log(`      d=${String(h.d).padStart(6)}m ${h.name.padEnd(18)} ${h.geo.padEnd(18)}`
          + `世界(${h.pos.join(',')})  高出水面${h.aboveWater}m 色${h.color}`
          + ` 法线[${h.normal}]${h.vertexColors ? ' 顶点色' : ''}${h.inst ? ' 实例#' + h.iid : ''}`);
      if (r.near.length) console.log(`      附近: ${r.near.join(' , ')}`);
      const key = `${b.cx},${b.cy}`;
      MAP[`${se}|${V.tag}|${key}`] = { ...b, top: r.hits[0] ? r.hits[0].name : null, above: r.hits[0] ? r.hits[0].aboveWater : null };
      marks.push({ ...b, label: `#${marks.length+1} ${r.hits[0] ? r.hits[0].name : '?'}`, color: '#FF2D55' });
    }
    if (marks.length){
      await page.evaluate(MARK, { boxes: marks, W, H }); await sleep(300);
      fs.writeFileSync(path.join(OUT, `id2-${se}-${V.tag}-标注.png`), await page.screenshot());
      await page.evaluate(() => { const o = document.getElementById('__id2'); if (o) o.remove(); });
    }
  }
  console.log(`\n[${se}] pageerror: ${errors.length ? errors[0] : '0 条'}`);
  await browser.close(); server.close();
}
console.log('\n══ 冬/夏 同机位对照（找"冬季有、夏季被植物盖住"的块）══');
for (const V of VIEWS){
  const win = Object.entries(MAP).filter(([k]) => k.startsWith(`winter|${V.tag}|`));
  const sum = Object.entries(MAP).filter(([k]) => k.startsWith(`summer|${V.tag}|`));
  console.log(`\n[${V.tag}] 冬季 ${win.length} 块 / 夏季 ${sum.length} 块`);
  console.log('  冬季大块：' + win.map(([, v]) => `${v.n}px@(${v.cx},${v.cy})L${v.L}→${v.top}(+${v.above}m)`).join('  |  '));
  console.log('  夏季大块：' + sum.map(([, v]) => `${v.n}px@(${v.cx},${v.cy})L${v.L}→${v.top}(+${v.above}m)`).join('  |  '));
}
