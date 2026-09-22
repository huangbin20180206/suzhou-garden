// 一次性验收（2026-09-22 · 汀步石 v2）
//
// v2 改了 src/05-water.js 的 makeSteppingStones() 三处：
//   ① 几何加水平扰动（顶圈外扩 1.7×、底圈 0.5×）→ 打断四条竖直直角边
//   ② 顶面起伏 ±3.5cm → ±5.5cm
//   ③ 每块 rx/rz ±0.035 → ±0.09rad；instanceColor 0.60~0.80 → 0.28~0.54
//
// 本探针回答四个必须回答的问题：
//   Q1 画面上的"白"压下去了没有 → 石头像素 L50/L90/跨度，对比 v1 基线（同机位同季节）
//   Q2 **有没有开缝**（最危险的副作用）→ 几何层：同一 (x,z) 的顶面顶点是否存在多个高度。
//      v2 让顶面顶点与侧面顶圈顶点吃同一个函数，理论上严格重合；但"理论上"不算数。
//   Q3 轮廓真的不是矩形了吗 → 侧面顶/底圈的水平偏移差（=0 就是仍竖直）
//   Q4 折射门禁的豁免还成立吗（水下深度 ≤0.25m）→ 报石头世界 bbox 的最低点
//
// 基线（v1，同机位 M2、冬季 noon clear、来自 outputs/_diag/_stones-v2-scan.mjs）：
//   px=40655  L10=57.7  L50=83.1  L90=127.7  跨度=69.9  rgb=78,85,79  水L=129.1
//
// 用法: node outputs/_diag/_stones-v2-verify.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
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
const CRC_T = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]); };
function encodePNG(w, h, rgba){
  const stride = w*4, raw = Buffer.alloc((stride+1)*h);
  for (let y = 0; y < h; y++){ raw[y*(stride+1)] = 0; rgba.copy(raw, y*(stride+1)+1, y*stride, (y+1)*stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function toRGBA(img){
  const { w, h, bpp, data } = img; const out = Buffer.alloc(w*h*4);
  for (let i = 0; i < w*h; i++){ out[i*4]=data[i*bpp]; out[i*4+1]=data[i*bpp+1]; out[i*4+2]=data[i*bpp+2]; out[i*4+3]=255; }
  return out;
}

/* Q2/Q3/Q4：几何层体检 */
const GEOM = () => {
  const g = window.__garden, T = g.THREE;
  let o = g.scene.getObjectByName('steppingStones');
  if (!o) g.scene.traverse(x => { if (x.isInstancedMesh && x.count === 11 && !o) o = x; });
  if (!o) return null;
  const pos = o.geometry.attributes.position, TOP = 0.09, BOT = -0.09;
  const topKeys = new Map();      // (x,z) → [y...]  仅顶圈与顶面顶点
  let vTop = 0, vBot = 0, maxAbsX = 0, maxAbsZ = 0;
  let topCornerOvershoot = 0, botCornerOvershoot = 0;
  for (let k = 0; k < pos.count; k++){
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    if (Math.abs(y - TOP) < 1e-4){
      vTop++;
      const key = x.toFixed(4) + ',' + z.toFixed(4);
      if (!topKeys.has(key)) topKeys.set(key, []);
      topKeys.get(key).push(y);
      /* 角点水平偏移：原角 (0.34, 0.49) */
      if (Math.abs(x) > 0.30 && Math.abs(z) > 0.45)
        topCornerOvershoot = Math.max(topCornerOvershoot, Math.hypot(x - Math.sign(x)*0.34, z - Math.sign(z)*0.49));
    } else if (Math.abs(y - BOT) < 1e-4){
      vBot++;
      if (Math.abs(x) > 0.30 && Math.abs(z) > 0.45)
        botCornerOvershoot = Math.max(botCornerOvershoot, Math.hypot(x - Math.sign(x)*0.34, z - Math.sign(z)*0.49));
    }
    if (Math.abs(x) > maxAbsX) maxAbsX = Math.abs(x);
    if (Math.abs(z) > maxAbsZ) maxAbsZ = Math.abs(z);
  }
  /* 开缝检测：同一 (x,z) 上出现了多个不同高度 ⇒ 顶面与侧面没贴住 */
  let seam = 0, seamMax = 0;
  for (const [, ys] of topKeys){
    const mx = Math.max(...ys), mn = Math.min(...ys);
    if (mx - mn > 1e-5){ seam++; seamMax = Math.max(seamMax, mx - mn); }
  }
  /* 顶面高度跨距 */
  let yMin = Infinity, yMax = -Infinity;
  for (let k = 0; k < pos.count; k++){
    if (Math.abs(pos.getY(k) - TOP) > 1e-4) continue;
    const yy = pos.getY(k); if (yy < yMin) yMin = yy; if (yy > yMax) yMax = yy;
  }
  const bb = new T.Box3().setFromObject(o);
  const water = g.CFG ? g.CFG.water : 0;
  const col = o.instanceColor ? (() => { const out = [];
    for (let i = 0; i < o.count; i++) out.push(+new T.Color().fromBufferAttribute(o.instanceColor, i).r.toFixed(3)); return out; })() : null;
  return { verts: pos.count, vTop, vBot,
    seamPairs: seam, seamMax: +(seamMax*1000).toFixed(3),
    topSpan: +(yMax - yMin).toFixed(3),
    maxAbsX: +maxAbsX.toFixed(3), maxAbsZ: +maxAbsZ.toFixed(3),
    topCornerOffset: +topCornerOvershoot.toFixed(3), botCornerOffset: +botCornerOvershoot.toFixed(3),
    bboxMinY: +bb.min.y.toFixed(3), bboxMaxY: +bb.max.y.toFixed(3),
    lowestUnderWater: +(water - bb.min.y).toFixed(3),
    instColors: col };
};
const SETCAM = ({ pos, tgt }) => {
  const g = window.__garden, c = g.controls;
  c.minDistance = 0.4; c.maxDistance = 400;
  c.target.set(tgt[0], tgt[1], tgt[2]);
  g.camera.position.set(pos[0], pos[1], pos[2]); c.update();
  return true;
};
const SETCAM_PITCH = ({ pos, pitch }) => {
  const g = window.__garden, c = g.controls, T = g.THREE;
  c.minDistance = 0.4; c.maxDistance = 400;
  const dir = new T.Vector3(-pos[0], 0, 3 - pos[2]).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize(); dir.y = Math.tan(pitch * Math.PI / 180); dir.normalize();
  c.target.set(pos[0] + dir.x*20, pos[1] + dir.y*20, pos[2] + dir.z*20);
  g.camera.position.set(pos[0], pos[1], pos[2]); c.update();
  return true;
};
const TOGGLE = ({ v }) => {
  const g = window.__garden;
  let o = g.scene.getObjectByName('steppingStones');
  if (!o) g.scene.traverse(x => { if (x.isInstancedMesh && x.count === 11 && !o) o = x; });
  if (!o) return null; o.visible = v; return true;
};
const NFRAMES = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));

function analyse(A, B){
  const { w, h, bpp, data: DA } = A, DB = B.data;
  const stone = [], waterS = [];
  const mark = new Uint8Array(w*h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++){
    const i = (py*w+px)*bpp;
    const dd = Math.max(Math.abs(DA[i]-DB[i]), Math.abs(DA[i+1]-DB[i+1]), Math.abs(DA[i+2]-DB[i+2]));
    if (dd > 20){ stone.push({ L: LUM(DA[i],DA[i+1],DA[i+2]), r: DA[i], g: DA[i+1], b: DA[i+2] }); mark[py*w+px] = 1; }
  }
  /* 水面参考：石头外、画幅下半（近景水面） */
  for (let py = (h*0.35)|0; py < (h*0.95)|0; py += 2) for (let px = 0; px < w; px += 2){
    const i = (py*w+px)*bpp;
    const dd = Math.max(Math.abs(DA[i]-DB[i]), Math.abs(DA[i+1]-DB[i+1]), Math.abs(DA[i+2]-DB[i+2]));
    if (dd <= 5) waterS.push(LUM(DA[i],DA[i+1],DA[i+2]));
  }
  const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x,y)=>x-y); return s[Math.min(s.length-1, (p*s.length)|0)]; };
  return { px: stone.length, L10: +q(stone.map(o=>o.L),0.10).toFixed(1), L50: +q(stone.map(o=>o.L),0.50).toFixed(1),
    L90: +q(stone.map(o=>o.L),0.90).toFixed(1),
    span: +(q(stone.map(o=>o.L),0.90) - q(stone.map(o=>o.L),0.10)).toFixed(1),
    rgb: stone.length ? [Math.round(q(stone.map(o=>o.r),0.5)), Math.round(q(stone.map(o=>o.g),0.5)), Math.round(q(stone.map(o=>o.b),0.5))] : null,
    waterL: +q(waterS,0.5).toFixed(1), contrast: +(q(stone.map(o=>o.L),0.5) - q(waterS,0.5)).toFixed(1),
    whitePct: stone.length ? +(stone.filter(o=>o.L>150).length/stone.length*100).toFixed(1) : 0,
    mark };
}

const W = 900, H = 520;
const browser = await launchChromium(loadPlaywright().chromium);
await new Promise(r => server.listen(0, r));
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), { timeout: 180000, polling: 300 });
await sleep(2500);
await page.evaluate(() => { const g = window.__garden; g.guideStop?.(); g.setEnv('time','noon');
  g.setEnv('weather','clear'); g.setEnv('season','winter'); });
await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 }).catch(() => {});
await sleep(1600);

console.log('══ Q2/Q3/Q4 几何体检（v2 后）══');
const gm = await page.evaluate(GEOM);
console.log('  ' + JSON.stringify(gm, null, 0).replace(/","/g, '",\n  "'));
console.log(`  → 开缝: ${gm.seamPairs === 0 ? '✅ 无（同一 (x,z) 只有一个高度）' : '❌ ' + gm.seamPairs + ' 处，最大 ' + gm.seamMax + 'mm'}`);
console.log(`  → 侧面是否还竖直: 顶圈角点偏移 ${gm.topCornerOffset}m / 底圈 ${gm.botCornerOffset}m`
  + ` ⇒ ${Math.abs(gm.topCornerOffset - gm.botCornerOffset) > 0.02 ? '✅ 侧面已倾斜（不再是直角竖边）' : '❌ 仍竖直'}`);
console.log(`  → 折射门禁: 最低点水下 ${gm.lowestUnderWater}m ${gm.lowestUnderWater <= 0.25 ? '✅ ≤0.25 豁免成立' : '❌ 越过上限'}`);

console.log('\n══ Q1 画面亮度（同机位 M2 低视高 · 冬季 noon clear）══');
await page.evaluate(SETCAM_PITCH, { pos: [-1.5, 0.75, 9.6], pitch: -6 });
await page.evaluate(NFRAMES); await sleep(900);
const onBuf = await page.screenshot();
await page.evaluate(TOGGLE, { v: false }); await page.evaluate(NFRAMES); await sleep(500);
const offBuf = await page.screenshot();
await page.evaluate(TOGGLE, { v: true }); await page.evaluate(NFRAMES); await sleep(300);
fs.writeFileSync(path.join(OUT, 'stones-v2-ON.png'), onBuf);
fs.writeFileSync(path.join(OUT, 'stones-v2-OFF.png'), offBuf);
const st = analyse(decodePNG(onBuf), decodePNG(offBuf));
console.log(`  v1 基线:  px=40655  L10=57.7  L50=83.1  L90=127.7  跨度=69.9  rgb=78,85,79   水L=129.1  对比=-46.0`);
console.log(`  v2 现在:  px=${st.px}  L10=${st.L10}  L50=${st.L50}  L90=${st.L90}  跨度=${st.span}`
  + `  rgb=${st.rgb}   水L=${st.waterL}  对比=${st.contrast}`);
console.log(`  亮部(L>150)占石头 ${st.whitePct}%`);
const rgba = toRGBA(decodePNG(onBuf));
for (let i = 0; i < st.mark.length; i++) if (st.mark[i]){ rgba[i*4]=255; rgba[i*4+1]=40; rgba[i*4+2]=220; }
fs.writeFileSync(path.join(OUT, 'stones-v2-差分.png'), encodePNG(W, H, rgba));

/* 石头特写：给老黄直接看轮廓长什么样 */
await page.evaluate(SETCAM, { pos: [1.2, 1.5, 8.4], tgt: [1.6, 0.05, 5.9] });
await page.evaluate(NFRAMES); await sleep(800);
fs.writeFileSync(path.join(OUT, 'stones-v2-特写.png'), await page.screenshot());
console.log('\n样张：stones-v2-ON/OFF/差分/特写.png');
console.log(`pageerror: ${errors.length ? errors[0] : '0 条'}`);
await browser.close(); server.close();
