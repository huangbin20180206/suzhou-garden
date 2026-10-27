// 16a-actor-props.js — 由 16-actors.js 按职责整块搬出（纯搬家，逐字节未改）。
// 人物手里/身边的小道具（纯几何 + 少量常量，不含行为）：
//   · 茶盏（makeTeaCup）与端茶手臂表 TEA_ARM
//   · 马刷（makeBrush）与刷马手腕表 BRUSH
//   · 卷轴（makeScroll + 纸纹贴图）与捧卷手腕表 SCROLL
//   · 草料捆（makeHayHandful + 秸秆贴图）与喂草手臂表 HAY_ARM
// 这些常量由 16-actors 的 advance() 逐帧读取；道具本体的摆放也在那边（跟着手骨走）。
import { THREE } from '../vendor.js';
import { MAT } from './01-materials.js';
export const TEA_ARM = {
  /* ⚠️ 2026-10-25 重解（outputs/_diag/actor-tea-solve2/3.mjs）：旧值 { sy: 1.19, sz: -1.18 }
     在当前 rig 上把右手举到**肩侧偏后**——出图里就是"胳膊横抬着"，老黄报的"手摆动很怪异"
     有一半是这一档（另一半是 armDown 绕 Y 空转，见 16-actors 的 ARM_DOWN）。
     ⚠️ 求解必须按产品的 `set()` 口径：bone.quaternion = 绑定姿势 × Euler(x,y,z)，
        直接写 rotation 求出来的角是错的（第一次就踩了：解出胸前，实到手落在 (−0.52,1.24,−0.39)）。
     ⚠️ lift 必须**在 hold 邻域内**解：全局解出的那组与 hold 差 3.6rad，抬手会甩一大圈。
     实测 hold 手落 (−0.05,1.17,0.33) 误差 2cm；lift (0.00,1.37,0.32) 误差 8.5cm，
     与 hold 只差 0.5rad 的肩角 ⇒ 抬手是"抬起来"而不是"抡一圈"。 */
  hold: { sx: -2.00, sy: 0.00, sz: -0.20, ex: 1.40, hx: 0.35 },
  lift: { sx: -2.50, sy: 0.00, sz: -0.10, ex: 1.40, hx: 0.35 },
};
export const TEA_CUP_FWD = 0.09;    // 盏心在腕**前**多少（袖口之外才看得见）
export const ease01 = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
export const _cupV = new THREE.Vector3();

export function makeTeaCup(holder){
  const g = new THREE.Group();
  g.name = 'actorTeaCup';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.028, 0.046, 16), MAT.porcelain);
  body.position.y = 0.023;
  body.castShadow = false;
  body.receiveShadow = true;
  g.add(body);
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.002, 14),
    new THREE.MeshStandardMaterial({ color: 0x6B4620, roughness: 0.26, metalness: 0.0 }));
  tea.position.y = 0.040;
  g.add(tea);
  g.userData.noMerge = true;
  holder.add(g);
  return g;
}

/* ── 刷马（P3）──────────────────────────────────────────────────────────────
   马夫的第二件事：给身边那匹低头吃草的马刷颈肩。
   ⚠️ **只动肘 + 腕，绝不转肩**：这条 rig 的腰带有一批顶点贴着前臂/拇指骨
      （research/characters/repair_hands.py 修过一类，但腰带上仍有少数与骨骼几何上
      分不开），转肩会把腰带拽成尖刺 —— 与"马夫/书童只做躯干动作"同一条约束。
      肘与腕是否干净由 outputs/_diag/actor-brush-probe.mjs 的"顶点离骨轴距离"实测。
   ⚠️ 刷子**不挂手骨**（同茶盏）：挂上去会被腕子拧歪。每帧按"腕 + 前臂方向"重摆，
      朝向 = 前臂方向 ⇒ 刷面正好贴着马身。
   ⚠️ 尺寸**按像素定**、不按实物：马厩机位在 15~25m 外，15cm 的刷子才读得出来
      （草料捆那条：8cm 粗在 20m 外只有 1~2px）。
   ⚠️ 举手高度由**骨架可达范围**定：肩不动时腕最高只到肘上方约 0.25m ⇒ 刷的是
      马的颈肩（1.1~1.25m），不是背脊。 */

export const BRUSH = {
  /* 举起角**实测**（actor-brush-probe.mjs 的只动肘扫描，腕心/指尖的世界坐标）：
     ex −1.6 ⇒ 腕 (38.174,1.219,1.622)、指尖 (38.358,1.234,1.548)；
     ex −1.2 ⇒ 腕 (38.170,1.132,1.632)、指尖 (38.348,1.071,1.567)。
     ⇒ 负角是"前臂抬到前方"（正角把手往身后甩），−1.45 时腕在胸前约 0.2m、
       指尖抬到 1.19m —— 正好是马的颈肩高度。 */
  elbow: -1.45, wrist: 0.20,         // 举起时：前臂抬到略高于水平、腕稍回勾
  amp: 0.20, wAmp: 0.16, hz: 0.45,   // 来回刷：肘 ±0.20rad、腕反相 ±0.16rad
  fwd: 0.10,                         // 刷心在腕前 10cm（指外才看得见）
  every: [7, 12],                    // 两次刷马之间隔多久（其间前俯看马吃草）
  dur: 9.2,                          // 一整轮：抬 0.9 / 刷 7.4 / 收 0.9
  headDown: 0.10,                    // 刷的时候低头看刷子（不是看马嘴）
};
export const _brV = new THREE.Vector3();
export const _brE = new THREE.Vector3();
export const _brQ = new THREE.Quaternion();
export const _brQ2 = new THREE.Quaternion();
export const _brZ = new THREE.Vector3(0, 0, 1);

export function makeBrush(holder){
  const g = new THREE.Group();
  g.name = 'actorBrush';
  /* ⚠️ 2026-10-27（老黄："草料或者刷子根本看不出拿的有工具"）：原来的刷背 8.5×7.5cm、
     刷毛深褐 8×7cm，在深色马身上几乎融成一块 ⇒ 加宽刷背、刷毛改成浅麦色（对深色马有反差），
     刷尖只往前多 1cm（实测贴面 42~74mm，再多就会插进马身）。 */
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 8), MAT.wood);
  handle.rotation.x = Math.PI / 2;       // 圆柱默认沿 Y ⇒ 转成沿 Z
  handle.position.set(0, 0, 0.020);
  g.add(handle);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.120, 0.100, 0.028), MAT.woodDark);
  back.position.set(0, 0, 0.085);
  g.add(back);
  const bristleMat = new THREE.MeshStandardMaterial({ color: 0xD9CBA6, roughness: 0.95, metalness: 0.0 });
  /* 刷毛做成**一排细条**（12 条，条间留 1.5mm 缝）：远看是一块浅色刷面，
     近看能读出"一撮一撮的毛"，而不是一块海绵/木块。 */
  const SL = 12, bw = 0.008, gap = 0.0018, bd = 0.042, bh = 0.095;
  const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(bw, bh, bd), bristleMat, SL);
  const bm = new THREE.Matrix4();
  for (let i = 0; i < SL; i++){
    bm.makeTranslation((i - (SL - 1) / 2) * (bw + gap), 0, 0);
    slats.setMatrixAt(i, bm);
  }
  slats.instanceMatrix.needsUpdate = true;
  slats.name = 'actorBrushSlats';        // 布局指纹排除名单里登记（手里的小件，与园林布局无关）
  slats.position.set(0, 0, 0.114);
  slats.castShadow = false; slats.receiveShadow = true;
  slats.userData.noMerge = true;
  g.add(slats);
  g.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false;                // 15m 外的小件，投影贡献约 0、只会撑大阴影盒
    o.receiveShadow = true;
    o.userData.noMerge = true;
  });
  g.userData.noMerge = true;
  g.visible = false;
  holder.add(g);
  return g;
}

/* ── 捧卷读（P2 最后一件）────────────────────────────────────────────────────
   文士双手捧着卷轴读；读一阵放下、喝口茶（沿用 TEA_ARM），再捧起来。
   ⚠️ 与"端茶"是**互斥的两种手位**：共用右臂，靠 a.scrollW 交接 ——
      卷轴放下之后才端盏，盏放下之后才捧卷轴。
   ⚠️ 两只手腕的目标点是**反解**的（outputs/_diag/actor-scroll-solve.mjs）：
      左右各自求解、**不镜像**（这套骨架左右骨骼朝向本来不对称，同抚琴那条）。
      实测（ex=1.0 一行）左手腕 (1.193,1.014,−5.394)、右手腕 (1.438,1.012,−5.503)
      ⇒ 两手相距 0.268m、高差 2mm（几乎水平）；两肘在肩前 0.20m、外 0.145m。
      目标是 (±0.155, 腕高 1.20, 前 0.30)，解出的腕比目标低 0.19m 左右，
      所以卷轴的宽度/高度都按**实测手距**缩放（span/SCROLL.span）而不是写死。
   ⚠️ 卷轴姿态**不写死**：每帧按两只腕子的实际位置现算（位置 = 两腕中点，
      X = 左腕→右腕，纸面法线 = 前上方）—— 与茶盏、马刷同一条经验：骨骼一转，
      道具跟着走，不会"纸歪了、手空了"。
   ⚠️ 纸面**上沿朝人、法线朝前上方**（上仰 24°）：外场（相机在正面偏上）看到的是
      纸面；竖直拿着时从默认俯视机位只看见一条白边。 */

export const SCROLL = {
  /* 反解结果（outputs/_diag/actor-scroll-solve2.log 的 chest42 一组）：
     目标 = 腕高 1.32（相对脚下，胸口）、左右 ±0.21、前伸 0.30；实测每只手误差 0.04m，
     两只手因此相距约 0.36m（不是 0.42）—— 缩放按**实测**走，见下面 span。
     ⚠️ 第一版目标取 1.20/±0.155（腰腹高、两手并拢）：出图里两只手被宽袖口吞掉、
        卷轴只露出一个白三角（outputs/_diag/actor-scroll/front.png）⇒ 抬到胸口、
        两手拉开，纸面才从袖口之间露出来。 */
  L: { sx: -2.34, sy: -1.77, sz: -0.17, ex: 0.70 },
  R: { sx: -1.99, sy: 0.77, sz: -0.43, ex: 0.70 },
  w: 0.42, h: 0.26,      // 纸面宽 × 高（宽由两手距离定，见 span）
  yOff: 0.02,            // 纸心比手高一点：握的是卷轴的下三分之一，纸往上展开
  span: 0.42,            // 反解目标的两手间距（缩放基准）
  hx: 0.90,              // 腕子内旋（actor-grip-sweep 的 E 组）：指节朝下、扣住木轴
  tilt: 0.42,            // 纸面上仰角（rad）≈24°
  hold: [22, 38],        // 捧读时长（秒）
  trans: 1.00,           // 举起 / 放下各多久
  headDown: 0.22,        // 读的时候低头看纸（顶在 o.headDown 之上）
  fwdMin: 0.80, fwdMax: 1.15,   // 手距缩放夹紧（防解出的姿势异常时纸被拉爆）
};
export const _scL = new THREE.Vector3();
export const _scR = new THREE.Vector3();
export const _scC = new THREE.Vector3();
export const _scX = new THREE.Vector3();
export const _scY = new THREE.Vector3();
export const _scZ = new THREE.Vector3();
export const _scF = new THREE.Vector3();
export const _scM = new THREE.Matrix4();
export const _scQ = new THREE.Quaternion();
export const _scQ2 = new THREE.Quaternion();

/* ── 作揖（S2「主人出迎」· 2026-10-23）──────────────────────────────────────
   拱手的手位**不是照姿势凭感觉填的**：这套 GLB 骨架没有前臂旋前、左右骨骼朝向
   也不对称（抚琴/端茶/卷轴三轮都踩过），所以肩肘三轴由
   `outputs/_diag/actor-bow-solve.mjs` 扫出来 —— 目标是"两腕在胸前合拢、前伸够远
   （宽袖不插进袍子）、两手等高"。
   读得出的"礼"只有三件事，按画面可读性给幅度、不按真人的 45°：
     ① 躯干前俯（Chest/Spine 一起，0.62rad ≈ 36°；袖口会吃掉手的细节，太小就读成"点了个头"）
     ② 双手在胸前合拢（两袖并在一起，这套骨架做不出"两掌相合"）
     ③ 两人面对面同时起落（导演层对齐，不各演各的）
   时序 0.70 起 / 1.00 停 / 0.70 落：比真人慢一点 —— 长袍摆动要时间，太快像"鞠躬机"。 */

export function makeScrollPaperTex(){
  const c = document.createElement('canvas');
  c.width = 256; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#F3E9D4';
  g.fillRect(0, 0, 256, 200);
  g.globalAlpha = 0.05;                        // 纸纤维：淡淡的横纹，近景别像一块纯色板
  for (let y = 0; y < 200; y += 3){
    g.fillStyle = (y % 6) ? '#9C8B6A' : '#FFFFFF';
    g.fillRect(0, y, 256, 1);
  }
  g.globalAlpha = 1;
  const hsh = (i) => { const s = Math.sin(i * 12.9898) * 43758.5453; return s - Math.floor(s); };
  g.fillStyle = '#2B2622';
  let k = 0;
  for (let col = 0; col < 8; col++){
    const x = 18 + col * 29;
    g.fillRect(x, 16, 12, 4);                  // 列首"抬头"比正文粗一点
    let y = 30;
    while (y < 176){
      const w = 9 + hsh(++k) * 6, h = 5 + hsh(++k) * 4;
      g.fillRect(x + hsh(++k) * 2, y, w, h);
      y += h + 3 + hsh(++k) * 5;
    }
  }
  g.fillStyle = '#A8362C';                     // 朱印
  g.fillRect(214, 158, 20, 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* 卷轴：纸面 + 两端竖向木轴 + 轴头。原点在纸心，局部 +Z = 纸面法线。 */

export function makeScroll(holder){
  const g = new THREE.Group();
  g.name = 'actorScroll';
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(SCROLL.w, SCROLL.h),
    new THREE.MeshStandardMaterial({ map: makeScrollPaperTex(), roughness: 0.94, metalness: 0.0,
                                     side: THREE.DoubleSide }));
  paper.position.y = SCROLL.yOff;              // 握下三分之一、纸往上展开
  g.add(paper);
  for (const s of [-1, 1]){
    /* 木轴心必须**正好落在手腕上**（x = ±w/2、y = 0）：卷轴整体按实测手距缩放，
       木轴随缩放一起落到腕心，手掌才包得住它（第一版多放了 1.2cm + 抬 2cm，
       实测两只手各离轴心 2.5cm，近景读成"手悬在纸下面"）。 */
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, SCROLL.h + 0.035, 10), MAT.wood);
    rod.position.set(s * (SCROLL.w * 0.5), 0, -0.010);
    g.add(rod);
    for (const t of [-1, 1]){
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.030, 10), MAT.woodDark);
      cap.position.set(rod.position.x, t * (SCROLL.h * 0.5 + 0.030), -0.010);
      g.add(cap);
    }
  }
  g.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false;                      // 手里的小件，投影贡献≈0，只会撑大阴影盒
    o.receiveShadow = true;
    o.userData.noMerge = true;
  });
  g.userData.noMerge = true;
  g.visible = false;
  holder.add(g);
  return g;
}

/* ── 手持草料（马夫）────────────────────────────────────────────────────────
   马夫前俯看马吃草的时候，手里也该有一把草（否则站着一个空手闲人）。
   ⚠️ **只动左肘**：这只 rig 的腰带挂了一批与骨骼几何上分不开的顶点（见
      research/characters/repair_hands.py 与 BRUSH 的注释），转肩会把腰带拽成尖刺。
   ⚠️ 肘角是**扫出来**的（outputs/_diag/actor-bale-solve.log，肩保持垂手基线）：
      ex −1.6 ⇒ 腕在身前 0.116m、离地 1.06m；−1.2 ⇒ 0.093m；−0.35 ⇒ 0.024m。
      **但"往前伸"这条路被站位堵死了**：马夫离马腹只有 20cm（马身 x≥38.2、人在 x=38.0），
      前伸 11cm 的一把草（半径 0.14m）会**整个插进马的颈肩里**（实测草把包围盒
      中心 (38.36,1.19,1.09) 落在马身包围盒内，出图里一点都看不见）。
      ⇒ 取"手臂自然垂着、草把拎在身侧"（ex −0.35），草把**竖直**立在手里
        （不跟前臂方向 —— 前臂朝下，草会朝地）。
   ⚠️ 草把摆在腕**上 5cm**、不挂手骨：每帧按腕位重摆（同茶盏/马刷）。 */

/* ⚠️ 2026-10-27：ex 从 −0.35 抬到 **−0.85**（老黄："拿草喂马看不出来、也没有任何动作"）。
   旧角只把前臂从"垂着"抬到胯前，草把停在腿边，读作"抱着一捆草站着"；马嘴在身前
   0.6m、高 0.9m，前臂抬平（约 −0.9）手腕才伸到马嘴下方，草把落在嘴前。
   摆动幅度在 16-actors 的 hay 块里叠（±0.10rad 慢摆 = 递草）；up 保持 5cm。 */
export const HAY_ARM = { ex: -0.85, up: 0.05, out: 0.13, lean: 0.30, len: 0.30 };
export const _hyE = new THREE.Vector3();
export const _hyQ = new THREE.Quaternion();
export const _hyQ2 = new THREE.Quaternion();
export const _hyF = new THREE.Vector3();
export const _hyY = new THREE.Vector3(0, 1, 0);

/* 手里的一把草：11 根细锥管（InstancedMesh，1 个 draw call）沿 +Z 散开 + 两道捆绳。
   梢头偏青绿（"是草不是棍"）—— 用一条竖渐变贴图而不是顶点色：InstancedMesh 的
   顶点色只管"整根一个色"，而草要根黄梢绿。
   ⚠️ 第一版用 mergeGeometries 拼 11 根管，结果**静默失败**（合并返回空、草不出现，
      且异常被资产加载器的 onError 吞掉）⇒ 改用 InstancedMesh，不碰合并。
   局部 +Z = 草梢方向、原点在捆绳处。 */

export function makeHayStrawTex(){
  const c = document.createElement('canvas');
  c.width = 2; c.height = 16;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 16, 0, 0);   // 下（根）=黄褐 → 上（梢）=青绿
  grd.addColorStop(0.0, '#D8BC74');
  grd.addColorStop(0.55, '#E3CF8A');
  grd.addColorStop(1.0, '#A8BE62');
  g.fillStyle = grd; g.fillRect(0, 0, 2, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeHayHandful(holder){
  const g = new THREE.Group();
  g.name = 'actorHay';
  /* 圆柱轴就是 +Y ⇒ 草把**竖直**（手臂垂着的时候，跟"前臂方向"走会朝地） */
  /* ⚠️ 2026-10-27（老黄："马夫手上的草料或者刷子根本看不出拿的有工具"）：
     原来 11 根、半径 3.5~5.5mm、整束只有 3cm 宽 ⇒ 10~15m 外只有 3~5 个像素。
     现在 16 根、半径 9~13mm、整束约 10cm 宽、30~36cm 长（仍是一只手能拎住的量），
     并加了两道捆绳 —— 远看是"一捆草"，不是一根细棍。 */
  const geo = new THREE.CylinderGeometry(0.006, 0.009, 1, 5, 1);
  const N = 24;
  const im = new THREE.InstancedMesh(geo,
    new THREE.MeshStandardMaterial({ map: makeHayStrawTex(), roughness: 0.95, metalness: 0.0,
                                     envMapIntensity: 0.30 }), N);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++){
    const a = (i / N) * Math.PI * 2 + (i % 3) * 0.21;
    const sp = 0.050 + (i % 4) * 0.012;           // 梢头张开、根部收在一起
    const len = HAY_ARM.len - 0.02 + ((i * 7) % 5) * 0.016;
    pv.set(Math.cos(a) * sp * 0.55, len * 0.5 - 0.02, Math.sin(a) * sp * 0.55);
    q.setFromAxisAngle(up, (i % 5 - 2) * 0.10);   // 每根略歪，不成一束直棍
    /* 每根往自己那个方向倒一点点，做成"一把"而不是"一根柱" */
    sv.set(1, len, 1);
    M.compose(pv, q, sv);
    im.setMatrixAt(i, M);
  }
  im.instanceMatrix.needsUpdate = true;
  im.name = 'actorHayStraws';            // 布局指纹排除名单里登记（手里的小件）
  im.castShadow = false;                          // 手里的小件，投影贡献≈0
  im.receiveShadow = true;
  im.userData.noMerge = true;
  g.add(im);
  for (const y of [0.015, 0.075]){
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.009, 5, 14), MAT.woodDark);
    tie.rotation.x = Math.PI / 2;                 // 环面躺平 ⇒ 套在竖直的草把上
    tie.position.set(0, y, 0);
    tie.castShadow = false; tie.receiveShadow = true;
    tie.userData.noMerge = true;
    g.add(tie);
  }
  g.userData.noMerge = true;
  holder.add(g);
  return g;
}

/* route = 往复踱步线（端点交替）。y 一律现算 groundHeight，不给写死的高度：
   两位人物站的草坪是一片缓坡，写死等于在坡上悬空/陷地。 */
/* ── 主人出迎的路线（S2 · 2026-10-23）────────────────────────────────────────
   从堂前 (1.2,−5.7) 绕到门内迎客点 (0.15,19.75)。走**东侧**：北岸往东 → 上拱桥 →
   过桥后沿架高廊道往南 → 廊道南端逐级下到地面 → 绕假山东侧空地往南 → 向西到门口。

   这些点不是"照着平面图画的"，是量出来的（outputs/_diag/host-layers.mjs 逐点列出
   所有命中面，outputs/_diag/host-route-verify.mjs 沿线 0.25m 一档量踏面 + 净距）：
     · 拱桥桥面实测 1.30(北端) → 2.10(桥心) → 1.30(南端)，桥宽 2.9m、中心线 x≈8.3；
       桥北要靠 (7.6,−3.2) 那道 0.69m 的踏步上来 —— 直接从地面切到桥面会是 1.3m 的坎。
     · 桥南 z 9.6~11.2 仍是一段**架高廊道**（桥面 1.30m，下面还有地面），
       所以 floorRay 不能取"最低面"（会踩到桥下），必须跟着连续性走（见 sampleFloorNear）。
     · 廊道 z 12~13.4 逐级降到 0.38m，再往东到 x≈12.5 才回到地面。
     · 南园正中 z 13.5~19.3 / x 0~4.5 是一整块假山（净距 0），只能绕东侧空地（x 12~16）。
   改桥/廊/假山的位置就要重跑 host-route-verify.mjs，否则会走进去。 */
