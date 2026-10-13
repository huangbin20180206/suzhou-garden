// _tmp-fog-visual.mjs —— 【临时】出高度雾开关的三张对比图（给人看观感用）。
// 2026-10-13 · 单：node probe/_tmp-fog-visual.mjs
//
// 纪律：
//   · 唯一变量只有 setHFogEnabled（产品侧导出，10-post.js:455），不抠 pass 内部。
//   · 两个 arm 必须在**同一个 JS 任务里同步连渲**（animate 只在 rAF 推进 ⇒ 场景冻结）——
//     这是 volumetric-fog-guard.mjs:176-179 写死的口径，本探针照搬。
//   · 自带同配置连渲自检（同状态两次渲染差必须 = 0），否则 diff 图上的东西可能是噪声。
//   · 不改任何被测代码，只读 + 截图。
//
// 放大倍数的定法（**先写死再算数**）：gain = 使 p99(|Δ|)×gain ≥ 120 的最小 2 的幂。
// 用 p99 不用 max ⇒ 不被个别离群像素牵着走；同时报告 max / p99 / >2/255 占比原值。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;
const OUT = path.join(ROOT, 'outputs', 'visual');

const loadPlaywright = () => {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  throw new Error('playwright 不可用');
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.glb': 'model/gltest', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));

  console.log(`[_tmp-fog-visual] http://127.0.0.1:${port}/index.html  ${W}x${H}`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 180000, polling: 300 });

  await page.evaluate(() => {
    const g = window.__garden;
    /* 与 volumetric-fog-guard 完全同一组环境，读数才可比 */
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
    g.controls.enabled = false; g.controls.enableDamping = false;
    g.controls.minDistance = 0.4; g.controls.maxDistance = 400;
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000, polling: 200 });
  await sleep(1200);

  const out = await page.evaluate(async () => {
    const g = window.__garden;
    const P = await import(new URL('src/10-post.js', document.baseURI).href);

    const cv = g.renderer.domElement;
    const cw = cv.width, ch = cv.height;
    const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
    const ctx = c2.getContext('2d', { willReadFrequently: true });

    /* 照搬门禁的 grab：手动渲一次再 drawImage 进来，同任务内拿像素 */
    const grab = () => { g.composer.render(); ctx.drawImage(cv, 0, 0); return ctx.getImageData(0, 0, cw, ch); };

    /* 观荷水道机位：与 nearview-clarity-guard.mjs:32 同口径 */
    const NEAR = { cam: [-2.0, 1.15, 7.6], tgt: [0.6, 0.05, 3.0] };

    function setCam(which) {
      let pos, tgt;
      if (which === 'lotus') { pos = NEAR.cam; tgt = NEAR.tgt; }
      else { const v = g.VIEWPOINTS.find(v => v.id === which); pos = [v.pos.x, v.pos.y, v.pos.z]; tgt = [v.target.x, v.target.y, v.target.z]; }
      g.camera.position.set(pos[0], pos[1], pos[2]);
      g.controls.target.set(tgt[0], tgt[1], tgt[2]);
      g.camera.lookAt(tgt[0], tgt[1], tgt[2]);
      g.controls.update(); g.camera.updateMatrixWorld(true);
      g.scene.updateMatrixWorld(true);
      return { dist: +g.camera.position.distanceTo(g.controls.target).toFixed(2), pos, tgt };
    }

    /* |Δ| 的统计量：按 RGB 三通道取每像素最大值，门禁的"可见"阈值是 >2/255 */
    function diffStats(A, B) {
      const n = A.length, hist = new Uint32Array(256);
      let mx = 0, cnt2 = 0;
      for (let i = 0; i < n; i += 4) {
        const d0 = Math.abs(A[i] - B[i]), d1 = Math.abs(A[i + 1] - B[i + 1]), d2 = Math.abs(A[i + 2] - B[i + 2]);
        const d = d0 > d1 ? (d0 > d2 ? d0 : d2) : (d1 > d2 ? d1 : d2);
        hist[d]++; if (d > mx) mx = d; if (d > 2) cnt2++;
      }
      const npix = n / 4;
      const pct = q => { let acc = 0, need = npix * q; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= need) return v; } return 255; };
      return { max: mx, p50: pct(0.50), p90: pct(0.90), p99: pct(0.99),
               pct_gt2: +(100 * cnt2 / npix).toFixed(3), pixels: npix };
    }

    /* gain 的定法（先写死）：使 p99×gain ≥ 120 的最小 2 的幂 */
    const pickGain = p99 => { let g = 1; while (p99 * g < 120 && g < 256) g *= 2; return g; };

    /* 水印：把这张图的**读法**直接印上去（放大倍数 / 原始幅度 / 机位 / 环境）。
       只用 ASCII —— 无头 Chromium 的 CJK 字体不保证有，中文会印成豆腐块。 */
    function stamp(lines) {
      ctx.save();
      ctx.font = '20px monospace';
      ctx.textBaseline = 'top';
      const wMax = Math.max(...lines.map(s => ctx.measureText(s).width)) + 24;
      const hBox = lines.length * 26 + 16;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(12, 12, wMax, hBox);
      ctx.fillStyle = '#fff';
      lines.forEach((s, i) => ctx.fillText(s, 24, 20 + i * 26));
      ctx.restore();
    }
    const CAP = 'lotus cam (dist 5.37m) · noon/summer/clear · setHFogEnabled off vs on';
    function snap(imgData, lines) { ctx.putImageData(imgData, 0, 0); if (lines) stamp(lines); return c2.toDataURL('image/png'); }

    function renderDiff(A, B, gain, st) {
      const img = ctx.createImageData(cw, ch);
      const o = img.data, n = A.length;
      for (let i = 0; i < n; i += 4) {
        const d0 = Math.abs(A[i] - B[i]), d1 = Math.abs(A[i + 1] - B[i + 1]), d2 = Math.abs(A[i + 2] - B[i + 2]);
        let d = d0 > d1 ? (d0 > d2 ? d0 : d2) : (d1 > d2 ? d1 : d2);
        const v = Math.min(255, Math.round(d * gain));
        o[i] = v; o[i + 1] = v; o[i + 2] = v; o[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      stamp(['|fog on - fog off|, amplified GAIN x' + gain,
             'true amplitude: max ' + st.max + '/255  p99 ' + st.p99 + '/255  p50 ' + st.p50 + '/255',
             '>2/255 covers ' + st.pct_gt2 + '% of pixels  (same-config self-check diff = 0)',
             CAP]);
      return c2.toDataURL('image/png');
    }

    const results = [];
    const shots = {};
    for (const which of ['lotus', 'pavilion']) {
      const cam = setCam(which);
      /* ── 三个 arm 同一个 JS 任务里连渲 ── */
      P.setHFogEnabled(0); const off = grab();
      P.setHFogEnabled(0); const off2 = grab();          // 自检：同配置连渲
      P.setHFogEnabled(1); const on  = grab();
      const self = diffStats(off.data, off2.data);
      const st = diffStats(off.data, on.data);
      const gain = pickGain(st.p99);
      const camDist = cam.dist;
      results.push({ which, cam, self, st, gain });
      shots[which] = {
        off: off.data, on: on.data, gain,
        offPNG: off2 ? c2.toDataURL('image/png') : null,
      };
      /* 先把 off/on 的 PNG 直接取出来（c2 当前内容是 on） */
      shots[which].offPNG = snap(off, ['height fog OFF', CAP]);
      shots[which].onPNG  = snap(on,  ['height fog ON',  CAP]);
      shots[which].diffPNG = renderDiff(off.data, on.data, gain, st);
    }

    /* 选"最能看出雾"的那个机位：以 p99(|Δ|) 高者为胜（先写死的判据） */
    let best = results[0];
    for (const r of results) if (r.st.p99 > best.st.p99) best = r;

    return { results, pick: best.which, gain: best.gain,
             shots, camW: cw, camH: ch,
             env: { time: g.ENV.time, season: g.ENV.season, weather: g.ENV.weather },
             gpu: g.gpuName || '(未知)' };
  });

  await browser.close(); server.close();

  /* ── 落盘 ── */
  const s = out.shots[out.pick];
  const write = (name, dataUrl) => {
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const p = path.join(OUT, name);
    fs.writeFileSync(p, buf);
    return { name, path: p, bytes: buf.length };
  };
  const files = [
    write('fog-off.png', s.offPNG),
    write('fog-on.png', s.onPNG),
    write('fog-diff.png', s.diffPNG),
  ];

  console.log('\n── 机位候选（同一环境 noon/summer/clear）──');
  for (const r of out.results) {
    console.log(`  ${r.which.padEnd(9)} 距target=${r.cam.dist}m  p99|Δ|=${r.st.p99}  max=${r.st.max}  p50=${r.st.p50}  >2/255占${r.st.pct_gt2}%  同配置自检差=${r.self.max}`);
  }
  console.log(`\n── 选中：${out.pick}（判据 = p99(|Δ|) 更高）· 放大倍数 gain=${out.gain} · 画布 ${out.camW}x${out.camH}`);
  console.log(`── 环境：${JSON.stringify(out.env)} · GPU=${out.gpu} · pageerror=${errors.length} 条`);
  console.log('\n── 落盘 ──');
  for (const f of files) console.log(`  ${f.name.padEnd(12)} ${f.bytes} B  ${f.path}`);
  process.exit(0);
})().catch(e => { console.error('[_tmp-fog-visual] 崩溃:', e); process.exit(2); });
