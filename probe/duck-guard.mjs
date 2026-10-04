// 池中水禽（绿头鸭 ♂♀ / 鸳鸯 ♂♀）专项门禁：node probe/duck-guard.mjs
//
// 为什么需要这扇门（2026-10-04）：
//   计划书 §6「再下一批 · 人/景」第一条把"池面除荷叶外是空的"记为待补，本轮补上水禽。
//   但**本轮真正的教训不是"没做"，而是"做了却量不到"**：
//   第一版用 `Box3.setFromObject` 量鸭子尺寸 —— 它是**世界轴对齐盒**。鸭每帧绕 Y 转，
//   盒子按"转到最外"撑开，于是**屏幕上最窄的那一帧（正对/背对机位）被量成 ~28px，
//   而实际只有 11px**。测量口径把最坏情况整帧抹掉，比"高估 2 倍"更糟：
//   门禁绿着，鸭子其实是一个点（老黄看到的就是这个）。
//   ⇒ 本门第一件事就是把**尺寸口径钉死**：逐顶点投影（窄口径）+ 逐相位取最小值。
//     ⚠️ 以后谁把这句改回 Box3，门会立刻由绿变红 —— 那正是它该干的。
//
// 判据（全部实测，不写死几何数字）：
//   ① 尺寸：默认机位逐相位量"鸭身投影包围盒"，**取所有相位里的最小边** ≥ 12px
//      12px 的来历：BIRD_SCALE=5.0 的石上小鸟几何 0.58m ≈ 默认机位 13px，
//      是项目已经接受的"远观可读"线（见 07-ground 小鸟注释）。旧倍率 1.8 实测最窄 11.6px
//      ⇒ 这条线卡在两版之间，有牙（`--selfcheck` 直接把它验证一遍）。
//   ② 池域：整圈 24 个相位全部 insidePond，且**贴着水面线**（|y − CFG.water| ≤ 0.02）
//   ③ 在游：20s 内每只位移 > 0.10m（不动的"鸭子"不如不放）
//   ④ **不占涟漪配额**：数 `lastRippleAge` 归零沿（= spawnRipple 次数）落在
//      koi(16~36/分) + turtle(12~24/分) 的水位内（上限取 80/分留余量）。
//      水禽只挂**常驻尾涡圈**、不进涟漪池；哪天给它加了第三条涟漪链，
//      4 只 × 每帧一圈 ⇒ ~240 圈/分、池子被按到容量上限 ⇒ 这条当场爆。
//      再叠一条独立判据：活涟漪中位数 ≤ 0.75×容量（与 koi-ripple-guard 同口径）。
//   ⑤ 折射层：**本体必须在层里**（吃水约体高一半 = 半浸物，按本项目口径就该进层；
//      不进层的实际效果是"透过水面看到的不是鸭肚皮、而是池底"），
//      而**尾涡圈必须在层外**（+0.014m 的水面贴花，写进"水下贴图"才是错的）。
//      另：不投影、已挡 mergeStatics。
//      ⚠️ 这条判据 2026-10-04 被**反转**过 —— 第一版断言"不进层"，是错的，
//         而且正是 refract-coverage 的反扫把它抓了出来（详见 08-assemble 的返工注释）。
//
// 🔧 `--selfcheck`：把 4 只整体缩回旧倍率 1.8（×0.818）⇒ ① 必须报红。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg',
               '.png': 'image/png', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const SELFCHECK = process.argv.includes('--selfcheck');
const PHASES = [0, 0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6];      // 8 个相位覆盖整圈
const MIN_PX = 12;                                            // ① 的线（来历见文件头）

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const finish = () => {
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[duck-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  const got = await page.waitForFunction(() => window.__garden.swimDucks.length >= 4,
    null, { timeout: 300000 }).then(() => true).catch(() => false);
  check('前提：4 只水禽已挂载（否则下面所有尺寸判据无意义）', got, got ? '4 只' : '资产未挂载');
  if (!got){ await finish(); return; }

  console.log(`  · GPU: ${await page.evaluate(() => window.__garden.gpuName)}`);

  /* 默认机位 + 稳态光照（尺寸判据必须在用户真正看到的那个机位上量） */
  await page.evaluate(() => {
    const G = window.__garden;
    G.setEnv('season', 'spring'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon');
    G.resetCamera && G.resetCamera();
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);

  /* ══ ① 尺寸：逐相位 × 逐只 ══════════════════════════════════════════════
     ⚠️ 必须**逐顶点投影**：Box3 是世界轴对齐盒，鸭每帧绕 Y 转 ⇒ 盒子按最外撑开，
        最窄的那一帧被量胖一倍（这正是第一版翻车的原因）。 */
  const sizeAt = async (ph) => {
    await page.evaluate((p) => { window.__garden.swimDucks.forEach(d => { d.userData.t = p; }); }, ph);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page.evaluate(() => {
      const G = window.__garden, T = G.THREE;
      const W = G.renderer.domElement.width, H = G.renderer.domElement.height;
      const out = [];
      for (let i = 0; i < G.swimDucks.length; i++){
        const d = G.swimDucks[i];
        let m = null; d.traverse(o => { if (o.isMesh && o.name === 'duckBody' + i) m = o; });
        if (!m){ out.push(null); continue; }
        m.updateWorldMatrix(true, false);
        const pos = m.geometry.attributes.position, v = new T.Vector3();
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let k = 0; k < pos.count; k++){
          v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld).project(G.camera);
          const X = (v.x + 1) / 2 * W, Y = (1 - v.y) / 2 * H;
          if (X < x0) x0 = X; if (X > x1) x1 = X;
          if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        }
        /* 对照口径（只报数、不判）：世界轴对齐盒 —— 让"口径差多少"留在日志里 */
        const b3 = new T.Box3().setFromObject(m);
        const pts = [];
        for (const xs of [b3.min.x, b3.max.x]) for (const ys of [b3.min.y, b3.max.y]) for (const zs of [b3.min.z, b3.max.z])
          pts.push(new T.Vector3(xs, ys, zs).project(G.camera));
        const bx = pts.map(q => (q.x + 1) / 2 * W), by = pts.map(q => (1 - q.y) / 2 * H);
        out.push({ w: x1 - x0, h: y1 - y0,
                   bw: Math.max(...bx) - Math.min(...bx), bh: Math.max(...by) - Math.min(...by) });
      }
      return out;
    });
  };

  const perDuck = [];
  for (const ph of PHASES){
    const row = await sizeAt(ph);
    row.forEach((s, i) => {
      if (!s) return;
      (perDuck[i] = perDuck[i] || []).push(s);
    });
  }
  const minOf = (i) => Math.min(...perDuck[i].map(s => Math.max(s.w, s.h)));
  const maxOf = (i) => Math.max(...perDuck[i].map(s => Math.max(s.w, s.h)));
  const worst = Math.min(...perDuck.map((_, i) => minOf(i)));
  for (let i = 0; i < perDuck.length; i++){
    const boxMax = Math.max(...perDuck[i].map(s => Math.max(s.bw, s.bh)));
    console.log(`  · duck${i} 窄口径最窄 ${minOf(i).toFixed(1)}px / 最宽 ${maxOf(i).toFixed(1)}px`
      + `　（同帧 Box3 口径最大 ${boxMax.toFixed(1)}px —— 虚胖 ${(boxMax / maxOf(i)).toFixed(2)}×）`);
  }
  check(`① 尺寸：默认机位逐相位最窄 ≥${MIN_PX}px（用窄口径；Box3 会把最窄那帧量胖 ~2 倍）`,
    worst >= MIN_PX, `全场最窄 ${worst.toFixed(1)}px（${perDuck.length} 只 × ${PHASES.length} 相位）`);

  /* ══ ② 池域 + 贴水面线 ══════════════════════════════════════════════════ */
  const geo = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const N = 24, bad = [], offY = [];
    const water = G.waterY(), out = [];
    for (let i = 0; i < G.swimDucks.length; i++){
      const d = G.swimDucks[i];
      let nIn = 0, maxDy = 0;
      for (let k = 0; k < N; k++){
        d.userData.t = k / N * Math.PI * 2;
        const o = G.KOI_ORBITS[d.userData.orbit];
        const j = d.userData.jitter;
        const x = G.koiGroup.position.x + o.cx + Math.cos(d.userData.t) * o.a * j;
        const z = G.koiGroup.position.z + o.cz + Math.sin(d.userData.t) * o.b * j;
        if (G.insidePond(x, z - 3.0)) nIn++;
        else out.push({ i, k, x: +x.toFixed(2), z: +z.toFixed(2) });
        maxDy = Math.max(maxDy, Math.abs(d.position.y - water));
      }
      bad.push(nIn); offY.push(maxDy);
    }
    return { bad, offY, N, water, out, orbits: G.swimDucks.map(d => d.userData.orbit) };
  });
  check('② 池域：整圈 24 相位**全部**在池内（水禽不能游到岸上/草地上）',
    geo.bad.every(n => n === geo.N),
    `各只池内相位 ${geo.bad.join('/')}（共 ${geo.N}）；越界样例 ${JSON.stringify(geo.out.slice(0, 2))}`);
  check('② 贴水面：y 始终贴着水面线（±0.02m，不能浮空也不能沉下去）',
    geo.offY.every(v => v <= 0.02), `各只最大偏离 ${geo.offY.map(v => v.toFixed(4)).join('/')}m`);
  console.log(`  · 轨道分配 ${JSON.stringify(geo.orbits)}（默认机位到 7 条椭圆的距离差很远，见 08 的 DUCK_ORBITS）`);

  /* ══ ③ 在游 ════════════════════════════════════════════════════════════ */
  const before = await page.evaluate(() => window.__garden.swimDucks.map(d => d.position.toArray()));
  await page.waitForTimeout(20000);
  const after = await page.evaluate(() => window.__garden.swimDucks.map(d => d.position.toArray()));
  const moved = before.map((p, i) => Math.hypot(after[i][0] - p[0], after[i][2] - p[2]));
  check('③ 在游：20s 内每只位移 > 0.10m（不动的"鸭子"不如不放）',
    moved.every(v => v > 0.10), `各只位移 ${moved.map(v => v.toFixed(2)).join('/')}m`);

  /* ══ ④ 不占涟漪配额 ═════════════════════════════════════════════════════
     口径：lastRippleAge 每次 spawnRipple 归零 ⇒ 相邻两帧"变小"即为一次落圈。
     ⚠️ 计数器**先排下一帧再干活**：否则首帧一抛异常就再也排不上、所有计数恒 0 而零报错。 */
  await page.evaluate(() => {
    const G = window.__garden;
    const R = window.__mr = { spawns: [], occ: [], err: null, ticks: 0 };
    let prev = G.lastRippleAge();
    const tick = () => {
      requestAnimationFrame(tick);
      try {
        R.ticks++;
        if (R.ticks % 12 === 0) R.occ.push(G.ripplesActive());
        const a = G.lastRippleAge();
        if (a < prev) R.spawns.push(a);          // 归零沿 = 一次 spawnRipple
        prev = a;
      } catch (e){ if (!R.err) R.err = String(e); }
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const tp = await page.evaluate(() => ({ ticks: window.__mr.ticks, err: window.__mr.err }));
  check('④ 前提：计数器活着（否则"没有涟漪"只是计数器死了，零报错最坑）',
    tp.ticks > 0 && !tp.err, `${tp.ticks} 次 tick${tp.err ? '，异常：' + tp.err : ''}`);

  const t0 = Date.now();
  await page.waitForTimeout(30000);
  const ripple = await page.evaluate((ms) => {
    const R = window.__mr;
    const occ = R.occ.slice().sort((a, b) => a - b);
    return { spawns: R.spawns.length, wall: ms / 1000,
             occMed: occ.length ? occ[(occ.length / 2) | 0] : -1, occN: occ.length,
             cap: window.__garden.rippleCapacity() };
  }, Date.now() - t0);
  const perMin = ripple.spawns / ripple.wall * 60;
  check('④ 不占涟漪配额：spawn 频率落在 koi+turtle 的水位内（水禽只挂常驻尾涡圈）',
    perMin <= 80, `实测 ${perMin.toFixed(1)} 次/分（上限 80；若鸭子每帧留圈会是 ~240）`);
  check('④ 独立判据：活涟漪中位数 ≤ 0.75×容量（池子没被按到上限）',
    ripple.occMed >= 0 && ripple.occMed <= 0.75 * ripple.cap,
    `中位 ${ripple.occMed} / 容量 ${ripple.cap}（采样 ${ripple.occN} 次）`);

  /* ══ ⑤ 与泳龟/小鸟同口径：不进折射层、不投影 ══════════════════════════ */
  const flags = await page.evaluate(() => {
    const G = window.__garden;
    const info = G.refractInfo();
    const layer = info && info.layer;
    /* ⚠️⚠️ 不能写 `o.layers.test(layer)` —— three 的 `Layers.test(layers)` 取的是
       **Layers 对象**（内部读 `layers.mask`），传一个层号进去会得到 `9 & undefined = 0`
       ⇒ **恒 false**。这条判据第一版就是这么写的：无论产品对错都是绿的（假门），
       反转之后又无论对错都是红的。必须自己按位判。 */
    const inLayer = (o, n) => (o && n !== undefined) ? ((o.layers.mask & (1 << n)) !== 0) : false;
    return G.swimDucks.map((d, i) => {
      let body = null, wake = null, shadows = [], wakeRef = false, bodyRef = false;
      d.traverse(o => {
        if (!o.isMesh) return;
        if (o.name === 'duckBody' + i){ body = o; bodyRef = inLayer(o, layer); }
        if (o.name === 'duckWake' + i){ wake = o; wakeRef = inLayer(o, layer); }
        shadows.push(!!o.castShadow);
      });
      return { hasBody: !!body, hasWake: !!wake, bodyRef, wakeRef,
               layer, ron: !!(info && info.on), mask: body ? body.layers.mask : -1,
               anyShadow: shadows.some(Boolean),
               noMerge: d.children.every(o => o.userData && o.userData.noMerge) };
    });
  });
  console.log(`  · 折射层号 ${flags[0] && flags[0].layer}（开=${flags[0] && flags[0].ron}）`
    + `　duckBody0 layers.mask=${flags[0] && flags[0].mask}`);
  check('⑤ 每只都有本体网格 + 一个常驻尾涡圈（尾涡圈是网格，不是涟漪实例）',
    flags.every(f => f.hasBody && f.hasWake), JSON.stringify(flags.map(f => [f.hasBody, f.hasWake])));
  check('⑤ 不投影（移动投射物会在静态阴影盒里留下"冻结在半路的影子"，比没影子更假）',
    flags.every(f => !f.anyShadow), flags.map(f => f.anyShadow).join('/'));
  /* ⚠️ 这条在 2026-10-04 被**反转**过：第一版断言"不进折射层"，是错的 ——
     鸭吃水约体高一半、是半浸物，不进层的实际效果是"透过水面看到池底而不是鸭肚皮"。
     现在断言：**本体的层标记必须在**（refract-coverage 判据 ② 的反扫会问同一件事），
     而**尾涡圈必须在层外**（环躺 +0.014m，是水面上的贴花，写进"水下贴图"才是错的）。 */
  check('⑤ 本体**在**折射层（半浸物；不在层里会在水面处被齐刷刷切断、透出池底）',
    flags.every(f => f.bodyRef), flags.map(f => f.bodyRef).join('/'));
  check('⑤ 尾涡圈**不在**折射层（+0.014m 的水面贴花，不该写进"水下贴图"）',
    flags.every(f => !f.wakeRef), flags.map(f => f.wakeRef).join('/'));
  check('⑤ 已挡掉 mergeStatics（否则鸭子会被并进静态大网、之后再也动不了）',
    flags.every(f => f.noMerge), flags.map(f => f.noMerge).join('/'));

  /* ══ 🔧 自检：缩回旧倍率 1.8 ⇒ ① 必须报红 ═════════════════════════════ */
  if (SELFCHECK){
    await page.evaluate(() => {
      window.__garden.swimDucks.forEach(d => d.scale.setScalar(1.8 / 2.4));
    });
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const scaled = [];
    for (const ph of PHASES){
      const row = await sizeAt(ph);
      row.forEach((s, i) => { if (s) (scaled[i] = scaled[i] || []).push(s); });
    }
    const oldWorst = Math.min(...scaled.map((_, i) => Math.min(...scaled[i].map(s => Math.max(s.w, s.h)))));
    check(`🔧 自检：缩回旧倍率 1.8 ⇒ ① 必须报红（证明 ${MIN_PX}px 这条线有牙）`,
      oldWorst < MIN_PX, `旧倍率实测最窄 ${oldWorst.toFixed(1)}px < ${MIN_PX}`);
    await page.evaluate(() => {
      window.__garden.swimDucks.forEach(d => d.scale.setScalar(1));
    });
  }

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  await finish();
})().catch(e => { console.error('[duck-guard] 探针异常：', e); process.exit(2); });
