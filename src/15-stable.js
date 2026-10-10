// 15-stable: 院外马厩（2026-10-09/10 · 老黄："在院子的外围区域设计一个马厩，用于主人的出行或者
//   客人到访，需要做一个可以停 4 匹马匹的马厩，2 驾 2 轮马车（2 匹马拉），再设计一个马夫在帮忙
//   给马喂草料或者帮马匹梳理毛皮"）
//
//   ── 选址（实测两轮）──────────────────────────────────────────────────────
//   **东侧院外 (40, −2)**，院身朝西（对着园子）。三块外围全扫过（outputs/_diag/stable-east.mjs /
//   stable-flat.mjs）：东侧足迹高差 **0.275~0.36** 比南侧（0.383）更平，且 60m 长的东墙外只有它；
//   5 个取样点从 12m 高向下射线**只命中 ground** ⇒ 无遮挡、无既有物件。
//   老黄 2026-10-10："马厩的位置移到院子围墙的右侧去" ⇒ 从默认机位（朝北）看，"右侧"= 东 ✅
//   配套：**地面东扩**（07-ground 的 PlaneGeometry 由 W+26 收到 W+44，见那里的注释）——
//   否则马厩会压在地面边缘上（旧地面 x 只到 43、院身要占到 44.5）。
//
//   ── 建在草皮上（2026-10-10 · 老黄："扩大外部草皮的面积，让马厩建在草皮上"）──
//   旧版给整个 16×9 场院铺了一块**抬高的石台基**（厚 1.1m），在草坡上露出一圈垂直台帮 ——
//   出图判读"灰色平台被抬在绿色草地之上、像悬浮台"。现在改成：
//     · **只在厩身下**垫一块低矮的石明（plinth，顶面只比该处草皮高 0.12m，厚 0.55m 全埋）；
//     · **场院地面保持草皮**（不铺石）；院里的马、车、栅栏、水槽**逐个按自己脚下的
//       实测地形高**落位（`gy()` 逐点采样）⇒ 草坡起伏被如实跟随，不再有"一块平板浮在草上"。
//
//   ── 马的编成（2026-10-10 · 老黄四条）────────────────────────────────────
//     ① **一驾马车套着两匹马、处于待发状态**（马在辕里、车头朝院门）；
//     ② **另一驾卸了马**（车辕抬起、两边支着）、两匹马在院里**休息吃草**，马夫给其中
//        一匹递草料；
//     ③ **4 个关马的槽位只有 2 匹**（空两个）—— 厩内 2 匹 + 辕里 2 匹 + 院中 2 匹 = 6 匹。
//   ⇒ 共 6 匹马，靠**毛色**区分（骝/黑/白/栗/青 —— 见 01-materials 的 horse* 材质表）。
import { THREE, GLTFLoader } from '../vendor.js';
import { mesh, box, makeColumn, makeLatticePanel } from './03-factory.js';
import { MAT } from './01-materials.js';
import { groundHeight } from './05-water.js';
import { tubeRadiusRamp } from './06-vegetation.js';
import { renderer } from './02-scene.js';
/* 换马必须让阴影图重渲一次（见 loadStableHorses 末尾的说明）——
   09-lights 不 import 本模块，方向单纯，不会成环。 */
import { markCasterBoxDirty } from './09-lights.js';

/* ── 真马模型（2026-10-10 · 老黄："你至少去网站上帮我下个 3d 的马吧，哪怕低模的也行，
      然后再帮我绘制几种典型的马的颜色"）─────────────────────────────────────────
   资产来路（全部记在案，便于复核/换源）：
     · 先试了下 three.js 官方示例那匹 `Horse.glb`（CC0 系、984 面）—— 实测它的 **15 个形变帧
       全是奔跑姿态、没有站姿**，不能当马厩里的站马（outputs/_diag/horse/morph/sheet*.png）。
     · 免费 CC0 库里带站姿的（Quaternius Farm/Animated Animal Pack）下载页要登录、拿不到直链。
     ⇒ 最终用 **AI 生成**（Rodin Gen-2.5-Medium，prompt 明确"四蹄落地、安静站立"），
       再转 GLB（`assets/HorseRodin.glb` → 减面后落到 `assets/Horse.glb`）。
     · 该模型**没有贴图**（单材质纯色）⇒ "绘制几种典型的马的颜色"就是逐匹给材质上色
       （六色表见 01-materials 的 horse* 系列），不需要改贴图。
   ⚠️ 模型是**静态网格**（无骨骼/动画）⇒ 做不出"低头吃草"的颈部动作，
      那两匹"休息"的马在画面里就是**站着低头不看草**——用马夫递草料 + 地上干草把story补上。
   ⚠️ 失败必须留替身：加载不成（离线/404）就保留下面的**程序化马**（项目既有约定：
      芭蕉/荷花都这么做），否则马厩会变成空厩。 */
const HORSE_GLB = 'assets/Horse.glb';
/* 模型自带的朝向修正：生成模型的"正面"不一定朝 +z（本项目程序化马的头朝 +z）。
   实测（outputs/_diag/horse-view.html 五视图 + 坐标轴参考线：front/back/right/top 四视图
   一致指向"头朝 +z"）⇒ 与程序化马同向，**不用转**。 */
let HORSE_FACE_YAW = 0;
/* 真马的总高（蹄底→耳尖）。⚠️ 别按"肩高"归一：模型包围盒的 Y 就是**总高**，
   而马厩里所有配件都是照程序化替身配的（替身耳尖 ~1.74m、体长 ~1.9m），
   归一成 1.5（= 肩高）会让真马比柱子/横轭/马车**小一大圈**。取 1.75 ⇒ 体长 ~1.94m，
   与替身逐项对齐（槽位、横轭 1.60、挽带 0.92、车厢前沿）。 */
const HORSE_TOTAL_H = 1.75;
/* ── 低头（吃草/就食）：把"颈+头"绕颈根的 X 轴向下转 ────────────────────────
   ⚠️ 真模型是**静态单网格**（无骨骼），所以只能在**几何**上做。参数是
     outputs/_diag/horse-view.html?graze=1 六格侧视对照实测出来的：
       · 25° = 微微低头（"就着马夫手里的草料"）；35° = 明显的低头吃草；45° 略过头；
       · **63° 以上立刻读成"脖子被压扁/折断"**（环状管在急转处自交）——所以上限锁 45°。
     枢轴 (y0.04, z0.13) 是"颈在胸口上的根"（模型局部坐标，包围盒 y∈[−0.451,0.451]）；
     权重 = z 门 × y 门，**y 门是为了不碰前腿**（腿在 y<0.05）。 */
function bendHeadDown(geo, deg){
  const th = deg * Math.PI / 180, p = geo.attributes.position;
  const PY = 0.04, PZ = 0.13;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < p.count; i++){
    const y = p.getY(i), z = p.getZ(i);
    const w = sm(0.13, 0.30, z) * sm(0.06, 0.20, y);
    if (w <= 0) continue;
    const dy = y - PY, dz = z - PZ, a = th * w;
    p.setY(i, PY + dy * Math.cos(a) - dz * Math.sin(a));
    p.setZ(i, PZ + dy * Math.sin(a) + dz * Math.cos(a));
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
}
export function loadStableHorses(stableGroup){
  const slots = stableGroup && stableGroup.userData && stableGroup.userData.horseSlots;
  if (!slots || !slots.length) return null;
  new GLTFLoader().load(HORSE_GLB, (gltf) => {
    const src = gltf.scene;
    /* 归一：按包围盒缩到 HORSE_TOTAL_H 高，脚底落在 y=0，头朝 +z */
    let bb = new THREE.Box3().setFromObject(src);
    const size = new THREE.Vector3(); bb.getSize(size);
    const s = HORSE_TOTAL_H / Math.max(1e-6, size.y);
    src.scale.setScalar(s);
    src.rotation.y = HORSE_FACE_YAW;
    src.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(src);
    src.position.y -= bb.min.y;                       // 脚底贴地
    src.updateMatrixWorld(true);
    for (const slot of slots){
      const inst = src.clone(true);
      /* 低头吃草那两匹：真模型没有骨骼 ⇒ 在**几何**上把"颈+头"转下去
         （替身的 headG 那套旋转只对程序化马有效，真模型没有 headG）。
         35° 是六格侧视对照里"明显低头吃草且无畸形"的那一档；见 bendHeadDown 的注释。 */
      if (slot.graze > 0.05){
        inst.traverse(o => {
          if (!o.isMesh) return;
          o.geometry = o.geometry.clone();          // ⚠️ 必须克隆：六匹马共享同一份几何
          bendHeadDown(o.geometry, Math.round(slot.graze * 57.2958 * 0.75));
        });
      }
      /* 逐匹上色（六种典型马色）：模型单材质 ⇒ 直接改 color。
         ⚠️ 必须**克隆材质**：共享材质会让六匹马同色（而且 12f 的季节通道按材质同一性认领，
            这里不进季节表，但克隆仍是必须的）。 */
      const base = slot.color || MAT.horseChestnut;
      inst.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.copy(base.color || new THREE.Color(0x7A4423));
        o.material.metalness = 0.0;
        o.material.roughness = 0.78;
        o.material.envMapIntensity = 0.35;
        o.material.map = null;                        // 模型自带 PBR 贴图是空的，别留引用
        o.material.needsUpdate = true;
        o.castShadow = true;
        o.userData.noMerge = true;                    // 异步进来、错过 mergeStatics，显式标一下
      });
      /* 替身换成真模型：把程序化马摘掉（连同它的 userData.horse 标记），加真马。
         ⚠️ userData.horse 要跟着走 —— 装配自检/探针按它数马（本文件与 08 都用）。 */
      slot.holders.forEach(h => { slot.group.remove(h); });
      inst.userData.horse = true;
      slot.group.add(inst);
      slot.holders = [inst];
    }
    /* ⚠️⚠️ 换完马**必须让阴影图重渲一次**（2026-10-10 补）：
       `renderer.shadowMap.autoUpdate` 是 **false**（09-lights 的既定取舍：静态阴影只渲一次，
       省每帧一整张 2048²/6144² 的深度图）。本回调是**异步**的 —— 它在启动期的阴影图快照
       **之后**才把真马放进场，若不置脏：
         · 地板/草地上的马腿影子仍是**程序化替身那批**（真马已经换掉了 ⇒ 影子与马对不上，
           远看就是"地板上几道说不清来路的暗条"）；
         · 真马自己**完全投不出影子**，站在石板上像贴图。
       两件事都不是"画错"，是**阴影快照过期**，只能靠重渲修。 */
    markCasterBoxDirty();                            // 投射物集合变了（程序化马→真马，包围盒也变）
    renderer.shadowMap.needsUpdate = true;           // 补渲一次整张阴影图
  }, undefined, () => { /* 加载失败：保留程序化替身，不抛错 */ });
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
export function makeCarriage(opts = {}){
  const g = new THREE.Group();
  const wood = MAT.woodDark, trim = MAT.wood, strap = MAT.harness;
  const detached = !!opts.detached;
  const wheel = (sx, z) => {
    const w = new THREE.Group();
    w.add(mesh(new THREE.TorusGeometry(0.55, 0.045, 6, 20), wood, { name: 'wheelRim', cast: true }));
    for (let i = 0; i < 10; i++){
      const sp = mesh(box(0.035, 0.50, 0.030), trim, { name: 'wheelSpoke' });
      const a = (i / 10) * Math.PI * 2;
      sp.position.set(-Math.sin(a) * 0.25, Math.cos(a) * 0.25, 0);
      sp.rotation.z = -a;
      w.add(sp);
    }
    const hub = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.10, 10), wood, { name: 'wheelHub' });
    hub.rotation.x = Math.PI / 2; w.add(hub);
    w.position.set(sx * 0.62, 0.55, z);
    w.rotation.y = Math.PI / 2;
    return w;
  };
  g.add(wheel(-1, 0)); g.add(wheel(1, 0));
  const axle = mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.42, 8), wood, { name: 'carriageAxle' });
  axle.rotation.z = Math.PI / 2; axle.position.set(0, 0.55, 0); g.add(axle);
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
  const canopy = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.86, 14, 1, true, 0, Math.PI), MAT.bambooBlind,
    { name: 'carriageCanopy', cast: false });
  canopy.rotation.z = Math.PI / 2; canopy.rotation.y = Math.PI / 2;
  canopy.position.set(0, bedY + 0.42, -0.30); canopy.material.side = THREE.DoubleSide;
  g.add(canopy);
  /* 车辕：**单马**用"双辕"（两根杆夹住一匹马的两侧）；**两匹马并排**要用
     「**中央辕杆（pole）+ 横轭（yoke）**」—— 辕杆从两马**中间**穿过、横轭横在两马颈上，
     这才是双马套车的真实结构。
     ⚠️⚠️ 2026-10-10 四轮定案：原来给"套两匹马"的车也做了双辕，而双辕的横向位置恰好落在
        两匹马的**身体中线**上 ⇒ 辕杆直接从马身里穿过去（出图判读"看不到辕木、辕/轮插在马身上"
        —— 其实是**结构用错**，不是位置偏）。 */
  const lift = detached ? 0.42 : 0.0;
  if (opts.pair){
    /* ⚠️ 辕杆从车轴高度**抬升到两马颈顶之上**（车局部 y≈1.60）。
       上一版整条杆在 bedY+0.02~0.20 ⇒ 横轭落在马胸口以下、被马身挡住（"看不到辕杆"）；
       改成抬到颈高 1.32 后，轭木又**横穿马颈**（马颈 y 区间 1.19~1.60，轭在 1.32 正中）。
       ⇒ 真实**颈轭**是：轭木**搭在两马颈顶之上**、下面挂两道**弓形枷**卡住颈侧。
       这里 yokeY = bedY + 0.88 ≈ 1.60（颈顶之上），枷从轭垂到 1.16（颈侧下方）。 */
    const pole = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, bedY + 0.02, 0.50),
      new THREE.Vector3(0, bedY + 0.42, 1.30),
      new THREE.Vector3(0, bedY + 0.86, 2.05),
    ]), 8, 0.048, 6, false), wood, { name: 'carriagePole', cast: true });
    g.add(pole);
    const yokeY = bedY + 0.88;
    const yoke = mesh(box(1.24, 0.11, 0.11), wood, { name: 'carriageYoke', cast: true });
    yoke.position.set(0, yokeY, 1.98); g.add(yoke);
    for (const sx of [-1, 1]){                     // 两道颈枷：各自夹在一匹马颈的两侧
      for (const s2 of [-1, 1]){
        const post = mesh(box(0.07, 0.46, 0.07), wood, { name: 'yokePost', cast: true });
        post.position.set(sx * 0.40 + s2 * 0.19, yokeY - 0.24, 1.98); g.add(post);
      }
    }
  } else {
    for (const sx of [-1, 1]){
      const shaftCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 0.40, bedY - 0.02, 0.55),
        new THREE.Vector3(sx * 0.40, bedY + 0.10 + lift * 0.6, 1.30),
        new THREE.Vector3(sx * 0.42, bedY + 0.22 + lift, 2.05),
      ]);
      g.add(mesh(new THREE.TubeGeometry(shaftCurve, 8, 0.042, 6, false), wood, { name: 'carriageShaft', cast: true }));
    }
    const yoke = mesh(box(0.92, 0.07, 0.07), wood, { name: 'carriageYoke', cast: true });
    yoke.position.set(0, bedY + 0.24 + lift, 1.98); g.add(yoke);
  }
  if (detached){
    // 支辕棍：一根斜撑把抬起的辕头托住（真实停车做法）
    for (const sx of [-1, 1]){
      const prop = mesh(box(0.06, 0.62, 0.06), wood, { name: 'shaftProp', cast: true });
      prop.position.set(sx * 0.42, 0.31, 1.72); prop.rotation.x = -0.28; g.add(prop);
    }
  } else if (!opts.pair){
    // 单马套车：两根缰绳从辕头垂到马侧
    for (const sx of [-1, 1]){
      const rein = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 0.30, bedY + 0.44, 0.42),
        new THREE.Vector3(sx * 0.42, bedY + 0.30, 1.20),
        new THREE.Vector3(sx * 0.44, bedY + 0.20, 1.85),
      ]);
      g.add(mesh(new THREE.TubeGeometry(rein, 8, 0.014, 4, false), strap, { name: 'carriageRein', cast: false }));
    }
  }
  g.userData.carriage = true;
  return g;
}

/* ── 草料捆（马夫手里那捆）──────────────────────────────────────────────────
   ⚠️ 尺寸按**可读性**定，不按实物：第一版 8cm 粗在 10~20m 只有 1~2px
      ⇒ 出图判读"手边没有草料"；加粗到 ~12cm、0.34m 长才读得出。 */
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

/* ── 石槽（食槽 / 水槽共用）：上开口的石箱 ───────────────────────────────── */
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
  const fill = mesh(box(w - t * 2, 0.05, d - t * 2), fillMat || MAT.straw, { name: 'troughFill', cast: false });
  fill.position.set(0, fillY, 0); g.add(fill);
  return g;
}

/* ── 马厩整组 ────────────────────────────────────────────────────────────────
   局部坐标：原点 = 场院中心；**−z 朝园子（正面/院门方向）**、+z 是厩身。
   调用：`makeStable(cx, cz, { yaw })`，组放在 (cx, 0, cz) 并绕 y 转 yaw。
   **组自身的 y = 0**，所有竖向位置都由 `gy()`（逐点实测地形高）现算 ⇒ 场地跟着草坡走。 */
export function makeStable(cx, cz, opts = {}){
  const g = new THREE.Group();
  const yaw = opts.yaw || 0;
  g.position.set(cx, 0, cz);
  g.rotation.y = yaw;

  /* 局部 (lx,lz) → 世界，再取该处地形高 —— 逐个物件落在**自己脚下**的草皮上 */
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const gy = (lx, lz) => groundHeight(cx + lx * cy + lz * sy, cz - lx * sy + lz * cy);

  /* ① 厩身：6 柱 5 间、正面敞开；进深 3.8、面阔 9.4、檐高 3.2 */
  const BX = 4.7, BZ0 = 0.6, BZ1 = 4.4, colH = 3.2;
  /* **低石明**（plinth）：只在厩身底下，顶面 = 该区最高草皮 + 0.12，厚 0.55（全埋）
     —— 这是"建在草皮上"的关键：不再给整个院子铺抬高的台基。 */
  /* **低石明**（plinth）：只在厩身底下。
     ⚠️ 2026-10-10 二轮（出图判读"建筑坐在抬高的石台板上、台板与草地交接生硬"）：
        ① 露出高度从 "最高草皮 + 0.12" 收到 **+0.04**（几乎与草面相平）；
        ② 厚度**按足迹地形落差自适应**（= 落差 + 0.12）⇒ 底面必定埋进最低处草皮之下，
           不会在坡下侧露出悬空缝；③ 于是台帮最多露出一圈 ~0.3m 的矮石脚
           （真实马厩就是这个做法），而不是一块抬高的板。 */
  let maxG = -1e9, minG = 1e9;
  for (let lx = -BX - 0.4; lx <= BX + 0.4; lx += 1.2)
    for (let lz = BZ0 - 0.3; lz <= BZ1 + 0.3; lz += 0.9){
      const y = gy(lx, lz);
      if (y > maxG) maxG = y;
      if (y < minG) minG = y;
    }
  const plinthTop = maxG + 0.04;
  const plinthH = (maxG - minG) + 0.12;
  /* ⚠️ 石明**只比厩身footprint大 0.12m**（2026-10-10 三轮：出图判读"建筑浮在一块抬高的
     石台板上"—— 上一版比 footprint 大 1.0m，于是顶面露出一圈 0.5m 宽的灰白围裙，
     读成"月台"而不是"矮石脚"）。现在只在墙根外露一圈 12cm 的石沿，
     厚度按落差自适应 ⇒ 坡下侧也不会有悬空缝。 */
  const plinth = mesh(box(BX * 2 + 0.24, plinthH, BZ1 - BZ0 + 0.24), MAT.stoneDark, { name: 'stablePlinth', cast: true, receive: true });
  plinth.position.set(0, plinthTop - plinthH / 2, (BZ0 + BZ1) / 2); g.add(plinth);
  /* 墙根一圈**土石散脚**（小石块 + 暗色土沿）：把"石明与草地"那条生硬直角边打散 ——
     出图判读两次都点这条（"草地像被矩形布尔切出来、边缘锐利"）。 */
  for (let i = 0; i < 26; i++){
    const a = (i / 26) * Math.PI * 2, rx = BX + 0.30 + (i % 3) * 0.16, rz = (BZ1 - BZ0) / 2 + 0.30 + (i % 2) * 0.14;
    const lx = Math.cos(a) * rx, lz = (BZ0 + BZ1) / 2 + Math.sin(a) * rz;
    const st = mesh(new THREE.SphereGeometry(0.10 + (i % 4) * 0.035, 6, 5), MAT.stoneDark, { name: 'plinthSkirt', cast: false });
    st.position.set(lx, gy(lx, lz) + 0.05, lz);
    st.scale.set(1.25, 0.6, 1.0);
    st.rotation.y = a;
    g.add(st);
  }
  const P0 = plinthTop;                       // 厩身从石明顶面起

  const colX = [-4.4, -2.64, -0.88, 0.88, 2.64, 4.4];
  for (const x of colX){
    const c = makeColumn(colH, 0.185);
    c.position.set(x, P0 + colH / 2, BZ0 + 0.18); g.add(c);
    const cb = mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.16, 10), MAT.stoneDark, { name: 'stableColBase' });
    cb.position.set(x, P0 + 0.08, BZ0 + 0.18); g.add(cb);
  }
  /* ⚠️ 墙高必须**顶到屋顶底下**（2026-10-10 修，老黄："马厩的地板会有光线在闪烁"）：
     原来写的是 `colH − 0.5`（墙顶 2.85），而屋顶下皮在那条线上是 **3.48** ⇒ 后墙与两山墙
     上方留了一条 **9.4m × 0.62m 的贯通洞口**；太阳从东/东南斜射进来，在地板上投出一条
     长亮带（还被两榀梁切成几段）—— 亮带边缘是阴影图的阶梯，**镜头一动就闪**。
     真实杂役房的墙是砌到檐口的（通风靠窗，不靠墙顶那道缝），所以把墙加到 `colH + 0.40`
     （顶到屋面线下、被梁枋挡住），洞口消失。 */
  const wallH = colH + 0.40;
  const backWall = mesh(box(BX * 2, wallH, 0.24), MAT.wall, { name: 'stableBackWall', cast: true });
  backWall.position.set(0, P0 + wallH / 2, BZ1); g.add(backWall);
  const vent = makeLatticePanel(3.4, 0.72, 5, 2);
  vent.position.set(0, P0 + colH - 0.85, BZ1 - 0.14); g.add(vent);
  /* ⚠️⚠️ 通风窗**必须自己投影**（2026-10-10 修，老黄："这个马厩的地板会有光线在闪烁"）。
     `makeLatticePanel` 的衬板（"关着的门扇：纸/木板，**不透**"）默认是 `cast:false` ——
     视觉上不透，**阴影图里却是空的**：太阳从东边斜射进来，穿过这块"板"、只被格心的
     5×2 横竖棂挡住 ⇒ 厩内**石地板上被投出一格一格的亮斑**（真实的格子阴影）。
     它落在正对窗户那片石板上，边缘是 2048²/6144² 阴影图的阶梯，**镜头一动就闪** ——
     这就是老黄看到的现象。真马厩的冬天可是把窗堵上的：让它投影即修（衬板本来就是不透板）。 */
  vent.traverse(o => { if (o.isMesh) o.castShadow = true; });
  for (const sx of [-1, 1]){
    const sideWall = mesh(box(0.24, wallH, BZ1 - BZ0), MAT.wall, { name: 'stableSideWall', cast: true });
    sideWall.position.set(sx * BX, P0 + wallH / 2, (BZ0 + BZ1) / 2); g.add(sideWall);
  }
  for (const z of [BZ0 + 0.18, BZ1]){
    const beam = mesh(box(BX * 2 + 0.3, 0.30, 0.22), MAT.wood, { name: 'stableBeam', cast: true });
    beam.position.set(0, P0 + colH + 0.15, z); g.add(beam);
  }
  /* 屋顶：悬山（两坡 + 正脊）——马厩是杂役房，硬/悬山才对（歇山是厅堂形制） */
  const roofW = BX * 2 + 1.1, roofRun = 2.42, ridgeY = P0 + colH + 1.32;
  for (const sz of [-1, 1]){
    const slope = mesh(new THREE.BoxGeometry(roofW, 0.16, roofRun), MAT.roof, { name: 'stableRoof', cast: true });
    const ang = Math.atan2(1.32, roofRun);
    slope.rotation.x = sz * ang;
    slope.position.set(0, ridgeY - 0.66, (BZ0 + BZ1) / 2 + sz * roofRun / 2);
    g.add(slope);
  }
  /* 正脊：⚠️ 必须**压到两坡端头之下**（2026-10-10 修，老黄："马厩的地板会有光线在闪烁"）。
     两坡是 box 绕 X 转 ±ang 得到的，它们的**内端头**落在 (z=2.352 / 2.648, y=ridgeY−0.08)
     ⇒ 两坡之间在 z∈[2.35,2.65]、y∈[ridgeY−0.08, 脊底] 有一条 **0.30m×0.04m 的贯通缝**。
     原来脊木放在 ridgeY+0.06（底 = ridgeY−0.04）⇒ 缝**没被盖住**：太阳从缝里漏下来，
     在地板上投出一条 10.5m 长的亮带 —— 而这条缝只有 4cm 高，在 2048²/6144² 的阴影图里
     根本分辨不了 ⇒ **镜头一动亮带就忽隐忽现**（用户看到的"地板光线在闪烁"）。
     现在脊木下压 0.16、加深到 0.34（底 = ridgeY−0.27，比坡端头低 0.19）⇒ 彻底封住，
     顺带在屋内读成一根**脊檩**（真实木构本来就有）。 */
  const ridge = mesh(box(roofW, 0.34, 0.36), MAT.ridge, { name: 'stableRidge', cast: true });
  ridge.position.set(0, ridgeY - 0.10, (BZ0 + BZ1) / 2); g.add(ridge);
  for (const sx of [-1, 1]){
    const gab = mesh(box(0.22, 1.4, BZ1 - BZ0 + 0.2), MAT.wall, { name: 'stableGable', cast: true });
    gab.position.set(sx * BX, P0 + colH + 0.55, (BZ0 + BZ1) / 2); g.add(gab);
  }

  /* **马的槽位**：每匹马都装在一个"槽位组"里（位置 + 朝向），组内先放**程序化替身**，
     真模型加载成功后原地换成真马（见本文件顶部的 loadStableHorses）。
     ⇒ 好处：无论真模型到没到，位置/朝向/落地只有一处真值；失败时画面不空。 */
  const horseSlots = [];
  const addHorseSlot = (lx, lz, y, yaw, colorMat, opts2 = {}) => {
    const grp = new THREE.Group();
    grp.position.set(lx, y, lz);
    grp.rotation.y = yaw;
    const ph = makeHorse(colorMat, opts2);          // 程序化替身（真模型到了就换掉）
    grp.add(ph);
    g.add(grp);
    const slot = { group: grp, color: colorMat, holders: [ph], graze: opts2.graze || 0 };
    horseSlots.push(slot);
    return slot;
  };
  /* ⚠️⚠️ 马的槽位（连同挂在槽位里的挽具）**必须 noMerge**（2026-10-10 补，真 bug）：
     `mergeStatics(root)` 在**延迟批结束时**跑，而马厩是在延迟批里建的 ⇒ 程序化替身的
     几何会被**烘进 mergedStatic**（applyMatrix4 烘世界矩阵后成为一个大网格），而
     mergeStatics 把源网格从场景图里摘掉、**几何却留在合并结果里**。
     于是 loadStableHorses 的 `slot.group.remove(h)` 只摘掉了一个空壳 —— 真马进来之后，
     场上是 **6 只程序化马 + 6 只真马叠在同一个位置**：
       · 两套马体互相穿插 → 腿/腹部的深度在相交处来回翻转（**镜头一动就"闪"**）；
       · 地板/草地上永远是**替身那批马腿的影子**（阴影图快照，见 loadStableHorses 末尾）；
       · 用户报的"马厩地板有光影在闪"正是这两条的合成。
     noMerge 是 mergeStatics 唯一的豁免口径（`if (o.userData.noMerge)`），逐网格判定、
     **不继承父级** ⇒ 必须遍历到每个 mesh 上打标。 */
  const markNoMerge = (root) => { root.traverse(o => { if (o.isMesh) o.userData.noMerge = true; }); };
  g.userData.horseSlots = horseSlots;

  /* ② 厩内 4 个隔栏马位 + 每栏一个石食槽；**只占 2 个**（老黄："4 个槽位只有两匹马"）*/
  const stallX = [-4.4, -2.2, 0, 2.2, 4.4];
  for (let i = 0; i < stallX.length; i++){
    const x = stallX[i];
    if (i > 0 && i < stallX.length - 1){
      const div = mesh(box(0.10, 1.25, BZ1 - BZ0 - 0.3), MAT.woodDark, { name: 'stallDivider', cast: true });
      div.position.set(x, P0 + 0.63, (BZ0 + BZ1) / 2 + 0.1); g.add(div);
    }
    if (i < stallX.length - 1){
      const cxm = (stallX[i] + stallX[i + 1]) / 2;
      const tr = makeTrough(1.5, 0.42, 0.32, MAT.stoneDark, MAT.straw, 0.10);
      tr.position.set(cxm, P0, BZ1 - 0.55); g.add(tr);
      const bar = mesh(box(2.0, 0.09, 0.09), MAT.wood, { name: 'stallBar', cast: true });
      bar.position.set(cxm, P0 + 1.02, BZ0 + 0.18); g.add(bar);
      for (const s of [-1, 1]){
        const st = mesh(box(0.08, 1.05, 0.08), MAT.woodDark, { name: 'stallBarPost' });
        st.position.set(cxm + s * 1.0, P0 + 0.53, BZ0 + 0.18); g.add(st);
      }
    }
  }
  /* **厩内 2 匹**（占第 1、3 栏；第 2、4 栏空着）—— 空槽位里放地上的干草，读作"空闲马位" */
  for (const [sx0, col] of [[(stallX[0] + stallX[1]) / 2, MAT.horseChestnut], [(stallX[2] + stallX[3]) / 2, MAT.horseWhite]]){
    addHorseSlot(sx0, BZ1 - 1.5, P0, Math.PI, col);
  }
  for (const i of [1, 3]){                                                    // 空位：散一堆干草
    const cxm = (stallX[i] + stallX[i + 1]) / 2;
    const hay = mesh(new THREE.SphereGeometry(0.42, 8, 6), MAT.straw, { name: 'stallEmptyHay', cast: true });
    hay.position.set(cxm, P0 + 0.22, BZ1 - 1.4); hay.scale.set(1.2, 0.5, 1.0); g.add(hay);
  }

  /* ③ 院场（z ∈ [−4.5, 0.5]）：**草地**，物件逐点落在自己脚下的草皮上 */
  const yardY = (lx, lz) => gy(lx, lz);

  /* ③a 两驾马车：A 套着两匹马**待发**（车头朝院门 = −z）、B **卸了马**（车辕抬起、支辕棍） */
  const carA = makeCarriage({ pair: true });     // 双马套车：中央辕杆 + 横轭
  const carAY = yardY(-3.0, -1.4);
  carA.position.set(-3.0, carAY, -1.4); carA.rotation.y = Math.PI;   // +z（辕）→ 局部 −z（院门）
  g.add(carA);
  const carB = makeCarriage({ detached: true });
  const carBY = yardY(3.0, -0.9);
  carB.position.set(3.0, carBY, -0.9); carB.rotation.y = Math.PI;
  g.add(carB);
  /* ③b 套在 A 辕里的两匹马（站在辕前、与车同向 = 面朝院门 −z）
     ⚠️ 2026-10-10 二轮（出图判读"车辕悬空、未套马"）：
        ① 马的横向位置**对准辕木**（辕在车中心 ±0.40 ⇒ 马就站在那两条线上）；
        ② 每匹加一条**挽带**（从辕木拉到马肚的短带）——"套着"这件事必须有个可见的连接件，
           否则两匹站着的马 + 两根伸着的辕只会读成"车与马各自摆着"。 */
  for (const sx of [-1, 1]){
    const hx = -3.0 + sx * 0.40;
    /* ⚠️⚠️ 落点按"**肩颈对准横轭**"反算（2026-10-10 四轮）：轭在车局部 z=1.98 ⇒ 院局部
       z = −1.4 − 1.98 = **−3.38**；马朝 −z，肩颈在"马心 −0.55"处 ⇒ 马心要在 **−2.85**。
       上一版马心放在 −3.8 ⇒ 轭落在**马的臀部后面**（读作"马与车脱钩、轭插在马身上"）。
       同时马臀（马心 +0.78 = −2.05）离车厢前沿（−2.01）留 0.2m 缝 ⇒ 不再车马相撞。 */
    const hz = -2.85;
    const hy = yardY(hx, hz);
    const slot = addHorseSlot(hx, hz, hy, Math.PI, sx < 0 ? MAT.horseBlack : MAT.horseBay);
    /* 挽具挂在**槽位组**里（跟着替身一起被换掉）：部件是按程序化马的脖径/腹径配的，
       换成真模型后尺寸对不上会穿模 —— 那时"套车"靠辕杆 + 横轭表达，一样成立。 */
    const girth = mesh(new THREE.TorusGeometry(0.235, 0.024, 4, 12), MAT.harness, { name: 'harnessGirth' });
    girth.position.set(0, 0.92, 0); girth.scale.set(1, 0.82, 1);
    slot.group.add(girth); slot.holders.push(girth);
    for (const t of [-1, 1]){
      const trace = mesh(box(0.05, 0.05, 0.62), MAT.harness, { name: 'harnessTrace', cast: false });
      trace.position.set(t * 0.18, 0.80, 0.55);
      trace.rotation.set(0.10, t * 0.08, 0);
      slot.group.add(trace); slot.holders.push(trace);
    }
    const collar = mesh(new THREE.TorusGeometry(0.185, 0.034, 4, 12), MAT.wood, { name: 'harnessCollar' });
    collar.position.set(0, 1.42, -0.42);
    collar.rotation.x = 0.42; collar.scale.set(1, 1.12, 1);
    slot.group.add(collar); slot.holders.push(collar);
  }
  /* ③c 卸下来的两匹：一匹**低头吃草**、一匹由马夫**递草料**（都在 B 车那一侧）
     ⚠️ fed 马要放在**栅栏以内**（栅栏在 z=−4.7），且把马头那侧留给马夫站 ——
        马朝 −z 低头时头在 −z 侧，马夫站在它头前 0.75m（见下面的 groom 落点）。 */
  /* ⚠️ 落点实测修正（2026-10-10 四轮）：吃草那匹原来在 local (4.5,−3.3) ⇒ 前半身伸进
     B 车（卸马那驾）的包围盒（x 重叠 0.19m / z 0.66m）—— 出图判读成"车轮压在马腹下"。
     退到 (4.6,−3.9) 完全分开。 */
  addHorseSlot(4.6, -3.9, yardY(4.6, -3.9), -Math.PI / 2, MAT.horseGrey, { graze: 0.82 });
  addHorseSlot(1.5, -2.8, yardY(1.5, -2.8), Math.PI, MAT.horseBay, { graze: 0.52 });

  /* ③d 院用杂物：石水槽、草料堆、两根拴马桩、草料篮 */
  const wt = makeTrough(1.3, 0.6, 0.42, MAT.stoneDark, MAT.stone);
  wt.position.set(-5.0, yardY(-5.0, -0.6), -0.6); g.add(wt);
  for (let i = 0; i < 4; i++){
    const s = mesh(new THREE.SphereGeometry(0.62 - i * 0.10, 8, 6), MAT.straw, { name: 'hayMound', cast: true });
    s.position.set(-5.4 + (i % 2) * 0.30, yardY(-5.4, -2.9) + 0.34 + i * 0.26, -2.9 + (i % 2) * 0.22);
    s.scale.set(1.15, 0.72, 1.0); g.add(s);
  }
  for (const z of [-2.2, -0.4]){
    const post = mesh(new THREE.CylinderGeometry(0.085, 0.10, 1.35, 8), MAT.woodDark, { name: 'hitchPost', cast: true });
    post.position.set(-5.5, yardY(-5.5, z) + 0.66, z); g.add(post);
    const ring = mesh(new THREE.TorusGeometry(0.075, 0.018, 4, 8), MAT.harness, { name: 'hitchRing' });
    ring.position.set(-5.5, yardY(-5.5, z) + 1.03, z); ring.rotation.y = Math.PI / 2; g.add(ring);
  }
  const basket = mesh(new THREE.CylinderGeometry(0.30, 0.24, 0.34, 10, 1, true), MAT.bambooBlind,
    { name: 'feedBasket', cast: true });
  basket.position.set(2.6, yardY(2.6, -2.6) + 0.17, -2.6); basket.material.side = THREE.DoubleSide; g.add(basket);
  const basketHay = mesh(new THREE.SphereGeometry(0.24, 7, 5), MAT.straw, { name: 'feedBasketHay' });
  basketHay.position.set(2.6, yardY(2.6, -2.6) + 0.30, -2.6); basketHay.scale.set(1, 0.55, 1); g.add(basketHay);

  /* ④ 矮木栅围院：正面留 3.6m 车门（对准套车那驾）、两侧 + 后侧沿厩身 */
  const FW = BX + 0.9, FD = 4.7, postH = 1.2;
  const runFence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.7));
    for (let i = 0; i <= n; i++){
      const k = i / n, lx = x0 + (x1 - x0) * k, lz = z0 + (z1 - z0) * k;
      const p = mesh(box(0.10, postH, 0.10), MAT.woodDark, { name: 'fencePost', cast: true });
      p.position.set(lx, yardY(lx, lz) + postH / 2, lz); g.add(p);
    }
    for (const y of [0.52, 0.98]){
      const r = mesh(box(len, 0.075, 0.06), MAT.wood, { name: 'fenceRail', cast: true });
      r.position.set((x0 + x1) / 2, yardY((x0 + x1) / 2, (z0 + z1) / 2) + y, (z0 + z1) / 2);
      r.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
      g.add(r);
    }
  };
  runFence(-FW, -FD, -1.8, -FD);          // 正面西段
  runFence(1.8, -FD, FW, -FD);            // 正面东段（中间 3.6m 车门）
  runFence(-FW, -FD, -FW, FD);            // 西侧
  runFence(FW, -FD, FW, FD);              // 东侧

  /* 马夫站位（供 08-assemble 回填人物用）：站在**低头受喂那匹马的头前 0.75m**、
     面朝局部 +z（也就是朝马嘴），栅栏（z=−4.7）**以内**。 */
  const groomLocal = [1.5, -4.35];
  /* ⚠️ 打 noMerge 必须放在**所有槽位内容都挂完之后**（挽具是在上面的循环里挂进 slot.group 的）——
     放在 addHorseSlot 里会漏掉挽具，那些件照样被烘进 mergedStatic 而永远摘不掉。 */
  for (const s of horseSlots) markNoMerge(s.group);
  g.userData.stable = {
    cx, cz, yaw, plinthTop,
    groom: { x: cx + groomLocal[0] * cy + groomLocal[1] * sy,
             y: 0, z: cz - groomLocal[0] * sy + groomLocal[1] * cy },
    horses: 6,
  };
  g.userData.stable.groom.y = groundHeight(g.userData.stable.groom.x, g.userData.stable.groom.z);
  return g;
}
