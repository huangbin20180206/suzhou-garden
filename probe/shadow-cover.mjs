// 门禁：阴影视体覆盖 + 暴雨直射项量级 + 湿地不变成金属镜面
//
// 起因（2026-09-18 · 用户报）："狂风暴雨场景下有些地方感觉有太阳光透下来，这个角度就特别明显"。
// 根因有两条，都是**不报错、不崩、只有量出来才看得见**的静默缺陷：
//
//  ① 阴影视体比园子还小。旧实现固定 ortho ±28/±24（再按 1/仰角 放大），而 60×45 的园子
//     投影到正午光空间 X 轴达 ±37.5 → 四角落到盒外。盒外**既不做阴影测试、投射物也不进
//     深度图**，于是边界处出现"影子被硬切出一条直边、切边外是亮的"。
//     ⚠️ 判据必须是"园子地面是否 100% 落在盒内"，不能只看"盒的数值有没有变小" ——
//        这也是我第一版诊断脚本的毛病（只看 casters 极值 vs 盒，说不出哪块地被漏掉）。
//
//  ② 湿地把石材/瓦/草地压成半金属镜面（metalness +0.20），直射项被反射成顺视线的
//     金色高光带 → 暴雨里"透光"感。物理上水是电介质，蒙水膜不该长金属度。
//
// 判据设计（对被测对象特异）：
//  · 覆盖用的是**几何点**（园子地面的网格点），不是像素 —— 像素在暴雨里被雨丝随机污染，
//    任何像素差分都会变成噪点图（第一版 _diff-*.png 就是这么废掉的）。
//  · 反向对照：同时算**旧参数**（±28·_sc）的覆盖率，断言它**不通过**。
//    一把量不出旧缺陷的尺子 = 假绿。
//
// 用法: node probe/shadow-cover.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
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

const results = [];
function check(name, ok, detail){ results.push({ name, ok: !!ok, detail }); }

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  page.setDefaultTimeout(180000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000 });

  const setState = async (hour, weather) => {
    await page.evaluate(async (a) => {
      const g = window.__garden;
      const el = document.getElementById('hourSlider');
      if (el){ el.value = String(a.hour); el.dispatchEvent(new Event('input', { bubbles: true })); }
      g.setEnv('weather', a.weather);
      g.ENV.t = 0.999;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, { hour, weather });
    await page.evaluate(() => new Promise(res => {
      let i = 0; const step = () => (++i >= 3 ? res(true) : requestAnimationFrame(step));
      requestAnimationFrame(step);
    }));
  };

  /* ── 覆盖度量：把园子地面的网格点投到光空间，数有多少落在盒外 ── */
  const cover = () => page.evaluate((mode) => {
    const g = window.__garden, THREE = g.THREE;
    const c = g.shadowCamObj();
    c.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(c.matrixWorld).invert();
    /* 旧实现的盒（±28×±24 按 1/仰角 放大）—— 用来做反向对照 */
    const sun = g.sunLight();
    const elev = Math.asin(sun.position.y / sun.position.length());
    const sc = Math.max(1, Math.min(2.2, 0.35 / Math.max(0.09, elev)));
    const box = mode === 'old'
      ? { left: -28 * sc, right: 28 * sc, bottom: -24 * sc, top: 24 * sc }
      : { left: c.left, right: c.right, bottom: c.bottom, top: c.top };
    const v = new THREE.Vector3();
    /* 园子内地面：60×45 的一半再收 0.2（墙内侧）；y 取地面量级 */
    let total = 0, out = 0;
    const samples = [];
    for (let x = -29.8; x <= 29.8; x += 1.55){
      for (let z = -22.3; z <= 22.3; z += 1.55){
        for (const y of [0.15, 3.0, 6.5]){
          total++;
          v.set(x, y, z).applyMatrix4(inv);
          const inside = v.x >= box.left && v.x <= box.right && v.y >= box.bottom && v.y <= box.top;
          if (!inside){ out++; if (samples.length < 6) samples.push([+x.toFixed(1), y, +z.toFixed(1)]); }
        }
      }
    }
    return { mode, total, out, coverPct: +((1 - out / total) * 100).toFixed(2), samples,
             sc: +sc.toFixed(3),
             box: { l: +box.left.toFixed(2), r: +box.right.toFixed(2),
                    b: +box.bottom.toFixed(2), t: +box.top.toFixed(2) } };
  }, 'new');

  console.log('[shadow-cover] 阴影视体对园子地面的覆盖率（旧 vs 新）\n');
  const rows = [];
  const CASES = [[7.5, 'clear'], [7.5, 'storm'], [12.5, 'clear'], [12.5, 'storm'], [18, 'clear'], [18, 'storm']];
  for (const [hour, weather] of CASES){
    await setState(hour, weather);
    const now = await cover();
    const old = await page.evaluate((mode) => {
      const g = window.__garden, THREE = g.THREE;
      const c = g.shadowCamObj(); c.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(c.matrixWorld).invert();
      const sun = g.sunLight();
      const elev = Math.asin(sun.position.y / sun.position.length());
      const sc = Math.max(1, Math.min(2.2, 0.35 / Math.max(0.09, elev)));
      const box = { left: -28 * sc, right: 28 * sc, bottom: -24 * sc, top: 24 * sc };
      const v = new THREE.Vector3();
      let total = 0, out = 0;
      for (let x = -29.8; x <= 29.8; x += 1.55)
        for (let z = -22.3; z <= 22.3; z += 1.55)
          for (const y of [0.15, 3.0, 6.5]){
            total++; v.set(x, y, z).applyMatrix4(inv);
            if (!(v.x >= box.left && v.x <= box.right && v.y >= box.bottom && v.y <= box.top)) out++;
          }
      return { mode: 'old', total, out, coverPct: +((1 - out / total) * 100).toFixed(2), sc: +sc.toFixed(3) };
    }, 'old');
    const sun = await page.evaluate(() => {
      const g = window.__garden;
      return { intensity: +g.sunLight().intensity.toFixed(4), fit: g.shadowFit(),
               cam: g.shadowCam(), weather: g.ENV.weather, hour: +g.ENV.hour.toFixed(2) };
    });
    rows.push({ hour, weather, now, old, sun });
    console.log(`  ${now.coverPct >= 99.9 ? '✓' : '✗'} hour=${hour} ${weather.padEnd(6)} ` +
      `新覆盖 ${String(now.coverPct).padStart(6)}%  盒[${now.box.l},${now.box.r}]×[${now.box.b},${now.box.t}]  ` +
      `旧覆盖 ${String(old.coverPct).padStart(6)}% (_sc=${old.sc})  sun=${sun.intensity}  ` +
      `near/far=${sun.cam.near.toFixed(1)}/${sun.cam.far.toFixed(1)}`);
    check(`覆盖 100% · hour=${hour} ${weather}`, now.coverPct >= 99.9, `覆盖 ${now.coverPct}%，漏在盒外的采样点 ${now.out}/${now.total}`);
  }
  console.log('');
  /* 反向对照：新盒必须比旧盒覆盖得好，且旧盒在至少一半场景里确实漏（否则这把尺子没分辨力） */
  const oldBad = rows.filter(r => r.old.coverPct < 99.9).length;
  check('反向对照：旧参数确实漏（≥3/6 场景）', oldBad >= 3, `旧参数漏 ${oldBad}/6 个场景`);
  const worstNew = Math.min(...rows.map(r => r.now.coverPct));
  const worstOld = Math.min(...rows.map(r => r.old.coverPct));
  check('拟合后严格优于旧参数', worstNew > worstOld + 0.5,
    `最差覆盖 新 ${worstNew}% vs 旧 ${worstOld}%`);
  /* 阴影相机必须自洽 */
  const camOK = rows.every(r => r.sun.cam.left < 0 && r.sun.cam.right > 0 &&
                                r.sun.cam.bottom < 0 && r.sun.cam.top > 0 &&
                                r.sun.cam.near > 0 && r.sun.cam.far > r.sun.cam.near);
  check('阴影视体自洽（盒包住原点、near<far）', camOK, JSON.stringify(rows[0].sun.cam));

  /* ── §2 暴雨的直射项量级：不该再"像有太阳" ── */
  await setState(12.5, 'clear');
  const clearSun = await page.evaluate(() => +window.__garden.sunLight().intensity.toFixed(4));
  await setState(12.5, 'storm');
  const stormSun = await page.evaluate(() => +window.__garden.sunLight().intensity.toFixed(4));
  const ratio = stormSun / clearSun;
  console.log(`[shadow-cover] 暴雨/晴 直射光强比 = ${stormSun} / ${clearSun} = ${ratio.toFixed(3)}`);
  check('暴雨直射项 ≤ 晴的 20%', ratio <= 0.20, `比值 ${ratio.toFixed(3)}（旧值 0.38）`);
  check('暴雨直射项绝对值 ≤ 0.25', stormSun <= 0.25, `sun.intensity = ${stormSun}`);

  /* ── §3 湿地不得变成金属镜面 ── */
  await setState(12.5, 'storm');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wet = await page.evaluate(() => ({ v: window.__garden.wetNow(), mats: window.__garden.wetMats() }));
  check('暴雨下湿地已生效（wetness≈1）', wet.v > 0.95, `wetApplied = ${wet.v}`);
  const dMetal = Math.max(...wet.mats.map(m => +(m.metal - m.dryMetal).toFixed(4)));
  const dRough = Math.max(...wet.mats.map(m => +(m.dryRough - m.rough).toFixed(4)));
  const roughFrac = Math.max(...wet.mats.map(m => +(1 - m.rough / m.dryRough).toFixed(4)));
  console.log(`[shadow-cover] 湿地：最大金属度提升 +${dMetal}，最大粗糙度下降 ${dRough}（相对 ${(roughFrac * 100).toFixed(0)}%）`);
  check('湿地不增金属度（≤ +0.06）', dMetal <= 0.06, `最大提升 +${dMetal}（旧值 +0.20）`);
  check('湿地仍压粗糙度（下降 ≥ 25%）', roughFrac >= 0.25, `最大降幅 ${(roughFrac * 100).toFixed(1)}%`);
  /* ⚠️ 这里判的是"**提升量**"，不是金属度的绝对值：有材质**干**时就带金属度
     （实测最大 0.12，是瓦面的美术设定），拿绝对值当阈值会把它误判成回归。
     判据必须对被测对象特异 —— 要守的是"湿化有没有让材质长金属度"。 */
  const boosted = wet.mats.filter(m => m.metal - m.dryMetal > 0.06);
  check('逐材质：无一条金属度提升 > 0.06', boosted.length === 0,
    boosted.slice(0, 3).map(m => `${m.name} ${m.dryMetal}→${m.metal}`).join(', ') || '全部通过');

  console.log('\n[shadow-cover] 零 pageerror：' + (errs.length === 0 ? '是' : '否 — ' + errs.slice(0, 2).join(' | ')));
  check('零 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '));

  const pass = results.filter(r => r.ok).length;
  console.log(`\n[shadow-cover] ${pass}/${results.length} 项通过`);
  for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name} — ${r.detail}`);
  fs.mkdirSync(path.join(ROOT, 'outputs', '_diag'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'outputs', '_diag', 'shadow-cover.json'), JSON.stringify({ rows, results }, null, 2));
  await browser.close(); server.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('[shadow-cover] 异常：', e); process.exit(1); });
