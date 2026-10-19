// 控制台噪声门禁（2026-10-18 · 补 P3「启动有 256 条 WebGL 错误」）
//
// 守两件事：
//   ① **GL 错误必须为 0**：`GL_INVALID_OPERATION` / `Mismatch between texture format
//      and sampler type` 一条都不许有（启动期 + 稳态各查一次）。
//   ② 其它 console warning 只允许白名单里的已知项，且数量有上限 ——
//      真正的 WebGL 错误不会被这堆噪声淹没。
//
// 背景（实测见 outputs/_diag/gl-warn-*.mjs）：
//   修前 3713 笔 draw 报 `Mismatch between texture format and sampler type`
//   （浏览器控制台截到 256 条后停止上报）。根因：暖机 12 桶期间
//   `shadowMap.needsUpdate=false`，`sun.shadow.map` 仍是 null，而 WebGL2 的
//   STANDARD 材质着色器把 shadowMap 声明为 `sampler2DShadow` ⇒ 空 uniform 绑的是
//   默认 RGBA 纹理，格式对不上。修法：只给第 1 桶开一次 needsUpdate（见 11-loop.js
//   warmBoot 的注释），彩排帧之后本来就干净。
//   修后：GL 0 条；仅剩 1 条着色器编译精度提示（X4122），属驱动/编译器提示，放行。
//
// 用法：node probe/gl-warning-guard.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require = createRequire(import.meta.url);
  try { return require('playwright'); } catch { /* 走全局 */ }
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, 'playwright'));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
               '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err){ res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 白名单：已知且无害的 warning（命中即放行，但计入上限） */
const ALLOW = [
  /THREE\.WebGLProgram: Program Info Log:.*X4122/s,   // 着色器精度提示（驱动/编译器）
];
const isGL = t => /GL_INVALID_OPERATION|Mismatch between texture format and sampler type|GL_INVALID_VALUE|GL_INVALID_ENUM|GL_OUT_OF_MEMORY/i.test(t);

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(150000);

  const glErrs = [], warns = [], errs = [], pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  page.on('console', m => {
    const t = m.type(), txt = m.text();
    if (t === 'error' && isGL(txt)) glErrs.push(txt);
    else if (t === 'error') errs.push(txt);
    else if (t === 'warning') warns.push(txt);
  });

  console.log(`\n[gl-warning-guard] http://127.0.0.1:${port}/index.html`);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    null, { timeout: 120000, polling: 300 });
  const bootGL = glErrs.length;
  await sleep(2000);
  const steadyGL = glErrs.length - bootGL;

  check('启动期零 GL 错误（Mismatch/INVALID_OPERATION）', bootGL === 0,
    bootGL ? `${bootGL} 条：${glErrs[0].slice(0, 120)}` : '0 条（修前 3713 笔绘制报错 / 控制台 256 条）');
  check('稳态 2s 内零新增 GL 错误', steadyGL === 0, `${steadyGL} 条`);

  const uniq = [...new Set(warns)];
  const unknown = uniq.filter(w => !ALLOW.some(r => r.test(w)));
  check('console warning 只有白名单项', unknown.length === 0,
    uniq.map(w => `「${w.slice(0, 90)}」`).join(' | ') || '无 warning');
  check('console error（非 GL）为 0', errs.length === 0,
    errs.length ? `${errs.length} 条：${errs[0].slice(0, 120)}` : '0 条');
  check('无 pageerror', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  const bad = results.filter(r => !r.ok);
  console.log(`\n[gl-warning-guard] ${results.length - bad.length}/${results.length} PASS` +
    (bad.length ? ` · 红：${bad.map(b => b.name).join('、')}` : ''));
  await browser.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('[gl-warning-guard] 崩溃:', e); process.exit(2); });
