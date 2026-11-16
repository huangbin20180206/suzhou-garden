# 2026-11-16 ⑥ 把「尺子量错东西」这条教训套到其余像素门

## 一、为什么要做

`reel-guard` 出过一起真事故：它量的是整帧平均亮度，而「环境抽屉」正好开着，
占掉画框 68.4%，于是**量到的主要是那块面板，不是园子**。当时用 `frameMeanOutside`
（把面板区域剔出统计）修好了（`0b625d3`）。

这条教训的本质不是「抽屉挡了东西」，而是：**定点/定区取像素的门，一旦取样点落在界面浮层上，
读到的就是浮层的像素，与画面无关；而浮层在两帧里完全一样，还会把差分信号按面积比稀释。**

本轮把这条教训逐门核了一遍，只改「怎么取像素」，**判据、阈值、取样列一个都没动**。

## 二、95 道门按取像素通路分三类

| 通路 | 含义 | 门（举例） | 会不会量错对象 |
|---|---|---|---|
| ① 画布直读 `drawImage(renderer.domElement)` | 只把 WebGL 画布搬出来，拍不到 DOM | `afterrain-guard`、`thunder-guard`、`fresnel-guard`、`fireworks-guard`、`sky-layer-guard`、`weather-coverage`（旧写法 `page.screenshot()` 拿到空画布，已换成页内读缓冲） | **不会**，结构性免疫 |
| ② `page.screenshot()` + 中心区取样（画框 30%~70%） | 把浮层一起拍进去，但浮层都贴边 | `stele-clean`、`stele-legibility`、`stele-station`（ROI 均为 x/y 30%~70%） | 取样区在正中，浮层在四角 ⇒ 不重叠 |
| ③ `page.screenshot()` + 定点/全帧 | 浮层会落进取样点或进差分分母 | `mist-guard`（定点列）、`lampvol-guard`（定点小框）、`lamp-guard`（全帧差分）、`reel-guard`（全帧，已修） | **会**（本轮处理） |

另有 `pageerror-guard` 用 3 张连拍比「帧有没有在动」：浮层三张完全一样、对差分的贡献是 0，
只可能把读数**压低**（误报红），不会把坏画面伪装成好的，属安全方向，不动。

## 三、修法：只改「取像素之前把界面藏起来」，并先证明取样点到底量到了什么

新增 `probe/_chrome.mjs`：

- `hideChrome(page)`：把 `#hud/#stats/#env/#guide/#caption/#hover-label/#showKeys/#walk-help/
  #tip/#toast/#ld-quick/#see-lantern/#loading` 设成 `visibility:hidden`（不改布局，避免重排），
  并兜底隐藏其余 `position:fixed` 浮层（`#app` 除外）；`showChrome(page)` 复原。
- `occludersAt(page, points)`：**直读判据**。对每个取样点调 `document.elementFromPoint`，
  往上找祖先，命中 `CANVAS` 就算「量到画面」，否则报出挡在上面的是谁。

三道门都在取像素前加了自检行 + 藏浮层，`try/finally` 复原：

- `mist-guard`：山脊/天空共 120~126 个定点，逐点直读后打印被遮数量，再藏浮层连拍 5 张取中位数。
- `lampvol-guard`：取样小框（`view.sx/sy`，r≈58）框心 + 四角共 5 点直读，再藏浮层。
- `lamp-guard`：全帧差分门，撒 40×24＝960 点直读算真实遮挡占比，再藏浮层拍 A/B 两帧。

## 四、一次自查纠错（这轮最有价值的产出）

第一版 `_chrome.mjs` 用「矩形列表包含」判遮挡，`mist-guard` 自检当场打出
**「120/120 取样点落在浮层里（例 x=30 y=204 → div）」**。但同一轮改前/改后读数**一字不差**，
这两个事实互相矛盾 —— 矛盾本身就是证据。

诊断脚本 `outputs/_diag/chromehit-20261117.mjs`（`elementFromPoint` 撒 5 行×21 列＝105 点）实测：
**104/105 命中 canvas**，唯一例外是 x=30 y=560 落在透明的 `div.drawer-toggle`（bg `rgba(0,0,0,0)`）；
canvas 的祖先链是 `canvas(static)` ← `div#app(fixed, rgba(0,0,0,0))` ← body。

⇒ 第一版把**透明的画布外壳**当成了浮层。已据此重写 `chromeRects`（只认「真会画出东西」的：
背景不透明、或有文字、或有背景图，且不含 canvas），并把 `occludersAt` 定为唯一可用来下结论的判据。
假警报比不报警更坏 —— 它会让人去修一个不存在的问题。

## 五、读数对照

| 门 | 改前（`00-before-*.log`） | 改后（`01-after-*.log`） | 判定 |
|---|---|---|---|
| `mist-guard` | ALL PASS 25 项；night+clear 最差列 x=550 **1.07**；night+mist x=750 **8.71**；night+overcast x=550 **−6.14**；night+storm x=750 **−5.86** | ALL PASS 25 项；**1.07 / 8.71 / −6.14 / −6.14**；自检 0/120 被遮 | 逐位相同（storm 一条随粒子随机浮动 0.28，仍 ≤12） |
| `lamp-guard` | ALL PASS 17 项，73s | ALL PASS 17 项，73s；自检 960 点里 6 点被遮＝**0.6%**（透明 `div.drawer-toggle`） | 结论不变；顺带量出这门的稀释上限只有 0.6% |
| `lampvol-guard` | 47/47 通过；liftNear 4.6913、liftFar 0.0000 | 47/47 通过；liftNear **4.6959**、liftFar **0.0000**；自检 0/5 被遮 | 信号差 0.1%，噪声量级内 |

三条门的读数都没变，说明它们**原本就没被浮层遮到**（`mist` 的取样列都在画面里、
`lampvol` 的光团在画框中部），本轮改的是「以后浮层打开着跑也不会量错」的保险，而不是修正读数。
真正的收益是把这件事**变成可自查的**：以后任何一条定点/定区门，日志第一行就写清
「这几个点到底量到的是画面还是面板」。

## 六、哪条不能当证据

- `01-after-*.log` 里 `mist` 的自检行是本轮**重跑后**的干净版本；上一版跑出的
  「120/120 落在浮层里」是假警报，已删除不再留存（纠错过程写在第四节）。
- `night+storm` 一条读数每次跑都会小幅浮动（粒子随机），不能拿单次数字做逐位比对。
- 软渲染（无头）耗时 320s / 73s / 94s 只代表本机核显，不代表用户机器的帧率。
