// 诊断：抽屉面板里的功能按钮"点了没反应"到底卡在哪一环
// 不入门禁链。输出：命中测试（elementFromPoint）+ 真实点击后的 ENV 状态变化
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'ui-click');
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
  page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000, polling: 300 });
  await sleep(1200);

  /* 展开抽屉 */
  await page.click('#env .drawer-toggle');
  await sleep(700);
  console.log('展开后 expanded =', await page.evaluate(() => document.getElementById('env').classList.contains('expanded')));

  /* ── 1. 命中测试：每个按钮中心点上到底是谁 ── */
  const diag = await page.evaluate(() => {
    const cs = el => getComputedStyle(el);
    const panel = document.querySelector('#env .drawer-content');
    const btns = [...document.querySelectorAll('#env button')];
    return {
      envRect: (r => [r.left, r.top, r.width, r.height])(document.getElementById('env').getBoundingClientRect()),
      panel: { vis: cs(panel).visibility, op: cs(panel).opacity,
               pe: cs(panel).pointerEvents, us: cs(panel).userSelect, z: cs(panel).zIndex },
      btns: btns.map(b => {
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { label: b.textContent.trim(), axis: b.dataset.axis || '(act)', v: b.dataset.v || b.dataset.act,
                 disabled: b.disabled, pe: cs(b).pointerEvents, us: cs(b).userSelect,
                 hitSelf: hit === b, hit: hit ? `${hit.tagName}#${hit.id || ''}.${hit.className || ''}` : 'null',
                 rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      }),
    };
  });
  console.log('\n── 命中测试 ──');
  console.log('env 锚点 rect =', diag.envRect);
  console.log('panel =', JSON.stringify(diag.panel));
  for (const b of diag.btns) {
    console.log(`  ${b.hitSelf ? 'OK ' : '!! '}${b.label.padEnd(6)} ${String(b.axis).padEnd(8)} ${String(b.v).padEnd(9)} disabled=${b.disabled} pe=${b.pe} us=${b.us} hit=${b.hit} rect=${b.rect}`);
  }

  /* ── 2. 真实点击：状态是否变化 ── */
  const readState = () => page.evaluate(() => ({
    weather: window.__garden.ENV.weather, time: window.__garden.ENV.time,
    season: window.__garden.ENV.season, label: window.__garden.ENV.cur && window.__garden.ENV.cur.weatherLabel,
    stats: (document.getElementById('stats').textContent || '').split('\n').find(l => l.includes('·')) || '',
    onBtns: [...document.querySelectorAll('#env button.on')].map(b => b.textContent.trim()),
  }));

  console.log('\n── 真实点击测试（带过渡时间序列）──');
  console.log('初始:', JSON.stringify(await readState()));

  const sample = () => page.evaluate(() => ({
    t: Math.round((window.__garden.ENV.t || 0) * 1000) / 1000,
    dur: window.__garden.ENV.dur,
    sunI: Math.round(window.__garden.scene.userData ? 0 : 0) || null,
    rain: window.__garden.ENV.cur && window.__garden.ENV.cur.rainAmount,
    label: window.__garden.ENV.cur && window.__garden.ENV.cur.weatherLabel,
    fog: Math.round((window.__garden.scene.fog.density) * 10000) / 10000,
    tris: window.__garden.renderer ? window.__garden.renderer.info.render.triangles : null,
    calls: window.__garden.renderer ? window.__garden.renderer.info.render.calls : null,
  }));

  const shots2 = [
    ['#env button[data-v="storm"]', '天气→狂风暴雨'],
    ['#env button[data-v="night"]', '时段→夜'],
    ['#env button[data-v="winter"]', '季节→冬'],
    ['#env button[data-view="overview"]', '导览→全园'],
  ];
  let i = 0;
  for (const [sel, what] of shots2) {
    let err = '';
    try { await page.click(sel, { timeout: 6000 }); } catch (e) { err = String(e.message).split('\n')[0]; }
    console.log(`\n  点 ${what} ${err ? '✗ ' + err : '✓'}`);
    for (const ms of [300, 700, 1500, 3000, 6000]) {
      await sleep(ms === 300 ? 300 : ms - (ms === 700 ? 300 : ms === 1500 ? 700 : ms === 3000 ? 1500 : 3000));
      const s = await sample();
      console.log(`    +${String(ms).padStart(4)}ms  ENV.t=${s.t} dur=${s.dur} rain=${s.rain} fog=${s.fog} tris=${s.tris} calls=${s.calls} label=${s.label}`);
    }
    await page.screenshot({ path: path.join(OUT, `0${++i}-${String(what).replace(/[^\w]/g, '_')}.png`) });
  }

  await browser.close();
  server.close();
})();
