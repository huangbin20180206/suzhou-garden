# HANDOFF 2026-10-30 · 第 0 周热修（hark/week0-hotfix）· 重做版

上一份：`docs/HANDOFF-2026-10-29.md`（上午的到访改版，已入库 4ed22e1）。

## 背景一句话

10-29 晚另一个 AI（Codex 侧）按老黄的清单做了"第 0 周热修"6 个提交（分支
`hark/week0-hotfix`，2572b58→4fadc71），**但它额度用完、工作没落到本仓库**
（本仓库查无此分支/提交/交接文档，真机 visit-carriage-guard 26/26 全过 ⇒
它报的 bootDone 卡死是它沙箱慢，不是回归）。10-30 凌晨老黄拍板"你照它的
方案单自己操刀"，本文件就是重做版的存档。

分支：`hark/week0-hotfix`（自 c58c3ca 切出，**6 个提交**，未推送）。

## 六个提交（对应原方案单的"已完成"清单 + 待办4小尾巴）

| # | 提交 | 内容 |
|---|---|---|
| 1 | 934fb2a | **烟花/闪电不再每帧覆写时段灯光预设**：tickFireworks 尾巴五路写灯（sun/amb/hemi 强度 + fill 强度/颜色 + 曝光）全收进"闪光帧或收尾帧"，基准从模块加载常量改为 ENV.cur；lnApply 同规矩（f=0 不写灯）。连带修 fill 灯位置不归位的老 bug（新增 09-lights `FILL_HOME`）。⚠️ 夜景/暮色观感会变（夜里 fill 回到预设 0.12~0.16，不再被顶成 0.32） |
| 2 | 39b7a3c | **启动看门狗第二级**：原有 bootFail 兜底只护到 `__garden` 赋值为止；补一只拴在 bootDonePromise 上的 120s 看门狗，未开园弹失败卡，已开园只 console.error |
| 3 | 2c69a0b | **画质三件套**：手机/未知 GPU 自动降均衡档（独显正则扩到 RTX/RX 全系）；阴影按 SHADOW_CAP=maxTextureSize 封顶（09-lights 初始化 + QOS applyShadow 两处）；暖机 GTAO 按档位还原（restore 用 AO_ENABLED）；animate 本体挪进 frameWork() + try/catch 兜错——单子系统报错不再冻帧。⚠️ 配套暴露 `__garden.loopErrors()`（count + recent 3 条），**门禁断言零报错从此要看它**（pageerror 抓不到循环内的病了） |
| 4 | 2a3fbdc | **人物马车六项**：辕马停车站姿（travelCarriagePlace 按动/停缓 gaitW）；裙摆不侧翻（侧片跟随系数 0.94→0.55，前后片实测数原样保留）；马夫 laborer/groom 补 followFloor；踏面射线跳过 >100 实例的植被场；全场看门狗（1500s 强制收尾 + wrap 240s 不再要求 hostAtQin）；重播复位避镜头（<24m 先藏 0.9s 再复亮） |
| 5 | 209330d | **主峰默认程序化太湖石**：heroSrc 默认 'proc'（10-14 试水预案反向启用），?heroSrc=glb 懒取对比档；boulder-hero.glb 撤出两份预载清单（省 5.46MB），sw 资产桶 v20→v21，manifest-sync 白名单补理由 |
| 6 | 240db56 | **Draco 解码器本地化**：gstatic → vendor/draco/（三个文件来自 three 自带包；当前资产全无 Draco，纯兜底，不进 SW 预缓存） |

## 验证现状（写这些字时的状态）

- 每步都过：npm run check 全绿（no-undef 52 单元）· unit 6/6 · preload-manifest-sync 8 项+自检 ALL PASS
- visit-carriage-guard **26/26 ALL PASS**（outputs/_diag/wk0-visit-guard.log，含贴地/相位链/终态）
- horse-motion-guard ALL PASS（wk0-horse-guard.log）
- fireworks-guard 28/28、thunder-guard exit=0（wk0-fireworks.log / wk0-thunder.log，灯光修复后跑的）
- **verify:quick 全量：ALL GATES PASS（9 道门全绿，exit=0）**（outputs/_diag/wk0-verify-quick.log，
  10-30 02:00 前后）。意外的好消息：**layout-fingerprint 免重标就绿了**——主峰是延迟装配件
  （立峰·云根），指纹的采样点取不到它。这同时印证了"延迟装配没收尾"这类病的隐蔽性：
  连指纹都看不见它。（本轮在 Intel Iris Xe 上跑的——autoTier 把它正确送进 low 档，
  门禁全绿说明 low 档行为也没被这轮改坏。）

## 预期要重标的基线（结果：一个都不用动）

verify:quick 全量 9 道门全绿，**基线零改动**。预想中的四处重标为何没触发：
1. layout-fingerprint：主峰是延迟装配件，指纹采样点取不到（见"验证现状"）；
2. 夜景/暮色截图基线：quick 套件里没有夜景/暮色截图门（那在全量 verify 或专用门里，
   下次跑全量时若红，按"夜里 fill 回到预设 0.12~0.16"的语义重标即可）；
3. 烟花亮度阈值：fireworks-guard 实测 28/28 没红（阈值口径扛住了基准换源）；
4. 裙摆：前后片系数原样保留，无裙摆门红。

## 原方案单里**没做**的（留给下一场，按原执行顺序）

- **第 2 步剩余**：手动看第二场重播（探针过了，人眼没看）。
- **CI 与测试收尾（原 4–6 人日）**：三个子项——① Linux CI 的 vendor-fresh 误报（probe/vendor-fresh.mjs，怀疑 esbuild 产物含平台相关路径/换行）；② 纯 node 门现在只挂 master push（ci.yml:75 那组），要全分支；③ 沙箱直接跑浏览器门；④ 浏览器门共享一次启动上下文 + 同步门数和 README。
- **架构收口（原 8–11 人日）**：applyState 统一入口 / 导演层声明式相位表 / 拆 16-actors.js（3803 行）与 11-loop.js（2310 行）/ 画质集中 quality.js / 生产收起 __garden。
- **内容写意（原 6–9 人日）**：写意标注 + 礼仪相位（门房通报→奉茶→马夫接马）/ 真实日轨 + 旬花历 / 梅雨春雨冷雨雪霁。
- **资产压缩（原估 18–19MB→5–7MB）**：gltfpack/meshopt + KTX2 + manifest 单一真值。
- 全部绿之后**并回 master**（先推送 hark/week0-hotfix 给老黄过目）。

## 铁律提醒（没变）

私有随机流 mulberry32、不动全局 rr()；一项一提交；改完 check+unit、视觉跑 verify:quick；
红了先读懂门在量什么再改门或改参，别盲调到绿。
