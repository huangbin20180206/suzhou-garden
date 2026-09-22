// 锦鲤/泳龟轨道越界探针（2026-09-17）
// 起因：用户截图「锦鲤游到草皮上」。根因不是轨道参数画大了，而是坐标口径错误 ——
//   holder 是 koiGroup 的子节点（父组在世界 z=+3 = 池心），渲染循环却把 koiGroup.position
//   又加进了**局部** f.position，父组偏移叠加两遍，三条轨道整体南移 3m，在收腰处出池。
// 「只算包围盒」抓不到这种 bug：轨道 bbox 完全可能落在池 bbox 里却仍然穿出凹岸。
//   所以这里按 POND_PTS 多边形**逐点**判内外，并量「点到岸线的最短距离」作为离岸余量。
// 用法: node probe/koi-orbit.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs');
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  page.setDefaultTimeout(150000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000 });

  /* koi.glb 是异步挂载的（loading 收起之后才到），必须轮询到齐 —— 固定 sleep 会卡在临界点。 */
  const gotFish = await page.waitForFunction(
    () => window.__garden.koiGroup.userData.fishes.length >= 11 &&
          window.__garden.swimTurtles.length >= 2,
    { timeout: 120000 }).then(() => true).catch(() => false);
  check('锦鲤/泳龟异步挂载到齐', gotFish,
    gotFish ? '' : 'koi.glb 或 Turtle.glb 未挂载（探针结果无意义）');
  if (!gotFish){ await finish(); return; }

  const data = await page.evaluate(() => {
    const G = window.__garden;
    const poly = G.POND_PTS.map(p => [p.x, p.y]);
    const POND_Z = 3.0;                       // 池心在世界 z=+3（水面/池底/驳岸三处一致）

    function inside(x, y){
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
      }
      return c;
    }
    /* 点到岸线的最短距离（在多边形内为正、外为负） */
    function clearance(x, y){
      let best = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = ax + dx * t, py = ay + dy * t;
        best = Math.min(best, Math.hypot(x - px, y - py));
      }
      return inside(x, y) ? best : -best;
    }

    /* ── A · 解析扫轨：整周期 × 全抖动区间，逐点判内外 + 量离岸余量 ──
       抖动 j = d.jitter(0.72~1.00) + sin(...)*0.06 ⇒ j ∈ [0.66, 1.06]，
       最坏情况是 j=1.06（轨道被放大 6%），必须按它算。 */
    const orbits = G.KOI_ORBITS;
    const analytic = orbits.map((o, oi) => {
      let worst = Infinity, worstAt = null, outside = 0, n = 0;
      for (let ji = 0; ji <= 8; ji++){
        const j = 0.66 + (1.06 - 0.66) * (ji / 8);
        for (let k = 0; k < 720; k++){
          const t = (k / 720) * Math.PI * 2;
          const x = o.cx + Math.cos(t) * o.a * j;
          const y = o.cz + Math.sin(t) * o.b * j;
          const c = clearance(x, y);
          n++;
          if (c < 0) outside++;
          if (c < worst){ worst = c; worstAt = [+x.toFixed(2), +y.toFixed(2)]; }
        }
      }
      return { i: oi, cx: o.cx, cz: o.cz, a: o.a, b: o.b, worst: +worst.toFixed(3), worstAt, outside, n };
    });

    /* ── B · 运行时实测：读真实的 holder 局部坐标，看有没有偷偷带父组偏移 ── */
    const kg = G.koiGroup;
    const fish = kg.userData.fishes.map(f => {
      const d = f.userData, o = orbits[d.orbit];
      const jMax = d.jitter + 0.06;
      // 局部坐标（= 池局部坐标，父组给世界偏移）
      const lx = f.position.x, lz = f.position.z;
      // 理论局部坐标的取值域，用来抓「多加了 3」这类偏移
      const expX = [o.cx - o.a * jMax, o.cx + o.a * jMax];
      const expZ = [o.cz - o.b * jMax, o.cz + o.b * jMax];
      const wp = new G.THREE.Vector3();
      f.getWorldPosition(wp);
      return {
        orbit: d.orbit, jitter: +d.jitter.toFixed(3),
        lx: +lx.toFixed(3), lz: +lz.toFixed(3),
        inX: lx >= expX[0] - 1e-6 && lx <= expX[1] + 1e-6,
        inZ: lz >= expZ[0] - 1e-6 && lz <= expZ[1] + 1e-6,
        worldZ: +wp.z.toFixed(3),
        clearance: +clearance(lx, lz).toFixed(3),
        inside: inside(lx, lz),
      };
    });

    const turtles = G.swimTurtles.map(tw => {
      const lz = tw.position.z - POND_Z, lx = tw.position.x;   // 世界 → 池局部
      return { lx: +lx.toFixed(3), lz: +lz.toFixed(3),
               inside: inside(lx, lz), clearance: +clearance(lx, lz).toFixed(3) };
    });

    /* 反向自检：把轨道整体南移 3m（= 旧版多叠加一次父组偏移的结果）必须被判为出池。
       探针自己要有牙 —— 否则"全绿"可能只是判据太松。 */
    const buggy = orbits.map((o, oi) => {
      let outside = 0, worst = Infinity;
      for (let ji = 0; ji <= 8; ji++){
        const j = 0.66 + (1.06 - 0.66) * (ji / 8);
        for (let k = 0; k < 720; k++){
          const t = (k / 720) * Math.PI * 2;
          const c = clearance(o.cx + Math.cos(t) * o.a * j, o.cz + 3 + Math.sin(t) * o.b * j);
          if (c < 0) outside++;
          worst = Math.min(worst, c);
        }
      }
      return { i: oi, outside, worst: +worst.toFixed(3) };
    });

    return { analytic, buggy, fish, turtles, koiGroupZ: kg.position.z, POND_Z };
  });

  console.log('\n[解析扫轨] 每条轨道 9 档抖动 × 720 相位 = 6480 点，全周期逐点判：');
  for (const o of data.analytic){
    console.log(`  轨道${o.i} 心(${o.cx},${o.cz}) a=${o.a} b=${o.b} ｜ 出池点 ${o.outside}/${o.n} ｜ 最小离岸 ${o.worst}m @池局部(${o.worstAt})`);
  }

  /* 鱼体：koi.glb 归一化到 0.72（最长边），半长约 0.36m。留 0.40m 余量才算不咬岸。 */
  const MARGIN = 0.40;
  check('解析扫轨 · 三条轨道全程在池内', data.analytic.every(o => o.outside === 0),
    data.analytic.map(o => `#${o.i}:${o.outside}`).join(' '));
  check(`解析扫轨 · 最小离岸余量 ≥ ${MARGIN}m（鱼体半长 0.36）`,
    data.analytic.every(o => o.worst >= MARGIN),
    '最小 ' + Math.min(...data.analytic.map(o => o.worst)).toFixed(3) + 'm');

  /* 探针自检：旧写法（父组偏移叠加两遍）必须被判出池，否则说明判据太松、全绿是假的。 */
  const caught = data.buggy.filter(o => o.outside > 0);
  check('探针有牙 · 旧写法（+3 叠加）应被判出池', caught.length > 0,
    data.buggy.map(o => `#${o.i}:${o.outside}点(最差${o.worst}m)`).join(' '));

  const badFish = data.fish.filter(f => !f.inX || !f.inZ);
  check('运行时 · 鱼局部坐标不含父组偏移（无 +3 叠加）', badFish.length === 0,
    badFish.length ? JSON.stringify(badFish.slice(0, 3)) : `11 条全部落在各自轨道取值域内`);
  const outFish = data.fish.filter(f => !f.inside);
  check('运行时 · 11 条鱼当前位置全在池内', outFish.length === 0,
    outFish.length ? JSON.stringify(outFish.slice(0, 3))
                   : `最小离岸 ${Math.min(...data.fish.map(f => f.clearance)).toFixed(3)}m`);
  const outTw = data.turtles.filter(t => !t.inside);
  check('运行时 · 泳龟当前位置全在池内', outTw.length === 0,
    outTw.length ? JSON.stringify(outTw) : `${data.turtles.length} 只，最小离岸 ${Math.min(...data.turtles.map(t => t.clearance)).toFixed(3)}m`);
  check('池心口径一致（koiGroup.z === 水面/池底/驳岸的 3.0）',
    Math.abs(data.koiGroupZ - data.POND_Z) < 1e-6, `koiGroup.z=${data.koiGroupZ}`);
  check('页面无报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '无');

  await finish();

  async function finish(){
    const pass = results.filter(r => r.ok).length;
    console.log(`\n${pass === results.length ? '✓' : '✗'} ${pass}/${results.length} ${pass === results.length ? 'ALL PASS' : 'FAILED'}`);
    try { await browser.close(); } catch {}
    server.close();
    process.exit(pass === results.length ? 0 : 1);
  }
})().catch(async e => {
  console.error('探针异常：', e);
  process.exit(1);
});
