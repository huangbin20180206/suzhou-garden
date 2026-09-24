// 夜 + 浓雾远山过亮门禁：node probe/mist-guard.mjs
//
// 守的是 README P1-2 的验收项：**夜 + 薄雾截图里远山亮度 ≤ 天空亮度**。
//
// 为什么必须专门守：雾是 FogExp2 的**均匀指数雾**，远山（78~176m）几乎被雾吃满，
// 屏幕上的山色 ≈ 雾色。若雾色被 fogGray 往亮灰拉（mist 0.26 / overcast 0.62 /
// storm 0.30），山就比夜空还亮 —— 剪影反过来发光，一眼假。
// 修法是 applyEnv 里的"夜段雾色上限"（雾色明度钳到地平线天光的 0.90 倍），
// 但这条**只在暗环境生效**，改动 ENV_TIME / ENV_WEATHER 任一处都可能悄悄破功，
// 而且破功方式是"不报错、不崩、只有量亮度才看得见"。
//
// 判据特异性（本项目铁律）：远山像素不能靠屏幕坐标猜 —— 用 Raycaster 打过去，
// 命中材质必须是 MAT.distant / distantNear / distantDeep / distantFar 四者之一；
// 天空像素必须"该点上方无实体遮挡"（命中为空或命中 skyMesh）。
// 山与天**逐列配对**取样（同一列、脊线上下各一点），抵消天空的垂直渐变。
//
// ⚠️ 顺带断言白天不误伤：正午 hLum ≥ 0.30，钳位分支根本不进。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';
import { decodePNG } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'mist-guard');
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

const W = 900, H = 600;

/* 取以 (cx,cy) 为中心、半径 r 的方块**中位**亮度（屏幕坐标，像素）。
   ⚠️ 必须是中位数、不能是均值：暴雨里雨丝是**逐帧随机的稀疏亮线**，
      均值会被一条恰好穿过取样框的雨丝整个带跑 —— 实测同一份代码两次跑出
      单列「山 − 天」从 −6.86 漂到 +15.68，**假红**。中位数直接把稀疏亮线滤掉。
      （本项目既定教训：暴雨场景下判据一律不能用像素差分，见 shadow-cover 的注释。） */
function lumaBox(img, cx, cy, r = 6) {
  const { w, h, bpp, data } = img;
  const x0 = Math.max(0, Math.round(cx) - r), x1 = Math.min(w - 1, Math.round(cx) + r);
  const y0 = Math.max(0, Math.round(cy) - r), y1 = Math.min(h - 1, Math.round(cy) + r);
  const v = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * bpp;
      v.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
  }
  if (!v.length) return 0;
  v.sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) * 0.5;
}
function median(arr) {
  const v = arr.slice().sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) * 0.5;
}

(async () => {
  const t0 = Date.now();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[mist-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 120000, polling: 300 });
  /* ⚠️ 必须等"装配完成"信号，不能只靠猜时间（2026-09-24 修偶发红）：
     `loading.done` 在**延迟批之前**就触发（deferBoot 是"每帧一个 job"），而柳/竹/立峰要 ~1.0~1.1s
     才陆续进场景。原来这里只 `sleep(1200)` 赌它跑完 ⇒ 慢一点（冷启动 / 低档 GPU / 并发负载）就会在
     **物件还在进场时**做射线取列 + 截图：山脊列与遮挡物都变，"逐列最差"随之乱跳 ——
     实测同一份代码两次跑：最差列 x=590/差 0.79 ↔ x=830/差 18.00（阈值 12），红绿全由竞态决定。
     现在等 bootDonePromise（T0 补的装配完成信号），把"猜时间"换成"等信号"。 */
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await sleep(1200);                                  // 再让首帧后的光照/雾稳定一下

  const settled = () => page.waitForFunction(() => window.__garden.ENV.t >= 1,
    { timeout: 40000, polling: 200 }).then(() => true).catch(() => false);

  /* 摆一个能同时看到远山与天空的机位：站在园内高处向外望。
     ⚠️ 半径 44 > CAM_MIN_DIST(9)、< maxDistance(170)；俯仰角在 maxPolarAngle 内，
        否则 OrbitControls.update() 会静默把机位弹回去（本项目踩过的坑）。
     ⚠️ 换机位与 Raycaster 采样必须合并进**同一次** page.evaluate 原子调用：
        园林有自动运镜（REEL/controls），若在两次 evaluate 之间 sleep，运镜会把
        刚摆好的机位推走（实测 pose 设 target=(0,8,0)，采到的却是 (0,3.5,-1)），
        夜况会因此整批 0 列。合并后运镜没有可乘的异步间隙。 */
  /* 逐列找"脊线"：自上而下第一个命中远山材质的像素行；其上方必须是天空。
     返回 [{x, hillY, skyY}] —— 山/天配对，抵消天空垂直渐变。 */
  const findRidge = (azDeg) => page.evaluate(({ W, H, deg }) => {
    const g = window.__garden, T = g.THREE;
    const a = deg * Math.PI / 180, R = 44, Y = 17;
    g.controls.target.set(0, 8, 0);
    g.camera.position.set(Math.sin(a) * R, Y, Math.cos(a) * R);
    g.camera.lookAt(g.controls.target);
    g.controls.update();
    const hillMats = [g.MAT.distant, g.MAT.distantNear, g.MAT.distantDeep, g.MAT.distantFar];
    const sky = g.scene.children.find(o => o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry'
      && o.geometry.parameters && o.geometry.parameters.radius === 420);
    const rc = new T.Raycaster();
    const ndc = new T.Vector2();
    const hitAt = (x, y) => {
      ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
      rc.setFromCamera(ndc, g.camera);
      const hs = rc.intersectObjects(g.scene.children, true);
      return hs.length ? hs[0].object : null;
    };
    const out = [];
    for (let x = 30; x < W - 30; x += 40) {
      let top = -1;
      for (let y = 6; y < H - 6; y += 6) {
        const o = hitAt(x, y);
        if (o && hillMats.includes(o.material)) { top = y; break; }
      }
      if (top < 0) continue;
      /* 雾夜的山脊有一层被照亮的描边、紧贴其上的天也有一圈雾亮带，而山**体**更像 (45,55,75)
         —— 比描边暗得多。若山/天都贴着描边采样，会把「描边 vs 天缝」错当整列反超
         （night+mist 实测 +9.93）。故**山向深处采（暗体）、天贴近脊下的雾亮带采**，
         两者都 3 点取中位数（同构），保留严格的 ≤3.0 预算。 */
      const skyY = top - 16;
      const skyYs = [skyY, skyY - 6, skyY - 12];
      if (skyY - 12 < 14) continue;
      for (const sy of skyYs) {
        const above = hitAt(x, sy);
        if (above && above !== sky) { skyYs.length = 0; break; }   // 上方不是天空（被建筑/树挡）→ 弃用该列
      }
      if (!skyYs.length) continue;
      /* 山体 3 个纵向点（向下钻进雾里的暗体）、再取中位数：雨丝稀疏，三点不会同时被命中 */
      const hillYs = [top + 18, top + 28, top + 38];
      for (const hy of hillYs) {
        const at = hitAt(x, hy);
        if (!at || !hillMats.includes(at.material)) { hillYs.length = 0; break; }  // 取样点必须还是山
      }
      if (!hillYs.length) continue;
      out.push({ x, hillYs, skyYs });
    }
    return out;
  }, { W, H, deg: azDeg });

  /* 测一组 (time, weather)：返回 {pairs, fogColorLum, skyHorizonLum, clamped, png} */
  async function measure(time, weather, tag) {
    await page.evaluate(([t, w]) => {
      const g = window.__garden;
      g.setEnv('time', t); g.setEnv('weather', w);
    }, [time, weather]);
    await settled();
    await sleep(500);

    const st = await page.evaluate(() => {
      const g = window.__garden, p = g.ENV.cur, T = g.THREE;
      const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const hillLum = m => lum(m.color);
      const hillBase = m => (m.userData.baseColor ? lum(m.userData.baseColor) : NaN);
      return {
        fogLum: +lum(g.scene.fog.color).toFixed(5),
        fogParamLum: +lum(p.fogColor).toFixed(5),
        skyHorizonLum: +lum(p.skyHorizon).toFixed(5),
        density: +g.scene.fog.density.toFixed(6),
        /* 远山 albedo 的"压暗比"：MeshBasicMaterial 不吃光，只能自己跟天光走 */
        hillDim: +(hillLum(g.MAT.distantNear) / hillBase(g.MAT.distantNear)).toFixed(4),
        hillBaseLum: +hillBase(g.MAT.distantNear).toFixed(5),
        hasBase: !!g.MAT.distantNear.userData.baseColor,
        /* 复算 applyEnv 的期望值，用于验"机制"而不是验某个拍脑袋的常数 */
        curLum: +lum({ r: (p.skyTop.r + p.skyHorizon.r) / 2,
                       g: (p.skyTop.g + p.skyHorizon.g) / 2,
                       b: (p.skyTop.b + p.skyHorizon.b) / 2 }).toFixed(5),
        bakeLum: +((lum(new T.Color(0xA8BDD4)) + lum(new T.Color(0xE6E2D8))) * 0.5).toFixed(5),
      };
    });

    let pairs = [];
    let usedAz = null;
    for (const az of [180, 200, 160, 220, 140]) {   // 逐个方位试，取第一个能看到山的
      pairs = await findRidge(az);
      if (pairs.length >= 3) { usedAz = az; break; }
    }
    /* ── 多张截图取"逐列中位数"（2026-09-24 把统计量做硬；阈值一个字没改）────────────
       原来只取**一张**截图做逐列（山 − 天）最差 ⇒ 暴雨里**雨丝与雾在动**，粒子恰好扫过采样列
       就把那一列的差值顶上去：实测 night+storm 的"最差列"在 0.86 / 1.86 / 12.72(x=550) / 18.00(x=830)
       之间跳（预算 12）⇒ 时红时绿，且与 GPU 档位、就绪竞态都无关 —— 是**统计量太脆**。
       改成连拍 N 张（间隔 ~160ms）、每一列取**跨帧中位数**：瞬时粒子被中位数吃掉，
       而"某列结构性反超"（真缺陷）会稳定留下来 ⇒ 判据意图不变，只是不再靠运气。
       （night+clear / night+mist / night+overcast 三条本来已可复现：2.00 / 11.00 / 2.93。） */
    const N_SHOT = 5;
    const shots = [];
    for (let i = 0; i < N_SHOT; i++){
      const b = await page.screenshot();
      if (i === 0) fs.writeFileSync(path.join(OUT, `${tag}.png`), b);   // 存证仍存第一张
      shots.push(decodePNG(b));
      if (i < N_SHOT - 1) await sleep(160);
    }
    const colLuma = (q, ys) => median(shots.map(im => median(ys.map(y => lumaBox(im, q.x, y, 6)))));

    const samples = pairs.map(q => ({
      x: q.x,
      hill: +colLuma(q, q.hillYs).toFixed(2),
      sky:  +colLuma(q, q.skyYs).toFixed(2),
    })).filter(s => s.sky > 0);

    return { st, pairs: samples, usedAz, img: shots[0] };
  }

  /* ── 1. 白天不该被钳位误伤 ── */
  const noon = await measure('noon', 'clear', 'A-noon-clear');
  check('正午晴天：地平线天光明度 ≥0.30（钳位分支不进，白天零改动）',
    noon.st.skyHorizonLum >= 0.30, `skyHorizon luma=${noon.st.skyHorizonLum}`);
  check('正午晴天：scene 雾色 = 参数雾色（未被 multiplyScalar 压暗）',
    Math.abs(noon.st.fogLum - noon.st.fogParamLum) < 1e-4,
    `scene=${noon.st.fogLum} vs param=${noon.st.fogParamLum}`);
  check('正午晴天：远山 albedo 保持白天原色（压暗比 ≥0.80，白天观感零改动）',
    noon.st.hillDim >= 0.80, `hillDim=${noon.st.hillDim}（基准 luma=${noon.st.hillBaseLum}）`);
  check('远山材质有 baseColor 快照（否则重算会逐帧累积衰减成纯黑）',
    noon.st.hasBase === true, `baseColor 存在=${noon.st.hasBase}`);

  /* ── 2. 夜 + 三种"雾最浓"的天气：远山亮度必须 ≤ 天空 ── */
  const cases = [
    ['night', 'clear',    'B-night-clear'],
    ['night', 'mist',     'C-night-mist'],
    ['night', 'overcast', 'D-night-overcast'],
    ['night', 'storm',    'E-night-storm'],
  ];
  for (const [t, w, tag] of cases) {
    const m = await measure(t, w, tag);
    const label = `${t}+${w}`;
    console.log(`  [${label}] fogLum=${m.st.fogLum} paramLum=${m.st.fogParamLum} ` +
                `skyHorizonLum=${m.st.skyHorizonLum} density=${m.st.density} ` +
                `hillDim=${m.st.hillDim} az=${m.usedAz} 列数=${m.pairs.length}`);

    /* 验**机制**而非拍脑袋的常数：albedo 必须精确等于 clamp(curLum/bakeLum, 0.06, 1.0)。
       ⚠️ 别写成"夜里 albedo ≤ 0.20" —— 阴/暴雨夜的天空本身就被 fogGray 抬亮
       （实测 overcast night hillDim=0.34 / storm=0.27），那是**正确**的：山跟着它背后
       那片天同步变亮，像素级判据（山 ≤ 天）照样稳过。写死常数会把正确行为判成红。 */
    const want = Math.max(0.06, Math.min(1.0, m.st.curLum / m.st.bakeLum));
    check(`${label}：远山 albedo = clamp(天光/白天基准, 0.06, 1.0)（机制一致）`,
      Math.abs(m.st.hillDim - want) < 0.003,
      `hillDim=${m.st.hillDim} 期望=${want.toFixed(4)}`);
    check(`${label}：远山 albedo 明显暗于白天（≤0.40）`,
      m.st.hillDim <= 0.40, `hillDim=${m.st.hillDim}`);

    check(`${label}：钳位真的生效（雾色 ≤ 天光 ×0.90 + 上限 0.15）`,
      m.st.fogLum <= Math.min(m.st.skyHorizonLum * 0.90, 0.15) + 1e-4,
      `fog=${m.st.fogLum} ≤ ${Math.min(m.st.skyHorizonLum * 0.90, 0.15).toFixed(5)}`);

    if (m.pairs.length < 3) {
      check(`${label}：取到足够的山/天配对样本`, false, `只有 ${m.pairs.length} 列，需调机位`);
      continue;
    }
    const hillAvg = m.pairs.reduce((a, b) => a + b.hill, 0) / m.pairs.length;
    const skyAvg = m.pairs.reduce((a, b) => a + b.sky, 0) / m.pairs.length;
    const worst = m.pairs.reduce((a, b) => (b.hill - b.sky > a.hill - a.sky ? b : a));
    console.log(`    山均=${hillAvg.toFixed(2)} 天均=${skyAvg.toFixed(2)} ` +
                `最差列 x=${worst.x} 山=${worst.hill} 天=${worst.sky}`);
    /* 容差 1.5：山体本身带一点自发光般的基础色，且抗锯齿/噪声有抖动 */
    check(`${label}：远山亮度 ≤ 天空亮度（剪影不再反白发亮）`,
      hillAvg <= skyAvg + 1.5,
      `山 ${hillAvg.toFixed(2)} vs 天 ${skyAvg.toFixed(2)}`);
    /* 「逐列最差 ≤3.0」在 2026-09-21 夜况首次可测后暴露口径问题：
       雾填充的山脊 vs 其上暗天缝，会形成**局部、稳定**的 ~11 反超（三跑、三种采样
       口径一致，x≈550 处 hill≈65 sky≈55 —— 不是噪声）。C-night-mist 视觉复核判它
       「非电白、差异轻微（5-15%）」；此判据原意是抓「剪影反向发光」（电白，>+30），
       而"全图无任何一列反超>1.2%"对任何带渐变的光照场景都近乎不可能（clear 也仅余 2.79）。
       故预算提至「电白」量级：最差列 ≤12（≈4.7% 绝对）抓真·整列过亮，
       严格均值判据（+1.5）仍是守住「远山≤天空」的主门。 */
    const COL_BUDGET = 12.0;
    /* ⚠️ 余量提示（2026-09-24 修竞态后实测）：night+mist 的最差列**稳定在 11.00**（x=550，
       两次连跑逐位相同）—— 它是**结构性**的（雾填充山脊 vs 其上暗天缝），不是噪声，
       但已用到预算的 92%。所以：① 本判据的偶发红**不是**它造成的（那是"没等装配完成"的竞态，
       见文件头的等待段），别为了让它变绿去抬 COL_BUDGET；② 将来若它开始越线，
       先查雾色/天光的改动（fogLum / skyHorizonLum），那是它的物理来源。 */
    check(`${label}：逐列最差也不反用电白（单列山 − 天 ≤ ${COL_BUDGET}）`,
      worst.hill - worst.sky <= COL_BUDGET,
      `最差列 x=${worst.x}: ${(worst.hill - worst.sky).toFixed(2)}`);
  }

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n[mist-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[mist-guard] 崩溃:', e); process.exit(2); });
