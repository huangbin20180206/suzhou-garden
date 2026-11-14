// 雨后初晴 + 七色彩虹门禁：node probe/afterrain-guard.mjs
// @guards: src/02-scene.js, src/12-env.js, src/12a-presets.js, src/12b-sky.js, src/10-post.js
//
// 守老黄 2026-09-30 定的两个东西：
//   ① 新场景「雨后初晴」："雨刚停，瓦片/石板/树叶还在滴水，太阳出来了；地面和池塘
//      亮得反光，空气里飘着一层薄薄的水汽，草和树绿得发亮"
//   ② 该场景里"在池塘小桥或者云根位置加一道七色彩虹"
//
// 为什么这道门要有牙（三个曾经会静默失效的点）：
//   ① **rainbow 是新加的 uniform 通道**：缺键兜底写错（兜底成 1 而不是 0）会让
//      **每个天气都挂一道虹** —— 判据必须逐个天气量，不能只量"雨后初晴有没有"。
//   ② **虹心方向**：真实成因是太阳的反方向，判据要点积 ≈ −1；写成任意方向也"有虹"，
//      但物理是错的 ⇒ 这条必须有。
//   ③ **虹是否真的画出像素**：uniform 有值 ≠ 画面上有东西。判据用**冻结帧同任务 A/B**
//      （开虹 ↔ 关虹）量像素差，并配负例自检（同状态连渲两次必须逐位为 0）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
import { decodePNG, meanAbsDiff } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'afterrain-guard');
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
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.addStyleTag({ content: '#hud,#env,#caption,#loading{display:none !important}' });
  /* ⚠️⚠️ 等待必须等**过渡真的走完**（`ENV.t >= 1`），不能睡固定时长（2026-10-02 修，真假红）。
     天气过渡按**仿真时间**推进（`ENV.dur = 2.8s`），而仿真钟在慢帧/启动期**落后于墙钟**
     （dt 被固定步长夹住）⇒ 固定 4.2s 的睡眠会在过渡中途采样：实测 `ENV.cur.wetness`
     读到 **0.44**（夜间全量链里读到 0.30）而预设是 0.85 ⇒ 判据假红。
     这是本项目"探针改天气一律等 `ENV.t >= 1`"的既定做法（多条记忆都写着），本门一直漏了它。
     实测（outputs/_diag/wetness-traj.mjs）：空跑时过渡 2.8s 走完；门里 setEnv 连发三次 +
     紧接启动尾段的长帧 ⇒ 墙钟 4.2s 只走到一半。 */
  const settle = async () => {
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 30000 });
    await page.waitForTimeout(600);      // 余量：缓动收尾 + 环境贴图/替身挂载
  };
  /* 相机停稳（2026-10-12 补）：等**连续两次轮询的相机位姿完全一致**（OrbitControls 阻尼收敛）。
     ⚠️ 为什么必须有它：本门头部 65-71 行自己写着"不能睡固定时长"，但 §3/§4 一直在用
        `waitForTimeout(900)` 赌阻尼收尾 —— 相机没停稳就采样，覆盖率会随残余转动漂移，
        而 §4 的上限又贴着实测值 ⇒ 时红时绿（本轮的三种读数 52.38/52.79/49.19 横跨阈值）。 */
  const cameraStill = async () => {
    await page.evaluate(() => { delete window.__camSnap; });
    await page.waitForFunction(() => {
      const c = window.__garden.camera;
      const now = c.position.toArray().concat(c.quaternion.toArray());
      const prev = window.__camSnap;
      window.__camSnap = now;
      return !!prev && now.every((v, i) => Math.abs(v - prev[i]) < 1e-5);
    }, null, { timeout: 20000, polling: 80 }).catch(() => {});
  };
  const setEnv = (time, weather) => page.evaluate(({ time, weather }) => {
    const G = window.__garden;
    G.setEnv('season', 'summer'); G.setEnv('time', time); G.setEnv('weather', weather);
  }, { time, weather });
  /* 第九轮：虹改成世界空间大拱后**没有 uSunDir/uRainbowDir**（球面环的旋钮全作废），
     这里只读强度通道；旧写法读 uSunDir.value 会直接崩（判据滞后于产品）。 */
  const rbUniform = () => page.evaluate(() => {
    const G = window.__garden;
    const u = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                      && o.material.uniforms.uRainbow)?.material.uniforms;
    if (!u) return null;
    return { amount: +u.uRainbow.value.toFixed(3) };
  });

  /* ══ §1 场景本身的物理量 ══════════════════════════════════════════════ */
  await setEnv('dusk', 'afterrain'); await settle();
  const st = await page.evaluate(() => {
    const G = window.__garden;
    return { rain: +(G.ENV.cur.rainAmount || 0).toFixed(2), wet: +(G.ENV.cur.wetness || 0).toFixed(2),
             fog: +G.scene.fog.density.toFixed(4), sun: +(G.scene.children.find(c => c.isDirectionalLight && c.castShadow) || {}).intensity?.toFixed(3),
             sunPos: G.scene.children.find(c => c.isDirectionalLight && c.castShadow)?.position.toArray().map(v => +v.toFixed(1)),
             sat: +G.ENV.cur.grade.saturation.toFixed(2), exp: +G.renderer.toneMappingExposure.toFixed(2),
             wind: +(G.ENV.cur.windMul || 0).toFixed(2), cloud: +(G.ENV.cur.cloudAmount || 0).toFixed(2) };
  });
  check('雨后初晴：雨已停（rainAmount = 0）', st.rain === 0, `rain=${st.rain}`);
  check('雨后初晴：地面/瓦/叶是湿的（wetness ≥ 0.7 ⇒ 有反光）', st.wet >= 0.7, `wetness=${st.wet}`);
  check('雨后初晴：太阳出来了（直射 ≥ 晴天的 50%）',
    st.sun >= 0.78 * 0.5, `sun=${st.sun}（晴天基准 1.22，位置 ${JSON.stringify(st.sunPos)}）`);
  check('雨后初晴：有薄水汽但不是白茫茫（雾密度在薄雾的 1/3 ~ 1 之间）',
    st.fog > 0.006 && st.fog < 0.012, `雾 ${st.fog}（薄雾约 0.0104）`);
  check('雨后初晴："绿得发亮"（饱和 ≥ 晴天的 1.02 倍）', st.sat >= 1.02 * 1.00, `saturation=${st.sat}`);

  /* ══ §2 彩虹：只属于本场景 ═════════════════════════════════════════════ */
  for (const w of ['clear', 'storm', 'snow', 'mist']){
    await setEnv('dusk', w); await settle();
    const u = await rbUniform();
    check(`彩虹隔离：暮·${w} 虹强度 = 0`, u && u.amount === 0, `amount=${u && u.amount}`);
  }
  await setEnv('dusk', 'afterrain'); await settle();
  const rb = await rbUniform();
  check('彩虹：雨后初晴下虹强度 > 0', rb && rb.amount > 0.5, `amount=${rb && rb.amount}`);
  /* ⚠️⚠️ **判据随产品形态一起改**（2026-10-01 第三轮，老黄："雨后初晴为啥彩虹没了"）。
     这里原来守的是"虹心在太阳的反方向（点积 ≤ −0.85）" —— 那条守的是"虹的**方向**对不对"，
     **守不住"用户看不看得见"**：方位严格锁死太阳反方向时，实测
       dawn 默认机位 0 像素 / 「看彩虹」机位 0 像素
       noon 默认机位 0 像素 / 「看彩虹」机位 0 像素
     （虹环的两侧落在方位 ±90° 处，超出默认机位 ±35° 的水平视野 ⇒ 整条虹必然在画外）
     而那两道点积判据当时**全绿** —— 又一个"判据把产品当时的样子固化成标准"
     （同 09-28「判据只断下限会诱发调过头」、10-01「小鸟颜色判据在强制纯色鸟」）。
     ⇒ 现在直接量**默认机位能不能看到虹**，三个时段各量一次。
     下限 3000px（实测 17.7k~24.1k，余量 6~8 倍）只防"又整个看不见"；
     同时要求虹的横向范围**在画面内**（x0>0 且 x1<100）—— 防"虹缩到画面某个角"。
     ⚠️ 不再断"点积"：方位已明确改成固定的园子主视方位（见 12-env 的长注释），
        那是"要看得见"与"背对太阳才看得到"之间的取舍，判据不该再把物理约束钉死。 */
  for (const time of ['dawn', 'noon', 'dusk']){
    await setEnv(time, 'afterrain');
    await page.evaluate(() => { window.__garden.resetCamera && window.__garden.resetCamera(); });
    await settle();
    const vis = await page.evaluate(() => {
      const G = window.__garden;
      const sky = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                          && o.material.uniforms.uRainbow);
      const u = sky.material.uniforms;
      const cv = document.createElement('canvas');
      cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
      const ctx = cv.getContext('2d');
      const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
        return ctx.getImageData(0, 0, cv.width, cv.height); };
      const keep = u.uRainbow.value;
      grab();                                   // 预热一张（别让重编落在被测帧上）
      const A = grab();
      u.uRainbow.value = 0; grab(); const B = grab();
      u.uRainbow.value = keep;
      let hot = 0, x0 = 1e9, x1 = -1e9, peak = 0;
      for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++){
        const i = (y*A.width + x)*4;
        const d = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
        if (d > 12){ hot++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (d > peak) peak = d; }
      }
      return { hot, pct: +(hot/(A.width*A.height)*100).toFixed(2), peak,
               x0: +(x0/A.width*100).toFixed(1), x1: +(x1/A.width*100).toFixed(1) };
    });
    /* ⚠️⚠️ 2026-10-02 补"浓核强度"判据（老黄实拍"没有看到彩虹"后的定案）：
       原来这条只量"差分像素数"（>3000px、单像素差 >12/765）—— 旧版虹弱到 A/B
       平均差只有 1.1 灰阶时它照样全绿：**绿 ≠ 看得见**。peak（受影响像素里的
       最大三通道差）才是"浓核有多浓"：阈值 90（≈30 灰阶/通道）。
       ⚠️ 阈值按"独立虹层 + 山前挂虹 + 替换式"的第七轮实测定：
       浓核峰值实测 ~250~290/765，阈值 90 留 3 倍余量；
       上限由 §4 的"受影响天空 ≤50%"防糊满（收窄过渡带后浓核只占屏幕 1~2%）。
       ⚠️⚠️ 2026-10-02 第八轮下限同步（老黄实拍"彩虹太夸张"后降强度：饱和
       1.80→1.45、亮度 1.45→1.15、alpha 1.0→0.75、弧窗 45°→32°）：改后实测
       dawn/noon/dusk = 5959/2588/5918px、peak 110~121 —— noon 因 fade 项
       （越近太阳越淡，正午太阳高）天然最弱，2588px 是**新形态的正常值**而非
       "看不见"（peak 121 ≥ 90 证明浓核仍在）。3000 是按夸张版实测 17.7k~24.1k
       定的（余量 6~8 倍），降为 2000 防"整个看不见"，浓度硬线交给 peak。 */
    check(`雨后初晴·${time}：默认机位能看到彩虹（>2000px、浓核峰值差 ≥90、横跨画面中部）`,
      vis.hot > 2000 && vis.peak >= 90 && vis.x0 > 0 && vis.x1 < 100 && vis.x0 < 40 && vis.x1 > 60,
      `虹像素 ${vis.hot}（${vis.pct}%），峰值差 ${vis.peak}/765，横向 ${vis.x0}%~${vis.x1}%`);
  }
  /* 夜间没有太阳也就没有虹（按 uStarAmount 门控） */
  await setEnv('night', 'afterrain'); await settle();
  const rbNight = await rbUniform();
  check('彩虹：夜里自动消失（没有太阳就没有虹）', rbNight && rbNight.amount === 0, `amount=${rbNight && rbNight.amount}`);

  /* ══ §3 虹真的画进了像素（冻结帧同任务 A/B + 负例自检）═════════════════
     ⚠️ 第九轮（2026-10-02）：虹从"球面环"改成**世界空间大拱**（02-scene
     makeRainbowMesh，摆位按默认机位反解），几何不再有 uRainbowDir/uArcHalf ——
     本段机位从"退到虹心方向 26m"改成**默认机位微抬头**（拱就摆在默认机位
     前方 70m、垂直对着它）。旧写法读 uRainbowDir.value，在新几何上恒为
     undefined ⇒ 机位退化成 NaN、判据必假红（这类"判据滞后于产品"要连机位一起改）。 */
  await setEnv('dusk', 'afterrain'); await settle();
  await page.evaluate(() => {
    const G = window.__garden;
    G.resetCamera && G.resetCamera();
    /* 略微抬头一点，让拱顶落在画幅内（默认机位本身俯视 −19°，拱顶在画面 9% 处，
       已经在画内；这里只把 target 抬到拱的中段，防止后续微调机位时掉出画外）。 */
    G.controls.target.set(0, 8, -1);
    G.controls.update();
  });
  await page.waitForTimeout(900);
  const ab = await page.evaluate(() => {
    const G = window.__garden;
    const u = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                      && o.material.uniforms.uRainbow).material.uniforms;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const shot = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return cv.toDataURL('image/png'); };
    const keep = u.uRainbow.value;
    u.uRainbow.value = keep; const on1 = shot();
    u.uRainbow.value = 0;    const off = shot();
    u.uRainbow.value = keep; const on2 = shot();
    u.uRainbow.value = keep; const on3 = shot();      // 负例自检：同状态连渲两次
    return { on1, off, on2, on3 };
  });
  const D = u => decodePNG(Buffer.from(u.split(',')[1], 'base64'));
  const dSelf = meanAbsDiff(D(ab.on1), D(ab.on2));
  const dRainbow = meanAbsDiff(D(ab.on1), D(ab.off));
  fs.writeFileSync(path.join(OUT, 'rainbow-on.png'), Buffer.from(ab.on1.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'rainbow-off.png'), Buffer.from(ab.off.split(',')[1], 'base64'));
  /* 并排对照图（给人眼/多模态验收用） */
  {
    const a = D(ab.on1), b = D(ab.off), w = a.w, h = a.h, GAP = 8;
    const merged = Buffer.alloc((w * 2 + GAP) * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      for (const [src, off2] of [[a, 0], [b, w + GAP]]){
        const si = (y * w + x) * src.bpp, di = (y * (w * 2 + GAP) + x + off2) * 4;
        merged[di] = src.data[si]; merged[di+1] = src.data[si+1]; merged[di+2] = src.data[si+2]; merged[di+3] = 255;
      }
    }
    /* 拼图在**页内**做（Node 侧没有 document） */
    const png = await page.evaluate(({ data, w2, h2 }) => {
      const c = document.createElement('canvas');
      c.width = w2; c.height = h2;
      const g = c.getContext('2d');
      const im = g.createImageData(w2, h2);
      im.data.set(new Uint8ClampedArray(data));
      g.putImageData(im, 0, 0);
      return c.toDataURL('image/png');
    }, { data: Array.from(merged), w2: w * 2 + GAP, h2: h });
    fs.writeFileSync(path.join(OUT, 'pair-rainbow-on-vs-off.png'), Buffer.from(png.split(',')[1], 'base64'));
  }
  check('自检：同状态连渲两次画面不变（不是量的场景漂移）', dSelf < 0.01, `同状态差 ${dSelf.toFixed(4)}`);
  /* ⚠️⚠️ 2026-10-30：加**上下文健康前置**。全量链跑到第 66 道时这道门偶发失败，
     读数是「开虹 ↔ 关虹 全幅平均差 **0.000**」—— 两次 `composer.render()` 输出完全一样。
     那不是虹没画，而是 **WebGL 上下文已经丢了**（引擎 2026-10-30 才补上丢失处理，
     而丢失期间所有 GL 调用静默失败、画布停在最后一帧 ⇒ 冻结核对自然差 0）。
     判据本身没错，但它需要一个前提：**这个上下文还活着**。
     现在先断言前提，不成立就明说"环境不可用"，而不是让它伪装成"虹没画出来"。
     （这与本项目的铁律 4「判据先取权威源」一致：必须先证明测量工具还在工作。） */
  const ctxAlive = await page.evaluate(() => {
    const gl = window.__garden.renderer.getContext();
    return !gl.isContextLost();
  });
  if (!ctxAlive){
    console.log('  · §3 虹像素判据**跳过**：WebGL 上下文已丢失（长链跑完几十道门后常见），' +
                '本环境量不了像素判据 —— 不是虹没画，是画不出任何东西。');
  } else {
  check('虹真的画进了像素（开虹 ↔ 关虹 冻结帧差 > 0.3）', dRainbow > 0.3, `全幅平均差 ${dRainbow.toFixed(3)}`);
  /* ── 本节口径重写（2026-10-12）────────────────────────────────────────────
     老黄要的是"一道彩虹"，不是"整片彩霞"，所以上限必须留；但**旧口径与旧上限都已失效**：
     ① **旧度量量到了 bloom 晕圈，不是虹**：统计区是"左 55% 列的**整幅画面**"、阈值
        ΣΔ>8（≈2.7 灰阶/通道）—— 这个阈值正好落在后处理 bloom 的多 mip 晕圈量级里。
        用门禁自存的 `outputs/_diag/afterrain-guard/rainbow-on|off.png` 离线复算（2026-10-12）：
        旧口径 49.19%，受影响 22.7 万 px 里 **Δ≤45 占 78%**（Δ>45 仅 10.6%、Δ>90 仅 4.7%），
        **646/700 行**都有受影响像素（连 y=90% 的池面都算）⇒ 量的是"整幅被淡淡提亮"。
     ② **旧上限 50% 的标定值 1.79% 属 2026-10-01 球面环时代**；产品作者自存的扫描
        （`02-scene.js:518`）显示 uBright=2.10 时已是 42.4%（余量仅 7.6 点），而
        2026-10-11 的「彩虹抬高 3 米」（提交 004d214，带芯 5609→23637px，4.2×）把余量吃光
        ⇒ 52.38% 报红。**这不是虹糊了，是判据的口径和标定都过期了。**
     ── 新口径 ──
       **统计区**：画面上 **40% 行**（天空+远山带）× 全宽。下界由**行均值 luma 剖面**定
         （用关虹帧算）：y=40% 处 154.9 → y=45% 处 127.1，园林实体（屋面/树/水）从 40% 起
         ⇒ "真天空"到 40% 为止，不再把池面与地面算进"天空像素"。
       **阈值**：ΣΔ>45（≈15/765，明显可见级），把 bloom 的淡晕排除在"受影响"之外。
       **标定（本机位，用上述自存帧复算，2026-10-12）**：
         正常 b=2.10 → **21.9%**；b=3.20（"糊满整片天"那一档）线性下界 **32.1%**。
         （旧口径 2.10→3.20 实测 42.4→71.6 = 1.69× > 亮度比 1.524× ⇒ bloom 非线性让真实
          违规值**高于**这个下界，牙口实际更足。）
       **上限 28%**：对正常 1.28× 余量、对违规预测 ≥1.15× 牙口。牙口不靠这个预测 ——
         下面有一条**实测**负例自检（现场把 uBright 拨到 3.20 再量一次）。
       **下限 0.8% 不变**：仍只用来防"完全画不出来"（与 09-28"判据要与产品形态同步"同一条）。 */
  const SKY_ROW_FRAC = 0.40, SKY_THR = 45, SKY_CAP = 28, SKY_MIN = 0.8;
  /* 单次"开虹 ↔ 关虹"冻结帧差分，返回**可见受影响天空像素占比**（见上方口径说明）。
     `bright` 非 null 时临时把 uBright 拨到该值（负例自检用）—— uBright 是静态 uniform，
     只有 02-scene 定义它、没有任何每帧代码回写（12-env 只写 uRainbow），所以拨得住；
     量完立刻还原。 */
  const skyCover = (bright) => page.evaluate(({ rowFrac, thr, bright }) => {
    const G = window.__garden;
    const u = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                      && o.material.uniforms.uRainbow).material.uniforms;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const shot = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, cv.width, cv.height).data; };
    const keepRu = u.uRainbow.value;
    const keepB = (bright != null && u.uBright) ? u.uBright.value : null;
    if (keepB != null) u.uBright.value = bright;
    u.uRainbow.value = keepRu; const on = shot();
    u.uRainbow.value = 0;      const off = shot();
    u.uRainbow.value = keepRu;
    if (keepB != null) u.uBright.value = keepB;
    const rows = Math.max(1, Math.round(cv.height * rowFrac));
    let changed = 0, total = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cv.width; x++){
      const i = (y * cv.width + x) * 4; total++;
      if (Math.abs(on[i] - off[i]) + Math.abs(on[i+1] - off[i+1]) + Math.abs(on[i+2] - off[i+2]) > thr) changed++;
    }
    return +(changed / total * 100).toFixed(2);
  }, { rowFrac: SKY_ROW_FRAC, thr: SKY_THR, bright: bright == null ? null : bright });

  /* ⚠️ 下面这三条判据**同属一个前置**：它们都读 `ctxAlive` 块里量到的 skyA / skyB。
     2026-10-30 踩过一次：加 `ctxAlive` 保护时只把前两条圈进了 else，
     §4 自检留在外面 ⇒ 上下文一挂就 `ReferenceError: skyA is not defined`（整个探针崩掉，
     比报红更糟 —— 报红还能看见读数，崩溃只剩一行栈）。三条一起圈。 */
  await settle();          // 环境过渡走完（本门既有 helper）
  await cameraStill();     // 相机阻尼走完：旧版直接沿用 §3 的固定 900ms 睡眠就采样
  const skyA = await skyCover(null);
  const skyB = await skyCover(null);
  check('虹是"一道"而不是"一片"（可见受影响天空像素 0.8%~28%，别糊满整片天）',
    skyA > SKY_MIN && skyA < SKY_CAP && skyB > SKY_MIN && skyB < SKY_CAP,
    `可见受影响天空像素 ${skyA}% / ${skyB}%（新口径 ΣΔ>${SKY_THR} × 上 ${SKY_ROW_FRAC * 100}% 行；` +
    `2026-10-12 标定：正常 21.9%、b3.20 下界 32.1%；旧口径 1.79%→52.38%）`);
  check('§4 抖动自检：同状态连测两次的覆盖率差 ≤2 点（旧版贴阈值随机红绿的直接原因）',
    Math.abs(skyA - skyB) <= 2.0, `${skyA}% vs ${skyB}%（差 ${Math.abs(skyA - skyB).toFixed(2)} 点，上限 2）`);
  /* 负例自检（**实测**，不是我的预测）：把 uBright 拨到 3.20 —— 产品作者记的"糊满整片天"
     那一档（旧口径 71.6%，见 02-scene.js:519）—— 新口径必须照样报红。 */
  const skyBad = await skyCover(3.20);
  check('负例自检：uBright=3.20（糊满整片天那档）在新口径下必须报红',
    skyBad >= SKY_CAP, `b=3.20 实测 ${skyBad}% ≥ 上限 ${SKY_CAP}%？（预测下界 32.1%）`);
  }   // ← 结束 ctxAlive 的块（三条像素判据共用同一前置）
  /* ⚠️⚠️ 第九轮新增"拱形落位"三条（老黄："弧度太低了，角度不对，做得弧度再大一些，高一些"）。
     这三条把"弧度"变成**可量化、可回归**的东西：球面环方案里矢高被几何锁死在 4~6°
     （屏幕占比 <10%），改成世界空间大拱后实测跨度 90.7%、矢高 34%、拱顶 9%。
     阈值都留了余量：跨度 ≥70%（实测 90.7%）、矢高 ≥18%（实测 34%）、
     拱顶落在画面 3%~25%（实测 9%，太贴 0 就是"又贴顶了"的老坑）。 */
  const arch = await page.evaluate(() => {
    const G = window.__garden;
    const mesh = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                        && o.material.uniforms.uRainbow && o.geometry.attributes.aT);
    if (!mesh) return null;
    const u = mesh.material.uniforms;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, cv.width, cv.height); };
    grab();
    const A = grab();
    const keep = u.uRainbow.value;
    u.uRainbow.value = 0; const B = grab();
    u.uRainbow.value = keep;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, yc = 1e9;
    for (let y = 0; y < A.height; y++) for (let x = 0; x < A.width; x++){
      const i = (y * A.width + x) * 4;
      const d = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
      if (d > 12){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      /* 虹带"芯"的 bbox 顶：阈值 90（≈30 灰阶/通道）。低阈值那条 bbox 会被
         **后处理 bloom 的晕圈**撑到画面上沿，把"拱顶位置"读成 0%（b=2.1 实测），
         而拱顶其实还在 9%。拱顶位置必须读带芯，不是晕圈 —— 否则这条判据会在
         "虹变亮"时假红，又会反过来逼着把亮度压回去（那正是黑边的来源）。 */
      if (d > 90 && y < yc) yc = y;
    }
    if (x1 < x0) return null;
    return {
      spanX: +((x1 - x0) / cv.width * 100).toFixed(1),
      topY: +(y0 / cv.height * 100).toFixed(1),
      coreTopY: +(yc / cv.height * 100).toFixed(1),
      rise: +((y1 - y0) / cv.height * 100).toFixed(1),
    };
  });
  check('彩虹是**大拱**：横向跨度 45%~72% 画面宽（老黄十二次实拍"做得窄一些"）',
    arch && arch.spanX >= 45 && arch.spanX <= 72, `跨度 ${arch ? arch.spanX : '?'}%（本轮实测 48~55%；第七轮宽版 90.7% 被判"太宽"）`);
  /* ⚠️⚠️ 第十三轮新增"黑边"判据（老黄连续三轮实拍"彩虹的背景黑边"）——
     量化口径：**开虹后比关虹暗 18 灰阶以上**的像素数 = 虹把底图压暗的部分
     （蓝紫段 luma 低于灰山/亮天空时按 alpha 混入 ⇒ 沿虹缘读成黑边）。
     ⚠️⚠️ 第十四轮修正：原来这条**只在 §3 的 dusk 状态量一次**，而黑边恰恰只在
     **正午**出现 —— 晨暮背景是暖色/暗色，量出来恒为 0。于是 HEAD 上这条全绿
     （暗像素 0）、老黄实拍却连着几轮报彩虹黑边没改掉：判据在测一个**不会出问题
     的状态**。⇒ 改成 dawn/noon/dusk 三档各量一次，并用**默认机位**（老黄看的那个）。
     实测：改前 b=1.9 正午 ~3900（压线过 4000 上限，肉眼就是黑边）；改后 b=2.1 为 0。
     ⚠️ 上限同时收紧到 **800**（旧值 4000）：实测 b=1.9 正午 3000~3900 —— 旧上限
     正好放它过去，所以判据"全绿"而老黄一直在报黑边。b=2.1 实测 0，余量足。
     （旧记录：改前 1.9~2.5 万；亮度 1.35 时正午 12908。） */
  for (const darkTime of ['dawn', 'noon', 'dusk']){
    await setEnv(darkTime, 'afterrain'); await settle();
    await page.evaluate(() => { const G = window.__garden;
      G.resetCamera && G.resetCamera(); });
    await page.waitForTimeout(600);
    const dark = await page.evaluate(() => {
      const G = window.__garden;
      const mesh = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                          && o.material.uniforms.uRainbow && o.geometry.attributes.aT);
      if (!mesh) return -1;
      const u = mesh.material.uniforms;
      const cv = document.createElement('canvas');
      cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
        return ctx.getImageData(0, 0, cv.width, cv.height); };
      grab();
      const A = grab();
      const keep = u.uRainbow.value; u.uRainbow.value = 0;
      const B = grab(); u.uRainbow.value = keep;
      let n = 0;
      for (let i = 0; i < A.data.length; i += 4){
        const la = (A.data[i] + A.data[i+1] + A.data[i+2]) / 3;
        const lb = (B.data[i] + B.data[i+1] + B.data[i+2]) / 3;
        if (la < lb - 18) n++;
      }
      return n;
    });
    check('彩虹没有"黑边"（开虹后压暗底图 ≥18 灰阶的像素 < 800）',
      dark >= 0 && dark < 800, `暗像素 ${dark}（改前 b=1.9 正午 3000~3900：旧上限 4000 正好放它过，肉眼就是黑边；改后为 0）· ${darkTime}`);
  }
  /* 收尾：把机位恢复成 §3 那样（后面只剩"零 pageerror"一条，不再读画面） */
  await page.evaluate(() => { const G = window.__garden;
    G.controls.target.set(0, 8, -1); G.controls.update(); });
  check('彩虹**弓得起来**：矢高 ≥18% 画面高（球面环方案几何上限只有 4~6%）',
    arch && arch.rise >= 18, `矢高 ${arch ? arch.rise : '?'}%（实测 34%）`);
  check('彩虹拱顶在画面上部 3%~25%（更高但没贴顶）',
    arch && arch.coreTopY >= 3 && arch.coreTopY <= 25,
    `拱顶 y=${arch ? arch.coreTopY : '?'}%（低阈值 bbox 顶=${arch ? arch.topY : '?'}%，含 bloom 晕圈；贴顶=0% 是旧坑）`);

  /* ══ §5 「看彩虹」机位（2026-10-06 重挑）════════════════════════════════
     这是一个**名字承诺了体验**的机位（面板「看彩虹」按钮 → 暮色·雨后初晴 → 飞过去），
     所以它必须真的看得到虹。守两条：
       ① **站位在拱的圈外、离拱带足够远** —— 旧机位 pos(2,2.4,12) 站在 r=68m 拱带的
          **圈内**（拱平面内半径 57m < 内缘 65.4m）、离带只有 **42.9m** ⇒ 5.2m 宽的带子
          铺满画面上半（实测覆盖 15% 画面、峰值 589/765、贴边被切 3361px），亮度越过
          后处理 bloom 阈值 ⇒ **整幅糊成灰白**，出图判读"天空均匀灰白、没有彩虹"。
       ② **判据有牙** —— 同一套判据对**旧机位**必须报红（负例自检；防两条都松到恒绿）。
     口径同 §3：冻结帧同任务 开虹↔关虹（阈值 45）。
     实测（本机默认档，2026-10-06 定值）：新机位 离带 65m / 覆盖 3.4% / 峰值 ~248 / 贴边 0；
     旧机位 离带 42.9m / 覆盖 ~15% / 峰值 ~589 / 贴边数千 ⇒ 三条判据各差 2~5 倍，留了余量。 */
  await setEnv('dusk', 'afterrain'); await settle();
  const vpProbe = (which) => page.evaluate((which) => {
    const G = window.__garden;
    const v = (G.VIEWPOINTS || []).find(x => x.id === 'rainbow');
    const rb = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                      && o.material.uniforms.uRainbow && o.geometry.attributes.aT);
    if (!v || !rb) return { missing: true };
    /* 旧机位（2026-10-01 口径）—— 只用于负例自检 */
    const P = which === 'old' ? { pos: [2, 2.4, 12], tgt: [21.44, 0.2, -20.36] }
                              : { pos: v.pos.toArray(), tgt: v.target.toArray() };
    const pa = rb.geometry.attributes.position;
    let dmin = 1e9;
    for (let i = 0; i < pa.count; i++)
      dmin = Math.min(dmin, Math.hypot(P.pos[0] - pa.getX(i), P.pos[1] - pa.getY(i), P.pos[2] - pa.getZ(i)));
    G.camera.position.set(P.pos[0], P.pos[1], P.pos[2]);
    G.controls.target.set(P.tgt[0], P.tgt[1], P.tgt[2]);
    G.controls.update();
    const cam = G.camera.position.toArray().map(n => +n.toFixed(2));
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const W = cv.width, H = cv.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, W, H); };
    grab(); grab();                       // 预热两张：别让重编落在被测帧上
    const A = grab();
    const u = rb.material.uniforms, keep = u.uRainbow.value;
    u.uRainbow.value = 0; const B = grab(); u.uRainbow.value = keep;
    let ink = 0, peak = 0, x0 = 1e9, x1 = -1e9, clip = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const i = (y * W + x) * 4;
      const d = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
      if (d > peak) peak = d;
      if (d > 45){ ink++; if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (x < W*0.01 || x > W*0.99 || y < H*0.01 || y > H*0.99) clip++; }
    }
    return { cam, dmin: +dmin.toFixed(1), cov: +(ink / (W * H) * 100).toFixed(2), peak, clip,
             x0: +(x0 / W * 100).toFixed(1), x1: +(x1 / W * 100).toFixed(1) };
  }, which);
  /* 判据集合（新机位要全过、旧机位至少要失手一条） */
  const vpOK = v => !v.missing && v.dmin >= 55 && v.cov >= 1 && v.cov <= 8
                 && v.peak >= 90 && v.peak <= 400 && v.clip === 0 && v.x0 < 40 && v.x1 > 60;
  const vpNew = await vpProbe('new');
  const vpOld = await vpProbe('old');
  check('看彩虹机位：站在拱的圈外（离拱带 ≥55m —— 站进去就会被 5.2m 宽的带糊满整幅）',
    !vpNew.missing && vpNew.dmin >= 55, `离拱带 ${vpNew.dmin}m（旧机位 42.9m）· 相机 ${JSON.stringify(vpNew.cam)}`);
  check('看彩虹机位：拱完整在画内且不过曝（覆盖 1%~8%、峰值 90~400、贴边 0px）',
    vpOK(vpNew), `覆盖 ${vpNew.cov}%、峰值 ${vpNew.peak}/765、贴边 ${vpNew.clip}px、横向 ${vpNew.x0}%~${vpNew.x1}%`);
  check('负例自检：同一套判据必须把**旧机位**判红（否则本门没有牙）', !vpOK(vpOld),
    `旧机位 覆盖 ${vpOld.cov}%、峰值 ${vpOld.peak}、贴边 ${vpOld.clip}px、离拱带 ${vpOld.dmin}m`);

  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[afterrain-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张：${OUT}（含 开虹/关虹 并排对照）`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[afterrain-guard] 崩溃:', e); process.exit(2); });
