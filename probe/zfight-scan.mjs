/* z-fight 扫描：在指定区域逐点向下射线，找相邻命中 <0.02m 的共面叠层对。
 * 用法：node probe/zfight-scan.mjs [x0 x1 z0 z1 step]
 * 默认扫马厩院门一带（stableGateSlab 曾与 mergedStatic 差 0.003m 的已知点）。
 * 输出：叠层对象名对 + 世界坐标 + 高差。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = process.argv.slice(2).map(Number);
const REG = { x0: A[0] ?? 37, x1: A[1] ?? 43, z0: A[2] ?? 1, z1: A[3] ?? 9, step: A[4] ?? 0.5 };

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
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
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });
  await sleep(3000);   // 延迟批（马厩/路）与 mergeStatics 都完成

  const found = await page.evaluate((reg) => {
    const T = window.__garden;
    const rc = new T.THREE.Raycaster();
    const DOWN = new T.THREE.Vector3(0, -1, 0);
    const pairs = {};
    let casts = 0;
    for (let x = reg.x0; x <= reg.x1; x += reg.step){
      for (let z = reg.z0; z <= reg.z1; z += reg.step){
        rc.set(new T.THREE.Vector3(x, 12, z), DOWN);
        rc.far = 20;
        const hits = rc.intersectObject(T.scene, true);
        casts++;
        for (let i = 1; i < hits.length; i++){
          const d = hits[i - 1].point.y - hits[i].point.y;
          if (d >= 0 && d < 0.02){
            const nm = (o) => {
              const chain = []; let q = o;
              while (q && chain.length < 4){ chain.push(q.name || q.type); q = q.parent; }
              return (o.name || o.type) + '#' + o.geometry.uuid.slice(0,6) + '[' + chain.join('/') + ']obj' + o.uuid.slice(0,5);
            };
            const a = nm(hits[i - 1].object);
            const b = nm(hits[i].object);
            const key = `${a} ↔ ${b}`;
            if (!pairs[key]) pairs[key] = { n: 0, gapMin: 1, at: null, xz: null };
            const e = pairs[key];
            if (d < e.gapMin){ e.gapMin = +d.toFixed(4); e.at = hits[i - 1].point.y.toFixed(3); e.xz = `${hits[i-1].point.x.toFixed(1)},${hits[i-1].point.z.toFixed(1)}`; }
            e.n++;
          }
        }
      }
    }
    return { casts, pairs };
  }, REG);

  console.log(`射线 ${found.casts} 点`);
  const keys = Object.keys(found.pairs);
  if (!keys.length) console.log('✓ 扫描区内无 <0.02m 叠层');
  for (const k of keys){
    const e = found.pairs[k];
    console.log(`✗ ${k}  ${e.n} 处  最小高差 ${e.gapMin}m @y${e.at} (${e.xz})`);
  }
  await browser.close();
  await new Promise(r => server.close(r));
  process.exit(keys.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
