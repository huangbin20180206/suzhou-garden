// 08e-birds.js — 由 08c-aquatic.js 按职责整块搬出（纯搬家，逐字节未改）。
// 天上的雁群 + 假山/草地上的小鸟：
//   · 大雁（横穿波次、人字/S 阵型、季节显隐由 12-env 写 GOOSE.dirSign）
//   · 小鸟（容量固定、逐只行为状态、屏幕可读性靠 BIRD_SCALE）
// koiGroup / dragonflies 两个「上提的空声明」仍在 08c（它们的赋值在 buildAquatic 里）。
import { mulberry32, TAU } from './00-config.js';
import { THREE } from '../vendor.js';
export const perchRnd = mulberry32(777001);
export const perchingDragonflies = [];
export const DF_PATROL = [
  { cx: -12, cz:  2, ax: 7, az: 5 },     // 池塘西
  { cx:   0, cz:  6, ax: 9, az: 6 },     // 池中央
  { cx:  10, cz:  2, ax: 7, az: 5 },     // 池塘东
  { cx:  -6, cz: 14, ax: 8, az: 4 },     // 南侧草地（西）
  { cx:   8, cz: 15, ax: 7, az: 4 },     // 南侧草地（东）
];

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
export const gRnd = mulberry32(20260930);
/* ⚠️⚠️ **2026-10-01 曾整层下线**（老黄："把天上飞的几只小鸟去掉，几个小黑点看也
   看不清，还觉得凌乱"），大雁五轮被否的教训：13 只低模雁在 27m 外每只只有 4~10 像素，
   本来就只是几个黑点；"读出队形"还要求用户恰好站在某个方位、恰好赶上换阵那几秒。
   **2026-10-02 老黄又报"春秋两季的大雁也没有了"，拍板恢复**，恢复时一并处理尺寸：
     · 体长 0.30m 在绕园 26m 的航线上仍偏小 ⇒ 整体再放大 **1.4×**
       （体长 ~0.42m、翼展 ~0.84m —— 翼展是远观认雁的关键，宁可翅大）；
     · 航线/高度/阵型沿用下线前的最终值（绕园大圈 26m、高 10~13m、人字 < / 八字 S）。
   再下线一次的话：把 GN 改回 0 即可（装配循环与季节通道 gooseShow 都还在）。 */
export const GN = 13;                                   // 2026-10-01 曾置 0 下线，2026-10-02 按老黄要求恢复
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
export const GOOSE_ALT = [19, 21];
/* 队首初始位置（**必须在雁的装配循环之前声明**）——
   2026-09-30 二轮踩过 TDZ：下面雁的初始位置要用它，而 GOOSE 对象在循环之后才声明
   ⇒ "Cannot access 'GOOSE' before initialization"、整页崩。
   第九轮起这里只是"波次起点"（模块期 gooseStartWave() 会按 dirSign 重置）。 */
export const GOOSE_HEAD = new THREE.Vector3(-85, 23, -6);
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
export function gooseSlot(form, i){
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
export const GOOSE_LINE = { x0: -95, x1: 95, z: -20, speed: 6.0 };
export function gooseStartWave(){
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
export const bRnd = mulberry32(20260931);
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
export const BIRD_PALETTE = [
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
export const ROCK_BIRD_PALETTE = [
  /* ① 乌鸫     */ { base:0x4A3B2C, head:0x241C14 },
  /* ② 红尾鸲   */ { base:0x8C5A40, head:0x3A2E24 },
  /* ③ 黑喉石鵖 */ { base:0x75634E, head:0x2A2723 },
];
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
export const ROCK_SPOTS = [
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
export const GRASS_SPOTS = [
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
export const N_ROCK_BIRD = 0;
export const N_GRASS_BIRD = 0;
export const BIRD_CAP = 9;                    // 原"石上 3 + 草上 6"的容量，固定不动
let smallBirdMesh;   /* 赋值在 08c 的 buildAquatic 里；模块导入绑定只读，故走 setter */
export function setSmallBirdMesh(m){ smallBirdMesh = m; }
/* 观感放大：真实小鸟体长 0.115m，20m 外只有几个像素。园林是"看整体氛围"的场景，
   放大到 ~2.2 倍（体长约 0.25m，站在石台上仍远小于 1.6m 的点景人物，尺度不违和）。
   ⚠️ 2026-10-02 再放大到 **5.0 倍（体长约 0.58m，像一只大斑鸠）**：3.3 倍那版
   老黄实拍"一只都看不到，只在草地上找到一只"—— 一半是落点被山挡（见 ROCK_SPOTS），
   一半是尺寸：默认机位距假山 ~34m，0.38m 的鸟只有 ~8px；挪到直视可见的西平台后
   默认机位距离缩短 ~2m 仍远，放大到 0.58m ⇒ 默认机位 ~13px、池边（~17m）~24px，
   加上踱步/啄毛动作可以读到"假山上有几只鸟"。0.58m 比点景人物（1.6m）的 1/3 略小，
   尺度仍不破。嫌大一句话回调。 */
export const BIRD_SCALE = 5.0;
/* 落脚高度补偿：几何原点在**体心**，直接放在石面高度上 ⇒ 半个身子陷进石头。
   体半高 0.030 × 5.0 = 0.15m，再留一点"站在石上"的观感余量 ⇒ +0.17m。
   （⚠️ 放大倍率改了这里必须跟着改 —— 3.3× 时是 0.08，5.0× 忘改就会陷进石头 7cm。） */
export const BIRD_FOOT_LIFT = 0.17;
/* 每只鸟的状态（世界坐标 + 行为相位），随机流独立 */
export const birdState = [];
export const _bm = new THREE.Matrix4();
export const _bp = new THREE.Vector3();
export const _bq = new THREE.Quaternion();
export const _bs = new THREE.Vector3();
/* 每只鸟的行为推进；返回它当前的 (x,y,z,yaw) */
export function birdStep(b, dt, t, i){
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
/* 2026-10-27 复核 C1：原来每只鸟每帧 new 3 个对象（轴向量 ×2 + 四元数），
   全部挪模块级复用 —— 当前鸟数为 0 零成本，但恢复鸟数前这里是每帧 3N 个。 */
const _bUpY = new THREE.Vector3(0, 1, 0);
const _bAxisX = new THREE.Vector3(1, 0, 0);
const _bq2 = new THREE.Quaternion();
export function updateSmallBirds(dt, t){
  for (let i = 0; i < birdState.length; i++){
    const b = birdState[i];
    const p = birdStep(b, dt, t, i);
    _bp.set(p.x, p.y, p.z);
    _bq.setFromAxisAngle(_bUpY, p.yaw);
    _bs.setScalar(BIRD_SCALE);
    if (p.peck || p.preen){ /* 啄/啄毛：轻微前倾（preen 是石上鸟低头理羽） */
      _bq.multiply(_bq2.setFromAxisAngle(_bAxisX, 0.5));
    } else if (p.flap){ /* 抖翅（石上休息的鸟偶尔理羽毛）：小翅张开一点 */
      _bq.multiply(_bq2.setFromAxisAngle(_bAxisX, -p.flap));
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
