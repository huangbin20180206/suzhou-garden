// GPU 档位标签（2026-09-23 · T7.1 配套）：打印本次浏览器拿到的 GPU 名与软渲染标记。
//
// 为什么要它：`probe/_harness.mjs` 自己写着"ANGLE 到底挑哪块 GPU 不固定"——
//   实测同一台机器出现过 Intel Iris Xe（→ 核显档）与 NVIDIA RTX 4060（→ 独显档），
//   两档的**超采样 / 阴影贴图尺寸 / GTAO 开关 / 粒子量**全不同（同一场景 draw calls 308 vs 716），
//   于是**像素统计不同** ⇒ 基于 σ/容差的像素判据会随档位漂。
// 所以 verify-all 在开头/结尾/红门时各打一次档位，便于把"偶发红门"与档位对上。
//
// 用法: node probe/gpu-tag.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { launchChromium, listenEphemeral } from './_harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function loadPlaywright(){
  const require2 = createRequire(import.meta.url);
  try { return require2('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return require2(path.join(globalRoot, 'playwright'));
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

(async () => {
  const port = await listenEphemeral(server);
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.setDefaultTimeout(180000);
  try {
    await page.goto('http://127.0.0.1:' + port + '/index.html?intro=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__garden, { timeout: 120000 });
    const info = await page.evaluate(() => ({
      gpu: window.__garden.gpuName || '(未知)',
      soft: !!window.__garden.softwareGL,
      pr: window.__garden.renderer ? +window.__garden.renderer.getPixelRatio().toFixed(2) : null,
    }));
    console.log(`[GPU] ${info.gpu}${info.soft ? ' ｜ softwareGL=true（软渲染）' : ''}${info.pr !== null ? ` ｜ pixelRatio=${info.pr}` : ''}`);
  } catch (e) {
    console.log('[GPU] 读取失败：' + (e && e.message ? e.message : e));
  }
  await browser.close();
  server.close();
})().catch(e => { console.log('[GPU] 探针异常：' + (e && e.message ? e.message : e)); process.exit(0); });
