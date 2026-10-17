// _tmp-lion-shots.mjs —— 【临时·只读】门口石狮一对落位验收。
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
const SHOTS = [
  { tag: 'lions-south', t: [40.0, 0.80, 3.4], d: [0.0, 0.28, 1.0], dist: 8.0 },
  { tag: 'lions-obl',   t: [40.0, 0.70, 3.4], d: [0.55, 0.35, 0.75], dist: 8.5 },
  { tag: 'lions-close', t: [42.3, 0.80, 3.4], d: [0.15, 0.25, 1.0], dist: 4.2 },
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await listenEphemeral(srv);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  page.on('console', m => { const t = m.text(); if (t.includes('石狮')) console.log('  [page] ' + t); });
  page.setDefaultTimeout(600000);
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && window.__garden.bootDone && window.__garden.bootDone(), null, { timeout: 600000, polling: 300 });
  await page.evaluate(() => { const g = window.__garden; try { g.guideStop(); } catch {} g.setEnv('season','summer'); g.setEnv('weather','clear'); g.setEnv('time','noon'); });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 200000, polling: 200 });
  await sleep(1500);
  for (const s of SHOTS) {
    await page.evaluate((s) => {
      const g = window.__garden, T = g.THREE;
      const t = new T.Vector3(...s.t), d = new T.Vector3(...s.d).normalize();
      g.controls.enabled = false; g.controls.enableDamping = false;
      g.camera.position.copy(t).addScaledVector(d, s.dist);
      g.camera.fov = 46; g.camera.near = 0.05; g.camera.updateProjectionMatrix();
      g.controls.target.copy(t); g.camera.lookAt(t);
    }, s);
    await sleep(900);
    const f = path.join(OUT, 'lions-' + s.tag + '.png');
    await page.screenshot({ path: f });
    console.log('  ✓ ' + path.basename(f));
  }
  const info = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const out = [];
    g.scene.traverse(o => {
      if (/stoneLion/.test(o.name)) {
        const bb = new T.Box3().setFromObject(o);
        const sz = bb.getSize(new T.Vector3());
        out.push({ name: o.name, pos: [+o.position.x.toFixed(2), +o.position.y.toFixed(2), +o.position.z.toFixed(2)],
          ry: +o.rotation.y.toFixed(3), size: [+sz.x.toFixed(2), +sz.y.toFixed(2), +sz.z.toFixed(2)] });
      }
    });
    return out;
  });
  console.log('  LIONS=' + JSON.stringify(info));
  console.log('  pageerror: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0,2).join(' | ') : ''));
  await browser.close(); srv.close(); process.exit(0);
})();
