// 00c-ux：交互体验批次（2026-11-24 · 第 4 批）的**纯函数内核** + 动效偏好单例 MOTION。
//
// ── 为什么单独成一个零依赖模块 ─────────────────────────────────────────────
//   本批要改的判定（摇杆死区 / 驻足卡冷却与手势 / 省电降档判据 / 减弱动效 / 音量持久化 /
//   分享链接编解码）散落在 11a-walk、11b-vista、08d-tour、12b-sky、11-loop 五处。
//   那几个模块都 import 了 vendor.js 或 DOM（node 下一 import 就炸，见 unit-pure.mjs 头注释），
//   判定逻辑要能在纯 node 里单测，只能抽到一个**不 import 任何东西**的模块里。
//   ⇒ 本文件：没有 import、模块期不碰 DOM（MOTION 的探测全部 typeof 兜底），
//     node 直接 import 即可测（probe/ux-pure-unit.mjs）。
//   ⇒ 低层模块（08d / 12b / 11a）import 本模块不会新增环：它没有任何出边。
//
// ⚠️ 铁律 1（全局随机流守恒，见 layout-fingerprint.mjs 头注释）：本文件不调 Math.random、
//    不 new 任何 Three 对象 —— 模块期只做几次字符串 / matchMedia 读取。

/* ══ 1. 减弱动效（prefers-reduced-motion）════════════════════════════════════
   口径：系统设置「减弱动态效果」⇒ 关镜头晃动（步行头部起伏 / 横滚，1a38d48 那批）、
   压闪电闪屏、自动运镜改成直切。`?motion=1` 强制**开**动效（给想看完整效果的人和门禁），
   `?motion=0` 强制**关**（不改系统设置也能预览减弱效果）。
   ⚠️ 只认 `motion=0|1` 两个值，其它值等于没写 —— 与 `?intro=` / `?guide=` 同一惯例。 */
export function parseMotionParam(search){
  const m = /[?&]motion=([01])(?:&|#|$)/.exec(String(search || ''));
  return m ? m[1] === '1' : null;          // true = 强制开；false = 强制减弱；null = 跟系统
}
export function resolveReducedMotion(param, mqReduce){
  if (param === true) return false;
  if (param === false) return true;
  return !!mqReduce;
}
/* 单例：各模块在**运行期**读 MOTION.reduced（不要在模块期拷成常量 —— 系统设置可以中途切，
   下面的 change 监听会改写它）。 */
export const MOTION = (() => {
  const st = { reduced:false, source:'default' };
  let param = null;
  try { param = parseMotionParam(typeof location !== 'undefined' ? location.search : ''); } catch { /* 无 location */ }
  let mq = null;
  try { mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null; } catch { mq = null; }
  st.reduced = resolveReducedMotion(param, mq && mq.matches);
  st.source = param !== null ? 'url' : (mq ? 'media' : 'default');
  if (mq && param === null){
    try { mq.addEventListener('change', (e) => { st.reduced = !!e.matches; }); } catch { /* 老浏览器没有 addEventListener */ }
  }
  return st;
})();
/* 自动运镜（巡游 / 四季演示）在减弱动效下**直切**：前庭敏感的人最难受的是"非自己发起的、
   持续一两秒的大位移"。直切是 WCAG 2.3.3 推荐的做法；用户自己点机位（manual）仍然飞 ——
   那是他自己发起的动作，飞行本身在告诉他"镜头去了哪"。 */
export const REDUCED_FLY_DUR = 0.05;
const AUTO_FLY_OWNERS = new Set(['tour', 'season-demo']);
export function autoFlyDur(dur, owner, reduced){
  if (reduced && AUTO_FLY_OWNERS.has(owner)) return REDUCED_FLY_DUR;
  return dur;
}
/* 闪电照亮全场的倍率：减弱动效下只留 25%（闪电本身的电光仍画，整屏泛白压下去 ——
   整屏高频明暗跳变是光敏 / 前庭不适的主要来源）。 */
export const LIGHTNING_REDUCED_GAIN = 0.25;
export function lightningFlashGain(reduced){ return reduced ? LIGHTNING_REDUCED_GAIN : 1; }

/* ══ 2. 省电降档判据 ═══════════════════════════════════════════════════════
   电量 < 20% 且**未充电**才降。level 非数 / 越界一律当"不知道"⇒ 不降（宁可不动也别误降）。 */
export const BATTERY_LOW = 0.2;
export function batteryShouldDowngrade(b, threshold = BATTERY_LOW){
  if (!b || typeof b !== 'object') return false;
  const lv = b.level;
  if (typeof lv !== 'number' || !Number.isFinite(lv) || lv < 0 || lv > 1) return false;
  return b.charging === false && lv < threshold;
}

/* ══ 3. 音景偏好（音量 + 开关）持久化 ═════════════════════════════════════
   存 localStorage 'garden.sound.v1' = '{"v":0..100,"on":bool}'。坏值 / 旧格式 ⇒ 默认（满音量、关）。
   ⚠️ "开"只能在用户第一次手势时兑现（浏览器自动播放策略：AudioContext 要手势才 resume），
      所以这里只负责"记得"，兑现时机由 11-loop 的接线决定。 */
export const SOUND_PREF_KEY = 'garden.sound.v1';
export function parseSoundPrefs(str){
  const def = { vol:1, on:false };
  if (typeof str !== 'string' || !str) return def;
  let o;
  try { o = JSON.parse(str); } catch { return def; }
  if (!o || typeof o !== 'object') return def;
  const v = Number(o.v);
  return {
    vol: Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) / 100 : 1,
    on: o.on === true,
  };
}
export function serializeSoundPrefs(p){
  const v = Math.max(0, Math.min(1, Number(p && p.vol)));
  return JSON.stringify({ v: Math.round((Number.isFinite(v) ? v : 1) * 100), on: !!(p && p.on) });
}

/* ══ 4. 入口可发现性：首访"小红点"的已看过记账 ════════════════════════════
   键集合固定（未知键丢弃，防 localStorage 被写脏后无限长）。 */
export const SEEN_KEY = 'garden.seen.v1';
export const SEEN_ENTRIES = ['drawer', 'hour', 'weather', 'walk', 'shot', 'sound'];
export function parseSeen(str){
  const s = new Set();
  if (typeof str !== 'string' || !str) return s;
  let a;
  try { a = JSON.parse(str); } catch { return s; }
  if (Array.isArray(a)) for (const k of a) if (SEEN_ENTRIES.includes(k)) s.add(k);
  return s;
}
export function serializeSeen(set){ return JSON.stringify(SEEN_ENTRIES.filter(k => set.has(k))); }

/* ══ 5. 驻足卡：冷却 + 手机关闭手势 ═══════════════════════════════════════
   关掉（✕ / Esc / 下滑 / 点卡外）的那一条，VISTA_COOLDOWN_MS 内即使重开步行也不再弹：
   用户刚明确说了"不要"，2 分钟内同一句话再塞给他就是骚扰。
   走开自动收的不算"关掉"⇒ 不进冷却（那条由"每轮步行只弹一次"管）。 */
export const VISTA_COOLDOWN_MS = 120000;
export function vistaMayShow(name, { visited, idx, cooldown, now }){
  if (visited && visited.has(idx)) return false;
  const until = cooldown && cooldown.get(name);
  return !(Number.isFinite(until) && now < until);
}
/* 步行操作提示：首次进入才出、学会就收、记住（2026-11-26 · 场景打造批 · 交互可发现性）。
   旧：每次进步行都在底部常驻一条"WASD / 方向键行走 · 按住鼠标右键转头 · Esc 返回"，走多久挂多久、
   第十次进来也还在 —— 熟手嫌挡，新手又只在第一次需要它。
   新：
     · 'first'（本机没记过）：照旧出提示；**真走起来**（≥ steps 个移动步 ≈ 3m）且已显示 ≥ minMs 才收，
       收时记 localStorage（学会了）；一直没动则 maxMs 后也收，但**不记** —— 下次进来再教一次。
     · 'none'（记过）：不出。
     · 'sticky'（webdriver 门禁）：旧行为（常驻），像素门 / 布局门不因本批改变（它们本就会藏 #walk-help）。
   键名单独一条（不并进首访小红点 SEEN_ENTRIES：那张表的项目与面板按钮一一对应，见 11c）。 */
export const WALK_HINT_KEY = 'garden.walkhint.v1';
export const WALK_HINT = Object.freeze({ minMs: 4000, maxMs: 15000, steps: 40 });
export function walkHintMode(stored, probe){
  if (probe) return 'sticky';
  return stored === '1' ? 'none' : 'first';
}
/* 返回 null = 继续显示；'learned' = 收起并记住；'timeout' = 收起但不记 */
export function walkHintVerdict(ms, steps, cfg = WALK_HINT){
  if (ms >= cfg.minMs && steps >= cfg.steps) return 'learned';
  if (ms >= cfg.maxMs) return 'timeout';
  return null;
}
/* 触屏转头灵敏度（2026-11-26 · 场景打造批；HANDOFF-11-24 已知未做"触屏转向 0.0042 rad/px 偏慢"）。
   固定 rad/px 在窄屏上偏慢：390 宽竖屏右半屏（看区 ≈ 55% 宽 ≈ 214px）一整划只转 0.9rad（52°），想回头要连划三四下。
   按屏幕**短边**归一化（横竖屏同一手感）：gain = 0.0042 × clamp(760 / 短边, 1, 2.2)。
     · 短边 ≥760（平板、触屏笔记本、桌面）⇒ ×1，与旧值一字不变；
     · 390 宽手机 ⇒ ×1.95 = 0.0082 rad/px，半屏一划 ≈ 1.75rad（100°）；更窄的封顶 ×2.2。
   鼠标右键拖转头（0.003）不走这里。 */
export const TOUCH_LOOK_BASE = 0.0042, TOUCH_LOOK_REF = 760, TOUCH_LOOK_MAX = 2.2;
export function touchLookGain(w, h){
  const sh = Math.min(w > 0 ? w : Infinity, h > 0 ? h : Infinity);
  if (!Number.isFinite(sh)) return TOUCH_LOOK_BASE;
  return TOUCH_LOOK_BASE * Math.min(TOUCH_LOOK_MAX, Math.max(1, TOUCH_LOOK_REF / sh));
}
/* 驻足点选择（2026-11-26 · 场景打造批 · 复核②）。
   旧规则："全表最近的一条"在半径内且可弹才弹。匾联 (0,−8.9) 与远香堂 (0,−12) 只隔 3.1m、半径都是 3.5m
   ⇒ 匾联弹过（visited）后仍是"最近"，把远香堂挡到 z<−10.45（进门 1.6m）才轮得到。
   新规则：
     ① 只在"可弹"（未弹过、不在冷却）且各自半径内的点里挑，按 距离/半径 最小；同分取下标小的（确定性，
        SPOT_DEFS 的书写顺序即优先级 —— 立峰/题名石在回填前同一个 target 时也不会随浮点抖动换人）；
     ② 正在显示的卡，在 holdMs 内不被别的点替换（相邻两站不会一闪而过，给读完一句话的时间）；
        走出它自己的 半径+缓冲 由调用方照旧收卡。
   spots: [{x, z, r, name}]；返回要新弹的下标，-1 = 不动。 */
export const VISTA_HOLD_MS = 4000;
export function pickVistaSpot(spots, x, z, { visited, cooldown, now = 0, current = -1, shownAt = -Infinity, holdMs = VISTA_HOLD_MS } = {}){
  if (!spots || !spots.length) return -1;
  if (current >= 0 && now - shownAt < holdMs) return -1;
  let best = -1, bestS = Infinity;
  for (let i = 0; i < spots.length; i++){
    if (i === current) continue;
    const sp = spots[i];
    const dx = x - sp.x, dz = z - sp.z, d = Math.sqrt(dx * dx + dz * dz);
    if (!(d <= sp.r)) continue;
    if (!vistaMayShow(sp.name, { visited, idx:i, cooldown, now })) continue;
    const sc = d / sp.r;
    if (sc < bestS){ bestS = sc; best = i; }
  }
  return best;
}
/* 手势分类（只对触屏调用）：down/up = {x,y,t}，down.onCard = 按下点是否落在卡片矩形内。
   · 下滑：起点在卡上、竖直位移 ≥ 40px 且以竖直为主 ⇒ 'swipe'
   · 点卡外：起点不在卡上、位移 ≤ 10px、时长 ≤ 350ms ⇒ 'tap'
   拖动（摇杆走 / 右半屏转头）既不是轻点也不从卡上起 ⇒ null，走路中途不会误关。 */
export function classifyCardGesture(down, up){
  if (!down || !up) return null;
  const dx = up.x - down.x, dy = up.y - down.y, dt = up.t - down.t;
  if (down.onCard) return (dy >= 40 && dy > Math.abs(dx) * 1.2) ? 'swipe' : null;
  return (Math.hypot(dx, dy) <= 10 && dt <= 350) ? 'tap' : null;
}

/* ══ 6. 触屏摇杆：死区 + 加速曲线 ══════════════════════════════════════════
   旧实现的实据（11a-walk update()）：distance = dt·2.2/len、位移 = 输入·distance ⇒
   |速度| = |输入|·2.2/|输入| ≡ 2.2 m/s —— 摇杆**没有模拟量**，手指 1px 的抖动也是全速，
   且没有死区（按下时指尖一晃人就窜出去）。改成：
   · 径向死区 STICK_DEAD（半径 48px 的 18% ≈ 9px）
   · 死区外 (m−dead)/(1−dead) 再取 STICK_EXPO 次幂：小推慢走、推满全速，近处细调更稳
   · 合成（键盘 + 摇杆）后整体夹到模长 ≤ 1 ⇒ 键盘单键/斜向仍是 2.2 m/s，与旧手感一致 */
export const STICK_RADIUS = 48, STICK_DEAD = 0.18, STICK_EXPO = 1.6;
export function stickResponse(dxPx, dyPx, radius = STICK_RADIUS, dead = STICK_DEAD, expo = STICK_EXPO){
  const nx = dxPx / radius, ny = dyPx / radius;
  const m = Math.hypot(nx, ny);
  if (!Number.isFinite(m)) return { f:0, r:0, mag:0, kx:0, ky:0 };
  /* kx/ky：旋钮的显示位置（不过曲线，跟手指走、夹在圆内）—— 视觉跟手，速度走曲线 */
  const clamp = m > 1 ? 1 / m : 1;
  const kx = nx * clamp, ky = ny * clamp;
  if (m <= dead) return { f:0, r:0, mag:0, kx, ky };
  const mag = Math.pow((Math.min(1, m) - dead) / (1 - dead), expo);
  return { r: nx / m * mag, f: -ny / m * mag, mag, kx, ky };
}
/* out（可选，2026-11-24 · 第 5 批）：走模式每帧调一次，给复用对象就零分配；不给仍返回新对象（单测口径不变）。 */
export function combineMove(f, r, out){
  const o = out || {};
  const l = Math.hypot(f, r);
  if (!(l > 1e-9)){ o.f = 0; o.r = 0; o.mag = 0; return o; }
  if (l <= 1){ o.f = f; o.r = r; o.mag = l; return o; }
  o.f = f / l; o.r = r / l; o.mag = 1;
  return o;
}

/* ══ 7. 分享当前景色：URL hash 编解码 ══════════════════════════════════════
   形如  #v=1&s=autumn&h=17.25&w=mist&d=290&c=12.30,4.60,18.00&t=0.00,3.60,-12.00
   · 用 hash 而不是查询串：现有查询参数一大把（tier / debug / intro / guide / touch / notes /
     etiquette / walkback / visit / heroSrc / cdn / solar / refract / motion …），hash 里一个都没有，
     不可能撞名；改 hash 也不触发整页重载（同一标签页粘贴新链接 ⇒ hashchange 直接换景）。
   · v=1 是格式版本 —— 没有它就不认（别把别人随手加的 #xxx 当成机位）。
   · 精度：时辰 2 位小数（36 秒）、坐标 2 位小数（1 cm）—— 同一幅画，链接又不至于太长。
   · d（年内日序）只在**不等于该季代表日**时写：看梅机位会把日子拨到早春，只写季节会丢花期。
   · 每个字段**各自校验**：坏一个丢一个，其余照用；一个都不合法 ⇒ null（照常开园）。 */
export const VIEW_LIMITS = { xz:300, yMin:-2, yMax:200 };
const fx = (n, k) => (Math.round(n * 10 ** k) / 10 ** k).toFixed(k);
function vec3ok(a){
  return Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)
    && Math.abs(a[0]) <= VIEW_LIMITS.xz && Math.abs(a[2]) <= VIEW_LIMITS.xz
    && a[1] >= VIEW_LIMITS.yMin && a[1] <= VIEW_LIMITS.yMax;
}
export function encodeView(v){
  const parts = ['v=1'];
  if (v.season) parts.push('s=' + encodeURIComponent(v.season));
  if (Number.isFinite(v.hour)){
    // 流转在午夜前可取到 23.999；量化会进位到 24.00，须再环回才满足解码的 [0,24)。
    const hour = Number(fx(((v.hour % 24) + 24) % 24, 2)) % 24;
    parts.push('h=' + hour.toFixed(2));
  }
  if (v.weather) parts.push('w=' + encodeURIComponent(v.weather));
  if (Number.isFinite(v.doy)) parts.push('d=' + Math.round(v.doy));
  if (vec3ok(v.cam) && vec3ok(v.tgt)){
    parts.push('c=' + v.cam.map(n => fx(n, 2)).join(','));
    parts.push('t=' + v.tgt.map(n => fx(n, 2)).join(','));
  }
  return parts.join('&');
}
function parseVec(s){
  if (typeof s !== 'string' || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(s)) return null;
  const a = s.split(',').map(Number);
  return vec3ok(a) ? a : null;
}
/* seasons / weathers：合法取值表（由调用方从 ENV_SEASON / ENV_WEATHER 的键传进来 ——
   本模块零依赖，不自己 import 预设表）。 */
export function decodeView(hash, { seasons = [], weathers = [] } = {}){
  if (typeof hash !== 'string') return null;
  const q = hash.replace(/^#/, '');
  if (!q || q.length > 400) return null;
  const kv = new Map();
  for (const p of q.split('&')){
    const i = p.indexOf('=');
    if (i <= 0) continue;
    let val;
    try { val = decodeURIComponent(p.slice(i + 1)); } catch { continue; }
    kv.set(p.slice(0, i), val);
  }
  if (kv.get('v') !== '1') return null;
  const out = {};
  const s = kv.get('s');
  if (s && seasons.includes(s)) out.season = s;
  const w = kv.get('w');
  if (w && weathers.includes(w)) out.weather = w;
  const h = kv.get('h');
  if (h != null && /^\d{1,2}(\.\d+)?$/.test(h)){ const n = Number(h); if (n >= 0 && n < 24) out.hour = n; }
  const d = kv.get('d');
  if (d != null && /^\d{1,3}$/.test(d)){ const n = Number(d); if (n >= 1 && n <= 366) out.doy = n; }
  const c = parseVec(kv.get('c')), t = parseVec(kv.get('t'));
  if (c && t && Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]) > 0.05){ out.cam = c; out.tgt = t; }
  return Object.keys(out).length ? out : null;
}
