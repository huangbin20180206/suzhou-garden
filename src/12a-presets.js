// 12a-presets: 环境三轴（时段 / 季节 / 天气）的预设表 + 合成规则 —— 2026-10-05 从 12-env.js 整块搬出。
/* 为什么单独一个文件：这三张表 + 「组合规则」是本项目"64 种组合不失控"的地基（见原注释），
   它们是**纯数据 + 纯函数**（只读 ENV、算出一份扁平参数集），与 12-env 里"把参数落到渲染对象上"
   （applyEnv）、状态机（setEnv）、面板 UI 完全不是一回事。原块 605 行。
   ⚠️ 本文件**不能** import './12-env.js'（12-env 反过来 import 本文件 → 成环、启动期 TDZ，项目多次前科）。
   它只**读** ENV（weatherTag / effectiveWeather / applyWeatherTo 要读 ENV.weather / .season / .cur），
   故由 12-env 注入：`bindPresetsEnv(ENV)`。
   ⚠️⚠️ 注入时机是**关键**：12-env 里紧接着 `ENV.cur = resolveEnv()` 就要用本模块的 resolveEnv/paramsAtHour，
      而那一路会读 ENV.weather → 所以 bindPresetsEnv 必须在 `ENV.cur = resolveEnv()` **之前**调用，
      否则读到的 ENV 是 null（立刻崩，故意不兜底：兜底只会静默退化成"永远晴天"）。
   ⚠️ 只导出"12-env 与其它模块要用到的名字"；表内私有辅助（moonDirAtHour / hourSeg / grayMix /
      applyWeatherTo / makeParams / ENV_COLOR_KEYS / SKY_GRAY / FOG_GRAY / weatherLabelOf）不出文件。 */
import { THREE } from '../vendor.js';
/* 2026-10-30 环境路线图：太阳 / 月相 / 时段判定与花历是两个**零依赖**的纯模块（node 下可单测），
   本文件只负责把它们的结果合进参数集。依赖方向保持单向：12a → 12g / 12h，那两个不 import 任何人。 */
import { SOLAR, solarPos, sunTimes, sunDir, timeKeyAt, timeAnchorsFor, moonAge, moonIllum,
         moonRiseHour, smoothstep } from './12h-solar.js';
import { phenoChannels, drizzleKind, drizzleLabel, SEASON_DOY } from './12g-phenology.js';

/* ↓ 由 12-env.js 在 `ENV.cur = resolveEnv()` 之前注入（见文件头） */
let ENV = null;
export function bindPresetsEnv(state){ ENV = state; }
/* 年内日序：季节按钮背后的内部量（12-env 的 ENV.doy）；没写过就取季节代表日（node 单测 / 旧调用兜底）。 */
const envDoy = () => (ENV && ENV.doy) || SEASON_DOY[(ENV && ENV.season) || 'summer'] || SEASON_DOY.summer;

/* ── 时段预设 ──
   每个预设是一组扁平的标量与颜色通道。颜色用 hex（number），
   因此需要一份「哪些 key 是颜色 / 向量」的清单来指导构造与插值。 */
const ENV_COLOR_KEYS = ['sunColor','ambColor','hemiSky','hemiGround','fillColor',
                        'skyTop','skyMid','skyHorizon','sunDisk','cloudTint','fogColor',
                        'snowTint',          // 天气：积雪色调（不登记就不会被 makeParams 转成 Color）
                        // 季节植被色调（作用于各自材质）
                        'tinGrass','tinBamboo','tinLeaf','tinReed','tinWillow',
                        'tinLily','tinLotus','tinWisteria','tinBanana','tinTrunk'];
/* ── 天气预设（第三个正交轴）──
   与季节同样的契约：只写「与时段无关」的那部分 ——
   光强 / 雾 / 曝光 / 饱和的乘性或加性修正，加上天气专属通道。
   天气专属通道：cloudAmount / rainAmount / snowAmount / snowCover / wetness /
                windMul / gustMul / skyGray / fogGray / diskFade / snowTint / shadowK
   ⚠️ 每个预设必须写全这些键，否则 mixInto 会在 undefined 上做算术。
   ⚠️ shadowK = 物体影子的强度（2026-09-28 用户反馈："阴霾和薄雾场景不要建筑/
      植物/石头的影子，与现实不符"—— 阴天雾天是漫射光，投不出边界清晰的硬影）。
      1=照常、0=全无；applyEnv 写进 sun.shadow.intensity，切天气时随 mixInto
      逐键缓动 ⇒ 影子在过渡里渐隐渐现，不会"啪"一下消失。暴雨/雪暂维持 1（用户
      只点名这两种；暴雨 sunMul 0.14 本就几乎读不出影感）。 */
export const ENV_WEATHER = {
  clear: { weatherLabel:'风和日丽', blizzard:0,
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:1.00, satMul:1.00, expMul:1.00, shadowK:1.00,
    cloudAmount:null, skyGray:0.00, fogGray:0.00, diskFade:0.00,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.0,
    /* 月亮可见度（2026-09-19）：晴夜满月照常；阴/雨/雪按云量打折到 0~0.3。
       老黄点名要"风和日丽场景下"有月亮 —— 所以晴=1.0 是基准，其余按"云有多厚"递减。 */
    windMul:1.00, gustMul:1.00, moonVis:1.00, snowTint:0xF2F6FA },
  storm: { weatherLabel:'狂风暴雨', blizzard:1,   // 冬季 → 下面的 blizzard 分支会把它变成风雪
    /* sunMul 0.38 → 0.14（2026-09-18 · 用户报「狂风暴雨里有些地方像有太阳透下来」）。
       0.38 是"还能看出方向感"的取法，但它把直射项留在了一个**可见**的量级上，
       和下面两条叠加就穿帮：① 湿地把石材/瓦/草地压成半镜面，直射项被反射成
       顺着视线跑的金色高光带（换个角度就特别明显）；② 影子的边界外没有阴影测试
       （旧阴影视体比园子还小），边界处影子被硬切出一条亮缝。
       真正的暴雨里直射项本就该≈0，画面靠 ambMul/hemiMul 撑（0.85/0.90 已够）。
       0.14 保留一丝方向感让体块读得出来，但不足以在地面/墙面结成亮带。 */
    /* 2026-09-29 二轮（老黄："秋+暴雨整个颜色基调太难看"）：四层灰叠加（雾2.40×秋1.18、
       环境0.85、饱和0.84、曝光0.95）把画面压成"脏灰老照片"。整体去闷：
       雾 2.40→1.70（雨幕该有、灰汤不该有）、环境/天光抬回接近满档（阴雨天靠天光照亮）、
       饱和 0.92、曝光回 1.00；sunMul 保持 0.14（无直射阳光的设定不变）。 */
    sunMul:0.14, ambMul:0.95, hemiMul:1.00, fogMul:1.70, satMul:0.92, expMul:1.00, shadowK:1.00,
    cloudAmount:1.00, skyGray:0.55, fogGray:0.30, diskFade:0.85,
    rainAmount:1.0, snowAmount:0.0, snowCover:0.0, wetness:1.0,
    windMul:4.00, gustMul:0.30, moonVis:0.00, snowTint:0xF2F6FA },   // 暴雨/风雪：全天无月
  /* ══ 雨后初晴（2026-09-30 · 老黄选的第 6 个场景）══════════════════════════
     "雨刚停，瓦片/石板/树叶还在滴水，太阳出来了；地面和池塘亮得反光，
      空气里飘着一层薄薄的水汽，草和树绿得发亮" + 加一道七色彩虹。
     取值逻辑（每一条都对应"雨刚停"的某个可感知的物理事实）：
       · rainAmount 0     —— 雨已经停了。这是"雨后"与"雨中"的唯一硬区别。
       · wetness 0.85      —— 地面/瓦/石/叶全是湿的 ⇒ 出现反光，亮得起来。
                              （这是"亮得反光"的来源，比调曝光物理。）
       · fogMul 1.08 + fogGray 0.05 —— **薄**水汽（2026-09-30 二轮实测后大幅调低）：
                              第一版给了 fogMul 1.35 / fogGray 0.10，画面亮度是够的
                              （实测 147 比晴天 141 还亮），但**老黄反馈"没有阳光"** ——
                              真因是这层雾把**方向感**洗掉了：整园蒙一层均匀亮雾
                              ⇒ 读作"阴天/薄雾"而不是"雨后太阳出来了"。
                              水汽要"薄"就得几乎不遮，现在只留一点点湿润感。
       · cloudAmount 0.42  —— 雨后的典型天：还有残余的云（彩虹要靠云作背景才读得出来），
                              但已是碎云，太阳大部分露在外面。
       · sunMul 0.95       —— 太阳出来了（2026-09-30 二轮 0.78 → 0.95）：直射接近晴天，
                              阴影方向明确，地面才有"被太阳照亮"的感觉。
                              不给满 1.0 是因为刚下过雨、地面反光强，直射过满会曝成死白。
       · diskFade 0.02     —— **日轮清晰可见**（2026-09-30 二轮 0.15 → 0.02）：
                              0.15 等于把太阳抹掉 85%，天上根本没有太阳，"没有阳光"。
       · satMul 1.06 / expMul 1.02 —— "草和树绿得发亮"：饱和与曝光都抬一点，
                              配合 wetness 的反光 = 洗过的绿。
       · shadowK 1.00      —— 有太阳就有影子（阴霾/雾是 0；这里必须 1，
                              否则"太阳出来了"在画面上读不出来）。
       · windMul 0.75      —— 雨后风小（暴雨 4.00）；只留一点微风让叶还在动。
       · rainbow:1.0       —— 本预设独有：七色彩虹（见 skyMesh 着色器与 applyEnv）。
     ⚠️ 预设必须写全所有键：mixInto 在 undefined 上做算术，缺键会算出 NaN
        （见本表上方的说明）。 */
  afterrain: { weatherLabel:'雨后初晴', blizzard:0, rainbow:1.0,
    sunMul:0.95, ambMul:1.00, hemiMul:1.04, fogMul:1.08, satMul:1.06, expMul:1.02, shadowK:1.00,
    cloudAmount:0.42, skyGray:0.06, fogGray:0.05, diskFade:0.02,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.85,
    windMul:0.75, gustMul:0.55, moonVis:0.00, snowTint:0xF2F6FA },
  /* 2026-09-28 老黄："阴霾暗沉和薄雾烟霭感官上太一致，保留薄雾" —— 从菜单/键盘/
     随机池收起（hidden）；预设数据保留（mist-guard 仍直调 setEnv 测雾管线），恢复只需去掉 hidden。 */
  overcast: { weatherLabel:'阴霾暗沉', blizzard:0, hidden: true,
    sunMul:0.55, ambMul:0.95, hemiMul:0.96, fogMul:1.55, satMul:0.72, expMul:0.98, shadowK:0.00,
    cloudAmount:1.00, skyGray:0.72, fogGray:0.62, diskFade:1.00,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.0,
    windMul:1.15, gustMul:1.00, moonVis:0.00, snowTint:0xF2F6FA },   // 阴霾：云底满天，看不见月
  /* ⚠️⚠️ 2026-10-06（老黄："冬季'银装素裹'场景主堂和树木都还有明显的影子，一边下雪一边
     还有阳光，我不知道这个是否合理"）：**不合理，已改**。判据是这组参数自己就矛盾 ——
       · snowAmount 1.0 + cloudAmount 0.94 = **正在下大雪、云量 94%**（不是"雪后初晴"），
         而且 diskFade 0.90 已经把日轮藏掉九成；
       · 却给 sunMul 0.62（强直射）⇒ 满云天下打出一排**硬影子**，正是 2026-09-28 老黄否掉
         阴霾/薄雾影子时说的那句"与现实场景不相符"（shadowK 的机制与那条口径见 11-loop）。
     ⇒ sunMul 0.62→0.45、shadowK 1.00→**0.00**（雪天是漫射光，没有方向性硬影），
     ambMul/hemiMul 略抬（1.10/1.12 → 1.18/1.20）把"雪地反光"的亮堂补回来 ——
     "银装素裹"的亮来自**地面反照**，不来自太阳直射。注释里原来的"雪霁：云缝里透一点月色"
     与 snowAmount 1.0 本就是矛盾的描述，一并改正。 */
  snow: { weatherLabel:'银装素裹', blizzard:0,
    sunMul:0.45, ambMul:1.18, hemiMul:1.20, fogMul:1.30, satMul:0.80, expMul:1.00, shadowK:0.00,
    cloudAmount:0.94, skyGray:0.60, fogGray:0.55, diskFade:0.90,
    rainAmount:0.0, snowAmount:1.0, snowCover:1.0, wetness:0.0,
    windMul:1.35, gustMul:1.00, moonVis:0.12, snowTint:0xF4F8FF },   // 雪天：漫射光 + 雪地反照
  /* 薄雾烟霭：全季节合法。它不是"阴"—— 雾的本质是**雾本身变厚**（fogMul 1.3：
     正午 0.0052×1.3≈0.0068，晨间 0.0088×1.3≈0.011），天空只轻度去色、日轮留一个
     淡淡的白色圆盘（diskFade 0.7），湿气贴地（wetness 0.25）。
     ⚠️ 浓度调过四档：4.4 → 2.7 → 1.7 → 1.3。用户实测视角是**晨时**（晨的雾基数本来
     就是正午的 1.7 倍）：1.7 时主厅立面仍被洗成灰白（40m 处雾覆盖 30%）。
     量过关键段：1.3 时主厅段 ≈20%、60m ≈28%、远山 120m ≈50%、200m ≈75% ——
     "近清远朦"的灰阶阶梯成立，雾只剩三个职责：吞远山、压低日轮、中景蒙纱。
     ── 2026-09-28 活雾批次：1.3 → 1.8（老黄："雾气再浓一些"）。1.8 只是**底**，
     真正的浓淡由 ENV_TIME 的 mistMul 随时辰调制（晨 1.45 / 午 0.82 / 暮 1.30 /
     夜 0.72）：晨有效 2.61 正是老黄要的"整个正堂雾蒙蒙"（正堂前另有雾团半遮半掩，
     见 06 的 FOG_BANKS）；夜有效 1.8×0.72≈1.30 与旧版持平，night+mist 水位不动。 */
  mist: { weatherLabel:'薄雾烟霭', blizzard:0,
    sunMul:0.85, ambMul:1.05, hemiMul:1.08, fogMul:1.80, satMul:0.96, expMul:1.02, shadowK:0.00,
    cloudAmount:0.30, skyGray:0.22, fogGray:0.26, diskFade:0.70,
    rainAmount:0.0, snowAmount:0.0, snowCover:0.0, wetness:0.25,
    windMul:1.00, gustMul:0.60, moonVis:0.30, snowTint:0xF2F6FA },   // 薄雾：月色被雾纱吃掉了七成
  /* ══ 电闪雷鸣（2026-09-30 · 老黄需求）════════════════════════════════════
     ⚠️ 2026-09-30 当晚合并进「狂风暴雨」：老黄"这两个场景可以合并，空出一个格子"。
        这个预设的观感（压到暮色之下）**原样保留在表里、标 hidden**：菜单/键盘/
        随机池都不再出现，但直接 setEnv('weather','thunder') 仍可用（thunder-guard
        门禁就靠这条路径复测闪电机制；LN_ALLOWED 里也还留着 'thunder'）。
        暴雨自己也会打闪电 ⇒ 机制两条路径都能验。
     下面这段注释描述的是它当初的取值逻辑（改暴雨时一并参考）：
     "把整个光线全部暗下来，达到或者接近暮色的光影效果" —— 只负责**暗**：
     直射几乎全关（sunMul 0.05）、环境/天光压到一半（0.47/0.50）、曝光压到 0.68、
     天空往深灰拉（skyGray 0.86 ⇒ 乌云压顶）、雨量满、地面全湿、风大。
     闪电（分叉雷电 + 亮痕 + 全场照亮 + 天幕泛白）与雷鸣由 tickLightning 叠加，
     不写在这里 —— 它们是把光照**乘**一个瞬时系数，天气表管不了"阵发"。
     ⚠️ moonVis 0（乌云压顶看不见月）、shadowK 0（没有直射就没有影子）。

     ── 曝光 0.86 → 0.76 → 0.68（2026-09-30，实测定的，不是估的）──
     `probe/thunder-guard.mjs` 同机位（夏·正午）冻结帧量平均亮度：
       晴 142.1 / 暴雨 133.7 / **电闪雷鸣** / **暮色(晴)** —— 三档实测：
       0.86 ⇒ 雷电 111.1 vs 暮色 97.6（亮 14%，多模态读成"大白天阴雨"）；
       0.76 ⇒ 雷电 103.0 vs 暮色 97.2（亮 6%，**判据贴边**，只剩 1.8 余量）；
       0.68 ⇒ 回到暮色之下（判据留 9 余量）。
     结论：只靠 skyGray 压不暗 —— grayMix 的靶色是固定的中灰
     （SKY_GRAY 0x8E949C / FOG_GRAY 0x9AA0A6），0.86 已接近它的极限；
     真正能"把整个光线全部暗下来"的是曝光。
     ⚠️ 判据那条（thunder 平均亮度 ≤ 暮色 + 4）**不许为了让门变绿而放宽** ——
     它是老黄那句"接近暮色"的可测形式；要动就动预设。
     ⚠️ hidden:true 只是**不进随机池**（randomScene 的 !hidden 过滤；R_W_BASE 里也没有它），
     按钮与键盘 H 照常 —— 老黄要的是"一个可选的场景"。随机撞进雷雨时音景多半没开
     （音频必须由用户手势才能起），会变成"闪电没雷声"的半成品。 */
  thunder: { weatherLabel:'电闪雷鸣', blizzard:0, hidden: true,
    sunMul:0.05, ambMul:0.47, hemiMul:0.50, fogMul:1.80, satMul:0.82, expMul:0.68, shadowK:0.00,
    cloudAmount:1.00, skyGray:0.86, fogGray:0.42, diskFade:1.00,
    rainAmount:1.0, snowAmount:0.0, snowCover:0.0, wetness:1.0,
    windMul:3.60, gustMul:0.30, moonVis:0.00, snowTint:0xF2F6FA },
};
/* ══ 新增两种江南天气（2026-10-30 · 审查 B3/S2）══════════════════════════════════
   全部**复用**现有雨雪粒子与雾参数组合，不新增资产：
   · drizzle「细雨」—— 一个预设、按日期换名换性格（drizzleKind，见 12g）：
       梅雨（6中~7上）：绵密细雨、低对比、湿雾、无风、不打雷 —— 江南园林最典型的一景；
       春雨：比梅雨轻、雾薄、色仍鲜；冬季冷雨：更暗更冷、风略大（苏州冬天降水以阴冷小雨为主）。
     rainAmount 只给 0.38（雨"量"小 ⇒ 湿地、涟漪、雨声都是小雨的档），粒子的"密"走 rainDensity
     （同屏粒子数）、"细"走 rainFine（粒子更小、落得更慢），见 12e updatePrecip。
     ⚠️ 不进 LN_ALLOWED（12b）：细雨不打闪电；shadowK 0（满天云的漫射光，无硬影）。
   · snowclear「雪霁」—— 雪停、天晴、积雪还在：snowCover 1 / snowAmount 0，云量 0.2、
     雾压到 0.72（空气被雪洗过，通透），直射回来 ⇒ 有影子；仅冬季可用。
   conMul 是新加的对比度乘子（缺省 1）：梅雨的"低对比"靠它，不靠压曝光把画面闷黑。 */
ENV_WEATHER.drizzle = { weatherLabel:'细雨霏霏', blizzard:0, conMul:0.72, rainFine:1.0, rainDensity:0.85,
  sunMul:0.22, ambMul:1.00, hemiMul:1.04, fogMul:1.60, satMul:0.86, expMul:0.98, shadowK:0.00,
  cloudAmount:1.00, skyGray:0.66, fogGray:0.48, diskFade:1.00,
  rainAmount:0.38, snowAmount:0.0, snowCover:0.0, wetness:0.90,
  windMul:0.70, gustMul:0.40, moonVis:0.00, snowTint:0xF2F6FA };
ENV_WEATHER.snowclear = { weatherLabel:'雪霁初晴', blizzard:0, conMul:1.04,
  sunMul:0.95, ambMul:1.12, hemiMul:1.14, fogMul:0.72, satMul:0.94, expMul:1.00, shadowK:1.00,
  cloudAmount:0.20, skyGray:0.02, fogGray:0.04, diskFade:0.00,
  rainAmount:0.0, snowAmount:0.0, snowCover:1.0, wetness:0.15,
  windMul:0.55, gustMul:0.50, moonVis:1.00, snowTint:0xF6F9FF };
/* 细雨按日期的三种性格：在 drizzle 基础值上**再乘 / 再取**，不另开预设（同 winterrain 的"换性格不换预设"）。 */
const DRIZZLE_KIND = {
  meiyu:  { fog:1.00, sat:1.00, exp:1.00, con:1.00, wind:1.00, rain:1.00, dens:1.00 },
  spring: { fog:0.78, sat:1.10, exp:1.02, con:1.12, wind:0.90, rain:0.80, dens:0.80 },
  summer: { fog:0.85, sat:1.04, exp:1.01, con:1.08, wind:1.00, rain:0.90, dens:0.90 },
  autumn: { fog:0.92, sat:0.96, exp:0.99, con:1.05, wind:1.20, rain:0.95, dens:0.90 },
  winter: { fog:0.95, sat:0.80, exp:0.92, con:1.04, wind:1.50, rain:1.15, dens:0.80 },
};
/* 互斥矩阵 —— 唯一权威在这里。
   · 银装素裹、雪霁仅冬季（其余季节按钮置灰，悬停给出原因）
   · 冬季禁用狂风暴雨；非法天气由状态机回退到风和日丽。
   返回 null 表示该组合合法。 */
const WEATHER_RULES = {
  snow: s => s === 'winter' ? null : '仅冬季可用',
  /* ⚠️ 2026-10-06 老黄："冬季多一个'银装素裹'场景就少一个'狂风暴雨'吧，这样逻辑上才站得住"
     ⇒ 冬季禁用「狂风暴雨」（原来它在冬天会降级成"狂风细雨"，与"银装素裹"摆在一起逻辑别扭）。
     与 snow 走**同一套互斥框架**：按钮置灰 + tooltip 给原因；键盘/控制台/外部脚本调 setEnv 时
     由 enforceWeather() 兜底降级回风和日丽（UI 置灰只是提示、不是保证 —— 那条注释就在下面）。 */
  storm: s => s === 'winter' ? '冬季请用「银装素裹」' : null,
  /* 雪霁 = 雪后放晴、积雪仍在 ⇒ 与银装素裹同一条：仅冬季。细雨四季皆可（按日期叫梅雨 / 春雨 / 冷雨）。 */
  snowclear: s => s === 'winter' ? null : '仅冬季可用（雪后初晴）',
};
export function weatherMutexReason(weather, season){
  const r = WEATHER_RULES[weather];
  const why = r ? r(season) : null;
  return why || null;
}
/* 实际落到画面的天气效果：风雪 = 暴雨的强度 + 雪的存在形式 */
/* 只有标签需要随季节改写：天气是 storm，但冬季画面上是风雪。
   snowAmount 等参数由 applyWeatherTo 的 blizzard 分支负责，不在这里改。 */
function weatherLabelOf(weather, season){
  // 冬 + 暴风 = 狂风细雨：冬天下暴雨是个伪命题，画面该是"风大、雨细、天暗、地湿"的凄凉感
  if (weather === 'storm' && season === 'winter') return '狂风细雨';
  if (weather === 'drizzle') return drizzleLabel(envDoy());   // 梅雨 / 春雨 / 冷雨 …… 按日期叫
  return (ENV_WEATHER[weather] || ENV_WEATHER.clear).weatherLabel;
}
export function weatherTag(){
  // 一律读解析后的值：冬季暴雨的天气轴是 storm，但画面上是风雪，不该显示"狂风暴雨"
  const p = ENV.cur && ENV.cur.weatherLabel;
  return p || weatherLabelOf(ENV.weather, ENV.season);
}
export function effectiveWeather(){
  if (ENV.weather === 'storm' && ENV.season === 'winter') return 'winterrain';
  return ENV.weather;
}

/* ── 天气参数叠加 ──
   在「时段 × 季节」之后叠第三层。与季节同构：乘性修正打底，专属通道只在该预设出现时写入。
   skyGray / fogGray 是把天空与雾往一个中性灰上拉 —— 「阴」这件事本质上是**去色 + 去直射光**，
   而不是单纯压暗，所以做成混色而不是乘一个系数。 */
const SKY_GRAY  = new THREE.Color(0x8E949C);
const FOG_GRAY  = new THREE.Color(0x9AA0A6);
/* ⚠️ 2026-10-06 新增：暴雨/风雪的**云色**与**白底天空**。
   老黄："狂风暴雨场景天空还是蓝天白云，这个好像有点不合理，建议改为**白底天空，乌云密布**，
   亮度可以再降一点"。三件一起做：
     · 云底压得低、受光极少 ⇒ 用 CLOUD_GRAY（明显比天空灰更暗、近中性）当 uCloudTint，
       在天空 shader 的 `col = mix(col, uCloudTint, cloudCover)` 里把满云盖读成"乌云压顶"；
     · 天空本体往 **SKY_OVERCAST（浅灰白）**拉，而不是往 SKY_GRAY（中灰）拉 ——
       往中灰拉会把"白底"变成"阴天灰幕"，实测天带平均 RGB 掉到 138,154,171 且偏蓝，
       不是老黄要的"白底 + 乌云"；
     · 亮度由 exposure ×0.92 降（不改 ambMul/hemiMul —— 2026-09-29 老黄专门要过
       "暴雨别闷成脏灰"，靠天光照亮园子那条不能被压回去）。 */
const CLOUD_GRAY    = new THREE.Color(0x5C6066);
const SKY_OVERCAST  = new THREE.Color(0xC2C5C8);
/* 线性 luma —— 与 02-scene 的 `lumOf` **同式**（颜色管理开着时 `.r/.g/.b` 已是线性值）。
   本文件只用它回答一个问题：**去色之前的天空有多亮**（见 overcast 分支的夜段阻尼）。 */
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/* 去色前的基础天空亮于此 ⇒ 灰化全量（白天/晨/暮，暴雨照旧"白底"）。
   夜段 `ENV_TIME.night` 的 skyTop/skyHorizon 线性 luma 平均 ≈0.018 ⇒ 阻尼系数 ≈0.36，
   把 storm 的 skyGray 0.86 压到 ≈0.31（`night+storm` 的 hillDim 回到 ≈0.27）。
   ⚠️ 这是**连续量**，不是"几点算夜"的硬判据 —— 时辰本就连续插值，晨/暮自然过渡。 */
const SKY_GRAY_FULL_LUM = 0.05;
function grayMix(col, gray, amount){
  if (amount <= 0) return;
  col.r += (gray.r - col.r) * amount;
  col.g += (gray.g - col.g) * amount;
  col.b += (gray.b - col.b) * amount;
}
function applyWeatherTo(p, eff){
  const w = ENV_WEATHER[ENV.weather] || ENV_WEATHER.clear;
  p.sunIntensity  *= w.sunMul;
  p.ambIntensity  *= w.ambMul;
  p.hemiIntensity *= w.hemiMul;
  p.fogDensity    *= w.fogMul;
  p.exposure      *= w.expMul;
  p.grade.saturation *= w.satMul;
  /* 对比度乘子（2026-10-30，梅雨"低对比"用）：缺键兜底 1 ⇒ 旧天气一字不变。 */
  p.grade.contrast *= (w.conMul === undefined ? 1 : w.conMul);
  /* 雨的"细"与"密"（12e 消费）：缺键时 rainDensity 跟 rainAmount 走、rainFine 为 0 ⇒ 暴雨照旧。
     ⚠️ 两个键**每个天气都写**：mixInto 只遍历 from 的键，缺键就插不出过渡（会 NaN）。 */
  p.rainFine    = (w.rainFine === undefined ? 0 : w.rainFine);
  p.rainDensity = (w.rainDensity === undefined ? w.rainAmount : w.rainDensity);
  p.cloudAmount = (w.cloudAmount === null) ? p.cloudAmount : w.cloudAmount;
  p.rainAmount = w.rainAmount; p.snowAmount = w.snowAmount;
  p.snowCover  = w.snowCover;  p.wetness    = w.wetness;
  p.windMul    = w.windMul;    p.gustMul    = w.gustMul;
  /* 月：预设里给的是"天气允许度"，乘到时段基准上（时段基准恒为 1，见 paramsAtHour）。
     ⚠️ 两侧都要兜底：resolveEnv 在 ENV.hour 未定义时会走 makeParams(ENV_TIME[...])
     那条路，那份对象里没有 moonVis —— 不兜底就是 undefined → NaN 传进 uniform。 */
  p.moonVis = (p.moonVis === undefined ? 1 : p.moonVis) * (w.moonVis === undefined ? 1 : w.moonVis);
  /* 影子强度随天气（2026-09-28 用户："阴霾和薄雾不该有影子"，见表头 shadowK 注释）：
     直取天气预设值、缺键兜底 1。进了参数集 ⇒ mixInto 随天气切换逐帧缓动。 */
  p.shadowK = (w.shadowK === undefined ? 1 : w.shadowK);
  /* 七色彩虹（2026-09-30 雨后初晴）：只有该预设给 1，其余全部 0（缺键兜底 0，
     不能兜底成 1 —— 否则每个天气都会挂一道虹）。同样进参数集 ⇒ 切天气时
     随 mixInto 淡入淡出，不"啪"一下出现。 */
  p.rainbow = (w.rainbow === undefined ? 0 : w.rainbow);
  /* ── 活雾（2026-09-28 老黄设计："半遮半掩"随辰换景）──
     雾的"性格"跟一天时辰走：晨浓裹正堂、午间散开、午后复起遮竹林、夜里收平。
     三个键来自 ENV_TIME 时段预设（paramsAtHour 沿时辰连续插值），**只在 mist 天气
     生效**：mistMul 再乘雾密度（底 1.8 × 时辰档 0.72~1.45）；bankHall / bankBamboo
     是两团"半遮半掩"雾团的淡入值（0=全无，两团在 06 的 FOG_BANKS）。非雾天一律
     归 0 —— 晴/雨/雪的雾浓度不因 mistMul 变化。 */
  if (ENV.weather === 'mist'){
    p.fogDensity *= (p.mistMul === undefined ? 1 : p.mistMul);
    p.bankHall   = (p.bankHall === undefined ? 0 : p.bankHall);
    p.bankBamboo = (p.bankBamboo === undefined ? 0 : p.bankBamboo);
    p.bankBridge = (p.bankBridge === undefined ? 0 : p.bankBridge);
    p.bankRockery= (p.bankRockery === undefined ? 0 : p.bankRockery);
    p.bankPond   = (p.bankPond === undefined ? 0 : p.bankPond);
  } else {
    p.bankHall = 0; p.bankBamboo = 0; p.bankBridge = 0; p.bankRockery = 0;
    /* 池面晨雾例外（2026-11-22 · 美术批次 #16）：别的团是"雾天才有"，
       池上辐射雾晴晨也有 —— 留三成（×0.3），正午 preset 本来就 ~0 不怕穿帮。
       雨天雨幕会把它洗掉：rainAmount>0.5 时再压半。 */
    p.bankPond = (p.bankPond === undefined ? 0 : p.bankPond) * 0.3
              * ((w.rainAmount || 0) > 0.5 ? 0.5 : 1);
  }
  p.skyGray    = w.skyGray;    p.fogGray    = w.fogGray;  p.diskFade = w.diskFade;
  /* ⚠️⚠️ 2026-10-06「狂风暴雨的天空还是蓝天白云」（老黄反馈）：
     真因 = **云的底色没跟着天气走** —— uCloudTint 一直取的是 ENV_TIME 的 cloudTint
     （晨 0xFBF3E8 暖白 / 午 纯白），暴雨只是把天空本身往中灰拉（旧 skyGray 0.55）。
     于是画面读作"阳光下的白云 + 一层灰雾"，而不是"乌云压顶"。
     ⇒ 暴雨/风雪一律换成**暗云色**（下面的 CLOUD_GRAY），并把天空灰度抬到 0.80
     （新鲜白底、云压得很低）；曝光再降 8%（老黄："亮度可以再降一点"）。
     ⚠️ 只动这三个量，不动 ambMul/hemiMul/fogMul —— 2026-09-29 老黄专门要过"暴雨别闷成脏灰"，
     靠天光照亮园子那条不能被这次回调压回去。 */
  if (eff === 'storm' || eff === 'winterrain'){
    p.cloudTint = CLOUD_GRAY.clone();
    p.skyGray = Math.max(p.skyGray, 0.80);
    p.exposure *= 0.92;
    /* ── 雨天湿光（2026-11-21 · 美术批次 #6）───────────────────────────────
       暴雨与晴天此前只差"雨丝+暗光"，湿地面/瓦面那层镜面反光没有视觉上的
       "湿光感" —— 湿反光该在 bloom 里晕开（水面/石面高光拖出柔和光斑），
       这是"刚下大雨"的标志性视觉语言，灯会分支（applyFestivalTo）同款手法：
       bloom 抬一档但封顶 0.62，阈值不动 ⇒ 不炸死白；同时把对比压一档
       （雨幕是散射介质，近远对比被拉近——"闷"是对的，旧值对比满档显得"雨里通透"）。 */
    p.bloomStrength = Math.min(0.62, p.bloomStrength * 1.18);
    p.grade.contrast *= 0.82;
  }
  const overcast = (eff === 'storm' || eff === 'winterrain');
  p.weatherLabel = weatherLabelOf(ENV.weather, ENV.season);
  p.blizzard = w.blizzard || 0;          // 供统计栏/调试判断"这是不是风雪"，不参与插值
  p.snowTint = new THREE.Color(w.snowTint);
  if (eff === 'winterrain'){
    /* 冬季暴雨 = 风雪。这里以前是错的：把 snowAmount/snowCover/cloudAmount/skyGray/diskFade
       全部硬编码，等于把 storm 剩下的部分**退化成 snow 预设**，再叠上 storm 的光照系数。
       结果"冬季狂风暴雨"和"银装素裹"只差一点风、一点雾 —— 用户一眼就看出来了。
       正确做法是**换相态，不换性格**：雨→雪，但暴雨该有的强降水与狂风全部保留。 */
    /* 相态**保持液态**：冬 + 暴雨 = 狂风细雨。原来这里是"换相态成风雪"，
       用户判为"伪命题"—— 冬天下暴雨本来就该是凄凉的冷雨，不该变成暴风雪。
       强风/暗光/厚雾全部保留（那是暴风的性格），只把降水改成细雨、并且不积雪。 */
    p.rainAmount = 0.62;                 // 细雨：比夏天暴雨（1.0）细，但仍是持续降水
    p.snowAmount = 0.0;
    p.snowCover  = 0.0;                  // 湿冷的地面，而不是积雪
    p.cloudAmount = 1.0;
    p.skyGray = Math.max(p.skyGray, 0.72);
    p.fogGray = Math.max(p.fogGray, 0.45);
    p.diskFade = 1.0;
    p.exposure *= 0.90;                  // 比夏雨再暗一点，压出冬天的阴沉
    // windMul / gustMul / sunIntensity / fogDensity 一律沿用 storm 自己的值，不再覆盖
  }
  if (eff === 'snow'){
    p.snowAmount = 1.0; p.snowCover = 1.0; p.rainAmount = 0.0;
  }
  let kFog = 1;
  if (eff === 'drizzle'){
    /* 细雨按日期换性格（梅雨 / 春雨 / 冷雨……，表在 DRIZZLE_KIND）：只乘不覆盖，过渡照样连续。 */
    const k = DRIZZLE_KIND[drizzleKind(envDoy())] || DRIZZLE_KIND.meiyu;
    p.fogDensity *= k.fog; p.grade.saturation *= k.sat; p.exposure *= k.exp;
    p.grade.contrast *= k.con; p.windMul *= k.wind;
    p.rainAmount *= k.rain; p.rainDensity = Math.min(1, p.rainDensity * k.dens);
    kFog = k.fog;
  }
  /* 天气侧的空气含水量 humidW（2026-11-24 · 批次 2 · B，见文件末 airHumidity）：
     **从本预设已标定的雾倍率反推**，不另立一张手填表 —— 这样它与 fogMul 严格同序
     （薄雾 1.8 > 暴雨 1.7 > 细雨 1.6 > 阴 1.55 > 雪 1.3 > 雨后 1.08 > 晴 1 > 雪霁 0.72），
     画面读起来不会"雾说潮、山说干"。⚠️ 不掺 wetness：雨后初晴是"空气被雨洗过、地面湿"，
     地湿不等于空气湿（掺进来 雨后 0.34→0.43，远山谷雾比它自己的雾倍率 1.08 浓一截）；
     "刚停雨那几分钟空气还潮"由余韵增量 wetExcess 负责。
     晴 = 0.30 = HUMID_DEFAULT（默认画面零偏差的锚点）。每个天气都写 ⇒ mixInto 可插值。 */
  p.humidW = Math.max(0, Math.min(1, 0.30 + 0.5 * (w.fogMul * kFog - 1)));
  /* ⚠️⚠️ 2026-10-12 · **夜段阻尼**（只作用于 overcast 分支）：
     上面 2026-10-06 那次「白底 + 乌云密布」是为**白天**暴雨做的（旧病是"暴雨天还像蓝天白云"），
     但天空去色**不分时段** —— 夜暴雨天也被 0.86 拉向浅灰白，于是 12-env 的
     `hillAmb = clamp(curLum/ENV_BAKE_LUM, 0.06, 1.0)`（curLum 正是 skyTop/skyHorizon 的均值，
     见 12-env.js:207/220）跟着抬到 0.71，**远山在夜里发亮** —— mist-guard 实测
     night+storm 的 hillDim 由 0.2696 漂到 0.7134。
     修法：按**基础天空自身的亮度**回收去色量 —— 天空亮则全量（白天暴雨观感一字不动），
     天空暗则按比例少推。不新开"现在几点"的时段判据源，也不动 hour 的连续语义。 */
  if (overcast){
    const baseSky = (lum(p.skyTop) + lum(p.skyHorizon)) * 0.5;   // 去色**之前**的天色
    p.skyGray *= Math.min(1, baseSky / SKY_GRAY_FULL_LUM);
  }
  /* 天空去色：暴雨/风雪往**浅灰白**拉（"白底天空 + 乌云密布"），其余天气照旧往中灰拉。 */
  const skyTarget = overcast ? SKY_OVERCAST : SKY_GRAY;
  grayMix(p.skyTop,     skyTarget, p.skyGray);
  /* 中段也得跟着去色，否则阴雨天地平线和天顶都灰了、腰上还横着一条彩色残带 */
  if (p.skyMid) grayMix(p.skyMid, skyTarget, p.skyGray * 0.8);
  grayMix(p.skyHorizon, skyTarget, p.skyGray);
  grayMix(p.fogColor,   FOG_GRAY, p.fogGray);
  return p;
}

export const ENV_TIME = {
  morning: { label:'晨',
    sunColor:0xFFD2A0, sunIntensity:1.05, sunPos:[58, 20, 26],
    ambColor:0x9CB0C6, ambIntensity:0.58,
    hemiSky:0xD8E4F0, hemiGround:0x6E7A50, hemiIntensity:0.42,
    fillColor:0xBCCFE0, fillIntensity:0.40,
    /* F4 二轮校准：旧 mid #E4D6C6 是暖米色，新渐变在低视角（hh≈0.14）下中腰
       已接管 75% → 整片晨天成奶米色、蓝全丢。中腰改淡蓝灰 #C6D6E2，
       暖色只压地平线一窄条；云量 0.96→0.62 透出天蓝。 */
    skyTop:0x93B0CE, skyMid:0xC6D6E2, skyHorizon:0xF0DFC8, sunDisk:0xFFE7BC,
    cloudTint:0xFBF3E8, cloudAmount:0.62,
    fogColor:0xE6E0D4, fogDensity:0.0088, exposure:1.06,
    bloomStrength:0.36, bloomRadius:0.52, bloomThreshold:1.00, gtaoBlend:0.85,
    grade:{ contrast:0.13, saturation:1.02, split:0.30, vignette:0.38, warm:0xFFF2E0, cool:0xE6EEFF },
    /* 活雾三键（仅 mist 天气生效，见 applyWeatherTo）：晨 = 大雾裹正堂 ——
       mistMul 再乘雾密度、正堂雾团最浓、竹林雾团只留一线。 */
    starAmount:0.0, lamp:0.0, mistMul:1.45, bankHall:0.55, bankBamboo:0.12, bankBridge:0.25, bankRockery:0.50, bankPond:0.55,
    /* dawnHumid（2026-11-24 · 批次 2 · B）：晨间辐射雾的空气含水量（只此一档非零），进 airHumidity。
       只喂远山谷雾 / 水面反射这两个没有时段通道的地方 —— 晨雾的雾密度早已在本预设的 fogDensity 里（0.0088 vs 午 0.0052）。 */
    dawnHumid:0.35,
    rainbowMul:1.20 },   // 晨（第八轮）：背景冷、虹本就跳得出，只微抬防"太淡"
  noon: { label:'午',
    /* F8 光照"晴感"再平衡（2026-09-21 · 三张正午样张一致指出"像阴天"）：
       原 sun1.12 / 环境 amb.50+hemi.35+fill.32=1.17 —— 直射仅占 49%，阴影被环境光
       稀释，读起来柔和泛灰、无烈阳感。改 sun 1.22、环境降到 .42+.30+.26=.98：
       总强度 2.29→2.20（微降 4%，亮度基本不变），直射占比 49%→55% ——
       阴影更深、形体更利落，正午才像"晴"。只动 noon，不碰 morning/dusk/night。 */
    sunColor:0xFFF6E2, sunIntensity:1.22, sunPos:[42, 56, 30],
    ambColor:0x8899AA, ambIntensity:0.42,
    hemiSky:0xE8ECEA, hemiGround:0x6B7B52, hemiIntensity:0.30,
    fillColor:0xBCD2E0, fillIntensity:0.26,
    /* F7 二轮：俯视机位可见天空带在 h≈0.50~0.72（horizon→mid 过渡），
       mid #D2DCE4 太淡，整条带读成灰白。mid 换成明确些的天蓝，
       天顶同步加深半档，白墙上方终于"有天"。暮色走自己的暖 mid，不受影响。 */
    /* F7 三轮（实测俯视机位）：画面顶端 hh≈0.14，天空带本该是 mid 天蓝，
       但 cloudAmount 0.88 的近白 FBM 云把它整片盖成灰白 —— 天不蓝、建筑蒙纱。
       云量降到 0.58，mid 加深半档、horizon 染极淡青，曝光回到 1.00，
       grade 对比/饱和微提；草色本来就够艳，不能再猛加饱和。 */
    skyTop:0x8FB2D4, skyMid:0xADCBE6, skyHorizon:0xDCE7EC, sunDisk:0xFFF3D8,
    cloudTint:0xF6F9FC, cloudAmount:0.58,
    /* fogDensity 0.0052（F7 后回归校准）：晴午仍保持四时段里最通透一档；
       薄雾天气 fogMul 1.30 后 =0.0068，正好落进 smoke 断言的 (0.0062,0.0085)
       可读窗口 —— 旧值 0.0046 叠雾只有 0.0060，雾天与晴天拉不开差距。
       ⚠️⚠️ 2026-10-03 V-1：fogColor 0xDCE3E2 → 0xC6CCCB（lum 0.885 → 0.80）。
       上一笔量证锁定"上幅白带"的机制是 **fogColor(0.884) 与 skyHorizon(0.898)
       只差 1.4%**，而 176m 处 Exp2 吃 57% ⇒ 最远层远山被混进一个"与天空同值"的
       颜色，脊线咬不住天（hill-guard 中位 −7.21，加密远山后跌到 −3.43）。
       试过两条路都不通：① applyEnv 里把"雾色≤天光"的钳制扩到全天候 —— 收益 1 lum、
       打破 mist-guard §1 的白天保证（上一笔已回退）；② 压最远层固有色 —— 脊线九成
       是雾色，压 25% 只暗 1.9 lum。
       ⇒ 动**参数本身**而不是加钳制：正午雾色压 10%，远层脊线咬天回到 ~12 lum。
       近园不受影响（20~40m 处雾贡献只有 1~3%，改的是 176m 外那圈）；
       mist-guard §1 断言的是"scene 雾色 = 参数雾色"，两边一起改、判据不受影响。
       与 skyHorizon 的差从 1.4% 拉到 ~10%，"山与天同值"的根源解除。 */
    fogColor:0xC6CCCB, fogDensity:0.0052, exposure:1.00,
    bloomStrength:0.26, bloomRadius:0.50, bloomThreshold:1.02, gtaoBlend:0.85,
    /* vignette 0.50→0.32（2026-11-21 美术批次 #4）：正午光该通透，
       0.50 的暗角把四角压闷——晨午是"看景"，暮夜才是"氛围"。
       暮 0.56/夜 0.55 保持不动。改的只是 preset 数值，运行链路不变。 */
    grade:{ contrast:0.25, saturation:1.12, split:0.24, vignette:0.32, warm:0xFFF6E8, cool:0xE2EEFF },
    /* 2026-09-28 二轮（老黄："中午几乎就没有了，不能没有，只是淡一点"）：mistMul
       0.82→1.10（有效 1.98，晨 2.61 的 ~76%——比晨淡、但明显有雾）；雾团也留三成
       而不是归零（bankHall 0.28 / bankBamboo 0.22）。 */
    starAmount:0.0, lamp:0.0, mistMul:1.10, bankHall:0.28, bankBamboo:0.22, bankBridge:0.15, bankRockery:0.20, dawnHumid:0, bankPond:0.10,
    /* rainbowMul 1.35（第九轮）：正午背景最亮，同一 alpha 下彩带的差分最小 ——
       半透明彩纱化（alpha 0.80→0.66）之后 noon 峰值差实测只有 72/765（门禁线 90），
       正午恰好是老黄最常看效果的时刻 ⇒ 只给正午相对加浓，晨/暮各自的补偿不变。 */
    rainbowMul:1.35 },   // 午：淡一档但仍见雾
  dusk: { label:'暮',
    sunColor:0xFFA45C, sunIntensity:1.00, sunPos:[-56, 15, 30],
    ambColor:0x6E7B96, ambIntensity:0.44,
    hemiSky:0xC6A98E, hemiGround:0x5A5240, hemiIntensity:0.36,
    fillColor:0x8FA8C8, fillIntensity:0.34,
    /* 暮色三停（2026-09-21 走查 F4，二轮按实测俯视机位校准）：默认机位画面顶端
       h≈0.53，可见天幕几乎全是 horizon 区 —— 旧值 #EFB983 芒果橙把整片天染黄，
       0.95 云量的 #F6D4A8 橙云再补一刀。现在 horizon 压成低亮度陶土暖灰 #D0AC86
       （橙味保留、饱和度砍半），中腰换成更中性的灰褐 #BCAEA4，云染成暗暖灰
       #C9B39A（暮色云底本就该比天暗），天顶灰青蓝不变；真正的橙只留在日轮方向。 */
    skyTop:0x6A7A9A, skyMid:0xB4AEAE, skyHorizon:0xC9A072, sunDisk:0xFFC070,
    /* 暮色云量从 0.95 降到 0.50，云染浅暖灰：FBM 云在旧值下几乎铺满可见天幕。
       注意云不能染暗 —— 实测暗云色被 FBM 大软斑铺成"浓烟带"；暮色高空云
       仍被余辉照亮，该比中腰略亮、带一丝暖。 */
    cloudTint:0xC2B6A8, cloudAmount:0.50,
    /* F5（2026-09-21 走查二轮）：雾色去橙改低饱和暖灰，密度基数 0.0074
       （秋 fogMul 1.18 后 ≈0.0087，旧版同组合是 0.0120）—— 远山仍蒙雾，
       但中景不再被整片染暖。 */
    fogColor:0xCEC2B0, fogDensity:0.0074, exposure:1.00,
    bloomStrength:0.46, bloomRadius:0.58, bloomThreshold:0.94, gtaoBlend:0.92,
    /* saturation 1.04→0.97：暮色草地旧值下仍是高饱和翠绿，整体去艳半档，
       让暮色统一在灰暖调里。 */
    grade:{ contrast:0.20, saturation:0.97, split:0.42, vignette:0.56, warm:0xFFE4C0, cool:0xC8D8F0 },
    starAmount:0.0, lamp:0.25, mistMul:1.30, bankHall:0.14, bankBamboo:0.55, bankBridge:0.50, bankRockery:0.30, dawnHumid:0, bankPond:0.22,
    /* rainbowMul（2026-10-02 第八轮）：暮色暖橙天幕会把虹的橙红段"同化"掉
       —— 同样的浓度晨/午一眼可见、暮里却融进余晖（1.45 倍时冻结帧 A/B 仍有
       6064px 差分，但单图判读完全读不出）。暮是雨后彩虹最经典的时刻，抬到 2.2
       ——"夸张感"的来源是弧宽 45°+双道+发光感，这三样第八轮已收掉，
       单纯浓度回补不会回到"夸张"（晨/午不动：它们背景冷、虹本来就跳）。
       夜里 starAmount 门控归零，键只做占位。
       第十轮随 shader（亮度 ×0.95→1.35、alpha 0.66→0.50、弧宽收到 62~118°）
       一并下调到 1.5：虹整体提亮之后暮色不再需要那么高的浓度补偿（2.2 会重新偏艳）。 */
    rainbowMul:1.50 },  // 暮：雾复起，这回沉在竹林
  night: { label:'夜',
    sunColor:0xA8BEE0, sunIntensity:0.38, sunPos:[-34, 52, -22],
    /* 幽而不黑（2026-09-21 方案 n1，两轮收敛）：
       一轮 amb 0.20→0.27/hemi 0.15→0.21/fill 0.12→0.16/exposure 1.05→1.10，
       全景终拍仍是"欠曝的暗"：墙灰闷、游廊内部死黑、石竹沉底。
       二轮加月光方向感（sun 0.26→0.38，让瓦/墙/水面吃得到月光棱线），
       amb/hemi/fill 再抬一档，曝光 1.14、对比 0.15 —— 暗部透气、月光成影，
       而 ambColor 仍是暗蓝（0x2C3852），月夜冷调不破。 */
    ambColor:0x2C3852, ambIntensity:0.33,
    hemiSky:0x2A3A58, hemiGround:0x1A1E18, hemiIntensity:0.26,
    fillColor:0x30405E, fillIntensity:0.19,
    skyTop:0x0B1220, skyMid:0x182336, skyHorizon:0x24304A, sunDisk:0xDCE6F8,
    cloudTint:0x4A5878, cloudAmount:0.55,
    /* 雾 0x141C2A→0x182230：夜雾提一档成蓝灰（lum 0.107→0.129，仍低于
       applyEnv 的雾色上限 0.15），远山不再被纯黑雾吞死。
       exposure 1.05→1.14：ACES 中间调整体抬档 —— 月盘峰值 0.56×1.14≈0.64，
       仍在 bloom 阈值 0.90 之下，不引发月晕复发。 */
    fogColor:0x182230, fogDensity:0.0092, exposure:1.14,
    /* bloom 收敛（2026-09-21 月面对拍像素扫描）：旧 strength 0.62 / radius 0.62
       把月盘（即使压暗后）与灯芯糊成半径百余像素的光团。radius 收到 0.46、
       strength 0.50、threshold 0.90 —— 灯笼芯仍泛暖晕，但不再大面积洗白夜空。 */
    bloomStrength:0.50, bloomRadius:0.46, bloomThreshold:0.90, gtaoBlend:1.00,
    /* contrast 0.22→0.15：S 曲线对暗部的压黑逐轮退档（0.22→0.18→0.15），
       与 amb 提亮配套，暗部层次（墙裙/瓦当/石阶）不再糊死。 */
    grade:{ contrast:0.15, saturation:0.92, split:0.34, vignette:0.55, warm:0xE8D8C0, cool:0x9FB8E0 },
    /* 夜 mistMul 0.72 ⇒ 有效雾系数 1.8×0.72≈1.30，与旧版常数持平：night+mist 的画面
       与 mist-guard 的水位完全不动（夜里不加浓，画面别变脏）。 */
    starAmount:1.0, lamp:1.0, mistMul:0.72, bankHall:0.08, bankBamboo:0.08, bankBridge:0.30, bankRockery:0.08, rainbowMul:1.00, dawnHumid:0, bankPond:0.10 },
};

/* ── 季节预设 ──
   季节只写「与时段无关」的那部分：植被色调 / 存在性 / 动物行为，
   外加少量对时段结果的乘性修正（光强、雾、饱和）。
   植被色调采用「保留明度的换色」（见 addSeasonTint）：tintMix=0 表示完全保留原色。 */
/* ⚠️ 2026-10-30 起，花 / 叶 / 果这些**物候存在性**键（lotusShow / lilyShow / wisteriaShow / lotusBud·Bloom·Pod /
   peach*Show / plumBlossomShow 等）**不再写在季节表里**：它们由 12g-phenology 的按旬花历曲线按
   ENV.doy（季节按钮背后的年内日序）算出，见 composeEnv。旧值（春荷 0.05、秋梅 0.15、夏秋紫藤 1.0/0.35、
   秋桃果 0.7……）正是"反季花事"的来源（审查 B1）。下面各季残留的注释保留作沿革说明。
   季节表仍管：色调、光强/雾/饱和修正、柳竹叶量、芭蕉/苇、动物、陈设（帘/挂画）。 */
export const ENV_SEASON = {
  spring: { label:'春',
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:0.94, satMul:1.03,
    tinGrass:0x9CC85E, tinBamboo:0xAED078, tinLeaf:0x8ECB58, tinReed:0x9CC86A,
    tinWillow:0xB4D47C, tinLily:0x3E7A34, tinLotus:0xF2C7D4, tinWisteria:0x9B6FC4,   // 春：垂柳新芽淡绿（用户常识反馈）
    tinBanana:0x62B054, tinTrunk:0x3B2A1E, tintMix:0.50,
    bananaShow:0.9, reedShow:0.85, willowLeaf:0.38,   // 春：柳帘均匀变疏=新芽初绽（38%+洗牌）
    /* 荷花三态（2026-10-24 · 老黄："没有含苞待放和花谢结蓬的状态，按春夏秋三季合理处理"）：
       春 = 小荷才露尖尖角（花苞为主，零星初绽）｜夏 = 盛花期（盛开为主 + 少量花苞续期）
       ｜秋 = 花事将尽（莲蓬为主 + 零星晚花）｜冬 = 三态全收（残梗也不留，池面交给冬柳倒影）。
       ⚠️ lotusShow 保留（池心程序化荷花/莲蓬仍走它），三键只管池边 12 株三态 GLB。 */
    /* 竹叶季节叶量（2026-09-16 用户："初春先抽竿长叶、夏要茂密"）——
       系数×基数（12~21 片/枝）＝绝对量。夏 1.0 ≈ 4.2 万片（茂密）；
       春 0.28 ≈ 1.2 万片（初春抽竿后刚长叶，绝对量与旧版春一致）；
       秋 0.43 ≈ 1.8 万片（微落）；冬 0.33 ≈ 1.4 万片（常绿稍疏） */
    bambooLeaf:0.28, koiSpeed:1.0, dragonflyShow:0.35, turtleShow:1.0, gooseShow:1.0,   // 春：大雁北迁过境
    /* 春：先花后叶。花满树、叶始萌（15% 刚抽的嫩芽），落花初落 —— 桃是先花后叶树种 */
    // 梅：红梅冬末春初还在开，春天留一半
    blindShow:0, scrollCoolShow:1, scrollWarmShow:0 },      // 春：帘未挂；堂内青绿山水
  summer: { label:'夏',
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:1.00, satMul:1.00,
    tinGrass:0xFFFFFF, tinBamboo:0xA8C46A, tinLeaf:0x4E8C36, tinReed:0x3F6B34,
    tinWillow:0x5E9638, tinLily:0x3E7A34, tinLotus:0xF2C7D4, tinWisteria:0x9B6FC4,   // 夏：翠绿繁茂（用户常识反馈）
    tinBanana:0x4F9440, tinTrunk:0x3B2A1E, tintMix:0.0,
    bananaShow:1.0, reedShow:1.0, willowLeaf:1.0,
    // 夏：盛花期（三态一次只开一种，靠过渡插值完成"苞→花"）
    bambooLeaf:1.0,
    koiSpeed:1.0, dragonflyShow:1.0, turtleShow:1.0, gooseShow:0.0,   // 夏：无雁（盛夏非迁徙季）
    /* 夏：花落尽、桃结果（叶茂果生，落花也快被扫净只余淡痕） */
    // 梅：夏季无花（骨相仍在）
    blindShow:1, scrollCoolShow:1, scrollWarmShow:0 },  autumn: { label:'秋',   // 夏：帘垂下遮阳
    sunMul:0.97, ambMul:0.95, hemiMul:0.96, fogMul:1.18, satMul:1.06,
    /* 秋竹叶：0xD8A94E（绿度 −47，金黄）→ 0x93A656（绿度 +19，转暗的秋绿）。
       ⚠️ 与冬季同一处数据错误的**遗留副本**：当年只修了竹竿通道 tinBamboo
       （见 winter 段注释），漏了竹叶通道 tinLeaf —— 而竹叶正是画面上竹子的主体。
       竹是**常绿**植物，秋不黄（黄=枯死），秋天该是"比夏暗、比冬绿"的中间档；
       原值把秋竹染成金黄，冬天换回橄榄（+2），于是"秋黄→冬返绿"。
       修完绿度阶梯：夏 +62 → 秋 +19 → 冬 +2，单调下降。 */
    tinGrass:0xC2AE66, tinBamboo:0xBCBE72, tinLeaf:0x93A656, tinReed:0xC4AC6E,
    tinWillow:0xDCAE52, tinLily:0x6E8A3E, tinLotus:0xE0B894, tinWisteria:0xB08858,
    tinBanana:0xA89E54, tinTrunk:0x3B2A1E, tintMix:0.76,
    bananaShow:0.7, reedShow:1.0, willowLeaf:0.72,
    // 秋：花事将尽（莲蓬挂果，花谢）
    bambooLeaf:0.43,
    koiSpeed:1.0, dragonflyShow:0.35, turtleShow:1.0, gooseShow:1.0,   // 秋：大雁南迁过境
    /* 秋：桃叶转黄（tinLeaf）、果渐疏（快被摘/落尽），花/落花早没了 */
    // 梅：深秋只有极少数早花（腊梅含苞）
    blindShow:0.35, scrollCoolShow:0, scrollWarmShow:1 },    // 秋：帘卷起；换秋山
  winter: { label:'冬',
    sunMul:0.88, ambMul:0.93, hemiMul:0.94, fogMul:1.28, satMul:0.70,
    /* ⚠️ 冬季植被色**必须比秋季更灰**，这是之前的数据错误：
       旧值 竹 0x8E9A6E（绿度 +12）vs 秋 0xBCBE72（绿度 +2）——
       冬季的绿分量反而比秋季更高，于是"秋天黄了、冬天又绿回来"。
       柳叶更夸张：秋 0xDCAE52（绿度 −46，明显偏黄）vs 冬 0x828458（绿度 +2，转绿）。
       现在统一压成**低饱和的灰绿／灰黄**（绿度 ≤ 3，亮度维持原量级），
       与冬季 satMul 0.70 的降饱和叠加后是"枯槁"而不是"返青"。 */
    tinGrass:0x8E8874, tinBamboo:0x9C9878, tinLeaf:0x7C7E5E, tinReed:0x958E72,
    tinWillow:0xA08C66, tinLily:0x6A6850, tinLotus:0xAAA096, tinWisteria:0x8A7A68,
    tinBanana:0x9C8A58, tinTrunk:0x4A4038, tintMix:0.72,   // 芭蕉冬色提亮：0x87805A→0x9C8A58（旧色偏暗被环境绿反射洗成橄榄绿，枯黄读不出来）
    // 紫藤花期是开春四五月（见交接文档来源），冬季不该有花；藤枝走 MAT.bark，不受这里影响
    // 冬季水面不留绿：水草(MAT.reed)整片收掉，否则池面在冬天还浮着一簇簇绿草
    bananaShow:0.0, reedShow:0.0, willowLeaf:0.0,
    // 冬：三态全收（枯梗也不留；池面交给冬柳与白雪）
    /* 冬：芭蕉叶幕枯落（多年生草本，假茎宿存——第九轮用户常识反馈）；
       柳叶**掉光**（垂柳是落叶乔木，裸枝过冬——2026-09-19 老黄科学反馈；
       0.02 是旧"变稀"思路残留，164 片残叶肉眼仍读作"挂着"）。 */
    bambooLeaf:0.33,   // 冬：竹常绿但疏（不落叶，只是密度回落）
    koiSpeed:0.42, dragonflyShow:0.0, turtleShow:0.0, gooseShow:0.0,   // 冬：无雁（越冬地不在此）
    /* 冬：桃树落叶，裸枝过冬（同冬柳）——叶落尽、无花无果无落花 */
    /* ⚠️ 梅 = 冬天的**唯一花事**（老黄："给冬天增加一点色彩，特别是'银装素裹'的场景下"）：
       冬 1.0 —— 满树花。这一档是"梅兰竹菊"第一次真正参与画面，别被任何天气通道压掉：
       雪景要显色 ⇒ 梅的花材质不登 SNOW_COVER_MATS（否则会被雪盖成白片）。 */
    blindShow:0, scrollCoolShow:0, scrollWarmShow:1 },       // 冬：帘撤下；堂内雪意
};

/* 预设 → 可插值参数对象 */
function makeParams(src){
  const o = {};
  for (const k in src){
    const v = src[k];
    if (ENV_COLOR_KEYS.indexOf(k) >= 0) o[k] = new THREE.Color(v);
    else if (Array.isArray(v)) o[k] = v.slice();
    else if (k === 'grade') o.grade = { ...v, warm:new THREE.Color(v.warm), cool:new THREE.Color(v.cool) };
    else o[k] = v;
  }
  return o;
}
export function cloneParams(p){
  const o = {};
  for (const k in p){
    const v = p[k];
    if (v && v.isColor) o[k] = v.clone();
    else if (Array.isArray(v)) o[k] = v.slice();
    else if (k === 'grade') o[k] = { ...v, warm:v.warm.clone(), cool:v.cool.clone() };
    else o[k] = v;
  }
  return o;
}
/* 逐通道插值（就地写入 out） */
export function mixInto(out, a, b, t){
  for (const k in a){
    const va = a[k], vb = b[k], o = out[k];
    if (typeof va === 'number') out[k] = va + (vb - va) * t;
    else if (va && va.isColor) o.copy(va).lerp(vb, t);
    else if (Array.isArray(va)) { for (let i = 0; i < va.length; i++) o[i] = va[i] + (vb[i] - va[i]) * t; }
    else if (k === 'grade'){
      for (const gk in va){
        if (typeof va[gk] === 'number') o[gk] = va[gk] + (vb[gk] - va[gk]) * t;
        else if (va[gk] && va[gk].isColor) o[gk].copy(va[gk]).lerp(vb[gk], t);
      }
    }
    else out[k] = vb;                                  // label 之类的字符串直接取目标
  }
}

/* ── 组合规则 ──
   整套系统的核心：三个轴在这里合成，而不是各自直接改渲染对象。
   时段提供「基准」，季节以乘性修正 + 专属通道叠上去；
   天气（2-3 已接入）以同样方式叠第三层：乘性修正 + 专属通道 + 天空/雾去色。
   composeEnv 单独成函数：连续时辰滑杆要用自己的「时段基准」进来叠同一套规则。 */
export function composeEnv(p){
  const s = ENV_SEASON[ENV.season] || ENV_SEASON.summer;       // 季节修正
  // 乘性修正（光强 / 雾 / 饱和）
  p.sunIntensity  *= s.sunMul;
  p.ambIntensity  *= s.ambMul;
  p.hemiIntensity *= s.hemiMul;
  p.fogDensity    *= s.fogMul;
  p.grade.saturation *= s.satMul;
  // 季节专属通道（时段不提供这些键）
  for (const k in s){
    const v = s[k];
    if (k === 'label' || k === 'tintMix') continue;
    if (typeof v === 'number') p[k] = v;
  }
  /* 物候（2026-10-30）：花 / 叶 / 果的存在性按 ENV.doy 在花历曲线上取值（12g），覆盖季节表。
     放在季节通道之后、天气之前：天气不改物候；灯会也不改（它只叠 look 层）。 */
  Object.assign(p, phenoChannels(envDoy()));
  p.tintMix = s.tintMix;
  for (const k of ENV_COLOR_KEYS){
    if (k.indexOf('tin') === 0) p[k] = new THREE.Color(s[k] !== undefined ? s[k] : 0xFFFFFF);
  }
  // 第三层：天气（乘法打底 + 专属通道 + 去色）
  applyWeatherTo(p, effectiveWeather());
  // 第四层：灯会（存在性通道 + 暖光曝光）。festivalShow 两种态都必须写进参数集
  // —— mixInto 只遍历 from 的键，缺键就插不出 0↔1 的缓动。
  p.festivalShow = ENV.festival ? 1 : 0;
  if (ENV.festival) applyFestivalTo(p);
  return p;
}
export function resolveEnv(){
  /* 时段基准统一走 ENV.hour（滑杆的连续时辰）：按钮切时段只是把 hour 对齐到锚点，
     这样"滑杆拖到 15:20 再切季节/天气"不会把时刻拽回整点锚点。 */
  const base = (ENV.hour !== undefined)
    ? baseParamsAt(ENV.hour)
    : makeParams(ENV_TIME[ENV.time] || ENV_TIME.noon);
  return composeEnv(base);
}
/* 时段基准的唯一入口（2026-10-30）：真实太阳（默认）或旧的四锚点插值（?solar=0）。
   12-env 的滑杆 / 流转 / 状态机一律经这里，不再直接调 paramsAtHour。 */
export function baseParamsAt(h){
  return SOLAR.enabled ? paramsAtSolar(h, envDoy(), ENV ? ENV.moonPhase : null) : paramsAtHour(h);
}

/* ══ 时光流转的目标参数：关键帧 + 线性插值（2026-11-24 · 第 5 批 · 慢更新分流）═════════════════════════
   旧：advanceReel 每帧 composeEnv(baseParamsAt(h)) —— 真实太阳 + 三套时段预设 makeParams + 物候 + 天气 + 灯会，
       每帧新建整套参数集（几十个 THREE.Color + 数组），node 实测约 30KB/帧、28µs/帧（probe/perf-sim-bench.mjs）。
   新：每 REEL_KEY_H = 0.05 游戏小时（3 游戏分钟）算一个关键帧，帧间按小时线性插值（mixInto）。
       0.4 时/秒的流转下关键帧间隔 0.125 秒 ≈ 7.5 帧 ⇒ 重合成次数降到约 1/7.5。
   为什么不会有可见阶跃：插值是连续的（关键帧上恰好等于精确值）；3 分钟内太阳只走约 0.75°，
       弦与弧的偏差 ~1e-5 rad，颜色 / 强度按小时的二阶量更小。env-blend-unit 正是按 3 分钟一步断言连续性的，
       关键帧取同一步长 ⇒ 插值后的单帧变化不会大于那张表允许的跳变。
       非数值通道（标签串等）随 mixInto 取下一关键帧的值，最多提前 3 游戏分钟（≈0.45 秒）换。
   立即刷新：合成规则读的轴（季节 / 天气 / 年内日 / 灯会 / 月相 / 真实太阳开关）任一变了，或 h 跳出当前关键帧区间
       （拖滑杆、跨午夜回绕），当帧重算关键帧。
   sample(h) 返回同一个对象（就地改写），调用方不要长期持有它当快照。 */
export const REEL_KEY_H = 0.05;
/* 急变格判据：相邻两关键帧之间任一数值通道变化超过 REEL_RAPID × max(1, |值|)，或日 / 月方向夹角超过
   REEL_DIR_JUMP（月亮过地平线时 MOON_ARC 从落点跳回升点；午夜回绕），这一格退回逐帧精确合成 ——
   线性插值在"快坡 + 拐点"（例：春暴雨 5:04 天空去色 0.43→0.80 只用 4 游戏分钟，到顶后钳平）上会偏离真曲线，
   跳变处会把一次瞬跳摊成扫过天空的 7 帧。门限下的平缓格，插值与精确值之差不超过该格的变化量（≤0.02）。 */
export const REEL_RAPID = 0.02, REEL_DIR_JUMP = 0.1;
function _dirAngle(a, b){
  const la = Math.hypot(a[0], a[1], a[2]) || 1, lb = Math.hypot(b[0], b[1], b[2]) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb))));
}
const _rapid = (x, y) => Math.abs(y - x) > REEL_RAPID * Math.max(1, Math.abs(x), Math.abs(y));
function reelCellRapid(a, b){
  for (const k in a){
    const va = a[k], vb = b[k];
    if (typeof va === 'number'){ if (_rapid(va, vb)) return true; }
    else if (va && va.isColor){ if (_rapid(va.r, vb.r) || _rapid(va.g, vb.g) || _rapid(va.b, vb.b)) return true; }
    else if (Array.isArray(va)){
      if (va.length === 3 && (k === 'sunPos' || k === 'moonPos')){ if (_dirAngle(va, vb) > REEL_DIR_JUMP) return true; }
      else for (let i = 0; i < va.length; i++) if (_rapid(va[i], vb[i])) return true;
    }
    else if (k === 'grade'){
      for (const gk in va){
        const x = va[gk], y = vb[gk];
        if (typeof x === 'number' ? _rapid(x, y) : (x && x.isColor && (_rapid(x.r, y.r) || _rapid(x.g, y.g) || _rapid(x.b, y.b)))) return true;
      }
    }
  }
  return false;
}
export function makeReelSampler(step = REEL_KEY_H){
  let k0 = null, k1 = null, h0 = NaN, out = null, exact = false;
  let sSeason, sWeather, sDoy, sFest, sMoon, sSolar;
  const sigSame = () => ENV.season === sSeason && ENV.weather === sWeather && envDoy() === sDoy
    && !!ENV.festival === sFest && ENV.moonPhase === sMoon && SOLAR.enabled === sSolar;
  const sigTake = () => { sSeason = ENV.season; sWeather = ENV.weather; sDoy = envDoy(); sFest = !!ENV.festival;
                          sMoon = ENV.moonPhase; sSolar = SOLAR.enabled; };
  const at = (h) => composeEnv(baseParamsAt(((h % 24) + 24) % 24));
  /* 跨午夜那一格（右端 ≥24）一律精确：右端取模回 0 点会把午夜那一跳提前摊开 */
  const judge = () => { exact = h0 + step > 24 - 1e-9 || reelCellRapid(k0, k1); if (exact) S.exactCells++; else S.lerpCells++; };
  const S = {
    builds: 0, exactCells: 0, lerpCells: 0,
    reset(){ k0 = k1 = out = null; h0 = NaN; },
    sample(h){
      const base = Math.floor(h / step) * step;
      if (!k0 || !sigSame()){
        sigTake(); h0 = base; k0 = at(h0); k1 = at(h0 + step); out = cloneParams(k0); S.builds += 2; judge();
      } else if (base !== h0){
        if (Math.abs(base - (h0 + step)) < 1e-9){ k0 = k1; h0 = base; k1 = at(h0 + step); S.builds++; }   // 顺流转进下一格：沿用上一格的右端
        else { h0 = base; k0 = at(h0); k1 = at(h0 + step); S.builds += 2; }                                  // 跳格（滑杆 / 午夜回绕）
        judge();
      }
      if (exact){ const t = at(h); S.builds++; mixInto(out, t, t, 1); return out; }
      mixInto(out, k0, k1, Math.min(1, Math.max(0, (h - h0) / step)));
      return out;
    },
  };
  return S;
}

/* ── 连续昼夜（时辰滑杆）──
   四锚点取各时段"性格"的中间时刻：晨 7:30 / 午 12:30 / 暮 17:30 / 夜 21:30。
   夜里 21:30 → 次日 4:30 整段保持深夜（不是匀速往晨过渡——凌晨两点不该"半亮"），
   4:30 → 7:30 才是黎明渐亮。 */
export const TIME_ANCHORS = { morning: 7.5, noon: 12.5, dusk: 17.5, night: 21.5 };
/* ⚠️ 2026-10-30：真实太阳模式下锚点**随季节变**（晨 = 太阳升到 10°、午 = 真太阳正午 + 0.5h、
   暮 = 太阳落到 7°、夜 = 21:30，见 12h timeAnchorsFor）。TIME_ANCHORS 仍是同一个对象、**就地改写**，
   这样 11-loop / 12c 等直接读它的地方不用改。上面那组常数是 ?solar=0 的旧口径。 */
export function syncTimeAnchors(doy){
  if (!SOLAR.enabled) return TIME_ANCHORS;
  Object.assign(TIME_ANCHORS, timeAnchorsFor(doy));
  return TIME_ANCHORS;
}
/* 时段标签（晨/午/暮/夜）：真实太阳模式下由太阳高度决定（12h timeKeyAt），旧模式沿用 nearestTimeKey。 */
export function timeKeyNow(h, doy){
  return SOLAR.enabled ? timeKeyAt(h, doy === undefined ? envDoy() : doy) : nearestTimeKey(h);
}

/* ── 月亮（2026-09-19 老黄："风和日丽的夜里该有月亮，随辰起落"）──
   取**满月**节律：18:00 东方升起 → 24:00 中天 → 06:00 落下，其余时间在地平线下。
   （弯月也留了通道：sky 的 uMoonPhase，改一个数就能换成月牙，见 makeSkyMat 注释。）
   ⚠️ u = ((h-18)+24)%24 的取模不能省：时辰滑杆是 0~24，跨午夜必须绕回，
      否则凌晨 2 点（h=2）算出负的 u，月亮会突然跳到地平线下面去。

   ── 2026-09-22 二轮重定（老黄：夜间 00:00"满天繁星，唯独没有月亮"）──
   ⚠️ 上一版的失败方式值得完整记住：**数字全对，人看不见**。
      月亮仰角算得精确（午夜 38°）、满月节律也对，但默认机位是 (-20,17,32) 朝 -z
      俯视 19.3°（fov 46 → 画面上沿只到 +3.7°、水平半角 37°）。于是月亮整晚待在
      相机**背后或头顶**：00:00 与视线夹角 147°（身后），21:30 仰角 19.5°（画面之上）。
      老黄看到的只有星星——星空铺满整个半球，所以"满天繁星"反而更衬出月亮不在。
   ⇒ 定轨之前先量天：把天空按「世界仰角 × 世界方位角」切格，逐格强制放月亮、
      同帧差分（有月 vs uMoonAmount=0）数**月轮本体**像素（脚本
      outputs/_diag/_moon-sky-map.mjs）。结论是默认机位能看见的只有一条窄带：
      **仰角 -6°~+8°、方位 105°~190°**，仰角 ≥12° 一律在画面上沿之外，
      方位 ≥195° 一律在画面右侧之外；带内 0°~+5° 是"月轮整轮不被山脊/屋脊切"的区间。
   ⇒ 轨道因此重定：方位 110°→180°（月起于东偏北、横穿镜头正对的北半天；110° 与
      "满月东升"的真实方位 ≈118° 也基本对得上），仰角 4.5°·sin(πu/12)：
      峰值刻意压在 4.5°，让**整夜都落在可见带里**，而不是爬上去再飞出画面上沿。
   ⚠️ 峰值一压，applyEnv 的淡出窗口必须跟着压（见 MOON_FADE_HI）：旧窗口上沿 0.155
      相当于 9°，月亮永远到不了那个高度 → 整晚最亮只剩 55%。
   ⚠️ 这是**刻意的"不天文"**：北纬 31° 的真实满月永远中天于南天（az≈0），
      而默认机位朝北。要"数学正确"就必然"人看不见"——选可见。 */
export const MOON_ARC = { az0: 110, az1: 180, peakAlt: 4.5 };
/* 淡出窗口上沿（归一化方向 y）：月亮爬到峰值高度的 ~62% 时亮度吃满 */
export const MOON_FADE_HI = Math.sin(MOON_ARC.peakAlt * Math.PI / 180) * 0.62;
function moonDirAtHour(h, rise = 18){
  /* rise = 月出时刻（2026-10-30 起随月龄后移，见 12h moonRiseHour；缺省 18 = 旧的满月节律）。 */
  const u = (((h - rise) % 24) + 24) % 24;    // 0 = 月出；12 = 月落；>12 在地平线下
  const k = u / 12;
  const az  = (MOON_ARC.az0 + (MOON_ARC.az1 - MOON_ARC.az0) * k) * Math.PI / 180;
  const alt =  MOON_ARC.peakAlt * Math.PI / 180 * Math.sin(Math.PI * k);
  const ca = Math.cos(alt);
  return [Math.sin(az) * ca, Math.sin(alt), Math.cos(az) * ca];
}
function hourSeg(h){
  const hh = (h < 7.5 ? h + 24 : h);              // 夜→晨跨午夜：抬进 [21.5, 31.5)
  if (hh < 12.5) return { a:'morning', b:'noon',    t:(hh - 7.5)  / 5 };
  if (hh < 17.5) return { a:'noon',    b:'dusk',    t:(hh - 12.5) / 5 };
  if (hh < 21.5) return { a:'dusk',    b:'night',   t:(hh - 17.5) / 4 };
  if (hh < 28.5) return { a:'night',   b:'night',   t:0 };
  return           { a:'night',   b:'morning', t:(hh - 28.5) / 3 };
}
export function paramsAtHour(h){
  const seg = hourSeg(h);
  const out = makeParams(ENV_TIME[seg.a]);
  if (seg.t > 0) mixInto(out, out, makeParams(ENV_TIME[seg.b]), Math.min(1, seg.t));
  /* ⚠️ 月亮**不能在时段预设里写死**：那样月亮只会在"切夜"时瞬移一下，拖时辰滑杆它不动
     （老黄要的就是"随着时辰变化慢慢升起又慢慢落下"）。所以由时辰 hour 直接算，
     并且放在 mixInto 之后 —— mixInto 遍历 out 的键，若 ENV_TIME 里没有同名键会算出 NaN。 */
  out.moonPos = moonDirAtHour(h);
  out.moonVis = 1;                       // 天气允许度（1=满月照常），applyWeatherTo 再按天气打折
  /* 与 paramsAtSolar 同一套键（mixInto 只遍历 from 的键 —— 两条路径键集必须一致）：
     旧模式 = 满月、白天度取 1−星量、无"真实太阳"标记。 */
  out.moonAge = 0.5; out.moonIllum = 1; out.dayK = 1 - (out.starAmount || 0); out.solar = 0;
  return out;
}

/* ══ 真实太阳驱动的时段基准（2026-10-30 · 审查 M3 / B2 / S1）════════════════════════════
   旧做法：四个锚点（7:30/12:30/17:30/21:30）之间线性插值 sunPos 与颜色 ⇒
     · 暮→夜的插值让日轮在日落后反而升高、黎明前出现"头顶的太阳"（M3）；
     · 四季共用一组钟点：冬天 17:30 的"暮"其实早已天黑，夏天 17:30 太阳还有 25°（B2）；
     · 正午 sunPos 在东南、仰角 47°，苏州正午的太阳应在正南、夏至约 82°、冬至约 35°。
   现在：太阳方向 = 苏州真实位置（12h solarPos，简化式）；颜色预设按**太阳高度**取锚 ——
     白天度 d = smoothstep(−9°, 4°, 高度)        夜 ↔ 白天（晨昏蒙影这一段是夜色淡出）
     正午度 n = smoothstep(0.30, 0.80, 高度/当天正午高度)   晨/暮 ↔ 午（按比例：冬至正午只有 35°）
     基准 = mix(夜, mix(上午取晨 / 下午取暮, 午, n), d)
   于是日出日落时刻、晨昏长短、正午高度都随季节自动正确，时段钟点不再写死。
   月亮：轨道仍是 MOON_ARC 艺术轨道（默认机位朝北，见上方长注释），月出时刻随**月相**后移；
   月相按日期算（12h moonAge，2027 年），也可由 ENV.moonPhase 指定（0 朔 / 0.5 望）。
   ⚠️ sunPos 写的是**真实**太阳方向（可在地平线下）：天空日轮 / 水面波光 / 彩虹按它画；
      投影主光在 applyEnv 里另做"地平线钳制 + 向夜间方向 / 月亮 slerp"，不会从地底下打光。 */
const SUN_DIST = 72;                       // 与旧 sunPos 同量级（|noon| ≈ 76），阴影拟合不受影响
const DAY_ALT = [-9, 4];                   // 白天度：−9° 已近航海蒙影，4° 太阳已离开山脊
const NOON_FRAC = [0.30, 0.80];            // 正午度：按当天正午高度的比例
export function paramsAtSolar(h, doy, moonAgeOverride = null){
  const { alt } = solarPos(doy, h);
  const st = sunTimes(doy);
  const d = smoothstep(DAY_ALT[0], DAY_ALT[1], alt);
  const n = alt > 0 ? smoothstep(NOON_FRAC[0], NOON_FRAC[1], alt / Math.max(1, st.noonAlt)) : 0;
  const day = makeParams(ENV_TIME[h < st.noon ? 'morning' : 'dusk']);
  if (n > 0) mixInto(day, day, makeParams(ENV_TIME.noon), n);
  const out = makeParams(ENV_TIME.night);
  if (d > 0) mixInto(out, out, day, d);
  const sd = sunDir(doy, h);
  out.sunPos = [sd[0] * SUN_DIST, sd[1] * SUN_DIST, sd[2] * SUN_DIST];
  const age = (typeof moonAgeOverride === 'number' && Number.isFinite(moonAgeOverride))
    ? ((moonAgeOverride % 1) + 1) % 1 : moonAge(doy);
  out.moonPos = moonDirAtHour(h, moonRiseHour(age));
  out.moonVis = 1;
  out.moonAge = age; out.moonIllum = moonIllum(age);
  out.dayK = d; out.solar = 1;
  return out;
}
export function nearestTimeKey(h){
  if (h >= 4.5 && h < 10)   return 'morning';
  if (h >= 10  && h < 15)   return 'noon';
  if (h >= 15  && h < 19.5) return 'dusk';
  return 'night';
}
export function fmtHour(h){
  let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  if (mm === 60){ mm = 0; hh = (hh + 1) % 24; }
  return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
}
/* 标签：滑杆偏离锚点超过一刻钟就显示 HH:MM，正落锚点仍显示 晨/午/暮/夜 */
export function timeLabelNow(){
  const anchor = TIME_ANCHORS[ENV.time] !== undefined ? TIME_ANCHORS[ENV.time] : 12.5;
  let d = Math.abs(ENV.hour - anchor);
  if (d > 12) d = 24 - d;                          // 跨午夜比较
  return d > 0.25 ? fmtHour(ENV.hour) : (ENV_TIME[ENV.time] ? ENV_TIME[ENV.time].label : '午');
}

/* ── 灯会的"look"层（第 4 层）──
   2026-10-05 从 12c-festival.js 挪来这里：它**只改参数集**（乘性/单键修改既有通道 ⇒ 关灯会时
   mixInto 自动把这些键插值回原值，不需要反向代码），是 composeEnv 的最后一步，属于"合成规则"，
   不属于"灯会那套场景装置"。挪过来的好处：12a 不再需要反过来 import 12c（依赖方向保持单向：
   12-env → 12a / 12c / 12d / 12e）。⚠️ 只有 composeEnv 调它，本模块不导出。 */
const _FEST_WARM = new THREE.Color(0xFFC890);
const _FEST_FOG  = new THREE.Color(0x3A2A20);
function applyFestivalTo(p){
  p.exposure *= 1.08;                                   // 暖光曝光提升（计划书原文）
  p.bloomStrength = Math.min(0.68, p.bloomStrength * 1.12);   // 辉光加一档（阈值 0.90 不动 ⇒ 不炸死白）
  p.grade.split = Math.min(0.55, p.grade.split + 0.05);
  p.grade.warm.lerp(_FEST_WARM, 0.55);                  // 高光更暖（灯笼红光弥漫）
  p.fogColor.lerp(_FEST_FOG, 0.45);                     // 夜雾里带一点灯会的暖
}

/* ══ 叠加特效的统一门控（2026-11-23 · 视觉打磨批次 1）════════════════════════════════
   为什么集中到这里：近期十来个特效各自在 12-env / 11-loop / 着色器里拿 ENV.cur 的几个键现算门控，
   互相不知道对方 —— 扫"时段 × 天气 × 季节"全组合（probe/env-blend-unit.mjs，纯 node）查出四处穿帮：
     ① 银河直接吃 uStarAmount = 星量 × (1 − 云量×0.85)：薄雾夜云量 0.30 ⇒ 银河 0.745 满挂在雾里，
        暴雨夜 0.15、雪夜 0.20 也还在（02-scene 的注释写的是"阴/雨/雪=0"，与实际不符）；
     ② 方位余辉 / 云受光只乘 (1−diskFade)、不看太阳在不在地平线上：真实太阳模式的晴夜，太阳在
        地平线下 −50°，余辉仍按它的方位把夜空抬 0.22×lum(夜 sunDisk 0xDCE6F8)≈0.17（夜天地平线
        本身线性亮度才 0.02~0.07），太阳方位那半边夜空被烘亮一大截；
     ③ 池底焦散借用水面波光的 uSunVis —— 9d67ccc 给 uSunVis 加了晨暮低档 0.35 后，焦散在
        仰角 3°~31° 也开着（0.30×0.35=0.105），与焦散自己"晨/暮自动归零"的设计相悖；
     ④ 云影：暴雨 diskFade 0.85 ⇒ 门 0.15 > 0.03 仍开（0.027），薄雾/雪也开着（这几种天气 shadowK=0，
        连硬影都没有，哪来云影）；日落后太阳在 −2°~−4° 时云影还在扫；门槛 0.03 处一步跳 0→0.0137；
     ⑤ 堂内暖光透窗吃 lamp：真实太阳模式下午取"暮"预设（lamp 0.25）按正午度混，春 14:50 仰角 44°
        就 >0.05，16:45 仰角 20° 已到 0.1375 —— 大太阳下窗纸在发光。
   全部只依赖**参数集里本来就随过渡缓动的连续量**（starAmount / cloudAmount / diskFade / shadowK /
   dayK / sunPos / lamp），所以门控本身也连续，切天气、拖时辰不会出现新的硬切。
   ⚠️ 纯函数：不读 ENV、不碰 THREE（p 里的 Color 只读不写），node 单测直接 import。 */
const _clamp01 = v => Math.max(0, Math.min(1, v));
const _sstep = (a, b, x) => { const t = _clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/* 太阳仰角（度）：p.sunPos 在真实太阳模式下是真实方向（可在地平线下）；旧模式是预设主光位置。 */
export function sunAltDeg(p){
  const s = p.sunPos, l = Math.hypot(s[0], s[1], s[2]) || 1;
  return Math.asin(Math.max(-1, Math.min(1, s[1] / l))) * 180 / Math.PI;
}
/* 水面：波光（uSunVis，口径与 9d67ccc 一字不变）与池底焦散（只取正午段，即 9d67ccc 之前的旧口径）。
   sdY = 水面所用太阳方向的 y（真实太阳模式取真实太阳，旧模式取主光，见 applyEnv）。 */
export function waterSunGates(sdY, p){
  const nightness = _clamp01(p.starAmount || 0);
  const dayW  = 1.0 - _clamp01((nightness - 0.05) / 0.25);            // 昼 1 → 夜 0
  const noonC = _clamp01((sdY - 0.52) / 0.20);                        // 正午段：0.72≧ 全亮
  const lowC  = _clamp01((sdY - 0.05) / 0.15) * 0.35;                 // 低仰角段：封顶 0.35
  const clear = _clamp01((0.82 - (p.cloudAmount || 0)) / 0.34);       // 云 ≤0.48 全亮，≥0.82 关
  /* 焦散另乘 shadowK：焦散与硬影同一个物理前提（直射光），薄雾 / 雪 / 细雨 shadowK=0 时
     （薄雾云量只有 0.30，clear 门照开）正午焦散原本满档 —— 雾里没有影子、池底却晃光斑。
     波光不乘（雾里日轮留 30%，水面一点亮闪是旧观感，不在本批范围）。 */
  const sk = p.shadowK === undefined ? 1 : p.shadowK;
  return { sunVis: dayW * Math.max(noonC, lowC) * clear, caustic: dayW * noonC * clear * sk };
}
/* out（可选，2026-11-24 · 第 5 批）：11-loop 每帧读一次云影门，给复用对象就零分配；不给仍返回新对象。 */
export function fxGates(p, out){
  const dayK = _clamp01(p.dayK ?? (1 - (p.starAmount || 0)));
  const alt = sunAltDeg(p);
  const df = p.diskFade || 0;
  /* ① 银河：在星量（已含云遮）之上再按 diskFade 收 —— diskFade 是"天上的光点被遮掉多少"的现成量：
     晴 0 / 雨后 0.02 / 雪霁 0 照常；薄雾 0.70、暴雨 0.85、雪 0.90、细雨 1.0 ⇒ 0。线性收、随天气缓动。
     ⚠️ 只收银河、不动星点：星点在薄雾夜里留七成是 2026-09 起的旧观感，夜空门的星闪判据也压在它上面。 */
  const starVis = (p.starAmount || 0) * Math.max(0, 1 - (p.cloudAmount || 0) * 0.85);
  const milkyWay = starVis * _clamp01(1 - df / 0.4);
  /* ② 余辉 / 云受光：直接取白天度 dayK（真实太阳 = smoothstep(−9°, 4°, 仰角)；旧模式 = 1−星量）。
     日落时（0°）0.78、民用晨昏（≈ −5°）0.22、−9° 归零；仰角 ≥4° 恒 1 ⇒ 白天观感一字不变。
     不再套 smoothstep 收窄：那样过渡压到 ~25 分钟，3 分钟一步跳 0.19（单测实测）。 */
  const sunGlow = dayK;
  /* ④ 云影：原门 云量×(1−diskFade)×(1−星量×1.4) 之上补三条：
     · × shadowK —— 薄雾/雪/细雨/阴霾/雷雨 shadowK=0（漫射光，无硬影），云影同理归零；
     · × (1 − smoothstep(0.60, 0.85, diskFade)) —— 暴雨 shadowK 仍 1（见表头），按"日轮被遮 85%"收掉；
     · × smoothstep(0°, 10°, 仰角) × 白天度 —— 日落后太阳在地平线下不再投云影（旧模式夜里主光是月亮替身，
       仰角高，但那时星量项已把门收为 0）。坡宽 10°（≈45 分钟）：4° 时 3 分钟一步跳 0.028；
       真实太阳"晨"锚点正是 10° ⇒ 锚点值不变。
     原 `gate > 0.03 ? 0.18×gate : 0` 在 0.03 处一步跳 0.0054（暮色里实测 0.0137→0 一帧切），
     改成 smoothstep 软起：零点仍严格为 0（10-post 的 uCloudShadeAmt>0 分支照旧整段跳过）。 */
  const cs = (p.cloudAmount || 0) * (1 - df) * (1 - Math.min(1, (p.starAmount || 0) * 1.4))
           * (p.shadowK === undefined ? 1 : p.shadowK) * (1 - _sstep(0.60, 0.85, df))
           * _sstep(0, 10, alt) * dayK;
  const cloudShade = 0.18 * cs * _sstep(0.0, 0.08, cs);
  /* ⑤ 堂内暖光：lamp × 0.55 之上乘"太阳够低"—— 仰角 12°→22° 之间收掉（白天度为 0 的夜里不收）。
     真实太阳"暮"锚点 = 太阳 7°（12h ANCHOR_ALT）⇒ 暮锚点值不变（0.1375）；旧模式暮锚点 13.3° 保留 95%；
     旧模式夜里主光是月亮替身（仰角 49°），但 dayK=0 ⇒ 不收。 */
  const hallWarm = (p.lamp || 0) * 0.55 * (1 - dayK * _sstep(12, 22, alt));
  const o = out || {};
  o.milkyWay = milkyWay; o.sunGlow = sunGlow; o.cloudShade = cloudShade; o.hallWarm = hallWarm;
  return o;
}

/* ══ 自然真实 · 物候 × 天气 × 时段的生灵 / 声景门控（2026-11-24 · 视觉打磨批次 2 · A）══════════════════
   为什么集中到这里：萤火、花瓣、蜻蜓、荷叶水珠、鱼跃、声景各自在 11-loop / 12-env / 12e / 12i 里
   拿 ENV.time / ENV.season / 天气名就近现算门控，扫"季节 × 天气 × 时段"全组合（probe/env-nature-unit.mjs）
   查出的穿帮（数值为改前实测）：
     ① 萤火：只认 晴 / 薄雾 —— 夏季细雨（= 梅雨，6 中 ~7 上，正是苏州萤火盛期）与雨后初晴的夏夜一只都没有；
     ② 蜻蜓：落地判据 rain>0.4，夏细雨 rain=0.342、春细雨 0.304 ⇒ 细雨里照常游弋 / 停栖；
        且**没有昼夜门** —— 夏夜 21:30 两只停栖 + 七只游弋全在；
     ③ 荷叶水珠：门只看 wetness ⇒ 暴雨 / 细雨**正下着**时盘上就在滚珠（应是雨停后的事）；
        冬季 lilyShow=0 叶盘已收，冬细雨（wet 0.9）水珠悬在空水面上滚；
     ④ 飘落花瓣 / 秋叶：着色器是**不受光**的固定色 ⇒ 春夜花瓣按白天亮度发粉光；暴雨里照常 0.6 强度慢悠悠漂；
     ⑤ 鱼跃：冬季巡游已减速（koiSpeed 0.42），跃水间隔却与夏天一样（中位 53s）；
     ⑥ 声景：叶鼓（雨打芭蕉）只看雨量 —— 冬季 bananaShow=0（叶幕枯落）照敲，冬细雨 rain 0.437 ⇒ 0.437；
        鸟鸣门写死"非冬"，可鸟种表里山雀冬季权重 2.0（全年留鸟）是死数据；
        脚步声与天气无关：雪地、积水地都是晴天的"嗒 / 沙"。
   全部只读参数集里的连续量（starAmount / dayK / rainAmount / snowAmount / windMul / 物候通道）+ 季节 / 有效天气，
   纯函数、不读 ENV、不碰 THREE，node 单测直接 import。 */
/* 萤火的天气适宜度：雨后湿夜是萤火最盛的时候；细雨（梅雨）里照飞但少；暴雨 / 雷雨 / 阴雪 = 0。 */
export const FIREFLY_WX = { clear: 1, afterrain: 1, mist: 1, drizzle: 0.55 };
/* out（可选，2026-11-24 · 第 5 批）：11-loop（萤火）与 12i（花瓣）每帧各调一次，给复用对象就零分配。 */
export function natureGates(p, season, eff, out){
  const rain = p.rainAmount || 0, snow = p.snowAmount || 0, wind = p.windMul || 1;
  const star = p.starAmount || 0;
  const dayK = _clamp01(p.dayK ?? (1 - star));
  const nightK = _sstep(0.45, 0.85, star);                 // 夜锚点 starAmount=1 ⇒ 1（门禁"夏夜晴有萤火"不受影响）
  /* ① 萤火：夏 × 夜 × 适宜天气；雨量 0.40→0.55 之间收掉（夏细雨 0.342 留、冬细雨/暴雨不可能进来） */
  const fireflies = season === 'summer'
    ? 0.9 * (FIREFLY_WX[eff] || 0) * nightK * (1 - _sstep(0.40, 0.55, rain)) * (1 - _sstep(0.02, 0.2, snow))
    : 0;
  /* ② 飘落：花期 / 秋季给量，雨把它们打下来 —— 空中的少、落得直、摆得小（湿花瓣贴着雨线掉）。
     光照：0.16 夜底 + 0.84 × 白天度，再按日轮被遮的程度压三成（阴雨天的花瓣不该比天亮）。
     默认（夏）花量 0 ⇒ 默认画面不受影响。 */
  const rainBeat = _sstep(0.2, 0.9, rain);
  const petalWx = 1 - 0.75 * rainBeat;
  const petalFall = 1 + 2.2 * rainBeat, petalSway = 1 - 0.7 * rainBeat;
  const petalLight = (0.16 + 0.84 * dayK) * (1 - 0.30 * _clamp01(p.diskFade || 0));
  /* ③ 蜻蜓（游弋 + 停栖同口径）：雨天（rain>0.12，与叶鼓起敲同一档"雨点打得响"）/ 下雪 / 大风 / 冬 / 夜 全收。
     夜判据用白天度 0.35（日落后约 −3°；真实蜻蜓黄昏还在捕食，天黑才栖）。 */
  const dragonfly = (p.dragonflyShow || 0) > 0.03 && rain <= 0.12 && snow <= 0.05 && wind <= 2.5
                  && eff !== 'storm' && eff !== 'winterrain' && eff !== 'thunder' && dayK > 0.35;
  const o = out || {};
  o.fireflies = fireflies; o.petalWx = petalWx; o.petalFall = petalFall; o.petalSway = petalSway;
  o.petalLight = petalLight; o.dragonfly = dragonfly;
  return o;
}
/* ④ 荷叶水珠强度（12e tickLotusDrops）：有水（wet 0.25 起显、0.70 满）× 雨已停 × 叶盘在（lilyShow）× 未结冰。
   wet 传**有效湿度**（含雨后余韵，见 lingerStep）—— 雨停后水珠随地面一起慢慢干掉。 */
export function lotusDropK(p, wet){
  return _clamp01((wet - 0.25) / 0.45) * (1 - _sstep(0.05, 0.2, p.rainAmount || 0))
       * _sstep(0.05, 0.3, p.lilyShow ?? 1) * (1 - _sstep(0.02, 0.2, p.snowAmount || 0));
}
/* ⑤ 鱼跃频率倍率：跟巡游速度走（koiSpeed 夏 1.0 → 冬 0.42 ⇒ 1.0 → 0.25）。冷水鱼不跃；间隔 ÷ 本值。 */
export function koiBreachRate(p){
  return 0.25 + 0.75 * _clamp01(((p.koiSpeed ?? 1) - 0.42) / 0.58);
}
/* ⑥ 声景各层目标（原 11-loop Snd.plan 的判据逐字搬来，wind01 由调用方从风场 uniform 算好传入）。
   改动只有三处（见上表头 ⑥），其余与旧 plan 同值：
     · drum × smoothstep(0.05, 0.35, bananaShow) —— 没有芭蕉叶就没有"雨打芭蕉"；
     · bird 冬季给 0.5（只剩山雀，频度减半；tick 把间隔 ÷ bird），其余季节 1 不变；
     · rain 与 quiet 判据不变（雨天无鸟、无虫；冬夜无虫）。 */
export function soundPlan(p, { time, season, wind01 = 0 }){
  const rain = p.rainAmount || 0;
  const windMul = p.windMul || 1;
  const wind = Math.min(1, Math.max(0, (windMul - 1) * 0.30) + wind01);
  /* "安静" = 没下雨、没大风。鸣虫在雨里和大风里都不叫 —— 这是真的生物学，
     也是听感上的必需：暴雨里再叠虫鸣，整段音景会糊成一片噪声。 */
  const quiet = rain < 0.15 && windMul < 2.2;
  const night = time === 'night';
  const dayLight = time === 'morning' || time === 'noon' || time === 'dusk';
  return {
    wind:    0.015 + wind * 0.085,
    rain:    rain * 0.14,
    /* 水声（批次 #12）：底 0.004（平静池面近耳的微响）+ 风推水（wind 0~1 ⇒ +0.014）。
       ⚠️ 与雨分层不冲突：暴雨里 lap 只占雨声的 1/10，被自然掩蔽——物理也对，
       暴雨的水声本来就是雨声本身的一部分。 */
    lap:     0.004 + wind * 0.014,
    /* 叶鼓（2026-11-22 · 美术批次 #13 雨打芭蕉·音频侧）：大叶击鼓的低频扑通。
       rain ≤ 0.12 不起（毛毛雨打不响叶子）；起后强度跟雨量（视觉侧芭蕉叶的
       uRain 抖动同吃 rainAmount ⇒ 视音频天然联动）。plan 只给门径不断言音色。
       × bananaShow（批次 2）：冬季叶幕枯落（bananaShow 0）就没有可打的叶。 */
    drum:    rain > 0.12 ? rain * _sstep(0.05, 0.35, p.bananaShow ?? 1) : 0,
    cricket: (night && quiet && season !== 'winter') ? 0.016 : 0,
    cicada:  (season === 'summer' && dayLight && !night && quiet) ? 0.020 : 0,
    frog:    (season === 'summer' && (night || time === 'dusk') && quiet) ? 0.030 : 0,
    bird:    (time === 'morning' && quiet) ? (season === 'winter' ? 0.5 : 1) : 0,
    /* 廊下风铃（2026-11-23 · 批次 #21）：与鸣虫反着来 —— 它**要风**（windMul>1.6 才起，
       即"阵风/大风"档；微风里铃不响才是对的）。季节不忌（廊下铜铃年年挂着），但冬季
       实际上响不了 —— 不是门限的锅：WEATHER_RULES 禁了冬季暴雨（老黄 2026-10-06 拍板），
       冬季最大风只有雪天 1.35。plan 只给门径，节奏由 tick 的 chimeNext 拍板。 */
    chime:   windMul > 1.6 ? Math.min(1, (windMul - 1.6) / 1.5) : 0,
    quiet:   quiet ? 1 : 0,
  };
}
/* ⑦ 脚步声音色：干地与旧版逐字相同（石 2.4kHz/Q1.8/×1.0/0.055/50ms；草 700Hz/Q0.7/×0.72/0.042/85ms）。
   雪（地面有效积雪 >0.15 起渐变、0.6 满）：频带压到 520/380Hz、Q 放宽、慢放、音量 ×0.7、尾巴拉长 = "闷"；
   积水（有效湿度 0.30 起、0.80 满，雪地不叠）：叠一记 3.2kHz 高通短噪 = "啪嗒"，强度 splash。 */
export function footstepVoice(onStone, wet = 0, snow = 0){
  const v = onStone
    ? { freq: 2400, Q: 1.8, rate: 1.0, gain: 0.055, dur: 0.05 }
    : { freq: 700,  Q: 0.7, rate: 0.72, gain: 0.042, dur: 0.085 };
  const s = _sstep(0.15, 0.6, snow);
  if (s > 0){
    const lerp = (a, b) => a + (b - a) * s;
    v.freq = lerp(v.freq, onStone ? 520 : 380); v.Q = lerp(v.Q, 0.55); v.rate = lerp(v.rate, 0.58);
    v.gain = lerp(v.gain, v.gain * 0.7); v.dur = lerp(v.dur, 0.12);
  }
  v.splash = _sstep(0.30, 0.80, wet) * (1 - s);
  return v;
}

/* ══ 空气含水量：远山 / 雾 / 地平线 / 水面反射 / 饱和 共用一个量（2026-11-24 · 批次 2 · B）══════════════════
   量证（outputs/_diag/humidity-survey-2026-11-24.mjs，改前）：五处各算各的 ——
     · 雾密度：时段 fogDensity × 季节 fogMul × 天气 fogMul（× 薄雾 mistMul）；晨 0.0088 / 午 0.0052；
     · 地平线发白：天气 skyGray（晴 0 / 雨后 0.06 / 薄雾 0.22 / 暴雨 0.80）；
     · 饱和：时段 grade × 季节 × 天气 satMul；
     · 远山谷雾 uHaze：四层**常数** 0.26/0.40/0.60/0.62 —— 雪霁（雾 ×0.72）与薄雾（雾 ×1.8×晨 1.45）一样浓；
     · 水面反射：**不受任何湿度影响** —— 薄雾 / 暴雨里倒影与晴天一样锐；
     · 雨停后：上面全部 3 秒内跳回晴天值（余韵只有材质湿度，见 lingerStep）。
   收口：H = 1 − (1−天气 humidW)(1−晨 dawnHumid)(1 − 0.55×余韵湿度增量)。
     · 雾 / 地平线 / 饱和：预设已按天气与时段标定过（老黄逐轮拍板的观感），只吃**预设之外**的增量 dH = H − Hp
       （= 雨后余韵）—— 不重复乘；
     · 远山谷雾 / 水面反射：原来不吃任何湿度，吃全量（相对晴 0.30）。
   默认（夏 · 晴 · 午）：humidW 0.30、dawnHumid 0、余韵 0 ⇒ H = Hp = 0.30 ⇒ 五个系数恰为 1 / 0（偏差 0，单测断言 <1%）。 */
export const HUMID_DEFAULT = 0.30;
export function airHumidity(p, wetExcess = 0){
  const hw = _clamp01(p.humidW ?? HUMID_DEFAULT), ht = _clamp01(p.dawnHumid || 0);
  const Hp = 1 - (1 - hw) * (1 - ht);
  const H = 1 - (1 - Hp) * (1 - 0.55 * _clamp01(wetExcess));
  return { H, Hp };
}
export function aerialFromHumidity(h, dayK = 1){
  const dH = Math.max(0, h.H - h.Hp), full = h.H - HUMID_DEFAULT;
  /* 远山 / 倒影两项乘白天度：夜里不动 —— mist-guard 的夜+薄雾"山 ≤ 天 + 2.5"只剩 ~0.5 余量
     （见该门 2026-11-06 重定标注释），夜里远山本就只剩雾填充的剪影，加谷雾没有可读的收益。 */
  const dk = _clamp01(dayK);
  return {
    fogK: 1 + 0.65 * dH,                                     // 雨刚停：雾 +25%（余韵满档 dH≈0.39）
    horizonMix: 0.30 * dH * dk,                  // 地平线往雾色发白；夜里不动（mist-guard 的"山≤天"）
    satK: 1 - 0.10 * dH,                                     // 水汽压一点饱和（−4%）
    /* 远山谷雾（午）：雪霁 0.78 / 晴 1 / 雨后 1.06 / 晴晨 ≈1.36 / 暴雨 1.56 / 薄雾 1.64（四层 uHaze 封顶 0.92，峰顶照旧 100% 山色） */
    hillHazeK: Math.max(0.6, Math.min(2.0, 1 + 1.6 * full * dk)),
    /* 水面反射往地平线色蒙一层：H ≤ 0.45 不动（晴 / 雨后 / 雪 / 雪霁倒影照旧锐），薄雾 / 暴雨 ≈0.25 */
    reflHaze: Math.max(0, Math.min(0.32, 0.5 * (h.H - 0.45) / 0.55)) * dk,
  };
}

/* ══ 天气余韵：雨停慢慢干、雪停先化屋顶石面再化地面（2026-11-24 · 批次 2 · C）══════════════════════════
   为什么要它：wetness / snowCover 是天气预设的直出值，切天气走 3 秒过渡 ⇒ 暴雨 → 晴，3 秒后地面全干、
   积水 / 檐滴 / 荷叶水珠一齐消失；银装素裹 → 晴，3 秒后满园雪一起化光（屋顶与地面同速）。
   现有"雨后"只有 afterrain 这个**静态预设**（wetness 0.85 恒定），没有计时器（已搜：12e postRainK / tickLotusDrops
   都直读 wetness，12-env / 11-loop 无相关计时）。
   做法：不改预设、不动 ENV.cur（mixInto / 流转每帧都会重写它），另存三条**慢降快升**的水位
     L = max(预设直出值, L − 速率 × 进度)：
       · 升（开始下雨 / 下雪）立即跟随 —— 余韵只管"停之后"；
       · 降按"游戏秒 + 流转小时"两路累计：静看 5 分钟干透 / 屋顶石面 3 分钟化完 / 地面 8 分钟；
         时光流转（0.4 时/秒）按游戏内小时算：2 / 1.5 / 4 小时 —— 流转快进时余韵也跟着快进；
   applyState 换季 / 偶得 / 四季演示、settleEnv（明信片）⇒ reset：时间跳了几个月，不该带着上一幕的雪。 */
export const LINGER = { wetSec: 300, snowFastSec: 180, snowGroundSec: 480, wetHr: 2.0, snowFastHr: 1.5, snowGroundHr: 4.0 };
export function lingerInit(p){
  const L = { wet: 0, snowF: 0, snowG: 0 };
  return lingerReset(L, p);
}
export function lingerReset(L, p){
  L.wet = p.wetness || 0; L.snowF = p.snowCover || 0; L.snowG = p.snowCover || 0;
  return L;
}
/* decayOnly：只许降不许升 —— applyState 拨时辰时朝**新目标**推进"跳过的小时"用：
   新目标若更湿（开始下雨），升要等 3 秒过渡把 cur 带上来，不能在过渡开始前一帧就把地面打湿。 */
const _slew = (cur, target, drop, decayOnly) =>
  target >= cur ? (decayOnly ? cur : target) : Math.max(target, cur - drop);
export function lingerStep(L, p, dt, dHours = 0, decayOnly = false){
  const dts = Math.max(0, dt), dh = Math.abs(dHours);
  L.wet   = _slew(L.wet,   p.wetness   || 0, dts / LINGER.wetSec        + dh / LINGER.wetHr,        decayOnly);
  L.snowF = _slew(L.snowF, p.snowCover || 0, dts / LINGER.snowFastSec   + dh / LINGER.snowFastHr,   decayOnly);
  L.snowG = _slew(L.snowG, p.snowCover || 0, dts / LINGER.snowGroundSec + dh / LINGER.snowGroundHr, decayOnly);
  /* 屋顶石面化得快：任何时刻不比地面多（升时两者同值，降时 F 先走） */
  if (L.snowF > L.snowG) L.snowF = L.snowG;
  return L;
}
/* ══ 地表三项的"变了才算"门（2026-11-24 · 第 5 批 · 慢更新分流）════════════════════════════════
   12-env 的 tickLinger 每帧都调 applySurfaces：现算 lingerEff / airHumidity / aerialFromHumidity（4 个新对象）、
   写雪 / 湿 / 雾 / 地平线 / 饱和 / 四层远山谷雾 / 水面反射。可这些输入在稳态里几乎不动：
   余韵最快的屋顶雪化速率 1/180 每秒 ≈ 每帧 9e-5；预设值只在过渡 / 流转 / applyState 时变（那时 applyEnv 自己会全量写）。
   判据（dirty 返回 true 才重算并记下这次的输入）：
     · 余韵生效值 max(预设, 水位) 三项：变化超过 SURFACE_EPS = 1e-3 才算 —— 1e-3 的积雪 / 湿度台阶肉眼不可见
       （applyWetness 自己就有 0.004 的死区；雪覆盖 1e-3 ≈ 一张 2048 雪罩上 2 个像素级的阈值移动）。
       末梢：生效值落回预设值（化完 / 干透）但与上次写入不同 ⇒ 立刻补写，保证终值精确、不残留 <1e-3 的尾巴。
       最大"台阶" = 1e-3，间隔约 0.18s（屋顶雪化）～0.3s（地面变干），见上 —— 不需要插值。
     · 其余直读的预设通道（湿 / 雪直出、两项湿度、白天度 / 星量、雾密度、饱和、地平线色 / 雾色）：任何变化即重算（零阈值）。
     · extra：调用方给的"写口就绪数"（远山 uHaze uniform 编译出来了几个、水面 uReflHaze 在不在）——
       延迟编译出来的 uniform 第一帧就补写，不靠下一次输入变化。
   时光流转 / 拖滑杆 / setEnv 都会让 applyEnv 跑，applyEnv 末尾的 applySurfaces 不经此门，并调 sync 记下输入（立即刷新）。 */
export const SURFACE_EPS = 1e-3;
const _SG_N = 17;
export class SurfaceGate {
  constructor(){ this.k = new Float64Array(_SG_N).fill(NaN); this.v = new Float64Array(_SG_N); this.skips = 0; this.runs = 0; }
  _read(L, p, extra){
    const v = this.v, w0 = p.wetness || 0, s0 = p.snowCover || 0;
    v[0] = Math.max(w0, L ? L.wet : 0); v[1] = Math.max(s0, L ? L.snowG : 0); v[2] = Math.max(s0, L ? L.snowF : 0);
    v[3] = w0; v[4] = s0; v[5] = p.humidW ?? NaN; v[6] = p.dawnHumid || 0; v[7] = p.dayK ?? NaN; v[8] = p.starAmount || 0;
    v[9] = p.fogDensity; v[10] = p.grade ? p.grade.saturation : NaN;
    const h = p.skyHorizon, f = p.fogColor;
    v[11] = h ? h.r : NaN; v[12] = h ? h.g : NaN; v[13] = h ? h.b : NaN;
    v[14] = f ? f.r : NaN; v[15] = f ? f.g : NaN; v[16] = extra || 0;
    /* fogColor.b 并进 16 号位会丢精度 ⇒ 单独比（见 dirty） */
    this._fb = f ? f.b : NaN;
    return v;
  }
  /** true = 需要重算（同时把当前输入记为"已写入"）；false = 与上次写入相同或只差亚阈值的余韵 */
  dirty(L, p, extra = 0){
    const v = this._read(L, p, extra), k = this.k;
    let d = !(this._fb === this._kfb);
    for (let i = 0; i < 3 && !d; i++){
      const dv = Math.abs(v[i] - k[i]);
      if (!(dv <= SURFACE_EPS)) d = true;                         // 超阈值（含首帧 NaN）
      else if (dv > 0 && v[i] === v[i < 1 ? 3 : 4]) d = true;     // 末梢：落回预设值，补写精确终值
    }
    for (let i = 3; i < _SG_N && !d; i++) if (!(v[i] === k[i] || (v[i] !== v[i] && k[i] !== k[i]))) d = true;
    if (d){ k.set(v); this._kfb = this._fb; this.runs++; } else this.skips++;
    return d;
  }
  /** 外部已全量写过（applyEnv）：记下这次输入，下一帧起按它判 */
  sync(L, p, extra = 0){ this.k.set(this._read(L, p, extra)); this._kfb = this._fb; }
}

/* 实际落到画面的三项：wet（材质湿光 / 积水 / 檐滴 / 水珠 / 脚步）、snowGround（地面 / 植被）、snowFast（屋顶 / 石面），
   以及余韵比预设多出的湿度 wetExcess（喂 airHumidity）。 */
export function lingerEff(L, p){
  const w0 = p.wetness || 0, s0 = p.snowCover || 0;
  const wet = Math.max(w0, L ? L.wet : 0);
  return { wet, snowGround: Math.max(s0, L ? L.snowG : 0), snowFast: Math.max(s0, L ? L.snowF : 0),
           wetExcess: wet - w0 };
}
