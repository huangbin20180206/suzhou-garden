// 15b-horse-rig.js — 由 15-stable.js 按职责整块搬出（纯搬家，逐字节未改）。
// 马的模型层：
//   · 资产路径/高度常量（Tinker 骨骼件 + Rodin 无骨骼件）
//   · 贴图与材质、逐顶点花纹(markCoatPoints)、瘦颈
//   · 姿态驱动（applyTinkerPose / applyRodinPose）
//   · 补件与锚点量测、伪蒙皮权重/枢轴/着色烘焙、installHorseRig
// 本文件只做「几何与材质」，不含行为状态机（那在 15c）。
import { GLTFLoader, THREE, mergeGeometries } from '../vendor.js';
import { HOOKS, mulberry32 } from './00-config.js';
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
export const HORSE_GLB = 'research/diy-horses/horse-rodin-fallback.glb';   // 旧 Rodin 灰模（仅 horseSrcOnce 回退用）
/* 模型自带的朝向修正：生成模型的"正面"不一定朝 +z（本项目程序化马的头朝 +z）。
   实测（outputs/_diag/horse-view.html 五视图 + 坐标轴参考线：front/back/right/top 四视图
   一致指向"头朝 +z"）⇒ 与程序化马同向，**不用转**。 */
/* 真马的总高（蹄底→耳尖）。⚠️ 别按"肩高"归一：模型包围盒的 Y 就是**总高**，
   而马厩里所有配件都是照程序化替身配的（替身耳尖 ~1.74m、体长 ~1.9m），
   归一成 1.5（= 肩高）会让真马比柱子/横轭/马车**小一大圈**。取 1.75 ⇒ 体长 ~1.94m，
   与替身逐项对齐（槽位、横轭 1.60、挽带 0.92、车厢前沿）。 */
export const HORSE_TOTAL_H = 1.75;

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
export const TINKER_GLB = 'assets/HorseTinker.glb';
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
export const TINKER_BONE_GROUPS = {
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
export const TINKER_MANE_BONES = (() => {
  const out = [];
  for (let i = 1; i <= 6; i++){
    const p = String(i).padStart(2, '0');
    out.push('mane_base' + p, 'mane_top' + p, 'DEF-mane_base' + p, 'DEF-mane_top' + p);
  }
  return out;
})();
export const TINKER_LEG_BONES = (s) => ([
  'DEF-upper_arm' + s, 'DEF-upper_arm' + s + '001', 'DEF-forearm' + s, 'DEF-forearm' + s + '001',
  'DEF-forefoot' + s, 'DEF-forefoot' + s + '001', 'DEF-f_toe' + s,
  'ORG-upper_arm' + s, 'ORG-forearm' + s, 'ORG-forefoot' + s, 'ORG-f_toe' + s, 'f_hoof' + s,
]);
/* 后腿：2026-10-21 接入步态时补。Rigify 的后腿链是
   thigh → thigh.001 → lower_leg → lower_leg.001 → hind_foot → hind_foot.001 → r_toe → r_hoof，
   与皮肤分层（DEF 带主体、ORG 带骨骼驱动）同前腿，两条链都要转、同号同权重，否则会撕开。
   ⚠️ 名字同样不带点（GLTFLoader 会删 '.'）：'DEF-thigh.L' → 'DEF-thighL'。 */
export const TINKER_HIND_LEG_BONES = (s) => ([
  'DEF-thigh' + s, 'DEF-thigh' + s + '001', 'DEF-lower_leg' + s, 'DEF-lower_leg' + s + '001',
  'DEF-hind_foot' + s, 'DEF-hind_foot' + s + '001', 'DEF-r_hoof' + s,
  'ORG-thigh' + s, 'ORG-lower_leg' + s, 'ORG-hind_foot' + s, 'r_hoof' + s,
]);
export const TINKER_ANIM_BONES = (() => {
  const out = [];
  const g = TINKER_BONE_GROUPS;
  for (const k of Object.keys(g)) out.push(...g[k]);
  out.push(...TINKER_MANE_BONES);
  out.push(...TINKER_LEG_BONES('L'), ...TINKER_LEG_BONES('R'));
  out.push(...TINKER_HIND_LEG_BONES('L'), ...TINKER_HIND_LEG_BONES('R'));
  return out;
})();
export let _tinkerBuf = null, _tinkerLoader = null;
export function tinkerBuffer(){
  if (!_tinkerBuf){
    _tinkerBuf = fetch(TINKER_GLB).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
    _tinkerBuf.catch(() => { _tinkerBuf = null; });
  }
  return _tinkerBuf;
}
export function tinkerLoader(){
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
export let _furNormal = null;
export function furNormalMap(){
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
export function markCoatPoints(src){
  const geo = src.geometry;
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
export function slimNeck(src){
  /* ⚠️ v2（2026-10-21 蓝框：马嘴长而窄、无鼻孔、颈侧面厚 ⇒ "巨型猎犬"）：
     ① 颈 X 压 0.78（v1 已有）；② 吻端**加宽**回 ~1.0（头 0.90 × 吻 1.12：
     真马吻端宽钝、有鼻翼，窄长吻 = 狗）；③ Z 不动（颈中心线支点没法定准，
     对称 X 缩放对支点误差免疫，Z 缩放会平移整个头）。全程 smoothstep 羽化，无硬缝。 */
  const geo = src.geometry;
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

export function tinkerMaterial(m, tint, meshName){
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
export const _tq = new THREE.Quaternion(), _te = new THREE.Euler(), _tid = new THREE.Quaternion();
export const _tv = new THREE.Vector3();
export function tinkerBone(bones, rest, name, x, y, z){
  const b = bones[name]; if (!b) return;
  _te.set(x, y, z, 'XYZ'); _tq.setFromEuler(_te);
  b.quaternion.copy(rest[name] || _tid).multiply(_tq);
}
/* 把"概念上的姿态角"翻译成骨骼旋转。headPitch 正 = 低头（与旧伪蒙皮同号）。
   ⚠️ 骨名按上面的**真值表**取（ORG 链带动头/下颌/耳/鼻，DEF 链带动脖皮/上臂），
   方向也按实测：ORG-neck X 正 = 低头、ORG-head X 正 = 低头 Z 正 = 摇、jaw X 正 = 张嘴。 */
export const TINKER_JAW_CLOSE = 0.46;   // 静息合嘴：模型出厂是"微张"，露上下齿 → 读作龇牙僵尸脸
export function applyTinkerPose(h, headPitch, headYaw, tailYaw, leg, dt){
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
export function bendHeadDown(geo, deg){
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
export function taperedTube(pts, radii, radial = 5){
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
export function snapAnchor(geo, p, n = 1){
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
export function sideSurfacePoint(geo, ty, tz, dy = 0.05, dz = 0.05){
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
export function lowestSurfacePoint(geo, tz, dz = 0.035, dx = 0.030){
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
export const HORSE_ANCHOR_APPROX = {
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
export function installHorseRig(mat, geo, W, piv, nose){
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
    /* 口鼻去粉（2026-10-27 老黄："白马的嘴唇不应该是这种粉红"）：模型贴图在唇鼻处
       本来就带一块饱和的粉红，白光下最扎眼。做法＝**按模型局部坐标**圈出口鼻那一小块，
       把颜色向同明度的灰压过去（只动色相/饱和、不动明暗 ⇒ 不会出现"一块脏斑"）。
       局部坐标必须走 varying 传进片元：position 在顶点着色器里。 */
    sh.uniforms.uMuzzle = { value: new THREE.Vector3(0, nose ? nose[1] : 1.25, nose ? nose[2] : 0.44) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aRigA;
        attribute vec2 aRigB;
        attribute float aRigJaw;
        varying vec3 vHorseLocal;
        uniform vec2 uHeadAng; uniform vec2 uTailAng; uniform vec4 uLegAng; uniform vec2 uJawAng;
        uniform vec3 uPivHead; uniform vec3 uPivTail; uniform vec3 uPivLegF; uniform vec3 uPivLegH; uniform vec3 uPivJaw;
        vec3 rigRX(vec3 p, vec3 pv, float a){ float c = cos(a), s = sin(a); vec3 d = p - pv;
          return vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c) + pv; }
        vec3 rigRY(vec3 p, vec3 pv, float a){ float c = cos(a), s = sin(a); vec3 d = p - pv;
          return vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c) + pv; }
      `)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3( position );
        vHorseLocal = position;
        /* 下颌先开合，再套头颈旋转（顺序反了的话，低头时下巴会被拉离鼻子） */
        if (aRigJaw > 0.002) transformed = mix(transformed, rigRX(transformed, uPivJaw, uJawAng.x), aRigJaw);
        if (aRigA.x > 0.002){ vec3 q = rigRX(transformed, uPivHead, uHeadAng.x); q = rigRY(q, uPivHead, uHeadAng.y); transformed = mix(transformed, q, aRigA.x); }
        if (aRigA.y > 0.002){ vec3 q = rigRY(transformed, uPivTail, uTailAng.x); q = rigRX(q, uPivTail, uTailAng.y); transformed = mix(transformed, q, aRigA.y); }
        if (aRigA.z > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegF, uLegAng.x), aRigA.z);
        if (aRigA.w > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegF, uLegAng.y), aRigA.w);
        if (aRigB.x > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegH, uLegAng.z), aRigB.x);
        if (aRigB.y > 0.002) transformed = mix(transformed, rigRX(transformed, uPivLegH, uLegAng.w), aRigB.y);
      `);
    /* 片元：口鼻去粉（见 uMuzzle 的注释）。用 map_fragment 之后改 diffuseColor，
       贴图与顶点色都已经乘进去了，压的是最终颜色。 */
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vHorseLocal;
        uniform vec3 uMuzzle;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float mz = smoothstep(uMuzzle.z - 0.16, uMuzzle.z - 0.03, vHorseLocal.z);
          float my = 1.0 - smoothstep(uMuzzle.y + 0.02, uMuzzle.y + 0.20, vHorseLocal.y);
          float mm = mz * my;
          if (mm > 0.01){
            float ml = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(ml * 1.02, ml * 0.95, ml * 0.93), 0.85 * mm);
          }
        }`);
  };
  mat.needsUpdate = true;
}

/* ── Rodin 马的姿态：同一个"角度语义"写进伪蒙皮 uniform ─────────────────────
   口径与 applyTinkerPose 保持一致（这样 tickStableLife 只算一份角度，两条路通用）：
     · 头：+ = 低头；吃草那两匹额外加基角（graze 0.95 / fed 0.66）× grazeW
     · 尾：tailYaw 原样（shader 里 rigRY 绕竖轴 = 左右甩）
     · 腿：伪蒙皮的 rigRX **正 = 蹄子向后**，而 gaitPose 的 u 是"前为正"⇒ 取负号
   ⚠️ 伪蒙皮做不出屈膝，整条腿绕肩/髋摆；15~25m 观感距离够用（旧 Tripo 马同款）。 */
export function applyRodinPose(h, headPitch, headYaw, tailYaw, leg){
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

export let _stT = 0;

/* 仿真时钟：拆分前是本文件的 `let _stT`（15b 读、15c 写）。
   模块导出是只读绑定，写只能走这个函数 —— 与原 `_stT += Math.min(Math.max(dt,0),0.1)` 逐字一致。 */
export function advanceStableTime(dt){
  _stT += Math.min(Math.max(dt, 0), 0.1);
  return _stT;
}
