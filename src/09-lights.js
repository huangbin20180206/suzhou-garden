// 09-lights: from index.html inline 497..708
import { THREE, mergeGeometries } from '../vendor.js';
/* ⚠️ world 从 02-scene 取，**不能**从 08-assemble 取：08 反过来 import 本模块的
   mergeStatics / validateGeometry / fitShadowCamera，成环 → 本模块的 body 会被推迟到
   08 之后，而 08 的 body 末尾就要调 fitShadowCamera()（读本模块的 `let casterBoxDirty`）
   → 启动期 TDZ。放 02-scene 后依赖方向单纯：02 → 09 → 08。
   （world 在本模块只在函数体内用，见下方 refreshCasterBox。） */
import { CFG } from './00-config.js';
import { ACTIVE_QUALITY, SHADOW_CAP, scene, renderer, world } from './02-scene.js';
/* 合批规则（纯函数，node 可测）+ 季节/停栖等"不能动"的判据来源 */
import { MAT } from './01-materials.js';
import { perchingAnchors } from './06d-corridor.js';
import { geometrySignature, sameGeometry, planInstanceBatches } from './09b-batch.js';
/* ══════════════════════════════════════════════════════════════
   9 · 灯光
   ══════════════════════════════════════════════════════════════ */

/* 这里原本有一段对 world 的 world.traverse（小构件关投影）—— 本轮拆模块时移到了
   08-assemble.js 的 body 末尾：它操作的是 world，而 world 属于 08。
   移走不是为"干净"，是**断环**：09 要 export validateGeometry / mergeStatics 给 08 用，
   若 09 又在**模块顶层**读 world，就变成"08 的 body 必须等 09 求值完、09 的 body 又必须等 08"，
   ESM 只会给你一个 TDZ：`ReferenceError: Cannot access 'world' before initialization`。
   ⚠️ 通则：**循环依赖里任何一方都不能在模块顶层读另一方的绑定**（写在函数体里读是安全的）。 */

/* ── 几何校验 ──
   合并前确认 position/uv/normal 计数一致、索引不越界、坐标有限。
   太湖石顶心曾经只 push position 不 push uv（11 座峰 → 合并后两个网格各差 11/4 条 uv）——
   这种错不报错、不 NaN，只是那几个三角形采到越界的 uv。机器查，别靠肉眼。 */
export function validateGeometry(g, tag){
  const P = g.attributes.position;
  if (!P) return true;
  const n = P.count, bad = [];
  if (g.attributes.uv     && g.attributes.uv.count     !== n) bad.push('uv ' + g.attributes.uv.count + '≠' + n);
  if (g.attributes.normal && g.attributes.normal.count !== n) bad.push('normal ' + g.attributes.normal.count + '≠' + n);
  if (g.attributes.color  && g.attributes.color.count  !== n) bad.push('color ' + g.attributes.color.count + '≠' + n);
  if (g.index){
    const ix = g.index.array;
    let mx = -1; for (let i = 0; i < ix.length; i++) if (ix[i] > mx) mx = ix[i];
    if (mx >= n) bad.push('索引越界 ' + mx + '≥' + n);
  }
  const pos = P.array;
  for (let i = 0; i < pos.length; i++) if (!isFinite(pos[i])){ bad.push('非有限坐标'); break; }
  if (bad.length) console.warn('[几何校验] ' + tag + '：' + bad.join('；'));
  return bad.length === 0;
}

/* ── 几何合并：同材质 + 同阴影标记的静态网格合并成单个 BufferGeometry ──
   把 draw call 从数百降到几十；动态物体（鱼、龟）不参与。
   2026-10-30（审查 W6/M7/S4）扩成三步，静态 InstancedMesh 也进来了（规则见 09b-batch.js 头注释）：
     ① 同几何内容的静态 InstancedMesh 拼成 1 个（仍是 InstancedMesh，风摆/积雪/拾取口径不变）；
     ② 落单的小件 InstancedMesh 展开进下面的同材质桶；
     ③ 普通网格按材质桶合并（原逻辑）。
   合并完**释放被替换掉的原件**（几何 dispose + InstancedMesh 实例缓冲 dispose），
   否则延迟批（已渲染过、VBO 已上传）的原几何显存会一直占到页面关闭（审查 M7）。 */

/* 季节按 count 截前缀、灯会按"每丛一个"取挂点的材质：这些 InstancedMesh 的身份本身就是语义
   （12f applyPresence 的分量 count、12c collectWisteriaHangPts 读 instanceMatrix.count 与 parent.position），
   拼起来会让"春天只剩第一棵树长叶"、灯会挂点错位 ⇒ 一律不动。风摆材质另由 windParams 判。 */
const INSTANCE_MERGE_SKIP_MATS = new Set([
  MAT.wisteria, MAT.wisteriaLeaf, MAT.peachLeaf, MAT.plumLeaf, MAT.peachFruit, MAT.peachPetal,
  MAT.peachBlossom, MAT.plumBlossomRed, MAT.plumBlossomYellow, MAT.plumBud, MAT.plumWithered,
  MAT.willowLeaf, MAT.leaf, MAT.lily, MAT.lotus,
]);
/* 祖先 userData 里允许出现的"惰性"键（只在建模期用、运行期没人读）：屋面高度场。 */
const INERT_ANCESTOR_KEYS = new Set(['heightAt']);

/* 一个 InstancedMesh 能不能动：返回 null = 可以；否则返回原因（进统计，便于排查"为什么没合"）。 */
function instanceBlockReason(o, root, anchorSet){
  if (Array.isArray(o.material) || !o.material) return 'array-material';
  if (o.isSkinnedMesh || o.isBatchedMesh) return 'special';
  if (!o.visible) return 'invisible';
  if (o.userData.noMerge) return 'noMerge';
  if (Object.keys(o.userData).length) return 'userData';              // aoSkip / 季节标记 / fullCount …
  if (o.frustumCulled === false) return 'dynamic';                     // 动态件的惯例：包围球不可靠
  if (o.instanceMatrix.usage !== THREE.StaticDrawUsage) return 'dynamic';
  if (o.count === 0 || o.count !== o.instanceMatrix.count) return 'partial-count';   // 之后会被填/被截
  if (o.material.userData && o.material.userData.windParams) return 'wind';
  if (INSTANCE_MERGE_SKIP_MATS.has(o.material)) return 'season-count';
  if (anchorSet.has(o)) return 'perch-anchor';                         // 06d 蜻蜓停栖锚点按 (object, instanceId) 引用
  if (o.customDepthMaterial || o.customDistanceMaterial) return 'custom-depth';
  if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return 'custom-render';
  const geo = o.geometry;
  if (!geo || !geo.attributes.position) return 'no-geometry';
  for (const k in geo.attributes) if (geo.attributes[k].isInstancedBufferAttribute) return 'instance-attr';
  /* 祖先链上任何一层带运行期状态（userData 非惰性键）或 noMerge ⇒ 这一支可能被整体缩放/摆动/查找，
     原件搬走就断了（例：芭蕉冠层 userData.crown 随季节缩放）。 */
  for (let p = o.parent; p && p !== root; p = p.parent){
    if (p.userData.noMerge) return 'ancestor-noMerge';
    for (const k in p.userData) if (!INERT_ANCESTOR_KEYS.has(k)) return 'ancestor-state';
  }
  return null;
}

/* 释放被合并掉的原件：几何只在**场景里已无人使用**时 dispose（共享几何/缓存几何还挂在别处就留着）；
   材质：合并件沿用原材质（桶材质），这里只在"场景里无人用 + 不是 MAT 库共享材质"时才 dispose（实测应为 0）。
   InstancedMesh.dispose() 释放实例矩阵/实例色缓冲。注意 dispose 只放 GPU 缓冲、CPU 数组还在 ——
   万一有人拿着旧引用做 CPU 射线（16-actors 地面采样表最多陈旧 3s）也不会崩。 */
const MAT_LIBRARY = new Set(Object.values(MAT));
function releaseDetached(objs, stats){
  if (!objs.length) return;
  const liveGeo = new Set(), liveMat = new Set();
  scene.traverse(o => {
    if (o.geometry) liveGeo.add(o.geometry);
    if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) liveMat.add(m);
  });
  const doneGeo = new Set(), doneMat = new Set();
  for (const o of objs){
    if (o.isInstancedMesh){ o.dispose(); stats.instDisposed++; }
    const g = o.geometry;
    if (g && !liveGeo.has(g) && !doneGeo.has(g)){ doneGeo.add(g); g.dispose(); stats.geoDisposed++; }
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])){
      if (!m || liveMat.has(m) || doneMat.has(m) || MAT_LIBRARY.has(m)) continue;
      doneMat.add(m); m.dispose(); stats.matDisposed++;
    }
  }
}

/* 每次合并的统计（启动时 world 一次、延迟批 deferRoot 一次），供 __garden.drawStats / 探针读。 */
export const MERGE_STATS = [];

/* ── 合批台账（2026-10-31 · batch3 静态合批引入的探针可见性缺口）──────────
   为什么要留这份：合批的 ② bake 路径会把小件 InstancedMesh **展开成普通几何**并进材质桶，
   原件随即 remove + 几何 dispose。于是"按 isInstancedMesh + geometry.parameters 去找某个实例网格"
   的门禁全部失效 —— smoke 的檐口三条当场报 "没找到瓦当/椽头实例网格"。
   ⚠️ 几何数据没丢（顶点都并进 mergedStatic 了），但**从合并后的顶点逆推"哪个实例是哪件、
      朝向如何"是不可靠的** —— 那等于把 bake 的变换反过来解一遍，任何一侧改动都会静默错。
   ⇒ 正确做法：合批**当场**把"这件是谁、原来在哪、多少实例"记下来，供门禁查证。
      只加数据、不改任何渲染行为（下面 push 的那几行不参与任何几何/材质计算）。
   ⚠️ 记录的是**世界矩阵**（已预乘各自 matrixWorld），与门禁原先读
      `o.getMatrixAt(j)` + `o.matrixWorld` 的口径一致。 */
export const MERGE_LEDGER = [];
function recordLedger(entry){ MERGE_LEDGER.push(entry); }

export function mergeStatics(root){
  root.updateMatrixWorld(true);
  const stats = { root: root === world ? 'world' : (root.name || 'deferRoot'),
                  meshGroups: 0, meshRemoved: 0, instGroups: 0, instGrouped: 0, instBaked: 0,
                  instBlocked: {}, geoDisposed: 0, matDisposed: 0, instDisposed: 0 };
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const detached = [];

  /* ── ① ② 静态 InstancedMesh 规划 ── */
  const anchorSet = new Set(perchingAnchors.map(a => a.object));
  const ims = [];
  root.traverse(o => { if (o.isInstancedMesh) ims.push(o); });
  const descs = ims.map(o => {
    const blocked = instanceBlockReason(o, root, anchorSet);
    return {
      blocked,
      geoKey: blocked ? null : geometrySignature(o.geometry),
      matKey: o.material && o.material.uuid,
      cast: o.castShadow, recv: o.receiveShadow, layers: o.layers.mask,
      name: o.name, renderOrder: o.renderOrder, hasColor: !!o.instanceColor,
      count: o.count, verts: o.geometry ? o.geometry.attributes.position.count : 0,
    };
  });
  const plan = planInstanceBatches(descs);
  stats.instBlocked = plan.blocked;

  /* ① group：拼成一个 InstancedMesh。实例矩阵 = rootInv · 原件 matrixWorld · 原实例矩阵 ⇒
     世界位姿逐实例不变（风摆/积雪 shader 读的是 modelMatrix·instanceMatrix 的世界坐标，结果一致）。 */
  const _mw = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _col = new THREE.Color();
  for (const idxs of plan.groups){
    const rep = ims[idxs[0]];
    /* 指纹相同还要逐字节核对；对不上的退回原样（宁可少合，不可错画）。 */
    const members = idxs.map(i => ims[i]).filter(o => sameGeometry(o.geometry, rep.geometry));
    if (members.length < 2) continue;
    const total = members.reduce((s, o) => s + o.count, 0);
    const im = new THREE.InstancedMesh(rep.geometry, rep.material, total);
    im.castShadow = rep.castShadow; im.receiveShadow = rep.receiveShadow;
    im.layers.mask = rep.layers.mask; im.renderOrder = rep.renderOrder;
    im.name = rep.name || 'mergedInstances';
    im.userData.mergedFrom = members.length;          // 探针抓手：这是合批产物（季节/挂点代码不认这个键）
    let k = 0;
    for (const o of members){
      _mw.multiplyMatrices(rootInv, o.matrixWorld);
      for (let i = 0; i < o.count; i++, k++){
        o.getMatrixAt(i, _mi);
        im.setMatrixAt(k, _mi.premultiply(_mw));
        if (o.instanceColor){ o.getColorAt(i, _col); im.setColorAt(k, _col); }
      }
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    root.add(im);
    /* 台账（group 路径）：合并后的 `im.geometry` 是"内容相同的几何"里的某一份，
       但 `geometry.parameters` 常常是 null（BufferGeometry 合并/克隆后就没有参数了），
       门禁再想按 `radiusTop` 之类去找就不成立。这里按**每个成员**记下它原来的
       参数与实例世界矩阵 —— 与 bake 那张表同一口径，门禁只读这一处。 */
    for (const o of members){
      const pr = (o.geometry && o.geometry.parameters) || {};
      const worlds = [];
      _mw.multiplyMatrices(rootInv, o.matrixWorld);
      for (let i = 0; i < o.count; i++){
        o.getMatrixAt(i, _mi);
        worlds.push(_mi.clone().premultiply(_mw).toArray());
      }
      recordLedger({ kind: 'group', name: o.name || '', mergedInto: im.name,
                     count: o.count, worldMatrices: worlds,
                     radiusTop: pr.radiusTop == null ? null : pr.radiusTop,
                     radiusBottom: pr.radiusBottom == null ? null : pr.radiusBottom,
                     height: pr.height == null ? null : pr.height });
    }
    for (const o of members){ if (o.parent) o.parent.remove(o); detached.push(o); }
    stats.instGroups++; stats.instGrouped += members.length;
  }

  /* ② bake：每个实例展开成一个"虚拟网格"项（geometry + 世界矩阵）塞进下面的材质桶。 */
  const bakeItems = [];
  for (const i of plan.bakes){
    const o = ims[i];
    /* 台账：这件 InstancedMesh 的全部实例世界矩阵（合批后原件会被 remove，
       门禁再想按几何参数找它就找不到了 —— 见 MERGE_LEDGER 的注释）。 */
    const worlds = [];
    for (let j = 0; j < o.count; j++){
      o.getMatrixAt(j, _mi);
      worlds.push(_mi.clone().premultiply(o.matrixWorld).toArray());
    }
    recordLedger({ kind: 'bake', name: o.name || '', count: o.count,
                   worldMatrices: worlds,
                   radiusTop: o.geometry && o.geometry.parameters ? o.geometry.parameters.radiusTop : null,
                   radiusBottom: o.geometry && o.geometry.parameters ? o.geometry.parameters.radiusBottom : null,
                   height: o.geometry && o.geometry.parameters ? o.geometry.parameters.height : null });
    for (let j = 0; j < o.count; j++){
      o.getMatrixAt(j, _mi);
      bakeItems.push({ geometry: o.geometry, material: o.material, castShadow: o.castShadow,
                       receiveShadow: o.receiveShadow, name: o.name,
                       matrixWorld: _mi.clone().premultiply(o.matrixWorld), src: o });
    }
  }

  /* ── ③ 普通网格按材质桶 ── */
  const buckets = new Map();
  const bucketOf = (o) => {
    /* ⚠️ 分桶键必须带上"有无顶点色"：带色与不带色的几何合并会因属性集不同而失败，
       而且顶点色是 SDF 立峰的 AO 载体 —— 丢了颜色，石头就变成一块死灰。
       （原来只留 position/normal/uv，所以立峰一律 noMerge 单飞；现在可以并进来了。）
       ⚠️ 键里**没有**图层：沿用原口径（行为不变）；bake 那一路只收默认图层的件，不会混进折射层。 */
    const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0)
              + (o.geometry && o.geometry.attributes.color ? '|c' : '');
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, list: [] });
    return buckets.get(key);
  };
  root.traverse(o=>{
    if (!o.isMesh || o.isInstancedMesh) return;
    if (o.userData.noMerge || Array.isArray(o.material)) return;
    bucketOf(o).list.push(o);
  });
  for (const it of bakeItems) bucketOf(it).list.push(it);

  const bakedDone = new Set();
  for (const b of buckets.values()){
    /* 普通网格沿用原规则：同桶 ≥2 个才合（落单的那一个保持原样 —— 它的名字可能是拾取/探针的抓手，
       不能因为桶里多了 bake 项就被顺手并掉）；bake 项只要有就合。 */
    const regs = b.list.filter(o => !o.src), bakes = b.list.filter(o => o.src);
    const list = (regs.length >= 2 ? regs : []).concat(bakes);
    if (!list.length) continue;
    const geos = [];
    for (const o of list){
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      /* ⚠️ 负行列式（镜像）物体：把 matrixWorld 烘进几何后**绕序会反转** ——
         三角形朝向与（已被 applyMatrix4 正确镜像的）法线相反。原来只烘矩阵不翻绕序，
         镜像构件合并后就变成反面：背面剔除下直接看不见；MAT.roof 这类 DoubleSide 材质
         虽被 gl_FrontFacing 兜住光照，但 AO 的法线 pass 与积雪的朝上判据读到的是反法线。
         翻一次绕序即可与法线一致。 */
      if (o.matrixWorld.determinant() < 0 && g.index){
        const ix = g.index.array;
        for (let t3 = 0; t3 + 2 < ix.length; t3 += 3){ const tmp = ix[t3]; ix[t3] = ix[t3 + 2]; ix[t3 + 2] = tmp; }
        g.index.needsUpdate = true;
      }
      if (!g.index){                                  // 统一为带索引
        const n = g.attributes.position.count;
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv){                          // 统一补 uv，否则合并会失败
        const n = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      const keep = new THREE.BufferGeometry();        // 保留 position/normal/uv（+ 顶点色）
      keep.setAttribute('position', g.attributes.position);
      keep.setAttribute('normal', g.attributes.normal);
      keep.setAttribute('uv', g.attributes.uv);
      if (g.attributes.color) keep.setAttribute('color', g.attributes.color);
      keep.setIndex(g.index);
      validateGeometry(keep, 'merge·' + (o.name || 'mesh'));
      geos.push(keep);
    }
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch(e){ merged = null; }
    if (!merged) continue;                            // 合并失败：bake 的原 InstancedMesh 原样留着
    validateGeometry(merged, 'merged·' + (b.mat.name || b.mat.uuid.slice(0, 8)));
    const mm = new THREE.Mesh(merged, b.mat);
    mm.castShadow = b.cast; mm.receiveShadow = b.recv;
    mm.name = 'mergedStatic';
    root.add(mm);
    for (const o of list){
      if (o.src){ bakedDone.add(o.src); continue; }   // bake 项：原 InstancedMesh 统一在下面摘
      if (o.parent) o.parent.remove(o);
      detached.push(o);
      stats.meshRemoved++;
    }
    stats.meshGroups++;
  }
  /* bake 的原件：它的**全部**实例都进了成功合并的桶才摘（一个 InstancedMesh 只属于一个桶，
     所以"桶成功"即"全部实例已落位"）。 */
  for (const o of bakedDone){ if (o.parent) o.parent.remove(o); detached.push(o); stats.instBaked++; }

  releaseDetached(detached, stats);
  MERGE_STATS.push(stats);
  console.log('[几何合并]', stats.meshGroups, '组材质 →', stats.meshRemoved, '个网格 · 实例拼合',
              stats.instGroups, '组/', stats.instGrouped, '个 · 实例展开', stats.instBaked, '个 · 释放几何',
              stats.geoDisposed, '/ 材质', stats.matDisposed);
  return stats;
}

/* ── draw call 统计入口（2026-10-30）：浏览器门验证用 ──
   纯遍历估算：主 pass = 可见网格数（InstancedMesh count>0 才算 1；多材质网格按 group 数）；
   阴影 pass = 其中 castShadow 的。另附上一帧 renderer.info（含后期/反射等全部 pass 的真实计数）。
   挂在 window.__garden.drawStats（08-assemble 在 bootDone 后挂），用法：__garden.drawStats()。 */
export function drawStats(){
  let main = 0, shadow = 0, inst = 0, merged = 0, meshes = 0;
  const byMat = new Map();
  scene.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    if (o.isInstancedMesh && o.count === 0) return;
    const n = Array.isArray(o.material) ? Math.max(1, (o.geometry.groups || []).length) : 1;
    main += n; if (o.castShadow) shadow += n;
    if (o.isInstancedMesh) inst++; else meshes++;
    if (o.name === 'mergedStatic' || o.userData.mergedFrom) merged++;
    const mk = Array.isArray(o.material) ? 'multi' : (o.material.name || o.material.type);
    byMat.set(mk, (byMat.get(mk) || 0) + n);
  });
  const top = [...byMat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  return { main, shadow, instancedMeshes: inst, meshes, mergedProducts: merged,
           rendererCalls: renderer.info.render.calls, rendererTris: renderer.info.render.triangles,
           gpuGeometries: renderer.info.memory.geometries, merges: MERGE_STATS.slice(), topMaterials: top };
}
/* bootMark('场景几何') / mergeStatics(world) / bootMark('几何合并') 三行已移到
   08-assemble.js 的 body 末尾 —— 同上的断环理由（合并对象是 world）。 */

export const sun = new THREE.DirectionalLight(CFG.sun.color, CFG.sun.intensity);
sun.position.set(...CFG.sun.pos);
sun.castShadow = true;
// 阴影精度由电脑画质档统一决定：性能 2048 / 均衡 4096 / 高 6144。
// ⚠️ 再按 GPU 纹理上限封顶（SHADOW_CAP，2026-10-30）：旧写法要 6144 时一批 GPU
//    驱动悄悄钳到 4096，声明值 ≠ 真实值，QOS 就再也不肯动这盏阴影。
sun.shadow.mapSize.set(Math.min(ACTIVE_QUALITY.shadow, SHADOW_CAP),
                       Math.min(ACTIVE_QUALITY.shadow, SHADOW_CAP));
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 190;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);
sun.target.position.set(0, 0, 0);

/* ══ 阴影视体：按「投射物的真实轮廓」自动拟合 ══
   ⚠️ 2026-09-18 重写。旧实现是固定 ±28/±24，再按 1/太阳仰角 放大（上限 2.2×，
   暮时 ±30/±26）。那个旋钮的**理由本身是错的**：ortho 阴影相机的视体 XY 轴与光线
   方向平行，影子的**长度**由 near/far 承担（1/190，余量极大），XY 只需要罩住投射物的
   **轮廓** —— 太阳再低也不用放大 XY。

   真正的问题正好相反：固定盒比园子的轮廓还**小**。正午光方位角 35.5°，
   60×45 的园子轮廓投影到光空间 X 轴达 ±37.5（实测投影物范围 ±36.2），
   四个角落到盒外；而**盒外既不做阴影测试、投射物也不进深度图** ——
   于是边界处出现「影子被硬切出一条直边、切边外是亮的」。
   用户报的「狂风暴雨里有些地方像有太阳透下来，换这个角度特别明显」里，
   一部分就来自这条被切出来的亮缝。

   改为：把投射物世界包围盒的 8 个角投到光空间取极值 → 盒永远刚好罩住全场。
   代价只是 8 次矩阵变换，任何光向变化都便宜；texel 密度 6144/(2×37.5) ≈ 82/m，
   仍高于最初固定盒的 45/m（那才是这一路的初衷）。near/far 顺手收紧，深度精度更好。 */
export const casterBox = new THREE.Box3();        // 投射物世界包围盒（合并后算一次，迟到资产置脏重算）
export let casterBoxDirty = true, casterBoxAt = -1e9;
/* ⚠️ 置脏必须走这个函数：拆模块后 12-env（资产迟到回调）是**import** 本变量再赋值的，
   ESM 导入绑定只读 → 直接写抛 "Assignment to constant variable"（原单体里同处一个词法世界）。
   读数（本模块内部判断）走 live binding，不受影响。 */
export function markCasterBoxDirty(){ casterBoxDirty = true; }
export function refreshCasterBox(){
  /* ⚠️ 必须先强制刷一次世界矩阵：`Box3.expandByObject` 内部只做 updateWorldMatrix(false,false)，
     也就是**信任父链的 matrixWorld** —— 父链还没算过时它读到的是单位矩阵，包围盒会算成错的
     （而且不报错，只是盒偏小 → 又回到"影子被切一条亮缝"）。 */
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3(); let n = 0;
  world.traverse(o => {
    if (!o.castShadow || !o.isMesh || !o.geometry) return;
    b.expandByObject(o); n++;               // InstancedMesh 走 object.boundingBox，含实例矩阵
  });
  if (n && !b.isEmpty()){ casterBox.copy(b); casterBoxDirty = false; }
  return n;
}
const _fitInv = new THREE.Matrix4(), _fitV = new THREE.Vector3();
export function fitShadowCamera(){
  /* 迟到资产（含 deferBoot 的延后批）会往世界里加真投射物，所以包围盒不能只算一次：
     置脏时立刻重算，否则最多每 3 秒自愈一次（一次遍历，静止时基本走不到这里）。 */
  const now = performance.now();
  if (casterBoxDirty || now - casterBoxAt > 3000){ refreshCasterBox(); casterBoxAt = now; }
  const c = sun.shadow.camera;
  const box = casterBox.isEmpty()
    ? new THREE.Box3(new THREE.Vector3(-CFG.garden.w / 2, 0, -CFG.garden.d / 2),
                     new THREE.Vector3( CFG.garden.w / 2, CFG.wall.h, CFG.garden.d / 2))
    : casterBox;
  /* 复刻 DirectionalLightShadow.updateMatrices 的朝向：相机就在光位、看向 target */
  c.position.copy(sun.position);
  c.up.set(0, 1, 0);
  c.lookAt(sun.target.position);
  c.updateMatrixWorld(true);
  _fitInv.copy(c.matrixWorld).invert();
  let L = Infinity, R = -Infinity, B = Infinity, T = -Infinity, ZN = Infinity, ZF = -Infinity;
  for (let i = 0; i < 8; i++){
    _fitV.set(i & 1 ? box.max.x : box.min.x,
              i & 2 ? box.max.y : box.min.y,
              i & 4 ? box.max.z : box.min.z).applyMatrix4(_fitInv);
    L = Math.min(L, _fitV.x); R = Math.max(R, _fitV.x);
    B = Math.min(B, _fitV.y); T = Math.max(T, _fitV.y);
    ZN = Math.min(ZN, -_fitV.z); ZF = Math.max(ZF, -_fitV.z);
  }
  /* 余量 1.5m：最边缘的投射物必须**整个**进图 —— 半个身子在盒外 = 只剩半个影子 */
  const M = 1.5;
  c.left = L - M; c.right = R + M; c.bottom = B - M; c.top = T + M;
  c.near = Math.max(0.5, ZN - M); c.far = ZF + M;
  c.updateProjectionMatrix();
  sun.userData.fitInfo = { L, R, B, T, ZN, ZF, n: casterBox.isEmpty() ? 0 : 1 };
  return sun.userData.fitInfo;
}
/* ⚠️ 这里**没有**顶层 `fitShadowCamera()` 调用 —— 它读 `world`，而 world 由 08-assemble 定义、
   且 08 反过来要 import 本模块的 mergeStatics/validateGeometry，构成环。本模块先求值 →
   顶层调用必撞 "Cannot access 'world' before initialization"。
   原 §9 段首的那次调用已移回 08 的 body 末尾（那里 world 才填满、且刚好是原 §8 跑完的时点）。 */

/* ── 阴影按需更新 ──
   6144² ≈ 3770 万纹素的深度图原来**每帧全量重渲**（autoUpdate 恒开），
   而且 Reflector 的镜像 pass 里还会再渲一遍 —— 光向与投射物静止时全是白干的。
   改为显式失效，触发点三处：
   ① 环境过渡期间（sunPos 每时段都在动，applyEnv 逐帧改光向）
   ② 资产迟到（晒背龟/芭蕉/莲 GLB 都是真投射物，onAssetAttached）
   ③ WebGL 上下文恢复（深度图纹理已丢，必须补渲一次）。
   主色 RenderPass 在 pass 链最前，会用完整可见性消费失效标记；GTAO 辅助
   pass 在其后且本就压着阴影，不会用"植被被隐藏"的状态渲出脏阴影。 */
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.domElement.addEventListener('webglcontextrestored', () => { renderer.shadowMap.needsUpdate = true; });

export const amb = new THREE.AmbientLight(CFG.amb.color, CFG.amb.intensity);
scene.add(amb);

// 补光：从水面方向反射的冷调反弹光，压暗部
export const fill = new THREE.DirectionalLight(0xbcd2e0, 0.32);
/* 家位：applyEnv 不写 fill 的位置 ⇒ 谁挪走了（烟花把它放到爆点方向）谁负责送回来。
   烟花的收尾帧按这个常量归位（12b-sky.js）。 */
export const FILL_HOME = new THREE.Vector3(-30, 14, -26);
fill.position.copy(FILL_HOME);
scene.add(fill);

// 天光半球，柔化阴影
// 保留引用：ENV 系统要按时段改它的天光/地光颜色与强度
export const hemiLight = new THREE.HemisphereLight(0xE8ECEA, 0x6B7B52, 0.35);
scene.add(hemiLight);