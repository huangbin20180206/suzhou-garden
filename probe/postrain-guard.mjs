// 雨后痕迹 postrain-guard（2026-10-01 加）
//
// 守什么：老黄"雨后初晴不是应该地面和周边环境还有雨水的痕迹么，或者屋檐还在继续滴水，
//   否则怎么判断是雨后初晴"。本门守两个部件：
//     ① **屋檐滴水**：雨后（wetness 高、雨已停）沿檐口线要真的在滴水，且能被画进像素
//     ② **积水**：铺地上要有水洼，而且**必须落在真正的水平地面上**
//
// ⚠️ 为什么"水洼落在哪"值得单独一条判据（这是本轮真踩到的坑）：
//   水洼的高度是运行时射线量出来的，而第一版射线只取"第一个非实例网格" ⇒
//   落点上方只要有墙或屋面，水洼就被**贴到墙上**（材质反天空 ⇒ 发白），
//   多模态实测判语："右侧白墙上有一块明显的、不自然的白色斑块"。
//   ⇒ 判据必须直接量**每一片水洼的高度与世界法线朝向**，而不是只数"有没有水洼"。
//
// ⚠️ 隔离也要守：不下雨也不湿的天气（晴/雪/薄雾）**不该**有滴水与水洼，否则
//   等于给所有场景都糊了一层湿。
//
// 用法: node probe/postrain-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const t0 = Date.now();
  const port = await listenEphemeral(server);
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 540 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  await page.addStyleTag({ content: '#hud,#env,#caption,#loading{display:none !important}' });
  await page.evaluate(() => {
    const G = window.__garden;
    G.ENV.dur = 0.25;
    G.setEnv('season', 'summer'); G.setEnv('time', 'noon');
  });
  const setWx = async (w) => {
    await page.evaluate((w) => { window.__garden.setEnv('weather', w); }, w);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 60000 });
    await page.waitForTimeout(2600);
  };
  const state = () => page.evaluate(async () => {
    const M = await import('/src/12-env.js');           // 同一个模块实例（ESM 缓存）
    const P = M.POSTRAIN;
    if (!P) return { err: 'POSTRAIN 未导出' };
    const T = window.__garden.THREE, m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
    let maxY = -1e9, minY = 1e9;
    const ys = [];
    for (let i = 0; i < P.puddles.im.count; i++){
      P.puddles.im.getMatrixAt(i, m); m.decompose(p, q, s);
      ys.push(+p.y.toFixed(2)); maxY = Math.max(maxY, p.y); minY = Math.min(minY, p.y);
    }
    /* 滴水状态（2026-10-02 产品改成"16 个固定滴点、慢滴"后新增的牙）：
       · spotsN：固定滴点数 = 16（随机几处瓦片在漏水，不是全线 320 颗冰雹）；
       · live：连续 30 帧（~0.5s）里"空中同时存在的水滴"的最大数 ——
         停顿 1.2~4.7s/滴 ⇒ 任意时刻 0~16 都正常，但 0.5s 窗内必须出现过 >0
         （否则就是"摆设不滴"）；≤16 由构造保证（每滴点最多 1 滴在空）。 */
    const spotsN = P.drip.spots ? P.drip.spots.length : -1;
    let liveMax = 0;
    for (let f = 0; f < 30; f++){
      let c = 0;
      for (const d of P.drip.drops) if (d.live) c++;
      liveMax = Math.max(liveMax, c);
      await new Promise(r => requestAnimationFrame(r));
    }
    return { dripVis: P.drip.im.visible, dripOp: +P.drip.mat.opacity.toFixed(2),
             puddleVis: P.puddles.im.visible, puddleOp: +P.puddles.mat.opacity.toFixed(2),
             placed: P.puddles.placed, cand: P.puddles.cand.length,
             onGrass: P.puddles.onGrass, badNormal: P.puddles.badNormal, tooHigh: P.puddles.tooHigh,
            spotsN, liveMax,
             maxY, minY, ys: ys.slice(0, 8),
             wet: +(window.__garden.ENV.cur.wetness || 0).toFixed(2) };
  });

  /* ── 雨后初晴：两个部件都该在，且水洼都落在地面上 ── */
  await setWx('afterrain');
  const st = await state();
  check('雨后初晴：屋檐滴水在跑（可见 + 不透明度 > 0.5）',
    st.dripVis && st.dripOp > 0.5, `visible=${st.dripVis} opacity=${st.dripOp}`);
  check('雨后初晴：积水在跑（可见 + 不透明度 > 0.3）',
    st.puddleVis && st.puddleOp > 0.3, `visible=${st.puddleVis} opacity=${st.puddleOp}`);
  /* ⚠️ 这条是"贴到墙上"那个真缺陷的牙：水洼必须落在**地面量级的高度**。
     墙上/屋面上的话 y 会是 3~9m。 */
  check('积水**全部落在地面上**（最高那片 < 2.7m，不是被贴到墙/屋面上）',
    st.placed > 0 && st.maxY < 2.7, `落位 ${st.placed}/${st.cand} 片，高度 ${st.minY}~${st.maxY}m`);
  check('积水有实数（落在铺地/月台上的 ≥ 15 片）', st.placed >= 15,
    `落位 ${st.placed} 片（草地跳过 ${st.onGrass}、非法法线 ${st.badNormal}、过高 ${st.tooHigh}）`);

  /* ── 像素：两个部件都真的改变了画面（冻结帧同任务 A/B + 自检）── */
  /* ⚠️ 2026-10-02 产品形态变更（老黄四连："滴水慢一点、密度低一些、随机几个瓦片
     下水处就好、体积做小一点像冰雹"）⇒ 320 颗 0.046 → 16 个固定滴点 0.023、限速
     2.0m/s。默认机位（俯视 20m+）下 16 颗小滴只贡献 ~7px —— "默认机位可见"已经
     不是这个部件的验收口径了（老黄验收的是檐下近景的"滴答感"）。
     ⇒ 滴水的像素判据改在**檐下近景机位**量；积水像素仍在默认机位量。 */
  const px = await page.evaluate(async () => {
    const M = await import('/src/12-env.js');
    const P = M.POSTRAIN, G = window.__garden;
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d');
    const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, cv.width, cv.height); };
    const hot = (A, B) => { let n = 0;
      for (let i = 0; i < A.data.length; i += 4){
        const d = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
        if (d > 12) n++;
      } return n; };
    grab();
    const A = grab();
    P.puddles.im.visible = false; const noPud = grab(); P.puddles.im.visible = true;
    grab(); const C = grab();
    let selfMax = 0;
    for (let i = 0; i < A.data.length; i++) selfMax = Math.max(selfMax, Math.abs(A.data[i]-C.data[i]));
    return { pud: hot(A, noPud), selfMax };
  });
  /* 滴水：摆到堂前檐下近景再量（堂檐口在 (0,·,−12.8)，半宽 12.3、檐高 6.39）。
     ⚠️ 机位摆动必须落在 page.evaluate 之外、摆完直接连渲 —— evaluate 里的
     await 会劈开冻结帧（项目里踩过两次的老坑）。
     ⚠️⚠️ 16 颗小滴形态下，这条的口径只能是很低的有无阈值（实测一组 A/B 只有
     ~10px）：滴是 0.023m 半径的小球，檐下 14m 外单颗核心只有几像素；
     且**冻结帧那一刻在空的滴数**有相位（0~16 都正常，期望 ~8）⇒ 单组 A/B 会
     偶尔量到很少。取 3 组（组间让 rAF 推进滴相位 500ms）的最大值。
     "真的在滴"的主牙在上一条状态判据（16 滴点 + live>0），这条只防
     "整层 visible 却没画进任何像素"（材质/深度被弄坏那一类）。 */
  await page.evaluate(() => {
    const G = window.__garden;
    G.camera.position.set(13.5, 2.6, -6.0);
    G.controls.target.set(4.0, 6.1, -12.6);
    G.controls.update();
  });
  let dripPx = 0;
  for (let g = 0; g < 3; g++){
    const px2 = await page.evaluate(async () => {
      const M = await import('/src/12-env.js');
      const P = M.POSTRAIN, G = window.__garden;
      const cv = document.createElement('canvas');
      cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
      const ctx = cv.getContext('2d');
      const grab = () => { G.composer.render(); ctx.drawImage(G.renderer.domElement, 0, 0); return ctx.getImageData(0, 0, cv.width, cv.height); };
      const hot = (A, B) => { let n = 0;
        for (let i = 0; i < A.data.length; i += 4){
          const d = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
          if (d > 12) n++;
        } return n; };
      grab();                                    // 预热（新机位首帧 / 新相位帧）
      const A = grab();
      P.drip.im.visible = false; const noDrip = grab(); P.drip.im.visible = true;
      return { drip: hot(A, noDrip) };
    });
    dripPx = Math.max(dripPx, px2.drip);
    if (g < 2) await page.waitForTimeout(500);   // 让 rAF 推进滴相位，下一组再量
  }
  check('自检：同状态连渲两次画面不变（不是量的场景漂移）', px.selfMax === 0, `最大差 ${px.selfMax}`);
  check('雨后初晴：16 个固定滴点在跑、且有空滴在落（0.5s 窗内 live>0）',
    st.spotsN === 16 && st.liveMax > 0, `滴点 ${st.spotsN} 处 · 0.5s 窗内空中水滴最多 ${st.liveMax} 颗`);
  check('屋檐滴水真的画进了像素（檐下近景 3 组取最大 > 4px）', dripPx > 4, `滴水贡献 ${dripPx}px（3 组最大）`);
  check('积水真的画进了像素（默认机位 > 3000px）', px.pud > 3000, `积水贡献 ${px.pud}px`);

  /* ── 隔离：不湿的天气不该有这两个部件 ── */
  for (const w of ['clear', 'snow', 'mist']){
    await setWx(w);
    const s2 = await state();
    check(`隔离：${w} 不该有屋檐滴水/积水`,
      !s2.dripVis && !s2.puddleVis, `wetness=${s2.wet} drip=${s2.dripVis} puddle=${s2.puddleVis}`);
  }
  /* 暴雨里雨粒子自己就是"湿"，滴水/水洼不与雨叠加 */
  await setWx('storm');
  const s3 = await state();
  check('隔离：暴雨中不叠加滴水/积水（交给雨粒子）',
    !s3.dripVis && !s3.puddleVis, `wetness=${s3.wet} drip=${s3.dripVis} puddle=${s3.puddleVis}`);

  check('全程零 pageerror', pageErrors.length === 0, pageErrors.length ? pageErrors[0] : '0 条');

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n[postrain-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[postrain-guard] 崩溃:', e); process.exit(2); });
