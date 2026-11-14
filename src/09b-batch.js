// 09b-batch: 静态合批的**纯函数**部分（2026-10-30 · 审查 W6/M7/S4）。
// 不 import 任何东西（不碰 three / DOM）⇒ node 里能直接单测（probe/batch-plan-unit.mjs）
// 与静态估算（probe/draw-estimate.mjs）。真正动场景的执行部分在 09-lights.js 的 mergeStatics。
//
// 合批分三条路（按"行为保持"的把握从高到低）：
//   ① group：几何**内容逐字节相同** + 材质/阴影/图层/名字/渲染序一致的多个静态 InstancedMesh
//      ⇒ 拼成 1 个 InstancedMesh（实例矩阵预乘各自 matrixWorld）。仍是 InstancedMesh ⇒
//      风摆/积雪 shader（modelMatrix * instanceMatrix 取世界坐标与锚点）、射线拾取、
//      水洼射线（过滤 isInstancedMesh）全部与原来一致。
//   ② bake：几何独一份、实例少、顶点少的静态 InstancedMesh ⇒ 展开成普通几何
//      并进 mergeStatics 的同材质桶（0~1 个新 draw call）。只给非风摆、非季节计数的材质。
//   ③ keep：其余一律原样不动（风摆植被、季节按 count 截前缀的、灯会按"每丛一个"取挂点的、
//      蜻蜓停栖锚点引用的、动态的、带 userData 状态的……）。

/* 估算阈值：bake 只吃"小件"——实例 ≤160、展开后顶点 ≤12000。
   超过这个量展开会把顶点数据复制成几十 KB 以上，而 draw call 只省 1 个，不划算。 */
export const BAKE_MAX_INST = 160;
export const BAKE_MAX_VERTS = 12000;

/* ── 几何内容指纹：FNV-1a 扫一遍所有属性/索引的原始字节 ──
   入参是"像 BufferGeometry 的对象"（attributes / index / groups / drawRange / morphAttributes），
   不依赖 three。交错属性（InterleavedBufferAttribute）或缺 array 的返回 null ⇒ 调用方按"不可去重"处理。 */
export function geometrySignature(geo){
  if (!geo || !geo.attributes) return null;
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v; h = Math.imul(h, 16777619) >>> 0; };
  const mixStr = (s) => { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
  const mixArr = (arr) => {
    if (!arr || !arr.buffer) return false;
    // 按 32 位字读原始字节（Float32/Uint32 一一对应；16 位数组退化为按 16 位逐个读）
    if (arr.BYTES_PER_ELEMENT === 4){
      const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
      for (let i = 0; i < u.length; i++) mix(u[i]);
    } else {
      for (let i = 0; i < arr.length; i++) mix(arr[i] | 0);
    }
    mix(arr.length);
    return true;
  };
  const names = Object.keys(geo.attributes).sort();
  for (const n of names){
    const a = geo.attributes[n];
    if (!a || a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute) return null;
    mixStr(n); mix(a.itemSize | 0); mix(a.normalized ? 1 : 0);
    if (!mixArr(a.array)) return null;
  }
  if (geo.morphAttributes && Object.keys(geo.morphAttributes).some(k => (geo.morphAttributes[k] || []).length)) return null;
  if (geo.index){ mixStr('#idx'); if (!mixArr(geo.index.array)) return null; }
  for (const g of geo.groups || []){ mix(g.start | 0); mix(g.count | 0); mix(g.materialIndex | 0); }
  if (geo.drawRange){ mix(geo.drawRange.start | 0); mix(Number.isFinite(geo.drawRange.count) ? geo.drawRange.count | 0 : -1); }
  return names.length + ':' + (h >>> 0).toString(36);
}

/* 指纹相同还要**逐字节核对**一次才算同一几何（32 位哈希有碰撞概率，碰上了就是错画）。 */
export function sameGeometry(a, b){
  if (a === b) return true;
  if (!a || !b) return false;
  const na = Object.keys(a.attributes).sort(), nb = Object.keys(b.attributes).sort();
  if (na.length !== nb.length || na.some((n, i) => n !== nb[i])) return false;
  const eqArr = (x, y) => {
    if (!x || !y || x.length !== y.length || x.constructor !== y.constructor) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  };
  for (const n of na){
    const x = a.attributes[n], y = b.attributes[n];
    if (x.itemSize !== y.itemSize || !!x.normalized !== !!y.normalized) return false;
    if (!eqArr(x.array, y.array)) return false;
  }
  if (!!a.index !== !!b.index) return false;
  if (a.index && !eqArr(a.index.array, b.index.array)) return false;
  const ga = a.groups || [], gb = b.groups || [];
  if (ga.length !== gb.length) return false;
  for (let i = 0; i < ga.length; i++){
    if (ga[i].start !== gb[i].start || ga[i].count !== gb[i].count || ga[i].materialIndex !== gb[i].materialIndex) return false;
  }
  return true;
}

/* ── 合批规划 ──
   descs[i] = { blocked: null|'原因', geoKey: string|null, matKey, cast, recv, layers, name,
                renderOrder, hasColor, count, verts }
   blocked 由 09-lights 按 three 侧事实判（动态/风摆/季节计数/停栖锚点/userData 状态…）。
   返回 { groups: [[i,…],…], bakes: [i,…], keeps: [i,…], blocked: {原因: 个数} }。
   规则：先按完整键分组，≥2 个成员的走 group；落单的再看能不能 bake。
   ⚠️ 先 group 后 bake 是**刻意**的：group 之后仍是 InstancedMesh，射线/水洼过滤/拾取口径与原来完全一致；
      bake 会变成普通网格（12e 水洼的射线只认非实例网格），所以只留给"落单的小件"。 */
export function planInstanceBatches(descs, opt = {}){
  const maxInst = opt.maxInst ?? BAKE_MAX_INST, maxVerts = opt.maxVerts ?? BAKE_MAX_VERTS;
  const out = { groups: [], bakes: [], keeps: [], blocked: {} };
  const byKey = new Map();
  descs.forEach((d, i) => {
    if (d.blocked){ out.blocked[d.blocked] = (out.blocked[d.blocked] || 0) + 1; out.keeps.push(i); return; }
    const key = [d.geoKey || ('#solo' + i), d.matKey, d.cast ? 1 : 0, d.recv ? 1 : 0, d.layers | 0,
                 d.name || '', d.renderOrder | 0, d.hasColor ? 1 : 0].join('|');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(i);
  });
  for (const list of byKey.values()){
    if (list.length >= 2){ out.groups.push(list); continue; }
    const i = list[0], d = descs[i];
    /* bake 的额外条件：无实例色（展开会变成顶点色，改材质语义）、默认图层（折射层合并桶不认图层）、
       无名字（名字是拾取/探针的抓手，并进合并网格就丢了）。 */
    const bakeable = !d.hasColor && (d.layers | 0) === 1 && !d.name
                  && d.count > 0 && d.count <= maxInst && d.count * (d.verts | 0) <= maxVerts;
    (bakeable ? out.bakes : out.keeps).push(i);
  }
  return out;
}

/* 规划后的 draw call 估算（主 pass；阴影 pass 另按 cast 计）：
   group 每组 1、keep 每个 1、bake 每个新桶 1（已有同键桶 = 0）。
   existingBuckets：mergeStatics 普通网格那一路已有的桶键集合（`matKey|cast|recv`）。 */
export function estimateDraws(descs, plan, existingBuckets = new Set()){
  const newBuckets = new Set();
  for (const i of plan.bakes){
    const d = descs[i], k = d.matKey + '|' + (d.cast ? 1 : 0) + (d.recv ? 1 : 0);
    if (!existingBuckets.has(k)) newBuckets.add(k);
  }
  const main = plan.groups.length + plan.keeps.length + newBuckets.size;
  const shadowOf = (i) => (descs[i].cast ? 1 : 0);
  let shadow = plan.keeps.reduce((s, i) => s + shadowOf(i), 0)
             + plan.groups.reduce((s, g) => s + shadowOf(g[0]), 0);
  for (const k of newBuckets) if (k.slice(-2, -1) === '1') shadow++;   // 键尾两位 = cast recv
  const beforeShadow = descs.reduce((s, d) => s + (d.cast ? 1 : 0), 0);
  return { before: descs.length, beforeShadow, main, shadow, newBuckets: newBuckets.size };
}
