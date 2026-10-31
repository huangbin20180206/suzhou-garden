// 15e-stable.js — 由 15-stable.js 按职责整块搬出（纯搬家，逐字节未改）。
// 马厩本体与院外石板路：
//   · STABLE_ROAD_PTS / makeStableRoad（马厩→园门的花街铺地）
//   · makeStable（台基、硬山瓦顶、隔栏马位、前后院、栅栏、浴马槽等）
// 其余两条线（马、车）分别在上游 15b/15c/15d。
import { THREE, mergeGeometries } from '../vendor.js';
import { mulberry32 } from './00-config.js';
import { pavingNormalTex, registerWeatherRoles, MAT } from './01-materials.js';
import { groundHeight } from './05-water.js';
import { mesh, box, makeColumn, makeLatticePanel } from './03-factory.js';
import { loadAssetOnce } from './06-vegetation.js';
import { ACTIVE_QUALITY, renderer } from './02-scene.js';
import { worldLights } from './12d-lantern.js';
import { markCasterBoxDirty } from './09-lights.js';
import { makeHorse } from './15c-horse-life.js';
import { makeTrough, makeCarriage, prepareTravelCarriage, makeLeadRope, TRAVEL } from './15d-carriage.js';
import { makeSoftAlphaTex } from './15a-shared.js';
/* ── 石板路点表（2026-10-27 复核 B2 改为单份真值）────────────────────────────
   两张表的定义搬到了 15a-shared（15d 马车的贴地判别也要用，原来它手抄了一份 _ROAD_A/
   _ROAD_B，两份不同步就会浮空/陷地）。这里 import 后**转出**——本文件内部（makeStableRoad/
   makeStableExitRoad）与 15-stable 门面/16-actors 的引用路径都不变。 */
import { STABLE_ROAD_PTS, STABLE_EXIT_PTS } from './15a-shared.js';
import { markArtLicense } from './art-license.js';
export { STABLE_ROAD_PTS, STABLE_EXIT_PTS };
/* ── 出园新路（2026-10-25）──────────────────────────────────────────────────
   老黄："客人乘车离开还是在走去院子的石板路，这个不合理，做一条新路，朝向屏幕右下角，
   客人离开从马厩沿这条路离开，当马车走到屏幕边缘就消失，客人来访就反过来就行。"
   ⇒ 从马厩院门 (40,4.2) 起向**东南**铺一条同款花街铺地（默认机位朝北，东南就是屏幕右下），
   一路到 (85,46.8) —— 早出画了，马车在那里隐去，看不到"凭空消失"。
   与进园那条路共用同一个起点（院门），出门口立刻分岔。 */
/* STABLE_EXIT_PTS 定义在 15a-shared（见上），本文件 import 后转出。 */
/* ── 出园新路（2026-10-25）：与 makeStableRoad 同款铺法（垫层 + 三列错缝石板），
   但**不做院门口铺装、不做石灯笼、不做石狮** —— 这条路在墙外几十米外、还朝画面右下方
   一路出画，细节看不成，做了只是白烧 draw call。 */
export function makeStableExitRoad(){
  const g = new THREE.Group();
  g.name = 'stableExitRoad';
  const curve = new THREE.CatmullRomCurve3(STABLE_EXIT_PTS.map(p => new THREE.Vector3(p[0], 0, p[1])));
  const HW = 0.86;                                  // 与进园那条同宽（单车道，够马车）
  const r2 = mulberry32(20261025);                  // 私有流：不碰全局 rnd()
  const jit = (a, b) => a + r2() * (b - a);
  const frameAt = (t) => {
    const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    return { p, tan: tan.clone().setY(0).normalize(), side };
  };
  /* ⚠️⚠️ 2026-10-27 修（老黄截图 1"石板路上有一片模糊的影子"）：出园新路与进园路
     **同起点 (40,4.2)、同半宽 0.86m** ⇒ 头 3~4m 两条路的石板与垫层**完全重合**
     （射线实测同一 xz 上 stableRoadBed / stableExitBed 相差 0.000~0.002m，
      stableExitSlab 与已合并的进园路石板相差 0.000m）⇒ 深度逐像素打架，
     画面上就是一串明暗交错、半透明的方块顺着路铺过去。
     做法：出园路在"进园路带内"的**段落不生成**（垫层丢扇区、石板按中心点跳过）⇒
     它变成从进园路东侧分出去的支路，接缝被进园路自己盖住。
     只跳几何、不动随机流（编号仍按原顺序抽），所以布局指纹不漂。 */
  const nearEntry = (x, z, pad) => {
    const P = STABLE_ROAD_PTS;
    for (let i = 0; i < P.length - 1; i++){
      const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < pad) return true;
    }
    return false;
  };
  /* ⚠️ pad 必须把**几何本身的半宽**算进去：只按"中心点距中线"判会漏掉伸进进园路的那半块
     （第一版用 HW+0.05，射线复测仍有 11 处叠层 —— 石板角 / 垫层内侧都还在里面）。
     取值 = 0.86(进园半宽) + 0.37(石板/垫层最大半径) + 0.05 ⇒ 出园路从两条路**自然分开**的
     那一小段（z≈7.0）才开始铺，接缝离进园路边 5cm，读作"出门口就分岔"。 */
  const PAD_ROAD = HW + 0.37 + 0.05;

  /* ① 垫层（勾缝底） */
  {
    const N = 140, pos = [], idx = [], mid = [];
    for (let i = 0; i <= N; i++){
      const { p, side } = frameAt(i / N);
      mid.push(p);
      for (const s of [1, -1]){
        const q = p.clone().addScaledVector(side, s * HW);
        /* 垫层抬升 0.045 → 0.030：它与进园路的垫层同厚、同色，在"接缝露出来的那几厘米"
           里会共面打架（旧版就是这样）。低 1.5cm 就不可能再与它同平面。 */
        pos.push(q.x, groundHeight(q.x, q.z) + 0.030, q.z);
      }
    }
    for (let i = 0; i < N; i++){
      const c0 = mid[i], c1 = mid[i + 1];
      if (nearEntry((c0.x + c1.x) / 2, (c0.z + c1.z) / 2, PAD_ROAD)) continue;
      const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x9B958A, roughness: 0.98, metalness: 0.0 });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    g.add(mesh(geo, mat, { name: 'stableExitBed', cast: false, receive: true }));
  }

  /* ② 石板：三列错缝（同进园那条的读感，逐块抖动只在色调/长度上） */
  {
    const pos = [], col = [], idx = [];
    const L = curve.getLength();
    const laneW = (2 * HW) / 3;
    const pushSlab = (t0, t1, sA, sB, tone) => {
      const A2 = frameAt(t0), B2 = frameAt(t1);
      const corners = [
        A2.p.clone().addScaledVector(A2.side, sA),
        A2.p.clone().addScaledVector(A2.side, sB),
        B2.p.clone().addScaledVector(B2.side, sB),
        B2.p.clone().addScaledVector(B2.side, sA),
      ];
      /* 落在进园路带内的石板不生成（否则与进园路石板共面打架，见 nearEntry 的注释）。
         用四角均值判中心，跨接缝的那一块整体丢掉 ⇒ 边缘是干净的。 */
      {
        let cx = 0, cz = 0;
        for (const q of corners){ cx += q.x / 4; cz += q.z / 4; }
        if (nearEntry(cx, cz, PAD_ROAD)) return;
      }
      const base = pos.length / 3;
      for (const q of corners){
        const gy = groundHeight(q.x, q.z);
        pos.push(q.x, gy + 0.075, q.z);
        pos.push(q.x, gy + 0.008, q.z);
        col.push(tone, tone * 0.985, tone * 0.955, tone * 0.78, tone * 0.77, tone * 0.75);
      }
      idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);
      for (let k = 0; k < 4; k++){
        const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    };
    for (let lane = 0; lane < 3; lane++){
      const sA = -HW + lane * laneW + 0.012;
      const sB = sA + laneW - 0.024;
      let s = lane * 0.17;                          // 三条列错开起步 ⇒ 横缝不贯通
      while (s < L - 0.06){
        const len = jit(0.30, 0.46);
        const e = Math.min(L, s + len);
        if (e - s < 0.12) break;
        pushSlab(s / L, e / L, sA, sB, jit(0.58, 1.0));
        s = e + jit(0.015, 0.032);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xC9C3B4, vertexColors: true,
                                                 roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    g.add(mesh(geo, mat, { name: 'stableExitSlab', cast: false, receive: true }));
  }
  /* 写意艺术处理（art-license 'stable'）：整条出园路都只为马车进出而铺，组上打标即可。只写 userData。 */
  markArtLicense(g, 'stable');
  return g;
}

export function makeStableRoad(){
  const g = new THREE.Group();
  /* ⚠️⚠️ 2026-10-20 v2（老黄 09:06："到院子这个端口的还是太乱，再修的好看一些"）：
     上一版末点 (0.35,23.25) 仍**没对准门心**（月洞门圆心 x=0）—— 路歪 35cm 进门，
     门前的铺装中心又接着往东漂（0.35→0.55），整组构图与门错位 ⇒ 读作"乱"。
     本轮：路尾收到 **(0,24.55)**（与平台南沿齐平、正对门心 —— 末段转正南-北向，不再斜插进平台，见下方 ④c v3），门前铺装同步改为**中轴 x=0 的对称平台**
     （见下方 ④c）。 */
  const CP = STABLE_ROAD_PTS;
  const curve = new THREE.CatmullRomCurve3(CP.map(p => new THREE.Vector3(p[0], 0, p[1])));
  const HW = 0.86;                                 // 半宽 ⇒ 路宽 1.72m（单车道，够马车）
  const r2 = mulberry32(20261012);                 // 私有流
  const jit = (a, b) => a + r2() * (b - a);
  const frameAt = (t) => {                          // 位置 + 切向 + 侧向（xz 平面）
    const p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    return { p, tan: tan.clone().setY(0).normalize(), side };
  };
  const nrmTex = () => { const n = pavingNormalTex.clone(); n.needsUpdate = true;
    n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(1, 1); return n; };

  /* ① 垫层（勾缝底）：一条跟着地形走的深色窄带 */
  {
    const N = 200, pos = [], uv = [], idx = [];
    let acc = 0, prev = null;
    for (let i = 0; i <= N; i++){
      const { p, side } = frameAt(i / N);
      if (prev) acc += p.distanceTo(prev);
      prev = p.clone();
      for (const s of [1, -1]){
        const q = p.clone().addScaledVector(side, s * HW);
        pos.push(q.x, groundHeight(q.x, q.z) + 0.045, q.z);
        uv.push(s * HW / 2.6, acc / 2.6);
      }
    }
    for (let i = 0; i < N; i++){ const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    /* ⚠️ 2026-10-20：垫层 0x6E675D → 0x8B8578（灰浆色）。原色太深，
       石板缝一露出来就读作"一条没填平的黑沟把路劈成两半"（近景判读原话）。 */
    const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0x9B958A,
                                                 roughness: 0.98, metalness: 0.0 });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    g.add(mesh(geo, mat, { name: 'stableRoadBed', cast: false, receive: true }));
  }

  let roadPavingMat = null;   // ④c 月洞门前补铺复用同一材质（见下）
  /* ② 石板：**四个角落在曲线的 t 网格上**（不是"切向矩形"）——
     切向矩形在弯道上会互相撞：每块都按自己那点的切线摆，弯内侧两块必然叠压/穿插
     （第一版就是这样，近景判读"弯段错位、角部相互压叠"）。改成"两条弧上的点 + 侧向偏移"
     以后，石板天然跟着弧走、相邻两块永远不重叠。
     错缝：左右两条各自**不同的相位与步长** ⇒ 横向接缝不齐。 */
  {
    const pos = [], col = [], idx = [], L = curve.getLength();
    const pushSlab = (t0, t1, sA, sB, tone) => {
      const A2 = frameAt(t0), B2 = frameAt(t1);
      /* ⚠️ 绕向：侧向量 side 与切向 tan 满足 side × tan = +y ⇒ 角按 (A·sA, A·sB, B·sB, B·sA)
         且 sA < sB 时，顶面法线朝上（写反了顶面就朝下、从上看全黑）。 */
      const corners = [
        A2.p.clone().addScaledVector(A2.side, sA),
        A2.p.clone().addScaledVector(A2.side, sB),
        B2.p.clone().addScaledVector(B2.side, sB),
        B2.p.clone().addScaledVector(B2.side, sA),
      ];
      const base = pos.length / 3;
      for (const q of corners){
        const gy = groundHeight(q.x, q.z);
        pos.push(q.x, gy + 0.075, q.z);              // 顶（偶数索引）
        pos.push(q.x, gy + 0.008, q.z);              // 底（奇数索引）——几乎贴到草面，消除"浮着"的台阶
        /* 侧壁比顶面暗一档（0.78）：石板有厚度、有侧影 ⇒ 读作"石块"而不是"贴纸" */
        col.push(tone, tone * 0.985, tone * 0.955, tone * 0.78, tone * 0.77, tone * 0.75);
      }
      idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);   // 顶面
      for (let k = 0; k < 4; k++){
        const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
        idx.push(a, b, b + 1, a, b + 1, a + 1);       // 四个侧面
      }
    };
    /* ⚠️⚠️ 2026-10-20 重做铺法：两条 0.83m 宽的大板 → **三条错缝的小板**。
       旧版每块 0.83m×0.55m，远看就是"几张白纸板铺在草上"（老黄："石板铺得太敷衍"）。
       现在：① **三列**（每列 ~0.57m），列内石板长 0.30~0.46m；② 相邻行**错半块**（砖缝错缝）；
       ③ 缝宽收到 1.5~3.2cm（旧的 3~7cm 露出的深色垫层读作"黑沟"）；
       ④ 材质基色 0xFFFFFF → 0xC9C3B4（石材灰；顶点色 0.58~1.0 再乘上去）——
          纯白 + 顶面高光 = "泡沫板"，石材灰才是石头。
       ⑤ 石板厚度 0.056 → 0.075m、侧壁更暗（0.88 → 0.78）⇒ 有份量，不是"贴纸"。
       ⚠️ 纵缝：两条列边固定在 ±0.02/±0.59/±1.16 附近，只有**最外沿**吃抖动
          （外沿内收 = "乱石"的不规则边；内侧整齐才像"一条路"）。 */
    const LANES = 3;
    const laneEdge = (k) => -HW + 0.02 + (2 * HW - 0.04) * (k / LANES);   // k=0..LANES
    for (let k = 0; k < LANES; k++){
      const inner = laneEdge(k) + (k > 0 ? 0.018 : 0);
      const outer = laneEdge(k + 1) - (k < LANES - 1 ? 0.018 : 0);
      const outerIsEdge = (k === 0 || k === LANES - 1);
      let d = jit(0.02, 0.26) + k * 0.13;            // 各列相位不同 ⇒ 横向接缝不齐（别在路头留空档）
      while (d < L - 0.30){
        const len = jit(0.30, 0.46);
        const t0 = d / L, t1 = Math.min(1, (d + len) / L);
        const jitter = outerIsEdge ? jit(0.0, 0.055) : jit(-0.012, 0.012);
        const a = (k === LANES - 1) ? outer + jitter : outer;   // 只有最外列的外沿吃抖动
        const b = (k === 0) ? inner - jitter : inner;
        const sA = Math.min(a, b), sB = Math.max(a, b);
        if (sB - sA > 0.16) pushSlab(t0, t1, sA + 0.008, sB - 0.008, jit(0.62, 1.0));
        d += len + jit(0.015, 0.032);                // 缝宽 1.5~3.2cm
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    /* ⚠️ 2026-10-20：基色 0xFFFFFF → 0xC9C3B4（石材灰）。纯白 + 顶点色高光 = "泡沫板"。 */
    const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0xAFA99C,
      vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    roadPavingMat = mat;
    /* ⚠️ **石板要投影**（cast:true）：阴影图的唯一一次渲染发生在延迟批之后的首帧，
       而本函数就在延迟批里跑 ⇒ 影子会正确落进那张图。不投影时近景判读是"纸片浮贴在地面上"，
       投影是"石块落在地上"最便宜的一步（近景图判读反复点到"缺接触阴影"）。 */
    g.add(mesh(geo, mat, { name: 'stableRoad', cast: true, receive: true }));
  }

  /* ③ 两侧卵石镶边：**两排**低模鹅卵石（压扁的球）密排成带（第一版步长 0.30 太稀，
     近景判读"间隔点状、不成带"⇒ 收到 0.19 并铺两排），逐颗抖色调/大小。 */
  {
    const proto = new THREE.SphereGeometry(1, 6, 4);
    const parts = [];
    const L = curve.getLength(), step = 0.19;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), PP = new THREE.Vector3();
    for (let d = 0; d < L; d += step){
      const { p, tan, side } = frameAt(Math.min(0.999, d / L));
      for (const s of [1, -1]){
        for (const row of [0.095, 0.225]){           // 两排：紧贴石板边外侧 + 外面一排
                                             // ⚠️ 内排不能贴太近：卵石半径最大 0.092，靠到
                                             // HW+0.055 时它的内缘会压到石板上（近景判读"个别卵石
                                             // 与石板边重叠穿插"）。0.095 − 0.092 = +0.003 刚好在外。
          const q = p.clone().addScaledVector(side, s * (HW + row + jit(-0.02, 0.02)))
                            .addScaledVector(tan, jit(-0.055, 0.055));
          const r = jit(0.044, 0.092), tone = jit(0.46, 1.05);
          /* ⚠️ 2026-10-20（④c v2 门前平台落地后补）：路尾这段的卵石会正好落在平台
             石板上面 —— 出图读作"石板里嵌卵石"。落在平台矩形（|x|<2.0、z∈[23.10,24.55]，v3 平台南延后同步放大）
             内的卵石直接跳过；jit 已照常消耗 ⇒ 其余卵石的抖动序列不变、位置可复现。 */
          if (Math.abs(q.x) < 2.10 && q.z > 23.05 && q.z < 24.60) continue;
          const gg = proto.clone();
          const cAttr = new Float32Array(gg.attributes.position.count * 3);
          for (let i = 0; i < cAttr.length; i += 3){
            const j2 = jit(-0.06, 0.06);                 // 逐顶点微抖 ⇒ 不是一颗颗纯色球
            cAttr[i] = tone + j2; cAttr[i+1] = (tone + j2) * 0.99; cAttr[i+2] = (tone + j2) * 0.95;
          }
          gg.setAttribute('color', new THREE.Float32BufferAttribute(cAttr, 3));
          PP.set(q.x, groundHeight(q.x, q.z) + r * 0.34, q.z);
          Q.setFromEuler(new THREE.Euler(0, jit(0, 6.28), 0));
          SC.set(r, r * 0.5, r);
          M.compose(PP, Q, SC);
          gg.applyMatrix4(M);                         // 合并前把世界变换烘进几何
          parts.push(gg);
        }
      }
    }
    const geo = mergeGeometries(parts, false);
    parts.forEach(x => x.dispose());
    proto.dispose();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8E8B84, vertexColors: true,
                                                 roughness: 0.96, metalness: 0.0 });
    registerWeatherRoles(mat, { snow: 1, wet: 1 });
    g.add(mesh(geo, mat, { name: 'stableRoadPebble', cast: false, receive: true }));
  }

  /* ── ②b 院门口铺装（2026-10-20 重做）──────────────────────────────────────────
     现象（老黄："连接马厩和院子的那条石板路的两端……石板铺的太敷衍了"）：
     旧版这里是"一块块 1.8m×0.5m 的大板"扇形排开 —— 一块板比一张桌子还大，
     板与板之间留 3~7cm 的缝、底下是深色垫层 ⇒ 远看像**几张白纸板摊在草地上**。
     本轮改成**正��的"横排错缝"铺装**（苏州"乱石路"的常规做法）：
       · 沿 z 从门槛线 Z0=2.30 一路铺到路头 Z1=4.20，共 5 横排；
       · 每排按该处宽度（门口 3.6m → 路宽 1.72m）切成 1~3 块，板长 ~0.6m；
       · 相邻排**错半块**（砖缝错缝）⇒ 不会有贯通的直缝；
       · 缝宽 2cm，垫层是灰浆色 ⇒ 缝里露出的不再是"黑沟"；
       · 门口加一条**门槛石**（横贯门洞 3.5m），两侧加**路牙石**与卵石镶边接上。
     ⚠️ 顶面 +0.072（比主路石板 0.075 低 3mm）：与主路首尾重叠处由主路压住，不打架。 */
  {
    const Z0 = 2.30, Z1 = 4.45;        // 门槛内缘 → 压过路头（与主路首排重叠，不露垫层）
    const W0 = 1.80, W1 = HW;          // 门洞半开口 → 路半宽
    const apronW = (z) => {
      if (z <= 2.95) return W0;
      const u = Math.min(1, (z - 2.95) / (Z1 - 2.95));
      return W0 + (W1 - W0) * (u * u * (3 - 2 * u));   // smoothstep：口部收得柔，不像被切了角
    };
    /* 垫层（与 ① 同色同厚）：跟着宽度变化的一条窄带 */
    {
      const N = 26, pos = [], uv = [], idx = [];
      let acc = 0, prev = null;
      for (let i = 0; i <= N; i++){
        const z = Z0 + (Z1 - Z0) * (i / N);
        if (prev !== null) acc += Math.abs(z - prev);
        prev = z;
        const w = apronW(z);
        for (const s of [1, -1]){
          const x = 40.0 + s * w;
          pos.push(x, groundHeight(x, z) + 0.045, z);
          uv.push(s * w / 2.6, acc / 2.6);
        }
      }
      for (let i = 0; i < N; i++){ const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0x9B958A,
                                                   roughness: 0.98, metalness: 0.0 });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGateBed', cast: false, receive: true }));
    }
    /* 石板：横排 + 错半块。角序按"side × tan = +y"（side = −x ⇒ 角从大 x 排到小 x） */
    {
      const pos = [], col = [], idx = [];
      const pushQuad = (x0, x1, z0, z1, tone) => {   // x1 > x0
        const base = pos.length / 3;
        for (const [x, z] of [[x1, z0], [x0, z0], [x0, z1], [x1, z1]]){
          const gy = groundHeight(x, z);
          pos.push(x, gy + 0.072, z);
          pos.push(x, gy + 0.008, z);
          col.push(tone, tone * 0.985, tone * 0.955, tone * 0.78, tone * 0.77, tone * 0.75);
        }
        idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);
        for (let k = 0; k < 4; k++){
          const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
          idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
      };
      const ROWS = 5, ZGAP = 0.022;
      for (let r = 0; r < ROWS; r++){
        const z0 = Z0 + (Z1 - Z0) * (r / ROWS);
        const z1 = Z0 + (Z1 - Z0) * ((r + 1) / ROWS) - ZGAP;
        const w = Math.min(apronW(z0), apronW(z1)) - 0.015;
        const n = Math.max(1, Math.round(w / 0.62));
        const cw = w / n;
        const off = (r % 2) * cw * 0.5;              // 错半块
        for (let k = -1; k <= n; k++){
          const a = -w + k * cw + off, b = a + cw;
          if (b <= -w || a >= w) continue;
          const sA = Math.max(a, -w), sB = Math.min(b, w);
          if (sB - sA < 0.16) continue;
          pushQuad(40.0 + sA + 0.010, 40.0 + sB - 0.010, z0, z1, jit(0.62, 1.0));
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ normalMap: nrmTex(), color: 0xAFA99C,
        vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGateSlab', cast: true, receive: true }));
    }
    /* 门槛石：横贯门洞的一条长石 —— 把"门线"说清楚，也是下马处该有的东西 */
    {
      const sill = mesh(box(3.44, 0.17, 0.46), MAT.stoneDark, { name: 'stableGateSill', cast: true, receive: true });
      sill.position.set(40.0, groundHeight(40.0, 2.44) + 0.075, 2.44);
      g.add(sill);
    }
    /* 路牙石：两侧各三块，与卵石镶边接上（"这条路是砌出来的"，不是"草地上贴了块板"） */
    {
      for (const s of [1, -1]){
        for (let i = 0; i < 3; i++){
          const z = 3.05 + i * 0.46;
          const w = apronW(z);
          const k = mesh(box(0.20, 0.20, 0.42), MAT.stoneDark, { name: 'stableGateKerb', cast: true, receive: true });
          k.position.set(40.0 + s * (w + 0.10), groundHeight(40.0 + s * (w + 0.10), z) + 0.05, z);
          k.rotation.y = jit(-0.03, 0.03);
          g.add(k);
        }
      }
    }
    /* 卵石镶边：只沿**收口段**两侧（门洞区两侧是栅栏立柱，铺到那儿反而怪） */
    {
      const proto = new THREE.SphereGeometry(1, 6, 4);
      const parts = [];
      const step = 0.19;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), PP = new THREE.Vector3();
      for (let z = Z0 + 0.5; z < Z1; z += step){
        const w = apronW(z);
        for (const s of [1, -1]){
          for (const row of [0.095, 0.225]){
            const qx = 40.0 + s * (w + row + jit(-0.02, 0.02)), qz = z + jit(-0.055, 0.055);
            const rr2 = jit(0.044, 0.092), tone = jit(0.46, 1.05);
            const gg = proto.clone();
            const cAttr = new Float32Array(gg.attributes.position.count * 3);
            for (let i = 0; i < cAttr.length; i += 3){
              const j2 = jit(-0.06, 0.06);
              cAttr[i] = tone + j2; cAttr[i + 1] = (tone + j2) * 0.99; cAttr[i + 2] = (tone + j2) * 0.95;
            }
            gg.setAttribute('color', new THREE.Float32BufferAttribute(cAttr, 3));
            PP.set(qx, groundHeight(qx, qz) + rr2 * 0.34, qz);
            Q.setFromEuler(new THREE.Euler(0, jit(0, 6.28), 0));
            SC.set(rr2, rr2 * 0.5, rr2);
            M.compose(PP, Q, SC);
            gg.applyMatrix4(M);
            parts.push(gg);
          }
        }
      }
      const geo = mergeGeometries(parts, false);
      parts.forEach(x => x.dispose());
      proto.dispose();
      const mat = new THREE.MeshStandardMaterial({ color: 0x8E8B84, vertexColors: true,
                                                   roughness: 0.96, metalness: 0.0 });
      registerWeatherRoles(mat, { snow: 1, wet: 1 });
      g.add(mesh(geo, mat, { name: 'stableGatePebble', cast: false, receive: true }));
    }
  }

  /* ── ④ 路旁石灯笼（2026-10-17 · 老黄："石灯笼可以放在马厩到院子的这条石板路两侧，
     每一段距离放一对，毕竟还有晚上进出的需求"）────────────────────────────────────
     原摆位（池北岸 (4.0,−3.8) 单独一盏，08c-aquatic 里）**撤掉**，资产改在这里复用到路上。
     桩位：沿曲线弧长等分 5 站、每站左右各一盏，横向 ±1.55m —— 卵石镶边最外缘约 1.18m
     （HW + 0.225 + 卵石半径 0.092），留 0.37m 净隙；灯笼底座半径 0.28m。
     首站从 6m 起、末站离路尾 3m：别怼在院门口（那儿留给石狮）与南门口。
     座石：每盏下垫一块方座（0.92×0.30×0.92，顶面比草皮高 0.04、其余埋进土里）——
     草坡有 ±0.1m 起伏，不垫的话 0.55m 宽的底座必然有一角悬空。
     ⚠️ 8 盏按**材质合并成 2 个网格**（石身 + 火袋，座石并进石身那个桶），不是 10 棵节点树。
     火袋 emissive 模型自带；真光源见下面 ④b（2026-10-18 起每盏一盏 PointLight；2026-10-19 南门口一对撤掉，10→8）。 */
  {
    /* ⚠️ 2026-10-19：N=5 → 4（老黄："如果摆放位置有石头灯挡住了，就把这一组石头灯去掉"）。
       去掉的是**最后、最靠南门口那一对**（原 (3.6,23.7)/(2.6,26.7)）——
       石狮改摆到南门口之后，那一对正好挤在东侧幼狮与门槛之间的落位上。
       其余 4 对（8 盏）保持原间距与朝向，巡回第 2 对锚点不受影响。 */
    const N = 4, LR = curve.getLength();
    const OFF = 1.55;
    const spots = [];
    for (let i = 0; i < N; i++){
      /* ⚠️ 2026-10-19：末站从 LR−3 收到 **LR−9**。只把 N 从 5 改 4 是不够的 ——
         等分公式会把 4 对重新铺满整条路，最后一对仍然落在南门口（约 z=25.5），
         正好继续挡着石狮。收到 LR−9 ⇒ 最后一对停在 z≈25 以北 6m，门口留空。 */
      const d = 6.0 + (LR - 15.0) * (i / (N - 1));
      const { p, tan, side } = frameAt(Math.min(0.999, d / LR));
      for (const s of [1, -1]){
        const q = p.clone().addScaledVector(side, s * OFF);
        spots.push({ x: q.x, z: q.z, ry: Math.atan2(tan.x, tan.z) });
      }
    }
    /* 给"看灯笼"入口留一个**稳定的锚点**：合并后的网格没有单盏位置可言，
       而手机端那个浮动按钮要飞到一个具体近前。锚点取第一对（离院门最近的一对）。 */
    const anchor = new THREE.Object3D();
    anchor.name = 'stoneLanternAnchor';
    anchor.position.set(spots[0].x, groundHeight(spots[0].x, spots[0].z) + 0.70, spots[0].z);
    g.add(anchor);
    console.log('[路旁石灯笼] 桩位：' + spots.map(s => '(' + s.x.toFixed(1) + ',' + s.z.toFixed(1) + ')').join(' '));
    loadAssetOnce('assets/stone-lantern.glb', 1.05, (srcL)=>{
      const buckets = new Map();
      const push = (mat, geo) => {
        if (!buckets.has(mat.uuid)) buckets.set(mat.uuid, { mat, parts: [] });
        buckets.get(mat.uuid).parts.push(geo);
      };
      /* 先认材质身份：名字带 glow 的是火袋，另一个是石身（座石跟石身同材质、同桶） */
      let stoneMat = null;
      srcL.traverse(o => { if (o.isMesh && !/glow/i.test(o.material.name || '')) stoneMat = o.material; });
      if (!stoneMat) srcL.traverse(o => { if (o.isMesh) stoneMat = o.material; });
      const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(),
            S4 = new THREE.Vector3(1, 1, 1), P4 = new THREE.Vector3();
      for (const st of spots){
        const base = groundHeight(st.x, st.z);
        const h = new THREE.Group();
        h.position.set(st.x, base - 0.010, st.z);
        h.rotation.y = st.ry;
        h.add(srcL.clone(true));
        h.updateMatrixWorld(true);
        h.traverse(o => {
          if (!o.isMesh) return;
          const gg = o.geometry.clone();
          gg.applyMatrix4(o.matrixWorld);
          push(o.material, gg);
        });
        /* 座石：0.30 厚、顶面比该点草皮高 0.04 ⇒ 底下 0.26m 埋进坡里，四个角都不悬空 */
        const padGeo = box(0.92, 0.30, 0.92);
        P4.set(st.x, base + 0.04 - 0.15, st.z);
        Q4.setFromEuler(new THREE.Euler(0, st.ry, 0));
        M4.compose(P4, Q4, S4);
        padGeo.applyMatrix4(M4);
        push(stoneMat, padGeo);
      }
      for (const { mat, parts } of buckets.values()){
        const geo = mergeGeometries(parts, false);
        parts.forEach(x => x.dispose());
        g.add(mesh(geo, mat, { name: 'roadLantern', cast: true, receive: true }));
      }
      console.log('[路旁石灯笼] ' + spots.length + ' 盏（含座石）· 合并成 ' + buckets.size + ' 个网格');
    });
    /* 8 盏真光源与上面的模型一一同位（2026-10-18 · 老黄："石头灯要加灯光（带随机摇曳效果）"）。
       每盏一个 PointLight，暖橙 0xFFB45A（与火袋 emissive 同色），灯位 = 火袋中心（地面 +0.68m）。
       · castShadow 全 false：点光阴影是 6 面立方体贴图，8 盏全开等于每帧多渲 48 张深度图。
       · distance=7 + decay=2：光只落在灯下路面一圈，不把整片草坡染成橘色。
       · 灯数启动时定死、运行期只改 intensity（与廊灯同一条铁律，不触发材质重编译）。
       · 时段开关：推进 worldLights（12-env :303 按 lamp 通道发强度，白天全灭、夜里全亮）。
       · 摇曳：userData.flick 由 11-loop 逐帧写（烛火式 ±10%，每盏相位用布点序号派生、确定性）。

       ⚠️ 性能档（low）**一盏都不建**（2026-10-18 · 补 P1「10 盏常驻真光源没有低画质验收」）。
       实测（outputs/_diag/lowfps.mjs，1600×900 · ?tier=low · 夜间 · 同一帧位；当时是 10 盏，现在 8 盏）:
           正午（10 盏 intensity=0，但仍参与着色） 13.3 fps
           夜间 开 10 盏                            14.7 fps
           夜间 关 10 盏（visible=false）           22.7 fps
       即"10 盏 PointLight 常驻（现 8 盏）"在性能档吃掉约 **8~11 fps（约 35~50%）** —— 白天强度为 0
       也照付 shader 前向光照循环的钱。所以性能档直接不建这 8 盏，只保留模型自带的
       火袋 emissive（灯仍然"亮着"，只是不往地面投光）。
       灯数仍在启动时定死（只有初次画质档决定），运行期不增删 ⇒ 不会触发材质重编译。
       注：QOS 运行期把 mid/high 降到 low 时，已经建好的灯不会消失（改灯数会当场重编译，
       换来一次卡顿）；这是有意的取舍，见 11-loop QOS 段的口径。 */
    const LAMP_LIGHT_BUDGET = ACTIVE_QUALITY.key === 'low' ? 0 : spots.length;
    for (let i = 0; i < LAMP_LIGHT_BUDGET; i++){
      const st = spots[i];
      const L = new THREE.PointLight(0xFFB45A, 0, 7, 2.0);
      L.position.set(st.x, groundHeight(st.x, st.z) + 0.68, st.z);
      L.castShadow = false;
      L.name = 'roadLamp';
      L.userData.base = 1.6;
      L.userData.road = true;
      L.userData.flick = 1;
      L.userData.flickPh = [i * 2.39, i * 1.73 + 1.1, i * 0.91 + 2.2];
      g.add(L);
      worldLights.push(L);
    }
    console.log('[路旁石灯笼] 真光源 ' + LAMP_LIGHT_BUDGET + ' 盏' +
      (LAMP_LIGHT_BUDGET ? '（PointLight，无阴影，lamp 通道 + 摇曳）'
                         : '（性能档：只留火袋 emissive，省 8 盏前向光照）'));
  }
  /* ── ④c 月洞门前铺装（2026-10-20 重做 v2）───────────────────────────────────────
     v1（同日早）仍歪：路尾 x=0.35 本身没对准门心（月洞门圆心 x=0），铺装中心又接着
     往东漂（0.35→0.55）⇒ 整组构图与门错位 35~55cm，加上错缝抖动 ⇒ 读作"乱"（老黄 09:06）。
     v2 三改：
       ① 路尾收到 (0,24.55)（上方 CP 表）—— 正对门心、与平台南沿齐平、末段转正不再斜插（v3）；
       ② 门前不再"顺着歪路收口"，改成**与门槛石同宽（4.0m）的矩形平台**，
          中轴 x=0 与月洞门圆心、门槛石严格同轴 ⇒ 从南来先见一方规整平台，再入洞门；
       ③ 石板**对缝不错缝**：每行 7 块等宽（奇数 ⇒ 正中一块压门心轴），行间接缝
          上下对齐 —— 最规整的铺法；两侧各压一条**通长条石**收边（替代 v1 的 4 块小路牙）。
      ⚠️⚠️ v3（2026-10-21 老黄红框："改成水平方向平铺的砖"）：v2 平台只有左半是
      矩形板、右半被斜插进来的路板切成菱形 ⇒ 框里一半方一半菱读作"乱"。
      本轮：① 路尾退到平台南沿外（上方 CP），斜板不再进框；② 平台改**顺砖丁顺砌**：
      长边沿 x（水平方向）平铺、丁顺错缝、砖 0.39×0.195、缝 1.2cm（4m 正好 10 块整铺）；
      ③ 平台南延 25cm（Z1 24.30→24.55）吞掉路-台接缝；④ 垫一块深色勾缝底
      （缝里露出的是勾缝灰不是草）。东西条石收边保留。 */
  {
    const Z0 = 23.10, Z1 = 24.55, W = 2.0;  // v3 南延 25cm 吞路-台接缝；W=半宽=门槛石半宽
    /* 勾缝底 v2：深色垫（缝里露灰不露草）。⚠️ v1 是整块平板（+0.055），地形西高东低 ⇒
       西侧直接盖住砖面。改成**逐顶点跟地形**的网格：内顶 gy+0.050（砖顶 gy+0.072 ⇒
       缝深 2.2cm），边缘一圈沉到 gy+0.008（不露黑边）。绕向保证法线朝上。 */
    {
      const NX = 8, NZ = 4, bp = [], bidx = [];
      for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++){
        const bx = -W - 0.01 + (W * 2 + 0.02) * (i / NX);
        const bz = Z0 - 0.01 + (Z1 - Z0 + 0.02) * (j / NZ);
        const edge = (i === 0 || j === 0 || i === NX || j === NZ);
        bp.push(bx, groundHeight(bx, bz) + (edge ? 0.008 : 0.050), bz);
      }
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++){
        const a = j * (NX + 1) + i;
        bidx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 2, a + NX + 1);
      }
      const bgeo = new THREE.BufferGeometry();
      bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      bgeo.setIndex(bidx); bgeo.computeVertexNormals();
      const bed = mesh(bgeo, new THREE.MeshStandardMaterial({ color: 0x6E675D,
        roughness: 0.98, metalness: 0.0, side: THREE.DoubleSide }), { name: 'gateLandingBed', cast: false, receive: true });
      registerWeatherRoles(bed.material, { snow: 1, wet: 1 });
      g.add(bed);
    }
    const pos = [], col = [], idx = [];
    const pushQuad = (x0, x1, z0, z1, tone) => {
      const base = pos.length / 3;
      for (const [x, z] of [[x1, z0], [x0, z0], [x0, z1], [x1, z1]]){
        const gy2 = groundHeight(x, z);
        pos.push(x, gy2 + 0.072, z);
        pos.push(x, gy2 + 0.008, z);
        col.push(tone, tone * 0.985, tone * 0.955, tone * 0.78, tone * 0.77, tone * 0.75);
      }
      idx.push(base + 0, base + 2, base + 4, base + 0, base + 4, base + 6);
      for (let k = 0; k < 4; k++){
        const a = base + k * 2, b = base + ((k + 1) % 4) * 2;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    };
    /* 顺砖丁顺砌：砖长边沿 x（水平方向）平铺；奇数行错半砖；两端切砖补齐（≥14cm 才留）。 */
    const BL = 0.39, BGAP = 0.012;               // 砖长(沿x) × 缝宽（4.0m = 10×0.39 + 9×0.012，正好整铺）；砖深 = 行高 - 缝
    const ROWS = 7;                              // 1.45m 深 ≈ 7 行
    for (let r = 0; r < ROWS; r++){
      const z0 = Z0 + (Z1 - Z0) * (r / ROWS);
      const z1 = Z0 + (Z1 - Z0) * ((r + 1) / ROWS) - BGAP;
      const off = (r % 2) ? -(BL + BGAP) / 2 : 0; // 丁顺错缝（半砖错，两端对称切砖）
      for (let x = -W + off; x < W - 0.05; x += BL + BGAP){
        const a = Math.max(x + 0.006, -W + 0.006);
        const b = Math.min(x + BL - 0.006, W - 0.006);
        if (b - a >= 0.10) pushQuad(a, b, z0, z1, jit(0.62, 1.0));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(mesh(geo, roadPavingMat, { name: 'gateLanding', cast: true, receive: true }));
    /* 平台东西两沿各压一条**通长条石**（与门槛石同料收边）：
       中心在 ±(W+0.09)=±2.09、长 = 平台全长（Z1−Z0）；狮子（x=±2.55）在条石外 0.37m，互不相犯。 */
    for (const s of [1, -1]){
      const kx = s * (W + 0.09), kz = (Z0 + Z1) / 2;
      const k = mesh(box(0.18, 0.16, Z1 - Z0), MAT.stoneDark, { name: 'gateKerb', cast: true, receive: true });
      k.position.set(kx, groundHeight(kx, kz) + 0.048, kz);
      g.add(k);
    }
  }

  /* ── ⑤ 园墙南月洞门口石狮一对（2026-10-18 建 · 2026-10-19 改址 · 2026-10-20 挪近贴墙）──
     【当前桩位】x=±2.55、z=23.25（背贴墙，见下方 2026-10-20 注）；下文旧段落里的 z=23.9 是历史桩位。
     规矩（维基"石狮子"条）："从大门里出来时雄在左、雌在右"；雄右前爪踩绣球、雌左前爪抚幼狮。
     **2026-10-19 老黄："这对石狮子放到院子的门口啊"** —— 从马厩院门移到**园墙南月洞门**：
     洞门圆心 (0,22.5)、洞口半径 1.62、墙外皮 z=22.8；狮子站门外两侧 x=±2.55、z=23.9，
     面朝 +z（来客方向）。内缘到洞口净距 0.65m，整体在墙外（min.z≈23.48）。

     模型（2026-10-18 换真实照片扫描，见 13-preload 与 research/diy-lions/photoscan）：
     · 公 711648B / 母 643576B，主体高 1.076m，loadAssetOnce 归一化到 1.08m；
     · 朝向：Blender 里脸朝 −Y，glTF yup 导出后脸朝 **+z** ⇒ holder.rotation.y = 0
       （⚠️ 与旧 v7 手工模型相反 —— 旧资产脸朝 −z、rotation.y=π；换资产时必须一起改，
       否则两只狮子背对游客。实拍核对见 probe/lion-guard 的出图）。
     · 净空：包围盒半宽 0.30m（实测 0.557/2），狮身内缘到门洞边（±1.8m）留 0.15m；
       旧桩位 ±2.3 只剩 0.05m，视觉上像贴着门柱（2026-10-18 评审 P2）。
     · 母狮是同一扫描体的 X 镜像 + 胸前伏一只 0.20m 的幼狮（同一网格，见 build_lions.py）。
     · 拉不到时 required:false ⇒ 门口空着；probe/lion-guard 会报红（不许静默消失）。 */
  {
    /* 2026-10-19 改址：从马厩院门 → **园墙南月洞门**（老黄："这对石狮子放到院子的门口"）。
       洞门圆心 (0, 22.5)、洞口半径 1.62；狮子站门外两侧 x=±2.55、z=23.9，
       面朝 +z（来客方向）。内缘到洞口边净距 2.55−0.28−1.62 = **0.65m**；
       与原马厩门桩位无关（那处已空出，改放拴马桩/上马石，见 makeStable ④）。 */
    /* ⚠️⚠️ 2026-10-20 挪位（老黄 09:06："石狮子离开围墙太远了，贴近围墙才对"）：
       z=23.9 → **23.25**。狮身半深 ~0.42m ⇒ 后沿 min.z≈22.83，距墙外皮（22.8）仅 3cm，
       读作"背贴墙站"；前脸（z≈23.67）正压在门前平台（④c v2）前缘 ⇒ 迎客姿势。 */
    const spots = [
      { url: 'assets/stone-lion-male.glb', x: 2.55, z: 23.25, name: 'stoneLionMale' },
      { url: 'assets/stone-lion-female.glb', x: -2.55, z: 23.25, name: 'stoneLionFemale' },
    ];
    for (const st of spots){
      loadAssetOnce(st.url, 1.08, (src)=>{
        const h = new THREE.Group();
        h.name = st.name;
        h.position.set(st.x, groundHeight(st.x, st.z) - 0.01, st.z);
        h.rotation.y = 0;                       // 扫描狮脸朝 +z（南）迎客，见上方注释
        h.add(src.clone(true));
        g.add(h);
        console.log('[门口石狮] ' + st.name + ' 落位 (' + st.x.toFixed(1) + ',' + st.z.toFixed(1) + ')');
      });
    }
  }
  /* 石板开投影之后，投射物集合变了 ⇒ 置脏让它进那张**静态**阴影图（11-loop 的收尾也会刷一次，
     这里显式做一道保险：本函数在延迟批里跑，顺序一旦被改动，石板就会"没有接触阴影"）。 */
  markCasterBoxDirty();
  renderer.shadowMap.needsUpdate = true;
  /* 写意艺术处理（art-license 'stable'）：只给"通马厩的路面"逐件打标 —— 石板路本身
     （stableRoadBed / stableRoad / stableRoadPebble）与马厩院门口铺装（stableGate*）。
     ⚠️ 不打在组 g 上：同组里还有园门外平台（gateLanding、gateLandingBed、gateKerb）、石灯笼、石狮，
        这些是园林实景该有的东西，artLicenseOf 沿祖先链查会把它们一起误标成"马厩"。只写 userData。 */
  for (const o of g.children) if (/^stable(Road|Gate)/.test(o.name)) markArtLicense(o, 'stable');
  return g;
}

/* ── 马厩整组 ────────────────────────────────────────────────────────────────
   局部坐标：原点 = 场院中心；**−z 朝园子（正面/院门方向）**、+z 是厩身。
   调用：`makeStable(cx, cz, { yaw })`，组放在 (cx, 0, cz) 并绕 y 转 yaw。
   **组自身的 y = 0**，所有竖向位置都由 `gy()`（逐点实测地形高）现算 ⇒ 场地跟着草坡走。 */
export function makeStable(cx, cz, opts = {}){
  const g = new THREE.Group();
  const yaw = opts.yaw || 0;
  g.position.set(cx, 0, cz);
  g.rotation.y = yaw;

  /* 局部 (lx,lz) → 世界，再取该处地形高 —— 逐个物件落在**自己脚下**的草皮上 */
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const gy = (lx, lz) => groundHeight(cx + lx * cy + lz * sy, cz - lx * sy + lz * cy);

  /* ① 厩身：6 柱 5 间、正面敞开；进深 3.8、面阔 9.4、檐高 3.2 */
  const BX = 4.7, BZ0 = 0.6, BZ1 = 4.4, colH = 3.2;
  /* **低石明**（plinth）：只在厩身底下，顶面 = 该区最高草皮 + 0.12，厚 0.55（全埋）
     —— 这是"建在草皮上"的关键：不再给整个院子铺抬高的台基。 */
  /* **低石明**（plinth）：只在厩身底下。
     ⚠️ 2026-10-10 二轮（出图判读"建筑坐在抬高的石台板上、台板与草地交接生硬"）：
        ① 露出高度从 "最高草皮 + 0.12" 收到 **+0.04**（几乎与草面相平）；
        ② 厚度**按足迹地形落差自适应**（= 落差 + 0.12）⇒ 底面必定埋进最低处草皮之下，
           不会在坡下侧露出悬空缝；③ 于是台帮最多露出一圈 ~0.3m 的矮石脚
           （真实马厩就是这个做法），而不是一块抬高的板。 */
  let maxG = -1e9, minG = 1e9;
  for (let lx = -BX - 0.4; lx <= BX + 0.4; lx += 1.2)
    for (let lz = BZ0 - 0.3; lz <= BZ1 + 0.3; lz += 0.9){
      const y = gy(lx, lz);
      if (y > maxG) maxG = y;
      if (y < minG) minG = y;
    }
  const plinthTop = maxG + 0.04;
  const plinthH = (maxG - minG) + 0.12;
  /* ⚠️ 石明**只比厩身footprint大 0.12m**（2026-10-10 三轮：出图判读"建筑浮在一块抬高的
     石台板上"—— 上一版比 footprint 大 1.0m，于是顶面露出一圈 0.5m 宽的灰白围裙，
     读成"月台"而不是"矮石脚"）。现在只在墙根外露一圈 12cm 的石沿，
     厚度按落差自适应 ⇒ 坡下侧也不会有悬空缝。 */
  const plinth = mesh(box(BX * 2 + 0.24, plinthH, BZ1 - BZ0 + 0.24), MAT.stoneDark, { name: 'stablePlinth', cast: true, receive: true });
  plinth.position.set(0, plinthTop - plinthH / 2, (BZ0 + BZ1) / 2); g.add(plinth);
  /* 墙根一圈**土石散脚**（小石块 + 暗色土沿）：把"石明与草地"那条生硬直角边打散 ——
     出图判读两次都点这条（"草地像被矩形布尔切出来、边缘锐利"）。 */
  for (let i = 0; i < 26; i++){
    const a = (i / 26) * Math.PI * 2, rx = BX + 0.30 + (i % 3) * 0.16, rz = (BZ1 - BZ0) / 2 + 0.30 + (i % 2) * 0.14;
    const lx = Math.cos(a) * rx, lz = (BZ0 + BZ1) / 2 + Math.sin(a) * rz;
    const st = mesh(new THREE.SphereGeometry(0.10 + (i % 4) * 0.035, 6, 5), MAT.stoneDark, { name: 'plinthSkirt', cast: false });
    st.position.set(lx, gy(lx, lz) + 0.05, lz);
    st.scale.set(1.25, 0.6, 1.0);
    st.rotation.y = a;
    g.add(st);
  }
  const P0 = plinthTop;                       // 厩身从石明顶面起

  const colX = [-4.4, -2.64, -0.88, 0.88, 2.64, 4.4];
  for (const x of colX){
    const c = makeColumn(colH, 0.185);
    c.position.set(x, P0 + colH / 2, BZ0 + 0.18); g.add(c);
    const cb = mesh(new THREE.CylinderGeometry(0.26, 0.29, 0.16, 10), MAT.stoneDark, { name: 'stableColBase' });
    cb.position.set(x, P0 + 0.08, BZ0 + 0.18); g.add(cb);
  }
  /* ⚠️ 墙高必须**顶到屋顶底下**（2026-10-10 修，老黄："马厩的地板会有光线在闪烁"）：
     原来写的是 `colH − 0.5`（墙顶 2.85），而屋顶下皮在那条线上是 **3.48** ⇒ 后墙与两山墙
     上方留了一条 **9.4m × 0.62m 的贯通洞口**；太阳从东/东南斜射进来，在地板上投出一条
     长亮带（还被两榀梁切成几段）—— 亮带边缘是阴影图的阶梯，**镜头一动就闪**。
     真实杂役房的墙是砌到檐口的（通风靠窗，不靠墙顶那道缝），所以把墙加到 `colH + 0.40`
     （顶到屋面线下、被梁枋挡住），洞口消失。 */
  const wallH = colH + 0.40;
  const backWall = mesh(box(BX * 2, wallH, 0.24), MAT.wall, { name: 'stableBackWall', cast: true });
  backWall.position.set(0, P0 + wallH / 2, BZ1); g.add(backWall);
  const vent = makeLatticePanel(3.4, 0.72, 5, 2);
  vent.position.set(0, P0 + colH - 0.85, BZ1 - 0.14); g.add(vent);
  /* ⚠️⚠️ 通风窗**必须自己投影**（2026-10-10 修，老黄："这个马厩的地板会有光线在闪烁"）。
     `makeLatticePanel` 的衬板（"关着的门扇：纸/木板，**不透**"）默认是 `cast:false` ——
     视觉上不透，**阴影图里却是空的**：太阳从东边斜射进来，穿过这块"板"、只被格心的
     5×2 横竖棂挡住 ⇒ 厩内**石地板上被投出一格一格的亮斑**（真实的格子阴影）。
     它落在正对窗户那片石板上，边缘是 2048²/6144² 阴影图的阶梯，**镜头一动就闪** ——
     这就是老黄看到的现象。真马厩的冬天可是把窗堵上的：让它投影即修（衬板本来就是不透板）。 */
  vent.traverse(o => { if (o.isMesh) o.castShadow = true; });
  for (const sx of [-1, 1]){
    const sideWall = mesh(box(0.24, wallH, BZ1 - BZ0), MAT.wall, { name: 'stableSideWall', cast: true });
    sideWall.position.set(sx * BX, P0 + wallH / 2, (BZ0 + BZ1) / 2); g.add(sideWall);
  }
  for (const z of [BZ0 + 0.18, BZ1]){
    const beam = mesh(box(BX * 2 + 0.3, 0.30, 0.22), MAT.wood, { name: 'stableBeam', cast: true });
    beam.position.set(0, P0 + colH + 0.15, z); g.add(beam);
  }
  /* 屋顶：悬山（两坡 + 正脊）——马厩是杂役房，硬/悬山才对（歇山是厅堂形制） */
  const roofW = BX * 2 + 1.1, roofRun = 2.42, ridgeY = P0 + colH + 1.32;
  for (const sz of [-1, 1]){
    const slope = mesh(new THREE.BoxGeometry(roofW, 0.16, roofRun), MAT.roof, { name: 'stableRoof', cast: true });
    const ang = Math.atan2(1.32, roofRun);
    slope.rotation.x = sz * ang;
    slope.position.set(0, ridgeY - 0.66, (BZ0 + BZ1) / 2 + sz * roofRun / 2);
    g.add(slope);
  }
  /* 正脊：⚠️ 必须**压到两坡端头之下**（2026-10-10 修，老黄："马厩的地板会有光线在闪烁"）。
     两坡是 box 绕 X 转 ±ang 得到的，它们的**内端头**落在 (z=2.352 / 2.648, y=ridgeY−0.08)
     ⇒ 两坡之间在 z∈[2.35,2.65]、y∈[ridgeY−0.08, 脊底] 有一条 **0.30m×0.04m 的贯通缝**。
     原来脊木放在 ridgeY+0.06（底 = ridgeY−0.04）⇒ 缝**没被盖住**：太阳从缝里漏下来，
     在地板上投出一条 10.5m 长的亮带 —— 而这条缝只有 4cm 高，在 2048²/6144² 的阴影图里
     根本分辨不了 ⇒ **镜头一动亮带就忽隐忽现**（用户看到的"地板光线在闪烁"）。
     现在脊木下压 0.16、加深到 0.34（底 = ridgeY−0.27，比坡端头低 0.19）⇒ 彻底封住，
     顺带在屋内读成一根**脊檩**（真实木构本来就有）。 */
  const ridge = mesh(box(roofW, 0.34, 0.36), MAT.ridge, { name: 'stableRidge', cast: true });
  ridge.position.set(0, ridgeY - 0.10, (BZ0 + BZ1) / 2); g.add(ridge);
  for (const sx of [-1, 1]){
    const gab = mesh(box(0.22, 1.4, BZ1 - BZ0 + 0.2), MAT.wall, { name: 'stableGable', cast: true });
    gab.position.set(sx * BX, P0 + colH + 0.55, (BZ0 + BZ1) / 2); g.add(gab);
  }

  /* **马的槽位**：每匹马都装在一个"槽位组"里（位置 + 朝向），组内先放**程序化替身**，
     真模型加载成功后原地换成真马（见本文件顶部的 loadStableHorses）。
     ⇒ 好处：无论真模型到没到，位置/朝向/落地只有一处真值；失败时画面不空。 */
  const horseSlots = [];
  const addHorseSlot = (lx, lz, y, yaw, colorMat, opts2 = {}) => {
    const grp = new THREE.Group();
    grp.position.set(lx, y, lz);
    grp.rotation.y = yaw;
    const ph = makeHorse(colorMat, opts2);          // 程序化替身（真模型到了就换掉）
    grp.add(ph);
    g.add(grp);
    /* `role`（2026-10-11）：这匹马"在干什么"—— 动作装置按角色给不同的行为
       （stall 厩内待着 / harnessed 辕里待发 / graze 低头吃草 / fed 受喂）。
       ⚠️ 只认角色，**不认坐标**：坐标改选址时会变，角色跟着语义走。
       `mark` / `decoSeed`（2026-10-11 补）：每匹的**花纹**（白斑/白袜/斑纹）与**补件种子**
       （鬃尾的确定性差异）—— 老黄："所有的马都是单一颜色的，这个在自然界也很难存在吧"。 */
    const slot = { group: grp, color: colorMat, holders: [ph], graze: opts2.graze || 0,
                   role: opts2.role || 'stall', mark: opts2.mark || null, decoSeed: opts2.decoSeed || 0,
                   /* 2026-10-21 步态：只给"会走动"的马配 lane；其余马保持原地。
                      home/groundY 是步态位移的唯一真值（组是 makeStable 的子节点 ⇒ 局部坐标）。 */
                   /* ⚠️ 用 gy 不用 yardY：yardY 在厩内马槽位（本函数之上）调用时还没声明 ⇒ TDZ。
                      gy 在 makeStable 开头就定义好了（同一个逐点地形高度）。 */
                   groundY: gy,
                   home: { x: lx, y, z: lz, yaw },
                   gait: opts2.gait || null };
    horseSlots.push(slot);
    return slot;
  };
  /* ⚠️⚠️ 马的槽位（连同挂在槽位里的挽具）**必须 noMerge**（2026-10-10 补，真 bug）：
     `mergeStatics(root)` 在**延迟批结束时**跑，而马厩是在延迟批里建的 ⇒ 程序化替身的
     几何会被**烘进 mergedStatic**（applyMatrix4 烘世界矩阵后成为一个大网格），而
     mergeStatics 把源网格从场景图里摘掉、**几何却留在合并结果里**。
     于是 loadStableHorses 的 `slot.group.remove(h)` 只摘掉了一个空壳 —— 真马进来之后，
     场上是 **6 只程序化马 + 6 只真马叠在同一个位置**：
       · 两套马体互相穿插 → 腿/腹部的深度在相交处来回翻转（**镜头一动就"闪"**）；
       · 地板/草地上永远是**替身那批马腿的影子**（阴影图快照，见 loadStableHorses 末尾）；
       · 用户报的"马厩地板有光影在闪"正是这两条的合成。
     noMerge 是 mergeStatics 唯一的豁免口径（`if (o.userData.noMerge)`），逐网格判定、
     **不继承父级** ⇒ 必须遍历到每个 mesh 上打标。 */
  const markNoMerge = (root) => { root.traverse(o => { if (o.isMesh) o.userData.noMerge = true; }); };
  g.userData.horseSlots = horseSlots;

  /* ② 厩内 4 个隔栏马位 + 每栏一个石食槽；**只占 2 个**（老黄："4 个槽位只有两匹马"）*/
  const stallX = [-4.4, -2.2, 0, 2.2, 4.4];
  for (let i = 0; i < stallX.length; i++){
    const x = stallX[i];
    if (i > 0 && i < stallX.length - 1){
      const div = mesh(box(0.10, 1.25, BZ1 - BZ0 - 0.3), MAT.woodDark, { name: 'stallDivider', cast: true });
      div.position.set(x, P0 + 0.63, (BZ0 + BZ1) / 2 + 0.1); g.add(div);
    }
    if (i < stallX.length - 1){
      const cxm = (stallX[i] + stallX[i + 1]) / 2;
      const tr = makeTrough(1.5, 0.42, 0.32, MAT.stoneDark, MAT.straw, 0.10);
      tr.position.set(cxm, P0, BZ1 - 0.55); g.add(tr);
      const bar = mesh(box(2.0, 0.09, 0.09), MAT.wood, { name: 'stallBar', cast: true });
      bar.position.set(cxm, P0 + 1.02, BZ0 + 0.18); g.add(bar);
      for (const s of [-1, 1]){
        const st = mesh(box(0.08, 1.05, 0.08), MAT.woodDark, { name: 'stallBarPost' });
        st.position.set(cxm + s * 1.0, P0 + 0.53, BZ0 + 0.18); g.add(st);
      }
    }
  }
  /* **厩内 2 匹**（占第 1、3 栏；第 2、4 栏空着）—— 空槽位里放地上的干草，读作"空闲马位"
     ⚠️ 2026-10-19 撤掉：6 匹全数从场景中隐去。
        · 程序化 6 匹（makeHorse 的箱子拼装）出图读作"木雕涂漆"；
        · 场院那 4 匹（Tripo 扫描 Horse.glb）只有法线贴图、缺 baseColor 贴图，
          全部是同一种"灰色被光烤成棕"的样子，没有活感。
        老黄："没有活灵活现的感觉的话还不如不做"——这里整个 horse 子系统留下
        留着以备以后换好资产再用，本轮先把 `slot.group.visible = false` 撤下视觉。
        真模型那一份改在 loadStableHorses 调用前后不挂 holder 来彻底停掉 GPU/drawcall 占用。 */
  for (const [sx0, col, mk, sd] of [
    [(stallX[0] + stallX[1]) / 2, MAT.horseChestnut, { blaze: 1.0, socks: 0.9 }, 1],
    [(stallX[2] + stallX[3]) / 2, MAT.horseWhite,    { dapple: 0.9 }, 2]]){
    addHorseSlot(sx0, BZ1 - 1.5, P0, Math.PI, col, { mark: mk, decoSeed: sd });
  }
  for (const i of [1, 3]){                                                    // 空位：散一堆干草
    const cxm = (stallX[i] + stallX[i + 1]) / 2;
    const hay = mesh(new THREE.SphereGeometry(0.42, 8, 6), MAT.straw, { name: 'stallEmptyHay', cast: true });
    hay.position.set(cxm, P0 + 0.22, BZ1 - 1.4); hay.scale.set(1.2, 0.5, 1.0); g.add(hay);
  }

  /* ③ 院场（z ∈ [−4.5, 0.5]）：**草地**，物件逐点落在自己脚下的草皮上 */
  const yardY = (lx, lz) => gy(lx, lz);

  /* ③a 两驾马车：A 套着两匹马**待发**（车头朝院门 = −z）、B **卸了马**（车辕抬起、支辕棍） */
  const carA = makeCarriage({ pair: true });     // 双马套车：中央辕杆 + 横轭
  /* 2026-10-23：这驾车要能被到访导演层"开出去"（见文件上方的 prepareTravelCarriage）。
     ⚠️ 必须在 `deferRoot.add(st)` / mergeStatics 之前做 —— 晚了车体已经被烘进 mergedStatic。 */
  prepareTravelCarriage(carA);
  const carAY = yardY(-3.0, -1.4);
  carA.position.set(-3.0, carAY, -1.4); carA.rotation.y = Math.PI;   // +z（辕）→ 局部 −z（院门）
  g.add(carA);
  const carB = makeCarriage({ detached: true });
  const carBY = yardY(3.0, -0.9);
  carB.position.set(3.0, carBY, -0.9); carB.rotation.y = Math.PI;
  g.add(carB);
  /* ⚠️ 2026-10-11 补：**把车"坐"到坡上**（老黄这轮出图判读的头号出戏项："马车的一个木轮子
     明显悬空，没有接触到地面，一眼假"）。原因：原来只用"车心那一点的地形高"给 position.y，
     而院场是草坡 —— 两个轮子（车局部 ±0.62）各自脚下的高差 0.2m 量级 ⇒ 一侧轮子必然离地。
     做法：取**两个轮子各自脚下**的地形高，用它们的均值定位、用它们的差求**横滚角**
     （绕车局部 z 轴，即轮轴向）；轮距 1.24m ⇒ θ = Δh / 1.24。
     ⚠️ 符号：车局部 +x 那个轮子在**世界**里落在 +x 还是 −x，取决于车的世界偏航
     （= 组 yaw + 车自身 rotation.y）—— 这里两个车都是 π+π≡0 ⇒ +x 落 +x；仍按通用式算，
     免得以后改朝向时符号悄悄反过来。 */
  const seatCart = (car) => {
    const wy = yaw + car.rotation.y;
    const sgn = Math.cos(wy) >= 0 ? 1 : -1;          // 车局部 +x 映射到世界 +x(+1) 还是 −x(−1)
    const lx = car.position.x, lz = car.position.z;
    const gPos = gy(lx + 0.62, lz), gNeg = gy(lx - 0.62, lz);
    car.position.y = (gPos + gNeg) / 2;              // 两轮接地 ⇒ 车心取两者均值
    car.rotation.z = sgn * (gPos - gNeg) / 1.24;     // 横滚：把轮轴转成与坡面平行
  };
  seatCart(carA); seatCart(carB);
  /* 写意艺术处理（art-license 'carriage'）：makeCarriage 已打过；这里按登记表再显式落一次，
     便于从 15e 读出"套车待发 / 卸马停放"两驾都在表内（只写 userData，幂等）。 */
  markArtLicense(carA, 'carriage'); markArtLicense(carB, 'carriage');
  /* ③b 套在 A 辕里的两匹马（站在辕前、与车同向 = 面朝院门 −z）
     ⚠️ 2026-10-10 二轮（出图判读"车辕悬空、未套马"）：
        ① 马的横向位置**对准辕木**（辕在车中心 ±0.40 ⇒ 马就站在那两条线上）；
        ② 每匹加一条**挽带**（从辕木拉到马肚的短带）——"套着"这件事必须有个可见的连接件，
           否则两匹站着的马 + 两根伸着的辕只会读成"车与马各自摆着"。 */
  for (const sx of [-1, 1]){
    const hx = -3.0 + sx * 0.40;
    /* ⚠️⚠️ 落点按"**肩颈对准横轭**"反算（2026-10-27 复核 A3 重算）：轭在车局部 z=1.38
       （15d 的 pair 分支，2026-10-20 从 1.98 前移过一次，旧注释没跟上）⇒ 院局部
       z = −1.4 − 1.38 = −2.78；马朝 −z，肩颈在"马心 −0.55"处 ⇒ 马心要在 **−3.33**。
       旧值 −2.85 是按轭 1.98 算的，轭前移后没人同步马位 ⇒ 停车态轭落在马颈中段；
       而行驶态 travelOff.z=2.15（马心车局部 2.15）又与停车差 0.7 ⇒ 出发瞬间马向前蹦。
       现在两态统一为马心车局部 1.93（肩颈 1.38 正落轭下）；马臀（车局部 1.15）
       离车厢前壁（≈0.81）留 0.34m 缝，不再相撞。 */
    const hz = -3.33;
    const hy = yardY(hx, hz);
    const slot = addHorseSlot(hx, hz, hy, Math.PI, sx < 0 ? MAT.horseBlack : MAT.horseBay,
      { role: 'harnessed', decoSeed: sx < 0 ? 3 : 4, mark: sx < 0 ? null : { socks: 0.8 } });
    /* 挽具挂在**槽位组**里（跟着替身一起被换掉）：部件是按程序化马的脖径/腹径配的，
       换成真模型后尺寸对不上会穿模 —— 那时"套车"靠辕杆 + 横轭表达，一样成立。 */
    const girth = mesh(new THREE.TorusGeometry(0.235, 0.024, 4, 12), MAT.harness, { name: 'harnessGirth' });
    girth.position.set(0, 0.92, 0); girth.scale.set(1, 0.82, 1);
    slot.group.add(girth); slot.holders.push(girth);
    for (const t of [-1, 1]){
      const trace = mesh(box(0.05, 0.05, 0.62), MAT.harness, { name: 'harnessTrace', cast: false });
      trace.position.set(t * 0.18, 0.80, 0.55);
      trace.rotation.set(0.10, t * 0.08, 0);
      slot.group.add(trace); slot.holders.push(trace);
    }
    const collar = mesh(new THREE.TorusGeometry(0.185, 0.034, 4, 12), MAT.wood, { name: 'harnessCollar' });
    collar.position.set(0, 1.42, -0.42);
    collar.rotation.x = 0.42; collar.scale.set(1, 1.12, 1);
    slot.group.add(collar); slot.holders.push(collar);
  }
  /* ③c 卸下来的两匹：一匹**低头吃草**、一匹由马夫**递草料**（都在 B 车那一侧）
     ⚠️ fed 马要放在**栅栏以内**（栅栏在 z=−4.7），且把马头那侧留给马夫站 ——
        马朝 −z 低头时头在 −z 侧，马夫站在它头前 0.75m（见下面的 groom 落点）。 */
  /* ⚠️ 落点实测修正（2026-10-10 四轮）：吃草那匹原来在 local (4.5,−3.3) ⇒ 前半身伸进
     B 车（卸马那驾）的包围盒（x 重叠 0.19m / z 0.66m）—— 出图判读成"车轮压在马腹下"。
     退到 (4.6,−3.9) 完全分开。 */
  /* ⚠️ 2026-10-11（老黄："也看不到马低头吃草的动作"）：把头低的角度加足 ——
     graze 0.82→0.95（= 40.8°）、fed 0.52→0.80（= 34.4°）。上限仍守 bendHeadDown 的 45° 规矩。 */
  /* 2026-10-21：这匹灰马改成"会自己走几步" —— 朝院心（-x）走 1.25m 再退回来，
     停下的时段低头吃草、偶尔小跑。lane 是沿槽位朝向的前后行程，避免转身扫栅栏。 */
  addHorseSlot(4.6, -3.9, yardY(4.6, -3.9), -Math.PI / 2, MAT.horseGrey,
    { graze: 0.95, role: 'graze', decoSeed: 5, mark: { dapple: 1.0, blaze: 0.7 },
      gait: { lane: 0.75 } });
  addHorseSlot(1.5, -2.8, yardY(1.5, -2.8), Math.PI, MAT.horseBay,
    { graze: 0.80, role: 'fed', decoSeed: 6, mark: { blaze: 1.0, socks: 0.8 } });

  /* ③d 院用杂物：石水槽、草料堆、两根拴马桩、草料篮
     ⚠️ 2026-10-11 老黄："为什么这个草料一定要这样放，不能全部放在围栏内吗？" ——
     水槽/草堆/拴马桩原来都贴着栅栏线（栅栏在 local x=−5.6）：草堆半径 0.71 从 −5.4 起
     ⇒ 有一小半杵到栅栏上、立柱与横杆直接穿过去（出图判读"草压栅栏线"）。
     现在整组往里收到 x≈−4.2~−4.9，**全部落在栅栏以内**，与栅栏留出 ≥0.5m 的余量。 */
  const wt = makeTrough(1.3, 0.6, 0.42, MAT.stoneDark, MAT.stone);
  wt.position.set(-4.85, yardY(-4.85, -0.6), -0.6); g.add(wt);
  /* 草料堆：从"4 个球堆叠（出图判读读作雪人/面团）"改成**码好的草捆 + 散草**——
     扁平长方体交替换向 + 几缕散落的草茎，这才读得出是草料。 */
  const hayX = -4.30, hayZ = -3.35, hayY0 = yardY(hayX, hayZ);
  for (let i = 0; i < 3; i++){
    const bale = mesh(box(0.92, 0.34, 0.52), MAT.straw, { name: 'hayBale', cast: true });
    bale.position.set(hayX + (i === 2 ? 0.14 : 0), hayY0 + 0.18 + i * 0.35, hayZ + (i === 1 ? 0.07 : 0));
    bale.rotation.y = (i % 2) * 0.22;
    g.add(bale);
  }
  for (let i = 0; i < 6; i++){
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(hayX - 0.40 + i * 0.16, hayY0 + 0.02, hayZ - 0.30),
      new THREE.Vector3(hayX - 0.36 + i * 0.16, hayY0 + 0.11, hayZ + 0.04),
      new THREE.Vector3(hayX - 0.43 + i * 0.16, hayY0 + 0.03, hayZ + 0.36),
    ]);
    g.add(mesh(new THREE.TubeGeometry(curve, 4, 0.017, 4, false), MAT.straw, { name: 'hayStraw', cast: false }));
  }
  for (const z of [-2.2, -0.4]){
    const post = mesh(new THREE.CylinderGeometry(0.085, 0.10, 1.35, 8), MAT.woodDark, { name: 'hitchPost', cast: true });
    post.position.set(-5.15, yardY(-5.15, z) + 0.66, z); g.add(post);
    const ring = mesh(new THREE.TorusGeometry(0.075, 0.018, 4, 8), MAT.harness, { name: 'hitchRing' });
    ring.position.set(-5.15, yardY(-5.15, z) + 1.03, z); ring.rotation.y = Math.PI / 2; g.add(ring);
  }
  const basket = mesh(new THREE.CylinderGeometry(0.30, 0.24, 0.34, 10, 1, true), MAT.bambooBlind,
    { name: 'feedBasket', cast: true });
  basket.position.set(2.6, yardY(2.6, -2.6) + 0.17, -2.6); basket.material.side = THREE.DoubleSide; g.add(basket);
  const basketHay = mesh(new THREE.SphereGeometry(0.24, 7, 5), MAT.straw, { name: 'feedBasketHay' });
  basketHay.position.set(2.6, yardY(2.6, -2.6) + 0.30, -2.6); basketHay.scale.set(1, 0.55, 1); g.add(basketHay);

  /* ③e 拴马桩 + 上马石（2026-10-19 · 老黄："马厩门口放拴马石和（上）下马石，
     造型和位置你来定，但是要放的合理和复合古代建筑基本布局"）
     ── 布局依据（北方/江南院门前的常见做法）──
     · **上马石**贴门洞两侧、紧挨栅栏外沿：一块两级踏步的整石，低步朝外（来客来向）、
       高步朝门；骑马人先踏低步、再上高步、借高步翻身上马。所以它必须**离门最近**。
     · **拴马桩**在上马石外侧、沿栅栏一字排开：石桩比人高半头，桩头有孔/环，
       缰绳系在环上；桩距按"一匹马横占 0.8~1.0m"留 1.1m 净距，不拴成糖葫芦。
     · 两件都落在**栅栏以外**（门洞 ±1.8 之外），不挡 3.6m 车门与马车进出。
     ── 局部坐标 ──
     · 上马石：lx = ±2.45（门洞边外 0.65m）、lz = −5.05（栅栏线 −4.7 外 0.35m）；
       低步 0.95×0.24×0.62、高步 0.62×0.30×0.44，顶面 0.54m（真实上马石 0.5~0.6m）。
     · 拴马桩：lx = ±3.55、lz = −5.15；方桩 0.16×1.30，底座 0.44×0.16、桩帽 + 球顶，
       总高约 1.62m；铁环（MAT.harness）朝门洞一侧，挂高 1.08m（缰绳高度）。
     · 全部逐点取 `gy()` 落地 —— 草坡有起伏，不采地形会有一角悬空。 */
  /* ③f 院内拴马横杆（2026-10-23 · 马车版到访的"马夫系马"需要一个真实可系的物件）：
     车停在院门外时，两匹辕马的头朝院门里、正好够到这道横杆（0.6~0.7m）。
     位置：世界 z≈0.9（院内、厩身前面那片空地），跨 x 38.6~41.4。 */
  {
    const railZ = -2.9, railY = gy(0, railZ) + 1.04;
    for (const lx of [-1.36, 1.36]){
      const post = mesh(box(0.12, 1.10, 0.12), MAT.woodDark, { name: 'hitchRailPost', cast: true });
      post.position.set(lx, gy(lx, railZ) + 0.55, railZ); g.add(post);
    }
    const bar = mesh(box(2.90, 0.10, 0.10), MAT.wood, { name: 'hitchRailBar', cast: true });
    bar.position.set(0, railY, railZ); g.add(bar);
    for (const lx of [-0.62, 0.62]){
      const ring = mesh(new THREE.TorusGeometry(0.070, 0.016, 4, 10), MAT.harness, { name: 'hitchRailRing' });
      ring.position.set(lx, railY - 0.07, railZ + 0.05);
      ring.rotation.y = Math.PI / 2; g.add(ring);
    }
  }

  {
    const mkHitch = (lx, lz) => {
      const y0 = gy(lx, lz);
      const base = mesh(box(0.44, 0.16, 0.44), MAT.stoneDark, { name: 'hitchBase', cast: true, receive: true });
      base.position.set(lx, y0 + 0.08, lz); g.add(base);
      const shaft = mesh(box(0.16, 1.30, 0.16), MAT.stoneDark, { name: 'hitchShaft', cast: true, receive: true });
      shaft.position.set(lx, y0 + 0.81, lz); g.add(shaft);
      const cap = mesh(box(0.28, 0.10, 0.28), MAT.stoneDark, { name: 'hitchCap', cast: true });
      cap.position.set(lx, y0 + 1.51, lz); g.add(cap);
      const knob = mesh(new THREE.SphereGeometry(0.11, 8, 6), MAT.stoneDark, { name: 'hitchKnob', cast: true });
      knob.position.set(lx, y0 + 1.62, lz); knob.scale.set(1, 0.8, 1); g.add(knob);
      const ring = mesh(new THREE.TorusGeometry(0.075, 0.018, 4, 10), MAT.harness, { name: 'hitchRing' });
      ring.position.set(lx + (lx > 0 ? -0.10 : 0.10), y0 + 1.08, lz);
      ring.rotation.y = Math.PI / 2; g.add(ring);
    };
    mkHitch(-3.55, -5.15); mkHitch(3.55, -5.15);
    const mkMount = (lx, lz) => {
      const y0 = gy(lx, lz);
      const low = mesh(box(0.95, 0.24, 0.62), MAT.stoneDark, { name: 'mountLow', cast: true, receive: true });
      low.position.set(lx, y0 + 0.12, lz - 0.10); g.add(low);
      const high = mesh(box(0.62, 0.30, 0.44), MAT.stoneDark, { name: 'mountHigh', cast: true, receive: true });
      high.position.set(lx, y0 + 0.39, lz + 0.14); g.add(high);
      /* 顶面被踩得发亮的薄石板：只比高步宽出 0.02，给"上马落脚处"一个可读的亮面 */
      const top = mesh(box(0.56, 0.035, 0.38), MAT.stone, { name: 'mountTop', cast: true, receive: true });
      top.position.set(lx, y0 + 0.557, lz + 0.14); g.add(top);
    };
    mkMount(-2.45, -5.05); mkMount(2.45, -5.05);
  }

  /* ④ 矮木栅围院：正面留 3.6m 车门（对准套车那驾）、两侧 + 后侧沿厩身 */
  const FW = BX + 0.9, FD = 4.7, postH = 1.2;
  const runFence = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 1.7));
    for (let i = 0; i <= n; i++){
      const k = i / n, lx = x0 + (x1 - x0) * k, lz = z0 + (z1 - z0) * k;
      const p = mesh(box(0.10, postH, 0.10), MAT.woodDark, { name: 'fencePost', cast: true });
      p.position.set(lx, yardY(lx, lz) + postH / 2, lz); g.add(p);
    }
    for (const y of [0.52, 0.98]){
      const r = mesh(box(len, 0.075, 0.06), MAT.wood, { name: 'fenceRail', cast: true });
      r.position.set((x0 + x1) / 2, yardY((x0 + x1) / 2, (z0 + z1) / 2) + y, (z0 + z1) / 2);
      r.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
      g.add(r);
    }
  };
  runFence(-FW, -FD, -1.8, -FD);          // 正面西段
  runFence(1.8, -FD, FW, -FD);            // 正面东段（中间 3.6m 车门）
  runFence(-FW, -FD, -FW, FD);            // 西侧
  runFence(FW, -FD, FW, FD);              // 东侧

  /* ⑤ 碾压草皮（老黄 2026-10-10："上马和下马处的草皮因为马匹和马车轮子的碾压应该是枯黄
     或者无草的状况"）：两层 —— 外圈**压黄的草**、内圈**露土的硬地**。
     ⚠️ 三条实现要点：① **逐顶点贴合地形**（在草坡上平板会一头翘一头埋）；
     ② **不规则边 + 径向柔和 alpha**（硬边多边形会被读成"贴图瑕疵"，与雨后水膜同款处理）；
     ③ 挂在**本组**里 ⇒ 随厩身一起转（改朝向不用重算）。 */
  /* ⚠️ 2026-10-27 复核（视觉清单②"雪地里的棕色坑"）：泥地补丁改用**专用**渐隐贴图
     —— 通用 makeSoftAlphaTex 外圈 20% 才渐隐，3m 大补丁的渐隐带只有 0.6m；中心 alpha=1
     与四周纯白形成最大反差，读作"雪里挖了个坑"。这里渐隐带拉长到 40% 起，边缘更融。
     同时两份泥地材质登记积雪（踩实的泥地深雪里同样落雪，活动留痕由渐隐带表达）。 */
  const wornAlpha = makeSoftAlphaTex([[0.00, 'rgba(255,255,255,1)'],
                                      [0.40, 'rgba(255,255,255,0.82)'],
                                      [0.72, 'rgba(255,255,255,0.32)'],
                                      [1.00, 'rgba(255,255,255,0)']]);
  /* lift：叠层贴片的抬升。wornBare 同心叠在 wornDry 上，同高 = 整圈共面 z-fight
     （zfight-scan 实测 55 处高差 0 —— 这才是马厩泥地闪烁的来源，2026-10-28 修）。 */
  const mkPatch = (lx, lz, r, mat, seed, lift = 0) => {
    const NA = 28, NR = 3;
    const pos = [], uv = [], idx = [];
    for (let ir = 0; ir <= NR; ir++){
      const t = ir / NR;
      for (let ia = 0; ia <= NA; ia++){
        const a = (ia / NA) * Math.PI * 2;
        /* 边沿带噪声（只有最外圈收放，内圈保持圆 ⇒ 不会出现自交的锯齿）*/
        const wob = 1 + (ir === NR ? 0.26 * Math.abs(Math.sin(a * 3 + seed)) - 0.13 : 0);
        const rad = r * t * wob;
        const qx = lx + Math.cos(a) * rad, qz = lz + Math.sin(a) * rad;
        pos.push(qx, gy(qx, qz) + 0.05 + lift, qz);
        uv.push(Math.cos(a) * t * 0.5 + 0.5, Math.sin(a) * t * 0.5 + 0.5);
      }
    }
    for (let ir = 0; ir < NR; ir++)
      for (let ia = 0; ia < NA; ia++){
        const a0 = ir * (NA + 1) + ia, b0 = a0 + NA + 1;
        /* ⚠️⚠️ 绕向 2026-10-10 修：原来写的是 (a0, b0, a0+1) —— 环点按 a 递增生成，
           而在 xz 平面上"a 递增"从 +y 往下看是**顺时针** ⇒ 法线朝下 ⇒ 从上看全被背面
           剔除，**六片草皮一片都看不见**（出图三轮都判"没有碾压痕迹"，而场景里明明有 6 个
           网格）。正解 = 反向绕：(a0, a0+1, b0) 法线才朝 +y。
           ⚠️ 同类检查：同批的石板路绕向是对的（它的 side 向量按切线旋转 90° 构造，
           叉积算出来 y 分量为正 ⇒ 一直可见），所以只有草皮这一处踩坑。 */
        idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(mesh(geo, mat, { name: 'yardWear', cast: false, receive: true }));
  };
  const wornDry = new THREE.MeshStandardMaterial({ color: 0x9B8B4E, roughness: 0.99, metalness: 0,
    transparent: true, depthWrite: false, alphaMap: wornAlpha });
  const wornBare = new THREE.MeshStandardMaterial({ color: 0x6D5B45, roughness: 1.0, metalness: 0,
    transparent: true, depthWrite: false, alphaMap: wornAlpha });
  /* 踩实的泥地深雪里同样落雪（2026-10-27 复核·视觉清单②）——不登记的话雪天它就是
     一块被雪包围的亮棕色硬边补丁（eyes-2026-10-27b 的 S-vp-stableNear.png）。 */
  registerWeatherRoles(wornDry, { snow: 1 });
  registerWeatherRoles(wornBare, { snow: 1 });
  /* 上马位（A 车 + 两匹挽马脚下）= 碾压最重；停车位（B 车）= 次之；院门进出口 = 最轻 */
  mkPatch(-3.0, -2.1, 3.0, wornDry, 1.3, 0.000);  mkPatch(-3.0, -2.1, 2.1, wornBare, 1.3, 0.012);
  mkPatch( 3.0, -1.2, 2.2, wornDry, 2.7, 0.006);  mkPatch( 3.0, -1.2, 1.5, wornBare, 2.7, 0.018);
  mkPatch( 0.0, -4.1, 2.0, wornDry, 4.1, 0.003);  mkPatch( 0.0, -4.1, 1.3, wornBare, 4.1, 0.015);

  /* 马夫站位（供 08-assemble 回填人物用）：站在**低头受喂那匹马的头前**、面朝局部 +z
     （也就是朝马嘴），栅栏（z=−4.7）**以内**。
     ⚠️ 2026-10-11：从 z=−4.35 收到 **−4.05**（老黄："马夫看不出来喂马的动作"）——
     实测马鼻端在 z≈−3.77、马夫伸手再往前 ~0.4m，原来两处相隔 1.0m 以上，
     出图判读"草离马嘴还差一点距离、人和马是摆拍式对峙"；收近后草捆正好抵在马嘴前。
     ⚠️⚠️ 2026-10-14 用户报"马夫和吃草的马穿模"—— 收到 −4.05 后马夫躯干与马头前伸段**重叠**
     （改前出图实测：马夫背影直接糊住马脸）。折中回退 **0.25m 到 −4.30**：仍是"伸手可及"的
     喂食距离（草捆抵在马嘴前 ~0.15m），但躯干不再插进马头。这是六条里**最小改动**的一条
     —— 只动一个数，不碰手臂角度、也不碰马的低头幅度。 */
  const groomLocal = [1.5, -4.30];
  /* ⚠️ 打 noMerge 必须放在**所有槽位内容都挂完之后**（挽具是在上面的循环里挂进 slot.group 的）——
     放在 addHorseSlot 里会漏掉挽具，那些件照样被烘进 mergedStatic 而永远摘不掉。 */
  for (const s of horseSlots) markNoMerge(s.group);
  /* ── 可行驶马车注册（2026-10-23）──────────────────────────────────────────
     两匹辕马（role='harnessed'）才是"拉车的那两匹"，其余四匹继续原地/吃草。
     travelOff 是"相对车心的车局部偏移"：原编成里马心在车心前方 1.45m、横向 ±0.4m
     （车局部 +x 与厩身局部的 +x 反向 —— 由 rotation π 决定，这里按 home 反算，不写死符号）。 */
  const travSlots = horseSlots.filter(s => s.role === 'harnessed');
  for (let i = 0; i < travSlots.length; i++){
    const s = travSlots[i];
    /* ⚠️ 2026-10-27 复核 A3：travelOff.z 2.15 → 1.93，与 parked 槽位统一（马肩颈正落
       横轭下，见上方 hz 注释）——旧值与 parked 差 0.7 ⇒ 出发瞬间马相对车向前蹦 0.7m。 */
    s.travelOff = { x: -3.0 - s.home.x, z: 1.93 };
    s.travelPh = i * 0.12;
    makeLeadRope(s);
  }
  const blobMat = new THREE.MeshBasicMaterial({ map: makeSoftAlphaTex(), color: 0x000000,
    transparent: true, opacity: 0.30, depthWrite: false });
  const travBlob = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3.4), blobMat);
  travBlob.name = 'carriageBlobShadow';
  travBlob.rotation.x = -Math.PI / 2;
  /* 车心停在 local (−3,−1.4)：贴地软影用**局部**坐标挂在本组里（组 y=0 ⇒ 局部 y = 世界高） */
  travBlob.position.set(-3.0, groundHeight(cx + (-3.0) * cy + (-1.4) * sy,
                                          cz - (-3.0) * sy + (-1.4) * cy) + 0.10, -1.4);
  travBlob.rotation.y = Math.PI;
  travBlob.renderOrder = 2;
  travBlob.raycast = () => {};
  travBlob.userData.aoSkip = true;
  travBlob.userData.noMerge = true;
  g.add(travBlob);
  TRAVEL.ready = true;
  TRAVEL.group = g; TRAVEL.car = carA; TRAVEL.wheels = carA.userData.wheels || [];
  TRAVEL.slots = travSlots; TRAVEL.blob = travBlob;
  TRAVEL.cx = cx; TRAVEL.cz = cz; TRAVEL.stableYaw = yaw; TRAVEL.cy = cy; TRAVEL.sy = sy;

  g.userData.stable = {
    cx, cz, yaw, plinthTop,
    groom: { x: cx + groomLocal[0] * cy + groomLocal[1] * sy,
             y: 0, z: cz - groomLocal[0] * sy + groomLocal[1] * cy,
             /* ⚠️ 朝向**随厩身走**（原来 08 里硬写 π/2，是因为当时 yaw 固定 π/2；
                改朝向之后硬写的那份会跟厩身拧 90° ⇒ 从 makeStable 里暴露出来） */
             yaw },
    /* 院门中心（世界）—— 给院外石板路起头用（局部门在 (0, −FD)） */
    gate: { x: cx + (-FD) * sy, z: cz + (-FD) * cy },
    horses: 6,
  };
  g.userData.stable.groom.y = groundHeight(g.userData.stable.groom.x, g.userData.stable.groom.z);
  return g;
}

