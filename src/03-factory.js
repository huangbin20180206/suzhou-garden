// 03-factory: from index.html inline 616..1300
import { THREE, mergeGeometries } from '../vendor.js';
import { registry, mulberry32, TAU, bootMark } from './00-config.js';
import { MAT } from './01-materials.js';
/* ══════════════════════════════════════════════════════════════
   3 · 通用构件工厂
   ══════════════════════════════════════════════════════════════ */
export function mesh(geo, mat, { cast = true, receive = true, name } = {}){
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  if (name) m.name = name;
  registry.meshes++; registry.geos++;
  return m;
}
export const box = (w,h,d)=> new THREE.BoxGeometry(w,h,d);

/* 立柱（微收分） */
export function makeColumn(h, r = 0.24, mat = MAT.wood, seg = 10){
  const g = new THREE.CylinderGeometry(r*0.92, r, h, seg);
  return mesh(g, mat, { name:'column' });
}

/* 椽头 / 斗拱小方块 —— 用实例化批量生成 */
export function instancedBoxes(list, mat, size = [0.26,0.26,0.34]){
  if (!list.length) return null;
  const g = box(...size);
  const inst = new THREE.InstancedMesh(g, mat, list.length);
  inst.castShadow = true; inst.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
        p = new THREE.Vector3(), s = new THREE.Vector3(1,1,1);
  list.forEach((it, i)=>{
    p.set(it.x, it.y, it.z);
    q.setFromEuler(new THREE.Euler(0, it.ry || 0, 0));
    s.set(1, 1, it.sz || 1);
    m.compose(p, q, s); inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  registry.meshes++; registry.geos++;
  return inst;
}

/* 通用实例化：任意几何 + 摆位列表（支持 rx/ry/rz 与三轴缩放） */
export function instancedGeo(geo, list, mat, { cast = true, receive = true } = {}){
  if (!list.length) return null;
  const inst = new THREE.InstancedMesh(geo, mat, list.length);
  inst.castShadow = cast; inst.receiveShadow = receive;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
        p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach((it, i)=>{
    p.set(it.x, it.y, it.z);
    q.setFromEuler(new THREE.Euler(it.rx || 0, it.ry || 0, it.rz || 0));
    s.set(it.sx || 1, it.sy || 1, it.sz || 1);
    m.compose(p, q, s); inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  registry.meshes++; registry.geos++;
  return inst;
}

/* 带瓦垄波纹的板：给游廊这类直线坡屋面用。
   波纹只作用在顶面，沿局部 X 排列（= 垂直于走廊走向），与瓦垄实际走向一致 */
export function makeCorrugatedSlab(w, h, d, tileW = 0.36, amp = 0.05){
  const segW = Math.max(8, Math.round(w / (tileW / 4)));
  const geo = new THREE.BoxGeometry(w, h, d, segW, 1, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++){
    if (p.getY(i) <= 0) continue;                 // 只顶面起伏
    const x = p.getX(i);
    p.setY(i, p.getY(i) + amp * Math.abs(Math.sin(x * Math.PI / tileW)));
  }
  geo.computeVertexNormals();
  return geo;
}

/* 一攒斗拱：坐斗 → 十字拱 → 三升 → 向外挑出的昂。
   合并成单一 BufferGeometry，整排只占一次 instanced draw call。
   ⚠️ 原点放在**底部**（y 从 0 到 DOUGONG_H）：斗拱在真实结构里的作用就是
   「填满额枋顶面到屋面之间的净空」，所以每攒按自己的净空做 Y 向缩放，
   底坐落在额枋上、顶顶住屋面 —— 这样它不可能悬空。 */
export const DOUGONG_H = 0.43;
export function makeDougongGeo(){
  const parts = [];
  const put = (w, h, d, x, y, z)=>{ const gg = box(w, h, d); gg.translate(x, y, z); parts.push(gg); };
  put(0.44, 0.20, 0.44,  0.00, 0.10,  0.00);     // 坐斗（大斗）
  put(1.02, 0.12, 0.15,  0.00, 0.26,  0.00);     // 横拱（沿面宽）
  put(0.15, 0.12, 1.02,  0.00, 0.26,  0.00);     // 纵拱（沿进深）
  put(0.20, 0.11, 0.20, -0.46, 0.375, 0.00);     // 三升：拱端小斗
  put(0.20, 0.11, 0.20,  0.46, 0.375, 0.00);
  put(0.20, 0.11, 0.20,  0.00, 0.375, -0.46);
  put(0.20, 0.11, 0.20,  0.00, 0.375,  0.46);
  put(0.15, 0.12, 0.62,  0.00, 0.24,  0.40);     // 昂：向檐外挑
  const merged = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  return merged;
}

/* 中式屋顶：曲面举折（凹曲屋面）+ 翼角起翘 + 山花 + 脊饰
   以矩形平面参数化高度场生成四坡曲面，法线朝上，再叠加角部起翘 */
export function makeChineseRoof({ w, d, hRidge, ridgeLen, lift = 1.5,
                           segX = 200, segZ = 120, mat = MAT.roof,
                           tileW = 0.36, tileAmp = 0.055 }){
  const W = w / 2, D = d / 2;
  const L = Math.max(0.8, Math.min(ridgeLen / 2, W - 0.8));
  const group = new THREE.Group();

  /* ── 举折剖面 ──
     中式屋面不是一条幂曲线，而是按檩位分段、逐段加陡的折线（举架：檐口最缓、近脊最陡）。
     这里用四条折线段代替原来的 (1-t)^1.55：形状几乎一样，但"分片"是真的 ——
     折点落在各檩位上，与下面的分片拓扑一致。
     P_T 是从正脊量起的归一化进深，P_H 是同位置的高度比例（0=正脊、1=檐口）。 */
  const P_T = [0, 0.25, 0.50, 0.75, 1.00];
  const P_H = [1, 0.67241, 0.39655, 0.17241, 0];
  const profile = (t)=>{
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < P_T.length - 1; i++){
      if (t <= P_T[i + 1]){
        const k = (t - P_T[i]) / (P_T[i + 1] - P_T[i]);
        return hRidge * (P_H[i] + (P_H[i + 1] - P_H[i]) * k);
      }
    }
    return 0;
  };
  /* 歇山拓扑：正脊只到 x=±L；端坡（撒头）**不到脊** —— 它在 x=±L 处断开，
     断口由竖直山花面封住（见 ⑤）。TS 是山花底的相对位置（0.5 = 正脊到檐口的一半）。
       · 主坡：高度只随进深 z 变（沿 x 是一整片柱面）→ 平整的大坡。
       · 撒头：高度只随 x 变，沿 x 也走同一条举折 → 与主坡在垂脊处**逐点同高**。 */
  const TS = 0.5, zsG = TS * D, ysG = profile(TS);
  const xHip = (t)=> t <= TS ? L : L + (W - L) * (t - TS) / (1 - TS);
  const corner = (x, z)=> Math.pow(Math.min(1, Math.abs(x) / W) * Math.min(1, Math.abs(z) / D), 1.7);
  const heightAt = (x, z)=>{
    const ax = Math.abs(x), az = Math.abs(z), tz = Math.min(1, az / D);
    const t = ax <= xHip(tz) ? tz
            : TS + (1 - TS) * Math.min(1, (ax - L) / Math.max(0.001, W - L));
    return profile(t) + lift * corner(x, z);      // 后一项 = 角部起翘
  };

  /* ① 屋面：**按举折分片的真拓扑** —— 主坡（正脊两侧）+ 撒头（两端坡）+ 竖直山花面。
     主坡与撒头在垂脊处共用同一组 t 采样（tRows 里保证有一行正好落在 TS），
     所以两者的边界**逐点重合**，垂脊正好压在那条接缝上，不会漏光。
     瓦垄仍是同一张网格的顶点位移（零额外 draw call）：主坡随 x、撒头随 z，垄向与真实铺瓦一致。
     靠近垂脊 0.28m 内把波纹收到 0 —— 瓦在这里本来就要裁齐，也让接缝两侧同高。 */
  const tRows = [];
  for (let i = 0; i <= segZ; i++) tRows.push(i / segZ);
  if (!tRows.some(t => Math.abs(t - TS) < 1e-9)){ tRows.push(TS); tRows.sort((a, b)=> a - b); }
  const hipFade = (d)=>{ const q = Math.max(0, Math.min(1, d / 0.28)); return q * q * (3 - 2 * q); };

  const makePatch = (rows, nCols, at, flip, name)=>{
    const pos = [], uvs = [], idx = [];
    for (let i = 0; i < rows.length; i++)
      for (let j = 0; j <= nCols; j++){
        const q = at(rows[i], j, nCols);
        pos.push(q[0], q[1], q[2]); uvs.push(q[3], q[4]);
      }
    for (let i = 0; i < rows.length - 1; i++)
      for (let j = 0; j < nCols; j++){
        const a = i * (nCols + 1) + j, b = a + 1, c = a + nCols + 1, e = c + 1;
        if (flip) idx.push(a, b, c,  b, e, c);
        else      idx.push(a, c, b,  b, c, e);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return mesh(g, mat, { name, cast:false });
  };

  /* 瓦垄截面（2026-09-27 远香堂高精化第 2 件）。
     原式 `Math.abs(Math.sin(x·π/tileW))` 是**对称**的：每个周期被 0 点均分、脊在 ±tileW/2。
     真实筒瓦的截面**不对称** —— 一垄由「半圆筒瓦头（高）」+「两片板瓦搭接（缓坡）」构成，
     读出来的感觉是"一侧圆凸、一侧平缓"，而不是"两边对称的波纹"。
     这里把它改成不对称的周期函数（u∈[0,1) 为该垄内的相位）：
       u ∈ [0, 0.5]  → 板瓦侧：从 0 平缓升到脊（smoothstep，避免折线感）
       u ∈ [0.5, 1)  → 筒瓦侧：从脊快速落到谷底，并略微多落一点（筒瓦头压过板瓦）
     峰值仍为 1 ⇒ 与 tileAmp 的量纲/观感不变，只是**波形**从对称变不对称。
     谷底额外下压 8% 制造"板瓦侧微凹"，这是"读得出搭接"的关键那一笔。 */
  const tileProfile = (u)=>{
    u = u - Math.floor(u);                       // 归一到 [0,1)
    if (u < 0.5){ const k = u / 0.5; return 0.92 * (k * k * (3 - 2 * k)); }
    const k = (u - 0.5) / 0.5;
    return 1.0 - 1.08 * (k * k * (3 - 2 * k));  // 谷底压到 -0.08（微凹）
  };
  // 主坡：行=举折折点（正脊→檐口），列在各自的半宽内均分 —— 半宽随垂脊外扩，列均匀 ⇒ 瓦垄间距恒定
  const mainAt = (sgn)=> (t, j, nCols)=>{
    const xh = xHip(t), z = sgn * t * D, x = ((j / nCols) * 2 - 1) * xh;
    const rip = tileAmp * tileProfile(x / tileW) * hipFade(xh - Math.abs(x));
    return [x, profile(t) + lift * corner(x, z) + rip, z, x * 0.34, z * 0.34];
  };
  group.add(makePatch(tRows, segX, mainAt(1),  false, 'roofMainS'));
  group.add(makePatch(tRows, segX, mainAt(-1), true,  'roofMainN'));

  // 撒头：每个 x 一行，行内 z 均分；沿 x 走同一条举折剖面
  const segV = Math.max(24, Math.min(160, Math.round(2 * D / 0.09)));
  const endRows = tRows.filter(t => t >= TS - 1e-9);
  const endAt = (sgn)=> (t, k, nCols)=>{
    const x = sgn * (L + (W - L) * (t - TS) / (1 - TS));
    const z = -t * D + 2 * t * D * (k / nCols);
    /* ⚠️ 撒头必须用**同一个** tileProfile：主坡换成不对称波形后，两坡若还用旧的
       |sin|，垂脊两侧的瓦垄形状就会对不上 —— 那是屋顶上最刺眼的一类破绽。 */
    const rip = tileAmp * tileProfile(z / tileW) * hipFade(t * D - Math.abs(z));
    return [x, profile(t) + lift * corner(x, z) + rip, z, x * 0.34, z * 0.34];
  };
  /* ⚠️ 撒头的绕序与主坡**相反**：撒头的行沿 +x、列沿 +z，用主坡那套绕序算出的法线朝下
     （法线 = 行向量 × 列向量 = x̂ × ẑ = −ŷ）；主坡是行沿 +z、列沿 +x → +ŷ。
     原来照抄了主坡的 flip，两片端坡法线都朝下：MAT.roof 是 DoubleSide，靠 gl_FrontFacing
     把光照"兜"回了正面（所以肉眼没炸），但 ① GTAO 的法线 pass 读到的仍是朝下的法线
     ② 积雪判据 upness = smoothstep(0.30,0.78, −0.9) = 0 → **端坡永远不积雪**。 */
  group.add(makePatch(endRows, segV, endAt(1),  true,  'roofEndE'));
  group.add(makePatch(endRows, segV, endAt(-1), false, 'roofEndW'));

  /* ② 檐口封边（滴水瓦口）：沿四周向下拉一圈，让屋顶有厚度、不再"透视" */
  const fasciaH = 0.38, N = 18;
  const fv = [], fi = [];
  const addStrip = (p1, p2)=>{
    const y1 = heightAt(p1.x, p1.z), y2 = heightAt(p2.x, p2.z);
    const b = fv.length / 3;
    fv.push(p1.x, y1, p1.z,  p2.x, y2, p2.z,  p2.x, y2 - fasciaH, p2.z,  p1.x, y1 - fasciaH, p1.z);
    fi.push(b, b+2, b+1,  b, b+3, b+2);
  };
  for (let s = 0; s < N; s++){
    const t0 = s / N, t1 = (s + 1) / N;
    const x0 = -W + 2*W*t0, x1 = -W + 2*W*t1;
    const z0 = -D + 2*D*t0, z1 = -D + 2*D*t1;
    addStrip({x:x0, z: D}, {x:x1, z: D});
    addStrip({x:x1, z:-D}, {x:x0, z:-D});
    addStrip({x:-W, z:z1}, {x:-W, z:z0});
    addStrip({x: W, z:z0}, {x: W, z:z1});
  }
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute('position', new THREE.Float32BufferAttribute(fv, 3));
  fGeo.setIndex(fi);
  fGeo.computeVertexNormals();
  group.add(mesh(fGeo, mat, { name:'eaveFascia' }));

  /* ③ 正脊 + 两端脊饰
     苏式厅堂正脊不用北方鸱吻 —— 鸱吻/龙吻脊属高等级做法（寺庙主殿、品官府第、家祠），
     园林厅堂习用「纹头脊」：两端以攀脊砌高、作钩子头，脊端翘起而形体低矮 */
  const ridge = mesh(box(2*L + 0.4, 0.36, 0.46), MAT.ridge, { name:'mainRidge' });
  ridge.position.set(0, hRidge + 0.1, 0);
  group.add(ridge);
  const ornS = hRidge / 3.0;                       // 脊饰随屋顶尺度缩放
  const wenShape = new THREE.Shape();
  wenShape.moveTo(-0.44, 0);
  wenShape.lineTo( 0.44, 0);
  wenShape.bezierCurveTo( 0.50, 0.22,  0.34, 0.46,  0.06, 0.50);   // 缓升到顶
  wenShape.bezierCurveTo(-0.16, 0.52, -0.36, 0.36, -0.44, 0.14);   // 钩子头回收
  wenShape.closePath();
  const wenGeo = new THREE.ExtrudeGeometry(wenShape, { depth: 0.34, bevelEnabled: false, curveSegments: 12 });
  wenGeo.translate(0, 0, -0.17);
  [-1, 1].forEach(sgn=>{
    const orn = mesh(wenGeo, MAT.ridge, { name:'wenTouJi' });
    orn.position.set(sgn * (L + 0.16), hRidge - 0.06, 0);
    orn.rotation.y = sgn > 0 ? 0 : Math.PI;
    orn.scale.setScalar(ornS);
    group.add(orn);
    const pan = mesh(box(0.9, 0.2, 0.46), MAT.ridge, { name:'panRidge' });   // 攀脊
    pan.position.set(sgn * (L - 0.3), hRidge + 0.24, 0);
    group.add(pan);
  });

  /* ④ 垂脊：正脊端 → 檐角（贴着高度场的脊线） */
  /* 歇山的垂脊**不从正脊端起**，而是从山花底角（x=±L, |z|=TS·D）起，
     沿"主坡与撒头交线"一直压到檐角 —— 这正好是两条坡面共享的那条折线。 */
  const hipRidge = (sx, sz)=>{
    const pts = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++){
      const t = TS + (1 - TS) * (i / steps);
      const x = sx * xHip(t);
      const z = sz * (D * t);
      pts.push(new THREE.Vector3(x, profile(t) + lift * corner(x, z) + 0.14, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    return mesh(new THREE.TubeGeometry(curve, 14, 0.1, 5, false), MAT.ridge, { name:'hipRidge' });
  };
  group.add(hipRidge(-1,-1), hipRidge(1,-1), hipRidge(-1,1), hipRidge(1,1));

  /* ⑤ 竖直山花面 + 博风板 —— 这一次有真拓扑可依附。
     ⚠️ 这里失败过两次：当时 x=±L 处曲面沿 x 是平的，硬塞一块"下缘=heightAt(L,z)、
     上缘=正脊标高"的板，从上看就是两块平铺在瓦面上的褐板（用户："屋顶出现莫名其妙的线和框"）。
     现在的拓扑在 x=±L **天然断开**：主坡(|x|≤L)止于此、撒头(|x|>L)从这里外扩，
     落差 = profile(|z|/D) − profile(TS)，山花面就是封住这段落差的竖直面，
     博风板压在它的上边缘。依附关系是几何自带的，不再靠"算出来的贴合"。 */
  const gsN = 24;
  [[1, false], [-1, true]].forEach(([sgn, flip])=>{
    // —— 竖直山花面（白粉，与山墙同色）——
    const gp = [], gu = [], gi = [];
    for (let i = 0; i <= gsN; i++){
      const z = -zsG + 2 * zsG * (i / gsN);
      const c = lift * corner(sgn * L, z);
      gp.push(sgn * L, ysG + c, z);                          gu.push(i / gsN, 0);
      gp.push(sgn * L, profile(Math.abs(z) / D) + c, z);     gu.push(i / gsN, 1);
    }
    for (let i = 0; i < gsN; i++){
      const a = i * 2, b = a + 1, c2 = a + 2, d = a + 3;
      if (flip) gi.push(a, c2, b,  b, c2, d); else gi.push(a, b, c2,  b, d, c2);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    gg.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
    gg.setIndex(gi); gg.computeVertexNormals();
    group.add(mesh(gg, MAT.wall, { name:'roofGable', cast:false }));

    // —— 博风板：沿山花上边缘的木封檐板（悬出屋面 0.12、压住山花上沿 0.26）——
    const bp = [], bi = [];
    for (let i = 0; i <= gsN; i++){
      const z = -zsG + 2 * zsG * (i / gsN);
      const yT = profile(Math.abs(z) / D) + lift * corner(sgn * L, z);
      const xi = sgn * (L - 0.03), xo = sgn * (L + 0.12);
      bp.push(xi, yT - 0.26, z,  xo, yT - 0.26, z,  xo, yT + 0.10, z,  xi, yT + 0.10, z);
    }
    for (let i = 0; i < gsN; i++){
      const r0 = i * 4, r1 = (i + 1) * 4;
      for (let k = 0; k < 4; k++){
        const a = r0 + k, b = r0 + ((k + 1) % 4), c = r1 + k, d = r1 + ((k + 1) % 4);
        bi.push(a, b, c,  b, d, c);
      }
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg.setIndex(bi); bg.computeVertexNormals();
    group.add(mesh(bg, MAT.gableBoard, { name:'roofBarge', cast:false }));
  });

  /* ⑥ 檐口瓦当（筒瓦端头圆盘，实例化） */
  {
    const spacing = tileW;              // 与瓦垄同间距，瓦当才落在垄头上
    const list = [];
    const addRow = (p0, p1)=>{
      const dx = p1.x - p0.x, dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(len / spacing));
      const nx = -dz / len, nz = dx / len;          // 水平外法线
      const ry = Math.atan2(nx, nz);
      for (let i = 0; i < n; i++){
        const t = (i + 0.5) / n;
        const x = p0.x + dx * t, z = p0.z + dz * t;
        list.push({ x, y: heightAt(x, z) - 0.035 + tileAmp * 0.75, z, ry });
      }
    };
    addRow({x:-W, z: D}, {x: W, z: D});
    addRow({x: W, z: D}, {x: W, z:-D});
    addRow({x: W, z:-D}, {x:-W, z:-D});
    addRow({x:-W, z:-D}, {x:-W, z: D});
    /* ⚠️ 半径 0.078 → **0.105**（2026-09-27，远香堂高精化第一件）。
       原值是按"嵌在封边里、只露一点弧顶"取的，量下来**瓦当 : 垄距 = 0.078 : 0.36 ≈ 1 : 4.6**，
       而真实筒瓦的瓦当直径约 0.16~0.20m、垄距 0.30~0.36m ⇒ 真实比例约 **1 : 2**。
       也就是说原来的瓦当小了将近一半，檐口特写机位下每个只有几个像素 ——
       **"存在但看不见"等于没有**：功能（筒瓦端头）在，工艺读不出来。
       0.105 ⇒ 比例 1 : 3.4，落在真实区间内且不过分；同一排 206 个实例，
       三角面增量 = 206 × 10 段 × 2 面 ≈ 4k（全场景 3.0M 的 0.14%，可忽略）。
       配套把落点从"檐口线下 0.07"提到"线下 0.035"（见上），让圆头真的露在封边之外。 */
    const tg = new THREE.CylinderGeometry(0.105, 0.105, 0.1, 10);
    const inst = new THREE.InstancedMesh(tg, MAT.ridge, list.length);
    inst.castShadow = false;
    const qA = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI/2);
    const qB = new THREE.Quaternion();
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1,1,1);
    list.forEach((it, i)=>{
      p.set(it.x, it.y, it.z);
      qB.setFromAxisAngle(new THREE.Vector3(0,1,0), it.ry);
      q.copy(qB).multiply(qA);
      m.compose(p, q, s); inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // 把屋面高度场导出：檐椽/斗拱/挂落等檐下构件必须贴着它定位，
  // 否则翼角起翘（本屋顶 lift=1.15）会把檐口抬高近 1 米，而固定高度的构件就会在四角悬空。
  group.userData.heightAt = heightAt;

  return group;
}
export function makeCeiling(w, d, y, mat = MAT.woodDark){
  const m = mesh(new THREE.PlaneGeometry(w, d), mat, { cast:false, name:'ceiling' });
  m.rotation.x = Math.PI / 2;        // 法线朝下
  m.position.y = y;
  return m;
}

/* ── 窗棂格心 ──
   原来的芯仔只是等距的直棂网格（cols×rows 根通长条），那是"格栅"不是"格心"。
   苏式长窗/半窗的芯仔是有画样的：步步锦（矩形套叠、回纹收头）、冰裂纹（不规则冰裂）、
   万字纹（卍字连续）等。这里实现前两种 —— 它们最能拉开近景的信息量，
   而且都是**线段集合**，共用同一条"把线段变成实体木棂再合并成一个网格"的通路。

   ⚠️ 每根棂条是一次 geometry 合并，不是一次 draw call：最终每个窗芯仍只有 1 个网格
   （材质统一为木材），所以格心复杂度几乎不影响渲染开销，只影响 init 时的构建量。 */
function latticeSegs_bujunjin(w, h){                 // 步步锦
  /* 步步锦：矩形**层层内收的套叠**（这是"步步"的本义）。
     ⚠️ 上一版我做了三级收分（0/0.24/0.48），圈间太密、看着像一个厚框，
     用户直接否掉了。现在去掉第三圈，只留"外圈 + 明显内收的内圈"，
     再叠一个中心十字花 —— 这是江南长窗芯仔最常见的朴素做法。
     ⚠️ 相对坐标 (0,0)-(w,h)，由 buildLatticeMesh 统一平移到面板中心。 */
  const segs = [], T = 0.048;
  const ring = (t)=>{
    const iw = w*(1-2*t), ih = h*(1-2*t), x0 = w*t, y0 = h*t;
    segs.push({ x: w*0.5,  y: y0,     w: iw, h: T, r: 0 });
    segs.push({ x: w*0.5,  y: h - y0, w: iw, h: T, r: 0 });
    segs.push({ x: x0,     y: h*0.5,  w: ih, h: T, r: Math.PI/2 });
    segs.push({ x: w - x0, y: h*0.5,  w: ih, h: T, r: Math.PI/2 });
  };
  ring(0.00); ring(0.17);
  // 中心十字花（内圈之内）
  const cw = w*0.56, ch = h*0.56;
  segs.push({ x: w*0.5, y: h*0.5, w: cw, h: T, r: 0 });
  segs.push({ x: w*0.5, y: h*0.5, w: ch, h: T, r: Math.PI/2 });
  return segs;
}

/* 直棂：等距横竖棂条（最朴素的芯仔，用于次级窗与室内隔断） */
function latticeSegs_zhiLing(w, h, cols = 3, rows = 4){
  const segs = [], T = 0.05;
  for (let i = 1; i < cols; i++) segs.push({ x: (w/cols)*i, y: h*0.5, w: h, h: T, r: Math.PI/2 });
  for (let j = 1; j < rows; j++) segs.push({ x: w*0.5, y: (h/rows)*j, w: w, h: T, r: 0 });
  return segs;
}
function latticeSegs_iceCrack(w, h, seed = 11){      // 冰裂纹（递归切分 + 去重）
  const rnd = mulberry32(seed);
  const cells = [];
  (function rec(x, y, cw, ch, d){
    if (d >= 4 || (cw < 0.34 && ch < 0.34) || cells.length > 26){ cells.push({ x, y, w: cw, h: ch }); return; }
    if (rnd() < 0.5){ const t = 0.32 + rnd()*0.36, a = ch*t; rec(x, y, cw, a, d+1); rec(x, y+a, cw, ch-a, d+1); }
    else            { const t = 0.32 + rnd()*0.36, a = cw*t; rec(x, y, a, ch, d+1); rec(x+a, y, cw-a, ch, d+1); }
  })(0, 0, w, h, 0);
  const segs = [], seen = new Set();
  const push = (x, y, len, rot)=>{
    const k = rot.toFixed(0) + '|' + x.toFixed(3) + '|' + y.toFixed(3) + '|' + len.toFixed(3);
    if (seen.has(k)) return;                       // 相邻格子共享的边只留一条
    seen.add(k); segs.push({ x, y, w: len, h: 0.05, r: rot });
  };
  for (const c of cells){
    push(c.x + c.w/2, c.y,       c.w, 0);
    push(c.x + c.w/2, c.y + c.h, c.w, 0);
    push(c.x,         c.y + c.h/2, c.h, Math.PI/2);
    push(c.x + c.w,   c.y + c.h/2, c.h, Math.PI/2);
  }
  return segs;
}
/* ── 清代江南隔扇芯仔：宫式方格 + 中段"菱花/海棠"葵式花心带 ──
   大户人家隔扇最常见的一种：上下两段是规整的宫式方格，中间夹一条葵式花心带，
   每个花心 = 菱形 + 内十字 + 四出海棠尖。依据是用户提供的那张远香堂立面照片
   （整排落地长窗、宫式方格夹一条菱花花心带、下面裙板）—— 不做 100% 复刻，
   只要"做法与气味"对：宫式打底、葵式点睛、木色沉、窗纸透。
   坐标系：buildLatticeMesh 的原点在**芯区左上角**，y 向下。 */
function latticeSegs_qingStyle(w, h, cols = 2, rows = 3){
  const segs = [], T = 0.048;
  const seg2 = (x1, y1, x2, y2, th = T)=>{
    segs.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2,
                w: Math.hypot(x2 - x1, y2 - y1), h: th, r: Math.atan2(y2 - y1, x2 - x1) });
  };
  /* ⚠️ 第二版（用户第二张近景照片后作废）：原来做的是"细密宫式方格 + 一条大花心带"，
     花心占满带高、近看像徽标。照片里的真实做法是**横竖棂条分成方格、每格中央一枚小小的
     如意/海棠花心**（花心只有格子的三成左右），所以改成 cols×rows 的方格 + 逐格小花心。 */
  const cw = w / cols, ch = h / rows;
  for (let j = 0; j <= rows; j++) seg2(0, j * ch, w, j * ch, T * 1.15);   // 通长横棂
  for (let i = 0; i <= cols; i++) seg2(i * cw, 0, i * cw, h, T);         // 通长竖棂
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++){
    const cx = (i + 0.5) * cw, cy = (j + 0.5) * ch;
    const R = Math.min(cw, ch) * 0.30;          // 花心只占格子三成
    const s = R * 0.44, t = R * 0.30, q = R * 0.32;
    // 削角小菱形＝如意/海棠花心的直线近似（四角各削一刀，八边形）
    const pts = [[-R, 0], [-s, -R + t], [s, -R + t], [R, 0], [s, R - t], [-s, R - t]];
    for (let k = 0; k < 6; k++){
      const A = pts[k], B = pts[(k + 1) % 6];
      seg2(cx + A[0], cy + A[1], cx + B[0], cy + B[1], T * 0.85);
    }
    seg2(cx - q, cy, cx + q, cy, T * 0.8); seg2(cx, cy - q, cx, cy + q, T * 0.8);   // 内十字
  }
  return segs;
}
/* 把线段集合变成"一个合并网格"。0/90° 直接用轴对齐盒子（省一次旋转），
   其余角度（菱花花心的 45° 斜棂）旋转后同样合进这一个网格 —— 所以芯仔再花
   也只是一个 draw call。 */
function buildLatticeMesh(segs, w, h, depth, mat, name = 'winLattice'){
  const geos = [];
  const nrm = new THREE.Matrix4().makeTranslation(-w/2, -h/2, 0);     // 芯区左上角为原点
  for (const s of segs){
    let g;
    if (s.r === 0)        g = box(Math.max(1e-3, s.w), Math.max(1e-3, s.h), depth);
    else if (s.r === Math.PI/2) g = box(Math.max(1e-3, s.h), Math.max(1e-3, s.w), depth);
    else { g = box(Math.max(1e-3, s.w), Math.max(1e-3, s.h), depth);
           g.applyMatrix4(new THREE.Matrix4().makeRotationZ(s.r)); }
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(s.x, s.y, 0));
    geos.push(g);
  }
  if (!geos.length) return null;
  let merged = null;
  try { merged = mergeGeometries(geos, false); } catch (e){ merged = null; }
  if (!merged) return null;
  merged.applyMatrix4(nrm);
  return mesh(merged, mat, { name });
}

/* ── 小木作：栏杆 / 美人靠 / 雀替 / 挂落 ──
   这些是中式建筑里"信息密度最高"的一层：远看只是几道线，近看却全是细节。
   统一放在这里生成，构件数用 InstancedMesh 压住，不逐个建网格。 */

/* 靠椅栏杆（含美人靠）：立柱 + 上扶手 + 中枋 + 细棂条 + 靠背斜撑
   返回一个 Group；origin 在栏段中心、y=0 落在楼/台面上。 */
function makeRailing(len, { h = 1.05, back = true, postEvery = 1.6,
                            matPost = MAT.woodRed, matBar = MAT.wood } = {}){
  const g = new THREE.Group();
  // 立柱
  const posts = [];
  const n = Math.max(1, Math.round(len / postEvery));
  for (let i = 0; i <= n; i++) posts.push({ x: -len/2 + (len/n)*i, y: 0, z: 0, ry: 0 });
  const postInst = instancedBoxes(posts, matPost, [0.13, h + 0.12, 0.13]);
  if (postInst){ postInst.position.y = (h + 0.12)/2; g.add(postInst); }
  // 上扶手（寻杖）
  const hand = mesh(box(len, 0.11, 0.20), matPost, { name:'railingHand' });
  hand.position.y = h; g.add(hand);
  // 中枋
  const mid = mesh(box(len, 0.08, 0.13), matBar);
  mid.position.y = h * 0.46; g.add(mid);
  // 细棂条（竖向，间距 0.2）
  const bars = [];
  const nb = Math.max(2, Math.floor(len / 0.2));
  for (let i = 0; i <= nb; i++){
    const x = -len/2 + (len/nb)*i;
    if (posts.some(p => Math.abs(p.x - x) < 0.09)) continue;   // 与立柱重合的跳过
    bars.push({ x, y: h*0.24, z: 0, ry: 0 });
  }
  const barInst = instancedBoxes(bars, matBar, [0.045, h*0.50, 0.055]);
  if (barInst) g.add(barInst);
  // 靠背：向后倾斜的条板（美人靠的"靠"）
  if (back){
    const bh = 0.46, tilt = 0.22;
    const backBar = mesh(box(len, bh, 0.075), matBar, { name:'railingBack' });
    backBar.position.set(0, h + bh*0.45, -0.16);
    backBar.rotation.x = -tilt;
    g.add(backBar);
    // 斜撑
    const struts = [];
    for (let i = 0; i <= n; i++) struts.push({ x: -len/2 + (len/n)*i, y: h + 0.06, z: -0.09, ry: 0 });
    const stInst = instancedBoxes(struts, matBar, [0.07, 0.42, 0.07]);
    if (stInst){ stInst.rotation.x = -tilt; g.add(stInst); }
  }
  return g;
}

/* 雀替：柱与额枋交角处的托木，轮廓自上而下收分，是"梁柱交接"最直观的标志 */
export function makeQueTu(w = 0.78, h = 1.45, mat = MAT.woodRed){
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(w, 0);
  s.bezierCurveTo(w*0.72, h*0.34, w*0.44, h*0.70, 0, h);   // 内凹的软曲线
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -0.08);
  return mesh(geo, mat, { name:'queti' });
}

/* 挂落：檐枋下的花牙子 —— 通长细枋 + 等距垂牙 + 每间收头小立枋 */
export function makeGuaLuo(len, { depth = 0.34, mat = MAT.woodDark, step = 0.62 } = {}){
  const g = new THREE.Group();
  const beam = mesh(box(len, 0.16, 0.13), mat, { name:'gualuoBeam' });
  beam.position.y = 0; g.add(beam);
  const drops = [];
  const n = Math.max(1, Math.floor(len / step));
  for (let i = 0; i < n; i++) drops.push({ x: -len/2 + step*(i + 0.5), y: -depth/2 - 0.08, z: 0, ry: 0 });
  const di = instancedBoxes(drops, mat, [0.11, depth, 0.10]);
  if (di) g.add(di);
  return g;
}

/* 江南半窗：下部槛墙、窗芯糊纸、格心芯仔（芯仔约占七八成）
   形制参考《园冶》长窗/半窗、营造法原地坪窗 */
export function makeJiangnanWindow(w, h, pattern = 'bujunjin'){
  const g = new THREE.Group();
  const fr = 0.16, depth = 0.16;
  // 窗芯（浅色纸背，透光感）
  const inner = mesh(box(w - fr * 1.7, h - fr * 1.7, depth * 0.4), MAT.winPaper, { name:'winPaper' });
  inner.position.z = -0.03; g.add(inner);
  // 外框
  const top = mesh(box(w, fr, depth), MAT.woodDark); top.position.y =  h/2 - fr/2; g.add(top);
  const bot = mesh(box(w, fr, depth), MAT.woodDark); bot.position.y = -h/2 + fr/2; g.add(bot);
  const lf  = mesh(box(fr, h, depth), MAT.woodDark); lf.position.x = -w/2 + fr/2; g.add(lf);
  const rf  = mesh(box(fr, h, depth), MAT.woodDark); rf.position.x =  w/2 - fr/2; g.add(rf);
  // 格心（步步锦 / 冰裂纹），合并成单个网格
  const iw = w - fr * 1.7, ih = h - fr * 1.7;
  const segs = pattern === 'ice'  ? latticeSegs_iceCrack(iw, ih, 11)
             : pattern === 'zhi'  ? latticeSegs_zhiLing(iw, ih, 3, 4)
             :                      latticeSegs_bujunjin(iw, ih);
  const lat = buildLatticeMesh(segs, iw, ih, depth * 0.55, MAT.woodDark);
  if (lat){ lat.position.z = 0.02; g.add(lat); }
  // 窗台石
  const sill = mesh(box(w + 0.34, 0.11, depth + 0.2), MAT.stoneDark, { name:'winSill' });
  sill.position.y = -h/2 - 0.055; g.add(sill);
  return g;
}

/* 落地长窗（隔扇）：上段芯仔 + 中段夹堂板 + 下段裙板。
   这是苏州厅堂——尤其四面厅——正面的做法：长窗**从台基直达额枋**，一间一樘，下端是实心裙板。
   ⚠️ 关于"还原到什么程度"必须说清楚：网上只检索到书目与抓不到正文的页面，
   **远香堂芯仔的具体图案我没能证实**；这里依据的是苏州园林的通行做法 ——
   厅堂长窗用**宫式**（规整直棂方格）+ 夹堂板 + 裙板；葵式（冰裂/乱纹）用在游廊、亭子等次要位置。
   侧面的山墙窗仍保留半窗（那才是半窗本来该在的位置）。 */
export function makeChangChuang(w, h, cols = 5, rows = 4){
  const g = new THREE.Group();
  const fr = 0.17, depth = 0.15;
  const hPanel = h * 0.34, hMid = h * 0.06, hCore = h - hPanel - hMid;
  const yBot = -h / 2;
  const iw = w - fr * 1.7, ih = hCore - 0.05, yCore = yBot + hPanel + hMid + hCore / 2;
  /* 木色：用户给的两张远香堂照片里，隔扇是**枣红**（不是近黑褐）——
     所以整樘改用与柱子同色系的 woodRed，只留窗纸与石槛做对比。 */
  const ww = MAT.woodRed;
  const paper = mesh(box(iw, ih, depth * 0.35), MAT.winPaper, { name:'ccPaper' });
  paper.position.set(0, yCore, -0.03); g.add(paper);
  const panel = mesh(box(iw, hPanel - 0.05, depth * 0.55), ww, { name:'ccPanel' });
  panel.position.set(0, yBot + hPanel / 2, 0.01); g.add(panel);          // 下段裙板
  const mid = mesh(box(iw, hMid, depth * 0.6), ww, { name:'ccMid' });
  mid.position.set(0, yBot + hPanel + hMid / 2, 0.01); g.add(mid);       // 中段夹堂板
  // 上段芯仔：方格 + 每格中央一枚如意/海棠花心（清代江南隔扇做法，见 latticeSegs_qingStyle）
  const segs = latticeSegs_qingStyle(iw, ih, 2, 3);
  const lat = buildLatticeMesh(segs, iw, ih, depth * 0.55, ww);
  if (lat){ lat.position.set(0, yCore, 0.02); g.add(lat); }
  const top = mesh(box(w, fr, depth), ww); top.position.y = h/2 - fr/2; g.add(top);
  const bot = mesh(box(w, fr, depth), ww); bot.position.y = -h/2 + fr/2; g.add(bot);
  const lf  = mesh(box(fr, h, depth), ww); lf.position.x = -w/2 + fr/2; g.add(lf);
  const rf  = mesh(box(fr, h, depth), ww); rf.position.x =  w/2 - fr/2; g.add(rf);
  const sl  = mesh(box(w + 0.1, 0.12, depth + 0.16), MAT.stoneDark, { name:'ccSill' });
  sl.position.y = -h/2 - 0.06; g.add(sl);                                // 下槛（贴地横木）
  return g;
}

/* 格扇门 / 长窗：木框 + 细棂条 + 不透明衬板（关闭状态，不透光穿视） */
export function makeLatticePanel(w, h, cols = 4, rows = 5, frameMat = MAT.woodDark, backing = MAT.latticeBack){
  const g = new THREE.Group();
  const t = 0.09;
  // 外框（原点在面板正中 —— 所有调用点都按居中放置）
  const fr = 0.16;
  const top = mesh(box(w, fr, t*1.6), frameMat); top.position.y =  h/2 - fr/2; g.add(top);
  const bot = mesh(box(w, fr, t*1.6), frameMat); bot.position.y = -h/2 + fr/2; g.add(bot);
  const lf  = mesh(box(fr, h, t*1.6), frameMat); lf.position.x = -w/2 + fr/2; g.add(lf);
  const rf  = mesh(box(fr, h, t*1.6), frameMat); rf.position.x =  w/2 - fr/2; g.add(rf);
  // 衬板（关着的门扇：纸/木板，不透）
  const back = mesh(new THREE.PlaneGeometry(w - fr*1.4, h - fr*1.4), backing, { cast:false, name:'backing' });
  back.position.z = -t*0.35; g.add(back);
  /* 芯仔：等距直棂 → **真正的格心**。
     原来这里只是 cols×rows 的通长直棂，也就是"格栅"，不是窗花 ——
     门扇与室内隔断全用它，所以近看"没有窗花"。
     现在改为：先随机挑一档直棂（保留细分感），再叠一圈内收的矩形套叠，
     门/隔断与窗子用同一套语汇。 */
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(1,1,1);
  const iw2 = w - fr*1.5, ih2 = h - fr*1.5;
  const segs = latticeSegs_bujunjin(iw2, ih2);
  const lat = buildLatticeMesh(segs, iw2, ih2, t*0.9, frameMat, 'panelLattice');
  if (lat) g.add(lat);
  // 细直棂：作为格心的次级细分（数量随 cols/rows，保持各地窗棂疏密不同）
  const gv = box(0.038, ih2, t*0.7);
  const gh = box(iw2, 0.038, t*0.7);
  const iv = new THREE.InstancedMesh(gv, frameMat, Math.max(0, cols - 1));
  const ih = new THREE.InstancedMesh(gh, frameMat, Math.max(0, rows - 1));
  for (let i = 1; i < cols; i++){ p.set(-w/2 + (w/cols)*i, 0, 0); m.compose(p,q,s); iv.setMatrixAt(i-1, m); }
  for (let j = 1; j < rows; j++){ p.set(0, -h/2 + (h/rows)*j, 0); m.compose(p,q,s); ih.setMatrixAt(j-1, m); }
  iv.instanceMatrix.needsUpdate = ih.instanceMatrix.needsUpdate = true;
  iv.castShadow = ih.castShadow = true;
  g.add(iv, ih);
  return g;
}

/* 带孔洞的墙体：一次挤出成型（真镂空） */
export function makeWallRun({ len, h, t, holes = [] }){
  const shape = new THREE.Shape();
  shape.moveTo(-len/2, 0);
  shape.lineTo( len/2, 0);
  shape.lineTo( len/2, h);
  shape.lineTo(-len/2, h);
  shape.closePath();

  for (const hd of holes){
    const p = new THREE.Path();
    if (hd.type === 'circle'){
      /* ⚠️ 月洞门是**能走人的整圆洞**，不是上半圆漏窗。
         原来只 absarc 了 π→0（上半圆）再沿弦线闭合：洞口下沿停在 y = r+0.18 = 1.80，
         下面 1.8 米是**一整堵实墙** —— 人过不去，而墙外还摆着"下沉门槛石阶"。
         圆心抬到 r+0.18 是为了让洞口下沿与 0.22 高的门槛石齐平，形状改成整圆。 */
      const { x, r } = hd, cy = hd.cy ?? r + 0.18;
      p.absarc(x, cy, r, 0, TAU, false);
    } else {                                          // 多边形漏窗
      const { x, y, r, n = 8, rot = 0 } = hd;
      for (let i = 0; i <= n; i++){
        const a = rot + (i/n) * TAU;
        const px = x + Math.cos(a)*r, py = y + Math.sin(a)*r;
        i === 0 ? p.moveTo(px, py) : p.lineTo(px, py);
      }
      p.closePath();
    }
    shape.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth:t, bevelEnabled:false, curveSegments:14 });
  geo.translate(0, 0, -t/2);
  return mesh(geo, MAT.wall, { name:'wall' });
}

/* 墙顶小青瓦披檐（人字坡） */
export function makeWallCap(len, t, y){
  const g = new THREE.Group();
  const half = t/2 + 0.24;
  [-1, 1].forEach(sgn=>{
    const slope = mesh(box(len, 0.14, half*1.06), MAT.wallCap, { name:'wallCap' });
    slope.position.set(0, y + 0.3, sgn*half*0.5);
    /* ⚠️ 符号反了：-sgn 让两块坡板**朝外翘**，横断面成"凹"（中间汇水）、
       脊条浮在凹谷上方。正号才是中间高、两侧低的人字披檐。 */
    slope.rotation.x = sgn * 0.42;
    g.add(slope);
  });
  const ridge = mesh(box(len, 0.2, 0.2), MAT.ridge);
  ridge.position.y = y + 0.52; g.add(ridge);
  return g;
}

bootMark('§3 构件工厂');