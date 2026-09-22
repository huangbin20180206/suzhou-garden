// 一次性诊断（2026-09-19 · 竹叶探针冬季截图里紫藤花穗疑似没藏住）：
// wisteriaShow 冬季应为 0，applyPresence 每帧重申 visible=false + count=0。
// 开 __ENVDBG 读 [ENVDBG] 行：cacheLen（缓存条数）+ visibleBefore（applyPresence 前的 visible 串）。
// 用法: node probe/_winter-wisteria.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(120000);
  const dbg = [], errs = [];
  page.on('console', m => { const t = m.text(); if (t.includes('[ENVDBG]')) dbg.push(t); });
  page.on('pageerror', e => errs.push('[pageerror] ' + e));
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.evaluate(() => { window.__ENVDBG = true; });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000 });

  const out = await page.evaluate(async () => {
    const g = window.__garden;
    const wait = async () => {
      const t0 = performance.now();
      await new Promise(r => { const tick = () =>
        (g.ENV.t >= 1 || performance.now() - t0 > 10000) ? r() : setTimeout(tick, 100); tick(); });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    };
    /* 紫藤花穗 InstancedMesh：按材质身份直查（__garden.MAT 已暴露，不再靠启发式聚类） */
    const tally = () => {
      const list = [];
      g.scene.traverse(o => {
        if (o.isInstancedMesh && o.material === g.MAT.wisteria) list.push(o);
      });
      if (!list.length) return null;
      return {
        meshes: list.length,
        visible: list.filter(o => o.visible).length,
        countSum: list.reduce((s, o) => s + o.count, 0),
      };
    };
    const res = {};
    for (const season of ['summer', 'winter']){
      g.setEnv('season', season);
      await wait();
      res[season] = tally();
    }
    return res;
  });

  console.log('紫藤花穗 InstancedMesh 统计（按共享材质最大簇识别）：');
  for (const k of Object.keys(out)){
    console.log('  ' + k + ': ' + JSON.stringify(out[k]));
  }
  const last = dbg[dbg.length - 1];
  console.log('\n最后一条 [ENVDBG]: ' + (last || '（无）'));
  const winterLines = dbg.filter(t => t.includes('wisteriaShow=0'));
  console.log('wisteriaShow=0 的 ENVDBG 行数: ' + winterLines.length);
  if (winterLines.length) console.log('其中最后一条: ' + winterLines[winterLines.length - 1]);
  if (errs.length) console.log('[页面报错]\n' + errs.slice(0, 6).join('\n'));
  await browser.close();
  server.close();
})();
