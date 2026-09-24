// 反射按需更新门禁（计划书第 2 项 · 2026-09-24）
//
// 守什么：水面平面反射（Reflector 把整场景再渲一遍，是高档位最大的一笔开销之一）应当
//   **按需刷新**，而不是每帧重渲：
//     · 相机在动（拖动/运镜）⇒ 必须**每帧**（v2.0 补注：快速拖动时人对反射滞后极敏感，
//       不能为了省开销让它"慢半拍"）；
//     · 水面活跃（下雨 / 有涟漪 / 时光流转）⇒ 每帧；
//     · 相机静止且水面静默（观景态）⇒ 降频（每 N 帧一次）。
//   ⚠️ 判据不依赖任何产品侧埋点：本门在页内**包裹 `waterSurface.onBeforeRender` 计数** ——
//      数的是"反射贴图真的重渲了几次"，这正是要守的东西（换实现也不会失效）。
//
// 为什么这么判：① 静止态若仍是 1:1，说明"按需更新"没做（或失效）⇒ 红；
//   ② 运动态若不是 1:1，说明为了省开销牺牲了拖动观感 ⇒ 红（这条比省开销更重要）；
//   ③ 相机跳变后必须在 ≤2 帧内刷出反射（延迟 <100ms 的机器可验版本）。
//
// ⚠️ 档位分支（2026-09-24 修）：**核显档（low）下平面反射是按设计整条关掉的**
//   （src/05-water.js：`GPU_TIER==='low'` ⇒ `onBeforeRender` 置空 + `uReflMix=0`）。
//   门禁先读产品自己的 `uReflMix` 开关**断言前提**：
//     · 开（独显档）⇒ 走上面 ①②③ 的速率判据；
//     · 关（核显档）⇒ 改为断言"24 帧零重渲"（有牙：低档位偷偷开反射 = 性能红线 ⇒ 红）。
//   不分支的话，核显档上 ①②③ 必然红、而"降频 ≤60% 满速"会因 0 ≤ 0 **假绿**。
// 用法: node probe/reflect-adaptive.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require2 = createRequire(import.meta.url);
  try { return require2('playwright'); } catch {}
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require2(path.join(g, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  await new Promise(r => server.listen(13000 + ((Math.random() * 17000) | 0), r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  console.log(`\n[reflect-adaptive] http://127.0.0.1:${port}/index.html`);
  /* 档位可强制（`TIER=low|mid|high`）：本门要同时守住两个档位的**不同**判据，
     而 ANGLE 每次挑哪块 GPU 不固定 ⇒ 不强制就没法确定性地验到某一条分支。 */
  const TIERQ = process.env.TIER ? '&tier=' + process.env.TIER : '';

  await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0' + TIERQ, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 180000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });

  /* 计数器：读产品侧 `waterSurface.userData.reflectCount`（在 `reflectOnce` 调用点自增）。
     ⚠️ 不在 `onBeforeRender` 上包一层数：那个回调每帧会被调用多次（主 pass + 折射 pass + AO 的
     辅助 pass），数出来的是"被叫了几次"而不是"反射真的重渲了几次"（实测差 2 倍）。
     反射贴图只有 Reflector 那一条渲染路径 ⇒ 在它的调用点计数就是实现无关的"真实次数"。 */
  const setup = await page.evaluate(() => {
    const g = window.__garden;
    const w = g.scene.getObjectByName('waterSurface');
    if (!w) return { ok: false, why: '找不到 waterSurface' };
    window.__refl = { w, n: 0, frames: 0 };
    return { ok: true, has: typeof w.userData.reflectCount === 'number',
             count: w.userData.reflectCount };
  });
  if (!setup.ok){ check('找到水面（Reflector）', false, setup.why); }
  else {
    check('找到水面（Reflector）且已装反射计数器', true,
      `reflectCount=${setup.count}${setup.has ? '' : '（首次读取前为 undefined，正常）'}`);
    /* ⚠️ 前提断言（2026-09-24 修）：**低档位（核显档）下平面反射是按设计整条关掉的**
       （src/05-water.js：`GPU_TIER==='low'` ⇒ `onBeforeRender` 置空 + `uReflMix=0`）。
       不先断言这个前提，"反射满速/降频"那几条在核显档上必然红（实测 3 条红），
       而且"降频 ≤60% 满速"会因 `0 ≤ 0` 变成**假绿**（判据用错了前提）。
       ⇒ 按"反射是否真的开着"（读产品自己的 uReflMix 开关，而不是猜档位）分两条判据。 */
    const reflOn = await page.evaluate(() => {
      const w = window.__garden.scene.getObjectByName('waterSurface');
      const u = w.material && w.material.uniforms && w.material.uniforms.uReflMix;
      return u ? u.value > 0.5 : true;      // 读不到开关时保守按"开"处理（走原速率判据）
    });
    console.log(`  平面反射开关 uReflMix：${reflOn ? '开 ⇒ 走速率判据' : '关（核显档按设计）⇒ 只断言"零重渲"'}`);
    /* 采样工具：在页内跑 n 帧，返回 (反射重渲次数, 帧数) */
    const sample = (frames, driver) => page.evaluate(async ({ frames, driver }) => {
      const g = window.__garden;
      const r = window.__refl;
      /* 独占相机：每帧显式设置（controls.update 会覆写 target，所以要走 controls） */
      const setCam = (k) => {
        const c = g.controls, cam = g.camera;
        c.target.set(0, 3.5, 0);
        const a = 0.9 + (driver === 'orbit' ? k * 0.012 : 0);      // 每帧转 0.012rad ≈ 0.7°
        const R = 22;
        cam.position.set(Math.sin(a) * R, 9, Math.cos(a) * R + 3);
        c.update();
      };
      /* ⚠️ 先"预热" 20 帧（只驱动、不计数）：产品有 SETTLE_FRAMES=12 —— 停下后再满速 12 帧
         让最后位置/涟漪落定，那是**设计的一部分**。把它算进 30 帧的测量会让静止态比率
         贴近 0.6 的阈值边界（实测 12 帧满速 + 18 帧 1/3 ≈ 0.6），属于判据自己找边。 */
      for (let k = 0; k < 20; k++){ setCam(k); await new Promise(res => requestAnimationFrame(res)); }
      r.n = r.w.userData.reflectCount || 0; r.frames = 0;
      for (let k = 0; k < frames; k++){
        setCam(k);
        await new Promise(res => requestAnimationFrame(res));
        r.frames++;
      }
      return { refl: (r.w.userData.reflectCount || 0) - r.n, frames: r.frames };
    }, { frames, driver });

    if (reflOn){

    /* ⚠️ 先把"水面静默"这个**前提**建立起来再测静止态：默认天气可能是雨，锦鲤也会出水起涟漪
       —— 那两种情况按设计**就该满速**刷反射，拿它们测"降频"是判据用错了前提。
       所以本门要求产品暴露 `waterBusy()`：判据要能**断言**前提成立，而不是假设它成立。 */
    await page.evaluate(() => { window.__garden.setEnv('weather', 'clear'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 });
    const quiet = await page.waitForFunction(
      () => window.__garden.waterBusy && window.__garden.waterBusy() === false,
      null, { timeout: 90000, polling: 200 }).then(() => true).catch(() => false);
    check('前置条件：水面已静默（晴 + 池里无涟漪）—— 否则"降频"这条前提不成立',
      quiet, quiet ? '' : '90s 内 waterBusy() 始终为真（有雨或有涟漪）');

    /* A. 静止（相机每帧设到同一处，但**位置不变** ⇒ 应判定为"静止"） */
    await page.evaluate(() => {
      const g = window.__garden, c = g.controls, cam = g.camera;
      c.target.set(0, 3.5, 0); cam.position.set(Math.sin(0.9) * 22, 9, Math.cos(0.9) * 22 + 3); c.update();
    });
    await page.waitForTimeout(400);
    const A = await sample(30, 'static');
    /* B. 相机在动（每帧转 0.7°）⇒ 必须满速 */
    const B = await sample(30, 'orbit');
    /* ⚠️ 判据用**速率比**而不是绝对次数：实测 `onBeforeRender` 每帧会被触发 **2 次**
       （主 pass + 折射 pass 各一次）⇒ "每帧刷"对应的是 2×frames 而不是 frames。
       先拿运动态的速率当"满速基准"，再看静止态降到它的几成 —— 与"每帧触发几次"无关。 */
    const rateMove = B.refl / B.frames;
    check('相机在动：反射**满速**刷新（拖动不许慢半拍）', B.refl >= B.frames * 0.9,
      `30 帧里重渲 ${B.refl} 次（满速基准 ${rateMove.toFixed(2)} 次/帧）`);
    check('静止观景：反射**降频**到 ≤60% 满速（不是每帧重渲）',
      A.refl <= A.frames * rateMove * 0.6,
      `30 帧里重渲 ${A.refl} 次 = ${(A.refl / Math.max(1e-6, A.frames * rateMove) * 100).toFixed(0)}% 满速（期望 ~33%）`);
    check('静止观景：仍持续刷新（不是冻住）', A.refl >= A.frames * rateMove * 0.15,
      `30 帧里重渲 ${A.refl} 次`);

    /* C. 相机跳变 ⇒ 反射必须在 ≤2 帧内跟上（延迟 <100ms 的可验版本） */
    const C = await page.evaluate(async () => {
      const g = window.__garden, c = g.controls, cam = g.camera;
      const w = window.__refl.w;
      const c0 = w.userData.reflectCount || 0;
      c.target.set(0, 3.5, 0); cam.position.set(-18, 11, 14); c.update();
      await new Promise(res => requestAnimationFrame(res));
      const after1 = (w.userData.reflectCount || 0) - c0;   // 跳变后第 1 帧内重渲了几次
      await new Promise(res => requestAnimationFrame(res));
      return { after1, after2: (w.userData.reflectCount || 0) - c0 };
    });
    check('相机跳变后 ≤2 帧内刷出反射（无"慢半拍"）', C.after2 > C.after1 - 2 && C.after2 >= 1,
      `跳变后第 1/2 帧的累计重渲次数：${C.after1} / ${C.after2}`);

    /* D. 下雨（水面活跃）⇒ 每帧 */
    await page.evaluate(() => { window.__garden.setEnv('weather', 'storm'); });
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(600);
    const D = await sample(24, 'static');
    check('下雨（水面活跃）：反射每帧刷新', D.refl >= D.frames * 0.9,
      `24 帧里重渲 ${D.refl} 次（活跃态应为每帧）`);
    } else {
      /* 核显档：平面反射按设计整条关闭（uReflMix=0）—— 本门改为守"它确实没在重渲"。
         这条**有牙**：若谁在低档位偷偷开了反射（性能红线），reflectCount 会随帧增长 ⇒ 红；
         （原先那 4 条在这里要么红、要么因 0≤0 假绿，所以必须分开判。） */
      const off = await sample(24, 'orbit');
      check('核显档：平面反射按设计关闭 —— 24 帧零重渲（偷偷开会红）', off.refl === 0,
        `24 帧里重渲 ${off.refl} 次（应为 0）`);
    }
  }

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[reflect-adaptive] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('[reflect-adaptive] 探针自身异常：', e); process.exit(1); });
