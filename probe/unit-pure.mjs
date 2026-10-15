// 纯函数单测（2026-10-15 · 完结 Phase 2）：node:test + node:assert，零新依赖、<1s。
// 为什么不用 vitest：这三处（00-config / 12a-presets）在 node 下可直接 import
// （shadow-product-gate 已有 12a 的 node import 前例），node:test 足够，不添依赖。
// ⚠️ 2b-wind 不在此列：它 import 01-materials（模块顶层建 Canvas 纹理，node 下
// document 未定义，实测 import 即抛）。风公式要测，先把公式抽成无 DOM 模块再说。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/00-config.js';
import {
  mixInto, paramsAtHour, nearestTimeKey, fmtHour, weatherMutexReason,
} from '../src/12a-presets.js';

test('mulberry32：同种子序列逐位一致，不同种子首值不同', () => {
  const a = mulberry32(20260924), b = mulberry32(20260924);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('mixInto：数值/数组线性插值，t=0 取 a、t=1 取 b', () => {
  const a = { x: 0, arr: [0, 10] }, b = { x: 10, arr: [10, 20] };
  const o0 = { x: -1, arr: [-1, -1] };
  mixInto(o0, a, b, 0);
  assert.deepEqual([o0.x, o0.arr[0], o0.arr[1]], [0, 0, 10]);
  const o1 = { x: -1, arr: [-1, -1] };
  mixInto(o1, a, b, 1);
  assert.deepEqual([o1.x, o1.arr[0], o1.arr[1]], [10, 10, 20]);
  const o5 = { x: -1, arr: [-1, -1] };
  mixInto(o5, a, b, 0.5);
  assert.deepEqual([o5.x, o5.arr[0], o5.arr[1]], [5, 5, 15]);
});

test('nearestTimeKey：边界 4.5/10/15/19.5 与 shadow-product-gate S3 同口径', () => {
  assert.equal(nearestTimeKey(4.5), 'morning');
  assert.equal(nearestTimeKey(9.99), 'morning');
  assert.equal(nearestTimeKey(10), 'noon');
  assert.equal(nearestTimeKey(14.99), 'noon');
  assert.equal(nearestTimeKey(15), 'dusk');
  assert.equal(nearestTimeKey(19.49), 'dusk');
  assert.equal(nearestTimeKey(19.5), 'night');
  assert.equal(nearestTimeKey(0), 'night');
  assert.equal(nearestTimeKey(4.49), 'night');
});

test('weatherMutexReason：互斥矩阵唯一权威口径', () => {
  assert.equal(weatherMutexReason('snow', 'winter'), null);
  assert.equal(weatherMutexReason('snow', 'summer'), '仅冬季可用');
  assert.ok(weatherMutexReason('storm', 'winter'));   // 冬季禁用狂风暴雨，原因非空即可
  assert.equal(weatherMutexReason('storm', 'summer'), null);
  assert.equal(weatherMutexReason('clear', 'summer'), null);
  assert.equal(weatherMutexReason('nope', 'summer'), null);  // 未知天气不红
});

test('paramsAtHour：24 小时逐小时无 NaN，月亮三维向量齐备', () => {
  for (let h = 0; h < 24; h++) {
    const p = paramsAtHour(h);
    assert.ok(Array.isArray(p.moonPos) && p.moonPos.length === 3, `h=${h} moonPos`);
    for (const v of p.moonPos) assert.ok(Number.isFinite(v), `h=${h} moonPos finite`);
    assert.equal(p.moonVis, 1);
    for (const k of ['sunIntensity', 'fogDensity']) {
      assert.ok(Number.isFinite(p[k]), `h=${h} ${k}`);
    }
  }
});

test('fmtHour：整点/半点/进位', () => {
  assert.equal(fmtHour(7.5), '07:30');
  assert.equal(fmtHour(12), '12:00');
  assert.equal(fmtHour(23.99), '23:59');
  assert.equal(fmtHour(23.999), '00:00');
});
