// 复核探针 2：给"越水面但不在折射层"的对象**定性** —— 到底是真缺口还是 bbox 探界假阳性。
// 上一版只报了包围盒跨越，而立在池岸上的石头，bbox 会稍微探进池内 → 假阳性。
// 这版补三件决定性的信息：
//   ① 对象世界中心**在不在池里**（不在 = 是岸上的东西，bbox 探界而已）；
//   ② 中心到池岸的**最短距离**（用 POND_RADII 的角度射线表反查，负数=在池内）；
//   ③ 材质名 + 顶点数 + 最高命名祖先（匿名网要能认出来是谁家的）。
// 用法: node probe/_refract-coverage2.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchChromium } from './_harness.mjs';

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

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(150000);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), { timeout: 150000 });
  await page.waitForFunction(() => window.__garden.koiGroup.userData.fishes.length >= 11, { timeout: 150000 });
  await new Promise(r => setTimeout(r, 3000));

  const out = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const WATER_Y = 0.06;
    const MASK = 1 << G.refractInfo().layer;
    const RAD = G.POND_RADII, N = RAD.length;

    /* 池岸最短距离：沿该点角度查半径表（表是"从池心按角度射线到岸线"）。
       局部坐标 = 世界 (x, z-3)。返回负值表示在池内、正值表示在池外。 */
    function shoreSigned(x, z){
      const lx = x, lz = z - 3;
      const r = Math.hypot(lx, lz);
      if (r < 1e-6) return -RAD[0];
      let a = Math.atan2(lz, lx); if (a < 0) a += Math.PI * 2;
      const i = Math.floor(a / (Math.PI * 2) * N) % N;
      return r - RAD[i];
    }
    const namedAncestor = (o) => {
      let c = o;
      while (c){ if (c.name) return c.name; c = c.parent; }
      return '(全无名)';
    };

    const rows = [];
    const seen = new Set();
    G.scene.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh)) return;
      if (o.name === 'waterSurface') return;
      const box = new T.Box3().setFromObject(o);
      if (box.isEmpty() || !(box.min.y < WATER_Y - 0.02)) return;
      /* 只在"整体下探超过 15cm"时才追 —— 浅于 15cm 的跨界（叶子根部/袍角/地面 6cm）
         不属于"透过水看得见"的范畴，混进来只会淹掉真信号。 */
      const depth = WATER_Y - box.min.y;
      if (depth < 0.15) return;
      if (seen.has(o.uuid)) return; seen.add(o.uuid);
      const c = box.getCenter(new T.Vector3());
      const sd = shoreSigned(c.x, c.z);
      let onPond = false;
      for (let i = 0; i <= 6 && !onPond; i++) for (let j = 0; j <= 6; j++){
        if (G.insidePond(box.min.x + (box.max.x - box.min.x) * i / 6,
                         box.min.z + (box.max.z - box.min.z) * j / 6 - 3)){ onPond = true; break; }
      }
      if (!onPond) return;
      const g = o.geometry;
      rows.push({
        name: o.name || '(无名)',
        owner: namedAncestor(o),
        mat: o.material ? (o.material.name || (o.material.color ? '#' + o.material.color.getHexString() : '?')) : '?',
        verts: g && g.attributes.position ? g.attributes.position.count : 0,
        depth: +depth.toFixed(2),
        centerShore: +sd.toFixed(2),          // <0 池内 / >0 池外
        center: [+c.x.toFixed(1), +c.z.toFixed(1)],
        tag: (o.layers.mask & MASK) !== 0,
        inst: !!o.isInstancedMesh,
      });
    });
    rows.sort((a, b) => b.depth - a.depth);
    return rows;
  });

  const f = (r) => `${r.tag ? '✓在层' : '✗缺'} ${r.name.padEnd(14)} 家=${r.owner.padEnd(16)} ` +
    `材=${String(r.mat).padEnd(12)} 顶点=${String(r.verts).padStart(6)} 下探=${r.depth}m ` +
    `中心离岸=${r.centerShore > 0 ? '+' : ''}${r.centerShore}m @(${r.center})${r.inst ? ' [实例]' : ''}`;
  console.log(`越水面 >15cm 且压到池体的对象：${out.length} 个\n`);
  console.log('── 池内的（中心在池里 → 水下真的是它们）──');
  out.filter(r => r.centerShore < 0).forEach(r => console.log('  ' + f(r)));
  console.log('\n── 跨界 / 岸上的（中心在池外，只是 bbox 探进池内）──');
  out.filter(r => r.centerShore >= 0).forEach(r => console.log('  ' + f(r)));

  await browser.close();
  server.close();
})();
