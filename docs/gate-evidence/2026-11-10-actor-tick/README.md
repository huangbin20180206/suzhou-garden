# 门禁读数留痕 · 2026-11-10 · actor-tick-unit「主人近镜头复位」

**状态：已修复（2026-11-10 09:12）。本文是事故记录，不是待办。**

这一份存在的理由：a0c9518 的提交说明里写了「actor-tick-unit 的『主人近镜头复位』仍红，
声明与本次无关」——判断可能是对的，但当时没有任何文件能复核。于是补上三件事：
① 在改前基线上复跑同一道门，证明它本来就红；② 存档改前/改后两次原始读数；
③ 把它修到绿，并留下复跑命令。

## 三次读数（同一道门，同一台机器）

| # | 代码状态 | 文件 | 结果 |
|---|---|---|---|
| 00 | `3876c0c`（a0c9518 的父提交，工作副本 `E:\ai_test\sg-base-3876c0c`） | `00-baseline-3876c0c.log` | tests 10 / pass 9 / **fail 1** |
| 01 | `a0c9518`（提交说明里那一笔） | `01-before-a0c9518.log` | tests 10 / pass 9 / **fail 1** |
| 02 | 本次修复后 | `02-after-fix.log` | tests 10 / **pass 10** / fail 0 |
| 03 | 本次修复后 `npm run check` | `03-npm-check.log` | PASS（60 编译单元 / 380 文件 UTF-8 / PWA v45·v23 未越界） |
| 04 | 本次修复后 `actor-replay-unit` | `04-actor-replay.log` | tests 8 / pass 8 / fail 0 |

00 与 01 是**同一道门在两个不同提交上各红一次** ⇒ a0c9518「与本改动无关」这个结论成立，
但成立的方式是「父提交上照样红」，而不是「删掉改动就绿」。

## 断言原文（改前）

```
✖ 主人近镜头复位时先隐藏，再按延时恢复 (1.3377ms)
  AssertionError [ERR_ASSERTION]: 复位当帧不应提前显现
  true !== false
  at probe/actor-tick-unit.mjs:124:10
```

## 根因（已定位，非猜测）

`src/16-actors.js` 里两条"谁来管可见性"的路径抢同一个对象：

1. `resetVisit()`（3068 行）复位前调 `avoidCameraReveal(host.holder)`：相机近于 24m 就把主人
   藏起来并压进 `_avoidReveal` 队列，等 0.9s 由 `tickVisit` 顶部的计时循环放出来
   —— 目的是让人别在镜头前一帧闪现回起点。
2. `advance()`（3960 行起）每帧按 `actorVisibleNow()` 写一遍可见性：到访演员的豁免条件是
   `phase !== idle/done/homing`。复位的最后一步恰恰把 phase 写成 `idle`。

于是同一帧内顺序是「藏起来 → phase 变成 idle → 门控判定"现在不是演戏" → 按白昼时段
写回 visible=true」。净效果：藏了 0 毫秒，0.9s 的延时复亮从未生效。

诊断佐证（`outputs/_diag/probe-avoid-20261110.mjs`，运行时临时脚本，未入库）：
`hostId=scholar`、`camera dist to holder=1`、复位后 `phase=idle` 而 `visible=true`
—— 距离条件满足、队列也入过，可见性却被另一条路写回。

## 修法

`advance()` 的可见性写入点加一条：进了 `_avoidReveal` 的对象，这一路不写它
（复亮的所有权归计时器）。判据文件一个字未改。

```js
const vis = actorVisibleNow(a);
const pendingReveal = _avoidReveal.some(r => r.o === a.holder);
if (vis !== null && !pendingReveal && a.holder.visible !== vis){
```

## 复跑（任一条都能独立复现）

```bash
node --import ./probe/_actor-sim/register.mjs --test probe/actor-tick-unit.mjs
node --import ./probe/_actor-sim/register.mjs --test probe/actor-replay-unit.mjs
npm run check
```

基线对照要在改前的代码上跑，不要在主工作区跑（主工作区已经修好了）：

```bash
git worktree add ../sg-base-<sha> <sha>
# Windows：为工作副本建 node_modules junction，指向主仓库的 node_modules
node --import ./probe/_actor-sim/register.mjs --test probe/actor-tick-unit.mjs
```

## 边界声明

- 本次只跑相关单门 + `check` + 角色重放，**未跑全量 95 道**（全量约 90 分钟且需独占 GPU）。
- 修复只影响 `_avoidReveal` 名单内的对象（复位瞬间的主人、马车、被挪回原位的童子），
  不改变其他人物的昼夜门控。
- 未改动任何基线文件（`layout-fingerprint` 与 `probe/_actor-sim/*.json.gz` 均未触碰），
  所以本笔提交里代码与证据同笔、基线无变动，不存在「糊基线」的可能。
