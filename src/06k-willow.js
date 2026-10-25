// 06k-willow.js — 由 06i-trees.js 按职责整块搬出（纯搬家，逐字节未改）。
// 柳树：帘状树冠（makeWillowCurtainGeo）+ makeWillow + 变速管工具 tubeRadiusRamp。
// tubeRadiusRamp 被 15-stable 的马尾/柳干共用，故从此处导出。
import { THREE, mergeGeometries } from '../vendor.js';
import { rr, mulberry32, rnd, TAU } from './00-config.js';
import { mesh } from './03-factory.js';
import { MAT } from './01-materials.js';
import { jr } from './06-vegetation.js';
export function makeWillowCurtainGeo(){
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
export function tubeRadiusRamp(geo, path, tubularSegments, radialSegments, radiusAt, opts){
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
