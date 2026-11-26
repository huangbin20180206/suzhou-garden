// 仿真每帧耗时 / 分配微基准（2026-11-24 · 第 5 批 · 执行效率）。纯 node，不起浏览器；**不进 verify**，只作参考。
// 运行：node probe/perf-sim-bench.mjs [--json]
//   ④ actor 稳态（2026-11-26）：空跑两场半后再量，见 --warm 注释。
//   ③ 另有按真实帧驱动的人物段（FRAME_RAW 抖动序列）：perStep 开 / 关各跑一遍，对比掉帧时每帧人物耗时。
//
// 两段：
//   ① actor：probe/_actor-sim 的到访导演层（产品默认 carriage-walkback，礼仪 + 走回去），
//      按 60Hz 游戏帧逐帧 tickActors(1/60) 跑完整一场；每帧计时，另用计数版 vendor（register-count.mjs）
//      数 THREE 数学类的 new / clone()，用 heapUsed 增量（段内无 GC 才计）估每帧堆分配字节。
//   ② env：12a-presets 的纯函数链（applyEnv 之外、node 可跑的那部分）：
//      · reel  = 时光流转 0.4 时/秒每帧取目标参数集（旧口径：每帧 composeEnv(baseParamsAt(h))；
//                新口径：reelSampler 关键帧 + mixInto，见 12a）+ 写回 cur + fxGates/natureGates；
//      · steady = 稳态每帧：余韵推进 + 地表三项（lingerEff / airHumidity / aerialFromHumidity）+ 门控。
// 数字只在同一台机器上前后对比有意义；node 的 JIT 与浏览器不同，绝对值不代表真机帧时间。
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const pct = (arr, q) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const fmt = (ms) => (ms * 1000).toFixed(1) + 'µs';

/* ── 子进程：actor 段（模式在模块求值期读 location ⇒ 单独进程） ── */
if (process.argv[2] === '--actor-child'){
  const { loadSim, runVisit } = await import('./_actor-sim/sim.mjs');
  const A = await loadSim('carriage-walkback');
  console.warn = () => {}; const log = console.log; console.log = () => {};
  await runVisit(A, { maxSteps: 1 });
  const ALLOC = globalThis.__ALLOC;
  let gcs = 0; new PerformanceObserver(l => { gcs += l.getEntries().length; }).observe({ entryTypes: ['gc'] });
  /* 热身 600 帧（JIT），不计 */
  for (let i = 0; i < 600; i++) A.tickActors(1 / 60);
  /* --driver=legacy|perstep：按真实帧（sim.mjs FRAME_RAW 抖动序列，平均 ≈2.5 步/帧）计每帧人物耗时 ——
     看 FIXED_STEP_POLICY.perStep 在掉帧机器上多花多少（每步一调 = 一帧多次 advance）。 */
  const drv = process.argv.find(a => a.startsWith('--driver='));
  if (drv){
    const perStep = drv.endsWith('perstep');
    const FS = await import('../src/00b-fixedstep.js');
    const { FRAME_RAW } = await import('./_actor-sim/sim.mjs');
    const tick = (d) => A.tickActors(d), pol = { perStep };
    let accum = 0, steps = 0; const tt = [];
    for (let f = 0; f < 9000 && !(A.VISIT.phase === 'done' && f > 1200); f++){
      const plan = FS.planFixedSteps(accum, FRAME_RAW[f % FRAME_RAW.length]); accum = plan.accum;
      const t0 = performance.now(); FS.tickBySteps(plan.steps, tick, pol); tt.push(performance.now() - t0);
      steps += plan.steps;
    }
    log(JSON.stringify({ frames: tt.length, med: pct(tt, 0.5), p95: pct(tt, 0.95), stepsPerFrame: steps / tt.length }));
    process.exit(0);
  }
  /* --warm（2026-11-26 · 执行效率批）：先空跑 50000 帧（≈两场半，V8 对 advance 的反优化/重编在头一两场里
     收敛），再连续量 20000 帧，不按 done 截断。头一场的数字被"重编期间退回解释执行"的那几千帧主导
     （node 里一帧 ~0.1ms，一次 170ms 的后台重编就是上千帧装箱），浏览器 60Hz 下同样一次重编只占十来帧
     —— 稳态这组才接近真机长时间运行的样子。 */
  const WARM = process.argv.includes('--warm');
  if (WARM) for (let i = 0; i < 50000; i++) A.tickActors(1 / 60);
  /* 两遍分开跑（同一份确定性仿真）：计时遍不量堆（计时本身会分配），量堆遍不计时。 */
  const HEAP = process.argv.includes('--heap');
  const times = []; let bytes = 0, bFrames = 0, frames = 0;
  ALLOC.ctor = 0; ALLOC.clone = 0; ALLOC.on = true;
  const CH = 30, now = () => performance.now();
  while (WARM ? frames < 20000 : (frames < 60 * 60 * 8 && !(A.VISIT.phase === 'done' && frames > 1200))){
    const g0 = gcs, h0 = HEAP ? process.memoryUsage().heapUsed : 0;
    for (let i = 0; i < CH; i++){
      if (HEAP){ A.tickActors(1 / 60); continue; }
      const t0 = now(); A.tickActors(1 / 60); times.push(now() - t0);
    }
    frames += CH;
    if (HEAP){
      const h1 = process.memoryUsage().heapUsed;
      await new Promise(r => setImmediate(r));
      if (gcs === g0 && h1 >= h0){ bytes += h1 - h0; bFrames += CH; }
    }
  }
  ALLOC.on = false;
  log(JSON.stringify(HEAP ? { frames, ctor: ALLOC.ctor / frames, clone: ALLOC.clone / frames, bytes: bFrames ? bytes / bFrames : null, bFrames }
                          : { frames, med: pct(times, 0.5), p95: pct(times, 0.95) }));
  process.exit(0);
}

/* ── ② env 段（本进程） ── */
async function envBench(){
  const P = await import(pathToFileURL(path.join(ROOT, 'src/12a-presets.js')).href);
  const { SEASON_DOY } = await import(pathToFileURL(path.join(ROOT, 'src/12g-phenology.js')).href);
  const ENV = { season: 'spring', weather: 'clear', doy: SEASON_DOY.spring, festival: false, moonPhase: null, hour: 6 };
  P.bindPresetsEnv(ENV);
  const cur = P.cloneParams(P.composeEnv(P.baseParamsAt(ENV.hour)));
  const gOut = {};
  const gates = (p) => { P.fxGates(p); P.natureGates.length >= 4 ? P.natureGates(p, ENV.season, ENV.weather, gOut) : P.natureGates(p, ENV.season, ENV.weather); };
  function run(label, frameFn, N = 3600){
    for (let i = 0; i < 300; i++) frameFn();             // 热身
    const times = []; let bytes = 0, bf = 0;
    for (let c = 0; c < N / 30; c++){
      const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 30; i++){ const t0 = performance.now(); frameFn(); times.push(performance.now() - t0); }
      const h1 = process.memoryUsage().heapUsed;
      if (h1 >= h0){ bytes += h1 - h0; bf += 30; }
    }
    return { label, med: pct(times, 0.5), p95: pct(times, 0.95), bytes: bf ? bytes / bf : null };
  }
  const out = [];
  /* reel · 旧口径（每帧重合成） */
  ENV.hour = 6;
  out.push(run('reel·每帧重合成', () => {
    ENV.hour = (ENV.hour + 0.4 / 60) % 24;
    const t = P.composeEnv(P.baseParamsAt(ENV.hour));
    P.mixInto(cur, t, t, 1); gates(cur);
  }));
  /* reel · 现口径（有 reelSampler 才测） */
  if (P.makeReelSampler){
    const S = P.makeReelSampler();
    ENV.hour = 6;
    out.push(run('reel·关键帧插值', () => {
      ENV.hour = (ENV.hour + 0.4 / 60) % 24;
      const t = S.sample(ENV.hour);
      P.mixInto(cur, t, t, 1); gates(cur);
    }));
  }
  /* steady：余韵 + 地表 + 门控（旧：每帧全算；新：surfaceDirty 判据挡住不变帧，见 12-env tickLinger） */
  const L = P.lingerInit(cur);
  out.push(run('steady·每帧全算', () => {
    P.lingerStep(L, cur, 1 / 60, 0);
    const e = P.lingerEff(L, cur); const air = P.aerialFromHumidity(P.airHumidity(cur, e.wetExcess), cur.dayK ?? 1);
    void ({ ...e, air }); gates(cur);
  }));
  if (P.SurfaceGate){
    const G = new P.SurfaceGate();
    out.push(run('steady·变化才算', () => {
      P.lingerStep(L, cur, 1 / 60, 0);
      if (G.dirty(L, cur)){ const e = P.lingerEff(L, cur); P.aerialFromHumidity(P.airHumidity(cur, e.wetExcess), cur.dayK ?? 1); }
      gates(cur);
    }));
  }
  return out;
}

const actorRun = (...extra) => JSON.parse(execFileSync(process.execPath,
  ['--max-semi-space-size=64', '--import', './probe/_actor-sim/register-count.mjs', 'probe/perf-sim-bench.mjs', '--actor-child', ...extra],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').pop());
const actor = { ...actorRun(), ...actorRun('--heap') };
const warm = { ...actorRun('--warm'), ...actorRun('--warm', '--heap') };
let drivers = null;
try { await import('../src/00b-fixedstep.js').then(m => { if (!m.tickBySteps) throw 0; });
      drivers = { legacy: actorRun('--driver=legacy'), perstep: actorRun('--driver=perstep') }; } catch { /* 旧版本没有 tickBySteps */ }
const env = await envBench();
if (JSON_OUT){ console.log(JSON.stringify({ actor, warm, drivers, env })); process.exit(0); }
console.log(`actor（carriage-walkback 一场 ${actor.frames} 帧）：每帧 中位 ${fmt(actor.med)} · p95 ${fmt(actor.p95)} · THREE new ${actor.ctor.toFixed(3)}/帧 · clone ${actor.clone.toFixed(3)}/帧 · 堆 ≈${actor.bytes == null ? '?' : Math.round(actor.bytes)} B/帧`);
console.log(`actor 稳态（空跑 50000 帧后连量 ${warm.frames} 帧）：每帧 中位 ${fmt(warm.med)} · p95 ${fmt(warm.p95)} · 堆 ≈${warm.bytes == null ? '?' : Math.round(warm.bytes)} B/帧`);
if (drivers) for (const [k, d] of Object.entries(drivers))
  console.log(`actor 按帧驱动·${k === 'perstep' ? 'perStep 开' : 'perStep 关（现状）'}（${d.stepsPerFrame.toFixed(2)} 步/帧）：每帧 中位 ${fmt(d.med)} · p95 ${fmt(d.p95)}`);
for (const e of env) console.log(`env ${e.label}：中位 ${fmt(e.med)} · p95 ${fmt(e.p95)} · 堆 ≈${e.bytes == null ? '?' : Math.round(e.bytes)} B/帧`);
