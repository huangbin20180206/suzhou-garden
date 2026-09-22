// 夜空门禁（2026-09-22）：①月亮在**默认机位**里必须真看得见；②星闪必须逐星随机。
//   为什么需要这道门（老黄 2026-09-22 报"满天繁星、唯独没有月亮"）：
//     旧版月亮的仰角/节律算得全对，门禁也只断言"uMoonAmount>0.5 且仰角>0"——**全绿**，
//     但月亮整晚在相机背后或画面之上，人一眼都看不到。"做了但看不见"是本仓库的经典静默缺陷，
//     判据必须落在**像素**上，而不是 uniform 的数值上。
//   判据设计（特异、可复现）：
//     ① 同帧差分：把 uMoonAmount 归零再渲一遍，逐像素比亮度 —— 月轮只要画出来就现形；
//     ② 覆盖率而不是"像素计数"：先按相机把月亮方向投到屏幕，拿到月轮**圆心像素 + 半径像素**
//        （视半径 0.026 rad → r = 0.026/tan(fov/2)·H/2），只数该圆内 delta>40 的像素。
//        为什么不用"全帧计数"：月晕（pow(cos,350) 半宽 3.6°）也在阈值内，月轮被切掉一半时
//        计数照样能凑到"理论面积的 87%"—— 上一版判据就是这么给出假绿的（实测那一次月轮
//        圆心 NDC y=1.04，中心其实在画面外）。
//     ③ ⚠️ 投影必须算**天空球视差**：天空球是半径 420 的**有限远**球面（不是无限远天体），
//        相机离球心 41m → 约 5.6° 视差，比月轮直径还大。按"相机 + 方向×400"投会算偏，
//        覆盖率会假 0（本脚本第一版就这么错的）。
//     ④ 整夜抽样：uMoonAmount 吃满的整段都得"看得见"，且 00:00 必须是**整轮**；
//        这守住的正是"月亮爬到半空就飞出画面上沿"那种回归。
//     ⑤ 星闪"随机"的可测形式：**每颗星的闪烁频率必须不同**。
//        旧式 `0.75+0.25*sin(uTime*2.1+h*63)` 是全星同一个频率、只差相位 ——
//        在固定时间窗里数每颗星的亮度极大值个数，旧式必然**全部相等**（只有 1 种取值），
//        新式（逐星频率 3.2~9.4 rad/s）会散开。这条判据只有新式能过，旧式必红。
//     ⑥ 星点**靠"会变的亮点"自选**，不靠阈值猜：夜里 uTime 只驱动星空闪烁（云絮 0.12s 内
//        位移可忽略），所以"时间极差大 + 够亮"的像素就是星。第一版按"最亮 80 个"取样，采到的
//        全是亮着的窗格与灯笼（不吃 uTime）→ 极差 0 → 假红。
//   样张：outputs/visual/night-moon-*.png
// usage: node probe/night-sky-guard.mjs
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

/* MOONPX：默认机位下量"月轮圆内的覆盖率"。
   自己 renderer.render 而不是 composer.render：渲染与 drawImage 必须在**同一个同步块**里完成，
   否则 RAF 的 animate 会插进来，拿到的帧和设的 uniform 对不上（09-19 那次"差分全 0"的假阴性）。 */
const MOONPX = () => {
  const g = window.__garden, T = g.THREE;
  let skyObj = null;
  g.scene.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.uMoonAmount) skyObj = o; });
  if (!skyObj) return null;
  const sky = skyObj.material;
  const cam = g.camera;
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const grab = (amt) => {
    sky.uniforms.uMoonAmount.value = amt;
    g.renderer.setRenderTarget(null);
    g.renderer.render(g.scene, cam);
    cv.width = g.renderer.domElement.width; cv.height = g.renderer.domElement.height;
    cx.drawImage(g.renderer.domElement, 0, 0);
    return cx.getImageData(0, 0, cv.width, cv.height).data;
  };
  const real = sky.uniforms.uMoonAmount.value;
  const A = grab(real), B = grab(0);
  sky.uniforms.uMoonAmount.value = real;

  const W = cv.width, H = cv.height;
  /* 月轮圆心：把天空球上"局部方向 = uMoonDir"的那个点投影到屏幕。
     ⚠️ 天空球半径只有 420，相机离球心 41m —— 必须按有限远球面投影，不能当天体算视差为 0。 */
  const d0 = sky.uniforms.uMoonDir.value.clone().normalize();
  const R = (skyObj.geometry && skyObj.geometry.parameters && skyObj.geometry.parameters.radius) || 420;
  const world = skyObj.localToWorld(d0.clone().multiplyScalar(R));
  const p = world.project(cam);
  const px = (p.x + 1) / 2 * W, py = (1 - p.y) / 2 * H;
  const rPx = 0.026 / Math.tan(cam.fov * Math.PI / 360) * H / 2;   // 视半径 0.026 rad → 像素
  const inCircle = Math.PI * rPx * rPx;
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  let hit = 0, inFrame = 0;
  const x0 = Math.max(0, Math.floor(px - rPx)), x1 = Math.min(W - 1, Math.ceil(px + rPx));
  const y0 = Math.max(0, Math.floor(py - rPx)), y1 = Math.min(H - 1, Math.ceil(py + rPx));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
    const dx = x + 0.5 - px, dy = y + 0.5 - py;
    if (dx * dx + dy * dy > rPx * rPx) continue;
    inFrame++;
    const i = (y * W + x) * 4;
    if (lum(A, i) - lum(B, i) > 40) hit++;
  }
  return {
    amt: real, cov: +(hit / inCircle).toFixed(3),                 // 覆盖率（分母是整轮面积）
    inFramePct: +(inFrame / inCircle).toFixed(3),                 // 圆有多少落在画面内（被屏幕边切就 <1）
    px: [Math.round(px), Math.round(py)], rPx: +rPx.toFixed(1),
    altDeg: +(Math.asin(Math.max(-1, Math.min(1, d0.y))) * 180 / Math.PI).toFixed(2),
    azDeg: +(Math.atan2(d0.x, d0.z) * 180 / Math.PI).toFixed(1),
    camPos: cam.position.toArray().map(v => +v.toFixed(1)),
  };
};

/* TWINKLE：把天空 uTime 钉在固定采样序列上，逐帧读回像素亮度时间序列。
   星点自选（极差大 + 够亮）—— 见文件头 ⑥。
   ⚠️ 为什么要自建一台"抬头看星"的相机：默认俯视机位可见的天空只有约 3° 高的一条缝
      （实测整幅画面里带星点像素仅 ~20 个，见 _star-twinkle-diag），根本不够统计"每颗星的
      频率"。而**闪烁是天空着色器的属性，与机位无关** —— 所以在能看见大片天的地方量它。
      用自建相机而不是挪场景相机：OrbitControls 每帧自写朝向 + 极角上限（88.56°）夹取，
      探针里改场景相机指向会被吃掉（探针范式，见 probe/peach-guard 的 look() 注释）。 */
const TWINKLE = ({ N, DT }) => {
  const g = window.__garden, T = g.THREE;
  /* ⚠️ 认天空材质要用 uStarAmount/uStarRot 这种**只有天空球才有**的键：
     场景里 uTime 有好几份（地面光斑、灯笼音量也吃 uTime），traverse 取最后一个匹配会取错。 */
  let sky = null;
  g.scene.traverse(o => { if (o.material && o.material.uniforms &&
      o.material.uniforms.uTime && o.material.uniforms.uStarAmount) sky = o.material; });
  if (!sky) return null;
  const src = g.camera;
  const cam = new T.PerspectiveCamera(src.fov, src.aspect, src.near, src.far);
  cam.position.copy(src.position);
  const v = new T.Vector3(); src.getWorldDirection(v);
  const f = new T.Vector3(v.x, 0, v.z).normalize();                 // 保留默认朝向的方位角
  const p = 18 * Math.PI / 180;                                     // 抬头 18°
  const look = f.clone().multiplyScalar(Math.cos(p)).add(new T.Vector3(0, Math.sin(p), 0)).normalize();
  cam.lookAt(cam.position.clone().addScaledVector(look, 50));
  cam.updateMatrixWorld(true);
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const w = g.renderer.domElement.width, h = g.renderer.domElement.height;
  cv.width = w; cv.height = h;
  const band = Math.floor(h * 0.55);
  const frames = [];
  for (let k = 0; k < N; k++){
    sky.uniforms.uTime.value = 400 + k * DT;
    g.renderer.setRenderTarget(null);
    g.renderer.render(g.scene, cam);
    cx.drawImage(g.renderer.domElement, 0, 0);
    frames.push(cx.getImageData(0, 0, w, band).data);
  }
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const cand = [];
  for (let y = 0; y < band; y++) for (let x = 0; x < w; x++){
    const i = (y * w + x) * 4;
    let mx = 0, mn = 1e9;
    for (const f of frames){ const L = lum(f, i); if (L > mx) mx = L; if (L < mn) mn = L; }
    if (mx > 70 && mx - mn > 6) cand.push([i, mx - mn, mx]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  const series = cand.slice(0, 120).map(([i]) => frames.map(f => +lum(f, i).toFixed(1)));
  const stats = series.map(s => {
    const mx = Math.max(...s), mn = Math.min(...s), mean = s.reduce((a, b) => a + b, 0) / s.length;
    let peaks = 0;
    for (let k = 1; k < s.length - 1; k++) if (s[k] > s[k - 1] && s[k] >= s[k + 1]) peaks++;
    return { mx, mn, mean: +mean.toFixed(1), peaks, swing: (mx - mn) / Math.max(1, mean) };
  });
  const strong = stats.filter(s => s.mx > 90);
  const peakCounts = [...new Set(strong.map(s => s.peaks))].sort((a, b) => a - b);
  const swings = strong.map(s => s.swing).sort((a, b) => a - b);
  return {
    changing: cand.length, sampled: series.length, strong: strong.length,
    peakCounts, distinctPeaks: peakCounts.length,
    medianSwing: swings.length ? +swings[Math.floor(swings.length / 2)].toFixed(3) : null,
    medianKeep: strong.length
      ? +(strong.map(s => s.mean / Math.max(1, s.mx)).sort((a, b) => a - b)[Math.floor(strong.length / 2)]).toFixed(3) : null,
    sample: stats.slice(0, 5),
  };
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  page.setDefaultTimeout(200000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?tier=high`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 180000, polling: 300 });
  await sleep(2000);
  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1, { timeout: 60000, polling: 200 })
    .then(() => true).catch(() => false);
  /* 默认机位必须**真的是**默认机位：OrbitControls 每帧 clamp 会静默挪相机（本项目踩过），
     所以先把机位摆回去，再断言摆成功了 —— 摆不回去的话后面所有可见性结论都没有意义。 */
  const setHour = async (h) => {
    await page.evaluate((hh) => { const sl = document.getElementById('hourSlider');
      sl.value = String(hh); sl.dispatchEvent(new Event('input', { bubbles: true })); }, h);
    await settled();
    await page.evaluate(() => window.__garden.resetCamera());
    await sleep(700);
  };

  await page.evaluate(() => { const g = window.__garden;
    g.setEnv('season', 'summer'); g.setEnv('weather', 'clear'); g.setEnv('time', 'night'); });
  await settled(); await sleep(800);

  /* ① 轨道几何：月出 18:00 方位 110°/仰角 0°，中天 24:00 仰角 4.5°，月落 06:00 方位 180° */
  const arcRows = [];
  for (const h of [18, 21, 0, 3, 6, 12]){
    await setHour(h);
    arcRows.push({ h, ...await page.evaluate(MOONPX) });
  }
  const rowAt = (h) => arcRows.find(r => r.h === h);
  check('月出 18:00：方位≈110° 且贴着地平线（uMoonAmount≈0，还没亮）',
    Math.abs(rowAt(18).azDeg - 110) < 3 && rowAt(18).altDeg < 0.4 && rowAt(18).amt < 0.05,
    `az=${rowAt(18).azDeg}° alt=${rowAt(18).altDeg}° amt=${rowAt(18).amt.toFixed(3)}`);
  check('中天 00:00：峰值仰角 4.5°（刻意压低到默认机位的可见带里）',
    Math.abs(rowAt(0).altDeg - 4.5) < 0.3, `alt=${rowAt(0).altDeg}°`);
  check('月落 06:00：方位≈180° 且已落到地平线',
    Math.abs(rowAt(6).azDeg - 180) < 3 && rowAt(6).altDeg < 0.4, `az=${rowAt(6).azDeg}° alt=${rowAt(6).altDeg}°`);
  check('正午 12:00：月亮在地平线下 → 天空 uMoonAmount=0',
    rowAt(12).amt === 0 && rowAt(12).altDeg < 0, `amt=${rowAt(12).amt} alt=${rowAt(12).altDeg}°`);

  /* ② 默认机位：00:00 必须是**整轮**月亮（老黄这次报的那一条） */
  const m0 = rowAt(0);
  check('默认机位 00:00：月轮整轮可见（圆内覆盖率 ≥ 0.80）', m0.cov >= 0.80,
    `覆盖率 ${(m0.cov * 100).toFixed(0)}%（圆心落在画面内比例 ${(m0.inFramePct * 100).toFixed(0)}% · 屏幕像素 ${JSON.stringify(m0.px)} · r=${m0.rPx}px）`);
  check('默认机位 00:00：机位就是默认机位（防 OrbitControls 静默挪镜）',
    Math.abs(m0.camPos[0] + 20) < 1 && Math.abs(m0.camPos[2] - 32) < 1, `pos=${JSON.stringify(m0.camPos)}`);

  /* ③ 整夜抽样：uMoonAmount 吃满的整段（20:00~04:00）都得看得见 */
  const nightRows = [];
  for (const h of [20, 21, 21.5, 22, 23, 1, 2, 3, 4]){
    await setHour(h);
    nightRows.push({ h, ...await page.evaluate(MOONPX) });
  }
  const profile = nightRows.map(r => `${r.h}时 ${(r.cov * 100).toFixed(0)}%`).join(' · ');
  console.log(`  〔月轮覆盖率逐时曲线〕${profile}`);
  const worst = nightRows.reduce((a, b) => (a.cov <= b.cov ? a : b));
  /* 阈值 0.40 而不是 0.8：20:00 / 02:00 那两点月亮刚爬上/快落下（仰角 ≈2.3°），
     正好从远处山脊后过 —— 被山咬掉半轮是构图（"月出东山"），不是缺陷；
     缺陷的定义是"看不见"（cov=0）或"圆心跑出画面被屏幕边切"。 */
  check('整夜 20:00~04:00：每个采样点都看得见（覆盖率 ≥ 0.40）', nightRows.every(r => r.cov >= 0.40),
    `最低 ${(worst.cov * 100).toFixed(0)}%（${worst.h} 时，月亮仰角 ${worst.altDeg}°，被远处山脊咬掉一部分属构图）`);
  const anchor = nightRows.find(r => r.h === 21.5);
  check('切"夜"落位（21:30）：月轮整轮可见且亮度吃满', anchor.cov >= 0.80 && anchor.amt > 0.5,
    `覆盖率 ${(anchor.cov * 100).toFixed(0)}% amt=${anchor.amt.toFixed(2)} alt=${anchor.altDeg}°`);
  check('整夜：月轮圆心始终在画面内（不被屏幕上下沿切）',
    nightRows.every(r => r.inFramePct >= 0.95),
    `圆心在画面内比例最低 ${(Math.min(...nightRows.map(r => r.inFramePct)) * 100).toFixed(0)}%`);

  /* ④ 月光仍是主光（保住 smoke 的合同：夜里平行光方向 = 月亮方向） */
  const light = await page.evaluate(() => {
    const g = window.__garden;
    let sky = null; g.scene.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.uMoonAmount) sky = o.material; });
    let dl = null; g.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow && !dl) dl = o; });
    const d = sky.uniforms.uMoonDir.value;
    /* ⚠️ 主光的 y 被 Math.max(8, moonY*68) 夹过（免得近水平光把阴影视体撑爆）——
       月亮压到 4.5° 后必然吃到这个夹取，所以判据取 dot 而不是"方向完全相等"：
       y=8/68 → 仰角 6.7°，与 4.5° 的月亮相差 2.2° → dot = cos(2.2°) = 0.9993。 */
    return { dot: dl.position.clone().normalize().dot(d), lightY: +dl.position.y.toFixed(2) };
  });
  check('月光即主光：夜里平行光方向 ≈ 月亮方向（dot>0.99）', light.dot > 0.99,
    `dot=${light.dot.toFixed(4)} 主光 y=${light.lightY}（y 会被夹到 ≥8，仰角略高于 4.5° 属预期）`);

  /* ⑤ 星闪：逐星频率必须不同（旧式全星同频 → 极大值个数恒为 1 种） */
  const tw = await page.evaluate(TWINKLE, { N: 25, DT: 0.14 });
  check('星闪：逐星频率不同（固定时间窗内每颗星的亮度极大值个数散开）',
    !!tw && tw.distinctPeaks >= 3, tw ? `极大值个数取值 ${JSON.stringify(tw.peakCounts)}（旧式单频只会是 1 种）· 会变的亮点 ${tw.changing} 个` : '取不到天空材质');
  check('星闪：摆幅够大（(max-min)/mean 中位数 > 0.7）',
    !!tw && tw.medianSwing > 0.7, tw ? `medianSwing=${tw.medianSwing} · 采样 ${tw.sampled}（强星 ${tw.strong}）` : '');
  check('星闪：整体没被改暗（星点时间均值/峰值 中位数 > 0.45）',
    !!tw && tw.medianKeep > 0.45, tw ? `medianKeep=${tw.medianKeep}` : '');

  /* 样张 */
  await setHour(21.5); await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'night-moon-2130.png') });
  await setHour(0); await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'night-moon-0000.png') });

  check('零 pageerror / console error', errors.length === 0, errors[0] || `${errors.length} 条`);

  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[夜空] ${results.length - failed.length}/${results.length} 项通过 · 样张 ${OUT}/night-moon-*.png`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[night-sky-guard] 崩溃:', e); process.exit(2); });
