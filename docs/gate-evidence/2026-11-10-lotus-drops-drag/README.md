# 2026-11-10 · 荷叶水珠 + 拖拽划水

## 一、改动前是什么样（这不是"修缺陷"，是补一条不存在的功能）

先查清楚再动手：雨、雪、檐滴、积水、湿地反光、点击起圈**早就都有了**
（`src/12e-precip.js` 的雨雪粒子 / `EAVE_DRIP` 檐滴 / `PUDDLES` 积水 / `postRainK()`，
`src/11-loop.js:132-160` 的点击起圈 + 投喂）。真正缺的只有两处，证据是检索为空：

```
$ grep -rn "水珠\|droplet" src/06j-herbs.js src/06m-banana.js src/08c-aquatic.js   # 无输出
$ grep -n "pointermove" src/11-loop.js                                            # 只有悬停射线，无落痕
```

所以本目录的 00-before 不是"红读数"，是**"这个功能此前不存在"**这一事实：
- 荷叶水珠：`git show 0b625d3:src/12e-precip.js | grep -c LOTUS_DROPS` → `0`
- 拖拽划水：`git show 0b625d3:src/11-loop.js | grep -c dragRippleLast` → `0`

## 二、改了什么

1. **荷叶水珠**（`src/12e-precip.js` 新增 `LOTUS_DROPS` 系统，16 颗 InstancedMesh）
   状态机三段：盘上静置 → 往盘沿滚 → 失支撑落水，落水处调注入的涟漪回调起一圈小圈，然后换一片叶盘重生。
   显隐只跟 `ENV.cur.wetness` 走（0.25 起显、0.7 满），所以晴、雨、雨后三种状态自动对。
   叶盘顶面由 `src/06j-herbs.js` 的 `makePondPads` 登记到 `group.userData.padTops`（每片 `{x,y,z,r}`），
   装配时 `src/08c-aquatic.js` 调 `bindLotusDrops(group)` 交进去。
2. **拖拽划水**（`src/11-loop.js` `pointermove` 内新增）
   按住拖过水面时，每 70ms 且位移 >0.12m² 才起一圈**小**涟漪（2 环 / 强度 0.55），
   与点击那一下（5 环 / 1.6）明显区分；拖拽本身仍是"转视角"，不抢手势。
3. **两条接线纪律**（写进源码注释，防后人重犯）
   - `12e` 不 import `06j/08c`：那会把装配期拉进环境状态机（本项目有 TDZ 前科）⇒ 走 `bindLotusDrops` 注入。
   - `12e` 不 import `06f-ripple`：`12e → 06f → 06g → 13-preload` 成链会把预加载器拽进来 ⇒ 走 `bindDropRipple(spawnRipple)` 注入。

## 三、读数对照

`01-after-lotus-drops.log`（`node outputs/_diag/lotus-drops-20261110.mjs`，钉 `?tier=low&debug=1`）：

| 时刻 | wetness | 水珠可见 | 透明度 | 累计落水 | 累计滚落 |
|---|---|---|---|---|---|
| 开园（晴） | — | false | 0 | 0 | 0 |
| 切晴后 2s | 0 | false | 0 | 0 | 0 |
| 切"雨后" 2.5s | 0.321 | **true** | 0.145 | 0 | 1 |
| 切"雨后" 14s | — | true | — | **36** | **40** |

拖拽划水：`DRAG {"at":47096.4,"x":1.09,"z":6.40}` ⇒ 门禁钩子 `dragRippleLast()` 拿到真实记录（z=6.40 落在池域内）。
`PAGEERRORS []` —— 无报错，注入链没有成环。

节奏标定：初版 14s 落 73 次（≈5.2 次/秒，太密），把重生静置时长从 `0.8+2.6r` 调到 `2.8+4.4r` 后为 **36 次/14s ≈ 2.6 次/秒**，涟漪池容量 64 环，不会被这一路占满。

`02-npm-check.log`：`check: PASS`（60 编译单元 / 395 文本文件 UTF-8）。
`03-smoke.log`：`ALL PASS（56 项）`，`draw calls=368 triangles=2,265,860` —— 16 颗水珠合成 1 个 InstancedMesh，draw call 没有可见增长。

## 四、哪一条不能当证据

- **"看起来像水珠"没有量化**：本目录只证明"有、在动、会落水、落水起圈、晴雨两态正确"，
  不证明"人眼觉得像水珠"。水珠直径 0.032m（约 6.4cm 压扁到 62%）、透明度上限 0.92，
  这两个数是按叶盘尺度（r≈0.6~1.2m）定的，没做过主观比对；嫌小/嫌大改 `SphereGeometry(0.032,…)` 一处即可。
- **拖拽只验了"留痕"，没验"手感"**：70ms / 0.12m² 两个阈值没扫过参数，是照点击那条链的量级推的。
- **没跑全量 95 道**（用户口径：不随改随跑）。相关门 `smoke` / `legibility-guard` / `reel-guard` 已单跑，
  但水珠会新增 1 个 InstancedMesh，若哪道门用总 draw call 数卡阈值，需在下一轮全量里看。
