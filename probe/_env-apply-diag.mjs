// 决定性诊断：ENV.cur 的数值 → 是否真的写进了场景（灯光/雾/曝光/天空 uniform）
// 三态对比：clear → storm（等过渡完成）→ 手动再 applyEnv 一次
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'env-apply');
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

const SAMPLER = () => {
  const g = window.__garden, s = g.scene;
  let sun = null, amb = null, hemi = null;
  s.traverse(o => {
    if (o.isDirectionalLight) sun = o;
    else if (o.isAmbientLight) amb = o;
    else if (o.isHemisphereLight) hemi = o;
  });
  const sky = (() => { let m = null; s.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.uCloudAmount) m = o; }); return m; })();
  const p = g.ENV.cur;
  return {
    'ENV.cur': { sunI: +p.sunIntensity.toFixed(3), ambI: +p.ambIntensity.toFixed(3),
                 rain: +(p.rainAmount || 0).toFixed(3), expo: +p.exposure.toFixed(3),
                 fogD: +(p.fogDensity).toFixed(4), cloud: +(p.cloudAmount || 0).toFixed(2),
                 label: p.weatherLabel },
    'scene': { sunI: sun ? +sun.intensity.toFixed(3) : null,
               sunColor: sun ? sun.color.getHexString() : null,
               sunPos: sun ? sun.position.toArray().map(n => Math.round(n)) : null,
               ambI: amb ? +amb.intensity.toFixed(3) : null,
               hemiI: hemi ? +hemi.intensity.toFixed(3) : null,
               fogD: +s.fog.density.toFixed(4),
               expo: +g.renderer.toneMappingExposure.toFixed(3),
               skyCloud: sky ? +sky.material.uniforms.uCloudAmount.value.toFixed(2) : null },
  };
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000, polling: 300 });
  await sleep(1500);

  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 30000, polling: 200 }).catch(() => false);

  const A = await page.evaluate(SAMPLER);
  await page.screenshot({ path: path.join(OUT, 'A-clear.png') });

  await page.evaluate(() => window.__garden.setEnv('weather', 'storm'));
  await settled();
  await sleep(400);
  const B = await page.evaluate(SAMPLER);
  await page.screenshot({ path: path.join(OUT, 'B-storm.png') });

  /* 手动再 applyEnv 一次：若画面/数值因此改变，说明 animate 里的 applyEnv 没跑到 */
  await page.evaluate(() => window.__garden.applyEnv(window.__garden.ENV.cur));
  await sleep(500);
  const C = await page.evaluate(SAMPLER);
  await page.screenshot({ path: path.join(OUT, 'C-storm-manual-applyEnv.png') });

  const show = (tag, s) => {
    console.log(`\n[${tag}]`);
    console.log('  ENV.cur :', JSON.stringify(s['ENV.cur']));
    console.log('  scene   :', JSON.stringify(s.scene));
  };
  show('A 初始 clear', A);
  show('B setEnv(storm) 过渡完成', B);
  show('C 手动 applyEnv(ENV.cur)', C);

  console.log('\n── 判据 ──');
  const dSun = Math.abs(B.scene.sunI - A.scene.sunI);
  const dFog = Math.abs(B.scene.fogD - A.scene.fogD);
  const dAmb = Math.abs(B.scene.ambI - A.scene.ambI);
  console.log(`  A→B  scene.sunI 变化 ${dSun.toFixed(3)}（应显著下降）`);
  console.log(`  A→B  scene.ambI 变化 ${dAmb.toFixed(3)}`);
  console.log(`  A→B  scene.fogD 变化 ${dFog.toFixed(4)}（应显著上升）`);
  console.log(`  B→C  （手动 applyEnv 后）sunI 差 ${Math.abs(C.scene.sunI - B.scene.sunI).toFixed(3)} / fogD 差 ${Math.abs(C.scene.fogD - B.scene.fogD).toFixed(4)}`);

  await browser.close();
  server.close();
})();
