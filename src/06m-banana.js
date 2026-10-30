// 06m-banana.js — 由 06i-trees.js 按职责整块搬出（纯搬家，逐字节未改）。
// 芭蕉（GLB + 程序化叶冠/蕉果）、池中荷蓬（makeLotusPod）、水草（makeWaterGrass）。
import { THREE, mergeGeometries } from '../vendor.js';
import { mesh } from './03-factory.js';
import { MAT, addWind } from './01-materials.js';
import { TAU, rr, mulberry32, HOOKS, CFG, rnd } from './00-config.js';
/* ⚠️ 依赖方向必须走叶子模块：06-vegetation.js 门面会 import 本文件（经 06i-trees），
   若反过来从门面取就成环，将来谁在顶层调用会 TDZ 白屏。2026-10-27 修正。 */
import { jr } from './06a-rng.js';
import { makeLilyPadGeo, makeLotusPetalGeo, makeReedBladeGeo } from './06c-organs.js';
import { corridorRaw } from './06d-corridor.js';
import { loadAssetOnce } from './06e-assets.js';
import { onAssetFailed } from './13-preload.js';
import { markUnderwater } from './05-water.js';
export function makeBananaFruit(x, y, z){
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
export function makeBananaLeafGeo(len = 2.1, wid = 0.82, seg = 8, droop = 0.55){
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
export const BANANA_SEED = 0x5A1A6A;
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
export const BANANA_URL = 'assets/BananaPlant.glb';

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
    /* ⚠️ 2026-10-30：这个 holder 此前**没有名字**，于是所有按 'BananaPlant' 找它的探针
       （figure-audit 的「异步 GLB 到齐」、asset-shots、pwa-cache）从写下那天起就永远判不到。
       figure-audit 因此卡在「到齐超时」—— 它只是**警告**，可后面所有机位求解都建在
       「荷花荷叶已经挂上」这个前提上，前提没等到，机位就每次落在别处，样张不可比。
       命名口径与 06e 的注释（'Turtle / BananaPlant / LotusPlant 三类 GLB'）一致。 */
    holder.name = 'BananaPlant';
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

