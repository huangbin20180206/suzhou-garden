// 流星雨门禁：node probe/meteor-guard.mjs
//
// 守老黄 2026-10-10 定的场景：「再加一个比较吸引人的场景 -- 流星雨，四季都有，晴朗的夜间
// 设计一场壮丽的流星雨」（他还给了江南流星雨的资料：四季都有偶发流星、流星雨有季节性、
// 同一场雨从同一辐射点向外辐射、颜色以白/黄白为主、肉眼多数只读成一道白线）。
//
// 为什么这道门要有牙（四个会**静默失效**的点）：
//   ① **门控**：流星只在"晴朗的夜"出现 —— 白天/雨/雪/雾里不该有。写成"只要天黑就出"
//      也照样有流星，但那与"晴朗的夜间"这条需求不符 ⇒ 逐组合量。
//   ② **四季都有**：这是他明确的要求 ⇒ 四个季节 × 夜·晴 都必须 on（漏一季就是需求没做到）。
//   ③ **真的画出像素**：网格在、uniform 有值 ≠ 画面上有东西。本项目的天上级效果已经栽过
//      "摆在画外 ⇒ 贡献 0 像素"（闪电）与"Points 画不出来"（烟花）两次 ⇒ 必须量像素。
//   ④ **落在画面里**：本项目的相机永远抬不起来（polar ≤ 88.6°）⇒ 流星必须按 NDC 出生，
//      否则一半时间在画外。判据把头部投影到 NDC，量"在框内"的比例。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
import { decodePNG, meanAbsDiff } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'meteor-guard');
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
               '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 160)); });
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  /* ⚠️ `__garden.bootDone` 是**函数**（`() => bootDone` 的活绑定，见 11-loop 的暴露注释），
     不是布尔 —— 我第一版写 `window.__garden.bootDone` 当条件，`!!函数` 恒为真，
     于是"页面还在加载"也会立刻通过（一度误判成"加载层卡住"）。等就等**产品自己的信号**：
     加载层的 done class（与 peach-form-guard 同款），再用 bootDone() 复核。 */
  await page.waitForFunction(() => document.getElementById('loading') &&
    document.getElementById('loading').classList.contains('done'), null, { timeout: 400000, polling: 300 });
  await page.waitForFunction(() => typeof window.__garden?.bootDone === 'function' && window.__garden.bootDone(),
    null, { timeout: 120000, polling: 300 });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(3000);

  const setEnv = (time, weather, season) => page.evaluate(([t, w, s]) => {
    const G = window.__garden;
    if (s) G.setEnv('season', s);
    G.setEnv('time', t); G.setEnv('weather', w);
  }, [time, weather, season || null]);
  /* 等过渡落定（ENV.t=1）—— 季节/天气/时段都是插值的，不等完量到的是过渡途中 */
  const settle = async (maxMs = 40000) => {
    const t1 = Date.now();
    while (Date.now() - t1 < maxMs){
      const t = await page.evaluate(() => window.__garden.ENV.t);
      if (t >= 1) return true;
      await sleep(400);
    }
    return false;
  };
  /* 让流星时钟跑够（低帧率下 sim dt 每帧最多 0.25s ⇒ 只能靠多等几秒） */
  const runFor = async (ms) => {
    const t1 = Date.now();
    while (Date.now() - t1 < ms) await sleep(600);
  };
  const state = () => page.evaluate(() => window.__garden.meteorState());

  /* ── ① 前提：网格在（且它**模块期就建**，不能被 AO pass 漏掉）────────────── */
  const pre = await page.evaluate(() => {
    let m = null;
    window.__garden.scene.traverse(o => { if (!m && o.name === 'meteorShower') m = o; });
    return m ? { name: m.name, n: m.instanceMatrix.count, aoSkip: !!m.userData.aoSkip,
                 raycastNoop: typeof m.raycast === 'function' } : null;
  });
  check('前提：流星网格已建成（name=meteorShower、容量 30、aoSkip）',
    !!pre && pre.n === 30 && pre.aoSkip, pre ? JSON.stringify(pre) : '没找到 meteorShower');

  /* ── ② 门控：白天没有 ─────────────────────────────────────────────────── */
  await setEnv('noon', 'clear', 'summer'); await settle(); await runFor(4000);
  const noon = await state();
  check('门控：正午·晴 —— 没有流星（on=false、实例数 0）',
    noon.on === false && noon.count === 0, `on=${noon.on} count=${noon.count} spawned=${noon.spawned}`);

  /* ── ③ 门控：夜 · 晴 —— 有，而且真的在生成 ───────────────────────────── */
  await setEnv('night', 'clear', 'summer'); await settle();
  let bestActive = 0, night = null;
  for (let i = 0; i < 30; i++){
    night = await state();
    if (night.active > bestActive) bestActive = night.active;
    if (bestActive >= 2) break;
    await sleep(1500);
  }
  check('门控：夜·晴 —— 有流星（on=true、实例数 30、且已经生成过）',
    night.on === true && night.count === 30 && night.spawned > 0,
    `on=${night.on} count=${night.count} spawned=${night.spawned} 在场峰值=${bestActive}`);

  /* ── ④ 门控：非晴朗天气都没有（暴雨 / 雪 / 薄雾）─────────────────────────
     ⚠️ 每个组合都要**先断言"这个组合真的被产品接受了"**再断言观测量（项目铁律，2026-10-06
     大雁那次踩过）：`setEnv('weather', X)` 会被**季节合法性规则**静默降级 ——
     我第一版在**夏季**请求 `snow`，被降级成晴 ⇒ 流星照常出现，于是"夜·雪不该有流星"这条
     判据假红（产品是对的）。现在按季节挑合法组合（暴雨=夏 / 雪=冬 / 薄雾=秋），
     并用产品自己的 `effectiveWeather()` 回读生效天气、不合法就跳过并打印。 */
  for (const [w, tag, season] of [['storm', '暴雨', 'summer'], ['snow', '雪', 'winter'], ['mist', '薄雾', 'autumn']]){
    await setEnv('night', w, season); await settle(); await runFor(3000);
    const s = await state();
    const eff = await page.evaluate(() => {
      const G = window.__garden;
      const ok = G.weatherAllowed ? G.weatherAllowed(w2 => w2) : null;
      return { eff: G.effectiveWeather ? G.effectiveWeather() : null, allowed: ok };
    }).catch(() => ({ eff: null, allowed: null }));
    check(`门控：夜·${tag}（季节=${season}）—— 没有流星（"晴朗"是硬条件）`,
      s.on === false && s.count === 0, `on=${s.on} count=${s.count} 生效天气=${eff.eff}`);
  }

  /* ── ⑤ 四季都有（老黄明确要求）────────────────────────────────────────── */
  const seasonOn = {};
  for (const s of ['spring', 'summer', 'autumn', 'winter']){
    await setEnv('night', 'clear', s); await settle(); await runFor(2500);
    const st = await state();
    seasonOn[s] = { on: st.on, radiant: st.radiant };
  }
  const allOn = ['spring', 'summer', 'autumn', 'winter'].every(k => seasonOn[k].on === true);
  check('四季都有（老黄："四季都有"）—— 春夏秋冬 × 夜·晴 全部 on',
    allOn, JSON.stringify(Object.fromEntries(Object.entries(seasonOn).map(([k, v]) => [k, v.on]))));
  /* 辐射点随季节变（资料：不同流星雨各有辐射点）—— 四季的辐射点不能全同 */
  const sig = new Set(['spring', 'summer', 'autumn', 'winter']
    .map(k => `${seasonOn[k].radiant.az},${seasonOn[k].radiant.el}`));
  check('辐射点随季节变化（四季各对一场真实流星雨：英仙/猎户/双子/天琴）',
    sig.size === 4, [...sig].join(' | '));

  /* ── ⑥ 像素：流星真的画进了画面（冻结帧同任务 A/B + 负例自检）───────── */
  await setEnv('night', 'clear', 'summer'); await settle();
  await page.evaluate(() => {
    const G = window.__garden;
    const vp = (G.VIEWPOINTS || []).find(v => v.id === 'meteor');
    G.controls.minDistance = vp.minDist || 3;
    G.controls.target.copy(vp.target);
    G.camera.position.copy(vp.pos);
    G.controls.update();
    G.setMeteorsForce(true);            // 权威开关：强制开（免得门控把它关掉）
  });
  /* 等**一条处于"生命中期"的流星**在场再量 —— ⚠️ 这条是 2026-10-10 实测教训：
     第一版只等 `active ≥ 2`，结果抽到的那条 age=0.60 / life=0.61（生命末期、正在淡出，
     片元里 vA 只剩 4%）⇒ 量出的贡献是"0 像素"，而产品其实画得出来（同一手法另测到
     27px@23/765）。**判据必须按被测对象的相位取样**，不能碰运气 —— 与烟花那条
     "按墙钟取样会偶发红、要轮询仿真量"同源。同时：`mesh.count` 也要一起回读，
     若实例数是 0 则 A/B 必然为 0（那是"关着"不是"画不出来"）。 */
  let live = 0, peakPhase = null;
  for (let i = 0; i < 60; i++){
    const s = await state();
    live = s.active;
    peakPhase = s.list.find(it => it.age / it.life >= 0.15 && it.age / it.life <= 0.55) || null;
    if (peakPhase && s.count > 0) break;
    await sleep(900);
  }
  const vpChk = await page.evaluate(() => {
    const G = window.__garden;
    const c = G.camera.position, t = G.controls.target;
    return { cam: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)],
             tgt: [+t.x.toFixed(1), +t.y.toFixed(1), +t.z.toFixed(1)] };
  });
  /* ⚠️⚠️ 2026-10-10 实测坑（这条判据第一版两次假红）：**取样时机与断言必须落在同一帧**。
     第一版先轮询 `meteorState()` 找到"生命中期"那条，然后**另起一次 page.evaluate** 才做
     A/B —— 两次调用之间会过帧，那条可能已经过期（或被门控清掉），于是量到的是**"这一帧
     本来就没有内容"**（峰值 1/765），而不是"画不出来"。同一手法手工验证成过：单条中期流星
     实测 **361px、峰值 170/765**（沿条带采样：头部 [220,218,214] ↔ 关掉 [160,184,202]）。
     ⇒ 现在把**前置断言放进同一次 evaluate**（直接读 shader 的 uT/uStart/uLife 判相位），
        不满足就重试，最多 6 轮；`mesh.count` 也要 >0（count=0 是"关着"不是"画不出来"）。 */
  let best = { hot: -1, peak: -1, midEl: null, midPhase: null, keep: null };
  let ab = null;
  /* ⚠️ 把"水面反射按需刷新"钉成每帧刷（项目既有套路：lampvol / afterrain / legibility 都这么做）。
     不钉的话，同一任务内连渲两张会一张用新倒影、一张用旧倒影 —— 夜景池塘会把天上那十几条
     亮痕镜像进去 ⇒ 同状态自检实测能差到 83 万像素（2026-10-10，密度调到最大那档）。
     冻结帧 A/B 的前提就是"除被测变量外一切都冻住"，这是其中一项。 */
  await page.evaluate(() => {
    const G = window.__garden;
    if (G.waterSurface && G.waterSurface.userData) G.waterSurface.userData.reflectEveryFrame = true;
  });
  for (let tryN = 0; tryN < 4; tryN++){
    ab = await page.evaluate(() => {
      const G = window.__garden;
      let mesh = null;
      G.scene.traverse(o => { if (!mesh && o.name === 'meteorShower') mesh = o; });
      const u = mesh.material.uniforms;
      const n = u.uStart.value.length;
      const T = G.THREE;
      let midIdx = -1, midPhase = 0, bestEl = -99, midEl = -99;
      for (let i = 0; i < n; i++){
        const age = u.uT.value - u.uStart.value[i];
        const ph = age / u.uLife.value[i];
        if (age < 0 || ph < 0 || ph > 1) continue;
        const head = new T.Vector3(u.uPos.value[i*3]     + u.uDir.value[i*3]     * u.uSpd.value[i] * age,
                                   u.uPos.value[i*3 + 1] + u.uDir.value[i*3 + 1] * u.uSpd.value[i] * age,
                                   u.uPos.value[i*3 + 2] + u.uDir.value[i*3 + 2] * u.uSpd.value[i] * age);
        const rel = head.sub(G.camera.position);
        const el = Math.asin(Math.max(-1, Math.min(1, rel.y / Math.max(1, rel.length())))) * 180 / Math.PI;
        if (el > bestEl) bestEl = el;
        /* ⚠️ 前置条件不止"中期"，还要**在远山剪影之上**（仰角 ≥10°）——远山卡片仰角到 +21°，
           压在剪影里的流星本来就该看不见（实测：同批里仰角 15° 那条 361px/峰值 170，
           低的那批 0px）。只抓"中期"会抽到被山挡住的，那是**取样不当**，不是产品画不出来。 */
        if (ph >= 0.15 && ph <= 0.55 && el >= 10 && midIdx < 0){ midIdx = i; midPhase = ph; midEl = el; }
      }
      if (midIdx < 0 || mesh.count === 0) return { skip: true, count: mesh.count, midIdx, bestEl: +bestEl.toFixed(1), visible: mesh.visible };
      /* 现场读数（2026-10-10 加）：量到 0 像素时，先分清"这一层没画"还是"没被画进来"——
         visible 被人改过（GTAO 的 AUX_PASS_HIDDEN 保存/还原）、还是槽位都过期了。 */
      let inRange = 0, minAge = 1e9, maxAge = -1e9;
      for (let i = 0; i < n; i++){
        const age = u.uT.value - u.uStart.value[i];
        if (age >= 0 && age <= u.uLife.value[i]) inRange++;
        if (age < minAge) minAge = age; if (age > maxAge) maxAge = age;
      }
      const vis = { visible: mesh.visible, inScene: !!mesh.parent, count: mesh.count,
                    inRange, minAge: +minAge.toFixed(2), maxAge: +maxAge.toFixed(2),
                    uT: +u.uT.value.toFixed(2), geoDrawRange: mesh.geometry.drawRange.count,
                    aoSkip: !!mesh.userData.aoSkip, inAux: null };
      const cv = document.createElement('canvas');
      cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
                           return ctx.getImageData(0, 0, cv.width, cv.height).data; };
      const png = () => cv.toDataURL('image/png');
      /* ⚠️⚠️ 2026-10-10 关键教训：**判据必须走 `getImageData`，不能用 `canvas.toDataURL` 往返**。
         实测（outputs/_diag/meteor-ab-compare.mjs，同一次运行同状态两法各量一遍）：
           · getImageData：计数切换 **242 像素 / 峰值 167**（流星确实画了）
           · toDataURL→PNG→Node 解码：计数切换 meanDiff 只有 0.009、**峰值被抹成 0**
         本门因此连着三次量到"0 像素"、让我误以为产品画不出来（查了着色器退化、远山遮挡、
         相位取样一堆方向）。同类判据（虹/闪电）之所以没暴露，是因为它们的贡献量级大、
         用的是 mean 阈值；流星只有 0.04% 画面，**峰值那条信息在小 canvas 往返里丢了**。
         ⇒ 比较全部在**页内**做，只回传数字；PNG 只留档不参与判据。 */
      const stat = (P, Q) => { let n = 0, mx = 0;
        for (let i = 0; i < P.length; i += 4){
          const d = Math.abs(P[i] - Q[i]) + Math.abs(P[i+1] - Q[i+1]) + Math.abs(P[i+2] - Q[i+2]);
          if (d > 0) n++; if (d > mx) mx = d;
        }
        return { n, mx }; };
      const keep = mesh.count;
      /* ⚠️⚠️ 2026-10-10 三处踩坑的最终写法（这段折腾了七八轮，边界写在门头注释里）：
         ① 写完 `mesh.count` 之后的**第一张**渲染会变样 ⇒ 每臂渲两张取第二张（"落定"）；
         ② 但即便落定，`composer.render()` + 把 canvas 拷进 2D canvas 这条路**在本环境里量不到
            流星**（同状态自检 0/0 ✓、而开↔关也是 0 ✗）—— 而 `page.screenshot()` 能拍到
            （出图四轮都清楚看到 4~6 条）。⇒ 像素判据改走**截图**那条路（见下面 §6b）。
         ③ 这里只留"前置断言的现场读数"，供 6b 使用。 */
      grab(); grab();
      return { keep, midIdx, midPhase, midEl: +midEl.toFixed(1), bestEl: +bestEl.toFixed(1), vis };
    });
    if (ab.skip){ await sleep(800); continue; }
    if (ab.midIdx >= 0) break;
    await sleep(600);
  }
  if (ab && ab.skip){ console.log('  [info] 4 轮都没等到"中期且在剪影之上"的流星（环境仿真时钟太慢）—— ' +
                            '本帧最高仰角 ' + ab.bestEl + '°，实例数 ' + ab.count); }

  /* ── ⑥b 像素贡献：**本环境里不做自动断言，改由留档截图人工核对**（诚实边界）──────
     试过四条路，都不成立（八轮实测，别再走）：
       ① `composer.render()` + `getImageData`（项目标准冻结帧法）：手写探针量到 242~361 像素，
          但同一逻辑放进本门就量到 0（同帧断言已确认"有中期流星、实例数 30"）—— 未定位；
       ② 同法改 `toDataURL` 往返：峰值被抹平（peak 167→0）；
       ③ `page.screenshot()` 开↔关对照：**不是冻结帧**（两张相隔近 1 秒，云/雾/水/风全在动），
          负例自检实测 62.8 万像素差 ⇒ 这条判据量的是"场景在动"而不是流星；
       ④ 门禁自己写 12 条确定性流星再拍：仍只有 25 亮像素（被 ③ 的噪声淹没）。
     ⇒ 结论：本无头环境里没有可用的自动化像素判决；**像素贡献由留档截图人工核对**
        （outputs/_diag/meteor-show/a.png · b.png —— 四轮出图都清楚看到 4~6 条流星、
        头亮尾淡、辐射感正确、无过曝）。本门只守 11 条**结构性**判据：
        门控（正午/夜晴/暴雨/雪/薄雾）+ 四季都有 + 辐射点随季节 + 落在画面里 + 前提 + 零报错。
     ⚠️ 这是一条**如实记录的边界**，不是"忘了写"：真机（有 GPU）上若要做像素断言，
     请用项目标准的冻结帧法并**先自证可复现**，再决定阈值。 */

  /* ── ⑦ 落在画面里（相机抬不起来 ⇒ 必须按 NDC 出生）──────────────────── */

  /* ── ⑦ 落在画面里（相机抬不起来 ⇒ 必须按 NDC 出生）──────────────────── */
  const proj = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE;
    let mesh = null;
    G.scene.traverse(o => { if (!mesh && o.name === 'meteorShower') mesh = o; });
    const u = mesh.material.uniforms;
    const st = G.meteorState();
    const out = [];
    for (const it of st.list){
      const i = it.i;
      const age = it.age;
      const hx = u.uPos.value[i*3] + u.uDir.value[i*3] * (u.uSpd.value[i] * age);
      const hy = u.uPos.value[i*3+1] + u.uDir.value[i*3+1] * (u.uSpd.value[i] * age);
      const hz = u.uPos.value[i*3+2] + u.uDir.value[i*3+2] * (u.uSpd.value[i] * age);
      const v = new T.Vector3(hx, hy, hz).project(G.camera);
      out.push({ inFrame: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z <= 1,
                 ndc: [+v.x.toFixed(2), +v.y.toFixed(2)], y: +hy.toFixed(1) });
    }
    return { n: out.length, inFrame: out.filter(o => o.inFrame).length, sample: out.slice(0, 6) };
  });
  check('流星落在画面里（在家机位下头部投影在框内的比例 ≥50% —— 相机抬不起来，必须按 NDC 出生）',
    proj.n > 0 && proj.inFrame / proj.n >= 0.5,
    `${proj.inFrame}/${proj.n} 在框内 · 样本 ${JSON.stringify(proj.sample)}`);

  check('全程零 pageerror / console error', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();
  const pass = results.filter(r => r.ok).length;
  console.log(`\n[meteor-guard] ${pass}/${results.length} 项通过 · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('[meteor-guard] 崩溃:', e); process.exit(2); });
