// 12h-solar: 苏州的太阳 / 月相 / 时段判定 —— 纯函数模块（2026-10-30 · 环境路线图「太阳与月亮」）。
/* 为什么单独一个文件、而且**零 import**：
   ① 这里只有天文公式与几个常量，node 下直接 import 就能单测（probe/env-solar-unit.mjs），
      不碰 THREE、不碰 DOM —— 12a-presets 一 import THREE 就要拉 vendor，测起来就重了；
   ② 12a（参数合成）、12-env（状态机）、12c（灯会挂钩）都要读它，放进任何一个都会让依赖方向变乱。
   口径（项目「写意为主、常识合理」）：
     · 太阳按苏州（31.3°N, 120.6°E, UTC+8）**真实位置**算，NOAA 简化式（赤纬 + 时差 + 时角），
       不做大气折射精算；只有"日出日落"这一个定义沿用通行的 −0.833°（太阳上沿 + 平均折射），
       否则冬至日落会早 4 分钟（16:55 vs 实测 16:58）。
     · 月亮的**轨道形状**仍是 12a 的 MOON_ARC 艺术轨道（默认机位朝北，真实月轨看不见，见那边长注释）；
       这里只负责**月相**（按日期算朔望）与**月出时刻**（随月龄后移：朔 6:00 / 上弦 12:00 / 望 18:00 / 下弦 0:00）。
     · 年份取 2027（与烟花彩蛋「2027」同一年）—— 只影响月相，换年改 SITE.year 一处。
   ⚠️ 坐标系与 12a 一致：+x 东、+z 南、+y 上（默认机位朝 −z = 北）。方位角 az 自正北顺时针。 */

export const SITE = { lat: 31.3, lon: 120.6, tz: 8, year: 2027 };

/* ?solar=0 回到旧的「四锚点线性插值」时段基准（灰度对比 / 旧基线复现用）。
   node 下没有 location ⇒ 默认开。⚠️ 只在模块期读一次：运行中切换会让 from/to 两套参数口径混在一次过渡里。 */
export const SOLAR = {
  enabled: !(typeof location !== 'undefined' && /[?&]solar=0\b/.test(location.search || '')),
};

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* ── 日期 ── doy = 年内日序（1 = 1 月 1 日）。2027 不是闰年，全文件按 365 天算。 */
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function doyOf(month, day){
  let d = day;
  for (let m = 1; m < month; m++) d += MDAYS[m - 1];
  return d;
}
export function dateOfDoy(doy){
  let d = ((Math.round(doy) - 1) % 365 + 365) % 365 + 1, m = 1;
  while (d > MDAYS[m - 1]){ d -= MDAYS[m - 1]; m++; }
  return { month: m, day: d };
}
export const wrapDoy = (doy) => ((Math.round(doy) - 1) % 365 + 365) % 365 + 1;

/* NOAA 简化式：分数年 γ → 时差（分钟）与赤纬（弧度）。精度约 ±1 分钟 / ±0.1°，写意足够。 */
function solarTerms(doy, hour){
  const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
            - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
             - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
             - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { eqt, decl };
}

/* 太阳位置：返回 { alt, az }（度）。hour 为当地钟面时（0~24，UTC+8）。 */
export function solarPos(doy, hour, site = SITE){
  const { eqt, decl } = solarTerms(doy, hour);
  const tst = hour * 60 + eqt + 4 * site.lon - 60 * site.tz;   // 真太阳时（分钟）
  const ha = (tst / 4 - 180) * D2R;                             // 时角：正午 0，上午为负
  const phi = site.lat * D2R;
  const cz = clamp(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha), -1, 1);
  const alt = 90 - Math.acos(cz) * R2D;
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) * R2D + 180;
  az = (az + 360) % 360;
  return { alt, az };
}
/* 方位/高度 → 世界单位向量（+x 东、+y 上、+z 南） */
export function dirFromAltAz(altDeg, azDeg){
  const a = altDeg * D2R, z = azDeg * D2R, c = Math.cos(a);
  return [Math.sin(z) * c, Math.sin(a), -Math.cos(z) * c];
}
export function sunDir(doy, hour, site = SITE){
  const { alt, az } = solarPos(doy, hour, site);
  return dirFromAltAz(alt, az);
}

/* 日出 / 正午 / 日落（当地钟面小时）+ 正午高度。极昼极夜在苏州不存在，不做分支。 */
export function sunTimes(doy, site = SITE){
  const { eqt, decl } = solarTerms(doy, 12);
  const phi = site.lat * D2R;
  const c = Math.cos(90.833 * D2R) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
  const ha0 = Math.acos(clamp(c, -1, 1)) * R2D;
  const noonMin = 720 - 4 * site.lon - eqt + 60 * site.tz;
  return {
    sunrise: (noonMin - 4 * ha0) / 60,
    noon: noonMin / 60,
    sunset: (noonMin + 4 * ha0) / 60,
    noonAlt: solarPos(doy, noonMin / 60, site).alt,
  };
}

/* ── 时段标签由太阳高度决定（不再写死钟点）──
   夜：太阳低于 −6°（民用晨昏蒙影结束，天真的黑了）；
   午：高度达到当天正午高度的 60% 以上（冬至正午只有 35°，按比例才不会"冬天永远没有午"）；
   其余按上午 / 下午分晨与暮。 */
export const TIME_RULE = { nightAlt: -6, noonFrac: 0.6 };
export function timeKeyAt(hour, doy, site = SITE){
  const { alt } = solarPos(doy, hour, site);
  if (alt < TIME_RULE.nightAlt) return 'night';
  const st = sunTimes(doy, site);
  if (alt >= st.noonAlt * TIME_RULE.noonFrac) return 'noon';
  return hour < st.noon ? 'morning' : 'dusk';
}

/* 时段按钮的锚点（随季节）：
   晨 = 太阳升到 10° 的时刻（日出后约一小时，晨光还斜但已照进园子）；
   午 = 真太阳正午 + 0.5h（旧锚点就是 12:30：光略偏西、建筑立面有一点侧光，不是正顶光的平）；
   暮 = 太阳落到 7° 的时刻（金光最浓的一段）；
   夜 = 21:30 固定（苏州全年此刻都已过天文晨昏蒙影；灯会 / 流星的"切夜"也认这个数）。 */
export const ANCHOR_ALT = { morning: 10, dusk: 7 };
function crossTime(doy, target, h0, h1, site){
  /* 在 [h0,h1] 上二分找 alt = target；alt 在区间内单调（上午升、下午降）。 */
  let a = h0, b = h1;
  const fa = solarPos(doy, a, site).alt - target;
  for (let i = 0; i < 40; i++){
    const m = (a + b) / 2, fm = solarPos(doy, m, site).alt - target;
    if ((fm > 0) === (fa > 0)) a = m; else b = m;
  }
  return (a + b) / 2;
}
export function timeAnchorsFor(doy, site = SITE){
  const st = sunTimes(doy, site);
  return {
    morning: crossTime(doy, ANCHOR_ALT.morning, st.sunrise - 0.5, st.noon, site),
    noon: st.noon + 0.5,
    dusk: crossTime(doy, ANCHOR_ALT.dusk, st.noon, st.sunset + 0.5, site),
    night: 21.5,
  };
}

/* ── 月相 ──
   月龄分数 age ∈ [0,1)：0 朔、0.25 上弦、0.5 望、0.75 下弦。参考朔：2000-01-06 18:14 UTC（JD 2451550.26），
   朔望月 29.530588853 天。取当天 20:00 的月龄（一夜之内月相不变，流转时不会边走边换相）。 */
const SYNODIC = 29.530588853, NEW_MOON_JD = 2451550.26;
function jdOf(year, doy, hourLocal, tz){
  // 公历年初 JD：2000-01-01 0h UTC = 2451544.5，之后按平年 / 闰年累加（只用于 2000~2099）
  let jd = 2451544.5;
  for (let y = 2000; y < year; y++) jd += (y % 4 === 0) ? 366 : 365;
  return jd + (doy - 1) + (hourLocal - tz) / 24;
}
export function moonAge(doy, site = SITE){
  const days = jdOf(site.year, wrapDoy(doy), 20, site.tz) - NEW_MOON_JD;
  return ((days / SYNODIC) % 1 + 1) % 1;
}
/* 被照亮比例（0 朔 → 1 望）：sky shader 的 uMoonPhase 就是这个量（1 满月 / 0 无月）。 */
export const moonIllum = (age) => (1 - Math.cos(2 * Math.PI * age)) / 2;
/* 月出时刻：月亮每天比太阳晚约 24/29.5 小时 ⇒ 朔与日同升（6:00）、望在日落时升（18:00）。 */
export const moonRiseHour = (age) => (6 + 24 * age) % 24;

/* 两个单位向量的球面插值（光向交叉淡化用）：线性插值再归一化在两向量接近反向时会掠过零向量、
   方向乱甩 —— 黄昏太阳在西、月亮在东正是这种情况，所以用 slerp。 */
export function slerpDir(a, b, t){
  const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  if (t <= 0) return a.slice();
  if (t >= 1) return b.slice();
  if (d > 0.9995){
    const o = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const l = Math.hypot(o[0], o[1], o[2]) || 1;
    return [o[0] / l, o[1] / l, o[2] / l];
  }
  let w = Math.acos(d), bb = b;
  if (d < -0.9995){                               // 近反向：绕"天顶"走，别从地底下穿
    bb = [0, 1, 0]; w = Math.acos(clamp(a[1], -1, 1));
    t = Math.min(1, t * 2);
  }
  const s = Math.sin(w) || 1, ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
  const o = [a[0] * ka + bb[0] * kb, a[1] * ka + bb[1] * kb, a[2] * ka + bb[2] * kb];
  const l = Math.hypot(o[0], o[1], o[2]) || 1;
  return [o[0] / l, o[1] / l, o[2] / l];
}

/* ── 投影主光方向（2026-10-30 · 审查 M3/M4）──
   一盏 DirectionalLight 白天当太阳、夜里当月光替身。方向分两段**球面插值**，全程连续：
     ① 太阳（钳到地平线上 3°，不从地底下打光）→ 夜间兜底方向 NIGHT_DIR，权重 = 1 − 白天度 dayK；
     ② 再 → 月亮（钳到 ≈6.8° 以上，旧写法同口径），权重 = mw（月光接管度，applyEnv 里算的连续量）。
   旧写法 `if (mw > 0.01) 直接换成月向` 在 0.01 处整片换阴影方向；旧模式暮→夜线性插值让主光日落后反升。
   solar=false（?solar=0 旧模式）时跳过①，太阳方向原样（旧行为），只把②的硬切换成 slerp。
   纯函数：probe/env-solar-unit.mjs 逐 6 分钟扫一整天，锁"相邻两步夹角有上限、日落后主光不升高"。 */
export const NIGHT_DIR = (() => { const v = [-34, 52, -22], l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();
const SUN_MIN_Y = Math.sin(3 * D2R), MOON_MIN_Y = 8 / 68;
function liftTo(v, minY){
  const n = Math.hypot(v[0], v[1], v[2]) || 1, x = v[0] / n, y = v[1] / n, z = v[2] / n;
  if (y >= minY) return [x, y, z];
  const h = Math.hypot(x, z) || 1, k = Math.sqrt(Math.max(0, 1 - minY * minY));
  return [x / h * k, minY, z / h * k];
}
export function mainLightDir(sunTrue, dayK, moonDir, mw, solar = true){
  let d = solar ? slerpDir(liftTo(sunTrue, SUN_MIN_Y), NIGHT_DIR, 1 - clamp(dayK, 0, 1))
                : liftTo(sunTrue, -1);
  if (moonDir && mw > 0) d = slerpDir(d, liftTo(moonDir, MOON_MIN_Y), clamp(mw, 0, 1));
  return d;
}
