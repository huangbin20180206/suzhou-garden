// 一次性诊断（2026-09-19 · 老黄："狂风暴雨的场景下灯笼几乎没动"）
// 目的：给"灯笼能摆多大"定一个**有据**的上限 —— 量每盏灯笼到四周最近构件的水平净距。
// 摆出去的位移 = 摆臂长 × sin(摆角)，必须 < 净距 − 灯身半径(0.16) − 余量。
// 用法: node probe/_lantern-clearance.mjs
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
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000 });

  const out = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const self = new Set();
    const rows = [];
    for (const pivot of g.lanternGroups){
      self.clear();
      pivot.traverse(o => self.add(o));
      const grp = pivot.children.find(c => c.isGroup) || pivot.children[0];
      const arm = Math.abs(grp.position.y);                      // 挂点 → 灯身中心
      const center = new T.Vector3(0, grp.position.y, 0).add(pivot.position);
      const rc = new T.Raycaster();
      let min = Infinity, minDir = null;
      for (let k = 0; k < 24; k++){
        const a = k / 24 * Math.PI * 2;
        const dir = new T.Vector3(Math.cos(a), 0, Math.sin(a));
        rc.set(center, dir);
        rc.far = 1.6;
        const hits = rc.intersectObject(g.scene, true);
        for (const h of hits){
          let o = h.object, mine = false;
          while (o){ if (self.has(o)){ mine = true; break; } o = o.parent; }
          if (mine) continue;
          if (h.distance < min){ min = h.distance; minDir = [+dir.x.toFixed(2), +dir.z.toFixed(2)]; }
          break;
        }
      }
      rows.push({ pos: [+pivot.position.x.toFixed(2), +pivot.position.z.toFixed(2)],
                  arm: +arm.toFixed(3), minDist: min === Infinity ? null : +min.toFixed(3), minDir });
    }
    return rows;
  });

  console.log('灯笼净空（摆臂 = 挂点→灯身中心；minDist = 水平 24 向最近构件距离）');
  let worst = null;
  for (const r of out){
    const usable = r.minDist === null ? null : r.minDist - 0.16;      // 扣掉灯身半径
    const maxRad = usable === null ? null : Math.asin(Math.min(1, usable / r.arm));
    console.log('  挂点 x/z=' + JSON.stringify(r.pos) + ' 摆臂 ' + r.arm + 'm  最近 ' + r.minDist
      + 'm (方向 ' + JSON.stringify(r.minDir) + ')  → 可用摆角上限 ' + (maxRad === null ? '∞' : maxRad.toFixed(3))
      + ' rad = ' + (maxRad === null ? '?' : (maxRad * 180 / Math.PI).toFixed(1)) + '°');
    if (maxRad !== null && (worst === null || maxRad < worst)) worst = maxRad;
  }
  console.log('\n全场最紧的一盏允许摆角 ≈ ' + worst.toFixed(3) + ' rad（' + (worst * 180 / Math.PI).toFixed(1)
    + '°）；取 0.6 安全系数 → 建议上限 ' + (worst * 0.6).toFixed(3) + ' rad');
  await browser.close();
  server.close();
})();
