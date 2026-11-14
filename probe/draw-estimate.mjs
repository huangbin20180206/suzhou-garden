// 静态 InstancedMesh 合批的 draw call **静态估算**（2026-10-30 · 审查 W6）—— 纯 node、零浏览器。
//
// 数据来源：probe/_baseline/layout-fingerprint.txt（浏览器里 bootDone 后实录的全部 InstancedMesh：
//   材质色 | 实例数 | 几何类型 | 首实例坐标）。node 里建不起整园（要 WebGL/canvas），所以这里
//   **把每一行按源码事实翻译成合批描述符**，再喂给与运行时同一份规划函数
//   src/09b-batch.js 的 planInstanceBatches / estimateDraws —— 规则只有一份，估算与运行时不会分叉。
//
// 翻译表（下方 CLASSIFY）的每条都注明出处；认不出的颜色一律按"不可动"计（宁可少报节省）。
// 结果是**估算**：普通网格那一路（mergedStatic）不在指纹里，只按"bake 是否开新桶"计增量。
// 真值以浏览器里 `__garden.drawStats()` 为准（09-lights.js 的 drawStats，08-assemble 在 bootDone 后挂上）。
//
// 用法：node probe/draw-estimate.mjs            打印前后对比
//       node probe/draw-estimate.mjs --json     机器可读
//       node probe/draw-estimate.mjs --check    断言"估算后 ≤ 估算前 且 节省 ≥ 40"（回归锁）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planInstanceBatches, estimateDraws } from '../src/09b-batch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FP = path.join(ROOT, 'probe/_baseline/layout-fingerprint.txt');
const rows = fs.readFileSync(FP, 'utf8').split('\n')
  .filter(l => l.includes('|') && l.includes('首实例='))          // 数据行（表头行不含"首实例="）
  .map(l => {
    const [key, first] = l.split('\t');
    const [color, count, geom] = key.split('|');
    return { color, count: +count, geom, first: first.replace('首实例=', '') };
  });

/* ── 颜色 → 材质与合批事实（出处：src/01-materials.js 的 MAT 表 + addWind 表 + 09-lights 的 SKIP 表）── */
const WIND = { '#4e8c36': 'leaf(竹叶,风摆+季节叶量)', '#6e8f42': 'willow', '#6ba340': 'peachLeaf',
               '#3f6b34': 'reed(水草,风摆)', '#3e7a34': 'lily(荷叶,风摆+停栖锚点)', '#4f9440': 'banana' };
const SEASON = { '#5e7a3a': 'wisteriaLeaf(季节标记)', '#3f6b2e': 'plumLeaf(分量 count)' };
/* 同一调用点、同一参数建出来的几何（逐字节相同）⇒ 合批时会被 sameGeometry 认成同一份。
   每条都对着源码确认过参数是常量：
     · 竹竿：06j-herbs makeBamboo 的 culmBody/culmTip 常量参数（每丛新建、内容相同）
     · 竹节环：06j-herbs TorusGeometry(0.066,0.016,4,8)
     · 莲蓬籽窝/莲子：06m-banana makeLotusPod 的 cupGeo/seedGeo 常量参数
     · 挂落：04-buildings makeCorridor 的 instancedBoxes(drops, …, [0.14,0.34,0.12])
     · 筒瓦瓦当：03-factory makeChineseRoof 的 CylinderGeometry(0.105,0.105,0.1,10)（堂/榭两顶）
     · 槅扇细直棂：03-factory makeLatticePanel 的 gv/gh，尺寸随门扇宽高 ⇒ 只有"同尺寸门扇"才相同，
       这里按"实例数 + 首实例坐标都相同"近似认同一份（首实例坐标 = 由宽高决定的棂位）。 */
function family(r){
  if ((r.color === '#a8c46a' || r.color === '#7fa84c') && r.geom === 'BufferGeometry') return 'bambooCulm';
  if (r.color === '#7fa84c' && r.geom === 'TorusGeometry') return 'bambooNode';
  if (r.color === '#3a4a20' && r.count === 9) return 'podCup';
  if (r.color === '#c6ca86' && r.count === 9) return 'podSeed';
  if (r.color === '#4a2610' && r.geom === 'BoxGeometry' && r.first.endsWith('2.92,1.34')) return 'corridorDrop';
  if (r.color === '#3c444f' && r.geom === 'CylinderGeometry') return 'ridgeTile';
  if (r.color === '#4a2610' && r.geom === 'BoxGeometry' && r.count <= 4) return 'lattice@' + r.count + '@' + r.first;
  return null;
}
/* 阴影标记（出处见注释）。未列出的按 InstancedMesh 默认 cast=false/recv=false。 */
function shadowFlags(r, fam){
  if (fam === 'bambooCulm') return [true, false];         // 06j：inst.castShadow = true
  if (fam === 'corridorDrop') return [true, true];        // instancedBoxes
  if (fam && fam.startsWith('lattice')) return [true, false];   // 03：iv/ih.castShadow = true
  if (r.color === '#7c3f1d') return [true, true];          // 04：colInst cast/recv
  if (r.color === '#8e8d87' && r.geom === 'CylinderGeometry') return [false, true];  // 04：baseInst recv
  if (r.color === '#8a3a16' && r.count === 16) return [false, true];   // 04：栌斗/皿板 不投影
  if (r.color === '#8a3a16' || r.color === '#4a2610') return [true, true];   // instancedBoxes / instancedGeo / 圆椽
  return [false, false];
}
/* 普通网格那一路已有的桶（mesh() 默认 cast/recv = true；这些材质的普通构件遍布堂/廊/榭） */
const EXISTING = new Set(['woodDark', 'woodRed', 'wood', 'stoneDark'].map(m => m + '|11'));
const MATNAME = { '#4a2610': 'woodDark', '#8a3a16': 'woodRed', '#7c3f1d': 'wood', '#8e8d87': 'stoneDark',
                  '#a8c46a': 'bambooA', '#7fa84c': 'bambooB', '#3a4a20': 'lotusPodDark', '#c6ca86': 'lotusSeed',
                  '#bdd270': 'lotusPod', '#3c444f': 'ridge', '#9a9a92': 'riverStone' };

const descs = rows.map((r, i) => {
  const fam = family(r);
  const [cast, recv] = shadowFlags(r, fam);
  let blocked = null;
  if (r.count === 0) blocked = 'partial-count';                       // 灯会/季节件：之后才会被填
  else if (WIND[r.color]) blocked = 'wind';
  else if (SEASON[r.color]) blocked = 'season-count';
  else if (r.color === '#ffffff') blocked = 'white-ambiguous';        // 紫藤/柳叶帘/桃梅花果/荷花/芭蕉果…几乎全是风摆或季节计数
  else if (r.color === '-') blocked = 'shader';                       // 无 color 的 ShaderMaterial（天空/降水/雾片，动态）
  else if (!MATNAME[r.color]) blocked = 'unknown';                    // 认不出 ⇒ 按不可动计
  return {
    blocked, geoKey: fam || ('row' + i), matKey: MATNAME[r.color] || r.color, cast, recv,
    layers: r.color === '#9a9a92' ? 9 : 1,                            // 驳岸石：markUnderwater ⇒ 折射层
    name: '', renderOrder: 0, hasColor: r.color === '#9a9a92',         // 驳岸石：setColorAt
    count: r.count,
    /* 每实例顶点数（按几何类型的建模参数粗估；只影响 bake 的顶点上限判断） */
    verts: { BoxGeometry: 24, CylinderGeometry: 48, SphereGeometry: 63, TorusGeometry: 45,
             BufferGeometry: 120, ShapeGeometry: 40, IcosahedronGeometry: 60 }[r.geom] || 100,
    _row: r,
  };
});
const plan = planInstanceBatches(descs);
const est = estimateDraws(descs, plan, EXISTING);
const saved = est.before - est.main, savedShadow = est.beforeShadow - est.shadow;

const out = {
  source: path.relative(ROOT, FP), instancedMeshesBefore: est.before,
  mainPassBefore: est.before, mainPassAfter: est.main, mainSaved: saved,
  shadowPassBefore: est.beforeShadow, shadowPassAfter: est.shadow, shadowSaved: savedShadow,
  groups: plan.groups.map(g => ({ n: g.length, family: descs[g[0]].geoKey, mat: descs[g[0]].matKey })),
  baked: plan.bakes.map(i => descs[i].matKey + '×' + descs[i].count),
  newBuckets: est.newBuckets, blocked: plan.blocked,
};
if (process.argv.includes('--json')){ console.log(JSON.stringify(out, null, 2)); }
else {
  console.log(`[draw-estimate] 基线：${out.source}（${est.before} 个 InstancedMesh）`);
  console.log(`  主 pass   ：${est.before} → ${est.main}（省 ${saved}）`);
  console.log(`  阴影 pass ：${est.beforeShadow} → ${est.shadow}（省 ${savedShadow}）`);
  console.log(`  拼合组    ：${out.groups.map(g => g.family.replace(/@.*/, '') + '×' + g.n).join('、')}`);
  console.log(`  展开进桶  ：${out.baked.length} 个（新开桶 ${est.newBuckets} 个）`);
  console.log(`  不动      ：${JSON.stringify(plan.blocked)}`);
  console.log('  ⚠️ 估算：普通网格 mergedStatic 不在指纹里；真值以浏览器 __garden.drawStats() 为准。');
}
if (process.argv.includes('--check')){
  const ok = est.main <= est.before && saved >= 40;
  console.log(ok ? '[draw-estimate] PASS' : '[draw-estimate] FAIL：估算节省不足 40 或反而变多');
  process.exit(ok ? 0 : 1);
}
