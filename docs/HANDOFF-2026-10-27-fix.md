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

### 0. 重跑验证（先做，~15 分钟）
`npm run verify:quick` 必须在本批改动后重跑一次留档。改动面是 06k/06l/06m/11/15c 五个文件，覆盖 quick 里的 import-audit / layout-fingerprint / smoke。

### 1. 马车朝向跳变（A2，~1h）⭐ 用户可见
- `back` 段硬设 `yaw=π`（16-actors.js:1533），而 `arrive` 终点朝向 `atan2(-0.9,-3.2)≈-2.868` ⇒ 一帧跳 15.7°。
- `spin` 结束 `yaw=0`，`depart` 首段 `atan2(1.3,1.2)≈0.825` ⇒ 一帧跳 47°。
- **修法**：depart 首段不走 `pathAt` 直接摆位，先用现有的 `angDiff` 插值把 yaw 从 0 平滑转到 0.825（可以并入 spin 段末尾多转 47°，或在 out 段前加 0.3s 的对齐小步）。back 段同理：进入 back 时从当前 yaw 平滑回 π，而不是直接设值。
- **验收**：新增/扩展 `probe/visit-carriage-guard.mjs`，判据加"任意 0.4s 窗口 |Δyaw| ≤ 0.12rad"（1.15rad/s 转向速率 × 0.4s ≈ 0.46，取 0.12 已很宽松；跳变帧实测 >0.27）。

### 2. 辕马相对车错位 0.7m（A3，~0.5h）⭐ 用户可见
- parked 时马在车局部 z≈1.45（15e-stable.js:943 槽位 −2.85 vs 车心 −1.4+），行驶时 `travelOff.z=2.15`（15e-stable.js:1163）⇒ 出发瞬间马向前蹦 0.7m。
- **修法**（二选一，推荐 ①）：
  ① 把 `travelOff.z` 改 1.45 与 parked 对齐；轭在车局部 z=1.38（15d-carriage.js:453），马肩颈"马心−0.55"落在 1.38 ⇒ 马心理论位 1.93——说明 **1.45 本来就偏后**，正确做法是 parked 槽位与 travelOff 统一取 1.93（顺带修掉"轭落在马肩后"的旧账）。
  ② 只把 travelOff 改 1.45 保持现状观感，轭错位留档不动。
- **验收**：到访探针里量"马心到车心距离"在 parked→drivein 切换帧 |Δ| ≤ 0.05m。
- ⚠️ 改槽位要同步 15e-stable.js 的注释与 yardWear/粪堆等邻近摆位，跑 `figure-foot-guard`。

### 3. 换季过渡每帧 4 次全场景遍历（~0.5h）
- `12-env.js:349` 与 `:357` 连续两次 `collectSeasonGLB()`，每次内部 2 个 `world.traverse`（12f-season.js:184/195）⇒ 过渡期每帧 4 遍全园点名。
- **修法**：删掉 :349 那次（第二次在 `applyPresence` 之后、`applyGLBSeason` 之前，是真正被用的那次；:349 是旧调用残留）。再给 `collectSeasonGLB` 加"已收满就早退"守卫（ListusPlant 等集合非空且本轮无新增 ⇒ return），过渡期从 4 遍降到 0。
- **验收**：切季节时 `ENVDBG` 日志确认风场注入仍齐全（12 株×3 态）；`reel-guard` 绿。

### 4. 每帧临时对象挪模块级（C1，~1h，机械活）
- `11-loop.js:1083` koi `bases` 数组 + `:1099/:1104` 两批对象字面量（11 条鱼 → 23 个/帧）：预分配复用。
- `11-loop.js:1372` `lastPos = {x,z}`：人物对象上预建字段复用。
- `15c-horse-life.js:233` `new Matrix4/Quaternion/Vector3×2`：提成模块级（照 15b `_tq/_te` 的做法）。
- `16-actors.js:2084-2085` `advance()` 的 Quaternion+Euler：同上。
- `08e-birds.js:456-461` 每鸟每帧 3 个对象：现在 0 只鸟零成本，但**恢复鸟数之前必须先修**（写进 TODO 防踩）。
- **验收**：`layout-fingerprint` 逐位不变（这些都是纯换内存写法，不能改任何数值口径）。

### 5. 马车路点抄两份（B2，顺带做，~0.5h）
- `15d-carriage.js:88-89` 的 `_ROAD_A/_ROAD_B` 是 `15e-stable.js` `STABLE_ROAD_PTS/STABLE_EXIT_PTS` 的手抄副本（当时为避环）。现在 15d 已经 import 15c，**不 import 15e**——检查 15e 是否可被 15d 安全引用；若仍有环风险，改为从 15a-shared 或 15e 拆出的新常量文件导出一份，两边 import。
- **验收**：grep 确认全项目 `[[40.0,4.2]` 只出现一处定义。

### 6. 上一份 handoff 的 9 项遗留（没动，照旧）
见 `docs/HANDOFF-2026-10-27.md`：Tinker GLB 预载、yardWear 不积雪、对弈肘限位、低档水黑、拱顶两端、服装分层、`_tmp-*` 清理、石路 z-fight、出园路垫层。其中 **yardWear 不积雪**（`wornDry/wornBare` 没走 `registerWeatherRoles`）与**低档水黑**（`uReflMix=0`）是另一个 AI 视觉走查确认过的用户可见项，建议排在 1/2 之后。

## 四、复核时确认过的"雷区"（改代码前先读）

- **mergeStatics 吞名**：合并网格 `name='mergedStatic'`、丢 renderOrder；`userData.noMerge` 不继承。悬停表修了打射线频率，但**没**把 mergedStatic 从表里排除——若以后想彻底排除，在 `_buildHoverTargets` 材质兜底分支加 `o.name==='mergedStatic'` 跳过会把桥/假山/荷叶标签一起丢掉，别做；正确方向是给合并体记录"成员清单"或用 BVH。
- **随机流**：改任何 `rr()/mulberry32` 的调用次数或顺序都会漂移全局布局 ⇒ `layout-fingerprint` 红。本次全部改动不含随机流变更。
- **步幅口径**：15c 马厩马（walk 0.75/trot 1.24）与 15d 辕马（恒 1.24）两处是**有意**不同口径，别"顺手统一"。
- **FLAKY 重跑**：verify-all 红门自动重跑一次，过了就标 FLAKY 放行。看日志别只看最后一行。
