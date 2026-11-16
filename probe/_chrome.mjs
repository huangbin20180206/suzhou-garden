/* 界面浮层的统一处理 —— 门禁量像素前先把「不是画面的东西」藏掉。
   ─────────────────────────────────────────────────────────────
   状态：已修复（2026-11-16）。本文件是那次修法的共用件，不是待办。

   事故记录（为什么需要这个文件）：
   `reel-guard` 曾在 2026-11-10 出现「全链红、单跑绿」，根因是它的统计口径用整幅画面
   的亮度均值，而 `#env` 抽屉展开后占 640×480 画框的 618×340 = **68.4%**：量到的主要
   是抽屉的像素，不是园子的像素。那一处已在 `reel-guard` 内部用 `frameMeanOutside()`
   扣掉抽屉矩形修掉。

   但同一个坑在别的门上仍然开着，分两种：
   ① **定点取样型**（`mist-guard` 按列取山脊/天空亮度）：取样点一旦落进浮层矩形，
      读到的是浮层的像素 —— 量具量错了对象，读数看着正常却与画面无关。
   ② **整幅差分型**（`lamp-guard` 开灯/关灯、`lampvol-guard` 体积光 ON/OFF）：
      两帧都含浮层 ⇒ 差分里浮层抵消，但信号被浮层面积稀释，阈值余量被悄悄吃掉。

   用法（对 page.screenshot 取像素的门）：
     import { hideChrome, showChrome, chromeRects } from './_chrome.mjs';
     await hideChrome(page);      // 藏掉浮层（visibility:hidden，不改布局、不改画布尺寸）
     ...取像素...
     await showChrome(page);      // 用完立刻还原，后面的交互/点击不受影响

   注意：只对 `page.screenshot()` 这条通路有意义。直接
   `ctx.drawImage(renderer.domElement)` 读画布的门（`afterrain` / `thunder` / `fresnel` /
   `sky-layer` / `fireworks`）本来就拍不到 DOM，不需要也不该调用本文件。
*/

/* 显式名单：这些是已知会盖在画面上的浮层。新增 UI 请加进这里。 */
export const CHROME_SELECTORS = [
  '#hud',            // 左上标题 + 右下性能/环境读数
  '#stats',
  '#env',            // 环境抽屉（含 drawer-toggle 按钮）
  '#guide',          // 导览
  '#caption',        // 字幕/解说
  '#hover-label',    // 悬停标签
  '#showKeys',       // 快捷键提示
  '#walk-help',      // 步行提示条
  '#tip',
  '#toast',
  '#ld-quick',
  '#see-lantern',
  '#loading',        // 启动遮罩（正常已 display:none，兜底）
];

/* 藏浮层。返回被藏的元素数，便于在日志里留一行「本次藏了 N 个浮层」。 */
export async function hideChrome(page) {
  return page.evaluate((sels) => {
    const saved = [];
    const hide = (el) => {
      if (saved.some(([e]) => e === el)) return;
      saved.push([el, el.style.visibility]);
      el.style.visibility = 'hidden';
    };
    for (const s of sels) document.querySelectorAll(s).forEach(hide);
    /* 兜底：任何 position:fixed 的浮层（#app 本体除外）也藏掉 ——
       新加的浮层即使忘了登记进名单，也不会静默污染读数。 */
    document.querySelectorAll('body *').forEach((el) => {
      if (el.id === 'app') return;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0) hide(el);
    });
    window.__chromeSaved = saved;
    return saved.length;
  }, CHROME_SELECTORS);
}

/* 还原。必须在使用完像素后调用，否则后续点击/交互会摸到隐藏元素。 */
export async function showChrome(page) {
  return page.evaluate(() => {
    const saved = window.__chromeSaved || [];
    for (const [el, v] of saved) el.style.visibility = v;
    window.__chromeSaved = null;
    return saved.length;
  });
}

/* 当前可见浮层的矩形与占画框百分比（诊断/留证用，不改变页面）。
   ⚠️ 2026-11-16 自查纠错：第一版把**任何** position:fixed/absolute 且尺寸够大的元素都算浮层，
   于是把 `#app` 下面那层**透明的画布外壳**也算成了"浮层"——mist-guard 自检打印出
   「120/120 取样点落在浮层里（div）」，而实测改前/改后读数一字不差，说明根本没遮到画面。
   （诊断脚本 outputs/_diag/chromehit-20261117.mjs：105 个取样点里 104 个 elementFromPoint
   命中 canvas，只有 1 个落在真正透明的 drawer-toggle 上。）
   现在的口径：**只有真会画出东西的**才算浮层 —— 背景不透明，或有文字；并且不含画布。
   要判"某个点到底被谁挡"，请用 occludersAt()，那才是直读。 */
export async function chromeRects(page) {
  return page.evaluate(() => {
    const out = [];
    const W = innerWidth, H = innerHeight;
    const hasCanvas = (el) => !!el.querySelector('canvas');
    const paints = (el, cs) => {
      const bg = cs.backgroundColor || '';
      const m = bg.match(/rgba?\(([^)]+)\)/);
      const alpha = m ? (m[1].split(',').length > 3 ? +m[1].split(',')[3] : 1) : 1;
      if (alpha > 0.02) return true;
      if ((el.textContent || '').trim().length) return true;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
      return false;
    };
    document.querySelectorAll('body *').forEach((el) => {
      if (el.id === 'app' || hasCanvas(el)) return;          // 画面本体的容器不算浮层
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
      const b = el.getBoundingClientRect();
      if (b.width < 24 || b.height < 14) return;
      if (!paints(el, cs)) return;                            // 透明的定位容器不算浮层
      out.push({
        sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
        x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
        pct: +((b.width * b.height) / (W * H) * 100).toFixed(2),
      });
    });
    return out.sort((a, b) => b.pct - a.pct);
  });
}

/* 直读式遮挡判定：给定取样点，问浏览器「这一点最上面是哪个元素」。
   命中画布（或其内部）＝ 量到的是画面；命中别的东西才是真被浮层挡住。
   这是本文件唯一该用来下结论的判据 —— 矩形列表只作诊断参考。 */
export async function occludersAt(page, points) {
  return page.evaluate((pts) => {
    const out = [];
    for (const p of pts) {
      const el = document.elementFromPoint(p.x, p.y);
      if (!el) { out.push({ ...p, tag: '(null)' }); continue; }
      let n = el, onCanvas = false;
      while (n && n !== document.body) { if (n.tagName === 'CANVAS') { onCanvas = true; break; } n = n.parentElement; }
      if (onCanvas) continue;                                  // 量到画面，不算遮挡
      const cs = getComputedStyle(el);
      out.push({
        ...p,
        tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(/\s+/)[0] : ''),
        bg: cs.backgroundColor,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12),
      });
    }
    return out;
  }, points);
}

/* 判据自检：给定取样点（屏幕像素坐标 + 半径），返回落在浮层矩形里的那些点。
   用在定点取样的门里，把「量具量错对象」这件事变成一条会红的断言。 */
export function pointsUnderRects(points, rects) {
  const bad = [];
  for (const p of points) {
    const r = p.r || 0;
    for (const q of rects) {
      if (p.x + r >= q.x && p.x - r <= q.x + q.w && p.y + r >= q.y && p.y - r <= q.y + q.h) {
        bad.push({ ...p, hit: q.sel });
        break;
      }
    }
  }
  return bad;
}
