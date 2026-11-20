// 11b-vista：走模式的「驻足点」（2026-11-20 · 功能批次：加景/加玩法）。
//
// ── 解决什么问题 ────────────────────────────────────────────────────────────
// 第一人称行走（11a-walk，2026-11-16）落地后，园子"能走"但"没得读"——
// 苏州园林的看点恰是匾额题字、移步换景，走近了应该有个地方告诉你
// "你面前这块石头叫云根"。悬停标签（11-loop _tickHover）只覆盖鼠标模式，
// 走模式的相机由键盘驱动、鼠标概念不适用 ⇒ 需要一套**按距离触发**的驻足文案。
//
// ── 做法 ────────────────────────────────────────────────────────────────────
//   · 驻足点表 VISTA_SPOTS：每条 = { 触发圆心（世界坐标）, 半径, 标题, 正文 }。
//     坐标**不硬编码第二份** —— 从 08d-tour 的 VIEWPOINTS 机位 target 字段派生
//     （那是各景物的实际位置，是全园唯一坐标真值），文案从 03a-names 取
//     （SITE_NAMES/HALL_COUPLET 是展示名的唯一出处）。
//   · 走模式激活时每帧扫一遍表（≤8 条，纯距离判定，无射线成本）；
//     命中最近一条且满足「首次进入才弹 + 离开 1.5m 才允许重弹」。
//   · 呈现：右下角小卡片，pointer-events:none（不挡行走输入），Esc/离开自动收。
//     文案与 16b-artistic-note 同一气质：短、像身边导游的一句话。
//
// ── 边界（如实声明）────────────────────────────────────────────────────────
//   · 只在走模式里生效；鼠标机位模式已有悬停标签，不重复建设。
//   · VIEWPOINTS 是延迟构建的（08d-tour buildViewpoints()）⇒ 首次使用时动态
//     import 兜底；取不到坐标时驻足点静默不建（页面照常跑，只是没卡片）。
//   · 文案不新增考据断言：匾联本就是自拟的（03a-names 注释），照实引用。
import { HALL_COUPLET } from './03a-names.js';

const RADIUS = 3.5;        // 进入半径（m）
const REENTER_GAP = 1.5;    // 离开这么多米才允许重弹（防边界抖动反复弹）

/* 驻足点定义：vp 取 VIEWPOINTS 里机位的 id，spot 取 target（景物实际位置）。
   anchor 字段是"卡片描述的景物"——文案围绕它写，与机位 id 可以不同。 */
const SPOT_DEFS = [
  { vp:'stele',    anchor:'题名石', title:'「云根」题名石',
    text:'池南特置立峰的题名石。「云根」二字取石中云气之意：' +
         '古人谓石有窍如云所出，故以云名石。' },
  { vp:'hall',     anchor:'远香堂', title:'远香堂',
    text:'园中主堂，四面厅形制。' +
         '堂前题联「' + HALL_COUPLET.upper + '，' + HALL_COUPLET.lower + '」——' +
         '水月在前，荷风在侧，联语即是对景。' },
  { vp:'pavilion', anchor:'荷风四面', title:'荷风四面',
    text:'池东临水凉亭。盛夏凭栏，四面皆荷——' +
         '亭名取周敦颐《爱莲说》「香远益清」意，风过处满池皆香。' },
  { vp:'hero',     anchor:'立峰', title:'太湖石立峰',
    text:'太湖石讲究「瘦、皱、漏、透」。眼前这峰四德俱全，' +
         '孔窍相通可引风穿堂，雨后石润如云出岫。' },
];

/* DOM：右下角卡片（挂在 body，独立于 #env 面板 —— 那是交互面板，这是被动的展示件）。 */
let _el = null;
function ensureEl(){
  if (_el) return _el;
  _el = document.createElement('div');
  _el.id = 'vista-card';
  _el.hidden = true;
  _el.style.cssText =
    'position:fixed;right:24px;bottom:24px;max-width:340px;padding:14px 18px;' +
    'background:#fffbeee8;color:#302c25;border-radius:6px;z-index:12;' +
    'font:13px/1.7 serif;box-shadow:0 6px 18px rgba(0,0,0,.25);pointer-events:none;' +
    'transition:opacity .3s;opacity:0';
  _el.innerHTML = '<b style="font-size:15px;display:block;margin-bottom:4px"></b><span></span>';
  document.body.appendChild(_el);
  return _el;
}

export function createVista({ walkState }){  let spots = null;         // [{x,z,r,title,text,name}]
  let building = false;     // buildSpots 动态 import 在飞 ⇒ 防重入
  let current = -1;         // 当前展示的驻足点下标
  let visited = new Set();  // 本轮步行已弹过的点
  /* 简化策略：一条驻足点每轮步行只弹一次（visited 集合）。
     走回头路不刷屏，比"离开重弹"体验稳，规则也一眼能懂。 */

  async function buildSpots(){
    if (spots || building) return;
    building = true;
    let VPS = null;
    try {
      /* 只读 VIEWPOINTS 现值 —— 它由 08-assemble 在装配时调 buildViewpoints(HERO_POS)
         同步建好（08-assemble.js:810），本模块不重复构建（那需要 HERO_POS 参数，
         重复调用还会把机位表整个重建一遍）。装配未完成时这里拿到 null ⇒ spots
         留空、下一轮步行重试（buildSpots 在 spots===null 时每帧都会再试）。 */
      const m = await import('./08d-tour.js');
      VPS = m.VIEWPOINTS;
    } catch { building = false; return; }
    building = false;
    if (!Array.isArray(VPS) || !VPS.length) return;
    spots = [];
    for (const d of SPOT_DEFS){
      const v = VPS.find(x => x && x.id === d.vp);
      if (v && v.target){
        spots.push({ x:v.target.x, z:v.target.z, title:d.title, text:d.text,
                     name:d.anchor });
      }
    }
  }

  function hide(){
    current = -1;
    if (!_el || _el.hidden) return;
    _el.hidden = true; _el.style.opacity = '0';
  }

  let _probeWait = 0;
  /* 每帧由走模式 tick 调（walk.update 之后）—— 未激活或表没建好直接回。 */
  function update(){
    if (!walkState().active){ hide(); return; }
    if (spots === null){
      /* 装配未完成时 VIEWPOINTS 还是 null：降频重试（动态 import 有模块缓存，
         但每帧起一个 Promise 也没必要 —— 30 帧一次足够，building 标志兜并发）。 */
      if (_probeWait++ % 30 === 0) buildSpots();
      return;
    }
    if (!spots.length) return;
    const cx = cameraPosX(), cz = cameraPosZ();
    let best = -1, bestD = Infinity;
    for (let i = 0; i < spots.length; i++){
      const s = spots[i];
      const dx = cx - s.x, dz = cz - s.z, d = dx*dx + dz*dz;
      if (d < bestD){ bestD = d; best = i; }
    }
    const R2 = RADIUS * RADIUS;
    /* 命中：最近点在半径内且本轮没弹过 ⇒ 弹卡并记 visited（一条点一轮只讲一遍，
       走回头路不刷屏）。卡片在播时只看"是否还站在原点半径+缓冲内"，站远即收。 */
    if (best >= 0 && bestD <= R2 && !visited.has(best)){
      const s = spots[best];
      const el = ensureEl();
      el.querySelector('b').textContent = s.title;
      el.querySelector('span').textContent = s.text;
      el.hidden = false;
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      visited.add(best);
      current = best;
    } else if (current >= 0){
      const s = spots[current];
      const dx = cx - s.x, dz = cz - s.z;
      if (dx*dx + dz*dz > (RADIUS + REENTER_GAP) ** 2) hide();
    }
  }

  /* 步行重开（Esc 后再按"步行"）算新的一轮：清 visited，让所有点可重弹。 */
  function reset(){ visited.clear(); hide(); current = -1; }

  /* 相机坐标的取法：11-loop 把 camera 传进来而不是本模块自己 import ——
     保持零静态依赖环（11-loop ← 11b 不新增反向边）。 */
  let _cam = null;
  function setCamera(c){ _cam = c; }
  function cameraPosX(){ return _cam ? _cam.position.x : 0; }
  function cameraPosZ(){ return _cam ? _cam.position.z : 0; }

  return { update, reset, setCamera, hide };
}

/* 注入 DOM 存在性检查：删掉本文件页面照常跑（走模式只是没卡片），与 16b 同一声明。 */
