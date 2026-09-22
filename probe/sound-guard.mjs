// 音景细化门禁：node probe/sound-guard.mjs
//
// 守的是 README P2-3「音景细化：音量控制 + 更多鸟种 + 夏季蝉鸣 + 蛙声」。
//
// 判据分两层：
//   ① **纯逻辑层**（`Snd.plan(p)`）：给定环境参数 → 各层目标音量。这是真正的业务内容
//      —— "夏天白天该有蝉、夏夜该有蛙、冬天没有虫鸣、暴雨里一切安静"。
//      把它做成纯函数就是为了能直接断言，不必依赖真的出声。
//   ② **接线层**（`Snd.levels()`）：真实 GainNode 的当前值有没有朝 plan 收敛。
//      只验"接上了"，不验音色（音色是主观的，量不了也不该量）。
//
// ⚠️ 音景是**全静默失效**类的东西：接线断了不报错、不崩、页面照常跑，
//    只有"该响的时候没响"才看得见 —— 而这在没有音频设备的 CI 里根本听不见。
//    所以必须有一道门把它变成可断言的数字。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[sound-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  await sleep(1200);

  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 40000, polling: 200 }).then(() => true).catch(() => false);

  /* 开音景（需要用户手势 —— 走真实点击，不用 evaluate 直接调 toggle）
     ⚠️ #env 是抽屉，默认收起：**必须先展开**，否则 click 会一直等"元素可见"直到超时。 */
  await page.click('#env .drawer-toggle');
  await sleep(400);
  await page.click('button[data-act="sound"]', { timeout: 15000 });
  await sleep(600);
  const on = await page.evaluate(() => window.__garden.sndState());
  const st = await page.evaluate(() => window.__garden.sndCtxState());
  console.log(`  音景 on=${on} ctx=${st}`);
  check('点击「音景」按钮真的开了（走真实点击，含自动播放策略）', on === true, `on=${on}`);

  const setEnv = async (axis, v) => {
    await page.evaluate(([a, x]) => window.__garden.setEnv(a, x), [axis, v]);
    await settled();
    await sleep(350);
  };
  const plan = () => page.evaluate(() => window.__garden.sndPlan(window.__garden.ENV.cur));
  const levels = () => page.evaluate(() => window.__garden.sndLevels());

  /* ── ① 纯逻辑层：哪一层该响 ── */
  const LAYERS = ['wind', 'rain', 'cricket', 'cicada', 'frog', 'bird'];
  const p0 = await plan();
  check('分层计划含六层（风 / 雨 / 虫 / 蝉 / 蛙 / 鸟）',
    LAYERS.every(k => k in p0), `实际键: ${Object.keys(p0).join(',')}`);

  await setEnv('time', 'noon'); await setEnv('season', 'summer'); await setEnv('weather', 'clear');
  const pSumNoon = await plan();
  check('夏·午·晴：蝉鸣起（夏季白天才有）', pSumNoon.cicada > 0, `cicada=${pSumNoon.cicada}`);
  check('夏·午·晴：无虫鸣、无蛙声（虫在夜里、蛙在夜/暮）',
    pSumNoon.cricket === 0 && pSumNoon.frog === 0,
    `cricket=${pSumNoon.cricket} frog=${pSumNoon.frog}`);

  await setEnv('time', 'night');
  const pSumNight = await plan();
  check('夏·夜·晴：虫鸣起', pSumNight.cricket > 0, `cricket=${pSumNight.cricket}`);
  check('夏·夜·晴：蛙声起（夏夜池塘）', pSumNight.frog > 0, `frog=${pSumNight.frog}`);
  check('夏·夜·晴：蝉歇了（蝉是白天叫的）', pSumNight.cicada === 0, `cicada=${pSumNight.cicada}`);

  await setEnv('season', 'winter'); await setEnv('weather', 'clear');
  const pWinNight = await plan();
  check('冬·夜：虫鸣 / 蝉 / 蛙全静（冬天没有这些生灵）',
    pWinNight.cricket === 0 && pWinNight.cicada === 0 && pWinNight.frog === 0,
    `cricket=${pWinNight.cricket} cicada=${pWinNight.cicada} frog=${pWinNight.frog}`);

  await setEnv('season', 'summer'); await setEnv('time', 'noon'); await setEnv('weather', 'storm');
  const pStorm = await plan();
  check('夏·午·暴雨：蝉 / 虫 / 蛙 / 鸟全静（暴雨里没有鸣虫）',
    pStorm.cicada === 0 && pStorm.cricket === 0 && pStorm.frog === 0 && pStorm.bird === 0,
    `cicada=${pStorm.cicada} cricket=${pStorm.cricket} frog=${pStorm.frog} bird=${pStorm.bird}`);
  check('夏·午·暴雨：雨声与风声都起来了',
    pStorm.rain > 0.1 && pStorm.wind > pSumNoon.wind, `rain=${pStorm.rain} wind=${pStorm.wind}`);

  await setEnv('weather', 'clear'); await setEnv('season', 'spring'); await setEnv('time', 'morning');
  const pSpringMorn = await plan();
  check('春·晨·晴：鸟鸣门开', pSpringMorn.bird > 0, `bird=${pSpringMorn.bird}`);

  /* ── 鸟种多样 ── */
  const birds = await page.evaluate(() => window.__garden.sndBirds());
  check('鸟种 ≥3 种（不止一种叫声）', Array.isArray(birds) && birds.length >= 3,
    `${birds && birds.length} 种：${(birds || []).map(b => b.name).join('/')}`);
  const distinctF0 = birds && new Set(birds.map(b => Math.round(b.f0[0] / 200))).size >= 3;
  check('三种鸟的基频带明显不同（音色不重复）', !!distinctF0,
    `f0 起点: ${(birds || []).map(b => b.f0[0]).join(',')}`);

  /* ── ② 接线层：真实 GainNode 有没有朝 plan 收敛 ── */
  await setEnv('season', 'summer'); await setEnv('time', 'noon'); await setEnv('weather', 'clear');
  await sleep(3200);                                   // setTargetAtTime τ=0.5，3.2s ≈ 6τ
  const lv = await levels();
  console.log(`  实际电平: ${JSON.stringify(lv)}`);
  check('蝉鸣节点真的响了（电平朝 plan 收敛，容差 40%）',
    lv.cicada > pSumNoon.cicada * 0.6,
    `cicada=${lv.cicada} 期望≈${pSumNoon.cicada}`);
  check('风声底噪恒在（0.015 起步，环境音不该全静）',
    lv.wind >= 0.010, `wind=${lv.wind}`);

  await setEnv('time', 'night'); await sleep(3600);
  const lvN = await levels();
  console.log(`  夜间电平: ${JSON.stringify(lvN)}`);
  check('蛙声节点真的响了', lvN.frog > 0, `frog=${lvN.frog}`);
  check('蝉鸣在夜里真的收了', lvN.cicada < pSumNoon.cicada * 0.15, `cicada=${lvN.cicada}`);

  /* ── 音量控制 ── */
  const volOk = await page.evaluate(() => {
    const g = window.__garden;
    const before = g.sndVolume();
    g.sndSetVolume(0.5);
    return { before, after: g.sndVolume() };
  });
  check('音量可读写（默认 1.0，设为 0.5 后回落）',
    volOk.before === 1 && Math.abs(volOk.after - 0.5) < 1e-6, JSON.stringify(volOk));

  await sleep(1200);
  const masterAfter = await page.evaluate(() => window.__garden.sndLevels().master);
  check('音量真的乘到了总线上（0.5 → master 降到 ≈0.5）',
    masterAfter > 0.3 && masterAfter < 0.7, `master=${masterAfter}`);

  const volSlider = await page.evaluate(() => {
    const el = document.getElementById('sndVol');
    return el ? { exists: true, min: el.min, max: el.max, step: el.step, val: el.value } : { exists: false };
  });
  check('面板上有音量滑杆（#sndVol，0~100）',
    volSlider.exists && volSlider.min === '0' && volSlider.max === '100', JSON.stringify(volSlider));

  /* 关掉：总线必须归零 */
  await page.click('button[data-act="sound"]');
  await sleep(1200);
  const off = await page.evaluate(() => ({ on: window.__garden.sndState(),
                                           master: window.__garden.sndLevels().master }));
  check('关音景后总线归零（不是只改了个布尔值）',
    off.on === false && off.master < 0.02, JSON.stringify(off));

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n[sound-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[sound-guard] 崩溃:', e); process.exit(2); });
