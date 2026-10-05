// 14-props: 园林陈设（物）—— 石桌石凳 / 古琴 / 盆景花几 / 缸 / 香炉 / 竹帘 / 文房 / 卷轴挂画
//            / 古井 / 花街铺地（后两件 = 2026-10-05「③ 景」批：低调、不抢构图的两件"有人住过"）
//
// 为什么单独一个模块：这十件与「建筑 / 植被 / 水体 / 地面」是并列的一类（陈设），
// 塞进 08-assemble 会让那个文件继续膨胀（已 2200 行）。本模块只导出**几何工厂**，
// 落点与摆放由 08 调 buildProps() 一次性完成 —— 与 04-buildings / 06-vegetation 同构。
//
// ⚠️ 三条本项目红线（新增静态物件时必须重申，2026-10-03 计划书 §D-5）：
//   ① **全局随机流守恒**：布局抖动一律走本模块**私有**种子流 `PR`（mulberry32），
//      绝不碰全局 rnd()/rr()/Math.random() —— 否则其后所有抽样整体前移、全园布局漂且不报错。
//   ② **layout-fingerprint 基线**：本批是普通 Mesh（会被 mergeStatics 并进静态大网），
//      不进指纹；但**若将来改成 InstancedMesh，必须 --update-baseline**。
//   ③ **天气/季节名单**：新材质若要在雪里变白/雨里变亮，必须 registerWeatherRoles 登记，
//      否则"写了加成也不生效"（竹竿 0.85 加成曾是死代码的先例）。
import { THREE, mergeGeometries } from '../vendor.js';
import { mesh, box } from './03-factory.js';
import { MAT, registerWeatherRoles, makeGoBoardTex } from './01-materials.js';
import { groundHeight } from './05-water.js';
import { mulberry32 } from './00-config.js';

/* 私有抖动流：只用于"同一件陈设内部的细微不齐"（凳子方位微差、盆景枝叶错落）。
   用固定种子 ⇒ 每次刷新完全一致，且不消耗全局流。 */
const PR = mulberry32(20261005);
const jr = (a) => (PR() - 0.5) * 2 * a;
const TAU3 = Math.PI * 2 / 3;                 // 三弯腿的均分角

/* ── 陈设专用材质 ──
   三件新材质都走 registerWeatherRoles 登记：陈设都在户外，
   雪要积在白瓷与青瓷上、雨要把它们打亮（否则"下雪时桌上那只茶壶还是干的"）。 */
MAT.porcelain = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0xE7ECE5, roughness: 0.24, metalness: 0.0, envMapIntensity: 0.95 }), { snow: 1, wet: 1 });
MAT.celadon   = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0x9DB49F, roughness: 0.30, metalness: 0.0, envMapIntensity: 0.90 }), { snow: 1, wet: 1 });
/* ⚠️ 缸体必须**单独一份**双面材质，不能就地改 MAT.celadon.side ——
   那是共享材质，改它会把全场的青瓷一起翻成双面（盆景盆/棋钵/茶具全中招）。
   缸的口沿往外翻、单面渲染时从缸内侧能看穿，所以这一份用 DoubleSide。 */
MAT.celadonVat = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0x93A996, roughness: 0.32, metalness: 0.0, envMapIntensity: 0.90,
  side: THREE.DoubleSide }), { snow: 1, wet: 1 });
/* 缸里那汪水：静止不动，所以不吃水面那套 Reflector（缸太小、反射没有收益），
   只给高 envMapIntensity 让它映天光 —— 低档位也有环境贴图，不会变黑。 */
MAT.vatWater  = new THREE.MeshStandardMaterial({
  color: 0x2C4A3E, roughness: 0.10, metalness: 0.0, envMapIntensity: 1.20 });
/* 竹帘材质 MAT.bambooBlind 定义在 01-materials.js。
   ⚠️ 它登在 12-env 的 SEASON_PRESENCE 表里，而那张表在 12-env 的**模块求值期**就抓材质，
   12-env 又先于本模块求值 ⇒ 定义写在这里会让建表那一刻抓到 undefined、竹帘的季节通道
   静默失效（春不挂/冬不撤，实测过）。凡是要登进那张表的材质，一律放 01-materials.js，
   理由与来龙去脉写在那边这三份的注释里。 */
/* 香炉/铜器：铜绿斑驳（金属度给足才读得出"铜"，但不能高到低档无反射时发黑 ——
   同 Macaw 的教训，0.55 是"有金属感又能被漫反射托住"的档）。 */
MAT.bronze    = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0x8A7048, roughness: 0.46, metalness: 0.55, envMapIntensity: 1.0 }), { snow: 1, wet: 1 });
/* 棋盘面：木纹 + 19 路棋路 + 九星，烘在一张小 canvas 上（512×490，1 个 draw call）。
   ⚠️ 原先这里刻意"不为此加贴图"（理由是 19 路在 15m 外读不出来）；2026-10-04 的近景
   复核推翻了它 —— 桌前的近景里棋盘就是一块光板，"这是一副棋"读不出来。补的是**贴图**
   而不是 38 根线条几何：线条要靠 0.003m 宽的 box 拼，近景会锯齿、还有共面 z-fighting 风险；
   一张贴图既干净又只多一个 draw call。棋盘是户外陈设，照旧登记天气角色。 */
MAT.goBoardFace = registerWeatherRoles(new THREE.MeshStandardMaterial({
  map: makeGoBoardTex(), roughness: 0.62, metalness: 0.0, envMapIntensity: 0.55 }), { snow: 1, wet: 1 });

/* ── 古井 / 花街铺地的四份专用材质（2026-10-05 ·「③ 景」批）──
   一律**新建**而不是就地改共享材质（理由同上面 MAT.celadonVat 那条注释：改 MAT.stone
   会把石桌/香炉座/缸纹带一起改掉），四份全部 registerWeatherRoles 登记 ——
   井台井圈是石头、铺装是铺地，雨里该亮、雪里该白（铁律 3）。
   用量都很小（各 1~2 个网格），代价是个位数 draw call。 */
/* 井圈石：青石（比 MAT.stone 冷、比 stoneDark 略偏绿），刻意压暗一点 ——
   井是"看不必看、余光里有"的东西，不该比旁边的石桌更亮。 */
MAT.wellStone = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0x87897F, roughness: 0.92, metalness: 0.03, envMapIntensity: 0.45 }), { snow: 1, wet: 1 });
/* 花街铺地的底灰：卵石之间的灰浆。**必须比卵石暗**，暗了才读得出"一粒粒嵌在灰里"；
   底灰与卵石同明度时，整条铺地在近景里就是一块带麻点的平板。 */
MAT.paveBed = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0x5E6058, roughness: 0.96, metalness: 0.02, envMapIntensity: 0.35 }), { snow: 1, wet: 1 });
/* 卵石两色（暖 / 冷）—— 花街的"拼花"全靠这两色交替，各占一个材质桶。 */
MAT.pebbleWarm = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0xB8AE9A, roughness: 0.80, metalness: 0.02, envMapIntensity: 0.45 }), { snow: 1, wet: 1 });
MAT.pebbleCool = registerWeatherRoles(new THREE.MeshStandardMaterial({
  color: 0x7E847C, roughness: 0.80, metalness: 0.02, envMapIntensity: 0.45 }), { snow: 1, wet: 1 });

/* ══════════════════════════════════════════════════════════════
   ① 石桌 + 石凳 + 棋盘 + 茶具
   ══════════════════════════════════════════════════════════════
   尺寸按真实江南园林石桌推：桌面径 1.24m、高 0.72m（坐面 0.42m，凳面到桌面 0.30m）。
   ⚠️ 全套用**同一批材质**（MAT.stone / stoneDark / woodDark / porcelain）
   ⇒ mergeStatics 会把它们并进那几个材质桶，只增加个位数 draw call。 */
/* 四张石凳的**坐面世界落位**（由 makeStoneTableSet 填），供 08 的坐姿人物精确落座。
   ⚠️ 必须在函数**里面**记，不能在 08 里按"45°/225° × r=1.02"重算 —— 下面那两行 jr 抖动
   （±0.07rad / ±0.04m）会让重算的位置与真凳子差到 7cm，近景里就是"人坐在凳子边沿外"。
   每项 yaw = "面朝桌心"的朝向（人物正面约定为 +z，与 08 的 makeScholar 一致）。 */
export const SEAT_SPOTS = [];
/* 石凳的坐面世界落位（琴凳另见 QIN_SEAT）。坐面高 = STOOL_PROF 的顶面 0.452，
   与 08 里坐姿人物的 SEAT_H 是**同一个数**：改轮廓必须同步改 SEAT_H。 */
export const QIN_SEAT = [];
/* 鼓凳轮廓（石桌四张 + 水榭琴凳共用一份）——顶面 y = 0.452。
   ⚠️ LatheGeometry 是一张**开口的旋转壳**：轮廓首尾必须落到轴心（r=0）才能封底/封顶。
   第一版轮廓从 r=0.145 起到 r=0.212 止，上下都是敞口 —— 从上方看进去，单面材质的背面
   被剔除，直接穿透到草地，凳面就成了"黑窟窿"，四张凳子读成一排白碗（2026-10-04 出图复核）。 */
const STOOL_PROF = [
  [0.000, 0.000], [0.145, 0.000], [0.200, 0.030], [0.222, 0.115], [0.228, 0.210],
  [0.221, 0.310], [0.204, 0.385], [0.196, 0.425], [0.212, 0.445],
  [0.150, 0.452], [0.000, 0.452],
].map(([r, h]) => new THREE.Vector2(r, h));
export function makeStoneTableSet(x, z, yaw = 0){
  const g = new THREE.Group();
  const y = groundHeight(x, z);
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  /* 桌：柱础 → 柱身 → 桌面 */
  const base = mesh(new THREE.CylinderGeometry(0.30, 0.40, 0.12, 16), MAT.stoneDark, { name:'propTableBase' });
  base.position.y = 0.06; g.add(base);
  const ped = mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.50, 14), MAT.stone, { name:'propTablePed' });
  ped.position.y = 0.37; g.add(ped);
  const top = mesh(new THREE.CylinderGeometry(0.62, 0.58, 0.10, 28), MAT.stone, { name:'propTableTop' });
  top.position.y = 0.67; g.add(top);
  const topEdge = mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.035, 28), MAT.stoneDark, { name:'propTableEdge', cast:false });
  topEdge.position.y = 0.63; g.add(topEdge);

  /* 四张**鼓凳**：方位给 45° 起手 + 逐张微抖（真实园林的凳子不会摆成正南北）。
     ⚠️ 形状必须是"鼓腹"而不是直筒 —— 直筒 + 顶板 + 底板在近景里读成"柱础"而不是凳子
     （2026-10-04 复核）。鼓凳的两个识别特征：① 腰腹外鼓、上下收口；② 腰间一圈鼓钉。 */
  const stoolGeo = new THREE.LatheGeometry(STOOL_PROF, 20);   // 四张共用一份几何（轮廓见模块级 STOOL_PROF）
  const nailGeo  = new THREE.SphereGeometry(0.024, 8, 6);
  for (let i = 0; i < 4; i++){
    const a = Math.PI / 4 + i * Math.PI / 2 + jr(0.07);
    const r = 1.02 + jr(0.04);
    const sx = Math.cos(a) * r, sz = Math.sin(a) * r;
    const st = mesh(stoolGeo, MAT.stone, { name:'propStool' });
    st.position.set(sx, 0, sz); g.add(st);
    /* 记下这张凳子的坐面世界落位（含上面的抖动）—— 见文件上方 SEAT_SPOTS 的说明。
       映射：点 (sx,sz) 经 rotation.y=yaw ⇒ 世界偏移 (sx·cy+sz·sy, −sx·sy+sz·cy)；
       朝向取"凳子→桌心"（局部 (−cos a, −sin a)）旋转到世界。 */
    {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const fdx = (-Math.cos(a)) * cy + (-Math.sin(a)) * sy;
      const fdz = -(-Math.cos(a)) * sy + (-Math.sin(a)) * cy;
      SEAT_SPOTS.push({ x: +(x + sx * cy + sz * sy).toFixed(4),
                        z: +(z - sx * sy + sz * cy).toFixed(4),
                        y: +y.toFixed(4),
                        yaw: +Math.atan2(fdx, fdz).toFixed(4) });
    }
    /* 鼓钉：腰腹最鼓处（h 0.215、r 0.228）一圈 8 颗小圆钮。
       用小球而不是扁圆盘 —— 盘要按径向定向（圆柱轴从 +Y 转到水平要多绕两道），
       小球不用定向、近景同样是"一粒粒"，省下的复杂度换不到观感。 */
    for (let k = 0; k < 8; k++){
      const na = k * (Math.PI / 4) + 0.19;
      const nail = mesh(nailGeo, MAT.stoneDark, { name:'propStoolNail', cast:false });
      nail.position.set(sx + Math.cos(na) * 0.222, 0.215, sz + Math.sin(na) * 0.222);
      g.add(nail);
    }
  }

  /* 棋盘（围棋 19 路）：木胎 + 盘面（19 路棋路 + 九星烘在贴图上）。
     ⚠️ 盘面贴图取代了原先那块"浅色木片"—— 光板在近景里读不出"这是一副棋"
     （2026-10-04 复核推翻了本节原先"不许为此加贴图"的取舍，理由见 01-materials
     的 makeGoBoardTex 注释：线条几何会锯齿 + 共面 z-fighting，贴图更干净）。 */
  const bd = mesh(box(0.46, 0.040, 0.44), MAT.woodDark, { name:'propGoBoard', cast:false });
  bd.position.set(-0.14, 0.740, 0.02);
  bd.rotation.y = 0.12;
  g.add(bd);
  const bdFace = mesh(box(0.43, 0.006, 0.41), MAT.goBoardFace, { name:'propGoBoardFace', cast:false });
  bdFace.position.set(-0.14, 0.763, 0.02);
  bdFace.rotation.y = 0.12;
  g.add(bdFace);

  /* 两只棋钵：⚠️ 必须挪到棋盘**右侧的桌面**上 —— 原先摆在 (0.10,0.22)/(0.04,0.08)，
     那两个点落在棋盘占地内（盘面 x∈[−0.35,0.09]），钵底 0.726~0.788 正穿过盘面
     y 0.760~0.766，近景里就是"棋钵扎在棋盘里"。桌面半径 0.62 ⇒ 右侧 x 0.09~0.62 全空。 */
  for (const [bx, bz] of [[0.34, 0.10], [0.30, -0.16]]){
    const bowl = mesh(new THREE.CylinderGeometry(0.072, 0.060, 0.062, 14), MAT.celadon, { name:'propGoBowl', cast:false });
    bowl.position.set(bx, 0.751, bz);
    g.add(bowl);
  }

  /* 茶具：一壶两盏（青白瓷）。棋盘占 x∈[−0.37,0.09]、z∈[−0.20,0.24]，棋钵占 x≈0.23~0.41；
     所以茶具整体摆到棋盘**外侧的前缘空位**（z < −0.20），与棋盘/棋钵都不互穿。
     桌面面高 0.72 ⇒ 壶心 0.790、盏心 0.752（骑在盏托 0.724 上）。 */
  const pot = mesh(new THREE.SphereGeometry(0.085, 14, 10), MAT.porcelain, { name:'propTeapot', cast:false });
  pot.scale.set(1.0, 0.82, 1.0);
  pot.position.set(-0.30, 0.790, -0.34); g.add(pot);
  const lid = mesh(new THREE.CylinderGeometry(0.026, 0.030, 0.020, 10), MAT.porcelain, { name:'propTeapotLid', cast:false });
  lid.position.set(-0.30, 0.860, -0.34); g.add(lid);
  const spout = mesh(new THREE.CylinderGeometry(0.013, 0.020, 0.10, 8), MAT.porcelain, { name:'propTeapotSpout', cast:false });
  spout.position.set(-0.385, 0.812, -0.34);
  spout.rotation.z = Math.PI / 2 - 0.42;
  g.add(spout);
  for (const [cx, cz] of [[-0.06, -0.44], [-0.44, -0.20]]){
    const cup = mesh(new THREE.CylinderGeometry(0.043, 0.032, 0.048, 12), MAT.porcelain, { name:'propTeaCup', cast:false });
    cup.position.set(cx, 0.752, cz); g.add(cup);
    const saucer = mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.008, 12), MAT.porcelain, { name:'propTeaSaucer', cast:false });
    saucer.position.set(cx, 0.724, cz); g.add(saucer);
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ② 古琴 + 琴桌（水榭内，临水抚琴）
   ══════════════════════════════════════════════════════════════
   ⚠️ 落点 y 必须**显式给**（水榭台基顶面），不吃 groundHeight —— 台基是浮在地形上的
   独立网格，走地形公式会陷进去 0.62m（2026-10-04 品茗的人踩过这个坑，见 08 的
   PAV_FLOOR_Y 注释）。所以本函数第二组参数收 y。 */
export function makeQinSet(x, z, y, yaw = 0){
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  /* 琴桌：条案式（面板 + 四腿 + 前后枨）。桌面高 **0.72**（台基面以上）——
     ⚠️ 2026-10-05 从 0.62 抬到 0.72：0.62 是照"站在桌前"配的，而抚琴**必须坐着**，
     坐姿的大腿顶面在 0.598（见 08 makeSeatedScholar），而 0.62 桌面下沿只有 0.55
     ⇒ 膝盖整个穿进桌面里。0.72 与石桌同高、也是正常书案高度（椅面 0.45 配桌面 0.72），
     改后桌面下沿 0.65、离大腿顶 0.052。**08 里抚琴的手位按 0.7905 的弦高算，必须同步。** */
  const top = mesh(box(1.42, 0.070, 0.46), MAT.wood, { name:'propQinTableTop' });
  top.position.y = 0.685; g.add(top);
  const topEdge = mesh(box(1.46, 0.022, 0.50), MAT.woodDark, { name:'propQinTableEdge', cast:false });
  topEdge.position.y = 0.648; g.add(topEdge);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]){
    const leg = mesh(box(0.058, 0.650, 0.058), MAT.wood, { name:'propQinTableLeg' });
    leg.position.set(sx * 0.62, 0.325, sz * 0.16); g.add(leg);
  }
  for (const sz of [-1, 1]){
    const st = mesh(box(1.20, 0.045, 0.045), MAT.wood, { name:'propQinTableStretcher', cast:false });
    st.position.set(0, 0.26, sz * 0.16); g.add(st);
  }

  /* 古琴：通长 1.22m、额宽 0.20 尾宽 0.14、厚 0.055。做成"尾端收窄"的两截，
     不是一块方板 —— 收窄是琴最好认的剪影特征（远看就是一个"束腰的长条"）。 */
  const body = mesh(box(0.86, 0.055, 0.20), MAT.woodDark, { name:'propQinBody' });
  body.position.set(-0.18, 0.748, 0); g.add(body);
  const tail = mesh(box(0.36, 0.052, 0.15), MAT.woodDark, { name:'propQinTail' });
  tail.position.set(0.43, 0.7465, 0); g.add(tail);
  /* 岳山/龙龈（两端承弦的木条）+ 七弦。弦在 15m 外不足 1px，但近景特写要能读出"弦"。 */
  const yue = mesh(box(0.030, 0.020, 0.20), MAT.wood, { name:'propQinYue', cast:false });
  yue.position.set(-0.575, 0.785, 0); g.add(yue);
  const yin = mesh(box(0.030, 0.018, 0.15), MAT.wood, { name:'propQinYin', cast:false });
  yin.position.set(0.588, 0.782, 0); g.add(yin);
  for (let i = 0; i < 7; i++){
    const s = mesh(box(1.16, 0.004, 0.004), MAT.porcelain, { name:'propQinString', cast:false });
    s.position.set(0.006, 0.7905, -0.072 + i * 0.024);
    g.add(s);
  }
  /* 琴凳（2026-10-05 补）：抚琴必须**坐**着，而琴桌原来只有桌、没有座。
     用与石桌四张**同一个鼓凳轮廓**做，摆在琴桌的 +z 侧（本组 yaw=π/2 ⇒ 世界 −x 侧），
     即"人朝池面坐、琴在人与池之间"—— 临水抚琴。坐面高仍 0.452，落在水榭台基面 y 上。
     落位记进 QIN_SEAT 供 08 的坐姿人物精确落座（同 SEAT_SPOTS 的纪律：不在外面重算）。 */
  const qstool = mesh(new THREE.LatheGeometry(STOOL_PROF, 20), MAT.stone, { name:'propQinStool' });
  qstool.position.set(0, 0, 0.48);
  g.add(qstool);
  {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const fdx = -sy, fdz = -cy;                 // 局部"凳→桌心" = (0,−1) 旋转到世界
    QIN_SEAT.push({ x: +(x + 0.48 * sy).toFixed(4), z: +(z + 0.48 * cy).toFixed(4),
                    y: +y.toFixed(4), yaw: +Math.atan2(fdx, fdz).toFixed(4) });
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ③ 盆景 + 花几（游廊沿廊）
   ══════════════════════════════════════════════════════════════
   ⚠️ y 同样显式给（游廊廊道铺装是平的，实测该段 −0.08~+0.07，取 0 比跟地形准 ——
   与 08 里夜步人物的取舍同款理由）。 */
export function makeFlowerStand(x, z, y, yaw = 0, variant = 0){
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  /* 花几：独挺式（面板 + 束腰 + 一根腿nos + 三弯腿底座）
     真实花几是"高瘦"的：面板 0.42、通高 0.78 —— 高瘦才好衬盆景。 */
  const panel = mesh(box(0.42, 0.055, 0.42), MAT.woodDark, { name:'propStandPanel' });
  panel.position.y = 0.755; g.add(panel);
  const waist = mesh(box(0.34, 0.055, 0.34), MAT.wood, { name:'propStandWaist', cast:false });
  waist.position.y = 0.700; g.add(waist);
  const col = mesh(new THREE.CylinderGeometry(0.055, 0.070, 0.60, 10), MAT.woodDark, { name:'propStandColumn' });
  col.position.y = 0.375; g.add(col);
  for (let i = 0; i < 3; i++){                       // 三弯腿（三条外撇的小腿）
    const a = i * TAU3 + 0.4 + jr(0.06);
    const foot = mesh(box(0.055, 0.16, 0.055), MAT.woodDark, { name:'propStandFoot', cast:false });
    foot.position.set(Math.cos(a) * 0.15, 0.075, Math.sin(a) * 0.15);
    foot.rotation.set(Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22);
    g.add(foot);
  }
  const ring = mesh(new THREE.TorusGeometry(0.145, 0.016, 6, 16), MAT.wood, { name:'propStandRing', cast:false });
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.135; g.add(ring);

  /* 盆景：浅盆 + 一株"缩地成寸"的小树（干 + 2~4 团枝叶）。
     variant 0 = 松（针叶团、深绿，三层错落）／1 = 花（一团浅色花冠，配叶）。 */
  const pot0 = mesh(new THREE.CylinderGeometry(0.145, 0.118, 0.105, 14), MAT.celadon, { name:'propBonsaiPot' });
  pot0.position.y = 0.835; g.add(pot0);
  const rim = mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.018, 14), MAT.celadon, { name:'propBonsaiRim', cast:false });
  rim.position.y = 0.888; g.add(rim);
  const soil = mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.012, 12), MAT.rockDark, { name:'propBonsaiSoil', cast:false });
  soil.position.y = 0.893; g.add(soil);

  const trunkH = variant === 0 ? 0.30 : 0.22;
  const trunk = mesh(new THREE.CylinderGeometry(0.014, 0.024, trunkH, 8), MAT.trunk, { name:'propBonsaiTrunk' });
  trunk.position.set(jr(0.02), 0.899 + trunkH / 2, jr(0.02));
  trunk.rotation.z = jr(0.16);
  g.add(trunk);
  const nBlob = variant === 0 ? 3 : 2;
  for (let i = 0; i < nBlob; i++){
    const s = 0.085 - i * 0.016;
    const blob = mesh(new THREE.SphereGeometry(s, 10, 8),
      variant === 0 ? MAT.leafDeep : MAT.leaf, { name:'propBonsaiLeaf', cast:false });
    blob.scale.set(1.25, 0.62, 1.15);                 // 压扁 ⇒ 读成"云片"而不是球
    blob.position.set(jr(0.055), 0.899 + trunkH + i * 0.055 + jr(0.02), jr(0.055));
    g.add(blob);
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ④ 缸（养莲 / 养鱼）
   ══════════════════════════════════════════════════════════════
   江南庭院必有：庙前、天井、堂前两侧。用 LatheGeometry 车一个"大肚收口"的缸 ——
   关键在**口沿外撇**（直筒会读成水桶），所以轮廓最后一段要向外翻。
   ⚠️ y 和 makeQinSet / makeFlowerStand 同构，**必须显式给**：堂前那两口缸站在月台面上
   （铺装顶面 1.30），不是地形面上（那里 groundHeight ≈ −0.23）。原先本函数自己调
   groundHeight ⇒ 缸被放到月台底下/台基外沿，画面里只剩"草坪边一块半埋的绿东西"
   （2026-10-04 复核）。登记表里写 1.30、几何却用 −0.23，这种"表和实物不一致"是
   最坏的一类 bug：门禁按表复核会全绿，眼睛看画面才发现。 */
export function makeWaterVat(x, z, y, yaw = 0, withLotus = true){
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  const R = 0.44, H = 0.62;
  const prof = [
    [0.20, 0.00], [0.28, 0.03], [0.36, 0.11], [0.42, 0.26],
    [0.44, 0.42], [0.43, 0.52], [0.42, 0.58], [0.47, 0.62],   // 口沿外撇
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const body = mesh(new THREE.LatheGeometry(prof, 24), MAT.celadonVat, { name:'propVatBody' });
  g.add(body);
  /* 缸内水面：缸太小，走 Reflector 不划算（一个缸一次全场景镜像 pass）；
     用高 envMapIntensity 的静止水面 —— 低档位也有环境贴图 ⇒ 不会像旧版池水那样发黑。 */
  const wsurf = mesh(new THREE.CircleGeometry(0.405, 20), MAT.vatWater, { name:'propVatWater', cast:false });
  wsurf.rotation.x = -Math.PI / 2;
  wsurf.position.y = H - 0.10;
  g.add(wsurf);
  /* 缸沿下一圈回纹带（暗示"这是有讲究的缸"，不是水桶） */
  for (let i = 0; i < 8; i++){
    const a = i * (Math.PI * 2 / 8) + 0.2;
    const t = mesh(box(0.05, 0.09, 0.016), MAT.stoneDark, { name:'propVatBand', cast:false });
    t.position.set(Math.cos(a) * 0.448, 0.50, Math.sin(a) * 0.448);
    t.rotation.y = -a + Math.PI / 2;
    g.add(t);
  }
  if (withLotus){
    /* 缸养睡莲：3~4 片小圆叶浮在水面（与池里的叶盘同一套观感，尺度缩到缸里） */
    for (let i = 0; i < 4; i++){
      const a = i * 1.9 + jr(0.5), r = 0.06 + i * 0.055 + jr(0.03);
      const pad = mesh(new THREE.CircleGeometry(0.085 - i * 0.008, 12), MAT.lily, { name:'propVatPad', cast:false });
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = jr(1.0);
      pad.position.set(Math.cos(a) * r, H - 0.085 + jr(0.006), Math.sin(a) * r);
      g.add(pad);
    }
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ⑤ 香炉（堂前中轴）
   ══════════════════════════════════════════════════════════════
   三足鼎式：石座 + 三足 + 炉身（口沿外撇）+ 双耳 + 鼎盖（带宝顶）。
   落点在堂前中轴地上，与匾额/对联成一条礼仪轴。 */
export function makeCenser(x, z, yaw = 0){
  const g = new THREE.Group();
  const y = groundHeight(x, z);
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  /* ⚠️ 石座必须**深色 + 矮**：原先是一截 0.30 高的 MAT.stone（0xB2B0A6，浅）圆柱，
     近景里就是"一根又亮又高的白墩子"，比上面那只铜炉还抢眼（2026-10-04 复核）。
     改成 stoneDark 的三叠束腰石座（总高 0.18）；座顶 0.18 ⇒ 三足站上去、bodyY 随之 0.30。 */
  const pedLow = mesh(new THREE.CylinderGeometry(0.25, 0.31, 0.09, 8), MAT.stoneDark, { name:'propCenserPedLow' });
  pedLow.position.y = 0.045; g.add(pedLow);
  const pedWaist = mesh(new THREE.CylinderGeometry(0.20, 0.25, 0.05, 8), MAT.stoneDark, { name:'propCenserPedWaist', cast:false });
  pedWaist.position.y = 0.115; g.add(pedWaist);
  const pedTop = mesh(new THREE.CylinderGeometry(0.24, 0.20, 0.04, 8), MAT.stoneDark, { name:'propCenserPedTop', cast:false });
  pedTop.position.y = 0.16; g.add(pedTop);

  /* bodyY 0.30 = 座顶 0.18 + 足高 0.14 − 0.02 重叠 ⇒ 足踩座、身坐足，中间不留缝 */
  const bodyY = 0.30;
  const prof = [
    [0.02, 0.00], [0.13, 0.01], [0.19, 0.08], [0.215, 0.19],
    [0.22, 0.30], [0.23, 0.36], [0.265, 0.40],          // 口沿外撇
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const body = mesh(new THREE.LatheGeometry(prof, 20), MAT.bronze, { name:'propCenserBody' });
  body.position.y = bodyY; g.add(body);
  /* 三足：向外微撇的圆柱（鼎足是"承重"的形，不能像蜡烛柱）。
     足高 0.14、中心 0.25 ⇒ 跨 0.18~0.32，正好从座顶踩到炉身下沿。 */
  for (let i = 0; i < 3; i++){
    const a = 0.5 + i * TAU3;
    const leg = mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.14, 8), MAT.bronze, { name:'propCenserLeg' });
    leg.position.set(Math.cos(a) * 0.135, 0.25, Math.sin(a) * 0.135);
    leg.rotation.set(Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12);
    g.add(leg);
  }
  /* 双耳：口沿上两个立耳 */
  for (const sx of [-1, 1]){
    const ear = mesh(box(0.028, 0.10, 0.062), MAT.bronze, { name:'propCenserEar', cast:false });
    ear.position.set(sx * 0.20, bodyY + 0.445, 0);
    ear.rotation.z = -sx * 0.14;
    g.add(ear);
  }
  /* 鼎盖 + 宝顶（盖压口沿之上，让"这是个炉"一眼成立） */
  const lid = mesh(new THREE.CylinderGeometry(0.255, 0.268, 0.030, 20), MAT.bronze, { name:'propCenserLid' });
  lid.position.y = bodyY + 0.415; g.add(lid);
  const dome = mesh(new THREE.SphereGeometry(0.195, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.bronze, { name:'propCenserDome', cast:false });
  dome.scale.set(1, 0.62, 1);
  dome.position.y = bodyY + 0.428; g.add(dome);
  const knob = mesh(new THREE.SphereGeometry(0.045, 10, 8), MAT.bronze, { name:'propCenserKnob', cast:false });
  knob.position.y = bodyY + 0.565; g.add(knob);
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ⑥ 竹帘（水榭 / 游廊檐下；夏季挂、冬撤）
   ══════════════════════════════════════════════════════════════
   局部坐标约定：帘面在 XY 平面内、法线朝 +Z；组按 yaw 转向。
   ⚠️ 季节显隐走 12-env 的 SEASON_PRESENCE（键 `blindShow`）—— 帘子的材质必须
   是**共享**的 MAT.bambooBlind，克隆一份就进不了登记表、冬天收不掉
   （莲子/莲蓬踩过三次的老坑，这是第四次重申）。
   帘用**竹篾条**排出来而不是一块平板贴图：条与条之间的缝在侧光下自成明暗，
   近看才像"帘"；条宽 0.042、间距 0.055（远看读成横条纹，近看是一条条竹篾）。 */
/* ── 竹帘升降（2026-10-05 · 老黄："右侧亭子里加的帘子…挡住了里面的人和景，
   是不是加一个帘子可以升起和放下的按钮或者其它什么方式就更加人性化了"）──
   ⚠️ 卷起**不是隐藏**：帘条子组按 Y 缩放（帘条本来就纵向通长，缩放即"变短"），
   底部那捆**卷捆**跟着贴到剩余帘尾 —— 读作"卷上去了"，而不是"消失了"。
   ⚠️ 卷捆是绕 Z 转 90° 放倒的圆柱（轴向 = 世界 X），所以"加粗"只能缩放它的
   **局部 X/Z**，缩放局部 Y 会把帘子卷成一根超出两侧的长棍。 */
const BLINDS = [];                            // { slats, roll, full }
/* 帘子的卷放状态：cur = 画面上实际的位置，target = 目标（0 全垂 / 1 卷起）。
   ── 默认**卷起**（2026-10-05 用户指着水榭那张截图："帘子挡住了里面的人和景"）──
   进页面先看见亭内，要遮阳再按 C / 点「放帘」。
   ⚠️ 默认值必须同时写进 cur：updateBlinds() 在 |target − cur| < 1e-3 时直接 return，
   只设 target 会出现"状态是卷起、画面上却垂着"的假象 —— 所以建帘时必须按 cur 摆一次。 */
const BLIND_ROLL0 = 1;
const _roll = { cur: BLIND_ROLL0, target: BLIND_ROLL0 };
export function setBlindsRoll(r){ _roll.target = Math.max(0, Math.min(1, r)); }
export function toggleBlinds(){
  _roll.target = _roll.target > 0.5 ? 0 : 1;
  return _roll.target > 0.5;
}
export function blindsRolled(){ return _roll.target > 0.5; }
export function blindsRoll(){ return +_roll.cur.toFixed(3); }
/* 把一幅帘摆到卷起程度 r（0 全垂、1 卷到剩一成）。几何上的取舍见上面那段注释。 */
function poseBlind(b, r){
  const sy = 1 - r * 0.90;                    // 只卷到剩一成：全收起会读成"帘子拆了"
  b.slats.scale.y = sy;
  b.roll.position.y = -b.full * sy + 0.02;
  const k = 1 + r * 1.1;
  b.roll.scale.set(k, 1, k);
}
export function updateBlinds(dt){
  const d = _roll.target - _roll.cur;
  if (Math.abs(d) < 1e-3) return;
  _roll.cur += d * Math.min(1, dt * 4.5);
  for (const b of BLINDS) poseBlind(b, _roll.cur);
}

export function makeBambooBlind(len, drop, { yaw = 0, rolled = 0.25 } = {}){
  const g = new THREE.Group();
  g.rotation.y = yaw;
  const n = Math.max(3, Math.round(len / 0.055));
  const full = drop * (1 - rolled * 0.5);     // 帘条通长（Y 缩放的基准）
  /* ⚠️⚠️ 帘条必须**先合并成一个几何**再建网格，而且必须 noMerge。
      本轮实测踩到的坑：43 根独立 Mesh ×5 幅 = 215 个网格，全被 mergeStatics
      并进静态大网（按名字一颗都找不到）⇒ 帘子的世界矩阵被烘死，升降**静默失效**
      （窗口里看不出任何异常，只是"按钮按了没反应"）。
      合并成 1 个网格 + noMerge = 每幅帘多 1 个 draw call（5 幅共 +5），换"真的能卷"。 */
  const slatGeos = [];
  for (let i = 0; i < n; i++){
    const x = -len / 2 + (i + 0.5) * (len / n);
    const gg = box(len / n * 0.80, full, 0.014);
    gg.translate(x, -full / 2, jr(0.006));
    slatGeos.push(gg);
  }
  const slats = mesh(mergeGeometries(slatGeos, false), MAT.bambooBlind, { name:'propBlindSlats', cast:false });
  slats.userData.noMerge = true;              // 要能卷 ⇒ 绝不进静态合并
  g.add(slats);
  /* 上轴（挂帘的横杆）+ 两端轴头 —— 这两件不参与升降，照旧交给 mergeStatics 省 draw call */
  const rod = mesh(new THREE.CylinderGeometry(0.028, 0.028, len + 0.12, 10), MAT.woodDark, { name:'propBlindRod' });
  rod.rotation.z = Math.PI / 2;
  rod.position.y = 0.02; g.add(rod);
  for (const sx of [-1, 1]){
    const cap = mesh(new THREE.SphereGeometry(0.040, 8, 6), MAT.wood, { name:'propBlindRodCap', cast:false });
    cap.position.set(sx * (len / 2 + 0.06), 0.02, 0); g.add(cap);
  }
  /* 卷起的那一捆（帘底）：把"可以卷、现在是垂下的"这件事说清楚；
     它要跟着帘尾走 ⇒ 同样 noMerge。 */
  const roll = mesh(new THREE.CylinderGeometry(0.055, 0.055, len, 10), MAT.bambooBlind, { name:'propBlindRoll', cast:false });
  roll.rotation.z = Math.PI / 2;
  roll.position.y = -full + 0.02;
  roll.userData.noMerge = true;
  g.add(roll);
  const b = { slats, roll, full };
  poseBlind(b, _roll.cur);                    // 建帘即按当前状态摆好（默认卷起，见 _roll 注释）
  BLINDS.push(b);
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ⑦ 文房（笔筒 / 笔架 / 砚 / 卷 + 笔）—— 摆在堂内**已有的**条案上
   ══════════════════════════════════════════════════════════════
   ⚠️ 条案是 04-buildings 里早就有的（altarTable，顶面 y=2.24、2.4×0.52）；
   本函数只做"案上的那几件"，y 由调用方给（= 案面高度），不吃 groundHeight。
   ⚠️ 2026-10-04 复核：原先那版（笔架 + 3 支横笔 + 砚 + 两轴粗瓷卷）在近景里只剩
   "两块白片"—— 粗瓷书卷半径 0.030（= 直径 6cm，比真卷粗一倍）读成白板，笔架又太小。
   现在把**笔筒**做成主角：一支青瓷筒 + 4 支笔头朝上的立笔。立笔的剪影（细杆 + 上端
   一个深色笔头）是"文房"最好认的信号，比任何平放的东西都强。 */
export function makeStationery(x, y, z, yaw = 0){
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  /* ① 笔筒 + 4 支立笔（笔头朝上）。⛔ 不做成一排插满 —— 4 支正好：再多就糊成一丛。 */
  const potH = 0.15;
  const pot = mesh(new THREE.CylinderGeometry(0.058, 0.050, potH, 14), MAT.celadon, { name:'propBrushPot', cast:false });
  pot.position.set(-0.40, potH / 2, 0.02); g.add(pot);
  const potRim = mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 14), MAT.celadon, { name:'propBrushPotRim', cast:false });
  potRim.position.set(-0.40, potH, 0.02); g.add(potRim);
  const LEAN = 0.17, shaftH = 0.235;         // 倾角越小越"立"，0.17rad ≈ 10°
  for (let k = 0; k < 4; k++){
    const ba = 0.6 + k * 1.5;
    const dx = Math.sin(LEAN) * Math.cos(ba), dz = Math.sin(LEAN) * Math.sin(ba);
    /* 立笔：轴心 = 筒口 + 沿倾斜方向推半个杆长。
       rotation.z 管 +X 倾、rotation.x 管 +Z 倾（XYZ 序下小角度的近似，够用）。 */
    const bx = -0.40 + 0.028 * Math.cos(ba), bz = 0.02 + 0.028 * Math.sin(ba);
    const shaft = mesh(new THREE.CylinderGeometry(0.0068, 0.0068, shaftH, 6), MAT.wood, { name:'propBrushStand', cast:false });
    shaft.position.set(bx + dx * shaftH / 2, potH + Math.cos(LEAN) * shaftH / 2 - 0.05, bz + dz * shaftH / 2);
    shaft.rotation.set(dz, 0, -dx);
    g.add(shaft);
    /* 笔头用 MAT.woodDark（暖深褐）而不是 MAT.rockDark（冷蓝灰 0x4A4C4E）：
       后者在近景里会被读成**箭头/矛尖**，不是笔毫（2026-10-04 出图复核）。
       并且要做**细长**（r 0.0105 / 长 0.070 ≈ 杆长的 1/4）：短而钝的锥体无论什么颜色
       都会读成箭镞，细长才会读成"一撮毫"。 */
    const head = mesh(new THREE.ConeGeometry(0.0105, 0.070, 8), MAT.woodDark, { name:'propBrushHead', cast:false });
    head.position.set(bx + dx * (shaftH + 0.033), potH + Math.cos(LEAN) * (shaftH + 0.033) - 0.05, bz + dz * (shaftH + 0.033));
    head.rotation.set(dz, 0, -dx);
    g.add(head);
  }

  /* ② 笔架（笔山）：五峰山形 + 一支搁在架前的笔。
     ⚠️ 两个坑（2026-10-04 出图复核，两次都翻车，记下来免得第三次再试）：
       ① 峰脊沿 X 排开时"山形"最好认；但笔按物理必须**横插进缺口**（轴垂直于脊）⇒
          笔轴正对观者，正面只看得到两个黑点，"架子上的两支笔"完全读不出；
       ② 把整座架子转 90° 让笔横过来 —— 山形反而没了（五个峰前后重叠，正面只见一个
          尖），而横过来的笔加尖头读成了**两支箭**。
     最终取舍：**架子保持沿 X（山形优先）**，笔另搁在架前的案面上、轴也沿 X。
     山形与笔各占一处、互不遮挡 —— 读得出 > 物理上"笔正好落在缺口里"。 */
  const peaks = [0.085, 0.115, 0.135, 0.110, 0.080];
  peaks.forEach((h, i) => {
    const p = mesh(new THREE.ConeGeometry(0.040, h, 6), MAT.stoneDark, { name:'propBrushPeak', cast:false });
    p.position.set(0.02 - 0.16 + i * 0.08, h / 2, 0.14);
    g.add(p);
  });
  const rack = mesh(box(0.44, 0.026, 0.11), MAT.woodDark, { name:'propBrushRack', cast:false });
  rack.position.set(0.02, 0.013, 0.14); g.add(rack);
  /* 搁在架前案面上的一支笔：轴沿 X ⇒ 正面是完整的一支（杆 + 毫） */
  const penShaft = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.30, 6), MAT.wood, { name:'propBrushLie', cast:false });
  penShaft.rotation.z = Math.PI / 2;
  penShaft.position.set(0.02, 0.008, -0.02); g.add(penShaft);
  const penHead = mesh(new THREE.ConeGeometry(0.0100, 0.078, 8), MAT.woodDark, { name:'propBrushLieHead', cast:false });
  penHead.rotation.z = -Math.PI / 2;                 // 尖朝 +X（由 +Y 经 Rz(−90°) 转到 +X）
  penHead.position.set(0.02 + 0.195, 0.008, -0.02); g.add(penHead);

  /* ③ 砚 + 墨：砚板 + 墨池凹窝（凹窝用一块更暗的小平板暗示，不做布尔）+ 墨锭搁在砚缘。
     x 给 0.40：笔架上那两支笔的头（x=0.20）与砚不能撞。 */
  const stone = mesh(box(0.24, 0.036, 0.17), MAT.rockDark, { name:'propInkstone', cast:false });
  stone.position.set(0.40, 0.018, 0.02); g.add(stone);
  const well = mesh(box(0.16, 0.012, 0.11), MAT.winCore, { name:'propInkstoneWell', cast:false });
  well.position.set(0.40, 0.042, 0.02); g.add(well);
  const stick = mesh(box(0.09, 0.013, 0.022), MAT.rockDark, { name:'propInkStick', cast:false });
  stick.rotation.y = 0.08;
  stick.position.set(0.40, 0.0495, 0.093); g.add(stick);

  /* ④ 书卷：细轴横放（半径 0.019 ≈ 真实卷径 4cm）。
     上一版用 0.030 的粗瓷筒，近景里就是"白板"—— 粗一倍直径，读感就完全不是卷了。
     x 给 −0.26：近侧轴头（−0.10）与笔架的座板（x≥−0.035）互不侵。 */
  const roll = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.30, 10), MAT.porcelain, { name:'propScrollRoll', cast:false });
  roll.rotation.z = Math.PI / 2;
  roll.position.set(-0.26, 0.019, -0.15); g.add(roll);
  for (const sx of [-1, 1]){
    const knob = mesh(new THREE.SphereGeometry(0.026, 8, 6), MAT.woodDark, { name:'propScrollRollKnob', cast:false });
    knob.position.set(-0.26 + sx * 0.156, 0.019, -0.15); g.add(knob);
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ⑧ 卷轴挂画（堂内墙面）
   ══════════════════════════════════════════════════════════════
   局部坐标：画心在 XY 平面内、**法线朝 +Z**（贴墙时给 yaw 让它朝室内）。
   ⚠️ "随季节换画"用**两套材质 + 存在性通道**实现（不是运行时换 map）：
     scrollCoolShow = 春/夏（青绿山水）／scrollWarmShow = 秋/冬（秋山雪意）。
     两套各自登记进 SEASON_PRESENCE，各自挂一份画心——这样复用了既有的
     "存在性每帧重申"机制（GTAO 每帧会把 visible 改回 true，必须重申），
     不必在 applyEnv 里新增一条特殊分支。
     两片画心错开 0.008m 防过渡期同时可见时 z-fighting。 */
/* 两套画心材质 MAT.scrollArtCool / MAT.scrollArtWarm 定义在 01-materials.js：
   它们同样登在 SEASON_PRESENCE 表里，必须在该表建起来之前就存在（理由同上，竹帘那条）。 */
export function makeHangingScroll(x, y, z, yaw = 0){
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  const W = 0.78, HART = 1.34, CTRIM = 0.26;
  /* 天头 / 地头（绫边）：上下各一段，比画心略宽 */
  const head = mesh(box(W + 0.10, CTRIM, 0.014), MAT.porcelain, { name:'propScrollHead', cast:false });
  head.position.set(0, HART / 2 + CTRIM / 2, 0.002); g.add(head);
  const foot = mesh(box(W + 0.10, CTRIM, 0.014), MAT.porcelain, { name:'propScrollFoot', cast:false });
  foot.position.set(0, -HART / 2 - CTRIM / 2, 0.002); g.add(foot);
  /* 两侧绫边 */
  for (const sx of [-1, 1]){
    const side = mesh(box(0.05, HART, 0.013), MAT.porcelain, { name:'propScrollSide', cast:false });
    side.position.set(sx * (W / 2 + 0.025), 0, 0.002); g.add(side);
  }
  /* 两套画心（季节存在性各挂一套） */
  const cool = mesh(new THREE.PlaneGeometry(W, HART), MAT.scrollArtCool, { name:'propScrollArtCool', cast:false });
  cool.position.z = 0.010; g.add(cool);
  const warm = mesh(new THREE.PlaneGeometry(W, HART), MAT.scrollArtWarm, { name:'propScrollArtWarm', cast:false });
  warm.position.z = 0.018; g.add(warm);
  /* 上下轴杆 + 轴头 */
  for (const sy of [1, -1]){
    const rod = mesh(new THREE.CylinderGeometry(0.024, 0.024, W + 0.20, 10), MAT.woodDark, { name:'propScrollRod' });
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, sy * (HART / 2 + CTRIM), 0.004);
    g.add(rod);
    for (const sx of [-1, 1]){
      const cap = mesh(new THREE.SphereGeometry(0.034, 8, 6), MAT.wood, { name:'propScrollRodCap', cast:false });
      cap.position.set(sx * (W / 2 + 0.10), sy * (HART / 2 + CTRIM), 0.004); g.add(cap);
    }
  }
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ⑨ 古井（井台 + 井圈石）—— 西草坪芭蕉丛西侧的静角
   ══════════════════════════════════════════════════════════════
   ⚠️ 尺度是**刻意克制**的（用户要求"不抢构图、不占视觉重心"）：
   井台外径 1.52m、井圈外径 0.72m、通高 0.42m —— 在 34~41m 外的默认机位下只占十几像素，
   是"有人住过"的痕迹，不是画面里的一件家具。凡是想把它做大/加井栏/加辘轳的，
   请先回到这条要求：旱船与六角亭已被用户明确砍掉，理由同一条。
   ⚠️ y 与 makeQinSet / makeWaterVat 同构：**显式给**（射线实测的地面高），不吃 groundHeight ——
   井台底面要比地面低 0.04 埋进草里，在坡上才不会露出缝。
   结构三层：两级八角矮台（下宽上窄）→ 一整块车出来的环形青石（井圈）→ 井口暗面 + 一汪井水
   （复用 MAT.winCore / MAT.vatWater，不新增材质桶）。
   ⚠️ 井圈那一段轮廓必须**从外壁绕到内壁**（不是一段圆筒）：LatheGeometry 只在轮廓两端开口，
   做成圆筒就从井口看进去会见穿堂。轮廓首尾都落在台面上 ⇒ 两个开口都被井台盖住。 */
export function makeWell(x, z, y, yaw = 0){
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;

  /* 井台：两级八角矮台。底面 −0.04 ⇒ 埋进草里（toFixed 掉的坡差全被它吸收） */
  const plinthLow = mesh(new THREE.CylinderGeometry(0.72, 0.76, 0.10, 8), MAT.wellStone, { name:'propWellPlinthLow' });
  plinthLow.position.y = 0.01;                 // 跨 −0.04 ~ +0.06
  g.add(plinthLow);
  const plinthTop = mesh(new THREE.CylinderGeometry(0.58, 0.64, 0.10, 8), MAT.wellStone, { name:'propWellPlinthTop' });
  plinthTop.position.y = 0.065;                // 跨 +0.015 ~ +0.115
  g.add(plinthTop);

  /* 井圈石：整块青石车出来的环（外壁 → 圆顶 → 内壁），台面以上 0.115~0.42 */
  const R_OUT = 0.360, R_IN = 0.255, Y0 = 0.115, Y1 = 0.420;
  const prof = [
    [R_OUT,          Y0],            // 外壁下沿（压在井台面上）
    [R_OUT + 0.012,  Y0 + 0.055],    // 微鼓：石圈凿出来不会是笔直的圆柱
    [R_OUT + 0.012,  Y1 - 0.085],
    [R_OUT,          Y1 - 0.018],
    [R_OUT - 0.042,  Y1],            // 圆顶
    [R_IN + 0.018,   Y1],
    [R_IN,           Y1 - 0.028],
    [R_IN,           Y0],            // 内壁下沿（井壁）
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const curb = mesh(new THREE.LatheGeometry(prof, 20), MAT.wellStone, { name:'propWellCurb' });
  g.add(curb);

  /* 井口：暗面 + 一汪井水。压在井壁下沿之上一点点（0.16）——
     从俯视机位看下去，读作"一圈青石中间一个黑洞"，井的"深"就靠这两片。 */
  const mouth = mesh(new THREE.CircleGeometry(R_IN - 0.004, 20), MAT.winCore, { name:'propWellMouth', cast:false });
  mouth.rotation.x = -Math.PI / 2;
  mouth.position.y = Y0 + 0.045;
  g.add(mouth);
  const water = mesh(new THREE.CircleGeometry(R_IN - 0.022, 20), MAT.vatWater, { name:'propWellWater', cast:false });
  water.rotation.x = -Math.PI / 2;
  water.position.y = Y0 + 0.050;
  g.add(water);
  return g;
}

/* ══════════════════════════════════════════════════════════════
   ⑩ 花街铺地（卵石 + 瓦片镶边的一小段铺装）
   ══════════════════════════════════════════════════════════════
   ⚠️⚠️ 这一件与 ⑦⑧ 那些"摆在已有构件上"的陈设不同：它是**铺在草地上的**，而草地不是平面
   （实测这一段 3.9m 内的 terrain 起伏有 0.10m）。所以整段铺装**逐点采样 groundHeight**
   （26×10 网格）—— 拿一个常数 y 铺一块平板，必然一头翘起、一头陷下去。
   ⚠️ 边缘不另做裙边：面层在**边沿 0.10m 内下潜到地面以下 0.09m**（磨边沉进草里）⇒
   边缘自然消失在草皮里，既不露缝、也不出现一圈"路缘石"。地面上那 2.8cm 的高差是真实铺装
   本来就有的（花街铺地是砌在灰土上、比土面略高的），不是浮起来。
   ⚠️ 拼花：卵石两色交替成一圈**菱环**（每 0.95m 一个单元），四边压一行竖立的**瓦片**（青瓦）
   —— "卵石 + 瓦片"正是花街铺地最经典的一种做法。
   ⚠️ 不用 InstancedMesh（铁律 2）：layout-fingerprint 只哈希 InstancedMesh 的实例矩阵，
   凭空多一份实例网格就**必须重出基线**。这里 ~270 颗卵石 + ~108 片瓦按材质各并成**一个** Mesh，
   随 mergeStatics 并进静态大网 ⇒ 指纹一位不动。 */
export function makeFlowerLane(x, z, y, len, wid, yaw = 0){
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  /* 局部 (lx,lz) → 世界 (wx,wz)：绕 Y 轴 yaw 的标准旋转；
     gy() 把世界地面高换算回**组局部坐标**（组原点 y = 射线实测的落点地面高）。 */
  const wx0 = (lx, lz) => x + lx * cy + lz * sy;
  const wz0 = (lx, lz) => z - lx * sy + lz * cy;
  const gy = (lx, lz) => groundHeight(wx0(lx, lz), wz0(lx, lz)) - y;

  const LIFT = 0.028;        // 面层高出草地
  const EDGE = 0.10;         // 磨边宽（这一段之内面层下潜）
  const RAMP = 0.118;        // 下潜深度（= LIFT + 0.09 ⇒ 边沿落到地面以下 0.09m）
  const BW = 0.26;           // 卵石区距边沿的内缩（把瓦片镶边让出来）
  const inLen = len - 2 * BW, inWid = wid - 2 * BW;

  /* ── ① 面层（底灰）：PlaneGeometry 走 rotateX(−π/2) ⇒ 顶点天然是"XZ 平面 + 法线朝上 +
     索引绕序正确"，只把每个顶点的 y 换成该点地形高即可。
     ⚠️ 不手工拼 BufferGeometry：绕序写反 = 法线朝下 = 单面材质直接看不见，
     而"看不见"在这里只表现为"这条铺装好像没建成"，很难联想到是绕序。── */
  const NX = Math.max(8, Math.round(len / 0.15));
  const NZ = Math.max(6, Math.round(wid / 0.05));
  const surfGeo = new THREE.PlaneGeometry(len, wid, NX, NZ);
  surfGeo.rotateX(-Math.PI / 2);
  {
    const p = surfGeo.attributes.position;
    for (let i = 0; i < p.count; i++){
      const lx = p.getX(i), lz = p.getZ(i);
      const e = Math.min(len / 2 - Math.abs(lx), wid / 2 - Math.abs(lz));   // 到最近的边有多远
      const t = Math.min(1, Math.max(0, e / EDGE));
      p.setY(i, gy(lx, lz) + LIFT - RAMP * (1 - t));
    }
    p.needsUpdate = true;
    surfGeo.computeVertexNormals();
  }
  g.add(mesh(surfGeo, MAT.paveBed, { name:'propLaneBed', cast:false }));

  /* ── ② 卵石：隔行错半格的梅花点，两色按**菱环**交替（拼花）
     每颗 = 一份 IcosahedronGeometry(1,0)（20 面）克隆 + 烘进局部矩阵，最后按颜色各并成一个几何。── */
  const baseGeo = new THREE.IcosahedronGeometry(1, 0);
  const MOTIF = 0.95;                      // 拼花单元长（沿路）
  const warm = [], cool = [];
  const nU = Math.max(4, Math.round(inLen / 0.088));
  const nV = Math.max(3, Math.round(inWid / 0.088));
  const du = inLen / nU, dv = inWid / nV;
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  for (let iv = 0; iv < nV; iv++){
    for (let iu = 0; iu < nU; iu++){
      const lx = -inLen / 2 + (iu + 0.5 + (iv % 2 ? 0.5 : 0)) * du;
      const lz = -inWid / 2 + (iv + 0.5) * dv;
      if (Math.abs(lx) > inLen / 2 - du * 0.3) continue;      // 错半格后越界的丢掉（保住直边）
      /* 菱环判定：把 (沿路, 横向) 归一化到各自的半对角，L1 距离落在 0.72~1.0 的带内 = 环 */
      const uu = ((lx % MOTIF) + MOTIF) % MOTIF - MOTIF / 2;
      const dd = Math.abs(uu) / 0.30 + Math.abs(lz) / 0.22;
      const isMotif = dd > 0.72 && dd < 1.0;
      const r = 0.030 + jr(0.006);
      _e.set(jr(0.10), jr(1.2), jr(0.10));
      _q.setFromEuler(_e);
      _v.set(lx, gy(lx, lz) + LIFT + r * 0.30, lz);
      _s.set(r * (1 + jr(0.14)), r * 0.72, r * (1 + jr(0.14)));   // 压扁 ⇒ 读作"嵌入灰里的卵石"而不是"一堆球"
      const m = new THREE.Matrix4().compose(_v, _q, _s);
      (isMotif ? warm : cool).push(baseGeo.clone().applyMatrix4(m));
    }
  }
  if (warm.length) g.add(mesh(mergeGeometries(warm, false), MAT.pebbleWarm, { name:'propLanePebbleWarm', cast:false }));
  if (cool.length) g.add(mesh(mergeGeometries(cool, false), MAT.pebbleCool, { name:'propLanePebbleCool', cast:false }));

  /* ── ③ 瓦片镶边：四边各压一排**侧立**的青瓦片。
     用 box 而不是半圆筒瓦：半圆筒（开口壳体）单面渲染时从侧面能看穿，而 box 四面都是正面。
     瓦片中心放在距边沿 0.165m 处（> EDGE=0.10）⇒ 整排都落在"已抬平"的面层上，不会一脚踩空。 */
  const IN = 0.165, STEP = 0.082;
  const tiles = [];
  const nLong = Math.max(2, Math.round((len - 2 * IN) / STEP));
  const nShort = Math.max(2, Math.round((wid - 2 * IN) / STEP));
  for (let i = 0; i < nLong; i++){
    const lx = -(len / 2 - IN) + 2 * (len / 2 - IN) * (i + 0.5) / nLong;
    tiles.push([lx, wid / 2 - IN, 0], [lx, -(wid / 2 - IN), 0]);
  }
  for (let i = 0; i < nShort; i++){
    const lz = -(wid / 2 - IN) + 2 * (wid / 2 - IN) * (i + 0.5) / nShort;
    tiles.push([len / 2 - IN, lz, Math.PI / 2], [-(len / 2 - IN), lz, Math.PI / 2]);
  }
  const tileGeos = [];
  for (const [lx, lz, ry] of tiles){
    const h = 0.046 + jr(0.010);
    _s.set(0.048, h, 0.105);                       // 沿边 0.048 / 高 h / 横向 0.105（横跨镶边带）
    _e.set(0, ry + jr(0.07), 0);
    _q.setFromEuler(_e);
    _v.set(lx, gy(lx, lz) + LIFT + h / 2 - 0.012, lz);   // 埋进面层 1.2cm ⇒ 不悬空
    tileGeos.push(box(1, 1, 1).applyMatrix4(new THREE.Matrix4().compose(_v, _q, _s)));
  }
  g.add(mesh(mergeGeometries(tileGeos, false), MAT.stoneDark, { name:'propLaneTile', cast:false }));
  return g;
}

/* ══════════════════════════════════════════════════════════════
   落点表 + 组装
   ══════════════════════════════════════════════════════════════
   ⚠️ 所有落点都是**射线实测**定的（outputs/_diag/props-spot.mjs：从空中下打、
   看真实命中面而不是地形公式）—— 台基/铺地/廊道都是浮在地形上的独立网格，
   拿 groundHeight 当落点会陷进去或悬空。
   ⚠️ 本表同时是门禁的**唯一真值源**：probe/props-guard.mjs 直接 import 本模块读它，
   再去场景里射线复核"每件是不是真坐落在它该在的面上"。 */
export const PROP_SPOTS = {
  /* 堂前东草坪（实测 (6.6,−5.4) 首个命中 ground 0.096 = 地形 0.099，开阔无遮挡） */
  stoneTable: { x: 6.6,  z: -5.4,  yaw: 0.55 },
  /* 水榭台基顶面（实测 (13.4,8.2) 命中 0.62 —— 台基顶面；且不在池域内） */
  qin:        { x: 13.4, z: 8.2,   y: 0.62, yaw: Math.PI * 0.5 },
  /* 游廊东腿（x=24 那条；实测 (24.6,z) 屋面之下首个实体命中就是地面 ⇒ 廊内净空无栏杆） */
  stands:     [{ x: 24.6, z: 2.0 }, { x: 24.6, z: 6.0 }, { x: 24.6, z: 10.0 }],
  /* 堂前台基（实测 (±3.7,−7.4) 命中 1.30@paving —— 堂前月台面，踏跺两侧）。
     ⚠️ y 必须跟着落点一起写进表里：缸站的是**月台铺装面 1.30**，不是地形面 −0.23；
     早先 makeWaterVat 自己调 groundHeight，导致"表里 1.30 / 实物 −0.23"的不一致。
     ⚠️ z 从 −6.95 收到 −7.4：细扫（x=3.7 一线）显示月台前缘/压顶在 z ≈ −6.52，
     缸半径 0.44 ⇒ 圆心 −6.95 时缸沿刚好压在台边（外挑 0.09m）。退到 −7.4 后
     缸前沿 −6.96，离台边 0.44m，稳在月台面上。 */
  vats:       [{ x: 3.7, y: 1.30, z: -7.4 }, { x: -3.7, y: 1.30, z: -7.4 }],
  /* 堂前中轴草地（实测 (0,−4.7) 命中 ground −0.232，正对踏跺与匾额） */
  censer:     { x: 0, z: -4.7 },
  /* 竹帘：水榭西向敞开面（额枋世界 x=11.05、y=4.25）三幅；游廊 z=−3.14 檐下两幅 */
  blindsPav:  [{ x: 11.15, y: 4.20, z: 4.0 }, { x: 11.15, y: 4.20, z: 6.4 }, { x: 11.15, y: 4.20, z: 8.8 }],
  blindsCor:  [{ x: 17.0, y: 3.10, z: -3.14 }, { x: 21.0, y: 3.10, z: -3.14 }],
  /* 堂内条案（04-buildings 的 altarTable：世界 (0,−14.15)，顶面 y=2.24） */
  stationery: { x: 0, y: 2.24, z: -14.15, yaw: Math.PI },
  /* 堂内后檐墙内表面（z=−16.64）；屏风在 x∈[−1.45,1.45] ⇒ 四轴挂在 ±3.6 / ±5.8 */
  scrolls:    [{ x: -5.8, z: -16.60 }, { x: -3.6, z: -16.60 }, { x: 3.6, z: -16.60 }, { x: 5.8, z: -16.60 }],
  /* ── 2026-10-05 ·「③ 景」两件（详见 outputs/_diag/props-spot-well-path.mjs 的实测记录）── */
  /* 古井：西草坪、芭蕉丛西侧的静角。实测 (−20.4,−6.1) 从 y=30 下打**只命中 ground −0.131**
     （地形公式 −0.128，差 3mm）；4m 内无他物（最近的是芭蕉 (−18.6,−3.2)，距 3.4m）；
     局部坡度 Δx(±1m)=−0.099、Δz(±1m)=+0.042 ⇒ 近水平，井台底面再下沉 0.04 就完全埋实。 */
  well:       { x: -20.4, z: -6.1, y: -0.131, yaw: 0.22 },
  /* 花街铺地：从南侧草坪通到井台南缘的一小段，沿**世界 Z** 铺 3.9m × 1.15m
     （yaw=π/2 ⇒ 局部 +X 映射到世界 −Z）。实测九点（四角 + 两长边中点 + 心 + 两端中线）
     全部只命中 ground：z=−5.45 一线 地形 −0.087~−0.144、z=−1.55 一线 −0.042~−0.094、
     中心 (−20.4,−3.5) 命中 −0.085；铺装逐点采样地形（见 makeFlowerLane），
     北端 (−5.45) 正好压到井台外缘 (−5.32) 之外 0.13m ⇒ 两者咬合、不留缝。
     ⚠️ y 记的是**中心**那一点的实测地面高（registry 的判据拿它跟中心射线比）。 */
  lane:       { x: -20.4, z: -3.5, y: -0.085, len: 3.9, wid: 1.15, yaw: Math.PI / 2 },
};
const SCROLL_Y = 3.30;          // 挂画中心高度（后墙 1.24~5.69，取中偏上）

/* 门禁读的登记表：每件的世界落位 + 占地半径 + 顶高。
   半径用于"两两不重叠"与"邻域支撑面"两条判据（取值按各自最大水平尺寸的一半）。 */
export const PROP_REGISTRY = [];
const reg = (name, x, y, z, r, top) =>
  PROP_REGISTRY.push({ name, x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3), r, top: +top.toFixed(3) });

export function buildProps(){
  const g = new THREE.Group();
  g.name = 'props';

  const st = PROP_SPOTS.stoneTable;
  g.add(makeStoneTableSet(st.x, st.z, st.yaw));
  reg('石桌石凳', st.x, groundHeight(st.x, st.z), st.z, 1.30, 0.78);

  const qn = PROP_SPOTS.qin;
  g.add(makeQinSet(qn.x, qn.z, qn.y, qn.yaw));
  reg('古琴琴桌', qn.x, qn.y, qn.z, 0.85, 0.85);   // top = 桌面 0.72 + 琴厚（2026-10-05 桌面抬高 0.10）

  PROP_SPOTS.stands.forEach((s, i) => {
    g.add(makeFlowerStand(s.x, s.z, groundHeight(s.x, s.z), i % 2 ? 0.35 : -0.25, i % 2));
    reg('盆景花几' + (i + 1), s.x, groundHeight(s.x, s.z), s.z, 0.36, 0.90);
  });

  PROP_SPOTS.vats.forEach((v, i) => {
    g.add(makeWaterVat(v.x, v.z, v.y, i * 1.1, true));
    reg('水缸' + (i + 1), v.x, v.y, v.z, 0.48, 0.64);   // y 取表里的月台面 1.30
  });

  const ce = PROP_SPOTS.censer;
  g.add(makeCenser(ce.x, ce.z, 0));
  reg('香炉', ce.x, groundHeight(ce.x, ce.z), ce.z, 0.34, 0.92);

  /* 竹帘：挂点在额枋下沿，帘自身从挂点往下垂 ⇒ 组原点给"顶部"，几何用负 Y 往下长。 */
  for (const b of PROP_SPOTS.blindsPav){
    const bl = makeBambooBlind(2.35, 2.30, { yaw: Math.PI / 2 });
    bl.position.set(b.x, b.y, b.z);
    bl.name = 'propBlindPav';
    g.add(bl);
    reg('竹帘·水榭', b.x, b.y - 2.30, b.z, 1.25, 2.34);
  }
  for (const b of PROP_SPOTS.blindsCor){
    const bl = makeBambooBlind(2.35, 2.20, { yaw: 0 });
    bl.position.set(b.x, b.y, b.z);
    bl.name = 'propBlindCor';
    g.add(bl);
    reg('竹帘·游廊', b.x, b.y - 2.20, b.z, 1.25, 2.24);
  }

  const sa = PROP_SPOTS.stationery;
  g.add(makeStationery(sa.x, sa.y, sa.z, sa.yaw));
  reg('文房四宝', sa.x, sa.y, sa.z, 0.50, 0.42);   // r/top 按"笔筒 + 立笔"的新占地重算（原 0.42/0.16）

  for (const s of PROP_SPOTS.scrolls){
    g.add(makeHangingScroll(s.x, SCROLL_Y, s.z, 0));   // 法线 +Z ⇒ 朝堂内
    reg('卷轴挂画', s.x, SCROLL_Y - 1.10, s.z, 0.50, 2.34);
  }

  /* ──「③ 景」两件：井 + 通到井台的花街铺地（都落在西草坪，刻意低调）──
     组原点 y = 表里射线实测的地面高（两件都**不吃** groundHeight，见各自工厂的注释）。 */
  const wl = PROP_SPOTS.well;
  g.add(makeWell(wl.x, wl.z, wl.y, wl.yaw));
  reg('古井', wl.x, wl.y, wl.z, 0.80, 0.43);          // r 按井台外径 1.52/2、top 按通高 0.42

  const ln = PROP_SPOTS.lane;
  g.add(makeFlowerLane(ln.x, ln.z, ln.y, ln.len, ln.wid, ln.yaw));
  reg('花街铺地', ln.x, ln.y, ln.z, 2.05, 0.09);       // r 按 3.9×1.15 的半对角、top 按瓦片露头
  return g;
}

