/* ══════════════════════════════════════════════════════════════════════════
   开篇资产预载（2026-09-27 · 高精资产批次的前置设施）
   ══════════════════════════════════════════════════════════════════════════
   为什么要有这个模块：用户定调"把比较消耗网络和资源的**提前**下载好"，按 **10 MB** 规划。
   而 1.9 MB 临界点（第一段实测推出：暖编译窗口 9.1s ÷ 187.5 KB/s）在 10 MB 面前
   差 5 倍 —— 所以"提前下载"不是锦上添花，是**必需**：不预载就必然出现
   "开园瞬间荷花/锦鲤/芭蕉集体闪现"。

   ── 本模块的边界（刻意做得很窄）────────────────────────────────────────
   · **不发 HEAD、不发任何网络请求**。它只做三件事：登记清单、聚合进度、判定降级。
     真正的下载由 06-vegetation 里**已经存在**的 GLTFLoader 调用发起
     （那是本项目唯一的资产入口，不新建第二条并行下载路径 = 不会重复下载、
      不会让 SW 缓存出现两份、也不会引入"预载成功但 GLTFLoader 仍失败"的双份失败语义）。
   · **不碰 DOM**。渲染由 11-loop 负责（`#loading` 的所有权一直在 11-loop 那边）。
     理由：让本模块能被探针在纯 Node 下测，也让 DOM 归属保持单点。

   ── 单一真值：bytes 是开发期写入的常量 ─────────────────────────────────
   运行时不发 HEAD 去问大小（慢网上那多一个 RTT 会直接变成几百毫秒的等待，
   而且 Content-Length 缺失时还会让进度条跳变）。清单里的 bytes 由
   `outputs/_diag/gen-manifest-bytes.mjs` 从磁盘实测写入，改资产后重跑该脚本即可。
   ⚠️ 改 GLB 之后**必须**重跑，否则清单的总量与真实下载量不符（进度条会卡在 90% 之类的怪数）。

   ── required 的含义（决定失败后要不要替身）────────────────────────────
   `required: true`  = 失败后场景照常跑，只是少一点细节（**不接受**"缺失即穿帮"）。
   `required: false` = 失败后**必须**有程序化替身兜住画面，否则就是"缺失即穿帮"。
   唯一 `false` 的是芭蕉：假茎与蕉果是程序化的，GLB 只提供叶片 ——
   叶片不来就留下一根 **3.6 m 高的光杆芭蕉**，比没有芭蕉更难看（第一段实测挖出的雷）。 */

import { HOOKS } from './00-config.js';

/* ══ CDN 双轨（2026-10-02）：可选基址 + 失败自动回退本地 ═══════════════════
   用户拍板："从来没要求过离线使用……代价再大也要完成"CDN 分发，且既定做法是
   **双轨**：本地相对路径照旧（默认），CDN 只是**可选**的分流轨道，一个开关即可打开。
   ⚠️ 等价性红线：base 为空串（默认）时，assetUrl 必须原样返回相对路径，所有加载
      入口不得多建一个定时器、多发一个请求 —— 行为与没有这批代码**逐字节相同**。
      下面所有"回退/截止"机制都以 `ASSET_CDN.base` 非空为前提才被创建/触发。
   ⚠️ 随机流红线：本批改动只碰 URL 拼接与失败编排，不新增/移动任何 rnd()/rr()/
      Math.random() 调用（全局流的"次数与顺序"一位都不能变，否则全园布局漂且不报错）。
   ── base 的来源（优先级）─────────────────────────────────────────────────
     ① URL 参数 `?cdn=<encodeURIComponent(基址)>` —— 读取用 URLSearchParams，
        它等价 decodeURIComponent（生成这种链接的一侧务必 encodeURIComponent）；
     ② localStorage `suzhou-cdn-base`；
     ③ 都没有 ⇒ 空串 = 纯本地。
   读取必须在**模块早期**同步完成：本模块是模块期求值，而 GLB 请求在 06/08 的
   模块体里就发出了 —— base 必须先于任何 assetUrl() 被调用而定下来。
   边界说明：本模块仍然**不发任何网络请求**（见头部边界注释）—— withCdnFallback
   只做"何时重试/何时判死"的编排，真正的请求仍由 06/11 的加载器发出，不新建第二条
   下载路径；CDN 关时连那个截止定时器都不会被创建。 */

/* ASSET_CDN.base 是唯一事实（空串 = 纯本地，与旧实现逐字节等价）；
   CDN_STATE 是给将来门禁/诊断读的可读投影：on=CDN 轨道是否开启、hit=CDN 直取
   命中数、fallback=转本地重试数、fail=CDN+本地都失败数。不参与任何判定逻辑。 */
export const ASSET_CDN = { base: '' };
export const CDN_STATE = { on: false, hit: 0, fallback: 0, fail: 0 };

(function resolveCdnBase(){
  let b = '';
  try {
    const q = new URLSearchParams(location.search).get('cdn');   // ① URL 参数（已解码）
    if (q !== null && q.trim() !== '') b = q.trim();
    else {
      const s = localStorage.getItem('suzhou-cdn-base');          // ② localStorage
      if (typeof s === 'string' && s.trim() !== '') b = s.trim();
    }
  } catch (e) { /* file:// / 隐私模式 / 纯 Node 探针读不到 ⇒ 走 ③：纯本地 */ }
  ASSET_CDN.base = b;
  CDN_STATE.on = b !== '';
})();

/** 请求 URL 拼接（全部 GLB/音频入口的唯一改道点）：
    base 空 ⇒ 原样返回 —— 与没有 CDN 这回事时的请求**逐字节相同**；
    非空 ⇒ 尾斜杠归一后拼在相对路径前（`./` 前缀剥掉）。预载清单键、settleAsset
    键、SW 缓存键全部仍是相对路径，一个都不改 —— 改的只有"实际请求发到哪"。 */
export function assetUrl(rel){
  const base = ASSET_CDN.base;
  if (!base) return rel;
  return base.replace(/\/+$/, '') + '/' + String(rel).replace(/^\.\//, '');
}

/* CDN 尝试在总预算里占的份额：CDN 拿 60%（180s 预算下 = 108s），余下 ≥40%（72s）
   留给本地重试；**总预算本身不动** —— 180s 的一刀切兜底仍是 preloadPhase 原有逻辑
   （在飞的按失败结算、替身上场），本批一行不碰。选"按份额切截止点"而不是"共用
   剩余预算"：份额给 CDN 尝试一个确定的死线，本地重试至少还有 40% 可用，两段都
   装在同一个 PRELOAD_TIMEOUT_MS 之内，可解释、也无需改 preloadPhase。 */
const CDN_DEADLINE_SHARE = 0.6;

/** CDN 失败自动回退本地的统一壳（调用方只在 ASSET_CDN.base 非空时才该走这里；
    空 base 直发一次 = 双保险，行为与旧路径相同）。
    attempt(requestUrl) → Promise：发起**一次**加载（成功 resolve / 失败 reject）。
    · CDN 请求失败（onError）⇒ 立刻用本地路径重试一次；
    · CDN 超过 60% 预算仍在飞 ⇒ 同样转本地（GLTFLoader/fetch 都无法 abort，CDN
      那条若"迟到成功"会被 done 闸挡掉 —— 只浪费带宽，绝不会双挂载）；
    · **本地也失败才算真失败**（此时才 reject），由调用方走既有
      settleAsset(false) + 程序化替身链 —— 失败判定链的语义一位不挪；
    · 两次都成功竞速时先到者胜、后到者丢弃（防"CDN 迟到成功 + 本地已成功"双挂载）。 */
export function withCdnFallback(url, attempt){
  if (!ASSET_CDN.base) return attempt(url);
  const deadlineMs = CFG_PRELOAD.timeoutMs * CDN_DEADLINE_SHARE;
  return new Promise((resolve, reject) => {
    let done = false, localStarted = false, timer = 0;
    /* ⚠️ 两条失败路径必须**分开接**（不能共用一个 lose）：CDN 的死线先到、本地重试
       已经在飞时，CDN 那条还可能再报一次错 —— 共用的话那次错会被误当成"本地也失败"
       而提前判死，吞掉仍在飞、本可能成功的本地重试。 */
    const win = (v, viaCdn) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (viaCdn) CDN_STATE.hit++;                   // CDN 直取命中
      resolve(v);
    };
    const cdnLose = () => {                          // CDN 尝试失败 ⇒ 只在还没回退过时触发回退
      if (done || localStarted) return;
      startLocal();
    };
    const localLose = (e) => {                       // 本地重试失败 ⇒ 真失败（CDN+本地都倒下）
      if (done) return;
      done = true; clearTimeout(timer); CDN_STATE.fail++; reject(e);
    };
    /* attempt 同步抛（如 fetch 对畸形 URL 直接 throw）也按"这次尝试失败"处理 ——
       否则会把"CDN 基址写错"变成整页崩溃，而它本该触发本地回退。 */
    const runAttempt = (reqUrl, onOk, onFail) => {
      try { attempt(reqUrl).then(onOk, onFail); } catch (e) { onFail(e); }
    };
    const startLocal = () => {
      if (done || localStarted) return;
      localStarted = true; clearTimeout(timer);      // 死线已尽其用（后续再触发是 no-op）
      CDN_STATE.fallback++;                          // 记一笔"回退本地"
      /* 回退时把该件已下字节清零：CDN 半途而废的进度不作数，进度条从本地重下起算。
         （thunder.mp3 不在预载清单里 ⇒ items.get 为 undefined，天然跳过。） */
      const it = items.get(url);
      if (it && it.settled === null){ it.loaded = 0; it.reportedTotal = 0; }
      runAttempt(url, v => win(v, false), localLose);   // 本地路径 = 原相对路径
    };
    timer = setTimeout(startLocal, deadlineMs);      // CDN 的 60% 死线（超时也视作"CDN 失败"）
    runAttempt(assetUrl(url), v => win(v, true), cdnLose);
  });
}

/* ── 采样合并：进度条不许被逐 chunk 刷 ───────────────────────────────────
   一个 10 MB 的流在快网下能每秒吐出上百个 chunk 事件。逐个写 DOM 会让
   probe/loading-guard 的"更新次数"上界形同虚设，而且 MutationObserver
   每次都要跑一遍。两个约束一起收口：
     ① COALESCE_MS 下限（250ms）—— 保证"两次更新间隔"这个不变量可被门禁直接断言；
     ② 整数百分比去重 —— 0.1% 的抖动不写 DOM。
   ⚠️ 采样合并是"防刷"，**不是**"限流"：真实下载 60s 仍然会更新 ~240 次，
     所以 loading-guard 的上界必须相应放宽（14 → 120，见该文件第 158 行的理由注释）。 */
const COALESCE_MS = 250;

/* ── 慢网判定：下载段 5s 滑窗内实测速率 < 200 KB/s ────────────────────────
   刻意**不用** `navigator.connection` / `effectiveType` / `downlink`：
   ① 全项目 0 命中，没有先例可抄，Chromium 之外的支持度也参差；
   ② 它报的是**链路协商档位**，不是这个文件真实到包的速度 —— 一个开着
      视频的 wifi 会被它判成"4g"，与用户实际体感完全脱钩。
   实测速率是唯一诚实的口径。 */
const SLOW_BPS = 200 * 1024;      // 200 KB/s
const SLOW_WINDOW_MS = 5000;

/* 预载段的总预算：超过就判定"这台机器/这条网等不动了"，走降级继续开园。
   ⚠️⚠️ 60s → **180s**（2026-09-27，用户拍板③）。原注释写"10 MB 在 1.5 Mbps 下需要
   ~55s，60s 刚好容得下"—— **这个"刚好"是拿均值算的，而 1.5 Mbps 是均值、不是下限**。
   实测谷值可能掉到 ~100 KB/s，**任何一点抖动就会超时**；而超时后 `settleAsset(false)`
   把仍在飞的判为**失败** ⇒ `required:false` 的资产有程序化替身没事，
   **`required:true` 的荷花/锦鲤/池龟没有替身 ⇒ 直接少东西**，而且是"看运气丢"的
   间歇性问题（用户可能十次里遇到一次）。
   180s 的口径：10 MB 在 ~0.45 Mbps（已经很差的移动网络）下仍能跑完；超时的意义从
   "网速不够"变成"**这条网络基本不可用**"，那时降级才是对的判断。 */
const PRELOAD_TIMEOUT_MS = 180000;

/* ══ 预载清单（单一真值）══════════════════════════════════════════════════
   bytes  = 磁盘实测（2026-09-27），由 gen-manifest-bytes.mjs 写入
   stage  = 进度文案里的那一个动词（"取"/"取"…），不是 WARM_STAGES 的值 ——
            **下载段绝不能出现 `%`**，否则会被 loading-guard 的
            /营 造 中 · (\S+) (\d+)%/ 误捕获成一个非法阶段名而报红。 */
export const PRELOAD_MANIFEST = [
  /* 2026-09-30 三轮：LotusPlant.glb 回归（老黄："之前有个版本有好多株树立的荷花，
     虽然有点假但是至少能看"——撤空版他判"荷花还是没有修好"）。与 sw.js 的 GLBS 同步。
     required: false —— GLB 拉不到时页面不该停在加载页，荷花丛缺位即缺位。 */
  { url: 'assets/koi.glb',         bytes: 208000, stage: '取', label: '锦鲤', required: true  },
  { url: 'assets/BananaPlant.glb', bytes: 267032, stage: '取', label: '芭蕉', required: false },
  { url: 'assets/LotusPlant.glb',  bytes: 267300, stage: '取', label: '荷花', required: false },
  { url: 'assets/Turtle.glb',      bytes: 407400, stage: '取', label: '池龟', required: true  },
];

/* 按 url 索引的运行态。settled = null(在飞) | true(成功) | false(失败) */
const items = new Map();
for (const it of PRELOAD_MANIFEST) {
  items.set(it.url, {
    ...it, loaded: 0, reportedTotal: 0, settled: null, err: null,
  });
}

export const PRELOAD_TOTAL_BYTES = PRELOAD_MANIFEST.reduce((a, b) => a + b.bytes, 0);

/* 慢网速率采样的时序序列（只留窗口内的点） */
const rateSamples = [];   // [{t, bytes}]
/* 失败订阅表：url → fn[]。替身（芭蕉叶片）靠它知道自己该上场了。 */
const failSubs = new Map();

/** 运行期可调（探针做负例自检用，走权威开关而不是"在页内再调一次"）。 */
const CFG_PRELOAD = { coalesceMs: COALESCE_MS, slowBps: SLOW_BPS, timeoutMs: PRELOAD_TIMEOUT_MS };
export function setPreloadConfig(v){
  if (!v || typeof v !== 'object') return { ...CFG_PRELOAD };
  if (Number.isFinite(v.coalesceMs) && v.coalesceMs >= 0) CFG_PRELOAD.coalesceMs = v.coalesceMs;
  if (Number.isFinite(v.slowBps)  && v.slowBps  >= 0) CFG_PRELOAD.slowBps  = v.slowBps;
  if (Number.isFinite(v.timeoutMs)&& v.timeoutMs>  0) CFG_PRELOAD.timeoutMs= v.timeoutMs;
  return { ...CFG_PRELOAD };
}
export const preloadConfig = () => ({ ...CFG_PRELOAD });

/* ── 进度上报（由 06-vegetation 的 GLTFLoader onProgress 槽调用）────────────
   ⚠️ **关于 SW cache-first 的 0→100 跳变**（这是预期行为，不是 bug）：
   首次访问时请求由网络供给，`ProgressEvent.loaded/total` 是**真进度**；
   但一旦 SW 装好，`.glb` 走 sw.js 的 cache-first（"大件版本内不变"）——
   SW 直接 `return hit`，**不产生任何数据流事件**，`loaded` 会停在 0，
   直到资源到位那一刻 settle 一次性跳满。装成 PWA 之后进度条在下载段就是
   "0 → 45%" 的一次跳变。**这是定义如此**：那时根本没有网络发生，
   没有进度可言；真要显示进度就得去显示 SW 预缓存的进度，那是另一件事
   （且 `install` 阶段 SW 无法向页面汇报）。 */
export function reportAssetProgress(url, loaded, total){
  const it = items.get(url);
  if (!it || it.settled !== null) return;
  const l = Number(loaded);
  if (!Number.isFinite(l) || l < 0) return;
  it.loaded = Math.min(it.bytes, l);
  const t = Number(total);
  if (Number.isFinite(t) && t > 0) it.reportedTotal = t;
  sampleRate();
}

/* ── 资源落地（成功/失败）──────────────────────────────────────────────────
   成功时把 loaded 补到 bytes：SW 命中或无 Content-Length 时 onProgress 不会给
   有意义的进度，但"它确实完整到位了"是已知事实 —— 让进度条能走到该走的数，
   而不是卡在 90%。失败时记 err，让 required:false 的项进入替身流程。 */
export function settleAsset(url, ok, err){
  const it = items.get(url);
  if (!it || it.settled !== null) return;
  it.settled = ok;
  it.err = err ? String(err) : null;
  if (ok) it.loaded = it.bytes;
  else it.loaded = 0;
  sampleRate();
  /* ── 失败广播：让"程序化替身"能挂在**唯一权威的失败信号**上 ────────────────
     为什么需要它：调用方（06 的 makeBananaPlant）拿不到 loadAssetOnce 的 Promise
     —— 它是 fire-and-forget，没有返回值。想在失败时补替身，只能另找路。
     早先的写法是在调用点猜"加载会不会失败"，那是**两套判断**，必然漂。
     这里改成由 settleAsset 在**判定失败的同一刻**广播，替身钩子只管订阅。
     顺带一个必须防的坑：**订阅要支持退订**（返回 off 函数）。
     替身是 8 株芭蕉各订阅一次，页面反复开合/热重载时若不退订会累积监听，
     而钩子体里是"补一棵 3.6m 的树"这种非幂等操作 ⇒ 重复触发就是多副叶子。 */
  if (!ok){
    for (const fn of (failSubs.get(url) || []).slice()){
      try { fn(err); } catch (e){ /* 替身失败不阻断开园：整页白屏才是最坏结果 */ }
    }
  }
}

/* 订阅"某个 URL 的资产失败了"。返回退订函数（务必在不再需要时调用）。 */
export function onAssetFailed(url, fn){
  if (typeof fn !== 'function') return () => {};
  let arr = failSubs.get(url);
  if (!arr){ arr = []; failSubs.set(url, arr); }
  arr.push(fn);
  /* 补订阅时的竞态：若失败**已经发生**（settled === false），立即补调一次 ——
     替身挂载时 GLB 可能早已失败，不补这一刀就静默失效（正是要治的那个病）。 */
  const it = items.get(url);
  if (it && it.settled === false){
    failSubs.delete(url);
    try { fn(it.err); } catch (e){}
    return () => {};
  }
  return () => { const a = failSubs.get(url); if (!a) return; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
}

/* 「先用基础版进入」：把**还在飞**的资产立刻结算成失败，让替身上场、
   并让等待中的 preloadPhase 提前 resolve。
   ⚠️ 为什么不直接改 items：settleAsset 是唯一的权威入口 —— 它同时负责
      广播失败（替身钩子只订阅它）并把 loaded 归零。绕过它去改 items 会出现
      "进度条继续往下走、但替身永远不上场"这种半生不熟的状态。
   ⚠️ 已经 settled 的（成功或早已失败）一律不碰：覆盖 settled 会让已经挂上的
      GLB 被判成失败、替身又补一副叶子，出现"两副叶子"。 */
export function enterBasic(){
  let forced = 0;
  for (const it of items.values()){
    if (it.settled !== null) continue;
    settleAsset(it.url, false, 'user-basic-enter');
    forced++;
  }
  return forced;
}

function sampleRate(){
  const now = performance.now();
  const total = aggregate().loaded;
  const last = rateSamples[rateSamples.length - 1];
  if (last && now - last.t < 250) return;      // 速率采样也吃同一个合并节流
  rateSamples.push({ t: now, bytes: total });
  while (rateSamples.length > 2 && now - rateSamples[0].t > SLOW_WINDOW_MS) rateSamples.shift();
}

/* ── 聚合 ──────────────────────────────────────────────────────────────── */
export function aggregate(){
  let loaded = 0, done = 0, failed = 0, inFlight = 0;
  for (const it of items.values()){
    loaded += it.loaded;
    if (it.settled === true) done++;
    else if (it.settled === false) failed++;
    else inFlight++;
  }
  const total = PRELOAD_TOTAL_BYTES;
  return {
    loaded, total, done, failed, inFlight,
    settled: done + failed,
    count: items.size,
    pct: total > 0 ? Math.min(1, loaded / total) : 1,
  };
}

/* 需要程序化替身、且确实没到位的那批（只含 required:false） */
export function needsSubstitute(){
  return [...items.values()].filter(it => it.required === false && it.settled !== true);
}
export function isDegraded(url){ const it = items.get(url); return !!it && it.settled === false; }
export function degradedList(){
  return [...items.values()].filter(it => it.settled === false)
    .map(it => ({ url: it.url, label: it.label, required: it.required, substituted: !!it.substituted }));
}

/* ── 慢网提示 ──────────────────────────────────────────────────────────────
   只在**仍在下载**时判定：全部到位之后再提示"网慢"是噪声。
   PWA 场景（SW 预缓存）下这行**永不出现** —— 因为根本没有网络发生，
   而"网络差"在本项目里的定义就是"这次要花时间从网上取东西"。
   这条链接是给网络条件差、自己愿意离线下载的人准备的逃生口。 */
export const OFFLINE_URL = 'https://github.com/huangbin20180206/suzhou-garden';

export function slowNotice(){
  const a = aggregate();
  if (a.inFlight === 0 || a.loaded <= 0) return null;
  if (rateSamples.length < 2) return null;
  const first = rateSamples[0], last = rateSamples[rateSamples.length - 1];
  const dt = (last.t - first.t) / 1000;
  if (dt < 1) return null;                     // 窗口太短，速率没意义
  const bps = (last.bytes - first.bytes) / dt;
  if (bps >= CFG_PRELOAD.slowBps) return null;
  return { bps, text: '网络较慢 · 可下载离线版 ' + OFFLINE_URL };
}

/* ── 进度文案：下载段与暖编译段说**两件不同的事**，文案必须能分开 ────────────
   ⚠️ **格式红线（2026-09-27 用户拍板②，文案切换）**：
   下载段改说「正在下载资产 4.2/10.0 MB」—— 明确告诉用户"现在在等网络，不是在渲染"，
   慢网时这句是关键的信息（否则用户以为是页面卡死）。暖编译段继续说
   `营 造 中 · <阶段> <pct>%`（园林意象，那是**本地计算**，说"营造"才对得上）。
   两条判据不许打架：
     · loading-guard 认的正则 /营 造 中 · (\S+) (\d+)%/ —— **只有暖编译段产出**，
       10 个桶 ⇒ 命中 ≥2 次绰绰有余（实测 10 次），下载段切成"正在下载"不影响它；
     · 切走之后**下载段不许再出现 `%`**：正则会把 `正在下载 12%` 里的 `12` 当阶段名。
   ⚠️ 同源红线：下载段**也不许**再出现 `营 造 中 · <某个字> <数字>%` 的形状。 */
const MB = 1048576;
export function describe(agg){
  const a = agg || aggregate();
  /* ⚠️ **下载段全部到位时绝不能写「即 将 开 园」**（2026-09-27 修掉的一个自己造出来的 bug）：
     下载段只占整条进度的前 45%，它结束之后还有暖编译 10 桶要走。
     早写一次"即将开园"会让文案序列变成 营造中 → 即将开园 → 营造中 → 即将开园
     （实测本地档第 2 条就是"即 将 开 园"，然后第 3 条又退回"营 造 中 · 立屋架 45%"）
     —— 用户看到的是"马上开园…咦还在造？"，比没有提示更坏。
     "即将开园"只由暖编译段的收尾（11-loop 的 setWarmUI）写一次。 */
  if (a.settled >= a.count && a.settled > 0) return '正 在 下 载 · 资 产 就 位';
  // 找"在飞且已下得最多"的那一个作为主语；都还没开始动就报第一个在飞的
  let best = null;
  for (const it of items.values()){
    if (it.settled !== null) continue;
    if (!best || it.loaded > best.loaded) best = it;
  }
  if (!best) return '正 在 下 载 · 资 产 就 位';
  /* 量纲 + 件数：光有 MB 不知道"还要多久下完一共几件"，
     补一个 n/N 让慢网用户对"总共多少活"有概念。 */
  return `正 在 下 载 资 产 ${(a.loaded / MB).toFixed(1)}/${(a.total / MB).toFixed(1)} MB`
       + `（${a.settled + 1}/${a.count}）`;
}

/* ══ 预载段主入口 ═══════════════════════════════════════════════════════════
   职责边界：它**不负责开始下载**（下载在模块求值期就发起了），只负责
   "等它们到位，并把等待过程如实播报成 0→45% 的进度"。

   onTick(state) 的调用契约（门禁要断言这三条）：
     ① 相邻两次调用间隔 ≥ coalesceMs（默认 250ms）—— 防逐 chunk 刷屏；
     ② 只在整数百分比变化时调用 —— 防同一数值反复写 DOM；
     ③ state.pct 单调不减。
   返回 Promise：全部到位、或失败、或超预算（PRELOAD_TIMEOUT_MS）时 resolve。
   ⚠️ 永不 reject —— 预载失败不是启动失败，降级继续开园才是正解
   （整页白屏才是最坏结果）。

   ── 零等待分支（2026-09-27 · 用户拍板①）────────────────────────────────────
   当 `aggregate().settled >= count`（GLB 已在 warmBoot 之前**全部**到位）时
   **直接同步返回、不起定时器、不让出任何一帧**。
   为什么必须是"同步"而不是"立刻 resolve 一个 Promise"：`await` 一个已 resolve 的
   Promise 仍会让出**一帧**（微任务之后的宏任务边界），而 `warmBoot` 里 `await` 之后
   紧跟着的 `collectWarmBuckets()` 是在**那一刻**对场景拍快照的 ——
   多让一帧，GLB 的 attach 就可能跨过快照边界，collectWarmBuckets 多收/少收对象。
   同步返回 ⇒ 快照时序与改动前**逐帧一致** ⇒ 本地档/SW 预缓存档零行为变化。
   两种触发场景（都应当零等待）：
     · 本地不限速：1.1 MB 早已下完（实测 GLB 在 1645ms 就全到位，warmBoot 远在其后）；
     · 装成 PWA 后：.glb 走 cache-first，install 期就预缓存好了，**从来没有网络发生**。
   ⚠️ 零等待时**不写** .ld-text / .ld-prog（`silent:true`）—— 让暖编译段从 45% 起
   自己的第一桶来铺满整条 bar，避免"0 → 45 跳一下 → 45 → 51…"这种无信息量的抖动。 */
export function preloadPhase(onTick, timeoutMs, coalesceMs){
  const budget = Number.isFinite(timeoutMs) ? timeoutMs : CFG_PRELOAD.timeoutMs;
  /* ⚠️ coalesceMs 第三个参数**只给门禁的负例注入用**（传 0 = 撤掉采样合并，
     用来证明"① 相邻间隔 ≥250ms"这条判据确实有牙）。产品路径不传，走 CFG_PRELOAD。 */
  const COALESCE = Number.isFinite(coalesceMs) ? Math.max(0, coalesceMs) : CFG_PRELOAD.coalesceMs;
  /* 零等待：全部到位 ⇒ 同步返回（不建定时器、不让帧）。silent 让调用方跳过首次绘制。 */
  const pre = aggregate();
  if (pre.settled >= pre.count) return { settledEarly: true, promise: Promise.resolve(pre) };
  return { settledEarly: false, promise: new Promise(resolve => {
    const t0 = performance.now();
    let lastPctInt = -1, lastTick = 0, finished = false;
    const timer = setInterval(tick, Math.min(COALESCE, budget || COALESCE) || 1);
    /* 「先用基础版进入」：用户主动放弃等待 ⇒ 立刻放行。
       enterBasic() 已把还在飞的全部 settle 成失败，所以下一次 tick 的
       `a.settled >= a.count` 自然成立；这里只把**等待上限**压到 0，
       让它在下一个 tick（≤COALESCE，250ms 内）就走收尾，而不是等满 180s。 */
    const release = () => { if (!finished) tick(); };
    function tick(){
      if (finished) return;
      const a = aggregate();
      const timedOut = performance.now() - t0 > budget;
      // 超预算：把仍在飞的全部标记为失败，让 required:false 的进替身流程
      if (timedOut){
        for (const it of items.values()) if (it.settled === null) settleAsset(it.url, false, 'preload-timeout');
      }
      const now = performance.now();
      const pctInt = Math.min(100, Math.floor(a.pct * 100));
      if (pctInt !== lastPctInt && now - lastTick >= COALESCE){
        lastPctInt = pctInt; lastTick = now;
        try { onTick && onTick({ ...a, pctInt, notice: slowNotice() }); } catch (e){ /* 播报失败不阻塞开园 */ }
      }
      if (a.settled >= a.count || timedOut){
        finished = true; clearInterval(timer);
        const fa = aggregate();
        try { onTick && onTick({ ...fa, pctInt: 100, notice: null, final: true }); } catch (e){}
        resolve(fa);
      }
    }
    tick();
  }) };
}

/** 供探针在纯 Node 下核对清单与磁盘一致（不发网络请求，只读 fs 由调用方做）。 */
export function manifestSummary(){
  return PRELOAD_MANIFEST.map(it => ({ ...it }));
}

/* 迟到绑给 06：避免 06 静态 import 造成模块环（13 不依赖 06，方向是单向的）。 */
HOOKS.reportAssetProgress = reportAssetProgress;
HOOKS.settleAsset = settleAsset;
