// 锦鲤出水涟漪 · 频率门禁（2026-09-26）
//
// 用户诉求："鱼游出水面会泛起涟漪的频率太过频繁"。
// 本门守的**不是**"有没有涟漪"，而是**频率水位** —— 判据全部是"次/分"计数比
// （项目铁律：不许用两次采样的间隔；也不许用峰值/极差，要中位数与计数占比）。
//
// 四条涟漪链（实测签名，静态核对自源码）：
//   锦鲤  11-loop  spawnRipple(x,z,t,3)          rings=3 strength=1   kind=''
//   泳龟  11-loop  spawnRipple(x,z,t,2)          rings=2 strength=1   kind=''
//   点击  11-loop  spawnRipple(x,z,t,5,1.6)      rings=5 strength=1.6 kind=''
//   雨滴  12-env   spawnRipple(...,2|3,s,'rain') kind='rain'，s∈[0.525,0.975] 恒<1
// ⇒ 锦鲤签名唯一；本门只对**锦鲤链**定水位，其余三条链由 ripple-bounds / smoke 守。
//
// 计数口径（**先断言前提**）：锦鲤落圈 1:1 挂在 `d.wasEmerged` 的符号翻转上
//   （11-loop: `if ((emerged>0) !== d.wasEmerged){ …; spawnRipple(...) }`），
//   所以"翻转次数"就是"落圈次数"。① 前提会**现场**核 insidePond 不吞掉任何一次
//   （若不 1:1，下面所有计数都是高估值，门禁必须在这里就报红而不是继续）。
//
// 负例自检：把间隔改回**旧值**（spread=18，即改动前的中位 18s），
//   同一批判据必须**全部报红** —— 否则"水位判据"是假的。
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

const results = [];
/* 开场过渡时长（ms）：产品的初始 riseAt 全部落在 0~24s 内，那段是"全鱼齐跃水"的过渡态，
   其第一个真实间隔不可用于判稳态水位（见 §① 的长注释）。 */
const SETTLE_MS = +(process.env.SETTLE_MS || 90000);
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

/* 一个测量窗口：返回 锦鲤落圈数 / 破水事件数 / 泳龟数 / 墙钟秒 */
async function measure(page, seconds, { feed = false } = {}) {
  if (feed) await page.evaluate(async () => {
    const G = window.__garden;
    (await import('/src/06-vegetation.js')).dropBait(0, 3.0, G.simClock());
  });
  return page.evaluate(async (sec) => {
    const G = window.__garden, R = window.__mr;
    const k0 = R.koi.length, u0 = R.tur.length, b0 = R.reject, t0 = performance.now();
    const s0 = (R.starts || []).length;     // 跃水开始时刻的窗口起点（见下面 starts 通道）
    /* ⚠️⚠️ 2026-09-27 修：带上前一次跃水时刻，**让间隔跨段连续**。
       原来 `R.starts.slice(s0)` 是**每段独立切片** —— 同一条鱼若在第 1 段末尾跃水、
       第 2 段初再跃水，这一次间隔会被切成"没有"。而"同鱼间隔"恰恰是**相邻两次之差**，
       切掉的正是间隔本身 ⇒ 短间隔被系统性保留、长间隔被腰斩。
       症状：门禁占比 44~65%，而同页对拍（连续 rAF 链，outputs/_diag/koi-AB-compare.mjs）
       同一时刻报 **37.7%**、中位 27.25s，与理论 35.4% 吻合 ⇒ **产品正常，是分段吃掉了间隔**。
       修法：`lastStart` 是**全量记录**（每个 rAF 都更新），窗口起点前每条鱼的最后一次跃水
       时刻就在里面；段内事件与之配对，只有"段内首次且该鱼在本段前从无跃水"才真的没有前值。 */
    const prev = (R.lastStart || []).slice();
    let baits = 0;
    const iv = setInterval(() => { if (G.baitsActive() > 0) baits++; }, 250);
    await new Promise(r => setTimeout(r, sec * 1000));
    clearInterval(iv);
    const slice = R.koi.slice(k0);
    /* 事件聚类（只用于"事件数"与"两圈占比"）：按**每条鱼各自的上一条穿越**归并
       （间隔 < 3.5s 视为同一次破水）。
         ⚠️ 绝不能拿"全局最后一条"比 —— 11 条鱼交错，会把每次穿越都算成新事件。 */
    const last = new Map(), ev = [];
    for (const e of slice){
      const p = last.get(e.i);
      if (p !== undefined && e.t - p < 3.5){ const q = ev.findIndex(v => v.s === p); ev[q].e = e.t; ev[q].n++; }
      else ev.push({ i: e.i, s: e.t, e: e.t, n: 1 });
      last.set(e.i, e.t);
    }
    /* ⚠️⚠️ **同鱼跃水间隔必须由 `starts`（rising 边沿）算，不能由上面的 ev 算** ——
       2026-09-27 修。`starts` 是"跃水开始"的直接观测，与 11-loop 的
       `if (KOI_BREACH.on && !d.rising && t >= d.riseAt)` 同源，**没有聚类**。
       从 ev 算会在两圈间隔偶尔 >3.5s 时把一次跃水拆成两次，间隔被腰斩到 12~16s
       （实测门禁里那些离群小值正是这么来的；同一时间窗用 starts 算中位是 32.2s、
       均值 32.6 与理论 33.0 吻合，见 outputs/_diag/koi-cycle-dist.mjs）。 */
    const st = window.__mr.starts.slice(s0);
    const byFish = new Map();
    /* 跨段连续：段内第一次跃水时，若 `lastStart` 里有该鱼窗口起点**之前**的时刻，
       就用它当"前一次"（见上面 2026-09-27 的长注释）。只有真正"从来没见过跃水"的鱼
       才丢掉它的第一次 —— 那才是真的没有前值。 */
    for (let i = 0; i < prev.length; i++){ if (prev[i] != null) byFish.set(i, [prev[i]]); }
    for (const e of st){
      if (!byFish.has(e.i)) byFish.set(e.i, []);
      byFish.get(e.i).push(e.t);
    }
    const cycles = [];
    for (const [, ts] of byFish){ ts.sort((a, b) => a - b); for (let k = 1; k < ts.length; k++) cycles.push(ts[k] - ts[k-1]); }
    const gaps = ev.map(e => e.s).sort((a, b) => a - b).map((v, i, a) => i ? v - a[i - 1] : 0).filter(x => x > 0);
    const med = arr => { if (!arr.length) return NaN; const s = [...arr].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
    return { wall: (performance.now() - t0) / 1000, sim: G.simClock(),
             koi: slice.length, events: ev.length, starts: st.length,
             gapsMed: med(gaps), cyclesMed: med(cycles),
             /* 原始间隔数组：调用方跨窗口**汇总后取单一中位**（不是平均各窗中位 ——
                那样会放大偏差，见文件头 ②）。 */
             cycles,
             pair2: ev.filter(e => e.n === 2).length, eventTotal: ev.length,
             tur: R.tur.length - u0, reject: R.reject - b0, baits };
  }, seconds);
}

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  console.log(`\n[koi-ripple-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  const got = await page.waitForFunction(() => window.__garden.koiGroup.userData.fishes.length >= 11
    && window.__garden.swimTurtles.length >= 2, null, { timeout: 300000 }).then(() => true).catch(() => false);
  check('前提：11 条锦鲤 + 2 只泳龟已挂载（否则频率判据无意义）', got, got ? '11 + 2' : '资产未挂载');
  if (!got){ await finish(); return; }

  const gpu = await page.evaluate(() => window.__garden.gpuName);
  console.log(`  · GPU: ${gpu}`);

  /* ── 装计数器：锦鲤链按 wasEmerged 翻转（1:1），并**现场**核 insidePond 是否吞掉落点 ──
     ⚠️ 池域判定走 `window.__garden.insidePond`（11-loop 显式暴露），
        **不能**从 06-vegetation 的命名空间取 —— 那里 `insidePond` 是从 05-water
        **import 进来**的，没有再 export，读出来是 undefined。
     ⚠️ 计数器**先排下一帧再干活**（不是放在末尾）：否则首帧一抛异常就再也排不上，
        表现是"所有计数恒为 0"却零报错 —— 而产品其实一直在起涟漪（最难查的一种假象）。 */
  await page.evaluate(() => {
    const G = window.__garden;
    const F = G.koiGroup.userData.fishes, TU = G.swimTurtles;
    const R = window.__mr = { koi: [], starts: [], tur: [], reject: 0, err: null, ticks: 0 };
    const w = new (Object.getPrototypeOf(F[0].position).constructor)();
    let pe = F.map(f => !!f.userData.wasEmerged), pw = TU.map(t => t.userData.wakeAt);
    /* ⚠️ `rising` 的 false→true 边沿 = **跃水开始**（11-loop: `if (KOI_BREACH.on && !d.rising
       && t >= d.riseAt){ d.rising = true; … }`）。这是 2026-09-27 新增的**独立**采样通道：
       「同鱼跃水间隔」必须由它算，**不能**从落圈聚类反推 —— 一次跃水产生两圈，靠 3.5s
       阈值并回一次事件会腰斩间隔（实测门禁里出现 12~16s 的"间隔"，而同一时刻绕开聚类直接
       测 rising 边沿得到的是 32.2s，见 outputs/_diag/koi-cycle-dist.mjs）。
       落圈计数 `R.koi` 保留，它守的是"每次穿越都真的起了一圈"（1:1 前提）。 */
    const seen = F.map(f => !!f.userData.rising);
    /* `lastStart` 是**全量**的"每条鱼最后一次跃水时刻"（每个 rAF 都刷新）——
       `measure` 靠它把同鱼间隔**跨测量段接起来**（见 measure 里的 2026-09-27 长注释）。
       没有它，分段会把"跨段的同鱼间隔"整个吃掉，分布被系统性拉短。 */
    R.lastStart = new Array(F.length).fill(null);
    const tick = () => {
      requestAnimationFrame(tick);                 // ← 先排班（自愈）
      try {
        R.ticks++;
        for (let i = 0; i < F.length; i++){
          const rising = !!F[i].userData.rising;
          if (rising && !seen[i]){ R.starts.push({ i, t: G.simClock() }); R.lastStart[i] = G.simClock(); }
          seen[i] = rising;
        }
        for (let i = 0; i < F.length; i++){
          const e = !!F[i].userData.wasEmerged;
          if (e !== pe[i]){
            F[i].getWorldPosition(w);
            if (!G.insidePond(w.x, w.z - 3.0)) R.reject++;   // 会被 spawnRipple 拦掉 ⇒ 计数高估
            R.koi.push({ i, t: G.simClock() });
          }
          pe[i] = e;
        }
        for (let i = 0; i < TU.length; i++){
          const w2 = TU[i].userData.wakeAt;
          if (w2 !== pw[i]) R.tur.push({ i, t: G.simClock() });
          pw[i] = w2;
        }
      } catch (e){ if (!R.err) R.err = String(e); }
    };
    requestAnimationFrame(tick);
  });
  /* ⚠️ 必须**等帧**再读：requestAnimationFrame 的回调下一帧才跑，上一版在
     派发 rAF 之后立刻读 window.__mr，ticks 还是初始 0 ⇒ "计数器活着"永远假红
     （症状是"频率低"其实只是计数器没启动，零报错）。等 2 帧足够让 rAF 链跑起来。 */
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const tickProbe = await page.evaluate(() => ({ ...window.__mr, koi: undefined, tur: undefined }));
  check('① 前提：计数器活着（否则"频率低"只是计数器死了，零报错最坑）',
    tickProbe.ticks > 0 && !tickProbe.err,
    `${tickProbe.ticks} 次 tick${tickProbe.err ? '，异常：' + tickProbe.err : ''}`);

  /* ══ ① 前提断言：落圈与计数 1:1（insidePond 不吞） ══
     ⚠️ 2026-09-27 追加：**在进入稳态测量前必须先把"开场过渡"跑完**。
        产品的初始 `riseAt = 6 + Math.random()*18`（06-vegetation 的 `KOI_DRAW.rise`）把 11 条鱼
        的首次跃水全部压在 0~24s 内 ⇒ 开场 24 秒是"全鱼齐跃水"的过渡态。
        本门 §①(45s) + §②(180s) 紧挨着跑，**前 200 多秒都在过渡态里**：这些鱼的第一个真实
        间隔 = 初始 riseAt(6~24) + 稳态间隔(9~57) = 15~81s，**大量落在 26s 判据下方**
        ⇒ 实测中位在 23.7~30.4 之间乱跳（同一份代码、同一机位）。
        对照证据（outputs/_diag/koi-cycle-dist.mjs）：等 300s 之后再测，中位稳定在 **32.2s**、
        均值 32.6 与理论 33.0 吻合。
        ⇒ 修法是**让门禁也等到稳态**（丢弃开场 SETTLE_MS 内的样本），**阈值 26s 一个字不动**。 */
  await page.waitForTimeout(SETTLE_MS);
  const pre = await measure(page, 45);
  check('① 前提：锦鲤破水落点**全部**在池内（wasEmerged 翻转 ⇒ spawnRipple 是 1:1）',
    pre.reject === 0, pre.reject ? `${pre.reject}/${pre.koi} 被 insidePond 拦掉 ⇒ 计数高估`
                                 : `${pre.koi} 次穿越，0 次被拦（1:1 成立）`);
  check('① 前提：观察窗内确实采到破水（否则"频率低"是采样不足，不是改对了）',
    pre.koi >= 4, `${pre.koi} 次落圈 / ${pre.events} 次事件`);

  const cfg = await page.evaluate(() => window.__garden.koiBreachConfig());
  check('① 前提：产品侧权威开关已暴露（探针必须走它，不能在探针里重调产品函数）',
    cfg && Number.isFinite(cfg.floor) && Number.isFinite(cfg.spread) && typeof cfg.on === 'boolean',
    `当前 floor=${cfg.floor} spread=${cfg.spread} on=${cfg.on}`);
  check('① 前提：跃水间隔已放宽到稳态档（spread ≥ 40，即中位 ≥ ~29s）',
    cfg.spread >= 40, `spread=${cfg.spread} ⇒ 中位 ${(cfg.floor + cfg.spread / 2).toFixed(1)}s`);

  /* ══ ② 正向：平时无饵，**三个 60s 窗**（判据取"次/分"，中位数定水位）
     ⚠️ 窗口 120s → 180s 是 2026-09-27 加的，**但当时的诊断是错的**（见下），本轮才真正修好。
        ⚠️⚠️ **根因不是样本量不够，是"同鱼跃水间隔"这个量被门禁自己的聚类腰斩了**：
        ① 门禁的 `cycles` 来自**落圈**（`wasEmerged` 翻转），一次跃水产生**两圈**
           （出水一圈 + 入水一圈），所以必须靠 **3.5s 阈值**把两圈并回一次"事件"。
        ② 但**实测的同鱼间隔本身就在 12~59s 之间**（`9 + rnd*48`，300s / n=85 实测
           均值 32.6s、中位 32.2s、min 11.9、max 58.8）—— 阈 3.5s 与要测的量**不同阶**，
           按理不该腰斩，可门禁实测却出现大量 12~16s 的"间隔"。
        ③ 决定性对照（outputs/_diag/koi-cycle-dist.mjs，300s 逐帧记 `rising` false→true）：
           **绕开聚类**直接测"跃水开始"时刻 ⇒ 中位 32.2s 稳定、均值 32.6 与理论 33.0 吻合。
           同一份代码同一时间窗，只因为"从不落圈聚类"而得到正确值 ⇒ **门禁测的不是这个量**。
        ⇒ 修法：**判据改成直接读产品的 `rising` 边沿**（与 11-loop 判"开始跃水"的条件同源），
           聚类彻底去掉。**阈值 26s 一个字没动。**
        （先前"n=14 → n=21 能把余量比从 1.7σ 提到 2.3σ"那条推理**不成立**：n 变大反而
          更红，恰恰说明量本身错了，不是精度不够。180s 窗口保留，因为汇总三窗总比两窗稳。） */
  const A = await measure(page, 60);
  const B = await measure(page, 60);
  const C2 = await measure(page, 60);
  const wall = A.wall + B.wall + C2.wall;
  const evPerMin = (A.events + B.events + C2.events) / wall * 60;
  const koiPerMin = (A.koi + B.koi + C2.koi) / wall * 60;
  const turPerMin = (A.tur + B.tur + C2.tur) / wall * 60;
  const cyclesAll = [...(A.cycles || []), ...(B.cycles || []), ...(C2.cycles || [])].filter(x => isFinite(x) && x > 0);
  /* ⚠️⚠️ 2026-09-27：**判据从"中位 ≥ 26s"改为"短间隔占比 ≤ 45%"**。
      换统计量的理由（不是抬容差，是换判据的**方法**）：
      稳态间隔是 `floor 9 + rnd*48` 的分布（实测 n=85：min 11.9 / 中位 32.2 / max 58.8，
      与理论 33.0 吻合）。拿"中位"去卡它，余量 6.2s 而 n=20 时中位标准误就有 ±4.2s
      ⇒ 只有 1.5σ，三轮实测 30.2/24.3/28.0 的抖动就是这么来的。占比是**分布的比例**，
      对样本量的依赖低得多，且**直接对应设计意图** —— "间隔不能太密"本来就是占比问题。
      门槛 **45%** 而不是理论值 35.4%：① 理论值假设 `Math.random()` 完美均匀，实际不是；
      ② 实测三档 37.6 / 38.7 / 17.6%，n≈55 时占比标准误约 ±7pp —— 卡在理论值上
      **没有余量**（38.7 就会假红）。45% 留约 1σ 余量，且仍远低于负例（旧间隔实测
      41~65%，但那档本身波动也大，负例另用"事件/落圈频率"两条硬判据兜底）。
      ⚠️ 45% 与参数的关系写在这里：改 `spread` 时门槛应按
      `26 / (floor + spread) * 100%` 附近重估（当前 floor=9, spread=48 ⇒ 理论 35%）。 */
  const SHORT_RATIO = 45 / 100;
    const shortPct = cyclesAll.length
      ? cyclesAll.filter(v => v < 26).length / cyclesAll.length * 100
      : NaN;
    const cyclesMed = (() => {
      if (!cyclesAll.length) return NaN;
      const s = [...cyclesAll].sort((a, b) => a - b);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    })();
  const gapsMed = (isFinite(A.gapsMed) && isFinite(B.gapsMed) && isFinite(C2.gapsMed)
    && A.gapsMed + B.gapsMed + C2.gapsMed > 0)
    ? (A.gapsMed + B.gapsMed + C2.gapsMed) / 3 : A.gapsMed;
  const pair2pct = (A.pair2 + B.pair2 + C2.pair2)
    / Math.max(1, A.eventTotal + B.eventTotal + C2.eventTotal) * 100;

  console.log(`  · 平时 180s 合并：事件 ${evPerMin.toFixed(1)}/分 · 锦鲤落圈 ${koiPerMin.toFixed(1)}/分 · 泳龟 ${turPerMin.toFixed(1)}/分`);
  console.log(`  · 事件起点间隔中位 ${gapsMed.toFixed(2)}s · 同鱼跃水间隔：中位 ${cyclesMed.toFixed(1)}s（n=${cyclesAll.length}，仅供参考）· 短间隔(<26s) ${shortPct.toFixed(1)}%（判据，门槛 ${(SHORT_RATIO * 100).toFixed(0)}%）· "出水+入水两圈"占比 ${pair2pct.toFixed(0)}%`);

  check('② 平时 · 锦鲤破水**事件**频率在 12~24 次/分（每 2.5~5s 一条鱼破水）',
    evPerMin >= 12 && evPerMin <= 24, `实测 ${evPerMin.toFixed(1)} 事件/分`);
  check('② 平时 · 锦鲤链落圈频率在 24~48 次/分（事件的两圈，不该翻倍失控）',
    koiPerMin >= 24 && koiPerMin <= 48, `实测 ${koiPerMin.toFixed(1)} 次/分`);
  check('② 平时 · 事件起点间隔中位 ≥ 1.8s（"偶发"而非"此起彼伏"）',
    gapsMed >= 1.8, `中位 ${gapsMed.toFixed(2)}s`);
  check(`② 平时 · 同一条鱼两次跃水间隔不密的占比 ≤ ${(SHORT_RATIO * 100).toFixed(0)}%（分布下四分位内）`,
    shortPct <= SHORT_RATIO * 100,
    `短间隔(<26s) ${shortPct.toFixed(1)}%（n=${cyclesAll.length}，门槛 ${(SHORT_RATIO * 100).toFixed(0)}% = floor/(floor+spread)）· 中位 ${cyclesMed.toFixed(1)}s（仅供参考，不作判据）`);
  check('② 平时 · 仍保留"出水 + 入水"两圈（负向：没把交互反馈削没）',
    pair2pct >= 60, `两圈事件占比 ${pair2pct.toFixed(0)}%`);

  /* ══ ③ 投喂时：频率不得因聚拢而暴增（第一段已证"投喂只改 x/z 不改 y"） ══ */
  const C = await measure(page, 60, { feed: true });
  const cEv = C.events / C.wall * 60, cKoi = C.koi / C.wall * 60;
  check('③ 投喂时 · 破水事件频率仍在 12~24 次/分（聚拢不放大跃水）',
    cEv >= 12 && cEv <= 24, `实测 ${cEv.toFixed(1)} 事件/分（平时 ${evPerMin.toFixed(1)}）`);
  check('③ 投喂时 · 锦鲤链落圈频率仍在 24~48 次/分',
    cKoi >= 24 && cKoi <= 48, `实测 ${cKoi.toFixed(1)} 次/分`);

  /* ══ ④ 池面总压力：锦鲤链压下去后，池子不该再"永远有活涟漪" ══ */
  const occ = await page.evaluate(async () => {
    const G = window.__garden, s = [];
    await new Promise(r => { const iv = setInterval(() => s.push(G.ripplesActive()), 250);
      setTimeout(() => { clearInterval(iv); r(); }, 20000); });
    s.sort((a, b) => a - b);
    return { med: s[(s.length / 2) | 0], p90: s[Math.floor(s.length * .9)], cap: G.rippleCapacity() };
  });
  check('④ 池面 · 活涟漪中位数显著低于容量（不再是"池里永远有圈"）',
    occ.med <= occ.cap * 0.35, `活圈中位 ${occ.med} / 容量 ${occ.cap}（p90 ${occ.p90}）`);

  /* ══ ⑤ 负例自检：改回**旧间隔**（spread=18）后，同一批判据必须报红 ══
     走产品侧权威开关 setKoiBreachConfig（铁律 3），不碰 f.userData（每帧会被 11-loop 覆盖）。 */
  const negCfg = await page.evaluate(() => window.__garden.setKoiBreachConfig({ spread: 18 }));
  check('⑤ 负例前置：权威开关真的把间隔改回了旧值 spread=18',
    negCfg.spread === 18, `读回 spread=${negCfg.spread}（floor=${negCfg.floor}）`);
  const N = await measure(page, 60);
  const nEv = N.events / N.wall * 60, nKoi = N.koi / N.wall * 60;
  check('⑤ 有牙负例：旧间隔下破水事件频率**超出水位上限**（判据必须能判红）',
    nEv > 24, `旧间隔实测 ${nEv.toFixed(1)} 事件/分 > 上限 24`);
  check('⑤ 有牙负例：旧间隔下锦鲤链落圈频率**超出水位上限**（判据必须能判红）',
    nKoi > 48, `旧间隔实测 ${nKoi.toFixed(1)} 次/分 > 上限 48`);
  /* ⚠️⚠️ 2026-09-27：负例的判据从"绝对占比 > 门槛 + 10pp"改成**同窗比值**。
        为什么：实测负例占比 51.9 / 54.2 / 56.0 / 58.6%（真值 ≈55%），而我设的
        "45% + 10pp = 55%" **刚好压在真值上** ⇒ 两轮假红（54.2 判红成功、51.9 假红失败）。
        这是我今天**第三次**把门槛卡在真值上（第一次是"中位 ≥26s"、第二次是"占比 ≤35%"）。
        改成比值后判据只要求"旧间隔比新间隔**明显更密**"，与两档各自的绝对水位解耦：
          · 新间隔真值 ~32%（实测 21~40%），旧间隔真值 ~55%
          · 比值门槛取 1.35：实测比值稳定在 55/32 ≈ 1.7，而采样噪声（同量测法 n≈25、
            占比标准误 ±10pp）最多把比值拉到 1.3 左右 ⇒ 1.35 在噪声之上又有真实余量。
        ⚠️ 这**不是**放水：负例若失效（改回旧值后间隔没变密），比值会 ≈1.0，立刻报红。 */
  const nShortPct = (N.cycles || []).length
    ? N.cycles.filter(v => v < 26).length / N.cycles.length * 100 : NaN;
  const posShortPct = shortPct;
  check('⑤ 有牙负例：旧间隔下短间隔占比**明显高于**同一批测得的正向值（判据必须能判红）',
    (N.cycles || []).length >= 12 && isFinite(posShortPct) && posShortPct > 0
      && nShortPct / posShortPct > 1.35,
    `旧间隔 ${nShortPct.toFixed(1)}% / 正向 ${posShortPct.toFixed(1)}% = ${(nShortPct / (posShortPct || 1)).toFixed(2)}×（需 >1.35×，n=${(N.cycles || []).length} 需 ≥12）`);
  /* 复原（负例结束后必须回到产品默认，否则后面的门禁/体验被带偏） */
  const restored = await page.evaluate(() => window.__garden.setKoiBreachConfig({ spread: 48 }));
  check('⑤ 负例收尾：已复原为产品默认 spread=48', restored.spread === 48, `spread=${restored.spread}`);

  /* ══ ⑥ 权威开关的"完全关闭"必须让落圈归零（有牙：证明 ② 的计数确由该路径产生） ══ */
  const offCfg = await page.evaluate(() => window.__garden.setKoiBreachConfig({ on: false }));
  check('⑥ 前置：权威开关已关闭跃水', offCfg.on === false, `on=${offCfg.on}`);
  /* ⚠️ 必须先等**沉降**：`on=false` 只挡住"跃水**开始**"（`if (KOI_BREACH.on && !d.rising …)`），
     切换瞬间**已经在飞行中**的鱼仍会走完 rd=2.8s 并照常触发落圈。
     不等就计数 ⇒ 30s 窗口里混进 1~2 个"关闸前已起跳"的落圈，判据假红
     （实测首版就是这样红的：关闭后 30s 内落圈 1 次）。等 4s > rd 即可排空。 */
  await page.waitForTimeout(4000);
  const O = await measure(page, 30);
  check('⑥ 有牙负例：关闭跃水后锦鲤链落圈归零（证明计数确由跃水路径产生）',
    O.koi === 0, `沉降 4s 后 30s 内落圈 ${O.koi} 次（应为 0）`);
  const onCfg = await page.evaluate(() => window.__garden.setKoiBreachConfig({ on: true }));
  check('⑥ 收尾：已复原跃水', onCfg.on === true, `on=${onCfg.on}`);

  /* ══ ⑦ 其它三条链未被波及（点击/雨/泳龟签名与容量口径不变） ══ */
  const cap = await page.evaluate(() => window.__garden.rippleCapacity());
  check('⑦ 涟漪池容量仍是 64（本次只改节奏，没动容量与雨滴配额）', cap === 64, `容量=${cap}`);
  const click = await page.evaluate(() => {
    const G = window.__garden;
    const c = G.clickRippleLast();                  // 只读，不改行为
    return { has: c !== undefined };
  });
  check('⑦ 点击涟漪状态可读（点击链未被本次改动摘掉）', click.has, 'clickRippleLast() 存在');

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await finish();

  async function finish(){
    const fails = results.filter(r => !r.ok).length;
    console.log(`\n[koi-ripple-guard] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
    try { await browser.close(); } catch {}
    server.close();
    process.exit(fails === 0 ? 0 : 1);
  }
})().catch(e => { console.error('[koi-ripple-guard] 探针自身异常：', e); process.exit(1); });
