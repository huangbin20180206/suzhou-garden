# HANDOFF 2026-10-31 · batch3（hark/batch3，基于 origin/hark/week0-hotfix 2c9bd5b）

上一份：`docs/HANDOFF-2026-10-30-batch2.md`（含 ?tier=high 黑屏定案，bd33d8d）。

## 一句话

batch2 文末列为"没做"的三项（真实日轨+旬花历+新天气、礼仪相位、重播回归门）本批全部做了，
外加启动延迟链修复、静态合批、SW 首访不重复下载与资产单一清单、真固定步长与相对 QOS 阈值、写意物件打标。
**只在沙箱本地提交，未推送。** master 未动。

## 分支与导入

- 分支 `hark/batch3` = `origin/hark/week0-hotfix`（2c9bd5b）之上 13 个提交（含 5 个合并）。
- 导入：`git fetch <bundle> hark/batch3:hark/batch3`，或 `git am patches/*.patch`（在 hark/week0-hotfix 上）。
- 判断要不要快进 week0-hotfix：看完下面"人眼验收"再说。

## 与 batch2 的取舍（对上一位的结论逐条回应）

| batch2 的判断 | 本批 |
|---|---|
| 不拆 16-actors / 11-loop（闭包共享、求值时序雷区） | **认同，未拆**。我这边旧分支拆过的版本作废。 |
| 礼仪相位：先补重播回归门再动相位机 | **照做**：先 `probe/_actor-sim` + `actor-replay-unit` 逐帧锁住（957cbd6），再插礼仪（c17b3f3）；`?etiquette=0` 时与原基线逐帧一致。 |
| 日轨/花历/新天气要单独一批、重标基线 | **本批就是这一批**。浏览器门的口径变化见下"已改判据"。 |
| quality 数值留在 02-scene | 认同，未动；只把 QOS 升降档阈值提成纯函数（相对刷新率）。 |
| 资产压缩已完成（gltfpack -cc） | 认同，**未再压缩**；只移植 SW 修复与清单单一真值。 |

## 提交清单

| 提交 | 内容 |
|---|---|
| a038c76 | 启动：`runDeferredBoot` 改 rAF + setTimeout 双保险推进（令牌去重）。根因：软渲染长帧把 `setTimeout(step,0)` 饿死，bootDone 迟迟不兑现；c58c3ca 起就有，不是回归。 |
| bdb10b8 | 静态合批（主 pass 估 191→113 draw、阴影 59→8）+ 合并后释放几何；`src/art-license.js` 物件标记登记表（与 16b-artistic-note 字幕注分工，见文件头）；景点显示名集中 `src/03a-names.js`。 |
| 8506d5b | 环境：`applyState(next,{via})` 统一入口；`12h-solar` 苏州日轨+月相（冬至日落 16:59、夏至 19:05）；`12g-phenology` 按旬花历；细雨/雪霁天气；烟花/闪电收尾交还 applyEnv（含月光增益）；PMREM 键 = 时段×天气大类，过渡落地才切。`?solar=0` 回旧四锚点。 |
| e20f07e | env-phenology-unit / env-solar-unit；advanceReel 过渡期仍刷时辰读数；天气行补「细雨」「雪霁」按钮。 |
| 42c7d7e | SW：导航仅 res.ok/非重定向/入口页才覆盖离线壳，5xx 回退缓存壳；install 只预缓存壳，GLB 在预载结算后 force-cache 回填（首访不重复下载）；`assets/manifest.json` + `tools/gen-asset-manifest.mjs` 单一真值。CACHE v44。 |
| d02a29d | `src/00b-fixedstep.js` 固定步长纯函数（每帧补步 ≤100ms、0.25 步吸附）；QOS 阈值相对化（目标=min(刷新率,60)，60Hz 下仍 45/58，30Hz 不误降档）。 |
| 957cbd6 | 重播回归网：`probe/_actor-sim/` + `actor-replay-unit`（马车两场 918.4s / 步行 271.2s 逐帧锁）。 |
| 9a83ce1 | 马车、外国马种（camargue/criollo）、Tinker 回退马打 `userData.artLicense`。 |
| c17b3f3 / 830e768 | 礼仪三段：门房通报（await→usher→announce）、奉茶（serve→offer）、马夫接马（车子状态 stop→take→alight）。默认开，`VISIT_POLICY` 逐段可关，`?etiquette=0` 全关。首场到 done 436.8s→512.8s（+76s）。文档见 `docs/guest-visit-choreography.md`「礼仪三段」。 |
| 51921fa | 重播复位改「走回去」：新相位 `homing`，`VISIT_POLICY.walkback` 默认开、`?walkback=0` 回旧瞬移。镜头视野内且距离合理才走，否则瞬移兜底（计数）。仿真：平均 30.7s、最长 44.3s（门房书童），兜底 0 次，冷却期单帧水平位移 ≤0.42m；第二场开演 559.2s→603.2s。新基线 carriage-walkback；关闭时三份原基线逐帧一致。 |
| 5a3a677 | 写意标注补齐：蒙古马新 id `labelHorse`（品种名来自资产库标签，不并进 foreignHorse，因为蒙古马本是实景马种）；出园路整组打 `stable`，进园路只标路面与马厩院门口铺装（同组有园门平台/石灯笼/石狮，不连带）。 |
| 54116d1 | `src/main.js` 单一入口：内联主模块逐行搬出（含 bootFail 与两级看门狗），index.html 只留一行入口；check/import-audit 校验这一行；SW CACHE v45 预缓存 src/main.js。顺带把 README 门数漂移改对。 |
| be5779b | verify-all 登记 fixed-step-unit、actor-replay-unit（README：93 道门 / quick 16 道）。 |
| 0bf027e | 探针等待：`GARDEN_BOOT_MS` 放大启动等待（默认不变）；visit-carriage 轮询改 raf。判据未动。 |
| 2f38419 | PMREM 开机那张直接记 `noon|clear` 键（省一次同参重烘）；pmrem-env 门按新键口径改写；smoke 两条月亮判据钉月相 0.5。 |

## 已改判据（都因产品口径变化，逐条写了出处）

- `pmrem-env-guard`：键从 `night/dusk/noon` 改为 `时段|天气大类`，每步先等过渡落地；"切回午"从 +1 张变为缓存命中；新增"阴雨大类烘 1 张、同大类换天气不烘"。
- `smoke` 月亮两条：真实月相下夏季代表日 2027-07-10 是蛾眉月、21:30 月高 1.9°，按满月写的判据先钉 `moonPhase=0.5`，阈值不动。
- `visit-carriage-guard`：相位清单 +5、BUSY +take、①f 计数 31/36；MAX_STEPS 不变。

## 验证现状（沙箱：aarch64 + SwiftShader 2 核，首帧 ~125s、bootDone ~382s）

- 纯 node：`eslint` 0 error · `npm run unit` 43/43 · `gate-count-sync` PASS · `check` PASS · `import-audit` PASS · `draw-estimate` PASS · `preload-manifest-sync` PASS · `vendor-fresh` PASS。
- 浏览器门（本批在沙箱实跑）：
  - bootDone：约 382s 兑现（`[启动分段·延迟] 合计 1770.3ms（30 批）`）✓
  - visit-carriage-guard 27/27 ✓（礼仪合入**前**跑的；合入后需在你机器上复跑——礼仪开启后首场多 76s）
  - fixed-timestep-guard 6/6 ✓
  - pmrem-env-guard（改口径后）：前 2 项 ✓（开机 1 张 `noon|clear`、切夜第 2 张 `night|clear`，证明省掉了重烘、新键生效）；第 3 步切暮等过渡时浏览器在沙箱约 20 分钟时被关掉（SwiftShader 太慢 + 作业上限），后 6 项**未跑到**，需在你机器上复跑。
  - smoke：沙箱 20 分钟上限内跑到 18 项（16 绿，2 红即上面月亮两条，已改）；**需在你的机器上完整跑**
- 未跑：全量 `npm run verify`（89+ 道）。预计会因画面口径变化需要重标的：layout-fingerprint、mobile-panel-guard（天气行多 2 按钮，可能换行）、拍到 env 面板/时段光照的截图门（asset-shots、hero-shot、night-sky、legibility、weather-coverage 等）、pwa-cache/pwa-cold-restart（后者原本就在等已退役的 LotusPlant）。

## 人眼验收清单

1. 时段光照：真实日轨下冬季 17:00 已入夜、夏季 19:00 仍有夕照；月相随日期变（`?solar=0` 对照）。
2. 花历：春无荷、秋无梅、夏秋无紫藤花、秋无桃。
3. 礼仪：门房岗 (2.6, 21.3)、书童候场 (−2.15, −8.55)、奉茶位 (0, −13.0) 是否压山石/花木/茶几；书童（child1/2 不能转肩，用肘腕手位）作揖、端盏像不像；接马时车夫与常驻马夫同框；水桶是否与马头/横杆打架；茶盏换手近看。
4. Tinker 贴图（若走 ?horse=tinker）清晰度。
5. PWA：首访同一 GLB 只请求一次；在线开一次后断网重载模型齐全。

## 已知遗留

- 反射贴图里 ~5 个坏 texel 的制造者仍未找到（batch2 第五节），水面兜底挡着。
- 走回去的「可见」只看镜头视野，不算墙/树遮挡；倒走台阶/拱桥踏步的落脚、门房书童过桥避让、到位交给 resetVisit 那一帧的朝向/高度小跳，需浏览器人眼看。
- main.js 迁移后需确认：开园无 TDZ/导入报错、抽屉/看灯笼按钮/120s 看门狗正常、pwa-cache 断网可开园（离线清单 10 项）、smoke 与 pageerror 结果与迁移前一致。
- 仿真主体每帧仍只跑一次（传 步数×1/60），未按步拆跑——牵动墙钟 t 太多。
- 院外两条石板路（stable 条目）未打标；蒙古马未打标（非外国马种口径存疑）。
- 步行版不开礼仪；开演后变天不打断礼仪，只影响下一场。


---

## 2026-10-31 全量检测收口（提交 `902e8e8`）

### 结论一句话
93 道门全量跑出 12 红 2 FLAKY。逐门取证后：**没有一例是产品缺陷** ——
7 道"判据没跟上产品已定的口径变化"、2 道门自身 bug、2 道环境/负载、1 道门禁自己的就绪竞态。
本笔只改 `probe/`，`src/` 一行未动。

### 12 道红门的定性表

| 门 | 定性 | 真因（实测） | 修法 |
|---|---|---|---|
| festival-guard | 口径 | 路灯 SpotLight 只在非 low 档创建（有意设计）；本机判 low ⇒ `roadLights=0` | 门加 `?tier=high` |
| festival-lanterns-guard | 口径 | 同上 | 同上 |
| wisteria-color | 口径 + 探针 bug | 默认"夏"无紫藤花（花历 4 中~5 上）⇒ 花穗 count=0 ⇒ `brightest.hex` TypeError | 钉 spring + 按花穗材质定位 + 空数组兜底 |
| peach-form | 口径 | 硬编码"春叶 0.15 / 秋果 0.7"；新花历为 0.442 / 0 | 期望改为读 `12g PHENO` |
| night-sky | 口径 | 月出随月龄后移，默认日期月出≈11:00 | 钉 `moonPhase=0.5`（须走 `applyState`，`setEnv` 不收这个轴） |
| shadow-bake | 判据算法 | 贪心聚类移动簇心 ⇒ 链式合并，223.5° 弧只剩 3 簇 | leader 聚类（簇心不动）⇒ 16 簇 |
| shadow-cover | 前提过时 | 真实日轨下早晨/傍晚 `_sc` 自动放大，旧盒只在正午漏（2/6） | 场景集 6→8（补 10.5/15），判据仍"一半以上" |
| plum-guard | 阈值 | 真实日轨冬季正午太阳高度≈35° + 雪 preset sunMul .45 ⇒ R−G 实测 21.8/21.2 | 25→18（灰调对照 0~6，仍有 3 倍分辨力） |
| weather-coverage | 门自身 bug | `page.screenshot()` 拿到空画布（675 字节）；页内 `drawImage` 仍全 0 | 离屏 RT + `readRenderTargetPixels`，两臂同一段直渲 |
| koi-feed | 门自身 bug | 抖动指标在低帧率环境下无判定力（11.3%/14.9% vs 真机 0.9~6%） | 加"无饵巡游基线"对照：上限 = max(10%, 基线×1.6+3) |
| aa-progressive | 环境/负载 | 启动看门狗那条"仅记录不弹卡"的 console.error 被算成错误 | 过滤并计数入明细 |
| viewpoint-visibility | 就绪竞态 | **延迟批的竹丛还没搬走、堆在原点附近**挡在 hall 机位前 3.9~5.3m（命中 MAT.bambooA 竿 11 + MAT.leaf 叶 2416） | 补 `await bootDonePromise`；"挡住"改锥形 5 线 ≥3 条 |

### 本轮最有价值的取证方法
1. **把"身份"打进门禁明细**：hall 那条红原本只有"匿名实例 @5.31m"。加上材质色 / 几何类型 /
   顶点数 / 实例世界坐标后，一眼看出是"竹竿+竹叶聚在 (0.5, 0~4.6, 0.9)"⇒ 立刻想到"延迟批未搬走"。
2. **独立跑 vs 链内跑的数字要摆在一起**：独立跑同一根射线第一命中 19.76m（堂内屏风），
   链内跑 3.92m（竹竿）—— 这个差值本身就是"时序问题"的证据。
3. **存证图要走能用的路径**：本项目 `page.screenshot()` 拿不到画布内容，改用
   离屏 RT → `renderer.render` → `readRenderTargetPixels` → 2D canvas → dataURL。
   例：`outputs/_diag/fullcheck-diag/hall-view.png`（视线畅通，正对远香堂）、
   `outputs/weather-coverage/stele-cover-{on,off}.png`（有雪/无雪对照）。
4. **`new Promise(async (resolve) => …)` 会吞异常**：executor 里抛错 ⇒ 外层永不 settle ⇒
   Playwright `page.evaluate` 永久挂住（本轮实测门卡 10 分钟、CPU 只有 0.7s）。探针里的
   长循环一律写成 `async` 函数 + `.catch()` 返回 `err`。

### 复验结果（全部单跑绿）
shadow-cover 18/18 · viewpoint-visibility 6/6 · wisteria-color 5/5 · peach-form 26/26 ·
shadow-bake 10/10 · night-sky 15/15 · plum-guard 17/17 · koi-feed 15/15 ·
weather-coverage 15/15 · festival-guard 21/21 · festival-lanterns 全绿 · aa-progressive 全绿；
`npm run check` PASS。

### 仍未处理 / 诚实边界
- `refract-guard`、`afterrain-guard` 两道 **FLAKY**（重跑即过，项目口径不计红）；
- weather-coverage 的像素判据现在走**直渲**（跳过 composer 的调色/高度雾）：
  对"雪有没有盖白石头"这个 A/B 无影响，但它不再代表最终出图效果；
- hall 遮挡的**长期**结论：竹丛在延迟批里"先建在原点、再搬走"，一个极短窗口内是会挡在
  hall 机位前的。玩家看不到（装配没完成时加载页还盖着），但任何"装配完成前就采样场景几何"
  的探针都会踩到 —— 新探针请一律 `await bootDonePromise`。
