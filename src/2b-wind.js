// 2b-wind: from index.html inline 487..613
/* ⚠️ 这里**不能** `import { ENV } from './12-env.js'`：12-env 的模块顶层会 applyEnv()，
   而 applyEnv 要读本模块的 `gust` —— 若本模块反向 import 12-env 就成环，本模块先求值，
   12-env 的 body 会在 gust 初始化之前跑 → 启动期 TDZ（实测
   "Cannot access 'gust' before initialization"）。本模块只在**函数体**里用环境参数
   （updateWindForce），所以改从 00-config 的 ENV_REF 取当前环境（由 12-env 定义 ENV 后立即发布）。 */
import { ENV_REF } from './00-config.js';
import { WIND, willowOrigins } from './01-materials.js';
/* ══════════════════════════════════════════════════════════════
   风的三层调度（2026-09-18 重构 · 起因：用户"狂风里植物有非常明显的规律性旋转运动及轨迹"）
   ─────────────────────────────────────────────────────────────
   L1 风向：16 档离散方位（8 主 + 8 间，每档 22.5°），每 12~30s 换一次、2~4s 完成转向
   L2 风力：微风 / 中风 / 大风 / 台风 四档，每 5~10s 换一次、1.5s 过渡；天气决定可达区间
   L3 位移合成：在**风向坐标系**里做（见 addWind 里那段 shader）
   ⚠️ 为什么是"离散档位 + 保持时长"而不是逐帧连续随机：连续随机会让风每秒都在变向，
      枝叶来不及完成一次摆动就被反向 —— 眼睛看到的是高频抽搐的噪声，不是风。
      真实的风是**一段时间的稳定方向 + 偶尔转向**，所以档位必须保持足够久才读得出方向。
   ⚠️ 相位一律吃 windClock（累加钳制后的 dt），不吃墙钟 t：软渲染一帧 8.4s，
      吃墙钟会让调度器一帧跨过整个过渡段、枝叶相位每帧瞬移（真机 60fps 下两者等价）。
   ══════════════════════════════════════════════════════════════ */
export let windClock = 0;                         // 风的仿真时钟（累加 dt，不是墙钟）
/* ⚠️ 推进一步必须走这个函数，不能从别处 `windClock += dt`：拆模块后风钟由 11-loop 的
   渲染循环推进，而 11-loop 是**import** 本变量的 —— ESM 导入绑定只读，
   直接写会抛 "Assignment to constant variable"（原单体里 §2b 的 let 与 §11 的累加同处
   一个词法世界，所以能写）。读数（uniform / 相位）仍走 live binding，不受影响。 */
export function advanceWindClock(dt){ windClock += dt; return windClock; }
export const DIR_N = 16;                          // 16 档风向
export const DIR_STEP = Math.PI / 8;              // 22.5°
/* 约定：0 档 = 风吹向 −z，顺时针递增。向量取 (sin a, −cos a)：
   a=0 → (0,−1) 推向 −z；a=π/2 → (1,0) 推向 +x。 */
export const WIND_DIR = { tier: 0, angle: 0, from: 0, to: 0, t0: -99, dur: 0, nextAt: 4 };
export function updateWindDir(t){
  const d = WIND_DIR;
  if (t >= d.nextAt){
    /* 至少挪 1 档（挪 0 档 = 没换向，看起来像卡死）；顺/逆时针随机 */
    const step = 1 + ((Math.random() * (DIR_N - 1)) | 0);
    d.from = d.angle;
    d.to = d.angle + (Math.random() < 0.5 ? 1 : -1) * step * DIR_STEP;
    d.t0 = t;
    d.dur = 2 + Math.random() * 2;                    // 转向过渡 2~4s
    d.nextAt = t + d.dur + 12 + Math.random() * 18;   // 保持 12~30s（够看清这一阵风的方向）
  }
  const e = d.dur > 0 ? Math.min(1, Math.max(0, (t - d.t0) / d.dur)) : 1;
  const s = e * e * (3 - 2 * e);                      // smoothstep：起止都不顿
  d.angle = d.from + (d.to - d.from) * s;
  /* 档位号：静止态必然落在 22.5° 的整数倍上（from/to 都从 0 出发累加），供探针断言 */
  d.tier = ((Math.round(d.angle / DIR_STEP) % DIR_N) + DIR_N) % DIR_N;
  WIND.uWindVec.value.set(Math.sin(d.angle), -Math.cos(d.angle));
}

/* ── L2 · 风力档位 ── */
export const FORCE_TIERS = [
  { name: '微风', v: 0.18 },
  { name: '中风', v: 0.42 },
  { name: '大风', v: 0.70 },
  { name: '台风', v: 1.00 },
];
export const WIND_FORCE = { lo: 0, hi: 1, idx: 0, v: 0.18, from: 0.18, to: 0.18,
                     t0: -99, dur: 0, nextAt: 3, gain: 1 };
/* 天气决定**可达档位区间** —— 风和日丽里不该刮台风，狂风暴雨里最低也是中风 */
export function forceBand(wf){
  if (wf >= 2.5)  return [1, 3];    // 狂风暴雨（风雪同）：中风 ~ 台风，含"阵风间歇"
  if (wf >= 1.10) return [0, 2];    // 阴霾暗沉 / 银装素裹：微风 ~ 大风
  return [0, 1];                    // 风和日丽 / 薄雾烟霭：微风 ~ 中风
}
/* 天气总增益：把档位值压到天气该有的量级。
   windMul 1.0（晴天）→ 0.08、1.35（雪）→ 0.24、4.0（暴雨）→ 1.0。
   没有它，"微风档"在晴天也会让柳梢摆 30cm —— 档位是**相对**强度，天气才是绝对刻度。 */
export function windGain(wf){
  return Math.pow(Math.max(0, Math.min(1, (wf - 0.90) / 3.10)), 0.75);
}
/* 当前天气的风增益标度。走 ENV_REF（见文件头注释）—— 槽里放的是**参数集 ENV.cur**，
   所以这里读 `.windMul` 等价于旧写法 `ENV.cur.windMul`；未发布时退回 1（= 晴天刻度）。
   ⚠️ 这个兜底只能挡"还没发布"，挡不住"发布成了别的对象"（那会静默按晴天算）。 */
const windMulNow = () => (ENV_REF.cur && ENV_REF.cur.windMul) || 1;
export function updateWindForce(t){
  const f = WIND_FORCE;
  if (t >= f.nextAt){
    const band = forceBand(windMulNow());
    f.lo = band[0]; f.hi = band[1];
    const span = f.hi - f.lo + 1;
    let i = f.lo + ((Math.random() * span) | 0);
    if (span > 1 && i === f.idx) i = f.lo + ((i - f.lo + 1) % span);   // 必须换档，否则看不出切换
    f.from = f.v; f.idx = i; f.to = FORCE_TIERS[i].v;
    f.t0 = t; f.dur = 1.5;
    f.nextAt = t + f.dur + 5 + Math.random() * 5;      // 保持 5~10s
  }
  const e = f.dur > 0 ? Math.min(1, Math.max(0, (t - f.t0) / f.dur)) : 1;
  const s = e * e * (3 - 2 * e);
  f.v = f.from + (f.to - f.from) * s;
  f.gain = windGain(windMulNow());
}

/* 随机自然风：随机挑一棵柳树起风，间隔、时长、风力均随机。
   触发间隔刻意压在 30 秒以内（静默 3~20s + 持续 3~8s ≤ 28s），
   保证任何一次打开场景都能看到起风。
   它是**局部加分项**：L2 的档位风是全园均匀的底子，这一层给"风在走"的方向感。
   ⚠️ 阵风强度必须每帧由 updateWind 写进 uniform，不能只在 applyEnv 里写 ——
   applyEnv 只在 2.8 秒过渡期间被调用，过渡一结束就被 updateWind 每帧覆盖掉，
   实测底值从 2.2 掉到 0.153（只剩阵风残余），表现就是"狂风暴雨里一片叶子都不动"。 */
export const gust = { active: false, t0: 0, dur: 0, peak: 0, nextAt: 2, peakMul: 1 };
export function updateWind(t){
  /* L1 / L2 先跑：本帧的风向与风力档位必须先定下来，阵风才知道该叠在哪个底子上 */
  updateWindDir(t);
  updateWindForce(t);
  const g = gust;
  if (g.active){
    const e = t - g.t0;
    if (e >= g.dur){
      g.active = false;
      g.nextAt = t + 3 + Math.random() * 17;              // 静默 3~20 秒
    }
  } else if (t >= g.nextAt && willowOrigins.length){
    const o = willowOrigins[(Math.random() * willowOrigins.length) | 0];
    g.active = true;
    g.t0 = t;
    g.dur = 3.0 + Math.random() * 5.0;                    // 持续 3~8 秒
    g.peak = 0.70 + Math.random() * 0.40;                 // 常态风力
    WIND.uWindOrigin.value.set(o.x, o.y + 4.6, o.z);      // 风源取树冠高度
    WIND.uWindRadius.value = 24 + Math.random() * 14;    // 半径放大，让最近的竹林与池面也进风区
    WIND.uWindPhase.value = Math.random() * 10;
  }
  // 阵风分量：只在阵风进行中非零
  let gustVal = 0;
  if (g.active){
    const e = t - g.t0;
    const env = Math.sin(Math.PI * (e / g.dur));
    gustVal = g.peak * (g.peakMul || 1) * env * (0.82 + 0.18 * Math.sin(e * 2.7));
  }
  // 阵风单独写 uWindStrength；没有阵风时把风源推到哨兵位（wFall=0 → 该项自动为 0）
  WIND.uWindStrength.value = gustVal;
  if (!g.active) WIND.uWindOrigin.value.set(0, -999, 0);
  /* 底值风 = L2 档位值 × 天气增益。它是**全园均匀**的（写 uWindGlobal，不乘距离衰减），
     量级反算：ampEff = amp * wt * (0.16 + 2.8 * gust)。暴雨 + 台风档 → gust ≈1.0，
     mult ≈2.96，柳条 0.14×1.6×2.96 ≈ 0.66m（与改造前峰值同量级）；
     暴雨 + 微风档 → 0.15，mult ≈0.58，柳条 ≈0.13m —— 两档之间约 5 倍差距，
     观众能明确感到"风突然小了"（这正是用户要的档位可感）。
     ⚠️ 阵风"全局尾巴"（2026-09-17 用户："其它树被风吹得快散架了，荷花荷叶一动不动"）：
     阵风强度单写 uWindStrength 时会按到风源（柳树）的距离平方衰减 ——
     池面/荷花常落在衰减区外，wFall≈0，于是同框里柳枝疯摆而池面纹丝不动。
     给 uWindGlobal 补一阵风尾巴（不乘衰减、全园均匀），量级压在峰值的 15%：
     池面摇曳、竹林轻摆，但主摆动仍在风源附近，风还是"在走"的。 */
  WIND.uWindGlobal.value = WIND_FORCE.v * WIND_FORCE.gain + gustVal * 0.15;
}