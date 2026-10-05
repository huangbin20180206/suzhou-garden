// 12-env: from index.html inline 501..1876
import { THREE, mergeGeometries } from '../vendor.js';
/* ⚠️ 这里**不能** import 11-loop 的 queuePostcard / toggleSound（明信片、音景两个按钮）：
   12-env 被 2b-wind 依赖，2b-wind 又被 11-loop 依赖 → 静态 import 会构成
   2b-wind → 12-env → 11-loop → 2b-wind 的环，11-loop 的 body 会在 2b-wind 求值完成前
   跑 `animate()` / `window.__garden` → 启动期 TDZ（实测 "Cannot access 'windClock
   before initialization"，渲染循环每帧重复）。这两处都只在**事件回调**里调用，
   回调触发时所有模块早已就绪 → 走 00-config 的 HOOKS 延迟绑定（见该文件注释）。 */
import { MAT, waterSurface, DISTANT_MATS, SEASON_TINT_REGISTRY, addWind, wetUniform, WET_MATS, SNOW_COVER_MATS, SNOW_HOOK, AUX_PASS_HIDDEN } from './01-materials.js';
import { world, dragonflies, setPerchShowOK, swimTurtles, tourUserTakeover, TOUR, tourStop, tourStart,
         gotoViewpoint, showCaption, showSeasonCaption, hideCaption, VIEWPOINTS,
         cancelCamFly, CAM_FLY, introActive, introCancel, geese, GOOSE } from './08-assemble.js';
import { sun, fitShadowCamera, amb, fill, hemiLight, markCasterBoxDirty } from './09-lights.js';
import { skyMesh, rainbowMesh, scene, lumOf, ENV_BAKE_LUM, resetCamera, camera, ACTIVE_QUALITY, renderer, setEnvPreset } from './02-scene.js';
import { bloom, gtaoPass, gradePass } from './10-post.js';
import { gust } from './2b-wind.js';
import { TAU, HOOKS, ENV_REF, mulberry32, CFG } from './00-config.js';
import { spawnRipple, rainRippleActive, treeLanternInsts } from './06-vegetation.js';
import { POND_RADII, groundHeight, insidePond } from './05-water.js';
/* 2026-10-05 拆分：电闪雷鸣 + 春节烟花已搬进 12b-sky.js（那边**不能** import 本模块，故由本模块注入状态机）。
   ⚠️ 这里的 import 是**必须**的，不要图省事改写成 `export { ... } from './12b-sky.js'`：
   probe/import-audit.mjs（拆分守卫）判"用到别的模块的导出名就必须显式 import"，而
   `export ... from` 既不进本模块作用域、又被它当成一次使用 ⇒ 会报 8 条假红
   （实测：LIGHTNING / tickLightning / ... 全被报"用到但没 import"）。
   所以先 import 进作用域、再 export 出去 —— 语义等价，且守卫能看懂。 */
import { bindSkyEnv, LIGHTNING, tickLightning, lightningStrikeNow,
         FIREWORKS, setFireworksForce, fireworksState, fireworksFinaleNow, tickFireworks } from './12b-sky.js';
export { LIGHTNING, tickLightning, lightningStrikeNow,
         FIREWORKS, setFireworksForce, fireworksState, fireworksFinaleNow, tickFireworks };
/* 2026-10-05 拆分：上元灯会（河灯/灯串/挂灯）已搬进 12c-festival.js（那边**不能** import 本模块，故由本模块注入）。
   ⚠️ 灯会的"look 第 4 层"（applyFestivalTo）**不在**这里 —— 它只改参数集，已随合成规则归 12a-presets.js，
      因此 12a 不必反过来 import 12c（依赖方向保持单向：本模块 → 12a/12c/12d/12e）。 */
import { bindFestival, makeFestivalLights, collectFestivalHangAnchors, tickFestival, festivalState,
         setFestivalFreeze, toggleFestival, _hangInsts,
         riverLampMat, stringBulbMat, riverFlameMat } from './12c-festival.js';
export { makeFestivalLights, collectFestivalHangAnchors, tickFestival, festivalState, setFestivalFreeze, toggleFestival };
/* 2026-10-05 拆分：夜间灯笼已搬进 12d-lantern.js（那边不需要注入，只 import 外部模块）。 */
import { makeLanterns, tickLampVol, lampVolState, setLampVol, lanternGroups, hash21Lantern,
         lanternMat, _lampVol, _groundSplashMat, worldLights } from './12d-lantern.js';
export { makeLanterns, tickLampVol, lampVolState, setLampVol, lanternGroups, hash21Lantern };
/* 2026-10-05 拆分：雨/雪粒子 + 雨后檐滴与积水已搬进 12e-precip.js（那边不能 import 本模块，故由本模块注入 ENV）。 */
import { bindPrecipEnv, PRECIP, updatePrecip, PRECIP_INDOOR, POSTRAIN, updatePostRain } from './12e-precip.js';
export { PRECIP, updatePrecip, POSTRAIN, updatePostRain };
/* 2026-10-05 拆分：环境三轴预设 + 合成规则已搬进 12a-presets.js（那边不能 import 本模块，故注入 ENV）。 */
import { bindPresetsEnv, ENV_WEATHER, ENV_TIME, cloneParams, composeEnv, resolveEnv, mixInto,
         paramsAtHour, nearestTimeKey, fmtHour, MOON_ARC, MOON_FADE_HI, TIME_ANCHORS, ENV_SEASON,
         weatherTag, effectiveWeather, weatherMutexReason, timeLabelNow } from './12a-presets.js';
export { mixInto, TIME_ANCHORS, ENV_SEASON, weatherTag, effectiveWeather, weatherMutexReason, timeLabelNow };
/* ══════════════════════════════════════════════════════════════
   12 · 环境时序系统（ENV）
   ══════════════════════════════════════════════════════════════
   三个正交轴（时段 / 季节 / 天气）各自只写自己的预设表，最终参数由「组合规则」合成，
   而不是为 4×4×4 = 64 种组合各写一套 —— 这是这套系统不失控的关键。
   三根轴已全部接入（2-1 时段 / 2-2 季节 / 2-3 天气），合成位置就在 resolveEnv()。 */

/* ══ 夜间灯笼（灯罩纸纹 / 5 盏灯笼 / 体积光 / 地面光斑）⇒ 已移入 12d-lantern.js（2026-10-05 拆分）══
   原 42~419 行整块搬走（纯搬家，除 4 个声明补 export 前缀外逐字未改）；对外的 import / 转出在
   文件顶部那一处。applyEnv 里要用的 _lampVol / _groundSplashMat / lanternMat / worldLights
   都从那边 import 回来 —— 灯会那边（12c）拿到的 worldLights 也是同一个数组。 */

/* ══ 环境三轴预设（时段/季节/天气）+ 合成规则 ⇒ 已移入 12a-presets.js（2026-10-05 拆分）══════
   原 54~658 行整块搬走（纯搬家，除 10 个声明补 export 前缀外逐字未改）；对外的 import / 转出在
   文件顶部那一处。⚠️ 那边的 ENV 是注入的，且必须在下面 `ENV.cur = resolveEnv()` **之前**注入。 */

/* ── 把参数落到渲染对象上 ── */
const uiRoot = document.documentElement;
let uiLastDark = null;                 // 主题只跟时段轴有关：记住上次写过的值，别每帧重写 CSS
/* 月光色：冷白偏蓝（日光是 5600K 的白里透黄，月光本质是反射的日光 + 大气散射，
   实测照片的月夜高光大约落在 #C9D8F2 一带 —— 用纯白会失去"月夜"的冷调）。 */
const MOON_LIGHT = new THREE.Color(0xC9D8F2);
const _moonV = new THREE.Vector3();
export function applyEnv(p){
  sun.color.copy(p.sunColor); sun.intensity = p.sunIntensity;
  sun.position.set(p.sunPos[0], p.sunPos[1], p.sunPos[2]);
  sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
  /* ── 月亮 → 天空 / 池水 / 主光（2026-09-19 老黄需求）──
     ① 天空与水面只写 uniform：月轮本体在 sky shader 里（它会被平面反射渲进池面，
        所以"池中有月"是自动成立的，不需要另画一个倒影）；
     ② 主光跟着月亮走：夜里那盏"太阳灯"本来就是月光替身（night 预设 0xA8BEE0 / 0.26），
        但它此前**从不跟月亮走** —— 月亮在东、影子朝西，这正是"月光影响场景"要修的那处。
        不新增灯：复用同一盏 → 阴影方向与月光一致，也不多一张阴影贴图（省一次全场深度渲染）。 */
  if (p.moonPos){
    _moonV.set(p.moonPos[0], p.moonPos[1], p.moonPos[2]);
    if (_moonV.lengthSq() < 1e-6) _moonV.set(0, 1, 0);
    _moonV.normalize();
    /* 贴地平线时淡出：真实的月出/月落会被大气消光压暗并染红，这里只做压暗（染色会与
       黄昏的暖调打架）。窗口上沿走 MOON_FADE_HI（随 MOON_ARC.peakAlt 定，≈2.9°），
       下沿 0.0028 ≈ 0.16° —— 月亮一离地平线就迅速亮起来，"刚爬上来还很淡"。 */
    const alt = Math.max(0, Math.min(1, (_moonV.y - 0.0028) / MOON_FADE_HI));
    const vis = (p.moonVis || 0) * alt * alt * (3 - 2 * alt);
    const mu = skyMesh.material.uniforms;
    mu.uMoonDir.value.copy(_moonV);
    mu.uMoonAmount.value = vis;
    if (waterSurface){
      const wu = waterSurface.material.uniforms;
      if (wu.uMoonDir){ wu.uMoonDir.value.copy(_moonV); wu.uMoonVis.value = vis; }
    }
    /* ── 晴午太阳波光 → 水面（2026-09-21）：与月光同构，但只补水面不补天空（日轮本就在
       sky shader / 平面反射里）。uSunVis = 白天度 × 接近正午 × 晴天：
       ① 白天度用 starAmount 判（夜 1 / 昼 0，日照越深越关，避免夜里把月亮当太阳打出白刺）；
       ② 接近正午用太阳仰角判 —— 太阳几乎在头顶时反射才够锐，晨昏仰角低就归零；
       ③ 晴天用 cloudAmount 判 —— 云一厚（>0.82）就关，阴雨雪/阴天整片不闪。 */
    if (waterSurface){
      const wu = waterSurface.material.uniforms;
      if (wu.uSunDir){
        const sd = sun.position.clone().normalize();
        wu.uSunDir.value.copy(sd);
        const nightness = Math.max(0, Math.min(1, p.starAmount || 0));
        const dayW  = 1.0 - Math.max(0, Math.min(1, (nightness - 0.05) / 0.25));     // 昼 1 → 夜 0
        const noonC = Math.max(0, Math.min(1, (sd.y - 0.52) / 0.20));                // 仰角 0.72≧ 全亮，0.52 以下 0
        const clear = Math.max(0, Math.min(1, (0.82 - (p.cloudAmount || 0)) / 0.34));// 云 ≤0.48 全亮，≥0.82 关
        wu.uSunVis.value = dayW * noonC * clear;
      }
    }
    /* 主光交给月亮的前提是**真的入夜了**：starAmount 是现成的"夜色深度"通道
       （夜 1.0 / 暮 0.0，17:30→21:30 之间线性推进）。黄昏月亮虽已升起，
       但太阳还在西边压着 —— 那时把主光拽向东方会出现"夕阳还在、影子从东边来"的穿帮。
       0.45→0.85 这一段就是日落到月升的交接。 */
    const nightness = Math.max(0, Math.min(1, p.starAmount || 0));
    const ss = Math.max(0, Math.min(1, (nightness - 0.45) / 0.40));
    const mw = vis * ss * ss * (3 - 2 * ss);
    if (mw > 0.01){
      const D = 68;
      sun.position.set(_moonV.x * D, Math.max(8, _moonV.y * D), _moonV.z * D);
      sun.color.lerp(MOON_LIGHT, 0.75 * mw);
      sun.intensity = p.sunIntensity * (1 + 0.95 * mw);
    }
  }
  /* ── 物体影子强度随天气（2026-09-28 用户："阴霾和薄雾不该有影子"）──
     sun.shadow.intensity 是 three r155+ 的公开通道（shader 端 mix(1.0, shadow, k)）：
     阴影深度图照常渲，只调"影子的存在感"⇒ 阴/雾切换零额外渲染成本。
     阴霾/薄雾 → 0（漫射光投不出边界清晰的硬影）；晴/暴雨/雪 → 1。缺键兜底 1
     （探针重放旧参数集、或未过天气层的路径都不会误关影子）。 */
  sun.shadow.intensity = (p.shadowK === undefined ? 1 : p.shadowK);
  /* 阴影视体自适应（2026-09-18 重写，见 fitShadowCamera 处的长注释）：
     旧写法是「固定 ±28/±24，再按 1/仰角 放大」—— 那个旋钮的理由是错的
     （ortho 视体的 XY 只需要罩住投射物**轮廓**，影长由 near/far 承担），
     而且固定盒本来就比园子轮廓小 8m，盒外的影子边界会被硬切成一条亮缝。
     现在改成把投射物包围盒的 8 个角投到光空间直接拟合，永远刚好罩住全场。
     只在光向真的动了才重算（静止时防抖，免得每帧刷新投影矩阵）。 */
  if (Math.abs(sun.position.x - (sun.userData.lastFitPos ? sun.userData.lastFitPos[0] : 1e9)) > 0.01 ||
      Math.abs(sun.position.y - (sun.userData.lastFitPos ? sun.userData.lastFitPos[1] : 1e9)) > 0.01 ||
      Math.abs(sun.position.z - (sun.userData.lastFitPos ? sun.userData.lastFitPos[2] : 1e9)) > 0.01){
    sun.userData.lastFitPos = [sun.position.x, sun.position.y, sun.position.z];
    fitShadowCamera();
    renderer.shadowMap.needsUpdate = true;
  }
  amb.color.copy(p.ambColor);  amb.intensity = p.ambIntensity;
  fill.color.copy(p.fillColor); fill.intensity = p.fillIntensity;
  hemiLight.color.copy(p.hemiSky); hemiLight.groundColor.copy(p.hemiGround);
  hemiLight.intensity = p.hemiIntensity;

  scene.fog.color.copy(p.fogColor); scene.fog.density = p.fogDensity;
  /* 夜段雾色上限（交接遗留 #7）：雾色明度不许高于天光 ——
     否则"夜+浓雾"里被雾吞掉的远山会比天空还亮（fogGray 把夜雾往亮灰拉，
     scene 侧比值收敛到 1.05 后渲染实测仍是亮斑：ACES tone mapping 对暗部有
     toe 抬升，雾色在屏幕上被额外提亮，所以 scene 侧必须压到天空的 0.9 倍）。
     以地平线天光为参照、**仅暗环境启用（白天天空亮、比值恒满足不触发）**；
     ⚠️⚠️ 2026-10-03 把这句话的**后半句证伪了**，但仍**保持原行为不改**（见下）；
     multiplyScalar 保色相，夜里仍是蓝黑调。

     ── 2026-10-03 量证（未改行为，记录在此防重复研究）──────────────────────
     原注释写的"白天天空亮、比值恒满足不触发"**方向是错的**：
     正午 `skyHorizon` #DCE7EC(lum 0.898) 与 `fogColor` #DCE3E2(lum 0.884) 只差 **1.4%**，
     比值满足**不是因为雾色不会再亮，而是因为雾色本来就和天光几乎同值**。
     实测（`outputs/_diag/band-scan.mjs`，正午·夏·晴·默认机位 1400×800）：
       · 176m 处 Exp2 雾吃掉 **57%** ⇒ 最远那层远山被 57% 混进一个"与天空同值"的颜色；
       · 四层叠剪影的**后两层整体并进天空**（far 层 176~207 vs 天 193~206）；
       · 画面上幅 y 48~101 是一条「天 100% · 亮度 ≥200 · 园景 0%」的平白带；
       · 而默认机位可见的天空只有地平线以上 **0~3°**（俯角 19.3° + 半 FOV 22.5°）
         ⇒ 整片可见天幕都落在 horizon 色里，本来就没有梯度。
     ⇒ 曾**试行**把本条钳制扩到全天候（亮环境 0.90），实测**收益只有约 1 luma**：
       `hill-guard` 脊线对比 −7.21 → −8.00，远层亮度 −2~3（因为 `lumOf` 算的是**线性**
       空间亮度，0.90 的线性比只相当于约 0.955 的 sRGB 比，而 multiplyScalar 也发生在线性空间）。
       **但代价是打破了 mist-guard §1「白天不该被钳位误伤」这条明确的设计保证
       （它断言"正午 scene 雾色 = 参数雾色"，当场报红，且那条判据守的是真意图、不是坏判据）。**
       收益 1 luma vs 打破既有白天观感保证且**无法在真屏上验收** ⇒ **已回退**。
     ⇒ 真正的修法不在这一条（幅度不够），在**山体卡片环向覆盖**（最远一层 8 张 × 26~54m
       ≈ 320m 对周长 1106m 只有 29% 覆盖）或**天端配色**，两条都是需要真屏拍板的美术取舍。
       完整数据与两个选项见 README「P1-0」。 */
  const hLum = lumOf(p.skyHorizon);
  if (hLum < 0.30){
    const fLum = lumOf(scene.fog.color);
    /* ⚠️ 系数 0.90 → **0.86**（2026-09-27，修 night+mist 的既存红：山 64.07 vs 天 62.42）。
       为什么 0.90 不够：这条钳制的**参照 `hLum` 本身就是被 mist 抬起来的**
       （`ENV_WEATHER.mist` 的 fogGray=0.26 把 skyHorizon 往亮灰拉）⇒ 上限 `hLum*0.90`
       水涨船高，钳制等于没做。实测越界幅度虽只有 0.15（容差 1.5 之上的边缘），
       但方向是"剪影反白发亮"，一眼假，必须压下去。
       0.86 仍**只在暗环境**触发（`hLum < 0.30`），白天天光恒远大于雾色 ⇒ 不影响日景；
       且它同时压低了雾本身，夜+浓雾的"雾里看山"会更有层次（山更暗、雾仍淡）。
       ⚠️ 别为了让它变绿去动 probe/mist-guard.mjs 的容差 —— 那条容差 1.5 有注释交代
       （山体基础色 + 抗锯齿抖动），产品侧压暗才是正解。 */
    const fMax = Math.min(hLum * 0.86, 0.15);
    if (fLum > fMax) scene.fog.color.multiplyScalar(fMax / fLum);
  }
  /* 环境贴图强度随天光走（见 ENV_BAKE_LUM 处的说明）：否则夜景里的石材/木材/水面
     仍在反射白天的天空，明明白墙已经暗下去了。
     ⚠️ 2026-09-25：反射**色**由 setEnvPreset 按时段缓存贴图解决（见下），
        这里只负责把**强度**标量调对 —— 两者互补，不要删掉任何一边。 */
  const curLum = (lumOf(p.skyTop) + lumOf(p.skyHorizon)) * 0.5;
  if (scene.environmentIntensity !== undefined){
    scene.environmentIntensity = Math.max(0.08, Math.min(1.25, curLum / ENV_BAKE_LUM));
  }
  /* PMREM 按时段缓存（2026-09-25）：不在 applyEnv 里调用（它会每帧兜底触发），改为
     在 setEnv 的时段变化后一次性切换缓存。稳态零重烘，过渡期间也不重烘（过渡用缓存的旧贴图）。 */
  // setEnvPreset 已移到 setEnv() 中时段变化后调用
  /* 远山 albedo 跟天光走（见 DISTANT_MATS 处的说明）：四层远山是 MeshBasicMaterial，
     不吃任何光，不跟着天光压暗的话夜里会在夜空上发亮（山 35.4 vs 天 16.9 的实测）。
     与上面 environmentIntensity **同源同算**，山和它背后的天同步变暗。
     floor 0.06：留一丝轮廓，别纯黑成一块死斑（夜山仍应有极淡的剪影可读）。
     ⚠️ 每次都从 baseColor 重算，不要就地乘 —— 就地乘会逐帧累积衰减成纯黑。
     ⚠️ 2026-09-22 晚曾把"柱状远树"也挂进这张表；2026-09-23 该层整层删除，本表回到四层远山。 */
  const hillAmb = Math.max(0.06, Math.min(1.0, curLum / ENV_BAKE_LUM));
  for (const m of DISTANT_MATS){
    m.color.copy(m.userData.baseColor).multiplyScalar(hillAmb);
    /* F6：山脊向雾色垂直渐变的目标色由 ShaderMaterial 的 fogColor uniform
       承担，three 每帧按 scene.fog 自动刷新，这里不用手动同步。 */
  }

  const su = skyMesh.material.uniforms;
  su.uTop.value.copy(p.skyTop);
  if (p.skyMid) su.uMid.value.copy(p.skyMid);
  su.uHorizon.value.copy(p.skyHorizon);
  su.uSunColor.value.copy(p.sunDisk);
  su.uSunDir.value.copy(sun.position).normalize();
  su.uCloudTint.value.copy(p.cloudTint);
  su.uCloudAmount.value = p.cloudAmount;
  // 阴天没有可见日轮 —— 阴霾给 diskFade=1 把天光里的日轮彻底抹掉，
  // 否则"阴天"的画面上会挂着一个亮太阳，一眼假
  su.uDiskFade.value = p.diskFade !== undefined ? p.diskFade : 0;
  // 星空也要被云遮掉：云量越大，星越少
  su.uStarAmount.value = p.starAmount * Math.max(0, 1 - (p.cloudAmount || 0) * 0.85);
  /* 七色彩虹（2026-09-30 雨后初晴 · 二轮）：虹心方向。
     ⚠️ **方位严格取太阳的反方向**（真实成因：背对太阳才看得到彩虹），但**仰角被抬起**
        到虹弧能落在天上 —— 因为物理上：正午（太阳仰角约 48°）反日点在地平线下同样角度，
        虹弧整体落到地平线以下 ⇒ **看不到**；而面板默认时段正是正午 ⇒ 用户一选这个场景
        永远看不到彩虹（实测反日点仰角恒为 −24°）。这是**明确的艺术性让步**：
        保方位（背对太阳）、抬仰角（保证可看）。targetElev = 0.62 − 太阳仰角×0.55
        （钳在 −0.25~0.45 rad ≈ −14°~26°），虹弧（42° 半径）便落在天上 20~60°。
     ⚠️ 太阳没升起来就没有虹（夜里/日出前）；夜里另按 uStarAmount 门控。
     ⚠️ **虹轴仰角定在 −15°~−24°**（2026-10-01 二次实测）：弧顶仰角 = 虹轴仰角 + 42°，
        所以 −15° ⇒ 弧顶 27°、−24° ⇒ 弧顶 18°。这是"虹落在园墙上方、不顶到画框
        上沿"的位置（改前是 −8°~−12° ⇒ 弧顶 30°~34° ⇒ 纵向 0%，虹顶压在画面顶端，
        老黄反馈"又高又远"）。
        真实成因是虹心恒与太阳反向、仰角 = −太阳仰角；正午太阳 47° 时虹心在地平线下
        47°、整条虹**物理上不可见** —— 抬到 −15°~−24° 是明确的艺术性让步
        （让彩虹在园林里看得见），别"修正"回物理值。
        第一版曾按物理取 target=0.62−太阳仰角×0.55，正午算出 9° ⇒ 弧顶 49°
        ⇒ **整条弧在画面外**。 */
  {
    /* ⚠️⚠️ 第九轮（2026-10-02，老黄："这个彩虹弧度太低了，角度不对，做得弧度再大一些，
       高一些；颜色过于鲜艳已经不真实了"）：虹的**几何本体**换成了 02-scene 里的
       **世界空间大拱**（那里有完整定案：球面环方案在默认机位 ±36° 窄视野里，矢高被
       几何锁死在 4~6°，"弧度太低"调参数原理上救不了 —— 前八轮一直在调错的东西）。
       ⇒ 方位（CAM_AZ）、弧窗（ARC_HALF/uArcAzOff）、虹轴仰角（target）这些
       **只有球面环才需要**的旋钮全部作废，本块只剩**强度通道**一条线：
         天气开关 × 时段乘子 rainbowMul × 白天门控 dayK × 夜间星量门控。
       ⚠️ rainbowMul（暮 2.20）是第八轮为"暮色暖背景同化暖色段"加的补偿，
       大拱几何下浓度整体降了一档（饱和 1.18 / 亮度 1.02），实测后可能要回落 ——
       先保留观察，别提前动。 */
    const sd = su.uSunDir.value;
    const sunElev = Math.asin(Math.max(-1, Math.min(1, sd.y)));
    const dayK = Math.max(0, Math.min(1, (sunElev - 0.02) / 0.12));
    const ru = rainbowMesh.material.uniforms;
    ru.uRainbow.value = (p.rainbow || 0) * (p.rainbowMul ?? 1) * dayK * (1 - Math.min(1, su.uStarAmount.value / 0.35));
  }

  renderer.toneMappingExposure = p.exposure;
  bloom.strength = p.bloomStrength;
  bloom.radius   = p.bloomRadius;
  bloom.threshold = p.bloomThreshold;
  if (gtaoPass) gtaoPass.blendIntensity = p.gtaoBlend;

  const gu = gradePass.uniforms;      // 写 pass 自己那份（模板是死的，见 composer 处的说明）
  gu.uContrast.value   = p.grade.contrast;
  gu.uSaturation.value = p.grade.saturation;
  gu.uWarmHi.value.copy(p.grade.warm);
  gu.uCoolLo.value.copy(p.grade.cool);
  gu.uSplit.value      = p.grade.split;
  gu.uVignette.value   = p.grade.vignette;

  lanternMat.emissiveIntensity = p.lamp * 1.15;
  if (lanternMat.userData.uLampS) lanternMat.userData.uLampS.value = p.lamp * 1.15;   // SSS 纸粒强度与发光同步
  /* ⚠️ 自发光 3.4 → 1.15（2026-09-21 方案 n2 二轮·特写实测）：3.4 在 ACES+bloom
     下把灯身整体打成纯白，"宫灯"退化成光球，腰鼓轮廓/纸纹/顶珠全部淹没。
     1.15 仍在 bloom 阈值 0.90 之上 → 光晕照旧挂得住，但灯面保留纸纹明暗，
     远看是亮点、近看是灯笼。 */
  /* 灯笼点光 = lamp 通道的第二个消费端（第一个是自发光强度）。
     以前这里**没人接线**：worldLights 被填进去却从没被读过，于是那两盏灯
     白天也以固定强度亮着 —— 既浪费又不真实。现在按时段走：晨/午 lamp=0 → 全灭，
     暮 0.25 → 微亮，夜 1.0 → 全亮。
     ⚠️ 只调 intensity、绝不切 visible：Three 的材质 program 缓存 key 含"参与渲染的灯数"，
     隐藏一盏 = 灯数变化 = 全场材质重新编译（几百毫秒卡顿）。强度归零仍占一点 ALU，
     换来的是切换环境时零重编译 —— 这笔交换是值的。 */
  for (const L of worldLights) L.intensity = L.userData.base * p.lamp;
  if (_lampVol){ _lampVol.uniforms.uLamp.value = p.lamp; _lampVol.uniforms.uRain.value = p.rainAmount || 0; }  // 体积光锥 alpha/散射随灯与雨
  if (_groundSplashMat){ _groundSplashMat.uniforms.uLamp.value = p.lamp; _groundSplashMat.uniforms.uRain.value = p.rainAmount || 0; }

  // 核显档的水面用天空色近似反射，天空一变它也要跟着变
  if (waterSurface){
    const wu = waterSurface.material.uniforms;
    if (wu.uSkyTop)     wu.uSkyTop.value.copy(p.skyTop);
    if (wu.uSkyMid && p.skyMid) wu.uSkyMid.value.copy(p.skyMid);
    if (wu.uSkyHorizon) wu.uSkyHorizon.value.copy(p.skyHorizon);
  }

  /* ── 季节：植被色调 / 存在性 / 动物行为 ── */
  seasonMixUniform.value = p.tintMix;
  /* 柳帘季节亮度：tint 是保明度换色，压不出"春芽发亮/夏翠深"的明度差 ——
     直接驱动叶帘材质底色（春 ×1.3 提亮，其余季节回落 1.0） */
  MAT.willowLeaf.color.setScalar(ENV.season === 'spring' ? 1.30 : 1.00);
  /* 竹叶春芽提亮（2026-09-16 用户反馈"春/夏竹叶无差别"）：seasonTint 换色是
     **保明度**的 —— 嫩绿 #8ecb58 的明度被 shader 拉回与本色一致（sLum/tLum≈0.42），
     春竹叶实际 = 本色 ×0.42 的暗绿，与夏几乎同色。与 willowLeaf 同一对策：
     copy 基色后春 ×1.35 抬亮度（1.35 下换色结果 ≈#85C758 鲜嫩绿，与夏 #4E8C36 拉满对比），
     其余季节回 1.0。copy 基色防 applyEnv 逐帧调用累积。 */
  MAT.leaf.color.copy(MAT._leafBase); MAT.leafDeep.color.copy(MAT._leafDeepBase);
  if (ENV.season === 'spring'){
    MAT.leaf.color.multiplyScalar(1.35);
    MAT.leafDeep.color.multiplyScalar(1.25);
  }
  /* 芭蕉假茎冬季枯株：压掉环境反射 —— 否则 PMREM 里草地/天空的绿会把
     tint 的枯黄褐（0x9C8A58）洗回暗橄榄绿，萧瑟残株读不出来 */
  MAT.banana.envMapIntensity = (ENV.season === 'winter') ? 0.05 : 0.5;
  MAT.banana.roughness = (ENV.season === 'winter') ? 0.96 : (MAT.banana.userData.dryRough || 0.7);
  for (const [mat] of SEASON_TINT_MATS){
    const u = mat.userData.seasonTint;
    const c = p[mat.userData.seasonKey];
    if (u && c) u.value.copy(c);
  }
  collectSeasonGLB();
  if (window.__ENVDBG){
    const wl = seasonMeshCache.get(MAT.wisteria) || [];
    const visBefore = wl.map(o=>o.visible?1:0).join('');
    console.log('[ENVDBG] p.wisteriaShow=' + p.wisteriaShow + ' cacheLen=' + wl.length +
                ' visibleBefore=' + visBefore.slice(0,20) + ' label=' + p.weatherLabel);
  }
  applyPresence(p);
  collectSeasonGLB();
  applyGLBSeason(p);
  for (const it of willowLeafInsts) it.o.count = Math.max(0, Math.round(it.max * p.willowLeaf));
  /* 竹叶季节叶量：春稀（0.55，抽竿后刚长叶）→ 夏茂（1.0）→ 秋微落（0.85）→ 冬常绿稍疏（0.65） */
  for (const it of bambooLeafInsts) it.o.count = Math.max(0, Math.round(it.max * p.bambooLeaf));
  /* 蜻蜓：季节管"存不存在"，天气管"飞不飞"。
     暴雨/风雪里蜻蜓是停栖的，不该照常游弋 —— 这是之前漏掉的一层天气修正。 */
  {
    const eff = effectiveWeather();
    const grounded = eff === 'storm' || eff === 'winterrain'
                  || (p.rainAmount || 0) > 0.4 || (p.windMul || 1) > 2.5;
    for (const d of dragonflies) d.visible = !grounded && p.dragonflyShow > 0.03;
    /* 停栖蜻蜓同口径：冬（dragonflyShow=0）与暴雨/风雪都藏起来。
       这里只写开关，位置在渲染循环里逐帧算（隐藏期间不更新，重现时从停栖态重算）。 */
    setPerchShowOK(!grounded && p.dragonflyShow > 0.03);
    /* 大雁（2026-09-30）：只跟**季节**（春/秋迁徙），不跟天气 ——
       雁在雨天照样飞（真雁阵雨天常见）。夏/冬 gooseShow=0 ⇒ 整队隐藏。
       ⚠️⚠️ 2026-10-02 第九轮：顺带按季节写**飞行方向**（老黄："从整个画面中从左到右
       （春季），从右到左（秋季）"）：春 +1（西→东 = 画面左→右）、秋 −1。
       dirSign 只在过渡期间（applyEnv 被调时）写 —— 但换季是 3s 过渡里发生的事，
       用户会看到"方向在 3 秒内翻转"，这正是期望的（南飞/北飞本来就是渐变的）。
       ⚠️ 立即生效：若用户正处在 gap 间隙（整队在画外），下一个波次就按新方向来，
       画面里读不出"方向突变"；不必为此中断当前波次。 */
    const gooseOn = p.gooseShow > 0.03;
    for (const g of geese) g.visible = gooseOn;
    GOOSE.dirSign = (ENV.season === 'autumn') ? -1 : 1;
  }
  for (const tw of swimTurtles) tw.visible = p.turtleShow > 0.03;

  /* ── 天气：风 / 积雪 / 湿地 ──
     ⚠️ 这里**不写** WIND.uWindStrength：applyEnv 只在过渡期间被调用，
     写在这里会立刻被每帧的 updateWind 覆盖（实测底值 2.2 → 0.153）。
     风力统一由 updateWind 每帧合成，这里只交代"阵风该有多猛"。 */
  gust.peakMul = p.gustMul !== undefined ? p.gustMul : 1;   // 狂风下随机阵风不再叠得很高
  snowUniform.value      = p.snowCover  !== undefined ? p.snowCover  : 0;
  if (p.snowTint) snowTintUniform.value.copy(p.snowTint);
  applyWetness(p.wetness !== undefined ? p.wetness : 0);

  /* 界面主题直接由**时段轴**决定，不由渲染出来的颜色反推。
     走这条路之前试过两种"算亮度"的写法，都栽在同一件事上：天气会改天色。
       · 用雾色：天气的"天光压灰"把雾色抬到中灰（夜+银装素裹 #767b81，亮度 0.196）
       · 用天空色：同一个压灰把 skyTop 从 #0b1220 抬到 #71767d（亮度 0.178）
     两次都是"夜里的暗场景"被判成亮场，面板在夜景里闪回一块白疙瘩。
     昼夜本来就是时段轴的语义（夜里就是暗），它有确定答案、不被任何天气手段污染，
     也正好对应面板上"晨/午/暮/夜"那四个字。暮色仍算亮场（面板压在夕阳上依然读得清）。 */
  const dark = (ENV.time === 'night');
  // 亮场：近黑字 + 暖白衬底（对比度由衬底兜底）
  // 暗场：暖白字 + 深衬底。字色不用纯白，夜里纯白会眩
  /* ⚠️ applyEnv 在 2.8 秒过渡里是**逐帧**被调用的，而主题只跟"时段轴"这个离散量有关：
     9 条 CSS 变量 × 168 帧 = 1500 次重复 DOM 写。只在真正翻转时写一次。 */
  if (dark !== uiLastDark){
  uiLastDark = dark;
  uiRoot.style.setProperty('--ui-fg',      dark ? '#f2efe6' : '#121417');
  uiRoot.style.setProperty('--ui-fg-dim',  dark ? '#dcd8ce' : '#26292e');
  uiRoot.style.setProperty('--ui-fg-hint', dark ? '#c4c0b6' : '#3a3e44');
  uiRoot.style.setProperty('--ui-panel',   dark ? 'rgba(18,22,28,.62)' : 'rgba(246,246,243,.60)');
  uiRoot.style.setProperty('--ui-bg',      dark ? 'rgba(52,58,68,.60)' : 'rgba(255,255,255,.50)');
  uiRoot.style.setProperty('--ui-bd',      dark ? 'rgba(232,230,224,.45)' : 'rgba(40,40,40,.42)');
  uiRoot.style.setProperty('--ui-sh',      dark ? '0 1px 3px rgba(0,0,0,.85)' : '0 1px 0 rgba(255,255,255,.75)');
  uiRoot.style.setProperty('--ui-on-bg',   dark ? 'rgba(240,236,226,.95)' : 'rgba(30,34,40,.92)');
  uiRoot.style.setProperty('--ui-on-fg',   dark ? '#14171c' : '#ffffff');
  }
}

/* ══ 植被季节表现 ══
   色调：给植被材质注入共享 uniform，按「保留明度的换色」重着色 ——
   色相换成季节目标色，明暗仍来自原贴图，这样叶簇的层次不会糊掉。
   ⚠️ 必须链式挂接 onBeforeCompile：叶/柳/苇已经有风场注入，直接覆盖会把风弄坏。 */
// 直接取登记表：这样连运行时克隆出来的材质（地面）也被覆盖
const SEASON_TINT_MATS = SEASON_TINT_REGISTRY.slice();
const seasonMixUniform = { value: 0 };
for (const [mat, key] of SEASON_TINT_MATS){
  const uni = { value: new THREE.Color(0xFFFFFF) };
  mat.userData.seasonTint = uni;
  mat.userData.seasonKey  = key;
  const prevCB  = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer){
    if (prevCB) prevCB.call(this, shader, renderer);
    shader.uniforms.uSeasonTint = uni;            // 共享同一对象：所有变体一起变
    shader.uniforms.uSeasonMix  = seasonMixUniform;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSeasonTint;\nuniform float uSeasonMix;')
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        '  float sLum = dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722));\n' +
        '  float tLum = max(dot(uSeasonTint, vec3(0.2126,0.7152,0.0722)), 0.06);\n' +
        '  diffuseColor.rgb = mix(diffuseColor.rgb, uSeasonTint * (sLum / tLum), uSeasonMix);');
  };
  mat.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : '') + '|season'; };
}

/* 存在性：程序化植被已被 mergeStatics 按材质合并，只能整体开关；
   GLB 资产（荷/芭蕉/龟）异步挂载、晚于合并，可以逐个控制。 */
/* ══ 上元灯会（河灯 / 灯串 / 挂灯 / 暖光第 4 层）⇒ 已移入 12c-festival.js（2026-10-05 拆分）══════
   原 1390~1892 行整块搬走（纯搬家，除 4 个声明补 export 前缀外逐字未改）；对外的 import / 转出
   写在文件顶部那一处（守卫要求显式 import）。灯会代码要的 6 样东西由本文件 body 里的
   bindFestival(...) 注入 —— 为什么不能反过来 import：见 12c-festival.js 文件头。 */

const SEASON_PRESENCE = [
  ['lotusShow',[MAT.lotus]], ['lilyShow',[MAT.lily]], ['wisteriaShow',[MAT.wisteria]],
  /* 芭蕉假茎**不进** presence 表（第八轮用户常识反馈）：芭蕉是多年生草本，
     冬季地上部枯萎但假茎宿存 —— 假茎的颜色由 tinBanana（冬=枯黄）表达，
     消失的只是冠层（GLB 叶+果，随 bananaShow 缩放/隐藏）。
     旧表把 MAT.banana 也挂在 bananaShow 上，冬天整株消失 = 把多年生当一年生。 */
  ['reedShow',[MAT.reed]],
  /* ⚠️ 莲蓬（莲实）必须跟着荷花一起消失。
     莲蓬的**杆**用 MAT.lily、**头与莲子**用 MAT.lotusPod —— 杆在表里、头不在，
     于是冬季 lilyShow=0 把杆藏了、头还留在水面上，看起来就是"悬空的莲蓬"。
     以后凡是"一株植物由多种材质拼成"，登记表必须把它**整套材质**都收进来。 */
  ['lotusShow',[MAT.lotusPod, MAT.lotusPodAged, MAT.lotusPodDark, MAT.lotusSeed]], ['bananaShow',[MAT.bananaFruit]],
  ['wisteriaShow',[MAT.wisteriaLeaf]],
  /* 桃花（2026-09-21）：花/果/落花/叶各自独立材质才能"只开该开的季节"——
     全植物用一种材质的话季节只能整棵树显/隐，做不出"春开花 → 夏结果 → 秋叶黄"。 */
  ['peachShow',[MAT.peachLeaf]], ['peachBlossomShow',[MAT.peachBlossom]],
  ['peachFruitShow',[MAT.peachFruit]], ['peachPetalShow',[MAT.peachPetal]],
  /* 灯会内容也走同一套存在性通道：festivalShow>0.03 才提交。 */
  ['festivalShow',[riverLampMat, riverFlameMat, stringBulbMat]],
  /* ── 2026-10-04 · 陈设（物）的季节通道 ──
     竹帘：夏挂冬撤（用户要的"低垂遮阳"，冬天还挂着就假）。
     卷轴挂画"随季节换画"：**两套画心 + 互补的存在性**，而不是运行时换 map ——
     这样直接复用既有"存在性每帧重申"机制（GTAO 每帧会把 visible 改回 true），
     不必在 applyEnv 里新增一条特殊分支。春/夏 = 青绿山水，秋/冬 = 秋山雪意。
     ⚠️ 材质必须是**共享**的那两份（MAT.bambooBlind / scrollArtCool / scrollArtWarm）：
     克隆一份就进不了这张表，冬天收不掉（莲子/莲蓬踩过三次，这是第四次重申）。 */
  ['blindShow',[MAT.bambooBlind]],
  ['scrollCoolShow',[MAT.scrollArtCool]],
  ['scrollWarmShow',[MAT.scrollArtWarm]],
];
const seasonMeshCache = new Map();
/* 填充已并入 collectSeasonCaches()（见 willowLeafInsts 一段）：一次遍历同时收
   柳/竹实例与 presence 材质表，并在延迟装配完成后重跑 —— 模块期一次性 traverse
   收不到 deferBoot 里迟到的物件（冬柳回归的根因）。 */
/* 存在性必须**每帧重申**，不能只在过渡里设一次。
   原因：GTAO pass 每帧都会把场景对象的 visible 临时关掉再改回来（AO 的正常做法），
   而 applyEnv 只在 ENV.t < 1 的过渡期间被调用 —— 过渡一结束，没人再重申，
   GTAO 就把 winter 的"花不存在"恢复成了 visible=true。实测就是这样：
     set true  | at gtao.render() <- renderer.render() <- animate()
   同一个根因之前也吃掉过"狂风底值风"。 */
export function applyPresence(p){
  for (const [key, mats] of SEASON_PRESENCE){
    const on = p[key] > 0.03;
    for (const m of mats){
      const list = seasonMeshCache.get(m);
      if (list) for (const o of list) o.visible = on;
    }
  }
  /* 实例化网格再补一道 count：visible 会被 GTAO pass 每帧改回 true，
     而 count=0 时 three.js 根本不提交实例，GTAO 也改不动它。
     花串是"每丛一个 InstancedMesh"（共 14 个），必须逐个处理，不能只认第一个。
     ── 2026-09-22：桃树三套材质改走**分量** count。季节表里 peachShow 春 0.15（先花后叶）、
     peachFruitShow 秋 0.7（果渐疏）、peachPetalShow 春 0.3 一直是小数，但可见性通道只认
     `> 0.03` 的布尔 —— 这三个小数**从来没生效过**：春天本该"花满树、叶刚萌"却直接挂满
     3800 片叶，秋天本该落掉三成果却一个不少。
     按 count 截前缀是唯一不会被 GTAO 冲掉的做法。桃树的实例写入顺序已在 makePeachTree 里
     按乘性散列打散，所以"截前缀"在空间上就是均匀变稀，而不是只掉半边。 */
  for (const [m, key, frac] of [[MAT.wisteria, 'wisteriaShow', false],
                                [MAT.peachLeaf, 'peachShow', true],
                                [MAT.peachFruit, 'peachFruitShow', true],
                                [MAT.peachPetal, 'peachPetalShow', true],
                                /* 河灯/灯串是 InstancedMesh：count=0 ⇒ three 不提交、GTAO 也改不动
                                   （同紫藤那条路的理由）。非灯会态零 draw call。 */
                                [riverLampMat, 'festivalShow', false],
                                [riverFlameMat, 'festivalShow', false],
                                [stringBulbMat, 'festivalShow', false]]){
    const list = seasonMeshCache.get(m);
    if (!list) continue;
    for (const o of list){
      if (!o.isInstancedMesh) continue;
      if (o.userData.fullCount === undefined) o.userData.fullCount = o.count;
      const full = o.userData.fullCount;
      const n = frac ? Math.round(full * Math.min(1, Math.max(0, p[key] || 0)))
                     : (p[key] > 0.03 ? full : 0);
      if (o.count !== n) o.count = n;
    }
  }
  /* ── 枯枝挂灯：走**直接清单**而不是上面的材质缓存表 ──
     ⚠️ 原因：挂灯网格是 `makePeachTree` 在 **deferBoot 延迟批**里建的，而
        `collectSeasonCaches()` 在装配收尾时跑 —— 时序上它能收得到，但**更关键**是
        挂灯网格是**每株桃树一个**、材质共用同一个 TREE_LANTERN_MAT，走材质表虽然也对，
        可它的存在性语义与"季节"无关（只随灯会），混进季节表反而容易被人误读。
        显式清单也和紫藤/柳叶那两组的做法一致（各自一份 max/count 记账）。
     ⚠️ 桃树是**两株**（西岸/北岸），必须整组处理 —— 只改第一个就会出现"一棵树挂灯、
        另一棵没有"（同紫藤只改第一个的老 bug）。 */
  const treeOn = p.festivalShow > 0.03;
  for (const o of treeLanternInsts){
    if (o.userData.fullCount === undefined) o.userData.fullCount = o.count;
    const n = treeOn ? o.userData.fullCount : 0;
    if (o.count !== n) o.count = n;
  }
  /* 柳/紫藤/围栏三批挂灯：同一条"随灯会"的通道，同样走**直接清单**而不是季节表。
     ⚠️ 容量取 `instanceMatrix.count`（建网格时定的），**不是** `o.count` —— count 是被本函数
        改写的量（下一行就写它），拿它当容量会第一次把 count 锁成 0、永不复原。 */
  for (const o of _hangInsts){
    const cap = o.instanceMatrix.count;
    if (o.userData.fullCount === undefined) o.userData.fullCount = cap;
    const n = treeOn ? o.userData.fullCount : 0;
    if (o.count !== n) o.count = n;
  }
}

/* 紫藤花串是**每丛一个 InstancedMesh**，不是整园共用一个：
   实测 14 个（实例数 508/697/702/…/4055）。
   ⚠️ 这里曾经只 find 了第一个并缓存成单个引用，结果冬季只清掉一丛，
   另外 13 丛照常开花 —— 画面看起来"紫藤冬天还在开花"。必须整组处理。 */
const seasonGLB = { LotusPlant: [], BananaPlant: [], Turtle: [] };
/* ⚠️ 不能"一旦非空就不再搜"。莲花 12 株是同一批挂上的没问题，但**乌龟有两批**：
   岸上晒背的 placeAssets 4 只 + 池中缓游的 loadAssetOnce 2 只 —— 先到的那批把数组填满后，
   后到的那批永远进不来，冬季 turtleShow=0 就只藏了一半。改为按对象去重地追加。 */
function collectSeasonGLB(){
  for (const name in seasonGLB){
    world.traverse(o => {
      if (o.isMesh && o.name === name && seasonGLB[name].indexOf(o) < 0) seasonGLB[name].push(o);
    });
  }
  /* ── GLB 荷花丛进风场（2026-09-17 用户："荷花和荷叶为啥不会随风晃动"）──
     GLB 材质的身份和芭蕉叶一样：异步挂载、材质是 GLB 自带的，
     从来没登记进风场表 —— 于是狂风里只有我们补的那根花梗在摆、花叶本体纹丝不动。
     这不仅是"不动"的问题：杆摆、花不摆，杆顶就会从花心里**脱出来**，
     又变回"杆没接上花"的样子。
     12 株共用同一个材质对象、且根部都在水面（y=0），所以 tip 模式的基准高度是同一个值，
     注一次即可 —— 用 Set 去重，避免每株各克隆一份（材质数 ×12 只会徒增 shader 变体）。
     幅度取 0.030，与同池的 MAT.lily（睡莲叶盘/程序化荷杆）完全一致：
     池面所有水生植物的摆动语汇统一，不会出现"这边狂摆那边死水"。
     位移硬顶同样取 5cm —— 用户要求"只能在水池中，不要穿模到岸边草皮或石头上"。 */
  const pending = new Set();
  for (const o of seasonGLB.LotusPlant){
    if (o.material && !o.material.userData.windInjected) pending.add(o.material);
  }
  for (const m of pending){
    const nm = m.clone();
    nm.userData.windInjected = true;
    addWind(nm, 0.030, 1.15, 'tip', 0.0, 0.05);
    for (const o of seasonGLB.LotusPlant) if (o.material === m) o.material = nm;
  }
}
/* 季节存在性 + 平滑缩放（GLB 用缩放而不是二值开关：冬季 lotusShow=0 才真消失，
   中间值如芭蕉 0.12 会缩到很小而不是突兀地整片闪掉）。
   独立成函数是为了"资产一到就立即套用当前状态"，不必等下一次环境切换。 */
function applyGLBSeason(p){
  for (const name in seasonGLB){
    const key = name === 'LotusPlant' ? 'lotusShow' : name === 'BananaPlant' ? 'bananaShow' : 'turtleShow';
    const v = Math.max(0.001, p[key]);
    for (const o of seasonGLB[name]){
      o.visible = p[key] > 0.02;
      let root = o; while (root.parent && root.parent !== world) root = root.parent;
      /* 芭蕉（多年生草本）：缩放目标优先取 userData.crown（冠层组）——
         假茎宿存不缩，冬季冠层隐藏 = "枯株"而不是"整株消失" */
      const target = root.userData.crown || root;
      if (target.parent === world || target.parent === root){
        if (!target.userData.baseScale) target.userData.baseScale = target.scale.clone();
        target.scale.copy(target.userData.baseScale).multiplyScalar(v);
      }
    }
  }
}
export function onAssetAttached(){
  collectSeasonGLB(); applyGLBSeason(ENV.cur);
  /* 迟到资产是**真投射物**（晒背龟/芭蕉/莲）：不光要补渲阴影图，
     包围盒也变了 —— 不重算的话阴影视体还是按旧轮廓拟合，新资产可能整个落在盒外。 */
  markCasterBoxDirty();
  fitShadowCamera();
  renderer.shadowMap.needsUpdate = true;   // 迟到资产含真投射物（晒背龟/芭蕉/莲），阴影图补渲一次
}
/* 登记给 06-vegetation 的 loadAssetOnce 回调（见 06 文件头的 HOOKS 说明）：
   06 不能静态 import 本模块 —— 本模块 body 早于 world 求值且 import 08，会把 08 提前拽进来。
   回调触发时（GLB 到位）一切早已就绪。 */
HOOKS.onAssetAttached = onAssetAttached;
/* 柳叶是实例化网格：改 count 就能做连续的「落叶」。
   ⚠️ 必须覆盖**每一棵柳树的叶片实例**。原来只记住 traverse 到的最后一个 MAT.willow 实例
   （4 棵柳树 ×（柳条 + 柳叶）共 8 个组），冬季只把其中一棵的叶子收掉，另外三棵照旧满树绿叶。
   与紫藤同一个根因：**同材质的实例化网格有多个，不能只认一个**。
   只标记 lInst（叶）；柳条是枝，冬季本就还在，不缩放。 */
const willowLeafInsts = [];
const bambooLeafInsts = [];
/* ⚠️ 收集必须能**重跑**（2026-09-19 冬柳回归）：
   柳/竹走 deferBoot 延迟装配，模块求值期 world 里根本没有它们 —— 这里收集到的永远是空表，
   于是 willowLeaf=0.02 写了个寂寞，冬季四棵柳照旧满树垂帘（用户截图实测：
   count 停在 8026/7830/7983/8327 满值）。凡"延迟批会塞东西进来"的缓存，
   必须在延迟批收尾处再调一次；所以收成函数，而不是模块期一次性 traverse。 */
export function collectSeasonCaches(){
  willowLeafInsts.length = 0;
  bambooLeafInsts.length = 0;
  const presence = new Map();                     // SEASON_PRESENCE 的材质 → mesh 表（一次遍历全收）
  for (const [, mats] of SEASON_PRESENCE) for (const m of mats) presence.set(m, []);
  world.traverse(o => {
    if (o.isInstancedMesh){
      if (o.userData.seasonWillowLeaf) willowLeafInsts.push({ o, max: o.count });
      if (o.userData.seasonBambooLeaf) bambooLeafInsts.push({ o, max: o.count });
      /* ⚠️ 不能在这里直接 return（2026-09-19 冬季紫藤照常开花的静默回归根因）：
         紫藤花穗也是 InstancedMesh（每丛一个），当年加柳/竹叶计数时把"所有实例网格"
         从 presence 收集里剔除了 → seasonMeshCache 里 MAT.wisteria 永远是空表
         → applyPresence 的 visible=false / count=0 全部落空，冬季 641 朵花照常提交。
         规则：实例网格凡材质登记在 presence 表里，照常收（柳/竹叶材质不在表里，互不干扰）。 */
      if (presence.has(o.material)) presence.get(o.material).push(o);
      return;
    }
    if (o.isMesh && presence.has(o.material)) presence.get(o.material).push(o);
  });
  for (const [m, list] of presence) seasonMeshCache.set(m, list);
  /* 挂点收集**挂在这里**（与季节缓存同一趟、且在其后）：柳/紫藤都在 deferRoot 延迟批里，
     必须在 collectSeasonCaches 之后才收得到（模块期收 = 空集，本项目老坑）。
     ⚠️ 本函数在启动里被调**两次**（initEnvScene 一次 = 延迟批之前；runDeferredBoot 收尾再一次
     = 延迟批之后）。第一次柳树还没进场 ⇒ 必须在"柳叶网格收齐"之前**拒绝建网格**，
     否则挂灯会按空集建好、永远补不上（这就是 willowLeaf 季节通道当年一直写不进去的同一类坑）。
     所以：柳叶网格为 0 时只返回、不落 built 标记、不建任何挂灯网格；围栏挂点与时机无关，
     但为保持"三个网格同生同死"的简洁，同样等柳叶到齐后一次性建。 */
  collectFestivalHangAnchors();
}
/* ⚠️ 这里**没有**顶层 `collectSeasonCaches()`：它 traverse `world`，而本模块被 08 import 而在
   world 之前求值 → 顶层调用必 TDZ。已并入下面的 initEnvScene（world 组装 + 合并之后才跑，
   这也正是原 §8→§12 的时序：缓存必须在合并后收，才能对上合并后的网格）。 */

/* ══ 天气表现 · 一 · 积雪 ══
   把「雪」做成朝上表面的着色，而不是给地面换一张贴图：
   顶点着色器算世界坐标与世界法线，片元按 upness 混白，并用世界坐标采一层多层 FBM 做斑驳
   （用世界坐标而不是 uv —— 合并几何后 uv 是各构件自己的，拼在一起会露出接缝）。
   雪在标准 PBR 里着色（不改 emissive 之类），所以它照样接受阴影与雾，看上去才是"落在地上"的。
   ❗ 必须链式挂接 onBeforeCompile：叶/柳/苇已有风场注入，季节色调也在同一个钩子上。 */
const snowUniform = { value: 0 };
let windBaseApplied = 0;
const snowTintUniform = { value: new THREE.Color(0xF2F6FA) };
function installSnow(list){
  for (const m of list){
    if (!m || m.userData.snowInstalled) continue;
    m.userData.snowInstalled = true;
    /* 补装路径（registerWeatherRoles 晚注册 → SNOW_HOOK）里材质可能**已经编译过**：
       改了 onBeforeCompile 与 customProgramCacheKey 之后必须标脏才会重新编译，
       否则"名单里加了它"这件事对画面毫无影响 —— 石头照样不积雪。首帧前全量装雪时无害。 */
    m.needsUpdate = true;
    const prevCB = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = function (shader, renderer){
      if (prevCB) prevCB.call(this, shader, renderer);
      shader.uniforms.uSnowCover = snowUniform;
      shader.uniforms.uSnowTint  = snowTintUniform;
      /* 室内剔除盒：从 PRECIP_INDOOR **就地求值**（盒沿 ±0.3 外扩：含墙厚余量，
         shader 里再留 0.2 平滑带，门洞处雪从门口往里渐隐不出硬缝；y 下界 −1.5
         连台基底一起罩住）。
         ⚠️⚠️ 不能在模块级提前 const 出来引用 PRECIP_INDOOR —— installSnow 的调用点
         （装配收尾）在 PRECIP_INDOOR 定义**之前**，模块级求值会 TDZ ⇒ 传进去
         undefined ⇒ three 上传 uniform 时 `value[i].toArray()` 抛
         "Cannot read properties of undefined" ⇒ **整页卡在加载页**（渲染循环每帧抛）。 */
      shader.uniforms.uInLo = { value: PRECIP_INDOOR.map(b => new THREE.Vector3(b.x0 - 0.3, -1.5, b.z0 - 0.3)) };
      shader.uniforms.uInHi = { value: PRECIP_INDOOR.map(b => new THREE.Vector3(b.x1 + 0.3, b.yTop + 0.15, b.z1 + 0.3)) };
      shader.uniforms.uInN  = { value: PRECIP_INDOOR.length };
      /* ⚠️⚠️ GLSL 里 `uInLo[6]` 的长度必须与 PRECIP_INDOOR.length **逐字一致**：
         three 按 GLSL 声明的数组长度注册 uniform（size=6），上传时按该长度 flatten，
         JS 侧少给一个 ⇒ `array[6]` 是 undefined ⇒ flatten 里 `toArray()` 抛
         "Cannot read properties of undefined" ⇒ **渲染循环每帧抛、整页卡在加载页**。
         （这就是刚才那一次的故障：盒子实际 6 个、GLSL 写了 7。）新增禁区盒子时两处同步。 */
      // 逐材质：薄叶面用自己的加成，没有登记的材质为 0（= 完全走原来的朝上判据）
      shader.uniforms.uSnowBoost = (this.userData && this.userData.snowBoost)
                                 ? this.userData.snowBoost : { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSnowW;\nvarying vec3 vSnowN;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n' +
          /* ⚠️ 这里原来用 normalMatrix —— 那是**视空间**法线，片元里却拿 vSnowN.y 当"朝上程度"。
             后果：一块不动的屋面，相机仰角一变积雪判定就变（同一朝上面在三种仰角下
             vSnowN.y = 0.999 / 0.707 / 0.100）—— 雪会跟着相机走。
             改用世界空间法线（模型矩阵 × 实例矩阵）；非均匀缩放下仍非严格逆转置，
             但归一化之后对"朝上程度"足够。 */
          '#ifdef USE_INSTANCING\n' +
          '  mat4 sM = modelMatrix * instanceMatrix;\n' +
          '  vec3 sN = mat3(modelMatrix) * mat3(instanceMatrix) * normal;\n' +
          '#else\n' +
          '  mat4 sM = modelMatrix;\n' +
          '  vec3 sN = mat3(modelMatrix) * normal;\n' +
          '#endif\n' +
          '  vSnowW = (sM * vec4(transformed, 1.0)).xyz;\n' +
          '  vSnowN = normalize(sN);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\n' +
          'varying vec3 vSnowW;\n' +
          'varying vec3 vSnowN;\n' +
          'uniform float uSnowCover;\n' +
          'uniform vec3 uSnowTint;\n' +
          'uniform float uSnowBoost;\n' +
          'uniform vec3 uInLo[6];\n' +
          'uniform vec3 uInHi[6];\n' +
          'uniform int uInN;\n' +
          'float snowHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }\n' +
          'float snowNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);\n' +
          '  return mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), u.x),\n' +
          '             mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), u.x), u.y); }')
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n' +
          '  if (uSnowCover > 0.001){\n' +
          '    // 平摊的薄叶面（竹叶/芭蕉等）法线基本水平，upness≈0，光靠朝上程度挂不住雪；\n' +
          '    // 用 uSnowBoost 给这类材质放宽：把 upness 的下限抬到"只要不是朝下就认"\n' +
          '    float upness = smoothstep(0.30, 0.78, vSnowN.y) * (1.0 - uSnowBoost)\n' +
          '                 + smoothstep(-0.15, 0.45, vSnowN.y) * uSnowBoost;\n' +
          '    float dr = snowNoise(vSnowW.xz * 0.65) * 0.62 + snowNoise(vSnowW.xz * 2.7 + 13.1) * 0.28\n' +
          '             + snowNoise(vSnowW.xz * 7.3 + 41.7) * 0.10;\n' +
          /* 覆盖量：噪声给斑驳的边缘（不是均匀刷白），阈值随 uSnowBoost 下移 ——
             只放宽 upness 是不够的：dr 的均值约 0.5，在 smoothstep(0.24,0.80) 下只有 ~0.47 的权重，
             薄叶面的雪就一直是"隐约有点白"，撑不起"雪压竹叶"这一笔。 */
          '    float lo = mix(0.24, 0.03, uSnowBoost);\n' +
          '    float hi = mix(0.80, 0.52, uSnowBoost);\n' +
          '    float amt = smoothstep(lo, hi, dr) * upness * uSnowCover;\n' +
          '    amt *= 1.0 + 0.25 * uSnowBoost;\n' +
          /* ⚠️ 室内剔除（2026-10-02）：盒子内的片元（堂内/廊下/亭下的地面与家具顶面）
             雪量归零 —— snowCover 只认"面朝上"，没有它堂内地面会与门外台阶雪连成一片
             （老黄实拍定性）。盒沿已在 JS 侧外扩 0.3，这里再留 ±0.2 平滑带：
             门洞处雪从门口往里渐隐，不出硬缝。y 下界 -1.5 连台基底一起罩住。 */
          '    float inK = 0.0;\n' +
          '    for (int i = 0; i < 7; i++){\n' +
          '      if (i >= uInN) break;\n' +
          '      vec3 lo2 = uInLo[i];\n' +
          '      vec3 hi2 = uInHi[i];\n' +
          '      vec3 inA = smoothstep(lo2 - vec3(0.2), lo2 + vec3(0.2), vSnowW);\n' +
          '      vec3 outA = 1.0 - smoothstep(hi2 - vec3(0.2), hi2 + vec3(0.2), vSnowW);\n' +
          '      vec3 mm = clamp(inA * outA, 0.0, 1.0);\n' +
          '      inK = max(inK, mm.x * mm.y * mm.z);\n' +
          '    }\n' +
          '    amt *= 1.0 - inK;\n' +
          '    diffuseColor.rgb = mix(diffuseColor.rgb, uSnowTint * (0.72 + 0.40 * dr), amt);\n' +
          '  }');
    };
    m.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : '') + '|snow'; };
  }
}
/* 湿地：只改材质参数，不动着色器 —— 粗糙度压下去，天空与树就会在石板上留下倒影。
   ⚠️ 2026-09-18 改过系数，原因见下（metalness 曾是 +0.20、rough 系数是 0.72）。 */
export let wetApplied = -1;
function applyWetness(v){
  // 每帧都会走到这里，但只有数值真的变了才写材质属性 —— 否则会一直把材质标脏
  if (Math.abs(v - wetApplied) < 0.004) return;
  wetApplied = v;
  wetUniform.value = v;
  for (const m of WET_MATS){
    if (!m || m.userData.dryRough === undefined) continue;
    /* 物理上的错：水是**电介质**，蒙一层水膜不会让石头/木/瓦长出金属度。
       旧式 metalness = dryMetal + 0.20·v² 把整个湿面变成半金属 —— 环境反射被按
       基色放大，于是暴雨里瓦面、石岸、草地都浮出一层顺视线的金色/白色高光带
       （用户报的"像有太阳透下来"，换个角度才明显，正是镜面反射的签名）。
       正确取法：只压粗糙度、金属度几乎不动（+0.05 只为让 IBL 反射稍微"接得住"）。 */
    m.roughness = m.userData.dryRough * (1 - 0.62 * v * v);   // 平方：小雨几乎无感，暴雨才成镜
    m.metalness = m.userData.dryMetal + 0.05 * v * v;
  }
}

/* ══ 四季自动演示（2026-09-25 · 计划书 Phase 3 第 8 项）══════════════════════
   与 REEL 的时辰流转不同：这里只推进 season，并复用导览机位与字幕。
   默认不自动播放，只由按钮启动；任意手动操作立即停止并恢复控制权。 */
const SEASON_DEMO_ORDER = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_DEMO_SHOTS = ['hall', 'pavilion', 'hero', 'overview'];
export const SEASON_DEMO = { on: false, phase: 'idle', idx: 0, hold: 0,
                             flyDur: 7, holdDur: 3.5, history: [] };
function syncSeasonDemoBtn(){
  const b = envEl && envEl.querySelector('[data-act="season-demo"]');
  if (!b) return;
  b.classList.toggle('on', SEASON_DEMO.on);
  b.setAttribute('aria-pressed', SEASON_DEMO.on ? 'true' : 'false');
  b.textContent = SEASON_DEMO.on ? '四季停■' : '四季▸';
}
function stopTourForDemo(){ if (TOUR.on) tourStop(); }
export function stopSeasonDemo(reason = 'manual'){
  if (!SEASON_DEMO.on) return false;
  SEASON_DEMO.on = false; SEASON_DEMO.phase = 'idle'; SEASON_DEMO.hold = 0;
  cancelCamFly('season-demo');
  hideCaption('season-demo');
  syncSeasonDemoBtn();
  return true;
}
function enterSeasonDemo(i, flyDur = SEASON_DEMO.flyDur){
  const idx = ((i % SEASON_DEMO_ORDER.length) + SEASON_DEMO_ORDER.length) % SEASON_DEMO_ORDER.length;
  const season = SEASON_DEMO_ORDER[idx];
  SEASON_DEMO.idx = idx; SEASON_DEMO.phase = 'flying';
  SEASON_DEMO.history.push(season);
  setEnv('season', season);
  showSeasonCaption(season);
  gotoViewpoint(SEASON_DEMO_SHOTS[idx], flyDur, 'season-demo');
  syncSeasonDemoBtn();
}
export function startSeasonDemo(opts = {}){
  const flyDur = Number.isFinite(opts.flyDur) ? Math.max(0.01, opts.flyDur) : SEASON_DEMO.flyDur;
  const holdDur = Number.isFinite(opts.holdDur) ? Math.max(0, opts.holdDur) : SEASON_DEMO.holdDur;
  SEASON_DEMO.flyDur = flyDur; SEASON_DEMO.holdDur = holdDur;
  if (REEL.on) toggleReel();
  stopTourForDemo();
  if (introActive()) introCancel();
  cancelCamFly();
  if (envEl.classList.contains('expanded')){
    const toggle = envEl.querySelector('.drawer-toggle');
    if (toggle) toggle.click();
  }
  SEASON_DEMO.on = true; SEASON_DEMO.history = []; SEASON_DEMO.hold = holdDur;
  enterSeasonDemo(0, flyDur);
  return true;
}
export function toggleSeasonDemo(){ return SEASON_DEMO.on ? (stopSeasonDemo('button'), false) : startSeasonDemo(); }
export function advanceSeasonDemo(dt){
  if (!SEASON_DEMO.on) return;
  if (CAM_FLY.on && CAM_FLY.owner === 'season-demo') return;
  if (SEASON_DEMO.phase === 'flying') SEASON_DEMO.phase = 'holding';
  SEASON_DEMO.hold -= dt;
  if (SEASON_DEMO.hold <= 0) enterSeasonDemo(SEASON_DEMO.idx + 1, SEASON_DEMO.flyDur);
}
export function seasonDemoUserTakeover(){ stopSeasonDemo('user'); }
export function seasonDemoState(){
  return { ...SEASON_DEMO, history: SEASON_DEMO.history.slice() };
}
export function seasonDemoCaption(){
  const el = document.getElementById('caption');
  return { shown: !!(el && el.classList.contains('show')),
           title: el && el.querySelector('b') ? el.querySelector('b').textContent : '',
           text: el && el.querySelector('span') ? el.querySelector('span').textContent : '',
           season: ENV.season };
}

/* ══ 状态机与过渡 ══ */
export const ENV = {
  time:'noon', season:'summer', weather:'clear',
  festival:false,                                 // 上元灯会（第 4 层开关，见 makeFestivalLights 一段）
  hour:12.5,                                   // 连续时辰（0~24）：按钮切时段只是对齐到锚点
  cur:null, from:null, to:null, t:1, dur:2.8,      // dur = 过渡时长（秒）
};
/* 拆分（2026-10-05）：三轴预设与合成规则在 12a-presets.js，它在函数体里**只读** ENV。
   ⚠️ 必须注入在下一行 `ENV.cur = resolveEnv()` **之前** —— 那一行一路会读 ENV.weather。 */
bindPresetsEnv(ENV);
ENV.cur  = resolveEnv();          // 必须走组合规则：季节通道也要在参数集里
ENV.from = cloneParams(ENV.cur);
ENV.to   = cloneParams(ENV.cur);
/* 发布给 2b-wind（它只在函数体里读 windMul，但若直接 import 本模块会成环 → 见 00-config
   的 ENV_REF 注释）。放在 ENV.cur 就位之后、applyEnv 之前：后续任何风力计算都拿得到。
   ⚠️ 发布的是**参数集 ENV.cur**，不是状态机 ENV —— windMul 挂在参数集上，发布错了对象会
   被读侧的 `|| 1` 静默兜底成晴天（2026-09-20 修）。ENV.cur 全程只在这里创建一次，之后由
   11-loop 的 mixInto(ENV.cur, from, to, t) **就地改写**、对象身份不变 → 发布一次即可，
   读到的恒为当前值。 */
ENV_REF.cur = ENV.cur;

/* 拆分（2026-10-05）：把环境状态机注入 12b-sky（电闪雷鸣 / 春节烟花在那边）。
   ⚠️ 必须在 body 里、且早于 11-loop 的 animate —— 那两个 tick 都从 animate 里调。
   ⚠️ 不作兜底：没注入的话那边读到 null 会立刻崩，好过静默退化成「永不闪电 / 永不放烟花」。 */
bindSkyEnv(ENV);

/* 拆分（2026-10-05）：把灯会那套代码要的东西注入 12c-festival.js（ENV / willowLeafInsts /
   worldLights / syncEnvUI / resolveEnv / cloneParams）。⚠️ 必须在这里调用：ENV 与 willowLeafInsts
   都已建好（前者在本行上方几行，后者在 const willowLeafInsts = [] 处），而灯会的任何函数都在
   更晚的 initEnvScene / collectSeasonCaches 里才被调用；⚠️ 不作兜底 —— 没注入那边读 null 立刻崩。 */
bindFestival(ENV, { syncEnvUI, resolveEnv, cloneParams, willowLeafInsts, worldLights });

/* 拆分（2026-10-05）：把环境状态机注入 12e-precip（雨雪粒子读 ENV.cur 的雨量/风、檐滴积水读 wetness）。
   ⚠️ 注入的是**状态机 ENV**、不是 ENV.cur —— 后者会被 mixInto 就地改写、setEnv 时又会换引用，
   传错对象会让读侧静默读到旧雨量（"雨一直下 / 雨永远不下"这类无声故障）。所以宁愿不要兜底：
   没注入那边读 null 立刻崩 —— 本轮第一版正是漏了这行，靠它立刻炸出来
   （`Cannot read properties of null (reading 'cur') at updatePrecip`），比无声故障好查得多。 */
bindPrecipEnv(ENV);

export function setEnv(axis, val){
  /* 先验后写 —— 这个函数挂在 window.__garden 上供外部驱动（采集脚本、控制台），
     一次 setEnv('time', undefined) 就会把 ENV.time 写成 undefined，画面卡住且每帧报错。
     合法的轴/值在这里一次性收口，非法调用直接忽略并留痕，状态机不被污染。 */
  /* ⚠️ 必须用 Object.hasOwn，不能靠 ENV_TIME[val] 的真值：继承来的键
     （constructor / toString / __proto__ …）都是真值，会被当成合法值写进 ENV，
     然后 resolveEnv 在 ENV_TIME['constructor'].label 上炸 ——
     实测 throw：Cannot read properties of undefined (reading 'saturation')，状态同时被污染。 */
  const table = axis === 'time' ? ENV_TIME
              : axis === 'season' ? ENV_SEASON
              : axis === 'weather' ? ENV_WEATHER : null;
  const legal = !!table && Object.hasOwn(table, val);
  if (!legal){
    console.warn('[ENV] 非法切换被忽略：', axis, '=', val);
    return;
  }
  if (ENV[axis] === val) return;
  ENV[axis] = val;
  if (axis === 'time') ENV.hour = TIME_ANCHORS[val];   // 时段按钮 = 把连续时辰对齐到锚点
  ENV.from = cloneParams(ENV.cur);      // 从「当前实际画面」出发，连点也不会跳
  ENV.to   = resolveEnv();
  ENV.t    = 0;
  /* PMREM 按时段缓存：切时段时一次性切换环境贴图（缓存命中则零烘焙）。
     不能在 applyEnv 里调 —— applyEnv 每帧兜底触发会反复烘或压成 'default' 键。 */
  if (axis === 'time' && ENV.to.skyTop){
    setEnvPreset({ key: val, skyTop: ENV.to.skyTop.getHex(), skyMid: ENV.to.skyMid.getHex(),
                   skyHorizon: ENV.to.skyHorizon.getHex(), sunDisk: ENV.to.sunDisk.getHex(),
                   ground: 0x5F7B45, sunPos: ENV.to.sunPos });
  }
  enforceWeather();                     // 非法组合在这里就被打回，不留非法状态
  syncEnvUI();
}

/* 天气互斥：银装素裹只在冬季合法；非冬季若被置成它，自动降级回"风和日丽"。
   "狂风暴雨在冬季渲染为风雪"不是降级 —— 它是合法组合，由 effectiveWeather() 决定表现。 */
export function weatherAllowed(weather){
  return weatherMutexReason(weather, ENV.season) === null;
}
/* 唯一的强制点。UI 置灰只是「提示」，不是「保证」：键盘、控制台、外部脚本都能绕过按钮，
   所以真正的降级必须发生在 setEnv 里 —— 否则会出现「夏季 + 银装素裹」这种非法状态留在画面上。 */
function enforceWeather(){
  if (weatherAllowed(ENV.weather)) return false;
  ENV.weather = 'clear';                                  // 降级目标：风和日丽
  /* ⚠️ 不要在这里瞬切（ENV.t = 1 + 立刻 applyEnv）。原来那样写，从"冬 + 银装素裹"
     切到春天会把画面**当场**换成风和日丽，2.8 秒过渡整段被跳过 —— 用户看到的是跳变。
     正确做法：先把目标归一化，再从当前画面平滑过渡过去。 */
  ENV.from = cloneParams(ENV.cur);
  ENV.to   = resolveEnv();
  ENV.t    = 0;
  return true;
}

export const envEl = document.getElementById('env');
/* P2-2：巡游期间用户在画布上的任何手动操作都算接管 → 停巡游。
   start 系事件（手按下/滚轮即停），不赌 change/end，低延迟。 */
renderer.domElement.addEventListener('pointerdown', tourUserTakeover);
renderer.domElement.addEventListener('wheel', tourUserTakeover, { passive: true });
renderer.domElement.addEventListener('pointerdown', seasonDemoUserTakeover, true);
renderer.domElement.addEventListener('wheel', seasonDemoUserTakeover, { passive: true, capture: true });
addEventListener('keydown', (e) => {
  if (!SEASON_DEMO.on || e.key.toLowerCase() === 'y') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  seasonDemoUserTakeover();
}, true);
envEl.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.dataset.act !== 'season-demo') seasonDemoUserTakeover();
}, true);
/* 合并时段条的读数气泡：钉在滑块圆球正上方（--r = hour/24，CSS 端 calc 定位） */
function placeHourTip(hour){
  const tip = document.getElementById('hourReadout');
  const track = document.getElementById('timeTrack');
  if (!tip || !track) return;
  const r = Math.max(0, Math.min(24, hour)) / 24;
  track.style.setProperty('--r', r.toFixed(4));
  tip.textContent = fmtHour(hour);
}
function syncEnvUI(){
  envEl.querySelectorAll('button').forEach(b=>{
    /* 动作按钮（明信片/音景/巡游/时光流转）无 data-axis：不参与环境轴状态同步 ——
       否则 ENV[undefined]===undefined 恒真，它们初始就被错误点亮 .on 高亮。
       ⚠️ 这里**必须**补齐 aria-pressed（不能跳过 data-act 的那几个）：
       smoke 断言「所有 env 按钮 aria-pressed 齐全」，动作按钮的初始属性正是靠
       这里补上的，漏一个就红。开关类（音景/巡游/流转/灯会）的真实按下态由各自的
       toggle* 维护；环境轴切换时本函数会把普通动作按钮归零，而灯会是与时段正交的第 4 层，
       必须继续保留自身状态。 */
    if (b.dataset.act === 'festival'){
      b.setAttribute('aria-pressed', ENV.festival ? 'true' : 'false');
      return;
    }
    if (b.dataset.act === 'blind'){
      const up = !!HOOKS.blindState?.();
      b.classList.toggle('on', up);
      b.setAttribute('aria-pressed', up ? 'true' : 'false');
      b.textContent = up ? '放帘' : '卷帘';      // 标签写"下一步做什么"，比"当前是什么"好用
      return;
    }
    if (b.dataset.act === 'season-demo'){
      b.setAttribute('aria-pressed', SEASON_DEMO.on ? 'true' : 'false');
      return;
    }
    if (b.dataset.quality){
      const q = HOOKS.qualityState?.();
      const on = (q?.mode || 'auto') === b.dataset.quality;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      return;
    }
    if (!b.dataset.axis){ b.setAttribute('aria-pressed', 'false'); return; }
    const axis = b.dataset.axis, v = b.dataset.v;
    b.classList.toggle('on', ENV[axis] === v);
    /* aria-pressed（P1-8）：所有 env 按钮都是 toggle 语义，选中态对读屏可感知 */
    b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false');
    if (axis === 'weather'){
      const why = weatherMutexReason(v, ENV.season);
      b.disabled = !!why;
      b.title = why || '';                       // 悬停给出原因（原生 tooltip，零成本）
    }
  });
  /* 滑杆跟 ENV.hour 对齐（时段按钮把 hour 拉回锚点时，滑杆位置同步走） */
  const hs = document.getElementById('hourSlider');
  if (hs && Math.abs(parseFloat(hs.value) - ENV.hour) > 0.05){
    hs.value = ENV.hour;
    placeHourTip(ENV.hour);
  }
  /* 2026-09-29 合并时段条：读数气泡 = 拖动提示，钉在滑块正上方跟随移动
     （老黄："拖动的时候具体时间要跟随进度条，提示用户拖到的时间点"） */
  const tip = document.getElementById('hourReadout');
  if (tip) tip.style.left = (Math.max(0, Math.min(24, ENV.hour)) / 24 * 100).toFixed(2) + '%';
}
envEl.addEventListener('click', (e)=>{
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.quality){ HOOKS.setQuality?.(b.dataset.quality); return; }
  /* 动作按钮（明信片/音景）没有 data-axis，先于环境轴处理，避免落进 setEnv 的非法告警 */
  if (b.dataset.act === 'shot'){ HOOKS.postcard?.(); return; }
  if (b.dataset.act === 'long'){ HOOKS.longExposure?.(); return; }
  if (b.dataset.act === 'sound'){ b.classList.toggle('on', !!HOOKS.sound?.()); b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false'); return; }
  if (b.dataset.act === 'reel'){ toggleReel(); return; }   // 时光流转（按钮态由 toggleReel 自己同步）
  if (b.dataset.act === 'random'){ seasonDemoUserTakeover(); HOOKS.randomScene ? HOOKS.randomScene() : randomScene(); return; }
  if (b.dataset.act === 'festival'){ toggleFestival(); return; }   // 上元灯会：一键开关（按钮态由 toggleFestival 自己同步）
  if (b.dataset.act === 'blind'){ HOOKS.blind?.(); syncEnvUI(); return; }   // 竹帘卷起/放下（状态在 14-props）
  if (b.dataset.act === 'season-demo'){ toggleSeasonDemo(); return; }
  /* P2-2 巡游开关：巡游中按任意导览/环境按钮都先停巡游（接管语义），再执行本意 */
  if (b.dataset.act === 'tour'){ seasonDemoUserTakeover(); TOUR.on ? tourStop() : tourStart(); return; }
  if (b.dataset.view || b.dataset.axis) seasonDemoUserTakeover();
  if (TOUR.on && (b.dataset.view || b.dataset.axis)) tourStop();
  if (REEL.on && b.dataset.axis === 'time') toggleReel();   // 手动选时段 = 接管，停时光流转
  if (b.dataset.view){
    /* ⚠️⚠️ 2026-10-05：「看烟花」必须**一键成立**。这个机位只在「冬 + 夜 + 无降水」下才有东西
       可看 —— 烟花绽放、星辰、池南看花的一家人**全都是这个门控**。而默认状态是 夏·正午，
       用户点它本意是"我要看烟花"，不是"我只想挪相机" ⇒ 只挪相机的结果就是
       "点了看烟花没有任何效果"（老黄 2026-10-05 的实测反馈）。所以先把场景设成那个状态再飞。
       其余机位不动 —— 它们不依赖时段/季节（不再顺手改）。 */
    if (b.dataset.view === 'fireworks'){
      setEnv('season', 'winter'); setEnv('time', 'night'); setEnv('weather', 'clear');
    }
    gotoViewpoint(b.dataset.view); showCaption(b.dataset.view, 'manual'); setTimeout(() => hideCaption('manual'), 6000); return;
  }
  /* 选"狂风暴雨"自动开启音景 —— 合并后暴雨带闪电，而闪电的核心观感之一就是雷鸣，
     没有声音等于没做一半。浏览器要求音频必须由用户手势创建，这次点击正好是手势。
     （雨后初晴不需要：它的彩虹是视觉，不需要开音景。） */
  if (b.dataset.axis === 'weather' && b.dataset.v === 'storm' && !HOOKS.sound?.()) HOOKS.sound();
  setEnv(b.dataset.axis, b.dataset.v);
  if (enforceWeather()) syncEnvUI();
});

/* ── 时辰滑杆 ──
   拖动 = 直接操纵时间轴：目标由「锚点插值 + 季节天气叠加」合成，从当前画面
   短过渡过去（0.45s 跟手）；松手把过渡节奏还给 2.8s 的默认值。 */
const hourSlider = document.getElementById('hourSlider');
hourSlider.addEventListener('input', ()=>{
  ENV.hour = parseFloat(hourSlider.value);
  tourUserTakeover();   // P2-2：拖时辰 = 接管，停巡游
  seasonDemoUserTakeover();
  if (REEL.on) toggleReel();   // 手动拖时辰 = 接管，停时光流转
  placeHourTip(ENV.hour);
  ENV.from = cloneParams(ENV.cur);
  ENV.to   = composeEnv(paramsAtHour(ENV.hour));
  ENV.t = 0; ENV.dur = 0.45;
  ENV.time = nearestTimeKey(ENV.hour);     // 按钮高亮 / UI 主题跟随最近锚点
  syncEnvUI();
});
hourSlider.addEventListener('change', ()=>{ ENV.dur = 2.8; });

/* ══ 时光流转（Showreel）：让 ENV.hour 自己走 ══
   按一下就什么都不用再点：晨 → 午 → 暮 → 夜 连续推进，日出日落、月起月落、灯笼点亮、
   星空浓淡、雾的厚薄全部跟着走 —— 它们本来就都由 hour 驱动，这里只是给它上发条。
   speed 单位「小时 / 秒」：0.4 → 一整天约 60 秒走完。 */
export const REEL = { on:false, speed: 0.4 };
export function toggleReel(){
  const next = !REEL.on;
  if (next) seasonDemoUserTakeover();
  REEL.on = next;
  const b = envEl && envEl.querySelector('button[data-act="reel"]');
  if (b){
    b.classList.toggle('on', REEL.on);
    b.setAttribute('aria-pressed', REEL.on ? 'true' : 'false');
    b.textContent = REEL.on ? '流转■' : '流转▸';
  }
  if (REEL.on && TOUR.on) tourStop();      // 两台马达别同时抢：巡游与流转互斥
  return REEL.on;
}
let reelUiAcc = 0, reelShadowAcc = 0;
export function advanceReel(dt){
  ENV.hour = (ENV.hour + REEL.speed * dt) % 24;
  const key = nearestTimeKey(ENV.hour);
  if (key !== ENV.time){ ENV.time = key; syncEnvUI(); }   // 按钮高亮只在跨锚点时刷，不必每帧
  const target = composeEnv(paramsAtHour(ENV.hour));
  /* ⚠️ from 与 to **都**传 target，不要 from 传 ENV.cur：mixInto 的 out 与 from
     若指向同一对象，非数值通道（Color / 数组）会边写边读被自己污染。
     from=to=target 且 e=1，等价于「直接落位到目标」，且零 clone。 */
  mixInto(ENV.cur, target, target, 1);
  ENV.from = target; ENV.to = target; ENV.t = 1;   // 状态保持一致，别让别的逻辑读到旧值
  applyEnv(ENV.cur);
  /* 阴影节流到 4Hz：0.25s 内太阳只走 0.1 小时（≈1.5°），肉眼不察，
     但 shadowMap 从「每帧重渲」降到每 0.25s 一次 —— 流转时的帧率才有保障。 */
  reelShadowAcc += dt;
  if (reelShadowAcc >= 0.25){ reelShadowAcc = 0; renderer.shadowMap.needsUpdate = true; }
  /* 滑杆 / 读数每帧写 DOM 太重，节流到 0.2s（滑杆 step=0.1，跟 60fps 也没意义） */
  reelUiAcc += dt;
  if (reelUiAcc >= 0.2){
    reelUiAcc = 0;
    const hs = document.getElementById('hourSlider');
    if (hs) hs.value = ENV.hour;
    const ro = document.getElementById('hourReadout');
    if (ro) placeHourTip(ENV.hour);
  }
}

/* ══ 偶得：随机一幅景色（2026-09-20）══
   "想继续点"的钩子：每按一下（或按 X）都值得截图。随机不是均匀抽——
   · 时段按出片率加权（暮的金光、夜的月与灯最出片；正午最平，权重最低）；
   · 季节均匀；
   · 天气先按所选季节过滤合法集（避免"抽雪得晴"的降级穿帮），再按时段调权
     （白天给阴/雨的戏剧性，夜里偏向晴与薄雾，保住月亮和萤火）；
   · 三连与当前完全相同就重抽；锚点时辰加 ±0.6h 抖动，同样是"暮"每次金光也深浅不同。
   返回 {label, time, season, weather, hour} 供 toast / 门禁使用。 */
const R_TIMES    = [['dusk',4],['night',4],['morning',2.5],['noon',1]];
const R_SEASONS  = ['spring','summer','autumn','winter'];
const R_W_BASE   = { clear:3, mist:2.4, storm:1.2, snow:1, afterrain:1.6 };
// 阴霾暗沉 2026-09-28 收起（权重并入薄雾）；电闪雷鸣 2026-09-30 并入狂风暴雨（hidden）。
// 雨后初晴 1.6：比暴雨高一档 —— 合并后暴雨变成"带雷电的雨"，随机池里若雨太多、
// 难得抽到一次"雨停了太阳出来"的画面。
function rwPick(items){
  let total = 0;
  for (const [, w] of items) total += w;
  let r = Math.random() * total;
  for (const [v, w] of items){ if ((r -= w) <= 0) return v; }
  return items[items.length - 1][0];
}
export function randomScene(){
  seasonDemoUserTakeover();
  if (REEL.on) toggleReel();                    // 流转中先停，否则马达立刻把灯会要设的时辰带走
  let time, season, weather, tries = 0;
  do {
    time = rwPick(R_TIMES);
    season = R_SEASONS[(Math.random() * R_SEASONS.length) | 0];
    const nightish = time === 'night';
    const pool = Object.keys(ENV_WEATHER)
      .filter(w => !ENV_WEATHER[w].hidden && weatherMutexReason(w, season) === null)
      .map(w => [w, (R_W_BASE[w] || 1) * (nightish ? (w === 'clear' || w === 'mist' ? 1.6 : 0.6) : 1)]);
    weather = rwPick(pool);
  } while (time === ENV.time && season === ENV.season && weather === ENV.weather && ++tries < 12);

  ENV.time = time; ENV.season = season; ENV.weather = weather;
  ENV.hour = (TIME_ANCHORS[time] + (Math.random() * 1.2 - 0.6) + 24) % 24;
  ENV.from = cloneParams(ENV.cur);
  ENV.to = resolveEnv(); ENV.t = 0;
  /* ⚠️ 标签必须取**兜底后的目标态** ENV.to.weatherLabel，不能取 weatherTag()：
     后者读 ENV.cur（上一帧画面），本函数可能被连发调用（探针连抽两次），
     两次之间没有动画帧 → cur 还是旧景色，会返回"抽 A 报 B"的穿帮标签。
     合法池已按季节过滤，enforceWeather 这里理论上不再降级——但返回值仍以它为准。 */
  enforceWeather();
  syncEnvUI();
  const hs = document.getElementById('hourSlider');
  if (hs) hs.value = ENV.hour;
  const ro = document.getElementById('hourReadout');
  if (ro) placeHourTip(ENV.hour);
  return {
    time, season, weather: ENV.weather, hour: ENV.hour,
    label: `${ENV_SEASON[season].label} · ${ENV_TIME[time].label} · ${ENV.to.weatherLabel}`,
  };
}
addEventListener('keydown', (e)=>{
  /* 别抢浏览器/编辑器快捷键：Ctrl+S、Cmd+R 之类必须原样放行；
     输入框里打字、输入法组合中、长按重复，也都不该切天气。 */
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
  const el = e.target;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  if (e.key === '0' || e.key === 'Home'){ tourUserTakeover(); seasonDemoUserTakeover(); resetCamera(); return; }   // 视角复位
  if (e.key === 'p' || e.key === 'P'){ HOOKS.postcard?.(); return; }     // 明信片
  if (e.key === 't' || e.key === 'T'){ seasonDemoUserTakeover(); TOUR.on ? tourStop() : tourStart(); return; }  // P2-2 巡游开关
  if (e.key === 'y' || e.key === 'Y'){ toggleSeasonDemo(); return; }
  /* 时光流转用 L：R 已经是「冬」，QWER 四键被季节占满，别抢。 */
  if (e.key === 'l' || e.key === 'L'){ toggleReel(); return; }
  /* 偶得随机景色：X（离右手位近，且未被占用） */
  if (e.key === 'x' || e.key === 'X'){ HOOKS.randomScene ? HOOKS.randomScene() : randomScene(); return; }
  if (e.key === 'z' || e.key === 'Z'){                                // 导览：巡览下一个机位
    tourUserTakeover();                                               // P2-2：巡游中按 Z = 接管，先停再走
    seasonDemoUserTakeover();
    const ids = VIEWPOINTS.map(v => v.id);
    const cur = VIEWPOINTS.findIndex(v => Math.abs(v.pos.x - camera.position.x) < 0.6
                                       && Math.abs(v.pos.z - camera.position.z) < 0.6);
    const nid = ids[(cur + 1 + ids.length) % ids.length];
    gotoViewpoint(nid); showCaption(nid, 'manual'); setTimeout(() => hideCaption('manual'), 6000);
    return;
  }
  if (e.key === 'm' || e.key === 'M'){                                // 音景开关（按钮态同步）
    const sb = envEl.querySelector('button[data-act="sound"]');
    if (sb) sb.classList.toggle('on', !!HOOKS.sound?.());
    return;
  }
  /* 竹帘卷起/放下：C（Curtain，2026-10-05 老黄要的"升起和放下"） */
  if (e.key === 'c' || e.key === 'C'){ HOOKS.blind?.(); syncEnvUI(); return; }
  const map  = { '1':'morning', '2':'noon', '3':'dusk', '4':'night' };
  const smap = { q:'spring', w:'summer', e:'autumn', r:'winter' };
  /* 2026-09-28：'阴霾暗沉'从菜单收起（老黄："和薄雾感官上太一致，保留薄雾"）——
     d 键空出；预设数据保留（mist-guard 仍可直调 setEnv 测试雾管线），想恢复一条线的事。 */
  /* 2026-09-30：'电闪雷鸣'并入'狂风暴雨'（老黄："这两个场景可以合并，空出一个格子"）
     ⇒ h 键空出，'j' 改为新场景「雨后初晴」。 */
  const wmap = { a:'clear', s:'storm', j:'afterrain', f:'snow', g:'mist' };
  const hit = map[e.key] || smap[e.key.toLowerCase()] || wmap[e.key.toLowerCase()];
  if (!hit) return;
  seasonDemoUserTakeover();
  if (map[e.key])  setEnv('time', hit);
  else if (smap[e.key.toLowerCase()]) setEnv('season', hit);
  else if (weatherAllowed(hit)){
    if (hit === 'storm' && !HOOKS.sound?.()) HOOKS.sound();   // 同点击：选暴雨自动开音景（它带雷声）
    setEnv('weather', hit);
  }                                          // 非法组合不走键盘这条捷径
  if (enforceWeather()) syncEnvUI();
});

/* ── 装配阶段收尾（2026-09-20 · 拆模块时从本模块顶层移出）──
   这四件事都必须在 08 把 world 组装完（且 mergeStatics 之后）才做：
     · makeLanterns  往 world 挂灯笼（动态单摆，必须留在合并之外）
     · syncEnvUI     把当前时段/季节/天气同步到面板按钮
     · applyEnv      首帧前按当前环境套一遍（它会写 08 的 perchShowOK —— 08 body 未跑就写必 TDZ）
     · installSnow   首帧渲染前装雪（onBeforeCompile，编译期才读 snowBoost，所以与下方
                     SNOW_BOOST 赋值块的先后无所谓）
   ⚠️ 相对顺序与本文件原顶层完全一致（灯笼 → UI → applyEnv → installSnow），只是整体推后到
   world 就绪之后。由 08 的 body 末尾调用。 */
/* ══ 电闪雷鸣 + 春节烟花 ⇒ 已移入 12b-sky.js（2026-10-05 拆分，纯搬家、逻辑一字未改）═══════
   原 2658~3304 行整块搬走；对外的转出写在文件顶部的 import 那一处（守卫要求显式 import），
   11-loop 与各门禁的 import 路径不用改。拆它的理由是长度：12-env 曾 3851 行，混着
   「天上事件」与「时段/季节/天气状态机 + 灯会 + 面板 UI」，改一处很难看清周围还有什么。
   恢复/搬家前先读 12b-sky.js 头部那四条纪律。 */

export function initEnvScene(){
  makeLanterns();
  makeFestivalLights();               // 河灯/烛焰/灯串（须在 collectSeasonCaches 前；桃树挂灯由延迟批后置显隐）
  collectSeasonCaches();             // 同步建的物件（紫藤叶/苇/荷盘…）不能等延迟批
  syncEnvUI();
  applyEnv(ENV.cur);
  installSnow(SNOW_COVER_MATS);      // 必须在**首帧渲染之前**装上：注入才进得了编译好的程序
  /* 挂上补装器：此后任何**晚注册**的雪材质（deferBoot 的立峰·云根就比这里晚）会立刻被装雪，
     不必再赌"它的注册是否早于装配收尾"—— 赌输不报错、不崩、状态全对，只是那块东西冬天
     不积雪（2026-09-20 实测竹竿与题名石刻都栽在这里）。installSnow 自带守卫 → 幂等。 */
  SNOW_HOOK.install = (m) => installSnow([m]);
}

/* 薄叶面（竹叶、芭蕉叶）法线接近水平，如果按"朝上程度"判积雪，它们永远挂不住雪 ——
   而"雪压竹叶"恰恰是冬景里最该有的一笔。给这些材质一个逐材质加成：
   upness 的下限放宽到"只要不是明显朝下就算"，其余材质仍走原来的严格判据。 */
/* ⚠️ 竹叶用的是 **MAT.leaf**，这份加成原来只写给了竹竿/芭蕉/水草 ——
   于是"雪压竹叶"从来没生效过（叶材质既不在雪表里、也没有 boost）。 */
const SNOW_BOOST = new Map([[MAT.bambooA, 0.85], [MAT.bambooB, 0.85], [MAT.banana, 0.60],
                            [MAT.leaf, 0.70], [MAT.leafDeep, 0.55],
                            [MAT.willowLeaf, 0.55],
                            [MAT.reed, 0.45], [MAT.lily, 0.35], [MAT.lotus, 0.35],
                            [MAT.bark, 0.25], [MAT.trunk, 0.25]]);
for (const [mat, boost] of SNOW_BOOST){
  mat.userData.snowBoost = { value: boost };
}

/* ══ 天气表现 · 二 · 雨 / 雪 + 雨后檐滴与积水 ⇒ 已移入 12e-precip.js（2026-10-05 拆分）═══════
   原 1848~2337 行整块搬走（纯搬家，除 PRECIP_INDOOR 补 export 前缀外逐字未改）；
   对外的 import / 转出写在文件顶部那一处。注意 PRECIP_INDOOR 仍被下面的积雪覆盖层
   （installSnow 的 uInLo/uInHi）借用，所以要从那边 import 回来。
   雨打水面的涟漪（updateRainRipples）**留在本文件**：它复用鱼跃涟漪池，属水面而不是天气。 */

/* 雨打水面：复用鱼跃涟漪的池子，按雨量把雨痕铺满池面。
   只有雨要，雪落在水里不出圈。 */
let rainRippleAt = 0;
export function updateRainRipples(t){
  const rain = ENV.cur.rainAmount || 0;
  if (rain < 0.05) return;
  if (t < rainRippleAt) return;
  /* 间隔随雨量缩放（细雨 ~0.9s、暴雨 ~0.17s），每次泼一小簇 2~4 圈：
     一轮实测（俯视终拍）仍是"中低密度"——14 槽上限下暴雨约 14 圈/s 生成、
     寿命 1.9s → 池子长期饱和在 14 圈，雨面才读得出"雨打水面"。
     圈径也随 strength 打散（0.7~1.3 随机），避免等径同心圆重演"声呐感"。
     夜间不跳过（旧版 ENV.time==='night' 直接 return）：夜暴雨里水面
     闪动的雨痕恰是气氛点 —— 强度 0.75 压低，别在墨水上闪成白环。 */
  const interval = 0.17 + (1 - rain) * 0.73;
  rainRippleAt = t + interval * (0.7 + Math.random() * 0.6);
  const cluster = 2 + Math.floor(Math.random() * (2 + Math.round(rain * 2)));
  const night = ENV.time === 'night';
  for (let k = 0; k < cluster; k++){
    /* 雨滴配额随容量同比放大：64 槽时留 3/4 给点击与鱼跃（上限 44），
       否则暴雨会把池子占满 —— 表现是"点了没反应"，且不报错。
       ⚠️ 这个数字必须与 06-vegetation 的 RIPPLE_N 一起看，改容量就要改这里。 */
    if (rainRippleActive >= 44) break;
    const a = Math.random() * TAU, r = Math.sqrt(Math.random());
    const strength = (night ? 0.75 : 1.0) * (0.7 + Math.random() * 0.6);
    spawnRipple(Math.cos(a) * 12.5 * r, 3.0 + Math.sin(a) * 6.4 * r, t,
      rain > 0.8 ? 3 : 2, strength, 'rain');
  }
}

