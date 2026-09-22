// 「云根近观」机位端到端验证：走产品自己的 gotoViewpoint 飞行，落位后量**实际**相机距离。
// 为什么要端到端：OrbitControls.update() 每帧把半径夹到 [minDistance, maxDistance]，
// 而渲染循环是 updateCamFly() → controls.update() 的顺序 —— 只要 minDistance 没在该机位放开，
// 相机一落位就被弹回 9m，"近观"静默失效（行程还是走完了、也不报错）。按几何反算的
// pos/target 是**输入**，不是结果，只有量落位后的真实距离才算验过。
// 产出：outputs/visual/09h-stele-station.png（实景，UI 隐藏）
// 用法: node probe/stele-station.mjs
import http from 'node:http';
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000 });
  await page.waitForFunction(() => {
    let s = false; window.__garden.scene.traverse(o => { if (o.name === 'steleGroup') s = true; });
    return s;
  }, { timeout: 300000 });
  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 180000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());
  await page.evaluate(() => {
    for (const id of ['env', 'hud', 'stats', 'caption']){
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    }
  });

  const ask = await page.evaluate(() => {
    const g = window.__garden;
    const v = (g.VIEWPOINTS || []).find(x => x.id === 'stele');
    if (!v) return { ok: false, why: '没有 id=stele 的机位' };
    const want = +v.pos.distanceTo(v.target).toFixed(2);
    const ok = g.gotoViewpoint('stele');
    return { ok, want, minDist: v.minDist == null ? null : v.minDist,
             minDuringFlight: +g.controls.minDistance.toFixed(2),
             pos: v.pos.toArray().map(n => +n.toFixed(2)),
             tgt: v.target.toArray().map(n => +n.toFixed(2)) };
  });
  console.log('[机位] 期望距离', ask.want, 'm ｜ 机位', JSON.stringify(ask.pos), '→ 目标', JSON.stringify(ask.tgt));
  console.log('[机位] 机位自带 minDist =', ask.minDist, '｜ 飞行途中 controls.minDistance =', ask.minDuringFlight);

  const arrived = await page.waitForFunction(() => !window.__garden.camFly(),
    { timeout: 120000, polling: 250 }).then(() => true).catch(() => false);

  /* 落位后必须再等真实帧，否则量到/拍到的是旧帧 */
  await page.evaluate(() => new Promise(r => {
    let n = 0; const f = () => { if (++n >= 3) r(); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));

  const got = await page.evaluate(() => {
    const g = window.__garden;
    return {
      camFly: g.camFly(),
      cam: g.camera.position.toArray().map(n => +n.toFixed(2)),
      tgt: g.controls.target.toArray().map(n => +n.toFixed(2)),
      dist: +g.camera.position.distanceTo(g.controls.target).toFixed(2),
      minDist: +g.controls.minDistance.toFixed(2),
    };
  });
  console.log(`[落位] 飞行结束=${arrived && !got.camFly} ｜ 相机 ${JSON.stringify(got.cam)} → 目标 ${JSON.stringify(got.tgt)}`);
  console.log(`[落位] 实际距离 ${got.dist}m ｜ controls.minDistance 已恢复为 ${got.minDist}`);
  const drift = Math.abs(got.dist - ask.want);
  console.log(`${drift < 0.35 && got.dist < 9 ? '✓' : '✗'} 落位距离与设定一致（差 ${drift.toFixed(2)}m）且未被弹回 9m`);

  const buf = await page.screenshot();
  fs.mkdirSync(path.join(ROOT, 'outputs', 'visual'), { recursive: true });
  const dst = path.join(ROOT, 'outputs', 'visual', '09h-stele-station.png');
  fs.writeFileSync(dst, buf);
  console.log('saved ' + dst);

  /* 实景（非净室）中心区明暗结构：只作参考数字，硬判据在 stele-legibility 的净室项 */
  const r = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const W = cv.width, H = cv.height, d = cx.getImageData(0, 0, W, H).data;
    const lum = i => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const arr = [];
    for (let y = Math.floor(H * 0.3); y < Math.floor(H * 0.7); y += 2)
      for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.7); x += 2) arr.push(lum((y * W + x) * 4));
    const s = arr.slice().sort((a, b) => a - b);
    const q = k => s[Math.floor(k * (s.length - 1))];
    return { spread: +(q(.95) - q(.05)).toFixed(1), ink: +(arr.filter(v => v < q(.5) - 26).length / arr.length * 100).toFixed(2) };
  }, buf.toString('base64'));
  console.log(`[实景·参考] 中心区跨度 ${r.spread} ｜ 暗像素 ${r.ink}%（含草地/背景，不作判定）`);
  if (errs.length) console.log('[页面报错]', errs.slice(0, 3).join(' | '));

  try { await browser.close(); } catch {}
  server.close();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error('机位端到端探针异常：', e); process.exit(1); });
