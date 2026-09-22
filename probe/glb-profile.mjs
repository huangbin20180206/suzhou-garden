// GLB 高度剖面探针（2026-09-17）：量 LotusPlant.glb 的顶点高度分布，
// 用来定位「花瓣在哪个高度」—— GLB 是单 mesh + 一张贴图，花与叶全烘进几何，
// 代码只知道自己补的杆有多高，不知道花长在哪，所以"杆没接到花"只能靠实测。
// 做法：直接解析 GLB 容器（JSON chunk + BIN chunk），读 POSITION accessor 的 float32，
// 按 y 分桶统计顶点数与水平半径 —— 花瓣是「顶点密集 + 水平半径小」的簇，
// 叶盘则是「同一高度上水平半径大」的盘子。不走 GLTFLoader（Node 下要补 self 垫片）。
// 用法: node probe/glb-profile.mjs [file] [buckets]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(ROOT, 'assets', 'LotusPlant.glb');
const NB = parseInt(process.argv[3] || '24', 10);

const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('不是 GLB（magic 不符）');

let off = 12, json = null, bin = null;
while (off < buf.length){
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4E4F534A) json = JSON.parse(data.toString('utf8'));
  else if (type === 0x004E4942) bin = data;
  off += 8 + len + ((4 - (len % 4)) % 4);
}
if (!json) throw new Error('GLB 里没有 JSON chunk');
console.log(`[GLB] ${path.relative(ROOT, file)}  大小 ${(buf.length / 1048576).toFixed(2)} MiB`);
console.log(`[GLB] meshes=${json.meshes?.length || 0} nodes=${json.nodes?.length || 0} ` +
            `images=${json.images?.length || 0} materials=${json.materials?.length || 0}`);
console.log(`[GLB] extensionsUsed=${JSON.stringify(json.extensionsUsed || [])}`);

/* 收集所有 POSITION accessor，并叠加它所在 node 的变换（GLB 常把缩放/平移放在 node 上）。 */
function nodeMatrix(n){
  const m = { s: [1, 1, 1], t: [0, 0, 0] };
  if (n.scale) m.s = n.scale;
  if (n.translation) m.t = n.translation;
  return m;
}
const parents = new Map();
(json.nodes || []).forEach((n, i) => (n.children || []).forEach(c => parents.set(c, i)));
function worldXf(i){
  let s = [1, 1, 1], t = [0, 0, 0];
  let cur = i;
  while (cur !== undefined){
    const m = nodeMatrix(json.nodes[cur]);
    s = [s[0] * m.s[0], s[1] * m.s[1], s[2] * m.s[2]];
    t = [t[0] + m.t[0] * s[0], t[1] + m.t[1] * s[1], t[2] + m.t[2] * s[2]];
    cur = parents.get(cur);
  }
  return { s, t };
}

let all = [];
(json.meshes || []).forEach((mesh, mi) => {
  mesh.primitives.forEach((prim, pi) => {
    const acc = json.accessors[prim.attributes.POSITION];
    if (!acc || acc.componentType !== 5126) return;
    const bv = json.bufferViews[acc.bufferView];
    const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || 12;
    // 找到使用该 mesh 的 node，取它的世界变换
    let xf = { s: [1, 1, 1], t: [0, 0, 0] };
    (json.nodes || []).forEach((n, i) => { if (n.mesh === mi) xf = worldXf(i); });
    for (let v = 0; v < acc.count; v++){
      const o = start + v * stride;
      all.push([
        bin.readFloatLE(o) * xf.s[0] + xf.t[0],
        bin.readFloatLE(o + 4) * xf.s[1] + xf.t[1],
        bin.readFloatLE(o + 8) * xf.s[2] + xf.t[2],
      ]);
    }
    console.log(`  mesh[${mi}].prim[${pi}] 顶点 ${acc.count}  scale=${JSON.stringify(xf.s)}`);
  });
});
if (!all.length) throw new Error('没有可读的 POSITION（可能是 Draco 压缩）');

const ys = all.map(p => p[1]);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const H = maxY - minY;
console.log(`\n[高度] native 高 ${H.toFixed(3)}m（y ${minY.toFixed(3)} → ${maxY.toFixed(3)}），顶点 ${all.length}`);

/* 分桶：每桶统计顶点数、最大水平半径、平均半径 */
const buckets = Array.from({ length: NB }, () => ({ n: 0, rmax: 0, rsum: 0 }));
for (const [x, y, z] of all){
  let k = Math.floor(((y - minY) / H) * NB);
  if (k >= NB) k = NB - 1; if (k < 0) k = 0;
  const r = Math.hypot(x, z);
  const b = buckets[k];
  b.n++; b.rsum += r; if (r > b.rmax) b.rmax = r;
}
console.log('\n[剖面]  归一化高度 → 顶点数 / 最大水平半径 / 平均半径');
buckets.forEach((b, k) => {
  if (!b.n) return;
  const t0 = k / NB, t1 = (k + 1) / NB;
  const bar = '#'.repeat(Math.min(52, Math.round(b.n / all.length * 260)));
  console.log(`  ${t0.toFixed(2)}-${t1.toFixed(2)}  y=${(minY + t0 * H).toFixed(2)}~${(minY + t1 * H).toFixed(2)}m` +
              `  n=${String(b.n).padStart(5)}  rmax=${b.rmax.toFixed(3)}  rmean=${(b.rsum / b.n).toFixed(3)}  ${bar}`);
});
