# HANDOFF 2026-10-27 · 复核修复（二）

上一份：`docs/HANDOFF-2026-10-27.md`（拆分复核 + 9 项已知未修）。
本份：**复核之后已经修掉的 4 项**（已提交 `c79d549`，已推送 GitHub）+ **剩下的待办清单**。

HEAD = `c79d549`，分支 `refactor-06-split-20261013`。
快检状态：`npm run check` PASS · `npm run audit` PASS · `npm run unit` 6/6。
`npm run verify:quick` 尚未重跑（约十几分钟，见"待办 0"）。

---

## 一、本次已修（提交 c79d549）

| # | 缺陷 | 修法 | 文件 |
|---|------|------|------|
| 1 | **依赖环**：942d678 拆分时 06k/06l/06m 改从 `06-vegetation` 门面取符号，形成 `06-vegetation → 06i → 06k/06l/06m → 06-vegetation` 环（拆分前没有）。潜伏 TDZ：谁在顶层调用即白屏 | 改回从叶子模块直取（06a/06c/06d/06e），依赖恢复单向 | 06k-willow.js / 06l-orchard.js / 06m-banana.js |
| 2 | **小跑滑步**：`stride = h.strideWalk || D.stride`，而 strideWalk 按 walk 摆角 0.28 标定（≈0.663m）；trot 应为 1.24m ⇒ 相位快 1.87×，碎步打滑。Rodin 马（默认）全中 | 只有 `G.mode==='walk'` 才用 strideWalk，trot 用模式常量 | 15c-horse-life.js:208-212 |
| 3 | **悬停射线常驻开销**：材质兜底分支把 `mergedStatic`（沿用原材质）收进目标表；每 6 帧无条件打一次射线，单次约 60ms，鼠标不动也烧 | 改成"鼠标动了或相机动了才打"；目标数组/label 映射建表时算一次；`_labelOf` 改为沿祖先链上溯一次（原来逐目标 traverseAncestors） | 11-loop.js（悬停段） |
| 4 | **matchMedia 每帧两次**：每秒 120 次 query 解析 | 缓存 MediaQueryList 对象（`.matches` 仍实时） | 11-loop.js |

## 二、复核结论存档（已完成，不用再做）

- **拆分等价性**：942d678 四组用 acorn 提取全部具名函数逐字比对——06i 33/33、08c 22/22、16-actors 54/54 相同；15-stable 97 个里 94 个相同，3 处差异全是提交说明写明的等价改写（`mesh→src` 形参改名 ×2、`advanceStableTime` 包时钟）。**拆分干净，无丢失无重复。**
- **门禁**：88+ 道注册门判据真实（horse-motion-guard 量"鼻低于肩胛 ≥25cm"等）；`verify-all` 对红门自动重跑一次标记 FLAKY ⇒ "ALL GATES PASS"≠每门稳定。
- **查过没问题**：每帧函数无材质/几何重建；`refreshCasterBox` 有 3s 闸不是每帧；各特效每帧函数（tour/figures/precip/festival/ripple/baits/blinds）AST 扫过零分配。

## 三、剩余待办（按优先级）

### 已完成（第二轮，见提交记录）
- ✅ **A2 马车朝向跳变**：back 段进站朝向 → π 的 15.7° 硬切改为倒车前 1m 内平滑收向；spin 调头目标从 0 改为离场首段朝向（≈0.826），47° 硬切消除（16-actors.js driveout）。
- ✅ **A3 辕马错位 0.7m**：parked 槽位（−2.85）与 travelOff（2.15）统一为"马肩颈正落横轭下"——马心车局部 1.93（轭 1.38 + 肩距 0.55），parked hz=−3.33 / travelOff.z=1.93 / 无 travelOff 兜底同口径；缰绳鼻端起点随马心 1.93 同步到 2.95（15e-stable.js / 15d-carriage.js）。
- ✅ **C1 每帧临时对象**：锦鲤 bases/peers（11-loop.js，d.base/d.peer 持久复用）、散步 lastPos（复用）、15c 白雾 billboard 四件套（_lifeM/_lifeQ/_lifeSC/_lifePP）、16-actors 姿态 q/e（_poseQ/_poseE）、08e 小鸟 3 件套（_bUpY/_bAxisX/_bq2）全部挪模块级。
- ✅ **B2 路点抄两份**：STABLE_ROAD_PTS / STABLE_EXIT_PTS 单份定义移入 15a-shared，15e import 后转出（门面/16-actors 引用路径不变），15d 删手抄副本直接 import。
- ✅ **verify:quick 重跑**：日志 `outputs/_diag/verify-quick-2026-10-27-c1.log`。

### 已完成（第三轮）
- ✅ **换季过渡全园点名**：12-env 删掉第一次重复的 `collectSeasonGLB()`（两次之间无人读 seasonGLB）；12f 加 `_glbSettled` 稳态早退（名单收满且无待注入材质 ⇒ 后续帧不再 traverse），迟到资产走 `onAssetAttached` 先 reset 再 collect。过渡期从每帧 4 遍降到收敛后 0 遍。
- ✅ **雪天泥地硬边（视觉清单②）**：15e 泥地补丁改用专用渐隐贴图（40% 起渐隐，停点 [[0,1],[0.40,0.82],[0.72,0.32],[1,0]]）；`makeSoftAlphaTex` 参数化（不传参 = 旧版逐字节不变，贴地软影等调用方不受影响）；`wornDry/wornBare` 登记 `registerWeatherRoles({snow:1})` —— 深雪里补丁随地面落雪，不再是被雪包围的棕色硬坑。
- ✅ **probe 仓库卫生**：git 跟踪的 11 个 `_tmp-*.mjs` 已 `git rm`（可从历史恢复）；134 个未跟踪的一次性脚本挪进 `probe/_attic/` 归档（**未删除**，找旧诊断脚本去那里）。
- ✅ **A2/A3 端到端验证**：`visit-carriage-guard` 18 项 ALL PASS（相位链 done、odo 连续、零掉座、零 pageerror；spin 实测 2.0s = 新公式预测）；`horse-motion-guard` ALL PASS（马位移动后六匹动作判据不受影响）。
- ✅ **verify:quick 全绿**：日志 `outputs/_diag/verify-quick-2026-10-27-c1.log`（含 A2/A3/C1/B2 改动）。

### 已完成（第四轮 · 深夜收尾）
- ✅ **水色偏黑（视觉清单①）**：三轮截图迭代（探针 `probe/eyes-iter.mjs`，样张 `outputs/_diag/eyes-iter/`）——
  ① 池底透出亮度下限 0.45→0.62（01-materials 水面 shader）；② 池底贴图调色板整体提亮（01b `makePondBedTex`，淤泥基色 #4A4E3C→#5A5F47）；③ 吸收系数全档下调（uAbsorb 0.85/0.38/0.28→0.72/0.30/0.24）+ uDeep 1.80→1.58 + 水体自色 0x25443C→0x2B4B41 + 池底 envMapIntensity 0.22→0.32。
  定量：深水区亮度 60→71、浅水区 90→98；夏/冬/夜三态截图确认不再"沥青坑"，冬水读出深浅与涟漪。**fresnel-guard ALL PASS**（F 三档函数值不受影响，像素对比关系保持）。
- ✅ **z-fight 实修**：新探针 `probe/zfight-scan.mjs`（区域射线找 <0.02m 共面层）。真凶是 **yardWear 泥地补丁三层同高叠放**（55+ 处高差精确 0）——三组补丁错高 0/0.006/0.003、组内 Bare +0.012，现已分层 ≥1.18cm。其余扫描结果（马车坐垫 7mm、同网格自叠、ground 自叠 2 点）均在闪烁阈值外或同材质无观感影响，留档不追。旧 handoff 的 stableGateSlab↔mergedStatic 0.003m 在现扫描中未复现（已被当日 PAD_ROAD 改动覆盖）。
- ✅ **Tinker GLB 预载移除**：HorseTinker.glb（1.96MB）移出 13-preload 清单 + sw.js 预缓存（资产桶 v19→v20），15b 删模块求值期 fetch+settle，改为 HORSE_MODEL='tinker' 分支内懒加载。**smoke 56 项 ALL PASS**（启动/预载不卡）、**horse-motion-guard ALL PASS**（默认 rodin 六匹不受影响）。启动少下 1.96MB。
  ⚠️ 过门禁时踩的两小步（preload-manifest-sync 第一次跑红，正是它该拦的）：① sw.js GLBS **数组注释里不要出现成对引号**——门禁按引号提取条目，注释里写 `'rodin'` 会被当成清单项（已在 sw.js 注释里立牌）；② 磁盘上的 .glb 必须在两份清单**或 ASSET_EXEMPT 白名单**里——HorseTinker 已按 thunder.mp3 先例登记白名单（懒加载备选件）。
- ✅ **对弈肘（go2 右肘 1.70rad 顶死）**：已过时——10-27 的重解把 go2 右手改为"自然垂在体侧"（sx -1.2 / 肘 0.75），白天特写（chess2-chess-closeup.png）确认两人手臂自然，无僵直。视觉结案。
- ✅ **拱顶两端开口**：已过时——篷顶重做时已加两端朱红拱脸（carriageCanopyFace + 金边，15d:394-397），马车特写（carriage-closeup.png）确认两端封住。视觉结案。
- ✅ **彩虹横贯（视觉清单③）**：**决定不改**。现有形状是老黄本人 15 轮反馈的收敛结果（"窄一些"→BAND 2.6、"右端藏到山脚"→T1 118°、"位置高一些"→Y+2），且有 afterrain-guard 钉住拱顶/跨度；另一个 AI 的"虚彩带"描述的就是这个收敛态。改它=推翻用户自己的决定。
- 📷 新增两个常驻探针：`probe/eyes-iter.mjs`（四状态样张+对弈特写）、`probe/zfight-scan.mjs`（叠层扫描），后续视觉走查直接复用。

### 仍待办（仅剩 1 项真正的设计工程）
- **服装分层（host/棋手 clothing 只有色相偏移）**：需要逐人物加衣领/袍摆/腰带分层几何 + 逐轮截图确认，属独立设计工程，不适合盲改。其余 8 项旧 handoff 遗留中，3 项本轮确认已修（对弈肘/拱顶/出园路）、2 项本轮实修（yardWear 积雪+硬边/Tinker 预载）、1 项明确不做（彩虹）、z-fight 大头已清。

### 仍待办

### 3. 换季过渡每帧 4 次全场景遍历（~0.5h）—— ✅ 已完成（见上"第三轮"）
- `12-env.js:349` 与 `:357` 连续两次 `collectSeasonGLB()`，每次内部 2 个 `world.traverse`（12f-season.js:184/195）⇒ 过渡期每帧 4 遍全园点名。
- **修法**：删掉 :349 那次（第二次在 `applyPresence` 之后、`applyGLBSeason` 之前，是真正被用的那次；:349 是旧调用残留）。再给 `collectSeasonGLB` 加"已收满就早退"守卫（ListusPlant 等集合非空且本轮无新增 ⇒ return），过渡期从 4 遍降到 0。
- **验收**：切季节时 `ENVDBG` 日志确认风场注入仍齐全（12 株×3 态）；`reel-guard` 绿。

### 4. 每帧临时对象挪模块级（C1）—— ✅ 已完成（见上"已完成"）

### 5. 马车路点抄两份（B2）—— ✅ 已完成（见上"已完成"）

### 6. 上一份 handoff 的 9 项遗留（没动，照旧）
见 `docs/HANDOFF-2026-10-27.md`：Tinker GLB 预载、yardWear 不积雪、对弈肘限位、低档水黑、拱顶两端、服装分层、`_tmp-*` 清理、石路 z-fight、出园路垫层。其中 **yardWear 不积雪**（`wornDry/wornBare` 没走 `registerWeatherRoles`）与**低档水黑**（`uReflMix=0`）是另一个 AI 视觉走查确认过的用户可见项，建议排在 1/2 之后。

## 四、复核时确认过的"雷区"（改代码前先读）

- **mergeStatics 吞名**：合并网格 `name='mergedStatic'`、丢 renderOrder；`userData.noMerge` 不继承。悬停表修了打射线频率，但**没**把 mergedStatic 从表里排除——若以后想彻底排除，在 `_buildHoverTargets` 材质兜底分支加 `o.name==='mergedStatic'` 跳过会把桥/假山/荷叶标签一起丢掉，别做；正确方向是给合并体记录"成员清单"或用 BVH。
- **随机流**：改任何 `rr()/mulberry32` 的调用次数或顺序都会漂移全局布局 ⇒ `layout-fingerprint` 红。本次全部改动不含随机流变更。
- **步幅口径**：15c 马厩马（walk 0.75/trot 1.24）与 15d 辕马（恒 1.24）两处是**有意**不同口径，别"顺手统一"。
- **FLAKY 重跑**：verify-all 红门自动重跑一次，过了就标 FLAKY 放行。看日志别只看最后一行。
