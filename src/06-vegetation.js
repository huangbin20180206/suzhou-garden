// 06-vegetation: from index.html inline 493..2993
import { THREE, mergeGeometries, GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder } from '../vendor.js';
/* ⚠️ world 从 02-scene 取，**不能**从 08-assemble 取：08 的模块体要读本模块的
   rippleInst / perchingAnchors 等模块级常量，若本模块反向 import 08 就成环 ——
   本模块的 body 被推迟到 08 之后，而 08 的 body 读到的就是 TDZ
   （实测 "Cannot access 'rippleInst' before initialization"）。依赖方向：02 → 06 → 08。 */
import { world, scene, ACTIVE_QUALITY, renderer } from './02-scene.js';
/* ⚠️ onAssetAttached 也**不能**静态 import 12-env：12-env 的模块体在 world 之前求值，
   而它 import 08；本模块一旦 import 12-env，12-env 就会把 08 提前拽进来 → 同一个 TDZ。
   它只在 loadAssetOnce 的**回调**里调用（那时一切就绪），故走 00-config 的 HOOKS 延迟绑定。 */
import { TAU, rnd, rr, CFG, mulberry32, bootMark, HOOKS } from './00-config.js';
/* 2026-10-02 CDN 双轨：assetUrl/withCdnFallback 只改"请求发到哪"，settleAsset /
   reportAssetProgress 的键**仍是相对路径**（预载清单键一位不挪）；ASSET_CDN.base
   为空（默认）时三个入口都走与旧版逐字节相同的直接调用。 */
import { onAssetFailed, assetUrl, ASSET_CDN, withCdnFallback } from './13-preload.js';

/* ── 布局专用抖动流（2026-09-23 · T0）────────────────────────────────────
   为什么必须独立：`Math.random` 是**全局共享流**，被时序类代码在**异步/按帧**时刻消费
   （Three.js 每 new 一个对象生成 UUID 就抽 4 次；还有涟漪、音景…）。布局若也吃这条流，
   它拿到的值就随"加载时序"错位 —— 实测：把 Math.random 换常量后 4 连跑（含冷启动）逐位一致；
   换回定种子流则冷启动偶发不同（竹叶合计 41989 vs 42230、竹竿首实例坐标不同、全局流总数 996320 vs 999246）。
   独立种子流后，布局只由 (rnd 全局流 + 本流) 决定，与"资产何时加载完 / 缓存冷热"无关。
   ⚠️ 本流只给**布局/装配**用；运行期效果（spawnRipple 的水痕抖动、风场调度、雨雪粒子）继续用
      Math.random —— 它们不参与建场，且"每次不同"正是想要的效果。 */
const jr = mulberry32(20260923);
import { MAT, WIND, addWind, AUX_PASS_HIDDEN } from './01-materials.js';
import { mesh } from './03-factory.js';
import { POND_RADII, insidePond, markUnderwater } from './05-water.js';
/* ══════════════════════════════════════════════════════════════
   6 · 植被
   ══════════════════════════════════════════════════════════════ */

/* ── 植被专用几何体（带弧度，避免"纸片感"） ── */

/* 竹叶：披针形，顺叶长下垂 */
/* ── 叶片体积化：把单面片换成"有厚度、带中肋"的闭合立体叶 ──
   原来两片叶子都是 ShapeGeometry：竹叶是零厚度曲面 + 一点 Z 下凹，柳叶干脆是纯平面。
   薄片的问题不是远看，而是**近景与逆光**：侧视时整片叶子会消失成一条线，
   也没有中肋那道纵向高光。真实竹叶的横截面是浅 V + 中肋，柳叶是细长带脊。

   做法：单张弯面 —— 横向三顶点（两缘 + 中肋），cup 让中肋顶点凸起成脊，
   光照下照样拉出中肋那道高光折线。 */
function makeLeafVolumeGeo({ len, wTop, wMid, thick, segs = 2, cup = 1.25, bow = 0 }){
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
function makeBambooLeafGeo(){
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
function makeLilyPadGeo(){
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
    p.setY(i, Math.pow(d, 2.2) * 0.1);      // 边缘上翘成浅碟
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
export function makePondPads(spots){
  const g = new THREE.Group();
  const padGeo = makeLilyPadGeo();
  const padsPer = 3;
  const pads = new THREE.InstancedMesh(padGeo, MAT.lily, spots.length * padsPer);
  pads.castShadow = false; pads.receiveShadow = true;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const AY = new THREE.Vector3(0, 1, 0);
  const jr = mulberry32(20260931);              // 独立流（铁律 1：不吃全局 rnd）
  let slot = 0;
  for (const sp of spots){
    for (let k = 0; k < padsPer; k++){
      const a = jr() * TAU, rad = 0.45 + jr() * 1.15;
      let wx = sp.x + Math.cos(a) * rad, wz = sp.z + Math.sin(a) * rad * 0.85;
      /* 落点抽完再夹回（不重抽 —— 同 makeAquatic 的做法与理由）。
         edge = 这片叶盘的真实半径（jr 流是本函数私有的，先抽 scale 再夹回不碍事）——
         2026-09-30 二轮：0.85×岸线只管中心，池腰窄处兜不住边缘（见 clamp 注释）。 */
      const sc = (0.9 + jr() * 0.7) * sp.s;
      const cl = clampAquaticToPond(0, 0, wx, wz, sc * 0.62);
      wx = cl.x; wz = cl.z;
      p.set(wx, CFG.water + 0.075 + jr() * 0.02, wz);
      q.setFromAxisAngle(AY, jr() * TAU);
      s.setScalar(sc);
      m.compose(p, q, s);
      pads.setMatrixAt(slot++, m);
    }
  }
  pads.instanceMatrix.needsUpdate = true;
  pads.frustumCulled = false;                    // 实例位置由矩阵给出、由 shader 风摆，CPU 包围球不可靠
  g.add(pads);
  return g;
}

/* 水草叶片：上部弯曲 */
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
export function makeBamboo(x, z, count = 9, hBase = 6.6){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  // 竹竿与竹梢合成单一几何体 —— 分开生成时两者缩放/旋转基准不同会错位成"断头"
  const culmBody = new THREE.CylinderGeometry(0.052, 0.082, 0.88, 7);
  culmBody.translate(0, 0.44, 0);
  const culmTip = new THREE.ConeGeometry(0.052, 0.12, 7);
  culmTip.translate(0, 0.94, 0);
  const stalkGeo = mergeGeometries([culmBody, culmTip], false);
  const leafGeo  = makeBambooLeafGeo();
  const stalks = [], leaves = [], branchlets = [];
  const clumpH = hBase * rr(0.76, 1.18);      // 每丛一个基准高，竿间再拉开高差
  for (let i = 0; i < count; i++){
    const h = clumpH * rr(0.52, 1.2);
    const ox = rr(-0.95, 0.95), oz = rr(-0.95, 0.95);   // 收窄丛幅，避免叶片越出围墙
    const tilt = rr(-0.09, 0.09);
    stalks.push({ x: ox, z: oz, h, tilt });
    /* ⚠️ **竿是斜的，所有长在竿上的东西必须跟着斜**（2026-10-01 冬季缺陷根因）。
       竹竿实例化用 `Euler(s.tilt, 0, s.tilt*0.8)`（±0.09 rad），但**竹节环、竹枝、
       竹叶原先都按"竖直轴"摆**（y = s.h*k/6 直接落 x/z = s.x/s.z）——
       在 y≈6m、tilt 0.09 时横向偏出去 **~0.5m**，而竹节环半径只有 0.066m ⇒
       一圈圈圆环悬在竹竿旁边几十厘米处。
       老黄 2026-10-01 实拍："竹子枝头有很多悬空的小圆环状物体"。
       为什么**只有冬天报**：夏/秋叶量大（bambooLeaf 0.33~1.0）把这些环盖住了，
       冬季 `bambooLeaf: 0.33` 才露出来 —— **缺陷一直在，只是平时看不见**。
       下面 toWorld() 就是"沿斜竿的真实位置"：先按竿的四元数旋转、再平移到基座。
       ⚠️ 它只消耗位置，**不消耗任何 rnd()/rr()** ⇒ 全局随机流完全不受影响（铁律 1）。 */
    const _sq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, tilt * 0.8));
    const _org = new THREE.Vector3(ox, 0, oz);
    stalks[stalks.length - 1].sq = _sq;   // 竹节环也要用这四元数（见下面 nodeInst）
    /* 局部坐标 (lx,ly,lz) → 世界：按竿的真实倾角转过去再落基座。
       0,ly,0 就是"竿上高度 ly 处"；lx/lz 是垂直于竿的横向偏移（枝的伸展方向）。 */
    const toWorld = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(_sq).add(_org);
    /* 竹枝 + 叶：每竿 5~8 根**真枝**，从竿节外伸并下垂，叶片沿枝的外半段着生。
       ⚠️ 上一版没有枝：每片叶从竿身伸一根半径 0.011、长 ≤0.34 的短枝到叶基 ——
       4m 外完全看不见，贴脸看就是"一丛针 + 从一点放射的叶"，用户反馈"竹叶还是有悬空"。
       现在换成"叶 → 竹枝 → 竹竿"三级都可见，叶基**直接落在枝上**（不再靠细短枝去够），
       同一簇的叶沿枝铺开、不再共点，星芒感随之消失。 */
    const nBr = 5 + ((rnd()*4)|0);
    for (let b = 0; b < nBr; b++){
      const y0 = h * rr(0.28, 0.94);
      const a  = rr(0, TAU);
      const Lb = rr(0.42, 0.98) * (0.55 + 0.45 * (y0 / Math.max(0.5, h)));   // 上部的枝更长
      const droop = Lb * rr(0.28, 0.60);
      const bend  = rr(-0.22, 0.22);
      const pts = [];
      for (let k = 0; k <= 3; k++){
        const t = k / 3;
        const r = Lb * 0.92 * Math.sin(t * Math.PI * 0.5);   // t=0 落在竿轴上 → 枝从竿里长出来，不留缝
        const y = y0 + Lb * 0.12 * Math.sin(t * 1.5) - droop * t * t;
        const a2 = a + bend * t;
        /* ⚠️ t=0 那个点原先写死在**竖直轴** (ox,y,oz) 上，而竿是斜的 ⇒ 枝根插不进竿里
           （与竹节环同一个根因，只是偏移小些、被叶片盖住所以没被单独报）。 */
        const bp = toWorld(Math.cos(a2) * r, y, Math.sin(a2) * r);
        pts.push(bp);
      }
      branchlets.push({ pts, r0: 0.022, r1: 0.009 });
      /* 2026-09-16 用户反馈"夏竹叶稀疏像病竹快掉光"：旧 4~7 片/枝在 0.42m 小叶下
         绿量不足。提到 6~11 片/枝作为夏季（bambooLeaf=1.0）的茂密基线；
         春/秋/冬由季节通道 bambooLeaf 缩放（见 ENV_SEASON）。
         第三轮：用户"夏季竹叶再增加一倍"——每枝 6~11 → 12~21（中值 8.5→16.5，
         夏总叶量 ~21700→~42000 片）；春/秋/冬系数同步下调保持其绝对观感不变。 */
      const nLeaf = 12 + ((rnd()*10)|0);
      for (let k = 0; k < nLeaf; k++){
        const t = rr(0.42, 1.0);
        const si = Math.min(2, Math.floor(t * 3)), ft = t * 3 - si;
        const A = pts[si], B2 = pts[si + 1];
        const bx = A.x + (B2.x - A.x) * ft, by = A.y + (B2.y - A.y) * ft, bz = A.z + (B2.z - A.z) * ft;
        leaves.push({
          x: bx + rr(-0.022, 0.022), y: by + rr(-0.045, 0.02), z: bz + rr(-0.022, 0.022),
          rx: rr(-0.85, 0.85), ry: rr(0, TAU), rz: rr(-1.75, -0.55),
          s: rr(0.70, 1.30),
        });
      }
    }
  }
  // 竹竿（实例化）
  [MAT.bambooA, MAT.bambooB].forEach((mat, mi)=>{
    const sub = stalks.filter((_, i)=> i % 2 === mi);
    if (!sub.length) return;
    const inst = new THREE.InstancedMesh(stalkGeo, mat, sub.length);
    inst.castShadow = true;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
    sub.forEach((s, i)=>{
      p.set(s.x, 0, s.z);                     // 几何体已从竿底起算（0..1），缩放 s.h 即为整竿
      q.setFromEuler(new THREE.Euler(s.tilt, 0, s.tilt*0.8));
      sv.set(1, s.h, 1);
      m.compose(p, q, sv); inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    g.add(inst);
  });
  // 竹节环
  const nodeGeo = new THREE.TorusGeometry(0.066, 0.016, 4, 8);
  const nodes = [];
  const qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,0));
  stalks.forEach(s=>{
    /* ⚠️ **位置与朝向都必须跟着竿的倾角走**（2026-10-01 冬季缺陷）。
       旧版 np=(s.x, s.h*k/6, s.z) 且朝向恒为 qFlat ⇒ 环留在**竖直轴**上，
       而竿已经倾斜 ⇒ y 越高偏得越远（0.09 rad × 6m ≈ 0.54m），环悬在竿旁。
       正解 = 与竹竿实例化完全同一条公式：world = T + sq · (0, y, 0)，
       朝向 = sq ⊗ qFlat（先摆成水平、再随竿倾斜），两者共用同一个 sq。 */
    const sq = s.sq || new THREE.Quaternion().setFromEuler(new THREE.Euler(s.tilt, 0, s.tilt*0.8));
    const orient = sq.clone().multiply(qFlat);
    const base = new THREE.Vector3(s.x, 0, s.z);
    for (let k = 1; k < 6; k++){
      const y = s.h * k / 6;
      const p = new THREE.Vector3(0, y, 0).applyQuaternion(sq).add(base);
      nodes.push({ p, q: orient });
    }
  });
  const nodeInst = new THREE.InstancedMesh(nodeGeo, MAT.bambooB, nodes.length);
  const nm = new THREE.Matrix4(), np = new THREE.Vector3(), ns = new THREE.Vector3(1,1,1);
  nodes.forEach((n, i)=>{ np.copy(n.p); nm.compose(np, n.q, ns); nodeInst.setMatrixAt(i, nm); });
  nodeInst.instanceMatrix.needsUpdate = true;
  g.add(nodeInst);
  /* 竹枝实体：沿折线扫出的**锥形四棱柱**（每段 8 个三角形，比 TubeGeometry 便宜得多）。
     半径从 0.022 收到 0.009 —— 比原来那根 0.011 的"叶柄短枝"粗一倍、也长一倍以上，
     正常视距下才真的读得出"这是枝"。全丛所有枝合进一个几何体，只多 1 个 draw call。 */
  {
    const tv = [], ti = [];
    const up = new THREE.Vector3(0,1,0), from = new THREE.Vector3(), to = new THREE.Vector3();
    const ring = [[1,0],[0,1],[-1,0],[0,-1]];
    branchlets.forEach(br=>{
      for (let k = 0; k < br.pts.length - 1; k++){
        from.copy(br.pts[k]); to.copy(br.pts[k + 1]);
        const dir = new THREE.Vector3().subVectors(to, from);
        const len = dir.length(); if (len < 1e-4) continue;
        const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
        const t0 = k / (br.pts.length - 1), t1 = (k + 1) / (br.pts.length - 1);
        const rA = br.r0 + (br.r1 - br.r0) * t0, rB = br.r0 + (br.r1 - br.r0) * t1;
        const base = tv.length / 3;
        for (const [px, pz] of ring){
          const vA = new THREE.Vector3(px * rA, -len/2, pz * rA).applyQuaternion(q).add(mid);
          tv.push(vA.x, vA.y, vA.z);
          const vB = new THREE.Vector3(px * rB,  len/2, pz * rB).applyQuaternion(q).add(mid);
          tv.push(vB.x, vB.y, vB.z);
        }
        for (let m = 0; m < 4; m++){
          const a0 = base + m*2, a1 = base + m*2 + 1;
          const b0 = base + ((m+1)%4)*2, b1 = base + ((m+1)%4)*2 + 1;
          ti.push(a0, b1, b0,  a0, a1, b1);
        }
      }
    });
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3));
    tg.setIndex(ti);
    tg.computeVertexNormals();
    g.add(mesh(tg, MAT.bambooB, { name:'bambooBranch', cast:false }));
  }
  // 竹叶（实例化 + 风摆）
  /* 洗牌（2026-09-16 季节叶量通道）：按 count 缩减只会保留实例数组**前缀** ——
     竹叶按"竿→枝→叶"顺序生成，不洗牌的话春/冬会整竿整枝地秃。
     洗匀后按比例缩减 = 全丛均匀变稀（同 willowLeaf 的第十二轮教训）。 */
  for (let i = leaves.length - 1; i > 0; i--){
    const j = (jr() * (i + 1)) | 0;
    const t = leaves[i]; leaves[i] = leaves[j]; leaves[j] = t;
  }
  const leafInst = new THREE.InstancedMesh(leafGeo, MAT.leaf, leaves.length);
  leafInst.castShadow = false;
  leafInst.userData.seasonBambooLeaf = true;   // 季节叶量通道：春稀夏茂（见 ENV_SEASON.bambooLeaf）
  const lm = new THREE.Matrix4(), lp = new THREE.Vector3(), lq = new THREE.Quaternion(), ls = new THREE.Vector3();
  leaves.forEach((l, i)=>{
    lp.set(l.x, l.y, l.z);
    lq.setFromEuler(new THREE.Euler(l.rx, l.ry, l.rz));
    ls.set(l.s, l.s, l.s);
    lm.compose(lp, lq, ls); leafInst.setMatrixAt(i, lm);
  });
  leafInst.instanceMatrix.needsUpdate = true;
  g.add(leafInst);
  return g;
}


/* 紫藤单朵小花（重建 · 2026-09-17 用户"仿真度要高"）：蝶形花冠四瓣 ——
   旗瓣（上翼竖起、迎光）+ 左右翼瓣（斜伸展开）+ 龙骨瓣（下唇收拢下垂）。
   旧版只有两片四边形，近景读作"塑料花瓣"；四瓣 8 顶点 6 tri，
   比旧 8 tri 略增，但剪影立刻有"层叠"感，不再是一颗塑料纽扣。 */
function makeWisteriaFloretGeo(){
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
export function makeWisteria(count = 6, scale = 1, spanCap = Infinity){
  const g = new THREE.Group();
  const span = Math.min(4.5 * scale, 10, spanCap);
  // 主藤（老藤，沿梁左右蜿蜒）
  const mainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-span/2, 0.10, 0),
    new THREE.Vector3(-span*0.25, -0.06, 0.10*scale),
    new THREE.Vector3(0, 0.07, -0.09*scale),
    new THREE.Vector3(span*0.25, -0.07, 0.07*scale),
    new THREE.Vector3(span/2, 0.09, 0),
  ]);
  g.add(mesh(new THREE.TubeGeometry(mainCurve, 26, 0.016*scale, 8, false), MAT.bark, { name:'wisteriaVine' }));

  const flowers = [];
  const fGeo = makeWisteriaFloretGeo();
  /* 花穗渐变色向（2026-09-17 用户拿参考图核出"颜色反掉了"）：
     真实紫藤是**基部（近茎、先开）淡紫 → 穗梢（下垂末端、未开苞）深紫**。
     旧版正好写反（基部 0x6A4390 深 → 穗梢 0xE6D6F2 近白），且浅端过白读作"白纸片"。
     两个端点直接取参考图实测值 —— probe/palette-ref.mjs 量得：穗上 1/3 受光色
     #C9B3EC（L188）、穗下 1/3 均值 #6A3E96（L78），色相恒定 ≈275°，只有明度在走。
     ⚠️ seasonTint 的 shader 是**保明度**换色（`mix(col, tint*(sLum/tLum), mix)`），
     所以这条明度阶梯会原样穿过季节通道，改这里就是改最终观感。 */
  const paleC = new THREE.Color(0xC9B3EC), deepC = new THREE.Color(0x6A3E96);
  const bcCurves = [];                                  // 花茎曲线留存：叶卡挂点要与枝管严格同线

  for (let i = 0; i < count; i++){
    const t = (i + 0.5) / count;
    const root = mainCurve.getPoint(t);
    const len = rr(0.5, 1.0) * scale;
    const sway = rr(-0.4, 0.4) * scale;
    const bc = new THREE.CatmullRomCurve3([
      root.clone(),
      new THREE.Vector3(root.x + sway*0.45, root.y - len*0.45, root.z + rr(-0.2,0.2)*scale),
      new THREE.Vector3(root.x + sway, root.y - len, root.z + rr(-0.25,0.25)*scale),
    ]);
    g.add(mesh(new THREE.TubeGeometry(bc, 10, 0.005*scale, 5, false), MAT.bark, { name:'wisteriaBranch' }));
    bcCurves.push(bc);

    // 茎上散几朵"走茎花"：茎不裸（半开的小苞感）—— 密度加密（旧 6~10 朵太秃）
    const nStem = 10 + ((rnd()*5)|0);
    for (let k = 0; k < nStem; k++){
      const bp = bc.getPoint(rr(0.1, 0.95));
      flowers.push({
        x: bp.x + rr(-0.012, 0.012), y: bp.y - rr(0, 0.008), z: bp.z + rr(-0.012, 0.012),
        rx: rr(-0.4, 0.4), ry: rr(0, TAU), rz: rr(-0.4, 0.4),
        s: 0.55 * rr(0.85, 1.1) * scale,
        c: deepC.clone().offsetHSL(rr(-0.02, 0.02), rr(-0.03, 0.03), rr(-0.04, 0.02)),
      });
    }

    /* 花穗（总状花序 · 2026-09-17 重建）：**密穗** —— 每穗 22~34 朵、穗长 0.30~0.60 ×scale，
       穗与穗间距 0.05~0.15m 沿花茎等距+抖动（旧版间距 0.15~0.5m，大于穗长 2~4 倍 →
       读作"断线塑料花"，用户判语"仿真度不高"的根因）。每穗仍 2~4 簇聚生、
       梢端鼠尾收尖，整体仍是一簇簇垂下的总状花序，不是均匀花帘。 */
    const nClu = 1 + ((rnd()*3)|0);                     // 每茎 1~3 个穗簇
    const rTotal = 4 + ((rnd()*5)|0);                    // 每茎总穗数 4~8
    let placedR = 0;
    for (let ci = 0; ci < nClu && placedR < rTotal; ci++){
      const tAnchor = Math.min(1, 0.12 + 0.82 * ((ci + rr(0.05, 0.95)) / nClu));
      const anchor = bc.getPoint(tAnchor);
      const inClu = Math.min(rTotal - placedR, 2 + ((rnd()*3)|0));
      placedR += inClu;
      for (let ri = 0; ri < inClu; ri++){
        const at = { x: anchor.x + rr(-0.05, 0.05), y: anchor.y - rr(0, 0.05), z: anchor.z + rr(-0.05, 0.05) };
        // 细梗：穗与茎的可见连接（静态小管，进合并桶，冬季随藤保留）
        const pedLen = rr(0.025, 0.045);
        g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
          new THREE.Vector3(at.x, at.y, at.z),
          new THREE.Vector3(at.x + rr(-0.008, 0.008), at.y - pedLen * 0.5, at.z + rr(-0.008, 0.008)),
          new THREE.Vector3(at.x + rr(-0.012, 0.012), at.y - pedLen, at.z + rr(-0.012, 0.012)),
        ]), 3, 0.0016*scale, 3, false), MAT.bark, { name:'wisteriaPedicel', cast:false }));
        const rLen = rr(0.30, 0.60) * scale;             // 穗长放大（旧 0.20~0.46）
        const rSway = rr(-0.09, 0.09);
        const nF = 22 + ((rnd()*13)|0);                  // 每穗 22~34 朵（旧 13~20）
        const rTop = at.y - pedLen;
        for (let k = 0; k < nF; k++){
          const tt = Math.pow(k / (nF - 1), 1.25);        // 底密梢疏：鼠尾的间距节奏
          const fx = at.x + rSway * tt * tt * rLen;
          const fy = rTop - rLen * (tt + 0.05 * Math.sin(tt * Math.PI));
          const fz = at.z + rr(-0.004, 0.004);
          const side = (k & 1) ? 1 : -1;                  // 互生
          const yaw = Math.atan2(rSway * 2 * tt, 1) + side * (0.9 + rr(-0.2, 0.2));
          const off = 0.011 * (1 - tt * 0.4);
          const taper = 1 - 0.42 * tt - (tt > 0.78 ? 0.30 * (tt - 0.78) / 0.22 : 0);   // 鼠尾收尖
          flowers.push({
            x: fx + Math.cos(yaw) * off, y: fy - rr(0, 0.004), z: fz + Math.sin(yaw) * off,
            rx: rr(-0.3, 0.3), ry: yaw, rz: rr(-0.3, 0.3),
            s: taper * rr(0.88, 1.12) * scale,
            /* ⚠️ offsetHSL 的 lightness 是**线性空间**的偏移：+0.03 在线性空间 = sRGB 亮度
               抬升约 60 点，足以把深紫端（#6A3E96 L78）洗成中薰衣草（#A07FBF L133）。
               抖动改成略偏暗的窄带，让两个端点真正落在参考图量级上。 */
            c: paleC.clone().lerp(deepC, tt).offsetHSL(rr(-0.02, 0.02), rr(-0.10, 0.0), rr(-0.025, 0.01)),
          });
        }
      }
    }
  }
  const inst = new THREE.InstancedMesh(fGeo, MAT.wisteria, flowers.length);
  inst.castShadow = false;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  flowers.forEach((fl, i)=>{
    p.set(fl.x, fl.y, fl.z);
    q.setFromEuler(new THREE.Euler(fl.rx, fl.ry, fl.rz));
    s.setScalar(fl.s);
    m.compose(p, q, s); inst.setMatrixAt(i, m);
    inst.setColorAt(i, fl.c);                               // 逐朵渐变 + 抖动
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  g.add(inst);

  /* 羽状复叶卡（2026-09-17 重建 · 用户"紫藤叶和花是什么鬼"）：
     旧版每个叶卡 = 三片 hex 六边形（18 顶点 + 中肋折线），渲染出来是一堆
     "不规则白色纸片"（MAT.wisteriaLeaf 基色 0xFFFFFF + tinLeaf 亮度归一化 → 近白）。
     改为**椭圆小叶 + 中肋折线**（6 顶点 4 tri），真实紫藤小叶 3~6cm，
     密度大幅下调（主藤沿线 23 → 8~12 张、花茎 7~12/根 → 2~4 张/根），
     主景丛 scale=2.6 时总叶卡 ~50 张，不再"抢戏"。
     色走独立深绿基色（MAT.wisteriaLeaf 已改 0x5E7A3A，脱离 tinLeaf 通道），
     冬季随 wisteriaShow 落尽（落叶藤本）。 */
  const lcGeo = (()=>{
    const pos = [], idx = [];
    // 椭圆小叶（六顶点 4 tri）：长 0.032m、宽 0.014m，比真实小叶 3~6cm 略大保持可读
    const L = 0.032, Wd = 0.014;
    const leaf = (ox, oy, ang, Ls, Ws) => {
      const b = pos.length / 3;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      // 椭圆：顶点→右上→右底→底→左底→左上
      const pts = [[0, Ls], [Ws*0.7, Ls*0.55], [Ws, 0], [Ws*0.7, -Ls*0.55], [-Ws*0.7, -Ls*0.55], [-Ws*0.7, Ls*0.55]];
      for (const [lx, ly] of pts){
        pos.push(ox + lx * cs - ly * sn, oy + lx * sn + ly * cs, lx * 0.18 * (Ls/L));
      }
      idx.push(b, b+1, b+2, b, b+2, b+3, b, b+3, b+4, b, b+4, b+5);
    };
    leaf(0, 0.016*scale, 0, L*scale, Wd*scale);
    leaf(0.005*scale, 0.048*scale, 0.55, L*0.85*scale, Wd*0.85*scale);
    leaf(-0.005*scale, 0.044*scale, -0.55, L*0.85*scale, Wd*0.85*scale);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setIndex(idx);
    lg.computeVertexNormals();
    return lg;
  })();
  const leafCards = [];
  // 主藤沿线（密度下调：23 → 8~12 张，不再"抢戏"）
  const nMainLeaves = 8 + ((rnd()*5)|0);
  for (let k = 0; k < nMainLeaves; k++){
    const t = 0.04 + 0.92 * (k / Math.max(1, nMainLeaves - 1));
    const pt = mainCurve.getPoint(t);
    leafCards.push({
      x: pt.x + rr(-0.05, 0.05), y: pt.y + rr(0.0, 0.04), z: pt.z + rr(-0.05, 0.05),
      ry: rr(0, TAU), rx: rr(-0.5, 0.5), s: rr(0.5, 0.85),
    });
  }
  // 花茎沿线（每根 2~4 张，旧 7~12 张太密）
  for (const bc of bcCurves){
    const nL = 2 + ((rnd()*3)|0);
    for (let k = 0; k < nL; k++){
      const t2 = 0.10 + 0.80 * ((k + rnd()) / Math.max(1, nL));
      const pt = bc.getPoint(t2);
      leafCards.push({
        x: pt.x + rr(-0.04, 0.04), y: pt.y + rr(-0.02, 0.04), z: pt.z + rr(-0.04, 0.04),
        ry: rr(0, TAU), rx: rr(-0.6, 0.6), s: rr(0.5, 0.85),
      });
    }
  }
  const lcInst = new THREE.InstancedMesh(lcGeo, MAT.wisteriaLeaf, leafCards.length);
  lcInst.castShadow = false;
  lcInst.userData.seasonWisteriaLeaf = true;
  const lq = new THREE.Quaternion(), le = new THREE.Euler();
  leafCards.forEach((lc, i)=>{
    p.set(lc.x, lc.y, lc.z);
    le.set(lc.rx, lc.ry, 0);
    q.setFromEuler(le);
    s.setScalar(lc.s);
    m.compose(p, q, s); lcInst.setMatrixAt(i, m);
  });
  lcInst.instanceMatrix.needsUpdate = true;
  g.add(lcInst);
  return g;
}

/* 睡莲叶 + 荷花 */
// 停栖点保留真实三角面与实例编号；实例网格不会被静态合并移除。
/* ⚠️ 锚点必须**先乘 instanceMatrix 再打分**：InstancedMesh 的几何是"一片花瓣/一张叶盘"
   的局部坐标，实例位移全在 instanceMatrix 里。原来拿局部坐标直接打分又只乘
   object.matrixWorld —— 60 个锚点全部塌到 makeAquatic 组原点（-2.5, 2.2），
   蜻蜓会叠在同一朵不存在的花上。打分也要在**变换后**的空间做，否则"取最高的三角面"
   取到的是花瓣局部坐标的最高点，变换后可能根本不是花顶。 */
export const perchingAnchors = [];
function addPerchingAnchor(kind, object, instanceId){
  const geo = object.geometry, pos = geo.attributes.position, index = geo.index;
  const imat = new THREE.Matrix4();
  object.getMatrixAt(instanceId, imat);
  const n = index ? index.count : pos.count;
  let best = -Infinity, bestV = null, bestIds = null, bestC = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3){
    const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
    const vs = ids.map(k => new THREE.Vector3().fromBufferAttribute(pos, k));
    c.copy(vs[0]).add(vs[1]).add(vs[2]).multiplyScalar(1 / 3).applyMatrix4(imat);
    /* 花：取变换后最高的三角面（落在花顶）；
       叶：取"高且靠中心"的面 —— 只取最高会落到上翘的叶缘上，蜻蜓像挂在盘子边上。 */
    const score = kind === 'flower' ? c.y : c.y - 0.85 * Math.hypot(c.x, c.z);
    if (score > best){
      best = score;
      bestV = vs.map(v => v.clone());
      bestIds = ids;
      bestC.copy(c);
    }
  }
  perchingAnchors.push({ id: perchingAnchors.length, kind, object, instanceId,
                         vertices: bestV, vertexIndices: bestIds, local: bestC.clone() });
}
/* ══════════════════════════════════════════════════════════════
   近景水面清透 · 观荷水道（2026-09-26）
   ══════════════════════════════════════════════════════════════
   病因（实测 outputs/_diag/submerged-audit/near-3m.png）：池南岸近景机位
   （相机 (−2.0, 1.15, 7.6) 看向 (0.6, 0.05, 3.0)）下，荷叶与水草几乎铺满
   整片水面，**池底与锦鲤几乎不可见** —— 而"投喂互动"正是靠玩家看到鱼。
   诊断：荷花/睡莲相关 InstancedMesh 三组（36 / 240 / 18），荷叶盖度是主因。

   口径：一条从**池南岸通往池心**的开敞水道，沿视线方向张开的扇形走廊。
   廊内荷叶**逐步收起**（不是一刀切删光），廊缘留 1.1m 软过渡 ——
   远看仍是"满池荷叶"的苏州底子（荷花是核心意象，不能塌），近看却有一条看穿的缝。

   关键约束（本门必须靠它成立）：
     · **布局指纹必须逐位不变** ⇒ 绝不允许改动 `rr()/rnd()` 的调用次数与顺序，
       也不允许改动任何 instanceMatrix / count。于是"删实例"这条路被封死：
       删掉一片叶就少一次 rr()，其后全园抽样整体后移。
     · 改用**顶点着色器里按世界坐标判断**的廊道收敛：矩阵/计数/几何一个字节都不动，
       指纹因此天然不变；同时只对 `USE_INSTANCING` 生效，而全园用 MAT.lily 且
       开了实例化的**只有这 36 片叶**（荷杆/莲蓬茎是非实例网格）⇒ 作用域精确。
     · 必须是 **MAT.lily 本体**而不是克隆：季节显隐表（SEASON_PRESENCE/lilyShow）、
       季节色通道（tinLily）、风场（WIND）都是按材质**对象身份**登记的，
       克隆一份出来 ⇒ 冬天收不掉、颜色不随季、风也不摆，且天气门 G2/G3 会红。
   —— 语汇与"全局随机流守恒"那条铁律同源：**能不动就不动，动也要只动自己那块**。 */

/* 走道轴线（A=南岸口、B=池心略北），半宽由 wA 线性过渡到 wB。
   数值是**量出来的**，不是拍的：对 36 片叶逐一算廊内归属（收 14 片），
   近景水面开敞度 89.5% → 96.7%，而远景叶盘盖度 7.5% → 4.6%（仍留六成荷叶）。
   再放宽（2.4→4.6）开敞度**不再涨**（96.7% 已封顶），只是白丢荷叶 ⇒ 就取这一档。 */
export const VIEW_CORRIDOR = {
  ax: -2.20, az: 7.40,      // 廊口：池南岸，水道从这里下水
  bx:  0.40, bz: 2.70,      // 廊心：池心略偏北，正对近景视线
  wA: 1.60, wB: 3.40,       // 半宽：南岸窄（贴岸才看得清）→ 池心宽（够看穿整片）
  soft: 1.10,               // 软过渡带宽（米）：廊心 0 → 廊缘 1，避免"一堵墙"式切边
  floor: 0.42,              // ⚠️ 保底系数：叶盘再怎么收也留 42% 尺寸，**不许收成 0**
  on: 1,                    // 总开关：0 = 整条水道失效（门禁负例自检就靠它）
};

/* 点到廊轴的距离与沿线参数 t∈[0,1]（投影到 A→B 线段，端点外夹紧） */
function corridorT(px, pz, C = VIEW_CORRIDOR){
  const dx = C.bx - C.ax, dz = C.bz - C.az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - C.ax) * dx + (pz - C.az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(px - (C.ax + dx * t), pz - (C.az + dz * t)), t };
}
/* 廊道保活系数 keep∈[0,1]：0=完全收起，1=原样。
   判据是"点到轴线距离 − 该处半宽"，再过一段 soft 的 smoothstep。 */
export function corridorRaw(px, pz, C = VIEW_CORRIDOR){
  if (!C.on) return 1;
  const { d, t } = corridorT(px, pz, C);
  const w = C.wA + (C.wB - C.wA) * t;
  const x = (d - (w - C.soft * 0.5)) / C.soft;      // ≤0 全收，≥1 全留
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}
/** 带 floor 的版本，**只给着色器用**。见 floor 处的注释。 */
export function corridorKeep(px, pz, C = VIEW_CORRIDOR){
  const s = corridorRaw(px, pz, C);
  if (s >= C.floor) return s;
  /* ⚠️ floor 不是审美参数，是**蜻蜓的落脚点**：36 片叶盘每一片都挂了停栖锚点
     （addPerchingAnchor 无条件登记），pickPerchAnchor 又会随起飞重挑 ——
     一旦某片叶收成 0，停上去的蜻蜓就是**凭空悬在水面上**。
     叶盘 R=0.62m × 实例缩放 0.62~1.25 ⇒ 42% 仍有 0.16~0.33m 半径，够一只蜻蜓站。
     ⚠️ makeLotusPod 的浮叶**不走这个**：它们没有锚点（见 addPerchingAnchor 只有两处调用），
     所以那里判据要用不带 floor 的 corridorRaw，才能真正整片删掉。 */
  return C.floor;
}

/* 走廊 uniform（门禁要能把它关掉做负例自检，所以做成可写的活对象） */
export const CORRIDOR_U = { uCorrA: { value: new THREE.Vector4(VIEW_CORRIDOR.ax, VIEW_CORRIDOR.az, VIEW_CORRIDOR.wA, 0) },
                            uCorrB: { value: new THREE.Vector4(VIEW_CORRIDOR.bx, VIEW_CORRIDOR.bz, VIEW_CORRIDOR.wB, VIEW_CORRIDOR.soft) },
                            uCorrFloor: { value: VIEW_CORRIDOR.floor } };
function syncCorridorU(){
  const C = VIEW_CORRIDOR;
  CORRIDOR_U.uCorrA.value.set(C.ax, C.az, C.wA, C.on);
  CORRIDOR_U.uCorrB.value.set(C.bx, C.bz, C.wB, C.soft);
  CORRIDOR_U.uCorrFloor.value = C.floor;
}
syncCorridorU();
/** 门禁用：开/关整条水道（on=0 ⇒ 廊道完全失效，用于证明判据有牙）。 */
export function setCorridor(on){ VIEW_CORRIDOR.on = on ? 1 : 0; syncCorridorU(); }

/* 把廊道收敛注入 MAT.lily。
   ⚠️ 注入点必须在 addWind 之后（06 求值时 01 的模块体已跑完，onBeforeCompile 已是风场那份），
      所以这里**包一层**而不是覆盖：原钩子先跑完风场位移，再追加廊道。
   ⚠️ 只对 `USE_INSTANCING` 生效：荷梗/莲蓬茎用的是同一个 MAT.lily 但不是实例网格，
      它们**不能**被廊道收走（收走了荷花就"浮在叶上没杆"了）。
   ⚠️ 改的是 shader 与 uniform，**不动 instanceMatrix / count / 几何** ⇒ 布局指纹逐位不变。 */
let corridorInjected = false;
function installLilyCorridor(mat){
  if (corridorInjected) return;
  corridorInjected = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer){
    if (prev) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, CORRIDOR_U);
    shader.vertexShader = `
      uniform vec4 uCorrA;   // xy=廊口 xz, z=廊口半宽, w=总开关
      uniform vec4 uCorrB;   // xy=廊心 xz, z=廊心半宽, w=软过渡带宽
      uniform float uCorrFloor;  // 保底系数：叶盘不许被收成 0（蜻蜓要站得住）
      float corrKeep(vec2 p){
        if (uCorrA.w < 0.5) return 1.0;                       // 负例自检：整条水道关掉
        vec2 ab = uCorrB.xy - uCorrA.xy;
        float L2 = dot(ab, ab);
        float t = L2 > 0.0 ? clamp(dot(p - uCorrA.xy, ab) / L2, 0.0, 1.0) : 0.0;
        float d = length(p - (uCorrA.xy + ab * t));
        float w = mix(uCorrA.z, uCorrB.z, t);
        float x = (d - (uCorrB.w * 0.5 + uCorrA.z + (uCorrB.z - uCorrA.z) * t)) / max(uCorrB.w, 1e-4);
        float s = clamp(x, 0.0, 1.0) * clamp(x, 0.0, 1.0) * (3.0 - 2.0 * clamp(x, 0.0, 1.0));
        return max(s, uCorrFloor);
      }
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       #ifdef USE_INSTANCING
         /* ⚠️ 两套坐标不能混：廊道按**世界** xz 判定，而 begin_vertex 处的
            transformed 仍在**网格局部**空间（modelMatrix 是组位移 makeAquatic 的 x,z，
            实测非零）。拿世界中心去减局部顶点，收缩量不为 1 时整片叶会沿组位移平移跳走。 */
         vec3 padLocal  = instanceMatrix[3].xyz;                 // 实例中心（局部 = 世界缩放前）
         vec3 padWorld  = (modelMatrix * vec4(padLocal, 1.0)).xyz; // 同一中心的世界坐标
         float keep = corrKeep(padWorld.xz);
         if (keep < 0.999){
           /* 绕**自身中心**收缩到 keep：叶盘缩成一枚小圆点，中心不动 ⇒
              既没有"整片叶被平移走"的破绽，也没有一刀切硬边（keep 本身已过 smoothstep）。 */
           transformed = padLocal + (transformed - padLocal) * keep;
         }
       #endif`
    );
  };
  /* program 缓存 key 必须**跟着注入内容一起变**，否则 three 会把"注入了廊道的 lily"
     和"没注入的 lily"当成同一个 program 复用（三个材质恰好共用 'wind|v2' 这个 key）。
     这里只对 lily 追加后缀，其它风材质的 key 不动。 */
  const prevKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = function (){
    return (prevKey ? prevKey.call(this) : '') + '|corr1';
  };
  mat.needsUpdate = true;
}

/* 2026-09-28 修"睡莲长到草皮上"（老黄截图：左岸漏窗墙前草坡上一株孤莲）：
   makeAquatic 的散布只是个压扁的粗略椭圆、不贴池形 ⇒ 个别叶/花越过岸线。
   落点在**抽完角度/半径之后**就地夹回 0.85×岸线内。
   ⚠️ 绝不能"丢弃重抽"：重抽会多消耗全局随机流，其后全场抽样整体错位（铁律 1）。
   夹回不消耗任何随机数，全局流的位置一位不动（改的只是落点值）。
   2026-09-30 二轮（老黄："还有睡莲长到草皮上的bug没有修"）：0.85×岸线只保证
   **中心**在池里 —— 池腰窄处（岸线 ~4m）15% 只有 0.6m，兜不住叶盘半径（最大 0.775m）
   ⇒ 实测 2 片边缘越岸 0.39/0.18m。cap 取 min(0.85×岸线, 岸线 − edge − 0.1)：
   宽处 0.85 仍较小（行为不变），窄处按**边缘**收。edge= 物体自身半径（调用方给）。 */
function clampAquaticToPond(gx, gz, px, pz, edge = 0){
  const lx = gx + px, lz = gz + pz - 3.0;        // 世界 → 池局部（池心世界 z=+3）
  const r = Math.hypot(lx, lz);
  if (r < 1e-6) return { x: px, z: pz };
  let a = Math.atan2(lz, lx); if (a < 0) a += TAU;
  const ri = Math.min(POND_RADII.length - 1, Math.floor(a / TAU * POND_RADII.length));
  const shore = POND_RADII[ri];
  /* ⚠️ 到岸线的余量：原来只有 0.10m —— 实测驳岸有**内伸的石唇与草沿**（岸线多边形是"水面轮廓"，
     不是"看得见的岸沿"），0.1m 的余量会让靠岸那几片叶盘**边缘压在石唇/草沿上**（老黄 2026-10-05：
     "池塘北面有几片睡莲跑到草皮和石头上"）。放大到 BANK_MARGIN：叶盘边缘离水面轮廓留 0.45m，
     视觉上就干净地浮在水里；池心那片（edge=0.775）同样受益，不会因此离岸太远。
     ⚠️⚠️ 2026-10-06 二轮（老黄："睡莲还是有穿模，一部分在草皮上，一部分在池边石头上"）：
     逐片审计显示叶盘**边缘 0 处命中石/地**，但**低角度出图**暴露了真因 —— 站在池南岸人眼高度
     （1.62m）往北看时，**岸唇把近处那条水面挡掉了**，于是紧贴岸线的叶盘与岸之间"看不到水"，
     读起来就是"叶片长在草地/石头上"（多模态对 outputs/_diag/pond-low/before-from-south.png 的
     原话："叶片与岸的交界处完全看不到水面，叶片是贴地/贴岸生长的"）。
     ⇒ 这不是穿模、是**透视**：叶盘离岸太近。修法 = 余量 0.45 → **0.90**，低角度下让叶盘与岸之间
     ⚠️ 2026-10-06 三轮（老黄二轮实拍："睡莲长池边石头上了"）：换量法复测（outputs/_diag/lily-audit2.mjs
     —— 叶盘**内部+近缘** 8 方向 × 2 圈共 16 点向下射线，并把"池内植物"与"石/地"分开统计）：
       **72 片里压石/上岸 0 片**，只有 28 片与池内荷株（LotusPlant）自然交叠
       ⇒ 几何上叶盘都在水面上；"压在石头上"是**低角度看过去水带被岸石吃掉**的观感。
       又试着直接量"岸石带宽度"（outputs/_diag/bank-band.mjs）——**该量法不可信**：
       向外出射线时先撞到的是**池内的池荷/立峰**（方位 210° 报"石带宽 7.3m"其实是池荷），
       不是岸石，所以那个数不能拿来定余量（记下来别再走这条路）。
     ⇒ 仍按"叶盘绝不进岸石带 + 留出看得见的水带"处理：**0.90 → 1.30**（池半径 4~14m，安全）。
       方向上单调：叶盘只会更往池心收、与岸之间的水带只会更宽。
     ⚠️ 改这个常量会移动叶盘实例 ⇒ **必须重出 layout-fingerprint 基线**。 */
  const BANK_MARGIN = 1.30;
  const cap = Math.min(shore * 0.85, Math.max(0, shore - edge - BANK_MARGIN));
  if (r <= cap) return { x: px, z: pz };
  const k = cap / r;
  return { x: lx * k - gx, z: lz * k + 3.0 - gz };
}

export function makeAquatic(x, z, radius = 5.5, nPad = 46, nLotus = 14){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  // 睡莲叶：带缺口、边缘上翘的浅碟
  const padGeo = makeLilyPadGeo();
  const pads = new THREE.InstancedMesh(padGeo, MAT.lily, nPad);
  pads.receiveShadow = true;
  /* 近景水道：只装注入，**不碰**下面这个循环的任何一次 rr()/rnd() 与矩阵 ——
     布局指纹逐位不变就靠这一行注释的分量。 */
  installLilyCorridor(MAT.lily);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < nPad && guard++ < nPad * 8){
    const a = rr(0, TAU), rad = Math.sqrt(rnd()) * radius;
    let px = Math.cos(a)*rad, pz = Math.sin(a)*rad * 0.72;
    /* 2026-09-28：先夹回池内（岸上的落点沿"池心→落点"方向拉回 0.85×岸线内，
       随机数已抽完、不重抽），再走下面的汀步让位 —— 顺序对随机流的消耗无影响。
       2026-09-30：edge 参 —— 0.85 只保证**中心**在池里；池腰窄处（岸线 ~4m）0.15×岸线
       只有 0.6m，兜不住最大 0.775m 的叶盘半径 ⇒ 边缘探上岸（实测 2 片越 0.39/0.18m，
       老黄："睡莲长到草皮上"）。取 min(0.85×岸线, 岸线 − 叶盘半径 − 0.1)：
       宽处行为不变（0.85 仍是较小值），窄处按边缘收。
       ⚠️ 叶盘 scale 的 rr(0.62,1.25) 在这之后才抽 —— 不能为拿"每片真实半径"去动抽数顺序
          （错位=全场景布局漂移，铁律 1），这里按最大可能半径 0.775 保守收。 */
    const cl = clampAquaticToPond(x, z, px, pz, 0.775); px = cl.x; pz = cl.z;
    /* ⚠️ 汀步在 z≈5.6 的一条直线上（见 makeSteppingStones），叶盘压上去必然与石板穿模
       （用户实拍：石板从叶盘中间穿出来）。这里按**标称石位**让开 0.8m ——
       不去引用那块列表，是因为它的随机数消耗顺序不能动（一动整场景的随机布局都会变）。 */
    const wx = x + px, wz = z + pz;
    if (Math.abs(wz - 5.6) < 0.80 && wx > -4.4 && wx < 7.4) continue;
    p.set(px, CFG.water + 0.075 + rr(0,0.02), pz);
    q.setFromEuler(new THREE.Euler(0, rr(0, TAU), 0));
    s.setScalar(rr(0.62, 1.25));
    m.compose(p, q, s); pads.setMatrixAt(placed, m);
    /* 2026-09-30 提亮一档（老黄："正常荷花池该有的鲜绿大圆盘"，旧版读作"灰绿破盘子"）：
       亮度 0.26~0.42 → 0.40~0.60、饱和 0.28~0.5 → 0.34~0.54。
       ⚠️ 只改区间、rr() 次数与顺序一个不动 —— 全局随机流不漂（铁律 1）。 */
    pads.setColorAt(placed, new THREE.Color().setHSL(0.27, rr(0.34, 0.54), rr(0.40, 0.60)));
    addPerchingAnchor('leaf', pads, placed);
    placed++;
  }
  pads.count = placed;
  pads.instanceMatrix.needsUpdate = true;
  if (pads.instanceColor) pads.instanceColor.needsUpdate = true;
  g.add(pads);
  // 荷花：内外两圈勺形花瓣 + 花心（全部实例化）
  /* 三层花瓣（外圈外倾 -> 内圈收拢），中央是花托 + 花蕊（原来是一个 8.5cm 的金球）。 */
  const outer = 8, mid = 7, inner = 5, petals = outer + mid + inner;
  const petalGeo = makeLotusPetalGeo();
  const petalInst = new THREE.InstancedMesh(petalGeo, MAT.lotus, nLotus * petals);
  petalInst.castShadow = false;
  const coreInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.040, 0.050, 12), MAT.gold, nLotus);
  const pm = new THREE.Matrix4(), pp = new THREE.Vector3(), pq = new THREE.Quaternion(), ps = new THREE.Vector3();
  const qTilt = new THREE.Quaternion(), qSpin = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < nLotus; i++){
    const a = rr(0, TAU), rad = Math.sqrt(rnd()) * radius * 0.92;
    let fx = Math.cos(a)*rad, fz = Math.sin(a)*rad*0.72;
    /* 2026-09-28：与叶盘同款夹回池内（见 clampAquaticToPond 注释）—— 否则岸上的
       落点会出现"草坡上一根孤零零的花梗"（老黄截图）。
       2026-09-30 二轮：edge 传花头半径量级（茎细、花头 ~0.12），窄处按边缘收。 */
    const cf = clampAquaticToPond(x, z, fx, fz, 0.10); fx = cf.x; fz = cf.z;
    /* ⚠️ 花梗高度必须**高过睡莲叶盘**：叶盘顶部在 0.21，原来最低 0.2 的花
       等于坐在叶子上，0.2m 的杆被 1.5m 宽的叶子完全挡住（用户："荷花几乎没有杆撑着"）。 */
    const fy = CFG.water + rr(0.48, 1.08);        // 花朵高低错落（下限抬到叶盘之上）
    const sc = rr(0.092, 0.116);      // 花朵直径 0.22~0.28m（真实荷花 15~25cm）
    // 花梗（2026-09-29：棱数 5→12 —— 低棱柱被风摆时棱面轮流朝前，看起来像"杆在
    // 旋转、忽粗忽细"（老黄暴雨近看反馈）；12 棱剪影平滑）
    const stemH = fy - CFG.water + 0.06;
    const stemM = mesh(new THREE.CylinderGeometry(0.026, 0.040, stemH, 12), MAT.lily, { name:'lotusStem' });
    stemM.position.set(fx, CFG.water + stemH/2, fz);
    g.add(stemM);
    // 花萼/花托（2026-09-29 修"花与杆硬接显歪"）：小绿萼盖住杆顶与花的交接缝，
    // 顺带把"花瓣外圈外翻造成的视觉偏斜"读成自然倒垂
    const calyx = mesh(new THREE.CylinderGeometry(0.018, 0.052, 0.075, 10), MAT.lily, { name:'lotusCalyx' });
    calyx.position.set(fx, fy - 0.028, fz);
    g.add(calyx);
    let slot = 0;
    const ring = (n, tilt, radiusOut, phase) => {
      for (let k = 0; k < n; k++){
        const pa = (k/n)*TAU + phase;
        qTilt.setFromAxisAngle(AX, -tilt);
        qSpin.setFromAxisAngle(AY, pa);
        pq.copy(qSpin).multiply(qTilt);
        pp.set(fx + Math.cos(pa)*radiusOut*sc, fy, fz + Math.sin(pa)*radiusOut*sc);
        ps.setScalar(sc);
        pm.compose(pp, pq, ps);
        petalInst.setMatrixAt(i*petals + slot++, pm);
      }
    };
    ring(outer, 1.16, 0.42, 0);        // 外圈：几乎摊平、向外翻
    addPerchingAnchor('flower', petalInst, i * petals);
    ring(mid,   0.78, 0.30, 0.24);     // 中圈
    ring(inner, 0.38, 0.20, 0.50);     // 内圈：收拢成杯
    pp.set(fx, fy + 0.16*sc, fz); pq.identity(); ps.setScalar(sc);
    pm.compose(pp, pq, ps); coreInst.setMatrixAt(i, pm);
  }
  petalInst.instanceMatrix.needsUpdate = coreInst.instanceMatrix.needsUpdate = true;
  g.add(petalInst, coreInst);
  return g;
}

/* 锦鲤/乌龟轨道：椭圆，全部经核算落在池形内。
   2026-09-28 由 3 条扩到 7 条（"鱼群挤成一团"第 4 轮修法）：11 条鱼按 i%7 分配
   ⇒ 4 对同轨 + 3 条独行（原来 3 条轨道挤 4/4/3 条，同轨 15 对鱼周期性相遇、
   长时间并排互推）。新增 4 条全部是既有轨道的**同心缩小版** —— 同心且半轴严格
   更小 ⇒ 数学上必然整体落在原椭圆内部，池形/离岸余量自动继承（koi-orbit 的
   解析扫轨照跑复核）；两两同心互不相交，也减少不同轨道间的穿越点。
   ⚠️ 泳龟（08-assemble）也按 i%len 上轨：只有 2 只、i=0/1 ⇒ 无论 3 条还是
      7 条都落在轨道 0/1，本改动对乌龟零影响。
   ⚠️ 不做"固定相位槽"（已试过、读成编队，已回退）；相位仍用 KOI_DRAW 的随机预抽。 */
export const KOI_ORBITS = [
  { cx: -7.5, cz: 0, a: 3.8, b: 4.6 },      // 左瓣
  { cx:  7.5, cz: 0, a: 3.2, b: 2.8 },      // 右瓣
  { cx:  0.0, cz: 0, a: 9.5, b: 2.4 },      // 贯穿全池
  { cx: -7.5, cz: 0, a: 2.6, b: 3.1 },      // 左瓣内圈（同左瓣心）
  { cx:  7.5, cz: 0, a: 2.2, b: 1.9 },      // 右瓣内圈（同右瓣心）
  { cx:  0.0, cz: 0, a: 7.0, b: 1.8 },      // 中贯穿（同贯穿心）
  { cx:  0.0, cz: 0, a: 4.8, b: 1.2 },      // 腰心小环（同贯穿心）
];

/* 鱼跃涟漪：鱼口触水处激起的一圈圈同心涟漪。
   P1-9 并批：20 个独立 Mesh（激活几个就几个 draw call）→ 单个 InstancedMesh +
   自定义 instanceAlpha（onBeforeCompile 注入 per-instance 透明度）。
   draw call 恒为 1；未激活实例 alpha=0 视觉消失；实例矩阵编码位置与 s 缩放。 */
/* 容量 20 → 64（2026-09-25）：单 InstancedMesh，容量只吃显存里 64 个矩阵与 alpha，
   draw call 恒为 1。扩容是为了"暴雨 + 密集点击 + 鱼跃同时发生"时不丢圈 ——
   旧容量下 20 槽很快占满，新点击/鱼跃分不到槽，表现为"点了没反应"（静默失效）。
   ⚠️ 雨滴配额仍必须保留（`rainRippleActive` 上限 12）：雨是持续发生的，
     不限量就会把交互槽位吃光，正是原注释要防的那个回归。 */
const RIPPLE_N = 64;
/* 环带 0.88→0.82：原来 12% 带宽在 20m 外的斜视机位只剩一条发丝，
   点击反馈读不出来；加宽到 18% 后远观仍是一圈水痕而非光圈。 */
const rippleGeo = new THREE.RingGeometry(0.82, 1.0, 30);
rippleGeo.rotateX(-Math.PI / 2);
const rippleMat = new THREE.MeshBasicMaterial({
  color: 0xE8F1ED, transparent: true, depthWrite: false, side: THREE.DoubleSide,
});
/* per-instance alpha：instanceColor 只有 RGB 没有 alpha，自定义
   InstancedBufferAttribute 在 onBeforeCompile 里读出乘到 gl_FragColor.a。
   transparent:true 时 shader 不含 opaque_fragment，注入点选 tonemapping 之前。 */
rippleMat.onBeforeCompile = (sh) => {
  sh.vertexShader = 'attribute float instanceAlpha;\nvarying float vInstanceAlpha;\n' + sh.vertexShader;
  sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>',
    '#include <color_vertex>\n  vInstanceAlpha = instanceAlpha;');
  sh.fragmentShader = 'varying float vInstanceAlpha;\n' + sh.fragmentShader;
  sh.fragmentShader = sh.fragmentShader.replace('#include <tonemapping_fragment>',
    'gl_FragColor.a *= vInstanceAlpha;\n#include <tonemapping_fragment>');
};
export const rippleInst = new THREE.InstancedMesh(rippleGeo, rippleMat, RIPPLE_N);
rippleInst.frustumCulled = false;
/* 水面贴有低空雾絮（也是透明体），默认按距离排序时雾片可能后画、把涟漪洗白。
   显式抬到透明队列后段，保证玩家亲手点出的水痕在薄雾上也读得出来。 */
rippleInst.renderOrder = 3;
rippleInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const RIPPLE_ALPHA = new Float32Array(RIPPLE_N);
rippleGeo.setAttribute('instanceAlpha', new THREE.InstancedBufferAttribute(RIPPLE_ALPHA, 1));
const RIPPLE_STATE = [];
/* 雨滴涟漪占用计数：与点击/鱼跃共用同一池子，雨的配额由 12-env 的 updateRainRipples
   按容量比例限（当前 64 槽 ⇒ 44）。计数在 spawn/expiry 两侧配对增减。 */
export let rainRippleActive = 0;
/** 容量对外暴露（门禁与诊断读；改容量时 12-env 的雨滴配额必须同步）。 */
export function rippleCapacity(){ return RIPPLE_N; }
const _rippleM4 = new THREE.Matrix4(), _rippleQ = new THREE.Quaternion();
const _rippleP = new THREE.Vector3(), _rippleS = new THREE.Vector3();
for (let i = 0; i < RIPPLE_N; i++){
  RIPPLE_STATE.push({ active: false, t0: 0, delay: 0, dur: 1, maxR: 1, x: 0, z: 0, amp: 1, kind: '' });
  _rippleM4.compose(_rippleP.set(0, 0, 0), _rippleQ, _rippleS.set(0.001, 1, 0.001));
  rippleInst.setMatrixAt(i, _rippleM4);
}
rippleInst.instanceMatrix.needsUpdate = true;
/* strength：涟漪强度。鱼跃(3)/雨滴(2)用默认 1；**玩家点击**用 1.6 ——
   圈数更多、铺得更大、亮峰更高，交互反馈要明显强过环境自发的水痕，
   否则点击看起来"什么都没发生"（薄雾区实测浅圈几乎不可见）。 */
export function spawnRipple(x, z, t, rings = 3, strength = 1, kind = ''){
  /* ⚠️ 落点必须在**池域内**（2026-09-24 修"涟漪画到岸上草地"）：
     雨滴涟漪原来按**外接椭圆**撒点（半轴 12.5 × 6.4、心在世界 (0,3)），而池形是**不规则多边形**
     （POND_PTS / POND_RADII）⇒ 椭圆边缘在若干方向落到岸上。老黄截图实证：狂风暴雨时
     **石驳岸下方的草皮**与**睡莲交界带**各出现一圈同心圆环（涟漪画在陆地纹理上、越过了岸线）。
     拦在**唯一入口**处（所有调用方一起受保护：雨滴 / 点击 / 鱼跃 / 泳龟），而不是逐个调用点修。
     坐标口径：`insidePond` 是**池心局部坐标**，池心在世界 z = +3
     （同 07-ground.js 的 `dz = z - 3.0`、本文件里 `z = 3 + sin(ang)*rad` 的写法）
     ⇒ 世界 (x,z) → 局部 (x, z − 3)。 */
  if (!insidePond(x, z - 3.0)) return;
  /* ⚠️⚠️ 2026-10-05 二轮修（老黄："狂风暴雨的池水涟漪会穿过池边岩石再拓展到草皮上"）：
     只挡"**中心点**在池外"**不够** —— 涟漪圈会随时间扩大，`d.maxR = (0.5 + k*0.68) * jit *
     (0.65 + 0.35*strength)`：雨滴（3 圈 / strength≈1.3）最大 ~2.4m、点击级（5 圈 / 1.6）可达 ~4.5m。
     中心在池内 0.5m 的圈，长到 2.4m 时照样越过岸线压在草皮与驳岸石上（正是他截图里那两处）。
     ⇒ 按**本圈的最大半径**给落点留余量：不够就往池心方向拉回来（**不丢弃** —— 丢弃会让近岸雨痕
     明显变稀，而雨打水面本来就是"到处都在打"）。余量 +0.15 是环带自身宽度（几何外径 1.0 的 15%）。
     ⚠️ 这里**不新增任何 Math.random 调用**（运行期效果可用全局随机，但抽数次数一变会让同帧其余
     随机量错位），只做纯几何夹紧。 */
  {
    const maxRing = (0.5 + Math.max(0, rings - 1) * 0.68) * 1.15 * (0.65 + 0.35 * strength) + 0.15;
    const lx = x, lz = z - 3.0;
    const r0 = Math.hypot(lx, lz);
    if (r0 > 1e-6){
      let a0 = Math.atan2(lz, lx); if (a0 < 0) a0 += TAU;
      const ri = Math.min(POND_RADII.length - 1, Math.floor(a0 / TAU * POND_RADII.length));
      const cap = Math.max(0.25, POND_RADII[ri] - maxRing);
      if (r0 > cap){ const k = cap / r0; x = lx * k; z = lz * k + 3.0; }
    }
  }
  lastSpawnT = t;                       // 供"反射按需更新"判断"刚刚有快速动作"（见 lastRippleAge）
  /* ── 惊鱼自动钩子（2026-09-26）──────────────────────────────────────────
     玩家点击水面会在此产生一圈 strength≈1.6 的涟漪（11-loop 传 rings=5,strength=1.6），
     而雨滴是 kind='rain'、鱼跃/龟是 strength=1。这里把"非雨且 strength>1.2"认作
     **玩家级扰动** ⇒ 附近锦鲤短暂惊散。落点已是**世界**坐标，这里转成池局部
     （z − 3）喂给 koiStartleAt。**主代理若已在点击处显式调 koiStartleAt，
     这里会多记一次同点事件**（同点同刻的两次惊扰叠加后仍在 STARTLE_MAX 上界内，
     只是把强度从 1.6 抬到约 2.4，仍受界与池域夹紧保护，不影响任何门禁）。
     若主代理想完全接管、避免双记，探针/主代理可置 `spawnRipple` 钩子开关
     `KOI_BEHAVIOR.startleFromRipple=false`（见 KOI_BEHAVIOR 注释）。 */
  if (KOI_BEHAVIOR.startleFromRipple && kind !== 'rain' && strength > 1.2)
    koiStartleAt(x, z - 3.0, t, Math.min(2.0, strength));
  for (let k = 0; k < rings; k++){
    const i = RIPPLE_STATE.findIndex(r => !r.active);
    if (i < 0) return;
    const d = RIPPLE_STATE[i];
    /* 间距/半径加 ±15% 随机：等距同心圆在俯视机位下读成"声呐扫描"（用户截图实测吐槽）。
       水面的物理圈确实近似同心，但游戏画面要的是"看起来自然"，不是"几何完美"。 */
    const jit = 0.85 + Math.random() * 0.3;
    d.active = true; d.t0 = t; d.x = x; d.z = z;
    d.amp   = Math.min(1.7, strength);
    d.delay = k * 0.26 * jit / Math.sqrt(strength);
    d.dur   = 1.9 * jit * (1 + 0.15 * (strength - 1));
    d.maxR  = (0.5 + k * 0.68) * jit * (0.65 + 0.35 * strength);
    d.kind  = kind;
    if (kind === 'rain') rainRippleActive++;
    _rippleM4.compose(_rippleP.set(x, CFG.water + 0.08, z), _rippleQ, _rippleS.set(1, 1, 1));
    rippleInst.setMatrixAt(i, _rippleM4);
    RIPPLE_ALPHA[i] = 0;                                   // 未起圈时透明
  }
  rippleInst.instanceMatrix.needsUpdate = true;
}
/* 供"水面反射按需更新"读的两个量（05-water 经 HOOKS 取 —— 它不能 import 本模块，会成环）：
   · `lastRippleAge`：距**最近一次起涟漪**过了多久（秒），由 updateRipples 每帧更新；
   · `ripplesActive()`：池里还有几圈活着的涟漪（诊断用）。
   ⚠️ 判断"水面是否活跃"要用 **lastRippleAge（刚发生）**，不能用 ripplesActive（还在）。
   实测：场里 11 条锦鲤轮流出水、每圈活 ~1.9s ⇒ **涟漪几乎永远存在**，用"还在"当判据会让
   反射按需更新**永远不生效**（而且涟漪环本身不在反射里 —— Reflector 渲的是镜像场景、
   水面自己的网格被排除）；真正需要满速的是"**刚刚**发生了快速动作"（鱼跃/龟/点击/雨）。 */
let lastSpawnT = -1e9;
export let lastRippleAge = 1e9;
export function ripplesActive(){
  let n = 0;
  for (const r of RIPPLE_STATE) if (r.active) n++;
  return n;
}

export function updateRipples(t){
  lastRippleAge = t - lastSpawnT;
  let mChanged = false, aChanged = false;
  for (let i = 0; i < RIPPLE_N; i++){
    const d = RIPPLE_STATE[i];
    if (!d.active) continue;
    const e = t - d.t0 - d.delay;
    if (e < 0){ if (RIPPLE_ALPHA[i] !== 0){ RIPPLE_ALPHA[i] = 0; aChanged = true; } continue; }
    const u = e / d.dur;
    if (u >= 1){ d.active = false; if (d.kind === 'rain') rainRippleActive = Math.max(0, rainRippleActive - 1); RIPPLE_ALPHA[i] = 0; aChanged = true; continue; }
    const s = d.maxR * (0.15 + u * 0.85);
    /* 0.62 → 0.34 → 0.38（2026-09-21 方案 n3 二轮）：亮度是"声呐感"的主因，
       暗圈才像水痕不像光圈；但 0.34 在雨面俯视终拍里读不出（中低密度）。
       0.38 仍封顶 0.6（玩家点击），雨痕在墨绿水面上足够显眼而不炸。 */
    const a = Math.min(0.6, Math.pow(1 - u, 1.7) * 0.38 * d.amp);
    if (RIPPLE_ALPHA[i] !== a){ RIPPLE_ALPHA[i] = a; aChanged = true; }
    _rippleM4.compose(_rippleP.set(d.x, CFG.water + 0.08, d.z), _rippleQ, _rippleS.set(s, 1, s));
    rippleInst.setMatrixAt(i, _rippleM4);
    mChanged = true;
  }
  if (mChanged) rippleInst.instanceMatrix.needsUpdate = true;
  if (aChanged) rippleGeo.attributes.instanceAlpha.needsUpdate = true;
}

/* ══ 投喂（2026-09-24 · 计划书 Phase 3 第 6 项）════════════════════════════════
   点水面 → 撒饵（Points 粒子缓慢下沉 + 末段淡出）→ 附近的锦鲤**放弃轨道**游来抢食 →
   饵散后**平滑滑回原轨道**（不做瞬移 ⇒ 不会出现"迷路鱼"）。
   三条硬约束（都是本项目踩过的坑，别省）：
     ① **坐标**：锦鲤位置是 `koiGroup` 的**局部**坐标（父组在世界 z=+3；见 makeKoiGroup 与
        probe/koi-orbit.mjs）⇒ 世界 (x,z) → 局部 (x, z−3)，与 spawnRipple / insidePond 同口径。
     ② **不许游上岸**：`koi-orbit` 门禁守"11 条鱼全在池内"。所以饵点必须**夹紧在池域内**留余量；
        而且"轨道点 → 饵点"的**直线插值在葫芦形收腰处会切出池外** ⇒ 每帧对结果再做一次
        半径夹紧（r ≤ 0.95×POND_RADII ≈ 0.87× 岸线）。轨道本身远小于该阈值
        ⇒ **无饵时逐字等价于原公式**（不扰动 koi-orbit 门禁，那条判据一个字没动）。
     ③ **随机流**：撒饵/抢食是**运行期效果**（每次点都不一样才对）⇒ 用 `Math.random`；
        布局类才用顶部那个专用种子流 `jr`。粒子位置不参与布局指纹。
   ⚠️ 未激活粒子的初始位置**故意放在水面之上**（y = CFG.water + 0.05）而不是丢到 y=-50：
      `refract-coverage` 会扫"下探水面 >15cm 却不在折射层"的对象，丢到水下会被它报红。 */
const BAIT_N = 48;                       // 粒子池容量（够 3~4 次连点）
const BAIT_PER_DROP = 14;                // 每次撒几粒
export const BAIT_LIFE = 7.0;            // 饵存活（秒）：够鱼游到、又不至于长期占场
export const BAIT_ATTRACT_R = 6.5;       // 吸引半径（米，池局部）
const BAIT_SINK = 0.035;                 // 下沉速度（米/秒）
const baitPos = new Float32Array(BAIT_N * 3);
const baitAlpha = new Float32Array(BAIT_N);
const BAIT_P = [];
for (let i = 0; i < BAIT_N; i++){
  baitPos[i * 3] = 0; baitPos[i * 3 + 1] = CFG.water + 0.05; baitPos[i * 3 + 2] = 3;
  baitAlpha[i] = 0;
  BAIT_P.push({ t0: -1e9, life: 0, y0: 0, sink: 0 });
}
const baitGeo = new THREE.BufferGeometry();
baitGeo.setAttribute('position', new THREE.BufferAttribute(baitPos, 3));
baitGeo.setAttribute('aAlpha', new THREE.BufferAttribute(baitAlpha, 1));
const baitMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: `
    attribute float aAlpha;
    varying float vA;
    void main(){
      vA = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(30.0 / max(2.0, -mv.z), 1.6, 7.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.16, d) * vA;
      if (a < 0.01) discard;
      gl_FragColor = vec4(0.80, 0.62, 0.34, a);   /* 饵料：暖褐黄，深绿水面上一眼看得见 */
    }`,
});
export const baitPoints = new THREE.Points(baitGeo, baitMat);
baitPoints.frustumCulled = false;
baitPoints.userData.aoSkip = true;       // 不进 GTAO 法线 pass（与萤火虫同）
baitPoints.userData.noMerge = true;
markUnderwater(baitPoints);              // 会沉到水面之下 ⇒ 进折射层（透过水看得见）
export const BAITS = [];                 // 活跃饵点（池局部）：{ lx, lz, t0 }
export function baitsActive(){ return BAITS.length; }

/* 在**世界**坐标 (wx,wz) 撒一次饵；返回夹紧后的饵点（池局部）—— 供门禁断言"夹紧生效"。 */
export function dropBait(wx, wz, tNow){
  let lx = wx, lz = wz - 3.0;                       // 世界 → 池局部
  const r = Math.hypot(lx, lz);
  let a = Math.atan2(lz, lx); if (a < 0) a += TAU;
  const ri = Math.min(POND_RADII.length - 1, Math.floor(a / TAU * POND_RADII.length));
  const maxR = POND_RADII[ri] * 0.95;               // 夹紧：留 ~0.87× 岸线，防鱼贴岸/上岸
  if (r > maxR){ const k = maxR / Math.max(1e-6, r); lx *= k; lz *= k; }
  const bait = { lx, lz, t0: tNow };
  BAITS.push(bait);
  for (let k = 0; k < BAIT_PER_DROP; k++){
    const i = BAIT_P.findIndex(p => (tNow - p.t0) > p.life);
    if (i < 0) break;
    const ang = Math.random() * TAU, rad = Math.sqrt(Math.random()) * 0.5;
    const p = BAIT_P[i];
    p.t0 = tNow; p.life = BAIT_LIFE;
    p.y0 = CFG.water + 0.05 + Math.random() * 0.05;
    p.sink = BAIT_SINK * (0.7 + Math.random() * 0.6);
    baitPos[i * 3]     = lx + Math.cos(ang) * rad;
    baitPos[i * 3 + 1] = p.y0;
    baitPos[i * 3 + 2] = 3.0 + lz + Math.sin(ang) * rad;
    baitAlpha[i] = 1;
  }
  baitGeo.attributes.position.needsUpdate = true;
  baitGeo.attributes.aAlpha.needsUpdate = true;
  return bait;
}

/* 每帧：粒子下沉 + 末段淡出；到期回收饵点。 */
export function updateBaits(tNow){
  let any = false;
  for (let i = 0; i < BAIT_N; i++){
    const p = BAIT_P[i];
    const age = tNow - p.t0;
    if (age < 0 || age > p.life){ if (baitAlpha[i] !== 0){ baitAlpha[i] = 0; any = true; } continue; }
    baitPos[i * 3 + 1] = p.y0 - p.sink * age;
    baitAlpha[i] = age < p.life - 1.6 ? 1 : Math.max(0, (p.life - age) / 1.6);
    any = true;
  }
  if (any){ baitGeo.attributes.position.needsUpdate = true;
            baitGeo.attributes.aAlpha.needsUpdate = true; }
  for (let i = BAITS.length - 1; i >= 0; i--)
    if (tNow - BAITS[i].t0 > BAIT_LIFE) BAITS.splice(i, 1);
}

/* 距 (lx,lz) 最近、且还在吸引半径内的饵（池局部坐标）；没有则 null。 */
export function nearestBait(lx, lz){
  let best = null, bd = BAIT_ATTRACT_R * BAIT_ATTRACT_R;
  for (const b of BAITS){
    const dx = b.lx - lx, dz = b.lz - lz, d2 = dx * dx + dz * dz;
    if (d2 < bd){ bd = d2; best = b; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════
   锦鲤行为增量（2026-09-26）· 固定轨道之上叠加「避障 / 惊鱼 / 轻微聚集」
   ══════════════════════════════════════════════════════════════
   设计契约（严格遵守，否则 koi-orbit / koi-feed 两道门会红）：
   ① **不改写轨道公式**。本模块只提供**纯函数**，返回作用在**池局部坐标**上的
      偏移量 (dx, dz)。调用方（11-loop 鱼段）把它**加**在原公式算出的
      (f.position.x, f.position.z) 之上，再走原有那条 0.95×POND_RADII 夹紧。
   ② 每个偏移量都有**硬上界**（各行为各自的 MAX_* 常量，见下），
      叠加后再由调用方原有的池域夹紧兜底 ⇒ "偏移有界 + 不出池"两道保险。
   ③ 全部**可开关、可逐步关掉**便于定位（见 KOI_BEHAVIOR）；默认三项全开。
   ④ 纯函数、**不持有鱼的状态**（除惊鱼事件表）⇒ 不会与 11-loop 的插值/朝向打架，
      也不引入新的物理引擎；数据全部来自已有的 POND_RADII 与已知障碍位。

   ── 数据来源（不新增物理引擎）──────────────────────────────────────────
   · 水中障碍：从 **POND_RADII**（池岸半径表）+ 已知障碍位置推导。障碍表
     KOI_OBSTACLES 见下 —— 立峰「云根」/伴石/石矶与汀步的位置都能从
     POND_RADII + 固定角/固定步距**确定性地**重算（与 08-assemble 摆位同参），
     所以本模块只需 POND_RADII，不 import 08（会成环）。
   · 惊鱼：涟漪落点 + `lastRippleAge`（见 KOI_STARTLE / koiStartleAt）。        */

/* 池域夹紧：与 11-loop 鱼段、dropBait 完全同口径的
   「半径 ≤ 0.95×POND_RADII[角度档]」。留 ~0.87× 真实岸线余量，防鱼贴岸/上岸。 */
function pondClamp(x, z){
  const r = Math.hypot(x, z);
  if (r <= 1e-6) return { x, z, r: 0, ok: true };
  let a = Math.atan2(z, x); if (a < 0) a += TAU;
  const ri = Math.min(POND_RADII.length - 1, Math.floor(a / TAU * POND_RADII.length));
  const cap = POND_RADII[ri] * 0.95;
  if (r <= cap) return { x, z, r, ok: true };
  const k = cap / r;
  return { x: x * k, z: z * k, r: cap, ok: false };
}

/* 把"提议的偏移 (dx,dz)"限制成"落在池内、且量级 ≤ maxMag"的偏移。
   · 若 (lx+dx, lz+dz) 仍在池内 ⇒ 原样返回（保持行为的方向与力度）。
   · 若会越过池域 ⇒ 用 pondClamp 把终点拉回岸线内，再取 (终点 − 起点) 作为偏移。
     这样**偏移方向会朝池心偏一点**（不再硬顶着岸推），且量级自然变小、不超过岸线余量。
   这是"避障/惊鱼/聚集各自单独调用也安全"的兜底：合并入口 koiBehaviorOffset
   也走它，但**先**把三项相加再限总量（见下），所以单项限幅只是各自封顶。 */
function behavClamp(lx, lz, dx, dz, maxMag){
  let ax = dx, az = dz;
  const mag = Math.hypot(ax, az);
  if (mag > maxMag){ ax = ax / mag * maxMag; az = az / mag * maxMag; }
  const tgt = pondClamp(lx + ax, lz + az);
  let ox = tgt.x - lx, oz = tgt.z - lz;
  const om = Math.hypot(ox, oz);
  if (om > maxMag){ ox = ox / om * maxMag; oz = oz / om * maxMag; }
  return { x: ox, z: oz };
}

/* ── 水中障碍表（池局部坐标）───────────────────────────────────────────────
   半径取**保守圆包络**：立峰/石矶是 SDF 不规则体、汀步是 0.68×0.98 石板，
   这里都按「最大水平半径 + 鱼体半长余量」取一个能把它们整个包住的圆。
   · taihuShelf baseR=1.55 → 1.9×baseR≈2.95（见 makeTaihuHeroGeo 的 R = baseR*1.9）
     + 伴石/咬缺余量，再 + 0.45m（鱼体半长 ~0.36 + 0.09 边距）⇒ 3.40。
   · 伴石 baseR 0.80/0.62 → 1.9×baseR + 0.45 ⇒ 1.97 / 1.63。
   · 汀步半宽 0.34×~1.06 实例缩放 ≈ 0.36 + 0.45 ⇒ 0.81。
   位置与 08-assemble / 05-water 的摆位公式**逐字对齐**（同一组角/步距常量），
   所以是"从 POND_RADII 与已知障碍位置推导"，不是另造一套物理。 */
const STONES_N = 11, STONES_X0 = -3.6, STONES_STEP = 1.02, STONES_Z = 5.6;   // 同 makeSteppingStones（**世界** z）
const HERO_ANG = Math.PI * 0.67;                                              // 同 08-assemble heroStones
/* ⚠️ 坐标系：锦鲤在 koiGroup 里、该组 `position.z = +3`（世界），
   所以**锦鲤局部 z = 世界 z − 3**。而立峰/汀步石都是 `world.add(...)` 直接挂
   world 的**世界坐标**（08 的 `shelf.position.set(hx,0,hz)` + `world.add(shelf)`、
   05 的 `world.add(makeSteppingStones())`）⇒ 障碍表必须减掉这 3 米才是锦鲤坐标。
   漏减的后果很隐蔽：障碍圆落在鱼道的另一侧，鱼照旧穿过汀步，而避障门禁却全绿
   （它量的是"离障碍更远了一点"，不是"真的没碰到障碍"）。 */
const POND_CENTER_Z = 3.0;
function buildKoiObstacles(){
  const list = [];
  /* 立峰「云根」：世界 (cos·rw, sin·rw) → 锦鲤局部 (x, z − POND_CENTER_Z) */
  const ki = Math.round((HERO_ANG / TAU) * POND_RADII.length) % POND_RADII.length;
  const rw = POND_RADII[ki] * 0.95;
  const hx = Math.cos(HERO_ANG) * rw, hz = Math.sin(HERO_ANG) * rw - POND_CENTER_Z;
  list.push({ name:'taihuShelf', x: hx, z: hz, r: 1.55 * 1.9 + 0.45 });
  list.push({ name:'taihuComp0', x: hx + 1.45, z: hz - 0.55, r: 0.80 * 1.9 + 0.45 });
  list.push({ name:'taihuComp1', x: hx - 1.25, z: hz + 0.68, r: 0.62 * 1.9 + 0.45 });
  /* 汀步 11 块（世界 z=5.6 → 局部 2.6） */
  for (let i = 0; i < STONES_N; i++)
    list.push({ name:'stepStone' + i, x: STONES_X0 + i * STONES_STEP,
                z: STONES_Z - POND_CENTER_Z, r: 0.34 * 1.06 + 0.45 });
  return list;
}
export const KOI_OBSTACLES = buildKoiObstacles();

/* ── 行为开关（默认全开；可逐步关掉做二分定位）───────────────────────────
   主代理/探针改这里即可，无需改任何调用点。 */
export const KOI_BEHAVIOR = {
  avoid:   true,   // 避障：绕开立峰/汀步等水中障碍
  startle: true,   // 惊鱼：玩家点击/强涟漪让附近鱼短暂加速+偏转
  cohesion:true,   // 轻微聚集：同组鱼保持最小间距，避免叠在一起
  /* 惊鱼的**自动来源**：在 spawnRipple 内把"非雨且 strength>1.2"的涟漪（=玩家点击）
     自动记一次惊扰。若主代理已在点击命中处**显式**调 koiStartleAt，可把本项置 false
     避免同一击双记（默认 true，探针负例用它来单独验证自动钩子）。 */
  startleFromRipple: true,
};

/* 各行为的位移硬上界（米）。叠加后总位移另受 KOI_OFFSET_TOTAL_CAP 与
   11-loop 原有的 0.95×POND_RADII 夹紧双重保护 ⇒ 任何开关组合下都不出池。 */
const AVOID_MAX   = 1.20;   // 避障：足以从 0.28m 间隙里挪开又不脱轨太远
const STARTLE_MAX = 1.60;   // 惊鱼：一记涟漪的推力（比避障略大，但时间极短）
const COHESION_MAX= 0.90;   // 聚集：同组分离的微推（最低优先级）
const KOI_OFFSET_TOTAL_CAP = 2.60;   // 三项叠加后的总位移上界

/* ── ① 避障（avoid）───────────────────────────────────────────────────────
   对每条鱼，找出最近的水中障碍；若其"表面距离"(dist − r) 落在
   [触发距离, 远离距离] 内，则沿「鱼 − 障碍」方向**推离**，推力随
   穿入深度增大而增大（越近推得越狠），到 0.45m（鱼体半长）外为 0。
   纯几何，不依赖任何物理引擎。返回 (dx, dz)，量级 ≤ AVOID_MAX。 */
function koiAvoidOffset(lx, lz){
  if (!KOI_BEHAVIOR.avoid) return { x: 0, z: 0, near: null, gap: Infinity };
  const TRIG = 0.90;      // 表面距 < TRIG 开始避让
  const CLEAR = 0.45;     // 鱼体半长：到这以外完全不受影响
  let ax = 0, az = 0, nearest = null, nearestGap = Infinity;
  for (const o of KOI_OBSTACLES){
    const dx = lx - o.x, dz = lz - o.z;
    const dist = Math.hypot(dx, dz);
    const gap = dist - o.r;                       // 表面距离（负 = 已在圆内）
    if (gap < nearestGap){ nearestGap = gap; nearest = o; }
    if (gap >= TRIG) continue;                    // 还远，不管
    const depth = TRIG - gap;                     // 0..TRIG-CLEAR
    if (depth <= 0) continue;                     // 已出 CLEAR 带，无需避
    // 推离方向：障碍 → 鱼；鱼恰在圆心时给个确定性兜底方向（用相位，避免 NaN）
    let ux = dx, uz = dz;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-4){ ux = 1; uz = 0; } else { ux /= ul; uz /= ul; }
    const push = Math.min(AVOID_MAX, (depth / (TRIG - CLEAR)) * AVOID_MAX);
    ax += ux * push; az += uz * push;
  }
  const mag = Math.hypot(ax, az);
  if (mag > AVOID_MAX){ ax = ax / mag * AVOID_MAX; az = az / mag * AVOID_MAX; }
  const cl = behavClamp(lx, lz, ax, az, AVOID_MAX);     // 独立调用也保证不出池
  return { x: cl.x, z: cl.z, near: nearest, gap: nearestGap };
}
export { koiAvoidOffset };

/* ── ② 惊鱼（startle）────────────────────────────────────────────────────
   玩家点击水面 / 强涟漪在落点产生一圈"惊扰"：附近鱼被**短暂**加速并**偏转**。
   这里把惊扰建模为一串"事件"（落点 + 起止时刻 + 强度），由：
     · `koiStartleAt(lx, lz, tNow, strength)` —— 主代理在**点击命中水面**处显式调用（推荐）；
     · `spawnRipple` 内部的自动钩子 —— 任何"玩家级"涟漪（非雨）自动记一次（兜底）。
   每帧由 `koiStartleOffset(lx, lz, tNow)` 读当前时刻仍在生效的事件，
   沿「鱼 − 落点」方向给一个**指数衰减**的推力（推 + 一点点切向偏转 ⇒ "惊散"而非"齐射"）。
   纯函数（事件表是模块级状态，读取无副作用）。 */
const KOI_STARTLE = [];                 // 活跃惊扰：{ lx, lz, t0, life, strength }
const KOI_STARTLE_MAX_EVENTS = 8;      // 事件表上限（防长按狂点无限增长）
const STARTLE_R = 3.2;                 // 惊扰影响半径（米）：点击附近这几条鱼被惊到
const STARTLE_LIFE = 1.1;               // 单次惊扰的有效时长（秒）
const STARTLE_TANGENT = 0.35;           // 切向偏转占比（惊散感），其余为径向推开

/** 在**池局部** (lx,lz) 记一次惊扰（强度默认 1.6 = 与玩家点击涟漪一致）。 */
export function koiStartleAt(lx, lz, tNow, strength = 1.6){
  if (!KOI_BEHAVIOR.startle) return;
  if (KOI_STARTLE.length >= KOI_STARTLE_MAX_EVENTS) KOI_STARTLE.shift();
  KOI_STARTLE.push({ lx, lz, t0: tNow, life: STARTLE_LIFE, strength });
}
function koiStartleOffset(lx, lz, tNow){
  if (!KOI_BEHAVIOR.startle) return { x: 0, z: 0 };
  let ax = 0, az = 0;
  for (let i = KOI_STARTLE.length - 1; i >= 0; i--){
    const e = KOI_STARTLE[i];
    const age = tNow - e.t0;
    if (age < 0) continue;
    if (age > e.life){ KOI_STARTLE.splice(i, 1); continue; }   // 顺带回收
    const dx = lx - e.lx, dz = lz - e.lz;
    const dist = Math.hypot(dx, dz);
    if (dist >= STARTLE_R || dist < 1e-4) continue;
    // 径向（推开）：随距离与时间双衰减
    const tFall = 1 - age / e.life;                            // 1→0
    const rFall = 1 - dist / STARTLE_R;                         // 中心 1 → 边缘 0
    const amt = e.strength * tFall * tFall * rFall;            // 平方衰减：起手猛、很快收
    // 径向推开单位向量
    const ux = dx / dist, uz = dz / dist;
    // 切向（惊散）：垂直于径向，方向由"哪一侧"确定 ⇒ 鱼被推时带一点侧旋
    const tx = -uz, tz = ux;
    ax += (ux * (1 - STARTLE_TANGENT) + tx * STARTLE_TANGENT) * amt;
    az += (uz * (1 - STARTLE_TANGENT) + tz * STARTLE_TANGENT) * amt;
  }
  const mag = Math.hypot(ax, az);
  if (mag > STARTLE_MAX){ ax = ax / mag * STARTLE_MAX; az = az / mag * STARTLE_MAX; }
  const cl = behavClamp(lx, lz, ax, az, STARTLE_MAX);
  return { x: cl.x, z: cl.z };
}
export { koiStartleOffset };

/* 惊扰"加速"信号：供调用方（如需给该鱼 d.speed 一个短暂加成）读取当前惊扰能量。
   本模块不直接改 11-loop 的 d.t（那是调用方的事），只暴露纯读的强度函数。 */
export function koiStartleEnergy(lx, lz, tNow){
  if (!KOI_BEHAVIOR.startle) return 0;
  let e = 0;
  for (const ev of KOI_STARTLE){
    const age = tNow - ev.t0;
    if (age < 0 || age > ev.life) continue;
    const dist = Math.hypot(lx - ev.lx, lz - ev.lz);
    if (dist >= STARTLE_R) continue;
    const tFall = 1 - age / ev.life, rFall = 1 - dist / STARTLE_R;
    e = Math.max(e, ev.strength * tFall * tFall * rFall);
  }
  return e;
}

/* ── ③ 轻微聚集（cohesion）───────────────────────────────────────────────
   最低优先级：让**同组**（同一条轨道 / orbit 相同）鱼之间保持最小间距，
   避免两条鱼叠在一点。做法：对同组最近邻，若距离 < MIN_SEP 则沿"背离最近邻"
   方向给一个很小的微推（≤ COHESION_MAX），远则不管。
   传入 peers = 同组其它鱼的池局部位置数组 [{x,z}, …]。返回 (dx,dz)。
   注意轨道本身已把簇位错开（orbit+phase），所以绝大多数帧这里几乎为 0。 */
const COHESION_MIN_SEP = 0.55;          // 鱼体长 ~0.72 ⇒ 中心距 0.55 已是半重叠
function koiCohesionOffset(lx, lz, peers){
  if (!KOI_BEHAVIOR.cohesion || !peers || !peers.length) return { x: 0, z: 0 };
  let sx = 0, sz = 0;
  for (const p of peers){
    if (p === null || p === undefined) continue;
    const dx = lx - p.x, dz = lz - p.z;
    const d = Math.hypot(dx, dz);
    if (d >= COHESION_MIN_SEP || d < 1e-4) continue;
    // 重叠越深推得越狠（到 MIN_SEP 处为 0）
    const push = Math.min(COHESION_MAX, (1 - d / COHESION_MIN_SEP) * COHESION_MAX * 0.6);
    const ux = d < 1e-4 ? 1 : dx / d, uz = d < 1e-4 ? 0 : dz / d;
    sx += ux * push; sz += uz * push;
  }
  const mag = Math.hypot(sx, sz);
  if (mag > COHESION_MAX){ sx = sx / mag * COHESION_MAX; sz = sz / mag * COHESION_MAX; }
  return { x: sx, z: sz };
}
export { koiCohesionOffset };

/* ── 合并：三项叠加 + 总上界 + 池域夹紧（对外唯一入口）────────────────────
   调用方（11-loop）把返回的 (x, z) **加**在轨道位置之上。返回值同时给出
   夹紧后的绝对目标点 clamped（若需要），但**推荐调用方仍走自己原有的
   0.95×POND_RADII 夹紧**保持与投喂路径完全一致。
   ⚠️ 纯函数：内部对传入的 peers 只读；不修改任何鱼的状态。 */
export function koiBehaviorOffset(lx, lz, tNow, peers){
  const avoid   = koiAvoidOffset(lx, lz);
  const startle = koiStartleOffset(lx, lz, tNow);
  const cohere  = koiCohesionOffset(lx, lz, peers);
  let dx = avoid.x + startle.x + cohere.x;
  let dz = avoid.z + startle.z + cohere.z;
  // 总位移硬上界（三项同时顶满也不可能突破）
  const mag = Math.hypot(dx, dz);
  if (mag > KOI_OFFSET_TOTAL_CAP){ dx = dx / mag * KOI_OFFSET_TOTAL_CAP; dz = dz / mag * KOI_OFFSET_TOTAL_CAP; }
  const target = pondClamp(lx + dx, lz + dz);       // 池域兜底（与 11-loop 同口径）
  const cx = target.x - lx, cz = target.z - lz;     // 实际生效的偏移（已含池域夹紧）
  return {
    dx: cx, dz: cz,
    energy: koiStartleEnergy(lx, lz, tNow),          // 惊扰能量（加速信号，纯读）
    avoidGap: avoid.gap,                             // 最近障碍表面距（诊断/门禁用）
    clamped: !target.ok,                             // 是否被池域夹紧（诊断）
  };
}

/* 锦鲤：沿椭圆轨道游动 */
export function makeKoiGroup(n = 11){
  const g = new THREE.Group();
  g.position.set(0, 0, 3);          // 池塘中心（与 POND_SHAPE 对齐）
  g.userData.fishes = [];
  /* ── 预抽（2026-09-23 · T0）────────────────────────────────────────────
     为什么必须挪到这里抽：这 4×n 次 rr() 原来写在 GLB 的 onLoad 里 —— 而 onLoad
     **什么时候**执行取决于模型何时加载完（冷启动要取文件，热启动走 HTTP 缓存）。
     全局流的位置只由"抽了多少次"决定 ⇒ 锦鲤落地早/晚，**其后**的抽样整体偏移量就不同；
     而柳/竹/立峰是**延迟批**（首帧之后才跑，每批之间让出一帧），恰好落在这个窗口里
     ⇒ 全园布局随"加载时序"漂移，且不报任何错。
     实测（2026-09-23，两次加载同一份代码）：157 个实例化网格里 **76 个不同，且全部落在延迟批**
     —— 柳叶条数 7992 vs 7995、竹竿首实例位置 (−0.09,0,0.90) vs (0.84,0,0.32)；
     而**模块期网格逐个逐实例完全一致**（正是"漂移发生在延迟批执行窗口内"的指纹）。
     修法：把 4×n 次抽取挪到本函数**被调用**的时刻（模块期、同步、顺序固定），回调里只读不抽。
     ⚠️ 次数与顺序必须与原来**逐条一致**（t → speed → jitter → phase），否则等于改了布局。
     ⚠️ `Math.random()*18`（riseAt）也要一起预抽：它虽不是全局流，但**冻结 Math.random 的探针**
        靠"调用顺序固定"才可复现（竹叶洗牌也吃这条流），留在异步回调里等于把顺序交给时序。 */
  const KOI_DRAW = [];
  for (let i = 0; i < n; i++){
    KOI_DRAW.push({ t: rr(0, TAU), speed: rr(0.10, 0.22), jitter: rr(0.72, 1.0),
                    phase: rr(0, TAU), rise: Math.random() * 18 });
  }
  /* ── 双轨入口（2026-10-02 · CDN 可选基址）────────────────────────────────
     CDN 关（默认）：走 else 的直接 load —— 语句形状与旧版相同（assetUrl 对空 base
     原样返回），请求 URL、回调、时序一字不变；
     CDN 开：经 13-preload 的 withCdnFallback 包壳 —— CDN 失败（onError 或超 60%
     预载预算）自动用本地路径重试一次，**本地也失败**才落到 koiOnErr 的
     settleAsset(false)。三个回调体一字未改：回调里只读 KOI_DRAW 的预抽值，
     绝不碰任何随机流（本函数开头的铁律，开了 CDN 也不放松）。 */
  const koiOnLoad = (gltf)=>{
    const src = gltf.scene;
    const b1 = new THREE.Box3().setFromObject(src);
    const s1 = b1.getSize(new THREE.Vector3());
    src.scale.setScalar(0.72 / Math.max(s1.x, s1.y, s1.z));
    src.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(src);
    const c2 = b2.getCenter(new THREE.Vector3());
    const halfH = (b2.max.y - b2.min.y) / 2;      // 用于判"鱼背有没有露出水面"

    for (let i = 0; i < n; i++){
      const holder = new THREE.Group();
      const f = src.clone(true);
      f.position.sub(c2);                       // 以模型中心为原点
      f.traverse(o=>{ if (o.isMesh){ o.castShadow = false; o.receiveShadow = false; } });
      holder.add(f);
      const d = KOI_DRAW[i];                    // 预抽值（见函数开头）：回调里**绝不**抽流
      holder.userData = {
        orbit: i % KOI_ORBITS.length,
        t: d.t, speed: d.speed,
        jitter: d.jitter, phase: d.phase,
        riseAt: 6 + d.rise, rising: false, riseT0: 0, halfH,
      };
      g.add(holder);
      g.userData.fishes.push(holder);
    }
    /* 锦鲤是异步挂载的：layer 不被子节点继承，必须等 holder 们都进了组再统一打一遍
       折射层标记 —— 漏了就是「水面折射里一条鱼都没有」，而且不报错。 */
    markUnderwater(g);
    HOOKS.settleAsset?.('assets/koi.glb', true);      // 预载清单：到位（13-preload 经 HOOKS 延迟绑定）
  };
  const koiOnProgress = (e)=>{                        // ← 第三槽：原为 `undefined`，现接 onProgress
    HOOKS.reportAssetProgress?.('assets/koi.glb', e.loaded, e.total);
  };
  const koiOnErr = (e)=>{
    /* 失败也必须报给预载清单，否则 required:false 的项走不进替身流程 */
    HOOKS.settleAsset?.('assets/koi.glb', false, e);
    console.warn('koi.glb 加载失败', e);
  };
  if (ASSET_CDN.base){
    withCdnFallback('assets/koi.glb', (reqUrl)=>new Promise((resolve, reject)=>{
      new GLTFLoader().load(reqUrl, resolve, koiOnProgress, reject);
    })).then(koiOnLoad, koiOnErr);
  } else {
    new GLTFLoader().load(assetUrl('assets/koi.glb'), koiOnLoad, koiOnProgress, koiOnErr);
  }
  return g;
}

/* ── Hyper3D Rodin 生成的真实模型：加载一次，克隆复用 ──
   ⚠️ 缓存键必须带上**归一化尺寸与材质覆盖**。原来只按 url 缓存，于是
   `placeAssets('Turtle.glb', 0.5)` 与 `loadAssetOnce('Turtle.glb', 0.46)` 共用先到的那一份模板 ——
   两个尺寸里必有一个是错的，而且取决于谁先加载完（时序相关，最难查）。
   顺带把"在飞的加载"也登记：并发请求同一配置时只解析一次；失败要把在飞项删掉，否则永远无法重试。 */
/* 两级缓存：
   · rawCache  —— 按 URL 缓存**未归一化的原始 gltf.scene**（Promise），一个 URL 只解析一次。
   · assetCache—— 按 "URL|尺寸|材质" 缓存**归一化后的模板**，各配置互不干扰。
   ⚠️ 踩过一次：一开始只做了第二级、把尺寸也写进 key，结果芭蕉的 8 株各自一个 leafScale
   ⇒ **同一个 1MB 的 GLB 被解析 8 次**（几何/贴图都多份）。正确做法是审计里那句话：
   "缓存不可变的原始模板，按实例做归一化" —— 原始解析只有一份，归一化后的克隆各自独立。 */
const rawCache = new Map();          // url → Promise<原始 scene>
const assetCache = new Map();        // url|尺寸|材质 → 归一化模板
export let assetFailures = 0;               // 供启动状态显示
/* 组合式 GLTFLoader 实例：自动启用 Draco/KTX2/Meshopt 解码
   ⚠️ 解码器**必须直接用本模块的 import**，不能读 index.html 内联模块里的 `$解码器`：
   拆模块后 src 与内联模块不再共享词法世界，那个名字在 src 里压根不存在 → ReferenceError；
   而它是在 `new Promise` 的 executor 里抛的，被下游 `.catch(()=>{})` 静默吞掉 ——
   现象是 Turtle / BananaPlant / LotusPlant 三类 GLB **永远挂不上**，却零告警、零失败计数，
   全靠 smoke 的「四类 GLB 资产均已挂载」才看得见（2026-09-20 拆模块时实测）。 */
const DECODERS = { DRACOLoader, KTX2Loader, MeshoptDecoder };
function createGLTFLoaderWithDecoders(){
  const loader = new GLTFLoader();
  // 启用 Draco 几何压缩
  if (DECODERS.DRACOLoader){
    const dracoLoader = new DECODERS.DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(dracoLoader);
  }
  // 启用 KTX2 纹理压缩
  if (DECODERS.KTX2Loader){
    loader.setKTX2Loader(new DECODERS.KTX2Loader());
  }
  // 启用 Meshopt 压缩几何
  if (DECODERS.MeshoptDecoder){
    loader.setMeshoptDecoder(DECODERS.MeshoptDecoder);
  }
  return loader;
}

export function loadAssetOnce(url, targetSize, cb, overrideMat){
  const key = url + '|' + targetSize + '|' + (overrideMat ? (overrideMat.uuid || 'mat') : '-');
  if (assetCache.has(key)){ cb(assetCache.get(key)); return; }
  if (!rawCache.has(url)){
    /* ── 双轨入口（2026-10-02 · CDN 可选基址）─────────────────────────────
       CDN 关（默认）：走 else —— 与旧实现**逐语句相同**（仅请求 URL 改经 assetUrl，
       空 base 恒等返回），失败判定仍在 loader 的 onError 里同步做
       rawCache.delete + assetFailures++ + settleAsset(false)，时序一位不挪。
       CDN 开：attempt 只负责"发一次请求"（onError 只 reject，**不算失败**）；真失败
       统一挪到 raw.catch —— 走到那里时 withCdnFallback 已把"CDN 失败 ⇒ 本地重试一次"
       走完，**两次都失败**才轮得到 = 失败判定链与旧版同一条
       （settleAsset(false) → required:false 的项进程序化替身流程）。 */
    if (ASSET_CDN.base){
      const attempt = (reqUrl)=>new Promise((resolve, reject)=>{
        const loader = createGLTFLoaderWithDecoders();
        loader.load(reqUrl, (gltf)=>{ HOOKS.settleAsset?.(url, true); resolve(gltf.scene); },
          /* ← 第三槽：onProgress 口径不变（SW cache-first 下 0→100 跳变是预期，见
             13-preload.reportAssetProgress 的注释）。CDN 半途而废时 13 的回退会把
             该件 loaded 清零，本地重下从真实起算。settle/report 的键仍是相对 url。 */
          (e)=>{ HOOKS.reportAssetProgress?.(url, e.loaded, e.total); },
          reject);
      });
      const raw = withCdnFallback(url, attempt);
      raw.catch((e)=>{
        rawCache.delete(url); assetFailures++;
        /* 失败报给预载清单：required:false 的项据此进入程序化替身流程
           （芭蕉叶片不来就会留一根 3.6m 高的光杆，比没有芭蕉更难看）。 */
        HOOKS.settleAsset?.(url, false, e);
        console.warn('模型加载失败：', url, e);
      });
      rawCache.set(url, raw);
    } else {
      rawCache.set(url, new Promise((resolve, reject)=>{
        const loader = createGLTFLoaderWithDecoders();
        loader.load(assetUrl(url), (gltf)=>{ HOOKS.settleAsset?.(url, true); resolve(gltf.scene); },
          /* ← 第三槽：原为 `undefined`，现接 onProgress（13-preload 的预载清单）
             ⚠️ **SW cache-first 下这里会直接 0→100 跳变，这是预期**：
             首次访问走网络时 loaded/total 是真进度；SW 装好后 .glb 命中缓存直接
             return，不产生数据流事件，直到 onLoad 那一刻 settle 一次性补满。
             装成 PWA 后那段时间里根本没有网络发生，没有进度可言。 */
          (e)=>{ HOOKS.reportAssetProgress?.(url, e.loaded, e.total); },
          (e)=>{
            rawCache.delete(url); assetFailures++;
            /* 失败报给预载清单：required:false 的项据此进入程序化替身流程
               （芭蕉叶片不来就会留一根 3.6m 高的光杆，比没有芭蕉更难看）。 */
            HOOKS.settleAsset?.(url, false, e);
            console.warn('模型加载失败：', url, e); reject(e);
          });
      }));
    }
  }
  rawCache.get(url).then(raw=>{
    const src = raw.clone(true);                 // 几何/贴图与原始模板共享，只有变换是独立的
    const b1 = new THREE.Box3().setFromObject(src);
    const s1 = b1.getSize(new THREE.Vector3());
    src.scale.setScalar(targetSize / Math.max(s1.x, s1.y, s1.z));
    src.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(src);
    // 居中，底部落在 y=0 —— 摆放**不要**再改这个 position，用外层 holder（见 placeAssets）
    src.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    src.traverse(o=>{
      if (o.isMesh){
        o.castShadow = true; o.receiveShadow = true;
        if (overrideMat) o.material = overrideMat;
      }
    });
    assetCache.set(key, src);
    cb(src);
  }).catch(()=>{});
}

export function placeAssets(url, size, placements, overrideMat){
  loadAssetOnce(url, size, (src)=>{
    placements.forEach(p=>{
      /* ⚠️ 摆放必须放在**外层 holder** 上，不能改克隆体自己的 position：
         loadAssetOnce 把"水平居中 + 底部对齐到 y=0"的偏移写在 src.position 上，
         克隆体会继承它，而 c.position.set(...) 会把这份归一化偏移**整个覆盖掉** ——
         模型于是按原始轴心摆放（左右不居中、上下不落底）。holder 管摆放、
         子节点管归一化，两者各一层。 */
      const holder = new THREE.Group();
      holder.position.set(p.x, p.y || 0, p.z);
      if (p.ry) holder.rotation.y = p.ry;
      if (p.s) holder.scale.multiplyScalar(p.s);
      holder.add(src.clone(true));
      world.add(holder);
    });
    HOOKS.onAssetAttached?.();         // 迟到资产立刻拿到当前季节状态，不等下一次环境切换
  }, overrideMat);
}

/* 太湖石峰：瘦高、上端展如冠、轮廓扭曲起皱
   参考冠云峰（高 6.5m / 基座 0.8m，高宽比约 8:1）的"瘦漏透皱"造型 */
/* 太湖石峰：取「云头雨脚」经典造型 —— 下部收细如雨脚，上部展开如云头，
   配多频皱褶与深凹孔洞，对应赏石的瘦、漏、透、皱。云头即祥云，是冠云峰、瑞云峰等名石得名之由 */
function makeTaihuPeak(height = 4.5, baseR = 0.42, seed = 0){
  // 分辨率必须撑得住下面的细节：皱褶最高到 sin(a*31)，一周只有 12 个采样点会直接走样。
  // 72×40 ≈ 5.8k 三角形/峰，十几块峰约 10 万面，可以接受。
  // 56 边可无走样地承载到 a*23 的谐波；80 段保证竖向皱褶有足够采样。
  const segs = 80, sides = 56;
  const verts = [], idx = [], uvs = [];
  const ph = seed * 1.7;                            // 每块石给不同相位，避免雷同

  // 半径剖面：雨脚（底细）→ 腰微收 → 云头（上展）→ 收尖
  const radiusAt = (t)=>{
    const foot  = 0.52 + 0.48 * Math.pow(Math.min(1, t / 0.26), 0.5);
    const waist = 1 - 0.16 * Math.sin(Math.PI * Math.min(1, t / 0.62));
    const crown = Math.pow(Math.max(0, t - 0.42) / 0.58, 1.05);
    const cap   = 1 - 0.78 * Math.pow(Math.max(0, t - 0.88) / 0.12, 1.6);   // 收成圆肩，不留尖
    return baseR * foot * waist * (1 + 1.25 * crown) * Math.max(0.04, cap);
  };

  // 孔洞（漏）—— 第十二轮增强：太湖石"漏透"是它区别于普通石头的气质，
  // 圆润化时不能把头砍掉。口径加大、深度加深、孔缘陡峭（锐利的洞穴口，
  // 光从一侧进来时另一侧看得到"透"的暗口）。
  const holes = [];
  for (let i = 0; i < 42; i++){
    holes.push({ a: rr(0, TAU), t: rr(0.10, 0.93), r: rr(0.20, 0.46), d: rr(0.58, 0.95) });
  }

  for (let i = 0; i <= segs; i++){
    const t = i / segs;
    const y = height * t;
    const r = radiusAt(t);
    const tw = t * 1.5 + ph;                       // 整体扭转
    for (let k = 0; k < sides; k++){
      const a = (k / sides) * TAU + tw;
      // 皱：越靠上越强
      // ⚠️ 第十二轮「圆润化」（用户反馈：太湖石尖锐突出形态太多）——
      //    原来 5 个谐波直接叠加，高频（a*23/a*17/a*12）峰值叠出大量刺突。
      //    两招：① 高频项振幅整体降档 ② tanh 饱和平滑 —— 尖刺压成圆钝凸起，
      //    低频大形（横脊/云头三瓣）保留，太湖石「瘦漏透皱」气质不丢。
      const wrinkleRaw = 1
        + (0.16 + 0.20 * t) * Math.sin(a * 3 + t * 9 + ph)      // 低频大形
        + (0.11 + 0.14 * t) * Math.cos(a * 5 - t * 6 + ph)      // 低频大形
        + (0.085 + 0.05 * t) * Math.sin(a * 8 + t * 14 + ph)    // 中频凹凸（形态主力：保皱）—— 原 0.062 不足，抬回
        + (0.050 + 0.06 * t) * Math.cos(a * 13 - t * 20 + ph)   // 中高频皴纹 —— 砍尖但留质
        + 0.020 * Math.sin(a * 19 + t * 31 + ph)                // 高频只剩很轻一点（原 0.046）
        + 0.008 * Math.cos(a * 25 - t * 37 + ph)                // 最高频几乎归零（原 0.032）
        // 竖向细纹：沟槽感（0.014→0.020 微抬，是"皱"的竖向笔触）
        + 0.020 * Math.sin(a * 19 + ph * 2.7) * (0.35 + 0.65 * Math.sin(t * 6.0 + ph));
      /* tanh 只压**尖刺峰值**：中频（8/13 谐波）在 ±0.15 附近仍在 tanh 线性带内，
         所以皴纹保留；真正被削的是高频叠加出来的尖点。 */
      const wrinkle = 1 + Math.tanh((wrinkleRaw - 1) * 1.15) * 0.72;
      // 云头：上部三瓣起伏
      const lobeAmt = Math.pow(Math.max(0, t - 0.5) / 0.5, 1.1);
      const lobe = 1 + lobeAmt * 0.24 * Math.cos(a * 3 + 0.9 + ph);
      // 孔洞凹陷
      let dimple = 0;
      for (const h of holes){
        let da = Math.abs(a - h.a) % TAU;
        if (da > Math.PI) da = TAU - da;
        const dt = (t - h.t) * 1.8;
        const dist = Math.sqrt(da * da + dt * dt);
        if (dist < h.r) dimple = Math.max(dimple, Math.pow(1 - dist / h.r, 1.25) * h.d);  // ^1.25 孔缘更陡
      }
      const rad = r * wrinkle * lobe * (1 - dimple);
      verts.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
      uvs.push((k / sides) * 2.5, t * 2.5);
    }
  }
  for (let i = 0; i < segs; i++){
    for (let k = 0; k < sides; k++){
      const a = i * sides + k, b = i * sides + (k + 1) % sides;
      const c = (i + 1) * sides + k, d = (i + 1) * sides + (k + 1) % sides;
      idx.push(a, c, b,  b, c, d);
    }
  }

  const topIdx = verts.length / 3;
  verts.push(0, height * 0.985, 0);          // 顶心略低于顶环 → 平缓圆顶而非尖突
  /* ⚠️ 顶心必须**同时** push 一个 uv。原来只 push 了 position ——
     整个几何体 position 4537 / uv 4536，顶扇那几个顶点采到越界的 uv；
     烘进合并几何后表现为两个 mergedStatic 各差 11 / 4 条 uv。
     这种错不报错、不 NaN，是"最难查"的一类，所以下面加了机器校验。 */
  uvs.push(1.25, 0.985 * 2.5);
  for (let k = 0; k < sides; k++){
    idx.push(segs * sides + k, topIdx, segs * sides + (k + 1) % sides);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  /* ── 腔体 AO（顶点色）──
     径向峰是星形曲面，"凹不凹"可以直接用**半径与邻域的差**判断：
     某点半径明显小于角向/竖向邻居的平均 → 它在沟里 / 孔里 → 压暗。
     这不是真 AO，但足以让峰群与 SDF 立峰共用同一套明暗语言（近景不再"融蜡"）。
     ⚠️ 数组必须在**顶心 push 之后**按最终顶点数分配 —— 我第一版把它写在顶心之前，
     于是 color 比 position 少 1 条，正好复现本文件顶部记过的那类错（"顶心漏 push uv"）。
     计数不一致不会报错、不 NaN，只会让合并校验告警/几何悄悄错位。 */
  const pcol = new Float32Array(verts.length);
  pcol.fill(1);
  const radOf = (ii, kk)=> Math.hypot(verts[(ii * sides + kk) * 3], verts[(ii * sides + kk) * 3 + 2]);
  for (let i = 0; i <= segs; i++){
    for (let k = 0; k < sides; k++){
      const r0 = radOf(i, k);
      const kp = (k + 1) % sides, km = (k - 1 + sides) % sides;
      const ip = Math.min(segs, i + 1), im = Math.max(0, i - 1);
      const avg = (radOf(i, kp) + radOf(i, km) + radOf(ip, k) + radOf(im, k)) * 0.25;
      const cav = Math.max(0, Math.min(1, (avg - r0) / (baseR * 0.45)));
      const shade = 1 - 0.42 * cav;
      const vi = i * sides + k;
      pcol[vi * 3] = shade; pcol[vi * 3 + 1] = shade; pcol[vi * 3 + 2] = shade;
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(pcol, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ══════════════════════════════════════════════════════════════
   特置太湖石立峰（hero stone）：SDF 隐式场 + Surface Nets 等值面
   ══════════════════════════════════════════════════════════════
   ⚠️ 为什么另起一套，而不是继续调 makeTaihuPeak ——
   上面那个函数是「星形径向曲面」：半径写成 r(θ,y) 的单值函数，"孔"只能靠把半径
   压低（dimple）实现。这类曲面的拓扑**永远是亏格 0 的球面**：任何一条穿过它的
   射线只与表面相交一次。所以无论把孔挖多深，都挖不出一个通洞 ——
   而"瘦、皱、漏、透"里的「透」（隔石见景）正是太湖石区别于普通石头的特征。
   要真洞，就必须让表面能自我遮蔽：改用三维标量场 f(x,y,z)，取它的零等值面。
   本函数只服务 1~3 块**特置立峰**，不替换现有峰群，启动代价与面数都可控。 */

/* 确定性三维值噪声。⚠️ 全部用独立随机流/哈希，**不消耗全局 rnd** ——
   否则新增代码会把 rr() 的序列整体后移，全园布局跟着变（隐蔽的全场改动）。 */
function hash3i(i, j, k, s){
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263)
        + Math.imul(k, 1274126177) + Math.imul(s, 1013904223);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function vnoise3(x, y, z, s){
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c000 = hash3i(xi, yi, zi, s),         c100 = hash3i(xi + 1, yi, zi, s);
  const c010 = hash3i(xi, yi + 1, zi, s),     c110 = hash3i(xi + 1, yi + 1, zi, s);
  const c001 = hash3i(xi, yi, zi + 1, s),     c101 = hash3i(xi + 1, yi, zi + 1, s);
  const c011 = hash3i(xi, yi + 1, zi + 1, s), c111 = hash3i(xi + 1, yi + 1, zi + 1, s);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}
function fbm3(x, y, z, s, oct){
  let amp = 0.5, fr = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++){
    sum += amp * vnoise3(x * fr, y * fr, z * fr, s + i * 17);
    norm += amp; amp *= 0.5; fr *= 2.03;
  }
  return sum / norm;
}

/* ══════════════════════════════════════════════════════════════
   低空云雾 · mist field（2026-09-19）
   ══════════════════════════════════════════════════════════════
   ⚠️ 为什么**不是**把 scene.fog 调浓：
   均匀指数雾没有**上边界**，调浓就全画面泛白 —— mist 预设的 fogMul 从 4.4
   一路退回 1.3，根因就是主厅立面在 40m 处被洗成灰白（见该预设注释）。
   而"远看烟雾袅绕 / 近看处处是景"是**两个相反方向**的要求，同一个 uniform
   做不到，必须拆成几何层：
     · 远看：水面与岸线之上有一层**会飘、有厚度**的东西 → 看得见体积；
     · 近看：相机贴近时它必须**消失**，近景细节才留得住。
   所以这里是显式几何 + 贴图，而不是改雾参数：
     · 一片云絮 = 一张永远面向相机的软椭圆（**球形 billboard**），但做得扁而宽 →
       读出来是贴着水面的一屡雾，不是一颗棉花糖球；
       ⚠️ 必须球形而非"绕 Y 轴柱状 billboard"：默认机位在 (−20,17,32) 俯视约 30°，
       柱面 billboard 在俯视下会退化成一条线，等于没有雾。
     · 漂移 = **有界漫游**（正弦，不是线性平移）：云絮永远在自己那一亩地里晃，
       不会一路飘进粉墙或飘出园子；并按 **WIND.uWindVec** 偏置 —— 风向转了，雾跟着走。
     · 近淡出 = 每个实例按"到相机的距离"淡入 → 近观自动清空，近距离 judged 景才有细节。
*/
export function makeMistSpriteTex(){
  const W = 192, H = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++){
    for (let x = 0; x < W; x++){
      const u = x / (W - 1), v = y / (H - 1);
      const ex = (u - 0.5) * 2, ey = (v - 0.5) * 2;
      /* 椭圆：纵向压扁 1.55 → 横长竖向薄的一屡，不是圆饼 */
      const r = Math.min(1, Math.sqrt(ex * ex + ey * ey * 1.55));
      let a = 1 - r;
      a = a * a * (3 - 2 * a);                        // smoothstep 边缘
      /* fbm 打破规整椭圆 —— 边界必须不规则，否则一堆肥皂泡排排站 */
      const n = fbm3(u * 4.6, v * 4.6, 0.0, 7031, 4);
      a *= 0.30 + 1.05 * n;
      /* 底部略浓、顶部稀薄：雾贴水面实，往上散 */
      a *= 1.20 - 0.55 * v;
      const o = (y * W + x) * 4, b = Math.max(0, Math.min(1, a));
      d[o] = d[o + 1] = d[o + 2] = 255;               // 色在 shader 里乘 uColor，贴图只用 alpha
      d[o + 3] = (b * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

export const MIST_WHITE = new THREE.Color(0xffffff);
export const MIST = {
  uTime:    { value: 0 },
  uOpacity: { value: 0.20 },
  uColor:   { value: new THREE.Color(0xDCE0E2) },
  uMap:     { value: null },
  uNear:    { value: 6.0 },      // 相机 6m 以内：完全消失（近景不被糊）
  uNearEnd: { value: 16.0 },     // 到 16m 才完全显示 —— 中远景才有"袅绕"
  /* ⚠️ 与枝叶共用同一个 uniform 对象：L1 风向一转，雾的漂移方向跟着转，
     不需要在这里再赋值（写了反而容易被别处覆盖）。 */
  uWindVec: WIND.uWindVec,
};

export function makeMistField(){
  /* 雾场扩大版：从今天才有。用户反馈"雾只在水面"，于是把雾扩展到园子各处。
     策略：
     1. 保留池塘水面雾区（N_POND），但减少数量，让水面雾更自然。
     2. 增加散雾区（N_SCATTER），让雾随机分布在园子地面（草坪、石板路边界）。
     3. 减少雾的浓度，让雾气更轻薄、弥漫。
     这样可以避免"雾只覆盖水面"的感觉。 */
  /* 32+32 → 20+22（2026-09-21 走查 F5）：默认机位 40m 外，32 片贴水 billboard
     沿视线层层叠透，远半池被累加成近乎不透明的"磨砂玻璃"，正午也像起了大雾。 */
  const N_POND = 20, N_SCATTER = 22, N = N_POND + N_SCATTER;
  /* ⚠️ 独立随机流：绝不能消耗全局 rnd —— 否则全园布局（牌匾、驳岸石、柳枝、
     人物日程）的序列整体后移，那是一次不动声色的全场改动。 */
  const mr = mulberry32(20260919);
  const geo = new THREE.PlaneGeometry(1, 1);
  const base = new Float32Array(N * 3);
  const par  = new Float32Array(N * 4);
  for (let i = 0; i < N; i++){
    const overWater = i < N_POND;
    let pos, rad, hw, hh, ang, ki, R;
    if (overWater){
      /* 水面雾：围绕池塘半圆分布，随机半径 */
      ang = mr() * Math.PI;                  // 半圆分布，只在一侧
      ki  = Math.floor((ang / TAU) * POND_RADII.length) % POND_RADII.length;
      R   = POND_RADII[ki];
      rad = Math.sqrt(mr()) * R * 0.8;       // 水面雾化范围更集中
      hw  = 3.6 + mr() * 4.0;                // 半宽 3.6~7.6m（原 3.6~9.2）
      hh  = 0.6 + mr() * 1.0;                // 半高 0.6~1.6m（原 0.9~2.6）
      pos = {
        x: Math.cos(ang) * rad,
        y: 0.16 + mr() * 0.55 + hh * 0.3,   // 中心略抬：下缘没入水面
        z: 3 + Math.sin(ang) * rad           // 池心在世界 z = +3
      };
    } else {
      /* 散雾区：园子地面的随机分布，模拟晨雾 */
      /* 缩小子区域，避免雾飘到建筑内部 */
      const margin = 5.0;
      const minX = -15 + margin, maxX = 20 - margin;
      const minZ = -15 + margin, maxZ = 10 - margin;
      pos = {
        x: minX + mr() * (maxX - minX),
        y: 0.1 + mr() * 0.8,                 // 地面雾高度更低
        z: minZ + mr() * (maxZ - minZ)
      };
      /* 散布雾的大小和高度 */
      rad  = 3.0 + mr() * 5.0;
      hw   = 2.0 + mr() * 3.0;                // 半宽 2.0~5.0m
      hh   = 0.4 + mr() * 0.8;                // 半高 0.4~1.2m
    }
    base[i * 3 + 0] = pos.x;
    base[i * 3 + 1] = pos.y;
    base[i * 3 + 2] = pos.z;
    par[i * 4 + 0] = hw;
    par[i * 4 + 1] = hh;
    par[i * 4 + 2] = mr() * TAU;              // 相位：各吹各自的
    par[i * 4 + 3] = 0.20 + mr() * 0.22;      // 个体不透明度：片数砍了 1/3，单片再收一档（0.30~0.60 → 0.20~0.42）
  }
  geo.setAttribute('aBase',  new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aParam', new THREE.InstancedBufferAttribute(par, 4));

  const mat = new THREE.ShaderMaterial({
    uniforms: MIST,
    vertexShader: `
      attribute vec3 aBase;
      attribute vec4 aParam;
      uniform float uTime;
      uniform vec2  uWindVec;
      uniform float uNear;
      uniform float uNearEnd;
      varying vec2  vUv;
      varying float vAlpha;
      void main(){
        vUv = uv;
        float ph = aParam.z;
        vec3 c = aBase;
        vec2 w   = uWindVec;
        vec2 wvP = vec2(-w.y, w.x);
        c.xz += w   * (sin(uTime * 0.085 + ph * 1.7) * 2.1);
        c.xz += wvP * (sin(uTime * 0.061 + ph * 2.3) * 1.5);
        c.y  += sin(uTime * 0.050 + ph * 0.9) * 0.22;
        /* 球形 billboard：沿风向/垂直风向两个不同频率 → 小幅游走，不是直线往返 */
        vec3 toCam = cameraPosition - c;
        float dist = length(toCam);
        vec3 dir   = toCam / max(dist, 1e-4);
        vec3 cr    = cross(vec3(0.0, 1.0, 0.0), dir);
        float lr   = length(cr);
        /* lr→0 只在相机正上方：此时基向量退化，给个定值兜底（normalize 会出 NaN） */
        vec3 right = lr > 1e-4 ? cr / lr : vec3(1.0, 0.0, 0.0);
        vec3 upv   = normalize(cross(dir, right));
        vec3 pos = c + right * (position.x * aParam.x * 2.0)
                     + upv   * (position.y * aParam.y * 2.0);
        vAlpha = aParam.w * smoothstep(uNear, uNearEnd, dist);
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3  uColor;
      uniform float uOpacity;
      varying vec2  vUv;
      varying float vAlpha;
      void main(){
        float a = texture2D(uMap, vUv).a * vAlpha * uOpacity;
        if (a < 0.004) discard;
        /* 不写 tonemapping/colorspace —— 与水面 shader 同一约定：统一交给链尾 OutputPass */
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite:  false,      // 互相之间不遮挡、不写深度，否则排序穿帮
    depthTest:   true,       // 被建筑/山石正常遮挡，才有"绕在树后面"的层次
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,  // ⚠️ 水面反射的镜像相机里三角面会翻向背面
    fog: false,              // 它自己就是雾，别再被 scene.fog 吃一道
  });
  MIST.uMap.value = makeMistSpriteTex();

  const im = new THREE.InstancedMesh(geo, mat, N);
  const MI = new THREE.Matrix4();
  for (let i = 0; i < N; i++) im.setMatrixAt(i, MI);   // 单位矩阵：shader 不读 instanceMatrix，补上只为包围球/遍历不出现零矩阵
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;                            // 实例位置在 shader 里算，CPU 侧包围球是错的
  /* ⚠️ 必须关掉拾取：figure / stele 那几个"视线是否被挡"的门禁是靠 Raycaster 数的，
     云絮一旦参与射线，人物会凭空变成"被 2 处以上遮挡"而假红。 */
  im.raycast = () => {};
  im.castShadow = false; im.receiveShadow = false;
  im.renderOrder = 6;
  im.name = 'mistField';
  return im;
}

/* ══ 雾团 + 堂前香炉白烟 ⇒ 已移入 06b-atmos.js（2026-10-05 拆分，纯搬家、逐字未改）═══════════
   原 1995~2204 行整块搬走。两者都是"billboard 氛围片 + 私有随机流"，与植被建模无关，故独立成文件。
   ⚠️ 本文件仍要 `makeMistSpriteTex()`（雾絮场 MIST 也用同一张雾片贴图），故把它 export 出去；
   方向是单向的（06b → 本文件），不要在本文件 import 06b —— 那会成环。
   对外名（FOG_BANKS / makeFogBanks / CENSER_SMOKE / makeCenserSmoke）已改由 08-assemble 与
   11-loop 直接从 06b-atmos.js import，本文件不再转出。 */

/* 点到线段距离 —— 挖洞管道（胶囊）的基元 */
function segDist(px, py, pz, ax, ay, az, bx, by, bz){
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const dd = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = (apx * abx + apy * aby + apz * abz) / dd;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/* Surface Nets：每个"有符号变化"的体素放一个顶点（取 12 条棱交点的均值），
   再沿每条有符号变化的格棱把环绕它的 4 个体素顶点连成一个四边形。
   比 Marching Cubes 短得多（不需要 256 项三角表），顶点分布均匀、天然无裂缝。 */
function surfaceNets(min, max, cell, sdf){
  const nx = Math.max(1, Math.ceil((max.x - min.x) / cell));
  const ny = Math.max(1, Math.ceil((max.y - min.y) / cell));
  const nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;
  const field = new Float32Array(sx * sy * sz);
  for (let k = 0; k < sz; k++){
    const z = min.z + k * cell;
    for (let j = 0; j < sy; j++){
      const y = min.y + j * cell;
      for (let i = 0; i < sx; i++) field[(k * sy + j) * sx + i] = sdf(min.x + i * cell, y, z);
    }
  }
  const at = (i, j, k) => (k * sy + j) * sx + i;
  const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];
  const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const vIdx = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const vc = [0,0,0,0,0,0,0,0];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    let neg = 0;
    for (let c = 0; c < 8; c++){
      const val = field[at(i + CX[c], j + CY[c], k + CZ[c])];
      vc[c] = val; if (val < 0) neg++;
    }
    if (neg === 0 || neg === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (let e = 0; e < 12; e++){
      const a = EDGES[e][0], b = EDGES[e][1];
      if ((vc[a] < 0) === (vc[b] < 0)) continue;
      const t = vc[a] / (vc[a] - vc[b]);
      ax += CX[a] + (CX[b] - CX[a]) * t;
      ay += CY[a] + (CY[b] - CY[a]) * t;
      az += CZ[a] + (CZ[b] - CZ[a]) * t;
      n++;
    }
    vIdx[(k * ny + j) * nx + i] = pos.length / 3;
    pos.push(min.x + (i + ax / n) * cell, min.y + (j + ay / n) * cell, min.z + (k + az / n) * cell);
  }
  const idx = [];
  const V = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz)
                        ? -1 : vIdx[(k * ny + j) * nx + i];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else      idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++){
    const inside = field[at(i, j, k)] < 0;
    if (i < nx && j > 0 && k > 0 && inside !== (field[at(i + 1, j, k)] < 0))
      quad(V(i, j - 1, k - 1), V(i, j, k - 1), V(i, j, k), V(i, j - 1, k), inside);
    /* ⚠️ 这一族的顶点顺序必须与 X / Z 两族**相反**：绕 +y 轴看，(i-1,k-1)→(i,k-1)→(i,k)
       在手性上给出的是 -y 法线（而另两族分别给 +x / +z）。三族混着用，法线就会一半朝内
       一半朝外 —— 光照上表现为"编织袋"式花斑，不报错、不 NaN，只是石头看起来像破网。 */
    if (j < ny && i > 0 && k > 0 && inside !== (field[at(i, j + 1, k)] < 0))
      quad(V(i - 1, j, k), V(i, j, k), V(i, j, k - 1), V(i - 1, j, k - 1), inside);
    if (k < nz && i > 0 && j > 0 && inside !== (field[at(i, j, k + 1)] < 0))
      quad(V(i - 1, j - 1, k), V(i, j - 1, k), V(i, j, k), V(i - 1, j, k), inside);
  }
  return { field, pos, idx, min, cell, sx, sy, sz };
}

/* 立峰几何：SDF（基形 + 溶蚀噪声 + 竖向溶沟 + 管道挖洞）→ Surface Nets →
   顶点 AO（孔洞内壁自然变暗）+ 水线渍带 + 风化色斑，一次烘进顶点色。
   ⚠️ 顶点色不在几何合并的保留属性里（mergeStatics 只留 position/normal/uv），
   用它的网格必须 userData.noMerge，否则 AO 会在合并时被悄悄丢掉。 */
/* 形状预设：立峰（瘦、带"眼"）与峰群（敦厚、少洞）是同一台生成器的两套参数。
   ⚠️ 峰群用**粗网格**（cell 随高度放大）：7m 高的山石在 12~20m 外看，
   0.06m 的网格是浪费 —— 而启动时间是同步长任务（审计 P04），必须按观看距离配精度。 */
export function makeTaihuHeroGeo({ height = 3.4, baseR = 0.50, seed = 11, sink = 1.0,
                            holeCount = 5, cell = 0.06,
                            tunLen = null,
                            eyeRatio = 0.30,
                            main = [0.58, 0.28], sec = [0.34, 0.16], bump = [0.20, 0.11],
                            lean = [0.50, 0.90],
                            biteN = 3, biteR = [0.50, 0.90], biteD = [1.00, 1.50],
                            furrowMul = 1.0, fine = true, foot = [0.95, 0.28] } = {}){
  const s = seed * 3 + 1;
  const yTop = height, yBot = -sink;
  const rndH = mulberry32(seed * 977 + 5);          // 独立随机流
  /* ══ 形体 v2：一主二从 + 悬挑 + 一个"眼" ══
     用户评审 v1：「平平无奇、食之无味」—— 根因是**统计上均匀**，四条：
       ① N 根等权指柱 → 没有主次，远看是"一捆棍"；
       ② 洞小且均匀分布 → 没有记忆点，只像一块多孔石；
       ③ 各向同性噪声 → 表面没有方向，读不出"皱"；
       ④ 全身竖直、无悬挑 → 轮廓没有进退的张力。
     名石（冠云峰/玉玲珑那一类）恰好相反：一根主柱压倒性主导，上部向外悬挑，
     悬挑下方一个能穿视的大洞（"眼"），表面是沿竖向流动的深沟。
     v2 逐条对症，并把"眼"的轴定在**局部 +z**（≈ 池心方向）—— 从池心一侧看过去就是通透的。 */
  const smin = (a, b, k)=>{
    const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  };
  const smax = (a, b, k)=> -smin(-a, -b, k);              // 平滑减法：孔缘做圆角
  const sdCap = (x, y, z, A, B, r)=>{
    const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2];
    const apx = x - A[0], apy = y - A[1], apz = z - A[2];
    const dd = abx * abx + aby * aby + abz * abz || 1e-9;
    let tt = (apx * abx + apy * aby + apz * abz) / dd;
    tt = tt < 0 ? 0 : (tt > 1 ? 1 : tt);
    const qx = apx - abx * tt, qy = apy - aby * tt, qz = apz - abz * tt;
    return Math.sqrt(qx * qx + qy * qy + qz * qz) - r;
  };
  /* 圆台（上下不同半径的胶囊）：太湖石的"瘦"是**收分**出来的 ——
     等径圆柱无论多高都是一根柱子，下粗上细才有"立"的势。 */
  const sdCone = (x, y, z, A, B, r1, r2)=>{
    const bax = B[0] - A[0], bay = B[1] - A[1], baz = B[2] - A[2];
    const l2 = bax * bax + bay * bay + baz * baz || 1e-9;
    const rr = r1 - r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const pax = x - A[0], pay = y - A[1], paz = z - A[2];
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const xx0 = pax * l2 - bax * yy, xx1 = pay * l2 - bay * yy, xx2 = paz * l2 - baz * yy;
    const x2 = xx0 * xx0 + xx1 * xx1 + xx2 * xx2;
    const y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
  const lobes = [];
  const leanA = rndH() * TAU;                              // 悬挑方向
  const leanL = baseR * (lean[0] + (lean[1] - lean[0]) * rndH());   // 悬挑量（顶部外伸）
  const lx = Math.cos(leanA) * leanL, lz = Math.sin(leanA) * leanL;
  /* ① 主柱：最高、最粗，上部外挑 —— 轮廓的"势"全在这一根上 */
  lobes.push({
    A: [0, yBot + 0.12, 0],
    B: [lx, yTop * (0.88 + 0.12 * rndH()), lz],
    r1: baseR * (main[0] + 0.10 * rndH()),                 // 根部粗
    r2: baseR * (main[1] + 0.10 * rndH()),                 // 顶部细 → 收分
  });
  /* ② 次柱两根：45~72% 高，从主柱两侧分出去（与悬挑方向错开 ~120°/240°） */
  for (let i = 0; i < 2; i++){
    const a  = leanA + 2.1 + i * 2.1 + (rndH() - 0.5) * 0.7;
    const off = baseR * (0.44 + 0.24 * rndH());
    const x0 = Math.cos(a) * off, z0 = Math.sin(a) * off;
    lobes.push({
      A: [x0, yBot + 0.18, z0],
      B: [x0 + Math.cos(a) * baseR * 0.42, yTop * (0.45 + 0.27 * rndH()), z0 + Math.sin(a) * baseR * 0.42],
      r1: baseR * (sec[0] + 0.10 * rndH()),
      r2: baseR * (sec[1] + 0.07 * rndH()),
    });
  }
  /* ③ 小突起 3~4 根：25~48% 高，贴基部 —— 只做层次，不参与抢戏 */
  const nBump = 3 + ((rndH() * 2) | 0);
  for (let i = 0; i < nBump; i++){
    const a  = rndH() * TAU;
    const off = baseR * (0.34 + 0.42 * rndH());
    const x0 = Math.cos(a) * off, z0 = Math.sin(a) * off;
    lobes.push({
      A: [x0, yBot + 0.12, z0],
      B: [x0 + Math.cos(a) * baseR * 0.34, yTop * (0.22 + 0.26 * rndH()), z0 + Math.sin(a) * baseR * 0.34],
      r1: baseR * (bump[0] + 0.09 * rndH()),
      r2: baseR * (bump[1] + 0.05 * rndH()),
    });
  }
  const footR = baseR * (foot[0] + foot[1] * rndH());      // 雨脚
  /* 侧向咬缺（concave bites）：太湖石轮廓的"进"全靠它 ——
     在离轴 1.0~1.5×baseR 处挖掉半径 0.5~0.9×baseR 的球，
     石体的边缘就被啃出月牙形的缺口；缺口之间的残留就是"峰"。
     这是纯挖洞（管道）做不出来的：管道给的是孔，球缺给的是**轮廓本身**。 */
  const bites = [];
  const nBite = biteN + ((rndH() * 2) | 0);
  for (let i = 0; i < nBite; i++){
    const a = (i / nBite) * TAU + rndH() * 1.2;
    const ty = 0.30 + 0.55 * rndH();
    const rr0 = baseR * (biteR[0] + (biteR[1] - biteR[0]) * rndH());
    const dist0 = baseR * (biteD[0] + (biteD[1] - biteD[0]) * rndH());
    bites.push({
      c: [Math.cos(a) * dist0, yBot + (yTop - yBot) * ty, Math.sin(a) * dist0],
      r: rr0,
    });
  }
  /* ── 洞 ──
     ⚠️ 「眼」必须开在**体量足够**的高度：主柱半径 ~0.5×baseR，洞半径超过它就会把石体
     拦腰截断（v1 实测连通分量 2 → 掉下一块浮空石）。所以 baseR 提到 0.70，
     洞半径取 0.28~0.34×baseR（直径 0.4~0.48m），孔缘留 8~20cm 的薄壁 —— 薄壁正是"透"的卖相。 */
  const tunnels = [];
  if (eyeRatio > 0.001){
    const t0 = 0.54 + 0.12 * rndH();
    const cy = yBot + (yTop - yBot) * t0;
    const tilt = -0.16 + 0.32 * rndH();
    const dl = Math.hypot(1, tilt);
    const dx = 0, dy = tilt / dl, dz = 1 / dl;             // 轴 = 局部 +z
    const L = tunLen ?? (baseR * 3.6 + 1.0);
    const rEye = baseR * (eyeRatio + 0.06 * rndH());
    tunnels.push({
      r: rEye, cy: cy, span: L + rEye,
      pts: [[lx * 0.5, cy - dy * L, lz * 0.5 - dz * L],
            [lx * 0.6, cy, lz * 0.6],
            [lx * 0.7, cy + dy * L, lz * 0.7 + dz * L]],
    });
  }
  /* 其余中小洞：错落分布，负责"漏"的质感 */
  for (let i = 0; i < holeCount; i++){
    const t0  = 0.26 + 0.62 * rndH();
    const a0  = rndH() * TAU;
    const rad = baseR * (0.17 + 0.10 * rndH());
    const cy  = yBot + (yTop - yBot) * t0;
    const ux = Math.cos(a0), uz = Math.sin(a0);
    const sgn = rndH() < 0.5 ? -1 : 1;
    const vx = -uz * sgn, vz = ux * sgn;
    const mixT = 0.30 + 0.50 * rndH();
    const tilt = -0.45 + 0.90 * rndH();
    let dx = ux * (1 - mixT) + vx * mixT, dz = uz * (1 - mixT) + vz * mixT;
    const dl = Math.hypot(dx, tilt, dz);
    dx /= dl; const dy = tilt / dl; dz /= dl;
    const L = tunLen ?? (baseR * 3.6 + 0.9);
    const mx = ux * baseR * 0.30, mz = uz * baseR * 0.30;
    tunnels.push({
      r: rad, cy: cy, span: L * 0.7 + rad + 0.3,
      pts: [
        [mx - dx * L, cy - dy * L, mz - dz * L],
        [mx + dx * L * 0.1 + vx * baseR * 0.30, cy + dy * L * 0.1, mz + dz * L * 0.1 + vz * baseR * 0.30],
        [mx + dx * L, cy + dy * L, mz + dz * L],
      ],
    });
  }
  function sdf(x, y, z){
    let d = 1e9;
    for (let i = 0; i < lobes.length; i++){
      const L = lobes[i];
      d = smin(d, sdCone(x, y, z, L.A, L.B, L.r1, L.r2), 0.10);
    }
    /* 雨脚底座 */
    const shrink = 1 - 0.30 * Math.min(1, (y - yBot) / (footR * 1.3));
    const bd = Math.max(Math.hypot(x, z) - footR * shrink,
                        yBot - y,
                        y - (yBot + footR * 1.05));
    d = smin(d, bd, 0.25);
    /* 侧向咬缺：球缺只做加法式"让步"（max），不做 smin —— 缺口的边缘要利落 */
    for (let i = 0; i < bites.length; i++){
      const B0 = bites[i];
      const ddx = x - B0.c[0], ddy = y - B0.c[1], ddz = z - B0.c[2];
      const carveB = B0.r - Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      d = smax(d, carveB, 0.045);
    }
    /* ── 表面 v2：方向性皴纹（竖向流线），取代各向同性噪声 ──
       噪声是"砂纸"，读不出方向；太湖石的"皱"是雨水沿石面走出来的**竖沟**：
       沟的相位随高度缓慢扭动（所以沟是弯的、不是直线），再加两条不同频率的次级沟。 */
    const ang = Math.atan2(z, x);
    const tp = Math.max(0, Math.min(1, (y - yBot) / (yTop - yBot)));
    const warp1 = Math.sin(y * 0.85 + s * 0.7) * 1.6;       // 低位扭动
    const warp2 = Math.sin(y * 1.9 + s * 1.3) * 0.8;
    const g1 = Math.sin(ang * 6.5 + warp1 + s * 0.4);       // 主沟（6~7 条）
    const g2 = Math.sin(ang * 13.0 + warp2 - s * 0.9);      // 次级沟
    d -= furrowMul * (0.100 + 0.070 * tp) * Math.pow(Math.max(0, g1), 1.3) * (0.55 + 0.45 * tp);
    d -= furrowMul * 0.030 * g2 * (0.4 + 0.6 * tp);
    /* 风化：低频起伏 + 细麻点（细麻点只在细网格档做 —— 粗网格下它低于采样精度，纯浪费） */
    d -= 0.045 * (fbm3(x * 1.15, y * 0.80, z * 1.15, s, 2) - 0.5);
    if (fine) d -= 0.020 * (fbm3(x * 4.2, y * 3.2, z * 4.2, s + 41, 2) - 0.5);
    /* 底封口 */
    if (yBot - y > d) d = yBot - y;
    /* 挖洞 */
    for (let i = 0; i < tunnels.length; i++){
      const T = tunnels[i];
      if (Math.abs(y - T.cy) > T.span) continue;
      let dd = 1e9;
      for (let j = 0; j < T.pts.length - 1; j++){
        const a = T.pts[j], b = T.pts[j + 1];
        const q = segDist(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2]);
        if (q < dd) dd = q;
      }
      /* ⚠️ 用**平滑**减法而不是 max：max 切出来的孔缘是一刀切的薄片，
         逆光看像"纸片"，还有 razor-thin 的飞边。smax 把孔缘磨圆（k≈3.5cm），
         顺带加厚薄壁 —— 这正是溶蚀该有的样子。 */
      d = smax(d, T.r - dd, 0.035);
    }
    return d;
  }
  /* ⚠️ 包围盒是**立方**的，给大一倍就是 8 倍采样量。实测石体外缘约 1.65×baseR
     （探针量过：baseR 0.70 → 半宽 1.16m），所以取 1.9 留 15% 余量即可。
     原来写 2.85 = 多花 3.4 倍时间，等于凭空把启动拖慢几百毫秒。 */
  const R = baseR * 1.9;
  const minV = new THREE.Vector3(-R, yBot - 0.1, -R);
  const maxV = new THREE.Vector3(R, yTop + 0.05, R);
  const nets = surfaceNets(minV, maxV, cell, sdf);
  const { field, pos, idx, sx, sy, sz } = nets;
  const sample = (px, py, pz) => {
    const fx = (px - minV.x) / cell, fy = (py - minV.y) / cell, fz = (pz - minV.z) / cell;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= sx - 1 || fy >= sy - 1 || fz >= sz - 1) return 1;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    const u = fx - i, v = fy - j, w = fz - k;
    const a = (ii, jj, kk) => field[(kk * sy + jj) * sx + ii];
    const x00 = a(i,j,k) + (a(i+1,j,k) - a(i,j,k)) * u;
    const x10 = a(i,j+1,k) + (a(i+1,j+1,k) - a(i,j+1,k)) * u;
    const x01 = a(i,j,k+1) + (a(i+1,j,k+1) - a(i,j,k+1)) * u;
    const x11 = a(i,j+1,k+1) + (a(i+1,j+1,k+1) - a(i,j+1,k+1)) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  };
  const DIRS = [];
  const RAW = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
               [1,1,1],[-1,1,1],[1,1,-1],[-1,1,-1]];
  for (const d of RAW){
    const L = Math.hypot(d[0], d[1], d[2]);
    DIRS.push([d[0] / L, d[1] / L, d[2] / L]);
  }
  const AOST = 6, AOD = 0.42;
  const col = [], uv = [];
  /* P2-1 第二遍缓存：mossGate / cavity，与顶点一一对应（pos 同循环 push）。 */
  const mossCache = [], cavityCache = [];
  for (let i = 0; i < pos.length; i += 3){
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    let occ = 0;
    for (let k = 0; k < DIRS.length; k++){
      const d = DIRS[k];
      for (let st = 1; st <= AOST; st++){
        const dd = AOD * st / AOST;
        if (sample(x + d[0] * dd, y + d[1] * dd, z + d[2] * dd) < 0){
          occ += 1 - (st - 1) / AOST;
          break;
        }
      }
    }
    let ao = 1 - (occ / DIRS.length) * 0.80;
    if (ao < 0.34) ao = 0.34;
    /* P2-1 名石进阶 —— 在既有腔体 AO 之上加三层，同属顶点色烘焙、零运行时开销。
       量级设计见下方三处行内注释。朝向相关（苔痕北侧、SSS 法线外探）放到
       computeVertexNormals 之后做第二遍（法线在那之前不存在）。 */
    /* 水线分层（原单条 stain 拆成三道印）：
       浸水暗带 y<0.02（常年没水，压 0.45，钳 0.5）+
       潮汐渍线 0.06/0.10m 两条细线（高斯窄峰 σ=0.018，各压 0.18）+
       溅水淡带 0.12~0.30m（指数衰减，压 0.08）。y>0.30 全归零。 */
    let stain = 0;
    if (y < 0.30){
      if (y < 0.02) stain = 0.45;
      else {
        const g06 = Math.exp(-((y - 0.06) * (y - 0.06)) / (2 * 0.018 * 0.018));
        const g10 = Math.exp(-((y - 0.10) * (y - 0.10)) / (2 * 0.018 * 0.018));
        stain = 0.18 * g06 + 0.18 * g10 + 0.08 * Math.exp(-(y - 0.12) / 0.09);
      }
    }
    /* 深腔底再压暗：occ 高（≥6/10 方向被挡）说明是孔洞深处，与孔缘透光拉开景深。
       occ 是 0~10 的遮挡加权和，先记 cavity（第二遍与透光缘一起用）。 */
    const cavity = occ / DIRS.length;              // 0~1，越大越深
    const cavityDark = cavity >= 0.6 ? 0.12 * Math.min(1, (cavity - 0.6) / 0.4) : 0;
    /* 苔痕噪声预采样（朝向在第二遍判，这里只记噪声门）：高频 fbm 咬边，
       0.45 阈硬切 + 0.12 羽化，苔斑边缘参差。 */
    const mossN = fbm3(x * 3.1 + 7, y * 3.1, z * 3.1, seed + 77, 2);
    const mossGate = Math.min(1, Math.max(0, (mossN - 0.45) / 0.12));
    /* 风化色斑：低频噪声在暖灰与冷灰之间游走 */
    const mot = fbm3(x * 0.75 + 21, y * 0.5, z * 0.75, seed + 5, 2);
    let shade = (0.62 + 0.38 * ao) * (1 - Math.min(0.55, stain));
    shade *= (1 - cavityDark);             // 深腔底再压暗 ≤0.12（与孔缘透光拉景深）
    const warm = 0.93 + 0.14 * mot;
    col.push(shade * warm, shade * (0.985 - 0.03 * mot), shade * (0.95 - 0.07 * mot));
    uv.push(Math.atan2(z, x) / TAU + 0.5, y * 0.16);
    /* 第二遍用的逐顶点缓存：mossGate（噪声门）/ cavity（深腔度）。与 pos 同序。
       ⚠️ 顶心漏 push 教训：这里与 pos 同循环 push，一一对应；分配不在此处。 */
    mossCache.push(mossGate);
    cavityCache.push(cavity);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  /* ── 朝向校验：面法线必须与 SDF 梯度同向（梯度朝外）──
     这比"用有符号体积判一次"更直接：体积只告诉你整体反没反，梯度一致率还能暴露
     "三族绕序不一致"这种局部错误（一致率会掉到 0.5~0.8 而不是 0 或 1）。
     抽样每 3 个三角形算一次，代价可控。 */
  const g3 = [0, 0, 0];
  const gradAt = (x, y, z)=>{
    const h = cell * 0.6;
    g3[0] = sdf(x + h, y, z) - sdf(x - h, y, z);
    g3[1] = sdf(x, y + h, z) - sdf(x, y - h, z);
    g3[2] = sdf(x, y, z + h) - sdf(x, y, z - h);
  };
  const agreeRate = (sign)=>{
    let ok = 0, tot = 0;
    for (let i = 0; i < idx.length; i += 9){
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      gradAt((pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3,
             (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3);
      if ((nx * g3[0] + ny * g3[1] + nz * g3[2]) * sign > 0) ok++;
      tot++;
    }
    return tot ? ok / tot : 0;
  };
  let sign = 1, rate = agreeRate(1);
  if (rate < 0.5){
    const r2 = agreeRate(-1);
    if (r2 > rate){ sign = -1; rate = r2; }
  }
  if (sign < 0) for (let i = 0; i < idx.length; i += 3){ const tp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tp; }
  g.computeVertexNormals();
  /* P2-1 第二遍：苔痕（北侧+低位）与孔缘假 SSS（透光薄边）。
     必须在 computeVertexNormals 之后（法线之前不存在）+ 碎片剔除之前
     （剔除会重映射顶点，缓存数组 mossCache/cavityCache 与 pos 同序，剔除时同步搬）。
     ① 苔痕：法线北向点积 >0.25（北为 -z，按 sunPos 东西轴推定）才长；
        高度门：y<1.2 全量、1.2~2.2m 线性淡出、>2.2m 不长（苔亲水）；
        强度 ≤0.28，颜色往冷绿 (0.72,0.82,0.60) 拉：c = mix(c, mossTint*k, moss)。
        mossTint 取"苔色 × 当前明度"：直接 mix 会把 AO 压平，所以按苔量只换色相、
        明度乘回原 shade 比（mossLum 保亮）。
     ② 孔缘假 SSS：薄壁透光。沿法线外 0.06m 采样仍在石内（sample<0）→ 对面有石，
        说明此处是薄壁/孔缘而非实心深腔；且 cavity 中等（0.25~0.6，浅腔缘）才提亮：
        往暖透 (1.06,0.94,0.80) 提 ≤0.10。深腔（cavity>0.6）已在第一遍压暗，不提。
        薄壁判据用 SDF 采样（精确）而非法线夹角（噪声大）。 */
  {
    const nrm = g.attributes.normal;
    const MOSS_TINT = [0.72, 0.82, 0.60];
    const SSS_WARM = [1.06, 0.94, 0.80];
    let mossN = 0, sssN = 0;
    for (let vi = 0; vi < nrm.count; vi++){
      const nx = nrm.getX(vi), ny = nrm.getY(vi), nz = nrm.getZ(vi);
      const px = pos[vi * 3], py = pos[vi * 3 + 1], pz = pos[vi * 3 + 2];
      /* — 苔痕 — */
      const north = -nz;                       // 北 = -z
      let moss = 0;
      if (north > 0.25 && py < 2.2 && mossCache[vi] > 0){
        const hGate = py < 1.2 ? 1 : (2.2 - py) / 1.0;
        moss = 0.28 * Math.min(1, (north - 0.25) / 0.45) * hGate * mossCache[vi];
        if (moss > 0.003){
          const lum0 = 0.299 * col[vi * 3] + 0.587 * col[vi * 3 + 1] + 0.114 * col[vi * 3 + 2];
          const lumT = 0.299 * MOSS_TINT[0] + 0.587 * MOSS_TINT[1] + 0.114 * MOSS_TINT[2];
          const k = lum0 / Math.max(1e-4, lumT);
          col[vi * 3]     += (MOSS_TINT[0] * k - col[vi * 3]) * moss;
          col[vi * 3 + 1] += (MOSS_TINT[1] * k - col[vi * 3 + 1]) * moss;
          col[vi * 3 + 2] += (MOSS_TINT[2] * k - col[vi * 3 + 2]) * moss;
          mossN++;
        }
      }
      /* — 孔缘假 SSS — */
      const cav = cavityCache[vi];
      if (cav > 0.25 && cav < 0.6){
        const ox = px + nx * 0.06, oy = py + ny * 0.06, oz = pz + nz * 0.06;
        if (sample(ox, oy, oz) < 0){           // 对面 6cm 内仍是石头 → 薄壁
          const sss = 0.10 * Math.min(1, (cav - 0.25) / 0.2) * (1 - (cav - 0.25) / 0.35 * 0.5);
          col[vi * 3]     = Math.min(1.2, col[vi * 3] * (1 + (SSS_WARM[0] - 1) * sss * 3));
          col[vi * 3 + 1] = Math.min(1.2, col[vi * 3 + 1] * (1 + (SSS_WARM[1] - 1) * sss * 3));
          col[vi * 3 + 2] = Math.min(1.2, col[vi * 3 + 2] * (1 + (SSS_WARM[2] - 1) * sss * 3));
          sssN++;
        }
      }
    }
    g.userData.mossVerts = mossN;
    g.userData.sssVerts = sssN;
    /* ⚠️ setAttribute 时 Float32BufferAttribute 把 col 拷贝进了新的 Float32Array，
       第二遍改的是 JS 侧 col 数组，必须写回 GPU 属性，否则画面无变化。 */
    g.attributes.color.array.set(col);
    g.attributes.color.needsUpdate = true;
  }
  /* 连通性校验：细指柱被洞切断会掉下"浮空碎块"，在画面里极显眼。
     并查集统计连通分量 —— 正常应当是 1。 */
  const par = new Int32Array(pos.length / 3);
  for (let i = 0; i < par.length; i++) par[i] = i;
  const find = (a)=>{ while (par[a] !== a){ par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let i = 0; i < idx.length; i += 3){
    for (let e = 0; e < 3; e++){
      const ra = find(idx[i + e]), rb = find(idx[i + (e + 1) % 3]);
      if (ra !== rb) par[ra] = rb;
    }
  }
  /* 只保留最大连通体，丢掉碎片 ——
     比"调参躲开断裂"稳得多：咬缺/挖洞的参数一变，碎块就可能出现，
     任何参数组合下都该给出"一块完整的石"。丢弃量写进 userData 供探针核对。 */
  const triRoot = new Int32Array(idx.length / 3);
  const counts = new Map();
  for (let t = 0; t < triRoot.length; t++){
    const r0 = find(idx[t * 3]);
    triRoot[t] = r0;
    counts.set(r0, (counts.get(r0) || 0) + 1);
  }
  let best = -1, bestN = -1;
  for (const [r0, n] of counts) if (n > bestN){ bestN = n; best = r0; }
  let dropped = 0;
  const kept = [];
  for (let t = 0; t < triRoot.length; t++){
    if (triRoot[t] === best) kept.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
    else dropped++;
  }
  if (dropped > 0){
    console.log('[立峰] 丢掉 ' + dropped + ' 个碎片三角形（' + (counts.size - 1) + ' 块），保留最大连通体');
    /* 顶点重映射：碎片留下的孤立顶点不进 GPU 缓冲（否则包围盒/法线都会被它们带偏） */
    const remap = new Int32Array(pos.length / 3).fill(-1);
    const nPos = [], nCol = [], nUv = [];
    for (let i = 0; i < kept.length; i++){
      const v = kept[i];
      if (remap[v] < 0){
        remap[v] = nPos.length / 3;
        nPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        nCol.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
        nUv.push(uv[v * 2], uv[v * 2 + 1]);
      }
      kept[i] = remap[v];
    }
    pos.length = 0; for (let i = 0; i < nPos.length; i++) pos.push(nPos[i]);
    col.length = 0; for (let i = 0; i < nCol.length; i++) col.push(nCol[i]);
    uv.length = 0;  for (let i = 0; i < nUv.length; i++)  uv.push(nUv[i]);
    idx.length = 0; for (let i = 0; i < kept.length; i++) idx.push(kept[i]);
    /* ⚠️ 碎片剔除重建的是 JS 侧数组，GPU 属性必须同步重建（position/color/uv/index
       全部），否则画面仍是剔除前的旧缓冲。normal 更要重算（顶点已变）。
       ⚠️⚠️ computeVertexNormals 对**已存在**的 normal 是"就地清零重写"，
       不会缩小数组 —— 顶点变少时 normal.count 会停在旧值（实测 taihuCompanion
       normal 1753≠1727，触发几何校验告警）。所以必须先 deleteAttribute 再重算，
       才会按新顶点数分配。 */
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.deleteAttribute('normal');
    g.computeVertexNormals();
  }
  g.userData.islands = 1;
  g.userData.droppedTris = dropped;
  g.userData.tris = idx.length / 3;
  g.userData.normalAgree = +rate.toFixed(3);
  if (rate < 0.9) console.warn('[立峰] 面法线与 SDF 梯度一致率偏低：' + rate.toFixed(3) + '（三族绕序可能不一致）');
  return g;
}

/* 柳帘飘带几何：竖条带 12 tri（1×6 段），顶边对齐挂点（y=0 向下垂），
   带微 S 弯与端部外飘 —— 叶帘不是刚性平面，风场注入后逐顶点摆动才自然 */
function makeWillowCurtainGeo(){
  const g = new THREE.PlaneGeometry(0.34, 1, 1, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++){
    const t = 0.5 - pos.getY(i);                          // 0=顶(挂点) → 1=底(梢)
    pos.setZ(i, Math.sin(t * 2.4) * 0.04 + t * t * 0.06);
  }
  g.translate(0, -0.5, 0);                                // 顶边落在挂点，缩放 y 即条长
  g.computeVertexNormals();
  return g;
}

/* 垂柳（2026-09-15 重塑）：骨架不变，"细管柳条 + 沿条单片叶"换成**垂帘叶幕** ——
   每根飘带 = alpha 叶纹贴图（细茎 + 互生窄柳叶，一张图自带生长结构）× 12 tri 条带。
   挂点不再均匀撒点：沿主枝/冠枝**下侧取簇心**，簇内高斯散布 ——
   真实垂柳的帘是"一簇簇从拱枝垂下来"，不是从伞面均匀挂线（旧版被用户判为拖把头的根源：
   条稀、叶孤、无内外体积）。instanceColor 内暗外亮，树冠才有层次。
   MAT.willow 现只登记不再挂几何（骨架全走 MAT.bark），保留给未来裸枝表现用。 */
export function makeWillow(x, z, scale = 1){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);

  const H = 5.4 * rr(0.82, 1.18);          // 每棵树高不同
  // 树干
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(rr(-0.25,0.25), H*0.34, rr(-0.25,0.25)),
    new THREE.Vector3(rr(-0.4,0.4),  H*0.66, rr(-0.35,0.35)),
    /* ⚠️ **主干顶 0.94H → 1.15H**（2026-10-01，与"冬季悬空枝"同一处修复）。
       冠肋的 y0 范围是 H×[0.85, 1.13]，**70% 的肋原本高过旧主干顶 0.94H**
       ⇒ 那些肋的根悬在树顶上方 0~1.2m 的空气里（老黄实拍："柳树顶部树枝
       有大量和主干不相连的情况，也变成悬空的状态"）。
       只把肋根夹到主干顶也能"接上"，但 22 根肋会同时挤在**同一个点**上放射 ——
       这正是第八轮验收明确否掉过的"从干顶一点放射读作灯柱/八爪鱼"。
       所以正解是把主干**往上延长**到盖住全部肋根（1.15H > 1.13H）：
       每根肋各自落在**自己那个高度**的主干上，沿主干 0.85H~1.13H 一段散开长出来；
       而肋的 1..6 号点一个字没动 ⇒ 冠形/垂梢节奏完全不变，只换了"根扎在哪"。
       ⚠️ 只改 y 系数、rr 的次数与顺序不变 ⇒ 全局随机流一位不漂（铁律 1）。 */
    new THREE.Vector3(rr(-0.3,0.3),  H*1.15, rr(-0.25,0.25)),
  ]);
  g.add(mesh(new THREE.TubeGeometry(trunkCurve, 18, 0.185 * rr(0.9, 1.15), 8, false), MAT.willowBark, { name:'willowTrunk' }));
  /* ── 主干在**给定高度**的真实中心点（2026-10-01 冬季缺陷根因修复）──
     主干是一条会左右摆动的 CatmullRom 曲线（控制点横向偏 ±0.25~0.4m），而下面的
     **主枝起点原来写死在"竖直轴"上**（`rr(-0.2,0.2), y0, rr(-0.2,0.2)`）——
     两者最多差 **0.4m**，而枝半径只有 0.042m ⇒ 顶部枝的根**根本没插进主干**，
     与主干之间空着一大截。冠肋更离谱：起点在半径 `0.18*reach ≈ 0.37m` 处
     （主干半径才 0.185m），且 y0 上限 1.13H **超过了主干顶 0.94H** ⇒ 一半的肋
     **悬在树顶上方的空气里**。
     老黄 2026-10-01 实拍："柳树顶部树枝有大量和主干不相连的情况，也变成悬空的状态"。
     为什么**只有冬天报**：夏/秋叶幕把枝根盖住了，冬季 `willowLeaf: 0` 裸枝才露馅。
     这个函数按 y 找曲线上最近的采样点（无随机消耗，铁律 1 安全）。
     ⚠️ 采样要**按 y 就近**而不是按 t 反解 —— 曲线是 CatmullRom、分段不等距，
        用 t 反解会把根插到半空中。 */
  const trunkAt = (() => {
    const S = [];
    for (let i = 0; i <= 64; i++) S.push(trunkCurve.getPoint(i / 64));
    const TOP = S[S.length - 1].y;
    return (y) => {
      const yl = Math.min(Math.max(y, 0), TOP);
      let best = S[0], bd = Infinity;
      for (const p of S){ const d = Math.abs(p.y - yl); if (d < bd){ bd = d; best = p; } }
      return best;
    };
  })();
  /* ── 根盘（2026-09-23 重塑 · 老黄："桃/柳露根几乎一模一样，而且真实中没有这种
     类似花瓣一样的根系"）──
     旧版：5 块低模球**均匀绕一圈**（72° 间隔）→ 与桃树的 6 块同配方，读作"一圈蒜瓣"。
     真实垂柳最标志性的恰是**临水盘根**：沿向水一侧伸出粗壮的板根/条带根，向外蜿蜒
     爬行、半露土面后再入土，**强烈不对称**（背水侧只有零星细根）。
     ⚠️ 原版在此消耗 15 次全局 rr（5 圈 × 3）。改用本地流后必须**等量燃烧**，
        否则其后所有 rr 抽样（主枝 / 冠肋 / 叶幕）整体位移 —— §36.6。
     本地流种子由坐标决定 ⇒ 同一棵树的根盘每次构建逐位一致（§34）。 */
  const WR = mulberry32(((Math.round(x * 1000) * 73856093)
                       ^ (Math.round(z * 1000) * 19349663)
                       ^ (Math.round(scale * 1000) * 83492791)) | 0);
  const wrr = (a, b) => a + WR() * (b - a);
  for (let i = 0; i < 15; i++) void rr(0, 1);          // 等量燃烧（原 5 圈 × 3 次）
  {
    const toWater = Math.atan2(3 - z, -x);             // 池心在世界 (0,·,3)
    for (let i = 0; i < 4; i++){
      const back = (i === 3);                          // 第 4 条放背水侧 —— "不对称"要看得见
      const a   = (back ? toWater + Math.PI : toWater) + (back ? wrr(-0.35, 0.35) : wrr(-1.05, 1.05));
      /* ⚠️ 尺度与埋深（第一版实测返工）：r0 0.058~0.098 让根几乎与树干等粗、len 1.75m 拖成
         "三根扁担"，而且整根**悬在地面上** —— 真实露根是"从土里拱出来的脊"，只有背脊出土。
         收细收短 + 中心线压到土面上下（0.055 → −0.06），末端渐细没入土中。 */
      const len = back ? wrr(0.30, 0.50) : wrr(0.50, 0.95);
      const r0  = back ? wrr(0.026, 0.036) : wrr(0.038, 0.058);
      const wob = wrr(-0.55, 0.55);                    // 沿长度渐变的方位偏摆 ⇒ 蜿蜒而非直棍
      const pts = [];
      for (let k = 0; k <= 3; k++){
        const t = k / 3, aa = a + wob * t * t, rad = 0.17 + (len - 0.17) * t;
        pts.push(new THREE.Vector3(Math.cos(aa) * rad, 0.055 - 0.115 * t, Math.sin(aa) * rad));
      }
      const rc = new THREE.CatmullRomCurve3(pts);
      const rt = mesh(tubeRadiusRamp(new THREE.TubeGeometry(rc, 12, 1, 8, false), rc, 12, 8,
                                     t => r0 * (1 - 0.62 * t)), MAT.willowBark, { name:'willowRoot', cast:true });
      rt.scale.set(1, 0.66, 1);                        // 压扁＝板根；同时把中心线进一步压向土面（只露背脊）
      g.add(rt);
    }
  }

  /* 拱形主枝：**低位多级分叉**（验收一轮发现从干顶一点放射读作"灯柱/八爪鱼"）——
     3~4 根自干中低位（0.42~0.62H）斜出的大枝 + 4~6 根高位枝（0.72~0.92H）。
     真实垂柳正是低位分叉、宽大于高的拱冠。半径 0.042 支撑叶幕视觉重量。 */
  const brCurves = [];
  const nBranch = 7 + ((rnd()*4)|0);       // 7~10 根
  for (let i = 0; i < nBranch; i++){
    const a = (i/nBranch)*TAU + rr(-0.35,0.35);
    const reach = i < 4 ? rr(1.9, 3.0) : rr(1.2, 2.4);   // 低位枝更长更外张
    const y0 = H * (i < 4 ? rr(0.42, 0.62) : rr(0.72, 0.92));
    const tipY = H * rr(0.50, 0.70);
    const brCurve = new THREE.CatmullRomCurve3([
      /* ⚠️ **起点必须落在主干的真实轴上**（2026-10-01 冬季缺陷）：
         原来是 `rr(-0.2,0.2), y0, rr(-0.2,0.2)` —— 写死在**竖直轴**上，
         而主干是左右摆动的曲线（横向偏 ±0.25~0.4m）⇒ 顶部枝的根悬在主干旁边
         （老黄："柳树顶部树枝有大量和主干不相连的情况"）。
         现在取 trunkAt(y0)（主干在 y0 高度的真实中心），再叠 **±0.06m** 的抖动
         （原是 ±0.2m，太大了会自己甩出主干外）。⚠️ rr 的**次数与顺序必须不变** ——
         仍在这里抽 2 次，只是范围改小（铁律 1 只看次数与顺序，不看参数值）。 */
      (() => {
        const tb = trunkAt(y0);
        return new THREE.Vector3(tb.x + rr(-0.06,0.06), tb.y, tb.z + rr(-0.06,0.06));
      })(),
      new THREE.Vector3(Math.cos(a)*reach*0.45, y0 + H*rr(0.10, 0.22), Math.sin(a)*reach*0.45),
      new THREE.Vector3(Math.cos(a)*reach*0.8, tipY + H*rr(0.04, 0.10), Math.sin(a)*reach*0.8),
      new THREE.Vector3(Math.cos(a)*reach, tipY, Math.sin(a)*reach),
    ]);
    brCurves.push(brCurve);
    g.add(mesh(new THREE.TubeGeometry(brCurve, 12, 0.042 * rr(0.85, 1.15), 6, false), MAT.willowBark, { name:'willowBranch' }));
  }

  // 冠层肋枝（第八轮验收指令③：破半球加强）—— 第七轮 ±15%/±10° 在 4m 观察距离下
  // 起伏不可辨（验收实测）。第八轮：肋长独立 ×0.8~1.25、终端方位 ±20°、
  // 肋根俯角用 droop 指数 1.2~1.9 区分"早垂/晚垂"—— 圆度偏差必须肉眼可辨。
  const crownRibs = [];
  const nRib = 30;
  for (let i = 0; i < nRib; i++){
    const a = (i / nRib) * TAU + rr(-0.24, 0.24);
    const reach = 2.05 * rr(0.80, 1.12);                // 肋长截短（第十轮：端部超出叶缘 ≤0.05R）
    const droop = rr(0.30, 0.62);                       // 最低 0.30H：裸梢收回叶幕内（第九轮俯视"带刺半球"）
    const droopPow = rr(1.1, 1.7);                      // 肋根俯角：指数小=早垂，大=晚垂
    const y0 = H * rr(0.85, 1.13);                      // 拱顶高度 ±15%
    const tipBend = rr(-0.35, 0.35);                    // 终端方位 ±20°
    const wob = rr(-0.18, 0.18);                         // 中段径向摆动
    const pts = [];
    for (let k = 0; k <= 6; k++){
      const t = k / 6;
      const r = reach * (0.18 + 0.82 * Math.sin(t * Math.PI * 0.5)) * (1 + wob * t);
      const y = y0 - H * droop * Math.pow(t, droopPow);
      const aa = a + tipBend * t * t;
      /* ⚠️ **第 0 点原先落在半径 0.18*reach ≈ 0.37m 处，而主干半径只有 0.185m**
         —— 根本没碰到主干，30 根肋有近一半 y0 还超过主干顶 0.94H ⇒ 全部悬空
         （老黄："柳树顶部树枝有大量和主干不相连的情况，也变成悬空的状态"）。
         第 0 点改成**主干在该高度的真实中心点** ⇒ 肋从主干里长出来；
         y0 超过主干顶时 trunkAt 会夹到 0.94H ⇒ 肋从**树顶**长出来，不会悬在树上方。
         ⚠️ 只改第 0 点，1..6 点原样保留 ⇒ 冠形（那几轮调出来的垂梢节奏）不变。 */
      const p0 = k === 0 ? (() => { const c = trunkAt(y0); return new THREE.Vector3(c.x, c.y, c.z); })()
                         : new THREE.Vector3(Math.cos(aa) * r, y, Math.sin(aa) * r);
      pts.push(p0);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    crownRibs.push(curve);
    g.add(mesh(new THREE.TubeGeometry(curve, 12, 0.019, 5, false), MAT.willowBark, { name:'willowCrownRib', cast:false }));
  }

    // ── 叶幕五件套：短枝雾 + 冠顶沿弧封盖 + 长垂帘簇 + 网格补洞 + 散兵帘 ──
    /* 第三轮取证量化：覆盖 50%、冠顶 1/3 仍 <20% 且"伞骨无伞面"、右半冠 20-30% 稀疏。
       第四轮按验收优先级：①冠顶沿**弧线全长**挂长帘（挂点骑在弧上、垂长 ≥ 冠高/3，
       把骨架盖进叶幕——上轮裙帘挂在弧心下方被骨架自身挡住，投影不可见）
       ②0.45m 网格扫冠包络补空格（消"左密右疏"方向性破洞）③内外色差拉到 ~30% 明度差。 */
    const curtains = [];
    const gauss = () => (jr() + jr() + jr()) / 1.5 - 1;   // 中央聚集
    /* 帘长全局参差 ×0.85~1.15（叠加轮廓 ±40% —— 第八轮验收指令⑤：消除"梳齿的整齐感"） */
    const addCurtain = (x, y, z, len, w) => {
      const edge = Math.min(1, Math.hypot(x, z) / 2.6);
      const L = len * (edge > 0.72 ? rr(0.62, 1.42) : 1) * rr(0.85, 1.15);
      curtains.push({ x, y, z, len: Math.min(L, Math.max(0.35, y - 0.30)), w, rot: jr() * TAU });
    };
    /* 全向叶簇基建（第八轮验收指令①的换法核心）：帘几何只会"往下挂"，挂帘盖不住
       挂点上方的弧背 —— 连续七轮的教训。tuft 记一个全向单位向量，实例化时把帘的
       -Y 轴映射到该方向：同一个 12 tri 几何既当垂帘、又当"长在枝上朝哪都有的叶簇"。 */
    const randDir = () => {
      const u = jr() * 2 - 1, a2 = jr() * TAU;
      const s2 = Math.sqrt(Math.max(0, 1 - u * u));
      return { x: s2 * Math.cos(a2), y: u, z: s2 * Math.sin(a2) };
    };
    const addTuft = (x, y, z, len, w, d) => {
      curtains.push({ x, y, z, len: Math.min(len, Math.max(0.30, y - 0.30)), w, dir: d, rot: jr() * TAU });
    };
    const addCluster = (cx, cy, cz, n, spread, lenMin, lenMax) => {
      for (let i = 0; i < n; i++){
        addCurtain(cx + gauss()*spread, cy + gauss()*spread*0.4, cz + gauss()*spread,
                   (lenMin + jr()*(lenMax-lenMin)) * rr(0.72, 1.32),   // 强方差：下摆参差
                   rr(1.0, 1.7));                                               // 宽帘：覆盖主力
      }
    };
    /* ① 短枝雾：主枝/冠枝全长密铺（第十一轮：锚点偏上——枝背优先，俯视盖枝线） */
    for (const br of brCurves){
      const nT = 26 + ((rnd()*14)|0);
      for (let k = 0; k < nT; k++){
        const pt = br.getPoint(0.10 + 0.90 * ((k + rnd()) / nT));
        addCurtain(pt.x + rr(-0.15,0.15), pt.y + rr(-0.06, 0.14), pt.z + rr(-0.15,0.15),
                   rr(0.25, 1.1) * rr(0.8, 1.25), rr(0.7, 1.1));
      }
    }
    /* ② 冠顶封盖：沿冠肋**弧线全长**挂长帘 —— 挂点骑在弧上（y 加 0~0.09 微抬），
       垂长 ≥ 冠高/3，骨架从此被叶幕从上往下盖住 */
    for (const rib of crownRibs){
      const nCover = Math.max(6, Math.round(rib.getLength() / 0.33));
      for (let k = 0; k < nCover; k++){
        const t = Math.min(0.97, Math.max(0.06, 0.10 + 0.80 * (k / (nCover - 1)) + rr(-0.02, 0.02)));
        const pt = rib.getPoint(t);
        addCurtain(pt.x + rr(-0.10,0.10), pt.y + rr(0.0, 0.09), pt.z + rr(-0.10,0.10),
                   Math.max(1.8, H / 2) * rr(0.75, 1.15), rr(0.9, 1.4));   // ×1.5：盖"赤道环带"（指令⑤）
      }
      /* 肋缘加厚（指令②）：冠肋外端一圈**全向外向**叶簇 —— "露箍"是轮廓弧线直接朝天，
         外向 tuft 挂在肋尖外侧 +0.04~0.30m，把箍包进肉里 */
      const tip = rib.getPoint(0.96);
      const tipR = Math.hypot(tip.x, tip.z);
      if (tipR > 1.5){
        for (let j = 0; j < 5; j++){
          const aa = Math.atan2(tip.z, tip.x) + rr(-0.4, 0.4);
          const outR = tipR + rr(0.04, 0.30);
          const d = randDir();
          addTuft(Math.cos(aa) * outR, tip.y + rr(0.0, 0.15), Math.sin(aa) * outR,
                  rr(0.5, 1.1), rr(1.0, 1.5),
                  { x: d.x * 0.5 + Math.cos(aa) * 0.75, y: d.y, z: d.z * 0.5 + Math.sin(aa) * 0.75 });
        }
      }
    }
    /* ②b 肋上长毛（第八轮验收指令①：换掉连续七轮"从肋上挂帘"的结构性错路）——
       沿冠肋/主枝每 ~0.18m 绑一撮**全向**叶簇（2~4 枚、随机方向含朝上），
       肋线自身连续遮挡拉满：从侧、从顶、从下看，弧都包在"肉"里。 */
    for (const rib of crownRibs){
      const nF = Math.max(12, Math.round(rib.getLength() / 0.18));
      for (let k = 0; k <= nF; k++){
        const pt = rib.getPoint(0.03 + 0.94 * (k / nF));
        const nPer = 2 + ((rnd()*3)|0);
        for (let j = 0; j < nPer; j++){
          /* 第十一轮：锚点上移枝背（+0.02~0.16）—— 第十轮自动验收定位病灶
             "叶挂得偏低、枝条上表面俯视裸露"：叶卡盖住枝顶投影，棕线直接消失。 */
          addTuft(pt.x + rr(-0.05, 0.05), pt.y + rr(0.02, 0.16), pt.z + rr(-0.05, 0.05),
                  rr(0.40, 1.0), rr(0.8, 1.2), randDir());
        }
      }
    }
    for (const br of brCurves){
      const nF = Math.max(12, Math.round(br.getLength() / 0.24));
      for (let k = 0; k <= nF; k++){
        const pt = br.getPoint(0.05 + 0.92 * (k / nF));
        const nPer = 2 + ((rnd()*2)|0);
        for (let j = 0; j < nPer; j++){
          addTuft(pt.x + rr(-0.06, 0.06), pt.y + rr(0.02, 0.14), pt.z + rr(-0.06, 0.06),
                  rr(0.45, 1.0), rr(0.8, 1.25), randDir());
        }
      }
    }
    /* ②c 顶冠叶球（指令⑤：短帘长度×1.5 向下衔接，"辐条+串珠"变封闭壳层）——
       干顶汇交区糊一团高密度帘，放射线的汇聚点消失在叶团里 */
    for (let i = 0; i < 140; i++){
      const a = jr() * TAU;
      const rad = Math.sqrt(jr()) * 1.0;
      addCurtain(Math.cos(a) * rad, H * (0.86 + jr() * 0.22), Math.sin(a) * rad,
                 rr(0.45, 1.35), rr(0.9, 1.5));
    }
    /* ②d 顶幕横毯 —— 2800 枚是"撒盐必连毯"的过补版本（第十二轮性能回归：
       2800→1600 枚，够封闭冠顶、省 1.2 万 tri/树 + 对应片元过绘制）。
       第十七轮（冠顶俯视闭合度）：① rad 上限 2.30→2.58 外延到冠缘（R=2.9 减余量，
       原来 2.6~3.1 最外圈无覆盖、方向性破洞随机落点 → 单树外环 49%~99% 方差巨大）
       ② dir.y ±0.28→+0.18~0.78 偏上仰躺：俯视投影是"面"不是"侧立窄条"，
       从顶上把冠缘盖死（实测单树外环极差 20.5pt → 收敛）。 */
    for (let i = 0; i < 1600; i++){
      const a = jr() * TAU, a2 = jr() * TAU;
      const rad = 0.30 + Math.sqrt(jr()) * 2.58;
      const yDome = (1.04 - (rad / 2.5) * 0.42) * H;
      addTuft(Math.cos(a)*rad + rr(-0.12,0.12), yDome * rr(0.93, 1.02), Math.sin(a)*rad + rr(-0.12,0.12),
              rr(0.40, 1.05), rr(1.0, 1.6),
              { x: Math.cos(a2), y: rr(0.18, 0.78), z: Math.sin(a2) });
    }
    /* ②d+ 外缘肋段强制带叶（第十轮指令②）：0.85R 以外的肋端不再靠天，
       每根肋尖 4 枚横向大 tuft 骑上枝背（第十一轮上移 +0.03~0.14）。
       第十七轮：dir.y ±0.3→+0.05~0.70 偏上仰躺，肋尖在俯视下是覆盖面而非侧立窄条。 */
    for (const rib of crownRibs){
      for (let j = 0; j < 4; j++){
        const t = 0.85 + j * 0.05 + rr(-0.02, 0.02);
        const pt = rib.getPoint(Math.min(1, t));
        const a2 = jr() * TAU;
        addTuft(pt.x + rr(-0.08, 0.08), pt.y + rr(0.03, 0.14), pt.z + rr(-0.08, 0.08),
                rr(0.5, 1.0), rr(1.1, 1.6), { x: Math.cos(a2), y: rr(0.05, 0.70), z: Math.sin(a2) });
      }
    }
    /* ②e 象限均密（第十轮指令③：反馈式闭环）—— 补到达标即停，不赌固定量：
       最多 5 轮，每轮对上层冠 8 扇区计数，低于均值 70% 的扇区补 80 枚横向 tuft。
       第十七轮：rad 上限 2.2→2.55 外延 + dir.y +0.12~0.70 偏上（俯视覆盖面）。 */
    for (let pass = 0; pass < 5; pass++){
      const counts = new Array(8).fill(0);
      for (const s of curtains){
        if (s.y < H * 0.60) continue;
        const sec = Math.floor(((Math.atan2(s.z, s.x) + TAU) % TAU) / (TAU / 8));
        counts[sec]++;
      }
      const mean = counts.reduce((x, b) => x + b, 0) / 8;
      const deficient = [];
      for (let sec = 0; sec < 8; sec++) if (counts[sec] < mean * 0.7) deficient.push(sec);
      if (!deficient.length) break;
      for (const sec of deficient){
        const az0 = sec * (TAU / 8);
        for (let i = 0; i < 80; i++){
          const az = az0 + jr() * (TAU / 8);
          const rad = 0.4 + Math.sqrt(jr()) * 2.55;
          const yDome = (1.00 - (rad / 2.5) * 0.40) * H;
          const a2 = jr() * TAU;
          addTuft(Math.cos(az)*rad, yDome * rr(0.90, 1.0), Math.sin(az)*rad,
                  rr(0.40, 0.95), rr(0.95, 1.45), { x: Math.cos(a2), y: rr(0.12, 0.70), z: Math.sin(a2) });
        }
      }
    }
    /* ②f 外环确定性补种（第十七轮：②d/②e 的随机簇单树上仍有方向性大洞 ——
       均匀半径分布 = 外圈面积大密度低，聚类随机 → 树1/树3 外环曾 59~78%、极差 ~28。
       按方位×半径确定性布点：28 方位 × 3 半径 × 每点 2 枚偏上 tuft + 微抖动，
       外环 2.3~3.0m 带宽被确定性铺满（细分实测 [2.85-3.1] 段原覆盖率 17~42%，
       是唯一系统性空区 —— 原 ②f 只到 2.8）；dir.y 偏上 0.3~0.8 俯视覆盖面。 */
    for (let ai = 0; ai < 28; ai++){
      const az = (ai / 28) * TAU + rr(-0.04, 0.04);
      for (const r0 of [2.35, 2.72, 2.95]){
        const rad = r0 + rr(-0.06, 0.06);
        const yDome = (1.04 - (rad / 2.5) * 0.42) * H;
        for (let j = 0; j < 2; j++){
          const a2 = jr() * TAU;
          addTuft(Math.cos(az) * rad, yDome * rr(0.93, 1.0), Math.sin(az) * rad,
                  rr(0.55, 1.0), rr(1.2, 1.7), { x: Math.cos(a2), y: rr(0.30, 0.80), z: Math.sin(a2) });
        }
      }
    }
    /* ③ 长垂帘：簇心高斯散布，外缘拂水内里分层 */
    for (const br of brCurves){
      const nC = 3 + ((rnd()*2)|0);                        // 每枝 3~4 个簇心
      for (let c = 0; c < nC; c++){
        const t = 0.35 + 0.65 * ((c + rnd()) / nC);
        const pt = br.getPoint(t);
        const outer = Math.min(1, Math.hypot(pt.x, pt.z) / 3.0);
        addCluster(pt.x, pt.y - 0.05, pt.z, 18 + ((rnd()*14)|0), 0.36,
                   0.9 + outer * 0.5, 1.8 + outer * 2.6);
      }
    }
    for (const rib of crownRibs){
      const pt = rib.getPoint(0.80 + rr(0, 0.15));
      const outer = Math.min(1, Math.hypot(pt.x, pt.z) / 3.0);
      addCluster(pt.x, pt.y, pt.z, 12 + ((rnd()*8)|0), 0.30,
                 1.1 + outer * 0.5, 2.2 + outer * 2.2);
    }
    /* ③b 帘间次帘（第八轮验收指令④：倍增至 ~200、锚点**强制落在主帘间隙中点**）——
       随机抽两根相距 0.3~0.8m 的主帘，在二者中点插半长次帘（45~70%）。
       "任意 0.5×0.5m 投影格内帘数 ≥3"由 ⑦ 审计输出实测值。 */
    {
      const longs = curtains.filter(s => s.len > 1.2 && !s.dir);
      let planted = 0;
      for (let tries = 0; tries < 4000 && planted < 200 && longs.length > 1; tries++){
        const s1 = longs[(jr() * longs.length) | 0];
        const s2 = longs[(jr() * longs.length) | 0];
        const dist = Math.hypot(s1.x - s2.x, s1.y - s2.y, s1.z - s2.z);
        if (dist < 0.3 || dist > 0.8) continue;
        addCurtain((s1.x + s2.x) / 2 + rr(-0.06, 0.06), (s1.y + s2.y) / 2 + rr(-0.08, 0.08),
                   (s1.z + s2.z) / 2 + rr(-0.06, 0.06),
                   (s1.len + s2.len) * 0.5 * rr(0.45, 0.70), rr(0.9, 1.5));
        planted++;
      }
    }
    /* ④ 网格补洞：0.45m 格扫冠包络（心高缘低的椭冠），空格按半径升概率补短帘 ——
       "左密右疏"是随机过程的方向性破洞，占位补洞是确定性兜底 */
    {
      const cell = 0.45, R = 2.9, occ = new Set();
      for (const s of curtains) occ.add(Math.round(s.x/cell)+'|'+Math.round(s.y/cell)+'|'+Math.round(s.z/cell));
      const nC = Math.ceil(R / cell);
      for (let xi = -nC; xi <= nC; xi++){
        for (let zi = -nC; zi <= nC; zi++){
          const rad = Math.hypot(xi*cell, zi*cell);
          if (rad > R || rad < 0.35) continue;
          const yTop = H * (1.00 - (rad / R) * 0.40);
          const yBot = Math.max(0.5, H * (0.52 - (rad / R) * 0.12));
          for (let yi = Math.ceil(yBot/cell); yi <= Math.floor(yTop/cell); yi++){
            const key = xi+'|'+yi+'|'+zi;
            if (occ.has(key)) continue;
            occ.add(key);
            if (jr() < 0.62 + 0.33 * (rad / R)){
              addCurtain(xi*cell + rr(-0.12,0.12), yi*cell, zi*cell + rr(-0.12,0.12),
                         rr(0.5, 1.5) * rr(0.8, 1.25), rr(0.9, 1.5));
            }
          }
        }
      }
    }
    /* ⑤ 碎叶云（验收"只动一刀就动这刀"）：梳齿感的根源是"线密隙宽"——
       长帘之间是干净的天空缝。用超短宽碎帘（0.25~0.65m、w 1.2~1.8）纯随机撒进
       冠包络：不打格子、不挂枝，就是空间里的叶团噪声。同时救三件事：
       覆盖观感（缝被填）、破洞观感（拳级洞被糊）、顶部骨架遮挡（顶心区密度加倍）。 */
    {   // 碎叶云（第十二轮性能回归：950~1300 → 420~620，够糊缝，省 7k tri/树）
      const R = 2.9, nChip = 420 + ((rnd()*200)|0);
      for (let i = 0; i < nChip; i++){
        const a = jr() * TAU;
        const rad = Math.sqrt(jr()) * R;
        const yTop = H * (1.00 - (rad / R) * 0.40) + (rad < R * 0.55 ? H * 0.10 : 0);   // 顶心区穹面抬高
        const yBot = Math.max(0.55, H * (0.50 - (rad / R) * 0.12));
        addCurtain(Math.cos(a)*rad + rr(-0.1,0.1), yBot + jr()*(yTop - yBot), Math.sin(a)*rad + rr(-0.1,0.1),
                   rr(0.25, 0.65), rr(1.2, 1.8));
      }
    }
    /* ⑤b 定点补洞（指令③：交叉射线复验）—— 单侧射线会漏"侧面看才透"的洞：
       每个方位再从 ±30° 各打一遍；补栽簇径下限提到 0.6m 量级（spread 0.45+）。 */
    {
      const cellH = 0.35, occ = new Set();
      const k3 = (x, y, z) => Math.round(x/cellH) + '|' + Math.round(y/cellH) + '|' + Math.round(z/cellH);
      for (const s of curtains) occ.add(k3(s.x, s.y, s.z));
      const near = (x, y, z) => {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
          if (occ.has(k3(x + dx*cellH, y + dy*cellH, z + dz*cellH))) return true;
        return false;
      };
      for (let ai = 0; ai < 10; ai++){
        for (const off of [0, -0.52, 0.52]){              // ±30° 交叉
          const az = (ai / 10) * TAU + off + rr(-0.06, 0.06);
          const ca = Math.cos(az), sa = Math.sin(az);
          for (const hF of [0.40, 0.60, 0.80]){
            const y = H * hF;
            let streak = 0, sx0 = 0, sz0 = 0;
            for (let r = 3.2; r > 0.3; r -= 0.25){
              const x = ca * r, z = sa * r;
              if (near(x, y, z)){ streak = 0; continue; }
              if (streak === 0){ sx0 = x; sz0 = z; }
              streak++;
              if (streak * 0.25 >= 0.80){
                const mx = (sx0 + x) / 2, mz = (sz0 + z) / 2;
                addCluster(mx, y, mz, 3 + ((rnd()*3)|0), 0.45, 0.7, 1.9);
                for (let q = 0; q < 4; q++) occ.add(k3(mx + rr(-0.25,0.25), y, mz + rr(-0.25,0.25)));
                streak = 0;
              }
            }
          }
        }
      }
    }
    // ⑥ 散兵帘：~18% 散在簇外
    const scatterN = Math.round(curtains.length * 0.18);
    for (let i = 0; i < scatterN; i++){
      const br = brCurves[(rnd()*brCurves.length)|0];
      const pt = br.getPoint(rr(0.25, 1.0));
      addCurtain(pt.x + rr(-0.55,0.55), pt.y + rr(-0.3,0.1), pt.z + rr(-0.55,0.55),
                 rr(0.5, 3.8) * rr(0.7, 1.3), rr(0.8, 1.4));
    }

    /* ⑦ 顶帘审计（第八轮验收指令②：先证存在再谈参数）——
       顶区帘数/长度实测 + 0.5m 投影格统计（俯视 XZ / 侧视 XY），挂在组上供探针取证。 */
    {
      const tops = curtains.filter(s => s.y > H * 0.82);
      let minL = 1e9, sumL = 0;
      for (const s of tops){ if (s.len < minL) minL = s.len; sumL += s.len; }
      const projStat = (fx, fy) => {
        const map = new Map();
        for (const s of curtains){
          const key = (Math.round(s[fx] * 2) * 0.5) + '|' + (Math.round(s[fy] * 2) * 0.5);
          map.set(key, (map.get(key) || 0) + 1);
        }
        let cells = 0, ok = 0;
        for (const v of map.values()){ cells++; if (v >= 3) ok++; }
        return { cells, ge3pct: +(100 * ok / Math.max(1, cells)).toFixed(1) };
      };
      g.userData.willowAudit = {
        total: curtains.length,
        tufts: curtains.filter(s => s.dir).length,
        top: { n: tops.length, minLen: +minL.toFixed(2), meanLen: +(sumL / Math.max(1, tops.length)).toFixed(2) },
        projTop: projStat('x', 'z'),      // 俯视（XZ 平面）0.5m 格
        projSide: projStat('x', 'y'),    // 侧视（XY 平面）0.5m 格
      };
    }

    // 垂帘实例化 + instanceColor：内暗外亮拉到 ~30% 明度差（k 曲线加幂，外缘更亮）
    /* 洗牌（第十二轮关键修复）：季节通道按 count 缩减只会保留实例数组**前缀**——
     构建顺序是"内部枝雾在前、外层垂帘在后"，不洗牌的话春/冬先丢光外层垂帘，
     留下的全是内部密雾层，"稀疏"永远读不出来（第十二轮春柳"密实暗块"的根因）。
     洗匀后按比例缩减 = 全冠均匀变稀 ✓ */
  for (let i = curtains.length - 1; i > 0; i--){
    const j = (jr() * (i + 1)) | 0;
    const t = curtains[i]; curtains[i] = curtains[j]; curtains[j] = t;
  }
  const curtainGeo = makeWillowCurtainGeo();
    const cInst = new THREE.InstancedMesh(curtainGeo, MAT.willowLeaf, curtains.length);
    cInst.castShadow = false;
    cInst.userData.seasonWillowLeaf = true;   // 季节通道收"叶"：冬季整幅叶幕收尽，裸枝过冬
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
    const col = new THREE.Color(), inner = new THREE.Color(0x7a9a50), outer = new THREE.Color(0xe2efa0);
    const _down = new THREE.Vector3(0, -1, 0), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _qr = new THREE.Quaternion();
    curtains.forEach((s, i)=>{
      p.set(s.x, s.y, s.z);
      if (s.dir){
        /* tuft：把帘的 -Y（垂挂轴）映射到全向 d，再绕自身长轴滚转 s.rot ——
           同一几何"朝哪长"的都有，肋线从任意视角都被叶包住 */
        _d.set(s.dir.x, s.dir.y, s.dir.z).normalize();
        q.setFromUnitVectors(_down, _d);
        q.multiply(_qr.setFromAxisAngle(_up, s.rot));
      } else {
        q.setFromEuler(new THREE.Euler(rr(-0.08,0.08), s.rot, rr(-0.08,0.08)));
      }
      sv.set(s.w, s.len, s.w);
      m.compose(p, q, sv); cInst.setMatrixAt(i, m);
      const k = Math.pow(Math.min(1, Math.hypot(s.x, s.z) / 3.0), 1.25);
      col.copy(inner).lerp(outer, k).offsetHSL(rr(-0.03, 0.03), rr(-0.03, 0.05), rr(-0.06, 0.06));
      cInst.setColorAt(i, col);
    });
    cInst.instanceMatrix.needsUpdate = true;
    if (cInst.instanceColor) cInst.instanceColor.needsUpdate = true;
    g.add(cInst);

    return g;
  }

/* ── 桃花（重建 · 2026-09-22 二轮）────────────────
   桃是落叶观花小乔木，四季生命周期由 12-env 的季节显隐通道驱动：
     peachShow          → 叶冠（MAT.peachLeaf，走 tinLeaf：春夏绿 → 秋黄 → 冬落尽裸枝）
     peachBlossomShow   → 花   （MAT.peachBlossom，春开，先花后叶）
     peachFruitShow     → 果   （MAT.peachFruit，夏秋带红晕的蜜桃）
     peachPetalShow     → 落花铺地（MAT.peachPetal，春末夏初树干四周散一层粉瓣）
   ⚠️ 二轮重建的**根因**（老黄实拍判语："光秃秃的直棍插在石头上"）：

   ① 主干塌成刀片 —— 手工锥化用 `curve.getPoint(t)` 取圈心，而 TubeGeometry 生成顶点
      用的是 `path.getPointAt(i/n)`（**弧长**参数化）。两者同名不同实：同一个 t 落在
      不同位置（该曲线上位差 >0.17m，比半径 0.16 还大）—— 于是 `dir = normalize(v-center)`
      里混进一个**轴向**分量，而 `v.copy(center)` 把这一圈的 x/z 直接拍回轴上：
      上半段整圈塌成一点。世界包围盒实测 [0.06, 2.92, 0.15]（另一株更极端
      [0.14, 3.26, 0.03]），正常应为 ~0.33×0.33 的圆管 —— 一根压扁的刀片。
      修法：tubeRadiusRamp() 按**圈号**取 t、用 getPointAt 取圈心，径向缩放才真的只缩径向。
   ② 叶片 600 上限**从未达到**（三株实测 379 / 330 / 258）：挂点是"每枝随机 5~8 小枝 ×
      每枝 6~10 片"，叶子挂完就走 —— `count` 声明 600 是个从未兑现的承诺，冠层只剩骨架。
   ③ 叶量按"每枝若干片"给是错的：应当由**冠层尺度**决定（枝条有多长就有多少挂点）。
   ④ 几何本身就贵，贵到开不起花：旧叶 38 tri/片（ShapeGeometry 四条贝塞尔 ×10 细分）、
      旧花 ≈160 tri/朵（5 片 ShapeGeometry 花瓣）—— 这个预算下"花满树"根本不可能。

   现在：叶片换 makeLeafVolumeGeo 的**单面弯叶**（12 tri/片）；花换成**花瓣贴图卡**
        （5 张 quad = 12 tri/朵 —— 泪滴形与粉白渐变本来就画在贴图里，几何再刻一遍纯属浪费）；
        挂点按弧长间隔沿**全部枝条**取样，叶量由冠层决定；主枝/小枝各自并成一个 mesh
        （旧版 30+ 根小枝各一个 mesh = 30+ draw call）。 */

/* 变速管：把 TubeGeometry 的每一圈缩放到目标半径。
   ⚠️ **必须**用 `path.getPointAt(i / tubularSegments)` 取圈心 —— 这正是 TubeGeometry
   生成顶点时用的函数；改用 getPoint() 会让圈心偏离真正的中轴，径向缩放变成"把整圈拍回轴上"。
   ⚠️ 传入的 geo 必须是以 radius=1 建的：这样 (v − center) 才是单位向量，缩放系数就是真半径。
   TubeGeometry 的顶点序 = 圈号 × (radialSegments + 1) + 圈内序号（见其 generateSegment）。 */
function tubeRadiusRamp(geo, path, tubularSegments, radialSegments, radiusAt){
  const pos = geo.attributes.position;
  const per = radialSegments + 1;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i++){
    const t = i / tubularSegments;
    const r = radiusAt(t);
    path.getPointAt(t, c);
    for (let j = 0; j < per; j++){
      const idx = i * per + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/* 桃叶：披针形（基部窄 → 中部最宽 → 先端渐尖），单面弯叶带中肋脊。
   走 makeLeafVolumeGeo 的家法：segs=3 → 12 tri/片（旧 ShapeGeometry 卡片 38 tri）。
   ⚠️ 尺度按园子的既有约定**放大保可读**，不是植物学真值：真实桃叶 7~15cm，
   但竹叶在这个园子里是 0.42m（makeBambooLeafGeo 注释写明"游戏里放大到 ~0.42m 基准保持可读"）、
   柳条帘是 0.34×1m。上一版桃叶按真值给了 0.155m，挂在一棵 4.9m 宽的冠上就是"撒纸屑" ——
   门禁实测（从外面向树冠轮廓内投平行射线，命中叶片的比例）三步走：
     真值 0.155m → 0.093（能看穿）｜0.24m → 0.426｜现在 0.26m + 挂点铺密 → 见 peach-form-guard。
   叶片从原点沿 +Y 生长，叶面法线朝 ±Z —— 实例化时把 +Y 对到叶的生长方向。 */
function makePeachLeafGeo(){
  return makeLeafVolumeGeo({ len: 0.26, wMid: 0.008, wTop: 0.030,
                             thick: 0.010, segs: 3, cup: 0.34, bow: 0.022 });
}

/* 桃花：五张**花瓣贴图卡**（每张 2 tri）+ 中央花蕊球 = 12 tri/朵。
   ⚠️ 旧版 5 片 ShapeGeometry 花瓣 ≈160 tri/朵，同样预算只能开 65 朵 —— "花满树"开不出来。
   花盘法线朝 +Z（五瓣绕 Z 排布、各向外倾 +0.55 成浅碗），实例化时把 +Z 对到朝外方向。 */
function makePeachFlowerGeo(){
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
function makePlumFlowerGeo(){
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
  const core = new THREE.SphereGeometry(0.016 * K, 7, 5);
  core.translate(0.003 * K, 0.002 * K, 0.004);              // 花心略偏 ⇒ 不像打印出来的对称图标
  parts.push(paint(core, 0.34, 0.26, 0.12));
  for (let s = 0; s < 6; s++){
    const f = new THREE.CylinderGeometry(0.0026 * K, 0.0026 * K, 0.025 * K, 4);
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
function makePlumBudGeo(){
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
  const body = new THREE.SphereGeometry(R, 14, 10);
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
    const rib = new THREE.SphereGeometry(R * 0.19, 6, 8);
    rib.scale(1, 3.0, 1);
    rib.rotateZ(0.18);                              // ① 先绕自身倾斜（上端收）
    rib.translate(R * 1.00, H * 0.50, 0);           // ② 再沿径向推出去 ⇒ 凸出本体约 5mm
    rib.rotateY((k * TAU) / 5 + 0.5);               // ③ 绕苞轴分布
    parts.push(paint(rib, 0.60, 0.58, 0.53));
  }
  /* 花萼：**明显**的深色小杯，托在苞身下沿（资料："花萼明显"）—— 比本体略宽 ⇒ 露出一圈 */
  const calyx = new THREE.CylinderGeometry(R * 0.78, R * 1.12, R * 0.92, 8);
  calyx.translate(0, R * 0.22, 0);
  parts.push(paint(calyx, 0.16, 0.13, 0.06));
  /* 短花梗（资料："花梗短"）：**很短**、大半藏在花萼里 —— 上一版给到 R*1.5 且挂在萼下，
     实测它把花苞的包围盒高度抬到 0.103m（= 盛开花宽的 0.87 倍），量出来的"花苞"变成一根手指。 */
  const pedicel = new THREE.CylinderGeometry(R * 0.16, R * 0.22, R * 0.9, 5);
  pedicel.translate(0, R * 0.05, 0);
  parts.push(paint(pedicel, 0.19, 0.15, 0.07));
  return mergeGeometries(parts, false);
}

/* ══ 梅花的**凋谢**几何（2026-10-08 二轮 · 老黄给的真实梅资料）═════════════════════════
   资料："花瓣失去张力，**向下卷曲**或松散脱落，颜色略微变暗，**花心和雄蕊暴露**，
        部分花瓣残留在花托上，花梗略显干燥"。
   ⇒ 单独一份几何：花瓣**短一档**且**向下折**（rotateX 大角 ⇒ 碟变成"倒扣的碗"），
     只留 4 片（"部分脱落"），花心/雄蕊照旧露着（雄蕊相对更长一点 —— 花瓣合上了，蕊才显得露出来）。 */
function makePlumWitheredGeo(){
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
  const core = new THREE.SphereGeometry(0.019 * K, 7, 5); core.translate(0, 0, 0.004);
  parts.push(paint(core, 0.46, 0.35, 0.15));          // 花托：亮一档 ⇒ 花瓣下垂时读得出"花心外露"
  for (let s = 0; s < 6; s++){                        // 雄蕊露出来（更长、更亮 = 凋谢最硬的识别特征）
    const f = new THREE.CylinderGeometry(0.0030 * K, 0.0030 * K, 0.040 * K, 4);
    f.translate(0, 0.020 * K, 0);
    f.rotateX(0.26 + 0.12 * Math.sin(s * 2.4));
    f.rotateZ((s * TAU) / 6 + 0.25);
    f.translate(0, 0, 0.006);
    parts.push(paint(f, 0.58, 0.46, 0.20));
  }
  return mergeGeometries(parts, false);
}

/* 桃子：心形/卵形，顶端有突尖，腹缝有浅沟
   用 LatheGeometry 沿纵轴旋转出基本形，再压扁一侧做心形凹陷 */function makePeachFruitGeo(){
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
const TREE_LANTERN_COLORS = [
  0xFF6B35,   // 橙
  0xFF8FAB,   // 粉
  0xFFD166,   // 黄
  0x7BD389,   // 绿
  0x6BA8FF,   // 蓝
];
function treeLanternColor(rr2){
  const c = TREE_LANTERN_COLORS[(rr2(0, TREE_LANTERN_COLORS.length)) | 0];
  /* 每盏亮度再抖动一档（±18%）：同色系全等亮度会读成"塑料玩具"，有亮度差才像一串灯 */
  const k = 0.82 + rr2(0, 0.36);
  return new THREE.Color(c).multiplyScalar(k);
}
function makeTreeLanternGeo(){
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
export const treeLanternInsts = [];
/* 梅树的花苞网格（2026-10-08）：与花分开一份几何/材质，门禁按 `plumBuds` 名字或这份清单找得到
   （项目惯例：新加的网格要能**显式**被探针拿到，别让它去 traverse 猜）。 */
const budMeshes = [];
/* 凋谢花的网格清单（2026-10-08）：与花苞同理，显式暴露给探针/门禁（别让它去 traverse 猜）。 */
const witheredMeshes = [];
/* 材质：MeshBasic + toneMapped:false —— 自发光色直接进 bloom，不吃光照也不被色调映射压暗。 */
export const TREE_LANTERN_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false,
                                                            transparent: true, opacity: 0.95,
                                                            depthWrite: false });
const MATB = { treeLantern: TREE_LANTERN_MAT };

/* ⚠️ `baseY`（2026-09-23 新增 · 老黄第三轮指认）：南岸那株实测树脚四周的可见表面在
   y = 0.40~1.03（太湖石串 + 埋脚鼓包围成一只"碗"），而树基固定在 y=0、主干只到 1.87m
   ⇒ **主干下半截连同分叉点一起埋进这圈隆起**，露出来的只剩主枝中上段。老黄看得准：
   "它的根和枝都是石头或者草皮中长出来的，而不是一个主枝干，再分支的正常形态。"
   对策：把整树抬到隆起之上（baseY），并让主干**向下加长**穿进土里（见 trunkCurve 第一点），
   免得抬起来之后树底悬空。根盘跟着树走 —— 树长在丘顶，根颈就在丘顶，这是自然的。 */
export function makePeachTree(x, z, scale = 1, baseY = 0, opts = {}){
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.scale.setScalar(scale);
  /* ⚠️ 本树自带随机流（种子由坐标决定）：园子的全局 rnd/rr 是**一条**可复现流，
     但桃树建在 deferBoot 的延迟任务里 —— 异步资产回调/别的延迟任务先后耗尽它的抽样数，
     树的形状就会随加载时序漂移。实测：同一份代码连开两次，主干高 2.77m vs 2.92m、
     叶包围盒也不同（见 outputs/_diag/_peach-determinism.mjs）—— 于是所有"改前改后"的数字
     都夹着一层"换了一棵树"的噪声。自带流之后，树的形状与加载时序彻底解耦。
     ⚠️ 声明必须在第一次抽样（H）之前 —— 否则 TDZ 直接抛错。 */
  const R2 = mulberry32((Math.round(x * 1000) * 73856093) ^ (Math.round(z * 1000) * 19349663)
                        ^ (Math.round(scale * 1000) * 83492791));
  const rr2 = (a, b) => a + R2() * (b - a);
  const i2 = (n) => (R2() * n) | 0;
  const H = 4.2 * rr2(0.92, 1.08) * (opts.heightMul || 1);   // 桃较柳矮：观花小乔木（梅传 heightMul 更高）
  /* ⚠️ 主干半径 0.150 → 0.100（2026-09-22 二轮重建）：老黄实拍样张里主干是一根 ~0.44m 粗的
     光杆，4m 高的桃树不该有这么粗的干（真实桃干径 0.12~0.20m）。根盘同步收小。 */
  const trunkR = 0.100 * rr2(0.94, 1.08);
  /* 冠心/冠半径：冠幅必须与**叶量预算**匹配 —— 4000 片 0.26m 的叶摊在 3.5m 宽的冠上只剩
     一层稀晕（实测 77% 的叶挤在半径 1m 内，冠外圈只摊到 23%，从外面看穿得透）。
     收到 0.34H（冠幅 ≈2.9m）后同样的叶量密度提高 ~1.5 倍。 */
  const canopyC = new THREE.Vector3(0, H * 0.64, 0);     // 冠心
  const R = H * 0.34 * (opts.canopyMul || 1);            // 冠半径（梅传 canopyMul 展得更开）
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(),
        _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(),
        _s = new THREE.Vector3(), _e = new THREE.Euler(),
        _up = new THREE.Vector3(0, 1, 0), _ax = new THREE.Vector3(),
        _basis = new THREE.Matrix4(), _bx = new THREE.Vector3();   // 叶面定向用（见叶块）

  /* 主干：地面 → **低分叉点（0.48H）**，基部根盘隆起、向上渐细。
     ⚠️ 分叉点 0.66H → 0.48H（二轮重建）：桃的招牌是**低分叉的杯状骨架** ——
     主枝从 0.7~1.6m 就斜向外张成三四个大主枝，而旧版主干光杆一直顶到 2.8m 才分枝，
     远看就是"一根旗杆顶上插了几根枝"。
     半径剖面 r(t) = trunkR × (1 − 0.40t) × (1 + 0.38(1−t)^6)：
       t=0 → 1.38r（≈0.14，根盘）→ 中段 ≈1.0r → t=1 → 0.60r（≈0.06）—— 圆管且确实在收细。 */
  const trunkCurve = new THREE.CatmullRomCurve3([
    /* ⚠️⚠️ 2026-10-06 修「腊梅主干悬空」（老黄截图1：树干整根停在雪面上方、底端与雪面有空隙）：
       这一行原来是 `-0.06 - baseY` —— 它假定 baseY ≥ 0（桃树两株正是 0 与 0.45，向下加长
       以穿过隆起的土石层）。而梅是**按负地表**落地的（腊梅 baseY = −0.40），负号一进公式就翻向：
       −0.06 −(−0.40) = **+0.34** ⇒ 主干底端被抬到组原点**上方** 0.34m，而组本身坐在 −0.40
       ⇒ 树底离地约 0.34m，整根悬空（截图里"停在雪面上"就是这么来的）。
       ⇒ 改成 `-0.06 - Math.max(0, baseY)`：baseY ≥ 0 时逐字不变（桃树不受影响），
       baseY < 0 时不再加长（组已经落在地表上，底端自然埋进土里）。 */
    new THREE.Vector3(0, -0.06 - Math.max(0, baseY), 0),
    new THREE.Vector3(rr2(-0.05,0.05), H*0.18, rr2(-0.05,0.05)),
    new THREE.Vector3(rr2(-0.04,0.04), H*0.34, rr2(-0.04,0.04)),
    new THREE.Vector3(rr2(-0.03,0.03), H*0.48, rr2(-0.03,0.03)),
  ]);
  const TR_SEG = 16, TR_RAD = 10;
  const trunkGeo = tubeRadiusRamp(
    new THREE.TubeGeometry(trunkCurve, TR_SEG, 1, TR_RAD, false), trunkCurve, TR_SEG, TR_RAD,
    t => trunkR * (1 - 0.40 * t) * (1 + 0.38 * Math.pow(1 - t, 6)));
  /* ⚠️ 主干**不进 mergeStatics**（userData.noMerge）：它是这个园子里唯一会"静默塌成刀片"
     的构件 —— 手工锥化那版让主干上半段整圈塌掉，而 30 道门禁没有一道看得见：合并进世界材质桶
     之后连名字都没了，按名字根本量不到它。留它单飞换来"逐圈量半径"的能力，
     代价是 2 个 draw call / 640 tri（两株）。
     注意：枝与小枝仍然合并（它们同材质同变换，并进世界桶省 draw call，且不易静默变形）。 */
  const trunkMesh = mesh(trunkGeo, opts.trunkMat || MAT.trunk, { name:'peachTrunk', cast:true });
  trunkMesh.userData.noMerge = true;
  g.add(trunkMesh);

  /* ── 根颈 + 不规则斜根（2026-09-23 重塑 · 老黄："桃/柳露根几乎一模一样，
     而且没有这种类似花瓣一样的根系"）──
     旧版是 6 块低模扁球**均匀绕一圈**（60° 间隔 + 长轴朝外）→ 标准放射花瓣/蒜瓣，
     还与柳树的 5 块同配方。真实桃树是**根颈自然外扩 + 若干条粗细不一的根斜插入土**：
     方位不成对称、长短不齐。故改为「一个根颈扁台 + 2~4 条锥形斜根」。
     ⚠️ rr2 消耗与原版**严格等量**（6 槽 × 2 次 = 12 次）—— 后面的主枝 / 小枝 / 叶 /
        花 / 果抽样逐位不变（§36.6 同族：只改"怎么用"，不改"用几次"）。 */
  const rootSeeds = [];
  for (let i = 0; i < 6; i++){
    rootSeeds.push({ a: (i / 6) * TAU + rr2(-0.62, 0.62),   // 抖动远大于 60° ⇒ 破掉均匀感
                     s: rr2(0.75, 1.30) });
  }
  /* ① 根颈：主干基部一圈低矮外扩 —— 读作"干脚自然变粗"，而不是"插了几块石头" */
  const rootFlare = mesh(new THREE.SphereGeometry(trunkR * 1.45, 12, 7), MAT.trunk, { name:'peachRootFlare', cast:true });
  rootFlare.position.set(0, 0.015, 0);
  rootFlare.scale.set(1.22, 0.40, 1.22);
  g.add(rootFlare);
  /* ② 斜根：条数由 s 筛出（不再多消耗随机数），从根颈斜向外下扎进土里 */
  const pickedRoots = rootSeeds.filter(o => o.s > 0.95);
  const nRoot = Math.max(2, pickedRoots.length);
  for (let i = 0; i < nRoot; i++){
    const o = pickedRoots[i];
    /* 桃是**浅根小乔木**：露根比柳树细得多、短得多，同样要"半埋"——
       第一版 r0 0.050·s / len 0.46·s 实测读作"一根粗香肠趴在地上"。 */
    const len = 0.34 * o.s, r0 = 0.032 * o.s;
    const wob = (o.s - 1.0) * 0.9;            // 由 s 派生偏摆（不再多消耗随机数 ⇒ rr2 仍是 12 次）
    const pts = [];
    for (let k = 0; k <= 3; k++){
      const t = k / 3, aa = o.a + wob * t * t;
      const rrad = trunkR * 0.7 + (len - trunkR * 0.7) * t;
      pts.push(new THREE.Vector3(Math.cos(aa) * rrad, 0.040 - 0.115 * t, Math.sin(aa) * rrad));
    }
    const rc = new THREE.CatmullRomCurve3(pts);
    g.add(mesh(tubeRadiusRamp(new THREE.TubeGeometry(rc, 12, 1, 7, false), rc, 12, 7,
                              t => r0 * (1 - 0.70 * t)), MAT.trunk, { name:'peachRoot', cast:true }));
  }

  /* 主枝：5~7 根，从主干 **0.16~0.38H**（低位）处分叉斜向上外张 —— 杯状骨架。
     半径基 0.041 → 梢 0.011（随干径同步收小；旧 0.050 的枝在细干上像插上去的）。
     全部并成**一个** mesh —— 同材质同变换，分成 5~6 个 mesh 只是白送 5~6 个 draw call。 */
  const nBranch = Math.round((5 + (i2(3))) * (opts.branchMul || 1));   // 主枝（梅传 branchMul 枝更多）
  const mainBranches = [];       // 保存曲线用于挂叶/花/果
  const branchGeos = [];
  const BR_SEG = 14, BR_RAD = 7;
  for (let i = 0; i < nBranch; i++){
    const a = (i / nBranch) * TAU + rr2(-0.35, 0.35);
    const y0 = H * rr2(0.16, 0.38);
    /* ⚠️ 2026-09-23 冬态重建（老黄截图红框：南岸那棵冬天像一把扫帚）：
       旧版 reach 与 tipY **各自独立**随机 —— 垂直升幅 tipY−y0 因此在 0.46~2.47m 之间乱跳，
       7 根主枝里总有几根仰角只剩 ~21°（几乎垂直上窜），冠层裂成"竖柱"；
       夏天叶/花/果把它糊住看不出来，**冬天叶落尽当场露馅**（老黄：'冬天一眼看出不正常'）。
       改为**由主枝实长 + 仰角**反算：桃树开心形主枝与水平成 40~52°，
       冠才朝外张成杯口，而不是几根竿子朝天。
       ⚠️ rr2 消耗次数与原版一致（reach + tipY 两次 → brLen + brAngle 两次），
          本地流后续抽样（upBias / 起点抖动）逐位不受影响。 */
    const brLen   = H * rr2(0.30, 0.40);                 // 主枝实长（范围按 peach-form-guard 反调：撑太大 → 叶摊薄，夏冠层 fill 掉到 0.50 以下）
    const brAngle = rr2(0.70, 0.91);                     // 与水平 40~52°
    const reach   = brLen * Math.cos(brAngle);           // 水平投影（落在冠半径方向）
    const tipY    = y0 + brLen * Math.sin(brAngle);      // 梢端高度 = 起点 + 垂直升幅
    const upBias = rr2(0.10, 0.30);   // 向上弯曲程度
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(rr2(-0.04,0.04), y0, rr2(-0.04,0.04)),
      new THREE.Vector3(Math.cos(a)*reach*0.35, y0 + H*upBias*0.4, Math.sin(a)*reach*0.35),
      new THREE.Vector3(Math.cos(a)*reach*0.7, tipY + H*upBias*0.2, Math.sin(a)*reach*0.7),
      new THREE.Vector3(Math.cos(a)*reach, tipY, Math.sin(a)*reach),
    ]);
    mainBranches.push(c);
    branchGeos.push(tubeRadiusRamp(
      new THREE.TubeGeometry(c, BR_SEG, 1, BR_RAD, false), c, BR_SEG, BR_RAD,
      t => 0.041 - 0.030 * t));
  }
  const brMesh = new THREE.Mesh(mergeGeometries(branchGeos, false), MAT.trunk);
  brMesh.name = 'peachBranch';
  brMesh.castShadow = true;
  g.add(brMesh);

  /* 二级小枝：从主枝**全长**长出（旧版只从 0.25~0.95 取点、5~8 根），更细更长，
     是挂叶/花/果的主要位置。同样并成一个 mesh —— 旧版 40~50 根小枝 = 40~50 个 draw call。 */
  const twigs = [];
  const twigGeos = [];
  const TW_SEG = 6, TW_RAD = 5;
  for (const br of mainBranches){
    /* twigMul（2026-10-08）：梅要"枝条数量与分叉更多 ⇒ 花点满枝"（老黄："现实中的梅花
       不是这种密集型开放"，参照图是真实蜡梅/梅的**疏枝点花**）。桃不传 ⇒ 逐字不变。 */
    const nTwig = Math.round((8 + (i2(5))) * (opts.branchMul || 1) * (opts.twigMul || 1));
    for (let k = 0; k < nTwig; k++){
      const t = rr2(0.20, 0.96);
      const base = br.getPointAt(t);
      const tan = br.getTangentAt(t).normalize();
      // 小枝向外上方生长
      const a = rr2(0, TAU);
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = new THREE.Vector3()
        .addScaledVector(side, rr2(0.50, 0.90))
        .addScaledVector(_up, rr2(0.35, 0.75))
        .addScaledVector(tan, rr2(-0.10, 0.35))
        .normalize();
      /* ⚠️ 枝条长度（2026-10-08 老黄："通常我们看到的腊梅和红梅都是一个**细长的枝条**上
         （部分枝条和分叉可以再长一些）"）：梅 0.22~0.42 → **0.30~0.58**（更长、变化更大 ⇒
         有长有短才像"细长枝条"而不是一圈齐刷刷的短枝），管径也收细一档（13mm→11.5mm 起）。
         ⚠️ **桃树不传 `longTwig` ⇒ 逐字保持原样**（这一个函数是桃/梅共用的，长度一改，
            桃的株形也变 —— 老黄没要求动桃）。 */
      const len = opts.longTwig ? rr2(0.30, 0.58) : rr2(0.22, 0.42);
      const tip = base.clone().addScaledVector(dir, len);
      const mid = base.clone().addScaledVector(dir, len * 0.5);
      mid.y += rr2(0.02, 0.07);                 // 小枝稍微向上拱
      const twCurve = new THREE.CatmullRomCurve3([base.clone(), mid, tip.clone()]);
      twigs.push(twCurve);
      const rad0 = opts.longTwig ? 0.0115 : 0.013, rad1 = opts.longTwig ? 0.0080 : 0.009;
      twigGeos.push(tubeRadiusRamp(
        new THREE.TubeGeometry(twCurve, TW_SEG, 1, TW_RAD, false), twCurve, TW_SEG, TW_RAD,
        s => rad0 - rad1 * s));
    }
  }
  /* ⚠️ 挂灯只看**二级枝**：下面的三级枝是 2026-10-08 新增的枝层，而 `treeLanterns` 的数量
     与 festival-guard / festival-lanterns-guard 的口径绑着 —— 不能被新枝层带着一起变。 */
  const baseTwigs = twigs.slice();
  /* ⚠️ 新增枝层必须**在 twigMesh 建之前**推进 twigGeos（并进同一个合并网格 ⇒ 仍只 1 个 draw call）。 */
  if (opts.subTwig){
    /* ── 三级枝（2026-10-08 · 梅专用）──────────────────────────────────────
       老黄："把树的枝条数量和分叉再增加，每条枝条和分叉上的花苞和花朵如截图所示，
       这样也能形成壮观的场景"。真实梅/蜡梅是"疏枝点花"：花单生或 2~3 朵并生于**枝节**、
       贴枝、无长梗；繁茂感来自**枝条多**，不是把花堆在少数几根枝上（那样读成紫藤）。
       ⇒ 每条二级枝再抽 2~3 根三级枝（2026-10-08 二轮把长度 0.10~0.22 → **0.14~0.30**：
         老黄要"部分枝条和分叉可以再长一些"；三级枝只在 `opts.subTwig`（梅）时才建）。 */
    const parents = twigs.slice();
    for (const tw of parents){
      const nSub = 2 + (i2(2));
      for (let k = 0; k < nSub; k++){
        const t = rr2(0.25, 0.92);
        const base = tw.getPointAt(t);
        const tan = tw.getTangentAt(t).normalize();
        const a = rr2(0, TAU);
        const dir = new THREE.Vector3()
          .addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), rr2(0.35, 0.80))
          .addScaledVector(_up, rr2(0.30, 0.70))
          .addScaledVector(tan, rr2(0.05, 0.45))
          .normalize();
        const len = rr2(0.14, 0.30);
        const tip = base.clone().addScaledVector(dir, len);
        const mid = base.clone().addScaledVector(dir, len * 0.5);
        mid.y += rr2(0.01, 0.04);                 // 同样微微上拱
        const c = new THREE.CatmullRomCurve3([base.clone(), mid, tip.clone()]);
        twigs.push(c);
        twigGeos.push(tubeRadiusRamp(
          new THREE.TubeGeometry(c, TW_SEG, 1, TW_RAD, false), c, TW_SEG, TW_RAD,
          s => 0.008 - 0.006 * s));               // 末级枝更细：8mm → 2mm
      }
    }
  }
  const twMesh = new THREE.Mesh(mergeGeometries(twigGeos, false), MAT.trunk);
  twMesh.name = 'peachTwig';
  twMesh.castShadow = true;
  g.add(twMesh);

  /* ── 枯枝挂灯（2026-09-25 · 计划书 Phase 3 第 7 项方案B）────────────────────
     挂在**真实枝条**上：主枝取梢段、小枝取中后段，每处挂一盏下垂的小灯笼。
     挂点用本树自己的 R2 流（rr2）取样 ⇒ 与树形同源。
     ⚠️ 挂灯是**运行期开关**（灯会才显示），但几何在装配时一次建好：count=0 ⇒ three 不提交，
        零 draw call（与紫藤/桃叶的季节通道同一套路，见 12-env 的 applyPresence）。
     ⚠️ 挂灯是 `g` 的**子节点** ⇒ 树的位置/缩放/根盘基准自动继承，不会"灯浮在半空"。
     ⚠️ 这里用的是 rr2（本树私有流），**不碰共享 rnd** ⇒ 布局指纹基线不受影响。 */
  const hangPts = [];
  for (const br of mainBranches){
    const nH = 5 + (i2(3));                       // 主枝 5~7 处
    for (let k = 0; k < nH; k++){
      const t = rr2(0.45, 0.97);                  // 梢段：叶幕挡不到的地方才看得见灯
      hangPts.push(br.getPointAt(t).clone());
    }
  }
  for (const tw of baseTwigs){
    if (rr2(0, 1) < 0.55) continue;               // 一半小枝挂灯：太密会糊成一团
    hangPts.push(tw.getPointAt(rr2(0.45, 0.92)).clone());
  }
  if (hangPts.length){
    const inst = new THREE.InstancedMesh(makeTreeLanternGeo(), MATB.treeLantern, hangPts.length);
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    inst.userData.noMerge = true;                 // 实例色会被几何合并丢掉
    inst.userData.aoSkip = true;                  // 灯自身在发光，不进 GTAO 法线 pass
    inst.name = 'treeLanterns';
    inst.frustumCulled = false;
    const mm = new THREE.Matrix4(), pv = new THREE.Vector3(),
          qq = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1),
          upv = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < hangPts.length; i++){
      pv.copy(hangPts[i]);
      pv.y -= 0.15;                               // 从枝上垂下来（灯顶贴着枝）
      qq.setFromAxisAngle(upv, rr2(0, TAU));      // 每盏自转，避免"一模一样"
      mm.compose(pv, qq, sv);
      inst.setMatrixAt(i, mm);
      inst.setColorAt(i, treeLanternColor(rr2));
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    g.add(inst);
    treeLanternInsts.push(inst);
  }

  /* ── 挂点基建：沿木质枝条按**固定弧长**取样 ──
     枝有多长就有多少挂点，叶/花/果全部挂在这些点上（不再"每枝随机几片"）。
     旧版正是因此常年只挂到 379/600 —— 叶量由随机的枝数决定，`count` 声明 600 从未兑现。
     w = 该点分到的叶量份额：小枝是当年新梢、叶最多，主枝是骨架、只有零星叶。 */
  const woodPts = [];
  const sampleWood = (curve, spacing, w) => {
    const n = Math.max(2, Math.round(curve.getLength() / spacing));
    for (let i = 0; i <= n; i++){
      woodPts.push({ p: curve.getPointAt(i / n), tan: curve.getTangentAt(i / n).normalize(), w });
    }
  };
  for (const tw of twigs) sampleWood(tw, 0.024, 1.0);
  for (const br of mainBranches) sampleWood(br, 0.060, 0.45);

  /* 绕枝轴、方位角 a 的单位向量（用于"叶子朝枝的哪一侧长"） */
  const _perp = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  const aroundAxis = (tan, a) => {
    _pa.copy(_up);
    if (Math.abs(tan.dot(_pa)) > 0.92) _pa.set(1, 0, 0);
    _pb.crossVectors(tan, _pa).normalize();
    _pa.crossVectors(_pb, tan).normalize();
    return _perp.copy(_pa).multiplyScalar(Math.cos(a)).addScaledVector(_pb, Math.sin(a)).normalize();
  };
  /* 确定性打散（乘性散列，不用随机数 → 每次构建结果一致）：
     季节通道是按 `count` 截**前缀**的（春 peachShow=0.15 只显前 15%、秋果 0.7 显前 70%），
     不散开就会出现"春天的嫩叶全挤在头一根枝上""秋天掉的果全在南侧"。
     散开之后任何前缀在空间上都是均匀的。 */
  const spread = (arr) => arr
    .map((o, i) => ({ o, k: (i * 2654435761) % 4294967296 }))
    .sort((a, b) => a.k - b.k)
    .map(x => x.o);
  /* 槽位不够就按轮转从 pool 补足 —— 保证挂满声明数量，不再"声明 600 实挂 379" */
  const fillTo = (arr, target, pool) => {
    for (let i = 0; arr.length < target; i++) arr.push(pool[(i * 37) % pool.length]);
  };

  /* ── 冠层叶幕壳（canopyShell）──
     把叶子按"归一化椭球半径" q = |(p−冠心)/各半轴| 夹进 [SHELL_LO, SHELL_HI]，两个方向都管：
       · q > HI（甩到壳外的散叶）→ 收回壳面。桃冠的**轮廓**是这一层的包络，
         甩出去一片就能把"冠半径"撑大一圈，而门禁是按轮廓内命中率算的 —— 等于自己稀释自己。
       · q < LO（深埋冠心的叶）→ 推到壳内圈，填掉"枝与枝之间的空腔"。
     竖向半轴比水平小（CAN_B/CAN_A≈0.78）：桃是扁圆冠，真实桃的冠高本就小于冠幅，
     旧版叶子只在一条水平带上，正侧看就是"能看穿的煎饼"。 */
  const CAN_A = R;                        // 水平半轴（冠幅半径）
  const CAN_B = R * 0.84;                 // 竖向半轴（杯状骨架的冠比旧版更高瘦一点）
  const SHELL_LO = 0.30, SHELL_HI = 1.0;
  const _cs = new THREE.Vector3();
  /* ⚠️ `outwardOnly`（2026-10-08 · 梅专用）：只把**甩到壳外**的收回壳面，**不把冠内的推出去**。
     为什么：老黄说梅"开成了紫藤那种密集花串" —— 量出来的真因不是朵数，而是这条夹壳把
     **冠内**的花统统推到同一个椭球面上（实测最近邻中位 0.033m ＝ **0.19 倍花径**、
     1500 朵里 1421 朵与邻居挤在半朵之内）。真实梅是"花贴在自己那根枝上"，
     所以梅改成"只收外沿、不动冠内" ⇒ 花沿枝自然分布（间隔＝沿枝点距 0.10~0.22m），
     同时仍保住"不许顶出冠轮廓"这条（叶幕/轮廓由叶子负责）。 */
  const canopyShell = (p, outwardOnly = false) => {
    _cs.copy(p).sub(canopyC);
    const nx = _cs.x / CAN_A, ny = _cs.y / CAN_B, nz = _cs.z / CAN_A;
    const q = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (q < 1e-4) return p;
    const lo = outwardOnly ? 0 : SHELL_LO;
    const s = Math.min(SHELL_HI, Math.max(lo, q));
    if (s === q) return p;
    return p.copy(_cs).multiplyScalar(s / q).add(canopyC);
  };

  /* ── 叶：桃叶互生，短枝上 3~4 片成簇 ── */
  const leafGeo = makePeachLeafGeo();
  const leafN = Math.round(4000 * (opts.leafMul || 1));
  const leafInst = new THREE.InstancedMesh(leafGeo, opts.leafMat || MAT.peachLeaf, leafN);
  leafInst.castShadow = true;
  const leafA = new THREE.Color(0x79B23E), leafB = new THREE.Color(0x44701F);

  const wTot = woodPts.reduce((s, o) => s + o.w, 0);
  const leafRaw = [];
  for (const o of woodPts){
    const n = Math.max(1, Math.round(leafN * o.w / wTot));
    for (let k = 0; k < n; k++) leafRaw.push(o);
  }
  fillTo(leafRaw, leafN, woodPts);
  const leafSlots = spread(leafRaw).slice(0, leafN);

  for (let i = 0; i < leafSlots.length; i++){
    const o = leafSlots[i];
    /* 叶从枝上斜向外上方长出（叶柄极短），方位角按黄金角错开 —— 互生叶序不是并排 */
    const lat = aroundAxis(o.tan, i * 2.39996 + rr2(-0.40, 0.40));
    const leafDir = lat.clone()
      .addScaledVector(_up, rr2(0.05, 0.35))
      .addScaledVector(o.tan, rr2(-0.15, 0.25))
      .normalize();
    _q.setFromUnitVectors(_up, leafDir);                  // 叶几何沿 +Y 生长
    _p.copy(o.p).addScaledVector(leafDir, 0.004);
    /* 冠层被夹进椭球"叶幕"壳层（见 canopyShell）：上下压扁（冠高 < 冠幅）、内外有界。
       这一步同时管两件事：① 把枝间的空隙填上 ② 把个别甩到壳外的叶子收回来 ——
       后者是**判据的必需**：门禁的冠半径取所有叶实例的最大水平半径，一片甩出去的叶
       就能把轮廓撑大一圈，再拿"轮廓内命中率"去除，等于自己稀释自己。 */
    canopyShell(_p);
    /* 叶面朝**冠外偏上**（叶向光）：叶几何的局部 ±Z 是叶面法线，把它对到"冠心→叶"的方向上
       （扣掉沿叶长的分量后正交化）。旧版是绕叶长轴**随机翻卷 0~2π** —— 一半的叶侧对视线
       只剩一条边，整冠读成"炸毛的刺球"，投影面积也白丢一半（门禁的遮挡率量的正是这个）。
       ⚠️ 法线必须与 _up 混合再正交化：纯径向法线会让**背阳那半边**整片发黑
       （实拍样张：冠层变成一颗深色尖刺球）；太阳在 50° 高，叶面偏上才接得到光。 */
    _ax.copy(_p).sub(canopyC).normalize();
    _ax.addScaledVector(_up, 0.85).normalize();
    _ax.addScaledVector(leafDir, -_ax.dot(leafDir));
    if (_ax.lengthSq() > 1e-8){
      _ax.normalize();
      _bx.crossVectors(leafDir, _ax).normalize();
      _q.setFromRotationMatrix(_basis.makeBasis(_bx, leafDir, _ax));
    }
    _q.multiply(_q2.setFromAxisAngle(_up, rr2(-0.55, 0.55)));   // 只留一点翻卷差异，不做全随机
    _s.setScalar(rr2(0.85, 1.25));
    _m.compose(_p, _q, _s); leafInst.setMatrixAt(i, _m);
    leafInst.setColorAt(i, leafA.clone().lerp(leafB, R2())
      .offsetHSL(rr2(-0.02,0.02), rr2(0,0.05), rr2(-0.05,0.05)));
  }
  leafInst.count = leafN;
  leafInst.instanceMatrix.needsUpdate = true;
  if (leafInst.instanceColor) leafInst.instanceColor.needsUpdate = true;
  g.add(leafInst);

  /* ── 花：春季先花后叶 —— 桃的花芽与叶芽同在短枝上（花芽先萌），故与叶同源取样。
     ⚠️ 花量 900 → 2000 → **3000**（2026-09-22 三轮，老黄："桃花再多 50%"）：
     900 朵挂在 2.6m 的冠上，实拍样张里只数得出 ~30 个粉点 —— 代码注释写着"花满树"，
     画面是"零星几朵"，又一处"状态对、画面不对"；2000 朵时近观已读得出满树花，
     再 +50% 是为了**在鸟瞰距离上也成团**（远处单朵只剩 1~2px，靠数量堆出可见的粉色体积）。
     单朵 12 tri，3000 朵 = 3.6 万 tri（全场 1.5M，可忽略）。
     并且花与叶走**同一套 canopyShell 壳层**：桃是**先花后叶**，盛花期冠里没有叶帮忙遮挡，
     花若全埋在枝心的位置就只剩几个点 —— 推到壳层才读得出"满树花"。 */
  const flGeo = opts.flowerGeo || makePeachFlowerGeo();
  const flN = opts.flowerN || 3000;          // 梅传 2000：比桃疏（"疏影横斜"）
  const flInst = new THREE.InstancedMesh(flGeo, opts.blossomMat || MAT.peachBlossom, flN);
  const flA = opts.blossomA || new THREE.Color(0xFFE8F0), flB = opts.blossomB || new THREE.Color(0xF490B4);

  const twigPool = woodPts.filter(o => o.w > 0.9);
  const flRaw = [];
  /* ⚠️⚠️ 花的着生方式（2026-10-08 重写，老黄："梅花开出来紫藤这种花的效果，现实中的梅花不是
     这种密集型开放…把枝条数量和分叉再增加，每条枝条和分叉上的花苞和花朵如截图所示"）：
     旧写法 = 每条小枝 3~5 簇 × 每簇 1~3 朵挂在**同一个点**上（只差 8mm 花梗），
     加上 `fillTo` 又把不足的朵数用轮转重复堆在既有槽位 ⇒ 投影上就是一串一坨（紫藤感）。
     新写法 = **沿枝点花**，与真实梅一致：花单生或 2~3 朵并生于枝节、贴枝、无长梗；
        · 沿每根二级/三级枝按 0.10~0.22m 的**间隔**走（间隔按枝长给，末级枝短就 1~2 个点）；
        · 每个停点先掷一次"**留白**"（22% 跳过）⇒ 出现裸枝段，这正是"疏影横斜"的节奏；
        · 35% 的停点**并生第 2 朵**（真实梅常 2 朵并生，截图里也成对）；
        · 加点用枝长比例算，短枝自然少花、长枝多花（不再"每枝一律 3~5 簇"）。 */
  const pushStop = (curve, t) => {
    flRaw.push({ p: curve.getPointAt(t), tan: curve.getTangentAt(t).normalize(), t });
  };
  for (const tw of twigs){
    const L = tw.getLength();
    let s = rr2(0.04, 0.18) * L;                  // 梢端留一小段裸枝
    while (s < L * rr2(0.86, 1.0)){
      const t = s / L;
      if (rr2(0, 1) > 0.30) pushStop(tw, t);      // 30% 留白（"疏影横斜"的节奏靠这个）
      if (rr2(0, 1) < 0.35) pushStop(tw, Math.min(0.99, t + rr2(0.012, 0.030)));   // 并生（花苞对）
      /* ⚠️ 间距也要**疏密不均**（2026-10-08 二轮：实测"花朵像均匀撒在枝上的图标…疏密不足"）：
         0.10~0.22 → **0.08~0.30**（近的成小簇、远的一段空枝）—— 真实梅就是这样。 */
      s += rr2(0.08, 0.30);
    }
  }
  for (const br of mainBranches){                    // 主枝梢端也开花
    const n = 4 + (i2(4));
    for (let k = 0; k < n; k++){
      const t = rr2(0.55, 0.98);
      flRaw.push({ p: br.getPointAt(t), tan: br.getTangentAt(t).normalize() });
    }
  }
  /* fillTo 只是**兜底**：枝条够多时自然槽位已超过 flN，spread+slice 只做均匀抽稀，不会堆叠。
     ⚠️ 但"够不够多"必须**量**出来（2026-10-08）：自然槽位 < flN 时，fillTo 会按
     `pool[(i*37)%n]` 轮转把同一批点重复塞进来 ⇒ 一个点上落好几朵 ⇒ 投影上就是"花串"
     （老黄："开成紫藤那种效果"的机械原因之一）。所以把两个数挂到网格上，供探针/门禁读。 */
  const flNatural = flRaw.length;
  fillTo(flRaw, flN, twigPool);
  const flSlots = spread(flRaw).slice(0, flN);
  flInst.userData.flDeclared = flN;
  flInst.userData.flNatural = flNatural;
  flInst.userData.flFabricated = Math.max(0, flN - flNatural);   // >0 = 有朵数是"凑"出来的（会堆叠）

  /* ══ 三种状态按比例分（2026-10-08 · 老黄："总归有 60% 左右的花、30% 左右的苞（嫩黄色）、
        还有 10% 左右是开始凋谢的花（花苞枯黄），按这个比例来重新修改两株梅花的造型"）══
     槽位是同一批（`flSlots`，沿枝点生），按**生长顺序**分给三个网格（老黄给的真实梅资料：
     "花苞靠近枝梢，盛开花朵位于中部，凋谢花朵位于较低位置"）：
       打分 k = 1.25×（沿枝位置 t） + 相对冠心的高度 ⇒ 高的=枝梢=**花苞**、低的=**凋谢**、中间=**盛开**。
       打分是确定性的（不抽随机），比例仍是他要的 30/10/60。
     计数全部挂到 userData 上，供门禁直接断言比例（不靠"看图数"）。 */
  const budFrac = opts.budFrac || 0;
  const budN = Math.min(flSlots.length, Math.round(flSlots.length * budFrac));
  const witherN = Math.min(flSlots.length - budN, Math.round(flSlots.length * (opts.witherFrac || 0)));
  const witherCol = opts.witherColor || null;      // 枯黄 / 枯褐（每株一色，由 makePlumTree 给）
  const scored = flSlots.map((o, i) => ({ o, i, k: (o.t || 0) * 1.25 + (o.p.y - canopyC.y) / CAN_B }))
    .sort((a, b) => (b.k - a.k) || (a.i - b.i));
  const budSlots = scored.slice(0, budN);
  const witherSlots = scored.slice(scored.length - witherN);
  const openSlots = scored.slice(budN, scored.length - witherN);
  flInst.userData.flBuds = budN;
  flInst.userData.flWithered = witherN;
  flInst.userData.flOpen = openSlots.length;

  /* 一处放置逻辑，三个网格共用（花 / 凋谢 / 花苞）——避免三份几乎一样的代码各自漂。
     opts: axis('Z'|'Y' 几何的"花盘/苞轴"方向) / droop(凋谢的垂角) / scaleLo-Hi / tint(实例色) */
  const placeBlossoms = (slots, inst, o) => {
    for (let i = 0; i < slots.length; i++){
      const s = slots[i].o;
      const lat = aroundAxis(s.tan, i * 2.39996 + rr2(-0.50, 0.50));
      const face = lat.clone().addScaledVector(_up, rr2(0.35, 0.95)).normalize();
      _p.copy(s.p).addScaledVector(face, rr2(o.stemLo, o.stemHi));
      /* ⚠️ 花与叶**不同**：叶要把冠填满（两个方向都夹进壳层），花要**贴在自己的枝上**
         （只收外沿、冠内不动）—— 否则冠内的花被挤到同一个椭球面上，读成"紫藤式花串"。 */
      canopyShell(_p, opts.flowerOutwardOnly === true);
      /* 朝向要在**夹壳之后**重算（夹壳挪了位置）：朝冠外偏上；花盘是单面卡，朝内就看不见。
         ⚠️ upMix 支持传**区间**：逐朵抽 ⇒ 有的花朝天、有的侧向外（实测"朝向一致"会被读成图标）。 */
      const upMix = Array.isArray(o.upMix) ? rr2(o.upMix[0], o.upMix[1]) : o.upMix;
      face.copy(_p).sub(canopyC).normalize().addScaledVector(_up, upMix).normalize();
      _q.setFromUnitVectors(_ax.set(o.axis === 'Y' ? 0 : 0, o.axis === 'Y' ? 1 : 0, o.axis === 'Y' ? 0 : 1), face);
      _q.multiply(_q2.setFromAxisAngle(_ax, rr2(0, TAU)));          // 绕自身轴自转（不整齐划一）
      if (o.droop){                                                // 凋谢：整朵往下垂
        _q2.setFromAxisAngle(_ax.set(1, 0, 0), rr2(o.droop[0], o.droop[1]));
        _q.multiply(_q2);
      }
      _s.setScalar(rr2(o.scale[0], o.scale[1]));
      _m.compose(_p, _q, _s); inst.setMatrixAt(i, _m);
      inst.setColorAt(i, o.color());
    }
    inst.count = slots.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    g.add(inst);
  };

  /* ① 盛开（60%）：花色随机深浅 + 轻微色相/明度抖动；
        ⚠️ 尺度/朝向**要散开**（2026-10-08 二轮，实测判读"形状雷同、大小接近、朝向一致、
        平贴枝条 ⇒ 像均匀撒在枝上的图标"）：尺寸 0.85~1.20 → **0.72~1.35**，
        花盘抬升混合系数 upMix 也逐朵抽（0.25~1.15）⇒ 有的朝天、有的侧向外。 */
  placeBlossoms(openSlots, flInst, {
    axis: 'Z', upMix: [0.25, 1.15], stemLo: 0.010, stemHi: 0.045, scale: [0.85, 1.35],
    color: () => flA.clone().lerp(flB, R2()).offsetHSL(rr2(-0.03, 0.03), rr2(0, 0.06), rr2(-0.03, 0.04)),
  });
  /* ② 凋谢（10%）：**自己的几何**（花瓣短一档 + 向下折 53°~65°、只 4 片、雄蕊外露）+
     **自己的材质**（花瓣材质那层红自发光会把枯色盖掉 ⇒ 凋花照样鲜红，实测判读"看不出是枯萎花"）
     + 颜色往枯黄/枯褐压 + 整朵再往下垂。 */
  if (witherN > 0){
    const wInst = new THREE.InstancedMesh(makePlumWitheredGeo(), MAT.plumWithered, witherN);
    wInst.name = 'plumWithered';
    wInst.castShadow = false;
    wInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    placeBlossoms(witherSlots, wInst, {
      axis: 'Z', upMix: [0.10, 0.45], stemLo: 0.014, stemHi: 0.050, scale: [0.85, 1.05], droop: [0.45, 0.90],
      color: () => {
        const c = flA.clone().lerp(flB, R2()).offsetHSL(rr2(-0.03, 0.03), rr2(0, 0.06), rr2(-0.03, 0.04));
        return witherCol ? c.lerp(witherCol, rr2(0.70, 0.92)) : c;      // 往枯黄/枯褐压（比上一版更狠）
      },
    });
    witheredMeshes.push(wInst);
  }
  /* ③ 花苞（30%）：独立几何 + 独立材质（花瓣材质带花瓣 alpha 贴图，套在球上会被裁破）。
     嫩色调 = 往花色的**浅端**（blossomA）靠并提亮（老黄要的"嫩黄色"）。 */
  if (opts.budMat && budN > 0){
    const budInst = new THREE.InstancedMesh(makePlumBudGeo(), opts.budMat, budN);
    budInst.name = 'plumBuds';
    budInst.castShadow = false;
    budInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    placeBlossoms(budSlots, budInst, {
      axis: 'Y', upMix: 1.05, stemLo: 0.004, stemHi: 0.026, scale: [0.85, 1.05],
      color: () => flA.clone().lerp(flB, R2() * 0.45)
        .offsetHSL(rr2(-0.02, 0.02), rr2(0.02, 0.10), rr2(0.02, 0.10)),   // 嫩：偏浅端 + 提亮
    });
    budMeshes.push(budInst);
  }

  /* ⚠️ 梅（opts.noFruit）**不挂桃**：株形骨相可以借桃的骨架，果实不能借 ——
     一棵"梅树"上挂着蜜桃是硬伤。整块跳过（该函数只用私有随机流 rr2/R2，
     跳过不会影响全局布局流，也不会影响别的树）。 */
  if (!opts.noFruit){
  /* ── 果：夏结秋疏。桃的果实着生在短枝上，果柄短、稍下垂（果尖＝花端朝外下方）。
     果量 130（旧 80 上限实测只挂到 64）。 */
  const frGeo = makePeachFruitGeo();
  const frN = 130;
  const frInst = new THREE.InstancedMesh(frGeo, MAT.peachFruit, frN);
  const frA = new THREE.Color(0xF2B36A), frB = new THREE.Color(0xD9635A);

  const frRaw = [];
  for (const tw of twigs){
    const n = 1 + (i2(2));                 // 每条小枝 1~2 个
    for (let k = 0; k < n; k++){
      const t = rr2(0.25, 0.90);
      frRaw.push({ p: tw.getPointAt(t), tan: tw.getTangentAt(t).normalize() });
    }
  }
  for (const br of mainBranches){                    // 主枝中段也留几个
    for (let k = 0; k < 3; k++){
      const t = rr2(0.45, 0.85);
      frRaw.push({ p: br.getPointAt(t), tan: br.getTangentAt(t).normalize() });
    }
  }
  fillTo(frRaw, frN, twigPool);
  const frSlots = spread(frRaw).slice(0, frN);

  for (let i = 0; i < frSlots.length; i++){
    const o = frSlots[i];
    const lat = aroundAxis(o.tan, i * 2.39996 + rr2(-0.60, 0.60));
    const fruitDir = lat.clone().addScaledVector(_up, -0.85).normalize();
    _q.setFromUnitVectors(_up, fruitDir);          // 果几何 +Y（果尖）朝外下方
    _q.multiply(_q2.setFromAxisAngle(_up, rr2(0, TAU)));
    _p.copy(o.p).addScaledVector(fruitDir, 0.015);  // 果柄
    _s.set(rr2(0.85, 1.15), rr2(0.90, 1.10), rr2(0.85, 1.15));
    _m.compose(_p, _q, _s); frInst.setMatrixAt(i, _m);
    frInst.setColorAt(i, frA.clone().lerp(frB, rr2(0.30, 0.90))
      .offsetHSL(rr2(-0.02,0.02), rr2(0,0.05), rr2(-0.04,0.03)));
  }
  frInst.count = frN;
  frInst.instanceMatrix.needsUpdate = true;
  if (frInst.instanceColor) frInst.instanceColor.needsUpdate = true;
  g.add(frInst);
  }

  /* ⚠️ 梅（opts.noFruit）也**不撒桃瓣**：地面那层粉瓣是"桃的落花"，梅的落花另有颜色与时机
     （而且冬天落花会被积雪盖住、做了也看不见）。同样是整块跳过。 */
  if (!opts.noFruit){
  /* 落花铺地（春末夏初 · 树干四周散一层粉瓣）260 片。
     槽位先算好再打散：春季 peachPetalShow=0.3 / 夏 0.45 是 12-env 按 count 截**前缀**的，
     不打散就会"花瓣只落在一个扇形里"。 */
  const petalGeo = new THREE.PlaneGeometry(0.075, 0.11);
  const petalN = 260;
  const petalInst = new THREE.InstancedMesh(petalGeo, MAT.peachPetal, petalN);
  const pcA = new THREE.Color(0xF7C7D4), pcB = new THREE.Color(0xE796AE);
  const petalRaw = [];
  for (let i = 0; i < petalN; i++){
    petalRaw.push({ a: rr2(0, TAU), d: R * rr2(0.15, 0.95),
                    y: rr2(0.012, 0.05), ry: rr2(0, TAU), rx: rr2(-0.4, 0.4), s: rr2(0.7, 1.4) });
  }
  spread(petalRaw).forEach((o, i) => {
    _p.set(Math.cos(o.a) * o.d, o.y, Math.sin(o.a) * o.d);
    _q.setFromEuler(_e.set(Math.PI / 2, o.ry, o.rx));
    _s.setScalar(o.s);
    _m.compose(_p, _q, _s); petalInst.setMatrixAt(i, _m);
    petalInst.setColorAt(i, pcA.clone().lerp(pcB, R2()));
  });
  petalInst.count = petalN;
  petalInst.instanceMatrix.needsUpdate = true;
  if (petalInst.instanceColor) petalInst.instanceColor.needsUpdate = true;
  g.add(petalInst);
  }

  g.userData.peachTree = true;
  return g;
}

/* ══ 梅（2026-10-06 · 老黄："院内布景是否也讲究梅兰竹菊…在院子里加两株梅花，一株腊梅一株红梅，
      给冬天增加一点色彩，特别是'银装素裹'的场景下就会显得非常有生机"）═════════════════
   做法：**借桃的骨架、换花**。梅与桃是蔷薇科同族小乔木，都是"先花后叶、花缀满枝"，
   低分叉杯状骨架 + 花沿小枝簇生这套形制完全通用；差别只在花色、花期与"不挂果"。
   ⇒ 调用 makePeachTree 并传 opts：
      · blossomMat = MAT.plumBlossomRed / plumBlossomYellow（红梅 / 腊梅）；
      · flowerN 2000（梅比桃疏，"疏影横斜"，太满读成桃）；
      · 花色区间偏"单色深浅"而不是桃那种粉白渐变（红梅=胭脂→水红，腊梅=蜡黄→浅黄）；
      · noFruit = true（不挂桃、不撒桃瓣）。
   花期由季节通道 plumBlossomShow 控制（冬 1.0 / 春 0.55 / 秋 0.15 / 夏 0）——
   ⚠️ 冬 1.0 是这条需求的全部意义：**"银装素裹"里唯一的彩色**。
   ⚠️ 梅的骨相（主干/主枝/小枝）照旧进 mergeStatics（冬天叶落也不消失 ⇒ "疏影横斜"的枝条在）。
   位置由调用方给（见 08-assemble 的梅树落点，那里有射线实测的说明）。 */
export function makePlumTree(x, z, scale = 1, baseY = 0, kind = 'red'){
  const red = kind !== 'yellow';
  return makePeachTree(x, z, scale, baseY, {
    noFruit: true,
    blossomMat: red ? MAT.plumBlossomRed : MAT.plumBlossomYellow,
    /* ⚠️ 花型换掉（老黄："红梅的花型也不对"）：用 makePlumFlowerGeo ——
       大而平展的五瓣 + 明显花蕊（桃是深碗小瓣，两者远看不再是一回事）。 */
    flowerGeo: makePlumFlowerGeo(),
    /* ⚠️⚠️ 朵数沿革：5000 → 1200 → 800 → 1500 → 700 → **320**（2026-10-08 第三轮收口）。
       前几轮都在"加朵数"，老黄 2026-10-08 指出真问题是**形态**："梅花开出来紫藤这种花的效果，
       现实中的梅花不是这种密集型开放…把枝条数量和分叉再增加，每条枝条和分叉上的花苞和花朵
       如截图所示"。
       量出来的硬约束（两轮实测）：本项目单朵花是**夸张尺寸**。要让"花-枝比例"像真实梅
       （参考图：覆盖率约三成、花间有裸枝），在 2.7m 冠幅上只需 ~200~350 朵；
       朵数一多，花必然互相叠（700 朵时冠心仍连成红块、1420/1500 朵时最近邻只有 0.19 倍花径）。
       ⇒ 取 **320 朵**（≈ 冠部投影三成覆盖 ⇒ 疏枝点花）+ **枝条网络 1700+ 根**
         （繁茂感来自枝，不来自花量）+ **远处按距离放大 2.6 倍**保住"看得见花色"。
       ⚠️ 这个数只吃本函数的**私有流**（rr2/R2/i2）—— `makePeachTree` 函数体内**零**全局
         `rr()/rnd()/Math.random`（已核）⇒ 改朵数**不会**动全园布局；但它会改这株梅的实例条数
         ⇒ layout-fingerprint 需要**重出基线**（这是有意的布局变更，不是漂）。 */
    flowerN: 320,    /* ⚠️ 树形与桃**反着调**（老黄："远看会觉得就是同一种树，这个肯定不对"）：
       桃 = 矮胖圆球（H≈4.2、冠幅 1.25H、叶满）；梅 = 高挑疏朗（H×1.35、冠幅 **0.85H**、
       叶量 **0.65**）⇒ 梅的暗色枝干骨架露出来，正是"疏影横斜"，远看轮廓也完全不同。
       ⚠️ twigMul / subTwig（2026-10-08）：梅要**更多枝条与分叉**承载"每条枝上点几朵花"，
       否则花只能堆在少数枝上、读成紫藤。桃不传这两个键 ⇒ 桃树逐字不变。 */
    heightMul: 1.35, canopyMul: 0.85, branchMul: 1.30, leafMul: 0.65,
    twigMul: 2.2, subTwig: true, longTwig: true, flowerOutwardOnly: true,
    /* ── 三种状态的比例（2026-10-08 老黄："总归有 60% 左右的花、30% 左右的苞（嫩黄色）、
          还有 10% 左右是开始凋谢的花（花苞枯黄），按这个比例来重新修改两株梅花的造型"）──
       槽位总数仍 320（`flowerN`）：30% 分给花苞（独立几何/材质），其余 70% 里再切 1/7
       （= 全树 10%）做凋谢。⇒ 实际 60% 盛开 / 30% 花苞 / 10% 凋谢。 */
    budFrac: 0.30, witherFrac: 0.10, budMat: MAT.plumBud,
    /* 凋谢色（每株一色）：腊梅的枯花是**枯黄**、红梅的枯花是**枯褐红** ——
       都往"褪色发暗"那一头压，与盛开的花一眼分得开。
       ⚠️ 腊梅这头跟着"调黄"一起走：0xA8842E（偏褐金）→ 0xBBA52E（枯黄偏绿）。 */
    witherColor: new THREE.Color(red ? 0x8A5238 : 0xBBA52E),
    /* 干/枝与叶也各换一份材质：梅的树皮更冷更暗（灰褐），叶更墨绿 —— 远看的整体色调就分开了。 */
    trunkMat: MAT.plumTrunk, leafMat: MAT.plumLeaf,
    /* 花色（老黄："腊梅是淡黄色到黄色"；2026-10-08 二次："腊梅的花朵的颜色再黄一些，
       这个颜色感觉有点偏金色，不是黄色"）：
       红梅 = 暖胭脂 → 正红（上一版偏"紫红/暗粉" ⇒ 压掉蓝通道）；
       腊梅 = 淡黄 → **正黄**：金色是"红多绿少"（h≈45° 偏橙），黄色要"红≈绿、蓝低"（h≈55°）
       ⇒ 旧值 0xF0A400（琥珀金）换成 **0xFFDD22**（正黄）、浅端 0xFFF0A8 → **0xFFF8C8**。
       冬季预设会降饱和 0.70 + 冷色调，所以两头各留一点余量。 */
    blossomA: new THREE.Color(red ? 0xFF7A6E : 0xFFF8C8),
    blossomB: new THREE.Color(red ? 0xDC1220 : 0xFFDD22),
  });
}

/* ══ 廊下兰草（2026-10-06 · 老黄："在廊下补一小丛兰草（或盆栽兰）"）═════════════════════
   凑"梅兰竹菊"的最后一笔。取"**盆栽兰**"（廊下本来就有缸/盆一类陈设，最省事也最不出错）：
     · 花盆：两级陶盆 + 口沿圈（深陶色）；
     · 叶：复用 `makeReedBladeGeo()` —— 它本来就是"根部直立、梢部外弯"的弧叶，正是兰叶的形；
       9 片绕心放射，朝向/长度/倾角全部吃**本函数私有流**（不动全局 rnd/rr，铁律 1）；
     · 花葶：3 根细杆挑出盆沿、顶端各 2~3 朵米黄小花（远看就是"兰开花了"）。
   开销：1 个 InstancedMesh（叶）+ 一小组普通 Mesh，只多一次提交级别的成本。
   ⚠️ 落点高度必须由调用方按**实测地表**给（见 08 的注释）：廊下是台基/铺装，不是地形，
     用 groundHeight 会把盆陷进台基里。 */
export function makeOrchidPot(x, z, baseY = 0){
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const R3 = mulberry32(((Math.round(x * 1000) * 2654435761) ^ (Math.round(z * 1000) * 40503)) >>> 0);
  const potLow = mesh(new THREE.CylinderGeometry(0.115, 0.095, 0.075, 12), MAT.stoneDark, { name:'orchidPotLow', cast:true });
  potLow.position.y = 0.0375; g.add(potLow);
  const potUp  = mesh(new THREE.CylinderGeometry(0.135, 0.115, 0.085, 12), MAT.stoneDark, { name:'orchidPotUp', cast:true });
  potUp.position.y = 0.1175; g.add(potUp);
  const potRim = mesh(new THREE.CylinderGeometry(0.146, 0.140, 0.022, 12), MAT.stoneDark, { name:'orchidPotRim', cast:true });
  potRim.position.y = 0.168; g.add(potRim);
  const leafGeo = makeReedBladeGeo(0.52);
  const leaves = new THREE.InstancedMesh(leafGeo, MAT.reed, 9);
  const lq = new THREE.Quaternion(), lq2 = new THREE.Quaternion(), lp = new THREE.Vector3(),
        ls = new THREE.Vector3(), lm = new THREE.Matrix4(), AY = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 9; i++){
    const a = (i / 9) * TAU + R3() * 0.5;
    const lean = 0.20 + R3() * 0.22;
    lp.set(Math.cos(a) * 0.05, 0.155, Math.sin(a) * 0.05);
    lq.setFromAxisAngle(AY, -a);
    lq2.setFromAxisAngle(AX, lean);
    lq.multiply(lq2);
    ls.setScalar(0.85 + R3() * 0.5);
    lm.compose(lp, lq, ls); leaves.setMatrixAt(i, lm);
  }
  leaves.instanceMatrix.needsUpdate = true;
  leaves.castShadow = false; leaves.receiveShadow = true;
  g.add(leaves);
  /* 花葶复用腊梅的米黄瓣材质（同为淡黄小花，省一份材质；它已在 SEASON_PRESENCE 里，
     冬天 plumBlossomShow=1 时兰也在开 —— 与兰的花期（冬春）正好一致）。 */
  for (let k = 0; k < 3; k++){
    const a = 0.7 + k * 2.1 + R3() * 0.4, lean = 0.16 + R3() * 0.18, h = 0.44 + R3() * 0.16;
    const stem = mesh(new THREE.CylinderGeometry(0.006, 0.009, h, 5), MAT.reed, { name:'orchidStem', cast:false });
    stem.position.set(Math.cos(a) * 0.05, 0.16 + h / 2, Math.sin(a) * 0.05);
    stem.rotation.set(lean * Math.sin(a), 0, -lean * Math.cos(a));
    g.add(stem);
    for (let j = 0; j < 3; j++){
      const f = mesh(new THREE.SphereGeometry(0.022, 7, 6), MAT.plumBlossomYellow, { name:'orchidFlower', cast:false });
      f.position.set(stem.position.x * (1 + j * 0.5), 0.16 + h * (0.72 + j * 0.12), stem.position.z * (1 + j * 0.5));
      g.add(f);
    }
  }
  return g;
}

/* 芭蕉果串（重建）：真实香蕉束 —— 冠部斜出的粗果轴 + 5 圈"把"（hand），每圈一圈
   新月形蕉指（指根朝上、凹面内扣贴轴、五棱截面），束末一颗紫红花苞。
   旧版是"8 根直柱子围一根芯"—— 与真实果串毫无关系（用户原话："香蕉长什么样你比我更清楚"）。
   蕉指 = 圆环弧管 InstancedMesh + instanceColor 青→黄（上圈更熟下圈更生）。 */
function makeBananaFruit(x, y, z){
  const g = new THREE.Group();
  g.position.set(x, y, z);

  // 果轴：自挂点斜出再垂下（真实蕉束都从冠里斜着扎出来）
  const stalkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.05, -0.09, 0.02),
    new THREE.Vector3(0.025, -0.27, 0.01),
    new THREE.Vector3(0, -0.45, 0),
  ]);
  g.add(mesh(new THREE.TubeGeometry(stalkCurve, 10, 0.030, 6, false), MAT.bambooB, { name:'fruitStalk', cast:false }));

  // 蕉指几何：环弧段（弧长 ≈14cm、管径 2cm、5 棱 —— 真实香蕉截面正是五棱）。
  // 平移使弧起点落在原点：指根在原点、指尖向 +Y 上弯、凹面朝 −X（实例时 −X 对轴心）。
  const fGeo = new THREE.TorusGeometry(0.11, 0.020, 5, 7, 1.30);
  fGeo.translate(-0.11, 0, 0);

  const hands = [11, 10, 9, 7, 5];                    // 每圈指数：上密下疏（真实束形收势）
  const ripeC = new THREE.Color(0xE0CC58), greenC = new THREE.Color(0x8FAF52);
  const fingers = [];
  for (let hi = 0; hi < hands.length; hi++){
    const kTier = hi / (hands.length - 1);
    const tp = stalkCurve.getPoint(0.22 + 0.78 * kTier);
    const ringR = 0.062 - 0.026 * kTier;              // 圈径向束末渐收
    const lenS = 1.0 - 0.34 * kTier;                  // 指长向束末渐短
    for (let k = 0; k < hands[hi]; k++){
      const a = (k / hands[hi]) * TAU + hi * 0.35 + rr(-0.08, 0.08);   // 层间错角
      fingers.push({
        x: tp.x + Math.cos(a) * ringR, y: tp.y, z: tp.z + Math.sin(a) * ringR,
        yaw: a, rx: rr(-0.10, 0.10), rz: rr(-0.10, 0.10),
        s: lenS * rr(0.88, 1.14),
        c: ripeC.clone().lerp(greenC, kTier).offsetHSL(rr(-0.01, 0.01), rr(-0.05, 0.03), rr(-0.03, 0.03)),
      });
    }
  }
  const inst = new THREE.InstancedMesh(fGeo, MAT.bananaFruit, fingers.length);
  inst.castShadow = false;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
  fingers.forEach((f, i)=>{
    p.set(f.x, f.y, f.z);
    q.setFromEuler(new THREE.Euler(f.rx, f.yaw, f.rz));
    sv.setScalar(f.s);
    m.compose(p, q, sv); inst.setMatrixAt(i, m);
    inst.setColorAt(i, f.c);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  g.add(inst);

  // 束末花苞：紫红卵形蕉蕾
  const bud = mesh(new THREE.SphereGeometry(0.035, 9, 7), MAT.bananaBud, { name:'fruitBud', cast:false });
  bud.scale.set(0.78, 1.45, 0.78);
  const tip = stalkCurve.getPoint(1);
  bud.position.set(tip.x, tip.y - 0.055, tip.z);
  g.add(bud);
  return g;
}

/* 芭蕉：高假茎（叶鞘包裹）+ 顶部叶片（GLB 模型）+ 可选蕉果 */
/* ══ 芭蕉叶片·程序化替身（2026-09-27 · 用户拍板：替身必须"像那棵树"）══════════
   触发条件：`assets/BananaPlant.glb` 下载/解码失败。它在预载清单里是 **required:false**，
   所以失败不会阻断开园 —— 但**什么都不做的话会留下一根 3.6m 高的光杆**（假茎在，
   冠层空），比"没有芭蕉"更难看：用户看到的是一排电线杆。
   所以这里补一棵**真的叶片**。
   ── 为什么要单独写，而不是复用 makeReedBladeGeo ──────────────────────────────
   芦苇叶是**窄、直、挺**的（半宽 0.045m，7 段），芭蕉叶是**宽、垂、有主脉**的
   （半宽 ~0.42m）。直接拿芦苇叶当替身会得到"一根 3.6m 的细草"，形态完全不对 ——
   替身的第一要求是**远看认得出那是什么**，不是"有个绿色的东西"。
   ── 形态 ──────────────────────────────────────────────────────────────────
   芭蕉叶是**掌状**：一片大叶从假茎顶端伸出，叶柄直立一小段，然后叶面**向外下垂**。
   这里按 3~4 片扇形排开，每片：叶柄（细圆柱，略带倾角）+ 叶身（自定义 BufferGeometry，
   沿叶长 8 段，宽度按 sin 形起落 → 中段最宽、叶尖收成点、叶基收成柄）。
   叶身分两半（左右各带一点下垂）用**沿脊的 V 折**近似主脉：这是让平片叶子
   在侧光下"读得出叶脉"的关键，纯平面看起来像塑料布。
   ⚠️ 走 CFG.rnd（00-config 的全局唯一实例），绝不用共享 Math.random（铁律 1）。 */
function makeBananaLeafGeo(len = 2.1, wid = 0.82, seg = 8, droop = 0.55){
  const verts = [], idx = [], uvs = [];
  for (let i = 0; i <= seg; i++){
    const t = i / seg;                       // 0 = 叶基(接柄) → 1 = 叶尖
    /* 宽度包络：叶基 ~0.18 宽 → 中段最宽 → 叶尖收成 0。用 sin^0.7 让"最宽处"略偏叶基，
       符合芭蕉叶的实际轮廓（基部窄、中前段最宽、尾端急收）。 */
    const env = Math.pow(Math.sin(Math.pow(t, 0.72) * Math.PI), 0.7);
    const w = wid * 0.5 * (0.18 + 0.82 * env);
    /* 沿叶长的下垂：前 25% 还是直的（叶柄段），之后按 (t-0.25)^1.6 加速往下弯。
       指数 >1 是关键：线性下垂会像挂面条，指数下垂才像被自重压弯的阔叶。 */
    const bend = t < 0.25 ? 0 : Math.pow((t - 0.25) / 0.75, 1.6) * droop * len;
    const y = len * t - bend;
    /* V 折主脉：中心比两侧高一点（沿叶长逐渐加强），侧光下才有叶脉的明暗。 */
    const keel = 0.055 * wid * Math.sin(t * Math.PI);
    verts.push(-w, y, -keel,  0, y + keel, 0,  w, y, -keel);
    uvs.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < seg; i++){
    const a = i * 3, b = a + 3;
    idx.push(a, b, a + 1,  a + 1, b, b + 1);      // 左半
    idx.push(a + 1, b + 1, a + 2,  a + 2, b + 1, b + 2);  // 右半
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* 冠层替身：假茎顶端扇形排 3~4 片大叶。锚点 y=0（贴在 holder 上）。
   ⚠️ 与 GLB 路径的差别：GLB 走 loadAssetOnce 的"底部对齐"再由外层 holder 上移，
   替身**直接就是底部对齐**，所以调用方给的 holder.position.y 就是叶基高度。
   ⚠️⚠️ **随机源必须独立**（铁律 1 + 布局指纹铁律）：这里**绝不能**吃共享 `rnd()`。
   芭蕉替身只在"资产失败"时触发 —— 也就是它的调用次数**取决于网络**。
   吃共享流的话，失败一次就把整园后续所有 rr()/rnd() 抽样整体后移，
   layout-fingerprint 基线当场漂移（正是 L564 那条禁令治的病）。
   改用 `mulberry32(BANANA_SEED + 株高)` 派生的独立流：同样可复现，且与布局流正交。 */
const BANANA_SEED = 0x5A1A6A;
export function makeBananaLeafCrown(leafScale = 1.0, trunkH = 2.8){
  const crown = new THREE.Group();
  const brnd = mulberry32(BANANA_SEED + Math.round(trunkH * 1000));
  const n = 3 + Math.floor(brnd() * 2);        // 3 或 4 片
  for (let i = 0; i < n; i++){
    const len = (1.75 + brnd() * 0.75) * leafScale;
    const wid = (0.70 + brnd() * 0.30) * leafScale;
    const leaf = new THREE.Mesh(
      makeBananaLeafGeo(len, wid, 8, 0.5 + brnd() * 0.2),
      MAT.banana);                                 // 假茎/叶片同材质 → 顺带被假茎的风场带着走
    /* 扇形排布：绕 Y 均匀铺开，pitch 越大越水平（芭蕉老叶接近水平外伸），
       第 0 片稍微立一点当"新叶"（用户常识：芭蕉心叶是竖着卷起来的）。 */
    const yaw = i / n * TAU + brnd() * 0.28;
    const pitch = (i === 0 ? -0.42 : 0.16 + brnd() * 0.34);
    leaf.rotation.set(pitch, yaw, (brnd() - 0.5) * 0.22, 'YXZ');
    leaf.castShadow = true; leaf.receiveShadow = true;
    leaf.userData.noMerge = true;                  // 异步挂载 ⇒ 不参与几何合并
    crown.add(leaf);
  }
  /* 替身也标一下，方便探针/门禁区分"GLB 来的"与"程序化来的" */
  crown.userData.substitute = 'banana-leaf';
  return crown;
}

/* 芭蕉叶片 URL 常量：预载清单与替身钩子都要用它 —— 写成字面量会出现两处不同拼写，
   而替身钩子靠**字符串相等**匹配，错一个字符 ⇒ 替身永远不触发（静默失效，
   正好是这一段要治的病）。 */
const BANANA_URL = 'assets/BananaPlant.glb';

export function makeBananaPlant(x, z, trunkH = 2.8, leafScale = 1.0, withFruit = false, ry = 0){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  /* ⚠️ 假茎与叶鞘必须留在植株组里、并且**不参与全局合并**：
     mergeStatics 会按材质把它们搬到世界级的 mergedStatic 上，于是冬季 applyGLBSeason
     缩放植株组时只缩到 GLB 叶片，假茎/叶鞘/蕉果保持原尺寸 ——
     看起来就是"小叶簇顶在一根全尺寸杆上 + 一颗全尺寸蕉果"。
     为了不把 draw call 摊开，先把"假茎 + 6 圈叶鞘"在植株内部合成**一个**几何体
     （每株 +1 个网格），再打上 noMerge。 */
  const trunkParts = [];
  {
    const tg = new THREE.CylinderGeometry(0.13, 0.16, trunkH, 9);
    tg.translate(0, trunkH / 2, 0);
    trunkParts.push(tg);
    const sg = new THREE.CylinderGeometry(0.145, 0.175, 0.13, 9);
    for (let i = 0; i < 6; i++){
      const c = sg.clone();
      const k = 1 - i * 0.045;
      c.scale(k, 1, k);
      c.translate(0, trunkH * (0.1 + i * 0.17), 0);
      trunkParts.push(c);
    }
  }
  const trunk = mesh(mergeGeometries(trunkParts, false), MAT.banana, { name:'bananaTrunk' });
  trunk.userData.noMerge = true;
  g.add(trunk);
  /* 冠层组（叶 GLB + 果）：芭蕉是多年生草本 —— 冬季地上部枯萎但**假茎宿存**，
     所以随季节缩放/隐藏的是冠层组，假茎永远全尺寸留在原地（第九轮用户常识反馈：
     旧版整株缩到 12% = 把多年生当一年生）。applyGLBSeason 通过 userData.crown 找到它。 */
  const crown = new THREE.Group();
  g.add(crown);
  // 顶部叶片（GLB，随假茎高度上移）
  /* ⚠️ **失败必须补替身**（2026-09-27）：BananaPlant.glb 在预载清单里是 required:false，
     失败不阻断开园 —— 但冠层空着就只剩一根 trunkH 高的**光杆**（默认 2.8m，
     高配档 3.6m），一排"电线杆"比没有芭蕉更难看。
     判据必须**先断言前提**再分支（铁律 4）：这里断的是
       ① 替身确实是"叶片"而不是空 group（crown.children.length > 0）；
       ② 替身叶片数量与 GLB 冠层同一量级（3~4 片），不是 1 片充数；
       ③ 替身挂在 crown 上（跟着季节缩放/隐藏），不是散落在 g 上。
     挂在 crown 而不是 g：applyGLBSeason 靠 userData.crown 找冠层，
     挂错地方 ⇒ 冬季整株被缩到 12%，把多年生当一年生（第九轮的老教训）。 */
  const attachLeaf = (obj) => {
    const holder = new THREE.Group();
    holder.position.y = trunkH - 0.25;
    holder.add(obj);
    crown.add(holder);
    HOOKS.onAssetAttached?.();
  };
  let bananaLeafOk = false;
  loadAssetOnce('assets/BananaPlant.glb', 3.8 * leafScale, (src)=>{
    bananaLeafOk = true;    /* ⚠️ 同 placeAssets：摆放要放外层 holder。直接写 c.position.y 会**覆盖**
       loadAssetOnce 写的"底部对齐"偏移（B08 的同一处病，只是换了个调用点）。 */
    const leaf = src.clone(true);
    /* ── 叶片进风场（2026-09-17 用户："芭蕉树应该是叶子晃动，现在的晃动有问题"）──
       GLB 叶片是**异步**挂载：它在 mergeStatics 之后才进场景，因此逃过了几何合并，
       但材质也仍是 GLB 自带的 —— 从来没登记进风场表，狂风里叶子纹丝不动。
       之前"动"的其实是假茎，而且 crown 模式把根部权重算成最大，于是整根假茎从土里
       开始钟摆式甩动。动错了对象 + 权重反了，两个 bug 叠在一起。
       这里给每株**克隆一份材质**再注入：必须克隆，因为 8 株的栽植高度 trunkH 各不相同，
       而 tip 模式的基准高度是写进 shader 的常量 —— 共享材质只能取一个值。
       tip 模式锚在叶片根部（trunkH-0.25）：叶柄几乎不动、叶尖按高度逐渐加大摆幅，
       正是"芭蕉大叶被风掀起又落下"的样子。
       ── 幅度两轮定标（2026-09-17）──
       第一轮 amp 0.13：反算 ampEff = 0.13 × wt(叶尖 1.52) × storm 乘数 2.26 ≈ 0.45m，
       用户第二轮反馈"夸张到极致了" —— 对 3.8m 叶丛等于把叶尖甩出 12% 株高，是抽搐不是风。
       降到 amp 0.05 → ≈ 0.17m（约 4.5% 株高，读作大叶被风掀起），并补 maxDisp 0.22
       硬上限：反算够不等于永远够，将来 amp 被调大一档也不会破防。 */
    leaf.traverse(o => {
      if (!o.isMesh || !o.material) return;
      o.material = o.material.clone();
      addWind(o.material, 0.05, 1.05, 'tip', trunkH - 0.25, 0.22);
    });
    attachLeaf(leaf);
  });
  /* ⚠️ **不能**用 `loadAssetOnce(...).catch()`：它 fire-and-forget，**没有返回值**
     （实测 L1414 那个 .catch 属于 rawCache 的那条链，不在 loadAssetOnce 的返回上）。
     正确做法是挂 `HOOKS.settleAssetFail` —— 13-preload 在 settleAsset(url,false) 时
     调它，那才是"这个 URL 确实失败了"的唯一权威信号（铁律 4：判据先取权威源）。
     守卫：bananaLeafOk 为真说明已经挂上 GLB 了（缓存命中的同步路径会立刻置真），
     此时若再补替身会出现"两副叶子" ⇒ 必须先断言前提再动手。 */
  const offFail = onAssetFailed(BANANA_URL, () => {
    if (bananaLeafOk) return;
    const sub = makeBananaLeafCrown(leafScale, trunkH);
    sub.traverse(o => {
      if (!o.isMesh) return;
      /* 替身叶片也要进风场，基准高度与 GLB 路径同一锚点（叶基）⇒ 风和真叶一致。 */
      o.material = o.material.clone();
      addWind(o.material, 0.05, 1.05, 'tip', trunkH - 0.25, 0.22);
    });
    attachLeaf(sub);
  });
  if (offFail) g.userData.__bananaOffFail = offFail;
  // 蕉果：挂在假茎顶端偏一侧
  if (withFruit){
    const fr = makeBananaFruit(0, trunkH - 0.15, 0.26);
    fr.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });   // 同上：要跟着冠层缩放
    crown.add(fr);
  }
  g.userData.crown = crown;
  return g;
}

/* 莲蓬与荷池生态（重建）：单株 = S 弯茎 + 微倾莲房（黄金角 17 籽孔）+ 邻位浮叶 2~3 片
   + 随机伴生荷花/花蕾。旧版"一根直杆+绿点"被用户判"孤零零、脱离生态"。
   籽孔特征 = 明暗对比：每籽一盏深橄榄"凹窝"（暗杯）+ 浅色微凸莲子，
   莲房顶面的孔洞结构在岸边视距就可读；三成老蓬走黄褐材质。 */
export function makeLotusPod(x, z, h = 0.85){
  const g = new THREE.Group();
  g.position.set(x, CFG.water, z);

  // S 弯茎：自水里带自然倾侧（第二验收轮：偏移量 ×1.7 —— 20cm 才能在岸边读出弯）
  const bend = rr(-0.20, 0.20), lean = rr(-0.16, 0.16);
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.10, 0),
    new THREE.Vector3(bend * 0.4, h * 0.36, lean * 0.4),
    new THREE.Vector3(bend * 0.9, h * 0.72, lean * 0.9),
    new THREE.Vector3(bend, h, lean),
  ]);
  g.add(mesh(new THREE.TubeGeometry(stemCurve, 8, 0.016, 6, false), MAT.lily, { name:'podStem' }));

  // 莲房头（第十一轮：**强倾**——旧版只倾 7°，岸边看到的永远是椭球侧面、
  // 籽孔面朝天不可读，用户蓝框判"光秃秃小圆球看不出来是莲蓬"。
  // 真实花谢后的莲蓬穗轴大幅弯垂，莲房面朝斜下方/侧方 30~60°；
  // 倾向带随机方位角，但整体偏向南岸（观众侧），籽孔面朝观众可读）。
  const tilt = rr(0.5, 1.0), tiltAz = rr(-0.5, 0.5);
  const head = new THREE.Group();
  head.position.set(bend, h, lean);
  head.rotation.set(tilt * Math.cos(tiltAz), rr(0, TAU), tilt * Math.sin(tiltAz) * -1);
  g.add(head);

  const R = 0.070;                                   // 莲房半径 7cm → 直径 14cm（第二验收轮 +12%：花/蓬尺度上调）
  const houseMat = jr() < 0.32 ? MAT.lotusPodAged : MAT.lotusPod;
  const house = mesh(new THREE.SphereGeometry(R, 14, 9), houseMat, { name:'podHouse' });
  house.scale.set(1, 0.60, 1);                      // 压扁的莲房
  head.add(house);
  const face = mesh(new THREE.CylinderGeometry(R*0.78, R*0.78, 0.007, 14), houseMat, { name:'podFace' });
  face.position.y = R * 0.34;                       // 顶面近乎平
  head.add(face);

  /* 籽孔（第二验收轮：17 籽×小杯在 2m 外只有 4~5px，"靠数量堆不出结构感"）——
     改为 9 籽 × 大杯大籽：1 中心 + 8 环位，凹窝 2.5cm、莲子 2.1cm，
     明暗对比（亮蓬面/深窝/浅籽三层）才是 2m 外的读感来源。 */
  const faceY = R * 0.34 + 0.004;
  const cupGeo = new THREE.CylinderGeometry(0.0125, 0.0115, 0.010, 8);
  const seedGeo = new THREE.SphereGeometry(0.0105, 8, 6);
  seedGeo.scale(1, 0.62, 1);                        // 微凸圆顶
  const N_SEED = 9;
  const cupInst = new THREE.InstancedMesh(cupGeo, MAT.lotusPodDark, N_SEED);
  const seedInst = new THREE.InstancedMesh(seedGeo, MAT.lotusSeed, N_SEED);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < N_SEED; i++){
    const rad = i === 0 ? 0 : 0.033;
    const a = i === 0 ? 0 : (i - 1) * (TAU / 8) + 0.22;
    q.identity(); s.set(1, 1, 1);
    p.set(Math.cos(a) * rad, faceY, Math.sin(a) * rad);
    m.compose(p, q, s); cupInst.setMatrixAt(i, m);
    p.y = faceY + 0.0045;
    s.setScalar(rr(0.92, 1.06));
    m.compose(p, q, s); seedInst.setMatrixAt(i, m);
  }
  cupInst.instanceMatrix.needsUpdate = seedInst.instanceMatrix.needsUpdate = true;
  head.add(cupInst, seedInst);

  // ── 生态组合：邻位浮叶 + 伴生荷花/花蕾 ──
  /* ⚠️ 近景水道（2026-09-26）：浮叶**逐片判廊道归属**，廊内的不生成。
     但 **rr()/rnd() 的调用次数与顺序一个字不能动** —— 这是"全局随机流守恒"铁律，
     也是 layout-fingerprint 那道门的前提。所以先把值**全抽完**（照原样），
     再决定要不要 g.add；被跳过的那几次 rr() 照样烧掉，后续抽样一位不差。
     莲蓬头/花/花蕾都高在水面之上、是这片的视觉主体，不在廊道管辖内。 */
  const padGeo = makeLilyPadGeo();
  const nPads = 2 + ((rnd()*2)|0);
  for (let i = 0; i < nPads; i++){
    const a = rr(0, TAU), rad = rr(0.24, 0.52);
    const py = 0.014 + rr(0, 0.004);
    const ry = rr(0, TAU);
    const sc = rr(0.42, 0.68);                      // 0.52~0.84m 叶盘：与 12cm 莲房保持真实比例
    if (corridorRaw(x + Math.cos(a)*rad, z + Math.sin(a)*rad) < 0.35) continue;   // 廊心：让开
    const pad = mesh(padGeo, MAT.lily, { name:'podPad', cast:false, receive:false });
    pad.position.set(Math.cos(a) * rad, py, Math.sin(a) * rad);
    pad.rotation.y = ry;
    pad.scale.set(sc, 1, sc);
    g.add(pad);
  }
  const fr = jr();
  if (fr < 0.55){
    // 伴生荷花：三圈杯瓣（同 makeAquatic 的 ring 手法）+ 短梗
    const fa = rr(0, TAU), fRad = rr(0.30, 0.55);
    const fx = Math.cos(fa) * fRad, fz = Math.sin(fa) * fRad;
    const fh = rr(0.45, 0.8);
    const stemH = fh + 0.06;
    const fStem = mesh(new THREE.CylinderGeometry(0.008, 0.013, stemH, 5), MAT.lily, { name:'flowerStem' });
    fStem.position.set(fx, stemH / 2, fz);
    g.add(fStem);
    // 伴花基座补叶（第二验收轮：花基部落水处不裸）
    for (let k = 0; k < 2; k++){
      const pa = rr(0, TAU), prad = rr(0.16, 0.30);
      const ppy = 0.014 + rr(0, 0.004);
      const pry = rr(0, TAU);
      const psc = rr(0.42, 0.62);
      if (corridorRaw(x + fx + Math.cos(pa)*prad, z + fz + Math.sin(pa)*prad) < 0.35) continue;  // 同上：等量燃烧
      const pad = mesh(padGeo, MAT.lily, { name:'podPad', cast:false, receive:false });
      pad.position.set(fx + Math.cos(pa) * prad, ppy, fz + Math.sin(pa) * prad);
      pad.rotation.y = pry;
      pad.scale.set(psc, 1, psc);
      g.add(pad);
    }
    const petalGeo = makeLotusPetalGeo();
    const petInst = new THREE.InstancedMesh(petalGeo, MAT.lotus, 18);
    petInst.castShadow = false;
    const pm = new THREE.Matrix4(), pp = new THREE.Vector3(), pq = new THREE.Quaternion(), ps = new THREE.Vector3();
    const qT = new THREE.Quaternion(), qS = new THREE.Quaternion();
    const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
    const sc = rr(0.100, 0.118);                    // 花径 0.24~0.28m（第二验收轮 +12%）
    let slot = 0;
    const ring = (n, tilt, radiusOut, phase) => {
      for (let k = 0; k < n; k++){
        const pa = (k / n) * TAU + phase;
        qT.setFromAxisAngle(AX, -tilt);
        qS.setFromAxisAngle(AY, pa);
        pq.copy(qS).multiply(qT);
        pp.set(fx + Math.cos(pa) * radiusOut * sc, fh, fz + Math.sin(pa) * radiusOut * sc);
        ps.setScalar(sc);
        pm.compose(pp, pq, ps);
        petInst.setMatrixAt(slot++, pm);
      }
    };
    ring(7, 1.16, 0.42, 0);                          // 外圈：摊平外翻
    ring(6, 0.78, 0.30, 0.24);                      // 中圈
    ring(5, 0.38, 0.20, 0.50);                       // 内圈：收拢成杯
    petInst.instanceMatrix.needsUpdate = true;
    g.add(petInst);
  } else if (fr < 0.85){
    // 伴生花蕾：尖卵紧裹、微斜
    const fa = rr(0, TAU), fRad = rr(0.30, 0.5);
    const fx = Math.cos(fa) * fRad, fz = Math.sin(fa) * fRad;
    const fh = rr(0.35, 0.65);
    const bStem = mesh(new THREE.CylinderGeometry(0.007, 0.012, fh + 0.08, 5), MAT.lily, { name:'budStem' });
    bStem.position.set(fx, (fh + 0.08) / 2, fz);
    bStem.rotation.z = fx * 0.06;
    g.add(bStem);
    const bud = mesh(new THREE.SphereGeometry(0.026, 9, 7), MAT.lotus, { name:'lotusBud', cast:false });
    bud.scale.set(1, 1.9, 1);
    bud.position.set(fx, fh + 0.10, fz);
    bud.rotation.z = fx * 0.10;
    g.add(bud);
  }
  return g;
}

/* 假山连片：一串峰石沿池岸接到桥头 */
export function makeRockChain(points){
  const g = new THREE.Group();
  points.forEach((pt, i)=>{
    /* ⚠️ 这里试过用 SDF 立峰替换峰群（"统一石头语言"），实测**失败**并被回退：
       SDF 石头在 0.15m 网格 + 锥台并集下渲染成一排片状"墓碑"，体量、峰势全丢；
       draw calls 195→580、三角形 +70 万。结论：几何层换不动，语言统一改走
       **材质 + 腔体 AO**（见 makeTaihuPeak 里的 bakeCavity 与 MAT.taihuLobe）。 */
    const pk = mesh(makeTaihuPeak(pt.h, pt.r, i + 1),
                    i % 3 === 0 ? MAT.taihuLobeDark : MAT.taihuLobe, { name:'taihuPeak' });
    pk.position.set(pt.x, 0.05, pt.z);
    pk.rotation.y = rr(0, TAU);
    g.add(pk);
    for (let k = 0; k < 2; k++){
      const br = rr(0.32, 0.62);
      const bg = new THREE.IcosahedronGeometry(br, 0);
      const bp = bg.attributes.position;
      for (let j = 0; j < bp.count; j++){
        const nn = rr(0.78, 1.28);
        bp.setXYZ(j, bp.getX(j) * nn, bp.getY(j) * nn * 0.7, bp.getZ(j) * nn);
      }
      bg.computeVertexNormals();
      const bm = mesh(bg, MAT.taihu, { name:'taihuBoulder' });
      bm.position.set(pt.x + rr(-1.3, 1.3), br * 0.42, pt.z + rr(-1.3, 1.3));
      bm.rotation.set(rr(-0.3, 0.3), rr(0, TAU), rr(-0.3, 0.3));
      g.add(bm);
    }
  });
  return g;
}

/* 特景假山：多根太湖石峰簇拥成景（主峰高、侧峰矮，缝隙即成"漏透"）
   ⚠️ 第十二轮（用户反馈）：南岸两座 makeRockery 主峰都是 h7.2/r0.66 完全一样。
   加 style 变体（0=云头主峰 / 1=横纹主峰 / 2=瘦漏主峰）：峰群的高/位/旋转/seed
   相位全部随 style 偏移，两座假山逐项可辨；另加 seed 相位让皱褶不同。 */
export function makeRockery(x, z, style = 0){
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  // 基座土坡（加大：假山要有"坐"在土里的体量感，不是浮在草地上的石堆）
  const mound = mesh(new THREE.SphereGeometry(3.6, 16, 9, 0, TAU, 0, Math.PI/2), MAT.grass, { cast:false });
  mound.scale.set(1, 0.24, 1);
  mound.position.y = -0.10;
  g.add(mound);

  // style 变体：主峰形态/身高/半径/朝向各异
  // style=0 「云头峰」瘦高展冠 h~7.5 主峰正面朝南
  // style=1 「横纹峰」敦厚叠层 h~6.2 主峰偏侧、更宽
  // style=2 「瘦漏峰」高瘦漏透 h~6.8 主峰纤细
  const peaks = style === 1 ? [
    { h: 6.1, r: 0.70, x: 0.18, z:-0.30, ry: 0.8, mat: MAT.taihu },
    { h: 5.0, r: 0.48, x: 1.35, z: 0.55, ry:-1.2, mat: MAT.taihuDark },
    { h: 3.8, r: 0.52, x:-1.10, z: 0.42, ry: 2.2, mat: MAT.taihu },
    { h: 4.6, r: 0.42, x:-0.20, z: 0.95, ry: 3.6, mat: MAT.taihu },
    { h: 2.9, r: 0.40, x: 0.75, z:-1.05, ry: 4.8, mat: MAT.taihuDark },
  ] : style === 2 ? [
    { h: 6.8, r: 0.30, x:-0.30, z: 0.10, ry: 1.2, mat: MAT.taihu },   // 纤细主峰
    { h: 4.9, r: 0.44, x: 1.10, z:-0.40, ry: 2.6, mat: MAT.taihuDark },
    { h: 5.5, r: 0.36, x:-0.95, z:-0.65, ry:-0.9, mat: MAT.taihu },
    { h: 3.6, r: 0.46, x: 0.55, z: 0.95, ry: 4.2, mat: MAT.taihu },
    { h: 4.1, r: 0.33, x: 0.10, z:-1.00, ry: 5.1, mat: MAT.taihuDark },
  ] : [   // style=0 云头峰
    { h: 7.4, r: 0.62, x: 0.00, z: 0.00, ry: 0.0, mat: MAT.taihu },
    { h: 5.2, r: 0.50, x: 1.18, z: 0.42, ry: 1.4, mat: MAT.taihu },
    { h: 4.0, r: 0.46, x:-0.92, z: 0.66, ry: 2.8, mat: MAT.taihuDark },
    { h: 6.0, r: 0.44, x:-0.20, z:-0.92, ry: 3.9, mat: MAT.taihu },
    { h: 3.2, r: 0.40, x: 0.85, z:-0.70, ry: 5.0, mat: MAT.taihu },
  ];
  const seedBase = style * 137 + 13;
  peaks.forEach((pk, pi)=>{
    const m = mesh(makeTaihuPeak(pk.h, pk.r, pi * 7 + seedBase),
                    pk.mat === MAT.taihuDark ? MAT.taihuLobeDark : MAT.taihuLobe, { name:'taihuPeak' });
    m.position.set(pk.x, 0.1, pk.z);
    m.rotation.y = pk.ry + style * 0.37;    // 每座假山整群再转一点，避免呈现同向
    g.add(m);
  });

  // 卧石点缀（两座假山用量不同，避免雷同）
  const nB = style === 1 ? 5 : 3;
  for (let i = 0; i < nB; i++){
    const r = rr(0.4, 0.7);
    const geo = new THREE.IcosahedronGeometry(r, 0);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++){
      const n = rr(0.82, 1.2);
      p.setXYZ(k, p.getX(k)*n, p.getY(k)*n*0.7, p.getZ(k)*n);
    }
    geo.computeVertexNormals();
    const m = mesh(geo, i % 2 === 0 ? MAT.rock : MAT.rockDark, { name:'taihuBoulder' });
    m.position.set(rr(-2.2, 2.2), r * 0.45, rr(-2.0, 2.0));
    m.rotation.set(rr(-0.3,0.3), rr(0, TAU), rr(-0.3,0.3));
    g.add(m);
  }
  return g;
}
export function makeWaterGrass(x, z, n = 60, spread = 3.2){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const bladeGeo = makeReedBladeGeo(1.5);
  const inst = new THREE.InstancedMesh(bladeGeo, MAT.reed, n);
  inst.castShadow = false;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++){
    p.set(rr(-spread, spread), CFG.water - 0.05, rr(-spread*0.6, spread*0.6));
    q.setFromEuler(new THREE.Euler(rr(-0.3,0.3), rr(0, TAU), rr(-0.3,0.3)));
    s.set(1, rr(0.7, 1.5), 1);
    m.compose(p, q, s); inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  g.add(inst);
  markUnderwater(g);                          // 水草：整株入折射层（实例化网格不参与合并，标记丢不了）
  return g;
}

/* ══ 夏夜萤火虫 + 镜头天气层（镜前雨帘 / 雪粒）⇒ 已并入 06b-atmos.js（2026-10-05 拆分）══════    原 4173~4384 行整块搬走（纯搬家、逐字未改）。两块都是"挂在相机/场景上的氛围粒子"，与雾团、    香炉白烟同一族，故并入同一个文件。调用点仍在 11-loop（makeFireflies / makeLensWeather），    已改为从 06b-atmos.js 直接 import。 */
