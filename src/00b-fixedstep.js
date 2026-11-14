// 00b-fixedstep：固定步长累加器的步数计算（**纯函数，零 DOM、零 three**，2026-10-31 · B3）
//
// ── 为什么单独成文件 ──────────────────────────────────────────────────────
// 11-loop.js 的 stepSim 顶层挂着整条渲染链，node 里无法单测；而"每帧推几步"恰恰是
// 错了也不报错的那类（抖动 0/2 步交替、长帧雪崩、高刷屏加速），只有真机才现形。
// 这里只放**算步数**：输入（累加器余量、真实帧间隔）→ 输出（步数、新余量、丢弃量）。
// 推进仿真时钟、风钟仍在 11-loop.js（与旧接口 stepSim/simClock/simState 保持兼容）。
//
// ── 三条规则 ───────────────────────────────────────────────────────────
// ① 固定步长 dt = 1/60：仿真只按整步推进，余量留在累加器里给下一帧。
// ② 每帧最多补 maxFrame = 100ms（= 6 步）：超出部分**直接丢弃**（累加器清零），
//    防"死亡螺旋"——切回标签页/断点之后一帧补几百步，越补越慢。
// ③ 吸附容差 snap = 0.25 步：累加量离下一个整步只差 ≤ 0.25 步时提前走这一步，
//    余量记成负数还账。60Hz 下 rAF 间隔在 16.0/17.3ms 之间抖动时，没有容差就会
//    出现"这帧 0 步、下帧 2 步"交替（画面一顿一跳）；有容差则稳定每帧 1 步，
//    长期总量不变（负余量下一帧扣回来）。

export const FIXED_STEP = Object.freeze({ dt: 1 / 60, maxFrame: 0.1, snap: 0.25 });

/** 每帧最多步数（由 maxFrame / dt 取整；默认 6）。 */
export function maxStepsFor(opt = FIXED_STEP){
  const dt = opt.dt ?? FIXED_STEP.dt, maxFrame = opt.maxFrame ?? FIXED_STEP.maxFrame;
  return Math.max(1, Math.round(maxFrame / dt));
}

/** 算本帧步数。
    @param {number} accum  上一帧留下的余量（秒，可为负：吸附提前走的那一点）
    @param {number} rawDt  真实帧间隔（秒）；非有限值/负值按 0
    @returns {{steps:number, accum:number, dropped:number}}
             steps   本帧推进的整步数（0..maxSteps）
             accum   新余量（秒），落在 [-snap·dt, (1-snap)·dt) 内
             dropped 因上限被丢弃的秒数（≥0） */
export function planFixedSteps(accum, rawDt, opt = FIXED_STEP){
  const dt = opt.dt ?? FIXED_STEP.dt;
  const snap = opt.snap ?? FIXED_STEP.snap;
  const maxSteps = maxStepsFor(opt);
  const add = Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;
  const a = (Number.isFinite(accum) ? accum : 0) + add;
  let steps = Math.floor(a / dt + snap);
  if (steps < 0) steps = 0;
  if (steps > maxSteps){
    return { steps: maxSteps, accum: 0, dropped: a - maxSteps * dt };
  }
  return { steps, accum: a - steps * dt, dropped: 0 };
}
