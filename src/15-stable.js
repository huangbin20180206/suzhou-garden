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
import { THREE, GLTFLoader, mergeGeometries } from '../vendor.js';
import { mesh, box, makeColumn, makeLatticePanel } from './03-factory.js';
import { MAT, pavingNormalTex, registerWeatherRoles } from './01-materials.js';
import { groundHeight } from './05-water.js';
import { tubeRadiusRamp } from './06i-trees.js';
/* GLB 复用入口（院外石板路旁的石灯笼，2026-10-17）。⚠️ 06e 不 import 本模块 ⇒ 不成环。 */
import { loadAssetOnce } from './06e-assets.js';
import { renderer, scene, camera } from './02-scene.js';
/* 季节门控（冬天才有口鼻白雾）走 ENV —— 方向单纯（12-env 不 import 本模块，见它的 import 表），
   所以直接 import，不必像 12b/12c 那样开注入槽。 */
import { ENV } from './12-env.js';
/* 马的"生活"用**私有随机流**（铁律 1：绝不吃全局 rnd/rr；运行期也不能碰，
   否则会改变其后所有按序抽样的布局）。 */
import { mulberry32, HOOKS } from './00-config.js';
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
/* ══ 给真马"补零件 + 上花纹"（2026-10-11 · 老黄："我看到的马依旧没有眼睛，没有嘴巴，
   没有鬃毛，没有灵活的尾巴……而且所有的马都是单一颜色的，这个在自然界也很难存在吧"）
   ══════════════════════════════════════════════════════════════════════════════
   先把事实摆清（outputs/_diag/glb-stat.mjs 实测）：`assets/Horse.glb` 是 Tripo 生成的
   **单网格 6049 顶点 / 5609 三角**低模，材质只有一个 baseColorFactor（**纯色**），
   文件里唯一那张图叫 `model_Normal_Bake`、**没有任何材质引用它**（571KB，占整个文件 72%）
   ⇒ 想要眼睛/鬃毛/尾巴/花纹，**只能自己补**（不换资产的前提下）。

   ── 两条做法（都很关键）────────────────────────────────────────────────────
   ① **补件并进马的同一份几何**（不是挂在组上）：这样 horseWeights 的部位门、
      bakeHorseShading 的明暗、bendHeadDown 的低头、installHorseRig 的伪蒙皮
      **全都自动照顾到它** —— 鬃毛跟着脖子一起低下去、尾巴跟着尾根一起甩。
   ② **上色从"单色乘子"改成"逐顶点烘绝对颜色"**：原来顶点色是"乘在材质色上的明暗系数"，
      而乘子**只能压暗、不能提亮** ⇒ **白斑/白袜这种"比底色亮"的花纹根本做不出来**
      （黑马配白袜在数学上就不可能）。现在把最终颜色（底色 × 明暗 × 花纹 × 鬃尾蹄口鼻）
      直接烘进 color 属性、材质色置白 ⇒ 白斑白袜、深鬃深尾都能成立。
   ⚠️ 三条纪律：① 只用**私有随机流**、且确定性；② 锚点**实测**（眼睛/鼻孔先在网格里
      找"那一小片最近顶点"取质心）——手填坐标换模型就静默错位；③ 颜色用 THREE.Color
      直接写（它已经在工作空间=线性），别自己再转一次。 */

/** 锥形管：沿折线放圈、半径逐点给（补件的基本积木：发丝/尾巴）。 */
function taperedTube(pts, radii, radial = 5){
  const pos = [], nrm = [], uv = [], idx = [];
  const N = pts.length, up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++){
    const tan = pts[Math.min(i + 1, N - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    let n1 = new THREE.Vector3().crossVectors(tan, up);
    if (n1.lengthSq() < 1e-8) n1 = new THREE.Vector3(1, 0, 0);
    n1.normalize();
    const n2 = new THREE.Vector3().crossVectors(tan, n1).normalize();
    for (let k = 0; k < radial; k++){
      const a = (k / radial) * Math.PI * 2;
      const d = n1.clone().multiplyScalar(Math.cos(a)).addScaledVector(n2, Math.sin(a));
      pos.push(pts[i].x + d.x * radii[i], pts[i].y + d.y * radii[i], pts[i].z + d.z * radii[i]);
      nrm.push(d.x, d.y, d.z);
      uv.push(k / radial, i / Math.max(1, N - 1));
    }
  }
  for (let i = 0; i < N - 1; i++)
    for (let k = 0; k < radial; k++){
      const k2 = (k + 1) % radial;
      idx.push(i * radial + k, (i + 1) * radial + k, i * radial + k2,
               i * radial + k2, (i + 1) * radial + k, (i + 1) * radial + k2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 把一个近似锚点"吸"到真实表面上：取**最近的 n 个顶点求质心**。
    ⚠️⚠️ n 必须小（一般取 1~3）！取 36 个顶点的质心会在**凸面上落到曲面内侧** ——
    本轮实测：眼睛/鼻孔按 36 点质心放 ⇒ 小球整颗**埋进头里**、出图判读"完全没有眼睛、
    没有鼻孔、没有嘴"（而代码明明建了）。取"最近的那一个顶点"就必定落在网格表面上。
    ⚠️ 但"最近顶点"对**侧面凸起件**仍不够用（见 sideSurfacePoint）：低模上离目标最近的顶点
    常常落在**鼻梁/顶面**上，于是侧面件的 |x| 只落到 0.035、而那一带的侧面其实在 0.079 ⇒ 照旧埋进去。 */
function snapAnchor(geo, p, n = 1){
  const pos = geo.attributes.position, cand = [];
  for (let i = 0; i < pos.count; i++){
    const dx = pos.getX(i) - p[0], dy = pos.getY(i) - p[1], dz = pos.getZ(i) - p[2];
    cand.push([dx * dx + dy * dy + dz * dz, i]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  let sx = 0, sy = 0, sz = 0;
  const k = Math.min(n, cand.length);
  for (let i = 0; i < k; i++){ const j = cand[i][1]; sx += pos.getX(j); sy += pos.getY(j); sz += pos.getZ(j); }
  return [sx / k, sy / k, sz / k];
}

/** 取"**侧表面点**"：在 |y−ty|<dy 且 |z−tz|<dz 的顶点里挑 **|x| 最大**的那个（= 那一带最外侧的面）。
    眼睛/鼻孔这类"贴在头侧"的件必须用它 —— 这就是上面那条坑的正解。 */
function sideSurfacePoint(geo, ty, tz, dy = 0.05, dz = 0.05){
  const p = geo.attributes.position;
  let best = null, bx = -1;
  for (let i = 0; i < p.count; i++){
    if (Math.abs(p.getY(i) - ty) > dy || Math.abs(p.getZ(i) - tz) > dz) continue;
    const ax = Math.abs(p.getX(i));
    if (ax > bx){ bx = ax; best = [ax, p.getY(i), p.getZ(i)]; }
  }
  return best || [0.06, ty, tz];
}

/** 取"**最下缘点**"：在 |x|<dx 且 |z−tz|<dz 的顶点里挑 y 最小的（口鼻下缘 = 嘴的位置）。 */
function lowestSurfacePoint(geo, tz, dz = 0.035, dx = 0.030){
  const p = geo.attributes.position;
  let best = null, by = 1e9;
  for (let i = 0; i < p.count; i++){
    if (Math.abs(p.getX(i)) > dx || Math.abs(p.getZ(i) - tz) > dz) continue;
    if (p.getY(i) < by){ by = p.getY(i); best = [0, p.getY(i), p.getZ(i)]; }
  }
  return best || [0, 0.15, tz];
}

/* 补件的**近似锚点**（模型局部、头朝 +z）。
   ⚠️⚠️ 这些数是**量出来的**（outputs/_diag/horse-landmarks.mjs 直接读 GLB 的 POSITION，
      逐 z 切片给"顶面 y / |x|max"）—— 手填错了整整两轮（第一轮眼睛埋进头里、
      第二轮"突兀的黑球位置偏"），量完才看清这只模型的真实姿态：
        颈脊线（顶面 y）：z0.02→0.234 · z0.12→0.322 · z0.22→0.383 · z0.32→0.414 · z0.42→0.445
        头：z∈[0.30,0.52]；**口鼻在最低最前**（z≈0.50、y≈0.13~0.18、|x|≤0.038）
        ——它是"头略低"的站姿，脸从枕部 (z0.42,y0.45) 斜向前下方。 */
const HORSE_ANCHOR_APPROX = {
  eye:     [0.065, 0.350, 0.435],                 // 头侧、枕后稍前（会吸附到表面）
  nostril: [0.030, 0.178, 0.492],                 // 口鼻端侧面偏上
  mouth:   [0.000, 0.146, 0.503],                 // 口鼻端下缘
  crest:   [[0, 0.239, 0.025], [0, 0.322, 0.125], [0, 0.383, 0.225],
            [0, 0.414, 0.325], [0, 0.445, 0.415]], // 颈脊 → 枕（鬃毛贴在它上）
};

/** 补件：鬃毛 + 尾巴 + 眼睛 + 鼻孔 + 嘴。返回 { geometry, anchor }（anchor 给上色用）。 */
export function decorateHorseGeometry(srcGeo, seed = 1){
  const r = mulberry32(20261012 + seed * 7919);        // 私有流：确定性（同一匹每次一样）
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  const parts = [];
  const ANCH = {};
  /* ⚠️ 三个锚点各用**合适的查询**，不能一律"最近顶点"（本轮踩坑两次）：
       眼/鼻 ⇒ 侧面最外点；嘴 ⇒ 口鼻下缘最低点。
     ⚠️⚠️ 窗口必须**收紧**：第一版给 dy/dz = 0.05 ⇒ 眼睛的查询把**面颊**（z≈0.37 处 |x|≈0.10）
        当成了"头侧最外点"、眼位整体后移埋进腮里。收紧到 ±0.03 才是"眼睛那一小块"的局部侧面。 */
  ANCH.eye     = sideSurfacePoint(geo, HORSE_ANCHOR_APPROX.eye[1], HORSE_ANCHOR_APPROX.eye[2], 0.030, 0.030);
  ANCH.nostril = sideSurfacePoint(geo, HORSE_ANCHOR_APPROX.nostril[1], HORSE_ANCHOR_APPROX.nostril[2], 0.025, 0.022);
  ANCH.mouth   = lowestSurfacePoint(geo, HORSE_ANCHOR_APPROX.mouth[2], 0.040, 0.032);
  ANCH.crestTop = snapAnchor(geo, [0, HORSE_ANCHOR_APPROX.crest[2][1], HORSE_ANCHOR_APPROX.crest[2][2]], 1);

  /* ① 鬃毛：沿颈脊向下垂的**有厚度毛束**。
     ⚠️⚠️ 2026-10-16 修（老黄红框⑤："鬃尾发片"）——
       旧版虽然用了圆管，但 11 绺都从同一条 x=0 的脊线、沿同一个方向下垂，
       侧面看成了一排贴在一起的窄片；根因不是颜色，而是**没有横向层次和弯曲**。
       改成 9 绺、每绺独立的 x 偏移/长度/弯曲，根部加粗、尖端收细，
       让它读成一束有体积的散毛。r() 只来自本函数的私有流，不碰全局布局随机数。 */
  const crestCurve = new THREE.CatmullRomCurve3(
    HORSE_ANCHOR_APPROX.crest.map(c => new THREE.Vector3(c[0], c[1], c[2])));
  const down = new THREE.Vector3(0, -0.88, -0.48).normalize();
  const maneSide = new THREE.Vector3(0.72, -0.34, 0.08).normalize();
  for (let i = 0; i < 9; i++){
    const u = i / 8;
    const p0 = crestCurve.getPointAt(u);
    const side = (i - 4) * 0.004 + (r() - 0.5) * 0.010;
    const len = 0.105 + 0.040 * r();
    const bend = (r() - 0.5) * 0.030;
    const root = p0.clone().addScaledVector(maneSide, side);
    const p1 = root.clone().addScaledVector(down, len * 0.45)
      .addScaledVector(maneSide, bend * 0.45);
    const p2 = root.clone().addScaledVector(down, len)
      .addScaledVector(maneSide, bend)
      .add(new THREE.Vector3(0, 0, -0.010 - 0.008 * r()));
    parts.push(taperedTube([root, p1, p2], [0.022, 0.014, 0.003], 6).toNonIndexed());
  }

  /* ② 尾巴：**尾根埋进臀内 4cm 再往外长**（否则出图判读"尾巴生硬地插进臀部、下半截悬空脱节"），
     主要**向下垂**（真马尾巴接近垂直，不是斜向后 40°），主干粗、散毛贴拢 ⇒ 读作"一束"而不是"几根带子"。
     ⚠️⚠️ 2026-10-16 修（老黄红框④："马尾巴和后腿这里多出来的是什么"）——
       上一版渲出来是**一块扁平板**，读作"马屁股后面插了块木板"。三处成因一起改：
         ① 散毛只 4 根、横向发散 sin(a)*0.30 被 normalize 之后的 y/z 分量压得几乎为 0
            ⇒ 7 根全挤在同一个垂直平面里 = 平板；横向系数 0.30 → **0.52**、根数 4 → **7**；
         ② 垂向不够：back 的 z 分量 −0.44 让尾巴"斜着往后戳"，改成 **−0.34**（更贴垂直）；
         ③ 主干太细（0.038 起）在 15m 外只剩一条线 ⇒ 加到 **0.042** 起、径向段数 6 → 7。
       改后尾束横向铺开约 0.27m、垂长约 0.65m，侧看是"一束垂毛"、后看是"一片散开"。
       ⚠️ 本段用私有流 r()（bare 调用，不带区间参数）；增删 r() 的调用次数只影响尾巴自身的确定性，
          碰不到全局 rnd ⇒ 不漂布局指纹。 */
  const tailRoot = snapAnchor(geo, [0, 0.230, -0.445], 1);
  ANCH.tailRoot = tailRoot;
  const back = new THREE.Vector3(0, -0.93, -0.34).normalize();
  const rootIn = new THREE.Vector3(tailRoot[0], tailRoot[1] + 0.030, tailRoot[2] + 0.045);
  {
    const pts = [rootIn.clone(), rootIn.clone().addScaledVector(back, 0.08),
      rootIn.clone().addScaledVector(back, 0.20), rootIn.clone().addScaledVector(back, 0.33)];
    parts.push(taperedTube(pts, [0.042, 0.034, 0.027, 0.014], 7).toNonIndexed());
  }
  for (let i = 0; i < 7; i++){
    const a = (i / 6 - 0.5) * 0.95;
    const dir = new THREE.Vector3(Math.sin(a) * 0.52, back.y, back.z).normalize();
    const len = 0.30 + 0.06 * r();
    const p0 = rootIn.clone().addScaledVector(back, 0.12);
    const pts = [p0.clone(), p0.clone().addScaledVector(dir, len * 0.5), p0.clone().addScaledVector(dir, len)];
    parts.push(taperedTube(pts, [0.018, 0.014, 0.004], 6).toNonIndexed());
  }

  /* ③ 眼睛 ④ 鼻孔 —— ⚠️⚠️ 2026-10-16 定案：**不再加几何**，改由顶点色画（见 bakeHorseShading ⑦）。
     为什么推翻了前面所有"加/缩/沉一颗球"的做法：
       读 assets/Horse.glb 证实这匹模型 **1 mesh / 1 material / 无 baseColorTexture（只有法线图）**
       ⇒ 它**根本没画眼睛**，而低模头壳上**没有眼窝**这种结构来接住一颗球。
       于是球心无论怎么摆（贴表面 / 外推 / 内沉），那颗球都必然**有一半露在体外**：
       实测（probe/_tmp-horse-darkclust.mjs 对合并几何做近黑顶点聚类）——
       鼻孔球那一簇的质心离马体最近的非黑顶点 **0.060 局部 = 11.7cm 世界**，
       出图就是一粒**悬在口鼻前面的黑豆**（老黄红框①"是贴片还是悬空的"、②"休息的马两个悬空的点"）。
       而**烘进顶点色的暗斑**画在**马体原有顶点**上 ⇒ 从构造上就不可能悬空、不可能凸出，
       且零新增三角形、零新增 draw call。低模上一块深色斑就是马眼，远看完全够用。
       ⇒ 眼睛/鼻孔的**形状与颜色全交给 bakeHorseShading ⑦**，本函数不再产出这两件。
     （历史留档：0.030/+0.006 金鱼突眼 → 0.019/+0.004 悬空球 → 0.017/−0.004 仍是球 ——
      三次都在"加几何"这条路上打转，根因是**这颗球本来就不该存在**。） */

  /* ⑤ 嘴：仍是**一根细长方体**（3cm 高的一线），因为它落在口鼻**最下缘的棱**上，
     那里顶点太稀，纯靠顶点色画不出一条连贯的嘴线。薄片贴着下缘走 ⇒ 不会像球那样凸出。 */
  {
    const g = new THREE.BoxGeometry(0.066, 0.013, 0.020).toNonIndexed();
    g.translate(ANCH.mouth[0], ANCH.mouth[1] + 0.006, ANCH.mouth[2]);   // 抬一点 ⇒ 恰好切在口鼻下缘
    parts.push(g);
  }

  const merged = mergeGeometries([geo, ...parts], false);
  if (!merged) throw new Error('马补件合并失败（属性集不一致？）');
  merged.computeBoundingBox();
  return { geometry: merged, anchor: ANCH };
}

/* ── 马的"部位权重"（2026-10-11）· 一份区域划分，同时供两件事用 ─────────────────
   ① **逐部位上色**（治"白膜"：鬃/尾/四肢/蹄要能看出是**另一块颜色**，而不是通体一色）；
   ② **逐部位动作**（低头吃草 / 摇尾 / 抬蹄 / 抬头抖颈）—— 真马是单网格无骨骼，
      只能靠"区域权重 + 绕枢轴旋转"。
   分界怎么定的：把 6049 个顶点投影成侧影图实测出来的（outputs/_diag/horse-shape.mjs），
   模型局部包围盒 x∈[−0.14,0.14] y∈[−0.451,0.451] z∈[−0.5,0.5]，**头朝 +z**：
     · 头颈： z>0.13 且 y>0.06（沿用 bendHeadDown 那套门，枢轴 (y0.04, z0.13)）
     · 尾：   z<−0.42（后躯最末端）——⚠️ 不能只看 z：后腿在 z≈−0.35..−0.20，会混进来
     · 四条腿：y<−0.10（腹下线以下；实测**腹底在 y≈−0.12**，所以这条门不会啃到肚子）
                且 |x|>0.045（腿长在两侧，肚子是中间那一片）
     · 蹄：   y<−0.40（腿的最下段）
   ⚠️ 所有门都是**平滑门**（smoothstep）而不是硬阈值 —— 硬切会在关节处留一条折痕。 */
export function horseWeights(geo){
  const p = geo.attributes.position, N = p.count;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const w = { head: new Float32Array(N), tail: new Float32Array(N),
              legF: new Float32Array(N), legH: new Float32Array(N),
              hoof: new Float32Array(N), mane: new Float32Array(N), muzzle: new Float32Array(N) };
  for (let i = 0; i < N; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    /* ⚠️⚠️ 2026-10-16 修（老黄红框②："休息的马怎么还有两个悬空的点"）——
       头部门的 y 阈值原来是 sm(0.06, 0.20, y)：**口鼻一带（y≈0.13~0.19）只拿到 0.4~0.55 权重**。
       而装饰补件（嘴盒 y≈0.128、鼻孔球 y≈0.185）正是长在口鼻上的 ⇒ 低头时它们**只转一半**。
       吃草/受喂那两匹 graze 0.80~0.95（≈34~41°），补件落后 ~15cm 悬在半空 ——
       就是出图里"马嘴前面飘着两颗黑豆"。阈值下压到 sm(0.00, 0.12, y)：
       口鼻（y≥0.12）拿满权重 1，整颗头连嘴带鼻一起转，不再有落后件。
       ⚠️ 不影响躯干/腿：z 门 sm(0.13, 0.30, z) 先把颈以前的顶点挡在外面了。 */
    w.head[i]   = sm(0.13, 0.30, z) * sm(0.00, 0.12, y);
    /* ⚠️ 2026-10-11 修：y 门原来是 sm(0.16,0.02,y) —— 而侧影实测（outputs/_diag/horse-shape.mjs）
       尾根落在 **y≈0.17~0.26** 那一带 ⇒ 旧门在 y>0.16 处权重为 0，**尾巴上半截根本不跟着转**，
       摇尾只剩根部一小块在动，远看就是"尾巴没动"。放宽到 sm(0.36,0.08,y)，
       并补一道 |x| 窄门（尾巴很细，别把后躯带进来）。 */
    w.tail[i]   = sm(-0.36, -0.44, z) * sm(0.36, 0.08, y) * sm(0.16, 0.07, Math.abs(x));
    const down  = sm(-0.10, -0.18, y);            // 腹下线以下
    const side  = sm(0.02, 0.055, Math.abs(x));   // 两侧（中间是肚子）
    w.legF[i]   = down * side * sm(0.02, 0.16, z);   // 前腿：z 大的一侧
    w.legH[i]   = down * side * sm(-0.02, -0.18, z); // 后腿：z 小的一侧
    w.hoof[i]   = sm(-0.36, -0.43, y);
    /* 鬃：颈背那条脊线 —— 头颈区里"靠上、靠中"的一窄条（|x| 小 + y 高）
       ⚠️ 2026-10-11 补：光靠"y 高"抓不到**鬐甲那头**的鬃（那里 y 只有 0.14~0.26），
       而程序化补的鬃毛是从鬐甲一路铺到枕的 ⇒ 再过一道"离颈脊折线多近"的门，
       两式取大：这样整条鬃（含我刚补的发绺）都吃得到深色，脖子本体表面也不会被刷成一片黑。 */
    let dCrest = 1e9;
    for (let s = 0; s < HORSE_ANCHOR_APPROX.crest.length - 1; s++){
      const a = HORSE_ANCHOR_APPROX.crest[s], b = HORSE_ANCHOR_APPROX.crest[s + 1];
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const apx = x - a[0], apy = y - a[1], apz = z - a[2];
      const L = abx * abx + aby * aby + abz * abz;
      const u = L > 1e-9 ? Math.min(1, Math.max(0, (apx * abx + apy * aby + apz * abz) / L)) : 0;
      const dx2 = apx - abx * u, dy2 = apy - aby * u, dz2 = apz - abz * u;
      const d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
      if (d2 < dCrest) dCrest = d2;
    }
    dCrest = Math.sqrt(dCrest);
    w.mane[i]   = Math.max(w.head[i] * sm(0.22, 0.34, y) * sm(0.055, 0.02, Math.abs(x)),
                           sm(0.15, 0.055, dCrest) * sm(0.062, 0.028, Math.abs(x)));
    /* 口鼻：头的最前端一小圈（鼻口本来就近黑）*/
    w.muzzle[i] = sm(0.40, 0.47, z) * sm(0.30, 0.22, y);
  }
  return w;
}
/* 各部位的**枢轴**（模型局部坐标）：绕它转才像关节，绕原点转会把部件甩出去。
   腿的枢轴由该部位的顶点质心现算（不同模型不用手填）。
   ⚠️ 2026-10-11：**尾枢轴必须改成"尾根"**，不能再取尾部质心 —— 补了那条长尾巴之后，
      质心会落到尾巴中段，绕它转就成了"螺旋桨自转"而不是"从尾根甩尾"。
      做法：在尾部区域里取 z 最大（最靠身体）的那一片顶点的均值。 */
export function horsePivots(geo, w){
  const p = geo.attributes.position;
  const ctr = (arr, thr) => { let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = 0; i < p.count; i++){ if (arr[i] > thr){ sx += p.getX(i); sy += p.getY(i); sz += p.getZ(i); n++; } }
    return n ? [sx / n, sy / n, sz / n, n] : [0, 0, 0, 0]; };
  const [fx, , fz, fn] = ctr(w.legF, 0.5), [hx, , hz, hn] = ctr(w.legH, 0.5);
  let zRoot = -1e9, nTail = 0;
  for (let i = 0; i < p.count; i++){ if (w.tail[i] > 0.5){ nTail++; if (p.getZ(i) > zRoot) zRoot = p.getZ(i); } }
  let ty = 0, tz = -0.44, tn = 0;                       // 尾根那一片（z 最大的 3cm 内）的均值
  if (nTail){
    for (let i = 0; i < p.count; i++)
      if (w.tail[i] > 0.5 && p.getZ(i) > zRoot - 0.03){ ty += p.getY(i); tz += 0; tn++; }
    tz = Math.min(-0.36, zRoot); ty = tn ? ty / tn : 0.20;
  }
  return {
    neck: [0, 0.04, 0.13],                                  // 颈根（bendHeadDown 同款）
    tail: [0, ty, tz],                                      // 尾根（尾区域最靠身体的那一片）
    legF: [fn ? fx : 0.10, -0.06, fn ? fz : 0.20],          // 前腿：肩，落在腹线略上
    legH: [hn ? hx : 0.10, -0.06, hn ? hz : -0.28],         // 后腿：胯
  };
}
/* ── 逐顶点烘**绝对颜色**（2026-10-10 起，2026-10-11 改成绝对色 + 花纹）──────────
   真马是**单网格、无贴图**（GLB 里那张图是没人引用的 normal-bake）⇒ 颜色只能自己烘。
   ⚠️⚠️ 为什么必须是"绝对色"而不是"乘子"：早期版本把顶点色当**乘在材质色上的明暗系数**，
      而乘子**只能压暗、不能提亮** ⇒ **白斑/白袜这种"比底色亮"的花纹在数学上做不出来**
      （黑马配白袜不可能）。现在把最终颜色直接写进 color 属性、材质色置白 ⇒ 花纹成立。
   叠加顺序（每一步都写清为什么）：
     ① 高度明暗（背亮腹暗、蹄压一档）
     ② 鬃 / 尾 / 口鼻压深（典型马色本来就是"浅身 + 深鬃尾"）
     ③ **白袜**（膝下）—— 必须在④之前，否则白袜会被蹄的压深盖掉（真马是"白腿 + 黑蹄"）
     ④ 蹄压深
     ⑤ **白斑**（额到鼻梁的窄条）
     ⑥ **斑纹/兔褐**（确定性位置噪声，破除"平涂塑料感"）
     ⑦ 眼睛 / 鼻孔 / 嘴：离补件的**实测锚点**近的直接压成近黑
   ⚠️ 上限 1.0（超过会把浅色推过 bloom 阈值糊成白片 —— 本项目在"高画质白屏"上吃过亏）。 */
export function bakeHorseShading(geo, w, opts = {}){
  const p = geo.attributes.position;
  const W = w || horseWeights(geo);
  const base = (opts.base instanceof THREE.Color) ? opts.base.clone() : new THREE.Color(opts.base || 0x7A4423);
  const mark = opts.mark || {};
  const ANCH = opts.anchor || null;
  const WHITE = new THREE.Color(0xEFE9DE), EYEC = new THREE.Color(0x140F0C), NOSEC = new THREE.Color(0x2A1E19);
  let ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < p.count; i++){ const y = p.getY(i); if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  const span = Math.max(1e-6, ymax - ymin);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const d2 = (ax, ay, az, x, y, z) => { const dx = x - ax, dy = y - ay, dz = z - az; return dx * dx + dy * dy + dz * dz; };
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    c.copy(base);
    const t = (y - ymin) / span;                      // 0 = 蹄底、1 = 头顶
    c.multiplyScalar(0.55 + 0.45 * sm(0.06, 0.55, t));// ① 背亮腹暗
    if (W.mane[i]   > 0) c.multiplyScalar(1 - 0.52 * W.mane[i]);   // ② 鬃
    if (W.tail[i]   > 0) c.multiplyScalar(1 - 0.58 * W.tail[i]);   //    尾
    if (W.muzzle[i] > 0) c.multiplyScalar(1 - 0.18 * W.muzzle[i]); //    口鼻
    /* ③ 白袜：膝下（腿的部位权重 × 高度） */
    if (mark.socks){
      const lg = Math.max(W.legF[i], W.legH[i]);
      if (lg > 0) c.lerp(WHITE, 0.92 * mark.socks * lg * sm(-0.15, -0.28, y));
    }
    if (W.hoof[i] > 0) c.multiplyScalar(1 - 0.62 * W.hoof[i]);     // ④ 蹄（白袜之下的蹄仍要读到"蹄"）
    /* ⑤ 白斑：额头→鼻梁的一条窄带（宽 ±0.02 模型单位 ≈ 8cm 实宽） */
    if (mark.blaze){
      const bz = sm(0.27, 0.37, z) * sm(0.060, 0.020, Math.abs(x)) * sm(0.255, 0.300, y);
      if (bz > 0) c.lerp(WHITE, 0.94 * mark.blaze * bz);
    }
    /* ⑥ 斑纹（确定性，无随机流）：把平涂感打碎。所有马都给一个底噪（真马毛色本来就有微妙
       深浅），青灰/白马再叠加更强的一档。 */
    {
      const dd = mark.dapple === undefined ? 0.55 : Math.max(0.55, mark.dapple);
      const n = Math.sin(x * 57.1 + y * 31.7 + z * 43.3) * Math.sin(x * 23.9 - z * 67.3 + y * 11.3);
      c.multiplyScalar(1 + 0.17 * dd * n);
    }
    /* ⑦ 眼睛 / 鼻孔 / 嘴 —— ⚠️⚠️ 2026-10-16 起这三样**只靠顶点色**（几何侧的眼/鼻球已删，
       见 decorateHorseGeometry ③④ 的根因记录：那颗球无论怎么摆都必然凸出/悬空）。
       画在**马体原有顶点**上 ⇒ 构造上不可能悬空。
       两个细节：
         · **软边**（线性淡出）而不是硬圆 —— 硬边在低模上读作"贴了一张圆纸片"；
         · 眼睛按**沿头轴拉长**算距离（马眼是横条不是圆点），z 半径放大 1.5 倍；
           鼻孔稍窄一点（1.25 倍）。 */
    if (ANCH){
      const dEye = (ax) => { const dx = x - ax, dy = y - ANCH.eye[1], dz = (z - ANCH.eye[2]) / 1.5;
        return dx * dx + dy * dy + dz * dz; };
      const dNos = (ax) => { const dx = x - ax, dy = y - ANCH.nostril[1], dz = (z - ANCH.nostril[2]) / 1.25;
        return dx * dx + dy * dy + dz * dz; };
      const e = Math.min(dEye(ANCH.eye[0]), dEye(-ANCH.eye[0]));
      const nz = Math.min(dNos(ANCH.nostril[0]), dNos(-ANCH.nostril[0]));
      const m = d2(ANCH.mouth[0], ANCH.mouth[1], ANCH.mouth[2], x, y, z);
      const RE = 0.045, RN = 0.032, RM = 0.040;
      if (e < RE * RE) c.lerp(EYEC, 0.97 * Math.min(1, (1 - Math.sqrt(e) / RE) * 2.4));
      else if (nz < RN * RN) c.lerp(NOSEC, 0.90 * Math.min(1, (1 - Math.sqrt(nz) / RN) * 2.2));
      else if (m < RM * RM) c.lerp(NOSEC, 0.88 * Math.min(1, (1 - Math.sqrt(m) / RM) * 2.0));
    }
    col[i*3]     = Math.min(1, Math.max(0, c.r));
    col[i*3 + 1] = Math.min(1, Math.max(0, c.g));
    col[i*3 + 2] = Math.min(1, Math.max(0, c.b));
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}

/* ── 马的动作装置（2026-10-11 · 老黄："马低头吃草、尾巴摇晃一副悠闲的神态；辕里那两匹
      偶尔抬蹄、仰天抖颈；冬天口鼻喷白雾"）─────────────────────────────────────
   真模型**没有骨骼**（1 mesh / 无 skin / 无 animation —— 文件头那一节是实测），动作只有两条路：
     · CPU 逐顶点改写（6049 顶点 × 6 匹 × 每帧）—— 每帧毫秒级，犯不上；
     · **着色器伪蒙皮**：把 horseWeights 的六块区域烘成顶点属性，在顶点着色器里绕各自枢轴旋转，
       每匹马一套 uniform。CPU 每帧只写几个角度 ⇒ 成本≈0。
   本节用后者；六块 = 头颈 / 尾 / 前左腿 / 前右腿 / 后左腿 / 后右腿（左右按顶点 x 符号分）。
   ⚠️ 影子不动，而且是**有意**的：阴影图是静态只渲一次的（shadowMap.autoUpdate=false，见 09-lights）
      ⇒ 不会出现"影子里是另一个姿势"那种矛盾（近处小物件才看得出，马在 15~25m 外）。
   ⚠️ 三条纪律：① 只用**私有随机流**（可复现，且不碰全局 rnd/rr）；
   ② 所有角度**连续**（慢正弦 + 光滑包络），绝不用高频正弦直接打姿态 —— 这正是 2026-10-05
      "鹦鹉抽搐"的教训（每帧相位超过 ~0.8rad 就走样成乱抖）；③ 幅度按"远看读得出"给：
      15~25m 外 1° ≈ 4~7mm，所以姿态角都在 5° 以上。 */
function installHorseRig(mat, geo, W, piv){
  const P = { head: piv.neck, tail: piv.tail, legF: piv.legF, legH: piv.legH };
  mat.userData.rig = { head: new THREE.Vector2(0, 0), tail: new THREE.Vector2(0, 0),
                       leg: new THREE.Vector4(0, 0, 0, 0) };
  const N = geo.attributes.position.count, pos = geo.attributes.position;
  const A = new Float32Array(N * 4), B = new Float32Array(N * 2);
  for (let i = 0; i < N; i++){
    const x = pos.getX(i), L = x < 0 ? 1 : 0, R = x < 0 ? 0 : 1;
    A[i*4] = W.head[i]; A[i*4+1] = W.tail[i];
    A[i*4+2] = W.legF[i] * L; A[i*4+3] = W.legF[i] * R;
    B[i*2] = W.legH[i] * L;  B[i*2+1] = W.legH[i] * R;
  }
  geo.setAttribute('aRigA', new THREE.BufferAttribute(A, 4));
  geo.setAttribute('aRigB', new THREE.BufferAttribute(B, 2));
  mat.onBeforeCompile = (sh) => {
    /* ⚠️ uniform 的 value 直接指向 mat.userData.rig 里那几个向量 —— 于是每帧改
       `rig.head.x` 就等于改 uniform（不必去找 shader 对象；onBeforeCompile 只跑一次）。 */
    sh.uniforms.uHeadAng = { value: mat.userData.rig.head };
    sh.uniforms.uTailAng = { value: mat.userData.rig.tail };
    sh.uniforms.uLegAng  = { value: mat.userData.rig.leg };
    sh.uniforms.uPivHead = { value: P.head };
    sh.uniforms.uPivTail = { value: P.tail };
    sh.uniforms.uPivLegF = { value: P.legF };
    sh.uniforms.uPivLegH = { value: P.legH };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRigA;
        attribute vec2 aRigB;
        uniform vec2 uHeadAng; uniform vec2 uTailAng; uniform vec4 uLegAng;
        uniform vec3 uPivHead; uniform vec3 uPivTail; uniform vec3 uPivLegF; uniform vec3 uPivLegH;
        vec3 rigRX(vec3 p, vec3 pv, float a){ float c = cos(a), s = sin(a); vec3 d = p - pv;
          return vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c) + pv; }
        vec3 rigRY(vec3 p, vec3 pv, float a){ float c = cos(a), s = sin(a); vec3 d = p - pv;
          return vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c) + pv; }
      `)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3( position );
        if (aRigA.x > 0.002){ vec3 q = rigRX(transformed, uPivHead, uHeadAng.x); q = rigRY(q, uPivHead, uHeadAng.y); transformed = mix(transformed, q, aRigA.x); }
        if (aRigA.y > 0.002){ vec3 q = rigRY(transformed, uPivTail, uTailAng.x); q = rigRX(q, uPivTail, uTailAng.y); transformed = mix(transformed, q, aRigA.y); }
        if (aRigA.z > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegF, uLegAng.x), aRigA.z);
        if (aRigA.w > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegF, uLegAng.y), aRigA.w);
        if (aRigB.x > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegH, uLegAng.z), aRigB.x);
        if (aRigB.y > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegH, uLegAng.w), aRigB.y);
      `);
  };
  mat.needsUpdate = true;
}

/* ── 每匹马的"生活"状态（装完 rig 后登记；tickStableLife 每帧推）────────────── */
const HORSE_LIFE = [];
const _sr = mulberry32(20261011);          // 私有流：事件间隔/相位/抖颈方向
let _stT = 0;
export function horseLifeState(){
  return { n: HORSE_LIFE.length, t: +_stT.toFixed(2),
           horses: HORSE_LIFE.map(h => ({ role: h.role,
             headPitch: +h.mat.userData.rig.head.x.toFixed(3), headYaw: +h.mat.userData.rig.head.y.toFixed(3),
             tailYaw: +h.mat.userData.rig.tail.x.toFixed(3),
             leg: [...h.mat.userData.rig.leg].map(v => +v.toFixed(3)),
             breath: h.breath ? { live: h.breath.filter(b => b.life > 0).length } : null })) };
}

/* 冬天口鼻白雾（只给辕里那两匹）：**位置在 CPU 上按同一套枢轴/角度复算** —— 顶点是 GPU 改的、
   CPU 不知道，所以这里照抄同一套旋转公式算出**鼻端**，再乘槽位组的世界矩阵。
   ⚠️ 四个纪律：私有流（可复现）、`raycast=()=>{}`（别拦视线判定）、`userData.aoSkip`（不进 GTAO
   法线 pass，否则亮片被当成实体写成一块黑）、**不写任何全局灯光**（与闪电/烟花/流星同一条教训）。 */
export const horseBreathMesh = (() => {
  const MAXB = 26;
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  const grd = cx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grd.addColorStop(0.00, 'rgba(255,255,255,0.70)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0)');
  cx.fillStyle = grd; cx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.6 });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAXB);
  im.name = 'horseBreath';
  im.frustumCulled = false;
  im.raycast = () => {};
  im.userData.aoSkip = true;
  im.count = 0;
  return im;
})();

/* 每帧：① 推每匹马的姿态角；② 冬天喷白雾。dt 用主循环的仿真步长（与固定步长累加器同一根时钟）。 */
export function tickStableLife(dt){
  if (!HORSE_LIFE.length) return;
  _stT += Math.min(Math.max(dt, 0), 0.1);
  const t = _stT;
  const winter = ENV && ENV.season === 'winter';
  let puff = 0;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), PP = new THREE.Vector3();
  for (const h of HORSE_LIFE){
    const rig = h.mat.userData.rig, ph = h.phase;
    /* ① 底噪：所有马都有的慢微动。
       ⚠️⚠️ 2026-10-11 **全面加大**（老黄："马蹄和马尾会不规则动，也看不到"）——
       先证伪了"伪蒙皮没生效"：outputs/_diag/horse-rig-pixel.mjs 冻结帧 A/B 实测
       rig 角度 0 → 0.6rad **确实改了 2393 像素**（自检 0、可逆）⇒ 注入是好的。
       真因是**幅度太小**：上一版底噪 0.014 / 0.022 / 0.11 rad（= 0.8° / 1.3° / 6.3°），
       而「马厩」机位在 15~25m 外 —— 按上面那次实测的比例，0.03 rad 连 20 像素都不到，
       等于没动。现在按"远看读得出"重给（尾 ±17°、外加每 3.5~12s 一次 ±34° 大甩尾）。
       ⚠️ 频率仍受"鹦鹉抽搐"那条约束（每帧相位 < 0.8rad）：下面最高的角频率是
       sin(u*20)/1.8s ≈ 11 rad/s ⇒ 24fps 下 0.46 rad/帧，安全。 */
    let headPitch = 0.030 * Math.sin(t * 0.90 + ph);
    let headYaw   = 0.050 * Math.sin(t * 0.37 + ph * 1.7);
    let tailYaw   = 0.30 * Math.sin(t * 0.95 + ph) + 0.07 * Math.sin(t * 2.30 + ph * 2.1);
    const leg = [0, 0, 0, 0];
    /* 甩尾 + 抬蹄：**所有角色共用** ——"休息的马匹也会不规则动"是明确要求，
       上一版只有吃草那两匹有甩尾、只有辕里那两匹有抬蹄 ⇒ 厩内和马厩旁边那两匹
       是完全静止的（正是老黄说"看不到"的那几匹）。 */
    h.flick -= dt;
    if (h.flick <= 0){ h.flick = 3.5 + _sr() * 8.5; h.flickT = 0.9; }
    if (h.flickT > 0){ const u = 1 - h.flickT / 0.9; tailYaw += 0.60 * Math.sin(Math.PI * Math.min(1, u)); h.flickT -= dt; }
    h.hoofNext -= dt;
    if (h.hoofT > 0){
      const u = 1 - h.hoofT / 1.6;
      leg[h.hoofLeg] = 0.52 * Math.sin(Math.PI * Math.min(1, u));   // 前腿绕 X 转 ⇒ 蹄往前抬起
      h.hoofT -= dt;
    } else if (h.hoofNext <= 0){ h.hoofT = 1.6; h.hoofNext = 6 + _sr() * 10; h.hoofLeg = h.hoofLeg ? 0 : 1; }
    if (h.role === 'graze' || h.role === 'fed'){
      /* ② 悠闲吃草：慢速点头（吃一口、抬一下）—— 幅度从 4.9°/3.3° 提到 12.6°/8.6° */
      headPitch += (h.role === 'graze' ? 0.22 : 0.15) * Math.sin(t * 0.30 + ph);
      headYaw   += 0.05 * Math.sin(t * 0.21 + ph * 1.3);
    } else if (h.role === 'harnessed'){
      /* ③ 辕里待发：平时安静；偶尔"仰天抖颈"（幅度 12.6°→19.5°，间隔 15~33s→8~18s）*/
      h.headNext -= dt;
      if (h.headT > 0){
        const u = 1 - h.headT / 1.8;                      // 0→1 一次事件
        const env = Math.sin(Math.PI * Math.min(1, u));   // 起落包络（连续）
        headPitch -= 0.34 * env;                          // 负 = 抬头
        headYaw   += 0.18 * h.headSide * env * Math.sin(u * 20);
        h.headT -= dt;
      } else if (h.headNext <= 0){ h.headT = 1.8; h.headNext = 8 + _sr() * 10; h.headSide = _sr() < 0.5 ? -1 : 1; }
    } else {
      /* ④ 厩内 2 匹：慢慢转头看看 + 低头嗅一下脚下的草 / 抬头 —— 上一版只有 ±3.4° 转头，
         出图判读"厩里两匹完全静止"。 */
      headYaw   += 0.12 * Math.sin(t * 0.13 + ph * 2.3);
      headPitch += 0.16 * Math.sin(t * 0.16 + ph * 1.7);
    }
    rig.head.x = headPitch; rig.head.y = headYaw; rig.tail.x = tailYaw;
    rig.leg.set(leg[0], leg[1], leg[2], leg[3]);

    /* ⑤ 冬天：口鼻喷白雾（只给辕里那两匹 —— 老黄点名的那两匹）*/
    if (h.breath && winter && puff < 26){
      h.breathNext -= dt;
      if (h.breathNext <= 0){
        h.breathNext = 2.4 + _sr() * 2.6;
        const b = h.breath[h.breathCur = (h.breathCur + 1) % h.breath.length];
        b.life = 1.35;
        /* 鼻端（模型局部）先按**当前头颈角**绕颈枢轴转过去 —— 与顶点着色器同一套公式 */
        const a = rig.head.x, p = h.piv.neck;
        let dy = h.nose[1] - p[1], dz = h.nose[2] - p[2];
        const cs = Math.cos(a), sn = Math.sin(a);
        b.x = h.nose[0]; b.y = p[1] + dy * cs - dz * sn; b.z = p[2] + dy * sn + dz * cs;
        if (rig.head.y !== 0){ const c2 = Math.cos(rig.head.y), s2 = Math.sin(rig.head.y);
          const dx2 = b.x - h.nose[0]; b.x = h.nose[0] + dx2 * c2 + (b.z - h.nose[2]) * s2; }
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
          const size = 0.16 + 0.5 * u;
          if (puff < im.instanceMatrix.count){
            h.group.updateWorldMatrix(true, false);
            PP.set(b.x, b.y, b.z).applyMatrix4(h.group.matrixWorld);
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
let _horseSrc = null;
function horseSrcOnce(){
  if (_horseSrc) return _horseSrc;
  _horseSrc = new Promise((resolve, reject) => {
    new GLTFLoader().load(HORSE_GLB,
      (gltf) => { HOOKS.settleAsset?.(HORSE_GLB, true); resolve(gltf.scene); },   // 成功：预载清单放行
      (e) => { HOOKS.reportAssetProgress?.(HORSE_GLB, e.loaded, e.total); },      // 真进度（第三槽）
      (err) => { HOOKS.settleAsset?.(HORSE_GLB, false, err); reject(err); });     // 失败也要回报（否则同样死等）
  });
  _horseSrc.catch(() => {});          // 没人 await 的失败别变成 unhandled rejection（马不在场不该报错）
  return _horseSrc;
}
horseSrcOnce();                        // ← 模块求值期就发起：这一行不能删

export function loadStableHorses(stableGroup){
  const slots = stableGroup && stableGroup.userData && stableGroup.userData.horseSlots;
  if (!slots || !slots.length) return null;
  horseSrcOnce().then((base) => {
    /* 下面要改 src 自己的 scale / rotation / position ⇒ 每次调用都从下载结果**克隆一份**，
       免得同一个 scene 被归一化两次（模型被缩放成 s² 那么大）。 */
    const src = base.clone(true);
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
      const base = slot.color || MAT.horseChestnut;
      let mat = null, pivLocal = null, noseLocal = null;
      inst.traverse(o => {
        if (!o.isMesh) return;
        /* ⚠️ **一匹一份几何**：① 低头吃草那两匹要在几何上把"颈+头"转下去（真模型没有骨骼，
           替身的 headG 那套对它无效）；② 每匹都要烘一层**顶点色明暗**（见 bakeHorseShading：
           单网格无贴图时浅色马会读成"白膜"）。共享几何就没法逐匹改。 */
        o.geometry = o.geometry.clone();
        /* ⚠️⚠️ 顺序（2026-10-11 定案，四步都有依赖关系）：
             ① **先补件**（鬃/尾/眼/鼻孔/嘴并进同一份几何）—— 部位门、明暗、低头、伪蒙皮
                才会自动照顾到它们（鬃跟着脖子低下去、尾巴跟着尾根甩）；
             ② 再算部位权重 W（必须**含补件的顶点**）；
             ③ 再烘色（按"原姿态"量高度/部位门）；
             ④ 最后才低头（先转头会让头部的 y 落到"腹/腿"那一档，色就错了）。
           ⚠️ 补件必须在 `bendHeadDown` 之前 ⇒ 鬃毛内的顶点同样落在"头颈门"里、跟着一起低下去。 */
        const dec = decorateHorseGeometry(o.geometry, slot.decoSeed | 0);
        o.geometry = dec.geometry;
        /* 把补件的**实测锚点**挂到网格上：探针要按它投影到屏幕、直接采样那几像素
           （"眼睛到底看不看得见"这个问题，看图判读来回错了三轮，只有量像素能定案）。
           与 horseSlots / smallBirdMeshRef 同一条做法：只读的诊断钩子，不参与任何逻辑。 */
        o.userData.horseAnchor = dec.anchor;
        o.userData.horseRole = slot.role;
        const W = horseWeights(o.geometry);
        bakeHorseShading(o.geometry, W, { base: base.color, mark: slot.mark, anchor: dec.anchor });
        if (slot.graze > 0.05) bendHeadDown(o.geometry, Math.round(slot.graze * 57.2958 * 0.75));
        /* 逐匹上色：**颜色已经逐顶点烘进 color 属性**（底色 × 明暗 × 花纹 × 鬃尾蹄眼鼻嘴），
           所以材质色必须置**白** —— 否则会再乘一次底色、花纹全被压掉。
           ⚠️ 必须**克隆材质**：共享材质会让六匹马同色（而且 12f 的季节通道按材质同一性认领）。
           ⚠️ 顶点色现在是**绝对色**（不再是"乘子"）：这是让"白斑/白袜"成立的前提
              （乘子只能压暗、提不亮）。 */
        o.material = o.material.clone();
        o.material.color.set(0xFFFFFF);
        o.material.vertexColors = true;               // ← 顶点色 = 最终颜色（绝对色）
        o.material.metalness = 0.0;
        o.material.roughness = 0.82;
        o.material.envMapIntensity = 0.05;            // ← 0.30：马背上一整片太阳镜面，读作"湿塑料"
        /* ⚠️ 模型自带的贴图是没人引用的 normal-bake，丢掉；下面换成我们自己的**毛流图**。 */
        o.material.map = null;
        /* ── 表皮质感（2026-10-14 起，2026-10-16 重做 · 老黄："马还是模型的表面，没有毛发遮挡，
              还会反射太阳光"，"毛还是模型的表面光滑度，没有毛发感"）─────────────────────────
           三次尝试的结论，按效果排序记在这里，别再往回退：
             ❌ 只贴噪声粗糙度图 —— 上一版的范围是 0.55~1.0，而 roughnessMap 是**乘子**
                （有效粗糙度 = roughness × G），最低落到 0.92×0.55 ≈ 0.51
                ⇒ 背上照样一片紧致镜面高光 = "湿塑料"。而且它只改光泽、不改颜色，
                低模那一块块硬边多边形依旧裸露。
             ⚠️ 只加法线图 —— 有效但**不够**：本模型 6245 面、面法线之间是硬边，
                屏幕空间切线的派生噪声盖不过面法线的台阶。
             ✅ **漫反射毛流图（本版）** —— 直接把"毛"写进颜色乘子，才真的挡住模型表面。
                三样一起上：
                  ① map：顺向条带（竖沟 + 横向鳞片 + 过渡毛边），乘在顶点色上 ⇒ 毛流可见；
                  ② roughnessMap：同一个高度场转出来的粗糙度，范围收到 0.86~1.00；
                  ③ normalMap：由同一高度场中心差分求得 ⇒ 光照上也起绒。
                三张**同一处生成**（必然对得上），且全在材质侧 ⇒ **零新增 draw call**
                （加真正的毛发壳要多渲 2~3 遍、多 12 个 draw call，马厩已经很密）。
           ⚠️ 贴图是乘子在**线性空间**做的，回程必须标 sRGB（CanvasTexture 默认线性、
              sRGB 才是 map 该有的采样色域）——两者对不上就是整体偏暗/偏亮。 */
        const coat = horseCoatMaps();
        o.material.map = coat.color;
        o.material.roughnessMap = coat.rough;
        o.material.normalMap = coat.normal;
        o.material.normalScale.set(0.45, 0.45);
        o.material.roughness = 0.98;                   // 贴图是乘子 ⇒ 有效粗糙度落在 0.84~0.98
        o.material.needsUpdate = true;
        o.castShadow = true;
        o.userData.noMerge = true;                    // 异步进来、错过 mergeStatics，显式标一下
        /* ── 动作装置（2026-10-11）：六块区域 ⇒ 顶点属性 + 绕枢轴旋转的 uniform ──
           只装在第一块网格上（真马本来就是单网格；万一多网格，其余不动也不会错）。 */
        if (!mat){
          pivLocal = horsePivots(o.geometry, W);
          installHorseRig(o.material, o.geometry, W, pivLocal);
          mat = o.material;
          /* 鼻端（模型局部）= 口鼻那一簇顶点的质心 —— 给"冬天口鼻白雾"用。
             ⚠️ 只对**没有预烘低头**的马准（预烘过的几何已经转过，按原姿态推的鼻端对不上）；
                白雾本来就只给辕里那两匹（见 tickStableLife），它们 graze=0、没有预烘 ✓。 */
          let sx = 0, sy = 0, sz = 0, n = 0;
          const pp = o.geometry.attributes.position;
          for (let i = 0; i < pp.count; i++)
            if (W.muzzle[i] > 0.5){ sx += pp.getX(i); sy += pp.getY(i); sz += pp.getZ(i); n++; }
          noseLocal = n ? [sx / n, sy / n, sz / n] : [0, 0.16, 0.47];
        }
      });
      /* 登记"这匹马的生活"（tickStableLife 每帧推姿态/喷白雾）。相位错开，别六匹同步。 */
      if (mat){
        const entry = { mat, group: slot.group, role: slot.role, piv: pivLocal, nose: noseLocal,
          phase: HORSE_LIFE.length * 1.7 + _sr() * 6.28,
          flick: 1.5 + _sr() * 5, flickT: 0,
          headNext: 3 + _sr() * 12, headT: 0, headSide: _sr() < 0.5 ? -1 : 1,
          hoofNext: 5 + _sr() * 10, hoofT: 0, hoofLeg: 0 };
        if (slot.role === 'harnessed'){
          entry.breath = Array.from({ length: 7 }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
          entry.breathNext = 1.2 + _sr() * 2.4; entry.breathCur = 0;
          if (!horseBreathMesh.parent) scene.add(horseBreathMesh);   // 白雾只给辕里那两匹
        }
        HORSE_LIFE.push(entry);
      }
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
  }, () => { /* 加载失败：保留程序化替身，不抛错（settleAsset(false) 已在 horseSrcOnce 里回报过） */ });
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
let _horseCoat = null;
function horseCoatMaps(){
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
    /* ── 口络带（2026-10-14 · 用户报"马嘴和套车器具之间没有连接、悬空，像各自咬了一根木棍"）──
       ⚠️⚠️ 坐标系是这一条的关键（首版画错、出图"带子垂到马胸前"）：
         车 rotation.y=π ⇒ **车局部 +z = 世界 −z**；车心世界 z=−0.6 ⇒ 局部 z 与 世界 z 关系
         `世界z = −0.6 − 局部z`。
         实测（运行期探针）：辕里两匹马心世界 z≈0.85 ⇒ **车局部 z≈−1.45**（负侧！），
         马嘴世界 z≈−0.30 ⇒ 车局部 z≈**−0.30**；横轭在局部 +1.98（世界 −2.58）= **在马的后面**。
         即"马站在车的后方、辕朝相反方向" —— 首版把带子画在局部 +1.98→+2.96，
         等于挂在车头那侧，与马嘴隔了 3m，所以出图看着是悬空垂落。
       修法：把口络带画在**马身这一侧**（局部 z 为负），形成嘴→颊带→鼻革→缰绳的闭环：
         · 鼻革 at 局部 z≈−0.30（= 马嘴正中），y≈0.98
         · 颊带 从鼻革两侧斜向后上 to 局部 z≈−0.75, y≈1.15（马颊）
         · 缰绳 从颊带上端向后 to 局部 z≈−1.30, y≈1.25（车辕/颈圈侧），形成可读的连接
       半径 0.012~0.015（皮带量级）；与既有 strap(MAT.harness) 同材质，不引入新资产。 */
    const MX = sx0 => sx0 * 0.40;                 // 两匹马横向（与辕距对齐）
    for (const sx of [-1, 1]){
      /* 鼻革：跨过马嘴的一小段横带 */
      const nose = new THREE.CatmullRomCurve3([
        new THREE.Vector3(MX(sx) - 0.075, 0.99, -0.30),
        new THREE.Vector3(MX(sx),        0.97, -0.38),
        new THREE.Vector3(MX(sx) + 0.075, 0.99, -0.30),
      ]);
      g.add(mesh(new THREE.TubeGeometry(nose, 6, 0.014, 5, false), strap, { name: 'bridleNose', cast: false }));
      for (const s2 of [-1, 1]){
        /* 颊带：鼻革侧端 → 马颊侧后方（斜向上后） */
        const cheek = new THREE.CatmullRomCurve3([
          new THREE.Vector3(MX(sx) + s2 * 0.075, 0.99, -0.30),
          new THREE.Vector3(MX(sx) + s2 * 0.095, 1.08, -0.55),
          new THREE.Vector3(MX(sx) + s2 * 0.105, 1.16, -0.78),
        ]);
        g.add(mesh(new THREE.TubeGeometry(cheek, 6, 0.013, 5, false), strap, { name: 'bridleCheek', cast: false }));
        /* 缰绳：颊带上端 → 向后拉到车辕/颈圈侧（形成"套着"的连续读法） */
        const rein = new THREE.CatmullRomCurve3([
          new THREE.Vector3(MX(sx) + s2 * 0.105, 1.16, -0.78),
          new THREE.Vector3(MX(sx) + s2 * 0.115, 1.22, -1.10),
          new THREE.Vector3(MX(sx) + s2 * 0.120, 1.26, -1.42),
        ]);
        g.add(mesh(new THREE.TubeGeometry(rein, 8, 0.012, 4, false), strap, { name: 'bridleRein', cast: false }));
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

/* ⚠️⚠️ 私有流必须自己包一层区间映射：`mulberry32(seed)` 返回的是**裸的 `()=>[0,1)`**，
   带 (min,max) 签名的是 00-config 的 `rr`（= `(a,b)=>a+rnd()*(b-a)`），不是它本身。
   2026-10-16 实测踩到：把 `mulberry32(...)` 直接当 `(a,b)` 调，参数被**静默忽略**、
   一律返回 0~1 —— 草茎的 `r` 于是涨到 1.03、再乘 3.4 倍外扩 ⇒ 草捆变成一个 6 米大的
   几何体糊在镜头上（3 次截图排查才定位到）。同型写法在本文件**至少出现过两次**
   （旧的 horseCoatRoughTex 也是），凡新建私有流一律走这两个函数。 */
const prRange = (prng) => (a, b) => a + prng() * (b - a);

/* ── 草料捆（马夫手里那捆）──────────────────────────────────────────────────
   ⚠️ 尺寸按**可读性**定，不按实物：10~20m 外 8cm 粗只有 1~2px ⇒ 出图判读"手边没有草料"，
      所以整体做到约 0.3m 长、0.2m 粗才读得出。
   ⚠️⚠️ 2026-10-16 第三次返工（老黄："马夫手上拿的是草，怎么会是几节竹棍还把手夹在竹棍里面"）
      —— 前两版都是**把这个读数做反了**：
        第一版 9 根半径 0.017 的直管 + 居中硬圆柱束带 ⇒ 侧影"两根细杆 + 一个箍" = 竹夹；
        第二版把茎加到 14 根、半径 0.030、顶端放射到 2.6 倍 ⇒ 侧影变成**一把摊开的黄扇子**，
        而且捆心就落在手心里 ⇒ 手从草中间穿出来 = "手夹在竹棍里面"。
      根因两条，这次都从几何上解掉：
        ① "几节竹棍"——单根 0.030 半径是 **6cm 粗的棒**，14 根各自独立又都笔直 → 就是竹签。
           改成 **34 根半径 0.009~0.012**（真麦秆 2cm 上下）的**变速管**：根粗梢细、整体向 +z
           侧倾 ~20°，密密麻麻叠在一起 —— 密到一定程度，单根就不再被读成"一根杆"，
           而是一片**草束的质感**（这正是"一根夹"与"一把草"的区别）。
           ⚠️ 必须用 tubeRadiusRamp 做**锥形**：等径管哪怕再细，34 根也是 34 根棍子。
        ② "手夹在竹棍里"——捆的原点原来压在**手心里**。改成原点在**握点下方 0.13m**、
           草茎从握点上下各露一截（上短下长，像**倒提**一把草），
           捆的 AABB 上缘因此比手低 ⇒ 手是**握住草捆上端**，不再是穿在草中间。
           ⚠️ 顺带把簇的横向铺开从 0.40m 收到 **0.24m**：一把草不该比马头还宽。
   ⚠️ 全程只用私有流（mulberry32 固定种子）：这里若吃全局 rnd，全园布局会静默漂移（铁律 1）。 */
const FEED_BALE = (() => {
  const pr = prRange(mulberry32(20261016));   // 私有流（区间映射，见上面的警告）
  const out = [];
  for (let i = 0; i < 56; i++){
    const a = (i / 56) * Math.PI * 2 + pr(-0.11, 0.11);
    /* ⚠️ 束口半径与顶端外扩倍数一起定"稠密还是稀疏"：第一版 34 根、外扩 3.4 倍
       ⇒ 出图判读"还是几根黄签子"，因为 34 根摊在 0.42m 直径上、彼此离得开。
       现在 44 根、外扩只给 2.4 倍（0.24m 直径）—— **密到重叠**才读得出"一把草"。 */
    const r = 0.008 + pr(0, 0.026) + (i % 4) * 0.005;
    const zTip = 0.100 + pr(0, 0.070);           // 茎长不齐，束口才毛糙
    const zMid = zTip * 0.46;
    out.push({ a, r, rad: 0.011 + pr(0, 0.005), zTip, zMid,
               tilt: pr(-0.16, 0.16),                 // 逐根微偏，别像一把牙签
               y0: -0.075 - pr(0, 0.030) });          // 握点在上、根茬在下
  }
  return out;
})();
export function makeFeedBale(){
  const g = new THREE.Group();
  /* ⚠️ 34 根草茎**必须并成一个几何**：一根一个 mesh 就是 34 个 draw call，
     mergeStatics 又碰不到它们（整个捆挂着 noMerge，跟着马夫的手臂动）——
     一个小道具吃掉 36 个 draw call 是不该付的代价。并完只剩 2 个（草 + 束带）。 */
  const strands = [];
  for (const s of FEED_BALE){
    const ca = Math.cos(s.a), sa = Math.sin(s.a);
    const P = (r, z, y) => new THREE.Vector3(ca * r, y, sa * r + z);
    /* 起点在**竖直轴外**一点点（r 0.95 倍）—— 草是从手里往上往外张开的，不是从一根杆上插出来 */
    const c = new THREE.CatmullRomCurve3([
      P(s.r * 0.95, -0.030, s.y0),
      P(s.r,        0.010, -0.062 + s.tilt * 0.05),
      P(s.r * 2.10, s.zMid, 0.008 + s.tilt * 0.08),
      P(s.r * 2.00, s.zTip, 0.030 + s.tilt * 0.12),
    ]);
    strands.push(new THREE.TubeGeometry(c, 6, s.rad, 5, false));
  }
  g.add(mesh(mergeGeometries(strands, false), MAT.straw, { name: 'feedStrands', cast: false }));
  /* 束带：麻绳两圈（束腰 + 略上收口），不再是"一个居中的硬箍" */
  const ties = [];
  for (const [y, r, h] of [[-0.038, 0.049, 0.020], [-0.012, 0.055, 0.017]]){
    const t = new THREE.CylinderGeometry(r, r, h, 10);
    t.translate(0, y, 0);
    ties.push(t);
  }
  g.add(mesh(mergeGeometries(ties, false), MAT.harness, { name: 'feedTie' }));
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

/* ── 院外石板路（上下马处 → 园子南门）────────────────────────────────────────
   老黄 2026-10-10："再铺设一条石板路从下马处（上马处）直接铺到院子的南门"。
   ⚠️ 为什么不是一块平板：院外是**草坡**（groundHeight 起伏量级 ±0.5m），平板必然一头
   悬空一头埋进地里 ⇒ 沿路线**逐点采样地形高**做成跟着坡走的带子。
   路线：院门（世界约 (40, 3) ）→ 向南**绕过东南墙角**（东墙 x=30 延伸到 z=22.5）
   → 再沿南墙外侧向西 → 接月洞门（南墙正中 x=0，外侧有 4×1.4m 门槛石）。
   ⚠️ 必须绕墙角：直着斜穿会在 z<22.5 的地方撞进东墙（墙在 x=30、厚 ±0.6）。
   ⚠️ 抬升 0.07：地形是解析式 groundHeight，而地面网格是按 1.9m 一格线性插值的，
   两者在起伏处差几厘米 ⇒ 抬 5cm 以下会有局部"路面被草吃进去"。 */
/* ── 院外石板路（上下马处 → 园子南门）· 2026-10-11 **重做**────────────────────
   老黄 2026-10-10："再铺设一条石板路从下马处（上马处）直接铺到院子的南门"
   老黄 2026-10-11："从马厩到院子的这条石块路**重做**，我不知道中国古代对这种路的设计讲究
   弯曲还是也要中规中矩，你查下资料再定形状的方案，然后石板路我给你一个参考图，
   你选一个适合我们项目的样式来设计细节"。

   ── 查资料得到的口径（决定了"形状"）─────────────────────────────────────────
     · 园林里的地面统称**铺地**；**中轴对称、方砖对缝**的那种叫**甬路**（多用在厅堂前的正道、
       寺观神道）——那是"中规中矩"的一路做法。
     · 而**园中小径**讲究**"曲径通幽"**（拙政园、留园的文字记载都在这句上）⇒ 走向要**弯**。
       对我们这条还好有两层好处：马车进出本来就要弧线，且它沿墙外草坡走，直线反而要削坡。
     · 做法上苏州园林最著名的两种：**花街铺地**（用卵石 + 碎瓦/缸片/碎瓷拼图案，瓦片勾线）与
       **乱石路**（不规则石块像石榴子一样铺砌，旧籍评"**既坚固又雅致**"）。
   ⇒ 老黄给的参考图里，我选**"不规则石板 + 卵石勾缝 + 两侧卵石镶边"**这一类（他图里第 6/9 张
     那种感觉）：石板块大小不一、错缝铺、缝里嵌小卵石、两边一条卵石镶边。理由：合"乱石路"
     的旧法；与园内已有的方砖对缝地面（07-ground 的 makePaving）**区分得开**；马车硬轮也吃得消。

   ── 实现（三层，都跟着地形走）───────────────────────────────────────────────
     ① **垫层**（勾缝底）：沿路线逐点采样地形高做一条深色窄带 —— 它保证石板之间露出来的是
        "深色的缝"而不是草。
     ② **石板**：两侧各自独立按"错缝"步进（左右接缝不齐 = 错缝），每块是**四角棱柱**
        （顶面在草皮 +0.075、底在 +0.015），四角逐点取地形高 ⇒ 整块跟着坡微倾；
        尺寸/转角/**色调**逐块抖动（色调走顶点色 ⇒ 一块块深浅不一，这正是乱石路的读感来源）。
     ③ **两侧卵石镶边**：沿两条边按 ~0.34m 一颗铺低模鹅卵石（压扁的球），同样逐颗抖动色调。
   ⚠️ 三条纪律：① **私有随机流**（mulberry32(20261012)，铁律 1：绝不碰全局 rnd/rr —— 本函数在
      马厩的 deferBootFirst 里跑，吃全局流会让其后所有按序抽样整体前移且不报错）；
      ② 石板/卵石都是**合并几何**而不是 InstancedMesh（新 InstancedMesh 会动 layout-fingerprint
      的网格计数、要重出基线；合并 Mesh 不进指纹）；
      ③ 石板材质开 **DoubleSide**：顶面按逆时针绕向是正的，但侧面那条绕向容易写反，
      DoubleSide 兜住（石板的底面本来就看不见）。
   ⚠️ 抬升 0.075：地形是解析式 groundHeight，而地面网格按 1.9m 一格线性插值，
   起伏处差几厘米 ⇒ 抬 5cm 以下会有局部"路面被草吃进去"。 */
export function makeStableRoad(){
  const g = new THREE.Group();
  const CP = [[40.0, 4.2], [39.2, 10.5], [37.4, 16.5], [34.4, 21.8], [30.0, 26.2],
              [22.0, 27.2], [10.0, 26.4], [2.6, 25.0], [0.6, 23.6]];
  const curve = new THREE.CatmullRomCurve3(CP.map(p => new THREE.Vector3(p[0], 0, p[1])));
  const HW = 0.86;                                 // 半宽 ⇒ 路宽 1.72m（单车道，够马车）
  const r2 = mulberry32(20261012);                 // 私有流
  const jit = (a, b) => a + r2() * (b - a);
  const frameAt = (t) => {                          // 位置 + 切向 + 侧向（xz 平面）
    const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    return { p, tan: tan.clone().setY(0).normalize(), side };
  };
  const nrmTex = () => { const n = pavingNormalTex.clone(); n.needsUpdate = true;
    n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(1, 1); return n; };

  /* ① 垫层（勾缝底）：一条跟着地形走的深色窄带 */
  {
    const N = 200, pos = [], uv = [], idx = [];
    let acc = 0, prev = null;
    for (let i = 0; i <= N; i++){
      const { p, side } = frameAt(i / N);
      if (prev) acc += p.distanceTo(prev);
      prev = p.clone();
      for (const s of [1, -1]){
        const q = p.clone().addScaledVector(side, s * HW);
        pos.push(q.x, groundHeight(q.x, q.z) + 0.045, q.z);
        uv.push(s * HW / 2.6, acc / 2.6);
      }
    }
    for (let i = 0; i < N; i++){ const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0x6E675D,
                                                 roughness: 0.98, metalness: 0.0 });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    g.add(mesh(geo, mat, { name: 'stableRoadBed', cast: false, receive: true }));
  }

  /* ② 石板：**四个角落在曲线的 t 网格上**（不是"切向矩形"）——
     切向矩形在弯道上会互相撞：每块都按自己那点的切线摆，弯内侧两块必然叠压/穿插
     （第一版就是这样，近景判读"弯段错位、角部相互压叠"）。改成"两条弧上的点 + 侧向偏移"
     以后，石板天然跟着弧走、相邻两块永远不重叠。
     错缝：左右两条各自**不同的相位与步长** ⇒ 横向接缝不齐。 */
  {
    const pos = [], col = [], idx = [], L = curve.getLength();
    const pushSlab = (t0, t1, sA, sB, tone) => {
      const A2 = frameAt(t0), B2 = frameAt(t1);
      /* ⚠️ 绕向：侧向量 side 与切向 tan 满足 side × tan = +y ⇒ 角按 (A·sA, A·sB, B·sB, B·sA)
         且 sA < sB 时，顶面法线朝上（写反了顶面就朝下、从上看全黑）。 */
      const corners = [
        A2.p.clone().addScaledVector(A2.side, sA),
        A2.p.clone().addScaledVector(A2.side, sB),
        B2.p.clone().addScaledVector(B2.side, sB),
        B2.p.clone().addScaledVector(B2.side, sA),
      ];
      const base = pos.length / 3;
      for (const q of corners){
        const gy = groundHeight(q.x, q.z);
        pos.push(q.x, gy + 0.060, q.z);              // 顶（偶数索引）
        pos.push(q.x, gy + 0.004, q.z);              // 底（奇数索引）——几乎贴到草面，消除"浮着"的台阶
        col.push(tone, tone * 0.985, tone * 0.955, tone * 0.88, tone * 0.87, tone * 0.85);
      }
      idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);   // 顶面
      for (let k = 0; k < 4; k++){
        const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
        idx.push(a, b, b + 1, a, b + 1, a + 1);       // 四个侧面
      }
    };
    /* 两条（左/右）各自相位、各自步长 ⇒ 错缝。
       ⚠️ 内缘**固定**在 ±0.025（中缝恒 ~5cm），抖动只吃**外缘** —— 第一版内缘也吃抖动
       ⇒ 中缝最宽能到 0.24m，垫层露出来读成"一条没填平的黑沟、把路劈成两半"（近景判读原话）。
       外缘内收是"乱石"的来源（不规则边），内缘整齐才像"一条路"。 */
    for (const [sOut, sIn] of [[-HW + 0.02, -0.025], [0.025, HW - 0.02]]){
      let d = jit(0.10, 0.60);
      while (d < L - 0.30){
        const len = jit(0.44, 0.66);
        const t0 = d / L, t1 = Math.min(1, (d + len) / L);
        const a = sOut + jit(0.0, 0.075);              // 只动外缘
        pushSlab(t0, t1, Math.min(a, sIn - 0.06), sIn + jit(-0.008, 0.008), jit(0.58, 1.0));
        d += len + jit(0.030, 0.070);                 // 缝宽 3~7cm
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0xFFFFFF,
      vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    /* ⚠️ **石板要投影**（cast:true）：阴影图的唯一一次渲染发生在延迟批之后的首帧，
       而本函数就在延迟批里跑 ⇒ 影子会正确落进那张图。不投影时近景判读是"纸片浮贴在地面上"，
       投影是"石块落在地上"最便宜的一步（近景图判读反复点到"缺接触阴影"）。 */
    g.add(mesh(geo, mat, { name: 'stableRoad', cast: true, receive: true }));
  }

  /* ③ 两侧卵石镶边：**两排**低模鹅卵石（压扁的球）密排成带（第一版步长 0.30 太稀，
     近景判读"间隔点状、不成带"⇒ 收到 0.19 并铺两排），逐颗抖色调/大小。 */
  {
    const proto = new THREE.SphereGeometry(1, 6, 4);
    const parts = [];
    const L = curve.getLength(), step = 0.19;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), PP = new THREE.Vector3();
    for (let d = 0; d < L; d += step){
      const { p, tan, side } = frameAt(Math.min(0.999, d / L));
      for (const s of [1, -1]){
        for (const row of [0.095, 0.225]){           // 两排：紧贴石板边外侧 + 外面一排
                                             // ⚠️ 内排不能贴太近：卵石半径最大 0.092，靠到
                                             // HW+0.055 时它的内缘会压到石板上（近景判读"个别卵石
                                             // 与石板边重叠穿插"）。0.095 − 0.092 = +0.003 刚好在外。
          const q = p.clone().addScaledVector(side, s * (HW + row + jit(-0.02, 0.02)))
                            .addScaledVector(tan, jit(-0.055, 0.055));
          const r = jit(0.044, 0.092), tone = jit(0.46, 1.05);
          const gg = proto.clone();
          const cAttr = new Float32Array(gg.attributes.position.count * 3);
          for (let i = 0; i < cAttr.length; i += 3){
            const j2 = jit(-0.06, 0.06);                 // 逐顶点微抖 ⇒ 不是一颗颗纯色球
            cAttr[i] = tone + j2; cAttr[i+1] = (tone + j2) * 0.99; cAttr[i+2] = (tone + j2) * 0.95;
          }
          gg.setAttribute('color', new THREE.Float32BufferAttribute(cAttr, 3));
          PP.set(q.x, groundHeight(q.x, q.z) + r * 0.34, q.z);
          Q.setFromEuler(new THREE.Euler(0, jit(0, 6.28), 0));
          SC.set(r, r * 0.5, r);
          M.compose(PP, Q, SC);
          gg.applyMatrix4(M);                         // 合并前把世界变换烘进几何
          parts.push(gg);
        }
      }
    }
    const geo = mergeGeometries(parts, false);
    parts.forEach(x => x.dispose());
    proto.dispose();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8E8B84, vertexColors: true,
                                                 roughness: 0.96, metalness: 0.0 });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    g.add(mesh(geo, mat, { name: 'stableRoadPebble', cast: false, receive: true }));
  }

  /* ── ②b 院门口扇形补铺（2026-10-17 · 老黄："马厩到院子的石板路在入院的地方有缺失，
     要填充满，不能留一个扇形的缺口"）────────────────────────────────────────────
     ── 缺口是怎么来的 ──
     石板路半宽 HW=0.86（路宽 1.72m），而正面栅栏的车门开口是 1.8×2 = **3.6m**
     （见下面 runFence：正面两段各留到 ±1.8）。路头 CP[0] 在 (40, 4.2)、院门线在
     (40, 2.7) ⇒ 这 1.5m 里宽度要从 1.72m 扩到 3.6m，而原来那一段**没有任何铺装**
     ⇒ 出图判读就是两侧各一块楔形秃地拼成的扇形缺口。
     ── 补法 ──
     补一块"喇叭口"：北端与车门同宽（±1.80）、南端收到与路面同宽（±0.86）；
     北端还往门里伸 0.4m 当**门槛石**（否则门线处会留一条横缝）。逐点采样地形高、
     同一套四角棱柱石板与色调抖动 ⇒ 与路面同质，缝里露出的同样是垫层深色。
     宽度函数：z ≤ 2.95 恒 1.80（门洞区），2.95 → 4.20 用 smoothstep 收到 0.86。
     ⚠️ 本块刻意**复用 ② 的角点写法**而不是把它抽成公共函数：② 的错缝与绕向是被近景
        判读反复修过的（顶面朝下 ⇒ 从上看全黑那次），抽函数等于动那段已验证的代码。
     ⚠️ 侧向量取 (-1,0,0)：与路面同一条口径（side × tan = +y 才保证顶面朝上）。 */
  {
    const Z0 = 2.30, ZT = 2.95, Z1 = 4.20;        // 门槛内 / 开始收口 / 接到路头
    const W0 = 1.80, W1 = HW;                     // 车门半开口 → 路半宽
    const apronW = (z) => {
      if (z <= ZT) return W0;
      const u = Math.min(1, (z - ZT) / (Z1 - ZT));
      return W0 + (W1 - W0) * (u * u * (3 - 2 * u));   // smoothstep：口部收得柔，不像被切了角
    };
    const apronFrame = (z) => ({ p: new THREE.Vector3(40.0, 0, z), tan: new THREE.Vector3(0, 0, 1),
                                 side: new THREE.Vector3(-1, 0, 0) });
    /* 垫层（与 ① 同色、同厚）：跟着宽度变化的一条窄带 */
    {
      const N = 26, pos = [], uv = [], idx = [];
      let acc = 0, prev = null;
      for (let i = 0; i <= N; i++){
        const z = Z0 + (Z1 - Z0) * (i / N);
        if (prev !== null) acc += Math.abs(z - prev);
        prev = z;
        const w = apronW(z);
        for (const s of [1, -1]){
          const x = 40.0 + s * w;
          pos.push(x, groundHeight(x, z) + 0.045, z);
          uv.push(s * w / 2.6, acc / 2.6);
        }
      }
      for (let i = 0; i < N; i++){ const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0x6E675D,
                                                   roughness: 0.98, metalness: 0.0 });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGateBed', cast: false, receive: true }));
    }
    /* 石板：与 ② 同款四角棱柱（顶面 +0.060 / 底面 +0.004），左右两条各自相位与步长 */
    {
      const pos = [], col = [], idx = [];
      const addSlab = (A2, B2, sA, sB, tone) => {
        const corners = [
          A2.p.clone().addScaledVector(A2.side, sA),
          A2.p.clone().addScaledVector(A2.side, sB),
          B2.p.clone().addScaledVector(B2.side, sB),
          B2.p.clone().addScaledVector(B2.side, sA),
        ];
        const base = pos.length / 3;
        for (const q of corners){
          const gy = groundHeight(q.x, q.z);
          pos.push(q.x, gy + 0.060, q.z);
          pos.push(q.x, gy + 0.004, q.z);
          col.push(tone, tone * 0.985, tone * 0.955, tone * 0.88, tone * 0.87, tone * 0.85);
        }
        idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);
        for (let k = 0; k < 4; k++){
          const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
          idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
      };
      for (const sgn of [1, -1]){
        let z = Z0 + jit(0.05, 0.35);
        while (z < Z1 - 0.20){
          const len = jit(0.42, 0.62);
          const zA = z, zB = Math.min(Z1, z + len);
          const FS = apronFrame(zA), FE = apronFrame(zB);
          /* 外缘按该段最窄处内收（保证任何一块都不越界），内缘固定 ±0.025 ⇒ 中缝整齐 */
          const wOut = Math.min(apronW(zA), apronW(zB)) - 0.02 - jit(0.0, 0.075);
          const sOut = sgn * wOut, sIn = sgn * (0.025 + jit(-0.008, 0.008));
          const a2 = Math.min(sOut, sIn - 0.06), b2 = Math.max(sOut, sIn);
          addSlab(FS, FE, Math.min(a2, b2), Math.max(a2, b2), jit(0.58, 1.0));
          z += len + jit(0.030, 0.070);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0xFFFFFF,
        vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGateSlab', cast: true, receive: true }));
    }
    /* 卵石镶边：只沿**收口段**两侧（门洞区两侧是栅栏立柱，铺到那儿反而怪） */
    {
      const proto = new THREE.SphereGeometry(1, 6, 4);
      const parts = [];
      const step = 0.19;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), PP = new THREE.Vector3();
      for (let z = ZT; z < Z1; z += step){
        const w = apronW(z);
        for (const s of [1, -1]){
          for (const row of [0.095, 0.225]){
            const qx = 40.0 + s * (w + row + jit(-0.02, 0.02)), qz = z + jit(-0.055, 0.055);
            const rr2 = jit(0.044, 0.092), tone = jit(0.46, 1.05);
            const gg = proto.clone();
            const cAttr = new Float32Array(gg.attributes.position.count * 3);
            for (let i = 0; i < cAttr.length; i += 3){
              const j2 = jit(-0.06, 0.06);
              cAttr[i] = tone + j2; cAttr[i+1] = (tone + j2) * 0.99; cAttr[i+2] = (tone + j2) * 0.95;
            }
            gg.setAttribute('color', new THREE.Float32BufferAttribute(cAttr, 3));
            PP.set(qx, groundHeight(qx, qz) + rr2 * 0.34, qz);
            Q.setFromEuler(new THREE.Euler(0, jit(0, 6.28), 0));
            SC.set(rr2, rr2 * 0.5, rr2);
            M.compose(PP, Q, SC);
            gg.applyMatrix4(M);
            parts.push(gg);
          }
        }
      }
      const geo = mergeGeometries(parts, false);
      parts.forEach(x => x.dispose());
      proto.dispose();
      const mat = new THREE.MeshStandardMaterial({ color: 0x8E8B84, vertexColors: true,
                                                   roughness: 0.96, metalness: 0.0 });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGatePebble', cast: false, receive: true }));
    }
  }

  /* ── ④ 路旁石灯笼（2026-10-17 · 老黄："石灯笼可以放在马厩到院子的这条石板路两侧，
     每一段距离放一对，毕竟还有晚上进出的需求"）────────────────────────────────────
     原摆位（池北岸 (4.0,−3.8) 单独一盏，08c-aquatic 里）**撤掉**，资产改在这里复用到路上。
     桩位：沿曲线弧长等分 5 站、每站左右各一盏，横向 ±1.55m —— 卵石镶边最外缘约 1.18m
     （HW + 0.225 + 卵石半径 0.092），留 0.37m 净隙；灯笼底座半径 0.28m。
     首站从 6m 起、末站离路尾 3m：别怼在院门口（那儿留给石狮）与南门口。
     座石：每盏下垫一块方座（0.92×0.30×0.92，顶面比草皮高 0.04、其余埋进土里）——
     草坡有 ±0.1m 起伏，不垫的话 0.55m 宽的底座必然有一角悬空。
     ⚠️ 10 盏按**材质合并成 2 个网格**（石身 + 火袋，座石并进石身那个桶），不是 10 棵节点树。
     ⚠️ **不新增真光源**：火袋的 emissive 是模型自带的（与 06c 挂灯同口径）；也就是说夜里
        读作"亮着的灯"，但它不照亮地面（真要照亮得加 10 盏点光，代价另算）。 */
  {
    const N = 5, LR = curve.getLength();
    const OFF = 1.55;
    const spots = [];
    for (let i = 0; i < N; i++){
      const d = 6.0 + (LR - 9.0) * (i / (N - 1));
      const { p, tan, side } = frameAt(Math.min(0.999, d / LR));
      for (const s of [1, -1]){
        const q = p.clone().addScaledVector(side, s * OFF);
        spots.push({ x: q.x, z: q.z, ry: Math.atan2(tan.x, tan.z) });
      }
    }
    /* 给"看灯笼"入口留一个**稳定的锚点**：合并后的网格没有单盏位置可言，
       而手机端那个浮动按钮要飞到一个具体近前。锚点取第一对（离院门最近的一对）。 */
    const anchor = new THREE.Object3D();
    anchor.name = 'stoneLanternAnchor';
    anchor.position.set(spots[0].x, groundHeight(spots[0].x, spots[0].z) + 0.70, spots[0].z);
    g.add(anchor);
    console.log('[路旁石灯笼] 桩位：' + spots.map(s => '(' + s.x.toFixed(1) + ',' + s.z.toFixed(1) + ')').join(' '));
    loadAssetOnce('assets/stone-lantern.glb', 1.05, (srcL)=>{
      const buckets = new Map();
      const push = (mat, geo) => {
        if (!buckets.has(mat.uuid)) buckets.set(mat.uuid, { mat, parts: [] });
        buckets.get(mat.uuid).parts.push(geo);
      };
      /* 先认材质身份：名字带 glow 的是火袋，另一个是石身（座石跟石身同材质、同桶） */
      let stoneMat = null;
      srcL.traverse(o => { if (o.isMesh && !/glow/i.test(o.material.name || '')) stoneMat = o.material; });
      if (!stoneMat) srcL.traverse(o => { if (o.isMesh) stoneMat = o.material; });
      const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(),
            S4 = new THREE.Vector3(1, 1, 1), P4 = new THREE.Vector3();
      for (const st of spots){
        const base = groundHeight(st.x, st.z);
        const h = new THREE.Group();
        h.position.set(st.x, base - 0.010, st.z);
        h.rotation.y = st.ry;
        h.add(srcL.clone(true));
        h.updateMatrixWorld(true);
        h.traverse(o => {
          if (!o.isMesh) return;
          const gg = o.geometry.clone();
          gg.applyMatrix4(o.matrixWorld);
          push(o.material, gg);
        });
        /* 座石：0.30 厚、顶面比该点草皮高 0.04 ⇒ 底下 0.26m 埋进坡里，四个角都不悬空 */
        const padGeo = box(0.92, 0.30, 0.92);
        P4.set(st.x, base + 0.04 - 0.15, st.z);
        Q4.setFromEuler(new THREE.Euler(0, st.ry, 0));
        M4.compose(P4, Q4, S4);
        padGeo.applyMatrix4(M4);
        push(stoneMat, padGeo);
      }
      for (const { mat, parts } of buckets.values()){
        const geo = mergeGeometries(parts, false);
        parts.forEach(x => x.dispose());
        g.add(mesh(geo, mat, { name: 'roadLantern', cast: true, receive: true }));
      }
      console.log('[路旁石灯笼] ' + spots.length + ' 盏（含座石）· 合并成 ' + buckets.size + ' 个网格');
    });
  }
  /* ── ⑤ 院门口石狮一对（2026-10-18 · 老黄："门口应该放一对石狮子，注意一公一母"）───
     规矩（维基"石狮子"条）："从大门里出来时雄在左、雌在右"；雄右前爪踩绣球、雌左前爪抚幼狮。
     院门朝南（世界 +z，门线 z=2.7、开口 x 38.2~41.8），出来时左手边是 +x ⇒ 雄狮放东 (+x)、雌狮放西。
     桩位：门外两侧 x=40±2.3、z=3.4（门线外 0.7m、路头 4.2m 以北，不挡喇叭口），面朝南 (+z)。
     模型：research/diy-lions 自制，公 312KB / 母 323KB，高 1.08m（与 3.6m 门洞比例协调）。
     朝向：模型在 Blender 里脸朝 +y，glTF yup 导出后脸朝 −z（实拍验证：ry=0 时背对南来的客人），
     故 rotation.y=PI 让脸朝南迎客。 */
  {
    const spots = [
      { url: 'assets/stone-lion-male.glb', x: 42.3, z: 3.4, name: 'stoneLionMale' },
      { url: 'assets/stone-lion-female.glb', x: 37.7, z: 3.4, name: 'stoneLionFemale' },
    ];
    for (const st of spots){
      loadAssetOnce(st.url, 1.08, (src)=>{
        const h = new THREE.Group();
        h.name = st.name;
        h.position.set(st.x, groundHeight(st.x, st.z) - 0.01, st.z);
        h.rotation.y = Math.PI;
        h.add(src.clone(true));
        g.add(h);
        console.log('[门口石狮] ' + st.name + ' 落位 (' + st.x.toFixed(1) + ',' + st.z.toFixed(1) + ')');
      });
    }
  }
  /* 石板开投影之后，投射物集合变了 ⇒ 置脏让它进那张**静态**阴影图（11-loop 的收尾也会刷一次，
     这里显式做一道保险：本函数在延迟批里跑，顺序一旦被改动，石板就会"没有接触阴影"）。 */
  markCasterBoxDirty();
  renderer.shadowMap.needsUpdate = true;
  return g;
}

/* 径向柔和 alpha（中心不透明、边缘渐隐）——与雨后水膜同一套做法 */
function makeSoftAlphaTex(){
  const S = 64, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grd.addColorStop(0.00, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.80, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
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
    /* `role`（2026-10-11）：这匹马"在干什么"—— 动作装置按角色给不同的行为
       （stall 厩内待着 / harnessed 辕里待发 / graze 低头吃草 / fed 受喂）。
       ⚠️ 只认角色，**不认坐标**：坐标改选址时会变，角色跟着语义走。
       `mark` / `decoSeed`（2026-10-11 补）：每匹的**花纹**（白斑/白袜/斑纹）与**补件种子**
       （鬃尾的确定性差异）—— 老黄："所有的马都是单一颜色的，这个在自然界也很难存在吧"。 */
    const slot = { group: grp, color: colorMat, holders: [ph], graze: opts2.graze || 0,
                   role: opts2.role || 'stall', mark: opts2.mark || null, decoSeed: opts2.decoSeed || 0 };
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
  /* **厩内 2 匹**（占第 1、3 栏；第 2、4 栏空着）—— 空槽位里放地上的干草，读作"空闲马位"
     ⚠️ 六匹的花纹刻意各不相同（老黄："所有的马都是单一颜色"）：骝马白斑+白袜、白马带斑纹、
     黑马纯黑（真实存在的"黑得发亮"）、枣红白袜、青灰斑纹+小流星、兔褐白斑白袜。 */
  for (const [sx0, col, mk, sd] of [
    [(stallX[0] + stallX[1]) / 2, MAT.horseChestnut, { blaze: 1.0, socks: 0.9 }, 1],
    [(stallX[2] + stallX[3]) / 2, MAT.horseWhite,    { dapple: 0.9 }, 2]]){
    addHorseSlot(sx0, BZ1 - 1.5, P0, Math.PI, col, { mark: mk, decoSeed: sd });
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
  /* ⚠️ 2026-10-11 补：**把车"坐"到坡上**（老黄这轮出图判读的头号出戏项："马车的一个木轮子
     明显悬空，没有接触到地面，一眼假"）。原因：原来只用"车心那一点的地形高"给 position.y，
     而院场是草坡 —— 两个轮子（车局部 ±0.62）各自脚下的高差 0.2m 量级 ⇒ 一侧轮子必然离地。
     做法：取**两个轮子各自脚下**的地形高，用它们的均值定位、用它们的差求**横滚角**
     （绕车局部 z 轴，即轮轴向）；轮距 1.24m ⇒ θ = Δh / 1.24。
     ⚠️ 符号：车局部 +x 那个轮子在**世界**里落在 +x 还是 −x，取决于车的世界偏航
     （= 组 yaw + 车自身 rotation.y）—— 这里两个车都是 π+π≡0 ⇒ +x 落 +x；仍按通用式算，
     免得以后改朝向时符号悄悄反过来。 */
  const seatCart = (car) => {
    const wy = yaw + car.rotation.y;
    const sgn = Math.cos(wy) >= 0 ? 1 : -1;          // 车局部 +x 映射到世界 +x(+1) 还是 −x(−1)
    const lx = car.position.x, lz = car.position.z;
    const gPos = gy(lx + 0.62, lz), gNeg = gy(lx - 0.62, lz);
    car.position.y = (gPos + gNeg) / 2;              // 两轮接地 ⇒ 车心取两者均值
    car.rotation.z = sgn * (gPos - gNeg) / 1.24;     // 横滚：把轮轴转成与坡面平行
  };
  seatCart(carA); seatCart(carB);
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
    const slot = addHorseSlot(hx, hz, hy, Math.PI, sx < 0 ? MAT.horseBlack : MAT.horseBay,
      { role: 'harnessed', decoSeed: sx < 0 ? 3 : 4, mark: sx < 0 ? null : { socks: 0.8 } });
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
  /* ⚠️ 2026-10-11（老黄："也看不到马低头吃草的动作"）：把头低的角度加足 ——
     graze 0.82→0.95（= 40.8°）、fed 0.52→0.80（= 34.4°）。上限仍守 bendHeadDown 的 45° 规矩。 */
  addHorseSlot(4.6, -3.9, yardY(4.6, -3.9), -Math.PI / 2, MAT.horseGrey,
    { graze: 0.95, role: 'graze', decoSeed: 5, mark: { dapple: 1.0, blaze: 0.7 } });
  addHorseSlot(1.5, -2.8, yardY(1.5, -2.8), Math.PI, MAT.horseBay,
    { graze: 0.80, role: 'fed', decoSeed: 6, mark: { blaze: 1.0, socks: 0.8 } });

  /* ③d 院用杂物：石水槽、草料堆、两根拴马桩、草料篮
     ⚠️ 2026-10-11 老黄："为什么这个草料一定要这样放，不能全部放在围栏内吗？" ——
     水槽/草堆/拴马桩原来都贴着栅栏线（栅栏在 local x=−5.6）：草堆半径 0.71 从 −5.4 起
     ⇒ 有一小半杵到栅栏上、立柱与横杆直接穿过去（出图判读"草压栅栏线"）。
     现在整组往里收到 x≈−4.2~−4.9，**全部落在栅栏以内**，与栅栏留出 ≥0.5m 的余量。 */
  const wt = makeTrough(1.3, 0.6, 0.42, MAT.stoneDark, MAT.stone);
  wt.position.set(-4.85, yardY(-4.85, -0.6), -0.6); g.add(wt);
  /* 草料堆：从"4 个球堆叠（出图判读读作雪人/面团）"改成**码好的草捆 + 散草**——
     扁平长方体交替换向 + 几缕散落的草茎，这才读得出是草料。 */
  const hayX = -4.30, hayZ = -3.35, hayY0 = yardY(hayX, hayZ);
  for (let i = 0; i < 3; i++){
    const bale = mesh(box(0.92, 0.34, 0.52), MAT.straw, { name: 'hayBale', cast: true });
    bale.position.set(hayX + (i === 2 ? 0.14 : 0), hayY0 + 0.18 + i * 0.35, hayZ + (i === 1 ? 0.07 : 0));
    bale.rotation.y = (i % 2) * 0.22;
    g.add(bale);
  }
  for (let i = 0; i < 6; i++){
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(hayX - 0.40 + i * 0.16, hayY0 + 0.02, hayZ - 0.30),
      new THREE.Vector3(hayX - 0.36 + i * 0.16, hayY0 + 0.11, hayZ + 0.04),
      new THREE.Vector3(hayX - 0.43 + i * 0.16, hayY0 + 0.03, hayZ + 0.36),
    ]);
    g.add(mesh(new THREE.TubeGeometry(curve, 4, 0.017, 4, false), MAT.straw, { name: 'hayStraw', cast: false }));
  }
  for (const z of [-2.2, -0.4]){
    const post = mesh(new THREE.CylinderGeometry(0.085, 0.10, 1.35, 8), MAT.woodDark, { name: 'hitchPost', cast: true });
    post.position.set(-5.15, yardY(-5.15, z) + 0.66, z); g.add(post);
    const ring = mesh(new THREE.TorusGeometry(0.075, 0.018, 4, 8), MAT.harness, { name: 'hitchRing' });
    ring.position.set(-5.15, yardY(-5.15, z) + 1.03, z); ring.rotation.y = Math.PI / 2; g.add(ring);
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

  /* ⑤ 碾压草皮（老黄 2026-10-10："上马和下马处的草皮因为马匹和马车轮子的碾压应该是枯黄
     或者无草的状况"）：两层 —— 外圈**压黄的草**、内圈**露土的硬地**。
     ⚠️ 三条实现要点：① **逐顶点贴合地形**（在草坡上平板会一头翘一头埋）；
     ② **不规则边 + 径向柔和 alpha**（硬边多边形会被读成"贴图瑕疵"，与雨后水膜同款处理）；
     ③ 挂在**本组**里 ⇒ 随厩身一起转（改朝向不用重算）。 */
  const wornAlpha = makeSoftAlphaTex();
  const mkPatch = (lx, lz, r, mat, seed) => {
    const NA = 28, NR = 3;
    const pos = [], uv = [], idx = [];
    for (let ir = 0; ir <= NR; ir++){
      const t = ir / NR;
      for (let ia = 0; ia <= NA; ia++){
        const a = (ia / NA) * Math.PI * 2;
        /* 边沿带噪声（只有最外圈收放，内圈保持圆 ⇒ 不会出现自交的锯齿）*/
        const wob = 1 + (ir === NR ? 0.26 * Math.abs(Math.sin(a * 3 + seed)) - 0.13 : 0);
        const rad = r * t * wob;
        const qx = lx + Math.cos(a) * rad, qz = lz + Math.sin(a) * rad;
        pos.push(qx, gy(qx, qz) + 0.05, qz);
        uv.push(Math.cos(a) * t * 0.5 + 0.5, Math.sin(a) * t * 0.5 + 0.5);
      }
    }
    for (let ir = 0; ir < NR; ir++)
      for (let ia = 0; ia < NA; ia++){
        const a0 = ir * (NA + 1) + ia, b0 = a0 + NA + 1;
        /* ⚠️⚠️ 绕向 2026-10-10 修：原来写的是 (a0, b0, a0+1) —— 环点按 a 递增生成，
           而在 xz 平面上"a 递增"从 +y 往下看是**顺时针** ⇒ 法线朝下 ⇒ 从上看全被背面
           剔除，**六片草皮一片都看不见**（出图三轮都判"没有碾压痕迹"，而场景里明明有 6 个
           网格）。正解 = 反向绕：(a0, a0+1, b0) 法线才朝 +y。
           ⚠️ 同类检查：同批的石板路绕向是对的（它的 side 向量按切线旋转 90° 构造，
           叉积算出来 y 分量为正 ⇒ 一直可见），所以只有草皮这一处踩坑。 */
        idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(mesh(geo, mat, { name: 'yardWear', cast: false, receive: true }));
  };
  const wornDry = new THREE.MeshStandardMaterial({ color: 0x9B8B4E, roughness: 0.99, metalness: 0,
    transparent: true, depthWrite: false, alphaMap: wornAlpha });
  const wornBare = new THREE.MeshStandardMaterial({ color: 0x6D5B45, roughness: 1.0, metalness: 0,
    transparent: true, depthWrite: false, alphaMap: wornAlpha });
  /* 上马位（A 车 + 两匹挽马脚下）= 碾压最重；停车位（B 车）= 次之；院门进出口 = 最轻 */
  mkPatch(-3.0, -2.1, 3.0, wornDry, 1.3);  mkPatch(-3.0, -2.1, 2.1, wornBare, 1.3);
  mkPatch( 3.0, -1.2, 2.2, wornDry, 2.7);  mkPatch( 3.0, -1.2, 1.5, wornBare, 2.7);
  mkPatch( 0.0, -4.1, 2.0, wornDry, 4.1);  mkPatch( 0.0, -4.1, 1.3, wornBare, 4.1);

  /* 马夫站位（供 08-assemble 回填人物用）：站在**低头受喂那匹马的头前**、面朝局部 +z
     （也就是朝马嘴），栅栏（z=−4.7）**以内**。
     ⚠️ 2026-10-11：从 z=−4.35 收到 **−4.05**（老黄："马夫看不出来喂马的动作"）——
     实测马鼻端在 z≈−3.77、马夫伸手再往前 ~0.4m，原来两处相隔 1.0m 以上，
     出图判读"草离马嘴还差一点距离、人和马是摆拍式对峙"；收近后草捆正好抵在马嘴前。
     ⚠️⚠️ 2026-10-14 用户报"马夫和吃草的马穿模"—— 收到 −4.05 后马夫躯干与马头前伸段**重叠**
     （改前出图实测：马夫背影直接糊住马脸）。折中回退 **0.25m 到 −4.30**：仍是"伸手可及"的
     喂食距离（草捆抵在马嘴前 ~0.15m），但躯干不再插进马头。这是六条里**最小改动**的一条
     —— 只动一个数，不碰手臂角度、也不碰马的低头幅度。 */
  const groomLocal = [1.5, -4.30];
  /* ⚠️ 打 noMerge 必须放在**所有槽位内容都挂完之后**（挽具是在上面的循环里挂进 slot.group 的）——
     放在 addHorseSlot 里会漏掉挽具，那些件照样被烘进 mergedStatic 而永远摘不掉。 */
  for (const s of horseSlots) markNoMerge(s.group);
  g.userData.stable = {
    cx, cz, yaw, plinthTop,
    groom: { x: cx + groomLocal[0] * cy + groomLocal[1] * sy,
             y: 0, z: cz - groomLocal[0] * sy + groomLocal[1] * cy,
             /* ⚠️ 朝向**随厩身走**（原来 08 里硬写 π/2，是因为当时 yaw 固定 π/2；
                改朝向之后硬写的那份会跟厩身拧 90° ⇒ 从 makeStable 里暴露出来） */
             yaw },
    /* 院门中心（世界）—— 给院外石板路起头用（局部门在 (0, −FD)） */
    gate: { x: cx + (-FD) * sy, z: cz + (-FD) * cy },
    horses: 6,
  };
  g.userData.stable.groom.y = groundHeight(g.userData.stable.groom.x, g.userData.stable.groom.z);
  return g;
}
