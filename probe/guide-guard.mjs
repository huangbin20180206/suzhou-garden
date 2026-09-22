// 首次引导门禁：node probe/guide-guard.mjs
//
// 守的是「三步气泡引导」本身，以及**它对别的门禁是否无害**。
//
// 引导层是全屏 z-index:8 的覆盖物 —— 这类东西最典型的破坏方式不是自己坏，
// 而是**把别人的点击吃掉**：pageerror-guard 要真实点 #env 的按钮、smoke 要量 320px 的
// 面板矩形，一旦气泡压在上面，那边就会超时/溢出，而这边看起来"什么都没改"。
// 所以本门一半的判据在验「它有没有挡路」：
//   · 容器 pointer-events:none（非模态）
//   · 气泡不压住 #env 锚点（探针第一个要点的元素）
//   · 首次 pointerdown / wheel / keydown 即消失
//   · 320px 下不产生横向溢出
//   · 它的按钮不在 #env 内（否则 smoke 的 aria-pressed / 命中区断言会红）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

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

(async () => {
  const t0 = Date.now();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  /* ⚠️ 必须带 `?guide=1`：引导在**被自动化驱动时默认不自动弹**（`navigator.webdriver`），
     否则那块固定压在画面顶部的深色气泡会被 mist-guard / lamp-guard / reel-guard 这些
     量像素的门禁当成画面的一部分采进去（实测污染出过 +23 的假红）。
     本门要验的正是"真实用户会走的那条自动弹路径"，所以用 URL 参数显式放行。 */
  console.log(`\n[guide-guard] http://127.0.0.1:${port}/index.html?guide=1`);
  await page.goto(`http://127.0.0.1:${port}/index.html?guide=1`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(900);

  const st = () => page.evaluate(() => window.__garden.guideState());

  /* ── 1. 首次进来自动出现 ── */
  const s0 = await st();
  check('首次进入：引导自动出现且停在第 1 步',
    s0.on === true && s0.i === 0 && s0.steps === 3, JSON.stringify(s0));

  /* ── 1b. 反向对照：不带参数时**必须不弹**（否则污染量像素的门禁）── */
  const page2 = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page2.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page2.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(900);
  const s2 = await page2.evaluate(() => ({
    driven: window.__garden.probeDriven, on: window.__garden.guideState().on,
  }));
  await page2.close();
  check('反向对照：自动化下不带 ?guide=1 时**不弹**（气泡不能污染量像素的门禁）',
    s2.driven === true && s2.on === false, JSON.stringify(s2));

  /* ── 2. 非模态：容器不吃事件，气泡才吃 ── */
  const pe = await page.evaluate(() => {
    const g = document.getElementById('guide');
    const bub = g.querySelector('.g-bubble');
    return { container: getComputedStyle(g).pointerEvents, bubble: getComputedStyle(bub).pointerEvents };
  });
  check('引导容器非模态（pointer-events:none，不吃画布与面板的点击）',
    pe.container === 'none', `容器=${pe.container}`);
  check('只有气泡自己接管点击（否则「下一步」点不到）',
    pe.bubble === 'auto', `气泡=${pe.bubble}`);

  /* ── 3. 气泡不压住 #env 锚点（探针第一个要点的元素）── */
  const overlap = await page.evaluate(() => {
    const bub = document.querySelector('#guide .g-bubble').getBoundingClientRect();
    const env = document.querySelector('#env .drawer-toggle').getBoundingClientRect();
    const hit = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    /* 用锚点中心点做 elementFromPoint，最直接地回答"这一下会点到谁" */
    const cx = env.left + env.width / 2, cy = env.top + env.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { hit: hit(bub, env), topIsEnv: !!(top && top.closest && top.closest('#env')),
             topTag: top ? (top.className || top.tagName) : 'null' };
  });
  check('气泡矩形不与 #env 锚点相交', overlap.hit === false, `相交=${overlap.hit}`);
  check('点击 #env 锚点中心命中的仍是 #env（没被引导层吃掉）',
    overlap.topIsEnv === true, `命中=${overlap.topTag}`);

  /* ── 4. 三步走完并自动收起 ── */
  const titles = [];
  for (let k = 0; k < 3; k++) {
    titles.push(await page.evaluate(() => document.querySelector('#guide .g-bubble b').textContent));
    if (k < 2) {
      await page.click('#guide button[data-g="next"]');
      await sleep(320);
    }
  }
  check('三步标题都在（壹/贰/叁）', titles.every(t => /^[壹贰叁]/.test(t)), titles.join(' | '));
  const s3 = await st();
  check('最后一步按钮文案变成「知道了」',
    (await page.evaluate(() => document.querySelector('#guide button[data-g="next"]').textContent)) === '知道了');
  await page.click('#guide button[data-g="next"]');
  await sleep(320);
  const sEnd = await st();
  check('走完三步自动收起', sEnd.on === false, JSON.stringify(sEnd));
  check('收起后写 localStorage（下次不再弹）',
    (await page.evaluate(() => { try { return localStorage.getItem('garden.guided.v1'); } catch { return null; } })) === '1');

  /* ── 5. 跳过：一步就收 ── */
  await page.evaluate(() => window.__garden.guideStart());
  await sleep(260);
  await page.click('#guide button[data-g="skip"]');
  await sleep(260);
  check('「跳过」一步收起', (await st()).on === false);

  /* ── 6. 首次交互即消失（三种输入各验一次）── */
  for (const [how, act] of [
    ['pointerdown', async () => { await page.mouse.click(450, 300); }],
    ['wheel',       async () => { await page.mouse.wheel(0, 120); }],
    ['keydown',     async () => { await page.keyboard.press('KeyQ'); }],
  ]) {
    await page.evaluate(() => window.__garden.guideStart());
    await sleep(220);
    const before = (await st()).on;
    await act();
    await sleep(220);
    const after = (await st()).on;
    check(`引导显示中遇到${how}即消失`, before === true && after === false, `${before}→${after}`);
  }

  /* ── 7. 320px 窄屏不溢出，且按钮不在 #env 内 ── */
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => window.__garden.guideStart());
  await sleep(400);
  const mob = await page.evaluate(() => {
    const bub = document.querySelector('#guide .g-bubble').getBoundingClientRect();
    const btns = [...document.querySelectorAll('#guide .g-bubble button')];
    return {
      sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      right: bub.right, left: bub.left,
      minH: Math.min(...btns.map(b => b.getBoundingClientRect().height)),
      inEnv: btns.some(b => !!b.closest('#env')),
    };
  });
  check('320px 窄屏：引导气泡不产生横向溢出',
    mob.sw <= 320 && mob.left >= 0 && mob.right <= 320,
    `scrollWidth=${mob.sw} 气泡 ${Math.round(mob.left)}~${Math.round(mob.right)}`);
  check('引导按钮命中区 ≥38px', mob.minH >= 38, `minH=${Math.round(mob.minH)}`);
  check('引导按钮不在 #env 内（否则 smoke 的 aria-pressed 断言会红）', mob.inEnv === false);

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n[guide-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[guide-guard] 崩溃:', e); process.exit(2); });
