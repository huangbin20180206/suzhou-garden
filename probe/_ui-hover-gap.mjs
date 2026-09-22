// 复现：鼠标"从方印滑到面板按钮"的真实路径，是否踩到面板与方印之间的空隙而被自动收起
// 判据：分步移动（模拟真人）之后面板是否还开着 —— Playwright 的 page.click 是瞬移，抓不到这个缺陷
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000, polling: 300 });
  await sleep(1000);

  const geom = await page.evaluate(() => {
    const r = s => { const b = document.querySelector(s).getBoundingClientRect();
                     return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    return { toggle: r('#env .drawer-toggle'), storm: r('#env button[data-v="storm"]') };
  });

  /* 用真实鼠标点击方印展开 */
  await page.mouse.click(geom.toggle.x, geom.toggle.y);
  await sleep(700);
  const open1 = await page.evaluate(() => document.getElementById('env').classList.contains('expanded'));
  console.log(`展开后 expanded=${open1}`);
  console.log(`方印中心=(${Math.round(geom.toggle.x)},${Math.round(geom.toggle.y)}) 方印顶边=${Math.round(geom.toggle.top)}`);
  console.log(`狂风暴雨中心=(${Math.round(geom.storm.x)},${Math.round(geom.storm.y)}) 面板底边=${Math.round(geom.storm.bottom + 12)}`);

  /* ── 关键：分步慢移到按钮（真人路径），中途检查 expanded ── */
  const trace = [];
  const start = { x: geom.toggle.x, y: geom.toggle.y };
  const end = { x: geom.storm.x, y: geom.storm.y };
  const N = 30;
  await page.mouse.move(start.x, start.y);
  await sleep(60);
  for (let i = 1; i <= N; i++) {
    const x = start.x + (end.x - start.x) * i / N;
    const y = start.y + (end.y - start.y) * i / N;
    await page.mouse.move(x, y);
    if (i % 6 === 0) {
      await sleep(90);
      const st = await page.evaluate((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return { open: document.getElementById('env').classList.contains('expanded'),
                 hit: el ? `${el.tagName}#${el.id || ''}.${el.className || ''}` : 'null' };
      }, { x, y });
      trace.push(`   步${String(i).padStart(2)} (${Math.round(x)},${Math.round(y)}) expanded=${st.open} 命中=${st.hit}`);
    }
  }
  await sleep(500);   // 超过 300ms 自动收起延迟
  const openAfterPath = await page.evaluate(() => document.getElementById('env').classList.contains('expanded'));

  console.log('\n── 鼠标迁移轨迹 ──');
  for (const t of trace) console.log(t);
  console.log(`\n滑到按钮后（+500ms）expanded = ${openAfterPath}`);

  /* 此刻按钮还能点吗 */
  let clickErr = '';
  try { await page.click('#env button[data-v="storm"]', { timeout: 5000 }); } catch (e) { clickErr = String(e.message).split('\n')[0]; }
  await sleep(500);
  const weather = await page.evaluate(() => window.__garden.ENV.weather);
  console.log(`随后点击"狂风暴雨"：${clickErr ? '✗ ' + clickErr : '✓ 已派发'} → ENV.weather=${weather}`);

  console.log(`\n结论：${(!openAfterPath) ? '❌ 复现 —— 滑移途中面板被自动收起（这就是"点了没反应"）' : '✔ 未复现，面板滑移中保持展开'}`);
  await browser.close();
  server.close();
})();
