// 07-ground: from index.html inline 494..780
import { THREE, mergeGeometries } from '../vendor.js';
import { validateGeometry } from './09-lights.js';
import { CFG, TAU, rr, rnd, mulberry32, bootMark } from './00-config.js';
import { POND_RADII } from './05-water.js';
import { groundTex, registerSeasonTint, MAT, registerWeatherRoles, pavingTex, pavingNormalTex, makeDistantMat } from './01-materials.js';
import { mesh, makeWallRun, makeWallCap, box } from './03-factory.js';
/* ══════════════════════════════════════════════════════════════
   7 · 地面 · 围墙 · 远山
   ══════════════════════════════════════════════════════════════ */
export function makeGround(){
  const g = new THREE.Group();
  const W = CFG.garden.w, D = CFG.garden.d;
  const geo = new THREE.PlaneGeometry(W + 26, D + 26, 48, 40);
  geo.rotateX(-Math.PI/2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++){      // 自然微起伏 + 池内下挖（保证不冒出水面）
    const x = p.getX(i), z = p.getZ(i);
    const h = Math.sin(x*0.19)*0.28 + Math.cos(z*0.16)*0.24 + Math.sin((x+z)*0.09)*0.16;
    const dx = x, dz = z - 3.0;
    let ang = Math.atan2(dz, dx);
    if (ang < 0) ang += TAU;
    const ri = Math.min(POND_RADII.length - 1, Math.floor(ang / TAU * POND_RADII.length));
    const d = Math.hypot(dx, dz) / Math.max(0.5, POND_RADII[ri]);
    const dip = d < 1.35 ? (1 - d / 1.35) * 2.2 : 0;
    p.setY(i, h - 0.34 - dip);
  }
  geo.computeVertexNormals();
  const gt = groundTex.clone();
  gt.needsUpdate = true; gt.repeat.set(12, 10);   // 配合 512² 多尺度贴图，让色块有明显的尺寸感
  const mat = registerSeasonTint(MAT.grass.clone(), 'tinGrass'); mat.map = gt;
  registerWeatherRoles(mat, { snow: 1, wet: 1 });    // 地面是最大的一块可见面，必须进雪/湿表
  const m = mesh(geo, mat, { cast:false, name:'ground' });
  g.add(m);
  return g;
}

/* 铺地：黑白菱形棋盘步道 */
export function makePaving(w, d, x, z, y = 0.055){
  const t = pavingTex.clone();
  t.needsUpdate = true;
  t.repeat.set(w/2.6, d/2.6);
  const mat = registerWeatherRoles(
    new THREE.MeshStandardMaterial({ map:t, roughness:0.82, metalness:0.02, envMapIntensity:0.5 }),
    { snow: 1, wet: 1 });                          // 铺地是主步道，同样要积雪/打湿
  const nt = pavingNormalTex.clone(); nt.needsUpdate = true; nt.repeat.copy(t.repeat);
  mat.normalMap = nt; mat.normalScale.set(0.7, 0.7);
  const m = mesh(new THREE.PlaneGeometry(w, d), mat, { cast:false, name:'paving' });
  m.rotation.x = -Math.PI/2;
  m.position.set(x, y, z);
  return m;
}

/* 围墙四面（含漏窗 / 月洞门） */
export function makeWalls(){
  const g = new THREE.Group();
  const W = CFG.garden.w, D = CFG.garden.d;
  const H = CFG.wall.h, T = CFG.wall.t;

  // —— 北墙（无门洞，带漏窗）
  const northHoles = [];
  for (let i = -2; i <= 2; i++){
    if (i === 0) continue;
    northHoles.push({ x: i * 9.2, y: 2.7, r: 0.92, n: 8, rot: Math.PI/8 });
  }
  const north = makeWallRun({ len: W, h: H, t: T, holes: northHoles });
  north.position.set(0, 0, -D/2);
  g.add(north);
  g.add(withPos(makeWallCap(W, T, H), 0, 0, -D/2));

  // —— 南墙（中央月洞门 + 漏窗）
  const southHoles = [
    { type:'circle', x: 0, r: 1.62 },
    { type:'poly',   x: -12.5, y: 2.7, r: 0.92, n: 8, rot: Math.PI/8 },
    { type:'poly',   x:  12.5, y: 2.7, r: 0.92, n: 8, rot: Math.PI/8 },
    { type:'poly',   x: -21.0, y: 2.7, r: 0.8,  n: 6, rot: 0 },
    { type:'poly',   x:  21.0, y: 2.7, r: 0.8,  n: 6, rot: 0 },
  ];
  const south = makeWallRun({ len: W, h: H, t: T, holes: southHoles });
  south.position.set(0, 0, D/2);
  g.add(south);
  g.add(withPos(makeWallCap(W, T, H), 0, 0, D/2));
  // 月洞门下沉门槛石阶
  const sill = mesh(box(4.0, 0.22, 1.4), MAT.stoneDark, { name:'threshold' });
  sill.position.set(0, 0.11, D/2 + 0.1);
  g.add(sill);

  // —— 东墙
  const eastHoles = [
    { type:'poly', x: -14, y: 2.7, r: 0.9, n: 6, rot: 0 },
    { type:'poly', x:  2,  y: 2.7, r: 0.9, n: 8, rot: Math.PI/8 },
  ];
  const east = makeWallRun({ len: D, h: H, t: T, holes: eastHoles });
  east.rotation.y = Math.PI/2;
  east.position.set(W/2, 0, 0);
  g.add(east);
  const eastCap = makeWallCap(D, T, H);
  eastCap.rotation.y = Math.PI/2;
  eastCap.position.set(W/2, 0, 0);
  g.add(eastCap);

  // —— 西墙
  const westHoles = [
    { type:'poly', x: -10, y: 2.7, r: 0.9, n: 8, rot: Math.PI/8 },
    { type:'poly', x:  8,  y: 2.7, r: 0.9, n: 6, rot: 0 },
  ];
  const west = makeWallRun({ len: D, h: H, t: T, holes: westHoles });
  west.rotation.y = Math.PI/2;
  west.position.set(-W/2, 0, 0);
  g.add(west);
  const westCap = makeWallCap(D, T, H);
  westCap.rotation.y = Math.PI/2;
  westCap.position.set(-W/2, 0, 0);
  g.add(westCap);

  return g;
}
function withPos(obj, x, y, z){ obj.position.set(x, y, z); return obj; }

/* 远山剪影 + 柱状树林（围墙外的留白层） */
export function makeDistantHills(){
  const g = new THREE.Group();
  // 远山：起伏山脊剪影（多峰、两端收拢）
  const makeRidge = (radius, height, mat, count) => {
    const grp = new THREE.Group();
    for (let i = 0; i < count; i++){
      const a = (i/count)*TAU + rr(-0.16,0.16);
      const r = radius * rr(0.9, 1.1);
      const h = height * rr(0.5, 1.28);
      const w = rr(26, 54);
      /* 山脊线 = 2~4 个高斯峰叠加，外包 sin 包络收两端。
         旧版每个折点独立 rr(0.35,1.05)，峰脊是随机锯齿折线，
         8~12 段在暮色里读成一排三角锥剪纸（2026-09-21 走查 F6）。
         高斯峰参数每卡固定、顶点只做函数求值 → 轮廓圆润连绵。 */
      /* 高斯峰走独立随机流：全局 rnd 是固定种子，消耗量一变就会重排其后的
         远树乃至全园布局（与雾气同一条戒律）。本地按卡片定种子。 */
      const lr = mulberry32((0x51d6e ^ (i * 73856093)) >>> 0);
      const lrr = (lo, hi) => lo + lr() * (hi - lo);
      const lobes = [];
      const nl = 2 + ((lr() * 3) | 0);
      for (let q = 0; q < nl; q++){
        lobes.push({ c: lrr(0.18, 0.82), w: lrr(0.10, 0.26), hh: lrr(0.55, 1.0) });
      }
      /* 抽干旧版在这里消耗的全局 rnd：1 次 n 选择 + (nOld+1) 次顶点 rr，
         保持之后远树/全园的随机序列分毫不差。 */
      const nOld = 8 + ((rnd() * 4) | 0);
      for (let k = 0; k <= nOld; k++) rr(0.35, 1.05);
      const sh = new THREE.Shape();
      sh.moveTo(-w/2, 0);
      const n = 28;
      for (let k = 0; k <= n; k++){
        const t = k / n;
        const px = -w/2 + w * t;
        const env = Math.pow(Math.sin(Math.PI * t), 0.62);   // 两端收拢
        let ridge = 0.45;                                     // 山麓底高，避免峰间塌成尖谷
        for (const L of lobes){
          const q = (t - L.c) / L.w;
          ridge += L.hh * Math.exp(-q * q * 2.2);
        }
        sh.lineTo(px, h * env * Math.min(1.12, ridge));
      }
      sh.lineTo(w/2, 0);
      sh.closePath();
      /* F6：给山脊几何写归一化 UV（ShapeGeometry 默认 UV 是本地坐标原值）。
         远山材质按 vHillUv.y 从山麓到脊线垂直溶进雾色，需要 0..1 的高度。 */
      const hillGeo = new THREE.ShapeGeometry(sh);
      {
        const pos = hillGeo.attributes.position;
        const uvArr = new Float32Array(pos.count * 2);
        let maxY = 1e-4;
        for (let j = 0; j < pos.count; j++) maxY = Math.max(maxY, pos.getY(j));
        for (let j = 0; j < pos.count; j++){
          uvArr[j*2]     = (pos.getX(j) + w/2) / w;
          uvArr[j*2 + 1] = pos.getY(j) / maxY;
        }
        hillGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
      }
      const m = mesh(hillGeo, mat, { cast:false, receive:false });
      m.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
      m.lookAt(0, 0, 0);
      grp.add(m);
    }
    return grp;
  };
  g.add(makeRidge(78, 11, MAT.distantNear, 14));
  g.add(makeRidge(104, 17, MAT.distantDeep, 12));
  g.add(makeRidge(138, 24, MAT.distant, 10));
  g.add(makeRidge(176, 30, MAT.distantFar, 8));     // 最远一层，几乎融进天光
  // 柱状树林（近一点的剪影）。
  // ⚠️ 2026-09-22 修"池北白框"（老黄指认）：旧版是纯色 quad（PlaneGeometry 实心矩形
  //    + makeDistantMat 灰白远山色），46 棵围 r=62 一圈；北侧树群与地平线带重叠后，
  //    一片片纯色矩形叠雾色，读作"插在池边的白色矩形板"（带水面倒影）。
  //    两处修正：
  //    ① 程序化树形剪影贴图（makeTreeSilhouetteTex，固定形状零随机）——quad 不再是矩形；
  //    ② 半径 62→95：沉进远山脊(78/104)之间的空档，地平线处只留一层矮剪影。
  //    ⚠️ 循环体 rr() 调用次数保持 4 处不变 —— 多一次全局随机流就全园布局后移。
  const trees = [];
  const n = 46;
  for (let i = 0; i < n; i++){
    const a = (i/n)*TAU + rr(-0.06,0.06);
    const r = 95 * rr(0.94, 1.08);
    trees.push({
      x: Math.cos(a)*r, z: Math.sin(a)*r,
      h: rr(5, 12), ry: a,
    });
  }
  const treeGeo = new THREE.PlaneGeometry(1, 1);
  treeGeo.translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(treeGeo, makeDistantMat(0x8D9899, 0.62, 0.26,
    { map: makeTreeSilhouetteTex() }), n);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  trees.forEach((t, i)=>{
    p.set(t.x, 0, t.z);
    q.setFromEuler(new THREE.Euler(0, -t.ry + Math.PI/2, 0));
    s.set(rr(1.6, 3.4), t.h, 1);
    m.compose(p, q, s); inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  g.add(inst);
  return g;
}

/* 柱状树林的树形剪影贴图（2026-09-22 · 治"池北白框"）。
   白色树形 + 透明底：颜色由 makeDistantMat 的 uColor 上，形状由 alpha 裁出。
   江南远树读作"馒头冠"：三层叠冠 + 短干。固定坐标零随机 —— 不碰全局随机流。 */
function makeTreeSilhouetteTex(){
  const W = 128, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  // 短干（底部居中，向上收窄）
  g.beginPath();
  g.moveTo(56, H); g.lineTo(59, 158); g.lineTo(69, 158); g.lineTo(72, H);
  g.closePath(); g.fill();
  // 三层叠冠（下宽上窄，椭圆）
  const crown = (cy, rx, ry) => { g.beginPath(); g.ellipse(64, cy, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
  crown(126, 52, 40);
  crown(84, 44, 34);
  crown(46, 32, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ── 局部刚性合并（P0-1 · draw call 回归，2026-09-20）──
   与 mergeStatics 的分工：后者管**世界空间的静态构件**（按材质桶 + 阴影标记 + 顶点色分桶，
   烘的是 matrixWorld）；本函数管"**整体一起动、但内部各件永不相对位移**"的小装配 ——
   蜻蜓的腹部/胸/头/复眼、灯笼的盖与绳。
   ⚠️ 判据只有一条：这组网格必须共享同一个父级，且**没有任何动画作用在它们身上**。
   翅膀在各自的 pivot 上振翅（rotation.z 每帧写），所以翅膀绝不能进来。
   违规的后果是静默的 —— 烘进几何后逐帧写 position/rotation 就不生效了，不报错、只是错位。
   失败时原样返回（不静默丢件）；三角形数不变，只减对象数。 */
function mergePartMeshes(meshes, material, name){
  if (!Array.isArray(meshes) || meshes.length < 2) return meshes;
  const geos = [];
  for (const o of meshes){
    o.updateMatrix();
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrix);
    if (o.matrix.determinant() < 0 && g.index){      // 镜像：翻绕序，否则法线与朝向相反
      const ix = g.index.array;
      for (let t3 = 0; t3 + 2 < ix.length; t3 += 3){ const tmp = ix[t3]; ix[t3] = ix[t3 + 2]; ix[t3 + 2] = tmp; }
      g.index.needsUpdate = true;
    }
    if (!g.index){                                   // 统一为带索引
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv){                           // 属性集必须一致，否则合并失败
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    const keep = new THREE.BufferGeometry();
    keep.setAttribute('position', g.attributes.position);
    keep.setAttribute('normal',   g.attributes.normal);
    keep.setAttribute('uv',       g.attributes.uv);
    if (g.attributes.color) keep.setAttribute('color', g.attributes.color);
    keep.setIndex(g.index);
    geos.push(keep);
  }
  let merged = null;
  try { merged = mergeGeometries(geos, false); } catch(e){ merged = null; }
  if (!merged) return meshes;                        // 合并失败 → 原样返回，画面不受影响
  validateGeometry(merged, 'partMerge·' + (name || material.name || ''));
  const m = new THREE.Mesh(merged, material);
  m.name = name || 'partMerged';
  m.castShadow    = meshes[0].castShadow;
  m.receiveShadow = meshes[0].receiveShadow;
  for (const o of meshes){ if (o.parent) o.parent.remove(o); o.geometry.dispose(); }
  return [m];
}

/* ── 蜻蜓 ──
   程序化精密建模（10 节腹部 + 复眼 + 四片带翅脉的翅）。
   这里不走 AI 生成模型：导入的蜻蜓翅膀是死的，而振翅是它可信的前提 */
function makeDragonflyWingGeo(){
  const L = 0.185, W = 0.050;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(L*0.26,  W*1.00, L*0.74,  W*0.90, L,       W*0.16);
  s.bezierCurveTo(L*1.02,  W*0.00, L*0.80, -W*0.58, L*0.50, -W*0.74);
  s.bezierCurveTo(L*0.22, -W*0.86, L*0.06, -W*0.40, 0,       0);
  return new THREE.ShapeGeometry(s, 14);
}
export function makeDragonfly(){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color:0x2E4A44, roughness:0.48, metalness:0.18, envMapIntensity:0.9, flatShading:true });
  const eyeMat  = new THREE.MeshStandardMaterial({ color:0x141F1D, roughness:0.22, metalness:0.45, envMapIntensity:1.3 });
  const wingMat = new THREE.MeshStandardMaterial({ color:0xD2E6EA, roughness:0.3, metalness:0.0,
                                                   transparent:true, opacity:0.40, side:THREE.DoubleSide,
                                                   depthWrite:false, envMapIntensity:0.9 });
  /* 腹部：10 节，自粗到细。
     ⚠️ 这 10 节 + 胸 + 头 + 复眼是**刚性同体** —— 只在 g 的局部空间里静止，飞行时靠
     `d.position` / `d.rotation` 整体搬运，没有任何动画作用在单节上 → 烘成 1 个网格。
     合并前每只蜻蜓 18 个网格（10 节 + 胸 + 头 + 2 眼 + 4 翅），7 只 = 126 个对象，
     而它们同时进主 pass 与池面镜像 pass → 每次渲染多约 250 次 draw call
     （实测：全场景 147 个无名网格里 126 个是蜻蜓，见 probe/_p01-anon.mjs）。
     翅膀必须留在各自的 pivot 上（`updateDragonflies` 每帧写 w.rotation.z），所以不入合并。 */
  const bodyParts = [];
  for (let i = 0; i < 10; i++){
    const r = 0.0115 * (1 - i * 0.072);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, 0.0162, 7), bodyMat);
    seg.rotation.x = Math.PI / 2;
    seg.position.set(0, 0, -0.026 - i * 0.0168);
    g.add(seg); bodyParts.push(seg);
  }
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.017, 9, 7), bodyMat);
  thorax.scale.set(1, 0.95, 1.55); thorax.position.z = 0.004; g.add(thorax); bodyParts.push(thorax);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 9, 7), bodyMat);
  head.scale.set(1.3, 1, 0.85); head.position.z = 0.028; g.add(head); bodyParts.push(head);
  const eyeParts = [];
  [-1, 1].forEach(sx=>{                      // 一对大复眼
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0084, 9, 7), eyeMat);
    eye.position.set(sx * 0.0090, 0.0038, 0.0315);
    g.add(eye); eyeParts.push(eye);
  });
  mergePartMeshes(bodyParts, bodyMat, 'dragonflyBody').forEach(m => g.add(m));
  mergePartMeshes(eyeParts,  eyeMat,  'dragonflyEye').forEach(m => g.add(m));
  // 四翅（前后翅反相振翅）
  const wGeo = makeDragonflyWingGeo();
  const wings = [];
  [[-1,  0.020, 0], [1,  0.020, 0], [-1, -0.013, 1.7], [1, -0.013, 1.7]].forEach(([sx, zz, ph])=>{
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.0075, 0.0125, zz);
    const w = new THREE.Mesh(wGeo, wingMat);
    w.rotation.y = sx > 0 ? 0 : Math.PI;
    pivot.add(w);
    pivot.userData = { sx, ph };
    g.add(pivot); wings.push(pivot);
  });
  g.userData.wings = wings;
  // 会动的东西绝不能参与静态几何合并
  g.traverse(o=>{ if (o.isMesh) o.userData.noMerge = true; });
  return g;
}

bootMark('§7 地面围墙');