// 裁剪 + 放大样张局部（给 vision 复核细节用）
// 用法: node probe/crop-zoom.mjs <in.png> <out.png> [x0] [y0] [w] [h] [zoom]（坐标按比例 0~1）
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
const [inp, outp, x0s = '0.28', y0s = '0.28', ws = '0.44', hs = '0.44', zs = '2'] = process.argv.slice(2);
if (!inp || !outp){ console.error('用法: node probe/crop-zoom.mjs <in.png> <out.png> [x0 y0 w h zoom]'); process.exit(1); }

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  const b64 = fs.readFileSync(path.isAbsolute(inp) ? inp : path.join(ROOT, inp)).toString('base64');
  const out = await page.evaluate(async ({ b64, x0s, y0s, ws, hs, zs }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const x0 = Math.floor(W * +x0s), y0 = Math.floor(H * +y0s);
    const w = Math.floor(W * +ws), h = Math.floor(H * +hs);
    const z = +zs;
    const cv = document.createElement('canvas');
    cv.width = w * z; cv.height = h * z;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, x0, y0, w, h, 0, 0, w * z, h * z);
    return cv.toDataURL('image/png');
  }, { b64, x0s, y0s, ws, hs, zs });
  const dst = path.isAbsolute(outp) ? outp : path.join(ROOT, outp);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, Buffer.from(out.split(',')[1], 'base64'));
  console.log('saved ' + dst);
  await browser.close();
})().catch(e => { console.error('裁剪异常：', e); process.exit(1); });
