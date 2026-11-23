// 固定步长累加器纯函数单测：node --test probe/fixed-step-unit.mjs（已登记进 npm run unit）
// 被测：src/00b-fixedstep.js planFixedSteps —— 11-loop.js 的 stepSim 只是它的薄壳。
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_STEP, planFixedSteps, maxStepsFor, FIXED_STEP_POLICY, tickBySteps } from '../src/00b-fixedstep.js';

const DT = FIXED_STEP.dt;
/* 按给定帧间隔序列跑累加器，返回每帧步数与总仿真秒数 */
function run(frames){
  let accum = 0, sim = 0, dropped = 0;
  const steps = [];
  for (const raw of frames){
    const p = planFixedSteps(accum, raw);
    accum = p.accum; dropped += p.dropped; sim += p.steps * DT;
    steps.push(p.steps);
  }
  return { steps, sim, accum, dropped, real: frames.reduce((a, b) => a + b, 0) };
}

test('上限：每帧最多 100ms = 6 步', () => {
  assert.equal(maxStepsFor(), 6);
});

test('60Hz：每帧恰 1 步，仿真时长 = 真实时长', () => {
  const r = run(Array(600).fill(1 / 60));
  assert.ok(r.steps.every(n => n === 1), '应每帧 1 步');
  assert.ok(Math.abs(r.sim - r.real) < DT);
});

test('120Hz：0/1 步交替，平均每帧半步，仿真不加速', () => {
  const r = run(Array(1200).fill(1 / 120));
  assert.ok(r.steps.every(n => n === 0 || n === 1));
  assert.equal(r.steps.filter(n => n === 1).length, 600);
  assert.ok(Math.abs(r.sim - r.real) < DT);
});

test('30Hz：每帧 2 步，仿真按真实秒推进（不随帧率变慢）', () => {
  const r = run(Array(300).fill(1 / 30));
  assert.ok(r.steps.every(n => n === 2));
  assert.ok(Math.abs(r.sim - 10) < DT);
});

test('长帧丢弃：1s 一帧只推 100ms，余量清零，不死亡螺旋', () => {
  const p = planFixedSteps(0, 1.0);
  assert.equal(p.steps, 6);
  assert.equal(p.accum, 0);
  assert.ok(Math.abs(p.dropped - 0.9) < 1e-9);
  /* 下一帧恢复正常 60Hz：只走 1 步，不补上一帧丢掉的 0.9s */
  assert.equal(planFixedSteps(p.accum, 1 / 60).steps, 1);
  /* 持续 10fps（100ms/帧）恰在上限内：不丢弃，仿真仍按真实秒走（fixed-timestep-guard 同口径） */
  const r = run(Array(30).fill(0.1));
  assert.ok(Math.abs(r.sim - 3.0) < 0.15, `sim=${r.sim}`);
  assert.ok(r.dropped < 1e-9);
});

test('抖动吸附：60Hz ±2ms 抖动不出现 0 步 / 2 步交替', () => {
  /* rAF 实测常见形态：14.7/18.7ms 交替（均值仍是 1/60）。无容差时 14.7ms 那帧会 0 步、下一帧 2 步。 */
  const frames = [];
  for (let i = 0; i < 600; i++) frames.push(1 / 60 + (i % 2 ? 0.002 : -0.002));
  const r = run(frames);
  assert.ok(r.steps.every(n => n === 1), `出现非 1 步：${[...new Set(r.steps)]}`);
  assert.ok(Math.abs(r.sim - r.real) < DT, '长期总量不漂移');
  /* 对照：去掉容差就会抖 —— 证明是容差在起作用，而不是用例本身太宽 */
  let accum = 0; const raw = [];
  for (const f of frames){ const p = planFixedSteps(accum, f, { ...FIXED_STEP, snap: 0 }); accum = p.accum; raw.push(p.steps); }
  assert.ok(raw.includes(0) && raw.includes(2), '无容差时应出现 0/2 步交替');
});

test('吸附余量有界：负余量不超过 0.25 步，非法输入按 0', () => {
  const p = planFixedSteps(0, DT * 0.8);
  assert.equal(p.steps, 1);
  assert.ok(p.accum < 0 && p.accum >= -0.25 * DT - 1e-12);
  assert.deepEqual(planFixedSteps(0, NaN), { steps: 0, accum: 0, dropped: 0 });
  assert.deepEqual(planFixedSteps(0, -1), { steps: 0, accum: 0, dropped: 0 });
});

/* 第 5 批：人物更新的步进策略（00b tickBySteps，11-loop 用它调 tickActors） */
test('步进策略：默认关 = 每帧一次 tick(步数×dt)；开 = 每步一次 tick(dt)；上限仍是每帧 6 步', () => {
  assert.equal(FIXED_STEP_POLICY.perStep, false, '默认必须关（保持现状，Kyle 决定是否打开）');
  const calls = [];
  const tick = d => calls.push(d);
  tickBySteps(3, tick);
  assert.deepEqual(calls, [3 * DT], '关：一次，参数与原 tickActors(dt) 的 dt（steps×FIXED_DT）逐位相同');
  calls.length = 0; tickBySteps(0, tick);
  assert.deepEqual(calls, [0], '关：0 步也照旧调一次 tick(0)');
  calls.length = 0; tickBySteps(3, tick, { perStep: true });
  assert.deepEqual(calls, [DT, DT, DT], '开：每步一调');
  calls.length = 0; tickBySteps(0, tick, { perStep: true });
  assert.deepEqual(calls, [], '开：0 步不调');
  /* 长帧（切回标签页）：步数先被 planFixedSteps 截到 6 ⇒ 开启口径最多 6 次 */
  const p = planFixedSteps(0, 5.0);
  calls.length = 0; tickBySteps(p.steps, tick, { perStep: true });
  assert.equal(calls.length, maxStepsFor(), '每帧最多补 100ms');
});
