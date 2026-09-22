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
import { launchChromium } from './_harness.mjs';
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

(async () => {
  const t0 = Date.now();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[reel-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(1200);

  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 40000, polling: 200 }).then(() => true).catch(() => false);
  const shot = async (name) => {
    const b = await page.screenshot();
    if (name) fs.writeFileSync(path.join(OUT, name + '.png'), b);
    return decodePNG(b);
  };
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
  }, { timeout: 5000, polling: 50 }).then(() => true).catch(() => false);
  check('抽屉展开（visibility 带 transition，须轮询到位）', panelVisible);

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
  const diff = meanAbsDiff(shotA, shotB);
  check('画面随流转实时更新（不是只改了数值）',
    diff > Math.max(1.2, idleBase * 1.5),
    `diff=${diff.toFixed(3)} vs 阈值 ${Math.max(1.2, idleBase * 1.5).toFixed(3)}（idleBase=${idleBase.toFixed(3)}）`);
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
