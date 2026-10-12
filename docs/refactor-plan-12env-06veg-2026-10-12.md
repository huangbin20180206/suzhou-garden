# 12-env.js / 06-vegetation.js 二次拆分方案（只读分析，不含任何代码改动）

> **状态更正（2026-10-12 复核）**：文件名里的「12env」已是历史包袱 —— `12-env.js` 的二次拆分**早已完成**（2026-10-05 六步 → `12a`~`12f`；现 1215 行含空行 / 1179 行非空）。**本方案实际只针对两件事**：① `06-vegetation.js`（4891 行含空行 / 4756 行非空，全仓最大）的 W0~W8；② §2.3 那个真实存在的 `08-assemble ⟷ 12-env` 环。§1.1 与 §3.3 关于 12-env 的段落作为背景保留，其中「不建议再拆」的结论仍然有效。

> 产出日期：2026-10-12 ｜ 执行范围：**只读**（grep / read / 行数统计），未改 `src/`，未跑任何 Playwright 探针（GPU 独占留给 Chief）
> 代码状态：HEAD `0113065`，工作树对已跟踪文件无本方案相关改动
> 权威口径：**一律以代码为准**，本文所有行号均为 2026-10-12 实测

---

## 0. 结论摘要（先读这段）

1. **`12-env.js` 的二次拆分已经完成，不是待办项。** README `:734` 把它列为「推迟项」，但其前提（3313 行、需整轮门禁兜底）已过时：现文件 **1215 行**，且 6 个卫星模块 `12a~12f` 已存在、有 6 次独立拆分提交。
2. **`06-vegetation.js` 只拆了第 1 步**（`06b-atmos.js`），当前 **4891 行**（比 README 写的 4446 行**更大**，期间功能还在长）。**真正待拆的只有它**。
3. 拆分**不需要**新增任何 import 环风险：06 一侧对 12-env/08-assemble 的耦合**已经**用 `HOOKS` 延迟绑定解掉了（`06-vegetation.js:8-10` 有注释钉死）。真正的环在别处（`08-assemble ⟷ 12-env`，见 §2.3），是**现状**而非拆分引入，本方案给出利用既有正当手段的处理建议。
4. 方案为 **W0~W8 共 9 步**，按风险升序排列；每步都是一次「纯搬家」提交，工作区在任意一步之后都**可运行、可停、可回退**（详见 §4、§5）。
5. 前置建议：先做 **W0（把私有随机流 `jr` 提到共享模块）**—— 它只有 1 行，却能把后续所有「布局漂移」风险从「事后靠门禁发现」降成「结构上不可能发生」。

---

## 1. 任务前提修正（附证据）

### 1.1 12-env.js：已完成拆分

| 证据 | 内容 |
|---|---|
| 实测行数 | `src/12-env.js` = **1215 行**（不是 3313） |
| 卫星模块 | `12a-presets.js` 688 · `12b-sky.js` 1040 · `12c-festival.js` 555 · `12d-lantern.js` 394 · `12e-precip.js` 508 · `12f-season.js` 414 |
| 拆分提交 | `905c784` 第一步雷电+烟花 → 12b · `ed27367` 第二步灯会 → 12c · `7fa3921` 第三步灯笼 → 12d · `ffb6a9c` 第四步雨雪/檐滴 → 12e · `782ef13` 第五步三轴预设 → 12a · `20eb6f0` 第六步季节表现/积雪湿地 → 12f |
| 代码内留痕 | `12-env.js:20-24 / 32-34 / 39 / 43 / 46 / 51` 六段「已搬进 12x」注释，并写明「那边**不能** import 本模块，故由本模块注入」 |

⇒ **12-env 剩下的是「注入点 + 状态机 + UI 接线」，不是可随意搬的组织债。** 本轮不建议再动（理由见 §3.3）。

### 1.2 06-vegetation.js：只走了第一步

| 证据 | 内容 |
|---|---|
| 实测行数 | `src/06-vegetation.js` = **4891 行**（README 写 4446，已在长大） |
| 已拆出 | `06b-atmos.js` 440 行（雾团 + 香炉白烟 + 萤火虫 + 镜头天气层），提交 `ebc2564` |
| 代码内留痕 | `06-vegetation.js:2041-2046` 与文件尾 `:4891` 的两段「整块搬走」说明，且明写方向：**06b → 06 单向，06 不得 import 06b** |

### 1.3 顺带发现的第三处口径滞后（不在本轮写域内，仅上报）

- README `:734`：「12-env(3313 行)/06-vegetation(4446 行) 二次拆分（import 成环风险 + 需整轮 **53 门**兜底）」
- 三处数字全过时：行数（1215 / 4891）、门数（实测 `probe/verify-all.mjs` 的 `SUITES` 表 **79 条**；非 `_` 开头探针 **100 个**；`probe/*.mjs` 共 **137 个**）。README 别处又写「67 道门」，同一文档内自相矛盾。
- 另：README 写「06-vegetation 二次拆分」是推迟项，实际**第 1 步已落地**。

---

## 2. 依赖图（实测）

### 2.1 `12-env.js`（1215 行）

**它 import 谁**（12 条静态 import + 6 组卫星转出）：

| 来源 | 名字（节选） |
|---|---|
| `../vendor.js` | THREE, mergeGeometries |
| `00-config.js` | TAU, **HOOKS**, **ENV_REF**, mulberry32, CFG |
| `01-materials.js` | MAT, waterSurface, DISTANT_MATS, SEASON_TINT_REGISTRY, addWind, wetUniform, WET_MATS, SNOW_COVER_MATS, SNOW_HOOK, AUX_PASS_HIDDEN |
| `02-scene.js` | skyMesh, rainbowMesh, **scene**, lumOf, ENV_BAKE_LUM, resetCamera, camera, ACTIVE_QUALITY, renderer, setEnvPreset |
| `05-water.js` | POND_RADII, groundHeight, insidePond |
| **`06-vegetation.js`** | **spawnRipple, rainRippleActive, treeLanternInsts**（:18） |
| **`08-assemble.js`** | **world, dragonflies, setPerchShowOK, swimTurtles, tourUserTakeover, TOUR, tourStop, tourStart, gotoViewpoint, showCaption, showSeasonCaption, hideCaption, VIEWPOINTS, cancelCamFly, CAM_FLY, introActive, introCancel, geese, GOOSE**（:10-12） |
| `09-lights.js` | sun, fitShadowCamera, amb, fill, hemiLight, markCasterBoxDirty |
| `10-post.js` | bloom, gtaoPass, gradePass |
| `2b-wind.js` | gust |
| `12a~12f` | 见 §1.1（每族都是「先 import 进作用域、再 export 出去」，**不能**写成 `export … from`，:21-24 有实测假红记录） |

**谁 import 它**：`08-assemble.js:5`、`11-loop.js:7`、`11-loop.js:16`、`15-stable.js:34`。

**模块顶层副作用**（= import 时就执行，拆分时的雷区）：

| 行 | 语句 | 性质 |
|---|---|---|
| 496 | `bindPresetsEnv(ENV)` | 注入（必须最早） |
| 497-499 | `ENV.cur / ENV.from / ENV.to` 初始化 | 单例状态 |
| 506 | `ENV_REF.cur = ENV.cur` | **破环发布点**（2b-wind 靠它反查） |
| 511 / 517 / 524 / 528 | `bindSkyEnv` / `bindFestival` / `bindPrecipEnv` / `bindSeasonEnv` | 向 6 个卫星注入 |
| 592-601 | `renderer.domElement.addEventListener` × 4 + `addEventListener('keydown')` + `envEl.addEventListener` | 事件接线 |
| 798 / 872 / 889 / 955 / 1059 | 追加的事件监听（面板 / 滑杆 / 音量 / 快捷键） | 事件接线 |
| 1173-1178 | `const SNOW_BOOST = new Map(...)` + `for (const [mat, boost] of SNOW_BOOST)` | 顶层遍历写材质 |

⇒ 12-env 的「注入点」（496-601）**天然不可搬**：搬走即断开 6 个卫星的初始化顺序。

### 2.2 `06-vegetation.js`（4891 行）

**它 import 谁**（7 条，全部在上游）：

| 来源 | 名字 |
|---|---|
| `../vendor.js` | THREE, mergeGeometries, GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder |
| `00-config.js` | TAU, **rnd, rr**, CFG, mulberry32, bootMark, **HOOKS** |
| `02-scene.js` | world, scene, ACTIVE_QUALITY, renderer |
| `01-materials.js` | MAT, WIND, addWind, AUX_PASS_HIDDEN |
| `03-factory.js` | mesh |
| `05-water.js` | POND_RADII, insidePond, **markUnderwater** |
| `13-preload.js` | onAssetFailed, assetUrl, ASSET_CDN, withCdnFallback |

**谁 import 它**（8 处，全部是「消费方」，无一反向）：

| 消费方 | 用到的名字 |
|---|---|
| `08-assemble.js:18` | rippleInst, makeMistField, makeWisteria, makeRockery, makeRockChain, makeLotusPod, makeAquatic, makeKoiGroup, perchingAnchors, makeWaterGrass, placeAssets, makeBananaPlant, loadAssetOnce, KOI_ORBITS, makeWillow, makeBamboo, makeTaihuHeroGeo, makeReedBladeGeo, makePeachTree, makePlumTree, makeOrchidPot, baitPoints, makePondPads |
| `11-loop.js:10` | MIST, MIST_WHITE, KOI_ORBITS, spawnRipple, updateRipples, assetFailures, perchingAnchors, ripplesActive, lastRippleAge, dropBait, updateBaits, nearestBait, baitsActive, BAITS, rippleCapacity, koiBehaviorOffset, koiStartleEnergy, KOI_BEHAVIOR |
| `04-buildings.js:3` | makeWisteria |
| `06b-atmos.js:12` | makeMistSpriteTex |
| `12-env.js:18` | spawnRipple, rainRippleActive, treeLanternInsts |
| `12c-festival.js:20` | treeLanternInsts |
| `12f-season.js:18` | treeLanternInsts |
| `15-stable.js:30` | tubeRadiusRamp |

**好消息**：`06-vegetation.js:1-15` 的注释已把两条铁律钉死 —— ① `world` 必须从 `02-scene` 取（不能从 08）；② `onAssetAttached` 必须走 `HOOKS`（不能静态 import 12-env）。**新拆出的模块只要能继承这两条，就不会引入新环。**

**模块顶层副作用**（按出现顺序，全部是「构造单例 + 注册」）：

| 行 | 语句 | 备注 |
|---|---|---|
| 25 | `const jr = mulberry32(20260923)` | **布局专用私有随机流**（夹在 import 之间！） |
| 736 | `syncCorridorU()` | 视廊 uniform 首次同步 |
| 973-1009 | `rippleGeo.rotateX` → `rippleMat.onBeforeCompile` → `rippleInst.frustumCulled/renderOrder/setUsage/setAttribute` → 填充循环 → `needsUpdate` | 涟漪池单例（12 行连续语句，**不可在中间下刀**） |
| 1135-1167 | `baitGeo/BufferAttribute` → `baitMat` → `baitPoints` → `baitPoints.frustumCulled/userData` → **`markUnderwater(baitPoints)`** | 鱼饵池单例；最后一行是**跨模块登记**（05-water 的折射层） |
| 1309 | `export const KOI_OBSTACLES = buildKoiObstacles()` | 顶层求值 |
| 3490-3493 | `TREE_LANTERN_MAT` / `MATB` | 顶层材质 |
| 3483/3486/3488 | `treeLanternInsts` / `budMeshes` / `witheredMeshes` | **可变数组**，跨模块共享引用 |

### 2.3 现存真实环（不是本方案引入的）

```
08-assemble.js:5  ──import──▶ 12-env.js:10 ──import──▶ 08-assemble.js   ← 环①（12-env 读 08 的 world/TOUR/geese…）
08-assemble.js    ──import──▶ 12-env.js:35 ──import──▶ 12c-festival.js:4 ──import world──▶ 08-assemble.js  ← 环②
08-assemble.js    ──import──▶ 12-env.js:52 ──import──▶ 12f-season.js:5  ──import world──▶ 08-assemble.js  ← 环③
```

- 环①是**结构性的**（12-env 真的需要 08 的 `TOUR`/`geese`/`VIEWPOINTS` 等），现状能跑是因为环上的读取都发生在**函数体内或回调中**。
- 环②③是**可消除的**：`world` 定义在 `02-scene.js:102`（`export const world = new THREE.Group()`），`08-assemble.js:36` 只是 `export { world }` 的**转发**。12c/12d/12f 改从 `02-scene.js` 取 `world` 即可断掉这两条边 —— 这正是本项目既有的正当手段之一「**纯容器下移到更上游**」，且 `06-vegetation.js:7` 已是这么做的先例。
- **建议**：把它列为「拆 06 之前的前置项 P0」（3 行改动、3 个文件），它不阻塞 W0~W8，但能显著降低后续任何拆分的成环概率。**注意：改 `12c/12d/12f` 的 import 源属于跨文件改动，需 Chief 单独授权写域。**

---

## 3. 拆分边界

### 3.1 分层铁律（新模块允许的依赖面）

任何从 `06-vegetation.js` 拆出的新模块，**只允许** import：

```
vendor.js · 00-config.js · 01-materials.js · 02-scene.js · 03-factory.js · 05-water.js · 13-preload.js
+ 同族 06x-*.js（且必须单向，方向由 W 序号决定）
```

**禁止** import：`08-assemble.js` / `11-loop.js` / `12-env.js` / `12a~12f` / `14-props.js` / `15-stable.js`。

理由：依赖方向必须是 `02 → 06x → 08 → 11`；一旦新模块反向依赖 08/11/12，就会复现 `06-vegetation.js:3-6` 注释里实测过的 TDZ（`Cannot access 'rippleInst' before initialization`）。

**这条铁律可机器化**（强烈建议随 W1 一起加，它是让本方案长期不腐的唯一手段）：
新增 `probe/src-layer-guard.mjs`（纯 node、<1s、进 `verify:quick`）：扫描 `src/06*.js` 的 import 语句，出现禁止清单里的模块即报红，并打印实际依赖边。这是本仓最擅长的那类「不报错不崩、只有专门判据看得见」的防线。

### 3.2 拆分步骤表（W0~W8，按风险升序）

> 「切缝」给的是当前行号；**行号只是定位手段，不是切割依据** —— 切割必须按语句边界（见 §6 坑 1）。
> 「保留门面」= 原文件继续 `import` 后 `export`（**不可写 `export … from`**，见 §6 坑 3 与 `12-env.js:21-24`）。

| # | 新模块 | 职责 | 切缝（当前行） | 主要导出 | 顶层副作用/风险 | 保留门面 |
|---|---|---|---|---|---|---|
| **W0** | `06a-rng.js` | 布局专用随机流单点 | 25（1 行） | `jr` | 无 | 是 |
| **W1** | `06c-organs.js` | **纯几何生成器族**（无状态、无顶层副作用）：叶体积、竹叶、荷瓣、睡莲盘、芦叶、紫藤小瓣、桃叶/桃花/梅花/花苞/凋谢、挂灯罩、蕉果、蕉叶 | 43-101 · 102-138 · 139-177 · 212-234 · 415-445 · 3222-3453（六段连续区 + 三段内嵌） | `makeLotusPetalGeo` `makeReedBladeGeo` + 12 个**原为非导出**的生成器（搬时必须补 `export`） | 无（最安全，故排第一） | 是 |
| **W2** | `06d-corridor.js` | 视廊（VIEW_CORRIDOR/`corridor*`/`CORRIDOR_U`）+ 睡莲廊道材质注入 + **停栖锚点** | 634-805 | `perchingAnchors` `VIEW_CORRIDOR` `corridorRaw` `corridorKeep` `CORRIDOR_U` `setCorridor` | `:736 syncCorridorU()`；`perchingAnchors` 是**可变数组**（08/11 共享同一实例） | 是 |
| **W3** | `06e-assets.js` | GLB 资产加载：双轨入口 + 两级缓存 + 解码器装配 | 1573-1695 | `loadAssetOnce` `placeAssets` `assetFailures` | 顶层 `Map` ×2；`assetFailures` 是 **`export let` 活绑定**；已走 `HOOKS`，无环 | 是 |
| **W4** | `06f-ripple.js` | 涟漪池（64 环） | 969-1126 | `rippleInst` `rippleCapacity` `spawnRipple` `updateRipples` `ripplesActive` `rainRippleActive` `lastRippleAge` | `:972-1009` 12 行连续顶层构造；`rainRippleActive`/`lastRippleAge` 是 **`export let`**；`onBeforeCompile` 注入 `instanceAlpha` | 是 |
| **W5** | `06g-koi.js` | 锦鲤：轨道 + 障碍表 + 行为层（避障/惊鱼/聚集）+ 鱼饵池 | 950-968 · 1127-1572 | `KOI_ORBITS` `KOI_OBSTACLES` `KOI_BEHAVIOR` `koiBehaviorOffset` `koiStartleAt/Energy` `makeKoiGroup` `baitPoints` `BAITS` `dropBait` `updateBaits` `nearestBait` | `baitPoints` 构造 + **`markUnderwater(baitPoints)`**；`export {}` 前向导出（1360/1409/1457）在区内 | 是 |
| **W6** | `06h-rock.js` | 太湖石：SDF 噪声 + Surface Nets + 立峰 + 石链/假山 | 1696-1871 · 2049-2580 · 4778-4871 | `makeTaihuHeroGeo` `makeRockChain` `makeRockery` | `segDist/hash3i/vnoise3/fbm3` 为**单点依赖**必须同搬 | 是 |
| **W7** | `06i-trees.js` | 乔木装配：柳 + 桃 + 梅 + 兰 + 蕉 + 荷蓬 + 枯枝挂灯 | 2581-3141 · 3483-3499 · 3501-4366 · 4495-4777 | `makeWillow` `makePeachTree` `makePlumTree` `makeOrchidPot` `makeBananaPlant` `makeBananaLeafCrown` `makeLotusPod` `treeLanternInsts` `TREE_LANTERN_MAT` `tubeRadiusRamp` | `treeLanternInsts/budMeshes/witheredMeshes` 是**可变数组**；`tubeRadiusRamp` 的 `export {}` 在 **:1415**、定义在 **:3142**（跨 1700 行，必须两处一起搬） | 是 |
| **W8** | `06j-herbs.js` `06k-mist.js`（可选） | 竹 / 紫藤 / 水生（荷+睡莲）/ 水草 / 池盘 ／ 雾絮场 | 178-414 · 446-633 · 806-949 · 4872-4891 ／ 1872-2040 | `makeBamboo` `makeWisteria` `makeAquatic` `makePondPads` `makeWaterGrass` ／ `MIST` `MIST_WHITE` `makeMistField` `makeMistSpriteTex` | ⚠️ `makeMistSpriteTex` 被 **06b-atmos 反向 import**（`:2043-2044`）：若把它搬进 `06k`，必须同步改 `06b-atmos.js:12` 的 import 源，否则成环 | 是 |

**收尾（可选，最后一步）**：把 8 个消费方的 import 源从门面直连新模块（`08-assemble.js:18`、`11-loop.js:10`、`04-buildings.js:3`、`06b-atmos.js:12`、`12-env.js:18`、`12c-festival.js:20`、`12f-season.js:18`、`15-stable.js:30`）。**收益**：门面消失；**代价**：一次改动 8 个文件、跨 6 个写域。建议**单独一轮、单独授权**，且必须带 `import-audit` + 全量门。

**门面写法的硬约束**（来自 `12-env.js:21-24` 的实测教训）：必须

```js
import { makeWillow } from './06i-trees.js';
export { makeWillow };
```

**不能**写 `export { makeWillow } from './06i-trees.js';` —— `probe/import-audit.mjs` 判「用到别的模块的导出名就必须显式 import」，`export … from` 既不进本模块作用域又被当成一次使用 ⇒ 报假红（12-env 上实测 8 条）。

### 3.3 `12-env.js` 的剩余评估：**建议本轮不动**

- 可拆的只剩两块：**① 环境面板 UI 同步 + 事件接线**（`:592-960` 一带，含滑杆/音量/时段条）、**② 三个演示机**（`SEASON_DEMO` / `REEL` / `randomScene`，`:1123-1215` 一带）。
- **不拆的理由**：① 的顶层副作用（`:496-601` 的 `bind*Env` + `ENV.cur` 初始化 + `ENV_REF.cur` 发布）**必须在 12-env 求值时就执行**，搬走即断注入链；② 演示机虽可搬，但它们重度读写 `ENV` 单例与 `VIEWPOINTS`/`flyTo`（08 侧），搬走后要么注入（多一层间接）、要么成环（08 ⟷ 新模块）。**收益（-400 行量级）远小于 06 一侧，而风险集中在启动顺序上。** 建议记为「已评估、不做」，而不是继续挂在推迟项里。

---

## 4. 分步验收表

### 4.1 每步公共最小集（无条件先跑）

```bash
npm run check                                   # 语法 + no-undef（29 个编译单元）
node probe/verify-all.mjs --gates=codeonly-unit,import-audit,layout-fingerprint
```

| 门 | 为什么它对本任务是**不可替代**的 |
|---|---|
| `check`（`probe/check.mjs`） | 唯一能抓**「搬丢了只在别处出现一次的标识符」**的门（ESLint `no-undef` 做真作用域分析）。语法校验本身只查单文件解析，抓不到这类 |
| `codeonly-unit` | `_codeonly.mjs` 的「什么算引用」契约（判宽=假红、判窄=假绿） |
| `import-audit` | 四条判据：漏 import / 给 import 绑定赋值 / 引用内联专有名。**注意它抓不到「少了一个 export」** —— 那类要靠 `check` 的 no-undef 或运行期 |
| `layout-fingerprint` | **本任务的确定性安全带**：布局类随机流（`rnd/rr/jr`）抽取顺序一旦被搬家改变，全园布局整体漂移，而**不报任何错**。它逐位比对基线与多集合，是唯一能发现的 |

⚠️ **`--gates=` 是子串匹配**（`verify-all.mjs:571`），可能一次命中多道门。跑完**必须读它回显的那行**（`:603`：`🎯 --gates=… ⇒ 只跑 N 道：…`）确认命中集合符合预期；匹配不到时它会**响亮报错**（`:600`，拒绝以「0 道门全绿」收场）。

### 4.2 逐步专项（在最小集之上叠加）

| 步 | 追加门（`--gates=` 参数） | 守的是什么 |
|---|---|---|
| W0 | `layout-fingerprint`（已含） | `jr` 换宿主后抽取顺序不变 ⇒ 逐位一致 |
| W1 | `peach-form,plum-guard,wisteria-color,shadow-cover` | 器官几何被搬动后形态/配色/阴影投射不变 |
| W2 | `perch-dragonfly,figure-audit,legibility` | 停栖锚点是**共享可变数组**；figure 系列靠 Raycaster 数遮挡，锚点丢一处即假红/假绿 |
| W3 | `preload-guard,preload-manifest-sync,macaw` | 资产加载是**双投影**（sw.js 的 GLBS ⟷ 13-preload 的 PRELOAD_MANIFEST）；加载路径搬家最易静默丢件 |
| W4 | `ripple-bounds,koi-ripple,turtle-wake` | 涟漪池容量/池域夹紧/跃水节流 —— 全是「计数对不上才看得出」 |
| W5 | `koi-orbit,koi-feed,koi-behavior` | 轨道越界、投喂互动、行为层三项叠加上界 |
| W6 | `stone-audit,stele-legibility,refract-coverage` | 太湖石拓扑（欧拉示性数/连通分量）+ 石体在水中的折射层登记 |
| W7 | `peach-guard,plum-guard,layout-fingerprint,far-tree-guard` | 乔木是 `rnd/rr` 消耗大户；挂灯数组跨 4 个模块共享 |
| W8 | `refract-coverage,nearview-clarity,mist-guard,weather-coverage` | 水生进折射层；雾絮与 06b 的单向关系；天气名单覆盖度 |

### 4.3 本任务特有的「不报错、不崩、只有专门判据看得见」清单

| # | 静默缺陷 | 具体位置（本次拆分会碰到的） | 唯一能抓它的手段 |
|---|---|---|---|
| S1 | **注入式 shader 的数组 uniform 长度不一致** ⇒ 整页卡在加载页且**无报错** | `CORRIDOR_U`（`:727`，`uCorrA/uCorrB` 与 `installLilyCorridor` 注入的 shader 声明必须同长）· `rippleMat.onBeforeCompile`（`:980`，`instanceAlpha`）· `baitMat`（`:1143`，`aAlpha`） | `smoke` / `pageerror-guard`（卡加载页）+ `shader-guard` |
| S2 | 布局随机流**抽取顺序**改变 ⇒ 全园布局漂、无报错 | `jr`（`:25`）与 `rnd/rr` 的所有装配函数（`makeWillow/makePeachTree/makeBamboo/makeAquatic/…`） | `layout-fingerprint`（逐位） |
| S3 | `export let` **活绑定**被改成对象/副本 ⇒ 读数恒 0 | `rainRippleActive`（`:999`）· `lastRippleAge`（`:1082`）· `assetFailures`（`:1575`） | `koi-ripple` / `ripple-bounds` / `preload-guard` |
| S4 | **可变数组被复制**而非共享 ⇒ 消费方看到空数组 | `perchingAnchors`（`:634`）· `treeLanternInsts`（`:3483`）· `BAITS`（`:1168`） | `perch-dragonfly` / `festival-lanterns-guard` / `koi-feed` |
| S5 | **前向 `export {}` 未随定义搬走** ⇒ 导出静默丢失 | `:1360/1409/1415/1457`（`koiAvoidOffset`/`koiStartleOffset`/`tubeRadiusRamp`/`koiCohesionOffset`，**定义却在 `:1335/1382/3142/1440`**） | `check` 的 no-undef / 消费方运行期；**`import-audit` 抓不到** |
| S6 | `src` 引用内联模块专有名字 ⇒ ReferenceError 被 `new Promise` executor + 下游 `.catch(()=>{})` 吞掉 | 本项目**已发生过三次**（三类 GLB 永远挂不上、零告警），`:1579` 有注释留痕 | `import-audit` 判据④ + `smoke` 的「资产已挂载」 |
| S7 | 顶层构造**顺序**变化（如 `markUnderwater(baitPoints)` 未在折射层使用前登记） | `:1135-1167` 的构造序列 | `refract-coverage`（正向清单 + 反向扫描） |
| S8 | 新引入的环 ⇒ 启动期 TDZ，**每帧重复报** | 见 §2.3；新模块若 import 08/11/12 即中招 | `pageerror-guard` / `smoke` 的启动零 error |

### 4.4 收尾

```bash
npm run verify:quick        # 12 道快门（≈3 分钟）
npm run verify              # 67+ 道全量（≈15~20m）；第 6 道之后任何一红即整体非零退出
```

每一波结束都跑 `verify:quick`；**仅在整条链（W0~W8）收口时**跑一次全量 `verify`。

---

## 5. 风险清单与回退点

### 5.1 风险

| 级别 | 风险 | 触发条件 | 缓解 |
|---|---|---|---|
| 高 | **布局指纹漂移**（不可逆地改变全园形态，且无报错） | 搬家时改变了 `rnd/rr/jr` 的消费顺序 | W0 先行；每步跑 `layout-fingerprint`；一旦红立即 `git revert` 该步 |
| 高 | **启动期 TDZ**（整页白屏） | 新模块反向 import 08/11/12 | §3.1 铁律 + 建议新增 `src-layer-guard`；每步跑 `smoke`/`pageerror-guard` |
| 中 | `export let` 活绑定被破坏 | 搬家时顺手改成 `{ value }` 形态 | 保持原样搬（纯搬家原则）；门禁 S3 |
| 中 | 共享可变数组变成副本 | 搬家时重新 `const x = []` 而非导出原引用 | 门禁 S4 |
| 中 | 前向 `export {}` 与定义分离迁移 | 只搬了定义段 | 按 §6 坑 2 的「两处一起搬」清单执行 |
| 低 | 门面 `export … from` 触发 import-audit 假红 | 图省事写一行转出 | 一律 `import` 后再 `export`（`12-env.js:21-24`） |
| 低 | 06b 反向依赖被打破成环 | W8 搬 `makeMistSpriteTex` 而未改 06b | W8 标记为「可选」，且必须同步改 `06b-atmos.js:12` |

### 5.2 回退点（每一步之后工作区都必须可用）

- **一步一提交**，提交信息格式沿用本仓既有风格：`拆分 06-vegetation.js 第N步：<内容> 整块搬进 src/06X-*.js`（对齐 `ebc2564` / `905c784` 的既有写法）。
- **保留门面 ⇒ 消费方零改动** 是「可停」的关键设计：任一步完成后，8 个消费方的 import 路径都没变，页面行为应与拆分前**逐字节等价**（纯搬家）。这让每一步都能独立交付、独立回退。
- **回退粒度 = 单个提交**：`git revert <该步的 commit>`。因为每步只搬一个职责簇、且门面保证外部接口不变，revert 不会牵连其他步骤。
- **硬停点（发现下列任一情况立即停并回退，不要继续下一步）**：
  1. `layout-fingerprint` 不逐位一致；
  2. `check` 报 no-undef，或 `import-audit` 报错；
  3. `smoke` 出现任何 console error / pageerror（尤其 `Cannot access 'X' before initialization`）；
  4. `preload-manifest-sync` 红（资产双投影失配）。
- **拆到一半放弃**：任意一步之后停手都不会留下半成品 —— 门面文件本身就是「已完成部分 + 未搬部分」的合法混合体（12-env 的现状正是这样）。

---

## 6. 不建议怎么拆（本仓历史四坑 → 本次具体位置）

> 本仓「脚本整块搬代码」踩过四个坑，原始记录在 `probe/_extract-section.mjs:32-68`（工具头部注释，逐条都是实测）。下面把每条映射到**这次会踩到的具体位置**。

### 坑 1 · 插入点落在两条语句中间

工具原注释（`:51-57`）：区间终点会「顺带把上一节尾巴上的生成物圈进来」，而**工具照旧报 ✓ 已写入**。

**本次对应位置**：
- `06-vegetation.js:973-1009`：涟漪池的 12 行顶层构造是一条**不可分割的语句链**（`rotateX` → `onBeforeCompile` → `frustumCulled/renderOrder` → `setUsage` → `setAttribute` → 填充循环 → `needsUpdate`）。切割点只能取语句边界，绝不能按「注释块边界」或「行数凑整」下刀。
- `06-vegetation.js:1135-1167`：鱼饵池同理，且末尾是跨模块登记 `markUnderwater(baitPoints)`。
- `06-vegetation.js:25`：`const jr = …` **夹在两组 import 之间**（`:15` 是一条 import，`:26-28` 又是三条 import）。按「import 区块」切会把它连同邻居一起卷走。

### 坑 2 · 段重叠（区间把整段吞进去）

工具原注释（`:36-38`）：banner 漏检时「上一节的区间就把 ENV 那一千多行一起吞进去（实测 §10 被算成 1527 行，看着还挺『合理』）」。

**本次对应位置**：
- **跨 1700 行的前向导出**：`tubeRadiusRamp` 的 `export {}` 在 `:1415`、定义在 `:3142`；同类还有 `:1360`(`koiAvoidOffset` 定义 `:1335`)、`:1409`/定义 `:1382`、`:1457`/定义 `:1440`。**「一个职责簇 = 一个连续区间」这个假设在本文件不成立**：W5/W7 必须按「定义区 + 前向导出区」两处一起搬。
- **同名注释块紧贴**：`:2041-2046` 的「已移入 06b」说明块、`:4891` 的尾部说明块，都与真实代码区相邻；按「从注释开头截到下一个注释」切会把邻段卷进来或漏掉。

### 坑 3 · 多行注释吞掉 import

工具原注释（`:59-62`）：末尾一节的 end 会一路取到文件尾，把 `</script></body></html>` 卷进模块 ——「index.html 的 `</script>` 被搬走，页面直接报『未找到内联 module script』，而工具照旧报 ✓ 已写入」。

**本次对应位置**：
- `06-vegetation.js:2041-2046`、`:4891`：这两处**多行块注释**紧邻代码区边界，且内部还提到被搬走的模块名。切割区间若以它们为边界，容易把相邻语句吞进注释、或把注释留在旧文件里变成孤儿。
- `12-env.js:20-25 / 32-34 / 39 / 43 / 46 / 51`：6 段「拆分沿革」注释与真正的 `import` 语句**逐行交错**。这正是 `_extract-section.mjs` 的 `GEN_IMPORT`/`effEnd` 逻辑（`:58-68`）在对付的形态 —— **照抄它的做法：把「生成物」（空行 + 生成出来的 import 行）先从尾巴剥掉，再定边界。**
- 另：`12-env.js:21-24` 明确禁止 `export … from` 写法 —— 那是 **import-audit 假红**的坑，与注释位置无关但同属「边界处理」类。

### 坑 4 · 漏搬只在别处出现一次的标识符

工具原注释（`:14`）：`export` 名「每个都必须**恰好命中一次**，否则报错退出」；`:16-17` 的依赖体检会列出「节内用到、但节内没定义」的名字并区分「定义在节前 / ⚠️ 定义在节后」。

**本次对应位置**（全是「只被一个函数用一次」的私有辅助，最易漏）：
| 标识符 | 定义 | 唯一使用者 | 归属 |
|---|---|---|---|
| `hash3i` / `vnoise3` / `fbm3` | `:1824/1831/1844` | `makeTaihuPeak` / `makeTaihuHeroGeo` | W6 |
| `segDist` | `:2049` | `surfaceNets` | W6 |
| `pondClamp` / `behavClamp` | `:1248/1265` | 锦鲤行为层 | W5 |
| `BANANA_SEED` | `:4495` | `makeBananaLeafCrown` | W7 |
| `corridorT` / `corridorInjected` | `:697/746` | `corridorRaw` / `installLilyCorridor` | W2 |
| `addPerchingAnchor` | `:635` | 各装配函数 | W2 |
| `makeLeafVolumeGeo` / `makeBambooLeafGeo` / `makeLilyPadGeo` / `makeWisteriaFloretGeo` / `makePeachLeafGeo` / `makePlumFlowerGeo` 等 | 见 §3.2 W1 切缝 | 各自的上层装配函数 | W1 |
| `TREE_LANTERN_COLORS` / `treeLanternColor` | `:3453/3460` | `makeTreeLanternGeo` | W1/W7 |
| `MATB` / `budMeshes` / `witheredMeshes` | `:3493/3486/3488` | 挂灯与梅三态 | W7 |

**关键提醒**：`import-audit` 只抓「用了别的模块的导出名却没 import」；**「搬丢了一个私有辅助函数」它抓不到** —— 这类只会在 `check` 的 `no-undef`（若该函数在别处仍被引用）或运行期暴露。所以**每一步都必须跑 `npm run check`**，这是本方案里唯一为坑 4 服务的门。

### 另外三条「不要这样做」

1. **不要按行数均分**（「一半放这儿一半放那儿」）。本文件的切缝是**职责簇**，不是长度：`makePeachTree` 单函数 749 行（`:3501-4249`），而整个鱼饵池只有 121 行。按行数切必然落在语句中间（坑 1）。
2. **不要靠调 import 顺序绕环**。本项目两个正当手段是「纯容器下移到最上游」与「`HOOKS/ENV_REF` 延迟绑定」（`00-config.js:36-57` 与 `06-vegetation.js:8-10` 都写明了）。调顺序是把正确性押在「当前这张依赖图恰好这样」上。
3. **不要用 `Math.random` 代替 `jr`「反正差不了多少」**。`:17-24` 有实测：换全局流会让竹叶合计在冷启动时 41989 vs 42230 波动 —— 而这类差异**不报错**，只会让 `layout-fingerprint` 变成噪声门。

---

## 附录 A · 切缝行号总表（`06-vegetation.js`，2026-10-12 实测）

| 起始行 | 内容 | 目标模块 |
|---|---|---|
| 25 | `const jr`（私有布局随机流） | W0 |
| 43 / 85 | `makeLeafVolumeGeo` / `makeBambooLeafGeo` | W1 |
| 102 / 139 | `makeLotusPetalGeo` / `makeLilyPadGeo` | W1 |
| 178 | `makePondPads` | W8 |
| 212 / 235 | `makeReedBladeGeo` / `makeBamboo` | W1 / W8 |
| 415 / 446 | `makeWisteriaFloretGeo` / `makeWisteria` | W1 / W8 |
| 634 / 687 / 697 / 706 / 714 / 727 / 730 / 738 / 746 / 747 | 停栖锚点 + 视廊族 | W2 |
| 806 / 840 | `clampAquaticToPond` / `makeAquatic` | W8 |
| 950 | `KOI_ORBITS` | W5 |
| 969-1126 | 涟漪池 | W4 |
| 1127-1247 | 鱼饵池 | W5 |
| 1248 / 1265 | `pondClamp` / `behavClamp` | W5 |
| 1285-1483 | 锦鲤障碍 + 行为层 | W5 |
| 1484-1572 | `makeKoiGroup` | W5 |
| 1573-1695 | 资产加载 | W3 |
| 1696-1871 | `makeTaihuPeak` + 噪声族 | W6 |
| 1872-2040 | 雾絮场（`MIST`/`makeMistField`/`makeMistSpriteTex`） | W8（可选） |
| 2049-2580 | `segDist` / `surfaceNets` / `makeTaihuHeroGeo` | W6 |
| 2581-3141 | `makeWillow` | W7 |
| 3142-3221 | `tubeRadiusRamp`（⚠️ `export {}` 在 :1415） | W7 |
| 3222-3452 | 桃/梅花器几何族 | W1 |
| 3453-3500 | 挂灯几何 + `treeLanternInsts`/`TREE_LANTERN_MAT` | W1 + W7 |
| 3501-4249 | `makePeachTree` | W7 |
| 4250-4318 | `makePlumTree` | W7 |
| 4319-4366 | `makeOrchidPot` | W7 |
| 4367-4494 | 蕉果/蕉叶几何 | W1 |
| 4495-4633 | `BANANA_SEED` / `makeBananaLeafCrown` / `makeBananaPlant` | W7 |
| 4634-4777 | `makeLotusPod` | W7 |
| 4778-4871 | `makeRockChain` / `makeRockery` | W6 |
| 4872-4891 | `makeWaterGrass` | W8 |

## 附录 B · 复现命令（全部只读）

```bash
# 行数
Get-ChildItem src\*.js | ForEach-Object { '{0,-22} {1,6}' -f $_.Name, (Get-Content $_.FullName).Count }

# 拆分沿革（12-env 已完成、06-veg 第一步）
git log --oneline --diff-filter=A -- src/12a-presets.js src/12b-sky.js src/12c-festival.js \
  src/12d-lantern.js src/12e-precip.js src/12f-season.js src/06b-atmos.js

# 顶层副作用（列 0 起头的非声明语句）
# 切缝图（列 0 声明 + 行号）
# 门禁总量
(Select-String -Path probe\verify-all.mjs -Pattern "^\s*\['").Count      # → 79
(Get-ChildItem probe\*.mjs | Where-Object { $_.Name -notlike '_*' }).Count # → 100

# 单步验收（示例：W4 涟漪）
node probe/verify-all.mjs --gates=codeonly-unit,import-audit,layout-fingerprint,ripple-bounds,koi-ripple,turtle-wake
```

## 附录 C · 一页纸执行顺序（交给下一个执行者）

```
0. 前置 P0（可选、需单独授权）：12c/12d/12f 的 world 改从 02-scene 取 —— 断掉环②③
1. W0  06a-rng.js          ← 1 行；验收：layout-fingerprint 逐位
2. W1  06c-organs.js       ← 纯几何，最安全；验收 + peach/plum/wisteria
3. W2  06d-corridor.js     ← 停栖锚点共享引用；验收 + perch-dragonfly/figure
4. W3  06e-assets.js       ← 资产双投影；验收 + preload 系列
5. W4  06f-ripple.js       ← export let 活绑定；验收 + ripple/koi-ripple
6. W5  06g-koi.js          ← 前向导出 + 热路径；验收 + koi 三兄弟
7. W6  06h-rock.js         ← 单点辅助函数；验收 + stone/stele
8. W7  06i-trees.js        ← 最大、rnd 消耗最多；验收 + peach/plum/layout
9. W8  06j/06k（可选）      ← 水生 + 雾絮（改 06b 的 import 源）
10. 收尾（可选、需单独授权）：8 个消费方直连新模块，撤掉门面
每步：check → codeonly-unit/import-audit/layout-fingerprint → 专项 → git 提交
收口：verify:quick 全绿 → npm run verify 全量
```
