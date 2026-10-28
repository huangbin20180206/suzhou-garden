# HANDOFF 2026-10-28 · 对弈/马夫一轮修之后 · 待优化清单

上一份：`docs/HANDOFF-2026-10-27-fix.md`。
HEAD = `29d6e8a`，分支 `refactor-06-split-20261013`（已推送 GitHub）。
本轮已交付（`29d6e8a`，不用再做）：shader 幽灵修复（vUv→vMapUv）、对弈手型掌心朝下、
闲手搭桌沿、撤深 tint 恢复肤色、茶杯一人一盏、棋钵开盖、马夫喂草行程状态机
（idle→toHay→grab→back→feed，与刷马循环互斥）。

以下 5 项是老黄 10-28 点名要继续优化的，按优先级排。

---

## 1. 马夫手里的草料捆蓬松化（`src/16a-actor-props.js` 的 FEED_BALE / makeHayHandful）

**现状**：56 根草茎是近直杆（CatmullRom 控制点几乎共线），捆扎半径 0.24m，
近景读作"一把芹菜"。相关代码在 `16a-actor-props.js`（makeHayHandful）与
`15d-carriage.js` 的 FEED_BALE 生成段（⚠️ 两处同族几何，**只改马夫手里那份**，
15d 那份是喂料斗用的，别动）。

**改法**：
- 草茎中段加弯曲：控制点 2/3 往随机侧向偏移 0.02~0.05m（私有随机流
  `mulberry32`，**不能动全局 rr()**——铁律 1，layout-fingerprint 会红）；
- 端头散开：顶端 1/3 段的半径倍数从 1.5 提到 2.0~2.6（每根各不同）；
- 端头再劈几根更细的分叉（可选，半径减半、长度 0.4~0.6 倍）。

**验收**：马厩近景截图（`probe/eyes-iter.mjs` 可复用），草捆读作"一把牧草"
而不是"一捆直签子"；draw call 不变（mergeGeometries 已经并成一件）。

## 2. 马夫衣服正面的大团凸起（GLB 资产问题）

**现状**：fig-laborer.glb 正面腰腹处有一大团无意义凸起（老黄截图可见），
疑是生成件把"腰带结/衣襟"生成成了鼓包，或 UniRig 绑骨时权重拉扯变形。

**排查顺序**：
1. 先在 Blender 里打开 `assets/fig-laborer.glb` 看**绑定姿态**（A 姿势）下
   凸起是否存在——存在 ⇒ 资产本身的问题（网格）；
2. 若绑定姿态没凸起、接入后才有 ⇒ 是我们 JS 姿态写出来的（重点查
   16-actors 里 groom 的 lean/headDown/brush 各姿势下 Spine/Chest 的角，
   以及 15c/15d 的教练姿态），用 `probe/` 的 actorStep 快进逐姿势截图比对；
3. 资产问题的话两条路：① Blender 里把凸起顶点抹平（Sculpt Smooth 或
   直接删面重补），重导出后跑 `node research/characters/validate_glb.mjs
   assets/fig-laborer.glb --require-skin` 过检；② 重新生成一件（慢，兜底）。

**⚠️ laborer/groom/coach 三人共用同一件 GLB**，改了三人一起变——正好，
三人都有这个凸起。改完必须重跑 horse-motion-guard（车夫姿态相关）确认无回归。

## 3. 主人 + 对弈两人面部调白一档（`src/16-actors.js`）

**现状**：29d6e8a 撤了深 tint 后肤色已恢复，但老黄觉得**还是偏黑偏暗**
（scholar 0xAEB9C9、go1 0xEDE7DC、go2 0xE8E2D8，都是乘在整张图集上的）。

**改法**（两步，别一步到位）：
- 先把三人的 tint 提到**纯白** 0xFFFFFF（等于不乘，看图集原色到底多深）；
- 若图集原色还是暗，在 dyeMaterial 的 shader 里给**亮像素区**（皮肤 value 高、
  会被 uDyeVMax 挡住不染的那批）加一个提亮项：`diffuseColor.rgb *= 1.0 + 0.25 * 皮肤掩码`
  —— 皮肤掩码可以复用 dye 里的 `vmask_`（取反）。
**⚠️ 只动 scholar/go1/go2 三个 def**（lady/child/guest 的脸色没人投诉，别顺手改）。
**验收**：对弈特写截图，三人脸色与仕女（lady，未改）并排对比，明显白一档
但不至于"惨白"；袍色饱和度不能跟着掉（tint 提白会整体提亮，可能要把 dye
的 val 往回收 0.05~0.10）。

## 4. 鹦鹉展翅不明显 + 飞行过快（`src/08f-macaw.js`）

**现状**：飞行中扇翅读不出来，且飞得太快、一晃就过。

**改法**：
- **扇翅**：振幅参数（找 wing/roll 相关的 sin 振幅）放大 1.5~2 倍；
  扇翅频率同步降低（周期 ×1.3~1.5），大鸟是慢扇，不是蜂鸟；
- **速度**：飞行速度/巡游周期参数降 30~40%（文件里有现成的速度常量）；
- 改之前先读 08f 头部注释——振翅相位用全程累积 flightT、**不随 mt 复位**，
  有专门的不变量注释，别破坏；
- 若有 macaw-guard 门禁钉了参数，门禁判据要**同步改**（先跑
  `npm run verify:all` 看哪条门红，按门的语义改门或改参，别盲调到绿）。

**验收**：`probe/eyes-iter.mjs` 或手动跟拍：鹦鹉飞过一个可预测的弧线，
中途回放能看清"上扇-下扇"两相；速度读作"滑翔为主、偶尔扇两下"。

## 5. 通用规矩（每项都要遵守）

- **私有随机流**：新增抖动一律 `mulberry32(固定种子)`，不许 `Math.random()`、
  不许多抽全局 `rr()`（铁律 1，layout-fingerprint 门禁）；
- **门禁**：改完跑 `npm run check && npm run unit`，视觉项跑
  `npm run verify:quick`（十几分钟）；红了先读懂门在量什么再改；
- **截图走查**：`probe/eyes-iter.mjs`（四状态样张）、`probe/zfight-scan.mjs`
  （叠层扫描）是现成工具，改完各跑一遍；
- **提交**：一项一提交，说明里写"改了什么+为什么+截图路径"。

---

## 本轮执行结果（2026-10-28 下午，HEAD 从 7b03898 起）

| # | 项 | 状态 | 提交 | 关键数字 / 结论 |
|---|---|---|---|---|
| 1 | 草料捆蓬松化 | ✅ 完成 | dbcd95b | 单根改带弯锥形管 + 24 根外倾 6~15°、侧向缩放 0.55~1.45；私有 mulberry32(20261028)；draw call 不变 |
| 2 | 马夫衣摆凸起 | ⛔ 未复现，**未改资产** | — | 绑定姿态渲染（probe/glb-bind-view.mjs）正面腰腹是平的，只有左前的**白色腰带结与垂带**；页面内锁显马夫拍正面（eyes-items6/v6-front.png）同样没有鼓包 ⇒ 判为腰带结/衣摆，不是网格缺陷 |
| 3 | 三人肤色 | ✅ 完成 | 96aef7e | tint 撤到 0xFFFFFF；⚠️ 提白触发**绛紫染色带绕回肤色**（脸变洋红）⇒ scholar 的 dye 加 vMax 0.50；lady/child/guest 未动 |
| 4 | 鹦鹉扇翅/速度 | ✅ 完成 | 2c91e31 | ampFly 0.35→0.55、freqFly 16→11、三段时长 ×1.43（速度降 30%）；实测飞行扇翅角 0.36~1.68 |
| — | 探针工具 | ✅ | 291e52d | eyes-items2 / eyes-items6 / glbview.html + glb-bind-view.mjs |

**验证**：npm run check / unit / verify:quick 全绿（outputs/_diag/verify-quick-2026-10-28.log）；
macaw-wing-guard + macaw-guard ALL PASS；eyes-iter 四状态样张零 pageerror。
`zfight-scan` 仍报马厩院门一带 6 组 <0.02m 叠层（ground/mergedStatic/stableGateSlab 的自叠与互叠），
与本批改动无关（本批只动草捆几何、材质 tint 与鹦鹉参数）。

**遗留**：若老黄仍觉得马夫正面有鼓包，请给一张截图 —— 从绑定姿态与页面两个角度都只剩
腰带结那团白布，需要他的取景才能定位。
