# 周三发布趟路（只读调研 · 不改代码）

> ⚠️ **2026-10-17 用户更正**：「发布窗口每周三」只是一次测试，**已作废** —— 发布/上线不按星期排期，
> 由用户随时决定。本文其余部分（合并零冲突、Pages 源 = master、真机 5 件事）仍然是实测事实，继续有效。


> 调研日期 2026-10-14 · 项目 `E:\ai_test\codex_test\suzhou-garden`
> 分支 `refactor-06-split-20261013` @ `23f7dd2` · 基线 `master` @ `0113065`
> 全程只读：未改任何代码文件、未跑浏览器门、未占 GPU。**未 commit。**

---

## 0. 一句话结论

1. **合并 = 快进（fast-forward），零冲突。**
2. **发布通道已经在线**：GitHub Pages 已启用，源 = `master` / 根目录；**历史上 10 次 Pages 部署全部 `ref=master`** ⇒ 合并进 master + push，Pages 自动重建。**Settings 里一个按钮都不用点。**
3. **唯一拦路**：工作区有 3 个未提交文件（天气单），其中 **2 个正好跨分支有差异** ⇒ 脏树上直接合并会被 git 拒绝。

---

## 1. 合并风险

| 项 | 实测值 | 怎么量的 |
|---|---|---|
| `master` | `0113065` · 2026-10-12 00:14:12 · "给真马补零件…" | `git rev-parse master` |
| `origin/master`（活远端） | `0113065`（与本地一致） | `git ls-remote origin` |
| `refactor` HEAD | `23f7dd2` · "feat(互动): 鼠标划过物体浮出小字标签" | `git log -1` |
| `master..HEAD` | **32 笔** | `git rev-list --count` |
| `HEAD..master` | **0 笔** | 同上 |
| merge-base | `0113065` == master 本身 | `git merge-base` |
| 是否快进 | **是**（`merge-base --is-ancestor master HEAD` exit 0） | — |
| 冲突文件 | **无**（`git merge-tree --write-tree master HEAD` exit 0，tree `8889811…`） | — |
| 差异规模 | 52 文件，+10157 / −5060 | `git diff --shortstat` |

**结论：master 上没人动过**（活远端仍是 0113065，与 Chief 预期一致），且 refactor 是 master 的直系后代 ⇒ **可 `--ff-only` 合并，不会产生 merge commit**。

### ⚠️ 合并前必须先处理：脏文件

| 文件 | 未提交改动 | master↔HEAD 是否有差异 | 后果 |
|---|---|---|---|
| `src/06b-atmos.js` | +52 / −2 | **有**（1/1） | `git checkout master` 会被拒：*local changes would be overwritten* |
| `src/12-env.js` | +10 / −1 | **有**（2/1） | 同上 |
| `src/2b-wind.js` | +16 / −0 | 无 | 安全，可带着走 |

⇒ 二选一：**①** 等天气单提交进 refactor 再合；**②** `git stash` → 切 master 合并 → `git stash pop`。**不要在脏树上直接切 master。**

### CI 现状：当前 HEAD 上全绿

run `38501372786` @ `23f7dd2`（2026-10-14T02:30:21Z）：

| job | 结论 | 耗时 |
|---|---|---|
| 静态门禁（check + audit） | success | 41s |
| 浏览器冒烟（smoke） | success | 825s |

---

## 2. 发布路径二选一

### 首选：GitHub Pages —— **已经开着，零配置**

证据（全部匿名可读，无需 token）：

- 仓库 API：`private=false`、**`has_pages=true`**、`default_branch=master`
- **deployments API：10 次部署，`ref` 全部是 `master`**（最近一次 `2026-10-11T16:17:38Z` @ `0113065`）
- 线上 `index.html` 的 sha256(LF) = `d15e368d…`，与 `git show master:index.html` **逐位相同**；与 HEAD `562dc974…` 不同
- 线上 `sw.js`（16,360 B / `3fe3d7cd…`）也与 master **逐位相同**，HEAD 是 18,683 B / `d5675163…`
- 线上还**缺** `hover-label` / `观鱼` / `匾联` / `曲桥` 这些只在 refactor 才有的字符串 ⇒ **现在线上是旧版**
- 线上可达性实测（HTTP 200）：`/`、`/index.html`、`/vendor.js`、`/sw.js`、`/manifest.webmanifest`、`/assets/Macaw.glb`、`/icons/garden.svg`、`/docs/cover.jpg`、`/src/11-loop.js`（138,400 B）

**用户要点哪几个按钮：0 个。**
（可选只读核对 1 处：Settings → Pages → Source，应为 `Deploy from a branch` / `master` / `/(root)`。10 次部署全 `ref=master` 已足够判定。）

**上线后要看的一处**：push 到 master 后，Actions 会自动出现一条 `pages build and deployment`（历史实测出现过 10 次），等它变绿即上线完成。

免费 / 绑卡（GitHub 官方文档原文，2026-10-14 核实）：

- 「GitHub Pages is available in **public repositories with GitHub Free**」⇒ 公开仓库**免费、无需绑卡**
- 限额原文：源仓库建议 **≤1 GB**、站点 **≤1 GB**、部署超时 **10 分钟**、软带宽 **100 GB/月**、软上限 **10 次构建/小时**
- 条款提醒：Pages 不允许当「跑线上生意/电商/SaaS」的免费主机 —— 本项目是园林展示页，不触发

### 备选：Netlify / Vercel 拖拽

| 项 | 结论 | 核实程度 |
|---|---|---|
| 免费 / 是否绑卡 | **本轮未核实**（Netlify 定价页 fetch 失败、Vercel 定价页 JS 渲染取不到正文） | ❌ 未核实，别当结论用 |
| PWA 的 `sw.js` scope | 结构上可行：两家都发 HTTPS + 根路径，SW 只要求安全上下文 + 同源；本项目 `sw.js` 在根、`scope:'./'` | 结构推断，未实测 |
| 拖拽入口存在 | `https://app.netlify.com/drop` 实测 **200** | ✅ 入口已核实 |

⚠️ 若真走这条：**不能直接拖整个项目根目录** —— 里面有 `node_modules/` 76 MB、`outputs/` 2,117 MB、`research/` 49.9 MB、`.codely-cli/` 674 MB。要拖「发布面」白名单（`index.html` + `src/` + `assets/` + `icons/` + `docs/` + `vendor.js` + `sw.js` + `manifest.webmanifest`）。

**建议：走 Pages。** 备选只在 Pages 出问题时才启动。

---

## 3. 静态可服务性核查

| 问题 | 结论 | 证据 |
|---|---|---|
| `file://` 双击能开吗 | **不能** | `index.html:942` 有 1 个 `<script type="module">`，其 `./src/*.js` import 在 file:// 下被 CORS 拦；`docs/real-device-acceptance-checklist.md:27-28` 已写明 |
| http server 根挂载零配置 | **是** | 全站 `href/src` **无前导 `/`**（扫描 0 命中）；manifest `start_url:"./index.html"`、`scope:"./"`；`npm run serve` → `127.0.0.1:8935` |
| 子路径部署（`/suzhou-garden/`） | **成立** | 全部相对路径；线上该子路径下所有资源实测 200 |
| `sw.js` scope | **成立** | `src/11-loop.js:2118-2120`：`register('./sw.js', { scope: './' })`，且带 `/^https?:$/.test(location.protocol)` 守卫 ⇒ file:// 不注册、https 注册 |
| 首开下载量 | 发布面 **61 文件 6.71 MB** | 逐文件累加（全 tracked 218 文件 8.66 MB，含 `probe/` 150 文件 1.79 MB） |

首开拆解（未压缩；Pages 对文本会 gzip）：

- `vendor.js` 1,034,794 B
- `assets/` 7 文件 3,680,915 B（`Macaw.glb` 1,561,572 B 最大）
- `src/` 35 文件 ≈1.66 MB
- `index.html` 74,773 B

⇒ 移动端首开是**几 MB 级**，不是几十 MB；装成 PWA 后模型走 cache-first 不再重下。

两条非阻塞提醒：

- 仓库**没有 `.nojekyll`**：Pages 默认过一遍 Jekyll。当前 tracked 里没有 `_`/`.` 开头的目录，不会被吞；加 `.nojekyll` 是稳妥项，但**属改代码，本单不做**。
- `probe/`（150 文件 1.79 MB）也在发布面里。密钥扫描 `ghp_`/`github_pat_`/`sk-`/`AKIA` **全 0 命中**，只是把门禁脚本一起公开了。要不要收窄发布面，另议。

---

## 4. 网址一上线就要在手机上看的 5 件事

| # | 做什么 | 该看到什么 | 出处 |
|---|---|---|---|
| **1 旋转** | 单指拖动转视角 | 视角跟手，不抖不飘 | 清单 §2.3 #14 |
| **2 缩放** | 双指捏合 | 能缩放、不卡 | 清单 §2.3 #13 |
| **3 面板** | 点左下角方印 → 面板弹出 → 点面板外收起 | 方印在、按钮 ≥44px、一屏放得下、点外面自动收 | 清单 §2.1 #2~#8（`index.html:58/59/493/537`） |
| **4 横屏** | 手机横过来 | 画面跟着转不变形、方印仍在左下、按钮不超出右缘 | 清单 §2.2 #9~#11 |
| **5 发热** | 连续 15 分钟 + 中途切天气 + 切后台再回来 | 帧率不明显掉、背面温烫可接受、后台回来不卡死 | 清单 §2.5 #18-19、§2.4 #16-17 |

**⚠️ 上线后才第一次可测的一条（建议追加）**：局域网 `http://<电脑IP>:8935` **不是安全上下文** ⇒ SW 不注册、PWA 装不了（`probe/serve.mjs:12-19` 明写）。现在换成 https 公网域名，**SW 会首次真正注册** ⇒ 「装到桌面 + 断网还能打开」是这次上线**新增**的可测项，本地预览从来没测到过。

---

## 5. 未核实 / 待确认

1. **Netlify / Vercel 的免费额度与是否绑卡** —— 官方页面取不到正文，**未核实**。
2. **Pages Settings 里 Source 的具体文案** —— `/repos/…/pages` API 匿名返回 404，靠 deployments `ref=master` × 10 次判定；要 100% 确认需登录看一眼（只读）。
3. **真机实测本身** —— 本单不跑浏览器门、不占 GPU，第 4 节 5 件事都待用户拿手机执行。

---

## 6. 建议的周三执行顺序

1. 处理脏文件（天气单提交 / 或 `git stash`）
2. `git checkout master && git merge --ff-only refactor-06-split-20261013`
   （`--ff-only` 既保证不留 merge commit，也保证一旦不是快进就立刻失败而不是悄悄造一个合并提交）
3. `git push origin master`
4. 看 Actions → `pages build and deployment` 变绿（软上限 10 次/小时，够用）
5. 手机打开 `https://huangbin20180206.github.io/suzhou-garden/`，走第 4 节 5 件事
6. 若第 4 步卡住 / 超 10 分钟：看 Pages 构建日志，**别急着重推**（会吃构建次数）

---

> 说明：`research/` 目录当前**未被 git 跟踪**（也不在 `.gitignore` 里）。本文件不会进任何提交，除非有人执行 `git add -A`。
