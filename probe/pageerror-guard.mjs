// 运行时异常守卫门禁：node probe/pageerror-guard.mjs
//
// ── 为什么需要它（2026-09-19 老黄报障「这几个功能切换已经不起作用了」）──
// 上一轮误加了一套与原生 PRECIP 重复的降水实现，其 update() 读
//   this.particles.attributes.userData.velocity   // attributes 无 userData
// → 每帧抛 TypeError。而 animate() 的结构是：
//   [9278] requestAnimationFrame(animate)   ← 循环排程在**函数开头**，所以循环不死
//   [9433] RAIN_SYSTEM.update(...)          ← 异常点在**中段**
//   [9547] composer.render()                ← 渲染在**末尾** → 永不执行
// 结果：状态照改、ENV 照写、一切"看起来都正常"，**只有画面冻结**。
//
// ⚠️ 这个缺陷完美绕过了旧门禁：
//   · check 只做语法 —— `attributes.userData` 语法完全合法；
//   · smoke 的「零 console error / pageerror」只在**启动段**判一次，
//     而该异常只在**切天气之后**才出现；
//   · smoke 断言的是 ENV 状态落位 —— 而状态本来就是对的。
// 于是三项全绿、用户却什么都切不动。本探针补的正是这三个盲区。
//
// 三条判据（都是"不报错也照样错"的静默失效，必须可观测）：
//   ① 零 pageerror —— 且**在每次交互之后**都查，不只查启动；
//   ② 渲染活性 —— 同状态下连续截图若**字节完全相同**，说明 render 没在跑
//      （园林有风 / 锦鲤 / 涟漪 / 雾 / 云漂移，正常时两帧绝不可能全同）；
//   ③ 画面响应性 —— 切暴雨的画面差必须**远大于**同状态两帧的基线差，
//      否则就是"状态变了但画面没动"（旧基线：同状态 0.869，切暴雨 0.80 ← 反向！）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
import { decodePNG, meanAbsDiff, meanLuma } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'pageerror-guard');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });

  /* ── 异常收集：全程累积，不清空（每次交互后做**增量**检查） ── */
  const pageErrors = [];
  const consoleErrors = [];
  let mark = 'boot';
  page.on('pageerror', e => pageErrors.push({ at: mark, text: String(e && e.message || e) }));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ at: mark, text: m.text() }); });
  const errsSince = n => pageErrors.length - n;

  console.log(`\n[pageerror-guard] http://127.0.0.1:${port}/index.html`);

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(1200);

  check('启动完成且零 pageerror', errsSince(0) === 0,
    errsSince(0) ? pageErrors[0].text : '无异常');

  /* 过渡由仿真时间推进，轮询 ENV.t>=1（与 smoke 同一范式） */
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 40000, polling: 200 }).then(() => true).catch(() => false);
  const shot = async (name) => {
    const buf = await page.screenshot();
    if (name) fs.writeFileSync(path.join(OUT, name + '.png'), buf);
    return buf;
  };
  const envNow = () => page.evaluate(() => ({
    time: window.__garden.ENV.time, season: window.__garden.ENV.season,
    weather: window.__garden.ENV.weather, tor: window.__garden.ENV.t,
  }));

  /* ══ 判据 ②：渲染活性 —— 同状态连截 3 张，至少 2 张互不相同 ══
     这是"render 有没有在跑"的最直接证据，且不依赖任何页面内部计数。 */
  const idleBufs = [];
  for (let i = 0; i < 3; i++) {
    idleBufs.push(await shot(`idle-${i + 1}`));
    if (i < 2) await sleep(500);
  }
  const idleImgs = idleBufs.map(decodePNG);
  const idleDiffs = [
    meanAbsDiff(idleImgs[0], idleImgs[1]),
    meanAbsDiff(idleImgs[1], idleImgs[2]),
    meanAbsDiff(idleImgs[0], idleImgs[2]),
  ];
  const allSame = idleBufs.every(b => b.equals(idleBufs[0]));
  const idleBase = Math.max(...idleDiffs);
  check('渲染循环存活：同状态连续 3 帧画面在变化', !allSame,
    `逐帧差 ${idleDiffs.map(d => d.toFixed(3)).join(' / ')}${allSame ? '（三帧字节全同 = render 未执行）' : ''}`);
  check('活性基线量级健康（说明在真渲染而非定格）', idleBase > 0.05,
    `idleBase=${idleBase.toFixed(3)}（旧基线 0.869）`);

  /* ══ 真实 UI 点击路径（用户报障走的就是这条路） ══
     先把抽屉展开，再逐个点按钮 —— 用真实 click 而非 setEnv()，
     这样"绑定断了 / 面板被遮 / 命中区塌了"都能一并抓到。 */
  await page.click('#env .drawer-toggle');
  const expanded = await page.evaluate(() => document.getElementById('env').classList.contains('expanded'));
  check('星号开关可展开抽屉（真实点击）', expanded);

  const readPanel = () => page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#env .drawer-content'));
    return { vis: s.visibility, op: s.opacity, pe: s.pointerEvents };
  });
  const btnBefore = await readPanel();     // 过渡中：预期仍是 hidden
  /* ⚠️ 必须**轮询到可见**，不能读一次：面板的 CSS 是
       transition: opacity .26s, transform .26s, **visibility .26s**
     —— visibility 一旦进了 transition，就在过渡**结束点**才突变，
     于是「点完 toggle 立刻读 computed style」必然读到收起态的 hidden。
     这不是产品缺陷（延迟隐藏正是为了避免面板瞬间消失的跳变），
     而是探针"读一次"的写法踩了自己的坑 —— 同类问题在本项目已多次出现
     （smoke 的 waitStats 注释里记着同一教训：判据要改成轮询到谓词成立）。 */
  const panelVisible = await page.waitForFunction(() => {
    const s = getComputedStyle(document.querySelector('#env .drawer-content'));
    return s.visibility === 'visible' && Number(s.opacity) > 0.9 && s.pointerEvents !== 'none';
  }, { timeout: 5000, polling: 50 }).then(() => true).catch(() => false);
  const btnAfter = await readPanel();
  check('展开后面板可命中（visibility/opacity/pointer-events，轮询到位）',
    panelVisible, `过渡中 ${JSON.stringify(btnBefore)} → 到位 ${JSON.stringify(btnAfter)}`);

  /* 逐轴真实点击：每个按钮点完都要 ①ENV 落位 ②零新增异常 */
  const AXES = [
    { axis: 'time',    vals: ['morning', 'noon', 'dusk', 'night'],  key: 'time' },
    { axis: 'season',  vals: ['spring', 'summer', 'autumn', 'winter'], key: 'season' },
    { axis: 'weather', vals: ['clear', 'storm', 'overcast', 'mist'], key: 'weather' },
  ];
  for (const { axis, vals, key } of AXES) {
    const before = pageErrors.length;
    const hit = [];
    for (const v of vals) {
      mark = `click ${axis}=${v}`;
      await page.click(`button[data-axis="${axis}"][data-v="${v}"]`, { timeout: 8000 })
        .catch(e => hit.push(`${v}:click失败`));
      await settled();
      const st = await envNow();
      if (st[key] !== v) hit.push(`${v}→实际${st[key]}`);
    }
    check(`真实点击 ${axis} 全 4 档：状态落位`, hit.length === 0, hit.join(', ') || vals.join('/'));
    check(`真实点击 ${axis}：零 pageerror`, errsSince(before) === 0,
      errsSince(before) ? pageErrors.slice(before).map(e => `${e.at}: ${e.text}`).join(' | ') : '无异常');
  }

  /* 冬季才能下雪：先切冬，再切雪 —— 这条路径专门覆盖 snowAmount 分支 */
  {
    const before = pageErrors.length;
    mark = 'click winter→snow';
    await page.click('button[data-axis="season"][data-v="winter"]');
    await settled();
    await page.click('button[data-axis="weather"][data-v="snow"]');
    await settled();
    const st = await envNow();
    check('真实点击 冬季+雪：雪天合法生效', st.season === 'winter' && st.weather === 'snow',
      JSON.stringify(st));
    check('真实点击 冬季+雪：零 pageerror（覆盖 snow 渲染分支）', errsSince(before) === 0,
      errsSince(before) ? pageErrors.slice(before).map(e => e.text).join(' | ') : '无异常');
  }

  /* ══ 判据 ③：画面响应性 —— 状态变了，画面必须跟着动 ══
     先用 setEnv 回到 clear 取基准，再切 storm 比对。
     判据取「远大于同状态基线」，因为同状态两帧本来就有 0.87 的差（风在吹）。 */
  await page.evaluate(() => { window.__garden.setEnv('weather', 'clear'); window.__garden.setEnv('season', 'summer'); });
  await settled(); await sleep(600);
  const clearImg = decodePNG(await shot('A-clear'));
  await page.evaluate(() => window.__garden.setEnv('weather', 'storm'));
  await settled(); await sleep(600);
  const stormImg = decodePNG(await shot('B-storm'));
  const dWeather = meanAbsDiff(clearImg, stormImg);
  check('画面响应天气：切暴雨的像素差远大于同状态基线',
    dWeather > Math.max(2.0, idleBase * 2.5),
    `diff=${dWeather.toFixed(3)} vs 阈值 ${Math.max(2.0, idleBase * 2.5).toFixed(3)}（同状态基线 ${idleBase.toFixed(3)}）`);

  /* 时段：夜必须真的比正午暗（旧代码里这条也会被冻结掩盖） */
  await page.evaluate(() => window.__garden.setEnv('weather', 'clear'));
  await settled();
  await page.evaluate(() => window.__garden.setEnv('time', 'noon'));
  await settled(); await sleep(600);
  const noonImg = decodePNG(await shot('C-noon'));
  await page.evaluate(() => window.__garden.setEnv('time', 'night'));
  await settled(); await sleep(600);
  const nightImg = decodePNG(await shot('D-night'));
  const lumaNoon = meanLuma(noonImg), lumaNight = meanLuma(nightImg);
  check('画面响应时段：夜色显著暗于正午', lumaNight < lumaNoon * 0.75,
    `luma noon=${lumaNoon.toFixed(1)} → night=${lumaNight.toFixed(1)}（${(lumaNight / lumaNoon * 100).toFixed(0)}%）`);

  /* 回到白天，顺便覆盖一次 resetCamera 路径 */
  await page.evaluate(() => { window.__garden.setEnv('time', 'noon'); window.__garden.resetCamera(); });
  await settled();

  /* ══ 判据 ①（总结）：全程累计零异常 ══ */
  check('全程累计 pageerror = 0', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条，首条 @${pageErrors[0].at}: ${pageErrors[0].text}` : '0 条');
  check('全程累计 console.error = 0', consoleErrors.length === 0,
    consoleErrors.length ? `${consoleErrors.length} 条，首条: ${consoleErrors[0].text}` : '0 条');

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n[pageerror-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) {
    console.log('失败项：');
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  }
  console.log(`样张：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[pageerror-guard] 崩溃:', e); process.exit(2); });
