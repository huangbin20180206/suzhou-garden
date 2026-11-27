// 00a-quality：画质档位判定（**纯函数，零 DOM、零 three**，2026-10-30 第 0 周热修 · 架构收口）
//
// ── 为什么单独成文件 ──────────────────────────────────────────────────────
// 档位判定原来长在 `02-scene.js` 里，而那个文件顶层会 `new THREE.WebGLRenderer(...)`、
// 建场景、挂 DOM —— 于是这段"看 GPU 名字决定画质"的逻辑**在 node 里根本无法被测试**，
// 而它恰恰是"错了也没人知道"的那类：
//   · 判错成 high：手机/核显按 4K 预算 + 6144 阴影 + 1.25 超采样跑 ⇒ 发热降频反而更卡；
//   · 判错成 low：独显用户白白吃低画质，看得到但以为是"程序就这水平"；
//   · 两者都**不报错、不崩、门禁全绿**，只有换台机器才现形。
// 2026-10-30 那次修（手机落 mid / 独显正则扩到 RTX-RX 全系 / 未知不再默认 high）
// 就是在没有任何测试网的情况下摸黑改的。现在把它提成纯函数，进 `npm run unit`。
//
// ── 边界 ────────────────────────────────────────────────────────────────
// 本文件只放**判定**（输入 GPU 名 + UA + 触点数 → 输出 'low'|'mid'|'high'）。
// 档位对应的具体数值（预算/阴影/粒子）仍留在 02-scene 的 QUALITY_PRESETS —— 那里
// 是"当前档的数值真值"，与"怎么判出这个档"是两件事，混在一起就又回到不可测。

/* 低档：核显 / 软渲染。这两个词表来自实测的 UNMASKED_RENDERER_WEBGL 输出，
   加新词之前先确认真遇到过（别凭想象写 "Intel" 之外的猜测词）。 */
const LOW_RE = /Intel|Iris|UHD Graphics|HD Graphics|Radeon\(TM\) Graphics|Vega|llvmpipe|SwiftShader/i;

/* 高档：叫得出名字的独显。原来只认 GTX 10xx/20xx —— RTX 30/40/50 全靠"未知=high"蒙对，
   一改默认值（未知不再 high）就会把独显用户也降档，所以这里必须把全系列上。 */
const HIGH_RE = /Apple M[1-9]|GTX\s*\d{3,4}|RTX\s*\d{3,4}|Radeon RX\s*\d+/i;
/* Arc A/B 独显也带 Intel 厂商名，不能先被 LOW_RE 的 Intel 吞掉；
   只放行已知独显系列，Arc Graphics / 140V 等核显及软渲染仍走低档。 */
const INTEL_ARC_DISCRETE_RE = /\bIntel(?:\(R\))?\s+Arc(?:\(TM\))?\s+[AB]\d{3}\b/i;

/* 手机 / 平板：Adreno / Mali 在 GPU 名里哪个正则都不中，只能看 UA。
   ⚠️ iPadOS 13+ 的 UA **冒充 Macintosh**，所以还要靠 maxTouchPoints > 1 兜住
      （Mac 的触控板不会让这个值大于 1）。 */
export function isMobileUA(userAgent = '', maxTouchPoints = 0){
  const ua = String(userAgent || '');
  if (/Android|iPhone|Mobi/i.test(ua)) return true;
  return /Macintosh/.test(ua) && Number(maxTouchPoints) > 1;
}

/* 档位判定唯一入口。`gpuName` 是 `WEBGL_debug_renderer_info` 的 UNMASKED_RENDERER_WEBGL；
   取不到时传空串（→ 落到 mid，不再默认 high）。
   优先级：低档词表 → 移动端 → 独显词表 → 其余一律 mid。 */
export function pickTier({ gpuName = '', userAgent = '', maxTouchPoints = 0 } = {}){
  const gpu = String(gpuName || '');
  const arc = INTEL_ARC_DISCRETE_RE.test(gpu);
  if (/llvmpipe|SwiftShader/i.test(gpu) || (LOW_RE.test(gpu) && !arc)) return 'low';
  if (isMobileUA(userAgent, maxTouchPoints)) return 'mid';
  return arc || HIGH_RE.test(gpu) ? 'high' : 'mid';
}

/* ── 调试接口是否展开（2026-10-30 · 架构收口）───────────────────────────────
   `window.__garden` 挂着 100+ 个内部对象与后门（setXxx），是门禁的唯一驱动面，
   不能删；但线上不该让任何人从控制台改场景状态。
   判据：`?debug=1` 显式要求 / 被自动化驱动（navigator.webdriver）/ 本机打开。
   ⚠️ **本机一律算调试态**：localhost、127.0.0.1、`*.localhost`、以及 `file://`
      （hostname 为空）—— 老黄始终本机打开，他的体验一位不变。
   ⚠️ 提成纯函数是为了让**生产分支**有测试网：本机永远走不到那条分支，
      不抽出来就只能靠"读代码觉得对"（本项目最不信任的验证方式）。 */
export function isDebugSurface({ search = '', webdriver = false, hostname = '' } = {}){
  // 子串匹配会把 debug=10、nodebug=1、next=debug=1 也当成显式开关。
  if (new URLSearchParams(String(search)).get('debug') === '1') return true;
  if (webdriver === true) return true;
  const h = String(hostname || '');
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
}

/* ── 自适应画质（QOS）的相对阈值（2026-10-31 · B3）──────────────────────────
   原来写死"fps < 45 降档 / fps > 58 升档"：30Hz 屏（含 iOS 低电量限帧、部分笔记本省电模式）
   满帧也只有 30，于是被当成"GPU 吃力"一路降到最低档 —— 不报错、门禁全绿、只有那台机器现形。
   改成相对值：目标帧率 = min(刷新率, 60)，低于 75% 降档、高于 96.5% 升档。
   取整到整数 fps（采样本身就是 Math.round 过的整数），于是 60Hz 下恰为原来的 45 / 58，
   比较语义（fps < down / fps > up）也与原来逐位一致。
   高刷屏（120/144Hz）封顶 60：本项目不追求 60 以上，跑满 60 就不该被判"吃力"。 */
export const QOS_RATIO = Object.freeze({ down: 0.75, up: 0.965, cap: 60 });

export function qosThresholds(refreshHz){
  const hz = Number.isFinite(refreshHz) && refreshHz > 0 ? refreshHz : QOS_RATIO.cap;
  const target = Math.min(hz, QOS_RATIO.cap);
  return { target, down: Math.round(target * QOS_RATIO.down), up: Math.round(target * QOS_RATIO.up) };
}

/** 单个采样窗口的判定：'down'（计一次低）/ 'up'（计一次高）/ 'hold'。 */
export function qosVerdict(fps, th){
  if (fps < th.down) return 'down';
  if (fps > th.up) return 'up';
  return 'hold';
}

/* 刷新率估计：加载页阶段（主循环还没起）收一串 rAF 间隔（秒）。
   取第 10 百分位间隔 —— 暖机编译帧只会把间隔拉长，低分位不受污染；
   丢掉 ≤2ms（同帧合并的回调）与 ≥250ms（后台/断点）的样本。
   样本不足 10 个（后台标签打开、rAF 被节流）返回 0，调用方按 60 处理。 */
export function estimateRefreshHz(intervals){
  const xs = (intervals || []).filter(x => Number.isFinite(x) && x > 0.002 && x < 0.25).sort((a, b) => a - b);
  if (xs.length < 10) return 0;
  const p10 = xs[Math.floor(xs.length * 0.1)];
  return Math.round(1 / p10);
}

/* ── 执行效率开关（2026-11-26 · 执行效率批）──────────────────────────────────────────
   本批里**行为可能与旧版不同**的优化都收在这里，一律可用 URL 关回 / 打开，纯函数进 npm run unit。
     · ?warm=par      启动：分桶暖编译之前先用 KHR_parallel_shader_compile 并行预编全场（默认关，见 11-loop warmBoot）
     · ?precompile=1  切换：开园后空闲时并行预编"初始隐藏"的对象（雨/雪/萤火/镜前雨…）（默认关，见 11-loop）
     · ?shadowtrans=all  切换：环境过渡期每帧都重渲阴影图（旧行为）；缺省 = gated，见 transitionShadowDue
   前两项只改"着色器何时编译"、不改像素，但它们的收益只有真机能量（软渲染探针里没有并行编译），
   所以先默认关，等 Kyle 本机量过再决定。第三项改的是过渡 3 秒内阴影图的刷新节奏（见下）。 */
export function perfFlags(search = ''){
  const q = String(search || '');
  const get = (k) => { const m = new RegExp('[?&]' + k + '=([^&#]*)').exec(q); return m ? m[1] : null; };
  return Object.freeze({
    warmPar: get('warm') === 'par',
    precompile: get('precompile') === '1',
    shadowTrans: get('shadowtrans') === 'all' ? 'all' : 'gated',
    /* 每帧场景矩阵只算一次（2026-11-26 · 场景打造批）：一帧里 renderer.render 被调约 4 次
       （主 pass、水面反射、GTAO 法线/深度、折射），每次开头都 scene.updateMatrixWorld() 全场重算。
       默认开：animate 在 composer.render() 前手动算一次，渲染期间关 scene.matrixWorldAutoUpdate。
       逃生口 ?matrix=auto 回到 three 的每次重算（结果逐像素相同，只是多算）。 */
    matrixOnce: get('matrix') !== 'auto',
    /* 2026-11-27 · 效率批：静态小件合成 InstancedMesh（?instancing=0 回逐个 Mesh）、
       视锥外/远处动画降频（?animlod=0 每帧全更新）、后期按档分级（?postfx=full 各档按高档后期）。 */
    instancing: get('instancing') !== '0',
    animLod: get('animlod') !== '0',
    postFull: get('postfx') === 'full',
  });
}
/* 模块顶层直接取当前页的开关（node 单测里无 location ⇒ 全缺省）。 */
export function perfFlagsHere(){
  try { return perfFlags(globalThis.location ? globalThis.location.search : ''); } catch { return perfFlags(''); }
}
/* 后期按画质档分级（2026-11-27）。高档 = 改前原值，逐项不动。
   mid：GTAO 内部 RT 0.5→0.375、采样 32→16、去噪 16→8；bloom 内部 mip 链降到 0.5。
   low：本来就无 AO（QUALITY_PRESETS.ao=false），只把 bloom 降到 0.5。
   bloom 是大半径模糊，降内部分辨率肉眼几乎不可辨；省的是 5 级 mip 的片元。 */
export const POST_PLAN_HIGH = Object.freeze({ aoScale: 0.5, aoSamples: 32, pdSamples: 16, bloomScale: 1 });
export function postPlan(tier = 'high', full = false){
  if (full || tier === 'high') return POST_PLAN_HIGH;
  if (tier === 'mid') return Object.freeze({ aoScale: 0.375, aoSamples: 16, pdSamples: 8, bloomScale: 0.5 });
  return Object.freeze({ aoScale: 0, aoSamples: 0, pdSamples: 0, bloomScale: 0.5 });
}
/* 动画降频（2026-11-27）：视锥外 / 远处的纯表演物件（鱼、鸟、花瓣、萤火…）不必每帧更新。
   返回"每几帧更新一次"：近处可见 1；远处可见 2；视锥外 4；关掉开关恒 1。
   只用于不回读进仿真的纯视觉动画 —— 人物主循环不走这里，重播基线不受影响。 */
export const ANIM_LOD_FAR = 60;
export function animLodEvery(enabled = true, inView = true, dist = 0, far = ANIM_LOD_FAR){
  if (!enabled) return 1;
  if (!inView) return 4;
  return dist > far ? 2 : 1;
}
export function animLodDue(every, frame, phase = 0){
  return every <= 1 || ((frame + phase) % every) === 0;
}
/* 环境过渡（时段/季节/天气 3 秒缓动）期间要不要重渲阴影图。
   旧版：过渡中**每帧**强制重渲（6144² 的整场景深度 pass，高档位最贵的一笔之一）。
   但阴影图只取决于"光向 + 投影物集合"：
     · 光向动了 —— applyEnv 自己会在光向变化 >0.01 时置 needsUpdate（12-env，那条不经这里）；
     · 投影物集合变了 —— 12f applyPresence 的版本号 presenceRev 会变 ⇒ presenceChanged；
     · 过渡结束那一帧 —— done，保证终态与旧版逐像素一致；
     · 其余（风摆植被的影子、12-env 里未进版本号的零星显隐）—— 每 every 帧兜底一次（60fps 下 10Hz）。
   预期差异：仅过渡进行中的 3 秒里，风摆枝叶的影子从 60Hz 刷新降到 10Hz；终态与稳态不变。 */
export const TRANS_SHADOW_EVERY = 6;
export function transitionShadowDue({ mode = 'gated', presenceChanged = false, done = false, frame = 0, every = TRANS_SHADOW_EVERY } = {}){
  if (mode === 'all') return true;
  if (presenceChanged || done) return true;
  return every <= 1 || (frame % every) === 0;
}
