// 室内不落雨雪 indoor-precip-guard（2026-10-01 加）
//
// 守什么：**远香堂室内不得出现雨/雪粒子**。这是老黄报过两次的缺陷
//   （2026-09-19"雪下进了远香堂屋里" → 加了 PRECIP_INDOOR「禁区即死」；
//     2026-10-01 又报"室内怎么也会有雪呢，这个bug之前改过，现在又出现了"）。
//
// ⚠️ 为什么必须单独一道门，而且**不能把房间高度写死**：
//   第一次修复把禁区顶 `yTop` 定在 **5.0**，而堂内天花在 `1.24 + colH + 0.44`，
//   `colH = H − 2.35`（H=7）⇒ **6.33**。于是房间上半截 `5.0~6.33`（占层高 26%）
//   的雪**一直没被杀掉**，而当时没有任何判据知道"房间到底有多高"⇒ 缺陷潜伏了两周。
//   ⇒ 本门**用射线在场景里量出天花标高**（从堂内向上打一条射线取首个命中面），
//     再拿它当判据基准。以后谁把 yTop 调低、或者把房子加高，这里都会自动报红。
//
// ⚠️ 只数"本次会被提交渲染"的那部分粒子（`drawRange.count`）—— 数组里超出
//   drawRange 的粒子不画，数进去就是虚高。
// ⚠️ 采样取**多帧最坏值**：粒子是稀疏采样的，"某一帧恰好没有"说明不了问题。
//
// 用法: node probe/indoor-precip-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 700, height: 440 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.evaluate(() => {
    const G = window.__garden;
    G.ENV.dur = 0.2;
    G.setEnv('season', 'winter'); G.setEnv('time', 'noon');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 });

  /* ── 量房间：从堂内向上打射线取天花标高（不写死） ── */
  const room = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const rc = new T.Raycaster();
    rc.far = 30;
    const probes = [[0, -12.8], [3.2, -13.6], [-3.2, -11.8], [6.0, -12.4], [-6.0, -13.2]];
    const hits = [];
    for (const [x, z] of probes){
      rc.set(new T.Vector3(x, 3.0, z), new T.Vector3(0, 1, 0));
      const hs = rc.intersectObjects(G.scene.children, true).filter(h => h.object.isMesh);
      if (hs.length) hits.push(+hs[0].point.y.toFixed(3));
    }
    return { hits, top: hits.length ? Math.max(...hits) : null };
  });
  check('堂内天花标高可从场景量出（向上射线命中）', room.hits.length >= 3,
    `命中 ${room.hits.length}/5 处，标高 ${JSON.stringify(room.hits)}`);
  /* 天花应当在"比柱顶高、比正脊低"的合理带里；量错会静默把下面那条判据变软 */
  check('量出的天花标高在合理带内（5.8~7.0m，H=7 时理论 6.33）',
    room.top !== null && room.top > 5.8 && room.top < 7.0,
    `实测 ${room.top}m`);

  /* ── 两种天气各扫一遍：堂内（天花以下）不得有粒子 ── */
  const scan = async (weather) => {
    await page.evaluate((w) => { window.__garden.setEnv('weather', w); }, weather);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 });
    await new Promise(r => setTimeout(r, 3500));           // 让粒子循环几轮、走满体积
    return page.evaluate(async () => {
      const G = window.__garden;
      /* ⚠️ 判据量的是**房间内部**（外廓内缩 0.2m），不是建筑外廓：
         外廓往里有 ~0.15m 是墙体厚度（墙厚 0.3），那一圈里的粒子被墙挡住、看不见；
         而产品侧的禁区是按外廓只内缩 4cm 划的 ⇒ 它的覆盖面严格大于"房间内部"。
         若拿外廓来判，会把"死在墙体里的粒子"算成缺陷（实测假红 1~4 个）。
         内缩 0.2m 之后，判据区域完全落在产品禁区内部，两边不再互相误伤。 */
      const HAL = { x0: -9.8, x1: 9.8, z0: -16.6, z1: -9.0 };
      /* ⚠️ 另一条独立通道：**前沿那条带**（门洞就在这条带上）。
         老黄截图里那圈白点在**门洞的下半部（贴着门槛）** —— 那不是"屋里的雪"，
         而是旧禁区在**前沿留了 0.4m 内缩**（z 从 -9.2 起算），
         于是 z∈(-9.2,-8.8) 这条"正好落在门洞开口里"的板层成了漏网区：
         低处的粒子就在门槛附近被画出来。修法是把内缩收到 4cm（落进墙厚、被墙挡住）。
         ⚠️ 判据取**整条前沿带**（横跨堂宽），不取"门洞楔形"：
            门洞楔形只有 ~4m³ ⇒ 期望粒子数 ~0.06/帧 ⇒ 那会是一条**时红时绿的假门**；
            整条前沿带 44m³ ⇒ 期望 ~0.7/帧 ⇒ 24 帧内必出，才是确定性的判据。
            门洞只是这条带上**唯一看得见**的那格（其余被前墙挡住）。 */
      const FRONT = { x0: -9.7, x1: 9.7, y0: 0, y1: 6.4, z0: -9.2, z1: -8.85 };
      const out = { hall: { worst: 0, rendered: 0, n: 0, ys: [] }, front: { worst: 0 },
                    cavity: { worst: 0 },
                    snow: { worst: 0, rendered: 0, n: 0, ys: [] }, rain: { worst: 0, rendered: 0, n: 0, ys: [] } };
      const inHall = (a, i) => {
        const x = a[i*3], y = a[i*3+1], z = a[i*3+2];
        return (x > HAL.x0 && x < HAL.x1 && z > HAL.z0 && z < HAL.z1) ? y : null;
      };
      const inFront = (a, i) => {
        const x = a[i*3], y = a[i*3+1], z = a[i*3+2];
        return x > FRONT.x0 && x < FRONT.x1 && z > FRONT.z0 && z < FRONT.z1 && y > FRONT.y0 && y < FRONT.y1;
      };
      for (let f = 0; f < 24; f++){
        await new Promise(r => requestAnimationFrame(r));
        let hallThis = 0, cavThis = 0, frontThis = 0;
        for (const S of G.PRECIP.list){
          const key = S === G.PRECIP.rain ? 'rain' : 'snow';
          const dr = S.points.geometry.drawRange.count;
          const rendered = dr === Infinity ? S.n : Math.min(S.n, dr);
          const a = S.arr;
          let c = 0;
          for (let i = 0; i < rendered; i++){
            if (inFront(a, i)) frontThis++;
            const y = inHall(a, i);
            if (y === null) continue;
            if (y > 0 && y < 6.4){
              c++; hallThis++;
              if (out[key].ys.length < 12 && y > 4.9) out[key].ys.push(+y.toFixed(1));
            } else if (y >= 6.4 && y < 12) cavThis++;      // 天花以上：只作"体积确实罩住了堂"的证据
          }
          out[key].worst = Math.max(out[key].worst, c);
          out[key].rendered = rendered; out[key].n = S.n;
        }
        out.hall.worst = Math.max(out.hall.worst, hallThis);
        out.cavity.worst = Math.max(out.cavity.worst, cavThis);
        out.front.worst = Math.max(out.front.worst, frontThis);
      }
      return out;
    });
  };
  /* ⚠️⚠️ **机位必须先摆到堂前**（写这道门时第一版没做，负例对照当场戳穿）：
     雨雪体积是"跟着相机走的 ±30m 盒"，默认机位离堂很远，体积只擦到堂的前沿 ——
     实测默认机位下"堂内粒子"恒为 **0**，于是判据**无论产品对错都是绿的**（假门）。
     现在把机位摆到堂前 (0,3.2,-1.6) 朝堂看，体积完整罩住堂；
     并且下面加一条**前置断言**（天花以上必须有粒子）来证明"体积真的罩住了"，
     体积一旦没罩住，前置断言会立刻报红，而不是让主判据静默变绿。 */
  await page.evaluate(() => {
    const G = window.__garden;
    G.camera.position.set(0, 3.2, -1.6);
    G.camera.fov = 46; G.camera.updateProjectionMatrix();
    G.controls.target.set(0, 3.6, -12.8); G.controls.update();
  });
  const snowRep = await scan('snow');
  const rainRep = await scan('storm');
  const snow = snowRep.snow, rain = rainRep.rain;

  check('前置：雨雪体积确实罩住了远香堂（天花以上量到粒子）',
    snowRep.cavity.worst > 0,
    `雪·屋顶空腔最坏一帧 ${snowRep.cavity.worst} 个（若为 0＝体积没罩住，本门下面几条全部失效）`);
  check('雪天：堂内（天花以下）不得有雪粒子', snow.worst === 0,
    snow.worst ? `最坏一帧 ${snow.worst} 个（y>4.9 的样本 ${JSON.stringify(snow.ys)}）`
               : `24 帧全 0（每帧提交渲染 ${snow.rendered}/${snow.n}）`);
  check('暴雨：堂内不得有雨粒子', rain.worst === 0,
    rain.worst ? `最坏一帧 ${rain.worst} 个（y>4.9 的样本 ${JSON.stringify(rain.ys)}）`
               : `24 帧全 0（每帧提交渲染 ${rain.rendered}/${rain.n}）`);
  check('堂内前沿那条带（门洞所在）不得有雨雪粒子', snowRep.front.worst === 0,
    snowRep.front.worst ? `最坏一帧 ${snowRep.front.worst} 个`
                        : '24 帧全 0（前沿带 x±9.7 / y 0~6.4 / z -9.2~-8.85）');
  /* ⚠️ 上面两条是"零容忍"判据，必须配自检说明它真的被测到了东西：
     否则粒子系统整体失效（一个都不画）时它们也会绿。 */
  check('自检：粒子系统确实在跑（雪与雨的提交数都 > 0）',
    snow.rendered > 0 && rain.rendered > 0,
    `雪 ${snow.rendered} / 雨 ${rain.rendered}`);

  check('全程零 pageerror', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[indoor-precip-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[indoor-precip-guard] 崩溃:', e); process.exit(2); });
