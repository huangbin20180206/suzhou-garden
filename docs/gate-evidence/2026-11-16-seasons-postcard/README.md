# 明信片 · 四季四联（2026-11-16/17）

用户已批准顺序「⑤第一人称自己走 → ⑥门禁量具教训推广 → ④明信片四季四联」的最后一项：
**同一机位、同一时辰，只换季节，把春夏秋冬连拍成一张 2×2 的明信片。**

## 一、做了什么

| 位置 | 改动 |
|---|---|
| `src/12-env.js` | 新增 `export function settleEnv()`：把季节过渡**一步落位**（`ENV.t = 1` 后 `applyEnv`），不必等 2.8s 动画 |
| `src/11-loop.js` | `SEASON_QUAD`、`seasonsPostcardData()`、`takeSeasonsPostcard()`、`seasonsLayout()`；`HOOKS.postcardSeasons` / `HOOKS.postcardSeasonsData` |
| `src/12-env.js` | 按钮分发 `if (b.dataset.act === 'seasons'){ HOOKS.postcardSeasons?.(); return; }`；ICON 表加 `'act:seasons': '▦'` |
| `index.html` | 「留影」行加 `<button data-act="seasons" …>四联</button>`；CSS 给它的 `::before` 上色 `#6E9E5A` |
| `probe/postcard-season-guard.mjs` | 新门（四段断言，见下） |

成品：2648×1683 宣纸底，2×2 四格各 1280×720（等于画框原尺寸），顶栏「远 香 堂 · 四 季」+ 右上「日期 · 时辰 · 天气」，
每格左下角季节字，底栏「春 · 夏 · 秋 · 冬　同一机位连拍，四季并置一纸」+ 朱文印「云根」。

**为什么必须先落位再拍**：四联的语义是「同一刻只换季节」。若沿用常规 `setEnv` 的 2.8s 过渡，
四格里每一格都会停在过渡中间（春拍到 37% 的春、夏拍到 12% 的夏），四张不一样的状态拼在一起毫无意义。

## 二、门禁守什么（`probe/postcard-season-guard.mjs`）

1. **WIRED** —— 按钮在、`textContent` 里只有「四联」两个字（图标由 CSS 的 `data-ic` 注入，不许混进文字），两个 HOOKS 都是函数。
2. **SETTLE** —— 调 `settleEnv()` 后立刻 `ENV.t = 1`（`tMid = 0` 证明它没走过渡），返回 `did = true`，且拍完季节还原、`backT = 1`。
3. **DIFF** —— 四格两两做**逐像素**平均差，最小的一对也必须 ≥ 2.5。
4. **纸边 / 无异常** —— 左上角 6×6 是宣纸色 `rgb(239,233,220)±12`（外框塌了这里就会变成画面像素）；`pageerror` 必须为空。

## 三、读数对照

改后（`01-after-seasons-guard.log`，EXIT=0）：

```
WIRED {"btn":true,"label":"四联","ic":"▦","hook":"function","dataHook":"function"}
SETTLE {"keep":"summer","tMid":0,"tEnd":1,"did":true,"back":"summer","backT":1}
COMPOSITE {"before":{"season":"summer","t":1},"after":{"season":"summer","t":1},"ms":577,"size":[2648,1683],"paper":[239,233,220]}
DIFF spring-summer 5.37 / spring-autumn 7.70 / spring-winter 15.04
     summer-autumn 8.74 / summer-winter 16.05 / autumn-winter 10.84
ALL PASS: seasons button / settleEnv lands instantly / four quadrants differ / paper margin / season restored / page errors
```

阈值怎么来的（`outputs/_diag/seasonsmad.mjs` 实测，不是拍脑袋）：

| 量 | 读数 |
|---|---|
| 同一季节连拍两次（噪声底） | **0.00** |
| 春↔夏（最像的一对） | 5.04 |
| 夏↔秋 / 春↔秋 | 8.43 / 7.33 |
| 冬 vs 其余三季 | 14.83 ~ 15.82 |

⇒ 取 **2.5**：站在噪声底（0.00）上面、又是实测最小一对（5.04）的一半，两头都留余量。

## 四、两次量具纠错（都发生在本门自己身上）

1. **「两格均值之差」把差异抵消掉了。** 初版比的是「春格的平均颜色」和「夏格的平均颜色」之差，
   春↔夏只读出 **1.00**，差点被当成「春夏没区别」的产品缺陷去改渲染。
   真因：均值是**会互相抵消的统计量** —— 花开了几万像素变亮，别处草地暗了同样多，平均下来就差 0。
   改逐像素平均差后同一个春↔夏 = 5.04。⇒ 判「两张图不一样」只能逐像素量，不能比均值。
2. **导入错模块。** 初版从 `/src/02-scene.js` 取 `composer`，报 `TypeError: Cannot read properties of undefined (reading 'render')`；
   实际 `composer` 在 `/src/10-post.js:15`。

## 五、哪条不能当证据

- **`ms: 577` 不是性能读数**：这是「四次 `setEnv` + 四次 `settleEnv` + 四次 `composer.render()` + 四次 `drawImage` + 装饰绘制」的总耗时，
  跑在无头软渲染上，不能当真实设备的出图时间。
- **四格差异读数不能证明「四季都对」**：它只证明四张不是同一张。季节内容对不对（花有没有开、叶有没有落）靠人眼看的成品图，
  季节本身另有 `peach-guard` / `env-phenology-unit` 等门守着。
- **`paper [239,233,220]` 只证明左上角是纸色**，不证明整圈留白均匀（留白均匀与否看成品图）。
- 本轮**没有跑全量 98 道**（用户口径：不随改随跑）。相关门：本门 + `gate-count-sync` + `npm run check`。

## 六、顺带同步的门数口径

登记本门时发现 2026-11-16 的两道步行门（`walk-guard` / `walk-real-guard`）**当时没进 `SUITES`** ——
等于写了门禁却没人跑。三道一起登记后门数 **95 → 98**，并按 `gate-count-sync` 的规矩把 README 里 4 处「N 道门」
与探针文件数（167 → 171）对齐（该门要求 README 数字必须等于 `SUITES.length`，反向改 SUITES 去凑文档等于删门禁）。
