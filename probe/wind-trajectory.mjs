// 风场位移轨迹分析（纯数学，不起浏览器，<1s）—— L3 位移合成的门禁
//
// 为什么要有它：用户反馈"狂风里植物有非常明显的规律性旋转运动及轨迹"。
// 这是**位移合成公式的结构问题**，不是调参能解决的 —— 所以要先把它量出来：
//   · 走向比 cross/along —— 这是**风向坐标系**下的横向/沿向摆幅比。
//     接近 1 → 轨迹是个"环"（眼睛读作在打转）；远小于 1 → 是"细长条"（来回摆）。
//   · 净转圈/秒 + 方向一致率 —— 轨迹绕质心的方位角是否**单向累加**。
//     一致率 ≈0.50 / 净转圈 ≈0 → 来回摆（自然）；≈1.00 / 明显为正 → 一直在绕圈。
//
// 旧公式的病根（2026-09-18 实测）：
//   · 主摆动 x 与 z 各跑不同频率的正弦、再叠每株自己的慢变风向 aDir → 合成胖椭圆，Z/X 0.47
//   · 高频抖振用 6.3 / 7.1 rad/s（只差 13%）两个近频正交分量 → **每秒一圈**的快速小圈，Z/X 0.75
// 新公式把位移搬进风向坐标系：沿风向 1.00、横向 0.16（抖振横向 0.26 倍于沿向）。
//
// ⚠️ 系数**镜像自** index.html 的 addWind() shader 块。改位移合成时必须同步这里，
//    否则门禁会守着一个已经不存在的公式（假绿）。双向核对：这里的常量应与
//    index.html 里 `float cross = ... * ampEff * 0.16` 与横向抖振 `... * ampEff * tremble * 0.26` 等处逐字一致。
//
// 用法: node probe/wind-trajectory.mjs
const TAU = Math.PI * 2;

/* ── 新公式（镜像自 index.html，2026-09-18 三层改造后）── */
const NEW = {
  crossMain:  0.16,   // 横向主分量（相对沿向）
  crossTr:    0.26,   // 横向抖振分量（相对沿向抖振）—— 必须与 index.html 的 flutter*0.26 一致
  alongTrF:   6.3,    // 沿向抖振频率 rad/s
  crossTrF:   4.1,    // 横向抖振频率 rad/s（与 6.3 差 54%，不是近频）
  alongMod:   0.14,   // 沿向正弦的慢调制幅度
  alongModF:  0.37,
  gustTr:     0.55,   // 抖振里阵风的权重（另一部分是 uRain*0.85）
  rainTr:     0.85,
};
/* ── 旧公式（只用于对照，证明改造有效；不再进任何门禁）── */
const OLD = {
  dx2FreqMul: 0.44, dx2AmpMul: 0.34, dzFreqMul: 0.67, dzAmpMul: 0.62,
  dirAmp: 0.6, dirFreq: 0.31, trFreqX: 6.3, trFreqZ: 7.1, trAmpX: 0.8, trAmpZ: 0.6,
};

const hash21 = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123; return s - Math.floor(s); };
const ampEffOf = (amp, wt, gust) => amp * wt * (0.16 + 2.8 * gust);

/* 新公式：返回风向坐标系里的 (along, cross) */
function dispAC(amp, speed, wt, gust, rain, h1, flutter, t){
  const ampEff = ampEffOf(amp, wt, gust);
  const hx = h1 * 6.28 + 0.37, hz = h1 * 5.1 + 0.91;
  let along = Math.sin(t * speed + hx) * ampEff
            * (0.86 + NEW.alongMod * Math.sin(t * NEW.alongModF + h1 * 2.1));
  let cross = Math.cos(t * speed * 0.61 + hz) * ampEff * NEW.crossMain;
  const tremble = gust * NEW.gustTr + rain * NEW.rainTr;
  along += Math.sin(t * NEW.alongTrF + hx * 2.3) * ampEff * tremble * flutter;
  cross += Math.cos(t * NEW.crossTrF + hz * 1.9) * ampEff * tremble * flutter * NEW.crossTr;
  return [along, cross];
}
/* 旧公式：返回世界 (dx, dz) */
function dispOld(amp, speed, wt, gust, rain, h1, t){
  const ampEff = ampEffOf(amp, wt, gust);
  const hx = h1 * 6.28 + 0.37, hz = h1 * 5.1 + 0.91;
  const aDir = OLD.dirAmp * Math.sin(t * OLD.dirFreq + h1 * 3.5);
  let dx = Math.sin(t * speed + hx) * ampEff * Math.cos(aDir)
         + Math.cos(t * speed * OLD.dx2FreqMul + hz * 1.3) * ampEff * OLD.dx2AmpMul;
  let dz = Math.cos(t * speed * OLD.dzFreqMul + hz) * ampEff * OLD.dzAmpMul * Math.sin(aDir);
  const tremble = gust + rain * 0.85;
  dx += Math.sin(t * OLD.trFreqX + hx * 2.3) * ampEff * tremble * OLD.trAmpX;
  dz += Math.cos(t * OLD.trFreqZ + hz * 1.9) * ampEff * tremble * OLD.trAmpZ;
  return [dx, dz];
}

/* ── 轨迹指标 ──
   入参 pts 是 (u, v) 平面上的点序列，u/v 既可以是"风向坐标系的沿/横"，
   也可以是"世界的 x/z" —— 指标本身与坐标系无关，是绕质心的方位角统计。 */
function metrics(pts){
  const N = pts.length;
  const us = pts.map(p => p[0]), vs = pts.map(p => p[1]);
  const umin = Math.min(...us), umax = Math.max(...us);
  const vmin = Math.min(...vs), vmax = Math.max(...vs);
  const ampU = (umax - umin) / 2, ampV = (vmax - vmin) / 2;
  const cu = us.reduce((a, b) => a + b, 0) / N, cv = vs.reduce((a, b) => a + b, 0) / N;
  const rad = pts.map(p => Math.hypot(p[0] - cu, p[1] - cv));
  const mr = rad.reduce((a, b) => a + b, 0) / N;
  const sd = Math.sqrt(rad.reduce((a, r) => a + (r - mr) ** 2, 0) / N);
  // 绕质心方位角：是否单向累加
  let prev = Math.atan2(pts[0][1] - cv, pts[0][0] - cu), sweep = 0, same = 0, n = 0;
  for (let i = 1; i < N; i++){
    const a = Math.atan2(pts[i][1] - cv, pts[i][0] - cu);
    let d = a - prev; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 1e-9){ if (Math.sign(d) === Math.sign(sweep || d)) same++; n++; }
    sweep += d; prev = a;
  }
  return {
    ampU, ampV,
    ratio: ampU > 0 ? ampV / ampU : 0,      // 走向比（横/沿）：小 = 细长条
    ringCV: mr > 0 ? sd / mr : 0,           // 环形度：小 = 像圆环
    netRevPerSec: sweep / TAU / (N / 60),   // 净转圈/秒（恒定帧率 60Hz 采样）
    signConsist: n ? same / n : 0,          // 单向一致率：0.5=来回摆
    meanRadius: mr,
  };
}
const sample = (fn, win) => {
  const hz = 1 / 60, N = Math.round(win / hz), out = [];
  for (let i = 0; i < N; i++) out.push(fn(i * hz));
  return out;
};

/* 风场表（镜像自 addWind 调用点；wt 取该材质在暴风下的典型权重） */
const TABLE = [
  { name: '竹叶 MAT.leaf',        amp: 0.13,  speed: 1.35, wt: 0.9,  flutter: 1.00 },
  { name: '柳条 MAT.willow',      amp: 0.14,  speed: 0.95, wt: 1.6,  flutter: 1.00 },
  { name: '柳叶帘 MAT.willowLeaf',amp: 0.07,  speed: 0.95, wt: 1.6,  flutter: 1.00 },
  { name: '紫藤花穗 MAT.wisteria',amp: 0.05,  speed: 1.15, wt: 1.0,  flutter: 1.00 },
  { name: '芭蕉假茎 MAT.banana',  amp: 0.025, speed: 0.95, wt: 1.6,  flutter: 0.30 },
  { name: '芭蕉叶 GLB',           amp: 0.05,  speed: 1.05, wt: 1.52, flutter: 1.00 },
  { name: '水草 MAT.reed',        amp: 0.15,  speed: 1.10, wt: 0.9,  flutter: 1.00 },
];
const GUST = 0.86, RAIN = 0.8;      // 暴雨 + 台风档 + 暴雨的典型值（暴雨 windMul=4.0 → gust≈1.0）

/* 门禁阈值：实测旧公式（世界轴口径）走向比 0.47、抖振通道 0.75、净转圈最高 +1.06 圈/秒。
   新公式必须显著低于旧值才说明"打转"被真正治掉，而不是被调参掩盖。 */
const LIM = { ratio: 0.30, netRev: 0.12, signConsist: 0.66, trembleRatio: 0.35 };

const rows = [];
console.log(`暴雨 + 台风档（gust=${GUST}, rain=${RAIN}）下的叶尖轨迹\n`);
console.log('  ── 世界轴口径（x/z，与用户肉眼看到的一致）──');
console.log('  材质                      新旧  摆幅X    摆幅Z   走向比  净转圈/s  方向一致率');
console.log('  ' + '─'.repeat(78));
for (const e of TABLE){
  const hs = Array.from({ length: 8 }, (_, i) => hash21(i * 1.7, 3.1));
  const agg = (fn) => {
    const rs = hs.map(h => metrics(sample(t => fn(h, t), 40)));
    const m = k => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    return { ratio: m('ratio'), netRev: m('netRevPerSec'), signConsist: m('signConsist'),
             ampX: m('ampU'), ampZ: m('ampV') };      // 半幅（±X cm），与"摆幅"的日常说法一致
  };
  const o = agg((h, t) => dispOld(e.amp, e.speed, e.wt, GUST, RAIN, h, t));
  const nw = agg((h, t) => dispAC(e.amp, e.speed, e.wt, GUST, RAIN, h, e.flutter, t));
  const line = (tag, r) => '  ' + (tag === '旧' ? e.name.padEnd(24) : ''.padEnd(24)) + tag.padEnd(4) +
    ('±' + (r.ampX * 100).toFixed(1)).padStart(7) + 'cm' + ('±' + (r.ampZ * 100).toFixed(1)).padStart(8) + 'cm' +
    r.ratio.toFixed(2).padStart(7) + r.netRev.toFixed(2).padStart(10) + r.signConsist.toFixed(2).padStart(11);
  console.log(line('旧', o));
  console.log(line('新', nw));
  rows.push({ name: e.name, o, n: nw });
}

/* 只保留高频抖振通道 —— 旧版这里是最刺眼的"每秒一圈" */
function trembleOnly(e, isNew){
  const hz = 1 / 60, win = 12, N = Math.round(win / hz);
  const hs = Array.from({ length: 8 }, (_, i) => hash21(i * 1.7, 3.1));
  const per = hs.map(h => {
    const ampEff = ampEffOf(e.amp, e.wt, GUST), hx = h * 6.28 + 0.37, hz2 = h * 5.1 + 0.91;
    const tr = GUST * (isNew ? NEW.gustTr : 1) + RAIN * (isNew ? NEW.rainTr : 0.85);
    const P = [];
    for (let i = 0; i < N; i++){
      const t = i * hz;
      P.push(isNew
        ? [Math.sin(t * NEW.alongTrF + hx * 2.3) * ampEff * tr * e.flutter,
           Math.cos(t * NEW.crossTrF + hz2 * 1.9) * ampEff * tr * e.flutter * NEW.crossTr]
        : [Math.sin(t * OLD.trFreqX + hx * 2.3) * ampEff * tr * OLD.trAmpX,
           Math.cos(t * OLD.trFreqZ + hz2 * 1.9) * ampEff * tr * OLD.trAmpZ]);
    }
    return metrics(P);
  });
  const m = k => per.reduce((a, r) => a + r[k], 0) / per.length;
  return { ratio: m('ratio'), netRev: m('netRevPerSec'), signConsist: m('signConsist') };
}
console.log('\n  ── 只看高频抖振通道（暴雨里最显眼的那一层）──');
console.log('  净转圈/s 与方向一致率在这里最能说明"打转"是否消失');
console.log('  材质                     旧走向比 新走向比   旧净转圈  新净转圈  旧一致率 新一致率');
console.log('  ' + '─'.repeat(78));
const tremble = [];
for (const e of TABLE){
  const o = trembleOnly(e, false), nw = trembleOnly(e, true);
  console.log('  ' + e.name.padEnd(24) +
    o.ratio.toFixed(2).padStart(6) + nw.ratio.toFixed(2).padStart(9) +
    o.netRev.toFixed(2).padStart(11) + nw.netRev.toFixed(2).padStart(10) +
    o.signConsist.toFixed(2).padStart(9) + nw.signConsist.toFixed(2).padStart(9));
  tremble.push({ name: e.name, o, n: nw });
}

/* ── 门禁判据 ──
   ⚠️ 判的是**新公式**是否"像细长条地来回摆"，而不是"比旧公式好一点" ——
   后者会被一次无害的调参蒙混过去（旧值本身就是错的）。 */
const checks = [];
const ck = (name, ok, detail) => { checks.push({ name, ok, detail }); };

const worstRatio = rows.reduce((a, r) => Math.max(a, r.n.ratio), 0);
ck('L3：全材质世界轴走向比 ≤0.30（轨迹是细长条，不是椭圆）', worstRatio <= LIM.ratio,
   `最差 ${worstRatio.toFixed(2)}（旧公式均 0.47、抖振 0.75）`);
const worstRev = rows.reduce((a, r) => Math.max(a, Math.abs(r.n.netRev)), 0);
ck('L3：全材质无净转圈（|净转圈/s| ≤0.12）', worstRev <= LIM.netRev,
   `最差 ${worstRev.toFixed(3)} 圈/s`);
const worstConsist = rows.reduce((a, r) => Math.max(a, r.n.signConsist), 0);
ck('L3：方向一致率 ≤0.66（来回摆而非单向绕圈）', worstConsist <= LIM.signConsist,
   `最差 ${worstConsist.toFixed(2)}（0.5=完美来回摆）`);
const worstTrRatio = tremble.reduce((a, r) => Math.max(a, r.n.ratio), 0);
ck('L3：抖振通道走向比 ≤0.35（"每秒一圈"的快速小圈已消除）', worstTrRatio <= LIM.trembleRatio,
   `最差 ${worstTrRatio.toFixed(2)}（旧 0.75）`);
const worstTrRev = tremble.reduce((a, r) => Math.max(a, Math.abs(r.n.netRev)), 0);
ck('L3：抖振通道 |净转圈/s| ≤0.12', worstTrRev <= LIM.netRev, `最差 ${worstTrRev.toFixed(3)}`);
const worstOldRatio = rows.reduce((a, r) => Math.max(a, r.o.ratio), 0);
const worstOldTrRatio = tremble.reduce((a, r) => Math.max(a, r.o.ratio), 0);
/* ⚠️ 判据必须用**走向比**，不能用"净转圈"来验旧公式：
   旧抖振的 6.3 / 7.1 rad/s 是近频对，合成椭圆会以 Δω=0.8 rad/s 的节拍**进动**，
   在 ≥8 秒的窗口上正负相消 —— 净转圈读数接近 0，看着像"没问题"。
   但它每一瞬间都在以 ~1 圈/秒 绕质心转，眼睛看到的就是打转。
   能抓住这件事的只有**形状指标**（走向比）与**单向一致率**，不是净值。 */
ck('对照：旧公式确实是"椭圆"而非细长条（回归基线，防止对照被悄悄改掉）',
   worstOldRatio >= 0.40 && worstOldTrRatio >= 0.60,
   `旧公式走向比 ${worstOldRatio.toFixed(2)}／抖振通道 ${worstOldTrRatio.toFixed(2)}`);

console.log('\n  ── 门禁 ──');
for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
const fails = checks.filter(c => !c.ok).length;
console.log(`\n[wind-trajectory] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${checks.length} 项）`);
process.exit(fails === 0 ? 0 : 1);
