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
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 本地没有，走全局 */ }
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
/* 过渡由仿真时间推进（dt 钳到 50ms），软渲染低帧率下 2.8 秒过渡可能等 1 分钟。
   探针把 dur 调短 + 轮询 ENV.t>=1 —— 插值机制照跑，只是不等墙钟。 */
const settled = page => page.waitForFunction(() => window.__garden && window.__garden.ENV.t >= 1,
  { timeout: 30000, polling: 250 }).then(() => true).catch(() => false);
/* ── 等 stats 标签刷新到位（2026-09-18 新增，修竞态）──
   `#stats` 不是逐帧写的：渲染循环里按**累加节拍**（约 0.5 秒）刷新一次。
   于是"设完状态就立刻读 textContent"是在赌 HUD 那一拍恰好已经跑过 ——
   旧软渲染 harness 一帧 2.4 秒，一帧就跨过节拍，永远踩得中；
   harness 换到真 GPU（37ms/帧）后这个赌局输了：实测连跑 3 次，2 次读到上一拍的旧标签
   （"切夜"读到"午夏"、"晨雾"读不到"薄雾"）。
   ⚠️ 这类"读一次"的断言换 harness 时是最先碎的 —— 判据要改成**轮询到谓词成立**。 */
async function waitStats(page, test, ms = 6000){
  const read = () => page.evaluate(() => (document.getElementById('stats') || {}).textContent || '');
  const t0 = Date.now();
  for (;;){
    const txt = await read();
    if (test(txt)) return { ok: true, txt };
    if (Date.now() - t0 > ms) return { ok: false, txt };
    await sleep(80);
  }
}
/* stats 里那行"天气 · 时刻季节"：两处断言都要它，取法统一在这里 */
const statsLine = txt => (String(txt).split('\n').find(l => l.includes('·')) || '').trim();

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  // 小视口：像素越少每帧越省，过渡靠仿真推进才等得起（harness 见 _harness.mjs）
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } });
  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => consoleMsgs.push({ type: 'pageerror', text: String(e) }));

  console.log(`\n[smoke] http://127.0.0.1:${port}/index.html`);

  /* ⚠️ 必须声明在早退分支之前：启动失败时第 63 行就 finish() 了，而下面那句
     `const info = ...` 还没执行到 —— 此时读取 info 命中 TDZ，finish() 自己抛
     ReferenceError，把"启动失败"的报告变成 Node 崩溃。用 let 提前置空。 */
  let info = null;

  // ── 1. 启动 ──
  const response = await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
  console.log('[source] HTTP=' + response.status() + ' matchesDisk=' + (await response.body()).equals(fs.readFileSync(path.join(ROOT, 'index.html'))));
  const booted = await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    undefined, { timeout: 45000 }).then(() => true).catch(e => { console.log('[boot-wait] ' + e.message); return false; });
  check('页面启动完成（loading 层收起，__garden 就绪）', booted);
  if (!booted) {
    for (const m of consoleMsgs) console.log('[boot-console] ' + m.type + ': ' + m.text);
    console.log('[boot-state] ' + JSON.stringify(await page.evaluate(() => ({ garden: !!window.__garden, loading: document.getElementById('loading')?.textContent, state: document.readyState })).catch(e => ({ error: e.message }))));
    await finish(); return;
  }

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
  info = await page.evaluate(() => {
    const r = window.__garden.renderer;
    return { calls: r.info.render.calls, tris: r.info.render.triangles,
             geos: r.info.memory.geometries, tex: r.info.memory.textures };
  });
  check(`draw calls 上限（${info.calls} < 800）`, info.calls < 800);
  check(`三角形上限（${info.tris.toLocaleString()} < 4,200,000）`, info.tris < 4_200_000);
  check('几何/纹理数量健康', info.geos < 800 && info.tex < 300, `geos=${info.geos} tex=${info.tex}`);

  // ── 4. GLB 资产到齐且动起来 ──
  /* 2026-09-30：LotusPlant.glb 已下线（池边荷花改程序化大荷花，见 08 的说明）——
     这里同步从名单移除，否则这条断言永远为假（与本条注释里"判据滞后于产品"是同一类）。 */
  const glb = await page.waitForFunction(() => {
    const names = { KoiFish: 0, Turtle: 0, BananaPlant: 0 };
    window.__garden.scene.traverse(o => {
      for (const k of Object.keys(names)) if (o.name && o.name.includes(k)) names[k]++;
    });
    return Object.values(names).every(n => n > 0) && window.__garden.ENV
      ? names : false;
  }, { timeout: 40000 }).then(v => v.jsonValue?.() ?? v).catch(() => null);
  /* ⚠️ **先断言前提，再判对错**（项目老教训：判据必须先断言前提）。
     「四类 GLB 均已挂载」这条在**降级态**下天然为假：required:false 的项失败后
     走程序化替身（芭蕉叶片），场景里出现的是 `banana-leaf` 冠层而不是名字里
     带 "BananaPlant" 的 GLB 节点 —— 这不是 bug，是设计。
     早先直接 `check('四类 GLB 资产均已挂载', !!glb)`，于是任何一次资产失败都让
     smoke 报红，而**报红原因与被测代码无关**（网络抖动）。现在按降级态分支断言。 */
  const deg = await page.evaluate(() => {
    const s = window.__garden.preloadState ? window.__garden.preloadState() : null;
    return { degraded: s?.degraded || [], settled: s?.settled, count: s?.count };
  });
  const degradedMode = deg.degraded.length > 0;
  if (degradedMode){
    // 降级态：断"替身确实上场了"，而不是断"GLB 都在"
    const sub = await page.evaluate(() => {
      let crowns = 0, leaves = 0;
      window.__garden.scene.traverse(o => {
        if (o.userData && o.userData.substitute === 'banana-leaf'){ crowns++; leaves += o.children.length; }
      });
      return { crowns, leaves };
    });
    console.log(`  [降级态] 失败 ${deg.degraded.length}/${deg.count} 项：`
      + deg.degraded.map(d => d.url || d).join(', '));
    check(`降级态有 ${deg.degraded.length} 项走替身流程（而不是静默穿帮）`, degradedMode);
    check('芭蕉替身叶片已构造（≥3 片，不是空冠层/光杆）', sub.leaves >= 3,
      `替身冠层 ${sub.crowns} 个 / 叶片 ${sub.leaves} 片`);
  } else {
    check('三类 GLB 资产均已挂载（未降级）', !!glb, glb ? JSON.stringify(glb) : '未挂载');
  }
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
  const nightStats = await waitStats(page, t => t.includes('夜'));
  const night = await page.evaluate(() => ({
    t: window.__garden.ENV.time, lum: window.__garden.scene.environmentIntensity,
  }));
  check('切夜：状态落位', night.t === 'night');
  check('切夜：stats 标签联动', nightStats.ok, statsLine(nightStats.txt));
  check('切夜：环境强度随亮度下调', night.lum < 0.6, `environmentIntensity=${night.lum && night.lum.toFixed(3)}`);
  // ── 5.1 月亮（2026-09-19 需求：晴夜有月、随辰起落；雨/阴天无月）──
  const nightMoon = await page.evaluate(() => {
    let mat = null;
    window.__garden.scene.traverse(o => {
      if (o.material && o.material.uniforms && o.material.uniforms.uMoonAmount) mat = o.material;
    });
    if (!mat) return null;
    /* ⚠️ 场景里有两盏平行光（sun + fill），必须认**投影那盏**：fill 不跟着月亮走，
       取错灯这条断言会永远红（或者更糟：fill 碰巧同向就假绿）。 */
    let dl = null;
    window.__garden.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow && !dl) dl = o; });
    if (!dl) window.__garden.scene.traverse(o => { if (o.isDirectionalLight && !dl) dl = o; });
    const d = mat.uniforms.uMoonDir.value;
    return { vis: mat.uniforms.uMoonAmount.value, alt: Math.asin(Math.max(-1, Math.min(1, d.y))),
             dot: dl ? dl.position.clone().normalize().dot(d) : null };
  });
  check('晴夜有月：天空月可见度>0.5 且月在地平线上', !!nightMoon && nightMoon.vis > 0.5 && nightMoon.alt > 0,
        nightMoon ? `vis=${nightMoon.vis.toFixed(2)} 仰角=${(nightMoon.alt * 180 / Math.PI).toFixed(1)}°` : '未找到天空材质');
  check('月光即主光：夜里的平行光方向 = 月亮方向', !!nightMoon && nightMoon.dot !== null && nightMoon.dot > 0.99,
        nightMoon ? `dot=${nightMoon.dot && nightMoon.dot.toFixed(3)}` : '未找到主光');

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
  // ── 6.1 冬季植被存在性（紫藤是落叶藤本，冬季花穗必须落尽）──
  //    回归背景：collectSeasonCaches 曾把所有 InstancedMesh 从 presence 收集里剔除，
  //    MAT.wisteria 缓存恒空 → applyPresence 落空 → 冬季照常开花（无报错、无门禁，纯静默）。
  const winterWisteria = await page.evaluate(() => {
    let meshes = 0, visible = 0, count = 0;
    window.__garden.scene.traverse(o => {
      if (o.isInstancedMesh && o.material === window.__garden.MAT.wisteria){
        meshes++; if (o.visible) visible++; count += o.count;
      }
    });
    return { meshes, visible, count };
  });
  check('冬季紫藤落尽：花穗 InstancedMesh 全部 count=0 且不可见',
        winterWisteria.meshes > 0 && winterWisteria.visible === 0 && winterWisteria.count === 0,
        `meshes=${winterWisteria.meshes} visible=${winterWisteria.visible} count=${winterWisteria.count}`);
  await page.evaluate(() => { window.__garden.setEnv('season', 'summer'); window.__garden.setEnv('time', 'noon'); });
  await settled(page);
  const noonMoon = await page.evaluate(() => {
    let mat = null;
    window.__garden.scene.traverse(o => {
      if (o.material && o.material.uniforms && o.material.uniforms.uMoonAmount) mat = o.material;
    });
    return mat ? mat.uniforms.uMoonAmount.value : null;
  });
  check('正午无月（月亮只在夜里起落）', noonMoon === 0, `uMoonAmount=${noonMoon}`);

  // ── 6.5 拓展特性：晨雾 / 连续时辰 / 明信片 / 音景 ──
  await page.evaluate(() => window.__garden.setEnv('weather', 'mist'));
  check('切晨雾：过渡完成', await settled(page));
  const mistStats = await waitStats(page, t => t.includes('薄雾'));
  const mistState = await page.evaluate(() => ({
    fog: window.__garden.scene.fog.density,
    btnEnabled: !document.querySelector('#env button[data-v="mist"]').disabled,
  }));
  /* 2026-09-28 活雾批次：此处实际是**午+薄雾**（时辰停在上一节的正午），旧窗
     (0.0062,0.0085) 按常数 fogMul 1.3 校准；活雾后午档 = 0.0052×1.8×1.10 = 0.0103
     （老黄："中午不能没有雾，只是淡一点"），窗重定为 (0.008,0.013)。 */
  check('薄雾：雾密度抬升（底 1.8×时辰档，主建筑须可读）', mistState.fog > 0.008 && mistState.fog < 0.013, `density=${mistState.fog.toFixed(4)}`);
  check('晨雾：标签联动且全季节可用', mistStats.ok && mistState.btnEnabled,
        `label="${statsLine(mistStats.txt)}" btnEnabled=${mistState.btnEnabled}`);

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
  }));
  check('时辰滑杆：ENV.hour 落位、按钮跟随最近锚点',
        Math.abs(hourState.hour - 15.3) < 0.01 && hourState.time === 'dusk',
        `hour=${hourState.hour} time=${hourState.time} readout=${hourState.readout}`);
  /* 这一条同样吃 HUD 节拍：等"·"行里出现 HH:MM 为止，别读一次就判 */
  const hourStats = await waitStats(page, t => /:\d\d/.test(statsLine(t)));
  check('时辰滑杆：stats 显示 HH:MM', hourStats.ok, statsLine(hourStats.txt));
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

  // ── 7.5 点击水面起涟漪（2026-09-19）：可信鼠标点击 → 射线命中池面 → spawnRipple ──
  /* 回归要点：① insidePond 是池心局部坐标（池心世界 z=3），世界点要先减 3；
     ② 必须发**可信** pointerdown+up（page.mouse），合成 pointerup 会被手势过滤丢掉。 */
  const pondPt = await page.evaluate(() => {
    const { camera, THREE, insidePond } = window.__garden;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const cv = document.querySelector('canvas');
    for (const fy of [0.62, 0.58, 0.66, 0.70, 0.55, 0.50]){
      for (const fx of [0.30, 0.34, 0.26, 0.40, 0.22, 0.45]){
        ndc.set(fx * 2 - 1, -(fy * 2) + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(plane, hit) && insidePond(hit.x, hit.z - 3))
          return { x: Math.round(fx * cv.clientWidth), y: Math.round(fy * cv.clientHeight) };
      }
    }
    return null;
  });
  check('点击涟漪：默认机位下找得到池面可点屏幕点', !!pondPt, JSON.stringify(pondPt));
  if (pondPt){
    await page.mouse.click(pondPt.x, pondPt.y);
    await sleep(250);
    const rip = await page.evaluate(() => window.__garden.clickRippleLast());
    check('点击涟漪：可信点击命中池面并生成水痕', !!(rip && rip.hit), JSON.stringify(rip));
  }

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

  // ── 8.6 PWA 离线三件套（P1-3）：manifest 可取 + sw.js 可取 + 注册不报错 ──
  const pwa = await page.evaluate(async () => {
    const out = { manifest: false, sw: false, regErr: '' };
    try {
      const r = await fetch('./manifest.webmanifest');
      const j = await r.json();
      out.manifest = !!(j && j.name && j.start_url);
    } catch (e) { out.manifest = false; }
    try {
      const r2 = await fetch('./sw.js');
      const t = await r2.text();
      /* 版本号模式即可：缓存清单每次迭代都可能升 v2/v3（如封面入壳），
         写死 v1 会逼着每次正常换缓存都来改探针。守的是"sw 可取且声明了版本化缓存"。 */
      out.sw = /suzhou-garden-v\d+/.test(t);
    } catch (e) { out.sw = false; }
    try {
      if ('serviceWorker' in navigator) await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (e) { out.regErr = String((e && e.message) || e).slice(0, 80); }
    return out;
  });
  check('PWA：manifest 可取且字段齐全', pwa.manifest);
  check('PWA：sw.js 可取且缓存版本一致', pwa.sw);
  check('PWA：SW 注册不抛错（http 下应成功）', !pwa.regErr, pwa.regErr);

  // ── 8.7 导览字幕巡游（P2-2）：启停往返 + 字幕联动 + 用户接管停 ──
  await page.evaluate(() => { window.__garden.ENV.dur = 0.25; });
  const tour0 = await page.evaluate(() => {
    window.__garden.tourStart();
    return { st: window.__garden.tourState(), cap: window.__garden.tourCaption() };
  });
  check('巡游：启动后状态 on 且首站 hero', tour0.st.on === true && tour0.st.idx === 0, JSON.stringify(tour0.st));
  check('巡游：首站字幕为立峰·云根', /云根/.test(tour0.cap), tour0.cap);
  // 等首站飞行落定（camFly 熄灭），再确认停留计时不提前切站
  await page.waitForFunction(() => window.__garden && !window.__garden.camFly(),
    { timeout: 30000, polling: 200 }).catch(() => {});
  const tourFly = await page.evaluate(() => window.__garden.tourState());
  check('巡游：飞行落定后仍在首站（不提前切站）', tourFly.idx === 0, `idx=${tourFly.idx}`);
  // 用户接管：画布 pointerdown 应停巡游并收字幕
  const tourTake = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const el = document.getElementById('caption');
    return { st: window.__garden.tourState(), shown: el.classList.contains('show') };
  });
  check('巡游：画布接管即停并收字幕', tourTake.st.on === false && tourTake.shown === false,
        `on=${tourTake.st.on} shown=${tourTake.shown}`);
  // 按钮开关往返：巡游▸ → 停■ → 巡游▸
  const tourBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#env button')].find(x => x.dataset.act === 'tour');
    b.click(); const on1 = window.__garden.tourState().on, t1 = b.textContent;
    b.click(); const on2 = window.__garden.tourState().on, t2 = b.textContent;
    return { on1, t1, on2, t2 };
  });
  check('巡游：按钮开关往返且文案切换', tourBtn.on1 === true && tourBtn.t1 === '停■' && tourBtn.on2 === false && tourBtn.t2 === '巡游▸',
        `${tourBtn.t1}/${tourBtn.t2}`);
  await page.evaluate(() => window.__garden.tourStop());

  // ── 8.8 帧率自适应（P1-1 附带项）：自动化免疫 + 手动降档生效 + 后台暂停接线 ──
  /* ⚠️ 2026-09-18 判据换过。原来的断言是 `softwareGL === true`（"软渲染下免疫"），
     但探针 harness 换到真 GPU 之后 SOFTWARE_GL 变 false（实测 66× 提速，见 _harness.mjs），
     那条断言就红了 —— 而它红得对：**它守的本来就是"探针运行时 QOS 不许自己动"**，
     软渲染只是那个不变量的**代理**。代理失效了，判据要换成直接信号 `probeDriven`。
     不变量本身不变：active=false 且档位停在 L0（QOS 会在跑的过程中改 scale / 阴影尺寸，
     是回归断言最怕的"会自己动的量"）。 */
  const qos0 = await page.evaluate(() => ({
    st: window.__garden.qosState(), sw: window.__garden.softwareGL, gpu: window.__garden.gpuName,
    pd: window.__garden.probeDriven, immune: window.__garden.qosImmune,
  }));
  check('QOS：自动化驱动下自适应免疫（active=false，档位停在 L0）',
        qos0.pd === true && qos0.immune === true && qos0.st.active === false && qos0.st.level === 0,
        `probeDriven=${qos0.pd} immune=${qos0.immune} software=${qos0.sw} active=${qos0.st.active} L${qos0.st.level}`);
  /* 手动降档：最低档必须关 AO、压分辨率并降阴影。
     ⚠️ 倍率不再写死 0.72 —— 2026-09-25 画质系统改为五档平滑退化
     （1.00 / 0.94 / 0.86 / 0.78 / 0.72），锁定最低档 L4 恰为 0.72，
     但判据应当是"倍率取自**产品自己**的档位表"而不是我在这里复述一遍数字：
     复述会随档位调整而静默失配（这次就是这样先红）。 */
  const qos1 = await page.evaluate(() => {
    const before = { pr: window.__garden.renderer.getPixelRatio(), base: window.__garden.qosState().baseScale };
    const st0 = window.__garden.qosState();
    window.__garden.setQos(st0.maxLevel);
    return { before, after: window.__garden.renderer.getPixelRatio(),
             st: window.__garden.qosState(), maxLevel: st0.maxLevel };
  });
  check('QOS：降到最低档生效（分辨率下压且 AO 关闭）',
        qos1.after < qos1.before.base - 1e-6 && qos1.st.ao === false && qos1.st.level === qos1.maxLevel,
        `pixelRatio ${qos1.before.pr}→${qos1.after}（基准 ${qos1.before.base}）L${qos1.st.level}/${qos1.maxLevel} AO=${qos1.st.ao}`);
  await page.evaluate(() => window.__garden.setQos(0));
  const qos2 = await page.evaluate(() => ({
    pr: window.__garden.renderer.getPixelRatio(), st: window.__garden.qosState(),
  }));
  check('QOS：升回 L0 恢复基准像素比',
        Math.abs(qos2.pr - qos2.st.baseScale) < 1e-6 && qos2.st.level === 0,
        `pixelRatio=${qos2.pr}`);
  /* 后台暂停：覆盖 document.hidden 后派发 visibilitychange，页面应记录为隐藏 */
  const hid = await page.evaluate(() => {
    const before = window.__garden.hidden();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const during = window.__garden.hidden();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return { before, during, after: window.__garden.hidden() };
  });
  check('后台暂停：visibilitychange 接线（隐藏→暂停，恢复→继续）',
        hid.before === false && hid.during === true && hid.after === false,
        `${hid.before}→${hid.during}→${hid.after}`);

  /* ── 檐口两排圆头的几何关系（2026-09-30，老黄两轮指认"红褐椽头顶进灰蓝瓦当"）──
     三条判据，牙齿在②③：
       ① 三维上不相交（最近实例中心距 ≥ 两半径和 0.195，实测 0.495）—— 这条是**安全不变量**，
          注意它**抓不到本缺陷**（旧值 0.22 时两排中心距仍有 0.60，因为 0.6m 的进深差占了大头：
          当时"看着穿模"是仰视透视重叠，不是互穿）。留着它只为防"真的互穿"这类回归。
       ② **进深错位**（椽头外端退在瓦当排之后 ≥0.10m，实测 0.15）—— 这才是让檐口读得开的那条，
          旧值 -0.05（外端还挑出瓦当 0.05）⇒ 必然报红。三轮 A/B 定案：只加大下压量修不好
          （只下压 0.10 → 咬合照旧；只里收 0.20 → 沿坡度抬高、咬合反增到五六成）。
       ③ 两侧檐口飞椽头"斜削端朝外"（北檐靠 ry=π）。低角度看不到斜面本身，所以用
          局部 +z 变换后的世界朝向做**确定性**判定；旧值南檐对、北檐反（34/34）。 */
  const eave = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    const tiles = [], raft = [];
    G.scene.traverse(o => {
      if (!o.isInstancedMesh || !o.geometry || !o.geometry.parameters) return;
      const pr = o.geometry.parameters;
      if (Math.abs((pr.radiusTop || 0) - 0.105) < 1e-6) tiles.push(o);
      if (Math.abs((pr.radiusTop || 0) - 0.09) < 1e-6 && Math.abs((pr.height || 0) - 1.3) < 1e-6) raft.push(o);
    });
    if (!tiles.length || !raft.length) return { err: '没找到瓦当/椽头实例网格' };
    const dump = (im) => { const out = [], m = new T.Matrix4(), v = new T.Vector3();
      for (let i = 0; i < im.count; i++){ im.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
        out.push([v.x, v.y, v.z]); } return out; };
    const C = tiles.flatMap(dump), R = raft.flatMap(dump);
    const d3 = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    let minPair = 1e9;
    for (const r of R){ let best = 1e9; for (const c of C){ const d = d3(r, c); if (d < best) best = d; } if (best < minPair) minPair = best; }
    /* ⚠️ 必须**只取正堂那套瓦当**：全场 324 个瓦当里混着水榭/游廊的，
       拿全集取 max(z) 会拿到别家屋顶（实测 12）⇒ 判据变成假绿（退 18.65m 也照样通过）。
       筛法：正堂屋面 x∈±12.3、z∈-12.8±6.3 ⇒ 按包围盒圈出正堂那一套。 */
    const hallC = C.filter(p => Math.abs(p[0]) <= 13 && Math.abs(p[2] + 12.8) <= 7);
    const hallR = R.filter(p => Math.abs(p[0]) <= 13 && Math.abs(p[2] + 12.8) <= 7);
    if (!hallC.length || !hallR.length) return { err: '没圈出正堂那套瓦当/椽头' };
    /* 南檐（z 最大的一条）：瓦当排 z 与椽头外端 z（外端 = 中心 + 0.65，朝外） */
    const capZ = Math.max(...hallC.map(p => p[2]));
    const rafZSouth = Math.max(...hallR.map(p => p[2]));
    const rafTipZ = rafZSouth + 0.65;
    /* 斜削朝向：局部 +z 经实例矩阵变换后的世界 z 分量，应与"该椽相对中心的方向"同号 */
    const centerZ = -12.8;
    let bevelOut = 0, bevelIn = 0;
    const im = raft[0], m = new T.Matrix4(), pos = new T.Vector3(), dir = new T.Vector3();
    for (let i = 0; i < im.count; i++){
      im.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
      dir.set(0, 0, 1).transformDirection(new T.Matrix4().multiplyMatrices(im.matrixWorld, m));
      if (Math.sign(dir.z) === Math.sign(pos.z - centerZ)) bevelOut++; else bevelIn++;
    }
    return { capN: C.length, rafN: R.length, hallCapN: hallC.length, minPair: +minPair.toFixed(3),
             capZ: +capZ.toFixed(3), rafTipZ: +rafTipZ.toFixed(3), bevelOut, bevelIn };
  });
  check('檐口：瓦当排与椽头排三维不相交（最近中心距 ≥ 两半径和 0.195）',
        !eave.err && eave.minPair >= 0.195,
        eave.err || `最近 ${eave.minPair}（瓦当 ${eave.capN} / 椽头 ${eave.rafN}）`);
  check('檐口：椽头外端退在瓦当排之后 ≥0.10m（进深错位才是读得开的原因）',
        !eave.err && (eave.capZ - eave.rafTipZ) >= 0.10,
        eave.err || `正堂瓦当 ${eave.hallCapN} 个，南檐瓦当 z=${eave.capZ} ｜ 椽头外端 z=${eave.rafTipZ}（退 ${(eave.capZ - eave.rafTipZ).toFixed(3)}m）`);
  check('檐口：两侧檐口飞椽头的斜削端都朝外（形制一致）',
        !eave.err && eave.bevelIn === 0 && eave.bevelOut === eave.rafN,
        eave.err || `朝外 ${eave.bevelOut} / 朝内 ${eave.bevelIn}`);

  // ── 汇总 ──
  finish();

  async function finish() {
    const bootLog = consoleMsgs.find(m => m.text.includes('[启动分段]'));
    if (bootLog) console.log(`[info] ${bootLog.text}`);
    /* ⚠️ 启动失败时 info 停在 null（早退分支在赋值之前就走到这儿了）—— 这里必须能安全
        取值，否则报告"启动失败"的过程本身会崩掉，看到的是一堆栈而不是"哪一项没过"。 */
    console.log(info ? `[info] draw calls=${info.calls} triangles=${info.tris.toLocaleString()} geos=${info.geos} tex=${info.tex}`
                     : '[info] 启动未完成，跳过渲染量统计');
    await browser.close().catch(() => {});
    server.close();
    const fails = results.filter(r => !r.ok).length;
    console.log(`\n[smoke] ${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}（${results.length} 项）`);
    process.exit(fails === 0 ? 0 : 1);
  }
})().catch(e => { console.error('[smoke] 探针自身异常：', e); process.exit(1); });
