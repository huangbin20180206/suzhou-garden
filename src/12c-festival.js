// 12c-festival: 上元灯会（河灯 / 灯串 / 挂灯 / 暖光第 4 层）—— 2026-10-05 从 12-env.js 整块搬出（纯搬家）。
/* 为什么单独一个文件：灯会是"一键切换的一整套夜景装置"（自建材质与网格、每帧漂移、挂点收集、
   第 4 层 look），与 12-env 的时段/季节/天气状态机 + 环境面板 UI 是两件事。原块 ~500 行，
   混在一起让 12-env 逼近 3300 行（改一处很难看清周围还有什么 —— 本批拆分的唯一理由）。
   ⚠️ 本文件**不能** import './12-env.js'：12-env 反过来 import 本文件，成环 = 启动期 TDZ
   （项目多次前科，见 index.html 内联主模块顶部、00-config 的 HOOKS / ENV_REF 注释）。
   它需要 12-env 的 6 样东西，全部由 12-env 在自己 body 里调 bindFestival(ENV, host) 注入，
   且**刻意沿用原名字** ⇒ 下面搬来的代码一行都不用改：
     · ENV                 环境状态机（tickFestival 读 ENV.cur.festivalShow；festivalState / toggleFestival 读写）
     · willowLeafInsts     柳叶实例数组（挂点收集要遍历它；12-env 的私有数组，注入的是同一个对象）
     · worldLights         灯笼真光源数组（festivalState 要报"真光源仍是灯笼那 5 盏"）
     · syncEnvUI / resolveEnv / cloneParams   12-env 的三个内部函数（toggleFestival 切夜 / 回原时段要用）
   ⚠️ 不对注入做兜底：没注入就读到 null 立刻崩 —— 静默兜底只会变成"点灯会没反应"而无人察觉。
   ⚠️ 另外四个声明（riverLampMat / stringBulbMat / riverFlameMat / _hangInsts）在 12-env 的
      "季节存在性"表里还在用，所以本文件把它们 export 出去（其余一律不导出）。 */
import { THREE, mergeGeometries } from '../vendor.js';
import { MAT } from './01-materials.js';
import { world } from './08-assemble.js';
import { POND_RADII } from './05-water.js';
import { treeLanternInsts } from './06-vegetation.js';
import { TAU, CFG, mulberry32, rnd } from './00-config.js';

/* ↓ 全部由 12-env.js 的 bindFestival(...) 注入（见文件头；沿用原名字是故意的，搬来的代码零改动） */
let ENV = null;
let willowLeafInsts = [];
let worldLights = [];
let syncEnvUI = null;
let resolveEnv = null;
let cloneParams = null;   // ⚠️ 三个分开写：合并成一条多变量 let 的话，probe/import-audit 的
                          //    topLevelDecls 只认第一个名字，另外两个会被判成"用了别的模块的导出但没 import"
export function bindFestival(env, host){
  ENV = env;
  willowLeafInsts = host.willowLeafInsts;
  worldLights = host.worldLights;
  syncEnvUI = host.syncEnvUI; resolveEnv = host.resolveEnv; cloneParams = host.cloneParams;
}

/* ══ 上元灯会（2026-09-24 · 计划书 Phase 3 第 7 项）════════════════════════════
   一键切换 = 夜 + 水面河灯（随波漂移）+ 游廊灯串 + 桃树枯枝挂灯 + 暖光曝光提升。
   三条硬规矩（计划书 v2.0 补注，全是绕坑，别省）：
   ① **不新增真光源**：夜里月光接管阴影方向 —— 河灯/灯串/挂灯一律用自发光材质"伪造"发光，
     全场真实灯数仍是灯笼那 5 盏 PointLight（festival-guard 断言这一点）。
   ② **draw calls 预算吃紧**（上限 800）：河灯 1 + 烛焰 1 + 灯串 1 + 两株桃树挂灯 2 = **+5**；
     非灯会态全部 count=0 ⇒ three 根本不提交，白天零成本。
   ③ 现有灯笼的"20 件故意不合并"是给单独寻址留的 —— 本功能不碰它们。
   ⚠️ 河灯落点必须避开三类**出水物**（实测坐标见 outputs/_diag/festival-geo.mjs）：
     · 桥体：08 里 world(8.4,0,4.6) 旋转 90°，跨度 9.4×厚 2.4 ⇒ 世界 x∈[7.2,9.6]、z∈[-0.1,9.3]
       （桥体被 mergeStatics 并网，运行期找不到名字 ⇒ 用源码常量）；
     · 汀步石：05 的 z=5.6 直线上 11 块 ⇒ 实测 x∈[-4.12,6.99]、z∈[4.93,6.32]；
     · 立峰石组（石矶+伴石）：实测 x∈[-6.97,-2.83]、z∈[5.9,9.81]。
     漂移是慢速小轨道（半径 ≤0.5m），落点对三者各留 ≥1m 余量 ⇒ 永远到不了；岸边同理
     （r ≤ 0.80×POND_RADII − 轨道半径）。 */
const FEST_RIVER_N = 24;
const FEST_BRIDGE  = { x0: 7.2, x1: 9.6, z0: -0.1, z1: 9.3 };     // 桥体（世界）
const FEST_STONES  = { x0: -4.12, x1: 6.99, z0: 4.93, z1: 6.32 }; // 汀步石（世界，实测）
const FEST_HERO    = { x0: -6.97, x1: -2.83, z0: 5.9, z1: 9.81 }; // 立峰石组（世界，实测）
const FEST_PAD = 1.0;                                             // 河灯对出水物的避让余量
const _inRect = (r, x, z, pad) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
/* 河灯：暖光纸罩（emissive 伪造发光）。烛火照透纸壳 —— 整盏自发光本来就是对的物理。
   ⚠️ 亮度是**量出来的**（2026-09-24 目视复核 fest-low.png）：初版 emissive 1.7 + 0xFF9A3C
   近看糊成一簇"实心亮黄块"，既不像灯也不像火（bloom 阈值 0.90，1.7 远远越线）。
   现在 0.85 + 更暖的橙（绿通道压低 ⇒ 不再偏黄绿）⇒ 近看能读出"一朵发光的花"。 */
export const riverLampMat = new THREE.MeshStandardMaterial({
  color: 0xFFE9C8, emissive: 0xFF7A28, emissiveIntensity: 0.85, roughness: 0.62, metalness: 0.0 });
/* 灯串小灯泡：比纸罩亮一档（它们是"光源"本身），但同样压在 bloom 阈值附近。 */
export const stringBulbMat = new THREE.MeshStandardMaterial({
  color: 0xFFE2B0, emissive: 0xFFB84D, emissiveIntensity: 1.15, roughness: 0.5, metalness: 0.0 });
const _festRiver = { inst: null, flame: null, data: [] };   // data: { bx, bz, orbR, orbSp, ph, yaw, yawSp }
const _festBulbs = { inst: null, n: 0 };
let _festBuilt = false;

function makeRiverLampGeo(){
  /* 莲花灯：托盘 + 6 片烫花瓣 —— 单几何单材质（1 draw call）。
     尺寸刻意小（直径 ~0.32m）：24 盏铺一池要"星星点点"，不是"漂浮的路灯"。
     ⚠️ **烛焰不进这个几何**：烛焰要用**更亮一档的材质**（独立 InstancedMesh），
     否则"灯芯"和"纸罩"同亮度 ⇒ 近看是一坨均匀亮块，读不出"火在花里"
     （初版就是这样，量图 fest-low.png 看出来的）。 */
  const dish = new THREE.CylinderGeometry(0.10, 0.13, 0.05, 9);
  dish.translate(0, 0.025, 0);
  const parts = [dish];
  for (let i = 0; i < 6; i++){
    const p = new THREE.CylinderGeometry(0.03, 0.085, 0.16, 6, 1, true);
    const a = (i / 6) * TAU;
    p.translate(0, 0.095, 0);
    p.rotateX(0.85);                                   // 花瓣外张
    p.rotateY(a);
    p.translate(Math.sin(a) * 0.10, 0, Math.cos(a) * 0.10);
    parts.push(p);
  }
  return mergeGeometries(parts, false) || dish;
}
/* 烛焰材质：亮一档（bloom 会给它拖出小光晕）⇒ 花是柔光、芯是亮点。 */
export const riverFlameMat = new THREE.MeshStandardMaterial({
  color: 0xFFF0D0, emissive: 0xFFB050, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.0 });

export function makeFestivalLights(){
  if (_festBuilt) return;
  _festBuilt = true;
  /* —— 河灯落点（世界坐标）：本地种子流 —— 布局类随机不走共享 Math.random（项目铁律） */
  const fr = mulberry32(20260925);
  const data = [];
  let guard = 0;
  while (data.length < FEST_RIVER_N && guard++ < 4000){
    const a = fr() * TAU;
    const ri = Math.min(POND_RADII.length - 1, Math.floor(a / TAU * POND_RADII.length));
    const orbR = 0.16 + fr() * 0.34;                   // 轨道半径 ≤0.5 ⇒ 与 1m 避让余量配平（实测漂移量级见 festival-guard）
    const maxR = POND_RADII[ri] * 0.80 - orbR;         // 岸线内 20% 再扣轨道半径
    if (maxR < 2.0) continue;
    const r = 1.6 + Math.sqrt(fr()) * (maxR - 1.6);
    const wx = Math.cos(a) * r, wz = 3.0 + Math.sin(a) * r;   // 池局部 → 世界（池心 z=+3）
    if (_inRect(FEST_BRIDGE, wx, wz, FEST_PAD)) continue;
    if (_inRect(FEST_STONES, wx, wz, FEST_PAD)) continue;
    if (_inRect(FEST_HERO,  wx, wz, FEST_PAD)) continue;
    if (data.some(d => Math.hypot(d.bx - wx, d.bz - wz) < 0.9)) continue;   // 彼此不叠
    data.push({ bx: wx, bz: wz, orbR, orbSp: (fr() * 0.5 + 0.5) * (fr() < 0.5 ? 1 : -1) * 0.22,
                ph: fr() * TAU, yaw: fr() * TAU, yawSp: (fr() - 0.5) * 0.3 });
  }
  const inst = new THREE.InstancedMesh(makeRiverLampGeo(), riverLampMat, data.length);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
  inst.userData.noMerge = true;
  inst.userData.aoSkip = true;             // 河灯小且随波动，AO 贡献可忽略 ⇒ 不进法线 pass
  inst.name = 'riverLanterns';
  world.add(inst);
  _festRiver.inst = inst; _festRiver.data = data;

  /* 烛焰：同一批落点、同一套漂移，但用更亮的材质（+1 draw call：灯会共 +5，仍低于 800）。 */
  const flameGeo = new THREE.ConeGeometry(0.022, 0.07, 6);
  flameGeo.translate(0, 0.105, 0);
  const fInst = new THREE.InstancedMesh(flameGeo, riverFlameMat, data.length);
  fInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fInst.frustumCulled = false;
  fInst.userData.noMerge = true;
  fInst.userData.aoSkip = true;
  fInst.name = 'riverLanternFlames';
  world.add(fInst);
  _festRiver.flame = fInst;

  /* —— 游廊灯串：两跨悬链（锚点复用 lanternSpots 的游廊三点，额枋下 3.05m）—— */
  const CORRIDOR = [[13.2, -6.0], [18.2, -1.8], [24.0, 6.5]];   // 见上方 lanternSpots 注释
  const SAG = 0.34, Y = 3.02, PER = 14;
  const bulbs = [];
  for (let s = 0; s < CORRIDOR.length - 1; s++){
    const [x0, z0] = CORRIDOR[s], [x1, z1] = CORRIDOR[s + 1];
    for (let i = 0; i < PER; i++){
      const u = (i + 0.5) / PER;
      const sag = Math.sin(u * Math.PI) * SAG;                 // 悬链近似：正弦下垂
      bulbs.push([x0 + (x1 - x0) * u, Y - sag, z0 + (z1 - z0) * u]);
    }
  }
  const bulbGeo = new THREE.SphereGeometry(0.035, 8, 6);
  const bInst = new THREE.InstancedMesh(bulbGeo, stringBulbMat, bulbs.length);
  const m4 = new THREE.Matrix4();
  bulbs.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); bInst.setMatrixAt(i, m4); });
  bInst.frustumCulled = false;
  bInst.userData.noMerge = true;
  bInst.userData.aoSkip = true;
  bInst.name = 'corridorStringLights';
  world.add(bInst);
  _festBulbs.inst = bInst; _festBulbs.n = bulbs.length;
}

/* ══ 灯会挂灯扩展（2026-09-26 · 用户："桃树，柳树，还有紫藤都可以挂花灯；
      院子围栏也可以挂一些中国传统的红色灯笼"）══════════════════════════════════
   两批新增挂灯，**都只加自发光材质、一个真光源都不加**（festival-guard 坑①：
   夜里月光接管阴影方向，加真灯就得同步改阴影逻辑）：

     A 柳树 + 紫藤挂**花灯** —— 形制照抄桃树那盏（Lathe 鼓腹 + 上下盖 + 挂绳），
       不改形制，只是换挂点。
     B 围栏挂**传统红灯笼** —— 新形制：直筒微鼓的朱红灯身 + 金色上下盖 +
       挂绳 + 底部流苏球。刻意与花灯可区分：直筒不收腰、色恒为红、尺寸大一档。

   ── 三条与既有门禁对齐的硬规矩 ──
   ① **一个灯笼 = 一份合并几何 = 一个 InstancedMesh**。
      诊断段（outputs/_diag/lantern-ab*.mjs）试摆时把一盏灯拆成 4~5 个 InstancedMesh
      （灯身/盖/底/绳/穗），报出 **+26 draw call** —— 纯浪费。生产实现用
      mergeGeometries 把部件并成一份 ⇒ 120 盏灯只占 **3 个对象**（柳花灯/紫藤花灯/红壁灯）。
      ⚠️ 红壁灯的金盖与红身**同属一份几何**（instanceColor 逐实例染色，gold 那一档
      用顶点色偏移表达），否则红壁灯就要 2 个对象。
   ② **非灯会态 count=0 零提交** —— 走 applyPresence 的直接清单（与 treeLanternInsts 同套路，
      不混进季节表：存在性语义是"随灯会"，与季节无关）。
   ③ **挂点存在性一律用 `instanceMatrix.count`（容量），不用 `count`**。
      `count` 会被季节通道改写（冬季 willowLeaf≈0、wisteriaShow=0 把柳叶/紫藤压到近 0），
      而 instanceMatrix 缓冲**仍是满容量**的。挂灯要留在树上（枯枝挂花灯/缠枝挂灯是上元灯会的
      题眼，冬天更是唯一能看见的一笔）—— 用 count 判会把挂灯一起判没了。 */
const FEST_WILLOW_PER = 12;         // 每株柳树 12 盏
const FEST_WISTERIA_PER = 12;       // 每丛大紫藤 12 盏
const FEST_WALL_GAP = 3.4;          // 围栏红灯笼间距（米）
/* ⚠️⚠️ 2026-10-06 修「围墙红灯笼悬空」（老黄截图1："挂在围墙四周的红色灯笼都是悬空的"）：
   旧值 = 挂高 3.95 / 自墙中心线内缩 **0.95** —— 而墙厚 0.6（内面在 0.30）、墙帽披檐的两块
   坡板只伸到 **|z| ≈ 0.55**（03-factory 的 makeWallCap：half = t/2+0.24 = 0.54，绕 x 转 ±0.42）。
   实测（outputs/_diag/wall-lantern-geom.mjs，从挂点竖直向上打射线）：
     内缩 0.30→帽底 y 4.71 / 0.40→4.665 / 0.50→4.621 / **0.55→4.725（已到檐口外缘）**
     / **≥0.65 一路 null（上面什么都没有）**；
     而 48 盏现网墙灯**全部**在 0.95 ⇒ 抽样 8 盏的向上射线**全 null** —— 它们挂在离墙帽
     0.4m 的空气里、绳顶（+0.356）还低于帽檐，所以"没有绳也没有挂在结构上"。
   现在按墙帽真实几何挂：内缩 **0.47**（在帽檐 0.55 之内、灯身外缘 0.61 略出檐口一点点，
     灯身内缘 0.33 vs 墙面 0.30 ⇒ 离墙 3cm 不穿模）、挂高 **4.47**。
   ⚠️⚠️ 挂高的取法绕了两轮，结论是"**别留缝**"：灯身顶偏移 +0.158、帽底在 off0.47 处 ≈4.634
     ⇒ 挂点 4.47 时灯身顶 4.628 —— **贴着檐口**（缝 ≤6mm，挂高抖动 ±0.025 也只在 ±2.5cm 内）。
     为什么不留一段"看得见的绳子"：绳在常规观距下永远只有 1~2px（40m 外 3.5cm = 0.05°），
     第一版"绳子加粗 + 留 20cm 缝"出图复检时多模态仍判"凭空吊着" —— **有缝就是悬空**，
     而缝里那根绳子谁也看不见。⇒ 正确做法是让灯顶直接贴住檐口，把绳子**藏进帽檐里**
     （绳顶在帽板内部 8.7cm，帽板厚 ~13cm 不会穿顶）。
     实测复核（outputs/_diag/wall-lantern-geom.mjs）：44/44 盏的向上射线都命中墙帽。
   ⚠️ 这两个常量与 makeWallCap 的几何**绑死**（改墙帽就要重算）；
   festival-lanterns-guard 的「向上 0.5m 内必须命中墙帽」那条会当场报红。 */
const FEST_WALL_Y = 4.47;           // 挂高（灯身顶 4.628 ≈ 帽底 4.634 ⇒ **贴着檐口挂、看不出缝**）
const FEST_WALL_OFF = 0.47;         // 自墙中心线内缩（墙厚 0.6 ⇒ 内面 0.30；帽檐到 0.55）
const FEST_WIS_MIN = 1500;          // 紫藤"大藤架"判别阈值（容量）—— 游廊棚上另有 12 小丛，容量 375~566

/* 花灯材质：与桃树那盏 TREE_LANTERN_MAT 同族（MeshBasic + toneMapped:false）。
   ⚠️ 不能直接 import 06 的 TREE_LANTERN_MAT 复用：那材质**已经**被桃树挂灯的
   instanceColor 通道占用（instanceColor 是**逐网格**的，两个网格各自一份，互不影响）——
   其实可以复用，但为了"红灯笼是独立一类"的判读清晰，这里给花灯挂灯单独一份同参材质，
   并登记进 festivalShow 的 presence 表（自发光件不吃季节色，登记只为统一显隐语义）。 */
const hangFlowerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false,
                                                    transparent: true, opacity: 0.95, depthWrite: false });
/* 红灯笼材质：朱红 + 逐实例染色（深红/正红/朱红三档抖动，±12% 亮度）——
   传统壁挂灯笼是成排的，全等亮度会读成"塑料玩具"。 */
const wallRedMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false,
                                                  transparent: true, opacity: 0.97, depthWrite: false });

/* 花灯几何：与桃树 makeTreeLanternGeo 同一形制（Lathe 鼓腹 + 上下盖 + 挂绳），
   只是这里**合并成一份**（桃树那版在 06 里也是合并的，见 makeTreeLanternGeo）。 */
function makeHangFlowerGeo(){
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0.026, -0.085), new THREE.Vector2(0.062, -0.062),
    new THREE.Vector2(0.068,  0.000), new THREE.Vector2(0.062,  0.062),
    new THREE.Vector2(0.026,  0.085),
  ], 10);
  const cap = new THREE.CylinderGeometry(0.030, 0.030, 0.016, 8);  cap.translate(0,  0.090, 0);
  const base = new THREE.CylinderGeometry(0.030, 0.030, 0.016, 8); base.translate(0, -0.090, 0);
  const cord = new THREE.CylinderGeometry(0.004, 0.004, 0.10, 4);  cord.translate(0,  0.148, 0);
  return mergeGeometries([body, cap, base, cord], false) || body;
}
/* 红灯笼几何：直筒微鼓的灯身 + 上下木盖 + 挂绳 + 流苏球。
   ⚠️ 金盖与红身**同属一份几何**（否则要多一个 InstancedMesh = 多一次提交）：
   盖用顶点色偏移（红身基色 R/G/B 分别 +0.62/+0.40/+0.06 ⇒ 落到金色），
   instanceColor 仍按**红身**那一档染色 ⇒ 盖跟着染成"偏金的暗红"，夜里读作铜盖。
   ⚠️⚠️ 2026-10-06：**挂绳加粗 0.005 → 0.014**（直径 6mm → 3.5cm）。
   起因 = 修完"悬空"之后出图复检，多模态仍判"灯浮着、看不见绳子" —— 绳顶确实顶在墙帽里
   （射线实测间隙 0.31~0.34 ≤ 绳长 0.356），但 6mm 的细绳在 8m 外只有 1~2px、**等于看不见**，
   于是画面读起来还是"凭空吊着"。挂绳是"这盏灯挂在结构上"的唯一视觉证据，
   加粗到 3.5cm（×1.25 后）在常规观距下才读得出来；灯身 0.28m 配 3.5cm 绳并不夸张。 */
function makeWallRedLanternGeo(){
  /* ⚠️ 上一轮（2026-09-27）把整份几何**放大 1.25×**（灯身直径 0.224 → 0.280m）。
     起因：40m 观距下 0.22m 的灯笼在屏上只有几个暗红点，读不出"真是一盏灯"。
     上界有两个物理约束，不能乱放大：
       ① 灯笼顶（绳头 y=+0.365 处）必须**低于**帽檐（帽檐在 y≈4.8）—— 放大后 y=+0.456，仍安全；
       ② 底沿玉坠（穗 y=-0.163 处）放大后 y=-0.204，挂点 y=3.95 ⇒ 底沿 y=3.75，
          高于人头且不与地面道具碰撞。
     尺寸只改几何，不改挂点/挂高（y=3.95），所以门禁里"墙灯 y 3.6~4.4"那条不受影响。 */
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0.085, -0.105), new THREE.Vector2(0.105, -0.075),
    new THREE.Vector2(0.112,  0.000), new THREE.Vector2(0.105,  0.075),
    new THREE.Vector2(0.085,  0.105),
  ], 12);
  const capT = new THREE.CylinderGeometry(0.070, 0.070, 0.022, 12); capT.translate(0,  0.115, 0);
  const capB = new THREE.CylinderGeometry(0.062, 0.062, 0.020, 12); capB.translate(0, -0.112, 0);
  /* ⚠️ 挂绳**短而粗**（2026-10-06 二改）：0.014 半径（×1.25 = 3.5cm 粗）+ 0.08 长（×1.25 =
     0.10m）—— 绳存在的意义就是"证明灯挂在结构上"，太长太细在观距下等于没有（见上面注释）；
     短绳 + 贴着帽檐挂（FEST_WALL_Y 抬到 4.44，挂点距帽底只剩 ~0.22m）才读得出"挂在檐下"。 */
  const cord = new THREE.CylinderGeometry(0.014, 0.014, 0.08, 6);   cord.translate(0,  0.165, 0);
  const tassel = new THREE.SphereGeometry(0.018, 8, 6);             tassel.translate(0, -0.145, 0);
  /* 整体放大 1.25×（含偏移），closePath:false 不封口。 */
  for (const g of [body, capT, capB, cord, tassel]) g.scale(1.25, 1.25, 1.25);
  const parts = [body, capT, capB, cord, tassel];
  /* 给盖/绳/穗打顶点色标记（金 = +0.62/+0.40/+0.06 的偏移量），
     合并后 instanceColor 与它相乘 ⇒ 盖读作金、灯身读作红。 */
  const GOLD = [0.62, 0.40, 0.06];
  const partsVC = parts.map((g, gi) => {
    const gg = g.clone();
    const n = gg.attributes.position.count;
    const col = new Float32Array(n * 3);
    const isGold = (gi === 1 || gi === 2 || gi === 3);        // capT / capB / cord
    for (let i = 0; i < n; i++){
      col[i*3]     = isGold ? GOLD[0] : 0;
      col[i*3 + 1] = isGold ? GOLD[1] : 0;
      col[i*3 + 2] = isGold ? GOLD[2] : 0;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return gg;
  });
  return mergeGeometries(partsVC, false) || body;
}

/* 挂点收集：柳/紫藤/围栏。
   ⚠️ **必须在 collectSeasonCaches() 之后调用**（08 的 runDeferredBoot 收尾顺序：
   mergeStatics → collectSeasonCaches → applyEnv → collectAOSkip；本函数挂在 collectSeasonCaches
   之后由 initEnvScene/deferBoot 收尾触发）。柳与紫藤都在 deferRoot 延迟批里 —— 模块期去采
   拿到的是空集（本项目老坑：willowLeaf 季节通道曾经一直写不进去）。
   坐标来源**全是已经活着的对象**，不改 06/07：
     · 柳树 → `seasonWillowLeaf` 的柳叶 InstancedMesh（mergeStatics 不吃 InstancedMesh ⇒ 名字/矩阵都在），
       读它的实例矩阵取**真实冠内顶点**（诊断实测柳叶幕 y 3.22~6.61、冠半径中位 1.67）。
     · 紫藤 → 材质是 MAT.wisteria 的 InstancedMesh，按**容量 ≥1500** 筛出两丛大藤架
       （(13.2,3.35,1.2) 容量 2212 / (13.2,3.35,-4.6) 容量 1695；游廊棚另有 12 小丛 375~566，滤掉）。
     · 围栏 → makeWalls 的网格已被 mergeStatics 并掉（名字全丢，实测 count=0），
       墙位完全由 CFG 常量决定（garden 60×45 / wall.h 4.5 / wall.t 0.6），照 07-ground 的
       洞口坐标留空（月洞门与漏窗正上方不挂灯）。 */
const _hangAnchors = { willow: [], wisteria: [], wall: [], built: false };
export const _hangInsts = [];             // 三份 InstancedMesh（柳花灯/紫藤花灯/红壁灯）
const FEST_HANG_COLORS = [0xFF6B35, 0xFF8FAB, 0xFFD166, 0x7BD389, 0x6BA8FF];

function collectWillowHangPts(){
  const out = [];
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const it of willowLeafInsts){
    const o = it.o;                                  // 柳叶 InstancedMesh（合并吃不掉）
    o.updateWorldMatrix(true, false);
    const g = o.parent, base = g.position, sc = g.scale.x;
    const cap = o.instanceMatrix.count;                // ⚠️ 容量，不是 count（季节会改 count）
    if (!cap) continue;
    const cand = [];
    const step = 5;
    for (let i = 0; i < cap; i += step){
      o.getMatrixAt(i, m4); m4.decompose(v, q, s);
      cand.push(new THREE.Vector3(base.x + v.x * sc, base.y + v.y * sc, base.z + v.z * sc));
    }
    cand.sort((a, b) => b.y - a.y);                    // 高 → 低
    /* ⚠️⚠️ 2026-09-26 观感修正：**按 y 分层等分索引会聚成一簇**，必须改成**横向最远点采样**。
       诊断（outputs/_diag/willow-cluster-diag.mjs + willow-cluster-points.png）证伪了原假设：
         · 12 个采样点的**原始实例索引是散开的**（[7463,438,7387,1162,...]，非连号）
           ⇒ "都从同一处序列取"（H1）不成立；
         · 单点世界坐标变换无 bug，冠幅本身 5.3~6.3m，12 盏的 xz 跨距已到冠幅的 66~87%
           ⇒ "scale/矩阵把范围压扁"（H2）不成立。
       真正的原因：y 排序后**等分索引**只保证"12 个点均匀分布在 y 那一维"，
       对 xz **毫无保证** —— 一堆 y 接近的叶子在 xz 上可能挤在冠的一角，于是画面读作
       "树冠一角挂了一串气球"，而冠的其余部分是空的（夜景里更明显，因为暗部什么都没有）。
       修法：**最远点采样**（farthest-point sampling）—— 先取 y 在冠中段（yP25~yP75）的候选
       作为种子池（保证仍挂在柳条上、不是浮空），再在 xz 平面上反复"取离已选集合最远的那个点"，
       直到 12 个。这样 12 盏**必然铺满整个冠幅**，读作"柳条上星星点点的花灯"。 */
    const lo = Math.floor(cand.length * 0.25), hi = Math.max(Math.floor(cand.length * 0.75), lo + 1);
    const band = cand.slice(lo, hi);                  // 冠中段的候选池（仍在枝上）
    if (!band.length){ out.push(cand[0].clone()); continue; }
    const picked = [];
    if (band.length <= FEST_WILLOW_PER){
      for (const p of band) picked.push(p);
    } else {
      /* 种子：候选池里离**池质心**最近的（落在冠的中心，最稳）；之后每轮取 xz 距
         已选集合最远者 —— 这是 k-center 贪心，12 个点把 6m 冠幅铺满且间距均匀。 */
      let cx = 0, cz = 0;
      for (const p of band){ cx += p.x; cz += p.z; } cx /= band.length; cz /= band.length;
      let seed = 0, bestD = Infinity;
      for (let i = 0; i < band.length; i++){
        const d = (band[i].x - cx) ** 2 + (band[i].z - cz) ** 2;
        if (d < bestD){ bestD = d; seed = i; }
      }
      picked.push(band[seed]);
      while (picked.length < FEST_WILLOW_PER){
        let bi = -1, bD = -1;
        for (let i = 0; i < band.length; i++){
          let d = Infinity;
          for (const q of picked){ const t = (band[i].x - q.x) ** 2 + (band[i].z - q.z) ** 2; if (t < d) d = t; }
          if (d > bD){ bD = d; bi = i; }
        }
        if (bi < 0) break;
        picked.push(band[bi]);
      }
    }
    for (const src of picked){
      const p = src.clone();
      p.y -= 0.15;                                    // 从枝上垂下来（灯顶贴枝）
      out.push(p);
    }
  }
  return out;
}
function collectWisteriaHangPts(){
  const out = [];
  const jrT = mulberry32(881122);                     // 本地流：布局类随机不走共享 rnd
  const groups = [];
  world.traverse(o => {
    if (o.isInstancedMesh && o.material === MAT.wisteria && o.instanceMatrix.count >= FEST_WIS_MIN)
      groups.push(o);
  });
  for (const grp of groups){
    grp.updateWorldMatrix(true, false);
    const p = grp.parent.position;
    const spanX = 4.4;                                // 实测 xRange 宽约 9m ⇒ 半跨 4.4
    for (let k = 0; k < FEST_WISTERIA_PER; k++){
      const u = (k + 0.5) / FEST_WISTERIA_PER;
      out.push(new THREE.Vector3(p.x - spanX + spanX * 2 * u,
                                 p.y - 0.20 - jrT() * 0.14,   // 落在藤与花穗顶之间
                                 p.z + (jrT() - 0.5) * 0.35));
    }
  }
  return out;
}
function collectWallHangPts(){
  const W = CFG.garden.w, D = CFG.garden.d;
  const jrL = mulberry32(334455);
  const out = [];
  /* 洞口留空：坐标抄 07-ground 的 makeWalls（北墙 i=±1,±2 漏窗；南墙月洞门 + 四漏窗；
     东西墙 rotation.y=π/2 ⇒ 墙沿 z，洞的墙局部 x 就是世界 z）。 */
  const inGap = (x, z, gaps) => gaps.some(gp => Math.hypot(x - gp[0], z - gp[1]) < gp[2]);
  const runGap = (x0, z0, x1, z1, gaps) => {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / FEST_WALL_GAP));
    for (let k = 0; k <= n; k++){
      const u = k / n, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
      if (inGap(x, z, gaps)) continue;
      out.push(new THREE.Vector3(x, FEST_WALL_Y + (jrL() - 0.5) * 0.05, z));
    }
  };
  runGap(-W/2 + FEST_WALL_OFF, -D/2 + FEST_WALL_OFF,  W/2 - FEST_WALL_OFF, -D/2 + FEST_WALL_OFF,
         [[0, -D/2, 3.2], [-18.4, -D/2, 2.4], [-9.2, -D/2, 2.4], [9.2, -D/2, 2.4], [18.4, -D/2, 2.4]]);
  runGap(-W/2 + FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,  W/2 - FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,
         [[0, D/2, 3.6], [-12.5, D/2, 2.4], [12.5, D/2, 2.4], [-21, D/2, 2.2], [21, D/2, 2.2]]);
  runGap(-W/2 + FEST_WALL_OFF, -D/2 + FEST_WALL_OFF, -W/2 + FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,
         [[-W/2, -14, 2.4], [-W/2, 2, 2.4]]);
  runGap( W/2 - FEST_WALL_OFF, -D/2 + FEST_WALL_OFF,  W/2 - FEST_WALL_OFF,  D/2 - FEST_WALL_OFF,
         [[ W/2, -14, 2.4], [ W/2,  2, 2.4]]);
  return out;
}

/* 把一份挂点写成 InstancedMesh（一份几何一个对象 = 一次提交）。 */
function addHangInst(geo, mat, pts, seed, tag, colorFn){
  if (!pts.length) return null;
  const inst = new THREE.InstancedMesh(geo, mat, pts.length);
  inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  inst.userData.noMerge = true;                      // 实例色会被几何合并丢掉
  inst.userData.aoSkip = true;                       // 灯自身在发光，不进 GTAO 法线 pass
  inst.userData.festivalHang = true;                 // 门禁按标记识别（不靠名字猜）
  inst.userData.hangKind = tag;
  inst.name = 'festivalHang_' + tag;
  inst.frustumCulled = false;
  const jr = mulberry32(seed);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0),
        s1 = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < pts.length; i++){
    q.setFromAxisAngle(up, jr() * TAU);
    m4.compose(pts[i], q, s1);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, colorFn(jr));
  }
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  world.add(inst);
  _hangInsts.push(inst);
  return inst;
}

/* 收集挂点并建网格。**幂等**，且**在柳叶网格到齐之前拒绝建**（延迟批时序，见 collectSeasonCaches 注释）。 */
export function collectFestivalHangAnchors(){
  if (_hangAnchors.built) return _hangAnchors;
  /* ⚠️ 前置：柳叶 InstancedMesh 必须已经收进季节缓存。延迟批之前调用会拿到空集 ——
     此时**什么都不建、不落 built 标记**，等 runDeferredBoot 收尾那次再来。 */
  if (!willowLeafInsts.length) return _hangAnchors;
  _hangAnchors.built = true;
  _hangAnchors.willow   = collectWillowHangPts();
  _hangAnchors.wisteria = collectWisteriaHangPts();
  _hangAnchors.wall     = collectWallHangPts();
  const flowerCol = (jr) => new THREE.Color(
    FEST_HANG_COLORS[(jr() * FEST_HANG_COLORS.length) | 0]).multiplyScalar(0.82 + jr() * 0.36);
  const redCol = (jr) => {
    const c = [0xE02A1C, 0xD0231A, 0xEE3520][(jr() * 3) | 0];
    return new THREE.Color(c).multiplyScalar(0.88 + jr() * 0.24);
  };
  addHangInst(makeHangFlowerGeo(), hangFlowerMat, _hangAnchors.willow,   20260926, 'willowFlower',   flowerCol);
  addHangInst(makeHangFlowerGeo(), hangFlowerMat, _hangAnchors.wisteria, 20260927, 'wisteriaFlower', flowerCol);
  addHangInst(makeWallRedLanternGeo(), wallRedMat, _hangAnchors.wall,  20260928, 'wallRed',        redCol);
  /* 非灯会态立即归零（applyPresence 之后每帧重申，这里只保证"建完就是关的"） */
  for (const o of _hangInsts) o.count = 0;
  return _hangAnchors;
}

/* 每帧推进河灯漂移（随波 = 慢速小轨道 + 起伏 + 缓旋）。只在灯会开着时写矩阵。 */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(),
      _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
/* `_festFreeze`：门禁**负例自检**用（冻结漂移时钟）。置 true 时 tickFestival 提前 return ——
   ⚠️ 不能靠"在页内反复调 tickFestival(0)"来冻结：渲染循环每帧都会用真时钟再调一次，
   两次调用互相覆盖 ⇒ 冻结无效（实测"冻结"后仍漂 0.062m，门禁当场报红，暴露了这个竞态）。
   所以冻结必须是**权威开关**，而不是"再调一次"。 */
let _festFreeze = false;
export function setFestivalFreeze(v){ _festFreeze = !!v; }
export function tickFestival(t){
  const inst = _festRiver.inst, flame = _festRiver.flame;
  if (_festFreeze) return;
  if (!inst || !(ENV.cur && ENV.cur.festivalShow > 0.03)) return;
  for (let i = 0; i < _festRiver.data.length; i++){
    const d = _festRiver.data[i];
    const a = d.ph + t * d.orbSp;
    const x = d.bx + Math.cos(a) * d.orbR;
    const z = d.bz + Math.sin(a) * d.orbR;
    const y = 0.055 + Math.sin(t * 0.8 + d.ph * 3.0) * 0.02;      // 水面微起伏（水面 0.06 之下贴着）
    _e.set(0, d.yaw + t * d.yawSp, Math.sin(t * 0.9 + d.ph) * 0.06);
    _q.setFromEuler(_e);
    _m4.compose(_v.set(x, y, z), _q, _s);
    inst.setMatrixAt(i, _m4);
    if (flame) flame.setMatrixAt(i, _m4);        // 烛焰与灯花同位同姿（只是材质更亮）
  }
  inst.instanceMatrix.needsUpdate = true;
  if (flame) flame.instanceMatrix.needsUpdate = true;
}

/* 灯会状态（festival-guard 读）—— 按项目规矩**显式暴露可判定的量**，不靠 traverse 猜。 */
export function festivalState(){
  const inst = _festRiver.inst;
  let treeN = 0, treeFull = 0;
  for (const o of treeLanternInsts){
    treeN += o.count;
    treeFull += o.userData.fullCount ?? o.count;
  }
  return {
    on: !!ENV.festival,
    /* 退出机制用的"进来之前"快照（guard 断言"关灯会后回得去"读完就不用再猜 ENV.time）。 */
    prevTime: _festPrev ? _festPrev.time : null,
    prevHour: _festPrev ? _festPrev.hour : null,
    riverN: inst ? inst.count : 0, riverFull: inst ? _festRiver.data.length : 0,
    riverPos: inst && inst.count > 0
      ? _festRiver.data.map((d, i) => {
          inst.getMatrixAt(i, _m4); _m4.decompose(_v, _q, _s);
          return [+_v.x.toFixed(3), +_v.z.toFixed(3)];
        }) : [],
    stringN: _festBulbs.inst ? _festBulbs.inst.count : 0,
    treeN, treeFull,
    /* 新增三批挂灯（柳花灯/紫藤花灯/围栏红壁灯）—— 显式暴露，不靠 traverse 猜。 */
    hang: _hangInsts.map(o => ({
      kind: o.userData.hangKind,
      n: o.count,
      full: o.userData.fullCount ?? o.instanceMatrix.count,
      objs: 1,                                  // 一份几何一个对象（合并后的 draw call 代价）
    })),
    hangBuilt: _hangAnchors.built,
    lampLights: worldLights.length,               // 真光源数必须仍等于灯笼的 5 盏
  };
}

/* ⚠️ 退出机制（老黄 2026-10-05："灯会场景没有退出机制"）——
   进入灯会时会**强切到「夜」21:30**，而旧版关掉灯会只撤灯会层、把人留在夜里：
   用户没有"回到我刚进来的那个时段"的路，只能自己去拖动条里找回来。
   ⇒ 进入时记下 (time, hour)，退出时恢复。
   ⚠️ 只在"当前仍是灯会自己压的那一档（夜 + 21.5）"时才恢复 —— 若用户在灯会里
   自己改过时段（比如点了「晨」），以**他的改动**为准，不要把他拽回去。 */
let _festPrev = null;

/* 一键切换灯会：开 = 记住当前时段 + 切到夜 + 叠灯会层；关 = 撤灯会层 + 回原时段。 */
export function toggleFestival(force){
  const on = force === undefined ? !ENV.festival : !!force;
  if (on === !!ENV.festival) return;
  if (on){
    _festPrev = { time: ENV.time, hour: ENV.hour };
    if (ENV.time !== 'night'){ ENV.time = 'night'; ENV.hour = 21.5; }   // 灯会 = 夜的 plus 版
  } else if (_festPrev && ENV.time === 'night' && Math.abs(ENV.hour - 21.5) < 0.05){
    ENV.time = _festPrev.time;                       // 回到进来之前
    ENV.hour = _festPrev.hour;
    _festPrev = null;
  } else {
    _festPrev = null;                                // 用户自己改过时段：不抢，直接作废
  }
  ENV.festival = on;
  ENV.from = cloneParams(ENV.cur);
  ENV.to = resolveEnv();
  ENV.t = 0;
  syncEnvUI();                              // 夜按钮、时辰滑杆、灯会按钮必须同帧落位
}
