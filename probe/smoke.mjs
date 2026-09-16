// 冒烟回归门禁：npm test
// 无头浏览器加载真实页面，断言：启动零报错、几何合并零告警、资产到齐、
// 环境四轴切换与过渡、雪天互斥、相机复位、stats 更新、视口缩放。
// playwright 解析顺序：项目 node_modules → 全局 npm root（本机全局装有 playwright）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 本地没有，走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
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
/* 过渡由仿真时间推进（dt 钳到 50ms），软渲染低帧率下 2.8 秒过渡可能等 1 分钟。
   探针把 dur 调短 + 轮询 ENV.t>=1 —— 插值机制照跑，只是不等墙钟。 */
const settled = page => page.waitForFunction(() => window.__garden && window.__garden.ENV.t >= 1,
  { timeout: 30000, polling: 250 }).then(() => true).catch(() => false);

(async () => {
  await new Promise(r => server.listen(0, r));           // 随机可用端口
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  // 小视口：无头 SwiftShader 软渲染像素越少帧率越高，过渡等仿真推进才等得起
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleMsgs.push({ type: 'pageerror', text: String(e) }));

  console.log(`\n[smoke] http://127.0.0.1:${port}/index.html`);

  // ── 1. 启动 ──
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  const booted = await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 45000 }).then(() => true).catch(() => false);
  check('页面启动完成（loading 层收起，__garden 就绪）', booted);
  if (!booted) { finish(); return; }

  // ── 2. 控制台卫生（SwiftShader 软渲染的 CONTEXT_LOST/Restored 属环境噪声，放行）──
  await sleep(4000);
  const isEnvNoise = t => /CONTEXT_LOST|Context Lost|Context Restored/.test(t);
  const errors   = consoleMsgs.filter(m => m.type === 'error' || m.type === 'pageerror');
  const geoWarns = consoleMsgs.filter(m => m.type === 'warning' && m.text.includes('[几何校验]'));
  const assetFail = consoleMsgs.filter(m => m.text.includes('资产失败') || m.text.includes('加载失败'));
  check('零 console error / pageerror', errors.length === 0, errors.map(e => e.text.slice(0, 90)).join(' | '));
  check('几何合并零校验告警', geoWarns.length === 0, geoWarns.map(w => w.text.slice(0, 90)).join(' | '));
  check('零资产加载失败', assetFail.length === 0);

  // ── 3. 渲染量上限（防性能回退的硬门禁）──
  const info = await page.evaluate(() => {
    const r = window.__garden.renderer;
    return { calls: r.info.render.calls, tris: r.info.render.triangles,
             geos: r.info.memory.geometries, tex: r.info.memory.textures };
  });
  check(`draw calls 上限（${info.calls} < 800）`, info.calls < 800);
  check(`三角形上限（${info.tris.toLocaleString()} < 4,200,000）`, info.tris < 4_200_000);
  check('几何/纹理数量健康', info.geos < 800 && info.tex < 300, `geos=${info.geos} tex=${info.tex}`);

  // ── 4. GLB 资产到齐且动起来 ──
  const glb = await page.waitForFunction(() => {
    const names = { KoiFish: 0, Turtle: 0, BananaPlant: 0, LotusPlant: 0 };
    window.__garden.scene.traverse(o => {
      for (const k of Object.keys(names)) if (o.name && o.name.includes(k)) names[k]++;
    });
    return Object.values(names).every(n => n > 0) && window.__garden.ENV
      ? names : false;
  }, { timeout: 40000 }).then(v => v.jsonValue?.() ?? v).catch(() => null);
  check('四类 GLB 资产均已挂载', !!glb);
  const fishMoving = await page.evaluate(async () => {
    const fs = window.__garden.scene.getObjectByName?.call ? null : null;
    let group = null;
    window.__garden.scene.traverse(o => { if (o.userData && o.userData.fishes) group = o; });
    if (!group) return false;
    const p0 = group.userData.fishes[0].position.clone();
    await new Promise(r => setTimeout(r, 1200));
    return group.userData.fishes[0].position.distanceTo(p0) > 0.001;
  });
  check('锦鲤在游动（1.2 秒内位置变化）', fishMoving);

  // ── 5. 环境轴切换与过渡 ──
  await page.evaluate(() => { window.__garden.ENV.dur = 0.25; });   // 探针加速过渡（见 settled 注释）
  await page.evaluate(() => window.__garden.setEnv('time', 'night'));
  check('切夜：过渡完成（ENV.t 收敛）', await settled(page));
  const night = await page.evaluate(() => ({
    t: window.__garden.ENV.time, lum: window.__garden.scene.environmentIntensity,
    stats: document.getElementById('stats').textContent,
  }));
  check('切夜：状态落位', night.t === 'night');
  check('切夜：stats 标签联动', night.stats.includes('夜'),
        (night.stats.split('\n').find(l => l.includes('·')) || '').trim());
  check('切夜：环境强度随亮度下调', night.lum < 0.6, `environmentIntensity=${night.lum && night.lum.toFixed(3)}`);

  await page.evaluate(() => { window.__garden.setEnv('time', 'noon'); window.__garden.setEnv('weather', 'storm'); });
  check('切暴雨：过渡完成', await settled(page));
  const storm = await page.evaluate(() => ({
    eff: window.__garden.effectiveWeather(),
    rain: window.__garden.ENV.cur.rainAmount || 0,
    windGlobal: window.__garden.WIND.uWindGlobal.value,
  }));
  check('切暴雨：有效天气为 storm', storm.eff === 'storm');
  check('切暴雨：雨量>0 且底值风>0（审计 B03 回归）', storm.rain > 0 && storm.windGlobal > 0,
        `rain=${storm.rain.toFixed(2)} windGlobal=${storm.windGlobal.toFixed(2)}`);

  // ── 6. 雪天互斥（B16/B17 回归）──
  await page.evaluate(() => { window.__garden.setEnv('weather', 'clear'); window.__garden.setEnv('season', 'summer'); });
  await settled(page);
  const summerMutex = await page.evaluate(() => ({
    allowed: window.__garden.weatherAllowed('snow'),
    disabled: document.querySelector('#env button[data-v="snow"]').disabled,
  }));
  check('夏季雪被拒：weatherAllowed=false 且按钮置灰', summerMutex.allowed === false && summerMutex.disabled === true);

  await page.evaluate(() => window.__garden.setEnv('season', 'winter'));
  await settled(page);
  const winterSnow = await page.evaluate(() => {
    window.__garden.setEnv('weather', 'snow');
    return window.__garden.weatherAllowed('snow');
  });
  check('冬季切雪：过渡完成', await settled(page));
  const snowState = await page.evaluate(() => ({
    eff: window.__garden.effectiveWeather(),
    snow: window.__garden.ENV.cur.snowAmount || 0,
    reverted: (document.querySelector('#env button[data-v="snow"]').classList.contains('on')),
  }));
  check('冬季切雪合法且生效', winterSnow === true && snowState.eff === 'snow' && snowState.snow > 0 && snowState.reverted);
  await page.evaluate(() => { window.__garden.setEnv('season', 'summer'); window.__garden.setEnv('time', 'noon'); });
  await settled(page);

  // ── 6.5 拓展特性：晨雾 / 连续时辰 / 明信片 / 音景 ──
  await page.evaluate(() => window.__garden.setEnv('weather', 'mist'));
  check('切晨雾：过渡完成', await settled(page));
  const mistState = await page.evaluate(() => ({
    fog: window.__garden.scene.fog.density,
    stats: document.getElementById('stats').textContent,
    btnEnabled: !document.querySelector('#env button[data-v="mist"]').disabled,
  }));
  check('晨雾：雾密度抬升（fogMul 1.3，主建筑须可读）', mistState.fog > 0.0062 && mistState.fog < 0.0085, `density=${mistState.fog.toFixed(4)}`);
  check('晨雾：标签联动且全季节可用', mistState.stats.includes('薄雾') && mistState.btnEnabled);

  const sliderTaken = await page.evaluate(() => {
    const s = document.getElementById('hourSlider');
    s.value = 15.3;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  check('时辰滑杆：拖动事件受理', sliderTaken);
  check('时辰滑杆：短过渡完成', await settled(page));
  const hourState = await page.evaluate(() => ({
    hour: window.__garden.ENV.hour,
    time: window.__garden.ENV.time,
    readout: document.getElementById('hourReadout').textContent,
    stats: document.getElementById('stats').textContent,
  }));
  check('时辰滑杆：ENV.hour 落位、按钮跟随最近锚点',
        Math.abs(hourState.hour - 15.3) < 0.01 && hourState.time === 'dusk',
        `hour=${hourState.hour} time=${hourState.time} readout=${hourState.readout}`);
  const statsTimeLine = (hourState.stats.split('\n').find(l => l.includes('·')) || '');
  check('时辰滑杆：stats 显示 HH:MM', /:\d\d/.test(statsTimeLine), statsTimeLine.trim());
  await page.evaluate(() => window.__garden.setEnv('time', 'noon'));
  await settled(page);
  const backNoon = await page.evaluate(() => ({
    hour: window.__garden.ENV.hour,
    slider: parseFloat(document.getElementById('hourSlider').value),
  }));
  check('时段按钮：把连续时辰拉回锚点 12:30',
        Math.abs(backNoon.hour - 12.5) < 0.01 && Math.abs(backNoon.slider - 12.5) < 0.01);

  const card = await page.evaluate(() => {
    const url = window.__garden.postcardData();
    return { len: url.length, png: url.startsWith('data:image/png') };
  });
  check('明信片：可生成含题跋的 PNG', card.png && card.len > 50000, `${(card.len / 1024).toFixed(0)}KB dataURL`);
  const snd = await page.evaluate(() => ({
    a: window.__garden.toggleSound(),
    on: window.__garden.sndState(),
    b: window.__garden.toggleSound(),
  }));
  check('音景：开关往返状态正确', snd.a === true && snd.on === true && snd.b === false);
  await page.evaluate(() => window.__garden.setEnv('weather', 'clear'));
  await settled(page);

  // ── 7. 相机复位（键盘 0）──
  const pos0 = await page.evaluate(() => { const p = window.__garden.camera.position; return [p.x, p.y, p.z]; });
  await page.evaluate(() => window.__garden.camera.position.set(31, 9, 26));
  await page.keyboard.press('0');
  await sleep(250);
  const pos1 = await page.evaluate(() => { const p = window.__garden.camera.position; return [p.x, p.y, p.z]; });
  const moved = Math.hypot(pos0[0] - pos1[0], pos0[1] - pos1[1], pos0[2] - pos1[2]);
  check('按 0 键视角复位', moved < 1e-3, `复位距离 ${moved}`);

  // ── 8. stats 实时更新 & 视口缩放 ──
  const statsOk = await page.evaluate(() => /draw calls/.test(document.getElementById('stats').textContent));
  check('stats 面板持续刷新', statsOk);
  await page.setViewportSize({ width: 480, height: 800 });
  await sleep(600);
  const smallOk = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c.width > 0 && c.height > 0 && Math.abs(c.clientWidth - 480) < 2;
  });
  check('视口缩放画布自适应（480×800）', smallOk);

  // ── 8.5 移动端适配（P1-8）：320px 不溢出 + aria-pressed + 触控命中区 ──
  await page.setViewportSize({ width: 320, height: 640 });
  await sleep(600);
  const mob = await page.evaluate(() => {
    const env = document.getElementById('env').getBoundingClientRect();
    const stats = document.getElementById('stats').getBoundingClientRect();
    const hud = document.getElementById('hud').getBoundingClientRect();
    const btns = [...document.querySelectorAll('#env button')];
    return {
      inVp: env.left >= 0 && env.right <= innerWidth &&
            stats.left >= 0 && stats.right <= innerWidth &&
            hud.left >= 0 && hud.right <= innerWidth,
      noOverflow: document.documentElement.scrollWidth <= 320 && document.body.scrollWidth <= 320,
      allPressed: btns.length > 0 && btns.every(b => b.hasAttribute('aria-pressed')),
      minH: Math.min(...btns.map(b => b.getBoundingClientRect().height)),
    };
  });
  check('移动端 320px：面板收进视口且无横向溢出', mob.inVp && mob.noOverflow);
  check('移动端：按钮 aria-pressed 齐全、命中区 ≥38px', mob.allPressed && mob.minH >= 38,
        `minH=${Math.round(mob.minH)}`);

  // ── 汇总 ──
  finish();

  async function finish() {
    const bootLog = consoleMsgs.find(m => m.text.includes('[启动分段]'));
    if (bootLog) console.log(`[info] ${bootLog.text}`);
    console.log(`[info] draw calls=${info.calls} triangles=${info.tris.toLocaleString()} geos=${info.geos} tex=${info.tex}`);
    await browser.close().catch(() => {});
    server.close();
    const fails = results.filter(r => !r.ok).length;
    console.log(`\n[smoke] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
    process.exit(fails === 0 ? 0 : 1);
  }
})().catch(e => { console.error('[smoke] 探针自身异常：', e); process.exit(1); });
