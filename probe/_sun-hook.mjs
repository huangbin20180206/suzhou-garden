// 终极判据：用 defineProperty 监听主光/环境光/雾的写入，抓出"谁在什么时候写了什么值"
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
  page.on('pageerror', e => console.log('  [pageerror]', String(e.message).split('\n')[0]));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000, polling: 300 });
  await sleep(1500);

  /* 装监听 */
  const hooked = await page.evaluate(() => {
    const g = window.__garden, s = g.scene;
    let sun = null, amb = null, hemi = null;
    s.traverse(o => {
      if (o.isDirectionalLight && o.castShadow) sun = o;
      else if (o.isAmbientLight) amb = o;
      else if (o.isHemisphereLight) hemi = o;
    });
    window.__probeLog = [];
    const hook = (obj, key, tag) => {
      let v = obj[key];
      Object.defineProperty(obj, key, {
        configurable: true,
        get() { return v; },
        set(n) {
          if (n !== v) window.__probeLog.push({ tag, from: typeof v === 'number' ? +v.toFixed(4) : v, to: typeof n === 'number' ? +n.toFixed(4) : n,
            at: new Error().stack.split('\n')[2] ? new Error().stack.split('\n')[2].trim().slice(0, 90) : '?' });
          v = n;
        },
      });
    };
    hook(sun, 'intensity', 'sun.intensity');
    hook(amb, 'intensity', 'amb.intensity');
    if (hemi) hook(hemi, 'intensity', 'hemi.intensity');
    let fv = s.fog.density;
    Object.defineProperty(s.fog, 'density', {
      configurable: true, get() { return fv; },
      set(n) { if (n !== fv) window.__probeLog.push({ tag: 'fog.density', from: +fv.toFixed(5), to: +n.toFixed(5),
        at: new Error().stack.split('\n')[2].trim().slice(0, 90) }); fv = n; },
    });
    return { sunI: sun.intensity, ambI: amb.intensity, fogD: s.fog.density, expo: g.renderer.toneMappingExposure };
  });
  console.log('监听已装，初始:', JSON.stringify(hooked));

  /* 触发天气切换 */
  await page.evaluate(() => window.__garden.setEnv('weather', 'storm'));
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 30000, polling: 200 }).catch(() => {});
  await sleep(600);

  const log = await page.evaluate(() => window.__probeLog);
  const final = await page.evaluate(() => {
    const g = window.__garden, s = g.scene;
    let sun = null, amb = null;
    s.traverse(o => { if (o.isDirectionalLight && o.castShadow) sun = o; else if (o.isAmbientLight) amb = o; });
    return { sunI: sun.intensity, ambI: amb.intensity, fogD: s.fog.density, expo: g.renderer.toneMappingExposure,
             ENVsunI: g.ENV.cur.sunIntensity, ENVambI: g.ENV.cur.ambIntensity, ENVfogD: g.ENV.cur.fogDensity };
  });
  console.log('\n切换 storm 后 scene 实际值:', JSON.stringify(final));

  console.log(`\n── 写入日志（共 ${log.length} 条，最多显示 40 条）──`);
  const seen = {};
  for (const e of log.slice(0, 40)) {
    console.log(`  ${String(e.tag).padEnd(14)} ${String(e.from).padEnd(9)} → ${String(e.to).padEnd(9)}  @ ${e.at}`);
    seen[e.tag] = (seen[e.tag] || 0) + 1;
  }
  console.log('\n各通道写入次数:', JSON.stringify(seen));

  /* 对照：改一点 ENV.cur.sunIntensity 再手动 applyEnv，看是否被写入 */
  await page.evaluate(() => { window.__probeLog = []; window.__garden.ENV.cur.sunIntensity = 0.157; window.__garden.applyEnv(window.__garden.ENV.cur); });
  await sleep(300);
  const log2 = await page.evaluate(() => window.__probeLog);
  console.log('\n手动改 ENV.cur.sunIntensity=0.157 + applyEnv 的写入日志:', JSON.stringify(log2));

  await browser.close();
  server.close();
})();
