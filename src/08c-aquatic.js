// 08c-aquatic: 水生与飞禽（2026-10-15 W3 从 08-assemble.js 纯搬家：266-1656「睡莲→鸭」，
//   含芭蕉/石灯笼/泳龟/水禽/鹦鹉/大雁/小鸟/蜻蜓/荷花 —— 同在段内，一并随行）。
//
// 逻辑一字不动。铁律 1：段内所有"求值期吃全局随机流"的语句（makeAquatic / makeKoiGroup /
//   蜻蜓 30 抽 / 水草 / 荷花每株 4 次等量燃烧 / 荷杆 12 抽 / makePondPads / 泳龟 4×2 预抽 …）
//   全部包进 buildAquatic()，由 08-assemble 在**原行号位置**调用 ⇒ 消耗顺序与搬家前逐字一致。
//
// ⚠️ 为什么必须包成函数（别改回顶层）：ES 模块的依赖先于本模块求值 —— 这 1391 行若留在
//   模块顶层，会在 08-assemble 之前跑完 ⇒ 全局流位置整体前移 ⇒ 全园布局静默漂移、不报错。
// ⚠️ 顶层只留纯声明（函数 / 常量表 / 私有种子流）：它们不碰全局流，提前求值无副作用。
//   顶层那两个 `let`（koiGroup / smallBirdMesh）由 buildAquatic() 赋值 —— 二者的初值分别要调
//   makeKoiGroup(11) 与 makeSmallBirdGeo() 并挂场景，属求值期副作用，不能提到顶层。
// ⚠️ buildAquatic() 体内**保持 08-assemble 原缩进**（与 08b-figures 的 buildFigures 同款），
//   且与原文逐字节相同 —— 搬家时按"原行号摆回"逐字节核对过：漏行/重行/串行/错位四类一次抓全。
import { THREE } from '../vendor.js';
import { TAU, rr, rnd, mulberry32, HOOKS } from './00-config.js';
import { WIND, makeDuckWakeTex } from './01-materials.js';
import { world } from './02-scene.js';
import { mesh } from './03-factory.js';
import { markUnderwater } from './05-water.js';
import { makeKoiGroup } from './06-vegetation.js';
import { perchingAnchors } from './06d-corridor.js';
import { loadAssetOnce, placeAssets } from './06e-assets.js';
import { KOI_ORBITS } from './06g-koi.js';
import { makeWaterGrass, makeBananaPlant } from './06i-trees.js';
import { makeAquatic, makePondPads } from './06j-herbs.js';
import { MAT } from './01-materials.js';
import { makeDragonfly, makeGoose, makeSmallBirdGeo, makeDuckGeo, makeDuckWakeGeo } from './07-ground.js';
import { onAssetAttached } from './12-env.js';
import {setSmallBirdMesh, N_GRASS_BIRD, perchRnd, perchingDragonflies, DF_PATROL, geese, gRnd, GN, gooseSlot, GOOSE, gooseStartWave, updateGooseFlock, smallBirds, smallBirdMeshRef, bRnd, BIRD_PALETTE, ROCK_BIRD_PALETTE, ROCK_SPOTS, GRASS_SPOTS, N_ROCK_BIRD, BIRD_CAP, BIRD_FOOT_LIFT, birdState, updateSmallBirds} from './08e-birds.js';
import { MACAW_SPOTS, MACAWS, MACAW_COUNT, MACAW_WING, macawWantPerch, updateMacaws, macawSpots, macawState } from './08f-macaw.js';
/* 写意艺术处理登记（金刚鹦鹉：展示保留、标注为艺术处理，替代候选见 src/art-license.js） */
import { markArtLicense } from './art-license.js';

export let koiGroup;   // W3 上提：初值吃全局流，赋值见 buildAquatic()

/* 蜻蜓：池塘与南侧草皮上空游弋。
   航迹中心刻意分散布置 —— 若用纯随机，5 只容易挤在同一小片区域 */
export const dragonflies = [];
// 停栖蜻蜓：独立随机流（不消耗主 rnd —— 主场景布局一个数都不能挪）
const PERCH_WIND = { amp: 0.05, speed: 1.25, crownY: 0, maxDisp: 0.05 };   // 对齐 MAT.lotus 行
const PERCH_RIDE = { amp: 0.03, speed: 1.15, crownY: 0, maxDisp: 0.05 };   // 对齐 MAT.lily 行
export const PERCH_LIFT = 0.028;      // 身体半径 ~1.2cm：贴着锚点会陷进花/叶里
export let perchShowOK = false;       // 由 applyEnv 与飞行蜻蜓同口径写入（冬/暴雨/风雪 = false）
/* ⚠️ 写入必须走这个 setter：拆模块后 12-env 是**import** 本变量再赋值的，
   而 ESM 的导入绑定只读 → 直接写会抛 "Assignment to constant variable"
   （原单体里 §8 的 let 与 §12 的赋值同处一个词法世界，所以能写）。 */
export function setPerchShowOK(v){ perchShowOK = v; }
/* ⚠️ 权重必须按**锚点自己的世界高度**算，不能按 object.getWorldPosition()：
   InstancedMesh 的原点在 makeAquatic 组原点（y=0），'tip' 权重 (y-crownY)/2.5 会恒等于 0
   → ampEff=0 → 风再大也纹丝不动。原来就是这么写的，"同频漂移"其实一直是零。 */
function perchWindOffset(worldPt, kind, t){
  const origin = WIND.uWindOrigin.value, radius = WIND.uWindRadius.value;
  const wFall = Math.max(0, 1 - Math.hypot(worldPt.x - origin.x, worldPt.z - origin.z) / radius);
  const gust  = WIND.uWindGlobal.value + WIND.uWindStrength.value * wFall * wFall;
  const pk = kind === 'flower' ? PERCH_WIND : PERCH_RIDE;
  const wt  = Math.min(Math.max((worldPt.y - pk.crownY) / 2.5, 0), 1.6);
  const ampEff = pk.amp * wt * (0.16 + 2.8 * gust);
  const h1 = (Math.sin(worldPt.x * 12.9898 + worldPt.z * 78.233) * 43758.5453) % 1;
  const hx = worldPt.x * 0.42 + worldPt.z * 0.19 + WIND.uWindPhase.value + Math.abs(h1) * 6.28;
  const hz = worldPt.x * 0.15 + worldPt.z * 0.36 + WIND.uWindPhase.value * 1.7 + Math.abs(h1) * 5.1;
  /* ⚠️ 必须与 addWind 的 shader 块**同构**（沿风向 1.00 / 横向 0.16）：
     否则停栖蜻蜓会朝与花叶不同的方向漂 —— 蜻蜓就停在荷叶上，近景一眼就看出来。 */
  const Wv = WIND.uWindVec.value;
  const along = Math.sin(t * pk.speed + hx) * ampEff
              * (0.86 + 0.14 * Math.sin(t * 0.37 + Math.abs(h1) * 2.1));
  const cross = Math.cos(t * pk.speed * 0.61 + hz) * ampEff * 0.16;
  let dx = Wv.x * along - Wv.y * cross;
  let dz = Wv.y * along + Wv.x * cross;
  const dLen = Math.hypot(dx, dz);
  if (dLen > pk.maxDisp){ const k = pk.maxDisp / dLen; dx *= k; dz *= k; }   // 硬顶：不许漂出池
  return _perchV2.set(dx, 0, dz);
}
const _perchV2 = new THREE.Vector3();

function makePerchingDragonfly(idx){
  const g = makeDragonfly();
  const state = {
    mode: 'perch',                       // perch | flight
    tPerch: 0, tFlight: 0,
    durPerch: 14 + perchRnd() * 12,      // ⚠️ 不初始化就永远不会起飞（0 >= undefined 恒假）
    durFlight: 2 + perchRnd() * 2,
    anchor: null, next: null,
    curve: null, curveLen: 1,
    wingT: perchRnd() * TAU,
    windPhase: perchRnd() * 10,
    restYaw: 0,
    lastFlowerId: -1,
  };
  /* 错峰：两只的初始停栖进度各掷各的（独立流），第二只再压一块固定错峰余量，
     避免两只同时起飞——"一起飞"看着像受惊，不像各自觅食。 */
  state.tPerch = perchRnd() * 3 - idx * 7;
  g.userData.perch = state;
  g.visible = false;                     // 首帧就位前先不画
  world.add(g);
  perchingDragonflies.push(g);
  return g;
}

function pickPerchAnchor(excludeId){
  const cands = perchingAnchors.filter(a => a.kind !== 'flower' || a.instanceId !== excludeId);
  if (!cands.length) return null;
  return cands[(perchRnd() * cands.length) | 0];
}
// 用实例几何当前矩阵求世界坐标锚点（停栖起点/终点都从这来）
/* ⚠️ local 已经是「InstancedMesh 局部（= makeAquatic 组）坐标」（addPerchingAnchor 里
   乘过 instanceMatrix），这里只需再乘一次 object.matrixWorld 就是世界坐标。 */
function anchorWorldPoint(anchor, out){
  return out.copy(anchor.local).applyMatrix4(anchor.object.matrixWorld);
}
export function updatePerchingDragonflies(dt, t, showOK){
  for (const g of perchingDragonflies){
    const s = g.userData.perch;
    g.visible = showOK;
    if (!showOK){
      // 冬/暴雨：与飞行蜻蜓同口径直接隐藏；重新出现时从停栖态重算，不残留半空位置
      s.mode = 'perch'; s.anchor = null; s.tPerch = 0;
      continue;
    }
    if (!s.anchor){
      s.anchor = pickPerchAnchor(s.lastFlowerId);
      if (!s.anchor){ g.visible = false; continue; }
      s.restYaw = perchRnd() * TAU;
      g.rotation.set(0, s.restYaw, 0);
    }
    if (s.mode === 'perch'){
      s.tPerch += dt;
      if (s.tPerch >= s.durPerch){
        s.next = pickPerchAnchor(s.anchor.kind === 'flower' ? s.anchor.instanceId : -1);
        if (s.next){
          const from = _perchV3.copy(g.position);
          const to = _perchV4;
          anchorWorldPoint(s.next, to);
          to.y += PERCH_LIFT;
          const lift = 0.9 + perchRnd() * 0.7;
          const ctrl1 = from.clone().lerp(to, 0.28); ctrl1.y += lift;
          const ctrl2 = from.clone().lerp(to, 0.72); ctrl2.y += lift * 0.85;
          s.curve = new THREE.CatmullRomCurve3([from.clone(), ctrl1, ctrl2, to.clone()]);
          s.curveLen = s.curve.getLength();
          s.mode = 'flight'; s.tFlight = 0;
          s.durFlight = 2 + perchRnd() * 2;                 // 2~4 秒
        } else {
          s.tPerch = 0;
        }
      }
    } else { // flight
      s.tFlight += dt;
      const u = Math.min(1, s.tFlight / s.durFlight);
      // ease-in-out：起飞缓加速、降落缓减速，弧线读作"掠过"而不是"弹道"
      const e = u * u * (3 - 2 * u);
      s.curve.getPointAt(e, g.position);
      const ahead = s.curve.getPointAt(Math.min(1, e + 0.02), _perchV5);
      g.rotation.y = Math.atan2(ahead.x - g.position.x, ahead.z - g.position.z);
      g.rotation.x = -Math.sin(u * Math.PI) * 0.18;         // 俯仰：起降机头姿态
      if (u >= 1){
        s.mode = 'perch';
        s.anchor = s.next; s.next = null;
        s.tPerch = 0;
        s.durPerch = 20 + perchRnd() * 15;                  // 20~35 秒
        s.lastFlowerId = s.anchor.kind === 'flower' ? s.anchor.instanceId : -1;
        g.rotation.x = 0;
        g.rotation.y = s.restYaw = perchRnd() * TAU;
      }
    }
    // 翅膀：停栖时慢速微振（偶发抖翅），飞行时全速
    s.wingT += dt * (s.mode === 'perch' ? 6 : 44);
    const wingAmp = s.mode === 'perch' ? 0.16 : 0.55;
    for (const w of g.userData.wings){
      w.rotation.z = w.userData.sx * Math.sin(s.wingT + w.userData.ph) * wingAmp;
    }
    /* 停栖：每帧从锚点**重新**算位置再叠风偏移。
       ⚠️ 原来是"锚点只在换锚时写一次，之后每帧 g.position.x += off.x" —— 偏移逐帧累加，
       一分钟能漂出 3 米，蜻蜓会自己走到岸上去。必须每帧回到锚点重算。 */
    if (s.mode === 'perch' && s.anchor){
      anchorWorldPoint(s.anchor, _perchV3);
      const off = perchWindOffset(_perchV3, s.anchor.kind, t);
      g.position.copy(_perchV3);
      g.position.y += PERCH_LIFT;
      g.position.x += off.x; g.position.z += off.z;
      g.rotation.set(0, s.restYaw, 0);
    }
  }
}
const _perchV3 = new THREE.Vector3(), _perchV4 = new THREE.Vector3(), _perchV5 = new THREE.Vector3();

// 荷花（Hyper3D 生成的荷花丛，池面散点）
/* ⚠️ 2026-09-22 晚（老黄 A+C 裁决）：摆放原走全局 rr/rnd，实测**每次刷新 12 株位置/朝向全漂移**
   （_rect-lotus-determinism.mjs：两次会话逐坐标比对全不同）—— 池面"白花苞时有时无"的根因。
   改本地流（固定种子）与加载时序解耦（makePeachTree 同法，§34）。
   ⚠️ 全局流**等量燃烧**：原每轮 rr,rnd,rr,rr 原顺序原参数消耗后弃用——
   全局流是一条有序流，多烧少烧都会让之后的莲蓬/水草/驳岸石/人物整体后移且不报错（§36.6）。 */
const lotusSpots = [];
const LR = mulberry32(20260922);                     // 荷花专用流：种子固定，跨刷新确定
const lrr = (a, b) => a + LR() * (b - a);
/* ── 池边荷花：三轮沿革（谁再看这段代码先读这里）──
   ① 最初：AI 生成的 LotusPlant.glb ×12 株 —— 老黄近看三连："花瓣尖锐几何 /
      杆花歪斜拼接 / 暴雨里杆旋转变粗"。根因：GLB 是单网格+单贴图（1600 tri、
      native 高 1.918m、放大 2.0），花与叶全烘进几何，近看必穿帮。
      （"杆花歪斜"一半是我后来按实测花位硬插的补杆——那批杆在 0a41f69 前的版本里。）
   ② 2026-09-30 一轮：换成程序化大荷花（花瓣/花萼/杆）—— 老黄实测更糟四连：
      "荷花完全不像荷花""各种悬空、不认识的植物结构""睡莲又到草皮上"
      "居然没有荷叶了"（红框取证 + 隐藏实验定案，详见 06 的 makePondPads 注释）。
   ③ 2026-09-30 二轮：花/杆/萼整体撤下，只留叶盘并夹回池内 —— 池面干净了，
      但老黄随即判"荷花还是没有修好啊，之前有个版本有好多株树立的荷花，
      虽然有点假但是至少能看" ⇒ 用户要的是**树立在水面的荷花**（有杆有花挺出叶面），
      程序化那套给不了，纯叶盘又太空。
   ④ 2026-09-30 三轮（现行）：**GLB 荷花丛原样回归**（不补杆 —— "杆花歪斜"里那批
      补杆才是歪斜主因；"杆旋转变粗"也只在补的棱柱杆上，丛自带的茎没这毛病），
      同时保留 makePondPads 的叶盘（归池 + 提亮）与"近看穿帮"的已知取舍 ——
      用户原话："有点假但是至少能看"。 */
/* ── ⑤ 2026-09-30 四轮（同日）：杆必须补回来 ──
   GLB 回归当天老黄即反馈："荷花和荷叶都回来了，但是没有杆啊，荷花都浮在空中"
   —— 定案 ④ 的判断错了：**这套 GLB 的几何里根本没有茎**（花与叶分别烘进网格，
   0~1.7m 之间是空的），④ 以为"丛自带的茎没毛病"，实际一株都没有。所以从
   "池边荷花"存在起，杆一直是**补的**；老黄记忆里"能看"的那版 = GLB 丛 + 这批杆。
   补法沿用定案前的原方案（那版唯一被抱怨过的是 6 棱杆被风摆时"旋转变粗"，
   已在 0a41f69 附近改成 12 棱）：
     · 落点中心、竖直向上 —— 花烘在丛顶中心带，杆顶探进花簇即"托住"；
     · 高度 = GLB_LOTUS_STEM_H × s × rr —— 顶到"花底 ≈ 1.748×s"之上（见
       wind-audit 的杆高判据：常量必须覆盖花位下限，否则花悬空 —— 就是这次的病）；
     · 材质 MAT.lily（tip 风摆 5cm 硬顶），与 GLB 丛注入的风参数完全一致
       （12-env 的 seasonGLB.LotusPlant 注入同为 amp 0.030/tip/maxDisp 0.05）
       ⇒ 杆与花同频摆，杆顶不会从花心里脱出来。 */
/* 杆高系数独立成常量：杆在 mergeStatics 里被合并后**名字就丢了**，
   wind-audit.mjs 无法再从场景反查杆的顶点高度 —— 只能断言这个设计常量。 */
export const GLB_LOTUS_STEM_H = 1.78;

/* ⚠️⚠️ 金刚鹦鹉（Macaw.glb）不走 placeAssets —— 自己 holder，原因是**材质**：
   Rodin 生成的 GLB 里 metallicFactor=1（金属度拉满），而本场景低档位没有强环境反射
   ⇒ 全金属材质渲染成**黑块**（实测：假山顶只看到一个小黑点，glb-inspect.mjs 确认
   贴图/网格/19818 三角形都齐全，就是材质不对）。
   placeAssets 的第四参 overrideMat 会**整体替换材质**、连贴图一起丢，也不能用。
   ⇒ loadAssetOnce + 自建 holder，在回调里把 metalness/roughness 压到合理区间：
   保留一点金属微光、让漫反射主导，颜色回到贴图本色。
   size 按真实金刚鹦鹉体长 ~0.85m **放大到 1.1m** —— 实测 0.85m 在池边（10m 外）
   只有 ~10px 红点，达不到老黄要的"更显眼"（园林是氛围场景，尺寸略夸张可接受）。
   ⚠️ 落点见下方 MACAW_SPOTS（历届重选史都在注释里；2026-10-14 起 ③ 在西假山顶、①② 留东假山顶 —— 两座真山之间才飞得出"换峰"）；
   它与石上小鸟的落点（ROCK_SPOTS，山顶）已完全分离，不再需要"让开 0.7m"的偏移
   ——那条偏移是为避免鹦鹉挡住小鸟"脚底贴石面"的射线判定，新落点天然不重叠。 */
/* ⚠️⚠️ 第十轮重选落点（老黄："你把鹦鹉移到这个假山的顶部，顺便说一下，我只看到了
   2 只鹦鹉"）。诊断（outputs/_diag/macaw-vis-map.mjs，东假山 0.35m 网格射线实测）：
   旧三点 (9.0,4.68,16.75)/(9.25,4.47,16.5)/(8.25,3.87,16.5) 都在**山顶西侧背坡**：
   从池边（老黄平时站的地方）与默认机位看过去，山体本身把它们全挡了 ⇒ 默认机位
   一只都看不见，他自己转视角才看到 2 只（第三只被石体遮住）。
   新落点取**北坡（朝池子那一侧）的肩部** —— 那里被池北/池中桥/池东北三个锚点
   同时直视可见（实测 seenBy=3），高度 y≈3.8~3.9（山顶以下但在视线之上）。
   ⚠️ 第三只曾放在 (8.30,3.87,16.40)，距石上小鸟 #2 的落点 (8.25,3.87,16.50)
   只有 **0.11m** —— 鹦鹉的脚挡住了 birds-guard "小鸟脚底贴石面"那条判据的上打射线
   （实测 gap −0.27，门禁当场报红）。现沿坡面移到 (7.75,3.86,16.60)，与最近小鸟
   拉开 0.52m，射线不再命中鹦鹉（birds-guard 复跑 15/15）。
   ⚠️ 池西北/西岸两个方向被山挡是几何必然（山就在那儿），不强求。 */
/* ⚠️⚠️ 第十一轮：老黄"你把鹦鹉移到这个假山的顶部"（他指的是东假山）。
   上一轮的三点（北坡肩部 y≈3.8）虽然"从池边三锚点直视可见"是对的，但按字面
   要求还差着"顶部"——东假山真峰顶在 y≈5.0~5.2。
   ⚠️⚠️ **复核落点高度时必须把鹦鹉自身网格排除在射线之外**（macaw-vis-map 的教训）：
   它从空中往下打第一个命中就取 y，射线先打到鹦鹉自己的身体 ⇒ 报出的"石面 4.58"
   其实是鹦鹉腰高。真正石面要另跑一遍排除 metalness=0.25 的探针
   （outputs/_diag/macaw-gap.mjs）——真值是 3.88/3.79/3.82（与当前落点一致、
   gap=0，站得没问题）。
   重排后的分布（真实石面高，脚底 gap=0 由 macaw-gap 复核）：
     ① (9.70, 3.88, 14.65) 北坡肩 —— **五个池边锚点全部直视可见**（seenBy=5，
        全场唯一），是"任何角度都看得到一只"的保底；
     ②③ (10.05, 5.19, 11.85) / (10.75, 5.02, 11.85) 山脊北端岩尖 —— y 5.19/5.02
        都在山体最高点 5.09 上下 ⇒ 读作"站在假山顶上"，两只有 0.72m 高差不重叠。
        ⚠️ 这两只被池东北锚点直视可见（池北/桥方向的视线从 z=8→11.85 不经过山心
        z=16，几何上不被山挡）；若真机位下读作被挡，退回 ② (10.4, 5.10, 11.85)
        或整体降回北坡三点即可（改这一行就够）。
   ⚠️ 与石上小鸟的间距：最近的小鸟 #2 (9.25, 4.47, 16.50) 距峰顶第二只 4.7m，
   距北坡那只 2.2m —— 都远大于 0.6m 的安全线（0.11m 时曾让 birds-guard
   "小鸟脚底贴石面"的上打射线被鹦鹉脚挡住、报假红 gap −0.27）。 */
/* ⚠️⚠️ 2026-10-20 重排（老黄实拍："两座假山的顶上都会发生两只鹦鹉重叠成一只"）。
   —— 真因有**两个**，不是一个：
   ① **落点太近**：旧 ①(9.2,6.20,15.7) 与 ②(9.97,6.114,16.17) 世界上只差 0.9m，
      而且**几乎正对视线方向** ⇒ 投到默认机位上只差 **27px**（鹦鹉 1.1m 体长在
      默认机位约 46~60px 宽）⇒ 两只糊成一只"双头鹦鹉"。
      ⇒ 教训（第十五轮已写过、这轮又踩）：**峰顶选点要按屏幕间距筛，不能按世界间距** ——
        世界里沿视线方向的那一段，投到画面上等于 0。
   ② **飞到别人已经占着的落点**：换峰飞行的候选过滤只排除了"自己脚下那点"，
      没排除**别的鸟已经站着的那点** ⇒ 一只鸟飞到西峰、另一只正好在西峰 ⇒ 两只完全重叠。
      症状正是"两座假山的顶上都会重叠成一只"（东峰是 ①② 挨太近，西峰是飞过去叠上）。
   —— 本轮的解法：
      · 落点集从 3 个扩到 **4 个**（3 只鸟 + 1 个空位 ⇒ 换峰飞行永远有地方可去；
        这也是"飞到已占位置"能发生的根因：3 点 3 鸟，飞行=换座=必然重叠）。
      · 四个落点**两两屏幕间距 ≥75px**（默认机位 1400×800 实测投影）：
        ①(1202,418) ②(1101,397) ③(840,543) ④(794,605)；
        ①↔② 105px、③↔④ 77px、跨山 ≥360px。
      · 落点高度全部**探针实测**（下打射线取石面顶，probe/_tmp-macaw-spots.mjs，
        0.2m 网格扫两座山 + 投影筛屏距），不是手填。
   ⚠️ 旧落点史（东①② / 西③ 的历次重选理由）见上方注释，保留备查。 */
export const swimTurtles = [];
/* ── 预抽（2026-09-23 · T0）：同 makeKoiGroup 的理由 —— 这 4×2 次 rr() 不能留在异步回调里。
   泳龟在 `loadAssetOnce` 的 onLoad 里抽流，等于让"Turtle.glb 何时加载完"决定全局流的位置，
   而柳/竹/立峰是延迟批（首帧后才跑）⇒ 其后所有抽样整体漂移、不报错。
   顺序与原回调逐条一致：t → speed → jitter → phase。 */
const SWIM_TURTLE_DRAW = [];

/* ══ 池中水禽：绿头鸭 ×2 + 鸳鸯 ×2（2026-10-04）══════════════════════════════
   与泳龟同一套做法（同轨道、每帧推进、挂 world、**进折射层**），两处**刻意不同**：
     ① **不 spawnRipple** —— 每只挂一个**常驻小尾涡圈**（几何随鸭平移），不占涟漪池配额。
        理由见 07-ground makeDuckGeo 头注释：水面涟漪额度是用户拍板过的 ≈30 次/分
        （锦鲤链 + 泳龟链各有一条门禁水位），水禽再挂第三条链会把水面推回"机关水车"。
     ② **独立种子流 duckRnd** —— 位置/速度全由私有 mulberry32 抽，一次全局流都不碰
        （铁律 1：鸭子若吃全局流，其后全园布局整体前移且**不报错**）。
   ⚠️⚠️ 折射层（2026-10-04 返工，这条是**被门禁抓出来的**）：
      第一版**不进层**，理由是"鸭浮在水上，写进去会让它从折射贴图里冒出来"。
      那是错的 —— refract-coverage 判据 ②（反扫"池内越水面的几何没打标记"）一跑就报：
      `duckBody 下探水面 0.26m 却不在层里`。鸭吃水约体高一半 ⇒ **它是半浸物**，
      按本项目自己的口径（"任何'半浸在水里却忘了打标记'的几何，都会在水面处被齐刷刷切断"）
      就该进层。不进层的实际效果不是"更干净"，而是
      **透过水面看到的不是鸭肚皮、而是池底**（水面是半透的，鱼正是这样被看见的）。
      "会冒出来"那条担心只对**出水部分**成立；而鸭出水部分由主通道完整绘制、自己占住那些像素，
      与汀步石那次的实测结论（进层只把俯视顶面写进池底贴图、画面变化在噪声内）是同一回事。
      ⚠️ 只给**本体**打标记，尾涡圈不打：环躺在 +0.014m，是**水面上的贴花**，
         写进"水下贴图"才是真错。
   ⚠️ 与小鸟/泳龟同口径不投影（castShadow=false）：移动投射物会在静态阴影盒里留下
      "冻结在半路的影子"，比没有影子更假。
   ⚠️ 四套羽色 = 四份几何（见 07-ground DUCK_PAL），不共用 —— 绿头/栗胸/橙帆羽/蓝翼镜
   （2026-10-05 起识别色从"白颈环"移到"背棱"：那圈白在俯视下读成了"白领"，鸭子被当成人，
      详见 07-ground DUCK_SCALE 上方）
      正是"一眼认出是什么鸟"的主体。 */
export const swimDucks = [];
/* ⚠️⚠️ 2026-10-05 **整层下线**（老黄："去掉池子里的鸳鸯"）。
   一次性把整层水禽（绿头鸭 ♂♀ + 鸳鸯 ♂♀）都撤了：它们在同一机位只有 12~14px，
   分辨不出种类、只读作"池子里几个点"，与草皮/假山小鸟是同一批量级。
   代码全保留（下面轨道 / 羽色 / 尾涡圈 / 折射层标记一字未动），恢复 = DUCK_ON 置 true。 */
const DUCK_ON = false;
const DUCK_KIND = DUCK_ON ? ['mallardM', 'mallardF', 'mandarinM', 'mandarinF'] : [];
const duckRnd = mulberry32(20261006);
const DUCK_DRAW = DUCK_KIND.map(() => ({
  t:       duckRnd() * TAU,
  /* 比泳龟（0.03~0.07 rad/s）更慢：鸭子是"浮着沲"而不是"游"。
     最慢的轨道 半轴 ~1.9~3.1 ⇒ 一圈约 4~8 分钟，是园林该有的悠闲。 */
  speed:   0.020 + duckRnd() * 0.022,
  jitter:  0.94 + duckRnd() * 0.06,
  phase:   duckRnd() * TAU,
  yawOff:  (duckRnd() - 0.5) * 0.6,
}));
/* 用哪条轨道。**不是随手 i % 7** —— 默认机位到 7 条椭圆的距离实测差得很远
   （最近的中位 36.4m，最远的 44.1m ≈ 屏幕上小三成）。第一版按顺序取 o0~o3，
   其中 o1 中位 **44.1m**，是全场最远的一只，还正好被桥挡住（探测：视线在
   40.4m 处撞 mergedStatic，鸭子 45.6m ⇒ 整只不可见）。
   ⇒ 取中位距离最短的四条：[o0 36.8m, o6 39.7m, o2 40.3m, o3 36.4m]。
   （距离表见 outputs/_diag/ducks-read.mjs 的"轨道体检"段；改轨道不动随机流，铁律 1 安全。） */
const DUCK_ORBITS = [0, 6, 2, 3];

/* ══ 求值期构建（由 08-assemble 在原 266 行位置调用）══════════════════════════════
   ⚠️ 本函数体内语句的顺序 = 全局随机流的消耗顺序 —— 不得调整、合并、拆分或提前。
   ⚠️ 顶层那两个 let 在本函数内赋值，理由见文件头。
   ⚠️ 本函数体不重缩进：与 08-assemble 原文逐字节相同，便于回溯与 diff。 */
export function buildAquatic(){
// 睡莲叶（程序化）+ 锦鲤 + 水草
/* ⚠️ 这里原来 nLotus = 0 —— 我们自己那套**带完整花梗**的荷花一直关着，
   池面上的粉色花全靠 GLB 模型自带（而 GLB 是单网格+贴图，花在不在杆上不由我们决定；
   小缩放的那些株只有 1.2m 高，花正好落在睡莲叶之间）。
   开 12 朵：花梗从水面直达花底，是代码保证的；花瓣/花心是实例化网格，几乎不花 draw call。 */
world.add(makeAquatic(-2.5, 2.2, 5.6, 36, 12));
koiGroup = makeKoiGroup(11);
world.add(koiGroup);
DF_PATROL.forEach(p=>{
  const d = makeDragonfly();
  d.userData.flight = {
    cx: p.cx + rr(-1.5, 1.5), cz: p.cz + rr(-1.5, 1.5),
    ax: p.ax + rr(-1, 1),     az: p.az + rr(-1, 1),
    sp: rr(0.22, 0.42), ph: rr(0, TAU),
    y0: rr(0.4, 1.3),
  };
  world.add(d);
  dragonflies.push(d);
});
for (let i = 0; i < GN; i++){
  const d = makeGoose();
  /* 个体大小微差（整齐得太假）。
     ⚠️⚠️ 2026-10-02 第九轮：整体 **×0.42**（0.86~1.16 → 0.36~0.49）——
     上午那轮"放大 1.4×"是"低空绕圈"前提下的判断（体长 0.42m 想让人看清是雁）；
     第九轮老黄改成"飞高一点 + 显示小一点"（高空横穿小剪影）⇒ 前提反转，
     缩放必须反向调回：**21m 高、50m 外，0.18m 长的雁在画面上 ~6px**，
     刚好是一枚能辨认的"小黑点 + 队形"，而不是一个看得清没建模的近景模型。
     gRnd 抽数次数/顺序一字不动（铁律 1）。 */
  const s = 0.36 + gRnd() * 0.13;               // = 0.42 × (0.86~1.16)
  d.scale.setScalar(s);
  /* ⚠️ 必须**合并**进已有 userData，不能整份替换：makeGoose() 刚把翅膀数组挂在
     d.userData.wings 上（updateGooseFlock 每帧要迭代它）—— 整份赋值会把它抹成
     undefined ⇒ "d.userData.wings is not iterable" 每帧抛错、页面卡在加载页。 */
  Object.assign(d.userData, {
    slot: gooseSlot(0, i),
    form: 0,                                      // 当前阵型（0 人字 / 1 八字）
    /* 缓动位置（从出生点推向槽位） */
    px: 0, pz: 0, roll: 0,
    ph: gRnd() * TAU,                             // 扇翅相位
    sp: 0.90 + gRnd() * 0.22,                     // 个体速度差（队列不会完全刚性）
  });
  world.add(d);
  geese.push(d);
}
/* 换阵时机：6~13s 一次，两种阵型轮流（"飞行过程中变换阵型"） */
GOOSE.nextForm = gRnd() * 6 + 3;
/* 装配完立刻开第一波（起点 x=∓95 在画外 ⇒ 首帧看不到，用户第一次见到的是
   "一队雁从画面左侧飞进来"，而不是从头顶凭空出现）。 */
gooseStartWave();
/* 两个 InstancedMesh（全体小鸟各 1 个 draw call；颜色走 instanceColor） */
const birdMesh = (() => {
  /* ⚠️ **必须开 vertexColors**（2026-10-01）：羽色分区做在几何的顶点色上
     （背深腹浅、头深、翼尾更暗），instanceColor 只能给整只鸟一个颜色。
     不开这个开关的话顶点色会被忽略 ⇒ 鸟退回"全身一个纯色"（老黄反馈的正是这个）。
     ⚠️ instanceColor 与顶点色**相乘**（three 的 vColor = vertexColor × instanceColor），
        所以 instanceColor 给的是接近白的**基调色**（0.92~1.0 的微调），
        真正的颜色来自 BIRD_PALETTE 经顶点色的明度分区。 */
  const mat = new THREE.MeshStandardMaterial({ color:0xFFFFFF, roughness:0.72, metalness:0.0,
                                               envMapIntensity:0.9, flatShading:true,
                                               vertexColors:true });
  const im = new THREE.InstancedMesh(makeSmallBirdGeo(), mat, BIRD_CAP);
  im.castShadow = false; im.receiveShadow = false;
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BIRD_CAP * 3), 3);
  im.count = N_ROCK_BIRD + N_GRASS_BIRD;   // 下线后 = 0 ⇒ 一个都不画（容量仍是 BIRD_CAP）
  im.userData.noMerge = true;
  im.frustumCulled = false;
  im.name = 'smallBirdMesh';   // ⚠️ layout-fingerprint 按名字排除它（见那边的注释）
  world.add(im);
  smallBirdMeshRef.mesh = im;
  /* ⚠️ 两类只数必须**暴露出去**（2026-10-01）：门禁原来把 N_ROCK 写死成 5，
     产品改成 3 只石上后，索引 3/4 被误判成"石上" ⇒ 报出一堆假红
     （"高度 −0.25、越界"），而真正的草上行为反而少算两只。 */
  smallBirdMeshRef.counts.rock = N_ROCK_BIRD;
  smallBirdMeshRef.counts.grass = N_GRASS_BIRD;
  return im;
})();
setSmallBirdMesh(birdMesh);
for (let i = 0; i < N_ROCK_BIRD; i++){
    const s = ROCK_SPOTS[i % ROCK_SPOTS.length];
    birdState.push({ kind:'rock', x: s[0], y: s[1] + BIRD_FOOT_LIFT, y0: s[1] + BIRD_FOOT_LIFT, z: s[2], yaw: bRnd() * TAU,
                     bx0: s[0], bz0: s[2],          // 原始落点：踱步/跳跃的硬顶基准（见 birdStep）
                     bobPh: bRnd() * TAU,            // 呼吸起伏相位
                     stepPh: bRnd() * 3, stepNext: 1.5, stepTo: null, hopU: 0,   // ① 跳跃/踱步
                     turnBodyTo: undefined,          // ② 转身目标角
                     preen: 0, preenSide: 1, peckPh: bRnd() * 3, peckNext: 2,   // ③ 啄毛
                     lookPh: bRnd() * 3, lookNext: 1.5, yawOff: 0,               // 常态左右看
                     flapPh: bRnd() * 4, flapNext: 3 });                        // ④ 抖翅
  }
  for (let i = 0; i < N_GRASS_BIRD; i++){
    const s = GRASS_SPOTS[i % GRASS_SPOTS.length];
    birdState.push({ kind:'grass', x: s[0], y: s[1] + BIRD_FOOT_LIFT, y0: s[1] + BIRD_FOOT_LIFT, z: s[2], yaw: bRnd() * TAU,
                     hopPh: bRnd() * 6, hopNext: 0, hopDur: 0.34, from: null, to: null,
                   peckAt: bRnd() * 3 });
}
/* ⚠️ **把行为状态引用暴露给门禁**（2026-10-01）。触发原因是一次真事故：
   "转头啄毛"里我把变量名写成 `b.peen`（应为 `b.preen`）⇒ `b.yawOff = NaN`。
   而 `p.yaw = b.yaw + (b.yawOff || 0)` 里的 `|| 0` 会把 NaN **静默归零**
   ⇒ 矩阵完全正常、位移/高度/颜色判据全绿，只是**那个动作根本没发生**。
   ⇒ 这类"状态里出了 NaN、但被兜底运算符吃掉"的缺陷，**只能靠读状态抓**，
      矩阵/像素判据一律看不见。暴露引用比在门禁里另起一套测量可靠得多。 */
smallBirdMeshRef.state = birdState;
{
  const c = birdMesh.instanceColor;
  for (let i = 0; i < N_ROCK_BIRD + N_GRASS_BIRD; i++){
    /* ⚠️ **必须转线性空间**：THREE.Color(0x…) 存的是 sRGB 值，而 instanceColor
       是直接进顶点着色器的**线性**色 —— 不转的话颜色会明显偏亮发灰。
       这是 three 材质色也要转、但**手写 instanceColor 时最常被忘掉**的一条。
       ⚠️ 2026-10-01：这里给的是**接近白的基调**（0.90~1.0 的极轻微差异，
       用来让同种鸟的个体之间有微妙深浅差），真正的羽色由几何顶点色的分区承担
       （见 makeSmallBirdGeo）。若这里还给饱和纯色，会与顶点色相乘成一个
       "整体偏色的塑料鸟"—— 正是老黄反馈"自然界很难找到这种纯色的鸟"的那版。 */
    /* 石上（i < N_ROCK_BIRD）走深色羽（见 ROCK_BIRD_PALETTE 注释）；
       草上从 BIRD_PALETTE 头轮 —— 分配逻辑变化不改 bRnd 的抽数次数与顺序（铁律 1）。 */
    const pal = i < N_ROCK_BIRD ? ROCK_BIRD_PALETTE[i] : BIRD_PALETTE[(i - N_ROCK_BIRD) % BIRD_PALETTE.length];
    const tint = 0.92 + bRnd() * 0.08;                    // 个体微差
    /* ⚠️ 顶点色只做**分区明暗**（头深、翼尾暗、背腹有别），色相全靠这里；
        所以这里必须给**接近白**的乘子（0.88~1.0），一旦给饱和色，两者相乘就会
        把整只鸟压成"偏色的黑块"（我第一轮实测 sRGB 只剩 16~75、接近黑）。
        顶点色系数是线性的（直接进着色器），所以 instanceColor 用线性 1.0 附近即可，
        仍按规矩过一遍 convertSRGBToLinear 以免将来有人改成非白值时踩坑。 */
    const col = new THREE.Color(0xFFFFFF).convertSRGBToLinear().lerp(
      new THREE.Color(pal.base).convertSRGBToLinear(), 0.92).multiplyScalar(tint);
    c.setXYZ(i, col.r, col.g, col.b);
  }
  c.needsUpdate = true;
}
makePerchingDragonfly(0);
makePerchingDragonfly(1);
world.add(makeWaterGrass(-13.2, 6.4, 54, 2.6));
world.add(makeWaterGrass(11.5, -3.2, 44, 2.2));
for (let i = 0; i < 12; i++){
  void rr(0, TAU); void Math.sqrt(rnd()); void rr(0.84, 1.06); void rr(0, TAU);   // 等量燃烧
  const a = lrr(0, TAU), rad = Math.sqrt(LR()) * 5.6;
  lotusSpots.push({
    x: -2.5 + Math.cos(a) * rad,
    z:  2.2 + Math.sin(a) * rad * 0.72,
    s: lrr(0.84, 1.06),   // 下限从 0.6 抬到 0.84：0.6 那档全株只有 1.2m，花落在叶盘高度上
    ry: lrr(0, TAU),
  });
}
lotusSpots.forEach(s=>{
  const stemH = GLB_LOTUS_STEM_H * s.s * rr(0.98, 1.03);   // ⚠️ 这 12 次 rr 是全局流的一部分，别动
  void stemH;                                              // 2026-10-24：补杆退役（三态 GLB 自带茎），等量燃烧保留
});
/* ── 池边荷花三态（2026-10-24 · 老黄："荷花是低模资产，花瓣像刀片；没有含苞待放
       和花谢结蓬的状态，按春夏秋三季变化处理"）──────────────────────────────
   旧方案（三轮沿革见上）：AI 生成的 LotusPlant.glb ×12 —— 单网格单贴图、花与叶
   烘死在一起，近看花瓣是刀片；四季只有一个 lotusShow 缩放系数，没有花事阶段。
   新方案：三件独立 GLB（盛开 lotus-bloom / 花苞 lotus-bud / 莲蓬 lotus-pod，
   Rodin Gen-2.5-Medium 生成 + Blender 归一化：高 1.65m、脚底 y=0、1024 JPEG）。
   · 每株一个 holder，三个子节点分别是三态；由 applyGLBSeason 按
     lotusBud / lotusBloom / lotusPod 三键切换（12f-season 的 LOTUS_STATES）。
   · **网格名必须叫 'LotusPlant'**：smoke 的「四类 GLB 资产均已挂载」、
     collectSeasonGLB 的 LotusPlant 数组、refract-coverage 的池内越水面判据
     全按这个名字认领 —— 改名等于把三道门禁的抓手全拆了。
   · ⚠️ 三态**不能叠着摆**（旧丛是"一株一大团"）：三个子节点都放在 holder 原点、
     同一时刻只显示一个 —— 季节切换时直接换 visible，平滑缩放交给
     applyGLBSeason 的 LOTUS_STATES 分支（见 12f）。
   · 风场注入沿用 seasonGLB 机制（12f 的 collectSeasonGLB 会把三态克隆的材质
     统一 clone + addWind —— 与旧丛同一套 tip 摆动参数）。 */
const lotusHolders = [];
/* 先把 12 个 holder 建好（空着不显示）—— 每个状态模型独立到场、独立挂，
   任何一件失败只是"该态缺席"，不会把整片荷花拖没（required:false 的既有约定）。 */
for (const s of lotusSpots){
  const holder = new THREE.Group();
  holder.name = 'LotusPlant';            // 门禁抓手（见上注释）
  holder.position.set(s.x, 0, s.z);
  holder.rotation.y = s.ry;
  holder.scale.setScalar(s.s);
  world.add(holder);
  lotusHolders.push(holder);
}
function attachLotusState(key, src){
  for (const holder of lotusHolders){
    const c = src.clone(true);
    c.name = 'lotusState_' + key;
    c.visible = false;                   // 初始全隐，applyGLBSeason 按当前季节点亮
    holder.add(c);
  }
  /* 迟到资产：季节状态与阴影图都要立刻刷新一次（不等下一次环境切换） */
  HOOKS.onAssetAttached?.();
}
/* ⚠️⚠️ 三件都必须写**字面 URL**（preload-manifest-sync 的 G6 只认字面量或可解析的
   const 标识符；用 `st.url` 这种对象索引它检测不到 ⇒ 判"没人接线" ⇒ 每次进项目
   死等满 PRELOAD_TIMEOUT_MS(180s)。2026-10-11 Horse.glb 踩过一次，见该门注释）。 */
loadAssetOnce('assets/lotus-bloom.glb', 1.65, (src) => attachLotusState('lotusBloom', src));
loadAssetOnce('assets/lotus-bud.glb',   1.50, (src) => attachLotusState('lotusBud',   src));
loadAssetOnce('assets/lotus-pod.glb',   1.60, (src) => attachLotusState('lotusPod',   src));
/* 旧 LotusPlant.glb 已退役删除（git 历史可回退）。 */
world.add(makePondPads(lotusSpots));

/* ── 叶盘自动分层（2026-10-26 老黄："这一片荷叶是不是有穿模问题"）──────────────
   现象：池里 70 多片叶盘叠着，高度差只有 1~2cm，而叶盘是**浅碟**（碟沿上翘
   0.045×缩放，最大 7cm）⇒ 相邻两片的边沿必然切进对方的面，近景就是"穿模"。
   做法：装配完对**所有** MAT.lily 的实例做一遍确定性分层 —— 按 y 从低到高遍历，
   遇到"水平重叠且高度差 < 两片碟沿之和"的，把这一片抬到对方之上（+4mm 余量）。
   ⚠️ 纯几何后处理：不新增/删除实例、不吃任何随机数（铁律 1），只改实例矩阵的 y。
   ⚠️ 会改 layout-fingerprint 的实例矩阵 ⇒ 跑完要重出基线。 */
function separateLilyPads(){
  const RIM = 0.045, PAD_R = 0.62;
  /* 两步：① 按 y 从低到高，水平重叠且高度差 < 两片碟沿之和就往上抬（最多 4 层、上限水面+0.42m），
     抬不动就缩小这一片；② 收尾再做"对称收缩"—— 仍然相交的两片**各缩 6%**，反复到没有为止。
     只缩后面那一片会漏：两片都已被放下的情况下谁也抬不动、谁也不该继续缩到很小。 */
  const CAP_Y = 0.42, MAX_LIFT = 4;
  const meshes = [];
  world.traverse(o => { if (o.isInstancedMesh && o.material === MAT.lily) meshes.push(o); });
  if (!meshes.length) return;
  const m = new THREE.Matrix4(), pos = new THREE.Vector3();
  const quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const pads = [];
  for (const im of meshes){
    for (let i = 0; i < im.count; i++){
      im.getMatrixAt(i, m);
      m.decompose(pos, quat, scl);
      pads.push({ im, i, x: pos.x, y: pos.y, z: pos.z, s: scl.x, q: quat.clone() });
    }
  }
  const hitPair = (a, b) => {
    const need = PAD_R * (a.s + b.s) * 0.95;
    if (Math.hypot(a.x - b.x, a.z - b.z) >= need) return false;
    return (a.y - b.y) < RIM * (a.s + b.s) && (b.y - a.y) < RIM * (a.s + b.s);
  };
  pads.sort((a, b) => a.y - b.y);
  const placed = [];
  for (const p of pads){
    let lifts = 0;
    for (let guard = 0; guard < 24; guard++){
      let hit = null;
      for (const q of placed){
        const need = PAD_R * (p.s + q.s) * 0.95;
        if (Math.hypot(p.x - q.x, p.z - q.z) >= need) continue;
        const rim = RIM * (p.s + q.s);
        if (p.y - q.y >= rim) continue;
        hit = { q, rim };
        break;
      }
      if (!hit) break;
      const want = hit.q.y + hit.rim + 0.004;
      if (lifts < MAX_LIFT && want <= CAP_Y){ p.y = want; lifts++; continue; }
      p.s *= 0.88;
      if (p.s < 0.35) { p.s = 0.35; break; }
    }
    placed.push(p);
  }
  /* ② 对称收缩：仍相交的两片各缩 6%，最多 12 轮（0.94^12 ≈ 0.48） */
  for (let round = 0; round < 12; round++){
    let any = false;
    for (let i = 0; i < pads.length; i++){
      for (let j = i + 1; j < pads.length; j++){
        const a = pads[i], b = pads[j];
        if (!hitPair(a, b)) continue;
        any = true;
        a.s = Math.max(0.32, a.s * 0.94);
        b.s = Math.max(0.32, b.s * 0.94);
      }
    }
    if (!any) break;
  }
  for (const p of pads){
    pos.set(p.x, p.y, p.z);
    m.compose(pos, p.q, new THREE.Vector3(p.s, p.s, p.s));
    p.im.setMatrixAt(p.i, m);
  }
  for (const im of meshes) im.instanceMatrix.needsUpdate = true;
}
separateLilyPads();

/* ── boulder-hero 预取（2026-10-14 · 试水单死锁修复，Chief 实测裁定）──
   预载清单（13-preload）在**模块求值期**就把 7 件计入预算，warmBoot（11-loop）等
   全部 settle 或 180s 超时才放行；而本文件里 boulder 的 fetch 只住在 deferred
   heroStones（deferBootFirst，首帧之后才跑）里 ⇒ warmBoot 不放行 ⇒ 首帧不出 ⇒
   heroStones 不跑 ⇒ fetch 不发起 ⇒ settle 不到 ⇒ 循环等到 180s 才按失败结算。
   修法：**模块期先预取一份**（空回调），等摆位分支跑同 key 时命中 assetCache
   同步落位 —— 与 Macaw 同机制、同一条先到先得。原程序化回滚档不动。 */
loadAssetOnce('assets/boulder-hero.glb', 4.49, () => {});
/* 石灯笼（2026-10-14）：与 boulder 同一条规矩 —— 预载清单在**模块求值期**计数，
   若 fetch 只住在 deferred 批里就会 warmBoot 死锁（boulder 已踩过一次）。 */
loadAssetOnce('assets/stone-lantern.glb', 1.05, () => {});
/* 石狮一对（2026-10-18）：与石灯笼同一条规矩 —— 预载清单在模块求值期计数，
   fetch 只住在 deferred 批里会 warmBoot 死锁，故模块期先预取。 */
loadAssetOnce('assets/stone-lion-male.glb', 1.08, () => {});
loadAssetOnce('assets/stone-lion-female.glb', 1.08, () => {});

loadAssetOnce('assets/Macaw.glb', 0.50, (src) => {
  /* ⚠️⚠️ 2026-10-20：**鸟数与落点数解耦** —— 落点集 4 个、鸟 3 只。
     旧写法是"每个落点造一只鸟"（for (const s of MACAW_SPOTS)）⇒ 落点一多，鸟就变多
     （门禁 macaw-guard 钉的是 3 只）。现在明确：鸟数 = MACAW_COUNT，落点里多出来的
     那个**空着**，专供"换峰飞行"当落点（3 点 3 鸟时飞行=换座=必然两只叠一起）。 */
  /* 翅膀权重烘焙（一次，烘在 src 几何上 —— 三只 clone 共享同一份 geometry）。
     mask = smoothstep(0.25,0.34,|x|) × (1−ss(y,0.48,0.62)) × (1−ss(z,0.52,0.66))，
     再乘 sign(x)：+x 翼正角朝外上抬、−x 翼负角镜像。窗口全部来自
     outputs/_diag/macaw-wing-map.mjs 的顶点量测（翅外缘 |x|≥0.32、头颈 z>0.66），
     不是目测 —— 手填窗口的头会跟着扇（见 MACAW_WING 注释①）。
     ⚠️ 2026-10-26 修"跳起时爪子瞬间变大"：旧阈值 0.18,0.32 把外侧脚趾(|x|≈0.20)算进翅膀，
     跳起时的两次扇翅(0.22rad)把脚趾拉开，近景下读作"爪子张开且变大"（outputs/_diag/
     macaw-close-*.png 对比：u=0.27 时脚掌展开宽度比静止时大一倍）。改 0.25,0.34 后
     脚趾权重归零(1417 个脚部顶点中 |w|>0.01 从 45→0)，翅根仍有 1414 顶点>0.5。
     ⚠️⚠️ 2026-10-30（**资产压缩批次引入的真 bug，macaw-wing-guard 报 `+0/−0`**）：
     上面那些阈值（0.25/0.34/0.48/0.62/0.52/0.66）是**米制**——它们来自压缩**前**那版
     浮点 POSITION 的顶点量测（`macaw-wing-map.mjs`）。压缩后 Macaw.glb 的 POSITION 变成
     了 `KHR_mesh_quantization` 的 **Uint16 原始整数**（accessor `normalized:false`，
     磁盘值域 [0,16383]，语义值域 [0,6908]），真实尺寸靠**节点变换**
     `translation + scale≈1.156e-4` 恢复。于是 `pos.getX(i)` 拿到的是 1164 这种数，
     `|x| ≫ 0.34` ⇒ `ss` 恒 1；而 `y≈848 ≫ 0.62`、`z≈10946 ≫ 0.66` ⇒ 两个
     `(1 - ss(...))` 恒 0 ⇒ **三者相乘恒为 0**（实测 16413 个顶点权重全 0，
     `+0/−0`，扇翅注入 0px 差异）。
     ⚠️ 注意 `pos` 在压缩件上是 **InterleavedBufferAttribute**（stride=4，VEC3 被 padding
     到 4 个 16 位分量）——所以只有 `pos.getX/getY/getZ` 是对的，**绝不能**用
     `pos.array[i*3]` 自己算下标（那会读到隔一个的垃圾值）。
     修法：**先把坐标换算回米制再套阈值**。不用节点变换（几何是共享的、变换在 clone 上），
     直接按几何自身的包围盒归一 —— 以模型原始米制尺寸为目标尺度，
     等价于"把几何缩回压缩前那版浮点的量纲"，阈值一位不改。 */
  src.traverse(o => {
    if (!o.isMesh || o.geometry.userData.aWingDone) return;
    const geo = o.geometry, pos = geo.attributes.position;
    const ss = (v, a, b) => {
      const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    /* 量纲对齐：量化件是 Uint16 原始整数，浮点件本来就是米制。
       用**数组类型**这一个判据（不猜 scale），浮点件原样跳过 —— 与 06e 的
       dequantizeGeometry 同一条思路：判据来自"数组到底是什么类型"，不来自猜测。
       ⚠️ 归一化基准取 **x 轴半宽**，不是最长边：三个 `ss` 里只有 `ss(|x|,…)` 是
         主轴判据（另两个是 `1−ss` 的"排除头颈/腿"），把最长边（这里是 y）当基准会
         把 x 轴压得过小 ⇒ 权重又全落到 0（实测 k=4.88e-5、16413 顶点仍全 0）。
         选定目标值 `X_HALF = 0.40`：这是压缩前浮点件实测的 |x| 上界（翅尖），
         阈值 0.25/0.34 恰好落在该量纲里 —— 与原版一致，阈值一位不改。 */
    const X_HALF = 0.40;
    const isQuantized = !(pos.array instanceof Float32Array);
    if (isQuantized){
      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity,
          mnz = Infinity, mxz = -Infinity;
      for (let i = 0; i < pos.count; i++){
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
        if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      /* x 与 y 分别归一（不共用 k）：压缩件的 y 轴量程是 x 的 2.4 倍，
         共用 k 会让 y 落在 [0,2.4×X_HALF] 而 ss(y,0.48,0.62) 判错。 */
      const kx = (mxx - mnx) > 0 ? X_HALF / ((mxx - mnx) / 2) : 1;
      const ky = (mxy - mny) > 0 ? (X_HALF * 2.4) / (mxy - mny) : 1;
      const kz = (mxz - mnz) > 0 ? (X_HALF * 2.2) / (mxz - mnz) : 1;
      const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2;
      const arr = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++){
        const x = (pos.getX(i) - cx) * kx, y = (pos.getY(i) - cy) * ky, z = (pos.getZ(i) - cz) * kz;
        arr[i] = ss(Math.abs(x), 0.25, 0.34)
               * (1 - ss(y, 0.48, 0.62)) * (1 - ss(z, 0.52, 0.66))
               * (x >= 0 ? 1 : -1);
      }
      geo.setAttribute('aWing', new THREE.BufferAttribute(arr, 1));
      geo.userData.aWingDone = true;
      return;
    }
    /* 浮点件（压缩前的资产形态）：坐标本来就是米制，原样套阈值。 */
    const arr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++){
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      arr[i] = ss(Math.abs(x), 0.25, 0.34)
             * (1 - ss(y, 0.48, 0.62)) * (1 - ss(z, 0.52, 0.66))
             * (x >= 0 ? 1 : -1);
    }
    geo.setAttribute('aWing', new THREE.BufferAttribute(arr, 1));
    geo.userData.aWingDone = true;
  });
  for (const s of MACAW_SPOTS.slice(0, MACAW_COUNT)){
    const holder = new THREE.Group();
    /* ⚠️ 必须显式命名：Rodin 导出的这个 GLB **节点名就是泛用的 `Mesh`**
       （`node -e` 解容器实测：nodes: ["Mesh"]、meshes 为空名），
       于是"鹦鹉在不在场景里"这件事**任何门禁都问不出来** ——
       与另外四类资产（KoiFish / Turtle / BananaPlant / LotusPlant 都有可辨识节点名）
       相反。这是"清单漏了一件也全绿"的第二层成因：即便门禁想查它，也没有抓手。
       ⇒ 这里给 Group 起名 'Macaw'（与四类资产同风格的大驼峰），
         smoke 与 pwa-cache 即可用 `o.name.includes('Macaw')` 断言它到位。
       ⚠️ 大小写敏感：命名与断言必须一致（'macaw' 匹配不上 'Macaw'）。
       ⚠️ Group 不参与 mergeStatics（它只吃 Mesh），且鹦鹉是**迟到资产**、
          attach 发生在合并之后 ⇒ 加名字不会改变任何几何合并行为。 */
    holder.name = 'Macaw';
    markArtLicense(holder, 'macaw');            // userData.artLicense = '写意艺术处理：……'（不影响几何/动作）
    holder.position.set(s[0], s[1], s[2]);
    /* ⚠️ 第十五轮：2.4 时三只**背对默认机位**（8× 放大图里只看到后背，读不出"鹦鹉"）。
       改 2.4+π≈5.54 后正对机位，红头/白脸/绿蓝翅都读得出来 —— 对照
       outputs/_diag/macawspread/zoom-C_spread_face.png 与 zoom8-birds.png。
       ⚠️ 生成 GLB 的正面朝向未知，这个偏移是**出图标定**出来的，不是推导出来的。 */
    holder.rotation.y = 5.54;
    const c = src.clone(true);
    let wingU = null;
    c.traverse(o => {
      if (!o.isMesh) return;
      /* ⚠️ 每只鸟**独立材质**：扇翅相位逐鸟错开，共享一份材质三只就会整齐划一地扇
         （读作机械玩具 —— 与"相位逐鸟不同"的既有取舍同一族）。
         clone 后各自持有 uWing uniform；onBeforeCompile 源码相同 ⇒ three 仍只编一份 program。
         ⚠️ 旧写法直接改共享材质的 metalness —— 顺手升级为"clone 后再改"，行为不变。 */
      const m = o.material.clone();
      m.metalness = 0.25; m.roughness = 0.65;    // 生成件 metalness=1 会渲成黑块（既有取舍）
      wingU = { value: 0 };
      m.userData.wingU = wingU;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uWing = wingU;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>',
            '#include <common>\nuniform float uWing;\nattribute float aWing;')
          .replace('#include <begin_vertex>', [
            '#include <begin_vertex>',
            '{',
            '  float wingA = uWing * aWing;',
            '  float wc = cos(wingA), ws = sin(wingA);',
            '  vec2 wrel = transformed.xy - vec2(0.0, ' + MACAW_WING.pivotY.toFixed(3) + ');',
            '  transformed.x = wrel.x * wc - wrel.y * ws;',
            '  transformed.y = wrel.x * ws + wrel.y * wc + ' + MACAW_WING.pivotY.toFixed(3) + ';',
            '}',
          ].join('\n'));
      };
      m.needsUpdate = true;
      o.material = m;
      o.castShadow = true; o.receiveShadow = true;
    });
    holder.add(c);
    world.add(holder);
    /* 注册进作息/动作系统。base = 落点（脚底石面），yaw0 = 出图标定过的正面朝向。
       ⚠️ 相位与事件计数器必须**逐鸟不同**，否则三只整齐划一、读起来是机械玩具。
       ⚠️ rotation.order 必须是 'YXZ'：先偏航再俯仰 —— 点头才绕**鸟自己**的横轴；
         默认 XYZ 会让俯仰绕世界横轴，鸟会朝侧面栽。 */
    const perch0 = macawWantPerch();
    holder.rotation.order = 'YXZ';
    holder.visible = perch0;
    MACAWS.push({
      holder, base: new THREE.Vector3(s[0], s[1], s[2]), yaw0: 5.54,
      phase: (s[0] * 1.7 + s[2] * 2.3) % 6.2832,
      c: 1 + (Math.abs(s[0] * 13 + s[2] * 7) | 0) % 97,
      i: MACAWS.length,
      mode: perch0 ? 'perch' : 'away', mt: 0,
      ev: 'rest', evT: 0.4 + (s[2] * 3) % 2.1, yaw: 5.54, yawT: 5.54,
      wingV: 0, wingT: 0, matWing: wingU,       // 翅膀角：跟随值 / 目标值 / 该鸟的 uniform 句柄
    });
  }
  onAssetAttached();               // 迟到资产立刻拿到当前季节状态
});

// 芭蕉（台基两侧，成丛）—— 高假茎 + 顶部叶片
[
  { x: -15.6, z: -5.6, h: 3.6, s: 1.15, fruit: true, ry: 0.5 },
  { x: -15.0, z: -8.2, h: 2.6, s: 0.92, ry: 2.1 },
  { x: -17.2, z: -9.6, h: 2.1, s: 0.8,  ry: 4.0 },
  { x:  17.6, z: -5.6, h: 3.2, s: 1.05, ry: 3.0 },
  { x:  18.6, z: -8.2, h: 2.5, s: 0.9,  ry: 4.4 },
  { x:  17.0, z: -9.6, h: 2.0, s: 0.78, ry: 1.2 },
  { x: -18.6, z: -3.2, h: 2.8, s: 0.95, ry: 5.2 },
  { x:  19.0, z: -4.6, h: 2.8, s: 0.95, ry: 2.6 },
].forEach(b => world.add(makeBananaPlant(b.x, b.z, b.h, b.s, b.fruit, b.ry)));

// 乌龟：石上晒背（假山卧石、驳岸石顶）
placeAssets('assets/Turtle.glb', 0.5, [
  { x: -4.9,  y: 0.3, z: 12.6, ry: 0.7, s: 1.0 },
  { x:  11.0, y: 0.3, z: 14.6, ry: 2.5, s: 0.9 },
  { x: -13.6, y: 0.34, z: 5.4, ry: 1.3, s: 0.8 },
  { x:  12.8, y: 0.3, z: -0.8, ry: 4.1, s: 0.85 },
]);
/* 石灯笼的**摆位**已于 2026-10-17 搬到 15-stable 的 makeStableRoad（老黄："可以放在马厩到
   院子的这条石板路两侧，每一段距离放一对，毕竟还有晚上进出的需求"）—— 池北岸那一盏撤掉，
   资产复用到院外石板路两侧。此处**只保留模块期的预取**（见上面那一行空回调的 loadAssetOnce）：
   预载清单在模块求值期计数，若连预取一起删掉，warmBoot 会等满 180s（boulder 已经踩过一次）。 */
for (let i = 0; i < 2; i++){
  SWIM_TURTLE_DRAW.push({ t: rr(0, TAU), speed: rr(0.03, 0.07), jitter: rr(0.7, 0.95), phase: rr(0, TAU) });
}
loadAssetOnce('assets/Turtle.glb', 0.46, (src)=>{
  for (let i = 0; i < 2; i++){
    const h = new THREE.Group();
    h.add(src.clone(true));
    /* 泳龟每帧都在动。阴影改按需更新后，移动投射物会留下"冻结在半路的影子"——
       比没有影子更假；锦鲤本就关投影（loadAssetOnce 的 castShadow=true 只惠及静物），
       泳龟同口径。0.46 的尺寸也低于"小件不投影"的 1.1 阈值，只是它迟到躲过了那道遍历。 */
    h.traverse(o=>{ if (o.isMesh) o.castShadow = false; });
    const d = SWIM_TURTLE_DRAW[i];            // 预抽值（见上）：回调里**绝不**抽流
    h.userData = { orbit: i % KOI_ORBITS.length, t: d.t, speed: d.speed,
                   jitter: d.jitter, phase: d.phase };
    markUnderwater(h);                 // 泳龟异步挂载：layer 不继承，进场景前补打折射层标记
    world.add(h);
    swimTurtles.push(h);
  }
  onAssetAttached();
});
{
  const duckMat = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF, roughness: 0.74, metalness: 0.0, envMapIntensity: 0.85,
    flatShading: true, vertexColors: true });
  const wakeMat = new THREE.MeshBasicMaterial({
    map: makeDuckWakeTex(), transparent: true, depthWrite: false,
    opacity: 0.42, color: 0xFFFFFF });
  const wakeGeo = makeDuckWakeGeo();
  DUCK_KIND.forEach((kind, i) => {
    const h = new THREE.Group();
    h.name = 'duck' + i;
    const bodyMesh = mesh(makeDuckGeo(kind), duckMat, { name: 'duckBody' + i, cast: false });
    h.add(bodyMesh);
    /* 本体进折射层（半浸物，理由见上）；尾涡圈不进。 */
    markUnderwater(bodyMesh);
    /* 常驻尾涡圈：挂在鸭身上 ⇒ 随鸭平移；鸭只绕 Y 转、环是对称的 ⇒ 转不转一样。
       y 抬 0.014m 压在涟漪环之上一点点，避开与水面对平面的 z-fighting。 */
    const wake = mesh(wakeGeo, wakeMat, { name: 'duckWake' + i, cast: false });
    wake.position.y = 0.014;
    h.add(wake);
    /* ⚠️ 鸭子每帧都在动 —— 必须挡掉 mergeStatics，否则会被并进静态大网、
       之后再也动不了（点景人物/泳龟同一道标记）。 */
    h.traverse(o => { if (o.isMesh){ o.userData.noMerge = true; o.castShadow = false; o.receiveShadow = false; } });
    const d = DUCK_DRAW[i];
    h.userData = { orbit: DUCK_ORBITS[i], t: d.t, speed: d.speed,
                   jitter: d.jitter, phase: d.phase, yawOff: d.yawOff, wake, kind };
    world.add(h);
    swimDucks.push(h);
  });
}
}

/* 已整块搬到上表模块，这里统一转出，消费方的 import 路径不变（⚠️ 先 import 再 export；末尾不留逗号）。 */
export {
  GOOSE,
  geese,
  macawState,
  macawSpots,
  macawWantPerch,
  perchingDragonflies,
  smallBirdMeshRef,
  smallBirds,
  updateGooseFlock,
  updateMacaws,
  updateSmallBirds
};
