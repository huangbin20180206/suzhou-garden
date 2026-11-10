# 2026-11-10 · 莲蓬杆漏打折射层（refract-coverage 5/6 → 6/6）

## 1. 缺陷
`probe/refract-coverage.mjs` 的反向扫描在整套门禁里连续两次红（第 1 次 + 重跑仍红），抓到 5 处「无理由缺席」：

```
✗ ② 反向扫描：池内越水面的几何没有"无理由缺席"的 — podStem(#3e7a34) 下探 0.16m（池内 0.16m）@跨0.2m ×5
```

莲蓬的杆（`src/06m-banana.js` 里 `name:'podStem'` 的 TubeGeometry，材质 `MAT.lotusStem`）根部扎在池底，下探水面以下 0.16m，却没有被放进「水下那一层」，于是从水面望下去这根杆像浮在水上。

## 2. 修法（判据一个字没动）
`src/06m-banana.js` 造杆后补一行：

```js
markUnderwater(podStemM);   // markUnderwater 定义在 src/05-water.js:134
```

- 判定依据：同文件第 456 行造水草时已有同样一笔标记，此处属**遗漏**，不是设计如此。
- 该对象已带 `userData.noMerge = true`，不会被材质桶合并掉，标记不会丢。
- 没有选「把梗抬到水面之上」这条路：梗根在水下更真实，且会牵动 2026-11-10 `a0c9518` 刚做的花梗/叶盘避让。

## 3. 读数对照
| 阶段 | 读数 | 来源 |
|---|---|---|
| 改前（全量第 1 次） | `5/6 FAILED`，② 反向扫描报 5 个 podStem | `00-before-fullsuite-refract-coverage.log` |
| 改前（全量重跑） | `5/6 FAILED`，同上 | 同上 |
| 改后（单门） | `6/6 ALL PASS`，`EXIT=0` | `01-after-refract-coverage.log` |

## 4. 哪条不能当证据
- 改后只跑了单门，**没有再跑整套**（按项目规矩：单相关门 + check 即可，全量攒批再跑）。
- 门本身不打印 GPU 行；本条判据是几何型（下探距离），不吃显卡档位，故不影响结论。
