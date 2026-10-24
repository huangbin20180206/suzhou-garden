// 06i-trees: 乔木族（柳/桃/梅/兰/蕉/荷蓬/枯枝挂灯 + 变速管）（W7 拆分，2026-10-12）
// 从 src/06-vegetation.js 搬出。门面约束（方案§3.2）：原文件 import 后 export，不写 export ... from。
// ⚠️ tubeRadiusRamp 一并搬入：它是 06 导出给 15-stable.js 复用的变速管工具，本段多处调用。
// ⚠️ treeLanternInsts / budMeshes / witheredMeshes 是**可变数组原引用**，原样搬、不重建 ——
//    12-env 的 applyPresence 按 count 开/关，门禁也按名字找它们。
// ⚠️ 依赖方向全单向：06i → 06c（花瓣/莲盘/桃果几何）、06e（GLB 加载）。本模块不被它们依赖。
import { THREE, mergeGeometries } from '../vendor.js';
import { TAU, rr, CFG, rnd, mulberry32, HOOKS } from './00-config.js';
import { jr } from './06a-rng.js';
import { MAT, addWind } from './01-materials.js';
import { mesh } from './03-factory.js';
import { markUnderwater } from './05-water.js';
import { makeLotusPetalGeo, makeLilyPadGeo, makePeachFruitGeo, makeTreeLanternGeo, treeLanternColor, makePeachLeafGeo, makePeachFlowerGeo, makePlumFlowerGeo, makePlumBudGeo, makePlumWitheredGeo, makeReedBladeGeo } from './06c-organs.js';
import { corridorRaw } from './06d-corridor.js';
import { loadAssetOnce } from './06e-assets.js';
import { onAssetFailed } from './13-preload.js';

/* 柳帘飘带几何：竖条带 12 tri（1×6 段），顶边对齐挂点（y=0 向下垂），
   带微 S 弯与端部外飘 —— 叶帘不是刚性平面，风场注入后逐顶点摆动才自然 */
function makeWillowCurtainGeo(){
  const g = new THREE.PlaneGeometry(0.34, 1, 1, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++){
    const t = 0.5 - pos.getY(i);                          // 0=顶(挂点) → 1=底(梢)
    pos.setZ(i, Math.sin(t * 2.4) * 0.04 + t * t * 0.06);
  }
  g.translate(0, -0.5, 0);                                // 顶边落在挂点，缩放 y 即条长
  g.computeVertexNormals();
  return g;
}

/* 垂柳（2026-09-15 重塑）：骨架不变，"细管柳条 + 沿条单片叶"换成**垂帘叶幕** ——
   每根飘带 = alpha 叶纹贴图（细茎 + 互生窄柳叶，一张图自带生长结构）× 12 tri 条带。
   挂点不再均匀撒点：沿主枝/冠枝**下侧取簇心**，簇内高斯散布 ——
   真实垂柳的帘是"一簇簇从拱枝垂下来"，不是从伞面均匀挂线（旧版被用户判为拖把头的根源：
   条稀、叶孤、无内外体积）。instanceColor 内暗外亮，树冠才有层次。
   MAT.willow 现只登记不再挂几何（骨架全走 MAT.bark），保留给未来裸枝表现用。 */
export function makeWillow(x, z, scale = 1){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);

  const H = 5.4 * rr(0.82, 1.18);          // 每棵树高不同
  // 树干
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(rr(-0.25,0.25), H*0.34, rr(-0.25,0.25)),
    new THREE.Vector3(rr(-0.4,0.4),  H*0.66, rr(-0.35,0.35)),
    /* ⚠️ **主干顶 0.94H → 1.15H**（2026-10-01，与"冬季悬空枝"同一处修复）。
       冠肋的 y0 范围是 H×[0.85, 1.13]，**70% 的肋原本高过旧主干顶 0.94H**
       ⇒ 那些肋的根悬在树顶上方 0~1.2m 的空气里（老黄实拍："柳树顶部树枝
       有大量和主干不相连的情况，也变成悬空的状态"）。
       只把肋根夹到主干顶也能"接上"，但 22 根肋会同时挤在**同一个点**上放射 ——
       这正是第八轮验收明确否掉过的"从干顶一点放射读作灯柱/八爪鱼"。
       所以正解是把主干**往上延长**到盖住全部肋根（1.15H > 1.13H）：
       每根肋各自落在**自己那个高度**的主干上，沿主干 0.85H~1.13H 一段散开长出来；
       而肋的 1..6 号点一个字没动 ⇒ 冠形/垂梢节奏完全不变，只换了"根扎在哪"。
       ⚠️ 只改 y 系数、rr 的次数与顺序不变 ⇒ 全局随机流一位不漂（铁律 1）。 */
    new THREE.Vector3(rr(-0.3,0.3),  H*1.15, rr(-0.25,0.25)),
  ]);
  /* 端盖（2026-10-09）：柳干也是开口管（TubeGeometry closed=false）⇒ 鸟瞰同样看进管心
     读作"半圆环薄片"（老黄："估计柳树也有这个问题"—— 实锤）。在干顶补一个圆盘封口；
     干底埋进土里/有根盘遮着，不需要。
     ⚠️ 半径：**提前一次 rr 取值共用**（次数与位置不变 ⇒ 布局不漂），圆盘略缩进管壁。
     ⚠️ 朝向：CircleGeometry 默认面朝 +Z，rotateX(-π/2) 才转到 +Y（朝上、俯视可见）——
        第一版写 +π/2 转到了朝下，俯视被背面剔除 = 白加。 */
  const trunkR_w = 0.185 * rr(0.9, 1.15);   // 先取值（原 TubeGeometry 的同一笔 rr，挪到前面共用，次数位置不变 ⇒ 布局不漂）
  {
    const capTop = new THREE.CircleGeometry(trunkR_w * 0.98, 8);
    capTop.rotateX(-Math.PI / 2);                                   // 面朝 +Y（俯视可见）
    const pTop = trunkCurve.getPointAt(1);
    capTop.translate(pTop.x, pTop.y, pTop.z);
    g.add(mesh(capTop, MAT.willowBark, { name:'willowTrunkCap', cast:false }));
  }
  g.add(mesh(new THREE.TubeGeometry(trunkCurve, 18, trunkR_w, 8, false), MAT.willowBark, { name:'willowTrunk' }));
  /* ── 主干在**给定高度**的真实中心点（2026-10-01 冬季缺陷根因修复）──
     主干是一条会左右摆动的 CatmullRom 曲线（控制点横向偏 ±0.25~0.4m），而下面的
     **主枝起点原来写死在"竖直轴"上**（`rr(-0.2,0.2), y0, rr(-0.2,0.2)`）——
     两者最多差 **0.4m**，而枝半径只有 0.042m ⇒ 顶部枝的根**根本没插进主干**，
     与主干之间空着一大截。冠肋更离谱：起点在半径 `0.18*reach ≈ 0.37m` 处
     （主干半径才 0.185m），且 y0 上限 1.13H **超过了主干顶 0.94H** ⇒ 一半的肋
     **悬在树顶上方的空气里**。
     老黄 2026-10-01 实拍："柳树顶部树枝有大量和主干不相连的情况，也变成悬空的状态"。
     为什么**只有冬天报**：夏/秋叶幕把枝根盖住了，冬季 `willowLeaf: 0` 裸枝才露馅。
     这个函数按 y 找曲线上最近的采样点（无随机消耗，铁律 1 安全）。
     ⚠️ 采样要**按 y 就近**而不是按 t 反解 —— 曲线是 CatmullRom、分段不等距，
        用 t 反解会把根插到半空中。 */
  const trunkAt = (() => {
    const S = [];
    for (let i = 0; i <= 64; i++) S.push(trunkCurve.getPoint(i / 64));
    const TOP = S[S.length - 1].y;
    return (y) => {
      const yl = Math.min(Math.max(y, 0), TOP);
      let best = S[0], bd = Infinity;
      for (const p of S){ const d = Math.abs(p.y - yl); if (d < bd){ bd = d; best = p; } }
      return best;
    };
  })();
  /* ── 根盘（2026-09-23 重塑 · 老黄："桃/柳露根几乎一模一样，而且真实中没有这种
     类似花瓣一样的根系"）──
     旧版：5 块低模球**均匀绕一圈**（72° 间隔）→ 与桃树的 6 块同配方，读作"一圈蒜瓣"。
     真实垂柳最标志性的恰是**临水盘根**：沿向水一侧伸出粗壮的板根/条带根，向外蜿蜒
     爬行、半露土面后再入土，**强烈不对称**（背水侧只有零星细根）。
     ⚠️ 原版在此消耗 15 次全局 rr（5 圈 × 3）。改用本地流后必须**等量燃烧**，
        否则其后所有 rr 抽样（主枝 / 冠肋 / 叶幕）整体位移 —— §36.6。
     本地流种子由坐标决定 ⇒ 同一棵树的根盘每次构建逐位一致（§34）。 */
  const WR = mulberry32(((Math.round(x * 1000) * 73856093)
                       ^ (Math.round(z * 1000) * 19349663)
                       ^ (Math.round(scale * 1000) * 83492791)) | 0);
  const wrr = (a, b) => a + WR() * (b - a);
  for (let i = 0; i < 15; i++) void rr(0, 1);          // 等量燃烧（原 5 圈 × 3 次）
  {
    const toWater = Math.atan2(3 - z, -x);             // 池心在世界 (0,·,3)
    for (let i = 0; i < 4; i++){
      const back = (i === 3);                          // 第 4 条放背水侧 —— "不对称"要看得见
      const a   = (back ? toWater + Math.PI : toWater) + (back ? wrr(-0.35, 0.35) : wrr(-1.05, 1.05));
      /* ⚠️ 尺度与埋深（第一版实测返工）：r0 0.058~0.098 让根几乎与树干等粗、len 1.75m 拖成
         "三根扁担"，而且整根**悬在地面上** —— 真实露根是"从土里拱出来的脊"，只有背脊出土。
         收细收短 + 中心线压到土面上下（0.055 → −0.06），末端渐细没入土中。 */
      const len = back ? wrr(0.30, 0.50) : wrr(0.50, 0.95);
      const r0  = back ? wrr(0.026, 0.036) : wrr(0.038, 0.058);
      const wob = wrr(-0.55, 0.55);                    // 沿长度渐变的方位偏摆 ⇒ 蜿蜒而非直棍
      const pts = [];
      for (let k = 0; k <= 3; k++){
        const t = k / 3, aa = a + wob * t * t, rad = 0.17 + (len - 0.17) * t;
        pts.push(new THREE.Vector3(Math.cos(aa) * rad, 0.055 - 0.115 * t, Math.sin(aa) * rad));
      }
      const rc = new THREE.CatmullRomCurve3(pts);
      const rt = mesh(tubeRadiusRamp(new THREE.TubeGeometry(rc, 12, 1, 8, false), rc, 12, 8,
                                     t => r0 * (1 - 0.62 * t)), MAT.willowBark, { name:'willowRoot', cast:true });
      rt.scale.set(1, 0.66, 1);                        // 压扁＝板根；同时把中心线进一步压向土面（只露背脊）
      g.add(rt);
    }
  }

  /* 拱形主枝：**低位多级分叉**（验收一轮发现从干顶一点放射读作"灯柱/八爪鱼"）——
     3~4 根自干中低位（0.42~0.62H）斜出的大枝 + 4~6 根高位枝（0.72~0.92H）。
     真实垂柳正是低位分叉、宽大于高的拱冠。半径 0.042 支撑叶幕视觉重量。 */
  const brCurves = [];
  const nBranch = 7 + ((rnd()*4)|0);       // 7~10 根
  for (let i = 0; i < nBranch; i++){
    const a = (i/nBranch)*TAU + rr(-0.35,0.35);
    const reach = i < 4 ? rr(1.9, 3.0) : rr(1.2, 2.4);   // 低位枝更长更外张
    const y0 = H * (i < 4 ? rr(0.42, 0.62) : rr(0.72, 0.92));
    const tipY = H * rr(0.50, 0.70);
    const brCurve = new THREE.CatmullRomCurve3([
      /* ⚠️ **起点必须落在主干的真实轴上**（2026-10-01 冬季缺陷）：
         原来是 `rr(-0.2,0.2), y0, rr(-0.2,0.2)` —— 写死在**竖直轴**上，
         而主干是左右摆动的曲线（横向偏 ±0.25~0.4m）⇒ 顶部枝的根悬在主干旁边
         （老黄："柳树顶部树枝有大量和主干不相连的情况"）。
         现在取 trunkAt(y0)（主干在 y0 高度的真实中心），再叠 **±0.06m** 的抖动
         （原是 ±0.2m，太大了会自己甩出主干外）。⚠️ rr 的**次数与顺序必须不变** ——
         仍在这里抽 2 次，只是范围改小（铁律 1 只看次数与顺序，不看参数值）。 */
      (() => {
        const tb = trunkAt(y0);
        return new THREE.Vector3(tb.x + rr(-0.06,0.06), tb.y, tb.z + rr(-0.06,0.06));
      })(),
      new THREE.Vector3(Math.cos(a)*reach*0.45, y0 + H*rr(0.10, 0.22), Math.sin(a)*reach*0.45),
      new THREE.Vector3(Math.cos(a)*reach*0.8, tipY + H*rr(0.04, 0.10), Math.sin(a)*reach*0.8),
      new THREE.Vector3(Math.cos(a)*reach, tipY, Math.sin(a)*reach),
    ]);
    brCurves.push(brCurve);
    g.add(mesh(new THREE.TubeGeometry(brCurve, 12, 0.042 * rr(0.85, 1.15), 6, false), MAT.willowBark, { name:'willowBranch' }));
  }

  // 冠层肋枝（第八轮验收指令③：破半球加强）—— 第七轮 ±15%/±10° 在 4m 观察距离下
  // 起伏不可辨（验收实测）。第八轮：肋长独立 ×0.8~1.25、终端方位 ±20°、
  // 肋根俯角用 droop 指数 1.2~1.9 区分"早垂/晚垂"—— 圆度偏差必须肉眼可辨。
  const crownRibs = [];
  const nRib = 30;
  for (let i = 0; i < nRib; i++){
    const a = (i / nRib) * TAU + rr(-0.24, 0.24);
    const reach = 2.05 * rr(0.80, 1.12);                // 肋长截短（第十轮：端部超出叶缘 ≤0.05R）
    const droop = rr(0.30, 0.62);                       // 最低 0.30H：裸梢收回叶幕内（第九轮俯视"带刺半球"）
    const droopPow = rr(1.1, 1.7);                      // 肋根俯角：指数小=早垂，大=晚垂
    const y0 = H * rr(0.85, 1.13);                      // 拱顶高度 ±15%
    const tipBend = rr(-0.35, 0.35);                    // 终端方位 ±20°
    const wob = rr(-0.18, 0.18);                         // 中段径向摆动
    const pts = [];
    for (let k = 0; k <= 6; k++){
      const t = k / 6;
      const r = reach * (0.18 + 0.82 * Math.sin(t * Math.PI * 0.5)) * (1 + wob * t);
      const y = y0 - H * droop * Math.pow(t, droopPow);
      const aa = a + tipBend * t * t;
      /* ⚠️ **第 0 点原先落在半径 0.18*reach ≈ 0.37m 处，而主干半径只有 0.185m**
         —— 根本没碰到主干，30 根肋有近一半 y0 还超过主干顶 0.94H ⇒ 全部悬空
         （老黄："柳树顶部树枝有大量和主干不相连的情况，也变成悬空的状态"）。
         第 0 点改成**主干在该高度的真实中心点** ⇒ 肋从主干里长出来；
         y0 超过主干顶时 trunkAt 会夹到 0.94H ⇒ 肋从**树顶**长出来，不会悬在树上方。
         ⚠️ 只改第 0 点，1..6 点原样保留 ⇒ 冠形（那几轮调出来的垂梢节奏）不变。 */
      const p0 = k === 0 ? (() => { const c = trunkAt(y0); return new THREE.Vector3(c.x, c.y, c.z); })()
                         : new THREE.Vector3(Math.cos(aa) * r, y, Math.sin(aa) * r);
      pts.push(p0);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    crownRibs.push(curve);
    g.add(mesh(new THREE.TubeGeometry(curve, 12, 0.019, 5, false), MAT.willowBark, { name:'willowCrownRib', cast:false }));
  }

    // ── 叶幕五件套：短枝雾 + 冠顶沿弧封盖 + 长垂帘簇 + 网格补洞 + 散兵帘 ──
    /* 第三轮取证量化：覆盖 50%、冠顶 1/3 仍 <20% 且"伞骨无伞面"、右半冠 20-30% 稀疏。
       第四轮按验收优先级：①冠顶沿**弧线全长**挂长帘（挂点骑在弧上、垂长 ≥ 冠高/3，
       把骨架盖进叶幕——上轮裙帘挂在弧心下方被骨架自身挡住，投影不可见）
       ②0.45m 网格扫冠包络补空格（消"左密右疏"方向性破洞）③内外色差拉到 ~30% 明度差。 */
    const curtains = [];
    const gauss = () => (jr() + jr() + jr()) / 1.5 - 1;   // 中央聚集
    /* 帘长全局参差 ×0.85~1.15（叠加轮廓 ±40% —— 第八轮验收指令⑤：消除"梳齿的整齐感"） */
    const addCurtain = (x, y, z, len, w) => {
      const edge = Math.min(1, Math.hypot(x, z) / 2.6);
      const L = len * (edge > 0.72 ? rr(0.62, 1.42) : 1) * rr(0.85, 1.15);
      curtains.push({ x, y, z, len: Math.min(L, Math.max(0.35, y - 0.30)), w, rot: jr() * TAU });
    };
    /* 全向叶簇基建（第八轮验收指令①的换法核心）：帘几何只会"往下挂"，挂帘盖不住
       挂点上方的弧背 —— 连续七轮的教训。tuft 记一个全向单位向量，实例化时把帘的
       -Y 轴映射到该方向：同一个 12 tri 几何既当垂帘、又当"长在枝上朝哪都有的叶簇"。 */
    const randDir = () => {
      const u = jr() * 2 - 1, a2 = jr() * TAU;
      const s2 = Math.sqrt(Math.max(0, 1 - u * u));
      return { x: s2 * Math.cos(a2), y: u, z: s2 * Math.sin(a2) };
    };
    const addTuft = (x, y, z, len, w, d) => {
      curtains.push({ x, y, z, len: Math.min(len, Math.max(0.30, y - 0.30)), w, dir: d, rot: jr() * TAU });
    };
    const addCluster = (cx, cy, cz, n, spread, lenMin, lenMax) => {
      for (let i = 0; i < n; i++){
        addCurtain(cx + gauss()*spread, cy + gauss()*spread*0.4, cz + gauss()*spread,
                   (lenMin + jr()*(lenMax-lenMin)) * rr(0.72, 1.32),   // 强方差：下摆参差
                   rr(1.0, 1.7));                                               // 宽帘：覆盖主力
      }
    };
    /* ① 短枝雾：主枝/冠枝全长密铺（第十一轮：锚点偏上——枝背优先，俯视盖枝线） */
    for (const br of brCurves){
      const nT = 26 + ((rnd()*14)|0);
      for (let k = 0; k < nT; k++){
        const pt = br.getPoint(0.10 + 0.90 * ((k + rnd()) / nT));
        addCurtain(pt.x + rr(-0.15,0.15), pt.y + rr(-0.06, 0.14), pt.z + rr(-0.15,0.15),
                   rr(0.25, 1.1) * rr(0.8, 1.25), rr(0.7, 1.1));
      }
    }
    /* ② 冠顶封盖：沿冠肋**弧线全长**挂长帘 —— 挂点骑在弧上（y 加 0~0.09 微抬），
       垂长 ≥ 冠高/3，骨架从此被叶幕从上往下盖住 */
    for (const rib of crownRibs){
      const nCover = Math.max(6, Math.round(rib.getLength() / 0.33));
      for (let k = 0; k < nCover; k++){
        const t = Math.min(0.97, Math.max(0.06, 0.10 + 0.80 * (k / (nCover - 1)) + rr(-0.02, 0.02)));
        const pt = rib.getPoint(t);
        addCurtain(pt.x + rr(-0.10,0.10), pt.y + rr(0.0, 0.09), pt.z + rr(-0.10,0.10),
                   Math.max(1.8, H / 2) * rr(0.75, 1.15), rr(0.9, 1.4));   // ×1.5：盖"赤道环带"（指令⑤）
      }
      /* 肋缘加厚（指令②）：冠肋外端一圈**全向外向**叶簇 —— "露箍"是轮廓弧线直接朝天，
         外向 tuft 挂在肋尖外侧 +0.04~0.30m，把箍包进肉里 */
      const tip = rib.getPoint(0.96);
      const tipR = Math.hypot(tip.x, tip.z);
      if (tipR > 1.5){
        for (let j = 0; j < 5; j++){
          const aa = Math.atan2(tip.z, tip.x) + rr(-0.4, 0.4);
          const outR = tipR + rr(0.04, 0.30);
          const d = randDir();
          addTuft(Math.cos(aa) * outR, tip.y + rr(0.0, 0.15), Math.sin(aa) * outR,
                  rr(0.5, 1.1), rr(1.0, 1.5),
                  { x: d.x * 0.5 + Math.cos(aa) * 0.75, y: d.y, z: d.z * 0.5 + Math.sin(aa) * 0.75 });
        }
      }
    }
    /* ②b 肋上长毛（第八轮验收指令①：换掉连续七轮"从肋上挂帘"的结构性错路）——
       沿冠肋/主枝每 ~0.18m 绑一撮**全向**叶簇（2~4 枚、随机方向含朝上），
       肋线自身连续遮挡拉满：从侧、从顶、从下看，弧都包在"肉"里。 */
    for (const rib of crownRibs){
      const nF = Math.max(12, Math.round(rib.getLength() / 0.18));
      for (let k = 0; k <= nF; k++){
        const pt = rib.getPoint(0.03 + 0.94 * (k / nF));
        const nPer = 2 + ((rnd()*3)|0);
        for (let j = 0; j < nPer; j++){
          /* 第十一轮：锚点上移枝背（+0.02~0.16）—— 第十轮自动验收定位病灶
             "叶挂得偏低、枝条上表面俯视裸露"：叶卡盖住枝顶投影，棕线直接消失。 */
          addTuft(pt.x + rr(-0.05, 0.05), pt.y + rr(0.02, 0.16), pt.z + rr(-0.05, 0.05),
                  rr(0.40, 1.0), rr(0.8, 1.2), randDir());
        }
      }
    }
    for (const br of brCurves){
      const nF = Math.max(12, Math.round(br.getLength() / 0.24));
      for (let k = 0; k <= nF; k++){
        const pt = br.getPoint(0.05 + 0.92 * (k / nF));
        const nPer = 2 + ((rnd()*2)|0);
        for (let j = 0; j < nPer; j++){
          addTuft(pt.x + rr(-0.06, 0.06), pt.y + rr(0.02, 0.14), pt.z + rr(-0.06, 0.06),
                  rr(0.45, 1.0), rr(0.8, 1.25), randDir());
        }
      }
    }
    /* ②c 顶冠叶球（指令⑤：短帘长度×1.5 向下衔接，"辐条+串珠"变封闭壳层）——
       干顶汇交区糊一团高密度帘，放射线的汇聚点消失在叶团里 */
    for (let i = 0; i < 140; i++){
      const a = jr() * TAU;
      const rad = Math.sqrt(jr()) * 1.0;
      addCurtain(Math.cos(a) * rad, H * (0.86 + jr() * 0.22), Math.sin(a) * rad,
                 rr(0.45, 1.35), rr(0.9, 1.5));
    }
    /* ②d 顶幕横毯 —— 2800 枚是"撒盐必连毯"的过补版本（第十二轮性能回归：
       2800→1600 枚，够封闭冠顶、省 1.2 万 tri/树 + 对应片元过绘制）。
       第十七轮（冠顶俯视闭合度）：① rad 上限 2.30→2.58 外延到冠缘（R=2.9 减余量，
       原来 2.6~3.1 最外圈无覆盖、方向性破洞随机落点 → 单树外环 49%~99% 方差巨大）
       ② dir.y ±0.28→+0.18~0.78 偏上仰躺：俯视投影是"面"不是"侧立窄条"，
       从顶上把冠缘盖死（实测单树外环极差 20.5pt → 收敛）。 */
    for (let i = 0; i < 1600; i++){
      const a = jr() * TAU, a2 = jr() * TAU;
      const rad = 0.30 + Math.sqrt(jr()) * 2.58;
      const yDome = (1.04 - (rad / 2.5) * 0.42) * H;
      addTuft(Math.cos(a)*rad + rr(-0.12,0.12), yDome * rr(0.93, 1.02), Math.sin(a)*rad + rr(-0.12,0.12),
              rr(0.40, 1.05), rr(1.0, 1.6),
              { x: Math.cos(a2), y: rr(0.18, 0.78), z: Math.sin(a2) });
    }
    /* ②d+ 外缘肋段强制带叶（第十轮指令②）：0.85R 以外的肋端不再靠天，
       每根肋尖 4 枚横向大 tuft 骑上枝背（第十一轮上移 +0.03~0.14）。
       第十七轮：dir.y ±0.3→+0.05~0.70 偏上仰躺，肋尖在俯视下是覆盖面而非侧立窄条。 */
    for (const rib of crownRibs){
      for (let j = 0; j < 4; j++){
        const t = 0.85 + j * 0.05 + rr(-0.02, 0.02);
        const pt = rib.getPoint(Math.min(1, t));
        const a2 = jr() * TAU;
        addTuft(pt.x + rr(-0.08, 0.08), pt.y + rr(0.03, 0.14), pt.z + rr(-0.08, 0.08),
                rr(0.5, 1.0), rr(1.1, 1.6), { x: Math.cos(a2), y: rr(0.05, 0.70), z: Math.sin(a2) });
      }
    }
    /* ②e 象限均密（第十轮指令③：反馈式闭环）—— 补到达标即停，不赌固定量：
       最多 5 轮，每轮对上层冠 8 扇区计数，低于均值 70% 的扇区补 80 枚横向 tuft。
       第十七轮：rad 上限 2.2→2.55 外延 + dir.y +0.12~0.70 偏上（俯视覆盖面）。 */
    for (let pass = 0; pass < 5; pass++){
      const counts = new Array(8).fill(0);
      for (const s of curtains){
        if (s.y < H * 0.60) continue;
        const sec = Math.floor(((Math.atan2(s.z, s.x) + TAU) % TAU) / (TAU / 8));
        counts[sec]++;
      }
      const mean = counts.reduce((x, b) => x + b, 0) / 8;
      const deficient = [];
      for (let sec = 0; sec < 8; sec++) if (counts[sec] < mean * 0.7) deficient.push(sec);
      if (!deficient.length) break;
      for (const sec of deficient){
        const az0 = sec * (TAU / 8);
        for (let i = 0; i < 80; i++){
          const az = az0 + jr() * (TAU / 8);
          const rad = 0.4 + Math.sqrt(jr()) * 2.55;
          const yDome = (1.00 - (rad / 2.5) * 0.40) * H;
          const a2 = jr() * TAU;
          addTuft(Math.cos(az)*rad, yDome * rr(0.90, 1.0), Math.sin(az)*rad,
                  rr(0.40, 0.95), rr(0.95, 1.45), { x: Math.cos(a2), y: rr(0.12, 0.70), z: Math.sin(a2) });
        }
      }
    }
    /* ②f 外环确定性补种（第十七轮：②d/②e 的随机簇单树上仍有方向性大洞 ——
       均匀半径分布 = 外圈面积大密度低，聚类随机 → 树1/树3 外环曾 59~78%、极差 ~28。
       按方位×半径确定性布点：28 方位 × 3 半径 × 每点 2 枚偏上 tuft + 微抖动，
       外环 2.3~3.0m 带宽被确定性铺满（细分实测 [2.85-3.1] 段原覆盖率 17~42%，
       是唯一系统性空区 —— 原 ②f 只到 2.8）；dir.y 偏上 0.3~0.8 俯视覆盖面。 */
    for (let ai = 0; ai < 28; ai++){
      const az = (ai / 28) * TAU + rr(-0.04, 0.04);
      for (const r0 of [2.35, 2.72, 2.95]){
        const rad = r0 + rr(-0.06, 0.06);
        const yDome = (1.04 - (rad / 2.5) * 0.42) * H;
        for (let j = 0; j < 2; j++){
          const a2 = jr() * TAU;
          addTuft(Math.cos(az) * rad, yDome * rr(0.93, 1.0), Math.sin(az) * rad,
                  rr(0.55, 1.0), rr(1.2, 1.7), { x: Math.cos(a2), y: rr(0.30, 0.80), z: Math.sin(a2) });
        }
      }
    }
    /* ③ 长垂帘：簇心高斯散布，外缘拂水内里分层 */
    for (const br of brCurves){
      const nC = 3 + ((rnd()*2)|0);                        // 每枝 3~4 个簇心
      for (let c = 0; c < nC; c++){
        const t = 0.35 + 0.65 * ((c + rnd()) / nC);
        const pt = br.getPoint(t);
        const outer = Math.min(1, Math.hypot(pt.x, pt.z) / 3.0);
        addCluster(pt.x, pt.y - 0.05, pt.z, 18 + ((rnd()*14)|0), 0.36,
                   0.9 + outer * 0.5, 1.8 + outer * 2.6);
      }
    }
    for (const rib of crownRibs){
      const pt = rib.getPoint(0.80 + rr(0, 0.15));
      const outer = Math.min(1, Math.hypot(pt.x, pt.z) / 3.0);
      addCluster(pt.x, pt.y, pt.z, 12 + ((rnd()*8)|0), 0.30,
                 1.1 + outer * 0.5, 2.2 + outer * 2.2);
    }
    /* ③b 帘间次帘（第八轮验收指令④：倍增至 ~200、锚点**强制落在主帘间隙中点**）——
       随机抽两根相距 0.3~0.8m 的主帘，在二者中点插半长次帘（45~70%）。
       "任意 0.5×0.5m 投影格内帘数 ≥3"由 ⑦ 审计输出实测值。 */
    {
      const longs = curtains.filter(s => s.len > 1.2 && !s.dir);
      let planted = 0;
      for (let tries = 0; tries < 4000 && planted < 200 && longs.length > 1; tries++){
        const s1 = longs[(jr() * longs.length) | 0];
        const s2 = longs[(jr() * longs.length) | 0];
        const dist = Math.hypot(s1.x - s2.x, s1.y - s2.y, s1.z - s2.z);
        if (dist < 0.3 || dist > 0.8) continue;
        addCurtain((s1.x + s2.x) / 2 + rr(-0.06, 0.06), (s1.y + s2.y) / 2 + rr(-0.08, 0.08),
                   (s1.z + s2.z) / 2 + rr(-0.06, 0.06),
                   (s1.len + s2.len) * 0.5 * rr(0.45, 0.70), rr(0.9, 1.5));
        planted++;
      }
    }
    /* ④ 网格补洞：0.45m 格扫冠包络（心高缘低的椭冠），空格按半径升概率补短帘 ——
       "左密右疏"是随机过程的方向性破洞，占位补洞是确定性兜底 */
    {
      const cell = 0.45, R = 2.9, occ = new Set();
      for (const s of curtains) occ.add(Math.round(s.x/cell)+'|'+Math.round(s.y/cell)+'|'+Math.round(s.z/cell));
      const nC = Math.ceil(R / cell);
      for (let xi = -nC; xi <= nC; xi++){
        for (let zi = -nC; zi <= nC; zi++){
          const rad = Math.hypot(xi*cell, zi*cell);
          if (rad > R || rad < 0.35) continue;
          const yTop = H * (1.00 - (rad / R) * 0.40);
          const yBot = Math.max(0.5, H * (0.52 - (rad / R) * 0.12));
          for (let yi = Math.ceil(yBot/cell); yi <= Math.floor(yTop/cell); yi++){
            const key = xi+'|'+yi+'|'+zi;
            if (occ.has(key)) continue;
            occ.add(key);
            if (jr() < 0.62 + 0.33 * (rad / R)){
              addCurtain(xi*cell + rr(-0.12,0.12), yi*cell, zi*cell + rr(-0.12,0.12),
                         rr(0.5, 1.5) * rr(0.8, 1.25), rr(0.9, 1.5));
            }
          }
        }
      }
    }
    /* ⑤ 碎叶云（验收"只动一刀就动这刀"）：梳齿感的根源是"线密隙宽"——
       长帘之间是干净的天空缝。用超短宽碎帘（0.25~0.65m、w 1.2~1.8）纯随机撒进
       冠包络：不打格子、不挂枝，就是空间里的叶团噪声。同时救三件事：
       覆盖观感（缝被填）、破洞观感（拳级洞被糊）、顶部骨架遮挡（顶心区密度加倍）。 */
    {   // 碎叶云（第十二轮性能回归：950~1300 → 420~620，够糊缝，省 7k tri/树）
      const R = 2.9, nChip = 420 + ((rnd()*200)|0);
      for (let i = 0; i < nChip; i++){
        const a = jr() * TAU;
        const rad = Math.sqrt(jr()) * R;
        const yTop = H * (1.00 - (rad / R) * 0.40) + (rad < R * 0.55 ? H * 0.10 : 0);   // 顶心区穹面抬高
        const yBot = Math.max(0.55, H * (0.50 - (rad / R) * 0.12));
        addCurtain(Math.cos(a)*rad + rr(-0.1,0.1), yBot + jr()*(yTop - yBot), Math.sin(a)*rad + rr(-0.1,0.1),
                   rr(0.25, 0.65), rr(1.2, 1.8));
      }
    }
    /* ⑤b 定点补洞（指令③：交叉射线复验）—— 单侧射线会漏"侧面看才透"的洞：
       每个方位再从 ±30° 各打一遍；补栽簇径下限提到 0.6m 量级（spread 0.45+）。 */
    {
      const cellH = 0.35, occ = new Set();
      const k3 = (x, y, z) => Math.round(x/cellH) + '|' + Math.round(y/cellH) + '|' + Math.round(z/cellH);
      for (const s of curtains) occ.add(k3(s.x, s.y, s.z));
      const near = (x, y, z) => {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
          if (occ.has(k3(x + dx*cellH, y + dy*cellH, z + dz*cellH))) return true;
        return false;
      };
      for (let ai = 0; ai < 10; ai++){
        for (const off of [0, -0.52, 0.52]){              // ±30° 交叉
          const az = (ai / 10) * TAU + off + rr(-0.06, 0.06);
          const ca = Math.cos(az), sa = Math.sin(az);
          for (const hF of [0.40, 0.60, 0.80]){
            const y = H * hF;
            let streak = 0, sx0 = 0, sz0 = 0;
            for (let r = 3.2; r > 0.3; r -= 0.25){
              const x = ca * r, z = sa * r;
              if (near(x, y, z)){ streak = 0; continue; }
              if (streak === 0){ sx0 = x; sz0 = z; }
              streak++;
              if (streak * 0.25 >= 0.80){
                const mx = (sx0 + x) / 2, mz = (sz0 + z) / 2;
                addCluster(mx, y, mz, 3 + ((rnd()*3)|0), 0.45, 0.7, 1.9);
                for (let q = 0; q < 4; q++) occ.add(k3(mx + rr(-0.25,0.25), y, mz + rr(-0.25,0.25)));
                streak = 0;
              }
            }
          }
        }
      }
    }
    // ⑥ 散兵帘：~18% 散在簇外
    const scatterN = Math.round(curtains.length * 0.18);
    for (let i = 0; i < scatterN; i++){
      const br = brCurves[(rnd()*brCurves.length)|0];
      const pt = br.getPoint(rr(0.25, 1.0));
      addCurtain(pt.x + rr(-0.55,0.55), pt.y + rr(-0.3,0.1), pt.z + rr(-0.55,0.55),
                 rr(0.5, 3.8) * rr(0.7, 1.3), rr(0.8, 1.4));
    }

    /* ⑦ 顶帘审计（第八轮验收指令②：先证存在再谈参数）——
       顶区帘数/长度实测 + 0.5m 投影格统计（俯视 XZ / 侧视 XY），挂在组上供探针取证。 */
    {
      const tops = curtains.filter(s => s.y > H * 0.82);
      let minL = 1e9, sumL = 0;
      for (const s of tops){ if (s.len < minL) minL = s.len; sumL += s.len; }
      const projStat = (fx, fy) => {
        const map = new Map();
        for (const s of curtains){
          const key = (Math.round(s[fx] * 2) * 0.5) + '|' + (Math.round(s[fy] * 2) * 0.5);
          map.set(key, (map.get(key) || 0) + 1);
        }
        let cells = 0, ok = 0;
        for (const v of map.values()){ cells++; if (v >= 3) ok++; }
        return { cells, ge3pct: +(100 * ok / Math.max(1, cells)).toFixed(1) };
      };
      g.userData.willowAudit = {
        total: curtains.length,
        tufts: curtains.filter(s => s.dir).length,
        top: { n: tops.length, minLen: +minL.toFixed(2), meanLen: +(sumL / Math.max(1, tops.length)).toFixed(2) },
        projTop: projStat('x', 'z'),      // 俯视（XZ 平面）0.5m 格
        projSide: projStat('x', 'y'),    // 侧视（XY 平面）0.5m 格
      };
    }

    // 垂帘实例化 + instanceColor：内暗外亮拉到 ~30% 明度差（k 曲线加幂，外缘更亮）
    /* 洗牌（第十二轮关键修复）：季节通道按 count 缩减只会保留实例数组**前缀**——
     构建顺序是"内部枝雾在前、外层垂帘在后"，不洗牌的话春/冬先丢光外层垂帘，
     留下的全是内部密雾层，"稀疏"永远读不出来（第十二轮春柳"密实暗块"的根因）。
     洗匀后按比例缩减 = 全冠均匀变稀 ✓ */
  for (let i = curtains.length - 1; i > 0; i--){
    const j = (jr() * (i + 1)) | 0;
    const t = curtains[i]; curtains[i] = curtains[j]; curtains[j] = t;
  }
  const curtainGeo = makeWillowCurtainGeo();
    const cInst = new THREE.InstancedMesh(curtainGeo, MAT.willowLeaf, curtains.length);
    cInst.castShadow = false;
    cInst.userData.seasonWillowLeaf = true;   // 季节通道收"叶"：冬季整幅叶幕收尽，裸枝过冬
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
    const col = new THREE.Color(), inner = new THREE.Color(0x7a9a50), outer = new THREE.Color(0xe2efa0);
    const _down = new THREE.Vector3(0, -1, 0), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _qr = new THREE.Quaternion();
    curtains.forEach((s, i)=>{
      p.set(s.x, s.y, s.z);
      if (s.dir){
        /* tuft：把帘的 -Y（垂挂轴）映射到全向 d，再绕自身长轴滚转 s.rot ——
           同一几何"朝哪长"的都有，肋线从任意视角都被叶包住 */
        _d.set(s.dir.x, s.dir.y, s.dir.z).normalize();
        q.setFromUnitVectors(_down, _d);
        q.multiply(_qr.setFromAxisAngle(_up, s.rot));
      } else {
        q.setFromEuler(new THREE.Euler(rr(-0.08,0.08), s.rot, rr(-0.08,0.08)));
      }
      sv.set(s.w, s.len, s.w);
      m.compose(p, q, sv); cInst.setMatrixAt(i, m);
      const k = Math.pow(Math.min(1, Math.hypot(s.x, s.z) / 3.0), 1.25);
      col.copy(inner).lerp(outer, k).offsetHSL(rr(-0.03, 0.03), rr(-0.03, 0.05), rr(-0.06, 0.06));
      cInst.setColorAt(i, col);
    });
    cInst.instanceMatrix.needsUpdate = true;
    if (cInst.instanceColor) cInst.instanceColor.needsUpdate = true;
    g.add(cInst);

    return g;
  }

/* ── 桃花（重建 · 2026-09-22 二轮）────────────────
   桃是落叶观花小乔木，四季生命周期由 12-env 的季节显隐通道驱动：
     peachShow          → 叶冠（MAT.peachLeaf，走 tinLeaf：春夏绿 → 秋黄 → 冬落尽裸枝）
     peachBlossomShow   → 花   （MAT.peachBlossom，春开，先花后叶）
     peachFruitShow     → 果   （MAT.peachFruit，夏秋带红晕的蜜桃）
     peachPetalShow     → 落花铺地（MAT.peachPetal，春末夏初树干四周散一层粉瓣）
   ⚠️ 二轮重建的**根因**（老黄实拍判语："光秃秃的直棍插在石头上"）：

   ① 主干塌成刀片 —— 手工锥化用 `curve.getPoint(t)` 取圈心，而 TubeGeometry 生成顶点
      用的是 `path.getPointAt(i/n)`（**弧长**参数化）。两者同名不同实：同一个 t 落在
      不同位置（该曲线上位差 >0.17m，比半径 0.16 还大）—— 于是 `dir = normalize(v-center)`
      里混进一个**轴向**分量，而 `v.copy(center)` 把这一圈的 x/z 直接拍回轴上：
      上半段整圈塌成一点。世界包围盒实测 [0.06, 2.92, 0.15]（另一株更极端
      [0.14, 3.26, 0.03]），正常应为 ~0.33×0.33 的圆管 —— 一根压扁的刀片。
      修法：tubeRadiusRamp() 按**圈号**取 t、用 getPointAt 取圈心，径向缩放才真的只缩径向。
   ② 叶片 600 上限**从未达到**（三株实测 379 / 330 / 258）：挂点是"每枝随机 5~8 小枝 ×
      每枝 6~10 片"，叶子挂完就走 —— `count` 声明 600 是个从未兑现的承诺，冠层只剩骨架。
   ③ 叶量按"每枝若干片"给是错的：应当由**冠层尺度**决定（枝条有多长就有多少挂点）。
   ④ 几何本身就贵，贵到开不起花：旧叶 38 tri/片（ShapeGeometry 四条贝塞尔 ×10 细分）、
      旧花 ≈160 tri/朵（5 片 ShapeGeometry 花瓣）—— 这个预算下"花满树"根本不可能。

   现在：叶片换 makeLeafVolumeGeo 的**单面弯叶**（12 tri/片）；花换成**花瓣贴图卡**
        （5 张 quad = 12 tri/朵 —— 泪滴形与粉白渐变本来就画在贴图里，几何再刻一遍纯属浪费）；
        挂点按弧长间隔沿**全部枝条**取样，叶量由冠层决定；主枝/小枝各自并成一个 mesh
        （旧版 30+ 根小枝各一个 mesh = 30+ draw call）。 */

/* 变速管：把 TubeGeometry 的每一圈缩放到目标半径。
   ⚠️ **必须**用 `path.getPointAt(i / tubularSegments)` 取圈心 —— 这正是 TubeGeometry
   生成顶点时用的函数；改用 getPoint() 会让圈心偏离真正的中轴，径向缩放变成"把整圈拍回轴上"。
   ⚠️ 传入的 geo 必须是以 radius=1 建的：这样 (v − center) 才是单位向量，缩放系数就是真半径。
   TubeGeometry 的顶点序 = 圈号 × (radialSegments + 1) + 圈内序号（见其 generateSegment）。 */
function tubeRadiusRamp(geo, path, tubularSegments, radialSegments, radiusAt, opts){
  const pos = geo.attributes.position;
  const per = radialSegments + 1;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= tubularSegments; i++){
    const t = i / tubularSegments;
    const r = radiusAt(t);
    path.getPointAt(t, c);
    for (let j = 0; j < per; j++){
      const idx = i * per + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  /* ⚠️ 端盖（2026-10-09 · 老黄鸟瞰截图："主干变成了一个半圆环的薄片"）：
     TubeGeometry 不封口（closed=false ⇒ 两端是开口圆环）+ 材质 FrontSide ⇒
     从正上方俯视主干时——① 看进管子内部（空心）；② 远侧半圈管壁法线朝下背离相机
     被背面剔除；③ 只剩近侧半圈 ⇒ 正是截图里的"C 形半圆环薄片"。
     柳树干（makeWillow 的 TubeGeometry）同病。加端盖 = 在 t=0 / t=1 两端各补一个
     圆盘（三向扇形），从任何方向看都是实心截面。
     opts.caps: undefined = 不加端盖（叶/细枝等不需要，多端盖费三角形）；
                'both' = 两端都加；'top' = 只加 t=1 端（主干底端埋土里不需要）。 */
  if (opts && opts.caps){
    const capAt = (t, flip) => {
      const r = radiusAt(t);
      path.getPointAt(t, c);
      const tan = path.getTangentAt(t).normalize();
      // 求端盖圆盘的局部基（法线 = 切线方向）
      const ref = Math.abs(tan.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const nrm = new THREE.Vector3().crossVectors(tan, ref).normalize();
      const binm = new THREE.Vector3().crossVectors(tan, nrm).normalize();
      const segs = Math.max(8, radialSegments);
      const verts = [c.clone()];
      for (let k = 0; k <= segs; k++){
        const a = (k / segs) * TAU;
        verts.push(new THREE.Vector3().copy(c)
          .addScaledVector(nrm, Math.cos(a) * r)
          .addScaledVector(binm, Math.sin(a) * r));
      }
      const positions = [], normals = [], uvs = [], indices = [];
      for (const p of verts){ positions.push(p.x, p.y, p.z); normals.push(tan.x, tan.y, tan.z); }
      for (let k = 0; k < verts.length; k++) uvs.push(0, 0);   // ⚠️ 补 uv：TubeGeometry 有 uv，缺了 mergeGeometries 会失败
      for (let k = 1; k <= segs; k++){
        if (flip) indices.push(0, k + 1, k);
        else indices.push(0, k, k + 1);
      }
      const capGeo = new THREE.BufferGeometry();
      capGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      capGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      capGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      capGeo.setIndex(indices);
      return capGeo;
    };
    const caps = [];
    /* ⚠️ 绕向（2026-10-09 实算，第一版就是这里反了）：本基（nrm,binm）下环角 a 增大
       从上方看是**逆时针** ⇒ 三角 (0,k,k+1) 从上看 CCW=正面（顶盖要用这个）、
       (0,k+1,k) 从上看 CW=背面（底盖用这个、从下方看才是正面）。 */
    if (opts.caps === 'both' || opts.caps === 'bottom') caps.push(capAt(0, true));
    if (opts.caps === 'both' || opts.caps === 'top') caps.push(capAt(1, false));
    if (caps.length) {
      const merged = mergeGeometries([geo, ...caps], false);
      /* ⚠️ mergeGeometries 返回的 BufferGeometry 没有 .parameters —— 而 peach-form-guard
         的 trunkOf 按 `geometry.parameters.tubularSegments/path` 逐圈量主干半径。
         手动把原 TubeGeometry 的 parameters 挂回去（只影响探针读数，不影响渲染）。 */
      merged.parameters = geo.parameters;
      return merged;
    }
  }
  geo.computeVertexNormals();
  return geo;
}
/* 变速管（2026-10-09 导出给 15-stable.js 复用）：把 TubeGeometry 的每圈缩放到目标半径 ——
   马/牛的躯干、脖颈、腿都是"沿曲线变径的管"，正是它做的事。
   ⚠️ 它有一个**必须沿用**的实现细节：圈心用 `path.getPointAt(i/n)`（弧长参数化，
      与 TubeGeometry 生成顶点时同一个函数），改用 getPoint() 会让圈心偏离中轴、
      径向缩放变成"把整圈拍回轴上"（树干当年就是这么塌成刀片的）。 */
export { tubeRadiusRamp };













/* 已挂上的挂灯网格（12-env 的 applyPresence 按 count 开/关；门禁也读它） */
export const treeLanternInsts = [];
/* 梅树的花苞网格（2026-10-08）：与花分开一份几何/材质，门禁按 `plumBuds` 名字或这份清单找得到
   （项目惯例：新加的网格要能**显式**被探针拿到，别让它去 traverse 猜）。 */
const budMeshes = [];
/* 凋谢花的网格清单（2026-10-08）：与花苞同理，显式暴露给探针/门禁（别让它去 traverse 猜）。 */
const witheredMeshes = [];
/* 材质：MeshBasic + toneMapped:false —— 自发光色直接进 bloom，不吃光照也不被色调映射压暗。 */
export const TREE_LANTERN_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false,
                                                            transparent: true, opacity: 0.95,
                                                            depthWrite: false });
const MATB = { treeLantern: TREE_LANTERN_MAT };

/* ⚠️ `baseY`（2026-09-23 新增 · 老黄第三轮指认）：南岸那株实测树脚四周的可见表面在
   y = 0.40~1.03（太湖石串 + 埋脚鼓包围成一只"碗"），而树基固定在 y=0、主干只到 1.87m
   ⇒ **主干下半截连同分叉点一起埋进这圈隆起**，露出来的只剩主枝中上段。老黄看得准：
   "它的根和枝都是石头或者草皮中长出来的，而不是一个主枝干，再分支的正常形态。"
   对策：把整树抬到隆起之上（baseY），并让主干**向下加长**穿进土里（见 trunkCurve 第一点），
   免得抬起来之后树底悬空。根盘跟着树走 —— 树长在丘顶，根颈就在丘顶，这是自然的。 */
export function makePeachTree(x, z, scale = 1, baseY = 0, opts = {}){
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  g.scale.setScalar(scale);
  /* ⚠️ 本树自带随机流（种子由坐标决定）：园子的全局 rnd/rr 是**一条**可复现流，
     但桃树建在 deferBoot 的延迟任务里 —— 异步资产回调/别的延迟任务先后耗尽它的抽样数，
     树的形状就会随加载时序漂移。实测：同一份代码连开两次，主干高 2.77m vs 2.92m、
     叶包围盒也不同（见 outputs/_diag/_peach-determinism.mjs）—— 于是所有"改前改后"的数字
     都夹着一层"换了一棵树"的噪声。自带流之后，树的形状与加载时序彻底解耦。
     ⚠️ 声明必须在第一次抽样（H）之前 —— 否则 TDZ 直接抛错。 */
  const R2 = mulberry32((Math.round(x * 1000) * 73856093) ^ (Math.round(z * 1000) * 19349663)
                        ^ (Math.round(scale * 1000) * 83492791));
  const rr2 = (a, b) => a + R2() * (b - a);
  const i2 = (n) => (R2() * n) | 0;
  const H = 4.2 * rr2(0.92, 1.08) * (opts.heightMul || 1);   // 桃较柳矮：观花小乔木（梅传 heightMul 更高）
  /* ⚠️ 主干半径 0.150 → 0.100（2026-09-22 二轮重建）：老黄实拍样张里主干是一根 ~0.44m 粗的
     光杆，4m 高的桃树不该有这么粗的干（真实桃干径 0.12~0.20m）。根盘同步收小。 */
  const trunkR = 0.100 * rr2(0.94, 1.08);
  /* 冠心/冠半径：冠幅必须与**叶量预算**匹配 —— 4000 片 0.26m 的叶摊在 3.5m 宽的冠上只剩
     一层稀晕（实测 77% 的叶挤在半径 1m 内，冠外圈只摊到 23%，从外面看穿得透）。
     收到 0.34H（冠幅 ≈2.9m）后同样的叶量密度提高 ~1.5 倍。 */
  const canopyC = new THREE.Vector3(0, H * 0.64, 0);     // 冠心
  const R = H * 0.34 * (opts.canopyMul || 1);            // 冠半径（梅传 canopyMul 展得更开）
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(),
        _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(),
        _s = new THREE.Vector3(), _e = new THREE.Euler(),
        _up = new THREE.Vector3(0, 1, 0), _ax = new THREE.Vector3(),
        _basis = new THREE.Matrix4(), _bx = new THREE.Vector3(),   // 叶面定向用（见叶块）
        _p2 = new THREE.Vector3(), _p3 = new THREE.Vector3(),
        _p4 = new THREE.Vector3(), _p5 = new THREE.Vector3();        // 簇生/贴枝面定向用（花：环向+径向）

  /* 主干：地面 → **低分叉点（0.48H）**，基部根盘隆起、向上渐细。
     ⚠️ 分叉点 0.66H → 0.48H（二轮重建）：桃的招牌是**低分叉的杯状骨架** ——
     主枝从 0.7~1.6m 就斜向外张成三四个大主枝，而旧版主干光杆一直顶到 2.8m 才分枝，
     远看就是"一根旗杆顶上插了几根枝"。
     半径剖面 r(t) = trunkR × (1 − 0.40t) × (1 + 0.38(1−t)^6)：
       t=0 → 1.38r（≈0.14，根盘）→ 中段 ≈1.0r → t=1 → 0.60r（≈0.06）—— 圆管且确实在收细。 */
  const trunkCurve = new THREE.CatmullRomCurve3([
    /* ⚠️⚠️ 2026-10-06 修「腊梅主干悬空」（老黄截图1：树干整根停在雪面上方、底端与雪面有空隙）：
       这一行原来是 `-0.06 - baseY` —— 它假定 baseY ≥ 0（桃树两株正是 0 与 0.45，向下加长
       以穿过隆起的土石层）。而梅是**按负地表**落地的（腊梅 baseY = −0.40），负号一进公式就翻向：
       −0.06 −(−0.40) = **+0.34** ⇒ 主干底端被抬到组原点**上方** 0.34m，而组本身坐在 −0.40
       ⇒ 树底离地约 0.34m，整根悬空（截图里"停在雪面上"就是这么来的）。
       ⇒ 改成 `-0.06 - Math.max(0, baseY)`：baseY ≥ 0 时逐字不变（桃树不受影响），
       baseY < 0 时不再加长（组已经落在地表上，底端自然埋进土里）。 */
    new THREE.Vector3(0, -0.06 - Math.max(0, baseY), 0),
    new THREE.Vector3(rr2(-0.05,0.05), H*0.18, rr2(-0.05,0.05)),
    new THREE.Vector3(rr2(-0.04,0.04), H*0.34, rr2(-0.04,0.04)),
    new THREE.Vector3(rr2(-0.03,0.03), H*0.48, rr2(-0.03,0.03)),
  ]);
  const TR_SEG = 16, TR_RAD = 10;
  const trunkGeo = tubeRadiusRamp(
    new THREE.TubeGeometry(trunkCurve, TR_SEG, 1, TR_RAD, false), trunkCurve, TR_SEG, TR_RAD,
    t => trunkR * (1 - 0.40 * t) * (1 + 0.38 * Math.pow(1 - t, 6)),
    { caps: 'both' });    // 端盖：修"鸟瞰主干 = 半圆环薄片"（无盖时俯视看进管心+背剔只剩半圈）
  /* ⚠️ 主干**不进 mergeStatics**（userData.noMerge）：它是这个园子里唯一会"静默塌成刀片"
     的构件 —— 手工锥化那版让主干上半段整圈塌掉，而 30 道门禁没有一道看得见：合并进世界材质桶
     之后连名字都没了，按名字根本量不到它。留它单飞换来"逐圈量半径"的能力，
     代价是 2 个 draw call / 640 tri（两株）。
     注意：枝与小枝仍然合并（它们同材质同变换，并进世界桶省 draw call，且不易静默变形）。 */
  /* ⚠️ 干系材质统一走 trunkMat（2026-10-09 · 老黄"主枝条也光滑像不锈钢"）：
     旧版只有主干用 opts.trunkMat，主枝/小枝/根颈/斜根全是写死的 MAT.trunk（桃的浅棕、
     无纹理）—— 梅传了 plumTrunk（深灰褐 + 树皮 bump）也只有主干生效，主枝照旧光滑浅色。
     ⇒ 定义一次 trunkMat，五处全用（桃不传 ⇒ 仍是 MAT.trunk，逐字不变）。 */
  const trunkMat = opts.trunkMat || MAT.trunk;
  const trunkMesh = mesh(trunkGeo, trunkMat, { name:'peachTrunk', cast:true });
  trunkMesh.userData.noMerge = true;
  g.add(trunkMesh);

  /* ── 根颈 + 不规则斜根（2026-09-23 重塑 · 老黄："桃/柳露根几乎一模一样，
     而且没有这种类似花瓣一样的根系"）──
     旧版是 6 块低模扁球**均匀绕一圈**（60° 间隔 + 长轴朝外）→ 标准放射花瓣/蒜瓣，
     还与柳树的 5 块同配方。真实桃树是**根颈自然外扩 + 若干条粗细不一的根斜插入土**：
     方位不成对称、长短不齐。故改为「一个根颈扁台 + 2~4 条锥形斜根」。
     ⚠️ rr2 消耗与原版**严格等量**（6 槽 × 2 次 = 12 次）—— 后面的主枝 / 小枝 / 叶 /
        花 / 果抽样逐位不变（§36.6 同族：只改"怎么用"，不改"用几次"）。 */
  const rootSeeds = [];
  for (let i = 0; i < 6; i++){
    rootSeeds.push({ a: (i / 6) * TAU + rr2(-0.62, 0.62),   // 抖动远大于 60° ⇒ 破掉均匀感
                     s: rr2(0.75, 1.30) });
  }
  /* ① 根颈：主干基部一圈低矮外扩 —— 读作"干脚自然变粗"，而不是"插了几块石头" */
  const rootFlare = mesh(new THREE.SphereGeometry(trunkR * 1.45, 12, 7), trunkMat, { name:'peachRootFlare', cast:true });
  rootFlare.position.set(0, 0.015, 0);
  rootFlare.scale.set(1.22, 0.40, 1.22);
  g.add(rootFlare);
  /* ② 斜根：条数由 s 筛出（不再多消耗随机数），从根颈斜向外下扎进土里 */
  const pickedRoots = rootSeeds.filter(o => o.s > 0.95);
  const nRoot = Math.max(2, pickedRoots.length);
  for (let i = 0; i < nRoot; i++){
    const o = pickedRoots[i];
    /* 桃是**浅根小乔木**：露根比柳树细得多、短得多，同样要"半埋"——
       第一版 r0 0.050·s / len 0.46·s 实测读作"一根粗香肠趴在地上"。 */
    const len = 0.34 * o.s, r0 = 0.032 * o.s;
    const wob = (o.s - 1.0) * 0.9;            // 由 s 派生偏摆（不再多消耗随机数 ⇒ rr2 仍是 12 次）
    const pts = [];
    for (let k = 0; k <= 3; k++){
      const t = k / 3, aa = o.a + wob * t * t;
      const rrad = trunkR * 0.7 + (len - trunkR * 0.7) * t;
      pts.push(new THREE.Vector3(Math.cos(aa) * rrad, 0.040 - 0.115 * t, Math.sin(aa) * rrad));
    }
    const rc = new THREE.CatmullRomCurve3(pts);
    g.add(mesh(tubeRadiusRamp(new THREE.TubeGeometry(rc, 12, 1, 7, false), rc, 12, 7,
                              t => r0 * (1 - 0.70 * t)), trunkMat, { name:'peachRoot', cast:true }));
  }

  /* 主枝：5~7 根，从主干 **0.16~0.38H**（低位）处分叉斜向上外张 —— 杯状骨架。
     半径基 0.041 → 梢 0.011（随干径同步收小；旧 0.050 的枝在细干上像插上去的）。
     全部并成**一个** mesh —— 同材质同变换，分成 5~6 个 mesh 只是白送 5~6 个 draw call。 */
  const nBranch = Math.round((5 + (i2(3))) * (opts.branchMul || 1));   // 主枝（梅传 branchMul 枝更多）
  const mainBranches = [];       // 保存曲线用于挂叶/花/果
  const branchGeos = [];
  const BR_SEG = 14, BR_RAD = 7;
  for (let i = 0; i < nBranch; i++){
    const a = (i / nBranch) * TAU + rr2(-0.35, 0.35);
    const y0 = H * rr2(0.16, 0.38);
    /* ⚠️ 2026-09-23 冬态重建（老黄截图红框：南岸那棵冬天像一把扫帚）：
       旧版 reach 与 tipY **各自独立**随机 —— 垂直升幅 tipY−y0 因此在 0.46~2.47m 之间乱跳，
       7 根主枝里总有几根仰角只剩 ~21°（几乎垂直上窜），冠层裂成"竖柱"；
       夏天叶/花/果把它糊住看不出来，**冬天叶落尽当场露馅**（老黄：'冬天一眼看出不正常'）。
       改为**由主枝实长 + 仰角**反算：桃树开心形主枝与水平成 40~52°，
       冠才朝外张成杯口，而不是几根竿子朝天。
       ⚠️ rr2 消耗次数与原版一致（reach + tipY 两次 → brLen + brAngle 两次），
          本地流后续抽样（upBias / 起点抖动）逐位不受影响。 */
    const brLen   = H * rr2(0.30, 0.40);                 // 主枝实长（范围按 peach-form-guard 反调：撑太大 → 叶摊薄，夏冠层 fill 掉到 0.50 以下）
    const brAngle = rr2(0.70, 0.91);                     // 与水平 40~52°
    const reach   = brLen * Math.cos(brAngle);           // 水平投影（落在冠半径方向）
    const tipY    = y0 + brLen * Math.sin(brAngle);      // 梢端高度 = 起点 + 垂直升幅
    const upBias = rr2(0.10, 0.30);   // 向上弯曲程度
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(rr2(-0.04,0.04), y0, rr2(-0.04,0.04)),
      new THREE.Vector3(Math.cos(a)*reach*0.35, y0 + H*upBias*0.4, Math.sin(a)*reach*0.35),
      new THREE.Vector3(Math.cos(a)*reach*0.7, tipY + H*upBias*0.2, Math.sin(a)*reach*0.7),
      new THREE.Vector3(Math.cos(a)*reach, tipY, Math.sin(a)*reach),
    ]);
    mainBranches.push(c);
    branchGeos.push(tubeRadiusRamp(
      new THREE.TubeGeometry(c, BR_SEG, 1, BR_RAD, false), c, BR_SEG, BR_RAD,
      t => 0.041 - 0.030 * t));
  }
  const brMesh = new THREE.Mesh(mergeGeometries(branchGeos, false), trunkMat);
  brMesh.name = 'peachBranch';
  brMesh.castShadow = true;
  g.add(brMesh);

  /* 二级小枝：从主枝**全长**长出（旧版只从 0.25~0.95 取点、5~8 根），更细更长，
     是挂叶/花/果的主要位置。同样并成一个 mesh —— 旧版 40~50 根小枝 = 40~50 个 draw call。 */
  const twigs = [];
  const twigGeos = [];
  /* 与 twigs 逐位对齐的**枝半径表**（2026-10-09 · 修"花悬空/穿模"）：
     花的挂点要贴在**枝面**上（枝心 + 本处半径），而不是拿一个固定偏移 ——
     梅枝半径 16mm→5mm 逐级变化，固定偏移必然两头都不对（细梢悬空、粗根埋进枝里）。
     存 {r0, r1}：局部半径 = r0 − r1·t。 */
  const twigRad = [];
  const TW_SEG = 6, TW_RAD = 5;
  for (const br of mainBranches){
    /* twigMul（2026-10-08）：梅要"枝条数量与分叉更多 ⇒ 花点满枝"（老黄："现实中的梅花
       不是这种密集型开放"，参照图是真实蜡梅/梅的**疏枝点花**）。桃不传 ⇒ 逐字不变。 */
    const nTwig = Math.round((8 + (i2(5))) * (opts.branchMul || 1) * (opts.twigMul || 1));
    for (let k = 0; k < nTwig; k++){
      const t = rr2(0.20, 0.96);
      const base = br.getPointAt(t);
      const tan = br.getTangentAt(t).normalize();
      // 小枝向外上方生长
      const a = rr2(0, TAU);
      const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const dir = new THREE.Vector3()
        .addScaledVector(side, rr2(0.50, 0.90))
        .addScaledVector(_up, rr2(0.35, 0.75))
        .addScaledVector(tan, rr2(-0.10, 0.35))
        .normalize();
      /* ⚠️ 枝条长度（2026-10-08 老黄："通常我们看到的腊梅和红梅都是一个**细长的枝条**上
         （部分枝条和分叉可以再长一些）"）：梅 0.22~0.42 → **0.30~0.58**（更长、变化更大 ⇒
         有长有短才像"细长枝条"而不是一圈齐刷刷的短枝），管径也收细一档（13mm→11.5mm 起）。
         ⚠️ **桃树不传 `longTwig` ⇒ 逐字保持原样**（这一个函数是桃/梅共用的，长度一改，
            桃的株形也变 —— 老黄没要求动桃）。 */
      const len = opts.longTwig ? rr2(0.30, 0.58) : rr2(0.22, 0.42);
      const tip = base.clone().addScaledVector(dir, len);
      const mid = base.clone().addScaledVector(dir, len * 0.5);
      mid.y += rr2(0.02, 0.07);                 // 小枝稍微向上拱
      const twCurve = new THREE.CatmullRomCurve3([base.clone(), mid, tip.clone()]);
      twigs.push(twCurve);
      /* ⚠️ 枝径加粗（2026-10-09 · 参考图判读："单朵花径明显大于枝条直径（枝粗约为花径的
         1/4~1/5）"⇒ 花径 0.10m ⇒ 枝粗 20~25mm）。旧 11.5mm→8mm 只有花径的 1/8~1/10，
         多模态判"花浮在黑铁丝上"。梅（longTwig）加粗到 **16mm→11mm**；桃不传 ⇒ 逐字不变。 */
      const rad0 = opts.longTwig ? 0.016 : 0.013, rad1 = opts.longTwig ? 0.011 : 0.009;
      twigRad.push([rad0, rad1]);
      twigGeos.push(tubeRadiusRamp(
        new THREE.TubeGeometry(twCurve, TW_SEG, 1, TW_RAD, false), twCurve, TW_SEG, TW_RAD,
        s => rad0 - rad1 * s));
    }
  }
  /* ⚠️ 挂灯只看**二级枝**：下面的三级枝是 2026-10-08 新增的枝层，而 `treeLanterns` 的数量
     与 festival-guard / festival-lanterns-guard 的口径绑着 —— 不能被新枝层带着一起变。 */
  const baseTwigs = twigs.slice();
  /* ⚠️ 新增枝层必须**在 twigMesh 建之前**推进 twigGeos（并进同一个合并网格 ⇒ 仍只 1 个 draw call）。 */
  if (opts.subTwig){
    /* ── 三级枝（2026-10-08 新增 · 2026-10-09 二轮按老黄反馈重塑）───────────
       老黄 2026-10-09："末端（长花骨朵和开花）的细支直径再缩一倍，长度增加一倍，
       这样花骨朵和花就有足够的空间落位了"＋"树的中下部仍有大量枯枝，要么大量减少
       要么给这些枝也加上花朵"。
       ⇒ ① **长度 0.14~0.30 → 0.30~0.62（×2）**：末级枝更长 ⇒ 沿枝的停点更多、
          每根枝上能落下的花簇更多（花有地方站）。
          ② **直径 ÷2**（11mm→6mm 起 / 5mm→2.5mm 梢）：细枝才承得住"花裹枝"的形态
          （花径 0.10m，枝径 6mm 时花是枝的 16 倍粗 ⇒ 读作"花串挂在细枝上"）。
          ③ **每根二级枝的三级枝数 2~3 → 1~2（大量减少）**：枝少了，同样多的花
          摊到每根枝上的密度就高（配合 flowerN 翻倍 ⇒ 中下部枯枝被花盖住）。 */
    const parents = twigs.slice();
    for (const tw of parents){
      const nSub = 1 + (i2(2));
      for (let k = 0; k < nSub; k++){
        const t = rr2(0.25, 0.92);
        const base = tw.getPointAt(t);
        const tan = tw.getTangentAt(t).normalize();
        const a = rr2(0, TAU);
        const dir = new THREE.Vector3()
          .addScaledVector(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), rr2(0.35, 0.80))
          .addScaledVector(_up, rr2(0.30, 0.70))
          .addScaledVector(tan, rr2(0.05, 0.45))
          .normalize();
        const len = rr2(0.30, 0.62);              // ×2：末级枝更长（花有落位空间）
        const tip = base.clone().addScaledVector(dir, len);
        const mid = base.clone().addScaledVector(dir, len * 0.5);
        mid.y += rr2(0.01, 0.04);                 // 同样微微上拱
        const c = new THREE.CatmullRomCurve3([base.clone(), mid, tip.clone()]);
        twigs.push(c);
        twigRad.push([opts.longTwig ? 0.0055 : 0.008, opts.longTwig ? 0.0025 : 0.006]);   // 与下面的半径剖面逐位对齐
        twigGeos.push(tubeRadiusRamp(
          new THREE.TubeGeometry(c, TW_SEG, 1, TW_RAD, false), c, TW_SEG, TW_RAD,
          s => (opts.longTwig ? 0.0055 : 0.008) - (opts.longTwig ? 0.0025 : 0.006) * s));   // 末级枝：梅 5.5mm→3mm（÷2）/ 桃 8mm→2mm
      }
    }
  }
  const twMesh = new THREE.Mesh(mergeGeometries(twigGeos, false), trunkMat);
  twMesh.name = 'peachTwig';
  twMesh.castShadow = true;
  g.add(twMesh);

  /* ── 枯枝挂灯（2026-09-25 · 计划书 Phase 3 第 7 项方案B）────────────────────
     挂在**真实枝条**上：主枝取梢段、小枝取中后段，每处挂一盏下垂的小灯笼。
     挂点用本树自己的 R2 流（rr2）取样 ⇒ 与树形同源。
     ⚠️ 挂灯是**运行期开关**（灯会才显示），但几何在装配时一次建好：count=0 ⇒ three 不提交，
        零 draw call（与紫藤/桃叶的季节通道同一套路，见 12-env 的 applyPresence）。
     ⚠️ 挂灯是 `g` 的**子节点** ⇒ 树的位置/缩放/根盘基准自动继承，不会"灯浮在半空"。
     ⚠️ 这里用的是 rr2（本树私有流），**不碰共享 rnd** ⇒ 布局指纹基线不受影响。 */
  const hangPts = [];
  for (const br of mainBranches){
    const nH = 5 + (i2(3));                       // 主枝 5~7 处
    for (let k = 0; k < nH; k++){
      const t = rr2(0.45, 0.97);                  // 梢段：叶幕挡不到的地方才看得见灯
      hangPts.push(br.getPointAt(t).clone());
    }
  }
  for (const tw of baseTwigs){
    if (rr2(0, 1) < 0.55) continue;               // 一半小枝挂灯：太密会糊成一团
    hangPts.push(tw.getPointAt(rr2(0.45, 0.92)).clone());
  }
  if (hangPts.length){
    const inst = new THREE.InstancedMesh(makeTreeLanternGeo(), MATB.treeLantern, hangPts.length);
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    inst.userData.noMerge = true;                 // 实例色会被几何合并丢掉
    inst.userData.aoSkip = true;                  // 灯自身在发光，不进 GTAO 法线 pass
    inst.name = 'treeLanterns';
    inst.frustumCulled = false;
    const mm = new THREE.Matrix4(), pv = new THREE.Vector3(),
          qq = new THREE.Quaternion(), sv = new THREE.Vector3(1, 1, 1),
          upv = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < hangPts.length; i++){
      pv.copy(hangPts[i]);
      pv.y -= 0.15;                               // 从枝上垂下来（灯顶贴着枝）
      qq.setFromAxisAngle(upv, rr2(0, TAU));      // 每盏自转，避免"一模一样"
      mm.compose(pv, qq, sv);
      inst.setMatrixAt(i, mm);
      inst.setColorAt(i, treeLanternColor(rr2));
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    g.add(inst);
    treeLanternInsts.push(inst);
  }

  /* ── 挂点基建：沿木质枝条按**固定弧长**取样 ──
     枝有多长就有多少挂点，叶/花/果全部挂在这些点上（不再"每枝随机几片"）。
     旧版正是因此常年只挂到 379/600 —— 叶量由随机的枝数决定，`count` 声明 600 从未兑现。
     w = 该点分到的叶量份额：小枝是当年新梢、叶最多，主枝是骨架、只有零星叶。 */
  const woodPts = [];
  const sampleWood = (curve, spacing, w) => {
    const n = Math.max(2, Math.round(curve.getLength() / spacing));
    for (let i = 0; i <= n; i++){
      woodPts.push({ p: curve.getPointAt(i / n), tan: curve.getTangentAt(i / n).normalize(), w });
    }
  };
  for (const tw of twigs) sampleWood(tw, 0.024, 1.0);
  for (const br of mainBranches) sampleWood(br, 0.060, 0.45);

  /* 绕枝轴、方位角 a 的单位向量（用于"叶子朝枝的哪一侧长"） */
  const _perp = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  const aroundAxis = (tan, a) => {
    _pa.copy(_up);
    if (Math.abs(tan.dot(_pa)) > 0.92) _pa.set(1, 0, 0);
    _pb.crossVectors(tan, _pa).normalize();
    _pa.crossVectors(_pb, tan).normalize();
    return _perp.copy(_pa).multiplyScalar(Math.cos(a)).addScaledVector(_pb, Math.sin(a)).normalize();
  };
  /* 确定性打散（乘性散列，不用随机数 → 每次构建结果一致）：
     季节通道是按 `count` 截**前缀**的（春 peachShow=0.15 只显前 15%、秋果 0.7 显前 70%），
     不散开就会出现"春天的嫩叶全挤在头一根枝上""秋天掉的果全在南侧"。
     散开之后任何前缀在空间上都是均匀的。 */
  const spread = (arr) => arr
    .map((o, i) => ({ o, k: (i * 2654435761) % 4294967296 }))
    .sort((a, b) => a.k - b.k)
    .map(x => x.o);
  /* 槽位不够就按轮转从 pool 补足 —— 保证挂满声明数量，不再"声明 600 实挂 379" */
  const fillTo = (arr, target, pool) => {
    for (let i = 0; arr.length < target; i++) arr.push(pool[(i * 37) % pool.length]);
  };

  /* ── 冠层叶幕壳（canopyShell）──
     把叶子按"归一化椭球半径" q = |(p−冠心)/各半轴| 夹进 [SHELL_LO, SHELL_HI]，两个方向都管：
       · q > HI（甩到壳外的散叶）→ 收回壳面。桃冠的**轮廓**是这一层的包络，
         甩出去一片就能把"冠半径"撑大一圈，而门禁是按轮廓内命中率算的 —— 等于自己稀释自己。
       · q < LO（深埋冠心的叶）→ 推到壳内圈，填掉"枝与枝之间的空腔"。
     竖向半轴比水平小（CAN_B/CAN_A≈0.78）：桃是扁圆冠，真实桃的冠高本就小于冠幅，
     旧版叶子只在一条水平带上，正侧看就是"能看穿的煎饼"。 */
  const CAN_A = R;                        // 水平半轴（冠幅半径）
  const CAN_B = R * 0.84;                 // 竖向半轴（杯状骨架的冠比旧版更高瘦一点）
  const SHELL_LO = 0.30, SHELL_HI = 1.0;
  const SHELL_HI_FLOWER = 2.0;            // 花的宽松兜底（见下：花不按冠壳收）
  const _cs = new THREE.Vector3();
  /* ⚠️ `outwardOnly`（2026-10-08 · 梅专用）：只把**甩到壳外**的收回壳面，**不把冠内的推出去**。
     为什么：老黄说梅"开成了紫藤那种密集花串" —— 量出来的真因不是朵数，而是这条夹壳把
     **冠内**的花统统推到同一个椭球面上（实测最近邻中位 0.033m ＝ **0.19 倍花径**、
     1500 朵里 1421 朵与邻居挤在半朵之内）。真实梅是"花贴在自己那根枝上"，
     所以梅改成"只收外沿、不动冠内" ⇒ 花沿枝自然分布（间隔＝沿枝点距 0.10~0.22m），
     同时仍保住"不许顶出冠轮廓"这条（叶幕/轮廓由叶子负责）。 */
  const canopyShell = (p, outwardOnly = false) => {
    _cs.copy(p).sub(canopyC);
    const nx = _cs.x / CAN_A, ny = _cs.y / CAN_B, nz = _cs.z / CAN_A;
    const q = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (q < 1e-4) return p;
    const lo = outwardOnly ? 0 : SHELL_LO;
    /* ⚠️⚠️ 花**不再按冠壳收**（2026-10-09 三轮）：花已经精确挂在枝面上（见 placeBlossoms），
       枝伸到哪里花就跟到哪里 —— 这才是"每根枝上都有花"。旧的 `min(SHELL_HI=1.0, q)` 把
       壳外的花**全部吸回 q=1 的椭球面**：三级枝加长一倍（0.30~0.62）后大量花点在壳外
       ⇒ 花聚成中间一个球、壳外的长枝全秃（多模态实测判读："花聚成中间一个球、
       外围长枝是秃的""花不像沿枝的串"）。这里只留**宽松兜底 2.0** 防异常离群。 */
    const hi = outwardOnly ? SHELL_HI_FLOWER : SHELL_HI;
    const s = Math.min(hi, Math.max(lo, q));
    if (s === q) return p;
    return p.copy(_cs).multiplyScalar(s / q).add(canopyC);
  };

  /* ── 叶：桃叶互生，短枝上 3~4 片成簇 ── */
  const leafGeo = makePeachLeafGeo();
  const leafN = Math.round(4000 * (opts.leafMul || 1));
  const leafInst = new THREE.InstancedMesh(leafGeo, opts.leafMat || MAT.peachLeaf, leafN);
  leafInst.castShadow = true;
  const leafA = new THREE.Color(0x79B23E), leafB = new THREE.Color(0x44701F);

  const wTot = woodPts.reduce((s, o) => s + o.w, 0);
  const leafRaw = [];
  for (const o of woodPts){
    const n = Math.max(1, Math.round(leafN * o.w / wTot));
    for (let k = 0; k < n; k++) leafRaw.push(o);
  }
  fillTo(leafRaw, leafN, woodPts);
  const leafSlots = spread(leafRaw).slice(0, leafN);

  for (let i = 0; i < leafSlots.length; i++){
    const o = leafSlots[i];
    /* 叶从枝上斜向外上方长出（叶柄极短），方位角按黄金角错开 —— 互生叶序不是并排 */
    const lat = aroundAxis(o.tan, i * 2.39996 + rr2(-0.40, 0.40));
    const leafDir = lat.clone()
      .addScaledVector(_up, rr2(0.05, 0.35))
      .addScaledVector(o.tan, rr2(-0.15, 0.25))
      .normalize();
    _q.setFromUnitVectors(_up, leafDir);                  // 叶几何沿 +Y 生长
    _p.copy(o.p).addScaledVector(leafDir, 0.004);
    /* 冠层被夹进椭球"叶幕"壳层（见 canopyShell）：上下压扁（冠高 < 冠幅）、内外有界。
       这一步同时管两件事：① 把枝间的空隙填上 ② 把个别甩到壳外的叶子收回来 ——
       后者是**判据的必需**：门禁的冠半径取所有叶实例的最大水平半径，一片甩出去的叶
       就能把轮廓撑大一圈，再拿"轮廓内命中率"去除，等于自己稀释自己。 */
    canopyShell(_p);
    /* 叶面朝**冠外偏上**（叶向光）：叶几何的局部 ±Z 是叶面法线，把它对到"冠心→叶"的方向上
       （扣掉沿叶长的分量后正交化）。旧版是绕叶长轴**随机翻卷 0~2π** —— 一半的叶侧对视线
       只剩一条边，整冠读成"炸毛的刺球"，投影面积也白丢一半（门禁的遮挡率量的正是这个）。
       ⚠️ 法线必须与 _up 混合再正交化：纯径向法线会让**背阳那半边**整片发黑
       （实拍样张：冠层变成一颗深色尖刺球）；太阳在 50° 高，叶面偏上才接得到光。 */
    _ax.copy(_p).sub(canopyC).normalize();
    _ax.addScaledVector(_up, 0.85).normalize();
    _ax.addScaledVector(leafDir, -_ax.dot(leafDir));
    if (_ax.lengthSq() > 1e-8){
      _ax.normalize();
      _bx.crossVectors(leafDir, _ax).normalize();
      _q.setFromRotationMatrix(_basis.makeBasis(_bx, leafDir, _ax));
    }
    _q.multiply(_q2.setFromAxisAngle(_up, rr2(-0.55, 0.55)));   // 只留一点翻卷差异，不做全随机
    _s.setScalar(rr2(0.85, 1.25));
    _m.compose(_p, _q, _s); leafInst.setMatrixAt(i, _m);
    leafInst.setColorAt(i, leafA.clone().lerp(leafB, R2())
      .offsetHSL(rr2(-0.02,0.02), rr2(0,0.05), rr2(-0.05,0.05)));
  }
  leafInst.count = leafN;
  leafInst.instanceMatrix.needsUpdate = true;
  if (leafInst.instanceColor) leafInst.instanceColor.needsUpdate = true;
  g.add(leafInst);

  /* ── 花：春季先花后叶 —— 桃的花芽与叶芽同在短枝上（花芽先萌），故与叶同源取样。
     ⚠️ 花量 900 → 2000 → **3000**（2026-09-22 三轮，老黄："桃花再多 50%"）：
     900 朵挂在 2.6m 的冠上，实拍样张里只数得出 ~30 个粉点 —— 代码注释写着"花满树"，
     画面是"零星几朵"，又一处"状态对、画面不对"；2000 朵时近观已读得出满树花，
     再 +50% 是为了**在鸟瞰距离上也成团**（远处单朵只剩 1~2px，靠数量堆出可见的粉色体积）。
     单朵 12 tri，3000 朵 = 3.6 万 tri（全场 1.5M，可忽略）。
     并且花与叶走**同一套 canopyShell 壳层**：桃是**先花后叶**，盛花期冠里没有叶帮忙遮挡，
     花若全埋在枝心的位置就只剩几个点 —— 推到壳层才读得出"满树花"。 */
  const flGeo = opts.flowerGeo || makePeachFlowerGeo();
  const flN = opts.flowerN || 3000;          // 梅传 140（簇心）；桃用默认 3000
  const CL = !!opts.blossomCluster;           // 簇生开关（只给梅开；桃不传 ⇒ 逐字不变）
  const flInst = new THREE.InstancedMesh(flGeo, opts.blossomMat || MAT.peachBlossom, CL ? Math.ceil(flN * 3) : flN);
  const flA = opts.blossomA || new THREE.Color(0xFFE8F0), flB = opts.blossomB || new THREE.Color(0xF490B4);

  const twigPool = woodPts.filter(o => o.w > 0.9);
  const flRaw = [];
  /* ⚠️⚠️ 花的着生方式（2026-10-08 重写，老黄："梅花开出来紫藤这种花的效果，现实中的梅花不是
     这种密集型开放…把枝条数量和分叉再增加，每条枝条和分叉上的花苞和花朵如截图所示"）：
     旧写法 = 每条小枝 3~5 簇 × 每簇 1~3 朵挂在**同一个点**上（只差 8mm 花梗），
     加上 `fillTo` 又把不足的朵数用轮转重复堆在既有槽位 ⇒ 投影上就是一串一坨（紫藤感）。
     新写法 = **沿枝点花**，与真实梅一致：花单生或 2~3 朵并生于枝节、贴枝、无长梗；
        · 沿每根二级/三级枝按 0.10~0.22m 的**间隔**走（间隔按枝长给，末级枝短就 1~2 个点）；
        · 每个停点先掷一次"**留白**"（22% 跳过）⇒ 出现裸枝段，这正是"疏影横斜"的节奏；
        · 35% 的停点**并生第 2 朵**（真实梅常 2 朵并生，截图里也成对）；
        · 加点用枝长比例算，短枝自然少花、长枝多花（不再"每枝一律 3~5 簇"）。 */
  /* ⚠️ 每个花点带**枝编号** w（2026-10-09）：下面的取样要"按枝交错"，
     保证每一根枝都拿到花 —— 老黄："树的中下部仍有大量枯枝，要么大量减少要么给这些枝也加上花朵"。 */
  const pushStop = (curve, t, w) => {
    /* ⚠️ 存**该处的枝半径**（2026-10-09 三轮 · 修"花悬空/穿模"）：梅枝半径 16mm→5mm
       逐级变化，花若按固定偏移挂必然两头都不对（细梢 5mm 的枝挂到 1cm 外 = 悬空；
       粗根 16mm 的枝挂 1cm 外 = 仍贴着枝心附近）。挂点 = 枝心 + 本处半径 + 小贴面偏移
       （见 placeBlossoms 的 stemLo/stemHi）⇒ 花/苞都贴在**枝面**上。
       w ≥ 100000 是主枝梢端的点（没进 twigRad）⇒ 用 0.02 兜底（主枝半径 11~41mm）。 */
    const r = (w < 100000 && twigRad[w]) ? (twigRad[w][0] - twigRad[w][1] * t) : 0.02;
    flRaw.push({ p: curve.getPointAt(t), tan: curve.getTangentAt(t).normalize(), t, w, r });
  };
  for (let twi = 0; twi < twigs.length; twi++){
    const tw = twigs[twi];
    const L = tw.getLength();
    let s = rr2(0.04, 0.18) * L;                  // 梢端留一小段裸枝
    while (s < L * rr2(0.86, 1.0)){
      const t = s / L;
      if (rr2(0, 1) > 0.18) pushStop(tw, t, twi);  // 18% 留白（2026-10-09 参考图：节距 = 1~1.5 花径、枝被花裹成串）
      if (rr2(0, 1) < 0.35) pushStop(tw, Math.min(0.99, t + rr2(0.012, 0.030)), twi);   // 并生（花苞对）
      /* ⚠️ 节距收紧（2026-10-09 · 老黄给的参考图判读："节距大约等于 1~1.5 朵花的直径，
         使簇与簇之间只露出一点光枝，形成糖葫芦/穗状的串"）：花径 0.10m ⇒ 节距
         0.10~0.15m。旧 0.08~0.30 平均 0.19m 偏疏 ⇒ 多模态判"花均匀撒在枝上、
         读不成节点上的绒球"。收紧到 **0.06~0.17**（平均 ~0.11m，近的密、远的留缝）。 */
      s += rr2(0.06, 0.17);
    }
  }
  for (let bi = 0; bi < mainBranches.length; bi++){    // 主枝梢端也开花
    const br = mainBranches[bi];
    const n = 4 + (i2(4));
    for (let k = 0; k < n; k++){
      const t = rr2(0.55, 0.98);
      flRaw.push({ p: br.getPointAt(t), tan: br.getTangentAt(t).normalize(), w: 100000 + bi });
    }
  }
  /* fillTo 只是**兜底**：枝条够多时自然槽位已超过 flN，spread+slice 只做均匀抽稀，不会堆叠。
     ⚠️ 但"够不够多"必须**量**出来（2026-10-08）：自然槽位 < flN 时，fillTo 会按
     `pool[(i*37)%n]` 轮转把同一批点重复塞进来 ⇒ 一个点上落好几朵 ⇒ 投影上就是"花串"
     （老黄："开成紫藤那种效果"的机械原因之一）。所以把两个数挂到网格上，供探针/门禁读。 */
  const flNatural = flRaw.length;
  fillTo(flRaw, flN, twigPool);
  /* ⚠️ 取样 = **按枝长比例分配 + 沿枝均匀取样**（2026-10-09 三轮 · 老黄："树的中下部仍有
     大量枯枝，要么大量减少要么给这些枝也加上花朵"）：
     旧写法 `spread(flRaw).slice(0, flN)` 从全部停点里**随机抽** N 个 —— 自然停点 2535
     远多于声明朵数 800 ⇒ 只覆盖约三成枝段，没抽中的枝就是**光枝**（中下部枝多 ⇒ "大量枯枝"）。
     ⚠️ 也不能用"轮转按第 k 个停点取"：停点按 t 递增排列，轮转第 1 轮取的全是每根枝的
        **最基部**那个点 ⇒ 花全挤在枝根、枝梢照样秃（把枯枝从"整体"挪到"梢部"而已）。
     ⇒ 正解：每根枝先保底 1 个，余下按**枝的停点数占比**分配（停点间距相近 ⇒ 占比∝枝长），
        再在每根枝内部**按等分位置**取点 ⇒ 花沿每根枝从根到梢铺开，没有整根秃的枝。 */
  const flSlots = [];
  {
    const groups = new Map();
    for (const o of flRaw){
      const g = groups.get(o.w);
      if (g) g.push(o); else groups.set(o.w, [o]);
    }
    const lists = [...groups.values()];
    const total = flRaw.length || 1;
    let alloc = 0;
    const picks = lists.map(list => {
      const n = Math.max(1, Math.round(flN * (list.length / total)));
      alloc += n;
      return n;
    });
    /* 分配总和可能略偏离 flN（取整）—— 按比例微调：多了从最长的枝减、少了给最长的枝加 */
    let diff = alloc - flN;
    for (let i = 0; diff > 0 && i < 4000; i++){
      const idx = i % picks.length;
      if (picks[idx] > 1){ picks[idx]--; diff--; }
    }
    for (let i = 0; diff < 0 && i < 4000; i++){
      picks[i % picks.length]++; diff++;
    }
    for (let gi = 0; gi < lists.length; gi++){
      const list = lists[gi], n = picks[gi];
      for (let k = 0; k < n; k++){
        const idx = Math.min(list.length - 1, Math.round((k + 0.5) / n * list.length - 0.5));
        flSlots.push(list[Math.max(0, idx)]);
      }
    }
  }
  flInst.userData.flDeclared = flN;
  flInst.userData.flNatural = flNatural;
  flInst.userData.flFabricated = Math.max(0, flN - flNatural);   // >0 = 有朵数是"凑"出来的（会堆叠）

  /* ══ 三种状态按比例分（2026-10-08 · 老黄："总归有 60% 左右的花、30% 左右的苞（嫩黄色）、
        还有 10% 左右是开始凋谢的花（花苞枯黄），按这个比例来重新修改两株梅花的造型"）══
     槽位是同一批（`flSlots`，沿枝点生），按**生长顺序**分给三个网格（老黄给的真实梅资料：
     "花苞靠近枝梢，盛开花朵位于中部，凋谢花朵位于较低位置"）：
       打分 k = 1.25×（沿枝位置 t） + 相对冠心的高度 ⇒ 高的=枝梢=**花苞**、低的=**凋谢**、中间=**盛开**。
       打分是确定性的（不抽随机），比例仍是他要的 30/10/60。
     计数全部挂到 userData 上，供门禁直接断言比例（不靠"看图数"）。 */
  const budFrac = opts.budFrac || 0;
  const budN = Math.min(flSlots.length, Math.round(flSlots.length * budFrac));
  const witherN = Math.min(flSlots.length - budN, Math.round(flSlots.length * (opts.witherFrac || 0)));
  const witherCol = opts.witherColor || null;      // 枯黄 / 枯褐（每株一色，由 makePlumTree 给）
  const scored = flSlots.map((o, i) => ({ o, i, k: (o.t || 0) * 1.25 + (o.p.y - canopyC.y) / CAN_B }))
    .sort((a, b) => (b.k - a.k) || (a.i - b.i));
  const budSlots = scored.slice(0, budN);
  const witherSlots = scored.slice(scored.length - witherN);
  const openSlots = scored.slice(budN, scored.length - witherN);
  flInst.userData.flBuds = budN;
  flInst.userData.flWithered = witherN;
  flInst.userData.flOpen = openSlots.length;

  /* 一处放置逻辑，三个网格共用（花 / 凋谢 / 花苞）——避免三份几乎一样的代码各自漂。
     opts: axis('Z'|'Y' 几何的"花盘/苞轴"方向) / droop(凋谢的垂角) / scaleLo-Hi / tint(实例色)
     ⚠️ cluster [nMin,nMax] + clusterOff = **簇生**（老黄 2026-10-08："梅花应该是一小簇一小簇的，
        一个小枝节会并列开出好几朵花朵，同样花骨朵也是两个或者三个长一起…把一个大的花苞
        变成挨着的两个或者三个"）。梅是腋生花芽（每节 2~3 花并生），玉兰是单朵顶生。 */
  const placeBlossoms = (slots, inst, o) => {
    let idx = 0;
    for (let i = 0; i < slots.length; i++){
      const s = slots[i].o;
      const lat = aroundAxis(s.tan, i * 2.39996 + rr2(-0.50, 0.50));
      const face = lat.clone().addScaledVector(_up, rr2(0.35, 0.95)).normalize();
      /* 挂点 = 枝心 + (**本处枝半径** + 小贴面偏移) —— 贴在枝面上（2026-10-09 三轮：
         旧写法用固定 1~4.5cm 偏移，而梅枝半径沿枝 16mm→3mm 逐级变化 ⇒ 细梢悬空、
         粗根处仍埋着；现在偏移跟着枝半径走，正是"花裹着枝"该有的贴面）。 */
      _p.copy(s.p).addScaledVector(face, (s.r || 0.02) + rr2(o.stemLo, o.stemHi));
      /* ⚠️ 花与叶**不同**：叶要把冠填满（两个方向都夹进壳层），花要**贴在自己的枝上**
         （只收外沿、冠内不动）—— 否则冠内的花被挤到同一个椭球面上，读成"紫藤式花串"。 */
      canopyShell(_p, opts.flowerOutwardOnly === true);
      /* 朝向要在**夹壳之后**重算（夹壳挪了位置）：朝冠外偏上；花盘是单面卡，朝内就看不见。
         ⚠️ upMix 支持传**区间**：逐朵抽 ⇒ 有的花朝天、有的侧向外（实测"朝向一致"会被读成图标）。 */
      const upMix = Array.isArray(o.upMix) ? rr2(o.upMix[0], o.upMix[1]) : o.upMix;
      face.copy(_p).sub(canopyC).normalize().addScaledVector(_up, upMix).normalize();
      _q.setFromUnitVectors(_ax.set(o.axis === 'Y' ? 0 : 0, o.axis === 'Y' ? 1 : 0, o.axis === 'Y' ? 0 : 1), face);
      _q.multiply(_q2.setFromAxisAngle(_ax, rr2(0, TAU)));
      if (o.droop){
        _q2.setFromAxisAngle(_ax.set(1, 0, 0), rr2(o.droop[0], o.droop[1]));
        _q.multiply(_q2);
      }
      /* 簇生（2026-10-09 二轮 · 老黄："梅花成簇开放是指环绕枝条一圈的那种环绕"，参考图：
         同一节的花朝**四面八方**放射——左、右、前、后都有，"从镜头看枝条像被花裹住"）。
         ⇒ 簇成员不再随机偏移，而是**绕枝条轴一圈均匀分布**（角度错开 + 半径小偏移），
         每朵的朝向也各自朝自己的外向（不再共享朝向）。 */
      const nC = o.cluster
        ? Math.max(o.cluster[0], Math.min(o.cluster[1], Math.round(rr2(o.cluster[0], o.cluster[1] + 0.999))))
        : 1;
      const ringBase = rr2(0, TAU);                          // 本簇的起始角（逐簇不同）
      for (let c = 0; c < nC; c++){
        const ang = ringBase + (c / nC) * TAU + rr2(-0.25, 0.25);   // 环向角度 + 少量抖动
        const off = o.clusterOff || 0;
        if (o.cluster && off){
          /* 沿枝条法平面（垂直于 tan）的环向偏移：前后左右各一朵，围住枝条。
             ⚠️ 环半径 = **本处枝半径 + clusterOff**（2026-10-09 三轮）：直接拿 clusterOff
             当环半径的话，细梢（枝半径 3mm）处花瓣会穿进枝里、粗根处又离枝太远。
             ⚠️ 环的第二个基向量必须是 **tan × lat**（垂直于枝轴），不能用世界上方向
             (0,1,0)——斜枝下它不垂直于枝轴，环会退化成椭圆、花沿枝滑动而不是绕枝一圈。 */
          const ringR = (s.r || 0.02) + off;
          _p3.copy(lat);                                       // 基1（⟂ tan）
          _p4.crossVectors(s.tan, lat).normalize();            // 基2（⟂ tan 且 ⟂ 基1）⇒ 真环
          _p2.copy(s.tan).multiplyScalar(rr2(-off * 0.4, off * 0.4));   // 沿枝向微移（节距内）
          _p2.addScaledVector(_p3, Math.cos(ang) * ringR);     // 环向（横）
          _p2.addScaledVector(_p4, Math.sin(ang) * ringR);     // 环向（纵）
          _p2.add(_p);                                         // 加到挂点
          _s.setScalar(rr2(o.scale[0], o.scale[1]) * (c === 0 ? 1 : rr2(0.85, 0.97)));
          /* 簇成员朝向：各自朝"自己的外向"（不再共享一朵的朝向） */
          _p5.copy(_p2).sub(canopyC).normalize().addScaledVector(_up, upMix * rr2(0.5, 1.2)).normalize();
          _q.setFromUnitVectors(_ax.set(0, o.axis === 'Y' ? 1 : 0, o.axis === 'Y' ? 0 : 1), _p5);
          _q.multiply(_q2.setFromAxisAngle(_ax, rr2(0, TAU)));
          if (o.droop){ _q2.setFromAxisAngle(_ax.set(1, 0, 0), rr2(o.droop[0], o.droop[1])); _q.multiply(_q2); }
          _m.compose(_p2, _q, _s);
        } else {
          _s.setScalar(rr2(o.scale[0], o.scale[1]));
          _m.compose(_p, _q, _s);
        }
        inst.setMatrixAt(idx, _m);
        inst.setColorAt(idx, o.color());
        idx++;
      }
    }
    inst.count = idx;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    g.add(inst);
  };

  /* ① 盛开（60%）：花色随机深浅 + 轻微色相/明度抖动；
        ⚠️ 尺度/朝向**要散开**（2026-10-08 二轮，实测判读"形状雷同、大小接近、朝向一致、
        平贴枝条 ⇒ 像均匀撒在枝上的图标"）：尺寸 0.85~1.20 → **0.72~1.35**，
        花盘抬升混合系数 upMix 也逐朵抽（0.25~1.15）⇒ 有的朝天、有的侧向外。 */
  placeBlossoms(openSlots, flInst, {
    axis: 'Z', upMix: [0.25, 1.15], stemLo: 0.002, stemHi: 0.010,
    scale: CL ? [0.60, 0.95] : [0.85, 1.35],
    ...(CL ? { cluster: [2, 3], clusterOff: 0.016 } : {}),
    color: () => flA.clone().lerp(flB, R2()).offsetHSL(rr2(-0.03, 0.03), rr2(0, 0.06), rr2(-0.03, 0.04)),
  });
  /* ② 凋谢（10%）：**自己的几何**（花瓣短一档 + 向下折 53°~65°、只 4 片、雄蕊外露）+
     **自己的材质**（花瓣材质那层红自发光会把枯色盖掉 ⇒ 凋花照样鲜红，实测判读"看不出是枯萎花"）
     + 颜色往枯黄/枯褐压 + 整朵再往下垂。 */
  if (witherN > 0){
    const wInst = new THREE.InstancedMesh(makePlumWitheredGeo(), MAT.plumWithered, witherN * 3);
    wInst.name = 'plumWithered';
    wInst.castShadow = false;
    wInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    placeBlossoms(witherSlots, wInst, {
      axis: 'Z', upMix: [0.10, 0.45], stemLo: 0.002, stemHi: 0.012, scale: [0.60, 0.85],
      droop: [0.45, 0.90], cluster: [2, 3], clusterOff: 0.014,
      color: () => {
        const c = flA.clone().lerp(flB, R2()).offsetHSL(rr2(-0.03, 0.03), rr2(0, 0.06), rr2(-0.03, 0.04));
        return witherCol ? c.lerp(witherCol, rr2(0.70, 0.92)) : c;
      },
    });
    witheredMeshes.push(wInst);
  }
  /* ③ 花苞（30%）：独立几何 + 独立材质（花瓣材质带花瓣 alpha 贴图，套在球上会被裁破）。
     嫩色调 = 往花色的**浅端**（blossomA）靠并提亮（老黄要的"嫩黄色"）。 */
  if (opts.budMat && budN > 0){
    const budInst = new THREE.InstancedMesh(makePlumBudGeo(), opts.budMat, budN * 3);
    budInst.name = 'plumBuds';
    budInst.castShadow = false;
    budInst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    placeBlossoms(budSlots, budInst, {
      axis: 'Y', upMix: 1.05, stemLo: 0.001, stemHi: 0.006, scale: [0.55, 0.75],
      cluster: [2, 3], clusterOff: 0.009,   // 贴面：环半径 = 枝半径 + 9mm（2026-10-09 三轮）
      /* ⚠️ 花苞色（2026-10-09 三轮 · 老黄："花苞的颜色也要再加深，现在看起来已经偏白色了"）：
         旧式 `lerp(flB, R2()*0.45)` 只往深端走 45%（基本停在浅端）+ **提亮 L +0.02~0.10**
         ⇒ 在浅端本身就是近白奶油色时，花苞当然读成白色（腊梅那边尤其明显）。
         改为：往深端走 **0.35~0.75**（更靠蜡黄）+ 明度**不再提亮**（-0.04~+0.02）、
         饱和度提一点 ⇒ 花苞是"比盛开的花更沉一点的蜡黄小圆球"。 */
      color: () => flA.clone().lerp(flB, 0.35 + R2() * 0.40)
        .offsetHSL(rr2(-0.02, 0.02), rr2(0.04, 0.12), rr2(-0.04, 0.02)),
    });
    budMeshes.push(budInst);
  }

  /* ⚠️ 梅（opts.noFruit）**不挂桃**：株形骨相可以借桃的骨架，果实不能借 ——
     一棵"梅树"上挂着蜜桃是硬伤。整块跳过（该函数只用私有随机流 rr2/R2，
     跳过不会影响全局布局流，也不会影响别的树）。 */
  if (!opts.noFruit){
  /* ── 果：夏结秋疏。桃的果实着生在短枝上，果柄短、稍下垂（果尖＝花端朝外下方）。
     果量 130（旧 80 上限实测只挂到 64）。 */
  const frGeo = makePeachFruitGeo();
  const frN = 130;
  const frInst = new THREE.InstancedMesh(frGeo, MAT.peachFruit, frN);
  const frA = new THREE.Color(0xF2B36A), frB = new THREE.Color(0xD9635A);

  const frRaw = [];
  for (const tw of twigs){
    const n = 1 + (i2(2));                 // 每条小枝 1~2 个
    for (let k = 0; k < n; k++){
      const t = rr2(0.25, 0.90);
      frRaw.push({ p: tw.getPointAt(t), tan: tw.getTangentAt(t).normalize() });
    }
  }
  for (const br of mainBranches){                    // 主枝中段也留几个
    for (let k = 0; k < 3; k++){
      const t = rr2(0.45, 0.85);
      frRaw.push({ p: br.getPointAt(t), tan: br.getTangentAt(t).normalize() });
    }
  }
  fillTo(frRaw, frN, twigPool);
  const frSlots = spread(frRaw).slice(0, frN);

  for (let i = 0; i < frSlots.length; i++){
    const o = frSlots[i];
    const lat = aroundAxis(o.tan, i * 2.39996 + rr2(-0.60, 0.60));
    const fruitDir = lat.clone().addScaledVector(_up, -0.85).normalize();
    _q.setFromUnitVectors(_up, fruitDir);          // 果几何 +Y（果尖）朝外下方
    _q.multiply(_q2.setFromAxisAngle(_up, rr2(0, TAU)));
    _p.copy(o.p).addScaledVector(fruitDir, 0.015);  // 果柄
    _s.set(rr2(0.85, 1.15), rr2(0.90, 1.10), rr2(0.85, 1.15));
    _m.compose(_p, _q, _s); frInst.setMatrixAt(i, _m);
    frInst.setColorAt(i, frA.clone().lerp(frB, rr2(0.30, 0.90))
      .offsetHSL(rr2(-0.02,0.02), rr2(0,0.05), rr2(-0.04,0.03)));
  }
  frInst.count = frN;
  frInst.instanceMatrix.needsUpdate = true;
  if (frInst.instanceColor) frInst.instanceColor.needsUpdate = true;
  g.add(frInst);
  }

  /* ⚠️ 梅（opts.noFruit）也**不撒桃瓣**：地面那层粉瓣是"桃的落花"，梅的落花另有颜色与时机
     （而且冬天落花会被积雪盖住、做了也看不见）。同样是整块跳过。 */
  if (!opts.noFruit){
  /* 落花铺地（春末夏初 · 树干四周散一层粉瓣）260 片。
     槽位先算好再打散：春季 peachPetalShow=0.3 / 夏 0.45 是 12-env 按 count 截**前缀**的，
     不打散就会"花瓣只落在一个扇形里"。 */
  const petalGeo = new THREE.PlaneGeometry(0.075, 0.11);
  const petalN = 260;
  const petalInst = new THREE.InstancedMesh(petalGeo, MAT.peachPetal, petalN);
  const pcA = new THREE.Color(0xF7C7D4), pcB = new THREE.Color(0xE796AE);
  const petalRaw = [];
  for (let i = 0; i < petalN; i++){
    petalRaw.push({ a: rr2(0, TAU), d: R * rr2(0.15, 0.95),
                    y: rr2(0.012, 0.05), ry: rr2(0, TAU), rx: rr2(-0.4, 0.4), s: rr2(0.7, 1.4) });
  }
  spread(petalRaw).forEach((o, i) => {
    _p.set(Math.cos(o.a) * o.d, o.y, Math.sin(o.a) * o.d);
    _q.setFromEuler(_e.set(Math.PI / 2, o.ry, o.rx));
    _s.setScalar(o.s);
    _m.compose(_p, _q, _s); petalInst.setMatrixAt(i, _m);
    petalInst.setColorAt(i, pcA.clone().lerp(pcB, R2()));
  });
  petalInst.count = petalN;
  petalInst.instanceMatrix.needsUpdate = true;
  if (petalInst.instanceColor) petalInst.instanceColor.needsUpdate = true;
  g.add(petalInst);
  }

  g.userData.peachTree = true;
  return g;
}

/* ══ 梅（2026-10-06 · 老黄："院内布景是否也讲究梅兰竹菊…在院子里加两株梅花，一株腊梅一株红梅，
      给冬天增加一点色彩，特别是'银装素裹'的场景下就会显得非常有生机"）═════════════════
   做法：**借桃的骨架、换花**。梅与桃是蔷薇科同族小乔木，都是"先花后叶、花缀满枝"，
   低分叉杯状骨架 + 花沿小枝簇生这套形制完全通用；差别只在花色、花期与"不挂果"。
   ⇒ 调用 makePeachTree 并传 opts：
      · blossomMat = MAT.plumBlossomRed / plumBlossomYellow（红梅 / 腊梅）；
      · flowerN 2000（梅比桃疏，"疏影横斜"，太满读成桃）；
      · 花色区间偏"单色深浅"而不是桃那种粉白渐变（红梅=胭脂→水红，腊梅=蜡黄→浅黄）；
      · noFruit = true（不挂桃、不撒桃瓣）。
   花期由季节通道 plumBlossomShow 控制（冬 1.0 / 春 0.55 / 秋 0.15 / 夏 0）——
   ⚠️ 冬 1.0 是这条需求的全部意义：**"银装素裹"里唯一的彩色**。
   ⚠️ 梅的骨相（主干/主枝/小枝）照旧进 mergeStatics（冬天叶落也不消失 ⇒ "疏影横斜"的枝条在）。
   位置由调用方给（见 08-assemble 的梅树落点，那里有射线实测的说明）。 */
export function makePlumTree(x, z, scale = 1, baseY = 0, kind = 'red'){
  const red = kind !== 'yellow';
  return makePeachTree(x, z, scale, baseY, {
    noFruit: true,
    blossomMat: red ? MAT.plumBlossomRed : MAT.plumBlossomYellow,
    /* ⚠️ 花型换掉（老黄："红梅的花型也不对"）：用 makePlumFlowerGeo ——
       大而平展的五瓣 + 明显花蕊（桃是深碗小瓣，两者远看不再是一回事）。 */
    flowerGeo: makePlumFlowerGeo(),
    /* ⚠️⚠️ 朵数沿革：5000 → 1200 → 800 → 1500 → 700 → **320**（2026-10-08 第三轮收口）。
       前几轮都在"加朵数"，老黄 2026-10-08 指出真问题是**形态**："梅花开出来紫藤这种花的效果，
       现实中的梅花不是这种密集型开放…把枝条数量和分叉再增加，每条枝条和分叉上的花苞和花朵
       如截图所示"。
       量出来的硬约束（两轮实测）：本项目单朵花是**夸张尺寸**。要让"花-枝比例"像真实梅
       （参考图：覆盖率约三成、花间有裸枝），在 2.7m 冠幅上只需 ~200~350 朵；
       朵数一多，花必然互相叠（700 朵时冠心仍连成红块、1420/1500 朵时最近邻只有 0.19 倍花径）。
       ⇒ 取 **320 朵**（≈ 冠部投影三成覆盖 ⇒ 疏枝点花）+ **枝条网络 1700+ 根**
         （繁茂感来自枝，不来自花量）+ **远处按距离放大 2.6 倍**保住"看得见花色"。
       ⚠️ 这个数只吃本函数的**私有流**（rr2/R2/i2）—— `makePeachTree` 函数体内**零**全局
         `rr()/rnd()/Math.random`（已核）⇒ 改朵数**不会**动全园布局；但它会改这株梅的实例条数
         ⇒ layout-fingerprint 需要**重出基线**（这是有意的布局变更，不是漂）。 */
    /* ⚠️ 朵数（2026-10-09 四轮 · 实测驱动）：上一版 800 簇心 ÷ 约 700 根枝 = **1.1 簇/枝**，
       而参考图的节距是 1~1.5 花径（0.10~0.15m）、一根 0.3~0.6m 的枝上应落 2~5 簇 ——
       多模态看整树图判读"花聚成中间一个球、外围长枝秃"（实测花确实都在枝上：平均离枝
       3.0cm、只有 4.4% 超 5cm ⇒ 不是位置 bug，是**每枝簇数太少**）。
       ⇒ 翻到 **1600**（≈2.3 簇/枝）。腾预算的手段是**精简花几何**（见三个 makeXxxGeo：
       单朵 162→62 tri、单苞 724→约 340 tri）⇒ 朵数翻倍而总三角形几乎不变。
       ⚠️ 这个数只吃本函数的**私有流**（rr2/R2/i2）—— `makePeachTree` 函数体内**零**全局
         `rr()/rnd()/Math.random`（已核）⇒ 改朵数**不会**动全园布局；但它会改这株梅的实例条数
         ⇒ layout-fingerprint 需要**重出基线**（这是有意的布局变更，不是漂）。 */
    flowerN: 1600,
    /* ⚠️ 树形与桃**反着调**（老黄："远看会觉得就是同一种树，这个肯定不对"）：
       桃 = 矮胖圆球（H≈4.2、冠幅 1.25H、叶满）；梅 = 高挑疏朗（H×1.35、冠幅 **0.85H**、
       叶量 **0.65**）⇒ 梅的暗色枝干骨架露出来，正是"疏影横斜"，远看轮廓也完全不同。
       ⚠️ twigMul / subTwig（2026-10-08）：梅要**更多枝条与分叉**承载"每条枝上点几朵花"，
       否则花只能堆在少数枝上、读成紫藤。桃不传这两个键 ⇒ 桃树逐字不变。 */
    heightMul: 1.35, canopyMul: 0.85, branchMul: 1.30, leafMul: 0.65,
    twigMul: 2.2, subTwig: true, longTwig: true, flowerOutwardOnly: true,
    /* ── 三种状态的比例（2026-10-08 老黄："总归有 60% 左右的花、30% 左右的苞（嫩黄色）、
          还有 10% 左右是开始凋谢的花（花苞枯黄），按这个比例来重新修改两株梅花的造型"）──
       槽位总数仍 320（`flowerN`）：30% 分给花苞（独立几何/材质），其余 70% 里再切 1/7
       （= 全树 10%）做凋谢。⇒ 实际 60% 盛开 / 30% 花苞 / 10% 凋谢。 */
    budFrac: 0.30, witherFrac: 0.10, budMat: MAT.plumBud, blossomCluster: true,
    /* 凋谢色（每株一色）：腊梅的枯花是**枯黄**、红梅的枯花是**枯褐红** ——
       都往"褪色发暗"那一头压，与盛开的花一眼分得开。
       ⚠️ 腊梅这头跟着"调黄"一起走：0xA8842E（偏褐金）→ 0xBBA52E（枯黄偏绿）。 */
    witherColor: new THREE.Color(red ? 0x8A5238 : 0xBBA52E),
    /* 干/枝与叶也各换一份材质：梅的树皮更冷更暗（灰褐），叶更墨绿 —— 远看的整体色调就分开了。 */
    trunkMat: MAT.plumTrunk, leafMat: MAT.plumLeaf,
    /* 花色（老黄三连："腊梅是淡黄色到黄色"、"再黄一些，感觉有点偏金色"、
       2026-10-09 三轮："腊梅花黄色还是不够正，颜色再调得蜡黄"）：
       红梅 = 暖胭脂 → 正红（压掉蓝通道，避免"紫红/暗粉"）；
       腊梅 = **蜡黄**（蜂蜡那种略带暖调、饱和的黄）：浅端 0xFFF8C8（近白奶油 → 就是
       "花苞看起来偏白"的根源之一）换成 **0xFFE566**、深端 0xFFDD22 → **0xE0A800**
       （更沉、更"蜡"；纯 0xFFDD22 偏亮偏薄，在雪地里读作淡黄）。
       冬季预设会降饱和 0.70 + 冷色调 ⇒ 底色必须比目标色更饱和一档。 */
    blossomA: new THREE.Color(red ? 0xFF7A6E : 0xFFE566),
    blossomB: new THREE.Color(red ? 0xDC1220 : 0xE0A800),
  });
}

/* ══ 廊下兰草（2026-10-06 · 老黄："在廊下补一小丛兰草（或盆栽兰）"）═════════════════════
   凑"梅兰竹菊"的最后一笔。取"**盆栽兰**"（廊下本来就有缸/盆一类陈设，最省事也最不出错）：
     · 花盆：两级陶盆 + 口沿圈（深陶色）；
     · 叶：复用 `makeReedBladeGeo()` —— 它本来就是"根部直立、梢部外弯"的弧叶，正是兰叶的形；
       9 片绕心放射，朝向/长度/倾角全部吃**本函数私有流**（不动全局 rnd/rr，铁律 1）；
     · 花葶：3 根细杆挑出盆沿、顶端各 2~3 朵米黄小花（远看就是"兰开花了"）。
   开销：1 个 InstancedMesh（叶）+ 一小组普通 Mesh，只多一次提交级别的成本。
   ⚠️ 落点高度必须由调用方按**实测地表**给（见 08 的注释）：廊下是台基/铺装，不是地形，
     用 groundHeight 会把盆陷进台基里。 */
export function makeOrchidPot(x, z, baseY = 0){
  const g = new THREE.Group();
  g.position.set(x, baseY, z);
  const R3 = mulberry32(((Math.round(x * 1000) * 2654435761) ^ (Math.round(z * 1000) * 40503)) >>> 0);
  const potLow = mesh(new THREE.CylinderGeometry(0.115, 0.095, 0.075, 12), MAT.stoneDark, { name:'orchidPotLow', cast:true });
  potLow.position.y = 0.0375; g.add(potLow);
  const potUp  = mesh(new THREE.CylinderGeometry(0.135, 0.115, 0.085, 12), MAT.stoneDark, { name:'orchidPotUp', cast:true });
  potUp.position.y = 0.1175; g.add(potUp);
  const potRim = mesh(new THREE.CylinderGeometry(0.146, 0.140, 0.022, 12), MAT.stoneDark, { name:'orchidPotRim', cast:true });
  potRim.position.y = 0.168; g.add(potRim);
  const leafGeo = makeReedBladeGeo(0.52);
  const leaves = new THREE.InstancedMesh(leafGeo, MAT.reed, 9);
  const lq = new THREE.Quaternion(), lq2 = new THREE.Quaternion(), lp = new THREE.Vector3(),
        ls = new THREE.Vector3(), lm = new THREE.Matrix4(), AY = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 9; i++){
    const a = (i / 9) * TAU + R3() * 0.5;
    const lean = 0.20 + R3() * 0.22;
    lp.set(Math.cos(a) * 0.05, 0.155, Math.sin(a) * 0.05);
    lq.setFromAxisAngle(AY, -a);
    lq2.setFromAxisAngle(AX, lean);
    lq.multiply(lq2);
    ls.setScalar(0.85 + R3() * 0.5);
    lm.compose(lp, lq, ls); leaves.setMatrixAt(i, lm);
  }
  leaves.instanceMatrix.needsUpdate = true;
  leaves.castShadow = false; leaves.receiveShadow = true;
  g.add(leaves);
  /* 花葶复用腊梅的米黄瓣材质（同为淡黄小花，省一份材质；它已在 SEASON_PRESENCE 里，
     冬天 plumBlossomShow=1 时兰也在开 —— 与兰的花期（冬春）正好一致）。 */
  for (let k = 0; k < 3; k++){
    const a = 0.7 + k * 2.1 + R3() * 0.4, lean = 0.16 + R3() * 0.18, h = 0.44 + R3() * 0.16;
    const stem = mesh(new THREE.CylinderGeometry(0.006, 0.009, h, 5), MAT.reed, { name:'orchidStem', cast:false });
    stem.position.set(Math.cos(a) * 0.05, 0.16 + h / 2, Math.sin(a) * 0.05);
    stem.rotation.set(lean * Math.sin(a), 0, -lean * Math.cos(a));
    g.add(stem);
    for (let j = 0; j < 3; j++){
      const f = mesh(new THREE.SphereGeometry(0.022, 7, 6), MAT.plumBlossomYellow, { name:'orchidFlower', cast:false });
      f.position.set(stem.position.x * (1 + j * 0.5), 0.16 + h * (0.72 + j * 0.12), stem.position.z * (1 + j * 0.5));
      g.add(f);
    }
  }
  return g;
}

/* 芭蕉果串（重建）：真实香蕉束 —— 冠部斜出的粗果轴 + 5 圈"把"（hand），每圈一圈
   新月形蕉指（指根朝上、凹面内扣贴轴、五棱截面），束末一颗紫红花苞。
   旧版是"8 根直柱子围一根芯"—— 与真实果串毫无关系（用户原话："香蕉长什么样你比我更清楚"）。
   蕉指 = 圆环弧管 InstancedMesh + instanceColor 青→黄（上圈更熟下圈更生）。 */
function makeBananaFruit(x, y, z){
  const g = new THREE.Group();
  g.position.set(x, y, z);

  /* 果梗 peduncle（2026-10-08 · 扫图定性"果串像糊在干上"）：真实芭蕉的花序从**冠心**
     抽出、向外弧弯后垂下果串 —— 旧版只有果串自己的短果轴、没有"冠心→挂点"这一段，
     远看果串就贴在假茎上（多模态原话"像粘在树腰上"）。局部坐标：挂点在 (0,0,0)、
     冠心在 −z 方向 0.44（对上 makeBananaPlant 的挂点 z=+0.44）。 */
  /* 果梗 peduncle（2026-10-09 二轮 · 老黄："挂果实的枝条再向下垂一些效果可能更好"）：
     把弧顶压低、下弯段提前 —— 果串从冠心抽出后更明显地**垂挂**而非平伸。 */
  const pedCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.06, -0.44),   // 冠心（假茎顶端）
    new THREE.Vector3(0, 0.08, -0.30),   // 微拱即收（旧 0.13 → 0.08，弧顶压低）
    new THREE.Vector3(0, 0.02, -0.15),   // 提前下弯（旧 0.10 → 0.02）
    new THREE.Vector3(0, -0.05, 0),       // 挂点已在冠心下方（旧 0 → -0.05）
  ]);
  g.add(mesh(new THREE.TubeGeometry(pedCurve, 10, 0.024, 5, false), MAT.bambooB, { name:'fruitPeduncle', cast:false }));

  // 果轴：自挂点斜出再垂下（真实蕉束都从冠里斜着扎出来）
  const stalkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.05, -0.09, 0.02),
    new THREE.Vector3(0.025, -0.27, 0.01),
    new THREE.Vector3(0, -0.45, 0),
  ]);
  g.add(mesh(new THREE.TubeGeometry(stalkCurve, 10, 0.030, 6, false), MAT.bambooB, { name:'fruitStalk', cast:false }));

  // 蕉指几何：环弧段（弧长 ≈14cm、管径 2cm、5 棱 —— 真实香蕉截面正是五棱）。
  // 平移使弧起点落在原点：指根在原点、指尖向 +Y 上弯、凹面朝 −X（实例时 −X 对轴心）。
  const fGeo = new THREE.TorusGeometry(0.11, 0.020, 5, 7, 1.30);
  fGeo.translate(-0.11, 0, 0);

  const hands = [11, 10, 9, 7, 5];                    // 每圈指数：上密下疏（真实束形收势）
  const ripeC = new THREE.Color(0xE0CC58), greenC = new THREE.Color(0x8FAF52);
  const fingers = [];
  for (let hi = 0; hi < hands.length; hi++){
    const kTier = hi / (hands.length - 1);
    const tp = stalkCurve.getPoint(0.22 + 0.78 * kTier);
    const ringR = 0.062 - 0.026 * kTier;              // 圈径向束末渐收
    const lenS = 1.0 - 0.34 * kTier;                  // 指长向束末渐短
    for (let k = 0; k < hands[hi]; k++){
      const a = (k / hands[hi]) * TAU + hi * 0.35 + rr(-0.08, 0.08);   // 层间错角
      fingers.push({
        x: tp.x + Math.cos(a) * ringR, y: tp.y, z: tp.z + Math.sin(a) * ringR,
        yaw: a, rx: rr(-0.10, 0.10), rz: rr(-0.10, 0.10),
        s: lenS * rr(0.88, 1.14),
        c: ripeC.clone().lerp(greenC, kTier).offsetHSL(rr(-0.01, 0.01), rr(-0.05, 0.03), rr(-0.03, 0.03)),
      });
    }
  }
  const inst = new THREE.InstancedMesh(fGeo, MAT.bananaFruit, fingers.length);
  inst.castShadow = false;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
  fingers.forEach((f, i)=>{
    p.set(f.x, f.y, f.z);
    q.setFromEuler(new THREE.Euler(f.rx, f.yaw, f.rz));
    sv.setScalar(f.s);
    m.compose(p, q, sv); inst.setMatrixAt(i, m);
    inst.setColorAt(i, f.c);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  g.add(inst);

  // 束末花苞：紫红卵形蕉蕾
  const bud = mesh(new THREE.SphereGeometry(0.035, 9, 7), MAT.bananaBud, { name:'fruitBud', cast:false });
  bud.scale.set(0.78, 1.45, 0.78);
  const tip = stalkCurve.getPoint(1);
  bud.position.set(tip.x, tip.y - 0.055, tip.z);
  g.add(bud);
  return g;
}

/* 芭蕉：高假茎（叶鞘包裹）+ 顶部叶片（GLB 模型）+ 可选蕉果 */
/* ══ 芭蕉叶片·程序化替身（2026-09-27 · 用户拍板：替身必须"像那棵树"）══════════
   触发条件：`assets/BananaPlant.glb` 下载/解码失败。它在预载清单里是 **required:false**，
   所以失败不会阻断开园 —— 但**什么都不做的话会留下一根 3.6m 高的光杆**（假茎在，
   冠层空），比"没有芭蕉"更难看：用户看到的是一排电线杆。
   所以这里补一棵**真的叶片**。
   ── 为什么要单独写，而不是复用 makeReedBladeGeo ──────────────────────────────
   芦苇叶是**窄、直、挺**的（半宽 0.045m，7 段），芭蕉叶是**宽、垂、有主脉**的
   （半宽 ~0.42m）。直接拿芦苇叶当替身会得到"一根 3.6m 的细草"，形态完全不对 ——
   替身的第一要求是**远看认得出那是什么**，不是"有个绿色的东西"。
   ── 形态 ──────────────────────────────────────────────────────────────────
   芭蕉叶是**掌状**：一片大叶从假茎顶端伸出，叶柄直立一小段，然后叶面**向外下垂**。
   这里按 3~4 片扇形排开，每片：叶柄（细圆柱，略带倾角）+ 叶身（自定义 BufferGeometry，
   沿叶长 8 段，宽度按 sin 形起落 → 中段最宽、叶尖收成点、叶基收成柄）。
   叶身分两半（左右各带一点下垂）用**沿脊的 V 折**近似主脉：这是让平片叶子
   在侧光下"读得出叶脉"的关键，纯平面看起来像塑料布。
   ⚠️ 走 CFG.rnd（00-config 的全局唯一实例），绝不用共享 Math.random（铁律 1）。 */
function makeBananaLeafGeo(len = 2.1, wid = 0.82, seg = 8, droop = 0.55){
  const verts = [], idx = [], uvs = [];
  for (let i = 0; i <= seg; i++){
    const t = i / seg;                       // 0 = 叶基(接柄) → 1 = 叶尖
    /* 宽度包络：叶基 ~0.18 宽 → 中段最宽 → 叶尖收成 0。用 sin^0.7 让"最宽处"略偏叶基，
       符合芭蕉叶的实际轮廓（基部窄、中前段最宽、尾端急收）。 */
    const env = Math.pow(Math.sin(Math.pow(t, 0.72) * Math.PI), 0.7);
    const w = wid * 0.5 * (0.18 + 0.82 * env);
    /* 沿叶长的下垂：前 25% 还是直的（叶柄段），之后按 (t-0.25)^1.6 加速往下弯。
       指数 >1 是关键：线性下垂会像挂面条，指数下垂才像被自重压弯的阔叶。 */
    const bend = t < 0.25 ? 0 : Math.pow((t - 0.25) / 0.75, 1.6) * droop * len;
    const y = len * t - bend;
    /* V 折主脉：中心比两侧高一点（沿叶长逐渐加强），侧光下才有叶脉的明暗。 */
    const keel = 0.055 * wid * Math.sin(t * Math.PI);
    verts.push(-w, y, -keel,  0, y + keel, 0,  w, y, -keel);
    uvs.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < seg; i++){
    const a = i * 3, b = a + 3;
    idx.push(a, b, a + 1,  a + 1, b, b + 1);      // 左半
    idx.push(a + 1, b + 1, a + 2,  a + 2, b + 1, b + 2);  // 右半
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* 冠层替身：假茎顶端扇形排 3~4 片大叶。锚点 y=0（贴在 holder 上）。
   ⚠️ 与 GLB 路径的差别：GLB 走 loadAssetOnce 的"底部对齐"再由外层 holder 上移，
   替身**直接就是底部对齐**，所以调用方给的 holder.position.y 就是叶基高度。
   ⚠️⚠️ **随机源必须独立**（铁律 1 + 布局指纹铁律）：这里**绝不能**吃共享 `rnd()`。
   芭蕉替身只在"资产失败"时触发 —— 也就是它的调用次数**取决于网络**。
   吃共享流的话，失败一次就把整园后续所有 rr()/rnd() 抽样整体后移，
   layout-fingerprint 基线当场漂移（正是 L564 那条禁令治的病）。
   改用 `mulberry32(BANANA_SEED + 株高)` 派生的独立流：同样可复现，且与布局流正交。 */
const BANANA_SEED = 0x5A1A6A;
export function makeBananaLeafCrown(leafScale = 1.0, trunkH = 2.8){
  const crown = new THREE.Group();
  const brnd = mulberry32(BANANA_SEED + Math.round(trunkH * 1000));
  const n = 3 + Math.floor(brnd() * 2);        // 3 或 4 片
  for (let i = 0; i < n; i++){
    const len = (1.75 + brnd() * 0.75) * leafScale;
    const wid = (0.70 + brnd() * 0.30) * leafScale;
    const leaf = new THREE.Mesh(
      makeBananaLeafGeo(len, wid, 8, 0.5 + brnd() * 0.2),
      MAT.banana);                                 // 假茎/叶片同材质 → 顺带被假茎的风场带着走
    /* 扇形排布：绕 Y 均匀铺开，pitch 越大越水平（芭蕉老叶接近水平外伸），
       第 0 片稍微立一点当"新叶"（用户常识：芭蕉心叶是竖着卷起来的）。 */
    const yaw = i / n * TAU + brnd() * 0.28;
    const pitch = (i === 0 ? -0.42 : 0.16 + brnd() * 0.34);
    leaf.rotation.set(pitch, yaw, (brnd() - 0.5) * 0.22, 'YXZ');
    leaf.castShadow = true; leaf.receiveShadow = true;
    leaf.userData.noMerge = true;                  // 异步挂载 ⇒ 不参与几何合并
    crown.add(leaf);
  }
  /* 替身也标一下，方便探针/门禁区分"GLB 来的"与"程序化来的" */
  crown.userData.substitute = 'banana-leaf';
  return crown;
}

/* 芭蕉叶片 URL 常量：预载清单与替身钩子都要用它 —— 写成字面量会出现两处不同拼写，
   而替身钩子靠**字符串相等**匹配，错一个字符 ⇒ 替身永远不触发（静默失效，
   正好是这一段要治的病）。 */
const BANANA_URL = 'assets/BananaPlant.glb';

export function makeBananaPlant(x, z, trunkH = 2.8, leafScale = 1.0, withFruit = false, ry = 0){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  /* ⚠️ 假茎与叶鞘必须留在植株组里、并且**不参与全局合并**：
     mergeStatics 会按材质把它们搬到世界级的 mergedStatic 上，于是冬季 applyGLBSeason
     缩放植株组时只缩到 GLB 叶片，假茎/叶鞘/蕉果保持原尺寸 ——
     看起来就是"小叶簇顶在一根全尺寸杆上 + 一颗全尺寸蕉果"。
     为了不把 draw call 摊开，先把"假茎 + 6 圈叶鞘"在植株内部合成**一个**几何体
     （每株 +1 个网格），再打上 noMerge。 */
  const trunkParts = [];
  {
    const tg = new THREE.CylinderGeometry(0.13, 0.16, trunkH, 9);
    tg.translate(0, trunkH / 2, 0);
    trunkParts.push(tg);
    const sg = new THREE.CylinderGeometry(0.145, 0.175, 0.13, 9);
    for (let i = 0; i < 6; i++){
      const c = sg.clone();
      const k = 1 - i * 0.045;
      c.scale(k, 1, k);
      c.translate(0, trunkH * (0.1 + i * 0.17), 0);
      trunkParts.push(c);
    }
  }
  const trunk = mesh(mergeGeometries(trunkParts, false), MAT.banana, { name:'bananaTrunk' });
  trunk.userData.noMerge = true;
  g.add(trunk);
  /* 冠层组（叶 GLB + 果）：芭蕉是多年生草本 —— 冬季地上部枯萎但**假茎宿存**，
     所以随季节缩放/隐藏的是冠层组，假茎永远全尺寸留在原地（第九轮用户常识反馈：
     旧版整株缩到 12% = 把多年生当一年生）。applyGLBSeason 通过 userData.crown 找到它。 */
  const crown = new THREE.Group();
  g.add(crown);
  // 顶部叶片（GLB，随假茎高度上移）
  /* ⚠️ **失败必须补替身**（2026-09-27）：BananaPlant.glb 在预载清单里是 required:false，
     失败不阻断开园 —— 但冠层空着就只剩一根 trunkH 高的**光杆**（默认 2.8m，
     高配档 3.6m），一排"电线杆"比没有芭蕉更难看。
     判据必须**先断言前提**再分支（铁律 4）：这里断的是
       ① 替身确实是"叶片"而不是空 group（crown.children.length > 0）；
       ② 替身叶片数量与 GLB 冠层同一量级（3~4 片），不是 1 片充数；
       ③ 替身挂在 crown 上（跟着季节缩放/隐藏），不是散落在 g 上。
     挂在 crown 而不是 g：applyGLBSeason 靠 userData.crown 找冠层，
     挂错地方 ⇒ 冬季整株被缩到 12%，把多年生当一年生（第九轮的老教训）。 */
  const attachLeaf = (obj) => {
    const holder = new THREE.Group();
    holder.position.y = trunkH - 0.25;
    holder.add(obj);
    crown.add(holder);
    HOOKS.onAssetAttached?.();
  };
  let bananaLeafOk = false;
  loadAssetOnce('assets/BananaPlant.glb', 3.8 * leafScale, (src)=>{
    bananaLeafOk = true;    /* ⚠️ 同 placeAssets：摆放要放外层 holder。直接写 c.position.y 会**覆盖**
       loadAssetOnce 写的"底部对齐"偏移（B08 的同一处病，只是换了个调用点）。 */
    const leaf = src.clone(true);
    /* ── 叶片进风场（2026-09-17 用户："芭蕉树应该是叶子晃动，现在的晃动有问题"）──
       GLB 叶片是**异步**挂载：它在 mergeStatics 之后才进场景，因此逃过了几何合并，
       但材质也仍是 GLB 自带的 —— 从来没登记进风场表，狂风里叶子纹丝不动。
       之前"动"的其实是假茎，而且 crown 模式把根部权重算成最大，于是整根假茎从土里
       开始钟摆式甩动。动错了对象 + 权重反了，两个 bug 叠在一起。
       这里给每株**克隆一份材质**再注入：必须克隆，因为 8 株的栽植高度 trunkH 各不相同，
       而 tip 模式的基准高度是写进 shader 的常量 —— 共享材质只能取一个值。
       tip 模式锚在叶片根部（trunkH-0.25）：叶柄几乎不动、叶尖按高度逐渐加大摆幅，
       正是"芭蕉大叶被风掀起又落下"的样子。
       ── 幅度两轮定标（2026-09-17）──
       第一轮 amp 0.13：反算 ampEff = 0.13 × wt(叶尖 1.52) × storm 乘数 2.26 ≈ 0.45m，
       用户第二轮反馈"夸张到极致了" —— 对 3.8m 叶丛等于把叶尖甩出 12% 株高，是抽搐不是风。
       降到 amp 0.05 → ≈ 0.17m（约 4.5% 株高，读作大叶被风掀起），并补 maxDisp 0.22
       硬上限：反算够不等于永远够，将来 amp 被调大一档也不会破防。 */
    leaf.traverse(o => {
      if (!o.isMesh || !o.material) return;
      o.material = o.material.clone();
      addWind(o.material, 0.05, 1.05, 'tip', trunkH - 0.25, 0.22);
    });
    attachLeaf(leaf);
  });
  /* ⚠️ **不能**用 `loadAssetOnce(...).catch()`：它 fire-and-forget，**没有返回值**
     （实测 L1414 那个 .catch 属于 rawCache 的那条链，不在 loadAssetOnce 的返回上）。
     正确做法是挂 `HOOKS.settleAssetFail` —— 13-preload 在 settleAsset(url,false) 时
     调它，那才是"这个 URL 确实失败了"的唯一权威信号（铁律 4：判据先取权威源）。
     守卫：bananaLeafOk 为真说明已经挂上 GLB 了（缓存命中的同步路径会立刻置真），
     此时若再补替身会出现"两副叶子" ⇒ 必须先断言前提再动手。 */
  const offFail = onAssetFailed(BANANA_URL, () => {
    if (bananaLeafOk) return;
    const sub = makeBananaLeafCrown(leafScale, trunkH);
    sub.traverse(o => {
      if (!o.isMesh) return;
      /* 替身叶片也要进风场，基准高度与 GLB 路径同一锚点（叶基）⇒ 风和真叶一致。 */
      o.material = o.material.clone();
      addWind(o.material, 0.05, 1.05, 'tip', trunkH - 0.25, 0.22);
    });
    attachLeaf(sub);
  });
  if (offFail) g.userData.__bananaOffFail = offFail;
  // 蕉果：从冠侧弧出后垂挂（2026-10-08：挂点外推 0.26→0.44、抬高 0.15→0.05 ——
  // 旧值离干太近，果串贴在假茎上读作"粘上去的"；配合 makeBananaFruit 里新加的果梗，
  // 现在是"冠心抽梗、弧出、垂串"的完整形态）
  if (withFruit){
    const fr = makeBananaFruit(0, trunkH - 0.05, 0.44);
    fr.traverse(o => { if (o.isMesh) o.userData.noMerge = true; });   // 同上：要跟着冠层缩放
    crown.add(fr);
  }
  g.userData.crown = crown;
  return g;
}

/* 莲蓬与荷池生态（重建）：单株 = S 弯茎 + 微倾莲房（黄金角 17 籽孔）+ 邻位浮叶 2~3 片
   + 随机伴生荷花/花蕾。旧版"一根直杆+绿点"被用户判"孤零零、脱离生态"。
   籽孔特征 = 明暗对比：每籽一盏深橄榄"凹窝"（暗杯）+ 浅色微凸莲子，
   莲房顶面的孔洞结构在岸边视距就可读；三成老蓬走黄褐材质。 */
export function makeLotusPod(x, z, h = 0.85){
  const g = new THREE.Group();
  g.position.set(x, CFG.water, z);

  // S 弯茎：自水里带自然倾侧（第二验收轮：偏移量 ×1.7 —— 20cm 才能在岸边读出弯）
  const bend = rr(-0.20, 0.20), lean = rr(-0.16, 0.16);
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.10, 0),
    new THREE.Vector3(bend * 0.4, h * 0.36, lean * 0.4),
    new THREE.Vector3(bend * 0.9, h * 0.72, lean * 0.9),
    new THREE.Vector3(bend, h, lean),
  ]);
  g.add(mesh(new THREE.TubeGeometry(stemCurve, 8, 0.016, 6, false), MAT.lily, { name:'podStem' }));

  // 莲房头（第十一轮：**强倾**——旧版只倾 7°，岸边看到的永远是椭球侧面、
  // 籽孔面朝天不可读，用户蓝框判"光秃秃小圆球看不出来是莲蓬"。
  // 真实花谢后的莲蓬穗轴大幅弯垂，莲房面朝斜下方/侧方 30~60°；
  // 倾向带随机方位角，但整体偏向南岸（观众侧），籽孔面朝观众可读）。
  const tilt = rr(0.5, 1.0), tiltAz = rr(-0.5, 0.5);
  const head = new THREE.Group();
  head.position.set(bend, h, lean);
  head.rotation.set(tilt * Math.cos(tiltAz), rr(0, TAU), tilt * Math.sin(tiltAz) * -1);
  g.add(head);

  const R = 0.070;                                   // 莲房半径 7cm → 直径 14cm（第二验收轮 +12%：花/蓬尺度上调）
  const houseMat = jr() < 0.32 ? MAT.lotusPodAged : MAT.lotusPod;
  const house = mesh(new THREE.SphereGeometry(R, 14, 9), houseMat, { name:'podHouse' });
  house.scale.set(1, 0.60, 1);                      // 压扁的莲房
  head.add(house);
  const face = mesh(new THREE.CylinderGeometry(R*0.78, R*0.78, 0.007, 14), houseMat, { name:'podFace' });
  face.position.y = R * 0.34;                       // 顶面近乎平
  head.add(face);

  /* 籽孔（第二验收轮：17 籽×小杯在 2m 外只有 4~5px，"靠数量堆不出结构感"）——
     改为 9 籽 × 大杯大籽：1 中心 + 8 环位，凹窝 2.5cm、莲子 2.1cm，
     明暗对比（亮蓬面/深窝/浅籽三层）才是 2m 外的读感来源。 */
  const faceY = R * 0.34 + 0.004;
  const cupGeo = new THREE.CylinderGeometry(0.0125, 0.0115, 0.010, 8);
  const seedGeo = new THREE.SphereGeometry(0.0105, 8, 6);
  seedGeo.scale(1, 0.62, 1);                        // 微凸圆顶
  const N_SEED = 9;
  const cupInst = new THREE.InstancedMesh(cupGeo, MAT.lotusPodDark, N_SEED);
  const seedInst = new THREE.InstancedMesh(seedGeo, MAT.lotusSeed, N_SEED);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < N_SEED; i++){
    const rad = i === 0 ? 0 : 0.033;
    const a = i === 0 ? 0 : (i - 1) * (TAU / 8) + 0.22;
    q.identity(); s.set(1, 1, 1);
    p.set(Math.cos(a) * rad, faceY, Math.sin(a) * rad);
    m.compose(p, q, s); cupInst.setMatrixAt(i, m);
    p.y = faceY + 0.0045;
    s.setScalar(rr(0.92, 1.06));
    m.compose(p, q, s); seedInst.setMatrixAt(i, m);
  }
  cupInst.instanceMatrix.needsUpdate = seedInst.instanceMatrix.needsUpdate = true;
  head.add(cupInst, seedInst);

  // ── 生态组合：邻位浮叶 + 伴生荷花/花蕾 ──
  /* ⚠️ 近景水道（2026-09-26）：浮叶**逐片判廊道归属**，廊内的不生成。
     但 **rr()/rnd() 的调用次数与顺序一个字不能动** —— 这是"全局随机流守恒"铁律，
     也是 layout-fingerprint 那道门的前提。所以先把值**全抽完**（照原样），
     再决定要不要 g.add；被跳过的那几次 rr() 照样烧掉，后续抽样一位不差。
     莲蓬头/花/花蕾都高在水面之上、是这片的视觉主体，不在廊道管辖内。 */
  const padGeo = makeLilyPadGeo();
  const nPads = 2 + ((rnd()*2)|0);
  for (let i = 0; i < nPads; i++){
    const a = rr(0, TAU), rad = rr(0.24, 0.52);
    const py = 0.014 + rr(0, 0.004);
    const ry = rr(0, TAU);
    const sc = rr(0.42, 0.68);                      // 0.52~0.84m 叶盘：与 12cm 莲房保持真实比例
    if (corridorRaw(x + Math.cos(a)*rad, z + Math.sin(a)*rad) < 0.35) continue;   // 廊心：让开
    const pad = mesh(padGeo, MAT.lily, { name:'podPad', cast:false, receive:false });
    pad.position.set(Math.cos(a) * rad, py, Math.sin(a) * rad);
    pad.rotation.y = ry;
    pad.scale.set(sc, 1, sc);
    g.add(pad);
  }
  const fr = jr();
  if (fr < 0.55){
    // 伴生荷花：三圈杯瓣（同 makeAquatic 的 ring 手法）+ 短梗
    const fa = rr(0, TAU), fRad = rr(0.30, 0.55);
    const fx = Math.cos(fa) * fRad, fz = Math.sin(fa) * fRad;
    const fh = rr(0.45, 0.8);
    /* 茎顶收到花底内（2026-10-14 同 06j 的修法：旧 +0.06 茎尖戳出花头 5cm）。 */
    const stemH = fh + 0.01;
    const fStem = mesh(new THREE.CylinderGeometry(0.008, 0.013, stemH, 5), MAT.lily, { name:'flowerStem' });
    fStem.position.set(fx, stemH / 2, fz);
    g.add(fStem);
    // 伴花基座补叶（第二验收轮：花基部落水处不裸）
    for (let k = 0; k < 2; k++){
      const pa = rr(0, TAU), prad = rr(0.16, 0.30);
      const ppy = 0.014 + rr(0, 0.004);
      const pry = rr(0, TAU);
      const psc = rr(0.42, 0.62);
      if (corridorRaw(x + fx + Math.cos(pa)*prad, z + fz + Math.sin(pa)*prad) < 0.35) continue;  // 同上：等量燃烧
      const pad = mesh(padGeo, MAT.lily, { name:'podPad', cast:false, receive:false });
      pad.position.set(fx + Math.cos(pa) * prad, ppy, fz + Math.sin(pa) * prad);
      pad.rotation.y = pry;
      pad.scale.set(psc, 1, psc);
      g.add(pad);
    }
    const petalGeo = makeLotusPetalGeo();
    const petInst = new THREE.InstancedMesh(petalGeo, MAT.lotus, 18);
    petInst.castShadow = false;
    const pm = new THREE.Matrix4(), pp = new THREE.Vector3(), pq = new THREE.Quaternion(), ps = new THREE.Vector3();
    const qT = new THREE.Quaternion(), qS = new THREE.Quaternion();
    const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
    const sc = rr(0.100, 0.118);                    // 花径 0.24~0.28m（第二验收轮 +12%）
    let slot = 0;
    const ring = (n, tilt, radiusOut, phase) => {
      for (let k = 0; k < n; k++){
        const pa = (k / n) * TAU + phase;
        qT.setFromAxisAngle(AX, -tilt);
        qS.setFromAxisAngle(AY, pa);
        pq.copy(qS).multiply(qT);
        pp.set(fx + Math.cos(pa) * radiusOut * sc, fh, fz + Math.sin(pa) * radiusOut * sc);
        ps.setScalar(sc);
        pm.compose(pp, pq, ps);
        petInst.setMatrixAt(slot++, pm);
      }
    };
    ring(7, 1.16, 0.42, 0);                          // 外圈：摊平外翻
    ring(6, 0.78, 0.30, 0.24);                      // 中圈
    ring(5, 0.38, 0.20, 0.50);                       // 内圈：收拢成杯
    petInst.instanceMatrix.needsUpdate = true;
    g.add(petInst);
  } else if (fr < 0.85){
    // 伴生花蕾：尖卵紧裹、微斜
    const fa = rr(0, TAU), fRad = rr(0.30, 0.5);
    const fx = Math.cos(fa) * fRad, fz = Math.sin(fa) * fRad;
    const fh = rr(0.35, 0.65);
    const bStem = mesh(new THREE.CylinderGeometry(0.007, 0.012, fh + 0.08, 5), MAT.lily, { name:'budStem' });
    bStem.position.set(fx, (fh + 0.08) / 2, fz);
    bStem.rotation.z = fx * 0.06;
    g.add(bStem);
    const bud = mesh(new THREE.SphereGeometry(0.026, 9, 7), MAT.lotus, { name:'lotusBud', cast:false });
    bud.scale.set(1, 1.9, 1);
    bud.position.set(fx, fh + 0.10, fz);
    bud.rotation.z = fx * 0.10;
    g.add(bud);
  }
  return g;
}




export function makeWaterGrass(x, z, n = 60, spread = 3.2){
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const bladeGeo = makeReedBladeGeo(1.5);
  const inst = new THREE.InstancedMesh(bladeGeo, MAT.reed, n);
  inst.castShadow = false;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++){
    p.set(rr(-spread, spread), CFG.water - 0.05, rr(-spread*0.6, spread*0.6));
    q.setFromEuler(new THREE.Euler(rr(-0.3,0.3), rr(0, TAU), rr(-0.3,0.3)));
    s.set(1, rr(0.7, 1.5), 1);
    m.compose(p, q, s); inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  g.add(inst);
  markUnderwater(g);                          // 水草：整株入折射层（实例化网格不参与合并，标记丢不了）
  return g;
}
