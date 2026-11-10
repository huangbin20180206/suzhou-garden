# 2026-11-10 · 延迟批「每帧一批」改为「按时间预算连跑」

## 1. 问题
启动到「用户能交互」在本机（Intel Iris Xe / low 档）冷启动 19~27s，其中延迟装配段
`runDeferredBoot` 的 30 批之间空转明显。

## 2. 定位过程（含一次被推翻的判断）
先按"立峰批在同步编译着色器"定位，**实测推翻了**：注入计时后逐批读
`renderer.info.programs.length`，**30 批新增 program 全为 0**，立峰批自身只有 478ms。

再做逐批计时（`outputs/_diag/defer-cost-20261110.mjs`）：

```
建立合计  978ms
帧间空转 4399ms   ← 4.5 倍
```

逐帧 rAF 间隔（`outputs/_diag/defer-frames-20261110.mjs`）：这段共 44 帧，
最长帧 **2417ms**，1s 以上有 7 帧。即空转不是调度饿死，而是**每个渲染帧本身就 1~2s**。

原版 `next()` 的语义是「每帧一个 job」（注释里写死的"严格每帧一个 job"），
所以 30 批最多要等 30 个这样的长帧。而每批的实际工作只有 3~7ms（竹/兰档）。

## 3. 改法
`step()` 从「跑一个 job 就 return」改为**一帧内按 24ms 预算连跑**：

```js
const t0 = performance.now();
do { runOne(); } while (i < bootJobs.length && performance.now() - t0 < 24);
```

- 每帧**仍至少推进一批** ⇒ 保留"不会被调度饿死"这条不变量（原注释的核心担忧）；
- 预算 24ms ≈ 两帧交互预算，远小于单帧渲染成本，不会把主线程占死；
- `finish()` 抽成独立函数，四步收尾（mergeStatics / collectSeasonCaches /
  applyEnv / collectAOSkip）与 `markBootDone()` 时机**一字未动**。

## 4. 读数

### A/B（`01-ab-old-vs-new.log`，预热后交替各 3 轮）
| 轮次 | 旧·延迟段墙钟 | 新·延迟段墙钟 |
|---|---|---|
| #1 | 5435ms | 2152ms |
| #2 | 3300ms | 1245ms |
| #3 | 3580ms | 3197ms |
| **中位** | **3580ms** | **2152ms** |

⇒ **-1428ms（-40%）**。另一轮独立复跑中位 1941→1343ms（-31%）。
差距的两轮波动来自本机冷/热缓存差异，两次方向一致。

### warmboot-guard（改前长期 6/8 红，本次复跑）
```
✓ 首帧段被清空（≤800ms）— 首帧段=612.3ms        （改前 900.8ms，曾红）
✓ 启动总时长代价没失控（≤+35%）— 17811→16851ms（-960ms）  （改前 +5981ms，曾红）
✓ 8/8 全过，exit=0
```

### 其余门（全部 PASS）
- `npm run check` PASS
- `npm run unit` 45 + 10 全过
- `layout-fingerprint` ALL PASS（2 项）—— 延迟批的对象组成/位置未变
- `legibility-guard` ALL PASS（7 项）
- `visit-carriage-guard` ALL PASS（34 项）—— 专门守 "bootDone 不兑现" 的那道门

## 5. 边界与没做的
- 这只吃掉延迟段的 40%，而延迟段只占总启动约 9%。**主要开销仍是暖机的 10~13s
  着色器编译**（111 个 program，每个约 170~220ms），本次未动。
- 没有改暖机桶数/顺序；没有动 `markBootDone` 的时机契约。
- 本机档位是 `low`（Intel Iris Xe）。RTX 4060 档位下的读数未取。