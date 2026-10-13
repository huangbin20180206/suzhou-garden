// _tmp-fog-wire.mjs —— 【临时诊断探针】判明"高度雾真正拿到的是哪张 RT 的深度、那张 RT 的深度有没有活到雾 pass"。
// 2026-10-13 · 单：node probe/_tmp-fog-wire.mjs <标签>
//
// 与 _tmp-fog-depth.mjs 的分工：那支证的是"DepthTexture 这条机制本身可用"（自建 RT1、无 MSAA）。
// 本支证的是**接线**，三条独立问题分别量：
//   Q1  RenderPass 刚把场景画完的那一刻，readBuffer.depthTexture **有没有内容**？
//       （决定"紧跟 RenderPass 抄一份深度"这条路能不能走；也顺带验 MSAA 的深度解不 resolve）
//   Q2  雾 pass 的 tDepth 到底指向哪张 RT？（对比 RT1/RT2 的 depthTexture 的 uuid）
//   Q3  那份深度跑完整条 composer 链之后**还在不在**？
//
// ⚠️ 自证纪律（同 _tmp-fog-depth）：G=0.25 / B=0.75 是自证通道，必须原样读回，
//    否则整批读数作废、不下任何结论。本支用 FloatType RT ⇒ 深度是**全精度**，
//    0.25/0.75 在 float 里是精确值，G/B 必须**逐位**等于 0.25 / 0.75。
//
// ⚠️ 本文件是**临时**诊断件，不注册 verify-all，跑完可删。不改任何产品代码。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1100, H = 660;
const LABEL = process.argv[2] || '(未标注)';

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltest', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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

  console.log(`[_tmp-fog-wire · ${LABEL}] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 120000, polling: 300 });
  await page.evaluate(() => {
    const g = window.__garden;
    g.setEnv('time', 'noon'); g.setEnv('season', 'summer'); g.setEnv('weather', 'clear');
  });
  await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000, polling: 200 });
  await sleep(900);

  const out = await page.evaluate(async () => {
    const g = window.__garden, T = g.THREE;
    const r = g.renderer, composer = g.composer;
    const P = await import(new URL('src/10-post.js', document.baseURI).href);
    const fogPass = P.heightFogPass;
    const short = t => (t && t.uuid ? t.uuid.slice(0, 8) : '(null)');

    /* ── 读回工具：把任意纹理当 sampler2D 采进 FloatType RT。
         R=原值, G=0.25, B=0.75（后两条是自证通道）。必须在**定义之前**就能调用，
         因为 Q1 要在 RenderPass 内部（链还没往下走）就地取一次。 */
    function readTex(tex) {
      if (!tex) return null;
      const img = tex.image || {};
      const w = img.width || 0, h = img.height || 0;
      if (!w || !h) return { error: 'texture has no image dims', uuid: short(tex) };
      const mat = new T.ShaderMaterial({
        uniforms: { tD: { value: tex } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D tD; varying vec2 vUv;\n' +
          'void main(){ gl_FragColor = vec4(texture2D(tD, vUv).x, 0.25, 0.75, 1.0); }',
        depthTest: false, depthWrite: false,
      });
      const quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
      const qs = new T.Scene(); qs.add(quad);
      const qc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const RTr = new T.WebGLRenderTarget(w, h, {
        type: T.FloatType, format: T.RGBAFormat,
        depthBuffer: false, stencilBuffer: false,
        minFilter: T.NearestFilter, magFilter: T.NearestFilter,
      });
      const prev = r.getRenderTarget();
      r.setRenderTarget(RTr);
      r.render(qs, qc);
      const buf = new Float32Array(w * h * 4);
      r.readRenderTargetPixels(RTr, 0, 0, w, h, buf);
      r.setRenderTarget(prev);

      const n = w * h;
      let mnR = Infinity, mxR = -Infinity, sR = 0, cNear = 0, cFar = 0;
      let gBad = 0, bBad = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 4, R = buf[o], G = buf[o + 1], B = buf[o + 2];
        if (G !== 0.25) gBad++;
        if (B !== 0.75) bBad++;
        if (R < mnR) mnR = R; if (R > mxR) mxR = R; sR += R;
        if (R >= 0.999) cFar++; else if (R <= 0.0002) cNear++;
      }
      const grid = [];
      for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
        const cx = Math.min(w - 1, Math.floor((gx + 0.5) * w / 3));
        const cy = Math.min(h - 1, Math.floor((gy + 0.5) * h / 3));
        const o = (cy * w + cx) * 4;
        grid.push({ cell: gx + ',' + gy, R: +buf[o].toFixed(6) });
      }
      quad.geometry.dispose(); mat.dispose(); RTr.dispose();
      return {
        w, h, n,
        uuid: short(tex), type: tex.type, format: tex.format,
        R: { min: +mnR.toFixed(6), max: +mxR.toFixed(6), mean: +(sR / n).toFixed(6),
             spread: +(mxR - mnR).toFixed(6) },
        selfProof: { gBad, bBad, ok: gBad === 0 && bBad === 0 },
        pct: { 'R<=0.0002(最近)': +(100 * cNear / n).toFixed(2), 'R>=0.999(最远/天空)': +(100 * cFar / n).toFixed(2) },
        grid,
      };
    }

    /* ── pass 链静态形状 ── */
    const chain = composer.passes.map((p, i) => ({
      i, name: p.constructor.name, needsSwap: !!p.needsSwap, clear: !!p.clear,
    }));

    /* ── 包住 RenderPass：抓住场景刚画完那一刻 ── */
    const rp = composer.passes[0];
    let sceneRT = null, earlyRead = null;
    if (!rp.__wireWrapped) {
      rp.__wireWrapped = true;
      const orig = rp.render.bind(rp);
      rp.render = function (rr, writeBuffer, readBuffer) {
        const ret = orig(rr, writeBuffer, readBuffer);
        sceneRT = readBuffer;                       // RenderPass 把场景画进 readBuffer
        earlyRead = readTex(readBuffer && readBuffer.depthTexture);  // Q1：此刻就读
        return ret;
      };
    }

    /* ── 跑一帧，同时记每个 pass 看到的缓冲身份 ── */
    const trace = [];
    if (!composer.__wireWrapped) {
      composer.__wireWrapped = true;
      composer.passes.forEach((p) => {
        if (p.__traceWrapped) return;
        p.__traceWrapped = true;
        const o = p.render.bind(p);
        p.render = function (rr, writeBuffer, readBuffer) {
          trace.push({
            name: p.constructor.name,
            read: short(readBuffer && readBuffer.depthTexture),
            write: short(writeBuffer && writeBuffer.depthTexture),
            composerRB: short(composer.readBuffer && composer.readBuffer.depthTexture),
          });
          return o(rr, writeBuffer, readBuffer);
        };
      });
    }
    composer.render(0.016);

    /* ── 定位雾的 tDepth ── */
    const fogTex = fogPass.uniforms.tDepth.value;
    const rt1 = composer.renderTarget1, rt2 = composer.renderTarget2;
    const idOf = tex => ({
      uuid: short(tex),
      isRT1depth: tex === (rt1 && rt1.depthTexture),
      isRT2depth: tex === (rt2 && rt2.depthTexture),
      isSceneRTdepth: tex === (sceneRT && sceneRT.depthTexture),
      type: tex && tex.type, format: tex && tex.format,
    });

    return {
      chain, trace,
      sceneRT: { uuid: short(sceneRT), rt1: rt1 === sceneRT, rt2: rt2 === sceneRT,
                 samples: sceneRT && sceneRT.samples },
      fogTexId: idOf(fogTex),
      reads: {
        early: earlyRead,
        fog: readTex(fogTex),
        sceneRT: readTex(sceneRT && sceneRT.depthTexture),
        rt1: readTex(rt1 && rt1.depthTexture),
        rt2: readTex(rt2 && rt2.depthTexture),
      },
      cam: { near: g.camera.near, far: g.camera.far },
      hfogOn: fogPass.uniforms.uEnabled ? fogPass.uniforms.uEnabled.value : '(no uEnabled)',
    };
  });

  await browser.close(); server.close();

  console.log('\n── pass 链（顺序 / needsSwap / clear）──');
  for (const c of out.chain) console.log(`  [${c.i}] ${c.name.padEnd(18)} needsSwap=${c.needsSwap}  clear=${c.clear}`);
  console.log('\n── 一帧内每个 pass 看到的深度纹理（read / write / 此刻 composer.readBuffer）──');
  for (const t of out.trace) console.log(`  ${t.name.padEnd(18)} read=${t.read}  write=${t.write}  composerRB=${t.composerRB}`);
  console.log(`\n── 场景 RT：${out.sceneRT.uuid}  (是 RT1? ${out.sceneRT.rt1}  是 RT2? ${out.sceneRT.rt2}  samples=${out.sceneRT.samples})`);
  console.log(`── 雾的 tDepth：${out.fogTexId.uuid}  是RT1深度? ${out.fogTexId.isRT1depth}  是RT2深度? ${out.fogTexId.isRT2depth}  是场景RT深度? ${out.fogTexId.isSceneRTdepth}`);
  console.log(`── 相机 near/far = ${out.cam.near} / ${out.cam.far} · uEnabled=${out.hfogOn}`);

  console.log('\n── 深度纹理读回（FloatType 全精度；G 必须逐位=0.25、B 必须逐位=0.75）──');
  const order = ['early', 'fog', 'sceneRT', 'rt1', 'rt2'];
  for (const k of order) {
    const v = out.reads[k];
    if (!v) { console.log(`  ${k}: (null)`); continue; }
    if (v.error) { console.log(`  ${k}: ${v.error}`); continue; }
    const sp = v.selfProof.ok ? 'OK' : '⛔FAIL';
    console.log(`  ${k.padEnd(8)} uuid=${v.uuid} ${v.w}x${v.h}  自证 G/B ${sp} (gBad=${v.selfProof.gBad} bBad=${v.selfProof.bBad})`);
    console.log(`           R min=${v.R.min} max=${v.R.max} mean=${v.R.mean} 极差=${v.R.spread}`);
    console.log(`           最近(${v.pct['R<=0.0002(最近)']}%)  最远/天空(${v.pct['R>=0.999(最远/天空)']}%)`);
    console.log(`           3×3: ` + v.grid.map(g => g.cell + '=' + g.R.toFixed(4)).join(' '));
  }
  console.log(`\n  pageerror: ${errors.length} 条`);
  if (errors.length) errors.slice(0, 5).forEach(e => console.log('   ! ' + e));
  process.exit(0);
})().catch(e => { console.error('[_tmp-fog-wire] 崩溃:', e); process.exit(2); });
