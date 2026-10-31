// 纯 node 跑到访导演层（不起浏览器、不装 GLB）：逐步快照全部演员 + 导演层状态。
// 用法：node --import ./probe/_actor-sim/register.mjs probe/_actor-sim/sim.mjs <carriage|walk|carriage-rite|carriage-walkback> [场数] [输出.json] [最多步数]
//   carriage / walk 带 `?etiquette=0&walkback=0` 跑（礼仪三段全关 + 旧瞬移复位 = 2026-10-31 之前的行为，锁原基线）；
//   carriage-rite 带 `?walkback=0` = 礼仪三段全开、旧瞬移复位，锁 baseline/carriage-rite.json.gz；
//   carriage-walkback 不带参数 = 产品默认（礼仪全开 + 走回去），相机换到开机机位，锁 baseline/carriage-walkback.json.gz。
//   场数 = 跑到第几次 'done' 为止（马车版 2 = 首场 + 冷却 45s 复位 + 重播一场）。
// 为什么要它：visit-carriage-guard 要起浏览器 + 软件渲染跑十几分钟；改导演层/相位机时
//   需要"逐帧与基线一致"的证据 —— 导演层只读演员状态推进、与渲染无关，桩掉场景即可逐帧比对。
// ⚠️ 演员记录按 16-actors 的 loadActor 字段原样构造；骨架是假骨架（见 fakeRig），姿态层照样逐层执行；
//    捧卷/茶盏/毛笔/草把用 16a 的真 make*（几何走 MAT 桩），手持物的姿态写入也会执行。
// ⚠️ 到访模式在 16-actors **模块求值时**读 location.search ⇒ 一个进程只能跑一种模式。
// 移植自作废分支 hark/w-actors 的 probe/_actor-sim（那版针对拆分后的 16b–16q）。
import * as THREE from 'three';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { scene, camera } from './stubs/scene.mjs';
import { groundHeight } from './stubs/water.mjs';
import { SIM_CAR } from './stubs/stable.mjs';

const SRC08D = fs.readFileSync(new URL('../../src/08d-tour.js', import.meta.url), 'utf8');
const m = SRC08D.match(/export const WALK_ROUTE = (\[[\s\S]*?\]);/);
const WALK_ROUTE = new Function('return ' + m[1].replace(/\/\/[^\n]*/g, ''))();
export const ENV = { hour: 10, weather: 'clear', cur: { rainAmount: 0, snowAmount: 0, snowCover: 0 } };
globalThis.window = globalThis.window || {};
/* 假 canvas：16a 的卷轴纸纹理在 make* 里画 2D canvas。所有绘制调用空转、属性随便写（只影响贴图，不进快照）。 */
const NOOP_CTX = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => ({ addColorStop(){} })), set: (o, k, v) => { o[k] = v; return true; } });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => NOOP_CTX }) };      // 16-actors 里有 window.__groomRouteTrace 之类的调试开关
/* 00-config 的延迟绑定要发布到**适配器自己那份** 00-config（旧版本拷贝目录里是另一个模块实例） */
function publish(A){ A.config.HOOKS.walkRoute = WALK_ROUTE; A.config.ENV_REF.env = ENV; }

function det(i){ const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }

/* 假骨架：骨名取 16h loadActor 收集的那张表；绑定姿态全是单位四元数。
   有了它，advance 的每一层姿态写入（步态/垂手/捧卷/端茶/作揖/挥手/裙骨…）都会真的执行，
   快照里再带一个全身骨骼四元数的校验和 ⇒ 姿态层也能逐帧比对。 */
const BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head'];
for (const sd of ['Left', 'Right']) for (const n of ['UpperArm', 'LowerArm', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes', 'Hand',
  'IndexProximal', 'IndexIntermediate', 'MiddleProximal', 'MiddleIntermediate', 'ThumbProximal', 'ThumbIntermediate', 'ThumbDistal']) BONES.push(sd + n);
const SKIRT_IDS = new Set(['scholar', 'guest', 'qin', 'go1', 'go2', 'lady']);
function fakeRig(def, holder){
  const bones = {}, base = {}, skirt = [];
  const names = BONES.slice();
  if (SKIRT_IDS.has(def.id)) for (let i = 0; i < 6; i++) names.push('Skirt' + i + 'a', 'Skirt' + i + 'b');
  for (const n of names){ const b = new THREE.Bone(); b.name = n; holder.add(b); bones[n] = b; base[n] = b.quaternion.clone(); }
  if (SKIRT_IDS.has(def.id)) for (let i = 0; i < 6; i++)
    skirt.push({ a: 'Skirt' + i + 'a', b: 'Skirt' + i + 'b', axis: new THREE.Vector3(1, 0, 0), ang: (i * Math.PI) / 3 });
  return { bones, base, skirt, hipsRest: bones.Hips.position.clone() };
}
export function boneSum(a){
  let s = 0, i = 0;
  for (const n in a.bones){
    const q = a.bones[n].quaternion, sc = a.bones[n].scale, p = a.bones[n].position;
    i++; s += (q.x + 2 * q.y + 3 * q.z + 4 * q.w + 5 * sc.x + 6 * sc.y + 7 * p.y) * i;
  }
  return s;
}

export function makeActor(def, P){
  const holder = new THREE.Group();
  holder.name = 'actor_' + def.id;
  scene.add(holder);
  if (def.hideUntilVisit) holder.visible = false;
  const r = def.route;
  const gy0 = def.spot.y !== undefined ? def.spot.y : groundHeight(def.spot.x, def.spot.z);
  const hipH = def.height * 0.52;
  const SL = def.stepLen || 0.42;
  const amp = Math.min(0.34, Math.max(0.14, Math.asin(Math.min(0.6, SL / (2 * hipH)))));
  const rig = fakeRig(def, holder);
  return {
    def, holder, bones: rig.bones, base: rig.base, phase: def.idle.phase, amp, skirt: rig.skirt,
    pos: { x: def.spot.x, z: def.spot.z }, y: gy0, yaw: def.spot.yaw,
    target: r ? 1 : 0, waitT: r ? 2.0 : 0, walkOff: !!def.awaitGuest,
    step: 0, moveW: 0, moved: 0, stopN: 0,
    hopT: 0, hopDur: 0.62, hopN: 0, hopWait: def.idle.hopEvery ? 3 + det(def.idle.phase) * 6 : 0,
    floorY: null, floorTries: 0, sampleT: 0, floorDone: false, seatY: undefined,
    kneelW: 0, kneelTarget: def.pose === 'kneel' ? 1 : 0, sitW: 0, sitTarget: def.pose === 'sit' ? 1 : 0,
    placeT: 0, placeN: 0, placeWait: 1.5 + det(def.idle.phase) * 4,
    teaT: 0, teaN: 0, teaWait: 1.5 + det(def.idle.phase) * 6, sipW: 0, cup: null,
    brushT: 0, brushN: 0, brushWait: 2.5 + det(def.idle.phase + 2.3) * 5, brushW: 0, brush: null,
    chore: 'idle', choreT: 5 + det(def.idle.phase + 1.7) * 6, hayHeld: false, grabT: 0, grabW: 0,
    scrollT: 0, scrollN: 0, scrollPhase: 0, scrollW: 0, scroll: null,
    scrollHold: P.SCROLL.hold[0] + (P.SCROLL.hold[1] - P.SCROLL.hold[0]) * det(def.idle.phase + 4.1),
    hay: null, hipsDown: new THREE.Vector3(0, -1, 0), hipsRest: rig.hipsRest,
    ride: null, trip: null, coachW: 0, tieW: 0, tieTarget: false,
    blob: null, meshes: [], shadowCast: true,
  };
}
function addProps(a, P){
  const d = a.def;
  if (d.idle.tea) a.cup = P.makeTeaCup(a.holder);
  if (d.idle.brush) a.brush = P.makeBrush(a.holder);
  if (d.idle.scroll) a.scroll = P.makeScroll(a.holder);
  if (d.idle.hay) a.hay = P.makeHayHandful(a.holder);
}

const N6 = (v) => (typeof v === 'number' ? v.toPrecision(15) : String(v));
export function snapshot(A, VISIT, VISCAR){
  /* 礼仪开着的场次多记几项（接马子状态、水桶显隐/落点、两书童的作揖权重与盏）；
     全关的场次不加 ⇒ 原基线的帧串一个字符都不变。 */
  const rite = A.etiquette && A.RITE ? riteParts(A) : null;
  const parts = [VISIT.phase, N6(VISIT.t), N6(VISIT.bowW), N6(VISIT.waveW || 0), N6(VISIT.s), N6(VISIT.tourS),
                 VISCAR.state, N6(VISCAR.s), N6(VISCAR.odo), VISCAR.leg, SIM_CAR.visible, SIM_CAR.tied];
  for (const a of A.ACTORS){
    parts.push(a.def.id, N6(a.pos.x), N6(a.pos.z), N6(a.y), N6(a.yaw), N6(a.moveW), N6(a.sitW),
               N6(a.step), !!a.arrived, a.target, a.holder.visible, N6(a.floorY), !!a.ride, !!a.trip,
               N6(a.offerW || 0), N6(a.coachW), N6(a.tieW), N6(boneSum(a)), a.chore);
  }
  if (rite) parts.push(...rite);
  return parts.join('|');
}
function riteParts(A){
  const R = A.RITE, b = R.bucket;
  const out = ['rite', R.g, b ? b.visible : '-', b ? N6(b.position.x) : '-', b ? N6(b.position.z) : '-'];
  for (const a of A.ACTORS){
    if (a.def.id !== 'child1' && a.def.id !== 'child2' && a.def.id !== 'groom') continue;
    out.push(N6(a.riteBowW || 0), N6(a.riteStoopW || 0), !!a.riteBusy, !!a.riteCupOn);
  }
  return out;
}

/* 跑 visits 场：每步 dt=0.4s 走一次 actorStep（内部 quantum 1/60，与 visit-carriage-guard 同口径）。
   第 visits 次进入 'done' 就停；maxSteps 是硬上限（默认测试只跑前若干段时用它截断）。 */
export async function runVisit(A, { visits = 1, dt = 0.4, maxSteps = 20000, onStep = null } = {}){
  publish(A);
  if (!A.ACTORS.length) for (const d of A.defs){ const a = makeActor(d, A.props); A.ACTORS.push(a); addProps(a, A.props); }
  const frames = [], phases = [], cars = [], doneAt = [];
  let lastP = '', lastC = '', simT = 0;
  for (let k = 0; k < maxSteps; k++){
    A.actorStep(dt);
    simT += dt;
    const v = A.VISIT;
    if (v.phase !== lastP){
      phases.push([+simT.toFixed(1), v.phase]);
      if (v.phase === 'done') doneAt.push(+simT.toFixed(1));
      lastP = v.phase;
    }
    const cs = A.VISCAR.state + (A.VISCAR.leg ? '/' + A.VISCAR.leg : '');
    if (cs !== lastC){ cars.push([+simT.toFixed(1), cs]); lastC = cs; }
    frames.push(snapshot(A, A.VISIT, A.VISCAR));
    if (onStep) onStep(A, simT);
    if (doneAt.length >= visits) break;
  }
  const r = { mode: A.VISIT.mode, etiquette: !!A.etiquette, dt, frames, phases, cars, simT: +simT.toFixed(1), doneAt };
  /* 走回去的统计（只有开着时才有；关着时结果对象与旧版逐字段一致） */
  if (A.VISIT.homeLog) r.walkback = { log: A.VISIT.homeLog.slice(), snaps: A.VISIT.homeSnaps || 0 };
  return r;
}

/* 进程内装载：先按模式设好 location，再 import（模式是模块求值期读的） */
const SEARCH = {
  carriage: '?etiquette=0&walkback=0',
  walk: '?visit=walk&etiquette=0&walkback=0',
  'carriage-rite': '?walkback=0',
  'carriage-walkback': '',                       // 产品默认：礼仪三段 + 走回去全开
};
export async function loadSim(mode){
  if (!(mode in SEARCH)) throw new Error('未知模式 ' + mode);
  const etiquette = mode === 'carriage-rite' || mode === 'carriage-walkback';
  globalThis.location = { search: SEARCH[mode] };
  /* 走回去要"镜头看得见"才步行：桩相机默认朝天（任何复位都看不见 = 旧行为），
     carriage-walkback 换成产品开机机位 CAM_HOME（02-scene：pos (−20,17,32)、target (0,3.5,−1)），
     这个机位下水榭 / 门内岗位 / 月台 / 堂前都在视锥里。 */
  if (mode === 'carriage-walkback'){ camera.position.set(-20, 17, 32); camera.lookAt(0, 3.5, -1); camera.updateMatrixWorld(true); }
  const quiet = console.log, qi = console.info, qw = console.warn;
  console.log = () => {}; console.info = () => {}; console.warn = () => {};
  try { return { ...(await (await import('./adapter.mjs')).load()), etiquette }; }
  finally { console.log = quiet; console.info = qi; console.warn = qw; }
}

export { camera, scene, SIM_CAR };

/* CLI：输出快照 JSON（给 compare / 录基线用） */
if (import.meta.url === pathToFileURL(process.argv[1]).href){
  const mode = process.argv[2] || 'carriage', visits = +(process.argv[3] || 1);
  const out = process.argv[4], maxSteps = +(process.argv[5] || 20000);
  const t0 = Date.now();
  const A = await loadSim(mode);
  const quiet = console.log; console.log = () => {}; console.warn = () => {};
  const r = await runVisit(A, { visits, maxSteps });
  console.log = quiet;
  if (out) fs.writeFileSync(out, JSON.stringify(r));
  console.log(mode, 'frames', r.frames.length, 'simT', r.simT, 'doneAt', r.doneAt.join(','), 'wall', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log(r.phases.map(p => p[0] + ' ' + p[1]).join(' → '));
}
