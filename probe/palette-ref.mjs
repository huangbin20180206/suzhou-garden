// 参考图调色板取样（2026-09-17）：把老黄给的紫藤参考图丢进 headless canvas 解码，
// 按 HSV 色相把像素分成「花（紫）」与「叶（绿）」两类，再沿花穗竖直方向分带统计 ——
// 用来**客观**确认渐变方向（上浅下深还是反过来）与叶片实际黄绿值，不靠肉眼猜。
// 只读外部图片，不碰场景代码。用法: node probe/palette-ref.mjs <image>
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

const imgPath = process.argv[2];
if (!imgPath){ console.error('用法: node probe/palette-ref.mjs <image>'); process.exit(2); }
const buf = fs.readFileSync(imgPath);
const mime = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';
const dataURL = `data:${mime};base64,` + buf.toString('base64');

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage();
/* 页面上下文里的 console.log 不会自动回传到 node 的 stdout —— 必须显式转发 */
page.on('console', m => console.log(m.text()));

const out = await page.evaluate(async (arg) => {
  const src = arg.src;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;

  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const rgb2hsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn;
    let h = 0;
    if (df > 1e-6){
      if (mx === r) h = 60 * (((g - b) / df) % 6);
      else if (mx === g) h = 60 * ((b - r) / df + 2);
      else h = 60 * ((r - g) / df + 4);
    }
    if (h < 0) h += 360;
    return [h, mx > 0 ? df / mx : 0, mx];
  };
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /* 分类阈值刻意收窄：pngtree 水印是低饱和近白，会被 sat 门槛挡掉 */
  const isFlower = (h, s, v) => h >= 258 && h <= 312 && s >= 0.16 && v >= 0.18;
  const isLeaf   = (h, s, v) => h >= 62  && h <= 115 && s >= 0.22 && v >= 0.22;

  const flower = [], leaf = [];
  for (let i = 0; i < d.length; i += 4){
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const [h, s, v] = rgb2hsv(r, g, b);
    if (isFlower(h, s, v)) flower.push([r, g, b, 0, i / 4]);
    else if (isLeaf(h, s, v)) leaf.push([r, g, b, 0, i / 4]);
  }
  const W = c.width;
  const px = p => [p[4] % W, (p[4] / W) | 0];
  const mean = arr => {
    if (!arr.length) return null;
    const s = arr.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    const m = s.map(v => v / arr.length);
    return { rgb: m.map(v => Math.round(v)), hex: hex(m[0], m[1], m[2]),
             lum: Math.round(lum(m[0], m[1], m[2]) * 10) / 10, n: arr.length };
  };
  /* 每带再分「受光 25% / 背光 25%」：照片带阴影，只取均值会低估花瓣本色 */
  const byLum = arr => arr.slice().sort((a, b) => lum(b[0], b[1], b[2]) - lum(a[0], a[1], a[2]));
  const quart = (arr, end) => {
    if (!arr.length) return null;
    const k = Math.max(1, Math.round(arr.length * 0.25));
    return mean(end === 'lit' ? arr.slice(0, k) : arr.slice(-k));
  };

  // 花穗竖直分带：按紫像素的 y 跨度的三等分（上/中/下）分别求均值
  let fminY = 1e9, fmaxY = -1e9;
  for (const p of flower){ const y = px(p)[1]; if (y < fminY) fminY = y; if (y > fmaxY) fmaxY = y; }
  const band = (lo, hi) => flower.filter(p => { const y = px(p)[1] / (fmaxY || 1); return y >= lo && y < hi; });

  const leafBright = byLum(leaf);
  const top = (arr, f) => arr.slice(0, Math.max(1, Math.round(arr.length * f)));

  const vs = c.width + 'x' + c.height;
  console.log(`[参考图] ${arg.name}  ${vs}`);
  console.log(`  花(紫) 像素 ${flower.length}  y跨度 ${fminY}~${fmaxY}`);
  const line = (nm, m) => console.log('    ' + nm + ': ' + (m ? m.hex + '  rgb(' + m.rgb.join(',') + ')  L=' + m.lum + '  n=' + m.n : '无样本'));
  const bands = [['穗上 1/3', band(0, 1 / 3)], ['穗中 1/3', band(1 / 3, 2 / 3)], ['穗下 1/3', band(2 / 3, 1.01)]];
  const fTop = mean(bands[0][1]), fBot = mean(bands[2][1]);
  for (const [nm, arr] of bands){
    line(nm + ' 均值', mean(arr));
    line(nm + ' 受光25%', quart(byLum(arr), 'lit'));
    line(nm + ' 背光25%', quart(byLum(arr), 'dark'));
  }
  console.log(`  叶(绿) 像素 ${leaf.length}`);
  const lAll = mean(leaf);
  for (const [nm, m] of [['全叶均值', lAll], ['受光 25%', mean(top(leafBright, 0.25))],
                          ['背光 25%', mean(leafBright.slice(-Math.max(1, Math.round(leaf.length * 0.25))))]])
    line(nm, m);
  return { fTop, fBot, lAll, lBright: mean(top(leafBright, 0.25)) };
}, { src: dataURL, name: path.basename(imgPath) });

/* 方向判据用「明度」而不是色值本身：花穗由上到下若 L 递减，就是"上浅下深" */
const { fTop, fMid, fBot } = out;
if (fTop && fMid && fBot){
  const dir = fTop.lum > fBot.lum ? '上浅下深（基部淡 → 穗梢浓）' : '上深下浅（基部浓 → 穗梢淡）';
  console.log(`\n[结论] 花穗渐变方向：${dir}`);
}
await browser.close();
