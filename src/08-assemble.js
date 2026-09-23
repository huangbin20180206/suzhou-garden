// 08-assemble: from index.html inline 495..1746
import { THREE } from '../vendor.js';
import { validateGeometry, mergeStatics, fitShadowCamera } from './09-lights.js';
import { collectAOSkip } from './10-post.js';
import { applyEnv, onAssetAttached, collectSeasonCaches, ENV, envEl, initEnvScene } from './12-env.js';
import { scene, world, renderer, camera, controls, CAM_MIN_DIST, CAM_HOME, PROBE_DRIVEN } from './02-scene.js';
import { bootMark, rr, TAU, mulberry32, rnd, CFG } from './00-config.js';
import { rippleInst, makeMistField, makeWisteria, makeRockery, makeRockChain, makeLotusPod, makeAquatic, makeKoiGroup, perchingAnchors, makeWaterGrass, placeAssets, makeBananaPlant, loadAssetOnce, KOI_ORBITS, makeWillow, makeBamboo, makeTaihuHeroGeo, makeReedBladeGeo, makePeachTree } from './06-vegetation.js';
import { makeGround, makeDistantHills, makeWalls, makePaving, makeDragonfly } from './07-ground.js';
import { makePond, makeBankRocks, makeArchBridge, makeSteppingStones, POND_RADII, markUnderwater } from './05-water.js';
import { makeYuanxiangHall, makeWaterPavilion, makeCorridor } from './04-buildings.js';
import { mesh } from './03-factory.js';
import { MAT, WIND, willowOrigins, rockNormalTex, registerWeatherRoles } from './01-materials.js';
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
function deferBoot(label, fn){ bootJobs.push({ label, fn }); }
/* 插队登记（unshift）。⚠️ 这不是优化，是正确性：延迟链每个 job 之间都 setTimeout(step,0)，
   在软渲染下一帧要好几秒 → **每多一个 job 就多等一帧**。立峰/伴石/题名石是首帧画面上最
   显眼、也是所有探针定位目标的大件，却按登记顺序排在 14 个柳/竹之后，要等十几帧才轮到
   （实测 240s 窗口内 steleGroup 始终不出现 → 题名石门禁假红）。柳/竹是墙根背景，晚到不穿帮；
   立峰晚到等于"画面里没有园子"。所以把大件插到队首。 */
function deferBootFirst(label, fn){ bootJobs.unshift({ label, fn }); }
export function runDeferredBoot(){
  if (!bootJobs.length) return;
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

world.add(makeGround());
world.add(makeDistantHills());
world.add(makePond());
/* 低空云雾（2026-09-19）：贴水面的 resolvational-style 云絮层。
   放在 pond 之后即可 —— 它是 transparent，three 自动排在最后渲，与水面/花草的
   前后关系由深度测试决定； ownership only 1 draw call（单个 InstancedMesh）。 */
const mistField = makeMistField();
world.add(mistField);
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
const bigW1 = makeWisteria(16, 2.6);
bigW1.position.set(13.2, 3.35, 1.2);
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
    if (Math.random() < 0.75){
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

/* ══ 人物 · 点景人物（彩色剪影）（样稿：先过用户审，再铺日程系统）══
   用户前史："之前的AI把人物做得跟鬼一样" —— 病根是低模硬追写实五官/人体结构，
   正好落进恐怖谷。这条路线不动摇：**以形写神**，五官一个面都不建。
   · 宽袍大袖的 lathe 轮廓（江南直裰 A 形剪影，衣纹交给光影，不做面）
   · 无脸：圆头+发髻，五官一个面都不建
   · 姿态"负手观荷"：双袖拢到身后、俯首
   · 2026-09-18 上色：单色墨蓝剪影 → **四分区分色**（袍身 / 腰带 / 衣缘 / 发髻），
     色值与明度定标见下方 FIG_PALETTE（量出来的，不是调的）。
     无脸剪影认身份全靠**色块分区 + 姿态**这两条。
   · 呼吸微动 0.6% —— 剪影的"活"就靠这一口气 */
/* 人物服色（2026-09-18 · 老黄给的风俗画参考图）—— 色值来自 probe/figure-palette.mjs 实测。
   ⚠️ 抄的是参考图的**色相策略**，不是它的明度：参考图是"褪色绢本"（背景暗部 L≈90），
   本场景背景低饱和区 L≈178（粉墙/水面/天空），照抄明度＝把衣服压成灰点。
   本场景的**冷色是空位**（蓝 1.1% + 青 0.4%），植被绿却占 39% —— 穿冷色＝独占色相。
   trim 由原来的冷灰 0xB9C2CE 改米白：暖衣缘贴冷袍身，两段都读得出来。
   ⚠️ **草坪是绿底**：袍色若与植被绿（实测 #457441）同族，人一遭放上草坪就没了 ——
   首版把松绿 #5F8467 给了童袍，样张里那孩子与草坪只有 ΔRGB 49，几乎看不见（老黄给的是
   风俗画参考图，画里人站在石头/木构上，天然没这个问题；我们的人站在草地上，得自己兜）。
   所以**站草坪上的角色一律用非绿色相**（宝蓝/天青/秋香），绿色系只留给水榭平台上的角色。
   ⚠️ 色值改错不报错、不崩、不触发任何门禁 —— 由 probe/figure-audit.mjs 把守。 */
export const FIG_HAIR = 0x1C2029;
export const FIG_PALETTE = {
  indigo:  { robe:0x4A6C9B, trim:0xDCD3BE, sash:0x2A3550 },   // 宝蓝 · 先生晨课（草坪）L=104
  /* 天青 · 书童（草坪）—— **刻意提亮**：同框的蓝袍 L=104，深天青 #6E9C93 只差 42，
     提亮到 L=162 后与蓝袍差 58、与草坪差 60，两头都有余量（首版就是这一对余量只剩 1） */
  celadon: { robe:0x7FADA2, trim:0xE8E0CC, sash:0x3A5B55 },
  ochre:   { robe:0xA8804E, trim:0xE8DFC8, sash:0x5A4224 },   // 秋香 · 书童（草坪）
  moss:    { robe:0x5F8467, trim:0xDDD6C2, sash:0x2F4634 },   // 松绿 · 午后品茗（水榭平台，不在草坪）
  lily:    { robe:0x7E6FA6, trim:0xE0D6C8, sash:0x39305A },   // 藕荷 · 夜步（游廊）
};
const figMat = (color, rough) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, envMapIntensity: 0.3 });
/* 躯干截面不是正圆（2026-09-18 第六轮 · 老黄选 B）。
   病根：袍身是 LatheGeometry（回转体），肩宽 = 2×0.186 = 0.37m，而头宽 0.172m
   → **肩只有 2.15 个头宽**（真人 ≈3），远看就是个保龄球瓶。这是"不像人"的最大来源，
   比配色影响大得多。修法是给**躯干层**一个椭圆缩放（横向 +15%、前后压扁 18%），
   ⚠️ 但**不能压整个 Group** —— 那样头也被压成扁球（头本来就该比肩更接近球）。
   所以 makeScholar/makeChildScholar 都是两层：外层 root（位置/朝向/整体缩放）+ 内层 body（椭圆截面），
   头挂在 root 上、不参与椭圆缩放。 */
const FIG_EW = 1.15, FIG_ED = 0.82;
/* 袍身轮廓半径的线性内插（prof 是 LatheGeometry 的 Vector2 数组）。
   交领衣缘要**贴着弧面**走 —— z 必须由半径算出来，不能猜（猜了不是穿模就是悬空）。 */
function profR(prof, y){
  for (let i = 0; i < prof.length - 1; i++){
    const a = prof[i], b = prof[i + 1];
    if (y >= a.y && y <= b.y) return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
  }
  return prof[prof.length - 1].x;
}
export const figures = [];
function makeScholar({ x = 0, z = 0, yaw = 0, s = 1, pose = 'observe', skin = 'indigo' } = {}){
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  root.rotation.z = 0.03;                     // 重心微偏：负手的站姿不该是旗杆
  root.scale.setScalar(s);
  const g = new THREE.Group();                // 躯干层：只它吃椭圆截面缩放（头不跟着压扁）
  g.scale.set(FIG_EW, 1, FIG_ED);
  root.add(g);
  const P = FIG_PALETTE[skin] || FIG_PALETTE.indigo;
  const ink      = figMat(P.robe, 0.92);      // 袍身主色（原为墨蓝近黑单色 0x1A2233）
  const inkLight = figMat(P.trim, 0.85);      // 领边 / 袖口环 / 后中缝
  const hair     = figMat(FIG_HAIR, 0.90);    // 头与发髻：比袍身更暗，剪影才立得住
  const sashMat  = figMat(P.sash, 0.88);      // 腰带
  // 袍身：肩加宽、腰收窄（7.5 头身）；直裰 A 形剪影
  const prof = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.195, 0.01),
    new THREE.Vector2(0.225, 0.16),
    new THREE.Vector2(0.160, 0.55),
    new THREE.Vector2(0.150, 0.82),    // 腰（收窄 → 拉头身比）
    new THREE.Vector2(0.172, 1.04),
    new THREE.Vector2(0.186, 1.19),    // 肩（加宽 20%）
    new THREE.Vector2(0.062, 1.28),    // 颈
    new THREE.Vector2(0.001, 1.31),
  ];
  const robe = mesh(new THREE.LatheGeometry(prof, 18), ink, { name:'scholarRobe' });
  g.add(robe);
  /* 腰带（2026-09-18）：参考图里人人束腰 —— 一道对比色横带把袍身切成上下两段，
     是小尺寸下最省成本的"衣服感"信号（没有它，彩色袍身仍读成一块色团）。
     半径按 y=0.845 处的袍半径（≈0.1525）外放约 1cm；结放在正前，给正面机位一个信息点。 */
  const sashBand = mesh(new THREE.CylinderGeometry(0.163, 0.167, 0.062, 16, 1, true), sashMat, { name:'scholarSash' });
  sashBand.position.y = 0.845;
  g.add(sashBand);
  const sashKnot = mesh(new THREE.SphereGeometry(0.036, 8, 7), sashMat, { name:'scholarSashKnot' });
  sashKnot.position.set(0, 0.845, 0.148);
  sashKnot.scale.set(1.1, 0.8, 0.65);
  g.add(sashKnot);
  /* 下摆衣缘（第六轮）：加它是因为自视样张发现整体是**花瓶轮廓** —— 回转体 + 下摆外扩
     （y=0.16 处 0.225 > 肩 0.186）没有终止线，读作一只瓷瓶。一道浅色横缘把下摆"切断"，
     和腰带同款思路（最省成本的"衣服感"信号）。半径按 profR 在 y=0.02/0.07 处各取 +9mm。 */
  const hem = mesh(new THREE.CylinderGeometry(0.216, 0.206, 0.05, 18, 1, true), inkLight, { name:'scholarHem' });
  hem.position.y = 0.045;
  g.add(hem);
  // 立领（第三轮加高 + 浅色上缘 —— "无脖"读成"高领"）
  const collar = mesh(new THREE.CylinderGeometry(0.066, 0.072, 0.075, 10), ink, { name:'scholarCollar' });
  collar.position.y = 1.25;
  g.add(collar);
  const collarEdge = mesh(new THREE.CylinderGeometry(0.0665, 0.0665, 0.012, 10), inkLight, { name:'scholarCollarEdge' });
  collarEdge.position.y = 1.282;
  g.add(collarEdge);
  // 后领中缝（第四轮：box 埋进了袍内 —— 改为**贴背曲线管**，沿袍背 S 轮廓全段外凸 1cm）
  const seamCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.26, -0.075),   // 颈后
    new THREE.Vector3(0, 1.19, -0.196),   // 肩背（袍背 -0.186，外凸 1cm）
    new THREE.Vector3(0, 1.04, -0.182),
    new THREE.Vector3(0, 0.82, -0.160),  // 腰背
    new THREE.Vector3(0, 0.55, -0.170),
    new THREE.Vector3(0, 0.30, -0.205),
    new THREE.Vector3(0, 0.14, -0.235),   // 下摆
  ]);
  const seam = mesh(new THREE.TubeGeometry(seamCurve, 14, 0.011, 5), inkLight, { name:'scholarSeam' });
  g.add(seam);
  /* 交领（第六轮 · 老黄选 B）：两条衣缘自颈侧斜下、在胸前**交叉**（"交"的由来）。
     参考图里人人有交领，那是"一眼汉服"的构件；没有它，正面看就是一件圆筒色块。
     z 由 profR 按袍身轮廓实时算出 + 外凸 1.2cm —— 贴弧面，既不穿模也不悬空。 */
  for (const side of [-1, 1]){
    const pts = [[0.050, 1.235], [0.030, 1.10], [0.005, 0.95], [-0.028, 0.875]];
    const lapel = new THREE.CatmullRomCurve3(pts.map(([ax, y]) => {
      const x = side * ax, r = profR(prof, y) + 0.012;
      return new THREE.Vector3(x, y, Math.sqrt(Math.max(r * r - x * x, 0.0004)));
    }));
    g.add(mesh(new THREE.TubeGeometry(lapel, 12, 0.016, 5, false), inkLight, { name:'scholarLapel' }));
  }
  /* 双袖：**姿态决定手在哪里**（第六轮修）。
     ⚠️ 原来无论什么姿态都画"负手"（袖管拢到身后），于是「执卷读书」时**书卷悬在胸前没人拿**、
     正面看两条袖子还横向支出去像一对翅膀 —— 姿态与道具各画各的，这种不一致不报错、只能看图发现。
     点列都按 +x 侧给，-x 侧靠 `side` 镜像。
       back 负手（默认）：肩头→肘后外顶→前臂内收 35°→拢手，另挂垂布到膝
       read 捧卷：肘外张、前臂收到胸前书卷两端（卷在 y=1.04 / z=0.15 / x=±0.23）
       take 持盏：右手前举到茶盏（盏在 x=0.15 / y=0.96 / z=0.12），只用于茶姿的右侧 */
  const SLEEVE = {
    back:  { pts: [[0.180, 1.15, 0.030], [0.275, 0.99, -0.105], [0.098, 0.81, -0.215], [0.052, 0.72, -0.228]],
             drape: true },
    read:  { pts: [[0.180, 1.150, 0.030], [0.215, 0.950, 0.045], [0.195, 0.990, 0.130], [0.175, 1.020, 0.200]],
             drape: false },
    take:  { pts: [[0.180, 1.15, 0.030], [0.240, 1.035, 0.030], [0.198, 0.975, 0.100], [0.150, 0.960, 0.128]],
             drape: false },
  };
  for (const side of [-1, 1]){
    const A = SLEEVE[pose === 'read' ? 'read' : (pose === 'tea' && side > 0 ? 'take' : 'back')];
    const V = ([ax, ay, az]) => new THREE.Vector3(side * ax, ay, az);
    const sl = new THREE.CatmullRomCurve3(A.pts.map(V));
    g.add(mesh(new THREE.TubeGeometry(sl, 9, 0.065, 6, false), ink, { name:'scholarSleeve' }));
    // 肘尖（第五轮根因：肘球 0.062 < 袖管 0.065，完全埋在袖里 —— 沿点列第 2 点外移突破袖缘）
    const elbow = mesh(new THREE.SphereGeometry(0.055, 8, 7), ink, { name:'scholarElbow' });
    elbow.position.set(side * A.pts[1][0] * 1.16, A.pts[1][1], A.pts[1][2]);
    g.add(elbow);
    if (A.drape){
      // 垂布：自肘下向膝上垂落，起点离袖身留 2~3cm 缝隙（背光下才读得出层次）
      const dr = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.150, 0.90, -0.16),
        new THREE.Vector3(side * 0.145, 0.70, -0.155),
        new THREE.Vector3(side * 0.132, 0.50, -0.135),
      ]);
      g.add(mesh(new THREE.TubeGeometry(dr, 7, 0.048, 5, false), ink, { name:'scholarDrape' }));
    }
    // 袖口聚团 + 浅色袖口环（贴在袖管末端的实际位置，不再假设手在身后）
    const [hx, hy, hz] = A.pts[3];
    const clump = mesh(new THREE.SphereGeometry(0.058, 8, 7), ink, { name:'scholarClump' });
    clump.position.set(side * hx, hy, hz);
    clump.scale.set(1.25, 0.9, 0.85);
    g.add(clump);
    const cuff = mesh(new THREE.TorusGeometry(0.040, 0.007, 5, 10), inkLight, { name:'scholarCuff' });
    cuff.position.set(side * hx, hy - 0.028, hz - 0.006);
    cuff.rotation.y = Math.PI / 2;
    cuff.rotation.x = A.drape ? 0.4 : 1.2;
    g.add(cuff);
  }
  // 头 + 发髻 + 簪（低头回调 14°：20° 在俯拍机位读作"俯身"）
  const headG = new THREE.Group();
  headG.position.set(0, 1.445, 0.03);
  headG.rotation.x = 0.24;
  headG.add(mesh(new THREE.SphereGeometry(0.086, 14, 11), hair, { name:'scholarHead' }));
  const knot = mesh(new THREE.SphereGeometry(0.030, 8, 7), hair, { name:'scholarKnot' });
  knot.position.set(0, 0.098, -0.020);
  knot.scale.set(1, 0.95, 1);
  headG.add(knot);
  /* 簪（第五轮根因：4mm 簪径在 1.5m 视距只有 2px，被抗锯齿吃掉 —— 不是变换问题）。
     加粗到 16mm（风格化簪）+ 两端簪头珠（0.02m，4~5px 可读），"常见机位一头可见"达标 */
  const pinMat = new THREE.MeshStandardMaterial({ color:0xC9CDB8, roughness:0.6, metalness:0.0, envMapIntensity:0.5 });
  const pin = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.132, 5), pinMat, { name:'scholarPin' });
  pin.rotation.order = 'ZYX';
  pin.rotation.set(0, 0.55, Math.PI / 2 + 0.14);   // 近水平（俯仰 8°），斜偏 30°
  pin.position.set(0.008, 0.096, -0.022);
  headG.add(pin);
  const pinAxis = new THREE.Vector3(-0.824, -0.122, 0.505);
  for (const e of [-1, 1]){
    const bead = mesh(new THREE.SphereGeometry(0.010, 6, 5), pinMat, { name:'scholarPinBead' });
    bead.position.set(0.008 + pinAxis.x * 0.066 * e, 0.096 + pinAxis.y * 0.066 * e, -0.022 + pinAxis.z * 0.066 * e);
    headG.add(bead);
  }
  root.add(headG);            // ⚠️ 头挂 root（不挂 g）：不能跟着躯干的椭圆缩放一起被压扁
  // 呼吸相位 + 不参与合并（要每帧微动）
  /* ⚠️ 这三行必须挂 **root**（figures 里存的就是 root）：挂 g 的话
     ① 渲染循环读 `f.userData.robe.scale` 会 undefined 崩、
     ② `root.traverse` 改成 `g.traverse` 会漏掉挂在 root 上的头 →
        头/发髻/簪不是 noMerge，会被 mergeStatics 并进静态大网，人一动头就留在原地。 */
  root.userData.breathPhase = Math.random() * TAU;
  root.userData.robe = robe;
  /* 日程道具（第十四轮：人物随时间/天气切换举止 —— 用户要求）
     pose: 'read' 执卷读书 / 'tea' 端盏品茗 / 默认负手
     道具尺寸按 3~4m 视距定：盏/卷径 4~5cm 在实物比例下偏小，为可读性放大到
     最大边 ~18cm 且用 inkLight 浅玉色 + 微自发光，白天/傍晚都压得住背景 */
  if (pose === 'read'){
    /* 执卷读书：一卷浅色书卷横于胸前（长 0.46、径 0.05，算上把手在 3m 外约 8px）。
       ⚠️ z 必须 ≥ 0.20：袍身 y=1.04 处的前表面在 z=0.172（交领又外凸到 0.187），
       原来写 0.15 → 卷轴埋在胸口里，只露出半根"横杠"。手的位置（SLEEVE.read）与这里绑死，改一处必须同步。 */
    const vol = mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.46, 8), inkLight, { name:'scholarScroll', cast:false });
    vol.rotation.z = Math.PI / 2;
    vol.position.set(0, 1.035, 0.205);
    g.add(vol);
    const knobL = mesh(new THREE.SphereGeometry(0.022, 6, 5), inkLight, { name:'scholarScrollKnob' });
    knobL.position.set(-0.25, 1.035, 0.205);
    g.add(knobL);
    const knobR = mesh(new THREE.SphereGeometry(0.022, 6, 5), inkLight, { name:'scholarScrollKnob' });
    knobR.position.set(0.25, 1.035, 0.205);
    g.add(knobR);
    headG.rotation.x = 0.42;                        // 低头读书
  } else if (pose === 'tea'){
    /* 端盏品茗：浅色茶盏（径 0.07）前举至胸前，面对池面（yaw 由调用方给定）。
       ⚠️ z 同样必须外移：原来盏在 0.12、拢手球前缘在 0.177 —— 盏**在手的后面**，
       门禁从正前方打射线首个命中是手，读作"端着空气"。盏要露在手前（SLEEVE.take 与这里绑死）。 */
    const cup = mesh(new THREE.CylinderGeometry(0.035, 0.027, 0.042, 8), inkLight, { name:'scholarCup', cast:false });
    cup.position.set(0.15, 0.960, 0.185);
    cup.rotation.z = 0.18;
    g.add(cup);
    const saucer = mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.016, 8), inkLight, { name:'scholarSaucer', cast:false });
    saucer.position.set(0.15, 0.925, 0.185);
    g.add(saucer);
    const steam = mesh(new THREE.SphereGeometry(0.018, 5, 4), inkLight, { name:'scholarSteam', cast:false });
    steam.position.set(0.15, 1.030, 0.185);
    steam.scale.set(1, 1.6, 1);
    g.add(steam);
    headG.rotation.x = 0.18;                        // 微俯视盏
    root.rotation.z = 0.02;   // ⚠️ 挂 root：躯干层 g 上还有椭圆缩放，写在 g 上会变成"两层各歪一点"
  }
  root.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });
  figures.push(root);
  return root;
}
/* 人物日程（第十四轮：用户要求"人物造型和动作跟随时间和天气变化"）——
   · 上午 7:30~12:00  执卷读书（北岸近水，读到兴起背手抬眼观景）
   · 下午 12:00~18:00 端盏品茗、面池赏鱼（水榭临水平台）
   · 晚上 18:00~23:00 沿游廊散步（userData.stroll 让他在 animate 里来回缓行）
   · 天气门禁：刮风下雨下雪（storm/snow/winterrain）不出现 —— 雨天文人躲屋里，合理
   摆位守"留白"律：人物衬水面/游廊梁柱（亮背景），不贴深色石。 */
const D_SCHEDULES = [
  { pose:'read',  skin:'indigo',  x: 1.2, z: -5.7, yaw: 0.42, s: 1.0,   // 先生晨课于远香堂前草坪（前墙 z≈-8.8 以南）
    // 第六轮：原 yaw=0 是正面朝池的平板站姿（正对镜头 → 只读到一个色块）；
    // 改为侧身 24°，做"半围"阵型的中心，同时让衣缘/袖形在侧光下读得出来。
    // 坐标与两书童的朝向表达式绑死（童子的 atan2 参数就是按这个点算的），挪位必须同步改。
    h0: 7.5, h1: 12.0,
    stroll: null },
  { pose:'tea',   skin:'moss',    x: 15.3, z: 5.4, yaw: Math.atan2(-15.3, -2.4), s: 1.02,   // 面朝池心赏鱼（水榭平台，非草坪 → 可用绿色系）
    h0: 12.0, h1: 18.0,
    stroll: null },
  { pose:'observe', skin:'lily',  x: 13.4, z: 1.0, yaw: Math.PI * 0.5, s: 1.0,
    h0: 18.0, h1: 23.0,
    stroll: { a: 13.4, b: 13.4, z0: 1.3, z1: -3.8, sp: 0.027 } },   // 沿游廊 z 缓行（0.55 m/s）
];
D_SCHEDULES.forEach((d, i)=>{
  const fg = makeScholar({ x: d.x, z: d.z, yaw: d.yaw, s: d.s, pose: d.pose, skin: d.skin });
  fg.userData.slot = { h0: d.h0, h1: d.h1, stroll: d.stroll };
  fg.userData.skin = d.skin;                 // 供 probe/figure-audit.mjs 读角色服色做门禁
  fg.userData.poseName = d.pose;
  world.add(fg);
});

/* 私塾孩童（第十六轮：用户要求"2 孩童 + 1 教书先生"场景）。
   makeChildScholar 是先生剪影的子集 —— 矮约 0.72 倍、头更大（孩童头身比 ~3.5:1）、
   袍身更短圆、无簪、无负手垂布，只剩简单垂袖。陪先生晨课，面向先生。 */
function makeChildScholar({ x = 0, z = 0, yaw = 0, s = 1, skin = 'moss' } = {}){
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  root.scale.setScalar(s);
  const g = new THREE.Group();                // 躯干层：椭圆截面（同成人，头不参与）
  g.scale.set(FIG_EW, 1, FIG_ED);
  root.add(g);
  const P = FIG_PALETTE[skin] || FIG_PALETTE.moss;
  const ink  = figMat(P.robe, 0.92);          // 童袍主色
  const hair = figMat(FIG_HAIR, 0.90);
  // 童袍：矮圆，微 A 形
  const prof = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.132, 0.01),
    new THREE.Vector2(0.152, 0.12),
    new THREE.Vector2(0.130, 0.42),
    new THREE.Vector2(0.118, 0.62),
    new THREE.Vector2(0.112, 0.80),
    new THREE.Vector2(0.090, 0.88),
    new THREE.Vector2(0.040, 0.94),
    new THREE.Vector2(0.001, 0.96),
  ];
  const robe = mesh(new THREE.LatheGeometry(prof, 14), ink, { name:'childRobe' });
  g.add(robe);
  // 童腰带（同成人：一道横带 = 最省成本的"衣服感"）；半径按 y=0.60 处袍半径 0.118 外放 8mm
  const cSash = mesh(new THREE.CylinderGeometry(0.124, 0.128, 0.05, 12, 1, true), figMat(P.sash, 0.88), { name:'childSash' });
  cSash.position.y = 0.60;
  g.add(cSash);
  // 童下摆衣缘（同先生：给"花瓶轮廓"一条终止线）
  const cHem = mesh(new THREE.CylinderGeometry(0.152, 0.143, 0.05, 14, 1, true), figMat(P.trim, 0.85), { name:'childHem' });
  cHem.position.y = 0.055;
  g.add(cHem);
  // 简单垂袖（孩童的袖子贴垂，不拢后）
  for (const side of [-1, 1]){
    const sl = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.115, 0.80, 0.02),
      new THREE.Vector3(side * 0.105, 0.55, 0.0),
      new THREE.Vector3(side * 0.080, 0.34, -0.02),
    ]);
    g.add(mesh(new THREE.TubeGeometry(sl, 5, 0.042, 5, false), ink, { name:'childSleeve' }));
  }
  /* 童交领（第六轮）：与先生同款构件 —— 童装也是交领，缺了同框会看出"两种衣服" */
  for (const side of [-1, 1]){
    const pts = [[0.030, 0.900], [0.020, 0.800], [0.004, 0.700], [-0.016, 0.660]];
    const lapel = new THREE.CatmullRomCurve3(pts.map(([ax, y]) => {
      const x = side * ax, r = profR(prof, y) + 0.010;
      return new THREE.Vector3(x, y, Math.sqrt(Math.max(r * r - x * x, 0.0004)));
    }));
    g.add(mesh(new THREE.TubeGeometry(lapel, 10, 0.013, 5, false), figMat(P.trim, 0.85), { name:'childLapel' }));
  }
  // 大头 + 双总角（孩童发髻：两小揪，不是成人单髻）
  const headG = new THREE.Group();
  headG.position.set(0, 1.02, 0.02);
  headG.rotation.x = 0.10;
  headG.add(mesh(new THREE.SphereGeometry(0.075, 12, 10), hair, { name:'childHead' }));
  for (const side of [-1, 1]){
    /* 双总角（第六轮）：原 r=0.026 / ±0.030 / y=0.085 —— 剪影上是两个**带 V 形缺口的小圆包**，
       在 2.5m 视距（样张 10a）直接读成"耳朵"。修法：加大到 0.030、上移、向中线靠拢到 ±0.024，
       两球产生约 1.2cm 交叠 → 合成"头顶一团发"而不是两侧两只耳；
       同时保证内缘嵌进头球 2cm（不悬空）、离顶只凸出 3.9cm（不变成天线）。 */
    const top = mesh(new THREE.SphereGeometry(0.030, 8, 7), hair, { name:'childTopKnot' });
    top.position.set(side * 0.024, 0.080, -0.008);
    headG.add(top);
  }
  root.add(headG);            // ⚠️ 头挂 root（不挂 g）：不参与躯干椭圆缩放
  root.userData.breathPhase = Math.random() * TAU;   // 同先生：必须挂 root（figures 存的是 root）
  root.userData.robe = robe;
  root.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });
  figures.push(root);
  return root;
}
/* 两书童（第六轮 · 老黄选 B：改成"半围"阵型）。
   先生居中偏后侧身，两童在前左右各约 0.8m 处、身体**向内转 1/3 朝先生**。
   ⚠️ 内转比例是看图调出来的：首版转 55%（≈74°）→ 两人成了**纯侧影**，只剩一片薄色条，
   既丢了交领/腰带，"半围"也读成一个横排；转 1/3（≈43°）才是 3/4 侧身 ——
   交领、腰带、内向的肩线同时在，三个朝向各不相同才像"一群人"。
   ⚠️ 旧摆位的 yaw 把 atan2 的 x 写反了（`atan2(-0.6,-1.0)` 指向的是先生的**镜像方向**），
   实际两童是**背对先生**的，与注释"面朝先生"正好相反 —— 这种错不报错、不崩，只能看图发现。
   同样 7.5~12 时段出现、暴雨/风雪隐藏 —— 复用 D_SCHEDULES[0] 的 slot。 */
[{ x: 0.62, z: -5.10, yaw: 0.33 * Math.atan2( 0.58, -0.60), s: 0.90, skin:'celadon' },
 { x: 1.80, z: -5.25, yaw: 0.33 * Math.atan2(-0.60, -0.45), s: 0.78, skin:'ochre' }]
  .forEach((c)=>{
    const ch = makeChildScholar(c);
    ch.userData.slot = { h0: D_SCHEDULES[0].h0, h1: D_SCHEDULES[0].h1, stroll: null };
    ch.userData.skin = c.skin;
    ch.userData.poseName = 'child';
    world.add(ch);
  });

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
placeAssets('assets/LotusPlant.glb', 2.0, lotusSpots);
/* GLB 荷花丛补花梗（2026-09-17 用户："这个角度荷花没有杆"）：
   LotusPlant.glb 是**单 mesh + 一张贴图**（实测 1600 tri、native 高 1.918m），
   花与叶全烘进几何，花梗由不得代码。低视角看花像浮在叶丛上。
   ⚠️ 杆高必须**按实测的花位**定，不能拍脑袋（2026-09-17 用户："部分荷花依旧悬空，
   是不是杆的高度不对，没有和荷花接上"）。用 probe/glb-profile.mjs 量顶点高度剖面：
     · native y<0 → 叶片区（水平半径 0.2~1.0m，是摊开的叶盘）
     · native y=0.70~0.94 → **花瓣簇**（顶点数 400、水平半径仅 0.11m，典型的杯状花）
   归一化（×1.0428，底部对齐 y=0）后：花底 = (0.70+0.976)×1.0428 ≈ **1.748m**，
   而旧值 0.72×2.0 = 1.44m —— **短了 31cm**，花当然悬空。
   现在杆高取 1.78×s（超过花底 3cm、插进花心），下粗上细随真荷；
   抖动幅度压在 ±3% 以内，保证每根都落在花瓣簇里而不是又露出来。
   MAT.lily 与程序化荷杆同材质，冬季随 lilyShow 一起落。 */
/* 杆高系数独立成常量：杆在 mergeStatics 里被合并后**名字就丢了**，
   wind-audit.mjs 无法再从场景反查杆的顶点高度 —— 只能断言这个设计常量。
   改它之前请先用 probe/glb-profile.mjs 重新量一遍花位。 */
export const GLB_LOTUS_STEM_H = 1.78;
lotusSpots.forEach(s=>{
  const stemH = GLB_LOTUS_STEM_H * s.s * rr(0.98, 1.03);
  const stem = mesh(new THREE.CylinderGeometry(0.018, 0.034, stemH, 6), MAT.lily, { name:'glbLotusStem' });
  stem.position.set(s.x, stemH / 2, s.z);
  world.add(stem);
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
// 乌龟：池中缓游
export const swimTurtles = [];
loadAssetOnce('assets/Turtle.glb', 0.46, (src)=>{
  for (let i = 0; i < 2; i++){
    const h = new THREE.Group();
    h.add(src.clone(true));
    /* 泳龟每帧都在动。阴影改按需更新后，移动投射物会留下"冻结在半路的影子"——
       比没有影子更假；锦鲤本就关投影（loadAssetOnce 的 castShadow=true 只惠及静物），
       泳龟同口径。0.46 的尺寸也低于"小件不投影"的 1.1 阈值，只是它迟到躲过了那道遍历。 */
    h.traverse(o=>{ if (o.isMesh) o.castShadow = false; });
    h.userData = { orbit: i % KOI_ORBITS.length, t: rr(0, TAU), speed: rr(0.03, 0.07),
                   jitter: rr(0.7, 0.95), phase: rr(0, TAU) };
    markUnderwater(h);                 // 泳龟异步挂载：layer 不继承，进场景前补打折射层标记
    world.add(h);
    swimTurtles.push(h);
  }
  onAssetAttached();
});
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
    const hero = mesh(makeTaihuHeroGeo({
      height: 4.5, baseR: 0.80, seed: 11, sink: sink, holeCount: 9, eyeRatio: 0.25,
      main: [0.70, 0.36], sec: [0.47, 0.22], bump: [0.24, 0.13],
      lean: [0.85, 1.10], biteN: 4, biteR: [0.42, 0.68], biteD: [1.05, 1.45],
      furrowMul: 1.10, foot: [0.95, 0.28],
    }), MAT.taihuHero, { name:'taihuHero' });
    hero.position.set(hx, 0, hz);
    hero.rotation.y = 0.62;
    hero.userData.noMerge = true;                  // ⚠️ 顶点色（AO/水线）会被几何合并丢掉
    markUnderwater(hero);                          // 同上：立峰站在池底上，水下段 1.24m
    world.add(hero);
    validateGeometry(hero.geometry, 'taihuHero');
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
       现在石已落地，按同一套「包围盒反算」把机位刷成精确构图（与同步装配时完全一致）。 */
    {
      const out2 = new THREE.Vector3(hx, 0, hz).normalize();
      const side2 = new THREE.Vector3(-out2.z, 0, out2.x);
      const bb2 = new THREE.Box3().setFromObject(hero);
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
    console.log('[特置立峰] 位置 (' + hx.toFixed(2) + ', ' + hz.toFixed(2) + ') 岸半径 ' + shoreR.toFixed(2)
                + ' 入土 ' + sink.toFixed(2) + 'm 面数 ' + hero.geometry.userData.tris
                + ' 法线一致率 ' + hero.geometry.userData.normalAgree
                + ' 连通分量 ' + hero.geometry.userData.islands
                + ' 苔痕 ' + (hero.geometry.userData.mossVerts || 0)
                + ' 透光缘 ' + (hero.geometry.userData.sssVerts || 0)
                + ' 用时 ' + (performance.now() - t0).toFixed(0) + 'ms');
  } catch (err){
    console.warn('[特置立峰] 生成失败，已跳过：', err && err.message);
  }
});

/* ── 导览机位（B：给立峰一个"专用观赏面"）──
   名石在园子里从来不是"一块石头"，而是"有名字、有座、有观赏位置的一景"。
   机位切换用平滑飞行（从当前画面出发，1.4s 缓出），不是瞬移；
   与 ENV 的过渡同源，键盘 Z 巡览、面板按钮直达。 */
export const CAM_FLY = { on: false, t: 0, dur: 1.4, from: null, to: null, minDist: null };
/* minDist：落位后要恢复的 OrbitControls 最小半径（机位自带则用它，否则回默认 9）。
   飞行途中把下限整体放开 —— 否则从远处飞向"近观"机位时，controls.update() 会在半途
   把相机半径夹回 9m，路径被扯成"先到 9m 再贴上去"的折线。 */
export function flyTo(pos, target, dur = 1.4, minDist = null){
  CAM_FLY.from = { p: camera.position.clone(), t: controls.target.clone() };
  CAM_FLY.to   = { p: pos.clone(), t: target.clone() };
  CAM_FLY.minDist = minDist;
  CAM_FLY.t = 0; CAM_FLY.dur = dur || 1.4; CAM_FLY.on = true;
  controls.minDistance = 0.2;
}
export function updateCamFly(dt){
  if (!CAM_FLY.on) return;
  CAM_FLY.t = Math.min(1, CAM_FLY.t + dt / CAM_FLY.dur);
  const e = CAM_FLY.t < 0.5 ? 2 * CAM_FLY.t * CAM_FLY.t : 1 - Math.pow(-2 * CAM_FLY.t + 2, 2) / 2;
  camera.position.lerpVectors(CAM_FLY.from.p, CAM_FLY.to.p, e);
  controls.target.lerpVectors(CAM_FLY.from.t, CAM_FLY.to.t, e);
  if (CAM_FLY.t >= 1){
    CAM_FLY.on = false;
    controls.minDistance = CAM_FLY.minDist != null ? CAM_FLY.minDist : CAM_MIN_DIST;
  }
}

/* ── 开场运镜（2026-09-20 · 修复拆模块时的功能回归）──
   旧版单文件有「加载完成后约 7.5 秒：高远俯瞰 → 缓推至交付视角；任意交互即让位」。
   拆模块重写后这段丢了，打开就是一个静止机位 —— 第一眼的"电影感入场"没了。
   CAM_FLY 只支持单段飞行，这里另立一条多关键帧状态机：
     K0 云外俯瞰（池南上空，先看见全园布局：水院 / 远香堂 / 立峰）
       → K1 贴水南推（从池南上空掠过水面，立峰从画面左侧退过，直奔远香堂）
       → K2 交付机位（CAM_HOME，与按 0 复位的落点一致）。
   规矩（与 flyTo 同源）：
   · 飞行期间 controls.enabled=false —— 否则 OrbitControls 的拖拽/阻尼会和插值互相抢相机；
   · minDistance 临时放开到 0.2，落位（或取消）后恢复 CAM_MIN_DIST；
   · 任意 pointerdown / wheel / 键击立即让位（"带看"不是"锁死"，与巡游同一条语义）；
   · 探针（navigator.webdriver）不自动播：回归会拿到"正在飞"的相机，几十条机位/像素
     断言全漂；prefers-reduced-motion 是无障碍约定，也不播；
   · ?intro=1 强制播（给门禁），?intro=0 强制关。__garden 暴露 introStart/Cancel 供驱动。 */
const INTRO_KF = [
  { p: new THREE.Vector3(30, 34, 40),  t: new THREE.Vector3(0, 4.5, 2) },     // 云外俯瞰
  { p: new THREE.Vector3(0, 4.6, 12.2), t: new THREE.Vector3(-1, 3.2, -4) },  // 贴水南推（y=4.6 越过南岸石脊）
  { p: CAM_HOME.pos.clone(),           t: CAM_HOME.target.clone() },          // 交付机位
];
const INTRO_DUR = [2.6, 2.8];           // 共 5.4s：起幅从容，推进略带加速
export const INTRO = { on:false, seg:0, t:0 };
export function introActive(){ return INTRO.on; }
export function introStart(){
  INTRO.on = true; INTRO.seg = 0; INTRO.t = 0;
  controls.enabled = false;
  controls.minDistance = 0.2;
  /* 起幅瞬间跳到 K0：首帧在 CAM_HOME 渲的、loading 层此时还在 0.7s 淡出里，跳切被遮住 */
  camera.position.copy(INTRO_KF[0].p);
  controls.target.copy(INTRO_KF[0].t);
  controls.update();
  return true;
}
export function introCancel(){
  if (!INTRO.on) return false;
  INTRO.on = false;
  controls.enabled = true;
  controls.minDistance = CAM_MIN_DIST;
  controls.update();
  return true;
}
export function updateIntro(dt){
  if (!INTRO.on) return;
  const a = INTRO_KF[INTRO.seg], b = INTRO_KF[INTRO.seg + 1];
  INTRO.t = Math.min(1, INTRO.t + dt / INTRO_DUR[INTRO.seg]);
  const e = INTRO.t < 0.5 ? 2 * INTRO.t * INTRO.t : 1 - Math.pow(-2 * INTRO.t + 2, 2) / 2;
  camera.position.lerpVectors(a.p, b.p, e);
  controls.target.lerpVectors(a.t, b.t, e);
  if (INTRO.t >= 1){
    INTRO.seg++; INTRO.t = 0;
    if (INTRO.seg >= INTRO_KF.length - 1){
      INTRO.on = false;
      controls.enabled = true;
      controls.minDistance = CAM_MIN_DIST;
    }
  }
}
const INTRO_FORCE = (()=>{ try { return /[?&]intro=1/.test(location.search); } catch { return false; } })();
const INTRO_OFF   = (()=>{ try { return /[?&]intro=0/.test(location.search); } catch { return false; } })();
export function introMaybeAuto(){
  if (INTRO_OFF) return false;
  if (PROBE_DRIVEN && !INTRO_FORCE) return false;
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* 老浏览器 */ }
  if (reduce && !INTRO_FORCE) return false;
  return introStart();
}
/* 任意交互即让位。pointerdown 用捕获阶段，保证与"点击水面涟漪"同时收到
   （涟漪的 pointerup 会读 introActive 决定要不要放弃这一击）。 */
renderer.domElement.addEventListener('pointerdown', introCancel, true);
renderer.domElement.addEventListener('wheel', introCancel, { passive:true, capture:true });
addEventListener('keydown', introCancel, true);
export const VIEWPOINTS = (()=>{
  const hp = HERO_POS || new THREE.Vector3(-4.7, 0, 8.0);
  const out = new THREE.Vector3(hp.x, 0, hp.z).normalize();
  const side = new THREE.Vector3(-out.z, 0, out.x);
  /* 机位距离**按包围盒与 FOV 反算**，不写死。手写距离的教训：6.4m 时立峰切顶、
     石刻小到读不出；11.5m 仍偏紧。构图要的是"石 + 座 + 碑 + 倒影"四样都在框里，
     那就用几何自己算：所需视高 /(2·tan(fov/2)) ×余量。 */
  let hb = null;
  world.traverse(o => { if (o.name === 'taihuHero') hb = o; });
  let dist = 14.0, camY = 1.45, aimY = 2.6;
  if (hb){
    const bb = new THREE.Box3().setFromObject(hb);
    const need = (bb.max.y - bb.min.y) * 0.72 + 2.6;                 // 石高（含水下）+ 底座与留白
    dist = (need / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.5;
    camY = 1.35 + (dist - 12) * 0.10;                               // 越远越要抬一点，避免俯视水线
    aimY = bb.max.y * 0.46;
  }
  return [
    { id:'hero', label:'立峰·云根',
      pos: new THREE.Vector3(hp.x - out.x * dist + side.x * dist * 0.20, camY,
                             hp.z - out.z * dist + side.z * dist * 0.20),
      target: new THREE.Vector3(hp.x, aimY, hp.z) },
    /* 「云根」近观：真正的位姿在**题名石装配的延迟批里**按实测几何回填
       （与立峰机位同源的"反算不写死"原则，见 heroStones 末尾那段）。
       这里先给一个同侧兜底值：机位从第一帧起就存在，选择器/巡游不会取到空。
       minDist 必须显式放开 —— 字心前 2.8m 远小于默认下限 9m，不放就会被弹回去。 */
    { id:'stele', label:'云根近观',
      pos: new THREE.Vector3(hp.x - out.x * 6, 1.6, hp.z - out.z * 6),
      target: new THREE.Vector3(hp.x, 1.0, hp.z),
      minDist: 2.2 },
    { id:'hall', label:'远香堂',
      pos: new THREE.Vector3(0.5, 4.6, 5.0), target: new THREE.Vector3(0, 3.6, -12.0) },
    { id:'pavilion', label:'荷风四面',
      pos: new THREE.Vector3(5.6, 3.2, -1.2), target: new THREE.Vector3(14.0, 3.0, 6.4) },
    { id:'overview', label:'全园',
      pos: CAM_HOME.pos.clone(), target: CAM_HOME.target.clone() },
  ];
})();
export function gotoViewpoint(id){
  const v = VIEWPOINTS.find(x => x.id === id);
  /* ⚠️ 必须把机位自带的 minDist 交给 flyTo：近观机位离目标 2.86m，远小于默认下限 9m，
     不放开的话相机落位瞬间就被 controls.update() 沿**视线方向**推到 9m ——
     方位完全正确、行程走完、也不报错，只有量落位后的真实距离才看得出来（probe/stele-station）。 */
  if (v) flyTo(v.pos, v.target, 1.4, v.minDist || CAM_MIN_DIST);
  return !!v;
}

/* ── P2-2 带字幕巡游 ──
   在既有 gotoViewpoint/flyTo 之上加一层"按序自动走 + 每站出字幕"：
   · 顺序 hero → stele → hall → pavilion → overview，首站从当前画面飞过去（flyTo 语义不变）；
   · 每站停留 dwell（默认 6s，含 1.4s 飞行），字幕在飞行开始即出（边飞边读）；
   · 用户一接管（pointerdown/wheel/任意导览键/时辰滑杆）即停巡游并收字幕 —
     巡游是"带看"，不是"锁死"，接管权永远在用户手里；
   · __garden 暴露 tourStart/tourStop/tourState 供探针驱动与断言。 */
const TOUR_CAPTIONS = {
  hero:     { title: '立峰 · 云根', text: '古人谓石为云之根 —— 池南水际一峰特置，瘦皱漏透，配石矶底座与岸上题名「云根」。' },
  stele:    { title: '题名石 · 云根', text: '峰侧一块卧石半埋岸土，石面刻「云根」二字。云出石中，石即是根 —— 名字就写在石头上。' },
  hall:     { title: '远香堂', text: '拙政园中区主厅 —— 四面厅，荷风四面，香远益清。夏日荷香满堂，即是此景。' },
  pavilion: { title: '荷风四面', text: '临水水榭 —— 三面临水，一面接岸。午后到这里听雨，雨点打在荷叶上最响。' },
  overview: { title: '全园', text: '一池三山式水院 —— 水居其半，建筑临水，假山作屏。晨雾与暮色最见层次。' },
};
const TOUR_ORDER = ['hero', 'stele', 'hall', 'pavilion', 'overview'];
export const TOUR = { on: false, idx: 0, dwell: 6.0, wait: 0 };
export const captionEl = () => document.getElementById('caption');
export function showCaption(id){
  const el = captionEl(), c = TOUR_CAPTIONS[id];
  if (!el || !c) return;
  el.querySelector('b').textContent = c.title;
  el.querySelector('span').textContent = c.text;
  el.classList.add('show');
}
export function hideCaption(){
  const el = captionEl();
  if (el) el.classList.remove('show');
}
export function tourStop(){
  TOUR.on = false; TOUR.wait = 0;
  hideCaption();
  syncTourBtn();
}
export function tourStart(){
  TOUR.on = true; TOUR.idx = 0; TOUR.wait = 0;
  stepTour();
}
function stepTour(){
  if (!TOUR.on) return;
  const id = TOUR_ORDER[TOUR.idx % TOUR_ORDER.length];
  showCaption(id);
  gotoViewpoint(id);
  TOUR.wait = TOUR.dwell;      // 含飞行 1.4s：字幕边飞边读，站后纯停 ≈ dwell-1.4
  syncTourBtn();
}
function syncTourBtn(){
  const b = envEl && envEl.querySelector('button[data-act="tour"]');
  if (!b) return;
  b.classList.toggle('on', TOUR.on);
  b.setAttribute('aria-pressed', TOUR.on ? 'true' : 'false');
  b.textContent = TOUR.on ? '停■' : '巡游▸';
}
export function updateTour(dt){
  if (!TOUR.on) return;
  /* 飞行中不计时：等 CAM_FLY 落定再数停留，避免低帧机器上"还没飞到就切下一站" */
  if (CAM_FLY.on) return;
  TOUR.wait -= dt;
  if (TOUR.wait <= 0){ TOUR.idx++; stepTour(); }
}
/* 用户接管即停：拖拽/滚轮/触屏/导览按钮/键盘导览键 —— 但不明信片/音景按钮不截停。 */
export function tourUserTakeover(){
  if (TOUR.on) tourStop();
}

/* ── 以下两块来自 09-lights.js 的模块顶层（本轮拆模块时移回这里）──
   它们在原文件里就紧跟在 §8 组装之后（原 §9 段首），搬回去即保持原时序。
   为什么必须放在 08 的 body 里：两者操作的都是 world，而 world 定义在本模块顶部；
   09 又要 export mergeStatics / validateGeometry 给本模块用 —— 若把这两句留在 09 顶层，
   就构成"08 等 09 求值完 / 09 等 08 求值完"的环，ESM 直接给 TDZ。 */

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
