// _tmp-lion-face.mjs —— 【临时·只读】怼脸拍公狮，确认五官是否落在脸上
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag');
const loadPlaywright = () => { const r = createRequire(import.meta.url); try { return r('playwright'); } catch {} throw new Error('no playwright'); };
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.glb':'model/gltf-binary', '.png':'image/png', '.json':'application/json', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.mp3':'audio/mpeg' };
const srv = http.createServer((q,r)=>{ let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'Content-Type':MIME[path.extname(p).toLowerCase()]||'application/octet-stream'}); r.end(d); }); });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await listenEphemeral(srv);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.setDefaultTimeout(600000);
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && window.__garden.bootDone && window.__garden.bootDone(), null, { timeout: 600000, polling: 300 });
  await page.evaluate(() => { const g = window.__garden; try { g.guideStop(); } catch {} g.setEnv('season','summer'); g.setEnv('weather','clear'); g.setEnv('time','noon'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 200000, polling: 200 });
  await sleep(1200);
  await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    g.controls.enabled = false; g.controls.enableDamping = false;
    g.camera.position.set(42.3, 0.95, 5.6);
    g.camera.fov = 40; g.camera.near = 0.05; g.camera.updateProjectionMatrix();
    g.controls.target.set(42.3, 0.78, 3.55); g.camera.lookAt(42.3, 0.78, 3.55);
  });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'lions-face-front.png') });
  console.log('  ✓ lions-face-front.png');
  const ori = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const out = {};
    g.scene.traverse(o => {
      if (o.name === 'stoneLionMale') out.holder = [+o.position.x.toFixed(2), +o.position.z.toFixed(2)];
      if (o.name === 'stoneLion_male_dark') {
        const c = new T.Box3().setFromObject(o).getCenter(new T.Vector3());
        out.darkWorld = [+c.x.toFixed(2), +c.z.toFixed(2)];
      }
    });
    return out;
  });
  console.log('  ORI=' + JSON.stringify(ori));
  console.log('  pageerror: ' + errs.length);
  await browser.close(); srv.close(); process.exit(0);
})();
