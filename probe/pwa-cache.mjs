import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchChromium } from './_harness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/probe-host') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>PWA test</title>');
    return;
  }
  try {
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const data = await fs.readFile(file);
    const types = { '.js': 'text/javascript', '.html': 'text/html', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await launchChromium(chromium);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/probe-host`);
  const result = await page.evaluate(async () => {
    await (await caches.open('other-app-v1')).put('/foreign-data', new Response('keep-me'));
    await (await caches.open('suzhou-garden-v0')).put('/old-data', new Response('obsolete'));
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    const keys = await caches.keys();
    const foreign = await (await caches.open('other-app-v1')).match('/foreign-data');
    return { keys, foreign: foreign ? await foreign.text() : null };
  });
  console.log(JSON.stringify(result));
  assert.equal(result.foreign, 'keep-me', 'Foreign cache entry must survive Garden activation');
  assert.ok(!result.keys.includes('suzhou-garden-v0'), 'Old Garden cache must be deleted');
  console.log('PASS: foreign cache preserved; old Garden cache removed');
  await context.setOffline(true);
  const offline = await page.evaluate(async () => {
    const urls = ['/index.html', '/vendor.js', '/manifest.webmanifest', '/icons/garden.svg', '/assets/BananaPlant.glb', '/assets/koi.glb', '/assets/LotusPlant.glb', '/assets/Turtle.glb'];
    return Promise.all(urls.map(async url => { const r = await fetch(url); return { url, status: r.status, bytes: (await r.arrayBuffer()).byteLength }; }));
  });
  assert.ok(offline.every(r => r.status === 200 && r.bytes > 0), 'All offline resources must be present');
  console.log('PASS: eight offline resources available ' + JSON.stringify(offline));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 480, height: 640 });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { timeout: 60000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const names = new Set();
    window.__garden.scene.traverse(o => { for (const n of ['KoiFish', 'Turtle', 'BananaPlant', 'LotusPlant']) if (o.name.includes(n)) names.add(n); });
    return names.size === 4;
  }, null, { timeout: 60000 });
  assert.deepEqual(errors, [], 'Offline boot must have no page errors');
  await page.screenshot({ path: path.join(root, 'outputs/pwa-offline-verified-v1.png') });
  await fs.writeFile(path.join(root, 'outputs/pwa-verification.json'), JSON.stringify({ sourceCommit: '5d16e10', cacheIsolation: result, offline, offlineBoot: true, allFourModels: true, pageErrors: errors }, null, 2));
  console.log('PASS: offline Garden boot and all four GLB models; screenshot saved');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
