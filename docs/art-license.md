# 写意艺术处理（Art License）说明

> 口径：**展示保留，标注为艺术处理，替代资产候选见表。**
> 决定人：Kyle（2026-10-30）。项目整体口径是**写意为主**，不追求逐件考据还原。

## 为什么有这份表

2026-10-29 代码审查（世界构建 W12 / W14）指出几件物件与明清苏州私家园林的实景不符。Kyle 的决定是：这些物件**继续展示**，在代码里统一打上「写意艺术处理」标记，并把可替代的资产候选列出来，等以后有合适资产时按表替换，不必再翻审查报告。

- 集中登记表（代码里的唯一出处）：`src/art-license.js` 里的 `ART_LICENSE`
- 打标方式：`markArtLicense(obj, id)`，作用是给物件写上 `obj.userData.artLicense = '写意艺术处理：……'` 和 `obj.userData.artLicenseId = id`
- 查询方式：`artLicenseOf(obj)`，会沿祖先链往上找，返回登记条目
- 回归锁：`node --test probe/art-license-unit.mjs`。表里标为「已打标」的条目，源码里必须真的有对应的调用

打标只往 `userData` 里加两个键，不动几何、材质、可见性和动作，不影响合批、季节显隐和拾取。

## 登记表

| 物件 | 实景对应 | 为何保留 | 替代资产候选 | 代码位置 / 打标状态 |
|---|---|---|---|---|
| **金刚鹦鹉**（3 只，栖于假山峰顶，会换峰飞行） | 原产中南美热带，明清江南园林没有放养、栖石的实景。园中常见的野鸟是白鹭、翠鸟、乌鸫、白头鹎、珠颈斑鸠、喜鹊；文人园居养鸟多是廊下笼养八哥、画眉 | 灰白太湖石和绿荫里唯一的高饱和点景，换峰飞行是园里少有的大尺度动态 | 八哥（廊下鸟笼或立石）、画眉（笼养，挂在廊檐下）、白鹭（池边浅水立姿）、翠鸟（临水立石） | `src/08c-aquatic.js` 的 Group `'Macaw'`：**已打标**；动作逻辑在 `src/08f-macaw.js` |
| **马厩**（东墙外，4 个槽位，带场院和马夫） | 苏州城内交通以舟楫、肩舆为主，私家园林外设马厩并不典型。明清宅园多设轿厅和河埠船埠 | 「访客到园」叙事（马车进出、马夫喂草）以此为依托，动作编排已经完整 | 明清园林里的马房或卸车棚（体量收小、粉墙黛瓦）、轿厅、河埠船埠（码头加乌篷船） | 在 `src/15e-stable.js` 里建；`src/08-assemble.js` 给整组**已打标**；院外两条石板路**待打标** |
| **西式双轮马车**（一驾套车待发、一驾卸马停放，另有到访马车） | 非明清江南形制。江南出行以轿子、船为主；北方有明式骡车/马车 | 到访编排（停车、卸马、出园路）离不开车辆 | 轿子（四人或二人肩舆）、明式马车（带篷厢、独辕双轮） | `src/15d-carriage.js`（`makeCarriage`，部件名 `carriagePart`）、`src/15e-stable.js`（carA/carB）、`src/16-actors.js`（到访马车）：均**待打标** |
| **外国马种**（卡马格马 Camargue、克里奥罗马 Criollo 带西式马鞍） | 明清中国常见的是蒙古马（矮壮、短腿、鬃毛厚） | 三匹 Rodin 马已经做完伪蒙皮和动作 | 蒙古马（现成资产 `assets/horse-mongolian.glb`，可以直接换进槽位） | `src/15c-horse-life.js` 的 `RODIN_GLB.camargue/criollo`；`src/15b-horse-rig.js` 的 Tinker 回退马：均**待打标** |

## 待打标（15 / 16 系模块，按分工本轮不改）

下面这些物件在 15 / 16 系模块里构建，本轮不改那些文件，等合并时补上 `markArtLicense`：

1. `src/15d-carriage.js` `makeCarriage()` 返回的车组，补 `markArtLicense(car, 'carriage')`
2. `src/15e-stable.js` 里的 `carA` / `carB`（也可以在上面第 1 步统一处理）；`makeStableRoad` / `makeStableExitRoad` 补 `'stable'`
3. `src/15c-horse-life.js`：camargue / criollo 两种马挂上槽位时补 `markArtLicense(horseRoot, 'foreignHorse')`（蒙古马不打）；`src/15b-horse-rig.js` 的 Tinker 回退路径同理
4. `src/16-actors.js`：到访马车补 `'carriage'`

完成后，把 `src/art-license.js` 里对应条目的 `status` 从 `'pending'` 改成 `'tagged'`。`probe/art-license-unit.mjs` 会检查源码里是否真的有这条调用。

## 替换时的注意事项

- 鹦鹉换成本地鸟时，`08f-macaw.js` 的落点和作息可以沿用。如果换成笼养鸟，就改为挂在廊下，季节作息改成「冬季入室」。替换后可以撤掉 `assets/Macaw.glb`（1.5MB），同时同步 `13-preload.js` / `sw.js` 两份清单（由 preload-manifest-sync 门把守）。
- 马种换成蒙古马，只需要改 `15c-horse-life.js` 的选马规则 `rodinSlotModel()`。资产已在预载清单里。
- 马厩、马车换成轿厅或船埠属于叙事改动，会影响 `16-actors` 的到访编排和 `08d-tour` 的 stable / stableNear 机位，需要单独立项。
