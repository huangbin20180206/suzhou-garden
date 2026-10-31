// 纯函数单测（2026-10-15 · 完结 Phase 2）：node:test + node:assert，零新依赖、<1s。
// 为什么不用 vitest：这三处（00-config / 12a-presets）在 node 下可直接 import
// （shadow-product-gate 已有 12a 的 node import 前例），node:test 足够，不添依赖。
// ⚠️ 2b-wind 不在此列：它 import 01-materials（模块顶层建 Canvas 纹理，node 下
// document 未定义，实测 import 即抛）。风公式要测，先把公式抽成无 DOM 模块再说。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/00-config.js';
import { pickTier, isMobileUA, isDebugSurface } from '../src/00a-quality.js';
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

/* ── 画质档位判定（2026-10-30 · 架构收口：从 02-scene 提成纯函数后才有测试网）──
   这条判据此前**没有任何测试**，而它错了也不报错：判高 ⇒ 手机按 4K 预算跑、发热降频
   更卡；判低 ⇒ 独显用户白吃低画质。两边都只在"换台机器"时才现形。 */
test('pickTier：核显/软渲染 → low（词表来自实测 UNMASKED_RENDERER_WEBGL）', () => {
  assert.equal(pickTier({ gpuName: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)' }), 'low');
  assert.equal(pickTier({ gpuName: 'ANGLE (Google, Vulkan 1.0 (SwiftShader Device (Subzero)))' }), 'low');
  assert.equal(pickTier({ gpuName: 'Mesa/X.org llvmpipe (LLVM 15.0.6, 256 bits)' }), 'low');
});

test('pickTier：独显全系列（含本机 RTX 4060）→ high', () => {
  assert.equal(pickTier({ gpuName: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU, D3D11)' }), 'high');
  assert.equal(pickTier({ gpuName: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060, D3D11)' }), 'high');
  assert.equal(pickTier({ gpuName: 'ANGLE (AMD, Radeon RX 6800 XT Direct3D11)' }), 'high');
  assert.equal(pickTier({ gpuName: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro)' }), 'high');
});

test('pickTier：手机/平板一律不超 mid（Adreno/Mali 哪个正则都不中，只能看 UA）', () => {
  assert.equal(pickTier({ gpuName: 'ANGLE (Qualcomm, Adreno (TM) 740, Vulkan)' }), 'mid');
  assert.equal(pickTier({ gpuName: 'Mali-G78 MP14' }), 'mid');
  // UA 命中移动端时，即便 GPU 名是独显词也不给 high
  assert.equal(pickTier({ gpuName: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060)', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), 'mid');
});

test('pickTier：iPadOS 13+ 冒充 Macintosh，靠 maxTouchPoints>1 拦住', () => {
  const ipadUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  assert.equal(isMobileUA(ipadUA, 5), true);
  assert.equal(isMobileUA(ipadUA, 0), false);            // 真 Mac（触控板不会让这个值 >1）
  assert.equal(pickTier({ gpuName: 'ANGLE (Apple, Apple M1)', userAgent: ipadUA, maxTouchPoints: 5 }), 'mid');
});

test('pickTier：叫不出名字的 GPU 落 mid，不再默认 high', () => {
  assert.equal(pickTier({ gpuName: '' }), 'mid');
  assert.equal(pickTier({ gpuName: 'ANGLE (VMware, SVGA3D; bare-metal)' }), 'mid');
  assert.equal(pickTier({}), 'mid');
});

/* ── 调试接口收起（2026-10-30 · 架构收口）──
   本机永远走不到"生产分支"，不抽成纯函数就只能靠读代码觉得对。 */
test('isDebugSurface：生产域收起、本机与门禁环境展开', () => {
  // 生产：真域名的普通访问 ⇒ 收起
  assert.equal(isDebugSurface({ hostname: 'garden.example.com' }), false);
  assert.equal(isDebugSurface({ hostname: 'suzhou-garden.vercel.app' }), false);
  // 本机（老黄的日常）⇒ 展开，体验一位不变
  assert.equal(isDebugSurface({ hostname: 'localhost' }), true);
  assert.equal(isDebugSurface({ hostname: '127.0.0.1' }), true);
  assert.equal(isDebugSurface({ hostname: 'garden.localhost' }), true);
  assert.equal(isDebugSurface({ hostname: '' }), true);              // file://
  // 门禁/诊断
  assert.equal(isDebugSurface({ webdriver: true, hostname: 'garden.example.com' }), true);
  assert.equal(isDebugSurface({ search: '?debug=1', hostname: 'garden.example.com' }), true);
  // 反例：光有 ?debug=0 不算
  assert.equal(isDebugSurface({ search: '?debug=0', hostname: 'garden.example.com' }), false);
});

/* ── 写意标注表（2026-10-30 · 内容批次）──
   表本身是数据，但它有两条会被悄悄破坏的性质：每条都要有 label 与 text（漏了
   导览会显示 "undefined"），且 id 必须与机位 id 对得上（对不上=注永远不出现）。 */
test('ARTISTIC_NOTES：每条都有 label/text，且 key 与机位 id 对得上', async () => {
  const { ARTISTIC_NOTES, artisticNoteFor } = await import('../src/16b-artistic-note.js');
  const ids = Object.keys(ARTISTIC_NOTES);
  assert.ok(ids.length >= 3, '标注表不该空');
  for (const id of ids){
    const n = ARTISTIC_NOTES[id];
    assert.ok(n && typeof n.label === 'string' && n.label.length, `${id} 缺 label`);
    assert.ok(typeof n.text === 'string' && n.text.length > 20, `${id} 的 text 太短或缺失`);
  }
  // 机位 id 的真实来源：08d 的 VIEWPOINTS。这里只校验几个确定存在的
  for (const id of ['lantern', 'stable']) assert.ok(ARTISTIC_NOTES[id], `缺 ${id} 的注`);
  assert.equal(artisticNoteFor('no-such-id'), null);   // 未登记 ⇒ null，不加也不兜底
});

/* ── QOS 相对阈值（2026-10-31 · B3）───────────────────────────────────── */
import { qosThresholds, qosVerdict, estimateRefreshHz } from '../src/00a-quality.js';

test('qosThresholds：60Hz 下恰为旧的 45 / 58（行为不变）', () => {
  assert.deepEqual(qosThresholds(60), { target: 60, down: 45, up: 58 });
  assert.deepEqual(qosThresholds(NaN), { target: 60, down: 45, up: 58 });   // 测不到按 60
});

test('qosThresholds：高刷屏封顶 60，不因跑不满 144 被判吃力', () => {
  assert.deepEqual(qosThresholds(144), { target: 60, down: 45, up: 58 });
});

test('QOS：30Hz 设备满帧运行不被误降档', () => {
  const th = qosThresholds(30);
  assert.equal(th.target, 30);
  for (const fps of [28, 29, 30, 31]) assert.notEqual(qosVerdict(fps, th), 'down', `fps ${fps}`);
  /* 真吃力（跑不到 75%）仍要降 */
  assert.equal(qosVerdict(20, th), 'down');
  /* 对照：旧的绝对阈值会把 30fps 判成降档 */
  assert.equal(qosVerdict(30, qosThresholds(60)), 'down');
});

test('qosVerdict：60Hz 边界与旧比较语义逐位一致', () => {
  const th = qosThresholds(60);
  for (let fps = 0; fps <= 75; fps++){
    const old = fps < 45 ? 'down' : fps > 58 ? 'up' : 'hold';
    assert.equal(qosVerdict(fps, th), old, `fps ${fps}`);
  }
});

test('estimateRefreshHz：第 10 百分位，暖机长帧不污染；样本不足返回 0', () => {
  const s60 = [...Array(200).fill(1 / 60), ...Array(40).fill(0.4), ...Array(30).fill(0.08)];
  assert.equal(estimateRefreshHz(s60), 60);
  assert.equal(estimateRefreshHz([...Array(100).fill(1 / 30), ...Array(20).fill(0.2)]), 30);
  assert.equal(estimateRefreshHz(Array(200).fill(1 / 144)), 144);
  assert.equal(estimateRefreshHz([1 / 60, 1 / 60]), 0);
  assert.equal(estimateRefreshHz(undefined), 0);
});
