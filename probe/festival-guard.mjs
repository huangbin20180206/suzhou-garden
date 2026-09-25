// 上元灯会门禁（2026-09-24 · 计划书 Phase 3 第 7 项）
//
// 守什么（逐条对应计划书与它的三个"坑"）：
//   ① 河灯 ≥20 盏且**全部在池域内**、且**随波漂移**（位置在变，不是钉死的装饰）；
//   ② 河灯**不穿过桥体 / 汀步石 / 立峰石组**（计划书验收标准原文："河灯随波漂移不穿过桥体"）；
//   ③ **不新增真光源**：真光源数必须仍等于灯笼的 5 盏（计划书坑①：夜里月光接管阴影方向，
//      加真灯就必须同步改阴影逻辑 ⇒ 一律 emissive 伪造发光）；
//   ④ **draw calls 预算**：灯会态总 draw calls 仍 < 800（smoke 的上限）；非灯会态的
//      河灯/烛焰/灯串/桃树挂灯必须全部 **count=0**（零提交）；
//   ⑤ **bloom 不溢出死白**：灯会态的亮像素占比必须受控（灯芯亮而不糊成白饼）；
//   ⑥ 一键开关的语义：开灯会 = 切到夜 + 灯会层；关灯会 = 撤灯会层但**留在夜里**。
// 判据都有牙：桥/汀步/立峰的避让用**注入反例**自检（把河灯落点挪进桥体矩形 → 判据必须报红）。
// 用法: node probe/festival-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
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
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1100, height: 660 } });
  page.setDefaultTimeout(240000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  console.log(`\n[festival-guard] http://127.0.0.1:${port}/index.html`);

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* 页内工具：池域判定（与产品同口径）+ 河灯/灯串/真光源状态 */
  await page.evaluate(async () => {
    const g = window.__garden;
    const poly = g.POND_PTS.map(p => [p.x, p.y]);
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
      }
      return c;
    };
    const findInst = (name) => { let m = null; g.scene.traverse(o => { if (o.name === name) m = o; }); return m; };
    window.__fg = {
      inside, findInst,
      /* 读河灯的**实际世界位置**（跟 InstancedMesh 矩阵，不读 data 数组 —— 判据要量"画面上真在哪"） */
      riverPos(){
        const m = window.__fg.findInst('riverLanterns');
        if (!m || m.count === 0) return [];
        const T = g.THREE, out = [], m4 = new T.Matrix4(), v = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
        for (let i = 0; i < m.count; i++){ m.getMatrixAt(i, m4); m4.decompose(v, q, s); out.push([+v.x.toFixed(3), +v.z.toFixed(3)]); }
        return out;
      },
      calls(){ return g.renderer.info.render.calls; },
    };
  });

  /* ── ① 非灯会态：河灯/灯串/桃树挂灯 count=0（零提交，零 draw call）── */
  const off = await page.evaluate(() => {
    const r = window.__garden.festivalState();
    const pick = (n) => { const m = window.__fg.findInst(n); return m ? m.count : -1; };
    return { st: r, riverCount: pick('riverLanterns'), flameCount: pick('riverLanternFlames'),
             stringCount: pick('corridorStringLights'), calls: window.__fg.calls() };
  });
  check('前置：默认（未开灯会）河灯/烛焰/灯串/桃树挂灯 count=0（零 draw call）',
    off.riverCount === 0 && off.flameCount === 0 && off.stringCount === 0
      && off.st.treeN === 0 && off.st.treeFull > 0,
    `river=${off.riverCount} flame=${off.flameCount} string=${off.stringCount} · tree=${off.st.treeN}/${off.st.treeFull} · draw calls=${off.calls}`);

  /* ── ③ 真光源数（开灯会前后都必须等于灯笼的 5 盏）── */
  check('不新增真光源：真光源仍是灯笼的 5 盏', off.st.lampLights === 5,
    `lampLights=${off.st.lampLights}`);

  /* ── ⑥ 一键切换语义：开 = 夜 + 灯会层；关 = 留夜撤层 ── */
  const on = await page.evaluate(async () => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
    await new Promise(r => setTimeout(r, 200));
    g.toggleFestival(true);
    await new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now();
    while (performance.now() - t0 < 4000) await new Promise(r => requestAnimationFrame(r));
    const btn = document.querySelector('[data-act="festival"]');
    const nightBtn = document.querySelector('[data-axis="time"][data-v="night"]');
    const beforeAxis = btn && btn.getAttribute('aria-pressed');
    const nightPressed = nightBtn && nightBtn.getAttribute('aria-pressed');
    const hourReadout = document.getElementById('hourReadout').textContent;
    g.setEnv('season', 'spring');                 // 灯会是第 4 层，季节轴切换不能把按钮态抹掉
    const afterAxis = btn && btn.getAttribute('aria-pressed');
    return { time: g.ENV.time, festival: g.ENV.festival, show: g.ENV.cur.festivalShow,
             beforeAxis, afterAxis, nightPressed, hourReadout,
             st: g.festivalState(), calls: window.__fg.calls() };
  });
  check('⑥ 开灯会：自动切到夜（灯会是夜的 plus 版）且存在性通道 = 1',
    on.time === 'night' && on.festival === true && on.show > 0.97,
    `time=${on.time} festival=${on.festival} festivalShow=${(+on.show).toFixed(2)}`);
  check('⑥ 开灯会同帧同步环境 UI：夜按钮选中、时辰显示 21:30',
    on.nightPressed === 'true' && on.hourReadout === '21:30',
    `夜按钮=${on.nightPressed} · hourReadout=${on.hourReadout}`);
  check('⑥ 灯会与季节轴正交：切季节后按钮 aria-pressed 仍为 true',
    on.beforeAxis === 'true' && on.afterAxis === 'true',
    `aria-pressed ${on.beforeAxis} → ${on.afterAxis}`);
  check('① 河灯 ≥20 盏（计划书原文）', on.st.riverN >= 20,
    `河灯 ${on.st.riverN} 盏 · 灯串 ${on.st.stringN} 颗 · draw calls=${on.calls}`);
  check('① 两株桃树的枯枝挂灯全部显现（count=fullCount）',
    on.st.treeN === on.st.treeFull && on.st.treeFull > 0,
    `tree=${on.st.treeN}/${on.st.treeFull}`);
  check('④ 灯会态 draw calls 仍 < 800（预算没被顶破）', on.calls < 800, `draw calls=${on.calls}`);

  /* ── ① 河灯全在池域内 ── */
  const pool = await page.evaluate(() => {
    const pos = window.__fg.riverPos();
    const bad = pos.filter(([x, z]) => !window.__fg.inside(x, z - 3.0));
    return { n: pos.length, bad: bad.slice(0, 6), all: pos };
  });
  check('① 所有河灯都在池域内（没漂到岸上）', pool.bad.length === 0,
    pool.bad.length ? `越界 ${pool.bad.length} 盏，例 ${JSON.stringify(pool.bad)}` : `${pool.n} 盏全在池内`);

  /* ── ② 避开桥体 / 汀步石 / 立峰石组（含**注入反例**自检）── */
  const avoid = await page.evaluate(() => {
    /* 实测/源码常量（见 src/12-env.js FEST_BRIDGE/STONES/HERO 注释）；pad=1.0 与产品同值 */
    const R = { bridge: { x0: 7.2, x1: 9.6, z0: -0.1, z1: 9.3 },
                stones: { x0: -4.12, x1: 6.99, z0: 4.93, z1: 6.32 },
                hero:   { x0: -6.97, x1: -2.83, z0: 5.9, z1: 9.81 } };
    const PAD = 1.0;
    const inR = (r, x, z) => x > r.x0 - PAD && x < r.x1 + PAD && z > r.z0 - PAD && z < r.z1 + PAD;
    const pos = window.__fg.riverPos();
    const hits = { bridge: [], stones: [], hero: [] };
    for (const [x, z] of pos){
      if (inR(R.bridge, x, z)) hits.bridge.push([x, z]);
      if (inR(R.stones, x, z)) hits.stones.push([x, z]);
      if (inR(R.hero,   x, z)) hits.hero.push([x, z]);
    }
    /* 反例自检：桥体矩形正中那个点，必须被判为"在禁区内"（否则判据写得太松、全绿是假的） */
    const probePt = [8.4, 4.6];        // 桥体中心（08 里 world(8.4,0,4.6)）
    const selfTest = inR(R.bridge, probePt[0], probePt[1]);
    return { hits, selfTest, n: pos.length };
  });
  check('② 河灯不与桥体/汀步石/立峰石组重叠（含 1m 余量）',
    avoid.hits.bridge.length === 0 && avoid.hits.stones.length === 0 && avoid.hits.hero.length === 0,
    `桥 ${avoid.hits.bridge.length} / 汀步 ${avoid.hits.stones.length} / 立峰 ${avoid.hits.hero.length} 处重叠（${avoid.n} 盏）`);
  check('② 判据有牙：桥体中心点必须被判为"在禁区内"（注入反例自检）',
    avoid.selfTest === true, `桥体中心 (8.4,4.6) inRect=${avoid.selfTest}`);

  /* ── ① 随波漂移：位置必须在变 ──
     ⚠️ 按**帧数**而不是墙钟：软渲染（核显）一帧可能 0.5~1s，2.5 秒只跑 3~5 帧，
        漂移量自然量不出来（实测高档档 2.5s 只有 0.025m）。跑满 N 帧再看位移。 */
  const drift = await page.evaluate(async () => {
    const g = window.__garden;
    const a = window.__fg.riverPos();
    let moved = 0, maxD = 0, frames = 0;
    while (frames < 45){
      await new Promise(r => requestAnimationFrame(r));
      frames++;
      const b = window.__fg.riverPos();
      for (let i = 0; i < Math.min(a.length, b.length); i++){
        const d = Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
        if (d > 0.02) moved++;
        maxD = Math.max(maxD, d);
      }
      if (moved >= 3) break;
    }
    return { moved, maxD: +maxD.toFixed(3), n: a.length, frames };
  });
  check('① 河灯**随波漂移**（45 帧内 ≥3 盏位置明显变化）', drift.moved >= 3,
    `${drift.moved}/${drift.n} 盏移动，最大位移 ${drift.maxD}m（跑了 ${drift.frames} 帧）`);
  /* 漂移判据的**负例自检**：开产品自带的冻结开关（权威，不是"再调一次"）⇒
     河灯必须**完全不动**。这条证明"位置在变"不是白送的。
     ⚠️ 踩过的坑：原来在页内反复调 `tickFestival(0)` 想冻结 —— 渲染循环每帧又用真时钟
     调一次，两次调用互相覆盖 ⇒ 冻结无效（实测仍漂 0.062m，门禁当场报红才暴露出来）。 */
  const driftSelf = await page.evaluate(async () => {
    const g = window.__garden;
    g.setFestivalFreeze(true);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    const a = window.__fg.riverPos();
    for (let i = 0; i < 20; i++) await new Promise(r => requestAnimationFrame(r));
    const b = window.__fg.riverPos();
    g.setFestivalFreeze(false);
    let maxD = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      maxD = Math.max(maxD, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
    return +maxD.toFixed(4);
  });
  check('① 判据有牙 · 负例自检：冻结漂移时钟后河灯必须**完全不动**（漂移判据会因此报红）',
    driftSelf < 0.005, `冻结 20 帧后最大位移 ${driftSelf}m（应 ≈ 0）`);

  /* ── ⑤ bloom 不溢出死白：灯会态近白像素占比受控 ── */
  const white = await page.evaluate(() => {
    const g = window.__garden;
    const cvs = g.renderer.domElement;
    const c = document.createElement('canvas'); c.width = cvs.width; c.height = cvs.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cvs, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let hot = 0, n = 0;
    for (let i = 0; i < d.length; i += 4){
      n++;
      /* 近白：三通道都 ≥248（tone mapping 后纯白约 204~255；248 以上是"真白"） */
      if (d[i] >= 248 && d[i + 1] >= 248 && d[i + 2] >= 248) hot++;
    }
    return { pct: +(hot / n * 100).toFixed(3) };
  });
  check('⑤ bloom 未溢出成死白（近白像素 < 1.2%）', white.pct < 1.2, `近白像素 ${white.pct}%`);

  /* ── ⑥ 关灯会：撤层、留夜、count 归 0 ── */
  const back = await page.evaluate(async () => {
    const g = window.__garden;
    g.toggleFestival(false);
    await new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now();
    while (performance.now() - t0 < 4500) await new Promise(r => requestAnimationFrame(r));
    const pick = (n) => { const m = window.__fg.findInst(n); return m ? m.count : -1; };
    return { time: g.ENV.time, festival: g.ENV.festival, show: g.ENV.cur.festivalShow,
             st: g.festivalState(),
             riverCount: pick('riverLanterns'), flameCount: pick('riverLanternFlames'),
             stringCount: pick('corridorStringLights'), calls: window.__fg.calls() };
  });
  check('⑥ 关灯会：撤掉灯会层但**留在夜里**（不是跳回白天）',
    back.festival === false && back.show < 0.03 && back.time === 'night',
    `time=${back.time} festival=${back.festival} festivalShow=${(+back.show).toFixed(2)}`);
  check('④ 关灯会后河灯/烛焰/灯串/桃树挂灯 count 归 0（draw call 回落）',
    back.riverCount === 0 && back.flameCount === 0 && back.stringCount === 0
      && back.st.treeN === 0 && back.st.treeFull > 0,
    `river=${back.riverCount} flame=${back.flameCount} string=${back.stringCount} · tree=${back.st.treeN}/${back.st.treeFull} · draw calls=${back.calls}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[festival-guard] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[festival-guard] 探针自身异常：', e); process.exit(1); });
