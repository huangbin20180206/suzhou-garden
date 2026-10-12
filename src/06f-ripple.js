// 06f-ripple: 涟漪池（鱼跃/雨滴/点击共用的 64 环 InstancedMesh）（W4 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出。门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
// ⚠️ 依赖方向：06f → 06g（单向）。spawnRipple 内的惊鱼自动钩子要调 06g 的
//    KOI_BEHAVIOR.startleFromRipple 与 koiStartleAt —— 06g 不依赖 06f，故不成环。
//    （首轮 W4 曾判"必须走 HOOKS 延迟绑定"，那结论的前提是 KOI_BEHAVIOR 还在 06 里；
//     W5 把它搬进 06g 后前提已变，单向 import 即可。）
// ⚠️ rainRippleActive / lastRippleAge 是 export let **活绑定**：12-env 与 11-loop 读到的
//    必须与本模块内部自增/赋值的同一个，原样搬、一字不改。
import { THREE } from '../vendor.js';
import { TAU, CFG } from './00-config.js';
import { POND_RADII, insidePond } from './05-water.js';
import { KOI_BEHAVIOR, koiStartleAt } from './06g-koi.js';

/* 鱼跃涟漪：鱼口触水处激起的一圈圈同心涟漪。
   P1-9 并批：20 个独立 Mesh（激活几个就几个 draw call）→ 单个 InstancedMesh +
   自定义 instanceAlpha（onBeforeCompile 注入 per-instance 透明度）。
   draw call 恒为 1；未激活实例 alpha=0 视觉消失；实例矩阵编码位置与 s 缩放。 */
/* 容量 20 → 64（2026-09-25）：单 InstancedMesh，容量只吃显存里 64 个矩阵与 alpha，
   draw call 恒为 1。扩容是为了"暴雨 + 密集点击 + 鱼跃同时发生"时不丢圈 ——
   旧容量下 20 槽很快占满，新点击/鱼跃分不到槽，表现为"点了没反应"（静默失效）。
   ⚠️ 雨滴配额仍必须保留（`rainRippleActive` 上限 12）：雨是持续发生的，
     不限量就会把交互槽位吃光，正是原注释要防的那个回归。 */
const RIPPLE_N = 64;
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
/* 雨滴涟漪占用计数：与点击/鱼跃共用同一池子，雨的配额由 12-env 的 updateRainRipples
   按容量比例限（当前 64 槽 ⇒ 44）。计数在 spawn/expiry 两侧配对增减。 */
export let rainRippleActive = 0;
/** 容量对外暴露（门禁与诊断读；改容量时 12-env 的雨滴配额必须同步）。 */
export function rippleCapacity(){ return RIPPLE_N; }
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
  /* ⚠️ 落点必须在**池域内**（2026-09-24 修"涟漪画到岸上草地"）：
     雨滴涟漪原来按**外接椭圆**撒点（半轴 12.5 × 6.4、心在世界 (0,3)），而池形是**不规则多边形**
     （POND_PTS / POND_RADII）⇒ 椭圆边缘在若干方向落到岸上。老黄截图实证：狂风暴雨时
     **石驳岸下方的草皮**与**睡莲交界带**各出现一圈同心圆环（涟漪画在陆地纹理上、越过了岸线）。
     拦在**唯一入口**处（所有调用方一起受保护：雨滴 / 点击 / 鱼跃 / 泳龟），而不是逐个调用点修。
     坐标口径：`insidePond` 是**池心局部坐标**，池心在世界 z = +3
     （同 07-ground.js 的 `dz = z - 3.0`、本文件里 `z = 3 + sin(ang)*rad` 的写法）
     ⇒ 世界 (x,z) → 局部 (x, z − 3)。 */
  if (!insidePond(x, z - 3.0)) return;
  /* ⚠️⚠️ 2026-10-05 二轮修（老黄："狂风暴雨的池水涟漪会穿过池边岩石再拓展到草皮上"）：
     只挡"**中心点**在池外"**不够** —— 涟漪圈会随时间扩大，`d.maxR = (0.5 + k*0.68) * jit *
     (0.65 + 0.35*strength)`：雨滴（3 圈 / strength≈1.3）最大 ~2.4m、点击级（5 圈 / 1.6）可达 ~4.5m。
     中心在池内 0.5m 的圈，长到 2.4m 时照样越过岸线压在草皮与驳岸石上（正是他截图里那两处）。
     ⇒ 按**本圈的最大半径**给落点留余量：不够就往池心方向拉回来（**不丢弃** —— 丢弃会让近岸雨痕
     明显变稀，而雨打水面本来就是"到处都在打"）。余量 +0.15 是环带自身宽度（几何外径 1.0 的 15%）。
     ⚠️ 这里**不新增任何 Math.random 调用**（运行期效果可用全局随机，但抽数次数一变会让同帧其余
     随机量错位），只做纯几何夹紧。 */
  {
    const maxRing = (0.5 + Math.max(0, rings - 1) * 0.68) * 1.15 * (0.65 + 0.35 * strength) + 0.15;
    const lx = x, lz = z - 3.0;
    const r0 = Math.hypot(lx, lz);
    if (r0 > 1e-6){
      let a0 = Math.atan2(lz, lx); if (a0 < 0) a0 += TAU;
      const ri = Math.min(POND_RADII.length - 1, Math.floor(a0 / TAU * POND_RADII.length));
      const cap = Math.max(0.25, POND_RADII[ri] - maxRing);
      if (r0 > cap){ const k = cap / r0; x = lx * k; z = lz * k + 3.0; }
    }
  }
  lastSpawnT = t;                       // 供"反射按需更新"判断"刚刚有快速动作"（见 lastRippleAge）
  /* ── 惊鱼自动钩子（2026-09-26）──────────────────────────────────────────
     玩家点击水面会在此产生一圈 strength≈1.6 的涟漪（11-loop 传 rings=5,strength=1.6），
     而雨滴是 kind='rain'、鱼跃/龟是 strength=1。这里把"非雨且 strength>1.2"认作
     **玩家级扰动** ⇒ 附近锦鲤短暂惊散。落点已是**世界**坐标，这里转成池局部
     （z − 3）喂给 koiStartleAt。**主代理若已在点击处显式调 koiStartleAt，
     这里会多记一次同点事件**（同点同刻的两次惊扰叠加后仍在 STARTLE_MAX 上界内，
     只是把强度从 1.6 抬到约 2.4，仍受界与池域夹紧保护，不影响任何门禁）。
     若主代理想完全接管、避免双记，探针/主代理可置 `spawnRipple` 钩子开关
     `KOI_BEHAVIOR.startleFromRipple=false`（见 KOI_BEHAVIOR 注释）。 */
  if (KOI_BEHAVIOR.startleFromRipple && kind !== 'rain' && strength > 1.2)
    koiStartleAt(x, z - 3.0, t, Math.min(2.0, strength));
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
/* 供"水面反射按需更新"读的两个量（05-water 经 HOOKS 取 —— 它不能 import 本模块，会成环）：
   · `lastRippleAge`：距**最近一次起涟漪**过了多久（秒），由 updateRipples 每帧更新；
   · `ripplesActive()`：池里还有几圈活着的涟漪（诊断用）。
   ⚠️ 判断"水面是否活跃"要用 **lastRippleAge（刚发生）**，不能用 ripplesActive（还在）。
   实测：场里 11 条锦鲤轮流出水、每圈活 ~1.9s ⇒ **涟漪几乎永远存在**，用"还在"当判据会让
   反射按需更新**永远不生效**（而且涟漪环本身不在反射里 —— Reflector 渲的是镜像场景、
   水面自己的网格被排除）；真正需要满速的是"**刚刚**发生了快速动作"（鱼跃/龟/点击/雨）。 */
let lastSpawnT = -1e9;
export let lastRippleAge = 1e9;
export function ripplesActive(){
  let n = 0;
  for (const r of RIPPLE_STATE) if (r.active) n++;
  return n;
}

export function updateRipples(t){
  lastRippleAge = t - lastSpawnT;
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
