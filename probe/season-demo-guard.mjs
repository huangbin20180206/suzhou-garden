// 四季自动演示专项门禁：node probe/season-demo-guard.mjs
//
// 只守这条功能自己的风险：默认不自动播放、按钮状态、四季顺序、字幕同步、
// 慢速镜头、任意手动操作立即接管，以及与其他自动模式互斥。
// 日常开发只跑本门；不因为它触发全量 verify。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(30000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'));
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  const state = () => page.evaluate(() => window.__garden.seasonDemoState());
  const btn = () => page.evaluate(() => {
    const b = document.querySelector('[data-act="season-demo"]');
    return b ? { text: b.textContent, pressed: b.getAttribute('aria-pressed'), on: b.classList.contains('on') } : null;
  });
  const caption = () => page.evaluate(() => window.__garden.seasonDemoCaption());

  /* 探针态默认不自动播：否则所有场景探针都会在自动运镜中取样。 */
  await sleep(500);
  const idle = await state();
  check('默认不自动播放（webdriver 下保持手动）',
    !idle.on && idle.phase === 'idle' && idle.history.length === 0,
    `on=${idle.on} phase=${idle.phase}`);
  check('默认不显示节气字幕', !(await caption()).shown, JSON.stringify(await caption()));

  /* 真实用户路径：展开抽屉并点击按钮。 */
  await page.click('#env .drawer-toggle');
  await page.click('[data-act="season-demo"]');
  const started = await state();
  const startedBtn = await btn();
  check('点击按钮启动四季演示', started.on && started.phase === 'flying', `phase=${started.phase}`);
  check('启动后自动收起控制面板（不遮挡电影式画面）',
    !(await page.evaluate(() => document.getElementById('env').classList.contains('expanded'))));
  check('按钮文案/高亮/aria-pressed 同步',
    startedBtn && startedBtn.text.includes('■') && startedBtn.on && startedBtn.pressed === 'true',
    JSON.stringify(startedBtn));
  const firstCaption = await caption();
  check('首季字幕与 ENV.season 同步',
    firstCaption.shown && firstCaption.season === 'spring' && firstCaption.title.includes('春'),
    JSON.stringify(firstCaption));

  await page.keyboard.press('y');
  const stopped = await state();
  check('再点一次停止并收起字幕', !stopped.on && !(await caption()).shown,
    `on=${stopped.on} caption=${(await caption()).shown}`);

  /* 记录字幕变更，验证不是“字幕先换、季节后换”的错位。 */
  await page.evaluate(() => {
    const el = document.getElementById('caption');
    window.__sdCaptionLog = [];
    let last = '';
    new MutationObserver(() => {
      if (!el.classList.contains('show')) return;
      const title = el.querySelector('b').textContent;
      if (title === last) return;
      last = title;
      window.__sdCaptionLog.push({ season: window.__garden.ENV.season, title,
        text: el.querySelector('span').textContent });
    }).observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
  });

  /* 加速参数只用于门禁；用户默认仍是 7 秒飞行 + 3.5 秒停留。 */
  await page.evaluate(() => window.__garden.startSeasonDemo({ flyDur: 0.05, holdDur: 0.06 }));
  const gotCycle = await page.waitForFunction(
    () => window.__garden.seasonDemoState().history.length >= 5,
    null, { timeout: 10000, polling: 50 }).then(() => true).catch(() => false);
  const cycle = await state();
  await page.evaluate(() => window.__garden.stopSeasonDemo('test'));
  check('四季严格按 春→夏→秋→冬→春 循环',
    gotCycle && cycle.history.slice(0, 5).join(',') === 'spring,summer,autumn,winter,spring',
    cycle.history.slice(0, 8).join(' → '));

  const capLog = await page.evaluate(() => window.__sdCaptionLog);
  const capBySeason = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
  const capSync = capLog.length >= 5 && capLog.every(c => c.title.includes(capBySeason[c.season] || '×'));
  check('每次字幕变化时 ENV.season 已同步', capSync,
    capLog.slice(0, 6).map(c => `${c.season}:${c.title}`).join(' | '));

  /* 镜头确实连续移动，不是状态一变就跳到终点。先回 overview，避免上一轮
     春夏秋冬后恰好已停在同一机位，出现"状态在飞、位置没动"的假红。 */
  await page.evaluate(() => window.__garden.gotoViewpoint('overview'));
  await page.waitForFunction(() => !window.__garden.camFlyState().on, null, { timeout: 5000 });
  await page.evaluate(() => window.__garden.startSeasonDemo({ flyDur: 0.5, holdDur: 0.05 }));
  await page.waitForFunction(() => window.__garden.camFlyState().on, null, { timeout: 5000 });
  const camA = await page.evaluate(() => window.__garden.camera.position.toArray());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const camB = await page.evaluate(() => window.__garden.camera.position.toArray());
  const moved = Math.hypot(camB[0] - camA[0], camB[1] - camA[1], camB[2] - camA[2]);
  check('慢速镜头持续推进（至少两帧发生位移）', moved > 0.005, `两帧位移=${moved.toFixed(4)}m`);

  /* 画布 pointerdown 立即接管：状态、飞行、字幕全停，季节不再自行推进。 */
  await page.evaluate(() => window.__garden.renderer.domElement.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' })));
  const taken = await state();
  const seasonAtTakeover = await page.evaluate(() => window.__garden.ENV.season);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const seasonAfter = await page.evaluate(() => window.__garden.ENV.season);
  check('画布操作立即中断演示与相机飞行',
    !taken.on && !(await page.evaluate(() => window.__garden.camFlyState().on))
      && !(await caption()).shown && await page.evaluate(() => window.__garden.controls.enabled),
    `on=${taken.on} phase=${taken.phase}`);
  check('中断后季节不再自行推进', seasonAfter === seasonAtTakeover,
    `${seasonAtTakeover} → ${seasonAfter}`);

  /* 普通按键也属于用户接管；Y 是控制键本身，不能在 capture 阶段先停掉再重开。 */
  await page.evaluate(() => window.__garden.startSeasonDemo({ flyDur: 0.2, holdDur: 0.05 }));
  await page.keyboard.press('b');
  check('普通按键立即接管四季演示', !(await state()).on);

  /* 手动季节按钮：先停演示，再执行用户选择。画布接管会自动收起抽屉，
     所以这里先恢复面板，再走真实点击路径。 */
  await page.evaluate(() => window.__garden.startSeasonDemo({ flyDur: 0.2, holdDur: 0.05 }));
  await page.click('#env .drawer-toggle');
  await page.click('[data-axis="season"][data-v="summer"]');
  const manual = await state();
  check('点季节按钮 = 接管并切到用户指定季节',
    !manual.on && await page.evaluate(() => window.__garden.ENV.season) === 'summer',
    `on=${manual.on} season=${await page.evaluate(() => window.__garden.ENV.season)}`);

  /* 面板里的非控制按钮同样属于手动操作：先收字幕/停演示，再执行按钮本意。 */
  await page.evaluate(() => window.__garden.startSeasonDemo({ flyDur: 0.2, holdDur: 0.05 }));
  await page.click('#env .drawer-toggle');
  await page.click('[data-act="sound"]');
  check('演示中点面板其他按钮会立即接管', !(await state()).on);

  /* 随机场景与昼夜流转都必须先抢回控制权。 */
  await page.evaluate(() => window.__garden.startSeasonDemo({ flyDur: 0.2, holdDur: 0.05 }));
  await page.evaluate(() => window.__garden.randomScene());
  check('“偶得”会停止四季演示', !(await state()).on);

  await page.evaluate(() => window.__garden.startSeasonDemo({ flyDur: 0.2, holdDur: 0.05 }));
  const reelOn = await page.evaluate(() => { window.__garden.toggleReel(); return window.__garden.REEL.on; });
  check('启动昼夜流转会互斥停止四季演示', reelOn && !(await state()).on);
  await page.evaluate(() => window.__garden.toggleReel());

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[season-demo-guard] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[season-demo-guard] 探针异常：', e); process.exit(2); });
