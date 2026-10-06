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

/* ↓ 由 12-env.js 在 `ENV.cur = resolveEnv()` 之前注入（见文件头） */
let ENV = null;
export function bindPresetsEnv(state){ ENV = state; }

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
     下面这段注释描述的是它当初的取���逻辑（改暴雨时一并参考）：
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
/* 互斥矩阵 —— 唯一权威在这里。
   · 银装素裹仅冬季（其余季节按钮置灰，悬停给出原因）
   · 冬 + 狂风暴雨 → 渲染为风雪（雨置换为雪、给积雪）；其余季节是雨
   返回 null 表示该组合合法。 */
const WEATHER_RULES = {
  snow: s => s === 'winter' ? null : '仅冬季可用',
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
  } else {
    p.bankHall = 0; p.bankBamboo = 0; p.bankBridge = 0; p.bankRockery = 0;
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
    grade:{ contrast:0.13, saturation:1.02, split:0.30, vignette:0.50, warm:0xFFF2E0, cool:0xE6EEFF },
    /* 活雾三键（仅 mist 天气生效，见 applyWeatherTo）：晨 = 大雾裹正堂 ——
       mistMul 再乘雾密度、正堂雾团最浓、竹林雾团只留一线。 */
    starAmount:0.0, lamp:0.0, mistMul:1.45, bankHall:0.55, bankBamboo:0.12, bankBridge:0.25, bankRockery:0.50,
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
    grade:{ contrast:0.25, saturation:1.12, split:0.24, vignette:0.50, warm:0xFFF6E8, cool:0xE2EEFF },
    /* 2026-09-28 二轮（老黄："中午几乎就没有了，不能没有，只是淡一点"）：mistMul
       0.82→1.10（有效 1.98，晨 2.61 的 ~76%——比晨淡、但明显有雾）；雾团也留三成
       而不是归零（bankHall 0.28 / bankBamboo 0.22）。 */
    starAmount:0.0, lamp:0.0, mistMul:1.10, bankHall:0.28, bankBamboo:0.22, bankBridge:0.15, bankRockery:0.20,
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
    starAmount:0.0, lamp:0.25, mistMul:1.30, bankHall:0.14, bankBamboo:0.55, bankBridge:0.50, bankRockery:0.30,
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
    starAmount:1.0, lamp:1.0, mistMul:0.72, bankHall:0.08, bankBamboo:0.08, bankBridge:0.30, bankRockery:0.08, rainbowMul:1.00 },
};

/* ── 季节预设 ──
   季节只写「与时段无关」的那部分：植被色调 / 存在性 / 动物行为，
   外加少量对时段结果的乘性修正（光强、雾、饱和）。
   植被色调采用「保留明度的换色」（见 addSeasonTint）：tintMix=0 表示完全保留原色。 */
export const ENV_SEASON = {
  spring: { label:'春',
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:0.94, satMul:1.03,
    tinGrass:0x9CC85E, tinBamboo:0xAED078, tinLeaf:0x8ECB58, tinReed:0x9CC86A,
    tinWillow:0xB4D47C, tinLily:0x3E7A34, tinLotus:0xF2C7D4, tinWisteria:0x9B6FC4,   // 春：垂柳新芽淡绿（用户常识反馈）
    tinBanana:0x62B054, tinTrunk:0x3B2A1E, tintMix:0.50,
    lilyShow:0.05, lotusShow:0.05, wisteriaShow:1.0, bananaShow:0.9, reedShow:0.85, willowLeaf:0.38,   // 春：柳帘均匀变疏=新芽初绽（38%+洗牌）
    /* 竹叶季节叶量（2026-09-16 用户："初春先抽竿长叶、夏要茂密"）——
       系数×基数（12~21 片/枝）＝绝对量。夏 1.0 ≈ 4.2 万片（茂密）；
       春 0.28 ≈ 1.2 万片（初春抽竿后刚长叶，绝对量与旧版春一致）；
       秋 0.43 ≈ 1.8 万片（微落）；冬 0.33 ≈ 1.4 万片（常绿稍疏） */
    bambooLeaf:0.28, koiSpeed:1.0, dragonflyShow:0.35, turtleShow:1.0, gooseShow:1.0,   // 春：大雁北迁过境
    /* 春：先花后叶。花满树、叶始萌（15% 刚抽的嫩芽），落花初落 —— 桃是先花后叶树种 */
    peachShow:0.15, peachBlossomShow:1, peachFruitShow:0, peachPetalShow:0.3,
    plumBlossomShow:0.55,          // 梅：红梅冬末春初还在开，春天留一半
    blindShow:0, scrollCoolShow:1, scrollWarmShow:0 },      // 春：帘未挂；堂内青绿山水
  summer: { label:'夏',
    sunMul:1.00, ambMul:1.00, hemiMul:1.00, fogMul:1.00, satMul:1.00,
    tinGrass:0xFFFFFF, tinBamboo:0xA8C46A, tinLeaf:0x4E8C36, tinReed:0x3F6B34,
    tinWillow:0x5E9638, tinLily:0x3E7A34, tinLotus:0xF2C7D4, tinWisteria:0x9B6FC4,   // 夏：翠绿繁茂（用户常识反馈）
    tinBanana:0x4F9440, tinTrunk:0x3B2A1E, tintMix:0.0,
    lilyShow:1.0, lotusShow:1.0, wisteriaShow:1.0, bananaShow:1.0, reedShow:1.0, willowLeaf:1.0,
    bambooLeaf:1.0,
    koiSpeed:1.0, dragonflyShow:1.0, turtleShow:1.0, gooseShow:0.0,   // 夏：无雁（盛夏非迁徙季）
    /* 夏：花落尽、桃结果（叶茂果生，落花也快被扫净只余淡痕） */
    peachShow:1, peachBlossomShow:0, peachFruitShow:1, peachPetalShow:0.45,
    plumBlossomShow:0,             // 梅：夏季无花（骨相仍在）
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
    lilyShow:0.55, lotusShow:0.42, wisteriaShow:0.35, bananaShow:0.7, reedShow:1.0, willowLeaf:0.72,
    bambooLeaf:0.43,
    koiSpeed:1.0, dragonflyShow:0.35, turtleShow:1.0, gooseShow:1.0,   // 秋：大雁南迁过境
    /* 秋：桃叶转黄（tinLeaf）、果渐疏（快被摘/落尽），花/落花早没了 */
    peachShow:1, peachBlossomShow:0, peachFruitShow:0.7, peachPetalShow:0,
    plumBlossomShow:0.15,          // 梅：深秋只有极少数早花（腊梅含苞）
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
    lilyShow:0.0, lotusShow:0.0, wisteriaShow:0.0, bananaShow:0.0, reedShow:0.0, willowLeaf:0.0,
    /* 冬：芭蕉叶幕枯落（多年生草本，假茎宿存——第九轮用户常识反馈）；
       柳叶**掉光**（垂柳是落叶乔木，裸枝过冬——2026-09-19 老黄科学反馈；
       0.02 是旧"变稀"思路残留，164 片残叶肉眼仍读作"挂着"）。 */
    bambooLeaf:0.33,   // 冬：竹常绿但疏（不落叶，只是密度回落）
    koiSpeed:0.42, dragonflyShow:0.0, turtleShow:0.0, gooseShow:0.0,   // 冬：无雁（越冬地不在此）
    /* 冬：桃树落叶，裸枝过冬（同冬柳）——叶落尽、无花无果无落花 */
    peachShow:0, peachBlossomShow:0, peachFruitShow:0, peachPetalShow:0,
    /* ⚠️ 梅 = 冬天的**唯一花事**（老黄："给冬天增加一点色彩，特别是'银装素裹'的场景下"）：
       冬 1.0 —— 满树花。这一档是"梅兰竹菊"第一次真正参与画面，别被任何天气通道压掉：
       雪景要显色 ⇒ 梅的花材质不登 SNOW_COVER_MATS（否则会被雪盖成白片）。 */
    plumBlossomShow:1.0,
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
    ? paramsAtHour(ENV.hour)
    : makeParams(ENV_TIME[ENV.time] || ENV_TIME.noon);
  return composeEnv(base);
}

/* ── 连续昼夜（时辰滑杆）──
   四锚点取各时段"性格"的中间时刻：晨 7:30 / 午 12:30 / 暮 17:30 / 夜 21:30。
   夜里 21:30 → 次日 4:30 整段保持深夜（不是匀速往晨过渡——凌晨两点不该"半亮"），
   4:30 → 7:30 才是黎明渐亮。 */
export const TIME_ANCHORS = { morning: 7.5, noon: 12.5, dusk: 17.5, night: 21.5 };

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
function moonDirAtHour(h){
  const u = (((h - 18) % 24) + 24) % 24;      // 0 = 18:00 月出；12 = 06:00 月落；>12 在地平线下
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
