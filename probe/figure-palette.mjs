// 参考图「人物服色」取样（2026-09-18）：把老黄给的画风参考图丢进 headless canvas 解码，
// 按 HSV **色相分桶**统计高饱和像素（= 人物衣着），另报低饱和像素（= 背景/水面/粉墙）的明度，
// 用来客观回答两个问题：①参考图里的人都穿哪些颜色 ②人物与背景的明度差有多大（对比预算）。
// 不靠肉眼估色 —— 紫藤那次凭感觉调色，渐变方向写反两轮没人发现。
// 用法: node probe/figure-palette.mjs <image> [x0 y0 x1 y1]   （裁剪坐标为 0~1 归一化）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}

const imgPath = process.argv[2];
if (!imgPath){ console.error('用法: node probe/figure-palette.mjs <image> [x0 y0 x1 y1]'); process.exit(2); }
const crop = process.argv.length >= 7 ? process.argv.slice(3, 7).map(Number) : null;

const buf = fs.readFileSync(imgPath);
const mime = /\.png$/i.test(imgPath) ? 'image/png' : 'image/jpeg';
const dataURL = `data:${mime};base64,` + buf.toString('base64');

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage();
page.on('console', m => console.log(m.text()));

const out = await page.evaluate(async (arg) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = arg.src; });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const cr = arg.crop
    ? { x0: Math.round(arg.crop[0] * c.width),  y0: Math.round(arg.crop[1] * c.height),
        x1: Math.round(arg.crop[2] * c.width),  y1: Math.round(arg.crop[3] * c.height) }
    : { x0: 0, y0: 0, x1: c.width, y1: c.height };
  const W = cr.x1 - cr.x0, H = cr.y1 - cr.y0;
  const d = ctx.getImageData(cr.x0, cr.y0, W, H).data;

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
  const mean = arr => {
    if (!arr.length) return null;
    const s = arr.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    const m = s.map(v => v / arr.length);
    return { rgb: m.map(v => Math.round(v)), hex: hex(m[0], m[1], m[2]),
             lum: Math.round(lum(m[0], m[1], m[2]) * 10) / 10, n: arr.length };
  };
  const byLum = arr => arr.slice().sort((a, b) => lum(b[0], b[1], b[2]) - lum(a[0], a[1], a[2]));
  const quart = (arr, end) => {
    if (!arr.length) return null;
    const k = Math.max(1, Math.round(arr.length * 0.25));
    return mean(end === 'lit' ? arr.slice(0, k) : arr.slice(-k));
  };

  /* 分桶：色相区间 + 饱和度/明度门槛。门槛压住纸纹、水印、灰砖这些"脏像素" */
  const BUCKETS = [
    ['蓝（靛/宝蓝）', 200, 265],
    ['紫（藕荷/紫棠）', 265, 325],
    ['青（天青/青绿）', 160, 200],
    ['绿（松绿）',     90, 160],
    ['黄橙（秋香/赭）', 28,  70],
    ['红（绛/砖红）',   0,  28],
    ['红（绛/砖红）', 325, 360],
  ];
  const isCloth = (h, s, v) => s >= 0.18 && v >= 0.10 && v <= 0.97;
  const isBack  = (s, v) => s < 0.14 && v > 0.05;

  const buckets = BUCKETS.map(([nm, lo, hi]) => [nm, lo, hi, []]);
  const back = [];
  let total = 0;
  for (let i = 0; i < d.length; i += 4){
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const [h, s, v] = rgb2hsv(r, g, b);
    total++;
    if (isCloth(h, s, v)){
      for (const bk of buckets){ if (h >= bk[1] && h < bk[2]){ bk[3].push([r, g, b]); break; } }
    } else if (isBack(s, v)) back.push([r, g, b]);
  }

  console.log(`[参考图] ${arg.name}  裁剪 ${cr.x0},${cr.y0} → ${cr.x1},${cr.y1}  (${W}x${H})`);
  console.log(`  衣色候选像素 ${buckets.reduce((a, b) => a + b[3].length, 0)} / ${total}` +
              `  (${(100 * buckets.reduce((a, b) => a + b[3].length, 0) / total).toFixed(1)}%)`);
  const res = [];
  for (const [nm, , , arr] of buckets){
    if (arr.length < total * 0.002) continue;
    const m = mean(arr);
    console.log(`  ${nm.padEnd(16)} n=${String(arr.length).padStart(6)}  ${(100 * arr.length / total).toFixed(1).padStart(5)}%` +
                `  均值 ${m.hex} L=${m.lum}   受光 ${quart(byLum(arr), 'lit').hex}   背光 ${quart(byLum(arr), 'dark').hex}`);
    res.push({ nm, hex: m.hex, lum: m.lum, share: arr.length / total,
               lit: quart(byLum(arr), 'lit').hex, dark: quart(byLum(arr), 'dark').hex });
  }
  const bm = mean(back);
  console.log(`  背景（低饱和）   n=${back.length}  ${(100 * back.length / total).toFixed(1)}%` +
              `  均值 ${bm ? bm.hex + ' L=' + bm.lum : '无样本'}` +
              `   暗部25% ${quart(byLum(back), 'dark').hex} L=${quart(byLum(back), 'dark').lum}`);

  const lit = res.length ? Math.max(...res.map(r => lum(...r.hex.slice(1).match(/../g).map(x => parseInt(x, 16))))) : 0;
  return { res, backMean: bm, lit, backDark: quart(byLum(back), 'dark') };
}, { src: dataURL, name: path.basename(imgPath), crop });

/* 对比预算：衣色最亮处与背景最暗处的明度差 —— 小于 40 时，小尺寸点景人物会糊进背景 */
if (out.backDark){
  const gap = out.lit - out.backDark.lum;
  console.log(`\n[对比预算] 衣色最亮 L=${Math.round(out.lit)} vs 背景暗部 L=${out.backDark.lum}` +
              ` → 明度差 ${Math.round(gap)}${gap < 40 ? '  ⚠️ 偏小' : '  ✓ 够'}`);
}
await browser.close();
