// 阴影烘焙前提门 · 纯静态版：node probe/shadow-product-gate.mjs
//
// ── 这道门与 shadow-bake-guard.mjs 的关系 ──
// 既有门（probe/shadow-bake-guard.mjs）跑在**浏览器**里，它实测的太阳方向走完整路径：
//   拖 hourSlider → input handler → composeEnv(paramsAtHour) → ENV.cur → applyEnv → sun.position
//   并处理「夜里主光交给月亮替身」（其 :67-73 注释写明：混进来会出现 80°~135° 的假跳变）。
// 本门走**纯静态**路径：直接 import paramsAtHour(h).sunPos，不经滑杆、不经 applyEnv、不碰渲染器。
//
// ⚠️⚠️ **两条路径的读数本就不同，这不是 bug，是口径差异，必须知道再比较**：
//   浏览器版头注实测：太阳主导时段 h∈[6.5,19]、弧长 **180°**、8° 口径 **11 个**独立方向。
//   本门纯静态实测（2026-10-13，node 直跑）：**全天**（h=0~24 步进 0.5h）弧长 **300.3°**、
//   8° 口径 **18 个**独立方向、仅非夜段弧长 261.0°。
//   差异来源：①本门含夜间时段（浏览器版按 starAmount 剔掉了夜）；②本门不做月亮接管。
//   ⇒ **阈值必须分口径**：浏览器口径直接引用既有门头注的 11 / 180°；
//     纯静态口径用本门自己实测的 18 / 300.3°，且**只用于守住「纯静态这条路径的前提没变」**。
//   两条口径互不替代。若将来要让它们一致，须改的是浏览器门或本门的采样定义，**不是拍阈值**。
//
// ── 守什么 ──
// 守住「烘焙不可行」这个结论所依赖的前提，在**纯静态、无 GPU**的条件下仍成立：
//   S1 太阳方向随时辰连续变化（不是几个固定角）
//   S2 独立方向数下界（离散烘焙需要的张数随此线性增长）
//   S3 时段分段边界与插值段数（决定产物索引的切换点）
//   S4 sunPos 在段内是**线性插值**（任何非线性改动都会改变混合权重的推导）
//   S5 产物清单一致性（**当前无产物属预期**，判绿）
//   S6 实时阴影开关仍是单光源口径（烘焙产物不得与实时阴影叠加的前提）
//
// ── 阈值来源 ──
// 浏览器口径：直接引用 probe/shadow-bake-guard.mjs 头注 :9-13 的实测值。
// 纯静态口径：本门首次建立基准（2026-10-13 实测，见上方注释），**容差按纯静态自身跨样本的确定性定**。
// 标「来源待定」的项：那些值在既有门禁里找不到、且本门静态测不出（如投射物高度 p50/p90 需遍历场景）。
//
// ── 纪律 ──
// ① 纯 node：不 import 任何渲染器/three 的东西，不开浏览器，不占 GPU。
// ② 阈值不许拍：每个数字都要指回来源。
// ③ 判红要能区分「前提真变了 / 代码改了但前提没变 / 测法自身出错」—— 见末尾三态判读。
import { paramsAtHour, nearestTimeKey } from '../src/12a-presets.js';

/* ══ 阈值常量（每个都注明出处，不拍） ══ */
const T = {
  /* —— 浏览器口径：直接引用既有门禁头注 probe/shadow-bake-guard.mjs:9-13 的实测 —— */
  BROWSER_CLUSTERS_8DEG : 11,      // 8° 口径显著独立方向数（头注 :10）
  BROWSER_ARC_DEG       : 180,     // 全天弧长（头注 :9）
  BROWSER_DAY_FROM      : 6.5,     // 太阳主导时段起（头注 :9）
  BROWSER_DAY_TO        : 19,      // 太阳主导时段止（头注 :9）
  CASTER_H_P50          : 2.64,    // 投射物高度中位（头注 :11，单位 m）
  CASTER_H_P90          : 8.11,    // 投射物高度 p90（头注 :11）
  NEED_MAPS_MIN         : 104,     // 需 104~335 张 2048²+（头注 :13）
  NEED_MAPS_MAX         : 335,     // 同上
  INFEASIBLE_MAPS       : 24,      // 既有门 :45 的门限值

  /* —— 纯静态口径：本门 2026-10-13 首次实测建立（口径 = paramsAtHour(h).sunPos，h=0~24 步进 0.5h） —— */
  STATIC_CLUSTERS_8DEG  : 18,      // 实测 18（含夜间、不做月亮接管）
  STATIC_ARC_DEG        : 300.3,   // 实测 300.3
  STATIC_ARC_TOL        : 1.0,     // 容差：paramsAtHour 是纯函数、同输入必同输出 ⇒ 波动为 0；
                                //   留 1.0° 仅吸收浮点/末位差，**不是拍脑袋的余量**
  STATIC_CLUSTER_MIN    : 8,       // 独立方向数下界：低于 8 即前提①被推翻（离散烘焙变可行）
  LINEAR_RESIDUAL_MAX   : 1e-6,    // 段内线性插值残差上限。mixInto(12a-presets.js:563) 是纯线性
                                //   ⇒ 残差应**精确为 0**（实测 0.000000）；1e-6 只吃浮点噪声
  /* —— 来源待定：既有门禁里找不到、且本门静态测不出 —— */
  /* CASTER_TEXEL_CM：阴影视体 texel 尺寸（既有门 :125 运行时算，需场景）→ 来源待定 */
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}${detail ? ' \u2014 ' + detail : ''}`);
};

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0]/l, v[1]/l, v[2]/l]; };
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]))) * 180 / Math.PI;
const SAMPLES = [];
for (let h = 0; h < 24; h += 0.5) SAMPLES.push({ h, d: norm(paramsAtHour(h).sunPos), key: nearestTimeKey(h) });

/* ══ S1 太阳方向连续 ══ */
const steps = [];
let arc = 0;
for (let i = 1; i < SAMPLES.length; i++){
  const a = ang(SAMPLES[i-1].d, SAMPLES[i].d);
  steps.push(a);
  if (a < 60) arc += a;            // >=60 度视为断点，不计入弧长（口径同既有门 :90）
}
const sorted = steps.slice().sort((x, y) => x - y);
const medianStep = sorted[sorted.length >> 1];
const maxStep = sorted[sorted.length - 1];
check('S1 太阳方向随时辰**连续**变化（步进中位数 > 0.2 度，非几个固定角）',
  medianStep > 0.2 && maxStep < 60,
  `步进中位数 ${medianStep.toFixed(3)}度 / 最大 ${maxStep.toFixed(2)}度 / 全天弧长 ${arc.toFixed(1)}度`);

/* ══ S2 独立方向数 ══ */
const cl = [];
for (const s of SAMPLES){
  let bd = Infinity, bi = -1;
  cl.forEach((c, i) => { const d = ang(c.d, s.d); if (d < bd){ bd = d; bi = i; } });
  if (bi >= 0 && bd <= 8) cl[bi].d = s.d; else cl.push({ d: s.d });
}
/* 需要的张数 = 弧长 / 每张摊的角度；每张摊的角度由 texel 尺寸决定（需场景 ⇒ 来源待定），
   故这里只报「方向数」与「弧长」，不编张数。既有门 :131-132 的算法可直接复用。 */
check(`S2 8 度口径独立方向数 >= ${T.STATIC_CLUSTER_MIN}（低于此则离散烘焙变可行，前提①被推翻）`,
  cl.length >= T.STATIC_CLUSTER_MIN && Math.abs(arc - T.STATIC_ARC_DEG) <= T.STATIC_ARC_TOL,
  `纯静态实测 ${cl.length} 个 / 弧长 ${arc.toFixed(1)}度（基准 ${T.STATIC_CLUSTERS_8DEG} 个 / ${T.STATIC_ARC_DEG} 度，容差 ±${T.STATIC_ARC_TOL}）`
  + `｜浏览器口径基准为 ${T.BROWSER_CLUSTERS_8DEG} 个 / ${T.BROWSER_ARC_DEG} 度（含月亮接管，口径不同、不可直接比）`);

/* ══ S3 时段分段边界 ══ */
const flips = [];
for (let i = 1; i < SAMPLES.length; i++)
  if (SAMPLES[i].key !== SAMPLES[i-1].key) flips.push(`${SAMPLES[i].h}:${SAMPLES[i-1].key}->${SAMPLES[i].key}`);
const EXPECT_FLIPS = ['4.5:night->morning', '10:morning->noon', '15:noon->dusk', '19.5:dusk->night'];
const flipsOK = flips.length === EXPECT_FLIPS.length && flips.every((f, i) => f === EXPECT_FLIPS[i]);
check('S3 时段分段边界与 nearestTimeKey 一致（4 个边界、顺序不变）',
  flipsOK,
  `实测 ${flips.length} 个翻转：${flips.join('  ')}（期望 ${EXPECT_FLIPS.length} 个：${EXPECT_FLIPS.join('  ')}）`);

/* ══ S4 段内线性插值 ══ */
/* 口径：hourSeg 的四段边界是 7.5/12.5/17.5/21.5（12a-presets.js:659-662），
   拿 morning->noon 段（7.5→12.5）验：sunPos 必须落在两端锚点的连线上。
   ⚠️ nearestTimeKey 的边界（4.5/10/15/19.5）与 hourSeg 的段边界（7.5/12.5/17.5/21.5）**不同**，
   因为前者是「按钮锚点」、后者是「插值段」—— 两者用途不同，S3/S4 分别验各自的，别混。 */
const A = paramsAtHour(7.5).sunPos, B = paramsAtHour(12.5).sunPos;
let worstRes = 0;
for (const t of [0.2, 0.4, 0.6, 0.8]){
  const want = [0,1,2].map(i => A[i] + (B[i] - A[i]) * t);
  const got  = paramsAtHour(7.5 + 5 * t).sunPos;
  worstRes = Math.max(worstRes, Math.hypot(...[0,1,2].map(i => got[i] - want[i])));
}
check(`S4 段内 sunPos 是**线性插值**（残差 <= ${T.LINEAR_RESIDUAL_MAX}）`,
  worstRes <= T.LINEAR_RESIDUAL_MAX,
  `morning->noon 段 t=0.2/0.4/0.6/0.8 最大残差 ${worstRes.toExponential(2)}`
  + `（mixInto 12a-presets.js:563 是纯线性 ⇒ 理论残差 0；任一非线性改动都会让它抬头）`);

/* ══ S5 产物清单 ══ */
/* 这道门是「守前提」的、不是「守产物」的。烘焙尚未做 ⇒ **产物不存在属预期**，判绿。
   这里刻意不 import fs、不扫目录：产物路径至今没有任何代码或文档定义过（查不到），
   真要守产物清单，得先有产物规范。本条此刻守的是「没有产物时门仍绿」。 */
const PRODUCT_SPEC_KNOWN = false;
check('S5 产物清单一致性（**当前无产物属预期**，判绿；产物规范尚不存在 ⇒ 来源待定）',
  true,
  `产物规范状态：${PRODUCT_SPEC_KNOWN ? '已定义' : '未定义（查不到：全仓无产物路径/命名约定）'} ⇒ 此刻只断言「无产物不报红」`);

/* ══ S6 实时阴影口径 ══ */
/* ⚠️⚠️ 口径更正（第一次写错，已修）：本条最初判「DirectionalLight 数量 == 1」⇒ 基线自己就红。
   错因：把「方向光总数」当成了「**投影**方向光数」。
   实际 src/09-lights.js 里有 **2 盏** DirectionalLight：
     · sun  = DirectionalLight(...) 09-lights.js:113 —— `sun.castShadow = true`（:115），**唯一投影**
     · fill = DirectionalLight(0xbcd2e0, 0.32) 09-lights.js:217 —— **不投影**（无 castShadow 声明）
   这与前提③（既有门 :159「场景里只有 1 盏投影方向光」）一致 —— 是**投影**口径 1 盏，不是光源 1 盏。
   ⇒ 静态下能判的是「**castShadow=true 的声明数** == 1」。 */
let litSrc = '';
let castCount = -1;
try {
  const { readFileSync } = await import('node:fs');
  const s2 = readFileSync(new URL('../src/09-lights.js', import.meta.url), 'utf8');
  const total = (s2.match(/new THREE\.DirectionalLight/g) || []).length;
  castCount = (s2.match(/\.castShadow\s*=\s*true/g) || []).length;
  litSrc = '方向光共 ' + total + ' 盏（sun:113 投影 / fill:217 不投影）｜castShadow=true 声明 ' + castCount + ' 处'
          + (s2.includes('shadowMap.enabled = true') ? '｜shadowMap.enabled=true' : '');
} catch (e){ litSrc = '读取失败：' + e.message; }
const oneCaster = castCount === 1;
check('S6 实时阴影仍是**单投影**光源口径（烘焙产物不得与实时阴影叠加的前提）',
  oneCaster,
  litSrc + '｜前提③要求「投影方向光 == 1 盏」（既有门 :159）；判的是 castShadow=true 的**声明数**，不是方向光总数（fill 09-lights.js:217 刻意不投影）');