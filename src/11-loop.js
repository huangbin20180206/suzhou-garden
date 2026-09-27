// 11-loop: from index.html inline 503..1363
import { THREE } from '../vendor.js';
import { camera, renderer, RENDER_SCALE, GPU_TIER, GPU_TIER_FORCED, ACTIVE_QUALITY, QUALITY_PRESETS, pixelRatioForTier,
         QOS_IMMUNE, SOFTWARE_GL, PROBE_DRIVEN, scene, skyMesh, controls, SUPERSAMPLE, resetCamera, GPU_NAME, world, CAM_MIN_DIST, envBakeState } from './02-scene.js';
import { composer, gtaoPass, AO_ENABLED, collectAOSkip, bloom, setHFogEnabled } from './10-post.js';
import { WIND, waterNormalTex, waterSurface, MAT, WET_MATS } from './01-materials.js';
import { ENV, timeLabelNow, ENV_SEASON, weatherTag, lanternGroups, hash21Lantern, applyPresence, REEL, advanceReel, mixInto, applyEnv, updateRainRipples, updatePrecip, effectiveWeather, setEnv, PRECIP, weatherAllowed, weatherMutexReason, wetApplied, toggleReel, randomScene, tickLampVol, TIME_ANCHORS, lampVolState, setLampVol, toggleFestival, festivalState, tickFestival, setFestivalFreeze, SEASON_DEMO, startSeasonDemo, stopSeasonDemo, toggleSeasonDemo, advanceSeasonDemo, seasonDemoState, seasonDemoCaption } from './12-env.js';
import { sun, fitShadowCamera, refreshCasterBox, casterBox } from './09-lights.js';
import { windClock, advanceWindClock, updateWind, WIND_DIR, WIND_FORCE, FORCE_TIERS, DIR_N, DIR_STEP, forceBand, windGain, updateWindDir, updateWindForce } from './2b-wind.js';
import { MIST, MIST_WHITE, KOI_ORBITS, spawnRipple, updateRipples, assetFailures, perchingAnchors, makeFireflies, makeLensWeather, ripplesActive, lastRippleAge, dropBait, updateBaits, nearestBait, baitsActive, BAITS, rippleCapacity, koiBehaviorOffset, koiStartleEnergy, KOI_BEHAVIOR } from './06-vegetation.js';
import { koiGroup, dragonflies, updatePerchingDragonflies, perchShowOK, swimTurtles, figures, updateCamFly, updateTour, runDeferredBoot, flyTo, gotoViewpoint, VIEWPOINTS, HERO_POS, FIG_PALETTE, FIG_HAIR, GLB_LOTUS_STEM_H, perchingDragonflies, PERCH_LIFT, CAM_FLY, tourStart, tourStop, TOUR, captionEl, updateIntro, introMaybeAuto, introActive, introStart, introCancel, INTRO, bootDone, bootDonePromise } from './08-assemble.js';
import { CFG, TAU, bootMark, BOOT, registry, HOOKS } from './00-config.js';
/* 预载清单（13）只依赖 00-config 的 HOOKS，不 import 06/11/12 ⇒ 不会成环。
   依赖方向：00 → 13 ← 06（经 HOOKS 延迟绑定）。 */
import { preloadPhase, aggregate as preloadAggregate, describe as preloadDescribe, slowNotice, degradedList, PRELOAD_MANIFEST, PRELOAD_TOTAL_BYTES, setPreloadConfig, preloadConfig, OFFLINE_URL } from './13-preload.js';
import { insidePond, POND_RADII, POND_PTS, renderRefraction, refractInfo, getRefractRT } from './05-water.js';
/* ══════════════════════════════════════════════════════════════
   11 · 循环与自适应
   ══════════════════════════════════════════════════════════════ */
/* r184 起 Clock 已弃用；Timer 的 connect(document) 还会挂 Page Visibility ——
   切后台自动挂起计时，回前台不会出现"一帧跳 40 秒"的 dt（原来靠钳制值硬兜）。 */
const timer = new THREE.Timer();
timer.connect(document);
const statsEl = document.getElementById('stats');
let acc = 0, frames = 0, fps = 0, sndAcc = 0;

function onResize(){
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}
addEventListener('resize', onResize);

const _swimmerWorld = new THREE.Vector3();   // 鱼/龟起涟漪要世界坐标（holder 是 koiGroup 的子节点）

/* ══ 氛围粒子（2026-09-20）══
   萤火入 world（要参与世界坐标，且靠 userData.aoSkip 被 GTAO 排除表收走）；
   镜前雨雪挂相机（makeLensWeather 内部 scene.add(camera)，并自行登记 AUX_PASS_HIDDEN）。
   collectAOSkip 补收一次：08 body 末尾的首次收集早于本模块。 */
const fireflies = makeFireflies();
world.add(fireflies);
const lensWeather = makeLensWeather(camera);
collectAOSkip();
let frameT = 0;                                // 最近一帧的墙钟 t，供事件回调里的涟漪系统用

/* ── 点击水面：投石问路（2026-09-20）──
   pointerup 射线打水面网格；按下/松开位移 >6px 视为拖拽转视角，不起圈。
   开场运镜的让位在 pointerdown 捕获阶段（08 的 introCancel），到这里运镜已结束。
   点池子以外（水面网格包围盒延伸到岸边的部分）用 insidePond 再拦一道。 */
const _pondRay = new THREE.Raycaster();
const _pondNdc = new THREE.Vector2();
let _pondDown = null;
/* 最近一次「点击水面」判定结果（供门禁验证整条链路：手势过滤 → 射线 → 池域 → spawnRipple）。
   真实 pointerup 才写；拖拽/未命中水面也记 hit=false，便于区分"没点到"和"接线断了"。 */
let lastClickRipple = null;
renderer.domElement.addEventListener('pointerdown', (e)=>{
  if (e.button === 0) _pondDown = { x:e.clientX, y:e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e)=>{
  if (e.button !== 0 || !_pondDown || !waterSurface) return;
  const moved = Math.hypot(e.clientX - _pondDown.x, e.clientY - _pondDown.y);
  _pondDown = null;
  if (moved > 6 || introActive()) return;
  const r = renderer.domElement.getBoundingClientRect();
  _pondNdc.set(((e.clientX - r.left) / r.width) * 2 - 1,
               -((e.clientY - r.top) / r.height) * 2 + 1);
  _pondRay.setFromCamera(_pondNdc, camera);
  const hit = _pondRay.intersectObject(waterSurface, false)[0];
  /* ⚠️ 坐标系：insidePond 的多边形是**池心局部坐标**（池心在世界 z = +3），hit.point 是世界坐标。
     ⚠️ 2026-09-24 修：原来用 `waterSurface.worldToLocal(...)` 后读 `lp.z` —— 但水面 mesh 带
     `rotation.x = -π/2`，世界→局部之后**局部 z ≈ 0**（池形的 y 落在**局部 y** 上）⇒
     那等于在测 `(世界 x, 0)`，于是**岸边点击也被判"在池内"**（涟漪画到岸上，与雨滴那条同源）。
     改成与世界→池心的**唯一口径**一致：`insidePond(世界 x, 世界 z − 3)`
     （同 07-ground.js 的 `dz = z - 3.0`、06-vegetation 里 `z = 3 + sin(ang)*rad`）。 */
  let ok = false;
  if (hit) ok = insidePond(hit.point.x, hit.point.z - 3.0);
  /* 投喂（计划书 Phase 3 第 6 项）：**同一击**先出涟漪、饵落在涟漪中心 —— 与既有的
     "点水面出涟漪"共存而不是抢事件（计划书 v2.0 补注①），因此不需要新增手势，
     iPad 触摸也天然可用（pointer 事件本就覆盖触摸）。饵点由 dropBait 夹紧在池域内（防鱼上岸）。 */
  if (ok){ spawnRipple(hit.point.x, hit.point.z, frameT, 5, 1.6);
           dropBait(hit.point.x, hit.point.z, frameT); }
  lastClickRipple = { at: performance.now(), hit: ok, bait: ok,
    x: hit ? hit.point.x : null, z: hit ? hit.point.z : null };
});

/* ══ 音景（程序化合成，零音频资产）══
   六层，全部 Web Audio 原语：
   · 风 wind    ：低通白噪声（0.5× 回放压低频），音量跟风场（天气底值风 + 阵风包络）
   · 雨 rain    ：带通白噪声（1.5kHz 中心），音量跟 rainAmount
   · 虫 cricket ：4.3kHz 三角波 × 11Hz 幅度调制 —— 经典的"蛐蛐"合成，夜 + 安静 + 非冬
   · 蝉 cicada  ：带通白噪（4.2kHz）× 55Hz 深幅度调制 —— 那种"知——"的一片蝉噪，夏 + 白天 + 安静
   · 蛙 frog    ：230~320Hz 方波短脉冲串（3~5 声一组），夏 + 夜/暮 + 安静
   · 鸟 bird    ：晨间短促滑音，三种鸟随机（门控值，不是持续电平）
   AudioContext 在第一次点"音景"时才创建（自动播放策略要求用户手势）。
   各层音量都压得很低 —— 环境音要的是"听得见才对"，不是"听得清"。

   ⚠️ plan(p) 是**纯函数**：给定环境参数直接算出各层目标音量，不含任何音频节点操作。
   这不是洁癖 —— 音景是典型的"全静默失效"区：接线断了不报错、不崩、页面照常跑，
   而在无音频设备的 CI 里根本听不见"该响的时候没响"。把它做成纯函数，门禁才能
   直接断言"夏天白天该有蝉、夏夜该有蛙、冬天没有虫鸣"，不必依赖真的出声。 */
const BIRD_SPECIES = [
  /* 山雀：细碎高挑，全年可见；画眉：婉转下行，春夏为主；白头鹎：急促三连，南方常见 */
  { name:'山雀',   f0:[2600, 3300], n:[2, 3], slope:1.25, dur:0.13, gap:0.16, vol:0.050, w:{ spring:1, summer:1, autumn:1.4, winter:2.0 } },
  { name:'画眉',   f0:[1750, 2100], n:[3, 4], slope:0.82, dur:0.20, gap:0.22, vol:0.055, w:{ spring:1.8, summer:1.4, autumn:0.6, winter:0 } },
  { name:'白头鹎', f0:[2000, 2450], n:[2, 4], slope:1.10, dur:0.11, gap:0.13, vol:0.045, w:{ spring:1.5, summer:1.2, autumn:1.0, winter:0.3 } },
];
const Snd = (()=>{
  let ctx = null, master = null, rainG = null, windG = null;
  let cricketCarrier = null, cricketMod = null, cricketG = null;
  let cicadaG = null, frogG = null;
  let on = false, birdNext = 0, frogNext = 0, vol = 1;
  function ensure(){
    if (ctx) return true;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return false; }
    master = ctx.createGain(); master.gain.value = 0;
    master.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mkNoise = (rate, type, freq, q)=>{
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      return g;
    };
    windG = mkNoise(0.5, 'lowpass',  380, 0.50);
    rainG = mkNoise(1.0, 'bandpass', 1500, 0.55);
    /* 虫鸣：载波 × 幅度调制。调制振荡器接到 gain 口上（不是 setInterval），
       节拍永远贴着音频时钟走。modDepth 控制颤动深度，cricketG 整体闸门由 tick 拉起。 */
    cricketCarrier = ctx.createOscillator(); cricketCarrier.type = 'triangle';
    cricketCarrier.frequency.value = 4300;
    cricketMod = ctx.createOscillator(); cricketMod.type = 'sine'; cricketMod.frequency.value = 11;
    cricketG = ctx.createGain(); cricketG.gain.value = 0;
    const modDepth = ctx.createGain(); modDepth.gain.value = 0.011;
    cricketMod.connect(modDepth); modDepth.connect(cricketG.gain);
    cricketCarrier.connect(cricketG); cricketG.connect(master);
    cricketCarrier.start(); cricketMod.start();
    /* 蝉鸣：带通白噪当"翅膜"，再用 55Hz 的 LFO **乘**上去做颤动。
       ⚠️ LFO 必须走**独立的 amGain**再接到 cicadaG，不能直接接到 cicadaG.gain ——
       那样当 cicadaG=0 时 LFO 仍在 ±幅度上摆动（负增益 = 反相，照样出声），
       静音就静不干净了。amGain 在 0~1 之间摆，音量闸门由它后面的 cicadaG 掌管。 */
    const cicadaSrc = ctx.createBufferSource();
    cicadaSrc.buffer = buf; cicadaSrc.loop = true; cicadaSrc.playbackRate.value = 1.0;
    const cicadaBp = ctx.createBiquadFilter();
    cicadaBp.type = 'bandpass'; cicadaBp.frequency.value = 4200; cicadaBp.Q.value = 1.2;
    const amGain = ctx.createGain(); amGain.gain.value = 0.5;      // LFO 围绕 0.5 摆动
    const cicadaLfo = ctx.createOscillator(); cicadaLfo.type = 'sine'; cicadaLfo.frequency.value = 55;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.5;
    cicadaG = ctx.createGain(); cicadaG.gain.value = 0;
    cicadaSrc.connect(cicadaBp); cicadaBp.connect(amGain); amGain.connect(cicadaG);
    cicadaG.connect(master);
    cicadaLfo.connect(lfoDepth); lfoDepth.connect(amGain.gain);
    cicadaSrc.start(); cicadaLfo.start();
    /* 蛙声：不做连续振荡器，而是按拍调度一串短脉冲（croak()）。
       蛙是"叫一阵、停一阵"的，连续音会立刻听出是合成器。 */
    frogG = ctx.createGain(); frogG.gain.value = 0;
    frogG.connect(master);
    return true;
  }
  /* 纯函数：环境参数 → 各层目标音量。门禁靠它断言"哪一层该响"。 */
  function plan(p){
    const rain = p.rainAmount || 0;
    const windMul = p.windMul || 1;
    const wind = Math.min(1, Math.max(0, (windMul - 1) * 0.30)
                        + WIND.uWindGlobal.value * 0.5 + WIND.uWindStrength.value * 0.35);
    /* "安静" = 没下雨、没大风。鸣虫在雨里和大风里都不叫 —— 这是真的生物学，
       也是听感上的必需：暴雨里再叠虫鸣，整段音景会糊成一片噪声。 */
    const quiet = rain < 0.15 && windMul < 2.2;
    const time = ENV.time, season = ENV.season;
    const night = time === 'night';
    const dayLight = time === 'morning' || time === 'noon' || time === 'dusk';
    return {
      wind:    0.015 + wind * 0.085,
      rain:    rain * 0.14,
      cricket: (night && quiet && season !== 'winter') ? 0.016 : 0,
      cicada:  (season === 'summer' && dayLight && !night && quiet) ? 0.020 : 0,
      frog:    (season === 'summer' && (night || time === 'dusk') && quiet) ? 0.030 : 0,
      bird:    (time === 'morning' && quiet && season !== 'winter') ? 1 : 0,
      quiet:   quiet ? 1 : 0,
    };
  }
  function chirp(){
    /* 按季节权重挑鸟种：冬天只剩山雀，春天画眉多 —— 别一年四季一个叫声 */
    const season = ENV.season || 'summer';
    let total = 0;
    for (const b of BIRD_SPECIES) total += (b.w[season] || 0);
    let pick = BIRD_SPECIES[0];
    if (total > 0){
      let r = Math.random() * total;
      for (const b of BIRD_SPECIES){ r -= (b.w[season] || 0); if (r <= 0){ pick = b; break; } }
    }
    const t0 = ctx.currentTime + 0.02;
    const n = pick.n[0] + ((Math.random() * (pick.n[1] - pick.n[0] + 1)) | 0);
    for (let i = 0; i < n; i++){
      const o = ctx.createOscillator(), g = ctx.createGain();
      const f0 = pick.f0[0] + Math.random() * (pick.f0[1] - pick.f0[0]);
      const t = t0 + i * pick.gap;
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (pick.slope + Math.random() * 0.2 - 0.1), t + pick.dur * 0.7);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(pick.vol, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0008, t + pick.dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + pick.dur + 0.03);
    }
  }
  /* 蛙鸣：3~5 声一组的低频方波短脉冲，组间随机间隔 2.5~7 秒 */
  function croak(){
    const t0 = ctx.currentTime + 0.02, n = 3 + ((Math.random() * 3) | 0);
    const base = 230 + Math.random() * 90;
    for (let i = 0; i < n; i++){
      const o = ctx.createOscillator(), g = ctx.createGain();
      const t = t0 + i * (0.13 + Math.random() * 0.06);
      o.type = 'square';
      o.frequency.setValueAtTime(base * (0.94 + Math.random() * 0.12), t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.030, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.10);
      o.connect(g); g.connect(frogG);
      o.start(t); o.stop(t + 0.12);
    }
  }
  function tick(p){
    if (!on || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const q = plan(p);
    rainG.gain.setTargetAtTime(q.rain, now, 0.5);
    windG.gain.setTargetAtTime(q.wind, now, 0.6);
    cricketG.gain.setTargetAtTime(q.cricket, now, 1.2);
    cicadaG.gain.setTargetAtTime(q.cicada, now, 0.8);
    /* 蛙声是脉冲串：这里只给闸门电平（0 / 满），节奏由下面的调度器拍板 */
    frogG.gain.setTargetAtTime(q.frog > 0 ? 1 : 0, now, 0.4);
    if (q.bird > 0 && performance.now() > birdNext){
      chirp();
      birdNext = performance.now() + 4000 + Math.random() * 9000;
    }
    if (q.frog > 0 && performance.now() > frogNext){
      croak();
      frogNext = performance.now() + 2500 + Math.random() * 4500;
    }
  }
  function setVolume(v){
    vol = Math.max(0, Math.min(1, v));
    if (ctx && master) master.gain.setTargetAtTime(on ? vol : 0, ctx.currentTime, 0.15);
    return vol;
  }
  function toggle(){
    if (!ensure()) return false;
    on = !on;
    ctx.resume().catch(()=>{});          // 无手势环境可能拒绝 resume —— 静默即可，不抛错
    master.gain.setTargetAtTime(on ? vol : 0, ctx.currentTime, 0.25);
    return on;
  }
  return {
    toggle, tick, plan, setVolume,
    get on(){ return on; },
    get volume(){ return vol; },
    /* 门禁读真实节点电平用（判"接上了"，不判音色） */
    levels: () => ({
      master: +((master ? master.gain.value : 0)).toFixed(5),
      wind:   windG    ? +windG.gain.value.toFixed(5)    : 0,
      rain:   rainG    ? +rainG.gain.value.toFixed(5)    : 0,
      cricket:cricketG ? +cricketG.gain.value.toFixed(5) : 0,
      cicada: cicadaG  ? +cicadaG.gain.value.toFixed(5)  : 0,
      frog:   frogG    ? +frogG.gain.value.toFixed(5)    : 0,
    }),
    ctxState: () => (ctx ? ctx.state : 'none'),
    species: () => BIRD_SPECIES.map(b => ({ name:b.name, f0:b.f0, n:b.n, slope:b.slope })),
  };
})();
export function toggleSound(){ return Snd.toggle(); }
/* 音量滑杆（P2-3）。⚠️ 这是面板上唯一一个"人工可调项"，且是媒体类通用控件 ——
   不违背「不给人造天气旋钮」的约定（风/雨/雪没有滑块，它们由调度器与天气驱动）。 */
(function bindSndVol(){
  const el = document.getElementById('sndVol');
  if (!el) return;
  el.addEventListener('input', ()=>{ Snd.setVolume(parseInt(el.value, 10) / 100); });
})();

/* ══ 明信片 ══
   渲染画布本来就不含 DOM 覆盖层（面板/统计都是 HTML 元素），无需隐藏界面。
   ⚠️ 画布没有 preserveDrawingBuffer：缓冲在合成后随时可能失底。
   所以 postcardData **先亲自渲一帧**再取像素 —— 任何时刻调用都保证新鲜，
   代价只是用户点按钮时多渲一帧（按需开销，可忽略）。 */
export function queuePostcard(){ takePostcard(); }

/* ── 把这两个回调登记给 12-env（明信片 / 音景按钮与 P / M 快捷键）──
   ⚠️ 必须走 HOOKS 而不是让 12-env 静态 import 本模块：12-env 被 2b-wind 依赖、
   本模块又依赖 2b-wind → 静态 import 成环，本模块 body 会在 2b-wind 求值完成前跑
   `animate()` / `window.__garden` → 启动期 TDZ（详见 00-config.js 的 HOOKS 注释）。
   登记动作放在模块顶层没问题：回调是用户点击时才触发的。 */
HOOKS.postcard = queuePostcard;
HOOKS.longExposure = queueLongExposurePostcard;
HOOKS.sound = toggleSound;
/* 反射按需更新：把"水面是否活跃"的判断放在这里（本模块已经 import 了 ENV / REEL / 涟漪状态），
   05-water 经 HOOKS 读 —— 它不能 import 06-vegetation / 12-env（会成环，见 05 的注释）。
   活跃 = 下雨 / 时光流转（时间快进）/（可选）刚刚起过涟漪。
   ⚠️ "锦鲤出水"默认**不**算活跃 —— 实测（outputs/_diag/water-busy-share.mjs，晴、1200 帧）：
     池里有活涟漪 100% ｜ 最近 1.5s 起过涟漪 ~98% ｜ **有锦鲤正在出水 76%**。
     11 条鱼轮流跳是常态，把"鱼跃"算进去 ⇒ 观景态只剩 ~24%，本特性的收益基本被吃掉。
     而鱼的倒影在墨绿水面上只是一个很小的暗斑 ⇒ 1/3 刷新率下几乎不可辨（**待真人观感确认**）。
     要回到计划书原文口径（鱼跃也满速）把下面开关置 true 即可。
   ⚠️ 判断源全部复用既有状态（`lastRippleAge` 由 updateRipples 每帧维护），不新增真值来源。 */
const REFLECT_FULL_ON_FISH = false;
HOOKS.waterBusy = () => (ENV.cur.rainAmount || 0) > 0.02
                    || REEL.on
                    || (REFLECT_FULL_ON_FISH && lastRippleAge < 1.5);
/* 偶得：抽完一幅景色，用巡游字幕条把结果亮一下（2.6s 自动隐） */
HOOKS.randomScene = ()=>{
  const r = randomScene();
  const el = captionEl();
  if (el){
    el.querySelector('b').textContent = '偶得';
    el.querySelector('span').textContent = r.label;
    el.classList.add('show');
    clearTimeout(HOOKS._randomCapTimer);
    HOOKS._randomCapTimer = setTimeout(()=>el.classList.remove('show'), 2600);
  }
  return r;
};
/* 朱文印：朱砂底 + 阴刻白字 + 斑驳做旧。
   印章是明信片"作品感"的关键一笔 —— 没有它，一张截图就只是截图；
   钤上印才像一幅被收藏过的画。 */
function drawSeal(g, cx, cy, size, text){
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.04);                                  // 手钤不可能绝对水平
  const r = size / 2;
  g.fillStyle = '#B23A2E';
  g.fillRect(-r, -r, size, size);
  g.fillStyle = 'rgba(245,242,234,.28)';            // 斑驳：印泥不匀
  for (let i = 0; i < 90; i++){
    g.fillRect(-r + Math.random() * size, -r + Math.random() * size, size * 0.05, size * 0.05);
  }
  g.strokeStyle = 'rgba(245,242,234,.72)';          // 印面留边
  g.lineWidth = size * 0.055;
  g.strokeRect(-r * 0.74, -r * 0.74, size * 0.74, size * 0.74);
  g.fillStyle = '#f5f2ea';
  g.font = `600 ${size * 0.42}px "Songti SC","SimSun","Noto Serif SC",serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const step = size * 0.46;
  let y = -(text.length - 1) * step / 2;
  for (const ch of text){ g.fillText(ch, 0, y); y += step; }
  g.restore();
}
/* 画面落到画布后，统一做题跋 / 装裱 / 题款 / 钤印。普通与长曝光两种明信片共用，
   保证两张画的"作品感"完全一致（长曝只是多了拖尾合成的画面素材）。 */
function decoratePostcard(c, { grain = false } = {}){
  const g2 = c.getContext('2d');
  const px = c.height / 45, pad = px * 1.4;
  if (grain){
    /* 暗部胶片颗粒（仅长曝）：长曝把随机噪声平均掉了，画面越静越"塑料"。
       给低分辨率单色噪声叠 soft-light —— soft-light 在暗部放大的振幅正好落在
       胶片颗粒该出现的地方（高光若也铺一层就糊了亮部细节）。低分辨率 + 拉伸 =
       颗粒偏粗，贴近真实胶片上的银盐颗粒而非屏幕噪点。 */
    const gw = Math.max(64, c.width >> 3), gh = Math.max(64, c.height >> 3);
    const n = document.createElement('canvas'); n.width = gw; n.height = gh;
    const ng = n.getContext('2d');
    const id = ng.createImageData(gw, gh);
    for (let i = 0; i < id.data.length; i += 4){
      const v = Math.random() * 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    ng.putImageData(id, 0, 0);
    g2.save();
    g2.globalCompositeOperation = 'soft-light';
    g2.globalAlpha = 0.30;
    g2.drawImage(n, 0, 0, gw, gh, 0, 0, c.width, c.height);
    g2.restore();
  }
  g2.shadowColor = 'rgba(0,0,0,.55)'; g2.shadowBlur = px * 0.6;
  g2.fillStyle = '#f5f2ea';
  g2.font = `600 ${px * 1.6}px "Songti SC","SimSun","Noto Serif SC",serif`;
  g2.fillText('远 香 堂', pad, c.height - pad - px * 1.1);
  g2.font = `${px * 0.72}px "Songti SC","SimSun",serif`;
  g2.fillStyle = 'rgba(245,242,234,.92)';
  g2.fillText(`拙政园 · ${timeLabelNow()}${ENV_SEASON[ENV.season].label} · ${weatherTag()}`, pad, c.height - pad);
  const d = new Date();
  g2.textAlign = 'right';
  g2.fillText(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
               c.width - pad, c.height - pad);
  g2.textAlign = 'left';

  /* ── 装裱：内缩一圈留白细框，宣纸镶边的观感（画框先画，别盖住字）── */
  g2.shadowBlur = 0;
  g2.strokeStyle = 'rgba(245,242,234,.5)';
  g2.lineWidth = Math.max(1, px * 0.1);
  g2.strokeRect(pad * 0.85, pad * 0.85, c.width - pad * 1.7, c.height - pad * 1.7);

  /* ── 右侧竖排题款：书画款式，自上而下、自右向左 ── */
  g2.shadowColor = 'rgba(0,0,0,.55)'; g2.shadowBlur = px * 0.6;
  g2.textAlign = 'center'; g2.textBaseline = 'middle';
  const tx = c.width - pad * 2.4;
  g2.fillStyle = '#f5f2ea';
  g2.font = `600 ${px * 1.12}px "Songti SC","SimSun","Noto Serif SC",serif`;
  let ty = pad * 2.6;
  for (const ch of '拙政园远香堂'){ g2.fillText(ch, tx, ty); ty += px * 1.32; }
  /* 题款左侧再落一列小字：季节 · 时辰 · 天气 */
  g2.font = `${px * 0.6}px "Songti SC","SimSun",serif`;
  g2.fillStyle = 'rgba(245,242,234,.9)';
  let sy = pad * 2.9;
  for (const ch of `${ENV_SEASON[ENV.season].label}·${timeLabelNow()}·${weatherTag()}`){
    g2.fillText(ch, tx - px * 1.6, sy); sy += px * 0.76;
  }
  /* 钤印于题款之下（压角章）—— 印章是"作品感"的落点 */
  g2.shadowBlur = px * 0.4;
  drawSeal(g2, tx - px * 0.85, ty + px * 0.9, px * 1.7, '云根');

  g2.textAlign = 'left'; g2.textBaseline = 'alphabetic';
  return g2;
}
function postcardData(){
  composer.render();                    // 亲自渲一帧：没有 preserveDrawingBuffer，缓冲必须现渲现取
  const src = renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  decoratePostcard(c);
  return c.toDataURL('image/png');
}
function takePostcard(){
  try {
    const a = document.createElement('a');
    a.download = `远香堂-${timeLabelNow()}-${ENV.season}-${ENV.weather}.png`;
    a.href = postcardData();
    a.click();
  } catch (e){ console.warn('[明信片] 生成失败：', e); }
}

/* ══ 长曝光明信片（2026-09-21）══
   普通明信片是"单帧定格"，长曝光则是把**一段流逝的时间**压进一张画：
   星点走成圆弧、萤火拖出断点虚线、雨丝拉成银线、水面磨成玻璃。
   原理是加性帧堆积：每帧先推 windClock（萤火位移、雨水下落、云絮漂移都由它驱动）
   与星野方位角 uStarRot，再渲一帧，以 `lighter` 用 1/N 权重叠进离屏画布。
   权重取 1/N 让曝光**中性**（累计≈单帧平均亮度，不爆白），只是把该动的抹成轨迹。
   ⚠️ 并行前提：堆积循环是同步的，RAF 的 animate 不会插进来 —— 机位在此窗口内冻结，
   所有运动只来自 windClock 的推进，正是长曝光需要的静止机位 + 流动时间。 */
const LXP = {
  frames: 28,       // 采样帧数：太少拖尾断点，太多纯费时（28 帧 ≈ 半秒渲染）
  dt: 0.10,         // 每帧推进的仿真秒 → 总曝光 ≈ 2.8s
  starDeg: 10,      // 星野总转角（度）：>6° 才读得出圆弧；再大就失真成"天文台转场"
};
/* 长曝期间把 windClock 驱动的材质相位统一刷上去（复刻 animate 里对应那几行）。
   ⚠️ animate 不会在同步堆积循环里跑 —— 不刷这些 uniform，材质还停在旧 phase，
   帧间零位移 = 白渲 28 帧。水面 normal 偏移 + 风相位 + 雾相位 + 云相位同源推进。 */
function lxpSyncWind(adv, rainNow){
  advanceWindClock(adv);
  WIND.uTime.value = windClock;
  WIND.uRain.value = rainNow;
  if (waterNormalTex){
    waterNormalTex.offset.x += adv * (0.022 + 0.26 * rainNow);  // 比实时略快 = "曝光期"水面拉丝
    waterNormalTex.offset.y += adv * (0.015 + 0.21 * rainNow);
  }
  MIST.uTime.value = windClock;
  skyMesh.material.uniforms.uTime.value = windClock;
}
/* 长曝合成本身：返回装裱好的 PNG dataURL。下载与门禁采样共用 ——
   门禁不点 `<a>`（headless 里点不出来），而是直接读这张返回的画。 */
export function longExposureData(){
  const N = LXP.frames, adv = LXP.dt;
  const rotStep = LXP.starDeg * Math.PI / 180 / N;
  const skyU = skyMesh.material.uniforms;
  const rainNow = ENV.cur.rainAmount || 0;
  const w = renderer.domElement.width, h = renderer.domElement.height;
  const accum = document.createElement('canvas'); accum.width = w; accum.height = h;
  const ga = accum.getContext('2d');
  ga.globalCompositeOperation = 'lighter';
  const weight = 1 / N;
  try {
    /* 长曝是把"一段时间"压进一张画：每一步都推时间再渲一帧 ⇒ 反射也必须**每步**刷新，
       否则水面反射只更新 1/3 步、长曝出来的倒影会缺轨迹（反射按需更新见 05-water 的注释）。 */
    if (waterSurface) waterSurface.userData.reflectEveryFrame = true;
    for (let i = 0; i < N; i++){
      if (skyU.uStarRot) skyU.uStarRot.value = rotStep * i;   // 星野逐帧转一微角 → 圆弧
      lxpSyncWind(adv, rainNow);
      composer.render();
      ga.globalAlpha = weight;
      ga.drawImage(renderer.domElement, 0, 0);
    }
  } finally {
    if (waterSurface) waterSurface.userData.reflectEveryFrame = false;
    /* 星野旋转必须归一：否则日常实时渲染里星星会按 uStarRot 一直转下去 */
    if (skyU.uStarRot) skyU.uStarRot.value = 0;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(accum, 0, 0);
  decoratePostcard(c, { grain: true });   // 仅长曝叠加暗部胶片颗粒（普通明信片不加）
  return c.toDataURL('image/png');
}
export function queueLongExposurePostcard(){
  try {
    const a = document.createElement('a');
    a.download = `远香堂长曝-${timeLabelNow()}-${ENV.season}-${ENV.weather}.png`;
    a.href = longExposureData();
    a.click();
  } catch (e){ console.warn('[长曝] 生成失败：', e); }
}

/* ── 帧率自适应（P1-1 附带项 / 审计 P01·P07）──
   原实现只有「开机读一次 GPU 名字」的静态判档，而真机负载随时段/天气/镜头大幅波动
   （暴雨近景 + 6144² 阴影 vs 晴天全景），静态档位既救不了被误判的核显本，
   也管不住移动端越跑越烫。这里加一层带**滞回**的服务质量控制：

   · 采样源：animate 里 stats 已经算好的真实 fps（用 rawDt 记账，不受 dt 钳制污染）；
   · 降档：连续 6 个窗口（≈3s）fps < 45 → 降一档；
     升档：连续 12 个窗口（≈6s）fps > 58 → 升一档（升档门槛比降档严得多，
           因为"偶尔一帧快"不代表稳定，宁可慢一点升）；
   · 每次变档后冷却 10 个窗口（≈5s）只采样不动作 —— 否则会在阈值附近来回抖；
   · 4 档：L0 初始 / L1 关 AO / L2 分辨率 ×0.85 + 阴影 2048 / L3 分辨率 ×0.72 + 阴影 1024；
   · **软渲染（SwiftShader / llvmpipe）不参与自适应**：那不是真实设备，帧率不反映能力，
     而且无头探针全跑在它上面 —— 若让它自适应，回归断言（draw calls / 三角形 /
     后处理开关）就会随宿主机器负载漂移。这既是工程判断，也是测试稳定性要求。
   · 页签隐藏即停渲染（见 animate 顶部）：移动端长时间挂后台是发热与掉电主因。 */
/* AA 的反向句柄：QOS 需要在改档时让 AA 归零，而 AA 定义在 QOS 之后。
   用可空变量而不是直接引用后面的 const（会撞 TDZ），也不靠 typeof（对 TDZ 无效）。 */
let AA_HOOK = null;
const QOS = (()=>{
  const P = ACTIVE_QUALITY;
  /* 平滑退化：先轻降倍率，再逐步关 AO / 降阴影。避免旧 L1→L2 一步同时砍掉
     分辨率与阴影导致“突然丑很多”。high 的 4K 预算只在 L0 全开，之后按帧率逐级回收。 */
  const shadowFor = n => [P.shadow, P.shadow, Math.min(P.shadow, 4096), 2048, 1024][n];
  const LEVELS = [1.00, 0.94, 0.86, 0.78, 0.72].map((scale, i) => ({
    scale, ao: P.ao && i < 2, shadow: shadowFor(i),
  }));
  const st = { level:0, active:!QOS_IMMUNE, low:0, high:0, cool:0, changes:0, fps:0,
               mode:'auto', locked:false };
  function syncQualityButtons(){
    document.querySelectorAll('[data-quality]').forEach(b=>{
      const on = b.dataset.quality === st.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function applyShadow(size){
    if (sun.shadow.mapSize.width === size) return;
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.needsUpdate = true;
  }
  function apply(level){
    const i = Math.max(0, Math.min(LEVELS.length - 1, level));
    const L = LEVELS[i];
    st.level = i;
    const s = pixelRatioForTier(GPU_TIER) * L.scale;
    renderer.setPixelRatio(s); renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(s); composer.setSize(innerWidth, innerHeight);
    if (gtaoPass) gtaoPass.enabled = L.ao;
    applyShadow(L.shadow);
    syncQualityButtons();
  }
  function state(){
    const L = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, st.level))];
    return { ...st, tier:GPU_TIER, tierLabel:QUALITY_PRESETS[GPU_TIER].label,
             maxLevel:LEVELS.length - 1, baseScale:pixelRatioForTier(GPU_TIER),
             pixelRatioScale:L.scale,          // 当前 QOS 档的倍率（AA 需要叠加在它之上）
             pixelRatio:renderer.getPixelRatio(), pixelBudget:P.pixelBudget,
             presetShadow:P.shadow, presetAO:P.ao, shadow:sun.shadow.mapSize.width,
             ao:!!(gtaoPass && gtaoPass.enabled), software:SOFTWARE_GL,
             probeDriven:PROBE_DRIVEN, immune:QOS_IMMUNE };
  }
  /* QOS 改档后通知 AA 归零：否则 AA 停在高档而 QOS 刚降档，两者叠加会直接卡死。 */
  function setMode(mode){
    const m = ['auto','high','balanced','performance'].includes(mode) ? mode : 'auto';
    st.mode = m;
    st.locked = m !== 'auto';
    st.active = !QOS_IMMUNE && m === 'auto';
    st.low = st.high = st.cool = 0;
    if (m === 'high') apply(0);
    else if (m === 'balanced') apply(Math.min(1, LEVELS.length - 1));
    else if (m === 'performance') apply(LEVELS.length - 1);
    else apply(st.level);
    if (!GPU_TIER_FORCED){
      try { localStorage.setItem('garden.quality.v1', m); } catch {}
    }
    syncQualityButtons();
    /* QOS 改档后通知 AA 归零：否则 AA 停在高档而 QOS 刚降档，两者叠加会直接卡死。
       ⚠️ 句柄必须在 QOS **之前**声明：AA 是后面才定义的 const，直接引用会撞 TDZ，
       而 `typeof AA` 对 TDZ 里的 const 同样抛 ReferenceError（防不住）。 */
    if (AA_HOOK) AA_HOOK.setStep(0);
    return state();
  }
  function sample(fps){
    if (!st.active) return;
    st.fps = fps;
    if (st.cool > 0){ st.cool--; return; }
    if (fps < 45){ st.low++; st.high = 0; }
    else if (fps > 58){ st.high++; st.low = 0; }
    else { st.low = 0; st.high = 0; }
    if (st.low >= 6 && st.level < LEVELS.length - 1){
      apply(st.level + 1); st.low = 0; st.cool = 10; st.changes++;
      console.log('[QOS] 降档 → L' + st.level + '（fps ' + fps + '）');
    } else if (st.high >= 12 && st.level > 0){
      apply(st.level - 1); st.high = 0; st.cool = 10; st.changes++;
      console.log('[QOS] 升档 → L' + st.level + '（fps ' + fps + '）');
    }
  }
  function state(){
    const L = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, st.level))];
    return { ...st, tier:GPU_TIER, tierLabel:QUALITY_PRESETS[GPU_TIER].label,
             maxLevel:LEVELS.length - 1, baseScale:pixelRatioForTier(GPU_TIER),
             pixelRatioScale:L.scale,          // 当前 QOS 档的倍率（AA 需要叠加在它之上）
             pixelRatio:renderer.getPixelRatio(), pixelBudget:P.pixelBudget,
             presetShadow:P.shadow, presetAO:P.ao, shadow:sun.shadow.mapSize.width,
             ao:!!(gtaoPass && gtaoPass.enabled), software:SOFTWARE_GL,
             probeDriven:PROBE_DRIVEN, immune:QOS_IMMUNE };
  }
  const saved = (()=>{ if (GPU_TIER_FORCED) return 'auto'; try { return localStorage.getItem('garden.quality.v1') || 'auto'; } catch { return 'auto'; } })();
  setMode(saved);
  return { sample, apply, setMode, state };
})();
HOOKS.setQuality = QOS.setMode;
HOOKS.qualityState = QOS.state;

/* ── 静止帧渐进超采样（2026-09-26）────────────────────────────────────────
   目标：把"1.5× SSAA 的干净边缘"和"1.25× 的流畅度"两者兼得 ——
   **相机不动时逐级把渲染倍率抬上去，一动立刻回落**。
   为什么不做 TAA：TAA 靠历史帧抗锯齿，而本场景里**枝叶、灯笼、水面每帧都在动**，
   历史帧必然拖影（这是 TAA 在场景里的主要难点）；渐进超采样没有历史帧，
   天然零鬼影，代价只是"动起来时边缘略软"——而那时画面本身在运动，没人盯着边缘看。
   三条硬约束（都来自实测教训）：
   ① **只认主相机**：onBeforeRender/controls 每帧被调多次的现象在水体那边已踩过；
   ② **QOS 降档后必须停**：QOS 已经在为帧率让路，AA 再加负载会把"降档救不回来"；
   ③ **改倍率必须走 QOS 的 apply 路径**：否则又出现两套分辨率逻辑互相覆盖。 */
const AA = (()=>{
  /* 抬到几档：1.00 / 1.18 / 1.36 —— 顶档 1.36 而不是 1.75：
     1.75 的像素面积是 3.06 倍，4K 屏上必然拖垮帧率；1.36 只多 1.85 倍，
     边缘改善已非常明显（SSAA 收益在 1.3 之后急剧递减）。 */
  const STEPS = [1.00, 1.18, 1.36];
  const RISE_FRAMES = 45;          // 静止多少帧后升一档（约 0.75s，太快会"看着在抖"）
  const MOVE_POS = 0.02, MOVE_ROT = 0.004;
  const st = { step:0, hold:0, lastPr:-1 };
  let prev = null;
  function cameraStill(){
    const p = camera.position, q = camera.quaternion;
    if (!prev) { prev = [p.x,p.y,p.z,q.x,q.y,q.z,q.w]; return false; }
    const still = Math.abs(p.x-prev[0])<MOVE_POS && Math.abs(p.y-prev[1])<MOVE_POS
               && Math.abs(p.z-prev[2])<MOVE_POS && Math.abs(q.x-prev[3])<MOVE_ROT
               && Math.abs(q.y-prev[4])<MOVE_ROT && Math.abs(q.z-prev[5])<MOVE_ROT
               && Math.abs(q.w-prev[6])<MOVE_ROT;
    prev = [p.x,p.y,p.z,q.x,q.y,q.z,q.w];
    return still;
  }
  function tick(){
    /* 画质锁定在"性能"（最低档）时不参与：那里本就是为了帧率牺牲一切。 */
    const q = QOS.state();
    if (q.mode === 'performance'){ if (st.step !== 0) setStep(0); st.hold = 0; return; }
    /* QOS 已降档：说明机器吃力，此时加 AA 等于雪上加霜 —— 立即回落并停手。 */
    if (q.level >= 2){ if (st.step !== 0) setStep(0); st.hold = 0; return; }
    if (!cameraStill()){ if (st.step !== 0) setStep(0); st.hold = 0; return; }
    if (st.step >= STEPS.length - 1) return;
    if (++st.hold >= RISE_FRAMES) setStep(st.step + 1);
  }
  function setStep(step){
    const s = Math.max(0, Math.min(STEPS.length - 1, step));
    st.step = s;
    st.hold = 0;
    const pr = pixelRatioForTier(GPU_TIER) * QOS.state().pixelRatioScale * STEPS[s];
    if (Math.abs(pr - st.lastPr) < 1e-4) return;
    st.lastPr = pr;
    renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight);
    composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight);
  }
  function state(){
    return { step:st.step, scale:STEPS[st.step], maxScale:STEPS[STEPS.length-1],
             baseScale:pixelRatioForTier(GPU_TIER), pixelRatio:renderer.getPixelRatio(),
             mode:QOS.state().mode, qosLevel:QOS.state().level };
  }
  return { tick, setStep, state, STEPS };
})();
AA_HOOK = AA;

/* ══ 锦鲤跃水间隔（2026-09-26 · "鱼游出水面会泛起涟漪的频率太过频繁"）══
   旋钮是下面鱼段里的 `d.riseAt = t + …`，但它**必须可被门禁从产品侧改回旧值**
   做负例自检（铁律 3：探针不能自己重调产品函数 —— 每帧会用自己参数再调一次，冻不住）。
   所以间隔参数收在这里，由 `setKoiBreachConfig()` 改写；鱼段每帧读同一份，探针改它就等于改产品。

   ⚠️ **必须物理放在模块作用域**（不是鱼循环体内）：曾误放在循环里，
      而 `__garden` 的暴露块在循环外 —— 模块体求值时那些 `const/function` 还在
      块级作用域里，直接 ReferenceError ⇒ 整个场景起不来（且报错点离病因很远）。

   ⚠️ 只影响**跃水节奏**，不碰落圈判据，也不碰投喂 / 点击 / 雨滴 / 泳龟任何一条链。 */
const KOI_BREACH = { floor: 9, spread: 48, on: true };
/** 产品侧权威开关：{floor, spread, on}。on=false ⇒ 锦鲤完全不再跃水（因而不落圈）。 */
function setKoiBreachConfig(v){
  if (v && typeof v === 'object'){
    if (Number.isFinite(v.floor))  KOI_BREACH.floor  = v.floor;
    if (Number.isFinite(v.spread)) KOI_BREACH.spread = v.spread;
    if (typeof v.on === 'boolean') KOI_BREACH.on = v.on;
  }
  return { ...KOI_BREACH };
}
const koiBreachConfig = () => ({ ...KOI_BREACH });

/* ══ 泳龟尾迹间隔（2026-09-27 · D2，与 KOI_BREACH 同套路）══════════════════════
   上一笔把锦鲤跃水节流（546344c）之后实测：**锦鲤链已降到 36 次/分，但龟链仍是 57.5 次/分**
   —— 龟只有 2 只，却贡献了水面 62% 的涟漪，合计 92.5 次/分（≈每 0.65s 一圈），
   仍是"持续不断"而不是"偶发"。用户选定 A：把龟拉回合理水位。
   原式 `t + 1.5 + rnd*1.2`（中位 2.1s × 2 只 = 57 次/分）⇒ 改 **floor 3 + spread 2.4**
   （中位 4.2s × 2 只 ≈ 29 次/分），水面合计 92.5 → **约 64**，与锦鲤链（36）同量级。
   ⚠️ 下界 3s 不能更短：龟是"贴着水面慢慢游"的活物，尾迹应当是**缓缓拖出**的，
      太密反而像机关水车；上界 5.4s 也不该更长，否则龟几乎不拖尾迹、又退回"滑行"。
   ⚠️ 只改**间隔**，不动尾迹的形态（仍是 spawnRipple(..., 2) 两圈）—— 这条链的"活物感"
      靠的是尾迹拖在龟身后，不是靠频率。 */
const TURTLE_WAKE = { floor: 3, spread: 2.4, on: true };
/** 产品侧权威开关：{floor, spread, on}。探针做负例自检必须走它（铁律 3）。 */
function setTurtleWake(v){
  if (v && typeof v === 'object'){
    if (Number.isFinite(v.floor))  TURTLE_WAKE.floor  = v.floor;
    if (Number.isFinite(v.spread)) TURTLE_WAKE.spread = v.spread;
    if (typeof v.on === 'boolean')  TURTLE_WAKE.on     = v.on;
  }
  return { ...TURTLE_WAKE };
}
const turtleWakeConfig = () => ({ ...TURTLE_WAKE });

/* 页签隐藏暂停渲染：rAF 仍排程（保持循环存活），但跳过这一帧的全部工作。
   仍调用 timer.update() 让 delta 归零，否则回到前台的第一次 getDelta 会带着
   几分钟的间隔（Timer 自身也挡了一道，这里是双保险）。 */
let pageHidden = false;
document.addEventListener('visibilitychange', () => { pageHidden = document.hidden; });
if (document.hidden) pageHidden = true;      // 启动即在后台（如后台标签打开链接）

/* ── 固定步长仿真（2026-09-25）────────────────────────────────────────────
   旧写法是 `dt = min(rawDt, 0.05)`：一帧不管多久都只推进 50ms。60fps 下看不出问题，
   掉到 20fps 时**每真实秒只走 0.05×20 = 1.0s**（刚好）；掉到 10fps 就只剩一半 ——
   风摆变慢、环境过渡变慢、鱼游得慢，用户会觉得"机器越差动画越卡"。
   正解是固定步长累加器：仿真按固定 1/60 步进，累加器消化真实帧间隔；
   一帧内可补多步（速度因此正确），但**补步总数有上限**（MAX_STEPS），
   否则切回标签页/断点调试后一帧补几百步会把相位、涟漪、鱼群一次性推穿。
   ⚠️ 渲染仍每帧一次（不插值）：本项目所有运动都是"按 dt 积分"，多帧补步与单帧大步
      在数学上等价，插值只会带来额外状态。 */
const FIXED_DT = 1 / 60;
const MAX_STEPS = 6;                 // 一帧最多补 6 步 = 100ms 仿真；更长的间隔直接丢弃
let simAccum = 0, simTime = 0, simSteps = 0;
/** 推进仿真时钟；返回本帧实际推进的秒数（供风钟等读数同源）。
    ⚠️ 风钟也在这里推进：仿真与风**必须共用同一条时间线** —— 拆成两条时，
       任何一处漏调都会让"风在吹但相位不走"这类现象出现，且不报错。 */
function stepSim(rawDt){
  simAccum += Math.max(0, rawDt);
  let advanced = 0, n = 0;
  while (simAccum >= FIXED_DT && n < MAX_STEPS){ simAccum -= FIXED_DT; advanced += FIXED_DT; n++; }
  if (n >= MAX_STEPS) simAccum = 0;   // 补步用尽：丢弃余量，宁可慢也不要雪崩
  simTime += advanced; simSteps = n;
  advanceWindClock(advanced);         // 走 2b-wind 的推进函数：导入绑定只读，不能就地 +=
  return advanced;
}
function animate(){
  requestAnimationFrame(animate);
  timer.update();                        // 先 update，getDelta/getElapsed 同帧多次调用值不变
  const rawDt = timer.getDelta();        // 真实帧间隔 —— 统计必须用它
  const dt = stepSim(rawDt);             // 仿真时间（固定步长累加；60fps 下与 rawDt 同值）
  const t = timer.getElapsed();
  frameT = t;
  if (pageHidden) return;                // 后台：不推进仿真、不渲染（发热主因）

  /* 风：风钟已由 stepSim 随仿真一起推进（同一时间线），这里只把相位刷进材质并跑调度。
     ⚠️ 必须吃**累加的 dt**，不能吃墙钟 t：软渲染一帧 8.4 秒，用墙钟会让所有相位每帧
     跳过 8.4 秒（枝叶瞬移、调度器一帧跨过整段过渡 / 一帧换一次档）。
     真机 60fps 下两者等价，缺陷只在低帧率现形 —— 与步态人物同一个坑（见 MEMORY 铁律）。 */
  WIND.uTime.value = windClock;         // 读仍走 live binding，与推进同源
  updateWind(windClock);
  /* 灯笼秋千摆（2026-09-17 用户："这个灯也应该晃动"）：
     灯笼是 Group（体 + 吊绳 + cap），**顶点位移风场管不到它**。
     每帧按"挂点为轴、整体轻摆"的秋千模型微摆 —— 摆幅与 WIND 的阵风强度联动，
     狂风下摇曳、微风不动；每盏独立相位（hash 自身 x/z 坐标），不"齐刷刷"。
     摆角上限 0.03 rad（~1.7°），吊绳 1m 下摆幅 ≈3cm，与"真实灯笼风里晃几厘米"一致。 */
  /* 灯笼单摆（2026-09-17 用户："这个灯也应该晃动" → 再修"连接处在动，不科学"）：
     lanternGroups 里存的是**原点落在挂点**的 pivot（见 makeLanterns），所以这里的
     rotation 就是真单摆：挂点位移恒为 0、绳下端随离支点的距离线性增大、
     灯笼中心在绳下端之下因而位移**略大于**绳下端 —— 正是用户要的三条。
     摆幅与 WIND 阵风联动：狂风摇曳、微风不动；每盏独立相位，不"齐刷刷"。
     摆角上限 0.045 rad（~2.6°）：游廊绳长 0.675m → 绳下端 2.3cm、灯笼中心（离支点 0.88m）3.1cm；
     堂前绳长 1.265m → 灯笼 5.1cm。都远小于灯笼与柱、栏的距离，不会穿模。 */
  /* 2026-09-19 老黄："狂风暴雨的场景下灯笼几乎没动"。
     旧式 `min(0.045, windGlobal*0.04 + windStrength*0.02)` 有两个毛病：
       ① **幅值太小**：暴雨台风档 windGlobal≈1 也只给到 0.04 rad（2.3°），
          堂前摆臂 1.47m → 位移 5cm；游廊摆臂 0.88m → 3cm。远距离看等于没动。
       ② **摆频固定 0.8 rad/s**（周期 7.9 秒）：又小又慢，肉眼直接判为"静止"。
     现在两件事一起改：幅值指数式放大到 0.16 rad（9.2°）、摆频随风力从 1.05 提到
     3.05 rad/s（周期 6.0s → 2.1s）——受迫摆动本来就是风越大摆得越快。
     ⚠️ 净空已量过（probe/_lantern-clearance.mjs）：最紧的一盏（游廊 x=13.2）
        水平净距 0.853m、摆臂 0.88m；0.16 rad 只走 0.140m，离撞柱差 6 倍，不会穿模。 */
  /* 阵风权重 0.35（不是 0.55）：风和日丽也会起阵风（峰值 0.7~1.1），全权重会把晴天的
     灯笼推到 4.5° —— 那已经不像"微风"。0.35 时晴天峰值 ≈3°，暴雨台风档仍吃满 0.16 rad。 */
  const windNorm = Math.min(1, WIND.uWindGlobal.value + WIND.uWindStrength.value * 0.35);
  const lanternSway = 0.005 + 0.155 * Math.pow(windNorm, 1.25);
  const swayOmega = 1.05 + 2.0 * windNorm;              // 摆频：微风慢摆、狂风快摆
  const wv = WIND.uWindVec.value;
  for (const pivot of lanternGroups){
    const h = hash21Lantern(pivot.position.x * 0.7, pivot.position.z * 0.7);
    /* 摆动方向**跟随全局风向**（2026-09-18·L1 风向调度器落地后必须同步）：
       单摆绕"水平面内垂直于风向的轴"摆，灯笼才会朝着风推的方向偏。
       原来 x/z 两条轴各自跑一个正弦 = 又一个小椭圆，而且风向转了灯笼还在原方向摆。
       推导：rotation.z 角 a 把绳下端推向 +x，故 rot.z = a·W.x；
             rotation.x 角 b 把绳下端推向 −z，故 rot.x = −a·W.z（W.y 即世界 z 分量）。 */
    const a = Math.sin(windClock * swayOmega + h * 6.28) * lanternSway;
    pivot.rotation.z = a * wv.x;
    pivot.rotation.x = -a * wv.y;
  }
  applyPresence(ENV.cur);      // 每帧重申存在性，否则会被 GTAO pass 的 visible 还原冲掉
  /* 时光流转：hour 自己走。必须放在 ENV.t 过渡分支**之前**并自己调 applyEnv ——
     那个分支只在 ENV.t<1 时推进画面，单改 ENV.hour 没人会重申（画面会静止不动）。 */
  if (REEL.on) advanceReel(dt);
  // 水面涟漪（法线缓慢漂移）
  // 环境时序：3 秒缓动过渡（从当前实际画面出发，连点也不会跳）
  if (ENV.t < 1){
    ENV.t = Math.min(1, ENV.t + dt / ENV.dur);
    const e = ENV.t < 0.5 ? 2*ENV.t*ENV.t : 1 - Math.pow(-2*ENV.t + 2, 2) / 2;
    mixInto(ENV.cur, ENV.from, ENV.to, e);
    applyEnv(ENV.cur);
    renderer.shadowMap.needsUpdate = true;   // 过渡中 sunPos/存在性逐帧在动，阴影跟渲
  }
  const rainNow = ENV.cur.rainAmount || 0;
  WIND.uRain.value = rainNow;                 // 雨打枝叶：与风无关的那部分抖动
  waterNormalTex.offset.x += dt * (0.014 + 0.22 * rainNow);
  waterNormalTex.offset.y += dt * (0.009 + 0.17 * rainNow);
  if (waterSurface){
    /* ⚠️ 这行与 WIND.uTime 是**同一个 uniform 对象**（水面 shader 直接引用了它，见
       makeWater 段 `shader.uniforms.uTime = WIND.uTime`）—— 写墙钟 t 会把上面刚写进去的
       windClock 覆盖掉，风的相位又回到"每帧跳 8.4 秒"。必须同源。 */
    waterSurface.material.uniforms.uTime.value = windClock;
    waterSurface.material.uniforms.uRain.value = rainNow;
  }
  /* 低空云雾：色随雾色、浓度随雾密度 —— 所以调环境那一处就够了，不用再来一遍。
     ⚠️ 相位吃 windClock（累加 dt），与枝叶/水面同源：吃墙钟会在低帧率下每帧跳
     一大段，"袅绕"变成"抽搐"（见 MEMORY 铁律）。 */
  {
    MIST.uTime.value = windClock;
    MIST.uColor.value.copy(scene.fog.color);
    /* 向白提足：雾本质是散射光，暮色的橙雾铺满水面会"脏"并拉出橙黑横条
       （2026-09-21 走查 F5），0.22→0.34 让雾读成暖灰而不是橘色缎带。 */
    MIST.uColor.value.lerp(MIST_WHITE, 0.34);
    /* 浓度跟着 fogDensity 走（正午 0.0052 → 暮 0.010，薄雾天气再 ×1.3）：
       同一套 0.0045~0.011 的量表，因此晨昏天然更"雾"，正午只是淡淡一层。
       整体基数 0.17+0.33·mt → 0.10+0.22·mt：片数减了，单片浓度也要再收，
       否则 20 片叠透仍把远池盖白。 */
    const mt = Math.max(0, Math.min(1, (scene.fog.density - 0.0045) / 0.0065));
    /* 下雨时压掉：暴雨里"雨幕"已经是主角，再叠雾会糊成一片灰汤 */
    MIST.uOpacity.value = (0.10 + 0.22 * mt) * (1 - 0.45 * Math.min(1, rainNow));
  }
  // 云层缓慢漂移（天空球只有一张材质）
  /* ⚠️ B2 修复（2026-09-20）：云的 uTime 必须吃**累加仿真时钟** windClock，不能吃墙钟 t。
     与枝叶/水面/雾同一个坑：软渲染一帧 8.4s，墙钟每帧跳 8.4s → 云不是"飘"而是"瞬移"，
     探针低帧率下云影采样也不稳定。真机 60fps 两者等价。 */
  skyMesh.material.uniforms.uTime.value = windClock;

  // 锦鲤沿椭圆轨道游动（轨道经核算落在池内）
  const fishes = koiGroup.userData.fishes;
  /* 行为层（避障 / 惊鱼 / 聚集）的"同组邻居"必须用**同一帧的快照**：
     若就地读 f.position，循环里前面的鱼已是本帧位置、后面的还是上帧位置，
     同一条轨道上会出现半帧错位 ⇒ 聚散力不对称，鱼群会整体偏向一侧。
     这里先拍一份按 orbit 分组的浅拷贝（11 条 × 每帧一次，可忽略）。 */
  const koiPeers = KOI_BEHAVIOR.cohesion ? fishes.map(f => ({ x:f.position.x, z:f.position.z })) : null;
  for (const f of fishes){
    const d = f.userData;
    /* 惊鱼加速：读取本鱼当前惊扰能量（0 起，上限约 1.6），乘进推进速度。
       只改"走得快一点"，不改轨道形状 ⇒ 惊散后仍回到原轨道，不会迷路。 */
    const koiE = koiStartleEnergy(f.position.x, f.position.z, t);
    d.t += dt * d.speed * (ENV.cur.koiSpeed || 1) * (1 + koiE * 0.5);   // 季节：冬季迟缓
    const o = KOI_ORBITS[d.orbit];
    const j = d.jitter + Math.sin(t * 0.35 + d.phase) * 0.06;
    /* ⚠️ 锦鲤越岸穿模（2026-09-17 修）：holder 是 **koiGroup 的子节点**，
       f.position 是局部坐标，父组已经在世界 z=+3（= 池心，水面/池底/驳岸三处都是这个偏移）。
       原来这里又写了一次 `koiGroup.position.x/z`，等于把父组偏移叠加两遍 ——
       三条轨道整体南移 3m，右瓣在 z_local≈5.97 顶到岸线（岸 6.2）、贯穿轨道在收腰处
       z_local≈5.54 越过 4.1 的腰，鱼就骑到草皮上了。
       轨道参数 cx/cz 本来就是**池局部坐标**，直接写即可；世界坐标由父组给。
       （泳龟是 world 的直接子节点，没有父组偏移，所以下面那段必须保留 —— 别照抄删掉。） */
    const bx = o.cx + Math.cos(d.t) * o.a * j;
    const bz = o.cz + Math.sin(d.t) * o.b * j;
    f.position.x = bx; f.position.z = bz;
    /* ── 行为偏移（避障 + 惊鱼 + 聚散）叠加在轨道点之上 ──
       ⚠️ 三条纪律：① 叠加在**基准轨道点**上，不是叠加在 f.position 上（否则逐帧累积漂移）；
       ② 偏移量自身有界（合计 ≤2.6m）且已在 06 内过 pondClamp；
       ③ 后面原有的 0.95×POND_RADII 夹紧与投喂路径**继续保留**，投喂优先、行为让位。
       无行为时偏移恒为 0 ⇒ 逐字等价于原公式（koi-orbit / koi-feed 门禁不受影响）。 */
    if (KOI_BEHAVIOR.avoid || KOI_BEHAVIOR.startle || KOI_BEHAVIOR.cohesion){
      const bo = koiBehaviorOffset(bx, bz, t, koiPeers);
      f.position.x += bo.dx; f.position.z += bo.dz;      // 字段是 dx/dz（已含池域夹紧）
    }
    f.rotation.y = Math.atan2(-(o.b * Math.cos(d.t)), -(o.a * Math.sin(d.t)));
    f.rotation.z = Math.sin(t * 4 + d.phase) * 0.1;

    /* ── 投喂吸引（计划书 Phase 3 第 6 项）────────────────────────────────
       有饵时把"轨道位置"按权重 `aw` 插值到饵点旁的一个**簇位**；饵到期后 aw 平滑回 0
       ⇒ 鱼沿插值路径滑回原轨道（d.t 一直在推进 ⇒ 回位即归队，不会"迷路"）。
       · 簇位绕饵缓慢公转（`t*0.5`）：鱼聚在饵边**打转抢食**，同时避免"到位后朝向退化"
         （位置与目标重合 ⇒ 方向向量为 0 ⇒ 朝向会突变成 0）。
       · 每条鱼的簇位半径/初相由 orbit+phase 定死 ⇒ 11 条不会叠在一点。
       · **无饵时 aw=0** ⇒ 下面的插值/朝向混合全被跳过，逐字等价于原公式
         （koi-orbit 门禁守的"鱼在各自轨道取值域内"因此不受影响）。 */
    const bait = nearestBait(f.position.x, f.position.z);
    if (d.aw === undefined){ d.aw = 0; d.baitAng = d.phase * 1.7; }
    const awTarget = bait ? 1 : 0;
    /* 斜坡：3.0s 靠拢（远者约 2m/s，够快但不瞬移）、2.5s 散开
       ⇒ 满足验收"3 秒内 ≥3 条转向"与"散开后 10 秒内恢复轨道"。 */
    d.aw += Math.sign(awTarget - d.aw) * dt / (awTarget > d.aw ? 3.0 : 2.5);
    d.aw = Math.max(0, Math.min(1, d.aw));
    if (d.aw > 0.001 && bait){
      const cr = 0.35 + 0.45 * (((d.orbit * 0.37) + d.phase) % 1);
      const ca = d.baitAng + t * 0.5;
      const cx = bait.lx + Math.cos(ca) * cr, cz = bait.lz + Math.sin(ca) * cr;
      f.position.x += (cx - f.position.x) * d.aw;
      f.position.z += (cz - f.position.z) * d.aw;
      /* 朝向：轨道切向 与 "指向簇位" 按 aw 混合（atan2 的实参口径与原公式一致：
         原式 = atan2(-vz, vx)，其中 vx = -a·sin(t)、vz = b·cos(t)） */
      let vx = -o.a * Math.sin(d.t), vz = o.b * Math.cos(d.t);
      const ax = cx - f.position.x, az = cz - f.position.z, al = Math.hypot(ax, az);
      if (al > 0.02){ vx = vx * (1 - d.aw) + (ax / al) * d.aw;
                      vz = vz * (1 - d.aw) + (az / al) * d.aw; }
      f.rotation.y = Math.atan2(-vz, vx);
    }
    /* 半径夹紧：防"轨道点 → 饵点"的直线插值在葫芦形**收腰**处切出池外。
       阈值 0.95×POND_RADII（≈0.87× 岸线）远大于轨道半径 ⇒ 无饵时不触发（不扰动门禁）。 */
    const rr2 = Math.hypot(f.position.x, f.position.z);
    if (rr2 > 1e-6){
      let ang2 = Math.atan2(f.position.z, f.position.x); if (ang2 < 0) ang2 += TAU;
      const ri2 = Math.min(POND_RADII.length - 1, Math.floor(ang2 / TAU * POND_RADII.length));
      const cap = POND_RADII[ri2] * 0.95;
      if (rr2 > cap){ const k2 = cap / rr2; f.position.x *= k2; f.position.z *= k2; }
    }

    // 偶尔自深水区上浮，鱼背破水再沉回
    let lift = 0;
    if (KOI_BREACH.on && !d.rising && t >= d.riseAt){ d.rising = true; d.riseT0 = t; }
    if (d.rising){
      const e = t - d.riseT0, rd = 2.8;
      if (e >= rd){
        d.rising = false;
        /* ⚠️ 跃水**间隔**才是"涟漪泛得频繁"的真旋钮（2026-09-26 用户："鱼游出水面会泛起涟漪的频率太过频繁"）。
           一次跃水 = 上浮 + 破水 + 沉回，破水与入水**各**触发一次落圈（见下）⇒ 事件数 = 落圈数 ÷ 2。
           11 条鱼、间隔中位 18s ⇒ 事件 11/18×60 = 36.7 次/分、落圈 73 次/分；
           加两只泳龟的 1.5~2.7s 尾迹（56 次/分）⇒ 池面合计 **实测 120 次/分、平均每 0.5s 一圈**，
           池子长期有活涟漪，"偶发一记"读成了"持续不断"（见 spawnRipple 上方 REFLECT_FULL_ON_FISH 注释）。
           取 **floor 9s + spread 48（中位 33s）**：事件 11/33×60 = **20 次/分**、落圈 **40 次/分**，
           回到"每隔几秒偶有一条鱼破水"的合理水位，且不牺牲"游着游着忽然一条窜出水面"的生气。
           ⚠️ `Math.random()` 调用**次数仍为 1**、**位置仍在原处**（运行期效果，不吃布局流 rr()）——
             改的是系数不是流拓扑，全局 rnd 序列零漂移（layout-fingerprint 基线不动）。
           ⚠️ 下界 9s 保留：不能短到"鱼刚沉回去就又窜起来"（那才叫机械）。
           ⚠️ 初值 `riseAt`（06-vegetation 的 KOI_DRAW.rise = Math.random()*18 + 6）**未动**：
             它只决定开场多久起第一条鱼，与稳态频率无关。 */
        d.riseAt = t + KOI_BREACH.floor + Math.random() * KOI_BREACH.spread;
      } else {
        lift = Math.sin(Math.PI * (e / rd)) * 0.11; // 上浮再沉回
      }
    }
    f.position.y = CFG.water - 0.06 + Math.sin(t * 1.6 + d.phase) * 0.02 + lift;
    /* ⚠️ 涟漪要由**破水与入水两次穿越**触发，不能"上浮到一半时来一圈"。
       原来只在 u≥0.5 触发一次，落回水里那一下是干的；而且鱼背的出水高度只有 ~0.12m，
       一圈乱起在"没看清它在干什么"的时刻，看起来就是凭空的圈。
       判据：**水面在 CFG.water+0.06（不是 CFG.water）**，用"鱼背高出水面"的符号变化判穿越。 */
    const emerged = f.position.y + (d.halfH || 0.12) - (CFG.water + 0.06);
    if (d.wasEmerged === undefined) d.wasEmerged = emerged > 0;
    if ((emerged > 0) !== d.wasEmerged){
      d.wasEmerged = emerged > 0;
      /* ⚠️ f.position 是 **koiGroup 的局部坐标**（koiGroup 自己在 z=+3），
         直接拿它当世界坐标会把涟漪起在鱼的南边 3 米 —— 鱼的位置公式里加过
         koiGroup.position，这里却忘了加，两个口径不一致。统一取世界坐标。 */
      f.getWorldPosition(_swimmerWorld);
      spawnRipple(_swimmerWorld.x, _swimmerWorld.z, t, 3);   // 出水一圈、入水再一圈
    }
  }
  updateRipples(t);
  updateRainRipples(t);
  updateBaits(t);                        // 投喂：饵粒子下沉/淡出 + 饵点到期回收
  tickFestival(t);                       // 上元灯会：河灯随波漂移（非灯会态零成本直接 return）
  updatePrecip(dt, t);

  /* 蜻蜓：游弋航迹 + 高频振翅。
     ⚠️ 季节/天气把它藏起来时（dragonflyShow=0：冬季、暴雨、风雪）不必再算航迹 —— 原来照算不误。 */
  for (const d of dragonflies){
    if (!d.visible) continue;
    const fl = d.userData.flight;
    const tt = t * fl.sp + fl.ph;
    d.position.set(
      fl.cx + Math.cos(tt) * fl.ax + Math.sin(tt * 2.7) * 0.9,
      fl.y0 + Math.sin(tt * 3.3 + 1.1) * 0.24,
      fl.cz + Math.sin(tt * 1.6) * fl.az + Math.cos(tt * 3.1) * 0.7
    );
    const dx = -Math.sin(tt) * fl.ax + Math.cos(tt * 2.7) * 2.43;
    const dz =  Math.cos(tt * 1.6) * fl.az * 1.6 - Math.sin(tt * 3.1) * 2.17;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) d.rotation.y = Math.atan2(dx, dz);
      for (const w of d.userData.wings){
        w.rotation.z = w.userData.sx * Math.sin(t * 44 + w.userData.ph) * 0.55;
      }
  }
  /* 停栖蜻蜓：停在真实的花/叶锚点上，停一阵换一朵。
     ⚠️ 必须在这里调 —— 子代理留下了 updatePerchingDragonflies 却从未调用，
     两只蜻蜓 visible 恒为 false，等于没做。 */
  updatePerchingDragonflies(dt, windClock, perchShowOK);

  // 乌龟缓游（同轨道，速度更慢）
  for (const tw of swimTurtles){
    const d = tw.userData;
    d.t += dt * d.speed * (ENV.cur.koiSpeed || 1);   // 季节：冬季迟缓
    const o = KOI_ORBITS[d.orbit];
    const j = d.jitter + Math.sin(t * 0.25 + d.phase) * 0.05;
    tw.position.x = koiGroup.position.x + o.cx + Math.cos(d.t) * o.a * j;
    tw.position.z = koiGroup.position.z + o.cz + Math.sin(d.t) * o.b * j;
    /* ⚠️ 吃水深度是量出来的：模型原点在**底面**（loadAssetOnce 把底部对齐到 y=0），
       而这只龟的"原点→壳顶" = 0.271m。原来的 -0.05 只把 18% 的身高压进水里，
       壳顶高出水面 0.18m —— 看起来是"趴在水面上滑行"。压到 0.12 后约 44% 没入水中。 */
    tw.position.y = CFG.water - 0.12 + Math.sin(t * 0.9 + d.phase) * 0.02;
    /* 乌龟是"壳贴着水面游"的（实测壳顶高出水面 0.15~0.20m），
       但原来一条尾迹都没有 —— 看起来像贴在水面上滑行。
       按自己的节奏留圈；季节把乌龟藏起来时（冬季 turtleShow=0）不要再留。 */
    if (TURTLE_WAKE.on && tw.visible && t >= (d.wakeAt || 0)){
      spawnRipple(tw.position.x, tw.position.z, t, 2);
      d.wakeAt = t + TURTLE_WAKE.floor + Math.random() * TURTLE_WAKE.spread;
    }
    tw.rotation.y = Math.atan2(-(o.b * Math.cos(d.t)), -(o.a * Math.sin(d.t)));
  }

  // 人物日程（第十四轮）：天气门禁 + 时段 + 散步缓行
  // ⚠️ 大事：**有效天气**取 effectiveWeather()（冬+storm=winterrain），不要只查 ENV.weather
  const effW = effectiveWeather();
  const goodWeather = effW !== 'storm' && effW !== 'snow' && effW !== 'winterrain';

  /* ── 氛围粒子驱动（2026-09-20）──
     萤火：夏 · 夜 · 晴/薄雾 才亮（雨夜虫不聚光，月光被云遮住也差点意思），uOpacity 平滑淡入淡出。
     镜前雨雪：强度直接跟解析后的 rainAmount / snowAmount —— 冬·狂风细雨（0.62）天然比夏雨（1.0）疏。
     风向向量传进去给雨丝倾斜用。 */
  {
    const fireWant = ENV.season === 'summer' && ENV.time === 'night'
      && (effW === 'clear' || effW === 'mist') ? 0.9 : 0;
    const fu = fireflies.material.uniforms.uOpacity;
    fu.value += (fireWant - fu.value) * Math.min(1, dt * 1.6);
    fireflies.visible = fu.value > 0.01;
    lensWeather.update(dt, camera.aspect,
      Math.min(1, ENV.cur.rainAmount || 0),
      Math.min(1, ENV.cur.snowAmount || 0),
      WIND.uWindVec.value);
  }
  for (const f of figures){
    // 呼吸（衣袍微起伏）
    const b = Math.sin(t * 1.7 + f.userData.breathPhase) * 0.006;
    f.userData.robe.scale.set(1 + b, 1 + b * 0.45, 1 + b);
    // 时段门禁：晨读（7.5~12）/ 午茶（12~18）/ 夜步（18~23）；无时段 = 全天（旧样稿）
    const sl = f.userData.slot;
    let inSlot = !sl || (ENV.hour >= sl.h0 && ENV.hour < sl.h1);
    f.visible = goodWeather && inSlot;
    /* 步态（2026-09-18）：原来散步**只有 position 平移**、姿态仍是站桩负手 —— 读起来是"滑行"。
       算一遍才发现更硬的问题：z 振幅 5.1m、ω = sp·TAU·2 = 1.382 rad/s → 周期 4.55s
       → 一个来回 10.2m / 4.55s = **2.24 m/s**（≈8km/h），是慢走（0.6~0.9）的两倍半，
       姿态再站桩，读作"滑行"是必然。所以 sp 0.11 → 0.027（均速 0.55 m/s，往返 18.5s）。
       步相按**走过的距离**推进（不是按时间）：掉头时不会出现倒退的步频。
       步幅 0.42m/步 → 0.55/0.42 ≈ 1.3 步每秒（78 步/分，正是缓行的步频）。
       人只有裙摆没有腿，走路感只能靠 起伏 + 左右摆 + 前倾 三件套。 */
    if (sl && sl.stroll && f.visible){
      const s2 = sl.stroll;
      /* ⚠️ 散步相位必须吃**累加仿真时间**（dt 序列），不能吃顶部的 `t`（timer 原始墙钟）。
         软渲染一帧 8.4s → `t` 每帧跳 8.4 → 人在两次采样之间瞬移 3.8m：探针"解算机位时人还在
         z=-3.48、快门时已跑到画面外（NDC y=0.93）且被 mergedStatic 挡住 0.60m"就是这个。
         锦鲤用的是 `d.t += dt` 累加、只有抖动项吃原始 `t` —— 这里统一成同一口径。
         真机 60fps 下 dt 累加 ≡ 墙钟，观感不变；软渲染下与风/水一样慢放，且探针可复现。 */
      f.userData.strollT = (f.userData.strollT || 0) + dt;
      const stt = f.userData.strollT;
      const ph = Math.sin(stt * s2.sp * TAU * 2 + f.userData.breathPhase);
      const nx = s2.a + (s2.b - s2.a) * 0.5 * (1 + Math.sin(stt * s2.sp * TAU + 1.7));
      const nz = s2.z0 + (0.5 + 0.5 * ph) * (s2.z1 - s2.z0);
      const lp = f.userData.lastPos;
      const ddx = lp ? nx - lp.x : 0, ddz = lp ? nz - lp.z : 0;
      const dist = Math.hypot(ddx, ddz);
      f.position.x = nx; f.position.z = nz;
      f.userData.lastPos = { x: nx, z: nz };
      /* 朝向必须跟着**行进方向**（模型正面 = +z → `atan2(dx, dz)`）。
         ⚠️ 日程里的 `yaw` 只管首帧：`D_SCHEDULES[2].yaw = π/2` 是"面朝 +x"，而人沿 z 轴来回走
         —— 那就是**侧着身子平移**。它和"相机解算漂移"是两个**互相独立**的缺陷
         （一个让样张空无一人、一个让动作不成立），共同点是都不报错、都不影响任何断言，只能看图发现。
         首帧直接定死朝向（否则会停在 π/2 上慢慢转过去，样张恰好拍成半转身）；
         之后按 dt 平滑，掉头时才不会瞬间翻 180°。 */
      if (dist > 1e-4){
        const want = Math.atan2(ddx, ddz);
        if (f.userData.strollDir == null){
          f.rotation.y = want; f.userData.strollDir = 1;
        } else {
          let d = want - f.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));       // 归一到 (-π, π]，否则掉头瞬间翻 180°
          f.rotation.y += d * Math.min(1, dt * 4);
        }
      }
      f.userData.stepPhase = (f.userData.stepPhase || 0) + dist / 0.42 * Math.PI;
      const st = f.userData.stepPhase;
      f.position.y = Math.abs(Math.sin(st)) * 0.028;   // 迈步起伏
      f.rotation.x = 0.05;                             // 前进时躯干微前倾
      f.rotation.z = 0.03 + Math.sin(st) * 0.035;      // 左右轻摆（含原本的重心微偏 0.03）
    } else {
      f.position.y = 0; f.rotation.x = 0; f.rotation.z = 0.03;
    }
  }

  if (SEASON_DEMO.on) advanceSeasonDemo(dt);
  updateCamFly(dt);
  updateTour(dt);
  updateIntro(dt);                        // 开场运镜（controls 已被它禁用，update 只刷新阻尼）
  controls.update();
  /* 相机一切就位后再判"是否静止"：自动运镜/巡游/四季演示的飞行都会被认成运动，
     于是升采样只发生在真正的静观时刻（这正是它最该生效的地方）。 */
  AA.tick();
  renderer.info.reset();
  tickLampVol(performance.now() * 0.001);   // 体散射/地面光斑的时间源
  composer.render();

  /* 音景每 0.25 秒跟一次环境值（setTargetAtTime 自己会平滑，不需要每帧） */
  sndAcc += dt;
  if (sndAcc >= 0.25){ sndAcc = 0; Snd.tick(ENV.cur); }

  /* 统计（每 0.5 秒刷新一次，避免频繁写 DOM）
     ⚠️ 必须用 rawDt：用被钳到 50ms 的 dt 记账，真实 10fps 会被显示成 20fps ——
     右下角这个数字是性能判断的依据，不能是安慰剂。 */
  acc += rawDt; frames++;
  if (acc >= 0.5){
    fps = Math.round(frames / acc);
    const info = renderer.info;
    /* 帧率自适应：把 stats 已算好的真实 fps 交给 QOS（软渲染下 QOS 自动免疫） */
    QOS.sample(fps);
    const q = QOS.state();
    statsEl.textContent =
      `${fps} fps\n` +
      `draw calls  ${info.render.calls}\n` +
      `triangles   ${info.render.triangles.toLocaleString()}\n` +
      `geometries  ${info.memory.geometries}\n` +
      `textures    ${info.memory.textures}\n` +
      `${weatherTag()} · ${timeLabelNow()}${ENV_SEASON[ENV.season].label}\n` +
      `画质 ${q.mode === 'auto' ? '自动' : q.mode === 'high' ? '高' : q.mode === 'balanced' ? '均衡' : '性能'} · ${q.tierLabel}档 · ${q.ao ? 'GTAO' : '无 AO'} · 超采样 ${SUPERSAMPLE}x · QoS L${q.level}\n` +
      `按 0 复位视角 · 拖动旋转 / 滚轮缩放`;
    acc = 0; frames = 0;
  }

  /* 水面真折射（P2-5）：放在 composer.render() **之后** ——
     ① 阴影此时已按本帧更新过（折射 pass 关掉自动更新就不会每帧多重渲一张 6144² 阴影图，
        尤其在环境过渡期 needsUpdate 每帧都为 true）；
     ② 水面用的是**上一帧**的池底贴图 —— 鱼游得慢，一帧延迟肉眼无感。
     ⚠️ 在 composer 之前调会把 stats 的 draw call 记账顺序打乱（reset 在 composer 前）。 */
  renderRefraction();
}

/* ── 首帧那 5 秒怎么治（2026-09-20 · B3）────────────────────────
   病灶：启动分段里"首帧"一段独占 ~5s —— 57 个 shader program 的编译+链接全挤在
   第一次 render 里同步完成，主线程整段冻结，加载页只剩合成线程的滑条在动。

   试过的弯路：`compileAsync` 提前编 —— 实测**负优化**（program 63→101、首帧更慢 1.8s）。
   原因：compileAsync 编的是"调用那一刻渲染状态"对应的 program，与真正首帧的
   灯组/阴影/雾宏组合对不上，同一批材质被编两遍。

   最终方案（两步）：
   ① 减 program：风材质的 amp/speed/mode/maxDisp 从编译期常量降为 uniform，
      program 63→57（首段 5785→5016ms，-13%，见 01-materials.addWind）。
   ② 分帧暖编译（下面 warmBoot）：把全部可见对象按材质重量分 12 桶，逐帧揭示，
      走**真实 composer.render()**——灯/雾/阴影/色调映射与生产帧完全一致，
      program 宏严格对齐，绝不重编。编译总量不变，但每帧只卡 0.3~0.6s，
      帧间加载页进度文案/进度条照常推进，"死等 5 秒"变成"看得到进度的十几帧"。 */
const WARM_STAGES = ['立屋架', '铺黛瓦', '叠山石', '引池水', '植花竹', '起烟云'];
const _warmRaf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

function collectWarmBuckets(){
  /* ── 装箱度量：按**渲染签名分组 + 轮转摊开"首现"**（2026-09-24 配平）─────────────
     为什么换掉原来的"材质重量"模型：实测（outputs/_diag/warm-buckets2.mjs）各桶权重都是 ~100，
     编译耗时却从 5ms 到 1943ms —— 权重几乎无预测力（r=0.199）。真正的成本是
     "该帧**首次编译的 program 数**"（r=0.940，全场 36~42 个 program）：program 编过一次，
     之后复用它的对象免费（这正是靠后的桶几乎不花时间的原因）。
     用什么当 program 的代理：**渲染签名**（材质类型 + 有无各类贴图 + side/transparent/alphaTest/
     vertexColors/flatShading + 是否实例化/投影/收影）。离线用真实 program 身份验证过
     （outputs/_diag/warm-scheme.mjs，同一页对比四种方案，判据是"每桶新增 program 数"）：
       现行重量贪心 [1,18,7,2,2,1,1,3,1,0] 最大 18
       材质 uuid   [1,11,3,4,5,5,3,3,1,0] 最大 11
       **签名       [1,7,7,6,3,2,4,1,3,2] 最大 7**   ← 采用
       oracle      [1,6,4,4,4,4,4,4,4,1] 最大 6
     签名数 34 ≈ program 数 36（几乎一一对应），所以按它摊开首现就能把最坏帧从 18 个 program
     压到 7 个。桶数仍 10、循环结构不变（加载页进度更新次数也不变）。
     ⚠️ 若将来某个桶又变重：先看是不是新增了"同签名但不同 program"的用法（如新的材质变体）。 */
  const sig = (o, m) => [
    m.type, !!m.map, !!m.normalMap, !!m.alphaMap, !!m.aoMap, !!m.roughnessMap, !!m.metalnessMap,
    !!m.emissiveMap, m.side, m.transparent ? 1 : 0, (m.alphaTest || 0) > 0 ? 1 : 0,
    m.vertexColors ? 1 : 0, m.flatShading ? 1 : 0,
    o.isInstancedMesh ? 1 : 0, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0,
  ].join(',');
  const items = [];
  scene.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isLine)) return;
    if (o.visible === false) return;             // 萤火虫/镜前雨等初始隐藏：用到时再编
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    items.push({ o, key: mats.filter(Boolean).map(m => sig(o, m)).join('+') });
  });
  const groups = new Map();
  for (const it of items){
    if (!groups.has(it.key)) groups.set(it.key, []);
    groups.get(it.key).push(it);
  }
  const N = 10;
  const buckets = Array.from({ length: N }, () => ({ list: [], firsts: 0 }));
  /* 天空独占第一桶（天空球 shader 是全场最重之一，且它只有一个对象） */
  const skyItem = items.find(it => it.o === skyMesh);
  if (skyItem){
    buckets[0].list.push(skyItem.o); buckets[0].firsts++;
    const g = groups.get(skyItem.key);
    g.splice(g.indexOf(skyItem), 1);
  }
  /* 组按大小降序，首现只摊到桶 1..N-1（桶 0 留给天空：它自己的 program 就 ~250ms，
     再塞别的首现会变成最重桶）；**余下对象塞进"首现最少"的桶**。
     ⚠️ 别改成"余下对象也轮转摊匀"：实测那样会让每桶新增 program 从最大 10 涨到 17
     （签名是 program 的**近似**，同签名的对象仍可能引入新 program；把它们摊开反而打乱了首现的摊布）。
     实测（outputs/_diag/warm-buckets-ab.mjs 连跑 3 轮，program 分布逐轮相同）：
       本方案           每桶新增 [5,10,4,3,4,3,2,5,4,0] 最大 10 ｜ 最重桶 1189ms
       余下对象也轮转   每桶新增 [5,17,6,1,0,4,1,3,2,1] 最大 17 ｜ 最重桶 2885ms
       原始重量贪心     每桶新增 [1,18,7,2,2,1,1,3,1,0] 最大 18 ｜ 最重桶 1751~1943ms */
  const order = [...groups.values()].filter(g => g.length).sort((a, b) => b.length - a.length);
  let rot = 0;
  for (const g of order){
    const b = buckets[1 + (rot++ % (N - 1))];
    b.list.push(g[0].o); b.firsts++;
    for (let k = 1; k < g.length; k++){
      let light = buckets[1];
      for (let j = 1; j < N; j++) if (buckets[j].firsts < light.firsts) light = buckets[j];
      light.list.push(g[k].o);
    }
  }
  return buckets.filter(b => b.list.length > 0).map(b => ({ list: b.list, w: b.firsts }));
}

/* ══ 两段进度合成（2026-09-27 · 高精资产预载）════════════════════════════
   下载段占前 PRELOAD_SHARE（45%），暖编译 10 桶占后 55% —— 合成一条单调不减的进度。
   ⚠️ 为什么不直接分两条：两条各自推进再相加会出现"下载占 45% 后卡住不动"的观感，
      而合成一条后，每一段的推进都在同一条 bar 上可见（这才是"下载好再开园"的感觉）。
   ⚠️ 文案红线：下载段的文案**不许带 %**（见 13-preload.describe 的说明），
      只有暖编译段才产出 `营 造 中 · <WARM_STAGES 值> <pct>%` —— 那是 loading-guard 认的格式。 */
const PRELOAD_SHARE = 45;   // 下载段占前 45%，暖编译占后 55%
const _ldTxt = () => document.querySelector('#loading .ld-text');
const _ldProg = () => document.querySelector('#loading .ld-prog');
const _ldNote = () => document.querySelector('#loading .ld-note');

/* 下载段：把 13-preload 的聚合进度画成 0→45%。
   采样合并由 preloadPhase 保证（≥250ms + 整数百分比去重），这里只负责渲染。 */
function setPreloadUI(a){
  const prog = _ldProg();
  const pct = Math.min(PRELOAD_SHARE, Math.round(a.pct * PRELOAD_SHARE));
  if (prog) prog.style.width = pct + '%';
  const txt = _ldTxt();
  if (txt) txt.textContent = preloadDescribe(a);
  const note = _ldNote();
  if (note){
    const s = a.notice || slowNotice();
    /* 慢网提示挂 .ld-note（常驻小字）而不是 .ld-text ——
       loading-guard 用 MutationObserver 记录 .ld-text 的 textContent 变更序列，
       把提示塞进去会被算进"文案序列"、干扰"收尾文案 == 即将开园"的判定。 */
    note.textContent = s ? s.text : '';
    note.classList.toggle('on', !!s);
  }
}

/* 暖编译段：格式与文案**逐字不变**（loading-guard 依赖它）。done/total 仍是桶进度。 */
function setWarmUI(done, total){
  const txt = _ldTxt();
  const prog = _ldProg();
  const pct = Math.min(100, Math.round(PRELOAD_SHARE + (done / total) * (100 - PRELOAD_SHARE)));
  if (prog) prog.style.width = pct + '%';
  if (txt){
    const stage = WARM_STAGES[Math.min(WARM_STAGES.length - 1,
      Math.floor(done / total * WARM_STAGES.length))];
    txt.textContent = done >= total ? '即 将 开 园' : `营 造 中 · ${stage} ${pct}%`;
  }
}

async function warmBoot(){
  /* ── 阶段 0：资产预载（2026-09-27 · 高精资产批次）────────────────────────
     4 个 GLB 在**模块求值期**就发起了（08-assemble/06 的 loadAssetOnce），本函数
     是在它们之后才被调用的 —— 所以这里不是"开始下载"，而是**等它们到位**，
     并把等待如实播报成 0→45% 的进度（1.1 MB 实测余量 9456/3220ms，本来就被
     暖编译窗口完全掩盖；10 MB 目标下不再能掩盖，这才必需）。
     ⚠️ preloadPhase 永不 reject：预载失败不是启动失败，降级继续开园才是正解。 */
  await preloadPhase(setPreloadUI);

  const buckets = collectWarmBuckets();
  const saved = [];
  for (const b of buckets) for (const o of b.list) saved.push(o);
  /* 暖机期全部先隐藏（保持视锥剔除开启：禁用剔除会让 12 帧都过一遍全场景顶点，
     实测多烧 ~0.5s；家位视角外的少数材质，首转视角时再编，只是零星小卡顿）。 */
  for (const o of saved) o.userData.__warmVis = o.visible, o.visible = false;
  /* 分桶帧只编主 pass：阴影图与水面反射都是"全场景再渲一遍"的重 pass，
     12 桶各跑一次会多烧 ~1.4s —— 全部压到最后的"彩排帧"一次编齐。 */
  const prevAuto = renderer.shadowMap.autoUpdate;   // 生产态恒为 false
  const prevWaterHook = waterSurface ? waterSurface.onBeforeRender : undefined;
  const _warmNoop = () => {};   // ⚠️ 不能赋 null：three 只判 `!== undefined`，null 照样被当函数调用
  const _prevBloom = bloom.enabled;
  if (gtaoPass) gtaoPass.enabled = false;   // 分桶期不跑 bloom/GTAO（省全链/整场景法线），彩排帧统一开回
  const restore = () => {
    for (const o of saved){ o.visible = o.userData.__warmVis; delete o.userData.__warmVis; }
    renderer.shadowMap.autoUpdate = prevAuto;
    renderer.shadowMap.needsUpdate = true;
    bloom.enabled = _prevBloom;
    if (gtaoPass) gtaoPass.enabled = true;
    if (waterSurface) waterSurface.onBeforeRender = prevWaterHook;
  };
  try {
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    if (waterSurface) waterSurface.onBeforeRender = _warmNoop;
    bloom.enabled = false;
    for (let i = 0; i < buckets.length; i++){
      for (const o of buckets[i].list) o.visible = true;
      setWarmUI(i, buckets.length);
      await _warmRaf2();                         // 先让加载页把新进度画出来，再卡这一帧编译
      /* 必须走真实 composer 渲染（不能用 renderer.compile 预编）：program key 含
         灯组/阴影/输出色彩空间等渲染期状态，裸 compile 编出的 program 与 RenderPass
         宏组合对不上，彩排帧会整批重编（实测 37→87，比不暖机更慢）。 */
      composer.render(0.016);
    }
    /* 彩排帧：对象已全部揭示，走完整生产路径——后处理链 + 阴影图 + 水面反射 + 主 pass
       + 折射——剩余 program（bloom/GTAO/depth/反射/折射变体）一次编完，animate 首帧零编译。 */
    bloom.enabled = _prevBloom;
    if (gtaoPass) gtaoPass.enabled = true;
    if (waterSurface) waterSurface.onBeforeRender = prevWaterHook;
    renderer.shadowMap.needsUpdate = true;
    setWarmUI(buckets.length - 1, buckets.length);
    await _warmRaf2();
    composer.render(0.016);
    renderRefraction();
    setWarmUI(buckets.length, buckets.length);
    await _warmRaf2();
    bootMark('暖机');
  } finally {
    restore();
  }
}

function startAfterWarm(){
  animate();

  // 首帧（暖机后第一帧几乎零编译）渲染完成后隐藏加载层
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      document.getElementById('loading').classList.add('done');
      /* 开场运镜：loading 层淡出的 0.7s 正好遮住起幅跳切。探针/减弱动效默认不播（?intro=1 强制）。 */
      introMaybeAuto();
      /* 首次引导：首帧之后才弹（早于此时画布还是白的，教人转视角没有意义）。
         ⚠️ 探针每次都是全新的 localStorage → 引导**一定会**出现。它非模态且首次交互即消失，
           所以不会挡住任何门禁的点击。 */
      guideMaybeAuto();
      bootMark('首帧');
      runDeferredBoot();                     // P1-4：首帧已出，现在补装柳/竹/立峰（分帧让出主线程）
      console.log('[启动分段] ' + BOOT.marks.map(([n, t]) => n + ' ' + t + 'ms').join(' → ') +
                  ' ｜ 合计 ' + (performance.now() - BOOT.t0).toFixed(0) + 'ms' +
                  (assetFailures ? ' ｜ 资产失败 ' + assetFailures + ' 个' : ''));
      console.log('[远香堂] 场景就绪', {
        GPU档位: GPU_TIER, 超采样: SUPERSAMPLE, GTAO: AO_ENABLED,
        meshes: registry.meshes,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      });
    });
  });
}

/* 暖机失败绝不允许拖死启动（加载页会永久卡住）：报警后按老路径直接进主循环 */
warmBoot().then(startAfterWarm, (err) => {
  console.warn('[暖机] 分帧编译失败，回退直接启动：', err);
  startAfterWarm();
});

// 供外部检查使用（smoke 测试与采集脚本都从这里驱动）
window.__garden = { scene, camera, renderer, composer, controls, THREE, ENV, setEnv, applyEnv,
                  MAT,   // 材质表：门禁要按材质身份断言（如冬季紫藤花穗 count=0），别让探针靠启发式猜
                  WIND, PRECIP, weatherAllowed, effectiveWeather, weatherMutexReason, resetCamera,
                  /* T0：装配完成信号（2026-09-23）。⚠️ bootDone 是 08-assemble 的 `let` 活绑定，
                     必须用 getter 函数读 —— 直接写 `bootDone` 会在建这个对象时把 false 定格，
                     探针就永远等不到"已完成"。bootDonePromise 可直接 await。 */
                  bootDone: () => bootDone, bootDonePromise,
                  /* 反射按需更新（2026-09-24）：把"水面是否活跃"暴露给门禁 ——
                     门禁必须先**断言**这个前提（晴 + 无涟漪）才能测"观景态降频"，
                     否则测到的可能是"有涟漪/在下雨"下的满速（那是正确行为）。 */
                  waterBusy: () => HOOKS.waterBusy ? HOOKS.waterBusy() : false,
                  ripplesActive,
                  lastRippleAge: () => lastRippleAge,   // 供门禁/诊断读"距最近一次起涟漪多久"
                  /* 风的调度器（2026-09-18）：门禁要断言"风向真的是 16 档之一、风力真的是四档之一"，
                     以及"档位保持时长够久"。靠读 uniform 反推不出档位号，必须显式暴露。
                     ⚠️ updateWindDir / updateWindForce 也要暴露：软渲染下一帧 8.4s，
                     靠墙钟等 30 秒的换向间隔根本等不到（而且模拟时间只走真实的 1/20）——
                     探针必须能**手动步进**状态机（本项目既定范式）。 */
                  WIND_DIR, WIND_FORCE, FORCE_TIERS, DIR_N, DIR_STEP,
                  forceBand, windGain, updateWindDir, updateWindForce,
                  flyTo, gotoViewpoint, VIEWPOINTS, HERO_POS, lanternGroups,
                  /* 人物（2026-09-18）：门禁要读各角色服色与步态。**必须显式暴露**——
                     靠 traverse 猜对象会漏（灯笼那次就踩过"引用没暴露 → found:false"）。 */
                  figures, FIG_PALETTE, FIG_HAIR,
                  GLB_LOTUS_STEM_H,
                  koiGroup, swimTurtles, KOI_ORBITS, insidePond, POND_RADII, POND_PTS,
                  perchingDragonflies, perchingAnchors, updatePerchingDragonflies,
                  perchShow: () => perchShowOK, PERCH_LIFT,
                  camFly: () => CAM_FLY.on,
                  camFlyState: () => ({ on: CAM_FLY.on, owner: CAM_FLY.owner, t: CAM_FLY.t, dur: CAM_FLY.dur }),
                  /* 本次飞行落位后要恢复的 OrbitControls 最小半径。暴露给门禁做**确定性**断言：
                     "gotoViewpoint 是否真的把机位自带的 minDist 交给了 flyTo" —— 这条一旦断，
                     近观机位会被静默弹回 9m（方位正确、行程走完、不报错，只有量落位距离才看得见）。 */
                  camFlyMinDist: () => CAM_FLY.minDist,
                  /* 阴影（2026-09-18）：门禁要断言「阴影视体真的罩住了园子」——
                     这是"阴影静默失效"类缺陷（盒外的地不做阴影测试 → 影子被切成一条亮缝，
                     不报错、不崩、只有量盒边界才看得见）。暴露量不是布尔值而是拟合结果。 */
                  fitShadowCamera, refreshCasterBox, casterBox,
                  shadowFit: () => sun.userData.fitInfo,
                  shadowCam: () => { const c = sun.shadow.camera;
                    return { left:c.left, right:c.right, top:c.top, bottom:c.bottom, near:c.near, far:c.far }; },
                  shadowCamObj: () => sun.shadow.camera,
                  sunLight: () => sun,
                  /* 湿地：门禁要断言"湿 ≠ 变成金属镜面"。给的是逐材质的干/湿对照，
                     不是布尔值 —— 判据（湿度提升幅度）得在探针里算。 */
                  wetMats: () => WET_MATS.map(m => ({ name: m.name || m.uuid.slice(0, 6),
                    rough: +m.roughness.toFixed(4), dryRough: m.userData.dryRough,
                    metal: +m.metalness.toFixed(4), dryMetal: m.userData.dryMetal })),
                  wetNow: () => wetApplied,
                  tourStart, tourStop, tourState: () => ({ on: TOUR.on, idx: TOUR.idx }),
                  tourCaption: () => { const el = captionEl(); return el ? el.querySelector('b').textContent : ''; },
                  qosState: () => QOS.state(), setQos: (lv) => QOS.apply(lv),
                  qualityState: () => QOS.state(), setQualityMode: (m) => QOS.setMode(m),
                  qosSample: (fps) => QOS.sample(fps),
                  hidden: () => pageHidden, gpuName: GPU_NAME, softwareGL: SOFTWARE_GL,
                  /* 固定步长仿真（2026-09-25）：门禁要在**低帧率**下验证“仿真速度不膨胀”，
                     但无头浏览器很难稳定造出 20fps ⇒ 暴露纯函数让它直接按指定 dt 步进。 */
                  simClock: () => simTime, stepSim, windClockNow: () => windClock,
                  simState: () => ({ simTime, steps: simSteps, accum: simAccum, fixed: FIXED_DT, maxSteps: MAX_STEPS }),
                  /* 涟漪容量：门禁要断言"暴雨+密集点击+鱼跃"不抢不到槽（2026-09-25 由 20 提到 64） */
                  rippleCapacity,
                  /* 渐进超采样（2026-09-26）：门禁要断言"静止升档/一动回落/性能档不上探/
                     QOS 降档后停手"，这些都不能靠像素差看出来，只能读状态。 */
                  aaState: () => AA.state(), aaSetStep: (s) => AA.setStep(s),
                  /* PMREM 四时段缓存：门禁要断言"切时段时反射色变了但只烘一次" */
                  envBakeState,
                  probeDriven: PROBE_DRIVEN, qosImmune: QOS_IMMUNE,
                  queuePostcard, postcardData, toggleSound, sndState: () => Snd.on,
                  /* 长曝光明信片：门禁要能触发并量 uStarRot 是否归零（叠完忘复位=星星天天靠它转） */
                  longExposure: queueLongExposurePostcard, longExposureData,
                  lxpConfig: () => ({ ...LXP }), lxpStarRot: () => skyMesh.material.uniforms.uStarRot.value,
                  /* 音景（2026-09-19）：门禁要能读**分层计划**（纯函数，不依赖真的出声）
                     和**真实节点电平**（判"接上了"）。只给 sndState 一个布尔值守不住
                     "该响的时候没响"这类全静默失效。 */
                  sndPlan: (p) => Snd.plan(p || ENV.cur), sndLevels: () => Snd.levels(),
                  sndCtxState: () => Snd.ctxState(), sndBirds: () => Snd.species(),
                  sndVolume: () => Snd.volume, sndSetVolume: (v) => Snd.setVolume(v),
                  /* 首次引导（2026-09-19）：门禁要能读步序、翻页、收起，并验"非模态 + 首次交互即消失" */
                  guideState: () => ({ on: GUIDE.on, i: GUIDE.i, steps: GUIDE_STEPS.length }),
                  guideStart, guideNext, guideStop,
                  /* 水面真折射（P2-5）：门禁要能把折射贴图读出来验证「鱼真的被渲进了池底贴图、
                     且 UV 映射方向没反」—— 这两件事都只能靠读像素，状态/几何都看不出来。 */
                  refractInfo, refractRT: () => refractInfo().on ? getRefractRT() : null,
                  /* 晴午水面太阳波光（2026-09-21）：门禁/样张要能断言「正午晴天 uSunVis>0、
                     晨昏/夜/雨=0」—— 这是"白天水面白刺一片"静默缺陷的量测通道。 */
                  sunVisWater: () => (waterSurface && waterSurface.material.uniforms.uSunVis)
                                        ? waterSurface.material.uniforms.uSunVis.value : null,
                  REEL, toggleReel,   // 时光流转：门禁要能开关并读 hour 推进量
                  /* 开场运镜（2026-09-20）：门禁要能强制播/中途取消/读状态。
                     只给 active 一个布尔值守不住"飞到一半停了""落位没恢复 minDistance"——
                     intro-guard 要读段号/进度，并比对落位点与 VIEWPOINTS 的 overview 是否一致。 */
                  introStart, introCancel, introActive,
                  introState: () => ({ on: INTRO.on, seg: INTRO.seg, t: INTRO.t }),
                  camMinDist: () => CAM_MIN_DIST,
                  /* 偶得随机景色：门禁要能抽取并读回三轴结果；TIME_ANCHORS 用于验 hour 的 ±0.6h 抖动幅度 */
                  randomScene: () => HOOKS.randomScene(),
                  TIME_ANCHORS,
                  /* 丁达尔体积光（2026-09-21）：形态退化（球形弥散团 → 向下聚光锥）不报错、不崩，
                     只有读几何类型才拦得住；setLampVol 是阳性对照用的"只改 uLamp"后门。 */
                  lampVolState, setLampVol,
                  /* 氛围粒子：门禁断言"夏夜晴有萤火 / 暴雨有镜前雨" */
                  fireflyOpacity: () => fireflies.material.uniforms.uOpacity.value,
                  lensLevel: () => lensWeather.level(),
                  clickRippleLast: () => lastClickRipple,
                  /* 投喂（计划书 Phase 3 第 6 项）：门禁要断言"饵落水 / 鱼转向 / 不游上岸 /
                     散后归队"。**必须显式暴露** —— 靠 traverse 猜对象会漏（灯笼那次踩过）。 */
                  dropBait, baitsActive, BAITS,
                  /* 锦鲤跃水节奏（2026-09-26）：门禁要断言"破水事件频率落在水位内"，
                     并做**负例自检**（把 spread 改回旧的 18 ⇒ 频率必须飙红）。
                     **必须显式暴露权威开关**（铁律 3）—— 探针里改 f.userData.riseAt 会被
                     下一帧 11-loop 的自增覆盖，冻不住。 */
                  setKoiBreachConfig, koiBreachConfig,
                  /* 泳龟尾迹间隔（D2）：与锦鲤同套路，权威开关供门禁做负例自检。 */
                  setTurtleWake, turtleWakeConfig,
                  /* ── 资产预载（2026-09-27 · 高精资产批次）────────────────────────
                     探针要断言的是**"进度不撒谎"**：相邻两次更新间隔 ≥ coalesceMs、
                     只在整数百分比变化时更新、进度单调不减。必须在**页内**读，
                     所以把聚合状态与两个权威开关（配置 + 强制重置）一并暴露。
                     ⚠️ preloadReset 是权威开关而不是"再调一次产品函数"——
                        13-preload 的 items 是模块级 Map，在页内调 settle/report
                        只会被后续真实事件覆盖（项目老教训：探针自己骗自己）。 */
                  preloadState: () => ({
                    ...preloadAggregate(), degraded: degradedList(),
                    notice: slowNotice(), manifest: PRELOAD_MANIFEST,
                    totalBytes: PRELOAD_TOTAL_BYTES, offlineUrl: OFFLINE_URL,
                  }),
                  setPreloadConfig, preloadConfig,
                  /* 上元灯会（计划书 Phase 3 第 7 项）：门禁要断言"河灯/灯串的实例数与落点、
                     真光源没被加多、避开桥/汀步/立峰"—— 显式暴露，不靠 traverse 猜。
                     tickFestival 暴露是为了门禁做**负例自检**（冻结 t ⇒ 河灯不动 ⇒ 漂移判据必须报红）。 */
                  toggleFestival, festivalState, tickFestival, setFestivalFreeze,
                  /* 四季自动演示：专项门禁用加速参数跑完整顺序，用户默认仍为 7s 飞行 + 3.5s 停留。 */
                  startSeasonDemo, stopSeasonDemo, toggleSeasonDemo, seasonDemoState, seasonDemoCaption,
                  /* 高度雾总闸（2026-09-26）：uEnabled 是 pass 自己的 uniform、**刻意没进**
                     HFOG 共享表（它是"要不要开这层"、不是雾的形状参数）。不显式暴露的话，
                     门禁与诊断只能伸手去抠 heightFogPass 内部 —— 而抠 pass 正是本项目反对的
                     做法：探针里重调会被下一帧的参数覆盖。 */
                  setHFogEnabled };

/* ══ 首次引导（P2-7）══
   三步：转视角 → 换天时 → 巡游/留影。只在**第一次**进来时出现（localStorage 记账）。
   两条硬约束（都是被门禁逼出来的，别改）：
   ① **非模态**：容器 pointer-events:none，只有气泡自己接管点击 —— 否则挡住画布或
      挡住 #env 的按钮，pageerror-guard / smoke 的真实点击会直接超时。
   ② **首次交互即消失**：任何 pointerdown / wheel / keydown（落在 #guide 之外的）都收起。
      用户已经会用了就别再教，顺带保证引导层**不可能**卡在探针的点击路径上。
   ⚠️ 气泡的按钮刻意**不放进 #env**：smoke 的「aria-pressed 齐全 / 命中区 ≥38px」
      只查 `#env button`，放进去会立刻红。 */
const GUIDE_STEPS = [
  { sel:null,                   title:'壹 · 转一转',   text:'按住画布拖动，绕着园子转；滚轮推近拉远。' },
  { sel:'#env .drawer-toggle',  title:'贰 · 换天时',   text:'这里展开四根轴：时段 / 季节 / 天气 / 时辰 —— 随便换，园子跟着变。' },
  { sel:'button[data-act="tour"]', title:'叁 · 有人带', text:'「巡游」自动带你逛一圈并讲解；「明信片」把这一刻存成一张画。' },
];
const GUIDE_KEY = 'garden.guided.v1';
/* ?guide=1 强制弹出：给门禁（以及想预览引导的人）一条绕过"自动化下不自动弹"的路。
   没有它，guide-guard 就只能测 `guideStart()`，测不到真实用户会走的那条自动弹路径。 */
const GUIDE_FORCE = (() => { try { return /[?&]guide=1/.test(location.search); } catch { return false; } })();
const GUIDE = { on:false, i:0 };
function guideEl(){ return document.getElementById('guide'); }
function guideRender(){
  const el = guideEl(); if (!el) return;
  const step = GUIDE_STEPS[GUIDE.i]; if (!step) return;
  const ring = el.querySelector('.g-ring'), bub = el.querySelector('.g-bubble');
  /* 目标在抽屉里（如「巡游」）就先把抽屉展开 —— 收起状态量不到矩形，光环会画在 0,0。 */
  if (step.sel && step.sel.indexOf('data-act') >= 0){
    const env = document.getElementById('env');
    if (env && !env.classList.contains('expanded')) env.classList.add('expanded');
  }
  let r = null;
  if (step.sel){
    const t = document.querySelector(step.sel);
    if (t){ const b = t.getBoundingClientRect(); r = { left:b.left, top:b.top, width:b.width, height:b.height }; }
  }
  /* 量不到（元素隐藏 / 窄屏折叠）就退化成画布中心的圆，别画出一个 0×0 的光环 */
  if (r && r.width < 4) r = null;
  if (!r){ const w = 160; r = { left:innerWidth/2 - w/2, top:innerHeight/2 - w/2, width:w, height:w }; }
  const pad = 10;
  ring.style.left   = (r.left - pad) + 'px';
  ring.style.top    = (r.top  - pad) + 'px';
  ring.style.width  = (r.width  + pad * 2) + 'px';
  ring.style.height = (r.height + pad * 2) + 'px';
  /* 气泡放在**环的反侧**：三个目标的环都在屏幕下半部（或正中），气泡就一律去顶部，
     绝不压住左下角的 #env 锚点 —— 那正是探针第一个要点的元素。 */
  const upper = (r.top + r.height / 2) < innerHeight * 0.42;
  bub.style.top    = upper ? 'auto' : '16px';
  bub.style.bottom = upper ? '16px' : 'auto';
  bub.querySelector('b').textContent = step.title;
  bub.querySelector('span').textContent = step.text;
  const next = bub.querySelector('button[data-g="next"]');
  next.textContent = GUIDE.i === GUIDE_STEPS.length - 1 ? '知道了' : '下一步';
  const dots = bub.querySelector('.g-dots');
  dots.innerHTML = '';
  for (let k = 0; k < GUIDE_STEPS.length; k++){
    const i = document.createElement('i');
    if (k === GUIDE.i) i.className = 'on';
    dots.appendChild(i);
  }
}
function guideStart(){
  const el = guideEl(); if (!el) return false;
  GUIDE.on = true; GUIDE.i = 0;
  el.classList.add('on');
  guideRender();
  return true;
}
function guideNext(){
  GUIDE.i++;
  if (GUIDE.i >= GUIDE_STEPS.length){ guideStop(); return false; }
  guideRender();
  return true;
}
function guideStop(){
  const el = guideEl(); if (!el) return false;
  GUIDE.on = false;
  el.classList.remove('on');
  try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* 隐私模式下写不了，静默 */ }
  return false;
}
function guideMaybeAuto(){
  /* ⚠️ 被自动化驱动时**不自动弹**（与 QOS 免疫同一条判据：`navigator.webdriver`）。
     这不是为了迁就测试 —— 气泡是固定压在画面上的一块深色面板，mist-guard /
     lamp-guard / reel-guard 这些**量像素**的门禁会把它当成画面的一部分采进去
     （实测：mist-guard 的 x=590 那一列正好落在气泡里，山−天从 −6.86 变 +23.27，假红）。
     引导本身仍可用：`guideStart()` / 三步翻页 / 收起全部照常，guide-guard 就走这条路。
     ⚠️ `?guide=1` 是唯一例外：门禁靠它验"真·自动弹"那条路径（见 GUIDE_FORCE）。 */
  if (PROBE_DRIVEN && !GUIDE_FORCE) return false;
  let done = false;
  try { done = localStorage.getItem(GUIDE_KEY) === '1'; } catch { /* 读不了就当没看过 */ }
  if (!done) guideStart();
  return GUIDE.on;
}
(function bindGuide(){
  const el = guideEl(); if (!el) return;
  const bub = el.querySelector('.g-bubble');
  bub.addEventListener('click', (e)=>{
    const b = e.target.closest('button[data-g]');
    if (!b) return;
    if (b.dataset.g === 'skip') guideStop(); else guideNext();
  });
  /* 首次交互即消失。⚠️ 落在气泡上的交互不算 —— 否则点「下一步」会自己把自己关掉 */
  const dismiss = (e)=>{ if (GUIDE.on && !(e.target && e.target.closest && e.target.closest('#guide'))) guideStop(); };
  addEventListener('pointerdown', dismiss, true);
  addEventListener('wheel', dismiss, { passive:true, capture:true });
  addEventListener('keydown', dismiss, true);
  addEventListener('resize', ()=>{ if (GUIDE.on) guideRender(); });
})();

/* ── PWA 离线注册（P1-3）──
   只在 http(s) 下注册（file:// 无 SW）；注册失败静默（离线能力是加分项，不是门禁）。 */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}