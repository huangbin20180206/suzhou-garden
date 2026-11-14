// 触控命中区常驻门禁：node probe/touch-target-guard.mjs
//
// ── 为什么要有这道门（2026-10-12 建 · MobileBot）────────────────────────────
// 2026-10-12 的移动端批次修了四处触控命中区，而这四处**此前没有任何门禁在守**：
//   · smoke 与 mobile-panel-guard 的命中区判据写的都是 `#env button`；
//   · `#env .hint-toggle` 是 <label> 包 <input type=checkbox>（两个都不是 button）；
//   · `#env input[type=range]` 是 <input>；
//   · `#guide .g-acts button` 不在 #env 内；
//   · `#loading #ld-quick` 不在 #env 内；
//   · 而 guide-guard 的命中区阈值 38px **恰好等于当时的实现值** ⇒ 恒绿。
// 合起来是一类"有覆盖面错觉"：看起来三道门都在管命中区，实际这四类元素无人管。
// 本门把它们变成常驻判据，并自带三条负例自检（项目铁律：判据必须能红）。
//
// ── 刻意不启动 3D 场景 ──────────────────────────────────────────────────────
// 本门只判**样式/几何**（盒模型宽高 + 计算样式），与渲染无关：四类元素全在静态 HTML 里，
// CSS 内联在 <head> ⇒ DOM 解析完即可量。因此**不**等 `window.__garden` / `#loading.done`
// （本机软渲染起一次要 3~4 分钟；本门量什么与启动无关，全量跑得起才是重点）。
// ⚠️ 唯一取舍：#stats 的文本由 src/11-loop.js:1402 在**启动后**按 0.5s 节拍写入，
//    本门不等启动 ⇒ 改用一份**与产线同源**的夹具文本注入后再量；夹具的每个常量片段
//    都对着 src/11-loop.js 做包含性断言（见 ⓪），产线文本一漂移本门就红，
//    避免"夹具悄悄过期、门还绿着"。
//
// ── 三个语义档（对应 index.html 的两条 `(max-width:768px),(hover:none)`）──────
//   · 手机 390×844 触控   ⇒ 窄屏规则（宽度命中 + hover:none）⇒ 四类 ≥44px
//   · 窄屏 640×900 非触控 ⇒ 窄屏规则（max-width:768px 命中）  ⇒ 四类 ≥44px
//     （这一档正是 2026-10-12 新开的带：521~767px 且 hover:hover；旧断点下会落回桌面版式）
//   · 桌面 900×600 非触控 ⇒ 基规则 ⇒ 断言**基值未被回归**（38 / 22 / 无 min-height / 6px 9px）
// 两侧合起来才是"窄屏规则只在窄屏生效、桌面没被回归"的实证。
// 另在 320×640 量 #stats 的文字渲染宽 vs 可用宽。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 老黄 2026-10-07 定的触控下限，与 smoke 的「命中区 ≥44px」同口径。 */
const MIN_TOUCH = 44;

function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}

/* 只服务到 vendor.js / src/*.js 就够（本门不等场景启动）。.glb 之类 404 无所谓，
   列进 MIME 只是免得浏览器把 404 再当"资源类型错"多报一层噪声。 */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json',
               '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png',
               '.mp3': 'audio/mpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail) => {
  const okk = !!ok;
  results.push({ name, ok: okk, detail: detail || '' });
  console.log((okk ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ── #stats 夹具：与 src/11-loop.js:1402-1411 的产线格式同源 ──
   数值取偏大的代表值；末两行是**常量文本**，也正是实测最长的那两行。
   ⓪ 会对着产线源码逐片段断言同源（STATS_TETHERS）。 */
const STATS_FIXTURE = [
  '60 fps',
  'draw calls  812',
  'triangles   1,234,567',
  'geometries  402',
  'textures    188',
  '风和日丽 · 12:30春',
  '画质 高 · high档 · GTAO · 超采样 1.25x · QoS L2',
  '按 0 复位视角 · 拖动旋转 / 滚轮缩放（可推到 1.6m）',
  '双击任意物体＝聚焦到它 · 右键拖动＝平移（走到院角看细节）',
].join('\n');
const STATS_TETHERS = [
  'draw calls  ', 'triangles   ', 'geometries  ', 'textures    ',
  '档 · ', '超采样 ', 'x · QoS L',
  '按 0 复位视角 · 拖动旋转 / 滚轮缩放（可推到 1.6m）',
  '双击任意物体＝聚焦到它 · 右键拖动＝平移（走到院角看细节）',
];

const VIEWS = [
  { tag: '手机 390×844', vp: { width: 390, height: 844 }, touch: true,  narrow: true  },
  { tag: '窄屏 640×900', vp: { width: 640, height: 900 }, touch: false, narrow: true  },
  { tag: '桌面 900×600', vp: { width: 900, height: 600 }, touch: false, narrow: false },
];

/* ── 页内量测：只读样式与盒模型，不改任何产品文件 ──
   ⚠️ 两处**刻意的 DOM 摆位**，否则量到 0：
   ① #guide 默认 display:none ⇒ 先加 .on 才量得到按钮盒子；
   ② #ld-quick 默认带 hidden（display:none）⇒ 先摘掉 hidden 才量得到盒子。
   两者只在探针页面里做。 */
const measure = (page) => page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const guide = document.getElementById('guide');
  if (guide) guide.classList.add('on');
  const quick = document.getElementById('ld-quick');
  if (quick) quick.removeAttribute('hidden');

  const label = document.querySelector('#env .hint-toggle');
  const cb = label ? label.querySelector('input[type="checkbox"]') : null;
  const ranges = [...document.querySelectorAll('#env input[type="range"]')];
  const gbtns = [...document.querySelectorAll('#guide .g-acts button')];
  const nums = ranges.map((el) => box(el).h);
  const gn = gbtns.map((el) => box(el).h);

  return {
    touchUI: matchMedia('(max-width:768px), (hover:none)').matches,
    hintLabelH: label ? box(label).h : null,
    hintLabelMinH: label ? getComputedStyle(label).minHeight : null,
    hintInputH: cb ? box(cb).h : null,
    hintInputWrapped: !!(cb && label && cb.closest('label') === label),
    rangeCount: ranges.length,
    rangeMinH: nums.length ? Math.min(...nums) : null,
    rangeFirstH: ranges.length ? getComputedStyle(ranges[0]).height : null,
    guideCount: gbtns.length,
    guideMinH: gn.length ? Math.min(...gn) : null,
    guideBtnMinH: gbtns.length ? getComputedStyle(gbtns[0]).minHeight : null,
    quickH: quick ? box(quick).h : null,
    quickPadTop: quick ? getComputedStyle(quick).paddingTop : null,
  };
});

/* ── 判定：纯函数，负例 A 直接喂它 ── */
function judgeNarrow(m){
  const bad = [];
  if (!(m.hintLabelH >= MIN_TOUCH)) bad.push('#env .hint-toggle(label) ' + m.hintLabelH + 'px < ' + MIN_TOUCH);
  if (m.hintInputWrapped !== true) bad.push('#env .hint-toggle 的 checkbox 未被 label 包裹 ⇒ label 不是合法命中区代理');
  if (!(m.rangeCount >= 2)) bad.push('#env input[type=range] 只找到 ' + m.rangeCount + ' 个（应为时段条 + 音量两个）');
  if (!(m.rangeMinH >= MIN_TOUCH)) bad.push('#env input[type=range] ' + m.rangeMinH + 'px < ' + MIN_TOUCH);
  if (!(m.guideCount >= 2)) bad.push('#guide .g-acts button 只找到 ' + m.guideCount + ' 个');
  if (!(m.guideMinH >= MIN_TOUCH)) bad.push('#guide .g-acts button ' + m.guideMinH + 'px < ' + MIN_TOUCH);
  if (!(m.quickH >= MIN_TOUCH)) bad.push('#loading #ld-quick ' + m.quickH + 'px < ' + MIN_TOUCH);
  return { ok: bad.length === 0, bad };
}
/* 桌面档只断言**基值未被回归**：命中区在桌面本就小（鼠标精度高），不该被窄屏规则放大。 */
function judgeDesktopBase(m){
  const bad = [];
  if (!/^(auto|0px)$/.test(String(m.hintLabelMinH))) bad.push('.hint-toggle 桌面档出现 min-height=' + m.hintLabelMinH + '（窄屏规则漏进桌面）');
  if (m.rangeFirstH !== '22px') bad.push('input[type=range] 桌面档 height=' + m.rangeFirstH + '（基值应 22px）');
  if (m.guideBtnMinH !== '38px') bad.push('.g-acts button 桌面档 min-height=' + m.guideBtnMinH + '（基值应 38px）');
  if (m.quickPadTop !== '6px') bad.push('#ld-quick 桌面档 padding-top=' + m.quickPadTop + '（基值应 6px）');
  return { ok: bad.length === 0, bad };
}

/* #stats 溢出判据：文字的**实际占用区间必须完整落在视口内**，且实际文字宽 ≤ 可用宽。
   ⚠️ 两条边都要守 —— 2026-10-12 首版只守了左缘（textLeft >= 0），而注入 2400px 后
   Chrome 对超长单行是**向右溢出**（textLeft 仍是盒左缘 10px）⇒ 那条判据只长了一半的牙，
   被负例 C 当场抓住。正例与两条负例都走这**同一个函数**，保证负例打的是正向那条一模一样的代码路径。 */
function statsFits(s){
  const textRight = s.textLeft + s.textW;
  return s.textLeft >= -0.5                     // 左缘不越出视口左缘
      && textRight <= s.vw + 0.5                // 右缘不越出视口右缘
      && s.textW <= s.avail + 0.5;              // 等价说法：实际文字宽 ≤ 可用宽
}
function statsDetail(s){
  const textRight = +(s.textLeft + s.textW).toFixed(1);
  return '字号 ' + s.fontSize + ' / white-space:' + s.whiteSpace
    + ' / 视口 ' + s.vw + 'px / 可用 ' + s.avail + 'px / 盒宽 ' + s.boxW + 'px'
    + ' / 文字 ' + s.textW + 'px / 余量 ' + (s.avail - s.textW).toFixed(1) + 'px'
    + ' / 文字左缘 ' + s.textLeft + 'px / 文字右缘 ' + textRight + 'px';
}

const measureStats = (page, text) => page.evaluate((txt) => {
  const el = document.getElementById('stats');
  el.textContent = txt;
  const b = el.getBoundingClientRect();
  const r = document.createRange(); r.selectNodeContents(el);
  const t = r.getBoundingClientRect();
  return {
    vw: innerWidth,
    avail: innerWidth - 20,                    // index.html 窄屏：#stats{max-width:calc(100vw - 20px)}
    fontSize: getComputedStyle(el).fontSize,
    whiteSpace: getComputedStyle(el).whiteSpace,
    boxW: +b.width.toFixed(1), boxLeft: +b.left.toFixed(1),
    textW: +t.width.toFixed(1), textLeft: +t.left.toFixed(1),
  };
}, text);

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const base = 'http://127.0.0.1:' + port + '/index.html';
  console.log('\n[touch-target-guard] ' + base);

  /* ── ⓪ 夹具同源自检（纯 node，最先跑：夹具过期就别说后面的数）── */
  {
    const src = fs.readFileSync(path.join(ROOT, 'src', '11-loop.js'), 'utf8');
    const miss = STATS_TETHERS.filter((s) => src.indexOf(s) < 0);
    check('#stats 夹具与 src/11-loop.js 产线文本同源（防夹具静默过期）',
      miss.length === 0,
      miss.length ? '产线已不含：' + miss.join(' / ') : STATS_TETHERS.length + ' 个片段全部命中');
  }

  for (const V of VIEWS){
    console.log('\n── ' + V.tag + ' ──');
    const ctx = await browser.newContext({
      viewport: V.vp, isMobile: V.touch, hasTouch: V.touch, deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    /* ⚠️ 不等 load（这个页面 load 要数分钟）：CSS 在 <head> 内联，DOM 一解析完就能量。
       三处 waitForSelector 都必须是 state:'attached' —— #guide / #ld-quick 默认隐藏，
       默认的 state:'visible' 会直接超时。 */
    await page.goto(base, { waitUntil: 'commit', timeout: 120000 });
    await page.waitForSelector('#env .hint-toggle input[type="checkbox"]', { state: 'attached', timeout: 60000 });
    await page.waitForSelector('#loading #ld-quick', { state: 'attached', timeout: 60000 });
    await page.waitForSelector('#guide .g-acts button', { state: 'attached', timeout: 60000 });
    await sleep(500);

    const m = await measure(page);
    check(V.tag + '：前提——窄屏口径=' + V.narrow + '（与 index.html 那条媒体查询同一条）',
      m.touchUI === V.narrow, '实测 ' + m.touchUI);

    if (V.narrow){
      check(V.tag + '：#env .hint-toggle 命中区 ≥' + MIN_TOUCH + 'px（量 label 盒，内层 checkbox 被它包裹）',
        m.hintLabelH >= MIN_TOUCH && m.hintInputWrapped === true,
        'label ' + m.hintLabelH + 'px / 内层 checkbox ' + m.hintInputH + 'px / 被 label 包裹=' + m.hintInputWrapped);
      check(V.tag + '：#env input[type=range] 命中区 ≥' + MIN_TOUCH + 'px',
        m.rangeMinH >= MIN_TOUCH, m.rangeCount + ' 个，最小 ' + m.rangeMinH + 'px');
      check(V.tag + '：#guide .g-acts button 命中区 ≥' + MIN_TOUCH + 'px',
        m.guideMinH >= MIN_TOUCH, m.guideCount + ' 个，最小 ' + m.guideMinH + 'px');
      check(V.tag + '：#loading #ld-quick 命中区 ≥' + MIN_TOUCH + 'px',
        m.quickH >= MIN_TOUCH, m.quickH + 'px');
      const j = judgeNarrow(m);
      check(V.tag + '：judgeNarrow 汇总（四类一次判完）', j.ok, j.bad.join('；') || '四类全部 ≥' + MIN_TOUCH + 'px');
    } else {
      const j = judgeDesktopBase(m);
      check(V.tag + '：桌面基值未被回归（38 / 22 / 无 min-height / 6px 9px）',
        j.ok, j.bad.join('；') || '基值逐条一致');
      check(V.tag + '：桌面档命中区本就 <' + MIN_TOUCH + 'px（这正是需要窄屏规则的原因，不是缺陷）',
        m.guideMinH < MIN_TOUCH && m.rangeMinH < MIN_TOUCH,
        'range ' + m.rangeMinH + 'px / guide ' + m.guideMinH + 'px / ld-quick ' + m.quickH + 'px');
    }

    /* ── 负例只在窄屏 640 档做一次（该档正是新开的带）── */
    if (V.narrow && V.vp.width === 640){
      /* 负例 A（逻辑自检）：不吃页面，纯喂合成值 —— 四类各喂 30px，judge 必须四次都报红。 */
      const viols = [
        ['#env .hint-toggle', { hintLabelH: 30 }],
        ['#env input[type=range]', { rangeMinH: 30 }],
        ['#guide .g-acts button', { guideMinH: 30 }],
        ['#loading #ld-quick', { quickH: 30 }],
      ];
      const notRed = viols.filter((v) => judgeNarrow(Object.assign({}, m, v[1])).ok !== false).map((v) => v[0]);
      check('负例 A（逻辑自检）：四类各喂 30px ⇒ judgeNarrow 必须四次都报红',
        notRed.length === 0, notRed.length ? '未报红：' + notRed.join(' / ') : '4/4 报红');

      /* 负例 B（量测自检）：页内注入 30px !important 后重新量 ——
         证"量测 → 判定"整条链路能看见违规，而不只是判定函数自洽。
         ⚠️ 注入只作用于本 context，紧接着 ctx.close()，不污染其他档。 */
      await page.addStyleTag({ content: '#env .hint-toggle{min-height:30px !important}' +
        '#env .hint-toggle input[type="checkbox"]{width:13px !important;height:13px !important}' +
        '#env input[type="range"]{height:30px !important}' +
        '#guide .g-acts button{min-height:30px !important;padding:0 8px !important}' +
        '#loading #ld-quick{min-height:30px !important;padding:6px 9px !important}' });
      await sleep(250);
      const mInj = await measure(page);
      const jInj = judgeNarrow(mInj);
      check('负例 B（量测自检）：注入 30px 后重新量 ⇒ 判据必须报红（证明不是永真）',
        jInj.ok === false,
        jInj.ok ? '未报红 = 判据永真' : jInj.bad.length + ' 条报红，首条：' + jInj.bad[0]);
    }

    if (V.touch){
      /* ── #stats（Chief 待确认的 3% 余量）：320px 视口量文字渲染宽 vs 可用宽 ── */
      await page.setViewportSize({ width: 320, height: 640 });
      await sleep(400);
      const s = await measureStats(page, STATS_FIXTURE);
      /* 判据：文字占用区间完整落在视口内（左缘 ≥0 且 右缘 ≤视口宽），且实际文字宽 ≤ 可用宽。
         可用 / 盒宽 / 文字宽 / 余量 / 文字左右缘 全打进 detail，供人对表。 */
      check('320px：#stats 放得下（文字占用区间完整落在视口内）', statsFits(s), statsDetail(s));

      /* 负例 C1（量测层）：注入超长文本 —— 实测是**向右**溢出（textLeft 仍是盒左缘 10px），
         所以这条专打"右缘"那把牙。 */
      const sLong = await measureStats(page, '中文测试'.repeat(60));
      check('负例 C1（量测层）：#stats 注入超长文本 ⇒ 溢出判据必须报红（右缘）',
        statsFits(sLong) === false, statsDetail(sLong));

      /* 负例 C2（逻辑层）：Chrome 对超长单行的溢出方向是向右（实测左缘不变）⇒ 左缘那把牙
         靠 C1 抓不到，另喂一个"被推到视口左侧"的合成值单独证它也有牙。
         C1+C2 合起来才说明**两条边都有牙**（与负例 A 同一范式：判定层用合成值钉死）。 */
      const sLeft = Object.assign({}, s, { textLeft: -50 });
      check('负例 C2（逻辑层）：合成"文字左缘 = -50px" ⇒ 溢出判据必须报红（左缘）',
        statsFits(sLeft) === false, statsDetail(sLeft));
    }

    await ctx.close();
  }

  await browser.close();
  /* ⚠️ 必须关掉本地静态服务器再退出（姊妹门都写了这两行）：不关的话事件循环永远有人守着，
     全绿时进程也不退出，verify-all 的 spawnSync 会等到硬超时把它记成红门。 */
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log('\n[touch-target-guard] ' + (failed.length ? 'FAIL' : 'ALL PASS')
    + '（' + results.length + ' 项，' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
  if (failed.length){ console.log('失败项：'); failed.forEach((f) => console.log('  · ' + f.name + (f.detail ? ' — ' + f.detail : ''))); }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('[touch-target-guard] 崩溃:', e); process.exit(2); });
