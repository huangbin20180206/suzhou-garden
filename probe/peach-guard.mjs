// 桃花生命周期 + 晴午波光 门禁 + 样张（2026-09-21）。
//   断言（桃是落叶观花乔木，四季生命周期必须由季节显隐通道驱动）：
//     ① 园里种了桃花树（userData.peachTree 的组 ≥ 2）；
//     ② 春：叶/花/落花均在，果隐（花满树 + 落花铺地）；      夏：果现、花隐；
//       冬：叶/花/果/落花全隐（裸枝过冬）；                  秋：叶在、花/落花隐。
//     ③ 晴午水面太阳波光：正午+晴 uSunVis>0；夜/暴雨 =0（只在"接近正午 × 晴天"亮）。
//   样张：outputs/visual/peach-*.png（春开花 / 夏结果 / 冬裸枝 / 晴午波光）。
// usage: node probe/peach-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', 'visual');
fs.mkdirSync(OUT, { recursive: true });
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra) => { results.push({ label, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`); };

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const look = (tx, ty, tz, px, py, pz) => page.evaluate((a) => {
    const g = window.__garden;
    g.controls.target.set(a[0], a[1], a[2]);
    g.camera.position.set(a[3], a[4], a[5]);
    g.camera.lookAt(g.controls.target); g.controls.update();
  }, [tx, ty, tz, px, py, pz]);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  await sleep(1200);
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 60000, polling: 200 }).then(() => true).catch(() => false);

  /* ① 树是否种下（延迟装配完成可能晚于该采样，先等黄/绿植物落地） */
  const trees = async () => page.evaluate(() => {
    const found = [];
    window.__garden.scene.traverse(o => { if (o.userData && o.userData.peachTree) found.push(o); });
    return found.length;
  });
  let tryTrees = 0, treeN = 0;
  while (tryTrees < 12 && treeN < 2){ treeN = await trees(); if (treeN < 2){ await sleep(700); tryTrees++; } }
  check('园里已种下 ≥2 株桃花树（延迟装配后存在）', treeN >= 2, `found=${treeN}`);

  /* 逐季取「树身上四套材质实例」的 visible 快照 */
  const snap = () => page.evaluate(() => {
    const G = window.__garden, MAT = G.MAT;
    const want = ['leaf','blossom','fruit','petal'];
    const out = { leaf:[], blossom:[], fruit:[], petal:[] };
    G.scene.traverse(o => {
      if (!(o.userData && o.userData.peachTree)) return;
      for (const k of want){
        const m = MAT['peach' + (k === 'leaf' ? 'Leaf' : k[0].toUpperCase() + k.slice(1))];
        if (o.isMesh && o.material === m) out[k].push(o.visible);
      }
      if (o.isMesh){
        for (const k of want){
          const m = MAT['peach' + (k === 'leaf' ? 'Leaf' : k[0].toUpperCase() + k.slice(1))];
          if (o.material && o.material === m) out[k].push(o.visible);
        }
      }
    });
    return { leaf: out.leaf, blossom: out.blossom, fruit: out.fruit, petal: out.petal };
  });
  /* 树是 group；材质在子 InstancedMesh 上，unshift 一个假 so 直接用统一遍历即可 ——
     简化：按材质身份全场景快照（同一材质只会出现在桃树上） */
  const matSnap = () => page.evaluate(() => {
    const MAT = window.__garden.MAT;
    const vis = {};
    for (const k of ['peachLeaf','peachBlossom','peachFruit','peachPetal']){
      let any = false, count = 0, visibleCount = 0;
      window.__garden.scene.traverse(o => {
        if (o.isMesh && o.material === MAT[k]){ any = true; count++; if (o.visible) visibleCount++; }
      });
      vis[k] = { any, count, visibleCount };
    }
    return vis;
  });
  const setSeason = (s) => page.evaluate((s) => { const g = window.__garden;
    g.setEnv('time','noon'); g.setEnv('weather','clear'); g.setEnv('season', s); }, s);

  await setSeason('spring'); await settled(); await sleep(1200);
  let v = await matSnap();
  check('春：桃花在枝头（blossom 可见）', v.peachBlossom.visibleCount === v.peachBlossom.count, JSON.stringify(v.peachBlossom));
  check('春：桃叶/落花在（叶+花铺地）', v.peachLeaf.visibleCount > 0 && v.peachPetal.visibleCount > 0, `叶${v.peachLeaf.visibleCount}/${v.peachLeaf.count} 瓣${v.peachPetal.visibleCount}/${v.peachPetal.count}`);
  check('春：果未结（fruit 隐藏）', v.peachFruit.visibleCount === 0, JSON.stringify(v.peachFruit));
  await look(-19.8, 4.2, 4.2, -25.5, 5.2, 8.5);
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'peach-spring-blossom.png') });

  await setSeason('summer'); await settled(); await sleep(1200);
  v = await matSnap();
  check('夏：桃结果（fruit 可见）', v.peachFruit.visibleCount > 0, JSON.stringify(v.peachFruit));
  check('夏：花落尽（blossom 隐藏）', v.peachBlossom.visibleCount === 0, JSON.stringify(v.peachBlossom));
  await look(6.2, 3.8, 15.4, 3.4, 3.6, 12.2);
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'peach-summer-fruit.png') });

  await setSeason('autumn'); await settled(); await sleep(1200);
  v = await matSnap();
  check('秋：叶在但花/落花已尽', v.peachLeaf.visibleCount > 0 && v.peachBlossom.visibleCount === 0 && v.peachPetal.visibleCount === 0,
    `叶${v.peachLeaf.visibleCount} 果${v.peachFruit.visibleCount} 花${v.peachBlossom.visibleCount}`);

  await setSeason('winter'); await settled(); await sleep(1200);
  v = await matSnap();
  check('冬：裸枝过冬（叶/花/果/落花全隐）',
    v.peachLeaf.visibleCount === 0 && v.peachBlossom.visibleCount === 0 &&
    v.peachFruit.visibleCount === 0 && v.peachPetal.visibleCount === 0,
    `叶${v.peachLeaf.visibleCount} 花${v.peachBlossom.visibleCount} 果${v.peachFruit.visibleCount} 瓣${v.peachPetal.visibleCount}`);
  await look(-19.8, 3.4, 4.2, -25.5, 3.8, 8.5);
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'peach-winter-bare.png') });

  /* 晴午水面波光（uSunVis） */
  await page.evaluate(() => { const g = window.__garden;
    g.setEnv('time','noon'); g.setEnv('weather','clear'); g.setEnv('season','summer'); });
  await settled(); await sleep(1200);
  const noonVis = await page.evaluate(() => window.__garden.sunVisWater());
  check('晴午：水面太阳波光开启（uSunVis>0）', typeof noonVis === 'number' && noonVis > 0, `uSunVis=${noonVis}`);

  await page.evaluate(() => { const g = window.__garden; g.setEnv('time','night'); g.setEnv('season','summer'); g.setEnv('weather','clear'); });
  await settled(); await sleep(1200);
  const nightVis = await page.evaluate(() => window.__garden.sunVisWater());
  check('夜：太阳波光关闭（uSunVis=0，月亮那张亮不属于日间）', nightVis === 0, `uSunVis=${nightVis}`);

  await page.evaluate(() => { const g = window.__garden; g.setEnv('time','noon'); g.setEnv('weather','storm'); g.setEnv('season','summer'); });
  await settled(); await sleep(1200);
  const stormVis = await page.evaluate(() => window.__garden.sunVisWater());
  check('暴雨：太阳波光关闭（阴霾盖掉日轮）', stormVis === 0, `uSunVis=${stormVis}`);
  await look(0, 4, 0, -2, 5, 13);
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'interim-stormwater.png') });

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[桃] ${results.length - failed.length}/${results.length} 项通过 · 样张 ${OUT}/peach-*.png`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[peach-guard] 崩溃:', e); process.exit(2); });