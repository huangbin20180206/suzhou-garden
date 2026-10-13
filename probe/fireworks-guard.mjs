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

  /* ── ① 契约（2026-10-11 翻面）：烟花**不再自动**，只认用户那一次点击 ──────────────
     老黄 2026-10-11："我只点'灯会'按钮，系统会自动帮我把'灯会'+'烟花'联动，这个不合理，
     两个应该是可以单独成景，也可以同时起作用"。
     原来的门控是"冬·夜·晴 ⇒ 自动放"，而灯会会把时段切到夜里 ⇒ 点灯会就顺带把烟花点着了。
     现在：force=null（没人点过）⇒ **一律不放**；force=true（用户点过）⇒ 放，
     但"夜里 + 无雨雪雷暴"仍是否决条件。
     ⚠️ 每条都先断言"干预真的施加了"（项目铁律）—— 尤其"否决"那三条必须**强开**再断言关，
        否则它们会退化成恒绿的空判据（那比没有门禁更坏）。 */
  const gate = await page.evaluate(async () => {
    const G = window.__garden;
    const w = async (o, force) => {
      if (force !== undefined) G.setFireworksForce(force);
      for (const k in o) G.setEnv(k, o[k]);
      await new Promise(r => { const t0 = performance.now();
        const f = () => (performance.now() - t0 > 2800) ? r() : requestAnimationFrame(f); f(); });
      return G.fireworksState().on;
    };
    const out = {};
    G.setFireworksForce(null);                                   // 没人点过
    out.autoWinterNight = await w({ season: 'winter', time: 'night', weather: 'clear' });
    out.autoSummerNight = await w({ season: 'summer' });          // 依然没人点
    G.setFireworksForce(null);
    out.onWinterNight = await w({ season: 'winter', time: 'night', weather: 'clear' }, true);
    out.onSummerNight = await w({ season: 'summer' }, true);      // 不再冬季限定 ⇒ 夏夜也能放
    out.onNoon  = await w({ season: 'winter', time: 'noon' }, true);      // 白天是否决
    out.onStorm = await w({ season: 'summer', weather: 'storm' }, true);  // 暴雨否决（冬不许用 storm）
    out.onSnow  = await w({ season: 'winter', weather: 'snow' }, true);   // 雪否决
    await w({ season: 'winter', time: 'night', weather: 'clear' }, true);
    G.setFireworksForce(null);
    return out;
  });
  check('① 不再自动：冬·夜·晴 但没人点过 ⇒ 关（2026-10-11 翻面的新契约）',
    gate.autoWinterNight === false, `on=${gate.autoWinterNight}`);
  check('① 不再自动：没人点过时夏夜同样关', gate.autoSummerNight === false, `on=${gate.autoSummerNight}`);
  check('① 用户点过 ⇒ 冬·夜·晴 就放', gate.onWinterNight === true, `on=${gate.onWinterNight}`);
  check('① 与季节解耦：用户点过的夏夜也放（"四季都能单独成景"）',
    gate.onSummerNight === true, `on=${gate.onSummerNight}`);
  check('① 否决：白天（正午）强开也不放', gate.onNoon === false, `on=${gate.onNoon}`);
  check('① 否决：暴雨里强开也不放', gate.onStorm === false, `on=${gate.onStorm}`);
  check('① 否决：雪里强开也不放', gate.onSnow === false, `on=${gate.onSnow}`);

  /* ── ①b 回归：老黄 2026-10-11 报的那条 bug —— 点「灯会」不许把烟花（和流星）带出来 ── */
  const fest = await page.evaluate(async () => {
    const G = window.__garden;
    G.setFireworksForce(null); G.setMeteorsForce(null);
    G.setEnv('season', 'winter'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon');
    await new Promise(r => { const t0 = performance.now();
      const f = () => (performance.now() - t0 > 2800) ? r() : requestAnimationFrame(f); f(); });
    G.toggleFestival(true);                       // 点「灯会」（它会把时段切到夜 = 旧的触发条件）
    for (let i = 0; i < 120; i++){ if (G.ENV.t >= 1) break; await new Promise(r => requestAnimationFrame(r)); }
    await new Promise(r => setTimeout(r, 600));
    return { festival: !!G.ENV.festival, time: G.ENV.time,
             fw: G.fireworksState().on, mt: G.meteorState().on };
  });
  check('①b 回归（老黄报的）：点「灯会」不许顺带把**烟花**点着',
    fest.festival === true && fest.fw === false,
    `灯会=${fest.festival} 时段=${fest.time} 烟花=${fest.fw}`);
  check('①b 同理：点「灯会」也不许顺带带出**流星**（同一个毛病）',
    fest.mt === false, `流星=${fest.mt}`);
  await page.evaluate(() => { const G = window.__garden; G.toggleFestival(false); });

  /* ── ①c 组合与交叉保护：两个景可以同时开；关掉一个不许把另一个的"夜/晴"带走 ─────────
     老黄 2026-10-11："两个应该是可以单独成景，**也可以同时起作用**"。
     走**真实点击路径**（DOM 级 click，项目规矩：探针别用 page.click 等可见性）。 */
  const clickAct = (act) => page.evaluate((a) => {
    const b = document.querySelector(`#env button[data-act="${a}"]`);
    if (!b) return false;
    b.click();
    return true;
  }, act);
  const waitSettle = () => page.evaluate(async () => {
    for (let i = 0; i < 200; i++){ if (window.__garden.ENV.t >= 1) break; await new Promise(r => requestAnimationFrame(r)); }
    await new Promise(r => setTimeout(r, 700));
  });
  /* 先把场景设成"正午·晴"（这样两个景都得靠自己去切夜 ⇒ 才会各自记下 setTime）*/
  const combo = await page.evaluate(async () => {
    const G = window.__garden;
    G.setMeteorsForce(null); G.setFireworksForce(null);
    G.setEnv('season', 'summer'); G.setEnv('weather', 'clear'); G.setEnv('time', 'noon');
    for (let i = 0; i < 200; i++){ if (G.ENV.t >= 1) break; await new Promise(r => requestAnimationFrame(r)); }
    return true;
  });
  const a1 = await clickAct('meteor');           // 1) 点「流星雨」（从正午 ⇒ 它切夜并记住正午）
  await waitSettle();
  const s1 = await page.evaluate(() => { const G = window.__garden;
    return { mt: G.meteorState().on, fw: G.fireworksState().on, time: G.ENV.time }; });
  const a2 = await clickAct('fireworks');        // 2) 再点「烟花」（时段已是夜 ⇒ 它不该再记 setTime）
  await waitSettle();
  const s2 = await page.evaluate(() => { const G = window.__garden;
    return { mt: G.meteorState().on, fw: G.fireworksState().on, time: G.ENV.time }; });
  await clickAct('meteor');                      // 3) 关掉「流星雨」——必须**不动**时段（烟花还要夜）
  await waitSettle();
  const s3 = await page.evaluate(() => { const G = window.__garden;
    return { mt: G.meteorState().on, fw: G.fireworksState().on, time: G.ENV.time }; });
  await clickAct('fireworks');                   // 收尾：关掉烟花
  await waitSettle();
  const s4 = await page.evaluate(() => { const G = window.__garden;
    return { mt: G.meteorState().on, fw: G.fireworksState().on, time: G.ENV.time }; });
  check('①c 两个景可以同时开（正午点「流星雨」再点「烟花」⇒ 两个都亮）',
    a1 && a2 && s1.mt === true && s2.mt === true && s2.fw === true && s2.time === 'night',
    `流星=${s1.mt}/${s2.mt} 烟花=${s1.fw}/${s2.fw} 时段=${s1.time}→${s2.time}`);
  check('①c 交叉保护：关掉「流星雨」不许把「烟花」的夜一起还给正午（否则连坐）',
    s3.fw === true && s3.time === 'night',
    `关流星后：流星=${s3.mt} 烟花=${s3.fw} 时段=${s3.time}`);
  check('①c 两个景都关掉之后，时段才回到进来前的正午',
    s4.fw === false && s4.time === 'noon', `收尾：烟花=${s4.fw} 时段=${s4.time}`);

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
  /* ⚠️⚠️ 2026-10-13 D 案第 1/2 步：**取样顺序反转** —— 先等相机到位，再点火，再等仿真年龄。
     根因①：gotoViewpoint 是 1.4s 插值飞行（08-assemble.js:3456 → flyTo :3229，dur=1.4），
     旧写法调完它就立刻开始等年龄，等于整段飞行还没结束就已经在取样。而彩蛋在世界坐标里
     完全没动（12b-sky.js:623 cx=0,cy=34,cz=-52 固定，只有发射点有 ±1.25 抖动 :627/:629），
     变的只有相机距离，于是同一个字在屏幕上被量成不同宽度（实测字形横向范围 1018px vs 686px）。
     那不是数字出画，是相机还远着、字还没占满画框。
     相机到位判据用**机位字面量距离**（不是位移收敛）：__garden.camera 已在 11-loop.js:1717 暴露，
     fireworks 机位 pos=(-13,12,26) 见 08-assemble.js:3451。
     读数出处：outputs/_diag/fw-d-layout-guardvp.log —— camDist 收敛到 0m（该量是**世界坐标距离**，与视口无关）
     （simT 0.10 → 1.25），阈值取 **< 0.5m**（收敛末段实测 0.00~0.07m，有 7~10 倍余量）。
     顺序必须到位后才点火：先点火的话彩蛋会在 1.4s 飞行里就开始老化
     （实测 age=1e9 即根本没触发，sinceFin 在等相机期间被走完）。 */
  /* ⚠️⚠️ 2026-10-13 D 案第 1/2 步：**取样顺序** —— 先发起飞行 → 等相机到位 → 再点火 → 再等仿真年龄。
     根因①：gotoViewpoint 是 1.4s 插值飞行（08-assemble.js:3456 → flyTo :3229，dur=1.4）。
     旧写法调完它就立刻开始等年龄，等于整段飞行还没结束就已经在取样。而彩蛋在世界坐标里
     完全没动（12b-sky.js:623 cx=0,cy=34,cz=-52 固定，只有发射点有 ±1.25 抖动 :627/:629），
     变的只有相机距离，于是同一个字在屏幕上被量成不同宽度（实测字形横向范围 1018px vs 686px）。
     那不是数字出画，是相机还远着、字还没占满画框。
     相机到位判据用**机位字面量距离**（不是位移收敛）：__garden.camera 已在 11-loop.js:1717 暴露，
     fireworks 机位 pos=(-13,12,26) 见 08-assemble.js:3451。
     读数出处：outputs/_diag/fw-d-layout-guardvp.log —— camDist 收敛到 0m（该量是**世界坐标距离**，与视口无关）
     （simT 0.10 → 1.25），阈值取 **< 0.5m**（收敛末段实测 0.00~0.07m，有 7~10 倍余量）。
     ⚠️ 顺序上「等相机」必须在「发起飞行」**之后**：第一版把等待块写在 gotoViewpoint 之前，
     等于等一个还没开始的飞行 —— 5 次复跑全部读到机位距 10.488m（原点位，从未移动）。
     同样必须「到位后才点火」：先点火的话彩蛋会在 1.4s 飞行里就开始老化。 */
  await page.evaluate(() => { window.__garden.setFireworksForce(true); });
  await page.evaluate(() => { window.__garden.gotoViewpoint('fireworks'); });  // 先发起 1.4s 飞行
  const camSettled = await page.waitForFunction(() => {
    const p = window.__garden.camera.position;
    return Math.hypot(p.x - (-13), p.y - 12, p.z - 26) < 0.5;
  }, null, { polling: 30, timeout: 90000 }).then(() => true).catch(() => false);
  const camDist = await page.evaluate(() => {
    const p = window.__garden.camera.position;
    return +Math.hypot(p.x - (-13), p.y - 12, p.z - 26).toFixed(3);
  });
  check('⑤ 前提A：**相机已落到 fireworks 机位**（<0.5m）—— 飞行途中取样会把同一个字量成不同宽度',
    camSettled && camDist < 0.5, `机位距 ${camDist}m（阈值 0.5m，收敛读数见 fw-d-layout-guardvp.log）`);
  await page.evaluate(() => { window.__garden.fireworksFinaleNow(); });  // 到位之后才点火
  const firedOk = await page.waitForFunction(() => window.__garden.fireworksState().finale >= 1,
    null, { polling: 30, timeout: 90000 }).then(() => true).catch(() => false);
  const fin = await page.evaluate(() => window.__garden.fireworksState());
  check('⑤ 前提B：彩蛋已触发（finale >= 1）—— 等不到就判红，不静默放过去',
    firedOk && fin.finale >= 1, `finale=${fin.finale}`);
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
     现在先等年龄 ≥1.5 再量，形状是确定性的；并把年龄本身作为**前提断言**打出来。
     ⚠️ 2026-10-07 门槛 1.5 → **2.4s**：老黄要求"燃放过程再长一些"，收拢时长从 0.55s 改成
        1.25s 且每颗火星再各自错峰 ≤0.45s ⇒ 字要到 **1.7s 之后**才完全成形、之后才是慢摆；
        还在 1.5s 取样会量到"正在成形"的中间态（笔画没连上，段数会虚高或虚低）。 */
  /* ⚠️⚠️ 2026-10-13 D 案第 1 步续：**超时按机制推导，不拍数字**。
     ages 是仿真量（11-loop.js:960 tickFireworks(dt) 的 dt 来自 stepSim 固定步长累加器
     :873 FIXED_DT=1/60、:882 while(simAccum>=FIXED_DT && n<MAX_STEPS)），
     而 MAX_STEPS=6（:874）= 一帧最多补 6 步 = 100ms 仿真，:883 `if(n>=MAX_STEPS) simAccum=0`
     把更长的间隔**直接丢弃** ⇒ 帧率低于 10fps 时仿真**结构性落后于墙钟**。
     实测（outputs/_diag/fw-d-feasibility 轨迹）：wall=27.93s 时 simT 才 0.88s，比值约 0.03。
     推导：要把仿真推进到 ages>=2.4，最坏情况是每帧都撞上 MAX_STEPS 丢步、帧率恰好 ~10fps
     ⇒ 仿真推进速率上限 = 100ms 仿真 / 100ms 墙钟 = 1.0，慢时按实测比值 0.03 计。
     取 **timeout = 120000ms** 覆盖两档（快机 ~3s、慢机按 0.03 需 ~80s），留 1.5 倍余量。
     ⚠️ 更关键：旧写法的 `.catch(() => false)`/空catch 会把「等不到」变成「前提为假」——
     那是**假红**的源头之一。现在等不到就单独判红，且把仿真推进量也打出来（可自证仿真钟没推进）。 */
  const tWait0 = Date.now();
  const fwReady = await page.waitForFunction(() => {
    const a = window.__garden.fireworksState().ages || [];
    return a.length >= 4 && Math.min(...a) >= 2.4;
  }, null, { polling: 30, timeout: 120000 }).then(() => true).catch(() => false);
  const finAge = await page.evaluate(() =>
    Math.min(...(window.__garden.fireworksState().ages || [1e9])));
  const simSnap = await page.evaluate(() => {
    const s = window.__garden.simState();
    return { simTime: +s.simTime.toFixed(2), steps: s.steps, fixed: s.fixed };
  });
  check('⑤ 前提C：取样时壳年龄已进入「成形稳定窗」（仿真年龄 ≥2.4s）—— 等不到就判红，不静默放过',
    fwReady && finAge >= 2.4,
    `年龄 ${(+finAge).toFixed(2)}s（等 ${((Date.now()-tWait0)/1000).toFixed(1)}s 墙钟；`
    + `simTime=${simSnap.simTime} fixed=${simSnap.fixed} → 补步上限 6×fixed=0.1s 仿真/帧）`);
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
    return { px: n, segs, W };
  });
  /* ⚠️ 上限 6 万 px 是**第二条牙**（2026-10-06 加）：成形稳定窗里贡献约 0.75 万 px，
     而"取样落在闪光峰值期（年龄 ~1.0s）"时是 13.7~61 万 px（整幅被 bloom 晕开）。
     下限只管"有没有画出来"，上限专抓"取样早了/又被晕开" —— 两向都断，别只留下限
     （同 09-28「判据只断下限会诱发调过头」）。 */
  check('⑤ 「2027」成形且**分成 ≥4 段**（四个数字各自成段 ⇒ 不是糊成团、也不出框；'
      + '贡献 0.3~6 万 px = 稳定窗）',
    word.segs.length >= 4 && word.px > 3000 && word.px < 60000,
    `贡献 ${word.px}px · ${word.segs.length} 段：${word.segs.map(([a, w]) => `${a}+${w}`).join(' ')}`);
  /* ⚠️ 2026-10-07 新增**第二条牙**：「仍然是 2027」的量化口径 —— 四个数字各成一**大簇**。
     背景：老黄要"不用做得这么工整，能识别出来是 2027 就行"，于是给点阵加了参差（每字小倾角/
     大小差、每颗火星落点抖动、成形后慢摆）。第一版抖得偏大（±0.25m + 摆 ±0.30m）时，
     横向段数从 4 涨到 **11** —— 上面那条 ≥4 照样绿（段数只会更多），可笔画已经碎成断续小点。
     ⇒ 用"把小间隔并起来的**簇数**"当判据：簇数应当正好 **4**（每个数字一簇），
       且每簇宽度 ≥40px（太窄就是碎渣）。这才是"看得出来是 2027"的守门人。 */
  /* ⚠️⚠️ 2026-10-13 D 案第 3 步：判据从「merge 聚簇」换成「**对齐产品自己算好的字形布局**」。
     根因③：旧判据用 `const merge = 24` 把列投影按 24px 合并成簇，但
       · 判据 A（段宽 >= 6px）用的是**笔画尺度**；
       · 判据 B（簇宽 >= 40px）用的是**数字尺度**；
       · 而真字距约 71px（12b-sky.js:345 FW_FIN_GAP=11.0m）⇒ **40px 合并窗刚好跨不过字距**，
         簇数天生不稳，且簇数是 merge 这个**发明参数**的函数而不是被测物的性质。
     本机噪声底实测（outputs/_diag/fw-noise-floor-run2.log，10 个有效样本）恰好印证：
       merge=24 → 簇数恒 4；merge=32 → 恒 4；merge=40 → 出现 3（2/10 次）。
     ⇒ merge 窗已随本判据一并删除，下面不再有 `merge` 这个量。

     改成什么：用 `fireworksState().word`（= FW_WORD，产品自己的 "2027"）与字形世界坐标
     （12b-sky.js:623 cx=0, cy=34, cz=-52，按 FW_FIN_GAP 等距四发）**在探针侧复算四个数字的
     预期屏幕中心**，然后断言「实测亮区的横向分布与这四个预期中心一致」。
     这样「是 2027」变成真的在验字形布局，而不是验「看起来像 4 团东西」—— 比旧判据更硬。

     ⚠️ 阈值出处以**下方 :464 那段为准**（2026-10-13 Chief 08:20 裁定，源 fw-d-layout-guardvp.log）。
     早期注释引用的 fw-d-layout-run.log（预期中心 [444,581,712,837]）**已作废**：
     那份噪声底脚本 fw-d-layout.mjs:16 用 viewport 1280×800，与本守卫 :49 的 1200×700
     aspect 不同（1.6000 vs 1.7143）⇒ 投影矩阵不同 ⇒ 屏幕 x 不可比。
     所谓「判据整组右移 90px」就是这个错配造成的读数差，**不是产品缺陷、也不是判据错**。
     相机 camDist 阈值 < 0.5m 一项仍然有效（该量是**世界坐标距离**，与视口无关）：
     outputs/_diag/fw-d-layout-guardvp.log 读数 0.428 / 0×9 m（10 个有效样本）。 */
  const proj = await page.evaluate(() => {
    const G = window.__garden;
    const st = G.fireworksState();
    const W = G.renderer.domElement.width;
    const V = G.camera.position.constructor;
    /* 世界布局常数取自 src/12b-sky.js:623（彩蛋固定在世界坐标，只有发射点有抖动）。
       GAP = FW_FIN_GAP = 11.0（同文件 :345）—— 这里写成字面量是因为探针侧拿不到该模块的常量，
       而它同时由本条判据的**读数校验**兜着：expected.x 与实测段位置不符时这条 check 会红。 */
    const FW_X = 0, FW_Y = 34, FW_Z = -52, GAP = 11.0;
    const expected = [...st.word].map((ch, i) => {
      const v = new V(FW_X + (i - (st.word.length - 1) / 2) * GAP, FW_Y, FW_Z);
      v.project(G.camera);
      return { ch, x: (v.x * 0.5 + 0.5) * W };
    });
    return { expected, word: st.word, digitH: st.digitH };
  });
  /* ⚠️ 2026-10-13 修一个**从未跑出过结果**的判据：上一版把归簇算成写进了 page.evaluate，
     却在浏览器上下文里引用 Node 侧变量 `word.segs` ⇒ ReferenceError: word is not defined，
     被守卫末尾的 catch 收成 exit=2 —— 判据「字形布局对齐」其实一次都没执行过。
     归簇是纯算术、不需要页面对象，故搬回 Node 侧，用上面 evaluate 回来的 segs 算。 */
  const layout = (() => {
    const expected = proj.expected;
    /* ⚠️⚠️ 2026-10-13 Chief 08:20 裁定重写本判据。旧版（"每数字有段 + 无游离段 + CENTER_TOL=40/60px"）
       **判红是噪声、判绿是瞎的**，三重问题，逐条有读数：

       ① 游离段判据必然 FLAKY（fw-d-run3.log 实测红）：
          边缘窄笔画段（479+7、1012+6）是**真实字形**，天然离中心 50~54px
          （距中心 54px / 50px，见 run3 的"游离段=2"）。判据把它们卡成游离 ⇒ 基线与缺陷都红。
          ⇒ **整条删除**：拿边缘窄笔画卡阈值 = 被噪声绑架。
       ② 阈值 60px 会让归簇摇摆：实测相邻中心间距 149/143/137px（半间距 68~74px），
          60px 距相邻容差区重叠只差 8~14px ⇒ 同一段可能归两个数字 ⇒ 正是要消灭的 FLAKY。
       ③ 旧版只给**存在性断言**（每个数字位置上有没有段），不断言**位置对不对**：
          判据整组平移 90px 时它照样全绿 —— 这就是 08:05「run1 假绿」的成因。
        （当时的 90px 是**跨视口**读数差：旧噪声底 1280×800 vs 守卫 1200×700，已作废，见 :432。）

       新版 = **质心断言**（Chief 08:20 定）：每个数字取归簇段中点的**质心**，
       断言 |质心x − 预期中心x| <= CENTROID_TOL。质心对"少一两根边缘窄笔画"天然不敏感
       （窄段权重小），却对"整字平移/某数字整体缺失"极其敏感 —— 正是要的两头。

       归属窗 ATTR_TOL 是另一个量，只决定"某段算哪个数字的"，**不用来判红**（判红只看质心偏移）。
       取值 60px 的依据（fw-d-layout-guardvp.log 统计段）：相邻中心间距 149.4 / 142.8 / 136.8px，
       中垂线距最近中心 74.7 / 71.4 / 68.4px ⇒ 60px 不跨中垂线，每段归属唯一；
       同时 60px 覆盖噪声底里全部段（最远一段距中心 53.6px）⇒ 真实字形段不会被漏掉。

       ⚠️ 阈值出处（**同配置复测**，2026-10-13）：outputs/_diag/fw-d-layout-guardvp.log
         —— 脚本 outputs/_diag/fw-d-layout.mjs（视口已于 2026-10-13 从 1280×800 改为 1200×700），
            viewport **1200×700 ≡ 本守卫 :49**，
            口径完全同序（先等相机到位 → 再点火 → 等仿真年龄 >= 2.4s → 差分取段）。
            前一份 fw-d-layout-run.log 用的是 1280×800（fw-d-layout.mjs:16，aspect 1.6 vs 1.7143），
            **对守卫无效已作废**，那份才是"整组右移 90px"的来源，不是产品缺陷。
         —— 6 次采样中 3 次有效（另 3 次 age=1e9 = 彩蛋未触发，见下），偏移读数：
              数字0  min -5.7  max -4.7  极差 1.0px
              数字1  min -3.0  max -1.7  极差 1.3px
              数字2  min +3.2  max +3.2  极差 0.0px
              数字3  min +3.0  max +4.3  极差 1.3px
            ⇒ 质心偏差绝对值最大 **5.7px**，跨样本极差最大 **1.3px**；
               预期中心 x 跨样本**逐位相同**（波动 0.0px）⇒ 预期中心可作基线。
         —— 取 **CENTROID_TOL = 30px** = 5.7 × 5.3 倍余量（远大于极差 1.3px，判红只由真实缺陷触发）；
            同时 30px << 半字距 68px，一个数字的质心不可能落进相邻数字的合格区。
            （30px 这个数也正是 Chief 08:20 指定的上限，噪声底证明它有 5 倍余量 ⇒ 不需放宽。）
    */
    const ATTR_TOL = 60;
    const per = expected.map(() => []);
    for (const [x0, w] of word.segs){
      const mid = x0 + w / 2;
      let best = -1, bd = Infinity;
      expected.forEach((e, i) => { const d = Math.abs(e.x - mid); if (d < bd){ bd = d; best = i; } });
      if (bd <= ATTR_TOL) per[best].push([x0, w]);   /* 超出归属窗的段不计入任何数字（不进质心） */
    }
    /* 质心 = 归簇段中点按**段宽加权**的均值：宽笔画主导，边缘窄段（7px）几乎不影响 */
    const cen = per.map(list => {
      if (!list.length) return null;
      const sw = list.reduce((s, [, w]) => s + w, 0);
      return list.reduce((s, [x0, w]) => s + (x0 + w / 2) * w, 0) / sw;
    });
    const off = cen.map((c, i) => (c === null ? null : c - expected[i].x));
    return { expected, per, cen, off, word: proj.word, digitH: proj.digitH };
  })();
  /* 质心断言成立条件（Chief 08:20 定，两条）：
     ① 每个数字都归到段、且最大段宽 >= 6px（笔画存在、不是碎渣；某数字整体缺失由①挡住）；
     ② 每个数字的质心与预期中心的偏移 <= CENTROID_TOL（**量值断言**，
        这条就是对坐标系整体平移/缩放装上的牙 —— 旧判据在这里是瞎的）。 */
  const CENTROID_TOL = 30;
  const layoutOK = layout.per.every(p => p.length > 0 && Math.max(...p.map(([, w]) => w)) >= 6)
    && layout.off.every(o => o !== null && Math.abs(o) <= CENTROID_TOL);
  check('⑤ 「2027」**字形布局对齐产品自己的布局**：每个数字归到段（最大段宽 ≥6px）'
      + `且**质心落在预期中心 ±${CENTROID_TOL}px 内**（量值断言，专抓整字平移/数字缺失）—— 而不是靠 merge 猜「大概 4 簇」`,
    layoutOK,
    `字=${layout.word} 预期中心x=[${layout.expected.map(e => Math.round(e.x)).join(',')}] `
    + `各数字段数=[${layout.per.map(p => p.length).join(',')}] `
    + `段宽=[${layout.per.map(p => p.map(([, w]) => w).join('/')).join(' | ')}] `
    + `质心x=[${layout.cen.map(c => c === null ? '-' : Math.round(c)).join(',')}] `
    + `质心偏移px=[${layout.off.map(o => o === null ? '-' : (o >= 0 ? '+' : '') + o.toFixed(1)).join(',')}] `
    + `（阈值 ±${CENTROID_TOL}px，噪声底实测极差 1.3px / 最大偏差 5.7px，源 fw-d-layout-guardvp.log）`);

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
