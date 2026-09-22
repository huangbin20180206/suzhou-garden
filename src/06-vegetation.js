// 06-vegetation: from index.html inline 493..2993
import { THREE, mergeGeometries, GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder } from '../vendor.js';
/* ⚠️ world 从 02-scene 取，**不能**从 08-assemble 取：08 的模块体要读本模块的
   rippleInst / perchingAnchors 等模块级常量，若本模块反向 import 08 就成环 ——
   本模块的 body 被推迟到 08 之后，而 08 的 body 读到的就是 TDZ
   （实测 "Cannot access 'rippleInst' before initialization"）。依赖方向：02 → 06 → 08。 */
import { world, scene, GPU_TIER, renderer } from './02-scene.js';
/* ⚠️ onAssetAttached 也**不能**静态 import 12-env：12-env 的模块体在 world 之前求值，
   而它 import 08；本模块一旦 import 12-env，12-env 就会把 08 提前拽进来 → 同一个 TDZ。
   它只在 loadAssetOnce 的**回调**里调用（那时一切就绪），故走 00-config 的 HOOKS 延迟绑定。 */
import { TAU, rnd, rr, CFG, mulberry32, bootMark, HOOKS } from './00-config.js';
import { MAT, WIND, addWind, AUX_PASS_HIDDEN } from './01-materials.js';
import { mesh } from './03-factory.js';
import { POND_RADII, markUnderwater } from './05-water.js';
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
function makeLotusPetalGeo(){
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.30, 0.10, 0.34, 0.62, 0, 0.92);
  s.bezierCurveTo(-0.34, 0.62, -0.30, 0.10, 0, 0);
  const g = new THREE.ShapeGeometry(s, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, Math.abs(x) * 0.42 - Math.pow(y / 0.92, 2) * 0.16);
  }
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
        pts.push(new THREE.Vector3(ox + Math.cos(a2) * r, y, oz + Math.sin(a2) * r));
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
  stalks.forEach(s=>{
    for (let k = 1; k < 6; k++) nodes.push({ x:s.x, y:s.h*k/6, z:s.z });
  });
  const nodeInst = new THREE.InstancedMesh(nodeGeo, MAT.bambooB, nodes.length);
  const nm = new THREE.Matrix4(), np = new THREE.Vector3(), nq = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI/2,0,0)), ns = new THREE.Vector3(1,1,1);
  nodes.forEach((n, i)=>{ np.set(n.x, n.y, n.z); nm.compose(np, nq, ns); nodeInst.setMatrixAt(i, nm); });
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
    const j = (Math.random() * (i + 1)) | 0;
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
export function makeWisteria(count = 6, scale = 1){
  const g = new THREE.Group();
  const span = Math.min(4.5 * scale, 10);
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
export function makeAquatic(x, z, radius = 5.5, nPad = 46, nLotus = 14){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  // 睡莲叶：带缺口、边缘上翘的浅碟
  const padGeo = makeLilyPadGeo();
  const pads = new THREE.InstancedMesh(padGeo, MAT.lily, nPad);
  pads.receiveShadow = true;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < nPad && guard++ < nPad * 8){
    const a = rr(0, TAU), rad = Math.sqrt(rnd()) * radius;
    const px = Math.cos(a)*rad, pz = Math.sin(a)*rad * 0.72;
    /* ⚠️ 汀步在 z≈5.6 的一条直线上（见 makeSteppingStones），叶盘压上去必然与石板穿模
       （用户实拍：石板从叶盘中间穿出来）。这里按**标称石位**让开 0.8m ——
       不去引用那块列表，是因为它的随机数消耗顺序不能动（一动整场景的随机布局都会变）。 */
    const wx = x + px, wz = z + pz;
    if (Math.abs(wz - 5.6) < 0.80 && wx > -4.4 && wx < 7.4) continue;
    p.set(px, CFG.water + 0.075 + rr(0,0.02), pz);
    q.setFromEuler(new THREE.Euler(0, rr(0, TAU), 0));
    s.setScalar(rr(0.62, 1.25));
    m.compose(p, q, s); pads.setMatrixAt(placed, m);
    pads.setColorAt(placed, new THREE.Color().setHSL(0.27, rr(0.28, 0.5), rr(0.26, 0.42)));
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
    const fx = Math.cos(a)*rad, fz = Math.sin(a)*rad*0.72;
    /* ⚠️ 花梗高度必须**高过睡莲叶盘**：叶盘顶部在 0.21，原来最低 0.2 的花
       等于坐在叶子上，0.2m 的杆被 1.5m 宽的叶子完全挡住（用户："荷花几乎没有杆撑着"）。 */
    const fy = CFG.water + rr(0.48, 1.08);        // 花朵高低错落（下限抬到叶盘之上）
    const sc = rr(0.092, 0.116);      // 花朵直径 0.22~0.28m（真实荷花 15~25cm）
    // 花梗
    const stemH = fy - CFG.water + 0.06;
    const stemM = mesh(new THREE.CylinderGeometry(0.026, 0.040, stemH, 5), MAT.lily, { name:'lotusStem' });
    stemM.position.set(fx, CFG.water + stemH/2, fz);
    g.add(stemM);
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

/* 锦鲤/乌龟轨道：三条椭圆，全部经核算落在池形内 */
export const KOI_ORBITS = [
  { cx: -7.5, cz: 0, a: 3.8, b: 4.6 },      // 左瓣
  { cx:  7.5, cz: 0, a: 3.2, b: 2.8 },      // 右瓣
  { cx:  0.0, cz: 0, a: 9.5, b: 2.4 },      // 贯穿全池
];

/* 鱼跃涟漪：鱼口触水处激起的一圈圈同心涟漪。
   P1-9 并批：20 个独立 Mesh（激活几个就几个 draw call）→ 单个 InstancedMesh +
   自定义 instanceAlpha（onBeforeCompile 注入 per-instance 透明度）。
   draw call 恒为 1；未激活实例 alpha=0 视觉消失；实例矩阵编码位置与 s 缩放。 */
const RIPPLE_N = 20;
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
/* 雨滴涟漪占用计数：与点击/鱼跃共用 20 槽的池子，雨最多占 12，
   否则暴雨下 10 圈/s 的生成会把池子饿死（findIndex 找不到空槽，
   玩家点击和鱼跃全部静默失效）。计数在 spawn/expiry 两侧配对增减。 */
export let rainRippleActive = 0;
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
export function updateRipples(t){
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

/* 锦鲤：沿椭圆轨道游动 */
export function makeKoiGroup(n = 11){
  const g = new THREE.Group();
  g.position.set(0, 0, 3);          // 池塘中心（与 POND_SHAPE 对齐）
  g.userData.fishes = [];
  new GLTFLoader().load('assets/koi.glb', (gltf)=>{
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
      holder.userData = {
        orbit: i % KOI_ORBITS.length,
        t: rr(0, TAU), speed: rr(0.10, 0.22),
        jitter: rr(0.72, 1.0), phase: rr(0, TAU),
        riseAt: 6 + Math.random() * 18, rising: false, riseT0: 0, halfH,
      };
      g.add(holder);
      g.userData.fishes.push(holder);
    }
    /* 锦鲤是异步挂载的：layer 不被子节点继承，必须等 holder 们都进了组再统一打一遍
       折射层标记 —— 漏了就是「水面折射里一条鱼都没有」，而且不报错。 */
    markUnderwater(g);
  }, undefined, e=>console.warn('koi.glb 加载失败', e));
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
    rawCache.set(url, new Promise((resolve, reject)=>{
      const loader = createGLTFLoaderWithDecoders();
      loader.load(url, (gltf)=> resolve(gltf.scene),
        undefined, (e)=>{ rawCache.delete(url); assetFailures++; console.warn('模型加载失败：', url, e); reject(e); });
    }));
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
function makeMistSpriteTex(){
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
    new THREE.Vector3(rr(-0.3,0.3),  H*0.94, rr(-0.25,0.25)),
  ]);
  g.add(mesh(new THREE.TubeGeometry(trunkCurve, 18, 0.185 * rr(0.9, 1.15), 8, false), MAT.willowBark, { name:'willowTrunk' }));
  // 根盘
  for (let i = 0; i < 5; i++){
    const a = (i/5)*TAU + rr(-0.3,0.3);
    const root = mesh(new THREE.SphereGeometry(rr(0.18,0.3), 7, 5), MAT.willowBark, { name:'willowRoot' });
    root.position.set(Math.cos(a)*0.34, rr(0.05,0.18), Math.sin(a)*0.34);
    root.scale.set(1, 0.62, 1);
    g.add(root);
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
      new THREE.Vector3(rr(-0.2,0.2), y0, rr(-0.2,0.2)),
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
      pts.push(new THREE.Vector3(Math.cos(aa) * r, y, Math.sin(aa) * r));
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
    const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;   // 中央聚集
    /* 帘长全局参差 ×0.85~1.15（叠加轮廓 ±40% —— 第八轮验收指令⑤：消除"梳齿的整齐感"） */
    const addCurtain = (x, y, z, len, w) => {
      const edge = Math.min(1, Math.hypot(x, z) / 2.6);
      const L = len * (edge > 0.72 ? rr(0.62, 1.42) : 1) * rr(0.85, 1.15);
      curtains.push({ x, y, z, len: Math.min(L, Math.max(0.35, y - 0.30)), w, rot: Math.random() * TAU });
    };
    /* 全向叶簇基建（第八轮验收指令①的换法核心）：帘几何只会"往下挂"，挂帘盖不住
       挂点上方的弧背 —— 连续七轮的教训。tuft 记一个全向单位向量，实例化时把帘的
       -Y 轴映射到该方向：同一个 12 tri 几何既当垂帘、又当"长在枝上朝哪都有的叶簇"。 */
    const randDir = () => {
      const u = Math.random() * 2 - 1, a2 = Math.random() * TAU;
      const s2 = Math.sqrt(Math.max(0, 1 - u * u));
      return { x: s2 * Math.cos(a2), y: u, z: s2 * Math.sin(a2) };
    };
    const addTuft = (x, y, z, len, w, d) => {
      curtains.push({ x, y, z, len: Math.min(len, Math.max(0.30, y - 0.30)), w, dir: d, rot: Math.random() * TAU });
    };
    const addCluster = (cx, cy, cz, n, spread, lenMin, lenMax) => {
      for (let i = 0; i < n; i++){
        addCurtain(cx + gauss()*spread, cy + gauss()*spread*0.4, cz + gauss()*spread,
                   (lenMin + Math.random()*(lenMax-lenMin)) * rr(0.72, 1.32),   // 强方差：下摆参差
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
      const a = Math.random() * TAU;
      const rad = Math.sqrt(Math.random()) * 1.0;
      addCurtain(Math.cos(a) * rad, H * (0.86 + Math.random() * 0.22), Math.sin(a) * rad,
                 rr(0.45, 1.35), rr(0.9, 1.5));
    }
    /* ②d 顶幕横毯 —— 2800 枚是"撒盐必连毯"的过补版本（第十二轮性能回归：
       2800→1600 枚，够封闭冠顶、省 1.2 万 tri/树 + 对应片元过绘制）。
       第十七轮（冠顶俯视闭合度）：① rad 上限 2.30→2.58 外延到冠缘（R=2.9 减余量，
       原来 2.6~3.1 最外圈无覆盖、方向性破洞随机落点 → 单树外环 49%~99% 方差巨大）
       ② dir.y ±0.28→+0.18~0.78 偏上仰躺：俯视投影是"面"不是"侧立窄条"，
       从顶上把冠缘盖死（实测单树外环极差 20.5pt → 收敛）。 */
    for (let i = 0; i < 1600; i++){
      const a = Math.random() * TAU, a2 = Math.random() * TAU;
      const rad = 0.30 + Math.sqrt(Math.random()) * 2.58;
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
        const a2 = Math.random() * TAU;
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
          const az = az0 + Math.random() * (TAU / 8);
          const rad = 0.4 + Math.sqrt(Math.random()) * 2.55;
          const yDome = (1.00 - (rad / 2.5) * 0.40) * H;
          const a2 = Math.random() * TAU;
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
          const a2 = Math.random() * TAU;
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
        const s1 = longs[(Math.random() * longs.length) | 0];
        const s2 = longs[(Math.random() * longs.length) | 0];
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
            if (Math.random() < 0.62 + 0.33 * (rad / R)){
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
        const a = Math.random() * TAU;
        const rad = Math.sqrt(Math.random()) * R;
        const yTop = H * (1.00 - (rad / R) * 0.40) + (rad < R * 0.55 ? H * 0.10 : 0);   // 顶心区穹面抬高
        const yBot = Math.max(0.55, H * (0.50 - (rad / R) * 0.12));
        addCurtain(Math.cos(a)*rad + rr(-0.1,0.1), yBot + Math.random()*(yTop - yBot), Math.sin(a)*rad + rr(-0.1,0.1),
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
    const j = (Math.random() * (i + 1)) | 0;
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

/* ── 桃花（重建 · 2026-09-22）────────────────
   桃是落叶观花小乔木，四季生命周期由 12-env 的季节显隐通道驱动：
     peachShow          → 叶冠（MAT.peachLeaf，走 tinLeaf：春夏绿 → 秋黄 → 冬落尽裸枝）
     peachBlossomShow   → 花   （MAT.peachBlossom，春开，先花后叶）
     peachFruitShow     → 果   （MAT.peachFruit，夏秋带红晕的蜜桃）
     peachPetalShow     → 落花铺地（MAT.peachPetal，春末夏初树干四周散一层粉瓣）
   重建要点：
     · 主干更细（原 0.34 → 0.18），桃是小乔木不是大树
     · 叶/花/果沿枝条分布，不再是球体内悬空漂浮
     · 桃叶：披针形，先端渐尖，不是三角片
     · 桃花：五瓣卵圆形花瓣 + 花蕊，不是五片平板
     · 桃子：心形带尖，不是压扁的球
     · 春季：先花后叶（花满树时叶刚萌） */

/* 桃叶：披针形 —— 基部宽、先端渐尖、叶缘微弯，长 12~18cm */
function makePeachLeafGeo(){
  const len = 0.15, maxW = 0.045;
  const s = new THREE.Shape();
  s.moveTo(0, 0);                              // 叶基（叶柄端）
  s.bezierCurveTo(maxW*0.35, len*0.05, maxW*0.9, len*0.32, maxW, len*0.52);  // 最宽处在中部偏基
  s.bezierCurveTo(maxW*0.7, len*0.72, maxW*0.3, len*0.92, 0.003, len);       // 渐尖至叶尖
  s.bezierCurveTo(-maxW*0.3, len*0.92, -maxW*0.7, len*0.72, -maxW, len*0.52);
  s.bezierCurveTo(-maxW*0.9, len*0.32, -maxW*0.35, len*0.05, 0, 0);
  const g = new THREE.ShapeGeometry(s, 10);
  // 轻微中肋隆起
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++){
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.abs(x) * 0.12 * (y / len));  // 越往叶尖越平
  }
  g.rotateX(-Math.PI / 2);                        // 平放，y=长度方向 → z=长度方向
  g.translate(0, 0, len * 0.15);                  // 叶柄端在原点附近
  g.computeVertexNormals();
  return g;
}

/* 桃花：五瓣卵圆形 + 花蕊
   花瓣：卵圆形（基部稍窄、顶部圆钝），五枚绕心 72° 排列
   花蕊：中央雄蕊群 + 中央雌蕊，用小圆柱/球组合 */
function makePeachFlowerGeo(){
  const petalL = 0.07, petalW = 0.05;
  const parts = [];

  // 单瓣：卵圆形
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, 0);
  petalShape.bezierCurveTo(petalW*0.4, petalL*0.1, petalW*0.95, petalL*0.45, petalW*0.85, petalL*0.85);
  petalShape.bezierCurveTo(petalW*0.55, petalL*1.05, petalW*0.2, petalL*1.02, 0, petalL);
  petalShape.bezierCurveTo(-petalW*0.2, petalL*1.02, -petalW*0.55, petalL*1.05, -petalW*0.85, petalL*0.85);
  petalShape.bezierCurveTo(-petalW*0.95, petalL*0.45, -petalW*0.4, petalL*0.1, 0, 0);
  const petalGeo = new THREE.ShapeGeometry(petalShape, 8);

  // 五瓣排列：瓣基在中心附近，瓣尖朝外，略外翻
  for (let k = 0; k < 5; k++){
    const pg = petalGeo.clone();
    const ang = k * TAU / 5;
    // 瓣基在中心 0.012 半径处
    pg.translate(0, 0.012, 0);
    pg.rotateZ(ang);
    // 花瓣微微向上拱 + 轻微外翻
    pg.rotateX(-0.35 - (k % 2) * 0.15);       // 交错外翻
    pg.rotateY(ang * 0.1);                     // 一点扭转
    parts.push(pg);
  }

  // 花托/花萼：基部小圆盘（简化为一个小的绿色底托，与花瓣同色但更深，放在后面）
  const calyxGeo = new THREE.CircleGeometry(0.022, 10);
  calyxGeo.rotateX(-Math.PI / 2);
  calyxGeo.translate(0, -0.002, 0);
  // 花萼颜色由 instanceColor 的深色控制，这里用同一材质靠位置自然区分

  const merged = mergeGeometries([...parts, calyxGeo], false);
  // 花的朝向：默认花盘朝上（y+），实例化时再旋转
  return merged;
}

/* 桃子：心形/卵形，顶端有突尖，腹缝有浅沟
   用 LatheGeometry 沿纵轴旋转出基本形，再压扁一侧做心形凹陷 */
function makePeachFruitGeo(){
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
  const g = new THREE.LatheGeometry(pts, 16);
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

export function makePeachTree(x, z, scale = 1){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  const H = 4.2 * rr(0.92, 1.08);                      // 桃较柳矮：观花小乔木
  const trunkR = 0.16 * rr(0.9, 1.1);                    // 主干细：小乔木
  const canopyC = new THREE.Vector3(0, H * 0.70, 0);     // 冠心
  const R = H * 0.42;                                    // 冠半径
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(),
        _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

  /* 主干：从地面到第一主枝分叉点，下部稍粗上部渐细 */
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.05, 0),
    new THREE.Vector3(rr(-0.08,0.08), H*0.25, rr(-0.08,0.08)),
    new THREE.Vector3(rr(-0.06,0.06), H*0.45, rr(-0.06,0.06)),
    new THREE.Vector3(rr(-0.04,0.04), H*0.62, rr(-0.04,0.04)),
  ]);
  const trunkGeo = new THREE.TubeGeometry(trunkCurve, 14, trunkR, 8, false);
  // 顶部收细：手动缩放上部顶点
  {
    const pos = trunkGeo.attributes.position;
    const curve = trunkCurve;
    for (let i = 0; i < pos.count; i++){
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      // 找该顶点在曲线上的 t 值（近似：用 y 估算）
      const t = Math.max(0, Math.min(1, (v.y - curve.points[0].y) / (curve.points[3].y - curve.points[0].y)));
      const center = curve.getPoint(t);
      const radial = v.distanceTo(center);
      // 顶部 1/3 渐细
      const taper = t < 0.6 ? 1.0 : 1.0 - (t - 0.6) * 0.55;
      const dir = v.sub(center).normalize();
      v.copy(center).addScaledVector(dir, radial * taper);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    trunkGeo.computeVertexNormals();
  }
  g.add(mesh(trunkGeo, MAT.trunk, { name:'peachTrunk', cast:true }));

  // 根盘
  for (let i = 0; i < 5; i++){
    const a = (i / 5) * TAU + rr(-0.3, 0.3);
    const root = mesh(new THREE.SphereGeometry(rr(0.12, 0.22), 7, 5), MAT.trunk, { name:'peachRoot', cast:true });
    root.position.set(Math.cos(a) * 0.28, rr(0.04, 0.14), Math.sin(a) * 0.28);
    root.scale.set(1, 0.55, 1);
    g.add(root);
  }

  /* 主枝：4~6 根，从主干 0.35~0.6H 处分叉伸出，斜向上外张
     每根主枝有曲线 + 半径渐细 */
  const nMainBranch = 4 + ((rnd() * 3) | 0);
  const mainBranches = [];       // 保存曲线用于挂叶/花/果
  for (let i = 0; i < nMainBranch; i++){
    const a = (i / nMainBranch) * TAU + rr(-0.35, 0.35);
    const y0 = H * rr(0.35, 0.58);
    const reach = rr(1.4, 2.2);
    const tipY = H * rr(0.65, 0.88);
    const upBias = rr(0.15, 0.35);   // 向上弯曲程度
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(rr(-0.04,0.04), y0, rr(-0.04,0.04)),
      new THREE.Vector3(Math.cos(a)*reach*0.35, y0 + H*upBias*0.4, Math.sin(a)*reach*0.35),
      new THREE.Vector3(Math.cos(a)*reach*0.7, tipY + H*upBias*0.2, Math.sin(a)*reach*0.7),
      new THREE.Vector3(Math.cos(a)*reach, tipY, Math.sin(a)*reach),
    ]);
    mainBranches.push(c);
    // 枝半径：基粗 0.045 → 梢 0.012
    const brGeo = new THREE.TubeGeometry(c, 12, 1, 6, false);
    // 手动设置半径渐变
    const pos = brGeo.attributes.position;
    const segCount = 12;
    const radialSegs = 6;
    for (let seg = 0; seg <= segCount; seg++){
      const t = seg / segCount;
      const radius = 0.045 * (1 - t * 0.73);  // 基 0.045 → 梢 0.012
      const center = c.getPoint(t);
      for (let r = 0; r < radialSegs; r++){
        const idx = seg * (radialSegs + 1) + r;
        // TubeGeometry 的顶点是按管截面排列的，需要重新定位
        // 这里简化：直接用 TubeGeometry 的结果，后面用 scale 渐变不行
        // 所以换一种方式：直接用圆柱缩放
      }
    }
    // 简单做法：用 CylinderGeometry 沿曲线放
    // 其实 TubeGeometry 的 radius 参数如果是数字就是均匀的
    // 我重新做：用多段圆柱拼接
    const brParts = [];
    const nSegs = 8;
    for (let s = 0; s < nSegs; s++){
      const t0 = s / nSegs, t1 = (s + 1) / nSegs;
      const p0 = c.getPoint(t0), p1 = c.getPoint(t1);
      const r0 = 0.045 * (1 - t0 * 0.73);
      const r1 = 0.045 * (1 - t1 * 0.73);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const len = p0.distanceTo(p1);
      const seg = new THREE.CylinderGeometry(r1, r0, len, 6, 1, true);
      const segMesh = new THREE.Mesh(seg, MAT.trunk);
      segMesh.position.copy(mid);
      // 朝向：从 p0 指向 p1
      const dir = p1.clone().sub(p0).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
      segMesh.quaternion.copy(quat);
      brParts.push(segMesh);
    }
    // 合并成一个
    const merged = mergeGeometries(brParts.map(m => {
      m.updateMatrix();
      return m.geometry.clone().applyMatrix4(m.matrix);
    }), false);
    const brMesh = new THREE.Mesh(merged, MAT.trunk);
    brMesh.name = 'peachBranch';
    brMesh.castShadow = true;
    g.add(brMesh);
  }

  /* 二级小枝：从主枝上长出，更细更短，是挂花果叶的主要位置 */
  const twigs = [];
  for (const br of mainBranches){
    const nTwig = 5 + ((rnd() * 4) | 0);
    for (let k = 0; k < nTwig; k++){
      const t = rr(0.25, 0.95);
      const base = br.getPoint(t);
      const tan = br.getTangent(t).normalize();
      // 小枝向外上方生长
      const a = rr(0, TAU);
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3()
        .addScaledVector(side, rr(0.5, 0.9))
        .addScaledVector(up, rr(0.4, 0.8))
        .addScaledVector(tan, rr(-0.1, 0.3))
        .normalize();
      const len = rr(0.25, 0.55);
      const tip = base.clone().addScaledVector(dir, len);
      const mid = base.clone().addScaledVector(dir, len * 0.5);
      // 小枝稍微向上拱
      mid.y += rr(0.02, 0.06);
      const twCurve = new THREE.CatmullRomCurve3([
        base.clone(),
        mid,
        tip.clone(),
      ]);
      twigs.push(twCurve);
      // 小枝几何（极细）
      const twGeo = new THREE.TubeGeometry(twCurve, 5, 0.008, 4, false);
      const twMesh = new THREE.Mesh(twGeo, MAT.trunk);
      twMesh.name = 'peachTwig';
      twMesh.castShadow = true;
      g.add(twMesh);
    }
  }

  /* 叶：沿小枝和主枝外段分布
     桃叶互生，每节一片，叶柄短 */
  const leafGeo = makePeachLeafGeo();
  const leafN = 600;
  const leafInst = new THREE.InstancedMesh(leafGeo, MAT.peachLeaf, leafN);
  leafInst.castShadow = true;
  const leafA = new THREE.Color(0x79B23E), leafB = new THREE.Color(0x44701F);
  let leafIdx = 0;

  // 从小枝上取点挂叶
  for (const tw of twigs){
    const nOnTwig = 6 + ((rnd() * 5) | 0);
    for (let k = 0; k < nOnTwig && leafIdx < leafN; k++){
      const t = rr(0.15, 0.95);
      const pt = tw.getPoint(t);
      const tan = tw.getTangent(t).normalize();
      // 叶片从枝上向外长出，有旋转
      const a = rr(0, TAU);
      const side = new THREE.Vector3(Math.cos(a), rr(0.1, 0.6), Math.sin(a)).normalize();
      const leafDir = tan.clone().lerp(side, rr(0.5, 0.85)).normalize();
      const src = new THREE.Vector3(0, 0, 1);   // 叶几何沿 z 轴方向
      _q.setFromUnitVectors(src, leafDir);
      // 叶柄基部在枝上，叶尖向外
      _p.copy(pt).addScaledVector(leafDir, 0.005);
      _s.setScalar(rr(0.8, 1.25));
      _m.compose(_p, _q, _s); leafInst.setMatrixAt(leafIdx, _m);
      leafInst.setColorAt(leafIdx, leafA.clone().lerp(leafB, Math.random())
        .offsetHSL(rr(-0.02,0.02), rr(0,0.05), rr(-0.05,0.05)));
      leafIdx++;
    }
  }
  // 从主枝外段挂一些叶
  for (const br of mainBranches){
    const nOnBr = 8 + ((rnd() * 6) | 0);
    for (let k = 0; k < nOnBr && leafIdx < leafN; k++){
      const t = rr(0.5, 0.95);
      const pt = br.getPoint(t);
      const a = rr(0, TAU);
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3(Math.cos(a), rr(0.2, 0.8), Math.sin(a)).normalize();
      const src = new THREE.Vector3(0, 0, 1);
      _q.setFromUnitVectors(src, side);
      _p.copy(pt).addScaledVector(side, 0.008);
      _s.setScalar(rr(0.9, 1.3));
      _m.compose(_p, _q, _s); leafInst.setMatrixAt(leafIdx, _m);
      leafInst.setColorAt(leafIdx, leafA.clone().lerp(leafB, Math.random())
        .offsetHSL(rr(-0.02,0.02), rr(0,0.05), rr(-0.05,0.05)));
      leafIdx++;
    }
  }
  leafInst.count = leafIdx;
  leafInst.instanceMatrix.needsUpdate = true;
  if (leafInst.instanceColor) leafInst.instanceColor.needsUpdate = true;
  g.add(leafInst);

  /* 花：春季先开，主要在小枝和枝梢
     桃花花梗短，多为单生或两朵并生，贴枝开放 */
  const flGeo = makePeachFlowerGeo();
  const flN = 320;
  const flInst = new THREE.InstancedMesh(flGeo, MAT.peachBlossom, flN);
  const flA = new THREE.Color(0xFFE8F0), flB = new THREE.Color(0xF490B4);
  const flC = new THREE.Color(0xE85C8A);  // 深粉（花心/花萼）
  let flIdx = 0;

  // 花主要在小枝上
  for (const tw of twigs){
    const nOnTwig = 3 + ((rnd() * 4) | 0);
    for (let k = 0; k < nOnTwig && flIdx < flN; k++){
      const t = rr(0.1, 0.95);
      const pt = tw.getPoint(t);
      const tan = tw.getTangent(t).normalize();
      // 花盘朝外上方，花梗短
      const a = rr(0, TAU);
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3(Math.cos(a), rr(0.2, 0.7), Math.sin(a)).normalize();
      const flowerUp = up.clone().lerp(side, rr(0.3, 0.7)).normalize();
      const src = new THREE.Vector3(0, 1, 0);   // 花几何花盘朝上（y+）
      _q.setFromUnitVectors(src, flowerUp);
      // 随机旋转花的朝向（绕花轴）
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, TAU)));
      _p.copy(pt).addScaledVector(flowerUp, 0.01);  // 花梗 1cm
      _s.setScalar(rr(0.85, 1.2));
      _m.compose(_p, _q, _s); flInst.setMatrixAt(flIdx, _m);
      // 花颜色：粉白渐变，边缘浅中心深
      flInst.setColorAt(flIdx, flA.clone().lerp(flB, Math.random())
        .offsetHSL(rr(-0.03,0.03), rr(0,0.06), rr(-0.03,0.04)));
      flIdx++;
    }
  }
  // 主枝梢端也有花
  for (const br of mainBranches){
    const nOnBr = 4 + ((rnd() * 4) | 0);
    for (let k = 0; k < nOnBr && flIdx < flN; k++){
      const t = rr(0.6, 0.98);
      const pt = br.getPoint(t);
      const up = new THREE.Vector3(0, 1, 0);
      const a = rr(0, TAU);
      const side = new THREE.Vector3(Math.cos(a), rr(0.1, 0.5), Math.sin(a)).normalize();
      const flowerUp = up.clone().lerp(side, rr(0.2, 0.5)).normalize();
      const src = new THREE.Vector3(0, 1, 0);
      _q.setFromUnitVectors(src, flowerUp);
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, TAU)));
      _p.copy(pt).addScaledVector(flowerUp, 0.012);
      _s.setScalar(rr(0.9, 1.25));
      _m.compose(_p, _q, _s); flInst.setMatrixAt(flIdx, _m);
      flInst.setColorAt(flIdx, flA.clone().lerp(flB, Math.random())
        .offsetHSL(rr(-0.03,0.03), rr(0,0.06), rr(-0.03,0.04)));
      flIdx++;
    }
  }
  flInst.count = flIdx;
  flInst.instanceMatrix.needsUpdate = true;
  if (flInst.instanceColor) flInst.instanceColor.needsUpdate = true;
  g.add(flInst);

  /* 果：夏秋结桃，主要挂在小枝上，叶间
     桃子带果柄，下垂或侧生 */
  const frGeo = makePeachFruitGeo();
  const frN = 80;
  const frInst = new THREE.InstancedMesh(frGeo, MAT.peachFruit, frN);
  const frA = new THREE.Color(0xF2B36A), frB = new THREE.Color(0xD9635A);
  const frC = new THREE.Color(0xE8845A);  // 中间过渡色
  let frIdx = 0;

  for (const tw of twigs){
    const nOnTwig = 1 + ((rnd() * 2) | 0);
    for (let k = 0; k < nOnTwig && frIdx < frN; k++){
      const t = rr(0.2, 0.85);
      const pt = tw.getPoint(t);
      const tan = tw.getTangent(t).normalize();
      // 果柄短，桃子稍下垂
      const a = rr(0, TAU);
      const side = new THREE.Vector3(Math.cos(a), rr(-0.5, 0.2), Math.sin(a)).normalize();
      const fruitDir = side.clone();
      const src = new THREE.Vector3(0, 1, 0);   // 桃子尖朝上（y+）
      _q.setFromUnitVectors(src, fruitDir);
      // 随机旋转
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr(0, TAU)));
      _p.copy(pt).addScaledVector(fruitDir, 0.015);  // 果柄
      _s.set(rr(0.85, 1.15), rr(0.9, 1.1), rr(0.85, 1.15));
      _m.compose(_p, _q, _s); frInst.setMatrixAt(frIdx, _m);
      frInst.setColorAt(frIdx, frA.clone().lerp(frB, rr(0.3, 0.9))
        .offsetHSL(rr(-0.02,0.02), rr(0,0.05), rr(-0.04,0.03)));
      frIdx++;
    }
  }
  frInst.count = frIdx;
  frInst.instanceMatrix.needsUpdate = true;
  if (frInst.instanceColor) frInst.instanceColor.needsUpdate = true;
  g.add(frInst);

  /* 落花铺地（春末夏初 · 树干四周散一层粉瓣） */
  const petalGeo = new THREE.PlaneGeometry(0.075, 0.11);
  const petalN = 200;
  const petalInst = new THREE.InstancedMesh(petalGeo, MAT.peachPetal, petalN);
  const pcA = new THREE.Color(0xF7C7D4), pcB = new THREE.Color(0xE796AE);
  for (let i = 0; i < petalN; i++){
    const a = rr(0, TAU), d = R * rr(0.15, 0.95);
    _p.set(Math.cos(a) * d, rr(0.012, 0.05), Math.sin(a) * d);
    _q.setFromEuler(_e.set(Math.PI / 2, rr(0, TAU), rr(-0.4, 0.4)));
    _s.setScalar(rr(0.7, 1.4));
    _m.compose(_p, _q, _s); petalInst.setMatrixAt(i, _m);
    petalInst.setColorAt(i, pcA.clone().lerp(pcB, Math.random()));
  }
  petalInst.instanceMatrix.needsUpdate = true;
  if (petalInst.instanceColor) petalInst.instanceColor.needsUpdate = true;
  g.add(petalInst);

  g.userData.peachTree = true;
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
  loadAssetOnce('assets/BananaPlant.glb', 3.8 * leafScale, (src)=>{
    /* ⚠️ 同 placeAssets：摆放要放外层 holder。直接写 c.position.y 会**覆盖**
       loadAssetOnce 写的"底部对齐"偏移（B08 的同一处病，只是换了个调用点）。 */
    const holder = new THREE.Group();
    holder.position.y = trunkH - 0.25;
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
    holder.add(leaf);
    crown.add(holder);
    HOOKS.onAssetAttached?.();
  });
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
  const houseMat = Math.random() < 0.32 ? MAT.lotusPodAged : MAT.lotusPod;
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
  const padGeo = makeLilyPadGeo();
  const nPads = 2 + ((rnd()*2)|0);
  for (let i = 0; i < nPads; i++){
    const a = rr(0, TAU), rad = rr(0.24, 0.52);
    const pad = mesh(padGeo, MAT.lily, { name:'podPad', cast:false, receive:false });
    pad.position.set(Math.cos(a) * rad, 0.014 + rr(0, 0.004), Math.sin(a) * rad);
    pad.rotation.y = rr(0, TAU);
    const sc = rr(0.42, 0.68);                      // 0.52~0.84m 叶盘：与 12cm 莲房保持真实比例
    pad.scale.set(sc, 1, sc);
    g.add(pad);
  }
  const fr = Math.random();
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
      const pad = mesh(padGeo, MAT.lily, { name:'podPad', cast:false, receive:false });
      pad.position.set(fx + Math.cos(pa) * prad, 0.014 + rr(0, 0.004), fz + Math.sin(pa) * prad);
      pad.rotation.y = rr(0, TAU);
      const psc = rr(0.42, 0.62);
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

/* ══ 夏夜萤火虫（2026-09-20）══
   夜景最上镜的一笔。GPU 粒子（Points + 自定义 shader），零贴图、零 CPU 逐帧开销：
   漂移与明灭全部在顶点着色器里按独立相位算 —— 萤火不是常亮的点，是"呼吸式"明灭，
   且每只虫节奏不同。加法混色 + Bloom 后处理自动给它辉光。
   存在性/亮度由 11-loop 按「夏 · 夜 · 晴/薄雾」驱动 uOpacity（平滑淡入淡出）。
   userData.aoSkip：不进 GTAO 法线 pass（见 10-post 的 collectAOSkip）。 */
export function makeFireflies(){
  const N = GPU_TIER === 'low' ? 34 : 62;
  /* 三簇，权重和为 1：池南灌丛岸 / 东瓣近水榭 / 西瓣水边。基准点全在岸上，
     高 0.35~2.1m。rnd 固定种子 → 每次刷新萤火分布一致（与全园同范式）。 */
  const clusters = [
    { cx:-5.5, cz: 11.5, r: 3.6, w: 0.40 },
    { cx: 6.8, cz:  9.2, r: 3.0, w: 0.32 },
    { cx:-9.2, cz: -0.6, r: 2.8, w: 0.28 },
  ];
  const pos = new Float32Array(N * 3), pha = new Float32Array(N), amp = new Float32Array(N);
  let n = 0;
  for (const c of clusters){
    const cnt = Math.max(2, Math.round(N * c.w));
    for (let i = 0; i < cnt && n < N; i++){
      const ang = rnd() * TAU, rad = Math.sqrt(rnd()) * c.r;
      pos[n*3]   = c.cx + Math.cos(ang) * rad;
      pos[n*3+1] = 0.35 + rnd() * 1.75;
      pos[n*3+2] = c.cz + Math.sin(ang) * rad * 0.8;
      pha[n] = rnd();
      amp[n] = 0.25 + rnd() * 0.5;
      n++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  geo.setAttribute('aAmp', new THREE.BufferAttribute(amp, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: WIND.uTime, uOpacity: { value: 0 } },
    vertexShader: `
      attribute float aPhase;
      attribute float aAmp;
      uniform float uTime;
      varying float vGlow;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*0.31 + aPhase*6.2831)*aAmp + sin(uTime*0.13 + aPhase*13.7)*aAmp*0.5;
        p.y += sin(uTime*0.23 + aPhase*9.4)*0.28 + sin(uTime*0.11 + aPhase*5.1)*0.12;
        p.z += cos(uTime*0.27 + aPhase*6.2831)*aAmp;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float tw = 0.5 + 0.5*sin(uTime*(1.1 + aAmp*1.3) + aPhase*40.0);
        tw = pow(tw, 2.2);                         /* 呼吸：比 3.0 缓，暗态仍留微光（否则远景看不到虫） */
        vGlow = tw;
        /* 尺寸档（F3 二轮，2026-09-21）：旧版峰值 140px 糊团 → 首修 52/dist 钳 12px，
           但默认机位 30m 外全员被钳到 2.2px，夏夜截图里萤火"集体失踪"。
           108/dist：30m 处 3.6×(1~2.3)≈3.6~8px 清晰可点；10m 内钳到 15px 封顶，
           近景仍是亮点而不是光斑。辉光依旧交给 bloom。 */
        float dist = max(2.0, -mv.z);
        gl_PointSize = clamp((1.05 + aAmp*1.25) * (108.0 / dist), 2.6, 15.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity;
      varying float vGlow;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        /* 小实芯 + 一圈窄晕（F3 二轮）：暗态基数 0.10→0.20，远景暗虫不再消失；
           晕径 0.34→0.40、强度 0.45→0.55，亮灭两态都读得出"虫"而不是像素噪点。 */
        float core = smoothstep(0.14, 0.0, d);
        float halo = smoothstep(0.40, 0.10, d) * 0.55;
        float a = (core + halo) * (0.20 + 0.80*vGlow) * uOpacity;
        if (a < 0.003) discard;
        vec3 warm  = vec3(1.0, 0.83, 0.42);
        vec3 green = vec3(0.72, 1.0, 0.55);
        vec3 rgb = mix(warm, green, 0.25*vGlow);
        /* 亮起瞬间芯部 >1：加法混合在暗背景上稳稳越过夜阈值 0.86，bloom 给它拖光点；
           晕部仍 <1，不会炸成白饼。 */
        rgb *= 1.0 + core * 0.9 * vGlow;
        gl_FragColor = vec4(rgb, a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.aoSkip = true;       // 不进 GTAO 法线 pass
  points.userData.noMerge = true;
  points.visible = false;
  return points;
}

/* ══ 镜头天气层（2026-09-20）：镜前雨帘 / 雪粒 ══
   场景雨雪是"你在看雨"；这一层是"你在雨里"——粒子挂在相机下、恒占镜头前方，
   近大远小带视差。雨丝快落并沿风向倾斜，雪粒慢、大、左右飘。
   全部在 shader 内按 aSeed 循环，CPU 每帧只写 5 个 uniform。
   相机必须进场景图（scene.add(camera)）其子节点才会被渲染。
   挂进 AUX_PASS_HIDDEN：GTAO 法线 pass 期间整体隐藏（否则被 override 材质
   画成一屏贴镜头的纯色方块污染 AO）。折射相机只渲 layer 3，天然不含本层。 */
export function makeLensWeather(cam){
  if (!cam.parent) scene.add(cam);
  /* 近景粒子宜疏不宜密：上一版 180 粒 + 30px 大 sprite，糊成一屏毛玻璃。 */
  const N = GPU_TIER === 'low' ? 60 : 110;
  const data = new Float32Array(N * 3);
  for (let i = 0; i < N; i++){
    data[i*3]   = rnd() * 2 - 1;   // nx：水平随机
    data[i*3+1] = rnd();           // seed：循环相位
    data[i*3+2] = Math.pow(rnd(), 1.4);  // depth^1.4：多数粒子推远，近脸大粒只留少数
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: WIND.uTime, uAspect: { value: 1 },
      uRain: { value: 0 }, uSnow: { value: 0 },
      uWind: { value: new THREE.Vector2(0.2, 0) },
      uPR: { value: Math.min(2, renderer.getPixelRatio() || 1) },
    },
    vertexShader: `
      uniform float uTime, uAspect, uSnow, uPR;
      uniform vec2 uWind;
      varying float vDep;
      varying float vSeed;
      void main(){
        float nx = position.x;
        float seed = position.y;
        float dep = position.z;
        float snow = clamp(uSnow, 0.0, 1.0);
        float dist = mix(2.4, 9.0, dep);
        float z = -dist;
        float spanY = 0.50 * dist;                  /* tan(23°)≈0.42，留余量 */
        float spanX = spanY * uAspect;
        float rainCyc = fract(seed*7.31 + uTime*mix(9.0,18.0,dep)/(spanY*2.0));
        float snowCyc = fract(seed*3.17 + uTime*mix(1.1,2.4,dep)/(spanY*2.0));
        float cyc = mix(rainCyc, snowCyc, snow);
        float y = mix(spanY, -spanY, cyc);
        float rainX = (cyc-0.5)*(2.0 + uWind.x*2.6);
        float snowX = sin(uTime*0.9 + seed*41.0)*0.45 + uWind.x*(cyc-0.5)*0.8;
        float x = nx*spanX*0.96 + mix(rainX, snowX, snow);
        vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
        gl_Position = projectionMatrix * mv;
        vDep = dep; vSeed = seed;
        /* 雨：细高拉丝（高 ~28/11px，宽在片元里只取中间 ~2px）；
           雪：小绒片（9/4.5px），近景也不能大 —— 上一版 16px 软圆被 bloom 糊成白饼。 */
        float rainSize = mix(28.0, 11.0, dep);
        float snowSize = mix(9.0, 4.5, dep);
        gl_PointSize = mix(rainSize, snowSize, snow) * uPR;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uRain, uSnow;
      uniform vec2 uWind;
      varying float vDep;
      varying float vSeed;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float snow = clamp(uSnow, 0.0, 1.0);

        /* ── 雨丝：沿风向倾斜的细线 SDF ──
           上一版 smoothstep(0.5,0.03,|q.x|) 让"线宽"几乎等于 sprite 全宽 → 画成椭圆盘。
           宽度收紧到 |qr.x|<~0.05（≈2px @28px sprite），纵向头亮尾淡出成拖尾。 */
        float wa = uWind.x * 0.55;
        float ca = cos(wa), sa = sin(wa);
        vec2 qr = mat2(ca, -sa, sa, ca) * q;
        float lw = 0.045 / max(0.35, 1.0 - vDep*0.55);   /* 远处线略细 */
        float lineW = smoothstep(lw + 0.03, lw, abs(qr.x));
        float lineL = smoothstep(0.52, 0.30, abs(qr.y));   /* 两端收圆 */
        float trail = clamp(0.75 - qr.y * 0.55, 0.0, 1.0); /* 上端（头）亮、下端拖尾淡 */
        float rainShape = lineW * lineL * trail;

        /* ── 雪片：每粒自转一个角度的小椭圆绒片，核心半透、边缘收得相对实 ──
           不用大软边圆盘（bloom 下必成白饼）；再加两道正交淡瓣，远看有"片"的翻折感。 */
        float sa2 = vSeed * 6.2831 + uTime * (0.6 + vSeed * 0.8);
        float cs = cos(sa2), sn = sin(sa2);
        vec2 qs = mat2(cs, -sn, sn, cs) * q;
        qs.x *= 1.25;                    /* 椭圆 */
        float r = length(qs);
        float body = smoothstep(0.42, 0.30, r);                 /* 绒片主体，边缘较实 */
        float core = smoothstep(0.20, 0.0, r) * 0.35;           /* 中心微微厚实 */
        float bar1 = smoothstep(0.05, 0.0, abs(qs.x)) * smoothstep(0.40, 0.30, r) * 0.22;
        float bar2 = smoothstep(0.05, 0.0, abs(qs.y)) * smoothstep(0.40, 0.30, r) * 0.22;
        float snowShape = body * 0.8 + core + bar1 + bar2;

        float shape = mix(rainShape, snowShape, snow);
        float inten = mix(uRain * 0.5, uSnow * 0.6, snow);
        /* 越靠近镜头越淡：雨丝贴面时半透，不抢景；雪同理 */
        float depthFade = mix(0.55, 0.85, vDep);
        float a = shape * inten * depthFade;
        if (a < 0.004) discard;
        vec3 rainCol = vec3(0.72, 0.80, 0.90);
        vec3 snowCol = vec3(0.82, 0.88, 0.98);   /* 降亮度：纯白会被 bloom 糊开 */
        gl_FragColor = vec4(mix(rainCol, snowCol, snow), a);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.userData.aoSkip = true;
  AUX_PASS_HIDDEN.push(points);
  cam.add(points);
  points.visible = false;
  let rain = 0, snow = 0;
  return {
    points,
    update(dt, aspect, rainTarget, snowTarget, windVec){
      rain += (rainTarget - rain) * Math.min(1, dt * 2.2);
      snow += (snowTarget - snow) * Math.min(1, dt * 2.2);
      mat.uniforms.uAspect.value = aspect;
      mat.uniforms.uRain.value = rain;
      mat.uniforms.uSnow.value = snow;
      mat.uniforms.uWind.value.copy(windVec);
      points.visible = rain > 0.015 || snow > 0.015;
    },
    level: () => Math.max(rain, snow),
  };
}

bootMark('§6 植被');