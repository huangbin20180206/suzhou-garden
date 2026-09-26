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
    let baits = 0;
    const iv = setInterval(() => { if (G.baitsActive() > 0) baits++; }, 250);
    await new Promise(r => setTimeout(r, sec * 1000));
    clearInterval(iv);
    const slice = R.koi.slice(k0);
    /* 事件聚类：按**每条鱼各自的上一条穿越**归并（间隔 < 3.5s 视为同一次破水）。
         ⚠️ 绝不能拿"全局最后一条"比 —— 11 条鱼交错，会把每次穿越都算成新事件。 */
    const last = new Map(), ev = [];
    for (const e of slice){
      const p = last.get(e.i);
      if (p !== undefined && e.t - p < 3.5){ const q = ev.findIndex(v => v.s === p); ev[q].e = e.t; ev[q].n++; }
      else ev.push({ i: e.i, s: e.t, e: e.t, n: 1 });
      last.set(e.i, e.t);
    }
    const cyc = new Map();
    for (const e of ev){ if (!cyc.has(e.i)) cyc.set(e.i, []); cyc.get(e.i).push(e.s); }
    const cycles = [];
    for (const [, ts] of cyc) for (let k = 1; k < ts.length; k++) cycles.push(ts[k] - ts[k - 1]);
    const gaps = ev.map(e => e.s).sort((a, b) => a - b).map((v, i, a) => i ? v - a[i - 1] : 0).filter(x => x > 0);
    const med = arr => { if (!arr.length) return NaN; const s = [...arr].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
    return { wall: (performance.now() - t0) / 1000, sim: G.simClock(),
             koi: slice.length, events: ev.length, gapsMed: med(gaps), cyclesMed: med(cycles),
             /* ⚠️ 必须把**原始间隔数组**一并带出去：调用方要跨窗口**汇总后取单一中位**。
                60s 窗里同鱼间隔只有 n≈7 个样本，均匀分布下 n=7 的中位标准误约 ±6.6s；
                先算两个窗的中位再平均，会把这个偏差**放大**而不是抵消（实测 21.9s，
                而 180s / n=51 的真实中位约 32s、理论 35.8s）。 */
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
    const R = window.__mr = { koi: [], tur: [], reject: 0, err: null, ticks: 0 };
    const w = new (Object.getPrototypeOf(F[0].position).constructor)();
    let pe = F.map(f => !!f.userData.wasEmerged), pw = TU.map(t => t.userData.wakeAt);
    const tick = () => {
      requestAnimationFrame(tick);                 // ← 先排班（自愈）
      try {
        R.ticks++;
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

  /* ══ ① 前提断言：落圈与计数 1:1（insidePond 不吞） ══ */
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

  /* ══ ② 正向：平时无饵，两个 60s 窗（判据取"次/分"，中位数定水位） ══ */
  const A = await measure(page, 60);
  const B = await measure(page, 60);
  const wall = A.wall + B.wall;
  const evPerMin = (A.events + B.events) / wall * 60;
  const koiPerMin = (A.koi + B.koi) / wall * 60;
  const turPerMin = (A.tur + B.tur) / wall * 60;
  const cyclesMed = (() => {
    /* 跨窗口**汇总原始间隔**再取单一中位 —— 不是平均两个窗的中位。
       ⚠️ 别写回 `(A.cyclesMed + B.cyclesMed) / 2`：每个 60s 窗里同鱼间隔只有 n≈7 个
       样本，均匀分布下 n=7 的中位标准误约 ±6.6s，平均两个这样的中位只会**放大**偏差。
       实测：平均两窗 = 21.9s（假红），汇总 n=51 取单中位 ≈ 32s（理论 35.8s）。 */
    const all = [...(A.cycles || []), ...(B.cycles || [])].filter(x => isFinite(x) && x > 0);
    if (!all.length) return NaN;
    const s = all.sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  })();
  const gapsMed = (isFinite(A.gapsMed) && isFinite(B.gapsMed) && A.gapsMed + B.gapsMed > 0)
    ? (A.gapsMed + B.gapsMed) / 2 : A.gapsMed;
  const pair2pct = (A.pair2 + B.pair2) / Math.max(1, A.eventTotal + B.eventTotal) * 100;

  console.log(`  · 平时 120s 合并：事件 ${evPerMin.toFixed(1)}/分 · 锦鲤落圈 ${koiPerMin.toFixed(1)}/分 · 泳龟 ${turPerMin.toFixed(1)}/分`);
  console.log(`  · 事件起点间隔中位 ${gapsMed.toFixed(2)}s · 同鱼跃水间隔中位 ${cyclesMed.toFixed(1)}s · "出水+入水两圈"占比 ${pair2pct.toFixed(0)}%`);

  check('② 平时 · 锦鲤破水**事件**频率在 12~24 次/分（每 2.5~5s 一条鱼破水）',
    evPerMin >= 12 && evPerMin <= 24, `实测 ${evPerMin.toFixed(1)} 事件/分`);
  check('② 平时 · 锦鲤链落圈频率在 24~48 次/分（事件的两圈，不该翻倍失控）',
    koiPerMin >= 24 && koiPerMin <= 48, `实测 ${koiPerMin.toFixed(1)} 次/分`);
  check('② 平时 · 事件起点间隔中位 ≥ 1.8s（"偶发"而非"此起彼伏"）',
    gapsMed >= 1.8, `中位 ${gapsMed.toFixed(2)}s`);
  check('② 平时 · 同一条鱼两次跃水间隔中位 ≥ 26s（跃水应是稀有事件）',
    cyclesMed >= 26, `中位 ${cyclesMed.toFixed(1)}s（汇总 n=${(A.cycles || []).length + (B.cycles || []).length}）`);
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
  /* ⚠️ 这条用中位数，所以**必须同时要求最小样本量** —— 否则 n=2 时"中位 20.2s"也能判红，
     判据就成了"只要有数据就红"，失去有牙意义（旧间隔理论中位 20.8s，n≈21 时标准误仅 ±1.4s）。 */
  check('⑤ 有牙负例：旧间隔下同鱼跃水间隔中位**低于**下限，且样本量够（判据必须能判红）',
    (N.cycles || []).length >= 12 && N.cyclesMed < 26,
    `旧间隔中位 ${N.cyclesMed.toFixed(1)}s < 26s（n=${(N.cycles || []).length}，需 ≥12）`);
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
