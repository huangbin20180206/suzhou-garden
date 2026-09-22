// 只读诊断：把 [启动分段] 的每一段**逐段增量**打出来（含刚加细的贴图段与 §2~§7 刻度）。
// 用法: node probe/_p01-bootmarks.mjs
// 说明：不改页面状态、不入 verify 链；走 _harness（真 GPU / D3D11），不是软渲染。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './_harness.mjs';

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

/* '渲染器 39.6ms → 模块构建 463.1ms ｜ 合计 Nms' → [{name, t}] */
function parseMarks(raw){
  const body = raw.replace(/^\[启动分段\]\s*/, '').split(' ｜ ')[0];
  const out = [];
  for (const item of body.split(' → ')){
    const m = item.match(/([\d.]+)\s*ms\s*$/);
    if (!m) continue;
    out.push({ name: item.slice(0, m.index).trim() || '(未命名)', t: parseFloat(m[1]) });
  }
  return out;
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(400000);

  const errs = [], boot = [], defer = [], tier = [];
  page.on('pageerror', e => errs.push(String(e).split('\n').slice(0, 3).join(' ⏎ ')));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') errs.push('[console.error] ' + t);
    if (/GPU档位|GPU 档位/.test(t)) tier.push(t);
    if (t.includes('[启动分段·延迟]')) defer.push(t);
    else if (t.includes('[启动分段]')) boot.push(t);
  });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 300000 });
  // 主分段行在首帧打印；延迟链收尾行在此之后
  await page.waitForFunction(() => (document.getElementById('loading') || {}).classList
    && document.getElementById('loading').classList.contains('done'), { timeout: 300000 }).catch(() => {});
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline && !defer.some(l => l.includes('合计')))
    await page.waitForTimeout(1000);

  for (const l of tier) console.log(l);
  if (!boot.length) console.log('[boot] ✘ 没抓到 [启动分段] 行（页面可能启动失败）');
  for (const raw of boot){
    console.log('\n' + raw);
    const marks = parseMarks(raw);
    let prev = 0;
    console.log('\n  段间增量（本段耗时 = 该刻度 − 上一刻度）：');
    const rows = marks.map(({ name, t }) => {
      const d = t - prev; const row = { name, t, d }; prev = t; return row;
    });
    for (const r of rows)
      console.log(`    ${r.d.toFixed(1).padStart(8)}ms   @${r.t.toFixed(1).padStart(8)}ms   ${r.name}`);
    const hot = [...rows].sort((a, b) => b.d - a.d).slice(0, 5);
    console.log('\n  最热的 5 段：');
    for (const r of hot) console.log(`    ${r.d.toFixed(1).padStart(8)}ms   ${r.name}`);
  }

  if (defer.length){
    console.log('\n[启动分段·延迟]');
    for (const l of defer) console.log('  ' + l);
  } else console.log('\n[启动分段·延迟] 未出现（延迟链未收尾）');

  /* 首帧那几秒几乎全是着色器 program 的编译/链接（同步阻塞主线程）。
     数一数到底有多少个 program、分别属于哪种材质 —— 没有这个数就没法判断
     "7 秒"是 program 太多，还是单个 program 太重。 */
  const gfx = await page.evaluate(() => {
    const g = window.__garden; if (!g || !g.renderer) return null;
    const info = g.renderer.info;
    const byName = {};
    for (const p of (info.programs || [])) byName[p.name] = (byName[p.name] || 0) + 1;
    return { programs: (info.programs || []).length, byName,
             calls: info.render.calls, tris: info.render.triangles,
             geos: info.memory.geometries, tex: info.memory.textures,
             /* 首帧那几秒全是同步的 program 链接 —— 能不能改成不阻塞主线程，
                取决于两个 API 是否可用（见 index.html 的 compileAsync 方案）。 */
             parallelLink: !!g.renderer.getContext().getExtension('KHR_parallel_shader_compile'),
             hasCompileAsync: typeof g.renderer.compileAsync === 'function' };
  }).catch(() => null);
  if (gfx){
    console.log(`\n[gfx] 着色器 program ${gfx.programs} 个：` +
      Object.entries(gfx.byName).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', '));
    console.log(`[gfx] calls=${gfx.calls} tris=${gfx.tris.toLocaleString()} geos=${gfx.geos} tex=${gfx.tex}`);
    console.log(`[gfx] KHR_parallel_shader_compile=${gfx.parallelLink ? '有' : '无'}` +
                `，renderer.compileAsync=${gfx.hasCompileAsync ? '有' : '无'}`);
  }

  if (errs.length){ console.log('\n[err] 页面报错：'); for (const e of errs.slice(0, 8)) console.log('   ✗', e); }
  else console.log('\n[err] 无页面报错');

  try { await browser.close(); } catch {}
  server.close();
  process.exit(0);
})().catch(e => { console.error('[bootmarks] 探针自身异常：', e); process.exit(1); });
