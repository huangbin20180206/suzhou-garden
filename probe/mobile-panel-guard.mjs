// 移动端/平板控制面板门禁：node probe/mobile-panel-guard.mjs
//
// 守的是老黄 2026-10-07 提的那件事：
//   「对手机或平板进行适配，特别是入场功能选项卡**不要马上显示**，
//     点击那个小按钮再出现，还需要对这个选项卡的样式和尺寸进行调整
//     以便能适配用手点击操作」
//
// 三条契约（分别对应他这句话的三段）：
//   ① 进场时面板必须是**收起**的，而且不是"看不见但还在吃点击"——
//      opacity/visibility/pointer-events 三样都要是收起态；
//   ② 只有**点左下角那枚方印**才出来；点面板之外要能收回去（触屏没有"鼠标移开"）；
//   ③ 触屏命中区要按手指尺寸给：方印 ≥56px、面板里的按钮 ≥44px，
//      并且面板不许横向溢出视口（宽屏平板也一样）。
//
// 另有两条**引导不代开**的判据（这是本轮唯一发现的"自动弹出"来源）：
//   ④ 触控口径下，首次引导走到"目标是抽屉里按钮"那一步时**不得替用户把面板推开**
//      （改把光环打在方印上，文案也指向方印）—— 手机上一整块面板推出来既挡画面、
//      又抢走他"点开"的动作；
//   ⑤ 负例对照（桌面口径）同一步**必须**展开 —— 当年就是因为"收起状态量不到矩形，
//      光环会画在 0,0"才写成代开的，这条对照保证 ④ 不是一条恒绿的假判据。
//
// ⚠️ 触控口径 = 与 CSS 那条媒体查询**同一条件** `(max-width:520px), (hover:none)`
//    （产品侧 guideTouchUI() 用的就是这个字符串）。所以手机尺寸下无需依赖
//    Playwright 是否真的把 hover 报成 none —— 宽度那半已经命中了。
// ⚠️ 就绪信号只等 `#loading.done`：本机触屏模拟档下分帧装配（每帧一个 job）
//    可能几十秒都跑不完，要知道的面板状态在**首帧之后**就定了，不必等 bootDone。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VIEWS = [
  { tag: '手机 390×844',   vp: { width: 390,  height: 844  }, touch: true,  touchUI: true  },
  { tag: '平板 820×1180',  vp: { width: 820,  height: 1180 }, touch: true,  touchUI: true  },
  { tag: '桌面 900×600',   vp: { width: 900,  height: 600  }, touch: false, touchUI: false },
  /* 宽屏桌面**对照档**：老黄主要在电脑上看，这档必须与改动前逐字一致 ——
     即"面板宽度不被 max-width 夹、行内不换行"。窄窗口那两条修复不能漏进宽屏。 */
  { tag: '桌面 1440×900',  vp: { width: 1440, height: 900  }, touch: false, touchUI: false },
];

const panelState = (page) => page.evaluate(() => {
  const env = document.getElementById('env');
  const tog = env.querySelector('.drawer-toggle');
  const cont = env.querySelector('.drawer-content');
  const cs = getComputedStyle(cont);
  const r = cont.getBoundingClientRect(), rt = tog.getBoundingClientRect();
  const btns = [...cont.querySelectorAll('button')].map(b => b.getBoundingClientRect())
    .filter(b => b.height > 0);
  return {
    expanded: env.classList.contains('expanded'),
    aria: tog.getAttribute('aria-expanded'),
    style: `${cs.opacity}/${cs.visibility}/${cs.pointerEvents}`,
    toggle: { w: +rt.width.toFixed(1), h: +rt.height.toFixed(1), cx: +(rt.left + rt.width / 2).toFixed(1) },
    panel: { top: +r.top.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1) },
    overflowRight: +(r.right - innerWidth).toFixed(1),
    minBtnH: btns.length ? +Math.min(...btns.map(b => b.height)).toFixed(1) : null,
    touchUI: matchMedia('(max-width:520px), (hover:none)').matches,
  };
});

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const base = `http://127.0.0.1:${port}/index.html`;
  console.log(`\n[mobile-panel-guard] ${base}`);

  for (const V of VIEWS){
    console.log(`\n── ${V.tag} ──`);
    const ctx = await browser.newContext({
      viewport: V.vp, isMobile: V.touch, hasTouch: V.touch, deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e && e.message || e)));

    /* ?guide=1：让引导走"真用户那条自动弹路径"（自动化下默认不弹，见 guide-guard 头部）。 */
    await page.goto(`${base}?guide=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
      { timeout: 150000, polling: 300 });
    await sleep(900);

    /* ── 前提断言：这一档是不是"触控口径"（判据的分支条件必须先断言） ── */
    const st0 = await panelState(page);
    check(`${V.tag}：前提——触控口径=${V.touchUI}（与 CSS 同一条媒体查询）`,
      st0.touchUI === V.touchUI, `实测 ${st0.touchUI}`);

    /* ── ① 进场即收起（三样都要是收起态，"看不见但吃点击"不算） ── */
    check(`${V.tag}：进场时面板收起、不可命中`,
      st0.expanded === false && st0.style === '0/hidden/none',
      `expanded=${st0.expanded} style=${st0.style}`);

    /* ── ③′ 面板不许横向溢出视口 ── */
    check(`${V.tag}：收起态的面板也不横向溢出视口`,
      st0.overflowRight <= 0, `右缘超出 ${st0.overflowRight}px`);

    /* ── ③″ 桌面档的"收进视口"不能靠把面板换行缩成细柱 ──
       面板是绝对定位的收缩到适应盒：一旦允许换行，它的"最小内容宽"就从 ~904px
       掉到一行里最宽的那个按钮（~70px），shrink-to-fit 会把整块面板缩成 242px 细柱
       （本轮真踩到，靠这条判据的两侧夹逼抓出来：太宽碰右缘 / 太窄就是缩没了）。 */
    if (!V.touchUI){
      check(`${V.tag}：桌面版式没被换行缩窄（面板宽 ≥780px）`,
        st0.panel.w >= 780, `panel.w=${st0.panel.w}`);
    }
    /* 宽屏对照：这一档必须与改动前一致 —— 没有行被换行（面板不会被 max-width 夹住） */
    if (V.vp.width >= 1400){
      const wrap = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#env .row')];
        return { n: rows.length, wrapped: rows.filter(r => r.getBoundingClientRect().height > 56).length };
      });
      check(`${V.tag}：宽屏下没有一行被换行（桌面版式与改动前一致）`,
        wrap.wrapped === 0, `${wrap.wrapped}/${wrap.n} 行换行`);
    }

    /* ── ④/⑤ 引导在触控口径下不代开面板；桌面口径必须代开（负例对照） ── */
    await page.evaluate(() => window.__garden.guideStart());
    await page.evaluate(() => window.__garden.guideNext());
    await page.evaluate(() => window.__garden.guideNext());     // 第 3 步：目标是面板里的「巡游」
    await sleep(700);
    const g = await page.evaluate(() => {
      const env = document.getElementById('env');
      const ring = document.querySelector('#guide .g-ring');
      const tog = document.querySelector('#env .drawer-toggle').getBoundingClientRect();
      /* ⚠️ 光环必须读**inline 的 left/top/width/height**（guideRender 同步写进去的目标值），
         不能读 getBoundingClientRect()：`.g-ring{transition:all .34s}` 是逐帧推进的，
         而本机触屏档一帧要几百毫秒 ⇒ 采样时读到的常是过渡途中的位置
         （实测手机档量到环心 (133,573)，而目标 (38,806)）—— 那是在量帧率，不是在量产品。 */
      const n = (v) => parseFloat(v) || 0;
      return {
        expanded: env.classList.contains('expanded'),
        text: document.querySelector('#guide .g-bubble span').textContent,
        ringTarget: { cx: n(ring.style.left) + n(ring.style.width) / 2,
                      cy: n(ring.style.top) + n(ring.style.height) / 2 },
        togCx: tog.left + tog.width / 2, togCy: tog.top + tog.height / 2,
        aria: document.querySelector('#env .drawer-toggle').getAttribute('aria-expanded'),
      };
    });
    const gc = g.ringTarget;
    if (V.touchUI){
      check(`${V.tag}：引导走到"面板里的按钮"那一步时**不替用户展开面板**`,
        g.expanded === false, `expanded=${g.expanded}`);
      check(`${V.tag}：引导改把光环打在左下角方印上（误差 ≤14px）`,
        Math.abs(gc.cx - g.togCx) <= 14 && Math.abs(gc.cy - g.togCy) <= 14,
        `环心(${gc.cx.toFixed(0)},${gc.cy.toFixed(0)}) 方印心(${g.togCx.toFixed(0)},${g.togCy.toFixed(0)})`);
      check(`${V.tag}：引导文案指向"方印"（教用户点哪里）`,
        /方印/.test(g.text), g.text.slice(0, 26));
    } else {
      check(`${V.tag}：负例对照——桌面口径下引导**必须**代开面板（证明上一条不是恒绿）`,
        g.expanded === true, `expanded=${g.expanded}`);
      check(`${V.tag}：代开走的是真实点击（aria-expanded 同步为 true，别只 classList.add）`,
        g.aria === 'true', `aria-expanded=${g.aria}`);
    }
    await page.evaluate(() => window.__garden.guideStop());
    await sleep(400);

    /* 桌面这条已经把面板打开了：先收回去，后面按同一套流程量触屏命中区 */
    await page.evaluate(() => {
      const env = document.getElementById('env');
      if (env.classList.contains('expanded')) env.querySelector('.drawer-toggle').click();
    });
    await sleep(500);

    /* ── ② 点方印才出来（真实点击） ── */
    await page.click('#env .drawer-toggle');
    const opened = await page.waitForFunction(() => {
      const s = getComputedStyle(document.querySelector('#env .drawer-content'));
      return s.visibility === 'visible' && Number(s.opacity) > 0.9 && s.pointerEvents !== 'none';
    }, { timeout: 5000, polling: 50 }).then(() => true).catch(() => false);
    const st1 = await panelState(page);
    check(`${V.tag}：点方印后面板可命中（轮询到位）`, opened, JSON.stringify(st1));
    check(`${V.tag}：展开后 aria-expanded=true`, st1.aria === 'true', `aria=${st1.aria}`);
    check(`${V.tag}：展开后仍不横向溢出视口`, st1.overflowRight <= 0, `右缘超出 ${st1.overflowRight}px`);

    /* ── ③ 触控命中区（手指尺寸） ── */
    if (V.touchUI){
      check(`${V.tag}：方印命中区 ≥56×56（手指可稳准点中）`,
        st0.toggle.w >= 56 && st0.toggle.h >= 56, `${st0.toggle.w}×${st0.toggle.h}`);
      check(`${V.tag}：面板内按钮命中区 ≥44px`,
        st1.minBtnH !== null && st1.minBtnH >= 44, `最小 ${st1.minBtnH}px`);
    }
    /* 留档图必须在**面板开着**的时候拍（拍在最后就只剩收起态，看图的人只能对空气挑刺） */
    await page.screenshot({ path: `outputs/_diag/mobile-panel/${V.tag.replace(/[^\w]/g, '')}-open.png` });

    /* ── ③‴ 放大按钮之后，面板还得**一屏放得下** ──
       手机上一次放不下就得多滚一段才能找到「巡游 / 画质」这些常用项，
       那是"为了手指舒服而牺牲一眼看全"的净亏（实测按钮放大后曾超出 124px）。
       同时守住"选中锚点的色块不压滑杆圆球"：锚点标签的命中框 46px 与圆球本来就重叠
       （那里点下去=跳到该锚点，是设计），所以量的是**画出来的那块**（::before）。 */
    if (V.touchUI){
      const fit = await page.evaluate(() => {
        const cont = document.querySelector('#env .drawer-content');
        const track = document.getElementById('timeTrack');
        const inp = document.getElementById('hourSlider');
        const ir = inp.getBoundingClientRect();
        const thumb = parseFloat(getComputedStyle(document.getElementById('env')).getPropertyValue('--thumb')) || 18;
        const rr = parseFloat(getComputedStyle(track).getPropertyValue('--r')) || 0.52;
        const bcx = ir.left + ((ir.width - thumb) * rr + thumb / 2), bcy = ir.top + ir.height / 2;
        const sel = track.querySelector('.time-marks button.on');
        let cover = 0;
        if (sel){
          const q = sel.getBoundingClientRect();
          const ph = parseFloat(getComputedStyle(sel, '::before').height) || 0;
          if (ph > 0){
            const top = q.bottom - ph;
            const v = Math.max(0, Math.min(q.bottom, bcy + thumb / 2) - Math.max(top, bcy - thumb / 2));
            const h = Math.max(0, Math.min(q.right, bcx + thumb / 2) - Math.max(q.left, bcx - thumb / 2));
            cover = (v > 0 && h > 0) ? v : 0;
          }
        }
        return { over: cont.scrollHeight - cont.clientHeight, scrollH: cont.scrollHeight,
                 clientH: cont.clientHeight, cover: +cover.toFixed(1) };
      });
      check(`${V.tag}：面板内容一屏放得下（底部按钮不用滚动就能看到）`,
        fit.over <= 2, `scrollH=${fit.scrollH} clientH=${fit.clientH}（超出 ${fit.over}px）`);
      check(`${V.tag}：选中锚点的色块不压住滑杆圆球`,
        fit.cover === 0, `压住 ${fit.cover}px`);
    }

    /* ── ②′ 展开后按钮真的能点（触屏路径可达，不是"看得见点不动"） ── */
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#env button[data-axis="season"]')].find(x => x.dataset.v === 'spring');
      if (b) b.click();
    });
    await sleep(400);
    const season = await page.evaluate(() => window.__garden.ENV.season);
    check(`${V.tag}：面板里的按钮真实点得动（季节→春）`, season === 'spring', `season=${season}`);

    /* ── ②″ 点面板之外收起（触屏没有"鼠标移开"这条路） ── */
    const r = st1.panel;
    const y = Math.max(4, Math.round(r.top - 20));
    await page.mouse.click(Math.round(V.vp.width / 2), y);
    await sleep(500);
    const st2 = await panelState(page);
    check(`${V.tag}：点面板之外收起（触屏的收起路径）`,
      st2.expanded === false, `expanded=${st2.expanded}`);

    if (errs.length) check(`${V.tag}：零 pageerror`, false, errs.slice(0, 2).join(' | '));

    await ctx.close();
  }

  await browser.close();
  /* ⚠️ 必须关掉本地静态服务器再退出：探针自己在 127.0.0.1 上开了 http server，
     不关的话事件循环永远有人守着 —— **全绿时进程也不会退出**（看起来"跑完了"，
     实际挂在后台，verify-all 的 spawnSync 会等到硬超时把它记成红门）。
     2026-10-07 真踩到：连跑 5 次留了 5 个孤儿 node 进程。姊妹门都写了这两行。 */
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[mobile-panel-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  if (failed.length){ console.log('失败项：'); failed.forEach(f => console.log('  · ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[mobile-panel-guard] 崩溃:', e); process.exit(2); });
