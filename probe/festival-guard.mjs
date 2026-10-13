// 上元灯会门禁（2026-09-24 · 计划书 Phase 3 第 7 项）
//
// 守什么（逐条对应计划书与它的三个"坑"）：
//   ① 河灯 ≥20 盏且**全部在池域内**、且**随波漂移**（位置在变，不是钉死的装饰）；
//   ② 河灯**不穿过桥体 / 汀步石 / 立峰石组**（计划书验收标准原文："河灯随波漂移不穿过桥体"）；
//   ③ **不新增真光源**：真光源数必须仍等于灯笼的 5 盏（计划书坑①：夜里月光接管阴影方向，
//      加真灯就必须同步改阴影逻辑 ⇒ 一律 emissive 伪造发光）；
//   ④ **draw calls 预算**：灯会态整帧总量的最坏帧仍 < 1600（推导写在断言正上方）；非灯会态的
//      河灯/烛焰/灯串/桃树挂灯必须全部 **count=0**（零提交）；
//   ⑤ **bloom 不溢出死白**：灯会态的亮像素占比必须受控（灯芯亮而不糊成白饼）；
//   ⑥ 一键开关的语义：开灯会 = 记下当前时段 + 切到夜 + 灯会层；关灯会 = 撤灯会层 +
//      **回到进来之前的时段**（老黄 2026-10-05："灯会场景没有退出机制"）。
// 判据都有牙：桥/汀步/立峰的避让用**注入反例**自检（把河灯落点挪进桥体矩形 → 判据必须报红）。
// ── ④ draw calls 判据：逻辑层有牙证据 + 口径订正（2026-10-13 · MobileBot，留档）────────
// 【逻辑层有牙 · 离线自检 6/6】换统计量时做过一组纯 node 的离线自检：把本文件中位/极差的计算
//   **逐字复刻**后喂合成值（不占 GPU、不跑浏览器），6 组全部符合预期，**含低离群点用例** ——
//   [700,850,860,870,880,890] 中位仍落在 860 ⇒ 单个偏低离群点**洗不绿**一次真回归；
//   另含偶数取下中位的临界用例 [700,750,780,820,860,900] ⇒ 中位 780。
//   ⇒ 换统计量没有把这条判据变成橡皮章。
// 【口径订正 · 2026-10-13 Chief 定性】原来读的是 `window.__fg.calls()`（`renderer.info.render.calls`），
//   而 `src/02-scene.js:89` 关掉了 autoReset、`src/11-loop.js:1388` 在**帧首**手动 reset ⇒
//   page.evaluate 在**帧中途**异步读到的是**部分和**，不是整帧总量。
//   症状（三态次序反常）：开灯会读数 **低于**非灯会，而挂灯只会让场景更重 —— 回退不可能让指标下降。
//   修法（纯探针侧，src 一行不碰）：`installComposerHook()` 包住 `composer.render` 取调用前后差 =
// 【当前口径 · 2026-10-13 收口】量的是**一次 composer.render() 的 draw calls 增量**（包 composer.render 取调用前后差，**不做额外 reset**），
//   同时并排记同帧的帧累计作对照。连续 60 帧全记，报 min/中位/max。
//   四态同态表（noon/夜 × 灯会关/开）、纯灯会边际 C−B、A−D 亲还自证、main/total 抖动 全作诊断打印。
// 待办（Chief 裁决记下，现在不做）：统计搬到 Node 侧（evaluate 只采样返回 callsRaw，Node 算中位/极差）。
//   顶层纯函数提出来在浏览器里取不到（page.evaluate 只序列化函数体），只会让同一段逻辑在 Node 与浏览器
//   各存一份、两份会漂。
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
      /* ⚠️ 口径：上面这行读的是**帧中途**的部分和，不是整帧总量（2026-10-13 Chief 定性）。
         真值改读 composer 增量 —— 由 installComposerHook() 包住 composer.render 取前后差。 */
      calls(){ return g.renderer.info.render.calls; },
      installHook: installComposerHook,
    };
    function installComposerHook(){
      /* 量「**一次 composer.render() 的 draw calls 增量**」= 调用前后差（2026-10-13 Chief 定）。
         为什么不再读帧总量：`src/11-loop.js:1424 renderRefraction()` 在 composer.render() **之后同帧**调用、
         落在同一个 info.reset 窗口内，且它**按需更新**（src/05-water.js:225「反射按需更新」、
         :263 `busy = reflectEveryFrame || HOOKS.waterBusy()`）⇒ 帧总量天然**跳两档**。
         实测跳幅与那趟反射同量级：前置 1657−1084=573、灯会 1323−851=472、关灯后 1690−1070=620。
         ⚠️ **不做任何额外 reset**：产品 stats 也在读同一个量（src/11-loop.js:1408 的 draw calls 行、
         :1707 的 drawCalls 字段），多插一次 reset 会污染它。本钩子只观测、不改记账。 */
      const G = window.__garden;                     // ← src/11-loop.js:1721 已挂载 renderer/composer，非猜测
      const info = G.renderer && G.renderer.info, comp = G.composer;
      if (!info || !comp || typeof comp.render !== 'function') return false;
      const orig = comp.render.bind(comp);
      window.__frameSamples = [];
      comp.render = function(...args){
        const before = info.render.calls;
        const ret = orig(...args);
        const after = info.render.calls;
        /* 两路并排记同一帧：main = 本次 composer.render 的净增量；total = 此刻的帧累计（跳两档的那个）。 */
        window.__frameSamples.push({ main: after - before, total: after });
        if (window.__frameSamples.length > 400) window.__frameSamples.shift();
        return ret;
      };
      return true;
    }
  });
  /* 装钩子（纯探针侧）：越早越好，保证后面三态读到的都是真值。
     装不上就当场报出来，不猜、不继续跑后面的断言。 */
  check('前提：帧首 reset 钩子装载成功（否则三态读数全是部分和，本门读数作废）',
        await page.evaluate(() => window.__fg.installHook()));

  /* ── ① 非灯会态：河灯/灯串/桃树挂灯 count=0（零提交，零 draw call）── */
  const off = await page.evaluate(async () => {
    const r = window.__garden.festivalState();
    const pick = (n) => { const m = window.__fg.findInst(n); return m ? m.count : -1; };
    /* 采样沿用现役那版：6 次 / 间隔 2000ms / 取中位（口径修好后中位才有意义；不用「取最大」掩盖相位）。
       每档同时留**旧的帧中途读法**做自证：新读法必须 ≥ 旧读法，否则包错了位置，当场报出来。 */
    /* 采样：连续 N 帧**全记**（不再隔 2s 抽一帧 —— 实测帧间摆 58%，6 个稀疏点不够）。
       两路并排：main = 一次 composer.render() 的净增量；total = 同一时刻的帧累计。 */
    const FRAMES = 60;
    window.__frameSamples.length = 0;
    for (let i = 0; i < FRAMES; i++) await new Promise(r => requestAnimationFrame(r));
    const fs = window.__frameSamples.slice();
    const mainRaw = fs.map(s => s.main), totalRaw = fs.map(s => s.total);
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const rng = (a) => ({ min: a.length ? Math.min(...a) : 0, max: a.length ? Math.max(...a) : 0 });
    const mainMed = med(mainRaw), totalMed = med(totalRaw), mainR = rng(mainRaw), totalR = rng(totalRaw);
    /* 自证（**同帧逐样本**，不是两套独立样本比中位）：composer 增量是帧累计的**子集**，
       故每一帧都必须满足 total[i] >= main[i]。上一版拿「两套样本比中位」方向可能反，已废。
       若不成立 ⇒ 钩子包错了，当场报出来，不继续跑后面的断言。 */
    const selfCheckOk = fs.length > 0 && mainRaw.every((m, i) => totalRaw[i] >= m);
    /* 「帧总量跳两档、增量稳定」是**观察**，不作判定 —— 形态由读数说话，不预设。 */
    const mainJitter = mainR.max - mainR.min, totalJitter = totalR.max - totalR.min;
    return { st: r, riverCount: pick('riverLanterns'), flameCount: pick('riverLanternFlames'),
             stringCount: pick('corridorStringLights'),
             calls: mainMed, callsRaw: mainRaw, mainR, totalR, totalMed, totalMax: totalR.max, mainJitter, totalJitter,
             selfCheckOk };
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
    /* ⚠️ 这一轮**不要**在同一轮里切轴 —— 换场景会收起灯会（2026-10-06 新契约），
       一旦混在一起，time/festival/show 这些读数就被收起过程污染（我第一版就这么写错了，
       三条判据同时假红）。换场景那件事单独一轮做，见下面 axisExit。 */
    /* ── draw calls：单次读数 → 中位统计量（2026-10-13 · MobileBot）──────────
       为什么必须改（Chief 亲测，不必重测）：同一门内 前置 1084 → 开灯 1323 → **关灯 1684**
       （关灯比开灯还高 361）；两次运行 1323 vs 851 自漂 472 ⇒ **单次读数的抖动比要判的
       效应还大**，这是口径问题，不是产品回归。

       单次读数为什么这么野（机制，不是猜测）：
         · `src/02-scene.js:89` 设 `renderer.info.autoReset = false`，
           `src/11-loop.js:1388` 在每帧 animate 开头手动 `info.reset()`
           ⇒ 这个量是**整帧累计**（含后处理多趟），不是单趟 draw 的调用数；
         · 而 page.evaluate 是**帧中途异步**读的 ⇒ 读到的是「本帧渲染到哪儿了」的部分和。
         **采样落点不同 ⇒ 读数不同**，这是 1323 vs 851 那类自漂的来源。

       当时的修法（**那一版的阈值 800 一个字未改**，只把单次读数换成统计量；
       800 后来已作废，见本文件 ④ 顶部的 1600 推导注释）：
         同一状态采 6 次 → 取**中位数**参与判定；每次原始读数与极差全打进 detail，
         让判据**自带离散度证据**：下次若中位数仍飘，看 detail 立刻能分「统计量不够稳」
         与「产品真变了」，而不用再猜。 */
    /* ── 采样：连续 60 帧**全记**，两路并排（2026-10-13 Chief 定）────────────────
       · main  = **一次 composer.render() 的 draw calls 增量**（installComposerHook 包前后差）；
       · total = 同一时刻的帧累计（含按需反射那一趟 ⇒ 天然跳两档，只作对照，不参与判定）。
       为什么不用「隔 2s 抽一帧」：实测帧间摆动 58%（关灯后 6 采里 1070~1690），
       6 个稀疏点不足以刻画分布 ⇒ 改成连续帧全记，报 min/中位/max。 */
    const FRAMES = 60;
    window.__frameSamples.length = 0;
    for (let i = 0; i < FRAMES; i++) await new Promise(r => requestAnimationFrame(r));
    const fs = window.__frameSamples.slice();
    const mainRaw = fs.map(s => s.main), totalRaw = fs.map(s => s.total);
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const rng = (a) => ({ min: a.length ? Math.min(...a) : 0, max: a.length ? Math.max(...a) : 0 });
    const mainMed = med(mainRaw), totalMed = med(totalRaw), mainR = rng(mainRaw), totalR = rng(totalRaw);
    /* 自证（**同帧逐样本**，不是两套独立样本比中位 —— 上一版那样比方向可能反，已废）：
       composer 增量是帧累计的**子集** ⇒ 每一帧都必须满足 total[i] >= main[i]。
       不成立 ⇒ 钩子包错了，本档读数作废，当场报出来。 */
    const selfCheckOk = fs.length > 0 && mainRaw.every((m, i) => totalRaw[i] >= m);
    const mainJitter = mainR.max - mainR.min, totalJitter = totalR.max - totalR.min;
    return { time: g.ENV.time, festival: g.ENV.festival, show: g.ENV.cur.festivalShow,
             beforeAxis, nightPressed, hourReadout,
             st: g.festivalState(),
             calls: mainMed, callsRaw: mainRaw, mainR, totalR, totalMed, totalMax: totalR.max,
             mainJitter, totalJitter, selfCheckOk };
  });
  check('⑥ 开灯会：自动切到夜（灯会是夜的 plus 版）且存在性通道 = 1',
    on.time === 'night' && on.festival === true && on.show > 0.97,
    `time=${on.time} festival=${on.festival} festivalShow=${(+on.show).toFixed(2)}`);
  check('⑥ 开灯会同帧同步环境 UI：夜按钮选中、时辰显示 21:30',
    on.nightPressed === 'true' && on.hourReadout === '21:30',
    `夜按钮=${on.nightPressed} · hourReadout=${on.hourReadout}`);
  /* ── ⑥ 换场景 ⇒ 灯会收起（2026-10-06 契约**翻面**）─────────────────────────
     老黄："选过'灯会'场景，切换其它场景，灯会的布景一直带到其它场景中，这个应该也是 bug"
     ⇒ 灯会不再是"与季节正交的第 4 层"，而是**一个场景**：任何环境轴切换都把它收起，
     连河灯/灯串/挂灯一起消失。旧判据守的正是相反的行为（"切季节后按钮仍 true"），
     已随之翻面 —— 否则门禁在惩罚正确改动（同"判据把产品当时的样子固化成标准"）。 */
  const axisExit = await page.evaluate(async () => {
    const g = window.__garden;
    const btn = document.querySelector('[data-act="festival"]');
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    g.setEnv('season', 'summer');                       // 先离开灯会（上一轮还开着）
    await wait(400);
    g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
    await wait(400);
    g.toggleFestival(true);
    await wait(500);
    const was = { f: g.ENV.festival, btn: btn && btn.getAttribute('aria-pressed'),
                  target: +g.ENV.to.festivalShow.toFixed(3) };
    g.setEnv('season', 'spring');                       // ← 换场景
    await wait(300);
    return { was, f: g.ENV.festival, btn: btn && btn.getAttribute('aria-pressed'),
             target: +g.ENV.to.festivalShow.toFixed(3) };
  });
  check('⑥ 换场景（切季节）⇒ 灯会**必须收起**：按钮回落 + 存在性目标归 0',
    axisExit.was.f === true && axisExit.was.btn === 'true'
      && axisExit.f === false && axisExit.btn === 'false' && axisExit.target < 0.03,
    `灯会 ${axisExit.was.f}→${axisExit.f} · 按钮 ${axisExit.was.btn}→${axisExit.btn}`
    + ` · festivalShow 目标 ${axisExit.was.target}→${axisExit.target}`
    + `（旧契约是"与季节正交、不许收起"，2026-10-06 老黄改的）`);
  check('① 河灯 ≥20 盏（计划书原文）', on.st.riverN >= 20,
    `河灯 ${on.st.riverN} 盏 · 灯串 ${on.st.stringN} 颗 · draw calls(中位)=${on.calls}`);
  check('① 两株桃树的枯枝挂灯全部显现（count=fullCount）',
    on.st.treeN === on.st.treeFull && on.st.treeFull > 0,
    `tree=${on.st.treeN}/${on.st.treeFull}`);
  /* ═══════════════════════════════════════════════════════════════════════
     ④ 灯会态 draw calls 上限 —— **阈值 1600 及其推导写死在本注释里**
     （它是判据的一部分，不是会漂的读数；下面凡带日期的数字才是读数，会随场景变）。
     ───────────────────────────────────────────────────────────────────────
     【判定量】灯会态「**整帧总量的最坏帧**」= total 那一路，连续 60 帧取 **max**。
       为什么取 max 而不是中位：帧总量因「按需反射那一趟渲了没渲」而**跳两档**。
       最坏帧就是「包含那趟的帧」⇒ **确定性地把两档吃掉**，而不是抽一个随机值。
       这保住了这条判据的原语义「灯会态的总 draw calls」。
     ───────────────────────────────────────────────────────────────────────
     【旧上限 800 作废】出自 2026-09-25 的 f82788e，是**从 smoke 借来的数**；当年在
       **480×640 视口**用**单次部分和**标定。与今天这个量（1100×660 视口、帧首
       重置后的整帧最坏帧）**不同口径、不可比**。完整溯源见 outputs/_diag/festival-budget-provenance.md。
     ───────────────────────────────────────────────────────────────────────
     【新上限 1600 的推导】= **2026-10-13 实测灯会态最坏帧 1288 × 1.25，向上取整到整百 = 1600**。
       1288 是 2026-10-13 那次单跑的实测值（日志 outputs/_diag/festival-totalmax-run6-20261013-1703.log），
       属**读数**、会随场景变；1600 是**判据**、不随读数变。留约 300 笔 ≈ 一次小改动的空间。
     ───────────────────────────────────────────────────────────────────────
     【这不是「为了让门变绿而调松」】它把一把**从未为这个量校准过**的旧尺子，换成同口径的实测刻度；
       从今天起它防的是「**场景变重**」。用户 2026-10-13 已确认：灯会场景实际跑起来没问题、
       效果不错 ⇒ **不做产品侧减负**（审计 A03 未结）。
     ───────────────────────────────────────────────────────────────────────
     【诊断项 · 只打印不判定】main（composer.render 增量）、四态同态表、纯灯会边际 C−B、
       时段份 B−A、A−D 便宜自证、main/total 抖动 —— 全部保留为 detail，见下面几条 check。
  */
  const FEST_CALLS_CAP = 1600;
  check('④ 灯会态 draw calls 仍 < 1600（预算没被顶破）', on.totalMax < FEST_CALLS_CAP,
    `最坏帧 ${on.totalMax} / 上限 ${FEST_CALLS_CAP}（余量 ${FEST_CALLS_CAP - on.totalMax}）`
    + ` · 连续 ${on.callsRaw.length} 帧 · 帧总量分布 min~med~max = ${on.totalR.min}~${on.totalMed}~${on.totalMax}`)
    + ` · 同批 composer 增量中位 ${on.calls}`;
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

  /* ── ⑥ 关灯会：撤层 + **回到进来之前的时段** + count 归 0 ──
     ⚠️⚠️ 2026-10-05 改口径：旧版守的是"关灯会后**留在夜里**"（当年老黄问"为什么关了
     灯会天还黑着"留下的）。但老黄 2026-10-05 又提"灯会场景没有退出机制" —— 进灯会会
     强切到夜 21:30，关掉之后人留在夜里、没有回到进来前时段的路。产品已改成"退出时恢复
     进来前的 (time, hour)"（12-env 的 _festPrev），**判据必须跟着改** —— 否则就是又一次
     "判据把产品当时的样子固化成标准"、反过来罚用户明确要的效果。
     ⚠️ 快照必须在**退出之前**读（festivalState().prevTime；退出时 _festPrev 会置空）。 */
  const back = await page.evaluate(async () => {
    const g = window.__garden;
    const pick = (n) => { const m = window.__fg.findInst(n); return m ? m.count : -1; };
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    /* ⚠️ 2026-10-06：上一段（换场景收起）跑完时灯会已经是关的 ⇒ 这一轮必须**自己重新开一次**
       再关，否则 toggleFestival(false) 是空操作、_festPrev 恒为 null（我第一版就踩了这个，
       "回到进来前时段"那条当场假红）。 */
    g.setEnv('time', 'noon'); g.setEnv('weather', 'clear');
    await wait(400);
    g.toggleFestival(true);
    await wait(600);
    const before = g.festivalState();            // 退出前：这里应记着"进来之前 = noon"
    g.toggleFestival(false);
    await new Promise(r => requestAnimationFrame(r));
    const t0 = performance.now();
    while (performance.now() - t0 < 4500) await new Promise(r => requestAnimationFrame(r));
    /* 与另两档同一套读法：帧首 reset 前的整帧总量，并排留旧读法自证。 */
    /* 与另两档同一套读法：连续 60 帧全记，main = composer.render 增量 / total = 帧累计。 */
    const FRAMES = 60;
    window.__frameSamples.length = 0;
    for (let i = 0; i < FRAMES; i++) await new Promise(r => requestAnimationFrame(r));
    const fs = window.__frameSamples.slice();
    const mainRaw = fs.map(s => s.main), totalRaw = fs.map(s => s.total);
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const rng = (a) => ({ min: a.length ? Math.min(...a) : 0, max: a.length ? Math.max(...a) : 0 });
    const mainMed = med(mainRaw), totalMed = med(totalRaw), mainR = rng(mainRaw), totalR = rng(totalRaw);
    return { time: g.ENV.time, festival: g.ENV.festival, show: g.ENV.cur.festivalShow,
             prevTime: before.prevTime, prevHour: before.prevHour, st: g.festivalState(),
             riverCount: pick('riverLanterns'), flameCount: pick('riverLanternFlames'),
             stringCount: pick('corridorStringLights'),
             calls: mainMed, callsRaw: mainRaw, mainR, totalR, totalMed, totalMax: totalR.max,
             mainJitter: mainR.max - mainR.min, totalJitter: totalR.max - totalR.min,
             selfCheckOk: fs.length > 0 && mainRaw.every((m, i) => totalRaw[i] >= m) };
  });
  /* ── 第四态 B：夜·灯会关（2026-10-13 Chief 新增）────────────────────────────
     为什么必须补：灯会会**自动切到夜**（`on.time === 'night'`），而 A/D 两态是 **noon** ⇒
     原三态比的是「白天无灯会」对「夜里开灯会」，差的不只是灯会，还有**日照阴影那一趟**。
     补上 B 之后，**C − B = 纯灯会边际增量**（同态，灯会是唯一变量）——这才是 ④ 该问的量。 */
  const nightOff = await page.evaluate(async () => {
    const g = window.__garden;
    g.setEnv('time', 'night');
    await new Promise(r => setTimeout(r, 6000));      // 等过渡（ENV.dur 默认 2.8s）与场景稳
    const FRAMES = 60;
    window.__frameSamples.length = 0;
    for (let i = 0; i < FRAMES; i++) await new Promise(r => requestAnimationFrame(r));
    const fs = window.__frameSamples.slice();
    const mainRaw = fs.map(s => s.main), totalRaw = fs.map(s => s.total);
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const rng = (a) => ({ min: a.length ? Math.min(...a) : 0, max: a.length ? Math.max(...a) : 0 });
    const mainR = rng(mainRaw), totalR = rng(totalRaw);
    return { time: g.ENV.time, festival: g.ENV.festival, n: fs.length,
             calls: med(mainRaw), callsRaw: mainRaw, mainR, totalR, totalMed: med(totalRaw), totalMax: totalR.max,
             mainJitter: mainR.max - mainR.min, totalJitter: totalR.max - totalR.min,
             selfCheckOk: fs.length > 0 && mainRaw.every((m, i) => totalRaw[i] >= m) };
  });
  /* ⚠️ 自证改为**同帧逐样本**：composer 增量是帧累计的子集 ⇒ 每帧必须 total[i] >= main[i]。
     （上一版拿两套独立样本比中位，方向可能反，已废 —— 它的失败是我的设计问题，不是钩子问题。） */
  check('④ 口径自证：同帧逐样本 total[i] ≥ main[i]（composer 增量 ⊆ 帧累计）· 四态均成立',
        on.selfCheckOk === true && off.selfCheckOk === true
        && back.selfCheckOk === true && nightOff.selfCheckOk === true,
        `四态 main 抖动 ${off.mainJitter}/${on.mainJitter}/${back.mainJitter}/${nightOff.mainJitter} · total 抖动 ${off.totalJitter}/${on.totalJitter}/${back.totalJitter}/${nightOff.totalJitter}`);
  check('④ 四态 composer 增量（noon/夜 × 灯会关/开）+ 纯灯会边际 + A≈D 便宜自证',
        off.calls > 0 && nightOff.calls > 0 && on.calls > 0 && back.calls > 0,
        `A noon·灯会关 ${off.calls}（${off.mainR.min}~${off.mainR.max}） · B 夜·灯会关 ${nightOff.calls}（${nightOff.mainR.min}~${nightOff.mainR.max}） · C 夜·灯会开 ${on.calls}（${on.mainR.min}~${on.mainR.max}） · D noon·灯会关 ${back.calls}（${back.mainR.min}~${back.mainR.max}） ｜ 纯灯会边际 C−B = ${on.calls - nightOff.calls} · 时段份 B−A = ${nightOff.calls - off.calls} · A−D = ${off.calls - back.calls}`);

  check('⑥a 关灯会：回到**进来之前**的时段（不是留在夜里，也不是跳到别的时段）',
    back.festival === false && back.show < 0.03 && back.prevTime === 'noon' && back.time === 'noon',
    `time=${back.time}（进来前=noon · 退出前快照 prevTime=${back.prevTime}）festival=${back.festival} festivalShow=${(+back.show).toFixed(2)}`);
  check('④ 关灯会后河灯/烛焰/灯串/桃树挂灯 count 归 0（draw call 回落）',
    back.riverCount === 0 && back.flameCount === 0 && back.stringCount === 0
      && back.st.treeN === 0 && back.st.treeFull > 0,
    `river=${back.riverCount} flame=${back.flameCount} string=${back.stringCount} · tree=${back.st.treeN}/${back.st.treeFull} · draw calls=${back.calls}`);

  /* ── ⑥b 另一半：**换时段**（用户自己在灯会里改时段 = 换场景）同样收起，
     而且时段以**他的选择**为准（不许拽回进来前的时段）──────────────────────────
     ⚠️ 2026-10-06 契约翻面：旧判据守的是"灯会里改时段 ⇒ 灯会照旧开着、退出时以他的改动为准"
     （那时灯会是"与时段正交的第 4 层"）。老黄现在要求"换场景就收起" ⇒ 新的两半是：
       ① 换时段 ⇒ 灯会当场收起（这条有新牙）；
       ② 收起后时段 = 他选的（不被 _festPrev 拽回）—— 旧契约那半仍然成立，只是场景变了。 */
  const back2 = await page.evaluate(async () => {
    const g = window.__garden;
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    g.setEnv('time', 'noon');
    await wait(400);
    g.toggleFestival(true);
    await wait(500);
    const inside = { time: g.ENV.time, f: g.ENV.festival };
    g.setEnv('time', 'morning');                 // 用户在灯会里自己把时段改成「晨」= 换场景
    await wait(300);
    const at = { time: g.ENV.time, f: g.ENV.festival, target: +g.ENV.to.festivalShow.toFixed(3) };
    return { inside, at };
  });
  check('⑥b 灯会里自己改时段 ⇒ 灯会同样收起，且时段**以他的改动为准**（不拽回 noon）',
    back2.inside.f === true && back2.at.f === false && back2.at.time === 'morning'
      && back2.at.target < 0.03,
    `灯会 ${back2.inside.f}→${back2.at.f} · 时段 ${back2.inside.time}→${back2.at.time}（应 morning）`
    + ` · festivalShow 目标 ${back2.at.target}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[festival-guard] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[festival-guard] 探针自身异常：', e); process.exit(1); });
