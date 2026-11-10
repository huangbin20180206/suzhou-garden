# 2026-11-10 · 停栖蜻蜓「优先停花」引入的季节回归（修复）

## 1. 这次复核的对象
8ee865a「修：停栖蜻蜓默认机位只露 14px」，把 `pickPerchAnchor` 改成
**有花必停花、无花才停叶**。它的实测（停叶那只 0px、被邻叶整片遮住）与修法本身都成立，
夏天确实从 14px 抬到 25px，`legibility-guard` 由长期红转绿 —— 这条修是对的。

## 2. 但它带出一个门禁测不到的新问题
`legibility-guard` 只跑 **summer**（`probe/legibility-guard.mjs:56`）。而春/秋：

| 季节 | dragonflyShow | lotusShow | 花瓣网格 | 后果 |
|---|---|---|---|---|
| 春 | 0.35（蜻蜓在飞） | 0 | **隐藏** | 有花必停花 ⇒ 停在看不见的花上 |
| 夏 | 1.00 | 1 | 显示 | 正常（本次修复的目标态） |
| 秋 | 0.35 | 0 | **隐藏** | 同春 |
| 冬 | 0 | 0 | 隐藏 | 整组隐藏，无影响 |

季节通道按**材质同一性**切 `visible`（`12f-season.js` 的 `SEASON_PRESENCE`，
判据 `p[key] > 0.03`）⇒ `lotusShow=0` 时 `MAT.lotus` 的 InstancedMesh 整片不画，
而**锚点还在**（`perchingAnchors` 是建场期一次性登记、不随季节增删）。

改前落花概率只有 12/48 = 25%，两只蜻蜓同时悬空的概率约 6%；
改成"有花必停花"后变成 **100%**。

## 3. 实测（`outputs/_diag/perch-season-20261110.mjs`）
修前春/秋两只都是 `kind:"flower"` 且 `anchorMeshVisible:false`；修后：

```
春：kind=leaf  anchorMeshVisible=true  y=0.140 / 0.176
夏：kind=flower anchorMeshVisible=true  y=0.722 / 1.089   ← 目标态保住
秋：kind=leaf  anchorMeshVisible=true   y=0.125 / 0.141
冬：整组隐藏（dragonflyShow=0），不受影响
```

## 4. 修法
`pickPerchAnchor` 在"优先花"之前先按 `anchorVisible()` 过滤掉当前画不出来的锚点
（逐级往上问 `visible`，因为藏的可能是不带锚点的父组）。全部不可见时退回全集 —— 冬/暴雨
本就整组隐藏，那条路径走不到。

判据、阈值、锚点登记表一个字没动；只改了选点时的候选池。

## 5. 复跑
- `npm run check` PASS
- `npm run unit`：45 + 10 全过
- `verify-all --gates=legibility-guard,refract-coverage`：**ALL GATES PASS**
  （停栖蜻蜓 23→25px，余量更宽）
- 本目录 `01-after-fix.log` 为四季逐季读数

## 6. 复核补正（Chief，2026-11-10 16:40）
上面第 3 节的「修前：春/秋两只都是 kind:"flower" 且 anchorMeshVisible:false」当时只有推算，
本目录缺一份**改前读数**——按 `docs/gate-evidence/README.md` 的约定，这是不合格的证据形态。
现已补齐：`00-before-8ee865a.log` 取自独立工作副本
（`git worktree add E:/ai_test/sg-before-seasonal 8ee865a`，node_modules 用 junction 指回主仓库），
在改前那份代码上跑同一个诊断脚本 `outputs/_diag/perch-season-20261110.mjs`，读数：

```
春：kind=flower anchorMeshVisible=false  y=0.945 / 0.699   ← 悬在看不见的花上
夏：kind=flower anchorMeshVisible=true   y=0.722 / 1.089
秋：kind=flower anchorMeshVisible=false  y=0.562 / 0.699   ← 悬在看不见的花上
冬：visible=false（整组隐藏）
```

与第 3 节所述完全一致，**"改前 25% 落花概率被放大到 100%" 这个结论成立**，
但现在它是两个文件（00-before 与 01-after）对照出来的，不再是自述。

## 7. 没做的
- 没有在 `legibility-guard` 里加春/秋两档。加档会让这道门的时间成本 ×3，且当前缺陷
  已由上面这份逐季读数覆盖；若将来再出现"某元素只在单季可见"的问题，再考虑把它做成
  季节参数化的门。