// 一条命令验到底（2026-09-17；2026-09-21 增至 25 门；2026-09-22 回填缺口增至 30 门；
// 其后陆续加门，**当前 58 道**：2026-10-04 新增 sky-layer-guard（天空视觉层不许进 GTAO）；
// 2026-10-03 新增 preload-manifest-sync + 把 pwa-cache 入链，随后的 figure-foot-guard 让它到 57
// —— 准数以 SUITES 数组为准，别在本注释里写死）。
// 串行跑 check
// → codeonly-unit → **preload-manifest-sync** → import-audit
// → wind-trajectory → shadow-cover → smoke → pageerror-guard → reel-guard → lamp-guard → mist-guard
// → postcard-guard → longexposure-guard → peach-guard → sound-guard → guide-guard → wind-audit
// → wisteria-color → koi-orbit → perch-dragonfly → stone-audit → stele-legibility → figure-audit
// → refract-guard → refract-coverage → weather-coverage → intro-guard → loading-guard
// → warmboot-guard → random-guard → lampvol-guard → …（完整清单见下面的 SUITES 表），
// 汇总全部子门的结论，任何一个红整体就红。
//
// ⚠️ **门数以 SUITES 数组为准，别在本注释里写死**（这份注释已经漂过三次：30 → 实际 54）。
//    想拿准数：`node -e "…"` 数 SUITES 里的 `probe/*.mjs`，或看运行首行的「跑 N 道」。
// ⚠️ preload-manifest-sync（2026-10-03 加）守的是"sw.js 的 GLBS 与 13-preload 的
//    PRELOAD_MANIFEST 是同一批"—— 这条红线**写在两个文件的注释里、此前无人把守**：
//    2026-10-02 加金刚鹦鹉时只改了 13、漏了 sw.js，而当时全套门禁全绿
//    （check.mjs 遍历的就是清单本身 ⇒ 从定义上看不见"少了一件"），
//    危害是**装成 PWA 后断网首开少一只鹦鹉**（required:false ⇒ 不阻塞开园 ⇒ 更静默）。
//    纯 node / <1s / 自带 4 条负例自检 ⇒ 与 codeonly-unit、import-audit 同排在最前面。
//
// codeonly-unit / import-audit（2026-09-20 加）守**拆模块**这个动作本身。它们全在纯 node 里跑、
//  不启浏览器（各 <1s），所以紧跟在 check 后面：结构化错误（漏 import / 给 import 绑定赋值 /
//  引用内联模块专有名字）在浏览器里表现为"页面加载即炸"或更坏的**静默**（见下），
//  能在这一步拦住就没必要等 7 分钟。
//  · codeonly-unit 钉住 `_codeonly.mjs` 的"什么算引用"契约 —— 它判宽=假红、判窄=假绿，两个方向都静默。
//  · import-audit 四条判据：①内联→src 漏 import ②src→src 漏 import
//    ③给 import 进来的绑定赋值（导入绑定只读 → Assignment to constant variable）
//    ④src 引用内联模块专有的名字（src 里没有该绑定 → ReferenceError）。
//    ⚠️ ④ 抓到过一个**静默**事故：06-vegetation 读内联的 `$解码器`，而它是在 `new Promise` 的
//    executor 里抛、被下游 `.catch(()=>{})` 吞掉 → 三类 GLB 资产永远挂不上，零告警、零失败计数，
//    只有 smoke 的「四类 GLB 资产均已挂载」看得见。
//
// wind-trajectory / shadow-cover 是**纯数学**门（判据全是几何点/数值，不是像素），
// wind-trajectory 不起浏览器（<1s），所以排在前面：公式写错时立刻红，不用等浏览器套件跑完。
//  · wind-trajectory 守"轨迹是细长条还是椭圆"（2026-09-18 的"植物打转"）。
//  · shadow-cover 守"阴影视体有没有罩住整个园子"（2026-09-18 的"暴雨里像有太阳透下来"）——
//    ⚠️ 这类门禁**不能看像素**：暴雨里雨丝逐帧随机，任何像素差分都会退化成噪点图
//    （第一批 _diff-*.png 就是这么废掉的）。判据必须是几何点：园子地面的网格点有多少
//    落在 ortho 盒外 —— 盒外既不做阴影测试、投射物也不进深度图，影子会被硬切成一条亮缝。
//
// pageerror-guard（2026-09-19 加）守"渲染循环还活着"。老黄报「功能切换不起作用」那次，
// 其余十门**全绿**：check 只查语法（`attributes.userData` 语法完全合法）；smoke 的
// 「零 pageerror」只在**启动段**判一次，而该异常只在**切天气之后**才出现；smoke 断言的是
// ENV 状态落位，而状态本来就是对的。真实缺陷是：animate() **中段**抛异常 →
// 末尾的 composer.render() 永不执行 → **画面冻结**（循环不死，所以连"卡住"都不报）。
// 本门因此三条判据齐上：①每次交互后都查 pageerror（不只在启动）；②"同状态连续两帧
// 若字节全同 = render 没在跑"判活性；③像素差判「状态变了画面有没有跟着变」。
//
// mist-guard（2026-09-19 加）守 README P1-2「夜 + 浓雾下远山比天空亮」。它是**唯一**能抓到
//   该缺陷的门：check 只查语法、smoke 只验状态，而缺陷在"MeshBasicMaterial 不吃光"——
//   远山固有色写死白天的灰绿，夜里灯光全暗它却照旧发亮（实测山 35.4 vs 天 16.9）。
//   判据用 Raycaster 按材质身份分出「山像素 / 天像素」再逐列配对比亮度（抵消天空垂直渐变）。
//
// postcard-guard（2026-09-19 加）守明信片书画款式的钤印与题款。朱砂红像素统计**必须在
//   夏季正午**测 —— 秋天红枫的色域和朱砂重叠，换季就假红。
//
// sound-guard（2026-09-19 加）守音景六层。音景是**全静默失效**区：接线断了不报错不崩，
//   而在无音频设备的 CI 里根本听不见"该响的时候没响" → `Snd.plan(p)` 做成纯函数就是为了
//   让门禁能直接断言"夏午有蝉、夏夜有蛙、冬天没虫"，不必依赖真的出声。
//
// guide-guard（2026-09-19 加）守首次引导，以及**它对别的门禁是否无害** —— 它是全屏
//   z-index:8 的覆盖物，最典型的破坏方式不是自己坏，而是**把别人的点击吃掉**。
//   所以一半判据在验"它有没有挡路"（非模态 / 不压 #env 锚点 / 首次交互即消失 / 320px 不溢出）。
//
// refract-guard（2026-09-20 加）守水面真折射（P2-5）。它守两件**只能靠读像素**的事：
//   ① 折射贴图里真的有鱼（水下层标记漏了 = 贴图里只剩池底，静默且不报错）；
//   ② 贴图坐标与世界 XZ 的映射方向没反（反了 = 鱼位读到池底、池心空着，一样静默）。
//   ⚠️ 本门是被**真实缺陷**逼出来的：正交相机的 left/right/top/bottom 是相机空间量，
//      而相机架在池心正上方 → 相机空间 y = 世界z − 3。把世界包围盒直接塞进去会让视锥
//      在世界 z 上只盖 [−9.8, 9.8]（池北大半截在视锥外），鱼于是全数"落在"池底上。
//      状态、几何、贴图尺寸全都正确，只有读像素看得出来。
//
// refract-coverage（2026-09-20 加）守折射层**覆盖度**：谁该进那张"水下世界"贴图却没进去。
//   refract-guard 验的是"贴图里的鱼对不对"，即**作者想到要看的东西**；本门验的是
//   "还有谁该在里面" —— 遍历全场景，凡"下探水面 >15cm 且压到池体"却不在层里的逐个报出，
//   只允许命中**白名单且白名单条目必须写理由**的豁免；另加正向清单（删掉一行标记就红）。
//   ⚠️ 它是被复核逼出来的：P2-5 交付时只验了 11 条锦鲤，池中**立峰水下 1.24m**、
//      石矶 0.89m、两伴石、三张驳岸石实例网格、石根草叶全数缺席 —— 贴图没错、状态全对、
//      开关注解全对，只有遍历场景才发现。判据来自作者的假设，而不是来自系统的事实。
//
// weather-coverage（2026-09-20 加）守**天气名单**的覆盖度：谁该积雪 / 该打湿却没被登记。
//   同一个"东西该在某个集合里却没在"的形状，在天气表上又犯了两次：
//   ① 竹竿 bambooA / bambooB 在 SNOW_BOOST 里配了 **0.85（全表最高）**的积雪加成，
//      却不在 SNOW_COVER_MATS 里 —— 加成只是 shader 里的 uniform，材质不在表里就压根
//      不会被注入，那个 0.85 从来是死代码；
//   ② 题名石刻（云根）的 stoneMat 只登记了 wet、没登记 snow，而园里其它石头全在雪表里。
//   判据四层、各自能独立变红：G1~G4 是名单与标记的**对象身份**比对（零启发式）；
//   G5 阳性对照（修好的两处必须真的在表里且注入已挂）；G6 像素行为；
//   G0 自检 —— 把竹竿移出雪表，G1 必须报出来，探针自己证明"我能红"（第一版就靠它抓出了
//   探针自身的 Set 快照 bug）。
//   ⚠️ 顺带修掉一个**时序陷阱**：installSnow 只认"装雪那一刻"的数组内容，此后
//      （deferBoot 的立峰）才 push 进来的材质收不到注入 —— 名单里有、shader 里没有。
//      修法是 SNOW_HOOK 插槽：名单一更新就补装（幂等）。石刻就是靠它才第一次有雪。
//   ⚠️ G6 不能要求"石头明显变白"：太湖石 960 个顶点里朝上的只占 31.6%，雪的着色按
//      "朝上程度"混白，竖面本来就上不去雪 —— 那等于把物理事实判成缺陷。所以只要求
//      "分到了雪"（ROI 内有像素被盖白），不要求"盖了多厚"。
//
// ⏱ 耗时（2026-09-18 换 harness 后实测）：整套 **2m41s**（旧软渲染 harness 是 17m59s，6.7×）；
//    2026-09-19 加 pageerror-guard（+75s）→ reel/lamp（+42s）→ mist/postcard（+121s）
//    → sound/guide（+77s）→ 2026-09-20 加 refract（+50s）→ 再加 refract-coverage（+20s）
//    → 再加 weather-coverage（+80s）→ 2026-09-22 回填 R-1/2/3/5/8 再加 5 门（+111s）后，
//    整套 **12m14s**（2026-09-22 **三十门**全绿那次实测；上一轮 25 门那次 16m28s —— 波动主要来自
//    mist-guard，它 185s / 390s 都出现过）。⚠️ 那之后门数已长到 55 道，**15 分钟**才是当前量级。
//    浏览器探针一律走 `probe/_harness.mjs`（真 GPU / D3D11）；要复现历史基线用
//    `GARDEN_SOFT=1`。单门耗时：shadow-cover 14s / smoke 22s / figure-audit 21s /
//    pageerror-guard 69s / reel-guard 19s / lamp-guard 21s / mist-guard 185~390s /
//    postcard-guard 19s / sound-guard 57s / guide-guard 20s / refract-guard 21s /
//    refract-coverage 12s / weather-coverage 16s / **intro-guard 22s / loading-guard 10s /
//    warmboot-guard 26s / random-guard 10s / lampvol-guard 44s / thunder-guard 64s**。
// ⚠️ 跑链期间别做观感/帧率测试：每一道浏览器门各起一个真实 GPU 的 Chromium，会抢显存与 CPU。
//    （纯 node 门 —— check / codeonly-unit / preload-manifest-sync / import-audit /
//      wind-trajectory 不启浏览器，但它们既短又在最前面，等它们跑完也不占 GPU。）
// 用法: node probe/verify-all.mjs   （或 npm run verify）
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const SUITES = [
  ['语法门禁 check',         'probe/check.mjs'],
  ['语法判定单元 codeonly-unit','probe/codeonly-unit.mjs'],
  /* ── 2026-10-03 · 预载清单一致性（纯 node / <1s）──
     守的是"sw.js 的 GLBS 与 13-preload 的 PRELOAD_MANIFEST 是同一批"这条**写在注释里、
     此前无人把守**的红线：2026-10-02 加金刚鹦鹉时只改了 13、漏了 sw.js，
     而全套 55 道门全绿（check.mjs 遍历的就是清单本身 ⇒ 从定义上看不见"少了一件"）。
     危害分场景静默：在线首开一切正常，**装成 PWA 后断网首开则少了鹦鹉**。
     自带 4 条负例自检（探针自证能红），不入浏览器、不依赖 GPU。 */
  ['预载清单一致性 preload-manifest-sync', 'probe/preload-manifest-sync.mjs'],
  ['拆分守卫 import-audit',   'probe/import-audit.mjs'],
  ['风场轨迹 wind-trajectory','probe/wind-trajectory.mjs'],
  ['阴影视体覆盖 shadow-cover','probe/shadow-cover.mjs'],
  ['无头回归 smoke',         'probe/smoke.mjs'],
  /* 手机/平板控制面板（2026-10-07 建，~40s）：进场收起 / 点方印才出 / 触控命中区 /
     窄窗口不溢出 / 引导在触控档不代开面板（配桌面口径的负例对照）。
     与 smoke 的 320px 那条**不重复**：smoke 只看"收进视口 + 按钮 ≥44px"，
     这条还管"引导会不会自己把面板推出来"和"带鼠标的平板（hover:hover）在窄窗口
     会不会把面板顶出右缘" —— 两者共用同一套 CSS 媒体查询，但入口不同。 */
  ['移动端控制面板 mobile-panel', 'probe/mobile-panel-guard.mjs'],
  /* 梅花（2026-10-07 建，~30~110s）：远处看得见花（默认机位"藏花"必须改变画面的像素、且偏花色）
     + 近处看得出是梅花（单朵 ≥40px）+ 夏季无花 + **缺陷态负例自检**（alphaTest .42 必须报红）。
     老黄："从这个角度看两株梅花，根本看不出颜色，甚至连有花都看不出来" ⇒ 这条门禁守的是
     "花真的画到屏幕上了"，不是"材质还在不在"。 */
  ['梅花 plum-guard', 'probe/plum-guard.mjs'],
  /* 按钮图标配色（2026-10-07 建，~20s，纯样式读、零像素）：老黄"按钮图标做成彩色的"。
     守"30/34 上色、≥12 种颜色、字形不进 textContent、选中态提亮、禁用态去色压暗"。 */
  ['面板图标 panel-icons', 'probe/panel-icons-guard.mjs'],
  /* 相机可达性（2026-10-08 建，~33s）：老黄"我始终无法有效地观察到院子四个角落的细节"。
     守：全局最近可推到 ≤2m、两个看梅机位一键到位且**点它就真的看得到花**（季节自动设冬）、
     到机位后能继续推近到单朵 ≥60px、双击任意物体=聚焦、注视点能到院角（钳制不拦）。 */
  ['相机可达 camera-reach', 'probe/camera-reach-guard.mjs'],
  ['运行时异常守卫 pageerror-guard','probe/pageerror-guard.mjs'],
  ['时光流转 reel-guard',     'probe/reel-guard.mjs'],
  ['灯笼照明 lamp-guard',     'probe/lamp-guard.mjs'],
  ['夜雾远山 mist-guard',     'probe/mist-guard.mjs'],
  ['明信片款式 postcard-guard','probe/postcard-guard.mjs'],
  ['长曝光明信片 longexposure-guard','probe/longexposure-guard.mjs'],
  ['桃花四季与晴午波光 peach-guard','probe/peach-guard.mjs'],
  ['音景分层 sound-guard',   'probe/sound-guard.mjs'],
  ['首次引导 guide-guard',   'probe/guide-guard.mjs'],
  ['风场审计 wind-audit',    'probe/wind-audit.mjs'],
  ['紫藤配色 wisteria-color','probe/wisteria-color.mjs'],
  ['锦鲤轨道 koi-orbit',     'probe/koi-orbit.mjs'],
  ['停栖蜻蜓 perch-dragonfly','probe/perch-dragonfly.mjs'],
  ['立峰·题名石 stone-audit','probe/stone-audit.mjs'],
  ['题名石可读性 stele-legibility','probe/stele-legibility.mjs'],
  ['人物服色与步态 figure-audit','probe/figure-audit.mjs'],
  /* ── 2026-10-04 · 人物落脚（纯射线 / ~17s）──
     守"人物有没有站在他脚下那个面上"。这类缺陷此前**零覆盖**：figure-audit 查服色/道具/
     取景，不查脚底；layout-fingerprint 不哈希人物（noMerge）。当天实测抓到两例：
     品茗的人陷进水榭台基 0.62m（y 写死 0，台基顶面 0.62）、夜步的人有 2.5m 走在池面上
     （散步区间越过游廊那条腿的端点）。自带负例自检（把人按回 y=0 且还原旧散步区间
     ⇒ 两条判据都必须报红）。 */
  ['人物落脚 figure-foot-guard','probe/figure-foot-guard.mjs'],
  ['水面真折射 refract-guard','probe/refract-guard.mjs'],
  ['折射层覆盖度 refract-coverage','probe/refract-coverage.mjs'],
  ['天气覆盖度 weather-coverage','probe/weather-coverage.mjs'],
  /* ── 2026-09-22 回填 R-1/R-2/R-3/R-5/R-8 五项"有功能、无门禁"的缺口 ──
     这五项原先状态全对、断言全绿，却谁退化都没人知道：开场运镜停在原位、加载页变回白屏、
     暖编译悄悄跳过、随机场景抽到非法天气组合、体积光退回聚光锥 —— 都是**看画面才发现**的缺陷。 */
  ['开场运镜 intro-guard',    'probe/intro-guard.mjs'],
  ['加载页 loading-guard',    'probe/loading-guard.mjs'],
  ['分帧暖编译 warmboot-guard','probe/warmboot-guard.mjs'],
  ['偶得随机场景 random-guard','probe/random-guard.mjs'],
  ['丁达尔体积光 lampvol-guard','probe/lampvol-guard.mjs'],
  /* ── 2026-09-23：老黄第三次指认"堂前池边那棵不知名的白色树形剪影" ──
     前两轮都在"修"它（矩形→树形、改色降权跟天光），都没断根；这次按老黄要求**整层删除**
     「柱状树林」。本门守的是**它不再出现**：场景里不得再有 PlaneGeometry×46 的 InstancedMesh、
     材质库不得再有 MAT.distantTree，且自带"注入同形状网格必须报红"的自检负例。 */
  ['远树剪影下线 far-tree-guard', 'probe/far-tree-guard.mjs'],
  /* ── 2026-09-23 · T0：「全局随机流守恒」（铁律 1）的**第一个机器守卫** ──
     守的是"全园布局有没有漂"：把场景里所有静态 InstancedMesh 的实例矩阵做哈希，与基线逐条比对。
     为此先补了两块地基：① `__garden.bootDonePromise`（装配完成信号 —— 此前 deferBoot 是"每帧一个 job"，
     探针没有可等待的完成点，采样时刻不同 ⇒ 同一份代码连测两次都不一致）；② 布局类随机改走**专用种子流**
     （此前布局吃共享 `Math.random`，而它同时被 Three.js 的 UUID 生成/涟漪/音景在异步时刻消费
     ⇒ 布局随**加载时序**漂，冷/热启动结果都不同）。本门是纯状态门（零像素）⇒ 不受 GPU 档位影响。
     ⚠️ 若它报"偶发红"，先怀疑"谁又把布局接回了 Math.random"，**别用冻结 Math.random 把红盖掉**。 */
  ['布局指纹 layout-fingerprint', 'probe/layout-fingerprint.mjs'],
  /* ── 2026-09-24 · 计划书第 2 项：反射按需更新 ──
     守的是"水面反射该省则省、该快则快"：观景态（相机静止 + 水面静默）降频到 1/3，
     而相机一动 / 下雨 / 有涟漪 / 长曝光 ⇒ **必须满速**（人对反射滞后极敏感）。
     判据在探针侧**包裹 `waterSurface.onBeforeRender` 计数**（数的是"反射贴图真重渲了几次"，
     换实现也不失效），并用**速率比**（实测每帧触发 2 次：主 pass + 折射 pass）。
     ⚠️ 它自带"前置条件"门（必须先是晴 + 无涟漪）—— 若那一条红，说明测的不是观景态。 */
  ['反射按需更新 reflect-adaptive', 'probe/reflect-adaptive.mjs'],
  /* ── 2026-09-24 · 老黄截图报的 bug：狂风暴雨时涟漪画到岸上草地 ──
     雨滴涟漪原来按**外接椭圆**撒点，而池形是不规则多边形 ⇒ 椭圆边缘落到岸上。
     修法：`spawnRipple` 唯一入口按 `insidePond` 拦（所有调用方一起受保护）。
     本门读**涟漪池的实例落点**断言"所有活跃圈都在池域内"，带前置门与正向对照
     （⚠️ 判活跃必须用 `instanceAlpha`，不能用矩阵缩放 —— 回收时不重置缩放）。 */
  ['涟漪池域 ripple-bounds', 'probe/ripple-bounds.mjs'],
  /* ── 2026-09-24 · 计划书第 1 项：GTAO 半分辨率 ──
     守的是"GTAO 的三张内部 RT（法线/AO/去噪）必须半分辨率，**且 composer.setSize 之后仍是**"
     —— 窗口 resize（11-loop.js:28）与 QOS 变分辨率（11-loop.js:536）都会回调 pass.setSize，
     只把半尺寸交给构造函数会在下一次 setSize 被拉回全尺寸（计划书原文点名的坑）。
     纯状态门（零像素）⇒ 不受 GPU 档位影响；这类退化**画面几乎看不出**（只白丢性能），
     正是必须靠门禁守住的静默性能回退。画质那半边由 `outputs/_diag/gtao-ab.mjs`
     的**冻结帧** A/B 量（同任务内连渲 ⇒ 零动画噪声；实测 全↔半 0.77 vs 全↔关AO 2.74）。
     ⚠️ 本门强制 `tier=high`：核显档 `AO_ENABLED=false` 根本没有 AO。 */
  ['GTAO 半分辨率 gtao-halfres', 'probe/gtao-halfres.mjs'],
  /* ── 2026-09-24 · 计划书 Phase 3 第 6 项：锦鲤投喂互动（ROI 最高的"可玩"项）──
     守的是计划书自己写的验收标准：点水面 1s 内有饵落水 / 3s 内 ≥3 条鱼转向 / 与"点水面出涟漪"
     共存 / 饵散后 10s 内回原轨道无迷路鱼 / **鱼全程不出池**（投喂是唯一会让鱼离开既定轨道的
     功能，而"鱼游到草皮上"是本项目踩过的真 bug ⇒ 饵点必须夹紧在池域内）。
     自带两条有牙判据：负例对照（点岸上不撒饵）+ 反向自检（饵落岸线时必须被夹紧进池内）。 */
  ['锦鲤投喂互动 koi-feed', 'probe/koi-feed.mjs'],
  /* ── 2026-09-24 · 计划书 Phase 3 第 7 项：上元灯会 ──
     守的是灯会自己那三条硬规矩 + 计划书的验收标准：① 河灯 ≥20 且**随波漂移**、全在池域内、
     **不碰桥体/汀步/立峰**（计划书原文"河灯随波漂移不穿过桥体"），两株桃树枯枝挂灯也必须
     默认隐藏、灯会时全显、关闭后归零；② **不新增真光源**（真光源恒为灯笼那 5 盏 ——
     加真灯就必须同步改阴影方向，夜里月光是唯一主光）；③ draw calls 总数仍 < 800，
     非灯会态河灯/烛焰/灯串/挂灯全部 count=0 零提交。
     另有两条有牙自检：桥体中心点必须被判"在禁区内"；冻结漂移时钟后河灯必须**完全不动**。 */
  ['上元灯会 festival-guard', 'probe/festival-guard.mjs'],
  /* 四季自动演示：专项验证默认不自动播、四季顺序、字幕/镜头同步和手动接管。
     日常开发按改动范围单独运行本门，不因此触发全量链。 */
  ['四季自动演示 season-demo-guard', 'probe/season-demo-guard.mjs'],
  /* ── 2026-09-28 · 抗锯齿渐进超采样（静止升采样）分流门 ──
     AA 与 QOS 是**同一个像素预算上的两个调节器**，共用同一条免疫判据 QOS_IMMUNE
     （02-scene：SOFTWARE_GL || PROBE_DRIVEN）⇒ AA 侧 adaptiveAllowed() 为假时恒停 step0。
     ⚠️ 本门必须**分两支**跑，且两支断言方向相反：
      [P] 探针语义（默认 context）—— AA 必须**恒停 step0**（免疫才是正确行为）；
          旧版只测"静止必升档"，在探针里必然红；改造前之所以绿是靠撞 QOS 自闸（侥幸）。
      [R] 真机语义（addInitScript 置 navigator.webdriver=false）—— 静止升档 / 一动回落 /
          低档不上探 / QOS 联动四条约束 + 像素比 = min(base×qosScale×scale, 预算上限)。
      [B] 4K+high —— 唯一会被 pixelBudget clamp 咬到的组合，先断言 clamp 在咬再断言不越界。
     ⚠️ 两支各有**负例自检**（合成违规态 + 用产品侧 aaSetEnabled/aaSetStep 现场构造）：
        任一支被弱化成永真，另一支的负例会立刻抓到。改门前先读门内注释。
     ⚠️ 本门此前**根本未注册** —— 这正是它"基线侥幸绿"能长期潜伏的原因。 */
  ['抗锯齿渐进超采样 aa-progressive', 'probe/aa-progressive-guard.mjs'],
  /* ── 2026-09-28 · 资产预载段（把"下载"搬进"营造中"进度条）──
     用户的方案：大游戏都是这个套路 —— 把比较消耗网络和资源的**放在开篇进度条里下完**，
     后续运行状态最好；网络差的给下载链接自行下载。
     ⚠️ 为什么需要它：实测 4 个 GLB 目前**本来就**赶在 loading.done 前落地（余量 9456/3220ms），
        因为模块期被 warmBoot 那 ~9s 编译窗口完全遮蔽 ——"营造中"事实上已经在免费下载了，
        只是文案没说。但按 **10 MB 目标**（用户拍板）推算，1.5Mbps 下需 ~53s 纯下载
        ⇒ 那条"免费掩盖"失效，必须显式播报。1.9 MB 是这条临界线。
     ⚠️ 判据守的是"**进度不许撒谎**"：①相邻更新 ≥250ms（防逐 chunk 刷屏）②整数百分比去重
        ③单调不减 ④下载段 0~45% / 暖编译段 45~100% ⑤清单字节与磁盘一致（单一真值）
        ⑥program 守恒（只许丢 `depth` 族 —— 那是 Three 为 castShadow 网格自动生成的
        投影程序，属"换个时刻编"而非丢失，已查清）⑦负例自检：注入 `coalesceMs=0`
        必须被 ① 抓住（**必须在慢4G 臂跑** —— 本地档走零等待分支、定时器压根没建，负例会假绿）。
     ⚠️ 本门在**本地档**验不到下载段文案（零等待不让它写 DOM），那部分的证据在
        `basic-enter-guard` 的慢4G 臂。 */
  ['资产预载 preload', 'probe/preload-guard.mjs'],
  /* ── 2026-10-03 入链：PWA 离线缓存（此前是"专项"、**不在链上，而它一直是红的**）──
     「不在链上的门」= 没有门。它红在哪：本门先在假页上注册 SW 就断网，而
     `src/*.js` 被 sw.js 刻意排除在 SHELL 之外走 network-first ⇒ 缓存只能由
     **运行时**写入 ⇒ 从没在线加载过真页面时断网必炸（`index.html` 取得到、
     它 import 的 16 个 src 全落空 ⇒ `.done` 推不到 ⇒ 90s 超时）。
     已修：补上 `pwa-cold-restart` 一直有、本门漏掉的**在线预热**那一步；
     并把离线资源清单补到 9 项（含 Macaw.glb）+ 五类 GLB 断言。
     ⚠️ 它自己起临时端口（listen(0)），不与常驻 8935 冲突；耗时约 2~3 分钟。 */
  ['PWA 离线缓存 pwa-cache', 'probe/pwa-cache.mjs'],
  /* ── 2026-09-28 · "先用基础版进入"静默入口 + 芭蕉程序化替身 ──
     两支职责（臂形状与 preload-guard 完全不同，故独立成门）：
      · 臂 D/D0：注入 `BananaPlant.glb` 404 ⇒ required:false 的资产**必须走程序化替身**
        （否则留下 **3.6 m 高的光杆芭蕉** —— 项目实测过的"缺失即穿帮"）。
        负例 D0：不注入时替身必须**0 株**（证 D① 有牙，不是永远走替身）。
        ⚠️ 前提双证据核对拦截真生效（`route 命中次数` ∧ `degraded 列表`）——项目教训：
        `page.route` 曾被实测"没生效"而据此误判。
      · 臂 E：慢4G + **真实指针路径** ⇒ 静默入口必须①未交互时 hidden ②**被动 mousemove 不算触发**
        ③首次 pointerdown 才淡入 ④点了必须**跑完暖编译**（防"跳过下载"变成"跳过编译"——
        少跑暖编译会让首帧整批重编，实测 37→87 program，比不暖机更慢）。
        负例 1/2（静默性、mousemove）都是真对照。
     ⚠️ 静默入口**刻意不在进度条上放显眼按钮**（用户拍板）：显眼按钮会诱人跳过，
        精心做的"营造中"就白做了。 */
  ['基础版入口 basic-enter', 'probe/basic-enter-guard.mjs'],
  /* ── 2026-09-26 · 近景水面清透（观荷水道）──
     守的是"近景机位前荷叶收成一条看穿的水缝"，且**远景仍是满池荷叶**。
     三个不可替换的门面（都写在 probe 头部，改门之前先读）：
     ① 判据必须走**像素**——改动全在顶点着色器里，而 Raycaster 走 CPU 几何+
        instanceMatrix、**不执行着色器**，射线法对这条改动恒为"无变化"= 永远绿的空门；
     ② 所有取样必须落在**同一个 page.evaluate 任务**里（任务内 animate 不推进 ⇒ 场景冻结），
        拆成两次 evaluate 时中间跑 rAF，同配置连渲两次实测差 8.97，信号会被噪声吃光；
     ③ floor 下限不是审美参数而是**蜻蜓的落脚点**（36 片叶全挂了停栖锚点）。
     自带负例：floor=1 时着色器是 no-op，必须与"关掉水道"**逐像素相同**。 */
  ['近景水面清透 nearview-clarity', 'probe/nearview-clarity-guard.mjs'],
  /* ── 2026-09-26 · 阴影烘焙「不可行」结论的前提门 ──
     离线把静态阴影预烘成贴图、运行时零开销，理论上很美，实测判为**不可行**（阶段 A 诊断）：
     ① src/12-env 的 hourSeg() 在晨/午/暮/夜之间对 sunPos **线性插值** ⇒ 太阳方向连续变化
        （全天弧长 180°，8° 口径下 11 个显著独立方向），有限张烘焙图在采样之间必然错位；
     ② 错位 = 投射物高度 × tan(Δθ)，要把错位压进 2 texel，实测需 **104~335 张** 2048²+ 阴影图；
     ③ 更硬的墙：Three.js 多盏方向光阴影是 `shadow *= getShadow(...)` **连乘**，没有"按权重混合
        N 张"的路径；要混合就得重写阴影采样 = 把已实测为负优化并回退的 CSM 重做一遍。
     本门守的是**这三条前提仍然成立**，不是"有没有烘焙产物"——哪天有人重提，这道门会直接告诉他
     前提变没变，不必从头实测一轮。⚠️ 门内两处必须踩准：时辰要走**滑杆 input handler**
     （ENV.cur 只在 handler 里由 composeEnv 重算，直接赋值只会重放旧值、量出"太阳整天不动"的
     反向假结论）；夜里那盏"太阳灯"是**月光替身**，必须按 starAmount 剔掉。 */
  ['阴影烘焙结论 shadow-bake', 'probe/shadow-bake-guard.mjs'],
  /* ── 2026-09-26 · 近地面高度雾（形态②）──
     守的是"层次只加在需要的地方"：10~25m 中景的雾覆盖率必须显著高于 0~3m 近景、
     远景 60m+ 基本不动、**且近景 3~10m 总衰减在清透预算内**（保护 6d07a9c 刚做出来的
     「近景水面清透」，两道改动在同一段距离上是对冲的）。
     门内三条不可替换的门面（改门前先读）：
     ① **不许用 pass 的类名认身份** —— vendor.js 压缩后构造器名变成 Wu/s/Al，
        实测 OutputPass 探测恒为 -1。只能按引用认身份、用索引关系判链序
        （实测链是 RenderPass→GTAO→Grade→HeightFog→Output，高度雾索引 3 / 共 5）。
     ② **N 组负例是这道门的牙**：uTop 抬到 200m（退回无上界均匀雾）后，25~60m 带的
        雾覆盖率必须从 0% 显著抬起来（实测 21.4%）。没有它，"远景不动"可能是一道
        永远绿的空门 —— 形状与当初栽过的"折射层"完全相同。
     ③ **交叉回归**：观荷水道的绿度差仍须 ≥ 0.8pp（实测 9.4pp），证明高度雾没把近景糊掉。 */
  ['近地面高度雾 volumetric-fog', 'probe/volumetric-fog-guard.mjs'],
  /* ── 2026-09-26 · 锦鲤跃水节流（用户"鱼游出水面会泛起涟漪的频率太过频繁"）──
     守的是"泛涟漪"读回**偶发**而非常态：事件 12~24/分、锦鲤链落圈 24~48/分、
     同鱼跃水间隔中位 ≥26s、且仍保留"出水+入水"两圈（没把交互反馈削没）。
     ⚠️ 本门有三个**测量陷阱**（都已在门内注释详写，改门前先读）：
     ① `riseT0` 初始化为 0，采样器若把 t=0 当跃水 ⇒ 每条鱼多一个"间隔=首次跃水时刻"
        （6~24s）的假短样本，11 条鱼凑成短间隔簇；
     ② 同鱼间隔在 60s 窗里只有 n≈7 个样本（一只鱼平均只跃水 1.68 次），中位标准误 ±6.6s ——
        **绝不能把两个窗的中位数再平均**（放大偏差）。现 `measure()` 返回原始数组，
        跨窗口汇总后取**单一中位**（实测 21.9s 假红 vs 汇总 29.9s 绿，理论 33s）；
     ③ `on=false` 只挡"跃水**开始**"，切换瞬间在飞行中的鱼仍走完 rd=2.8s 并触发落圈
        ⇒ 必须先**沉降 4s**（> rd）再计数。
     三条"有牙"负例：改回旧值 spread=18 后事件/落圈/间隔**全部越界判红**；`on=false`
     沉降后落圈归零。中位数那条另加**最小样本量 n≥12**（否则 n=2 也能判红＝"有数据就红"）。 */
  ['锦鲤跃水节流 koi-ripple', 'probe/koi-ripple-guard.mjs'],
  /* ── 2026-09-26 · 灯会挂灯扩展（用户"桃树、柳树、紫藤都可以挂花灯；
     院子围栏也可以挂一些中国传统的红色灯笼"）──
     守 A（柳 48 + 紫藤 24 盏花灯）与 B（围栏 48 盏红灯笼）：挂点已收集、三个网格齐备、
     非灯会态零提交、开灯会全显、**一个灯笼一份合并几何 ⇒ 120 盏只占 3 个对象**、
     真光源恒为 5、draw calls < 800。两条负例自检：把挂灯 count 改 0 ⇒ 显形判据报红；
     关灯会 ⇒ 零提交判据报红。 */
  ['灯会挂灯 festival-lanterns-guard', 'probe/festival-lanterns-guard.mjs'],
  /* ── 2026-09-30 · 电闪雷鸣（用户："增加一个'电闪雷鸣'的场景，需要把整个光线全部暗下来，
     达到或者接近暮色的光影效果…闪电时…不仅仅有亮光划过和照亮整体的效果，还可以还原空中电闪
     的效果（注意一定是闪电后才有照亮场景的效果），紧接着就是密集的雷鸣，声音要做得真实"）──
     ⚠️ 加这道门的**直接原因**：初版把闪电网格按**仰角**（地平线以上 9°~38°）摆在世界空间，
        而默认机位是俯视的（pitch −19.3°、fov 46 ⇒ 可见天空只有画面上端约 4°）⇒ 闪电整条投到
        ndc.y 1.8~6.8、亮痕 1.9~2.4，**全在画面之上**，"可见↔隐藏"的像素差是 **0**：
        "空中电闪 / 亮光划过"一个像素都没画出来，而断言只查了 mesh.visible ⇒ 全绿通过。
        ⇒ 本门量**投影 + 像素**，并且量"照亮整体"是量**画面下半部**（地面/建筑），不是天空。
     自带三条负例：两臂都定格"无闪"⇒ 画面必须≈不动（判据不是量的场景漂移）；
        定格峰值帧用 `setLightningHold`（产品侧权威开关，页内重调 tick 无效）；
        "非雷雨天气零闪电 / 离开后零残留 / 随机池永不抽中"三条隔离判据
        （2026-09-30 合并后加了"**狂风暴雨自己也会打闪电**"这条 —— 见 12-env 的 LN_ALLOWED）。 */
  ['电闪雷鸣 thunder-guard', 'probe/thunder-guard.mjs'],
  /* ── 2026-09-30 · 雨后初晴 + 七色彩虹（老黄选的第 6 个场景；同批"电闪雷鸣"并入
     "狂风暴雨"以腾出一个格子）──
     守两件会**静默失效**的事：① rainbow 是新加的 uniform 通道，缺键兜底写错（兜 1 而不是 0）
     会让**每个天气都挂一道虹** ⇒ 必须逐个天气量"虹强度=0"；② 虹心方向必须是**太阳的反方向**
     （真实成因），且 uniform 有值 ≠ 画面上有东西 ⇒ 还要冻结帧 A/B 量像素差。
     ⚠️ 判据机位必须**背对太阳**朝虹心看（第一版设在东北、整片虹在画外，判据报 0.000 差 ——
        那是机位选错不是产品没画；排查这类红先换机位复测，别急着改产品）。 */
  ['雨后初晴与彩虹 afterrain-guard', 'probe/afterrain-guard.mjs'],
  /* ── 2026-10-04 · 天空视觉层不许进 GTAO（老黄"进门首个画面就是这个大黑框"）──
     GTAO 的 pre-pass 用 override 材质把**整个场景再画一遍** ⇒ 被画进去的对象，
     自己 shader 的 `discard`/`depthWrite:false`/`blending` 全部不作数。
     虹拱（R=68m、带宽 5.2m、两侧都是天空）进了 AO 深度缓冲后，那片 AO 被算成 ≈0
     再乘回画面 ⇒ 天上一条**实心黑拱**（实测 16.5% 暗像素 ↔ 修后 0）。姊妹案例：
     闪电 bolt/streak 同样把自己的亮痕压暗（足迹 120px / 最大差 268）。
     ⚠️⚠️ 本门**强制 `?tier=high`**：`AO_ENABLED` 只在均衡/高两档为真，本机无头
     Chromium 常落 Intel Iris Xe（low）⇒ 其余门禁全在"没有 AO"的地基上跑 ——
     这正是"我这边全绿、老黄一进游戏就是黑框"的全部原因。第 1 条前提断言就是地基。
     自带两条负例：撤虹的 aoSkip ⇒ 暗拱必复现；把闪电组从 AUX_PASS_HIDDEN 摘掉
     ⇒ 压暗足迹必复现（两条实测都能红）。 */
  ['天空视觉层 sky-layer-guard', 'probe/sky-layer-guard.mjs'],
  /* ── 2026-09-30 · 大雁迁徙（春/秋）+ 鲜艳小鸟（石上休息 / 草上跳跃捕食）──
     守三件**曾经静默失效**的事：① 季节显隐（夏/冬必须 0 只雁，春/秋全可见）；
     ② **阵型切换不是摆设**：只断言 form 数字变过不够 —— 必须再断言两种阵型下
        "全队相对队首的散布"真的不同（实测人字横向 12.1m / 八字 8.5m），否则
        计数器变了而队伍形状没变；
     ③ 小鸟落点**必须落在真实石面上**（射线量石面高度，差值 ±0.45m 内）——
        我第一版手填了假山最高峰（y=7.47m，远看只有 1~2 像素）和猜的高度
        （1.6~3.0m），画面里就是"几只鸟浮在半空"。现改用探针实测的 6 个石面。
     ⚠️ 采样窗 20 秒：草上鸟一跳连啄整个周期约 7~14 秒（实测 20 秒内移动帧仅 7~14%），
        窗口太短（我第一版 1.4s）会全落在啄食阶段 ⇒ "只有 1/6 在跳"的假红。
     ⚠️ 颜色判据量**饱和度**而非亮度总和：青蓝 [0.01,0.06,0.30] 亮度低但极鲜艳，
        按"三通道之和"判会误判成灰（第一版 4/11 假红就是这个）。 */
  ['大雁与鲜艳小鸟 birds-guard', 'probe/birds-guard.mjs'],
  /* ── 2026-10-04 · 池中水禽（绿头鸭 ♂♀ / 鸳鸯 ♂♀）──
     计划书 §6「人/景」第一条"池面除荷叶外是空的"的落地，但这扇门守的其实是**另一件事**：
     第一版用 `Box3.setFromObject` 量鸭子尺寸 —— 那是**世界轴对齐盒**，鸭每帧绕 Y 转，
     盒子按"转到最外"撑开 ⇒ **屏幕上最窄的那一帧（正对机位）被量成 ~28px，实际 11px**。
     测量口径把最坏情况整帧抹掉，比"高估 2 倍"更糟：门禁绿着、鸭子其实是个点。
     ⇒ 本门第一件事就是把口径钉死（逐顶点投影 + 逐相位取最小值），
       再守：整圈在池内 / 贴水面线 / 真在游 / **不占涟漪配额**（只挂常驻尾涡圈，
       spawn 计数落在 koi+turtle 水位内 —— 若给它加了第三条涟漪链会 ~240 次/分当场爆）/
       本体在折射层而尾涡圈不在（半浸物口径）/ 不投影 / 不并进静态网。
     ⚠️ 这条"在不在折射层"第一版写反了，而且**正是 refract-coverage 的反扫把它抓出来的** ——
        详见 08-assemble 的返工注释（"会从折射贴图里冒出来"只对出水部分成立）。
     🔧 `--selfcheck`：缩回旧倍率 1.8 ⇒ 尺寸判据必须报红（实测 9.9px < 12）。 */
  /* ⚠️ 2026-10-05 **翻面**：水禽整层下线（老黄："去掉池子里的鸳鸯"）⇒ 本门改成
     "守它不再出现"（只数 0 + 按名字扫不到 duck* + 注入自检）。
     上面那几段"尺寸口径 / Box3 虚胖 / 在折射层"的历史判据留在 git 里，
     恢复水禽（08-assemble 的 DUCK_ON 置 true）时一并取回。 */
  ['池中水禽已下线 duck-guard', 'probe/duck-guard.mjs'],
  /* 金刚鹦鹉（2026-10-05 建）：老黄"鹦鹉的动作…有时候会看到像抽搐了几下" ——
     这个观感缺陷**此前没有任何门禁**，所以一路漏到他眼前。守姿态**角速度**上限
     （抽搐与正常动作的分界线；用角速度而非单帧跳幅，因为后者随帧率变）+ 作息 +
     "窗口内真的播过那些动作"的防空判据前提。 */
  ['金刚鹦鹉 macaw', 'probe/macaw-guard.mjs'],
  /* 园林陈设 props-guard（2026-10-05 建）：14-props 的注释一直把 PROP_SPOTS / PROP_REGISTRY
     写成"门禁的唯一真值源"，但**这道门此前在仓库里根本不存在**（磁盘递归搜、git log --all、
     docs 全无命中）⇒ 于是"表里写 1.30、实物在 −0.23"这类静默事故（水缸那次）只能靠眼睛发现。
     这次补上：登记表↔场景**双向配对** + 落地件"脚下的那个面"±0.18m + 两条负例自检
     （挪登记项 / 塞未登记件，都必须报红）。 */
  ['园林陈设 props', 'probe/props-guard.mjs'],
  /* 春节烟花（2026-10-05 建，老黄要的"盛大场景 · 冬季限定"）：两条都是本项目的老坑 ——
     ① "做出来了但看不见"（大雁 4~10px / 滴水 4px / 彩虹 0px / 闪电按仰角摆 0px）；
     ② 只查 visible 会静默放过"根本画不出来"。
     ⚠️ 本门**只量用户真能摆出的机位**：`OrbitControls.maxPolarAngle=88.6°` ⇒ 镜头抬不起来，
     默认俯视机位物理上看不到天上的花 ⇒ 天上那半用"接近平视的合法位姿"量。
     守：冬季限定门控（4 组季节/时辰/天气）+ 天上出花（≥300px，实测 7416px）+
     **照亮庭院**（默认俯视机位下，闪光峰值帧 ≥ 基线×1.25，实测 2.08）+ 两条自检。 */
  ['春节烟花 fireworks', 'probe/fireworks-guard.mjs'],
  /* 堂前香炉的白烟（2026-10-05 建，老黄要的"袅袅白烟"）：半透明白烟天生容易淡到看不见
     （本项目踩过：大雁 4~10px、滴水 4px、彩虹曾整条 0px）⇒ 新视觉元素必须配门。
     守：烟柱原点 = 香炉落点（xz 逐字相同）+ 起烟口在炉盖之上 + **真的在动**（换 uTime
     画面必须变）+ **默认机位看得见**（≥15px，实测 593px）+ 同参数连渲逐位为 0 的自检。 */
  ['香炉白烟 censer', 'probe/censer-guard.mjs'],
  /* ── 2026-10-01 · 远山不再读成"没画完的背景板"（"挑剔玩家视角"扫图抓到的头号 CG 感）──
     守 09-28 走查记下的三个观感缺陷：① 四层远山颜色趋同（实测相邻层亮度差只有
     0.56~4.14，三、四层直接并进天空）② 山体平涂无内部明暗 ③ 山脊与天对比极弱（−1.35）。
     这三条**四十多道既有门禁一条都验不出** —— 它们全是"守住已知不变量"，
     而"看起来假"只能靠量。
     ⚠️ 判据用**冻结帧 A/B**（关掉 relief 画面必须变），**不用"亮度标准差"**：
        我试过 SD，它与 relief 几乎无关（近层 relief 归零后 17.98→17.63 只掉 2%）——
        SD 被竖向的谷底沉雾渐变主导；而远层在 176m 处被 Exp2 雾吃掉 57% 信号，
        SD 天生到不了 8 ⇒ 那是一条**物理上不可能满足**的判据，只能靠改数值把它"做绿"。
     ⚠️ 已装牙（实测）：在缺陷态代码上跑本门报红 5 条（层内明暗/层间色阶×2/脊线/自检③），
        见 outputs/_diag/hill-guard-TEETH2.log。 */
  ['远山观感 hill-guard', 'probe/hill-guard.mjs'],
  /* ── 2026-10-01 · 老黄**第二次**报"室内怎么也会有雪" ──
     第一次（2026-09-19）的修法是"禁区即死"（src/12-env 的 PRECIP_INDOOR），
     但禁区顶 `yTop` 被定在 **5.0**，而堂内天花在 `1.24 + colH + 0.44`（colH = H−2.35，H=7）
     ⇒ **6.33** ⇒ 房间上半截 5.0~6.33（占层高 26%）的雪**一直没被杀掉**，
     潜伏了两周没人发现 —— 因为没有任何判据知道"这间屋子到底有多高"。
     本门**用射线在场景里量出天花标高**（不写死），再判"天花以下不得有雨雪粒子"，
     所以以后谁把 yTop 调低、或者把房子加高，这里都会自动报红。
     ⚠️ 装牙时踩到一次**假门**：第一版没把机位摆到堂前，而雨雪体积是"跟着相机走的
     ±30m 盒"⇒ 默认机位下体积只擦到堂的前沿、堂内粒子恒为 0 ⇒ **无论产品对错都是绿的**。
     负例对照（把 yTop 改回 5.0）当场戳穿 ⇒ 现在先摆机位、并加一条前置断言
     （天花以上必须量到粒子）证明体积真的罩住了堂。 */
  ['室内不落雨雪 indoor-precip', 'probe/indoor-precip-guard.mjs'],
  /* ── 2026-10-01 · GLSL 编译失败 ⇒ **整个天空纯黑**，而症状与真因毫无关系 ──
     给天空加次虹时把 breathe 声明在主虹的 if 块里、次虹那个块看不见 ⇒ three 报
     "'breathe' : undeclared identifier" ⇒ 天空球整个不画。而当时看到的画面只是
     "彩虹不见了"，连着三轮都在调方位角 —— 真因是一行作用域错误，与角度毫无关系。
     之所以没有门禁拦住：编译失败时**页面照常显示、不抛异常、不进 pageerror**，
     npm run check 也只做 JS 语法、不编译 GLSL，只有 three 打到 console 一行 error。
     本门直接问 WebGL：遍历场景里所有渲染过的 ShaderMaterial 查 LINK_STATUS，
     外加一条"天空区域不是黑的"（断症状，不断内部状态 —— 读天空材质的 currentProgram
     不可靠，它同时被主渲染与 PMREM 烘焙用过，指向哪个变体取决于最后一次谁在渲染）。 */
  ['着色器编译 shader-guard', 'probe/shader-guard.mjs'],
  /* ── 2026-10-01 · 老黄"雨后初晴…地面和周边环境还有雨水的痕迹么，或者屋檐还在继续滴水" ──
     守两个新部件（屋檐滴水 / 地面积水）。最有价值的是那条"**积水必须落在地面上**"：
     水洼高度是运行时射线量出来的，而第一版射线只取"第一个非实例网格" ⇒ 落点上方有墙或
     屋面时水洼会被**贴到墙上**（材质反天空 ⇒ 发白），多模态一眼看出"右侧白墙上有一块
     不自然的白斑"。⇒ 判据直接量每一片的落位高度，而不是只数"有没有水洼"。 */
  ['雨后痕迹 postrain', 'probe/postrain-guard.mjs'],
  /* ── 2026-10-02 · 评审 P1「默认机位可读性」──────────────────────────────
     背景：近期一连串"做出来了但默认机位看不见"的缺陷（大雁远看是黑点 ⇒ 整层下线、
     小鸟实测最长边 6~11.6px、屋檐滴水 0.09% 像素）全是老黄实拍才发现的 ——
     探针能量'在不在场景里'，却没有任何一道门在量'用户站在默认机位能看到多少'。
     本门把机位摆到默认机位，对每个氛围元素做冻结帧同任务 A/B，量像素贡献。
     下限刻意低（15px，只抓"几乎不可见"那一档），不是强制每个元素都占多大 ——
     那会把门变成"罚当时的产品形态"（同 10-01'判据把产品固化成标准'）。
     ⚠️ 写这道门踩到的三个坑（都写进代码注释了）：Playwright evaluate 不能传函数；
     动态 import 的 await 会让出事件循环、中间跑 rAF ⇒ A/B 全是被污染的垃圾
     （自检 178、六个元素全报 ~17.8k px 雷同数）；必须是自检先绿再信数字。 */
  ['默认机位可读性 legibility', 'probe/legibility-guard.mjs'],
  /* ── 2026-10-04 · 「不在链上的门 = 没有门」收官：5 道**结论门**收回链 ─────
     这五道此前都是"专项/结论门"：写在 probe/ 里、能跑、也一直是绿的，但**没注册进
     本链** —— 于是它们守的结论谁退了化都没人知道（同 2026-10-03 把 pwa-cache 收回
     链的理由：那道门当时就是"链外红门"，红着没人看见）。
     本轮全部先单跑复核（本机 Intel Iris Xe / low 档）：PMREM 8/8 · 定步长 6/6 ·
     水面 Fresnel 7/7 · 桃形态 26/26 · 夜空 14/14。单项 19~69s，与既有快门同量级。
     各门守的结论：PMREM 按时段烘一次并缓存（切回零重烘）· 仿真固定步长累加器
     （风钟与物理共用同一时间线）· 水面 Schlick Fresnel（旧公式中角度就泛白）·
     桃的四季形态与晴午波光 · 夜空月轮仰角/月相/星点（与远山山高上限物理互斥）。 */
  ['PMREM 按时段缓存 pmrem-env', 'probe/pmrem-env-guard.mjs'],
  ['固定步长仿真 fixed-timestep', 'probe/fixed-timestep-guard.mjs'],
  ['水面 Fresnel water-fresnel', 'probe/fresnel-guard.mjs'],
  ['桃·形态 peach-form', 'probe/peach-form-guard.mjs'],
  ['夜空与月相 night-sky', 'probe/night-sky-guard.mjs'],
  ['锦鲤行为层 koi-behavior', 'probe/koi-behavior-guard.mjs'],
  ['桌面画质档 desktop-quality', 'probe/desktop-quality-guard.mjs'],
  /* ── 本门 ~5 分钟（观察窗 120s + 冬季 30s + 负例 60s + 关闭 30s），与 mist-guard 同属
     "长门"，已在下面的长门预算表里单独放宽。守的是用户 2026-09-28 拍板的水面涟漪水位：
     龟链 12~24 次/分（实测 17.0），且带**两条有牙负例**（旧间隔 55.0/分必红、关掉必归零）。 */
  ['泳龟尾迹节流 turtle-wake', 'probe/turtle-wake-guard.mjs'],
];

/* ── T7.1（2026-09-23）三条改进 + T7.4（2026-09-24）④ ────────────────────
   ① **红门必须把明细打出来**：原来只打 `exit=1`、只回显 stdout 最后 3 行 ⇒ 想知道红在哪
      必须**单独重跑那一门**（实测每次定位多花 3~15 分钟；`mist-guard` 单门就要 225~280s）。
      现在红门把子进程的**完整 stdout/stderr** 打出来。
   ② **整轮完整日志落盘**：不必再依赖外层 shell 重定向（漏了就丢证据）。
   ③ **打 GPU 档位**（开头 / 结尾 / 红门当场各一次）：`_harness` 自己写着"ANGLE 每次挑哪块
      GPU 不固定"，实测同机出现过 Intel Iris Xe（核显档）与 NVIDIA RTX 4060（独显档），
      两档的超采样/阴影尺寸/GTAO/粒子量全不同（同场景 draw calls 308 vs 716）⇒ **像素统计不同**
      ⇒ σ/容差类判据会随档位漂。有这一行才能把"偶发红门"与档位对上。
   ④ **红门重跑一次 + FLAKY 标注**（见下方 STRICT/RETRY 一段的说明）：把"偶发"与"真红"分开报，
      既不静默变绿、也不让偶发红门一直拖着整轮。
   ⚠️ 判"是不是你改坏的"：看**同一门是否每轮都红**，而不是看某一轮有没有红。 */
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG = path.join(ROOT, 'outputs', '_diag', `verify-${STAMP}.log`);
try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); } catch {}
const logLine = (s) => { try { fs.appendFileSync(LOG, s + '\n', 'utf8'); } catch {} };
const say = (s) => { console.log(s); logLine(s); };
const gpuTag = () => {
  try {
    const r = spawnSync(NODE, [path.join(ROOT, 'probe', 'gpu-tag.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
    const line = (r.stdout || '').trim().split('\n').filter(l => l.includes('[GPU]')).pop();
    return line || '[GPU] (未取到)';
  } catch { return '[GPU] (未取到)'; }
};

/* ⚠️ 自检开关（T7.1 配套 · 同 warmboot-guard 的负例文化）：`VERIFY_SELFTEST=<相对路径>`
   会把整张表换成"只跑那一个脚本"，用来验证**红门路径**本身（明细是否打出、日志是否落盘、
   GPU 是否打印、退出码是否为 1）—— 否则要验证它就得先真弄红一门、白等 13 分钟。
   例：`VERIFY_SELFTEST=probe/_selfcheck-fail.mjs node probe/verify-all.mjs` */
const SELFTEST = process.env.VERIFY_SELFTEST;
/* ── 分层验证：`--quick`（2026-10-02，老黄 2026-09-25 定的原则"局部改动只跑相关专项，
     高风险/发布节点才跑全量"的形式化；评审清单 P2）────────────────────────────
   quick 选的门槛原则：**快**（每门都应在 1 分钟内）+ **覆盖面广**（不是只测最近改的东西）——
   它的职责是"日常改动后的 5 分钟兜底"，抓的是语法/导入/运行期炸/布局漂移/最核心的行为回归。
   ⚠️ 明确不进 quick 的：像素门与长采样门（mist 185~390s、birds 230s、figure-audit、
     intro/loading/warmboot 等启动期采样门）—— 那些是"高风险/发布节点"的职责，
     收尾与发布前必须跑一次全量 `npm run verify`，这条写在 README 的验证体系里。
   估算耗时：check 2s + codeonly-unit 1s + import-audit 1s + smoke ~25s + pageerror ~70s
     + layout-fingerprint ~12s + random-guard 10s ≈ **2 分钟出头**。 */
const QUICK = new Set([
  'probe/check.mjs', 'probe/codeonly-unit.mjs', 'probe/import-audit.mjs',
  'probe/preload-manifest-sync.mjs',   // 纯 node + <1s + 抓过真事故 ⇒ 正是 quick 的菜
  'probe/smoke.mjs', 'probe/pageerror-guard.mjs',
  'probe/layout-fingerprint.mjs', 'probe/random-guard.mjs',
  'probe/figure-foot-guard.mjs',       // 纯射线 ~17s + 零覆盖的缺陷类（人物陷进台基/走在水上）
  /* 2026-10-04：三道 <30s 的结论门进 quick（都满足 quick 的两条门槛：≤1 分钟 + 覆盖面广）——
     它们此前**不在链上**，等于没人守：PMREM 时段缓存（切回零重烘）、仿真固定步长
     （风钟与物理同一时间线）、水面 Schlick Fresnel（旧公式中角度就泛白）。
     桃·形态(68s)/夜空(69s) 超 1 分钟，按 quick 自己的规矩留在全量链。 */
  'probe/pmrem-env-guard.mjs', 'probe/fixed-timestep-guard.mjs', 'probe/fresnel-guard.mjs',
]);
/* ── `--gates=a,b,c`：只跑指定的几道门（2026-10-02 加，评审 P2「分层验证」的第二半）──
   用途：交接文档里那种「晨间单跑复核三道疑似伪红」的活，一条命令就能干，
   不必为它另写脚本、也不必整轮 2 小时。
   匹配规则：对 path 与 label 做**子串**匹配（`--gates=mist-guard` 命中 probe/mist-guard.mjs）。
   ⚠️ 匹配不到任何一个 ⇒ **响亮报错并 exit 1**：否则「名字拼错」会变成「跑了 0 道门、全绿」，
      那正是本项目反复踩的「假绿」形状。 */
/* ── 长门的**测量预算**单独放宽（2026-10-02，证据驱动）────────────────────────
   ⚠️ 这是"给它多少时间量"、**不是**"放宽判据"：被 harness 掐死的门既不算通过、也不算
      产品缺陷（exit=null），所以预算是纯粹的测量开销问题。
   证据：mist-guard **单跑 343.9s 通过**，而在跑满 4 小时的全量链尾段两次都 >600s 被杀
   （核显散热降速 ⇒ 同一门 1.7× 慢）；koi-ripple 同型（长采样 + 90s 稳态等待）。
   对比：短门（intro 30.3s、hill 46s、postrain 70s…）600s 预算有 8~20× 余量，不用动。 */
const GATE_TIMEOUT = new Map([
  ['probe/mist-guard.mjs', 900000],
  ['probe/koi-ripple-guard.mjs', 900000],
  /* 2026-10-04：turtle-wake 与 koi-ripple 是**同一类**（长采样 + 稳态等待），
     单跑实测 ~300s（观察窗 120s + 冬季 30s + 负例 60s + 关闭 30s + 启动）。
     按上面那条 1.7× 散热降速的经验，热机器上就贴到 600s 默认预算 ⇒ 同样放宽。 */
  ['probe/turtle-wake-guard.mjs', 900000],
]);
const timeoutFor = (rel) => GATE_TIMEOUT.get(rel) || 600000;
const GATES_ARG = (process.argv.find(a => a.startsWith('--gates=')) || '').slice(8);
const GATE_KEYS = GATES_ARG.split(',').map(s => s.trim()).filter(Boolean);
const byGates = GATE_KEYS.length
  ? SUITES.filter(([label, p2]) => GATE_KEYS.some(k => p2.includes(k) || label.includes(k)))
  : null;
const QUICK_MODE = process.argv.includes('--quick');
const LIST = SELFTEST ? [['自检·故意失败', SELFTEST]]
              : byGates ? byGates
              : QUICK_MODE ? SUITES.filter(([, p2]) => QUICK.has(p2))
              : SUITES;
if (byGates && !LIST.length){
  console.error(`[verify-all] ✗ --gates=${GATES_ARG} 没有匹配到任何门（可用名字见 SUITES 表）——拒绝以「0 道门全绿」收场`);
  process.exit(1);
}
if (byGates) say(`[verify-all] 🎯 --gates=${GATES_ARG} ⇒ 只跑 ${LIST.length} 道：${LIST.map(([l]) => l).join('、')}`);
if (QUICK_MODE && !SELFTEST){
  say(`[verify-all] ⚡ quick 模式：${LIST.length}/${SUITES.length} 道（快门 + 广覆盖；发布前仍须跑全量 npm run verify）`);
}

/* ── 红门重跑 + FLAKY 标注（2026-09-24）────────────────────────────────────
   为什么要有它：项目里反复出现"**全链红在某一门、单跑全绿**"（GPU 档位切换 / 并发负载 /
   就绪竞态）。这类红**不是缺陷**，但也不是"通过" —— 处理原则写死在这里，别改成静默重试：
     · 红门先打出**第 1 次完整明细 + GPU 档位**（证据不丢），再**自动重跑一次**；
     · 重跑通过 ⇒ 记 **FLAKY**：响亮打印、写进汇总、**默认不判红**（exit 0）；
       `VERIFY_STRICT=1` 时 FLAKY 也判红 —— 想把"偶发"当缺陷处理时用它；
     · 重跑仍红 ⇒ **真红**，走原路径（完整明细 + exit 1）。
   ⚠️ 绝不做的事：把重跑结果当"绿"写进主日志而不标注 —— 那会让"系统性偶发"永远藏着。
   ⚠️ 为什么只重跑一次：偶发与真缺陷的区分只需要一次独立复现；重跑两次以上是在用时间换假绿。
   开关：`VERIFY_NO_RETRY=1` 关掉重跑（调试时想要第一手红）。 */
const STRICT = process.env.VERIFY_STRICT === '1';
const RETRY = process.env.VERIFY_NO_RETRY === '1' ? 0 : 1;

say('[verify-all] 串行执行（探针并行会互抢 GPU/CPU，互相拖慢并误报）');
if (SELFTEST) say(`[verify-all] ⚠️ 自检模式：只跑 ${SELFTEST}（验证红门路径，不是真跑链）`);
if (!RETRY) say('[verify-all] ⚠️ VERIFY_NO_RETRY=1：红门**不重跑**（要第一手红时用）');
if (STRICT) say('[verify-all] ⚠️ VERIFY_STRICT=1：FLAKY 也判红');
say(`[verify-all] 完整日志：${path.relative(ROOT, LOG)}`);
say(gpuTag());
say('');
const failed = [], flaky = [];
const dumpRed = (name, tag, r, dt) => {
  say(`✗✗ 红门明细开始（${name}${tag}）—— 完整 stdout / stderr`);
  say((r.stdout || '').trim() || '(stdout 为空)');
  if ((r.stderr || '').trim()) say('[stderr]\n' + (r.stderr || '').trim());
  if (r.signal) say(`[signal] ${r.signal}`);
  say(`✗✗ 红门明细结束（${name}${tag}）`);
  say(gpuTag());
};
for (const [name, rel] of LIST){
  say(`── ${name} ──────────────────────────`);
  const t0 = Date.now();
  const r1 = spawnSync(NODE, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: timeoutFor(rel) });
  const dt1 = ((Date.now() - t0) / 1000).toFixed(1);
  let r = r1, dt = dt1, retried = false;
  if (r1.status !== 0 && RETRY){
    say(`⚠ 第 1 次 exit=${r1.status}（${dt1}s）—— 明细如下，随后**自动重跑一次**（区分"偶发"与"真红"）`);
    dumpRed(name, ' · 第 1 次', r1, dt1);
    const t2 = Date.now();
    r = spawnSync(NODE, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: timeoutFor(rel) });
    dt = ((Date.now() - t2) / 1000).toFixed(1);
    retried = true;
    say(`↻ 重跑结果：exit=${r.status}（${dt}s）`);
  }
  const out = (r.stdout || '').trim();
  const ok = r.status === 0;
  if (ok){
    const tail = out.split('\n').slice(-3).join('\n');
    if (tail) say(tail);
    if (retried){
      say(`⚠⚠ **FLAKY（偶发）**：${name} —— 第 1 次 exit=1、重跑 exit=0。`);
      say('   ⚠️ 这不等于"通过"：它说明**这门不稳**。排查两条线：① GPU 档位（_harness 明说 ANGLE');
      say('      每次挑哪块 GPU 不固定，像素类阈值会随档位漂）；② 就绪竞态（是否只等 loading.done');
      say('      而没等 __garden.bootDonePromise —— 延迟批还在进场时采样）。');
      say('   要把它当缺陷处理：`VERIFY_STRICT=1 npm run verify`（FLAKY 也判红）。');
    }
  } else {
    dumpRed(name, retried ? ' · 重跑仍红' : '', r, dt);
  }
  say(`${ok ? (retried ? '⚠' : '✓') : '✗'} ${name} — exit=${r.status}（${dt}s${retried ? ' · 重跑' : ''}）`);
  say('');
  if (!ok) failed.push(name);
  else if (retried) flaky.push(name);
}

const flakyNote = flaky.length ? `偶发（FLAKY，重跑通过）${flaky.length} 道：${flaky.join('、')}` : '';
if (failed.length){
  const msg = `[verify-all] FAILED：${failed.join('、')}${flakyNote ? ` ｜ ${flakyNote}` : ''}`;
  console.error(msg); logLine(msg);
  console.error(`[verify-all] 完整日志：${path.relative(ROOT, LOG)}`);
  process.exit(1);
}
say(gpuTag());
if (flaky.length){
  say(`[verify-all] ALL GATES PASS ✓ —— 但有 **${flaky.length} 道 FLAKY**：${flaky.join('、')}`);
  say('[verify-all] ⚠️ FLAKY ≠ 通过：它们是"不稳的门"，按 GPU 档位 / 就绪竞态两条线查；');
  say('[verify-all]     `VERIFY_STRICT=1 npm run verify` 可让 FLAKY 也判红。');
  if (STRICT){
    const m = `[verify-all] STRICT：FLAKY 判红 —— ${flaky.join('、')}`;
    console.error(m); logLine(m);
    process.exit(1);
  }
} else {
  say('[verify-all] ALL GATES PASS ✓');
}
