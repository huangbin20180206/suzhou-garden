// main: 页面唯一的模块入口（2026-10-31 · 由 index.html 内联 <script type="module"> 逐行迁出）
/* ⚠️ 搬运纪律：本文件正文与原内联主模块**逐行一致**，只改了 import 路径（'./src/X' → './X'、
   './vendor.js' → '../vendor.js'）。import 语句的**顺序一条没动** —— ESM 按 import 出现顺序
   深度优先求值，这份顺序就是全站模块的求值顺序（TDZ / 环的前科见 00-config.js 的 HOOKS、ENV_REF 注释）。
   ⚠️ import 在求值期被提升：下面散在正文里的 import（2b-wind … 11-loop）同样先于本文件任何语句求值，
   所以抽屉接线 / bootFail / 两级启动看门狗都在全部模块求值完之后才执行 —— 与内联时完全相同。
   ⚠️ 这里的具名导入大多"本文件不直接用"：原本就是为钉住求值顺序 + 让 ESM 链接期校验导出名而列，
   eslint 的 no-unused-vars 对本文件豁免（见 eslint.config.mjs）。 */
// three 与全部 addons 已用 esbuild 打包进同目录的 vendor.js（见 build-entry.js），
// 页面不依赖任何外部 CDN —— 大陆网络下 unpkg / jsDelivr 常不稳定
import { THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass, GLTFLoader, Reflector, mergeGeometries, GTAOPass, DRACOLoader, KTX2Loader, MeshoptDecoder } from '../vendor.js';
import { CFG, rnd, rr, pick, mulberry32, TAU, DEG, registry } from './00-config.js';
import { rockNormalTex, pavingTex, pavingNormalTex, groundTex, waterNormalTex, makePondBedTex, makePlaqueTex, makeSteleTex, makeInkWashTex, WATER_REFLECT_SHADER, waterSurface, setWaterSurface, auxPass, setAuxPass, BOOT, bootMark, SEASON_TINT_REGISTRY, registerSeasonTint, MAT, DISTANT_MATS, SNOW_COVER_MATS, WET_MATS, registerWeatherRoles, wetUniform, WIND, willowOrigins, addWind } from './01-materials.js';

// ═════════════════════════════════════════════════════════════
// 中式古典江南风格 · 抽屉式 UI 交互
// ☆ 默认**收起**：只有点左下角那枚方印才展开（触屏没有"悬停"，手机/平板只认点击，
//    点面板之外也收起）；桌面鼠标移开面板 300ms 后自动收起（见下面的 canHover 分支）。
// ⚠️ 旧注释写的"鼠标悬停即展开"**从来没有实现过**（mouseenter 只清收起计时器），
//    别再照着它去加悬停展开 —— 触屏上那会变成"点一下就自己弹出来"的观感问题。
// ═════════════════════════════════════════════════════════════
(function initDrawerUI() {
  const envEl = document.getElementById('env');
  const toggleEl = envEl ? envEl.querySelector('.drawer-toggle') : null;
  if (!envEl || !toggleEl) return;

  const setOpen = (on) => {
    envEl.classList.toggle('expanded', on);
    toggleEl.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  const isOpen = () => envEl.classList.contains('expanded');

  /* 点方印开关本身：切换开合。
     stopPropagation 防止这次点击被下面的"点面板外收起"当成外部点击而立刻关掉。 */
  toggleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!isOpen());
  });

  /* ── 自动收起 ──
     旧版的 autoCollapse() 定义了却**从未被调用**（只挂了 mouseenter 清计时器，没挂 mouseleave），
     所以点开之后只能再点一次才关，跟"自动抽屉"的承诺不符。这里补齐两条路径：
       · 桌面（有 hover）：鼠标离开面板 300ms 后收起（留一点时间从容移到相邻按钮）；
       · 触屏（无 hover）：点面板之外 / 按 Esc 收起 —— 触屏没有"移开"这个动作，
         装 mouseleave 只会让刚点开的抽屉被合成事件误关。
     判断用 matchMedia，而不是 UA 嗅探。 */
  let hideTimer = 0;
  const canHover = matchMedia('(hover:hover)').matches;
  /* ⚠️ 拖动滑块时鼠标一定会移出面板边缘 —— 若不设防，"鼠标移开 300ms 收起"会在
     拖动中途把面板收掉（时辰滑杆就在面板里，这条必踩）。按下期间一律不自动收起。 */
  let pressing = false;
  envEl.addEventListener('pointerdown', () => { pressing = true; });
  addEventListener('pointerup', () => {
    pressing = false;
    /* 松手时若指针已经不在面板上（拖到外面才松的），补一次收起判定 */
    if (canHover && isOpen() && !envEl.matches(':hover')){
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setOpen(false), 300);
    }
  });

  if (canHover){
    envEl.addEventListener('mouseenter', () => { clearTimeout(hideTimer); });
    envEl.addEventListener('mouseleave', () => {
      if (pressing) return;                 // 正在拖滑块/按住按钮：别收
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setOpen(false), 300);
    });
  }
  /* 点面板之外：一律收起（pointerdown 比 click 更早，且能覆盖触屏） */
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !envEl.contains(e.target)) setOpen(false);
  });
  /* 键盘：Esc 收起（无障碍 + 快速退出） */
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  setOpen(false);
})();


/* ── 启动失败态 ──
   审计 B14：加载层原来是"第 2 帧就无条件撤掉"，GLB 失败只 console.warn ——
   WebGL 不可用 / vendor.js 没加载成功 / 脚本异常时，用户看到的是**永远的"营造中"**
   或者一个半成品场景，没有任何可读信息，也没有重试入口。这里在模块最前面挂兜底。 */
function bootFail(msg){
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.remove('done');
  el.style.display = '';
  el.style.opacity = '1';
  el.innerHTML =
    '<div style="font:500 15px/1.7 system-ui, sans-serif;color:#f2efe6;'
    + 'background:rgba(18,22,28,.86);padding:18px 22px;border-radius:10px;'
    + 'max-width:min(600px,84vw);text-align:left">'
    + '<div style="font-size:17px;font-weight:600;margin-bottom:8px">场景没能启动</div>'
    + '<div style="opacity:.82;margin-bottom:10px">' + String(msg).slice(0, 300) + '</div>'
    + '<div style="opacity:.62;margin-bottom:14px">常见原因：WebGL 不可用 · vendor.js 没加载成功 · '
    + '用 file:// 直接打开（会被 CORS 拦）· 着色器编译失败</div>'
    + '<button id="boot-retry" style="font:inherit;padding:6px 14px;border-radius:6px;'
    + 'border:1px solid rgba(240,236,226,.5);background:rgba(240,236,226,.14);color:#f2efe6;cursor:pointer">重试</button>'
    + '</div>';
  const b = document.getElementById('boot-retry');
  if (b) b.addEventListener('click', () => location.reload());
}
addEventListener('error', (e) => { if (!window.__garden) bootFail(e.message || '脚本错误'); });
addEventListener('unhandledrejection', (e) => {
  if (!window.__garden) bootFail((e.reason && e.reason.message) || '未处理的 Promise 拒绝');
});
setTimeout(() => { if (!window.__garden) bootFail('初始化超时（15 秒仍未就绪）'); }, 15000);

/* ── 启动看门狗 · 第二级（2026-10-30 第 0 周热修）──
   上面那个 15 秒兜底只护得住"主模块求值完成之前"：window.__garden 在 import 全部
   落地时就赋上了（11-loop 末尾），之后第一级就**解除武装** —— 而启动真正的大头
   （预载等待 preloadPhase / 暖机 10 桶 / 首帧 / 延迟装配 runDeferredBoot）全在那之后。
   任何一环挂死（实测案例：bootDonePromise 永不兑现，延迟装配没收尾），用户依旧
   盯着"营造中"看到天荒地老，第一级兜底却认为一切正常。
   这里补一只**拴在 bootDonePromise 上**的 120 秒看门狗：
     · 已开园（loading 层已收）就不弹卡 —— 延迟装配慢半拍不碍着用户看园子，
       只往控制台报一声（探测用）；
     · 120 秒还停在加载页才判"挂死"而不是"慢"：慢网有进度条播报和"先看基础版"
       快捷入口两条出路，轮不到看门狗接手。 */
{
  const __bootWd = setTimeout(() => {
    if (document.getElementById('loading')?.classList.contains('done')){
      console.error('[启动看门狗] 已开园但 bootDone 120s 未兑现（延迟装配没收尾），仅记录不弹卡');
      return;
    }
    bootFail('启动超时（120 秒仍未开园，装配阶段未完成）。'
           + '点下方"重试"重新加载；若反复失败，请按 F12 打开控制台，把红色报错发给开发者。');
  }, 120000);
  bootDonePromise.then(() => clearTimeout(__bootWd), () => { /* promise 不 reject，兜一手 */ });
}

import { windClock, DIR_N, DIR_STEP, WIND_DIR, updateWindDir, FORCE_TIERS, WIND_FORCE, forceBand, windGain, updateWindForce, gust, updateWind } from './2b-wind.js';

import { app, renderer, GPU_NAME, SOFTWARE_GL, PROBE_DRIVEN, QOS_IMMUNE, GPU_TIER, SUPERSAMPLE, RENDER_SCALE, scene, world, camera, controls, CAM_MIN_DIST, CAM_HOME, resetCamera, skyMesh, lumOf, ENV_BAKE_LUM } from './02-scene.js';
import { mesh, box, makeColumn, instancedBoxes, instancedGeo, makeCorrugatedSlab, DOUGONG_H, makeDougongGeo, makeChineseRoof, makeCeiling, makeQueTu, makeGuaLuo, makeJiangnanWindow, makeChangChuang, makeLatticePanel, makeWallRun, makeWallCap } from './03-factory.js';
import { makeYuanxiangHall, makeWaterPavilion, makeCorridor } from './04-buildings.js';
import { POND_PTS, insidePond, POND_RADII, makePond, makeBankRocks, makeArchBridge, makeSteppingStones } from './05-water.js';
import { makeReedBladeGeo, makeBamboo, makeWisteria, perchingAnchors, makeAquatic, KOI_ORBITS, rippleInst, spawnRipple, updateRipples, makeKoiGroup, assetFailures, loadAssetOnce, placeAssets, MIST_WHITE, MIST, makeMistField, makeTaihuHeroGeo, makeWillow, makeBananaPlant, makeLotusPod, makeRockChain, makeRockery, makeWaterGrass } from './06-vegetation.js';
import { makeGround, makePaving, makeWalls, makeDistantHills, makeDragonfly } from './07-ground.js';
import { runDeferredBoot, bootDonePromise, FIG_HAIR, FIG_PALETTE, figures, koiGroup, dragonflies, perchingDragonflies, PERCH_LIFT, perchShowOK, updatePerchingDragonflies, GLB_LOTUS_STEM_H, swimTurtles, HERO_POS, CAM_FLY, flyTo, updateCamFly, VIEWPOINTS, gotoViewpoint, TOUR, captionEl, showCaption, hideCaption, tourStop, tourStart, updateTour, tourUserTakeover } from './08-assemble.js';

import { sun, casterBox, casterBoxDirty, refreshCasterBox, fitShadowCamera, amb, fill, hemiLight } from './09-lights.js';

import { composer, AO_ENABLED, gtaoPass, bloom, gradePass } from './10-post.js';

import { lanternGroups, hash21Lantern, weatherMutexReason, weatherTag, effectiveWeather, ENV_SEASON, mixInto, timeLabelNow, applyEnv, applyPresence, wetApplied, ENV, setEnv, weatherAllowed, envEl, REEL, toggleReel, advanceReel, PRECIP, updatePrecip, updatePostRain, updateRainRipples } from './12-env.js';

import './11-loop.js';
