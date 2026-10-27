// 06l-orchard.js — 由 06i-trees.js 按职责整块搬出（纯搬家，逐字节未改）。
// 旱生乔木花卉：桃 / 梅（三态：花·苞·凋）/ 廊下兰草，以及桃树挂灯的实例网格。
// 梅与桃共用 makePeachTree 骨架（opts 开关控制）；本文件不含水生与芭蕉。
import { THREE, mergeGeometries } from '../vendor.js';
import { mulberry32, TAU } from './00-config.js';
import { tubeRadiusRamp } from './06k-willow.js';
import { MAT } from './01-materials.js';
import { mesh } from './03-factory.js';
/* ⚠️ 依赖方向必须走叶子模块：06-vegetation.js 门面会 import 本文件（经 06i-trees），
   若反过来从门面取几何工厂就成环，将来谁在顶层调用会 TDZ 白屏。2026-10-27 修正。 */
import { makeTreeLanternGeo, treeLanternColor, makePeachLeafGeo, makePeachFlowerGeo, makePlumWitheredGeo, makePlumBudGeo, makePeachFruitGeo, makePlumFlowerGeo, makeReedBladeGeo } from './06c-organs.js';
export const treeLanternInsts = [];
/* 梅树的花苞网格（2026-10-08）：与花分开一份几何/材质，门禁按 `plumBuds` 名字或这份清单找得到
   （项目惯例：新加的网格要能**显式**被探针拿到，别让它去 traverse 猜）。 */
export const budMeshes = [];
/* 凋谢花的网格清单（2026-10-08）：与花苞同理，显式暴露给探针/门禁（别让它去 traverse 猜）。 */
export const witheredMeshes = [];
/* 材质：MeshBasic + toneMapped:false —— 自发光色直接进 bloom，不吃光照也不被色调映射压暗。 */
export const TREE_LANTERN_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false,
                                                            transparent: true, opacity: 0.95,
                                                            depthWrite: false });
export const MATB = { treeLantern: TREE_LANTERN_MAT };

/* ⚠️ `baseY`（2026-09-23 新增 · 老黄第三轮指认）：南岸那株实测树脚四周的可见表面在
   y = 0.40~1.03（太湖石串 + 埋脚鼓包围成一只"碗"），而树基固定在 y=0、主干只到 1.87m
   ⇒ **主干下半截连同分叉点一起埋进这圈隆起**，露出来的只剩主枝中上段。老黄看得准：
   "它的根和枝都是石头或者草皮中长出来的，而不是一个主枝干，再分支的正常形态。"
   对策：把整树抬到隆起之上（baseY），并让主干**向下加长**穿进土里（见 trunkCurve 第一点），
   免得抬起来之后树底悬空。根盘跟着树走 —— 树长在丘顶，根颈就在丘顶，这是自然的。 */
export function makePeachTree(x, z, scale = 1, baseY = 0, opts = {}){
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.scale.setScalar(scale);
  /* ⚠️ 本树自带随机流（种子由坐标决定）：园子的全局 rnd/rr 是**一条**可复现流，
     但桃树建在 deferBoot 的延迟任务里 —— 异步资产回调/别的延迟任务先后耗尽它的抽样数，
     树的形状就会随加载时序漂移。实测：同一份代码连开两次，主干高 2.77m vs 2.92m、
     叶包围盒也不同（见 outputs/_diag/_peach-determinism.mjs）—— 于是所有"改前改后"的数字
     都夹着一层"换了一棵树"的噪声。自带流之后，树的形状与加载时序彻底解耦。
     ⚠️ 声明必须在第一次抽样（H）之前 —— 否则 TDZ 直接抛错。 */
  const R2 = mulberry32((Math.round(x * 1000) * 73856093) ^ (Math.round(z * 1000) * 19349663)
                        ^ (Math.round(scale * 1000) * 83492791));
  const rr2 = (a, b) => a + R2() * (b - a);
  const i2 = (n) => (R2() * n) | 0;
  const H = 4.2 * rr2(0.92, 1.08) * (opts.heightMul || 1);   // 桃较柳矮：观花小乔木（梅传 heightMul 更高）
  /* ⚠️ 主干半径 0.150 → 0.100（2026-09-22 二轮重建）：老黄实拍样张里主干是一根 ~0.44m 粗的
     光杆，4m 高的桃树不该有这么粗的干（真实桃干径 0.12~0.20m）。根盘同步收小。 */
  const trunkR = 0.100 * rr2(0.94, 1.08);
  /* 冠心/冠半径：冠幅必须与**叶量预算**匹配 —— 4000 片 0.26m 的叶摊在 3.5m 宽的冠上只剩
     一层稀晕（实测 77% 的叶挤在半径 1m 内，冠外圈只摊到 23%，从外面看穿得透）。
     收到 0.34H（冠幅 ≈2.9m）后同样的叶量密度提高 ~1.5 倍。 */
  const canopyC = new THREE.Vector3(0, H * 0.64, 0);     // 冠心
  const R = H * 0.34 * (opts.canopyMul || 1);            // 冠半径（梅传 canopyMul 展得更开）
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(),
        _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(),
        _s = new THREE.Vector3(), _e = new THREE.Euler(),
        _up = new THREE.Vector3(0, 1, 0), _ax = new THREE.Vector3(),
        _basis = new THREE.Matrix4(), _bx = new THREE.Vector3(),   // 叶面定向用（见叶块）
        _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3(),
        _p4 = new THREE.Vector3(), _p5 = new THREE.Vector3();        // 簇生/贴枝面定向用（花：环向+径向）

  /* 主干：地面 → **低分叉点（0.48H）**，基部根盘隆起、向上渐细。
     ⚠️ 分叉点 0.66H → 0.48H（二轮重建）：桃的招牌是**低分叉的杯状骨架** ——
     主枝从 0.7~1.6m 就斜向外张成三四个大主枝，而旧版主干光杆一直顶到 2.8m 才分枝，
     远看就是"一根旗杆顶上插了几根枝"。
     半径剖面 r(t) = trunkR × (1 − 0.40t) × (1 + 0.38(1−t)^6)：
       t=0 → 1.38r（≈0.14，根盘）→ 中段 ≈1.0r → t=1 → 0.60r（≈0.06）—— 圆管且确实在收细。 */
  const trunkCurve = new THREE.CatmullRomCurve3([
    /* ⚠️⚠️ 2026-10-06 修「腊梅主干悬空」（老黄截图1：树干整根停在雪面上方、底端与雪面有空隙）：
       这一行原来是 `-0.06 - baseY` —— 它假定 baseY ≥ 0（桃树两株正是 0 与 0.45，向下加长
       以穿过隆起的土石层）。而梅是**按负地表**落地的（腊梅 baseY = −0.40），负号一进公式就翻向：
       −0.06 −(−0.40) = **+0.34** ⇒ 主干底端被抬到组原点**上方** 0.34m，而组本身坐在 −0.40
       ⇒ 树底离地约 0.34m，整根悬空（截图里"停在雪面上"就是这么来的）。
       ⇒ 改成 `-0.06 - Math.max(0, baseY)`：baseY ≥ 0 时逐字不变（桃树不受影响），
       baseY < 0 时不再加长（组已经落在地表上，底端自然埋进土里）。 */
    new THREE.Vector3(0, -0.06 - Math.max(0, baseY), 0),
    new THREE.Vector3(rr2(-0.05,0.05), H*0.18, rr2(-0.05,0.05)),
    new THREE.Vector3(rr2(-0.04,0.04), H*0.34, rr2(-0.04,0.04)),
    new THREE.Vector3(rr2(-0.03,0.03), H*0.48, rr2(-0.03,0.03)),
  ]);
  const TR_SEG = 16, TR_RAD = 10;
  const trunkGeo = tubeRadiusRamp(
    new THREE.TubeGeometry(trunkCurve, TR_SEG, 1, TR_RAD, false), trunkCurve, TR_SEG, TR_RAD,
    t => trunkR * (1 - 0.40 * t) * (1 + 0.38 * Math.pow(1 - t, 6)),
    { caps: 'both' });    // 端盖：修"鸟瞰主干 = 半圆环薄片"（无盖时俯视看进管心+背剔只剩半圈）
  /* ⚠️ 主干**不进 mergeStatics**（userData.noMerge）：它是这个园子里唯一会"静默塌成刀片"
     的构件 —— 手工锥化那版让主干上半段整圈塌掉，而 30 道门禁没有一道看得见：合并进世界材质桶
     之后连名字都没了，按名字根本量不到它。留它单飞换来"逐圈量半径"的能力，
     代价是 2 个 draw call / 640 tri（两株）。
     注意：枝与小枝仍然合并（它们同材质同变换，并进世界桶省 draw call，且不易静默变形）。 */
  /* ⚠️ 干系材质统一走 trunkMat（2026-10-09 · 老黄"主枝条也光滑像不锈钢"）：
     旧版只有主干用 opts.trunkMat，主枝/小枝/根颈/斜根全是写死的 MAT.trunk（桃的浅棕、
     无纹理）—— 梅传了 plumTrunk（深灰褐 + 树皮 bump）也只有主干生效，主枝照旧光滑浅色。
     ⇒ 定义一次 trunkMat，五处全用（桃不传 ⇒ 仍是 MAT.trunk，逐字不变）。 */
  const trunkMat = opts.trunkMat || MAT.trunk;
  const trunkMesh = mesh(trunkGeo, trunkMat, { name:'peachTrunk', cast:true });
  trunkMesh.userData.noMerge = true;
  g.add(trunkMesh);

  /* ── 根颈 + 不规则斜根（2026-09-23 重塑 · 老黄："桃/柳露根几乎一模一样，
     而且没有这种类似花瓣一样的根系"）──
     旧版是 6 块低模扁球**均匀绕一圈**（60° 间隔 + 长轴朝外）→ 标准放射花瓣/蒜瓣，
     还与柳树的 5 块同配方。真实桃树是**根颈自然外扩 + 若干条粗细不一的根斜插入土**：
     方位不成对称、长短不齐。故改为「一个根颈扁台 + 2~4 条锥形斜根」。
     ⚠️ rr2 消耗与原版**严格等量**（6 槽 × 2 次 = 12 次）—— 后面的主枝 / 小枝 / 叶 /
        花 / 果抽样逐位不变（§36.6 同族：只改"怎么用"，不改"用几次"）。 */
  const rootSeeds = [];
  for (let i = 0; i < 6; i++){
    rootSeeds.push({ a: (i / 6) * TAU + rr2(-0.62, 0.62),   // 抖动远大于 60° ⇒ 破掉均匀感
                     s: rr2(0.75, 1.30) });
  }
  /* ① 根颈：主干基部一圈低矮外扩 —— 读作"干脚自然变粗"，而不是"插了几块石头" */
  const rootFlare = mesh(new THREE.SphereGeometry(trunkR * 1.45, 12, 7), trunkMat, { name:'peachRootFlare', cast:true });
  rootFlare.position.set(0, 0.015, 0);
  rootFlare.scale.set(1.22, 0.40, 1.22);
  g.add(rootFlare);
  /* ② 斜根：条数由 s 筛出（不再多消耗随机数），从根颈斜向外下扎进土里 */
  const pickedRoots = rootSeeds.filter(o => o.s > 0.95);
  const nRoot = Math.max(2, pickedRoots.length);
  for (let i = 0; i < nRoot; i++){
    const o = pickedRoots[i];
    /* 桃是**浅根小乔木**：露根比柳树细得多、短得多，同样要"半埋"——
       第一版 r0 0.050·s / len 0.46·s 实测读作"一根粗香肠趴在地上"。 */
    const len = 0.34 * o.s, r0 = 0.032 * o.s;
    const wob = (o.s - 1.0) * 0.9;            // 由 s 派生偏摆（不再多消耗随机数 ⇒ rr2 仍是 12 次）
    const pts = [];
    for (let k = 0; k <= 3; k++){
      const t = k / 3, aa = o.a + wob * t * t;
      const rrad = trunkR * 0.7 + (len - trunkR * 0.7) * t;
      pts.push(new THREE.Vector3(Math.cos(aa) * rrad, 0.040 - 0.115 * t, Math.sin(aa) * rrad));
    }
    const rc = new THREE.CatmullRomCurve3(pts);
    g.add(mesh(tubeRadiusRamp(new THREE.TubeGeometry(rc, 12, 1, 7, false), rc, 12, 7,
                              t => r0 * (1 - 0.70 * t)), trunkMat, { name:'peachRoot', cast:true }));
  }

  /* 主枝：5~7 根，从主干 **0.16~0.38H**（低位）处分叉斜向上外张 —— 杯状骨架。
     半径基 0.041 → 梢 0.011（随干径同步收小；旧 0.050 的枝在细干上像插上去的）。
     全部并成**一个** mesh —— 同材质同变换，分成 5~6 个 mesh 只是白送 5~6 个 draw call。 */
  const nBranch = Math.round((5 + (i2(3))) * (opts.branchMul || 1));   // 主枝（梅传 branchMul 枝更多）
  const mainBranches = [];       // 保存曲线用于挂叶/花/果
  const branchGeos = [];
  const BR_SEG = 14, BR_RAD = 7;
  for (let i = 0; i < nBranch; i++){
    const a = (i / nBranch) * TAU + rr2(-0.35, 0.35);
    const y0 = H * rr2(0.16, 0.38);
    /* ⚠️ 2026-09-23 冬态重建（老黄截图红框：南岸那棵冬天像一把扫帚）：
       旧版 reach 与 tipY **各自独立**随机 —— 垂直升幅 tipY−y0 因此在 0.46~2.47m 之间乱跳，
       7 根主枝里总有几根仰角只剩 ~21°（几乎垂直上窜），冠层裂成"竖柱"；
       夏天叶/花/果把它糊住看不出来，**冬天叶落尽当场露馅**（老黄：'冬天一眼看出不正常'）。
       改为**由主枝实长 + 仰角**反算：桃树开心形主枝与水平成 40~52°，
       冠才朝外张成杯口，而不是几根竿子朝天。
       ⚠️ rr2 消耗次数与原版一致（reach + tipY 两次 → brLen + brAngle 两次），
          本地流后续抽样（upBias / 起点抖动）逐位不受影响。 */
    const brLen   = H * rr2(0.30, 0.40);                 // 主枝实长（范围按 peach-form-guard 反调：撑太大 → 叶摊薄，夏冠层 fill 掉到 0.50 以下）
    const brAngle = rr2(0.70, 0.91);                     // 与水平 40~52°
    const reach   = brLen * Math.cos(brAngle);           // 水平投影（落在冠半径方向）
    const tipY    = y0 + brLen * Math.sin(brAngle);      // 梢端高度 = 起点 + 垂直升幅
    const upBias = rr2(0.10, 0.30);   // 向上弯曲程度
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(rr2(-0.04,0.04), y0, rr2(-0.04,0.04)),
      new THREE.Vector3(Math.cos(a)*reach*0.35, y0 + H*upBias*0.4, Math.sin(a)*reach*0.35),
      new THREE.Vector3(Math.cos(a)*reach*0.7, tipY + H*upBias*0.2, Math.sin(a)*reach*0.7),
      new THREE.Vector3(Math.cos(a)*reach, tipY, Math.sin(a)*reach),
    ]);
    mainBranches.push(c);
    branchGeos.push(tubeRadiusRamp(
      new THREE.TubeGeometry(c, BR_SEG, 1, BR_RAD, false), c, BR_SEG, BR_RAD,
      t => 0.041 - 0.030 * t));
  }
  const brMesh = new THREE.Mesh(mergeGeometries(branchGeos, false), trunkMat);
  brMesh.name = 'peachBranch';
  brMesh.castShadow = true;
  g.add(brMesh);

  /* 二级小枝：从主枝**全长**长出（旧版只从 0.25~0.95 取点、5~8 根），更细更长，
     是挂叶/花/果的主要位置。同样并成一个 mesh —— 旧版 40~50 根小枝 = 40~50 个 draw call。 */
  const twigs = [];
  const twigGeos = [];
  /* 与 twigs 逐位对齐的**枝半径表**（2026-10-09 · 修"花悬空/穿模"）：
     花的挂点要贴在**枝面**上（枝心 + 本处半径），而不是拿一个固定偏移 ——
     梅枝半径 16mm→5mm 逐级变化，固定偏移必然两头都不对（细梢悬空、粗根埋进枝里）。
     存 {r0, r1}：局部半径 = r0 − r1·t。 */
  const twigRad = [];
  const TW_SEG = 6, TW_RAD = 5;
  for (const br of mainBranches){
    /* twigMul（2026-10-08）：梅要"枝条数量与分叉更多 ⇒ 花点满枝"（老黄："现实中的梅花
       不是这种密集型开放"，参照图是真实蜡梅/梅的**疏枝点花**）。桃不传 ⇒ 逐字不变。 */
    const nTwig = Math.round((8 + (i2(5))) * (opts.branchMul || 1) * (opts.twigMul || 1));
    for (let k = 0; k < nTwig; k++){
      const t = rr2(0.20, 0.96);
      const base = br.getPointAt(t);
      const tan = br.getTangentAt(t).normalize();
      // 小枝向外上方生长
      const a = rr2(0, TAU);
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = new THREE.Vector3()
        .addScaledVector(side, rr2(0.50, 0.90))
        .addScaledVector(_up, rr2(0.35, 0.75))
        .addScaledVector(tan, rr2(-0.10, 0.35))
        .normalize();
      /* ⚠️ 枝条长度（2026-10-08 老黄："通常我们看到的腊梅和红梅都是一个**细长的枝条**上
         （部分枝条和分叉可以再长一些）"）：梅 0.22~0.42 → **0.30~0.58**（更长、变化更大 ⇒
         有长有短才像"细长枝条"而不是一圈齐刷刷的短枝），管径也收细一档（13mm→11.5mm 起）。
         ⚠️ **桃树不传 `longTwig` ⇒ 逐字保持原样**（这一个函数是桃/梅共用的，长度一改，
            桃的株形也变 —— 老黄没要求动桃）。 */
      const len = opts.longTwig ? rr2(0.30, 0.58) : rr2(0.22, 0.42);
      const tip = base.clone().addScaledVector(dir, len);
      const mid = base.clone().addScaledVector(dir, len * 0.5);
      mid.y += rr2(0.02, 0.07);                 // 小枝稍微向上拱
      const twCurve = new THREE.CatmullRomCurve3([base.clone(), mid, tip.clone()]);
      twigs.push(twCurve);
      /* ⚠️ 枝径加粗（2026-10-09 · 参考图判读："单朵花径明显大于枝条直径（枝粗约为花径的
         1/4~1/5）"⇒ 花径 0.10m ⇒ 枝粗 20~25mm）。旧 11.5mm→8mm 只有花径的 1/8~1/10，
         多模态判"花浮在黑铁丝上"。梅（longTwig）加粗到 **16mm→11mm**；桃不传 ⇒ 逐字不变。 */
      const rad0 = opts.longTwig ? 0.016 : 0.013, rad1 = opts.longTwig ? 0.011 : 0.009;
      twigRad.push([rad0, rad1]);
      twigGeos.push(tubeRadiusRamp(
        new THREE.TubeGeometry(twCurve, TW_SEG, 1, TW_RAD, false), twCurve, TW_SEG, TW_RAD,
        s => rad0 - rad1 * s));
    }
  }
  /* ⚠️ 挂灯只看**二级枝**：下面的三级枝是 2026-10-08 新增的枝层，而 `treeLanterns` 的数量
     与 festival-guard / festival-lanterns-guard 的口径绑着 —— 不能被新枝层带着一起变。 */
  const baseTwigs = twigs.slice();
  /* ⚠️ 新增枝层必须**在 twigMesh 建之前**推进 twigGeos（并进同一个合并网格 ⇒ 仍只 1 个 draw call）。 */
  if (opts.subTwig){
    /* ── 三级枝（2026-10-08 新增 · 2026-10-09 二轮按老黄反馈重塑）───────────
       老黄 2026-10-09："末端（长花骨朵和开花）的细支直径再缩一倍，长度增加一倍，
       这样花骨朵和花就有足够的空间落位了"＋"树的中下部仍有大量枯枝，要么大量减少
       要么给这些枝也加上花朵"。
       ⇒ ① **长度 0.14~0.30 → 0.30~0.62（×2）**：末级枝更长 ⇒ 沿枝的停点更多、
          每根枝上能落下的花簇更多（花有地方站）。
          ② **直径 ÷2**（11mm→6mm 起 / 5mm→2.5mm 梢）：细枝才承得住"花裹枝"的形态
          （花径 0.10m，枝径 6mm 时花是枝的 16 倍粗 ⇒ 读作"花串挂在细枝上"）。
          ③ **每根二级枝的三级枝数 2~3 → 1~2（大量减少）**：枝少了，同样多的花
          摊到每根枝上的密度就高（配合 flowerN 翻倍 ⇒ 中下部枯枝被花盖住）。 */
    const parents = twigs.slice();
    for (const tw of parents){
      const nSub = 1 + (i2(2));
      for (let k = 0; k < nSub; k++){
        const t = rr2(0.25, 0.92);
        const base = tw.getPointAt(t);
        const tan = tw.getTangentAt(t).normalize();
        const a = rr2(0, TAU);
        const dir = new THREE.Vector3()
          .addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), rr2(0.35, 0.80))
          .addScaledVector(_up, rr2(0.30, 0.70))
          .addScaledVector(tan, rr2(0.05, 0.45))
          .normalize();
        const len = rr2(0.30, 0.62);              // ×2：末级枝更长（花有落位空间）
        const tip = base.clone().addScaledVector(dir, len);
        const mid = base.clone().addScaledVector(dir, len * 0.5);
        mid.y += rr2(0.01, 0.04);                 // 同样微微上拱
        const c = new THREE.CatmullRomCurve3([base.clone(), mid, tip.clone()]);
        twigs.push(c);
        twigRad.push([opts.longTwig ? 0.0055 : 0.008, opts.longTwig ? 0.0025 : 0.006]);   // 与下面的半径剖面逐位对齐
        twigGeos.push(tubeRadiusRamp(
          new THREE.TubeGeometry(c, TW_SEG, 1, TW_RAD, false), c, TW_SEG, TW_RAD,
          s => (opts.longTwig ? 0.0055 : 0.008) - (opts.longTwig ? 0.0025 : 0.006) * s));   // 末级枝：梅 5.5mm→3mm（÷2）/ 桃 8mm→2mm
      }
    }
  }
  const twMesh = new THREE.Mesh(mergeGeometries(twigGeos, false), trunkMat);
  twMesh.name = 'peachTwig';
  twMesh.castShadow = true;
  g.add(twMesh);

  /* ── 枯枝挂灯（2026-09-25 · 计划书 Phase 3 第 7 项方案B）────────────────────
     挂在**真实枝条**上：主枝取梢段、小枝取中后段，每处挂一盏下垂的小灯笼。
     挂点用本树自己的 R2 流（rr2）取样 ⇒ 与树形同源。
     ⚠️ 挂灯是**运行期开关**（灯会才显示），但几何在装配时一次建好：count=0 ⇒ three 不提交，
        零 draw call（与紫藤/桃叶的季节通道同一套路，见 12-env 的 applyPresence）。
     ⚠️ 挂灯是 `g` 的**子节点** ⇒ 树的位置/缩放/根盘基准自动继承，不会"灯浮在半空"。
     ⚠️ 这里用的是 rr2（本树私有流），**不碰共享 rnd** ⇒ 布局指纹基线不受影响。 */
  const hangPts = [];
  for (const br of mainBranches){
    const nH = 5 + (i2(3));                       // 主枝 5~7 处
    for (let k = 0; k < nH; k++){
      const t = rr2(0.45, 0.97);                  // 梢段：叶幕挡不到的地方才看得见灯
      hangPts.push(br.getPointAt(t).clone());
    }
  }
  for (const tw of baseTwigs){
    if (rr2(0, 1) < 0.55) continue;               // 一半小枝挂灯：太密会糊成一团
    hangPts.push(tw.getPointAt(rr2(0.45, 0.92)).clone());
  }
  if (hangPts.length){
    const inst = new THREE.InstancedMesh(makeTreeLanternGeo(), MATB.treeLantern, hangPts.length);
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    inst.userData.noMerge = true;                 // 实例色会被几何合并丢掉
    inst.userData.aoSkip = true;                  // 灯自身在发光，不进 GTAO 法线 pass
    inst.name = 'treeLanterns';
    inst.frustumCulled = false;
    const mm = new THREE.Matrix4(), pv = new THREE.Vector3(),
          qq = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1),
          upv = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < hangPts.length; i++){
      pv.copy(hangPts[i]);
      pv.y -= 0.15;                               // 从枝上垂下来（灯顶贴着枝）
      qq.setFromAxisAngle(upv, rr2(0, TAU));      // 每盏自转，避免"一模一样"
      mm.compose(pv, qq, sv);
      inst.setMatrixAt(i, mm);
      inst.setColorAt(i, treeLanternColor(rr2));
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    g.add(inst);
    treeLanternInsts.push(inst);
  }

  /* ── 挂点基建：沿木质枝条按**固定弧长**取样 ──
     枝有多长就有多少挂点，叶/花/果全部挂在这些点上（不再"每枝随机几片"）。
     旧版正是因此常年只挂到 379/600 —— 叶量由随机的枝数决定，`count` 声明 600 从未兑现。
     w = 该点分到的叶量份额：小枝是当年新梢、叶最多，主枝是骨架、只有零星叶。 */
  const woodPts = [];
  const sampleWood = (curve, spacing, w) => {
    const n = Math.max(2, Math.round(curve.getLength() / spacing));
    for (let i = 0; i <= n; i++){
      woodPts.push({ p: curve.getPointAt(i / n), tan: curve.getTangentAt(i / n).normalize(), w });
    }
  };
  for (const tw of twigs) sampleWood(tw, 0.024, 1.0);
  for (const br of mainBranches) sampleWood(br, 0.060, 0.45);

  /* 绕枝轴、方位角 a 的单位向量（用于"叶子朝枝的哪一侧长"） */
  const _perp = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  const aroundAxis = (tan, a) => {
    _pa.copy(_up);
    if (Math.abs(tan.dot(_pa)) > 0.92) _pa.set(1, 0, 0);
    _pb.crossVectors(tan, _pa).normalize();
    _pa.crossVectors(_pb, tan).normalize();
    return _perp.copy(_pa).multiplyScalar(Math.cos(a)).addScaledVector(_pb, Math.sin(a)).normalize();
  };
  /* 确定性打散（乘性散列，不用随机数 → 每次构建结果一致）：
     季节通道是按 `count` 截**前缀**的（春 peachShow=0.15 只显前 15%、秋果 0.7 显前 70%），
     不散开就会出现"春天的嫩叶全挤在头一根枝上""秋天掉的果全在南侧"。
     散开之后任何前缀在空间上都是均匀的。 */
  const spread = (arr) => arr
    .map((o, i) => ({ o, k: (i * 2654435761) % 4294967296 }))
    .sort((a, b) => a.k - b.k)
    .map(x => x.o);
  /* 槽位不够就按轮转从 pool 补足 —— 保证挂满声明数量，不再"声明 600 实挂 379" */
  const fillTo = (arr, target, pool) => {
    for (let i = 0; arr.length < target; i++) arr.push(pool[(i * 37) % pool.length]);
  };

  /* ── 冠层叶幕壳（canopyShell）──
     把叶子按"归一化椭球半径" q = |(p−冠心)/各半轴| 夹进 [SHELL_LO, SHELL_HI]，两个方向都管：
       · q > HI（甩到壳外的散叶）→ 收回壳面。桃冠的**轮廓**是这一层的包络，
         甩出去一片就能把"冠半径"撑大一圈，而门禁是按轮廓内命中率算的 —— 等于自己稀释自己。
       · q < LO（深埋冠心的叶）→ 推到壳内圈，填掉"枝与枝之间的空腔"。
     竖向半轴比水平小（CAN_B/CAN_A≈0.78）：桃是扁圆冠，真实桃的冠高本就小于冠幅，
     旧版叶子只在一条水平带上，正侧看就是"能看穿的煎饼"。 */
  const CAN_A = R;                        // 水平半轴（冠幅半径）
  const CAN_B = R * 0.84;                 // 竖向半轴（杯状骨架的冠比旧版更高瘦一点）
  const SHELL_LO = 0.30, SHELL_HI = 1.0;
  const SHELL_HI_FLOWER = 2.0;            // 花的宽松兜底（见下：花不按冠壳收）
  const _cs = new THREE.Vector3();
  /* ⚠️ `outwardOnly`（2026-10-08 · 梅专用）：只把**甩到壳外**的收回壳面，**不把冠内的推出去**。
     为什么：老黄说梅"开成了紫藤那种密集花串" —— 量出来的真因不是朵数，而是这条夹壳把
     **冠内**的花统统推到同一个椭球面上（实测最近邻中位 0.033m ＝ **0.19 倍花径**、
     1500 朵里 1421 朵与邻居挤在半朵之内）。真实梅是"花贴在自己那根枝上"，
     所以梅改成"只收外沿、不动冠内" ⇒ 花沿枝自然分布（间隔＝沿枝点距 0.10~0.22m），
     同时仍保住"不许顶出冠轮廓"这条（叶幕/轮廓由叶子负责）。 */
  const canopyShell = (p, outwardOnly = false) => {
    _cs.copy(p).sub(canopyC);
    const nx = _cs.x / CAN_A, ny = _cs.y / CAN_B, nz = _cs.z / CAN_A;
    const q = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (q < 1e-4) return p;
    const lo = outwardOnly ? 0 : SHELL_LO;
    /* ⚠️⚠️ 花**不再按冠壳收**（2026-10-09 三轮）：花已经精确挂在枝面上（见 placeBlossoms），
       枝伸到哪里花就跟到哪里 —— 这才是"每根枝上都有花"。旧的 `min(SHELL_HI=1.0, q)` 把
       壳外的花**全部吸回 q=1 的椭球面**：三级枝加长一倍（0.30~0.62）后大量花点在壳外
       ⇒ 花聚成中间一个球、壳外的长枝全秃（多模态实测判读："花聚成中间一个球、
       外围长枝是秃的""花不像沿枝的串"）。这里只留**宽松兜底 2.0** 防异常离群。 */
    const hi = outwardOnly ? SHELL_HI_FLOWER : SHELL_HI;
    const s = Math.min(hi, Math.max(lo, q));
    if (s === q) return p;
    return p.copy(_cs).multiplyScalar(s / q).add(canopyC);
  };

  /* ── 叶：桃叶互生，短枝上 3~4 片成簇 ── */
  const leafGeo = makePeachLeafGeo();
  const leafN = Math.round(4000 * (opts.leafMul || 1));
  const leafInst = new THREE.InstancedMesh(leafGeo, opts.leafMat || MAT.peachLeaf, leafN);
  leafInst.castShadow = true;
  const leafA = new THREE.Color(0x79B23E), leafB = new THREE.Color(0x44701F);

  const wTot = woodPts.reduce((s, o) => s + o.w, 0);
  const leafRaw = [];
  for (const o of woodPts){
    const n = Math.max(1, Math.round(leafN * o.w / wTot));
    for (let k = 0; k < n; k++) leafRaw.push(o);
  }
  fillTo(leafRaw, leafN, woodPts);
  const leafSlots = spread(leafRaw).slice(0, leafN);

  for (let i = 0; i < leafSlots.length; i++){
    const o = leafSlots[i];
    /* 叶从枝上斜向外上方长出（叶柄极短），方位角按黄金角错开 —— 互生叶序不是并排 */
    const lat = aroundAxis(o.tan, i * 2.39996 + rr2(-0.40, 0.40));
    const leafDir = lat.clone()
      .addScaledVector(_up, rr2(0.05, 0.35))
      .addScaledVector(o.tan, rr2(-0.15, 0.25))
      .normalize();
    _q.setFromUnitVectors(_up, leafDir);                  // 叶几何沿 +Y 生长
    _p.copy(o.p).addScaledVector(leafDir, 0.004);
    /* 冠层被夹进椭球"叶幕"壳层（见 canopyShell）：上下压扁（冠高 < 冠幅）、内外有界。
       这一步同时管两件事：① 把枝间的空隙填上 ② 把个别甩到壳外的叶子收回来 ——
       后者是**判据的必需**：门禁的冠半径取所有叶实例的最大水平半径，一片甩出去的叶
       就能把轮廓撑大一圈，再拿"轮廓内命中率"去除，等于自己稀释自己。 */
    canopyShell(_p);
    /* 叶面朝**冠外偏上**（叶向光）：叶几何的局部 ±Z 是叶面法线，把它对到"冠心→叶"的方向上
       （扣掉沿叶长的分量后正交化）。旧版是绕叶长轴**随机翻卷 0~2π** —— 一半的叶侧对视线
       只剩一条边，整冠读成"炸毛的刺球"，投影面积也白丢一半（门禁的遮挡率量的正是这个）。
       ⚠️ 法线必须与 _up 混合再正交化：纯径向法线会让**背阳那半边**整片发黑
       （实拍样张：冠层变成一颗深色尖刺球）；太阳在 50° 高，叶面偏上才接得到光。 */
    _ax.copy(_p).sub(canopyC).normalize();
    _ax.addScaledVector(_up, 0.85).normalize();
    _ax.addScaledVector(leafDir, -_ax.dot(leafDir));
    if (_ax.lengthSq() > 1e-8){
      _ax.normalize();
      _bx.crossVectors(leafDir, _ax).normalize();
      _q.setFromRotationMatrix(_basis.makeBasis(_bx, leafDir, _ax));
    }
    _q.multiply(_q2.setFromAxisAngle(_up, rr2(-0.55, 0.55)));   // 只留一点翻卷差异，不做全随机
    _s.setScalar(rr2(0.85, 1.25));
    _m.compose(_p, _q, _s); leafInst.setMatrixAt(i, _m);
    leafInst.setColorAt(i, leafA.clone().lerp(leafB, R2())
      .offsetHSL(rr2(-0.02,0.02), rr2(0,0.05), rr2(-0.05,0.05)));
  }
  leafInst.count = leafN;
  leafInst.instanceMatrix.needsUpdate = true;
  if (leafInst.instanceColor) leafInst.instanceColor.needsUpdate = true;
  g.add(leafInst);

  /* ── 花：春季先花后叶 —— 桃的花芽与叶芽同在短枝上（花芽先萌），故与叶同源取样。
     ⚠️ 花量 900 → 2000 → **3000**（2026-09-22 三轮，老黄："桃花再多 50%"）：
     900 朵挂在 2.6m 的冠上，实拍样张里只数得出 ~30 个粉点 —— 代码注释写着"花满树"，
     画面是"零星几朵"，又一处"状态对、画面不对"；2000 朵时近观已读得出满树花，
     再 +50% 是为了**在鸟瞰距离上也成团**（远处单朵只剩 1~2px，靠数量堆出可见的粉色体积）。
     单朵 12 tri，3000 朵 = 3.6 万 tri（全场 1.5M，可忽略）。
     并且花与叶走**同一套 canopyShell 壳层**：桃是**先花后叶**，盛花期冠里没有叶帮忙遮挡，
     花若全埋在枝心的位置就只剩几个点 —— 推到壳层才读得出"满树花"。 */
  const flGeo = opts.flowerGeo || makePeachFlowerGeo();
  const flN = opts.flowerN || 3000;          // 梅传 140（簇心）；桃用默认 3000
  const CL = !!opts.blossomCluster;           // 簇生开关（只给梅开；桃不传 ⇒ 逐字不变）
  const flInst = new THREE.InstancedMesh(flGeo, opts.blossomMat || MAT.peachBlossom, CL ? Math.ceil(flN * 3) : flN);
  const flA = opts.blossomA || new THREE.Color(0xFFE8F0), flB = opts.blossomB || new THREE.Color(0xF490B4);

  const twigPool = woodPts.filter(o => o.w > 0.9);
  const flRaw = [];
  /* ⚠️⚠️ 花的着生方式（2026-10-08 重写，老黄："梅花开出来紫藤这种花的效果，现实中的梅花不是
     这种密集型开放…把枝条数量和分叉再增加，每条枝条和分叉上的花苞和花朵如截图所示"）：
     旧写法 = 每条小枝 3~5 簇 × 每簇 1~3 朵挂在**同一个点**上（只差 8mm 花梗），
     加上 `fillTo` 又把不足的朵数用轮转重复堆在既有槽位 ⇒ 投影上就是一串一坨（紫藤感）。
     新写法 = **沿枝点花**，与真实梅一致：花单生或 2~3 朵并生于枝节、贴枝、无长梗；
        · 沿每根二级/三级枝按 0.10~0.22m 的**间隔**走（间隔按枝长给，末级枝短就 1~2 个点）；
        · 每个停点先掷一次"**留白**"（22% 跳过）⇒ 出现裸枝段，这正是"疏影横斜"的节奏；
        · 35% 的停点**并生第 2 朵**（真实梅常 2 朵并生，截图里也成对）；
        · 加点用枝长比例算，短枝自然少花、长枝多花（不再"每枝一律 3~5 簇"）。 */
  /* ⚠️ 每个花点带**枝编号** w（2026-10-09）：下面的取样要"按枝交错"，
     保证每一根枝都拿到花 —— 老黄："树的中下部仍有大量枯枝，要么大量减少要么给这些枝也加上花朵"。 */
  const pushStop = (curve, t, w) => {
    /* ⚠️ 存**该处的枝半径**（2026-10-09 三轮 · 修"花悬空/穿模"）：梅枝半径 16mm→5mm
       逐级变化，花若按固定偏移挂必然两头都不对（细梢 5mm 的枝挂到 1cm 外 = 悬空；
       粗根 16mm 的枝挂 1cm 外 = 仍贴着枝心附近）。挂点 = 枝心 + 本处半径 + 小贴面偏移
       （见 placeBlossoms 的 stemLo/stemHi）⇒ 花/苞都贴在**枝面**上。
       w ≥ 100000 是主枝梢端的点（没进 twigRad）⇒ 用 0.02 兜底（主枝半径 11~41mm）。 */
    const r = (w < 100000 && twigRad[w]) ? (twigRad[w][0] - twigRad[w][1] * t) : 0.02;
    flRaw.push({ p: curve.getPointAt(t), tan: curve.getTangentAt(t).normalize(), t, w, r });
  };
  for (let twi = 0; twi < twigs.length; twi++){
    const tw = twigs[twi];
    const L = tw.getLength();
    let s = rr2(0.04, 0.18) * L;                  // 梢端留一小段裸枝
    while (s < L * rr2(0.86, 1.0)){
      const t = s / L;
      if (rr2(0, 1) > 0.18) pushStop(tw, t, twi);  // 18% 留白（2026-10-09 参考图：节距 = 1~1.5 花径、枝被花裹成串）
      if (rr2(0, 1) < 0.35) pushStop(tw, Math.min(0.99, t + rr2(0.012, 0.030)), twi);   // 并生（花苞对）
      /* ⚠️ 节距收紧（2026-10-09 · 老黄给的参考图判读："节距大约等于 1~1.5 朵花的直径，
         使簇与簇之间只露出一点光枝，形成糖葫芦/穗状的串"）：花径 0.10m ⇒ 节距
         0.10~0.15m。旧 0.08~0.30 平均 0.19m 偏疏 ⇒ 多模态判"花均匀撒在枝上、
         读不成节点上的绒球"。收紧到 **0.06~0.17**（平均 ~0.11m，近的密、远的留缝）。 */
      s += rr2(0.06, 0.17);
    }
  }
  for (let bi = 0; bi < mainBranches.length; bi++){    // 主枝梢端也开花
    const br = mainBranches[bi];
    const n = 4 + (i2(4));
    for (let k = 0; k < n; k++){
      const t = rr2(0.55, 0.98);
      flRaw.push({ p: br.getPointAt(t), tan: br.getTangentAt(t).normalize(), w: 100000 + bi });
    }
  }
  /* fillTo 只是**兜底**：枝条够多时自然槽位已超过 flN，spread+slice 只做均匀抽稀，不会堆叠。
     ⚠️ 但"够不够多"必须**量**出来（2026-10-08）：自然槽位 < flN 时，fillTo 会按
     `pool[(i*37)%n]` 轮转把同一批点重复塞进来 ⇒ 一个点上落好几朵 ⇒ 投影上就是"花串"
     （老黄："开成紫藤那种效果"的机械原因之一）。所以把两个数挂到网格上，供探针/门禁读。 */
  const flNatural = flRaw.length;
  fillTo(flRaw, flN, twigPool);
  /* ⚠️ 取样 = **按枝长比例分配 + 沿枝均匀取样**（2026-10-09 三轮 · 老黄："树的中下部仍有
     大量枯枝，要么大量减少要么给这些枝也加上花朵"）：
     旧写法 `spread(flRaw).slice(0, flN)` 从全部停点里**随机抽** N 个 —— 自然停点 2535
     远多于声明朵数 800 ⇒ 只覆盖约三成枝段，没抽中的枝就是**光枝**（中下部枝多 ⇒ "大量枯枝"）。
     ⚠️ 也不能用"轮转按第 k 个停点取"：停点按 t 递增排列，轮转第 1 轮取的全是每根枝的
        **最基部**那个点 ⇒ 花全挤在枝根、枝梢照样秃（把枯枝从"整体"挪到"梢部"而已）。
     ⇒ 正解：每根枝先保底 1 个，余下按**枝的停点数占比**分配（停点间距相近 ⇒ 占比∝枝长），
        再在每根枝内部**按等分位置**取点 ⇒ 花沿每根枝从根到梢铺开，没有整根秃的枝。 */
  const flSlots = [];
  {
    const groups = new Map();
    for (const o of flRaw){
      const g = groups.get(o.w);
      if (g) g.push(o); else groups.set(o.w, [o]);
    }
    const lists = [...groups.values()];
    const total = flRaw.length || 1;
    let alloc = 0;
    const picks = lists.map(list => {
      const n = Math.max(1, Math.round(flN * (list.length / total)));
      alloc += n;
      return n;
    });
    /* 分配总和可能略偏离 flN（取整）—— 按比例微调：多了从最长的枝减、少了给最长的枝加 */
    let diff = alloc - flN;
    for (let i = 0; diff > 0 && i < 4000; i++){
      const idx = i % picks.length;
      if (picks[idx] > 1){ picks[idx]--; diff--; }
    }
    for (let i = 0; diff < 0 && i < 4000; i++){
      picks[i % picks.length]++; diff++;
    }
    for (let gi = 0; gi < lists.length; gi++){
      const list = lists[gi], n = picks[gi];
      for (let k = 0; k < n; k++){
        const idx = Math.min(list.length - 1, Math.round((k + 0.5) / n * list.length - 0.5));
        flSlots.push(list[Math.max(0, idx)]);
      }
    }
  }
  flInst.userData.flDeclared = flN;
  flInst.userData.flNatural = flNatural;
  flInst.userData.flFabricated = Math.max(0, flN - flNatural);   // >0 = 有朵数是"凑"出来的（会堆叠）

  /* ══ 三种状态按比例分（2026-10-08 · 老黄："总归有 60% 左右的花、30% 左右的苞（嫩黄色）、
        还有 10% 左右是开始凋谢的花（花苞枯黄），按这个比例来重新修改两株梅花的造型"）══
     槽位是同一批（`flSlots`，沿枝点生），按**生长顺序**分给三个网格（老黄给的真实梅资料：
     "花苞靠近枝梢，盛开花朵位于中部，凋谢花朵位于较低位置"）：
       打分 k = 1.25×（沿枝位置 t） + 相对冠心的高度 ⇒ 高的=枝梢=**花苞**、低的=**凋谢**、中间=**盛开**。
       打分是确定性的（不抽随机），比例仍是他要的 30/10/60。
     计数全部挂到 userData 上，供门禁直接断言比例（不靠"看图数"）。 */
  const budFrac = opts.budFrac || 0;
  const budN = Math.min(flSlots.length, Math.round(flSlots.length * budFrac));
  const witherN = Math.min(flSlots.length - budN, Math.round(flSlots.length * (opts.witherFrac || 0)));
  const witherCol = opts.witherColor || null;      // 枯黄 / 枯褐（每株一色，由 makePlumTree 给）
  const scored = flSlots.map((o, i) => ({ o, i, k: (o.t || 0) * 1.25 + (o.p.y - canopyC.y) / CAN_B }))
    .sort((a, b) => (b.k - a.k) || (a.i - b.i));
  const budSlots = scored.slice(0, budN);
  const witherSlots = scored.slice(scored.length - witherN);
  const openSlots = scored.slice(budN, scored.length - witherN);
  flInst.userData.flBuds = budN;
  flInst.userData.flWithered = witherN;
  flInst.userData.flOpen = openSlots.length;

  /* 一处放置逻辑，三个网格共用（花 / 凋谢 / 花苞）——避免三份几乎一样的代码各自漂。
     opts: axis('Z'|'Y' 几何的"花盘/苞轴"方向) / droop(凋谢的垂角) / scaleLo-Hi / tint(实例色)
     ⚠️ cluster [nMin,nMax] + clusterOff = **簇生**（老黄 2026-10-08："梅花应该是一小簇一小簇的，
        一个小枝节会并列开出好几朵花朵，同样花骨朵也是两个或者三个长一起…把一个大的花苞
        变成挨着的两个或者三个"）。梅是腋生花芽（每节 2~3 花并生），玉兰是单朵顶生。 */
  const placeBlossoms = (slots, inst, o) => {
    let idx = 0;
    for (let i = 0; i < slots.length; i++){
      const s = slots[i].o;
      const lat = aroundAxis(s.tan, i * 2.39996 + rr2(-0.50, 0.50));
      const face = lat.clone().addScaledVector(_up, rr2(0.35, 0.95)).normalize();
      /* 挂点 = 枝心 + (**本处枝半径** + 小贴面偏移) —— 贴在枝面上（2026-10-09 三轮：
         旧写法用固定 1~4.5cm 偏移，而梅枝半径沿枝 16mm→3mm 逐级变化 ⇒ 细梢悬空、
         粗根处仍埋着；现在偏移跟着枝半径走，正是"花裹着枝"该有的贴面）。 */
      _p.copy(s.p).addScaledVector(face, (s.r || 0.02) + rr2(o.stemLo, o.stemHi));
      /* ⚠️ 花与叶**不同**：叶要把冠填满（两个方向都夹进壳层），花要**贴在自己的枝上**
         （只收外沿、冠内不动）—— 否则冠内的花被挤到同一个椭球面上，读成"紫藤式花串"。 */
      canopyShell(_p, opts.flowerOutwardOnly === true);
      /* 朝向要在**夹壳之后**重算（夹壳挪了位置）：朝冠外偏上；花盘是单面卡，朝内就看不见。
         ⚠️ upMix 支持传**区间**：逐朵抽 ⇒ 有的花朝天、有的侧向外（实测"朝向一致"会被读成图标）。 */
      const upMix = Array.isArray(o.upMix) ? rr2(o.upMix[0], o.upMix[1]) : o.upMix;
      face.copy(_p).sub(canopyC).normalize().addScaledVector(_up, upMix).normalize();
      _q.setFromUnitVectors(_ax.set(o.axis === 'Y' ? 0 : 0, o.axis === 'Y' ? 1 : 0, o.axis === 'Y' ? 0 : 1), face);
      _q.multiply(_q2.setFromAxisAngle(_ax, rr2(0, TAU)));
      if (o.droop){
        _q2.setFromAxisAngle(_ax.set(1, 0, 0), rr2(o.droop[0], o.droop[1]));
        _q.multiply(_q2);
      }
      /* 簇生（2026-10-09 二轮 · 老黄："梅花成簇开放是指环绕枝条一圈的那种环绕"，参考图：
         同一节的花朝**四面八方**放射——左、右、前、后都有，"从镜头看枝条像被花裹住"）。
         ⇒ 簇成员不再随机偏移，而是**绕枝条轴一圈均匀分布**（角度错开 + 半径小偏移），
         每朵的朝向也各自朝自己的外向（不再共享朝向）。 */
      const nC = o.cluster
        ? Math.max(o.cluster[0], Math.min(o.cluster[1], Math.round(rr2(o.cluster[0], o.cluster[1] + 0.999))))
        : 1;
      const ringBase = rr2(0, TAU);                          // 本簇的起始角（逐簇不同）
      for (let c = 0; c < nC; c++){
        const ang = ringBase + (c / nC) * TAU + rr2(-0.25, 0.25);   // 环向角度 + 少量抖动
        const off = o.clusterOff || 0;
        if (o.cluster && off){
          /* 沿枝条法平面（垂直于 tan）的环向偏移：前后左右各一朵，围住枝条。
             ⚠️ 环半径 = **本处枝半径 + clusterOff**（2026-10-09 三轮）：直接拿 clusterOff
             当环半径的话，细梢（枝半径 3mm）处花瓣会穿进枝里、粗根处又离枝太远。
             ⚠️ 环的第二个基向量必须是 **tan × lat**（垂直于枝轴），不能用世界上方向
             (0,1,0)——斜枝下它不垂直于枝轴，环会退化成椭圆、花沿枝滑动而不是绕枝一圈。 */
          const ringR = (s.r || 0.02) + off;
          _p3.copy(lat);                                       // 基1（⟂ tan）
          _p4.crossVectors(s.tan, lat).normalize();            // 基2（⟂ tan 且 ⟂ 基1）⇒ 真环
          _p2.copy(s.tan).multiplyScalar(rr2(-off * 0.4, off * 0.4));   // 沿枝向微移（节距内）
          _p2.addScaledVector(_p3, Math.cos(ang) * ringR);     // 环向（横）
          _p2.addScaledVector(_p4, Math.sin(ang) * ringR);     // 环向（纵）
          _p2.add(_p);                                         // 加到挂点
          _s.setScalar(rr2(o.scale[0], o.scale[1]) * (c === 0 ? 1 : rr2(0.85, 0.97)));
          /* 簇成员朝向：各自朝"自己的外向"（不再共享一朵的朝向） */
          _p5.copy(_p2).sub(canopyC).normalize().addScaledVector(_up, upMix * rr2(0.5, 1.2)).normalize();
          _q.setFromUnitVectors(_ax.set(0, o.axis === 'Y' ? 1 : 0, o.axis === 'Y' ? 0 : 1), _p5);
          _q.multiply(_q2.setFromAxisAngle(_ax, rr2(0, TAU)));
          if (o.droop){ _q2.setFromAxisAngle(_ax.set(1, 0, 0), rr2(o.droop[0], o.droop[1])); _q.multiply(_q2); }
          _m.compose(_p2, _q, _s);
        } else {
          _s.setScalar(rr2(o.scale[0], o.scale[1]));
          _m.compose(_p, _q, _s);
        }
        inst.setMatrixAt(idx, _m);
        inst.setColorAt(idx, o.color());
        idx++;
      }
    }
    inst.count = idx;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    g.add(inst);
  };

  /* ① 盛开（60%）：花色随机深浅 + 轻微色相/明度抖动；
        ⚠️ 尺度/朝向**要散开**（2026-10-08 二轮，实测判读"形状雷同、大小接近、朝向一致、
        平贴枝条 ⇒ 像均匀撒在枝上的图标"）：尺寸 0.85~1.20 → **0.72~1.35**，
        花盘抬升混合系数 upMix 也逐朵抽（0.25~1.15）⇒ 有的朝天、有的侧向外。 */
  placeBlossoms(openSlots, flInst, {
    axis: 'Z', upMix: [0.25, 1.15], stemLo: 0.002, stemHi: 0.010,
    scale: CL ? [0.60, 0.95] : [0.85, 1.35],
    ...(CL ? { cluster: [2, 3], clusterOff: 0.016 } : {}),
    color: () => flA.clone().lerp(flB, R2()).offsetHSL(rr2(-0.03, 0.03), rr2(0, 0.06), rr2(-0.03, 0.04)),
  });
  /* ② 凋谢（10%）：**自己的几何**（花瓣短一档 + 向下折 53°~65°、只 4 片、雄蕊外露）+
     **自己的材质**（花瓣材质那层红自发光会把枯色盖掉 ⇒ 凋花照样鲜红，实测判读"看不出是枯萎花"）
     + 颜色往枯黄/枯褐压 + 整朵再往下垂。 */
  if (witherN > 0){
    const wInst = new THREE.InstancedMesh(makePlumWitheredGeo(), MAT.plumWithered, witherN * 3);
    wInst.name = 'plumWithered';
    wInst.castShadow = false;
    wInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    placeBlossoms(witherSlots, wInst, {
      axis: 'Z', upMix: [0.10, 0.45], stemLo: 0.002, stemHi: 0.012, scale: [0.60, 0.85],
      droop: [0.45, 0.90], cluster: [2, 3], clusterOff: 0.014,
      color: () => {
        const c = flA.clone().lerp(flB, R2()).offsetHSL(rr2(-0.03, 0.03), rr2(0, 0.06), rr2(-0.03, 0.04));
        return witherCol ? c.lerp(witherCol, rr2(0.70, 0.92)) : c;
      },
    });
    witheredMeshes.push(wInst);
  }
  /* ③ 花苞（30%）：独立几何 + 独立材质（花瓣材质带花瓣 alpha 贴图，套在球上会被裁破）。
     嫩色调 = 往花色的**浅端**（blossomA）靠并提亮（老黄要的"嫩黄色"）。 */
  if (opts.budMat && budN > 0){
    const budInst = new THREE.InstancedMesh(makePlumBudGeo(), opts.budMat, budN * 3);
    budInst.name = 'plumBuds';
    budInst.castShadow = false;
    budInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    placeBlossoms(budSlots, budInst, {
      axis: 'Y', upMix: 1.05, stemLo: 0.001, stemHi: 0.006, scale: [0.55, 0.75],
      cluster: [2, 3], clusterOff: 0.009,   // 贴面：环半径 = 枝半径 + 9mm（2026-10-09 三轮）
      /* ⚠️ 花苞色（2026-10-09 三轮 · 老黄："花苞的颜色也要再加深，现在看起来已经偏白色了"）：
         旧式 `lerp(flB, R2()*0.45)` 只往深端走 45%（基本停在浅端）+ **提亮 L +0.02~0.10**
         ⇒ 在浅端本身就是近白奶油色时，花苞当然读成白色（腊梅那边尤其明显）。
         改为：往深端走 **0.35~0.75**（更靠蜡黄）+ 明度**不再提亮**（-0.04~+0.02）、
         饱和度提一点 ⇒ 花苞是"比盛开的花更沉一点的蜡黄小圆球"。 */
      color: () => flA.clone().lerp(flB, 0.35 + R2() * 0.40)
        .offsetHSL(rr2(-0.02, 0.02), rr2(0.04, 0.12), rr2(-0.04, 0.02)),
    });
    budMeshes.push(budInst);
  }

  /* ⚠️ 梅（opts.noFruit）**不挂桃**：株形骨相可以借桃的骨架，果实不能借 ——
     一棵"梅树"上挂着蜜桃是硬伤。整块跳过（该函数只用私有随机流 rr2/R2，
     跳过不会影响全局布局流，也不会影响别的树）。 */
  if (!opts.noFruit){
  /* ── 果：夏结秋疏。桃的果实着生在短枝上，果柄短、稍下垂（果尖＝花端朝外下方）。
     果量 130（旧 80 上限实测只挂到 64）。 */
  const frGeo = makePeachFruitGeo();
  const frN = 130;
  const frInst = new THREE.InstancedMesh(frGeo, MAT.peachFruit, frN);
  const frA = new THREE.Color(0xF2B36A), frB = new THREE.Color(0xD9635A);

  const frRaw = [];
  for (const tw of twigs){
    const n = 1 + (i2(2));                 // 每条小枝 1~2 个
    for (let k = 0; k < n; k++){
      const t = rr2(0.25, 0.90);
      frRaw.push({ p: tw.getPointAt(t), tan: tw.getTangentAt(t).normalize() });
    }
  }
  for (const br of mainBranches){                    // 主枝中段也留几个
    for (let k = 0; k < 3; k++){
      const t = rr2(0.45, 0.85);
      frRaw.push({ p: br.getPointAt(t), tan: br.getTangentAt(t).normalize() });
    }
  }
  fillTo(frRaw, frN, twigPool);
  const frSlots = spread(frRaw).slice(0, frN);

  for (let i = 0; i < frSlots.length; i++){
    const o = frSlots[i];
    const lat = aroundAxis(o.tan, i * 2.39996 + rr2(-0.60, 0.60));
    const fruitDir = lat.clone().addScaledVector(_up, -0.85).normalize();
    _q.setFromUnitVectors(_up, fruitDir);          // 果几何 +Y（果尖）朝外下方
    _q.multiply(_q2.setFromAxisAngle(_up, rr2(0, TAU)));
    _p.copy(o.p).addScaledVector(fruitDir, 0.015);  // 果柄
    _s.set(rr2(0.85, 1.15), rr2(0.90, 1.10), rr2(0.85, 1.15));
    _m.compose(_p, _q, _s); frInst.setMatrixAt(i, _m);
    frInst.setColorAt(i, frA.clone().lerp(frB, rr2(0.30, 0.90))
      .offsetHSL(rr2(-0.02,0.02), rr2(0,0.05), rr2(-0.04,0.03)));
  }
  frInst.count = frN;
  frInst.instanceMatrix.needsUpdate = true;
  if (frInst.instanceColor) frInst.instanceColor.needsUpdate = true;
  g.add(frInst);
  }

  /* ⚠️ 梅（opts.noFruit）也**不撒桃瓣**：地面那层粉瓣是"桃的落花"，梅的落花另有颜色与时机
     （而且冬天落花会被积雪盖住、做了也看不见）。同样是整块跳过。 */
  if (!opts.noFruit){
  /* 落花铺地（春末夏初 · 树干四周散一层粉瓣）260 片。
     槽位先算好再打散：春季 peachPetalShow=0.3 / 夏 0.45 是 12-env 按 count 截**前缀**的，
     不打散就会"花瓣只落在一个扇形里"。 */
  const petalGeo = new THREE.PlaneGeometry(0.075, 0.11);
  const petalN = 260;
  const petalInst = new THREE.InstancedMesh(petalGeo, MAT.peachPetal, petalN);
  const pcA = new THREE.Color(0xF7C7D4), pcB = new THREE.Color(0xE796AE);
  const petalRaw = [];
  for (let i = 0; i < petalN; i++){
    petalRaw.push({ a: rr2(0, TAU), d: R * rr2(0.15, 0.95),
                    y: rr2(0.012, 0.05), ry: rr2(0, TAU), rx: rr2(-0.4, 0.4), s: rr2(0.7, 1.4) });
  }
  spread(petalRaw).forEach((o, i) => {
    _p.set(Math.cos(o.a) * o.d, o.y, Math.sin(o.a) * o.d);
    _q.setFromEuler(_e.set(Math.PI / 2, o.ry, o.rx));
    _s.setScalar(o.s);
    _m.compose(_p, _q, _s); petalInst.setMatrixAt(i, _m);
    petalInst.setColorAt(i, pcA.clone().lerp(pcB, R2()));
  });
  petalInst.count = petalN;
  petalInst.instanceMatrix.needsUpdate = true;
  if (petalInst.instanceColor) petalInst.instanceColor.needsUpdate = true;
  g.add(petalInst);
  }

  g.userData.peachTree = true;
  return g;
}

/* ══ 梅（2026-10-06 · 老黄："院内布景是否也讲究梅兰竹菊…在院子里加两株梅花，一株腊梅一株红梅，
      给冬天增加一点色彩，特别是'银装素裹'的场景下就会显得非常有生机"）═════════════════
   做法：**借桃的骨架、换花**。梅与桃是蔷薇科同族小乔木，都是"先花后叶、花缀满枝"，
   低分叉杯状骨架 + 花沿小枝簇生这套形制完全通用；差别只在花色、花期与"不挂果"。
   ⇒ 调用 makePeachTree 并传 opts：
      · blossomMat = MAT.plumBlossomRed / plumBlossomYellow（红梅 / 腊梅）；
      · flowerN 2000（梅比桃疏，"疏影横斜"，太满读成桃）；
      · 花色区间偏"单色深浅"而不是桃那种粉白渐变（红梅=胭脂→水红，腊梅=蜡黄→浅黄）；
      · noFruit = true（不挂桃、不撒桃瓣）。
   花期由季节通道 plumBlossomShow 控制（冬 1.0 / 春 0.55 / 秋 0.15 / 夏 0）——
   ⚠️ 冬 1.0 是这条需求的全部意义：**"银装素裹"里唯一的彩色**。
   ⚠️ 梅的骨相（主干/主枝/小枝）照旧进 mergeStatics（冬天叶落也不消失 ⇒ "疏影横斜"的枝条在）。
   位置由调用方给（见 08-assemble 的梅树落点，那里有射线实测的说明）。 */
export function makePlumTree(x, z, scale = 1, baseY = 0, kind = 'red'){
  const red = kind !== 'yellow';
  return makePeachTree(x, z, scale, baseY, {
    noFruit: true,
    blossomMat: red ? MAT.plumBlossomRed : MAT.plumBlossomYellow,
    /* ⚠️ 花型换掉（老黄："红梅的花型也不对"）：用 makePlumFlowerGeo ——
       大而平展的五瓣 + 明显花蕊（桃是深碗小瓣，两者远看不再是一回事）。 */
    flowerGeo: makePlumFlowerGeo(),
    /* ⚠️⚠️ 朵数沿革：5000 → 1200 → 800 → 1500 → 700 → **320**（2026-10-08 第三轮收口）。
       前几轮都在"加朵数"，老黄 2026-10-08 指出真问题是**形态**："梅花开出来紫藤这种花的效果，
       现实中的梅花不是这种密集型开放…把枝条数量和分叉再增加，每条枝条和分叉上的花苞和花朵
       如截图所示"。
       量出来的硬约束（两轮实测）：本项目单朵花是**夸张尺寸**。要让"花-枝比例"像真实梅
       （参考图：覆盖率约三成、花间有裸枝），在 2.7m 冠幅上只需 ~200~350 朵；
       朵数一多，花必然互相叠（700 朵时冠心仍连成红块、1420/1500 朵时最近邻只有 0.19 倍花径）。
       ⇒ 取 **320 朵**（≈ 冠部投影三成覆盖 ⇒ 疏枝点花）+ **枝条网络 1700+ 根**
         （繁茂感来自枝，不来自花量）+ **远处按距离放大 2.6 倍**保住"看得见花色"。
       ⚠️ 这个数只吃本函数的**私有流**（rr2/R2/i2）—— `makePeachTree` 函数体内**零**全局
         `rr()/rnd()/Math.random`（已核）⇒ 改朵数**不会**动全园布局；但它会改这株梅的实例条数
         ⇒ layout-fingerprint 需要**重出基线**（这是有意的布局变更，不是漂）。 */
    /* ⚠️ 朵数（2026-10-09 四轮 · 实测驱动）：上一版 800 簇心 ÷ 约 700 根枝 = **1.1 簇/枝**，
       而参考图的节距是 1~1.5 花径（0.10~0.15m）、一根 0.3~0.6m 的枝上应落 2~5 簇 ——
       多模态看整树图判读"花聚成中间一个球、外围长枝秃"（实测花确实都在枝上：平均离枝
       3.0cm、只有 4.4% 超 5cm ⇒ 不是位置 bug，是**每枝簇数太少**）。
       ⇒ 翻到 **1600**（≈2.3 簇/枝）。腾预算的手段是**精简花几何**（见三个 makeXxxGeo：
       单朵 162→62 tri、单苞 724→约 340 tri）⇒ 朵数翻倍而总三角形几乎不变。
       ⚠️ 这个数只吃本函数的**私有流**（rr2/R2/i2）—— `makePeachTree` 函数体内**零**全局
         `rr()/rnd()/Math.random`（已核）⇒ 改朵数**不会**动全园布局；但它会改这株梅的实例条数
         ⇒ layout-fingerprint 需要**重出基线**（这是有意的布局变更，不是漂）。 */
    flowerN: 1600,
    /* ⚠️ 树形与桃**反着调**（老黄："远看会觉得就是同一种树，这个肯定不对"）：
       桃 = 矮胖圆球（H≈4.2、冠幅 1.25H、叶满）；梅 = 高挑疏朗（H×1.35、冠幅 **0.85H**、
       叶量 **0.65**）⇒ 梅的暗色枝干骨架露出来，正是"疏影横斜"，远看轮廓也完全不同。
       ⚠️ twigMul / subTwig（2026-10-08）：梅要**更多枝条与分叉**承载"每条枝上点几朵花"，
       否则花只能堆在少数枝上、读成紫藤。桃不传这两个键 ⇒ 桃树逐字不变。 */
    heightMul: 1.35, canopyMul: 0.85, branchMul: 1.30, leafMul: 0.65,
    twigMul: 2.2, subTwig: true, longTwig: true, flowerOutwardOnly: true,
    /* ── 三种状态的比例（2026-10-08 老黄："总归有 60% 左右的花、30% 左右的苞（嫩黄色）、
          还有 10% 左右是开始凋谢的花（花苞枯黄），按这个比例来重新修改两株梅花的造型"）──
       槽位总数仍 320（`flowerN`）：30% 分给花苞（独立几何/材质），其余 70% 里再切 1/7
       （= 全树 10%）做凋谢。⇒ 实际 60% 盛开 / 30% 花苞 / 10% 凋谢。 */
    budFrac: 0.30, witherFrac: 0.10, budMat: MAT.plumBud, blossomCluster: true,
    /* 凋谢色（每株一色）：腊梅的枯花是**枯黄**、红梅的枯花是**枯褐红** ——
       都往"褪色发暗"那一头压，与盛开的花一眼分得开。
       ⚠️ 腊梅这头跟着"调黄"一起走：0xA8842E（偏褐金）→ 0xBBA52E（枯黄偏绿）。 */
    witherColor: new THREE.Color(red ? 0x8A5238 : 0xBBA52E),
    /* 干/枝与叶也各换一份材质：梅的树皮更冷更暗（灰褐），叶更墨绿 —— 远看的整体色调就分开了。 */
    trunkMat: MAT.plumTrunk, leafMat: MAT.plumLeaf,
    /* 花色（老黄三连："腊梅是淡黄色到黄色"、"再黄一些，感觉有点偏金色"、
       2026-10-09 三轮："腊梅花黄色还是不够正，颜色再调得蜡黄"）：
       红梅 = 暖胭脂 → 正红（压掉蓝通道，避免"紫红/暗粉"）；
       腊梅 = **蜡黄**（蜂蜡那种略带暖调、饱和的黄）：浅端 0xFFF8C8（近白奶油 → 就是
       "花苞看起来偏白"的根源之一）换成 **0xFFE566**、深端 0xFFDD22 → **0xE0A800**
       （更沉、更"蜡"；纯 0xFFDD22 偏亮偏薄，在雪地里读作淡黄）。
       冬季预设会降饱和 0.70 + 冷色调 ⇒ 底色必须比目标色更饱和一档。 */
    blossomA: new THREE.Color(red ? 0xFF7A6E : 0xFFE566),
    blossomB: new THREE.Color(red ? 0xDC1220 : 0xE0A800),
  });
}

/* ══ 廊下兰草（2026-10-06 · 老黄："在廊下补一小丛兰草（或盆栽兰）"）═════════════════════
   凑"梅兰竹菊"的最后一笔。取"**盆栽兰**"（廊下本来就有缸/盆一类陈设，最省事也最不出错）：
     · 花盆：两级陶盆 + 口沿圈（深陶色）；
     · 叶：复用 `makeReedBladeGeo()` —— 它本来就是"根部直立、梢部外弯"的弧叶，正是兰叶的形；
       9 片绕心放射，朝向/长度/倾角全部吃**本函数私有流**（不动全局 rnd/rr，铁律 1）；
     · 花葶：3 根细杆挑出盆沿、顶端各 2~3 朵米黄小花（远看就是"兰开花了"）。
   开销：1 个 InstancedMesh（叶）+ 一小组普通 Mesh，只多一次提交级别的成本。
   ⚠️ 落点高度必须由调用方按**实测地表**给（见 08 的注释）：廊下是台基/铺装，不是地形，
     用 groundHeight 会把盆陷进台基里。 */
export function makeOrchidPot(x, z, baseY = 0){
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const R3 = mulberry32(((Math.round(x * 1000) * 2654435761) ^ (Math.round(z * 1000) * 40503)) >>> 0);
  const potLow = mesh(new THREE.CylinderGeometry(0.115, 0.095, 0.075, 12), MAT.stoneDark, { name:'orchidPotLow', cast:true });
  potLow.position.y = 0.0375; g.add(potLow);
  const potUp  = mesh(new THREE.CylinderGeometry(0.135, 0.115, 0.085, 12), MAT.stoneDark, { name:'orchidPotUp', cast:true });
  potUp.position.y = 0.1175; g.add(potUp);
  const potRim = mesh(new THREE.CylinderGeometry(0.146, 0.140, 0.022, 12), MAT.stoneDark, { name:'orchidPotRim', cast:true });
  potRim.position.y = 0.168; g.add(potRim);
  const leafGeo = makeReedBladeGeo(0.52);
  const leaves = new THREE.InstancedMesh(leafGeo, MAT.reed, 9);
  const lq = new THREE.Quaternion(), lq2 = new THREE.Quaternion(), lp = new THREE.Vector3(),
        ls = new THREE.Vector3(), lm = new THREE.Matrix4(), AY = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 9; i++){
    const a = (i / 9) * TAU + R3() * 0.5;
    const lean = 0.20 + R3() * 0.22;
    lp.set(Math.cos(a) * 0.05, 0.155, Math.sin(a) * 0.05);
    lq.setFromAxisAngle(AY, -a);
    lq2.setFromAxisAngle(AX, lean);
    lq.multiply(lq2);
    ls.setScalar(0.85 + R3() * 0.5);
    lm.compose(lp, lq, ls); leaves.setMatrixAt(i, lm);
  }
  leaves.instanceMatrix.needsUpdate = true;
  leaves.castShadow = false; leaves.receiveShadow = true;
  g.add(leaves);
  /* 花葶复用腊梅的米黄瓣材质（同为淡黄小花，省一份材质；它已在 SEASON_PRESENCE 里，
     冬天 plumBlossomShow=1 时兰也在开 —— 与兰的花期（冬春）正好一致）。 */
  for (let k = 0; k < 3; k++){
    const a = 0.7 + k * 2.1 + R3() * 0.4, lean = 0.16 + R3() * 0.18, h = 0.44 + R3() * 0.16;
    const stem = mesh(new THREE.CylinderGeometry(0.006, 0.009, h, 5), MAT.reed, { name:'orchidStem', cast:false });
    stem.position.set(Math.cos(a) * 0.05, 0.16 + h / 2, Math.sin(a) * 0.05);
    stem.rotation.set(lean * Math.sin(a), 0, -lean * Math.cos(a));
    g.add(stem);
    for (let j = 0; j < 3; j++){
      const f = mesh(new THREE.SphereGeometry(0.022, 7, 6), MAT.plumBlossomYellow, { name:'orchidFlower', cast:false });
      f.position.set(stem.position.x * (1 + j * 0.5), 0.16 + h * (0.72 + j * 0.12), stem.position.z * (1 + j * 0.5));
      g.add(f);
    }
  }
  return g;
}

/* 芭蕉果串（重建）：真实香蕉束 —— 冠部斜出的粗果轴 + 5 圈"把"（hand），每圈一圈
   新月形蕉指（指根朝上、凹面内扣贴轴、五棱截面），束末一颗紫红花苞。
   旧版是"8 根直柱子围一根芯"—— 与真实果串毫无关系（用户原话："香蕉长什么样你比我更清楚"）。
   蕉指 = 圆环弧管 InstancedMesh + instanceColor 青→黄（上圈更熟下圈更生）。 */
