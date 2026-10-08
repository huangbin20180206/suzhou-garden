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
/* 2026-10-05 拆分：植被季节表现 + 存在性 + 积雪/湿地已搬进 12f-season.js（那边不能 import 本模块，故注入 ENV）。 */
import { bindSeasonEnv, SEASON_TINT_MATS, seasonMixUniform, seasonMeshCache, applyPresence,
         collectSeasonCaches, onAssetAttached, applyGLBSeason, collectSeasonGLB, willowLeafInsts,
         bambooLeafInsts, snowUniform, snowTintUniform, installSnow, applyWetness, wetApplied } from './12f-season.js';
export { applyPresence, collectSeasonCaches, onAssetAttached, wetApplied };
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
    /* 大雁（2026-09-30）：按**季节**迁徙（春/秋 gooseShow=1，夏/冬 0 ⇒ 整队隐藏）。
       ⚠️⚠️ 2026-10-05 老黄："春秋季大雁在狂风暴雨场景依旧在天上飞，这个不合理" ⇒ 加**恶劣天气落地**：
       判据用**参数**而不是天气名（`rainAmount / snowAmount` 够大就不飞）—— 真雁遇狂风暴雨/风雪会落地
       避险；薄雾、雨后初晴（rain=0）照飞，小雨也照飞（原注释"雁在雨天照样飞"对小雨成立、对暴雨不成立）。
       ⚠️⚠️ 2026-10-02 第九轮：顺带按季节写**飞行方向**（老黄："从整个画面中从左到右
       （春季），从右到左（秋季）"）：春 +1（西→东 = 画面左→右）、秋 −1。
       dirSign 只在过渡期间（applyEnv 被调时）写 —— 但换季是 3s 过渡里发生的事，
       用户会看到"方向在 3 秒内翻转"，这正是期望的（南飞/北飞本来就是渐变的）。
       ⚠️ 立即生效：若用户正处在 gap 间隙（整队在画外），下一个波次就按新方向来，
       画面里读不出"方向突变"；不必为此中断当前波次。 */
    const fowlGrounded = (p.rainAmount || 0) > 0.5 || (p.snowAmount || 0) > 0.5;
    const gooseOn = p.gooseShow > 0.03 && !fowlGrounded;
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

/* ══ 植被季节表现 + 存在性 + 积雪/湿地 ⇒ 已移入 12f-season.js（2026-10-05 拆分）════════════
   原 403~780 行整块搬走（纯搬家，除 11 个声明补 export 前缀外逐字未改）；对外的 import / 转出在
   文件顶部那一处。applyEnv 里要用的 SEASON_TINT_MATS / seasonMixUniform / seasonMeshCache /
   snowUniform / snowTintUniform / willowLeafInsts / bambooLeafInsts 都从那边 import 回来。 */

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

/* 拆分（2026-10-05）：把环境状态机注入 12f-season（onAssetAttached 要按 ENV.cur 重刷一次季节）。
   与其它注入一样不做兜底：没注入那边读 null 立刻崩，好过静默不换季。 */
bindSeasonEnv(ENV);

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
  /* ⚠️⚠️ 换场景 ⇒ 灯会收起（2026-10-06 老黄："选过'灯会'场景，切换其它场景，灯会的布景
     一直带到其它场景中，这个应该也是 bug"）。收口放在 setEnv 里 = 季节/天气/时段按钮、
     四季演示、偶得、控制台**全走这一条**；且必须在"同值早退"**之前** —— 在灯会里再点一次
     「夜」也算重新选场景，同样要能退出。收起时它会按既有规矩把时段还给"进来之前"
     （用户自己改过时段就不抢，见 12c 的 toggleFestival）。
     ⚠️ 例外：烟花的一键预设要**保留**灯会（老黄认可两者同时出现）⇒ 用 _keepFestival 抑制。 */
  if (!_keepFestival && ENV.festival) toggleFestival(false);
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
    /* 「看烟花」两档开关（2026-10-06）：按下态 = 画面里**真的在放**（fireworksState().on），
       不是内部标志 —— 用户自己改天气/换季时它会自动灭，按钮永不说谎。 */
    if (b.dataset.act === 'fireworks'){
      const on = !!(fireworksState && fireworksState().on);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      return;
    }
    if (b.dataset.act === 'blind'){
      const up = !!HOOKS.blindState?.();
      b.classList.toggle('on', up);
      b.setAttribute('aria-pressed', up ? 'true' : 'false');
      /* ⚠️ 2026-10-06 老黄："陈设这一行所有按钮名称全部改为两个字：珠帘-灯会-烟花-彩虹-鱼趣"
         ⇒ 标签**不再随状态改写**（原来这里是 up ? '放帘' : '卷帘'），恒定显示"珠帘"，
         卷/放两态由 .on 高亮 + aria-pressed + title 表达（与其它按钮同格式）。 */
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
     （老黄："拖动的时候具体时间要跟随进度条，提示用户拖到的时间点"）
     ⚠️⚠️ 2026-10-06（第 6 条反馈）：气泡的**位置**改由 CSS 一处负责 ——
       `left: calc((100% - var(--thumb)) * var(--r) + var(--thumb)/2)`
       （球径 = CSS 变量 --thumb，桌面 18px、触屏档 26px，与 thumb 同值）。
       旧的这里写的是 `tip.style.left = ratio*100 + '%'`，那是"占整条百分比"，
       与"圆球中心"差半个球径，越靠右偏得越多（实测 21.5 时偏 11px，老黄截图里
       气泡就是压在圆球右边）。inline 样式优先级最高，会把上面那条 CSS 公式整个盖掉，
       所以这里必须先把它清掉、只负责写入 CSS 变量 --r（与 placeHourTip 同一套口径）。 */
  const tip = document.getElementById('hourReadout');
  if (tip){
    if (tip.style.left) tip.style.removeProperty('left');   // 清掉旧口径留下的 inline left（幂等）
    const tr = document.getElementById('timeTrack');
    if (tr) tr.style.setProperty('--r', (Math.max(0, Math.min(24, ENV.hour)) / 24).toFixed(4));
    tip.textContent = fmtHour(ENV.hour);
  }
}
/* ══ 「看烟花」两档开关（2026-10-06 · 老黄："灯会和烟花最好还是做成和帘子一样（开和关两档
      控制即可）"，并认可"两者可以同时出现"）═══════════════════════════════════════════
   旧实现是 data-view：点一下 = 设 冬·夜·晴 + 飞到「看烟花」机位，**没有"关"这一档**
   （想关只能自己去改天气/时段，而那时按钮态与画面脱节）。
   现在按帘子的语义做两态：
     开 = 记住当前 季节/时段/天气 → 设成 冬·夜·晴（烟花的门控，见 12b 的 FW_ALLOWED）→ 飞去看花；
     关 = 还回进来之前的场景；若本来就处在"冬·夜·晴"（烟花默认就在放），
          则用产品侧的权威开关 setFireworksForce(false) 明确压掉（否则"还回原场景"= 没变化）。
   ⚠️ 与灯会**可同时存在** ⇒ 开关里用 _keepFestival 抑制 setEnv 的"换场景收起灯会"。
   ⚠️ 按钮的按下态一律由 **fireworksState().on（画面里真的在放）** 推导，不是内部标志：
      用户自己把天气改成暴雨、或切到夏天，按钮会自动灭 —— 状态永不说谎。
   ⚠️ 任何环境轴切换都会把 setFireworksForce 复位成 null（= 交还给门控），
      否则"关一次"会永久压住这个场景的烟花。 */
let _fwPrev = null, _keepFestival = false;
/* ⚠️ 有几个"按钮态读的是下一帧才翻面的量"（烟花是否在放由门控决定，setEnv 只改 ENV 目标，
   applyEnv/tickFireworks 下一帧才跑）⇒ 立刻 syncEnvUI 读到的是旧值，按钮会"该灭不灭/该亮不亮"
   （实测：点开烟花后 aria-pressed 仍是 false；换成暴雨后烟花已灭、按钮还亮着）。
   统一用这个延迟同步把状态对齐 —— 面板层唯一的异步点，其余 UI 都是同帧落位。 */
function syncEnvSoon(){ for (const ms of [120, 400, 900]) setTimeout(() => syncEnvUI(), ms); }
export function toggleFireworksScene(){
  const flying = !!(fireworksState && fireworksState().on);
  if (flying){                                   // 关
    _keepFestival = true;
    try {
      const p = _fwPrev;
      if (p){
        setEnv('season', p.season); setEnv('weather', p.weather);
        /* ⚠️ 时段只在**灯会不在场**时还回去：灯会本身就是夜场景，若把它一起拽回正午，
           就成了"白天挂着灯串河灯"（灯会 + 烟花同时开时按"看烟花"的关，正好踩到这里）。 */
        if (!ENV.festival) setEnv('time', p.time);
      }
      setFireworksForce(false);                  // 画面已不在烟花预设时，"还回场景"改不动它 ⇒ 明压
    } finally { _keepFestival = false; }
    _fwPrev = null;
  } else {                                       // 开
    _fwPrev = { season: ENV.season, time: ENV.time, weather: ENV.weather };
    setFireworksForce(null);                     // 交还门控（用户可能刚从"关"那一档回来）
    _keepFestival = true;
    try {
      setEnv('season', 'winter'); setEnv('time', 'night'); setEnv('weather', 'clear');
    } finally { _keepFestival = false; }
    gotoViewpoint('fireworks');                  // 这个机位是**必需品**（默认俯视机位看不到天上的花）
    showCaption('fireworks', 'manual'); setTimeout(() => hideCaption('manual'), 6000);
  }
  syncEnvUI();
  syncEnvSoon();          // 烟花是否在放由门控下一帧才翻面（见 syncEnvSoon 注释）
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
  if (b.dataset.act === 'fireworks'){ toggleFireworksScene(); return; }   // 看烟花：两档开关（2026-10-06 由 data-view 改成 data-act）
  if (b.dataset.act === 'blind'){ HOOKS.blind?.(); syncEnvUI(); return; }   // 珠帘卷起/放下（状态在 14-props）
  /* 鱼趣（2026-10-06 老黄："功能和鼠标点击池水投入鱼食效果一样，只不过鼠标点击是用户主动选择
     位置，但这个按钮是鱼食掉落在池塘中的随机位置"）：与"点池水撒饵"走**同一个产品函数**
     （11-loop 在 pointerdown 里调 dropBait），这里经 HOOKS.feedBait 转发；位置取池内随机点 ——
     池心世界 (0, 3)、半径 1.6~3.6 稳稳在池里（dropBait 自己还会按岸线 0.95 夹紧，越界也安全）。
     运行期交互用 Math.random 是允许的（铁律 1 的"运行期效果"一档，与涟漪/音景同族）。 */
  if (b.dataset.act === 'fish'){
    const a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 2.0;
    HOOKS.feedBait?.(Math.cos(a) * r, 3.0 + Math.sin(a) * r);
    return;
  }
  if (b.dataset.act === 'season-demo'){ toggleSeasonDemo(); return; }
  /* P2-2 巡游开关：巡游中按任意导览/环境按钮都先停巡游（接管语义），再执行本意 */
  if (b.dataset.act === 'tour'){ seasonDemoUserTakeover(); TOUR.on ? tourStop() : tourStart(); return; }
  if (b.dataset.view || b.dataset.axis) seasonDemoUserTakeover();
  if (TOUR.on && (b.dataset.view || b.dataset.axis)) tourStop();
  if (REEL.on && b.dataset.axis === 'time') toggleReel();   // 手动选时段 = 接管，停时光流转
  if (b.dataset.view){
    /* ⚠️ 「看烟花」已改成 data-act 的两档开关（2026-10-06，见 toggleFireworksScene）——
       这里原来那段"点 data-view='fireworks' 就设 冬·夜·晴 再飞"的代码已随之删除，
       别再往 data-view 里加烟花逻辑。 */
    /* 同理（2026-10-06）：「看彩虹」也必须是**一键成立**的 —— 虹只在 **雨后初晴 + 白天** 出现
       （夜里按 uStarAmount 门控自动消失；其它天气为 0）。默认状态是 夏·正午，用户点它本意是
       "我要看那道拱"，不是"我只想挪相机" ⇒ 先把时段与天气设好再飞。
       季节**不动**（虹与季节无关，别顺手改）；时段取**暮色**（ENV_TIME 的 rainbowMul 在暮色
       最大、且 afterrain-guard 的参照实测都在暮色）。 */
    if (b.dataset.view === 'rainbow'){
      setFireworksForce(null);                 // 换场景 ⇒ 交还门控（用户可能刚按过"看烟花的关）
      setEnv('time', 'dusk'); setEnv('weather', 'afterrain');
    }
    /* ── 「红梅」「腊梅」同理（2026-10-08 · 老黄："这两颗梅花树我就怎么都不能拉近镜头看到细节"）──
       梅是**冬季开花**（plumBlossomShow 冬 1.0 / 夏 0），默认状态是夏 ⇒ 飞过去只会看到一株
       长满绿叶的树（实测留档图判读"没拍到梅花，中央是一团深绿色叶球"）。
       机位的名字承诺了"看梅"，就必须把那个体验所需的状态设好 ——
       ⇒ 只把**季节**设成冬（花就在），**天气/时段不动**（他可能就是想在"银装素裹"或夜里看梅，
         替他改天气反而会毁掉他要的场景）。 */
    if (b.dataset.view === 'plumRed' || b.dataset.view === 'plumYellow'){
      setEnv('season', 'winter');
    }
    gotoViewpoint(b.dataset.view); showCaption(b.dataset.view, 'manual'); setTimeout(() => hideCaption('manual'), 6000); return;
  }
  /* 选"狂风暴雨"自动开启音景 —— 合并后暴雨带闪电，而闪电的核心观感之一就是雷鸣，
     没有声音等于没做一半。浏览器要求音频必须由用户手势创建，这次点击正好是手势。
     （雨后初晴不需要：它的彩虹是视觉，不需要开音景。） */
  if (b.dataset.axis === 'weather' && b.dataset.v === 'storm' && !HOOKS.sound?.()) HOOKS.sound();
  /* ⚠️ 换场景 ⇒ 灯会收起 / 烟花的"关"latch 交还门控（2026-10-06，规矩见 setEnv 里那段注释：
     setEnv 内部只在"真的改了轴"时收灯会；**同值点击**这里也要收，所以在面板这一层显式做一次）。 */
  if (ENV.festival) toggleFestival(false);
  setFireworksForce(null);
  setEnv(b.dataset.axis, b.dataset.v);
  if (enforceWeather()) syncEnvUI();
  syncEnvSoon();          // 换天气可能让烟花的门控翻面 ⇒ 按钮态延后对齐
});

/* ── 时辰滑杆 ──
   拖动 = 直接操纵时间轴：目标由「锚点插值 + 季节天气叠加」合成，从当前画面
   短过渡过去（0.45s 跟手）；松手把过渡节奏还给 2.8s 的默认值。 */
const hourSlider = document.getElementById('hourSlider');
hourSlider.addEventListener('input', ()=>{
  /* 拖时辰 = 换场景 ⇒ 灯会收起、烟花 latch 交还（同面板按钮那条规矩；滑杆不走 setEnv）。 */
  if (ENV.festival) toggleFestival(false);
  setFireworksForce(null);
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
  syncEnvSoon();                           // 拖时辰可能让烟花的门控翻面 ⇒ 按钮态延后对齐
});
hourSlider.addEventListener('change', ()=>{ ENV.dur = 2.8; });
/* 快捷键提示开关（2026-10-06 老黄："多一个快捷按钮的复选框，选中就出现选择键的提示，
   不选中就不显示快捷键，默认情况下不显示"）：body.show-keys 控制所有 .hint
   （#hourReadout 时辰气泡除外，它不是快捷键），选择存 localStorage。 */
{
  const sk = document.getElementById('showKeys');
  if (sk){
    const apply = (v) => { document.body.classList.toggle('show-keys', !!v); sk.checked = !!v; };
    let saved = '0';
    try { saved = localStorage.getItem('garden.showKeys') || '0'; } catch (e) { /* 隐私模式：忽略 */ }
    apply(saved === '1');
    sk.addEventListener('change', () => {
      apply(sk.checked);
      try { localStorage.setItem('garden.showKeys', sk.checked ? '1' : '0'); } catch (e) { /* 同上 */ }
    });
  }
}

/* ══ 按钮图标（2026-10-06 老黄："所有按钮都学灯会一样，文字+中式小图标来呈现，形成统一的格式
      和布景"）═══════════════════════════════════════════════════════════════════════
   一张表 + 一遍遍历把 `data-ic` 打到每个按钮上，图标由 CSS 的 ::before 画出来（见 index.html）。
   ⚠️ **不改 DOM 结构、不加子元素** ⇒ 按钮的 textContent 仍是纯标签文字，
      各探针按文字认按钮的口径（panel-check2 / _ui-click-diag 等）一位不变。
   图标统一取"淡墨印记"一族的几何/花卉符号（与既有的 ▸ ✦ ▽ 同风格），不用彩色 emoji。
   ⚠️ 图标字形**不许和按钮标签里已有的字符重复**：`巡游▸`/`流转▸`/`长曝▽` 这些标签自带一个
      状态指示符，若图标也用同一个字形，就成了"▸ 巡游▸"这种叠字（2026-10-07 上色后更明显：
      前面是彩色 ◈、后面还跟着一个墨色 ▸）。
      ⇒ act:tour 用 ◈（不是标签里出现过的字符）；act:random 原用 ✦ 而标签「偶得✦」也带 ✦，
      留档图上照样读成"重复的四角星"（✷ 与 ✦ 在 11px 下看不出差别）⇒ **把标签的 ✦ 去掉**
      （它只是装饰，不是状态），改成与邻居一致的两字名「偶得」，星形只留给彩色图标。
      门禁 probe/panel-icons-guard.mjs 有一条专门守"textContent 含 data-ic 字形即报红"。 */
{
  const ICON = {
    'season:spring': '❀', 'season:summer': '☀', 'season:autumn': '❦', 'season:winter': '❄',
    'weather:clear': '☼', 'weather:storm': '☂', 'weather:afterrain': '◠', 'weather:snow': '❄', 'weather:mist': '≋',
    'act:blind': '⌇', 'act:festival': '◍', 'act:fireworks': '✺', 'act:fish': '◔',
    'quality:auto': 'Ａ', 'quality:high': 'Ｈ', 'quality:balanced': 'Ｂ', 'quality:performance': 'Ｐ',
    'view:rainbow': '◠', 'view:hero': '▲', 'view:stele': '◆', 'view:hall': '⌂', 'view:pavilion': '◇', 'view:overview': '◎',
    'view:plumRed': '✿', 'view:plumYellow': '✽',
    'act:season-demo': '❁', 'act:tour': '◈', 'act:reel': '◔', 'act:random': '✷',
    'act:shot': '▤', 'act:long': '✧', 'act:sound': '♪',
  };
  for (const b of envEl.querySelectorAll('button')){
    const d = b.dataset;
    const key = d.axis ? d.axis + ':' + d.v
              : d.act ? 'act:' + d.act
              : d.view ? 'view:' + d.view
              : d.quality ? 'quality:' + d.quality : '';
    if (key && ICON[key]) b.dataset.ic = ICON[key];
  }
}

/* ── 留影行的音量滑杆（#sndVol）：与时段条共用"已过段暖色填充"的同一套视觉 ──
   2026-10-06 老黄第 6 条反馈要求两个滑杆视觉统一（一致性），而"已过段"是纯 CSS
   用 `background-size: calc(... var(--r) ...)` 裁出来的 ⇒ 需要一个 --r。
   时段条的 --r 由 placeHourTip/syncEnvUI 写；音量滑杆没有别的写入方（11-loop 只把
   它的值送进 Snd.setVolume），所以在这里补一个**只写 CSS 变量**的监听器。
   ⚠️ 与 11-loop 的 input 监听器互不干扰（同一个 input 可以挂多个 input 监听），
      本监听器不改 value、不碰音量，只重算填充比例。 */
const sndVol = document.getElementById('sndVol');
function syncSndVolFill(){
  if (!sndVol) return;
  const max = parseFloat(sndVol.max) || 100;
  const v = Math.max(0, Math.min(max, parseFloat(sndVol.value) || 0));
  sndVol.style.setProperty('--r', (v / max).toFixed(4));
}
if (sndVol){
  sndVol.addEventListener('input', syncSndVolFill);
  syncSndVolFill();                  // 初始态（value=100 ⇒ 整条暖色）
}

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
/* 2026-10-06 陈设行四键（老黄："所有按钮全部配置快捷键，但平时都隐藏"）：
   D 灯会 / V 烟花 / B 彩虹 / N 鱼趣。均与按钮走**同一条分支**（直接派发 click），
   避免"快捷方式与按钮两条实现"这种日后会分家的写法。 */
if (e.key === 'd' || e.key === 'D'){ document.querySelector('[data-act="festival"]')?.click(); return; }
if (e.key === 'v' || e.key === 'V'){ document.querySelector('[data-act="fireworks"]')?.click(); return; }
if (e.key === 'b' || e.key === 'B'){ document.querySelector('[data-view="rainbow"]')?.click(); return; }
if (e.key === 'n' || e.key === 'N'){ document.querySelector('[data-act="fish"]')?.click(); return; }
/* 2026-10-06 补齐剩余快捷键（老黄："所有按钮全部配置快捷键"）：
   ⚠️ 数字 **1~4 已被「时段」占用**（下面 time 的 map），别拿来当机位键。
   ⇒ 5~9 = 导览五个机位（顺序与面板/VIEWPOINTS 一致：立峰/云根近观/远香堂/荷风四面/全园）；
     Shift+1~4（键盘上是 ! @ # $）= 画质四档（自动/高/均衡/性能）。
   两条都走"派发 click"这同一条路径，不另写一套实现。 */
if (e.key >= '5' && e.key <= '9'){
  const id = ['hero', 'stele', 'hall', 'pavilion', 'overview'][+e.key - 5];
  document.querySelector('[data-view="' + id + '"]')?.click(); return;
}
/* 2026-10-08 两个看梅机位：`,` 红梅 / `.` 腊梅
   （5~9 已给前五个机位、0/Home 是复位 ⇒ 取右手边这两个相邻键）。 */
if (e.key === ',' || e.key === '<'){ document.querySelector('[data-view="plumRed"]')?.click(); return; }
if (e.key === '.' || e.key === '>'){ document.querySelector('[data-view="plumYellow"]')?.click(); return; }
if (e.key === '!' || e.key === '@' || e.key === '#' || e.key === '$'){
  HOOKS.setQuality?.(['auto', 'high', 'balanced', 'performance']['!@#$'.indexOf(e.key)]); return;
}
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
