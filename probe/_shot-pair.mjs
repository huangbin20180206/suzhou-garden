/* 取一对「切暴雨前/后」的干净样张，专供修复前后对比图使用。
 *
 * 与 pageerror-guard 里的样张不同：那两张是**抽屉展开**状态下截的（探针要顺带验 UI 命中），
 * 用作对比图会与修复前的旧样张（抽屉收起、1180×720）构图不一致 —— 对比要同机位、同视口、
 * 同 UI 状态才有说服力。这里固定 1180×720 + 不碰抽屉。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'pageerror-guard');
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(1500);

  /* 与修复前旧样张同一组条件：正午 · 夏 · 风调雨顺，机位为默认（两边都不动相机） */
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 40000, polling: 200 }).catch(() => {});
  await sleep(900);
  fs.writeFileSync(path.join(OUT, 'A-clear-clean.png'), await page.screenshot());

  await page.evaluate(() => window.__garden.setEnv('weather', 'storm'));
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 40000, polling: 200 }).catch(() => {});
  await sleep(900);
  fs.writeFileSync(path.join(OUT, 'B-storm-clean.png'), await page.screenshot());

  console.log(`已生成 A-clear-clean.png / B-storm-clean.png（1180×720，抽屉收起）｜ pageerror=${errs.length}`);

  await browser.close();
  server.close();
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
