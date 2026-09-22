// 第八轮样张（2026-09-17）：锦鲤不越岸 / 立峰·题名石 / 停栖蜻蜓 / 收腰处特写。
// ⚠️ 只改环境、机位、UI 显隐，**不动渲染链**（改 pixelRatio / 删 GTAO / dispose 阴影图
//   会把样张拍成灰图 —— 第六轮踩过）。输出 outputs/visual/。
// 用法: node probe/shots-round8.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', 'visual');
fs.mkdirSync(OUT, { recursive: true });

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
  page.setDefaultTimeout(240000);
  page.on('pageerror', e => console.log('[页面报错]', String(e).slice(0, 200)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000 });
  /* 立峰/题名石在延迟批里；锦鲤与泳龟是异步 GLB。全部轮询到齐再拍。 */
  await page.waitForFunction(() => {
    let hero = false, stele = false;
    window.__garden.scene.traverse(o => {
      if (o.name === 'taihuHero') hero = true;
      if (o.name === 'steleGroup') stele = true;
    });
    return hero && stele && window.__garden.koiGroup.userData.fishes.length >= 11
        && window.__garden.perchingDragonflies.every(d => d.visible && d.userData.perch.anchor);
  }, { timeout: 240000 });

  /* ⚠️ 巡游默认开启（首站 hero）：flyTo 的 CAM_FLY 过渡会在 1.4s 内**每帧覆盖探针机位**，
     停留到点还会自动切下一站把相机飞走 —— 之前所有特写都因此拍成了立峰（不是题名石）。
     必须先等飞行落定、再 tourStop，机位才稳得住。 */
  await page.waitForFunction(() => !window.__garden.camFly(), { timeout: 120000 }).catch(() => {});
  await page.evaluate(() => window.__garden.tourStop());

  await page.evaluate(() => {
    for (const id of ['env', 'hud', 'stats']){ const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  });

  const shot = async (name) => {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(OUT, name) });
    /* 特写机位临时放宽了 minDistance，拍完恢复产品状态（主循环每帧 update 会把它推回 9m 外） */
    await page.evaluate(() => { if (window.__garden) window.__garden.controls.minDistance = 9; });
    console.log('  ✓ ' + name);
  };
  const settle = () => page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 90000, polling: 200 }).catch(() => {});

  /* 1 · 池面俯视：一眼看完 11 条锦鲤 + 2 只泳龟有没有骑到草皮上 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.camera.position.set(0.5, 26, 4.5);
    g.controls.target.set(0, 0, 3);
    g.controls.update();
  });
  await settle();
  await shot('08-koi-pond-top.png');

  /* 2 · 收腰处低视角：穿模就是从这里看出来的（轨道 2 最紧点 1.33m 离岸） */
  await page.evaluate(() => {
    const g = window.__garden;
    g.camera.position.set(7.5, 1.5, -5.5);
    g.controls.target.set(0, 0.25, 3);
    g.controls.update();
  });
  await settle();
  await shot('08-koi-waist.png');

  /* 3 · 立峰 · 云根 + 岸上题名石（用内置 hero 机位） */
  await page.evaluate(() => {
    const g = window.__garden;
    const vp = g.VIEWPOINTS.find(v => v.id === 'hero');
    if (vp){ g.camera.position.copy(vp.pos); g.controls.target.copy(vp.target); }
    else { g.camera.position.set(-2, 2.4, -6); g.controls.target.set(-4.7, 2.2, 8); }
    g.controls.update();
  });
  await settle();
  await shot('08-hero-stone.png');

  /* 3b · 题名石特写：相机必须对准**字心**，不是石头中心 ——
     「云根」横排在刻字面上，字心沿 stele.rotation.y 旋转后落在石头世界 +x 侧 ~0.38m，
     而刻字面法线主要指向 -z。沿法线架相机、target 给石头中心 → 字全在画面外（踩过两轮）。
     正解：从 UV 反查落在字区域（u≈0.30~0.69, v≈0.31~0.69）的顶点，平均出字心世界坐标。
     ⚠️ 产品 controls.minDistance=9，不临时放宽会被 update() 拉到 9m 外；且主循环每帧 update，
     拍完才能恢复（settle 期间多帧，早恢复等于没放宽）。 */
  const aimStele = async (dist, yOff) => page.evaluate(({ dist, yOff }) => {
    const g = window.__garden;
    let stele = null, slab = null;
    g.scene.traverse(o => {
      if (o.name === 'steleGroup') stele = o;
    });
    if (!stele) return { found: false };
    stele.traverse(o => { if (o.geometry && !slab) slab = o; });
    if (!slab) return { found: false };
    const T = g.THREE;
    const uvA = slab.geometry.attributes.uv, posA = slab.geometry.attributes.position;
    const c = new T.Vector3(); let nC = 0;
    for (let i = 0; i < uvA.count; i++){
      const u = uvA.getX(i), v = uvA.getY(i);
      if (u > 0.29 && u < 0.71 && v > 0.36 && v < 0.64){
        c.add(new T.Vector3(posA.getX(i), posA.getY(i), posA.getZ(i)));
        nC++;
      }
    }
    if (!nC) return { found: true, uvHits: 0 };
    c.divideScalar(nC);
    const wCenter = c.applyMatrix4(slab.matrixWorld);
    const n = new T.Vector3(0, 0, 1).applyQuaternion(stele.getWorldQuaternion(new T.Quaternion()));
    const eye = wCenter.clone().add(n.clone().multiplyScalar(dist));
    eye.y = wCenter.y + yOff;
    g.controls.minDistance = 0.1;
    g.camera.position.copy(eye);
    g.controls.target.copy(wCenter);
    g.controls.update();
    return {
      found: true, uvHits: nC,
      center: [+wCenter.x.toFixed(2), +wCenter.y.toFixed(2), +wCenter.z.toFixed(2)],
      eye: [+eye.x.toFixed(2), +eye.y.toFixed(2), +eye.z.toFixed(2)],
    };
  }, { dist, yOff });
  const si = await aimStele(1.5, 0.12);
  console.log('[stele-aim]', JSON.stringify(si));
  await settle();
  await shot('08-stele-closeup.png');

  /* 3c · 导出刻字纹理本身（贴图有没有字，一眼便知） */
  const texURL = await page.evaluate(() => {
    const g = window.__garden;
    let stele = null;
    g.scene.traverse(o => { if (o.name === 'steleGroup') stele = o; });
    if (!stele) return null;
    let faceMat = null;
    stele.traverse(o => {
      if (faceMat || !o.material) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      faceMat = ms.find(m => m && m.map) || null;
    });
    if (!faceMat || !faceMat.map || !faceMat.map.image) return null;
    const cv = faceMat.map.image;
    if (cv.toDataURL) return cv.toDataURL('image/png');
    return null;
  });
  if (texURL){
    fs.writeFileSync(path.join(OUT, '08-stele-texture.png'), Buffer.from(texURL.split(',')[1], 'base64'));
    console.log('  ✓ 08-stele-texture.png（刻字纹理本身）');
  }
  await aimStele(0.8, 0.08);
  await settle();
  await shot('08-stele-macro.png');

  /* 4/5 · 停栖蜻蜓近景：把相机架到当前停点旁 0.75m 处 */
  for (let i = 0; i < 2; i++){
    const p = await page.evaluate((i) => {
      const g = window.__garden;
      const d = g.perchingDragonflies[i];
      const s = d.userData.perch;
      s.mode = 'perch'; s.tPerch = 0; s.durPerch = 1e6;      // 拍照期间不许起飞
      const p = d.position;
      g.controls.minDistance = 0.1;
      g.camera.position.set(p.x + 0.42, p.y + 0.30, p.z + 0.52);
      g.controls.target.set(p.x, p.y, p.z);
      g.controls.update();
      return { kind: s.anchor.kind, y: +p.y.toFixed(2) };
    }, i);
    await settle();
    await shot(`08-dragonfly-${i + 1}-${p.kind}.png`);
  }

  console.log('\n[样张] 输出目录 outputs/visual/');
  try { await browser.close(); } catch {}
  server.close();
})().catch(e => { console.error('样张探针异常：', e); process.exit(1); });
