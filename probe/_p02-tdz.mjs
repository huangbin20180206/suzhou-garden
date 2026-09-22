// 一次性诊断（未入链）：把启动期 pageerror 的**完整栈**打出来。
// 为什么需要它：smoke 只打印 e.message，而 "X is not defined" / "Cannot access 'X' before initialization"
// 这类消息**不带文件行号** —— 十几个 src 模块里到底谁在顶层读了谁，靠猜是猜不出来的（实测猜了两轮都错）。
// 用法: node probe/_p02-tdz.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 本地没有，走全局 */ }
  const globalRoot = require('node:child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
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
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
let errCount = 0;
page.on('pageerror', e => {
  if (++errCount > 3) return;                  // 循环里每帧都报，只留前几条
  console.log('── pageerror ──');
  console.log(e.stack || e.message);
});
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
console.log('__garden ready =', await page.evaluate(() => !!window.__garden));
await browser.close();
server.close();
