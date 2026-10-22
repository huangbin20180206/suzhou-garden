// 16-actors: 把 AI 生成的半写实人物接进场景（2026-10-21 · P1 / 2026-10-22 · P2 步态）
//
// 设计取舍（与 15-stable 的马同一套）：
//   · 每个实例**单独 parse 一份 GLB**，不用 clone —— clone 会共享 Skeleton，
//     多个人物会共用一套骨（vendor 里也没有 SkeletonUtils）。
//   · 加载成功才隐藏程序化替身；失败/离线时替身照常站着，场景不空。
//   · 不烘焙动画：走路由程序化步态驱动（同 08b 的 driveWalkers 一套口径 —— 0.42m/步），
//     骨骼只写四元数、root 只写 position.y / rotation.y。
//   · 动作只写骨骼四元数（以绑定姿态为基准），不改 mesh / 不改材质贴图。
//
// ── 裙摆（P2 更正 2026-10-22）─────────────────────────────────────────────────
// P1 的注释写着"裙摆权重挂在腿上，走动会撕，等补裙骨"。实测（outputs/_diag/
// actor-stride.mjs：大腿 ±0.38rad + 小腿 −0.18rad，两位人物前/侧各一张）**没有撕**：
// 长袍/长裙是锥面，跟着大腿摆、下摆随脚露出鞋面，读数正常。所以走路不必等裙骨；
// 幅度按 GAIT.amp=0.27 收着用（≈15.5°），比测试的 0.38 更保守。
// 真正需要裙骨的是**极大幅度**（抬腿/坐/跪），那些动作继续押后。

import { THREE, GLTFLoader } from '../vendor.js';
import { scene, renderer } from './02-scene.js';
import { groundHeight } from './05-water.js';
import { markCasterBoxDirty } from './09-lights.js';
import { figures } from './08b-figures.js';
import { PROP_SPOTS } from './14-props.js';
import { HOOKS } from './00-config.js';

const ACTORS = [];
let _built = false;
let _t = 0;

/* ── 步态常数（口径对齐 08d 的 WALK_STRIDE=0.42 / WALK_BOB=0.028）────────────
   相位的推进按**走过的距离**算，不按时间：站下/转身/上坡都不会出现"脚在原地划"。
   步长 0.42m 时，一条腿一个完整周期 = 两步 = 0.84m ⇒ p = 距离/0.42 × π。 */
const STEP_LEN = 0.42;
const GAIT = {
  amp: 0.27,        // 大腿前后摆（≈15.5°；测试到 0.38 裙面仍干净，留余量）
  knee: 0.40,       // 摆动期屈膝（负号 = 小腿往后勾）
  foot: 0.12,       // 踝：跟落/趾离的小幅补偿
  bob: 0.022,       // 重心起伏（比散步者 0.028 小一号 —— 人物脚是真的在动）
  hipYaw: 0.055,    // 骨盆扭转
  hipRoll: 0.030,   // 骨盆侧倾（支撑腿一侧高一侧低）
  chestYaw: 0.045,  // 上身反向扭转
  turn: 2.1,        // 原地转身角速度 rad/s（比散步者 4.0 慢：真人不甩头）
};
const TURN_GATE = 0.55;   // 朝向偏差超过这个就"站住转身"，不再平移

const LADY_SPOT = PROP_SPOTS.ladyWell;
const LADY_YAW = Math.atan2(PROP_SPOTS.well.x - LADY_SPOT.x, PROP_SPOTS.well.z - LADY_SPOT.z);

/* route = 往复踱步线（端点交替）。y 一律现算 groundHeight，不给写死的高度：
   两位人物站的草坪是一片缓坡，写死等于在坡上悬空/陷地。 */
const DEFS = [
  {
    id: 'scholar',
    url: 'assets/fig-scholar.glb',
    height: 1.72,
    hidePose: 'read',
    tint: 0xAEB9C9,          // 生成件偏亮蓝；压一点饱和，贴近场景的工笔淡彩
    spot: { x: 1.2, z: -5.7, yaw: 0.42 },
    /* 文士**不踱步**（route: null 是刻意的）：他和两个书童是"半围"阵型，
       东侧 0.6m 就是书童，直线段必然擦身而过。他的动作留给"晨读→背手观景"。 */
    route: null,
    /* armDown：生成件是 A 姿势（手臂抬 40°），站桩像展示人偶。
       实测 LeftUpperArm Y=+0.8 / RightUpperArm Y=-0.8 能把两臂放下来、手掌朝内。 */
    idle: { breath: 0.016, head: 0.055, sway: 0.007, phase: 0.0, armDown: 0.80 },
  },
  {
    id: 'lady',
    url: 'assets/fig-lady.glb',
    height: 1.63,
    hidePose: 'draw',
    tint: 0xE9DFF5,          // 生成件近白；乘成淡紫，和场景里的藕色/墨色分开
    spot: { x: LADY_SPOT.x, z: LADY_SPOT.z, yaw: LADY_YAW },
    /* 井边这块院子被芭蕉/井架/山石夹着（outputs/_diag/actor-grid.mjs 的 0.25m 网格：
       x=−19.2 一列往北到 z=−7.4 全是 ground、高差 ≤0.03m，是最干净的一条）。 */
    route: { pts: [[LADY_SPOT.x, LADY_SPOT.z], [-18.85, -7.35]], speed: 0.58, pause: [5.0, 9.0] },
    idle: { breath: 0.013, head: 0.045, sway: 0.010, phase: 1.7 },
  },
  {
    id: 'laborer',
    url: 'assets/fig-laborer.glb',
    height: 1.70,
    hidePose: 'pointDown',   // 马厩那个"递草"替身（08b 的 pose:'pointDown'）
    tint: 0xDFE2D8,          // 冷一点的灰，和院子的黄沙地分开（暖米色会糊在沙里）
    /* 落点：马厩院里那匹低头就食的枣马（马嘴世界 ≈ (38.5, 0.87, 1.81)）。
       ⚠️ 第一版放在马嘴正前方 (38.15, 2.05) 面朝马 —— 出图是"人挡在马脸前、背对镜头"，
          而且 z>2.0 已经出了 yardWear 院子面（落回地形，矮 6cm）。
       ⇒ 改站马头**西侧** (38.0, 1.40)，侧身朝东（yaw=π/2）：人→马嘴连线顺着画面横轴，
          两个剪影不重叠，脚也落在院子面（实测 yardWear 0.100~0.103；x<37.8 West 边界外就掉回地形 0.045）。
       ⚠️ z=2.3 那条线是 stableGateSill（门槛面 0.213），站进去会半埋。 */
    spot: { x: 38.0, z: 1.40, yaw: Math.PI * 0.5 },
    floorRay: true,          // 台基/院子面不是地形：groundHeight 会让他陷 6cm
    route: null,
    /* 前俯 + 低头 = "把草料递到马嘴前"。手臂**不动**：这只 rig 的腰带带误权重
       （见 research/characters/repair_hands.py 注释），转肩会把腰带拽成尖刺。 */
    idle: { breath: 0.012, head: 0.035, sway: 0.006, phase: 3.1, lean: 0.11, headDown: 0.26 },
  },
  /* 两个书童（08b 的 'child' 一对，半围在先生两侧）。一件资产、两次 parse：
     高度/色调/相位各差一点，避免看出是同一个人在照镜子。
     朝向沿用 08b 原值（0.33×atan2(…)，即"斜着朝先生"而不是正对）。 */
  {
    id: 'child1',
    url: 'assets/fig-child.glb',
    height: 1.20,
    hidePose: 'child',
    tint: 0xEFE4DC,
    spot: { x: 1.80, z: -5.25, yaw: -2.21 },   // 面向先生（1.2,−5.7）
    route: null,
    idle: { breath: 0.018, head: 0.055, sway: 0.009, phase: 0.9 },
  },
  {
    id: 'child2',
    url: 'assets/fig-child.glb',
    height: 1.16,
    hidePose: 'child',
    tint: 0xDCE0E8,
    spot: { x: 0.62, z: -5.10, yaw: 2.37 },    // 面向先生（1.2,−5.7）
    route: null,
    idle: { breath: 0.016, head: 0.05, sway: 0.008, phase: 4.2 },
  },
];

/* 隐藏程序化替身。near 给了就按**最近的那个**挑：
   poseName 不是唯一的（08b 里两个书童都叫 'child'、家里三个孩子都叫 'watchChild'），
   只按 poseName 取第一个会让"两个书童换掉一个、另一个留着"这种半残状态悄悄发生。 */
function hideProcedural(poseName, near){
  const all = figures.filter(x => x.userData && x.userData.poseName === poseName);
  if (!all.length) return;
  let f = all[0];
  if (near){
    let best = Infinity;
    for (const c of all){
      const d = (c.position.x - near.x) ** 2 + (c.position.z - near.z) ** 2;
      if (d < best){ best = d; f = c; }
    }
  }
  /* 11-loop 每帧按 slot 写 visible ⇒ 不能只写 visible=false。
     h0=99 让"时段门"永远不成立，替身就不会再被放出来。 */
  if (f.userData.slot) f.userData.slot.h0 = 99;
  f.visible = false;
  f.userData.replacedByGLB = true;
}

function tintMaterial(m, tint){
  if (!m) return;
  m.color = new THREE.Color(tint);
  m.roughness = 0.92;
  m.metalness = 0.0;
  m.envMapIntensity = 0.20;
  m.needsUpdate = true;
}

/* G6 接线：预载清单要求 src 里出现**字面 URL** 的 settleAsset 调用，
   写成 def.url 变量不算（probe/preload-manifest-sync 的正则只认字面量）。
   所以这里显式按 id 分派，别改成通用变量。 */
function settleActor(def, ok, err){
  if (def.id === 'scholar') HOOKS.settleAsset?.('assets/fig-scholar.glb', ok, err);
  else if (def.id === 'lady') HOOKS.settleAsset?.('assets/fig-lady.glb', ok, err);
  else if (def.id === 'laborer') HOOKS.settleAsset?.('assets/fig-laborer.glb', ok, err);
  else if (def.id === 'child1' || def.id === 'child2') HOOKS.settleAsset?.('assets/fig-child.glb', ok, err);
}

/* 脚下那个面：马厩院子/台基不是地形（groundHeight 给 −0.05，院子面 0.10），
   而 buildActors 跑在马厩 deferBootFirst **之前** ⇒ 求值期打射线常常打空。
   所以"点一次、失败就下次再点"：命中即冻结，最多试 40 次（0.25s 一次 = 10s）。 */
const _rc = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _hitP = new THREE.Vector3();
function sampleFloor(x, z){
  _rc.set(_hitP.set(x, 3.0, z), _down);
  _rc.far = 6.0;
  for (const h of _rc.intersectObject(scene, true)){
    if (!h.object.isMesh) continue;
    /* 跳过：人物 GLB（actor_*）、程序化替身（userData.poseName）、马（horseXxx） */
    let p = h.object, skip = false;
    while (p){
      if ((p.name && (p.name.startsWith('actor_') || /^horse/i.test(p.name))) ||
          (p.userData && p.userData.poseName)) { skip = true; break; }
      p = p.parent;
    }
    if (skip) continue;
    return h.point.y;
  }
  return null;
}

function loadActor(def){
  const loader = new GLTFLoader();
  loader.load(def.url,
    (gltf) => {
      const inner = gltf.scene;
      const holder = new THREE.Group();
      holder.name = 'actor_' + def.id;
      holder.add(inner);

      /* 归一：按包围盒高缩到 def.height，水平居中，脚底 y=0 */
      let bb = new THREE.Box3().setFromObject(inner);
      const sz = bb.getSize(new THREE.Vector3());
      const sc = def.height / Math.max(1e-6, sz.y);
      inner.scale.setScalar(sc);
      inner.updateMatrixWorld(true);
      bb = new THREE.Box3().setFromObject(inner);
      inner.position.set(
        -(bb.min.x + bb.max.x) / 2,
        -bb.min.y,
        -(bb.min.z + bb.max.z) / 2,
      );
      holder.position.set(def.spot.x, groundHeight(def.spot.x, def.spot.z), def.spot.z);
      holder.rotation.y = def.spot.yaw;

      inner.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        o.userData.noMerge = true;         // 不进 mergeStatics
        if (Array.isArray(o.material)) o.material.forEach(m => tintMaterial(m, def.tint));
        else tintMaterial(o.material, def.tint);
      });

      const bones = {};
      inner.traverse((o) => { if (o.isBone) bones[o.name] = o; });
      const base = {};
      for (const n of ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
                       'LeftUpperArm', 'RightUpperArm', 'LeftLowerArm', 'RightLowerArm',
                       'LeftUpperLeg', 'RightUpperLeg', 'LeftLowerLeg', 'RightLowerLeg',
                       'LeftFoot', 'RightFoot']){
        if (bones[n]) base[n] = bones[n].quaternion.clone();
      }

      scene.add(holder);
      hideProcedural(def.hidePose, def.spot);
      const r = def.route;
      /* 步幅 ↔ 步长对账：脚摆过的弧长必须等于推进的距离，否则就是"滑步"。
         半径取 Hips 到地面的高度（≈ 髋到踝 + 鞋底），由实测骨骼位置算，
         不写死 —— 文士 1.72 与仕女 1.63 的髋高差 6cm，共用一套振幅就会一个滑一个蹭。 */
      holder.updateMatrixWorld(true);
      const gy0 = groundHeight(def.spot.x, def.spot.z);
      let hipH = def.height * 0.52;
      const hipsBone = bones['Hips'];
      if (hipsBone){
        const p = new THREE.Vector3();
        hipsBone.getWorldPosition(p);
        hipH = Math.max(0.35, p.y - gy0);
      }
      const amp = Math.min(0.34, Math.max(0.16, Math.asin(Math.min(0.6, STEP_LEN / (2 * hipH)))));
      ACTORS.push({
        def, holder, bones, base, phase: def.idle.phase, amp,
        pos: { x: def.spot.x, z: def.spot.z },
        y: gy0,
        yaw: def.spot.yaw,
        target: r ? 1 : 0, waitT: r ? 2.0 : 0,        // 首帧先站 2s 再起步
        step: 0, moveW: 0, moved: 0, stopN: 0,
        floorY: null, floorTries: 0, sampleT: 0, floorDone: false,   // 只有 floorRay 的才会去点
      });
      markCasterBoxDirty();
      renderer.shadowMap.needsUpdate = true;   // 静态阴影图补一次，人物有影子
      settleActor(def, true);
      console.log('[actor] 已接入 ' + def.id + '  hip=' + hipH.toFixed(3) + 'm  amp=' + amp.toFixed(3));
    },
    (e) => { if (e && e.total) HOOKS.reportAssetProgress?.(def.url, e.loaded, e.total); },
    (err) => {
      /* 失败不抛：程序化人物继续用 */
      settleActor(def, false, err);
      console.warn('[actor] ' + def.id + ' 加载失败，保留程序化替身：', err && err.message);
    });
}

/* 只在启动时调一次（08-assemble 在建完人物之后调） */
export function buildActors(){
  if (_built) return;
  _built = true;
  for (const def of DEFS) loadActor(def);
}

/* 每帧：呼吸 + 缓慢转头/重心。只写骨骼，不碰 root 的 position/rotation。 */
/* 确定性伪随机（不碰全局随机流 —— 铁律 1：装配期多抽一次，其后全园布局整体前移）。
   只用来给"这次停多久"一点变化，不进任何门禁的哈希。 */
function det(i){
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
const approach = (v, t, d)=> (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

/* 往复踱步：走到端点 → 停 dwell → 掉头 → 再走。
   ⚠️ 转身是"站住转"（|Δyaw| > TURN_GATE 时不平移），不是边走边拧 ——
      真实的人转身时脚是原地倒步，边走边转在长袍上会看出膝盖朝侧面。 */
function tickRoute(a, dt){
  const r = a.def.route;
  a.moved = 0;
  if (!r || a.walkOff){ a.moveW = approach(a.moveW, 0, dt / 0.45); return; }
  if (a.waitT > 0){
    a.waitT -= dt;
    a.moveW = approach(a.moveW, 0, dt / 0.45);
    return;
  }
  const t = r.pts[a.target];
  const dx = t[0] - a.pos.x, dz = t[1] - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05){
    a.target = 1 - a.target;
    a.waitT = r.pause[0] + (r.pause[1] - r.pause[0]) * det(a.stopN++);
    a.moveW = approach(a.moveW, 0, dt / 0.45);
    return;
  }
  let dy = Math.atan2(dx, dz) - a.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const dTurn = GAIT.turn * dt;
  if (Math.abs(dy) > TURN_GATE){
    a.yaw += dy > 0 ? dTurn : -dTurn;
    a.step += dt * 0.17;                       // 原地倒步：让脚小碎步跟上
    a.moveW = approach(a.moveW, 0.32, dt / 0.3);
    return;
  }
  a.yaw += Math.max(-dTurn, Math.min(dTurn, dy));
  const v = r.speed * (1 - 0.5 * (Math.abs(dy) / TURN_GATE));
  const k = Math.min(1, (v * dt) / dist);
  a.pos.x += dx * k; a.pos.z += dz * k;
  a.moved = v * dt;
  a.step += a.moved;
  a.moveW = approach(a.moveW, 1, dt / 0.40);
}

/* 一次完整更新（时钟由调用方推进）—— tickActors 与探针的 actorStep 共用同一份，
   避免探针里再抄一遍步态口径（抄一遍 = 改产品时两边悄悄分家）。 */
function advance(dt){
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const a of ACTORS){
    tickRoute(a, dt);
    /* 院子/台基面：马厩是 deferBootFirst 建的，人物 GLB 可能先到 ⇒ 头几次射线只打得到地形。
       所以头 4 秒（16 次 ×0.25s）**持续采样取最高**，之后冻结：院子面一建出来就被采用。
       只接受 [−0.4, 0.8] 的命中，免得把马厩屋顶（2.9m）当成地面。
       （第一版"打中即冻结"踩过：第一个采样点打到的正是地形 0.052 ⇒ 人整体矮 5cm。） */
    if (a.def.floorRay && !a.floorDone){
      a.sampleT -= dt;
      if (a.sampleT <= 0){
        a.sampleT = 0.25;
        const fy = sampleFloor(a.pos.x, a.pos.z);
        if (fy !== null && fy > -0.4 && fy < 0.8 && (a.floorY === null || fy > a.floorY + 0.004)) a.floorY = fy;
        if (++a.floorTries >= 16) a.floorDone = true;
      }
    }
    const gy = a.def.floorRay ? (a.floorY === null ? a.y : a.floorY) : groundHeight(a.pos.x, a.pos.z);
    /* 位置：先落地点，再叠步态起伏。groundHeight 是缓坡，直接跟即可。 */
    a.y += (gy - a.y) * Math.min(1, dt * 8);    // 一阶低通：坡上不会一点点抖
    const o = a.def.idle;
    const p = a.step / STEP_LEN * Math.PI;      // 步态相位（按走过的距离推进）
    const w = a.moveW;
    const sw = Math.sin(p);
    const bob = -GAIT.bob * Math.cos(2 * p) * w;
    a.holder.position.set(a.pos.x, a.y + bob, a.pos.z);
    a.holder.rotation.y = a.yaw;

    const b = Math.sin(_t * 1.05 + a.phase);
    const h = Math.sin(_t * 0.31 + a.phase * 1.7);
    const set = (name, x, y, z) => {
      const bone = a.bones[name], rest = a.base[name];
      if (!bone || !rest) return;
      e.set(x, y, z, 'XYZ');
      q.setFromEuler(e);
      bone.quaternion.copy(rest).multiply(q);
    };

    /* ── 步态（w→0 时全部回零，站姿与 P1 逐字一致）────────────────────────
       屈膝相位：腿往前送的半程（cos>0）才弯；支撑期直着撑住重量。
       踝：跟落抬趾、趾离压趾，用 ±GAIT.foot 的小幅反向补偿。 */
    set('LeftUpperLeg',  a.amp * sw * w, 0, 0);
    set('RightUpperLeg', -a.amp * sw * w, 0, 0);
    set('LeftLowerLeg',  -GAIT.knee * Math.pow(Math.max(0,  Math.cos(p)), 1.2) * w, 0, 0);
    set('RightLowerLeg', -GAIT.knee * Math.pow(Math.max(0, -Math.cos(p)), 1.2) * w, 0, 0);
    set('LeftFoot',  -GAIT.foot * sw * w, 0, 0);
    set('RightFoot',  GAIT.foot * sw * w, 0, 0);
    set('Hips',  0.010 * w,
        GAIT.hipYaw * sw * w,
        GAIT.hipRoll * Math.cos(p) * w);

    /* A 姿势 → 自然垂手（实测左 +Y / 右 -Y）。只对文士生效，仕女本来就是垂手。 */
    const ad = o.armDown || 0;
    if (ad > 0.001){
      set('LeftUpperArm', 0.03 * b, ad, 0);
      set('RightUpperArm', 0.03 * b, -ad, 0);
    }
    /* lean / headDown：马夫"把草递到马嘴"那种前俯，只动躯干和头（手臂不动）。 */
    const lean = o.lean || 0;
    const hd = o.headDown || 0;
    set('Chest', o.breath * b + 0.02 * w + lean, -GAIT.chestYaw * sw * w, o.sway * Math.sin(_t * 0.7 + a.phase));
    set('Spine', o.breath * 0.5 * b + lean * 0.45, -GAIT.chestYaw * 0.5 * sw * w, 0);
    set('Head', 0.012 * Math.sin(_t * 0.5 + a.phase) + hd, o.head * h, 0);
    set('Neck', 0.008 * Math.sin(_t * 0.5 + a.phase + 0.7) + hd * 0.45, 0.4 * o.head * h, 0);
  }
}

export function tickActors(dt){
  if (!ACTORS.length) return;
  const d = Math.min(Math.max(dt, 0), 0.05);   // 位置用更紧的步长上限，掉帧也不会跳过端点
  _t += Math.min(Math.max(dt, 0), 0.1);
  advance(d);
}

/* 探针用：把 sim 快进 seconds 秒（软件渲染只有 1~3fps，实时等 6s 只走了 0.2s 的 sim）。
   与 tickActors 走同一份 advance()，不吃随机数、不改环境。 */
export function actorStep(seconds, quantum){
  if (!ACTORS.length) return;
  const q = quantum || 1 / 60;
  let acc = Math.min(Math.max(seconds, 0), 30);
  while (acc > 1e-6){ const d = Math.min(q, acc); _t += d; advance(d); acc -= d; }
}

/* 调试/探针用：a=on 走自家 route；b=指定 id 时只让那一个走 */
export function actorWalk(id, on){
  for (const a of ACTORS) if (!id || a.def.id === id) a.walkOff = !on;
}

export function actorState(){
  return {
    n: ACTORS.length,
    actors: ACTORS.map(a => ({
      id: a.def.id,
      pos: a.holder.position.toArray().map(v => +v.toFixed(3)),
      yaw: +a.holder.rotation.y.toFixed(3),
      bones: Object.keys(a.bones).length,
      mode: !a.def.route || a.walkOff ? 'stand' : (a.waitT > 0 ? 'wait' : 'walk'),
      moveW: +a.moveW.toFixed(3),
      floorY: a.floorY === null ? null : +a.floorY.toFixed(3),
      floorTries: a.floorTries,
      step: +a.step.toFixed(3),
    })),
  };
}
