// 诊断 7：决定性判定「折射贴图到底按哪套坐标映射」
// 做法：在**已知世界坐标**放一个纯红发光标记（只打 LAYER_REFRACT），等几帧让
//   renderRefraction 把它渲进贴图，再全图扫描红色质心。然后对三个假设各算距离：
//   H1 世界坐标（正确） / H2 漏了 koiGroup 的 z+3 / H3 x 还多一次镜像。
//   标记与锦鲤完全无关，纯几何，一次定案。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchChromium } from '../probe/_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const PBOX = { minX: -16.4, maxX: 16.4, minZ: -6.8, maxZ: 12.8 };
const W = PBOX.maxX - PBOX.minX, D = PBOX.maxZ - PBOX.minZ;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.setDefaultTimeout(120000);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), { timeout: 120000 });
  await page.waitForFunction(() => {
    const w = window.__garden.scene.getObjectByName('waterSurface');
    return w && w.material.uniforms.uRefractOn.value > 0.5;
  }, { timeout: 120000 });

  const res = await page.evaluate(async (PBOX) => {
    const G = window.__garden;
    const T = G.THREE;
    const info = G.refractInfo();
    const texW = info.texW, texH = info.texH;

    // 预测纹素（与 refract-guard / 水面 shader 同一套口径）
    const texel = (wx, wz) => ({
      x: (PBOX.maxX - wx) / (PBOX.maxX - PBOX.minX) * texW,
      y: (wz - PBOX.minZ) / (PBOX.maxZ - PBOX.minZ) * texH,
    });

    function readRT(){
      const rt = G.refractRT();
      const w = rt.width, h = rt.height;
      const buf = new Uint8Array(w * h * 4);
      G.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      return { w, h, buf };
    }
    // 扫红色质心（readPixels 是倒序行，质心 x 不受影响，y 记的是缓冲区行号 = 贴图底部起算）
    function redCentroid(img){
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2){
        const i = (y * img.w + x) * 4;
        const r = img.buf[i], g = img.buf[i + 1], b = img.buf[i + 2];
        if (r > 120 && r > g + 60 && r > b + 60){ sx += x; sy += y; n++; }
      }
      return n ? { x: sx / n, y: sy / n, n } : null;
    }

    const probes = [
      { name: '池心世界(0,3)',  wx: 0,  wz: 3 },
      { name: '池心南3m(0,0)',  wx: 0,  wz: 0 },
      { name: '东(8,3)',        wx: 8,  wz: 3 },
      { name: '西(-8,3)',       wx: -8, wz: 3 },
      { name: '北(0,10)',       wx: 0,  wz: 10 },
      { name: '南(0,-4)',       wx: 0,  wz: -4 },
    ];
    const out = [];
    for (const p of probes){
      const geo = new T.IcosahedronGeometry(0.9, 0);
      const mat = new T.MeshBasicMaterial({ color: 0xFF0000 });
      const m = new T.Mesh(geo, mat);
      m.position.set(p.wx, -0.5, p.wz);
      m.layers.set(3);                       // 只让折射相机看见（主相机别看）
      G.scene.add(m);
      await new Promise(r => setTimeout(r, 700));   // 几帧，让 renderRefraction 画进去
      const img = readRT();
      const c = redCentroid(img);
      G.scene.remove(m); geo.dispose(); mat.dispose();
      const row = { probe: p.name, world: [p.wx, p.wz] };
      if (c){
        row.found = { x: +c.x.toFixed(1), y: +c.y.toFixed(1), n: c.n };
        const h1 = texel(p.wx, p.wz);                    // 世界坐标（应该）
        const h2 = texel(p.wx, p.wz - 3);                // 漏 koiGroup z+3
        const h3 = texel(-p.wx, p.wz);                   // x 镜像错
        const h4 = texel(-p.wx, p.wz - 3);               // 又镜像又漏 z
        const d = (a) => Math.hypot(a.x - c.x, a.y - c.y);
        row.dist = { H1world: +d(h1).toFixed(1), H2noZ: +d(h2).toFixed(1),
                     H3mirrorX: +d(h3).toFixed(1), H4both: +d(h4).toFixed(1) };
        row.best = Object.entries(row.dist).sort((a, b) => a[1] - b[1])[0][0];
        row.predH1 = { x: +h1.x.toFixed(1), y: +h1.y.toFixed(1) };
      } else row.found = null;
      out.push(row);
      await new Promise(r => setTimeout(r, 200));
    }
    return { texW, texH, out };
  }, PBOX);

  console.log(JSON.stringify(res, null, 2));
  await browser.close();
  server.close();
})();
