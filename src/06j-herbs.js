// 06j-herbs: 草花水生 + 雾絮场（W8 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出。门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
// 合并方案 §3.2 的 06j-herbs（草花）+ 06k-mist（雾絮）：两者无依赖交叉，合并后 06 只剩一次门面。
// ⚠️ MIST / MIST_WHITE 是**可写对象**（mist-guard 与 12-env 按属性改写），导出原引用不重建。
// ⚠️ 草花段内原有一处 06d 门面（06 的 L462-468），已跳过不搬 —— 那是 06 对 06d 的转出。
// ⚠️ 依赖全单向：06j → 06c（叶/瓣/盘几何）、06d（视廊收敛）、06h（fbm3 噪声）、02-scene。
import { THREE, mergeGeometries } from '../vendor.js';
import { TAU, rr, CFG, rnd, mulberry32 } from './00-config.js';
import { jr } from './06a-rng.js';
import { MAT, WIND } from './01-materials.js';
import { mesh } from './03-factory.js';
import { POND_RADII } from './05-water.js';
import { makeBambooLeafGeo, makeLotusPetalGeo, makeLilyPadGeo, makeWisteriaFloretGeo } from './06c-organs.js';
import { addPerchingAnchor, installLilyCorridor } from './06d-corridor.js';
import { fbm3 } from './06h-rock.js';

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
      /* 高度差 2cm → 7.5cm（水位 +0.055~0.13）：叠在一起的叶盘拉开层次，碟沿不再互相切 */
      p.set(wx, CFG.water + 0.055 + jr() * 0.075, wz);
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
  const le = new THREE.Euler();
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
    p.set(px, CFG.water + 0.055 + rr(0, 0.075), pz);   // 同 makePondPads：高度差拉开（rr 调用次数不变）
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
  /* 花心重做（2026-10-14 用户近看反馈"花朵中心点不对、几何图片叠加"）：
     旧 = 一个金色小圆柱塞子（MAT.gold），近看是塑料扣。换成两件实体：
     ① 花托盅（MAT.lotusPod 黄绿、上宽下窄）② 花蕊环（8 根小柱实例，MAT.lotusSeed）。
     全部实例化，draw call +1。 */
  const coreInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.048, 0.030, 0.052, 12), MAT.lotusPod, nLotus);
  const stamenInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0038, 0.0030, 0.030, 5), MAT.lotusSeed, nLotus * 8);
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
    /* 茎顶收到花底内（2026-10-14 用户近看反馈"茎和花朵中心点不对"）：
       旧 +0.06 让茎尖高出花萼顶约 5cm —— 近看花心里竖着一截棍尖。花萼只盖到 +0.0095，
       茎必须止于萼内：+0.01。茎与花心的 xy 本来同轴（fx/fz 一致），错的是 z 这 6cm。 */
    const stemH = fy - CFG.water + 0.01;
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
    pp.set(fx, fy + 0.10*sc, fz); pq.identity(); ps.setScalar(sc);
    pm.compose(pp, pq, ps); coreInst.setMatrixAt(i, pm);
    /* 花蕊环：绕花托一圈、立在托面上沿（花心实体化第二步）。
       近看花心 = "黄绿托 + 一圈米色蕊丝"，不再是金色塞子。 */
    for (let k = 0; k < 8; k++){
      const sa = (k/8)*TAU + 0.4;
      pp.set(fx + Math.cos(sa)*0.024*sc, fy + 0.128*sc, fz + Math.sin(sa)*0.024*sc);
      pm.compose(pp, pq, ps.setScalar(sc));
      stamenInst.setMatrixAt(i*8 + k, pm);
    }
  }
  petalInst.instanceMatrix.needsUpdate = coreInst.instanceMatrix.needsUpdate = stamenInst.instanceMatrix.needsUpdate = true;
  g.add(petalInst, coreInst, stamenInst);
  return g;
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
