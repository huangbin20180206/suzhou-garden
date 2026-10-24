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
/* 路灯真光源要进 lamp 通道（12-env :303 按 worldLights 逐盏发强度）。
   方向单纯：12d-lantern 不 import 本模块 ⇒ 不成环（与上面 ENV 那条同理）。 */
import { worldLights } from './12d-lantern.js';
import { renderer, scene, camera, ACTIVE_QUALITY } from './02-scene.js';
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
   ⚠️ 2026-10-19：本段是 **Rodin 灰模**的历史说明。现行资产已换成 Tinker 骨骼马
      （见下方 TINKER_GLB 与 applyTinkerPose），"低头吃草"等动作由真实骨骼完成；
      Rodin 件只作为 horseSrcOnce 的离线回退保留在 research/diy-horses/。
   ⚠️ 失败必须留替身：加载不成（离线/404）就保留下面的**程序化马**（项目既有约定：
      芭蕉/荷花都这么做），否则马厩会变成空厩。 */
const HORSE_GLB = 'research/diy-horses/horse-rodin-fallback.glb';   // 旧 Rodin 灰模（仅 horseSrcOnce 回退用）
/* 模型自带的朝向修正：生成模型的"正面"不一定朝 +z（本项目程序化马的头朝 +z）。
   实测（outputs/_diag/horse-view.html 五视图 + 坐标轴参考线：front/back/right/top 四视图
   一致指向"头朝 +z"）⇒ 与程序化马同向，**不用转**。 */
/* 真马的总高（蹄底→耳尖）。⚠️ 别按"肩高"归一：模型包围盒的 Y 就是**总高**，
   而马厩里所有配件都是照程序化替身配的（替身耳尖 ~1.74m、体长 ~1.9m），
   归一成 1.5（= 肩高）会让真马比柱子/横轭/马车**小一大圈**。取 1.75 ⇒ 体长 ~1.94m，
   与替身逐项对齐（槽位、横轭 1.60、挽带 0.92、车厢前沿）。 */
const HORSE_TOTAL_H = 1.75;

/* ══ 真马 · Tinker（2026-10-19）════════════════════════════════════════════════
   老黄："这个可是有真实模型的，实在不行，你帮我换成带毛发的模型吧" + 六类动作清单：
   低头吃草 / 撅嘴嚼 / 摇尾巴 / 动前蹄 / 抬头晃脑袋与鬃毛 / 冬天口鼻冒白气。

   资产：**BlenderKit「Draft horse. Tinker, gypsy vanner breed」**（作者 Irena Aidlin Moonin，
   Royalty Free，免 key）。1.6MB GLB：Rigify **454 根骨骼**、7 个蒙皮网格
   （Horse_LP 7724 面 / 鬃 80 / 尾 180 / 眼 2×480 / 牙 2×1728）、3 张 1k WebP
   （baseColor / normal / roughness）。**无预烘动画**，所以动作全部在运行时按骨骼推。
   ⚠️ 原 Rodin `Horse.glb`（静态灰模）保留在磁盘作回退，不再预载。
   ⚠️ 本件是 Draco 压缩：解码器走 gstatic（与 06e-assets 同一条路径）；离线拉不到时
      required:false ⇒ 保留程序化替身，不会空厩。

   ── 骨骼轴（2026-10-19 实测：outputs/_diag/tinker-bones.mjs，六组侧视截图）──
     · DEF-neck001..004 局部 X **正 = 低头**（四节分配 0.34/0.28/0.22/0.16）
     · DEF-head 局部 X 点头、局部 Z 左右晃头（Y 是滚转，不用）
     · DEF-jaw / DEF-jaw001 局部 X 张嘴（嚼）
     · DEF-tail001..005 局部 Z 甩尾（五节权重 0.45/0.25/0.15/0.10/0.05）
     · DEF-upper_armL/R 局部 X 正 = 抬前蹄；forearm 反向弯、forefoot 回收
     · DEF-earL/R 局部 Z 抖耳；DEF-noseL/R 局部 X 扩鼻（白气同步）
     · DEF-mane_base/top01..06 鬃毛次级摆动
   ⚠️ three.js 的 GLTFLoader 会把节点名里的 `.` 去掉（DEF-neck.001 → DEF-neck001），
      骨骼名一律按**去掉点号**的写法取（见 tinker-bones.mjs 的实测名单）。 */
const TINKER_GLB = 'assets/HorseTinker.glb';
/* ══ 驱动骨**真值表**（2026-10-19 · probe/_tmp-horse-diag6/diag8.mjs 逐骨实测）═════
   ⚠️⚠️ 上一版是按"DEF-* 命名"猜的，结果**六项动作里只有摇尾/抬蹄真的动了**，
   其余四项（低头吃草/撅嘴嚼/抬头晃头/抖鬃毛）打的是**另一条链** ⇒ 完全空转，
   马就一直是"站桩"（老黄说的"僵尸马"）。
   根因：这套 Rigify 导出件里有**两条平行的骨链**，而**皮肤分开挂在两条链上**：
     · ORG 链：torso→spine_fk→ORG-spine→ORG-neck001..004→ORG-head→{ORG-skull, jaw, ear*, nose*}
     · DEF 链：root→DEF-spine001..006→DEF-neck001..004→DEF-head
   实测皮肤归属（Horse_LP 4432 顶点）：头骨 547→DEF-skull；下颌 219→jaw；
   脖皮 141→DEF-neck001/002；前蹄 112→f_hoofL；上臂/前臂/蹄趾→DEF-upper_arm/DEF-forearm/DEF-f_toe。
   ⇒ **低头必须转 ORG-neck**（转 DEF-neck 只有 141 个脖皮顶点跟着动，头不动）；
     DEF-neck 与 ORG-neck 是同角度的两条副本 ⇒ **同号同权重**驱动，否则脖皮会与头撕开。
   方向（实测，probe/_tmp-horse-diag8.mjs）：
     · ORG-neck X **正 = 低头**（+0.64rad ⇒ 口鼻降 0.37m）；ORG-head X 正 = 点低头、Z 正 = 摇
     · jaw X 正 = 张嘴、负 = 合嘴；DEF-jaw X 正 = 下齿张得更开
     · tail001..005 / DEF-tail001..005 Z 正 = 甩尾
     · ORG-upper_arm/forearm/forefoot/f_toe + f_hoof 带动整条前腿（DEF 链只带得上臂/前臂） */
const TINKER_BONE_GROUPS = {
  neckORG: ['ORG-neck001','ORG-neck002','ORG-neck003','ORG-neck004'],
  neckDEF: ['DEF-neck001','DEF-neck002','DEF-neck003','DEF-neck004'],
  head:    ['ORG-head'],
  jaw:     ['jaw'],
  jawTeeth:['DEF-jaw'],
  earL:    ['earL'], earR: ['earR'],
  earLDEF: ['DEF-earL'], earRDEF: ['DEF-earR'],
  nose:    ['noseL','noseR','DEF-noseL','DEF-noseR'],
  /* ⚠️⚠️ 2026-10-20 实测定论（接长尾时踩到）：GLB 文件里的骨名**带点**（Blender Rigify
     风格：'ORG-tail.001'/'DEF-tail.001'，可在 GLB JSON 里直接查到），但 three.js
     GLTFLoader 挂名时走 PropertyBinding.sanitizeNodeName —— 把 '.' 一律**删掉**
     （'ORG-tail.001' → 'ORG-tail001'，vendor.js 的 createUniqueName 一段可证）。
     ⇒ 本表必须用**不带点**的名字；照 GLB JSON 抄带点名会全部查空
     （实测 console 报 [马·Tinker] 缺骨骼 tail.001,... —— 2026-10-20 当天改错过一次）。 */
  tail:    ['tail001','tail002','tail003','tail004','tail005'],
  tailDEF: ['DEF-tail001','DEF-tail002','DEF-tail003','DEF-tail004','DEF-tail005'],
};
const TINKER_MANE_BONES = (() => {
  const out = [];
  for (let i = 1; i <= 6; i++){
    const p = String(i).padStart(2, '0');
    out.push('mane_base' + p, 'mane_top' + p, 'DEF-mane_base' + p, 'DEF-mane_top' + p);
  }
  return out;
})();
const TINKER_LEG_BONES = (s) => ([
  'DEF-upper_arm' + s, 'DEF-upper_arm' + s + '001', 'DEF-forearm' + s, 'DEF-forearm' + s + '001',
  'DEF-forefoot' + s, 'DEF-forefoot' + s + '001', 'DEF-f_toe' + s,
  'ORG-upper_arm' + s, 'ORG-forearm' + s, 'ORG-forefoot' + s, 'ORG-f_toe' + s, 'f_hoof' + s,
]);
/* 后腿：2026-10-21 接入步态时补。Rigify 的后腿链是
   thigh → thigh.001 → lower_leg → lower_leg.001 → hind_foot → hind_foot.001 → r_toe → r_hoof，
   与皮肤分层（DEF 带主体、ORG 带骨骼驱动）同前腿，两条链都要转、同号同权重，否则会撕开。
   ⚠️ 名字同样不带点（GLTFLoader 会删 '.'）：'DEF-thigh.L' → 'DEF-thighL'。 */
const TINKER_HIND_LEG_BONES = (s) => ([
  'DEF-thigh' + s, 'DEF-thigh' + s + '001', 'DEF-lower_leg' + s, 'DEF-lower_leg' + s + '001',
  'DEF-hind_foot' + s, 'DEF-hind_foot' + s + '001', 'DEF-r_hoof' + s,
  'ORG-thigh' + s, 'ORG-lower_leg' + s, 'ORG-hind_foot' + s, 'r_hoof' + s,
]);
const TINKER_ANIM_BONES = (() => {
  const out = [];
  const g = TINKER_BONE_GROUPS;
  for (const k of Object.keys(g)) out.push(...g[k]);
  out.push(...TINKER_MANE_BONES);
  out.push(...TINKER_LEG_BONES('L'), ...TINKER_LEG_BONES('R'));
  out.push(...TINKER_HIND_LEG_BONES('L'), ...TINKER_HIND_LEG_BONES('R'));
  return out;
})();
let _tinkerBuf = null, _tinkerLoader = null, _tinkerWarned = false;
function tinkerBuffer(){
  if (!_tinkerBuf){
    _tinkerBuf = fetch(TINKER_GLB).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
    _tinkerBuf.catch(() => { _tinkerBuf = null; });
  }
  return _tinkerBuf;
}
function tinkerLoader(){
  if (!_tinkerLoader) _tinkerLoader = new GLTFLoader();   // 导出件已无 Draco，不挂解码器
  return _tinkerLoader;
}
/* ⚠️⚠️ 预载握手（2026-10-19 · 踩过一次）：13-preload 的 PRELOAD_MANIFEST 会**等每个 GLB
   回报 settleAsset** 才放行；马匹 GLB 的下载在本模块里由 `tinkerBuffer()` 发起，如果只在
   延迟批里调用，预载段会一直等一个永远不来的 settled ⇒ 进度条卡在 9.3/10.8MB、
   页面永远到不了 done（实测 120s 超时）。旧 Rodin 路径的 horseSrcOnce 就是在这里
   settle 的，换成 Tinker 时这条握手必须一起搬过来。
   所以：模块求值期就发起 fetch，并在完成/失败时回报 settle + 进度。 */
tinkerBuffer().then(() => {
  HOOKS.reportAssetProgress?.(TINKER_GLB, 1616944, 1616944);
  HOOKS.settleAsset?.(TINKER_GLB, true);
}).catch((e) => {
  HOOKS.settleAsset?.(TINKER_GLB, false, e);
});
/* 逐匹上色：
   2026-10-20 老黄纠偏（"马的整体外形还要再调整，颜色太深了，跟我们常见的马完全不一样"）：
   根因：原模型自带大块黑白斑块贴图，与 tint 相乘后黑斑死黑、读作烤焦罗威纳犬斑块。
   去掉黑花斑贴图，改用 horseCoatMaps() 的均匀各向异性毛流图与法线图，
   还原纯正、干净的中国传统名马毛色（枣红、纯黑、青白、栗色）。
   眼材质保留深褐，鬃毛保持深色自然对比。 */
/* ── 马身毛发：**程序细毛法线 + 顶点色标记**（2026-10-21 材质隔离实验定稿）────────
   ⚠️⚠️ 老黄四条差评里"毛发像蜡像""配色夸张难看"的**实测根因**（probe/_tmp-mat-iso-2020.mjs
      同机位五种配置对照）：
       ① 原样（模型自带 albedo 图集 + 模型自带法线）⇒ 灰马一身**霉斑**、蜡质感；
       ② **去掉 albedo 图集**（纯 tint）⇒ 立刻干净 ⇒ **霉斑全是那张 UV 图集造成的**
          （那张图不是毛发照片，是各部件在 UV 空间里各画各的颜色：深灰的腿、浅灰的身、
            粉的口鼻 —— 一乘 tint 就成了大块深浅不一的斑块）；
       ③ 再去掉法线 ⇒ 纯色泥塑（干净但没毛）；
       ④ 换成**程序细毛法线** ⇒ 立刻是"有毛的马"；
       ⑤ 同上但强度减半 ⇒ 更自然。
   ⇒ 定稿：**丢掉模型 albedo**（改用顶点色做"黑腿/黑口鼻"这类标记），
     法线换成程序细毛（高频、低强度），roughness 0.70（非全哑光）。
   ⚠️ 教训：不是"贴图越真实越好"，而是**这张模型贴图本身不适合直接乘色** ——
      换成"程序毛流 + 顶点色标记"反而更像真马。 */
let _furNormal = null;
function furNormalMap(){
  if (_furNormal) return _furNormal;
  const S = 512;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(S, S);
  /* 各向异性细毛：横向密、纵向疏 ⇒ 条纹沿 y（毛流方向） */
  const gx = 128, gy = 12;
  const g = new Float32Array(gx * gy);
  let seed = 20261021;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
  const at = (x, y) => {
    const fx = (x / S) * gx, ix = Math.floor(fx), tx = fx - ix;
    const fy = (y / S) * gy, iy = Math.floor(fy), ty = fy - iy;
    const a = g[(iy % gy) * gx + (ix % gx)], b = g[(iy % gy) * gx + ((ix + 1) % gx)];
    const c = g[((iy + 1) % gy) * gx + (ix % gx)], d = g[((iy + 1) % gy) * gx + ((ix + 1) % gx)];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const K = 3.0;                                   // 强度：K3 ≈ 细绒毛，K8 就开始"搓衣板"
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    const o = (y * S + x) * 4;
    const nx = -(at(x + 1, y) - at(x - 1, y)) * K;
    const ny = -(at(x, y + 1) - at(x, y - 1)) * K;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    img.data[o] = (nx * inv * 0.5 + 0.5) * 255;
    img.data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
    img.data[o + 2] = (inv * 0.5 + 0.5) * 255;
    img.data[o + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  t.colorSpace = THREE.NoColorSpace;               // 法线是数据贴图，不能标 sRGB
  t.anisotropy = 8;
  t.needsUpdate = true;
  _furNormal = t;
  return t;
}

/* 顶点色标记：黑腿（真马"黑点"）+ 暗口鼻。色值 = 乘在材质色上的系数。 */
function markCoatPoints(mesh){
  const geo = mesh.geometry;
  if (geo.getAttribute('color')) return;           // 已有就别覆盖
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const h = Math.max(1e-4, bb.max.y - bb.min.y);
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = (y - bb.min.y) / h;                  // 0 蹄 → 1 耳
    /* 腿：下 34% 压到 0.45，34%~52% 平滑回到 1（腿毛天然更黑） */
    let f = t < 0.34 ? 0.45 : t < 0.52 ? 0.45 + 0.55 * (t - 0.34) / 0.18 : 1;
    /* 口鼻：最前 + 最低的一小片再压一档（真马口鼻偏深） */
    if (z > bb.max.z - h * 0.10 && t < 0.45) f = Math.min(f, 0.62);
    /* 鼻孔：口鼻两侧各一团深色（2026-10-21 蓝框：马嘴长而窄、无鼻孔 ⇒ 读作"狗/海豹"）。
       zmax=0.457（实测）；鼻孔中心 (±0.038, 1.32, zmax-0.037)，椭球半径 (0.028,0.035,0.06)。 */
    if (y > 1.15 && z > bb.max.z - 0.12){
      const dx = (Math.abs(x) - 0.038) / 0.028, dy = (y - 1.32) / 0.035, dz = (z - (bb.max.z - 0.037)) / 0.06;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < 1) f = Math.min(f, 0.38 + 0.62 * dd);
    }
    arr[i * 3] = f; arr[i * 3 + 1] = f; arr[i * 3 + 2] = f;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

/* ⚠️ 2026-10-21（老黄："脖子太厚太短，整个马看起来像一条巨型猎犬"）：
   Tinker 是 Irish Cob 重型马，颈粗短、头大。骏马要颈细长、头小。
   ⚠️ 不能用"骨缩放"——缩放颈链会把子骨（头）的位置也缩进去，反而把脖子**缩短**
   （门禁①就因此从 -0.473 掉到 -0.239）。正解：**只瘦几何顶点**（X 方向压、
   Y/Z 不动）⇒ 颈变细但长度不变。 */
function slimNeck(mesh){
  /* ⚠️ v2（2026-10-21 蓝框：马嘴长而窄、无鼻孔、颈侧面厚 ⇒ "巨型猎犬"）：
     ① 颈 X 压 0.78（v1 已有）；② 吻端**加宽**回 ~1.0（头 0.90 × 吻 1.12：
     真马吻端宽钝、有鼻翼，窄长吻 = 狗）；③ Z 不动（颈中心线支点没法定准，
     对称 X 缩放对支点误差免疫，Z 缩放会平移整个头）。全程 smoothstep 羽化，无硬缝。 */
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const n = pos.count;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let sx = 1 - 0.22 * ss(0.95, 1.08, y) * (1 - ss(1.30, 1.44, y));   // 颈 0.78
    sx *= 1 - 0.10 * ss(1.30, 1.46, y);                                // 头 0.90
    sx *= 1 + 0.12 * ss(0.30, 0.42, z) * ss(1.15, 1.28, y) * (1 - ss(1.40, 1.50, y)); // 吻端钝化
    pos.setX(i, x * sx);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function tinkerMaterial(m, tint, meshName){
  const c = m.clone();
  /* ⚠️⚠️ 2026-10-20 修两处实打实的缺陷（老黄："颜色太深了，跟我们常见的马完全不一样"）：
     ① horseCoatMaps() 返回的键是 **color / rough / normal**（15-stable.js 1142 行），
        而这里原来写的是 coat.map / coat.normalMap / coat.roughnessMap —— 三个全是 undefined。
        结果 c.map = undefined ⇒ 马身**一张贴图都没有**，只剩一层纯色 + 法线贴图缺失 ⇒
        出图判读"又深又平、不像真马"。必须逐字对上。
     ② 尾巴网格（mesh 名 Tail，材质 horse_body_unique_Tail）**不匹配** Horse_LP/eye/mane 任一条
        ⇒ 落进 else 被刷成纯白。真马尾应与身体同色系（深一档），否则读作"粘了团白棉花"。 */
  const isCoat = /Horse_LP/i.test(m.name || '');
  const isMane  = /mane/i.test(m.name || '') || /BSurface/i.test(meshName || '');
  const isTail  = /tail/i.test(meshName || '') || /tail/i.test(m.name || '');
  if (isCoat){
    /* ⚠️⚠️ 2026-10-21 定稿（老黄："毛发像蜡像""配色夸张难看"）：
       ① **丢掉模型自带的 albedo**（那张 UV 图集是霉斑元凶，见 furNormalMap 上方注释）；
       ② 法线换成**程序细毛**（模型自带法线是"融化蜡块"元凶）；
       ③ roughness 1.0 → 0.70（全哑光也是蜡像主因）；
       ④ **顶点色**做黑腿/暗口鼻标记（代替图集里那些画好的部件颜色）；
       ⑤ 颜色由 tint 决定（干净的单色毛），不再有花斑。 */
    c.map = null;
    c.normalMap = furNormalMap();
    c.normalScale.set(0.30, 0.30);
    c.roughness = 0.70;
    c.envMapIntensity = 0.34;
    c.color.copy(tint);
    c.vertexColors = true;
  }
  else if (/eye/i.test(meshName || '')) c.color.set(0x2a1c14);
  else if (isMane || isTail){
    /* 鬃/尾：跟体毛同色系、比体毛深一档（真马鬃尾与体毛同源）；
       材质保留模型自带的毛发贴图（它的深浅就是毛流），只压暗一档。 */
    c.color.copy(tint).multiplyScalar(0.45);
  }
  else c.color.set(0xFFFFFF);
  c.metalness = 0.0;
  if (!isCoat) c.roughness = Math.max(0.72, c.roughness || 0.88);   // 马身另有 roughness（见上）
  if (!isCoat) c.envMapIntensity = 0.28;
  if (c.clearcoat !== undefined) c.clearcoat = 0.0;
  c.needsUpdate = true;
  return c;
}
const _tq = new THREE.Quaternion(), _te = new THREE.Euler(), _tid = new THREE.Quaternion();
const _tv = new THREE.Vector3();
function tinkerBone(bones, rest, name, x, y, z){
  const b = bones[name]; if (!b) return;
  _te.set(x, y, z, 'XYZ'); _tq.setFromEuler(_te);
  b.quaternion.copy(rest[name] || _tid).multiply(_tq);
}
/* 把"概念上的姿态角"翻译成骨骼旋转。headPitch 正 = 低头（与旧伪蒙皮同号）。
   ⚠️ 骨名按上面的**真值表**取（ORG 链带动头/下颌/耳/鼻，DEF 链带动脖皮/上臂），
   方向也按实测：ORG-neck X 正 = 低头、ORG-head X 正 = 低头 Z 正 = 摇、jaw X 正 = 张嘴。 */
const TINKER_JAW_CLOSE = 0.46;   // 静息合嘴：模型出厂是"微张"，露上下齿 → 读作龇牙僵尸脸
function applyTinkerPose(h, headPitch, headYaw, tailYaw, leg, dt){
  const B = h.anim.bones, R = h.anim.rest;
  /* ① 颈：低头量（rad）。ORG 链带头，DEF 链带脖皮 —— 两条同号同权重。
     ⚠️ 2026-10-21 步态：走/跑时要把"低头吃草"渐隐掉，否则一匹马低着头走路。
     h.grazeW 由 tickStableLife 逐帧趋近（吃草 1 / 走动 0），这里只按权重乘进去。 */
  const gw = (h.grazeW == null) ? 1 : h.grazeW;
  let hp = headPitch * 1.9;
  if (h.role === 'graze') hp += 0.95 * gw; else if (h.role === 'fed') hp += 0.66 * gw;
  /* 颈的分配：越靠上（靠头）弯得越多 ⇒ 脖子是"弧"不是"折"（下段权重小、末两节大）。 */
  const nw = [0.20, 0.24, 0.28, 0.28];
  for (let i = 0; i < 4; i++){
    const a = hp * nw[i];
    tinkerBone(B, R, 'ORG-neck00' + (i + 1), a, 0, 0);
    tinkerBone(B, R, 'DEF-neck00' + (i + 1), a, 0, 0);
  }
  /* ② 头：点/摇（ORG-head：X 正 = 低头、Z = 摇） */
  tinkerBone(B, R, 'ORG-head', headPitch * 0.55, 0, headYaw * 1.15);
  /* ③ 下颌：静息合嘴 + 吃草时轻嚼。'jaw' 带嘴皮，'DEF-jaw' 带下齿网格。
     ⚠️ 幅度 0.055+0.05 ⇒ 只摆 0.1rad（≈6°），近景读作"嘴没动" ⇒ 加到 0.085+0.065
     （≈9°，门禁 horse-motion-guard 的"下颌角摆动 ≥0.05rad"也随之更稳）。 */
  const chew = (h.role === 'graze' || h.role === 'fed')
    ? (0.085 + 0.065 * Math.sin(_stT * 5.4 + h.phase)) * gw
      + 0.008 * Math.sin(_stT * 0.9 + h.phase) * (1 - gw)
    : 0.008 * Math.sin(_stT * 0.9 + h.phase);
  tinkerBone(B, R, 'jaw', -TINKER_JAW_CLOSE + chew, 0, 0);
  tinkerBone(B, R, 'DEF-jaw', -TINKER_JAW_CLOSE + chew, 0, 0);
  /* ④ 尾：尾网格主骨是纯名 tail001..005，体上尾根是 DEF-tail001..005 —— 两条都转。 */
  const tw = [0.45, 0.25, 0.15, 0.10, 0.05];
  for (let i = 1; i <= 5; i++){
    const a = tailYaw * tw[i - 1], p = String(i).padStart(3, '0');
    tinkerBone(B, R, 'tail' + p, 0, 0, a);
    tinkerBone(B, R, 'DEF-tail' + p, 0, 0, a);
  }
  /* ⑤ 四肢。两套通道：
     · 旧：leg[0..3] 是"抬蹄量"（原地点一下），前腿只用 0/1；
     · 新：h.gaitLegs 是 { FL,FR,HL,HR } → [前摆角, 抬腿/折腿量, 蹄角]，由
       tickStableLife 的步态生成器逐帧算（2026-10-21 接入"会走/会跑"）。
     两套都走同一组 DEF/ORG 骨；**DEF 与 ORG 同号同权重**，否则皮肤和骨头会撕开。 */
  const gait = (h.gaitW > 0.001 && h.gaitLegs) ? h.gaitLegs : null;
  const gW = gait ? h.gaitW : 0;
  const legVal = (k) => {
    if (gait) {
      const a = gait[k] || [0, 0, 0];
      return [a[0] * gW, a[1] * gW, a[2] * gW];
    }
    return null;
  };
  if (!gait) {
    const lift = Math.max(leg[0], leg[1]);
    for (const s of ['L', 'R']){
      const on = (s === 'L') ? (leg[0] >= leg[1] && leg[0] > 0.01) : (leg[1] > 0.01);
      const aU = on ? lift * 1.35 : 0, aF = on ? -lift * 1.05 : 0, aT = on ? lift * 0.55 : 0;
      tinkerBone(B, R, 'DEF-upper_arm' + s, aU, 0, 0);
      tinkerBone(B, R, 'DEF-upper_arm' + s + '001', aU * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-forearm' + s, aF, 0, 0);
      tinkerBone(B, R, 'DEF-forearm' + s + '001', aF * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-forefoot' + s, aT, 0, 0);
      tinkerBone(B, R, 'DEF-forefoot' + s + '001', aT * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-f_toe' + s, aT, 0, 0);
      tinkerBone(B, R, 'ORG-upper_arm' + s, aU, 0, 0);
      tinkerBone(B, R, 'ORG-forearm' + s, aF, 0, 0);
      tinkerBone(B, R, 'ORG-forefoot' + s, aT, 0, 0);
      tinkerBone(B, R, 'ORG-f_toe' + s, aT, 0, 0);
      tinkerBone(B, R, 'f_hoof' + s, aT, 0, 0);
    }
  } else {
    for (const s of ['L', 'R']){
      /* 前腿：+X = 向前/抬起（2026-10-19 实测）。 */
      const [u, l, f] = legVal('F' + s);
      const aU = u * 1.20, aF = -l * 1.00, aT = f * 0.55;
      tinkerBone(B, R, 'DEF-upper_arm' + s, aU, 0, 0);
      tinkerBone(B, R, 'DEF-upper_arm' + s + '001', aU * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-forearm' + s, aF, 0, 0);
      tinkerBone(B, R, 'DEF-forearm' + s + '001', aF * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-forefoot' + s, aT, 0, 0);
      tinkerBone(B, R, 'DEF-forefoot' + s + '001', aT * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-f_toe' + s, aT, 0, 0);
      tinkerBone(B, R, 'ORG-upper_arm' + s, aU, 0, 0);
      tinkerBone(B, R, 'ORG-forearm' + s, aF, 0, 0);
      tinkerBone(B, R, 'ORG-forefoot' + s, aT, 0, 0);
      tinkerBone(B, R, 'ORG-f_toe' + s, aT, 0, 0);
      tinkerBone(B, R, 'f_hoof' + s, aT, 0, 0);
      /* 后腿：+X = 向后/抬起（2026-10-21 Blender 实测）⇒ 向前要用 -X；
         折腿/抬蹄用 +X（与"向后"同向，但叠加在负的前摆上仍是抬腿）。 */
      const [hu, hl, hf] = legVal('H' + s);
      const bU = -hu * 1.10, bF = hl * 0.90, bT = hf * 0.50;
      tinkerBone(B, R, 'DEF-thigh' + s, bU, 0, 0);
      tinkerBone(B, R, 'DEF-thigh' + s + '001', bU * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-lower_leg' + s, bF, 0, 0);
      tinkerBone(B, R, 'DEF-lower_leg' + s + '001', bF * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-hind_foot' + s, bT, 0, 0);
      tinkerBone(B, R, 'DEF-hind_foot' + s + '001', bT * 0.5, 0, 0);
      tinkerBone(B, R, 'DEF-r_hoof' + s, bT, 0, 0);
      tinkerBone(B, R, 'ORG-thigh' + s, bU, 0, 0);
      tinkerBone(B, R, 'ORG-lower_leg' + s, bF, 0, 0);
      tinkerBone(B, R, 'ORG-hind_foot' + s, bT, 0, 0);
      tinkerBone(B, R, 'r_hoof' + s, bT, 0, 0);
    }
  }
  /* ⑥ 耳朵：耳皮挂纯名 earL/earR（耳尖是它的子骨 earL001）⇒ 转父骨即可。 */
  const earFlick = h.flickT > 0 ? 0.30 * Math.sin(Math.PI * Math.min(1, 1 - h.flickT / 0.9)) : 0;
  tinkerBone(B, R, 'earL', 0, 0, earFlick);
  tinkerBone(B, R, 'earR', 0, 0, -earFlick);
  tinkerBone(B, R, 'DEF-earL', 0, 0, earFlick * 0.6);
  tinkerBone(B, R, 'DEF-earR', 0, 0, -earFlick * 0.6);
  /* ⑦ 鼻孔：鼻皮挂纯名 noseL/noseR，DEF-noseL/R 也带着一点。 */
  h.flare = Math.max(0, (h.flare || 0) - dt * 1.3);
  tinkerBone(B, R, 'noseL', h.flare, 0, 0);
  tinkerBone(B, R, 'noseR', h.flare, 0, 0);
  tinkerBone(B, R, 'DEF-noseL', h.flare, 0, 0);
  tinkerBone(B, R, 'DEF-noseR', h.flare, 0, 0);
  /* ⑧ 鬃毛：次级摆动。⚠️ 这匹马的鬃是**独立网格**（BSurfaceMesh001，63 顶点），
     其中 33 个顶点挂在 **DEF-neck001..004** 上（⇒ 抬头/低头时鬃自然跟着甩），
     只有 9 个顶点挂纯名 mane_base02..06 ⇒ 靠它做"次级摆动"能动的肉很少。
     ⇒ 幅度给到 0.05rad（原来 0.022 几乎看不出），相位逐节错开，读作"鬃毛一颤一颤"。 */
  for (let i = 1; i <= 6; i++){
    const p = String(i).padStart(2, '0');
    const sway = 0.05 * Math.sin(_stT * 1.6 + h.phase + i * 0.7);
    tinkerBone(B, R, 'mane_base' + p, 0, 0, sway);
    tinkerBone(B, R, 'mane_top' + p, 0, 0, sway * 1.2);
    tinkerBone(B, R, 'DEF-mane_base' + p, 0, 0, sway);
    tinkerBone(B, R, 'DEF-mane_top' + p, 0, 0, sway * 1.2);
  }
  h.lastHP = headPitch; h.lastHY = headYaw; h.lastTY = tailYaw; h.lastLeg = leg.slice();
}
/* ── 低头（吃草/就食）：把"颈+头"绕颈根的 X 轴向下转 ────────────────────────
   ⚠️ 真模型是**静态单网格**（无骨骼），所以只能在**几何**上做。参数是
     outputs/_diag/horse-view.html?graze=1 六格侧视对照实测出来的：
       · 25° = 微微低头（"就着马夫手里的草料"）；35° = 明显的低头吃草；45° 略过头；
       · **63° 以上立刻读成"脖子被压扁/折断"**（环状管在急转处自交）——所以上限锁 45°。
     枢轴 (y0.04, z0.13) 是"颈在胸口上的根"（模型局部坐标，包围盒 y∈[−0.451,0.451]）；
     权重 = z 门 × y 门，**y 门是为了不碰前腿**（腿在 y<0.05）。 */
  // eslint-disable-next-line no-unused-vars -- 保留：换回 Tinker 骨骼马时的低头烘焙路径
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
  const P = { head: piv.neck, tail: piv.tail, legF: piv.legF, legH: piv.legH,
              jaw: piv.jaw || [0, 1.2, 0.8] };
  mat.userData.rig = { head: new THREE.Vector2(0, 0), tail: new THREE.Vector2(0, 0),
                       leg: new THREE.Vector4(0, 0, 0, 0), jaw: new THREE.Vector2(0, 0) };
  const N = geo.attributes.position.count, pos = geo.attributes.position;
  const A = new Float32Array(N * 4), B = new Float32Array(N * 2);
  const J = W.jaw ? new Float32Array(N) : null;
  for (let i = 0; i < N; i++){
    const x = pos.getX(i), L = x < 0 ? 1 : 0, R = x < 0 ? 0 : 1;
    A[i*4] = W.head[i]; A[i*4+1] = W.tail[i];
    A[i*4+2] = W.legF[i] * L; A[i*4+3] = W.legF[i] * R;
    B[i*2] = W.legH[i] * L;  B[i*2+1] = W.legH[i] * R;
    if (J) J[i] = W.jaw[i];
  }
  geo.setAttribute('aRigA', new THREE.BufferAttribute(A, 4));
  geo.setAttribute('aRigB', new THREE.BufferAttribute(B, 2));
  /* 下颌（Rodin 件没有下颌骨，只能靠这一层权重开合；旧 Tripo 马没有，是这次补的） */
  geo.setAttribute('aRigJaw', new THREE.BufferAttribute(J || new Float32Array(N), 1));
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
    sh.uniforms.uJawAng  = { value: mat.userData.rig.jaw };
    sh.uniforms.uPivJaw  = { value: P.jaw };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRigA;
        attribute vec2 aRigB;
        attribute float aRigJaw;
        uniform vec2 uHeadAng; uniform vec2 uTailAng; uniform vec4 uLegAng; uniform vec2 uJawAng;
        uniform vec3 uPivHead; uniform vec3 uPivTail; uniform vec3 uPivLegF; uniform vec3 uPivLegH; uniform vec3 uPivJaw;
        vec3 rigRX(vec3 p, vec3 pv, float a){ float c = cos(a), s = sin(a); vec3 d = p - pv;
          return vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c) + pv; }
        vec3 rigRY(vec3 p, vec3 pv, float a){ float c = cos(a), s = sin(a); vec3 d = p - pv;
          return vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c) + pv; }
      `)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3( position );
        /* 下颌先开合，再套头颈旋转（顺序反了的话，低头时下巴会被拉离鼻子） */
        if (aRigJaw > 0.002) transformed = mix(transformed, rigRX(transformed, uPivJaw, uJawAng.x), aRigJaw);
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

/* ── Rodin 马的姿态：同一个"角度语义"写进伪蒙皮 uniform ─────────────────────
   口径与 applyTinkerPose 保持一致（这样 tickStableLife 只算一份角度，两条路通用）：
     · 头：+ = 低头；吃草那两匹额外加基角（graze 0.95 / fed 0.66）× grazeW
     · 尾：tailYaw 原样（shader 里 rigRY 绕竖轴 = 左右甩）
     · 腿：伪蒙皮的 rigRX **正 = 蹄子向后**，而 gaitPose 的 u 是"前为正"⇒ 取负号
   ⚠️ 伪蒙皮做不出屈膝，整条腿绕肩/髋摆；15~25m 观感距离够用（旧 Tripo 马同款）。 */
function applyRodinPose(h, headPitch, headYaw, tailYaw, leg){
  const rig = h.mat && h.mat.userData && h.mat.userData.rig;
  if (!rig) return;
  const gw = (h.grazeW == null) ? 1 : h.grazeW;
  let hp = headPitch * 1.9;
  if (h.role === 'graze') hp += 0.95 * gw; else if (h.role === 'fed') hp += 0.66 * gw;
  rig.head.x = hp;
  rig.head.y = headYaw * 1.15;
  rig.tail.x = tailYaw;
  /* 咀嚼：口径与 Tinker 路径同源（吃草/受喂那两匹 5~9°，其余只有底噪） */
  const chew = (h.role === 'graze' || h.role === 'fed')
    ? (0.085 + 0.065 * Math.sin(_stT * 5.4 + h.phase)) * gw
      + 0.008 * Math.sin(_stT * 0.9 + h.phase) * (1 - gw)
    : 0.008 * Math.sin(_stT * 0.9 + h.phase);
  rig.jaw.x = chew;
  const gait = (h.gaitW > 0.001 && h.gaitLegs) ? h.gaitLegs : null;
  if (gait){
    const g = h.gaitW, k = (n) => -((gait[n] ? gait[n][0] : 0) * g);
    rig.leg.set(k('FL'), k('FR'), k('HL'), k('HR'));
  } else {
    /* 静止时偶尔抬前蹄：leg[0]=左前 leg[1]=右前（与 Tinker 路径同口径） */
    rig.leg.set(-(leg[0] || 0) * 1.2, -(leg[1] || 0) * 1.2, 0, 0);
  }
}

/* ── 每匹马的"生活"状态（装完 rig 后登记；tickStableLife 每帧推）────────────── */
const HORSE_LIFE = [];
const _sr = mulberry32(20261011);          // 私有流：事件间隔/相位/抖颈方向
let _stT = 0;
/* 诊断用：返回 HORSE_LIFE 本体（可变）。仅供探针在"冻结相位"下拍步态，
   产品逻辑不读它。用法：const h = m.horseLifeDebug().find(x=>x.gait);
   h.gait.state='move'; h.gait.dist=k; h.gait.phase=p; h.gaitW=1; 再 tick 一次。 */
export function horseLifeDebug(){ return HORSE_LIFE; }
export function horseLifeState(){
  return { n: HORSE_LIFE.length, t: +_stT.toFixed(2),
           horses: HORSE_LIFE.map(h => h.anim
             ? { role: h.role, skeletal: true, bones: Object.keys(h.anim.bones).length,
                 headPitch: +(h.lastHP || 0).toFixed(3), headYaw: +(h.lastHY || 0).toFixed(3),
                 tailYaw: +(h.lastTY || 0).toFixed(3),
                 leg: (h.lastLeg || [0,0,0,0]).map(v => +v.toFixed(3)),
                 /* 2026-10-21 步态诊断：状态/相位/前后行程/权重/世界位置 */
                 gait: h.gait ? { state: h.gait.state, mode: h.gait.mode,
                   dist: +h.gait.dist.toFixed(3), target: +h.gait.target.toFixed(3),
                   phase: +h.gait.phase.toFixed(3) } : null,
                 gaitW: +(h.gaitW || 0).toFixed(3), grazeW: +(h.grazeW || 0).toFixed(3),
                 pos: [+h.group.position.x.toFixed(3), +h.group.position.y.toFixed(3), +h.group.position.z.toFixed(3)],
                 breath: h.breath ? { live: h.breath.filter(b => b.life > 0).length } : null }
             : { role: h.role, skeletal: false,
                 headPitch: +h.mat.userData.rig.head.x.toFixed(3), headYaw: +h.mat.userData.rig.head.y.toFixed(3),
                 tailYaw: +h.mat.userData.rig.tail.x.toFixed(3),
                 jaw: h.mat.userData.rig.jaw ? +h.mat.userData.rig.jaw.x.toFixed(3) : 0,
                 leg: [...h.mat.userData.rig.leg].map(v => +v.toFixed(3)),
                 gaitW: +(h.gaitW || 0).toFixed(3), grazeW: +(h.grazeW || 0).toFixed(3),
                 gait: h.gait ? { state: h.gait.state, dist: +h.gait.dist.toFixed(3),
                   phase: +h.gait.phase.toFixed(3) } : null,
                 pos: [+h.group.position.x.toFixed(3), +h.group.position.y.toFixed(3), +h.group.position.z.toFixed(3)],
                 breath: h.breath ? { live: h.breath.filter(b => b.life > 0).length } : null }) };
}
/* ── 调试钩子（2026-10-19 · 骨链诊断用）：当前姿态 vs 绑定姿态的骨骼四元数 ──
   probe/_tmp-horse-diag9.mjs 用它比对"哪根骨被拧了多少"，定位头/脖撕开的问题。 */
export function tinkerPoseDebug(){
  const e = (q) => { const t = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return [+t.x.toFixed(3), +t.y.toFixed(3), +t.z.toFixed(3)]; };
  return HORSE_LIFE.map(h => {
    const B = h.anim.bones, R = h.anim.rest, out = {};
    for (const n of Object.keys(R)){
      if (!B[n]) { out[n] = null; continue; }
      out[n] = { now: e(B[n].quaternion), rest: e(R[n]) };
    }
    return { role: h.role, hp: +(h.lastHP || 0).toFixed(3), hy: +(h.lastHY || 0).toFixed(3),
             ty: +(h.lastTY || 0).toFixed(3), bones: out };
  });
}

/* 冬天口鼻白雾（只给辕里那两匹）：**位置在 CPU 上按同一套枢轴/角度复算** —— 顶点是 GPU 改的、
   CPU 不知道，所以这里照抄同一套旋转公式算出**鼻端**，再乘槽位组的世界矩阵。
   ⚠️ 四个纪律：私有流（可复现）、`raycast=()=>{}`（别拦视线判定）、`userData.aoSkip`（不进 GTAO
   法线 pass，否则亮片被当成实体写成一块黑）、**不写任何全局灯光**（与闪电/烟花/流星同一条教训）。 */
export const horseBreathMesh = (() => {
  const MAXB = 48;
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const cx = cv.getContext('2d');
  const grd = cx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grd.addColorStop(0.00, 'rgba(255,255,255,0.52)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.20)');
  grd.addColorStop(1.00, 'rgba(255,255,255,0)');
  cx.fillStyle = grd; cx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.45 });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAXB);
  im.name = 'horseBreath';
  im.frustumCulled = false;
  im.raycast = () => {};
  im.userData.aoSkip = true;
  im.count = 0;
  return im;
})();

/* ── 马的步态（2026-10-21）──────────────────────────────────────────────────
   目标：院中那匹灰马不再"站桩"，会自己走几步、偶尔小跑、停下吃草。
   做法是**程序化四拍步态**，不烘焙动画片段：
     · 每腿一个相位；着地段 hoof 相对身体向后匀速走，抬腿段折腿前摆；
     · 身体前进速度 = 步幅 / 周期（stride 与 speed 绑定）⇒ 脚不打滑；
     · 四个相位错开（走：左后→左前→右后→右前；跑：对角两拍）；
     · 头/颈/尾仍由 tickStableLife 的原有小动作驱动，不冲突。
   ⚠️ 前腿 +X = 向前抬；后腿 +X = 向后抬（Blender 实测）⇒ 生成器统一用"向前为正"，
     到 applyTinkerPose 里后腿取负号。 */
const HORSE_GAIT = {
  /* 2026-10-21 首轮实拍：幅度 0.30/0.42 在近景读作"腿叉得很开" ⇒ 收到 0.26/0.34。
     步幅仍与速度绑定（stride = 2·腿长·sinA / 着地比 ≈ 0.72m）。 */
  walk: { A: 0.28, lift: 0.52, stance: 0.62, stride: 0.75, speed: 0.78, bob: 0.016 },
  trot: { A: 0.34, lift: 0.62, stance: 0.47, stride: 1.24, speed: 1.85, bob: 0.024 },
};
/* 会走动的马用贴地软阴影（理由见 loadStableHorses 里 castShadow 那段）。
   64×64 径向渐变、只做一次材质；平面挂槽位组、y≈地面。 */
let _horseBlobMat = null;
function attachHorseBlob(slot){
  if (!_horseBlobMat){
    /* ⚠️ 用 map 不用 alphaMap：makeSoftAlphaTex 的渐变在**alpha 通道**里，
       alphaMap 只读绿通道（白底全 1）⇒ 会变成一块实心黑方块/或干脆看不见。
       map 的 RGB 是白的、乘 color=黑 ⇒ 黑色，透明度走 alpha 通道的径向渐变。 */
    _horseBlobMat = new THREE.MeshBasicMaterial({
      map: makeSoftAlphaTex(), color: 0x000000,
      transparent: true, opacity: 0.30, depthWrite: false,
    });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 2.30), _horseBlobMat);
  m.name = 'horseBlobShadow';
  m.rotation.x = -Math.PI / 2;
  /* 院里的"磨损土斑"贴在 +0.05，软影必须压在它上面，否则整块被土斑盖住（首轮实拍就是没有影）。 */
  m.position.set(0, 0.09, 0);
  m.renderOrder = 2;
  m.raycast = () => {};
  m.userData.aoSkip = true;
  m.userData.noMerge = true;      // 别被 mergeStatics 烘进静态大网（它要跟着马走）
  slot.group.add(m);
  slot.blob = m;
}
const GAIT_OFFSET = {
  walk: { HL: 0.00, FL: 0.25, HR: 0.50, FR: 0.75 },
  trot: { FL: 0.00, HR: 0.00, FR: 0.50, HL: 0.50 },
};
function gaitPose(mode, phase){
  const D = HORSE_GAIT[mode] || HORSE_GAIT.walk;
  const off = GAIT_OFFSET[mode] || GAIT_OFFSET.walk;
  const out = {};
  for (const k of ['FL', 'FR', 'HL', 'HR']){
    let p = (phase + (off[k] || 0)) % 1;
    if (p < 0) p += 1;
    let u, lift, toe;
    if (p < D.stance){
      /* 着地段：hoof 相对身体从 +A 匀速走到 −A（世界坐标里是踩住的）。 */
      const q = p / D.stance;
      u = D.A * (1 - 2 * q);
      lift = 0.05 * Math.sin(Math.PI * q);
      toe = 0;
    } else {
      /* 抬腿段：折腿 + 前摆，落地前把蹄放平。 */
      const q = (p - D.stance) / (1 - D.stance);
      const s = q * q * (3 - 2 * q);
      u = -D.A + 2 * D.A * s;
      lift = D.lift * Math.sin(Math.PI * q);
      toe = lift * 0.55;
    }
    out[k] = [u, lift, toe];
  }
  return out;
}
function updateHorseGait(h, dt){
  const G = h.gait;
  /* 被套在行驶中的马车上时，位置与腿相位由 travelCarriagePlace 统一写
     （口径 = 车的里程，不是马自己的状态机）—— 这里必须整个让开，否则两边每帧打架。 */
  if (h.driving) return;
  if (!G || !h.home || !h.groundY) return;
  G.timer -= dt;
  if (G.state === 'graze'){
    if (G.timer <= 0){
      G.state = 'move';
      G.target = G.target > 0.01 ? 0 : G.lane;
      /* 往前才可能小跑；退回去只能慢步（马不会倒着跑）。 */
      G.mode = (G.target > 0.01 && _sr() < 0.22) ? 'trot' : 'walk';
    }
  } else if (G.state === 'move'){
    const D = HORSE_GAIT[G.mode];
    const d = G.target - G.dist;
    /* 退回去按 0.55 倍速（马倒着走本来就慢），避免读成"快退"。 */
    const step = D.speed * (d < 0 ? 0.55 : 1) * dt;
    G.dist += (d > 0 ? 1 : -1) * Math.min(step, Math.abs(d));
    if (Math.abs(G.target - G.dist) < 0.003){
      G.state = 'graze';
      /* 院场窄、单程只有 0.75m ⇒ 别让它"走一步就站着吃十几秒"，
         缩短吃草停顿，让人更常看到它在走（2026-10-21 调）。 */
      G.timer = 3.5 + _sr() * 4.5;
    }
  }
  /* 权重：走动时步态 1、吃草时 0；吃草动作反向。两者都做斜坡，避免一帧切。 */
  const wantG = (G.state === 'move') ? 1 : 0;
  h.gaitW += (wantG - h.gaitW) * Math.min(1, dt * 3.2);
  const wantGraze = (G.state === 'move') ? 0 : 1;
  h.grazeW += (wantGraze - h.grazeW) * Math.min(1, dt * 2.6);
  /* 相位按"带符号的实际位移"推进 —— 站着不动时相位不空转；
     后退时 delta<0 ⇒ 相位倒着走，着地腿相对身体向前，读作"倒着迈步"而不是滑行。 */
  const delta = G.dist - (G.lastDist || 0);
  G.lastDist = G.dist;
  const D = HORSE_GAIT[G.mode];
  if (h.gaitW > 0.001){
    /* 步幅：Rodin 马按自己的肩高现算（h.strideWalk），否则用模式常量 —— 用错会滑步 */
    const stride = h.strideWalk || D.stride;
    G.phase = (G.phase + delta / stride) % 1;
    h.gaitLegs = gaitPose(G.mode, G.phase);
    h.gaitBob = Math.sin(G.phase * Math.PI * 4) * D.bob;
  } else {
    h.gaitLegs = null;
    h.gaitBob = 0;
  }
  /* 位移只沿"槽位朝向"前后，不转向 —— 院场窄，转身会扫到栅栏/马车。 */
  const fx = Math.sin(h.home.yaw), fz = Math.cos(h.home.yaw);
  const x = h.home.x + fx * G.dist;
  const z = h.home.z + fz * G.dist;
  h.group.position.set(x, h.groundY(x, z) + (h.gaitBob || 0), z);
  h.group.rotation.y = h.home.yaw;
}

/* 每帧：① 推每匹马的姿态角；② 冬天喷白雾。dt 用主循环的仿真步长（与固定步长累加器同一根时钟）。 */
export function tickStableLife(dt){
  if (!HORSE_LIFE.length) return;
  _stT += Math.min(Math.max(dt, 0), 0.1);
  const t = _stT;
  const winter = ENV && ENV.season === 'winter';
  let puff = 0;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), PP = new THREE.Vector3();
  for (const h of HORSE_LIFE){
    const ph = h.phase;
    /* 2026-10-21：步态（走/小跑/停下吃草）—— 只有配了 gait 的马会动，其余原样。 */
    if (h.grazeW == null) h.grazeW = (h.role === 'graze' || h.role === 'fed') ? 1 : 0;
    if (h.gaitW == null) h.gaitW = 0;
    if (h.gait) updateHorseGait(h, dt);
    /* ① 底噪：所有马都有的慢微动。
       ⚠️⚠️ 2026-10-11 **全面加大**（老黄："马蹄和马尾会不规则动，也看不到"）——
       先证伪了"伪蒙皮没生效"：outputs/_diag/horse-rig-pixel.mjs 冻结帧 A/B 实测
       rig 角度 0 → 0.6rad **确实改了 2393 像素**（自检 0、可逆）⇒ 注入是好的。
       真因是**幅度太小**：上一版底噪 0.014 / 0.022 / 0.11 rad（= 0.8° / 1.3° / 6.3°），
       而「马厩」机位在 15~25m 外 —— 按上面那次实测的比例，0.03 rad 连 20 像素都不到，
       等于没动。
       ⚠️⚠️ 2026-10-21 **回撤一部分幅度**（老黄："动作抽搐"）：原来为了让远处"看得见"
       把幅度开很大，但**马的动作是慢的**——一匹马甩尾/抖颈是"缓缓地"，
       大幅度 + 高频率 = 抽搐/惊跳。⇒ ①底噪幅度降回温和（尾 0.30→0.22rad）；
       ②脉冲事件**拉长 + 降幅**（甩尾 0.60rad/0.9s → 0.34rad/1.6s；抬蹄 0.52rad/1.6s
       → 0.30rad/2.2s）；③抖颈里的 `sin(u*20)`（≈11 rad/s，24fps 下 0.46rad/帧 = 26°/帧）
       降成 `sin(u*5)`（≈2.8 rad/s ⇒ 0.12rad/帧）—— 这条是"抽搐"的主犯。 */
    let headPitch = 0.030 * Math.sin(t * 0.90 + ph);
    let headYaw   = 0.050 * Math.sin(t * 0.37 + ph * 1.7);
    let tailYaw   = 0.22 * Math.sin(t * 0.95 + ph) + 0.05 * Math.sin(t * 2.30 + ph * 2.1);
    const leg = [0, 0, 0, 0];
    /* 甩尾 + 抬蹄：**所有角色共用** ——"休息的马匹也会不规则动"是明确要求，
       上一版只有吃草那两匹有甩尾、只有辕里那两匹有抬蹄 ⇒ 厩内和马厩旁边那两匹
       是完全静止的（正是老黄说"看不到"的那几匹）。 */
    h.flick -= dt;
    if (h.flick <= 0){ h.flick = 5.0 + _sr() * 9.0; h.flickT = 1.6; }
    if (h.flickT > 0){ const u = 1 - h.flickT / 1.6; tailYaw += 0.34 * Math.sin(Math.PI * Math.min(1, u)); h.flickT -= dt; }
    /* 2026-10-21：偶尔喷一下鼻翼（"噘嘴/打响鼻"里最轻的一档）。
       flare 由 applyTinkerPose 逐帧衰减，所以这里只负责"点一下"。 */
    if (h.flareNext == null) h.flareNext = 2.5 + _sr() * 4.0;
    h.flareNext -= dt;
    if (h.flareNext <= 0){
      h.flare = Math.min(0.16, (h.flare || 0) + 0.14);
      h.flareNext = 4.0 + _sr() * 7.0;
    }
    /* 走/跑的时候不叠加"原地点蹄"事件（步态已经给了四条腿），否则停下瞬间会跳一下。 */
    if (!(h.gaitW > 0.20)){
      h.hoofNext -= dt;
      if (h.hoofT > 0){
        const u = 1 - h.hoofT / 2.2;
        leg[h.hoofLeg] = 0.30 * Math.sin(Math.PI * Math.min(1, u));   // 前腿绕 X 转 ⇒ 蹄往前抬起
        h.hoofT -= dt;
      } else if (h.hoofNext <= 0){ h.hoofT = 2.2; h.hoofNext = 7 + _sr() * 11; h.hoofLeg = h.hoofLeg ? 0 : 1; }
    }
    if (h.role === 'graze' || h.role === 'fed'){
      /* ② 悠闲吃草：慢速点头（吃一口、抬一下）—— 幅度从 4.9°/3.3° 提到 12.6°/8.6°。
         走动时按 grazeW 渐隐（否则"低着头走路"）。 */
      const gw2 = h.grazeW == null ? 1 : h.grazeW;
      headPitch += (h.role === 'graze' ? 0.22 : 0.15) * Math.sin(t * 0.30 + ph) * gw2;
      headYaw   += 0.05 * Math.sin(t * 0.21 + ph * 1.3) * gw2;
      /* 走动时头随躯干轻微上下，读起来不是"头钉在空中"。 */
      headPitch += 0.030 * Math.sin((h.gait ? h.gait.phase : 0) * Math.PI * 4) * h.gaitW;
    } else if (h.role === 'harnessed'){
      /* ③ 辕里待发：平时安静；偶尔"仰天抖颈"。
         ⚠️ 2026-10-21：`sin(u*20)`（11 rad/s ⇒ 24fps 下 26°/帧）是"抽搐"主犯 ⇒ 降到 sin(u*5)；
            幅度也收一点（抬头 0.34→0.26rad、摇头 0.18→0.11rad）—— 马的抖颈是慢的。 */
      h.headNext -= dt;
      if (h.headT > 0){
        const u = 1 - h.headT / 1.8;                      // 0→1 一次事件
        const env = Math.sin(Math.PI * Math.min(1, u));   // 起落包络（连续）
        headPitch -= 0.26 * env;                          // 负 = 抬头
        headYaw   += 0.11 * h.headSide * env * Math.sin(u * 5);
        h.headT -= dt;
      } else if (h.headNext <= 0){ h.headT = 1.8; h.headNext = 9 + _sr() * 11; h.headSide = _sr() < 0.5 ? -1 : 1; }
    } else {
      /* ④ 厩内 2 匹：慢慢转头看看 + 低头嗅一下脚下的草 / 抬头 —— 上一版只有 ±3.4° 转头，
         出图判读"厩里两匹完全静止"。 */
      headYaw   += 0.12 * Math.sin(t * 0.13 + ph * 2.3);
      headPitch += 0.16 * Math.sin(t * 0.16 + ph * 1.7);
    }
    /* ⑤ 写姿态：Tinker 走骨骼；Rodin/程序化替身走旧伪蒙皮 uniform */
    if (h.anim){
      applyTinkerPose(h, headPitch, headYaw, tailYaw, leg, dt);
    } else {
      applyRodinPose(h, headPitch, headYaw, tailYaw, leg);
    }

    /* ⑥ 冬天：口鼻喷白雾。Tinker 用**鼻骨世界坐标**（真实跟随低头/抬头），
       替身仍用旧的枢轴公式；六匹 Tinker 都会喷。 */
    if (h.breath && winter && puff < 42){
      h.breathNext -= dt;
      if (h.breathNext <= 0){
        h.breathNext = 2.4 + _sr() * 2.6;
        const b = h.breath[h.breathCur = (h.breathCur + 1) % h.breath.length];
        b.life = 1.35;
        if (h.anim){
          const nose = h.anim.bones['noseL'] || h.anim.bones['DEF-noseL'] || h.anim.bones['ORG-head'];
          if (nose) nose.getWorldPosition(_tv);
          else _tv.set(0, 1.2, 0);
          b.x = _tv.x; b.y = _tv.y; b.z = _tv.z; b.world = true;
          h.flare = 0.42;                              // 喷气时鼻孔同步扩一下
        } else {
          const rig = h.mat.userData.rig;
          const a = rig.head.x, p = h.piv.neck;
          let dy = h.nose[1] - p[1], dz = h.nose[2] - p[2];
          const cs = Math.cos(a), sn = Math.sin(a);
          b.x = h.nose[0]; b.y = p[1] + dy * cs - dz * sn; b.z = p[2] + dy * sn + dz * cs;
          if (rig.head.y !== 0){ const c2 = Math.cos(rig.head.y), s2 = Math.sin(rig.head.y);
            const dx2 = b.x - h.nose[0]; b.x = h.nose[0] + dx2 * c2 + (b.z - h.nose[2]) * s2; }
          b.world = false;
        }
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
          /* ⚠️ 白雾尺寸 0.16→0.66m：实测在近景里是一团**糊住整张脸**的白饼（老黄会读成
             "马嘴里塞了棉花"）。真马呵气是一小团 ⇒ 收到 0.09→0.30m。 */
          const size = 0.09 + 0.21 * u;
          if (puff < im.instanceMatrix.count){
            PP.set(b.x, b.y, b.z);
            if (!b.world){ h.group.updateWorldMatrix(true, false); PP.applyMatrix4(h.group.matrixWorld); }
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
  // eslint-disable-next-line no-unused-vars -- 保留：换回 Tinker 模型时的资产回退路径
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
/* 2026-10-19：Rodin Horse.glb 已换成 Tinker（见上方 tinkerBuffer 的 settle 握手），
   下面这份 horseSrcOnce 仅作历史回退保留，不在模块求值期调用（否会 404 拉一次废资源）。 */

/* ══ Rodin 马（2026-10-23）════════════════════════════════════════════════════
   为什么换：Tinker 那匹是 BlenderKit 的低模，耳朵/鼻孔/嘴都是后来补的件；已生成
   资产库里有三匹 Rodin 件，自带耳/眼/鼻孔/蹄形 + 2048 的漫反射/法线/粗糙度贴图。
   ⚠️ 三匹**都没有骨骼**（validate_glb: skins=0）⇒ 走本项目现成的"着色器伪蒙皮"
      （installHorseRig）：六块区域权重烘进顶点属性，每帧只写几个角度，CPU 成本 0。
   ⚠️ 归一化不在运行时做：outputs/_diag/horse-cand/convert_horse.py 已经烘成
      **脚底 y=0、头朝 +z、总高 1.75、x/z 居中**，这里只做"防御性复核"。
   ⚠️ 伪蒙皮只认"整条腿绕肩/髋摆"，做不出屈膝；15~25m 的观感距离下读作走路没问题，
      这也是旧 Tripo 马用过、验收通过的那条路。 */
const HORSE_MODEL = 'rodin';        // 'rodin' = 三匹无骨骼 Rodin 件（伪蒙皮）；'tinker' = 骨骼版
const RODIN_GLB = {
  camargue:  'assets/horse-camargue.glb',
  mongolian: 'assets/horse-mongolian.glb',
  criollo:   'assets/horse-criollo-saddle.glb',
};
const _rodinSrc = new Map();
/* G6 接线：预载清单要求 src 里出现**字面 URL** 的 settleAsset 调用 ——
   写成 RODIN_GLB[key] 变量不算（probe/preload-manifest-sync 的正则只认字面量）。
   所以这里按 key 显式分派，别改成通用变量。漏了会每次进项目死等满 180s（2026-10-11 的前科）。 */
function settleRodin(key, ok, err){
  if (key === 'camargue') HOOKS.settleAsset?.('assets/horse-camargue.glb', ok, err);
  else if (key === 'mongolian') HOOKS.settleAsset?.('assets/horse-mongolian.glb', ok, err);
  else if (key === 'criollo') HOOKS.settleAsset?.('assets/horse-criollo-saddle.glb', ok, err);
}
function rodinSrcOnce(key){
  if (_rodinSrc.has(key)) return _rodinSrc.get(key);
  const url = RODIN_GLB[key];
  const p = new Promise((res, rej) => {
    new GLTFLoader().load(url,
      (gltf) => { settleRodin(key, true); res(gltf.scene); },
      (e) => { HOOKS.reportAssetProgress?.(url, e.loaded, e.total); },
      (err) => { settleRodin(key, false, err); rej(err); });
  });
  p.catch(() => {});                       // 失败别留 unhandled rejection
  _rodinSrc.set(key, p);
  return p;
}
/* 模块求值期就发请求：预载阶段（11-loop 的 warmBoot 第一步）会等清单里的资产 settle，
   等到开园之后才发的请求必然死等到 PRELOAD_TIMEOUT_MS（2026-10-11 的教训）。 */
const _RODIN_BOOT = Object.keys(RODIN_GLB).map(rodinSrcOnce);

/* ── 伪蒙皮的权重与枢轴：全部按**归一化后的实际几何**量，不手填 ──────────────
   手填的坑（旧 Tripo 马）：三匹马的腿位差 5~8cm，枢轴落在腿外就会"腿绕着空气转"。 */
function rodinRigData(geo){
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const H = bb.max.y - bb.min.y, Lmin = bb.min.z, Lmax = bb.max.z;
  const pos = geo.attributes.position, N = pos.count;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /* ① 蹄心：最低 12% 高度按 x/z 符号分四簇（与 outputs/_diag/horse-cand/landmarks.mjs 同口径） */
  const cl = { FL: [0, 0], FR: [0, 0], HL: [0, 0], HR: [0, 0] };
  const cnt = { FL: 0, FR: 0, HL: 0, HR: 0 };
  for (let i = 0; i < N; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > bb.min.y + H * 0.12) continue;
    const k = (z > 0 ? 'F' : 'H') + (x > 0 ? 'R' : 'L');
    cl[k][0] += x; cl[k][1] += z; cnt[k]++;
  }
  for (const k of Object.keys(cl)) if (cnt[k]){ cl[k][0] /= cnt[k]; cl[k][1] /= cnt[k]; }
  const frontZ = (cl.FL[1] + cl.FR[1]) / 2 || 0.26;
  const hindZ  = (cl.HL[1] + cl.HR[1]) / 2 || -0.62;
  /* ② 四块权重（head/tail/前腿/后腿），全部 smoothstep 抹平，避免关节处一道折痕 */
  const W = { head: new Float32Array(N), tail: new Float32Array(N),
              legF: new Float32Array(N), legH: new Float32Array(N) };
  let tailTop = -1e9, muzzleY = 0, muzzleN = 0;
  for (let i = 0; i < N; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    W.head[i] = sm(0.26, 0.50, z) * sm(0.88, 1.02, y);          // 颈+头：腿（y<0.95）天然排除
    W.tail[i] = sm(-0.74, -0.90, z) * sm(0.18, 0.10, Math.abs(x)); // 尾：只认最后 20cm 的中线
    const down = sm(0.95, 0.62, y), side = sm(0.05, 0.12, Math.abs(x));
    W.legF[i] = down * side * sm(0.02, 0.16, z);
    W.legH[i] = down * side * sm(-0.02, -0.16, z);
    if (W.tail[i] > 0.5) tailTop = Math.max(tailTop, y);
    if (z > Lmax - 0.06){ muzzleY += y; muzzleN++; }
  }
  const piv = {
    neck: [0, 1.26, 0.40],
    tail: [0, tailTop > -1e8 ? tailTop : 1.10, Lmin + 0.03],
    legF: [0, 1.20, frontZ],
    legH: [0, 1.22, hindZ],
    /* 下颌铰点：口鼻后方 0.26m、略高于口鼻中线（正角度 = 下巴向下张开） */
    jaw: [0, (muzzleN ? muzzleY / muzzleN : 1.2) + 0.08, Lmax - 0.26],
  };
  /* ③ 下颌权重（只取"口鼻前段 + 下半"）：Rodin 件没有下颌骨，咀嚼只能靠这一层 */
  const jawZ0 = Lmax - 0.30, jawZ1 = Lmax - 0.16;
  const jawY1 = (muzzleN ? muzzleY / muzzleN : 1.2) + 0.06;
  const jawY0 = jawY1 - 0.16;
  const Wj = new Float32Array(N);
  for (let i = 0; i < N; i++){
    const y = pos.getY(i), z = pos.getZ(i);
    Wj[i] = Math.min(W.head[i], sm(jawZ0, jawZ1, z) * sm(jawY1, jawY0, y));
  }
  W.jaw = Wj;
  return {
    W, piv,
    nose: [0, muzzleN ? muzzleY / muzzleN : 1.25, Lmax - 0.02],
    /* 不滑步：步幅 = 2×肩高×sin(摆角)，与 HORSE_GAIT 的 A 绑定（旧 Tripo 马同款口径） */
    strideWalk: 2 * piv.legF[1] * Math.sin(HORSE_GAIT.walk.A),
    H, L: Lmax - Lmin, frontZ, hindZ,
  };
}
const _rodinRigCache = new WeakMap();        // geometry -> rigData（同一模型的多匹共用几何）
function rodinRigOf(geo){
  let d = _rodinRigCache.get(geo);
  if (!d){ d = rodinRigData(geo); _rodinRigCache.set(geo, d); }
  return d;
}

let _horseLoadStarted = false;
/* 归一化+贴图已在 Blender 里烘好（见 RODIN_GLB 上方的说明），这里只做挂载。
   一个模型都取不到（离线/404）时**保留程序化占位件** —— 马厩不能空着。 */
function rodinSlotModel(slot, used){
  if (slot.role === 'harnessed') return used.camargue <= used.mongolian ? 'camargue' : 'mongolian';
  if (slot.role === 'graze') return 'camargue';
  if (slot.role === 'fed') return 'mongolian';
  return used.criollo === 0 ? 'criollo' : 'camargue';
}
function loadRodinHorses(slots){
  const keys = Object.keys(RODIN_GLB);
  Promise.all(keys.map(k => rodinSrcOnce(k).then(s => s).catch(() => null))).then((bases) => {
    const byKey = {};
    keys.forEach((k, i) => { byKey[k] = bases[i]; });
    const used = { camargue: 0, mongolian: 0, criollo: 0 };
    const born = [];
    for (let si = 0; si < slots.length; si++){
      const slot = slots[si];
      const key = rodinSlotModel(slot, used);
      used[key] = (used[key] || 0) + 1;
      const base = byKey[key];
      /* 这个模型没取到：留着占位件（不 push HORSE_LIFE，占位件本来就不会动） */
      if (!base) continue;
      const root = base.clone(true);
      root.name = 'rodinHorse_' + key;
      root.userData.horse = true;
      root.userData.noMerge = true;
      let mat = null, geo = null;
      root.traverse(o => {
        if (!o.isMesh) return;
        /* 伪蒙皮只注入了材质着色器、**没注入深度材质** ⇒ 投影会是"没低头的站姿"，
           所以不参与静态阴影图，改用贴地软影（与走路那匹同一口径）。 */
        o.castShadow = false;
        o.receiveShadow = true;
        o.userData.noMerge = true;
        o.frustumCulled = false;
        const m = o.material.clone();          // 每匹一份：rig 的角度挂在 material.userData 上
        m.userData = Object.assign({}, m.userData, { rodin: key });
        m.envMapIntensity = 0.35;
        o.material = m;
        if (!mat){ mat = m; geo = o.geometry; }
      });
      if (!mat || !geo) continue;
      const rig = rodinRigOf(geo);
      /* 伪蒙皮注入：shader 挂在**材质**上，所以每匹各注一次（顶点属性在几何上，
         同模型的第二匹会重写一份等值的 aRigA/aRigB —— 一次性开销，忽略） */
      installHorseRig(mat, geo, rig.W, rig.piv);
      /* 防御性复核：归一化哪天被改坏（脚底不在 0 / 总高差太多），先在控制台点出来 */
      const bb = new THREE.Box3().setFromObject(root);
      const hh = bb.max.y - bb.min.y;
      if (Math.abs(hh - HORSE_TOTAL_H) > 0.12 || Math.abs(bb.min.y) > 0.06)
        console.warn('[马·Rodin] 归一化异常', key, 'H=' + hh.toFixed(3), 'minY=' + bb.min.y.toFixed(3));
      /* 摘占位件：只从场景图摘 + dispose 几何/材质（与 Tinker 路径同口径，否则 6 匹白占显存） */
      const goneGeo = new Set(), goneMat = new Set();
      slot.holders.forEach(h => {
        slot.group.remove(h);
        h.traverse(o => {
          if (o.geometry && !goneGeo.has(o.geometry)){ goneGeo.add(o.geometry); o.geometry.dispose(); }
          const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const m of ms){ if (!goneMat.has(m)){ goneMat.add(m); m.dispose(); } }
        });
      });
      slot.group.add(root);
      slot.holders = [root];
      attachHorseBlob(slot);
      HORSE_LIFE.push({
        mat, piv: rig.piv, nose: rig.nose,
        group: slot.group, role: slot.role,
        home: slot.home, groundY: slot.groundY,
        gait: slot.gait ? { state: 'graze', timer: 2.5 + _sr() * 3.5,
          dist: 0, target: 0, lastDist: 0, phase: 0, mode: 'walk', lane: slot.gait.lane || 1.2 } : null,
        strideWalk: rig.strideWalk,            // 步幅按这匹的肩高现算 ⇒ 不滑步
        grazeW: (slot.role === 'graze' || slot.role === 'fed') ? 1 : 0,
        gaitW: 0, gaitLegs: null, gaitBob: 0,
        blob: slot.blob || null,
        phase: si * 1.7 + _sr() * 6.28,
        flick: 1.5 + _sr() * 5, flickT: 0,
        headNext: 3 + _sr() * 12, headT: 0, headSide: _sr() < 0.5 ? -1 : 1,
        hoofNext: 5 + _sr() * 10, hoofT: 0, hoofLeg: 0, flare: 0,
        /* 冬天白气：world=false ⇒ 用局部坐标算（见 tickStableLife 的 else 分支） */
        breath: Array.from({ length: 5 }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, world: false })),
        breathNext: 1.2 + _sr() * 2.6, breathCur: 0,
      });
      slot.life = HORSE_LIFE[HORSE_LIFE.length - 1];   // 让"行驶中的辕马"能按槽位找到它
      born.push(key + '@' + slot.role);
      if (!horseBreathMesh.parent) scene.add(horseBreathMesh);
    }
    if (born.length) console.info('[马·Rodin] 换上 ' + born.length + ' 匹：' + born.join(', '));
    else console.warn('[马·Rodin] 三份 GLB 都没取到，保留程序化占位马');
  });
}

export function loadStableHorses(stableGroup){
  const slots = stableGroup && stableGroup.userData && stableGroup.userData.horseSlots;
  if (!slots || !slots.length) return null;
  /* 防重入：延迟批里如果被别处再调一次，会再解析 6 份 ⇒ 同槽位两套马叠在一起。
     （2026-10-21 诊断脚本手动调过一次，补齐这道闸。） */
  if (_horseLoadStarted) return null;
  _horseLoadStarted = true;
  /* 2026-10-23：默认走 Rodin 三匹（自带耳/眼/鼻孔/蹄形 + PBR 贴图）。
     回退 Tinker（骨骼版，动作更细）只需把下面这行改成 false。 */
  if (HORSE_MODEL === 'rodin') return loadRodinHorses(slots);
  /* ══ Tinker 照片级马（2026-10-19）══════════════════════════════════════════
     与旧 Rodin 路径的差别：**每匹单独 parse 一份 glb.scene**。
     不能 `base.clone(true)` —— 克隆不会重绑 Skeleton，蒙皮网格会塌到原点/不显示
     （2026-10-19 实测：loadAssetOnce 的 clone 只出包围盒、画面里没马）。
     6 次 parse 共用同一个 ArrayBuffer 与同一个 Draco 解码器；浏览器只下载一次。 */
  tinkerBuffer().then((buf) => {
    const loader = tinkerLoader();
    (async () => {
      /* 6 匹**并行解析**再逐匹挂载：串行 parse 实测要 8~10s（454 骨骼 × 6），
         并行后 ~2~3s；挂载仍是顺序的（改场景图别并发）。 */
      const parsed = await Promise.all(slots.map(() => new Promise((res) => {
        try { loader.parse(buf.slice(0), '', (gltf) => res(gltf), (e) => { console.warn('[马·Tinker] 解析失败：', e); res(null); }); }
        catch (e) { console.warn('[马·Tinker] 解析异常：', e); res(null); }
      })));
      for (let si = 0; si < slots.length; si++){
        const slot = slots[si];
        const gltf = parsed[si];
        if (!gltf) continue;
        const root = gltf.scene;
        /* 归一：按包围盒高缩到 HORSE_TOTAL_H，水平居中，脚底 y=0。模型脸朝 +z。 */
        let bb = new THREE.Box3().setFromObject(root);
        const sz = bb.getSize(new THREE.Vector3());
        const sc = HORSE_TOTAL_H / Math.max(1e-6, sz.y);
        root.scale.setScalar(sc);
        root.updateMatrixWorld(true);
        bb = new THREE.Box3().setFromObject(root);
        root.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
        root.updateMatrixWorld(true);
        const baseMat = slot.color || MAT.horseChestnut;
        root.traverse(o => {
          if (!o.isMesh) return;
          /* 会走动的马**不投影**：阴影图是"只渲一次"的静态图（renderer.shadowMap.autoUpdate=false），
             身体一移，图里的旧影子会留在原地。改用贴地软阴影（attachHorseBlob）跟着走。
             原地不动的马继续投真实阴影。 */
          o.castShadow = slot.gait ? false : true;
          o.receiveShadow = true;
          o.userData.noMerge = true;
          /* ⚠️ 2026-10-19：**把牙齿网格藏掉** —— 这个模型出厂是"微张嘴"，
             上下齿是**独立网格**（Teeth_UP 挂头骨、Teeth_down 挂下颌），
             近看就是一排白牙 + 粉牙龈 ⇒ 读作"龇牙僵尸脸"（老黄的"僵尸马"）。
             合上嘴（jaw 静态 -0.46rad）+ 藏牙 ⇒ 嘴只剩贴图上的唇线。 */
          if (/teeth/i.test(o.name || '')) { o.visible = false; o.castShadow = false; }
          /* ⚠️ 蒙皮网格的包围球是"绑定姿态"算的，骨骼一动就会误剔除 ⇒ 关掉视锥剔除。
             只有 7 个网格 × 6 匹 = 42 个，代价可忽略。 */
          if (o.isSkinnedMesh) o.frustumCulled = false;
          o.material = tinkerMaterial(o.material, baseMat.color, o.name);
          /* 马身网格：烘**顶点色标记**（黑腿/暗口鼻）—— 代替那张 UV 图集里画好的部件颜色 */
          if (/Horse_LP/i.test(o.name || '')) { markCoatPoints(o); slimNeck(o); }
          /* ⚠️ 2026-10-21（老黄："恐怖片"）：模型给的眼是**整颗 5.6cm 的黑球**全露在脸外
             ⇒ 近看是虫眼/塑料珠。缩到 0.6（≈3.4cm，球心仍在皮下 ⇒ 只露角膜那一点），
             材质压成深褐带一点湿光（roughness 0.5）而不是死黑。 */
          if (/^Eye_/i.test(o.name || '')){
            o.scale.setScalar(0.6);
            o.material.roughness = 0.5;
          }
        });
        const bones = {};
        root.traverse(o => { if (o.isBone) bones[o.name] = o; });
        const rest = {};
        for (const n of TINKER_ANIM_BONES) if (bones[n]) rest[n] = bones[n].quaternion.clone();
        const missing = TINKER_ANIM_BONES.filter(n => !bones[n]);
        if (missing.length && !_tinkerWarned){ _tinkerWarned = true; console.warn('[马·Tinker] 缺骨骼：' + missing.join(',')); }
        /* 换装：摘掉程序化替身，挂上真马（与旧路径同一套 holder 语义）
           ⚠️ 2026-10-19：摘掉之后**必须把替身的几何/材质从显卡里退掉** ——
           `remove()` 只是从场景图断开，geometry/material 仍被 renderer 的资源表持有、
           直到 dispose 才释放。实测（outputs/_diag/_tmp-geos-growth.mjs，同一 boot 稳态）：
             · 场景内唯一几何 803，而 renderer.memory.geometries = 968 ⇒ **165 个是游离残留**；
             · 对照组（bd69f63 无真马，不换装）geometries = 707 且与场景内数量一致。
           6 匹替身各 ~28 个零件 ⇒ 正好对上 165。这 165 个一直占显存、也让
           smoke 的「几何数量健康」判据从 803 抬高到 968（上限 950 ⇒ 红）。
           注意只 dispose 替身：真马刚 parse 出来的几何还要用，别碰。 */
        const disposedGeo = new Set(), disposedMat = new Set();
        slot.holders.forEach(h => {
          slot.group.remove(h);
          h.traverse(o => {
            if (o.geometry && !disposedGeo.has(o.geometry)){ disposedGeo.add(o.geometry); o.geometry.dispose(); }
            const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            for (const m of ms){ if (!disposedMat.has(m)){ disposedMat.add(m); m.dispose(); } }
          });
        });
        root.userData.horse = true;
        slot.group.add(root);
        slot.holders = [root];
        if (slot.gait) attachHorseBlob(slot);
        HORSE_LIFE.push({
          anim: { bones, rest, root }, group: slot.group, role: slot.role,
          /* 2026-10-21 步态：home/groundY 用来算位移与落地高度；gait 为空 = 原地不动。 */
          home: slot.home, groundY: slot.groundY,
          gait: slot.gait ? { state: 'graze', timer: 2.5 + _sr() * 3.5,
            dist: 0, target: 0, lastDist: 0, phase: 0, mode: 'walk', lane: slot.gait.lane || 1.2 } : null,
          grazeW: (slot.role === 'graze' || slot.role === 'fed') ? 1 : 0,
          gaitW: 0, gaitLegs: null, gaitBob: 0,
          blob: slot.blob || null,
          phase: HORSE_LIFE.length * 1.7 + _sr() * 6.28,
          flick: 1.5 + _sr() * 5, flickT: 0,
          headNext: 3 + _sr() * 12, headT: 0, headSide: _sr() < 0.5 ? -1 : 1,
          hoofNext: 5 + _sr() * 10, hoofT: 0, hoofLeg: 0, flare: 0,
          /* 白气：六匹都给（老黄："冬天鼻孔和嘴巴会冒白色热气"），每匹 5 团 */
          breath: Array.from({ length: 5 }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, world: true })),
          breathNext: 1.2 + _sr() * 2.6, breathCur: 0,
        });
        slot.life = HORSE_LIFE[HORSE_LIFE.length - 1];   // 同 Rodin 路径：行驶时按槽位取
        if (!horseBreathMesh.parent) scene.add(horseBreathMesh);
        /* ── 长尾束（2026-10-20 · 老黄："马尾巴不是兔子尾巴或者狗尾巴"）──────────────
           实测（probe/_tmp-tinker-tailbones.py，Blender 5.2 导入 tinker-raw.glb）：
             导出件自带 Tail 网格只有 105 顶点、世界尺寸 0.073×0.115×**0.212m**，
             尾骨链 ORG-tail.001→.005 世界坐标 (0,1.201,1.090)→(0,1.390,0.907)，整链 **0.21m**。
             真马（本仓 HORSE_TOTAL_H=1.75m）尾长应到飞节（膝下）≈ **0.85m**。
           ⇒ 做法：把自带那块小尾骨网格**藏掉**，另挂一条程序化长尾束。
           ⚠️⚠️ 为什么用"挂骨节点"而不是给新几何做蒙皮：
             新几何要跟着甩尾动画动，最省事且不会出错的做法是**把它挂到既有的尾骨节点下**
             （作为子节点）——骨一摆，它跟着摆，零额外动画代码，也不会出现
             "蒙皮索引指错骨骼 ⇒ 尾巴瞬移到别处"那类事故。
             （本段第一版写成手工 skinIndex 绑定，索引对不上骨骼表 ⇒ 已弃用，别改回去。）
           形态要点（与程序化替身 horseTail 同源的三条）：
             ① 尾根**埋进臀内 4cm** 再往外长；② 主干**向下垂**（真马尾近垂直）；
             ③ 主干粗、散毛贴拢 ⇒ 读作"一束"，不是几根带子。
           ⚠️ 用私有流 _sr()（与替身尾巴同一套确定性做法），不碰全局 rnd ⇒ 布局指纹不漂。 */
        const tailMesh = root.getObjectByName('Tail');
        if (tailMesh) tailMesh.visible = false;      // 藏掉 0.21m 的"兔子尾巴"
        {
          /* ⚠️ 骨名必须用「洗名后」拼写：加载器把点删掉（ORG-tail.001 → ORG-tail001，
             vendor.js createUniqueName 一段可证），写带点的永远找不到——2026-10-20 踩过。
             挂点首选 tail001：尾网格主链、甩尾动作转的就是它（DEF 是体上副本、ORG 是控制链）。 */
          const tRoot = bones['tail001'] || bones['DEF-tail001'] || bones['ORG-tail001'];
          if (tRoot){
            /* 长尾束：在**尾根骨节点**的本地坐标系里建模（骨节点自身在导出件里已带缩放/位移），
               这样它天然跟着骨链走；骨链摆多少它就跟多少。 */
            const LEN = 1.00;                       // 垂到蹄毛（真马尾从尾骨到蹄毛 ≈ 0.9~1.0m）
            const tailG = new THREE.Group();
            tailG.name = 'horseTailLongG';
            tailG.userData.noMerge = true;
            /* ⚠️⚠️ 2026-10-20 二修·已修复（首版出图判读：散毛扇形张开且上翘，像扫帚/鸡爪）：
               骨节点的局部轴 ≠ 世界轴 —— tail001 的骨轴本就斜向后上，直接在骨本地坐标里
               画"向下"会画歪。修法：用骨节点**挂载时刻（静止姿态）的世界朝向**把组的
               坐标系反补正 ⇒ 组里画的"下"就是世界的下；之后骨节随甩尾摆动时组跟着摆，
               长尾依然跟甩尾联动（组是骨的子节点，继承其一切旋转）。 */
            const bq = new THREE.Quaternion();
            tRoot.getWorldQuaternion(bq);
            tailG.quaternion.copy(bq).invert();
            /* ⚠️⚠️ 2026-10-21（老黄："短狗尾"）：尾根要**往后挪**到臀后。
               真马尾巴从骶骨（臀后）垂下、在两条后腿**之外**；挂在尾骨节点原位时
               它垂在两腿之间 ⇒ 侧视几乎全被后腿挡住（实测：尾巴屏幕投影 103×308px，
               但可见部分只有一小条）⇒ 画面上就是"没有尾巴/短狗尾"。
               位移方向用"马的前方"在**骨局部系**里求（不写死 ±z —— 六匹马朝向各不相同）。 */
            {
              root.updateMatrixWorld(true);
              const fwdW = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld);
              const inv = new THREE.Matrix4().copy(tRoot.matrixWorld).invert();
              const fwdB = fwdW.clone().transformDirection(inv);
              tailG.position.copy(fwdB).multiplyScalar(-0.14);      // 往臀后 14cm（贴臀不断开，见下）
            }
            /* 尾要**向下且略向后**（补正后的组系≈世界系）：身体前方是 -z ⇒ 取 +z 为马体后方。
               ⚠️ 2026-10-21（老黄："短狗尾"）：真马尾是**长而宽的一束**（从尾骨垂到蹄毛、
               走路时左右分开），0.85m 的细束在画面里读作"狗尾巴"。
               ⇒ 长度 0.85→1.00m、束芯加粗（5.5cm→…见下）、散毛末端散开 1.35 倍、
                 整束略向后倾（0.14→0.20）⇒ 明确挂在后腿之外，不是贴在腿缝里。 */
            const DOWN = new THREE.Vector3(0, -1, 0.20).normalize();
            /* ⚠️ 2026-10-20 总控定稿（第 7 版）：**颜色按每匹马的毛色派生**，不再一律灰。
               真马：鬃尾与体毛同色系、比体毛深一档（青灰马配深灰尾、枣红马配深褐尾、
               黑马配近黑尾、白马配浅灰尾）⇒ tailCol = 体毛色 × 0.42。
               之前用固定浅灰 0x6B6259/0x5A5248：在浅灰马身上读作"灰毛团"，
               在黑马身上读作"灰绳"，两头都不对。 */
            const tailCol = baseMat.color.clone().multiplyScalar(0.42);
            const tailMat = new THREE.MeshStandardMaterial({
              color: tailCol, roughness: 0.75, metalness: 0.0, envMapIntensity: 0.30 });
            /* 变径管复用 06i 的 tubeRadiusRamp（自带端盖，别手搓建管 ——
               makeHorse 里的 tube() 是函数内局部量，这里用不到它）。 */
            const tailTube = (pts, r0, r1, seg, rad) => {
              const curve = new THREE.CatmullRomCurve3(pts);
              return tubeRadiusRamp(new THREE.TubeGeometry(curve, seg, 1, rad, false),
                curve, seg, rad, t => r0 + (r1 - r0) * t);
            };
            /* 尾束几何 v9 = **尾 dock + 错根毛帘**（2026-10-21 红框："拼接"、尾巴与屁股断开）。
               ⚠️ v8 毛帘的两个病根：① 尾根挪出 32cm ⇒ 尾巴**飘在屁股后面**、顶端收成
               一个点 ⇒ 读作"扫帚柄 + 刷毛"；② 70 根全从同一点发出 ⇒ 顶端一束"柄"。
               真马尾：骶骨尾 dock（短毛、小、贴着臀）+ 毛发**沿整条 dock 长出来**
               （上段密贴、下段散开），根部永远连在臀上。
               做法：① 尾根只后挪 **14cm**（刚出臀面不断开）；② 一段短 dock 管
               （r 3.0→2.2cm、长 24cm，上端埋进臀里）；③ 70 根细管**沿 dock 全长
               错开起根**（yStart −0.02~−0.20、根盘半径 2.4cm）⇒ 没有"柄"、没有断缝；
               ④ 整束仍合并 1 网格、挂一骨、整束一起摆。 */
            const tailGeos = [];
            const dockPts = [new THREE.Vector3(0, 0.035, -0.008),
              DOWN.clone().multiplyScalar(0.12), DOWN.clone().multiplyScalar(0.235)];
            tailGeos.push(tailTube(dockPts, 0.030, 0.022, 6, 7));
            const N_STRANDS = 70;
            for (let i = 0; i < N_STRANDS; i++){
              const a = (i / N_STRANDS) * Math.PI * 2 + _sr() * 0.15;   // 绕 dock 均布 + 微抖
              const splay = 0.35 + 0.65 * _sr();                        // 散开系数：上密下松
              const yStart = -0.02 - 0.18 * _sr();                      // 沿 dock 全长错开起根
              const len = LEN * (0.72 + 0.18 * _sr());                  // 长短错落
              const wave = (_sr() - 0.5) * 0.06;                        // 自然波浪
              const rad = 0.0020 + 0.0015 * _sr();                      // 半径 2.0~3.5mm（真毛粗细）
              const r00 = 0.024;                                        // 根盘半径：贴着 dock 表面
              const pts = [];
              const NSEG = 10;
              for (let k = 0; k <= NSEG; k++){
                const u = k / NSEG;                                     // 0 根 → 1 尖
                const y = yStart - len * u;
                const x = Math.cos(a) * (r00 * (1 - u * 0.5) + 0.15 * u * splay)
                  + wave * Math.sin(u * 3.1);
                const z = Math.sin(a) * (r00 * (1 - u * 0.5) + 0.15 * u * splay) * 0.55
                  + yStart * 0.20 + wave * Math.cos(u * 2.7) * 0.4;
                pts.push(new THREE.Vector3(x, y, z));
              }
              const curve = new THREE.CatmullRomCurve3(pts);
              const g = new THREE.TubeGeometry(curve, NSEG, rad, 6, false);
              tailGeos.push(g);
            }
            const tailMerged = mergeGeometries(tailGeos, false);
            if (tailMerged){
              const tailMeshNew = new THREE.Mesh(tailMerged, tailMat);
              tailMeshNew.name = 'horseTailLong';
              tailMeshNew.castShadow = true;
              tailMeshNew.receiveShadow = true;
              tailMeshNew.userData.noMerge = true;
              tailG.add(tailMeshNew);
            } else {
              /* 合并不成（属性不齐）就退回单件，绝不丢尾巴 */
              for (const geo of tailGeos){
                const m = new THREE.Mesh(geo, tailMat);
                m.castShadow = true; m.userData.noMerge = true;
                tailG.add(m);
              }
            }
            for (const o of tailG.children){ o.castShadow = true; o.receiveShadow = true; o.userData.noMerge = true; }
            tRoot.add(tailG);
          } else if (!_tinkerWarned){
            _tinkerWarned = true;
            console.warn('[马·Tinker] 找不到尾骨（tail001），未加长尾');
          }
        }
      }
      /* 阴影图快照过期：换马后必须重渲一次（否则地上还是替身的腿影） */
      markCasterBoxDirty();
      renderer.shadowMap.needsUpdate = true;
      console.log('[马·Tinker] ' + slots.length + ' 匹已装配（骨骼 ' + (HORSE_LIFE[0] ? Object.keys(HORSE_LIFE[0].anim.bones).length : 0) + ' 根/匹）');
    })();
  }).catch((e) => {
    console.warn('[马·Tinker] 资产失败，保留程序化替身：', e);
  });
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
  // eslint-disable-next-line no-unused-vars -- 保留：换回 Tinker 模型时的程序化毛流贴图
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
/* ══ 可行驶的马车（2026-10-23 · 客人到访的"马车版"）════════════════════════════
   院子里的 carA 原本是**静态陈设**：会被 mergeStatics 烘进 mergedStatic，而且
   `renderer.shadowMap.autoUpdate=false`，它的影子也是烘死的一次快照。
   要让它真的开起来，三件事缺一不可：
     ① **noMerge**（逐网格打标）—— 否则几何被烘进合并结果，车开走以后原地还留着一辆"ghost"；
     ② **castShadow=false + 贴地软影** —— 否则影子永远留在停车位、走到哪都没有脚影（同 15 的走路马）；
     ③ **合并静态件** —— 45 个网格挂 noMerge 就是 45 个 draw call；按材质并成 1~2 个，
        只把两只车轮留成独立组（要转）。
   ⚠️ 合并只在本地空间做（applyMatrix4 用"相对车组的矩阵"），所以之后整组平移/旋转照常有效。 */
function mergeLocalMeshes(container, inv, accept){
  const list = [];
  container.traverse(o => { if (o.isMesh && o !== container && accept(o)) list.push(o); });
  const buckets = new Map();
  for (const o of list){
    const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, items: [] });
    buckets.get(key).items.push(o);
  }
  for (const b of buckets.values()){
    if (b.items.length < 2) continue;
    const geos = [];
    for (const o of b.items){
      const g = o.geometry.clone();
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(m);
      if (!g.index){
        const n = g.attributes.position.count, idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      geos.push(g);
    }
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch (e){ merged = null; }
    if (!merged) continue;                       // 合并失败就保留原网格（宁可慢，不可消失）
    const mm = new THREE.Mesh(merged, b.mat);
    mm.castShadow = b.cast; mm.receiveShadow = b.recv;
    mm.name = 'carriagePart';
    container.add(mm);
    for (const o of b.items) if (o.parent) o.parent.remove(o);
  }
}
function prepareTravelCarriage(car){
  car.updateMatrixWorld(true);
  const wheels = car.userData.wheels || [];
  const inWheel = (o) => {
    let p = o;
    while (p && p !== car){ if (wheels.includes(p)) return true; p = p.parent; }
    return false;
  };
  for (const w of wheels){
    w.updateMatrixWorld(true);
    mergeLocalMeshes(w, new THREE.Matrix4().copy(w.matrixWorld).invert(), () => true);
  }
  car.updateMatrixWorld(true);
  mergeLocalMeshes(car, new THREE.Matrix4().copy(car.matrixWorld).invert(), (o) => !inWheel(o));
  car.traverse(o => {
    if (!o.isMesh) return;
    o.userData.noMerge = true;                   // 别被 mergeStatics 烘走（见上）
    o.castShadow = false;                        // 静态阴影图烘不出"移动的车"（见上）
    o.receiveShadow = true;
    o.frustumCulled = false;                     // 车很大、随时在动，包围球不可靠
  });
  car.userData.wheels = wheels;
  car.userData.travel = true;
}

/* 行驶中的马车 + 两匹辕马（都由 16-actors 的到访导演层驱动）。
   parked 是"停在院里待发"的**局部**坐标（与 makeStable 里 carA 的落点一致）。 */
const TRAVEL = {
  ready: false, group: null, car: null, wheels: [], slots: [], blob: null,
  cx: 0, cz: 0, stableYaw: 0, cy: 1, sy: 0,
  parked: { lx: -3.0, lz: -1.4, yaw: Math.PI },
  wheelR: 0.55,
};
export function stableTravel(){ return TRAVEL.ready ? TRAVEL : null; }

const _travV = new THREE.Vector3();
/* 把车 + 两匹辕马摆到世界 (x,z)、朝向 yaw；dist = 累计里程（驱动车轮与四腿相位）。
   返回车心落地的世界坐标，供人物"坐在车上"用（不再让调用方另算一遍）。 */
export function travelCarriagePlace(x, z, yaw, dist){
  const V = TRAVEL;
  if (!V.ready) return null;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const gL = groundHeight(x - rx * 0.62, z - rz * 0.62);
  const gR = groundHeight(x + rx * 0.62, z + rz * 0.62);
  const gF = groundHeight(x + fx * 0.80, z + fz * 0.80);
  const gB = groundHeight(x - fx * 0.80, z - fz * 0.80);
  const y = (gL + gR) / 2;
  const car = V.car;
  car.position.copy(V.group.worldToLocal(_travV.set(x, y, z)));
  car.rotation.order = 'YXZ';
  // 车头 +z 沿行进方向；pitch 让车随坡抬头/低头，roll 让两轮同时落地（与 seatCart 同一口径）
  car.rotation.set(-Math.atan2(gF - gB, 1.6), yaw - V.stableYaw, (gR - gL) / 1.24);
  for (const w of V.wheels) w.rotation.z = dist / V.wheelR;
  const stride0 = 0.663;
  for (const s of V.slots){
    const ox = s.travelOff ? s.travelOff.x : 0;
    const oz = s.travelOff ? s.travelOff.z : 1.45;
    const hx = x + ox * Math.cos(yaw) + oz * Math.sin(yaw);
    const hz = z - ox * Math.sin(yaw) + oz * Math.cos(yaw);
    const hy = groundHeight(hx, hz);
    s.group.position.copy(V.group.worldToLocal(_travV.set(hx, hy, hz)));
    s.group.rotation.y = yaw - V.stableYaw;
    const L = s.life;
    if (L){
      L.driving = true;
      L.gaitW = 1; L.grazeW = 0;
      const stride = L.strideWalk || stride0;
      const ph = ((dist / stride) + (s.travelPh || 0)) % 1;
      L.gaitLegs = gaitPose('walk', ph < 0 ? ph + 1 : ph);
      L.gaitBob = Math.sin(ph * Math.PI * 4) * 0.016;
    }
  }
  if (V.blob){
    V.blob.position.copy(V.group.worldToLocal(_travV.set(x, y + 0.10, z)));
    V.blob.rotation.y = yaw - V.stableYaw;
  }
  return { x, y, z, yaw, pitch: car.rotation.x, roll: car.rotation.z };
}

/* 回到院里的停车位（复位 / 场景不出现时）。辕马同时回到各自的 home。 */
export function travelCarriagePark(){
  const V = TRAVEL;
  if (!V.ready) return;
  const p = V.parked;
  const x = V.cx + p.lx * V.cy + p.lz * V.sy;
  const z = V.cz - p.lx * V.sy + p.lz * V.cy;
  travelCarriagePlace(x, z, V.stableYaw + p.yaw, 0);
  for (const s of V.slots){
    const L = s.life;
    if (L){ L.driving = false; L.gaitW = 0; L.gaitLegs = null; L.gaitBob = 0; }
    const h = s.home;
    if (h){
      s.group.position.set(h.x, h.y, h.z);
      s.group.rotation.y = h.yaw;
    }
  }
  if (V.blob){
    V.blob.position.set(p.lx, groundHeight(x, z) + 0.10, p.lz);
    V.blob.rotation.y = p.yaw;
  }
}

/* 显隐（车走了 / 还没来）。抬车时辕马一起藏 —— 否则场上只剩两匹"拉空气"的马。 */
export function travelCarriageVisible(v){
  const V = TRAVEL;
  if (!V.ready) return;
  V.car.visible = !!v;
  if (V.blob) V.blob.visible = !!v;
  for (const s of V.slots) s.group.visible = !!v;
}

/* 系马绳（马夫把两匹辕马的缰绳拴到院内横杆上）：两根细管，与马一起走，
   只在"已系好"时显示。位置在槽位组的局部系里（马头前下方 → 横杆方向）。 */
function makeLeadRope(slot){
  const g = new THREE.Group();
  g.name = 'leadRope';
  const mat = MAT.harness;
  for (const sgn of [-1, 1]){
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sgn * 0.10, 1.05, 0.74),
      new THREE.Vector3(sgn * 0.17, 0.96, 1.02),
      new THREE.Vector3(sgn * 0.24, 0.99, 1.28),
    ]);
    const t = mesh(new THREE.TubeGeometry(c, 8, 0.016, 5, false), mat, { name: 'leadRopeTube', cast: false });
    t.userData.noMerge = true;
    g.add(t);
  }
  g.userData.noMerge = true;
  g.visible = false;
  slot.group.add(g);
  slot.leadRope = g;
  return g;
}
export function travelCarriageTied(on){
  for (const s of TRAVEL.slots) if (s.leadRope) s.leadRope.visible = !!on;
}

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
  /* 车轮留句柄：2026-10-23「马车版到访」要真的把车开起来，两只轮子得随里程转。
     车体其余静态件在 prepareTravelCarriage 里按材质并成 1~2 个网格（否则 45 个网格
     全部 noMerge ⇒ 45 个 draw call，smoke 的 800 预算吃不消）。 */
  const wheelL = wheel(-1, 0), wheelR = wheel(1, 0);
  g.add(wheelL); g.add(wheelR);
  g.userData.wheels = [wheelL, wheelR];
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
    /* 2026-10-20 纠偏（老黄："马车套马的位置又不是枷锁，怎么都嵌到马的脑袋里面去了"）：
       彻底删除穿马头的 4 根垂直木柱（yokePost）。辕木沿马肩高平缓前伸，横轭（yoke）落在两马
       肩胛前胸鞍部（车局部 z=1.38、y=bedY+0.55≈1.27m，避开马头耳），并挂两具皮套项圈（yokeCollar）
       贴合马胸，还原真实驾车挽具，告别"马头套木枷上刑"。 */
    const pole = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, bedY + 0.02, 0.50),
      new THREE.Vector3(0, bedY + 0.30, 0.95),
      new THREE.Vector3(0, bedY + 0.55, 1.38),
    ]), 8, 0.045, 6, false), wood, { name: 'carriagePole', cast: true });
    g.add(pole);
    const yokeY = bedY + 0.55;
    const yoke = mesh(box(1.16, 0.08, 0.08), wood, { name: 'carriageYoke', cast: true });
    yoke.position.set(0, yokeY, 1.38); g.add(yoke);
    for (const sx of [-1, 1]){
      // 两具皮套挽圈：套在两马胸肩部，贴合自然
      const collar = mesh(new THREE.TorusGeometry(0.19, 0.028, 6, 16), MAT.harness, { name: 'yokeCollar', cast: true });
      collar.position.set(sx * 0.40, yokeY - 0.12, 1.38);
      collar.rotation.x = 0.36;
      collar.scale.set(1, 1.15, 1);
      g.add(collar);
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
       现在 56 根、外扩只给 2.4 倍（0.24m 直径）—— **密到重叠**才读得出"一把草"。 */
    const r = 0.008 + pr(0, 0.026) + (i % 4) * 0.005;
    const zTip = 0.085 + pr(0, 0.055);           // 茎长不齐，束口才毛糙（v4 收短：长茎=爪子）
    const zMid = zTip * 0.46;
    out.push({ a, r, rad: 0.011 + pr(0, 0.005), zTip, zMid,
               tilt: pr(-0.16, 0.16),                 // 逐根微偏，别像一把牙签
               y0: -0.062 - pr(0, 0.025) });          // 握点在上、根茬在下
  }
  return out;
})();
export function makeFeedBale(){
  const g = new THREE.Group();
  /* ⚠️ 56 根草茎**必须并成一个几何**：一根一个 mesh 就是 56 个 draw call，
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
      P(s.r * 1.55, s.zMid, 0.008 + s.tilt * 0.08),
      P(s.r * 1.50, s.zTip, 0.030 + s.tilt * 0.12),
    ]);
    const tg = new THREE.TubeGeometry(c, 6, s.rad, 5, false);
    {
      /* TubeGeometry uv.x 沿茎长（0 根 → 1 梢）：基部稻草色 → 梢头青草色 */
      const uvA = tg.attributes.uv, nn = tg.attributes.position.count;
      const carr = new Float32Array(nn * 3);
      const cA = new THREE.Color(0xC7B173), cB = new THREE.Color(0x8AA063), t2 = new THREE.Color();
      for (let vi = 0; vi < nn; vi++){
        const tt = uvA.getX(vi), k = Math.min(1, Math.max(0, (tt - 0.30) / 0.70));
        t2.copy(cA).lerp(cB, k * k);
        carr[vi * 3] = t2.r; carr[vi * 3 + 1] = t2.g; carr[vi * 3 + 2] = t2.b;
      }
      tg.setAttribute('color', new THREE.BufferAttribute(carr, 3));
    }
    strands.push(tg);
  }
  /* 手里这捆自带顶点色 ⇒ 不用 MAT.straw（一乘就 double tint 发暗） */
  const baleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95,
    metalness: 0.0, envMapIntensity: 0.30 });
  g.add(mesh(mergeGeometries(strands, false), baleMat, { name: 'feedStrands', cast: false }));
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
/* 石板路控制点（世界 xz，马厩门口 → 月洞门外）。**导出**给 16-actors 的"客人到访"：
   人物沿这条路走，改路时人物自动跟着改，不用另抄一份坐标。 */
export const STABLE_ROAD_PTS = [
  [40.0, 4.2], [39.2, 10.5], [37.4, 16.5], [34.4, 21.8], [30.0, 26.2],
  [22.0, 27.2], [10.0, 26.4], [3.0, 26.0], [0.5, 25.9], [0.0, 24.55],
];
export function makeStableRoad(){
  const g = new THREE.Group();
  /* ⚠️⚠️ 2026-10-20 v2（老黄 09:06："到院子这个端口的还是太乱，再修的好看一些"）：
     上一版末点 (0.35,23.25) 仍**没对准门心**（月洞门圆心 x=0）—— 路歪 35cm 进门，
     门前的铺装中心又接着往东漂（0.35→0.55），整组构图与门错位 ⇒ 读作"乱"。
     本轮：路尾收到 **(0,24.55)**（与平台南沿齐平、正对门心 —— 末段转正南-北向，不再斜插进平台，见下方 ④c v3），门前铺装同步改为**中轴 x=0 的对称平台**
     （见下方 ④c）。 */
  const CP = STABLE_ROAD_PTS;
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
    /* ⚠️ 2026-10-20：垫层 0x6E675D → 0x8B8578（灰浆色）。原色太深，
       石板缝一露出来就读作"一条没填平的黑沟把路劈成两半"（近景判读原话）。 */
    const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0x9B958A,
                                                 roughness: 0.98, metalness: 0.0 });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    g.add(mesh(geo, mat, { name: 'stableRoadBed', cast: false, receive: true }));
  }

  let roadPavingMat = null;   // ④c 月洞门前补铺复用同一材质（见下）
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
        pos.push(q.x, gy + 0.075, q.z);              // 顶（偶数索引）
        pos.push(q.x, gy + 0.008, q.z);              // 底（奇数索引）——几乎贴到草面，消除"浮着"的台阶
        /* 侧壁比顶面暗一档（0.78）：石板有厚度、有侧影 ⇒ 读作"石块"而不是"贴纸" */
        col.push(tone, tone * 0.985, tone * 0.955, tone * 0.78, tone * 0.77, tone * 0.75);
      }
      idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);   // 顶面
      for (let k = 0; k < 4; k++){
        const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
        idx.push(a, b, b + 1, a, b + 1, a + 1);       // 四个侧面
      }
    };
    /* ⚠️⚠️ 2026-10-20 重做铺法：两条 0.83m 宽的大板 → **三条错缝的小板**。
       旧版每块 0.83m×0.55m，远看就是"几张白纸板铺在草上"（老黄："石板铺得太敷衍"）。
       现在：① **三列**（每列 ~0.57m），列内石板长 0.30~0.46m；② 相邻行**错半块**（砖缝错缝）；
       ③ 缝宽收到 1.5~3.2cm（旧的 3~7cm 露出的深色垫层读作"黑沟"）；
       ④ 材质基色 0xFFFFFF → 0xC9C3B4（石材灰；顶点色 0.58~1.0 再乘上去）——
          纯白 + 顶面高光 = "泡沫板"，石材灰才是石头。
       ⑤ 石板厚度 0.056 → 0.075m、侧壁更暗（0.88 → 0.78）⇒ 有份量，不是"贴纸"。
       ⚠️ 纵缝：两条列边固定在 ±0.02/±0.59/±1.16 附近，只有**最外沿**吃抖动
          （外沿内收 = "乱石"的不规则边；内侧整齐才像"一条路"）。 */
    const LANES = 3;
    const laneEdge = (k) => -HW + 0.02 + (2 * HW - 0.04) * (k / LANES);   // k=0..LANES
    for (let k = 0; k < LANES; k++){
      const inner = laneEdge(k) + (k > 0 ? 0.018 : 0);
      const outer = laneEdge(k + 1) - (k < LANES - 1 ? 0.018 : 0);
      const outerIsEdge = (k === 0 || k === LANES - 1);
      let d = jit(0.02, 0.26) + k * 0.13;            // 各列相位不同 ⇒ 横向接缝不齐（别在路头留空档）
      while (d < L - 0.30){
        const len = jit(0.30, 0.46);
        const t0 = d / L, t1 = Math.min(1, (d + len) / L);
        const jitter = outerIsEdge ? jit(0.0, 0.055) : jit(-0.012, 0.012);
        const a = (k === LANES - 1) ? outer + jitter : outer;   // 只有最外列的外沿吃抖动
        const b = (k === 0) ? inner - jitter : inner;
        const sA = Math.min(a, b), sB = Math.max(a, b);
        if (sB - sA > 0.16) pushSlab(t0, t1, sA + 0.008, sB - 0.008, jit(0.62, 1.0));
        d += len + jit(0.015, 0.032);                // 缝宽 1.5~3.2cm
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    /* ⚠️ 2026-10-20：基色 0xFFFFFF → 0xC9C3B4（石材灰）。纯白 + 顶点色高光 = "泡沫板"。 */
    const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0xAFA99C,
      vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    roadPavingMat = mat;
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
          /* ⚠️ 2026-10-20（④c v2 门前平台落地后补）：路尾这段的卵石会正好落在平台
             石板上面 —— 出图读作"石板里嵌卵石"。落在平台矩形（|x|<2.0、z∈[23.10,24.55]，v3 平台南延后同步放大）
             内的卵石直接跳过；jit 已照常消耗 ⇒ 其余卵石的抖动序列不变、位置可复现。 */
          if (Math.abs(q.x) < 2.10 && q.z > 23.05 && q.z < 24.60) continue;
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

  /* ── ②b 院门口铺装（2026-10-20 重做）──────────────────────────────────────────
     现象（老黄："连接马厩和院子的那条石板路的两端……石板铺的太敷衍了"）：
     旧版这里是"一块块 1.8m×0.5m 的大板"扇形排开 —— 一块板比一张桌子还大，
     板与板之间留 3~7cm 的缝、底下是深色垫层 ⇒ 远看像**几张白纸板摊在草地上**。
     本轮改成**正��的"横排错缝"铺装**（苏州"乱石路"的常规做法）：
       · 沿 z 从门槛线 Z0=2.30 一路铺到路头 Z1=4.20，共 5 横排；
       · 每排按该处宽度（门口 3.6m → 路宽 1.72m）切成 1~3 块，板长 ~0.6m；
       · 相邻排**错半块**（砖缝错缝）⇒ 不会有贯通的直缝；
       · 缝宽 2cm，垫层是灰浆色 ⇒ 缝里露出的不再是"黑沟"；
       · 门口加一条**门槛石**（横贯门洞 3.5m），两侧加**路牙石**与卵石镶边接上。
     ⚠️ 顶面 +0.072（比主路石板 0.075 低 3mm）：与主路首尾重叠处由主路压住，不打架。 */
  {
    const Z0 = 2.30, Z1 = 4.45;        // 门槛内缘 → 压过路头（与主路首排重叠，不露垫层）
    const W0 = 1.80, W1 = HW;          // 门洞半开口 → 路半宽
    const apronW = (z) => {
      if (z <= 2.95) return W0;
      const u = Math.min(1, (z - 2.95) / (Z1 - 2.95));
      return W0 + (W1 - W0) * (u * u * (3 - 2 * u));   // smoothstep：口部收得柔，不像被切了角
    };
    /* 垫层（与 ① 同色同厚）：跟着宽度变化的一条窄带 */
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
      const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0x9B958A,
                                                   roughness: 0.98, metalness: 0.0 });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGateBed', cast: false, receive: true }));
    }
    /* 石板：横排 + 错半块。角序按"side × tan = +y"（side = −x ⇒ 角从大 x 排到小 x） */
    {
      const pos = [], col = [], idx = [];
      const pushQuad = (x0, x1, z0, z1, tone) => {   // x1 > x0
        const base = pos.length / 3;
        for (const [x, z] of [[x1, z0], [x0, z0], [x0, z1], [x1, z1]]){
          const gy = groundHeight(x, z);
          pos.push(x, gy + 0.072, z);
          pos.push(x, gy + 0.008, z);
          col.push(tone, tone * 0.985, tone * 0.955, tone * 0.78, tone * 0.77, tone * 0.75);
        }
        idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);
        for (let k = 0; k < 4; k++){
          const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
          idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
      };
      const ROWS = 5, ZGAP = 0.022;
      for (let r = 0; r < ROWS; r++){
        const z0 = Z0 + (Z1 - Z0) * (r / ROWS);
        const z1 = Z0 + (Z1 - Z0) * ((r + 1) / ROWS) - ZGAP;
        const w = Math.min(apronW(z0), apronW(z1)) - 0.015;
        const n = Math.max(1, Math.round(w / 0.62));
        const cw = w / n;
        const off = (r % 2) * cw * 0.5;              // 错半块
        for (let k = -1; k <= n; k++){
          const a = -w + k * cw + off, b = a + cw;
          if (b <= -w || a >= w) continue;
          const sA = Math.max(a, -w), sB = Math.min(b, w);
          if (sB - sA < 0.16) continue;
          pushQuad(40.0 + sA + 0.010, 40.0 + sB - 0.010, z0, z1, jit(0.62, 1.0));
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0xAFA99C,
        vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGateSlab', cast: true, receive: true }));
    }
    /* 门槛石：横贯门洞的一条长石 —— 把"门线"说清楚，也是下马处该有的东西 */
    {
      const sill = mesh(box(3.44, 0.17, 0.46), MAT.stoneDark, { name: 'stableGateSill', cast: true, receive: true });
      sill.position.set(40.0, groundHeight(40.0, 2.44) + 0.075, 2.44);
      g.add(sill);
    }
    /* 路牙石：两侧各三块，与卵石镶边接上（"这条路是砌出来的"，不是"草地上贴了块板"） */
    {
      for (const s of [1, -1]){
        for (let i = 0; i < 3; i++){
          const z = 3.05 + i * 0.46;
          const w = apronW(z);
          const k = mesh(box(0.20, 0.20, 0.42), MAT.stoneDark, { name: 'stableGateKerb', cast: true, receive: true });
          k.position.set(40.0 + s * (w + 0.10), groundHeight(40.0 + s * (w + 0.10), z) + 0.05, z);
          k.rotation.y = jit(-0.03, 0.03);
          g.add(k);
        }
      }
    }
    /* 卵石镶边：只沿**收口段**两侧（门洞区两侧是栅栏立柱，铺到那儿反而怪） */
    {
      const proto = new THREE.SphereGeometry(1, 6, 4);
      const parts = [];
      const step = 0.19;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), PP = new THREE.Vector3();
      for (let z = Z0 + 0.5; z < Z1; z += step){
        const w = apronW(z);
        for (const s of [1, -1]){
          for (const row of [0.095, 0.225]){
            const qx = 40.0 + s * (w + row + jit(-0.02, 0.02)), qz = z + jit(-0.055, 0.055);
            const rr2 = jit(0.044, 0.092), tone = jit(0.46, 1.05);
            const gg = proto.clone();
            const cAttr = new Float32Array(gg.attributes.position.count * 3);
            for (let i = 0; i < cAttr.length; i += 3){
              const j2 = jit(-0.06, 0.06);
              cAttr[i] = tone + j2; cAttr[i + 1] = (tone + j2) * 0.99; cAttr[i + 2] = (tone + j2) * 0.95;
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
     ⚠️ 8 盏按**材质合并成 2 个网格**（石身 + 火袋，座石并进石身那个桶），不是 10 棵节点树。
     火袋 emissive 模型自带；真光源见下面 ④b（2026-10-18 起每盏一盏 PointLight；2026-10-19 南门口一对撤掉，10→8）。 */
  {
    /* ⚠️ 2026-10-19：N=5 → 4（老黄："如果摆放位置有石头灯挡住了，就把这一组石头灯去掉"）。
       去掉的是**最后、最靠南门口那一对**（原 (3.6,23.7)/(2.6,26.7)）——
       石狮改摆到南门口之后，那一对正好挤在东侧幼狮与门槛之间的落位上。
       其余 4 对（8 盏）保持原间距与朝向，巡回第 2 对锚点不受影响。 */
    const N = 4, LR = curve.getLength();
    const OFF = 1.55;
    const spots = [];
    for (let i = 0; i < N; i++){
      /* ⚠️ 2026-10-19：末站从 LR−3 收到 **LR−9**。只把 N 从 5 改 4 是不够的 ——
         等分公式会把 4 对重新铺满整条路，最后一对仍然落在南门口（约 z=25.5），
         正好继续挡着石狮。收到 LR−9 ⇒ 最后一对停在 z≈25 以北 6m，门口留空。 */
      const d = 6.0 + (LR - 15.0) * (i / (N - 1));
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
    /* 8 盏真光源与上面的模型一一同位（2026-10-18 · 老黄："石头灯要加灯光（带随机摇曳效果）"）。
       每盏一个 PointLight，暖橙 0xFFB45A（与火袋 emissive 同色），灯位 = 火袋中心（地面 +0.68m）。
       · castShadow 全 false：点光阴影是 6 面立方体贴图，8 盏全开等于每帧多渲 48 张深度图。
       · distance=7 + decay=2：光只落在灯下路面一圈，不把整片草坡染成橘色。
       · 灯数启动时定死、运行期只改 intensity（与廊灯同一条铁律，不触发材质重编译）。
       · 时段开关：推进 worldLights（12-env :303 按 lamp 通道发强度，白天全灭、夜里全亮）。
       · 摇曳：userData.flick 由 11-loop 逐帧写（烛火式 ±10%，每盏相位用布点序号派生、确定性）。

       ⚠️ 性能档（low）**一盏都不建**（2026-10-18 · 补 P1「10 盏常驻真光源没有低画质验收」）。
       实测（outputs/_diag/lowfps.mjs，1600×900 · ?tier=low · 夜间 · 同一帧位；当时是 10 盏，现在 8 盏）:
           正午（10 盏 intensity=0，但仍参与着色） 13.3 fps
           夜间 开 10 盏                            14.7 fps
           夜间 关 10 盏（visible=false）           22.7 fps
       即"10 盏 PointLight 常驻（现 8 盏）"在性能档吃掉约 **8~11 fps（约 35~50%）** —— 白天强度为 0
       也照付 shader 前向光照循环的钱。所以性能档直接不建这 8 盏，只保留模型自带的
       火袋 emissive（灯仍然"亮着"，只是不往地面投光）。
       灯数仍在启动时定死（只有初次画质档决定），运行期不增删 ⇒ 不会触发材质重编译。
       注：QOS 运行期把 mid/high 降到 low 时，已经建好的灯不会消失（改灯数会当场重编译，
       换来一次卡顿）；这是有意的取舍，见 11-loop QOS 段的口径。 */
    const LAMP_LIGHT_BUDGET = ACTIVE_QUALITY.key === 'low' ? 0 : spots.length;
    for (let i = 0; i < LAMP_LIGHT_BUDGET; i++){
      const st = spots[i];
      const L = new THREE.PointLight(0xFFB45A, 0, 7, 2.0);
      L.position.set(st.x, groundHeight(st.x, st.z) + 0.68, st.z);
      L.castShadow = false;
      L.name = 'roadLamp';
      L.userData.base = 1.6;
      L.userData.road = true;
      L.userData.flick = 1;
      L.userData.flickPh = [i * 2.39, i * 1.73 + 1.1, i * 0.91 + 2.2];
      g.add(L);
      worldLights.push(L);
    }
    console.log('[路旁石灯笼] 真光源 ' + LAMP_LIGHT_BUDGET + ' 盏' +
      (LAMP_LIGHT_BUDGET ? '（PointLight，无阴影，lamp 通道 + 摇曳）'
                         : '（性能档：只留火袋 emissive，省 8 盏前向光照）'));
  }
  /* ── ④c 月洞门前铺装（2026-10-20 重做 v2）───────────────────────────────────────
     v1（同日早）仍歪：路尾 x=0.35 本身没对准门心（月洞门圆心 x=0），铺装中心又接着
     往东漂（0.35→0.55）⇒ 整组构图与门错位 35~55cm，加上错缝抖动 ⇒ 读作"乱"（老黄 09:06）。
     v2 三改：
       ① 路尾收到 (0,24.55)（上方 CP 表）—— 正对门心、与平台南沿齐平、末段转正不再斜插（v3）；
       ② 门前不再"顺着歪路收口"，改成**与门槛石同宽（4.0m）的矩形平台**，
          中轴 x=0 与月洞门圆心、门槛石严格同轴 ⇒ 从南来先见一方规整平台，再入洞门；
       ③ 石板**对缝不错缝**：每行 7 块等宽（奇数 ⇒ 正中一块压门心轴），行间接缝
          上下对齐 —— 最规整的铺法；两侧各压一条**通长条石**收边（替代 v1 的 4 块小路牙）。
      ⚠️⚠️ v3（2026-10-21 老黄红框："改成水平方向平铺的砖"）：v2 平台只有左半是
      矩形板、右半被斜插进来的路板切成菱形 ⇒ 框里一半方一半菱读作"乱"。
      本轮：① 路尾退到平台南沿外（上方 CP），斜板不再进框；② 平台改**顺砖丁顺砌**：
      长边沿 x（水平方向）平铺、丁顺错缝、砖 0.39×0.195、缝 1.2cm（4m 正好 10 块整铺）；
      ③ 平台南延 25cm（Z1 24.30→24.55）吞掉路-台接缝；④ 垫一块深色勾缝底
      （缝里露出的是勾缝灰不是草）。东西条石收边保留。 */
  {
    const Z0 = 23.10, Z1 = 24.55, W = 2.0;  // v3 南延 25cm 吞路-台接缝；W=半宽=门槛石半宽
    /* 勾缝底 v2：深色垫（缝里露灰不露草）。⚠️ v1 是整块平板（+0.055），地形西高东低 ⇒
       西侧直接盖住砖面。改成**逐顶点跟地形**的网格：内顶 gy+0.050（砖顶 gy+0.072 ⇒
       缝深 2.2cm），边缘一圈沉到 gy+0.008（不露黑边）。绕向保证法线朝上。 */
    {
      const NX = 8, NZ = 4, bp = [], bidx = [];
      for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++){
        const bx = -W - 0.01 + (W * 2 + 0.02) * (i / NX);
        const bz = Z0 - 0.01 + (Z1 - Z0 + 0.02) * (j / NZ);
        const edge = (i === 0 || j === 0 || i === NX || j === NZ);
        bp.push(bx, groundHeight(bx, bz) + (edge ? 0.008 : 0.050), bz);
      }
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++){
        const a = j * (NX + 1) + i;
        bidx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 2, a + NX + 1);
      }
      const bgeo = new THREE.BufferGeometry();
      bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      bgeo.setIndex(bidx); bgeo.computeVertexNormals();
      const bed = mesh(bgeo, new THREE.MeshStandardMaterial({ color: 0x6E675D,
        roughness: 0.98, metalness: 0.0, side: THREE.DoubleSide }), { name: 'gateLandingBed', cast: false, receive: true });
      registerWeatherRoles(bed.material, { snow: 1, wet: 1 });
      g.add(bed);
    }
    const pos = [], col = [], idx = [];
    const pushQuad = (x0, x1, z0, z1, tone) => {
      const base = pos.length / 3;
      for (const [x, z] of [[x1, z0], [x0, z0], [x0, z1], [x1, z1]]){
        const gy2 = groundHeight(x, z);
        pos.push(x, gy2 + 0.072, z);
        pos.push(x, gy2 + 0.008, z);
        col.push(tone, tone * 0.985, tone * 0.955, tone * 0.78, tone * 0.77, tone * 0.75);
      }
      idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);
      for (let k = 0; k < 4; k++){
        const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    };
    /* 顺砖丁顺砌：砖长边沿 x（水平方向）平铺；奇数行错半砖；两端切砖补齐（≥14cm 才留）。 */
    const BL = 0.39, BGAP = 0.012;               // 砖长(沿x) × 缝宽（4.0m = 10×0.39 + 9×0.012，正好整铺）；砖深 = 行高 - 缝
    const ROWS = 7;                              // 1.45m 深 ≈ 7 行
    for (let r = 0; r < ROWS; r++){
      const z0 = Z0 + (Z1 - Z0) * (r / ROWS);
      const z1 = Z0 + (Z1 - Z0) * ((r + 1) / ROWS) - BGAP;
      const off = (r % 2) ? -(BL + BGAP) / 2 : 0; // 丁顺错缝（半砖错，两端对称切砖）
      for (let x = -W + off; x < W - 0.05; x += BL + BGAP){
        const a = Math.max(x + 0.006, -W + 0.006);
        const b = Math.min(x + BL - 0.006, W - 0.006);
        if (b - a >= 0.10) pushQuad(a, b, z0, z1, jit(0.62, 1.0));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(mesh(geo, roadPavingMat, { name: 'gateLanding', cast: true, receive: true }));
    /* 平台东西两沿各压一条**通长条石**（与门槛石同料收边）：
       中心在 ±(W+0.09)=±2.09、长 = 平台全长（Z1−Z0）；狮子（x=±2.55）在条石外 0.37m，互不相犯。 */
    for (const s of [1, -1]){
      const kx = s * (W + 0.09), kz = (Z0 + Z1) / 2;
      const k = mesh(box(0.18, 0.16, Z1 - Z0), MAT.stoneDark, { name: 'gateKerb', cast: true, receive: true });
      k.position.set(kx, groundHeight(kx, kz) + 0.048, kz);
      g.add(k);
    }
  }

  /* ── ⑤ 园墙南月洞门口石狮一对（2026-10-18 建 · 2026-10-19 改址 · 2026-10-20 挪近贴墙）──
     【当前桩位】x=±2.55、z=23.25（背贴墙，见下方 2026-10-20 注）；下文旧段落里的 z=23.9 是历史桩位。
     规矩（维基"石狮子"条）："从大门里出来时雄在左、雌在右"；雄右前爪踩绣球、雌左前爪抚幼狮。
     **2026-10-19 老黄："这对石狮子放到院子的门口啊"** —— 从马厩院门移到**园墙南月洞门**：
     洞门圆心 (0,22.5)、洞口半径 1.62、墙外皮 z=22.8；狮子站门外两侧 x=±2.55、z=23.9，
     面朝 +z（来客方向）。内缘到洞口净距 0.65m，整体在墙外（min.z≈23.48）。

     模型（2026-10-18 换真实照片扫描，见 13-preload 与 research/diy-lions/photoscan）：
     · 公 711648B / 母 643576B，主体高 1.076m，loadAssetOnce 归一化到 1.08m；
     · 朝向：Blender 里脸朝 −Y，glTF yup 导出后脸朝 **+z** ⇒ holder.rotation.y = 0
       （⚠️ 与旧 v7 手工模型相反 —— 旧资产脸朝 −z、rotation.y=π；换资产时必须一起改，
       否则两只狮子背对游客。实拍核对见 probe/lion-guard 的出图）。
     · 净空：包围盒半宽 0.30m（实测 0.557/2），狮身内缘到门洞边（±1.8m）留 0.15m；
       旧桩位 ±2.3 只剩 0.05m，视觉上像贴着门柱（2026-10-18 评审 P2）。
     · 母狮是同一扫描体的 X 镜像 + 胸前伏一只 0.20m 的幼狮（同一网格，见 build_lions.py）。
     · 拉不到时 required:false ⇒ 门口空着；probe/lion-guard 会报红（不许静默消失）。 */
  {
    /* 2026-10-19 改址：从马厩院门 → **园墙南月洞门**（老黄："这对石狮子放到院子的门口"）。
       洞门圆心 (0, 22.5)、洞口半径 1.62；狮子站门外两侧 x=±2.55、z=23.9，
       面朝 +z（来客方向）。内缘到洞口边净距 2.55−0.28−1.62 = **0.65m**；
       与原马厩门桩位无关（那处已空出，改放拴马桩/上马石，见 makeStable ④）。 */
    /* ⚠️⚠️ 2026-10-20 挪位（老黄 09:06："石狮子离开围墙太远了，贴近围墙才对"）：
       z=23.9 → **23.25**。狮身半深 ~0.42m ⇒ 后沿 min.z≈22.83，距墙外皮（22.8）仅 3cm，
       读作"背贴墙站"；前脸（z≈23.67）正压在门前平台（④c v2）前缘 ⇒ 迎客姿势。 */
    const spots = [
      { url: 'assets/stone-lion-male.glb', x: 2.55, z: 23.25, name: 'stoneLionMale' },
      { url: 'assets/stone-lion-female.glb', x: -2.55, z: 23.25, name: 'stoneLionFemale' },
    ];
    for (const st of spots){
      loadAssetOnce(st.url, 1.08, (src)=>{
        const h = new THREE.Group();
        h.name = st.name;
        h.position.set(st.x, groundHeight(st.x, st.z) - 0.01, st.z);
        h.rotation.y = 0;                       // 扫描狮脸朝 +z（南）迎客，见上方注释
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
                   role: opts2.role || 'stall', mark: opts2.mark || null, decoSeed: opts2.decoSeed || 0,
                   /* 2026-10-21 步态：只给"会走动"的马配 lane；其余马保持原地。
                      home/groundY 是步态位移的唯一真值（组是 makeStable 的子节点 ⇒ 局部坐标）。 */
                   /* ⚠️ 用 gy 不用 yardY：yardY 在厩内马槽位（本函数之上）调用时还没声明 ⇒ TDZ。
                      gy 在 makeStable 开头就定义好了（同一个逐点地形高度）。 */
                   groundY: gy,
                   home: { x: lx, y, z: lz, yaw },
                   gait: opts2.gait || null };
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
     ⚠️ 2026-10-19 撤掉：6 匹全数从场景中隐去。
        · 程序化 6 匹（makeHorse 的箱子拼装）出图读作"木雕涂漆"；
        · 场院那 4 匹（Tripo 扫描 Horse.glb）只有法线贴图、缺 baseColor 贴图，
          全部是同一种"灰色被光烤成棕"的样子，没有活感。
        老黄："没有活灵活现的感觉的话还不如不做"——这里整个 horse 子系统留下
        留着以备以后换好资产再用，本轮先把 `slot.group.visible = false` 撤下视觉。
        真模型那一份改在 loadStableHorses 调用前后不挂 holder 来彻底停掉 GPU/drawcall 占用。 */
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
  /* 2026-10-23：这驾车要能被到访导演层"开出去"（见文件上方的 prepareTravelCarriage）。
     ⚠️ 必须在 `deferRoot.add(st)` / mergeStatics 之前做 —— 晚了车体已经被烘进 mergedStatic。 */
  prepareTravelCarriage(carA);
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
  /* 2026-10-21：这匹灰马改成"会自己走几步" —— 朝院心（-x）走 1.25m 再退回来，
     停下的时段低头吃草、偶尔小跑。lane 是沿槽位朝向的前后行程，避免转身扫栅栏。 */
  addHorseSlot(4.6, -3.9, yardY(4.6, -3.9), -Math.PI / 2, MAT.horseGrey,
    { graze: 0.95, role: 'graze', decoSeed: 5, mark: { dapple: 1.0, blaze: 0.7 },
      gait: { lane: 0.75 } });
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

  /* ③e 拴马桩 + 上马石（2026-10-19 · 老黄："马厩门口放拴马石和（上）下马石，
     造型和位置你来定，但是要放的合理和复合古代建筑基本布局"）
     ── 布局依据（北方/江南院门前的常见做法）──
     · **上马石**贴门洞两侧、紧挨栅栏外沿：一块两级踏步的整石，低步朝外（来客来向）、
       高步朝门；骑马人先踏低步、再上高步、借高步翻身上马。所以它必须**离门最近**。
     · **拴马桩**在上马石外侧、沿栅栏一字排开：石桩比人高半头，桩头有孔/环，
       缰绳系在环上；桩距按"一匹马横占 0.8~1.0m"留 1.1m 净距，不拴成糖葫芦。
     · 两件都落在**栅栏以外**（门洞 ±1.8 之外），不挡 3.6m 车门与马车进出。
     ── 局部坐标 ──
     · 上马石：lx = ±2.45（门洞边外 0.65m）、lz = −5.05（栅栏线 −4.7 外 0.35m）；
       低步 0.95×0.24×0.62、高步 0.62×0.30×0.44，顶面 0.54m（真实上马石 0.5~0.6m）。
     · 拴马桩：lx = ±3.55、lz = −5.15；方桩 0.16×1.30，底座 0.44×0.16、桩帽 + 球顶，
       总高约 1.62m；铁环（MAT.harness）朝门洞一侧，挂高 1.08m（缰绳高度）。
     · 全部逐点取 `gy()` 落地 —— 草坡有起伏，不采地形会有一角悬空。 */
  /* ③f 院内拴马横杆（2026-10-23 · 马车版到访的"马夫系马"需要一个真实可系的物件）：
     车停在院门外时，两匹辕马的头朝院门里、正好够到这道横杆（0.6~0.7m）。
     位置：世界 z≈0.9（院内、厩身前面那片空地），跨 x 38.6~41.4。 */
  {
    const railZ = -2.9, railY = gy(0, railZ) + 1.04;
    for (const lx of [-1.36, 1.36]){
      const post = mesh(box(0.12, 1.10, 0.12), MAT.woodDark, { name: 'hitchRailPost', cast: true });
      post.position.set(lx, gy(lx, railZ) + 0.55, railZ); g.add(post);
    }
    const bar = mesh(box(2.90, 0.10, 0.10), MAT.wood, { name: 'hitchRailBar', cast: true });
    bar.position.set(0, railY, railZ); g.add(bar);
    for (const lx of [-0.62, 0.62]){
      const ring = mesh(new THREE.TorusGeometry(0.070, 0.016, 4, 10), MAT.harness, { name: 'hitchRailRing' });
      ring.position.set(lx, railY - 0.07, railZ + 0.05);
      ring.rotation.y = Math.PI / 2; g.add(ring);
    }
  }

  {
    const mkHitch = (lx, lz) => {
      const y0 = gy(lx, lz);
      const base = mesh(box(0.44, 0.16, 0.44), MAT.stoneDark, { name: 'hitchBase', cast: true, receive: true });
      base.position.set(lx, y0 + 0.08, lz); g.add(base);
      const shaft = mesh(box(0.16, 1.30, 0.16), MAT.stoneDark, { name: 'hitchShaft', cast: true, receive: true });
      shaft.position.set(lx, y0 + 0.81, lz); g.add(shaft);
      const cap = mesh(box(0.28, 0.10, 0.28), MAT.stoneDark, { name: 'hitchCap', cast: true });
      cap.position.set(lx, y0 + 1.51, lz); g.add(cap);
      const knob = mesh(new THREE.SphereGeometry(0.11, 8, 6), MAT.stoneDark, { name: 'hitchKnob', cast: true });
      knob.position.set(lx, y0 + 1.62, lz); knob.scale.set(1, 0.8, 1); g.add(knob);
      const ring = mesh(new THREE.TorusGeometry(0.075, 0.018, 4, 10), MAT.harness, { name: 'hitchRing' });
      ring.position.set(lx + (lx > 0 ? -0.10 : 0.10), y0 + 1.08, lz);
      ring.rotation.y = Math.PI / 2; g.add(ring);
    };
    mkHitch(-3.55, -5.15); mkHitch(3.55, -5.15);
    const mkMount = (lx, lz) => {
      const y0 = gy(lx, lz);
      const low = mesh(box(0.95, 0.24, 0.62), MAT.stoneDark, { name: 'mountLow', cast: true, receive: true });
      low.position.set(lx, y0 + 0.12, lz - 0.10); g.add(low);
      const high = mesh(box(0.62, 0.30, 0.44), MAT.stoneDark, { name: 'mountHigh', cast: true, receive: true });
      high.position.set(lx, y0 + 0.39, lz + 0.14); g.add(high);
      /* 顶面被踩得发亮的薄石板：只比高步宽出 0.02，给"上马落脚处"一个可读的亮面 */
      const top = mesh(box(0.56, 0.035, 0.38), MAT.stone, { name: 'mountTop', cast: true, receive: true });
      top.position.set(lx, y0 + 0.557, lz + 0.14); g.add(top);
    };
    mkMount(-2.45, -5.05); mkMount(2.45, -5.05);
  }

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
  /* ── 可行驶马车注册（2026-10-23）──────────────────────────────────────────
     两匹辕马（role='harnessed'）才是"拉车的那两匹"，其余四匹继续原地/吃草。
     travelOff 是"相对车心的车局部偏移"：原编成里马心在车心前方 1.45m、横向 ±0.4m
     （车局部 +x 与厩身局部的 +x 反向 —— 由 rotation π 决定，这里按 home 反算，不写死符号）。 */
  const travSlots = horseSlots.filter(s => s.role === 'harnessed');
  for (let i = 0; i < travSlots.length; i++){
    const s = travSlots[i];
    s.travelOff = { x: -3.0 - s.home.x, z: 1.45 };
    s.travelPh = i * 0.12;
    makeLeadRope(s);
  }
  const blobMat = new THREE.MeshBasicMaterial({ map: makeSoftAlphaTex(), color: 0x000000,
    transparent: true, opacity: 0.30, depthWrite: false });
  const travBlob = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.4), blobMat);
  travBlob.name = 'carriageBlobShadow';
  travBlob.rotation.x = -Math.PI / 2;
  /* 车心停在 local (−3,−1.4)：贴地软影用**局部**坐标挂在本组里（组 y=0 ⇒ 局部 y = 世界高） */
  travBlob.position.set(-3.0, groundHeight(cx + (-3.0) * cy + (-1.4) * sy,
                                          cz - (-3.0) * sy + (-1.4) * cy) + 0.10, -1.4);
  travBlob.rotation.y = Math.PI;
  travBlob.renderOrder = 2;
  travBlob.raycast = () => {};
  travBlob.userData.aoSkip = true;
  travBlob.userData.noMerge = true;
  g.add(travBlob);
  TRAVEL.ready = true;
  TRAVEL.group = g; TRAVEL.car = carA; TRAVEL.wheels = carA.userData.wheels || [];
  TRAVEL.slots = travSlots; TRAVEL.blob = travBlob;
  TRAVEL.cx = cx; TRAVEL.cz = cz; TRAVEL.stableYaw = yaw; TRAVEL.cy = cy; TRAVEL.sy = sy;

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
