// 11c-ux：交互体验批次（2026-11-24 · 第 4 批）的 DOM 接线层。
//
// 判定全部在 00c-ux（纯函数，纯 node 单测）；这里只管"什么时候调、调完怎么落到页面上"：
//   ① 音景偏好：音量 + 开关写 localStorage，下次开园恢复（开关要等第一次手势才兑现）
//   ② 省电降档：getBattery 低电量且未充电 ⇒ 复用 QOS.setMode('performance')（不落盘、不新增档位），提示一次
//   ③ 分享当前景色：留影行「链接」按钮复制带 hash 的链接；开园 / hashchange 时按 hash 恢复
//      —— 季节 / 时辰 / 天气只走 applyState（环境状态的唯一入口），机位只写 camera + controls.target
//   ④ 首访入口小红点：时辰滑杆 / 天气 / 步行 / 明信片 / 音景 + 方印，用过一次就灭、记 localStorage
//   ⑤ 轻提示 toast：上面 ②③ 共用的一行字，pointer-events:none，不挡任何输入
//
// 依赖方向：11-loop → 本模块 → 12-env / 08d-tour / 02-scene / 00c-ux（这几个都不反向 import 本模块 ⇒ 不成环）。
// Snd / QOS / WALK 住在 11-loop 的闭包里，由 11-loop 调 initUx() 注入（同 11a/11b 的做法）。
// 删掉本文件 + 11-loop 里那几行接线，页面照常跑（只是少了这几项体验），与 11b 同一声明。
import { HOOKS } from './00-config.js';
import { camera, controls, CAM_MIN_DIST, PROBE_DRIVEN, QOS_IMMUNE, GPU_TIER_FORCED } from './02-scene.js';
import { ENV, ENV_SEASON, applyState, settleEnv, envEl } from './12-env.js';
import { ENV_WEATHER } from './12a-presets.js';
import { SEASON_DOY } from './12g-phenology.js';
import { introCancel, cancelCamFly, tourStop } from './08d-tour.js';
import {
  SOUND_PREF_KEY, parseSoundPrefs, serializeSoundPrefs, batteryShouldDowngrade,
  SEEN_KEY, parseSeen, serializeSeen, encodeView, decodeView,
} from './00c-ux.js';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };   // 隐私模式：读不到当没有
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式：写不进静默 */ } };

/* ── ⑤ 轻提示 ── 顶部居中一行字。position:fixed + 运行期创建 ⇒ 不进任何既有面板、不改布局门的量。 */
let _toastEl = null, _toastTimer = 0;
export function toast(msg, ms = 3200){
  if (!_toastEl){
    _toastEl = document.createElement('div');
    _toastEl.id = 'ux-toast';
    _toastEl.setAttribute('role', 'status');
    _toastEl.setAttribute('aria-live', 'polite');
    _toastEl.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);max-width:min(520px,86vw);' +
      'padding:8px 16px;background:#fffbeee8;color:#302c25;border-radius:6px;z-index:14;pointer-events:none;' +
      'font:13px/1.6 serif;box-shadow:0 4px 14px rgba(0,0,0,.25);transition:opacity .3s;opacity:0';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { if (_toastEl) _toastEl.style.opacity = '0'; }, ms);
}

/* ── ① 音景偏好 ── */
function bindSoundPrefs(Snd){
  const stored = lsGet(SOUND_PREF_KEY);
  const p = parseSoundPrefs(stored);
  const el = document.getElementById('sndVol');
  const save = () => lsSet(SOUND_PREF_KEY, serializeSoundPrefs({ vol: Snd.volume, on: Snd.on }));
  /* 有存档才动滑杆：没存过就一位不碰（sound-guard 等门禁的初值口径不变）。
     派发 input 事件 ⇒ 11-loop 的 setVolume 与 12-env 的"已过段填充"两个既有监听一起跟上，不另写一套。 */
  if (stored !== null && el){
    el.value = String(Math.round(p.vol * 100));
    el.dispatchEvent(new Event('input'));
  }
  if (el) el.addEventListener('change', save);
  /* 记得"开着"：AudioContext 必须由用户手势 resume ⇒ 只能等第一次手势再兑现。
     手机上 pointerdown 不算激活手势（Chrome / Safari 都只认 pointerup / touchend / keydown），所以挂 pointerup。
     ⚠️ 第一次手势恰好就是点「音景」按钮 / 按 M ⇒ 让用户自己的那一下说了算（否则这里开、按钮又关）。 */
  if (p.on){
    const arm = (e) => {
      const onSoundBtn = e.target && e.target.closest && e.target.closest('[data-act="sound"]');
      const isM = e.type === 'keydown' && (e.key === 'm' || e.key === 'M');
      removeEventListener('pointerup', arm, true);
      removeEventListener('keydown', arm, true);
      if (onSoundBtn || isM || Snd.on) return;
      HOOKS.sound?.();
      const b = envEl && envEl.querySelector('button[data-act="sound"]');
      if (b){ b.classList.toggle('on', !!Snd.on); b.setAttribute('aria-pressed', Snd.on ? 'true' : 'false'); }
    };
    addEventListener('pointerup', arm, true);
    addEventListener('keydown', arm, true);
  }
  return save;
}

/* ── ② 省电降档 ──
   · 只在"自动"画质下动手：用户自己锁了档（高/均衡/省电）就尊重他的选择。
   · setMode(…, {persist:false})：低电量是一时的，不能把"省电"写进 garden.quality.v1 让下次开园也卡在低档。
   · 插上电源 ⇒ 若用户没再手动改过（存档仍是 auto），回到自动。
   · 门禁（webdriver）/ ?tier= 强制档 / 软件渲染（QOS 免疫）一律不碰。 */
function watchBattery(QOS){
  if (PROBE_DRIVEN || QOS_IMMUNE || GPU_TIER_FORCED) return;
  let nav = null;
  try { nav = navigator; } catch { return; }
  if (!nav || typeof nav.getBattery !== 'function') return;
  nav.getBattery().then((b) => {
    let downgraded = false, told = false;
    const check = () => {
      const low = batteryShouldDowngrade({ level: b.level, charging: b.charging });
      const mode = QOS.state().mode;
      if (low && !downgraded && mode === 'auto'){
        QOS.setMode('performance', { persist:false });
        downgraded = true;
        if (!told){ told = true; toast('电量不足 20%，已自动切到省电画质；接上电源后恢复。'); }
      } else if (downgraded && b.charging === true){
        downgraded = false;
        if (QOS.state().mode === 'performance' && (lsGet('garden.quality.v1') || 'auto') === 'auto'){
          QOS.setMode('auto', { persist:false });
        }
      }
    };
    check();
    b.addEventListener('levelchange', check);
    b.addEventListener('chargingchange', check);
  }).catch(() => { /* 权限策略禁用 / 不支持：静默 */ });
}

/* ── ③ 分享当前景色 ── */
const VIEW_OPTS = { seasons: Object.keys(ENV_SEASON), weathers: Object.keys(ENV_WEATHER) };
export function currentViewHash(walkActive){
  /* 步行态没有 orbit target：取视线前方 2m 当目标（≥ CAM_MIN_DIST 1.6，打开后 OrbitControls 不会把它推远） */
  let tgt;
  if (walkActive){
    const dir = camera.getWorldDirection(camera.position.clone());   // 临时 Vector3（不 new Object3D ⇒ 不吃随机流）
    tgt = [camera.position.x + dir.x * 2, camera.position.y + dir.y * 2, camera.position.z + dir.z * 2];
  } else tgt = controls.target.toArray();
  return encodeView({
    season: ENV.season, hour: ENV.hour, weather: ENV.weather,
    doy: ENV.doy !== SEASON_DOY[ENV.season] ? ENV.doy : undefined,
    cam: camera.position.toArray(), tgt,
  });
}
export function shareUrl(walkActive){
  /* 查询串整段丢掉：?debug=1 / ?tier=low / ?intro=0 这些是分享人自己的调试开关，不该塞给收链接的人。 */
  let base = '';
  try { base = location.href.split(/[?#]/)[0]; } catch { base = ''; }
  return base + '#' + currentViewHash(walkActive);
}
export function copyShareLink(walkActive){
  const url = shareUrl(walkActive);
  const fallback = () => {
    try { window.prompt('复制这条链接，打开即是同一幅景：', url); } catch { /* 无 prompt 的环境 */ }
  };
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
      navigator.clipboard.writeText(url).then(() => toast('已复制当前景色链接'), fallback);
    } else fallback();
  } catch { fallback(); }
  return url;
}
/* 按 hash 恢复。返回是否用上了任何一项（调用方据此决定还放不放开场运镜）。
   ⚠️ 环境三轴只走 applyState（唯一入口：校验、收灯会烟花、PMREM、阴影、UI 同步都在那边），
      再 settleEnv 立刻落位 —— 打开链接要的是"那一幅画"，不是 2.8s 的过渡。
   ⚠️ 任何一步抛错都吞掉：分享参数坏了也绝不能挡开园。 */
export function applySharedView(hash){
  let v = null;
  try { v = decodeView(hash, VIEW_OPTS); } catch { v = null; }
  if (!v) return false;
  try {
    const next = {};
    if (v.season) next.season = v.season;
    if (v.doy != null) next.doy = v.doy;
    if (v.hour != null) next.hour = v.hour;
    if (v.weather) next.weather = v.weather;
    if (Object.keys(next).length){ applyState(next, { via:'ui' }); settleEnv(); }
    if (v.cam){
      HOOKS.walkExit?.();
      introCancel(); tourStop(); cancelCamFly();
      camera.position.fromArray(v.cam);
      controls.target.fromArray(v.tgt);
      /* 近观机位（如 1.2m 的匾联）要放开 OrbitControls 下限，否则 update() 会把相机推回 1.6m ——
         与 VIEWPOINTS 的 minDist 同一做法；按 0 复位时 resetCamera 会收回 CAM_MIN_DIST。 */
      const d = camera.position.distanceTo(controls.target);
      controls.minDistance = Math.min(CAM_MIN_DIST, Math.max(0.2, d * 0.95));
      controls.update();
    }
    return true;
  } catch (e){
    console.warn('[分享] 链接参数未能恢复，按默认开园：', e && e.message);
    return false;
  }
}

/* ── ④ 首访入口小红点 ──
   引导（11-loop GUIDE_STEPS）只讲了转视角 / 换天时 / 巡游明信片，时辰滑杆、天气、步行、音景都没点到。
   不加新弹窗：给这几个入口各点一个 7px 小红点（::after 绝对定位 ⇒ 不改任何元素的尺寸与位置，
   布局门 / 1440 导览行宽量不到它），用过一次就灭，记 localStorage。方印上也点一个（面板默认收起，
   不点它新用户看不到里面的点），展开过一次就灭。
   门禁（webdriver）不点：像素门会把红点采进画面（与引导"探针下不自动弹"同一条理由）。 */
const FRESH_CSS = '#env .ux-new{position:relative}' +
  '#env .ux-new::after{content:"";position:absolute;top:-3px;right:-3px;width:7px;height:7px;' +
  'border-radius:50%;background:#C8102E;box-shadow:0 0 0 1.5px #fffbee;pointer-events:none}';
function initFreshDots(){
  if (PROBE_DRIVEN || !envEl) return;
  const seen = parseSeen(lsGet(SEEN_KEY));
  const targets = {
    drawer: () => envEl.querySelector('.drawer-toggle'),
    hour:   () => document.getElementById('hourSlider')?.closest('.row')?.querySelector('.lbl'),
    weather:() => envEl.querySelector('button[data-axis="weather"]')?.closest('.row')?.querySelector('.lbl'),
    walk:   () => envEl.querySelector('button[data-act="walk"]'),
    shot:   () => envEl.querySelector('button[data-act="shot"]'),
    sound:  () => envEl.querySelector('button[data-act="sound"]'),
  };
  const todo = Object.keys(targets).filter(k => !seen.has(k));
  if (!todo.length) return;
  const st = document.createElement('style');
  st.id = 'ux-fresh-css';
  st.textContent = FRESH_CSS;
  document.head.appendChild(st);
  for (const k of todo) targets[k]()?.classList.add('ux-new');
  const mark = (k) => {
    if (seen.has(k)) return;
    seen.add(k);
    targets[k]()?.classList.remove('ux-new');
    lsSet(SEEN_KEY, serializeSeen(seen));
  };
  /* 捕获阶段、只读不拦：标记"用过"不能改变任何既有点击语义 */
  envEl.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('drawer-toggle')) mark('drawer');
    else if (b.dataset.axis === 'weather') mark('weather');
    else if (b.dataset.act === 'walk' || b.dataset.act === 'shot' || b.dataset.act === 'sound') mark(b.dataset.act);
  }, true);
  document.getElementById('hourSlider')?.addEventListener('input', () => mark('hour'));
}

/* ── 总装：11-loop 在 Snd / QOS / WALK 建好之后调一次 ── */
export function initUx({ Snd, QOS }){
  const saveSound = bindSoundPrefs(Snd);
  watchBattery(QOS);
  initFreshDots();
  addEventListener('hashchange', () => { if (applySharedView(location.hash)) toast('已按链接换到分享的景色'); });
  return { saveSound };
}
