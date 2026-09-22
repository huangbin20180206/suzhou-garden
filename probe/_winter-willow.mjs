// 一次性诊断（2026-09-19 · 老黄截图：冬季柳树还挂着满树叶子）
// 假设：柳/竹走 deferBoot 延迟装配，而 willowLeafInsts / bambooLeafInsts / seasonMeshCache
// 都是**模块求值期** traverse 收集的 —— 那时 deferRoot 还是空的 → 收集器为空 → 季节叶量失效。
// 用法: node probe/_winter-willow.mjs
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
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.setDefaultTimeout(120000);
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + e));
  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 90000 });
  /* 柳/竹是 deferBoot 延迟装配的：等第一个带标记的实例出现（= 延迟批已跑） */
  const deferredSeen = await page.waitForFunction(() => {
    let n = 0;
    window.__garden.scene.traverse(o => { if (o.isInstancedMesh && o.userData.seasonWillowLeaf) n++; });
    return n > 0;
  }, { timeout: 60000, polling: 250 }).then(() => true).catch(() => false);

  const report = await page.evaluate(async () => {
    const g = window.__garden;
    const grab = () => {
      const w = [], b = [];
      g.scene.traverse(o => {
        if (!o.isInstancedMesh) return;
        if (o.userData.seasonWillowLeaf) w.push(o.count);
        if (o.userData.seasonBambooLeaf) b.push(o.count);
      });
      return { willowMeshes: w.length, bambooMeshes: b.length,
               willowCounts: w.join(','), bambooCounts: b.join(',') };
    };
    const summer = grab();
    g.ENV.dur = 0.2;
    g.setEnv('season', 'winter');
    const t0 = performance.now();
    await new Promise(r => { const tick = () =>
      (g.ENV.t >= 1 || performance.now() - t0 > 10000) ? r() : setTimeout(tick, 100); tick(); });
    const winter = grab();
    /* 关键：collectSeasonCaches 重收发生在**全部延迟 job 结束**那一刻。
       上面那次 grab 可能在竹批还没跑完时取样（收集器还没重收）——
       再等 3 秒取一次，才是"修复是否生效"的最终答案。 */
    await new Promise(r => setTimeout(r, 3000));
    const winterAfterBoot = grab();
    /* 雪·室内检测（2026-09-19 老黄截图：雪下进了远香堂屋里）：
       切银装素裹，等粒子循环几轮后数"室内禁区内"的活跃雪粒子 —— 修复后必须是 0。 */
    g.setEnv('weather', 'snow');
    const t1 = performance.now();
    await new Promise(r => { const tick = () =>
      (g.ENV.t >= 1 || performance.now() - t1 > 10000) ? r() : setTimeout(tick, 100); tick(); });
    await new Promise(r => setTimeout(r, 2000));          // 让粒子循环 / 禁区即死跑起来
    const S = g.PRECIP.snow, arr = S.arr;
    let snowIndoor = 0, snowTotal = 0;
    for (let i = 0; i < S.n; i++){
      const x = arr[i*3], y = arr[i*3+1], z = arr[i*3+2];
      if (y > 22 || y < -1.3) continue;                   // 不在活动体积里的不计
      snowTotal++;
      if (y < 5.0 && x > -9.6 && x < 9.6 && z > -16.4 && z < -9.2) snowIndoor++;
    }
    return { summer, winter, winterAfterBoot, snowIndoor, snowTotal, seasonNow: g.ENV.season,
             willowLeaf: g.ENV.cur.willowLeaf, bambooLeaf: g.ENV.cur.bambooLeaf };
  });
  console.log('[延迟批已出现] ' + deferredSeen);
  console.log('[夏] ' + JSON.stringify(report.summer));
  console.log('[冬·取样时] ' + JSON.stringify(report.winter));
  console.log('[冬·延迟批收尾后] ' + JSON.stringify(report.winterAfterBoot));
  console.log('[雪·室内粒子] ' + report.snowIndoor + ' / 活动粒子 ' + report.snowTotal + '（必须为 0）');
  console.log('[当前] season=' + report.seasonNow + ' willowLeaf=' + report.willowLeaf + ' bambooLeaf=' + report.bambooLeaf);
  /* 冬季全园样张：默认机位，验证柳树真的裸枝（而不是只剩稀疏残帘） */
  const OUT = path.join(ROOT, 'outputs', '_diag', 'winter-willow');
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'winter-overview.png') });
  console.log('[样张] ' + path.join('outputs/_diag/winter-willow', 'winter-overview.png'));
  /* 堂前近景：对着远香堂敞开的门看，屋里不该有雪 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.camera.position.set(5.2, 3.4, -2.6);
    g.camera.fov = 46; g.camera.updateProjectionMatrix();
    g.controls.target.set(-1.2, 2.2, -12.0);
    g.controls.update();
  });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: path.join(OUT, 'winter-hall-door.png') });
  console.log('[样张] ' + path.join('outputs/_diag/winter-willow', 'winter-hall-door.png'));
  if (errs.length) console.log('[页面报错]\n' + errs.slice(0, 6).join('\n'));
  await browser.close();
  server.close();
})();
