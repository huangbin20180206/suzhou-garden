# 导览补站方案 · 石灯笼 + 主峰近景（2026-10-14 · 观感第 4 条）

> 状态：**已落地（2026-10-17）**。两站已进 src/08d-tour.js（VIEWPOINTS / TOUR_CAPTIONS /
> TOUR_ORDER 十站）与 index.html（按钮 + 色表），实测数据见下方 §5 的落实结果。
> ⚠️ 本文里的行号是**编码前**的：导览代码已于 2026-10-15 W1 拆分从 08-assemble.js 搬到
> src/08d-tour.js（纯搬家），引用行号仅供追溯，定位一律以原文片段为准。
>
> **§5 落实结果（2026-10-17 实测，探针 probe/_tmp-tour-newstations-measure.mjs +
> probe/_tmp-tour2-shots.mjs）**：
> ① 灯笼站位三选一实测 —— A(2.2,−1.2) insidePond=true 落水、C(5.4,−2.5) 亦落水，
>    **只有 B(2.6,−1.7) 在岸上**（向下射线落地 y=0.068、距灯笼 2.52m、视点高于火袋 0.58m）⇒ 取 B；
> ② 主峰包围盒实测 3.97 × 4.49 × 3.82（水上顶高 3.31m），6.5m + fov 46° 的纵向视高 6.06m
>    ⇒ 峰体入画不切顶 ⇒ 6.5 / 侧偏 0.45 直接采用，未微调；
> ③ 落位距离实测：lantern 设计 2.59m 实到 2.59m、heroPeak 设计 7.14m 实到 7.14m
>    （均未被 controls.update() 钳回），零 pageerror；落位图 outputs/_diag/tour-lantern-new.png、
>    tour-heroPeak-new.png、tour-lantern-night.png（夜里火袋自带 emissive 读得出来）。
>
> ⚠️ 一处与本文原方案的偏差（以实况为准）：灯笼站在岸上朝北看，**背景是远香堂与石桌茶客，不是水面**
>    —— 计划里写的"南侧水面入画作背景"没能成立（水面侧的候选站位全落水）。文案已按实况写，
>    不写"照着脚下一方水岸"（它没有真光源、地面不亮，只是火袋自发光）。

## 0. 落地前置事实（本方案的三块地基，均已在盘上核实）

| 事实 | 出处 |
|---|---|
| 石灯笼已接线进场景：`stoneLantern` holder 落位 **(4.0, −3.8)**、y 走 `groundHeight`（实测 0.053）、高 1.05m、1000 面、火袋四面开窗、`lantern_glow` emissive 模型自带 | `src/08-assemble.js:2886-2907` |
| 灯笼竖向分段：基座 0-0.16 / 柱 0.16-0.50 / 中台 0.50-0.60 / **火袋 0.60-0.84（中心 0.72）** / 笠 0.84-1.00 / 宝珠 1.00-1.05 | `research/diy-lantern/build_lantern.py:10-17` |
| 立峰落点不写死：`HERO_POS` 运行期由 `POND_RADII`（ang0=0.67π，0.95 倍）反推 | `src/08-assemble.js:3117-3123` |
| 巡游三处既有结构：`VIEWPOINTS`（:3553 起，导览增补三站在 :3660-3687）/ `TOUR_CAPTIONS`（:3705-3725）/ `TOUR_ORDER`（:3738，现 8 站） | `src/08-assemble.js` |
| 面板按钮在导览行（`<button data-view="...">`），颜色走 `::before` 色表 | `index.html:862-886`（按钮）/ :279-294（颜色） |
| `CAM_MIN_DIST = 1.6`；近观机位必须**显式 minDist**，否则 `gotoViewpoint` 落位瞬间被钳回默认 | `src/02-scene.js:122`、`08-assemble.js:3689-3696` |

## 1. 新站 ① `lantern`（石灯笼 · 北岸）

### 机位
```js
/* 「石灯笼」：stoneLantern (08-assemble :2897-2907) 落位 (4.0,−3.8)、高 1.05m，
   火袋中心局部 y=0.72（build_lantern.py :10-17 分段），世界 y≈0.77。
   中景 = 灯笼全高 + 火袋读得清 + 南侧水面入画作背景。
   ⚠️ 站位三候选中**探针实测后三选一**（岸线是 insidePond 程序化，方案期不硬猜）：
     A pos(2.2,1.50,−1.2) 距灯笼 3.16m —— 最远、灯笼在画中占比小
     B pos(2.6,1.35,−1.7) 距灯笼 2.52m —— 推荐：≈2.5m 处 1.05m 高物占画幅高约 45%
     C pos(5.4,1.40,−2.5) 距灯笼 1.91m —— 最贴、但易切顶
   y 取 1.35~1.50：略俯火袋（0.77），基座仍入画。
   探针口径：groundHeight(x,z) + 05-water insidePond 双查，任一落水即弃。 */
{ id:'lantern', label:'石灯笼',
  pos: new THREE.Vector3(2.6, 1.35, -1.7),        // ← 候选 B，待实测定稿
  target: new THREE.Vector3(4.0, 0.78, -3.8),
  minDist: 1.2 },
```
minDist 1.2：对齐 plumRed/plumYellow/stableNear 的近观档；1.05m 高的灯笼要能推近读窗棂。

### 插入点（VIEWPOINTS）
`08-assemble.js:3686` —— `bridge` 条目闭括号 `},` 之后、`];`（:3687）之前，与导览增补三站同段收尾。

### 字幕（TOUR_CAPTIONS :3725 ``bridge`` 行后插）
```js
  /* 「石灯笼」站：anchor = stoneLantern (08-assemble :2897，(4.0,−3.8) 北岸)。
     文案贴既有设定：火袋四面开窗、夜灯 emissive 自带（12d 体系外第一件自带发光的实体）。 */
  lantern:  { title: '石灯笼', text: '北岸一盏矮灯，笠下火袋四面开窗。入夜不必点烛 —— 石身自带一膛暖光，照着脚下一方水岸。' },
```

## 2. 新站 ② `heroPeak`（主峰近景 · 与 hero 中景互为两档）

### 机位（**必须运行时反算，不写死** —— hero/stele 同一条路）
```js
/* 「主峰近观」：与 hero（包围盒反算 ≈14m 中景）互为远近两档。
   锚点复用本闭包内的 hp/out/side（:3537-3539），距离 6.5m、侧偏 0.45——
   与 stele（正径向 −6m，:3562-3565）方位错开约 25°，两站不同框。
   ⚠️ 数值 6.5/0.45 是**构图起点**，落地时按 GLB 实际包围盒微调（探针量，不手填）。 */
{ id:'heroPeak', label:'主峰近观',
  pos: new THREE.Vector3(hp.x - out.x * 6.5 + side.x * 6.5 * 0.45, 1.45,
                         hp.z - out.z * 6.5 + side.z * 6.5 * 0.45),
  target: new THREE.Vector3(hp.x, 1.9, hp.z),
  minDist: 1.6 },
```
minDist **1.6 = CAM_MIN_DIST 同值但显式写**（Chief 指定的那条规矩：显式给齐，不依赖默认兜底）。
target y=1.9：GLB 立姿高 ≈3.3m（boulder 归一化 targetSize 4.5 入土后水上 ≈3.3），近景取峰体中上段。

### 插入点（VIEWPOINTS）
与 `lantern` 同一段：`bridge` 条目后、`];` 前。**顺序 lantern → heroPeak**（字幕文案里保持同段两个注释块各自完整）。

### 字幕
```js
  /* 「主峰近观」站：与 hero 站互为远近两档 —— hero 是"石+座+碑+倒影"的构图中景（≈14m），
     这站推到 6.5m 读石皮：boulder GLB 的浅灰重导（3639b6f）在近景才看得出层理。 */
  heroPeak: { title: '主峰近观', text: '贴近了看 —— 灰白的石皮上有水线与苔痕的层理，孔洞里存着雨。池南这一峰，越近越见骨。' },
```

## 3. TOUR_ORDER（:3738 一行改）

```js
const TOUR_ORDER = ['hero', 'stele', 'koi', 'lantern', 'plaque', 'bridge', 'heroPeak', 'hall', 'pavilion', 'overview'];
```

**顺序依据（地理顺水，不跳池）**：
- `hero`(池南立峰) → `stele`(峰侧卧石) → `koi`(池腰 0,3) → `lantern`(北岸 4,−3.8) → `plaque`(堂前草坪 0,−5.7) → `bridge`(东南 8.4,4.6) → `heroPeak`(回望立峰近景) → `hall` → `pavilion` → `overview`
- lantern 卡在 koi 与 plaque 之间：koi 结束在池腰，灯龙在北岸 —— 视线从水面抬到岸上，再折回堂前，是一条连续的带看线；
- heroPeak 放 bridge 之后、hall 之前：从桥上回望立峰收近景，正好把"池南一峰"作为压轴大件，再进远香堂；
- 既有八站的相对顺序**一字未动**（hero→stele→…→hall→pavilion→overview 的次序保持）。

## 4. index.html 改动（两处）

### ① 导览行按钮（:874 `bridge` 按钮后插两行）
```html
<button data-view="lantern">石灯笼</button>
<button data-view="heroPeak">主峰近观</button>
```

### ② 颜色表（:294 `bridge` 行后插两行）
```css
#env button[data-view="lantern"]::before{ color:#B8935A; }   /* 石灯笼 · 灯暖 */
#env button[data-view="heroPeak"]::before{ color:#7C8B95; }  /* 主峰近观 · 灰岩 */
```
（灯暖呼应火袋 emissive [1,0.74,0.34]；灰岩呼应 boulder 浅灰重导。与既有 13 色同饱和度档。）

## 5. 落地时必须实测的三件事（不实测不改代码）

1. **lantern 站位是否落水**：`groundHeight(2.6,-1.7)` + `insidePond(2.6,-1.7)` 双查（候选 A/B/C 依次验，取第一个岸上点）；
2. **heroPeak 距离/侧偏**：按 GLB 实际包围盒（`Box3.setFromObject(taihuHero)`）核 6.5m 是否切顶、0.45 侧偏是否让峰体出画心；
3. **落位截图**：两站各 1 张（口径同 probe/_tmp-tour-visual.mjs 的落位表），人工判读构图后才算落地。

## 6. 与 PerfBot 接线单的冲突面（Chief 协调用）

- 同文件 `src/08-assemble.js`：PerfBot 的接线在 **:2897-2907（摆位）与 :2815-2817（预取）**，本方案在 **:3553-3738（VIEWPOINTS/TOUR）** —— 行区间不重叠，但**插入点行号会因 PerfBot 的改动整体位移**，落地时必须以**原文片段锚定**（本方案所有插入点都给的是片段，不是行号）。
- `index.html` 本方案独占（PerfBot 单不涉 UI）。
- 13-preload/sw.js：**本方案零改动**（不新增资产）。
