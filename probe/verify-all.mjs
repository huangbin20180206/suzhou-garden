// 一条命令验到底（2026-09-17；2026-09-21 增至 25 门；2026-09-22 回填缺口增至 30 门）：串行跑 check
// → codeonly-unit → import-audit
// → wind-trajectory → shadow-cover → smoke → pageerror-guard → reel-guard → lamp-guard → mist-guard
// → postcard-guard → longexposure-guard → peach-guard → sound-guard → guide-guard → wind-audit
// → wisteria-color → koi-orbit → perch-dragonfly → stone-audit → stele-legibility → figure-audit
// → refract-guard → refract-coverage → weather-coverage → intro-guard → loading-guard
// → warmboot-guard → random-guard → lampvol-guard，
// 汇总三十个子门的结论，任何一个红整体就红。
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
//    整套 **12m14s**（2026-09-22 三十门全绿那次实测；上一轮 25 门那次 16m28s —— 波动主要来自
//    mist-guard，它 185s / 390s 都出现过）。
//    浏览器探针一律走 `probe/_harness.mjs`（真 GPU / D3D11）；要复现历史基线用
//    `GARDEN_SOFT=1`。单门耗时：shadow-cover 14s / smoke 22s / figure-audit 21s /
//    pageerror-guard 69s / reel-guard 19s / lamp-guard 21s / mist-guard 185~390s /
//    postcard-guard 19s / sound-guard 57s / guide-guard 20s / refract-guard 21s /
//    refract-coverage 12s / weather-coverage 16s / **intro-guard 22s / loading-guard 10s /
//    warmboot-guard 26s / random-guard 10s / lampvol-guard 44s**。
// ⚠️ 跑链期间别做观感/帧率测试：30 门各起一个真实 GPU 的 Chromium，会抢显存与 CPU。
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
  ['拆分守卫 import-audit',   'probe/import-audit.mjs'],
  ['风场轨迹 wind-trajectory','probe/wind-trajectory.mjs'],
  ['阴影视体覆盖 shadow-cover','probe/shadow-cover.mjs'],
  ['无头回归 smoke',         'probe/smoke.mjs'],
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
const LIST = SELFTEST ? [['自检·故意失败', SELFTEST]] : SUITES;

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
  const r1 = spawnSync(NODE, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  const dt1 = ((Date.now() - t0) / 1000).toFixed(1);
  let r = r1, dt = dt1, retried = false;
  if (r1.status !== 0 && RETRY){
    say(`⚠ 第 1 次 exit=${r1.status}（${dt1}s）—— 明细如下，随后**自动重跑一次**（区分"偶发"与"真红"）`);
    dumpRed(name, ' · 第 1 次', r1, dt1);
    const t2 = Date.now();
    r = spawnSync(NODE, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
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
