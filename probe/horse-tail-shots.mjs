// 马尾专项出图 + 量化（2026-10-20 总控）：马尾是这轮返工最多的部件（v1~v6），
// 每次都靠"出图判读"改，但没有一套**固定机位 + 固定量化**⇒ 改一版比一版、
// 说不清哪版更好。这次固定下来：每匹马拍「正侧 / 后 3/4 / 贴尾特写」三张 + 四个数。
//
// 量化（都按马体坐标系，避免世界轴误判）：
//   垂度   = 尾根 y − 尾尖 y        （真马尾垂到飞节 ≈ 0.75~0.90m）
//   横厚   = 尾束最大水平宽度         （真马尾束 ≈ 0.10~0.16m）
//   束宽顶 = 尾根处水平宽度           （要"根部聚拢"）
//   束宽底 = 尾尖处水平宽度           （要"末端收拢"，不是一排齐头的棍子）
//
// 用法：node probe/horse-tail-shots.mjs [tag]
// 出图：outputs/_diag/horse-tail-<tag>/
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const TAG = process.argv[2] || 'now';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'horse-tail-' + TAG);
fs.mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
function lp(){ try { return require('playwright'); } catch {}
  const g = require('node:child_process').execSync('npm root -g', { encoding:'utf8' }).trim();
  return require(path.join(g, 'playwright')); }
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json',
  '.glb':'model/gltf-binary', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => { if (e){ r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' }); r.end(d); });
});

const { chromium } = lp();
const port = await listenEphemeral(srv);
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?tier=high&intro=0`, { waitUntil:'load', timeout:240000 });
await page.waitForFunction(() => window.__garden && window.__garden.bootDone && window.__garden.bootDone(), null, { timeout:900000, polling:500 });
await page.waitForTimeout(3000);
await page.evaluate(() => { try { window.__garden.tourStop && window.__garden.tourStop(); } catch(_){} });
await page.waitForTimeout(500);

/* ── 找出每匹马的尾束，算量化 + 机位 ── */
const info = await page.evaluate(() => {
  const G = window.__garden, T = G.THREE, out = [];
  let stable = null;
  G.scene.traverse(o => { if (!stable && o.userData && Array.isArray(o.userData.horseSlots)) stable = o; });
  for (const slot of stable.userData.horseSlots){
    const root = slot.holders[0];
    root.updateMatrixWorld(true);
    let tailG = null;
    root.traverse(o => { if (!tailG && o.name === 'horseTailLongG') tailG = o; });
    if (!tailG) continue;
    const bb = new T.Box3().setFromObject(tailG);
    const c = new T.Vector3(); bb.getCenter(c);
    const fwd = new T.Vector3(0,0,1).transformDirection(root.matrixWorld); fwd.y = 0; fwd.normalize();
    const right = new T.Vector3().crossVectors(fwd, new T.Vector3(0,1,0)).normalize();
    /* 尾部截面积（沿高度分三段量水平宽度） */
    const band = (y0, y1) => {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
      tailG.traverse(o => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        const v = new T.Vector3();
        for (let i = 0; i < p.count; i++){
          v.set(p.getX(i), p.getY(i), p.getZ(i));
          o.localToWorld(v);
          if (v.y < y0 || v.y > y1) continue;
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
          z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
          n++;
        }
      });
      return n ? { w: +(x1-x0).toFixed(3), d: +(z1-z0).toFixed(3) } : null;
    };
    const top = band(bb.max.y - 0.08, bb.max.y + 0.01);
    const mid = band((bb.max.y + bb.min.y)/2 - 0.06, (bb.max.y + bb.min.y)/2 + 0.06);
    const bot = band(bb.min.y, bb.min.y + 0.08);
    out.push({ role: slot.role,
      center: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)],
      top: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)],
      bot: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)],
      drop: +(bb.max.y - bb.min.y).toFixed(3),
      width: +(Math.max(bb.max.x-bb.min.x, bb.max.z-bb.min.z)).toFixed(3),
      bandTop: top, bandMid: mid, bandBot: bot,
      fwd: [+fwd.x.toFixed(2), +fwd.z.toFixed(2)], right: [+right.x.toFixed(2), +right.z.toFixed(2)] });
  }
  return out;
});
console.log('TAIL-METRICS ' + JSON.stringify(info, null, 1));

async function snap(name, cam, tgt, fov = 30){
  await page.evaluate((a) => {
    const g = window.__garden, T = g.THREE;
    g.camera.position.set(a.cam[0], a.cam[1], a.cam[2]);
    if (g.controls) g.controls.target.set(a.tgt[0], a.tgt[1], a.tgt[2]);
    g.camera.lookAt(new T.Vector3(a.tgt[0], a.tgt[1], a.tgt[2]));
    if (a.fov){ g.camera.fov = a.fov; g.camera.updateProjectionMatrix(); }
  }, { cam, tgt, fov });
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('SNAP', name);
}

/* 每匹马拍三张：正侧（垂直于马体）、后 3/4、贴尾特写
   ⚠️ 机位要点：**必须从马的"后方偏侧"看**，否则马身把尾巴挡住（第一版就拍成了后腿）。
   ⚠️ 判读要点：只看尾巴会被马身/栏杆干扰 ⇒ **先把该匹马的其它网格隐藏**
      （马尾保留），尾巴轮廓衬在背景上，才能判"是一束毛还是几根线"。 */
for (const t of info){
  const c = t.center, f = t.fwd, r = t.right;
  const y = (c[1] + t.bot[1]) / 2;                 // 尾束中段高度
  const tag = t.role;
  /* 藏马身（保留马尾组） */
  await page.evaluate((role) => {
    const G = window.__garden;
    let stable = null;
    G.scene.traverse(o => { if (!stable && o.userData && Array.isArray(o.userData.horseSlots)) stable = o; });
    const slot = stable.userData.horseSlots.find(s => s.role === role);
    window.__hidden = [];
    if (slot){
      const root = slot.holders[0];
      let inTail = false;
      root.traverse(o => {
        if (o.name === 'horseTailLongG'){ inTail = true; }
        if (o.isMesh && !inTail && o.visible){ window.__hidden.push(o); o.visible = false; }
      });
    }
  }, tag);
  /* 正侧轮廓：横向 2.0m + **略偏后 0.8m**，机位**抬高 1.15m 越过栏杆**（否则栏杆挡死） */
  await snap(`${tag}-1-side.png`, [ c[0] + r[0]*2.0 - f[0]*0.8, y + 1.15, c[2] + r[1]*2.0 - f[1]*0.8 ], [ c[0], y, c[2] ], 30);
  /* 后 3/4：马后方 1.9m + 偏侧 1.3m（尾巴衬在背景上） */
  await snap(`${tag}-2-rear34.png`, [ c[0] - f[0]*1.9 + r[0]*1.3, y + 0.35, c[2] - f[1]*1.9 + r[1]*1.3 ], [ c[0], y, c[2] ], 34);
  /* 贴尾特写：后方 1.0m + 偏侧 0.7m */
  await snap(`${tag}-3-close.png`, [ c[0] - f[0]*1.0 + r[0]*0.7, y + 0.12, c[2] - f[1]*1.0 + r[1]*0.7 ], [ c[0], y, c[2] ], 28);
  /* 还原马身 */
  await page.evaluate(() => {
    for (const o of (window.__hidden || [])) o.visible = true;
    window.__hidden = [];
  });
}
console.log('ERRORS', errors.length ? errors.slice(0,4) : '(none)');
await browser.close(); srv.close();
console.log('OUT', OUT);
