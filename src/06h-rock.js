// 06h-rock: 太湖石族（W6 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出。门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
// ⚠️ 方案 §3.2 明列的单点依赖 segDist / hash3i / vnoise3 / fbm3 全在本模块内定义并共用：
//    Surface Nets 与立峰 SDF 的形全靠这四个，拆散到别的文件会静默坏掉（不报错、只是石形变）。
// ⚠️ makeTaihuPeak 一并搬入：makeRockChain / makeRockery 都在调它，留在 06 就得 06h → 06
//    反向依赖，而 06 要门面 06h ⇒ 成环。
import { THREE, mergeGeometries } from '../vendor.js';
import { TAU, rnd, rr, CFG, mulberry32 } from './00-config.js';
import { MAT, WIND, addWind, AUX_PASS_HIDDEN } from './01-materials.js';
import { mesh } from './03-factory.js';
import { POND_RADII, insidePond, markUnderwater } from './05-water.js';

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
export function fbm3(x, y, z, s, oct){
  let amp = 0.5, fr = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++){
    sum += amp * vnoise3(x * fr, y * fr, z * fr, s + i * 17);
    norm += amp; amp *= 0.5; fr *= 2.03;
  }
  return sum / norm;
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

/* 太湖石峰：瘦高、上端展如冠、轮廓扭曲起皱
   参考冠云峰（高 6.5m / 基座 0.8m，高宽比约 8:1）的"瘦漏透皱"造型 */
/* 太湖石峰：取「云头雨脚」经典造型 —— 下部收细如雨脚，上部展开如云头，
   配多频皱褶与深凹孔洞，对应赏石的瘦、漏、透、皱。云头即祥云，是冠云峰、瑞云峰等名石得名之由 */
export function makeTaihuPeak(height = 4.5, baseR = 0.42, seed = 0){
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

