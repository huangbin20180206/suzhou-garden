// 一条命令验到底（2026-09-17；2026-09-21 增至 25 门）：串行跑 check → codeonly-unit → import-audit
// → wind-trajectory → shadow-cover → smoke → pageerror-guard → reel-guard → lamp-guard → mist-guard
// → postcard-guard → longexposure-guard → peach-guard → sound-guard → guide-guard → wind-audit
// → wisteria-color → koi-orbit → perch-dragonfly → stone-audit → stele-legibility → figure-audit
// → refract-guard → refract-coverage → weather-coverage，
// 汇总二十五个子门的结论，任何一个红整体就红。
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
//    → 再加 weather-coverage（+80s）后，整套约 **11m**（以全绿那次的实测数为准）。
//    浏览器探针一律走 `probe/_harness.mjs`（真 GPU / D3D11）；要复现历史基线用
//    `GARDEN_SOFT=1`。单门耗时：shadow-cover 14s / smoke 26s / figure-audit 23s /
//    pageerror-guard 75s / reel-guard 21s / lamp-guard 21s / mist-guard 98s /
//    postcard-guard 23s / sound-guard 60s / guide-guard 17s / refract-guard 30s /
//    refract-coverage 22s。
// 用法: node probe/verify-all.mjs   （或 npm run verify）
import { spawnSync } from 'node:child_process';
import path from 'node:path';
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
];

console.log('[verify-all] 串行执行（探针并行会互抢 GPU/CPU，互相拖慢并误报）\n');
const failed = [];
for (const [name, rel] of SUITES){
  console.log(`── ${name} ──────────────────────────`);
  const t0 = Date.now();
  const r = spawnSync(NODE, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const tail = (r.stdout || '').trim().split('\n').slice(-3).join('\n');
  if (tail) console.log(tail);
  const ok = r.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${name} — exit=${r.status}（${dt}s）\n`);
  if (!ok) failed.push(name);
}

if (failed.length){
  console.error(`[verify-all] FAILED：${failed.join('、')}`);
  process.exit(1);
}
console.log('[verify-all] ALL GATES PASS ✓');
