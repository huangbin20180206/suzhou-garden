// 时光流转门禁：node probe/reel-guard.mjs
//
// 守"按一下流转，画面自己从晨走到夜"这条链路。三条判据缺一不可：
//   ① ENV.hour 真的在推进（且速度符合 0.4 h/s ≈ 一整天 60 秒）；
//   ② **画面真的跟着动** —— 这条最关键。本项目 animate 的 applyEnv 只在
//      `ENV.t < 1` 的过渡分支里被调用，所以"改了 ENV.hour 但没人重申画面"
//      是完全可能的静默失效（与 pageerror-guard 守的同类症状）。用像素差守死。
//   ③ UI 同步 + 接管语义：滑杆跟随、按钮文案切换、拖滑杆/点时段按钮都能把流转停下。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
import { decodePNG, meanAbsDiff } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'reel-guard');
fs.mkdirSync(OUT, { recursive: true });

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

/* 自检模式（2026-10-13 新增）：REEL_GUARD_SELFCHECK=1 时，主流程跑完后注入缺陷态，
   要求「画面随流转实时更新」那条判据必须**报红** —— 用来证明判据有牙、不是恒绿。
   不设该变量时行为与改动前完全一致（自检段整段跳过）。 */
const SELFCHECK = process.env.REEL_GUARD_SELFCHECK === '1';

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[reel-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 120000, polling: 300 });
  await sleep(1200);

  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    null, { timeout: 40000, polling: 200 }).then(() => true).catch(() => false);
  const shot = async (name) => {
    const b = await page.screenshot();
    if (name) fs.writeFileSync(path.join(OUT, name + '.png'), b);
    return decodePNG(b);
  };
  /* 本门「画面是否跟着时辰走」的统计量（2026-10-13 换掉逐像素平均差）：
     |mean(A) − mean(B)|，且只取画面**下 1/3**（行 [h·2/3, h)）。
     · 为什么用均值差、不是逐像素平均差：逐像素平均差 = Σ|Δ像素|/N，把每一处**局部重排**
       （风掀树叶、水面涟漪、锦鲤摆尾）都算成"画面变了"，阵风一来阈值就被顶飞 ——
       实测同一台机器两轮之间能差 10 倍（0.295 ↔ 3.223）⇒ 空载可绿、满载必红。
       均值差里局部重排正负抵消、留不下痕迹；而流转改的是**整体光照**（太阳/环境/天空/雾/曝光），
       是全局量，必然把均值推走。判据要盯的正是"整体有没有跟着时辰走"。
     · 每像素取 RGB 三通道平均后再对全画面求均值；decodePNG 的 bpp 可能是 3 或 4，按它步进。 */
  const frameMean = (im) => {
    const st = im.bpp || 3; const d = im.data; let s = 0, n = 0;
    for (let i = 0; i + 2 < d.length; i += st) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    return s / n;
  };
  const meanShift = (a, b) => Math.abs(frameMean(a) - frameMean(b));

  const reelOn  = () => page.evaluate(() => window.__garden.REEL.on);
  const hourNow = () => page.evaluate(() => window.__garden.ENV.hour);
  const slider  = () => page.evaluate(() => parseFloat(document.getElementById('hourSlider').value));
  const btnText = () => page.evaluate(() => {
    const b = document.querySelector('button[data-act="reel"]'); return b ? b.textContent : '';
  });

  /* 起点固定在早晨 7:30 —— 之后 3 秒推进约 1.2 小时，不会跨过 24 点回绕 */
  await page.evaluate(() => window.__garden.setEnv('time', 'morning'));
  await settled(); await sleep(600);

  /* 同状态两帧基线：用来判断"画面变化"是否远超风吹草动的量级 */
  const idleA = await shot('idle-1');
  await sleep(500);
  const idleB = await shot('idle-2');
  const idleBase = meanAbsDiff(idleA, idleB);
  check('活性基线（不流转时画面也在动：风/锦鲤/涟漪）', idleBase > 0.05, `idleBase=${idleBase.toFixed(3)}`);

  /* ── 真实点击「流转▸」开启 ── */
  await page.click('#env .drawer-toggle');
  const panelVisible = await page.waitForFunction(() => {
    const s = getComputedStyle(document.querySelector('#env .drawer-content'));
    return s.visibility === 'visible' && Number(s.opacity) > 0.9;
  }, null, { timeout: 5000, polling: 50 }).then(() => true).catch(() => false);
  check('抽屉展开（visibility 带 transition，须轮询到位）', panelVisible);

  /* 噪声底：**3 个独立**的 3.0s 闲置窗口，取中位 —— 专供下面那条流转判据的分母。
     · 间隔必须与流转窗口一致（3.0s）：分子分母不同长度时阈值不可比。
     · 统计量必须是 |全屏均值差|，不是逐像素平均差。逐像素平均差把每一处局部重排
       都算成"画面变了"：实测同一台机器两轮之间能差 10 倍（0.295 ↔ 3.223），
       阵风一来阈值就被顶飞 ⇒ 空载可绿、满载必红。均值差对局部运动不敏感。
       （离线验算：同一批帧上逐像素平均差的 信号/噪声 = 0.63×，均值差 = 16.25×）
     · 采点选在「抽屉已展开、流转未开」：与 shotA/shotB 的 UI 状态一致。
     上面 0.5s 的 idleA/idleB/idleBase 用的是逐像素平均差，**保持原样不动** ——
     那条断言要证明的是"闲置时画面确实在动"，逐像素才敏感，均值差会把它抹平。 */
  const idleShift3s = [];
  for (let i = 1; i <= 3; i++) {
    const wa = await shot(`idle-3s-${i}a`);
    await sleep(3000);
    const wb = await shot(`idle-3s-${i}b`);
    idleShift3s.push(meanShift(wa, wb));
  }
  const idleBase3 = [...idleShift3s].sort((x, y) => x - y)[1];      // n=3 → 中位
  console.log(`[reel-guard] 3s 闲置噪声底（|全屏均值差|）三次读数：${idleShift3s.map(v => v.toFixed(4)).join(' / ')} → 取中位 idleBase3=${idleBase3.toFixed(4)}`);
  check('活性基线·3s 对照（三窗口中位；应远低于 0.5 绝对下限，说明均值差确实对局部运动不敏感）',
    idleBase3 < 0.5,
    `三读数 ${idleShift3s.map(v => v.toFixed(4)).join(' / ')}，中位=${idleBase3.toFixed(4)}（对照：逐像素口径 idleBase=${idleBase.toFixed(3)}）`);

  await page.click('button[data-act="reel"]');
  check('点击「流转▸」开启时光流转', await reelOn() === true);
  check('按钮文案切为「流转■」', (await btnText()).includes('■'), await btnText() || '(空)');

  const h0 = await hourNow();
  const shotA = await shot('reel-t0');
  await sleep(3000);
  const h1 = await hourNow();
  const shotB = await shot('reel-t3');

  const dh = (h1 - h0 + 24) % 24;                  // 防回绕
  check('ENV.hour 持续推进', dh > 0.5, `${h0.toFixed(2)} → ${h1.toFixed(2)}（+${dh.toFixed(2)}h）`);
  check('推进速度 ≈0.4h/s（一整天约 60 秒）', dh > 0.8 && dh < 1.9, `3 秒推进 ${dh.toFixed(2)} 小时`);
  const diff = meanShift(shotA, shotB);
  /* ⚠️ 绝对下限 **1.2 → 0.5**（2026-10-13，Chief 裁决）：1.2 是**旧统计量**（逐像素平均差）
     标定出来的绝对值，直接搬到「|全屏均值差|」上是苹果对橘子 —— 两个统计量的量纲不同。
     1.2 是随统计量一起**重新标定**的，不是为了让门变绿而调低：
       · 新统计量的实测噪声**上界** = 0.0807（三次正常跑里最大的单次 3s 读数）
         ⇒ 0.5 = **6.2×** 噪声上界，门对局部运动仍然免疫；
       · 新统计量的实测信号 = 1.065~1.118（三次正常跑，离散 < 5%）
         ⇒ 0.5 约为信号的**一半**，两侧都留了余量；
       · 缺陷态（画布定格、只有 DOM 在动）实测 0.0426 ⇒ 远低于 0.5，判据**仍然有牙**。
     ×1.5 倍数与 Math.max(...) 结构不动。 */
  check('画面随流转实时更新（不是只改了数值）',
    diff > Math.max(0.5, idleBase3 * 1.5),
    `diff=${diff.toFixed(3)} vs 阈值 ${Math.max(0.5, idleBase3 * 1.5).toFixed(3)}（统计量=|全屏均值差|，绝对下限 0.5；3 窗口噪声底中位 idleBase3=${idleBase3.toFixed(4)}）`);
  check('时辰滑杆跟随流转', Math.abs((await slider()) - h1) < 0.35,
    `滑杆=${(await slider()).toFixed(2)} hour=${h1.toFixed(2)}`);

  /* ── 关闭 ── */
  await page.click('button[data-act="reel"]');
  check('再点一次关闭流转', await reelOn() === false);
  check('按钮文案切回「流转▸」', (await btnText()).includes('▸'), await btnText() || '(空)');
  const h2 = await hourNow();
  await sleep(1200);
  const h3 = await hourNow();
  check('关闭后 hour 停止推进', Math.abs(h3 - h2) < 0.02, `${h2.toFixed(3)} → ${h3.toFixed(3)}`);

  /* ── 接管语义：任何手动干预都应把流转停下 ── */
  await page.click('button[data-act="reel"]');                       // 开
  await page.evaluate(() => {
    const hs = document.getElementById('hourSlider');
    hs.value = '15';
    hs.dispatchEvent(new Event('input', { bubbles: true }));
  });
  check('拖时辰滑杆 = 接管，流转自动停', await reelOn() === false);

  await page.click('button[data-act="reel"]');                       // 再开
  await settled();
  await page.click('button[data-axis="time"][data-v="noon"]');
  await settled();
  check('点时段按钮 = 接管，流转自动停', await reelOn() === false);

  /* ── 快捷键 ── */
  await page.keyboard.press('l');
  check('快捷键 L 可开启流转（R 已被「冬」占用）', await reelOn() === true);
  await page.keyboard.press('l');
  check('快捷键 L 可关闭流转', await reelOn() === false);

  /* ── 自检模式（默认整段跳过）· 缺陷态注入，证明上面那条判据**有牙** ──
     缺陷态 = 本门 ② 要防的那个静默失效：ENV.hour 自己往前走，但没人再重申画面，
     数值在动、画面定格 —— src/11-loop.js:946-947 的注释说的就是它。
     注入手法（纯探针侧，一行 src/ 都不碰）：把 window.__garden.composer.render
     换成空函数。渲染循环 src/11-loop.js:1390 每帧做 `composer.render()` **属性查找**，
     覆盖即生效 ⇒ 画布定格在最后一帧；而 :948 的 advanceReel 照跑、ENV.hour 照走。
     量完立刻还原 composer.render，并断言「hour 仍在推进」——否则就变成了"整个循环停了"，
     那是另一种缺陷，证明不了这条判据盯的是"画面跟不跟得上"。 */
  if (SELFCHECK) {
    console.log('\n[reel-guard] 自检模式：注入缺陷态「画面定格、hour 照走」，要求本条判据报红');
    await page.click('button[data-act="reel"]');                 // 先开流转，处在真实工作态
    await sleep(600);
    const injected = await page.evaluate(() => {
      const c = window.__garden.composer;
      if (!c || typeof c.render !== 'function') return false;
      window.__reelSavedRender = c.render;                      // 留档，量完立刻还原
      c.render = () => {};                                      // 画布定格
      return true;
    });
    check('自检·缺陷注入成功（composer.render 已替换为空函数）', injected);
    const dH0 = await hourNow();
    const dShotA = await shot('selfcheck-defect-t0');
    await sleep(3000);
    const dH1 = await hourNow();
    const dShotB = await shot('selfcheck-defect-t3');
    const dDh = (dH1 - dH0 + 24) % 24;                          // 防回绕
    check('自检·缺陷态下 ENV.hour 仍在推进（注入的是"画面不动"，不是"整个循环停了"）',
      dDh > 0.5, `${dH0.toFixed(2)} → ${dH1.toFixed(2)}（+${dDh.toFixed(2)}h）`);
    const defectDiff = meanShift(dShotA, dShotB);
    const defectThr = Math.max(0.5, idleBase3 * 1.5);           // 与上面那条同一阈值、同一分母
    check('自检·缺陷态被判红（判据有牙、不是恒绿）', defectDiff <= defectThr,
      `缺陷态 diff=${defectDiff.toFixed(3)} ≤ 阈值 ${defectThr.toFixed(3)} ⇒ 判红（同一判据在正常态是绿的）`);
    await page.evaluate(() => {
      const c = window.__garden.composer;
      c.render = window.__reelSavedRender;
      delete window.__reelSavedRender;
    });
    await page.click('button[data-act="reel"]');                 // 收尾：关掉流转
  }

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n[reel-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[reel-guard] 崩溃:', e); process.exit(2); });
