// 判据校准：连续截三张图，互相差分
// 若三张完全相同 → 截图拿的是过期帧（那么"画面没变"的结论不成立，需换判据）
// 若三张不同 → 截图反映实时画面 ✓
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

  console.log('document.hidden =', await page.evaluate(() => document.hidden));
  console.log('visibilityState =', await page.evaluate(() => document.visibilityState));
  console.log('__garden 有 pageHidden? ', await page.evaluate(() => typeof window.__garden.pageHidden));
  console.log('geom/calls/tris =', JSON.stringify(await page.evaluate(() => ({
    g: window.__garden.renderer.info.memory.geometries,
    t: window.__garden.renderer.info.memory.textures,
    calls: window.__garden.renderer.info.render.calls,
    tris: window.__garden.renderer.info.render.triangles,
  }))));

  /* 连续三张（不改状态），间隔 400ms */
  for (let i = 1; i <= 3; i++) {
    await page.screenshot({ path: path.join(OUT, `idle-${i}.png`) });
    await sleep(400);
  }
  console.log('\n已截 idle-1/2/3.png（状态未变）');

  /* 暴力测试：直接把主光关掉 + 环境光压暗，看画面是否响应 */
  const lights = await page.evaluate(() => {
    const out = [];
    window.__garden.scene.traverse(o => {
      if (o.isDirectionalLight) out.push({ type: 'dir', castShadow: o.castShadow, i: o.intensity, c: o.color.getHexString(), pos: o.position.toArray().map(n => Math.round(n)) });
      else if (o.isAmbientLight) out.push({ type: 'amb', i: o.intensity });
      else if (o.isHemisphereLight) out.push({ type: 'hemi', i: o.intensity });
    });
    return out;
  });
  console.log('\n灯光清单：', JSON.stringify(lights));

  await page.evaluate(() => {
    window.__garden.scene.traverse(o => {
      if (o.isDirectionalLight) o.intensity = 0.0;
      if (o.isAmbientLight) o.intensity = 0.0;
      if (o.isHemisphereLight) o.intensity = 0.0;
    });
  });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'forced-dark.png') });
  console.log('已截 forced-dark.png（所有灯 intensity=0）');

  await browser.close();
  server.close();
})();
