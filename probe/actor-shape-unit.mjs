// 演员对象"同形"单测（2026-11-26 · 执行效率批 · 多物体运动）：纯 node，与重播网同一套假场景。
// 运行：node --import ./probe/_actor-sim/register.mjs --test probe/actor-shape-unit.mjs
// 守什么：advance() 每帧读写 ACTORS / def / def.idle / VISIT / VISCAR 的字段。这些对象若分裂成多个
//   V8 隐藏类，访问点退成超多态、读一个 double 就装一个 HeapNumber，还会在剧情推进中反复反优化。
//   这类退化**不报错、不改画面、重播基线照样全绿**，只有 perf-sim-bench 的数字会悄悄变差 ——
//   所以在这里直接断言"跑完两场后各自仍只有一个隐藏类"。新加一个"后长的键"忘了登记就会红在这里。
// %HaveSameMap 需要 --allow-natives-syntax：运行期 v8.setFlagsFromString 打开，只影响此后新编的函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { loadSim, runVisit } from './_actor-sim/sim.mjs';
import { keyUnion, reshape, makeDefShaper, preshape, ACTOR_LATE_KEYS } from '../src/16a-actor-props.js';

v8.setFlagsFromString('--allow-natives-syntax');
const sameMap = new Function('a', 'b', 'return %HaveSameMap(a, b)');
const mapCount = (objs) => {
  const reps = [];
  for (const o of objs) if (!reps.some(r => sameMap(r, o))) reps.push(o);
  return reps.length;
};

test('keyUnion：首见顺序 + extra 去重追加', () => {
  assert.deepEqual(keyUnion([{ a: 1, b: 2 }, { c: 3, a: 4 }], ['b', 'd']), ['a', 'b', 'c', 'd']);
});

test('reshape：同序重建、缺键 undefined、表外键照抄、嵌套对象身份不变', () => {
  const spot = { x: 1 };
  const n = reshape({ b: 2, spot, z: 9 }, ['spot', 'a', 'b']);
  assert.deepEqual(Object.keys(n), ['spot', 'a', 'b', 'z']);
  assert.equal(n.a, undefined); assert.equal(n.b, 2); assert.equal(n.z, 9);
  assert.equal(n.spot, spot);
});

test('makeDefShaper：两份键不同的 def 重建后同一隐藏类（idle 亦然）', () => {
  const raw = [{ id: 'a', h: 1.7, idle: { breath: 0.01 } }, { h: 1.6, id: 'b', route: null, idle: { phase: 2, breath: 0.02 } }];
  const S = makeDefShaper(raw, ['floorMax'], ['go']);
  const [d0, d1] = S.all(raw);
  const d2 = S.one({ id: 'c', idle: { go: 'x' } });
  assert.equal(mapCount([d0, d1, d2]), 1);
  assert.equal(mapCount([d0.idle, d1.idle, d2.idle]), 1);
  assert.equal(d1.route, null); assert.equal(d0.floorMax, undefined); assert.equal(d1.idle.phase, 2);
});

test('preshape：只补缺键、不覆盖已有值', () => {
  const o = preshape({ arrived: true }, ['arrived', 'faceTo']);
  assert.equal(o.arrived, true);
  assert.ok('faceTo' in o); assert.equal(o.faceTo, undefined);
  assert.ok(ACTOR_LATE_KEYS.includes('_px') && ACTOR_LATE_KEYS.includes('riteCupOn'));
});

/* 模式在模块求值期读 location ⇒ 一个进程只能装一种；取产品默认 carriage-walkback（礼仪 + 走回去全开，长键最多的一档）。 */
{
  const mode = 'carriage-walkback';
  test(`${mode} 跑完两场：ACTORS / def / def.idle 各只有 1 个隐藏类，VISIT / VISCAR 不再长键`, async () => {
    const A = await loadSim(mode);
    const quiet = console.log, qw = console.warn; console.log = () => {}; console.warn = () => {};
    try {
      await runVisit(A, { maxSteps: 1 });
      const k0 = Object.keys(A.VISIT).length, c0 = Object.keys(A.VISCAR).length;
      await runVisit(A, { visits: 2, maxSteps: 20000 });
      assert.equal(mapCount(A.ACTORS), 1, '演员对象分裂成多个隐藏类：新加的后长键请补进 16a ACTOR_LATE_KEYS 表尾');
      assert.equal(mapCount(A.ACTORS.map(a => a.def)), 1, 'def 分裂：运行期新写的 def 键请补进 16-actors DEF_SHAPE 的 defExtra');
      assert.equal(mapCount(A.ACTORS.map(a => a.def.idle)), 1, 'def.idle 分裂：补进 DEF_SHAPE 的 idleExtra');
      assert.equal(Object.keys(A.VISIT).length, k0, 'VISIT 在戏里长了新键：补进 16-actors 的 preshape(VISIT, …) 表');
      assert.equal(Object.keys(A.VISCAR).length, c0, 'VISCAR 在戏里长了新键：在字面量里预先声明');
    } finally { console.log = quiet; console.warn = qw; }
  });
}
