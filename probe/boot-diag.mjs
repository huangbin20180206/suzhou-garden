// 启动诊断 v2：量化「延迟装配链」在软渲染下到底要多久才能轮到 立峰·云根（最后一个 job）。
// 背景：立峰/伴石/题名石全在单个 deferBoot job 里，而该 job 是**最后注册**的；
//   runDeferredBoot 每步 setTimeout(step,0)，而软渲染一帧要数秒 → 每个 job 至少等一帧。
//   于是石头（探针目标）永远最后到。本探针量出真实到达时间，判断是「慢」还是「永不到」。
// 用法: node probe/boot-diag.mjs
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

const MAX_S = 300;

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await launchChromium(chromium);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(400000);

  const errs = [], deferLines = [];
  page.on('pageerror', e => errs.push(String(e).split('\n').slice(0, 3).join(' ⏎ ')));
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') errs.push('[console.error] ' + t);
    else if (m.type() === 'warning' && !t.includes('GL Driver Message')) errs.push('[warn] ' + t);
    if (t.includes('[启动分段·延迟]') || t.includes('[延迟装配]')) deferLines.push(t);
  });

  const t0 = Date.now();
  const el = () => ((Date.now() - t0) / 1000).toFixed(1);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__garden && document.getElementById('loading').classList.contains('done'),
    { timeout: 300000 }).catch(() => {});
  console.log(`[diag] loading 收起 @ ${el()}s\n[diag] 每 5s 采样一次（等待 立峰/伴石/题名石 出现，上限 ${MAX_S}s）`);

  let last = 0, done = false;
  const firstSeen = {};
  while (+el() < MAX_S && !done){
    const st = await page.evaluate(() => {
      const g = window.__garden;
      if (!g || !g.scene) return { no: true };
      const names = { taihuHero: false, taihuShelf: false, taihuCompanion: 0, steleGroup: false };
      let meshes = 0;
      g.scene.traverse(o => {
        if (o.isMesh || o.isInstancedMesh) meshes++;
        if (o.name === 'taihuHero') names.taihuHero = true;
        if (o.name === 'taihuShelf') names.taihuShelf = true;
        if (o.name === 'taihuCompanion') names.taihuCompanion++;
        if (o.name === 'steleGroup') names.steleGroup = true;
      });
      return { ...names, meshes };
    }).catch(e => ({ err: String(e).slice(0, 100) }));

    for (const k of ['taihuShelf', 'taihuHero', 'steleGroup']){
      if (st[k] && firstSeen[k] === undefined) firstSeen[k] = el();
    }
    if (st.taihuCompanion > 0 && firstSeen.taihuCompanion === undefined) firstSeen.taihuCompanion = el();
    if (deferLines.length !== last){
      for (const l of deferLines.slice(last)) console.log(`   [${el()}s] ${l}`);
      last = deferLines.length;
    }
    const pending = ['taihuShelf', 'taihuHero', 'steleGroup'].filter(k => !st[k]);
    if (!pending.length && st.taihuCompanion >= 2) done = true;
    if (!done) await page.waitForTimeout(5000);
  }

  console.log(`\n[diag] 首次出现时刻：${JSON.stringify(firstSeen)}`);
  console.log(`[diag] 结论：${done ? `✔ 全部装配完成，耗时 ≈ ${el()}s` : `✘ 到 ${MAX_S}s 仍未装配齐`}`);
  console.log(`[diag] 延迟链日志共 ${deferLines.length} 条；是否出现「立峰·云根」job：${
    deferLines.some(l => l.includes('立峰')) ? '是' : '否（job 从未执行）'}`);
  console.log(`[diag] 是否出现「合计」收尾行：${deferLines.some(l => l.includes('合计')) ? '是（链已跑完）' : '否（链仍在爬）'}`);
  if (errs.length){ console.log('\n[diag] 报错：'); for (const e of errs.slice(0, 8)) console.log('   ✗', e); }
  else console.log('\n[diag] 无页面报错');

  try { await browser.close(); } catch {}
  server.close();
  process.exit(0);
})().catch(e => { console.error('[diag] 异常：', e); process.exit(1); });
