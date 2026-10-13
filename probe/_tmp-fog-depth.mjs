// _tmp-fog-depth.mjs —— 【临时诊断探针】判明"DepthTexture 这条路到底有没有内容"。
// 2026-10-13 · 单：node probe/_tmp-fog-depth.mjs
//
// 背景（Chief 已核实，不在此重述）：fog 门红 = 近地面雾完全看不见。链条是
//   src/10-post.js:411  float dRaw = texture2D(tDepth, vUv).x;  ⇒ viewZFromDepth 反算距离
//   ⇒ 若 dRaw 恒≈0，所有采样点都落在相机前 0.5m 内 ⇒ 高度衰减=0 ⇒ 无雾。
// 昨天两次"自建 RT 读深度"被判**无效**：自证通道 G/B 全 0、B 又恒为 1
//   ⇒ 那条读回通路本身没输出，读数作废。
//
// 本探针的纪律（昨天的教训写死在最前面）：
//   **G=0.25 / B=0.75 是自证通道，必须原样读回；否则整批读数作废、不下任何结论。**
//
// 做法：自建 RT1（挂自己的 DepthTexture）渲场景 → 全屏 quad 把深度写成颜色到 RTr
//      （R=深度原值, G=0.25, B=0.75）→ readRenderTargetPixels 读回做统计。
//
// ⚠️ 本文件是**临时**诊断件，不注册进 verify-all，跑完可删。不改任何产品代码。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1100, H = 660;

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

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));

  console.log(`[_tmp-fog-depth] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 120000, polling: 300 });
  // 与 volumetric-fog-guard 同一环境（:183），保证量到的是同一状态
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000, polling: 200 });
  await sleep(900);

  const out = await page.evaluate(() => {
    const g = window.__garden, T = g.THREE;
    const r = g.renderer, scene = g.scene, cam = g.camera;
    const gl = r.getContext();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;

    /* ── 机器能力 ── */
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const RENDERER = String(gl.getParameter(gl.RENDERER));
    const unmasked = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '(无该扩展)';
    const cap = {
      isWebGL2: r.capabilities.isWebGL2,
      maxTextures: r.capabilities.maxTextures,
      maxTextureSize: r.capabilities.maxTextureSize,
      precision: r.capabilities.precision,
      RENDERER, VERSION: String(gl.getParameter(gl.VERSION)),
      VENDOR: String(gl.getParameter(gl.VENDOR)),
      unmaskedRenderer: unmasked, unmaskedVendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : '(无该扩展)',
      isANGLE: /ANGLE/i.test(RENDERER) || /ANGLE/i.test(unmasked),
      MAX_DEPTH_TEXTURE_SAMPLES: typeof gl.MAX_DEPTH_TEXTURE_SAMPLES !== 'undefined'
        ? gl.getParameter(gl.MAX_DEPTH_TEXTURE_SAMPLES) : '(GL 常量不存在)',
      drawingBuffer: [w, h], viewport: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      camNear: cam.near, camFar: cam.far,
    };

    /* ── RT1：自挂 DepthTexture，把场景渲进去 ── */
    const dt = new T.DepthTexture(w, h);
    dt.type = T.UnsignedIntType;
    dt.format = T.DepthFormat;
    dt.minFilter = T.NearestFilter;
    dt.magFilter = T.NearestFilter;
    dt.generateMipmaps = false;
    dt.flipY = false;
    const RT1 = new T.WebGLRenderTarget(w, h, { depthBuffer: true, stencilBuffer: false });
    RT1.depthTexture = dt;

    const prev = r.getRenderTarget();
    r.setRenderTarget(RT1);
    r.clear(true, true, true);
    r.render(scene, cam);
    r.setRenderTarget(null);

    /* ── RTr：颜色 RT。R=深度原值，G=0.25，B=0.75（后两条是自证通道） ── */
    const RTr = new T.WebGLRenderTarget(w, h, {
      depthBuffer: false, stencilBuffer: false,
      minFilter: T.NearestFilter, magFilter: T.NearestFilter,
    });
    const mat = new T.ShaderMaterial({
      uniforms: { tD: { value: dt } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tD; varying vec2 vUv;\n' +
        'void main(){ gl_FragColor = vec4(texture2D(tD, vUv).x, 0.25, 0.75, 1.0); }',
      depthTest: false, depthWrite: false,
    });
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    const qscene = new T.Scene(); qscene.add(quad);
    const qcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    r.setRenderTarget(RTr);
    r.render(qscene, qcam);

    /* ── 读回 ── */
    const n = w * h;
    const buf = new Uint8Array(n * 4);
    r.readRenderTargetPixels(RTr, 0, 0, w, h, buf);
    r.setRenderTarget(prev);

    /* ── 统计 ── */
    const hist = new Array(8).fill(0);
    let sR = 0, mnR = 255, mxR = 0, sG = 0, mnG = 255, mxG = 0, sB = 0, mnB = 255, mxB = 0;
    let cR0 = 0, cR255 = 0, cRmid = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4, R = buf[o], G = buf[o + 1], B = buf[o + 2];
      sR += R; if (R < mnR) mnR = R; if (R > mxR) mxR = R;
      sG += G; if (G < mnG) mnG = G; if (G > mxG) mxG = G;
      sB += B; if (B < mnB) mnB = B; if (B > mxB) mxB = B;
      hist[R < 32 ? Math.floor(R / 32) : 7]++;
      if (R <= 1) cR0++; else if (R >= 254) cR255++; else cRmid++;
    }
    const grid = [];
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
      const cx = Math.min(w - 1, Math.floor((gx + 0.5) * w / 3));
      const cy = Math.min(h - 1, Math.floor((gy + 0.5) * h / 3));
      const o = (cy * w + cx) * 4;
      grid.push({ cell: gx + ',' + gy, R: buf[o], G: buf[o + 1], B: buf[o + 2] });
    }

    quad.geometry.dispose(); mat.dispose();
    RT1.dispose(); dt.dispose(); RTr.dispose();

    return { cap, w, h, n,
      R: { min: mnR, max: mxR, mean: +(sR / n).toFixed(4) },
      G: { min: mnG, max: mxG, mean: +(sG / n).toFixed(4) },
      B: { min: mnB, max: mxB, mean: +(sB / n).toFixed(4) },
      hist, pct: { 'R<=1': +(100 * cR0 / n).toFixed(2), 'R>=254': +(100 * cR255 / n).toFixed(2), '1<R<254': +(100 * cRmid / n).toFixed(2) },
      grid };
  });

  await browser.close(); server.close();

  /* ── 报告 ── */
  const f = (v, n2) => String(v).padStart(n2);
  console.log('\n── 机器能力 ──');
  const c = out.cap;
  console.log(`  RENDERER=${c.RENDERER}`);
  console.log(`  unmasked=${c.unmaskedRenderer}`);
  console.log(`  VERSION=${c.VERSION}`);
  console.log(`  VENDOR=${c.VENDOR} · unmaskedVendor=${c.unmaskedVendor}`);
  console.log(`  isANGLE=${c.isANGLE} · isWebGL2=${c.isWebGL2} · MAX_DEPTH_TEXTURE_SAMPLES=${c.MAX_DEPTH_TEXTURE_SAMPLES}`);
  console.log(`  maxTextures=${c.maxTextures} · maxTextureSize=${c.maxTextureSize} · precision=${c.precision}`);
  console.log(`  drawingBuffer=${c.drawingBuffer.join('x')} · viewport=${c.viewport.join('x')} · dpr=${c.dpr}`);
  console.log(`  camera near/far=${c.camNear} / ${c.camFar}`);

  console.log(`\n── 读回统计（${out.w}x${out.h} = ${out.n} 像素）──`);
  console.log(`  【自证】G 实测 min=${out.G.min} max=${out.G.max} mean=${out.G.mean}  （期望 64 / 64 / 63.75）`);
  console.log(`  【自证】B 实测 min=${out.B.min} max=${out.B.max} mean=${out.B.mean}  （期望 191 / 191 / 191.25）`);
  console.log(`  R 实测 min=${out.R.min} max=${out.R.max} mean=${out.R.mean}`);
  console.log(`  R=0[即 R<=1] ${f(out.pct['R<=1'], 6)}%   R=1[即 R>=254] ${f(out.pct['R>=254'], 6)}%   中间 ${f(out.pct['1<R<254'], 6)}%`);
  console.log('  8 桶直方图（桶宽 32，按 R 计）:');
  for (let i = 0; i < 8; i++) {
    const pctv = 100 * out.hist[i] / out.n;
    const bars = '#'.repeat(Math.round(pctv / 2));
    console.log(`    [R ${String(i * 32).padStart(3)}-${String(i * 32 + 31).padStart(3)}] ${f(pctv.toFixed(2), 6)}% ${bars}`);
  }
  console.log('  3×3 网格中心（R/G/B）:');
  for (const g of out.grid) console.log(`    (${g.cell}) R=${f(g.R, 3)} G=${f(g.G, 3)} B=${f(g.B, 3)}`);

  /* ── 判读（先写死，不改口）── */
  const selfProofOK = out.G.min === out.G.max && Math.abs(out.G.mean - 63.75) < 1.0
                  && out.B.min === out.B.max && Math.abs(out.B.mean - 191.25) < 1.0;
  console.log('\n── 判读（规则先写死）──');
  if (!selfProofOK) {
    console.log('  ⛔ **G/B 读回不是 0.25/0.75 ⇒ 通路不通，整批读数作废，不下任何结论。**');
    console.log(`     实测 G=${out.G.mean} B=${out.B.mean}`);
  } else {
    const flat = (out.R.max - out.R.min) <= 2;
    if (flat) {
      console.log(`  ⇒ R 是**平的**（max-min=${out.R.max - out.R.min}）⇒ 这台机器的 DepthTexture 不可用`);
      console.log('  ⇒ 修法方向：另渲一张**线性距离图**（颜色 RT），不进 DepthTexture。');
    } else {
      console.log('  ⇒ R **有内容**（非平）⇒ DepthTexture 可用，毛病在 composer 的接线');
      console.log('  ⇒ 修法方向：每帧从**场景真正渲进去的那张 RT** 上取深度。');
    }
  }
  console.log(`\n  pageerror: ${errors.length} 条`);
  console.log('  （本文件是临时诊断件，不注册 verify-all；跑完可删）');
  process.exit(0);
})().catch(e => { console.error('[_tmp-fog-depth] 崩溃:', e); process.exit(2); });
