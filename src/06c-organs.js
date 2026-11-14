// 06c-organs: 植被专用几何体（W1 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出，纯几何生成器族。
// 门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
import { THREE, mergeGeometries } from '../vendor.js';
import { TAU } from './00-config.js';

export function makeLeafVolumeGeo({ len, wTop, wMid, thick, segs = 2, cup = 1.25, bow = 0 }){
  /* ⚠️ 2026-09-15 减面：这里原来是 NU=5 的**闭合体**（顶/底/侧/端四面封口），
     实测单片 52 tri（旧注释还按公式误写成 10，审计 B20 已纠正）。
     实测叶量：柳叶 ~3.3 万 + 竹叶 7,653 ≈ 4 万片 × 52 ≈ 209 万 tri，占全场一半以上。
     叶片材质本就是 DoubleSide —— 真厚度只在侧视瞬间有意义，而簇内叶子互相遮挡，
     侧视缺口肉眼不可辨。改为单张弯面（NU=2，u=0 处恰有顶点，中肋折线反而更锐）：
     segs=2 → 9 顶点 8 tri/片，全场省 ~180 万 tri。
     thick 参数保留在签名里（柳/竹的调用都传它），已不参与几何。 */

     const NU = 2;
  const pos = [], idx = [];
  const widthAt = (t)=>{
    const w = (t < 0.5) ? wMid + (wTop - wMid) * (t / 0.5)
                        : wTop * Math.pow(1 - (t - 0.5) / 0.5, 0.85);
    return Math.max(0.004, w);
  };
  const mainY = (t)=> len * t;
  const rows = [];
  for (let i = 0; i <= segs; i++){
    const t = i / segs, w = widthAt(t), y = mainY(t);
    const zBow = bow * Math.sin(Math.PI * t);    // 整片微弯（竹叶的下垂）
    const row = [];
    for (let j = 0; j <= NU; j++){
      const u = (j / NU) * 2 - 1;
      row.push(pos.length / 3);
      pos.push(w * u, y, -cup * w * u * u + zBow);
    }
    rows.push(row);
  }
  for (let i = 0; i < segs; i++){
    for (let j = 0; j < NU; j++){
      const a = rows[i][j], b = rows[i][j+1], c = rows[i+1][j], d = rows[i+1][j+1];
      idx.push(a, b, c,  b, d, c);              // 绕序与原顶面一致（法线朝 +z）
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* 竹叶：披针形叶片 —— 中部最宽、叶尖渐收，中肋起脊、整片略下垂 */


export function makeBambooLeafGeo(){
  /* 竹叶要比柳叶明显长、且整片下垂（bow 为负=向 −z 弯，配合 rz 的俯角）。
     ⚠️ 2026-09-16 用户反馈"竹叶像芭蕉叶"：旧 len 1.16m（实例再 ×0.7~1.3
     → 单片 0.81~1.5m）接近芭蕉叶尺度。真实竹叶 15~30cm，游戏里放大到
     ~0.42m 基准（×实例缩放 → 0.29~0.55m）保持可读；宽同步缩到 2.4~3.1cm，
     bow 按 len 比例缩小（-0.095 → -0.042）。叶量在 makeBamboo 里每枝
     3~5 → 4~7 片补偿缩小后的密度。 */
  return makeLeafVolumeGeo({ len: 0.42, wTop: 0.024, wMid: 0.031,
                             thick: 0.011, segs: 2, cup: 0.45, bow: -0.042 });
}


/* 荷花瓣：宽圆、两侧向前抱、尖端微微后卷（真实荷花是杯状层叠，不是尖勺放射）
   ⚠️ 旧版是「0.2 宽 x 0.62 长的尖勺」；配上实例缩放 sc=0.8~1.25，
   整朵花开到 0.6~0.8m —— 比荷叶还大（用户实拍）。真实荷花直径 15~25cm。
   现在几何做成单位长度约 0.92（宽 0.68、圆头、内凹），实例缩放改用 0.092~0.116，
   花朵直径落在 0.22~0.28m，与真实荷花、也与池中 GLB 荷花同一量级。 */

export function makeLotusPetalGeo(){
  /* 2026-09-29 重构（老黄近看反馈"花瓣全是尖锐几何图形，特别刺眼"）：旧版
     ShapeGeometry 只有**轮廓**是曲线，内部三角化稀疏 ⇒ 瓣面是一大片、大三角
     硬棱折纸（近看特写全是直边棱线）。改为参数化曲面网格：长 12 段 × 宽 8 段，
     宽向浅杯（u² 抬边）+ 纵向瓣尖内扣，法线由 computeVertexNormals 平滑连 conjugate。 */

     const L = 0.92, W = 0.32;                    // 瓣长 / 最大半宽（2026-09-30：0.36 偏宽近看糊成绒球、
                                               // 0.28 又窄成星芒刷子 —— 取中间值）
  const segL = 12, segW = 8;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segL; i++){
    const t = i / segL;                        // 0=瓣根 1=瓣尖
    const halfW = W * Math.sin(Math.PI * Math.min(1, t * 1.06)) * (1 - t * 0.25);
    const y = t * L;
    for (let j = 0; j <= segW; j++){
      const u = (j / segW) * 2 - 1;            // -1..1（宽向）
      const x = u * halfW;
      /* 横向浅杯（|u|² 抬边）+ 纵向瓣尖内扣（t^2.4 向花心回弯） */

      const z = (u * u) * halfW * 0.55 - Math.pow(t, 2.4) * 0.10;
      pos.push(x, y, z);
      uv.push(j / segW, t);
    }
  }
  for (let i = 0; i < segL; i++){
    for (let j = 0; j < segW; j++){
      const a = i * (segW + 1) + j, b = a + segW + 1;
      idx.push(a, b, a + 1,  a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* 荷叶：近乎完整的圆形，边缘轻微起伏、微微上翘（非睡莲的大 V 缺口） */


export function makeLilyPadGeo(){
  const R = 0.62;
  const s = new THREE.Shape();
  const notch = 0.07;                       // 只留一条细缝
  const seg = 26;
  for (let i = 0; i <= seg; i++){
    const a = notch + (i / seg) * (TAU - notch * 2);
    const rad = R * (0.95 + 0.05 * Math.sin(a * 4));   // 边缘起伏
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    i === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
  }
  s.lineTo(0, 0);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 22);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.hypot(x, z) / R;
    /* 2026-10-26 老黄"这片荷叶穿模"：碟沿原来翘到 0.10m，而同一丛叶盘的高度差只有 2cm
       ⇒ 一片的边沿必然切进邻片的盘面。压到 0.045（还是浅碟，但不再互相穿插）。 */
    p.setY(i, Math.pow(d, 2.2) * 0.045);
  }
  g.computeVertexNormals();
  return g;
}

/* ══ 池面补叶（2026-09-30 二轮：池边"大荷花"整体撤下，只保留它的叶盘）═════════
   老黄实测反馈四连（截图 + 红框逐格放大判读）："荷花完全不像荷花""各种悬空、
   不认识的植物结构""睡莲又到草皮上""居然没有荷叶了"。两轮（GLB → 程序化）
   都没能把"池边大荷花"做到不穿帮，这轮**不再修补，撤**：
     · 花：24 片长窄尖瓣三圈拼出来，近看是"炸开的尖刺"（红框 1/2 判读原话），
       远看读不出层次 ⇒ 撤；
     · 杆+萼：1.5~1.9m 的细杆顶一个 0.24m 高的绿萼 —— 20m 外细杆不可见、花太小
       读不出，只剩一个**绿色萼锥剪影浮在半空**，背景恰好是正堂的白台基 ⇒
       用户看到"插在台阶/铺地上的光秃绿锥"（隐藏实验：藏该合并件 ROI 亮度 +80；
       射线+顶点簇：命中点其实都在池里，是屏幕投影叠到了台基上）⇒ 撤；
     · 叶盘：留下（36 片是"没有荷叶"那条的唯一补偿），但**必须夹回池内** ——
       旧版没走 clampAquaticToPond，实测 5 片落在岸上（老黄："睡莲又到草皮上了"）。
   ⚠️ 叶盘落点用独立 jr 流，不吃全局 rnd —— 撤花撤杆不影响全局随机流的位置
      （08 那边对 rr 的等量燃烧另有注释）。材质 MAT.lily ⇒ 季节显隐与风摆自动继承。 */

export function makeReedBladeGeo(h = 1.5){
  const seg = 7, verts = [], idx = [], uvs = [];
  for (let i = 0; i <= seg; i++){
    const t = i / seg;
    const y = h * t;
    const lean = t * t * 0.42;
    const ww = 0.045 * (1 - t * 0.85);
    verts.push(lean - ww, y, 0,  lean + ww, y, 0);
    uvs.push(0, t, 1, t);
  }
  for (let i = 0; i < seg; i++){
    const a = i * 2;
    idx.push(a, a + 2, a + 1,  a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* 青竹丛：竹节圆柱 + 带弧度的叶簇 */


export function makeWisteriaFloretGeo(){
  const pos = [], idx = [], uvs = [];
  const W = 0.017;   // 半宽（全宽 ~3.4cm，与真实花冠同量级）
  // 旗瓣：竖起的上翼
  pos.push(-W, 0, 0,  W, 0, 0,  W*0.86, 0.026, -0.006, -W*0.86, 0.026, -0.006);
  // 左翼瓣：斜伸展开（外翻）
  pos.push(-W*0.2, 0.004, 0.002, -W*1.15, -0.006, 0.012, -W*0.85, -0.02, 0.016, -W*0.05, -0.012, 0.004);
  // 右翼瓣：镜像
  pos.push(W*0.2, 0.004, 0.002, W*1.15, -0.006, 0.012, W*0.85, -0.02, 0.016, W*0.05, -0.012, 0.004);
  // 龙骨瓣：下唇收拢（比翼瓣窄、更下垂，两瓣合抱）
  pos.push(-W*0.5, 0.006, 0.006, W*0.5, 0.006, 0.006, W*0.32, -0.03, 0.010, -W*0.32, -0.03, 0.010);
  for (let i = 0; i < 12; i++) uvs.push(0, 0);
  idx.push(0,1,2, 0,2,3,   4,5,6, 4,6,7,   8,9,10, 8,10,11);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* 紫藤（重建）：老藤沿梁 + 短花茎 + 真·总状花序（下垂花穗）。
   旧版把 85~130 颗"纽扣"均匀裹满整根下垂枝 —— 读作实心"毛毛花肠"。
   真实紫藤：花穗从茎上一簇簇垂下，每穗 16~26 朵**互生**小花沿穗轴排布、向梢端渐小，
   基部（近茎、先开）淡紫 #C9B3EC → 穗梢（下垂末端、未开苞）深紫 #6A3E96 逐朵渐变
   （不是整串一个色），穗间露茎。 */
/* spanCap：主藤藤长上限（米），默认不设。2026-09-28 加 —— bigW1（连廊转角那丛，
   心 (13.2,·,1.2)、scale 2.6 ⇒ 藤长撞到 10 的封顶）最西端探进了拱桥的栏杆带
   （桥 (8.4,·,4.6)、栏杆带到 x≈9.85），花穗垂下来正搭在桥栏上（老黄截图
   "紫藤长到桥上了"）。收短+东挪后悬挂花穗最西点（含 ±1.04m 摆幅）= 10.26m，
   桥外余量 0.41m。只封主藤长度，穗长/花量/花色（跟 scale 走）一律不动。 */

export function makePeachLeafGeo(){
  return makeLeafVolumeGeo({ len: 0.26, wMid: 0.008, wTop: 0.030,
                             thick: 0.010, segs: 3, cup: 0.34, bow: 0.022 });
}

/* 桃花：五张**花瓣贴图卡**（每张 2 tri）+ 中央花蕊球 = 12 tri/朵。
   ⚠️ 旧版 5 片 ShapeGeometry 花瓣 ≈160 tri/朵，同样预算只能开 65 朵 —— "花满树"开不出来。
   花盘法线朝 +Z（五瓣绕 Z 排布、各向外倾 +0.55 成浅碗），实例化时把 +Z 对到朝外方向。 */

export function makePeachFlowerGeo(){
  const pl = 0.060, pw = 0.048;                    // 单瓣长 / 宽
  const parts = [];
  for (let k = 0; k < 5; k++){
    const q = new THREE.PlaneGeometry(pw, pl, 1, 1);
    q.translate(0, pl * 0.5 + 0.006, 0);           // 瓣基离花心留一点间隙
    q.rotateX(0.55);                               // 瓣面向外张开成浅碗（碗口朝 +Z）
    q.rotateZ((k * TAU) / 5);                      // 五瓣绕花心排列
    parts.push(q);
  }
  parts.push(new THREE.SphereGeometry(0.010, 6, 4));   // 花蕊群（靠实例色压深）
  return mergeGeometries(parts, false);
}

/* ══ 梅花几何（2026-10-06 二轮 · 老黄："红梅的花型也不对"、"梅花和树叶和桃树一模一样，
      远看会觉得就是同一种树"）══════════════════════════════════════════════════════
   与桃花**刻意做形制差别**（不是同一个小碗换个颜色）：
     · 桃：瓣长 0.060 / 宽 0.048、rotateX 0.55（深碗、瓣尖朝外，远看是一小撮）；
     · 梅：瓣长 **0.082** / 宽 **0.070**、rotateX **0.26**（大而近乎平展的浅碟 ——
       真梅花的花瓣圆整外展，正面看是"五瓣圆片"）＋ **明显花蕊**（中央小球 + 6 根细丝），
       蕊用**顶点色压深**（暖褐）⇒ 远看是"五瓣 + 深心"的梅花，而不是一团粉点。
     这也是"太密集"的一半解法：花变大之后**同样朵数**的视觉密度立刻降下来（下面还会减朵数）。
   ⚠️ 顶点色必须给**每个** part 都写（合并要求属性集一致），所以花瓣也写 (1,1,1) 白。
   ⚠️ 顶点色是**线性乘子**：与实例色（花色）相乘 ⇒ 花瓣保色、花蕊被压成暗褐。 */

export function makePlumFlowerGeo(){
  /* ⚠️ 花瓣尺寸：2026-10-07 曾放大 ×1.25（0.082/0.070 → 0.1025/0.0875）—— 那是"远处能画出来"
     的关键之一（默认机位单朵 2.1→2.6px、"藏花"贡献 253→345px）。
     2026-10-08 老黄指出真问题是**形态**（"开成紫藤那种效果…现实中的梅花不是这种密集型开放"）：
     花太大（0.17m）又太多 ⇒ 冠内必然互相叠成一团。⇒ 单朵回到 **0.10m 直径**（pl=0.050），
     远处靠**距离放大**（见 01-materials 的 installBlossomDistanceScale）保住"看得见花色"：
     近处 1.0 倍（真实尺寸 ⇒ 疏枝点花），50m 外 2.6 倍（0.10→0.26m ⇒ 4.4px，仍读得出红/黄）。
     ⚠️ 2026-10-08 二轮（老黄给的真实梅形态资料）：**花瓣长短/倾角要有一点不规则、花心略偏**
        ——"避免画面像图标或剪纸"。这里给每一瓣一个**确定性**的长度与倾角微差
        （用瓣序 k 的正弦，不抽随机、不额外消耗随机流），花心也略偏 3mm。 */

        const K = 0.488, pl = 0.1025 * K, pw = 0.0875 * K;
  const parts = [];
  const paint = (g, r, gg, b) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++){ col[i*3] = r; col[i*3+1] = gg; col[i*3+2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  for (let k = 0; k < 5; k++){
    const lk = pl * (1 + 0.150 * Math.sin(k * 2.17));       // 瓣长 ±15%
    const wk = pw * (1 + 0.120 * Math.cos(k * 1.61));       // 瓣宽 ±12%
    const q = new THREE.PlaneGeometry(wk, lk, 1, 1);
    q.translate(0, lk * 0.5 + 0.004, 0);
    q.rotateX(0.26 + 0.20 * Math.sin(k * 1.33));            // 浅碟：每瓣开合角差更大（自然重叠）
    q.rotateY(0.30 * Math.sin(k * 1.9));                    // ⚠️ 绕**瓣长轴**翻卷 ±17°：五瓣不再共面
    q.rotateZ((k * TAU) / 5 + 0.10 * Math.sin(k * 2.7));    // 瓣间不是严格等分
    parts.push(paint(q, 1, 1, 1));
  }
  /* ⚠️ 花蕊段（2026-10-09 四轮精简）：花量要翻一倍，三角形预算必须先腾出来 ——
     花蕊柱 4 棱**带盖**(16 tri/根 ×6=96) → **3 棱开口**(6 tri/根 ×6=36)；
     花心球 7×5(56) → 4×3(16)。单朵 162 → **62 tri（38%）**。
     半径只有 1.3mm、长度 1.2cm，3 棱开口在近景也读不出棱（而腾出的预算够把朵数翻倍）。 */

     const core = new THREE.SphereGeometry(0.016 * K, 4, 3);
  core.translate(0.003 * K, 0.002 * K, 0.004);              // 花心略偏 ⇒ 不像打印出来的对称图标
  parts.push(paint(core, 0.34, 0.26, 0.12));
  for (let s = 0; s < 6; s++){
    const f = new THREE.CylinderGeometry(0.0026 * K, 0.0026 * K, 0.025 * K, 3, 1, true);   // 3 棱、开口
    f.translate(0, 0.0125 * K, 0);
    f.rotateX(0.42 + 0.10 * Math.sin(s * 2.1));             // 雄蕊长短/角度也带微差
    f.rotateZ((s * TAU) / 6 + 0.25);
    f.translate(0.003 * K, 0.002 * K, 0.006);
    parts.push(paint(f, 0.40, 0.30, 0.14));
  }
  return mergeGeometries(parts, false);
}

/* ══ 梅花的花苞几何（2026-10-08 · 老黄："没有你说的带花苞的枝条…30% 左右的苞（嫩黄色）"）══
   ⚠️ 为什么**必须另做一个几何**，不能"把花缩小当苞"：
     · 花瓣材质带**花瓣形 alpha 贴图**，套在球面上会被 alpha 裁掉一半（画出来是破的）；
     · 而且实测"缩小版的花"读不出来 —— 近景里它仍是一朵小花，不是"圆鼓的苞"（老黄的原话就是
       "没有你说的带花苞的枝条"）。
   ⇒ 单独做一个"水滴状小苞"：竖长椭球（苞身，顶点色全白 ⇒ 颜色交给实例色 = 嫩黄/嫩红）
     + 基部一圈**深色萼片**（顶点色压暖褐，与花瓣/花蕊同一套写法）。 */

export function makePlumBudGeo(){
  const K = 0.488;
  const parts = [];
  const paint = (g, r, gg, b) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++){ col[i*3] = r; col[i*3+1] = gg; col[i*3+2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  /* ⚠️ 尺寸（老黄给的真实梅资料："花苞直径约为盛开花朵的**一半**、体积约其 1/8~1/4、
     不要画成圆球"）：盛开花直径 0.100m ⇒ 苞直径取 **0.052（0.52 倍，落在资料的 1/3~2/3 内）、
     高 0.068（长径比 1.3 ⇒ 椭圆/近圆锥）**。
     ⚠️ 上一版的教训（连踩两次）：0.102 的圆球"太大"（老黄原话），改成 0.045 的收尖椭球后
       又"太小、不成形"（2.6m 处读成红色贴片）⇒ 现在**直径 0.052 且做出"瓣包"的层次**：
       外层花瓣**是苞的外表面**（不是埋在球里），所以近看有纵向瓣脊、远看成饱满椭圆。 */

       const R = 0.042 * K;                  // 苞半径 ≈0.0205m ⇒ 直径 **0.041m**（≈ 盛开花宽的 0.41 倍）
  const H = R * 2.6;                    // 苞高 ≈0.053m（长径比 1.3 ⇒ 椭圆/近圆锥）
  /* ⚠️ 视觉尺寸是**两处一起**决定的：几何 × 实例缩放区间。上一版几何 0.52 倍却被读成
     "还是跟花朵差不多大" —— 因为**区间重叠**：花苞缩放 0.90~1.15（最大 0.069m）、
     花缩放 0.72~1.35（最小 0.085m）⇒ 只差 1.2 倍，眼睛读成一样大。
     现在几何收到 **0.41 倍**、区间改花苞 0.85~1.05 / 花 0.85~1.35
     ⇒ 最大的苞 0.051m vs 最小的花 0.100m = **差 2 倍** ✓ 梯度一眼可见。 */
  /* ⚠️ 本体必须是**圆润的高分段椭球**（2026-10-08 三轮）：
     上一版用 6 片平板围一圈当"包裹的花瓣"，0.3m 贴脸实测判读是"**方块/棱柱状**、平直色块、
     看不出瓣脊"—— 6 个 60° 的大平面就是一个六棱柱。现在：
       · 本体：14×10 段椭球（贴脸 147px 下分瓣足够圆）→ 剪影是椭圆；
       · 瓣脊：本体表面再压 5 条**更暗的细长凸肋**（顺着经线方向）⇒ 近看读得出"外层花瓣包着"；
       · 顶部轻微收细（顶点位移，幅度小 ⇒ 不会又变成多面体）。 */

       const body = new THREE.SphereGeometry(R, 12, 8);   // 2026-10-09 四轮精简 14×10→12×8（仍足够圆润，省 84 tri/苞）
  body.scale(1, 1.30, 1);
  body.translate(0, H * 0.50, 0);
  {
    const pos = body.attributes.position;
    const yTop = H * 0.50 + R * 1.30;
    for (let i = 0; i < pos.count; i++){
      const y = pos.getY(i);
      const k2 = Math.max(0, (y - (H * 0.50)) / (yTop - H * 0.50));   // 0..1（下半→顶）
      if (k2 > 0){ const s = 1 - 0.22 * k2 * k2; pos.setX(i, pos.getX(i) * s); pos.setZ(i, pos.getZ(i) * s); }
    }
    pos.needsUpdate = true; body.computeVertexNormals();
  }
  parts.push(paint(body, 1, 1, 1));                 // 苞身：白 ⇒ 实例色（嫩黄 / 嫩红）
  /* 瓣脊：5 条凸肋（细长椭球），**要真的凸出本体之外**、且明显更暗 ⇒ 近看是"包着的花瓣缝"
     ⚠️ 顺序必须是"先倾斜、后向外平移"：绕**原点**旋转会把已经推到外面的肋又拉回本体内
        （实测：translate 之后 rotateZ(0.18) 让肋心从 x=0.026 缩到 0.0195 < 本体半径 0.026
         ⇒ 肋整条埋进去，"表面光滑得像糖豆、看不出瓣脊"）。 */
  for (let k = 0; k < 5; k++){
    const rib = new THREE.SphereGeometry(R * 0.19, 6, 4);   // 2026-10-09 四轮精简：8→4 段（肋是 4mm 细条，读不出段数）
    rib.scale(1, 3.0, 1);
    rib.rotateZ(0.18);                              // ① 先绕自身倾斜（上端收）
    rib.translate(R * 1.00, H * 0.50, 0);           // ② 再沿径向推出去 ⇒ 凸出本体约 5mm
    rib.rotateY((k * TAU) / 5 + 0.5);               // ③ 绕苞轴分布
    parts.push(paint(rib, 0.60, 0.58, 0.53));
  }
  /* 花萼：**明显**的深色小杯，托在苞身下沿（资料："花萼明显"）—— 比本体略宽 ⇒ 露出一圈 */

  const calyx = new THREE.CylinderGeometry(R * 0.78, R * 1.12, R * 0.92, 6);   // 8→6 段（口径 3cm，6 段看不出棱）
  calyx.translate(0, R * 0.22, 0);
  parts.push(paint(calyx, 0.16, 0.13, 0.06));
  /* 短花梗（资料："花梗短"）：**很短**、大半藏在花萼里 —— 上一版给到 R*1.5 且挂在萼下，
     实测它把花苞的包围盒高度抬到 0.103m（= 盛开花宽的 0.87 倍），量出来的"花苞"变成一根手指。 */

     const pedicel = new THREE.CylinderGeometry(R * 0.16, R * 0.22, R * 0.9, 4);   // 5→4 段
  pedicel.translate(0, R * 0.05, 0);
  parts.push(paint(pedicel, 0.19, 0.15, 0.07));
  return mergeGeometries(parts, false);
}

/* ══ 梅花的**凋谢**几何（2026-10-08 二轮 · 老黄给的真实梅资料）═════════════════════════
   资料："花瓣失去张力，**向下卷曲**或松散脱落，颜色略微变暗，**花心和雄蕊暴露**，
        部分花瓣残留在花托上，花梗略显干燥"。
   ⇒ 单独一份几何：花瓣**短一档**且**向下折**（rotateX 大角 ⇒ 碟变成"倒扣的碗"），
     只留 4 片（"部分脱落"），花心/雄蕊照旧露着（雄蕊相对更长一点 —— 花瓣合上了，蕊才显得露出来）。 */

export function makePlumWitheredGeo(){
  const K = 0.488, pl = 0.1025 * K * 0.86, pw = 0.0875 * K * 0.92;
  const parts = [];
  const paint = (g, r, gg, b) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++){ col[i*3] = r; col[i*3+1] = gg; col[i*3+2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  for (let k = 0; k < 4; k++){                       // 4 片（脱落了一片）
    const lk = pl * (1 + 0.14 * Math.sin(k * 1.9));
    const q = new THREE.PlaneGeometry(pw * (1 + 0.10 * Math.cos(k * 2.3)), lk, 1, 1);
    q.translate(0, lk * 0.5 + 0.004, 0);
    q.rotateX(0.92 + 0.22 * Math.sin(k * 1.7));      // **向下折**（0.92~1.14 rad ≈ 53°~65°）
    q.rotateZ((k * TAU) / 4 + 0.22 * Math.sin(k * 2.9));
    parts.push(paint(q, 0.92, 0.90, 0.88));          // 残瓣略暗
  }
  const core = new THREE.SphereGeometry(0.019 * K, 4, 3); core.translate(0, 0, 0.004);   // 2026-10-09 四轮精简 7×5→4×3
  parts.push(paint(core, 0.46, 0.35, 0.15));          // 花托：亮一档 ⇒ 花瓣下垂时读得出"花心外露"
  for (let s = 0; s < 6; s++){                        // 雄蕊露出来（更长、更亮 = 凋谢最硬的识别特征）
    const f = new THREE.CylinderGeometry(0.0030 * K, 0.0030 * K, 0.040 * K, 3, 1, true);   // 4 棱带盖→3 棱开口
    f.translate(0, 0.020 * K, 0);
    f.rotateX(0.26 + 0.12 * Math.sin(s * 2.4));
    f.rotateZ((s * TAU) / 6 + 0.25);
    f.translate(0, 0, 0.006);
    parts.push(paint(f, 0.58, 0.46, 0.20));
  }
  return mergeGeometries(parts, false);
}

/* 桃子：心形/卵形，顶端有突尖，腹缝有浅沟

   用 LatheGeometry 沿纵轴旋转出基本形，再压扁一侧做心形凹陷 */


export function makePeachFruitGeo(){
  const h = 0.07;     // 纵长 ~7cm（带尖）
  const maxR = 0.048; // 最大横径
  const pts = [];
  // 从底部到尖的半截面（右侧）
  pts.push(new THREE.Vector2(0.008, -h*0.45));     // 果底（凹洼）
  pts.push(new THREE.Vector2(maxR*0.55, -h*0.38));
  pts.push(new THREE.Vector2(maxR*0.85, -h*0.15));
  pts.push(new THREE.Vector2(maxR, h*0.05));        // 最宽处在中下部
  pts.push(new THREE.Vector2(maxR*0.92, h*0.30));
  pts.push(new THREE.Vector2(maxR*0.7, h*0.55));
  pts.push(new THREE.Vector2(maxR*0.4, h*0.75));
  pts.push(new THREE.Vector2(maxR*0.18, h*0.88));
  pts.push(new THREE.Vector2(0.006, h));            // 果尖
  // 16 → 12 段：果量从 80 提到 130，单果 ~256 tri 全株就是 3.3 万，12 段够用（7cm 的果子看不出棱）
  const g = new THREE.LatheGeometry(pts, 12);
  // 做心形：沿 x 方向压扁一点，并在 +x 侧（腹缝）做内凹
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++){
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // 整体沿 z 轴稍扁（侧视椭圆）
    const newZ = z * 0.82;
    // 腹缝凹陷（+x 侧向内收一点，形成心字形）
    const xFactor = x > 0 ? 0.82 + 0.18 * (1 - Math.abs(y) / h) : 1.0;
    const newX = x * xFactor;
    pos.setX(i, newX);
    pos.setZ(i, newZ);
  }
  g.computeVertexNormals();
  return g;
}

/* ══ 枯枝挂灯（2026-09-25 · 灯会方案B）══════════════════════════════════════
   挂在树上的小灯笼：一盏一个 InstancedMesh 实例（每株树一个网格 ⇒ 全园 +2 draw call）。
   · **每盏不同色**：用 `InstancedMesh.setColorAt`（instanceColor），色板取参考图那五色系
     （橙/粉/黄/绿/蓝）。⚠️ 必须配 `vertexColors:false` + 实例色才生效，且材质要 `toneMapped:false`
     —— 灯是"自己在发光"，不该被 ACES 色调映射压暗，否则远看全是灰点。
   · **不新增真光源**：纯 emissive/Basic 材质伪造发光，全场真光源仍只有灯笼那 5 盏
     （夜里月光接管阴影方向，加真灯就必须同步改阴影逻辑 —— 计划书坑①）。
   · 形状：极简灯笼 = 上下两个小盖 + 鼓腹（Lathe），高 ~0.20m、直径 ~0.13m ——
     远看是一串彩点，近看能认出是灯笼；不追求细节（挂满上百盏，细节看不见还白花三角）。 */

export const TREE_LANTERN_COLORS = [
  0xFF6B35,   // 橙
  0xFF8FAB,   // 粉
  0xFFD166,   // 黄
  0x7BD389,   // 绿
  0x6BA8FF,   // 蓝
];

export function treeLanternColor(rr2){
  const c = TREE_LANTERN_COLORS[(rr2(0, TREE_LANTERN_COLORS.length)) | 0];
  /* 每盏亮度再抖动一档（±18%）：同色系全等亮度会读成"塑料玩具"，有亮度差才像一串灯 */

  const k = 0.82 + rr2(0, 0.36);
  return new THREE.Color(c).multiplyScalar(k);
}

export function makeTreeLanternGeo(){
  const body = new THREE.LatheGeometry([
    new THREE.Vector2(0.026, -0.085),
    new THREE.Vector2(0.062, -0.062),
    new THREE.Vector2(0.068,  0.000),   // 鼓腹
    new THREE.Vector2(0.062,  0.062),
    new THREE.Vector2(0.026,  0.085),
  ], 10);
  const cap = new THREE.CylinderGeometry(0.030, 0.030, 0.016, 8);
  cap.translate(0,  0.090, 0);
  const base = new THREE.CylinderGeometry(0.030, 0.030, 0.016, 8);
  base.translate(0, -0.090, 0);
  const cord = new THREE.CylinderGeometry(0.004, 0.004, 0.10, 4);
  cord.translate(0, 0.148, 0);          // 挂绳：连到枝上，灯才是"挂"着的不是"飘"着的
  return mergeGeometries([body, cap, base, cord], false) || body;
}
/* 已挂上的挂灯网格（12-env 的 applyPresence 按 count 开/关；门禁也读它） */
