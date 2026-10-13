// 06g-koi: 锦鲤（轨道 KOI_ORBITS + 投喂 + 行为层 KOI_BEHAVIOR）（W5 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出。门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
// ⚠️ 搬移依据方案 §4.3 S7：baitPoints 的构造与 markUnderwater(baitPoints) 的**先后顺序**不可变，
//    顶层构造次序一改，折射层会静默失效（无报错、只是水下看不见）。以下三块的相对次序照搬原样。
// ⚠️ KOI_BEHAVIOR 是对象导出、koiBehaviorOffset 等是行为层入口；06f-ripple（涟漪池）将来
//    单向依赖本模块取 KOI_BEHAVIOR.startleFromRipple 与 koiStartleAt，依赖方向 06 → {06f, 06g}。
// ⚠️ tubeRadiusRamp 的**定义与导出行都留在 06-vegetation.js 原位**（不在本模块范围）。
// ⚠️ 溯源注（2026-10-13 收口）：上一句关于 tubeRadiusRamp「定义与导出行都留在 06-vegetation.js」的表述**已过时** ——
//    它实际定义在 src/06i-trees.js:581，并在该文件 :657 由 `export { tubeRadiusRamp }` 导出；
//    06-vegetation.js :184/:185 只是 import 转发与再 export，均非定义处。
//    原句一字未动：它记录的是拆分当日的判断（当时确实还没搬），改写会使其失去凭据。
//    先例：sw.js:80-84、probe/shadow-bake-guard.mjs:7、probe/verify-all.mjs:313 同为加注不改写。
import { THREE } from '../vendor.js';
import { TAU, CFG } from './00-config.js';
import { POND_RADII, markUnderwater } from './05-water.js';


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
