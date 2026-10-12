// 06d-corridor: 观荷水道（视廊）+ 蜻蜓停栖锚点（W2 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出。门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
// ⚠️ perchingAnchors 是 08-assemble / 11-loop 共享的**同一可变数组实例**：
//    本模块只 export 它自己的引用，原文件门面 import 的是同一实例 —— 绝不许在任一侧重建。
import { THREE } from '../vendor.js';
import { MAT } from './01-materials.js';

// 停栖点保留真实三角面与实例编号；实例网格不会被静态合并移除。
/* ⚠️ 锚点必须**先乘 instanceMatrix 再打分**：InstancedMesh 的几何是"一片花瓣/一张叶盘"
   的局部坐标，实例位移全在 instanceMatrix 里。原来拿局部坐标直接打分又只乘
   object.matrixWorld —— 60 个锚点全部塌到 makeAquatic 组原点（-2.5, 2.2），
   蜻蜓会叠在同一朵不存在的花上。打分也要在**变换后**的空间做，否则"取最高的三角面"
   取到的是花瓣局部坐标的最高点，变换后可能根本不是花顶。 */
export const perchingAnchors = [];
export function addPerchingAnchor(kind, object, instanceId){
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
export function corridorT(px, pz, C = VIEW_CORRIDOR){
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
export function syncCorridorU(){
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
export function installLilyCorridor(mat){
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
