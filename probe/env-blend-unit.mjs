// 环境叠加单测（2026-11-23 · 视觉打磨批次 1）：node:test，零浏览器，<1s。
// 扫「时段（0~24h，3 分钟步）× 天气（9 种，按互斥矩阵剔非法）× 季节（4）」全组合，
// 走与运行时同一条链：12a baseParamsAt → composeEnv → fxGates / waterSunGates（applyEnv 与 11-loop 都调它们）。
// 守三类事：
//   ① 连续性 —— 拖时辰滑杆 3 分钟一步，曝光 / bloom / 暗角 / 各特效门的单步跳变有上限；
//      切天气走 mixInto(from,to,e)：门控全由参数集里的连续量算出，过渡中逐点插值也无硬切。
//   ② 上限 —— 多层乘性叠加后曝光、bloom、暗角、对比不越界（暴雨湿光 + 暗角 + 夜 bloom 同时生效那一档）。
//   ③ 互斥 —— 银河只在晴类夜；云影 / 焦散在阴雨雪 + 夜归零；堂内暖光白天熄；余辉入夜熄；
//      池面晨雾不在雨天跟雨雾叠满。
// 为什么要它：新特效各自就近算门控，曾出现银河挂在雾夜、余辉照亮夜空、焦散跑到晨暮、
//   暴雨里云影扫地 —— 都只在某个组合里露馅，单看任一特效的提交都看不出（见 12a fxGates 头注释）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindPresetsEnv, composeEnv, baseParamsAt, paramsAtHour, cloneParams, mixInto,
         ENV_WEATHER, ENV_SEASON, weatherMutexReason, fxGates, waterSunGates, sunAltDeg,
         makeReelSampler, REEL_KEY_H, SurfaceGate, SURFACE_EPS, lingerInit, lingerStep } from '../src/12a-presets.js';
import { SEASON_DOY } from '../src/12g-phenology.js';

const ENV = { season: 'summer', weather: 'clear', doy: SEASON_DOY.summer, festival: false, moonPhase: null };
bindPresetsEnv(ENV);
const STEP = 0.05;                                   // 小时（3 分钟）
const SEASONS = Object.keys(ENV_SEASON);
const WEATHERS = Object.keys(ENV_WEATHER);
const CLEARISH = new Set(['clear', 'afterrain', 'snowclear']);
const NO_SUN = new Set(['storm', 'snow', 'mist', 'drizzle', 'overcast', 'thunder']);   // 无硬影 / 日轮遮 ≥0.7

function setAxes(season, weather, festival = false){
  Object.assign(ENV, { season, weather, doy: SEASON_DOY[season], festival });
}
function sample(p){
  const sdY = p.sunPos[1] / (Math.hypot(...p.sunPos) || 1);
  return { p, alt: sunAltDeg(p), fx: fxGates(p), w: waterSunGates(sdY, p) };
}
/* 运行时用到的标量，一张表里比 */
const SCALARS = {
  exposure:  s => s.p.exposure,
  bloom:     s => s.p.bloomStrength,
  vignette:  s => s.p.grade.vignette,
  contrast:  s => s.p.grade.contrast,
  milkyWay:  s => s.fx.milkyWay,
  sunGlow:   s => s.fx.sunGlow,
  cloudShade:s => s.fx.cloudShade,
  hallWarm:  s => s.fx.hallWarm,
  caustic:   s => s.w.caustic,
  bankPond:  s => s.p.bankPond,
};
/* 3 分钟步的跳变上限：真实日出日落本身就快（真太阳 smoothstep），上限取"一帧硬切"会超出的量级。
   实测（2026-11-23）最大值：曝光 0.0105 / bloom 0.0121 / 暗角 0.0125 / 银河 0.057（日出星退）/
   焦散 0.045（正午段 0.20 宽坡）。 */
const MAX_STEP = { exposure: 0.03, bloom: 0.03, vignette: 0.03, contrast: 0.03, milkyWay: 0.08,
                   sunGlow: 0.12, cloudShade: 0.02, hallWarm: 0.06, caustic: 0.08, bankPond: 0.06 };

const combos = [];
for (const season of SEASONS) for (const weather of WEATHERS){
  if (weatherMutexReason(weather, season) !== null) continue;
  combos.push([season, weather]);
}
const sweep = new Map();   // "season/weather" → [{h, s}]
for (const [season, weather] of combos){
  setAxes(season, weather);
  const arr = [];
  for (let i = 0; i <= 24 / STEP; i++){
    const h = i * STEP;
    arr.push({ h, s: sample(composeEnv(baseParamsAt(h))) });
  }
  sweep.set(season + '/' + weather, arr);
}
const all = function* (){ for (const [k, arr] of sweep) for (const r of arr) yield [k, r]; };

test('组合覆盖：互斥矩阵剔除后 ≥ 29 个 季节×天气 组合', () => {
  assert.ok(combos.length >= 29, `只扫到 ${combos.length} 个组合`);
});

test('连续性：时辰 3 分钟一步，各通道单步跳变不超上限', () => {
  const bad = [];
  for (const [k, arr] of sweep){
    for (let i = 1; i < arr.length; i++){
      for (const [name, f] of Object.entries(SCALARS)){
        const d = Math.abs(f(arr[i].s) - f(arr[i - 1].s));
        if (!(d <= MAX_STEP[name])) bad.push(`${k}@${arr[i].h.toFixed(2)} ${name} Δ${d.toFixed(4)}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 处跳变`);
});

test('连续性：午夜回绕（24h → 0h）无跳变', () => {
  for (const [k, arr] of sweep){
    const a = arr[0].s, b = arr[arr.length - 1].s;
    for (const [name, f] of Object.entries(SCALARS)){
      assert.ok(Math.abs(f(a) - f(b)) <= MAX_STEP[name], `${k} 午夜 ${name}: ${f(b)} → ${f(a)}`);
    }
  }
});

test('连续性：切天气（mixInto 过渡）中途门控在两端之间、无硬切', () => {
  const HOURS = [6.5, 12.5, 18.2, 22];
  const PAIRS = [['clear', 'storm'], ['clear', 'mist'], ['mist', 'drizzle'], ['afterrain', 'clear'], ['clear', 'drizzle']];
  for (const season of ['spring', 'summer', 'autumn']) for (const h of HOURS) for (const [wa, wb] of PAIRS){
    setAxes(season, wa); const A = composeEnv(baseParamsAt(h));
    setAxes(season, wb); const B = composeEnv(baseParamsAt(h));
    const cur = cloneParams(A);
    let prev = null;
    for (let i = 0; i <= 40; i++){
      mixInto(cur, A, B, i / 40);
      const s = sample(cur);
      if (prev) for (const [name, f] of Object.entries(SCALARS)){
        const d = Math.abs(f(s) - f(prev));
        /* 2.8s 过渡切 40 段 ≈ 70ms 一段（4 帧）：单段不得超过 0.05（硬切会一次跳满量程） */
        assert.ok(d <= 0.05, `${season}@${h} ${wa}→${wb} 第 ${i}/40 段 ${name} Δ${d.toFixed(4)}`);
      }
      prev = s;
    }
  }
});

test('上限：曝光 / bloom / 暗角 / 对比在所有组合（含灯会）都在合理区间', () => {
  const lim = { exposure: [0.6, 1.25], bloom: [0.2, 0.62], vignette: [0.3, 0.6], contrast: [0.08, 0.30] };
  const check = (tag, s) => {
    for (const [name, [lo, hi]] of Object.entries(lim)){
      const v = SCALARS[name](s);
      assert.ok(v >= lo && v <= hi, `${tag} ${name}=${v.toFixed(4)} 越出 [${lo}, ${hi}]`);
    }
  };
  for (const [k, r] of all()) check(`${k}@${r.h}`, r.s);
  /* 灯会层（第 4 层）叠在暴雨湿光之上：bloom 封顶 0.68 由 applyFestivalTo 自己守，这里只要求不越 0.70 */
  for (const [season, weather] of combos) for (const h of [19, 21.5, 0]){
    setAxes(season, weather, true);
    const s = sample(composeEnv(baseParamsAt(h)));
    assert.ok(s.p.bloomStrength <= 0.70 && s.p.exposure <= 1.30,
      `${season}/${weather}+灯会@${h} bloom=${s.p.bloomStrength} exp=${s.p.exposure}`);
  }
  setAxes('summer', 'clear');
});

test('互斥：银河只在晴类天气的夜里出现（雾 / 雨 / 雪夜 = 0）', () => {
  for (const [k, r] of all()){
    const w = k.split('/')[1];
    if (!CLEARISH.has(w)) assert.equal(r.s.fx.milkyWay, 0, `${k}@${r.h} 银河=${r.s.fx.milkyWay}`);
    if (r.s.alt > 4) assert.ok(r.s.fx.milkyWay < 0.02, `${k}@${r.h} 白天银河=${r.s.fx.milkyWay}`);
  }
  /* 阳性对照：晴夜确实有银河（门控没把它整个关死） */
  const night = sweep.get('summer/clear').find(r => Math.abs(r.h - 23) < 1e-6).s;
  assert.ok(night.fx.milkyWay > 0.3, `夏晴 23:00 银河=${night.fx.milkyWay}`);
});

test('互斥：方位余辉 / 云受光入夜熄灭，白天一字不变', () => {
  for (const [k, r] of all()){
    if (r.s.alt < -9.01) assert.ok(r.s.fx.sunGlow < 1e-6, `${k}@${r.h} 仰角 ${r.s.alt.toFixed(1)}° 余辉门=${r.s.fx.sunGlow}`);
    if (r.s.alt > 4) assert.ok(r.s.fx.sunGlow > 0.999, `${k}@${r.h} 白天余辉门=${r.s.fx.sunGlow}`);
  }
});

test('互斥：云影在阴雨雪雾、夜里与日落后归零；晴天白天照常', () => {
  for (const [k, r] of all()){
    const w = k.split('/')[1];
    if (NO_SUN.has(w) || r.s.alt <= 0 || r.s.p.starAmount >= 0.72)
      assert.equal(r.s.fx.cloudShade, 0, `${k}@${r.h} 云影=${r.s.fx.cloudShade}`);
  }
  const noon = sweep.get('summer/clear').find(r => Math.abs(r.h - 12.5) < 1e-6).s;
  assert.ok(noon.fx.cloudShade > 0.05, `夏晴正午云影=${noon.fx.cloudShade}`);
});

test('互斥：池底焦散只在白天正午段 + 少云，晨暮 / 阴雨 / 夜归零', () => {
  for (const [k, r] of all()){
    const w = k.split('/')[1];
    if (r.s.alt < 30 || NO_SUN.has(w)) assert.equal(r.s.w.caustic, 0, `${k}@${r.h} 仰角 ${r.s.alt.toFixed(1)}° 焦散=${r.s.w.caustic}`);
    assert.ok(r.s.w.caustic <= r.s.w.sunVis + 1e-12, `${k}@${r.h} 焦散门不应大于波光门`);
  }
  /* 波光晨暮低档仍在（9d67ccc 的金色波光不能被本批误伤） */
  const dusk = sweep.get('autumn/clear').find(r => r.s.alt > 8 && r.s.alt < 20 && r.h > 12).s;
  assert.ok(dusk.w.sunVis > 0.15 && dusk.w.caustic === 0, `秋晴暮 sunVis=${dusk.w.sunVis} caustic=${dusk.w.caustic}`);
});

test('互斥：堂内暖光白天（太阳 >22°）熄，夜里亮、暮锚点保持', () => {
  for (const [k, r] of all()){
    if (r.s.alt > 22) assert.ok(r.s.fx.hallWarm < 1e-9, `${k}@${r.h} 仰角 ${r.s.alt.toFixed(1)}° 窗暖=${r.s.fx.hallWarm}`);
    if (r.s.alt < 0) assert.ok(Math.abs(r.s.fx.hallWarm - r.s.p.lamp * 0.55) < 1e-9, `${k}@${r.h} 夜窗暖=${r.s.fx.hallWarm}`);
  }
  /* 旧模式（?solar=0）：暮锚点主光 13.3° 保留 ≥90%，夜锚点主光是月亮替身（仰角高）不得被收 */
  setAxes('summer', 'clear');
  const lDusk = fxGates(composeEnv(paramsAtHour(17.5))).hallWarm;
  const lNight = fxGates(composeEnv(paramsAtHour(23))).hallWarm;
  assert.ok(lDusk >= 0.9 * 0.25 * 0.55, `旧模式暮窗暖=${lDusk}`);
  assert.ok(Math.abs(lNight - 0.55) < 1e-9, `旧模式夜窗暖=${lNight}`);
});

test('互斥：池面晨雾不与雨雾叠满（雨天 ≤ 晴天，雾天才是满档）', () => {
  for (const season of SEASONS){
    const peak = w => { const a = sweep.get(season + '/' + w); return a ? Math.max(...a.map(r => r.s.p.bankPond)) : null; };
    const clear = peak('clear');
    for (const w of ['storm', 'thunder', 'drizzle']){
      const v = peak(w); if (v === null) continue;
      assert.ok(v <= clear + 1e-9, `${season}/${w} 池雾峰值 ${v} > 晴天 ${clear}`);
    }
    assert.ok(peak('mist') > clear, `${season} 雾天池雾应为满档`);
  }
});

/* ── 第 5 批 · 慢更新分流（2026-11-24）：流转关键帧插值 + 地表"变了才算"门 ──────────────────────
   流转目标由 makeReelSampler 给（每 REEL_KEY_H 游戏小时一帧关键帧、帧间线性插值、急变格精确）。断言：
   ① 与逐帧精确合成的偏差：颜色 / 标量 ≤ 0.012、日月方向 ≤ 0.005（outputs/_diag/reel-sampler-check 全组合实测 ≤ 0.0087）；
   ② 无阶跃：按 60Hz × 0.4 时/秒逐帧走，插值输出的单帧跳变不大于精确合成在同一帧的跳变 + 0.003（关键帧边界不跳）；
   ③ 重合成次数显著少于逐帧（≤ 0.35 次/帧）。 */
const flatP = (p, out) => { let i = 0;
  for (const k in p){ const v = p[k];
    if (typeof v === 'number') out[i++] = v;
    else if (v && v.isColor){ out[i++] = v.r; out[i++] = v.g; out[i++] = v.b; }
    else if (Array.isArray(v)) for (const x of v) out[i++] = x;
  }
  out.length = i; return out; };
test('流转关键帧插值：贴合逐帧精确合成、关键帧边界无阶跃、重合成次数降到三成以下', () => {
  const dh = 0.4 / 60;
  let worst = 0, worstJump = 0, frames = 0, builds = 0;
  for (const season of SEASONS) for (const weather of ['clear', 'storm', 'mist', season === 'winter' ? 'snow' : 'drizzle']){
    if (weatherMutexReason(weather, season) !== null) continue;
    setAxes(season, weather);
    const S = makeReelSampler();
    let pa = null, pb = null;
    for (let h = 0.01; h < 23.9; h += dh){
      const a = flatP(S.sample(h), []), b = flatP(composeEnv(baseParamsAt(h)), []);
      assert.equal(a.length, b.length, `${season}/${weather}@${h.toFixed(2)} 通道数不一致`);
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
      if (pa) for (let i = 0; i < a.length; i++)
        worstJump = Math.max(worstJump, Math.abs(a[i] - pa[i]) - Math.abs(b[i] - pb[i]));
      pa = a; pb = b; frames++;
    }
    builds += S.builds;
  }
  assert.ok(worst <= 0.012, `插值与精确合成最大偏差 ${worst.toFixed(4)}`);
  assert.ok(worstJump <= 0.003, `插值单帧跳变比精确合成多出 ${worstJump.toFixed(4)}`);
  assert.ok(builds / frames <= 0.35, `重合成 ${(builds / frames).toFixed(3)} 次/帧（关键帧步长 ${REEL_KEY_H}h）`);
});

test('地表门：稳态不重算、余韵按 1e-3 台阶推进且终值精确、预设通道一变即算', () => {
  setAxes('winter', 'snow');
  const p = cloneParams(composeEnv(baseParamsAt(10)));
  const L = lingerInit(p);
  const G = new SurfaceGate();
  assert.equal(G.dirty(L, p), true, '首帧必须算');
  for (let i = 0; i < 120; i++) assert.equal(G.dirty(L, p), false, '输入不变不应重算');
  /* 雪停：预设积雪归零，水位按余韵慢化 —— 每帧都推进，但写入只在累计变化 >1e-3 时发生 */
  const q = cloneParams(p); q.snowCover = 0; q.snowAmount = 0;
  assert.equal(G.dirty(L, q), true, '预设通道变化（积雪直出 → 0）应立即重算');
  let runs = 0, lastApplied = Math.max(q.snowCover, L.snowF), maxGap = 0;
  for (let f = 0; f < 60 * 600 && (L.snowG > 0 || L.snowF > 0); f++){
    lingerStep(L, q, 1 / 60, 0);
    if (G.dirty(L, q)){ runs++; lastApplied = L.snowF; }
    maxGap = Math.max(maxGap, Math.abs(L.snowF - lastApplied));
  }
  assert.ok(maxGap <= SURFACE_EPS + 1e-12, `写入值与真值的最大差 ${maxGap}`);
  assert.equal(L.snowG, 0, '地面雪应化完');
  assert.equal(G.dirty(L, q), false, '化完之后终值已写入，不应再算');
  assert.ok(runs > 50 && runs < 3000, `余韵 8 分钟里重算 ${runs} 次（逐帧会是 28800 次）`);
  /* 写口新就绪（延迟编译出来的 uniform）：extra 变了即算 */
  assert.equal(G.dirty(L, q, 1), true, '写口就绪数变化应重算');
});
