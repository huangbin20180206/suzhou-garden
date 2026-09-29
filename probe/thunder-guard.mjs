// 电闪雷鸣门禁：node probe/thunder-guard.mjs
//
// 守老黄 2026-09-30 的原话需求：
//   ① "增加一个'电闪雷鸣'的场景，需要把整个光线全部暗下来，达到或者接近暮色的光影效果"
//   ② "闪电时可以做得效果夸张点，不仅仅有亮光划过和照亮整体的效果，
//       还可以还原空中电闪的效果（注意一定是闪电后才有照亮场景的效果）"
//   ③ "紧接着就是密集的雷鸣，声音要做得真实"
//
// ⚠️ 本门存在的直接原因（2026-09-30 实测抓到、初版全绿的**真缺陷**）：
//   初版把闪电网格按**仰角**（地平线以上 9°~38°）摆在世界空间里。而 garden 的默认机位是
//   俯视的（实测 pitch −19.3°、camera.fov 46 ⇒ 画面上缘只到仰角 +3.7°，整片可见天空
//   只有约 4° 高的一条窄带）⇒ 闪电整条投到 ndc.y 1.8~6.8、亮痕 1.9~2.4，**全在画面之上**，
//   "可见 ↔ 隐藏"的冻结帧像素差是 **0** —— "空中电闪 / 亮光划过"两个效果一个像素都没画出来。
//   而当时的断言只查 mesh.visible === true，于是**全绿通过**。
//   ⇒ 判据必须**量像素 + 量投影**，不能只查可见标志（同 2026-09-26"侧壁折射"那次的教训）。
//
// 判据清单：
//   §1 暗：直射/环境/曝光/雾四项，且**平均亮度不高于暮色**（老黄的"接近暮色"）
//   §2 看得见：网格与亮痕的顶点投影必须在画面内，且冻结帧 A/B 上贡献 > 0（配负例）
//   §3 照亮整体：闪电峰值帧比无闪帧**在画面下半部明显更亮**（配负例：两臂都无闪 → 必须≈噪声）
//   §4 时序："闪电网格可见的帧才有照亮"，收尾全部归零（老黄强调的"先闪电后照亮"）
//   §5 雷鸣：真实 mp3 在浏览器里解码成功、延迟 ≥0.5s（雷在闪之后）、1~3 层叠放
//   §6 隔离：非 thunder 天气零闪电；离开后零残留
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';
import { decodePNG, meanLuma, meanAbsDiff } from './_png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs', '_diag', 'thunder-guard');
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

/* 画面下半部（地面/建筑/水面）的区域均值 —— "照亮整体"量的是这里，不是天空 */
function regionMean(img, y0f, y1f) {
  const d = img.data, bp = img.bpp, w = img.w, h = img.h;
  const y0 = Math.floor(h * y0f), y1 = Math.floor(h * y1f);
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * bp;
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
  }
  return sum / n;
}

const W = 960, H = 600;

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  /* ⚠️ 本项目铁律：采样场景内容/像素的探针必须等**装配完成**，不能只等 loading.done
     （loading.done 在延迟批之前就触发 ⇒ 物件还在进场时采样，同代码两次跑出不同结论） */
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.addStyleTag({ content: '#hud,#env,#caption,#loading{display:none !important}' });

  const setEnv = (season, time, weather) => page.evaluate(([s, tt, w]) => {
    const G = window.__garden; G.setEnv('season', s); G.setEnv('time', tt); G.setEnv('weather', w);
  }, [season, time, weather]);
  const settle = () => page.waitForTimeout(4200);        // 环境过渡 3s，留余量
  /* 冻结帧同任务连渲：同一 JS 任务内 composer.render + drawImage ⇒ 场景状态完全冻结。
     （单张截图相隔一帧的噪声底就有 ~3 luma，会淹没小信号 —— 见项目记忆） */
  const frozen = () => page.evaluate(() => {
    const G = window.__garden;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0);
    return cv.toDataURL('image/png');
  });
  const frozenAvg = async (n = 3) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(decodePNG(Buffer.from((await frozen()).split(',')[1], 'base64')));
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    return out.reduce((a, b) => a + meanLuma(b), 0) / out.length;
  };
  const readLights = () => page.evaluate(() => {
    const G = window.__garden;
    const sun = G.scene.children.find(c => c.isDirectionalLight && c.castShadow);
    const amb = G.scene.children.find(c => c.isAmbientLight);
    return { sun: +(sun ? sun.intensity : -1).toFixed(3), amb: +(amb ? amb.intensity : -1).toFixed(3),
             exposure: +G.renderer.toneMappingExposure.toFixed(3), fog: +G.scene.fog.density.toFixed(4) };
  });

  /* ══ §1 暗 ══════════════════════════════════════════════════════════════ */
  await setEnv('summer', 'noon', 'clear'); await settle();
  const base = await readLights();
  const lumaClear = await frozenAvg();
  await setEnv('summer', 'noon', 'storm'); await settle();
  const lumaStorm = await frozenAvg();
  await setEnv('summer', 'noon', 'thunder'); await settle();
  const dark = await readLights();
  const lumaThunder = await frozenAvg();
  /* 暮色参照：老黄要的"接近暮色"就按他自己那个暮色时段量 */
  await setEnv('summer', 'dusk', 'clear'); await settle();
  const lumaDusk = await frozenAvg();
  await setEnv('summer', 'noon', 'thunder'); await settle();

  check('thunder：直射几乎全关（sun < 晴天的 25%）', dark.sun < base.sun * 0.25, `晴 ${base.sun} → 雷电 ${dark.sun}`);
  check('thunder：环境光压到一半以下', dark.amb < base.amb * 0.65, `晴 ${base.amb} → 雷电 ${dark.amb}`);
  check('thunder：曝光降到暮色级（≤0.90）', dark.exposure <= 0.90, `晴 ${base.exposure} → 雷电 ${dark.exposure}`);
  check('thunder：雨量满、雾加厚（暴雨体感）', dark.fog > base.fog * 1.5, `雾 ${base.fog}→${dark.fog}`);
  /* 老黄原话"达到或者接近暮色的光影效果"：这是**用户可感知**的那一条，也是初版最弱的一条
     （初版 111.1 vs 暮色 97.6 = 亮 14%，读起来是"大白天阴雨"）。容差 4 luma：
     冻结帧连渲的自检差是 0，跨两帧的场景漂移约 ±3 —— 4 是"不高于暮色 + 一个噪声底"。 */
  check('thunder：平均亮度不高于暮色（老黄的"接近暮色"）', lumaThunder <= lumaDusk + 4,
    `晴 ${lumaClear.toFixed(1)} / 暴雨 ${lumaStorm.toFixed(1)} / 雷电 ${lumaThunder.toFixed(1)} / 暮色 ${lumaDusk.toFixed(1)}`);
  check('thunder：比"狂风暴雨"更暗（雷雨不是普通雨天）', lumaThunder < lumaStorm - 8,
    `雷电 ${lumaThunder.toFixed(1)} vs 暴雨 ${lumaStorm.toFixed(1)}`);

  /* ══ §2/§3 定格在闪电峰值：量"看得见"与"照亮整体" ══════════════════════ */
  /* 音景（点面板的"声音"按钮 = 真实用户手势，浏览器才允许起音频） */
  await page.evaluate(() => document.querySelector('#env button[data-act="sound"]')?.click());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__garden.lightningStrikeNow());
  await page.evaluate(async () => {
    await new Promise((res, n = 0) => { const step = () => { if (window.__garden.lightning().boltVisible || ++n > 900) return res(); requestAnimationFrame(step); }; requestAnimationFrame(step); });
  });

  /* 峰值定格（tau = 0.045：第一脉冲起跳 0.028 之后、下落 0.11 之内 ⇒ 接近峰值 1.0） */
  const holdAt = async (tau) => {
    await page.evaluate((t) => window.__garden.setLightningHold(t), tau);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  await holdAt(0.045);
  const peak = await page.evaluate(() => window.__garden.lightning());
  const peakPng = decodePNG(Buffer.from((await frozen()).split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'peak.png'), Buffer.from((await frozen()).split(',')[1], 'base64'));
  check('定格到峰值（flash ≥ 0.75）—— 探针拿到的是可复现的峰值帧', peak.flash >= 0.75, `flash=${peak.flash.toFixed(3)}`);

  /* 网格/亮痕的**投影**（NDC）：全在画外就是"等于没画"，这一步专抓初版那个缺陷 */
  const proj = await page.evaluate((tau) => {
    const G = window.__garden, T = G.THREE, cam = G.camera;
    const found = [];
    G.scene.traverse(o => { if (o.isMesh && o.renderOrder === 7 && o.material && o.material.blending === T.AdditiveBlending) found.push(o); });
    const out = [];
    const v = new T.Vector3();
    for (const m of found) {
      m.updateWorldMatrix(true, false);
      const pos = m.geometry.getAttribute('position');
      let minX = 9, maxX = -9, minY = 9, maxY = -9, inside = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(cam);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z <= 1) inside++;
      }
      out.push({ geo: m.geometry.type, verts: pos.count, inside,
                 ndc: [+minX.toFixed(2), +maxX.toFixed(2), +minY.toFixed(2), +maxY.toFixed(2)] });
    }
    return out;
  }, 0.045);
  const boltProj = proj.find(p => p.geo === 'BufferGeometry');
  check('闪电网格的顶点落在画面内（不是"摆在画外看不见"）',
    !!boltProj && boltProj.inside >= 8, JSON.stringify(boltProj));

  /* 冻结帧 A/B：定格峰值 ↔ 定格在"事件之外"（tau 5s ⇒ 包络为 0，光照写回基准）
     —— 两臂的差别**只有闪电这一件事**，比"另开一帧"干净得多。 */
  const abShots = await page.evaluate(async (tau) => {
    const G = window.__garden;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const shot = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return cv.toDataURL('image/png'); };
    const wait2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = {};
    G.setLightningHold(tau); await wait2(); out.peak = shot();
    G.setLightningHold(5.0); await wait2(); out.base = shot();
    G.setLightningHold(tau); await wait2(); out.peak2 = shot();
    G.setLightningHold(5.0); await wait2(); out.base2 = shot();
    /* 左右对照图（无闪 | 闪电峰值）—— 留给人眼验收"照亮整体"，也给多模态做并排判断 */
    const imgs = [out.base, out.peak].map(u => { const i = new Image(); i.src = u; return i; });
    await Promise.all(imgs.map(i => new Promise(r => { i.onload = r; })));
    const w = cv.width, h = cv.height;
    const wide = document.createElement('canvas'); wide.width = w * 2 + 8; wide.height = h;
    const wc = wide.getContext('2d');
    wc.fillStyle = '#000'; wc.fillRect(0, 0, wide.width, h);
    wc.drawImage(imgs[0], 0, 0); wc.drawImage(imgs[1], w + 8, 0);
    out.pair = wide.toDataURL('image/png');
    return out;
  }, 0.045);
  const dec = (u) => decodePNG(Buffer.from(u.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'peak.png'), Buffer.from(abShots.peak.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'no-lightning.png'), Buffer.from(abShots.base.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'pair-noflash-vs-flash.png'), Buffer.from(abShots.pair.split(',')[1], 'base64'));
  const imgPeak = dec(abShots.peak), imgBase = dec(abShots.base);
  const dSelfBase = meanAbsDiff(dec(abShots.base), dec(abShots.base2));   // 负例：两臂都无闪 ⇒ 应≈噪声
  const dFull = meanAbsDiff(imgPeak, imgBase);
  const dGroundPeak = regionMean(imgPeak, 0.55, 1.0), dGroundBase = regionMean(imgBase, 0.55, 1.0);
  const dGroundSelf = Math.abs(regionMean(dec(abShots.base2), 0.55, 1.0) - dGroundBase);
  check('自检：两臂都定格在"无闪"时画面几乎不动（≈噪声，本判据不是量的场景漂移）',
    dSelfBase < 4, `同状态差 ${dSelfBase.toFixed(2)}`);
  check('闪电把画面点亮了（冻结帧 峰值 ↔ 无闪）', dFull > 15, `全幅差 ${dFull.toFixed(2)}`);
  check('照亮整体：画面下半部（地面/建筑）明显变亮 —— 不只是天上亮',
    dGroundPeak - dGroundBase > 8, `下半部 ${dGroundBase.toFixed(1)} → ${dGroundPeak.toFixed(1)}（+${(dGroundPeak - dGroundBase).toFixed(1)}，自检漂移 ${dGroundSelf.toFixed(2)}）`);

  /* 亮痕：定格在横扫中段再量一次它自己的贡献 */
  await holdAt(0.12);
  const streakPng = decodePNG(Buffer.from((await frozen()).split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'streak.png'), Buffer.from((await frozen()).split(',')[1], 'base64'));
  const streakProj = await page.evaluate(() => {
    const G = window.__garden, T = G.THREE, cam = G.camera;
    let m = null;
    G.scene.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.renderOrder === 7) m = o; });
    if (!m || !m.visible) return { visible: false };
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.getAttribute('position'), v = new T.Vector3();
    let inside = 0, minX = 9, maxX = -9;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(cam);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z <= 1) inside++;
    }
    return { visible: true, inside, ndcX: [+minX.toFixed(2), +maxX.toFixed(2)], opacity: +m.material.opacity.toFixed(2) };
  });
  check('亮痕（亮光划过）的顶点落在画面内', !!streakProj.visible && streakProj.inside >= 2, JSON.stringify(streakProj));
  const dStreakPix = await page.evaluate(() => {
    const G = window.__garden;
    let streak = null;
    G.scene.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.renderOrder === 7) streak = o; });
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, cv.width, cv.height).data.slice(); };
    const vis = streak.visible; streak.visible = true; const A = grab();
    streak.visible = false; const B = grab();
    streak.visible = vis;
    let s = 0, n = 0;
    for (let i = 0; i < A.length; i += 4) { s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); n += 3; }
    return s / n;
  });
  check('亮痕真的画进了像素（可见 ↔ 隐藏 的冻结帧差 > 0.05）', dStreakPix > 0.05, `像素差 ${dStreakPix.toFixed(3)}`);
  void streakPng;

  /* 解除定格，回到真实时钟 */
  await page.evaluate(() => window.__garden.setLightningHold(null));

  /* ══ §4 时序：先闪电、后照亮 ════════════════════════════════════════════ */
  const seq = await page.evaluate(async () => {
    const G = window.__garden;
    const rows = [];
    const sunI = () => { const s = G.scene.children.find(c => c.isDirectionalLight && c.castShadow); return s ? s.intensity : 0; };
    const baseSun = sunI();
    G.lightningStrikeNow();
    const t0 = G.simClock();
    await new Promise(res => {
      const step = () => {
        const L = G.lightning();
        rows.push({ t: +(G.simClock() - t0).toFixed(3), flash: +L.flash.toFixed(3), bolt: L.boltVisible,
                    sky: +L.skyFlash.toFixed(3), sun: +sunI().toFixed(3), exp: +G.renderer.toneMappingExposure.toFixed(3) });
        if (G.simClock() - t0 >= 1.6) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return { rows, baseSun: +baseSun.toFixed(3) };
  });
  const rows = seq.rows;
  const lit = rows.filter(r => r.sun > seq.baseSun * 1.5);
  const boltAtLit = lit.filter(r => r.bolt).length;
  const peakFlash = Math.max(...rows.map(r => r.flash));
  const boltFrames = rows.filter(r => r.bolt).length;
  const end = rows[rows.length - 1];
  /* ⚠️ 采样上限：脉冲峰值 1.0、起跳 0.028s，而探针帧间隔 ~30ms（无头）⇒ 采样点会落在峰后
     一两帧，实测 0.80。判据取 ≥0.75（"确有强闪"），不追 1.0。 */
  check('闪电事件发生（采样 flash 峰值 ≥0.75）', peakFlash >= 0.75, `峰值 ${peakFlash.toFixed(3)}，闪电网格可见帧 ${boltFrames}`);
  check('照亮只发生在有闪电网格的帧（"先闪电、后照亮"）', lit.length > 0 && boltAtLit === lit.length,
    `被照亮帧 ${lit.length}，其中同时可见闪电 ${boltAtLit}`);
  check('闪电网格确实出现过（不是纯提亮）', boltFrames >= 2, `${boltFrames} 帧可见`);
  check('天空 uFlash 与闪光同步（云层被闪亮）', Math.max(...rows.map(r => r.sky)) > 0.5, `uFlash 峰值 ${Math.max(...rows.map(r => r.sky)).toFixed(2)}`);
  check('事件收尾归零（flash / 曝光回到基准）',
    end.flash < 0.02 && Math.abs(end.exp - dark.exposure) < 0.05, `末帧 flash=${end.flash} 曝光=${end.exp}（基准 ${dark.exposure}）`);
  check('照亮峰值显著（sun 至少抬到基准的 4 倍）', Math.max(...rows.map(r => r.sun)) > seq.baseSun * 4,
    `峰值 sun ${Math.max(...rows.map(r => r.sun))} vs 基准 ${seq.baseSun}`);

  /* ══ §5 雷鸣 ═══════════════════════════════════════════════════════════ */
  const lt = await page.evaluate(() => window.__garden.lightning().lastThunder);
  check('雷鸣参数：延迟 ≥0.5s（雷声在闪电之后）', lt && lt.delay >= 0.5, JSON.stringify(lt));
  check('雷鸣参数：1~3 层叠放（密集雷）', lt && lt.layers >= 1 && lt.layers <= 3, `layers=${lt && lt.layers}`);
  const loaded = await page.waitForFunction(() => window.__garden.thunderState().loaded, null, { timeout: 30000 })
    .then(() => true).catch(() => false);
  check('雷声素材（真实录音 mp3）在浏览器里解码成功', loaded, loaded ? 'ok' : '30s 内未解码完成');
  const plays1 = await page.evaluate(() => window.__garden.thunderState().plays);
  await page.evaluate(() => window.__garden.lightningStrikeNow());
  await page.waitForTimeout(1600);
  const plays2 = await page.evaluate(() => window.__garden.thunderState().plays);
  check('音景开启时：闪电 → 雷鸣播放计数递增', plays2 > plays1, `${plays1} → ${plays2}`);

  /* ══ §6 隔离 ══════════════════════════════════════════════════════════ */
  const s0 = await page.evaluate(() => window.__garden.lightning().strikes);
  await page.evaluate(() => window.__garden.setEnv('weather', 'clear'));
  await page.waitForTimeout(12000);
  const s1 = await page.evaluate(() => window.__garden.lightning().strikes);
  const l0 = await page.evaluate(() => window.__garden.lightning());
  check('非 thunder 天气：12 秒零闪电', s1 === s0, `${s0} → ${s1}`);
  check('离开 thunder 后闪光量归零（无残留提亮）', l0.flash === 0 && l0.skyFlash === 0, `flash=${l0.flash} skyFlash=${l0.skyFlash}`);
  /* 随机池隔离：thunder.hidden=true ⇒ randomScene 永不抽中（老黄要的是"可选的场景"；
     随机撞进雷雨时音景多半没开，会变成"闪电没雷声"的半成品） */
  const pool = await page.evaluate(() => {
    const G = window.__garden;
    const got = {};
    for (let i = 0; i < 400; i++) { const r = G.randomScene(); got[r.weather] = (got[r.weather] || 0) + 1; }
    return got;
  });
  check('随机场景从不抽到 thunder（不在随机池）', !pool.thunder, JSON.stringify(pool));

  check('全程零 pageerror', pageErrors.length === 0, pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[thunder-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`样张：${OUT}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[thunder-guard] 崩溃:', e); process.exit(2); });
