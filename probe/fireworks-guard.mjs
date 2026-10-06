// 春节烟花专项门禁：node probe/fireworks-guard.mjs
//
// 为什么建这道门（2026-10-05 · 老黄："增加一个盛大的场景：春节烟花（冬季限定）…"）：
// 烟花是"半透明的天上级亮层 + 染全场的动态光"，两侧都是本项目反复踩过的坑：
//   · 看不见：大雁 4~10px、滴水 4px、彩虹曾整条 0px、闪电按世界仰角摆 ⇒ 贡献 0 像素；
//   · 判据空转：只查 `mesh.visible` 会静默放过"根本画不出来"（闪电那次的教训）。
// 所以本门只量**能落地的三件事**：
//   ① 门控（冬季限定）：冬·夜·晴必须开；夏·夜 / 冬·正午 / 冬·暴雨必须关；
//   ② 天上出花：抬头机位下"强开 ↔ 强关"**同任务内**渲两帧的差分像素 ≥ 阈值；
//   ③ **照亮庭院**（"烟花的光彩照应整个庭院"）：逐帧记 (flash, 庭院 ROI 平均亮度)，
//      峰值帧必须显著亮于 flash≈0 的帧 —— 这一半在**默认俯视机位**也成立（天上那半不成立，
//      因为默认机位是俯视的、天空只占顶部一条，见 12-env 的边界注释）。
//   ④ 自检：强制关掉后 flash 恒 0、且天上那层贡献 0px（证明 ②③ 量的是烟花本身）。
//
// ⚠️ 阈值来历都要写在下面；不许靠"调阈值"过门。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'fireworks');
fs.mkdirSync(OUT, { recursive: true });
const MIN_SKY_PX = 300;      // 天上那层在抬头机位下的贡献下限（一发 190 星 × 4，量级见实测）
const MIN_LIFT = 1.25;       // 庭院 ROI 在闪光峰值 vs 无闪光的亮度比下限（1.25 = 亮 25%）
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.webmanifest': 'application/manifest+json', '.ktx2': 'image/ktx2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.setDefaultTimeout(300000);
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0&tier=high`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.addStyleTag({ content: '#hud,#env,#caption,#stats,#loading{display:none !important}' });
  /* ⚠️⚠️ 把水面反射钉成"每帧刷"（2026-10-06，与 lampvol-guard / legibility-guard 同一手法）：
     本门两条判据都靠"**同状态**连渲两张做差分"，而"反射按需更新"（05-water 的设计行为）
     会让**同一任务内的不同渲染**用到不同相位的倒影 —— 实测（outputs/_diag/fw-flaky2.mjs，
     12 轮）：每次 composer.render() 是否触发反射刷新是**逐次交替**的
     （三张图的刷新次数实测 [0,1,0] / [1,0,0] / [0,0,1] 三种都出现过）⇒ 于是
     "同状态自检"偶发非零（实测 12 轮里 1 次：46px、峰值差 53，**bbox 落在水面区**
     —— 即"这张图里的倒影是上一张的"）。交接文档记的那次"自检最大差 115"同源。
     钉住后 12 轮全 0（A/B 实测：不钉 6 轮里 1 次 84px；钉住 6 轮全 0）。
     ⚠️ 反射的"按需降频"本身由 probe/reflect-adaptive.mjs 守，别在这里断言。 */
  await page.evaluate(() => {
    const w = window.__garden.scene.getObjectByName('waterSurface');
    if (w) w.userData.reflectEveryFrame = true;
  });

  const settle = async (axis, v) => {
    await page.evaluate(([a, val]) => window.__garden.setEnv(a, val), [axis, v]);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(500);
  };

  /* ── ① 门控 ── */
  const gate = await page.evaluate(async () => {
    const G = window.__garden;
    G.setFireworksForce(null);
    const w = async (o) => { for (const k in o) G.setEnv(k, o[k]);
      await new Promise(r => { const t0 = performance.now();
        const f = () => (performance.now() - t0 > 2800) ? r() : requestAnimationFrame(f); f(); });
      return G.fireworksState().on; };
    const out = {};
    out.winterNight = await w({ season: 'winter', time: 'night', weather: 'clear' });
    out.summerNight = await w({ season: 'summer' });
    out.winterNoon  = await w({ season: 'winter', time: 'noon' });
    out.winterStorm = await w({ weather: 'storm' });
    await w({ weather: 'clear' });
    return out;
  });
  check('① 冬季限定：冬·夜·晴 ⇒ 开', gate.winterNight === true, `on=${gate.winterNight}`);
  check('① 夏季夜里 ⇒ 关（冬季限定）', gate.summerNight === false, `on=${gate.summerNight}`);
  check('① 冬季正午 ⇒ 关（白天看不见花、也不该放）', gate.winterNoon === false, `on=${gate.winterNoon}`);
  check('① 冬季暴雨 ⇒ 关（明月星空要被看见）', gate.winterStorm === false, `on=${gate.winterStorm}`);

  /* ── ② 天上出花：抬头机位，强开 ↔ 强关，同任务内连渲 ── */
  await page.evaluate(() => {
    const G = window.__garden;
    G.setEnv('season', 'winter'); G.setEnv('time', 'night'); G.setEnv('weather', 'clear');
    /* ⚠️⚠️ 机位必须是**用户真能摆出来的**：`OrbitControls.maxPolarAngle=88.6°` ⇒ 镜头抬不起来
       （第一版我设 (0,3.2,24)→(0,30,-20) 抬头 31°，被静默钳回 (0,31.3,31.5)，爆点全出框 ⇒
        "贡献 0px" 是**机位**不是产品）。这里用"接近平视 + 略微俯"的合法位姿。 */
    G.camera.position.set(0, 6, 34);
    G.controls.target.set(0, 12, -18);
    G.camera.updateMatrixWorld(true); G.controls.update();
    G.setFireworksForce(true);
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 }).catch(() => {});
  /* ⚠️ 必须**等到真的有花在飞**再量 —— 第一版固定 wait 6000ms 就量，结果恰好落在
     "上一发已经散尽、下一发还没升"的空档里（实测 flash=0、只放了 1 发）⇒ 差分 0px，
     那是**测量时机**不是产品缺陷。本项目铁律：判据必须先断言前提。 */
  const burstOn = await page.waitForFunction(
    () => window.__garden.fireworksState().shells >= 1,
    null, { polling: 100, timeout: 90000 }).then(() => true).catch(() => false);
  check('② 前提：抬头机位下确实有花在飞（否则"贡献 0px"只是没炸）', burstOn,
    burstOn ? '' : '90s 内没等到任何一发');
  await page.waitForFunction(() => window.__garden.fireworksState().flash > 0.5,
    null, { polling: 50, timeout: 60000 }).catch(() => {});
  /* ⚠️ 两件事要在**两个不同时刻**取图，别混：
       · "打光有没有方向感" ⇒ 闪光峰值那一刻（环境光/方向光被拉到最亮）；
       · "花形像不像" ⇒ 火星散开之后（峰值时火星还挤在 ~1m 内，看上去就是一团白斑）。 */
  await page.screenshot({ path: path.join(OUT, '00-闪光峰值-庭院被照亮.png') });
  /* ⚠️ 再等到"花已经散开"再取图/量贡献：闪光峰值那一刻火星还挤在 ~1m 内、看上去就是
     一团过曝白斑（第一版就是这么拍的，出图判读成"没炸开的一团"）。等到 flash 落下去、
     壳还在飞 ⇒ 火星已散到 ~8m 半径，才读得出"放射的花"。 */
  /* ⚠️ 改成**从峰值起固定等 1.1s**，不再等"flash<0.3 && shells>=1"那个窄窗口 ——
     那个窗口只有几百毫秒，多一次截图（上面那张峰值图）就把时序挤偏 ⇒ 偶发红。
     烟的寿命 2.7s、升空 1.15s ⇒ 峰值后 1.1s 时火星已散到 ~6m，形状稳定可复现。 */
  await page.waitForTimeout(1100);
  const sky = await page.evaluate(() => {
    const G = window.__garden;
    let pts = null; G.scene.traverse(o => { if (o.name === 'fireworks') pts = o; });
    if (!pts) return { miss: true };
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, cv.width, cv.height).data; };
    const diff = (A, B) => { let n = 0;
      for (let i = 0; i < A.length; i += 4)
        if (Math.abs(A[i]-B[i]) + Math.abs(A[i+1]-B[i+1]) + Math.abs(A[i+2]-B[i+2]) > 12) n++;
      return n; };
    const on = grab();
    const keep = pts.visible; pts.visible = false; const off = grab(); pts.visible = keep;
    const on2 = grab();
    return { px: diff(on, off), self: diff(on, on2), flash: G.fireworksState().flash,
             shots: G.fireworksState().shots, col: G.fireworksState().lastCol,
             aoSkip: pts.userData.aoSkip === true, rc: String(pts.raycast).includes('=>') };
  });
  if (sky.miss) check('场景里有 fireworks 层', false, '找不到 name=fireworks 的 Points');
  else {
    console.log(`  · 已放 ${sky.shots} 发 · 主色 ${sky.col} · 当前 flash=${sky.flash}`);
    check('② 自检：同状态连渲两次逐位为 0', sky.self === 0, `最大差 ${sky.self}`);
    check(`② 抬头机位下烟花真的画出来了（贡献 ≥ ${MIN_SKY_PX}px）`, sky.px >= MIN_SKY_PX,
      `烟花↔隐藏 差分 ${sky.px}px`);
    check('② 已按项目规矩关 raycast、打 aoSkip', sky.aoSkip && sky.rc, `aoSkip=${sky.aoSkip} rc=${sky.rc}`);
  }
  await page.screenshot({ path: path.join(OUT, '01-抬头看烟花.png') });

  /* ── ③ 照亮庭院：默认俯视机位，逐帧记 (flash, 庭院 ROI 平均亮度) ── */
  await page.evaluate(() => {
    const G = window.__garden;
    G.resetCamera();                                // 回到默认机位（用户第一眼看到的就是它）
    G.camera.updateMatrixWorld(true); G.controls.update();
  });
  await page.waitForTimeout(1200);
  const light = await page.evaluate(async () => {
    const G = window.__garden;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    /* 庭院 ROI：画面中央（远香堂+池+台基那一带），避开顶部天空条 */
    const rx = Math.round(cv.width * 0.18), ry = Math.round(cv.height * 0.34);
    const rw = Math.round(cv.width * 0.64), rh = Math.round(cv.height * 0.42);
    const mean = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
      const d = ctx.getImageData(rx, ry, rw, rh).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
      return s / (d.length / 4); };
    const rows = [];
    for (let k = 0; k < 150; k++){
      await new Promise(r => requestAnimationFrame(r));
      const st = G.fireworksState();
      rows.push({ f: st.flash, m: +mean().toFixed(2) });
    }
    return { rows, peakShot: null };
  });
  const peak = light.rows.reduce((a, b) => (b.f > a.f ? b : a), { f: 0, m: 0 });
  const base = light.rows.filter(r => r.f <= 0.02);
  const baseMed = base.length ? base.map(r => r.m).sort((a, b) => a - b)[base.length >> 1] : NaN;
  const ratio = +(peak.m / baseMed).toFixed(3);
  console.log(`  · 逐帧记 ${light.rows.length} 帧 · flash 峰值 ${peak.f} 时庭院 ROI 亮度 ${peak.m}`
    + ` · flash≈0 的中位亮度 ${baseMed}（${base.length} 帧）`);
  check('③ 前提：抓到过绽放闪光（否则"没变亮"可能只是没炸）', peak.f > 0.8, `峰值 flash=${peak.f}`);
  check('③ 前提：有足够多"没闪光"的帧当基线', base.length >= 10, `${base.length} 帧`);
  check(`③ 烟花把庭院照亮了（闪光峰值帧 ≥ 基线 × ${MIN_LIFT}）`, ratio >= MIN_LIFT,
    `亮度比 ${ratio}（${peak.m} / ${baseMed}）`);
  await page.screenshot({ path: path.join(OUT, '02-默认机位-庭院被染亮.png') });

  /* ── ⑤ 彩蛋：四弹齐射「2027」──
     守三件：① 四个壳槽**全部**进彩蛋模式；② 四发**同一个发射时刻**（齐射，不是错峰）；
     ③ 字**成形**：画面上横向分成 ≥4 段（四个数字各自成段），而不是糊成团或出框。
     ⚠️ 判据用"横向分段数"而不是"多模态读出来没有" —— 甲：单图判读同代码同机位会自相矛盾
     （同一档 0.12 判读"是 2027"、改成 0.15 判读"四个光球"）；乙：分段数是可复现的结构量
     （0.12 档实测正好 4 段、每段 103~116px、间隔均匀）。 */
  await page.evaluate(() => {
    const G = window.__garden;
    G.setFireworksForce(true);
    G.gotoViewpoint('fireworks');
    G.fireworksFinaleNow();          // 产品侧权威开关（不在探针里重调产品函数）
  });
  await page.waitForFunction(() => window.__garden.fireworksState().finale >= 1,
    null, { polling: 60, timeout: 30000 }).catch(() => {});
  const fin = await page.evaluate(() => window.__garden.fireworksState());
  check('⑤ 彩蛋触发：四个壳槽全部进入彩蛋模式（4 弹）',
    fin.finale >= 1 && fin.fin.every(v => v === 1), `finale=${fin.finale} fin=${JSON.stringify(fin.fin)}`);
  check('⑤ 四弹**齐射**：四发发射时刻相同（age 极差 < 0.05s）',
    Math.max(...fin.ages) - Math.min(...fin.ages) < 0.05, `四槽 age=${JSON.stringify(fin.ages)}`);
  /* ⚠️⚠️ 2026-10-06 改成**按仿真年龄取样**，不再按墙钟 `waitForTimeout(1900)`：
     "2027" 的成形是**壳年龄（仿真时间）**的函数，而墙钟 1900ms 对应的年龄会随帧率/机器负载漂
     （仿真钟在慢帧里被固定步长夹住）。实测同一发彩蛋逐次取样（outputs/_diag/fw-flaky.mjs）：
        年龄 0.67~1.08 ⇒ 贡献 39~61 万 px、**1 段**（闪光峰值期火星还挤成一团、整幅被 bloom 晕开）；
        年龄 1.32      ⇒ 0.7 万 px、7 段（散开中，碎）；
        年龄 ≥1.52     ⇒ 0.75 万 px、**稳定 5 段**，一直到 3.1s 逐位不变。
     ⇒ 旧写法在机器被占用/低帧时会把取样点推到 1.0 附近，量到"1 段 / 13.7 万 px"的**假红**
     （交接文档记的"两次红点位置与像素都不同"就是这个：红点不同是因为取样年龄不同）。
     现在先等年龄 ≥1.5 再量，形状是确定性的；并把年龄本身作为**前提断言**打出来。 */
  const fwReady = await page.waitForFunction(() => {
    const a = window.__garden.fireworksState().ages || [];
    return a.length >= 4 && Math.min(...a) >= 1.5;
  }, null, { polling: 60, timeout: 30000 }).then(() => true).catch(() => false);
  const finAge = await page.evaluate(() =>
    Math.min(...(window.__garden.fireworksState().ages || [1e9])));
  check('⑤ 前提：取样时壳年龄已进入"成形稳定窗"（≥1.5s；更早量到的是被 bloom 晕开的一团）',
    fwReady && finAge >= 1.5, `年龄 ${(+finAge).toFixed(2)}s`);
  const word = await page.evaluate(() => {
    const G = window.__garden;
    let im = null; G.scene.traverse(o => { if (o.name === 'fireworks') im = o; });
    const W = G.renderer.domElement.width, H = G.renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, W, H).data; };
    const A = grab(); const k = im.visible; im.visible = false; const B = grab(); im.visible = k;
    const cols = new Array(W).fill(0); let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const i = (y * W + x) * 4;
      if (Math.abs(A[i]-B[i]) + Math.abs(A[i+1]-B[i+1]) + Math.abs(A[i+2]-B[i+2]) > 12){ cols[x]++; n++; }
    }
    const segs = []; let s0 = -1;
    for (let x = 0; x < W; x++){
      const on = cols[x] >= 2;
      if (on && s0 < 0) s0 = x;
      if ((!on || x === W - 1) && s0 >= 0){ if (x - s0 >= 6) segs.push([s0, x - s0]); s0 = -1; }
    }
    return { px: n, segs };
  });
  /* ⚠️ 上限 6 万 px 是**第二条牙**（2026-10-06 加）：成形稳定窗里贡献约 0.75 万 px，
     而"取样落在闪光峰值期（年龄 ~1.0s）"时是 13.7~61 万 px（整幅被 bloom 晕开）。
     下限只管"有没有画出来"，上限专抓"取样早了/又被晕开" —— 两向都断，别只留下限
     （同 09-28「判据只断下限会诱发调过头」）。 */
  check('⑤ 「2027」成形且**分成 ≥4 段**（四个数字各自成段 ⇒ 不是糊成团、也不出框；'
      + '贡献 0.3~6 万 px = 稳定窗）',
    word.segs.length >= 4 && word.px > 3000 && word.px < 60000,
    `贡献 ${word.px}px · ${word.segs.length} 段：${word.segs.map(([a, w]) => `${a}+${w}`).join(' ')}`);
  await page.screenshot({ path: path.join(OUT, '03-彩蛋2027.png') });

  /* ── ④ 自检：强制关掉 ⇒ flash 恒 0、天上那层贡献 0 ── */
  const off = await page.evaluate(async () => {
    const G = window.__garden;
    G.setFireworksForce(false);
    await new Promise(r => { const t0 = performance.now();
      const f = () => (performance.now() - t0 > 2500) ? r() : requestAnimationFrame(f); f(); });
    return { st: G.fireworksState() };
  });
  check('④ 自检：强制关掉后 flash 恒 0、且没有在飞的弹',
    off.st.flash === 0 && off.st.shells === 0, `flash=${off.st.flash} shells=${off.st.shells}`);

  check('零 pageerror / console error', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close(); server.close();
  const fails = results.filter(r => !r.ok).length;
  console.log(`\n[fireworks-guard] ${fails ? fails + ' FAILED' : 'ALL PASS'}（${results.length} 项）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('[fireworks-guard] 探针异常：', e); process.exit(2); });
