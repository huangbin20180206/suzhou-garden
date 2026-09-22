/* 水面真折射 A/B 样张 —— 只读诊断，**未入链**。
 *
 * 要证明的事只有一件：**池中那几块半浸在水里的石头，进没进折射层**。
 * 所以对比必须是"同一页、同一机位、只在内存里摘掉/装回石的层标记"——
 *   · 换 URL 重开一页对比（`?refract=1` vs `?refract=0`）差的是**整套折射效果**，
 *     石头的覆盖度只占其中一小块，说不出"这一项修好了"；
 *   · 两次独立会话还会引入预热/相位差异（P0-1 那次"蜻蜓 A/B 假绿"就栽在这：
 *     停栖落点每次加载都换，两张图拍的压根不是同一朵花）。
 *   本脚本因此把两档放在**同一次会话**里，逐像素中位数差分，并核对两档机位逐位相等。
 *
 * ⚠️ 水面波纹逐帧动画 → 差异里天然混着波纹噪声。对策同项目既有口径：
 *    每档连拍 7 帧（≈2s，跨一个波纹周期）取**逐像素中位数**再差分，压掉相位噪声。
 *
 * 产物（`outputs/_diag/refract-ab/`）：`A-on.png`（装回）/ `B-unlay.png`（摘掉）/
 * `C-off.png`（整套折射关，仅作参照）/ `AB-panel.png`（三联图：装回 · 摘掉 · 差分×5）。
 * 用法: node probe/_refract-ab.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';
import { decodePNG, meanAbsDiff } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'refract-ab');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 1180, H = 720, FRAMES = 7, GAP = 320;

/* 本轮补进折射层的那批对象：池中三件点名石 + 按材质色认的驳岸石 / 石根草叶。
   口径必须与 `probe/refract-coverage.mjs` 的清单一致，否则 A/B 证明的不是同一件事。 */
const UNLAY = () => {
  const G = window.__garden, MASK = 1 << G.refractInfo().layer;
  const NAMED = ['taihuHero', 'taihuShelf', 'taihuCompanion'];
  const HEX = ['9a9a92', '3f6b34'];
  let n = 0;
  G.scene.traverse(o => {
    const m = o.material;
    const hex = m && !Array.isArray(m) && m.color ? m.color.getHexString() : '';
    if (!(NAMED.includes(o.name) || HEX.includes(hex))) return;
    o.traverse(d => { if ((d.layers.mask & MASK) !== 0){ d.layers.mask &= ~MASK; n++; } });
  });
  return n;
};

function medianImage(imgs){
  const { w, h, bpp } = imgs[0];
  const out = Buffer.alloc(w * h * bpp, 255);
  const n = imgs.length, vals = new Array(n);
  for (let i = 0; i < w * h * bpp; i += bpp){
    for (let k = 0; k < 3; k++){
      for (let j = 0; j < n; j++) vals[j] = imgs[j].data[i + k];
      vals.sort((a, b) => a - b);
      out[i + k] = vals[n >> 1];
    }
  }
  return { w, h, bpp, data: out };
}

/* 页面已就绪 + 机位已停稳的前提下，连拍取中位数 */
async function capture(page, tag){
  const bufs = [];
  for (let i = 0; i < FRAMES; i++){ bufs.push(await page.screenshot()); await sleep(GAP); }
  fs.writeFileSync(path.join(OUT, `${tag}.png`), bufs[0]);
  const cam = await page.evaluate(() => {
    const g = window.__garden, c = g.camera.position, t = g.controls.target;
    return { pos: [c.x, c.y, c.z], target: [t.x, t.y, t.z], info: g.refractInfo() };
  });
  return { median: medianImage(bufs.map(decodePNG)), first: bufs[0], cam };
}

async function settle(page){
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 40000, polling: 200 }).catch(() => {});
  await sleep(600);
  await page.evaluate(() => window.__garden.gotoViewpoint('hero'));
  let prev = null, still = 0, waited = 0;
  for (let i = 0; i < 100 && still < 3 && waited < 20000; i++){
    const p = await page.evaluate(() => {
      const c = window.__garden.camera.position; return [c.x, c.y, c.z];
    });
    if (prev){
      const d = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      still = d < 1e-4 ? still + 1 : 0;
    }
    prev = p; await sleep(150); waited += 150;
  }
  await sleep(900);
  return waited;
}

async function open(page, url){
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 150000, polling: 300 });
  return settle(page);
}

function diffOf(A, B){
  const { w, h, bpp } = A;
  let over12 = 0, over40 = 0, n = 0;
  for (let i = 0; i < w * h * bpp; i += bpp){
    const d = Math.max(Math.abs(A.data[i] - B.data[i]),
                       Math.abs(A.data[i + 1] - B.data[i + 1]),
                       Math.abs(A.data[i + 2] - B.data[i + 2]));
    if (d > 12) over12++;
    if (d > 40) over40++;
    n++;
  }
  return { mean: meanAbsDiff(A, B), p12: over12 / n * 100, p40: over40 / n * 100 };
}

async function panel(page, a, b, la, lb, ldiff){
  const url = await page.evaluate(async ({ a, b, W, H, la, lb, ldiff }) => {
    const load = (src) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.src = src;
    });
    const [ia, ib] = await Promise.all([load('data:image/png;base64,' + a), load('data:image/png;base64,' + b)]);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H * 3 + 96;
    const g = cv.getContext('2d');
    const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
    const tg = tmp.getContext('2d');
    tg.drawImage(ia, 0, 0);
    const da = tg.getImageData(0, 0, W, H);
    tg.clearRect(0, 0, W, H); tg.drawImage(ib, 0, 0);
    const db = tg.getImageData(0, 0, W, H);
    const dd = g.createImageData(W, H);
    for (let i = 0; i < da.data.length; i += 4){
      for (let k = 0; k < 3; k++){
        const v = Math.abs(da.data[i + k] - db.data[i + k]) * 5;
        dd.data[i + k] = v > 255 ? 255 : v;
      }
      dd.data[i + 3] = 255;
    }
    const draw = (img, y, label) => {
      g.fillStyle = '#111'; g.fillRect(0, y - 32, W, 32);
      g.fillStyle = '#fff'; g.font = 'bold 19px sans-serif';
      g.fillText(label, 12, y - 10);
      g.drawImage(img, 0, y);
    };
    draw(ia, 32, la);
    draw(ib, 32 + H + 32, lb);
    g.putImageData(dd, 0, 32 + (H + 32) * 2);
    g.fillStyle = '#111'; g.fillRect(0, 32 + (H + 32) * 2 - 32, W, 32);
    g.fillStyle = '#fff'; g.font = 'bold 19px sans-serif';
    g.fillText(ldiff, 12, 32 + (H + 32) * 2 - 10);
    return cv.toDataURL('image/png');
  }, { a: a.toString('base64'), b: b.toString('base64'), W, H, la, lb, ldiff });
  return Buffer.from(url.split(',')[1], 'base64');
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(150000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const url0 = `http://127.0.0.1:${port}/index.html`;

  /* ── 主对比：同一次会话，装回 vs 摘掉 ── */
  const w1 = await open(page, url0);
  const A = await capture(page, 'A-on');
  /* ⚠️ 噪声底：**什么都不改**再拍一档。水面波纹逐帧动画 + 柳叶摇动，中位数压不掉全部相位差。
     不先量这个数，就没法说 A↔B 的差是"石头的贡献"还是"我自己的噪声" —— P0-1 那次
     "蜻蜓 A/B" 假绿就是这么栽的（两张图拍的压根不是同一个停点）。 */
  const A2 = await capture(page, 'A2-noise');
  const n1 = diffOf(A.median, A2.median);

  const nUn = await page.evaluate(UNLAY);
  await sleep(500);
  const B = await capture(page, 'B-unlay');

  const dmax = Math.max(...A.cam.pos.map((v, i) => Math.abs(v - B.cam.pos[i])),
                        ...A.cam.target.map((v, i) => Math.abs(v - B.cam.target[i])));
  console.log(`[噪声底] 同状态连拍两档（什么都不改）：meanAbsDiff=${n1.mean.toFixed(3)}`
            + ` ｜ 通道差>12 ${n1.p12.toFixed(2)}% ｜ >40 ${n1.p40.toFixed(2)}%`);
  console.log(`[主对比] 同会话 · 相机停稳 ${w1}ms ｜ 摘掉层标记的对象 ${nUn} 件`
            + ` ｜ 机位最大分量差 ${dmax.toExponential(2)}`
            + (dmax < 1e-3 ? ' → 同机位，可比' : ' → ⚠️ 机位变了，差分不可用'));
  const d1 = diffOf(A.median, B.median);
  const snr = d1.mean / n1.mean;
  console.log(`  A 折射层含池中石 vs B 摘掉石：meanAbsDiff=${d1.mean.toFixed(3)}`
            + ` ｜ 通道差>12 ${d1.p12.toFixed(2)}% ｜ >40 ${d1.p40.toFixed(2)}%`
            + ` ｜ 信噪比 ${snr.toFixed(1)}×`);
  /* ❌ 实测结论（2026-09-20，hero 机位）：信噪比 **1.1×** —— 噪声底 4.41 
     vs 摘石 5.04。水面波纹与柳叶逐帧动画是这个机位上的**主导项**，
     而石体被水盖住的部分只占很少像素（掠射角 + 大部分石体在水线之上）。
     → 这条"像素差"路线**在这个视角不成立**，别把它当覆盖度修复的证据。
       能作证的只有 `probe/refract-coverage.mjs` 的**几何判据**（直接读 layer mask）。 */
  const verdict = snr < 2
    ? `⚠️ 信噪比 ${snr.toFixed(1)}× < 2× → 噪声主导，本组差分**不能**作为覆盖度修复的证据`
    : `信噪比 ${snr.toFixed(1)}× ≥ 2× → 差分可用于佐证（仍需几何判据为准）`;
  console.log(`  → ${verdict}`);

  /* ── 参照：整套折射关（换 URL 重开，只作量级参照，不参与"修复"结论）── */
  const w2 = await open(page, url0 + '?refract=0');
  const C = await capture(page, 'C-off');
  const d2 = diffOf(A.median, C.median);
  console.log(`[参照] 整套折射 ${A.cam.info.on ? '开' : '关'} vs 关：meanAbsDiff=${d2.mean.toFixed(3)}`
            + ` ｜ 通道差>12 ${d2.p12.toFixed(2)}%（含水面整体着色变化，非覆盖度）`
            + ` ｜ 停稳 ${w2}ms ｜ 相机 ${C.cam.pos.map(v => v.toFixed(2)).join(',')}`);

  fs.writeFileSync(path.join(OUT, 'AB-panel.png'),
    await panel(page, A.first, B.first,
      'A · 石在折射层里（当前代码 · ?refract=1）',
      'B · 内存里摘掉石的层标记（＝修复前）',
      `差分 |A−B|×5 ｜ 噪声底 ${n1.mean.toFixed(2)} · 信噪比 ${(d1.mean / n1.mean).toFixed(1)}×`
      + ` → ${d1.mean / n1.mean < 2 ? '噪声主导，不能作证据' : '可作佐证'}`));
  console.log(`\n[异物] pageerror=${errs.length}${errs.length ? ' → ' + errs[0] : ''}`);
  console.log(`产物：${OUT}`);
  await browser.close();
  server.close();
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
