// 15-stable: 院外马厩（2026-10-09 · 老黄："在院子的外围区域设计一个马厩，用于主人的出行或者
//   客人到访，需要做一个可以停 4 匹马匹的马厩，2 驾 2 轮马车（2 匹马拉），再设计一个马夫在帮忙
//   给马喂草料或者帮马匹梳理毛皮"）
//
//   ── 选址（实测，不是拍脑袋）──────────────────────────────────────────────
//   南墙外东侧、中心 (12, 29)。理由：
//     · 围墙范围 x∈[-30,30]、z∈[-22.5,22.5]，**只有南墙正中一个月洞门**（x=0）——
//       南墙外是唯一"进出顺手"的外围；南外围 60m 宽 × 13m 深，是全园最大最空的一块。
//     · 实测该处地形：x 6→22 缓降 y −0.10→−0.76、z 23→35 缓升 −0.45→−0.18
//       ⇒ 一座 16×9 的台基就能把场院抬平（台基顶取 −0.08，最深处露出约 0.6m 的台帮）。
//     · 上游 5 个取样点（中心/四角）从 12m 高向下射线**都只命中 ground** ⇒ 无遮挡、无既有物件。
//     · 刻意偏东 12m 避开月洞门中轴：从园内望出去不挡门口那条视线；而屋顶脊（≈4.7m）
//       比南墙压顶（4.5m）高一点，园内回头能瞥见一线瓦脊 —— "墙外有厩"读得出来。
//
//   ── 构成 ────────────────────────────────────────────────────────────────
//   抬平台基 → 硬山瓦顶马厩（正面敞开、6 柱 5 间、4 个隔栏马位 + 4 个石食槽 + 槽内干草）
//   → 前院（2 驾双轮马车、2 匹在外面的马、2 根拴马桩、石水槽、草料堆）→ 矮木栅围院（正面留门）。
//   4 匹马 = 厩内 2 匹（隔栏里）+ 院中 2 匹（一匹拴在桩上、一匹由马夫喂料）。
//   马夫（人物）**不在这里建** —— 人物工厂 makeScholar 在 08-assemble（那边还管日程/呼吸/落脚），
//   这里只导出 makeFeedBale()（他手里那捆草料），由 08 挂在手上。
import { THREE } from '../vendor.js';
import { mesh, box, makeColumn, makeChineseRoof, makeLatticePanel } from './03-factory.js';
import { MAT } from './01-materials.js';
import { groundHeight } from './05-water.js';
import { tubeRadiusRamp } from './06-vegetation.js';

/* ── 一匹马（程序化低模，与点景人物/水禽同一路数：零外部资产、纯几何拼）─────────────
   形态要点（远看能读出"这是马"的三件事，按重要性排序）：
     ① **长颈 + 长头**：颈从胸口斜上前伸、头再前下探 —— 马与牛/鹿的剪影差别主要在这里；
     ② **四腿细长、蹄小**：腿径只有躯干的 1/3，落地四个小深色蹄；
     ③ **深色鬃尾**：沿颈脊一道鬃、臀后一束尾，与身体异色（真实马也多是深鬃浅身）。
   躯干/颈/头/腿都用**变速管**（tubeRadiusRamp）——沿曲线变径的管，比 BoxGeometry 拼积木
   圆润得多，且半径剖面一处定义、形体一次成型。
   ⚠️ 腿的**朝向**：腿是竖直向下的管，用 tubeRadiusRamp 时会按曲线切线定向 ⇒ 给它一条
      略带前后错位的两段曲线（膝/飞节各有一个折点），出来的就是"前腿直、后腿有飞节"的样子。 */
export function makeHorse(coatMat = MAT.horseChestnut, opts = {}){
  const g = new THREE.Group();
  const mane = opts.maneMat || MAT.horseMane;
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const tube = (pts, radiusAt, seg = 12, rad = 8, mat = coatMat, name = '') => {
    const c = new THREE.CatmullRomCurve3(pts);
    const geo = tubeRadiusRamp(new THREE.TubeGeometry(c, seg, 1, rad, false), c, seg, rad, radiusAt);
    return mesh(geo, mat, { name, cast: true });
  };
  /* ① 躯干：臀 (−0.55) → 腰 → 胸 (+0.42)，中段最粗（0.20）、两端收到 0.15/0.16。
       中心高度 1.05m（成年马肩高约 1.5m，躯干中心在肩下 0.45）。 */
  g.add(tube([P(0, 1.10, -0.55), P(0, 1.16, -0.28), P(0, 1.12, 0.05), P(0, 1.18, 0.32), P(0, 1.22, 0.44)],
    t => 0.20 - 0.05 * Math.pow(Math.abs(t * 2 - 1), 1.6), 14, 10, coatMat, 'horseBody'));
  /* ② 颈：从胸口 (0.44, 1.22) 斜上前到颈枕 (0.66, 1.56)，径 0.135 → 0.085
     ⚠️ 颈 + 头 + 口鼻 + 双耳 + 鬃都挂在 **headG**（枢轴在颈根 (1.16, 0.40)）——
        这样"低头吃草"只要转一个 group（opts.graze），不必逐件重算坐标。
        马夫喂料那匹就是靠它把嘴低到草料上（否则站姿的马嘴在 1.36m，人的手够不着）。 */
  const headG = new THREE.Group();
  headG.position.set(0, 1.16, 0.40);
  headG.rotation.x = opts.graze || 0;
  g.add(headG);
  const H = (x, y, z) => new THREE.Vector3(x, y - 1.16, z - 0.40);   // 世界系 → headG 局部
  headG.add(tube([H(0, 1.16, 0.40), H(0, 1.34, 0.52), H(0, 1.50, 0.60), H(0, 1.57, 0.66)],
    t => 0.155 - 0.055 * t, 8, 8, coatMat, 'horseNeck'));
  /* ③ 头：颈枕再向前下探到口鼻 (1.08, 1.35)，径 **0.105 → 0.062**（比第一版放大一档）
     ＋一枚**颊球**（马的脸颊是圆的，光靠变径管读成一个锥）+ 深色**口鼻**。
     ⚠️ 2026-10-09 实测：第一版头径只有 0.085→0.048，出图判读两次都是"头颈糊成一个
        无特征的圆块 ⇒ 认不出是马"。**远看的辨识度靠"分块"而不是靠精细**：
        头要大一号、口鼻要深色、耳朵要立得住 —— 三块钱一分，"这是个动物"才成立。 */
  headG.add(tube([H(0, 1.57, 0.66), H(0, 1.50, 0.82), H(0, 1.42, 0.96), H(0, 1.35, 1.08)],
    t => 0.105 - 0.043 * t, 7, 7, coatMat, 'horseHead'));
  const cheek = mesh(new THREE.SphereGeometry(0.098, 8, 6), coatMat, { name: 'horseCheek' });
  cheek.position.copy(H(0, 1.47, 0.86)); cheek.scale.set(0.85, 0.95, 1.25); headG.add(cheek);
  // 口鼻：更大的深色球（马的口鼻一圈本就深）
  const muzzle = mesh(new THREE.SphereGeometry(0.068, 8, 6), mane, { name: 'horseMuzzle' });
  muzzle.position.copy(H(0, 1.34, 1.09)); muzzle.scale.set(0.95, 0.88, 1.15); headG.add(muzzle);
  // 双耳：加大的立锥（马耳是竖的、尖的 —— 剪影上很硬的特征）
  for (const sx of [-1, 1]){
    const ear = mesh(new THREE.ConeGeometry(0.042, 0.115, 5), mane, { name: 'horseEar' });
    ear.position.copy(H(sx * 0.052, 1.685, 0.645)); ear.rotation.x = -0.24; ear.rotation.z = sx * 0.18;
    headG.add(ear);
  }
  /* ⑤ 鬃：沿颈脊一道**立得住的冠**（四段加高小盒，0.18 高 —— 第一版 0.10 太矮，
       远看与颈融成一体）—— 挂 headG 跟着头动 */
  for (let i = 0; i < 4; i++){
    const k = i / 3;
    const m = mesh(box(0.045, 0.18, 0.15), mane, { name: 'horseManeTuft' });
    m.position.copy(H(0, 1.44 + k * 0.12 + 0.06, 0.44 + k * 0.11));
    m.rotation.x = -0.55 + k * 0.18;
    headG.add(m);
  }
  /* ④ 四腿：**上段（毛色）+ 下段（深色"袜"）+ 蹄**三段拼 —— 这是"认得出是马"最关键的一笔：
       四条深色小腿在浅色身体下方形成四条清晰的竖线，远看立刻读成"四腿站立的动物"。
       （第一版整条腿与身体同色 ⇒ 实测出图判读"找不到腿""像一坨棕色麻袋"。）
       前腿从 (x,1.00,0.30) 直下；后腿从 (x,1.05,−0.40) 经飞节 (x,0.56,−0.52) 再下 —— 那个后折就是飞节。 */
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
  /* 尾：臀后下垂一束（加粗一档；鬃已随头挂进 headG，勿重复添加） */
  g.add(tube([P(0, 1.24, -0.58), P(0, 1.06, -0.72), P(0, 0.82, -0.78), P(0, 0.58, -0.75)],
    t => 0.075 - 0.030 * t, 7, 6, mane, 'horseTail'));
  /* 鞍具（可选）：马厩里的马多数不备鞍；只有"拴在桩上等主人出门"的那匹给一副鞍
     （一块鞍垫 + 一条肚带），一眼读得出"这匹是备好的"。 */
  if (opts.saddle){
    const pad = mesh(box(0.34, 0.06, 0.42), MAT.harness, { name: 'horseSaddle' });
    pad.position.set(0, 1.28, 0.06); g.add(pad);
    const girth = mesh(new THREE.TorusGeometry(0.21, 0.022, 4, 10), MAT.harness, { name: 'horseGirth' });
    girth.position.set(0, 1.14, 0.06); girth.rotation.y = Math.PI / 2; g.updateMatrixWorld();
    g.add(girth);
  }
  g.userData.horse = true;
  return g;
}

/* ── 双轮马车（2 匹马拉：两辕 + 一舆）────────────────────────────────────────
   中式双轮车的关键件：**两根辕**（自舆底两前角向前上方伸出，夹住两匹马的肩）、
   **辐条大轮两只**（径 1.1m，装在舆下两侧、轮心高 0.62）、**舆**（车箱，可坐人）、
   **篷**（半圆筒罩，罩住后半 —— 主人出行坐的那半）。 */
export function makeCarriage(){
  const g = new THREE.Group();
  const wood = MAT.woodDark, trim = MAT.wood, strap = MAT.harness;
  const wheel = (sx, z) => {
    const w = new THREE.Group();
    const rim = mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 20), wood, { name: 'wheelRim', cast: true });
    w.add(rim);
    for (let i = 0; i < 10; i++){                     // 10 根辐条
      const sp = mesh(box(0.035, 0.50, 0.030), trim, { name: 'wheelSpoke' });
      sp.position.y = 0.25; sp.rotation.z = (i / 10) * Math.PI * 2;
      const holder = new THREE.Group(); holder.add(sp); holder.rotation.z = 0;
      w.add(holder);
      sp.position.set(-Math.sin((i / 10) * Math.PI * 2) * 0.25, Math.cos((i / 10) * Math.PI * 2) * 0.25, 0);
      sp.rotation.z = -(i / 10) * Math.PI * 2;
    }
    const hub = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.10, 10), wood, { name: 'wheelHub' });
    hub.rotation.x = Math.PI / 2; w.add(hub);
    w.position.set(sx * 0.62, 0.55, z);
    w.rotation.y = Math.PI / 2;                        // 轮面朝 ±x（与车轴垂直）
    return w;
  };
  g.add(wheel(-1, 0)); g.add(wheel(1, 0));
  // 车轴
  const axle = mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.42, 8), wood, { name: 'carriageAxle' });
  axle.rotation.z = Math.PI / 2; axle.position.set(0, 0.55, 0); g.add(axle);
  /* 舆（车箱）：底盘 + 四面板 + 前挡；坐人的车箱离地 0.62（轮半径一半以上） */
  const bedY = 0.72;
  const bed = mesh(box(1.15, 0.09, 1.32), wood, { name: 'carriageBed', cast: true });
  bed.position.set(0, bedY, -0.05); g.add(bed);
  for (const sx of [-1, 1]){
    const side = mesh(box(0.07, 0.42, 1.28), trim, { name: 'carriageSide' });
    side.position.set(sx * 0.54, bedY + 0.26, -0.05); g.add(side);
  }
  const back = mesh(box(1.10, 0.52, 0.07), trim, { name: 'carriageBack' });
  back.position.set(0, bedY + 0.30, -0.68); g.add(back);
  const front = mesh(box(1.10, 0.30, 0.07), trim, { name: 'carriageFront' });
  front.position.set(0, bedY + 0.16, 0.58); g.add(front);
  /* 车篷：半圆筒罩住后半（木骨 + 席面），中式的"幔"*/
  const canopy = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.86, 14, 1, true, 0, Math.PI), MAT.bambooBlind,
    { name: 'carriageCanopy', cast: false });
  canopy.rotation.z = Math.PI / 2; canopy.rotation.y = Math.PI / 2;
  canopy.position.set(0, bedY + 0.42, -0.30); canopy.material.side = THREE.DoubleSide;
  g.add(canopy);
  /* 双辕：从舆底两前角向前上方伸出 2.0m，末端有横"衡"（夹在马肩上的那根横木） */
  for (const sx of [-1, 1]){
    const shaftCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.40, bedY - 0.02, 0.55),
      new THREE.Vector3(sx * 0.40, bedY + 0.10, 1.30),
      new THREE.Vector3(sx * 0.42, bedY + 0.22, 2.05),
    ]);
    g.add(mesh(new THREE.TubeGeometry(shaftCurve, 8, 0.042, 6, false), wood, { name: 'carriageShaft', cast: true }));
  }
  const yoke = mesh(box(0.92, 0.07, 0.07), wood, { name: 'carriageYoke' });
  yoke.position.set(0, bedY + 0.24, 1.98); g.add(yoke);
  // 挽具：两根缰绳从辕头垂到马侧（细管，读得出"套着马"）
  for (const sx of [-1, 1]){
    const rein = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.30, bedY + 0.44, 0.42),
      new THREE.Vector3(sx * 0.42, bedY + 0.30, 1.20),
      new THREE.Vector3(sx * 0.44, bedY + 0.20, 1.85),
    ]);
    g.add(mesh(new THREE.TubeGeometry(rein, 8, 0.014, 4, false), strap, { name: 'carriageRein', cast: false }));
  }
  g.userData.carriage = true;
  return g;
}

/* ── 草料捆（马夫手里那捆）—— 一小抱干草：几根交错的细管束成一捆 ───────────────
   ⚠️ 尺寸是**按可读性定的**，不是按实物：实测第一版草茎半径 0.011、7 根（整捆约 8cm 粗），
      在 10~20m 的观察距离上只有 1~2px ⇒ 出图判读"手边没有草料"。加粗到 0.017、9 根
      （整捆约 12cm 粗、0.34m 长），是"远看一小抱、近看不假"的折中。 */
export function makeFeedBale(){
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++){
    const a = (i / 9) * Math.PI * 2, r = 0.045 + (i % 3) * 0.015;
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * r, -0.14, Math.sin(a) * r * 0.6),
      new THREE.Vector3(Math.cos(a) * r * 1.5, 0.02, Math.sin(a) * r),
      new THREE.Vector3(Math.cos(a) * r * 2.1, 0.20 + (i % 4) * 0.03, Math.sin(a) * r * 1.4),
    ]);
    g.add(mesh(new THREE.TubeGeometry(c, 5, 0.017, 5, false), MAT.straw, { name: 'feedStrand', cast: false }));
  }
  const tie = mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.045, 8), MAT.harness, { name: 'feedTie' });
  g.add(tie);
  return g;
}

/* ── 石槽（食槽 / 水槽共用）：一个上开口的石箱 ───────────────────────────────
   做法与"缸"一致：外箱 + 内凸的四壁 + 一块下沉的底/水面。上开口 => 从任何角度看都是槽。 */
function makeTrough(w, d, h, mat = MAT.stoneDark, fillMat = null, fillY = 0.10){
  const g = new THREE.Group();
  const t = 0.09;
  const floor = mesh(box(w, t, d), mat, { name: 'troughFloor', cast: true });
  floor.position.set(0, t / 2, 0); g.add(floor);
  for (const sx of [-1, 1]){
    const s = mesh(box(t, h, d), mat, { name: 'troughWall', cast: true });
    s.position.set(sx * (w / 2 - t / 2), h / 2, 0); g.add(s);
  }
  for (const sz of [-1, 1]){
    const s = mesh(box(w, h, t), mat, { name: 'troughWallEnd', cast: true });
    s.position.set(0, h / 2, sz * (d / 2 - t / 2)); g.add(s);
  }
  // 槽内填料：干草（食槽）或水面（水槽）
  const fill = mesh(box(w - t * 2, 0.05, d - t * 2), fillMat || MAT.straw, { name: 'troughFill', cast: false });
  fill.position.set(0, fillY, 0); g.add(fill);
  return g;
}

/* ── 马厩整组 ────────────────────────────────────────────────────────────────
   局部坐标：原点 = 场院中心（台基面 y=0）；**−z 朝园子（正面）**、+z 是厩身。
   摆放：world 里 `g.position.set(cx, baseY, cz)`、`g.rotation.y` 按需要。
   台基面 baseY 取实测地形 + 抬高：见 makeStable 的 baseY 参数说明。 */
export function makeStable(cx, cz, opts = {}){
  const g = new THREE.Group();
  const yaw = opts.yaw || 0;
  /* 台基面高度：取场院四角实测地形的**最高值 + 0.10**（保证最浅处也露台帮、不埋进坡里），
     由调用方给；不给就按中心点地形 + 0.25 兜底。 */
  const baseY = opts.baseY !== undefined ? opts.baseY : groundHeight(cx, cz) + 0.25;
  g.position.set(cx, baseY, cz);
  g.rotation.y = yaw;

  /* ① 台基（16 × 9）：顶面 y=0、向下 1.1m —— 坡地上最深处露 0.6m 台帮、最浅处 0.9m */
  const PW = 16, PD = 9, PH = 1.1;
  const base = mesh(box(PW, PH, PD), MAT.stone, { name: 'stableBase', cast: true, receive: true });
  base.position.set(0, -PH / 2, 0); g.add(base);
  const baseEdge = mesh(box(PW + 0.24, 0.14, PD + 0.24), MAT.stoneDark, { name: 'stableBaseEdge' });
  /* ⚠️ 压顶的**顶面必须与台面齐平**（局部 y=0）：中心放 −0.07 ⇒ 跨 [−0.14, 0]。
     第一版放在 −0.02（跨 [−0.09, +0.05]）——比台面高出 5cm，既像一道绊脚的坎，
     又会让 figure-foot-guard 的"落脚面"射到压顶(0.19)而不是台面(0.14) ⇒ gap −0.05 报红。 */
  baseEdge.position.set(0, -0.07, 0); g.add(baseEdge);

  /* ② 厩身：6 柱 5 间、正面敞开；进深 3.8（z 0.6~4.4）、面阔 9.4（x −4.7~4.7）、檐高 3.2 */
  const BX = 4.7, BZ0 = 0.6, BZ1 = 4.4, colH = 3.2;
  const colX = [-4.4, -2.64, -0.88, 0.88, 2.64, 4.4];
  for (const x of colX){
    const c = makeColumn(colH, 0.185);
    c.position.set(x, colH / 2, BZ0 + 0.18); g.add(c);
    const cb = mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.16, 10), MAT.stoneDark, { name: 'stableColBase' });
    cb.position.set(x, 0.08, BZ0 + 0.18); g.add(cb);
  }
  // 后墙 + 两侧山墙（白粉墙到檐口），后墙上开一条通风格窗
  const backWall = mesh(box(BX * 2, colH - 0.5, 0.24), MAT.wall, { name: 'stableBackWall', cast: true });
  backWall.position.set(0, (colH - 0.5) / 2, BZ1); g.add(backWall);
  const vent = makeLatticePanel(3.4, 0.72, 5, 2);
  vent.position.set(0, colH - 0.85, BZ1 - 0.14); g.add(vent);
  for (const sx of [-1, 1]){
    const sideWall = mesh(box(0.24, colH - 0.5, BZ1 - BZ0), MAT.wall, { name: 'stableSideWall', cast: true });
    sideWall.position.set(sx * BX, (colH - 0.5) / 2, (BZ0 + BZ1) / 2); g.add(sideWall);
  }
  // 额枋（柱头连梁，正面 + 背面）
  for (const z of [BZ0 + 0.18, BZ1]){
    const beam = mesh(box(BX * 2 + 0.3, 0.30, 0.22), MAT.wood, { name: 'stableBeam', cast: true });
    beam.position.set(0, colH + 0.15, z); g.add(beam);
  }
  /* 屋顶：悬山（两坡 + 正脊）——**不用歇山**：马厩是杂役房，硬/悬山才对（歇山是厅堂形制）。
     一块瓦面用 makeCorrugatedSlab 做（它的顶面自带瓦垄波纹），旋转成坡即可。 */
  const roofW = BX * 2 + 1.1, roofRun = 2.42, ridgeY = colH + 1.32;
  for (const sz of [-1, 1]){
    const slope = mesh(new THREE.BoxGeometry(roofW, 0.16, roofRun, 1, 1, 1), MAT.roof, { name: 'stableRoof', cast: true });
    const ang = Math.atan2(1.32, roofRun);
    slope.rotation.x = sz * ang;
    slope.position.set(0, ridgeY - 0.66, (BZ0 + BZ1) / 2 + sz * roofRun / 2);
    g.add(slope);
  }
  const ridge = mesh(box(roofW, 0.20, 0.30), MAT.ridge, { name: 'stableRidge', cast: true });
  ridge.position.set(0, ridgeY + 0.06, (BZ0 + BZ1) / 2); g.add(ridge);
  // 两山面（把屋顶与墙之间的三角补齐，免得从侧面看进屋架）
  for (const sx of [-1, 1]){
    const gab = mesh(box(0.22, 1.4, BZ1 - BZ0 + 0.2), MAT.wall, { name: 'stableGable', cast: true });
    gab.position.set(sx * BX, colH + 0.55, (BZ0 + BZ1) / 2); g.add(gab);
  }

  /* ③ 厩内：4 个隔栏马位（栏板高 1.25）+ 每栏一个石食槽（槽内干草）*/
  const stallX = [-4.4, -2.2, 0, 2.2, 4.4];
  for (let i = 0; i < stallX.length; i++){
    const x = stallX[i];
    if (i > 0 && i < stallX.length - 1){
      const div = mesh(box(0.10, 1.25, BZ1 - BZ0 - 0.3), MAT.woodDark, { name: 'stallDivider', cast: true });
      div.position.set(x, 0.63, (BZ0 + BZ1) / 2 + 0.1); g.add(div);
    }
    if (i < stallX.length - 1){
      const cxm = (stallX[i] + stallX[i + 1]) / 2;
      const tr = makeTrough(1.5, 0.42, 0.32, MAT.stoneDark, MAT.straw, 0.10);
      tr.position.set(cxm, 0, BZ1 - 0.55); g.add(tr);
    }
  }
  // 正面栏门：每间一道矮横杆（可开合的栏——用一根横木表示，读得出"关着马"）
  for (let i = 0; i < stallX.length - 1; i++){
    const cxm = (stallX[i] + stallX[i + 1]) / 2;
    const bar = mesh(box(2.0, 0.09, 0.09), MAT.wood, { name: 'stallBar', cast: true });
    bar.position.set(cxm, 1.02, BZ0 + 0.18); g.add(bar);
    for (const s of [-1, 1]){
      const st = mesh(box(0.08, 1.05, 0.08), MAT.woodDark, { name: 'stallBarPost' });
      st.position.set(cxm + s * 1.0, 0.53, BZ0 + 0.18); g.add(st);
    }
  }

  /* ④ 4 匹马：2 匹在厩内隔栏里（骝色 + 白色）、2 匹在院中（黑色 + 栗色，其中一匹备鞍）*/
  const inStall = [
    { x: (stallX[1] + stallX[2]) / 2, z: BZ1 - 1.5, yaw: Math.PI, mat: MAT.horseChestnut },
    { x: (stallX[3] + stallX[4]) / 2, z: BZ1 - 1.5, yaw: Math.PI, mat: MAT.horseWhite },
  ];
  for (const h of inStall){
    const horse = makeHorse(h.mat);
    horse.position.set(h.x, 0, h.z); horse.rotation.y = h.yaw;
    g.add(horse);
  }
  /* 院中的两匹：一匹拴在西侧拴马桩旁（备鞍、面东）、一匹在院心**低头就着草料**（面西，朝马夫）
     —— 低头那一匹（graze）是"马夫在喂草料"这组动作的另一半：人伸手递草、马低头就食。 */
  const hitched = makeHorse(MAT.horseBlack, { saddle: true });
  hitched.position.set(-5.0, 0, -1.2); hitched.rotation.y = Math.PI / 2;      // 面 +x（东）
  g.add(hitched);
  const fed = makeHorse(MAT.horseChestnut, { graze: 0.78 });
  fed.position.set(0.9, 0, -0.2); fed.rotation.y = -Math.PI / 2;              // 面 −x（西，朝马夫）
  g.add(fed);

  /* ⑤ 两驾双轮马车：并排停在院中偏后（−z 朝园），驾辕朝前（−z）*/
  for (const sx of [-3.4, 3.4]){
    const car = makeCarriage();
    car.position.set(sx, 0, -2.3);
    car.rotation.y = 0;                                                       // 辕朝 −z
    g.add(car);
  }

  /* ⑥ 院用杂物：石水槽、草料堆、两根拴马桩 */
  const wt = makeTrough(1.3, 0.6, 0.42, MAT.stoneDark, MAT.stone);
  wt.position.set(6.3, 0, -1.0); g.add(wt);
  // 草料堆：三四个压扁球叠成一堆 + 散落几根
  for (let i = 0; i < 4; i++){
    const s = mesh(new THREE.SphereGeometry(0.62 - i * 0.10, 8, 6), MAT.straw, { name: 'hayMound', cast: true });
    s.position.set(-6.2 + (i % 2) * 0.30, 0.34 + i * 0.26, -3.1 + (i % 2) * 0.22);
    s.scale.set(1.15, 0.72, 1.0); g.add(s);
  }
  for (const z of [-2.0, -0.4]){
    const post = mesh(new THREE.CylinderGeometry(0.085, 0.10, 1.35, 8), MAT.woodDark, { name: 'hitchPost', cast: true });
    post.position.set(-5.6, 0.68, z); g.add(post);
    const ring = mesh(new THREE.TorusGeometry(0.075, 0.018, 4, 8), MAT.harness, { name: 'hitchRing' });
    ring.position.set(-5.6, 1.05, z); ring.rotation.y = Math.PI / 2; g.add(ring);
  }
  // 草料篮（马夫脚边那只，与手里的草料呼应）
  const basket = mesh(new THREE.CylinderGeometry(0.30, 0.24, 0.34, 10, 1, true), MAT.bambooBlind,
    { name: 'feedBasket', cast: true });
  basket.position.set(2.0, 0.17, -0.75); basket.material.side = THREE.DoubleSide; g.add(basket);
  const basketHay = mesh(new THREE.SphereGeometry(0.24, 7, 5), MAT.straw, { name: 'feedBasketHay' });
  basketHay.position.set(2.0, 0.30, -0.75); basketHay.scale.set(1, 0.55, 1); g.add(basketHay);

  /* ⑦ 矮木栅围院：西/东两侧 + 正面（正面中间留 3.6m 的车门）
        栅栏 = 立柱 + 两道横杆；逐根 mesh（装配期 mergeStatics 会按材质并成世界桶，不涨 draw call）*/
  const FW = PW / 2 - 0.2, FD = PD / 2 - 0.2, postH = 1.2;
  const runFence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.7));
    for (let i = 0; i <= n; i++){
      const k = i / n;
      const p = mesh(box(0.10, postH, 0.10), MAT.woodDark, { name: 'fencePost', cast: true });
      p.position.set(x0 + (x1 - x0) * k, postH / 2, z0 + (z1 - z0) * k); g.add(p);
    }
    for (const y of [0.52, 0.98]){
      const r = mesh(box(len, 0.075, 0.06), MAT.wood, { name: 'fenceRail', cast: true });
      r.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      r.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
      g.add(r);
    }
  };
  runFence(-FW, -FD, -1.8, -FD);          // 正面西段
  runFence(1.8, -FD, FW, -FD);            // 正面东段（中间 3.6m 是车门）
  runFence(-FW, -FD, -FW, FD);            // 西侧
  runFence(FW, -FD, FW, FD);              // 东侧

  g.userData.stable = { cx, cz, baseY };
  return g;
}
