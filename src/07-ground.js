// 07-ground: from index.html inline 494..780
import { THREE, mergeGeometries } from '../vendor.js';
import { validateGeometry } from './09-lights.js';
import { CFG, TAU, rr, rnd, mulberry32, bootMark } from './00-config.js';
import { groundHeight } from './05-water.js';
import { groundTex, registerSeasonTint, MAT, registerWeatherRoles, pavingTex, pavingNormalTex } from './01-materials.js';
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
    p.setY(i, groundHeight(p.getX(i), p.getZ(i)));
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
      /* ⚠️⚠️ 2026-10-02：远山必须**不写深度**且 renderOrder=−2 —— 彩虹层（02-scene
         的 rainbowMesh，renderOrder −1）要画在山**前面**（"山前挂虹"，否则整条默认
         机位可见的天带都被这四层 0.76~0.95 不透明度的卡片挡在背后，虹怎么调都看不见，
         七轮取证 outputs/_diag/rb-intensity.mjs）。
         山 transparent 本就按距离排序画（远层先画），去掉 depthWrite 不改变层间
         视觉；而不透明园景先画并写深度，山 depthTest 照常被园景挡 ⇒ 原遮挡关系不变。 */
      m.material.depthWrite = false;
      m.renderOrder = -2;
      grp.add(m);
    }
    return grp;
  };
  g.add(makeRidge(78, 11, MAT.distantNear, 14));
  g.add(makeRidge(104, 17, MAT.distantDeep, 12));
  g.add(makeRidge(138, 24, MAT.distant, 10));
  g.add(makeRidge(176, 30, MAT.distantFar, 8));     // 最远一层，几乎融进天光
  /* ⚠️ 2026-09-23：**「柱状树林」整层删除**（老黄第 3 次指认"堂前池面那棵不知名的白色
     树形剪影"，并明确要求"完全隐藏或者直接删除"）。
     它被修过三轮都没断根：0f95688 把实心矩形换成树形剪影；2026-09-22 晚改成深灰绿
     0x74827A + 降不透明度 0.45 + 并进 DISTANT_MATS 跟天光。但**只要这层还在，就会有一棵
     淡色剪影立在堂前池北岸**——它 r≈95、基座 y=0，低机位下恰好压在池岸线上，还会被
     Reflector 镜像进水里；软化只能让它"淡"，不能让它"不在"。
     实证（outputs/_diag/winter-pond/CONFIRM-{with,without}-trees.png）：只隐藏这一层，
     池岸那棵树形剪影**连同它的水中倒影一起消失**，画面其余部分逐像素不变。
     ⚠️⚠️ 但下面这段 rr() 消耗**必须原样保留**，这是本项目的一条硬约束：
        全局随机流（mulberry32 固定种子）是一条链，柱状树林原先每棵消耗 4 次 rr()
        （方位抖动 / 半径抖动 / 树高 / forEach 里的横向缩放），共 46×4 = 184 次。
        少消耗一次，其后所有 rr()/rnd()（假山、峰石、竹柳、点景人物……）全部前移
        → 全园布局改变。所以：**循环照跑、结果丢掉，只删掉"建 InstancedMesh"那几步**。
        （同款手法见上面 makeRidge 里的"抽干旧版在这里消耗的全局 rnd"。） */
  {
    const n = 46;
    for (let i = 0; i < n; i++){
      rr(-0.06, 0.06);        // ① 方位角抖动
      rr(0.94, 1.08);         // ② 半径抖动
      rr(5, 12);              // ③ 树高
    }
    for (let i = 0; i < n; i++) rr(1.6, 3.4);   // ④ 横向缩放（原在 trees.forEach 内，排在 46 棵之后）
  }
  return g;
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

/* ══ 大雁（2026-09-30 · 老黄："春天和秋天增加大雁迁徙的场景"）══════════════════
   ⚠️ **尺寸与高度是被用户实拍打回重定的**（第一版体长 0.155m / 高度 24~31m），
      量出来的理由（outputs/_diag/goose-userview.mjs，用户视角 40m 外）：
        · 每只身体只有 **4~5 像素** ⇒ 远看就是"棕色小圆球"，读不出是雁；
        · 翅展 16~20px 也不足以让雁的剪影成立；
        · 队形整体落在**画面外**（屏幕坐标 3883,3321 而画面只有 900×1100）。
      现在的取值：体长 0.30m / 高度 13~17m ⇒ 40m 外体 9~10px、**翅展 37px**，
      雁的"长颈 + 大翅膀 V 形"剪影才读得出来。
      ⚠️ 仍刻意不做大：真实雁体长 0.6~0.75m，这里取其一半 —— 是"为远观可读而放大"，
        与小鸟 BIRD_SCALE=2.2 同一取舍。
   低模（体+颈+头+喙合成 1 个网格，两翅各留一个 pivot），与蜻蜓同一套"会动的东西"的做法
   （合并刚性体 / 翅膀留 pivot / noMerge）：13 只 × 5 件 = 65 个网格会白烧 draw call。 */
function makeGooseBodyGeo(){
  const L = 0.30, W = 0.120, H = 0.112;           // 体：长 / 半宽 / 半高
  const parts = [];
  const body = new THREE.SphereGeometry(1, 10, 7);
  body.scale(W * 1.55, H, L);
  parts.push(body);
  /* 尾：收成短楔（远看就是个尖） */
  const tail = new THREE.ConeGeometry(W * 0.72, L * 0.62, 6);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, H * 0.18, -L * 1.62);
  parts.push(tail);
  /* 颈：前伸上翘一小段（雁颈是识别特征，不能省） */
  const neck = new THREE.CylinderGeometry(W * 0.30, W * 0.40, L * 0.62, 6);
  neck.rotateX(-0.85);
  neck.translate(0, H * 0.72, L * 0.86);
  parts.push(neck);
  const head = new THREE.SphereGeometry(W * 0.34, 8, 6);
  head.scale(0.9, 0.9, 1.25);
  head.translate(0, H * 1.16, L * 1.18);
  parts.push(head);
  const beak = new THREE.ConeGeometry(W * 0.17, L * 0.30, 5);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, H * 1.10, L * 1.46);
  parts.push(beak);
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()), false);
  parts.forEach(p => p.dispose());
  return g;
}
/* 单翅：以肩为原点、沿 +x 展开的薄三角面。
   ⚠️ **翼面必须够宽**：远观认雁靠的是"两片大翅膀张成 V"，第一版的窄翅面
   （长 0.31m）加上 4px 的身体 ⇒ 整只读作一个点。现在翼长 0.60m、翼宽加倍。 */
function makeGooseWingGeo(){
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.30, 0.19, 0.60, 0.030);
  s.quadraticCurveTo(0.40, -0.105, 0, -0.056);
  const g = new THREE.ShapeGeometry(s, 8);
  g.rotateX(-Math.PI / 2);                 // 躺平，成水平翼面
  return g;
}
export function makeGoose(){
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color:0x6E6A62, roughness:0.86, metalness:0.0, envMapIntensity:0.7, flatShading:true });
  const tipMat  = new THREE.MeshStandardMaterial({ color:0x3A342E, roughness:0.9,  metalness:0.0, envMapIntensity:0.6 });  // 翼尖/尾羽偏深
  const wingMat = new THREE.MeshStandardMaterial({ color:0xB8B2A6, roughness:0.88, metalness:0.0, envMapIntensity:0.7, side:THREE.DoubleSide });
  const body = new THREE.Mesh(makeGooseBodyGeo(), bodyMat);
  g.add(body);
  /* 两翅：各挂一个 pivot，updateGooseFlock 每帧写 pivot.rotation.z（正反相扇动）。
     ⚠️ 肩点位置随体型一起放大（0.045→0.088）—— 体型放大后肩点还在原处，
     翅膀会缩在身体里、远观又变回一个点。 */
  const wGeo = makeGooseWingGeo();
  const wings = [];
  for (const sx of [-1, 1]){
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.088, 0.022, -0.02);
    const w = new THREE.Mesh(wGeo, wingMat);
    w.scale.x = sx;                          // 镜像
    pivot.add(w);
    pivot.userData = { sx };
    g.add(pivot); wings.push(pivot);
  }
  g.userData.wings = wings;
  g.userData.mats = { body: bodyMat, tip: tipMat, wing: wingMat };
  g.traverse(o=>{ if (o.isMesh) o.userData.noMerge = true; });
  return g;
}

/* ══ 鲜艳小鸟（2026-09-30 · "假山石和草皮中随机增加颜色鲜艳的小鸟"；
      2026-10-01 改成**分区羽色** + 会动）
   两种行为共用一套几何：**体+头+喙+尾+翅**合成 1 个网格（不做单件动画 ⇒ 可以整体合并）。
   ── 2026-10-01 改动：给几何加**顶点色分区**。理由：instanceColor 只能给整只鸟一个颜色，
      做不出"背深腹浅、头黑尾白"���自然界没有全色无斑的鸟（老黄："颜色不对，
      自然界很难找到这种纯色的鸟"。实测原版饱和度 0.98~1.00 = 纯色上限）。
      分区规则按真实鸟种：**背/体=基调色、头=头色、腹=腹色、翅=翼色、喙=暗灰、尾=深色**。
      顶点色与 instanceColor 相乘（shader 端 vertexColors + instanceColor 都开），
      所以 instanceColor 仍可逐只微调（乘一个接近白的色调），保持"每只略有差异"。
   ⚠️ 尺寸：体长约 0.115m —— 真实小鸟就这个量级；园子里"点景人物"是 1.6m 的剪影，
      小鸟要比它小一个数量级才对得起尺度。 */
export function makeSmallBirdGeo(){
  const L = 0.062, R = 0.030;
  /* 每个部件的分区键：body / head / beak / tail / wing */
  const parts = [];
  const tagged = [];
  const add = (geo, tag) => { parts.push(geo.toNonIndexed()); tagged.push(tag); };

  const body = new THREE.SphereGeometry(1, 9, 7);
  body.scale(R, R * 0.92, L);                 // 胖一点的纺锤（ Sparrow 体型）
  add(body, 'body');
  const head = new THREE.SphereGeometry(R * 0.74, 8, 6);
  head.translate(0, R * 0.52, L * 0.78);
  add(head, 'head');
  const beak = new THREE.ConeGeometry(R * 0.22, L * 0.36, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, R * 0.50, L * 1.06);
  add(beak, 'beak');
  const tail = new THREE.ConeGeometry(R * 0.62, L * 0.72, 4);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.34, 1);                    // 压扁成尾羽片
  tail.translate(0, R * 0.12, -L * 1.05);
  add(tail, 'tail');
  /* 折起的小翅：贴体两侧一片，远看是"身体有厚度"而不是光球 */
  for (const sx of [-1, 1]){
    const w = new THREE.SphereGeometry(1, 7, 5);
    w.scale(R * 0.30, R * 0.62, L * 0.62);
    w.translate(sx * R * 0.86, R * 0.06, -L * 0.06);
    add(w, 'wing');
  }
  const g = mergeGeometries(parts, false);
  /* 顶点色：按部位分区。写 1.0 的槽位保持"由 instanceColor 决定"，
     写实际分色的槽位则与 instanceColor 相乘（所以 instanceColor 要给接近白的基调）。
     ⚠️ 顶点色存**线性**空间（直接进顶点着色器），而 BIRD_PALETTE 的 hex 是 sRGB
        ⇒ 必须 convertSRGBToLinear，否则深色部位会明显偏亮、像没上色。 */
  {
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const col = new Float32Array(pos.count * 3).fill(1);
    const ZONE = { body: 'base', head: 'head', beak: 'beak', tail: 'tail', wing: 'wing' };
    let vi = 0;
    for (let k = 0; k < tagged.length; k++){
      const n = parts[k].attributes.position.count;
      const key = ZONE[tagged[k]];
      for (let j = 0; j < n; j++, vi++){
        if (key === 'beak'){ col[vi*3] = 0.55; col[vi*3+1] = 0.52; col[vi*3+2] = 0.48; continue; }
        if (key === 'tail'){ col[vi*3] = 0.42; col[vi*3+1] = 0.42; col[vi*3+2] = 0.44; continue; }
        /* body / wing / head：由 instanceColor 的基调 × 部位系数做分区
           —— 头略深（0.55）、翼很深（0.42）、背中等（1.0）、腹部浅（1.35）。
           腹浅靠"身体下半球"判定（顶点 y < 0 的一半），这正是真实鸟"背深腹浅"的由来。 */
        const y = pos.getY(vi);
        let f = key === 'head' ? 0.55 : key === 'wing' ? 0.42 : 1.0;
        if (key === 'body' && y < 0) f = 1.42;             // 腹部提亮
        if (key === 'body' && y > R * 0.2) f = 0.82;      // 背部压暗
        col[vi*3] = f; col[vi*3+1] = f; col[vi*3+2] = f;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    void nrm;
  }
  parts.forEach(p => p.dispose());
  return g;
}


bootMark('§7 地面围墙');