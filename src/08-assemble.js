// 08-assemble: from index.html inline 495..1746
import { THREE } from '../vendor.js';
import { validateGeometry, mergeStatics, fitShadowCamera } from './09-lights.js';
import { collectAOSkip } from './10-post.js';
import { applyEnv, onAssetAttached, collectSeasonCaches, ENV, envEl, initEnvScene } from './12-env.js';
import { scene, world, renderer, camera, controls, CAM_MIN_DIST, CAM_HOME, PROBE_DRIVEN } from './02-scene.js';
import { bootMark, rr, TAU, mulberry32, rnd, CFG } from './00-config.js';

/* ── W2（2026-10-15）：jr/WR 两条布局流已搬进 ./08b-figures.js（同一枚对象）。
   08 仅 import { jr } 供补石用；WR 本模块别处不用。 */
import { makeKoiGroup } from './06-vegetation.js';   /* 门面自持（定义在 06 本体 :77），暂留 */
import { perchingAnchors } from './06d-corridor.js';
import { placeAssets, loadAssetOnce } from './06e-assets.js';
import { rippleInst } from './06f-ripple.js';
import { KOI_ORBITS, baitPoints } from './06g-koi.js';
import { makeRockery, makeRockChain, makeTaihuHeroGeo } from './06h-rock.js';
import { makeLotusPod, makeWaterGrass, makeBananaPlant, makeWillow, makePeachTree, makePlumTree, makeOrchidPot } from './06i-trees.js';
import { makeReedBladeGeo } from './06c-organs.js';
import { makeMistField, makeWisteria, makeAquatic, makeBamboo, makePondPads } from './06j-herbs.js';
/* 2026-10-05 拆分：雾团 + 香炉白烟已搬进 06b-atmos.js（两者是"billboard 氛围片"，与植被建模无关）。 */
import { makeFogBanks, makeCenserSmoke } from './06b-atmos.js';
import { makeGround, makeDistantHills, makeWalls, makePaving, makeDragonfly, makeGoose, makeSmallBirdGeo, makeDuckGeo, makeDuckWakeGeo } from './07-ground.js';
import { makePond, makeBankRocks, makeArchBridge, makeSteppingStones, POND_RADII, markUnderwater, groundHeight } from './05-water.js';
import { makeYuanxiangHall, makeWaterPavilion, makeCorridor } from './04-buildings.js';
/* 15-stable（2026-10-09 · 老黄："院子外围做一个马厩：停 4 匹马、2 驾双轮马车、一个马夫喂草料"）：
   建筑 + 马 + 马车 + 场院杂物整组在那个模块里；**马夫不在这里建** —— 人物工厂 makeScholar
   就在本文件下方，马厩模块持有它会造成循环 import。这里只import 马厩整体与"手里的草料捆"。 */
import { makeStable, makeFeedBale, loadStableHorses, makeStableRoad } from './15-stable.js';
import { mesh } from './03-factory.js';
import { MAT, WIND, willowOrigins, rockNormalTex, registerWeatherRoles, makeDuckWakeTex } from './01-materials.js';
import { buildProps, SEAT_SPOTS, QIN_SEAT, PROP_SPOTS, makeWoodBucket, BUCKET_HANDLE_H, setGoPiecesVisible } from './14-props.js';
/* ══════════════════════════════════════════════════════════════
   8 · 组装场景
   ══════════════════════════════════════════════════════════════ */
/* world 的分配已下移到 02-scene（破 06↔08 的环，见那里的注释）；
   这里保留 re-export，让其余仍从本模块取 world 的地方（index.html）不必改动。 */
export { world };
scene.add(world);
/* ⚠️ 这个标记**不是**"场景骨架开始"，而是"模块级构建结束"。原来它与下面 5220 行同名
   （都叫「骨架」），分段日志里出现两个连续同名项，看的人会以为重复计数。
   ⚠️ 2026-09-20 实测订正：本标记与 '渲染器' 之间那段**曾经**被记成"400 多毫秒全花在
   构造函数与程序化贴图上"，加了 §3~§7 刻度后发现那是**纯误判** —— 这五个区段
   （构件工厂/建筑/水体桥/植被/地面围墙）全是函数声明，实测合计 18ms；
   那段几乎全部是天空 PMREM 烘焙（'天空·PMREM' 刻度，396ms）。
   程序化贴图则完全不在这一格里：它们在 01-materials 的模块体里，刻度见
   '贴图·太湖石canvas' / '贴图·太湖石' / '贴图·瓦与砖' / '贴图·法线派生' / '贴图·地面水面'。
   教训：分段日志只在**每段都有刻度**时才可信，缺刻度的区间会把别人的耗时算到自己头上。 */
bootMark('模块构建');

/* ── 启动分片（P1-4）：重几何拆到首帧之后分批装配 ──
   启动分段实测（SwiftShader）：场景组装 ~660ms 是最大的一段同步长任务（审计 P04），
   loading 层动画在它期间掉帧。给"首帧之后才建"的大件一个队列：
   · deferBoot(label, fn) 只登记不执行；首帧渲完（loading 收起）后逐个跑，
     每个 job 之间让出主线程 —— 首帧提前，后面的装配块再长也不挡画面；
   · ⚠️ 「每 job 让出一帧」意味着**每多一个 job 就多等一帧**（软渲染下一帧数秒）。
     所以顺序 = 可见性和探针成本：大件用 deferBootFirst 插队，背景植被打包在后；
   · 延迟批的网格进 deferRoot（world 的恒等变换子组，坐标语义不变），
     跑完单独 mergeStatics(deferRoot)：分两批合并的代价是每个材质桶多 1 个
     draw call（约 +8），换首帧提前零点几秒，值；
   · GTAO 的植被排除表在延迟批跑完后补收（collectAOSkip），否则迟到植被会
     白白进 AO 的法线 pass（AO 成本翻倍）；
   · 迟到的真投射物（竹竿/柳干/石矶）需要补渲一次阴影。
   挑进队列的标准：① 自包含（不向别处回供返回值/中间量）② noMerge 或可在
   延迟批内自合并 ③ 首帧画面少它不穿帮（柳/竹在墙根，立峰在池南远处）。 */
const deferRoot = new THREE.Group();
world.add(deferRoot);
const bootJobs = [];
/* ── T0 · 装配完成信号（2026-09-23）──────────────────────────────────────
   为什么需要它：deferBoot 是"每帧一个 job"（setTimeout(step,0)），探针**没有可等待的完成点**
   ⇒ 采样时刻不同 ⇒ 布局指纹不可复现（实测同一份代码连测两次：InstancedMesh 数 158/160/161、
   竹叶实例数 41202/41643/42309）。有了这个信号，"全局随机流守恒"（铁律 1）才第一次**可测量**。
   探针用法：`await window.__garden.bootDonePromise`（或轮询 `__garden.bootDone()`）。
   ⚠️ resolve 的落点见 runDeferredBoot 完成分支里的说明 —— 必须在那四步之后，不能提前。 */
export let bootDone = false;
let bootDoneResolve = null;
export const bootDonePromise = new Promise(res => { bootDoneResolve = res; });
function markBootDone(){
  if (bootDone) return;                       // 幂等：无延迟批时也会走到这里
  bootDone = true;
  if (bootDoneResolve){ bootDoneResolve(); bootDoneResolve = null; }
}
function deferBoot(label, fn){ bootJobs.push({ label, fn }); }
/* 插队登记（unshift）。⚠️ 这不是优化，是正确性：延迟链每个 job 之间都 setTimeout(step,0)，
   在软渲染下一帧要好几秒 → **每多一个 job 就多等一帧**。立峰/伴石/题名石是首帧画面上最
   显眼、也是所有探针定位目标的大件，却按登记顺序排在 14 个柳/竹之后，要等十几帧才轮到
   （实测 240s 窗口内 steleGroup 始终不出现 → 题名石门禁假红）。柳/竹是墙根背景，晚到不穿帮；
   立峰晚到等于"画面里没有园子"。所以把大件插到队首。 */
function deferBootFirst(label, fn){ bootJobs.unshift({ label, fn }); }
export function runDeferredBoot(){
  if (!bootJobs.length){ markBootDone(); return; }   // 无延迟批也要发信号（幂等，T0）
  let i = 0, spent = 0;
  const step = () => {
    if (i >= bootJobs.length){
      mergeStatics(deferRoot);
      /* 季节缓存重收（2026-09-19 冬柳回归）：柳/竹/苇这些延迟批物件此刻才进 world，
         模块期收的 willowLeafInsts / seasonMeshCache 全是空的 —— 不重收，
         冬季 willowLeaf=0.02 永远写不进去（柳树照旧满树垂帘）。 */
      collectSeasonCaches();
      applyEnv(ENV.cur);                          // 立刻按当前季节/天气套一遍，不等下一次切换
      collectAOSkip();
      renderer.shadowMap.needsUpdate = true;      // 迟到的真投射物
      console.log('[启动分段·延迟] 合计 ' + spent.toFixed(1) + 'ms（' + bootJobs.length + ' 批）');
      /* ── T0：装配完成信号就发在这里 ──────────────────────────────
         ⚠️ 必须在这四步**之后**，不能提前：
           · mergeStatics(deferRoot) 会**改变对象组成**（多个网格并成 1 个）；
           · collectSeasonCaches() 会**重收季节叶量**（冬季 willowLeaf 写不进去的那个坑）；
           · applyEnv(ENV.cur) 按当前季节/天气套一遍（影响季节显隐与叶量）；
           · collectAOSkip() 影响遍历时的可见集合。
         早 resolve = 把噪声交给探针，那 T0 就白做了。 */
      markBootDone();
      bootJobs.length = 0;
      return;
    }
    const job = bootJobs[i++];
    const t = performance.now();
    try { job.fn(); } catch (e){ console.warn('[延迟装配] ' + job.label + ' 失败：', e && e.message); }
    spent += performance.now() - t;
    console.log('[启动分段·延迟] ' + job.label + ' ' + (performance.now() - t).toFixed(1) + 'ms');
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

world.add(rippleInst);                       // 涟漪池的挂载点（见上方 RIPPLE_STATE 定义）
world.add(baitPoints);                       // 投喂饵粒子的挂载点（计划书 Phase 3 第 6 项）

world.add(makeGround());
world.add(makeDistantHills());
world.add(makePond());
/* 低空云雾（2026-09-19）：贴水面的 resolvational-style 云絮层。
   放在 pond 之后即可 —— 它是 transparent，three 自动排在最后渲，与水面/花草的
   前后关系由深度测试决定； ownership only 1 draw call（单个 InstancedMesh）。 */
const mistField = makeMistField();
world.add(mistField);
/* 半遮半掩雾团（正堂/竹林各一团，淡入随时辰走，见 06 的 FOG_BANKS 与 12-env 活雾注释） */
world.add(makeFogBanks());
world.add(makeBankRocks());
world.add(makeWalls());
bootMark('环境几何');

// 台基前铺地（放在台基面上，避免与池水重叠）
world.add(makePaving(20, 2.6, 0, -7.9, 1.30));

// 远香堂
const hall = makeYuanxiangHall();
hall.position.set(0, 0, -12.8);
world.add(hall);

// 水榭（池塘东侧临水）
const pavilion = makeWaterPavilion();
pavilion.position.set(14.2, 0, 6.4);
pavilion.rotation.y = Math.PI / 2;          // 敞开面正对池水（西向），"荷风四面"匾额挂此面
world.add(pavilion);

// 游廊：远香堂东翼 → 折向东南沿东墙
const corridor = makeCorridor([
  new THREE.Vector3(10.6, 0, -9.6),
  new THREE.Vector3(13.2, 0, -9.6),
  new THREE.Vector3(13.2, 0, -1.8),
  new THREE.Vector3(24.0, 0, -1.8),
  new THREE.Vector3(24.0, 0, 15.0),
], 3.0);
world.add(corridor);
// 紫藤主景：连廊转角处一大丛（扩大 2~3 倍，作为视觉焦点）
// ⚠️ 2026-09-28 修"紫藤长到桥上"：spanCap 5 + 心东挪 13.2→13.8 —— 旧藤长 10m 的
// 最西端（x 8.2，含花穗摆幅到 7.2）探进拱桥栏杆带（桥心 (8.4,·,4.6)，栏带到 x≈9.85），
// 花穗垂在桥栏里。收短挪位后悬挂花穗最西点 = 13.8−2.5−1.04 = 10.26m，桥外余量 0.41m。
// 穗长/花量不变（跟 scale 2.6 走），仍是"一大丛"，只是不再漫过桥面。
const bigW1 = makeWisteria(16, 2.6, 5);
bigW1.position.set(13.8, 3.35, 1.2);
world.add(bigW1);
const bigW2 = makeWisteria(12, 2.2);
bigW2.position.set(13.2, 3.35, -4.6);
world.add(bigW2);

// 石拱桥（池塘东南跨水）
const bridge = makeArchBridge();
bridge.position.set(8.4, 0, 4.6);
bridge.rotation.y = Math.PI * 0.5;
world.add(bridge);

// 汀步
world.add(makeSteppingStones());
bootMark('主建');

// 假山（南岸，与远香堂对景）—— 太湖石峰群
// ⚠️ 第十二轮：两座主峰曾一模一样（h7.2/r0.66 复用同一默认峰型）。
// 现在 style 0=云头峰、style 1=横纹峰 区分造型与 seed 相位。
world.add(makeRockery(-6.5, 14.2, 0));
world.add(makeRockery(9.5, 16.0, 1));

/* 山脊连绵带（第十三轮第二次：评审指出土埂成了"石前堤"——在石群前方靠水一侧，
   不在石间。修正思路：把土埂**穿过峰群链脚下**，并在每块峰脚加"埋脚鼓包"，
   让脊线从视觉上真的把三团石串起来，而非平行于石排的前堤） */
(function ridge(){
  // 山脊位置序列：西假山 → 峰群链峰脚 → 东假山（避开石群前方）
  const pts = [
    [-6.5, 14.2], [-5.4, 14.6], [-4.4, 14.9], [-3.2, 14.6], [-2.4, 14.0],
    [-1.4, 13.6], [-0.4, 13.3], [0.6, 13.0], [1.6, 12.9], [2.6, 12.7],
    [3.6, 12.5], [4.8, 13.0], [6.0, 13.6], [7.2, 14.5], [8.4, 15.2], [9.5, 16.0],
  ];
  for (let i = 0; i < pts.length - 1; i++){
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    /* 山脊段：靠近两端大假山更宽更高；石群链脚下段的鼓包取该点所属峰高的比例，
       让"埋脚"的脊线随峰群高低起伏 —— 峰高则脚隆，形成连续坡 */
    const nearWest  = Math.hypot(mx + 6.5, mz - 14.2);
    const nearEast  = Math.hypot(mx - 9.5, mz - 16.0);
    const nearBig = Math.min(nearWest, nearEast);
    const hBoost = nearBig < 2.2 ? 0.16 : 0.0;                  // 两端假山脚隆
    const base = nearBig < 2.2 ? 2.4 : 1.8;
    const hgt = (nearBig < 2.2 ? rr(0.40, 0.55) : rr(0.22, 0.36)) + hBoost;
    const seg = mesh(new THREE.SphereGeometry(base, 12, 7, 0, TAU, 0, Math.PI / 2), MAT.grass, { cast:false });
    seg.scale.set(1, hgt, 1);
    seg.position.set(mx, -0.10 + hgt * 0.5, mz);                // 顶部与石脚齐平（埋脚）
    gtmp(seg, mx, mz);
  }
  function gtmp(o, mx, mz){
    world.add(o);
    if (jr() < 0.75){
      const br = rr(0.18, 0.38);
      const b = new THREE.IcosahedronGeometry(br, 0);
      const bp = b.attributes.position;
      for (let k = 0; k < bp.count; k++){
        const n = rr(0.8, 1.25);
        bp.setXYZ(k, bp.getX(k) * n, bp.getY(k) * n * 0.6, bp.getZ(k) * n);
      }
      b.computeVertexNormals();
      const m = mesh(b, MAT.rock, { name:'ridgeStone' });
      m.position.set(mx + rr(-1.0, 1.0), br * 0.32 + 0.05, mz + rr(-0.9, 0.9));
      m.rotation.set(rr(-0.3, 0.3), rr(0, TAU), rr(-0.3, 0.3));
      world.add(m);
    }
  }
})();
// 假山连片：沿池南岸一串峰石，接到桥头（江南小桥流水）
// 假山连片：自西侧假山向东延伸，高低错落成群（可嬉戏）
world.add(makeRockChain([
  { x: -4.4, z: 14.9, h: 2.2, r: 0.36 },
  { x: -2.4, z: 14.0, h: 3.6, r: 0.48 },
  { x: -0.4, z: 13.3, h: 2.4, r: 0.38 },
  { x:  1.6, z: 12.9, h: 4.0, r: 0.52 },
  { x:  3.6, z: 12.5, h: 2.8, r: 0.42 },
]));
// 莲蓬（花谢结果）—— 第十一轮：位置全部撤出汀步线（z≈5.6 ± 1m 禁区），
// 旧位 [-1.0,5.8] 等正压汀步石，茎根从石板顶"长"出来（用户红框穿模）
[[-4.2, 3.2], [-1.2, 3.8], [2.6, 2.9], [6.4, 3.3], [-7.5, 3.1]]
  .forEach(([px, pz])=> world.add(makeLotusPod(px, pz, rr(0.7, 1.05))));

/* ── W1（2026-10-15）：步行路径与行走声明已搬进 ./08d-tour.js ──
   buildWalkPath() 必须在这个位置调用（布景之后、人物之前）：
   射线取样要求此刻 world 里只有地形/水/桥/山。 */
import { WALK_PATH, buildWalkPath, walkPointAt, WALKERS,
         WALK_SPEED, WALK_TURN, WALK_STRIDE, WALK_BOB, WALK_SWAY } from './08d-tour.js';
export { WALK_PATH, walkPointAt, WALKERS };
buildWalkPath();

/* ── W2（2026-10-15）：点景人物已搬进 ./08b-figures.js ──
   buildFigures() 必须在这个位置调用（布景之后、koi 之前）：
   D/书童两循环的求值期 jr 消耗顺序与搬家前逐字一致。 */
import { jr, figures, makeSeatedScholar, buildFigures,
         FIG_HAIR, FIG_PALETTE, makeGroomArm, tickGroomFeed, groomFeedState } from './08b-figures.js';
export { FIG_HAIR, FIG_PALETTE, figures, makeGroomArm, tickGroomFeed, groomFeedState };
buildFigures();

// 睡莲叶（程序化）+ 锦鲤 + 水草
/* ⚠️ 这里原来 nLotus = 0 —— 我们自己那套**带完整花梗**的荷花一直关着，
   池面上的粉色花全靠 GLB 模型自带（而 GLB 是单网格+贴图，花在不在杆上不由我们决定；
   小缩放的那些株只有 1.2m 高，花正好落在睡莲叶之间）。
   开 12 朵：花梗从水面直达花底，是代码保证的；花瓣/花心是实例化网格，几乎不花 draw call。 */
world.add(makeAquatic(-2.5, 2.2, 5.6, 36, 12));
export const koiGroup = makeKoiGroup(11);
world.add(koiGroup);

/* 蜻蜓：池塘与南侧草皮上空游弋。
   航迹中心刻意分散布置 —— 若用纯随机，5 只容易挤在同一小片区域 */
export const dragonflies = [];
// 停栖蜻蜓：独立随机流（不消耗主 rnd —— 主场景布局一个数都不能挪）
const perchRnd = mulberry32(777001);
export const perchingDragonflies = [];
const DF_PATROL = [
  { cx: -12, cz:  2, ax: 7, az: 5 },     // 池塘西
  { cx:   0, cz:  6, ax: 9, az: 6 },     // 池中央
  { cx:  10, cz:  2, ax: 7, az: 5 },     // 池塘东
  { cx:  -6, cz: 14, ax: 8, az: 4 },     // 南侧草地（西）
  { cx:   8, cz: 15, ax: 7, az: 4 },     // 南侧草地（东）
];
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

/* ══ 大雁迁徙（2026-09-30 · 老黄："春天和秋天增加大雁迁徙的场景，
      大雁飞行过程中变换阵型（人字和八字）"）══════════════════════════════════
   远景高空的一队雁，13 只。设计要点：
   · **独立随机流** mulberry32(20260930)：不消耗主 rnd —— 全园布局一个数都不能挪
     （项目铁律 1，与停栖蜻蜓 mulberry32(777001) 同一纪律）。
   · **航路**：一条横穿园子上空的平缓大弧（从西南掠向东北），高度 24~31m
     （远观尺度：真实雁群飞得高，低了会变成"在院子里扑腾"）。
   · **两种阵型**（老黄点名）：
       人字（经典雁阵）—— 领头雁在尖端，两臂向后张开成 V；臂越靠后间距越大。
       八字（雁群"绞龙"）—— 两列横向编织：每只的横向偏移取 sin 交叉，
         从上方看是两列互相穿过的"8"字，比人字更松散、更游移。
   · **切换有过渡**：阵型换的是**目标槽位**，实际位置按 1.6s 时间常数缓动过去
     （不能瞬变 —— 瞬变会读成"穿模/闪现"）。
   · 每只按"到目标的槽位方向"侧倾（roll），转弯时队形会真的歪一下。 */
export const geese = [];
const gRnd = mulberry32(20260930);
/* ⚠️⚠️ **2026-10-01 曾整层下线**（老黄："把天上飞的几只小鸟去掉，几个小黑点看也
   看不清，还觉得凌乱"），大雁五轮被否的教训：13 只低模雁在 27m 外每只只有 4~10 像素，
   本来就只是几个黑点；"读出队形"还要求用户恰好站在某个方位、恰好赶上换阵那几秒。
   **2026-10-02 老黄又报"春秋两季的大雁也没有了"，拍板恢复**，恢复时一并处理尺寸：
     · 体长 0.30m 在绕园 26m 的航线上仍偏小 ⇒ 整体再放大 **1.4×**
       （体长 ~0.42m、翼展 ~0.84m —— 翼展是远观认雁的关键，宁可翅大）；
     · 航线/高度/阵型沿用下线前的最终值（绕园大圈 26m、高 10~13m、人字 < / 八字 S）。
   再下线一次的话：把 GN 改回 0 即可（装配循环与季节通道 gooseShow 都还在）。 */
const GN = 13;                                   // 2026-10-01 曾置 0 下线，2026-10-02 按老黄要求恢复
/* ⚠️⚠️ 2026-10-02 第九轮重做航线（老黄："大雁的外形太敷衍了…如果不建模你就让大雁
   飞的高一些，把大雁的显示的样式变得小一些，也不要围绕着院子飞，就从整个画面中
   从左到右（春季），从右到左（秋季），飞完一个回合再生成一波继续飞"）：
   · 高度 10~13m → **21~25m**（远高于堂脊 9.4m，读作"高空过境"）；
   · 尺寸 1.4× 放大 **改回小尺寸**（见下方 s：体长 ~0.18m）—— 高空小剪影正是
     老黄的取舍："飞高一点 + 显示小一点" ⇒ 远到看不出建模细节，就不再暴露"没有建模"。
     （之前那轮放大 1.4× 是"低空绕圈"前提下的判断，第九轮前提变了，缩放必须反向调回。）
   · 航线绕园大圈 → **一条横穿园子上空的直线**（春 西→东 / 秋 东→西），
     飞完一波飞出画面，6~12s 后下一波从对面再来（波次见 GOOSE.phase）。
   旧"绕园大圈"五轮被否的根因（存档）：用户朝向不可控 ⇒ 绕圈永远有一半时间
   在他背后；且 10~13m 低空的大雁近到能看出"没有建模"。 */
const GOOSE_ALT = [19, 21];
/* 队首初始位置（**必须在雁的装配循环之前声明**）——
   2026-09-30 二轮踩过 TDZ：下面雁的初始位置要用它，而 GOOSE 对象在循环之后才声明
   ⇒ "Cannot access 'GOOSE' before initialization"、整页崩。
   第九轮起这里只是"波次起点"（模块期 gooseStartWave() 会按 dirSign 重置）。 */
const GOOSE_HEAD = new THREE.Vector3(-85, 23, -6);
/** 阵型目标槽位（局部：x=横向、z=前后，头雁在原点，飞行方向 = −z）
 *  ⚠️ 2026-10-01 **按老黄的示意图重做阵形**（第三次改阵形了，这次有图为准）：
 *   他画了一张示意图：人字 = `<`（两臂对称张开），八字 = **`S`（一条连续的
 *   曲线）**，并注明"飞行方向也可以反过来"（即 S 要能正读、也能反读）。
 *   ⚠️ **旧版"八字"根本不是八字**：它是两列并排 + 每列 sin 横摆，侧看时投影成
 *   **两条对称的 < 与 > 交叉**（ASCII 图实测，outputs/_diag/goose-shape.log）——
 *   那是个"蝴蝶结"，不是 S。而人字那一版侧看是斜穿的一线，恰恰**像 S**。
 *   ⇒ 等于两个阵型的视觉特征**做反了**。这就是老黄"没有任何大雁飞行图案"的根因。
 *   现在：人字严格 `<`（两臂 z 与 x 等比 ⇒ 45° 对称），八字严格单条正弦 S。
 *   ⚠️ 槽位间距经过三轮反复（1.55/0.95 → 1.05/0.95 → 1.55/1.05），每轮都被
 *   "看不出是一队"打回。现在不再凭感觉调间距，而是**先把阵型在 ASCII 图里
 *   画对**（三视角投影：正面应读成 <、侧应读成 S），再放进 3D。
 *
 *  ⚠️ 槽位间距按老黄示意图的观感：真实雁阵的"个体间距 ≈ 一个身长"（0.3m 量级），
 *   但那样在 27m 外会糊成一条线；这里取 ~0.6~1.6m 的可读折中，
 *   判据以"三视角 ASCII 读成什么形状"为准，不以单点距离为准。 */
function gooseSlot(form, i){
  if (i === 0) return { x: 0, z: 0, lead: true };  // 头雁
  if (form === 0){
    /* 人字 `<`：两臂关于航线**对称**张开。
       ⚠️ x 与 z 的比值必须让单臂角接近 45°（老黄示意图就是这个张角），
       臂太长太窄侧看会塌成一条斜线、读不出人字。 */
    const side = (i % 2 === 0) ? -1 : 1;
    const rank = Math.ceil(i / 2);
    return { x: side * rank * 1.15, z: -rank * 1.15, lead: false };
  }
  /* 八字 `S`：**一条**连续正弦曲线上的 12 个点（不再是两列并排）。
     ⚠️ 这才是老黄图里那个"八字"：侧看时前后方向为横轴、左右偏移为纵轴，
        一条正弦正好读成 S；因为 sin 关于中点反对称，**正向飞与反向飞
        读到的都是 S**（他要求"飞行方向也可以反过来"）。
        ⚠️ 必须用连续 rank=i（不取 ceil(i/2)、不分奇偶）—— 分两列就会退化成
        两条交叉的曲线，侧看变成"蝴蝶结"而不是 S（这是旧版真正的错）。
        ⚠️ 纵向 0.62→0.75、横向频率 0.62→0.52（2026-10-01）：0.62 时队形跨度
        实测 7.6m、掉到 birds-guard 的 8m 之下 ⇒ 拉长纵向到 0.75（跨度 ≈8.9m）；
        横向频率同步降到 0.52 是因为**只拉纵向会把 S 摊平**（同样 12 只、横向摆幅
        不变而纵向变长 ⇒ 曲线更平、读不出 S）。两个一起调才既够长又仍是 S。 */
  const rank = i;
  return { x: Math.sin(rank * 0.52) * 2.3, z: -rank * 0.75, lead: false };
}
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
/* 雁群整体状态（队首那条横穿航路 + 波次时机 + 换阵）——独立于 12-env，季节显隐由它写
   ⚠️⚠️ 2026-10-02 第九轮（老黄："也不要围绕着院子飞，就从整个画面中从左到右（春季），
   从右到左（秋季），飞完一个回合再生成一波继续飞"）：
   航线改成**一条横穿园子上空的直线 + 波次调度**。直线的三个好处：
   ① 队形是正面朝用户的（人字/一字都读得出），绕圈时侧面看会退化成"一条线"；
   ② 起止点在画面左右两侧 ⇒ 一波飞完必然**整个离开画面**，再从对面回来 ——
      老黄说的"飞完一个回合再生成一波"由此自然成立；
   ③ 飞行距离恒定（不像绕圈会时近时远）⇒ 屏幕上尺寸稳定，不用调大小补偿距离。
   方向按季节由 12-env 写 dirSign（春 +1 / 秋 −1）；间隙 6~12s（运行期随机）。 */
export const GOOSE = {
  t: 0, form: 0, nextForm: 0,          // nextForm 到点就换阵
  head: GOOSE_HEAD,                     // 队首世界坐标（横穿航路，见 updateGooseFlock）
  dirSign: 1,                          // +1 = 西→东（画面左→右）；−1 反之（由 12-env 按季节写）
  phase: 'flying',                     // 'flying' 横穿中 / 'gap' 波次间隙（整队在画面外等待）
  gapT: 0,                             // 间隙剩余秒数
  dir: new THREE.Vector2(0, 1),        // 航向单位向量（横穿时恒为 ±x）
  turn: 0,                                 // 当前转向率（保留字段：转场调试用）
};
/* 换阵时机：6~13s 一次，两种阵型轮流（"飞行过程中变换阵型"） */
GOOSE.nextForm = gRnd() * 6 + 3;
/* 波次参数：x=航线的 x 起止（西 −95 / 东 +95，两端都在画面外）、
   z=走廊中心、y=高度（另见 GOOSE_ALT 随机）。
   ⚠️⚠️ z=−20 与高度 19~21m 是**按默认机位反解出来的**，不是随手取的（2026-10-02
   取证 round9-verify.mjs 实测：z=−6、高 23m 时队首入画 **0%**）——
   默认机位在 (−20,17,32) **俯视 −19.3°**、垂直 fov 46° ⇒ 可见仰角只有
   **−42°~+3.7°**。23m 高的雁在 40m 外仰角 +8.5°，整条航线**在画面上沿之外**，
   用户抬头也看不到（这正是"飞太高"的另一面：俯视机位看不到高空）。
   现在 z=−20（距相机 ~56m）：仰角 atan((19−17)/56) ≈ 2.1° < +3.7° ⇒ 全程在画内；
   横向端点 x=±95 的方位偏离视线 86°，远在水平视野 36° 之外 ⇒ 从画面左侧外飞入、
   从右侧外飞出，正是老黄要的"横穿整个画面"。 */
const GOOSE_LINE = { x0: -95, x1: 95, z: -20, speed: 6.0 };
function gooseStartWave(){
  const s = GOOSE.dirSign;
  GOOSE.phase = 'flying';
  GOOSE.head.set(s > 0 ? GOOSE_LINE.x0 : GOOSE_LINE.x1, GOOSE_ALT[0] + 2, GOOSE_LINE.z);
  /* 整队瞬移到波次起点：这是**画外**的瞬移（起点 x=∓95，默认机位画面只在 ±25m 内）
     ⇒ 用户看到的是"下一波从画外飞进来"，不会读成闪现。 */
  const ux = s, uz = 0, rx = -uz, rz = ux;
  for (const g of geese){
    const slot = gooseSlot(GOOSE.form, geese.indexOf(g));
    g.userData.px = GOOSE.head.x + rx * slot.x + ux * slot.z;
    g.userData.pz = GOOSE.head.z + rz * slot.x + uz * slot.z;
    g.position.set(g.userData.px, GOOSE.head.y, g.userData.pz);
  }
}
/* 装配完立刻开第一波（起点 x=∓95 在画外 ⇒ 首帧看不到，用户第一次见到的是
   "一队雁从画面左侧飞进来"，而不是从头顶凭空出现）。 */
gooseStartWave();
export function updateGooseFlock(dt, t){
  GOOSE.t += dt;
  /* 航路（第九轮）：直线横穿 + 波次间隙。
     ⚠️ 绕园大圈五轮被否的根因（存档）：① 用户朝向不可控，绕圈必有一半时间在背后；
     ② 侧视时队形退化成一条线，读不出人字；③ 半径呼吸让尺寸忽大忽小。
     横穿把这三条一起解决 —— 队形正面朝用户、尺寸恒定、飞完必然出画。 */
  const s = GOOSE.dirSign >= 0 ? 1 : -1;
  if (GOOSE.phase === 'gap'){
    GOOSE.gapT -= dt;
    if (GOOSE.gapT <= 0) gooseStartWave();
  } else {
    GOOSE.head.x += s * GOOSE_LINE.speed * dt;
    /* 高度轻微起伏（±0.6m）：直线太死板时反而"不像在飞" */
    GOOSE.head.y = GOOSE_ALT[0] + 2 + Math.sin(GOOSE.t * 0.5) * 0.6;
    GOOSE.dir.set(s, 0);
    /* 飞出画面 ⇒ 进间隙（整队在画外等 6~12s，再由 gooseStartWave 从对面回来） */
    const done = s > 0 ? GOOSE.head.x >= GOOSE_LINE.x1 : GOOSE.head.x <= GOOSE_LINE.x0;
    if (done){ GOOSE.phase = 'gap'; GOOSE.gapT = 6 + Math.random() * 6; }
  }
  /* 换阵：到点 ⇒ 换目标阵型，位置按时间常数缓动过去（不过渡会读成闪现） */
  if (GOOSE.t > GOOSE.nextForm){
    GOOSE.form = GOOSE.form === 0 ? 1 : 0;
    GOOSE.nextForm = GOOSE.t + 6 + gRnd() * 7;
  }
  const hx = GOOSE.head.x, hz = GOOSE.head.z;
  const ux = GOOSE.dir.x, uz = GOOSE.dir.y;          // 航向单位向量
  const rx = -uz, rz = ux;                          // 右向（水平面内）
  /* ⚠️⚠️ "速度前置 lead"（2026-10-02 上午）：一阶缓动追一个以 v 前移的目标，稳态恒落后
     v·τ —— 修之前整队拖在虚拟头雁身后，队形被系统性拉长（实测 maxR 13.4m vs 槽位设计
     9.8m，读作"松散拖尾"而非人字）。把槽位目标沿航向**前移 v·τ** ⇒ 缓动收敛点恰好
     落在设计槽位上（仿真+实测 maxR 13.4→9.8m，人字两臂 13.8m 宽真正张开）。
     ⚠️ 直线横穿后 v 恒定 ⇒ lead 变成常量，但公式仍用 speed 写（换航线时只改一处）。 */
  const lead = GOOSE_LINE.speed * 1.6;               // v·τ
  for (let i = 0; i < geese.length; i++){
    const d = geese[i], u = d.userData;
    u.slot = gooseSlot(GOOSE.form, i);
    /* 槽位 → 世界目标（头雁基准 + 航向/右向 + lead 前移） */
    const tx = hx + rx * u.slot.x + ux * (u.slot.z + lead);
    const tz = hz + rz * u.slot.x + uz * (u.slot.z + lead);
    const ty = GOOSE.head.y + Math.sin(t * 0.5 + u.ph) * 0.9;   // 轻微上下起伏
    /* 缓动趋近（1.6s 时间常数 ⇒ 换阵是"飘过去"不是瞬移） */
    const kp = 1 - Math.exp(-dt / 1.6);
    const nxp = u.px + (tx - u.px) * kp;
    const nzp = u.pz + (tz - u.pz) * kp;
    /* 朝向：机头朝飞行方向；侧倾：横向速度差 ⇒ 转弯时真的歪 */
    const mvx = nxp - u.px, mvz = nzp - u.pz;
    const yaw = Math.atan2(mvx, mvz) + Math.PI;      // 模型头在 +z
    const targetRoll = Math.max(-0.5, Math.min(0.5, -GOOSE.turn * 1.5));
    u.roll += (targetRoll - u.roll) * (1 - Math.exp(-dt / 0.8));
    d.position.set(nxp, ty, nzp);
    d.rotation.set(0, yaw, u.roll, 'YXZ');
    u.px = nxp; u.pz = nzp;
    /* 扇翅：正反相；频率随个体速度微差（整群完全同步会读成机械） */
    const beat = Math.sin(t * (7.2 + u.sp) + u.ph) * 0.52;
    for (const w of d.userData.wings) w.rotation.z = w.userData.sx * beat;
  }
}

/* ══ 鲜艳小鸟（2026-09-30 · "假山石和草皮中随机增加颜色鲜艳的小鸟，
      假山上的在休息，草皮上的在跳跃捕食"）══════════════════════════════════
   两只类群、两种行为，共享一份几何（makeSmallBirdGeo）+ instanceColor 逐只配色：
   · **石上（休息）**：停在实测的石顶（射线量过、y>0.62m 的真石头面），
     几乎不动 —— 只有极轻的"呼吸"起伏 + 偶尔转头（yaw 小幅摆）。
   · **草上（跳跃捕食）**：短促地跳一下 → 停 → 低头啄 → 换到附近新点，
     循环；跳是抛物线小弧（高约 0.12m），不是平移。
   ⚠️ 落点**全部来自探针实测**（outputs/_diag/bird-spots.mjs：石顶 472 候选、
      草皮 1341 候选），不是"随便取个 xz"—— 那样会出现"鸟浮在池塘上/埋在石里"。
   ⚠️ 独立随机流：不吃主 rnd。 */
export const smallBirds = [];   // 行为状态（见下方 birdState），门禁/诊断按它读
export const smallBirdMeshRef = { mesh: null, counts: { rock: 0, grass: 0 } };   // 网格句柄 + 两类只数
const bRnd = mulberry32(20260931);
/* 配色（2026-10-01 重做 · 老黄："颜色不对，自然界很难找到这种纯色的鸟"）
   ── 原版是 5 个**纯色**（0xC9D94A 荧光黄绿 / 0xF2C230 / 0xD8503C / 0x4A8FC9 / 0xE8843C）。
   实测饱和度 0.98~1.00 —— 纯色上限就是 1.0，等于"塑料鸟"。自然界没有全色无斑的鸟：
   真实的小型鸣禽是**羽色分区**的（头/背/腹/翼/尾各有不同）＋低饱和。
   现在按真实鸟种给"分区色"（不再是单色）：
     ① 白头鹎（最常见的"颜色鲜艳"小鸟）：橄榄褐背 + 灰白腹 + 黑头白颊 + 黑尾
     ② 黄鹀莺：橄榄绿背 + 亮黄腹 + 黄翼斑
     ③ 鹊鸲：棕灰背 + 橙红胸腹 + 白腹（"红胁蓝尾"）
     ④ 蓝鸲：石青蓝背 + 橙胸（山蓝鸲，最艳的一种）
     ⑤ 绿绣眼：灰绿背 + 鲜黄腹 + 白眼圈（眼圈要靠几何贴图才画得出，这里只取体色）
   每个色值都是**低到中饱和**的自然羽色，实测饱和度目标 ≤0.55（原来 0.98+）。
   ⚠️ 头部/翼尾的深浅靠 geometry 的顶点色做**分区**，不是靠 instanceColor 单一色 ——
      instanceColor 只能给整只鸟一个颜色，做不出分区（那需要顶点色或贴图）。
      这里给的是"整体基调色"，分区由顶点色承担，见 makeSmallBirdGeo。 */
const BIRD_PALETTE = [
  /* ① 白头鹎 */ { base:0xA79B84, head:0x1E1D19 },   // 灰橄榄褐背 + 近黑头
  /* ② 黄鹀莺 */ { base:0xA2AC60, head:0x97A244 },   // 橄榄绿背（黄调，但压到自然饱和度）
  /* ③ 鹊鸲   */ { base:0xB09580, head:0x4E463A },   // 棕背
  /* ④ 蓝鸲   */ { base:0x6E90B0, head:0x40688E },   // 石青蓝背（蓝得明显）
  /* ⑤ 绿绣眼 */ { base:0x8A9C78, head:0xA6B48A },   // 灰绿背
];
/* ⚠️⚠️ **石上 3 只专用深色羽**（2026-10-02，老黄"一只都看不到"的第二根因）：
   灰白太湖石 + 灰绿/棕灰羽色 = 同明度贴同色背景，近景实测**深褐色那只一眼认出、
   灰调的融进石头**。石上休息的鸟要"贴石头也立得住"，按真实鸟种给深色/高对比。
   ⚠️⚠️ **色值必须考虑 instanceColor 的"白基调 lerp 0.92"再算饱和度**（第一版栽的坑）：
   最终色 = white.lerp(base, 0.92) —— 等于 base×0.92 + 白×0.08。base 是近黑
   （乌鸫 0x35302B 线性 0.036）时，+0.08 白底把 R/G/B 全部抬到 ~0.11 同亮 ⇒
   饱和度只剩 **0.01**（实测门禁报红；门禁的 0.15 下限就是"既不许纯色也不许
   发灰"那条）。暗色鸟要过自然带，base 自身的 R/G/B 差必须更大
   （深褐黑/深棕，而不是中性黑）：
     ① 乌鸫 → 0x4A3B2C：深褐黑（黑中带褐），lerp 白后饱和度 0.27、明度仍 0.14 ——
        远看仍是"一团黑鸟"，近看有暖褐倾向；
     ② 红尾鸲雄鸟 → 0x8C5A40：棕橙胸腹（实测 0.36，本来就过）；
     ③ 黑喉石鵖 → 0x75634E：暖灰褐背（原 0x6B6459 过 lerp 后只剩 0.08）。
   草上 6 只不动（草地绿背景 + 浅色鸟有对比，且那些点老黄自己圈过）。 */
const ROCK_BIRD_PALETTE = [
  /* ① 乌鸫     */ { base:0x4A3B2C, head:0x241C14 },
  /* ② 红尾鸲   */ { base:0x8C5A40, head:0x3A2E24 },
  /* ③ 黑喉石鵖 */ { base:0x75634E, head:0x2A2723 },
];
const BIRD_COLORS = BIRD_PALETTE.map(p => p.base);   // 兼容旧引用：整体基调色
/* 石顶落点：**探针射线实测的真实石面**。
   ⚠️ 2026-10-01 按老黄要求改为「**只停在最高的假山上，2~3 只**」：
      "园中的小鸟做两三只停在最高的假山上休息"。
      实测两处假山（outputs/_diag/rockery-tops.log，0.4m 网格撒点打射线、
      取"周围 0.9m 也是同高"的顶面）：
        东假山（心 9.5,16.0）最高 **5.09m**  ← 最高，用它
        西假山（心 −6.5,14.2）最高 4.08m
      取东假山顶部三个可站面： (10.9, 5.08, 17.0) / (11.3, 4.71, 15.8) /
      (11.3, 3.48, 17.0)。⚠️ **不要再手填坐标** —— 前两版都栽在这：
      ① 落在假山最高峰 y=7.47m（那是"特置立峰"，鸟停那儿远看只有 1~2 像素）；
      ② 高度靠猜（1.6~3.0m）⇒ 画面里就是几只鸟浮在半空、脚下的石头对不上。
   ⚠️ 高度也别太高：5m 处的鸟在默认机位（俯视）离得远、只有几个像素。
      这里选 3.5~5.1m 的三个面，是"足够高（读作'在山顶'）"与"还看得清"之间的折中。 */
const ROCK_SPOTS = [
  /* ⚠️⚠️ 2026-10-02 第四轮重选（老黄："假山上 3 只小鸟一只都看不到，只在草地上
     找到一只"）：上一版的三个点 (10.8~11.2, 5.07~5.10, 16.4~17.0) 在东假山顶的
     **东南背后**（山心 9.5,16.0）—— 从池边/园内（山北）看过去，视线被山体本身
     挡住，鸟在山脊背后 ⇒ 不是"太小看不清"，是**被山挡**。只放大尺寸救不了。
     重选法（outputs/_diag/rockery-pick-north.mjs，0.25m 网格射线实测）：
     站得住（石面 y≥3.0）+ 头顶 1.5m 无遮挡 + **从 4 个观察锚点**（池边 3 处
     + 默认机位）**全部直视可见**（锚点→鸟点反向射线首个命中就是目标点）。
     实测 248 个候选里只有 4 个"4/4 全可见"，全在山西侧平台；取其中 3 个 ——
     高度极差 0.81m、彼此 ≤1m（仍读作"山顶一小群"）、且从默认机位/池边都直视。 */
  [9.00, 4.68, 16.75], [9.25, 4.47, 16.50], [8.25, 3.87, 16.50],
];
/* 草皮落点：**2026-10-01 按老黄标注重排**。
   他圈了六处红框（截图 outputs/_diag/user-birds-2.png），要"其余在草皮上捕食的小鸟
   位置全部移动到红色区域（大致就行）去"。
   ⚠️ **诚实边界**：我用两种量法都没能把红框像素精确反投影成世界坐标 ——
      ① 屏幕像素反投影：每个框都命中相机自己（距离 0m），量出来全是垃圾；
      ② 世界坐标撒点：x∈[−16,2]、z∈[−4,11] 内 40 个可站草地候选，但它们散布在
         西侧各处，**与红框对不上**。
      ⇒ 不再假装量准，按"大致就行"的授权 + 截图里的空间关系（竹丛南侧的草皮与
      铺地边缘、竹影斑驳处）手工取点，落点**仍是实测草地**（下方 sweep 复核高度）。
      复核脚本：outputs/_diag/bird-spots-sweep.mjs（0.8m 网格打射线取 MAT.grass）。 */
const GRASS_SPOTS = [
  [-12.8, -0.30,  1.6],   // 竹林南缘草地（红框 B/C 一带）
  [ -8.4, -0.34,  4.8],
  [ -3.2, -0.28,  2.4],   // 铺地与草地交界
  [  0.8, -0.36,  6.0],
  [ -6.0, -0.30,  8.8],   // 更南、竹影里
  [-10.8, -0.32,  7.2],
];
/* ⚠️⚠️ 2026-10-05 **整层下线**（老黄："去掉……草皮上的小鸟以及假山上的小鸟，保留金刚鹦鹉"）。
   石上/草上都置 0。两处细节：
     ① **instanced 容量保持 9**（BIRD_CAP）—— 容量为 0 时 instanceMatrix/instanceColor
        会是**长度 0 的缓冲**，部分驱动上 bufferData(0) 会告警甚至出错；而 `count = 0`
        是干净的"一个都不画"。
     ② **网格本身保留**（不删）—— layout-fingerprint 按名字排除它，删掉网格反而会动指纹。
   恢复 = 把下面这两个数改回 3 / 6（下面的行为/配色/落点代码一字未动）。 */
const N_ROCK_BIRD = 0, N_GRASS_BIRD = 0;
const BIRD_CAP = 9;                    // 原"石上 3 + 草上 6"的容量，固定不动
/* 两个 InstancedMesh（全体小鸟各 1 个 draw call；颜色走 instanceColor） */
const smallBirdMesh = (() => {
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
/* 观感放大：真实小鸟体长 0.115m，20m 外只有几个像素。园林是"看整体氛围"的场景，
   放大到 ~2.2 倍（体长约 0.25m，站在石台上仍远小于 1.6m 的点景人物，尺度不违和）。
   ⚠️ 2026-10-02 再放大到 **5.0 倍（体长约 0.58m，像一只大斑鸠）**：3.3 倍那版
   老黄实拍"一只都看不到，只在草地上找到一只"—— 一半是落点被山挡（见 ROCK_SPOTS），
   一半是尺寸：默认机位距假山 ~34m，0.38m 的鸟只有 ~8px；挪到直视可见的西平台后
   默认机位距离缩短 ~2m 仍远，放大到 0.58m ⇒ 默认机位 ~13px、池边（~17m）~24px，
   加上踱步/啄毛动作可以读到"假山上有几只鸟"。0.58m 比点景人物（1.6m）的 1/3 略小，
   尺度仍不破。嫌大一句话回调。 */
const BIRD_SCALE = 5.0;
/* 落脚高度补偿：几何原点在**体心**，直接放在石面高度上 ⇒ 半个身子陷进石头。
   体半高 0.030 × 5.0 = 0.15m，再留一点"站在石上"的观感余量 ⇒ +0.17m。
   （⚠️ 放大倍率改了这里必须跟着改 —— 3.3× 时是 0.08，5.0× 忘改就会陷进石头 7cm。） */
const BIRD_FOOT_LIFT = 0.17;
/* 每只鸟的状态（世界坐标 + 行为相位），随机流独立 */
const birdState = [];
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
  const c = smallBirdMesh.instanceColor;
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
const _bm = new THREE.Matrix4(), _bp = new THREE.Vector3(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3();
/* 每只鸟的行为推进；返回它当前的 (x,y,z,yaw) */
function birdStep(b, dt, t, i){
  if (b.kind === 'rock'){
    /* 石上休息：**四个持续的小动作**（2026-10-01 两轮重做）。
       老黄先说"这些鸟都是不动的"，随后点名要"轻微跳跃、转身、转头啄毛"。
       逐条对应：
         ① **轻微跳跃**  —— 踱步时把落脚点做成小抛物线（不是贴地平移）；
         ② **转身**      —— 换向时整只转 180° 左右（不是只摆头）；
         ③ **转头啄毛**  —— 低头朝身体侧面啄（真实的整理羽毛动作）；
         ④ 常态的呼吸起伏 + 偶尔抖翅（保留上一轮加的，仍然需要）。
       ⚠️ 幅度都刻意小（几厘米 / 十几度）—— 真实小鸟站着时就是小幅动作，
       幅度大了才读成"发了疯"。 */
    b.bobPh += dt * 1.9;
    b.stepPh = (b.stepPh || 0) + dt;
    /* ① 踱步 + 轻微跳跃：每 2.2~4.5 秒换一个目标点（步幅 ≤0.2m），
       走的过程做成小抛物线（峰高 ~5cm）⇒ 读作"轻轻跳了一下"，不是滑行。
       ⚠️ **目标点必须相对"原始落点"bx0/bz0，不能相对当前位置**（2026-10-01 修）：
       第一版 stepTo = b.x + 随机偏移，而 b.x 每帧都朝 stepTo 移动 ⇒ 偏移会**累加**，
       20 秒走出 2m 以上 ⇒ 鸟直接**走出石台、掉进草丛或悬空**
       （实测 gap −2.19 / +1.8 / +2.09，门禁报"越界"）。现在每次都从原始落点重取，
       并硬夹在 ±0.2m 内 ⇒ 鸟在石面上小范围踱步，不会走丢。 */
    if (b.stepPh > (b.stepNext || 1.5) + 2.4){
      b.stepNext = 2.2 + bRnd() * 2.3;
      const a = bRnd() * TAU, r = 0.08 + bRnd() * 0.12;
      const bx = b.bx0 ?? b.x, bz = b.bz0 ?? b.z;
      const tx = bx + Math.cos(a) * r, tz = bz + Math.sin(a) * r;
      const dx = tx - bx, dz = tz - bz;
      const dl = Math.hypot(dx, dz);
      const cap = dl > 0.2 ? 0.2 / dl : 1;            // 硬顶：离原始落点不超过 0.2m
      b.stepTo = { x: bx + dx * cap, z: bz + dz * cap };
      /* ② 转身：换目标点时有 ~45% 概率整只转 180°（不是只摆头）。
         转身与走路**同时**发生才自然，所以记一个转身起点，缓动 0.7 秒。 */
      if (bRnd() < 0.45) b.turnBodyTo = b.yaw + (bRnd() < 0.5 ? Math.PI : -Math.PI);
    }
    /* 跳跃：用一个 0~1 的进度驱动抛物线；走到位后归零 */
    if (b.stepTo){
      const k = 1 - Math.exp(-dt / 0.55);
      b.x += (b.stepTo.x - b.x) * k;
      b.z += (b.stepTo.z - b.z) * k;
      b.hopU = Math.min(1, (b.hopU || 0) + dt / 0.55);
      if (b.x === b.stepTo.x && b.z === b.stepTo.z){ b.stepTo = null; b.hopU = 0; }
    }
    const hopY = (b.hopU || 0) > 0 && (b.hopU || 0) < 1 ? Math.sin(b.hopU * Math.PI) * 0.05 : 0;
    /* ② 身体朝向：转向缓动（0.7s）；没触发转身时朝向不动，只有头部在动（见下） */
    if (b.turnBodyTo !== undefined){
      let d = b.turnBodyTo - b.yaw;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      b.yaw += d * (1 - Math.exp(-dt / 0.7));
      if (Math.abs(d) < 0.05) b.turnBodyTo = undefined;
    }
    /* ③ 转头啄毛：每 1.5~4 秒低头朝身侧啄一下（低头 0.7 秒、啄 2~3 下）。
       低头 = 身体前倾 + 头点动；用 peckAng 传给 updateSmallBirds 去做前倾。 */
    b.peckPh = (b.peckPh || 0) + dt;
    if (b.peckPh > (b.peckNext || 2)){
      b.peckNext = 1.5 + bRnd() * 2.5;
      b.peckPh = 0;
      b.preen = 0.7;                      // 低头持续 0.7 秒
      b.preenSide = bRnd() < 0.5 ? -1 : 1;
    }
    if (b.preen > 0){
      b.preen -= dt;
      /* 啄：0.7 秒里点 3 下头。
         ⚠️ 变量名必须是 b.preen —— 第一版我误写成 b.peen（undefined）：
            `undefined * 13` ⇒ NaN ⇒ yawOff=NaN ⇒ p.yaw=NaN ⇒ 实例矩阵 NaN，
            理羽那一瞬间整只鸟的矩阵坏掉。而门禁只查位移/高度/朝向差值，
            **抓不到 NaN 姿态**（NaN 参与比较恒为 false，判据会静默跳过）。 */
      const beat = Math.abs(Math.sin(b.preen * 13));
      b.yawOff = b.preenSide * (0.55 + beat * 0.35);
    } else {
      /* 常态：偶尔左右看看（小幅转头，不是啄） */
      b.lookPh = (b.lookPh || 0) + dt;
      if (b.lookPh > (b.lookNext || 1.5)){ b.lookNext = 1.5 + bRnd() * 2.5; b.lookPh = 0; }
      b.yawOff = Math.sin(b.lookPh * 1.1) * 0.35;
    }
    /* ④ 抖翅：每 4~9 秒一次，0.5 秒的小张合（幅度 ~0.35rad = 20°） */
    b.flapPh = (b.flapPh || 0) + dt;
    if (b.flapPh > (b.flapNext || 3)){
      b.flapNext = 4 + bRnd() * 5;
      if (b.flapPh > b.flapNext + 0.6){ b.flapNext = 4 + bRnd() * 5; b.flapPh = 0; }
    }
    const fq = Math.min(1, (b.flapPh - (b.flapNext || 3)) / 0.5);
    const flap = fq > 0 ? Math.sin(fq * Math.PI) * 0.35 : 0;
    /* 站姿起伏：±0.018m，相对基准高度 y0 算、不就地累加（防积分漂移） */
    return { x: b.x, y: b.y0 + hopY + Math.sin(b.bobPh) * 0.018, z: b.z,
             yaw: b.yaw + (b.yawOff || 0), flap, preen: b.preen > 0 };
  }
  /* 草上：跳跃捕食循环 —— 跳（小抛物线）→ 停 → 啄 → 换点
     ⚠️ 2026-10-01：旧版这个循环里 **大部分时间在"停+啄"**（实测 3 帧位移 0.3~8.6mm）
        ⇒ 读作静止。现在三处改动让它"一直在动"：
        ① 啄食期缩短：原来停 2~4 秒才跳（停 : 跳 ≈ 10:1）→ 改成 0.35~0.9 秒；
        ② 跳的间隔缩短：周期从 7~14 秒压到 2.5~5.5 秒；
        ③ 停着的时候也在动：啄头的同时身体左右微摆、尾巴点动（不是静止等跳）。 */
  if (!b.from){
    b.from = { x: b.x, z: b.z };
    b.to = { x: b.x + (bRnd() - 0.5) * 1.0, z: b.z + (bRnd() - 0.5) * 1.0 };
    b.hopPh = 0; b.hopDur = 0.28 + bRnd() * 0.10; b.hopNext = 0;
  }
  b.hopPh += dt;
  b.idlePh = (b.idlePh || 0) + dt;
  const u = Math.min(1, b.hopPh / b.hopDur);
  if (u >= 1){
    /* 落点到了：先啄两下，再决定下一个跳点 */
    if (!b.peckAt || b.peckAt <= 0){
      b.x = b.to.x; b.z = b.to.z;
      b.yaw = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
      b.peckAt = 0.35 + bRnd() * 0.55;           // ① 停 0.35~0.9 秒（原 2~4 秒）
      b.from = { x: b.x, z: b.z };
      b.to = { x: b.x + (bRnd() - 0.5) * 1.1, z: b.z + (bRnd() - 0.5) * 1.1 };
      b.hopPh = 0; b.hopDur = 0.28 + bRnd() * 0.10;
    } else {
      b.peckAt -= dt;                            // 啄：低头 + 身体左右微摆
      const sway = Math.sin(b.idlePh * 5.2) * 0.10;   // ③ 停着也在动
      return { x: b.x + sway * 0.02, y: b.y0 + Math.abs(Math.sin(b.peckAt * 16)) * 0.010,
               z: b.z, yaw: b.yaw + sway, peck: true };
    }
  }
  /* 跳跃：水平线性插值 + 竖直抛物线小弧（高 ~0.14m，比原来 0.12 略明显） */
  const x = b.from.x + (b.to.x - b.from.x) * u;
  const z = b.from.z + (b.to.z - b.from.z) * u;
  const hop = Math.sin(u * Math.PI) * 0.14;
  const yaw = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
  return { x, y: b.y0 + hop, z, yaw };
}
export function updateSmallBirds(dt, t){
  for (let i = 0; i < birdState.length; i++){
    const b = birdState[i];
    const p = birdStep(b, dt, t, i);
    _bp.set(p.x, p.y, p.z);
    _bq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    _bs.setScalar(BIRD_SCALE);
    if (p.peck || p.preen){ /* 啄/啄毛：轻微前倾（preen 是石上鸟低头理羽） */
      _bq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5));
    } else if (p.flap){ /* 抖翅（石上休息的鸟偶尔理羽毛）：小翅张开一点 */
      _bq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -p.flap));
    }
    _bm.compose(_bp, _bq, _bs);
    smallBirdMesh.setMatrixAt(i, _bm);
  }
  smallBirdMesh.instanceMatrix.needsUpdate = true;
}


/* ── 停栖蜻蜓（两只）：真实花/叶几何锚点 + 弧线转场 ──
   · 锚点来自 makeAquatic 实例几何的真实三角面（addPerchingAnchor 已缓存顶点），
     落点必须可定位到程序化花/叶，不取空中任意点；
   · 停栖 20~35 秒、飞行 2~4 秒，两只错峰（相位差 ≥ 15 秒，靠独立流预掷保证）；
   · 转场弧线：CatmullRom 三控制点（起飞离花面 → 中段抬高 → 目标上方降落），
     切线朝向，全程翅膀高频率振动、风天同频小幅漂移；
   · 季节/暴雨：与 dragonflyShow 同口径 —— 冬/暴雨/风雪隐藏，好天重新出现；
     荷花/荷叶本身也是季节性的（lotusShow/lilyShow），锚点落在花上时冬季无花可落，
     转场目标选择层就把冬季隐藏一并覆盖（隐藏期间不更新，重新出现从停栖态起）；
   · 风同锚点：与 MAT.lily/MAT.lotus 的 addWind('tip', crownY=0, maxDisp=0.05)
     同一组 WIND uniform、同一条 wExpr 权重曲线（随时间在 JS 侧复算近似值），
     停栖点用 (instanceMatrix × geometry) 得到世界锚点，再加与 shader 相同的
     gust×wt 幅度（≤5cm 硬顶）。它是逐帧 JS 近似，不是 shader 位移本身；
     同 frame 内 JS 与 GLSL 的 hash/三角函数位级可能差 1~2e-3 —— 报告里说明。 */
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
makePerchingDragonfly(0);
makePerchingDragonfly(1);

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
world.add(makeWaterGrass(-13.2, 6.4, 54, 2.6));
world.add(makeWaterGrass(11.5, -3.2, 44, 2.2));

// 荷花（Hyper3D 生成的荷花丛，池面散点）
/* ⚠️ 2026-09-22 晚（老黄 A+C 裁决）：摆放原走全局 rr/rnd，实测**每次刷新 12 株位置/朝向全漂移**
   （_rect-lotus-determinism.mjs：两次会话逐坐标比对全不同）—— 池面"白花苞时有时无"的根因。
   改本地流（固定种子）与加载时序解耦（makePeachTree 同法，§34）。
   ⚠️ 全局流**等量燃烧**：原每轮 rr,rnd,rr,rr 原顺序原参数消耗后弃用——
   全局流是一条有序流，多烧少烧都会让之后的莲蓬/水草/驳岸石/人物整体后移且不报错（§36.6）。 */
const lotusSpots = [];
const LR = mulberry32(20260922);                     // 荷花专用流：种子固定，跨刷新确定
const lrr = (a, b) => a + LR() * (b - a);
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
lotusSpots.forEach(s=>{
  const stemH = GLB_LOTUS_STEM_H * s.s * rr(0.98, 1.03);   // ⚠️ 这 12 次 rr 是全局流的一部分，别动
  const stem = mesh(new THREE.CylinderGeometry(0.018, 0.034, stemH, 12), MAT.lily, { name:'glbLotusStem' });
  stem.position.set(s.x, stemH / 2, s.z);
  world.add(stem);
});
/* 池边荷花丛（LotusPlant.glb）：落点/尺度沿用本地流 lotusSpots（跨刷新确定，
   随机流守恒见上），由 placeAssets 异步挂载。 */
placeAssets('assets/LotusPlant.glb', 2.0, lotusSpots);
world.add(makePondPads(lotusSpots));

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
const MACAW_SPOTS = [
  /* ⚠️⚠️ 第十三轮重排（老黄实拍：'鹦鹉的位置还是不对，我让你放到假山的山顶
     （最高处），不是藏在假山的中间位置'）。
     —— 本轮**推翻了第十二轮"真·峰顶四面被挡（seen=0）"的结论**：那是判据自己的
     假红。旧判据瞄"石面高度 +0.55m"，而峰顶是**尖顶**，掠射角下那条射线正好从
     山顶上方擦过去、打到远处（或打空），于是整片 y 6.1~6.3 的候选一律 seen=0，
     才误判成"站上去看不见"。改成瞄**脚面 +0.15m**、命中距离 |d − dist| ≤ 0.5 之后
     复测（outputs/_diag/macawtop-scan.mjs，东假山 0.4m 粗扫 378 点 + 0.1m 精扫）：
       · 东假山真峰顶 **(9.2, 6.20, 15.7)**，默认机位**直视可见**，
         屏幕像素 (1205, 401)（1400×800 默认画幅）；
       · 旧三点 y 4.05~4.69 在屏幕上是 (1178,449)/(1236,456)/(1244,459) ——
         比峰顶低 40~58px，正好落在山体轮廓**中部** ⇒ 这就是老黄说的"藏在中间"。
     ⚠️ 曾试图用"从池边 1.7m 高的锚点直视"当硬条件，那会再次把落点压到山腰：
     峰顶本来就只对**抬高的视角**（默认机位 y=17）可见，池边平视被自身山体挡住是
     几何必然、不必强求（老黄看的是默认机位，不是站在池边）。
     三只摆成"两只并肩在尖顶 + 一只在右侧岩台"，出图对比见
     outputs/_diag/macawtop/（v0 旧点 / v4 本方案，各带 zoom 放大图）：
       ① (9.2, 6.20, 15.7)  —— 真峰顶（全山东面最高石面，射线实测 y=6.20）；
       ② (9.6, 6.12, 15.7)  —— 尖顶东肩，只低 0.08m，与 ① 并肩读作"守在顶上"；
       ③ (10.0, 5.88, 16.5) —— 右侧岩台，彼此 0.93~1.17m，三只都读得清不糊成一团。
     ⚠️ 2026-10-14 起 ③ **已不在东假山**：三点同山时"换峰飞行"实际只挪 1m、
        用户从来没看出鸟在飞（Chief 定位）⇒ ③ 整体挪去西假山峰顶，见下方该点注释。
     ⚠️ 与石上小鸟（ROCK_SPOTS，z 16.4~16.75、y 3.87~4.68）的间距：三只分别 1.58~1.88m
     （上一轮只有 0.35~0.75m），birds-guard"小鸟脚底贴石面"的上打射线碰不到鹦鹉，
     比上一轮更安全。 */
  [9.2, 6.20, 15.7],
  [9.97, 6.114, 16.17],
  /* ③ 西假山峰顶台地 —— 2026-10-14 从东假山右岩台 (10.0,5.88,16.5) 整体挪来。
     ⚠️⚠️ 挪窝根因：原三点全在东假山、彼此仅 0.93~1.17m，"换峰飞行"实际是 1.4 秒
     挪 1 米，**用户从来没看出鸟在飞**（Chief 定位）。落点拉开到两座真山之间
     （东 ① ↔ 西 ③ 水平距 **14.9m**），飞行才读得出来。
     ⚠️ 高度是探针实测、不是手填：outputs/_diag/macaw-west2-probe.log
     （probe/_tmp-macaw-west2.mjs，西假山心 (−6.5,14.2) 周围 0.2m 网格 121 点，
     逐点全分层命中 + 默认机位可见性 + 东①→各候选弧线净空）。筛选口径：
       ① 顶层层高 3.2~5.6m（地面 ~1.7m 以上、石尖/树冠 6m 以下的"可站"区间）；
       ② 默认机位（1400×800、intro=0）直视可见（锚点→脚面+0.15m 反向射线首中即目标）；
       ③ 东①→该点巡航弧（smoothstep 贝塞尔）全程 0.3m 净空无碰撞（上下各一射线）。
     实测 (-5.7,5.02,15.0)：层 5.02/3.61/1.74、vis=true、弧线碰撞 0；同在零碰撞
     集合里的 (-5.5,5.24,15.0) 等是同一片 5.0~5.24m 台地（四邻 5.01~5.24，取中线点）。
     ⚠️ 山心附近的 4.1~4.4m 候选全部落选：弧线在终点前 0.1m 内擦 6m 级石尖
     （1.1m 体长的鸟会穿模），明细见同日志"碰撞点"列。
     ⚠️ 与石上小鸟（ROCK_SPOTS，东假山 z 16.4~16.75）保持 >15m；西假山没有
     ROCK_SPOTS 小鸟，不会把 birds-guard"脚底贴石面"引红。 */
  [-5.7, 5.02, 15.0],
];
/* ⚠️⚠️ 第十五轮（老黄二次实拍"鹦鹉仍不对"）：落点本身其实已经到位 —— 射线复核
   （outputs/_diag/macaw-final-check.mjs，spring/clear/noon 默认机位）三只脚底
   gap = 0 / −0.004 / 0，① 只低于 1.4m 邻域内的峰顶 0.013m，确实站在最高石面上。
   但 8× 放大图暴露两个**读感**问题（位置对 ≠ 看得出来）：
     ① ② 原为 (9.2,15.7) 与 (9.6,15.7)：只差 0.4m，而且**几乎正对视线方向**
     （机位 (−20,17,32)，视线水平分量 ≈ (0.518,−0.855)）⇒ 屏幕上只差 7px，
     两只糊成一只"双头鹦鹉"。
   ⚠️ 教训：峰顶选点要按**屏幕间距**筛，不能按世界间距 —— 世界 0.4m 里沿视线方向
   的那 0.35m 投到画面上等于 0。
   ⇒ 本轮把 ② 挪到 (9.97, 6.114, 16.17)（沿屏幕 x 方向挪开，石面只低 0.086m），
     与 ① 在屏幕上拉开 27px（1208 → 1235）；③ 不动（**仅指本轮**；2026-10-14 ③ 已因"换峰飞行看不出"挪去西假山顶，见下方该点注释）。
   ⚠️ 峰顶脊约 1.5m 宽、屏幕横向量程只有约 40px，三只不可能拉得很开：试过
   (10.4,16.6)（石面 4.92）与 (10.6,16.2)（石面 5.06）都会掉出"山顶"，不取。 */
/* ══ 金刚鹦鹉的作息与动作（2026-10-05 第十六轮）══════════════════════════
   老黄三条原话：①"鹦鹉无论白天黑夜还是刮风下雨都在假山上不动，这个不合理"
   ②"这个鹦鹉做得太大了，和人物的体积大小比夸张了一些" ③"我还希望能给鹦鹉加一个
   动作…最好不要我帮忙"。

   ⚠️⚠️ 这个 GLB 是**单节点单网格**（实测 nodes:1 / meshes:1 / primitives:1 /
   skins:0 / animations:0）—— 没有骨骼、没有动画轨道 ⇒ 做不出"只有翅膀动"，
   所有动作只能施加在 holder（整只）的位移/旋转上。下面这套是按**远处一眼读得出**
   挑的，不是按"像不像真鸟"挑的。
   ① 作息：白天栖峰顶，**夜与雨雪天不在这里**（鹦鹉是日行性、雨里会进林子躲）。
      判据用**连续的 ENV.hour**（不是离散的 ENV.time）⇒ 拖时辰滑杆时会自然归巢；
      走/回都带"起飞抬升 + 振翅 / 落下来收翅"，不是"啪一下隐藏"。
   ② 动作：呼吸起伏 / 缓慢张望 / 急张望 / 甩尾 / 抖翅 / 理羽 / 小跳换向。
   ⚠️ 事件用逐鸟**确定性**伪随机 h01()，不消耗 rnd/rr ⇒ layout-fingerprint 不受影响、
      探针可复现（运行时动效本来允许 Math.random，能用确定性就不用随机）。 */
const MACAWS = [];
const MACAW_LIFT = 2.4;                       // 起飞/落下时抬升的高度（m）
const MACAW_CRUISE = 1.6;                     // 换点巡航弧顶额外高度（m）
const MACAW_TAKEOFF = 0.35, MACAW_LANDING = 0.55; // 内部飞行 起/落时长（秒）
const MACAW_FLY_DUR = 1.4;                    // 内部飞行巡航时长（秒）
const MACAW_DEPART = 0.55, MACAW_ARRIVE = 0.75;
/* ⚠️ flutter 时长 0.42→0.55：与下面"整段只走 2 个周期"配套 —— 2/0.55 = 3.6Hz，
   60fps 下每帧相位 0.38rad、30fps 下 0.76rad，都在"看得出来是扇动"的采样率上。 */
const MACAW_EV = { tail:0.38, flutter:0.55, preen:1.15, hop:0.52 };
/* 确定性伪随机 ∈ [0,1)：与全局随机流无关 */
function h01(a, b){
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
/* 该不该栖在峰顶：白天 + 没在下雨下雪。导出是为了让门禁能直接断言"什么时候该在"。 */
export function macawWantPerch(){
  /* 6.5~18.2 时：晨 7.5 已经在、暮 17.5 还在、夜 21.5 已归林；日出前/日落后不在。 */
  if (!(ENV.hour >= 6.5 && ENV.hour <= 18.2)) return false;
  const w = ENV.weather, rain = (ENV.cur && ENV.cur.rainAmount) || 0;
  if (w === 'snow' || w === 'storm' || w === 'thunder') return false;
  return rain < 0.08;
}
/* 每帧推进：起飞/落地/栖停三态 + 栖停小动作。由 11-loop 调用（那里已经有 dt/t）。 */
export function updateMacaws(dt, t){
  if (!MACAWS.length) return;
  const want = macawWantPerch();
  for (const m of MACAWS){
    const h = m.holder;
    if (m.mode === 'perch' && !want){ m.mode = 'depart'; m.mt = 0; }
    else if (m.mode === 'away' && want){ m.mode = 'arrive'; m.mt = 0; }
    m.mt += dt;

    /* ── 内部换点飞行：白天在 MACAW_SPOTS 各峰顶间弧线移动 ──
       ⚠️⚠️ 2026-10-14 运动学校对（macaw-guard：roll/pitch ≤8、yaw ≤22 rad/s，按仿真时钟
       计量、与帧率无关）。三处不变量，改前必读：
       ① 航向取**最短角**（见触发处 flyYaw）：东↔西原始 atan2 差可达 7.2rad，直接混
          会让起飞段 yaw ≈41 rad/s；
       ② 振翅相位用全程累积 flightT，**不随 mt 复位**：mt 每换态归零，sin(mt*26) 会从
          sin(36.4)=−0.96 跳回 0，单帧 Δroll≈0.17rad≈10.3 rad/s（撞 roll≤8）；
       ③ 俯仰沿**路径解析斜率**连续：起降段端点 = 巡航贝塞尔在 v=0/1 的斜率，换态处
          严格相等（老写法 takeoff 收尾 −0.34、巡航起步 +0.24，单帧跳 0.58rad≈34）。
       ④ 弧顶高 flyYMid 在 trigger 处**算一次存字段**、三分支共用：距离缩放
          （dist/8 钳 0.2~1）。同源是闭合性的构造保证 —— 各分支各算一遍正是
          41.7 rad/s 那类"两处公式抄不一致"bug 的成因。
       ⚠️ 飞行时长常数 MACAW_TAKEOFF/FLY_DUR/LANDING（0.35/1.4/0.55）不许动 ——
          上面三处连续性全靠这组时长闭合。**节拍阈值不在此列**：它在下方 trigger 处，
          2026-10-14 由"8~22s/次"改为"首飞 10/14/18s、之后 60~120s/次"（改因：
          旧节拍下 40s 窗末必然有鸟在天上，macaw-guard ① 连挂）。
       ⚠️⚠️ 改节拍必须重跑 macaw-guard **两遍**且两遍都得绿 —— ① 是节拍稳定性判据，
           单遍绿可能是运气（旧节拍下线前实测两遍全挂在①）。 */
    if (m.mode === 'takeoff'){
      m.flightT += dt;
      const u = Math.min(1, m.mt / MACAW_TAKEOFF);
      const lift = u * u;                               // 加速上升
      const h0 = m.flyFrom.y + MACAW_LIFT;
      const yMid = m.flyYMid;                       // 与 cruise/land 同源（闭合性靠它）
      const pitchUp = Math.atan2(2 * (yMid - h0), Math.max(m.flyDist, 0.001)); // 巡航起步斜率
      h.position.set(m.flyFrom.x, m.flyFrom.y + lift * MACAW_LIFT, m.flyFrom.z);
      /* 俯仰用 smoothstep 斜坡（不是 u²：u² 末端速率 2/0.35，短距腾跃时 pitchUp≈1.3rad
         ⇒ 7.4 rad/s 贴线；smoothstep 末端速率 1.5/0.35 ⇒ ≤5.6，留余量） */
      h.rotation.set(pitchUp * (u * u * (3 - 2 * u)) + 0.08 * Math.sin(m.flightT * 26 + 1.1) * lift,
                     m.yaw + (m.flyYaw - m.yaw) * lift,
                     Math.sin(m.flightT * 26) * 0.18 * lift);
      if (u >= 1){ m.mode = 'cruise'; m.mt = 0; }
      continue;
    }
    if (m.mode === 'cruise'){
      m.flightT += dt;
      const u = Math.min(1, m.mt / MACAW_FLY_DUR);
      const v = u * u * (3 - 2 * u);                    // smoothstep：起降缓、中段匀速（读作巡航）
      const p0 = m.flyFrom, p3 = m.flyTo;
      const h0 = p0.y + MACAW_LIFT;
      const h3 = p3.y + MACAW_LIFT * 0.6;
      const x = p0.x + (p3.x - p0.x) * v;
      const z = p0.z + (p3.z - p0.z) * v;
      const yMid = m.flyYMid;                       // 与 takeoff/land 同源（闭合性靠它）
      const y = (1 - v) * (1 - v) * h0 + 2 * (1 - v) * v * yMid + v * v * h3;
      h.position.set(x, y, z);
      /* 俯仰 = 贝塞尔解析斜率：端点与起降段闭合，且不会像差分那样在 u→1 退化成 0 跳变 */
      const dydv = -2 * (1 - v) * h0 + 2 * (1 - 2 * v) * yMid + 2 * v * h3;
      h.rotation.set(Math.atan2(dydv, Math.max(m.flyDist, 0.001)) + 0.08 * Math.sin(m.flightT * 26 + 1.1),
                     m.flyYaw,
                     Math.sin(m.flightT * 26) * 0.18);
      if (u >= 1){ m.mode = 'land'; m.mt = 0; }
      continue;
    }
    if (m.mode === 'land'){
      m.flightT += dt;
      const u = Math.min(1, m.mt / MACAW_LANDING);
      const lift = 1 - (u * u);                         // 减速下降
      const h3 = m.flyTo.y + MACAW_LIFT * 0.6;
      const yMid = m.flyYMid;                       // 与 takeoff/cruise 同源（闭合性靠它）
      const pitchDn = Math.atan2(2 * (h3 - yMid), Math.max(m.flyDist, 0.001)); // 巡航收尾斜率（负）
      h.position.set(m.flyTo.x, m.flyTo.y + lift * MACAW_LIFT * 0.6, m.flyTo.z);
      const blend = 1 - lift;                           // 0→1：航向回正到 yaw0
      /* 俯仰从巡航收尾斜率 pitchDn 缓回 0（不是反向！第一版写成 0→pitchDn，
         落地一瞬从 pitchDn 跳回 0，实测 pitch 角速度 41.7 rad/s，撞 roll/pitch≤8）。
         ⚠️ 收尾必须随 lift（=1−u²）而不是 smoothstep：smoothstep 在 u=1 的导数
         还有 0，但第一版收在 u=1 的值恰是 pitchDn≠0，接栖停 rest 的 pitch=0
         会再跳一次（实测 9.4 rad/s）。与 roll/wobble 同用 lift ⇒ u=1 三项全为 0，
         与栖停的静止基准逐项相等，落地无跳。 */
      h.rotation.set(pitchDn * lift + 0.08 * Math.sin(m.flightT * 26 + 1.1) * lift * lift,
                     m.flyYaw + (m.yaw0 - m.flyYaw) * blend,
                     Math.sin(m.flightT * 26) * 0.18 * lift);
      if (u >= 1){
        m.base.copy(m.flyTo); m.mt = 0;
        if (!want){ m.mode = 'depart'; }   // 飞行期间天气突变：落到目的地再走，不从半空瞬移
        else {
          m.mode = 'perch'; m.ev = 'rest'; m.c++;
          m.evT = 1.2 + h01(m.i * 7 + 3, m.c) * 2.6;
          m.yaw = m.yawT = m.yaw0;
        }
      }
      continue;
    }

    if (m.mode === 'depart' || m.mode === 'arrive'){
      const dur = m.mode === 'depart' ? MACAW_DEPART : MACAW_ARRIVE;
      const u = Math.min(1, m.mt / dur);
      const e = u * u;                                   // 起飞加速 / 落地是同一条曲线的反向
      const lift = m.mode === 'depart' ? e : 1 - e;
      h.visible = true;
      h.position.set(m.base.x, m.base.y + lift * MACAW_LIFT, m.base.z);
      /* 振翅：绕自机纵轴高频滚转 + 抬头；越在空中越平（俯仰按 lift 给） */
      /* ⚠️ 振翅频率 42→26 rad/s（6.7→4.1Hz，与"抽搐"那条同源）：42 在 30fps 下每帧
         1.4rad、已经走出可采样范围；4.1Hz 才是金刚刚鹦鹉那种**慢而深**的扇翅节奏。 */
      h.rotation.set(-0.34 * lift + 0.12 * Math.sin(m.mt * 26 + 1.1),
                     m.yaw0 + Math.sin(m.mt * 0.7 + m.phase) * 0.12,
                     Math.sin(m.mt * 26) * (0.26 + 0.34 * lift));
      if (u >= 1){
        if (m.mode === 'depart'){ m.mode = 'away'; h.visible = false; }
        else {
          m.mode = 'perch'; m.ev = 'rest'; m.c++;
          m.evT = 1.2 + h01(m.i * 7 + 3, m.c) * 2.6;
          m.yaw = m.yawT = m.yaw0;
        }
      }
      continue;
    }
    if (m.mode === 'away'){ h.visible = false; continue; }

    /* ── 栖停：事件驱动（含内部换点起飞） ── */
    h.visible = true;
    /* 白天偶尔换峰：落点只在 MACAW_SPOTS 内跳，弧线往返。
       ⚠️ 只在 ev==='rest'（静止小动作，pitch/roll 基准都是 0）时触发 —— 若从 flutter/
       preen 的半空中接飞行，起手一帧就要补上人家 0.24rad 的滚转 ⇒ Δroll≈14 rad/s，
          直接撞 macaw-guard 的 roll≤8。等当前小动作做完再走，肉眼无差别。 */
    if (want && m.ev === 'rest'){
      m.perchT = (m.perchT || 0) + dt;
      /* 节拍（2026-10-14，Chief 派单）：首飞早、之后稀。
         · 首飞阈值按鸟错开 10/14/18s —— 观众一进园就马上看得到真飞，且 40s
           门禁窗内一定有飞行帧可量飞行姿态安全性（② 才有的可测）；
         · 之后转 60~120s 一次（真鹦鹉久栖偶飞）⇒ 40s 窗末有 25s+ 全员栖停
           余量，macaw-guard ①「窗末 3 只全 perch」才立得住。
         ⚠️ 为什么必须"首飞早+之后稀"：日常 8~22s 一飞时，任意时刻约 35% 概率
           有鸟在天上（单鸟在飞占比 2.3/(8~22+2.3)≈12~22%×3 只），40s 窗末
           撞上是常态 —— 门禁 run1/run2 连挂 ①（perch/cruise/takeoff）就是这个。
         ⚠️ 阈值全走确定性 h01（与全局随机流无关、探针可复现）；m.c 计数逻辑
           与飞行时长常数 0.35/1.4/0.55 都不动。*/
      const thr = m.flown ? 60 + h01(m.i * 3 + 1, m.c) * 60 : 10 + m.i * 4;
      if (m.perchT > thr){
        m.perchT = 0;
        const others = MACAW_SPOTS.filter(s => Math.abs(s[0] - m.base.x) > 0.01 || Math.abs(s[2] - m.base.z) > 0.01);
        if (others.length){
          const t = others[Math.floor(h01(m.i * 3 + 2, m.c) * others.length)];
          m.flyFrom = new THREE.Vector3(m.base.x, m.base.y, m.base.z);
          m.flyTo = new THREE.Vector3(t[0], t[1], t[2]);
          m.flyDist = Math.hypot(m.flyTo.x - m.flyFrom.x, m.flyTo.z - m.flyFrom.z);
          /* 弧顶高：基础 1.6m，按距离缩（短跳配小弧）。算一次存字段，三个飞行分支
             共用同一个 yMid —— 端点闭合靠"同源"保证，不靠各分支重复算对。
             ⚠️ 为什么必须缩放：①② 是同峰并肩两点、相距仅 0.9m。恒 1.6m 弧高时，
             0.9m 水平距配 1.6m 落差 ⇒ 弧顶俯仰扫过率 ≈9.9 rad/s（离线逐帧仿真
             1/60 实测 8.61，上门禁因真实 dts 更细还要高约 1），撞 macaw-guard 的
             pitch≤8；且 0.9m 挪 1.6m 弧视觉上像气球，不像鸟。
             跨山（≈15m）时 dist/8>1 钳到 1 ⇒ 弧高仍是满值 1.6m，长飞行动轴不变。 */
          m.flyYMid = Math.max(m.flyFrom.y + MACAW_LIFT, m.flyTo.y + MACAW_LIFT * 0.6)
                      + MACAW_CRUISE * Math.min(1, Math.max(0.2, m.flyDist / 8));
          /* 航向取最短角：atan2(sin(dy),cos(dy)) 把差值折回 [-π,π]。
             东→西原始差 ≈−7.2rad（绕整圈 413°、峰值 yaw 角速度 ≈41 rad/s
             超 macaw-guard 22；且鸟会在空中多转一圈才对准航向）。 */
          const dYaw = Math.atan2(m.flyTo.x - m.flyFrom.x, m.flyTo.z - m.flyFrom.z) - m.yaw;
          m.flyYaw = m.yaw + Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
          m.flightT = 0;
          m.flown = 1;                                    // 首飞之后转"稀"节拍（见上）
          m.mode = 'takeoff'; m.mt = 0;
          continue;
        }
      }
    }
    m.evT -= dt;
    if (m.evT <= 0){
      const r = h01(m.i * 7 + 3, m.c * 5 + 1);
      m.ev = r < 0.44 ? 'rest' : r < 0.62 ? 'look' : r < 0.74 ? 'tail'
           : r < 0.87 ? 'flutter' : r < 0.95 ? 'preen' : 'hop';
      m.c++;
      const g = (k) => h01(m.i * 7 + 3, m.c * 11 + k);
      if (m.ev === 'rest'){ m.evT = 2.4 + g(1) * 3.6; m.yawT = m.yaw0 + (g(2) - 0.5) * 0.9; }
      else if (m.ev === 'look'){ m.evT = 0.5 + g(1) * 0.5; m.yawT = m.yaw0 + (g(2) - 0.5) * 1.6; }
      else if (m.ev === 'preen'){ m.evT = MACAW_EV.preen; m.yawT = m.yaw0 + (g(2) - 0.5) * 0.5; }
      else if (m.ev === 'tail'){ m.evT = MACAW_EV.tail; }
      else if (m.ev === 'flutter'){ m.evT = MACAW_EV.flutter; }
      else { m.evT = MACAW_EV.hop; m.yawT = m.yaw + (g(1) > 0.5 ? 1 : -1) * (1.2 + g(2) * 0.9); }
    }
    /* 偏航缓动（张望/转身共用）：急张望与小跳用更短的时间常数 —— 才是"急" */
    let dy = m.yawT - m.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    /* 转角时间常数：急张望 0.10（"急"是它的本意）/ 小跳换向 0.15（原与 look 共用 0.10，
       实测单帧 Δyaw 到 0.78rad≈45°，转身像被抽了一鞭）/ 其余 0.34。 */
    m.yaw += dy * (1 - Math.exp(-dt / (m.ev === 'look' ? 0.10 : m.ev === 'hop' ? 0.15 : 0.34)));

    let y = m.base.y + 0.010 * Math.sin(t * 2.2 + m.phase), pitch = 0, roll = 0;
    if (m.ev === 'flutter'){
      /* ⚠️⚠️ 2026-10-05 修"抽搐"（老黄："鹦鹉的动作改得再自然一些，现在有时候会看到
         鹦鹉像抽搐了几下"）：原式 `roll = sin(u*34)*0.42` —— u 每帧走 dt/0.42，
         60fps 下**每帧相位 +1.35rad**、本机 24fps 下 **+3.4rad**，远超采样极限 ⇒
         采出来的序列是**随机的乱抖**，读作"抽搐"而不是"抖翅"。
         实测逐帧录（outputs/_diag/macaw-twitch.mjs，45s/1025 帧）：flutter 的单帧
         Δroll 高达 **0.80rad**，而 rest / look / preen / tail 全在 0.05 以下 —— 差 16 倍，
         元凶唯一。
         修法＝把"频率"当成**帧率可承载的量**来定：整段只走 **2 个周期**
         （0.55s ⇒ 3.6Hz；60fps 每帧 0.38rad、30fps 0.76rad，都是"看得出在扇"的采样率），
         幅度同时收一半（0.42→0.24rad ≈ ±14°）。金刚刚鹦鹉本来就是**慢而深**的扇翅
         （真鸟 3~4Hz），慢下来反而更像鸟。 */
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.flutter, env = Math.sin(Math.PI * u);
      const ph = u * Math.PI * 4;                        // 整段 2 个周期
      roll = Math.sin(ph) * 0.24 * env;
      pitch = -0.06 * env + Math.sin(ph + 0.7) * 0.05 * env;
      y += 0.030 * env;                                  // 抖翅时轻轻离枝
    } else if (m.ev === 'preen'){
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.preen, env = Math.sin(Math.PI * u);
      pitch = 0.62 * env; y -= 0.018 * env; roll = 0.10 * env * Math.sin(u * 9.0);
    } else if (m.ev === 'tail'){
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.tail;
      pitch = -0.22 * Math.sin(Math.PI * u);
    } else if (m.ev === 'hop'){
      const u = 1 - Math.max(0, m.evT) / MACAW_EV.hop;
      y += 0.055 * Math.sin(Math.PI * u);
      pitch = -0.12 * Math.sin(Math.PI * u);
    }
    h.position.set(m.base.x, y, m.base.z);
    h.rotation.set(pitch, m.yaw, roll);
  }
}
/* 显式暴露给门禁（按项目规矩：可判定的量不靠 traverse 猜）。 */
export function macawState(){
  return MACAWS.map((m) => ({
    mode: m.mode, visible: m.holder.visible, ev: m.ev,
    yaw: +m.holder.rotation.y.toFixed(3),
    pitch: +m.holder.rotation.x.toFixed(3),
    roll: +m.holder.rotation.z.toFixed(3),
    lift: +(m.holder.position.y - m.base.y).toFixed(3),
    at: [+m.base.x.toFixed(2), +m.base.y.toFixed(2), +m.base.z.toFixed(2)],
  }));
}

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

loadAssetOnce('assets/Macaw.glb', 0.50, (src) => {
  for (const s of MACAW_SPOTS){
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
    holder.position.set(s[0], s[1], s[2]);
    /* ⚠️ 第十五轮：2.4 时三只**背对默认机位**（8× 放大图里只看到后背，读不出"鹦鹉"）。
       改 2.4+π≈5.54 后正对机位，红头/白脸/绿蓝翅都读得出来 —— 对照
       outputs/_diag/macawspread/zoom-C_spread_face.png 与 zoom8-birds.png。
       ⚠️ 生成 GLB 的正面朝向未知，这个偏移是**出图标定**出来的，不是推导出来的。 */
    holder.rotation.y = 5.54;
    const c = src.clone(true);
    c.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      if (m && m.metalness !== undefined){ m.metalness = 0.25; m.roughness = 0.65; m.needsUpdate = true; }
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
/* ── 石灯笼（2026-10-14 · DIY L0 首件 · 纯接线）──────────────────────────────
   GLB：assets/stone-lantern.glb（research/diy-lantern 自制，186KB / 1000 面 / 高 1.05m）。
   摆位：research/diy-first-target.md §4 **实算主位**——(4.0, −3.8) 北岸，地面 y 走
   `groundHeight(x,z)` 助手（**不手写 y**；那份实测值 0.053）。选它的实测依据：
   距岸线 1.62m（岸石带半径 ≤0.75m ⇒ 净隙 0.65m 不相撞）· 最近既有物 corridor 8.8m ·
   离两个南岸导览机位均 ≥4.5m ⇒ 桥机位与 koi 机位均入画。**别自己另找点**（那份量过）。
   朝向：火袋四面开窗 ⇒ 朝向无所谓，取 ry=0 保持模型自身朝向（确定性，不吃随机）。
   ⚠️ 火袋 `lantern_glow` 的 emissive([1,0.74,0.34]) 是**模型自带**，本接线不改材质、
      也**不新增真光源** —— 与 06c-organs 既有挂灯同一条口径（场内真光源仍只有那 5 盏）。
   归一化：走 loadAssetOnce 模板（最大维 = 1.05 = 原高 ⇒ 缩放 1.0，实际不放大不改形）。
   备位 (18.1, 5.2) 亭东先不摆（依据里写明：先做主位，效果确认再摆）。 */
loadAssetOnce('assets/stone-lantern.glb', 1.05, (srcL)=>{
  const holder = new THREE.Group();
  holder.name = 'stoneLantern';
  const lx = 4.0, lz = -3.8;
  holder.position.set(lx, groundHeight(lx, lz), lz);
  holder.add(srcL);
  holder.traverse(o=>{ if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  world.add(holder);
  console.log('[石灯笼] 落位 (' + lx.toFixed(1) + ', ' + lz.toFixed(1) + ') y='
              + groundHeight(lx, lz).toFixed(3) + ' · 高 1.05m · 1000 面');
});
// 乌龟：池中缓游
export const swimTurtles = [];
/* ── 预抽（2026-09-23 · T0）：同 makeKoiGroup 的理由 —— 这 4×2 次 rr() 不能留在异步回调里。
   泳龟在 `loadAssetOnce` 的 onLoad 里抽流，等于让"Turtle.glb 何时加载完"决定全局流的位置，
   而柳/竹/立峰是延迟批（首帧后才跑）⇒ 其后所有抽样整体漂移、不报错。
   顺序与原回调逐条一致：t → speed → jitter → phase。 */
const SWIM_TURTLE_DRAW = [];
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
/* 柳（P1-4 延迟装配）：七件套叶幕的实例化 + 骨架 Tube 是组装段最贵的几块之一，
   柳又都在墙根/水际，首帧远处看只是"绿团"，晚半秒入画无感。
   willowOrigins（随机风源登记）仍在这里同步做 —— updateWind 首帧就要读它。 */
[[-16.8, 1.5, 1.0], [-14.6, 13.6, 0.9], [2.2, 16.4, 1.05], [19.4, 12.0, 0.85]]
  .forEach(([x, z, s])=>{
    willowOrigins.push(new THREE.Vector3(x, 0, z));   // 登记为随机风源（同步）
    deferBoot('柳@' + x, () => deferRoot.add(makeWillow(x, z, s)));
  });

// 桃花（2026-09-21）：两株，紧邻柳树作"桃红柳绿"对景 —— 一株西岸、一株北岸。
// 四季生命周期（花/果/落花/叶）由 12-env 的季节显隐通道控制，此处只需落地。
/* ⚠️ 第四项 = baseY（地表基准，2026-09-23 · 老黄第三轮指认）：实测南岸那株树脚四周被
   太湖石串 + 埋脚鼓包围成一只"碗"（可见表面 y = 0.40~1.03），而树基固定在 0 ⇒ 主干下半截
   连同分叉点整个埋进去，露出来的只有主枝中上段 —— 远看"枝从石缝/草皮里冒出来"，
   读作灌木而不是"一干多枝"。抬到 0.45 让主干露出来（主干已同步向下加长，见 makePeachTree）。
   西岸那株脚下平坦，保持 0。 */
[[-19.8, 4.2, 1.05, 0], [6.2, 15.4, 0.92, 0.45]]
  .forEach(([x, z, s, by])=> deferBoot('桃@' + x, () => deferRoot.add(makePeachTree(x, z, s, by))));

// 梅（2026-10-06 · 老黄："院内布景也讲究梅兰竹菊…加两株梅花，一株腊梅一株红梅，
// 给冬天增加一点色彩，特别是'银装素裹'下"）。
/* ⚠️ 初版落点（红梅 (16,-6) / 腊梅 (-20,14)，由 outputs/_diag/plum-spots.mjs 选的）已在
   2026-10-06 二轮**作废并挪走**（老黄要求墙角位）—— 见下面那一块，别改回来。 */
/* ⚠️ 2026-10-06 二轮挪位（老黄："腊梅的位置更靠西南墙角一些，红梅的位置靠东北墙角"）：
   落点用 outputs/_diag/spots2.mjs 在墙角一带实测挑的（都不在池内、四角高差最小）：
     · 腊梅 (-23.5, 17)：地表 -0.375、±0.7m 高差 **0.007**，西南墙角（离西墙 6.5m、南墙 5.5m）；
     · 红梅 (22.5, -16.5)：地表 -0.717、四角高差 **0.042**，东北墙角（离东墙 7.5m、北墙 6m）。
   ⚠️ 旧落点（红梅 (16,-6) / 腊梅 (-20,14)）作废，别改回去。
   baseY 一律按实测地表给 —— 腊梅上一次"主干悬空"就出在 baseY 与地表没对齐。 */
[[22.5, -16.5, 1.12, -0.717, 'red'], [-23.5, 17, 1.06, -0.375, 'yellow']]
  .forEach(([x, z, s, by, kind]) => deferBoot('梅二@' + x + ',' + z,
    () => deferRoot.add(makePlumTree(x, z, s, by, kind))));

// 廊下盆栽兰（2026-10-06 · 老黄："在廊下补一小丛兰草（或盆栽兰）"）—— 凑齐"梅兰竹菊"。
/* 落点用 outputs/_diag/spots2.mjs 实测：廊内 (14.2, 9.0) 地表 **0.62**、±0.7m 四角高差 **0**
   （命中 mergedStatic = 游廊台基/铺装，不是地形）⇒ baseY 直接给 0.62，盆就稳稳坐在廊下。
   ⚠️ 别改成 groundHeight(x,z)：廊下是台基，地形高度在它下面 0.6m 以外，盆会陷进去。 */
[[14.2, 9.0, 0.62], [14.2, 5.2, 0.62]]
  .forEach(([x, z, by]) => deferBoot('兰@' + x + ',' + z,
    () => deferRoot.add(makeOrchidPot(x, z, by))));

/* ══ 马厩（2026-10-09 建 · 2026-10-10 按老黄四条改）════════════════════════════════
   老黄 2026-10-10："① 马厩的位置移到院子围墙的右侧去 ② 扩大外部草皮的面积，让马厩建在草皮上
   ③ 一辆马车上还有两匹马拉着（准备出发）；另外一辆马匹卸下马鞍、马在休息和吃草，马夫喂草或
   梳理毛皮 ④ 马厩 4 个关马的槽位只有两匹马，空两个槽位"。
   ⇒ 落点改 **东侧院外 (40, −2)、院身朝西**（"从默认机位朝北看，右侧 = 东"）：
     东侧足迹高差 0.275~0.36 比南侧 0.383 更平（outputs/_diag/stable-east.mjs 实测），
     5 个取样点向下射线只命中 ground。配套：**地面已东扩**到 x=±52（见 07-ground 的注释）。
   ⇒ "建在草皮上"：15-stable 去掉了整院抬高的石台基，只在厩身下垫一块低石明，
     院里的马/车/栅栏逐个按**自己脚下的实测地形**落位（`gy()`）。
   ⇒ 编成：**套着两匹待发的车**（车头朝院门）+ **卸了马的停车**（车辕抬起、支辕棍撑着）+
     院中两匹休息吃草（一匹低头吃、一匹由马夫递草料）+ **厩内只占 2 个槽位**（另 2 个空着放干草）。
   落点高度不再由这里给（旧版传 baseY）：场地跟着草坡走，马夫的落脚高度由马厩算出来回填。 */
deferBootFirst('马厩', () => {
  /* ⚠️ 2026-10-10 二批（老黄："整个马厩的方向逆时针旋转 90 度"）：yaw π/2 → **π**。
     转后**院门朝南**（世界 +z），正对园子南门（月洞门 x=0 / 南墙 z=22.5 的西南方向）
     ⇒ 院外那条石板路（makeStableRoad）顺理成章地接到南门。
     旋转后占地核对：厩身+院场 = 局部 x∈[−8,8] × z∈[−4.9,4.9] ⇒ 世界 x∈[32,48]、
     z∈[−6.9,2.7]；东墙在 x=30（墙面到 30.6）⇒ 尚余 1.4m；地面东扩到 x=±52 ✓ 都在界内。 */
  const st = makeStable(40, -2, { yaw: Math.PI });     // 院身朝南（对着园子南门那侧）
  deferRoot.add(st);
  /* 马夫站位：由马厩按"递给低头那匹马"算出来（`userData.stable.groom`）——
     人物是 D_SCHEDULES 在**模块求值期**就建好的，比这个延迟批早，所以这里只做**回填**。
     ⚠️ 改 position 必须同时改 `userData.baseY`：11-loop 的非散步分支每帧用 baseY 写 position.y，
        只挪位置不挪 baseY 会被当场抹掉（"改一处被另一处每帧覆盖"的老坑）。
     ⚠️ 朝向：人物 yaw=0 面朝 +z（局部）；院身整体转了 π/2 ⇒ 他的世界朝向 = π/2。 */
  const gp = st.userData.stable.groom;
  const groom = figures.find(f => f.userData && f.userData.isGroom);
  if (groom){
    groom.position.set(gp.x, gp.y, gp.z);
    groom.userData.baseY = gp.y;
    /* ⚠️ 朝向从厩身取（别硬写）：人物 yaw=0 面朝 +z（局部），厩身转了 yaw ⇒ 他的世界朝向
       就是 yaw。原来硬写 π/2，改朝向之后会跟厩身拧 90°（背书站的方向都不对）。 */
    groom.rotation.y = gp.yaw !== undefined ? gp.yaw : Math.PI / 2;
  }
  /* 院外石板路（上下马处 → 园子南门）：跟着地形走的带子，起点接院门、终点接月洞门
     外侧的门槛石（见 15-stable 的 makeStableRoad 注释）。 */
  deferRoot.add(makeStableRoad());
  /* 真马模型（异步）：加载成功就把 6 个槽位里的**程序化替身**换成真马并逐匹上色；
     失败/离线时什么都不做 —— 替身照常站在那儿（马厩不会空）。
     ⚠️ 放在马厩建好之后调用：它按 `userData.horseSlots` 找槽位。 */
  loadStableHorses(st);
});

// 青竹丛（沿墙根密植，四角加倍）—— P1-4 延迟装配（竹竿几何 + 叶实例，量最大）
// 北排只保留主堂檐口以外的位置，并整体退到 z=-20 以内，避免竹叶穿出围墙内壁（22.2）
[[-25.5, -20.0, 22], [-21.0, -20.0, 18], [-17.0, -20.1, 24], [-14.5, -20.0, 20],
 [14.5, -20.0, 20], [17.0, -20.1, 24], [21.0, -20.0, 18], [25.5, -20.0, 22],
 [-26.2, -6.0, 20], [-26.0, 3.5, 22], [-26.2, 12.0, 18], [-25.8, 19.0, 20],
 [26.0, -8.0, 18], [26.2, 19.5, 20],
 [-27.0, -20.0, 26], [27.0, -20.0, 26], [-27.0, 20.0, 26], [27.0, 20.0, 26]]
  .forEach(([x, z, n])=> deferBoot('竹@' + x + ',' + z, () => deferRoot.add(makeBamboo(x, z, n))));

/* ══ 特置立峰 · 池南岸水际的太湖石（样稿）══
   与峰群的分工：假山群是「掇山」（成组的山体，挡南墙、作对景），
   这里是「特置」（单块立峰，瘦漏透，贴着水面，配石根草叶）——
   参考的是水墨立石的构图：一石、一水、一倒影、几丛草。
   位置不写死坐标，而是由池岸半径表反推（POND_RADII 是角向 160 格的岸线半径）：
   取 0.95 倍 → 距岸约 1.3m 的浅水区；池形将来微调，石头也不会跑到岸上或池心。
   ⚠️ 入土深度必须按 makePondBed 的碗形公式反算：这个半径上池底已经 -0.9m 深，
   照原来"沉 0.5m"会**浮在水里**。 */
/* P1-4：HERO_POS 同步算出（几个乘加而已）—— VIEWPOINTS 初始化与 __garden 探针
   都要读它；真正贵的 SDF 几何延迟到首帧之后（deferBoot）。 */
export let HERO_POS = null;
{
  const ang0 = Math.PI * 0.67;
  const ki0  = Math.round((ang0 / TAU) * POND_RADII.length) % POND_RADII.length;
  const rw0  = POND_RADII[ki0] * 0.95;
  HERO_POS = new THREE.Vector3(Math.cos(ang0) * rw0, 0, Math.sin(ang0) * rw0);
}
deferBootFirst('立峰·云根', function heroStones(){
  try {
    const ang = Math.PI * 0.67;                 // 池南偏西：与远香堂隔水对望、西假山作背景
    const ki  = Math.round((ang / TAU) * POND_RADII.length) % POND_RADII.length;
    const shoreR = POND_RADII[ki] / 0.92;       // POND_RADII 已是岸线的 0.92 倍
    const bedAt = (px, pz)=>{
      const u = Math.min(0.99, Math.hypot(px, pz) / shoreR);
      return -(0.34 + (1.45 - 0.34) * Math.sqrt(Math.max(0, 1 - u * u)));   // 同 makePondBed
    };
    const rw = POND_RADII[ki] * 0.95;
    const hx = Math.cos(ang) * rw, hz = Math.sin(ang) * rw;
    const sink = Math.abs(bedAt(hx, hz)) + 0.30;   // 埋进池底 30cm
    const t0 = performance.now();
    /* ── 石矶（底座）──
       名石的价值有一半在"被安置"。原来它从水里直接长出来，看着像插进去的；
       垫一层低平的岩石让它"坐"住。高度按池底反算：底要埋进淤泥，顶要露出水面 30~40cm。 */
    const shelf = mesh(makeTaihuHeroGeo({
      height: 0.34 + sink * 0.62, baseR: 1.55, seed: 77, sink: sink * 0.62 + 0.10,
      holeCount: 1, eyeRatio: 0, cell: 0.11, fine: false, furrowMul: 0.55,
      main: [0.78, 0.62], sec: [0.62, 0.44], bump: [0.34, 0.22],
      lean: [0.10, 0.28], biteN: 2, biteR: [0.45, 0.70], biteD: [1.15, 1.55],
    }), MAT.taihuHero, { name:'taihuShelf' });
    shelf.position.set(hx, 0, hz);
    shelf.rotation.y = 0.62 + 0.9;
    /* ── 云根石组整套入折射层 ──
       ⚠️ 立峰不是"岸边石"，它**站在池底上**：落位半径 `rw = POND_RADII[ki] * 0.95`
          （POND_RADII 本身已是岸线的 0.92 倍 → 立峰在真实岸线内约 13% 半径处），
          而 `sink = |bedAt(hx,hz)| + 0.30` 用的 `bedAt` 就是 makePondBed 的碗形函数 ——
          它埋进的是**池底**，不是岸土。所以石矶/立峰/伴石的下半截全在水下
          （探针 `probe/refract-coverage.mjs` 实测下探：立峰 1.24m、石矶 0.89m、两伴石 0.81/0.31m）。
          漏打标记 = 透过水看，池中这块 4.5m 高的立峰在水面处被齐刷刷切断 ——
          贴图没错、状态全对、只有读像素看得出来（P2-5 复核时就是这么漏的）。
          代价：石体露出水面那一段也会进贴图（正交俯视分不出水线上下），是本方案固有取舍。 */
    markUnderwater(shelf);
    world.add(shelf);
    validateGeometry(shelf.geometry, 'taihuShelf');
    /* ── 太湖石主峰·源选择（2026-10-14 · 试水单）──
       默认走 CC0 试水件：assets/boulder-hero.glb（Poly Haven boulder_01 → Blender GLB，
       5.94MB / 66122 面 / 立姿 1.27×1.00×1.83m，选型批次见 research/cc0-scout/SHORTLIST.md #1）。
       · `?heroSrc=proc` 露程序化原始峰（对比截图用）——探针惯例的显式覆盖，不吃全局随机。
       · 原程序化主峰**原样保留**在这条 if 里，一键回滚 = 下面参数锁回 'proc'；**不要 commit，等用户看图点头**。
       · GLB 走 loadAssetOnce 的归一化模板（最大维=targetSize、底部 y=0），holder 摆位/朝向按原主峰同口径
         （hx/hz 同位、-sink 入池底、ry 同 0.62、markUnderwater + noMerge 同标注）；
         targetSize 4.5 与原 height 同值 → 顶高 ≈ 3.32m，与原峰水上水下覆盖一致。 */
    const heroSrc = (()=>{ try { return new URLSearchParams(location.search).get('heroSrc') === 'proc' ? 'proc' : 'glb'; } catch { return 'glb'; } })();
    if (heroSrc === 'proc'){
      /* ── 原程序化主峰（回滚档，一字未动） ── */
      const hero = mesh(makeTaihuHeroGeo({
        height: 4.5, baseR: 0.80, seed: 11, sink: sink, holeCount: 9, eyeRatio: 0.25,
        main: [0.70, 0.36], sec: [0.47, 0.22], bump: [0.24, 0.13],
        lean: [0.85, 1.10], biteN: 4, biteR: [0.42, 0.68], biteD: [1.05, 1.45],
        furrowMul: 1.10, foot: [0.95, 0.28],
      }), MAT.taihuHero, { name:'taihuHero' });
      hero.position.set(hx, 0, hz);
      hero.rotation.y = 0.62;
      hero.userData.noMerge = true;                // ⚠️ 顶点色（AO/水线）会被几何合并丢掉
      markUnderwater(hero);                        // 同上：立峰站在池底上，水下段 1.24m
      world.add(hero);
      validateGeometry(hero.geometry, 'taihuHero');
    console.log('[特置立峰·proc 档] 位置 (' + hx.toFixed(2) + ', ' + hz.toFixed(2) + ') 岸半径 ' + shoreR.toFixed(2)
                + ' 入土 ' + sink.toFixed(2) + 'm 面数 ' + hero.geometry.userData.tris
                + ' 法线一致率 ' + hero.geometry.userData.normalAgree
                + ' 连通分量 ' + hero.geometry.userData.islands
                + ' 苔痕 ' + (hero.geometry.userData.mossVerts || 0)
                + ' 透光缘 ' + (hero.geometry.userData.sssVerts || 0)
                + ' 用时 ' + (performance.now() - t0).toFixed(0) + 'ms');
    } else {
      /* ── CC0 试水件（boulder_01，试水 · 不回滚到此处即不生效） ── */
      /* ⚠️ 与 13-preload 同写法：url 带 assets/ 前缀（同 placeAssets('assets/Turtle.glb', ...)）。 */
      loadAssetOnce('assets/boulder-hero.glb', 4.49, (sv)=>{
        const holder = new THREE.Group();
        holder.name = 'taihuHero';
        holder.position.set(hx, -sink, hz);
        holder.rotation.y = 0.62;
        holder.add(sv);
        holder.userData.noMerge = true;            // 防几何 merge 吃掉模板归一化偏移（Koi 同机制）
        holder.traverse(o1=>{ if (o1.isMesh){ o1.castShadow = true; o1.receiveShadow = true; } });
        markUnderwater(holder);                    // 立峰站池底，水下段与原峰同口径
        world.add(holder);
        refillHeroVp();                            // 机位回填（同一几何反算，proc/glb 同prefab）
        console.log('[特置立峰·GLB 试水] 位置 (' + hx.toFixed(2) + ', ' + hz.toFixed(2)
                    + ') 入土 ' + sink.toFixed(2) + 'm / 面数 66122（Blender 实测）'
                    + ' / 包体 5.94MB / 立姿 1.27×1.00×1.83m');
      });
    }
    /* 伴石：同源生成、小一号，一块半浸 —— 单独一块立石在实景里像"插上去的" */
    /* ⚠️ 伴石沉深了会变成棕色"木桩"（样张实测：入土 1.0m / 石高 1.15m → 87% 没在水下，
       整块被水线渍带压成深褐）。改成矮而宽、只埋 25cm，露出水面才有"伴石"的读法。 */
    /* ⚠️ 隧道的 span 只截 **y** 方向，水平方向不受限 —— 瘦石体会被隧道在侧面切出豁口：
       探针实测旧参数（0.85/0.42、3 孔）的伴石出现 19 个边界环、透孔数为负（挖出的是豁口不是孔）。
       把高/baseR 压到 ≤1.5、孔数减到 2 后边界环降到 15/3 —— 仍不是闭合曲面。
       根因有两个：① 隧道全长 L≈2.9m 远超石体半宽(~1.65×baseR≈0.9m)，圆柱在锥形侧面拖出
       **长沟型豁口**（tunLen 收短到 2.4×baseR 即修复）；② 更狠的是**侧向咬缺球**半径 0.28~0.5m、
       咬进 0.55~0.83m 深，而伴石半宽才 0.9m —— 球缺直接把瘦石体侧面**咬穿**（实测 baseR 0.55 的
       伴石 biteN=3 时边界环 15，biteN=0 后才降）。主立峰半宽 1.16m 所以两样都不受影响。
       tunLen/biteN 都是纯几何参数；rndH 是 seed 独立流，改变只影响伴石自己的孔位，全园随机不漂移。
       半浸水里被水面/池底截断的开口是合理的，门禁只额外卡豁口环数。 */
    const comps = [[1.45, -0.55, 0.80, 0.55, 2.2, 21], [-1.25, 0.68, 0.62, 0.48, -0.8, 34]];
    for (const c of comps){
      const px = hx + c[0], pz = hz + c[1];
      const cs = Math.max(0.25, Math.abs(bedAt(px, pz)) - 0.30);
      const m = mesh(makeTaihuHeroGeo({ height: c[2], baseR: c[3], seed: c[5], sink: cs,
                                        holeCount: 2, cell: 0.05,
                                        tunLen: c[3] * 2.4,
                                        biteN: 0 }),
                     MAT.taihuHero, { name:'taihuCompanion' });
      m.position.set(px, 0, pz);
      m.rotation.y = c[4];
      m.userData.noMerge = true;
      markUnderwater(m);                           // 伴石同立峰：坐落在池底，水下段 0.31~0.81m
      world.add(m);
      validateGeometry(m.geometry, 'taihuCompanion');
    }
    /* 石根草叶（参考图里那几丛）：独立随机流 —— 不消耗全局 rnd，
       否则 rr() 序列整体后移，全园布局会跟着变（隐蔽的全场改动）。 */
    const rrH = mulberry32(4242);
    const blades = new THREE.InstancedMesh(makeReedBladeGeo(1.5), MAT.reed, 30);
    blades.castShadow = false; blades.receiveShadow = true;
    const mm = new THREE.Matrix4(), pp = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3();
    for (let i = 0; i < 30; i++){
      const a = rrH() * TAU, rad = 1.1 + rrH() * 1.6;
      pp.set(hx + Math.cos(a) * rad, CFG.water - 0.05, hz + Math.sin(a) * rad * 0.7);
      qq.setFromEuler(new THREE.Euler(rrH() * 0.5 - 0.25, rrH() * TAU, rrH() * 0.5 - 0.25));
      ss.set(1, 0.6 + rrH() * 0.9, 1);
      mm.compose(pp, qq, ss);
      blades.setMatrixAt(i, mm);
    }
    blades.instanceMatrix.needsUpdate = true;
    /* 石根草叶：绕立峰 1.1~2.7m 铺开，而立峰在池内 —— 草叶根部 y = CFG.water − 0.05
       就是**水下**，所以这一丛也得进折射层（下探 0.28m；探针实测它压在池内 4.8m）。 */
    markUnderwater(blades);
    world.add(blades);
    /* ── 云根题名石：横卧卵石，左肩略高、右端收尖，半埋岸土；无碑座与边框。 ──
       ⚠️ 落位必须在**池局部坐标**里算，并把半径钳到岸线之外：
       · 池心在世界 (0,·,3)（水面/池底/驳岸三处一致），而 hero.position 用的是世界坐标，
         原来直接拿 (hx,hz) 当"相对池心的方向" —— 少减了那 3m，方向偏了约 17°；
       · 更糟的是"立峰外侧 3.2m + 侧向 2.6m"推出来的点**仍在池形内**（探针实测
         insidePond=true），题名石等于半泡在水里。这里把半径下限钉成 岸线 + 1.10m。 */
    const hLx = hx, hLz = hz - 3;                       // 立峰的池局部坐标
    const rr0 = Math.hypot(hLx, hLz) || 1;
    const ox = hLx / rr0, oz = hLz / rr0;               // 池心 → 立峰
    /* ── 视线缺陷 ③（2026-09-18 解决 · 方案 A：给题名石一个**专用近观机位**）──
       现象：题名石在**立峰正后方**，从立峰机位看过去，视线先撞伴石再撞立峰
       （首个命中 taihuCompanion@10.97，接着 taihuHero@11.51/12.14，字心在 12.5m），刻字面被挡死。
       · 为什么 stone-audit 一直绿：「刻字面朝向池心 dot>0.7」只查**法线朝向**，
         而题名石的法线正是朝池心 —— 朝向对、视线不通。所以视线必须用射线判据守，
         现在由 stele-legibility 从 `stele`（云根近观）机位做**硬判定**。
       · 为什么不靠"把题名石侧移让开"：试过侧向 2.6→6.4m，位移 3.7m 后又被 LotusPlant@7.83 挡住，
         而且题名石按设计是**立峰的石刻配对**，挪远就不再"配对"（属构图变更）。
       · 最终解法 = 两条，缺一不可：
         ① 沿**径向**把石头退到岸线外 0.50m（见下面 STELE_SHORE_PAD 的长注释）——
            径向进出不改变方位角，配对关系不动；
         ② 新增 `stele` 机位（VIEWPOINTS 里占位、装配时按实测字心/法线回填，见本段末尾），
            并把 OrbitControls 的 minDistance 从 9 放开到该机位的 2.2 —— 2.8m 的近观距离
            否则会被 controls.update() 每帧弹回 9m。 */
    const sLx0 = hLx + ox * 3.2 + oz * 2.6;             // 再往外 3.2m、侧向 2.6m
    const sLz0 = hLz + oz * 3.2 - ox * 2.6;
    const sAng = Math.atan2(sLz0, sLx0);
    const kS = Math.round((((sAng % TAU) + TAU) % TAU) / TAU * POND_RADII.length) % POND_RADII.length;
    const shoreS = POND_RADII[kS] / 0.92;               // POND_RADII 是岸线的 0.92 倍
    /* ⚠️ 岸线外余量 1.10m 是**错的**（2026-09-18 射线实测，probe/stele-block）。
       这一带的岸是**两级台地**：水侧下台地地表 y ≈ 0.06(水)/0.18/0.38/0.52，
       而岸内上台地 y ≈ 1.0 以上；两级之间在**字心正前方 +0.2m** 处有一道约 0.5m 高的岸坎，
       坎顶 y ≈ 1.00~1.06。放在 1.10m 余量上 → 石头正好坐在**上台地边缘**，
       字心（y=0.95）比身前 20cm 的坎顶还低 → 从水侧**任何距离、任何高度**打射线，
       首个命中都是 mergedStatic 坎顶（命中点离字心仅 0.1~0.2m）：实测 3 个距离 × 11 个高度
       = 33 发**全部被挡**。视觉侧（agnes 读图）也独立给出"地面棱线横在字面前方、字面基本被盖住"。
       退到 0.50m 余量 → 整块石头落到**下台地**、岸坎退到刻字面**身后约 0.5m** → 水侧视野无遮挡；
       且仍离水面 1.3m，仍是"岸上题名"，不是半泡在水里。
       ⚠️ 方位角 sAng 不变 —— 只沿径向进出，题名石与立峰的**配对关系（石刻配对）不动**。 */
    const STELE_SHORE_PAD = 0.50;
    const sRad = Math.max(Math.hypot(sLx0, sLz0), shoreS + STELE_SHORE_PAD);
    const sLx = Math.cos(sAng) * sRad, sLz = Math.sin(sAng) * sRad;
    const sx = sLx, sz = sLz + 3;                       // 回到世界坐标
    const stele = new THREE.Group();
    stele.name = 'steleGroup';        // 探针按名定位；'stele' 是里面的石片（无旋转、位置在原点）
    /* ⚠️ 落位高度**不能写死 y=0**。题名石是"半埋岸土"的卧石，而 y=0 只是**名义**地面 ——
       实测这一带的岸面 / 驳石顶面在 **y ≈ 0.50m**，而字心只有 y ≈ 0.40，
       等于**刻字被压在岸面之下**。射线实测（probe/stele-viewpoint）：
       从字心正前方 8 个方位 × 4 个距离 × 3 个高度，共 300 个候选机位，**通畅数 = 0**，
       最前面挡着的一律是 mergedStatic 岸面（0.92~2.5m，顶面 y ≈ 0.49~0.50）。
       ⚠️ 别改成"从上往下打射线取地面高度"：那条射线会先命中上方的**屋檐/围墙**，
       实测给出 y = 6.77 的假地面，直接把石头吊到半空（试过，已回退）。
       所以这里写成**显式常量**并把量出来的依据留在注释里。抬 0.55m → 字心 y ≈ 0.95，
       稳稳压过岸面，同时石底仍在岸面附近、不悬空。 */
    const STELE_LIFT = 0.55;
    stele.position.set(sx, STELE_LIFT, sz);
    /* 刻字面（局部 +z）朝向池心：Ry(θ)·(0,0,1) = (sinθ,0,cosθ)，要等于 (-sLx,-sLz)/|·| */
    stele.rotation.y = Math.atan2(-sLx, -sLz);
    const rndName = mulberry32(62419);
    const cName = document.createElement('canvas');
    cName.width = 1024; cName.height = 512;
    const ink = cName.getContext('2d');
    ink.fillStyle = '#899894'; ink.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 1800; i++){
      ink.fillStyle = rndName() < 0.5 ? 'rgba(43,60,59,.07)' : 'rgba(220,228,219,.10)';
      ink.beginPath(); ink.arc(rndName() * 1024, rndName() * 512, 0.8 + rndName() * 3.4, 0, TAU); ink.fill();
    }
    ink.font = '205px "STXingkai","华文行楷","KaiTi","楷体",serif';
    ink.textAlign = 'center'; ink.textBaseline = 'middle';
    /* ⚠️ 字色的对比度要按**渲染后**定，不是贴图上好看就行（pixel-probe 实测）：
       原字号 170px / 字色 #344943(L50) 在贴图上 L 对比 90，但经环境光+色调映射后
       深色字被整体抬高，实拍中心区跨度只有 36、暗像素仅 0.05% → 完全读不出。
       加深到 #1B2927(L33) 并把字号提到 205px，让渲染后仍留得住对比。 */
    for (const [ch, x, y] of [['云', 375, 251], ['根', 649, 263]]){
      ink.fillStyle = 'rgba(218,231,219,.55)'; ink.fillText(ch, x + 3, y + 4);
      ink.lineWidth = 5; ink.strokeStyle = '#1B2927'; ink.strokeText(ch, x, y);
      ink.fillStyle = '#1B2927'; ink.fillText(ch, x, y);
    }
    const nameTex = new THREE.CanvasTexture(cName);
    nameTex.colorSpace = THREE.SRGBColorSpace; nameTex.anisotropy = 8;
    /* 旧 makeSteleTex 固定消耗 900×5 次 rnd；保留原游标推进，后续全园布局不漂移。
       新纹理与石形不使用这个流，改变斑点数量也不会改变全园随机序列。 */
    for (let i = 0; i < 4500; i++) rnd();
    const nameGeo = new THREE.IcosahedronGeometry(1, 3);
    const np = nameGeo.attributes.position, nuv = nameGeo.attributes.uv;
    for (let i = 0; i < np.count; i++){
      const x = np.getX(i), y = np.getY(i), z = np.getZ(i);
      // 连续噪声保证重复顶点同位，不用逐顶点随机抖动制造裂缝。
      const wear = 1 + 0.075 * Math.sin(x * 7 + y * 5) * Math.cos(z * 6 - x * 3)
                     + 0.035 * Math.sin(y * 13 + z * 9);
      const px = x * 1.38 * wear + 0.09 * y;
      const py = y * 0.52 * wear * (1 - 0.16 * x) - 0.045 * x;
      const pz = Math.min(z * 0.55 * wear, 0.27 + py * 0.07);
      np.setXYZ(i, px, py + 0.40, pz);
      nuv.setXY(i, px / 3.0 + 0.5, py / 1.2 + 0.5);
    }
    nameGeo.computeVertexNormals();
    /* 刻字直接映在朝池石面，背部和侧壁用同色石材，不叠矩形牌片。
       ⚠️ 分组必须**先按材质排序再切段**：原来按三角形原顺序逐段切，材质在 0/1 之间来回跳，
       一块石头切出 31 个 group = 31 次 draw call（探针实测）。排序后恒为 2 段。
       只重排 index、不动顶点属性 —— 顶点是逐三角形独立的（Icosahedron 非索引几何），
       换序不破坏任何东西。 */
    const triN = Math.floor(np.count / 3);
    const triArr = new Array(triN);
    for (let i = 0; i < triN; i++){
      const a = i * 3, b = a + 1, c = a + 2;
      triArr[i] = [a, b, c, (np.getZ(a) > 0.20 && np.getZ(b) > 0.20 && np.getZ(c) > 0.20) ? 1 : 0];
    }
    triArr.sort((p, q) => p[3] - q[3]);
    const newIdx = new Uint32Array(triN * 3);
    /* ⚠️ addGroup(start, count) 的 start 与 count **同为单位**（有 index 时都按 index 项数计）。
       这里曾把 gStart 存成**三角形序号**、count 却乘了 3，两者错位：排序后刻字段从第 k 个三角形
       起，start 被写成 k 而非 3k → 刻字材质被贴到中间 80 个随机三角形上（字被抹成一片），
       而真正的刻字面 [3k, 3N) 落在所有 group 之外、根本不被绘制（石front面直接缺一块）。
       这类错不报错、不崩、渲染也"有东西"，只有结构断言能守 —— 见 stele-legibility 的 group 铺满判据。 */
    nameGeo.clearGroups();
    let gStart = 0, gMat = triArr.length ? triArr[0][3] : 0;
    for (let i = 0; i < triN; i++){
      const t = triArr[i];
      newIdx[i * 3] = t[0]; newIdx[i * 3 + 1] = t[1]; newIdx[i * 3 + 2] = t[2];
      if (t[3] !== gMat){
        nameGeo.addGroup(gStart, i * 3 - gStart, gMat);
        gStart = i * 3; gMat = t[3];
      }
    }
    if (triN) nameGeo.addGroup(gStart, triN * 3 - gStart, gMat);
    nameGeo.setIndex(new THREE.BufferAttribute(newIdx, 1));
    const stoneMat = new THREE.MeshStandardMaterial({ color:0x899894, normalMap:rockNormalTex,
      normalScale:new THREE.Vector2(0.3, 0.3), roughness:0.94, metalness:0, envMapIntensity:0.35 });
    const faceMat = stoneMat.clone(); faceMat.color.set(0xffffff); faceMat.map = nameTex;
    /* ⚠️ 这里原来只登记了 wet —— 石头能打湿、却不积雪，而园里其它石头（taihu/rock/
       stone/riverStone…）全在 SNOW_COVER_MATS 里，只有这块 hero 机位的主角是光板。
       形状是"同一处调用只登记了一半"（2026-09-20 盘点抓到）。
       faceMat（刻字面）**故意**不进雪表：雪盖住刻字 = 题名不可读，那正是 stele-legibility
       门禁在守的东西。克隆发生在登记之前，所以它不会被 stoneMat 的登记带进去。 */
    registerWeatherRoles(stoneMat, { snow:1, wet:1 }); registerWeatherRoles(faceMat, { wet:1 });
    const slab = mesh(nameGeo, [stoneMat, faceMat], { name:'stele' });
    slab.userData.noMerge = true;
    stele.add(slab);
    world.add(stele);
    console.log('[题名石刻] 云根 @ (' + sx.toFixed(2) + ', ' + sz.toFixed(2) + ')');
    /* P1-4 延迟装配补遗：VIEWPOINTS 初始化时立峰还没建，hero 机位当时只能用兜底参数 ——
       现在石已落地，按同一套「包围盒反算」把机位刷成精确构图（与同步装配时完全一致）。
       试水单（2026-10-14）：GLB 分支下主峰是**异步**进场的，回填封装成函数 —— proc 在
       heroStones 回调里同步调，GLB 在 loadAssetOnce 的 cb 里调（同一几何反算，一字不差）。 */
    /* 必须函数声明（块内提升）：GLB 预取命中走同步回调，早于此行执行，const 版 TDZ。 */
    function refillHeroVp() {
      const ho = world.children.find(o => o.name === 'taihuHero');
      if (!ho) return;
      {
      const out2 = new THREE.Vector3(hx, 0, hz).normalize();
      const side2 = new THREE.Vector3(-out2.z, 0, out2.x);
      const bb2 = new THREE.Box3().setFromObject(ho);
      const need2 = (bb2.max.y - bb2.min.y) * 0.72 + 2.6;
      const dist2 = (need2 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.5;
      const vp = VIEWPOINTS.find(v => v.id === 'hero');
      if (vp){
        vp.pos.set(hx - out2.x * dist2 + side2.x * dist2 * 0.20,
                   1.35 + (dist2 - 12) * 0.10,
                   hz - out2.z * dist2 + side2.z * dist2 * 0.20);
        vp.target.set(hx, bb2.max.y * 0.46, hz);
      }
      }
    }
    if (heroSrc === 'proc'){ refillHeroVp(); }
    /* 「云根」近观机位回填：字心 = 刻字面 group（materialIndex 1）全部顶点的局部均值 →
       世界坐标（与探针 probe/stele-legibility.mjs 同款取法，不写死坐标）。
       D = 2.8m：fov 46° / 16:9 下，石头 2.9m 的长边约占画幅 68%，两字尺寸是净室判据的 0.68 倍。
       视高 1.55m 是"站在水边平视略俯"的高度 —— 字心才 0.95m，压太低会变成仰视。
       ⚠️ 这里必须自己 updateWorldMatrix：stones 是延迟批里刚 add 进去的，matrixWorld 还是上一帧的
       （未渲染过 = 单位矩阵），直接用会算出"石头在世界原点"的假坐标。 */
    {
      stele.updateWorldMatrix(true, true);
      const gp = nameGeo.groups.find(g => g.materialIndex === 1);
      const cenL = new THREE.Vector3();
      for (let k = gp.start; k < gp.start + gp.count; k++){
        const vi = nameGeo.index.getX(k);
        cenL.add(new THREE.Vector3(np.getX(vi), np.getY(vi), np.getZ(vi)));
      }
      cenL.divideScalar(gp.count);
      const cenW = cenL.clone().applyMatrix4(slab.matrixWorld);
      const nrmW = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(stele.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const vpS = VIEWPOINTS.find(v => v.id === 'stele');
      if (vpS){
        const D = 2.8;
        vpS.pos.set(cenW.x + nrmW.x * D, 1.55, cenW.z + nrmW.z * D);
        vpS.target.set(cenW.x, cenW.y, cenW.z);
      }
    }
    bootMark('立峰几何');
  } catch (err){
    console.warn('[特置立峰] 生成失败，已跳过：', err && err.message);
  }
});

/* ── 导览机位（B：给立峰一个"专用观赏面"）──
   名石在园子里从来不是"一块石头"，而是"有名字、有座、有观赏位置的一景"。
   机位切换用平滑飞行（从当前画面出发，1.4s 缓出），不是瞬移；
   与 ENV 的过渡同源，键盘 Z 巡览、面板按钮直达。 */
/* ── W1（2026-10-15）：机位飞行/开场运镜/机位表/巡游已搬进 ./08d-tour.js ──
   buildViewpoints(HERO_POS) 必须在这个位置调用（与搬家前同一求值点）；
   HERO_POS 在上方同步算出，作为参数传入（08d 不反向 import 本模块，避免成环）。 */
import { VIEWPOINTS, buildViewpoints, CAM_FLY, flyTo, cancelCamFly, updateCamFly, INTRO,
         introActive, introStart, introCancel, updateIntro, introMaybeAuto,
         gotoViewpoint, TOUR, captionEl, showCaption, showSeasonCaption, hideCaption,
         tourStop, tourStart, updateTour, tourUserTakeover } from './08d-tour.js';
export { CAM_FLY, flyTo, cancelCamFly, updateCamFly, INTRO, introActive, introStart,
         introCancel, updateIntro, introMaybeAuto, VIEWPOINTS,
         gotoViewpoint, TOUR, captionEl, showCaption, showSeasonCaption, hideCaption,
         tourStop, tourStart, updateTour, tourUserTakeover };
buildViewpoints(HERO_POS);

/* ── 以下两块来自 09-lights.js 的模块顶层（本轮拆模块时移回这里）──
   它们在原文件里就紧跟在 §8 组装之后（原 §9 段首），搬回去即保持原时序。
   为什么必须放在 08 的 body 里：两者操作的都是 world，而 world 定义在本模块顶部；
   09 又要 export mergeStatics / validateGeometry 给本模块用 —— 若把这两句留在 09 顶层，
   就构成"08 等 09 求值完 / 09 等 08 求值完"的环，ESM 直接给 TDZ。 */

/* ── 园林陈设（物）：石桌石凳 / 古琴 / 盆景花几 / 缸 / 香炉 / 竹帘 / 文房 / 卷轴挂画 ──
   落点全部**射线实测**（outputs/_diag/props-spot.mjs：从空中下打、看真实命中面，
   不看地形公式 —— 台基/铺地/廊道都是浮在地形上的独立网格，用 groundHeight 会陷/悬）。
   几何与落点表都在 14-props（本模块只负责"什么时候挂进 world"）：
   ⚠️ 必须在下面那次小构件投影剔除**之前**挂进去 —— 那些 < 1.1m 的案上小件
   （笔架/砚/茶盏/棋钵）正好靠这一遍把 castShadow 关掉，晚了就白进投射物集合、
   把阴影视体撑大（shadow-cover 的既有取舍）。 */
world.add(buildProps());
/* 堂前香炉的袅袅白烟（2026-10-05 · 老黄："正堂前既然加了铜炉，是不是应该有袅袅白烟"）。
   出烟口 = 香炉落点 + **炉盖口**高度：14-props 的 makeCenser 里 bodyY=0.30、
   盖在 bodyY+0.415、宝顶在 bodyY+0.565 ⇒ 取 0.66 正好落在盖口之上一点点
   （⚠️ 香炉那一支改动时这个数要跟着看 —— 它是"炉在哪"的唯一依据，取 PROP_SPOTS.censer
   而不是重抄坐标，就是为了至少水平位置不会两处漂）。 */
{
  const cs = PROP_SPOTS.censer;
  const smoke = makeCenserSmoke(cs.x, groundHeight(cs.x, cs.z) + 0.66, cs.z);
  world.add(smoke);
}

/* ── 坐姿人物：对弈二人（计划书 §6「人」批第一件，与上面的石桌石凳棋盘配套）──
   ⚠️ 必须放在 `world.add(buildProps())` **之后**：座位表 SEAT_SPOTS 是在 buildProps
   里面（makeStoneTableSet 内）填的，提前读只会拿到空数组。
   ⚠️ 座位取 SEAT_SPOTS 的**真实世界落位**（含 14-props 的 jr 抖动），不在本模块按
   "45°/225° × r=1.02"重算 —— 重算会跟真凳子差到 7cm，近景里就是"人坐在凳子边沿外"。
   选**对径的一对**（i 与 i+2，夹角 180°）：同侧相邻那两张不是"对弈"。
   ⚠️ 服色避开绿族：这张桌子在**草坪**上，而草坪是绿底（站姿那批的血泪：松绿袍与草坪
   ΔRGB 只有 49，人一放上去就没了）⇒ 用宝蓝 / 秋香两个非绿色相。 */
{
  const SKINS = ['plum', 'navy'];
  [0, 2].forEach((si, k) => {
    const st = SEAT_SPOTS[si];
    if (!st) return;
    const fg = makeSeatedScholar({ x: st.x, z: st.z, y: st.y, yaw: st.yaw, s: 1.0, pose: 'go', skin: SKINS[k] });
    /* 时段取 12.5~18：**只为避开"同框可区分"的硬约束**（figure-audit 要求 slot 重叠的角色
       服色距离 ≥60）。7.5~12 那一档挤着先生（indigo）+ 两书童（celadon/ochre），
       新开的plum/navy 与 indigo 只差 52；而 12.5~18 只与午后品茗（moss）同框，
       两色对 moss 分别是 73 / 108。风雨雪由 11-loop 的 goodWeather 挡（同全体现役人物）。 */
    fg.userData.slot = { h0: 12.5, h1: 18.0, stroll: null };
    fg.userData.skin = SKINS[k];
    fg.userData.poseName = 'go';
    world.add(fg);
  });
  /* 抚琴人（计划书 §6「人」批 · 与 14-props #2 古琴琴桌配套）：坐在 14-props 新补的琴凳上，
     面朝池面（临水抚琴）。座位同样读 QIN_SEAT —— 不在这里按
     "琴桌 13.4,8.2 加个偏移"重算，理由同上面 SEAT_SPOTS 那段。
     时段取 12.5~18（与午后品茗同框 ＝「品茗 + 抚琴」一场小聚），服色石青。 */
  const qs = QIN_SEAT[0];
  if (qs){
    const fg = makeSeatedScholar({ x: qs.x, z: qs.z, y: qs.y, yaw: qs.yaw, s: 1.0, pose: 'qin', skin: 'slate' });
    fg.userData.slot = { h0: 12.5, h1: 18.0, stroll: null };
    fg.userData.skin = 'slate';
    fg.userData.poseName = 'qin';
    world.add(fg);
  }
}

/* ── W2（2026-10-15）：看烟花一家已搬进 ./08b-figures.js ──
   buildWatchers() 必须在这个位置调用（与搬家前同一求值点，WR 顺序一致）。 */
import { buildWatchers, updateWatchers } from './08b-figures.js';
export { updateWatchers };
buildWatchers();

// 性能：小尺寸构件在阴影里的贡献几乎不可见，关闭其投影以压低 shadow pass 的 draw call
world.traverse(o=>{
  if (!o.isMesh || o.isInstancedMesh) return;
  const b = new THREE.Box3().setFromObject(o);
  const sz = b.getSize(new THREE.Vector3());
  if (Math.max(sz.x, sz.y, sz.z) < 1.1) o.castShadow = false;
});

bootMark('场景几何');
mergeStatics(world);
bootMark('几何合并');
/* 这一段原在 09-lights 顶层（§9 段首），因环改到本模块 body 末尾；
   此刻 world 已填满，对应"§8 跑完"的原时序。 */
fitShadowCamera();
/* 这一段原在 10-post 顶层（§10 段首），同理搬回。顺序在 mergeStatics 之后 ——
   合并后收集才看得见合并后的网格（延迟批的补收仍在 runDeferredBoot 里）。 */
collectAOSkip();
/* §12 的装配阶段收尾（灯笼入场景 / UI 同步 / 首帧前套一遍环境）也从 12-env 顶层搬到这里：
   它要往 world 挂灯笼、还要写本模块的 perchShowOK，而 12-env 被本模块 import 而在 world 之前
   求值 → 留在那边顶层必 TDZ。放在最末是为了让灯笼落在 mergeStatics 之后（动态件不该被合并）。 */
initEnvScene();
