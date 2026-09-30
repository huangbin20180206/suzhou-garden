// 着色器编译门禁（2026-10-01）：守住"改 GLSL 之后 program 真的编译通过了"。
//
// 为什么需要它：**GLSL 编译失败的症状极具误导性**。2026-10-01 给天空加次虹时，
// `breathe` 声明在主虹的 if 块里、次虹那个块看不见 ⇒ three 报
// "ERROR: 'breathe' : undeclared identifier" ⇒ **整个天空球变全黑**。
// 而当时我看到的画面只是"彩虹不见了"，第一反应是"窗口数学算错了"，
// 连着三轮都在调 azWin 的角度 —— 真因是**一行作用域错误**，与角度毫无关系。
//
// 关键点：编译失败时页面**照常显示、不抛异常、不进 pageerror**，
// 只有 three 打到 console 的一行 error。`npm run check` 也查不到
// （它只做 JS 语法，不编译 GLSL）。所以必须有一条门禁直接问 WebGL：
// "这个 program 到底 LINK 成功了吗"。
//
// 覆盖面：场景里所有**已渲染过**的 ShaderMaterial（含天空/远山/雾/水/后处理 pass）。
// 判定用 LINK_STATUS + getProgramInfoLog，不靠 console 文本匹配（three 的文案会变）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': ({
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.glb': 'model/gltf-binary',
    })[path.extname(p).toLowerCase()] || 'application/octet-stream' });
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
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.setDefaultTimeout(240000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  console.log(`\n[shader-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html?intro=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading')
    && document.getElementById('loading').classList.contains('done'), null, { timeout: 240000 });
  /* 09-24 硬规矩：采样场景内容必须等装配完成 */
  await page.evaluate(async () => { await window.__garden.bootDonePromise; });
  /* 走一遍各时段/天气，确保延迟批里的材质也都渲染过、program 真的被编译 */
  for (const [t, w] of [['noon', 'clear'], ['dusk', 'afterrain'], ['night', 'clear'], ['noon', 'storm']]){
    await page.evaluate(([tt, ww]) => { window.__garden.setEnv('time', tt); window.__garden.setEnv('weather', ww); }, [t, w]);
    await page.waitForFunction(() => window.__garden.ENV.t >= 1, null, { timeout: 120000 });
    await new Promise(r => setTimeout(r, 400));
  }

  const r = await page.evaluate(() => {
    const G = window.__garden;
    const gl = G.renderer.getContext();
    /* 先渲一帧：编译失败时 three 会把坏 program 留在 properties.currentProgram 上，
       直到下一次成功编译才替换 ⇒ 不重渲就可能读到上一帧的坏 program。 */
    G.composer.render();
    /* 场景里所有渲染过的 ShaderMaterial（含 customDepth 等变体） */
    const mats = new Set();
    G.scene.traverse(o => { if (o.material && o.material.isShaderMaterial) mats.add(o.material); });
    /* 后处理链上的 pass 自带的 ShaderMaterial */
    if (G.composer && G.composer.passes) for (const p of G.composer.passes) if (p.material) mats.add(p.material);
    /* 水面反射用的第二台相机不另编译 program，跳过 */

    const rows = [];
    let failed = 0, noProgram = 0;
    for (const m of mats){
      const props = G.renderer.properties.get(m);
      const prog = props && props.currentProgram;
      if (!prog || !prog.program){ noProgram++; rows.push({ name: m.name || '(无名)', state: 'no-program' }); continue; }
      const ok = gl.getProgramParameter(prog.program, gl.LINK_STATUS);
      if (!ok){
        failed++;
        /* 取 three 打到 console 的那段：getProgramInfoLog 通常只有 "Fragment shader is not compiled."，
           真正的行号在 three 的 console.error 里。这里先取 log，够定位到"哪个材质"。 */
        const log = (gl.getProgramInfoLog(prog.program) || '').slice(0, 400);
        rows.push({ name: m.name || '(无名)', state: 'LINK FAILED', log });
      }
    }
    return { total: mats.size, failed, noProgram, rows };
  });

  console.log(`  场景 ShaderMaterial ${r.total} 个（其中 ${r.noProgram} 个还没被渲染过、跳过）`);
  for (const row of r.rows.filter(x => x.state === 'LINK FAILED')){
    console.log(`    ✗ ${row.name}: ${row.log.replace(/\s+/g, ' ').slice(0, 200)}`);
  }

  check('所有已渲染的 ShaderMaterial 都编译通过（LINK_STATUS = true）',
    r.failed === 0, r.failed ? `${r.failed} 个失败` : `${r.total - r.noProgram} 个全部通过`);
  /* 天空是最容易被这种错误整块毁掉的（编译不过 ⇒ 球被丢弃 ⇒ 纯黑），
     单独给它一条：它必须既有 program 又编译成功。 */
  /* 天空单独一条 —— 断的是**看得见的症状**而不是内部状态。
   ⚠️ 我第一版写成"读天空材质的 currentProgram 查 LINK_STATUS"，结果**恒假红**：
      天空材质同时被主渲染和 PMREM 环境烘焙用过，three 按 program key 编译出多个变体，
      properties.currentProgram 指向哪一个取决于最后一次是谁在渲染 ⇒ 读它不可靠。
      而通用那条（遍历所有材质查 LINK_STATUS）是对的，18 个全过。
   症状才是可靠的判据：**天空区域不能是黑的**。编译失败 ⇒ 材质被丢弃 ⇒ 天空球
   整个不画 ⇒ 画面上半部纯黑（这正是 2026-10-01 那次的现象）。 */
  const skyPix = await page.evaluate(() => {
    const G = window.__garden;
    G.setEnv('time', 'noon'); G.setEnv('weather', 'clear');
    G.controls.enabled = false; G.controls.enableDamping = false;
    G.resetCamera(); G.controls.update(); G.camera.updateMatrixWorld(true);
    G.composer.render();
    const cv = document.createElement('canvas');
    cv.width = G.renderer.domElement.width; cv.height = G.renderer.domElement.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(G.renderer.domElement, 0, 0);
    const img = ctx.getImageData(0, 0, cv.width, Math.floor(cv.height * 0.25)).data;
    let sum = 0, n = 0;
    for (let i = 0; i < img.length; i += 4){
      sum += 0.2126 * img[i] + 0.7152 * img[i+1] + 0.0722 * img[i+2]; n++;
    }
    return { mean: +(sum / n).toFixed(2), n };
  });
  check('天空不是黑的（着色器编译失败 ⇒ 天空球整个不画 ⇒ 画面上半部纯黑）',
    skyPix.mean > 40, `画面上 25% 平均亮度 ${skyPix.mean}（正常晴天约 200+；纯黑 ≈ 0）`);
  check('全程零 pageerror', pageErrors.length === 0,
    pageErrors.length ? `${pageErrors.length} 条：${pageErrors[0]}` : '0 条');

  await browser.close(); server.close();
  const failed = results.filter(x => !x.ok);
  console.log(`\n[shader-guard] ${failed.length ? 'FAIL' : 'ALL PASS'}（${results.length} 项）`);
  if (failed.length) for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  console.log(`耗时：${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('[shader-guard] 崩溃:', e); process.exit(2); });
