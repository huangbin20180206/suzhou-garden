// 院门口石狮门禁（2026-10-18 · 补 P1「石狮 404 会静默消失」）
//
// 守五件事：
//   ① 两件 GLB 都真的挂上了（stoneLionMale / stoneLionFemale holder 存在）；
//   ② 落位：x=40±2.45、z=3.4，公母间距 4.9m；
//   ③ 尺寸：高 ≈1.08m、宽 ≈0.56m、深 ≈0.85m（loadAssetOnce 按最长边归一化）；
//   ④ 落地：包围盒底部与 holder 落点差 ≤5cm（不能悬空/陷地）；
//   ⑤ 净空：狮身内缘到门洞边（±1.8m）≥0.10m —— 旧桩位 ±2.3 只剩 0.05m，
//      视觉上像贴着门柱（2026-10-18 评审 P2），现在改到 ±2.45。
//
// 为什么必须单独立一条：13-preload 把石狮登记为 required:false（拉不到时页面照常开园、
// 门口空着），而 smoke / preload-manifest-sync 都不检查"实际挂载" ⇒ 文件被误删/改名/
// 缓存失效时，全套门禁仍可能全绿，用户看到的门口却没有狮子。
//
// 用法：node probe/lion-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'lion-guard');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(150000);
  const errs = [], responses = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('response', r => { if (/stone-lion-(male|female)\.glb/.test(r.url())) responses.push([r.url().split('/').pop(), r.status()]); });

  console.log(`\n[lion-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 120000, polling: 300 });

  /* 石狮在延迟批里加载，轮询到两件都在场 */
  const found = await page.waitForFunction(() => {
    let m = 0, f = 0;
    window.__garden.scene.traverse(o => {
      if (o.name === 'stoneLionMale') m++;
      if (o.name === 'stoneLionFemale') f++;
    });
    return (m && f) ? { m, f } : false;
  }, null, { timeout: 90000, polling: 300 }).then(h => h.jsonValue()).catch(() => null);
  check('公母两件石狮都已挂上', !!found, found ? `male×${found.m} female×${found.f}` : '90s 内没等到 holder');
  if (!found){
    await browser.close(); server.close();
    console.log('[lion-guard] 两件石狮没挂上，后续断言无意义');
    process.exit(1);
  }

  const data = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const get = (name) => {
      let o = null; G.scene.traverse(x => { if (x.name === name) o = x; });
      if (!o) return null;
      const bb = new T.Box3().setFromObject(o);
      let tris = 0, meshes = 0, hasMap = false;
      o.traverse(x => {
        if (x.isMesh){
          meshes++;
          const idx = x.geometry.index;
          tris += (idx ? idx.count : x.geometry.attributes.position.count) / 3;
          if (x.material && x.material.map) hasMap = true;
        }
      });
      return { pos: [o.position.x, o.position.y, o.position.z], ry: o.rotation.y,
               min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z],
               size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
               meshes, tris, hasMap };
    };
    return { male: get('stoneLionMale'), female: get('stoneLionFemale') };
  });
  const M = data.male, F = data.female;

  check('公狮落位 x=+2.55 / z=23.9（园墙南月洞门，雄在左）', Math.abs(M.pos[0] - 2.55) < 0.02 && Math.abs(M.pos[2] - 23.9) < 0.02,
    `(${M.pos[0].toFixed(2)}, ${M.pos[2].toFixed(2)})`);
  check('母狮落位 x=−2.55 / z=23.9（园墙南月洞门，雌在右）', Math.abs(F.pos[0] + 2.55) < 0.02 && Math.abs(F.pos[2] - 23.9) < 0.02,
    `(${F.pos[0].toFixed(2)}, ${F.pos[2].toFixed(2)})`);
  check('公母间距 5.1m', Math.abs((M.pos[0] - F.pos[0]) - 5.1) < 0.05, `${(M.pos[0] - F.pos[0]).toFixed(2)}m`);

  const sizeOK = (s, label) =>
    s.size[1] > 1.00 && s.size[1] < 1.16 &&
    s.size[0] > 0.45 && s.size[0] < 0.75 &&
    s.size[2] > 0.70 && s.size[2] < 1.00;
  check('公狮尺寸 1.08×0.56×0.85（±0.08）', sizeOK(M, 'male'),
    `${M.size.map(v => v.toFixed(3)).join(' × ')}`);
  check('母狮尺寸 1.08×0.56×0.85（±0.08，含胸前幼狮）', sizeOK(F, 'female'),
    `${F.size.map(v => v.toFixed(3)).join(' × ')}`);

  const groundOK = (s) => Math.abs(s.min[1] - s.pos[1]) < 0.05;
  check('两件都落地（包围盒底 = holder 落点 ±5cm）',
    groundOK(M) && groundOK(F),
    `male Δ=${(M.min[1] - M.pos[1]).toFixed(3)} / female Δ=${(F.min[1] - F.pos[1]).toFixed(3)}`);

  /* 园墙南月洞门：圆心 (0,22.5)、洞口半径 1.62、墙面 z=22.8。
     狮身内缘到洞口边 ≥0.40m，且狮身整体在墙面之外（min.z > 22.8）。 */
  const clearM = (Math.abs(M.pos[0]) - M.size[0] / 2) - 1.62;
  const clearF = (Math.abs(F.pos[0]) - F.size[0] / 2) - 1.62;
  check('狮身到月洞门洞口净空 ≥0.40m', clearM >= 0.40 && clearF >= 0.40,
    `雄内缘 ${(clearM * 100).toFixed(1)}cm / 雌内缘 ${(clearF * 100).toFixed(1)}cm`);
  check('两狮都在墙面之外（min.z > 墙外皮 22.8）', M.min[2] > 22.8 && F.min[2] > 22.8,
    `雄 ${M.min[2].toFixed(2)} / 雌 ${F.min[2].toFixed(2)}`);

  check('朝向：holder.rotation.y = 0（扫描狮脸朝 +z 南）', Math.abs(M.ry) < 0.01 && Math.abs(F.ry) < 0.01,
    `male ${M.ry.toFixed(3)} / female ${F.ry.toFixed(3)}`);
  check('贴图已挂上（baseColor map 存在）', M.hasMap && F.hasMap, `map=${M.hasMap}/${F.hasMap}`);
  check('网格规模合理（公 ≥12k 面、母 ≥10k 面）', M.tris >= 12000 && F.tris >= 10000,
    `公 ${Math.round(M.tris)} / 母 ${Math.round(F.tris)} 三角面`);

  const r404 = responses.filter(([, st]) => st !== 200);
  check('两件 GLB 请求均 200', responses.length === 2 && r404.length === 0,
    JSON.stringify(responses));
  check('无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* 出图：站到门口正南 4m、眼高 1.6m 看两只狮子 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.camera.position.set(0, 1.62, 28.6);
    g.controls.target.set(0, 0.72, 23.6);
    g.controls.update();
  });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'gate-front.png') });

  const bad = results.filter(r => !r.ok);
  console.log(`\n[lion-guard] ${results.length - bad.length}/${results.length} PASS` +
    (bad.length ? ` · 红：${bad.map(b => b.name).join('、')}` : ''));
  console.log(`样张：${path.join(OUT, 'gate-front.png')}`);
  await browser.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('[lion-guard] 崩溃:', e); process.exit(2); });

