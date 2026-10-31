// 15c-horse-life.js — 由 15-stable.js 按职责整块搬出（纯搬家，逐字节未改）。
// 马的行为层与装配：
//   · HORSE_LIFE 状态机（吃草/受喂/步态/甩尾/抬蹄/冬季白气）
//   · 步态相位（gaitPose / updateHorseGait）与贴地软影
//   · 两套资产的加载与换装（Tinker / Rodin）、毛色贴图、makeHorse
// 仿真时钟 `_stT` 由 15b 持有，这里用 advanceStableTime(dt) 推进。
import { mulberry32, HOOKS } from './00-config.js';
import { _stT, advanceStableTime, applyTinkerPose, applyRodinPose, _tv, HORSE_GLB, installHorseRig, HORSE_TOTAL_H, tinkerBuffer, tinkerLoader, tinkerMaterial, markCoatPoints, slimNeck, TINKER_ANIM_BONES, markTinkerHorse } from './15b-horse-rig.js';
import { THREE, mergeGeometries } from '../vendor.js';
import { makeSoftAlphaTex, prRange } from './15a-shared.js';
import { ENV } from './12-env.js';
import { camera, scene, renderer } from './02-scene.js';
import { tubeRadiusRamp } from './06-vegetation.js';
import { markCasterBoxDirty } from './09-lights.js';
import { mesh, box } from './03-factory.js';
import { MAT } from './01-materials.js';
import { createGLTFLoaderWithDecoders } from './06e-assets.js';
import { markArtLicense } from './art-license.js';

/* Tinker 缺骨 / 找不到尾骨只警告一次 —— 拆分前它是与 15b 共用的模块级标志，
   实测只有本模块读写它（15b 里零引用），故随本模块搬来。 */
let _tinkerWarned = false;
export const HORSE_LIFE = [];
export const _sr = mulberry32(20261011);          // 私有流：事件间隔/相位/抖颈方向
/* 白雾 billboard 的临时对象（2026-10-27 复核 C1：原来 tickStableLife 每帧 new 四个，
   挪模块级复用 —— 单线程、同步体里用完即弃，与 15b 的 _tq/_te 同一套做法）。 */
const _lifeM = new THREE.Matrix4(), _lifeQ = new THREE.Quaternion(),
      _lifeSC = new THREE.Vector3(), _lifePP = new THREE.Vector3();

/* 诊断用：返回 HORSE_LIFE 本体（可变）。仅供探针在"冻结相位"下拍步态，
   产品逻辑不读它。用法：const h = m.horseLifeDebug().find(x=>x.gait);
   h.gait.state='move'; h.gait.dist=k; h.gait.phase=p; h.gaitW=1; 再 tick 一次。 */
export function horseLifeDebug(){ return HORSE_LIFE; }
export function horseLifeState(){
  return { n: HORSE_LIFE.length, t: +_stT.toFixed(2),
           horses: HORSE_LIFE.map(h => h.anim
             ? { role: h.role, skeletal: true, bones: Object.keys(h.anim.bones).length,
                 headPitch: +(h.lastHP || 0).toFixed(3), headYaw: +(h.lastHY || 0).toFixed(3),
                 tailYaw: +(h.lastTY || 0).toFixed(3),
                 leg: (h.lastLeg || [0,0,0,0]).map(v => +v.toFixed(3)),
                 /* 2026-10-21 步态诊断：状态/相位/前后行程/权重/世界位置 */
                 gait: h.gait ? { state: h.gait.state, mode: h.gait.mode,
                   dist: +h.gait.dist.toFixed(3), target: +h.gait.target.toFixed(3),
                   phase: +h.gait.phase.toFixed(3) } : null,
                 gaitW: +(h.gaitW || 0).toFixed(3), grazeW: +(h.grazeW || 0).toFixed(3),
                 pos: [+h.group.position.x.toFixed(3), +h.group.position.y.toFixed(3), +h.group.position.z.toFixed(3)],
                 breath: h.breath ? { live: h.breath.filter(b => b.life > 0).length } : null }
             : { role: h.role, skeletal: false,
                 headPitch: +h.mat.userData.rig.head.x.toFixed(3), headYaw: +h.mat.userData.rig.head.y.toFixed(3),
                 tailYaw: +h.mat.userData.rig.tail.x.toFixed(3),
                 jaw: h.mat.userData.rig.jaw ? +h.mat.userData.rig.jaw.x.toFixed(3) : 0,
                 leg: [...h.mat.userData.rig.leg].map(v => +v.toFixed(3)),
                 gaitW: +(h.gaitW || 0).toFixed(3), grazeW: +(h.grazeW || 0).toFixed(3),
                 gait: h.gait ? { state: h.gait.state, dist: +h.gait.dist.toFixed(3),
                   phase: +h.gait.phase.toFixed(3) } : null,
                 pos: [+h.group.position.x.toFixed(3), +h.group.position.y.toFixed(3), +h.group.position.z.toFixed(3)],
                 breath: h.breath ? { live: h.breath.filter(b => b.life > 0).length } : null }) };
}
/* ── 调试钩子（2026-10-19 · 骨链诊断用）：当前姿态 vs 绑定姿态的骨骼四元数 ──
   probe/_tmp-horse-diag9.mjs 用它比对"哪根骨被拧了多少"，定位头/脖撕开的问题。 */
export function tinkerPoseDebug(){
  const e = (q) => { const t = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return [+t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3)]; };
  return HORSE_LIFE.map(h => {
    const B = h.anim.bones, R = h.anim.rest, out = {};
    for (const n of Object.keys(R)){
      if (!B[n]) { out[n] = null; continue; }
      out[n] = { now: e(B[n].quaternion), rest: e(R[n]) };
    }
    return { role: h.role, hp: +(h.lastHP || 0).toFixed(3), hy: +(h.lastHY || 0).toFixed(3),
             ty: +(h.lastTY || 0).toFixed(3), bones: out };
  });
}

/* 冬天口鼻白雾（只给辕里那两匹）：**位置在 CPU 上按同一套枢轴/角度复算** —— 顶点是 GPU 改的、
   CPU 不知道，所以这里照抄同一套旋转公式算出**鼻端**，再乘槽位组的世界矩阵。
   ⚠️ 四个纪律：私有流（可复现）、`raycast=()=>{}`（别拦视线判定）、`userData.aoSkip`（不进 GTAO
   法线 pass，否则亮片被当成实体写成一块黑）、**不写任何全局灯光**（与闪电/烟花/流星同一条教训）。 */
export const horseBreathMesh = (() => {
  const MAXB = 48;
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  const grd = cx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grd.addColorStop(0.00, 'rgba(255,255,255,0.52)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.20)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0)');
  cx.fillStyle = grd; cx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.45 });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAXB);
  im.name = 'horseBreath';
  im.frustumCulled = false;
  im.raycast = () => {};
  im.userData.aoSkip = true;
  im.count = 0;
  return im;
})();

/* ── 马的步态（2026-10-21）──────────────────────────────────────────────────
   目标：院中那匹灰马不再"站桩"，会自己走几步、偶尔小跑、停下吃草。
   做法是**程序化四拍步态**，不烘焙动画片段：
     · 每腿一个相位；着地段 hoof 相对身体向后匀速走，抬腿段折腿前摆；
     · 身体前进速度 = 步幅 / 周期（stride 与 speed 绑定）⇒ 脚不打滑；
     · 四个相位错开（走：左后→左前→右后→右前；跑：对角两拍）；
     · 头/颈/尾仍由 tickStableLife 的原有小动作驱动，不冲突。
   ⚠️ 前腿 +X = 向前抬；后腿 +X = 向后抬（Blender 实测）⇒ 生成器统一用"向前为正"，
     到 applyTinkerPose 里后腿取负号。 */
export const HORSE_GAIT = {
  /* 2026-10-21 首轮实拍：幅度 0.30/0.42 在近景读作"腿叉得很开" ⇒ 收到 0.26/0.34。
     步幅仍与速度绑定（stride = 2·腿长·sinA / 着地比 ≈ 0.72m）。 */
  walk: { A: 0.28, lift: 0.52, stance: 0.62, stride: 0.75, speed: 0.78, bob: 0.016 },
  trot: { A: 0.34, lift: 0.62, stance: 0.47, stride: 1.24, speed: 1.85, bob: 0.024 },
};
/* 会走动的马用贴地软阴影（理由见 loadStableHorses 里 castShadow 那段）。
   64×64 径向渐变、只做一次材质；平面挂槽位组、y≈地面。 */
export let _horseBlobMat = null;
export function attachHorseBlob(slot){
  if (!_horseBlobMat){
    /* ⚠️ 用 map 不用 alphaMap：makeSoftAlphaTex 的渐变在**alpha 通道**里，
       alphaMap 只读绿通道（白底全 1）⇒ 会变成一块实心黑方块/或干脆看不见。
       map 的 RGB 是白的、乘 color=黑 ⇒ 黑色，透明度走 alpha 通道的径向渐变。 */
    _horseBlobMat = new THREE.MeshBasicMaterial({
      map: makeSoftAlphaTex(), color: 0x000000,
      transparent: true, opacity: 0.30, depthWrite: false,
    });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 2.30), _horseBlobMat);
  m.name = 'horseBlobShadow';
  m.rotation.x = -Math.PI / 2;
  /* ⚠️⚠️ 2026-10-27 修「马四肢底部有明显的拖影/重影」（老黄）：
     原来抬到 **+0.09**（当年是为了压住院里的棕色"磨损土斑"，它在 gy+0.05），
     结果这块 1.18×2.30 的黑面片**悬在蹄底上方 9cm**、正好横切四条小腿的下段 ——
     相机在上方看时，每只蹄子的下半截都在它后面，被压暗成一片"重影"。
     现在：土斑是不写深度的半透明层（renderOrder 0），软影 renderOrder 2 本来就画在它
     之后 ⇒ 不需要再靠高度压它。降到 **+0.02**：只在蹄底那一小圈上，既压不住土斑、
     也不切腿。 */
  m.position.set(0, 0.02, 0);
  m.renderOrder = 2;
  m.raycast = () => {};
  m.userData.aoSkip = true;
  m.userData.noMerge = true;      // 别被 mergeStatics 烘进静态大网（它要跟着马走）
  slot.group.add(m);
  slot.blob = m;
}
export const GAIT_OFFSET = {
  walk: { HL: 0.00, FL: 0.25, HR: 0.50, FR: 0.75 },
  trot: { FL: 0.00, HR: 0.00, FR: 0.50, HL: 0.50 },
};
export function gaitPose(mode, phase){
  const D = HORSE_GAIT[mode] || HORSE_GAIT.walk;
  const off = GAIT_OFFSET[mode] || GAIT_OFFSET.walk;
  const out = {};
  for (const k of ['FL', 'FR', 'HL', 'HR']){
    let p = (phase + (off[k] || 0)) % 1;
    if (p < 0) p += 1;
    let u, lift, toe;
    if (p < D.stance){
      /* 着地段：hoof 相对身体从 +A 匀速走到 −A（世界坐标里是踩住的）。 */
      const q = p / D.stance;
      u = D.A * (1 - 2 * q);
      lift = 0.05 * Math.sin(Math.PI * q);
      toe = 0;
    } else {
      /* 抬腿段：折腿 + 前摆，落地前把蹄放平。 */
      const q = (p - D.stance) / (1 - D.stance);
      const s = q * q * (3 - 2 * q);
      u = -D.A + 2 * D.A * s;
      lift = D.lift * Math.sin(Math.PI * q);
      toe = lift * 0.55;
    }
    out[k] = [u, lift, toe];
  }
  return out;
}
/* 2026-10-29：把人（马夫）贴在马身边作业的那段时间把马按住。
   "喂草/刷毛的时候马自己走开"在现实里不会发生，而在本项目里更严重：站位是按马的
   实时位置算的，马一迈步人就站进马身里（老黄报的"从马的身体中间穿过"）。
   hold 只冻结**位置与步态**，低头吃草/甩尾/抬蹄那些姿态照旧（所以画面不僵）。 */
export function holdHorse(h, on){ if (h) h.hold = !!on; }
export function updateHorseGait(h, dt){
  const G = h.gait;
  /* 被套在行驶中的马车上时，位置与腿相位由 travelCarriagePlace 统一写
     （口径 = 车的里程，不是马自己的状态机）—— 这里必须整个让开，否则两边每帧打架。 */
  if (h.driving) return;
  if (!G || !h.home || !h.groundY) return;
  /* 被按住的马：钉在吃草状态、计时不往下走 ⇒ 不切到 move、位置原地不动 */
  if (h.hold){ G.state = 'graze'; if (G.timer < 0.8) G.timer = 0.8; }
  G.timer -= dt;
  if (G.state === 'graze'){
    if (G.timer <= 0){
      G.state = 'move';
      G.target = G.target > 0.01 ? 0 : G.lane;
      /* 往前才可能小跑；退回去只能慢步（马不会倒着跑）。 */
      G.mode = (G.target > 0.01 && _sr() < 0.22) ? 'trot' : 'walk';
    }
  } else if (G.state === 'move'){
    const D = HORSE_GAIT[G.mode];
    const d = G.target - G.dist;
    /* 退回去按 0.55 倍速（马倒着走本来就慢），避免读成"快退"。 */
    const step = D.speed * (d < 0 ? 0.55 : 1) * dt;
    G.dist += (d > 0 ? 1 : -1) * Math.min(step, Math.abs(d));
    if (Math.abs(G.target - G.dist) < 0.003){
      G.state = 'graze';
      /* 院场窄、单程只有 0.75m ⇒ 别让它"走一步就站着吃十几秒"，
         缩短吃草停顿，让人更常看到它在走（2026-10-21 调）。 */
      G.timer = 3.5 + _sr() * 4.5;
    }
  }
  /* 权重：走动时步态 1、吃草时 0；吃草动作反向。两者都做斜坡，避免一帧切。 */
  const wantG = (G.state === 'move') ? 1 : 0;
  h.gaitW += (wantG - h.gaitW) * Math.min(1, dt * 3.2);
  const wantGraze = (G.state === 'move') ? 0 : 1;
  h.grazeW += (wantGraze - h.grazeW) * Math.min(1, dt * 2.6);
  /* 相位按"带符号的实际位移"推进 —— 站着不动时相位不空转；
     后退时 delta<0 ⇒ 相位倒着走，着地腿相对身体向前，读作"倒着迈步"而不是滑行。 */
  const delta = G.dist - (G.lastDist || 0);
  G.lastDist = G.dist;
  const D = HORSE_GAIT[G.mode];
  if (h.gaitW > 0.001){
    /* 步幅：只有 walk 能用 h.strideWalk（它按 walk 的摆角 A=0.28 标定）；
       trot 的摆角是 0.34、着地比也不同，套用 walk 的步幅会把相位推快约 1.87 倍，
       读作"碎步打滑"（2026-10-27 修）。trot 用模式常量，与 15d 马车处的 1.24 同口径。 */
    const stride = (G.mode === 'walk' && h.strideWalk) ? h.strideWalk : D.stride;
    G.phase = (G.phase + delta / stride) % 1;
    h.gaitLegs = gaitPose(G.mode, G.phase);
    h.gaitBob = Math.sin(G.phase * Math.PI * 4) * D.bob;
  } else {
    h.gaitLegs = null;
    h.gaitBob = 0;
  }
  /* 位移只沿"槽位朝向"前后，不转向 —— 院场窄，转身会扫到栅栏/马车。 */
  const fx = Math.sin(h.home.yaw), fz = Math.cos(h.home.yaw);
  const x = h.home.x + fx * G.dist;
  const z = h.home.z + fz * G.dist;
  h.group.position.set(x, h.groundY(x, z) + (h.gaitBob || 0), z);
  h.group.rotation.y = h.home.yaw;
}

/* 每帧：① 推每匹马的姿态角；② 冬天喷白雾。dt 用主循环的仿真步长（与固定步长累加器同一根时钟）。 */
export function tickStableLife(dt){
  if (!HORSE_LIFE.length) return;
  /* 仿真时钟由 15b 持有（原来就是本文件里的一个 let）——本模块只读，推进走这个函数 */
  const t = advanceStableTime(dt);
  const winter = ENV && ENV.season === 'winter';
  let puff = 0;
  /* 白雾 billboard 的临时对象（2026-10-27 复核 C1：原来每帧 new 四个，挪模块级复用；
     单线程、本函数同步体里用完即弃，与 15b 的 _tq/_te 同一套做法）。 */
  const M = _lifeM, Q = _lifeQ, SC = _lifeSC, PP = _lifePP;
  for (const h of HORSE_LIFE){
    const ph = h.phase;
    /* 2026-10-21：步态（走/小跑/停下吃草）—— 只有配了 gait 的马会动，其余原样。 */
    if (h.grazeW == null) h.grazeW = (h.role === 'graze' || h.role === 'fed') ? 1 : 0;
    if (h.gaitW == null) h.gaitW = 0;
    if (h.gait) updateHorseGait(h, dt);
    /* ① 底噪：所有马都有的慢微动。
       ⚠️⚠️ 2026-10-11 **全面加大**（老黄："马蹄和马尾会不规则动，也看不到"）——
       先证伪了"伪蒙皮没生效"：outputs/_diag/horse-rig-pixel.mjs 冻结帧 A/B 实测
       rig 角度 0 → 0.6rad **确实改了 2393 像素**（自检 0、可逆）⇒ 注入是好的。
       真因是**幅度太小**：上一版底噪 0.014 / 0.022 / 0.11 rad（= 0.8° / 1.3° / 6.3°），
       而「马厩」机位在 15~25m 外 —— 按上面那次实测的比例，0.03 rad 连 20 像素都不到，
       等于没动。
       ⚠️⚠️ 2026-10-21 **回撤一部分幅度**（老黄："动作抽搐"）：原来为了让远处"看得见"
       把幅度开很大，但**马的动作是慢的**——一匹马甩尾/抖颈是"缓缓地"，
       大幅度 + 高频率 = 抽搐/惊跳。⇒ ①底噪幅度降回温和（尾 0.30→0.22rad）；
       ②脉冲事件**拉长 + 降幅**（甩尾 0.60rad/0.9s → 0.34rad/1.6s；抬蹄 0.52rad/1.6s
       → 0.30rad/2.2s）；③抖颈里的 `sin(u*20)`（≈11 rad/s，24fps 下 0.46rad/帧 = 26°/帧）
       降成 `sin(u*5)`（≈2.8 rad/s ⇒ 0.12rad/帧）—— 这条是"抽搐"的主犯。 */
    let headPitch = 0.030 * Math.sin(t * 0.90 + ph);
    let headYaw   = 0.050 * Math.sin(t * 0.37 + ph * 1.7);
    let tailYaw   = 0.22 * Math.sin(t * 0.95 + ph) + 0.05 * Math.sin(t * 2.30 + ph * 2.1);
    const leg = [0, 0, 0, 0];
    /* 甩尾 + 抬蹄：**所有角色共用** ——"休息的马匹也会不规则动"是明确要求，
       上一版只有吃草那两匹有甩尾、只有辕里那两匹有抬蹄 ⇒ 厩内和马厩旁边那两匹
       是完全静止的（正是老黄说"看不到"的那几匹）。 */
    h.flick -= dt;
    if (h.flick <= 0){ h.flick = 5.0 + _sr() * 9.0; h.flickT = 1.6; }
    if (h.flickT > 0){ const u = 1 - h.flickT / 1.6; tailYaw += 0.34 * Math.sin(Math.PI * Math.min(1, u)); h.flickT -= dt; }
    /* 2026-10-21：偶尔喷一下鼻翼（"噘嘴/打响鼻"里最轻的一档）。
       flare 由 applyTinkerPose 逐帧衰减，所以这里只负责"点一下"。 */
    if (h.flareNext == null) h.flareNext = 2.5 + _sr() * 4.0;
    h.flareNext -= dt;
    if (h.flareNext <= 0){
      h.flare = Math.min(0.16, (h.flare || 0) + 0.14);
      h.flareNext = 4.0 + _sr() * 7.0;
    }
    /* 走/跑的时候不叠加"原地点蹄"事件（步态已经给了四条腿），否则停下瞬间会跳一下。 */
    if (!(h.gaitW > 0.20)){
      h.hoofNext -= dt;
      if (h.hoofT > 0){
        const u = 1 - h.hoofT / 2.2;
        leg[h.hoofLeg] = 0.30 * Math.sin(Math.PI * Math.min(1, u));   // 前腿绕 X 转 ⇒ 蹄往前抬起
        h.hoofT -= dt;
      } else if (h.hoofNext <= 0){ h.hoofT = 2.2; h.hoofNext = 7 + _sr() * 11; h.hoofLeg = h.hoofLeg ? 0 : 1; }
    }
    if (h.role === 'graze' || h.role === 'fed'){
      /* ② 悠闲吃草：慢速点头（吃一口、抬一下）—— 幅度从 4.9°/3.3° 提到 12.6°/8.6°。
         走动时按 grazeW 渐隐（否则"低着头走路"）。 */
      const gw2 = h.grazeW == null ? 1 : h.grazeW;
      headPitch += (h.role === 'graze' ? 0.22 : 0.15) * Math.sin(t * 0.30 + ph) * gw2;
      headYaw   += 0.05 * Math.sin(t * 0.21 + ph * 1.3) * gw2;
      /* 走动时头随躯干轻微上下，读起来不是"头钉在空中"。 */
      headPitch += 0.030 * Math.sin((h.gait ? h.gait.phase : 0) * Math.PI * 4) * h.gaitW;
    } else if (h.role === 'harnessed'){
      /* ③ 辕里待发：平时安静；偶尔"仰天抖颈"。
         ⚠️ 2026-10-21：`sin(u*20)`（11 rad/s ⇒ 24fps 下 26°/帧）是"抽搐"主犯 ⇒ 降到 sin(u*5)；
            幅度也收一点（抬头 0.34→0.26rad、摇头 0.18→0.11rad）—— 马的抖颈是慢的。 */
      h.headNext -= dt;
      if (h.headT > 0){
        const u = 1 - h.headT / 1.8;                      // 0→1 一次事件
        const env = Math.sin(Math.PI * Math.min(1, u));   // 起落包络（连续）
        headPitch -= 0.26 * env;                          // 负 = 抬头
        headYaw   += 0.11 * h.headSide * env * Math.sin(u * 5);
        h.headT -= dt;
      } else if (h.headNext <= 0){ h.headT = 1.8; h.headNext = 9 + _sr() * 11; h.headSide = _sr() < 0.5 ? -1 : 1; }
    } else {
      /* ④ 厩内 2 匹：慢慢转头看看 + 低头嗅一下脚下的草 / 抬头 —— 上一版只有 ±3.4° 转头，
         出图判读"厩里两匹完全静止"。 */
      headYaw   += 0.12 * Math.sin(t * 0.13 + ph * 2.3);
      headPitch += 0.16 * Math.sin(t * 0.16 + ph * 1.7);
    }
    /* ⑤ 写姿态：Tinker 走骨骼；Rodin/程序化替身走旧伪蒙皮 uniform */
    if (h.anim){
      applyTinkerPose(h, headPitch, headYaw, tailYaw, leg, dt);
    } else {
      applyRodinPose(h, headPitch, headYaw, tailYaw, leg);
    }

    /* ⑥ 冬天：口鼻喷白雾。Tinker 用**鼻骨世界坐标**（真实跟随低头/抬头），
       替身仍用旧的枢轴公式；六匹 Tinker 都会喷。 */
    if (h.breath && winter && puff < 42){
      h.breathNext -= dt;
      if (h.breathNext <= 0){
        h.breathNext = 2.4 + _sr() * 2.6;
        const b = h.breath[h.breathCur = (h.breathCur + 1) % h.breath.length];
        b.life = 1.35;
        if (h.anim){
          const nose = h.anim.bones['noseL'] || h.anim.bones['DEF-noseL'] || h.anim.bones['ORG-head'];
          if (nose) nose.getWorldPosition(_tv);
          else _tv.set(0, 1.2, 0);
          b.x = _tv.x; b.y = _tv.y; b.z = _tv.z; b.world = true;
          h.flare = 0.42;                              // 喷气时鼻孔同步扩一下
        } else {
          const rig = h.mat.userData.rig;
          const a = rig.head.x, p = h.piv.neck;
          let dy = h.nose[1] - p[1], dz = h.nose[2] - p[2];
          const cs = Math.cos(a), sn = Math.sin(a);
          b.x = h.nose[0]; b.y = p[1] + dy * cs - dz * sn; b.z = p[2] + dy * sn + dz * cs;
          if (rig.head.y !== 0){ const c2 = Math.cos(rig.head.y), s2 = Math.sin(rig.head.y);
            const dx2 = b.x - h.nose[0]; b.x = h.nose[0] + dx2 * c2 + (b.z - h.nose[2]) * s2; }
          b.world = false;
        }
        b.vx = 0.10 * (_sr() - 0.5); b.vy = 0.30 + 0.12 * _sr(); b.vz = -0.12 - 0.10 * _sr();
        h.alive = true;
      }
    }
  }
  /* ⑥ 把白雾写进实例矩阵（相机朝向的 billboard；只算"活着"的那些）*/
  const im = horseBreathMesh;
  if (im){
    const anyLife = HORSE_LIFE.some(h => h.breath && h.breath.some(b => b.life > 0));
    if (!anyLife){ if (im.count !== 0) im.count = 0; }
    else {
      for (const h of HORSE_LIFE){
        if (!h.breath) continue;
        for (const b of h.breath){
          if (b.life <= 0) continue;
          b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
          const u = 1 - b.life / 1.35;                       // 0→1
          /* ⚠️ 白雾尺寸 0.16→0.66m：实测在近景里是一团**糊住整张脸**的白饼（老黄会读成
             "马嘴里塞了棉花"）。真马呵气是一小团 ⇒ 收到 0.09→0.30m。 */
          const size = 0.09 + 0.21 * u;
          if (puff < im.instanceMatrix.count){
            PP.set(b.x, b.y, b.z);
            if (!b.world){ h.group.updateWorldMatrix(true, false); PP.applyMatrix4(h.group.matrixWorld); }
            Q.copy(camera.quaternion); SC.set(size, size, size);
            M.compose(PP, Q, SC); im.setMatrixAt(puff, M); puff++;
          }
        }
      }
      im.count = puff;
      im.instanceMatrix.needsUpdate = true;
      im.visible = puff > 0;
    }
  }
}

/* ── 真马模型的**下载**必须在模块求值期发起（2026-10-11 修）──────────────────
   ⚠️⚠️ 这就是"每次进项目死等 180 秒"的根因，别把它挪回 loadStableHorses 里：
   11-loop 的 warmBoot **第一步**就是 `await preloadPhase(...)`，而预载段放行的条件是
   `aggregate().settled >= count` —— 也就是 PRELOAD_MANIFEST 里 6 件**全都 settle 过**。
   而 loadStableHorses 是**延迟批**里的一个 job（首帧出来之后、每帧一个 job 才轮到它）：
   把请求写在那里 ⇒ **请求要等开园之后才发，而预载段在前面等着** ⇒ 互相等 ⇒
   只能等满 PRELOAD_TIMEOUT_MS(180s) 才放弃 ⇒ 每次进项目白等 3 分钟。
   实测（outputs/_diag/startup-timeline.mjs）：进度文案死死停在
   「正在下载资产 2.6/3.4 MB（6/6）」——2.6 = 3.44 MB 总量减去**从未被请求**的 0.81 MB 马。
   现在把"发起下载 + 回报进度/成败"提到模块期（与 06/08 的另外 4 件 GLB 同款：
   它们的 loadAssetOnce 都写在模块体里，所以一直能在预载段之前落地）；
   **摆放与换装那一套仍留在延迟批**（它要等马厩建好、拿到 horseSlots）。
   ⚠️ settleAsset / reportAssetProgress 都不消耗任何随机流 ⇒ 不影响布局指纹。 */
export let _horseSrc = null;
  // eslint-disable-next-line no-unused-vars -- 保留：换回 Tinker 模型时的资产回退路径
export function horseSrcOnce(){
  if (_horseSrc) return _horseSrc;
  _horseSrc = new Promise((resolve, reject) => {
    createGLTFLoaderWithDecoders().load(HORSE_GLB,
      (gltf) => { HOOKS.settleAsset?.(HORSE_GLB, true); resolve(gltf.scene); },   // 成功：预载清单放行
      (e) => { HOOKS.reportAssetProgress?.(HORSE_GLB, e.loaded, e.total); },      // 真进度（第三槽）
      (err) => { HOOKS.settleAsset?.(HORSE_GLB, false, err); reject(err); });     // 失败也要回报（否则同样死等）
  });
  _horseSrc.catch(() => {});          // 没人 await 的失败别变成 unhandled rejection（马不在场不该报错）
  return _horseSrc;
}
/* 2026-10-19：Rodin Horse.glb 已换成 Tinker（见上方 tinkerBuffer 的 settle 握手），
   下面这份 horseSrcOnce 仅作历史回退保留，不在模块求值期调用（否会 404 拉一次废资源）。 */

/* ══ Rodin 马（2026-10-23）════════════════════════════════════════════════════
   为什么换：Tinker 那匹是 BlenderKit 的低模，耳朵/鼻孔/嘴都是后来补的件；已生成
   资产库里有三匹 Rodin 件，自带耳/眼/鼻孔/蹄形 + 2048 的漫反射/法线/粗糙度贴图。
   ⚠️ 三匹**都没有骨骼**（validate_glb: skins=0）⇒ 走本项目现成的"着色器伪蒙皮"
      （installHorseRig）：六块区域权重烘进顶点属性，每帧只写几个角度，CPU 成本 0。
   ⚠️ 归一化不在运行时做：outputs/_diag/horse-cand/convert_horse.py 已经烘成
      **脚底 y=0、头朝 +z、总高 1.75、x/z 居中**，这里只做"防御性复核"。
   ⚠️ 伪蒙皮只认"整条腿绕肩/髋摆"，做不出屈膝；15~25m 的观感距离下读作走路没问题，
      这也是旧 Tripo 马用过、验收通过的那条路。 */
export const HORSE_MODEL = 'rodin';        // 'rodin' = 三匹无骨骼 Rodin 件（伪蒙皮）；'tinker' = 骨骼版
export const RODIN_GLB = {
  camargue:  'assets/horse-camargue.glb',
  mongolian: 'assets/horse-mongolian.glb',
  criollo:   'assets/horse-criollo-saddle.glb',
};
export const _rodinSrc = new Map();
/* G6 接线：预载清单要求 src 里出现**字面 URL** 的 settleAsset 调用 ——
   写成 RODIN_GLB[key] 变量不算（probe/preload-manifest-sync 的正则只认字面量）。
   所以这里按 key 显式分派，别改成通用变量。漏了会每次进项目死等满 180s（2026-10-11 的前科）。 */
export function settleRodin(key, ok, err){
  if (key === 'camargue') HOOKS.settleAsset?.('assets/horse-camargue.glb', ok, err);
  else if (key === 'mongolian') HOOKS.settleAsset?.('assets/horse-mongolian.glb', ok, err);
  else if (key === 'criollo') HOOKS.settleAsset?.('assets/horse-criollo-saddle.glb', ok, err);
}
export function rodinSrcOnce(key){
  if (_rodinSrc.has(key)) return _rodinSrc.get(key);
  const url = RODIN_GLB[key];
  const p = new Promise((res, rej) => {
    createGLTFLoaderWithDecoders().load(url,
      (gltf) => { settleRodin(key, true); res(gltf.scene); },
      (e) => { HOOKS.reportAssetProgress?.(url, e.loaded, e.total); },
      (err) => { settleRodin(key, false, err); rej(err); });
  });
  p.catch(() => {});                       // 失败别留 unhandled rejection
  _rodinSrc.set(key, p);
  return p;
}
/* 模块求值期就发请求：预载阶段（11-loop 的 warmBoot 第一步）会等清单里的资产 settle，
   等到开园之后才发的请求必然死等到 PRELOAD_TIMEOUT_MS（2026-10-11 的教训）。 */
export const _RODIN_BOOT = Object.keys(RODIN_GLB).map(rodinSrcOnce);

/* ── 伪蒙皮的权重与枢轴：全部按**归一化后的实际几何**量，不手填 ──────────────
   手填的坑（旧 Tripo 马）：三匹马的腿位差 5~8cm，枢轴落在腿外就会"腿绕着空气转"。 */
export function rodinRigData(geo){
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const H = bb.max.y - bb.min.y, Lmin = bb.min.z, Lmax = bb.max.z;
  const pos = geo.attributes.position, N = pos.count;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /* ① 蹄心：最低 12% 高度按 x/z 符号分四簇（与 outputs/_diag/horse-cand/landmarks.mjs 同口径） */
  const cl = { FL: [0, 0], FR: [0, 0], HL: [0, 0], HR: [0, 0] };
  const cnt = { FL: 0, FR: 0, HL: 0, HR: 0 };
  for (let i = 0; i < N; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > bb.min.y + H * 0.12) continue;
    const k = (z > 0 ? 'F' : 'H') + (x > 0 ? 'R' : 'L');
    cl[k][0] += x; cl[k][1] += z; cnt[k]++;
  }
  for (const k of Object.keys(cl)) if (cnt[k]){ cl[k][0] /= cnt[k]; cl[k][1] /= cnt[k]; }
  const frontZ = (cl.FL[1] + cl.FR[1]) / 2 || 0.26;
  const hindZ  = (cl.HL[1] + cl.HR[1]) / 2 || -0.62;
  /* ② 四块权重（head/tail/前腿/后腿），全部 smoothstep 抹平，避免关节处一道折痕 */
  const W = { head: new Float32Array(N), tail: new Float32Array(N),
              legF: new Float32Array(N), legH: new Float32Array(N) };
  let tailTop = -1e9, muzzleY = 0, muzzleN = 0;
  for (let i = 0; i < N; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    W.head[i] = sm(0.26, 0.50, z) * sm(0.88, 1.02, y);          // 颈+头：腿（y<0.95）天然排除
    W.tail[i] = sm(-0.74, -0.90, z) * sm(0.18, 0.10, Math.abs(x)); // 尾：只认最后 20cm 的中线
    /* ⚠️⚠️ 2026-10-27 修「马车一动、马腹就大幅收缩」（老黄）：旧门是
         down = sm(0.95, 0.62, y) × side = sm(0.05, 0.12, |x|) × sm(±0.02, ±0.16, z)
       后腿那道 z 门在 z=−0.16 就吃满权重，而髋枢轴在 z=hindZ（实测 −0.52）⇒
       **腰腹整段（z −0.16~−0.40、y 0.62~0.95）都跟着后腿转**，绕髋力臂 0.4~0.7m；
       快步 ±0.34rad 下腹部顶点最大位移实测 **0.223m**（腹线纵向跨度 0.185→0.225），
       画面上就是"肚子一吸一缩"。
       改成**按到该腿蹄心竖轴的距离**给权重（真正的胶囊蒙皮）：
         · 平面距离 0.13m 内吃满、0.26m 外为 0（腿粗 10~20cm）；
         · y 从 1.00 渐隐到 0.55（肩/髋附近位移本来就小，不会撕出折痕）。
       腰腹（两腿之间的中线区）到任何一条腿轴都 ≥0.3m ⇒ 权重 0，不再被腿带走。
       ⚠️ 这两份权重在 Rodin 路径上**只用于形变**（颜色/花纹烘在贴图里），
          收窄它不会改变毛色。 */
    const side = sm(0.05, 0.12, Math.abs(x));
    const down = sm(1.00, 0.55, y);
    const axF = cnt[x > 0 ? 'FR' : 'FL'] ? cl[x > 0 ? 'FR' : 'FL'][0] : (x > 0 ? 0.12 : -0.12);
    const axH = cnt[x > 0 ? 'HR' : 'HL'] ? cl[x > 0 ? 'HR' : 'HL'][0] : (x > 0 ? 0.12 : -0.12);
    const capsule = (ax, az) => sm(0.26, 0.13, Math.hypot(x - ax, z - az));
    W.legF[i] = down * side * capsule(axF, frontZ);
    W.legH[i] = down * side * capsule(axH, hindZ);
    if (W.tail[i] > 0.5) tailTop = Math.max(tailTop, y);
    if (z > Lmax - 0.06){ muzzleY += y; muzzleN++; }
  }
  const piv = {
    neck: [0, 1.26, 0.40],
    tail: [0, tailTop > -1e8 ? tailTop : 1.10, Lmin + 0.03],
    legF: [0, 1.20, frontZ],
    legH: [0, 1.22, hindZ],
    /* 下颌铰点：口鼻后方 0.26m、略高于口鼻中线（正角度 = 下巴向下张开） */
    jaw: [0, (muzzleN ? muzzleY / muzzleN : 1.2) + 0.08, Lmax - 0.26],
  };
  /* ③ 下颌权重（只取"口鼻前段 + 下半"）：Rodin 件没有下颌骨，咀嚼只能靠这一层 */
  const jawZ0 = Lmax - 0.30, jawZ1 = Lmax - 0.16;
  const jawY1 = (muzzleN ? muzzleY / muzzleN : 1.2) + 0.06;
  const jawY0 = jawY1 - 0.16;
  const Wj = new Float32Array(N);
  for (let i = 0; i < N; i++){
    const y = pos.getY(i), z = pos.getZ(i);
    Wj[i] = Math.min(W.head[i], sm(jawZ0, jawZ1, z) * sm(jawY1, jawY0, y));
  }
  W.jaw = Wj;
  return {
    W, piv,
    nose: [0, muzzleN ? muzzleY / muzzleN : 1.25, Lmax - 0.02],
    /* 不滑步：步幅 = 2×肩高×sin(摆角)，与 HORSE_GAIT 的 A 绑定（旧 Tripo 马同款口径） */
    strideWalk: 2 * piv.legF[1] * Math.sin(HORSE_GAIT.walk.A),
    H, L: Lmax - Lmin, frontZ, hindZ,
  };
}
export const _rodinRigCache = new WeakMap();        // geometry -> rigData（同一模型的多匹共用几何）
export function rodinRigOf(geo){
  let d = _rodinRigCache.get(geo);
  if (!d){ d = rodinRigData(geo); _rodinRigCache.set(geo, d); }
  return d;
}

export let _horseLoadStarted = false;
/* 归一化+贴图已在 Blender 里烘好（见 RODIN_GLB 上方的说明），这里只做挂载。
   一个模型都取不到（离线/404）时**保留程序化占位件** —— 马厩不能空着。 */
export function rodinSlotModel(slot, used){
  if (slot.role === 'harnessed') return used.camargue <= used.mongolian ? 'camargue' : 'mongolian';
  if (slot.role === 'graze') return 'camargue';
  if (slot.role === 'fed') return 'mongolian';
  return used.criollo === 0 ? 'criollo' : 'camargue';
}
export function loadRodinHorses(slots){
  const keys = Object.keys(RODIN_GLB);
  Promise.all(keys.map(k => rodinSrcOnce(k).then(s => s).catch(() => null))).then((bases) => {
    const byKey = {};
    keys.forEach((k, i) => { byKey[k] = bases[i]; });
    const used = { camargue: 0, mongolian: 0, criollo: 0 };
    const born = [];
    for (let si = 0; si < slots.length; si++){
      const slot = slots[si];
      const key = rodinSlotModel(slot, used);
      used[key] = (used[key] || 0) + 1;
      const base = byKey[key];
      /* 这个模型没取到：留着占位件（不 push HORSE_LIFE，占位件本来就不会动） */
      if (!base) continue;
      const root = base.clone(true);
      root.name = 'rodinHorse_' + key;
      root.userData.horse = true;
      root.userData.noMerge = true;
      /* 写意艺术处理：卡马格马 / 克里奥罗马（带西式马鞍）是外国马种 → 'foreignHorse'；
         "蒙古马"这个品种名同样只是资产库标签、体型没核对过 → 单列 'labelHorse'（理由见 art-license.js） */
      if (key === 'camargue' || key === 'criollo') markArtLicense(root, 'foreignHorse');
      else if (key === 'mongolian') markArtLicense(root, 'labelHorse');
      let mat = null, geo = null;
      root.traverse(o => {
        if (!o.isMesh) return;
        /* 伪蒙皮只注入了材质着色器、**没注入深度材质** ⇒ 投影会是"没低头的站姿"，
           所以不参与静态阴影图，改用贴地软影（与走路那匹同一口径）。 */
        o.castShadow = false;
        o.receiveShadow = true;
        o.userData.noMerge = true;
        o.frustumCulled = false;
        const m = o.material.clone();          // 每匹一份：rig 的角度挂在 material.userData 上
        m.userData = Object.assign({}, m.userData, { rodin: key });
        m.envMapIntensity = 0.35;
        o.material = m;
        if (!mat){ mat = m; geo = o.geometry; }
      });
      if (!mat || !geo) continue;
      const rig = rodinRigOf(geo);
      /* 伪蒙皮注入：shader 挂在**材质**上，所以每匹各注一次（顶点属性在几何上，
         同模型的第二匹会重写一份等值的 aRigA/aRigB —— 一次性开销，忽略） */
      installHorseRig(mat, geo, rig.W, rig.piv, rig.nose);
      /* 防御性复核：归一化哪天被改坏（脚底不在 0 / 总高差太多），先在控制台点出来 */
      const bb = new THREE.Box3().setFromObject(root);
      const hh = bb.max.y - bb.min.y;
      if (Math.abs(hh - HORSE_TOTAL_H) > 0.12 || Math.abs(bb.min.y) > 0.06)
        console.warn('[马·Rodin] 归一化异常', key, 'H=' + hh.toFixed(3), 'minY=' + bb.min.y.toFixed(3));
      /* 摘占位件：只从场景图摘 + dispose 几何/材质（与 Tinker 路径同口径，否则 6 匹白占显存） */
      const goneGeo = new Set(), goneMat = new Set();
      slot.holders.forEach(h => {
        slot.group.remove(h);
        h.traverse(o => {
          if (o.geometry && !goneGeo.has(o.geometry)){ goneGeo.add(o.geometry); o.geometry.dispose(); }
          const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of ms){ if (!goneMat.has(m)){ goneMat.add(m); m.dispose(); } }
        });
      });
      slot.group.add(root);
      slot.holders = [root];
      attachHorseBlob(slot);
      HORSE_LIFE.push({
        mat, piv: rig.piv, nose: rig.nose,
        group: slot.group, role: slot.role,
        home: slot.home, groundY: slot.groundY,
        gait: slot.gait ? { state: 'graze', timer: 2.5 + _sr() * 3.5,
          dist: 0, target: 0, lastDist: 0, phase: 0, mode: 'walk', lane: slot.gait.lane || 1.2 } : null,
        strideWalk: rig.strideWalk,            // 步幅按这匹的肩高现算 ⇒ 不滑步
        grazeW: (slot.role === 'graze' || slot.role === 'fed') ? 1 : 0,
        gaitW: 0, gaitLegs: null, gaitBob: 0,
        blob: slot.blob || null,
        phase: si * 1.7 + _sr() * 6.28,
        flick: 1.5 + _sr() * 5, flickT: 0,
        headNext: 3 + _sr() * 12, headT: 0, headSide: _sr() < 0.5 ? -1 : 1,
        hoofNext: 5 + _sr() * 10, hoofT: 0, hoofLeg: 0, flare: 0,
        /* 冬天白气：world=false ⇒ 用局部坐标算（见 tickStableLife 的 else 分支） */
        breath: Array.from({ length: 5 }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, world: false })),
        breathNext: 1.2 + _sr() * 2.6, breathCur: 0,
      });
      slot.life = HORSE_LIFE[HORSE_LIFE.length - 1];   // 让"行驶中的辕马"能按槽位找到它
      born.push(key + '@' + slot.role);
      if (!horseBreathMesh.parent) scene.add(horseBreathMesh);
    }
    if (born.length) console.info('[马·Rodin] 换上 ' + born.length + ' 匹：' + born.join(', '));
    else console.warn('[马·Rodin] 三份 GLB 都没取到，保留程序化占位马');
  });
}

export function loadStableHorses(stableGroup){
  const slots = stableGroup && stableGroup.userData && stableGroup.userData.horseSlots;
  if (!slots || !slots.length) return null;
  /* 防重入：延迟批里如果被别处再调一次，会再解析 6 份 ⇒ 同槽位两套马叠在一起。
     （2026-10-21 诊断脚本手动调过一次，补齐这道闸。） */
  if (_horseLoadStarted) return null;
  _horseLoadStarted = true;
  /* 2026-10-23：默认走 Rodin 三匹（自带耳/眼/鼻孔/蹄形 + PBR 贴图）。
     回退 Tinker（骨骼版，动作更细）只需把下面这行改成 false。 */
  if (HORSE_MODEL === 'rodin') return loadRodinHorses(slots);
  /* ══ Tinker 照片级马（2026-10-19）══════════════════════════════════════════
     与旧 Rodin 路径的差别：**每匹单独 parse 一份 glb.scene**。
     不能 `base.clone(true)` —— 克隆不会重绑 Skeleton，蒙皮网格会塌到原点/不显示
     （2026-10-19 实测：loadAssetOnce 的 clone 只出包围盒、画面里没马）。
     6 次 parse 共用同一个 ArrayBuffer 与同一个 Draco 解码器；浏览器只下载一次。 */
  tinkerBuffer().then((buf) => {
    const loader = tinkerLoader();
    (async () => {
      /* 6 匹**并行解析**再逐匹挂载：串行 parse 实测要 8~10s（454 骨骼 × 6），
         并行后 ~2~3s；挂载仍是顺序的（改场景图别并发）。 */
      const parsed = await Promise.all(slots.map(() => new Promise((res) => {
        try { loader.parse(buf.slice(0), '', (gltf) => res(gltf), (e) => { console.warn('[马·Tinker] 解析失败：', e); res(null); }); }
        catch (e) { console.warn('[马·Tinker] 解析异常：', e); res(null); }
      })));
      for (let si = 0; si < slots.length; si++){
        const slot = slots[si];
        const gltf = parsed[si];
        if (!gltf) continue;
        const root = gltf.scene;
        markTinkerHorse(root);
        /* 归一：按包围盒高缩到 HORSE_TOTAL_H，水平居中，脚底 y=0。模型脸朝 +z。 */
        let bb = new THREE.Box3().setFromObject(root);
        const sz = bb.getSize(new THREE.Vector3());
        const sc = HORSE_TOTAL_H / Math.max(1e-6, sz.y);
        root.scale.setScalar(sc);
        root.updateMatrixWorld(true);
        bb = new THREE.Box3().setFromObject(root);
        root.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        root.updateMatrixWorld(true);
        const baseMat = slot.color || MAT.horseChestnut;
        root.traverse(o => {
          if (!o.isMesh) return;
          /* 会走动的马**不投影**：阴影图是"只渲一次"的静态图（renderer.shadowMap.autoUpdate=false），
             身体一移，图里的旧影子会留在原地。改用贴地软阴影（attachHorseBlob）跟着走。
             原地不动的马继续投真实阴影。 */
          o.castShadow = slot.gait ? false : true;
          o.receiveShadow = true;
          o.userData.noMerge = true;
          /* ⚠️ 2026-10-19：**把牙齿网格藏掉** —— 这个模型出厂是"微张嘴"，
             上下齿是**独立网格**（Teeth_UP 挂头骨、Teeth_down 挂下颌），
             近看就是一排白牙 + 粉牙龈 ⇒ 读作"龇牙僵尸脸"（老黄的"僵尸马"）。
             合上嘴（jaw 静态 -0.46rad）+ 藏牙 ⇒ 嘴只剩贴图上的唇线。 */
          if (/teeth/i.test(o.name || '')) { o.visible = false; o.castShadow = false; }
          /* ⚠️ 蒙皮网格的包围球是"绑定姿态"算的，骨骼一动就会误剔除 ⇒ 关掉视锥剔除。
             只有 7 个网格 × 6 匹 = 42 个，代价可忽略。 */
          if (o.isSkinnedMesh) o.frustumCulled = false;
          o.material = tinkerMaterial(o.material, baseMat.color, o.name);
          /* 马身网格：烘**顶点色标记**（黑腿/暗口鼻）—— 代替那张 UV 图集里画好的部件颜色 */
          if (/Horse_LP/i.test(o.name || '')) { markCoatPoints(o); slimNeck(o); }
          /* ⚠️ 2026-10-21（老黄："恐怖片"）：模型给的眼是**整颗 5.6cm 的黑球**全露在脸外
             ⇒ 近看是虫眼/塑料珠。缩到 0.6（≈3.4cm，球心仍在皮下 ⇒ 只露角膜那一点），
             材质压成深褐带一点湿光（roughness 0.5）而不是死黑。 */
          if (/^Eye_/i.test(o.name || '')){
            o.scale.setScalar(0.6);
            o.material.roughness = 0.5;
          }
        });
        const bones = {};
        root.traverse(o => { if (o.isBone) bones[o.name] = o; });
        const rest = {};
        for (const n of TINKER_ANIM_BONES) if (bones[n]) rest[n] = bones[n].quaternion.clone();
        const missing = TINKER_ANIM_BONES.filter(n => !bones[n]);
        if (missing.length && !_tinkerWarned){ _tinkerWarned = true; console.warn('[马·Tinker] 缺骨骼：' + missing.join(',')); }
        /* 换装：摘掉程序化替身，挂上真马（与旧路径同一套 holder 语义）
           ⚠️ 2026-10-19：摘掉之后**必须把替身的几何/材质从显卡里退掉** ——
           `remove()` 只是从场景图断开，geometry/material 仍被 renderer 的资源表持有、
           直到 dispose 才释放。实测（outputs/_diag/_tmp-geos-growth.mjs，同一 boot 稳态）：
             · 场景内唯一几何 803，而 renderer.memory.geometries = 968 ⇒ **165 个是游离残留**；
             · 对照组（bd69f63 无真马，不换装）geometries = 707 且与场景内数量一致。
           6 匹替身各 ~28 个零件 ⇒ 正好对上 165。这 165 个一直占显存、也让
           smoke 的「几何数量健康」判据从 803 抬高到 968（上限 950 ⇒ 红）。
           注意只 dispose 替身：真马刚 parse 出来的几何还要用，别碰。 */
        const disposedGeo = new Set(), disposedMat = new Set();
        slot.holders.forEach(h => {
          slot.group.remove(h);
          h.traverse(o => {
            if (o.geometry && !disposedGeo.has(o.geometry)){ disposedGeo.add(o.geometry); o.geometry.dispose(); }
            const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            for (const m of ms){ if (!disposedMat.has(m)){ disposedMat.add(m); m.dispose(); } }
          });
        });
        root.userData.horse = true;
        slot.group.add(root);
        slot.holders = [root];
        if (slot.gait) attachHorseBlob(slot);
        HORSE_LIFE.push({
          anim: { bones, rest, root }, group: slot.group, role: slot.role,
          /* 2026-10-21 步态：home/groundY 用来算位移与落地高度；gait 为空 = 原地不动。 */
          home: slot.home, groundY: slot.groundY,
          gait: slot.gait ? { state: 'graze', timer: 2.5 + _sr() * 3.5,
            dist: 0, target: 0, lastDist: 0, phase: 0, mode: 'walk', lane: slot.gait.lane || 1.2 } : null,
          grazeW: (slot.role === 'graze' || slot.role === 'fed') ? 1 : 0,
          gaitW: 0, gaitLegs: null, gaitBob: 0,
          blob: slot.blob || null,
          phase: HORSE_LIFE.length * 1.7 + _sr() * 6.28,
          flick: 1.5 + _sr() * 5, flickT: 0,
          headNext: 3 + _sr() * 12, headT: 0, headSide: _sr() < 0.5 ? -1 : 1,
          hoofNext: 5 + _sr() * 10, hoofT: 0, hoofLeg: 0, flare: 0,
          /* 白气：六匹都给（老黄："冬天鼻孔和嘴巴会冒白色热气"），每匹 5 团 */
          breath: Array.from({ length: 5 }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, world: true })),
          breathNext: 1.2 + _sr() * 2.6, breathCur: 0,
        });
        slot.life = HORSE_LIFE[HORSE_LIFE.length - 1];   // 同 Rodin 路径：行驶时按槽位取
        if (!horseBreathMesh.parent) scene.add(horseBreathMesh);
        /* ── 长尾束（2026-10-20 · 老黄："马尾巴不是兔子尾巴或者狗尾巴"）──────────────
           实测（probe/_tmp-tinker-tailbones.py，Blender 5.2 导入 tinker-raw.glb）：
             导出件自带 Tail 网格只有 105 顶点、世界尺寸 0.073×0.115×**0.212m**，
             尾骨链 ORG-tail.001→.005 世界坐标 (0,1.201,1.090)→(0,1.390,0.907)，整链 **0.21m**。
             真马（本仓 HORSE_TOTAL_H=1.75m）尾长应到飞节（膝下）≈ **0.85m**。
           ⇒ 做法：把自带那块小尾骨网格**藏掉**，另挂一条程序化长尾束。
           ⚠️⚠️ 为什么用"挂骨节点"而不是给新几何做蒙皮：
             新几何要跟着甩尾动画动，最省事且不会出错的做法是**把它挂到既有的尾骨节点下**
             （作为子节点）——骨一摆，它跟着摆，零额外动画代码，也不会出现
             "蒙皮索引指错骨骼 ⇒ 尾巴瞬移到别处"那类事故。
             （本段第一版写成手工 skinIndex 绑定，索引对不上骨骼表 ⇒ 已弃用，别改回去。）
           形态要点（与程序化替身 horseTail 同源的三条）：
             ① 尾根**埋进臀内 4cm** 再往外长；② 主干**向下垂**（真马尾近垂直）；
             ③ 主干粗、散毛贴拢 ⇒ 读作"一束"，不是几根带子。
           ⚠️ 用私有流 _sr()（与替身尾巴同一套确定性做法），不碰全局 rnd ⇒ 布局指纹不漂。 */
        const tailMesh = root.getObjectByName('Tail');
        if (tailMesh) tailMesh.visible = false;      // 藏掉 0.21m 的"兔子尾巴"
        {
          /* ⚠️ 骨名必须用「洗名后」拼写：加载器把点删掉（ORG-tail.001 → ORG-tail001，
             vendor.js createUniqueName 一段可证），写带点的永远找不到——2026-10-20 踩过。
             挂点首选 tail001：尾网格主链、甩尾动作转的就是它（DEF 是体上副本、ORG 是控制链）。 */
          const tRoot = bones['tail001'] || bones['DEF-tail001'] || bones['ORG-tail001'];
          if (tRoot){
            /* 长尾束：在**尾根骨节点**的本地坐标系里建模（骨节点自身在导出件里已带缩放/位移），
               这样它天然跟着骨链走；骨链摆多少它就跟多少。 */
            const LEN = 1.00;                       // 垂到蹄毛（真马尾从尾骨到蹄毛 ≈ 0.9~1.0m）
            const tailG = new THREE.Group();
            tailG.name = 'horseTailLongG';
            tailG.userData.noMerge = true;
            /* ⚠️⚠️ 2026-10-20 二修·已修复（首版出图判读：散毛扇形张开且上翘，像扫帚/鸡爪）：
               骨节点的局部轴 ≠ 世界轴 —— tail001 的骨轴本就斜向后上，直接在骨本地坐标里
               画"向下"会画歪。修法：用骨节点**挂载时刻（静止姿态）的世界朝向**把组的
               坐标系反补正 ⇒ 组里画的"下"就是世界的下；之后骨节随甩尾摆动时组跟着摆，
               长尾依然跟甩尾联动（组是骨的子节点，继承其一切旋转）。 */
            const bq = new THREE.Quaternion();
            tRoot.getWorldQuaternion(bq);
            tailG.quaternion.copy(bq).invert();
            /* ⚠️⚠️ 2026-10-21（老黄："短狗尾"）：尾根要**往后挪**到臀后。
               真马尾巴从骶骨（臀后）垂下、在两条后腿**之外**；挂在尾骨节点原位时
               它垂在两腿之间 ⇒ 侧视几乎全被后腿挡住（实测：尾巴屏幕投影 103×308px，
               但可见部分只有一小条）⇒ 画面上就是"没有尾巴/短狗尾"。
               位移方向用"马的前方"在**骨局部系**里求（不写死 ±z —— 六匹马朝向各不相同）。 */
            {
              root.updateMatrixWorld(true);
              const fwdW = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld);
              const inv = new THREE.Matrix4().copy(tRoot.matrixWorld).invert();
              const fwdB = fwdW.clone().transformDirection(inv);
              tailG.position.copy(fwdB).multiplyScalar(-0.14);      // 往臀后 14cm（贴臀不断开，见下）
            }
            /* 尾要**向下且略向后**（补正后的组系≈世界系）：身体前方是 -z ⇒ 取 +z 为马体后方。
               ⚠️ 2026-10-21（老黄："短狗尾"）：真马尾是**长而宽的一束**（从尾骨垂到蹄毛、
               走路时左右分开），0.85m 的细束在画面里读作"狗尾巴"。
               ⇒ 长度 0.85→1.00m、束芯加粗（5.5cm→…见下）、散毛末端散开 1.35 倍、
                 整束略向后倾（0.14→0.20）⇒ 明确挂在后腿之外，不是贴在腿缝里。 */
            const DOWN = new THREE.Vector3(0, -1, 0.20).normalize();
            /* ⚠️ 2026-10-20 总控定稿（第 7 版）：**颜色按每匹马的毛色派生**，不再一律灰。
               真马：鬃尾与体毛同色系、比体毛深一档（青灰马配深灰尾、枣红马配深褐尾、
               黑马配近黑尾、白马配浅灰尾）⇒ tailCol = 体毛色 × 0.42。
               之前用固定浅灰 0x6B6259/0x5A5248：在浅灰马身上读作"灰毛团"，
               在黑马身上读作"灰绳"，两头都不对。 */
            const tailCol = baseMat.color.clone().multiplyScalar(0.42);
            const tailMat = new THREE.MeshStandardMaterial({
              color: tailCol, roughness: 0.75, metalness: 0.0, envMapIntensity: 0.30 });
            /* 变径管复用 06i 的 tubeRadiusRamp（自带端盖，别手搓建管 ——
               makeHorse 里的 tube() 是函数内局部量，这里用不到它）。 */
            const tailTube = (pts, r0, r1, seg, rad) => {
              const curve = new THREE.CatmullRomCurve3(pts);
              return tubeRadiusRamp(new THREE.TubeGeometry(curve, seg, 1, rad, false),
                curve, seg, rad, t => r0 + (r1 - r0) * t);
            };
            /* 尾束几何 v9 = **尾 dock + 错根毛帘**（2026-10-21 红框："拼接"、尾巴与屁股断开）。
               ⚠️ v8 毛帘的两个病根：① 尾根挪出 32cm ⇒ 尾巴**飘在屁股后面**、顶端收成
               一个点 ⇒ 读作"扫帚柄 + 刷毛"；② 70 根全从同一点发出 ⇒ 顶端一束"柄"。
               真马尾：骶骨尾 dock（短毛、小、贴着臀）+ 毛发**沿整条 dock 长出来**
               （上段密贴、下段散开），根部永远连在臀上。
               做法：① 尾根只后挪 **14cm**（刚出臀面不断开）；② 一段短 dock 管
               （r 3.0→2.2cm、长 24cm，上端埋进臀里）；③ 70 根细管**沿 dock 全长
               错开起根**（yStart −0.02~−0.20、根盘半径 2.4cm）⇒ 没有"柄"、没有断缝；
               ④ 整束仍合并 1 网格、挂一骨、整束一起摆。 */
            const tailGeos = [];
            const dockPts = [new THREE.Vector3(0, 0.035, -0.008),
              DOWN.clone().multiplyScalar(0.12), DOWN.clone().multiplyScalar(0.235)];
            tailGeos.push(tailTube(dockPts, 0.030, 0.022, 6, 7));
            const N_STRANDS = 70;
            for (let i = 0; i < N_STRANDS; i++){
              const a = (i / N_STRANDS) * Math.PI * 2 + _sr() * 0.15;   // 绕 dock 均布 + 微抖
              const splay = 0.35 + 0.65 * _sr();                        // 散开系数：上密下松
              const yStart = -0.02 - 0.18 * _sr();                      // 沿 dock 全长错开起根
              const len = LEN * (0.72 + 0.18 * _sr());                  // 长短错落
              const wave = (_sr() - 0.5) * 0.06;                        // 自然波浪
              const rad = 0.0020 + 0.0015 * _sr();                      // 半径 2.0~3.5mm（真毛粗细）
              const r00 = 0.024;                                        // 根盘半径：贴着 dock 表面
              const pts = [];
              const NSEG = 10;
              for (let k = 0; k <= NSEG; k++){
                const u = k / NSEG;                                     // 0 根 → 1 尖
                const y = yStart - len * u;
                const x = Math.cos(a) * (r00 * (1 - u * 0.5) + 0.15 * u * splay)
                  + wave * Math.sin(u * 3.1);
                const z = Math.sin(a) * (r00 * (1 - u * 0.5) + 0.15 * u * splay) * 0.55
                  + yStart * 0.20 + wave * Math.cos(u * 2.7) * 0.4;
                pts.push(new THREE.Vector3(x, y, z));
              }
              const curve = new THREE.CatmullRomCurve3(pts);
              const g = new THREE.TubeGeometry(curve, NSEG, rad, 6, false);
              tailGeos.push(g);
            }
            const tailMerged = mergeGeometries(tailGeos, false);
            if (tailMerged){
              const tailMeshNew = new THREE.Mesh(tailMerged, tailMat);
              tailMeshNew.name = 'horseTailLong';
              tailMeshNew.castShadow = true;
              tailMeshNew.receiveShadow = true;
              tailMeshNew.userData.noMerge = true;
              tailG.add(tailMeshNew);
            } else {
              /* 合并不成（属性不齐）就退回单件，绝不丢尾巴 */
              for (const geo of tailGeos){
                const m = new THREE.Mesh(geo, tailMat);
                m.castShadow = true; m.userData.noMerge = true;
                tailG.add(m);
              }
            }
            for (const o of tailG.children){ o.castShadow = true; o.receiveShadow = true; o.userData.noMerge = true; }
            tRoot.add(tailG);
          } else if (!_tinkerWarned){
            _tinkerWarned = true;
            console.warn('[马·Tinker] 找不到尾骨（tail001），未加长尾');
          }
        }
      }
      /* 阴影图快照过期：换马后必须重渲一次（否则地上还是替身的腿影） */
      markCasterBoxDirty();
      renderer.shadowMap.needsUpdate = true;
      console.log('[马·Tinker] ' + slots.length + ' 匹已装配（骨骼 ' + (HORSE_LIFE[0] ? Object.keys(HORSE_LIFE[0].anim.bones).length : 0) + ' 根/匹）');
    })();
  }).catch((e) => {
    console.warn('[马·Tinker] 资产失败，保留程序化替身：', e);
  });
  return slots;
}

/* ── 一匹马 ─────────────────────────────────────────────────────────────────
   ✅ 2026-10-10：**改用它处下载/生成的真模型**（见 08-assemble 的 placeStableHorses 与
      assets/Horse.glb）。下面这份程序化马**保留**为**离线/加载失败时的替身**
      （与芭蕉/荷花那条"资产失败必须有替身"的既有约定一致）。
   ⚠️ 保留它的第二个理由：本项目"零外部文件也能开园"是既有取舍，替身不能删。
   形态要点（远看能读成"这是马"的三件事）：① 长颈长头；② 四条**深色**细腿 + 小蹄
   （深色"袜"是把四条腿从身体里分出来的关键 —— 整条腿同色时出图判读"找不到腿"）；
   ③ 深色鬃尾。躯干/颈/头/腿都用变速管（沿曲线变径的管），颈+头+耳+鬃挂 headG ⇒
   `graze` 一转就是低头吃草。 */
/* ── 马皮"毛发"贴图组（2026-10-16 · 老黄："马还是模型的表面，没有毛发遮挡，还会反射太阳光"）
   一张各向异性高度场 → 派生 ①毛流图（map）②粗糙度图 ③法线图，同一处生成，三张必然对得上。
   程序化合成、确定性（固定种子的 mulberry32，**不吃全局 rnd 流** —— 否则全园抽样会漂）。
   ⚠️ 三层都用**整数格数**的正方形网格按模回绕采样：格子数整除贴图边长 ⇒ 平铺无缝，
      与本项目其它 Canvas 贴图同一套做法（重复 2×2 时不能有接缝）。
   ⚠️ 最细一层的格宽 8px（512/64）—— 再细就过采样，远景会闪（mipmap 也救不了）。 */
export let _horseCoat = null;
  // eslint-disable-next-line no-unused-vars -- 保留：换回 Tinker 模型时的程序化毛流贴图
export function horseCoatMaps(){
  if (_horseCoat) return _horseCoat;
  const S = 512;
  const r2 = prRange(mulberry32(20261016));   // 私有流（区间映射，见 prRange 的警告）
  /* cx/cy = 一层在横向/纵向铺多少个格。cx ≫ cy + 整数格 ⇒ 顺向的毛流。
     ⚠️ 配比按两轮实测调过（这是第三次）：
        第一版三层（12/28/64）峰值太软（中心差分只有 ~0.05）⇒ 像素对比度不到 4%，2m 外等于没画；
        第二版把低频层（cx=12, cy=2）加重 ⇒ **跑过头**，出来的是几道又长又宽的斜带，
        马读成"一块雕花的木头"。
        现在低频只留一点点（cx 8/16 合计 0.26）、重量压在中高频（32/64/128 合计 0.74），
        cy 普遍抬高 ⇒ 条带变**短而密**，是"毛"不是"年轮"。 */
  const OCT = [{ cx: 8,   cy: 4,  w: 0.10 },
               { cx: 16,  cy: 6,  w: 0.16 },
               { cx: 32,  cy: 10, w: 0.24 },
               { cx: 64,  cy: 18, w: 0.28 },
               { cx: 128, cy: 32, w: 0.22 }];
  const H = new Float32Array(S * S);
  for (const o of OCT){
    const { cx, cy, w } = o;
    const g = new Float32Array(cx * cy);
    for (let i = 0; i < g.length; i++) g[i] = r2(-1, 1);
    for (let y = 0; y < S; y++){
      const fy = y / S * cy, iy = Math.floor(fy), ty = fy - iy;
      const r0 = iy % cy, r1 = (iy + 1) % cy;
      const row0 = r0 * cx, row1 = r1 * cx;
      for (let x = 0; x < S; x++){
        const fx = x / S * cx, ix = Math.floor(fx), tx = fx - ix;
        const c0 = ix % cx, c1 = (ix + 1) % cx;
        const a = g[row0 + c0], b = g[row0 + c1], c = g[row1 + c0], d = g[row1 + c1];
        H[y * S + x] += w * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
      }
    }
  }
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = S; return cv; };
  const cvC = mk(), cvR = mk(), cvN = mk();
  const xc = cvC.getContext('2d'), xr = cvR.getContext('2d'), xn = cvN.getContext('2d');
  const imgC = xc.createImageData(S, S), imgR = xr.createImageData(S, S), imgN = xn.createImageData(S, S);
  const at = (x, y) => H[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
  const grey = (v, img, o4) => { const q = Math.max(0, Math.min(255, v)) | 0;
    img.data[o4] = q; img.data[o4 + 1] = q; img.data[o4 + 2] = q; img.data[o4 + 3] = 255; };
  const K = 18;                                // 梯度 → 法线的斜率增益（K40 那版把马打成搓衣板，K7 太软看不出）
  for (let y = 0; y < S; y++){
    for (let x = 0; x < S; x++){
      const h = H[y * S + x];
      const o4 = (y * S + x) * 4;
      /* ① 毛流（map）：**只做暗化**，范围 0.945~1.00。
         ⚠️ 幅度按三轮实测收敛：0.58 那次是"雕花的木头"，0.80 那次是**虎斑**
         （10cm 宽的黑斜纹，远看像斑马）—— 这里要的是"表面不平"，不是"有条纹"。
         起伏交给法线图去做（下面 ③），颜色只留一层几乎看不见的呼吸。 */
      grey((0.9725 + 0.0275 * h) * 255, imgC, o4);
      /* ② 粗糙度（roughnessMap 读 .g）：范围 0.88~1.00，只留起伏，不自己造光滑斑块 */
      grey((0.94 + 0.06 * Math.abs(h)) * 255, imgR, o4);
      /* ③ 法线：高度场中心差分 → 切线空间法线。K 18 ≈ 峰值斜度 0.5rad——
         掠射光下起绒，又不至于把表面打成搓衣板（K 40 那版就是搓衣板）。 */
      let nx = -(at(x + 1, y) - at(x - 1, y)) * K;
      let ny = -(at(x, y + 1) - at(x, y - 1)) * K;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv; ny *= inv;
      imgN.data[o4]     = (nx * 0.5 + 0.5) * 255;
      imgN.data[o4 + 1] = (ny * 0.5 + 0.5) * 255;
      imgN.data[o4 + 2] = (inv * 0.5 + 0.5) * 255;
      imgN.data[o4 + 3] = 255;
    }
  }
  xc.putImageData(imgC, 0, 0);
  xr.putImageData(imgR, 0, 0);
  xn.putImageData(imgN, 0, 0);
  const prep = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);                        // 拉高频率：2×2 时条纹太宽，整匹马读成虎斑
    t.anisotropy = 4;
    return t;
  };
  /* ⚠️ 色域三张各不相同，错了就是整体偏亮/偏暗或光照错向：
       · color 是**颜色**贴图 ⇒ 必须 SRGBColorSpace；
       · roughness / normal 是**数据**贴图 ⇒ 必须留在线性（NoColorSpace，CanvasTexture 默认值），
         标成 sRGB 会把数值掰弯、法线直接指错方向。 */
  const color = prep(cvC);
  color.colorSpace = THREE.SRGBColorSpace;
  _horseCoat = { color, rough: prep(cvR), normal: prep(cvN) };
  return _horseCoat;
}

export function makeHorse(coatMat = MAT.horseChestnut, opts = {}){
  const g = new THREE.Group();
  const mane = opts.maneMat || MAT.horseMane;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const tube = (pts, radiusAt, seg = 12, rad = 8, mat = coatMat, name = '') => {
    const c = new THREE.CatmullRomCurve3(pts);
    const geo = tubeRadiusRamp(new THREE.TubeGeometry(c, seg, 1, rad, false), c, seg, rad, radiusAt);
    return mesh(geo, mat, { name, cast: true });
  };
  g.add(tube([P(0, 1.10, -0.55), P(0, 1.16, -0.28), P(0, 1.12, 0.05), P(0, 1.18, 0.32), P(0, 1.22, 0.44)],
    t => 0.20 - 0.05 * Math.pow(Math.abs(t * 2 - 1), 1.6), 14, 10, coatMat, 'horseBody'));
  const headG = new THREE.Group();
  headG.position.set(0, 1.16, 0.40);
  headG.rotation.x = opts.graze || 0;
  g.add(headG);
  const H = (x, y, z) => new THREE.Vector3(x, y - 1.16, z - 0.40);
  headG.add(tube([H(0, 1.16, 0.40), H(0, 1.34, 0.52), H(0, 1.50, 0.60), H(0, 1.57, 0.66)],
    t => 0.155 - 0.055 * t, 8, 8, coatMat, 'horseNeck'));
  headG.add(tube([H(0, 1.57, 0.66), H(0, 1.50, 0.82), H(0, 1.42, 0.96), H(0, 1.35, 1.08)],
    t => 0.105 - 0.043 * t, 7, 7, coatMat, 'horseHead'));
  const cheek = mesh(new THREE.SphereGeometry(0.098, 8, 6), coatMat, { name: 'horseCheek' });
  cheek.position.copy(H(0, 1.47, 0.86)); cheek.scale.set(0.85, 0.95, 1.25); headG.add(cheek);
  const muzzle = mesh(new THREE.SphereGeometry(0.068, 8, 6), mane, { name: 'horseMuzzle' });
  muzzle.position.copy(H(0, 1.34, 1.09)); muzzle.scale.set(0.95, 0.88, 1.15); headG.add(muzzle);
  for (const sx of [-1, 1]){
    const ear = mesh(new THREE.ConeGeometry(0.042, 0.115, 5), mane, { name: 'horseEar' });
    ear.position.copy(H(sx * 0.052, 1.685, 0.645)); ear.rotation.x = -0.24; ear.rotation.z = sx * 0.18;
    headG.add(ear);
  }
  for (let i = 0; i < 4; i++){
    const k = i / 3;
    const m = mesh(box(0.045, 0.18, 0.15), mane, { name: 'horseManeTuft' });
    m.position.copy(H(0, 1.44 + k * 0.12 + 0.06, 0.44 + k * 0.11));
    m.rotation.x = -0.55 + k * 0.18;
    headG.add(m);
  }
  const legs = [
    [-0.135, 1.00, 0.30, 0.32, false], [0.135, 1.00, 0.30, 0.32, false],
    [-0.145, 1.05, -0.40, -0.36, true], [0.145, 1.05, -0.40, -0.36, true],
  ];
  for (const [lx, ly, lz, fz, hind] of legs){
    const kneeY = ly * (hind ? 0.58 : 0.52);
    const kneeZ = hind ? lz + 0.11 : lz - 0.02;
    g.add(tube([P(lx, ly, lz), P(lx, kneeY, kneeZ)], t => 0.088 - 0.022 * t, 6, 6, coatMat, 'horseLegUp'));
    g.add(tube([P(lx, kneeY, kneeZ), P(lx, 0.13, fz)], t => 0.052 - 0.010 * t, 6, 6, mane, 'horseLegLow'));
    const hoof = mesh(new THREE.CylinderGeometry(0.062, 0.070, 0.085, 8), mane, { name: 'horseHoof' });
    hoof.position.set(lx, 0.043, fz); g.add(hoof);
  }
  g.add(tube([P(0, 1.24, -0.58), P(0, 1.06, -0.72), P(0, 0.82, -0.78), P(0, 0.58, -0.75)],
    t => 0.075 - 0.030 * t, 7, 6, mane, 'horseTail'));
  if (opts.saddle){
    const pad = mesh(box(0.34, 0.06, 0.42), MAT.harness, { name: 'horseSaddle' });
    pad.position.set(0, 1.28, 0.06); g.add(pad);
    const girth = mesh(new THREE.TorusGeometry(0.21, 0.022, 4, 10), MAT.harness, { name: 'horseGirth' });
    girth.position.set(0, 1.14, 0.06); girth.rotation.y = Math.PI / 2; g.add(girth);
  }
  g.userData.horse = true;
  return g;
}

/* ── 双轮马车（2 匹马拉：两辕 + 一舆）────────────────────────────────────────
   中式双轮车的关键件：**两根辕**（自舆底两前角向前上方伸出，夹住两匹马的肩）、
   **辐条大轮两只**、**舆**（车箱）、**篷**（半圆筒罩住后半）。
   opts.detached = true ⇒ **卸了马的停车状态**：车辕**抬起**、下面支一根"支辕棍"
   （真实停车就这么放，免得辕头戳地）—— 与"套着马待发"那驾形成对照。 */
/* ══ 可行驶的马车（2026-10-23 · 客人到访的"马车版"）════════════════════════════
   院子里的 carA 原本是**静态陈设**：会被 mergeStatics 烘进 mergedStatic，而且
   `renderer.shadowMap.autoUpdate=false`，它的影子也是烘死的一次快照。
   要让它真的开起来，三件事缺一不可：
     ① **noMerge**（逐网格打标）—— 否则几何被烘进合并结果，车开走以后原地还留着一辆"ghost"；
     ② **castShadow=false + 贴地软影** —— 否则影子永远留在停车位、走到哪都没有脚影（同 15 的走路马）；
     ③ **合并静态件** —— 45 个网格挂 noMerge 就是 45 个 draw call；按材质并成 1~2 个，
        只把两只车轮留成独立组（要转）。
   ⚠️ 合并只在本地空间做（applyMatrix4 用"相对车组的矩阵"），所以之后整组平移/旋转照常有效。 */
