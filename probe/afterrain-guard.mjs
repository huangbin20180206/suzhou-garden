// 雨后初晴 + 七色彩虹门禁：node probe/afterrain-guard.mjs
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
  const setEnv = (time, weather) => page.evaluate(({ time, weather }) => {
    const G = window.__garden;
    G.setEnv('season', 'summer'); G.setEnv('time', time); G.setEnv('weather', weather);
  }, { time, weather });
  const rbUniform = () => page.evaluate(() => {
    const G = window.__garden;
    const u = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                      && o.material.uniforms.uRainbow)?.material.uniforms;
    if (!u) return null;
    return { amount: +u.uRainbow.value.toFixed(3),
             sunDir: u.uSunDir.value.clone(),
             rbDir: u.uRainbowDir.value.clone(),
             dot: +u.uSunDir.value.dot(u.uRainbowDir.value).toFixed(4) };
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
       上限由 §4 的"受影响天空 ≤50%"防糊满（收窄过渡带后浓核只占屏幕 1~2%）。 */
    check(`雨后初晴·${time}：默认机位能看到彩虹（>3000px、浓核峰值差 ≥90、横跨画面中部）`,
      vis.hot > 3000 && vis.peak >= 90 && vis.x0 > 0 && vis.x1 < 100 && vis.x0 < 40 && vis.x1 > 60,
      `虹像素 ${vis.hot}（${vis.pct}%），峰值差 ${vis.peak}/765，横向 ${vis.x0}%~${vis.x1}%`);
  }
  /* 夜间没有太阳也就没有虹（按 uStarAmount 门控） */
  await setEnv('night', 'afterrain'); await settle();
  const rbNight = await rbUniform();
  check('彩虹：夜里自动消失（没有太阳就没有虹）', rbNight && rbNight.amount === 0, `amount=${rbNight && rbNight.amount}`);

  /* ══ §3 虹真的画进了像素（冻结帧同任务 A/B + 负例自检）═════════════════
     ⚠️ 机位必须**背对太阳、朝虹心看**（虹心 = 太阳反方向）：暮时太阳在西（-x），
        虹就在东（+x）⇒ 相机朝 +x 看。我第一版把机位设在东北、结果整片虹在画外，
        判据报了 0.000 差 —— 那是**机位选错**，不是产品没画（另一个机位的截图里
        七色分明）。这类"判据红但产品对"的排查，别急着改产品，先换机位复测。 */
  await setEnv('dusk', 'afterrain'); await settle();
  await page.evaluate(() => {
    const G = window.__garden;
    /* 从虹心方向（-uSunDir）水平分量所指的一侧看过去，视线略微上抬取虹弧 */
    const u = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                      && o.material.uniforms.uRainbow).material.uniforms;
    const d = u.uRainbowDir.value;
    const cx = G.camera.position.x, cz = G.camera.position.z;
    const len = Math.hypot(d.x, d.z) || 1;
    const k = 26 / len;                                   // 退到虹心方向 26m 处
    G.camera.position.set(cx + d.x * k, 3.0, cz + d.z * k);
    G.controls.target.set(cx + d.x * (k + 20), 16.0, cz + d.z * (k + 20));
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
  check('虹真的画进了像素（开虹 ↔ 关虹 冻结帧差 > 0.3）', dRainbow > 0.3, `全幅平均差 ${dRainbow.toFixed(3)}`);
  /* ⚠️ 上一条只断"有"，结果我调过头：把带宽放到 10°、强度 0.78 时 **81% 的天空像素**
     都被染成乳白（单像素最大差 218），画面像蒙了层雾、虹只剩一道淡边 ——
     用户要的是"一道彩虹"，不是"整片彩霞"。所以必须再断一条**上限**。
     ⚠️ 门槛按**本门自己的机位**标定（相机抬到 y=3、视高 16m，弧带多落在画面两侧边缘、
        中间天空不算）：实测收窄后 6.5%；而"用户平视池边"那台机位上是 28%。
        同一个产品两台机位两个数 —— 所以下限只用来防"完全画不出来"（≈0），
        上限用来防"糊满整片天"（>50%），中间的量级交给人眼判读。
     ⚠️ **下限 3% → 0.8%**（2026-10-01）：彩虹从"整圈"改成"一段弧"（老黄："做得小一些，
        不是所有彩虹都很大"），本机位实测覆盖率随之从 6.5% 降到 1.79%。
        下限继续按旧值报红就是在**罚用户明确要的效果** —— 与 09-28 那条
        "判据只断下限/上限要与产品形态同步"是同一条。0.8% 仍远高于"画不出来"（≈0），
        上限 50% 不动（那道才是防"糊满整片天"的）。 */
  const skyShare = await page.evaluate(async () => {
    const G = window.__garden;
    const u = G.scene.children.find(o => o.isMesh && o.material && o.material.uniforms
                                      && o.material.uniforms.uRainbow).material.uniforms;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const shot = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, cv.width, cv.height).data; };
    const keep = u.uRainbow.value;
    u.uRainbow.value = keep; const on = shot();
    u.uRainbow.value = 0;    const off = shot();
    u.uRainbow.value = keep;
    let changed = 0, total = 0;
    for (let i = 0, n = 0; i < on.length; i += 4, n++){
      /* 只统计**天空上半部**（每行的前 55% 宽度） */
      if (n % cv.width >= cv.width * 0.55) continue;
      if (Math.abs(on[i] - off[i]) + Math.abs(on[i+1] - off[i+1]) + Math.abs(on[i+2] - off[i+2]) > 8) changed++;
      total++;
    }
    return +(changed / total * 100).toFixed(2);
  });
  check('虹是"一道"而不是"一片"（受影响天空像素 0.8%~50%，别糊满整片天）',
    skyShare > 0.8 && skyShare < 50, `受影响天空像素 ${skyShare}%（本机位实测 1.79%；改前整圈那次 6.5%；糊满整片天那次 81%）`);

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
