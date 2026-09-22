/* 水面真折射 pass 的**开销实测** —— 只读诊断，未入链。
 *
 * 为什么重写（上一轮的 `_refract-perf.mjs` 已归 `_attic/`）：口径有三处硬伤 ——
 *   ① 两次采样是**两次独立浏览器会话**（不同进程 / 不同预热状态）；
 *   ② p95 报出 **−0.30ms**（＝噪声大于信号），却仍被当成"便宜 1.2%"用；
 *   ③ README 里"核显档也开得起"是**推断**，没测。
 *
 * 本脚本的四条纪律：
 *   A. **同一会话内交替开关**（skip / noskip / skip / noskip），漂移被交替抵消；
 *   B. **先量噪声底**：第 1 个窗口与第 3 个窗口状态**完全相同**，两者之差就是测量噪声；
 *   C. **脱离 vsync 地板**：加 `--disable-frame-rate-limit`。不禁用帧率上限时，
 *      rAF 恒在 16.7ms 打满 → 再大的开销差也被量化成 0，这是上一轮"测不出差异"的真原因；
 *   D. **消融点写明**：只拦 `renderer.render(scene, refractCam)` 的这一次调用
 *      （target 切换与清屏仍在执行）→ 测到的是"折射 pass 的**绘制调用**开销"，
 *      不是整套 feature 的全部开销。宁可报下界，也别含糊其辞。
 *
 * 判据：`skip` 窗口的中位帧时 − `noskip` 窗口的中位帧时 = 折射 pass 的边际开销。
 *      与噪声底相比 <1× 就说明**测不出**，那就如实写"测不出"，不许编数。
 *
 * 用法:
 *   node probe/_refract-perf.mjs                 # 真 GPU（D3D11/ANGLE）
 *   node probe/_refract-perf.mjs --frames=12     # 自定义每窗帧数
 *   GARDEN_SOFT=1 node probe/_refract-perf.mjs --frames=10   # 软渲染＝最弱档代理
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, CHROMIUM_ARGS } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* ⚠️ 无值开关（`--skipref`）必须解析成真值：`'--skipref'.split('=')` 只有一段，
   直接喂 `Object.fromEntries` 会得到 `undefined` —— 于是开关"传了不生效"（实测踩过）。 */
const argv = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--'))
  .map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? '1' : v]; }));
const FRAMES = +(argv.frames || 400);
const WINDOWS = +(argv.windows || 6);
const SOFT = process.env.GARDEN_SOFT === '1';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
               '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await launchChromium(chromium, {
    args: SOFT ? [...CHROMIUM_ARGS] : [...CHROMIUM_ARGS, '--disable-frame-rate-limit'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000, polling: 300 });
  await page.waitForFunction(() => window.__garden.koiGroup.userData.fishes.length >= 11,
    { timeout: 300000 });
  await sleep(2500);

  /* 固定场景与机位：折射 pass 的开销与主相机无关，但主 pass 的开销有关，
     所以机位必须固定，否则窗口之间没有可比性。 */
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
    g.gotoViewpoint('hero');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000 }).catch(() => {});
  let prev = null;
  for (let i = 0; i < 80; i++){
    const p = await page.evaluate(() => { const c = window.__garden.camera.position; return [c.x, c.y, c.z]; });
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) < 1e-4) break;
    prev = p; await sleep(150);
  }
  await sleep(1200);

  /* 装钩子：拦"给折射相机渲"的那一次 renderer.render。
     ⚠️ 两条必须写下来的口径（第一条我第一版就写错过）：
       ① `renderer.info.autoReset = false`（`02-scene.js:56`，为统计整帧），loop 每帧手动
          `info.reset()` 一次 → **同一帧内多个 pass 的计数是累加的**。所以"读一次 info.render.calls"
          拿到的不是本 pass 的量，而是"本帧到目前为止"的累加值（第一版就据此算出"折射占 106%"的
          荒谬结论）。**必须取调用前后的差值**。
       ② 折射相机是这个场景里**唯一** `isOrthographicCamera && layers.mask === 1<<LAYER_REFRACT`
          的相机，所以用这个判据认它，不靠名字也不靠引用。
     JS 侧的 `performance.now()` 只是"提交耗时"（真正的 GPU 执行是异步的），仅作量级参考。 */
  const info = await page.evaluate(() => {
    const g = window.__garden, R = g.renderer;
    const gl = R.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const MASK = 1 << g.refractInfo().layer;
    window.__perf = { skip: false, removed: 0, frames: [], calls: 0, tris: 0, cpu: 0,
                      mainCalls: 0, mainTris: 0, mainCpu: 0 };
    const orig = R.render.bind(R);
    R.render = function (sc, cam){
      const isRefract = cam && cam.isOrthographicCamera && cam.layers.mask === MASK;
      if (isRefract && window.__perf.skip){ window.__perf.removed++; return; }
      const c0 = R.info.render.calls, t0 = R.info.render.triangles, p0 = performance.now();
      const r = orig(sc, cam);
      const dc = R.info.render.calls - c0, dt = R.info.render.triangles - t0,
            dp = performance.now() - p0;
      if (isRefract){
        window.__perf.calls = dc; window.__perf.tris = dt; window.__perf.cpu = dp;
      } else if (cam === g.camera){
        window.__perf.mainCalls = dc; window.__perf.mainTris = dt; window.__perf.mainCpu = dp;
      }
      return r;
    };
    return {
      mask: MASK,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(unknown)',
      qos: g.qosState(), refract: g.refractInfo(),
    };
  });
  await sleep(600);
  const det = await page.evaluate(() => window.__perf);
  console.log(`[环境] ${SOFT ? '软渲染（最弱档代理）' : '真 GPU：' + info.gpu}`
            + ` ｜ 帧率上限 ${SOFT ? '未禁用' : '已禁用（远离 vsync 地板）'}`
            + ` ｜ 折射层=${info.mask} 贴图 ${info.refract.texW}×${info.refract.texH}`
            + ` ｜ QOS=${JSON.stringify(info.qos)}`);
  console.log(`[确定性指标·不吃噪声] 折射 pass ${det.calls} 次 draw call / ${det.tris.toLocaleString()} 三角形`
            + ` ｜ JS 提交 ${det.cpu.toFixed(2)}ms`
            + `\n                        主 pass ${det.mainCalls} 次 / ${det.mainTris.toLocaleString()} 三角形`
            + ` ｜ JS 提交 ${det.mainCpu.toFixed(2)}ms`
            + `\n                        → 折射占三角形 ${(det.tris / det.mainTris * 100).toFixed(2)}%`
            + `、占 draw call ${(det.calls / det.mainCalls * 100).toFixed(1)}%`
            + `（渲在 ${info.refract.texW}×${info.refract.texH} 半分辨率目标、不渲阴影）`
            + `\n                        ⚠️ 分母不是"整帧"：主相机（cam === g.camera）的那一次 render 里`
            + `含**阴影贴图**的绘制，且阴影尺寸随后处理档位变（真 GPU 105 call/679k，软渲染 248 call/1.06M）`
            + `—— 这个差异**本脚本没解释清楚**，所以上面两个百分比只当量级看，`
            + `结论以**折射 pass 自己的绝对量**（${det.calls} call / ${det.tris.toLocaleString()} 三角形 / 半分辨率 / 无阴影）为准\n`);
  console.log(`[计时] 每窗 ${FRAMES} 帧，${WINDOWS} 窗交替 skip / noskip\n`);

  const arms = [];
  for (let w = 0; w < WINDOWS; w++){
    const skip = w % 2 === 0;                 // skip / noskip / skip / noskip …
    const r = await page.evaluate(async ({ skip, n }) => {
      const P = window.__perf; P.skip = skip; P.frames = [];
      await new Promise(res => {
        let last = 0, i = 0;
        const tick = (t) => {
          if (last) P.frames.push(t - last);
          last = t;
          if (++i > n) return res();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const f = P.frames.slice(3).sort((a, b) => a - b);   // 丢前 3 帧（切开关的过渡）
      const trim = f.slice(Math.floor(f.length * 0.05), Math.ceil(f.length * 0.95)); // 去尾 5%：调度抖动与偶发 300ms 卡顿不是本 pass 的性质
      return { kept: f.length, median: f[f.length >> 1],
               trimMean: trim.reduce((a, b) => a + b, 0) / trim.length,
               p95: f[Math.min(f.length - 1, Math.floor(f.length * 0.95))],
               max: f[f.length - 1], removed: P.removed };
    }, { skip, n: FRAMES });
    arms.push({ skip, ...r });
    console.log(`[${skip ? 'skip ' : 'noskip'}] ${w + 1}/${WINDOWS} ｜ 帧数 ${r.kept}`
              + ` ｜ 中位 ${r.median.toFixed(2)}ms ｜ 去尾均值 ${r.trimMean.toFixed(2)}ms`
              + ` ｜ p95 ${r.p95.toFixed(2)}ms ｜ max ${r.max.toFixed(0)}ms`
              + ` ｜ 累计拦 render ${r.removed} 次`);
  }

  const skips = arms.filter(a => a.skip), nos = arms.filter(a => !a.skip);
  const medOf = (arr, k) => { const b = arr.map(x => x[k]).sort((a, z) => a - z); return b[b.length >> 1]; };
  const skipMed = medOf(skips, 'trimMean'), noMed = medOf(nos, 'trimMean');
  /* 噪声底＝同状态两窗之间的最大差（不是"两档之间"） */
  const noise = Math.max(...skips.map((a, i) => skips.slice(i + 1).map(b => Math.abs(a.trimMean - b.trimMean))).flat(),
                         ...nos.map((a, i) => nos.slice(i + 1).map(b => Math.abs(a.trimMean - b.trimMean))).flat());
  const delta = noMed - skipMed;
  console.log(`\n[结论·计时] 折射 pass 边际开销 = ${delta.toFixed(2)}ms/帧`
            + `（noskip 去尾均值 ${noMed.toFixed(2)} − skip ${skipMed.toFixed(2)}）`
            + ` ｜ 噪声底（同状态窗间最大差）= ${noise.toFixed(2)}ms`);
  console.log(`            → ${Math.abs(delta) > noise * 2
              ? `信号 ≥2× 噪声（${(Math.abs(delta) / (noise || 1)).toFixed(1)}×），此数可用`
              : `⚠️ 信号 < 2× 噪声（信噪比 ${(Math.abs(delta) / (noise || 1)).toFixed(1)}×）→ **测不出**，`
                + `只能记"无明显差异"；此时以上面的**确定性 draw call / 三角形占比**为准`}`);

  /* 第二问：整套折射**开 / 关**（换 URL 重开，作为"省不省得起"的量级参照） */
  /* 第二问：整套折射**开 / 关**（换 URL 重开，作为"省不省得起"的量级参照）。
     软渲染下这一问要多开一页（软渲染启动就 1~2 分钟），所以给了 `--skipref` 开关。 */
  if (argv.skipref){
    console.log('\n[整套开关] 已按 --skipref 跳过（软渲染下省一次页面启动）');
  } else {
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page2.on('pageerror', e => errs.push(String(e)));
  await page2.goto(`http://127.0.0.1:${port}/index.html?refract=0`, { waitUntil: 'load' });
  await page2.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000, polling: 300 });
  await page2.waitForFunction(() => window.__garden.koiGroup.userData.fishes.length >= 11,
    { timeout: 300000 });
  await sleep(2000);
  await page2.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
    g.gotoViewpoint('hero');
  });
  prev = null;
  for (let i = 0; i < 80; i++){
    const p = await page2.evaluate(() => { const c = window.__garden.camera.position; return [c.x, c.y, c.z]; });
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) < 1e-4) break;
    prev = p; await sleep(150);
  }
  await sleep(1200);
  const off = await page2.evaluate(async (n) => {
    const f = [];
    await new Promise(res => {
      let last = 0, i = 0;
      const tick = (t) => { if (last) f.push(t - last); last = t; if (++i > n) return res(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const g = f.slice(3).sort((a, b) => a - b);
    const trim = g.slice(Math.floor(g.length * 0.05), Math.ceil(g.length * 0.95));
    return { kept: g.length, median: g[g.length >> 1],
             trimMean: trim.reduce((a, b) => a + b, 0) / trim.length,
             p95: g[Math.min(g.length - 1, Math.floor(g.length * 0.95))] };
  }, FRAMES);
  console.log(`\n[整套开关] ?refract=0 去尾均值 ${off.trimMean.toFixed(2)}ms（中位 ${off.median.toFixed(2)} / p95 ${off.p95.toFixed(2)}）`
            + ` vs 开 ${noMed.toFixed(2)}ms → 整套差 ${(off.trimMean - noMed).toFixed(2)}ms`
            + `（含主 pass 的水面着色差异，不等于纯 pass 开销）`);
  }

  fs.writeFileSync(path.join(ROOT, 'outputs', `_refract-perf${SOFT ? '-soft' : ''}.json`),
    JSON.stringify({ soft: SOFT, gpu: info.gpu, frames: FRAMES, windows: WINDOWS,
                     deterministic: { refractCalls: det.calls, refractTris: det.tris,
                                      refractCpu: det.cpu, mainCalls: det.mainCalls,
                                      mainTris: det.mainTris, mainCpu: det.mainCpu,
                                      texW: info.refract.texW, texH: info.refract.texH },
                     arms, noise, delta, offTrimMean: off ? off.trimMean : null }, null, 2));
  console.log(`\n[异物] pageerror=${errs.length}${errs.length ? ' → ' + errs[0] : ''}`);
  await browser.close();
  server.close();
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
