// 合批规划纯函数单测（2026-10-30 · 审查 W6/M7）：node:test，零浏览器、零 three。
// 钉住 src/09b-batch.js 的三条契约：
//   ① 几何指纹：内容相同 ⇒ 指纹相同；改一个顶点 ⇒ 指纹不同；sameGeometry 逐字节核对兜住哈希碰撞。
//   ② 规划：同键 ≥2 走 group；落单小件走 bake；被 blocked 的、带实例色/折射层/名字的落单件一律 keep。
//   ③ 估算：group 每组 1、keep 每个 1、bake 只在新桶时 +1。
// 用法：node --test probe/batch-plan-unit.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { geometrySignature, sameGeometry, planInstanceBatches, estimateDraws,
         BAKE_MAX_INST, BAKE_MAX_VERTS } from '../src/09b-batch.js';

/* 造一个"像 BufferGeometry 的对象"（只要 attributes/index/groups/drawRange） */
function fakeGeo(pos, idx){
  return {
    attributes: {
      position: { array: new Float32Array(pos), itemSize: 3, normalized: false },
      normal:   { array: new Float32Array(pos.map(() => 0.5)), itemSize: 3, normalized: false },
    },
    index: idx ? { array: new Uint16Array(idx) } : null,
    groups: [], drawRange: { start: 0, count: Infinity },
  };
}
const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

test('① 指纹：同内容同指纹，改一个顶点就变', () => {
  const a = fakeGeo(TRI, [0, 1, 2]), b = fakeGeo(TRI, [0, 1, 2]);
  assert.equal(geometrySignature(a), geometrySignature(b));
  assert.ok(sameGeometry(a, b));
  const c = fakeGeo(TRI.map((v, i) => (i === 4 ? 0.001 : v)), [0, 1, 2]);
  assert.notEqual(geometrySignature(a), geometrySignature(c));
  assert.equal(sameGeometry(a, c), false);
  // 索引不同（绕序翻转）也要能分开
  const d = fakeGeo(TRI, [0, 2, 1]);
  assert.notEqual(geometrySignature(a), geometrySignature(d));
  assert.equal(sameGeometry(a, d), false);
});

test('① 指纹：交错属性 / 实例属性 / morph ⇒ null（不可去重）', () => {
  const g = fakeGeo(TRI);
  g.attributes.offset = { isInstancedBufferAttribute: true, array: new Float32Array(3), itemSize: 3 };
  assert.equal(geometrySignature(g), null);
  const m = fakeGeo(TRI); m.morphAttributes = { position: [{}] };
  assert.equal(geometrySignature(m), null);
});

const base = (o = {}) => ({ blocked: null, geoKey: 'g1', matKey: 'mA', cast: true, recv: true, layers: 1,
                            name: '', renderOrder: 0, hasColor: false, count: 10, verts: 40, ...o });

test('② 规划：同键成组、落单小件 bake、blocked 原样', () => {
  const descs = [
    base(), base(), base(),                               // 0-2：同几何同材质 ⇒ 1 组
    base({ geoKey: 'g2' }),                               // 3：落单小件 ⇒ bake
    base({ geoKey: 'g3', hasColor: true }),               // 4：落单但有实例色 ⇒ keep
    base({ geoKey: 'g4', layers: 9 }),                    // 5：落单但在折射层 ⇒ keep
    base({ geoKey: 'g5', name: 'taihuPeak' }),            // 6：落单但有名字 ⇒ keep
    base({ blocked: 'wind' }),                            // 7：风摆 ⇒ keep
    base({ geoKey: 'g6', count: BAKE_MAX_INST + 1 }),     // 8：实例太多 ⇒ keep
    base({ geoKey: 'g7', verts: Math.ceil(BAKE_MAX_VERTS / 10) + 1 }),   // 9：展开顶点超限 ⇒ keep
    base({ cast: false }),                                // 10：阴影标记不同 ⇒ 不与 0-2 成组（落单 ⇒ bake）
    base({ geoKey: null }),                               // 11：无指纹 ⇒ 自成一键（落单 ⇒ bake）
  ];
  const p = planInstanceBatches(descs);
  assert.deepEqual(p.groups, [[0, 1, 2]]);
  assert.deepEqual(p.bakes.sort((a, b) => a - b), [3, 10, 11]);
  assert.deepEqual(p.keeps.sort((a, b) => a - b), [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(p.blocked, { wind: 1 });
});

test('② 规划：两个 geoKey=null 的件不会被误并成一组', () => {
  const p = planInstanceBatches([base({ geoKey: null }), base({ geoKey: null })]);
  assert.equal(p.groups.length, 0);
});

test('③ 估算：group 1 / keep 1 / bake 只计新桶', () => {
  const descs = [base(), base(), base({ geoKey: 'g2' }), base({ geoKey: 'g3', matKey: 'mB', cast: false }),
                 base({ blocked: 'dynamic', cast: false })];
  const p = planInstanceBatches(descs);
  const e = estimateDraws(descs, p, new Set(['mA|11']));     // mA 的 cast1/recv1 桶已存在
  assert.equal(e.before, 5);
  assert.equal(e.main, 1 /*组*/ + 1 /*keep*/ + 1 /*mB 新桶*/);
  assert.equal(e.newBuckets, 1);
  assert.equal(e.beforeShadow, 3);
  assert.equal(e.shadow, 1 /*组投影*/ + 0 /*keep 不投*/ + 0 /*mB 桶不投*/);
});
