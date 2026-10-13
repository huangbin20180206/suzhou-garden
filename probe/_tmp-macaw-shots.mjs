// 临时截图探针（不注册 verify-all）：金刚鹦鹉换峰飞行三帧 + 西落点默认机位
// 每帧截图前在页面上按鹦鹉 holder 的投影位置叠 DOM 标注框（红框+模式标签）
// 用法：node probe/_tmp-macaw-shots.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'macaw-west-flight');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/webmanifest' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading') && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.evaluate(() => { const G = window.__garden; G.setEnv('season', 'summer'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 注入标注层：按三只 holder 的世界坐标投影到屏幕，画红框 + 模式/坐标标签
  await page.evaluate(() => {
    if (document.getElementById('macaw-mark')) return;
    const d = document.createElement('div');
    d.id = 'macaw-mark';
    d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
    document.body.appendChild(d);
    const G = window.__garden;
    window.__markTick = () => {
      d.innerHTML = '';
      const w = innerWidth, h = innerHeight;
      for (const m of G.macawState()){
        // macawState 给 base；holder 实际位置从 THREE 树里按名字取
        let pos = null;
        G.scene.traverse(o => { if (o.name === 'Macaw' && !o.userData.__mk && pos === null) { /* 占位 */ } });
        // 直接用 base + lift 不足以定位飞行中位置 ⇒ 改为读 holder 真实位置
        // （m.at 是 base，飞行中不变；lift 是相对 base 的抬升，水平位置才是变量）
        // 简单可靠：从场景里按 Macaw holder 的真实 position 投影
        // 注意三只同名 Group，用 index 对应
        const holders = [];
        G.scene.traverse(o => { if (o.name === 'Macaw') holders.push(o); });
        const hd = holders[G.macawState().indexOf(m)];
        if (!hd) continue;
        const v = hd.position.clone().project(G.camera);
        if (v.z > 1) continue;
        const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
        const box = document.createElement('div');
        box.style.cssText = `position:absolute;left:${x - 34}px;top:${y - 46}px;width:68px;height:64px;
          border:2px solid #FF3B30;border-radius:4px;box-shadow:0 0 6px rgba(255,59,48,.8)`;
        const tag = document.createElement('div');
        tag.style.cssText = 'position:absolute;left:' + (x - 34) + 'px;top:' + (y - 50) + 'px;background:#FF3B30;color:#fff;' +
          'font:11px/1.4 ui-monospace,monospace;padding:1px 5px;border-radius:3px;white-space:nowrap';
        tag.textContent = m.mode + ' (' + m.at[0].toFixed(1) + ',' + m.at[2].toFixed(1) + ')';
        d.appendChild(box); d.appendChild(tag);
      }
    };
    (function loop(){ window.__markTick(); requestAnimationFrame(loop); })();
  });

  const grab = async (label) => {
    await page.waitForTimeout(120);   // 等标注层画上
    const f = path.join(OUT, label + '.png');
    await page.screenshot({ path: f });
    const st = await page.evaluate(() => window.__garden.macawState().map(m => ({ mode: m.mode, lift: m.lift, at: m.at })));
    console.log(label, JSON.stringify(st));
  };
  await page.waitForFunction(() => {
    const s = window.__garden.macawState();
    return s.some(m => m.mode === 'takeoff' && m.lift > 0.05 && m.lift < 1.2);
  }, null, { timeout: 240000 });
  await grab('01-takeoff');
  await page.waitForFunction(() => window.__garden.macawState().some(m => m.mode === 'cruise'), null, { timeout: 120000 });
  await page.waitForTimeout(650);
  await grab('02-cruise');
  await page.waitForFunction(() => window.__garden.macawState().some(m => m.mode === 'land' && m.lift < 1.0), null, { timeout: 120000 });
  await grab('03-land');
  await page.waitForFunction(() => {
    const s = window.__garden.macawState();
    return s.some(m => m.mode === 'perch' && m.at[0] < -4);
  }, null, { timeout: 240000 });
  await page.waitForTimeout(400);
  await grab('04-west-perch');
  await browser.close(); server.close();
  console.log('SHOTS DONE');
})().catch(e => { console.error('[macaw-shots] 异常:', e); process.exit(2); });
