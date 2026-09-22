// 题名石「净室」验证：只留题名石、其它网格全隐、相机正对刻字面。
// 为什么必须净室：实景里刻字面会被立峰/驳岸/植被遮挡，且我的像素判据（"偏绿"）会被
// 草地和竹叶污染（实测：把石材材质 visible=false，绿仍占 12.9%）—— 在实景里量刻字
// 等于在噪声里找信号。净室里几何/UV/贴图有没有问题一目了然。
// 产出：outputs/visual/09d-stele-clean.png
// 用法: node probe/stele-clean.mjs
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

const DIST = +(process.argv[2] || 1.9);

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

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

  const info = await page.evaluate((DIST) => {
    const g = window.__garden, T = g.THREE;
    let stele = null, slab = null;
    g.scene.traverse(o => { if (o.name === 'steleGroup') stele = o; });
    stele.traverse(o => { if (o.geometry && !slab) slab = o; });

    /* 净室：隐掉题名石子树以外的一切可渲染对象（灯/相机留着，否则全黑） */
    const keep = new Set(); stele.traverse(o => keep.add(o));
    let hidden = 0;
    g.scene.traverse(o => {
      if ((o.isMesh || o.isInstancedMesh || o.isPoints || o.isSprite || o.isLine) && !keep.has(o)){
        o.visible = false; hidden++;
      }
    });

    /* 字心与面法线都取**刻字面 group 的三角形**（不是 UV 盒——UV 盒会把背面的顶点也算进来） */
    const geo = slab.geometry, idx = geo.index, pos = geo.attributes.position, nrmA = geo.attributes.normal;
    const gf = geo.groups.find(x => x.materialIndex === 1);
    const cen = new T.Vector3(); const nrm = new T.Vector3(); let nv = 0;
    for (let k = gf.start; k < gf.start + gf.count; k++){
      const vi = idx.getX(k);
      cen.add(new T.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
      if (nrmA){ nrm.add(new T.Vector3(nrmA.getX(vi), nrmA.getY(vi), nrmA.getZ(vi))); nv++; }
    }
    cen.divideScalar(gf.count); if (nv) nrm.divideScalar(nv).normalize();
    const cenW = cen.clone().applyMatrix4(slab.matrixWorld);
    const nrmW = nrm.clone().applyQuaternion(stele.getWorldQuaternion(new T.Quaternion())).normalize();
    /* 若面法线朝内（与"局部 +z"反向），翻过来，保证相机在面的正前方 */
    const plusZ = new T.Vector3(0, 0, 1).applyQuaternion(stele.getWorldQuaternion(new T.Quaternion())).normalize();
    if (nrmW.dot(plusZ) < 0) nrmW.negate();

    const eye = cenW.clone().add(nrmW.clone().multiplyScalar(DIST));
    g.controls.minDistance = 0.01; g.controls.maxDistance = 500;
    g.camera.position.copy(eye); g.controls.target.copy(cenW); g.controls.update();
    return {
      hidden, geomMeshesLeft: keep.size,
      faceTriCtr: [+cenW.x.toFixed(2), +cenW.y.toFixed(2), +cenW.z.toFixed(2)],
      faceNormalW: [+nrmW.x.toFixed(3), +nrmW.y.toFixed(3), +nrmW.z.toFixed(3)],
      dotWithPlusZ: +nrmW.dot(plusZ).toFixed(3),
      eye: [+eye.x.toFixed(2), +eye.y.toFixed(2), +eye.z.toFixed(2)],
    };
  }, DIST);
  console.log('[净室]', JSON.stringify(info));

  await page.evaluate(() => new Promise(r => {
    let n = 0; const f = () => { if (++n >= 3) r(); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  const cam = await page.evaluate(() => {
    const g = window.__garden;
    return { pos: g.camera.position.toArray().map(v => +v.toFixed(2)), tgt: g.controls.target.toArray().map(v => +v.toFixed(2)) };
  });
  console.log('[净室] 截图相机', JSON.stringify(cam));
  const buf = await page.screenshot();
  fs.mkdirSync(path.join(ROOT, 'outputs', 'visual'), { recursive: true });
  const dst = path.join(ROOT, 'outputs', 'visual', '09d-stele-clean.png');
  fs.writeFileSync(dst, buf);
  console.log('saved ' + dst);

  const r = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const W = cv.width, H = cv.height;
    const d = cx.getImageData(0, 0, W, H).data;
    const lum = i => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const arr = [];
    for (let y = Math.floor(H * 0.3); y < Math.floor(H * 0.7); y += 2)
      for (let x = Math.floor(W * 0.3); x < Math.floor(W * 0.7); x += 2) arr.push(lum((y * W + x) * 4));
    const s = arr.slice().sort((a, b) => a - b);
    const q = k => s[Math.floor(k * (s.length - 1))];
    const p5 = q(.05), p50 = q(.5), p95 = q(.95);
    return { spread: +(p95 - p5).toFixed(1), p: [+p5.toFixed(0), +p50.toFixed(0), +p95.toFixed(0)],
             ink: +(arr.filter(v => v < p50 - 26).length / arr.length * 100).toFixed(2), n: arr.length };
  }, buf.toString('base64'));
  console.log(`[净室] 中心区 P5/P50/P95 = ${r.p.join('/')}（跨度 ${r.spread}）｜暗像素 ${r.ink}%（${r.n} 采样）`);
  if (errs.length) console.log('[页面报错]', errs.slice(0, 3).join(' | '));

  try { await browser.close(); } catch {}
  server.close();
  process.exit(0);
})().catch(e => { console.error('净室探针异常：', e); process.exit(1); });
