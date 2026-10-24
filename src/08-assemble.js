// 08-assemble: from index.html inline 495..1746
import { THREE } from '../vendor.js';
import { validateGeometry, mergeStatics, fitShadowCamera } from './09-lights.js';
import { collectAOSkip } from './10-post.js';
import { applyEnv, collectSeasonCaches, ENV, initEnvScene } from './12-env.js';
/* 2026-10-15 W1/W2/W3 拆分收尾：controls / CAM_MIN_DIST / CAM_HOME / PROBE_DRIVEN 的用法
   已随巡游与机位搬进 08d-tour.js，本模块再无引用 ⇒ 从 import 面删掉（原先从 W0 之前
   的 23/8/5/2 次引用一路降到 0）。 */
import { scene, world, renderer, camera } from './02-scene.js';
import { bootMark, rr, TAU, mulberry32, rnd, CFG } from './00-config.js';

/* ── W2（2026-10-15）：jr/WR 两条布局流已搬进 ./08b-figures.js（同一枚对象）。
   08 仅 import { jr } 供补石用；WR 本模块别处不用。 */
import { loadAssetOnce } from './06e-assets.js';
import { rippleInst } from './06f-ripple.js';
import { baitPoints } from './06g-koi.js';
import { makeRockery, makeRockChain, makeTaihuHeroGeo } from './06h-rock.js';
import { makeLotusPod, makeWillow, makePeachTree, makePlumTree, makeOrchidPot } from './06i-trees.js';
import { makeReedBladeGeo } from './06c-organs.js';
import { makeMistField, makeWisteria, makeBamboo } from './06j-herbs.js';
/* 2026-10-05 拆分：雾团 + 香炉白烟已搬进 06b-atmos.js（两者是"billboard 氛围片"，与植被建模无关）。 */
import { makeFogBanks, makeCenserSmoke } from './06b-atmos.js';
import { makeGround, makeDistantHills, makeWalls, makePaving } from './07-ground.js';
import { makePond, makeBankRocks, makeArchBridge, makeSteppingStones, POND_RADII, markUnderwater, groundHeight } from './05-water.js';
import { makeYuanxiangHall, makeWaterPavilion, makeCorridor } from './04-buildings.js';
/* 15-stable（2026-10-09 · 老黄："院子外围做一个马厩：停 4 匹马、2 驾双轮马车、一个马夫喂草料"）：
   建筑 + 马 + 马车 + 场院杂物整组在那个模块里；**马夫不在这里建** —— 人物工厂 makeScholar
   就在本文件下方，马厩模块持有它会造成循环 import。这里只import 马厩整体与"手里的草料捆"。 */
import { makeStable, loadStableHorses, makeStableRoad } from './15-stable.js';
import { mesh } from './03-factory.js';
import { MAT, willowOrigins, rockNormalTex, registerWeatherRoles } from './01-materials.js';
import { buildProps, SEAT_SPOTS, QIN_SEAT, PROP_SPOTS } from './14-props.js';
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
import { WALK_PATH, buildWalkPath, walkPointAt, WALKERS } from './08d-tour.js';
export { WALK_PATH, walkPointAt, WALKERS };
buildWalkPath();

/* ── W2（2026-10-15）：点景人物已搬进 ./08b-figures.js ──
   buildFigures() 必须在这个位置调用（布景之后、koi 之前）：
   D/书童两循环的求值期 jr 消耗顺序与搬家前逐字一致。 */
import { jr, figures, makeSeatedScholar, buildFigures,
         FIG_HAIR, FIG_PALETTE, makeGroomArm, tickGroomFeed, groomFeedState } from './08b-figures.js';
export { FIG_HAIR, FIG_PALETTE, figures, makeGroomArm, tickGroomFeed, groomFeedState };
buildFigures();
/* 2026-10-21 P1：AI 半写实人物（文士/仕女）。加载成功才隐藏程序化替身；
   失败/离线时替身照常站着。人物是静态站点角色，动作只在骨骼上做呼吸/转头。 */
import { buildActors, buildSeatedActors } from './16-actors.js';
buildActors();

/* ── W3（2026-10-15）：睡莲→鸭（含芭蕉/石灯笼/泳龟/水禽/鹦鹉/大雁/小鸟/蜻蜓/荷花）已搬进 ./08c-aquatic.js ──
   buildAquatic() 必须在这个位置调用（W2 人物之后、柳树之前）：段内十余处全局随机流消耗
   （makeAquatic / makeKoiGroup / 蜻蜓 30 抽 / 水草 / 荷花等量燃烧 / 荷杆 / makePondPads / 泳龟预抽）
   的求值顺序与搬家前逐字一致 —— 整段"原样搬走、原位调用"，与其余代码的相对次序不变。
   下面 import + 转出是**转手**：11-loop / 12-env / index.html 仍从本模块取这些名字，
   故对外 API 表面不变（与 W1/W2 同一套做法）。
   ⚠️ 不写成 `export { ... } from`：probe/import-audit.mjs 认"先 import 进作用域、再 export 出去"
   （12-env.js 里写着同一条理由；`export ... from` 既不进作用域又会被判成一次使用 ⇒ 假红）。 */
import { buildAquatic, GLB_LOTUS_STEM_H, GOOSE, PERCH_LIFT,
         dragonflies, geese, koiGroup, macawState, macawSpots,
         macawWantPerch, perchShowOK, perchingDragonflies, setPerchShowOK,
         smallBirdMeshRef, smallBirds, swimDucks, swimTurtles,
         updateGooseFlock, updateMacaws, updatePerchingDragonflies, updateSmallBirds } from './08c-aquatic.js';
export { GLB_LOTUS_STEM_H, GOOSE, PERCH_LIFT, dragonflies,
         geese, koiGroup, macawState, macawSpots, macawWantPerch,
         perchShowOK, perchingDragonflies, setPerchShowOK, smallBirdMeshRef,
         smallBirds, swimDucks, swimTurtles, updateGooseFlock,
         updateMacaws, updatePerchingDragonflies, updateSmallBirds };
buildAquatic();
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
     ⚠️ 放在马厩建好之后调用：它按 `userData.horseSlots` 找槽位。
     2026-10-19：撤马一轮后老黄要求"把之前的所有马都放回来"，恢复。 */
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
        /* ⚠️⚠️ 2026-10-24：这两行必须与 08d-tour 的 buildViewpoints 同步改（实测 1.18m 时
           相机是"站在池子里"的，正前方 1.8m 就是荷花丛 ⇒ 整站看到的是一朵大荷花）。
           抬到 2.75m 后近处花叶落到画面下缘之外。改这里之前先读 08d-tour 的同款注释。 */
        const camY = Math.max(1.35 + (dist2 - 12) * 0.10, 2.75);
        vp.pos.set(hx - out2.x * dist2 + side2.x * dist2 * 0.20, camY,
                   hz - out2.z * dist2 + side2.z * dist2 * 0.20);
        vp.target.set(hx, Math.max(bb2.max.y * 0.46, 1.70), hz);
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
         tourPlan, tourStop, tourStart, updateTour, tourUserTakeover } from './08d-tour.js';
export { CAM_FLY, flyTo, cancelCamFly, updateCamFly, INTRO, introActive, introStart,
         introCancel, updateIntro, introMaybeAuto, VIEWPOINTS,
         gotoViewpoint, TOUR, captionEl, showCaption, showSeasonCaption, hideCaption,
         tourPlan, tourStop, tourStart, updateTour, tourUserTakeover };
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
  /* 半写实（GLB）的两位对弈者：**必须在这里**装 —— 座位坐标 SEAT_SPOTS 在
     world.add(buildProps()) 时才填好，程序化替身也刚刚才进 figures
     （16-actors 的 hideProcedural 要按 poseName 找它们来换人）。 */
  buildSeatedActors();
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
