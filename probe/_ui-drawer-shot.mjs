// 一次性视觉/几何探针：抽屉式控制面板（左下角方印 + 向上弹出面板）
// 不入门禁链（probe/_ 前缀 = 临时取证脚本），样张落 outputs/_diag/ui-drawer/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'ui-drawer');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 本地没有，走全局 */ }
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

const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const check = (name, ok, detail = '') => { out.push(!!ok); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`); };
const r2 = n => Math.round(n * 100) / 100;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000, polling: 300 });
  await sleep(1200);

  const rect = sel => page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height,
             vis: cs.visibility, op: cs.opacity };
  }, sel);

  /* ── 收起态 ── */
  const envRect  = await rect('#env');
  const tgRect   = await rect('#env .drawer-toggle');
  const contentClosed = await rect('#env .drawer-content');
  const beforeContent = await page.evaluate(
    () => getComputedStyle(document.getElementById('env'), '::before').content);
  await page.screenshot({ path: path.join(OUT, '01-collapsed.png') });

  check('收起态：#env 锚点尺寸 = 方印（48×48，不吃画布）',
        envRect.w <= 50 && envRect.h <= 50, `env ${r2(envRect.w)}×${r2(envRect.h)}`);
  check('收起态：方印钉在左下角（left≈22, bottom≈18）',
        envRect.l < 40 && (720 - envRect.b) < 40, `left=${r2(envRect.l)} bottomGap=${r2(720 - envRect.b)}`);
  check('收起态：面板不可见（visibility:hidden）',
        contentClosed.vis === 'hidden', `visibility=${contentClosed.vis}`);
  check('收起态：无多余装饰横线（#env::before 已移除）',
        beforeContent === 'none' || beforeContent === '' || beforeContent === 'normal',
        `content=${beforeContent}`);

  /* ── 展开态 ── */
  await page.click('#env .drawer-toggle');
  await sleep(700);
  const envRect2 = await rect('#env');
  const tgRect2  = await rect('#env .drawer-toggle');
  const panel    = await rect('#env .drawer-content');
  const rows     = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('#env .row')];
    return rs.map(r => { const b = r.getBoundingClientRect(); return { t: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) }; });
  });
  await page.screenshot({ path: path.join(OUT, '02-expanded.png') });

  check('展开态：面板 visible 且不透明',
        panel.vis === 'visible' && Number(panel.op) > 0.9, `visibility=${panel.vis} opacity=${panel.op}`);
  check('展开态：面板在方印**上方**（向上弹出）',
        panel.b <= tgRect2.t + 1, `panelBottom=${r2(panel.b)} vs 方印top=${r2(tgRect2.t)}`);
  check('展开态：方印位置未被面板推走（仍钉在左下角）',
        Math.abs(envRect2.l - envRect.l) < 1 && Math.abs(envRect2.b - envRect.b) < 1,
        `left ${r2(envRect.l)}→${r2(envRect2.l)}`);
  check('展开态：6 行全部铺开且不发生纵向重叠',
        rows.length === 6 && rows.every((r, i) => i === 0 || r.t >= rows[i-1].t + rows[i-1].h - 1),
        `rows=${rows.length}`);
  check('展开态：面板整体收在视口内（无横向溢出）',
        panel.l >= 0 && panel.r <= 1180 && panel.t >= 0,
        `l=${r2(panel.l)} r=${r2(panel.r)} t=${r2(panel.t)}`);

  /* ── 桌面：鼠标移开自动收起 ── */
  await page.mouse.move(700, 400);
  await sleep(800);
  const afterLeave = await page.evaluate(() => document.getElementById('env').classList.contains('expanded'));
  check('桌面：鼠标移开后自动收起（300ms）', afterLeave === false, `expanded=${afterLeave}`);

  /* ── 点面板之外收起 ── */
  await page.click('#env .drawer-toggle');
  await sleep(500);
  const openAgain = await page.evaluate(() => document.getElementById('env').classList.contains('expanded'));
  await page.mouse.click(760, 380);
  await sleep(300);
  const afterOutside = await page.evaluate(() => document.getElementById('env').classList.contains('expanded'));
  check('点面板之外收起', openAgain === true && afterOutside === false, `open=${openAgain} → outside=${afterOutside}`);

  /* ── 拖滑块移出面板：不误收 ──
     时辰滑杆在面板内部，拖动时指针必然越过面板边界 → 会触发 mouseleave。
     若没有 pressing 保护，面板会在拖动中途消失（功能可用性受损，且不报错）。 */
  await page.click('#env .drawer-toggle');
  await sleep(500);
  const sb = await page.locator('#hourSlider').boundingBox();
  await page.mouse.move(sb.x + sb.width * 0.4, sb.y + sb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height * 0.5, { steps: 4 });
  await page.mouse.move(900, 380, { steps: 8 });        // 拖到面板之外
  await sleep(900);
  const duringDrag = await page.evaluate(() => document.getElementById('env').classList.contains('expanded'));
  const hourMoved = await page.evaluate(() => Number(document.getElementById('hourSlider').value));
  await page.mouse.up();
  check('拖动滑块移出面板时不误收（面板仍在）', duringDrag === true, `expanded=${duringDrag}`);
  check('拖动确实改到了时辰值（滑杆未被面板收起打断）', hourMoved !== 12.5, `hour=${hourMoved}`);

  /* ── 窄屏 320×640：面板不横向溢出、锚点没被拉成通栏 ── */
  await page.setViewportSize({ width: 320, height: 640 });
  await sleep(500);
  await page.click('#env .drawer-toggle');
  await sleep(700);
  const mob = await page.evaluate(() => {
    const env = document.getElementById('env').getBoundingClientRect();
    const pr = document.querySelector('#env .drawer-content').getBoundingClientRect();
    return { envW: env.width, panel: { l: pr.left, r: pr.right, t: pr.top, b: pr.bottom, w: pr.width, h: pr.height },
             scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
             btns: [...document.querySelectorAll('#env button')].map(b => b.getBoundingClientRect().height) };
  });
  await page.screenshot({ path: path.join(OUT, '03-mobile-expanded.png') });
  check('窄屏 320px：展开面板不横向溢出（右缘 ≤ 320 且 scrollWidth ≤ 320）',
        mob.panel.r <= 320 && mob.scrollW <= 320, `panelR=${r2(mob.panel.r)} scrollW=${mob.scrollW}`);
  check('窄屏 320px：锚点仍是方印（没被拉成通栏）', mob.envW <= 50, `envW=${r2(mob.envW)}`);
  check('窄屏 320px：面板纵向收在视口内', mob.panel.t >= 0 && mob.panel.b <= 640,
        `t=${r2(mob.panel.t)} b=${r2(mob.panel.b)}`);
  check('窄屏 320px：按钮命中区仍 ≥38px', Math.min(...mob.btns) >= 38,
        `minH=${Math.round(Math.min(...mob.btns))}`);

  console.log(`\n样张：${OUT}\\01-collapsed.png / 02-expanded.png / 03-mobile-expanded.png`);
  console.log(out.every(Boolean) ? '\n[ui-drawer] ALL PASS' : '\n[ui-drawer] FAIL');
  await browser.close();
  server.close();
  process.exit(out.every(Boolean) ? 0 : 1);
})();
