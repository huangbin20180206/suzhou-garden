// 12b-sky: 电闪雷鸣 + 春节烟花 —— 2026-10-05 从 12-env.js 整块搬出（纯搬家，逻辑一字未改）。
/* 为什么单独一个文件：这两套是「天上发生的事件」（各自 ~290/350 行），与 12-env 里的
   时段/季节/天气状态机、灯笼、上元灯会、环境面板 UI 是两件事。混在一起时 12-env 逼近 3900 行，
   改一处很难看清周围还有什么（本项目多数低级事故都出在这里）。
   ⚠️ 本文件**绝不能** import './12-env.js' —— 12-env 反过来 import 本文件，成环 = 启动期 TDZ，
   项目已有多起同类前科（见 src/main.js（原 index.html 内联主模块）顶部、00-config 的 HOOKS / ENV_REF 注释）。
   但这里的 tick 是**在函数体里读环境状态**（ENV.weather / ENV.cur），所以走「破环插槽」：
   模块内 let ENV 占位 + 12-env 在自己 body 里调 bindSkyEnv(ENV) 注入（与 00-config 的
   ENV_REF 同一族做法）。注入点早于 11-loop 的 animate；若没注入，读到的就是 null ⇒ 立刻崩，
   这是**故意**的：静默兜底只会让它退化成「永远晴天、永不闪电」而无人察觉。 */
import { THREE } from '../vendor.js';
import { AUX_PASS_HIDDEN } from './01-materials.js';
import { skyMesh, scene, camera, renderer } from './02-scene.js';
import { sun, amb, fill, hemiLight } from './09-lights.js';
import { TAU, HOOKS, mulberry32 } from './00-config.js';

let ENV = null;                                  // 由 12-env.js 的 bindSkyEnv(ENV) 注入
/* 2026-10-29（审查 M8）：烟花闪完要"把灯交还给环境系统"——直接重跑一次 applyEnv(ENV.cur)，
   而不是自己挑几项写回（自己写回会漏掉月光增益/月光色/阴影等 applyEnv 的后处理）。
   本文件不能 import 12-env（成环），故由 12-env 一并注入。 */
let _reapplyEnv = null;
export function bindSkyEnv(state, reapply){ ENV = state; _reapplyEnv = reapply || null; }

/* ══ 电闪雷鸣（2026-09-30 · 老黄需求）══════════════════════════════════════
   天气预设 thunder 只负责"暗"（压到接近暮色）；闪电是叠在上面的**事件**：
   · 随机间隔触发（4.5~11s，约 1/4 概率带一次连击 = 密集）；
   · 单次事件三件套：
     ① 空中电闪：程序化分叉雷电（折线宽带 ribbon，加性发光，叠 bloom）出现在
        **相机看得到的方位**（按当前视线方位角 ±66° 内选），同时写天空 uFlash
        让云层与天幕泛白（着色器里"云响应最强"）；
     ② 亮光划过：一条长亮痕沿同一天区横扫而过（0.3s，边走边淡）；
     ③ 照亮整体：把 sun/amb/hemi/曝光按闪光包络**乘**一个瞬时系数，
        2~4 次脉冲（真实闪电的多闪节奏）后归零；
   · 闪电瞬间通过 `HOOKS.thunder` 通知音景排队雷鸣（延迟按"距离"算，1~3 层叠放）。
   ⚠️ 三条纪律：
   ① 只在 ENV.weather==='thunder' 且未关时推进；离开该天气立刻把叠加量写回基准
      （写完 flash=0 ⇒ 各项 = 基准 × 1，零残留）。
   ② **不新增灯**（灯数一变全场材质重编译）—— 闪光是把既有 sun/amb/hemi/曝光乘系数，
      基准取 ENV.cur（applyEnv 的产物），每帧重算 ⇒ 与过渡系统天然自愈。
   ③ tickLightning 必须在 animate 的 ENV 过渡块**之后**调用（transition 里的 applyEnv
      会覆写光照；顺序反了闪光会被压掉）。
   ④ 顺序：闪电网格与照亮**同帧起**，且绝不出现"只有照亮没有闪电"的帧（老黄明确要求
      "一定是闪电后才有照亮场景的效果"）。 */
export const LIGHTNING = {
  on: true,             // 事件总开关（探针负例用）
  /* 定格：非 null 时把事件时钟**按住**在该 tau（秒），只按它重放包络 ——
     探针要可复现的峰值帧、截图/明信片要拍到闪电，都靠它。
     ⚠️ 为什么必须是产品侧开关：探针在页内"再调一次 tick"是无效的 ——
     渲染循环每帧都会用真实时钟再算一遍，两次互相覆盖（项目 2026-09-24 灯会那次
     就是栽在这上面，冻了 0 位移仍有 0.062m）。同 setFestivalFreeze 的做法。 */
  hold: null,
  next: 4.0,            // 下一次闪电的时刻（仿真秒）
  t0: -99,              // 本次事件起刻
  flash: 0,             // 当前闪光强度 0..1（探针读数）
  boltT: -99,           // 最近一次"闪电网格出现"的时刻
  strikes: 0,           // 累计闪电次数
  lastThunder: null,    // 最近一次雷鸣参数（探针/诊断）
  _pulses: null, _streakA: null, _streakB: null, _streakQ: null, _streakLen: 0,
  _group: null, _bolt: null, _boltMat: null, _streak: null, _streakMat: null,
};
const LN_RNG = mulberry32(20260930);        // 专用随机流（运行期效果也绝不吃全局 rnd）
const lnR = (a, b)=> a + LN_RNG() * (b - a);
const LN_R = 388;                            // 天球半径 420 ⇒ 闪电放在穹内 388
const _lnNd = new THREE.Vector3();            // 复用的 NDC 反投影暂存
/* NDC（归一化设备坐标，x/y ∈ [-1,1]）→ 天球上的世界点。
   ── 为什么按**画面坐标**摆闪电，而不是按"地平线以上多少度"（2026-09-30 实测修正）──
   garden 的机位是**俯视**的：默认机位实测 pitch −19.3°、相机 fov 46（垂直半角 23°）
   ⇒ 画面上缘只到仰角 +3.7°，可见天空是画面上端一条**只有约 4° 高**的窄带。
   旧写法按仰角 9°~38° 摆，实测闪电网格投到 ndc.y 1.8~6.8（整条在画面之上），
   亮痕 1.9~2.4 一样在画外 —— "冻结帧可见↔隐藏"的像素差是 **0**，
   也就是"空中电闪 / 亮光划过"这两个效果**从头到尾一个像素都没画出来**（探针
   outputs/_diag/thunder-bolt-vis.mjs 定案）。按画面坐标摆 ⇒ 相机怎么俯仰都在天上。
   落在天球内的做法：从相机沿该方向走，取与半径 r 天球的**远交点**（相机在球内）。 */
function skyAt(ndcx, ndcy, r){
  const dir = _lnNd.set(ndcx, ndcy, 0.5).unproject(camera).sub(camera.position).normalize();
  const o = camera.position;
  const b = o.dot(dir), c = o.lengthSq() - r * r;
  const disc = b * b - c;
  const t = disc > 0 ? (-b + Math.sqrt(disc)) : r;
  return new THREE.Vector3().copy(o).addScaledVector(dir, Math.max(1, t));
}
/* 折线 → 面向相机的宽带 ribbon（宽 2 边各一顶点，段间出两三角） */
function boltRibbon(pts, widthDir, w0, w1, pos, idx){
  const n = pts.length, base = pos.length / 3;
  for (let i = 0; i < n; i++){
    const t = i / Math.max(1, n - 1);
    const w = (w0 + (w1 - w0) * t) * 0.5;
    const p = pts[i];
    pos.push(p.x + widthDir.x * w, p.y + widthDir.y * w, p.z + widthDir.z * w,
             p.x - widthDir.x * w, p.y - widthDir.y * w, p.z - widthDir.z * w);
    if (i > 0){ const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2,  a + 1, a + 3, a + 2); }
  }
}
function buildLightning(){
  const g = new THREE.Group();
  g.visible = false;
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xE8F0FF, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
  bolt.frustumCulled = false; bolt.renderOrder = 7;
  const streakMat = new THREE.MeshBasicMaterial({ color: 0xD8E4FF, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(170, 6), streakMat);
  streak.frustumCulled = false; streak.renderOrder = 7;
  g.add(bolt, streak);
  scene.add(g);
  /* ⚠️ 天空视觉层必须排除在 GTAO 的法线/深度 pre-pass 之外 —— 与"天上一条大黑拱"
     （虹拱，见 02 makeRainbowMesh / 10-post collectAOSkip）**同一根因**，2026-10-04 实测：
     pre-pass 是拿 override 材质把整个场景重画一遍，本组闪时 visible=true ⇒ 被画进 AO
     的深度缓冲 ⇒ 那片 AO 被算成 ≈0 再乘回画面，**把闪电自己的亮痕压暗**。
     实测（冻结帧同任务 A/B，outputs/_diag/bolt-ao3.mjs / bolt-ao5.mjs）：
       不排除时"bolt visible 切换"在画面上留下 120 px / 最大差 268 的压暗足迹
       —— 注意那次测得 bolt 自身 opacity=0，可见这 120px 全是被 AO 压出来的黑痕；
       排除后该足迹 = 0。
     ⚠️ 本组是**懒建**的（首次落雷才 buildLightning），所以不能走 `userData.aoSkip` +
     collectAOSkip（那张排除表只在装配期收，建晚了收不到）——
     走 AUX_PASS_HIDDEN：GTAO wrapper 每帧按引用读它，建得再晚也生效。 */
  AUX_PASS_HIDDEN.push(g);
  LIGHTNING._group = g; LIGHTNING._bolt = bolt; LIGHTNING._boltMat = boltMat;
  LIGHTNING._streak = streak; LIGHTNING._streakMat = streakMat;
}
/* 闪光包络：一串"起得快、落得稍慢"的脉冲（真实闪电的多闪节奏）。
   ⚠️ **pulses 必须容 null**（2026-10-02 夜间全量链抓到的真缺陷）：
      `LIGHTNING.next = 4.0`（第一次打击在仿真第 4 秒），而 `lnApply(tNow - L.t0)`
      在那之前就会跑 —— 那时 `_pulses` 还是 null ⇒ `for (const p of null)` 必炸
      TypeError。shadow-cover / ripple-bounds 两道门在暴雨臂里各抓到 ×2。
      返回 0 = "还没有闪电就没有照亮"，与"先闪电后照亮"的硬约束自洽。 */
function lnFlashAt(pulses, tau){
  if (!pulses) return 0;
  let v = 0;
  for (const p of pulses){
    if (tau < p.t) break;
    const d = tau - p.t;
    if (d < p.up) v = Math.max(v, p.v * (d / p.up));
    else if (d < p.up + p.down) v = Math.max(v, p.v * (1 - (d - p.up) / p.down));
  }
  return Math.min(1, v);
}
function lnStrike(tNow){
  const L = LIGHTNING;
  if (!L._group) buildLightning();
  camera.updateMatrixWorld();
  /* ── 主干：在**画面空间**里画之字（见 skyAt 的注释：默认机位的可见天空只有约 4° 高）──
     起点放在画面上缘**之外**（byTop > 1）⇒ 读起来是"从云里劈进来"；
     终点落到地平线之下，那截会被园子/远山的深度挡掉，只留天空里那一段可见。 */
  const bx0 = lnR(-0.34, 0.34);
  const byTop = lnR(1.10, 1.26);
  const byBot = lnR(0.50, 0.66);
  const driftX = lnR(-0.34, 0.34);
  const nx = [], ny = [];
  for (let i = 0; i < 11; i++){
    const t = i / 10;
    nx.push(bx0 + driftX * t + lnR(-0.032, 0.032));
    ny.push(byTop + (byBot - byTop) * t + lnR(-0.016, 0.016));
  }
  const mid = skyAt((nx[0] + nx[10]) * 0.5, (ny[0] + ny[10]) * 0.5, LN_R);
  const facing = mid.clone().normalize();
  const widthDir = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing).normalize();
  /* 主干 + 2~4 条分叉，全部塞进同一个几何（一次 draw call） */
  const trunk = [];
  for (let i = 0; i < 11; i++) trunk.push(skyAt(nx[i], ny[i], LN_R));
  const pos = [], idx = [];
  /* 线宽：4.8m @ 388m ≈ 0.0124 rad，在 46° 垂直视角下约 9 像素 —— 要"夸张点"
     就得先看得见；旧值 2.8m 只有 5 像素，且整条在画外（等于没画）。 */
  boltRibbon(trunk, widthDir, 4.8, 1.6, pos, idx);
  const nBr = 2 + ((LN_RNG() * 3) | 0);
  for (let b = 0; b < nBr; b++){
    const i0 = 2 + ((LN_RNG() * 6) | 0);
    const dirA = LN_RNG() < 0.5 ? -1 : 1;
    const pts = [trunk[i0].clone()];
    let bxp = nx[i0], byp = ny[i0];
    const len = 3 + ((LN_RNG() * 4) | 0);
    for (let k = 0; k < len; k++){
      bxp += dirA * lnR(0.020, 0.062);
      byp += lnR(-0.034, 0.022);
      pts.push(skyAt(bxp, byp, LN_R));
    }
    boltRibbon(pts, widthDir, 2.6, 0.6, pos, idx);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  L._bolt.geometry.dispose();
  L._bolt.geometry = geo;
  /* 亮痕（亮光划过）：两端也按画面坐标定，然后**冻结在世界里** ——
     横扫不做"跟着镜头跑"（那会读成贴在屏幕上的假东西），改成
     "长度从 0 擦到全长"（见 tickLightning），所以端点与朝向只需在这里算一次。 */
  {
    /* 两端都要落在**画面内**（x 别超出 ±1）：横扫是"从 A 端擦出去"，
       若 A 在画外，最亮的那一段（sT 小、不透明度高）正好在画外 ⇒ 亮痕等于没画。
       实测第一版 A 取 -1.30~-0.95，投影回来 x = -1.25~-1.1 全在画左之外，贡献 0。 */
    const sy = lnR(0.66, 0.90);
    const A = skyAt(lnR(-0.92, -0.55), sy + lnR(-0.05, 0.05), LN_R * 0.97);
    const B = skyAt(lnR(0.55, 0.92), sy + lnR(-0.05, 0.05), LN_R * 0.97);
    const xAx = B.clone().sub(A);
    L._streakLen = xAx.length();
    xAx.normalize();
    const zAx = A.clone().normalize();                          // 朝外（背向圆心 ≈ 背向相机）
    const yAx = new THREE.Vector3().crossVectors(zAx, xAx).normalize();
    const zAx2 = new THREE.Vector3().crossVectors(xAx, yAx).normalize();
    L._streakA = A; L._streakB = B;
    L._streakQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, yAx, zAx2));
  }
  /* 脉冲序列：2~4 闪 */
  const pulses = [];
  let tt = 0;
  const nP = 2 + ((LN_RNG() * 3) | 0);
  for (let i = 0; i < nP; i++){
    /* ⚠️ 起跳 0.028s（不是 0.012）：60fps 一帧 16.7ms，太陡的起跳**采样不到峰值**
       （探针实测峰值只被采到 0.76）；0.028 让每个脉冲都至少有一帧落在顶上。 */
    pulses.push({ t: tt, v: i === 0 ? 1 : lnR(0.32, 0.85), up: 0.028, down: i === 0 ? 0.11 : 0.15 });
    tt += (i === 0 ? 0.10 : lnR(0.15, 0.25));
  }
  pulses.push({ t: tt + 0.3, v: 0, up: 0.01, down: 0.01 });
  L._pulses = pulses;
  L._boltT = tNow;
  L._group.visible = true;
  L._streak.visible = true;
  /* 雷鸣：闪电在前、雷声在后 —— 延迟按"距离"给，1~3 层叠放 = 密集雷鸣 */
  const delay = lnR(0.9, 3.6);
  const ev = { delay: +delay.toFixed(2),
               layers: 1 + ((LN_RNG() * 2) | 0) + (delay > 2.2 ? 1 : 0),
               gain: +Math.max(0.18, 0.62 * (1 - delay / 6)).toFixed(3),
               lp: Math.round(Math.max(420, 2200 - delay * 420)),
               rate: +lnR(0.92, 1.05).toFixed(3), at: tNow };
  L.lastThunder = ev;
  HOOKS.thunder?.(ev);
}
/* ⚡ 哪些天气会打闪电（2026-09-30 老黄："狂风暴雨和电闪雷鸣合并，空出一格"）——
   合并后**暴雨默认带闪电**：大雨 + 狂风 + 雷电本来就是同一场天气。
   ⚠️ 用 Set 而不是散落的字符串比较：以后再加"带闪电的天气"只改这一处。
   ⚠️ 不要在这里判"雨量"——雨后初晴的 rainAmount=0，但绝不能因此放晴天的虹进来。 */
const LN_ALLOWED = new Set(['storm', 'thunder']);
/* 每帧推进（animate 的 ENV 过渡块之后调用） */
export function tickLightning(dt, tNow){
  const L = LIGHTNING;
  if (!LN_ALLOWED.has(ENV.weather) || !L.on){
    if (L.flash > 0 || (L._group && L._group.visible)){
      L.flash = 0;
      if (L._group){ L._group.visible = false; L._boltMat.opacity = 0; L._streakMat.opacity = 0; }
      skyMesh.material.uniforms.uFlash.value = 0;
    }
    /* 2026-10-30（同烟花 M8 修法）：离开雷雨时若灯还停在闪光倍率上 ⇒ 交还 applyEnv 重算一次（含月光增益、
       月光色、主光方向），而不是自己把 ENV.cur 的几项写回 —— ENV.cur.sunIntensity 不含月光增益。 */
    if (_lnLit) _lnRelease();
    return;
  }
  /* 定格模式（见 LIGHTNING.hold 的注释）：按指定 tau 重放包络，不排新事件、不动 t0 */
  if (L.hold !== null){ lnApply(L.hold); return; }
  if (tNow >= L.next || !L._pulses){
    /* ⚠️ `!L._pulses` 也触发首击（2026-10-02）：进入暴雨/雷雨后第一帧就打雷，
       而不是让用户等 4 个仿真秒看"只有乌云没有闪电"—— 同时把 null 包络这条路堵死。 */
    lnStrike(tNow);
    L.strikes++;
    L.t0 = tNow;
    L.next = tNow + (LN_RNG() < 0.26 ? lnR(0.55, 1.5) : lnR(4.5, 11));   // 约 1/4 概率连击
  }
  lnApply(tNow - L.t0);
}
/* 把"某一次事件在 tau 秒时刻的样子"写到网格 / 天空 / 光照上。
   抽出来是为了给"定格"复用（探针要可复现的峰值帧，截图要拍到闪电）。 */
function lnApply(tau){
  const L = LIGHTNING;
  /* ⚠️ 闪电几何是**首击时懒建**的（lnStrike → buildLightning）—— 在那之前
     _bolt/_streak 都是 null。上面的 lnFlashAt 空值兜底让执行走到这里，
     不挡一下就会换成 "Cannot read properties of null (reading 'visible')"。
     此时本来就还没有闪电 ⇒ 闪光归零、直接返回。 */
  if (!L._group){ L.flash = 0; return; }
  const fRaw = lnFlashAt(L._pulses, tau);
  /* ⚠️ "先闪电、后照亮"是**硬约束**（老黄原话："一定是闪电后才有照亮场景的效果"）：
     把照亮**铆在闪电网格的可见期上** —— 网格不可见的帧一律不许有闪光量。
     这样"只有提亮没有闪电"在构造上就不可能发生（探针实测修前有 3 帧只提亮）。 */
  const boltOn = tau >= 0 && tau < 1.2 && fRaw > 0.02;
  const f = boltOn ? fRaw : 0;
  L.flash = f;
  /* ① 闪电网格 */
  L._bolt.visible = boltOn;
  L._boltMat.opacity = boltOn ? Math.min(1, 0.35 + fRaw * 1.15) : 0;
  /* ② 亮痕横扫（0.3s）—— "长度从 0 擦到全长"，端点/朝向在 lnStrike 时按画面坐标定好、
     冻结在世界里（跟着镜头跑的"亮痕"会读成贴在屏幕上的假东西）。 */
  const sT = tau / 0.3;
  const streakOn = tau >= 0 && sT < 1 && !!L._streakA;
  L._streak.visible = streakOn;
  if (streakOn){
    const s = Math.max(0.001, Math.min(1, sT));
    const A = L._streakA, B = L._streakB;
    L._streak.position.set(A.x + (B.x - A.x) * s * 0.5,
                           A.y + (B.y - A.y) * s * 0.5,
                           A.z + (B.z - A.z) * s * 0.5);
    L._streak.quaternion.copy(L._streakQ);
    L._streak.scale.set(Math.max(0.001, (L._streakLen * s) / 170), 1, 1);   // 几何宽 170
    L._streakMat.opacity = 0.85 * (1 - sT);
  } else L._streakMat.opacity = 0;
  /* ③ 天幕/云层泛白（空中电闪） */
  skyMesh.material.uniforms.uFlash.value = f;
  /* ④ 照亮整体：乘系数。
     ⚠️ 2026-10-30（M8 同类问题，审查 S5-1）：原来**每帧无条件**按 ENV.cur 写四项 ——
       · 主光基准用 ENV.cur.sunIntensity，不含 applyEnv 叠上的月光增益（雨夜月光虽为 0，但雷雨→雨后
         初晴的过渡里月光会回来，闪完主光就掉一截）；
       · 不闪的帧也写，会把同帧别的效果（以后的第三种"天上事件"）踩回基准。
     现在与烟花同一套两态：只在有闪光量时写（主光基准取 applyEnv 发布的 sun.userData.envI），
     闪完那一帧交还 applyEnv 一次，之后一盏灯都不碰。 */
  if (f > 0){
    const C = ENV.cur;
    const sunBase = sun.userData.envI ?? C.sunIntensity;
    sun.intensity = sunBase * (1 + f * 12);
    amb.intensity = C.ambIntensity * (1 + f * 6);
    hemiLight.intensity = C.hemiIntensity * (1 + f * 5);
    renderer.toneMappingExposure = C.exposure * (1 + f * 0.5);
    _lnLit = true;
  } else if (_lnLit){
    _lnRelease();
  }
}
let _lnLit = false;                              // 闪电是否正把灯停在闪光倍率上（收尾一次用）
function _lnRelease(){
  _lnLit = false;
  if (_reapplyEnv) _reapplyEnv();
  else {                                         // 未注入 reapply 的宿主（单测桩）：退回旧的写回
    sun.intensity = sun.userData.envI ?? ENV.cur.sunIntensity; amb.intensity = ENV.cur.ambIntensity;
    hemiLight.intensity = ENV.cur.hemiIntensity; renderer.toneMappingExposure = ENV.cur.exposure;
  }
}
/* 探针用：下一次 tick 立刻打一条闪电 */
export function lightningStrikeNow(){ LIGHTNING.next = -1e9; }

/* ══ 春节烟花（2026-10-05 · 老黄："增加一个盛大的场景：春节烟花（冬季限定），五彩斑斓的
   烟花在天空绽放，和明月星空形成壮美景观，烟花的光彩照应整个庭院，和庭院相映成趣"）══
   ⚠️⚠️ 先说清一条**几何必然**（本轮实测，不是猜）：默认机位是俯视的（俯角 −19.3°、fov 46）
   ⇒ 画面纵向只覆盖仰角 −42.3°~+3.7°，实测（outputs/_diag/sky-band.mjs）**只有画面顶部
   ndc.y ≥ 0.8 那一条才是天**，再往下就被远山（mergedStatic r=156/196）挡住。也就是说
   **高空烟花在默认俯视机位里必然出框** —— 与闪电（按世界仰角摆 ⇒ 贡献 0 像素）、
   彩虹踩过的是同一个坑。所以本系统**分两半交付，各管一件事**：
     · **天上的花**：放园子上空（y 44~76m）。抬头/抬平镜头就能看全（抬平后上半个画面是天），
       另给了「看烟花」机位；默认俯视机位看不到它。
     · **照亮庭院**：每发绽放按自己的颜色给全场打一记光（amb/hemi/sun 乘系数 + **amb 染色**），
       这一半**在任何机位都成立** —— 正是"烟花的光彩照应整个庭院、和庭院相映成趣"。
   ⚠️ 边界如实声明：默认机位只看到"庭院被染亮"，看不到天上的花；这是机位几何决定的，
      不是摆放没摆好（和彩虹"必须抬头看"同一条账）。
   ⚠️ 三条项目规矩：① 弹道/配色/相位全走**私有** mulberry32 流（铁律 1：绝不吃全局 rnd/rr，
      否则其后全园布局整体前移且不报错）；② `raycast = () => {}`（别挡"视线是否被挡"类判定）；
      ③ `userData.aoSkip = true`（不进 GTAO 法线 pass —— 同闪电/彩虹：亮片被当成实体会
      写成一块黑）。 */
const FW_SHELLS = 4;                 // 同时在空的弹数（错峰升空）
const FW_SPARKS = 190;               // 每发火星数 ⇒ 4×190 = 760 个点，**1 个 draw call**
const FW_RISE = 1.15;                // 升空时长（s）
const FW_LIFE = 2.7;                 // 绽放后存活（s）
const FW_GRAV = 4.6;                 // 火花重力（m/s²，比真重力小 ⇒ 更有"飘"感）
const FW_PAL = [0xFFD24A, 0xFF4A3A, 0xFF4AD0, 0x38E0C8, 0x4A78FF, 0x9A5AFF, 0xFFF0C0, 0x8CFF5A];
/* 绽放空域（世界坐标）—— **按"用户真能摆出的机位"反推**，不是拍脑袋：
   ⚠️⚠️ `OrbitControls.maxPolarAngle = 88.6°`（"限制俯仰，避免钻入地面"）⇒ **镜头永远抬不起来**
   （实测：我设的抬头机位被强行钳回 [0, 31.3, 31.5]，爆点全落在 NDC.y 1.8~2.5 **出框**）。
   所以"放高一点、抬头就能看"这条路**物理上不存在**。可用的窗口是：把镜头拉到接近平视
   （φ≈88.6°）时，画面的仰角范围约 −24°~+22° ⇒ **爆点相对相机必须落在 ~20° 仰角以内**。
   取机位 (0, 6, 34) 看 (0, 12, −18) 反推：距离 ~90~150m、高度 26~52m ⇒ 仰角 15~21° ✓ 在框内。
   ⚠️ 默认俯视机位（俯角 −19.3°、可见天空只有顶部 ndc.y≥0.8 那一条）**仍然看不到天上的花** ——
   这是机位几何，不是摆放问题；默认机位交付的是"庭院被染亮"那一半（见 tickFireworks）。 */
const FW_VOL = { x0: -38, x1: 38, y0: 26, y1: 52, z0: -72, z1: -26 };
/* ══ 彩蛋 · 四弹齐射「2027」（2026-10-05 · 老黄："烟花循环的最后一幕 4 弹齐射，
   同时在空中炸出'2027'字样，字体不限、也不用特别工整，能看得出来就好"）══
   **一个弹负责一个数字**（正好 4 弹 4 字）：每颗火星在绽放段飞向"自己那个字"的点云目标 ——
   先按球面炸开一点点、再收拢成字，所以读作"炸出来的字"，而不是"渐显出来的字"。
   ⚠️ 字形点云用 canvas 2D 现描（系统粗体，**不依赖字体文件**），按**索引等距**抽样：
      · 等距抽样是**确定性**的，且**不消耗任何随机流**（连本模块的私有流都不动）；
      · 点密不匀是特性不是缺陷 —— 用户要的正是"不用特别工整，看得出来就行"。 */
const FW_WORD = '2027';
const FW_DIGIT_H = 16.0;        // 字高刻度（m）：字形实际高 ≈0.62×此值 ⇒ 79m 外约 125px
const FW_FIN_EVERY = 12;        // 每 N 发普通烟花之后来一次彩蛋
const FW_FIN_GAP = 11.0;        // 字距（m）：字形宽 ≈0.49×字高刻度 ⇒ 留约 3m 字缝（太开会散）
const FW_FIN_PAL = [0xFFD24A, 0xFF4A3A, 0xFF4AD0, 0x38E0C8];   // 四字四色：金 / 朱 / 品红 / 青碧
function makeDigitTargets(nSpark){
  return [...FW_WORD].map((ch, di) => {
    const W = 200, H = 260;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.font = 'bold 230px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, W / 2, H / 2 + 6);
    const d = g.getImageData(0, 0, W, H).data;
    const pts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4] > 128) pts.push([x, y]);
    const out = new Float32Array(nSpark * 3);
    if (!pts.length) return out;             // 兜底：一个字都没描出来（取不到字体）⇒ 全 0、缩成一点
    /* 「不用特别工整」（老黄 2026-10-07："也不用做得这么工整吧，能够一样识别出来是 2027
       就可以了，毕竟是烟花，不是无人机"）—— 三件事让点阵读作"炸出来的字"而不是"排好的队"：
         · 每个数字**各自**有小倾角（±2.9°）、大小差（±6%）、落点错位（±0.4/0.65m）——
           真实的四发不可能对得整整齐齐；
         · 每颗火星的落点再抖 ±0.17m（字高刻度 16m、笔画约 2~3m 粗 ⇒ 79m 外约 1.8px）——
           幅度是**调出来的**：先用 ±0.25m + 慢摆 ±0.30m，字读得出来但笔画"断断续续"
           （门禁的横段数从 4 涨到 11），收到 ±0.17 / ±0.22 后既保留参差、笔画又不散；
         · 前后错落（z）在原有的 ±0.27m 上再加 ±0.18m。
       ⚠️ 全部吃**本模块的私有流 `_fwr`**（种子 20261008）：确定性、不碰全局流（铁律 1）。
         这会让下面 dir/col/spd/siz 那批抽取整体平移 —— 它们都是**烟花自己的观感参数**，
         与园林布局无关（烟花实例矩阵恒为单位阵，且已在 layout-fingerprint 的排除名单里）。 */
    const tilt = (_fwr() - 0.5) * 0.10, scl = 1 + (_fwr() - 0.5) * 0.12;
    const dx = (_fwr() - 0.5) * 0.8, dy = (_fwr() - 0.5) * 1.3;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let i = 0; i < nSpark; i++){
      const p = pts[Math.floor(i * pts.length / nSpark)];
      const x0 = (p[0] - W / 2) / H * FW_DIGIT_H * scl;
      const y0 = (H / 2 - p[1]) / H * FW_DIGIT_H * scl;
      out[i*3+0] = (x0 * ct - y0 * st) + dx + (_fwr() - 0.5) * 0.34;
      out[i*3+1] = (x0 * st + y0 * ct) + dy + (_fwr() - 0.5) * 0.34;
      out[i*3+2] = ((i % 7) - 3) * 0.09 + (_fwr() - 0.5) * 0.36;
    }
    return out;
  });
}
export const FIREWORKS = {
  force: null,          // 产品侧**权威开关**：null=按季节/时辰自动；true/false=强制（探针用）
  on: false, t: 0, next: 1.2, shots: 0, flash: 0, lastCol: null,
  sinceFin: 0, finale: 0,      // 距上次彩蛋的发数 / 已放彩蛋的次数（门禁要断言）
};
const _fwr = mulberry32(20261008);                       // 私有流（铁律 1）
const _fwStart = new Float32Array(FW_SHELLS).fill(-1e9);  // 每发的**发射**时刻
const _fwPos = new Float32Array(FW_SHELLS * 3);           // 爆点
const _fwLaunch = new Float32Array(FW_SHELLS * 3);        // 发射点（地面）
const _fwCol = new Float32Array(FW_SHELLS * 3);           // 这一发的主色
const _fwFin = new Float32Array(FW_SHELLS);               // 这一发是不是"彩蛋齐射"（1=是）
let _fwCursor = 0;
/* ⚠️ 2026-10-29（审查 H1）：原来这里在模块期抓 amb/hemi/fill 的颜色和 fill 强度当"基准"，
   注释说"applyEnv 只调强度、不动颜色"——这是错的，applyEnv 每次都写这几项颜色。
   而 tickFireworks 每帧把启动值写回去 ⇒ 时段预设的 ambColor/hemiSky/hemiGround/fillColor/
   fillIntensity 从没生效过。现在染色基准一律取 ENV.cur（每帧从基准重算，仍不会累积）。
   只有 fill 的**方向**不在参数集里（09-lights 固定值、applyEnv 不写），故仍存一份用于收尾复位。 */
const FW_FILL_POS0 = fill.position.clone();
/* 上一帧烟花有没有抬过 sun/amb/hemi（见 tickFireworks 里那段"只在闪的时候才写灯"的注释）：
   用来在闪光结束的那一帧把基准写回一次，之后就不再碰这几盏灯 —— 否则会每帧覆写闪电的照亮。 */
let _fwLit = false;
export function setFireworksForce(v){ FIREWORKS.force = v === null ? null : !!v; }
export function fireworksState(){
  return { on: FIREWORKS.on, force: FIREWORKS.force, t: +FIREWORKS.t.toFixed(2),
           shots: FIREWORKS.shots, flash: +FIREWORKS.flash.toFixed(3),
           lastCol: FIREWORKS.lastCol,
           finale: FIREWORKS.finale, sinceFin: FIREWORKS.sinceFin,
           fin: Array.from(_fwFin),          // 哪几个槽是彩蛋（门禁据此断言"四发齐射"）
           ages: [..._fwStart].map(v => +(FIREWORKS.t - v).toFixed(2)),   // 各槽已飞多久（齐射 ⇒ 四值相等）
           word: FW_WORD, digitH: FW_DIGIT_H,
           shells: [..._fwStart].filter(v => FIREWORKS.t - v < FW_RISE + FW_LIFE * 2.5 + 0.1).length };
}
/* 探针用：下一次 tick 立刻来一次彩蛋齐射（产品侧**权威开关** —— 不在探针里重调产品函数） */
export function fireworksFinaleNow(){ FIREWORKS.sinceFin = FW_FIN_EVERY; FIREWORKS.next = -1e9; }
/* ⚠️⚠️ 2026-10-11 改法（老黄："我只点'灯会'按钮，系统会自动帮我把'灯会'+'烟花'联动，这个不合理，
   两个应该是可以单独成景，也可以同时起作用"）：
   **烟花不再"冬·夜·晴 就自动放"，只有他显式点过才放。**
   原来那条自动门控的后果：灯会会把时段切到夜里 ⇒ 只要季节是冬、天气是晴，点灯会就"顺带"把烟花
   点着了（他报的就是这个）。同类毛病还有一处：晴夜会自动下流星（见 meteor 的 _mtOn）—— 两个都改成
   "只认用户那一次点击"。
   现在的语义：`force === true`（用户在「烟花」里开）= 要放；其余（false / null）都 = 不放。
   下面几条仍保留，但降级成**否决**（不再兼作"自动开火的条件"）：
     · 夜色够深（starAmount 是本项目现成的"夜色深度"通道）
     · 天上没有雨雪雷暴（有雨雪就看不见花，也不合物理）
   ⚠️ 与老黄确认过的两条不变：① 与灯会**可同时存在**（他 2026-10-06 明确认可"两者同时出现"）；
      ② 机位仍是必需品（默认俯视机位看不到天上的花）。 */
const _fwOn = () => {
  if (FIREWORKS.force !== true) return false;      // ← 只有显式开过才放（不再"冬夜自动"）
  if ((ENV.cur.starAmount || 0) < 0.5) return false;
  const w = ENV.weather || '';
  if (w === 'storm' || w === 'thunder' || w === 'snow') return false;
  return ((ENV.cur.rainAmount || 0) < 0.05);
};
{
  const n = FW_SHELLS * FW_SPARKS;
  const dir = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const spd = new Float32Array(n), siz = new Float32Array(n), sed = new Float32Array(n), shl = new Float32Array(n);
  /* 彩蛋字形目标（2026-10-05）：每发（壳槽）独占一个数字，一个字 190 颗火星 ⇒ 铺满整张点云表 */
  const tgt = new Float32Array(n * 3);
  {
    const clouds = makeDigitTargets(FW_SPARKS);
    for (let si = 0; si < FW_SHELLS; si++) tgt.set(clouds[si], si * FW_SPARKS * 3);
  }
  for (let i = 0; i < n; i++){
    const si = (i / FW_SPARKS) | 0;
    /* 球面均匀采样 + 一点"上扬"：纯球面看着像一坨，微扬读作"炸开" */
    const u = _fwr() * 2 - 1, th = _fwr() * TAU, r = Math.sqrt(1 - u * u);
    dir[i*3+0] = Math.cos(th) * r; dir[i*3+1] = u * 0.86 + 0.30; dir[i*3+2] = Math.sin(th) * r;
    const c = new THREE.Color(FW_PAL[(_fwr() * FW_PAL.length) | 0]);
    col[i*3+0] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    spd[i] = 6.5 + _fwr() * 7.0;
    siz[i] = 0.75 + _fwr() * 0.85;
    sed[i] = _fwr();
    shl[i] = si;
  }
  /* ⚠️ 用 **InstancedMesh + billboard 片**，不是 THREE.Points。
     理由不是偏好：本机实测 Points 那版**连"固定坐标 + 60px 纯红"的自包含着色器
     都画不出来**（换着色器、放大点尺寸 10 倍、绕过 composer 直接 renderer.render
     全部 0 像素，见 outputs/_diag/fw-why.mjs / fw-tiny.mjs / fw-tiny2.mjs 的判别链），
     而同一份 shader 数学换到 InstancedMesh 片上就正常 —— 与本项目其它 billboard
     （雾团 / 香炉白烟）同一条已被证明能渲染的路径。少一个未知变量。 */
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 3));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(spd, 1));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(siz, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(sed, 1));
  geo.setAttribute('aShell', new THREE.InstancedBufferAttribute(shl, 1));
  geo.setAttribute('aTarget', new THREE.InstancedBufferAttribute(tgt, 3));
  const u = {
    uT: { value: 0 }, uStart: { value: _fwStart }, uPos: { value: _fwPos },
    uLaunch: { value: _fwLaunch }, uCol: { value: _fwCol }, uFin: { value: _fwFin },
    uRise: { value: FW_RISE }, uLife: { value: FW_LIFE }, uGrav: { value: FW_GRAV },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 aDir; attribute vec3 aCol; attribute float aSpeed;
      attribute float aSize; attribute float aSeed; attribute float aShell;
      attribute vec3 aTarget;                       // 彩蛋：这颗火星要飞到的字形点
      uniform float uT, uStart[${FW_SHELLS}], uRise, uLife, uGrav, uFin[${FW_SHELLS}];
      uniform vec3 uPos[${FW_SHELLS}], uLaunch[${FW_SHELLS}], uCol[${FW_SHELLS}];
      varying vec2 vUv; varying vec3 vCol; varying float vA;
      void main(){
        vUv = uv;
        int i = int(aShell + 0.5);
        float age = uT - uStart[i];
        /* 彩蛋那四发要多留一会儿（字要读得完）⇒ 存活窗口按 uFin 放长 1.5 倍 */
        float tot = uRise + uLife * (uFin[i] > 0.5 ? 2.5 : 1.0);   // 彩蛋存活 2.4 倍（见下），留一点余量
        if (age < 0.0 || age > tot){          // 没轮到 / 已经灭了：丢到画外（不占填充率）
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vCol = vec3(0.0); return;
        }
        vec3 base; float env; float rad;
        if (age < uRise){
          /* ── 升空：一条加速上冲的亮点，火星暂时收束成"一条尾巴" ── */
          float k = age / uRise;
          base = mix(uLaunch[i], uPos[i], k * k);
          base.y -= aSeed * 2.2 * (1.0 - k);
          env = 0.85; rad = 0.26;
        } else if (uFin[i] > 0.5){
          /* ── 彩蛋：先"炸开"一点点、再收拢成字（所以读作**炸出来的字**，不是渐显）──
             ⚠️ 2026-10-07 加长燃放过程（老黄："燃放过程和持续时间再长一些"＋"也不用做得这么
                工整…毕竟是烟花，不是无人机"）：
                  · 收拢时长 0.55 → **1.25s**，而且每颗火星有**各自的起步延迟**（按 aSeed 错峰
                    ≤0.45s）⇒ 笔画是"一笔一笔亮起来"的，不是齐刷刷一步到位；
                  · 成形后再叠一层**慢摆**（±0.30m，字高约 10m ⇒ 79m 外约 3px）⇒ 字是"活的"；
                  · 存活 1.5 → **2.4 倍**（2.7s ⇒ 6.5s），淡出起点 0.45 → 0.62（先稳住再散）。 */
          float e = age - uRise;
          float k = clamp((e - aSeed * 0.45) / 1.25, 0.0, 1.0);
          float ease = 1.0 - pow(1.0 - k, 3.0);
          vec3 burst = aDir * (aSpeed * 0.55 * 0.32);       // 起手的球面散开（幅度只要一点点）
          vec3 wob = vec3(sin(e * 1.7 + aSeed * 37.0),
                          cos(e * 1.3 + aSeed * 51.0),
                          sin(e * 0.9 + aSeed * 23.0)) * (0.22 * smoothstep(0.6, 2.2, e));
          base = uPos[i] + mix(burst, aTarget, ease) + wob;
          float life2 = uLife * 2.4;
          env = 1.0 - smoothstep(life2 * 0.62, life2, e);    // 成字后停一会儿再淡
          /* ⚠️ 火星片尺寸要按"覆盖率"算，不能凭感觉：
             覆盖率 = 190×π(r·aSize)² / 字形墨迹面积（≈0.35×字形屏幕宽×高）。
             实测：字 61×78px + rad 0.16（每片约 5px）⇒ **205%** —— 笔画被糊成实心团，
             四个字读作"四个圆光斑"（判读原话）。
             字放大到 98×125px、rad 0.12（每片约 3.7px）⇒ **约 44%**，是能读的点阵。
             ⚠️⚠️ **别靠抬亮度补**：试过 env×1.35 ⇒ 单独一颗小点越过 **bloom 阈值**、
             被辉光糊成一大片，整幅字又并成 1 段（实测贡献从 5 万 px 暴涨到 48.5 万 px、
             横向只剩 1 段）—— 小点要"看得见但不炸 bloom"，只能靠尺寸。 */
          env *= 0.80 + 0.20 * sin(aSeed * 29.0 + e * 7.0);
          /* ⚠️ 这一档是**按覆盖率**选的，不是靠"看图反复调"：0.15 ⇒ 覆盖率约 68%，
             判读成"四个发光的彩色圆球"（0/10）；0.12 ⇒ 约 44%，判读成"是 2027"（4/10）。
             ⚠️ 同一份代码同一机位，多模态两次判读会互相矛盾（0.12 说"是 2027"、0.15 说"光球"）
             —— 所以**以像素量与横向分段数为准**（0.12 时正好 4 段、每段 103~116px、间隔均匀），
             单图判读只作参考。用户的标准是"不用特别工整、看得出来就好"。
             2026-10-07：在 0.12 上再给每颗 ±18% 的大小差（0.82~1.18，均值仍 1.0 ⇒ 覆盖率不变），
             碎一点的星点更像烟花、也顺带把"整齐的点阵"打散。 */
          rad = 0.12 * (0.82 + 0.36 * aSeed);
        } else {
          /* ── 绽放：球面炸开 + 空气阻力 + 重力 + 逐星闪烁 ── */
          float e = age - uRise;
          float drag = 1.0 - 0.34 * (e / uLife);
          vec3 d = aDir * (aSpeed * e * max(0.15, drag));
          d.y -= uGrav * e * e * 0.5;
          base = uPos[i] + d;
          env = pow(max(0.0, 1.0 - e / uLife), 1.5);
          env *= 0.62 + 0.38 * sin(aSeed * 47.0 + e * 19.0) * (1.0 - e / uLife) + 0.38 * (1.0 - e / uLife);
          /* 火星片的半宽：0.20m 太小（5px，糊成小方块且看不出放射），0.95 又太大
             （30px，190 片叠成一团过曝白斑）。0.34 ⇒ 90m 外约 8px，既不糊团也读得出颗粒。 */
          rad = 0.34;
        }
        /* ⚠️ 变量别叫 half —— GLSL ES 3.0 里 half 是**保留字**（留给半精度），
           用它当普通标识符会编译失败：实测报 "VERTEX: 0:105 'half' ..."，
           而在门禁里表现为"这层画不出来"。 */
        float hw = rad * aSize;                            // 世界半宽（米，自动透视）
        vec3 toCam = cameraPosition - base;
        vec3 dir = toCam / max(length(toCam), 1e-4);
        vec3 cr = cross(vec3(0.0, 1.0, 0.0), dir);
        float lr = length(cr);
        vec3 right = lr > 1e-4 ? cr / lr : vec3(1.0, 0.0, 0.0);
        vec3 upv = normalize(cross(dir, right));
        vec3 pos = base + right * (position.x * hw * 2.0) + upv * (position.y * hw * 2.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        vCol = mix(uCol[i], aCol, 0.55);
        vA = env;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec3 vCol; varying float vA;
      void main(){
        vec2 p = vUv - 0.5;
        float d = length(p);
        if (d > 0.5 || vA <= 0.004) discard;               // 圆形软边（同雾团/白烟的写法）
        float a = smoothstep(0.5, 0.03, d) * vA;
        gl_FragColor = vec4(vCol, a);
      }`,
  });
  const im = new THREE.InstancedMesh(geo, mat, n);
  const MI = new THREE.Matrix4();
  for (let i = 0; i < n; i++) im.setMatrixAt(i, MI);      // shader 不读 instanceMatrix；补上只为包围球不退化
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;                 // 顶点位置在 shader 里算，CPU 侧包围球是错的
  im.raycast = () => {};                    // 与雾团/闪电同因
  im.castShadow = false; im.receiveShadow = false;
  im.userData.aoSkip = true;                // 不进 GTAO 法线 pass
  im.renderOrder = 7;
  im.name = 'fireworks';
  FIREWORKS._pts = im; FIREWORKS._u = u;
  scene.add(im);
}
function fwFlash(a){                        // 绽放闪光的包络：**与"花散开"对齐**
  /* ⚠️⚠️ 峰值必须**晚于**花开，不能一炸就最亮。第一版 0.06s 到峰、1.15s 衰减：
     那一刻火星还挤在 ~0.5m 的点里（花还没散开）⇒ 出图判读是
     "庭院被强烈的粉紫光完全照亮，但天上根本没有烟花 —— 这显然是渲染错误"
     （光与"看得见的那朵花"脱节 = 读作 bug）。
     现在 0.28s 到峰（此时火星已散到 ~2.5m 半径、形状已成）、之后 1.42s 衰减 ——
     "看见花"与"庭院被点亮"同时发生，才读作**同一件事**。 */
  if (a < 0 || a > 1.7) return 0;
  if (a < 0.28) return a / 0.28;
  return Math.pow(1 - (a - 0.28) / 1.42, 1.9);
}
export function tickFireworks(dt){
  const F = FIREWORKS, u = F._u;
  F.on = _fwOn();
  if (!F.on){                                // 关：清干净（别留半截花挂在空中）
    if (F.shots){ _fwStart.fill(-1e9); F.shots = 0; }
    F.flash = 0;
  } else {
    F.t += dt;
    u.uT.value = F.t;
    if (F.t >= F.next){
      if (F.sinceFin >= FW_FIN_EVERY){
        /* ── 彩蛋：**四弹齐射**（四发同一个发射时刻），四发并排、一弹一字 ──
           位置按"字形横排"给：中心 (0, 42, −46)、间隔 9.6m ⇒ 整幅字约 36m 宽、单字 7.4m 高；
           在「看烟花」机位（约 78m 外）横跨 ±13°、字高 ≈95px ⇒ 一眼读得出是四个字。 */
        /* ⚠️ 彩蛋的位置要按「看烟花」机位的视锥反推，不能沿用普通烟的随机空域：
           机位 (−13,12,26)→(−6,10.5,−18)，俯仰 −1.9°、画面仰角只到 **+21.2°**。
           第一版放 (0,42,−46)：那里是 **22.6°** ⇒ 整幅字在画面上缘之外（实测贡献只有 331px、
           横向只剩几小段）。改到 (0,34,−52) ⇒ 字心 15.6°、字顶 19.6° ✓ 全在框内。 */
        F.sinceFin = 0; F.finale++;
        const cx = 0, cy = 34, cz = -52, gap = FW_FIN_GAP;
        for (let i = 0; i < FW_SHELLS; i++){
          const bx = cx + (i - (FW_SHELLS - 1) / 2) * gap;
          _fwPos[i*3] = bx; _fwPos[i*3+1] = cy; _fwPos[i*3+2] = cz;
          _fwLaunch[i*3] = bx * 0.72 + (_fwr() - 0.5) * 2.5;
          _fwLaunch[i*3+1] = 2.0;
          _fwLaunch[i*3+2] = cz + 11 + (_fwr() - 0.5) * 3;
          const fc = new THREE.Color(FW_FIN_PAL[i % FW_FIN_PAL.length]);
          _fwCol[i*3] = fc.r; _fwCol[i*3+1] = fc.g; _fwCol[i*3+2] = fc.b;
          _fwStart[i] = F.t;                 // ⚠️ 四发**同一个**发射时刻 = 齐射（不是错峰）
          _fwFin[i] = 1;
        }
        F.shots += FW_SHELLS;
        F.lastCol = '彩蛋 · 2027';
        /* 等字读完再排下一发：彩蛋寿命 = 升空 1.15 + 存活 2.7×2.4 ≈ 7.6s
           （2026-10-07 从 5.2 加长到 8.8 —— 老黄要"燃放过程和持续时间再长一些"） */
        F.next = F.t + FW_RISE + 8.8;
      } else {
        const i = _fwCursor % FW_SHELLS; _fwCursor++;
        const bx = FW_VOL.x0 + _fwr() * (FW_VOL.x1 - FW_VOL.x0);
        const by = FW_VOL.y0 + _fwr() * (FW_VOL.y1 - FW_VOL.y0);
        const bz = FW_VOL.z0 + _fwr() * (FW_VOL.z1 - FW_VOL.z0);
        const c = new THREE.Color(FW_PAL[(_fwr() * FW_PAL.length) | 0]);
        _fwPos[i*3] = bx; _fwPos[i*3+1] = by; _fwPos[i*3+2] = bz;
        _fwLaunch[i*3] = bx * 0.72 + (_fwr() - 0.5) * 6;
        _fwLaunch[i*3+1] = 2.0;
        _fwLaunch[i*3+2] = bz + 10 + (_fwr() - 0.5) * 8;
        _fwCol[i*3] = c.r; _fwCol[i*3+1] = c.g; _fwCol[i*3+2] = c.b;
        _fwStart[i] = F.t;
        _fwFin[i] = 0;                       // ⚠️ 槽会被复用 ⇒ 普通发必须把彩蛋标记清掉
        F.lastCol = '#' + c.getHexString();
        F.shots++;
        F.sinceFin++;
        F.next = F.t + 1.5 + _fwr() * 2.4;   // 1.5~3.9s 一发，偶尔连放
        _fwr() < 0.28 && (F.next = F.t + 0.35);
      }
    }
    u.uStart.value = _fwStart; u.uPos.value = _fwPos;
    u.uLaunch.value = _fwLaunch; u.uCol.value = _fwCol; u.uFin.value = _fwFin;
  }
  /* 取当前最强的那一发做主色（没有在闪的就归零） */
  let f = 0, ci = 0, best = -1;
  for (let i = 0; i < FW_SHELLS; i++){
    const e = fwFlash(F.t - _fwStart[i] - FW_RISE);
    if (e > f){ f = e; best = i; }
  }
  F.flash = f;
  /* ── 照亮庭院：取当前最强的那一发做主色（"烟花的光彩照应整个庭院"）──
     ⚠️ 必须**每帧从 ENV.cur 的基准重算**（同 lnApply）：否则一帧帧乘上去指数发散。
     ⚠️⚠️ 分工（2026-10-05 出图复核后改）：**方向光当主力、环境光只补一点点**。
        第一版把 amb 抬 12 倍 —— 出图判读是"整片下半部均匀糊成一层肉粉、没有方向、
        像套了滤镜"，那正是环境光的性质（无方向、平）。改成把 `fill`（现成的方向光）
        挪到**爆点方向**、染成爆点色、按包络抬强度 ⇒ 墙/石/桥被同一方向的光照亮，
        亮面朝爆点、暗面背离，才有"被天上那朵花打亮"的读感。 */
  /* ⚠️⚠️ 只在「有闪光量」或「上一帧在闪（需要收尾一次）」时才写这三盏灯 ——
     原版是**每帧无条件**从 ENV.cur 重写基准值，而 animate 里 tickFireworks 排在
     tickLightning **之后**（11-loop 的 944 → 948）⇒ 闪电的"照亮整体"会被整帧覆写成基准：
     实测 2026-10-05 thunder-guard 的"照亮整体"三条全红（sun 峰值 0.061 = 基准、被照亮帧 0、
     下半部只 +0.3），而 flash 明明到了 0.95 —— 与拆分无关，是烟花那批带进来的（stash 对照已证伪拆分）。
     烟花与闪电**不会同时出现**（烟花要无降水、闪电要雷雨），所以"不闪就完全不碰"即可互不干扰；
     仍然每帧从 ENV.cur 基准重算 ⇒ 不会指数发散（下面那条注释的担忧依然成立）。 */
  /* ⚠️ 2026-10-29（审查 H1/M8）：所有写灯都收进"在闪"分支；不闪且已收尾 ⇒ 一盏灯都不碰
     （烟花关着时 f 恒为 0、_fwLit 恒为 false ⇒ 零写入，probe/fireworks-lights-unit.mjs 锁住）。
     主光基准取 applyEnv 发布的 sun.userData.envI（含月光增益）—— ENV.cur.sunIntensity
     不含月光增益，拿它当基准会让月夜主光一闪就掉到约一半。
     ⚠️ 方向光是"把庭院照亮"的**主力**，倍数要给够：第一版只给 8 倍 +
     环境光 2.6 倍，出图在"冬夜本来就极暗"的底子上仍是**一片黑剪影**
     （判读："建筑、山、墙几乎全是黑剪影，看不出烟花投下的亮面与暗面"）。
     现在方向光 8→18 倍、半球光 3.2→4.5 —— 环境光**不抬**（它是无方向的，抬它只会变回"粉色滤镜"）。 */
  if (f > 0.0001 && best >= 0){
    const C = ENV.cur;
    const sunBase = sun.userData.envI ?? C.sunIntensity;
    sun.intensity        = sunBase           * (1 + f * 1.2);
    amb.intensity        = C.ambIntensity    * (1 + f * 2.6);
    hemiLight.intensity  = C.hemiIntensity   * (1 + f * 4.5);
    fill.intensity       = C.fillIntensity   * (1 + f * 18.0);
    renderer.toneMappingExposure = C.exposure * (1 + f * 0.18);
    ci = best;
    const t = Math.min(1, f * 1.6);
    /* 方向光从爆点照向园子：DirectionalLight 的方向 = position → target（默认原点），
       所以把 position 放到爆点即可 ⇒ 亮面自然朝上方那朵花。 */
    fill.position.set(_fwPos[ci*3], _fwPos[ci*3+1], _fwPos[ci*3+2]);
    const fc = C.fillColor, ac = C.ambColor, hs = C.hemiSky;
    fill.color.setRGB(fc.r + (_fwCol[ci*3]   - fc.r) * t,
                      fc.g + (_fwCol[ci*3+1] - fc.g) * t,
                      fc.b + (_fwCol[ci*3+2] - fc.b) * t);
    amb.color.setRGB(ac.r + (_fwCol[ci*3]   - ac.r) * t * 0.7,
                     ac.g + (_fwCol[ci*3+1] - ac.g) * t * 0.7,
                     ac.b + (_fwCol[ci*3+2] - ac.b) * t * 0.7);
    hemiLight.color.setRGB(hs.r + (_fwCol[ci*3]   - hs.r) * t * 0.6,
                           hs.g + (_fwCol[ci*3+1] - hs.g) * t * 0.6,
                           hs.b + (_fwCol[ci*3+2] - hs.b) * t * 0.6);
    hemiLight.groundColor.copy(C.hemiGround);
    _fwLit = true;
  } else if (_fwLit){
    /* 收尾**一次**：fill 方向复位（参数集里没有方向），其余整套交给 applyEnv(ENV.cur) 重算
       （强度/颜色/月光增益/曝光与正常路径完全一致），然后彻底松手（别再覆写闪电等效果）。 */
    fill.position.copy(FW_FILL_POS0);
    _reapplyEnv();
    _fwLit = false;
  }
}

/* ══ 流星雨（2026-10-10 · 老黄："再加一个比较吸引人的场景 -- 流星雨，四季都有，晴朗的夜间
      设计一场壮丽的流星雨"，并给了江南流星雨的资料）════════════════════════════════
   ── 资料 → 参数（每条都能对上，不是随手填的）────────────────────────────────
     · "单颗流星（偶发）四季都有；**流星雨**由地球每年过不同尘埃带决定 ⇒ 有季节性"
       老黄要**四季都有** ⇒ 不设季节门槛；但**辐射点按季节挪**（夏=英仙座 / 秋=猎户座 /
       冬=双子座 / 春=天琴座，方位与高度按江南约 31°N 后半夜的真实情况给）⇒
       哪个季节看都像"那一季该有的那场雨"。
     · "同一场雨从同一个**辐射点**向外辐射、速度范围接近" ⇒ 每条流星的方向 = 从辐射点向外，
       速度取同一档（±40% 抖动）。
     · "亮度/长度/速度/颜色各不相同" ⇒ 长度·粗细·速度·寿命·亮度逐条独立抽。
     · "白/黄白最常见，绿-蓝绿（镁）次之，黄橙（钠）、红橙（铁/钙/高层大气）较少；
        肉眼多数只读成一道白线，**只有很亮的火流星才比较容易看出颜色**"
       ⇒ 加权取色（白 45 / 黄白 25 / 绿-蓝绿 15 / 黄橙 10 / 红橙 5），且**火流星更饱和**。
     · "后半夜到黎明前最好" ⇒ 门槛用 starAmount（本项目现成的"夜色深度"通道）。
   ── 实现（沿用闪电/烟花那条**已被证明能渲染**的路：InstancedMesh + billboard 片）──
     ⚠️ 不用 THREE.Points —— 本项目实测 Points 连"固定坐标 + 60px 纯红"都画不出来（见烟花那段）。
     ⚠️ 出生点**必须按画面来定**，不能按世界角度：本项目机位永远抬不起来
        （OrbitControls 的 polar 夹在 9.9°~88.6°、相机只能在目标之上或等高），画面里的天
        只有地平线以上一条带 ⇒ 用 skyAt() 把 NDC 反投影到天球（与闪电同一个工具）、
        并要求落点是"真天空"（y ≥ 26）。这正是闪电那条"N 摆在画面外 ⇒ 贡献 0 像素"的教训。
     方向：从辐射点向外（真辐射几何），但把竖直分量夹在 −0.5~+0.22 —— 辐射点在天顶附近时，
        纯"向外"会让流星一头扎进地平线、在画面里只划一小段；夹住之后是"横掠天带"。
   ⚠️ **不写任何全局灯光**（烟花那条教训：按自己的包络写 sun/amb/hemi 会覆写闪电的照亮）。
     流星的"壮丽"来自天上那一片光痕，不靠打光 —— 也就不会与闪电/烟花互相踩。
   ⚠️ 网格**模块期就建**（不懒建）：GTAO 的法线 pass 只认"装配收尾那一刻在场景里 + aoSkip"
     的对象，懒建的会漏进 AO pass（天上会出现暗斑）。同时挂 AUX_PASS_HIDDEN 兜底。 */
export const METEORS = {
  force: null,          // 产品侧**权威开关**：null=按门控；true/false=强制（探针用）
  on: false, t: 0, next: 0.7, spawned: 0, bursts: 0, fireballs: 0, burstLeft: 0,
};
const _mtr = mulberry32(20261010);                 // 私有流（铁律 1：绝不吃全局 rnd）
const mtR = (a, b) => a + _mtr() * (b - a);
const MT_N = 30;                                   // 同时在飞的条数上限
/* ⚠️⚠️ 半径必须**小于远山卡片**（2026-10-10 实测修正）：远山四层卡片在 r=104~176、
   不透明度 0.76~0.95，而本项目相机又抬不起来（画面里的天只有地平线以上一条带，
   低仰角那一段**正好被远山占着**）⇒ 第一版把流星放在 r=360（穹内、与闪电同半径），
   实测**整条被远山挡住**（沿视线打射线：流星头在 373m，而远山卡片在 439m 那条是别的、
   可见的只有寥寥几像素）。改到 **96**（在最近一层远山 104 之内）⇒ 流星在远山之前，
   低仰角那段才真的看得见。
   半径缩了 3.75 倍 ⇒ 所有**世界尺度**（速度/尾长/粗细/出生点后移量）同乘 MT_K，
   这样**角尺寸与角速度与原来完全一致**（只是把那一层玻璃挪近了）。
   ⚠️ 代价是有意的：流星会画在远山**之前**（真实的流星在远山之后、本该被山挡）。
   但"相机抬不起来 + 远山占到仰角 ~21°"这两条一起，把可见天带全占了 ——
   放到山后就是**一条都看不见**（第一版实测就是这个结果）。夜里远山是近黑的剪影，
   一道亮痕压在山脊前读作"流星划过山脊上方"，观感成立 ✓ 优于"什么都看不到"。 */
const MT_R = 96;
const MT_K = MT_R / 360;
/* 单条亮痕的亮度 × 出口限幅（2026-10-10 修"大面积白屏"定的两个常数）：
   加法混合下屏幕贡献 = vC × a，而 a 的峰值是 3.4（片元的 core×tail×head 在头部取到）
   ⇒ **芯亮度 ≈ MT_BR_HI × 3.4**。夜里 bloom 阈值 0.90、强度 0.50：芯一旦远超 1.0，
   光晕就被最大一级 mip 铺满整幅（见 mtSpawn 里那段实测表）。
   取 0.62 ⇒ 芯 ≈ 2.1（够白：ACES 后 ≈ 241/255），再叠 MT_CEIL=1.8 的出口限幅兜住极端。 */
const MT_BR_LO = 0.30, MT_BR_HI = 0.62, MT_CEIL = 1.8, MT_FB_MUL = 1.6;
const MT_BR_MAX = MT_BR_HI * MT_FB_MUL;      // 单条最亮（火流星）—— 门禁按它守上限
const _mtStart = new Float32Array(MT_N).fill(-1e9);
const _mtPos = new Float32Array(MT_N * 3);
const _mtDir = new Float32Array(MT_N * 3);
const _mtCol = new Float32Array(MT_N * 3);
const _mtLife = new Float32Array(MT_N);
const _mtSpd = new Float32Array(MT_N);
const _mtLen = new Float32Array(MT_N);
const _mtWid = new Float32Array(MT_N);
const _mtBr = new Float32Array(MT_N);
let _mtCursor = 0, _mtMesh = null, _mtU = null;
const _mtRad = new THREE.Vector3(), _mtTmp = new THREE.Vector3(), _mtTmp2 = new THREE.Vector3();
/* 四季辐射点（方位角自北起顺时针、度；高度角、度）—— 各对一场真实流星雨（江南 ≈31°N 后半夜）*/
const MT_RADIANT = {
  spring: { az: 100, el: 58 },   // 天琴座（4/22 前后）—— 东偏南、后半夜升高
  summer: { az: 36,  el: 52 },   // 英仙座（8/12-13；资料里"北半球最稳定、观赏性较强"那场）
  autumn: { az: 132, el: 44 },   // 猎户座（10/21 前后）—— 东南
  winter: { az: 186, el: 68 },   // 双子座（12/13-14；资料里"流星数量较多"那场）—— 南天近头顶
};
/* 颜色权重（资料原文：白/黄白最常见、绿-蓝绿（镁）次之、黄橙（钠）、红橙（铁/钙）较少） */
const MT_PAL = [[0xFFFFFF, 45], [0xFFF4C8, 25], [0x9CFFD0, 15], [0xFFD48A, 10], [0xFF9A6A, 5]];
const MT_WSUM = MT_PAL.reduce((s, p) => s + p[1], 0);
function mtPickColor(sat){
  let x = _mtr() * MT_WSUM, hex = MT_PAL[0][0];
  for (const [h, w] of MT_PAL){ if ((x -= w) <= 0){ hex = h; break; } }
  const c = new THREE.Color(hex);
  if (sat > 0) c.offsetHSL(0, sat, 0);          // 火流星：更饱和（"只有很亮的火流星才看得出颜色"）
  return c;
}
function mtRadiantDir(out){
  const r = MT_RADIANT[ENV.season] || MT_RADIANT.summer;
  const A = r.az * Math.PI / 180, E = r.el * Math.PI / 180;
  return out.set(Math.sin(A) * Math.cos(E), Math.sin(E), -Math.cos(A) * Math.cos(E)).normalize();
}
/* 生成一条流星 */
function mtSpawn(tNow){
  const i = _mtCursor = (_mtCursor + 1) % MT_N;
  mtRadiantDir(_mtRad);
  /* 出生点：NDC（画面上带）→ 天球（r=MT_R）；要求落点是**真天空且高过远山**。
     ⚠️ 判据用**仰角**而不是"y ≥ 26"（相机高度会变，写死 y 的阈值会随站位失准）。
     ⚠️ 阈值 7°→**11°**（2026-10-10 第二次修正）：远山四层卡片的仰角范围实测到 **+21°**，
     7° 出生出来的流星有一大批**压在远山剪影里**（门禁量到"峰值 0"，而同一批里仰角高的那条
     量到 361px/峰值 170）⇒ 出生点必须落在剪影之上。 */
  const pickSpawn = (ndcYLo, needEl) => {          // 在给定 NDC 上带找"够高"的出生点
    let bx = 0, by = -1e9, bz = 0, bEl = -99;
    for (let k = 0; k < 8; k++){
      const q = skyAt(mtR(-0.95, 0.95), mtR(ndcYLo, 1.0), MT_R);
      const rel = _mtTmp2.copy(q).sub(camera.position);
      const el = Math.asin(Math.max(-1, Math.min(1, rel.y / Math.max(1, rel.length())))) * 180 / Math.PI;
      if (el > bEl){ bEl = el; bx = q.x; by = q.y; bz = q.z; }
      if (el >= needEl) break;
    }
    return [bx, by, bz, bEl];
  };
  let [px, py, pz] = pickSpawn(0.50, 11);
  /* 方向 = 从辐射点向外（**真辐射几何**）。
     ⚠️⚠️ 2026-10-10 三轮定案：第一版竖直分量夹到 [−0.5,+0.22] ⇒ 流星一路往下扎出画面；
     第二版夹到 ±0.12 ⇒ 出图判读"几条彼此**平行**、不像从一个辐射点散开"（把辐射感也夹没了 ✗）。
     现在只做**轻度压缩**（×0.75、上限 ±0.35）：既保留"从一点辐射"的方向差，
     又不至于整条一头扎进地平线。 */
  const aimDir = () => {
    _mtTmp.set(px, py, pz).addScaledVector(_mtRad, -MT_R).normalize();
    _mtTmp.y = Math.max(-0.35, Math.min(0.35, _mtTmp.y * 0.75));
    _mtTmp.normalize();
  };
  aimDir();
  /* **第二遍**：算出来是"向下飞"的，就换一个更高的出生点重算 —— 出生仰角与飞行方向互相依赖，
     一遍算不出来（第一版把顺序写反了：先读还没算出来的方向）。向下飞的必须生得更高，
     否则整条命大半在画面外/远山后（这正是门禁反复量到 0 像素的那条根因之一）。 */
  if (_mtTmp.y < -0.05){
    const [hx, hy, hz, hEl] = pickSpawn(0.72, 15);
    if (hEl >= 15){ px = hx; py = hy; pz = hz; aimDir(); }
  }
  /* 亮火流星约 7%（资料："很亮的火流星"才容易看出颜色）；速度/长度/粗细/寿命/亮度逐条抽。
     ⚠️ 世界尺度全部乘 MT_K（半径缩进来的换算）⇒ 角尺寸/角速度与 r=360 版一致。
     ⚠️⚠️ 亮度 2026-10-10 **第二次**修正（老黄报的 bug："任何一个季节的流星雨都会出现大面积
        的无规则闪烁白屏幕"）。上一版为了"壮丽"把基础亮度从 0.55~1.15 提到 **0.85~1.75**、
        火流星 ×2.4 ⇒ 单条亮痕的**加法贡献 = vC × a** 最高 **14.3**（火流星）—— 而夜里 bloom
        的阈值只有 **0.90**、强度 0.50 ⇒ 亮痕把 bloom 顶爆，**最大那一级 mip 把光晕铺满整幅**
        （取证 outputs/_diag/bloom-repro-many.mjs：把"亮痕 + bloom"这条链单独复刻出来量整幅平均亮度）
            原式 同时 15 条 ⇒ **46**；30 条 ⇒ **75.7**；30 条全火流星 ⇒ **170.7**
                  （= 满屏白。产品常态 5~8 条、阵发 12~15 条 ⇒ 一进流星雨就白屏；流星一亮一灭
                    ⇒ 整幅跟着脉动 = 老黄说的"无规则闪烁"）
            修正后 同时 15 条 ⇒ **7.9**；30 条 ⇒ **14.1**（而亮痕芯仍是 237/255 = 白）
        ⇒ 根因是**亮度被双重计入**（一次进颜色 vC、一次进 alpha a；加法混合下贡献 = vC×a），
          于是"调亮度"实际是**平方级**地推 bloom。现在基础亮度回到 **0.30~0.62**、火流星 ×1.6
          （最高 0.99 ⇒ 芯 ≈3.4，被出口限幅压住），并给出口加**限幅**（见片元 shader 的 uCeil）。
        ⚠️ 条数（"壮丽"）**没动** —— 该砍的是单条亮度而不是密度：芯亮到 237 与 250 肉眼无差，
          但 bloom 的进料差一个数量级。 */
  const fb = _mtr() < 0.07;
  const c = mtPickColor(fb ? mtR(0.07, 0.15) : 0);
  const spd = mtR(85, 210) * MT_K * (fb ? 1.25 : 1);
  const len = spd * mtR(0.16, 0.34) * (fb ? 1.8 : 1);
  const wid = mtR(1.4, 3.2) * MT_K * (fb ? 1.7 : 1);
  const br = mtR(MT_BR_LO, MT_BR_HI) * (fb ? MT_FB_MUL : 1);
  const back = mtR(20, 90) * MT_K;                // 出生点沿方向后移（从画面外一点点飞进来）
  _mtPos[i*3] = px - _mtTmp.x * back;
  _mtPos[i*3+1] = py - _mtTmp.y * back;
  _mtPos[i*3+2] = pz - _mtTmp.z * back;
  _mtDir[i*3] = _mtTmp.x; _mtDir[i*3+1] = _mtTmp.y; _mtDir[i*3+2] = _mtTmp.z;
  _mtCol[i*3] = c.r; _mtCol[i*3+1] = c.g; _mtCol[i*3+2] = c.b;
  _mtLife[i] = mtR(0.55, 1.25);
  _mtSpd[i] = spd; _mtLen[i] = len; _mtWid[i] = wid; _mtBr[i] = br;
  _mtStart[i] = tNow;
  if (fb) METEORS.fireballs++;
}
{
  /* 模块期建网格（见文件头注释：懒建会漏进 GTAO 法线 pass） */
  const geo = new THREE.PlaneGeometry(1, 1);
  const shl = new Float32Array(MT_N);
  for (let i = 0; i < MT_N; i++) shl[i] = i;
  geo.setAttribute('aShell', new THREE.InstancedBufferAttribute(shl, 1));
  const u = {
    uT: { value: 0 }, uStart: { value: _mtStart },
    uPos: { value: _mtPos }, uDir: { value: _mtDir }, uCol: { value: _mtCol },
    uLife: { value: _mtLife }, uSpd: { value: _mtSpd }, uLen: { value: _mtLen },
    uWid: { value: _mtWid }, uBr: { value: _mtBr }, uCeil: { value: MT_CEIL },
  };
  _mtU = u;
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute float aShell;
      uniform float uT;
      uniform float uStart[${MT_N}], uLife[${MT_N}], uSpd[${MT_N}], uLen[${MT_N}], uWid[${MT_N}], uBr[${MT_N}];
      uniform vec3 uPos[${MT_N}], uDir[${MT_N}], uCol[${MT_N}];
      varying vec2 vUv; varying vec3 vC; varying float vA;
      void main(){
        vUv = uv;
        int i = int(aShell + 0.5);
        float age = uT - uStart[i];
        if (age < 0.0 || age > uLife[i]){      /* 没轮到 / 已灭：丢到画外，不占填充率 */
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vC = vec3(0.0); return;
        }
        vec3 d = uDir[i];
        vec3 head = uPos[i] + d * (uSpd[i] * age);
        vec3 tail = head - d * uLen[i];
        vec3 toCam = normalize(cameraPosition - head);
        /* ⚠️⚠️ 2026-10-10 必修：cross(d, toCam) 在两者**接近平行**时 → 0，
           normalize(0) = NaN ⇒ 整条 quad 退化、**一个像素都不画**。
           横掠的流星（d.y≈0）+ 平视的相机 ⇒ 这个退化态非常容易撞上：实测同一次启动里
           "有条能画 361px、有的一像素都没有"（门禁因此反复量到峰值 0）。
           兜底：叉积太短就改用"世界上方向 × 飞行方向"当侧向量（billboard 的标准做法）。
           ⚠️ 写 GLSL 注释**绝不能用反引号** —— 那段在 JS 模板字符串里，反引号会当场截断字符串
           （2026-10-02 天空球那次踩过一模一样的坑，本轮我又踩了一次 ⇒ 页面卡加载页、
           pageerror "Unexpected identifier 'cross'"，查了两轮才发现）。 */
        vec3 side = cross(d, toCam);
        float sl = length(side);
        side = sl > 1e-3 ? side / sl : normalize(cross(d, vec3(0.0, 1.0, 0.0)));
        float k = uv.x;                        /* 0 = 尾、1 = 头 */
        vec3 p = mix(tail, head, k) + side * (uv.y - 0.5) * uWid[i] * (0.22 + 0.78 * k);
        float life = age / uLife[i];
        vA = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.72, 1.0, life));
        vC = uCol[i] * uBr[i];
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uCeil;
      varying vec2 vUv; varying vec3 vC; varying float vA;
      void main(){
        float k = vUv.x;
        float core = exp(-pow((vUv.y - 0.5) * 3.2, 2.0));     /* 横截面亮芯 */
        float tail = pow(k, 2.4);                              /* 尾部渐隐 */
        float head = 1.0 + 2.4 * exp(-(1.0 - k) * 9.0);        /* 头更亮（流星招牌） */
        float a = core * tail * head * vA;
        if (a <= 0.004) discard;
        /* ⚠️⚠️ 2026-10-10 修"大面积无规则闪烁白屏"：出口**限幅**。
           原式是 vec4(vC, a) —— 加法混合（SrcAlphaFactor/OneFactor）下屏幕贡献 = vC × a，
           所以亮度被算了两次，火流星峰值能到 14.3，而 bloom 阈值只有 0.90 ⇒ 光晕铺满整幅。
           现在把**已乘完 alpha 的颜色**（= 真正的屏幕贡献）限到 uCeil，并把 alpha 置 1
           （贡献 = rgb 本身，与原来逐字等价、只是被限住）。
           取值依据（同上取证表）：限到 1.8 后亮痕芯仍是 237~244/255（肉眼照旧是"白"），
           而 15 条同时在场时整幅平均亮度从 46 掉到 7.9。 */
        vec3 c = min(vC * a, vec3(uCeil));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const im = new THREE.InstancedMesh(geo, mat, MT_N);
  const MI = new THREE.Matrix4();
  for (let i = 0; i < MT_N; i++) im.setMatrixAt(i, MI);   // shader 不读 instanceMatrix（只为包围球不退化）
  im.instanceMatrix.needsUpdate = true;
  im.name = 'meteorShower';
  im.frustumCulled = false;                 // 顶点位置在 shader 里算，CPU 侧包围球是错的
  im.raycast = () => {};                    // 与雾团/闪电/烟花同因（别拦射线）
  im.castShadow = false; im.receiveShadow = false;
  im.userData.aoSkip = true;                // 不进 GTAO 法线 pass
  im.renderOrder = 8;
  im.count = 0;
  scene.add(im);
  /* ⚠️⚠️ 2026-10-10 真 bug（实测：切几次天气/季节之后整层**永久消失**）：
     我一开始**同时**把它挂进 `userData.aoSkip`（⇒ 进 10-post 的 `aoSkipped`）
     **和** `AUX_PASS_HIDDEN` —— 而 10-post 的隐藏/还原顺序是
     "**先**隐藏 aoSkipped、**再** `auxPrev = AUX_PASS_HIDDEN.map(o => o.visible)`"，
     于是抓到的本网格状态已经是 false ⇒ finally 里把它**写回 false** ⇒ 第一次跑 AO pass
     之后这一层就再也没露过面（门禁的现场读数 `visible:false`、inRange 7 却 0 像素）。
     ⇒ **两个名单只能进一个**：本网格在 world 里、也有 userData ⇒ 只留 `aoSkip`
     （`AUX_PASS_HIDDEN` 是给"挂相机下、不在 world 里"的镜头粒子用的）。
     ⚠️ 判据：任何对象**都别同时进这两个名单**。 */
  _mtMesh = im;
}
/* 门控（2026-10-11 改法，与烟花同一条规矩）：**只认用户那一次点击**，不再"晴夜自动下流星"。
   为什么要改：原来"晴朗的夜就自动有流星"⇒ 点「看烟花」（它会把时段设成夜、天气设成晴）也会
   顺带带出流星，和"点灯会顺带带出烟花"是同一个毛病（老黄 2026-10-11 报的）。
   现在的语义：`force === true`（用户在「流星雨」里开）= 要放；其余（false / null）都 = 不放。
   下面两条仍保留，作为**否决**（老黄要的"晴朗的夜间"）：
     夜色够深（starAmount）+ 天气只能是 晴 / 雨后初晴（排除暴雨·雷雨·雪·薄雾）。
   ⚠️ 季节仍不设门槛（老黄明确"四季都有"）—— 与"不再自动开火"是两件事，别改回去。 */
const _mtOn = () => {
  if (METEORS.force !== true) return false;        // ← 只有显式开过才放（不再"晴夜自动"）
  if ((ENV.cur.starAmount || 0) < 0.5) return false;
  const w = ENV.weather || '';
  if (w !== 'clear' && w !== 'afterrain' && w !== 'snowclear') return false;   // 雪霁也是晴空（2026-10-30）
  return ((ENV.cur.rainAmount || 0) < 0.05) && ((ENV.cur.snowAmount || 0) < 0.05);
};
export function setMeteorsForce(v){ METEORS.force = v === null ? null : !!v; }
export function meteorState(){
  const M = METEORS, list = [];
  for (let i = 0; i < MT_N; i++){
    const age = M.t - _mtStart[i];
    if (age >= 0 && age <= _mtLife[i])
      list.push({ i, age: +age.toFixed(2), life: +_mtLife[i].toFixed(2),
                  col: [+_mtCol[i*3].toFixed(2), +_mtCol[i*3+1].toFixed(2), +_mtCol[i*3+2].toFixed(2)],
                  br: +_mtBr[i].toFixed(2), wid: +_mtWid[i].toFixed(2) });
  }
  return { on: M.on, force: M.force, t: +M.t.toFixed(2), spawned: M.spawned, bursts: M.bursts,
           fireballs: M.fireballs, active: list.length, list: list.slice(0, 10),
           radiant: MT_RADIANT[ENV.season] || MT_RADIANT.summer, mesh: !!_mtMesh,
           count: _mtMesh ? _mtMesh.count : -1,
           /* 亮度上限三件套（2026-10-10 修"白屏"）：门禁按这三条守，别再靠调大它们找"壮丽"。
              peakRadiance = 单条亮痕在屏幕上的最大加法贡献（vC × a），必须 ≤ ceil（被限幅压住）。 */
           brLo: MT_BR_LO, brHi: MT_BR_HI, ceil: MT_CEIL, peakRadiance: +(MT_BR_MAX * 3.4).toFixed(3) };
}
export function tickMeteors(dt){
  const M = METEORS;
  M.on = _mtOn();
  if (!M.on){
    /* 关：清干净（别留半截光痕挂在空中），并把实例数归零 */
    if (M.spawned){ _mtStart.fill(-1e9); M.spawned = 0; M.burstLeft = 0; }
    if (_mtMesh && _mtMesh.count !== 0) _mtMesh.count = 0;
    return;
  }
  if (_mtMesh.count !== MT_N) _mtMesh.count = MT_N;
  M.t += dt;
  _mtU.uT.value = M.t;
  if (M.t >= M.next){
    let n = 1;
    if (M.burstLeft > 0){ M.burstLeft--; n = 2 + ((_mtr() * 3) | 0); }      // 阵发：一次 2~4 条
    else if (_mtr() < 0.40){ M.burstLeft = 6 + ((_mtr() * 5) | 0); M.bursts++; }   // 一次 6~10 条
    for (let k = 0; k < n; k++) mtSpawn(M.t + k * 0.02);
    M.spawned += n;
    /* ⚠️ 节奏 2026-10-10 定案（老黄要"壮丽"，出图四轮打磨）：一版 0.40~1.70s ⇒ 常驻 1~2 条、
       出图"安静夜景偶然划过一颗 ✗"；二版 0.20~0.80s ⇒ "6~7 条但密度没堆起来 ✗"；
       三版 0.12~0.55s ⇒ "辐射感对了但**仍稀** ✗"；**本版（平时 0.08~0.40s、阵发 0.04~0.12s、
       概率 40%、规模 6~10 ⇒ 常驻 5~8 条、阵发 12~15 条）**出图判读"6 条清晰、夜空干净、无过曝
       = **壮丽而干净**" ✓。
       （中途我一度以为"最密档"会让画面同帧不可复现、回退过一版 —— 那是**误判**：实测同一次任务内
       不写任何状态连渲五张逐像素全同，真正的怪现象是"**写完 mesh.count 之后的第一张会变样**"，
       属探针取样问题、与密度无关。已按"每臂多渲一张落定"修好门禁。） */
    M.next = M.t + (M.burstLeft > 0 ? mtR(0.04, 0.12) : mtR(0.08, 0.40));
  }
}
