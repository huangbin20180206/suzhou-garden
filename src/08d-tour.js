// 08d-tour: 巡游与机位（2026-10-15 W1 从 08-assemble.js 纯搬家：257-419 步行路径＋3455-3824 机位/巡游）。
// 逻辑一字不动；两处顶层 IIFE（WALK_PATH / VIEWPOINTS）因依赖求值时序，转成 build 函数，
// 由 08-assemble 在原行号位置调用 —— 搬家前后求值顺序逐字一致。
import { THREE } from '../vendor.js';
import { world, camera, controls, renderer, CAM_MIN_DIST, CAM_HOME, PROBE_DRIVEN } from './02-scene.js';
import { groundHeight } from './05-water.js';
import { envEl } from './12-env.js';

/* ══ 巡游观鱼者的闭合步行路径（2026-10-06 · 老黄反馈 B）═════════════════════════
   老黄："巡游观鱼的主人身体倾斜也很厉害 ⇒ 收小倾斜，让他沿『草皮 → 池岸 → 汀步/拱桥
   → 回到草皮』走一条闭合路径"。

   ── 路线的每一段都是**射线实测**定的（outputs/_diag/route-check.mjs / walk-probe.mjs）──
   · 西段（z 9.4~10.9，x 0.8~6.0）：池南岸的**平草地**，向下射线首命中一律 ground，
     与 groundHeight 差 ≤5cm；
   · 中段（x≈6.45 上、x≈6.95 下）：池南那座山脊（埋脚鼓包）的**西坡**，实测从坡脚
     (6.5,12.2,≈0m) 到脊顶 (6.5,13.3,≈0.90m) 是连续坡（每 0.2m 抬 0.12m），可以走；
   · 东段（z 13.35~13.8，x 6.9~8.7）：山脊脊线，实测 1.16~1.40m；
   · 上桥段（x≈8.05 上、x≈8.70 下，z 11.15~12.95）：拱桥南端的**桥头平板石 + 踏跺**，
     实测逐级 1.302(平板石) → 1.085 → 0.888 → 0.69 m —— 每级 ≤0.22m，是桥自己的台阶；
   · 桥头平台（z 9.75，1.302m）：**拱桥的南端桥面**（与桥身同一块汉白玉板），
     他在这里转身往回走。
   ⚠️ **全程 33 个取样点用 insidePond(x, z−3) 断言为假**（实测 0 处在池内）：
     路径只走到拱桥的南端引桥（z≥9.7），没有踏上跨水的拱券 —— 这是**刻意**的，
     因为老黄那条硬要求是"每个取样点不能在池子里"，而拱券（z<9.3）在池形多边形内。
     代价如实记下：他"上桥"上到的是桥头平板石，不是拱顶。
   ⚠️ 每个取样点的高度**由向下射线取真实面**（不是 groundHeight）—— 桥面/踏跺/山脊
     都不是地形，用 groundHeight 会让他悬空 1.3m 或陷进桥里；
     口径与 probe/figure-foot-guard.mjs 完全一致（跳过 y≥3.0 的命中 = 跳过屋顶/檐口）。
   闭合方式：最后一个航点连回第一个（不是原地掉头），所以 position 沿 s 走一圈是连续的。 */
const WALK_ROUTE = [
  [0.80,  9.40], [2.60,  9.90], [4.40, 10.40], [6.00, 10.90],   // 平草地（池南岸）
  [6.45, 11.70], [6.45, 12.30], [6.45, 12.90], [6.55, 13.35],   // 山脊西坡·上坡道
  [7.30, 13.45], [8.05, 13.35],                                 // 脊线东行
  [8.05, 12.85], [8.05, 12.30], [8.05, 11.75], [8.10, 11.15],   // 桥头踏跺·下到平板石
  [8.08, 10.40], [8.05,  9.75],                                 // 桥面·走到南端
  [8.68,  9.75],                                                // 桥面·转身（另一条车道）
  [8.68, 10.40], [8.70, 11.15], [8.70, 11.75], [8.70, 12.35],   // 桥面→踏跺·回程道
  [8.70, 12.95], [8.35, 13.35], [7.55, 13.55], [6.95, 13.60],   // 脊线西行（比去程偏南 0.4m）
  [6.95, 12.85], [6.95, 12.25], [6.95, 11.60],                  // 山脊西坡·下坡道
  [6.40, 11.35], [4.60, 10.90], [2.60, 10.50], [1.10,  9.90],   // 平草地（回程）
];
export let WALK_PATH = null;
/* buildWalkPath 由 08-assemble 在原 291 行位置调用（布景之后、人物之前）：
   射线取样要求此刻 world 里只有地形/水/桥/山 —— 调用位置一字不许动。 */
export function buildWalkPath(){
  const built = (()=>{
  /* 射线取样要在**人物建出来之前**做：树/竹是延迟批（不在 world 里），但人物是同步批 ——
     人物一进 world，从上往下的射线会先打到他自己的头/肩，"脚下那个面"就变成他自己。
     本块的位置（§8 主建之后、人物段之前）正好满足：此刻 world 里只有地形/水/桥/山。 */
  world.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const surfaceY = (x, z)=>{
    rc.set(new THREE.Vector3(x, 25, z), DOWN); rc.far = 70;
    for (const h of rc.intersectObject(world, true)){
      if (!h.object.isMesh) continue;
      if (h.point.y < 3.0) return h.point.y;      // 跳过屋顶/檐口（同 figure-foot-guard 口径）
    }
    return groundHeight(x, z);
  };
  const STEP = 0.15;                              // 基准采样间距（台阶处另做自适应细分，见下）
  const raw = [];
  for (let i = 0; i < WALK_ROUTE.length; i++){
    const [x1, z1] = WALK_ROUTE[i];
    const [x2, z2] = WALK_ROUTE[(i + 1) % WALK_ROUTE.length];
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, z2 - z1) / STEP));
    for (let k = 0; k < n; k++) raw.push([x1 + (x2 - x1) * k / n, z1 + (z2 - z1) * k / n]);
  }
  const base = raw.map(([x, z]) => ({ x, z, y: surfaceY(x, z) }));
  /* ⚠️⚠️ 台阶处"把坎找准再跨过去"（2026-10-06 修"过桥头踏跺时瞬时下陷"，交接文档第 3 节第 3 条）：
     桥头是**四级各 ~0.2m 的踏跺**（实测 x=8.70 车道：1.302 / 1.0848 / 0.8875 / 0.6903，
     每级踏面 0.4m 左右、坎在两级之间）。而基准采样是 0.15m 一档 ⇒ 坎必然落在某一档**内部**，
     线性插值就把一级坎抹成 0.15m 长的斜坡 —— 数学上"跨坎段的插值偏差" = Δy × max(u/λ, 1−u/λ)
     ≥ Δy/2（u=坎在段内的位置），**细分只能把窗口变短、压不下幅度**（我第一版就是这么做
     自适应二分到 0.005m，实测最大偏差仍有 0.102m ⇒ 那条路是错的，别回头）。
     实测（outputs/_diag/walk-step-check.mjs，按 0.02m 一档复算产品自己的 walkPointAt）：
       · 修复前：最大 |脚底−面| = **0.161m**（陷地 −0.161 / 悬空 +0.110），
         **|偏差| > 5cm 的路程合计 0.62m**（≈0.86s 的"陷进去"时间），全在桥头两处踏跺。
     ⇒ 正解 = **先二分把坎的位置找出来**（射线实测，6 次二分定位到 L/64 ≈ 2.3mm），
     再在坎两侧各插一个点 ⇒ 插值只在 ~2mm 内走完 0.2m 落差（≈3ms）：
     偏差窗口从 0.62m 收到 ~0.02m，肉眼就是一"步"落下去（真人也正是这么下台阶的）。
     ⚠️ 只**加密采样**：路线与 x/z 一字不动（新点落在原来的直线段上）⇒ 全长 27.59m、
     walkPointAt 的插值口径、0.72m/s 与"一圈 38s"全不受影响；也**不消耗任何随机数**
     ⇒ layout-fingerprint 不受影响（那门只哈希 InstancedMesh）。普通坡面（|Δy| ≤ 0.06）
     **完全不动**（照旧线性插值，免得把山脊那几条长坡走成"小碎步"）。
     实测（0.02m 一档复算产品自己的 walkPointAt）：最大 |脚底−面| 0.161→**0.070**、
     **最大下陷 −0.161→−0.019**（"陷进石头"那一半基本消失）、|偏差|>5cm 的路程 **0.62m→0.04m**。
     代价：182 → **248** 个采样点（多 264 次射线）⇒ 冷启动 A/B/A/B 交替实测 10.41s vs 10.14s
     ＝ **+0.27s（2.7%）**。⚠️ 不交替测会得出"+9s"的假结论 —— 那是本机启动漂移（本项目
     "同一份代码早晚差 2 倍"那条老账），别信。 */
  const RISER_DY = 0.06;      // 判"这是坎"的最小高差（低于它的当坡面，不处理）
  const RISER_BISECT = 6;     // 二分次数：定位精度 ≈ 段长/2^6 ≈ 2.3mm
  const locateRiser = (a, b, out) => {
    const D = Math.abs(b.y - a.y);
    if (D <= RISER_DY) return;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) return;
    const at = (t) => { const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
                        return { x, z, y: surfaceY(x, z) }; };
    let lo = 0, hi = 1;
    for (let k = 0; k < RISER_BISECT; k++){
      const t = (lo + hi) / 2, p = at(t);
      /* 离 a 那级踏面更近 ⇒ 还没到坎；否则已经落到 b 那一级 */
      if (Math.abs(p.y - a.y) <= D / 2) lo = t; else hi = t;
    }
    if (hi - lo >= 0.5) return;                    // 没收敛（不是单一台阶）⇒ 原样不动
    out.push(at(lo));                              // 坎前最后一点（仍在上二级踏面上）
    out.push(at(hi));                              // 坎后第一点（已落到下一级）
  };
  const pts = [];
  for (let i = 0; i < base.length; i++){
    const a = base[i], b = base[(i + 1) % base.length];
    pts.push(a);
    locateRiser(a, b, pts);                        // 只在 a→b 之间插点（不含 b）
  }
  const cum = [0];
  for (let i = 0; i < pts.length; i++){
    const a = pts[i], b = pts[(i + 1) % pts.length];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { pts, cum, len: cum[cum.length - 1] };
  })();
  WALK_PATH = built;
  return WALK_PATH;
}

/* 路径上的插值取点（s = 弧长，单位 m；闭合 ⇒ 超出一圈就绕回来）。
   ⚠️ 2026-10-06 起**也 export**（门禁要按产品自己的插值口径复算"脚底 vs 脚下那个面"，
   见 probe/figure-foot-guard.mjs 的"巡游观鱼者沿全程扫描"那条 —— 探针里另写一份 lerp
   等于把产品口径抄一遍，改产品时两边会悄悄分家）。 */
export function walkPointAt(s, cursor){
  const P = WALK_PATH.pts, C = WALK_PATH.cum;
  let i = cursor.i | 0;
  while (i + 1 < C.length - 1 && C[i + 1] <= s) i++;
  while (i > 0 && C[i] > s) i--;
  cursor.i = i;
  const seg = C[i + 1] - C[i];
  const t = seg > 1e-9 ? (s - C[i]) / seg : 0;
  const a = P[i], b = P[(i + 1) % P.length];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/* ══ 巡游观鱼者的行走驱动 · 声明与数值（2026-10-06 · 老黄反馈 B）══════════════════
   ⚠️ 这几个声明**必须**待在 WALK_PATH 之后、D_SCHEDULES 之前：D_SCHEDULES 的建场循环
   会调 attachWalker() 往 WALKERS 里登记，而 `const` 在声明之前是 TDZ
   （放晚一行 = "Cannot access 'WALKERS' before initialization"，启动即炸、且只在带
   walk:true 的人物存在时才炸）。函数本体在人物段里（见 attachWalker/driveWalkers）。

   ── 为什么驱动挂在 `updateWatchers(dt, t)` 的**开头** ─────────────────────────
   它是 08 里**每帧被调用、且早于 figures 循环**的那个入口（11-loop 在 tickFireworks 之后
   调它，figures 循环在它之后）⇒ 在这里把人物的 position.x/z / baseY / rotation.y 写好，
   figures 循环紧接着读 baseY 写 position.y，同一帧内自洽，而且**不必动 11-loop.js**。

   ── 谁写哪个量（三个作者，必须互不重叠，否则就是"改一处被另一处每帧覆盖"）──────
     · driveWalkers：position.x / position.z / userData.baseY / rotation.y；
     · 11-loop 的 figures 循环（非散步分支）：position.y（= baseY）/ rotation.x（= leanX）
       / rotation.z（= 0.03）/ visible（时段 + 天气）；
     · updateWatchers：pivot.position.y（起伏）与 pivot.rotation.z（侧摆）。
   ⇒ 起伏/侧摆**只能**走 pivot 层（root 与人体几何之间插一层空组，与看烟花一家的
     `wrapWatcher` 同一手法）：写在 root 上会被 figures 循环当场抹掉 —— 就是"改一处被
     另一处每帧覆盖"那个老坑（不报错、不影响任何断言，只让动作消失）。

   ── 数值 ──────────────────────────────────────────────────────────────────
   · 速度 **0.72 m/s**：缓行（真人慢走 0.6~0.9）；WALK_PATH 实测全长 **27.6m**
     （182 个采样点）⇒ 走满一圈约 **38s**；
   · 朝向按 dt×4 平滑（时间常数 0.25s）：拐弯处不会瞬间翻 180°（同 11-loop 散步者的口径）；
   · 起伏 0.028m / 侧摆 0.035rad —— **与 11-loop 散步者逐字同源**（那边是
     `|sin(step)| * 0.028` 与 `sin(step) * 0.035`），所以"巡游的人"和"廊里散步的人"
     是同一套步态；步相按**走过的距离**推进（0.42m/步），绕圈/拐弯都不会出现倒退的步频；
   · 逐帧一次随机都不取（只吃 dt）：否则帧数会改写随机流的消费位置（铁律 1 的实质）。
   · ⚠️ 路径高是**逐点射线实测**的：桥头踏跺那几级是**阶梯函数**，而 position 在相邻
     采样点之间走线性插值 ⇒ 台阶棱上会短暂比脚下的踏面**低 ~0.11m**（实测最大 0.109，
     门禁容差 0.15）。要再准就得把 STEP 从 0.15 收到 0.05（采样点 ×3、建场多 ~370 次射线），
     换 4cm 的观感 —— 当前取舍是"够"，依据留在 outputs/_diag/walk-bucket-check.mjs 里。 */
export const WALKERS = [];
export const WALK_SPEED = 0.72;
export const WALK_TURN = 4.0;
export const WALK_STRIDE = 0.42;
export const WALK_BOB = 0.028;
export const WALK_SWAY = 0.035;

export const CAM_FLY = { on: false, t: 0, dur: 1.4, from: null, to: null, minDist: null,
                         owner: '', restoreMinDist: CAM_MIN_DIST };
/* minDist：落位后要恢复的 OrbitControls 最小半径（机位自带则用它，否则回默认 9）。
   飞行途中把下限整体放开 —— 否则从远处飞向"近观"机位时，controls.update() 会在半途
   把相机半径夹回 9m，路径被扯成"先到 9m 再贴上去"的折线。 */
export function flyTo(pos, target, dur = 1.4, minDist = null, owner = 'manual'){
  CAM_FLY.restoreMinDist = CAM_FLY.on ? CAM_FLY.restoreMinDist : controls.minDistance;
  CAM_FLY.from = { p: camera.position.clone(), t: controls.target.clone() };
  CAM_FLY.to   = { p: pos.clone(), t: target.clone() };
  CAM_FLY.minDist = minDist;
  CAM_FLY.owner = owner;
  CAM_FLY.t = 0; CAM_FLY.dur = dur || 1.4; CAM_FLY.on = true;
  controls.minDistance = 0.2;
}
export function cancelCamFly(owner = null){
  if (!CAM_FLY.on || (owner && CAM_FLY.owner !== owner)) return false;
  CAM_FLY.on = false;
  CAM_FLY.owner = '';
  controls.enabled = true;
  controls.minDistance = CAM_FLY.restoreMinDist;
  return true;
}
export function updateCamFly(dt){
  if (!CAM_FLY.on) return;
  CAM_FLY.t = Math.min(1, CAM_FLY.t + dt / CAM_FLY.dur);
  const e = CAM_FLY.t < 0.5 ? 2 * CAM_FLY.t * CAM_FLY.t : 1 - Math.pow(-2 * CAM_FLY.t + 2, 2) / 2;
  camera.position.lerpVectors(CAM_FLY.from.p, CAM_FLY.to.p, e);
  controls.target.lerpVectors(CAM_FLY.from.t, CAM_FLY.to.t, e);
  if (CAM_FLY.t >= 1){
    CAM_FLY.on = false;
    CAM_FLY.owner = '';
    controls.minDistance = CAM_FLY.minDist != null ? CAM_FLY.minDist : CAM_MIN_DIST;
  }
}

/* ── 开场运镜（2026-09-20 · 修复拆模块时的功能回归）──
   旧版单文件有「加载完成后约 7.5 秒：高远俯瞰 → 缓推至交付视角；任意交互即让位」。
   拆模块重写后这段丢了，打开就是一个静止机位 —— 第一眼的"电影感入场"没了。
   CAM_FLY 只支持单段飞行，这里另立一条多关键帧状态机：
     K0 云外俯瞰（池南上空，先看见全园布局：水院 / 远香堂 / 立峰）
       → K1 贴水南推（从池南上空掠过水面，立峰从画面左侧退过，直奔远香堂）
       → K2 交付机位（CAM_HOME，与按 0 复位的落点一致）。
   规矩（与 flyTo 同源）：
   · 飞行期间 controls.enabled=false —— 否则 OrbitControls 的拖拽/阻尼会和插值互相抢相机；
   · minDistance 临时放开到 0.2，落位（或取消）后恢复 CAM_MIN_DIST；
   · 任意 pointerdown / wheel / 键击立即让位（"带看"不是"锁死"，与巡游同一条语义）；
   · 探针（navigator.webdriver）不自动播：回归会拿到"正在飞"的相机，几十条机位/像素
     断言全漂；prefers-reduced-motion 是无障碍约定，也不播；
   · ?intro=1 强制播（给门禁），?intro=0 强制关。__garden 暴露 introStart/Cancel 供驱动。 */
const INTRO_KF = [
  { p: new THREE.Vector3(30, 34, 40),  t: new THREE.Vector3(0, 4.5, 2) },     // 云外俯瞰
  { p: new THREE.Vector3(0, 4.6, 12.2), t: new THREE.Vector3(-1, 3.2, -4) },  // 贴水南推（y=4.6 越过南岸石脊）
  { p: CAM_HOME.pos.clone(),           t: CAM_HOME.target.clone() },          // 交付机位
];
const INTRO_DUR = [2.6, 2.8];           // 共 5.4s：起幅从容，推进略带加速
export const INTRO = { on:false, seg:0, t:0 };
export function introActive(){ return INTRO.on; }
export function introStart(){
  INTRO.on = true; INTRO.seg = 0; INTRO.t = 0;
  controls.enabled = false;
  controls.minDistance = 0.2;
  /* 起幅瞬间跳到 K0：首帧在 CAM_HOME 渲的、loading 层此时还在 0.7s 淡出里，跳切被遮住 */
  camera.position.copy(INTRO_KF[0].p);
  controls.target.copy(INTRO_KF[0].t);
  controls.update();
  return true;
}
export function introCancel(){
  if (!INTRO.on) return false;
  INTRO.on = false;
  controls.enabled = true;
  controls.minDistance = CAM_MIN_DIST;
  controls.update();
  return true;
}
export function updateIntro(dt){
  if (!INTRO.on) return;
  const a = INTRO_KF[INTRO.seg], b = INTRO_KF[INTRO.seg + 1];
  INTRO.t = Math.min(1, INTRO.t + dt / INTRO_DUR[INTRO.seg]);
  const e = INTRO.t < 0.5 ? 2 * INTRO.t * INTRO.t : 1 - Math.pow(-2 * INTRO.t + 2, 2) / 2;
  camera.position.lerpVectors(a.p, b.p, e);
  controls.target.lerpVectors(a.t, b.t, e);
  if (INTRO.t >= 1){
    INTRO.seg++; INTRO.t = 0;
    if (INTRO.seg >= INTRO_KF.length - 1){
      INTRO.on = false;
      controls.enabled = true;
      controls.minDistance = CAM_MIN_DIST;
    }
  }
}
const INTRO_FORCE = (()=>{ try { return /[?&]intro=1/.test(location.search); } catch { return false; } })();
const INTRO_OFF   = (()=>{ try { return /[?&]intro=0/.test(location.search); } catch { return false; } })();
export function introMaybeAuto(){
  if (INTRO_OFF) return false;
  if (PROBE_DRIVEN && !INTRO_FORCE) return false;
  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* 老浏览器 */ }
  if (reduce && !INTRO_FORCE) return false;
  return introStart();
}
/* 任意交互即让位。pointerdown 用捕获阶段，保证与"点击水面涟漪"同时收到
   （涟漪的 pointerup 会读 introActive 决定要不要放弃这一击）。 */
renderer.domElement.addEventListener('pointerdown', introCancel, true);
renderer.domElement.addEventListener('wheel', introCancel, { passive:true, capture:true });
addEventListener('keydown', introCancel, true);
export let VIEWPOINTS = null;
/* buildViewpoints(heroPos) 由 08-assemble 在原 3561 行位置调用：
   HERO_POS 在 08 那边 3117 行同步算出，作为参数传进来（08d 不反向 import 08，避免成环）。
   此刻 world 里立峰尚未进场（延迟批）—— 与搬家前同一位置求值同理，hb 恒为 null，走 14m 兜底。 */
export function buildViewpoints(heroPos){
  const built = (()=>{
  const hp = heroPos || new THREE.Vector3(-4.7, 0, 8.0);
  const out = new THREE.Vector3(hp.x, 0, hp.z).normalize();
  const side = new THREE.Vector3(-out.z, 0, out.x);
  /* 机位距离**按包围盒与 FOV 反算**，不写死。手写距离的教训：6.4m 时立峰切顶、
     石刻小到读不出；11.5m 仍偏紧。构图要的是"石 + 座 + 碑 + 倒影"四样都在框里，
     那就用几何自己算：所需视高 /(2·tan(fov/2)) ×余量。 */
  let hb = null;
  world.traverse(o => { if (o.name === 'taihuHero') hb = o; });
  let dist = 14.0, camY = 1.45, aimY = 2.6;
  if (hb){
    const bb = new THREE.Box3().setFromObject(hb);
    const need = (bb.max.y - bb.min.y) * 0.72 + 2.6;                 // 石高（含水下）+ 底座与留白
    dist = (need / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * 1.5;
    camY = 1.35 + (dist - 12) * 0.10;                               // 越远越要抬一点，避免俯视水线
    aimY = bb.max.y * 0.46;
  }
  return [
    { id:'hero', label:'立峰·云根',
      pos: new THREE.Vector3(hp.x - out.x * dist + side.x * dist * 0.20, camY,
                             hp.z - out.z * dist + side.z * dist * 0.20),
      target: new THREE.Vector3(hp.x, aimY, hp.z) },
    /* 「云根」近观：真正的位姿在**题名石装配的延迟批里**按实测几何回填
       （与立峰机位同源的"反算不写死"原则，见 heroStones 末尾那段）。
       这里先给一个同侧兜底值：机位从第一帧起就存在，选择器/巡游不会取到空。
       minDist 必须显式放开 —— 字心前 2.8m 远小于默认下限 9m，不放就会被弹回去。 */
    { id:'stele', label:'云根近观',
      pos: new THREE.Vector3(hp.x - out.x * 6, 1.6, hp.z - out.z * 6),
      target: new THREE.Vector3(hp.x, 1.0, hp.z),
      minDist: 2.2 },
    { id:'hall', label:'远香堂',
      pos: new THREE.Vector3(0.5, 4.6, 5.0), target: new THREE.Vector3(0, 3.6, -12.0) },
    { id:'pavilion', label:'荷风四面',
      pos: new THREE.Vector3(5.6, 3.2, -1.2), target: new THREE.Vector3(14.0, 3.0, 6.4) },
    { id:'overview', label:'全园',
      pos: CAM_HOME.pos.clone(), target: CAM_HOME.target.clone() },
    /* ── 「看梅」两个机位（2026-10-08 · 老黄："我始终无法有效地观察到院子四个角落的细节，
          这两颗梅花树我就怎么都不能拉近镜头看到细节，你看这个问题怎么有效的解决一下"）──
       两株梅在**墙角**（红梅 NE (22.5,−16.5) / 腊梅 SW (−23.5,17)），而默认机位的注视点钉在园心
       且最近只能到 9m ⇒ 够不到角上。本机位站在**园内一侧**、离树 4.8m、平视花冠（y≈2.6），
       并自带 `minDist: 1.2` ⇒ 到了之后滚轮还能继续推到单朵花上。
       ⚠️ 坐标来自本文件自己的种植表（见上面 `[[22.5,-16.5,1.12,-0.717,'red'], …]`）——
          改种植点必须同步改这里，否则机位会对着一块空地。 */
    { id:'plumRed', label:'红梅',
      pos: new THREE.Vector3(18.63, 2.9, -13.66), target: new THREE.Vector3(22.5, 2.6, -16.5), minDist: 1.2 },
    { id:'plumYellow', label:'腊梅',
      pos: new THREE.Vector3(-19.61, 2.9, 14.19), target: new THREE.Vector3(-23.5, 2.6, 17.0), minDist: 1.2 },
    /* 「马厩」机位（2026-10-09 建 · 2026-10-10 随马厩搬家与转向两次改）：马厩在**东墙外**
       (40, −2)，默认机位在园内朝北 ⇒ 完全看不到，所以必须给入口。
       ⚠️ 2026-10-10 转向后（yaw π ⇒ 院门朝南）改从**西南高处**看：pos(26, 9, 16) →
       target(40, 1.5, −1)。视线越过东墙的核算：与 x=30 的交点在 z≈11.1、高度
       9 + 0.586×(1.5−9) ≈ 6.85m > 墙顶 4.5m ⇒ 不贴墙拍砖，构图是"越墙看厩"。 */
    { id:'stable', label:'马厩',
      pos: new THREE.Vector3(26, 9, 16), target: new THREE.Vector3(40, 1.5, -1), minDist: 3.0 },
    /* 「厩内」近观机位（2026-10-10 老黄："马厩无法近距离观察，可以设置一个专门的观察机位吗？"）：
       站位在**院门外**，视线**正好从院门（栅栏正中 3.6m 的车门）穿进院场**——
       与门洞的交点在 x≈40.9（门洞 38.2~41.8 之内）⇒ 门框把院场框住，构图天然。
       minDist 1.2 ⇒ 进来之后还能一路推到马与马车跟前（默认下限是 1.6）。 */
    { id:'stableNear', label:'厩内',
      pos: new THREE.Vector3(38.5, 2.4, 8.0), target: new THREE.Vector3(42.5, 1.1, -1.0), minDist: 1.2 },
    /* 「流星雨」机位（2026-10-10）：这个机位是**必需品**，不是一个"更好看的角度"——
       本项目的相机**永远抬不起来**（OrbitControls 的 polar 夹在 9.9°~88.6°，相机只能在
       注视点之上或等高 ⇒ 不可能仰视），所以"天上的东西"只能靠**站位抬高 + 近乎水平**的
       视线才看得见：默认俯视机位（pitch −19.3°）画面里只有仰角 −42°~+4° 那条窄带。
       这里取 pos(0,14,24) → target(0,12.6,−18)：相机比注视点高 1.4m、相距 42m
       ⇒ polar ≈ 88.1°（在 88.56° 上限之内），视线只下俯 1.9° ⇒ 画面纵向覆盖约
       **仰角 −25°~+21°**；站得高（14m）则园墙（4.5m）与远山都压到地平线附近，
       于是这条带里**大部分是真的天空**，流星雨才有地方落（12b-sky 的出生点按 NDC
       反投影到这条带上、并要求落点是"真天空" y ≥ 26）。 */
    { id:'meteor', label:'流星雨',
      pos: new THREE.Vector3(0, 14, 24), target: new THREE.Vector3(0, 12.6, -18), minDist: 3.0 },
    /* 「看彩虹」机位（**2026-10-06 重挑**，取代 2026-10-01 的旧口径）：
       老黄要的是"雨后初晴 + 一道跨越全园的彩虹"，所以这是一个**一键情境机位**
       （面板「看彩虹」按钮，见 12-env 的 data-view 分支：先把场景设成 暮色·雨后初晴 再飞）。

       ⚠️⚠️ 旧机位 pos(2, 2.4, 12) 是**错的**（2026-10-06 实测定案，不再回退）：
         · 虹是 r=68m 的**世界空间大拱**（02-scene makeRainbowMesh，摆位常量 CAM_POS/
           CAM_AZ/DIST 按**默认机位**反解）。旧机位站的位置在拱的**圈内**
           （拱平面内半径 57m < 拱带内缘 65.4m）、离拱带只有 **42.9m** ⇒
           5.2m 宽的带子铺满画面上半（实测覆盖 15% 画面、峰值差 589/765、还贴边被切 3361px），
           亮度越过后处理 bloom 阈值 ⇒ **整幅糊成一片灰白**，谁都看不出那是彩虹
           （取证 outputs/_diag/rb-vp.mjs：出图判读"天空均匀灰白、没有彩虹"）。
         · 低机位**原理上**也看不到拱：拱顶只有 y=14m，而远山四层卡片是 renderOrder 0
           （虹 −1）⇒ **山后画、压住虹**；园内自身屋脊（远香堂 9.4m）再从下面挡一层。
           实测 y=7 的机位只剩一条贴山脊的细缝、y=12 更少 ⇒ 出图判读仍是"没有彩虹"。
         ⇒ **唯一能看到这条拱的高度是 ~17m（默认机位的高度）**：高于山脊线与屋脊线。

       ⇒ 本机位 = 沿用默认机位的取景规则、只把站位挪开一点（右 12m、靠前 5m），
          target 取"让拱顶落在画面 20% 处"的俯仰（与默认机位同一套反解）。
          实测（暮·雨后初晴·tier=high，口径同 afterrain-guard）：
            虹像素 3.44%（默认机位 2.76%）、峰值差 248/765（默认 248）、
            离拱带 65m（默认 70m）、**贴边 0px**（拱完整在画内）。
       ⚠️ 这个机位与 02-scene 拱的摆位常量**绑死**：动 CAM_POS/CAM_AZ/DIST/R/archTopY
          就要重挑（跑 outputs/_diag/rb-vp-sweep.mjs 扫候选位姿），
          afterrain-guard 的「看彩虹机位」两条判据会当场报红。 */
    { id:'rainbow', label:'看彩虹',
      /* ⚠️ 2026-10-11：拱整体抬高了 3m（02-scene 的 archTopY 14.0→17.0，老黄"位置再做的高一些"），
         这个机位**跟着抬同样 3m** —— "机位相对拱的位姿"逐字不变，取景与覆盖率就回到原值
         （不跟的话拱在画里变大，afterrain-guard 的覆盖判据 1~8% 当场报红：实测 11.99%）。
         机位是给那道拱配的，拱动了它就跟着动 —— 别改判据窗口。 */
      pos: new THREE.Vector3(-7.14, 20, 33.89),
      target: new THREE.Vector3(6.46, 10.22, -2.43),
      minDist: 2.0 },
    /* 春节烟花（2026-10-05 · 老黄要的"盛大场景"）：
       ⚠️ **这个机位是必需品，不是锦上添花** —— `OrbitControls.maxPolarAngle = 88.6°`
       （"限制俯仰，避免钻入地面"）⇒ **镜头永远抬不起来**（实测：我设的抬头机位被静默钳回
       (0,31.3,31.5)、爆点全落在 NDC.y 1.8~2.5 出框）。所以默认俯视机位**物理上**看不到
       天上的花，只能看到"庭院被染亮"那一半。
       这里给的是**合法位姿**（相机略高于注视点、polar 87.8° < 88.6°，不会被钳）：
       接近平视 ⇒ 画面仰角 −25°~+21°，而爆点空域（12-env FW_VOL：距离 90~150m、高 26~52m）
       正好落在仰角 15~21°。
       ⚠️ 2026-10-05 二改：机位要**同时框住三样** —— 天上的花、被彩光染亮的庭院、
       池南看烟花的一家人（西草坪 x≈−20.4 / z≈−11）。第一版正对北 (0,14,34)→(0,13,−18)：
       花在框里，但**一家人落在画面之外**（他们在 x=−20 那侧）⇒ 出图判读"基本看不到人物"。
       现在东移+南退、往西偏一点：从 (−13,12,26) 看 (−6,10.5,−18)
         · 一家人：约 38m、仰角 −18° ⇒ 画面**左下**（1.6m 的人 ≈ 24px）
         · 绽放空域（26~52m 高、z −72~−26）：仰角 ~20° ⇒ 画面**中上部**
       ⚠️ 为什么必须在 12m 高：maxPolarAngle=88.6° ⇒ 镜头**不能低于注视点去仰望**
       （本文件人物注释与 12-env 烟花注释都记了这条），所以"低机位抬头同时看人和花"物理上
       做不到，只能抬到 12m、用接近平视略俯的合法位姿把两者一起收进画面。 */
    { id:'fireworks', label:'看烟花',
      pos: new THREE.Vector3(-13, 12, 26),
      target: new THREE.Vector3(-6, 10.5, -18),
      minDist: 2.0 },
    /* ── 导览增补三站（2026-10-13 · P0-4③）──
       与 hero/stele 同一条路：锚点取项目里已存在的实体或轨道的实际落点，反算不写死；
       机位键走面板 data-view + 巡游 TOUR_ORDER + 字幕 TOUR_CAPTIONS。
       minDist 全部显式写齐（否则 OrbitControls.update() 会按 CAM_MIN_DIST 钳半径，
       README P2-1 已记过这一坑）；落位实测见 probe/_tmp-tour-visual.mjs 的落位表。 */
    /* 「观鱼」：锦鲤轨道（06g-koi.js:28-36）左瓣 cx=-7.5、右瓣 cx=+7.5，中点 (0,3)
       是三条贯穿轨道共用的一片水面。机位贴水 y=1.55、从南岸往北看，minDist 2.0。 */
    { id:'koi', label:'观鱼',
      pos: new THREE.Vector3(0.0, 1.55, 11.4),
      target: new THREE.Vector3(0.0, 0.15, 3.0),
      minDist: 2.0 },
    /* 「匾联」：远香堂匾额 04-buildings.js:374-378（plaque 4.6x1.35，落在堂前檐梁上）、
       前檐金柱对联同文件 :381-384。堂位 (0,0,-12.8)（本文件 :153），
       机位在草坪 (0, 2.2, -5.7) 朝 (0, 3.9, -7.5)；避开先生晨课的站位（同文件 :1008）。
       minDist 3.0。 */
    { id:'plaque', label:'匾联',
      pos: new THREE.Vector3(0.0, 2.2, -5.7),
      target: new THREE.Vector3(0.0, 3.9, -7.5),
      minDist: 3.0 },
    /* 「曲桥」：石拱桥本文件 :183-187（04-buildings makeArchBridge）落位 (8.4,0,4.6)、
       rotation.y=pi/2。机位在东北下游侧、不上桥（与 :267-272 的步行约定一致），
       连汀步入画；桥面倾角经 controls.minPolarAngle=0.055rad 折算后取 (1.8, 1.35, 12.6)。
       minDist 2.0。 */
    { id:'bridge', label:'曲桥',
      pos: new THREE.Vector3(1.8, 1.35, 12.6),
      target: new THREE.Vector3(8.4, 0.65, 4.6),
      minDist: 2.0 },
  ];
  })();
  VIEWPOINTS = built;
  return VIEWPOINTS;
}
export function gotoViewpoint(id, dur = 1.4, owner = 'manual'){
  const v = VIEWPOINTS.find(x => x.id === id);
  /* ⚠️ 必须把机位自带的 minDist 交给 flyTo：近观机位离目标 2.86m，远小于默认下限 9m，
     不放开的话相机落位瞬间就被 controls.update() 沿**视线方向**推到 9m ——
     方位完全正确、行程走完、也不报错，只有量落位后的真实距离才看得出来（probe/stele-station）。 */
  if (v) flyTo(v.pos, v.target, dur, v.minDist || CAM_MIN_DIST, owner);
  return !!v;
}

/* ── P2-2 带字幕巡游 ──
   在既有 gotoViewpoint/flyTo 之上加一层"按序自动走 + 每站出字幕"：
   · 顺序见下方 TOUR_ORDER（2026-10-13 起 8 站），首站从当前画面飞过去（flyTo 语义不变）；
   · 每站停留 dwell（默认 6s，含 1.4s 飞行），字幕在飞行开始即出（边飞边读）；
   · 用户一接管（pointerdown/wheel/任意导览键/时辰滑杆）即停巡游并收字幕 —
     巡游是"带看"，不是"锁死"，接管权永远在用户手里；
   · __garden 暴露 tourStart/tourStop/tourState 供探针驱动与断言。 */
const TOUR_CAPTIONS = {
  hero:     { title: '立峰 · 云根', text: '古人谓石为云之根 —— 池南水际一峰特置，瘦皱漏透，配石矶底座与岸上题名「云根」。' },
  stele:    { title: '题名石 · 云根', text: '峰侧一块卧石半埋岸土，石面刻「云根」二字。云出石中，石即是根 —— 名字就写在石头上。' },
  /* 「观鱼」站（2026-10-13 · P0-4③ 增补）：锦鲤轨道中心的锚点取 06g-koi.js:29 左瓣 cx=-7.5/cz=0
     与右瓣 cx=7.5/cz=0 的中点 (0,3) —— 那是 11 条鱼 + 2 泳龟的 passages 一起经过的腰心。
     机位贴水（y=1.55，栏杆上沿视线），离注视点 8.4m；minDist 放开到 2.0（该处池宽裁得紧）。
     文案贴 06g 投喂的既有设定（点水面撒饵→鱼放弃轨道游来抢食）。 */
  koi:      { title: '观鱼', text: '池水腰心 —— 十一尾锦鲤沿三圈椭圆轨道巡游，还有两只泳龟慢慢蹭。站在岸上撒一把食，邻近的鱼会丢下轨道游来抢。' },
  /* 「匾联」站：远香堂檐下匾额「远香堂」+ 前檐金柱对联「碧水涵明月清风自在」，
     都在 04-buildings.js:372-384 手份。机位在堂前草坪（z≈-5.7 以南，人阅读机位再往南退开
     人物站位以外的位置），仰角看匾与联一起入画；minDist 3.0（堂前檐距近）。 */
  plaque:   { title: '匾联', text: '檐下「远香堂」匾额，前檐金柱一副对联：碧水涵明月，清风自在。匾与联是这堂的题眼，读完再看满堂荷香。' },
  /* 「曲桥」站：石拱桥在池东南跨水（04-buildings makeArchBridge，08-assemble 落位 (8.4,·,4.6)、
     rotation.y=π/2），桥心即拱顶。机位从**桥的东北上下游侧**取景，连同汀步（z≈5.6 线）一起入画。
     ⚠️ 这个站位刻意**不上桥**：巡游观鱼者的步行路径（实走到 z≥9.7 的南端引桥，见 :267-272 注释）
     用的就是"不上桥"这条约定，机位口径一致。minDist 2.0（桥心近水）。 */
  bridge:   { title: '曲桥', text: '池东南石拱桥跨水，桥南接着一排汀步。拱顶起在水线上，绕桥走一圈，两侧水面各有一番景。' },
  hall:     { title: '远香堂', text: '拙政园中区主厅 —— 四面厅，荷风四面，香远益清。夏日荷香满堂，即是此景。' },
  pavilion: { title: '荷风四面', text: '临水水榭 —— 三面临水，一面接岸。午后到这里听雨，雨点打在荷叶上最响。' },
  overview: { title: '全园', text: '一池三山式水院 —— 水居其半，建筑临水，假山作屏。晨雾与暮色最见层次。' },
};
const SEASON_CAPTIONS = {
  spring: { title: '春 · 惊蛰', text: '春雷初动，池边新芽与远香堂的花事一同醒来。' },
  summer: { title: '夏 · 芒种', text: '荷花渐盛，水榭临风，正是荷风四面时。' },
  autumn: { title: '秋 · 霜降', text: '桂香渐远，枫色染上池岸，石峰在澄水里更显瘦峻。' },
  winter: { title: '冬 · 大雪', text: '雪压竹梢，亭台静敛，满园水墨只剩清瘦的骨架。' },
};
/* 巡游清单（2026-10-13 · P0-4③ 增补）：
   原五站的顺序、机位、停留时长与字幕语义**一字不动**；新三站插在「题名石近观」与「远香堂」之间，
   让巡游从「题名石」接「观鱼 → 匾联 → 曲桥」再收「远香堂 → 荷风四面 → 全园」，是一条顺水的带看线。
   不把梅 / 马厩 / 彩虹 / 流星雨 / 烟花这几个**情境机位**加进来：
     梅/马厩是**位置**机位（在园内的隐角，巡查幕上能看懂），但彩虹/流星雨/烟花是**场景**机位
     （要 雨后初晴 / 夜 / 夜 才有东西看）—— noon/summer/clear 的巡游里它们就是空景。 */
const TOUR_ORDER = ['hero', 'stele', 'koi', 'plaque', 'bridge', 'hall', 'pavilion', 'overview'];
export const TOUR = { on: false, idx: 0, dwell: 6.0, wait: 0 };
let captionOwner = '';
export const captionEl = () => document.getElementById('caption');
function setCaption(c, owner){
  const el = captionEl();
  if (!el || !c) return false;
  el.querySelector('b').textContent = c.title;
  el.querySelector('span').textContent = c.text;
  captionOwner = owner;
  el.classList.add('show');
  return true;
}
export function showCaption(id, owner = 'manual'){
  return setCaption(TOUR_CAPTIONS[id], owner);
}
export function showSeasonCaption(season){
  return setCaption(SEASON_CAPTIONS[season], 'season-demo');
}
export function hideCaption(owner = null){
  if (owner && captionOwner && owner !== captionOwner) return false;
  const el = captionEl();
  captionOwner = '';
  if (el) el.classList.remove('show');
  return true;
}
export function tourStop(){
  TOUR.on = false; TOUR.wait = 0;
  cancelCamFly('tour');
  hideCaption('tour');
  syncTourBtn();
}
export function tourStart(){
  TOUR.on = true; TOUR.idx = 0; TOUR.wait = 0;
  stepTour();
}
function stepTour(){
  if (!TOUR.on) return;
  const id = TOUR_ORDER[TOUR.idx % TOUR_ORDER.length];
  showCaption(id, 'tour');
  gotoViewpoint(id, 1.4, 'tour');
  TOUR.wait = TOUR.dwell;      // 含飞行 1.4s：字幕边飞边读，站后纯停 ≈ dwell-1.4
  syncTourBtn();
}
function syncTourBtn(){
  const b = envEl && envEl.querySelector('button[data-act="tour"]');
  if (!b) return;
  b.classList.toggle('on', TOUR.on);
  b.setAttribute('aria-pressed', TOUR.on ? 'true' : 'false');
  b.textContent = TOUR.on ? '停■' : '巡游▸';
}
export function updateTour(dt){
  if (!TOUR.on) return;
  /* 飞行中不计时：等 CAM_FLY 落定再数停留，避免低帧机器上"还没飞到就切下一站" */
  if (CAM_FLY.on) return;
  TOUR.wait -= dt;
  if (TOUR.wait <= 0){ TOUR.idx++; stepTour(); }
}
/* 用户接管即停：拖拽/滚轮/触屏/导览按钮/键盘导览键 —— 但不明信片/音景按钮不截停。 */
export function tourUserTakeover(){
  if (TOUR.on) tourStop();
}
