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
import { PROP_SPOTS, QIN_LOW_SEAT } from './14-props.js';
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

/* ── 跪坐（P2 坐姿）参数：与 research/characters/README.md §12.2 的出图一致 ─────────
   drop  = 髋部骨骼下沉量（**不动 holder**，动 Hips 骨：holder 原点在地面，移它整只人下沉）；
   knee  = 小腿屈曲（这套架子**正号才是往后折**，负号会往前折成"脚朝天"）；
   lift  = 前襟绕世界横轴抬起（负号 = 往前翻；实测 Skirt0a 局部 X 负 = 前翻）；
   skirtLen/Rad = 裙骨沿骨长压缩、径向撑开（下摆铺地）。 */
const KNEEL = {
  drop: 0.46, thigh: 0.06, knee: 1.62, foot: -1.30, footScale: 0.04,
  spine: 0.03, skirtLen: 0.55, skirtRad: 1.45, lift: 1.15, kneeSwap: 0.96,
};

/* ── 抚琴（跪坐 + 两手下探到弦上）────────────────────────────────────────────
   这一组数是**反解**出来的，不是照姿势凭感觉填的：outputs/_diag/actor-qin-solve.mjs
   在页内按 rest×Euler(XYZ) 复算、网格搜索肩三轴 + 固定屈肘 0.65（自由解 4 个自由度
   会挑"手臂几乎伸直"的边界解，读起来僵，所以屈肘先钉死）。
   实测腕位（actor-qin-verify.mjs）：左 8.287,1.824,−7.843 / 右 7.649,1.850,−7.859，
   比弦面 1.7305 高 0.09~0.11 —— 腕在上、**指尖靠 QIN_HAND 压到弦面**。
   **改案高 / 坐距 / lean 必须重跑**（触达链 腕→肩 ≈ 0.58m，`seatBack` 一拉开就够不到）。
   ⚠️ 左右两组**各自求解**、不镜像（这套骨架的左右骨骼朝向本来就不对称，
      照 armDown 那样乘 −1 会让右手肘朝外翻）。 */
const QIN_ARM = {
  Left:  { sx: -1.125, sy: 0.125, sz: -0.125, ex: 0.65, pluck: 0.035, rate: 0.9 },
  Right: { sx: -0.700, sy: -0.675, sz: 0.250, ex: 0.65, pluck: 0.080, rate: 1.9 },
};

/* 腕骨与手指（同样是**量出来的**，不是照"掌屈"这个名字填的 → actor-qin-hand3.mjs）
   ① 腕骨必须**三轴一起解**：只压一个轴时右手中指会比食指高 5~12cm（两根手指在同一
      平面里天生不齐），必须叠一点滚转（y）把指扇摆平；
   ② 两只手的腕屈符号**相反且与直觉相反**（细扫实测：左手 z+ 往下、右手 z− 往下）；
   ③ 拇指 **x 负**才是"收向掌心"、正号是往外张 —— 张开的拇指正是"摊手"的一半；
      三节各 −0.65/−0.585/−0.39 时拇指尖到食指尖 0.152 → 0.067m。
   实测结果（指尖 = *_Distal_end 相对弦面 1.7305）：左手食指 +0.014 / 中指 +0.010，
   右手食指 +0.016 / 中指 +0.012，前后位置都在弦带 z∈[−7.852,−7.708] 之内。
   ⚠️ 改案高 / 坐距 / lean 之后这组数**全部失效**，必须重跑上面那两个探针。 */
const QIN_HAND = {
  Left:  { hx: 0.50, hy: -0.50, hz: 0.00, curl: 0.15, mid: 0.13, thumb: -0.65 },
  Right: { hx: 0.10, hy: 0.80, hz: -0.50, curl: 0.15, mid: 0.13, thumb: -0.65 },
};

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
    idle: { breath: 0.018, head: 0.055, sway: 0.009, phase: 0.9, hopEvery: [9, 22], hopH: 0.20 },
  },
  {
    id: 'child2',
    url: 'assets/fig-child.glb',
    height: 1.16,
    hidePose: 'child',
    tint: 0xDCE0E8,
    spot: { x: 0.62, z: -5.10, yaw: 2.37 },    // 面向先生（1.2,−5.7）
    route: null,
    idle: { breath: 0.016, head: 0.05, sway: 0.008, phase: 4.2, hopEvery: [14, 30], hopH: 0.16 },
  },
  /* ── 低案抚琴（P2 第一件"坐着的动作"）────────────────────────────────────────
     同一件文士资产第二次 parse（与两个书童同款做法），坐位坐标由 14-props 的
     QIN_LOW_SEAT 给 —— 桌与人是**一处真值**推出的两个点，不在这里另写一份。
     hidePose 留空：他没有替换任何程序化人物（水榭里抚琴那位是另一处陈设，保留）。
     ⚠️ 站在**堂前月台**上：y 必须走 floorRay（台面 1.30，不是地形），而且默认的
        接受上限 0.8 会把 1.30 判成"屋顶"丢掉 ⇒ 本条目显式给 floorMax。 */
  {
    id: 'qin',
    url: 'assets/fig-scholar.glb',
    height: 1.72,
    hidePose: null,
    tint: 0xC6BFAE,          // 暖褐（与讲学那位蓝灰长衫分开，同一件资产不成"照镜子"）
    spot: { x: QIN_LOW_SEAT.x, z: QIN_LOW_SEAT.z, y: QIN_LOW_SEAT.y, yaw: QIN_LOW_SEAT.yaw },
    floorRay: true,
    floorMax: 1.70,
    pose: 'kneel',
    route: null,
    idle: { breath: 0.009, head: 0.028, sway: 0.003, phase: 2.3, qin: true, lean: 0.18, headDown: 0.12 },
  },
];

/* 隐藏程序化替身。near 给了就按**最近的那个**挑：
   poseName 不是唯一的（08b 里两个书童都叫 'child'、家里三个孩子都叫 'watchChild'），
   只按 poseName 取第一个会让"两个书童换掉一个、另一个留着"这种半残状态悄悄发生。 */
function hideProcedural(poseName, near){
  /* 没有 poseName 就没有替身可换（低案抚琴那位是**新增**的人，不是替换某位程序化人物）。
     ⚠️ 必须在这里挡：`poseName === undefined` 会匹配上**所有没有 poseName 的人物**，
        过滤器一放开就会静默藏掉别人。 */
  if (!poseName) return;
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
  else if (def.id === 'qin') HOOKS.settleAsset?.('assets/fig-scholar.glb', ok, err);
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
                       'LeftFoot', 'RightFoot',
                       /* 腕与指（抚琴用）：腕骨三轴 + 指节 + 拇指三节。
                          ⚠️ 骨骼不在 base 表里 ⇒ set() 会**静默返回**、画面一动不动
                          （拇指这三节就踩过：探针扫了四档，读数一模一样）。
                          这套骨架只有 食指/中指/拇指 三根，无名指与小指是刚性网格，
                          收不拢 ⇒ 只能靠腕骨滚转 + 拇指内收把整只手读成"收拢"。 */
                       'LeftHand', 'RightHand',
                       'LeftIndexProximal', 'LeftIndexIntermediate', 'LeftMiddleProximal', 'LeftMiddleIntermediate',
                       'RightIndexProximal', 'RightIndexIntermediate', 'RightMiddleProximal', 'RightMiddleIntermediate',
                       'LeftThumbProximal', 'LeftThumbIntermediate', 'LeftThumbDistal',
                       'RightThumbProximal', 'RightThumbIntermediate', 'RightThumbDistal',
                       'Skirt0', 'Skirt1', 'Skirt2', 'Skirt3', 'Skirt4', 'Skirt5',
                       'Skirt0a', 'Skirt1a', 'Skirt2a', 'Skirt3a', 'Skirt4a', 'Skirt5a',
                       'Skirt0b', 'Skirt1b', 'Skirt2b', 'Skirt3b', 'Skirt4b', 'Skirt5b']){
        if (bones[n]) base[n] = bones[n].quaternion.clone();
      }

      scene.add(holder);
      hideProcedural(def.hidePose, def.spot);
      const r = def.route;
      /* 步幅 ↔ 步长对账：脚摆过的弧长必须等于推进的距离，否则就是"滑步"。
         半径取 Hips 到地面的高度（≈ 髋到踝 + 鞋底），由实测骨骼位置算，
         不写死 —— 文士 1.72 与仕女 1.63 的髋高差 6cm，共用一套振幅就会一个滑一个蹭。 */
      holder.updateMatrixWorld(true);
      /* 裙骨（有空才收集）：把"世界横向轴"换算到每根骨的局部系一次存好。
         6 根裙骨是绕身体一圈的，直接用局部 X 转会让每片往各自的方向翻；
         用同一根世界横向轴（人物正面 +Z ⇒ 横向 = X）才是"裙摆随走动前后摆"。 */
      const skirt = [];
      for (let i = 0; i < 6; i++){
        const namA = bones['Skirt' + i + 'a'] ? 'Skirt' + i + 'a' : 'Skirt' + i;
        const namB = bones['Skirt' + i + 'b'] ? 'Skirt' + i + 'b' : null;
        const bA = bones[namA];
        if (!bA) continue;
        const qw = new THREE.Quaternion();
        bA.getWorldQuaternion(qw);
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(qw.invert()).normalize();
        skirt.push({ a: namA, b: namB, axis, ang: (i * Math.PI) / 3 });
      }
      if (skirt.length) console.log('[actor] ' + def.id + ' 裙骨 x' + skirt.length);
      /* 坐姿要把**髋骨**往下移（不是 holder：holder 原点在地面），所以先记下骨局部系的'下' */
      const hipsBone2 = bones['Hips'];
      const hipsDown = new THREE.Vector3(0, -1, 0);
      if (hipsBone2){
        const qh = new THREE.Quaternion();
        hipsBone2.getWorldQuaternion(qh);
        hipsDown.applyQuaternion(qh.invert()).normalize();
      }
      const hipsRest = hipsBone2 ? hipsBone2.position.clone() : null;
      /* 落点高度：能给的就在 spot 里显式给（月台/台基是浮在地形上的独立网格，
         groundHeight 会让人整个沉进去）；不给才算地形。floorRay 的条目随后还会
         用射线把它校正到真实命中的面。 */
      const gy0 = def.spot.y !== undefined ? def.spot.y : groundHeight(def.spot.x, def.spot.z);
      let hipH = def.height * 0.52;
      const hipsBone = bones['Hips'];
      if (hipsBone){
        const p = new THREE.Vector3();
        hipsBone.getWorldPosition(p);
        hipH = Math.max(0.35, p.y - gy0);
      }
      const amp = Math.min(0.34, Math.max(0.16, Math.asin(Math.min(0.6, STEP_LEN / (2 * hipH)))));
      ACTORS.push({
        def, holder, bones, base, phase: def.idle.phase, amp, skirt,
        pos: { x: def.spot.x, z: def.spot.z },
        y: gy0,
        yaw: def.spot.yaw,
        target: r ? 1 : 0, waitT: r ? 2.0 : 0,        // 首帧先站 2s 再起步
        step: 0, moveW: 0, moved: 0, stopN: 0,
        hopT: 0, hopDur: 0.62, hopN: 0, hopWait: def.idle.hopEvery ? 3 + det(def.idle.phase) * 6 : 0,
        floorY: null, floorTries: 0, sampleT: 0, floorDone: false,   // 只有 floorRay 的才会去点
        kneelW: 0, kneelTarget: def.pose === 'kneel' ? 1 : 0,
        hipsDown, hipsRest,
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
        const fyMax = a.def.floorMax !== undefined ? a.def.floorMax : 0.8;
        if (fy !== null && fy > -0.4 && fy < fyMax && (a.floorY === null || fy > a.floorY + 0.004)) a.floorY = fy;
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

    /* ── 孩子跳（可选）：站着的角色每隔 hopEvery 秒蹦一下 ───────────────────
       只做 **腿部 + 整身抛物线**：肩部不动（腰/衣摆被手骨误权重，抬臂会撕）。
       起跳相位用 hopT 归一化：0~0.32 下蹲蓄力、0.32~0.78 腾空、0.78~1 落地缓冲。 */
    let hopY = 0, hopCrouch = 0, hopTuck = 0;
    const he = o.hopEvery;
    if (he && w < 0.2){
      a.hopWait -= dt;
      if (a.hopWait <= 0 && a.hopT <= 0){
        a.hopT = 1e-4;
        a.hopDur = he[2] || 0.62;
        a.hopWait = he[0] + (he[1] - he[0]) * det(a.hopN++ + a.phase * 13.7);
      }
      if (a.hopT > 0){
        a.hopT += dt;
        const u = Math.min(1, a.hopT / a.hopDur);
        if (u < 0.32){
          const q1 = u / 0.32;
          hopCrouch = 0.30 * Math.sin(q1 * Math.PI * 0.5);      // 下蹲
        } else if (u < 0.78){
          const q1 = (u - 0.32) / 0.46;
          hopY = (o.hopH || 0.20) * Math.sin(q1 * Math.PI);      // 腾空抛物线
          hopTuck = 0.55 * Math.sin(q1 * Math.PI);               // 收起小腿
          hopCrouch = -0.10 * Math.sin(q1 * Math.PI);            // 起跳伸直
        } else {
          const q1 = (u - 0.78) / 0.22;
          hopCrouch = 0.22 * Math.sin(q1 * Math.PI);             // 落地缓冲
        }
        if (u >= 1) a.hopT = 0;
      }
    }
    a.holder.position.set(a.pos.x, a.y + bob + hopY - hopCrouch * 0.16, a.pos.z);
    a.holder.rotation.y = a.yaw;

    /* 跪坐权重 0→1 平滑过渡（换姿势不能"啪"一下跪下） */
    if (a.kneelTarget > a.kneelW) a.kneelW = Math.min(a.kneelTarget, a.kneelW + dt * 2.2);
    else if (a.kneelTarget < a.kneelW) a.kneelW = Math.max(a.kneelTarget, a.kneelW - dt * 2.2);
    const k = a.kneelW;

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
    set('LeftUpperLeg',  a.amp * sw * w + hopCrouch * 0.8 - KNEEL.thigh * k, 0, 0);   // 大腿的局部 X 左右镜像（同步态用反号）
    set('RightUpperLeg', -a.amp * sw * w - hopCrouch * 0.8 + KNEEL.thigh * k, 0, 0);  // 反号 ⇒ 两腿**同向**前屈（蹲/跪）
    set('LeftLowerLeg',  -GAIT.knee * Math.pow(Math.max(0,  Math.cos(p)), 1.2) * w - hopCrouch * 1.8 - hopTuck + KNEEL.knee * k, 0, 0);
    set('RightLowerLeg', -GAIT.knee * Math.pow(Math.max(0, -Math.cos(p)), 1.2) * w - hopCrouch * 1.8 - hopTuck + KNEEL.knee * k, 0, 0);
    set('LeftFoot',  -GAIT.foot * sw * w + KNEEL.foot * k, 0, 0);
    set('RightFoot',  GAIT.foot * sw * w + KNEEL.foot * k, 0, 0);
    set('Hips',  0.010 * w,
        GAIT.hipYaw * sw * w,
        GAIT.hipRoll * Math.cos(p) * w);

    /* A 姿势 → 自然垂手（实测左 +Y / 右 -Y）。只对文士生效，仕女本来就是垂手。 */
    const ad = o.armDown || 0;
    if (ad > 0.001){
      set('LeftUpperArm', 0.03 * b, ad, 0);
      set('RightUpperArm', 0.03 * b, -ad, 0);
    }
    /* ── 抚琴：两臂前伸下探到弦上（参数 QIN_ARM + QIN_HAND，反解口径见文件头）──────
       · 只在跪坐权重上来之后才伸手（过渡帧里手不会先去按空气）；
       · **拨弦叠在指节上、不叠在肘上**：肘一动整条手臂跟着上下摆 1~2cm，而指尖只离弦
         1.2cm ⇒ 会周期性地穿进弦里。改成食指/中指交替起点，手是稳的、只有指尖在动；
       · 左右手节奏不同（左手按弦慢、右手拨弦快），两个手不会像机器一样同步。 */
    if (o.qin && k > 0.2){
      const tt = _t + a.phase;
      for (const side of ['Left', 'Right']){
        const P = QIN_ARM[side], H = QIN_HAND[side];
        set(side + 'UpperArm', P.sx, P.sy, P.sz);
        set(side + 'LowerArm', P.ex, 0, 0);
        set(side + 'Hand', H.hx, H.hy, H.hz);
        const osc = Math.sin(tt * P.rate * 6.2832);
        set(side + 'IndexProximal',  H.curl + P.pluck * Math.max(0, osc), 0, 0);
        set(side + 'MiddleProximal', H.curl + P.pluck * Math.max(0, -osc), 0, 0);
        set(side + 'IndexIntermediate',  H.mid, 0, 0);
        set(side + 'MiddleIntermediate', H.mid, 0, 0);
        set(side + 'ThumbProximal', H.thumb, 0, 0);
        set(side + 'ThumbIntermediate', H.thumb * 0.9, 0, 0);
        set(side + 'ThumbDistal', H.thumb * 0.6, 0, 0);
      }
    }
    /* lean / headDown：马夫"把草递到马嘴"那种前俯，只动躯干和头（手臂不动）。 */
    const lean = o.lean || 0;
    const hd = o.headDown || 0;
    set('Chest', o.breath * b + 0.02 * w + lean, -GAIT.chestYaw * sw * w, o.sway * Math.sin(_t * 0.7 + a.phase));
    set('Spine', o.breath * 0.5 * b + lean * 0.45, -GAIT.chestYaw * 0.5 * sw * w, 0);
    set('Head', 0.012 * Math.sin(_t * 0.5 + a.phase) + hd, o.head * h, 0);
    set('Neck', 0.008 * Math.sin(_t * 0.5 + a.phase + 0.7) + hd * 0.45, 0.4 * o.head * h, 0);

    /* ── 坐姿/裙骨（k=跪坐权重）────────────────────────────────────────────
       ① 髋骨沿自身"下"轴下沉（不动 holder —— 它原点在地面）；
       ② 小腿/脚/脚趾骨缩到 0.10：跪坐时鞋与裤脚会从袍摆下伸出来，收进袍里；
       ③ 裙摆：走路的摆动（世界横向轴）+ 跪坐时前襟前翻，长度压缩、径向撑开。
       ⚠️ 缩放**每帧无条件写**（k=0 时写 1），否则切回站姿时腿还是缩着的。 */
    const hb = a.bones['Hips'];
    if (hb && a.hipsRest){
      hb.position.copy(a.hipsRest).addScaledVector(a.hipsDown, KNEEL.drop * k);
    }
    const legS = 1 - (1 - KNEEL.footScale) * k;
    for (const n of ['LeftLowerLeg', 'RightLowerLeg', 'LeftFoot', 'RightFoot', 'LeftToes', 'RightToes']){
      const bb = a.bones[n];
      if (bb) bb.scale.setScalar(legS);
    }
    if (a.skirt.length){
      const twoSeg = !!a.skirt[0].b;
      const lenE = twoSeg ? Math.sqrt(KNEEL.skirtLen) : KNEEL.skirtLen;
      const sway = w * a.amp * 0.9 * sw;
      for (const sk of a.skirt){
        const front = Math.cos(sk.ang);                       // 0° = 正前 ⇒ 1
        const th = sway - k * KNEEL.lift * (0.55 + 0.55 * front);
        const ba = a.bones[sk.a], ra = a.base[sk.a];
        if (ba && ra){
          q.setFromAxisAngle(sk.axis, th);
          ba.quaternion.copy(ra).multiply(q);
          const L = 1 + (lenE - 1) * k, R = 1 + (KNEEL.skirtRad - 1) * k;
          ba.scale.set(R, L, R);
        }
        if (sk.b){
          const bb2 = a.bones[sk.b], rb = a.base[sk.b];
          if (bb2 && rb){
            q.setFromAxisAngle(sk.axis, -th * KNEEL.kneeSwap);
            bb2.quaternion.copy(rb).multiply(q);
            const L = 1 + (lenE - 1) * k, R = 1 + (KNEEL.skirtRad - 1) * k;
            bb2.scale.set(R, L, R);
          }
        }
      }
    }
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
/* 探针用：切站/跪坐（kneel 的权重会平滑过渡，不会瞬移） */
export function actorPose(id, pose){
  for (const a of ACTORS) if (!id || a.def.id === id) a.kneelTarget = pose === 'kneel' ? 1 : 0;
}

/* 探针用：某个人物的骨骼表与**绑定姿态**（只在页内用 —— 返回的是 THREE 对象，
   跨 evaluate 序列化不了）。抚琴的肩/肘角度是"手落到弦上"反解出来的，
   探针必须在同一个任务里按同一套公式（rest × Euler XYZ）复算，不能只读当前姿势。 */
export function actorRig(id){
  const a = ACTORS.find(x => x.def.id === id);
  return a ? { bones: a.bones, base: a.base, holder: a.holder } : null;
}

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
      kneelW: +a.kneelW.toFixed(3),
      moveW: +a.moveW.toFixed(3),
      floorY: a.floorY === null ? null : +a.floorY.toFixed(3),
      floorTries: a.floorTries,
      step: +a.step.toFixed(3),
    })),
  };
}
