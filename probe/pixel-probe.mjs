// 样张像素自证探针：把「可读性 / 对比度」从主观描述变成数字。
// 用法: node probe/pixel-probe.mjs <png> [png...]
// 判据前提：特写机位的 target = 字心，所以**画面中心区**就是刻字所在。
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

const imgs = process.argv.slice(2);
if (!imgs.length){ console.error('用法: node probe/pixel-probe.mjs <png> [...]'); process.exit(1); }

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');

  for (const f of imgs){
    const abs = path.isAbsolute(f) ? f : path.join(ROOT, f);
    if (!fs.existsSync(abs)){ console.log('MISSING ' + abs); continue; }
    const b64 = fs.readFileSync(abs).toString('base64');
    const r = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0);
      const W = cv.width, H = cv.height;
      const d = cx.getImageData(0, 0, W, H).data;
      const lum = i => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const pct = (a, q) => { const s = a.slice().sort((m, n) => m - n); return s[Math.floor(q * (s.length - 1))]; };
      const all = [];
      for (let i = 0; i < d.length; i += 4 * 11) all.push(lum(i));
      /* 中心区 = 刻字所在（机位 target 对准字心） */
      const x0 = Math.floor(W * 0.28), x1 = Math.floor(W * 0.72);
      const y0 = Math.floor(H * 0.28), y1 = Math.floor(H * 0.72);
      const ctr = [];
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) ctr.push(lum((y * W + x) * 4));
      const p5 = pct(ctr, 0.05), p50 = pct(ctr, 0.50), p95 = pct(ctr, 0.95);
      /* 墨迹像素：比中心区中位数暗 26 以上（刻痕/字） */
      const ink = ctr.filter(v => v < p50 - 26).length / ctr.length;
      const bright = ctr.filter(v => v > p50 + 26).length / ctr.length;
      return {
        W, H,
        allP: [+pct(all, .05).toFixed(1), +pct(all, .5).toFixed(1), +pct(all, .95).toFixed(1)],
        ctr: [+p5.toFixed(1), +p50.toFixed(1), +p95.toFixed(1)],
        spread: +(p95 - p5).toFixed(1),
        ink: +(ink * 100).toFixed(2),
        bright: +(bright * 100).toFixed(2),
        n: ctr.length,
      };
    }, b64);
    console.log(`\n=== ${path.basename(abs)} (${r.W}x${r.H}) ===`);
    console.log(`  全图亮度 P5/P50/P95 = ${r.allP.join(' / ')}`);
    console.log(`  中心区亮度 P5/P50/P95 = ${r.ctr.join(' / ')}  跨度 ${r.spread}`);
    console.log(`  暗于中位数 26+ 的像素（刻痕/字）占比 ${r.ink}%  ｜ 亮于中位数 26+ 的占比 ${r.bright}%`);
    console.log(`  判定：${r.spread >= 45 && r.ink >= 1.5 ? '中心区有足够明暗结构（字/刻痕可分辨）'
      : r.spread >= 45 ? '有对比但暗像素偏少（字可能太细/太淡）'
      : '⚠️ 中心区对比不足（跨度 ' + r.spread + ' < 45）→ 字读不出来'}`);
  }
  await browser.close();
})().catch(e => { console.error('像素探针异常：', e); process.exit(1); });
