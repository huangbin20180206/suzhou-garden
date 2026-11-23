// 到访导演层的边界场景驱动（2026-11-24 · 批次 3）：纯 node，一个进程跑一种模式的一个场景，结果打成一行 JSON。
// 用法：node --import ./probe/_actor-sim/register.mjs probe/_actor-sim/edge.mjs <模式> <场景> [参数…]
//   模式同 sim.mjs（carriage / walk / carriage-rite / carriage-walkback）；
//   场景：
//     abort <相位>              —— 进入该相位 0.4s 时模拟全场看门狗（VISIT.age=1501）中途复位，
//                                  记复位当帧的残留标记，再看下一场能否走到 done、用时多少
//     yield <x> <z> <polite|stay> —— 步行模式（登记 HOOKS.walkState）玩家站在 (x,z)：
//                                  polite = 被人物"等"满 3s 就往东让 3m、10s 后回原处；stay = 一直不动
//     night <相位> <秒>           —— 进入该相位 1s 后入夜（hour 20）若干秒再天亮，记隐藏 / 复亮与抚琴人可见性
// 由 probe/visit-edge-unit.mjs 并行调用；也可手跑看数。
import { loadSim, runVisit, ENV, camera } from './sim.mjs';

const [mode, scene, ...args] = process.argv.slice(2);
const A = await loadSim(mode);
console.warn = () => {}; console.log = (...a) => process.stdout.write(a.join(' ') + '\n');
await runVisit(A, { maxSteps: 1 });                 // 创建演员
const actor = (id) => A.ACTORS.find(a => a.def.id === id);
const host = actor('scholar'), guest = actor('guest'), qin = actor('qin');
const DT = 0.4;
let t = 0;
const phases = [];
function step(){
  A.actorStep(DT); t += DT;
  const p = A.VISIT.phase;
  if (!phases.length || phases[phases.length - 1][1] !== p) phases.push([+t.toFixed(1), p]);
}
const doneAfter = (t0) => phases.find(p => p[1] === 'done' && p[0] > t0);
const out = { mode, scene, args };

if (scene === 'abort'){
  const at = args[0];
  let fired = 0, inAt = -1;
  for (let k = 0; k < 6000; k++){
    step();
    if (A.VISIT.phase === at && inAt < 0) inAt = t;
    if (!fired && inAt >= 0 && t - inAt >= DT){
      fired = t; A.VISIT.age = 1501;
      A.actorStep(0.02);
      out.reset = { at: +t.toFixed(1), phase: A.VISIT.phase, hostPairDrive: !!host.pairDrive, guestPairDrive: !!guest.pairDrive,
                    riteBusy: A.ACTORS.filter(a => a.riteBusy).map(a => a.def.id),
                    cups: A.ACTORS.filter(a => a.riteCup && a.riteCup.visible).map(a => a.def.id),
                    guestVisible: guest.holder.visible, car: A.VISCAR.state };
    }
    if (fired && doneAfter(fired)) break;
  }
  out.fired = !!fired;
  const d = fired && doneAfter(fired);
  out.nextDone = d ? +(d[0] - fired).toFixed(1) : null;
  out.endPhase = A.VISIT.phase;
}

if (scene === 'yield'){
  const px = +args[0], pz = +args[1], polite = args[2] === 'polite';
  A.config.HOOKS.walkState = () => ({ active: true });
  camera.position.set(px, 1.65, pz); camera.lookAt(px, 1.65, pz - 10); camera.updateMatrixWorld(true);
  let awayAt = 0, yields = 0, minD = Infinity, minWho = '';
  for (let k = 0; k < 3000; k++){
    step();
    if (polite){
      const waiting = A.ACTORS.some(a => (a.yieldT || 0) > 3) || (A.VISIT.yieldT || 0) > 3;
      if (waiting && camera.position.x === px){ camera.position.x = px + 3; awayAt = t; yields++; }
      if (camera.position.x !== px && t - awayAt > 10) camera.position.x = px;
    }
    if (camera.position.x === px) for (const a of A.ACTORS){
      if (!a.holder.visible) continue;
      const d = Math.hypot(a.pos.x - px, a.pos.z - pz);
      if (d < minD){ minD = d; minWho = a.def.id + '@' + A.VISIT.phase; }
    }
    if (doneAfter(0)) break;
  }
  const d = doneAfter(0);
  Object.assign(out, { yields, minD: +minD.toFixed(3), minWho, done: d ? d[0] : null });
}

if (scene === 'night'){
  const at = args[0], dark = +args[1];
  let inAt = -1, nightAt = 0, dayAt = 0;
  const hidden = [], qinSeen = [];
  const prevVis = new Map();
  for (let k = 0; k < 4000; k++){
    step();
    if (A.VISIT.phase === at && inAt < 0) inAt = t;
    if (inAt >= 0 && !nightAt && t - inAt > 1){ nightAt = t; ENV.hour = 20; }
    if (nightAt && !dayAt && t - nightAt > dark){ dayAt = t; ENV.hour = 10; }
    if (nightAt && !dayAt) qinSeen.push([A.VISIT.phase, !!A.VISIT.hostAtQin, qin.holder.visible, host.holder.visible]);
    for (const a of A.ACTORS){
      const was = prevVis.get(a);
      if (was && !a.holder.visible && nightAt) hidden.push([a.def.id, A.VISIT.phase, +a.moveW.toFixed(2)]);
      prevVis.set(a, a.holder.visible);
    }
    if (dayAt && (doneAfter(dayAt) || phases.some(p => p[1] === 'idle' && p[0] > dayAt))) break;   // 本场收场 / 复位完即止
  }
  Object.assign(out, { nightAt: +nightAt.toFixed(1), dayAt: +dayAt.toFixed(1), hidden, qinSeen,
                       homeLog: A.VISIT.homeLog || null, homeSnaps: A.VISIT.homeSnaps || 0 });
}

out.phases = phases.length;
console.log(JSON.stringify(out));
