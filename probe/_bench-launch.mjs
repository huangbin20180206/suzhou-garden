// 一次性基准：无头 Chromium 的 launch 参数对帧时间的影响（决定要不要给整套探针换 harness）。
//
// 动机：本项目全套门禁慢的根因是**无头 Chromium 落到 SwiftShader 软渲染 ≈8.4s/帧**
// （交互态用核显 3~5 fps，差 ~40 倍）。唯一可能真正提速的杠杆是给 launch 加 GPU 参数。
//
// ⚠️ **不能顺手改** —— `getRenderCapabilityProfile` 读的就是 WebGL renderer 串，
//    GPU_TIER 会从 low 变 high（阴影图 2048²→6144²），**所有探针的基线都会变**，
//    必须整套重跑一次才有可比性。所以先用这个脚本量出真实收益再决定。
//
// 判据（对被测对象特异，不看"感觉快了"）：
//  ① 帧时间中位数 / ② page 内读到的 renderer 串 / ③ GPU_TIER
//  只有 ①②③ 同时给出"真的走 GPU 了"，提速数字才算数。
//
// 用法: node probe/_bench-launch.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch {}
  return require(path.join(require.resolve('playwright').replace(/[\\/]index\.js$/, ''), '..'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

/* 候选 harness。default = 现在所有探针在用的写法，其余是候选。
   ⚠️ `headless:false` 会在桌面弹出可见窗口，先不放进来 —— 只有无头 GPU 参数完全无效时
      才值得去申请一次（问过老黄再做）。 */
const CONFIGS = [
  { name: 'default',     headless: true, args: [] },
  { name: 'angle-d3d11', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] },
  { name: 'gl-angle',    headless: true, args: ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist'] },
];

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const out = [];

  for (const cfg of CONFIGS){
    let browser = null;
    const row = { name: cfg.name, ok: false };
    try {
      browser = await chromium.launch({ headless: cfg.headless, args: cfg.args });
      const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
      page.setDefaultTimeout(240000);
      const errs = [];
      page.on('pageerror', e => errs.push(String(e)));
      const t0 = Date.now();
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 180000 });
      await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
        { timeout: 240000 });
      row.bootSec = +((Date.now() - t0) / 1000).toFixed(1);
      /* 帧时间：量 12 个 rAF 间隔的中位数（中位数比均值稳，首帧/GC 的离群值不参与） */
      row.frames = await page.evaluate(() => new Promise(res => {
        const dts = []; let last = performance.now();
        const step = () => {
          const now = performance.now(); dts.push(now - last); last = now;
          if (dts.length >= 12) res({ medMs: dts.slice(1).sort((a, b) => a - b)[Math.floor((dts.length - 1) / 2)],
                                      minMs: Math.min(...dts.slice(1)), n: dts.length - 1 });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }));
      row.renderer = await page.evaluate(() => {
        const cv = document.createElement('canvas');
        const gl = cv.getContext('webgl2') || cv.getContext('webgl');
        if (!gl) return 'no-webgl';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      });
      /* ⚠️ 决定"能不能换 harness"的不是帧时间，是这三样：
         GPU_TIER（决定阴影图 2048²/6144²、AO 开关、超采样）→ 从 sun.shadow.mapSize 反读；
         SOFTWARE_GL（决定 QOS 自适应开不开）→ 直接读 __garden.softwareGL；
         QOS 当前档位 → 档位会动态改 scale / 阴影尺寸，门禁基线最怕它。 */
      row.env = await page.evaluate(() => {
        const g = window.__garden;
        const q = g.qosState ? g.qosState() : null;
        const sm = g.sunLight().shadow.mapSize;
        return {
          gpuName: String(g.gpuName || '').slice(0, 72),
          softwareGL: g.softwareGL,
          shadowMapSize: sm.x + 'x' + sm.y,
          qosLevel: q ? q.level : null, qosActive: q ? q.active : null, qosChanges: q ? q.changes : null,
          drawCallsUI: null,
        };
      });
      row.zeroPageError = errs.length === 0;
      row.ok = true;
      await browser.close();
    } catch (e){
      row.error = String(e).split('\n')[0].slice(0, 160);
      try { if (browser) await browser.close(); } catch {}
    }
    out.push(row);
    console.log(`  ${row.ok ? '✓' : '✗'} ${row.name.padEnd(14)} ` +
      (row.ok ? `帧时间中位 ${row.frames.medMs.toFixed(0)}ms（最快 ${row.frames.minMs.toFixed(0)}ms）  启动 ${row.bootSec}s\n` +
                `      阴影图 ${row.env.shadowMapSize}  SOFTWARE_GL=${row.env.softwareGL}  ` +
                `QOS L${row.env.qosLevel}(active=${row.env.qosActive},changes=${row.env.qosChanges})\n` +
                `      renderer=${String(row.renderer).slice(0, 88)}`
              : `失败：${row.error}`));
  }

  const base = out.find(r => r.name === 'default' && r.ok);
  console.log('\n[bench-launch] 相对 default 的加速：');
  for (const r of out){
    if (!r.ok || r.name === 'default') continue;
    if (!base) { console.log(`  ${r.name}：无 default 基线可比`); continue; }
    console.log(`  ${r.name}: 帧时间 ${base.frames.medMs.toFixed(0)}ms → ${r.frames.medMs.toFixed(0)}ms ` +
      `= **${(base.frames.medMs / r.frames.medMs).toFixed(1)}×**`);
  }
  if (base){
    const sameTier = out.filter(r => r.ok && r.name !== 'default').every(r => r.env.shadowMapSize === base.env.shadowMapSize);
    const qosFlip = out.filter(r => r.ok && r.name !== 'default').every(r => r.env.softwareGL !== base.env.softwareGL);
    console.log(`\n  ① 阴影图尺寸是否与 default 一致：${sameTier ? '是 → GPU_TIER 没变，几何/状态类断言可比' : '否 → GPU_TIER 变了，整套基线作废'}`);
    console.log(`  ② SOFTWARE_GL 是否翻转：${qosFlip ? '**是** → QOS 自适应会被激活（门禁最怕的动态量），换 harness 必须同时把 QOS 钉死在 L0' : '否'}`);
  }
  fs.mkdirSync(path.join(ROOT, 'outputs', '_diag'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'outputs', '_diag', 'bench-launch.json'), JSON.stringify(out, null, 2));
  server.close();
  process.exit(0);
})().catch(e => { console.error('[bench-launch] 异常：', e); server.close(); process.exit(1); });
