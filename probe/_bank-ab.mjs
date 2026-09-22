// 一次性取证（2026-09-22 · 岸草环 bank 的 A/B 判决）
//
// 上游线索链：
//   · _whitebox-hunt.mjs 扫出"亮 + 空心"的块，但没有世界坐标 ⇒ 定不了对象。
//   · _whitebox-id2.mjs 补上世界坐标后，命中一条决定性记录：
//       (无名) ShapeGeometry  世界(-17.57, 0.02, 5.03)  法线[0,1,0]
//     而 src/05-water.js 里 bank（池岸草环）正是
//       ShapeGeometry(外轮廓 POND_PTS×1.14 + hole 内轮廓 POND_PTS)，
//       bank.position.set(0, CFG.water + 0.02, 3.0)，匿名、noMerge。
//     ⇒ 一个横跨 35m 的**环形带**，只比水面高 2cm，材质 MAT.grass ——
//       而 MAT.grass 就在 SNOW_COVER_MATS 第 1 位 ⇒ 冬季整圈积雪变白。
//
// 本探针做三件不许含糊的事：
//   ① 按几何特征定位 bank（ShapeGeometry + 匿名 + 跨度 > 20m），报它的世界包围盒
//      —— 先证明"我抓的这个对象"跟代码里的 bank 是同一个（而不是又认错人）。
//   ② **逐件隐藏 A/B**：藏 bank / 藏汀步石 / 藏驳岸石，各量全屏差分 + 变化像素的
//      亮度 + **变化区域的 3×3 网格分布**（"一圈"会铺满边缘格，"一块"只占一两格）。
//   ③ **冬/夏 同机位对照**：同构建只切季节，量 bank 覆盖像素的实际渲染色 ——
//      直接回答"冬季它到底白成什么样"，而不是靠推理。
//   另外输出**差分可视化图**（变化像素染洋红叠在原图上），供老黄目视指认。
//
// 用法: node outputs/_diag/_bank-ab.mjs
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

/* ── 极简 PNG 编码（colorType 6, filter 0），用于输出差分可视化图 ── */
const CRC_T = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]); };
function encodePNG(w, h, rgba){
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++){ raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ── 对象定位 ── */
const FIND = () => {
  const g = window.__garden, T = g.THREE;
  let bank = null; const stones = [], rocks = [];
  g.scene.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh)) return;
    if (!bank && o.geometry && o.geometry.type === 'ShapeGeometry' && !o.name){
      const sz = new T.Box3().setFromObject(o).getSize(new T.Vector3());
      if (sz.x > 20) bank = o;
    }
    if (o.name === 'steppingStones') stones.push(o);
    if (o.isInstancedMesh && !o.name){
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.color && m.color.getHexString() === '9a9a92') rocks.push(o);
    }
  });
  const bb = o => { const b = new T.Box3().setFromObject(o), s = b.getSize(new T.Vector3());
    return { min: b.min.toArray().map(v => +v.toFixed(2)), max: b.max.toArray().map(v => +v.toFixed(2)),
             size: s.toArray().map(v => +v.toFixed(2)) }; };
  return {
    bank: bank ? { geo: bank.geometry.type, name: bank.name || '(匿名)', bb: bb(bank),
      mat: bank.material.name || '(无名材质)', hex: '#' + bank.material.color.getHexString(),
      count: bank.geometry.attributes.position.count } : null,
    stones: stones.map(o => ({ name: o.name, count: o.count, bb: bb(o) })),
    rocks: rocks.map(o => ({ geo: o.geometry.type, count: o.count, bb: bb(o),
      hex: '#' + (Array.isArray(o.material) ? o.material[0] : o.material).color.getHexString() })),
  };
};
const HIDE = ({ which, v }) => {
  const g = window.__garden, T = g.THREE;
  const hit = [];
  g.scene.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh)) return;
    let on = false;
    if (which === 'bank') on = o.geometry && o.geometry.type === 'ShapeGeometry' && !o.name
      && new T.Box3().setFromObject(o).getSize(new T.Vector3()).x > 20;
    if (which === 'stones') on = o.name === 'steppingStones';
    if (which === 'rocks'){ const m = Array.isArray(o.material) ? o.material[0] : o.material;
      on = o.isInstancedMesh && !o.name && m && m.color && m.color.getHexString() === '9a9a92'; }
    if (on){ o.visible = v; hit.push(o.name || o.geometry.type); }
  });
  return hit;
};
const SETCAM = ({ pos, tgt }) => {
  const g = window.__garden, c = g.controls;
  c.minDistance = 0.4; c.maxDistance = 400;
  c.target.set(tgt[0], tgt[1], tgt[2]);
  g.camera.position.set(pos[0], pos[1], pos[2]); c.update();
  return true;
};
const NFRAMES = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));

/* 差分：全屏 + 3×3 网格分布 + 变化像素亮度；顺带产出可视化 rgba */
function diff(A, B, markRGBA){
  const { w, h, bpp, data: DA } = A, DB = B.data;
  const grid = new Array(9).fill(0);
  const Ls = []; let n = 0;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++){
    const i = (py * w + px) * bpp;
    const dd = Math.max(Math.abs(DA[i]-DB[i]), Math.abs(DA[i+1]-DB[i+1]), Math.abs(DA[i+2]-DB[i+2]));
    if (dd <= 15) continue;
    n++; Ls.push(LUM(DA[i], DA[i+1], DA[i+2]));
    grid[Math.min(2, (py * 3 / h) | 0) * 3 + Math.min(2, (px * 3 / w) | 0)]++;
    if (markRGBA){ const o = (py * w + px) * 4; markRGBA[o] = 255; markRGBA[o+1] = 40; markRGBA[o+2] = 220; }
  }
  const q = p => { if (!Ls.length) return 0; const s = [...Ls].sort((x, y) => x - y); return s[Math.min(s.length-1, (p * s.length) | 0)]; };
  return { n, pct: +(n / (w * h) * 100).toFixed(2), L50: +q(0.5).toFixed(1), L90: +q(0.9).toFixed(1),
    grid: grid.map(g => +(g / (w * h) * 100).toFixed(2)) };
}
/* 亮块总面积（判定"白框还在不在"） */
function brightArea(img, thr = 135){
  const { w, h, bpp, data } = img; let n = 0;
  for (let i = 0; i < w * h; i++){ const p = i * bpp; if (LUM(data[p], data[p+1], data[p+2]) > thr) n++; }
  return n;
}
function toRGBA(img){
  const { w, h, bpp, data } = img; const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++){
    out[i*4] = data[i*bpp]; out[i*4+1] = data[i*bpp+1]; out[i*4+2] = data[i*bpp+2]; out[i*4+3] = 255;
  }
  return out;
}

const W = 1100, H = 640;
const VIEWS = [
  { tag: 'V1默认',   pos: [-20, 17, 32], tgt: [0, 3.5, -1] },
  { tag: 'V2池南俯', pos: [0, 6, 14],    tgt: [0, 0.4, 4] },
  { tag: 'V3池东低', pos: [15, 2.6, 3],  tgt: [0, 0.3, 3] },
];
const TARGETS = ['bank', 'stones', 'rocks'];

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
  const found = await page.evaluate(FIND);
  console.log(`\n████████ [${se}] 对象定位 ████████`);
  console.log('  bank   : ' + JSON.stringify(found.bank));
  console.log('  stones : ' + JSON.stringify(found.stones));
  console.log('  rocks  : ' + JSON.stringify(found.rocks));

  for (const V of VIEWS){
    await page.evaluate(SETCAM, { pos: V.pos, tgt: V.tgt });
    await page.evaluate(NFRAMES); await sleep(700);
    console.log(`\n── [${se}] ${V.tag} ──`);
    for (const t of TARGETS){
      const hit = await page.evaluate(HIDE, { which: t, v: true });
      await page.evaluate(NFRAMES); await sleep(400);
      const onBuf = await page.screenshot();
      await page.evaluate(HIDE, { which: t, v: false });
      await page.evaluate(NFRAMES); await sleep(500);
      const offBuf = await page.screenshot();
      await page.evaluate(HIDE, { which: t, v: true });
      await page.evaluate(NFRAMES); await sleep(300);
      const A = decodePNG(onBuf), B = decodePNG(offBuf);
      if (t === TARGETS[0]) fs.writeFileSync(path.join(OUT, `bankab-${se}-${V.tag}-ON.png`), onBuf);
      const mark = toRGBA(A);
      const d = diff(A, B, mark);
      fs.writeFileSync(path.join(OUT, `bankab-${se}-${V.tag}-藏${t}-差分.png`), encodePNG(W, H, mark));
      if (t === TARGETS[0]) fs.writeFileSync(path.join(OUT, `bankab-${se}-${V.tag}-OFF.png`), offBuf);
      console.log(`   藏 ${t.padEnd(6)} (${hit.length} 件) 变化 ${String(d.pct).padStart(6)}%  ${d.n}px`
        + `  变化处亮度 L50=${d.L50} L90=${d.L90}  网格[${d.grid.join(' ')}]`
        + `  亮块(L>135) ${brightArea(A)}→${brightArea(B)}`);
    }
  }
  console.log(`\n[${se}] pageerror: ${errors.length ? errors[0] : '0 条'}`);
  await browser.close(); server.close();
}
