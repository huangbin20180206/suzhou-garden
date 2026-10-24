/* 苏州园林 · 离线 Service Worker（P1-3 PWA）
   ⚠️ 2026-09-23 策略修正（老黄："为什么要刷两次，这难道不是你程序上的 bug 吗？" —— 是）：
   旧版对**所有同源 GET 兜底** `return hit || net`（陈旧优先），而 `src/*.js` 又**不在 SHELL
   预缓存清单**里 —— 它们的缓存只能由运行时写入，于是永远比磁盘晚**一次**：改完必须刷两次
   才看得见（第一次拿到 network-first 的新 index.html + cache-first 的旧 JS，第二次才是新 JS）。
   三处叠加：① 兜底分支把 src/*.js 也吞进"陈旧优先"；② 它们不在预缓存清单 ⇒ 缓存滞后一次；
   ③ CACHE 版本号没随内容 bump ⇒"版本升级即整体换缓存"这条保险从未触发。
   现按"改不改得动"分流：
     · 代码类（index.html / src/*.js / vendor.js / manifest）→ **network-first**，离线回退缓存。
       本项目零 CDN、本地交付，网络即本地文件，network-first 没有延迟代价；换来"改了即所见"。
     · 大件（assets/*.glb / icons / docs 封面）→ **cache-first**（版本内不变，保持秒开与离线）。
     · 导航请求 → network-first，离线回退缓存的 index.html。
   ⚠️ **只有 cache-first 的成员需要 bump**（2026-10-12 收窄措辞 —— 原话"或 SHELL 内容"说得过宽）：
      · **要 bump**：SHELL 里 **cache-first 的成员**（资产那类，当前是 `docs/cover.jpg`、`icons/garden.svg`）
        → 升 `CACHE`；`GLBS` 里的模型 → 升 `ASSET_CACHE` 后缀（两条纪律，见下方两个桶的注释）。
      · **不用 bump**：**代码类**（`index.html` / `src/*.js` / `vendor.js` / `manifest.webmanifest`）
        —— 它们走上面那条 network-first、改了即所见；`probe/check.mjs:62` 的
        `/\.(js|mjs|html|webmanifest)$/` 也把它们**显式排除**在 bump 判据之外，门禁真值就是"代码类不必 bump"。
      ⚠️ 反过来对代码类误 bump 有代价：`src/*.js` **不在 SHELL 预缓存清单**、只由运行期写进带版本号的
        `CACHE`，升版会把它们连桶删掉、须等下一次在线加载才补回（离线可用性短暂退化，见
        `probe/pwa-cache.mjs` 的"在线预热"注释）。 */
/* 2026-09-28 活雾批次 bump v4→v5：本轮改了 SHELL 成员 index.html（天气按钮）与 src/*.js
   （活雾/鱼平滑/雾团），按头部规矩升版，让已装 SW 的浏览器整体换新缓存。 */
/* 2026-09-29 合并时段条批次 bump v5→v6：又改了 SHELL 成员 index.html（时段/时辰合并）。 */
/* 2026-09-30 bump v6→v7：GLBS 预缓存清单移除 LotusPlant.glb（池边荷花改程序化）。 */
/* 2026-09-30 电闪雷鸣批次 bump v7→v8：又改了 SHELL 成员 index.html（新增"电闪雷鸣"天气按钮）。 */
/* 2026-09-30 撤池边大荷花批次 bump v8→v9：改了 SHELL 成员 index.html —— 内联主模块的
   import 清单里删掉已不存在的 GLB_LOTUS_STEM_H（漏改会 ESM 链接报错、页面停在加载页，
   实测正是这么炸的：check 只查语法、不查模块链接）。 */
/* 2026-09-30 荷花回归批次 bump v9→v10：GLBS 预缓存清单恢复 LotusPlant.glb
   （老黄："之前有个版本有好多株树立的荷花，虽然有点假但是至少能看"）。 */
/* 2026-09-30 补杆批次 bump v10→v11：又改了 SHELL 成员 index.html（内联主模块的
   import 清单恢复 GLB_LOTUS_STEM_H）。 */
/* 2026-09-30 合并+新场景批次 bump v11→v12：改了 SHELL 成员 index.html
   （天气行删"电闪雷鸣"、加"雨后初晴"；提示串 A S H F G → A S J F G）。 */
/* 2026-10-01 雨后痕迹批次 bump v12→v13：改了 SHELL 成员 index.html
   （内联主模块的 import 清单加 updatePostRain）。 */
/* 2026-10-02 CDN 双轨批次 bump v13→v14：src/13-preload.js 新增"CDN 可选基址
   （?cdn= / localStorage suzhou-cdn-base，默认关闭）+ 失败自动回退本地"，06/11 的
   GLB 与雷声 mp3 请求 URL 改走 assetUrl。SHELL 与 GLBS 清单未动；跨域 CDN 请求本就被
   fetch 分流第一行放行（不进 SW 缓存），本地回退路径照旧 cache-first。按交付规矩
   升一级，让已装 SW 的浏览器整体换缓存。 */
/* 2026-10-03 补鹦鹉批次 bump v14→v15：GLBS 预缓存清单补上 Macaw.glb。
   ⚠️ 这是一个**存在了两个批次才被发现**的洞（2026-10-02 加鹦鹉时只改了 13-preload、
   漏了这里），而它一直是静默的 —— check.mjs 的 PWA 判据只测"sw.js 里声明过的
   cache-first 资产有没有比 sw.js 新"，**从不比对两份清单是否同一批**，所以哪怕
   Macaw.glb 比 sw.js 新 22 小时也报不出来（它根本不在 GLBS 里、比对不到）。
   后果分场景：在线首开一切正常（.glb 走 fetch 后会被运行时写进缓存），
   **装成 PWA 后断网首开则拿不到鹦鹉**（required:false ⇒ 不阻塞开园 ⇒ 更静默）。
   本轮同时新增 probe/preload-manifest-sync.mjs 把这一类钉住（双向差集 + bytes 核对）。 */
/* 2026-10-05 陈设（竹帘升降）批次 bump v15→v16：改了 SHELL 成员 index.html
   （面板加"陈设·卷帘"一行）。src/*.js 不在 SW 缓存里，改它们不用 bump。 */
/* 2026-10-05 春节烟花批次 bump v16→v17：又改了 SHELL 成员 index.html（导览行加"看烟花"机位按钮）。 */
/* 2026-10-06 面板重排 + 时段滑块换样式批次 bump v17→v18：改了 SHELL 成员 index.html
   （老黄第 6 条反馈：灯会🏮/看烟花 并进"陈设"行、流转▸/偶得✦ 并进"导览"行、
   时段条换"细轨道 + 已过段暖色填充 + 精修圆球 + 锚点刻度点"的新样式、
   两个滑杆视觉统一）与 src/12-env.js（气泡位置改由 CSS 变量 --r 统一负责、
   音量滑杆补齐填充比例）。改 SHELL 成员必须升版，否则已装 SW 的浏览器吃旧缓存看不到新面板。 */
/* 2026-10-06 看彩虹批次 bump v18→v19：又改了 SHELL 成员 index.html
   （陈设行加「看彩虹」一键情境按钮 —— 同「看烟花」的套路：先设 暮色·雨后初晴 再飞）。 */
/* 2026-10-06 看烟花两档开关批次 bump v19→v20：又改了 SHELL 成员 index.html
   （「看烟花」由 data-view 改成 data-act 的两档开关；同时"换场景自动收起灯会/烟花"）。 */
/* 2026-10-06 面板统一批次 bump v20→v21：又改了 SHELL 成员 index.html ——
   陈设行按钮改两字名（珠帘/灯会/烟花/彩虹/鱼趣）、新增「鱼趣」与「快捷键」复选框、
   快捷键提示默认隐藏（勾选才显示）。 */
/* 2026-10-06 图标与快捷键补齐批次 bump v21→v22：又改了 SHELL 成员 index.html ——
   全部按钮加图标（data-ic + CSS ::before，不动 DOM 结构、textContent 不变）、
   提示文字补 5~9 机位 / Shift+1~4 画质。 */
/* 2026-10-07 拆分批次 bump v22→v23：src/01-materials.js 拆出 src/01b-textures.js
   （23 个程序化贴图生成器整块搬出，纯搬运逐字未改；01-materials 1412→846 行）。 */
/* 2026-10-07 手机/平板适配批次 bump v23→v24：又改了 SHELL 成员 index.html ——
   触屏档的方印 48→56px、面板按钮 40→46px、滑杆圆球 18→26px / 轨道 4→6px
   （圆球直径与轨道粗细改成 CSS 变量 --thumb/--track，三处定位公式跟着走）、
   面板加视口宽度上限并在窄窗口换行（同时收紧内边距让放大后仍一屏放得下）、
   选中锚点的色块挪到 ::before 只画下半截、触屏档隐藏面板下沿小尖角（假滚动 6~8px）；
   另 11-loop 的首次引导在触控档不再替用户把面板推开（改指方印）。 */
/* 2026-10-07 梅花"看得见"批次 bump v24→v25：改了 src/*.js（01-materials 的两份花瓣材质、
   01b-textures 的梅瓣贴图、06-vegetation 的梅花几何）—— 按头部规矩"改了 src/*.js 也要升版"，
   否则已装 SW 的浏览器会继续用旧缓存里的花瓣（老黄看到的就是"还是看不出花"）。 */
/* ⚠️ 溯源注（2026-10-12）：本行引用的「按头部规矩『改了 src/*.js 也要升版』」**已收窄** ——
   现行口径是「只有 cache-first 的成员需要 bump」（见文件头 :13 与 probe/check.mjs:62 对
   /\.(js|mjs|html|webmanifest)$/ 的排除）。本行那次升版按**当时的**规矩执行，记录保留、不改写历史；
   补记一句后果：对代码类升版并无收益（它们本就 network-first），且会连桶清掉运行期缓存的
   src/*.js，须等下一次在线加载才补回。 */
/* 2026-10-08 烟花「2027」加长 + 打散批次 bump v26→v27：改了 src/12b-sky.js ——
   老黄："燃放过程和持续时间再长一些"＋"也不用做得这么工整，能够识别出是 2027 就可以了，
   毕竟是烟花，不是无人机"。收拢 0.55→1.25s（每颗火星再各自错峰 ≤0.45s）、存活 1.5→2.4 倍、
   成形后加慢摆、每个数字各自有小倾角/大小差/落点错位。 */
/* 2026-10-08 梅花三态批次 bump v30→v31：改了 src/06-vegetation.js（花苞独立几何 makePlumBudGeo +
   三态按 60/30/10 分配 + 凋谢态 + 枝条加长 longTwig）、src/01-materials.js（新增 MAT.plumBud）、
   src/12f-season.js（花苞材质登进季节存在性）、src/12f 表与本批无关的部分不动。 */
/* 2026-10-08 花苞再缩小 + 腊梅调黄批次 bump v32→v33：改了 src/06-vegetation.js（花苞几何
   0.53→0.42 倍、实例缩放区间改成不再与花重叠、腊梅花色/枯色改成正黄）与 src/01-materials.js
   （腊梅自发光 0x96700A 琥珀金 → 0x8F8200 正黄）。 */
/* 2026-10-10 马厩真马批次 bump v34→v35：GLBS 预缓存清单补上 assets/Horse.glb
   （马厩那 6 匹马由程序化替身换成了 AI 生成的真模型；两份清单必须同一批 —— 见下方 GLBS 注释。
   本轮还改了 src/15-stable.js（马槽位 noMerge / 换马后补渲阴影 / 正脊封缝 / 墙顶到檐 / 低头吃草），
   src/*.js 不在 SW 缓存里、本不影响，但清单加了东西必须升版让已装 SW 换缓存）。 */
/* 2026-10-10 流星雨批次 bump v35→v36：改了 SHELL 成员 index.html（「陈设」行加「流星雨」按钮 +
   图标色 + 快捷键提示 `;`），并新增 src/12b-sky.js 的流星雨段（src/*.js 不在 SW 缓存里、本不影响，
   但 SHELL 成员变了必须升版，让已装 SW 的浏览器换缓存）。 */
/* 2026-10-10 bump v37→v38：改了 SHELL 成员 index.html —— 给画布加一层不透明底色
   （`#app canvas{background:#0B0E12}`；原因见 index.html 里那段注释：three r184 申请上下文时
   alpha 恒为 true ⇒ 画布"没被画到的区域"会 α=0 透出网页底色 #D8DCDA，观感就是一大块惨白）。 */
/* 2026-10-11 bump v38→v39：改了 SHELL 成员 index.html —— 三个"景"（灯会/烟花/流星雨）的
   按钮说明改成"一键开/关；可与另两个同时开"，并给「烟花」补上一直缺的 title
   （语义解耦：不再有"点灯会顺带带出烟花"这种自动联动）。 */
/* 2026-10-11 bump v39→v40 + **资产桶与版本脱钩**（老黄："现在每次进项目前这个下载都要持续好久"）：
   原来 6 个模型（3.5 MB）和 SHELL 混在同一个带版本号的桶里 ⇒ 每次升版都被 activate 删掉 ⇒
   每次改代码他都要重下 3.5 MB。现在资产放 `suzhou-garden-assets-vN`（**不带应用版本号、不被 activate 删**），
   安装时逐个"缺了才下"；升版只换应用壳。另外开发服务器对 assets/ 允许 HTTP 缓存（见 probe/serve.mjs）。 */
/* 2026-10-11 bump v40→v41：改了 SHELL 成员 index.html —— 触控档面板的间距/内边距
   （手机竖屏 390×844 上面板展开后底部要滚动 38px 才看得见最后一行，实测探针见
   outputs/_diag/panel-fit-scan.mjs；改后留 ~65px 余量）。 */
/* 2026-10-21 bump v41→v42：GLBS 预载清单加入 fig-scholar.glb / fig-lady.glb。 */
/* 2026-10-23 bump v42→v43：GLBS 预载清单加入 Rodin 三匹马。 */
const CACHE = 'suzhou-garden-v43';
/* 资产桶：**故意不带应用版本号**（它要跨应用版本存活，否则每次升版用户都得重下模型）；
   但它**自己带一个版本后缀** —— 改了任何一个模型文件就必须把这个后缀 +1，否则用户会一直
   吃旧的那份（`npm run check` 会替你盯着：GLBS 里的文件比 sw.js 新就报红）。 */
const ASSET_CACHE = 'suzhou-garden-assets-v19';  // 2026-10-24 池边荷花换三态（LotusPlant.glb 删、lotus-{bloom,bud,pod}.glb 增）⇒ 升桶
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/garden.svg',
  './vendor.js',
  './docs/cover.jpg',       // 水墨封面：loading 层要离线可见，归入应用壳
];
const GLBS = [
  /* 2026-09-30 三轮：LotusPlant.glb 回归（与 13-preload 同步；沿革见 08 的注释）。 */
  './assets/BananaPlant.glb',
  /* 2026-10-24：池边荷花换三态（盛开/花苞/莲蓬），旧 LotusPlant.glb 退役删除。
     与 13-preload 的 PRELOAD_MANIFEST 同步（preload-manifest-sync 门盯着）。 */
  './assets/lotus-bloom.glb',
  './assets/lotus-bud.glb',
  './assets/lotus-pod.glb',
  './assets/koi.glb',
  './assets/Turtle.glb',
  /* 2026-10-03 补：金刚鹦鹉（2026-10-02 上峰顶时只改了 13-preload，漏了这里）。
     这是"两份投影"里被漏掉的那一件 —— 见上方 CACHE 的 v15 沿革注释。 */
  './assets/Macaw.glb',
  /* 2026-10-19：马厩换 Tinker 照片级马（454 骨骼 + 鬃尾），与 13-preload 同步。 */
  './assets/HorseTinker.glb',
  /* 2026-10-23：马厩换 Rodin 三匹（自带耳/眼/鼻孔/蹄形 + 1024 PBR 贴图；无骨骼走伪蒙皮）。
     与 13-preload 的 PRELOAD_MANIFEST 同步（preload-manifest-sync 门盯着）。 */
  './assets/horse-camargue.glb',
  './assets/horse-mongolian.glb',
  './assets/horse-criollo-saddle.glb',
  /* 2026-10-23：第五个角色「客人」（与 13-preload 的 PRELOAD_MANIFEST 同步）。 */
  './assets/fig-guest.glb',
  /* 2026-10-14 试水批次：太湖石主峰替换件（改浅灰重导后 5.46MB ⇒ 资产桶现为 assets-v3；
     与 13-preload 的 PRELOAD_MANIFEST 同步（preload-manifest-sync 门盯着）。 */
  './assets/boulder-hero.glb',
  /* 2026-10-14 石灯笼 L0 首件（与 13-preload 的 PRELOAD_MANIFEST 同步）。 */
  './assets/stone-lantern.glb',
  /* 2026-10-18 石狮一对（与 13-preload 的 PRELOAD_MANIFEST 同步）。 */
  './assets/stone-lion-male.glb',
  './assets/stone-lion-female.glb',
  /* 2026-10-21 P1：AI 半写实人物（文士/仕女），与 13-preload 的 PRELOAD_MANIFEST 同步。 */
  './assets/fig-scholar.glb',
  './assets/fig-lady.glb',
  './assets/fig-laborer.glb',
  './assets/fig-child.glb',
];
/* ⚠️ 2026-09-27 · 高精资产批次：上面这份 GLBS 与 src/13-preload.js 的
   PRELOAD_MANIFEST 是**同一批资产的两个投影**，加高精包时**两处都要改**。
   不一致的后果是分方向的：
     · 只加 sw.js 不加 13 → SW 装好后仍走网络，重复下载一遍；
     · 只加 13 不加 sw.js → 用户装成 PWA 后首次开园**仍在下载 10MB**，
       违背 PWA 的"装了就该能离线打开"，而且 13 的进度条会一直走网络
       （本项目里"进度条有真进度"恰恰等价于"没装 PWA"）。
   分流逻辑本身**不需要动**（.glb 仍是 cache-first = 版本内不变；
   代码类仍 network-first = 改了即所见）。 ⚠️ 加完必须 bump 上面的 CACHE 版本号。 */

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    /* ① 应用壳：整批预缓存（版本内不变，升版就是换这一桶） */
    await (await caches.open(CACHE)).addAll(SHELL);
    /* ② 模型资产：**逐个"缺了才下"**，放进**不带版本号**的资产桶。
       ⚠️⚠️ 2026-10-11 改（老黄："现在每次进项目前这个下载都要持续好久"）：
       原来 GLBS 与 SHELL 混在同一个带版本号的桶里，而 activate 会删掉所有旧版本桶
       ⇒ **我每改一行代码升一次版本，用户那 3.5 MB 模型就要重下一遍**
       （一天里我从 v36 升到 v39 = 让他白下了 4 遍）。现在资产与版本脱钩：
       升版只换应用壳，资产**只在缺的时候才发网络**。
       ⚠️ 也不能用 addAll 预缓存资产：它遇到 404 会整批 reject，
       而过去的写法是 `.catch(() => c.addAll(SHELL))` ⇒ 静默退化成"只缓存外壳"
       ⇒ 资产每次重下（而且没人看得出来）。这里单件失败只影响那一件。 */
    const ac = await caches.open(ASSET_CACHE);
    await Promise.all(GLBS.map(async (u) => {
      if (await ac.match(u)) return;                 // 已有 ⇒ 这一次网络都不发
      try { await ac.add(u); } catch { /* 单件失败不拦安装；运行期 fetch 还有一次机会 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        /* ⚠️ 两个前缀**分开**清理（2026-10-11 InfraBot 补漏）：
           · 应用壳桶 `suzhou-garden-vN`      → 只留当前 CACHE，旧壳全删（升版 = 换壳）；
           · 资产桶   `suzhou-garden-assets-vN` → 只留当前 ASSET_CACHE。
           ① 为什么**不**删资产桶本身：它名字里**不含应用版本号**，所以改代码升 CACHE 时
              它压根不落进任何被删前缀 ⇒ 用户不必为一行代码重下 3.5 MB（老黄 2026-10-11 的诉求）。
           ② 为什么**要**删被取代的旧资产桶：ASSET_CACHE 自己带后缀，改了模型就必须 +1
              （check.mjs 盯着这件事），而旧桶**再也不会被任何请求命中**，却因为前缀对不上
              `suzhou-garden-v` 而**永远不会被删** —— 每改一次模型就永久泄一份 3.5 MB。
              这里补上回收，语义不变：升应用版本不动资产，升资产版本只回收被取代的那一桶。 */
        keys.filter((k) =>
          (k.startsWith('suzhou-garden-v') && k !== CACHE)
          || (k.startsWith('suzhou-garden-assets-v') && k !== ASSET_CACHE)
        ).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;          // 零 CDN 约束：跨域一律不拦
  if (e.request.method !== 'GET') return;

  // 导航请求：网络优先，离线回退缓存页
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  /* 大件（版本内不变）→ cache-first；其余（代码）→ network-first。理由见头部注释。
     ⚠️ `caches.match` 默认搜**所有**桶 ⇒ 资产桶（无版本号）里的命中同样找得到。
     命中资产直接返回，不碰网络；未命中的资产写进**资产桶**（不是版本桶，否则下次升版又丢）。 */
  const isAsset = url.pathname.endsWith('.glb')
               || url.pathname.includes('/icons/')
               || url.pathname.includes('/docs/');
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then((hit) => {
      if (hit && isAsset) return hit;                  // 大件：命中即用，不碰网络
      return fetch(e.request).then((res) => {          // 代码：网络优先 ⇒ 改了即所见
        if (res && res.status === 200) {
          const copy = res.clone();
          const bucket = isAsset ? ASSET_CACHE : CACHE;
          caches.open(bucket).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || Response.error());          // 离线：回退缓存
    })
  );
});
